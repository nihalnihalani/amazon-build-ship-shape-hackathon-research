import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  CLOSE,
  MAX_MESSAGE_BYTES,
  MemoryRoomStore,
  MinuteAggregator,
  RelayCore,
  createRedactingLogger,
  newConnectionId,
  systemRandomBytes,
  type Action,
  type MetricName,
  type RoomStore,
} from '../core/index.js';
import type { LocalConfig } from './config.js';
import { securityHeaders, serveStatic } from './static.js';

export interface LocalServerOptions {
  config: LocalConfig;
  /** Receives sanitized, content-free JSON log lines. Defaults to stdout with a timestamp prefix. */
  logSink?: (line: string) => void;
  store?: RoomStore;
  now?: () => number;
}

export interface LocalServer {
  core: RelayCore;
  store: RoomStore;
  metrics: Map<MetricName, number>;
  start(): Promise<{ port: number; host: string }>;
  stop(): Promise<void>;
  /** Flips the kill switch at runtime. */
  setDisabled(disabled: boolean): void;
  connectionCount(): number;
}

const MAX_WS_FRAME = 32 * 1024; // matches the API Gateway frame limit; our protocol limit is 8 KB
const MAX_BUFFERED_BYTES = 1024 * 1024;
const CLOSE_GRACE_MS = 2000;

const defaultSink = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};

export function createLocalServer(opts: LocalServerOptions): LocalServer {
  const { config } = opts;
  const now = opts.now ?? Date.now;
  const store = opts.store ?? new MemoryRoomStore();
  const logger = createRedactingLogger(opts.logSink ?? defaultSink);
  const metrics = new Map<MetricName, number>();
  let disabled = config.disabled;
  // Local secret for the keyed hashes (pairing codes, source addresses): random per process, never configured,
  // never written anywhere. Restarting the relay invalidates every pairing code (as it empties the memory store).
  const hashSecret = randomBytes(32).toString('base64url');
  const aggregator = new MinuteAggregator();

  const core = new RelayCore({
    store,
    config: {
      phoneOrigins: config.allowedOrigins,
      tvPreviewOrigins: config.tvPreviewOrigins,
      hashSecret,
      environment: config.environment,
      liveRoomCap: config.liveRoomCap,
      isDisabled: () => disabled,
    },
  });

  const headers = securityHeaders({ tls: config.tls !== null, hstsMaxAgeSeconds: config.hstsMaxAgeSeconds });
  const sockets = new Map<string, WebSocket>();
  const chains = new Map<string, Promise<void>>();

  const handleHttp = (req: IncomingMessage, res: ServerResponse): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://relay.invalid').pathname;
    } catch {
      res.writeHead(400, headers).end();
      return;
    }
    if (pathname === '/healthz') {
      const body = '{"status":"ok"}';
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (pathname === '/ws') {
      res.writeHead(426, { ...headers, Upgrade: 'websocket', Connection: 'Upgrade', 'Content-Length': 0 }).end();
      return;
    }
    serveStatic(req, res, pathname, { root: config.staticDir, headers }).catch(() => {
      if (!res.headersSent) res.writeHead(500, headers);
      res.end();
    });
  };

  const server: HttpServer = config.tls
    ? createHttpsServer(
        { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath), minVersion: 'TLSv1.2' },
        handleHttp,
      )
    : createHttpServer(handleHttp);

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_FRAME, perMessageDeflate: false });

  const execute = async (actions: Action[]): Promise<void> => {
    for (const a of actions) {
      switch (a.kind) {
        case 'send': {
          const ws = sockets.get(a.connId);
          if (!ws || ws.readyState !== ws.OPEN) break;
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            ws.terminate();
            break;
          }
          ws.send(a.data);
          break;
        }
        case 'close': {
          const ws = sockets.get(a.connId);
          if (!ws) break;
          if (ws.readyState === ws.OPEN) ws.close(a.code, a.reason);
          const t = setTimeout(() => ws.terminate(), CLOSE_GRACE_MS);
          t.unref();
          ws.once('close', () => clearTimeout(t));
          break;
        }
        case 'log':
          logger.log(a.event);
          break;
        case 'metric':
          metrics.set(a.name, (metrics.get(a.name) ?? 0) + a.value);
          // Ordinary traffic is aggregated per minute instead of logged per message (A2-04).
          for (const line of aggregator.record(a, now())) logger.log(line);
          break;
        case 'schedule':
          // The authentication deadlines are enforced by the sweep below (every tickMs); the Lambda adapter turns
          // these requests into delayed SQS messages instead. Same message-level behaviour: error, then close.
          break;
      }
    }
  };

  const enqueue = (connId: string, work: () => Promise<Action[]>): void => {
    const prev = chains.get(connId) ?? Promise.resolve();
    const next = prev
      .then(async () => execute(await work()))
      .catch(() => {
        logger.log({ event: 'internal_error', code: 'internal' });
        const ws = sockets.get(connId);
        if (ws && ws.readyState === ws.OPEN) ws.close(1011, 'internal');
      });
    chains.set(connId, next);
  };

  const rejectUpgrade = (socket: Duplex, status: number, text: string): void => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://relay.invalid').pathname;
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    if (pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const connId = newConnectionId(systemRandomBytes);
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const remote = req.socket.remoteAddress ?? 'unknown';
    core
      .onConnect(connId, { origin, sourceKey: remote, now: now() })
      .then(async (actions) => {
        await execute(actions.filter((a) => a.kind !== 'close'));
        const refused = actions.find((a) => a.kind === 'close');
        if (refused && refused.kind === 'close') {
          if (refused.code === CLOSE.DISABLED) rejectUpgrade(socket, 503, 'Service Unavailable');
          else if (refused.code === CLOSE.RATE_LIMITED) rejectUpgrade(socket, 429, 'Too Many Requests');
          else rejectUpgrade(socket, 403, 'Forbidden');
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          sockets.set(connId, ws);
          ws.on('message', (data: RawData, isBinary: boolean) => {
            const bytes = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : (data as Buffer | ArrayBuffer).byteLength;
            enqueue(connId, () =>
              core.processInbound(isBinary ? { binary: true, bytes } : rawToString(data), { connId, now: now() }),
            );
          });
          ws.on('close', () => {
            enqueue(connId, () => core.onDisconnect(connId, now()));
            const done = chains.get(connId);
            void done?.finally(() => {
              sockets.delete(connId);
              if (chains.get(connId) === done) chains.delete(connId);
            });
          });
          ws.on('error', () => {
            logger.log({ event: 'internal_error', code: 'internal' });
          });
        });
      })
      .catch(() => {
        logger.log({ event: 'internal_error', code: 'internal' });
        rejectUpgrade(socket, 500, 'Internal Server Error');
      });
  });

  let timer: NodeJS.Timeout | null = null;

  return {
    core,
    store,
    metrics,
    setDisabled(d: boolean): void {
      disabled = d;
      logger.log({ event: 'kill_switch', code: 'relay_disabled' });
    },
    connectionCount: () => sockets.size,
    start(): Promise<{ port: number; host: string }> {
      return new Promise((resolveStart, rejectStart) => {
        server.once('error', rejectStart);
        server.listen(config.port, config.host, () => {
          server.off('error', rejectStart);
          timer = setInterval(() => {
            core
              .onTick(now())
              .then(execute)
              .then(() => {
                for (const line of aggregator.flush(now())) logger.log(line);
              })
              .catch(() => logger.log({ event: 'internal_error', code: 'internal' }));
          }, config.tickMs);
          timer.unref();
          const addr = server.address() as AddressInfo;
          resolveStart({ port: addr.port, host: config.host });
        });
      });
    },
    stop(): Promise<void> {
      if (timer) clearInterval(timer);
      for (const line of aggregator.flush(now(), true)) logger.log(line);
      for (const ws of sockets.values()) ws.terminate();
      return new Promise((resolveStop) => {
        wss.close(() => {
          server.close(() => resolveStop());
          server.closeAllConnections();
        });
      });
    },
  };
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export const LOCAL_MAX_MESSAGE_BYTES = MAX_MESSAGE_BYTES;

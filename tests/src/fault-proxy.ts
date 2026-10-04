/**
 * Fault-injecting WSS proxy for T15. Sits between a client (TV driver or phone page) and the real
 * local relay. Text frames pass through unchanged unless a fault is configured. It never inspects or
 * stores payloads beyond the optional per-direction frame counters used by the tests.
 *
 * Faults: fixed latency per direction, duplicate every N-th frame, drop all connections (link loss),
 * hold frames (blackout) and release them later.
 */
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

export interface FaultConfig {
  latencyUpMs: number; // client -> relay
  latencyDownMs: number; // relay -> client
  duplicateUpEvery: number; // 0 = off; 1 = every client->relay frame sent twice
  blackout: boolean; // while true, frames in both directions are held
}

export interface FaultProxy {
  url: string;
  config: FaultConfig;
  counts: { up: number; down: number; duplicated: number; connections: number };
  /** Abruptly close every proxied connection (both legs), simulating link loss. */
  dropAll(): void;
  /** Release frames held during a blackout, in order. */
  release(): void;
  close(): Promise<void>;
}

export async function startFaultProxy(opts: {
  upstream: string; // wss://localhost:<relayPort>/ws
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
}): Promise<FaultProxy> {
  const config: FaultConfig = { latencyUpMs: 0, latencyDownMs: 0, duplicateUpEvery: 0, blackout: false };
  const counts = { up: 0, down: 0, duplicated: 0, connections: 0 };
  const pairs = new Set<{ client: WebSocket; upstream: WebSocket }>();
  const held: Array<() => void> = [];

  const server = https.createServer({ cert: opts.cert, key: opts.key });
  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

  const later = (ms: number, fn: () => void) => {
    const run = () => (ms > 0 ? setTimeout(fn, ms) : fn());
    if (config.blackout) held.push(run);
    else run();
  };

  wss.on('connection', (client, req) => {
    counts.connections += 1;
    const headers: Record<string, string> = {};
    if (req.headers.origin) headers.Origin = String(req.headers.origin);
    const upstream = new WebSocket(opts.upstream, { ca: opts.ca, headers, perMessageDeflate: false });
    const pair = { client, upstream };
    pairs.add(pair);
    const pendingUp: string[] = [];
    upstream.on('open', () => {
      for (const m of pendingUp.splice(0)) upstream.send(m);
    });
    client.on('message', (data, isBinary) => {
      if (isBinary) return client.close(1003, 'binary');
      const text = data.toString('utf8');
      counts.up += 1;
      const sendUp = () => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
        else if (upstream.readyState === WebSocket.CONNECTING) pendingUp.push(text);
      };
      later(config.latencyUpMs, () => {
        sendUp();
        if (config.duplicateUpEvery > 0 && counts.up % config.duplicateUpEvery === 0) {
          counts.duplicated += 1;
          sendUp();
        }
      });
    });
    upstream.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString('utf8');
      counts.down += 1;
      later(config.latencyDownMs, () => {
        if (client.readyState === WebSocket.OPEN) client.send(text);
      });
    });
    const closeBoth = () => {
      pairs.delete(pair);
      if (client.readyState === WebSocket.OPEN) client.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    client.on('close', closeBoth);
    upstream.on('close', closeBoth);
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `wss://localhost:${port}/ws`,
    config,
    counts,
    dropAll: () => {
      for (const p of [...pairs]) {
        p.client.terminate();
        p.upstream.terminate();
        pairs.delete(p);
      }
    },
    release: () => {
      for (const run of held.splice(0)) run();
    },
    close: async () => {
      for (const p of [...pairs]) {
        p.client.terminate();
        p.upstream.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve())));
    },
  };
}

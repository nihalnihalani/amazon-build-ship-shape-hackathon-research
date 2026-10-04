/**
 * API Gateway WebSocket adapter for the relay core (runtime nodejs24.x, arm64).
 *
 * One Lambda function serves the three routes ($connect, $disconnect, $default):
 *  - $connect: Origin allowlist only (RelayCore.onConnect) and the connection record with a TTL. No authorizer:
 *    authentication is the first message (ADR-0003).
 *  - $disconnect: RelayCore.onDisconnect (best effort: API Gateway may not deliver it, so GoneException below and
 *    the heartbeat are the backstops).
 *  - $default: every other frame goes to RelayCore.onMessage; the resulting actions are executed through the
 *    API Gateway Management API.
 *
 * The management endpoint is derived from each event (`https://{domainName}/{stage}`); no endpoint is hard-coded.
 * (With a custom domain mapping the stage is not part of the path; this deployment uses the default domain.)
 *
 * Logs go through the redacting logger (ADR-0002). Error objects are never logged: AWS SDK errors can carry request
 * details, so only the fixed `internal_error` event is emitted.
 */
import {
  CLOSE,
  RelayCore,
  createRedactingLogger,
  type Action,
  type MetricName,
  type RandomBytes,
  type RoomStore,
} from '../core/index.js';

export interface WsRequestContext {
  routeKey?: string;
  connectionId?: string;
  domainName?: string;
  stage?: string;
  identity?: { sourceIp?: string };
}
export interface WsEvent {
  requestContext: WsRequestContext;
  headers?: Record<string, string | undefined> | null;
  multiValueHeaders?: Record<string, string[] | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}
export interface WsResult {
  statusCode: number;
  body?: string;
}

/** The two Management API calls the adapter needs. Real implementation: ApiGatewayManagementApiClient. */
export interface ManagementApi {
  postToConnection(connectionId: string, data: string): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
}
export type ManagementApiFactory = (endpoint: string) => ManagementApi;

export interface RelayHandlerOptions {
  store: RoomStore;
  allowedOrigins: readonly string[];
  hashPepper: string;
  /** Kill switch, evaluated on every call (RELAY_DISABLED=true). */
  isDisabled: () => boolean;
  apiFactory: ManagementApiFactory;
  /** Stage name, used only as a CloudWatch metric dimension. */
  stage: string;
  metricsNamespace?: string;
  now?: () => number;
  logSink?: (line: string) => void;
  metricSink?: (line: string) => void;
  randomBytes?: RandomBytes;
}

const MAX_GONE_DEPTH = 3;

export function isGoneError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410;
}

function headerValue(event: WsEvent, name: string): string | null {
  const lower = name.toLowerCase();
  const multi = event.multiValueHeaders;
  if (multi) {
    for (const [k, v] of Object.entries(multi)) {
      if (k.toLowerCase() === lower && v && v.length > 1) return `multiple ${lower} headers`; // never allowlisted
    }
  }
  const single = event.headers;
  if (single) {
    for (const [k, v] of Object.entries(single)) {
      if (k.toLowerCase() === lower && v !== undefined) return v;
    }
  }
  return null;
}

export function createRelayHandler(opts: RelayHandlerOptions): (event: WsEvent) => Promise<WsResult> {
  const now = opts.now ?? Date.now;
  const logSink = opts.logSink ?? ((line: string) => console.log(line));
  const metricSink = opts.metricSink ?? ((line: string) => console.log(line));
  const namespace = opts.metricsNamespace ?? 'AcrossTheRoom/Relay';
  const logger = createRedactingLogger(logSink);
  const core = new RelayCore({
    store: opts.store,
    config: { allowedOrigins: opts.allowedOrigins, hashPepper: opts.hashPepper, isDisabled: opts.isDisabled },
    ...(opts.randomBytes ? { randomBytes: opts.randomBytes } : {}),
  });

  const emitMetrics = (metrics: Map<MetricName, number>): void => {
    if (metrics.size === 0) return;
    const record: Record<string, unknown> = {
      _aws: {
        Timestamp: now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [['Stage']],
            Metrics: [...metrics.keys()].map((name) => ({ Name: name, Unit: 'Count' })),
          },
        ],
      },
      Stage: opts.stage,
    };
    for (const [name, value] of metrics) record[name] = value;
    metricSink(JSON.stringify(record));
  };

  /** Executes actions in order. Returns connections that turned out to be gone. */
  const execute = async (
    actions: Action[],
    api: ManagementApi | null,
    metrics: Map<MetricName, number>,
  ): Promise<string[]> => {
    const gone: string[] = [];
    for (const a of actions) {
      switch (a.kind) {
        case 'log':
          logger.log(a.event);
          break;
        case 'metric':
          metrics.set(a.name, (metrics.get(a.name) ?? 0) + a.value);
          break;
        case 'send':
          if (!api) break;
          try {
            await api.postToConnection(a.connId, a.data);
          } catch (e) {
            if (isGoneError(e)) gone.push(a.connId);
            else logger.log({ event: 'internal_error', code: 'internal' });
          }
          break;
        case 'close':
          if (!api) break;
          // The Management API cannot choose a close code; the relay's reason is carried by the preceding error
          // message and the log line. Local adapter uses the real codes (4401, 4429, 4503, ...).
          try {
            await api.deleteConnection(a.connId);
          } catch (e) {
            if (isGoneError(e)) gone.push(a.connId);
            else logger.log({ event: 'internal_error', code: 'internal' });
          }
          break;
      }
    }
    return gone;
  };

  /** Runs actions; for each connection found gone, runs disconnect handling so the peer is told (bounded depth). */
  const run = async (actions: Action[], api: ManagementApi | null, metrics: Map<MetricName, number>): Promise<void> => {
    let pending = actions;
    for (let depth = 0; depth <= MAX_GONE_DEPTH; depth += 1) {
      const gone = [...new Set(await execute(pending, api, metrics))];
      if (gone.length === 0) return;
      pending = [];
      for (const connId of gone) {
        logger.log({ event: 'send_gone' });
        pending.push(...(await core.onDisconnect(connId, now())));
      }
    }
  };

  return async function handler(event: WsEvent): Promise<WsResult> {
    const rc = event.requestContext;
    const metrics = new Map<MetricName, number>();
    try {
      const connId = rc.connectionId;
      if (!connId) {
        logger.log({ event: 'internal_error', code: 'internal' });
        return { statusCode: 400 };
      }
      let api: ManagementApi | null = null;
      if (rc.domainName && rc.stage) api = opts.apiFactory(`https://${rc.domainName}/${rc.stage}`);

      switch (rc.routeKey) {
        case '$connect': {
          const actions = await core.onConnect(connId, {
            origin: headerValue(event, 'origin'),
            sourceKey: rc.identity?.sourceIp ?? 'unknown',
            now: now(),
          });
          // The connection cannot be written to yet (GoneException before establishment), so only the handshake
          // status matters here: any close action means refuse.
          const refused = actions.find((a) => a.kind === 'close');
          await run(
            actions.filter((a) => a.kind === 'log' || a.kind === 'metric'),
            null,
            metrics,
          );
          emitMetrics(metrics);
          if (refused && refused.kind === 'close') {
            return { statusCode: refused.code === CLOSE.DISABLED ? 503 : 403 };
          }
          return { statusCode: 200 };
        }
        case '$disconnect': {
          await run(await core.onDisconnect(connId, now()), api, metrics);
          emitMetrics(metrics);
          return { statusCode: 200 };
        }
        default: {
          // $default (and any other route key, which is treated as a frame)
          const raw =
            event.isBase64Encoded === true
              ? { binary: true as const, bytes: Buffer.from(event.body ?? '', 'base64').length }
              : (event.body ?? '');
          await run(await core.onMessage(connId, raw, now()), api, metrics);
          emitMetrics(metrics);
          return { statusCode: 200 };
        }
      }
    } catch {
      // Never log the error object or the event: either may contain request data.
      logger.log({ event: 'internal_error', code: 'internal' });
      emitMetrics(metrics);
      return { statusCode: 500 };
    }
  };
}

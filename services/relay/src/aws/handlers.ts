/**
 * API Gateway WebSocket adapter for the relay core (runtime nodejs24.x, arm64).
 *
 * Two Lambda functions share this runtime (they differ only in which entry they expose):
 *  - the relay function serves $connect, $disconnect and $default:
 *      $connect: origin classification, the per-source $connect budget and concurrency cap, the connection record
 *        with a TTL, and a delayed authentication-deadline check. No authorizer: authentication is the first
 *        message (ADR-0003).
 *      $disconnect: RelayCore.onDisconnect (best effort: API Gateway may not deliver it, so GoneException below
 *        and the heartbeat are the backstops).
 *      $default: every other frame goes to RelayCore.processInbound, the single inbound entry (PK-10). This adapter
 *        never parses, validates or forwards a frame itself, and it never decodes a non-text frame.
 *  - the deadline function consumes the SQS delay queue (A3-09): API Gateway gives a Lambda no per-connection timer,
 *    so after $connect (5 s), after a join request (65 s) and after a join ended (5 s) the relay queues a message
 *    that calls RelayCore.onDeadlineCheck, which sends an `error` and deletes a connection that still has not
 *    authenticated.
 *
 * Client-visible behaviour on this adapter: errors arrive as an `error` message; a close arrives as a closed
 * socket without a chosen close code (DeleteConnection cannot set one); a refused $connect is HTTP 403 (origin),
 * 429 (per-source budget) or 503 (kill switch). The local adapter matches at the message level.
 *
 * The management endpoint is derived from each event (`https://{domainName}/{stage}`); no endpoint is hard-coded.
 * (With a custom domain mapping the stage is not part of the path; this deployment uses the default domain.)
 *
 * Logs go through the redacting logger (ADR-0002). Error objects are never logged: AWS SDK errors can carry request
 * details, so only the fixed `internal_error` event is emitted. Ordinary traffic is aggregated per minute.
 */
import {
  CLOSE,
  MinuteAggregator,
  RelayCore,
  createRedactingLogger,
  isAggregatedMetric,
  type Action,
  type MetricName,
  type RandomBytes,
  type RelayEnvironment,
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

export interface SqsRecord {
  messageId: string;
  body: string;
}
export interface SqsEvent {
  Records: SqsRecord[];
}
export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

/** The two Management API calls the adapter needs. Real implementation: ApiGatewayManagementApiClient. */
export interface ManagementApi {
  postToConnection(connectionId: string, data: string): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
}
export type ManagementApiFactory = (endpoint: string) => ManagementApi;

/** What the delayed deadline message carries: the connection and where to reach it (never a secret). */
export interface DeadlineMessage {
  c: string;
  d: string;
  s: string;
}
export interface DeadlineScheduler {
  /** Queue a deadline check for `message.c` after `delaySeconds` (SQS DelaySeconds, at most 900). */
  schedule(message: DeadlineMessage, delaySeconds: number): Promise<void>;
}

export interface RelayHandlerOptions {
  store: RoomStore;
  phoneOrigins: readonly string[];
  tvPreviewOrigins?: readonly string[];
  environment?: RelayEnvironment;
  liveRoomCap?: number;
  /** Master secret for the keyed hashes, read on demand (SSM SecureString in production). */
  hashSecret: () => Promise<string>;
  /** Kill switch, evaluated on every call (RELAY_DISABLED=true). */
  isDisabled: () => boolean;
  apiFactory: ManagementApiFactory;
  /** Delayed deadline checks. When absent, deadlines are enforced logically on the next message only. */
  scheduler?: DeadlineScheduler;
  /** Stage name, used only as a CloudWatch metric dimension. */
  stage: string;
  metricsNamespace?: string;
  now?: () => number;
  logSink?: (line: string) => void;
  metricSink?: (line: string) => void;
  randomBytes?: RandomBytes;
}

export interface RelayRuntime {
  handleApi(event: WsEvent): Promise<WsResult>;
  handleDeadline(event: SqsEvent): Promise<SqsBatchResponse>;
}

const MAX_GONE_DEPTH = 3;
const MAX_SQS_DELAY_SECONDS = 900;
const RE_DOMAIN = /^[a-z0-9]{6,20}\.execute-api\.[a-z0-9-]{4,30}\.amazonaws\.com(\.cn)?$/;
const RE_STAGE = /^[A-Za-z0-9_-]{1,128}$/;

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

const isNonEmptyString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Validates the body of a deadline message. Returns null for anything that is not exactly what the relay sends:
 * a connection id, the API Gateway domain of this account's WebSocket API and the stage. The domain and stage are
 * matched against strict patterns so that a forged queue message can never point the Management API client at
 * another host.
 */
function parseDeadlineBody(raw: string): DeadlineMessage | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { c, d, s } = body as Record<string, unknown>;
  if (!isNonEmptyString(c, 128) || !isNonEmptyString(d, 253) || !RE_DOMAIN.test(d) || !isNonEmptyString(s, 128) || !RE_STAGE.test(s)) return null;
  return { c, d, s };
}

/** Decoded size of a base64 string, computed from its length: a binary frame is never decoded. */
export function base64DecodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

export function createRelayRuntime(opts: RelayHandlerOptions): RelayRuntime {
  const now = opts.now ?? Date.now;
  const logSink = opts.logSink ?? ((line: string) => console.log(line));
  const metricSink = opts.metricSink ?? ((line: string) => console.log(line));
  const namespace = opts.metricsNamespace ?? 'AcrossTheRoom/Relay';
  const logger = createRedactingLogger(logSink);
  const aggregator = new MinuteAggregator();

  // The core is rebuilt when the secret changes (rotation of the SSM parameter takes effect without a redeploy).
  let core: RelayCore | null = null;
  let coreSecret: string | null = null;
  const getCore = async (): Promise<RelayCore> => {
    const secret = await opts.hashSecret();
    if (!core || secret !== coreSecret) {
      core = new RelayCore({
        store: opts.store,
        config: {
          phoneOrigins: opts.phoneOrigins,
          ...(opts.tvPreviewOrigins ? { tvPreviewOrigins: opts.tvPreviewOrigins } : {}),
          hashSecret: secret,
          ...(opts.environment ? { environment: opts.environment } : {}),
          ...(opts.liveRoomCap !== undefined ? { liveRoomCap: opts.liveRoomCap } : {}),
          isDisabled: opts.isDisabled,
        },
        ...(opts.randomBytes ? { randomBytes: opts.randomBytes } : {}),
      });
      coreSecret = secret;
    }
    return core;
  };

  const emitMetrics = (metrics: Map<MetricName, number>): void => {
    const names = [...metrics.keys()].filter((n) => !isAggregatedMetric(n));
    if (names.length === 0) return;
    const record: Record<string, unknown> = {
      _aws: {
        Timestamp: now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [['Stage']],
            Metrics: names.map((name) => ({ Name: name, Unit: 'Count' })),
          },
        ],
      },
      Stage: opts.stage,
    };
    for (const name of names) record[name] = metrics.get(name);
    metricSink(JSON.stringify(record));
  };

  interface Target {
    api: ManagementApi | null;
    domain: string | undefined;
    stage: string | undefined;
  }

  /** Executes actions in order. Returns connections that turned out to be gone. */
  const execute = async (actions: Action[], t: Target, metrics: Map<MetricName, number>): Promise<string[]> => {
    const gone: string[] = [];
    for (const a of actions) {
      switch (a.kind) {
        case 'log':
          logger.log(a.event);
          break;
        case 'metric':
          metrics.set(a.name, (metrics.get(a.name) ?? 0) + a.value);
          for (const line of aggregator.record(a, now())) logger.log(line);
          break;
        case 'schedule':
          if (!opts.scheduler || !t.domain || !t.stage) break;
          try {
            await opts.scheduler.schedule(
              { c: a.connId, d: t.domain, s: t.stage },
              Math.min(MAX_SQS_DELAY_SECONDS, Math.max(0, Math.ceil(a.delayMs / 1000))),
            );
          } catch {
            // Fail open: without the delayed check the deadline is still enforced on the connection's next message.
            logger.log({ event: 'internal_error', code: 'internal' });
          }
          break;
        case 'send':
          if (!t.api) break;
          try {
            await t.api.postToConnection(a.connId, a.data);
          } catch (e) {
            if (isGoneError(e)) gone.push(a.connId);
            else logger.log({ event: 'internal_error', code: 'internal' });
          }
          break;
        case 'close':
          if (!t.api) break;
          // The Management API cannot choose a close code; the relay's reason is carried by the preceding error
          // message and the log line. The local server uses the real codes (4401, 4429, 4503, ...).
          try {
            await t.api.deleteConnection(a.connId);
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
  const run = async (actions: Action[], t: Target, metrics: Map<MetricName, number>): Promise<void> => {
    const c = await getCore();
    let pending = actions;
    for (let depth = 0; depth <= MAX_GONE_DEPTH; depth += 1) {
      const gone = [...new Set(await execute(pending, t, metrics))];
      if (gone.length === 0) return;
      pending = [];
      for (const connId of gone) {
        logger.log({ event: 'send_gone' });
        pending.push(...(await c.onDisconnect(connId, now())));
      }
    }
  };

  const flushAggregates = (): void => {
    for (const line of aggregator.flush(now())) logger.log(line);
  };

  async function handleApi(event: WsEvent): Promise<WsResult> {
    const rc = event.requestContext;
    const metrics = new Map<MetricName, number>();
    try {
      flushAggregates();
      const connId = rc.connectionId;
      if (!connId) {
        logger.log({ event: 'internal_error', code: 'internal' });
        return { statusCode: 400 };
      }
      const c = await getCore();
      let api: ManagementApi | null = null;
      if (rc.domainName && rc.stage) api = opts.apiFactory(`https://${rc.domainName}/${rc.stage}`);
      const target: Target = { api, domain: rc.domainName, stage: rc.stage };

      switch (rc.routeKey) {
        case '$connect': {
          const actions = await c.onConnect(connId, {
            origin: headerValue(event, 'origin'),
            sourceKey: rc.identity?.sourceIp ?? 'unknown',
            now: now(),
          });
          // The connection cannot be written to yet (GoneException before establishment), so only the handshake
          // status matters here: any close action means refuse, and nothing is scheduled. `api: null` turns sends
          // into no-ops while keeping the schedule target (domain and stage) for the delayed deadline check.
          const refused = actions.find((a) => a.kind === 'close');
          await run(refused ? actions.filter((a) => a.kind === 'log' || a.kind === 'metric') : actions, { ...target, api: null }, metrics);
          emitMetrics(metrics);
          if (refused && refused.kind === 'close') {
            if (refused.code === CLOSE.DISABLED) return { statusCode: 503 };
            if (refused.code === CLOSE.RATE_LIMITED) return { statusCode: 429 };
            return { statusCode: 403 };
          }
          return { statusCode: 200 };
        }
        case '$disconnect': {
          await run(await c.onDisconnect(connId, now()), target, metrics);
          emitMetrics(metrics);
          return { statusCode: 200 };
        }
        default: {
          // $default (and any other route key, which is treated as a frame). A base64 body is a binary frame:
          // only its size is read, it is never decoded.
          const frame =
            event.isBase64Encoded === true
              ? { binary: true as const, bytes: base64DecodedLength(event.body ?? '') }
              : (event.body ?? '');
          await run(await c.processInbound(frame, { connId, now: now() }), target, metrics);
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
  }

  async function handleDeadline(event: SqsEvent): Promise<SqsBatchResponse> {
    const failures: { itemIdentifier: string }[] = [];
    const metrics = new Map<MetricName, number>();
    flushAggregates();
    for (const rec of event.Records) {
      try {
        const body = parseDeadlineBody(rec.body);
        if (body === null) {
          // A malformed message can never become valid: drop it instead of retrying it into the dead-letter queue.
          // (Only this function and the relay function can send to the queue; this is defence in depth.)
          logger.log({ event: 'internal_error', code: 'internal' });
          continue;
        }
        const c = await getCore();
        const api = opts.apiFactory(`https://${body.d}/${body.s}`);
        await run(await c.onDeadlineCheck(body.c, now()), { api, domain: body.d, stage: body.s }, metrics);
      } catch {
        logger.log({ event: 'internal_error', code: 'internal' });
        failures.push({ itemIdentifier: rec.messageId });
      }
    }
    emitMetrics(metrics);
    return { batchItemFailures: failures };
  }

  return { handleApi, handleDeadline };
}

/** The API Gateway handler of the relay function. */
export function createRelayHandler(opts: RelayHandlerOptions): (event: WsEvent) => Promise<WsResult> {
  return createRelayRuntime(opts).handleApi;
}

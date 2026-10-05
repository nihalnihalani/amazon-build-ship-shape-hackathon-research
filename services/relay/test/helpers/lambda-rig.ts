import {
  createRelayRuntime,
  type DeadlineMessage,
  type DeadlineScheduler,
  type ManagementApi,
  type RelayHandlerOptions,
  type RelayRuntime,
  type SqsBatchResponse,
  type WsEvent,
  type WsResult,
} from '../../src/aws/handlers.js';
import { DynamoDbRoomStore } from '../../src/aws/dynamo-store.js';
import type { MessageType, RoomStore } from '../../src/core/index.js';
import { buildEnvelope, type SendOptions, type SenderState } from './envelope.js';
import { FakeDynamo } from './fake-dynamo.js';

export const DOMAIN = 'abc123xyz.execute-api.ap-south-1.amazonaws.com';
export const STAGE = 'staging';
export const PHONE_ORIGIN = 'https://d111111abcdef8.cloudfront.net';

export class GoneError extends Error {
  override name = 'GoneException';
  $metadata = { httpStatusCode: 410 };
}

interface Delivered {
  endpoint: string;
  connId: string;
  data: string;
}

/** A stand-in for the API Gateway Management API plus the sockets behind it. */
export class FakeManagementApi {
  readonly sent = new Map<string, string[]>();
  readonly deleted: string[] = [];
  readonly calls: Delivered[] = [];
  readonly endpoints: string[] = [];
  /** Connections API Gateway considers gone (stale in our table, closed on the wire). */
  readonly gone = new Set<string>();
  /** Connections whose DeleteConnection call fails with a non-Gone error. */
  readonly failDelete = new Set<string>();

  factory = (endpoint: string): ManagementApi => {
    this.endpoints.push(endpoint);
    return {
      postToConnection: async (connId, data) => {
        if (this.gone.has(connId)) throw new GoneError('gone');
        this.calls.push({ endpoint, connId, data });
        const list = this.sent.get(connId) ?? [];
        list.push(data);
        this.sent.set(connId, list);
      },
      deleteConnection: async (connId) => {
        if (this.gone.has(connId)) throw new GoneError('gone');
        if (this.failDelete.has(connId)) throw Object.assign(new Error('boom SECRET-ERROR-DETAIL'), { name: 'InternalFailure' });
        this.deleted.push(connId);
        this.gone.add(connId);
      },
    };
  };

  messages(connId: string): { type: MessageType; payload: Record<string, unknown>; raw: string }[] {
    return (this.sent.get(connId) ?? []).map((raw) => {
      const env = JSON.parse(raw) as { type: MessageType; payload: Record<string, unknown> };
      return { type: env.type, payload: env.payload, raw };
    });
  }
  of(connId: string, type: MessageType): { payload: Record<string, unknown>; raw: string }[] {
    return this.messages(connId).filter((m) => m.type === type);
  }
  errors(connId: string): string[] {
    return this.of(connId, 'error').map((m) => String(m.payload.code));
  }
}

/** Collects delayed deadline checks instead of sending them to SQS. `at` is the virtual time of queuing. */
export class FakeScheduler implements DeadlineScheduler {
  readonly sent: { message: DeadlineMessage; delaySeconds: number; at: number }[] = [];
  /** Every message ever queued, including those already delivered (for assertions about what was queued). */
  readonly history: { message: DeadlineMessage; delaySeconds: number; at: number }[] = [];
  failWith: Error | null = null;
  constructor(private readonly clock: () => number = () => 0) {}
  async schedule(message: DeadlineMessage, delaySeconds: number): Promise<void> {
    if (this.failWith) throw this.failWith;
    const entry = { message, delaySeconds, at: this.clock() };
    this.sent.push(entry);
    this.history.push(entry);
  }
}

export class LambdaClient implements SenderState {
  roomId: string | null = null;
  role: 'tv' | 'phone';
  generation = 0;
  nextSeq = 0;
  credential: string | null = null;
  constructor(
    readonly id: string,
    role: 'tv' | 'phone',
  ) {
    this.role = role;
  }
}

export interface LambdaRigOptions {
  store?: RoomStore;
  isDisabled?: () => boolean;
  allowedOrigins?: string[];
  overrides?: Partial<RelayHandlerOptions>;
}

export class LambdaRig {
  now = 1_800_000_000_000;
  readonly fake: FakeDynamo | null;
  readonly store: RoomStore;
  readonly api = new FakeManagementApi();
  readonly logs: string[] = [];
  readonly metricLines: string[] = [];
  disabled = false;
  readonly handler: (e: WsEvent) => Promise<WsResult>;
  readonly runtime: RelayRuntime;
  readonly scheduler = new FakeScheduler(() => this.now);
  private counter = 0;
  private sourceCounter = 0;

  constructor(o: LambdaRigOptions = {}) {
    if (o.store) {
      this.store = o.store;
      this.fake = null;
    } else {
      this.fake = new FakeDynamo();
      this.store = new DynamoDbRoomStore(this.fake, 'relay-test-table');
    }
    this.runtime = createRelayRuntime({
      store: this.store,
      phoneOrigins: o.allowedOrigins ?? [PHONE_ORIGIN],
      hashSecret: async () => 'lambda-test-secret-0123456789',
      isDisabled: o.isDisabled ?? (() => this.disabled),
      apiFactory: this.api.factory,
      scheduler: this.scheduler,
      stage: STAGE,
      now: () => this.now,
      logSink: (l) => this.logs.push(l),
      metricSink: (l) => this.metricLines.push(l),
      ...(o.overrides ?? {}),
    });
    this.handler = this.runtime.handleApi;
  }

  /** Delivers every queued deadline message whose delay has elapsed at `this.now`, as the SQS consumer would. */
  async deliverDeadlines(): Promise<SqsBatchResponse[]> {
    const out: SqsBatchResponse[] = [];
    const due = this.scheduler.sent.splice(0, this.scheduler.sent.length);
    for (const item of due) {
      out.push(await this.runtime.handleDeadline({ Records: [{ messageId: `m-${out.length}`, body: JSON.stringify(item.message) }] }));
    }
    return out;
  }

  /**
   * Delivers only the queued deadline messages whose SQS delay has elapsed at `this.now` (a real queue never delivers
   * earlier), keeping the rest queued.
   */
  async deliverDue(): Promise<SqsBatchResponse[]> {
    const out: SqsBatchResponse[] = [];
    const due = this.scheduler.sent.filter((e) => e.at + e.delaySeconds * 1000 <= this.now);
    for (const e of due) this.scheduler.sent.splice(this.scheduler.sent.indexOf(e), 1);
    for (const item of due) {
      out.push(await this.runtime.handleDeadline({ Records: [{ messageId: `d-${out.length}`, body: JSON.stringify(item.message) }] }));
    }
    return out;
  }

  event(routeKey: string, connId: string, extra: Partial<WsEvent> = {}, ctx: Record<string, unknown> = {}): WsEvent {
    return {
      requestContext: {
        routeKey,
        connectionId: connId,
        domainName: DOMAIN,
        stage: STAGE,
        identity: { sourceIp: '203.0.113.10' },
        ...ctx,
      },
      ...extra,
    };
  }

  /** $connect. On success the connection becomes reachable through the fake Management API. */
  async connect(connId: string, origin: string | null, extra: Partial<WsEvent> = {}): Promise<WsResult> {
    const headers = origin === null ? {} : { Origin: origin };
    this.sourceCounter += 1;
    const r = await this.handler(
      this.event('$connect', connId, { headers, ...extra }, { identity: { sourceIp: `10.1.${(this.sourceCounter >> 8) & 255}.${this.sourceCounter & 255}` } }),
    );
    if (r.statusCode === 200) this.api.gone.delete(connId);
    return r;
  }

  async disconnect(connId: string): Promise<WsResult> {
    const r = await this.handler(this.event('$disconnect', connId));
    this.api.gone.add(connId);
    return r;
  }

  async message(connId: string, body: string, extra: Partial<WsEvent> = {}): Promise<WsResult> {
    return this.handler(this.event('$default', connId, { body, isBase64Encoded: false, ...extra }));
  }

  build(c: SenderState, type: MessageType, o: SendOptions = {}): string {
    return buildEnvelope(c, type, this.now, o);
  }

  async send(c: LambdaClient, type: MessageType, o: SendOptions = {}): Promise<WsResult> {
    return this.message(c.id, this.build(c, type, o));
  }

  async tvCreate(): Promise<LambdaClient> {
    this.counter += 1;
    const tv = new LambdaClient(`tv-${this.counter}`, 'tv');
    expectOk(await this.connect(tv.id, null));
    await this.send(tv, 'room.create');
    const created = this.api.of(tv.id, 'room.created').at(-1);
    if (!created) throw new Error('no room.created');
    tv.roomId = created.payload.room_id as string;
    tv.credential = created.payload.tv_credential as string;
    tv.generation = created.payload.generation as number;
    tv.nextSeq = 0;
    return tv;
  }

  async pair(tv: LambdaClient): Promise<LambdaClient> {
    this.counter += 1;
    const phone = new LambdaClient(`phone-${this.counter}`, 'phone');
    const code = (this.api.of(tv.id, 'room.created').at(-1) ?? this.api.of(tv.id, 'pairing.code').at(-1))?.payload.pairing_code as string;
    expectOk(await this.connect(phone.id, PHONE_ORIGIN));
    await this.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    const requested = this.api.of(tv.id, 'join.requested').at(-1);
    if (!requested) throw new Error('no join.requested');
    await this.send(tv, 'join.confirm', { payload: { join_id: requested.payload.join_id as string, decision: 'accept' } });
    const accepted = this.api.of(phone.id, 'join.accepted').at(-1);
    if (!accepted) throw new Error('no join.accepted');
    phone.roomId = accepted.payload.room_id as string;
    phone.credential = accepted.payload.phone_credential as string;
    phone.generation = accepted.payload.generation as number;
    phone.nextSeq = 0;
    return phone;
  }
}

function expectOk(r: WsResult): void {
  if (r.statusCode !== 200) throw new Error(`expected 200, got ${r.statusCode}`);
}

import { expect } from 'vitest';
import { DynamoDbRoomStore } from '../../src/aws/dynamo-store.js';
import {
  MemoryRoomStore,
  RelayCore,
  createRedactingLogger,
  parseWireText,
  type Action,
  type MessageType,
  type RelayConfig,
  type RandomBytes,
  type RoomStore,
  type RawFrame,
  type Role,
} from '../../src/core/index.js';
import { buildEnvelope, uid, type SendOptions } from './envelope.js';
import { FakeDynamo } from './fake-dynamo.js';

export { uid, type SendOptions };

export const PHONE_ORIGIN = 'https://phone.example.test';
export const TV_PREVIEW_ORIGIN = 'https://tv-preview.example.test';
export const FOREIGN_ORIGIN = 'https://evil.example.test';
export const T0 = 1_800_000_000_000;

export interface Received {
  type: MessageType;
  raw: string;
  env: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export class Client {
  inbox: Received[] = [];
  closed: { code: number; reason: string } | null = null;
  nextSeq = 0;
  generation = 0;
  roomId: string | null = null;
  credential: string | null = null;
  role: Role | null = null;
  constructor(
    readonly id: string,
    readonly rig: Rig,
  ) {}

  /** Messages of a type received so far. */
  of(type: MessageType): Received[] {
    return this.inbox.filter((m) => m.type === type);
  }
  last(type: MessageType): Received {
    const l = this.of(type).at(-1);
    if (!l) throw new Error(`no ${type} received by ${this.id}; got [${this.inbox.map((m) => m.type).join(',')}]`);
    return l;
  }
  errors(): string[] {
    return this.of('error').map((m) => String(m.payload.code));
  }
  lastError(): Received {
    return this.last('error');
  }
  clear(): void {
    this.inbox = [];
  }
}

/** Every rig created in this test file; afterAll hooks scan all of their log output. */
export const allRigs: Rig[] = [];

export function assertAllRigsNoLeaks(extraSecrets: string[] = []): void {
  for (const r of allRigs) r.assertNoLeaks(extraSecrets);
}

export class Rig {
  now = T0;
  /**
   * The store under test. Test files that import a suite after setting `globalThis.__ATR_STORE = 'dynamo'` run the
   * identical scenarios against DynamoDbRoomStore on top of the strict FakeDynamo model.
   */
  readonly fake: FakeDynamo | null;
  readonly store: RoomStore;
  readonly logs: string[] = [];
  readonly metrics: { name: string; value: number }[] = [];
  readonly clients = new Map<string, Client>();
  /** Every secret the relay minted (credentials, codes) plus sentinel strings: none may appear in logs. */
  readonly secrets = new Set<string>();
  readonly core: RelayCore;
  disabled = false;
  private readonly logger = createRedactingLogger((l) => this.logs.push(l));
  private connCounter = 0;

  constructor(
    overrides: Partial<RelayConfig> = {},
    options: { randomBytes?: RandomBytes } = {},
  ) {
    allRigs.push(this);
    if ((globalThis as { __ATR_STORE?: string }).__ATR_STORE === 'dynamo') {
      this.fake = new FakeDynamo();
      this.store = new DynamoDbRoomStore(this.fake, 'relay-test');
    } else {
      this.fake = null;
      this.store = new MemoryRoomStore();
    }
    this.core = new RelayCore({
      store: this.store,
      config: {
        allowedOrigins: [PHONE_ORIGIN, TV_PREVIEW_ORIGIN],
        hashPepper: 'test-pepper',
        isDisabled: () => this.disabled,
        ...overrides,
      },
      ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
    });
  }

  advance(ms: number): void {
    this.now += ms;
  }

  /** Opens a connection. `origin: null` means the Origin header is absent. */
  async connectionCount(): Promise<number> {
    return (await this.store.listConnections()).length;
  }

  async connect(origin: string | null = null, source = '198.51.100.7'): Promise<Client> {
    this.connCounter += 1;
    const c = new Client(`conn-${this.connCounter}`, this);
    this.clients.set(c.id, c);
    const actions = await this.core.onConnect(c.id, { origin, sourceKey: source, now: this.now });
    await this.exec(actions);
    return c;
  }

  /** Mimics an adapter: deliver sends, mark closes, route log/metric actions. */
  async exec(actions: Action[]): Promise<void> {
    const closes: string[] = [];
    for (const a of actions) {
      if (a.kind === 'send') {
        const target = this.clients.get(a.connId);
        if (target && !target.closed) {
          const parsed = JSON.parse(a.data) as Record<string, unknown>;
          target.inbox.push({
            type: parsed.type as MessageType,
            raw: a.data,
            env: parsed,
            payload: parsed.payload as Record<string, unknown>,
          });
        }
      } else if (a.kind === 'close') {
        const target = this.clients.get(a.connId);
        if (target && !target.closed) {
          target.closed = { code: a.code, reason: a.reason };
          closes.push(a.connId);
        }
      } else if (a.kind === 'log') {
        this.logger.log(a.event);
      } else {
        this.metrics.push({ name: a.name, value: a.value });
      }
    }
    // A real socket close fires onDisconnect afterwards: must be idempotent with the core's own cleanup.
    for (const id of closes) {
      await this.exec(await this.core.onDisconnect(id, this.now));
    }
  }

  buildMessage(c: Client, type: MessageType, o: SendOptions = {}): string {
    return buildEnvelope(c, type, this.now, o);
  }

  async send(c: Client, type: MessageType, o: SendOptions = {}): Promise<void> {
    await this.sendRaw(c, this.buildMessage(c, type, o));
  }

  async sendRaw(c: Client, raw: RawFrame): Promise<void> {
    const actions = await this.core.onMessage(c.id, raw, this.now);
    await this.exec(actions);
    for (const cl of this.clients.values()) this.observe(cl);
  }

  /** Records minted secrets from whatever the connection just received. */
  private observe(c: Client): void {
    for (const m of c.inbox) {
      const p = m.payload;
      for (const k of ['tv_credential', 'phone_credential', 'pairing_code']) {
        if (typeof p[k] === 'string') this.secrets.add(p[k] as string);
      }
      if (typeof p.room_id === 'string') c.roomId = p.room_id;
    }
  }

  async tick(ms = 0): Promise<void> {
    this.now += ms;
    await this.exec(await this.core.onTick(this.now));
    for (const c of this.clients.values()) this.observe(c);
  }

  // ---- flows ---------------------------------------------------------------------------------

  /** TV connects (no Origin, as a native Vega client) and creates a room. */
  async tvCreate(origin: string | null = null, source?: string): Promise<Client> {
    const tv = await this.connect(origin, source);
    tv.role = 'tv';
    await this.send(tv, 'room.create');
    const created = tv.last('room.created');
    tv.roomId = created.payload.room_id as string;
    tv.credential = created.payload.tv_credential as string;
    tv.generation = created.payload.generation as number;
    tv.nextSeq = 0;
    return tv;
  }

  /** Phone joins using the TV's pairing code and the TV accepts. Returns the authenticated phone. */
  async pair(tv: Client, o: { deviceLabel?: string; source?: string } = {}): Promise<Client> {
    const latest = tv.inbox.filter((m) => m.type === 'room.created' || m.type === 'pairing.code').at(-1);
    if (!latest) throw new Error('TV has no pairing code');
    const code = latest.payload.pairing_code;
    const phone = await this.connect(PHONE_ORIGIN, o.source);
    phone.role = 'phone';
    await this.send(phone, 'join.request', {
      payload: { pairing_code: code as string, device_label: o.deviceLabel ?? 'Test phone' },
    });
    const requested = tv.last('join.requested');
    await this.send(tv, 'join.confirm', {
      payload: { join_id: requested.payload.join_id as string, decision: 'accept' },
    });
    const accepted = phone.last('join.accepted');
    phone.roomId = accepted.payload.room_id as string;
    phone.credential = accepted.payload.phone_credential as string;
    phone.generation = accepted.payload.generation as number;
    phone.nextSeq = 0;
    return phone;
  }

  async startSession(tv: Client, session = 's_session000001'): Promise<void> {
    await this.send(tv, 'session.begin', { session });
  }

  /** Scan every log line for secrets, bodies and field names; throws via expect on a leak. */
  assertNoLeaks(extraSecrets: string[] = []): void {
    assertNoLeaks(this.logs, [...this.secrets, ...extraSecrets]);
  }
}

const FORBIDDEN_FIELD_NAMES = [
  'payload',
  'phrase',
  'phrases',
  'text',
  'cue',
  'credential',
  'tv_credential',
  'phone_credential',
  'pairing_code',
  'device_label',
  'dbfs',
  'message_id',
  'ip',
  'origin',
];
const ALLOWED_LOG_KEYS = new Set(['event', 'code', 'type', 'bytes', 'role', 'room', 'latency_ms']);

export function assertNoLeaks(lines: readonly string[], secrets: readonly string[]): void {
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const k of Object.keys(parsed)) {
      expect(ALLOWED_LOG_KEYS.has(k), `log key "${k}" is not on the allowlist: ${line}`).toBe(true);
      expect(FORBIDDEN_FIELD_NAMES.includes(k), `forbidden log key ${k}`).toBe(false);
    }
    if (typeof parsed.room === 'string') expect(parsed.room).toMatch(/^[0-9a-f]{8}$/);
    for (const s of secrets) {
      if (s.length >= 4) expect(line.includes(s), `log line leaks a secret: ${line}`).toBe(false);
    }
  }
}

export function parseRelayMessage(raw: string): ReturnType<typeof parseWireText> {
  return parseWireText(raw, JSON.parse(raw).event_timestamp as number);
}

/**
 * QA review rig (independent of packages/session-core/test/helpers.ts).
 *
 * Everything here is written for the QA review of T11/T13/T14:
 *   - a fake clock, a fake transport that records what the TV sends (parsed JSON),
 *   - a fake disk (StoragePort) with fault injection and foreign keys,
 *   - a scripted relay and phone that build PROTOCOL.md-shaped frames with @atr/protocol's MessageFactory
 *     (validated by the shared validators before they are handed to the TV).
 *
 * Evidence class of anything produced through this rig: automated (pure state machine). It says nothing
 * about microphone validity, Vega behaviour or a deployed relay.
 */
import { createIdFactory, MessageFactory, quantizeCoverage, quantizeDb } from '@atr/protocol';
import type { MessageType, PayloadMap } from '@atr/protocol';
import { createSessionStore } from '@atr/session-core';
import type {
  ActionId,
  ClockPort,
  LinkView,
  RemoteKey,
  SessionStore,
  StoragePort,
  SummaryView,
  TransportPort,
  TvView,
} from '@atr/session-core';

/* ------------------------------------------------------------------ small deterministic helpers */

/** splitmix32-based byte source: unique, reproducible identifiers per seed. */
export function bytesFromSeed(seed: number): (n: number) => Uint8Array {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = next() & 0xff;
    return out;
  };
}

export const DAY = 86_400_000;
export const START = Date.UTC(2026, 9, 5, 12, 0, 0);

export class Clock implements ClockPort {
  t: number;
  constructor(start = START) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  localDate(epochMs: number): string {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

export interface Sent {
  type: string;
  payload: Record<string, unknown>;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: string;
  producer_generation: number;
  sequence: number;
}

export class Wire implements TransportPort {
  sent: Sent[] = [];
  /** Frames the TV tried to send while the socket was not open (the real adapter returns false and drops them). */
  dropped: Sent[] = [];
  connects: string[] = [];
  closes: string[] = [];
  /** Mirrors the socket: false between link loss and the next 'connected'. */
  open = true;
  connect(url: string): void {
    this.connects.push(url);
  }
  send(serialized: string): boolean {
    const parsed = JSON.parse(serialized) as Sent;
    if (!this.open) {
      this.dropped.push(parsed);
      return false;
    }
    this.sent.push(parsed);
    return true;
  }
  close(reason: string): void {
    this.closes.push(reason);
  }
  of(type: string): Sent[] {
    return this.sent.filter((m) => m.type === type);
  }
}

/** In-memory disk with foreign keys, lying removals and write logging. */
export class Disk implements StoragePort {
  readonly map = new Map<string, string>();
  /** Keys whose removal is silently ignored (a lying store). */
  refuseRemove = new Set<string>();
  /** When true multiRemove rejects without removing anything. */
  failMultiRemove = false;
  writes: string[] = [];
  /** setItem rejects (disk full) for keys that start with this prefix. */
  failSetPrefix: string | null = null;
  /** Simulated process death: after this key is written every later write and removal is lost. */
  dieAfterWriteOf: string | null = null;
  /** Same, matching by key prefix (for keys that carry a generated id). */
  dieAfterWritePrefix: string | null = null;
  dead = false;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.map.has(key) ? (this.map.get(key) as string) : null);
  }
  setItem(key: string, value: string): Promise<void> {
    if (this.dead) return Promise.resolve();
    if (this.failSetPrefix !== null && key.startsWith(this.failSetPrefix)) return Promise.reject(new Error('disk full'));
    this.writes.push(key);
    this.map.set(key, value);
    if (this.dieAfterWriteOf === key || (this.dieAfterWritePrefix !== null && key.startsWith(this.dieAfterWritePrefix))) this.dead = true;
    return Promise.resolve();
  }
  removeItem(key: string): Promise<void> {
    if (this.dead) return Promise.resolve();
    if (!this.refuseRemove.has(key)) this.map.delete(key);
    return Promise.resolve();
  }
  getAllKeys(): Promise<readonly string[]> {
    return Promise.resolve([...this.map.keys()]);
  }
  multiRemove(keys: readonly string[]): Promise<void> {
    if (this.dead) return Promise.resolve();
    if (this.failMultiRemove) return Promise.reject(new Error('disk refused removal'));
    for (const k of keys) if (!this.refuseRemove.has(k)) this.map.delete(k);
    return Promise.resolve();
  }
  /** The next launch: the same bytes, a live process. */
  revive(): this {
    this.dead = false;
    this.dieAfterWriteOf = null;
    this.dieAfterWritePrefix = null;
    return this;
  }
  atrKeys(): string[] {
    return [...this.map.keys()].filter((k) => k.startsWith('atr:'));
  }
  json(key: string): unknown {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
  }
  /** One string with every stored value, for secret scans. */
  allText(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
  }
}

/* ------------------------------------------------------------------ constants of the scripted phone/relay */

export const ROOM = 'r_qareviewroom00001';
export const CREDENTIAL = 'QACRED0123456789'.padEnd(43, 'x');
export const PAIRING_CODE = 'ACDEFH';
/** Two digits the relay sends in join.requested and the phone shows; the TV offers them among two decoys (A3-06). */
export const CONFIRM_DIGITS = '42';
export const FLOOR = -50;

/** Settings and meta keys for a disk that should boot straight to Home (onboarded), with optional overrides. */
export function seededSettings(over: Record<string, unknown> = {}): Record<string, string> {
  return {
    'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: START }),
    'atr:v1:settings': JSON.stringify({
      familyMode: false,
      cueWord: null,
      measurementMode: 'relative_band',
      onboarded: true,
      qualification: 'not_run',
      quietLeadMs: null,
      quietLeadScreenReaderMs: null,
      ...over,
    }),
  };
}
export const BAND_MARGIN = 20;
/** Reached when p95_active - floor >= margin - 1. With margin 20 the edge is 19 dB above the floor. */
export const EDGE_REL = BAND_MARGIN - 1;

/** Ten household phrases without digits or result vocabulary (so text scans stay meaningful). */
export const PHRASES: readonly string[] = [
  'Pass the salt please',
  'Open the window',
  'Where is my coat',
  'Call me at noon',
  'The kettle is hot',
  'Please close the door',
  'Turn the radio down',
  'I will wait outside',
  'Bring the umbrella',
  'Thank you for dinner',
];

export type MicStateName = PayloadMap['mic.state']['state'];
export type WindowReasonName = NonNullable<PayloadMap['window.result']['invalid_reason']>;

export interface AttemptOpts {
  /** p95_active relative to the session floor (dB). Default 25 (reached against an edge of 19). */
  rel?: number;
  valid?: boolean;
  reason?: WindowReasonName;
  /** Pre-window floor relative to the session floor. */
  rise?: number;
  /** dBFS level frames to stream during capture (one per 50 ms frame index). */
  levels?: number[];
  coverage?: number;
  activeMs?: number;
  /** Clock advance between window.start and window.result. */
  captureMs?: number;
}

export interface RigOptions {
  disk?: Disk;
  clock?: Clock;
  seed?: number;
  fixtureMode?: boolean;
}

export class Rig {
  clock: Clock;
  wire = new Wire();
  disk: Disk;
  store!: SessionStore;
  /** Every view after every dispatch made through this rig. */
  trace: { step: string; view: TvView }[] = [];
  /** Distinct views emitted by the store to subscribers. */
  emitted: TvView[] = [];
  private phone: MessageFactory;
  private relay: MessageFactory;
  private readonly seed: number;

  constructor(private readonly opts: RigOptions = {}) {
    this.clock = opts.clock ?? new Clock();
    this.disk = opts.disk ?? new Disk();
    this.seed = opts.seed ?? 1;
    const clock = (): number => this.clock.now();
    this.phone = new MessageFactory({
      role: 'phone',
      idFactory: createIdFactory(bytesFromSeed(this.seed * 7919 + 11)),
      clock,
      roomId: ROOM,
      generation: 1,
    });
    this.relay = new MessageFactory({
      role: 'relay',
      idFactory: createIdFactory(bytesFromSeed(this.seed * 104729 + 13)),
      clock,
      roomId: ROOM,
    });
  }

  async boot(): Promise<this> {
    this.store = createSessionStore({
      clock: this.clock,
      storage: this.disk,
      transport: this.wire,
      relayUrl: 'https://relay.qa.test/ws',
      randomBytes: bytesFromSeed(this.seed),
      appVersion: '0.1.0-qa',
      platform: 'test',
      fixtureMode: this.opts.fixtureMode,
    });
    this.store.subscribe((v) => this.emitted.push(v));
    await this.settle();
    this.snap('boot');
    return this;
  }

  /** Lets queued storage writes complete. */
  async settle(): Promise<void> {
    await this.store.ready();
    await new Promise((r) => setTimeout(r, 0));
    await this.store.ready();
  }

  get view(): TvView {
    return this.store.getView();
  }

  private snap(step: string): void {
    this.trace.push({ step, view: this.store.getView() });
  }

  /* ----------------------------- inputs from the speaker */

  ui(action: ActionId): void {
    this.store.dispatch({ kind: 'ui', action });
    this.snap(`ui:${action}`);
  }
  key(key: RemoteKey): void {
    this.store.dispatch({ kind: 'remote', key });
    this.snap(`key:${key}`);
  }
  ok(): void {
    this.key('ok');
  }
  /** Screen reader state read from the platform (A8-02): lengthens the quiet lead and adds the spoken script. */
  screenReader(on: boolean): void {
    this.store.dispatch({ kind: 'a11y', screenReader: on });
    this.snap(`a11y:${on}`);
  }
  back(): void {
    this.key('back');
  }
  link(state: LinkView): void {
    this.wire.open = state === 'connected';
    this.store.dispatch({ kind: 'transport', state });
    this.snap(`link:${state}`);
  }
  tick(): void {
    this.store.dispatch({ kind: 'timer', now: this.clock.now() });
    this.snap('tick');
  }
  advance(ms: number): void {
    this.clock.t += ms;
    this.tick();
  }
  actionIds(): ActionId[] {
    return this.view.actions.filter((a) => a.disabled !== true).map((a) => a.id);
  }

  /* ----------------------------- TV -> phone traffic */

  last(type: string): Sent {
    const all = this.wire.of(type);
    const m = all[all.length - 1];
    if (!m) throw new Error(`TV sent no ${type}; sent: ${this.wire.sent.map((x) => x.type).join(',')}`);
    return m;
  }
  count(type: string): number {
    return this.wire.of(type).length;
  }

  /* ----------------------------- relay frames (R -> T) */

  relaySend<T extends MessageType>(type: T, payload: PayloadMap[T]): void {
    const frame = this.relay.serialize(this.relay.next(type, payload));
    this.store.dispatch({ kind: 'wire', message: frame });
    this.snap(`relay:${type}`);
  }

  /** A relay frame delivered as a parsed OBJECT instead of the raw text frame (PK-09: the TV must refuse it). */
  relayObject<T extends MessageType>(type: T, payload: PayloadMap[T]): void {
    const parsed = JSON.parse(this.relay.serialize(this.relay.next(type, payload))) as unknown;
    this.store.dispatch({ kind: 'wire', message: parsed as unknown as string });
    this.snap(`relay-object:${type}`);
  }

  /** Same idea for a binary frame. */
  relayBinary<T extends MessageType>(type: T, payload: PayloadMap[T]): void {
    const bytes = new TextEncoder().encode(this.relay.serialize(this.relay.next(type, payload)));
    this.store.dispatch({ kind: 'wire', message: bytes as unknown as string });
    this.snap(`relay-binary:${type}`);
  }

  roomCreated(): void {
    this.relaySend('room.created', {
      room_id: ROOM,
      pairing_code: PAIRING_CODE,
      code_expires_at: this.clock.now() + 600_000,
      tv_credential: CREDENTIAL,
      credential_expires_at: this.clock.now() + 2 * 3_600_000,
      generation: 1,
    });
  }
  joinRequested(): void {
    this.relaySend('join.requested', {
      join_id: 'j_qareview0000001',
      device_label: 'QA phone',
      confirm_digits: CONFIRM_DIGITS,
      expires_at: this.clock.now() + 60_000,
    });
  }
  /** The three choices on the join screen, in display order (the view never says which is right). */
  choices(): [string, string, string] {
    const c = this.view.pairing?.joinRequest?.choices;
    if (c === undefined) throw new Error(`no join request on screen (stage ${this.view.stage}, screen ${this.view.screen})`);
    return c;
  }
  /** Number matching: press the choice that equals the digits the relay sent (what the phone shows). */
  pickJoin(digits: string = CONFIRM_DIGITS): void {
    const index = this.choices().indexOf(digits);
    if (index < 0) throw new Error(`the real digits ${digits} are not among ${this.choices().join(', ')}`);
    this.ui(`pick_choice_${index + 1}` as ActionId);
  }
  /** A wrong pick: the first choice that is not the real digits. */
  pickWrong(digits: string = CONFIRM_DIGITS): void {
    const index = this.choices().findIndex((c) => c !== digits);
    this.ui(`pick_choice_${index + 1}` as ActionId);
  }
  peer(connected: boolean, generation = 1): void {
    this.relaySend('peer.state', { role: 'phone', connected, generation });
  }
  relayError(code: PayloadMap['error']['code']): void {
    this.relaySend('error', { code, ref_message_id: null, detail: '' });
  }
  /** Rotated TV credentials handed out by auth.ok (revision 4): NEXT0001..., 43 base64url characters each. */
  rotated: string[] = [];
  /** auth.ok carries the rotated credential the TV must present on its NEXT auth.resume. */
  authOk(peerConnected = true, next?: string): void {
    const credential = next ?? `NEXT${String(this.rotated.length + 1).padStart(4, '0')}`.padEnd(43, 'y');
    this.rotated.push(credential);
    this.relaySend('auth.ok', {
      role: 'tv',
      generation: 2,
      peer_connected: peerConnected,
      phone_paired: true,
      next_credential: credential,
    });
  }

  /* ----------------------------- phone frames (P -> T) */

  phoneSend<T extends MessageType>(
    type: T,
    payload: PayloadMap[T],
    ids: { s?: string | null; w?: string | null; a?: string | null } = {},
  ): void {
    const msg = this.phone.next(type, payload, {
      session_id: ids.s ?? null,
      window_id: ids.w ?? null,
      attempt_id: ids.a ?? null,
    });
    this.store.dispatch({ kind: 'wire', message: this.phone.serialize(msg) });
    this.snap(`phone:${type}`);
  }

  /** Same frame delivered twice (duplicate delivery): the TV must drop the second silently. */
  phoneSendTwice<T extends MessageType>(
    type: T,
    payload: PayloadMap[T],
    ids: { s?: string | null; w?: string | null; a?: string | null } = {},
  ): void {
    const msg = this.phone.next(type, payload, {
      session_id: ids.s ?? null,
      window_id: ids.w ?? null,
      attempt_id: ids.a ?? null,
    });
    const frame = this.phone.serialize(msg);
    this.store.dispatch({ kind: 'wire', message: frame });
    this.store.dispatch({ kind: 'wire', message: frame });
    this.snap(`phone:${type}x2`);
  }

  private forged = 0;
  /**
   * A phone frame built by hand, for values the MessageFactory refuses to build (off-grid numbers, missing
   * fields). The TV validates it exactly as a relay would; it must drop it without changing state.
   */
  forge(type: string, payload: Record<string, unknown>, ids: { s?: string | null; w?: string | null; a?: string | null } = {}): void {
    this.forged += 1;
    this.rawFrame(
      JSON.stringify({
        protocol_version: 1,
        type,
        message_id: `m_forged${String(this.forged).padStart(8, '0')}abcd`,
        room_id: ROOM,
        session_id: ids.s ?? null,
        window_id: ids.w ?? null,
        attempt_id: ids.a ?? null,
        sender_role: 'phone',
        producer_generation: 1,
        sequence: 10_000 + this.forged,
        event_timestamp: this.clock.now(),
        payload,
      }),
    );
  }

  /** Raw frame, for messages the factory would refuse to build. */
  rawFrame(frame: string): void {
    this.store.dispatch({ kind: 'wire', message: frame });
    this.snap('raw');
  }

  /** DEF-003: the phone acks each session.begin as applied before it reports anything; mic.state then names the session. */
  private ackedBegins = new Set<string>();
  private phoneSession: string | null = null;

  ackBegins(): void {
    for (const m of this.wire.of('session.begin')) {
      if (this.ackedBegins.has(m.message_id)) continue;
      this.ackedBegins.add(m.message_id);
      this.phoneSend('ack', { acked_message_id: m.message_id, outcome: 'applied', detail: '' }, { s: m.session_id });
      this.phoneSession = m.session_id;
    }
  }

  mic(state: MicStateName, mode: PayloadMap['mic.state']['mode'] = 'physical_phone'): void {
    this.ackBegins();
    this.phoneSend('mic.state', {
      state,
      settings: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 },
      supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
      wake_lock: 'held',
      visibility: 'visible',
      mode,
    }, { s: this.phoneSession });
  }

  private idsOf(cmd: Sent): { s: string | null; w: string | null; a: string | null } {
    return { s: cmd.session_id, w: cmd.window_id, a: cmd.attempt_id };
  }

  /** Revision 4 grid: dB fields are multiples of 0.1, coverage of 0.001, times are integers (quantizeDb / quantizeCoverage). */
  precheckResult(
    rise = 0,
    over: Partial<PayloadMap['precheck.result']> = {},
    cmd?: Sent,
    /** Take the envelope ids from another command (to test per-measurement window binding). */
    idsFrom?: Sent,
  ): void {
    const start = cmd ?? this.last('precheck.start');
    const purpose = start.payload['purpose'] as 'quiet_check' | 'pre_window';
    const floor = quantizeDb(FLOOR + (purpose === 'quiet_check' ? 0 : rise));
    const frames = purpose === 'quiet_check' ? 100 : 40;
    this.phoneSend(
      'precheck.result',
      {
        purpose,
        valid: true,
        invalid_reason: null,
        floor_dbfs: floor,
        p20_dbfs: quantizeDb(floor - 1),
        p80_dbfs: quantizeDb(floor + 1),
        p95_dbfs: quantizeDb(floor + 3),
        frame_count: frames,
        expected_frames: frames,
        coverage: quantizeCoverage(1),
        clipped_frames: 0,
        nonfinite_frames: 0,
        duration_ms: purpose === 'quiet_check' ? 5000 : 2000,
        ...over,
      },
      this.idsOf(idsFrom ?? start),
    );
  }

  /** A muted or blocked microphone: floor below -110 dBFS, reason silent_input (revision 4, A1-05). */
  silentPrecheck(cmd?: Sent): void {
    this.precheckResult(
      0,
      {
        valid: false,
        invalid_reason: 'silent_input',
        floor_dbfs: -130,
        p20_dbfs: -131,
        p80_dbfs: -129,
        p95_dbfs: -128,
      },
      cmd,
    );
  }

  windowResultPayload(kind: 'calibration' | 'vowel' | 'phrase', o: AttemptOpts = {}): PayloadMap['window.result'] {
    const valid = o.valid !== false;
    const rel = o.rel ?? 25;
    const active = o.activeMs ?? 2500;
    // The TV re-checks timing (A1-09): a window may not report more than the commanded maximum (+500 ms), and the
    // frame counts must agree with the duration. Calibration is commanded for 6000 ms, phrase and vowel report 8000.
    const durationMs = kind === 'calibration' ? 6000 : 8000;
    const frames = Math.floor(durationMs / 50);
    return {
      kind,
      valid,
      invalid_reason: valid ? null : (o.reason ?? 'no_voice'),
      frame_count: frames,
      expected_frames: frames,
      coverage: quantizeCoverage(o.coverage ?? 1),
      active_ms: Math.round(active),
      longest_active_ms: Math.round(active),
      segments: 1,
      onset_ms: 200,
      p50_active_dbfs: quantizeDb(FLOOR + rel - 4),
      p95_active_dbfs: valid ? quantizeDb(FLOOR + rel) : null,
      peak_dbfs: quantizeDb(FLOOR + rel + 2),
      clipped_frames: 0,
      nonfinite_frames: 0,
      duration_ms: durationMs,
    };
  }

  windowResult(o: AttemptOpts = {}, cmd?: Sent): void {
    const start = cmd ?? this.last('window.start');
    const kind = start.payload['kind'] as 'calibration' | 'vowel' | 'phrase';
    this.phoneSend('window.result', this.windowResultPayload(kind, o), this.idsOf(start));
  }

  level(frameIndex: number, dbfs: number, active = true, clipped = false, cmd?: Sent): void {
    const start = cmd ?? this.last('window.start');
    this.phoneSend(
      'level',
      { frame_index: frameIndex, t_audio_ms: frameIndex * 50, dbfs: quantizeDb(dbfs), active, clipped },
      this.idsOf(start),
    );
  }

  /**
   * DEF-007: the fake phone starts measuring. Its first level frame (frame 0) is what moves the TV from "starting the
   * phone's measurement" into its capture phase (prompt, timer, stop control).
   */
  startMeasuring(cmd?: Sent, dbfs: number = FLOOR + 2): void {
    this.level(0, dbfs, true, false, cmd);
  }

  listenerResponse(response: 'heard' | 'not_heard', cmd?: Sent): void {
    const open = cmd ?? this.last('listener.open');
    this.phoneSend('listener.response', { response }, this.idsOf(open));
  }

  cue(text: string, sessionId?: string): void {
    const sid = sessionId ?? this.last('session.begin').session_id;
    this.phoneSend('cue', { text }, { s: sid });
  }

  phrasesUpdate(list: string[]): void {
    this.phoneSend('phrases.update', { phrases: list });
  }

  /* ----------------------------- journeys */

  /** Home (onboarded) -> optional family toggle -> Start session -> pairing -> phone joined -> mic open. */
  async toQuietReady(opts: { family?: boolean; bank?: readonly string[] } = {}): Promise<void> {
    if (this.view.screen === 'onboarding') this.ui('continue');
    if (opts.family === true) {
      this.ui('open_settings');
      this.ui('toggle_family_mode');
      this.ui('back');
    }
    this.ui('start_session');
    this.link('connected');
    this.roomCreated();
    this.joinRequested();
    this.pickJoin();
    this.peer(true);
    this.mic('permission_pending');
    this.mic('open_idle');
    if (opts.bank !== undefined) this.phrasesUpdate([...opts.bank]);
  }

  quietCheck(): void {
    this.ui('begin_quiet_check');
    this.advance(1500);
    this.precheckResult();
  }

  calibrate(rel = BAND_MARGIN): void {
    this.ui('begin_calibration');
    this.advance(1500);
    this.windowResult({ rel });
  }

  /** From calibration result through the skipped sustained-sound step to the first phrase_ready. */
  toPhrases(): void {
    this.ui('continue');
    this.ui('skip_vowel');
  }

  async setupToPhrases(opts: { family?: boolean; bank?: readonly string[] } = {}): Promise<void> {
    await this.toQuietReady(opts);
    this.quietCheck();
    this.calibrate();
    this.toPhrases();
  }

  /**
   * One phrase attempt from phrase_ready through the phone's window.result. Leaves the machine wherever the
   * result sends it (reveal, response_pending, paused_or_invalid). Returns the view during capture.
   */
  attempt(o: AttemptOpts = {}): TvView | null {
    this.ui('begin_phrase');
    this.advance(1500);
    this.precheckResult(o.rise ?? 0);
    if (this.view.stage !== 'phrase_active') return null;
    const start = this.last('window.start');
    // DEF-007: the TV enters its capture phase on the FIRST level frame of the window, so the fake phone starts
    // measuring (sends frame 0) right after window.start and the capture view is read once that frame has arrived.
    const levels = o.levels ?? [FLOOR + 2];
    let frame = 0;
    let captureView = this.view;
    for (const db of levels) {
      this.level(frame, db, true, false, start);
      if (frame === 0) captureView = this.view;
      frame += 1;
    }
    this.advance(o.captureMs ?? 400);
    this.windowResult(o, start);
    return captureView;
  }

  /** Summary view after Done is not needed: the summary stays on screen until Done is pressed. */
  summary(): SummaryView {
    const s = this.view.summary;
    if (s === null) throw new Error(`no summary on stage ${this.view.stage}`);
    return s;
  }
}

/* ------------------------------------------------------------------ view scanning */

/** Every string value in a JSON-like structure (keys excluded). */
export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

/** Every key path in a JSON-like structure. */
export function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** Strings a screen shows or announces, minus the user's literal phrase text. */
export function visibleStrings(view: TvView): string[] {
  const copy = JSON.parse(JSON.stringify(view)) as TvView;
  if (copy.phrase !== null) copy.phrase.text = '';
  return allStrings(copy);
}

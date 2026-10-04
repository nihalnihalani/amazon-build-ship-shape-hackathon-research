/**
 * Test harness: deterministic clock, in-memory storage with fault injection, a fake transport that
 * records serialized messages, and a scripted fake relay+phone that speaks PROTOCOL.md-shaped messages.
 * The envelope shapes here are written from docs/PROTOCOL.md, independently of src/wire.ts.
 */

import { createMemoryStorage, createSessionStore } from '../src/index.js';
import type {
  ActionId,
  LinkView,
  RemoteKey,
  SessionStore,
  SessionStoreDeps,
  StoragePort,
  TvView,
} from '../src/index.js';

export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
export const ROOM = 'r_testroom_0000000001';
export const CREDENTIAL = 'C'.repeat(43);
export const PAIRING_CODE = 'ACDEFH';
export const FLOOR = -50;

export class FakeClock {
  t = T0;
  offsetMs = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  localDate(epochMs: number): string {
    return new Date(epochMs + this.offsetMs).toISOString().slice(0, 10);
  }
}

export interface Sent {
  type: string;
  payload: Record<string, unknown>;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  room_id: string | null;
  sequence: number;
  producer_generation: number;
  message_id: string;
  sender_role: string;
  raw: string;
}

export class FakeTransport {
  sent: Sent[] = [];
  connects: string[] = [];
  closes: string[] = [];
  connect(url: string): void {
    this.connects.push(url);
  }
  send(serialized: string): boolean {
    const o = JSON.parse(serialized) as Record<string, unknown>;
    this.sent.push({ ...(o as unknown as Sent), raw: serialized });
    return true;
  }
  close(reason: string): void {
    this.closes.push(reason);
  }
}

/** Storage with call counters and one-shot failure injection. */
export interface FlakyStorage extends StoragePort {
  dump(): Record<string, string>;
  failSetFor: Set<string>;
  failMultiRemove: boolean;
  /** When true, multiRemove silently removes nothing (a lying store). */
  ignoreMultiRemove: boolean;
  setCalls: string[];
}

export function createFlakyStorage(initial?: Record<string, string>): FlakyStorage {
  const base = createMemoryStorage(initial);
  const flaky: FlakyStorage = {
    failSetFor: new Set(),
    failMultiRemove: false,
    ignoreMultiRemove: false,
    setCalls: [],
    dump: () => base.dump(),
    getItem: (k) => base.getItem(k),
    getAllKeys: () => base.getAllKeys(),
    removeItem: (k) => base.removeItem(k),
    setItem: (k, v) => {
      flaky.setCalls.push(k);
      if (flaky.failSetFor.has(k)) return Promise.reject(new Error('disk full'));
      return base.setItem(k, v);
    },
    multiRemove: (keys) => {
      if (flaky.failMultiRemove) return Promise.reject(new Error('remove failed'));
      if (flaky.ignoreMultiRemove) return Promise.resolve();
      return base.multiRemove(keys);
    },
  };
  return flaky;
}

/** Deterministic byte source (xorshift) so identifiers are unique but reproducible. */
export function seededBytes(seed = 12345): (n: number) => Uint8Array {
  let x = seed >>> 0 || 1;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      out[i] = x & 255;
    }
    return out;
  };
}

export interface HarnessOptions {
  storage?: FlakyStorage;
  fixtureMode?: boolean;
  /** Seed settings in storage before boot (default: onboarded, family off). */
  settings?: { familyMode?: boolean; onboarded?: boolean; cueWord?: string | null };
  seed?: Record<string, string>;
  relayUrl?: string;
  noBoot?: boolean;
}

type Json = Record<string, unknown>;

export interface PhraseOpts {
  /** Window result relative to the session floor (dB). Default 25 (reached when band margin is 20). */
  rel?: number;
  valid?: boolean;
  reason?: string | null;
  activeMs?: number;
  coverage?: number;
  /** Precheck floor relative to the session floor. Default 0. */
  rise?: number;
  /** Stop with OK before the window ends. */
  early?: boolean;
  /** Rating to give if a rating is requested (undefined: do not answer). */
  rating?: 'felt_loud' | 'felt_normal' | 'skipped';
  /** Listener response if family mode (undefined: do not answer). */
  listener?: 'heard' | 'not_heard';
}

export class Harness {
  clock = new FakeClock();
  transport = new FakeTransport();
  storage: FlakyStorage;
  store!: SessionStore;
  views: TvView[] = [];
  /** Session floor the fake phone reports (dBFS). */
  floor = FLOOR;
  private phoneSeq = 0;
  private relaySeq = 0;
  deps!: SessionStoreDeps;

  constructor(private readonly opts: HarnessOptions = {}) {
    const seed: Record<string, string> = { ...(opts.seed ?? {}) };
    if (opts.settings !== undefined || opts.seed === undefined) {
      const s = opts.settings ?? {};
      seed['atr:v1:meta'] = JSON.stringify({ schema_version: 1, created_at: T0 });
      seed['atr:v1:settings'] = JSON.stringify({
        familyMode: s.familyMode === true,
        cueWord: s.cueWord ?? null,
        measurementMode: 'relative_band',
        onboarded: s.onboarded !== false,
      });
    }
    this.storage = opts.storage ?? createFlakyStorage(seed);
    if (opts.storage) for (const [k, v] of Object.entries(seed)) void opts.storage.setItem(k, v);
  }

  async boot(): Promise<this> {
    this.deps = {
      clock: this.clock,
      storage: this.storage,
      transport: this.transport,
      relayUrl: this.opts.relayUrl ?? 'https://relay.example.test/ws',
      randomBytes: seededBytes(),
      appVersion: '0.1.0-test',
      platform: 'test',
      fixtureMode: this.opts.fixtureMode,
    };
    this.store = createSessionStore(this.deps);
    this.store.subscribe((v) => this.views.push(v));
    await this.store.ready();
    return this;
  }

  get view(): TvView {
    return this.store.getView();
  }

  stage(): string {
    return this.view.stage;
  }

  actionIds(): ActionId[] {
    return this.view.actions.filter((a) => a.disabled !== true).map((a) => a.id);
  }

  ui(action: ActionId): void {
    this.store.dispatch({ kind: 'ui', action });
  }
  key(key: RemoteKey): void {
    this.store.dispatch({ kind: 'remote', key });
  }
  ok(): void {
    this.key('ok');
  }
  back(): void {
    this.key('back');
  }
  transportState(state: LinkView): void {
    this.store.dispatch({ kind: 'transport', state });
  }
  wire(message: string | object): void {
    this.store.dispatch({ kind: 'wire', message });
  }
  /** Advance the clock, then tick the store (the app would tick every 100-250 ms). */
  advance(ms: number): void {
    this.clock.advance(ms);
    this.store.dispatch({ kind: 'timer', now: this.clock.now() });
  }
  tick(): void {
    this.store.dispatch({ kind: 'timer', now: this.clock.now() });
  }
  async flush(): Promise<void> {
    await this.store.ready();
    await new Promise((r) => setTimeout(r, 0));
    await this.store.ready();
  }

  /* ----------------------------- sent-message log */

  of(type: string): Sent[] {
    return this.transport.sent.filter((m) => m.type === type);
  }
  last(type: string): Sent {
    const all = this.of(type);
    const m = all[all.length - 1];
    if (!m) throw new Error(`no ${type} sent; got ${this.transport.sent.map((x) => x.type).join(',')}`);
    return m;
  }
  clearSent(): void {
    this.transport.sent = [];
  }

  /* ----------------------------- envelopes written from PROTOCOL.md */

  private envelope(
    type: string,
    role: 'phone' | 'relay',
    payload: Json,
    ids: { s?: string | null; w?: string | null; a?: string | null; room?: string | null } = {},
  ): string {
    const seq = role === 'phone' ? (this.phoneSeq += 1) : (this.relaySeq += 1);
    const n = String(seq).padStart(10, '0');
    return JSON.stringify({
      protocol_version: 1,
      type,
      message_id: `m_${role}${n}abcdef`,
      room_id: ids.room === undefined ? ROOM : ids.room,
      session_id: ids.s ?? null,
      window_id: ids.w ?? null,
      attempt_id: ids.a ?? null,
      sender_role: role,
      producer_generation: role === 'phone' ? 1 : 0,
      sequence: seq,
      event_timestamp: this.clock.now(),
      payload,
    });
  }

  relay(type: string, payload: Json, room: string | null = ROOM): string {
    return this.envelope(type, 'relay', payload, { room });
  }

  /* ----------------------------- relay-originated */

  roomCreated(opts: { code?: string; generation?: number } = {}): void {
    this.wire(
      this.relay('room.created', {
        room_id: ROOM,
        pairing_code: opts.code ?? PAIRING_CODE,
        code_expires_at: this.clock.now() + 600_000,
        tv_credential: CREDENTIAL,
        credential_expires_at: this.clock.now() + 12 * 3600_000,
        generation: opts.generation ?? 1,
      }),
    );
  }
  joinRequested(label = 'Rohan phone', digits = '47', joinId = 'j_testjoin000001'): void {
    this.wire(
      this.relay('join.requested', {
        join_id: joinId,
        device_label: label,
        confirm_digits: digits,
        expires_at: this.clock.now() + 60_000,
      }),
    );
  }
  joinExpired(joinId = 'j_testjoin000001'): void {
    this.wire(this.relay('join.expired', { join_id: joinId }));
  }
  peerState(connected: boolean): void {
    this.wire(this.relay('peer.state', { role: 'phone', connected, generation: 1 }));
  }
  authOk(opts: { peer?: boolean; paired?: boolean; generation?: number } = {}): void {
    this.wire(
      this.relay('auth.ok', {
        role: 'tv',
        generation: opts.generation ?? 2,
        peer_connected: opts.peer ?? true,
        phone_paired: opts.paired ?? true,
      }),
    );
  }
  pairingCode(code: string): void {
    this.wire(this.relay('pairing.code', { pairing_code: code, code_expires_at: this.clock.now() + 600_000 }));
  }
  relayError(code: string): void {
    this.wire(this.relay('error', { code, ref_message_id: null, detail: '' }));
  }

  /* ----------------------------- phone-originated */

  private ids(cmd: Sent): { s: string | null; w: string | null; a: string | null } {
    return { s: cmd.session_id, w: cmd.window_id, a: cmd.attempt_id };
  }

  micState(
    state: 'off' | 'permission_pending' | 'permission_denied' | 'no_input' | 'input_busy' | 'constraints_unsupported' | 'open_idle' | 'measuring' | 'error',
    mode: 'physical_phone' | 'same_host' | 'fixture_replay' = 'physical_phone',
  ): void {
    this.wire(
      this.envelope('mic.state', 'phone', {
        state,
        settings: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 },
        supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
        wake_lock: 'held',
        visibility: 'visible',
        mode,
      }),
    );
  }

  precheckPayload(purpose: 'quiet_check' | 'pre_window', o: Partial<Json> = {}, rise = 0): Json {
    const floor = purpose === 'quiet_check' ? this.floor : this.floor + rise;
    return {
      purpose,
      valid: true,
      invalid_reason: null,
      floor_dbfs: floor,
      p20_dbfs: floor - 1,
      p80_dbfs: floor + 1,
      p95_dbfs: floor + 3,
      frame_count: purpose === 'quiet_check' ? 100 : 40,
      expected_frames: purpose === 'quiet_check' ? 100 : 40,
      coverage: 1,
      clipped_frames: 0,
      nonfinite_frames: 0,
      duration_ms: purpose === 'quiet_check' ? 5000 : 2000,
      ...o,
    };
  }

  answerPrecheck(o: Partial<Json> = {}, rise = 0): void {
    const cmd = this.last('precheck.start');
    const purpose = cmd.payload.purpose as 'quiet_check' | 'pre_window';
    this.wire(this.envelope('precheck.result', 'phone', this.precheckPayload(purpose, o, rise), this.ids(cmd)));
  }

  windowPayload(kind: 'calibration' | 'vowel' | 'phrase', o: { rel?: number; valid?: boolean; reason?: string | null; activeMs?: number; longest?: number; coverage?: number; p95?: number | null } = {}): Json {
    const valid = o.valid !== false;
    const rel = o.rel ?? 25;
    const active = o.activeMs ?? 2500;
    return {
      kind,
      valid,
      invalid_reason: valid ? null : (o.reason ?? 'no_voice'),
      frame_count: 160,
      expected_frames: 160,
      coverage: o.coverage ?? 1,
      active_ms: active,
      longest_active_ms: o.longest ?? active,
      segments: 1,
      onset_ms: 200,
      p50_active_dbfs: this.floor + rel - 4,
      p95_active_dbfs: o.p95 !== undefined ? o.p95 : this.floor + rel,
      peak_dbfs: this.floor + rel + 2,
      clipped_frames: 0,
      nonfinite_frames: 0,
      duration_ms: 8000,
    };
  }

  answerWindowWith(payload: Json, cmdIn?: Sent): void {
    const cmd = cmdIn ?? this.last('window.start');
    this.wire(this.envelope('window.result', 'phone', payload, this.ids(cmd)));
  }

  answerWindow(o: Parameters<Harness['windowPayload']>[1] = {}, cmdIn?: Sent): void {
    const cmd = cmdIn ?? this.last('window.start');
    const kind = cmd.payload.kind as 'calibration' | 'vowel' | 'phrase';
    this.wire(this.envelope('window.result', 'phone', this.windowPayload(kind, o), this.ids(cmd)));
  }

  level(frame: number, dbfs: number, active = true, cmdIn?: Sent): void {
    const cmd = cmdIn ?? this.last('window.start');
    this.wire(
      this.envelope('level', 'phone', { frame_index: frame, t_audio_ms: frame * 50, dbfs, active, clipped: false }, this.ids(cmd)),
    );
  }

  listener(response: 'heard' | 'not_heard', cmdIn?: Sent): void {
    const cmd = cmdIn ?? this.last('listener.open');
    this.wire(this.envelope('listener.response', 'phone', { response }, this.ids(cmd)));
  }

  cue(text: unknown, sessionId?: string): void {
    const sid = sessionId ?? this.last('session.begin').session_id;
    this.wire(this.envelope('cue', 'phone', { text }, { s: sid }));
  }

  phrases(list: unknown): void {
    this.wire(this.envelope('phrases.update', 'phone', { phrases: list }));
  }

  /* ----------------------------- journeys */

  /** Start a session and get through pairing and microphone: ends at quiet_check (ready). */
  startAndPair(): void {
    this.ui('start_session');
    if (this.transport.connects.length === 0) throw new Error('no connect');
    this.transportState('connected');
    this.roomCreated();
    this.joinRequested();
    this.ui('accept_join');
    this.peerState(true);
    this.micState('permission_pending');
    this.micState('open_idle');
  }

  /** Pair a phone from Home without starting a session (the relay room and the phone slot exist afterwards). */
  pairOnly(): void {
    this.ui('pair_phone');
    this.transportState('connected');
    this.roomCreated();
    this.joinRequested();
    this.ui('accept_join');
    this.peerState(true);
  }

  /** From an already paired phone: start a session and get to the first phrase_ready with a 20 dB band. */
  setupPairedToPhrases(): void {
    this.ui('start_session');
    this.micState('open_idle');
    this.runQuiet();
    this.runCalibration(20);
    this.toPhrases();
  }

  /** Press OK on a begin action and let the quiet lead elapse. */
  beginAndLead(action: ActionId): void {
    this.ui(action);
    this.advance(1500);
  }

  runQuiet(): void {
    this.beginAndLead('begin_quiet_check');
    this.answerPrecheck();
  }

  runCalibration(rel = 20): void {
    this.beginAndLead('begin_calibration');
    this.answerWindow({ rel });
  }

  /** Skip the vowel step: continue from calibration, then skip. */
  toPhrases(): void {
    this.ui('continue');
    this.ui('skip_vowel');
  }

  /** Full setup to the first phrase_ready with a band of 20 dB. */
  setupToPhrases(): void {
    this.startAndPair();
    this.runQuiet();
    this.runCalibration(20);
    this.toPhrases();
  }

  /**
   * One phrase attempt from phrase_ready through the capture result, answering rating/listener when asked.
   * Leaves the machine in whichever stage follows (reveal, response_pending or paused_or_invalid).
   */
  runPhrase(o: PhraseOpts = {}): void {
    this.beginAndLead('begin_phrase');
    this.answerPrecheck({}, o.rise ?? 0);
    if (this.stage() !== 'phrase_active') return;
    const start = this.last('window.start');
    this.level(0, this.floor + 2, false);
    this.advance(500);
    if (o.early) {
      this.ok();
    }
    this.answerWindow(
      { rel: o.rel, valid: o.valid, reason: o.reason, activeMs: o.activeMs, coverage: o.coverage },
      start,
    );
    if (this.stage() === 'response_pending') {
      if (o.rating !== undefined && this.actionIds().includes('rate_skip')) {
        this.ui(o.rating === 'felt_loud' ? 'rate_felt_loud' : o.rating === 'felt_normal' ? 'rate_felt_normal' : 'rate_skip');
      }
      // answer only when the TV opened the listener for this very attempt (family mode)
      const opened = this.of('listener.open').some((m) => m.attempt_id === start.attempt_id);
      if (o.listener !== undefined && opened && this.stage() === 'response_pending') this.listener(o.listener);
    }
  }

  /** Complete every remaining phrase quickly (reached for visible, ratings skipped, listener heard if family). */
  finishAllPhrases(o: PhraseOpts = {}): void {
    let guard = 0;
    while (this.stage() === 'phrase_ready' && guard < 20) {
      guard += 1;
      this.runPhrase({ rating: 'skipped', listener: 'heard', ...o });
      if (this.stage() === 'reveal') this.ui('next_phrase');
    }
  }
}

export async function boot(opts: HarnessOptions = {}): Promise<Harness> {
  const h = new Harness(opts);
  await h.boot();
  return h;
}

/* ----------------------------- deep scanning of views */

export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

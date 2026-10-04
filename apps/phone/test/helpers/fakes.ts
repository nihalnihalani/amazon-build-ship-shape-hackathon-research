import type {
  AbortReason,
  AudioPort,
  AudioSnapshot,
  LevelFrame,
  MicState,
  PrecheckRequest,
  PrecheckRun,
  WindowRequest,
  WindowRun,
} from '../../src/ports/audio.js';
import type { PrecheckResultPayload, WindowResultPayload } from '../../src/ports/wire.js';
import type { SocketLike } from '../../src/transport.js';
import type { VisibilitySource } from '../../src/controller.js';
import { type WakeLockApi, type WakeLockSentinelLike } from '../../src/wake-lock.js';
import { assertPhoneMessage, type WireMessage } from './protocol-spec.js';

// ---- ids / payload builders (valid per PROTOCOL.md) --------------------------------
export const ROOM = 'r_roomroomroomroom01';
export const SESSION = 's_session0001';
export const SESSION2 = 's_session0002';
export const WINDOW = 'w_window00001';
export const WINDOW2 = 'w_window00002';
export const ATTEMPT = 'a_attempt0001';
export const ATTEMPT2 = 'a_attempt0002';
export const CREDENTIAL = 'C'.repeat(43);
export const CODE = 'ACDEFH';

let seq = 0;
/** PROTOCOL.md section 1 room rule: null for these relay replies, required for the rest (ping/pong/error optional). */
const ROOM_NULL_TYPES = new Set(['join.pending', 'join.rejected']);
const ROOM_OPTIONAL_TYPES = new Set(['pong', 'error']);
function envelope(
  type: string,
  role: 'tv' | 'relay',
  payload: unknown,
  ids: { s?: string | null; w?: string | null; a?: string | null } = {},
): string {
  seq += 1;
  const roomNull = role === 'relay' && (ROOM_NULL_TYPES.has(type) || ROOM_OPTIONAL_TYPES.has(type));
  return JSON.stringify({
    protocol_version: 1,
    type,
    message_id: `m_${String(seq).padStart(16, '0')}`,
    room_id: roomNull ? null : ROOM,
    session_id: ids.s ?? null,
    window_id: ids.w ?? null,
    attempt_id: ids.a ?? null,
    sender_role: role,
    producer_generation: role === 'relay' ? 0 : 1,
    sequence: seq,
    event_timestamp: Date.now(),
    payload,
  });
}
export const relayMsg = (type: string, payload: unknown): string => envelope(type, 'relay', payload);
export const tvMsg = (
  type: string,
  payload: unknown,
  ids: { s?: string | null; w?: string | null; a?: string | null } = { s: SESSION },
): string => envelope(type, 'tv', payload, ids);
export const lastMessageId = (text: string): string => (JSON.parse(text) as { message_id: string }).message_id;

export const joinPending = (digits = '47'): string =>
  relayMsg('join.pending', { join_id: 'j_joinjoin0001', confirm_digits: digits, expires_at: Date.now() + 60000 });
export const joinAccepted = (generation = 1): string =>
  relayMsg('join.accepted', { room_id: ROOM, phone_credential: CREDENTIAL, credential_expires_at: Date.now() + 1e7, generation });
export const authOk = (generation = 2, peer = true): string =>
  relayMsg('auth.ok', { role: 'phone', generation, peer_connected: peer, phone_paired: true });

export const SESSION_BEGIN = { family_mode: true, phrase_count: 4, cues_max: 3 };
export const sessionBegin = (s = SESSION): string => tvMsg('session.begin', SESSION_BEGIN, { s });
export const sessionState = (
  stage: string,
  cuesUsed = 0,
  listener: string | null = null,
  s = SESSION,
): string =>
  tvMsg('session.state', { stage, phrase_position: 1, cues_used: cuesUsed, listener_open_attempt: listener }, { s });
export const precheckStart = (purpose: 'quiet_check' | 'pre_window' = 'quiet_check', w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg('precheck.start', { purpose, duration_ms: purpose === 'quiet_check' ? 5000 : 2000 }, { s, w, a });
export const windowStart = (kind: 'calibration' | 'vowel' | 'phrase' = 'phrase', w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg(
    'window.start',
    {
      kind,
      phrase_position: kind === 'phrase' ? 1 : null,
      max_duration_ms: kind === 'calibration' ? 6000 : kind === 'phrase' ? 8000 : 20000,
      vad_floor_dbfs: -55,
    },
    { s, w, a },
  );
export const windowStop = (w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg('window.stop', { reason: 'complete' }, { s, w, a });
export const windowCancel = (w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg('window.cancel', { reason: 'user_cancel' }, { s, w, a });
export const listenerOpen = (w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg('listener.open', { timeout_ms: 20000 }, { s, w, a });
export const attemptReveal = (w = WINDOW, a = ATTEMPT, s = SESSION): string =>
  tvMsg('attempt.reveal', {}, { s, w, a });
export const sessionEnd = (s = SESSION): string => tvMsg('session.end', { reason: 'completed' }, { s });

export const validPrecheck = (purpose: 'quiet_check' | 'pre_window' = 'quiet_check'): PrecheckResultPayload => ({
  purpose,
  valid: true,
  invalid_reason: null,
  floor_dbfs: -60,
  p20_dbfs: -61,
  p80_dbfs: -59,
  p95_dbfs: -58,
  frame_count: 100,
  expected_frames: 100,
  coverage: 1,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 5000,
});
export const validWindow = (kind: 'calibration' | 'vowel' | 'phrase' = 'phrase'): WindowResultPayload => ({
  kind,
  valid: true,
  invalid_reason: null,
  frame_count: 160,
  expected_frames: 160,
  coverage: 1,
  active_ms: 3000,
  longest_active_ms: 3000,
  segments: 1,
  onset_ms: 500,
  p50_active_dbfs: -30,
  p95_active_dbfs: -25,
  peak_dbfs: -20,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 8000,
});

// ---- socket ------------------------------------------------------------------
export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closeCalls: Array<number | undefined> = [];
  constructor(readonly url: string) {}
  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket not open');
    this.sent.push(data);
  }
  close(code?: number): void {
    this.readyState = 3;
    this.closeCalls.push(code);
  }
  // --- test helpers ---
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(text: string): void {
    this.onmessage?.({ data: text });
  }
  /** Server/network drops the socket. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  /** Every phone-sent frame, validated against the independent PROTOCOL.md checker. */
  messages(type?: string): WireMessage[] {
    const all = this.sent.map((t) => assertPhoneMessage(t));
    return type ? all.filter((m) => m.type === type) : all;
  }
  last(type: string): WireMessage {
    const list = this.messages(type);
    const m = list[list.length - 1];
    if (!m) throw new Error(`no ${type} message sent`);
    return m;
  }
}

export class SocketRegistry {
  sockets: FakeSocket[] = [];
  create = (url: string): SocketLike => {
    const s = new FakeSocket(url);
    this.sockets.push(s);
    return s;
  };
  get current(): FakeSocket {
    const s = this.sockets[this.sockets.length - 1];
    if (!s) throw new Error('no socket created');
    return s;
  }
}

// ---- audio port ----------------------------------------------------------------
const NO = { auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null };

interface FakeRun<R> {
  aborted: AbortReason | null;
  resolve(payload: R | null): void;
  ended: boolean;
}

export class FakeAudio implements AudioPort {
  snapshot: AudioSnapshot = {
    state: 'off',
    settings: { ...NO },
    supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
    mode: 'physical_phone',
    detail: null,
  };
  openCalls: Array<{ relaxConstraints?: boolean } | undefined> = [];
  closeCalls = 0;
  cancelCalls = 0;
  precheckCalls: PrecheckRequest[] = [];
  windowCalls: WindowRequest[] = [];
  private readonly listeners = new Set<(s: AudioSnapshot) => void>();
  private precheckRun: FakeRun<PrecheckResultPayload> | null = null;
  private windowRun: (FakeRun<WindowResultPayload> & { onFrame: (f: LevelFrame) => void }) | null = null;
  lastOnFrame: ((f: LevelFrame) => void) | null = null;
  interruptedPrecheck: PrecheckResultPayload | null = null;
  interruptedWindow: WindowResultPayload | null = null;

  getSnapshot(): AudioSnapshot {
    return this.snapshot;
  }
  subscribe(l: (s: AudioSnapshot) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  setState(state: MicState, patch: Partial<AudioSnapshot> = {}): void {
    this.snapshot = { ...this.snapshot, state, ...patch };
    for (const l of [...this.listeners]) l(this.snapshot);
  }
  /** Simulates a successful open (observed). */
  makeOpen(): void {
    this.setState('open_idle', {
      settings: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 },
    });
  }
  async open(options?: { relaxConstraints?: boolean }): Promise<void> {
    this.openCalls.push(options);
  }
  cancelOpen(): void {
    this.cancelCalls += 1;
    if (this.snapshot.state === 'permission_pending') this.setState('off');
  }
  close(): void {
    this.closeCalls += 1;
    this.precheckRun?.resolve(null);
    this.windowRun?.resolve(null);
    this.precheckRun = null;
    this.windowRun = null;
    this.setState('off', { settings: { ...NO }, detail: null });
  }
  precheck(request: PrecheckRequest): PrecheckRun {
    if (this.snapshot.state !== 'open_idle') throw new Error('mic_not_open');
    this.precheckCalls.push(request);
    let resolve!: (p: PrecheckResultPayload | null) => void;
    const result = new Promise<PrecheckResultPayload | null>((r) => (resolve = r));
    const run: FakeRun<PrecheckResultPayload> = { aborted: null, ended: false, resolve: (p) => { run.ended = true; resolve(p); } };
    this.precheckRun = run;
    return {
      result,
      abort: (reason) => {
        if (run.ended) return null;
        run.aborted = reason;
        run.resolve(null);
        this.precheckRun = null;
        if (this.snapshot.state === 'measuring') this.setState('open_idle');
        return reason === 'interrupted' ? (this.interruptedPrecheck ?? { ...validPrecheck(request.purpose), valid: false, invalid_reason: 'interrupted' }) : null;
      },
    };
  }
  window(request: WindowRequest, onFrame: (f: LevelFrame) => void): WindowRun {
    if (this.snapshot.state !== 'open_idle') throw new Error('mic_not_open');
    this.windowCalls.push(request);
    this.lastOnFrame = onFrame;
    let resolve!: (p: WindowResultPayload | null) => void;
    const result = new Promise<WindowResultPayload | null>((r) => (resolve = r));
    const run = { aborted: null as AbortReason | null, ended: false, onFrame, resolve: (p: WindowResultPayload | null) => { run.ended = true; resolve(p); } };
    this.windowRun = run;
    return {
      result,
      stop: () => {
        if (run.ended) return;
        run.resolve({ ...validWindow(request.kind), duration_ms: 1500 });
        this.windowRun = null;
        if (this.snapshot.state === 'measuring') this.setState('open_idle');
      },
      abort: (reason) => {
        if (run.ended) return null;
        run.aborted = reason;
        run.resolve(null);
        this.windowRun = null;
        if (this.snapshot.state === 'measuring') this.setState('open_idle');
        return reason === 'interrupted' ? (this.interruptedWindow ?? { ...validWindow(request.kind), valid: false, invalid_reason: 'interrupted' }) : null;
      },
    };
  }
  // --- test drivers ---
  /** The first frame arrives: the port now observes measurement. */
  frame(frameIndex: number, dbfs = -30): void {
    if (!this.windowRun) return; // the real port only reduces frames while a run is open
    if (this.snapshot.state === 'open_idle') this.setState('measuring');
    this.windowRun.onFrame({ frameIndex, tAudioMs: frameIndex * 50, dbfs, active: dbfs > -50, clipped: false });
  }
  startedMeasuring(): void {
    this.setState('measuring');
  }
  finishWindow(payload: WindowResultPayload): void {
    this.windowRun?.resolve(payload);
    this.windowRun = null;
    if (this.snapshot.state === 'measuring') this.setState('open_idle');
  }
  finishPrecheck(payload: PrecheckResultPayload): void {
    this.precheckRun?.resolve(payload);
    this.precheckRun = null;
    if (this.snapshot.state === 'measuring') this.setState('open_idle');
  }
  get hasOpenRun(): boolean {
    return this.precheckRun !== null || this.windowRun !== null;
  }
}

// ---- wake lock / visibility ----------------------------------------------------
export class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private listeners = new Set<() => void>();
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    for (const l of [...this.listeners]) l();
  }
  /** Browser-initiated release (battery saver, page hidden). */
  browserRelease(): void {
    void this.release();
  }
  addEventListener(_t: 'release', l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'release', l: () => void): void {
    this.listeners.delete(l);
  }
}

export class FakeWakeLockApi implements WakeLockApi {
  requests = 0;
  sentinels: FakeSentinel[] = [];
  rejectNext = false;
  async request(): Promise<WakeLockSentinelLike> {
    this.requests += 1;
    if (this.rejectNext) throw new DOMException('denied', 'NotAllowedError');
    const s = new FakeSentinel();
    this.sentinels.push(s);
    return s;
  }
  get active(): FakeSentinel[] {
    return this.sentinels.filter((s) => !s.released);
  }
}

export class FakeVisibility implements VisibilitySource {
  value: 'visible' | 'hidden' = 'visible';
  private listeners = new Set<() => void>();
  get(): 'visible' | 'hidden' {
    return this.value;
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  set(v: 'visible' | 'hidden'): void {
    this.value = v;
    for (const l of [...this.listeners]) l();
  }
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

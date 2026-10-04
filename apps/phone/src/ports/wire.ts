/**
 * Wire port: builds and parses PROTOCOL.md v1 messages for the phone role.
 *
 * TEMPORARY IMPLEMENTATION. The executable source of truth is `@atr/protocol`
 * (parseWireMessage, MessageFactory, ids). When that package is merged, this file
 * keeps its exported surface and re-implements it on top of the package; nothing
 * else in apps/phone imports the package directly.
 */

import { LIMITS, PROTOCOL_VERSION } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MicStateName =
  | 'off'
  | 'permission_pending'
  | 'permission_denied'
  | 'no_input'
  | 'input_busy'
  | 'constraints_unsupported'
  | 'open_idle'
  | 'measuring'
  | 'error';

export type WakeLockState = 'held' | 'released' | 'unsupported' | 'rejected' | 'not_requested';
export type Visibility = 'visible' | 'hidden';
export type MicMode = 'physical_phone' | 'same_host' | 'fixture_replay';

export interface MicSettingsWire {
  auto_gain_control: boolean | null;
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
  sample_rate: number | null;
  channel_count: number | null;
}

export interface MicSupportedWire {
  auto_gain_control: boolean;
  echo_cancellation: boolean;
  noise_suppression: boolean;
}

export interface MicStatePayload {
  state: MicStateName;
  settings: MicSettingsWire;
  supported: MicSupportedWire;
  wake_lock: WakeLockState;
  visibility: Visibility;
  mode: MicMode;
}

export type PrecheckInvalidReason =
  | 'low_coverage'
  | 'clipped'
  | 'unstable_floor'
  | 'burst_noise'
  | 'too_loud'
  | 'nonfinite'
  | 'interrupted';

export interface PrecheckResultPayload {
  purpose: 'quiet_check' | 'pre_window';
  valid: boolean;
  invalid_reason: PrecheckInvalidReason | null;
  floor_dbfs: number | null;
  p20_dbfs: number | null;
  p80_dbfs: number | null;
  p95_dbfs: number | null;
  frame_count: number;
  expected_frames: number;
  coverage: number;
  clipped_frames: number;
  nonfinite_frames: number;
  duration_ms: number;
}

export type WindowKind = 'calibration' | 'vowel' | 'phrase';
export type WindowInvalidReason =
  | 'no_voice'
  | 'clipped'
  | 'low_coverage'
  | 'continuous_sound'
  | 'nonfinite'
  | 'interrupted';

export interface WindowResultPayload {
  kind: WindowKind;
  valid: boolean;
  invalid_reason: WindowInvalidReason | null;
  frame_count: number;
  expected_frames: number;
  coverage: number;
  active_ms: number;
  longest_active_ms: number;
  segments: number;
  onset_ms: number | null;
  p50_active_dbfs: number | null;
  p95_active_dbfs: number | null;
  peak_dbfs: number | null;
  clipped_frames: number;
  nonfinite_frames: number;
  duration_ms: number;
}

export type AckOutcome = 'applied' | 'ignored_stale' | 'rejected';

export type TvStage =
  | 'idle'
  | 'pairing'
  | 'permission_pending'
  | 'quiet_check'
  | 'calibration'
  | 'vowel_ready'
  | 'vowel_active'
  | 'vowel_result'
  | 'phrase_ready'
  | 'phrase_active'
  | 'response_pending'
  | 'reveal'
  | 'summary'
  | 'history'
  | 'paused_or_invalid'
  | 'resume_or_discard';

export type ErrorCode =
  | 'bad_schema'
  | 'unknown_type'
  | 'unauthenticated'
  | 'unauthorized'
  | 'forbidden_direction'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'room_full'
  | 'join_busy'
  | 'not_found'
  | 'stale'
  | 'replay'
  | 'superseded'
  | 'payload_too_large'
  | 'binary_rejected'
  | 'audio_rejected'
  | 'cue_limit'
  | 'origin_rejected'
  | 'internal';

/** Messages the phone sends. */
export interface OutboundPayloads {
  'join.request': { pairing_code: string; device_label: string };
  'auth.resume': { room_id: string; role: 'phone'; credential: string };
  ping: Record<string, never>;
  'mic.state': MicStatePayload;
  'precheck.result': PrecheckResultPayload;
  level: { frame_index: number; t_audio_ms: number; dbfs: number; active: boolean; clipped: boolean };
  'window.result': WindowResultPayload;
  'listener.response': { response: 'heard' | 'not_heard' };
  cue: { text: string };
  'phrases.update': { phrases: string[] };
  ack: { acked_message_id: string; outcome: AckOutcome; detail: string };
}
export type OutboundType = keyof OutboundPayloads;

/** Messages the phone accepts. */
export interface InboundPayloads {
  'join.pending': { join_id: string; confirm_digits: string; expires_at: number };
  'join.accepted': { room_id: string; phone_credential: string; credential_expires_at: number; generation: number };
  'join.rejected': { reason: 'rejected' | 'expired' | 'room_full' | 'busy' };
  'auth.ok': { role: 'tv' | 'phone'; generation: number; peer_connected: boolean; phone_paired: boolean };
  'peer.state': { role: 'tv' | 'phone'; connected: boolean; generation: number };
  unpaired: { reason: 'tv_unpaired' | 'room_closed' | 'expired' };
  pong: { server_time: number };
  error: { code: ErrorCode; ref_message_id: string | null; detail: string };
  'session.begin': { family_mode: boolean; phrase_count: number; cues_max: 3 };
  'session.state': {
    stage: TvStage;
    phrase_position: number;
    cues_used: number;
    listener_open_attempt: string | null;
  };
  'precheck.start': { purpose: 'quiet_check' | 'pre_window'; duration_ms: 2000 | 5000 };
  'window.start': {
    kind: WindowKind;
    phrase_position: number | null;
    max_duration_ms: number;
    vad_floor_dbfs: number;
  };
  'window.stop': { reason: 'complete' | 'early_stop' };
  'window.cancel': { reason: 'user_cancel' | 'interrupted' | 'link_lost' | 'timeout' | 'session_end' };
  'listener.open': { timeout_ms: number };
  'attempt.reveal': Record<string, never>;
  'session.end': { reason: 'completed' | 'user_exit' | 'discarded' | 'error' };
  ack: { acked_message_id: string; outcome: AckOutcome; detail: string };
}
export type InboundType = keyof InboundPayloads;

export type SenderRole = 'tv' | 'phone' | 'relay';

export interface Envelope<P = unknown> {
  protocol_version: 1;
  type: string;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: SenderRole;
  producer_generation: number;
  sequence: number;
  event_timestamp: number;
  payload: P;
}

export type InboundMessage = {
  [K in InboundType]: Envelope<InboundPayloads[K]> & { type: K };
}[InboundType];

export interface Ids {
  session_id?: string | null;
  window_id?: string | null;
  attempt_id?: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface WireDeps {
  now(): number;
  randomBytes(length: number): Uint8Array;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}

export const defaultWireDeps: WireDeps = {
  now: () => Date.now(),
  randomBytes: (length) => {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  },
};

/** Types allowed before authentication (ADR-0003 section 1). */
const PRE_AUTH_TYPES: ReadonlySet<string> = new Set(['join.request', 'auth.resume']);

/** Identity binding for outbound types: which of S/W/A are required (all others null). */
const OUTBOUND_BINDING: Record<OutboundType, 'none' | 'S' | 'SWA' | 'mic' | 'ack'> = {
  'join.request': 'none',
  'auth.resume': 'none',
  ping: 'none',
  'mic.state': 'mic',
  'precheck.result': 'SWA',
  level: 'SWA',
  'window.result': 'SWA',
  'listener.response': 'SWA',
  cue: 'S',
  'phrases.update': 'none',
  ack: 'ack',
};

export class MessageFactory {
  private roomId: string | null = null;
  private generation = 0;
  private sequence = 0;

  constructor(private readonly deps: WireDeps = defaultWireDeps) {}

  /** Called after `join.accepted` / `auth.ok`: a new (room, generation) starts a fresh sequence space. */
  setAuth(roomId: string, generation: number): void {
    this.roomId = roomId;
    this.generation = generation;
    this.sequence = 0;
  }

  clearAuth(): void {
    this.roomId = null;
    this.generation = 0;
    this.sequence = 0;
  }

  get authenticated(): boolean {
    return this.roomId !== null;
  }

  newMessageId(): string {
    return `m_${base64url(this.deps.randomBytes(16))}`;
  }

  /**
   * Builds one envelope. Pre-auth types (and `ping` before auth) carry room_id null,
   * generation 0 and sequence 0; authenticated messages carry a strictly increasing sequence.
   */
  build<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): Envelope<OutboundPayloads[T]> {
    const preAuth = PRE_AUTH_TYPES.has(type) || (type === 'ping' && this.roomId === null);
    if (!preAuth && this.roomId === null) {
      throw new Error(`cannot send ${type} before authentication`);
    }
    const binding = OUTBOUND_BINDING[type];
    const sessionId = ids.session_id ?? null;
    const windowId = ids.window_id ?? null;
    const attemptId = ids.attempt_id ?? null;
    switch (binding) {
      case 'none':
        if (sessionId || windowId || attemptId) throw new Error(`${type} must not carry session/window/attempt ids`);
        break;
      case 'S':
        if (!sessionId || windowId || attemptId) throw new Error(`${type} requires only session_id`);
        break;
      case 'SWA':
        if (!sessionId || !windowId || !attemptId) throw new Error(`${type} requires session, window and attempt ids`);
        break;
      case 'mic':
        if (windowId || attemptId) throw new Error('mic.state may carry only session_id');
        break;
      case 'ack':
        break;
    }
    const sequence = preAuth ? 0 : ++this.sequence;
    return {
      protocol_version: PROTOCOL_VERSION,
      type,
      message_id: this.newMessageId(),
      room_id: preAuth ? null : this.roomId,
      session_id: sessionId,
      window_id: windowId,
      attempt_id: attemptId,
      sender_role: 'phone',
      producer_generation: preAuth ? 0 : this.generation,
      sequence,
      event_timestamp: this.deps.now(),
      payload,
    };
  }
}

export function serialize(envelope: Envelope): string {
  const text = JSON.stringify(envelope);
  if (new TextEncoder().encode(text).length > LIMITS.messageMaxBytes) {
    throw new Error(`message ${envelope.type} exceeds ${LIMITS.messageMaxBytes} bytes`);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Parsing (inbound)
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; message: InboundMessage }
  | { ok: false; reason: string };

type Check = (v: unknown) => boolean;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (min: number, max: number): Check => (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (min: number, max: number): Check => (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool: Check = (v) => typeof v === 'boolean';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const isStr =
  (min: number, max: number, re?: RegExp): Check =>
  (v) => {
    if (typeof v !== 'string' || CONTROL.test(v)) return false;
    let n = 0;
    for (const _ of v) {
      void _;
      n += 1;
    }
    return n >= min && n <= max && (re === undefined || re.test(v));
  };
const oneOf =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const nullable =
  (c: Check): Check =>
  (v) =>
    v === null || c(v);
const exact =
  (shape: Record<string, Check>): Check =>
  (v) => {
    if (!isObj(v)) return false;
    const keys = Object.keys(v);
    const want = Object.keys(shape);
    if (keys.length !== want.length) return false;
    return want.every((k) => Object.prototype.hasOwnProperty.call(v, k) && (shape[k] as Check)(v[k]));
  };

export const ID_PATTERNS = {
  message: /^m_[A-Za-z0-9_-]{16,32}$/,
  room: /^r_[A-Za-z0-9_-]{16,32}$/,
  session: /^s_[A-Za-z0-9_-]{8,40}$/,
  window: /^w_[A-Za-z0-9_-]{8,40}$/,
  attempt: /^a_[A-Za-z0-9_-]{8,40}$/,
  join: /^j_[A-Za-z0-9_-]{8,40}$/,
} as const;

const TV_STAGES: readonly TvStage[] = [
  'idle',
  'pairing',
  'permission_pending',
  'quiet_check',
  'calibration',
  'vowel_ready',
  'vowel_active',
  'vowel_result',
  'phrase_ready',
  'phrase_active',
  'response_pending',
  'reveal',
  'summary',
  'history',
  'paused_or_invalid',
  'resume_or_discard',
];

export const ERROR_CODES: readonly ErrorCode[] = [
  'bad_schema',
  'unknown_type',
  'unauthenticated',
  'unauthorized',
  'forbidden_direction',
  'expired',
  'revoked',
  'rate_limited',
  'room_full',
  'join_busy',
  'not_found',
  'stale',
  'replay',
  'superseded',
  'payload_too_large',
  'binary_rejected',
  'audio_rejected',
  'cue_limit',
  'origin_rejected',
  'internal',
];

const MAX_GEN = 2 ** 31 - 1;

interface InboundSpec {
  role: SenderRole;
  ids: 'none' | 'S' | 'SWA' | 'ack';
  payload: Check;
  /** Cross-field rules the per-key checks cannot express. */
  refine?: (payload: Record<string, unknown>) => boolean;
}

const INBOUND: Record<InboundType, InboundSpec> = {
  'join.pending': {
    role: 'relay',
    ids: 'none',
    payload: exact({
      join_id: isStr(3, 43, ID_PATTERNS.join),
      confirm_digits: isStr(2, 2, /^[0-9]{2}$/),
      expires_at: isInt(0, Number.MAX_SAFE_INTEGER),
    }),
  },
  'join.accepted': {
    role: 'relay',
    ids: 'none',
    payload: exact({
      room_id: isStr(3, 34, ID_PATTERNS.room),
      phone_credential: isStr(43, 43, /^[A-Za-z0-9_-]{43}$/),
      credential_expires_at: isInt(0, Number.MAX_SAFE_INTEGER),
      generation: isInt(0, MAX_GEN),
    }),
  },
  'join.rejected': {
    role: 'relay',
    ids: 'none',
    payload: exact({ reason: oneOf('rejected', 'expired', 'room_full', 'busy') }),
  },
  'auth.ok': {
    role: 'relay',
    ids: 'none',
    payload: exact({
      role: oneOf('tv', 'phone'),
      generation: isInt(0, MAX_GEN),
      peer_connected: isBool,
      phone_paired: isBool,
    }),
  },
  'peer.state': {
    role: 'relay',
    ids: 'none',
    payload: exact({ role: oneOf('tv', 'phone'), connected: isBool, generation: isInt(0, MAX_GEN) }),
  },
  unpaired: {
    role: 'relay',
    ids: 'none',
    payload: exact({ reason: oneOf('tv_unpaired', 'room_closed', 'expired') }),
  },
  pong: { role: 'relay', ids: 'none', payload: exact({ server_time: isInt(0, Number.MAX_SAFE_INTEGER) }) },
  error: {
    role: 'relay',
    ids: 'none',
    payload: exact({
      code: oneOf(...ERROR_CODES),
      ref_message_id: nullable(isStr(1, 64)),
      detail: isStr(0, 64),
    }),
  },
  'session.begin': {
    role: 'tv',
    ids: 'S',
    payload: exact({ family_mode: isBool, phrase_count: isInt(0, 10), cues_max: oneOf(3) }),
  },
  'session.state': {
    role: 'tv',
    ids: 'S',
    payload: exact({
      stage: oneOf(...TV_STAGES),
      phrase_position: isInt(0, 10),
      cues_used: isInt(0, 3),
      listener_open_attempt: nullable(isStr(3, 42, ID_PATTERNS.attempt)),
    }),
  },
  'precheck.start': {
    role: 'tv',
    ids: 'SWA',
    payload: exact({ purpose: oneOf('quiet_check', 'pre_window'), duration_ms: oneOf(2000, 5000) }),
    refine: (p) => (p['purpose'] === 'quiet_check' ? p['duration_ms'] === 5000 : p['duration_ms'] === 2000),
  },
  'window.start': {
    role: 'tv',
    ids: 'SWA',
    payload: exact({
      kind: oneOf('calibration', 'vowel', 'phrase'),
      phrase_position: nullable(isInt(1, 10)),
      max_duration_ms: isInt(1, 30000),
      vad_floor_dbfs: isNum(-140, 0),
    }),
    refine: (p) => {
      const kind = p['kind'];
      const max = p['max_duration_ms'] as number;
      if (kind !== 'phrase' && p['phrase_position'] !== null) return false;
      if (kind === 'calibration') return max === 6000;
      if (kind === 'phrase') return max === 8000;
      return max <= 30000;
    },
  },
  'window.stop': { role: 'tv', ids: 'SWA', payload: exact({ reason: oneOf('complete', 'early_stop') }) },
  'window.cancel': {
    role: 'tv',
    ids: 'SWA',
    payload: exact({ reason: oneOf('user_cancel', 'interrupted', 'link_lost', 'timeout', 'session_end') }),
  },
  'listener.open': { role: 'tv', ids: 'SWA', payload: exact({ timeout_ms: isInt(5000, 60000) }) },
  'attempt.reveal': { role: 'tv', ids: 'SWA', payload: exact({}) },
  'session.end': {
    role: 'tv',
    ids: 'S',
    payload: exact({ reason: oneOf('completed', 'user_exit', 'discarded', 'error') }),
  },
  ack: {
    role: 'tv',
    ids: 'ack',
    payload: exact({
      acked_message_id: isStr(3, 34, ID_PATTERNS.message),
      outcome: oneOf('applied', 'ignored_stale', 'rejected'),
      detail: isStr(0, 64),
    }),
  },
};

const ENVELOPE_KEYS = [
  'protocol_version',
  'type',
  'message_id',
  'room_id',
  'session_id',
  'window_id',
  'attempt_id',
  'sender_role',
  'producer_generation',
  'sequence',
  'event_timestamp',
  'payload',
] as const;

const idOk = (v: unknown, re: RegExp): boolean => v === null || (typeof v === 'string' && re.test(v));

/**
 * Parses one text frame from the relay. Strict: exact envelope fields, known inbound type,
 * identity-binding rules, role/direction, and exact payload keys. Returns a reason on failure.
 */
export function parseIncoming(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > LIMITS.messageMaxBytes) return { ok: false, reason: 'too_large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!isObj(raw)) return { ok: false, reason: 'not_object' };
  const keys = Object.keys(raw);
  if (keys.length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((k) => keys.includes(k))) {
    return { ok: false, reason: 'bad_envelope_fields' };
  }
  if (raw['protocol_version'] !== PROTOCOL_VERSION) return { ok: false, reason: 'bad_version' };
  const type = raw['type'];
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(INBOUND, type)) {
    return { ok: false, reason: 'unknown_type' };
  }
  const spec = INBOUND[type as InboundType];
  if (!isStr(3, 34, ID_PATTERNS.message)(raw['message_id'])) return { ok: false, reason: 'bad_message_id' };
  if (!idOk(raw['room_id'], ID_PATTERNS.room)) return { ok: false, reason: 'bad_room_id' };
  if (!idOk(raw['session_id'], ID_PATTERNS.session)) return { ok: false, reason: 'bad_session_id' };
  if (!idOk(raw['window_id'], ID_PATTERNS.window)) return { ok: false, reason: 'bad_window_id' };
  if (!idOk(raw['attempt_id'], ID_PATTERNS.attempt)) return { ok: false, reason: 'bad_attempt_id' };
  if (raw['sender_role'] !== spec.role) return { ok: false, reason: 'bad_sender_role' };
  if (!isInt(0, MAX_GEN)(raw['producer_generation'])) return { ok: false, reason: 'bad_generation' };
  if (!isInt(0, Number.MAX_SAFE_INTEGER)(raw['sequence'])) return { ok: false, reason: 'bad_sequence' };
  if (!isInt(0, Number.MAX_SAFE_INTEGER)(raw['event_timestamp'])) return { ok: false, reason: 'bad_timestamp' };

  const s = raw['session_id'] !== null;
  const w = raw['window_id'] !== null;
  const a = raw['attempt_id'] !== null;
  switch (spec.ids) {
    case 'none':
      if (s || w || a) return { ok: false, reason: 'identity_binding' };
      break;
    case 'S':
      if (!s || w || a) return { ok: false, reason: 'identity_binding' };
      break;
    case 'SWA':
      if (!s || !w || !a) return { ok: false, reason: 'identity_binding' };
      break;
    case 'ack':
      break;
  }
  if (!spec.payload(raw['payload'])) return { ok: false, reason: 'bad_payload' };
  if (spec.refine && !spec.refine(raw['payload'] as Record<string, unknown>)) {
    return { ok: false, reason: 'bad_payload' };
  }
  return { ok: true, message: raw as unknown as InboundMessage };
}

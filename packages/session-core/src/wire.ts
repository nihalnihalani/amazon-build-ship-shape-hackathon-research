/**
 * Internal wire boundary for the TV session core.
 *
 * This file implements, minimally and against docs/PROTOCOL.md rev 1 field names, the two things
 * the session core needs from the protocol package:
 *   - parseInbound(raw)  : validate and type a message that arrived for the TV
 *   - encodeOutbound(..) : stamp and serialize a TV message
 * The lead swaps these two functions (and the payload types) for @atr/protocol at integration.
 * Nothing else in session-core builds or inspects raw envelopes.
 */

import { MAX_LEVEL_FRAMES, MAX_MESSAGE_BYTES } from './constants.js';

/* ------------------------------------------------------------------ identifiers */

export interface Ids {
  sessionId?: string | null;
  windowId?: string | null;
  attemptId?: string | null;
}

const RE_MESSAGE = /^m_[A-Za-z0-9_-]{16,32}$/;
const RE_ROOM = /^r_[A-Za-z0-9_-]{16,32}$/;
const RE_SESSION = /^s_[A-Za-z0-9_-]{8,40}$/;
const RE_WINDOW = /^w_[A-Za-z0-9_-]{8,40}$/;
const RE_ATTEMPT = /^a_[A-Za-z0-9_-]{8,40}$/;

/* ------------------------------------------------------------------ payload types (PROTOCOL.md §3) */

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

export type MicMode = 'physical_phone' | 'same_host' | 'fixture_replay';

export interface MicStatePayload {
  state: MicStateName;
  mode: MicMode;
  visibility: 'visible' | 'hidden';
  wake_lock: string;
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

export type WindowInvalidReason =
  | 'no_voice'
  | 'clipped'
  | 'low_coverage'
  | 'continuous_sound'
  | 'nonfinite'
  | 'interrupted';

export type WindowKind = 'calibration' | 'vowel' | 'phrase';

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

export interface LevelPayload {
  frame_index: number;
  t_audio_ms: number;
  dbfs: number;
  active: boolean;
  clipped: boolean;
}

export type AckOutcome = 'applied' | 'ignored_stale' | 'rejected';

export interface Envelope {
  type: string;
  messageId: string;
  roomId: string | null;
  sessionId: string | null;
  windowId: string | null;
  attemptId: string | null;
  senderRole: 'tv' | 'phone' | 'relay';
  generation: number;
  sequence: number;
  timestamp: number;
}

export type Inbound = Envelope &
  (
    | {
        type: 'room.created';
        payload: {
          pairingCode: string;
          codeExpiresAt: number;
          credential: string;
          credentialExpiresAt: number;
          generation: number;
        };
      }
    | { type: 'pairing.code'; payload: { pairingCode: string; codeExpiresAt: number } }
    | {
        type: 'join.requested';
        payload: { joinId: string; deviceLabel: string; confirmDigits: string; expiresAt: number };
      }
    | { type: 'join.expired'; payload: { joinId: string } }
    | {
        type: 'auth.ok';
        payload: { role: 'tv' | 'phone'; generation: number; peerConnected: boolean; phonePaired: boolean };
      }
    | { type: 'peer.state'; payload: { role: 'tv' | 'phone'; connected: boolean; generation: number } }
    | { type: 'pong'; payload: { serverTime: number } }
    | { type: 'error'; payload: { code: string; refMessageId: string | null; detail: string } }
    | { type: 'mic.state'; payload: MicStatePayload }
    | { type: 'precheck.result'; payload: PrecheckResultPayload }
    | { type: 'level'; payload: LevelPayload }
    | { type: 'window.result'; payload: WindowResultPayload }
    | { type: 'listener.response'; payload: { response: 'heard' | 'not_heard' } }
    | { type: 'cue'; payload: { text: unknown } }
    | { type: 'phrases.update'; payload: { phrases: unknown } }
    | { type: 'ack'; payload: { ackedMessageId: string; outcome: AckOutcome; detail: string } }
  );

export type ParseResult = { ok: true; message: Inbound } | { ok: false; reason: string };

/* ------------------------------------------------------------------ small validators */

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(obj: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  if (own.length !== keys.length) return false;
  for (const key of keys) if (!(key in obj)) return false;
  return true;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T =>
  typeof v === 'string' && (set as readonly string[]).includes(v);

const MIC_STATES: readonly MicStateName[] = [
  'off',
  'permission_pending',
  'permission_denied',
  'no_input',
  'input_busy',
  'constraints_unsupported',
  'open_idle',
  'measuring',
  'error',
];
const MIC_MODES: readonly MicMode[] = ['physical_phone', 'same_host', 'fixture_replay'];
const PRECHECK_REASONS: readonly PrecheckInvalidReason[] = [
  'low_coverage',
  'clipped',
  'unstable_floor',
  'burst_noise',
  'too_loud',
  'nonfinite',
  'interrupted',
];
const WINDOW_REASONS: readonly WindowInvalidReason[] = [
  'no_voice',
  'clipped',
  'low_coverage',
  'continuous_sound',
  'nonfinite',
  'interrupted',
];

/* ------------------------------------------------------------------ payload parsers */

type PayloadParser = (p: Obj) => unknown | null;

const parsers: Record<string, PayloadParser> = {
  'room.created': (p) => {
    if (!exactKeys(p, ['room_id', 'pairing_code', 'code_expires_at', 'tv_credential', 'credential_expires_at', 'generation']))
      return null;
    if (!isStr(p.room_id) || !RE_ROOM.test(p.room_id)) return null;
    if (!isStr(p.pairing_code) || p.pairing_code.length !== 6) return null;
    if (!isInt(p.code_expires_at) || !isStr(p.tv_credential) || p.tv_credential.length !== 43) return null;
    if (!isInt(p.credential_expires_at) || !isInt(p.generation) || p.generation < 0) return null;
    return {
      pairingCode: p.pairing_code,
      codeExpiresAt: p.code_expires_at,
      credential: p.tv_credential,
      credentialExpiresAt: p.credential_expires_at,
      generation: p.generation,
    };
  },
  'pairing.code': (p) => {
    if (!exactKeys(p, ['pairing_code', 'code_expires_at'])) return null;
    if (!isStr(p.pairing_code) || p.pairing_code.length !== 6 || !isInt(p.code_expires_at)) return null;
    return { pairingCode: p.pairing_code, codeExpiresAt: p.code_expires_at };
  },
  'join.requested': (p) => {
    if (!exactKeys(p, ['join_id', 'device_label', 'confirm_digits', 'expires_at'])) return null;
    if (!isStr(p.join_id) || !/^j_[A-Za-z0-9_-]+$/.test(p.join_id)) return null;
    if (!isStr(p.device_label) || p.device_label.length < 1 || p.device_label.length > 96) return null;
    if (!isStr(p.confirm_digits) || !/^[0-9]{2}$/.test(p.confirm_digits)) return null;
    if (!isInt(p.expires_at)) return null;
    return {
      joinId: p.join_id,
      deviceLabel: p.device_label,
      confirmDigits: p.confirm_digits,
      expiresAt: p.expires_at,
    };
  },
  'join.expired': (p) => {
    if (!exactKeys(p, ['join_id']) || !isStr(p.join_id)) return null;
    return { joinId: p.join_id };
  },
  'auth.ok': (p) => {
    if (!exactKeys(p, ['role', 'generation', 'peer_connected', 'phone_paired'])) return null;
    if (!oneOf(p.role, ['tv', 'phone'] as const) || !isInt(p.generation)) return null;
    if (!isBool(p.peer_connected) || !isBool(p.phone_paired)) return null;
    return {
      role: p.role,
      generation: p.generation,
      peerConnected: p.peer_connected,
      phonePaired: p.phone_paired,
    };
  },
  'peer.state': (p) => {
    if (!exactKeys(p, ['role', 'connected', 'generation'])) return null;
    if (!oneOf(p.role, ['tv', 'phone'] as const) || !isBool(p.connected) || !isInt(p.generation)) return null;
    return { role: p.role, connected: p.connected, generation: p.generation };
  },
  pong: (p) => {
    if (!exactKeys(p, ['server_time']) || !isInt(p.server_time)) return null;
    return { serverTime: p.server_time };
  },
  error: (p) => {
    if (!exactKeys(p, ['code', 'ref_message_id', 'detail'])) return null;
    if (!isStr(p.code) || !(p.ref_message_id === null || isStr(p.ref_message_id)) || !isStr(p.detail)) return null;
    return { code: p.code, refMessageId: p.ref_message_id, detail: p.detail };
  },
  'mic.state': (p) => {
    if (!exactKeys(p, ['state', 'settings', 'supported', 'wake_lock', 'visibility', 'mode'])) return null;
    if (!oneOf(p.state, MIC_STATES) || !oneOf(p.mode, MIC_MODES)) return null;
    if (!isObj(p.settings) || !isObj(p.supported) || !isStr(p.wake_lock)) return null;
    if (!oneOf(p.visibility, ['visible', 'hidden'] as const)) return null;
    return { state: p.state, mode: p.mode, visibility: p.visibility, wake_lock: p.wake_lock };
  },
  'precheck.result': (p) => {
    const keys = [
      'purpose',
      'valid',
      'invalid_reason',
      'floor_dbfs',
      'p20_dbfs',
      'p80_dbfs',
      'p95_dbfs',
      'frame_count',
      'expected_frames',
      'coverage',
      'clipped_frames',
      'nonfinite_frames',
      'duration_ms',
    ];
    if (!exactKeys(p, keys)) return null;
    if (!oneOf(p.purpose, ['quiet_check', 'pre_window'] as const) || !isBool(p.valid)) return null;
    if (!(p.invalid_reason === null || oneOf(p.invalid_reason, PRECHECK_REASONS))) return null;
    if (![p.floor_dbfs, p.p20_dbfs, p.p80_dbfs, p.p95_dbfs].every(isNumOrNull)) return null;
    if (!isInt(p.frame_count) || !isInt(p.expected_frames) || !inRange(p.coverage, 0, 1)) return null;
    if (!isInt(p.clipped_frames) || !isInt(p.nonfinite_frames) || !isNum(p.duration_ms)) return null;
    return p as unknown as PrecheckResultPayload;
  },
  level: (p) => {
    if (!exactKeys(p, ['frame_index', 't_audio_ms', 'dbfs', 'active', 'clipped'])) return null;
    if (!isInt(p.frame_index) || p.frame_index < 0 || p.frame_index > MAX_LEVEL_FRAMES) return null;
    if (!inRange(p.t_audio_ms, 0, 35000) || !inRange(p.dbfs, -140, 20)) return null;
    if (!isBool(p.active) || !isBool(p.clipped)) return null;
    return p as unknown as LevelPayload;
  },
  'window.result': (p) => {
    const keys = [
      'kind',
      'valid',
      'invalid_reason',
      'frame_count',
      'expected_frames',
      'coverage',
      'active_ms',
      'longest_active_ms',
      'segments',
      'onset_ms',
      'p50_active_dbfs',
      'p95_active_dbfs',
      'peak_dbfs',
      'clipped_frames',
      'nonfinite_frames',
      'duration_ms',
    ];
    if (!exactKeys(p, keys)) return null;
    if (!oneOf(p.kind, ['calibration', 'vowel', 'phrase'] as const) || !isBool(p.valid)) return null;
    if (!(p.invalid_reason === null || oneOf(p.invalid_reason, WINDOW_REASONS))) return null;
    if (!isInt(p.frame_count) || !isInt(p.expected_frames) || !inRange(p.coverage, 0, 1)) return null;
    if (!isNum(p.active_ms) || !isNum(p.longest_active_ms) || !isInt(p.segments)) return null;
    if (![p.onset_ms, p.p50_active_dbfs, p.p95_active_dbfs, p.peak_dbfs].every(isNumOrNull)) return null;
    if (!isInt(p.clipped_frames) || !isInt(p.nonfinite_frames) || !isNum(p.duration_ms)) return null;
    return p as unknown as WindowResultPayload;
  },
  'listener.response': (p) => {
    if (!exactKeys(p, ['response']) || !oneOf(p.response, ['heard', 'not_heard'] as const)) return null;
    return { response: p.response };
  },
  cue: (p) => {
    if (!exactKeys(p, ['text'])) return null;
    return { text: p.text };
  },
  'phrases.update': (p) => {
    if (!exactKeys(p, ['phrases'])) return null;
    return { phrases: p.phrases };
  },
  ack: (p) => {
    if (!exactKeys(p, ['acked_message_id', 'outcome', 'detail'])) return null;
    if (!isStr(p.acked_message_id) || !oneOf(p.outcome, ['applied', 'ignored_stale', 'rejected'] as const)) return null;
    if (!isStr(p.detail)) return null;
    return { ackedMessageId: p.acked_message_id, outcome: p.outcome, detail: p.detail };
  },
};

/** Identity binding per inbound type: S, W, A each 'req' (non-null), 'nul' (must be null) or 'opt'. */
type Bind = 'req' | 'nul' | 'opt';
const BINDING: Record<string, { ids: [Bind, Bind, Bind]; role: 'phone' | 'relay' }> = {
  'room.created': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'pairing.code': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'join.requested': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'join.expired': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'auth.ok': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'peer.state': { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  pong: { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  error: { ids: ['nul', 'nul', 'nul'], role: 'relay' },
  'mic.state': { ids: ['opt', 'nul', 'nul'], role: 'phone' },
  'precheck.result': { ids: ['req', 'req', 'req'], role: 'phone' },
  level: { ids: ['req', 'req', 'req'], role: 'phone' },
  'window.result': { ids: ['req', 'req', 'req'], role: 'phone' },
  'listener.response': { ids: ['req', 'req', 'req'], role: 'phone' },
  cue: { ids: ['req', 'nul', 'nul'], role: 'phone' },
  'phrases.update': { ids: ['nul', 'nul', 'nul'], role: 'phone' },
  ack: { ids: ['opt', 'opt', 'opt'], role: 'phone' },
};

function checkBinding(value: unknown, rule: Bind, re: RegExp): { ok: boolean; id: string | null } {
  if (value === null) return { ok: rule !== 'req', id: null };
  if (rule === 'nul') return { ok: false, id: null };
  if (typeof value !== 'string' || !re.test(value)) return { ok: false, id: null };
  return { ok: true, id: value };
}

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

/** Parses a serialized message or an already-decoded object for the TV. */
export function parseInbound(raw: unknown): ParseResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'payload_too_large' };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'bad_json' };
    }
  }
  if (!isObj(value)) return { ok: false, reason: 'not_an_object' };
  if (!exactKeys(value, ENVELOPE_KEYS)) return { ok: false, reason: 'bad_schema' };
  if (value.protocol_version !== 1) return { ok: false, reason: 'bad_version' };
  if (!isStr(value.type)) return { ok: false, reason: 'bad_schema' };
  const rule = BINDING[value.type];
  const parser = parsers[value.type];
  if (!rule || !parser) return { ok: false, reason: 'unknown_type' };
  if (!isStr(value.message_id) || !RE_MESSAGE.test(value.message_id)) return { ok: false, reason: 'bad_message_id' };
  if (value.sender_role !== rule.role) return { ok: false, reason: 'wrong_sender_role' };
  const room = value.room_id === null ? { ok: true, id: null } : checkBinding(value.room_id, 'opt', RE_ROOM);
  const session = checkBinding(value.session_id, rule.ids[0], RE_SESSION);
  const window = checkBinding(value.window_id, rule.ids[1], RE_WINDOW);
  const attempt = checkBinding(value.attempt_id, rule.ids[2], RE_ATTEMPT);
  if (!room.ok || !session.ok || !window.ok || !attempt.ok) return { ok: false, reason: 'bad_identity' };
  if (!isInt(value.producer_generation) || value.producer_generation < 0) return { ok: false, reason: 'bad_generation' };
  if (!isInt(value.sequence) || value.sequence < 0) return { ok: false, reason: 'bad_sequence' };
  if (!isInt(value.event_timestamp)) return { ok: false, reason: 'bad_timestamp' };
  if (!isObj(value.payload)) return { ok: false, reason: 'bad_payload' };
  const payload = parser(value.payload);
  if (payload === null) return { ok: false, reason: 'bad_payload' };
  const message = {
    type: value.type,
    messageId: value.message_id,
    roomId: room.id,
    sessionId: session.id,
    windowId: window.id,
    attemptId: attempt.id,
    senderRole: value.sender_role,
    generation: value.producer_generation,
    sequence: value.sequence,
    timestamp: value.event_timestamp,
    payload,
  } as unknown as Inbound;
  return { ok: true, message };
}

/* ------------------------------------------------------------------ outbound */

export type TvStageName = string;

export type Outbound =
  | { type: 'room.create'; payload: { client: { app_version: string; platform: 'vega' | 'web_preview' | 'test' } } }
  | { type: 'auth.resume'; payload: { room_id: string; role: 'tv'; credential: string } }
  | { type: 'pairing.refresh'; payload: Record<string, never> }
  | { type: 'join.confirm'; payload: { join_id: string; decision: 'accept' | 'reject' } }
  | { type: 'unpair'; payload: Record<string, never> }
  | { type: 'room.close'; payload: Record<string, never> }
  | { type: 'ping'; payload: Record<string, never> }
  | { type: 'session.begin'; ids: Ids; payload: { family_mode: boolean; phrase_count: number; cues_max: 3 } }
  | {
      type: 'session.state';
      ids: Ids;
      payload: { stage: TvStageName; phrase_position: number; cues_used: number; listener_open_attempt: string | null };
    }
  | {
      type: 'precheck.start';
      ids: Ids;
      payload: { purpose: 'quiet_check' | 'pre_window'; duration_ms: 2000 | 5000 };
    }
  | {
      type: 'window.start';
      ids: Ids;
      payload: { kind: WindowKind; phrase_position: number | null; max_duration_ms: number; vad_floor_dbfs: number };
    }
  | { type: 'window.stop'; ids: Ids; payload: { reason: 'complete' | 'early_stop' } }
  | {
      type: 'window.cancel';
      ids: Ids;
      payload: { reason: 'user_cancel' | 'interrupted' | 'link_lost' | 'timeout' | 'session_end' };
    }
  | { type: 'listener.open'; ids: Ids; payload: { timeout_ms: number } }
  | { type: 'attempt.reveal'; ids: Ids; payload: Record<string, never> }
  | { type: 'session.end'; ids: Ids; payload: { reason: 'completed' | 'user_exit' | 'discarded' | 'error' } }
  | { type: 'ack'; ids: Ids; payload: { acked_message_id: string; outcome: AckOutcome; detail: string } };

export interface Stamp {
  messageId: string;
  roomId: string | null;
  generation: number;
  sequence: number;
  now: number;
}

/** Serializes a TV message with its envelope. */
export function encodeOutbound(message: Outbound, stamp: Stamp): string {
  const ids: Ids = 'ids' in message ? message.ids : {};
  return JSON.stringify({
    protocol_version: 1,
    type: message.type,
    message_id: stamp.messageId,
    room_id: stamp.roomId,
    session_id: ids.sessionId ?? null,
    window_id: ids.windowId ?? null,
    attempt_id: ids.attemptId ?? null,
    sender_role: 'tv',
    producer_generation: stamp.generation,
    sequence: stamp.sequence,
    event_timestamp: stamp.now,
    payload: message.payload,
  });
}

/** True for the pre-authentication messages (they carry generation 0 and no room). */
export function isPreAuth(message: Outbound): boolean {
  return message.type === 'room.create' || message.type === 'auth.resume';
}

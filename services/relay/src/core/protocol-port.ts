/**
 * Protocol port: the single file through which the relay core touches the wire protocol.
 *
 * This is a minimal, self-contained implementation of docs/PROTOCOL.md revision 1 (sections 1, 3, 4, 7).
 * When `@atr/protocol` (parseWireMessage, catalogue/direction helpers) is merged, this file is the only
 * one that must change: re-export or adapt the package functions behind the same names below.
 *
 * The port validates steps 1-6 of PROTOCOL.md section 4 (frame, JSON, envelope, type, audio guard, envelope
 * formats and identity binding, payload schema). Direction/auth, generation/sequence, dedupe and rate limits
 * (steps 7-9) need connection state and are implemented by the core.
 *
 * Error `detail` strings produced here are constant strings chosen from this file. They never echo input.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 8192;
export const PAIRING_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
export const PAIRING_CODE_LENGTH = 6;
export const CREDENTIAL_CHARS = 43;

export const ERROR_CODES = [
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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Role = 'tv' | 'phone' | 'relay';
export const ROLES: readonly Role[] = ['tv', 'phone', 'relay'];

const TV_STAGES = [
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
] as const;

// ---------------------------------------------------------------------------------------------
// Identifier patterns (PROTOCOL.md section 1)
// ---------------------------------------------------------------------------------------------

export const RE_MESSAGE_ID = /^m_[A-Za-z0-9_-]{16,32}$/;
export const RE_ROOM_ID = /^r_[A-Za-z0-9_-]{16,32}$/;
export const RE_SESSION_ID = /^s_[A-Za-z0-9_-]{8,40}$/;
export const RE_WINDOW_ID = /^w_[A-Za-z0-9_-]{8,40}$/;
export const RE_ATTEMPT_ID = /^a_[A-Za-z0-9_-]{8,40}$/;
export const RE_JOIN_ID = /^j_[A-Za-z0-9_-]{16,32}$/;
const RE_CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const RE_PAIRING_CODE = /^[ACDEFHJKMNPRTUVWXY3479]{6}$/;
const RE_CONFIRM_DIGITS = /^[0-9]{2}$/;

// ---------------------------------------------------------------------------------------------
// Mini schema language
// ---------------------------------------------------------------------------------------------

type Schema =
  | { k: 'str'; min: number; max: number }
  | { k: 'pat'; re: RegExp }
  | { k: 'enum'; values: readonly (string | number)[] }
  | { k: 'int'; min: number; max: number }
  | { k: 'num'; min: number; max: number }
  | { k: 'bool' }
  | { k: 'null' }
  | { k: 'or'; of: readonly Schema[] }
  | { k: 'obj'; fields: Record<string, Schema>; refine?: (v: Record<string, unknown>) => string | null }
  | { k: 'arr'; of: Schema; min: number; max: number };

const str = (min: number, max: number): Schema => ({ k: 'str', min, max });
const pat = (re: RegExp): Schema => ({ k: 'pat', re });
const en = (...values: (string | number)[]): Schema => ({ k: 'enum', values });
const int = (min: number, max: number): Schema => ({ k: 'int', min, max });
const num = (min: number, max: number): Schema => ({ k: 'num', min, max });
const bool: Schema = { k: 'bool' };
const nul: Schema = { k: 'null' };
const or = (...of: Schema[]): Schema => ({ k: 'or', of });
const nullable = (s: Schema): Schema => or(s, nul);
const arr = (of: Schema, min: number, max: number): Schema => ({ k: 'arr', of, min, max });
const obj = (fields: Record<string, Schema>, refine?: (v: Record<string, unknown>) => string | null): Schema => ({
  k: 'obj',
  fields,
  ...(refine ? { refine } : {}),
});

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** Length in Unicode code points. */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Returns null when valid, otherwise a constant path label (never input text). */
function check(schema: Schema, value: unknown, path: string): string | null {
  switch (schema.k) {
    case 'str': {
      if (typeof value !== 'string') return path;
      if (CONTROL_CHARS.test(value)) return path;
      const n = codePointLength(value.normalize('NFC').trim());
      return n >= schema.min && n <= schema.max ? null : path;
    }
    case 'pat':
      return typeof value === 'string' && schema.re.test(value) ? null : path;
    case 'enum':
      return (typeof value === 'string' || typeof value === 'number') && schema.values.includes(value) ? null : path;
    case 'int':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= schema.min && value <= schema.max
        ? null
        : path;
    case 'num':
      return typeof value === 'number' && Number.isFinite(value) && value >= schema.min && value <= schema.max
        ? null
        : path;
    case 'bool':
      return typeof value === 'boolean' ? null : path;
    case 'null':
      return value === null ? null : path;
    case 'or': {
      for (const s of schema.of) {
        if (check(s, value, path) === null) return null;
      }
      return path;
    }
    case 'arr': {
      if (!Array.isArray(value) || value.length < schema.min || value.length > schema.max) return path;
      for (let i = 0; i < value.length; i += 1) {
        const r = check(schema.of, value[i], path);
        if (r !== null) return r;
      }
      return null;
    }
    case 'obj': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return path;
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o);
      const expected = Object.keys(schema.fields);
      if (keys.length !== expected.length) return `${path}.keys`;
      for (const k of keys) if (!hasOwn(schema.fields, k)) return `${path}.keys`;
      for (const k of expected) {
        if (!hasOwn(o, k)) return `${path}.${k}`;
        const f = schema.fields[k];
        if (!f) return path;
        const r = check(f, o[k], `${path}.${k}`);
        if (r !== null) return r;
      }
      if (schema.refine) {
        const r = schema.refine(o);
        if (r !== null) return `${path}.${r}`;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Payload schemas (PROTOCOL.md section 3)
// ---------------------------------------------------------------------------------------------

const msgIdStr = pat(RE_MESSAGE_ID);
const attemptIdStr = pat(RE_ATTEMPT_ID);
const intLarge = int(0, 1_000_000);
const nullableDbfs = nullable(num(-200, 200));
const unixMs = int(0, 8_640_000_000_000_000);

const micState = obj({
  state: en(
    'off',
    'permission_pending',
    'permission_denied',
    'no_input',
    'input_busy',
    'constraints_unsupported',
    'open_idle',
    'measuring',
    'error',
  ),
  settings: obj({
    auto_gain_control: nullable(bool),
    echo_cancellation: nullable(bool),
    noise_suppression: nullable(bool),
    sample_rate: nullable(num(0, 1_000_000)),
    channel_count: nullable(num(0, 64)),
  }),
  supported: obj({ auto_gain_control: bool, echo_cancellation: bool, noise_suppression: bool }),
  wake_lock: en('held', 'released', 'unsupported', 'rejected', 'not_requested'),
  visibility: en('visible', 'hidden'),
  mode: en('physical_phone', 'same_host', 'fixture_replay'),
});

const precheckResult = obj({
  purpose: en('quiet_check', 'pre_window'),
  valid: bool,
  invalid_reason: nullable(
    en('low_coverage', 'clipped', 'unstable_floor', 'burst_noise', 'too_loud', 'nonfinite', 'interrupted'),
  ),
  floor_dbfs: nullableDbfs,
  p20_dbfs: nullableDbfs,
  p80_dbfs: nullableDbfs,
  p95_dbfs: nullableDbfs,
  frame_count: intLarge,
  expected_frames: intLarge,
  coverage: num(0, 1),
  clipped_frames: intLarge,
  nonfinite_frames: intLarge,
  duration_ms: num(0, 1_000_000),
});

const windowResult = obj({
  kind: en('calibration', 'vowel', 'phrase'),
  valid: bool,
  invalid_reason: nullable(
    en('no_voice', 'clipped', 'low_coverage', 'continuous_sound', 'nonfinite', 'interrupted'),
  ),
  frame_count: intLarge,
  expected_frames: intLarge,
  coverage: num(0, 1),
  active_ms: num(0, 1_000_000),
  longest_active_ms: num(0, 1_000_000),
  segments: intLarge,
  onset_ms: nullable(num(0, 1_000_000)),
  p50_active_dbfs: nullableDbfs,
  p95_active_dbfs: nullableDbfs,
  peak_dbfs: nullableDbfs,
  clipped_frames: intLarge,
  nonfinite_frames: intLarge,
  duration_ms: num(0, 1_000_000),
});

const windowStart = obj(
  {
    kind: en('calibration', 'vowel', 'phrase'),
    phrase_position: nullable(int(1, 10)),
    max_duration_ms: int(1, 30_000),
    vad_floor_dbfs: num(-140, 0),
  },
  (p) => {
    const { kind, max_duration_ms: dur, phrase_position: pos } = p;
    if (kind === 'calibration' && dur !== 6000) return 'max_duration_ms';
    if (kind === 'phrase' && dur !== 8000) return 'max_duration_ms';
    if ((kind === 'phrase') !== (pos !== null)) return 'phrase_position';
    return null;
  },
);

const precheckStart = obj(
  { purpose: en('quiet_check', 'pre_window'), duration_ms: en(2000, 5000) },
  (p) => {
    if (p.purpose === 'quiet_check' && p.duration_ms !== 5000) return 'duration_ms';
    if (p.purpose === 'pre_window' && p.duration_ms !== 2000) return 'duration_ms';
    return null;
  },
);

const emptyObj = obj({});

// ---------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------

type IdRule = 'req' | 'nul' | 'opt';
export type AuthRule = 'pre' | 'auth' | 'any' | 'none';
export type RouteRule = 'relay' | 'forward' | 'originated';

export interface TypeSpec {
  /** Roles allowed to send this type over the wire. Relay-originated types list only `relay`. */
  readonly senders: readonly Role[];
  /** pre = allowed only before authentication, auth = only after, any = both, none = relay-originated. */
  readonly auth: AuthRule;
  /** relay = consumed by the relay, forward = forwarded to the peer unchanged, originated = relay-created. */
  readonly route: RouteRule;
  readonly room: IdRule;
  readonly ids: readonly [IdRule, IdRule, IdRule];
  readonly payload: Schema;
}

const NUL3 = ['nul', 'nul', 'nul'] as const;
const REQ3 = ['req', 'req', 'req'] as const;
const SESSION_ONLY = ['req', 'nul', 'nul'] as const;

const TV: readonly Role[] = ['tv'];
const PHONE: readonly Role[] = ['phone'];
const BOTH: readonly Role[] = ['tv', 'phone'];
const RELAY: readonly Role[] = ['relay'];

function spec(
  senders: readonly Role[],
  auth: AuthRule,
  route: RouteRule,
  ids: readonly [IdRule, IdRule, IdRule],
  payload: Schema,
  room: IdRule = 'req',
): TypeSpec {
  return { senders, auth, route, room, ids, payload };
}

const originated = (payload: Schema): TypeSpec => spec(RELAY, 'none', 'originated', NUL3, payload, 'opt');

export const TYPE_SPECS = {
  // 3.1 connection, pairing and lifecycle
  'room.create': spec(
    TV,
    'pre',
    'relay',
    NUL3,
    obj({ client: obj({ app_version: str(1, 32), platform: en('vega', 'web_preview', 'test') }) }),
    'nul',
  ),
  'room.created': originated(
    obj({
      room_id: pat(RE_ROOM_ID),
      pairing_code: pat(RE_PAIRING_CODE),
      code_expires_at: unixMs,
      tv_credential: pat(RE_CREDENTIAL),
      credential_expires_at: unixMs,
      generation: int(0, 2 ** 31 - 1),
    }),
  ),
  'pairing.refresh': spec(TV, 'auth', 'relay', NUL3, emptyObj),
  'pairing.code': originated(obj({ pairing_code: pat(RE_PAIRING_CODE), code_expires_at: unixMs })),
  'join.request': spec(
    PHONE,
    'pre',
    'relay',
    NUL3,
    obj({ pairing_code: pat(RE_PAIRING_CODE), device_label: str(1, 24) }),
    'nul',
  ),
  'join.pending': originated(
    obj({ join_id: pat(RE_JOIN_ID), confirm_digits: pat(RE_CONFIRM_DIGITS), expires_at: unixMs }),
  ),
  'join.requested': originated(
    obj({
      join_id: pat(RE_JOIN_ID),
      device_label: str(1, 24),
      confirm_digits: pat(RE_CONFIRM_DIGITS),
      expires_at: unixMs,
    }),
  ),
  'join.confirm': spec(TV, 'auth', 'relay', NUL3, obj({ join_id: pat(RE_JOIN_ID), decision: en('accept', 'reject') })),
  'join.accepted': originated(
    obj({
      room_id: pat(RE_ROOM_ID),
      phone_credential: pat(RE_CREDENTIAL),
      credential_expires_at: unixMs,
      generation: int(0, 2 ** 31 - 1),
    }),
  ),
  'join.rejected': originated(obj({ reason: en('rejected', 'expired', 'room_full', 'busy') })),
  'join.expired': originated(obj({ join_id: pat(RE_JOIN_ID) })),
  'auth.resume': spec(
    BOTH,
    'pre',
    'relay',
    NUL3,
    obj({ room_id: pat(RE_ROOM_ID), role: en('tv', 'phone'), credential: pat(RE_CREDENTIAL) }),
    'nul',
  ),
  'auth.ok': originated(
    obj({ role: en('tv', 'phone'), generation: int(0, 2 ** 31 - 1), peer_connected: bool, phone_paired: bool }),
  ),
  'peer.state': originated(obj({ role: en('tv', 'phone'), connected: bool, generation: int(0, 2 ** 31 - 1) })),
  unpair: spec(TV, 'auth', 'relay', NUL3, emptyObj),
  unpaired: originated(obj({ reason: en('tv_unpaired', 'room_closed', 'expired') })),
  'room.close': spec(TV, 'auth', 'relay', NUL3, emptyObj),
  ping: spec(BOTH, 'any', 'relay', NUL3, emptyObj, 'opt'),
  pong: originated(obj({ server_time: unixMs })),
  error: originated(
    obj({
      code: en(...ERROR_CODES),
      ref_message_id: nullable(msgIdStr),
      detail: str(0, 64),
    }),
  ),

  // 3.2 session commands (TV -> phone)
  'session.begin': spec(
    TV,
    'auth',
    'forward',
    SESSION_ONLY,
    obj({ family_mode: bool, phrase_count: int(0, 10), cues_max: en(3) }),
  ),
  'session.state': spec(
    TV,
    'auth',
    'forward',
    SESSION_ONLY,
    obj({
      stage: en(...TV_STAGES),
      phrase_position: int(0, 10),
      cues_used: int(0, 3),
      listener_open_attempt: nullable(attemptIdStr),
    }),
  ),
  'precheck.start': spec(TV, 'auth', 'forward', REQ3, precheckStart),
  'window.start': spec(TV, 'auth', 'forward', REQ3, windowStart),
  'window.stop': spec(TV, 'auth', 'forward', REQ3, obj({ reason: en('complete', 'early_stop') })),
  'window.cancel': spec(
    TV,
    'auth',
    'forward',
    REQ3,
    obj({ reason: en('user_cancel', 'interrupted', 'link_lost', 'timeout', 'session_end') }),
  ),
  'listener.open': spec(TV, 'auth', 'forward', REQ3, obj({ timeout_ms: int(5000, 60000) })),
  'attempt.reveal': spec(TV, 'auth', 'forward', REQ3, emptyObj),
  'session.end': spec(
    TV,
    'auth',
    'forward',
    SESSION_ONLY,
    obj({ reason: en('completed', 'user_exit', 'discarded', 'error') }),
  ),

  // 3.3 phone observations (phone -> TV)
  'mic.state': spec(PHONE, 'auth', 'forward', ['opt', 'nul', 'nul'], micState),
  'precheck.result': spec(PHONE, 'auth', 'forward', REQ3, precheckResult),
  level: spec(
    PHONE,
    'auth',
    'forward',
    REQ3,
    obj({
      frame_index: int(0, 700),
      t_audio_ms: num(0, 35_000),
      dbfs: num(-140, 20),
      active: bool,
      clipped: bool,
    }),
  ),
  'window.result': spec(PHONE, 'auth', 'forward', REQ3, windowResult),
  'listener.response': spec(PHONE, 'auth', 'forward', REQ3, obj({ response: en('heard', 'not_heard') })),
  cue: spec(PHONE, 'auth', 'forward', SESSION_ONLY, obj({ text: str(1, 12) })),
  'phrases.update': spec(PHONE, 'auth', 'forward', NUL3, obj({ phrases: arr(str(1, 60), 1, 10) })),
  // ack identity columns are "as acked": any of S/W/A may be set, so they are optional here.
  ack: spec(
    BOTH,
    'auth',
    'forward',
    ['opt', 'opt', 'opt'],
    obj({
      acked_message_id: msgIdStr,
      outcome: en('applied', 'ignored_stale', 'rejected'),
      detail: str(0, 64),
    }),
  ),
} as const satisfies Record<string, TypeSpec>;

export type MessageType = keyof typeof TYPE_SPECS;
export const MESSAGE_TYPES = Object.keys(TYPE_SPECS) as MessageType[];

export function isMessageType(t: unknown): t is MessageType {
  return typeof t === 'string' && hasOwn(TYPE_SPECS, t);
}
export function specOf(type: MessageType): TypeSpec {
  return TYPE_SPECS[type];
}
/** Types a client may legitimately send before authentication. */
export function isPreAuthType(type: MessageType): boolean {
  const a = TYPE_SPECS[type].auth;
  return a === 'pre' || a === 'any';
}

// ---------------------------------------------------------------------------------------------
// Parsing (PROTOCOL.md section 4, steps 1-6)
// ---------------------------------------------------------------------------------------------

export interface Envelope {
  protocol_version: 1;
  type: MessageType;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: Role;
  producer_generation: number;
  sequence: number;
  event_timestamp: number;
  payload: Record<string, unknown>;
}

export interface ParsedMessage {
  /** The exact text received; forwarded to peers unchanged. */
  raw: string;
  bytes: number;
  type: MessageType;
  envelope: Envelope;
  payload: Record<string, unknown>;
}

export interface ParseOk {
  ok: true;
  message: ParsedMessage;
}
export interface ParseFailure {
  ok: false;
  code: ErrorCode;
  detail: string;
  /** message_id of the offending message when it was parseable and well formed. */
  refMessageId: string | null;
  type: MessageType | null;
  bytes: number;
}
export type ParseResult = ParseOk | ParseFailure;

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

const AUDIO_KEYS = new Set(['audio', 'pcm', 'samples', 'waveform', 'blob', 'buffer', 'data']);
const MAX_STRING_CODE_POINTS = 256;
const MAX_ARRAY_LENGTH = 16;
const MAX_PAYLOAD_DEPTH = 8;
const TIMESTAMP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Step 4 audio guard. Returns 'audio', 'depth' or null. Iterative so hostile nesting cannot overflow the stack. */
function audioGuard(payload: unknown): 'audio' | 'depth' | null {
  const stack: { v: unknown; d: number }[] = [{ v: payload, d: 0 }];
  while (stack.length > 0) {
    const top = stack.pop();
    if (!top) break;
    const { v, d } = top;
    if (typeof v === 'string') {
      if (v.length > MAX_STRING_CODE_POINTS && codePointLength(v) > MAX_STRING_CODE_POINTS) return 'audio';
    } else if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY_LENGTH) return 'audio';
      if (d >= MAX_PAYLOAD_DEPTH) return 'depth';
      for (const item of v) stack.push({ v: item, d: d + 1 });
    } else if (typeof v === 'object' && v !== null) {
      if (d >= MAX_PAYLOAD_DEPTH) return 'depth';
      for (const k of Object.keys(v)) {
        if (AUDIO_KEYS.has(k.toLowerCase())) return 'audio';
        stack.push({ v: (v as Record<string, unknown>)[k], d: d + 1 });
      }
    }
  }
  return null;
}

function fail(
  code: ErrorCode,
  detail: string,
  bytes: number,
  refMessageId: string | null = null,
  type: MessageType | null = null,
): ParseFailure {
  return { ok: false, code, detail, refMessageId, type, bytes };
}

function idCheck(rule: IdRule, value: unknown, re: RegExp): boolean {
  if (rule === 'nul') return value === null;
  if (value === null) return rule === 'opt';
  return typeof value === 'string' && re.test(value);
}

export function parseWireText(raw: string, nowMs: number): ParseResult {
  // Step 1 (binary is handled by the caller, which never reaches this function with a non-string).
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_MESSAGE_BYTES) return fail('payload_too_large', 'message_too_large', bytes);

  // Step 2: JSON, top-level object, exact envelope fields, protocol version.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('bad_schema', 'invalid_json', bytes);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('bad_schema', 'not_an_object', bytes);
  }
  const env = parsed as Record<string, unknown>;
  const refMessageId =
    typeof env.message_id === 'string' && RE_MESSAGE_ID.test(env.message_id) ? env.message_id : null;
  const keys = Object.keys(env);
  if (keys.length !== ENVELOPE_KEYS.length) return fail('bad_schema', 'envelope_keys', bytes, refMessageId);
  for (const k of ENVELOPE_KEYS) {
    if (!hasOwn(env, k)) return fail('bad_schema', 'envelope_keys', bytes, refMessageId);
  }
  if (env.protocol_version !== PROTOCOL_VERSION) return fail('bad_schema', 'protocol_version', bytes, refMessageId);
  if (typeof env.type !== 'string') return fail('bad_schema', 'envelope.type', bytes, refMessageId);

  // Step 3: type known.
  if (!isMessageType(env.type)) return fail('unknown_type', 'unknown_type', bytes, refMessageId);
  const type = env.type;
  const ts = TYPE_SPECS[type];

  // Step 4: audio guard (applies to anything inside payload).
  if (typeof env.payload !== 'object' || env.payload === null || Array.isArray(env.payload)) {
    return fail('bad_schema', 'payload', bytes, refMessageId, type);
  }
  const guard = audioGuard(env.payload);
  if (guard === 'audio') return fail('audio_rejected', 'audio_like_payload', bytes, refMessageId, type);
  if (guard === 'depth') return fail('bad_schema', 'payload_depth', bytes, refMessageId, type);

  // Step 5: envelope formats and identity binding.
  if (!idCheck('req', env.message_id, RE_MESSAGE_ID)) return fail('bad_schema', 'envelope.message_id', bytes, null, type);
  if (!idCheck(ts.room, env.room_id, RE_ROOM_ID)) return fail('bad_schema', 'envelope.room_id', bytes, refMessageId, type);
  if (!idCheck(ts.ids[0], env.session_id, RE_SESSION_ID)) return fail('bad_schema', 'envelope.session_id', bytes, refMessageId, type);
  if (!idCheck(ts.ids[1], env.window_id, RE_WINDOW_ID)) return fail('bad_schema', 'envelope.window_id', bytes, refMessageId, type);
  if (!idCheck(ts.ids[2], env.attempt_id, RE_ATTEMPT_ID)) return fail('bad_schema', 'envelope.attempt_id', bytes, refMessageId, type);
  if (typeof env.sender_role !== 'string' || !ROLES.includes(env.sender_role as Role)) {
    return fail('bad_schema', 'envelope.sender_role', bytes, refMessageId, type);
  }
  const gen = env.producer_generation;
  if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen < 0 || gen > 2 ** 31 - 1) {
    return fail('bad_schema', 'envelope.producer_generation', bytes, refMessageId, type);
  }
  if (ts.auth === 'pre' && gen !== 0) return fail('bad_schema', 'envelope.producer_generation', bytes, refMessageId, type);
  const seq = env.sequence;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return fail('bad_schema', 'envelope.sequence', bytes, refMessageId, type);
  }
  const et = env.event_timestamp;
  if (typeof et !== 'number' || !Number.isSafeInteger(et) || Math.abs(et - nowMs) > TIMESTAMP_WINDOW_MS) {
    return fail('bad_schema', 'envelope.event_timestamp', bytes, refMessageId, type);
  }

  // Step 6: payload schema.
  const bad = check(ts.payload, env.payload, 'payload');
  if (bad !== null) return fail('bad_schema', bad.slice(0, 64), bytes, refMessageId, type);

  return {
    ok: true,
    message: {
      raw,
      bytes,
      type,
      envelope: env as unknown as Envelope,
      payload: env.payload as Record<string, unknown>,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Relay-originated messages
// ---------------------------------------------------------------------------------------------

export interface RelayMessageInput {
  type: MessageType;
  messageId: string;
  roomId: string | null;
  sequence: number;
  nowMs: number;
  payload: Record<string, unknown>;
}

/** Serialises a relay-originated envelope: sender_role relay, generation 0, relay's own per-connection sequence. */
export function buildRelayMessage(input: RelayMessageInput): string {
  const envelope: Envelope = {
    protocol_version: 1,
    type: input.type,
    message_id: input.messageId,
    room_id: input.roomId,
    session_id: null,
    window_id: null,
    attempt_id: null,
    sender_role: 'relay',
    producer_generation: 0,
    sequence: input.sequence,
    event_timestamp: input.nowMs,
    payload: input.payload,
  };
  return JSON.stringify(envelope);
}

// ---------------------------------------------------------------------------------------------
// Limits (PROTOCOL.md section 7 / ADR-0003)
// ---------------------------------------------------------------------------------------------

export const LIMITS = {
  maxCuesPerSession: 3,
  /** TV and phone heartbeat: peer considered unknown after this long without traffic. */
  heartbeatWindowMs: 25_000,
  authDeadlineMs: 5_000,
  authDeadlineWhileJoinPendingMs: 65_000,
  maxUnauthenticatedMessages: 5,
  pairingCodeTtlMs: 10 * 60_000,
  joinTtlMs: 60_000,
  credentialTtlMs: 12 * 3_600_000,
  roomTtlMs: 12 * 3_600_000,
  roomIdleCloseMs: 30 * 60_000,
  dedupeWindow: 1024,
} as const;

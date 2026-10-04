/**
 * Message validation (docs/PROTOCOL.md section 4, steps 1 to 6).
 *
 * `parseWireMessage` takes a raw text frame; `validateMessageObject` takes an
 * already-parsed value. Both NEVER throw: every input yields a result.
 *
 * Revision 4 (PK-01): the input is copied ONCE into plain data (`takeSnapshot`), the
 * snapshot is validated, and the snapshot is what a successful result returns, so the
 * returned message contains nothing that was not validated, whatever the input was.
 *
 * Order: size, JSON, envelope exact keys, protocol version, known type, audio guard,
 * envelope formats and identity binding, payload schema (including the cross-field
 * invariants of PK-02, quantisation of PK-06 and display safety of PK-03).
 *
 * These functions do not know who is talking (no direction, authentication,
 * generation or sequence checks, no rate limits, no message_id dedupe). Use
 * `isAllowedSender`, `SequenceTracker` and `MessageIdDedupe` for those. Receivers parse
 * the raw text frame only; `validateMessageObject` is for already-bounded objects.
 *
 * Failure details are short static strings that never contain input content.
 */

import { specFor } from './catalogue.js';
import type { FieldRule } from './catalogue.js';
import {
  ATTEMPT_ID_RE,
  AUDIO_GUARD_ARRAY_MAX,
  AUDIO_GUARD_KEYS,
  AUDIO_GUARD_STRING_MAX_CODE_POINTS,
  DETAIL_LENGTH_MAX,
  MAX_GENERATION,
  MAX_MESSAGE_BYTES,
  MAX_SEQUENCE,
  MESSAGE_ID_RE,
  PAYLOAD_MAX_DEPTH,
  PROTOCOL_VERSION,
  ROLES,
  ROOM_ID_RE,
  SESSION_ID_RE,
  TIMESTAMP_SKEW_MS,
  WINDOW_ID_RE,
} from './constants.js';
import { PAYLOAD_CHECKS, QUANTIZED_FIELDS } from './payloads.js';
import { canonicalCoverage, canonicalDb, isCoverageQuantized, isDbQuantized } from './quantize.js';
import { isPlainObject } from './schema.js';
import { BINARY, takeSnapshot } from './snapshot.js';
import { codePointLength, utf8ByteLength } from './text.js';
import { ENVELOPE_KEYS, MESSAGE_TYPES } from './types.js';
import type { ErrorCode, MessageType, ParseOptions, ParseResult, Role, WireMessage } from './types.js';

const MESSAGE_TYPE_SET: ReadonlySet<string> = new Set<string>(MESSAGE_TYPES);
const ENVELOPE_KEY_SET: ReadonlySet<string> = new Set<string>(ENVELOPE_KEYS);
const ROLE_SET: ReadonlySet<string> = new Set<string>(ROLES);
const AUDIO_KEY_SET: ReadonlySet<string> = new Set<string>(AUDIO_GUARD_KEYS);
/** Types whose payload repeats `room_id`: a non-null envelope room_id must match it. */
const ROOM_ECHO_TYPES: ReadonlySet<string> = new Set(['room.created', 'join.accepted', 'auth.resume']);

type Failure = Extract<ParseResult, { ok: false }>;

function fail(code: ErrorCode, detail: string, ref: string | null): Failure {
  return { ok: false, code, detail: detail.slice(0, DETAIL_LENGTH_MAX), ref_message_id: ref };
}

/** message_id of the offending message, only when it is well formed (never echoes arbitrary input). */
function refIdOf(o: unknown): string | null {
  try {
    if (!isPlainObject(o)) return null;
    const d = Object.getOwnPropertyDescriptor(o, 'message_id');
    const id = d && 'value' in d ? (d.value as unknown) : undefined;
    return typeof id === 'string' && MESSAGE_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

function effectiveMaxBytes(opts: ParseOptions | undefined): number {
  const m = opts?.maxBytes;
  if (typeof m === 'number' && Number.isFinite(m) && m >= 1) return Math.min(Math.floor(m), MAX_MESSAGE_BYTES);
  return MAX_MESSAGE_BYTES;
}

function effectiveNow(opts: ParseOptions | undefined): number {
  const n = opts?.now;
  return typeof n === 'number' && Number.isFinite(n) ? n : Date.now();
}

/**
 * Audio guard (section 4 step 4): reject payloads that carry keys named like
 * audio containers, strings over 256 code points, arrays over 16 elements or binary
 * containers. Runs on the snapshot (plain data), iteratively, so hostile nesting
 * cannot exhaust the stack.
 */
function audioGuard(payload: unknown, ref: string | null): Failure | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number };
    if (value === BINARY) return fail('audio_rejected', 'payload contains binary data', ref);
    if (typeof value === 'string') {
      if (value.length > AUDIO_GUARD_STRING_MAX_CODE_POINTS && codePointLength(value) > AUDIO_GUARD_STRING_MAX_CODE_POINTS) {
        return fail('audio_rejected', 'payload contains an oversized string', ref);
      }
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    if (depth >= PAYLOAD_MAX_DEPTH) return fail('bad_schema', 'payload nested too deeply', ref);
    if (Array.isArray(value)) {
      if (value.length > AUDIO_GUARD_ARRAY_MAX) return fail('audio_rejected', 'payload contains an oversized array', ref);
      for (const item of value) stack.push({ value: item as unknown, depth: depth + 1 });
      continue;
    }
    const record = value as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      if (AUDIO_KEY_SET.has(k.toLowerCase())) return fail('audio_rejected', 'payload contains an audio-like field', ref);
      stack.push({ value: record[k], depth: depth + 1 });
    }
  }
  return null;
}

function idField(value: unknown, re: RegExp, rule: FieldRule, name: string): string | null {
  if (value === null) {
    return rule === 'required' ? `${name}: required` : null;
  }
  if (rule === 'null') return `${name}: must be null`;
  return typeof value === 'string' && re.test(value) ? null : `${name}: bad format`;
}

/**
 * Revision 4 (PK-06): replace quantised numbers that are within tolerance of their grid by the
 * canonical grid value, so the clean copy carries no sub-grid precision. Values outside the
 * tolerance are left untouched and the schema rejects them.
 */
function canonicalizeQuantized(type: MessageType, payload: unknown): void {
  const table = QUANTIZED_FIELDS[type];
  if (!table || !isPlainObject(payload)) return;
  for (const key of Object.keys(table)) {
    const v = payload[key];
    if (typeof v !== 'number') continue;
    if (table[key] === 'db') {
      if (isDbQuantized(v)) payload[key] = canonicalDb(v);
    } else if (isCoverageQuantized(v)) {
      payload[key] = canonicalCoverage(v);
    }
  }
}

/** Validation of a snapshot; size has already been checked by the caller. */
function validateSnapshot(value: unknown, opts: ParseOptions | undefined): ParseResult {
  if (!isPlainObject(value)) return fail('bad_schema', 'message is not an object', null);
  const ref = refIdOf(value);
  const keys = Object.keys(value);

  // Envelope: exactly the twelve fields.
  for (const k of keys) {
    if (!ENVELOPE_KEY_SET.has(k)) return fail('bad_schema', 'envelope has an unknown field', ref);
  }
  if (keys.length !== ENVELOPE_KEYS.length) return fail('bad_schema', 'envelope is missing a field', ref);

  if (value.protocol_version !== PROTOCOL_VERSION) return fail('bad_schema', 'unsupported protocol_version', ref);

  const type = value.type;
  if (typeof type !== 'string') return fail('bad_schema', 'type: expected string', ref);
  if (!MESSAGE_TYPE_SET.has(type)) return fail('unknown_type', 'unknown message type', ref);
  const messageType = type as MessageType;

  const guard = audioGuard(value.payload, ref);
  if (guard) return guard;

  // Envelope field formats.
  const spec = specFor(messageType);
  const role = value.sender_role;
  if (typeof role !== 'string' || !ROLE_SET.has(role)) return fail('bad_schema', 'sender_role: not an allowed value', ref);
  if (typeof value.message_id !== 'string' || !MESSAGE_ID_RE.test(value.message_id)) {
    return fail('bad_schema', 'message_id: bad format', ref);
  }
  const generation = value.producer_generation;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0 || generation > MAX_GENERATION) {
    return fail('bad_schema', 'producer_generation: out of range', ref);
  }
  const sequence = value.sequence;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
    return fail('bad_schema', 'sequence: out of range', ref);
  }
  const ts = value.event_timestamp;
  if (typeof ts !== 'number' || !Number.isInteger(ts) || ts < 0) {
    return fail('bad_schema', 'event_timestamp: expected integer', ref);
  }
  if (Math.abs(ts - effectiveNow(opts)) > TIMESTAMP_SKEW_MS) {
    return fail('bad_schema', 'event_timestamp: outside allowed skew', ref);
  }

  // Identity binding (document columns S, W, A) and the room rule.
  const identityError =
    idField(value.room_id, ROOM_ID_RE, spec.room, 'room_id') ??
    idField(value.session_id, SESSION_ID_RE, spec.identity.session, 'session_id') ??
    idField(value.window_id, WINDOW_ID_RE, spec.identity.window, 'window_id') ??
    idField(value.attempt_id, ATTEMPT_ID_RE, spec.identity.attempt, 'attempt_id');
  if (identityError) return fail('bad_schema', identityError, ref);

  // Pre-auth and relay-originated messages carry generation 0.
  if ((role === 'relay' || spec.generation === 'zero') && generation !== 0) {
    return fail('bad_schema', 'producer_generation: must be 0', ref);
  }

  // Payload schema (quantised numbers are canonicalised first, see PK-06).
  canonicalizeQuantized(messageType, value.payload);
  const payloadError = PAYLOAD_CHECKS[messageType](value.payload, 'payload');
  if (payloadError) return fail('bad_schema', payloadError, ref);

  if (ROOM_ECHO_TYPES.has(messageType) && value.room_id !== null) {
    const payload = value.payload as Record<string, unknown>;
    if (payload.room_id !== value.room_id) return fail('bad_schema', 'room_id: differs from payload', ref);
  }

  // The snapshot is returned: it is the data that was validated.
  const message = {
    protocol_version: PROTOCOL_VERSION,
    type: messageType,
    message_id: value.message_id,
    room_id: value.room_id,
    session_id: value.session_id,
    window_id: value.window_id,
    attempt_id: value.attempt_id,
    sender_role: role as Role,
    producer_generation: generation,
    sequence,
    event_timestamp: ts,
    payload: value.payload,
  };
  return { ok: true, message: message as WireMessage };
}

/**
 * Validate a raw frame. Only strings (JSON text) are accepted; any other input
 * (ArrayBuffer, typed array, Blob-like, number, object, ...) is `binary_rejected`.
 * Receivers call this on the raw text frame; use `validateMessageObject` for values that
 * are already parsed and bounded.
 */
export function parseWireMessage(raw: unknown, opts?: ParseOptions): ParseResult {
  try {
    if (typeof raw !== 'string') return fail('binary_rejected', 'only text frames are accepted', null);
    const maxBytes = effectiveMaxBytes(opts);
    // UTF-8 length is never smaller than the UTF-16 length, so this skips encoding hostile giants.
    if (raw.length > maxBytes || utf8ByteLength(raw) > maxBytes) {
      return fail('payload_too_large', 'message exceeds the size limit', null);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return fail('bad_schema', 'invalid JSON', null);
    }
    const snap = takeSnapshot(parsed);
    if (!snap.ok) return fail(snap.code, snap.detail, refIdOf(parsed));
    return validateSnapshot(snap.value, opts);
  } catch {
    return fail('internal', 'validator fault', null);
  }
}

/**
 * Validate an already-parsed value. The input is copied once into plain data (bounded:
 * at most 8192 values and 16 levels, sparse arrays refused without iterating), the
 * snapshot's JSON serialization is checked against the size limit, and the snapshot is
 * validated and returned (`-0` becomes `0`, quantised numbers become canonical). Rejects
 * non-finite numbers, accessors, symbol keys, non-plain objects, unknown keys and everything
 * else in section 4 steps 2 to 6.
 */
export function validateMessageObject(obj: unknown, opts?: ParseOptions): ParseResult {
  try {
    const snap = takeSnapshot(obj);
    if (!snap.ok) return fail(snap.code, snap.detail, refIdOf(obj));
    const serialized = JSON.stringify(snap.value);
    if (typeof serialized !== 'string') return fail('bad_schema', 'message is not serializable', null);
    const maxBytes = effectiveMaxBytes(opts);
    if (serialized.length > maxBytes || utf8ByteLength(serialized) > maxBytes) {
      return fail('payload_too_large', 'message exceeds the size limit', refIdOf(snap.value));
    }
    return validateSnapshot(snap.value, opts);
  } catch {
    return fail('internal', 'validator fault', null);
  }
}

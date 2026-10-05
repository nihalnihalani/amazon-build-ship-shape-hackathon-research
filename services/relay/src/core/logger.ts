/**
 * Redacting logger (ADR-0002).
 *
 * The relay may log only: event name, error code, message type, byte length, role, room hash prefix
 * (8 hex characters of SHA-256 of the room id), latency and (for per-minute aggregates) a count. Everything is
 * checked against closed vocabularies at runtime, so even a programming error cannot put a body, phrase, cue
 * text, credential, pairing code or address into a log line: unknown keys are dropped and unknown values are
 * discarded.
 *
 * What is logged (A2-04): errors and security events one line each; ordinary traffic only as per-minute
 * aggregate counters by message type (`minute_aggregate`), never one line per message.
 */
import { ERROR_CODES, MESSAGE_TYPES, type ErrorCode, type MessageType, type Role } from './protocol-port.js';

export const LOG_EVENTS = [
  'connect',
  'disconnect',
  'origin_rejected',
  'kill_switch',
  'room_created',
  'pairing_refreshed',
  'code_burned',
  'minute_aggregate',
  'join_requested',
  'join_accepted',
  'join_rejected',
  'join_expired',
  'join_failed',
  'auth_ok',
  'auth_failed',
  'superseded',
  'credential_reuse',
  'unpaired',
  'room_closed',
  'message_forwarded',
  'message_rejected',
  'peer_offline',
  'rate_limited',
  'auth_deadline',
  'idle_timeout',
  'send_gone',
  'internal_error',
] as const;
export type LogEventName = (typeof LOG_EVENTS)[number];

/** `code` values of `minute_aggregate` lines. */
export const AGGREGATE_KINDS = ['forwarded', 'duplicate_dropped', 'peer_offline'] as const;
export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

/**
 * Server-side reasons for a failed `auth.resume`. The client only ever sees the generic `unauthorized` (A3-05);
 * the specific reason is written to the log, never sent.
 */
export const AUTH_FAIL_REASONS = [
  'unknown_room',
  'bad_credential',
  'credential_expired',
  'credential_revoked',
  'role_mismatch',
  'throttled',
  'would_supersede',
  'room_idle_closed',
  'room_closed',
  'credential_reused',
] as const;
export type AuthFailReason = (typeof AUTH_FAIL_REASONS)[number];

export const CLOSE_REASONS = [
  'auth_deadline',
  'too_many_unauthenticated_messages',
  'origin_rejected',
  'superseded',
  'unpaired',
  'room_closed',
  'expired',
  'revoked',
  'rate_limited',
  'abuse',
  'binary_rejected',
  'payload_too_large',
  'idle_timeout',
  'relay_disabled',
  'unknown_connection',
  'too_many_connections',
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export interface LogEvent {
  event: LogEventName;
  code?: ErrorCode | CloseReason | AggregateKind | AuthFailReason;
  type?: MessageType;
  bytes?: number;
  role?: Role;
  /** 8 hex characters of SHA-256(room_id). */
  room?: string;
  latency_ms?: number;
  /** Per-minute aggregate count (only on `minute_aggregate`). */
  count?: number;
}

const EVENT_SET: ReadonlySet<string> = new Set(LOG_EVENTS);
const CODE_SET: ReadonlySet<string> = new Set([...ERROR_CODES, ...CLOSE_REASONS, ...AGGREGATE_KINDS, ...AUTH_FAIL_REASONS]);
const TYPE_SET: ReadonlySet<string> = new Set(MESSAGE_TYPES);
const ROLE_SET: ReadonlySet<string> = new Set(['tv', 'phone', 'relay']);
const RE_ROOM_PREFIX = /^[0-9a-f]{8}$/;

/** Returns a log event containing only allowlisted keys with allowlisted values, or null when `event` is unusable. */
export function sanitizeLogEvent(input: unknown): LogEvent | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Record<string, unknown>;
  if (typeof i.event !== 'string' || !EVENT_SET.has(i.event)) return null;
  const out: LogEvent = { event: i.event as LogEventName };
  if (typeof i.code === 'string' && CODE_SET.has(i.code)) out.code = i.code as NonNullable<LogEvent['code']>;
  if (typeof i.type === 'string' && TYPE_SET.has(i.type)) out.type = i.type as MessageType;
  if (typeof i.bytes === 'number' && Number.isSafeInteger(i.bytes) && i.bytes >= 0) out.bytes = i.bytes;
  if (typeof i.role === 'string' && ROLE_SET.has(i.role)) out.role = i.role as Role;
  if (typeof i.room === 'string' && RE_ROOM_PREFIX.test(i.room)) out.room = i.room;
  if (typeof i.latency_ms === 'number' && Number.isFinite(i.latency_ms) && i.latency_ms >= 0) {
    out.latency_ms = Math.round(i.latency_ms * 100) / 100;
  }
  if (typeof i.count === 'number' && Number.isSafeInteger(i.count) && i.count >= 0) out.count = i.count;
  return out;
}

export type LogSink = (line: string) => void;

/** Serialises a sanitized event as one JSON line with a fixed key order. */
export function formatLogLine(event: LogEvent): string {
  const ordered: Record<string, unknown> = { event: event.event };
  if (event.code !== undefined) ordered.code = event.code;
  if (event.type !== undefined) ordered.type = event.type;
  if (event.bytes !== undefined) ordered.bytes = event.bytes;
  if (event.role !== undefined) ordered.role = event.role;
  if (event.room !== undefined) ordered.room = event.room;
  if (event.latency_ms !== undefined) ordered.latency_ms = event.latency_ms;
  if (event.count !== undefined) ordered.count = event.count;
  return JSON.stringify(ordered);
}

export interface RedactingLogger {
  log(event: unknown): void;
}

export function createRedactingLogger(sink: LogSink): RedactingLogger {
  return {
    log(event: unknown): void {
      const clean = sanitizeLogEvent(event);
      if (clean) sink(formatLogLine(clean));
    },
  };
}

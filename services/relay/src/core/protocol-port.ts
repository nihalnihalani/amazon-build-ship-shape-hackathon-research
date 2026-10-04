/**
 * Protocol port: the single file through which the relay core touches the wire protocol.
 *
 * Everything here is backed by `@atr/protocol` (PROTOCOL.md revision 2): validation (steps 1-6 of section 4),
 * the message catalogue (direction, auth phase, forward target, identity and room rules), replay and duplicate
 * helpers, id generation and the constants. The relay core imports only from this file, so a future change of
 * the protocol package surface is a one-file change.
 *
 * What remains local to the relay: the relay-originated envelope builder (it needs the per-connection relay
 * sequence kept in the RoomStore) and the thin result adapters below.
 *
 * Error `detail` strings come from the package (static strings that never echo input) or from the core.
 */
import {
  AUTH_DEADLINE_JOIN_PENDING_MS,
  AUTH_DEADLINE_MS,
  CREDENTIAL_LENGTH,
  CREDENTIAL_TTL_MS,
  CUES_PER_SESSION_MAX,
  DEFAULT_DEDUPE_CAPACITY,
  ERROR_CODES,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PEER_UNKNOWN_AFTER_MS,
  PRE_AUTH_MESSAGES_MAX,
  JOIN_REQUEST_TTL_MS,
  ROLES,
  ROOM_IDLE_CLOSE_MS,
  ROOM_TTL_MS,
  MessageIdDedupe,
  SequenceTracker,
  createIdFactory,
  forwardTarget,
  isAllowedSender,
  isPreAuthType,
  parseWireMessage,
  specFor,
  type ErrorCode,
  type MessageType,
  type Role,
  type WireMessage,
} from '@atr/protocol';

export {
  ERROR_CODES,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  ROLES,
  MessageIdDedupe,
  SequenceTracker,
  createIdFactory,
  forwardTarget,
  isAllowedSender,
  isPreAuthType,
  specFor,
};
export type { ErrorCode, MessageType, Role, WireMessage };

/** Relay-side limits, all taken from the protocol package constants. */
export const LIMITS = {
  maxCuesPerSession: CUES_PER_SESSION_MAX,
  /** Peer considered unknown after this long without traffic. */
  heartbeatWindowMs: PEER_UNKNOWN_AFTER_MS,
  authDeadlineMs: AUTH_DEADLINE_MS,
  authDeadlineWhileJoinPendingMs: AUTH_DEADLINE_JOIN_PENDING_MS,
  maxUnauthenticatedMessages: PRE_AUTH_MESSAGES_MAX,
  pairingCodeTtlMs: PAIRING_CODE_TTL_MS,
  joinTtlMs: JOIN_REQUEST_TTL_MS,
  credentialTtlMs: CREDENTIAL_TTL_MS,
  roomTtlMs: ROOM_TTL_MS,
  roomIdleCloseMs: ROOM_IDLE_CLOSE_MS,
  dedupeWindow: DEFAULT_DEDUPE_CAPACITY,
  credentialChars: CREDENTIAL_LENGTH,
} as const;

// ---------------------------------------------------------------------------------------------
// Catalogue helpers
// ---------------------------------------------------------------------------------------------

/** True for types only the relay creates (room.created, join.pending, error, ...). */
export function isRelayOriginated(type: MessageType): boolean {
  return specFor(type).auth === 'relay_origin';
}

/** True for types that are valid only before authentication (room.create, join.request, auth.resume). */
export function isPreOnlyType(type: MessageType): boolean {
  return specFor(type).auth === 'pre';
}

// ---------------------------------------------------------------------------------------------
// Parsing (PROTOCOL.md section 4, steps 1-6)
// ---------------------------------------------------------------------------------------------

export interface ParsedMessage {
  /** The exact text received; forwarded to peers unchanged. */
  raw: string;
  bytes: number;
  type: MessageType;
  envelope: WireMessage;
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
  bytes: number;
}
export type ParseResult = ParseOk | ParseFailure;

export function parseWireText(raw: string, nowMs: number): ParseResult {
  const bytes = Buffer.byteLength(raw, 'utf8');
  const r = parseWireMessage(raw, { now: nowMs });
  if (!r.ok) return { ok: false, code: r.code, detail: r.detail, refMessageId: r.ref_message_id, bytes };
  return {
    ok: true,
    message: {
      raw,
      bytes,
      type: r.message.type,
      envelope: r.message,
      payload: r.message.payload as unknown as Record<string, unknown>,
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

/**
 * Serialises a relay-originated envelope: sender_role relay, generation 0 and the relay's own per-connection
 * sequence. The result is checked against the package validator in the test suite for every message type.
 */
export function buildRelayMessage(input: RelayMessageInput): string {
  return JSON.stringify({
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
  });
}

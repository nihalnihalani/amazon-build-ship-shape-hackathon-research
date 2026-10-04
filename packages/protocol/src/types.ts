/**
 * Wire types for protocol v1 (docs/PROTOCOL.md revision 1).
 * Types only; no runtime code except the MESSAGE_TYPES list.
 */

import type {
  ACK_OUTCOMES,
  ATTEMPT_STATES,
  CLIENT_ROLES,
  ERROR_CODES,
  JOIN_DECISIONS,
  JOIN_REJECT_REASONS,
  LISTENER_RESPONSES,
  MIC_MODES,
  MIC_STATES,
  PLATFORMS,
  PRECHECK_INVALID_REASONS,
  PRECHECK_PURPOSES,
  ROLES,
  SESSION_END_REASONS,
  TRANSPORT_STATES,
  TV_STAGES,
  UNPAIRED_REASONS,
  VISIBILITY_STATES,
  WAKE_LOCK_STATES,
  WINDOW_CANCEL_REASONS,
  WINDOW_INVALID_REASONS,
  WINDOW_KINDS,
  WINDOW_STOP_REASONS,
} from './constants.js';

export type Role = (typeof ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type TvStage = (typeof TV_STAGES)[number];
export type MicState = (typeof MIC_STATES)[number];
export type TransportState = (typeof TRANSPORT_STATES)[number];
export type AttemptState = (typeof ATTEMPT_STATES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type JoinDecision = (typeof JOIN_DECISIONS)[number];
export type JoinRejectReason = (typeof JOIN_REJECT_REASONS)[number];
export type UnpairedReason = (typeof UNPAIRED_REASONS)[number];
export type PrecheckPurpose = (typeof PRECHECK_PURPOSES)[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
export type WindowStopReason = (typeof WINDOW_STOP_REASONS)[number];
export type WindowCancelReason = (typeof WINDOW_CANCEL_REASONS)[number];
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];
export type ListenerResponseValue = (typeof LISTENER_RESPONSES)[number];
export type AckOutcome = (typeof ACK_OUTCOMES)[number];
export type WakeLockState = (typeof WAKE_LOCK_STATES)[number];
export type Visibility = (typeof VISIBILITY_STATES)[number];
export type MicMode = (typeof MIC_MODES)[number];
export type PrecheckInvalidReason = (typeof PRECHECK_INVALID_REASONS)[number];
export type WindowInvalidReason = (typeof WINDOW_INVALID_REASONS)[number];

// ---------------------------------------------------------------------------
// Payloads: 3.1 connection, pairing and lifecycle
// ---------------------------------------------------------------------------

export interface RoomCreatePayload {
  client: { app_version: string; platform: Platform };
}
export interface RoomCreatedPayload {
  room_id: string;
  pairing_code: string;
  code_expires_at: number;
  tv_credential: string;
  credential_expires_at: number;
  generation: number;
}
export type PairingRefreshPayload = Record<string, never>;
export interface PairingCodePayload {
  pairing_code: string;
  code_expires_at: number;
}
export interface JoinRequestPayload {
  pairing_code: string;
  device_label: string;
}
export interface JoinPendingPayload {
  join_id: string;
  confirm_digits: string;
  expires_at: number;
}
export interface JoinRequestedPayload {
  join_id: string;
  device_label: string;
  confirm_digits: string;
  expires_at: number;
}
export interface JoinConfirmPayload {
  join_id: string;
  decision: JoinDecision;
}
export interface JoinAcceptedPayload {
  room_id: string;
  phone_credential: string;
  credential_expires_at: number;
  generation: number;
}
export interface JoinRejectedPayload {
  reason: JoinRejectReason;
}
export interface JoinExpiredPayload {
  join_id: string;
}
export interface AuthResumePayload {
  room_id: string;
  role: ClientRole;
  credential: string;
}
export interface AuthOkPayload {
  role: ClientRole;
  generation: number;
  peer_connected: boolean;
  phone_paired: boolean;
}
export interface PeerStatePayload {
  role: ClientRole;
  connected: boolean;
  generation: number;
}
export type UnpairPayload = Record<string, never>;
export interface UnpairedPayload {
  reason: UnpairedReason;
}
export type RoomClosePayload = Record<string, never>;
export type PingPayload = Record<string, never>;
export interface PongPayload {
  server_time: number;
}
export interface ErrorPayload {
  code: ErrorCode;
  ref_message_id: string | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// Payloads: 3.2 session commands (TV to phone)
// ---------------------------------------------------------------------------

export interface SessionBeginPayload {
  family_mode: boolean;
  phrase_count: number;
  cues_max: 3;
}
export interface SessionStatePayload {
  stage: TvStage;
  phrase_position: number;
  cues_used: number;
  listener_open_attempt: string | null;
}
export interface PrecheckStartPayload {
  purpose: PrecheckPurpose;
  duration_ms: 2000 | 5000;
}
export interface WindowStartPayload {
  kind: WindowKind;
  phrase_position: number | null;
  max_duration_ms: number;
  vad_floor_dbfs: number;
}
export interface WindowStopPayload {
  reason: WindowStopReason;
}
export interface WindowCancelPayload {
  reason: WindowCancelReason;
}
export interface ListenerOpenPayload {
  timeout_ms: number;
}
export type AttemptRevealPayload = Record<string, never>;
export interface SessionEndPayload {
  reason: SessionEndReason;
}

// ---------------------------------------------------------------------------
// Payloads: 3.3 phone observations (phone to TV)
// ---------------------------------------------------------------------------

export interface MicStatePayload {
  state: MicState;
  settings: {
    auto_gain_control: boolean | null;
    echo_cancellation: boolean | null;
    noise_suppression: boolean | null;
    sample_rate: number | null;
    channel_count: number | null;
  };
  /** Revision 3: null means `getSupportedConstraints()` was unavailable (never assume false). */
  supported: {
    auto_gain_control: boolean | null;
    echo_cancellation: boolean | null;
    noise_suppression: boolean | null;
  };
  wake_lock: WakeLockState;
  visibility: Visibility;
  mode: MicMode;
}
export interface PrecheckResultPayload {
  purpose: PrecheckPurpose;
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
export interface LevelPayload {
  frame_index: number;
  t_audio_ms: number;
  dbfs: number;
  active: boolean;
  clipped: boolean;
}
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
export interface ListenerResponsePayload {
  response: ListenerResponseValue;
}
export interface CuePayload {
  text: string;
}
export interface PhrasesUpdatePayload {
  phrases: string[];
}
export interface AckPayload {
  acked_message_id: string;
  outcome: AckOutcome;
  detail: string;
}

// ---------------------------------------------------------------------------
// Message map, envelope and discriminated union
// ---------------------------------------------------------------------------

export interface PayloadMap {
  'room.create': RoomCreatePayload;
  'room.created': RoomCreatedPayload;
  'pairing.refresh': PairingRefreshPayload;
  'pairing.code': PairingCodePayload;
  'join.request': JoinRequestPayload;
  'join.pending': JoinPendingPayload;
  'join.requested': JoinRequestedPayload;
  'join.confirm': JoinConfirmPayload;
  'join.accepted': JoinAcceptedPayload;
  'join.rejected': JoinRejectedPayload;
  'join.expired': JoinExpiredPayload;
  'auth.resume': AuthResumePayload;
  'auth.ok': AuthOkPayload;
  'peer.state': PeerStatePayload;
  unpair: UnpairPayload;
  unpaired: UnpairedPayload;
  'room.close': RoomClosePayload;
  ping: PingPayload;
  pong: PongPayload;
  error: ErrorPayload;
  'session.begin': SessionBeginPayload;
  'session.state': SessionStatePayload;
  'precheck.start': PrecheckStartPayload;
  'window.start': WindowStartPayload;
  'window.stop': WindowStopPayload;
  'window.cancel': WindowCancelPayload;
  'listener.open': ListenerOpenPayload;
  'attempt.reveal': AttemptRevealPayload;
  'session.end': SessionEndPayload;
  'mic.state': MicStatePayload;
  'precheck.result': PrecheckResultPayload;
  level: LevelPayload;
  'window.result': WindowResultPayload;
  'listener.response': ListenerResponsePayload;
  cue: CuePayload;
  'phrases.update': PhrasesUpdatePayload;
  ack: AckPayload;
}

export type MessageType = keyof PayloadMap;

/** Every message type, in PROTOCOL.md section 3 order. */
export const MESSAGE_TYPES = [
  'room.create',
  'room.created',
  'pairing.refresh',
  'pairing.code',
  'join.request',
  'join.pending',
  'join.requested',
  'join.confirm',
  'join.accepted',
  'join.rejected',
  'join.expired',
  'auth.resume',
  'auth.ok',
  'peer.state',
  'unpair',
  'unpaired',
  'room.close',
  'ping',
  'pong',
  'error',
  'session.begin',
  'session.state',
  'precheck.start',
  'window.start',
  'window.stop',
  'window.cancel',
  'listener.open',
  'attempt.reveal',
  'session.end',
  'mic.state',
  'precheck.result',
  'level',
  'window.result',
  'listener.response',
  'cue',
  'phrases.update',
  'ack',
] as const satisfies readonly MessageType[];

/** Compile-time check: MESSAGE_TYPES lists every MessageType exactly once. */
type MissingTypes = Exclude<MessageType, (typeof MESSAGE_TYPES)[number]>;
const _allTypesListed: [MissingTypes] extends [never] ? true : never = true;
void _allTypesListed;

/** Envelope with the exact top-level fields of PROTOCOL.md section 1. */
export interface Envelope<T extends MessageType, P> {
  protocol_version: 1;
  type: T;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: Role;
  producer_generation: number;
  sequence: number;
  event_timestamp: number;
  payload: P;
}

/** The envelope field names, in canonical order. */
export const ENVELOPE_KEYS = [
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

/** Message for one type, or (distributively) the union for a union of types. */
export type MessageOf<T extends MessageType> = T extends MessageType ? Envelope<T, PayloadMap[T]> : never;

/** Discriminated union of every message, keyed by `type`. */
export type WireMessage = { [K in MessageType]: MessageOf<K> }[MessageType];

/** Optional identity fields a builder may set (room_id overrides the factory room). */
export interface MessageIds {
  room_id?: string | null;
  session_id?: string | null;
  window_id?: string | null;
  attempt_id?: string | null;
}

/** Result of validating one message (no connection context). */
export type ParseResult =
  | { ok: true; message: WireMessage }
  | { ok: false; code: ErrorCode; detail: string; ref_message_id: string | null };

export interface ParseOptions {
  /** Maximum serialized size in UTF-8 bytes. Default MAX_MESSAGE_BYTES. */
  maxBytes?: number;
  /** Receiver time in epoch milliseconds for the +/-24 h sanity check. Default Date.now(). */
  now?: number;
}

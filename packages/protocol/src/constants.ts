/**
 * Constants for the Across the Room wire protocol v1.
 *
 * Source of truth: docs/PROTOCOL.md (revision 1) sections 1, 3, 6 and 7. A test
 * (test/doc-consistency.test.ts) compares these values with the document.
 * Zero runtime dependencies; no Node-only APIs.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Maximum serialized message size, counted in UTF-8 bytes. */
export const MAX_MESSAGE_BYTES = 8192;

// ---------------------------------------------------------------------------
// Limits (PROTOCOL.md section 7 and the per-type payload rules in section 3)
// ---------------------------------------------------------------------------

export const PHRASE_COUNT_MIN = 1;
export const PHRASE_COUNT_MAX = 10;
export const PHRASE_LENGTH_MIN = 1;
export const PHRASE_LENGTH_MAX = 60;
export const CUE_LENGTH_MIN = 1;
export const CUE_LENGTH_MAX = 12;
/** Maximum cues per session (enforced by phone UI, relay counter and TV state). */
export const CUES_PER_SESSION_MAX = 3;
export const DEVICE_LABEL_LENGTH_MIN = 1;
export const DEVICE_LABEL_LENGTH_MAX = 24;
export const APP_VERSION_LENGTH_MIN = 1;
export const APP_VERSION_LENGTH_MAX = 32;
/** `error.detail` and `ack.detail` length bound (code points). */
export const DETAIL_LENGTH_MAX = 64;

/** Highest legal `level.frame_index` (inclusive). Also the cap for frame counts. */
export const LEVEL_FRAME_INDEX_MAX = 700;
export const LEVEL_FRAMES_PER_WINDOW_MAX = 700;
export const T_AUDIO_MS_MAX = 35000;
export const DBFS_MIN = -140;
export const DBFS_MAX = 20;
export const VAD_FLOOR_DBFS_MIN = -140;
export const VAD_FLOOR_DBFS_MAX = 0;

export const PRECHECK_QUIET_CHECK_MS = 5000;
export const PRECHECK_PRE_WINDOW_MS = 2000;
export const WINDOW_CALIBRATION_MAX_MS = 6000;
export const WINDOW_VOWEL_MIN_MS = 1000;
export const WINDOW_VOWEL_MAX_MS = 30000;
export const WINDOW_PHRASE_MAX_MS = 8000;
export const LISTENER_TIMEOUT_MIN_MS = 5000;
export const LISTENER_TIMEOUT_MAX_MS = 60000;

export const PHONE_RATE_SUSTAINED_PER_S = 40;
export const PHONE_RATE_BURST = 60;
export const TV_RATE_SUSTAINED_PER_S = 20;
export const TV_RATE_BURST = 40;
export const PRE_AUTH_MESSAGES_MAX = 5;
export const AUTH_DEADLINE_MS = 5_000;
export const AUTH_DEADLINE_JOIN_PENDING_MS = 65_000;

export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const JOIN_REQUEST_TTL_MS = 60_000;
/** 32 random bytes, base64url without padding. */
export const CREDENTIAL_LENGTH = 43;
export const CREDENTIAL_TTL_MS = 12 * 3_600_000;
export const ROOM_TTL_MS = 12 * 3_600_000;
export const ROOM_IDLE_CLOSE_MS = 30 * 60_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const PEER_UNKNOWN_AFTER_MS = 25_000;

/** Envelope `event_timestamp` sanity window around receiver time. */
export const TIMESTAMP_SKEW_MS = 24 * 3_600_000;
export const MAX_GENERATION = 2 ** 31 - 1;
export const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
/** Upper bound for epoch-millisecond payload fields such as `code_expires_at`. */
export const MAX_EPOCH_MS = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Audio guard (PROTOCOL.md section 4, step 4)
// ---------------------------------------------------------------------------

/** Payload key names that are rejected (compared lower-case) anywhere in a payload. */
export const AUDIO_GUARD_KEYS: readonly string[] = [
  'audio',
  'pcm',
  'samples',
  'waveform',
  'blob',
  'buffer',
  'data',
];
export const AUDIO_GUARD_STRING_MAX_CODE_POINTS = 256;
export const AUDIO_GUARD_ARRAY_MAX = 16;
/** Nesting deeper than this is not a legal payload (the deepest schema is 3). */
export const PAYLOAD_MAX_DEPTH = 8;

// ---------------------------------------------------------------------------
// Identifier formats (PROTOCOL.md section 1 and section 3)
// ---------------------------------------------------------------------------

export const MESSAGE_ID_RE = /^m_[A-Za-z0-9_-]{16,32}$/;
export const ROOM_ID_RE = /^r_[A-Za-z0-9_-]{16,32}$/;
export const SESSION_ID_RE = /^s_[A-Za-z0-9_-]{8,40}$/;
export const WINDOW_ID_RE = /^w_[A-Za-z0-9_-]{8,40}$/;
export const ATTEMPT_ID_RE = /^a_[A-Za-z0-9_-]{8,40}$/;
export const JOIN_ID_RE = /^j_[A-Za-z0-9_-]{8,40}$/;
export const CREDENTIAL_RE = /^[A-Za-z0-9_-]{43}$/;
export const CONFIRM_DIGITS_RE = /^[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const ROLES = ['tv', 'phone', 'relay'] as const;
/** Roles a client can authenticate as. */
export const CLIENT_ROLES = ['tv', 'phone'] as const;

/** Error codes, PROTOCOL.md section 3.4. */
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

/** TV session stages, PROTOCOL.md section 6. Must equal TvStage in @atr/session-core. */
export const TV_STAGES = [
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

export const MIC_STATES = [
  'off',
  'permission_pending',
  'permission_denied',
  'no_input',
  'input_busy',
  'constraints_unsupported',
  'open_idle',
  'measuring',
  'error',
] as const;

export const TRANSPORT_STATES = [
  'disconnected',
  'connecting',
  'authenticating',
  'connected',
  'reconnecting',
  'failed',
] as const;

export const ATTEMPT_STATES = [
  'capturing',
  'capture_closed',
  'response_pending',
  'revealed',
  'cancelled',
  'invalid',
] as const;

export const PLATFORMS = ['vega', 'web_preview', 'test'] as const;
export const JOIN_DECISIONS = ['accept', 'reject'] as const;
export const JOIN_REJECT_REASONS = ['rejected', 'expired', 'room_full', 'busy'] as const;
export const UNPAIRED_REASONS = ['tv_unpaired', 'room_closed', 'expired'] as const;
export const PRECHECK_PURPOSES = ['quiet_check', 'pre_window'] as const;
export const WINDOW_KINDS = ['calibration', 'vowel', 'phrase'] as const;
export const WINDOW_STOP_REASONS = ['complete', 'early_stop'] as const;
export const WINDOW_CANCEL_REASONS = [
  'user_cancel',
  'interrupted',
  'link_lost',
  'timeout',
  'session_end',
] as const;
export const SESSION_END_REASONS = ['completed', 'user_exit', 'discarded', 'error'] as const;
export const LISTENER_RESPONSES = ['heard', 'not_heard'] as const;
export const ACK_OUTCOMES = ['applied', 'ignored_stale', 'rejected'] as const;
export const WAKE_LOCK_STATES = [
  'held',
  'released',
  'unsupported',
  'rejected',
  'not_requested',
] as const;
export const VISIBILITY_STATES = ['visible', 'hidden'] as const;
export const MIC_MODES = ['physical_phone', 'same_host', 'fixture_replay'] as const;
export const PRECHECK_INVALID_REASONS = [
  'low_coverage',
  'clipped',
  'unstable_floor',
  'burst_noise',
  'too_loud',
  'nonfinite',
  'interrupted',
] as const;
export const WINDOW_INVALID_REASONS = [
  'no_voice',
  'clipped',
  'low_coverage',
  'continuous_sound',
  'nonfinite',
  'interrupted',
] as const;
/** TV-local speaker rating (PROTOCOL.md section 5). */
export const SPEAKER_RATINGS = ['felt_loud', 'felt_normal', 'skipped'] as const;

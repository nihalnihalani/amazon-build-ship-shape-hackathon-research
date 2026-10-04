/**
 * Payload schemas for every message type (docs/PROTOCOL.md section 3).
 * Exact key sets, enums, integer/number distinction, ranges, nullability and
 * conditional rules. Internal to the package; reach it through validate.ts.
 */

import {
  ACK_OUTCOMES,
  APP_VERSION_LENGTH_MAX,
  APP_VERSION_LENGTH_MIN,
  ATTEMPT_ID_RE,
  CLIENT_ROLES,
  CONFIRM_DIGITS_RE,
  CREDENTIAL_RE,
  CUES_PER_SESSION_MAX,
  CUE_LENGTH_MAX,
  CUE_LENGTH_MIN,
  DBFS_MAX,
  DBFS_MIN,
  DETAIL_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MIN,
  ERROR_CODES,
  JOIN_DECISIONS,
  JOIN_ID_RE,
  JOIN_REJECT_REASONS,
  LEVEL_FRAMES_PER_WINDOW_MAX,
  LEVEL_FRAME_INDEX_MAX,
  LISTENER_RESPONSES,
  LISTENER_TIMEOUT_MAX_MS,
  LISTENER_TIMEOUT_MIN_MS,
  MAX_EPOCH_MS,
  MAX_GENERATION,
  MESSAGE_ID_RE,
  MIC_MODES,
  MIC_STATES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_COUNT_MAX,
  PHRASE_COUNT_MIN,
  PHRASE_LENGTH_MAX,
  PHRASE_LENGTH_MIN,
  PLATFORMS,
  PRECHECK_INVALID_REASONS,
  PRECHECK_PRE_WINDOW_MS,
  PRECHECK_PURPOSES,
  PRECHECK_QUIET_CHECK_MS,
  ROOM_ID_RE,
  SESSION_END_REASONS,
  TV_STAGES,
  T_AUDIO_MS_MAX,
  UNPAIRED_REASONS,
  VAD_FLOOR_DBFS_MAX,
  VAD_FLOOR_DBFS_MIN,
  VISIBILITY_STATES,
  WAKE_LOCK_STATES,
  WINDOW_CALIBRATION_MAX_MS,
  WINDOW_CANCEL_REASONS,
  WINDOW_INVALID_REASONS,
  WINDOW_KINDS,
  WINDOW_PHRASE_MAX_MS,
  WINDOW_STOP_REASONS,
  WINDOW_VOWEL_MAX_MS,
  WINDOW_VOWEL_MIN_MS,
} from './constants.js';
import {
  arrayOf,
  bool,
  int,
  literal,
  nullable,
  num,
  obj,
  oneOf,
  pattern,
  refine,
  str,
  userText,
} from './schema.js';
import type { Check } from './schema.js';
import type {
  PrecheckResultPayload,
  PrecheckStartPayload,
  WindowResultPayload,
  WindowStartPayload,
} from './types.js';
import type { MessageType } from './types.js';

const PAIRING_CODE_RE = new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

const epochMs = int(0, MAX_EPOCH_MS);
const generation = int(0, MAX_GENERATION);
const clientRole = oneOf(CLIENT_ROLES);
const pairingCode = pattern(PAIRING_CODE_RE);
const credential = pattern(CREDENTIAL_RE);
const roomId = pattern(ROOM_ID_RE);
const joinId = pattern(JOIN_ID_RE);
const confirmDigits = pattern(CONFIRM_DIGITS_RE);
const dbfs = num(DBFS_MIN, DBFS_MAX);
const nullableDbfs = nullable(dbfs);
const frames = int(0, LEVEL_FRAMES_PER_WINDOW_MAX);
const durationMs = num(0, T_AUDIO_MS_MAX);
const detail = str(0, DETAIL_LENGTH_MAX);
const empty = obj({});

const precheckStart = refine<PrecheckStartPayload>(
  obj({
    purpose: oneOf(PRECHECK_PURPOSES),
    duration_ms: (v, p) =>
      v === PRECHECK_PRE_WINDOW_MS || v === PRECHECK_QUIET_CHECK_MS ? null : `${p}: not an allowed value`,
  }),
  (v, p) => {
    const expected = v.purpose === 'quiet_check' ? PRECHECK_QUIET_CHECK_MS : PRECHECK_PRE_WINDOW_MS;
    return v.duration_ms === expected ? null : `${p}.duration_ms: does not match purpose`;
  },
);

const windowStart = refine<WindowStartPayload>(
  obj({
    kind: oneOf(WINDOW_KINDS),
    phrase_position: nullable(int(1, PHRASE_COUNT_MAX)),
    max_duration_ms: int(WINDOW_VOWEL_MIN_MS, WINDOW_VOWEL_MAX_MS),
    vad_floor_dbfs: num(VAD_FLOOR_DBFS_MIN, VAD_FLOOR_DBFS_MAX),
  }),
  (v, p) => {
    if (v.kind === 'phrase') {
      if (v.phrase_position === null) return `${p}.phrase_position: required for phrase`;
      if (v.max_duration_ms !== WINDOW_PHRASE_MAX_MS) return `${p}.max_duration_ms: phrase is 8000`;
      return null;
    }
    if (v.phrase_position !== null) return `${p}.phrase_position: only for phrase`;
    if (v.kind === 'calibration' && v.max_duration_ms !== WINDOW_CALIBRATION_MAX_MS) {
      return `${p}.max_duration_ms: calibration is 6000`;
    }
    return null;
  },
);

const precheckResult = refine<PrecheckResultPayload>(
  obj({
    purpose: oneOf(PRECHECK_PURPOSES),
    valid: bool,
    invalid_reason: nullable(oneOf(PRECHECK_INVALID_REASONS)),
    floor_dbfs: nullableDbfs,
    p20_dbfs: nullableDbfs,
    p80_dbfs: nullableDbfs,
    p95_dbfs: nullableDbfs,
    frame_count: frames,
    expected_frames: frames,
    coverage: num(0, 1),
    clipped_frames: frames,
    nonfinite_frames: frames,
    duration_ms: durationMs,
  }),
  (v, p) => (v.valid === (v.invalid_reason === null) ? null : `${p}.invalid_reason: conflicts with valid`),
);

const windowResult = refine<WindowResultPayload>(
  obj({
    kind: oneOf(WINDOW_KINDS),
    valid: bool,
    invalid_reason: nullable(oneOf(WINDOW_INVALID_REASONS)),
    frame_count: frames,
    expected_frames: frames,
    coverage: num(0, 1),
    active_ms: durationMs,
    longest_active_ms: durationMs,
    segments: frames,
    onset_ms: nullable(durationMs),
    p50_active_dbfs: nullableDbfs,
    p95_active_dbfs: nullableDbfs,
    peak_dbfs: nullableDbfs,
    clipped_frames: frames,
    nonfinite_frames: frames,
    duration_ms: durationMs,
  }),
  (v, p) => (v.valid === (v.invalid_reason === null) ? null : `${p}.invalid_reason: conflicts with valid`),
);

/** Payload check for every message type. */
export const PAYLOAD_CHECKS: Record<MessageType, Check> = {
  // 3.1 Connection, pairing and lifecycle
  'room.create': obj({
    client: obj({
      app_version: str(APP_VERSION_LENGTH_MIN, APP_VERSION_LENGTH_MAX),
      platform: oneOf(PLATFORMS),
    }),
  }),
  'room.created': obj({
    room_id: roomId,
    pairing_code: pairingCode,
    code_expires_at: epochMs,
    tv_credential: credential,
    credential_expires_at: epochMs,
    generation,
  }),
  'pairing.refresh': empty,
  'pairing.code': obj({ pairing_code: pairingCode, code_expires_at: epochMs }),
  'join.request': obj({
    pairing_code: pairingCode,
    device_label: userText(DEVICE_LABEL_LENGTH_MIN, DEVICE_LABEL_LENGTH_MAX),
  }),
  'join.pending': obj({ join_id: joinId, confirm_digits: confirmDigits, expires_at: epochMs }),
  'join.requested': obj({
    join_id: joinId,
    device_label: userText(DEVICE_LABEL_LENGTH_MIN, DEVICE_LABEL_LENGTH_MAX),
    confirm_digits: confirmDigits,
    expires_at: epochMs,
  }),
  'join.confirm': obj({ join_id: joinId, decision: oneOf(JOIN_DECISIONS) }),
  'join.accepted': obj({
    room_id: roomId,
    phone_credential: credential,
    credential_expires_at: epochMs,
    generation,
  }),
  'join.rejected': obj({ reason: oneOf(JOIN_REJECT_REASONS) }),
  'join.expired': obj({ join_id: joinId }),
  'auth.resume': obj({ room_id: roomId, role: clientRole, credential }),
  'auth.ok': obj({ role: clientRole, generation, peer_connected: bool, phone_paired: bool }),
  'peer.state': obj({ role: clientRole, connected: bool, generation }),
  unpair: empty,
  unpaired: obj({ reason: oneOf(UNPAIRED_REASONS) }),
  'room.close': empty,
  ping: empty,
  pong: obj({ server_time: epochMs }),
  error: obj({
    code: oneOf(ERROR_CODES),
    ref_message_id: nullable(pattern(MESSAGE_ID_RE)),
    detail,
  }),

  // 3.2 Session commands (TV to phone)
  'session.begin': obj({
    family_mode: bool,
    phrase_count: int(0, PHRASE_COUNT_MAX),
    cues_max: literal(CUES_PER_SESSION_MAX),
  }),
  'session.state': obj({
    stage: oneOf(TV_STAGES),
    phrase_position: int(0, PHRASE_COUNT_MAX),
    cues_used: int(0, CUES_PER_SESSION_MAX),
    listener_open_attempt: nullable(pattern(ATTEMPT_ID_RE)),
  }),
  'precheck.start': precheckStart,
  'window.start': windowStart,
  'window.stop': obj({ reason: oneOf(WINDOW_STOP_REASONS) }),
  'window.cancel': obj({ reason: oneOf(WINDOW_CANCEL_REASONS) }),
  'listener.open': obj({ timeout_ms: int(LISTENER_TIMEOUT_MIN_MS, LISTENER_TIMEOUT_MAX_MS) }),
  'attempt.reveal': empty,
  'session.end': obj({ reason: oneOf(SESSION_END_REASONS) }),

  // 3.3 Phone observations (phone to TV)
  'mic.state': obj({
    state: oneOf(MIC_STATES),
    settings: obj({
      auto_gain_control: nullable(bool),
      echo_cancellation: nullable(bool),
      noise_suppression: nullable(bool),
      sample_rate: nullable(num(1, 384000)),
      channel_count: nullable(int(1, 64)),
    }),
    supported: obj({
      auto_gain_control: bool,
      echo_cancellation: bool,
      noise_suppression: bool,
    }),
    wake_lock: oneOf(WAKE_LOCK_STATES),
    visibility: oneOf(VISIBILITY_STATES),
    mode: oneOf(MIC_MODES),
  }),
  'precheck.result': precheckResult,
  level: obj({
    frame_index: int(0, LEVEL_FRAME_INDEX_MAX),
    t_audio_ms: num(0, T_AUDIO_MS_MAX),
    dbfs,
    active: bool,
    clipped: bool,
  }),
  'window.result': windowResult,
  'listener.response': obj({ response: oneOf(LISTENER_RESPONSES) }),
  cue: obj({ text: userText(CUE_LENGTH_MIN, CUE_LENGTH_MAX) }),
  'phrases.update': obj({
    phrases: arrayOf(userText(PHRASE_LENGTH_MIN, PHRASE_LENGTH_MAX), PHRASE_COUNT_MIN, PHRASE_COUNT_MAX),
  }),
  ack: obj({
    acked_message_id: pattern(MESSAGE_ID_RE),
    outcome: oneOf(ACK_OUTCOMES),
    detail,
  }),
};

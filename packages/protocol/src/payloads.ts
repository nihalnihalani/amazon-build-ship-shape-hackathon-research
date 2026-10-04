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
  COVERAGE_RECOMPUTE_TOLERANCE,
  DBFS_MAX,
  DBFS_MIN,
  DETAIL_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MIN,
  ERROR_CODES,
  EXPECTED_FRAMES_TOLERANCE,
  FRAME_MS,
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
  MIN_VALID_COVERAGE,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_COUNT_MAX,
  PHRASE_COUNT_MIN,
  PHRASE_LENGTH_MAX,
  PHRASE_LENGTH_MIN,
  PLATFORMS,
  PRECHECK_DURATION_TOLERANCE_MS,
  PRECHECK_INVALID_REASONS,
  PRECHECK_PRE_WINDOW_MS,
  PRECHECK_PURPOSES,
  PRECHECK_QUIET_CHECK_MS,
  PRE_WINDOW_INVALID_REASONS,
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
  coverageNum,
  dbNum,
  displayStr,
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
  LevelPayload,
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
/** dB fields are multiples of 0.1 (revision 4, PK-06). */
const dbfs = dbNum(DBFS_MIN, DBFS_MAX);
const nullableDbfs = nullable(dbfs);
const frames = int(0, LEVEL_FRAMES_PER_WINDOW_MAX);
/** Durations and times are integer milliseconds (revision 4, PK-06). */
const durationMs = int(0, T_AUDIO_MS_MAX);
const detail = str(0, DETAIL_LENGTH_MAX);
const empty = obj({});

/**
 * Payload fields that are quantised (revision 4, PK-06). Before schema validation the validator
 * replaces a value that is within tolerance of the grid by its canonical grid value, so the clean
 * copy (and everything a relay forwards) carries no sub-grid precision. `db`: multiple of 0.1;
 * `coverage`: multiple of 0.001.
 */
export const QUANTIZED_FIELDS: Partial<Record<MessageType, Record<string, 'db' | 'coverage'>>> = {
  'window.start': { vad_floor_dbfs: 'db' },
  'precheck.result': { floor_dbfs: 'db', p20_dbfs: 'db', p80_dbfs: 'db', p95_dbfs: 'db', coverage: 'coverage' },
  level: { dbfs: 'db' },
  'window.result': { coverage: 'coverage', p50_active_dbfs: 'db', p95_active_dbfs: 'db', peak_dbfs: 'db' },
};

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
    vad_floor_dbfs: dbNum(VAD_FLOOR_DBFS_MIN, VAD_FLOOR_DBFS_MAX),
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

/** Non-decreasing check over the non-null entries of an ordered list. */
function nonDecreasing(values: ReadonlyArray<number | null>): boolean {
  let last = -Infinity;
  for (const v of values) {
    if (v === null) continue;
    if (v < last) return false;
    last = v;
  }
  return true;
}

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
    coverage: coverageNum,
    clipped_frames: frames,
    nonfinite_frames: frames,
    duration_ms: durationMs,
  }),
  (v, p) => {
    if (v.valid !== (v.invalid_reason === null)) return `${p}.invalid_reason: conflicts with valid`;
    // ADR-0001 A1-06: unstable_floor and too_loud belong to the quiet check only.
    if (
      v.purpose === 'pre_window' &&
      v.invalid_reason !== null &&
      !(PRE_WINDOW_INVALID_REASONS as readonly string[]).includes(v.invalid_reason)
    ) {
      return `${p}.invalid_reason: not allowed for pre_window`;
    }
    // PK-02: the check ran for the commanded duration.
    const expectedDuration = v.purpose === 'quiet_check' ? PRECHECK_QUIET_CHECK_MS : PRECHECK_PRE_WINDOW_MS;
    if (Math.abs(v.duration_ms - expectedDuration) > PRECHECK_DURATION_TOLERANCE_MS) {
      return `${p}.duration_ms: not the commanded duration`;
    }
    if (!nonDecreasing([v.p20_dbfs, v.floor_dbfs, v.p80_dbfs, v.p95_dbfs])) {
      return `${p}: percentiles out of order`;
    }
    if (v.valid) {
      if (v.floor_dbfs === null) return `${p}.floor_dbfs: required when valid`;
      if (v.clipped_frames !== 0) return `${p}.clipped_frames: must be 0 when valid`;
      if (v.coverage < MIN_VALID_COVERAGE) return `${p}.coverage: too low for valid`;
    }
    return null;
  },
);

const windowResult = refine<WindowResultPayload>(
  obj({
    kind: oneOf(WINDOW_KINDS),
    valid: bool,
    invalid_reason: nullable(oneOf(WINDOW_INVALID_REASONS)),
    frame_count: frames,
    expected_frames: frames,
    coverage: coverageNum,
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
  (v, p) => {
    if (v.valid !== (v.invalid_reason === null)) return `${p}.invalid_reason: conflicts with valid`;
    // PK-02 frame accounting.
    if (v.frame_count > v.expected_frames + 1) return `${p}.frame_count: exceeds expected_frames`;
    if (v.nonfinite_frames > v.frame_count) return `${p}.nonfinite_frames: exceeds frame_count`;
    if (v.clipped_frames > v.frame_count) return `${p}.clipped_frames: exceeds frame_count`;
    const ratio = v.expected_frames === 0 ? 0 : Math.min(1, (v.frame_count - v.nonfinite_frames) / v.expected_frames);
    if (Math.abs(v.coverage - ratio) > COVERAGE_RECOMPUTE_TOLERANCE + 1e-9) {
      return `${p}.coverage: does not match frame counts`;
    }
    if (Math.abs(v.expected_frames - Math.floor(v.duration_ms / FRAME_MS)) > EXPECTED_FRAMES_TOLERANCE) {
      return `${p}.expected_frames: does not match duration_ms`;
    }
    // PK-02 activity accounting.
    if (!(v.longest_active_ms <= v.active_ms && v.active_ms <= v.duration_ms)) {
      return `${p}.active_ms: inconsistent durations`;
    }
    if ((v.segments === 0) !== (v.active_ms === 0) || (v.active_ms === 0) !== (v.onset_ms === null)) {
      return `${p}.segments: inconsistent with active_ms and onset_ms`;
    }
    if (v.onset_ms !== null && v.onset_ms > v.duration_ms) return `${p}.onset_ms: after the end of the window`;
    if (v.valid) {
      if (v.coverage < MIN_VALID_COVERAGE) return `${p}.coverage: too low for valid`;
      if (v.p50_active_dbfs === null || v.p95_active_dbfs === null || v.peak_dbfs === null) {
        return `${p}: statistics required when valid`;
      }
      if (!(v.p50_active_dbfs <= v.p95_active_dbfs && v.p95_active_dbfs <= v.peak_dbfs)) {
        return `${p}: statistics out of order`;
      }
    }
    return null;
  },
);

const levelPayload = refine<LevelPayload>(
  obj({
    frame_index: int(0, LEVEL_FRAME_INDEX_MAX),
    t_audio_ms: durationMs,
    dbfs,
    active: bool,
    clipped: bool,
  }),
  // PK-02: a frame cannot be reported before its audio time (one millisecond of slack).
  (v, p) => (v.t_audio_ms >= FRAME_MS * v.frame_index - 1 ? null : `${p}.t_audio_ms: before the frame start`),
);

/** Payload check for every message type. */
export const PAYLOAD_CHECKS: Record<MessageType, Check> = {
  // 3.1 Connection, pairing and lifecycle
  'room.create': obj({
    client: obj({
      app_version: displayStr(APP_VERSION_LENGTH_MIN, APP_VERSION_LENGTH_MAX),
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
  // Revision 4 (A3-07): every successful resume returns the rotated credential to use next time.
  'auth.ok': obj({
    role: clientRole,
    generation,
    peer_connected: bool,
    phone_paired: bool,
    next_credential: credential,
  }),
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
    // Revision 3: null = getSupportedConstraints() unavailable (never assume false).
    supported: obj({
      auto_gain_control: nullable(bool),
      echo_cancellation: nullable(bool),
      noise_suppression: nullable(bool),
    }),
    wake_lock: oneOf(WAKE_LOCK_STATES),
    visibility: oneOf(VISIBILITY_STATES),
    mode: oneOf(MIC_MODES),
  }),
  'precheck.result': precheckResult,
  level: levelPayload,
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

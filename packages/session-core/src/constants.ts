/**
 * Product constants. Every number is a product assumption from ADR-0001/0004/0005/0008
 * pending real-device evidence (T04/T04A); none of them is a measured accuracy.
 */

/** ADR-0001 §4: a calibration is accepted only when cal_margin is at least this many dB. */
export const CAL_MIN_MARGIN_DB = 13;
/** ADR-0001 §5: a pre-window floor rise at or above this blocks the window. */
export const GATE_RISE_MAX_DB = 6;
/** ADR-0001 §5: the window is blocked when cal_margin - rise falls below this. */
export const GATE_SEPARATION_DB = 10;
/** ADR-0001 §8: reached when window_rel_p95 >= cal_margin - this. */
export const REACHED_TOLERANCE_DB = 1;
/** ADR-0001 §8: borderline when |window_rel_p95 - (cal_margin - 1)| < this. */
export const BORDERLINE_DB = 1;
/** ADR-0001 §4/§6: minimum accepted voice activity for calibration and phrase windows. */
export const MIN_ACTIVE_MS = 400;
/** ADR-0001 §2/§6: minimum finite-frame coverage. */
export const MIN_COVERAGE = 0.9;
/** ADR-0001 §2: p80 - p20 must not exceed this for a stable quiet floor. */
export const QUIET_STABLE_MAX_DB = 6;
/** ADR-0001 §2/§5: p95 - floor must not exceed this (no bursts). */
export const QUIET_BURST_MAX_DB = 10;
/** ADR-0001 §2: the quiet floor must not be louder than this. */
export const QUIET_FLOOR_MAX_DBFS = -30;
/** Tolerance for floating point noise at the exact thresholds above. */
export const DB_EPSILON = 1e-9;
/** A1-05: a quiet floor below this is a muted or blocked microphone, not a quiet room. */
export const SILENT_FLOOR_DBFS = -110;
/** A1-09: the TV allows its own timing this much slack when checking a reported duration. */
export const DURATION_SLACK_MS = 500;
/** PK-02 tolerances. */
export const COVERAGE_TOLERANCE = 0.001;
export const PRECHECK_DURATION_TOLERANCE_MS = 50;
export const NONFINITE_MAX_SHARE = 0.05;

/** ADR-0008: wait after the OK press before the first command, so a screen-reader utterance can finish. */
export const QUIET_LEAD_MS = 1500;
/** A8-02: with the TV screen reader on, the ready screen carries a fixed script and the lead is this long. */
export const QUIET_LEAD_SCREEN_READER_MS = 3000;
/** Bounds for a configured lead (settings), so a bad stored value cannot freeze or skip the quiet lead. */
export const QUIET_LEAD_MIN_MS = 500;
export const QUIET_LEAD_MAX_MS = 10_000;
export const QUIET_CHECK_MS = 5000;
export const PRE_WINDOW_MS = 2000;
export const CALIBRATION_WINDOW_MS = 6000;
export const VOWEL_MAX_MS = 30000;
export const PHRASE_WINDOW_MS = 8000;
/** Extra time the TV waits for a precheck or window result before it cancels as 'timeout'. */
export const RESULT_GRACE_MS = 3000;

/** ADR-0004: offer "continue without listener response" after this long. */
export const LISTENER_WAIT_MS = 20000;
/** Protocol maximum for listener.open (the TV, not the phone, decides when to offer a choice). */
export const LISTENER_OPEN_TIMEOUT_MS = 60000;

export const CUES_MAX = 3;
export const CUE_CHIP_MS = 3000;
export const CUE_MAX_CODEPOINTS = 12;

/** ADR-0004: 1-based positions whose first attempt is hidden, when they exist in the bank. */
export const HIDDEN_POSITIONS: readonly number[] = [3, 6, 9];

export const MIN_PHRASES = 1;
export const MAX_PHRASES = 10;
export const MAX_PHRASE_CODEPOINTS = 60;

/** ADR-0005. */
export const SCHEMA_VERSION = 1;
/** A5-04: 7 days shown plus today. */
export const RETENTION_DAYS = 8;
/** A5-03: a crash checkpoint older than the room lifetime is discarded on launch. */
export const CHECKPOINT_MAX_AGE_MS = 12 * 3_600_000;
export const HISTORY_DAYS = 7;
export const DAY_MS = 86_400_000;
export const STORAGE_PREFIX = 'atr:';

/** Link-level limits. */
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_LEVEL_FRAMES = 700;
/** A level frame older than this is not shown (the meter reports no level instead). */
export const LEVEL_STALE_MS = 1000;
/** Display smoothing for the arc (scoring never uses smoothed values). */
export const LEVEL_SMOOTHING = 0.5;

/** Remembered recent message ids for duplicate suppression. */
export const SEEN_IDS_MAX = 256;

/** Original calibration sentence (not a household phrase, not third-party text). */
export const CALIBRATION_PHRASE = 'The weather is lovely today.';

/**
 * Ten original starter phrases written for this project: plain household sentences.
 * Replaced by the household bank after phrases.update validation.
 */
export const STARTER_PHRASES: readonly string[] = [
  'Dinner is ready.',
  'Please pass the salt.',
  'Could you turn the volume down?',
  'I will be there at noon.',
  'The kettle just boiled.',
  'Please close the back door.',
  'Where did I leave my glasses?',
  'It is time for a walk.',
  'Let us watch the news.',
  'Thank you for the lovely meal.',
];

/** Placeholder the release-docs task replaces with the real third-party licence notice. */
export const LICENSES_NOTICE_PLACEHOLDER =
  'Licence notices for the software in this app are provided by the release documentation. This text is a placeholder.';

export const DEVICE_QUALIFICATION_STATUS = 'Not yet qualified on this phone';

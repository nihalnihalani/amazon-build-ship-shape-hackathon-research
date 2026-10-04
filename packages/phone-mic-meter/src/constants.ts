/**
 * Every ADR-0001 constant that the phone side needs (revision 1, 2026-10-05).
 *
 * All values are PRODUCT ASSUMPTIONS pending real-device evidence (T04 / T04A).
 * None of them is a measured accuracy. Tests assert each value against an
 * independently typed copy of the ADR table (test/constants.test.ts).
 */

// ---- ADR-0001 §1 signal and numeric convention -----------------------------

/** Frame length in milliseconds. Frames are counted in samples: round(sampleRate × 0.050). */
export const FRAME_MS = 50;
/** Numerical RMS floor: dbfs = 20·log10(max(rms, EPSILON_RMS)), i.e. −140 dBFS. */
export const EPSILON_RMS = 1e-7;
/** Lower clamp of every reported level (dBFS). */
export const DBFS_MIN = -140;
/** Upper clamp of every reported level (dBFS); samples may exceed ±1.0 in some graphs. */
export const DBFS_MAX = 20;
/** A sample is clipped when |x| ≥ CLIP_SAMPLE. */
export const CLIP_SAMPLE = 0.999;
/** A frame is clipped when at least this fraction of its samples are clipped. */
export const CLIP_FRAME_FRACTION = 0.005;
/**
 * Comparison slack (dB) used only so that values exactly on an ADR threshold are
 * not misclassified by binary floating-point noise in a subtraction
 * (e.g. −44.3 − (−50.3) evaluating to 6.000000000000007). 1e-9 dB is far below
 * any physically meaningful difference; test fixtures use 0.01 dB steps.
 */
export const CMP_TOLERANCE_DB = 1e-9;

// ---- ADR-0001 §3 voice activity (revision 2: A1-01, A1-02, A1-03) -----------

/** A segment OPENS on a finite frame at least this many dB above the session floor (A1-03). */
export const VAD_OPEN_DB = 10;
/** Once open, a finite frame at least this many dB above the session floor is a candidate (continuation). */
export const VAD_CANDIDATE_DB = 6;
/** A segment is accepted only with at least this many candidate frames in total (4 × 50 ms = 200 ms). */
export const VAD_ACCEPT_MIN_FRAMES = 4;
/** ... AND a run of at least this many consecutive candidate frames (A1-02: isolated clicks never accumulate). */
export const VAD_ACCEPT_MIN_RUN = 3;
/** The N-th consecutive non-candidate frame ends a segment (N − 1 = 5 frames = 250 ms are bridged). */
export const VAD_END_GAP_FRAMES = 6;

// ---- ADR-0001 §2 quiet-room check and §5 pre-window check -------------------

/** Quiet-room check duration (precheck purpose `quiet_check`). */
export const QUIET_CHECK_MS = 5000;
/** Pre-window check duration (precheck purpose `pre_window`). */
export const PRECHECK_MS = 2000;
/** Precheck valid only when coverage ≥ this value. */
export const PRECHECK_COVERAGE_MIN = 0.9;
/** Quiet check: p80 − p20 must be ≤ this many dB (stable floor). */
export const QUIET_STABLE_MAX_DB = 6;
/** Quiet check and pre-window check: p95 − floor must be ≤ this many dB (no bursts). */
export const BURST_MAX_DB = 10;
/** Quiet check: floor must be ≤ this level in dBFS (not a loud room). */
export const QUIET_FLOOR_MAX_DBFS = -30;
/**
 * Quiet check and pre-window check: a floor BELOW this level (dBFS) means the microphone looks muted
 * or blocked, reason `silent_input` (A1-05; provisional, tune at T04).
 */
export const SILENT_INPUT_FLOOR_DBFS = -110;
/**
 * Precheck: more than this fraction of received frames being non-finite makes the precheck
 * invalid (`nonfinite`). ADR-0001 §2 names the reason but gives no number; the window rule
 * (§6, 5 %) is applied for consistency. Denominator = frames received (frame_count).
 */
export const PRECHECK_NONFINITE_FRACTION_MAX = 0.05;

// ---- ADR-0001 §6 window validity ---------------------------------------------

/** Window invalid (`low_coverage`) when finite_frames / expected_frames < this value. */
export const WINDOW_COVERAGE_MIN = 0.9;
/** Window invalid (`clipped`) when clipped frames exceed this fraction of accepted-active frames. */
export const WINDOW_CLIPPED_ACTIVE_FRACTION_MAX = 0.02;
/** Window invalid (`nonfinite`) when non-finite frames exceed this fraction of received frames. */
export const WINDOW_NONFINITE_FRACTION_MAX = 0.05;
/** Calibration and phrase windows need at least this much accepted activity (else `no_voice`). */
export const MIN_ACTIVE_MS = 400;
/** Phrase windows: accepted activity above this fraction of the window with no offset is `continuous_sound`. */
export const CONTINUOUS_FRACTION = 0.95;
/** Level frames per window never exceed this count (PROTOCOL.md §7). */
export const MAX_LEVEL_FRAMES = 700;

/** Maximum window durations by kind (PROTOCOL.md `window.start`). */
export const WINDOW_MAX_MS = { calibration: 6000, phrase: 8000, vowel: 30000 } as const;

// ---- PK-06 quantisation of emitted values ------------------------------------

/** Every emitted dB value is a multiple of this many dB. */
export const DB_QUANTUM = 0.1;
/** Every emitted coverage is a multiple of this value. */
export const COVERAGE_QUANTUM = 0.001;

// ---- TV-side constants (reference only; the authority is the TV verdict module) -

/** ADR-0001 §4: calibration valid only when cal_margin ≥ this many dB. */
export const CAL_MARGIN_MIN_DB = 13;
/** ADR-0001 §5: block a window when rise ≥ this many dB. */
export const PRE_WINDOW_RISE_BLOCK_DB = 6;
/** ADR-0001 §5: block a window when cal_margin − rise < this many dB. */
export const PRE_WINDOW_MARGIN_BLOCK_DB = 10;
/** ADR-0001 §8: reached when window_rel_p95 ≥ cal_margin − this many dB. */
export const VERDICT_MARGIN_DB = 1;
/** ADR-0001 §8: borderline when |window_rel_p95 − (cal_margin − 1)| < this many dB. */
export const BORDERLINE_DB = 1;
/** A1-10: `vad_floor_dbfs` range accepted from the TV, in dBFS. */
export const VAD_FLOOR_RANGE_DBFS = { min: -110, max: -30 } as const;

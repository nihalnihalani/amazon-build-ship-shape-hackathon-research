/**
 * TV-side measurement verdict math (ADR-0001, with docs/adr/AMENDMENTS-REV2.md). The TV is authoritative:
 * the phone reports aggregates, the TV recomputes validity from the numbers, decides acceptance, gating and
 * the reached rule. Pure functions only. All thresholds are product assumptions pending T04/T04A evidence,
 * not measured accuracy.
 *
 * Reason priority (A1-07): interrupted > nonfinite (more than 5 % of frames, evaluated first) > low_coverage
 * > silent_input > clipped > unstable_floor > burst_noise > too_loud. The pre-window precheck uses only
 * interrupted, nonfinite, low_coverage, silent_input, clipped and burst_noise (A1-06).
 *
 * Integrity (A1-09): the TV also applies the protocol cross-field invariants (PK-02) and its own timing. Any
 * disagreement between what the phone claims and what the numbers allow gives the TV-local reason `integrity`
 * and the attempt is unscored.
 */

import {
  BORDERLINE_DB,
  CAL_MIN_MARGIN_DB,
  CALIBRATION_WINDOW_MS,
  COVERAGE_TOLERANCE,
  DB_EPSILON,
  DURATION_SLACK_MS,
  GATE_RISE_MAX_DB,
  GATE_SEPARATION_DB,
  MIN_ACTIVE_MS,
  MIN_COVERAGE,
  NONFINITE_MAX_SHARE,
  PHRASE_WINDOW_MS,
  PRE_WINDOW_MS,
  PRECHECK_DURATION_TOLERANCE_MS,
  QUIET_BURST_MAX_DB,
  QUIET_CHECK_MS,
  QUIET_FLOOR_MAX_DBFS,
  QUIET_STABLE_MAX_DB,
  REACHED_TOLERANCE_DB,
  SILENT_FLOOR_DBFS,
  VOWEL_MAX_MS,
} from './constants.js';
import type {
  PrecheckInvalidReason,
  PrecheckResultPayload,
  WindowInvalidReason,
  WindowKind,
  WindowResultPayload,
} from './wire.js';

export {
  BORDERLINE_DB,
  CAL_MIN_MARGIN_DB,
  GATE_RISE_MAX_DB,
  GATE_SEPARATION_DB,
  REACHED_TOLERANCE_DB,
} from './constants.js';

/** Reasons the TV may report for a precheck: the protocol's, plus the A1-05 reason and the TV-local one. */
export type PrecheckReason = PrecheckInvalidReason | 'silent_input' | 'integrity';
export type WindowReason = WindowInvalidReason | 'integrity';

const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);

/* ------------------------------------------------------------------ integrity (A1-09, PK-02) */

function coverageMatches(coverage: number, frameCount: number, nonfinite: number, expected: number): boolean {
  const computed = expected > 0 ? (frameCount - nonfinite) / expected : 0;
  return Math.abs(coverage - computed) <= COVERAGE_TOLERANCE + DB_EPSILON;
}

/** Counts and timing common to windows and prechecks. */
function framesConsistent(
  p: {
    frame_count: number;
    expected_frames: number;
    coverage: number;
    clipped_frames: number;
    nonfinite_frames: number;
    duration_ms: number;
  },
): boolean {
  if (p.frame_count > p.expected_frames + 1) return false;
  if (p.nonfinite_frames > p.frame_count || p.clipped_frames > p.frame_count) return false;
  if (!coverageMatches(p.coverage, p.frame_count, p.nonfinite_frames, p.expected_frames)) return false;
  if (Math.abs(p.expected_frames - Math.floor(p.duration_ms / 50)) > 1) return false;
  return true;
}

/** Maximum capture time the TV commanded for a window kind. */
export function maxDurationFor(kind: WindowKind): number {
  return kind === 'calibration' ? CALIBRATION_WINDOW_MS : kind === 'vowel' ? VOWEL_MAX_MS : PHRASE_WINDOW_MS;
}

/** True when the window summary is internally consistent and within the TV's own timing. */
export function windowIntegrityOk(w: WindowResultPayload, maxDurationMs: number): boolean {
  if (!framesConsistent(w)) return false;
  if (w.duration_ms > maxDurationMs + DURATION_SLACK_MS) return false;
  if (w.longest_active_ms > w.active_ms || w.active_ms > w.duration_ms) return false;
  if ((w.segments === 0) !== (w.active_ms === 0) || (w.active_ms === 0) !== (w.onset_ms === null)) return false;
  if (w.onset_ms !== null && w.onset_ms > w.duration_ms) return false;
  const { p50_active_dbfs: p50, p95_active_dbfs: p95, peak_dbfs: peak } = w;
  if (w.valid && (!finite(p50) || !finite(p95) || !finite(peak))) return false;
  if (finite(p50) && finite(p95) && p50 > p95 + DB_EPSILON) return false;
  if (finite(p95) && finite(peak) && p95 > peak + DB_EPSILON) return false;
  return true;
}

/** True when the precheck aggregate is internally consistent (percentiles in order, counts, timing, scope). */
export function precheckIntegrityOk(p: PrecheckResultPayload, purpose: 'quiet_check' | 'pre_window'): boolean {
  if (p.purpose !== purpose) return false;
  if (!framesConsistent(p)) return false;
  const expectedDuration = purpose === 'quiet_check' ? QUIET_CHECK_MS : PRE_WINDOW_MS;
  if (Math.abs(p.duration_ms - expectedDuration) > PRECHECK_DURATION_TOLERANCE_MS) return false;
  const ordered = [p.p20_dbfs, p.floor_dbfs, p.p80_dbfs, p.p95_dbfs].filter(finite);
  for (let i = 1; i < ordered.length; i += 1) {
    if ((ordered[i - 1] as number) > (ordered[i] as number) + DB_EPSILON) return false;
  }
  if (p.valid && !finite(p.floor_dbfs)) return false;
  if (purpose === 'pre_window' && (p.invalid_reason === 'unstable_floor' || p.invalid_reason === 'too_loud')) return false;
  return true;
}

/* ------------------------------------------------------------------ shared re-validation */

const tooManyNonFinite = (p: PrecheckResultPayload): boolean =>
  p.frame_count > 0 && p.nonfinite_frames / p.frame_count > NONFINITE_MAX_SHARE + DB_EPSILON;

/**
 * The reason the numbers give for a precheck, in A1-07 priority, or null when they are valid.
 * `quietOnly` rules (stable floor, loud room) apply to the quiet check only (A1-06).
 */
function precheckNumericReason(p: PrecheckResultPayload, quiet: boolean): PrecheckReason | null {
  const { floor_dbfs: floor, p20_dbfs: p20, p80_dbfs: p80, p95_dbfs: p95 } = p;
  if (tooManyNonFinite(p) || !finite(floor) || !finite(p95) || (quiet && (!finite(p20) || !finite(p80)))) return 'nonfinite';
  if (p.coverage + DB_EPSILON < MIN_COVERAGE) return 'low_coverage';
  if (floor < SILENT_FLOOR_DBFS - DB_EPSILON) return 'silent_input';
  if (p.clipped_frames !== 0) return 'clipped';
  if (quiet && p80 !== null && p20 !== null && p80 - p20 > QUIET_STABLE_MAX_DB + DB_EPSILON) return 'unstable_floor';
  if (p95 - floor > QUIET_BURST_MAX_DB + DB_EPSILON) return 'burst_noise';
  if (quiet && floor > QUIET_FLOOR_MAX_DBFS + DB_EPSILON) return 'too_loud';
  return null;
}

/**
 * Combines the phone's claim with the numbers. An interrupted capture is the phone's to report. Otherwise the
 * phone's `valid` flag and reason must agree with the TV's recomputation, or the result is `integrity`.
 */
function precheckReason(p: PrecheckResultPayload, quiet: boolean): PrecheckReason | null {
  const numeric = precheckNumericReason(p, quiet);
  if (!p.valid) {
    const claimed = p.invalid_reason ?? 'interrupted';
    if (claimed === 'interrupted') return 'interrupted';
    return numeric !== null && numeric === claimed ? numeric : 'integrity';
  }
  return numeric;
}

/* ------------------------------------------------------------------ quiet check (ADR-0001 section 2) */

export type QuietCheckVerdict =
  | { ok: true; floorDbfs: number; p20Dbfs: number; p80Dbfs: number; p95Dbfs: number }
  | { ok: false; reason: PrecheckReason };

/**
 * TV re-validation of the quiet-check aggregate: coverage at least 0.90, clipped_frames = 0, p80 - p20 at
 * most 6, p95 - floor at most 10, floor between -110 and -30, non-finite at most 5 % of frames, in A1-07
 * priority. The phone's own `valid` flag must agree.
 */
export function evaluateQuietCheck(p: PrecheckResultPayload): QuietCheckVerdict {
  if (!precheckIntegrityOk(p, 'quiet_check')) return { ok: false, reason: 'integrity' };
  const reason = precheckReason(p, true);
  if (reason !== null) return { ok: false, reason };
  return {
    ok: true,
    floorDbfs: p.floor_dbfs as number,
    p20Dbfs: p.p20_dbfs as number,
    p80Dbfs: p.p80_dbfs as number,
    p95Dbfs: p.p95_dbfs as number,
  };
}

/* ------------------------------------------------------------------ pre-window gate (ADR-0001 section 5) */

export type GateReason = 'room_noisier' | PrecheckReason;
export type GateVerdict =
  | { pass: true; riseDb: number }
  | { pass: false; reason: GateReason; riseDb: number | null };

/**
 * rise = pre_floor - session_floor. Blocked when rise >= 6 dB, or cal_margin - rise < 10 dB, or the precheck is
 * invalid (coverage, silent input, clipping, non-finite, burst p95 - pre_floor > 10 dB). With no band
 * (calMarginDb null) only the rise and validity rules apply.
 * Coherence: the two margin inequalities never block an unchanged room (rise <= 3 dB) because an accepted
 * calibration has cal_margin >= 13 (13 - 3 = 10); precheck validity is a separate gate.
 */
export function evaluateGate(
  p: PrecheckResultPayload,
  sessionFloorDbfs: number,
  calMarginDb: number | null,
): GateVerdict {
  if (!precheckIntegrityOk(p, 'pre_window')) return { pass: false, reason: 'integrity', riseDb: null };
  const reason = precheckReason(p, false);
  if (reason !== null) return { pass: false, reason, riseDb: null };
  const rise = (p.floor_dbfs as number) - sessionFloorDbfs;
  if (rise + DB_EPSILON >= GATE_RISE_MAX_DB) return { pass: false, reason: 'room_noisier', riseDb: rise };
  if (calMarginDb !== null && calMarginDb - rise + DB_EPSILON < GATE_SEPARATION_DB) {
    return { pass: false, reason: 'room_noisier', riseDb: rise };
  }
  return { pass: true, riseDb: rise };
}

/** The largest floor rise (dB) the gate tolerates for a band margin: below 6 dB and at most margin - 10 dB. */
export function maxTolerableRiseDb(calMarginDb: number): { limitDb: number; inclusive: boolean } {
  const separation = calMarginDb - GATE_SEPARATION_DB;
  return separation < GATE_RISE_MAX_DB
    ? { limitDb: separation, inclusive: true }
    : { limitDb: GATE_RISE_MAX_DB, inclusive: false };
}

/* ------------------------------------------------------------------ window validity (ADR-0001 section 6) */

export type WindowValidity = { valid: true } | { valid: false; reason: WindowReason };

/**
 * TV check of a window result. Integrity comes first. The phone's invalid reasons are accepted as reported
 * (the TV cannot recompute accepted segments), except that a window the phone calls valid must still satisfy
 * the numbers: a calibration needs active_ms >= 400 (A1-04), and coverage must be at least 0.90 (a valid
 * window with less is an integrity failure).
 */
export function validateWindowResult(kind: WindowKind, w: WindowResultPayload): WindowValidity {
  if (!windowIntegrityOk(w, maxDurationFor(kind))) return { valid: false, reason: 'integrity' };
  if (!w.valid) return { valid: false, reason: w.invalid_reason ?? 'interrupted' };
  if (w.coverage + DB_EPSILON < MIN_COVERAGE) return { valid: false, reason: 'integrity' };
  if (kind === 'calibration' && w.active_ms < MIN_ACTIVE_MS) return { valid: false, reason: 'no_voice' };
  if (kind !== 'calibration' && w.active_ms <= 0) return { valid: false, reason: 'no_voice' };
  return { valid: true };
}

/* ------------------------------------------------------------------ calibration (ADR-0001 section 4) */

export type CalibrationReason = 'too_quiet' | WindowReason;
export type CalibrationVerdict =
  | { accepted: true; marginDb: number }
  | { accepted: false; reason: CalibrationReason; marginDb: number | null };

/** cal_margin = p95_active_dbfs - session_floor; accepted when valid, active_ms >= 400 and margin >= 13 dB. */
export function evaluateCalibration(w: WindowResultPayload, sessionFloorDbfs: number): CalibrationVerdict {
  const validity = validateWindowResult('calibration', w);
  if (!validity.valid) return { accepted: false, reason: validity.reason, marginDb: null };
  const margin = (w.p95_active_dbfs as number) - sessionFloorDbfs;
  if (margin + DB_EPSILON < CAL_MIN_MARGIN_DB) return { accepted: false, reason: 'too_quiet', marginDb: margin };
  return { accepted: true, marginDb: margin };
}

/* ------------------------------------------------------------------ reached rule (ADR-0001 section 8) */

export type WindowVerdict =
  | { kind: 'invalid'; reason: WindowReason }
  | { kind: 'no_band' }
  | { kind: 'scored'; reached: boolean; borderline: boolean; windowRelP95Db: number; thresholdDb: number };

/**
 * window_rel_p95 = p95_active_dbfs - session_floor. reached when window_rel_p95 >= cal_margin - 1 dB.
 * borderline when |window_rel_p95 - (cal_margin - 1)| < 1 dB (keeps its verdict, reported separately).
 */
export function evaluateWindow(
  kind: WindowKind,
  w: WindowResultPayload,
  sessionFloorDbfs: number,
  calMarginDb: number | null,
): WindowVerdict {
  const validity = validateWindowResult(kind, w);
  if (!validity.valid) return { kind: 'invalid', reason: validity.reason };
  if (calMarginDb === null) return { kind: 'no_band' };
  const rel = (w.p95_active_dbfs as number) - sessionFloorDbfs;
  const threshold = calMarginDb - REACHED_TOLERANCE_DB;
  const reached = rel + DB_EPSILON >= threshold;
  const borderline = Math.abs(rel - threshold) + DB_EPSILON < BORDERLINE_DB;
  return { kind: 'scored', reached, borderline, windowRelP95Db: rel, thresholdDb: threshold };
}

/** Band edge relative to the session floor for display (cal_margin - 1 dB). */
export function bandEdgeRelDb(calMarginDb: number | null): number | null {
  return calMarginDb === null ? null : calMarginDb - REACHED_TOLERANCE_DB;
}

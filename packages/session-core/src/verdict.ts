/**
 * TV-side measurement verdict math (ADR-0001). The TV is authoritative: the phone reports
 * aggregates, the TV decides acceptance, gating and the reached rule. Pure functions only.
 * All thresholds are product assumptions pending T04/T04A evidence, not measured accuracy.
 */

import {
  BORDERLINE_DB,
  CAL_MIN_MARGIN_DB,
  DB_EPSILON,
  GATE_RISE_MAX_DB,
  GATE_SEPARATION_DB,
  MIN_ACTIVE_MS,
  MIN_COVERAGE,
  QUIET_BURST_MAX_DB,
  QUIET_FLOOR_MAX_DBFS,
  QUIET_STABLE_MAX_DB,
  REACHED_TOLERANCE_DB,
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

const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);

/* ------------------------------------------------------------------ quiet check (ADR-0001 §2) */

export type QuietCheckVerdict =
  | { ok: true; floorDbfs: number; p20Dbfs: number; p80Dbfs: number; p95Dbfs: number }
  | { ok: false; reason: PrecheckInvalidReason };

/**
 * TV re-validation of the quiet-check aggregate: coverage >= 0.90, clipped_frames = 0,
 * p80 - p20 <= 6, p95 - floor <= 10, floor <= -30. The phone's own `valid` flag must also be true.
 */
export function evaluateQuietCheck(p: PrecheckResultPayload): QuietCheckVerdict {
  if (!p.valid) return { ok: false, reason: p.invalid_reason ?? 'interrupted' };
  const { floor_dbfs: floor, p20_dbfs: p20, p80_dbfs: p80, p95_dbfs: p95 } = p;
  if (!finite(floor) || !finite(p20) || !finite(p80) || !finite(p95)) return { ok: false, reason: 'nonfinite' };
  if (p.coverage + DB_EPSILON < MIN_COVERAGE) return { ok: false, reason: 'low_coverage' };
  if (p.clipped_frames !== 0) return { ok: false, reason: 'clipped' };
  if (p80 - p20 > QUIET_STABLE_MAX_DB + DB_EPSILON) return { ok: false, reason: 'unstable_floor' };
  if (p95 - floor > QUIET_BURST_MAX_DB + DB_EPSILON) return { ok: false, reason: 'burst_noise' };
  if (floor > QUIET_FLOOR_MAX_DBFS + DB_EPSILON) return { ok: false, reason: 'too_loud' };
  return { ok: true, floorDbfs: floor, p20Dbfs: p20, p80Dbfs: p80, p95Dbfs: p95 };
}

/* ------------------------------------------------------------------ pre-window gate (ADR-0001 §5) */

export type GateReason = 'room_noisier' | PrecheckInvalidReason;
export type GateVerdict =
  | { pass: true; riseDb: number }
  | { pass: false; reason: GateReason; riseDb: number | null };

/**
 * rise = pre_floor - session_floor. Blocked when rise >= 6 dB, or cal_margin - rise < 10 dB, or the
 * precheck itself is invalid (coverage, clipping, non-finite, burst p95 - pre_floor > 10 dB).
 * With no band (calMarginDb null) only the rise and validity rules apply.
 * Coherence: any cal_margin >= 13 with rise <= 3 never blocks (13 - 3 = 10).
 */
export function evaluateGate(
  p: PrecheckResultPayload,
  sessionFloorDbfs: number,
  calMarginDb: number | null,
): GateVerdict {
  if (!p.valid) return { pass: false, reason: p.invalid_reason ?? 'interrupted', riseDb: null };
  const { floor_dbfs: floor, p95_dbfs: p95 } = p;
  if (!finite(floor) || !finite(p95)) return { pass: false, reason: 'nonfinite', riseDb: null };
  if (p.coverage + DB_EPSILON < MIN_COVERAGE) return { pass: false, reason: 'low_coverage', riseDb: null };
  if (p.clipped_frames !== 0) return { pass: false, reason: 'clipped', riseDb: null };
  if (p95 - floor > QUIET_BURST_MAX_DB + DB_EPSILON) return { pass: false, reason: 'burst_noise', riseDb: null };
  const rise = floor - sessionFloorDbfs;
  if (rise + DB_EPSILON >= GATE_RISE_MAX_DB) return { pass: false, reason: 'room_noisier', riseDb: rise };
  if (calMarginDb !== null && calMarginDb - rise + DB_EPSILON < GATE_SEPARATION_DB) {
    return { pass: false, reason: 'room_noisier', riseDb: rise };
  }
  return { pass: true, riseDb: rise };
}

/* ------------------------------------------------------------------ window validity (ADR-0001 §6) */

export type WindowValidity = { valid: true } | { valid: false; reason: WindowInvalidReason };

/** TV re-check of a window result. Coverage and the presence of a p95 are rechecked; the phone owns the rest. */
export function validateWindowResult(kind: WindowKind, w: WindowResultPayload): WindowValidity {
  if (!w.valid) return { valid: false, reason: w.invalid_reason ?? 'interrupted' };
  if (w.coverage + DB_EPSILON < MIN_COVERAGE) return { valid: false, reason: 'low_coverage' };
  if (kind !== 'vowel' && w.active_ms < MIN_ACTIVE_MS) return { valid: false, reason: 'no_voice' };
  if (kind === 'vowel' && w.longest_active_ms <= 0) return { valid: false, reason: 'no_voice' };
  if (!finite(w.p95_active_dbfs)) return { valid: false, reason: 'nonfinite' };
  return { valid: true };
}

/* ------------------------------------------------------------------ calibration (ADR-0001 §4) */

export type CalibrationReason = 'too_quiet' | WindowInvalidReason;
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

/* ------------------------------------------------------------------ reached rule (ADR-0001 §8) */

export type WindowVerdict =
  | { kind: 'invalid'; reason: WindowInvalidReason }
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

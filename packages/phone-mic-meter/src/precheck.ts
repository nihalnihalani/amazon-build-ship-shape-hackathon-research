/**
 * Precheck aggregate (ADR-0001 §2 quiet-room check, §5 pre-window check; revision 2: A1-05,
 * A1-06, A1-07, PK-06).
 *
 * Statistics (floor = p50, p20, p80, p95) use finite, non-clipped frames only. Every emitted
 * number is quantised (dB to 0.1, coverage to 0.001, duration to an integer ms) and the dB rules
 * are evaluated on those emitted numbers, so a receiver that recomputes validity from the payload
 * (A1-09) reaches the same answer. Count-based rules use the exact counts.
 *
 * Reasons and priority (the first condition that holds is reported):
 *   quiet_check: interrupted > nonfinite (> 5 % of frames received) > low_coverage (< 0.90)
 *                > silent_input (floor < −110 dBFS) > clipped > unstable_floor (p80 − p20 > 6)
 *                > burst_noise (p95 − floor > 10) > too_loud (floor > −30)
 *   pre_window:  interrupted > nonfinite > low_coverage > silent_input > clipped > burst_noise
 * `unstable_floor` and `too_loud` apply to the quiet check only (A1-06): the TV judges rise and
 * margin for the pre-window check.
 */

import {
  BURST_MAX_DB,
  CMP_TOLERANCE_DB,
  FRAME_MS,
  PRECHECK_COVERAGE_MIN,
  PRECHECK_NONFINITE_FRACTION_MAX,
  QUIET_FLOOR_MAX_DBFS,
  QUIET_STABLE_MAX_DB,
  SILENT_INPUT_FLOOR_DBFS,
} from './constants.js';
import { percentile } from './percentile.js';
import { quantizeCoverage, quantizeDb, quantizeMs } from './quantize.js';
import type { PrecheckInvalidReason, PrecheckPurpose, PrecheckResultPayload } from './types.js';

/** The per-frame facts a precheck needs. `Frame` satisfies this. */
export interface PrecheckFrame {
  dbfs: number;
  finite: boolean;
  clipped: boolean;
}

export interface PrecheckOptions {
  purpose: PrecheckPurpose;
  /** Audio-clock duration of the precheck (5000 for quiet_check, 2000 for pre_window). */
  durationMs: number;
  /** True when capture was interrupted; the result is then invalid with reason `interrupted`. */
  interrupted?: boolean;
}

function quantizedPercentile(levels: number[], k: number): number | null {
  const v = percentile(levels, k);
  return v === null ? null : quantizeDb(v);
}

export function summarizePrecheck(
  frames: ReadonlyArray<PrecheckFrame>,
  options: PrecheckOptions,
): PrecheckResultPayload {
  const { purpose } = options;
  const durationMs = quantizeMs(options.durationMs);
  const expectedFrames = Math.max(0, Math.floor(durationMs / FRAME_MS));

  let finiteFrames = 0;
  let nonfiniteFrames = 0;
  let clippedFrames = 0;
  const levels: number[] = [];
  for (const f of frames) {
    if (!f.finite) {
      nonfiniteFrames += 1;
      continue;
    }
    finiteFrames += 1;
    if (f.clipped) {
      clippedFrames += 1;
    } else {
      levels.push(f.dbfs);
    }
  }

  const frameCount = frames.length;
  const exactCoverage = expectedFrames === 0 ? 0 : Math.min(1, finiteFrames / expectedFrames);
  const floor = quantizedPercentile(levels, 50);
  const p20 = quantizedPercentile(levels, 20);
  const p80 = quantizedPercentile(levels, 80);
  const p95 = quantizedPercentile(levels, 95);

  const invalidReason = precheckInvalidReason(purpose, {
    interrupted: options.interrupted === true,
    exactCoverage,
    clippedFrames,
    nonfiniteFrames,
    frameCount,
    floor,
    p20,
    p80,
    p95,
  });

  return {
    purpose,
    valid: invalidReason === null,
    invalid_reason: invalidReason,
    floor_dbfs: floor,
    p20_dbfs: p20,
    p80_dbfs: p80,
    p95_dbfs: p95,
    frame_count: frameCount,
    expected_frames: expectedFrames,
    coverage: quantizeCoverage(exactCoverage),
    clipped_frames: clippedFrames,
    nonfinite_frames: nonfiniteFrames,
    duration_ms: durationMs,
  };
}

interface PrecheckFacts {
  interrupted: boolean;
  exactCoverage: number;
  clippedFrames: number;
  nonfiniteFrames: number;
  frameCount: number;
  floor: number | null;
  p20: number | null;
  p80: number | null;
  p95: number | null;
}

function precheckInvalidReason(
  purpose: PrecheckPurpose,
  f: PrecheckFacts,
): PrecheckInvalidReason | null {
  if (f.interrupted) return 'interrupted';
  if (f.frameCount > 0 && f.nonfiniteFrames / f.frameCount > PRECHECK_NONFINITE_FRACTION_MAX) {
    return 'nonfinite';
  }
  if (f.exactCoverage < PRECHECK_COVERAGE_MIN) return 'low_coverage';
  if (f.floor !== null && f.floor < SILENT_INPUT_FLOOR_DBFS - CMP_TOLERANCE_DB) return 'silent_input';
  if (f.clippedFrames > 0) return 'clipped';

  const unstable =
    f.p80 !== null && f.p20 !== null && f.p80 - f.p20 > QUIET_STABLE_MAX_DB + CMP_TOLERANCE_DB;
  const burst =
    f.p95 !== null && f.floor !== null && f.p95 - f.floor > BURST_MAX_DB + CMP_TOLERANCE_DB;
  const tooLoud = f.floor !== null && f.floor > QUIET_FLOOR_MAX_DBFS + CMP_TOLERANCE_DB;

  if (purpose === 'pre_window') {
    return burst ? 'burst_noise' : null;
  }
  if (unstable) return 'unstable_floor';
  if (burst) return 'burst_noise';
  if (tooLoud) return 'too_loud';
  return null;
}

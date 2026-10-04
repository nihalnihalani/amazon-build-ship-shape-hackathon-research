/**
 * Precheck aggregate (ADR-0001 §2 quiet-room check, §5 pre-window check).
 *
 * Statistics (floor = p50, p20, p80, p95) use finite, non-clipped frames only. The result
 * is shaped exactly like PrecheckResultPayload. For `pre_window` the phone evaluates only
 * coverage, clipping, non-finite and the burst rule; the TV evaluates rise and margin.
 *
 * Reason priority when several conditions fail (the first listed wins):
 *   quiet_check: interrupted, low_coverage, clipped, unstable_floor, burst_noise, too_loud, nonfinite
 *   pre_window:  interrupted, low_coverage, clipped, nonfinite, burst_noise
 * The quiet-check order is the order of ADR-0001 §2.
 */

import {
  BURST_MAX_DB,
  CMP_TOLERANCE_DB,
  FRAME_MS,
  PRECHECK_COVERAGE_MIN,
  PRECHECK_NONFINITE_FRACTION_MAX,
  QUIET_FLOOR_MAX_DBFS,
  QUIET_STABLE_MAX_DB,
} from './constants.js';
import { percentile } from './percentile.js';
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

export function summarizePrecheck(
  frames: ReadonlyArray<PrecheckFrame>,
  options: PrecheckOptions,
): PrecheckResultPayload {
  const { purpose, durationMs } = options;
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
  const coverage = expectedFrames === 0 ? 0 : Math.min(1, finiteFrames / expectedFrames);
  const floor = percentile(levels, 50);
  const p20 = percentile(levels, 20);
  const p80 = percentile(levels, 80);
  const p95 = percentile(levels, 95);

  const invalidReason = precheckInvalidReason(purpose, {
    interrupted: options.interrupted === true,
    coverage,
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
    coverage,
    clipped_frames: clippedFrames,
    nonfinite_frames: nonfiniteFrames,
    duration_ms: durationMs,
  };
}

interface PrecheckFacts {
  interrupted: boolean;
  coverage: number;
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
  if (f.coverage < PRECHECK_COVERAGE_MIN) return 'low_coverage';
  if (f.clippedFrames > 0) return 'clipped';

  const nonfinite =
    f.frameCount > 0 && f.nonfiniteFrames / f.frameCount > PRECHECK_NONFINITE_FRACTION_MAX;
  const burst =
    f.p95 !== null && f.floor !== null && f.p95 - f.floor > BURST_MAX_DB + CMP_TOLERANCE_DB;

  if (purpose === 'pre_window') {
    if (nonfinite) return 'nonfinite';
    if (burst) return 'burst_noise';
    return null;
  }

  const unstable =
    f.p80 !== null && f.p20 !== null && f.p80 - f.p20 > QUIET_STABLE_MAX_DB + CMP_TOLERANCE_DB;
  const tooLoud = f.floor !== null && f.floor > QUIET_FLOOR_MAX_DBFS + CMP_TOLERANCE_DB;
  if (unstable) return 'unstable_floor';
  if (burst) return 'burst_noise';
  if (tooLoud) return 'too_loud';
  if (nonfinite) return 'nonfinite';
  return null;
}

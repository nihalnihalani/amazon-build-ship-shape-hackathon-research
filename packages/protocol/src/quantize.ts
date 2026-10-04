/**
 * Quantisation helpers (revision 4, PK-06).
 *
 * dB fields are multiples of 0.1 dB and `coverage` is a multiple of 0.001, so the
 * numeric payload cannot carry a free 52-bit mantissa per field. The phone rounds
 * with these helpers before sending; the validators enforce the grid with a
 * tolerance (|x * 10 - round(x * 10)| < 1e-6, resp. x * 1000 for coverage) and
 * return the canonical grid value in the clean copy, so the bytes a relay
 * forwards (its canonical re-serialisation) never carry sub-grid precision.
 *
 * Pure arithmetic, no dependencies.
 */

import { COVERAGE_STEP, DB_STEP, QUANTIZATION_TOLERANCE } from './constants.js';

const DB_SCALE = Math.round(1 / DB_STEP); // 10
const COVERAGE_SCALE = Math.round(1 / COVERAGE_STEP); // 1000

/** Round to the nearest multiple of `1 / scale`, as the canonical (division-produced) double, never -0. */
function snap(x: number, scale: number): number {
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

/**
 * Round a dB value to the 0.1 dB grid. The result is the canonical double for that
 * decimal (`-23.1`, not `-23.099999999999998`) and never `-0`. Non-finite input is
 * returned unchanged so the validator rejects it instead of hiding it.
 */
export function quantizeDb(x: number): number {
  return Number.isFinite(x) ? snap(x, DB_SCALE) : x;
}

/**
 * Round a coverage ratio to the 0.001 grid and clamp it to 0..1. Non-finite input is
 * returned unchanged.
 */
export function quantizeCoverage(x: number): number {
  if (!Number.isFinite(x)) return x;
  const q = snap(x, COVERAGE_SCALE);
  return q < 0 ? 0 : q > 1 ? 1 : q;
}

/** True when `x` is a finite multiple of 0.1 within the validator tolerance. */
export function isDbQuantized(x: number): boolean {
  return Number.isFinite(x) && Math.abs(x * DB_SCALE - Math.round(x * DB_SCALE)) < QUANTIZATION_TOLERANCE;
}

/** True when `x` is a finite multiple of 0.001 within the validator tolerance. */
export function isCoverageQuantized(x: number): boolean {
  return (
    Number.isFinite(x) && Math.abs(x * COVERAGE_SCALE - Math.round(x * COVERAGE_SCALE)) < QUANTIZATION_TOLERANCE
  );
}

/** Canonical grid value for a number that passed `isDbQuantized` (used to build the clean copy). */
export function canonicalDb(x: number): number {
  return snap(x, DB_SCALE);
}

/** Canonical grid value for a number that passed `isCoverageQuantized`. */
export function canonicalCoverage(x: number): number {
  return snap(x, COVERAGE_SCALE);
}

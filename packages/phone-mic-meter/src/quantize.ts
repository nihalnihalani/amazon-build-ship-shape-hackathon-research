/**
 * PK-06 quantisation of emitted values. The phone rounds; validators enforce:
 * dB fields are multiples of 0.1, coverage is a multiple of 0.001 and millisecond fields are
 * integers. -0 is normalised to 0.
 *
 * These helpers are behaviourally identical to `quantizeDb` / `quantizeCoverage` in
 * @atr/protocol revision 4 (test/protocol-conformance.test.ts compares them on thousands of
 * inputs, ties included): scale by the exact integer 10 (or 1000), `Math.round` (so an exact tie
 * rounds toward +infinity, e.g. -42.25 becomes -42.2), divide again (the result is the double
 * nearest to k/10, so it compares as the decimal literal). They are kept local so this package
 * has no runtime dependency on the protocol package.
 */

function snap(x: number, scale: number): number {
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

/** Nearest multiple of 0.1 dB. Non-finite input is returned unchanged (the validator rejects it). */
export function quantizeDb(db: number): number {
  return Number.isFinite(db) ? snap(db, 10) : db;
}

/** Nearest multiple of 0.001, clamped to 0..1. Non-finite input is returned unchanged. */
export function quantizeCoverage(coverage: number): number {
  if (!Number.isFinite(coverage)) return coverage;
  const q = snap(coverage, 1000);
  return q < 0 ? 0 : q > 1 ? 1 : q;
}

/** Nearest integer millisecond (`Math.round`, never -0). */
export function quantizeMs(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  const r = Math.round(ms);
  return r === 0 ? 0 : r;
}

/**
 * Nearest-rank percentile, exactly ADR-0001 §7: sort ascending and take
 * `sorted[ceil(k/100 × n) − 1]` for n ≥ 1. Empty sets have no percentile (null).
 * The median is p50 by the same rule (for even n it is the lower middle value).
 *
 * `k × n` is computed as an exact integer product before dividing by 100, so
 * ceil() is never pushed over an integer boundary by binary rounding of k/100.
 */
export function percentile(values: ReadonlyArray<number>, k: number): number | null {
  const n = values.length;
  if (n === 0) return null;
  if (!(k >= 0 && k <= 100)) throw new RangeError('percentile k must be within [0, 100]');
  const sorted = Array.from(values).sort((a, b) => a - b);
  const rank = Math.ceil((k * n) / 100);
  const index = Math.min(n - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

/** p50 by the nearest-rank rule. */
export function median(values: ReadonlyArray<number>): number | null {
  return percentile(values, 50);
}

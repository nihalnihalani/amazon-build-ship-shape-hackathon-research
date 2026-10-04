import { describe, expect, it } from 'vitest';
import { median, percentile } from '../src/percentile.js';

/** Hand-checked nearest-rank values: p_k = sorted[ceil(k/100 * n) - 1]. */
describe('nearest-rank percentile', () => {
  it('n = 1 returns the only value for every k', () => {
    for (const k of [0, 1, 20, 50, 80, 95, 100]) expect(percentile([-42], k)).toBe(-42);
  });

  it('[1,2,3,4,5] (n = 5): p20 = 1, p50 = 3, p80 = 4, p95 = 5', () => {
    // ranks: ceil(1.0)=1, ceil(2.5)=3, ceil(4.0)=4, ceil(4.75)=5
    const v = [5, 3, 1, 4, 2];
    expect(percentile(v, 20)).toBe(1);
    expect(percentile(v, 50)).toBe(3);
    expect(percentile(v, 80)).toBe(4);
    expect(percentile(v, 95)).toBe(5);
  });

  it('[1,2,3,4] (n = 4): median is the lower middle value 2, p95 = 4, p25 = 1, p75 = 3', () => {
    // ranks: ceil(2.0)=2, ceil(3.8)=4, ceil(1.0)=1, ceil(3.0)=3
    const v = [4, 1, 3, 2];
    expect(median(v)).toBe(2);
    expect(percentile(v, 95)).toBe(4);
    expect(percentile(v, 25)).toBe(1);
    expect(percentile(v, 75)).toBe(3);
  });

  it('1..20 (n = 20): p95 = 19 and p20 = 4 and p80 = 16 and p50 = 10', () => {
    // ranks: ceil(19.0)=19, ceil(4.0)=4, ceil(16.0)=16, ceil(10.0)=10
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(19);
    expect(percentile(v, 20)).toBe(4);
    expect(percentile(v, 80)).toBe(16);
    expect(percentile(v, 50)).toBe(10);
  });

  it('1..10 (n = 10): p95 is the maximum because ceil(9.5) = 10', () => {
    const v = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile(v, 90)).toBe(9); // ceil(9.0) = 9
    expect(percentile(v, 91)).toBe(10); // ceil(9.1) = 10
  });

  it('1..100 (n = 100) makes each percentile equal its k', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    for (const k of [1, 20, 29, 30, 50, 70, 80, 95, 99, 100]) expect(percentile(v, k)).toBe(k);
  });

  it('does not suffer binary rounding at exact rank boundaries (k = 70, n = 10 gives rank 7)', () => {
    // 0.7 * 10 evaluates to 7.000000000000001 in some orders; the integer product avoids it.
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 70)).toBe(7);
    expect(percentile(v, 30)).toBe(3);
    expect(percentile(v, 60)).toBe(6);
  });

  it('handles negative dBFS values, duplicates and does not mutate the input', () => {
    const v = [-50, -40, -40, -60, -30];
    const copy = [...v];
    expect(percentile(v, 50)).toBe(-40); // sorted [-60,-50,-40,-40,-30], rank 3
    expect(percentile(v, 20)).toBe(-60);
    expect(v).toEqual(copy);
  });

  it('returns null for an empty set and rejects k outside [0, 100]', () => {
    expect(percentile([], 50)).toBeNull();
    expect(median([])).toBeNull();
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], -1)).toThrow(RangeError);
  });
});

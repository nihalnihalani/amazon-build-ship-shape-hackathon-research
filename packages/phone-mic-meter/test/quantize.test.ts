import { describe, expect, it } from 'vitest';
import { quantizeCoverage, quantizeDb, quantizeMs } from '../src/quantize.js';

/** Hand-derived values: round(x * scale) / scale with Math.round (ties toward +infinity). */
describe('quantizeDb', () => {
  it.each([
    [-23.14, -23.1],
    [-23.16, -23.2],
    [-23.099999999999998, -23.1],
    [0.04, 0],
    [0.05, 0.1],
    [0.06, 0.1],
    [12.34, 12.3],
    [-140, -140],
    [20, 20],
    [-0.30000000000000004, -0.3],
    [0.1 * 3, 0.3],
  ])('%f -> %f', (input, expected) => {
    expect(quantizeDb(input)).toBe(expected);
  });

  it('an exact tie rounds toward +infinity (as @atr/protocol does): 0.25 -> 0.3, -0.25 -> -0.2, -42.25 -> -42.2', () => {
    expect(quantizeDb(0.25)).toBe(0.3);
    expect(quantizeDb(-0.25)).toBe(-0.2);
    expect(quantizeDb(-42.25)).toBe(-42.2);
  });

  it('never returns negative zero', () => {
    expect(Object.is(quantizeDb(-0.04), 0)).toBe(true);
    expect(Object.is(quantizeDb(-0), 0)).toBe(true);
  });

  it('returns non-finite input unchanged so the validator can reject it', () => {
    expect(Number.isNaN(quantizeDb(Number.NaN))).toBe(true);
    expect(quantizeDb(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('quantizeCoverage', () => {
  it.each([
    [0.9994, 0.999],
    [0.9996, 1],
    [1.0004, 1],
    [0.89375, 0.894],
    [0.89983, 0.9],
    [0.4, 0.4],
    [0, 0],
    [-0.0004, 0],
  ])('%f -> %f', (input, expected) => {
    expect(quantizeCoverage(input)).toBe(expected);
  });

  it('clamps to 0..1 and never returns negative zero', () => {
    expect(quantizeCoverage(1.5)).toBe(1);
    expect(quantizeCoverage(-0.5)).toBe(0);
    expect(Object.is(quantizeCoverage(-0.0004), 0)).toBe(true);
  });
});

describe('quantizeMs', () => {
  it('rounds to whole milliseconds and never returns negative zero', () => {
    expect(quantizeMs(149.6)).toBe(150);
    expect(quantizeMs(100.09)).toBe(100);
    expect(quantizeMs(0.4)).toBe(0);
    expect(Object.is(quantizeMs(-0.4), 0)).toBe(true);
    expect(quantizeMs(50)).toBe(50);
  });
});

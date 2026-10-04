import { describe, expect, it } from 'vitest';
import { frameSamples, frameStats, peakToDbfs, reduceFrame, rmsToDbfs } from '../src/frame.js';
import { sine } from './helpers.js';

/**
 * Expected values below are closed-form math written by hand:
 *   sine amplitude A, whole number of periods  ->  rms = A / sqrt(2),  dBFS = 20*log10(A / sqrt(2))
 *   constant x                                ->  rms = |x|,           dBFS = 20*log10(|x|)
 */

describe('frameSamples', () => {
  it('is round(sampleRate * 0.050)', () => {
    expect(frameSamples(48000)).toBe(2400);
    expect(frameSamples(44100)).toBe(2205);
    expect(frameSamples(16000)).toBe(800);
    expect(frameSamples(96000)).toBe(4800);
  });
  it('rejects invalid sample rates', () => {
    expect(() => frameSamples(0)).toThrow(RangeError);
    expect(() => frameSamples(-1)).toThrow(RangeError);
    expect(() => frameSamples(Number.NaN)).toThrow(RangeError);
  });
});

describe('RMS and dBFS closed forms', () => {
  // 1 kHz at 48 kHz has period 48 samples and 2400 / 48 = 50 whole periods per frame.
  it.each([
    [0.5, -9.0309], // 20*log10(0.5/sqrt2) = -6.0206 - 3.0103
    [1.0, -3.0103], // 20*log10(1/sqrt2)
    [0.1, -23.0103], // -20 - 3.0103
    [0.001, -63.0103], // -60 - 3.0103
  ])('sine amplitude %f gives %f dBFS', (amplitude, expectedDb) => {
    const x = sine(amplitude, 1000, 48000, 2400);
    const stats = frameStats(reduceFrame(x, 0, x.length));
    expect(stats.finite).toBe(true);
    expect(stats.rms).toBeCloseTo(amplitude / Math.SQRT2, 6);
    expect(stats.dbfs).toBeCloseTo(expectedDb, 3);
  });

  it('sine at 44.1 kHz (980 Hz has a 45-sample period: exactly 49 periods in 2205 samples) gives A/sqrt(2)', () => {
    const x = sine(0.25, 980, 44100, 2205);
    const stats = frameStats(reduceFrame(x, 0, x.length));
    expect(stats.dbfs).toBeCloseTo(-15.0515, 3); // 20*log10(0.25/sqrt2) = -12.0412 - 3.0103
  });

  it('constant 0.1 is exactly -20 dBFS and constant 0.5 is -6.0206 dBFS', () => {
    const dc = (v: number) => frameStats(reduceFrame(new Array<number>(2400).fill(v), 0, 2400));
    expect(dc(0.1).dbfs).toBeCloseTo(-20, 9);
    expect(dc(-0.1).dbfs).toBeCloseTo(-20, 9);
    expect(dc(0.5).dbfs).toBeCloseTo(-6.0206, 4);
  });

  it('values above full scale are reported and clamped at +20 dBFS', () => {
    const dc = (v: number) => frameStats(reduceFrame(new Array<number>(100).fill(v), 0, 100));
    expect(dc(5).dbfs).toBeCloseTo(13.9794, 4); // 20*log10(5)
    expect(dc(10).dbfs).toBeCloseTo(20, 9);
    expect(dc(100).dbfs).toBe(20); // 40 dB clamps to +20
  });
});

describe('silence and the epsilon floor', () => {
  it('digital silence is -140 dBFS and finite', () => {
    const stats = frameStats(reduceFrame(new Float32Array(2400), 0, 2400));
    expect(stats.finite).toBe(true);
    expect(stats.rms).toBe(0);
    expect(stats.dbfs).toBeCloseTo(-140, 9);
    expect(stats.clipped).toBe(false);
  });

  it.each([
    [1e-7, -140], // exactly epsilon
    [5e-8, -140], // below epsilon is floored
    [1e-12, -140],
    [2e-7, -133.9794], // 20*log10(2e-7) = -140 + 6.0206
    [1e-6, -120],
    [1e-4, -80],
  ])('constant %e gives %f dBFS', (value, expectedDb) => {
    const stats = frameStats(reduceFrame(new Array<number>(2400).fill(value), 0, 2400));
    expect(stats.dbfs).toBeCloseTo(expectedDb, 3);
    expect(stats.dbfs).toBeGreaterThanOrEqual(-140);
  });

  it('rmsToDbfs and peakToDbfs share the same floor and clamp', () => {
    expect(rmsToDbfs(0)).toBeCloseTo(-140, 9);
    expect(peakToDbfs(0)).toBeCloseTo(-140, 9);
    expect(rmsToDbfs(1000)).toBe(20);
  });
});

describe('non-finite samples', () => {
  it.each([
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('a single %s makes the frame non-finite and excluded from level math', (_name, bad) => {
    const x = new Array<number>(2400).fill(0.1);
    x[1234] = bad;
    const r = reduceFrame(x, 0, x.length);
    expect(r.nonfinite).toBe(true);
    expect(r.n).toBe(2400);
    const stats = frameStats(r);
    expect(stats.finite).toBe(false);
    expect(Number.isNaN(stats.dbfs)).toBe(true);
    expect(Number.isNaN(stats.rms)).toBe(true);
    expect(stats.clipped).toBe(false);
    // The scalar sums stay finite so downstream arithmetic cannot be poisoned.
    expect(Number.isFinite(r.sumSquares)).toBe(true);
  });

  it('an empty range is not finite', () => {
    expect(frameStats(reduceFrame([], 0, 0)).finite).toBe(false);
  });
});

describe('clipping thresholds', () => {
  it('sample threshold is |x| >= 0.999', () => {
    const r = reduceFrame([0.999, -0.999, 0.9989, -0.9989, 1.5, 0.5], 0, 6);
    expect(r.clippedCount).toBe(3);
    expect(r.peak).toBe(1.5);
  });

  it('frame threshold: 11 of 2400 samples (0.4583 %) is not clipped, 12 (0.5 %) is', () => {
    const make = (clippedSamples: number) => {
      const x = new Array<number>(2400).fill(0.1);
      for (let i = 0; i < clippedSamples; i++) x[i] = 1.0;
      return frameStats(reduceFrame(x, 0, 2400));
    };
    expect(make(11).clipped).toBe(false);
    expect(make(12).clipped).toBe(true);
    expect(make(0).clipped).toBe(false);
  });

  it('frame threshold boundary at 0.4999 % versus 0.5 % (1,000,000 samples)', () => {
    const n = 1_000_000;
    const make = (clippedSamples: number) => {
      const x = new Float32Array(n).fill(0.1);
      x.fill(1.0, 0, clippedSamples);
      return frameStats(reduceFrame(x, 0, n));
    };
    expect(make(4999).clipped).toBe(false); // 0.4999 %
    expect(make(5000).clipped).toBe(true); // 0.5 %
    expect(make(5001).clipped).toBe(true);
  });

  it('a float32 0.999 sample counts as clipped (float32(0.999) >= 0.999)', () => {
    const x = new Float32Array([0.999, 0.1]);
    expect(reduceFrame(x, 0, 2).clippedCount).toBe(1);
  });
});

describe('reduceFrame ranges', () => {
  it('reduces only [start, end)', () => {
    const x = [9, 9, 0.5, 0.5, 9, 9];
    const r = reduceFrame(x, 2, 4);
    expect(r.n).toBe(2);
    expect(r.sumSquares).toBeCloseTo(0.5, 12);
    expect(r.peak).toBe(0.5);
  });
  it('rejects bad ranges', () => {
    expect(() => reduceFrame([1, 2, 3], 2, 1)).toThrow(RangeError);
    expect(() => reduceFrame([1, 2, 3], 0, 4)).toThrow(RangeError);
    expect(() => reduceFrame([1, 2, 3], -1, 2)).toThrow(RangeError);
  });
});

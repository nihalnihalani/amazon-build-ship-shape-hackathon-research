import { describe, expect, it } from 'vitest';
import { summarizePrecheck } from '../src/precheck.js';
import type { PrecheckFrame } from '../src/precheck.js';
import { dbFrame, framesFromDb, nonfiniteFrame, runs, strideShuffle } from './helpers.js';

/**
 * Block construction for a 100-frame quiet check (n = 100, nearest rank):
 *   sorted indices 0-19 = A, 20-49 = B, 50-79 = C, 80-94 = D, 95-99 = E (A <= B <= C <= D <= E)
 *   p20 = sorted[19] = A   floor = p50 = sorted[49] = B   p80 = sorted[79] = C   p95 = sorted[94] = D
 * Frames are then permuted so that order cannot matter.
 */
function quiet(A: number, B: number, C: number, D: number, E: number): PrecheckFrame[] {
  const levels = runs([
    [A, 20],
    [B, 30],
    [C, 30],
    [D, 15],
    [E, 5],
  ]);
  return strideShuffle(framesFromDb(levels), 37);
}

const QUIET = { purpose: 'quiet_check', durationMs: 5000 } as const;

describe('quiet check statistics', () => {
  it('reports floor/p20/p80/p95 by nearest rank and the counts', () => {
    const r = summarizePrecheck(quiet(-46, -43, -40, -36, -35), QUIET);
    expect(r.purpose).toBe('quiet_check');
    expect(r.floor_dbfs).toBe(-43);
    expect(r.p20_dbfs).toBe(-46);
    expect(r.p80_dbfs).toBe(-40);
    expect(r.p95_dbfs).toBe(-36);
    expect(r.frame_count).toBe(100);
    expect(r.expected_frames).toBe(100);
    expect(r.coverage).toBe(1);
    expect(r.clipped_frames).toBe(0);
    expect(r.nonfinite_frames).toBe(0);
    expect(r.duration_ms).toBe(5000);
    expect(r.valid).toBe(true);
    expect(r.invalid_reason).toBeNull();
  });

  it('pre_window expects 40 frames for 2000 ms', () => {
    const r = summarizePrecheck(framesFromDb(runs([[-50, 40]])), { purpose: 'pre_window', durationMs: 2000 });
    expect(r.expected_frames).toBe(40);
    expect(r.valid).toBe(true);
  });

  it('is independent of frame order', () => {
    const a = summarizePrecheck(quiet(-46, -43, -40, -36, -35), QUIET);
    const reversed = [...quiet(-46, -43, -40, -36, -35)].reverse();
    expect(summarizePrecheck(reversed, QUIET)).toEqual(a);
  });
});

describe('quiet check validity boundaries (ADR-0001 §2)', () => {
  it('stable: p80 - p20 = 6 is valid, 6.01 is unstable_floor', () => {
    // C - A: -40 - (-46) = 6 ; -39.99 - (-46) = 6.01
    expect(summarizePrecheck(quiet(-46, -43, -40, -36, -35), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-46, -43, -39.99, -36, -35), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('unstable_floor');
  });

  it('bursts: p95 - floor = 10 is valid, 10.01 is burst_noise', () => {
    // D - B: -33 - (-43) = 10 ; -32.99 - (-43) = 10.01 (C - A stays 6)
    expect(summarizePrecheck(quiet(-46, -43, -40, -33, -30), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-46, -43, -40, -32.99, -30), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('burst_noise');
  });

  it('loud room: floor -30 is valid, -29.99 is too_loud', () => {
    // C - A = -28 - (-33) = 5 ; D - B = -24 - (-30) = 6
    expect(summarizePrecheck(quiet(-33, -30, -28, -24, -23), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-33, -29.99, -28, -24, -23), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('too_loud');
  });

  it('values that are exact in decimal but inexact in binary still sit on the right side of the line', () => {
    // -50.3 + 6 = -44.3: the double subtraction gives 6.000000000000007; tolerance keeps it valid.
    expect(summarizePrecheck(quiet(-50.3, -48, -44.3, -42, -41), QUIET).valid).toBe(true);
    // -44.29 is 6.01 above -50.3: invalid.
    expect(summarizePrecheck(quiet(-50.3, -48, -44.29, -42, -41), QUIET).invalid_reason).toBe('unstable_floor');
  });

  it('coverage: 90 of 100 frames (0.90) is valid, 89 (0.89) is low_coverage', () => {
    const flat = (n: number) => framesFromDb(runs([[-50, n]]));
    const ok = summarizePrecheck(flat(90), QUIET);
    expect(ok.coverage).toBe(0.9);
    expect(ok.valid).toBe(true);
    const bad = summarizePrecheck(flat(89), QUIET);
    expect(bad.coverage).toBe(0.89);
    expect(bad.invalid_reason).toBe('low_coverage');
  });

  it('coverage: 0.9000 versus 0.8999 (10000 expected frames)', () => {
    const flat = (n: number) => framesFromDb(runs([[-50, n]]));
    const long = { purpose: 'quiet_check', durationMs: 500_000 } as const; // 10000 expected frames
    const ok = summarizePrecheck(flat(9000), long);
    expect(ok.expected_frames).toBe(10000);
    expect(ok.coverage).toBe(0.9);
    expect(ok.valid).toBe(true);
    const bad = summarizePrecheck(flat(8999), long);
    expect(bad.coverage).toBe(0.8999);
    expect(bad.invalid_reason).toBe('low_coverage');
  });

  it('any clipped frame invalidates (clipped) and is excluded from the statistics', () => {
    const frames = [...framesFromDb(runs([[-50, 99]])), dbFrame(99, -1, { clipped: true })];
    const r = summarizePrecheck(frames, QUIET);
    expect(r.clipped_frames).toBe(1);
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('clipped');
    expect(r.floor_dbfs).toBe(-50);
    expect(r.p95_dbfs).toBe(-50); // the -1 dBFS clipped frame is not in the percentile set
  });

  it('non-finite frames are excluded from statistics and count against coverage', () => {
    const frames = [...framesFromDb(runs([[-50, 95]])), ...[95, 96, 97, 98, 99].map(nonfiniteFrame)];
    const r = summarizePrecheck(frames, QUIET);
    expect(r.nonfinite_frames).toBe(5);
    expect(r.frame_count).toBe(100);
    expect(r.coverage).toBe(0.95);
    expect(r.floor_dbfs).toBe(-50);
    // 5 / 100 = 5.0 % is not more than 5 %.
    expect(r.valid).toBe(true);
  });

  it('non-finite fraction above 5 % is invalid (6 of 100), coverage still 0.94', () => {
    const frames = [...framesFromDb(runs([[-50, 94]])), ...[94, 95, 96, 97, 98, 99].map(nonfiniteFrame)];
    const r = summarizePrecheck(frames, QUIET);
    expect(r.coverage).toBe(0.94);
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('nonfinite');
  });

  it('empty input has null statistics, zero coverage and is low_coverage', () => {
    const r = summarizePrecheck([], QUIET);
    expect(r.floor_dbfs).toBeNull();
    expect(r.p20_dbfs).toBeNull();
    expect(r.p80_dbfs).toBeNull();
    expect(r.p95_dbfs).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.frame_count).toBe(0);
    expect(r.invalid_reason).toBe('low_coverage');
  });

  it('an interrupted precheck is invalid with reason interrupted even if otherwise clean', () => {
    const r = summarizePrecheck(quiet(-46, -43, -40, -36, -35), { ...QUIET, interrupted: true });
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('interrupted');
  });

  it('coverage is capped at 1 if extra frames are supplied', () => {
    const r = summarizePrecheck(framesFromDb(runs([[-50, 120]])), QUIET);
    expect(r.coverage).toBe(1);
    expect(r.frame_count).toBe(120);
  });
});

describe('reason priority (quiet_check)', () => {
  it('low_coverage beats clipped, clipped beats unstable_floor, unstable beats burst, burst beats too_loud', () => {
    // clipped + low coverage
    const a = [...framesFromDb(runs([[-50, 20]])), dbFrame(20, -1, { clipped: true })];
    expect(summarizePrecheck(a, QUIET).invalid_reason).toBe('low_coverage');

    // clipped + unstable
    const b = [...quiet(-60, -50, -40, -36, -35).slice(1), dbFrame(0, -1, { clipped: true })];
    expect(summarizePrecheck(b, QUIET).invalid_reason).toBe('clipped');

    // unstable (C - A = 20) and burst (D - B = 20) and too loud (B = -20): unstable wins
    expect(summarizePrecheck(quiet(-40, -20, -20, 0, 0), QUIET).invalid_reason).toBe('unstable_floor');
    // burst (D - B = 12 > 10) and too loud, stable (C - A = 3): burst wins
    expect(summarizePrecheck(quiet(-23, -20, -20, -8, -8), QUIET).invalid_reason).toBe('burst_noise');
    // too loud only
    expect(summarizePrecheck(quiet(-23, -20, -20, -18, -18), QUIET).invalid_reason).toBe('too_loud');
  });
});

describe('pre_window evaluates only coverage, clipping, non-finite and the burst rule', () => {
  const PRE = { purpose: 'pre_window', durationMs: 2000 } as const;

  it('an unstable or loud floor is NOT a pre_window failure (the TV judges rise and margin)', () => {
    // 40 frames: 8 at -40, 12 at -20, 12 at -20, 6 at -15, 2 at -14 -> floor -20, p80-p20 = 20
    const frames = framesFromDb(
      runs([
        [-40, 8],
        [-20, 24],
        [-15, 6],
        [-14, 2],
      ]),
    );
    const r = summarizePrecheck(frames, PRE);
    expect(r.floor_dbfs).toBe(-20);
    expect(r.valid).toBe(true);
    expect(r.invalid_reason).toBeNull();
  });

  it('burst rule: p95 - floor = 10 valid, 10.01 burst_noise', () => {
    // n = 40: sorted idx 0-19 = -50 (floor = sorted[19]); p95 = sorted[ceil(38)-1] = sorted[37]
    const make = (top: number) => framesFromDb(runs([[-50, 20], [top, 20]]));
    // floor = sorted[ceil(20)-1] = sorted[19] = -50; p95 = sorted[37] = top
    expect(summarizePrecheck(make(-40), PRE).valid).toBe(true);
    const bad = summarizePrecheck(make(-39.99), PRE);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('burst_noise');
  });

  it('coverage 0.90 valid and 0.875 invalid for 40 expected frames (36 vs 35)', () => {
    const flat = (n: number) => framesFromDb(runs([[-50, n]]));
    expect(summarizePrecheck(flat(36), PRE).valid).toBe(true); // 0.9
    expect(summarizePrecheck(flat(35), PRE).invalid_reason).toBe('low_coverage'); // 0.875
  });

  it('clipped and non-finite follow the same rules', () => {
    const clipped = [...framesFromDb(runs([[-50, 39]])), dbFrame(39, 0, { clipped: true })];
    expect(summarizePrecheck(clipped, PRE).invalid_reason).toBe('clipped');
    // 3 of 40 non-finite = 7.5 % > 5 %, coverage 37/40 = 0.925
    const nf = [...framesFromDb(runs([[-50, 37]])), ...[37, 38, 39].map(nonfiniteFrame)];
    expect(summarizePrecheck(nf, PRE).invalid_reason).toBe('nonfinite');
  });
});

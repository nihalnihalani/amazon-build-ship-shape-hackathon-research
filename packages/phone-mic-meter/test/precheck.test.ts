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
const PRE = { purpose: 'pre_window', durationMs: 2000 } as const;

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
    const r = summarizePrecheck(framesFromDb(runs([[-50, 40]])), PRE);
    expect(r.expected_frames).toBe(40);
    expect(r.valid).toBe(true);
  });

  it('is independent of frame order', () => {
    const a = summarizePrecheck(quiet(-46, -43, -40, -36, -35), QUIET);
    const reversed = [...quiet(-46, -43, -40, -36, -35)].reverse();
    expect(summarizePrecheck(reversed, QUIET)).toEqual(a);
  });
});

describe('quantisation (PK-06): emitted numbers are multiples of 0.1 dB and 0.001, and the rules use them', () => {
  it('percentiles are emitted to 0.1 dB', () => {
    // A -50.04 -> -50.0 ; B -43.25 -> -43.2 (an exact tie rounds toward +infinity, like quantizeDb in
    // @atr/protocol) ; C -40.26 -> -40.3 ; D -36.5 -> -36.5
    const r = summarizePrecheck(quiet(-50.04, -43.25, -40.26, -36.5, -35), QUIET);
    expect(r.p20_dbfs).toBe(-50);
    expect(r.floor_dbfs).toBe(-43.2);
    expect(r.p80_dbfs).toBe(-40.3);
    expect(r.p95_dbfs).toBe(-36.5);
  });

  it('never emits negative zero', () => {
    const r = summarizePrecheck(framesFromDb(runs([[-0.04, 40]])), PRE);
    expect(Object.is(r.floor_dbfs, -0)).toBe(false);
    expect(r.floor_dbfs).toBe(0);
  });

  it('coverage is emitted to 0.001 while the coverage rule uses the exact counts', () => {
    // 539 of 599 expected frames: exact 0.89983 < 0.90 -> low_coverage, although it is emitted as 0.900
    const flat = framesFromDb(runs([[-50, 539]]));
    const r = summarizePrecheck(flat, { purpose: 'quiet_check', durationMs: 29950 });
    expect(r.expected_frames).toBe(599);
    expect(r.coverage).toBe(0.9);
    expect(r.invalid_reason).toBe('low_coverage');
  });

  it('the dB rules are decided on the emitted (rounded) values so a receiver can recompute validity', () => {
    // raw p80 - p20 = 6.04 rounds to 6.0 (valid); raw 6.06 rounds to 6.1 (invalid)
    expect(summarizePrecheck(quiet(-50, -48, -43.96, -42, -41), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-50, -48, -43.94, -42, -41), QUIET);
    expect(bad.p80_dbfs).toBe(-43.9);
    expect(bad.invalid_reason).toBe('unstable_floor');
    // raw floor -29.96 rounds to -30.0 (not too loud)
    expect(summarizePrecheck(quiet(-33, -29.96, -28, -24, -23), QUIET).valid).toBe(true);
  });

  it('duration_ms is emitted as an integer', () => {
    const r = summarizePrecheck(framesFromDb(runs([[-50, 40]])), { purpose: 'pre_window', durationMs: 2000.4 });
    expect(r.duration_ms).toBe(2000);
    expect(r.expected_frames).toBe(40);
  });
});

describe('quiet check validity boundaries (ADR-0001 §2)', () => {
  it('stable: p80 - p20 = 6.0 is valid, 6.1 is unstable_floor', () => {
    expect(summarizePrecheck(quiet(-46, -43, -40, -36, -35), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-46, -43, -39.9, -36, -35), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('unstable_floor');
  });

  it('bursts: p95 - floor = 10.0 is valid, 10.1 is burst_noise', () => {
    expect(summarizePrecheck(quiet(-46, -43, -40, -33, -30), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-46, -43, -40, -32.9, -30), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('burst_noise');
  });

  it('loud room: floor -30.0 is valid, -29.9 is too_loud', () => {
    expect(summarizePrecheck(quiet(-33, -30, -28, -24, -23), QUIET).valid).toBe(true);
    const bad = summarizePrecheck(quiet(-33, -29.9, -28, -24, -23), QUIET);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('too_loud');
  });

  it('values that are exact in decimal but inexact in binary still sit on the right side of the line', () => {
    // -50.3 + 6 = -44.3: the double subtraction gives 6.000000000000007; tolerance keeps it valid.
    expect(summarizePrecheck(quiet(-50.3, -48, -44.3, -42, -41), QUIET).valid).toBe(true);
    // -44.2 is 6.1 above -50.3: invalid.
    expect(summarizePrecheck(quiet(-50.3, -48, -44.2, -42, -41), QUIET).invalid_reason).toBe('unstable_floor');
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
    expect(bad.coverage).toBe(0.9); // 0.8999 emitted to 0.001
    expect(bad.invalid_reason).toBe('low_coverage'); // the rule uses the exact counts
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

describe('silent_input (A1-05): a muted or blocked microphone is not a valid quiet room', () => {
  const flat = (db: number, n = 100) => framesFromDb(runs([[db, n]]));

  it('floor -110.0 dBFS is valid, -110.1 is silent_input (quiet check)', () => {
    expect(summarizePrecheck(flat(-110), QUIET).valid).toBe(true);
    const r = summarizePrecheck(flat(-110.1), QUIET);
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('silent_input');
    expect(r.floor_dbfs).toBe(-110.1);
  });

  it('digital silence (-140 dBFS) is silent_input, for both purposes', () => {
    expect(summarizePrecheck(flat(-140), QUIET).invalid_reason).toBe('silent_input');
    expect(summarizePrecheck(flat(-140, 40), PRE).invalid_reason).toBe('silent_input');
  });

  it('raw -110.04 rounds to -110.0 and is not silent; raw -110.06 rounds to -110.1 and is', () => {
    expect(summarizePrecheck(flat(-110.04), QUIET).valid).toBe(true);
    expect(summarizePrecheck(flat(-110.06), QUIET).invalid_reason).toBe('silent_input');
  });

  it('priority: low_coverage beats silent_input, silent_input beats clipped', () => {
    expect(summarizePrecheck(flat(-140, 50), QUIET).invalid_reason).toBe('low_coverage');
    const withClip = [...flat(-120, 99), dbFrame(99, -3, { clipped: true })];
    expect(summarizePrecheck(withClip, QUIET).invalid_reason).toBe('silent_input');
  });
});

describe('reason priority (quiet_check, A1-07)', () => {
  it('interrupted > nonfinite > low_coverage > silent_input > clipped > unstable_floor > burst_noise > too_loud', () => {
    const flatFrames = (db: number, n: number) => framesFromDb(runs([[db, n]]));

    // interrupted beats everything
    expect(
      summarizePrecheck([...flatFrames(-140, 50), ...[50, 51, 52, 53, 54, 55].map(nonfiniteFrame)], {
        ...QUIET,
        interrupted: true,
      }).invalid_reason,
    ).toBe('interrupted');

    // nonfinite (20 % of frames) beats low_coverage (coverage 0.4)
    const nf = [...flatFrames(-50, 40), ...Array.from({ length: 10 }, (_, i) => nonfiniteFrame(40 + i))];
    const nfResult = summarizePrecheck(nf, QUIET);
    expect(nfResult.coverage).toBe(0.4);
    expect(nfResult.invalid_reason).toBe('nonfinite');

    // low_coverage beats clipped
    expect(
      summarizePrecheck([...flatFrames(-50, 20), dbFrame(20, -1, { clipped: true })], QUIET).invalid_reason,
    ).toBe('low_coverage');

    // clipped beats unstable (C - A = 20)
    const clippedUnstable = [...quiet(-60, -50, -40, -36, -35).slice(1), dbFrame(0, -1, { clipped: true })];
    expect(summarizePrecheck(clippedUnstable, QUIET).invalid_reason).toBe('clipped');

    // unstable (C - A = 20) and burst (D - B = 20) and too loud (B = -20): unstable wins
    expect(summarizePrecheck(quiet(-40, -20, -20, 0, 0), QUIET).invalid_reason).toBe('unstable_floor');
    // burst (D - B = 12 > 10) and too loud, stable (C - A = 3): burst wins
    expect(summarizePrecheck(quiet(-23, -20, -20, -8, -8), QUIET).invalid_reason).toBe('burst_noise');
    // too loud only
    expect(summarizePrecheck(quiet(-23, -20, -20, -18, -18), QUIET).invalid_reason).toBe('too_loud');
  });
});

describe('pre_window reasons are only interrupted, nonfinite, low_coverage, silent_input, clipped, burst_noise (A1-06)', () => {
  it('an unstable or loud floor is NOT a pre_window failure (the TV judges rise and margin)', () => {
    // 40 frames: 8 at -28, 12 at -24, 12 at -20, 6 at -16, 2 at -15 -> floor -24, p80 - p20 = 8
    const frames = framesFromDb(
      runs([
        [-28, 8],
        [-24, 12],
        [-20, 12],
        [-16, 6],
        [-15, 2],
      ]),
    );
    const r = summarizePrecheck(frames, PRE);
    expect(r.floor_dbfs).toBe(-24);
    expect(r.p80_dbfs! - r.p20_dbfs!).toBe(8);
    expect(r.valid).toBe(true);
    expect(r.invalid_reason).toBeNull();
  });

  it('burst rule: p95 - floor = 10.0 valid, 10.1 burst_noise', () => {
    // n = 40: sorted idx 0-19 = -50 (floor = sorted[19]); p95 = sorted[37] = top
    const make = (top: number) => framesFromDb(runs([[-50, 20], [top, 20]]));
    expect(summarizePrecheck(make(-40), PRE).valid).toBe(true);
    const bad = summarizePrecheck(make(-39.9), PRE);
    expect(bad.valid).toBe(false);
    expect(bad.invalid_reason).toBe('burst_noise');
  });

  it('coverage 0.90 valid and 0.875 invalid for 40 expected frames (36 vs 35)', () => {
    const flat = (n: number) => framesFromDb(runs([[-50, n]]));
    expect(summarizePrecheck(flat(36), PRE).valid).toBe(true); // 0.9
    const bad = summarizePrecheck(flat(35), PRE);
    expect(bad.coverage).toBe(0.875);
    expect(bad.invalid_reason).toBe('low_coverage');
  });

  it('clipped and non-finite follow the same rules', () => {
    const clipped = [...framesFromDb(runs([[-50, 39]])), dbFrame(39, 0, { clipped: true })];
    expect(summarizePrecheck(clipped, PRE).invalid_reason).toBe('clipped');
    // 3 of 40 non-finite = 7.5 % > 5 %, coverage 37/40 = 0.925
    const nf = [...framesFromDb(runs([[-50, 37]])), ...[37, 38, 39].map(nonfiniteFrame)];
    expect(summarizePrecheck(nf, PRE).invalid_reason).toBe('nonfinite');
  });

  it('priority: nonfinite > low_coverage > silent_input > clipped > burst_noise', () => {
    // 25 finite + 15 non-finite of 40: non-finite 37.5 % (and coverage 0.625): nonfinite wins
    const nf = [...framesFromDb(runs([[-50, 25]])), ...Array.from({ length: 15 }, (_, i) => nonfiniteFrame(25 + i))];
    expect(summarizePrecheck(nf, PRE).invalid_reason).toBe('nonfinite');
    // clipped beats burst
    const clippedBurst = [...framesFromDb(runs([[-50, 20], [-30, 19]])), dbFrame(39, -1, { clipped: true })];
    expect(summarizePrecheck(clippedBurst, PRE).invalid_reason).toBe('clipped');
    // silent beats clipped
    const silentClipped = [...framesFromDb(runs([[-130, 39]])), dbFrame(39, -1, { clipped: true })];
    expect(summarizePrecheck(silentClipped, PRE).invalid_reason).toBe('silent_input');
  });

  it('never reports unstable_floor or too_loud', () => {
    const wild = framesFromDb(runs([[-20, 10], [-5, 10], [-18, 10], [-3, 10]]));
    const r = summarizePrecheck(wild, PRE);
    expect(['unstable_floor', 'too_loud']).not.toContain(r.invalid_reason);
  });
});

import { describe, expect, it } from 'vitest';
import {
  type FrameStat,
  findSegments,
  frameSizeFor,
  nearestRank,
  reduceFrame,
  summarizePrecheck,
  summarizeWindow,
} from '../src/audio/dsp.js';

/**
 * Expected values below are worked out by hand from ADR-0001 (50 ms frames, nearest-rank
 * percentiles, candidate rel >= 6 dB, 6-frame hangover, 4-frame minimum), not produced by
 * running the implementation. This module is temporary; @atr/phone-mic-meter supersedes it.
 */

const f = (index: number, dbfs: number, extra: Partial<FrameStat> = {}): FrameStat => ({
  index,
  finite: true,
  dbfs,
  clipped: false,
  ...extra,
});

/** Pattern: x = loud (-40), . = quiet (-70), ! = non-finite. */
function pattern(p: string): FrameStat[] {
  return [...p].map((c, i) =>
    c === '!' ? f(i, -140, { finite: false }) : f(i, c === 'x' ? -40 : -70),
  );
}

describe('frames and percentiles', () => {
  it('frame length is round(sampleRate * 0.05)', () => {
    expect(frameSizeFor(48000)).toBe(2400);
    expect(frameSizeFor(44100)).toBe(2205);
  });

  it('rms 0.1 is exactly -20 dBFS; zero input hits the -140 floor; huge values clamp to +20', () => {
    expect(reduceFrame(0, { sumSq: 2400 * 0.01, count: 2400, clipped: 0, nonFinite: false }).dbfs).toBeCloseTo(-20, 9);
    expect(reduceFrame(0, { sumSq: 0, count: 2400, clipped: 0, nonFinite: false }).dbfs).toBe(-140);
    expect(reduceFrame(0, { sumSq: 2400 * 1e4, count: 2400, clipped: 0, nonFinite: false }).dbfs).toBe(20);
  });

  it('a frame with non-finite samples is excluded', () => {
    expect(reduceFrame(3, { sumSq: 1, count: 100, clipped: 0, nonFinite: true }).finite).toBe(false);
    expect(reduceFrame(3, { sumSq: Number.NaN, count: 100, clipped: 0, nonFinite: false }).finite).toBe(false);
  });

  it('a frame is clipped at 0.5 % clipped samples (12 of 2400) and not at 11', () => {
    expect(reduceFrame(0, { sumSq: 1, count: 2400, clipped: 12, nonFinite: false }).clipped).toBe(true);
    expect(reduceFrame(0, { sumSq: 1, count: 2400, clipped: 11, nonFinite: false }).clipped).toBe(false);
  });

  it('nearest-rank percentiles', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRank(ten, 50)).toBe(5); // ceil(5)=5 -> 5th
    expect(nearestRank(ten, 20)).toBe(2);
    expect(nearestRank(ten, 80)).toBe(8);
    expect(nearestRank(ten, 95)).toBe(10); // ceil(9.5)=10
    expect(nearestRank([42], 95)).toBe(42);
    expect(nearestRank([1, 2, 3, 4, 5], 80)).toBe(4); // ceil(4)=4
  });
});

describe('summarizePrecheck (ADR-0001 section 2)', () => {
  const flat = (n: number, db: number): FrameStat[] => Array.from({ length: n }, (_, i) => f(i, db));
  const mixed = (parts: Array<[number, number]>): FrameStat[] => {
    const out: FrameStat[] = [];
    for (const [n, db] of parts) for (let i = 0; i < n; i++) out.push(f(out.length, db));
    return out;
  };

  it('a steady quiet room is valid and reports the median as the floor', () => {
    const r = summarizePrecheck(flat(100, -60), 'quiet_check', 100);
    expect(r).toMatchObject({ valid: true, invalid_reason: null, floor_dbfs: -60, p20_dbfs: -60, p80_dbfs: -60, p95_dbfs: -60, coverage: 1, frame_count: 100, expected_frames: 100 });
  });

  it('coverage boundary: 90 of 100 frames passes, 89 fails', () => {
    expect(summarizePrecheck(flat(90, -60), 'quiet_check', 100).valid).toBe(true);
    expect(summarizePrecheck(flat(89, -60), 'quiet_check', 100)).toMatchObject({ valid: false, invalid_reason: 'low_coverage' });
  });

  it('any clipped frame invalidates', () => {
    const frames = flat(100, -60);
    frames[10] = f(10, -60, { clipped: true });
    expect(summarizePrecheck(frames, 'quiet_check', 100)).toMatchObject({ valid: false, invalid_reason: 'clipped', clipped_frames: 1 });
  });

  it('stability: p80 - p20 = 6 dB passes, 15 dB fails', () => {
    // 25 @ -66, 50 @ -63, 25 @ -60 -> p20 = -66, p50 = -63, p80 = -60, p95 = -60
    const ok = summarizePrecheck(mixed([[25, -66], [50, -63], [25, -60]]), 'quiet_check', 100);
    expect(ok).toMatchObject({ valid: true, p20_dbfs: -66, floor_dbfs: -63, p80_dbfs: -60, p95_dbfs: -60 });
    const bad = summarizePrecheck(mixed([[25, -70], [50, -62], [25, -55]]), 'quiet_check', 100);
    expect(bad).toMatchObject({ valid: false, invalid_reason: 'unstable_floor', p20_dbfs: -70, p80_dbfs: -55 });
  });

  it('bursts: p95 - floor = 10 dB passes, 15 dB fails', () => {
    // 94 @ -60 + 6 @ -50 -> p95 = sorted[94] = -50 (diff 10); with -45 diff 15
    expect(summarizePrecheck(mixed([[94, -60], [6, -50]]), 'quiet_check', 100).valid).toBe(true);
    expect(summarizePrecheck(mixed([[94, -60], [6, -45]]), 'quiet_check', 100)).toMatchObject({ valid: false, invalid_reason: 'burst_noise' });
  });

  it('loud room: floor -30 passes, -29 is too loud', () => {
    expect(summarizePrecheck(flat(100, -30), 'quiet_check', 100).valid).toBe(true);
    expect(summarizePrecheck(flat(100, -29), 'quiet_check', 100)).toMatchObject({ valid: false, invalid_reason: 'too_loud' });
  });

  it('too many non-finite frames are reported as nonfinite', () => {
    const frames = [...flat(90, -60), ...Array.from({ length: 10 }, (_, i) => f(90 + i, -140, { finite: false }))];
    expect(summarizePrecheck(frames, 'pre_window', 100)).toMatchObject({ valid: false, invalid_reason: 'nonfinite', nonfinite_frames: 10 });
  });

  it('echoes the purpose and an empty run is invalid with null statistics', () => {
    const r = summarizePrecheck([], 'pre_window', 40);
    expect(r).toMatchObject({ purpose: 'pre_window', valid: false, floor_dbfs: null, frame_count: 0, coverage: 0 });
  });
});

describe('VAD segments (ADR-0001 section 3), floor -60 dBFS so candidates are >= -54', () => {
  it('a 150 ms burst (3 frames) is rejected, 200 ms (4 frames) is accepted', () => {
    expect(findSegments(pattern('....xxx.....'), -60)).toHaveLength(0);
    const segs = findSegments(pattern('....xxxx.....'), -60);
    expect(segs).toEqual([{ first: 4, last: 7, candidates: 4 }]);
  });

  it('a gap of 5 quiet frames (250 ms) is bridged; 6 (300 ms) splits', () => {
    const bridged = findSegments(pattern('xxxx.....xxxx'), -60);
    expect(bridged).toHaveLength(1);
    expect(bridged[0]).toMatchObject({ first: 0, last: 12, candidates: 8 });
    const split = findSegments(pattern('xxxx......xxxx'), -60);
    expect(split).toHaveLength(2);
  });

  it('a candidate exactly 6 dB above the floor counts; 5.9 dB does not', () => {
    const at = Array.from({ length: 4 }, (_, i) => f(i, -54));
    const below = Array.from({ length: 4 }, (_, i) => f(i, -54.1));
    expect(findSegments(at, -60)).toHaveLength(1);
    expect(findSegments(below, -60)).toHaveLength(0);
  });

  it('non-finite frames are never candidates: they cannot start a segment, and inside a segment they count as gap frames', () => {
    expect(findSegments(pattern('!!!!!!!!'), -60)).toHaveLength(0);
    expect(findSegments(pattern('xx!!xx'), -60)).toHaveLength(1); // 2-frame gap is bridged (< 6)
    expect(findSegments(pattern('xxxx!!!!!!xxxx'), -60)).toHaveLength(2); // 6-frame gap splits
  });
});

describe('summarizeWindow (ADR-0001 section 6)', () => {
  const win = (p: string, kind: 'calibration' | 'vowel' | 'phrase' = 'phrase', expected = p.length) =>
    summarizeWindow(pattern(p), kind, -60, expected);

  it('no activity is no_voice', () => {
    expect(win('.'.repeat(160))).toMatchObject({ valid: false, invalid_reason: 'no_voice', segments: 0, onset_ms: null, p50_active_dbfs: null });
  });

  it('400 ms of activity is the minimum for phrase/calibration (8 frames ok, 7 not); vowel needs just a segment', () => {
    const pad = '.'.repeat(40);
    expect(win(`${pad}${'x'.repeat(8)}${pad}`)).toMatchObject({ valid: true, active_ms: 400, longest_active_ms: 400, segments: 1, onset_ms: 2000 });
    expect(win(`${pad}${'x'.repeat(7)}${pad}`, 'phrase')).toMatchObject({ valid: false, invalid_reason: 'no_voice', active_ms: 350 });
    expect(win(`${pad}${'x'.repeat(7)}${pad}`, 'calibration')).toMatchObject({ valid: false, invalid_reason: 'no_voice' });
    expect(win(`${pad}${'x'.repeat(7)}${pad}`, 'vowel')).toMatchObject({ valid: true, active_ms: 350 });
  });

  it('active_ms sums accepted segments and longest_active_ms is the longest', () => {
    // 10 loud, 6 quiet (split), 6 loud
    const r = win(`${'x'.repeat(10)}${'.'.repeat(6)}${'x'.repeat(6)}${'.'.repeat(20)}`, 'vowel');
    expect(r).toMatchObject({ segments: 2, active_ms: 800, longest_active_ms: 500 });
  });

  it('statistics are nearest-rank over frames inside accepted segments; peak over all finite frames', () => {
    const frames: FrameStat[] = [
      ...Array.from({ length: 10 }, (_, i) => f(i, -70)),
      ...[-40, -39, -38, -37, -36, -35, -34, -33].map((db, i) => f(10 + i, db)),
      ...Array.from({ length: 10 }, (_, i) => f(18 + i, -70)),
    ];
    const r = summarizeWindow(frames, 'phrase', -60, frames.length);
    // 8 active frames sorted: p50 = ceil(4) = 4th = -37; p95 = ceil(7.6) = 8th = -33
    expect(r).toMatchObject({ p50_active_dbfs: -37, p95_active_dbfs: -33, peak_dbfs: -33, onset_ms: 500 });
  });

  it('coverage: 144 finite frames out of 160 expected passes (0.9), 143 fails', () => {
    // Frames missing from the end (e.g. the audio clock stalled), none flagged non-finite.
    const mk = (received: number): FrameStat[] => pattern('x'.repeat(received));
    expect(summarizeWindow(mk(144), 'vowel', -60, 160)).toMatchObject({ valid: true, coverage: 0.9, frame_count: 144, expected_frames: 160 });
    expect(summarizeWindow(mk(143), 'vowel', -60, 160)).toMatchObject({ valid: false, invalid_reason: 'low_coverage' });
  });

  it('non-finite share above 5 % is nonfinite, exactly 5 % is not', () => {
    const mk = (bad: number): FrameStat[] => {
      const frames = pattern(`${'.'.repeat(40)}${'x'.repeat(100)}${'.'.repeat(20)}`);
      for (let i = 0; i < bad; i++) frames[i] = f(i, -140, { finite: false });
      return frames;
    };
    expect(summarizeWindow(mk(9), 'vowel', -60, 160)).toMatchObject({ valid: false, invalid_reason: 'nonfinite', nonfinite_frames: 9 });
    expect(summarizeWindow(mk(8), 'vowel', -60, 160)).toMatchObject({ valid: true, nonfinite_frames: 8 });
  });

  it('clipping above 2 % of active frames invalidates', () => {
    const frames = pattern(`${'.'.repeat(20)}${'x'.repeat(50)}${'.'.repeat(20)}`);
    frames[30] = f(30, -40, { clipped: true });
    // 1 of 50 active frames = 2 % exactly: allowed (invalid only when > 2 %)
    expect(summarizeWindow(frames, 'vowel', -60, 90)).toMatchObject({ valid: true, clipped_frames: 1 });
    frames[31] = f(31, -40, { clipped: true });
    expect(summarizeWindow(frames, 'vowel', -60, 90)).toMatchObject({ valid: false, invalid_reason: 'clipped', clipped_frames: 2 });
  });

  it('phrase windows reject sound covering more than 95 % of the window', () => {
    // 160 expected frames: 152 loud = 7600 ms = 0.95 -> allowed; 153 = 7650 ms -> continuous
    const mk = (loud: number): FrameStat[] => pattern(`${'x'.repeat(loud)}${'.'.repeat(160 - loud)}`);
    expect(summarizeWindow(mk(152), 'phrase', -60, 160)).toMatchObject({ valid: true });
    expect(summarizeWindow(mk(153), 'phrase', -60, 160)).toMatchObject({ valid: false, invalid_reason: 'continuous_sound' });
  });

  it('duration is frames x 50 ms', () => {
    expect(win('.'.repeat(37)).duration_ms).toBe(1850);
  });
});

import { describe, expect, it } from 'vitest';
import { VoiceActivityTracker } from '../src/vad.js';
import { dbFrame, nonfiniteFrame, runs } from './helpers.js';

/**
 * Session floor -60 dBFS. Candidate level C = -50 (rel +10 dB). Quiet level Q = -58 (rel +2 dB).
 * One frame is 50 ms, so n candidate frames = 50n ms.
 */
const FLOOR = -60;
const C = -50;
const Q = -58;

function run(levels: ReadonlyArray<number>): VoiceActivityTracker {
  const vad = new VoiceActivityTracker(FLOOR);
  levels.forEach((db, i) => vad.push(dbFrame(i, db)));
  return vad;
}

describe('candidate threshold (rel >= 6 dB)', () => {
  it('exactly +6 dB is a candidate, +5.99 dB is not', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    expect(vad.push(dbFrame(0, -54)).candidate).toBe(true);
    expect(vad.push(dbFrame(1, -54.01)).candidate).toBe(false);
    expect(vad.push(dbFrame(2, -53.99)).candidate).toBe(true);
  });

  it('a non-finite frame is never a candidate', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    expect(vad.push(nonfiniteFrame(0)).candidate).toBe(false);
  });

  it('rejects a non-finite floor', () => {
    expect(() => new VoiceActivityTracker(Number.NaN)).toThrow(RangeError);
  });
});

describe('minimum accepted duration: 200 ms of candidate activity', () => {
  it('100 ms (2 frames) transient is rejected', () => {
    const vad = run([...runs([[Q, 10]]), C, C, ...runs([[Q, 10]])]);
    expect(vad.finish()).toEqual([]);
    expect(vad.rejectedSegments).toBe(1);
  });

  it('150 ms (3 frames) transient is rejected', () => {
    const vad = run([...runs([[Q, 10]]), C, C, C, ...runs([[Q, 10]])]);
    expect(vad.finish()).toEqual([]);
    expect(vad.rejectedSegments).toBe(1);
  });

  it('200 ms (4 frames) is accepted and its onset is backdated to the first candidate frame', () => {
    // frames 10..13 are candidates: provisional onset at frame 10 = 500 ms, accepted only at frame 13.
    const vad = run([...runs([[Q, 10]]), C, C, C, C, ...runs([[Q, 10]])]);
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      onsetFrame: 10,
      endFrame: 13,
      onset_ms: 500,
      end_ms: 700,
      candidateFrames: 4,
    });
    expect(segs[0]!.end_ms - segs[0]!.onset_ms).toBe(200);
  });

  it('a rejected transient does not extend or merge with a later accepted segment', () => {
    // 2 candidates, 6 quiet (ends the transient), then 5 candidates
    const vad = run([C, C, ...runs([[Q, 6]]), C, C, C, C, C, ...runs([[Q, 8]])]);
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.onsetFrame).toBe(8);
    expect(segs[0]!.candidateFrames).toBe(5);
    expect(vad.rejectedSegments).toBe(1);
  });
});

describe('hangover: gaps of 5 are bridged, the 6th non-candidate frame ends the segment', () => {
  it('a 5-frame gap (250 ms) is bridged into one segment', () => {
    // 4 candidates (0-3), 5 quiet (4-8), 2 candidates (9-10), then quiet
    const vad = run([C, C, C, C, ...runs([[Q, 5]]), C, C, ...runs([[Q, 10]])]);
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      onsetFrame: 0,
      endFrame: 10,
      onset_ms: 0,
      end_ms: 550, // end of frame 10 (the last candidate frame)
      candidateFrames: 6,
    });
  });

  it('a 6-frame gap (300 ms) ends the segment; the next burst is a separate segment', () => {
    // 4 candidates (0-3), 6 quiet (4-9), 4 candidates (10-13), then quiet
    const vad = run([C, C, C, C, ...runs([[Q, 6]]), C, C, C, C, ...runs([[Q, 10]])]);
    const segs = vad.finish();
    expect(segs.map((s) => [s.onset_ms, s.end_ms])).toEqual([
      [0, 200],
      [500, 700],
    ]);
  });

  it('the segment ends at the end of its last candidate frame, not after the hangover', () => {
    const vad = run([...runs([[Q, 2]]), C, C, C, C, ...runs([[Q, 30]])]);
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.onset_ms).toBe(100);
    expect(segs[0]!.end_ms).toBe(300); // 100 + 4*50, not 300 + 250 or 300 + 300
  });

  it('the live push of the 6th non-candidate frame closes the segment before finish()', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    [C, C, C, C, ...runs([[Q, 6]])].forEach((db, i) => vad.push(dbFrame(i, db)));
    // finish() must not report the segment as unterminated: it was closed by the gap.
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(vad.lastSegmentUnterminated).toBe(false);
  });

  it('5 trailing quiet frames leave the segment open until finish() (no offset yet)', () => {
    const vad = run([C, C, C, C, ...runs([[Q, 5]])]);
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.end_ms).toBe(200);
    expect(vad.lastSegmentUnterminated).toBe(true);
  });
});

describe('multiple segments and longest run', () => {
  it('reports segments in time order and the longest run', () => {
    // seg A: 4 candidates (0-3); gap 8; seg B: 10 candidates (12-21); gap 7; seg C: 6 candidates (29-34)
    const levels = [
      ...runs([[C, 4]]),
      ...runs([[Q, 8]]),
      ...runs([[C, 10]]),
      ...runs([[Q, 7]]),
      ...runs([[C, 6]]),
      ...runs([[Q, 10]]),
    ];
    const segs = run(levels).finish();
    expect(segs.map((s) => [s.onsetFrame, s.endFrame, s.candidateFrames])).toEqual([
      [0, 3, 4],
      [12, 21, 10],
      [29, 34, 6],
    ]);
    const spans = segs.map((s) => s.end_ms - s.onset_ms);
    expect(spans).toEqual([200, 500, 300]);
    expect(Math.max(...spans)).toBe(500);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('a segment still open when the stream ends is closed at its last candidate frame', () => {
    const vad = run(runs([[C, 10]]));
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.end_ms).toBe(500);
    expect(vad.lastSegmentUnterminated).toBe(true);
  });

  it('a still-open segment with fewer than 4 candidates is rejected at finish()', () => {
    const vad = run([...runs([[Q, 3]]), C, C, C]);
    expect(vad.finish()).toEqual([]);
    expect(vad.rejectedSegments).toBe(1);
    expect(vad.lastSegmentUnterminated).toBe(false);
  });

  it('finish() is idempotent and later pushes are ignored', () => {
    const vad = run(runs([[C, 4]]));
    const first = vad.finish();
    expect(vad.push(dbFrame(4, C)).candidate).toBe(false);
    expect(vad.finish()).toEqual(first);
  });
});

describe('non-finite frames and dropouts', () => {
  it('a single non-finite frame inside speech is a bridged gap, not a candidate', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    [dbFrame(0, C), dbFrame(1, C), nonfiniteFrame(2), dbFrame(3, C), dbFrame(4, C), dbFrame(5, C)].forEach((f) =>
      vad.push(f),
    );
    const segs = vad.finish();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.candidateFrames).toBe(5);
    expect(segs[0]!.end_ms).toBe(300);
  });

  it('six consecutive non-finite frames end the segment', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    [0, 1, 2, 3].forEach((i) => vad.push(dbFrame(i, C)));
    [4, 5, 6, 7, 8, 9].forEach((i) => vad.push(nonfiniteFrame(i)));
    [10, 11, 12, 13].forEach((i) => vad.push(dbFrame(i, C)));
    expect(vad.finish().map((s) => s.onsetFrame)).toEqual([0, 10]);
  });

  it('missing frames (an index jump) count as non-candidates: 2 missing is bridged, 6 is not', () => {
    const bridged = new VoiceActivityTracker(FLOOR);
    [0, 1, 2, 3].forEach((i) => bridged.push(dbFrame(i, C)));
    [6, 7].forEach((i) => bridged.push(dbFrame(i, C))); // frames 4 and 5 missing
    const segsA = bridged.finish();
    expect(segsA).toHaveLength(1);
    expect(segsA[0]!.candidateFrames).toBe(6);

    const split = new VoiceActivityTracker(FLOOR);
    [0, 1, 2, 3].forEach((i) => split.push(dbFrame(i, C)));
    [10, 11, 12, 13].forEach((i) => split.push(dbFrame(i, C))); // frames 4..9 missing = 6 frames
    expect(split.finish().map((s) => s.onsetFrame)).toEqual([0, 10]);
  });

  it('a duplicate or out-of-order frame is ignored', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    [0, 1, 2, 3].forEach((i) => vad.push(dbFrame(i, C)));
    expect(vad.push(dbFrame(2, Q)).candidate).toBe(false);
    expect(vad.push(dbFrame(3, Q)).candidate).toBe(false);
    vad.push(dbFrame(4, C));
    const segs = vad.finish();
    expect(segs[0]!.candidateFrames).toBe(5);
  });
});

describe('provisional candidate flag', () => {
  it('is true exactly on candidate frames, including the ones later rejected', () => {
    const vad = new VoiceActivityTracker(FLOOR);
    const flags = [Q, C, C, Q, Q, Q, Q, Q, Q].map((db, i) => vad.push(dbFrame(i, db)).candidate);
    expect(flags).toEqual([false, true, true, false, false, false, false, false, false]);
    expect(vad.finish()).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { WindowAccumulator } from '../src/window.js';
import type { WindowKind } from '../src/types.js';
import type { Frame } from '../src/frame.js';
import { dbFrame, nonfiniteFrame, runs } from './helpers.js';

/**
 * Session floor -60 dBFS; speech S = -45 (rel +15); silence Q = -62 (rel -2).
 * Phrase window max 8000 ms = 160 frames of 50 ms.
 */
const FLOOR = -60;
const S = -45;
const Q = -62;

function accumulator(kind: WindowKind, maxDurationMs: number): WindowAccumulator {
  return new WindowAccumulator({ kind, maxDurationMs, sessionFloorDbfs: FLOOR, sampleRate: 48000 });
}

function fill(
  acc: WindowAccumulator,
  levels: ReadonlyArray<number>,
  override: (index: number) => Frame | undefined = () => undefined,
): void {
  levels.forEach((db, i) => acc.push(override(i) ?? dbFrame(i, db)));
}

function phrase(levels: ReadonlyArray<number>, override?: (i: number) => Frame | undefined) {
  const acc = accumulator('phrase', 8000);
  fill(acc, levels, override);
  return acc;
}

const PHRASE_OK = runs([
  [Q, 10],
  [S, 20],
  [Q, 130],
]); // 160 frames

describe('valid phrase window', () => {
  it('summarizes a clean 1 s utterance', () => {
    const r = phrase(PHRASE_OK).finish('complete');
    expect(r).toEqual({
      kind: 'phrase',
      valid: true,
      invalid_reason: null,
      frame_count: 160,
      expected_frames: 160,
      coverage: 1,
      active_ms: 1000,
      longest_active_ms: 1000,
      segments: 1,
      onset_ms: 500,
      p50_active_dbfs: S,
      p95_active_dbfs: S,
      peak_dbfs: expect.closeTo(-45, 9),
      clipped_frames: 0,
      nonfinite_frames: 0,
      duration_ms: 8000,
    });
  });

  it('finish() is idempotent', () => {
    const acc = phrase(PHRASE_OK);
    const a = acc.finish('complete');
    const b = acc.finish('interrupted');
    expect(b).toEqual(a);
  });

  it('p50 and p95 are nearest-rank over the candidate frames of accepted segments; bridged gap frames are excluded (A1-07)', () => {
    // frames 5-8 at -45, frames 9-13 at -61 (5 bridged non-candidate frames), frames 14-19 at -40
    // active_ms spans the gap (onset 250 ms to the end of frame 19 = 1000 ms): 750 ms
    // candidate frames: 4 x -45 and 6 x -40 (n = 10): p50 = sorted[ceil(5)-1 = 4] = -40, p95 = sorted[9] = -40
    // (if the 5 gap frames at -61 were included, p50 would be -45)
    const levels = [...runs([[Q, 5], [-45, 4], [-61, 5], [-40, 6], [Q, 20]])];
    const r = phrase(levels).finish('complete');
    expect(r.segments).toBe(1);
    expect(r.active_ms).toBe(750);
    expect(r.onset_ms).toBe(250);
    expect(r.p50_active_dbfs).toBe(-40);
    expect(r.p95_active_dbfs).toBe(-40);
  });

  it('reports multiple segments: count, first onset, sum and longest', () => {
    const levels = runs([
      [Q, 4],
      [S, 4], // 200 ms at 200..399
      [Q, 8],
      [S, 10], // 500 ms
      [Q, 20],
    ]);
    const r = phrase(levels).finish('complete');
    expect(r.segments).toBe(2);
    expect(r.onset_ms).toBe(200);
    expect(r.active_ms).toBe(700);
    expect(r.longest_active_ms).toBe(500);
  });

  it('peak_dbfs is the largest sample over the whole window, including rejected transients', () => {
    const levels = runs([[Q, 10], [S, 20], [Q, 130]]);
    const r = phrase(levels, (i) => (i === 100 ? dbFrame(i, Q, { peak: 0.5 }) : undefined)).finish('complete');
    expect(r.peak_dbfs).toBe(-6); // 20*log10(0.5) = -6.0206 emitted to 0.1 dB
  });
});

describe('result quantisation (PK-06)', () => {
  it('p50, p95 and peak are emitted to 0.1 dB; coverage to 0.001; milliseconds as integers', () => {
    // 20 speech frames at -45.26 dBFS: p50 = p95 = -45.26 -> -45.3 ; peak 20*log10(10^(-45.26/20)) -> -45.3
    const r = phrase(runs([[Q, 10], [-45.26, 20], [Q, 130]])).finish('complete');
    expect(r.p50_active_dbfs).toBe(-45.3);
    expect(r.p95_active_dbfs).toBe(-45.3);
    expect(r.peak_dbfs).toBe(-45.3);
    for (const v of [r.active_ms, r.longest_active_ms, r.onset_ms, r.duration_ms]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(r.coverage).toBe(1);
  });

  it('a non-integer sample-rate frame time is rounded to whole milliseconds and never exceeds the duration', () => {
    // 22050 Hz: a 1103-sample frame is 50.02 ms long
    const acc = new WindowAccumulator({ kind: 'phrase', maxDurationMs: 8000, sessionFloorDbfs: FLOOR, sampleRate: 22050 });
    const len = (1103 * 1000) / 22050;
    for (let i = 0; i < 160; i++) {
      acc.push({ ...dbFrame(i, i < 2 ? Q : S), t_audio_ms: i * len, duration_ms: len });
    }
    const r = acc.finish('complete'); // activity runs to the end of the window
    for (const v of [r.active_ms, r.longest_active_ms, r.onset_ms, r.duration_ms]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(r.onset_ms).toBe(100); // 2 * 50.02 = 100.09 -> 100
    expect(r.active_ms).toBeLessThanOrEqual(r.duration_ms);
    expect(r.longest_active_ms).toBeLessThanOrEqual(r.active_ms);
  });

  it('an explicit duration shorter than the frames received is raised to the received audio time', () => {
    const r = phrase(runs([[Q, 10], [S, 20], [Q, 70]])).finish('early_stop', { durationMs: 1000 }); // 100 frames received
    expect(r.duration_ms).toBe(5000);
    expect(r.expected_frames).toBe(100);
    expect(r.frame_count).toBeLessThanOrEqual(r.expected_frames + 1);
  });
});

describe('active duration and no_voice', () => {
  it('silence only: no_voice, no segments, null statistics', () => {
    const r = phrase(runs([[Q, 160]])).finish('complete');
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('no_voice');
    expect(r.segments).toBe(0);
    expect(r.onset_ms).toBeNull();
    expect(r.p50_active_dbfs).toBeNull();
    expect(r.p95_active_dbfs).toBeNull();
    expect(r.active_ms).toBe(0);
  });

  it('a 100 ms and a 150 ms transient are no_voice (rejected by the VAD)', () => {
    for (const n of [2, 3]) {
      const r = phrase(runs([[Q, 10], [S, n], [Q, 148 - n]])).finish('complete');
      expect(r.invalid_reason).toBe('no_voice');
      expect(r.segments).toBe(0);
    }
  });

  it('calibration: 350 ms (7 frames) is accepted by the VAD but active_ms < 400 is no_voice', () => {
    const acc = accumulator('calibration', 8000);
    fill(acc, runs([[Q, 10], [S, 7], [Q, 143]]));
    const r = acc.finish('complete');
    expect(r.segments).toBe(1);
    expect(r.active_ms).toBe(350);
    expect(r.invalid_reason).toBe('no_voice');
  });

  it('phrase and vowel: no_voice means no accepted segment, so 350 ms and even 200 ms are valid (A1-04)', () => {
    for (const kind of ['phrase', 'vowel'] as const) {
      for (const frames of [7, 4]) {
        const acc = accumulator(kind, 8000);
        fill(acc, runs([[Q, 10], [S, frames], [Q, 150 - frames]]));
        const r = acc.finish('complete');
        expect(r.segments, `${kind} ${frames}`).toBe(1);
        expect(r.active_ms).toBe(frames * 50);
        expect(r.valid, `${kind} ${frames}`).toBe(true);
      }
    }
  });

  it('phrase and vowel: 150 ms (3 frames) is rejected by the VAD, so no_voice', () => {
    for (const kind of ['phrase', 'vowel'] as const) {
      const acc = accumulator(kind, 8000);
      fill(acc, runs([[Q, 10], [S, 3], [Q, 147]]));
      const r = acc.finish('complete');
      expect(r.invalid_reason).toBe('no_voice');
      expect(r.segments).toBe(0);
    }
  });

  it('calibration: 400 ms (8 frames) is valid', () => {
    const acc = accumulator('calibration', 8000);
    fill(acc, runs([[Q, 10], [S, 8], [Q, 142]]));
    const r = acc.finish('complete');
    expect(r.active_ms).toBe(400);
    expect(r.valid).toBe(true);
  });

  it('a loud room at +6 .. +9.9 dB never opens a segment: no_voice, whatever the kind', () => {
    for (const kind of ['calibration', 'phrase', 'vowel'] as const) {
      const acc = accumulator(kind, 8000);
      fill(acc, runs([[-52, 160]])); // +8 dB over the -60 floor
      const r = acc.finish('complete');
      expect(r.invalid_reason, kind).toBe('no_voice');
      expect(r.segments).toBe(0);
    }
  });

  it('vowel: one accepted segment (200 ms) is enough', () => {
    const acc = accumulator('vowel', 8000);
    fill(acc, runs([[Q, 10], [S, 4], [Q, 146]]));
    const r = acc.finish('complete');
    expect(r.valid).toBe(true);
    expect(r.active_ms).toBe(200);
    expect(r.longest_active_ms).toBe(200);
  });

  it('vowel with no accepted activity is no_voice', () => {
    const acc = accumulator('vowel', 8000);
    fill(acc, runs([[Q, 160]]));
    expect(acc.finish('complete').invalid_reason).toBe('no_voice');
  });
});

describe('coverage', () => {
  it('144 of 160 frames (0.90) is valid, 143 (0.89375) is low_coverage', () => {
    const ok = phrase(runs([[Q, 10], [S, 20], [Q, 114]])).finish('complete', { durationMs: 8000 });
    expect(ok.frame_count).toBe(144);
    expect(ok.coverage).toBe(0.9);
    expect(ok.valid).toBe(true);

    const bad = phrase(runs([[Q, 10], [S, 20], [Q, 113]])).finish('complete', { durationMs: 8000 });
    expect(bad.frame_count).toBe(143);
    expect(bad.coverage).toBe(0.894); // 143/160 = 0.89375, emitted to 0.001; the rule uses the exact 143/160
    expect(bad.invalid_reason).toBe('low_coverage');
  });

  it('dropped frames in the middle (an index jump) reduce coverage', () => {
    const acc = accumulator('phrase', 8000);
    // frames 0..79 present, 80..95 missing (16 frames), 96..159 present -> 144 frames
    for (let i = 0; i < 160; i++) {
      if (i >= 80 && i < 96) continue;
      acc.push(dbFrame(i, i >= 10 && i < 30 ? S : Q));
    }
    const r = acc.finish('complete');
    expect(r.frame_count).toBe(144);
    expect(r.expected_frames).toBe(160);
    expect(r.coverage).toBe(0.9);
    expect(r.valid).toBe(true);
    // one more missing frame
    const acc2 = accumulator('phrase', 8000);
    for (let i = 0; i < 160; i++) {
      if (i >= 80 && i < 97) continue;
      acc2.push(dbFrame(i, i >= 10 && i < 30 ? S : Q));
    }
    expect(acc2.finish('complete').invalid_reason).toBe('low_coverage');
  });

  it('duration defaults to the end of the last frame, so an early stop uses the shorter duration', () => {
    const r = phrase(runs([[Q, 10], [S, 20], [Q, 30]])).finish('early_stop'); // 60 frames
    expect(r.duration_ms).toBe(3000);
    expect(r.expected_frames).toBe(60);
    expect(r.coverage).toBe(1);
    expect(r.valid).toBe(true);
  });

  it('an explicit durationMs makes a tail dropout visible, and is capped at the maximum', () => {
    const r = phrase(runs([[Q, 10], [S, 20], [Q, 30]])).finish('early_stop', { durationMs: 5000 });
    expect(r.expected_frames).toBe(100);
    expect(r.coverage).toBe(0.6);
    expect(r.invalid_reason).toBe('low_coverage');
    const capped = phrase(PHRASE_OK).finish('complete', { durationMs: 99_999 });
    expect(capped.duration_ms).toBe(8000);
  });

  it('no frames at all: zero coverage, low_coverage', () => {
    const r = accumulator('phrase', 8000).finish('complete');
    expect(r.frame_count).toBe(0);
    expect(r.expected_frames).toBe(0);
    expect(r.coverage).toBe(0);
    expect(r.invalid_reason).toBe('low_coverage');
    expect(r.peak_dbfs).toBeNull();
  });
});

describe('clipping rule: more than 2 % of accepted-active frames', () => {
  const activeFifty = runs([[Q, 10], [S, 50], [Q, 100]]); // 50 active frames (frames 10..59)
  const clipAt = (indices: number[]) => (i: number) =>
    indices.includes(i) ? dbFrame(i, S, { clipped: true }) : undefined;

  it('1 clipped of 50 active (2.0 %) is valid; 2 of 50 (4.0 %) is clipped', () => {
    const ok = phrase(activeFifty, clipAt([20])).finish('complete');
    expect(ok.clipped_frames).toBe(1);
    expect(ok.valid).toBe(true);
    const bad = phrase(activeFifty, clipAt([20, 21])).finish('complete');
    expect(bad.clipped_frames).toBe(2);
    expect(bad.invalid_reason).toBe('clipped');
  });

  it('exactly 2 % of 200 active frames (4) is valid, 5 (2.5 %) is clipped', () => {
    const acc = (clipped: number) => {
      const w = accumulator('vowel', 12000);
      const levels = runs([[Q, 10], [S, 200], [Q, 30]]);
      fill(w, levels, (i) => (i >= 20 && i < 20 + clipped ? dbFrame(i, S, { clipped: true }) : undefined));
      return w.finish('complete');
    };
    expect(acc(4).valid).toBe(true);
    expect(acc(5).invalid_reason).toBe('clipped');
  });

  it('the clipped fraction uses candidate frames only: 1 clipped of 49 candidates (2.04 %) is invalid even though the span has 54 frames', () => {
    // 20 candidates, 5 bridged quiet frames, 29 candidates (one clipped), then silence
    const levels = runs([[Q, 10], [S, 20], [Q, 5], [S, 29], [Q, 96]]); // 160 frames
    const r = phrase(levels, (i) => (i === 40 ? dbFrame(i, S, { clipped: true }) : undefined)).finish('complete');
    expect(r.clipped_frames).toBe(1);
    expect(r.active_ms).toBe(2700); // the span: frames 10-63 = 54 frames
    expect(r.invalid_reason).toBe('clipped');
  });

  it('a clipped frame outside accepted activity is reported but does not invalidate', () => {
    const r = phrase(activeFifty, clipAt([100])).finish('complete');
    expect(r.clipped_frames).toBe(1);
    expect(r.valid).toBe(true);
  });

  it('a clipped frame inside a rejected transient contributes nothing', () => {
    const levels = runs([[Q, 10], [S, 3], [Q, 147]]);
    const r = phrase(levels, (i) => (i === 11 ? dbFrame(i, S, { clipped: true }) : undefined)).finish('complete');
    expect(r.clipped_frames).toBe(1);
    expect(r.invalid_reason).toBe('no_voice'); // the rejected transient is not activity
  });
});

describe('non-finite rule: more than 5 % of received frames', () => {
  const nf = (count: number) => (i: number) => (i >= 100 && i < 100 + count ? nonfiniteFrame(i) : undefined);

  it('8 of 160 (5.0 %) is valid, 9 (5.625 %) is nonfinite', () => {
    const ok = phrase(PHRASE_OK, nf(8)).finish('complete');
    expect(ok.nonfinite_frames).toBe(8);
    expect(ok.coverage).toBe(152 / 160);
    expect(ok.valid).toBe(true);
    const bad = phrase(PHRASE_OK, nf(9)).finish('complete');
    expect(bad.nonfinite_frames).toBe(9);
    expect(bad.invalid_reason).toBe('nonfinite');
  });

  it('non-finite frames are excluded from statistics and from active frames', () => {
    const levels = runs([[Q, 10], [S, 20], [Q, 130]]);
    const r = phrase(levels, (i) => (i === 15 ? nonfiniteFrame(i) : undefined)).finish('complete');
    expect(r.nonfinite_frames).toBe(1);
    expect(r.p50_active_dbfs).toBe(S);
    expect(r.valid).toBe(true);
  });
});

describe('continuous_sound (phrase only)', () => {
  it('speech from start to end of the window is continuous_sound for phrase', () => {
    const r = phrase(runs([[S, 160]])).finish('complete');
    expect(r.invalid_reason).toBe('continuous_sound');
    expect(r.active_ms).toBe(8000);
  });

  it('the same signal is valid for calibration and vowel', () => {
    for (const kind of ['calibration', 'vowel'] as const) {
      const acc = accumulator(kind, 8000);
      fill(acc, runs([[S, 160]]));
      expect(acc.finish('complete').valid).toBe(true);
    }
  });

  it('boundary: 95.0 % is valid, 97.5 % (no offset seen) is continuous_sound', () => {
    // 2000 ms window = 40 frames. 38 speech + 2 quiet = 1900 ms = exactly 95 %: not > 95 %.
    const acc38 = accumulator('phrase', 2000);
    fill(acc38, runs([[S, 38], [Q, 2]]));
    const r38 = acc38.finish('complete');
    expect(r38.active_ms).toBe(1900);
    expect(r38.valid).toBe(true);
    // 39 speech + 1 quiet = 1950 ms = 97.5 %, last gap only 1 frame, so no offset
    const acc39 = accumulator('phrase', 2000);
    fill(acc39, runs([[S, 39], [Q, 1]]));
    const r39 = acc39.finish('complete');
    expect(r39.active_ms).toBe(1950);
    expect(r39.invalid_reason).toBe('continuous_sound');
  });

  it('long activity that ENDS (a 6-frame offset gap was observed) is not continuous', () => {
    // 153 speech + 7 quiet: active 7650/8000 = 95.6 % but the segment was closed by an offset.
    const r = phrase(runs([[S, 153], [Q, 7]])).finish('complete');
    expect(r.active_ms).toBe(7650);
    expect(r.valid).toBe(true);
  });
});

describe('interrupted and reason priority', () => {
  it('an interrupted window is invalid even when everything else is clean', () => {
    const r = phrase(PHRASE_OK).finish('interrupted');
    expect(r.valid).toBe(false);
    expect(r.invalid_reason).toBe('interrupted');
    expect(r.p95_active_dbfs).toBe(S); // diagnostics are still filled in
  });

  it('low_coverage precedes clipped, clipped precedes nonfinite, nonfinite precedes no_voice', () => {
    // clipped + low coverage
    const lowAndClipped = phrase(runs([[Q, 10], [S, 20], [Q, 20]]), (i) =>
      i === 12 || i === 13 ? dbFrame(i, S, { clipped: true }) : undefined,
    ).finish('complete', { durationMs: 8000 });
    expect(lowAndClipped.invalid_reason).toBe('low_coverage');

    // clipped (2 of 20 active) + nonfinite (9 of 160)
    const clippedAndNf = phrase(PHRASE_OK, (i) => {
      if (i === 12 || i === 13) return dbFrame(i, S, { clipped: true });
      if (i >= 100 && i < 109) return nonfiniteFrame(i);
      return undefined;
    }).finish('complete');
    expect(clippedAndNf.invalid_reason).toBe('clipped');

    // nonfinite + no voice
    const nfNoVoice = phrase(runs([[Q, 160]]), (i) => (i < 9 ? nonfiniteFrame(i) : undefined)).finish('complete');
    expect(nfNoVoice.invalid_reason).toBe('nonfinite');
  });
});

describe('level frames for live display', () => {
  it('returns {frame_index, t_audio_ms, dbfs, active, clipped} per frame', () => {
    const acc = accumulator('phrase', 8000);
    expect(acc.push(dbFrame(0, Q))).toEqual({
      frame_index: 0,
      t_audio_ms: 0,
      dbfs: Q,
      active: false,
      clipped: false,
    });
    expect(acc.push(dbFrame(1, S, { clipped: true }))).toEqual({
      frame_index: 1,
      t_audio_ms: 50,
      dbfs: S,
      active: true,
      clipped: true,
    });
  });

  it('level values are quantised: dbfs to 0.1 dB, t_audio_ms to an integer', () => {
    const acc = accumulator('phrase', 8000);
    const level = acc.push({ ...dbFrame(3, -45.26), t_audio_ms: 149.6 });
    expect(level?.dbfs).toBe(-45.3);
    expect(level?.t_audio_ms).toBe(150);
    // an exact tie rounds toward +infinity, exactly like quantizeDb in @atr/protocol
    expect(acc.push({ ...dbFrame(4, -45.25), t_audio_ms: 200.4 })?.dbfs).toBe(-45.2);
    const zero = acc.push(dbFrame(5, -0.04));
    expect(zero?.dbfs).toBe(0);
    expect(Object.is(zero?.dbfs, -0)).toBe(false);
  });

  it('a non-finite frame is reported at the -140 floor, inactive and unclipped', () => {
    const acc = accumulator('phrase', 8000);
    expect(acc.push(nonfiniteFrame(0))).toEqual({
      frame_index: 0,
      t_audio_ms: 0,
      dbfs: -140,
      active: false,
      clipped: false,
    });
  });

  it('level dbfs values are within the protocol range -140..20', () => {
    const acc = accumulator('phrase', 8000);
    const lo = acc.push(dbFrame(0, -140));
    const hi = acc.push(dbFrame(1, 20));
    expect(lo?.dbfs).toBe(-140);
    expect(hi?.dbfs).toBe(20);
  });

  it('emission is bounded at 700 frames for a long window', () => {
    const acc = accumulator('vowel', 40_000); // 800 frames possible, capped at 700
    expect(acc.maxFrames).toBe(700);
    let emitted = 0;
    for (let i = 0; i < 1000; i++) if (acc.push(dbFrame(i, Q)) !== null) emitted++;
    expect(emitted).toBe(700);
    expect(acc.levelFramesEmitted).toBe(700);
    expect(acc.frameCount).toBe(700);
  });

  it('emission is bounded by the commanded maximum duration (phrase 8000 ms = 160 frames)', () => {
    const acc = accumulator('phrase', 8000);
    expect(acc.maxFrames).toBe(160);
    let emitted = 0;
    for (let i = 0; i < 400; i++) if (acc.push(dbFrame(i, Q)) !== null) emitted++;
    expect(emitted).toBe(160);
    const r = acc.finish('complete');
    expect(r.frame_count).toBe(160);
    expect(r.duration_ms).toBe(8000);
  });

  it('the vowel maximum of 30000 ms is 600 frames, within the 700 cap', () => {
    expect(accumulator('vowel', 30000).maxFrames).toBe(600);
  });

  it('duplicates, out-of-order frames and frames after finish() produce no level frame', () => {
    const acc = accumulator('phrase', 8000);
    expect(acc.push(dbFrame(0, Q))).not.toBeNull();
    expect(acc.push(dbFrame(2, Q))).not.toBeNull();
    expect(acc.push(dbFrame(2, Q))).toBeNull();
    expect(acc.push(dbFrame(1, Q))).toBeNull();
    expect(acc.push(dbFrame(-1, Q))).toBeNull();
    expect(acc.push(dbFrame(1.5, Q))).toBeNull();
    acc.finish('early_stop');
    expect(acc.push(dbFrame(3, Q))).toBeNull();
    expect(acc.finished).toBe(true);
  });
});

describe('constructor validation', () => {
  it('rejects a non-positive maximum duration', () => {
    expect(
      () => new WindowAccumulator({ kind: 'phrase', maxDurationMs: 0, sessionFloorDbfs: FLOOR, sampleRate: 48000 }),
    ).toThrow(RangeError);
  });
});

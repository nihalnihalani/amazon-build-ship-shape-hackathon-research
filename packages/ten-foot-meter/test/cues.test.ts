import { describe, expect, it } from 'vitest';
import { barHeights, glyph, levelCue, matrixRuns, toneShape } from '../src/index.js';
import type { ShapeKind, Tone } from '../src/index.js';

describe('toneShape: a distinct shape per tone', () => {
  it('maps every tone to a unique shape', () => {
    const tones: Tone[] = ['reached', 'below', 'not_scored', 'neutral'];
    const shapes = tones.map(toneShape);
    expect(shapes).toEqual(['check', 'ring', 'dash', 'dot']);
    expect(new Set(shapes).size).toBe(tones.length);
  });
});

describe('glyph path data (centre 100,100, size 40; M, L, A only)', () => {
  it('check mark', () => {
    expect(glyph('check', 100, 100, 40)).toEqual({ d: 'M 82 100 L 96 114 L 118 86', filled: false });
  });

  it('ring', () => {
    expect(glyph('ring', 100, 100, 40)).toEqual({
      d: 'M 80 100 A 20 20 0 1 0 120 100 A 20 20 0 1 0 80 100',
      filled: false,
    });
  });

  it('dash', () => {
    expect(glyph('dash', 100, 100, 40)).toEqual({ d: 'M 84 100 L 116 100', filled: false });
  });

  it('dot is the only filled glyph', () => {
    expect(glyph('dot', 100, 100, 40)).toEqual({
      d: 'M 88 100 A 12 12 0 1 0 112 100 A 12 12 0 1 0 88 100',
      filled: true,
    });
    const kinds: ShapeKind[] = ['check', 'ring', 'dash', 'dot'];
    expect(kinds.filter((k) => glyph(k, 0, 0, 10).filled)).toEqual(['dot']);
  });

  it('never uses a command other than M, L or A', () => {
    const kinds: ShapeKind[] = ['check', 'ring', 'dash', 'dot'];
    for (const k of kinds) {
      for (const letter of glyph(k, 33.3, 77.7, 41).d.match(/[A-Za-z]/g) ?? []) {
        expect(['M', 'L', 'A']).toContain(letter);
      }
    }
  });
});

describe('levelCue: text and shape always travel together', () => {
  it('waits when there is no level or no voice', () => {
    expect(levelCue(null, 12, true)).toEqual({ kind: 'waiting', shape: 'dash', text: 'Waiting for voice' });
    expect(levelCue(15, 12, false).kind).toBe('waiting');
    expect(levelCue(Number.NaN, 12, true).kind).toBe('waiting');
  });

  it('says the level is relative when no band exists yet', () => {
    const cue = levelCue(15, null, true);
    expect(cue.kind).toBe('no_band');
    expect(cue.text).toContain('Relative');
    expect(cue.shape).toBe('dot');
  });

  it('compares against the band edge inclusively', () => {
    expect(levelCue(12, 12, true)).toEqual({ kind: 'above_band', shape: 'check', text: 'Above band now' });
    expect(levelCue(12.01, 12, true).kind).toBe('above_band');
    expect(levelCue(11.99, 12, true)).toEqual({ kind: 'below_band', shape: 'ring', text: 'Below band now' });
  });

  it('every cue has non-empty text and a shape, and shapes differ across states', () => {
    const cues = [levelCue(null, null, false), levelCue(5, null, true), levelCue(5, 10, true), levelCue(15, 10, true)];
    for (const c of cues) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.shape.length).toBeGreaterThan(0);
    }
    expect(new Set(cues.map((c) => c.shape)).size).toBe(4);
  });
});

describe('barHeights', () => {
  it('scales fractions, keeps a stub for recorded zeros and marks missing days', () => {
    const bars = barHeights([1, 0.5, null, 0], 220);
    expect(bars).toEqual([
      { index: 0, missing: false, height: 220 },
      { index: 1, missing: false, height: 110 },
      { index: 2, missing: true, height: 0 },
      { index: 3, missing: false, height: 6 },
    ]);
  });

  it('clamps out-of-range fractions and treats non-finite as missing', () => {
    const bars = barHeights([2, -1, Number.NaN], 100);
    expect(bars[0]).toEqual({ index: 0, missing: false, height: 100 });
    expect(bars[1]).toEqual({ index: 1, missing: false, height: 6 });
    expect(bars[2]).toEqual({ index: 2, missing: true, height: 0 });
  });

  it('never makes a zero stub taller than the bar area', () => {
    expect(barHeights([0], 4)[0]?.height).toBe(4);
  });
});

describe('matrixRuns', () => {
  it('merges horizontal runs of dark modules', () => {
    const T = true;
    const F = false;
    expect(
      matrixRuns([
        [T, T, F, T],
        [F, F, F, F],
        [T, T, T, T],
      ]),
    ).toEqual([
      { x: 0, y: 0, w: 2 },
      { x: 3, y: 0, w: 1 },
      { x: 0, y: 2, w: 4 },
    ]);
  });

  it('handles empty input and ragged rows', () => {
    expect(matrixRuns([])).toEqual([]);
    expect(matrixRuns([[], [true]])).toEqual([{ x: 0, y: 1, w: 1 }]);
  });

  it('reconstructs the original matrix from the runs (round trip)', () => {
    const m = [
      [true, false, true, true, false],
      [false, true, true, false, true],
    ];
    const rebuilt = m.map((row) => row.map(() => false));
    for (const run of matrixRuns(m)) {
      for (let i = 0; i < run.w; i++) {
        const row = rebuilt[run.y];
        if (row) row[run.x + i] = true;
      }
    }
    expect(rebuilt).toEqual(m);
  });
});

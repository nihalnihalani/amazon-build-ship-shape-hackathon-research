/**
 * Non-colour cues. Colour never carries meaning alone: every state has a text label AND a shape.
 * Shapes are returned as SVG path data using only M, L and A commands.
 */

import { fmt } from './geometry.js';

/** Mirrors `ResultTone` in the session-core contract; duplicated so this package has no dependency. */
export type Tone = 'reached' | 'below' | 'not_scored' | 'neutral';

/** check = reached / above band, ring = below, dash = not scored / waiting, dot = neutral. */
export type ShapeKind = 'check' | 'ring' | 'dash' | 'dot';

export function toneShape(tone: Tone): ShapeKind {
  switch (tone) {
    case 'reached':
      return 'check';
    case 'below':
      return 'ring';
    case 'not_scored':
      return 'dash';
    case 'neutral':
      return 'dot';
  }
}

export interface Glyph {
  /** SVG path data (M, L, A only). */
  readonly d: string;
  /** True for the solid dot; every other glyph is a stroked outline. */
  readonly filled: boolean;
}

function circlePath(cx: number, cy: number, r: number): string {
  return (
    'M ' + fmt(cx - r) + ' ' + fmt(cy) +
    ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 1 0 ' + fmt(cx + r) + ' ' + fmt(cy) +
    ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 1 0 ' + fmt(cx - r) + ' ' + fmt(cy)
  );
}

/** Glyph for a shape, fitted in a square of side `size` centred on (cx, cy). */
export function glyph(kind: ShapeKind, cx: number, cy: number, size: number): Glyph {
  switch (kind) {
    case 'check':
      return {
        d:
          'M ' + fmt(cx - 0.45 * size) + ' ' + fmt(cy) +
          ' L ' + fmt(cx - 0.1 * size) + ' ' + fmt(cy + 0.35 * size) +
          ' L ' + fmt(cx + 0.45 * size) + ' ' + fmt(cy - 0.35 * size),
        filled: false,
      };
    case 'ring':
      return { d: circlePath(cx, cy, size / 2), filled: false };
    case 'dash':
      return {
        d: 'M ' + fmt(cx - 0.4 * size) + ' ' + fmt(cy) + ' L ' + fmt(cx + 0.4 * size) + ' ' + fmt(cy),
        filled: false,
      };
    case 'dot':
      return { d: circlePath(cx, cy, 0.3 * size), filled: true };
  }
}

export type LevelCueKind = 'waiting' | 'no_band' | 'below_band' | 'above_band';

export interface LevelCue {
  readonly kind: LevelCueKind;
  readonly shape: ShapeKind;
  /** Short text that always accompanies the shape. Says "relative" where a level is implied. */
  readonly text: string;
}

/**
 * Live cue under the arc. Display only: whether a phrase REACHED the far side is decided by the
 * session core from accepted voice segments and is shown from the result view, never from this.
 */
export function levelCue(levelRelDb: number | null, bandRelDb: number | null, active: boolean): LevelCue {
  if (levelRelDb === null || !Number.isFinite(levelRelDb) || !active) {
    return { kind: 'waiting', shape: 'dash', text: 'Waiting for voice' };
  }
  if (bandRelDb === null || !Number.isFinite(bandRelDb)) {
    return { kind: 'no_band', shape: 'dot', text: 'Relative level, no band set' };
  }
  if (levelRelDb >= bandRelDb) {
    return { kind: 'above_band', shape: 'check', text: 'Above band now' };
  }
  return { kind: 'below_band', shape: 'ring', text: 'Below band now' };
}

export interface BarGeometry {
  readonly index: number;
  /** True when there is no data for the day. Render the words "No session", never a zero bar. */
  readonly missing: boolean;
  /** Pixel height of the bar; 0 for missing days. */
  readonly height: number;
}

/**
 * Bar heights for a row of days from fractions in [0, 1] (null = no session). A recorded zero keeps
 * a small stub so it is visibly different from a missing day.
 */
export function barHeights(
  fractions: ReadonlyArray<number | null>,
  maxHeightPx: number,
  zeroStubPx = 6,
): BarGeometry[] {
  return fractions.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return { index, missing: true, height: 0 };
    }
    const f = value < 0 ? 0 : value > 1 ? 1 : value;
    const raw = f * maxHeightPx;
    return { index, missing: false, height: f === 0 ? Math.min(zeroStubPx, maxHeightPx) : raw };
  });
}

export interface ModuleRun {
  readonly x: number;
  readonly y: number;
  /** Run length in modules. */
  readonly w: number;
}

/**
 * Merge horizontal runs of dark modules of a QR matrix so the SVG needs far fewer Rect elements
 * than one per module. `matrix[row][col]` is true for a dark module.
 */
export function matrixRuns(matrix: ReadonlyArray<ReadonlyArray<boolean>>): ModuleRun[] {
  const runs: ModuleRun[] = [];
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y] ?? [];
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const dark = x < row.length && row[x] === true;
      if (dark && start < 0) {
        start = x;
      } else if (!dark && start >= 0) {
        runs.push({ x: start, y, w: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

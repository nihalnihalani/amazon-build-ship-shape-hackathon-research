import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METER_RANGE,
  arcPath,
  bandTick,
  fmt,
  fractionToAngleDeg,
  halfDial,
  levelArcPath,
  polarToPoint,
  relDbToAngleDeg,
  relDbToFraction,
  trackArcPath,
} from '../src/index.js';

// Dial used by every hand-computed expectation: centre (100, 100), radius 50, half circle.
const dial = halfDial(100, 100, 50);

describe('relDbToFraction (range -10..+30 dB relative to the session floor)', () => {
  it('maps the range ends and midpoints exactly', () => {
    expect(relDbToFraction(-10)).toBe(0);
    expect(relDbToFraction(0)).toBe(0.25);
    expect(relDbToFraction(10)).toBe(0.5);
    expect(relDbToFraction(20)).toBe(0.75);
    expect(relDbToFraction(30)).toBe(1);
  });

  it('clamps below and above the display range', () => {
    expect(relDbToFraction(-10.0001)).toBe(0);
    expect(relDbToFraction(-80)).toBe(0);
    expect(relDbToFraction(30.0001)).toBe(1);
    expect(relDbToFraction(200)).toBe(1);
  });

  it('maps non-finite input to 0 instead of throwing', () => {
    expect(relDbToFraction(Number.NaN)).toBe(0);
    expect(relDbToFraction(Number.POSITIVE_INFINITY)).toBe(0);
    expect(relDbToFraction(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('honours a custom range and rejects a degenerate one', () => {
    expect(relDbToFraction(5, { minRelDb: 0, maxRelDb: 20 })).toBe(0.25);
    expect(relDbToFraction(5, { minRelDb: 10, maxRelDb: 10 })).toBe(0);
    expect(relDbToFraction(5, { minRelDb: 20, maxRelDb: 0 })).toBe(0);
  });

  it('exposes the documented default range', () => {
    expect(DEFAULT_METER_RANGE).toEqual({ minRelDb: -10, maxRelDb: 30 });
  });
});

describe('angles on the half dial', () => {
  it('puts fraction 0 at 180 deg, 0.5 at 90 deg, 1 at 0 deg', () => {
    expect(fractionToAngleDeg(0, dial)).toBe(180);
    expect(fractionToAngleDeg(0.5, dial)).toBe(90);
    expect(fractionToAngleDeg(1, dial)).toBe(0);
  });

  it('maps relative levels to angles (hand computed: 180 - 180 * fraction)', () => {
    expect(relDbToAngleDeg(-10, dial)).toBe(180);
    expect(relDbToAngleDeg(0, dial)).toBe(135);
    expect(relDbToAngleDeg(10, dial)).toBe(90);
    expect(relDbToAngleDeg(20, dial)).toBe(45);
    expect(relDbToAngleDeg(30, dial)).toBe(0);
    expect(relDbToAngleDeg(99, dial)).toBe(0);
    expect(relDbToAngleDeg(-99, dial)).toBe(180);
  });

  it('clamps out-of-range fractions', () => {
    expect(fractionToAngleDeg(-1, dial)).toBe(180);
    expect(fractionToAngleDeg(2, dial)).toBe(0);
    expect(fractionToAngleDeg(Number.NaN, dial)).toBe(180);
  });
});

describe('polarToPoint (y-down screen coordinates)', () => {
  it('returns the left, top and right points of the dial', () => {
    const left = polarToPoint(100, 100, 50, 180);
    expect(left.x).toBeCloseTo(50, 9);
    expect(left.y).toBeCloseTo(100, 9);
    const top = polarToPoint(100, 100, 50, 90);
    expect(top.x).toBeCloseTo(100, 9);
    expect(top.y).toBeCloseTo(50, 9);
    const right = polarToPoint(100, 100, 50, 0);
    expect(right.x).toBeCloseTo(150, 9);
    expect(right.y).toBeCloseTo(100, 9);
  });

  it('returns the 45 deg point with y above the centre', () => {
    const p = polarToPoint(100, 100, 50, 45);
    expect(p.x).toBeCloseTo(100 + 50 * Math.SQRT1_2, 9);
    expect(p.y).toBeCloseTo(100 - 50 * Math.SQRT1_2, 9);
  });
});

describe('arc path data (M and A only)', () => {
  it('draws the whole track left to right over the top', () => {
    expect(trackArcPath(dial)).toBe('M 50 100 A 50 50 0 0 1 150 100');
  });

  it('draws the left half and the right half of the track', () => {
    expect(arcPath(dial, 0, 0.5)).toBe('M 50 100 A 50 50 0 0 1 100 50');
    expect(arcPath(dial, 0.5, 1)).toBe('M 100 50 A 50 50 0 0 1 150 100');
  });

  it('draws the level fill from the floor to the level', () => {
    expect(levelArcPath(dial, 10)).toBe('M 50 100 A 50 50 0 0 1 100 50'); // +10 dB = 90 deg
    expect(levelArcPath(dial, 30)).toBe('M 50 100 A 50 50 0 0 1 150 100');
    expect(levelArcPath(dial, 90)).toBe('M 50 100 A 50 50 0 0 1 150 100'); // clamped
  });

  it('returns an empty string when there is nothing to draw', () => {
    expect(arcPath(dial, 0.3, 0.3)).toBe('');
    expect(levelArcPath(dial, -10)).toBe('');
    expect(levelArcPath(dial, -50)).toBe('');
    expect(levelArcPath(dial, Number.NaN)).toBe('');
  });

  it('sets the large-arc flag past 180 degrees (270 deg dial from 225 to -45)', () => {
    const wide = { cx: 100, cy: 100, r: 50, startDeg: 225, endDeg: -45 };
    // 225 deg: (100 - 35.355, 100 + 35.355); -45 deg: (100 + 35.355, 100 + 35.355)
    expect(trackArcPath(wide)).toBe('M 64.645 135.355 A 50 50 0 1 1 135.355 135.355');
    // Half of the sweep is exactly 135 deg: large-arc flag 0, ends at 90 deg (top).
    expect(arcPath(wide, 0, 0.5)).toBe('M 64.645 135.355 A 50 50 0 0 1 100 50');
  });

  it('sets sweep-flag 0 for a counter-clockwise dial', () => {
    const ccw = { cx: 100, cy: 100, r: 50, startDeg: 0, endDeg: 180 };
    expect(trackArcPath(ccw)).toBe('M 150 100 A 50 50 0 0 0 50 100');
  });

  it('never emits NaN, exponent notation, negative zero or commands other than M and A', () => {
    for (let db = -40; db <= 60; db += 0.37) {
      const d = levelArcPath(dial, db);
      expect(d).not.toMatch(/NaN|Infinity|e[+-]?\d|-0(?![.\d])/);
      const letters = d.match(/[A-Za-z]/g) ?? [];
      for (const l of letters) expect(['M', 'A']).toContain(l);
    }
  });
});

describe('band tick', () => {
  it('returns null before calibration (no band known)', () => {
    expect(bandTick(dial, null, 40, 60)).toBeNull();
    expect(bandTick(dial, Number.NaN, 40, 60)).toBeNull();
  });

  it('places the tick on the radius between inner and outer (band +10 dB = 90 deg)', () => {
    const tick = bandTick(dial, 10, 40, 60);
    expect(tick).not.toBeNull();
    expect(tick?.angleDeg).toBe(90);
    expect(tick?.fraction).toBe(0.5);
    expect(tick?.offScale).toBeNull();
    expect(tick?.d).toBe('M 100 60 L 100 40');
  });

  it('places ticks at the dial ends', () => {
    expect(bandTick(dial, 30, 40, 60)?.d).toBe('M 140 100 L 160 100');
    expect(bandTick(dial, -10, 40, 60)?.d).toBe('M 60 100 L 40 100');
  });

  it('pins an off-scale band to the nearest end and says so', () => {
    const above = bandTick(dial, 45, 40, 60);
    expect(above?.offScale).toBe('above');
    expect(above?.fraction).toBe(1);
    const below = bandTick(dial, -15, 40, 60);
    expect(below?.offScale).toBe('below');
    expect(below?.fraction).toBe(0);
  });

  it('uses only M and L commands', () => {
    const d = bandTick(dial, 4.2, 40, 60)?.d ?? '';
    const letters = d.match(/[A-Za-z]/g) ?? [];
    expect(letters.sort()).toEqual(['L', 'M']);
  });
});

describe('fmt', () => {
  it('rounds to 3 decimals and never prints negative zero or exponents', () => {
    expect(fmt(1.23456)).toBe('1.235');
    expect(fmt(-0)).toBe('0');
    expect(fmt(1e-9)).toBe('0');
    expect(fmt(-1e-9)).toBe('0');
    expect(fmt(6.1e-17)).toBe('0');
    expect(fmt(150)).toBe('150');
    expect(fmt(Number.NaN)).toBe('0');
  });
});

/**
 * Ten-foot relative-level meter geometry. Pure functions, zero dependencies, Hermes-safe
 * (no Intl, no BigInt, no regex look-behind, no optional native APIs).
 *
 * Angle convention (used everywhere in this file):
 *   - degrees, mathematical orientation: 0 deg points right (3 o'clock), 90 deg points up
 *     (12 o'clock), 180 deg points left (9 o'clock); angles grow counter-clockwise;
 *   - screen coordinates are y-down, so a point at angle a on radius r around (cx, cy) is
 *     (cx + r cos a, cy - r sin a).
 *
 * The default dial is a half circle that starts at 180 deg (left), goes over the top and ends at
 * 0 deg (right). It is therefore drawn clockwise on screen, which is SVG sweep-flag 1.
 *
 * Only SVG path commands M, A and L are produced: the Vega SVG port excludes Polyline, Polygon,
 * markers and patterns, and these commands are the minimum a gauge needs.
 *
 * Everything here is DISPLAY geometry. The levels are relative to the session floor, are never
 * calibrated sound pressure, and are never used for scoring (scoring lives in session-core).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Display range in dB relative to the session floor that maps onto the whole dial. */
export interface MeterRange {
  readonly minRelDb: number;
  readonly maxRelDb: number;
}

export const DEFAULT_METER_RANGE: MeterRange = Object.freeze({ minRelDb: -10, maxRelDb: 30 });

/** Dial placement. `startDeg` is where fraction 0 sits, `endDeg` where fraction 1 sits. */
export interface ArcSpec {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly startDeg: number;
  readonly endDeg: number;
}

export const HALF_DIAL_START_DEG = 180;
export const HALF_DIAL_END_DEG = 0;

/** Largest absolute sweep drawn; a full 360 deg arc has identical end points and cannot be expressed. */
const MAX_SWEEP_DEG = 359;
/** Sweeps smaller than this are treated as "nothing to draw". */
const MIN_SWEEP_DEG = 1e-6;

export function halfDial(cx: number, cy: number, r: number): ArcSpec {
  return { cx, cy, r, startDeg: HALF_DIAL_START_DEG, endDeg: HALF_DIAL_END_DEG };
}

export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Fixed-precision number text for path data: 3 decimals, never "-0", never exponent form. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * Relative level (dB above the session floor) to dial fraction in [0, 1], clamped.
 * Non-finite input maps to 0 so a bad sample never throws in a render path.
 */
export function relDbToFraction(relDb: number, range: MeterRange = DEFAULT_METER_RANGE): number {
  if (!Number.isFinite(relDb)) return 0;
  const span = range.maxRelDb - range.minRelDb;
  if (!(span > 0)) return 0;
  return clamp((relDb - range.minRelDb) / span, 0, 1);
}

export function fractionToAngleDeg(fraction: number, arc: ArcSpec): number {
  const f = Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
  const sweep = clamp(arc.endDeg - arc.startDeg, -MAX_SWEEP_DEG, MAX_SWEEP_DEG);
  return arc.startDeg + sweep * f;
}

export function relDbToAngleDeg(
  relDb: number,
  arc: ArcSpec,
  range: MeterRange = DEFAULT_METER_RANGE,
): number {
  return fractionToAngleDeg(relDbToFraction(relDb, range), arc);
}

export function polarToPoint(cx: number, cy: number, r: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/**
 * Path data for the part of the dial between two fractions, using only M and A.
 * Returns an empty string when there is nothing to draw (equal fractions), so callers can skip
 * the element instead of painting a stray dot at the floor.
 */
export function arcPath(arc: ArcSpec, fromFraction: number, toFraction: number): string {
  const a0 = fractionToAngleDeg(fromFraction, arc);
  const a1 = fractionToAngleDeg(toFraction, arc);
  const sweep = a1 - a0;
  if (Math.abs(sweep) < MIN_SWEEP_DEG) return '';
  const p0 = polarToPoint(arc.cx, arc.cy, arc.r, a0);
  const p1 = polarToPoint(arc.cx, arc.cy, arc.r, a1);
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  // Decreasing mathematical angle is clockwise on a y-down screen, which is sweep-flag 1.
  const sweepFlag = sweep < 0 ? 1 : 0;
  const r = fmt(arc.r);
  return (
    'M ' + fmt(p0.x) + ' ' + fmt(p0.y) +
    ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' ' + sweepFlag + ' ' + fmt(p1.x) + ' ' + fmt(p1.y)
  );
}

/** The full background track of the dial. */
export function trackArcPath(arc: ArcSpec): string {
  return arcPath(arc, 0, 1);
}

/** The filled part of the dial for a relative level. Empty string at or below the display floor. */
export function levelArcPath(
  arc: ArcSpec,
  levelRelDb: number,
  range: MeterRange = DEFAULT_METER_RANGE,
): string {
  return arcPath(arc, 0, relDbToFraction(levelRelDb, range));
}

export interface BandTick {
  readonly fraction: number;
  readonly angleDeg: number;
  /** Set when the band sits outside the display range and the tick is pinned to the nearest end. */
  readonly offScale: 'below' | 'above' | null;
  readonly inner: Point;
  readonly outer: Point;
  /** Path data `M x y L x y` between the inner and outer radius. */
  readonly d: string;
}

/**
 * Position of today's band edge on the dial. Null when the band is not known yet (before
 * calibration) so the caller renders no tick at all rather than a misleading one.
 */
export function bandTick(
  arc: ArcSpec,
  bandRelDb: number | null,
  innerR: number,
  outerR: number,
  range: MeterRange = DEFAULT_METER_RANGE,
): BandTick | null {
  if (bandRelDb === null || !Number.isFinite(bandRelDb)) return null;
  const fraction = relDbToFraction(bandRelDb, range);
  const angleDeg = fractionToAngleDeg(fraction, arc);
  const inner = polarToPoint(arc.cx, arc.cy, innerR, angleDeg);
  const outer = polarToPoint(arc.cx, arc.cy, outerR, angleDeg);
  let offScale: BandTick['offScale'] = null;
  if (bandRelDb < range.minRelDb) offScale = 'below';
  else if (bandRelDb > range.maxRelDb) offScale = 'above';
  return {
    fraction,
    angleDeg,
    offScale,
    inner,
    outer,
    d: 'M ' + fmt(inner.x) + ' ' + fmt(inner.y) + ' L ' + fmt(outer.x) + ' ' + fmt(outer.y),
  };
}

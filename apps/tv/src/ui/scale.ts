import { useMemo } from 'react';
import { useScalingMultiplier } from '@amazon-devices/kepler-a11y-settings-interface-turbo';

/**
 * UI-scale binding. Every size in the app is a base value (1920 x 1080 canvas at scale 1.0) passed through
 * one of these functions so the system UI-scale setting enlarges the whole layout.
 *
 * The installed package (1.0.0) exports useScaledSize and useScalingMultiplier; the multiplier form is the
 * documented way to scale many values at the same rate, so three multipliers are read once per render:
 *   text()  items of type "text"            (font sizes and line heights)
 *   size()  items of type "medium_upscale"  (controls, graphics, bars)
 *   space() items of type "low_downscale"   (padding and gaps shrink at higher scales)
 */
export interface UiScale {
  /** The text multiplier (1 = default). Layout code uses it only to choose a denser arrangement at large scales. */
  readonly factor: number;
  /** Scaled text size. `max` (px) caps display-size text (counters, the code) so it cannot outgrow the screen. */
  text(base: number, max?: number): number;
  /** Scaled graphic size. `max` (px) caps large graphics (dial, QR) at high scales. */
  size(base: number, max?: number): number;
  space(base: number): number;
}

const REF_TEXT = 40;
const REF_SIZE = 100;
const REF_SPACE = 24;

/** A missing, zero, negative or non-finite multiplier means "unscaled", never a collapsed layout. */
export function sanitizeMultiplier(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function capped(value: number, max: number | undefined): number {
  return max === undefined ? value : Math.min(value, Math.max(max, 0));
}

export function makeUiScale(text: number, size: number, space: number): UiScale {
  return {
    factor: text,
    text: (base, max) => capped(Math.round(base * text), max),
    size: (base, max) => capped(Math.round(base * size), max),
    space: (base) => Math.round(base * space),
  };
}

export function useUiScale(): UiScale {
  const text = sanitizeMultiplier(useScalingMultiplier(REF_TEXT, { itemType: 'text' }));
  const size = sanitizeMultiplier(useScalingMultiplier(REF_SIZE, { itemType: 'medium_upscale' }));
  const space = sanitizeMultiplier(useScalingMultiplier(REF_SPACE, { itemType: 'low_downscale' }));
  return useMemo(() => makeUiScale(text, size, space), [text, size, space]);
}

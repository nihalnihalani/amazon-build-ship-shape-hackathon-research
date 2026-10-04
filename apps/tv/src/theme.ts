/**
 * Visual constants. Base sizes are for a 1920 x 1080 canvas at UI scale 1.0 and always pass through the
 * UI-scale hook (see ui/scale.ts) before use. Colours are decoration: no state is ever carried by colour
 * alone (every state also has text and, where useful, a shape).
 */

export const colors = {
  background: '#0B1220',
  surface: '#16233A',
  surfaceFocused: '#274470',
  text: '#FFFFFF',
  textMuted: '#C9D3E3',
  focusRing: '#FFD60A',
  reached: '#3DDC84',
  below: '#FFB020',
  neutral: '#A9B4C8',
  danger: '#FF8A8A',
  arcTrack: '#6B7C9E',
  arcFill: '#FFD60A',
  bandTick: '#FFFFFF',
  qrDark: '#000000',
  qrLight: '#FFFFFF',
} as const;

/** Base type sizes (px at scale 1.0). Body minimum is 32; the footer is the single 28 px exception. */
export const type = {
  footer: 28,
  body: 32,
  label: 40,
  title: 56,
  promptMin: 72,
  prompt: 96,
  counter: 160,
} as const;

/** Phrase sizes tried in order for the two-line auto-shrink (design brief: 72 to 96 px). */
export const PHRASE_FONT_SIZES: readonly number[] = [96, 88, 80, 72];

export const layout = {
  pagePadding: 80,
  pageVerticalPadding: 48,
  focusRing: 6,
  focusScale: 1.05,
  /** Full-size dial (the component default; no screen uses it once body text, banner and controls share the screen). */
  arcRadius: 300,
  /** Dial for the sustained sound, calibration and quiet check screens, which carry body text, a banner and controls. */
  arcRadiusMedium: 240,
  /** Compact dial used on the phrase card so phrase, dial and timer fit one 1080 px screen. */
  arcRadiusCompact: 180,
  arcStroke: 36,
  qrSize: 320,
  historyBarMax: 220,
} as const;

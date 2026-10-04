import { colors, type, PHRASE_FONT_SIZES } from '../theme';
import { makeUiScale, sanitizeMultiplier } from '../ui/scale';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.1 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast (WCAG 2.1 SC 1.4.3: at least 4.5:1 for text and the arc fill)', () => {
  it('computes known reference ratios', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it.each(['text', 'textMuted', 'focusRing', 'reached', 'below', 'neutral', 'danger', 'arcFill', 'bandTick'] as const)(
    '%s on the background is at least 4.5:1',
    (name) => {
      expect(contrast(colors[name], colors.background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('text on the control surfaces is at least 4.5:1, including the focused surface', () => {
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.text, colors.surfaceFocused)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('the arc track (a graphical object) is at least 3:1 and the QR is black on white', () => {
    expect(contrast(colors.arcTrack, colors.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.qrDark, colors.qrLight)).toBeCloseTo(21, 5);
  });

  it('the focus ring stands out from the focused and unfocused control surface', () => {
    expect(contrast(colors.focusRing, colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.focusRing, colors.surfaceFocused)).toBeGreaterThanOrEqual(3);
  });
});

describe('type scale (design brief)', () => {
  it('keeps body at 32, labels at 40, prompts 72 to 96, counters 160 and the footer 28', () => {
    expect(type.body).toBe(32);
    expect(type.label).toBe(40);
    expect(type.counter).toBe(160);
    expect(type.footer).toBe(28);
    expect(Math.min(...PHRASE_FONT_SIZES)).toBe(72);
    expect(Math.max(...PHRASE_FONT_SIZES)).toBe(96);
  });
});

describe('UI scale binding', () => {
  it('rejects unusable multipliers', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '2']) {
      expect(sanitizeMultiplier(bad)).toBe(1);
    }
    expect(sanitizeMultiplier(1.5)).toBe(1.5);
  });

  it('scales text, sizes and spacing independently and rounds to whole pixels', () => {
    const scale = makeUiScale(1.5, 1.25, 0.8);
    expect(scale.text(32)).toBe(48);
    expect(scale.size(100)).toBe(125);
    expect(scale.space(24)).toBe(19); // 19.2
    expect(scale.text(33)).toBe(50); // 49.5 rounds up
  });
});

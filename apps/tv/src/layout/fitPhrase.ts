import { PHRASE_FONT_SIZES } from '../theme';

/** Average glyph advance as a fraction of the font size for a proportional sans-serif (deliberately generous). */
export const AVERAGE_CHAR_WIDTH_EM = 0.58;

/**
 * Estimated line count for greedy word wrapping of `text` at `fontPx` inside `widthPx`.
 * A word longer than a line is broken across lines.
 */
export function estimateLines(text: string, fontPx: number, widthPx: number): number {
  const charsPerLine = Math.max(1, Math.floor(widthPx / (fontPx * AVERAGE_CHAR_WIDTH_EM)));
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0; // characters already on the current line
  for (const word of words) {
    const length = word.length;
    if (length <= charsPerLine) {
      if (used === 0) {
        used = length;
      } else if (used + 1 + length <= charsPerLine) {
        used += 1 + length;
      } else {
        lines += 1;
        used = length;
      }
    } else {
      // A word longer than a line starts on a fresh line and is broken across lines.
      if (used > 0) {
        lines += 1;
        used = 0;
      }
      const fullLines = Math.floor(length / charsPerLine);
      const rest = length % charsPerLine;
      lines += fullLines - 1 + (rest > 0 ? 1 : 0);
      used = rest > 0 ? rest : charsPerLine;
    }
  }
  return lines;
}

export interface FittedPhrase {
  /** Base font size (px at UI scale 1.0) to pass through the scale hook. */
  baseSize: number;
  lines: number;
  /** False only when even the smallest size needs more than two lines (the text is still shown in full). */
  fitsTwoLines: boolean;
}

/**
 * Picks the largest phrase size (96, 88, 80, 72) that fits in two lines. `textScale` is the current UI text
 * multiplier, so the fit accounts for the enlarged glyphs. Text is never truncated: if nothing fits in two
 * lines the smallest size is used and `fitsTwoLines` is false.
 */
export function fitPhrase(
  text: string,
  widthPx: number,
  textScale: number,
  sizes: readonly number[] = PHRASE_FONT_SIZES,
): FittedPhrase {
  let lastLines = 1;
  for (const baseSize of sizes) {
    lastLines = estimateLines(text, baseSize * textScale, widthPx);
    if (lastLines <= 2) return { baseSize, lines: lastLines, fitsTwoLines: true };
  }
  const smallest = sizes[sizes.length - 1] ?? 72;
  return { baseSize: smallest, lines: lastLines, fitsTwoLines: false };
}

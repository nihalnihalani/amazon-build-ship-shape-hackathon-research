/**
 * User-text rules from PROTOCOL.md section 1: NFC-normalize, trim, then count Unicode
 * code points. Control characters (U+0000-U+001F, U+007F-U+009F) and unpaired
 * surrogates are rejected. Text is always rendered literally (textContent only).
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function normalizeText(raw: string): string {
  return raw.normalize('NFC').trim();
}

export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) {
    void _;
    n += 1;
  }
  return n;
}

/** True when the (already normalized) text contains characters that must not be sent. */
export function hasForbiddenCharacters(text: string): boolean {
  return CONTROL_CHARS.test(text) || LONE_SURROGATE.test(text);
}

export type TextProblem = 'empty' | 'too_long' | 'invalid_characters';

export interface TextCheck {
  ok: boolean;
  /** NFC + trim of the input (what would be sent when ok). */
  text: string;
  length: number;
  problem: TextProblem | null;
}

export function checkText(raw: string, maxCodePoints: number): TextCheck {
  const text = normalizeText(raw);
  const length = codePointLength(text);
  if (hasForbiddenCharacters(text)) return { ok: false, text, length, problem: 'invalid_characters' };
  if (length === 0) return { ok: false, text, length, problem: 'empty' };
  if (length > maxCodePoints) return { ok: false, text, length, problem: 'too_long' };
  return { ok: true, text, length, problem: null };
}

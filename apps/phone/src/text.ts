/**
 * User-text checks for the phone UI. The rules themselves (NFC + trim, code point counting,
 * control characters, lone surrogates, per-field lengths) come from `@atr/protocol` through the
 * wire port; this file only classifies the outcome for plain-language messages.
 *
 * The package validators REJECT text that is not already normalized, so every value sent on the
 * wire is the `text` returned here (= normalizeUserText(input)). Text is always rendered
 * literally (textContent only).
 */

import { codePointLength, normalizeUserText } from './ports/wire.js';
import type { PackageTextCheck } from './ports/wire.js';

export { codePointLength, normalizeUserText };

export type TextProblem = 'empty' | 'too_long' | 'invalid_characters';

export interface TextCheck {
  ok: boolean;
  /** NFC + trim of the input: exactly what is sent when ok. */
  text: string;
  length: number;
  problem: TextProblem | null;
}

/** Normalizes `raw`, then validates it with one of the package validators (phrase, cue, device label). */
export function checkText(raw: string, validate: (value: unknown) => PackageTextCheck): TextCheck {
  const text = normalizeUserText(raw);
  const length = codePointLength(text);
  const result = validate(text);
  if (result.ok) return { ok: true, text, length, problem: null };
  const problem: TextProblem =
    result.reason === 'too_short' ? 'empty' : result.reason === 'too_long' ? 'too_long' : 'invalid_characters';
  return { ok: false, text, length, problem };
}

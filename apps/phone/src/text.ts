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
import type { PackageTextCheck, TextRejection } from './ports/wire.js';

export { codePointLength, normalizeUserText };

export type TextProblem =
  | 'empty'
  | 'too_long'
  | 'invalid_characters'
  /** Text-direction controls, line/paragraph separators, invisible operators, noncharacters. */
  | 'unsafe_character'
  /** Only whitespace or invisible filler characters: blank to the eye. */
  | 'invisible'
  /** More than four combining marks in a row. */
  | 'combining_run';

export interface TextCheck {
  ok: boolean;
  /** NFC + trim of the input: exactly what is sent when ok. */
  text: string;
  length: number;
  problem: TextProblem | null;
}

/** Normalizes `raw`, then validates it with one of the package validators (phrase, cue, device label). */
function problemFor(reason: TextRejection): TextProblem {
  switch (reason) {
    case 'too_short':
      return 'empty';
    case 'too_long':
      return 'too_long';
    case 'forbidden_char':
      return 'unsafe_character';
    case 'no_visible_content':
      return 'invisible';
    case 'combining_run':
      return 'combining_run';
    default:
      return 'invalid_characters';
  }
}

export function checkText(raw: string, validate: (value: unknown) => PackageTextCheck): TextCheck {
  const text = normalizeUserText(raw);
  const length = codePointLength(text);
  const result = validate(text);
  if (result.ok) return { ok: true, text, length, problem: null };
  return { ok: false, text, length, problem: problemFor(result.reason) };
}

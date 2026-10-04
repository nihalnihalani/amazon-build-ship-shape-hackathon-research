/**
 * Text rules: normalization, code point counting, control characters and the
 * strict validators for user text (phrase, cue, device label).
 *
 * Strict rule: a validator REJECTS text that is not already normalized. The
 * sender must transmit `normalizeUserText(input)`; the receiver never "fixes"
 * text. That keeps validation deterministic across runtimes and guarantees that
 * the relay, the TV and the phone all count the same code points.
 *
 * No Node-only APIs. Works in Node 22+, browsers and Hermes (see README for the
 * unverified String.prototype.normalize note on Hermes).
 */

import {
  COMBINING_RUN_MAX,
  CUE_LENGTH_MAX,
  CUE_LENGTH_MIN,
  DEVICE_LABEL_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MIN,
  PHRASE_LENGTH_MAX,
  PHRASE_LENGTH_MIN,
} from './constants.js';

/** NFC-normalize then trim. This is the only text transformation the protocol defines. */
export function normalizeUserText(input: string): string {
  const normalize = (String.prototype as { normalize?: (form?: string) => string }).normalize;
  const nfc = typeof normalize === 'function' ? normalize.call(input, 'NFC') : input;
  return nfc.trim();
}

/** Number of Unicode code points (a surrogate pair counts once; a lone surrogate counts once). */
export function codePointLength(input: string): number {
  let count = 0;
  const n = input.length;
  for (let i = 0; i < n; i += 1) {
    const c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = input.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

/** True when the string contains U+0000-U+001F or U+007F-U+009F. */
export function containsControlChars(input: string): boolean {
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** True when the string contains an unpaired UTF-16 surrogate (not encodable as UTF-8). */
export function hasLoneSurrogate(input: string): boolean {
  const n = input.length;
  for (let i = 0; i < n; i += 1) {
    const c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < n ? input.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** Length in bytes of the UTF-8 encoding (lone surrogates encode as U+FFFD, 3 bytes, like TextEncoder). */
export function utf8ByteLength(input: string): number {
  let bytes = 0;
  const n = input.length;
  for (let i = 0; i < n; i += 1) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes += 1;
    } else if (c < 0x800) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = input.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Display safety (revision 4, PK-03). Reference: docs/security/probes/text_policy_sketch.mjs.
// Patterns are built from strings with doubled backslashes: no look-behind, no \p{...} property
// escapes and no `u` flag, so the rule also runs on Hermes. This file stays pure ASCII.
// ---------------------------------------------------------------------------

/**
 * Characters that must not appear in phrases, cues, device labels or app_version:
 * U+2028/2029 line and paragraph separators, U+202A-202E embeddings and overrides,
 * U+2066-2069 isolates, U+2060-2064 invisible operators, U+FEFF, U+FFF9-FFFF (specials,
 * noncharacters, the replacement character), U+FDD0-FDEF, tag characters U+E0000-E007F
 * and the plane-end noncharacters U+xFFFE/U+xFFFF of planes 1 to 16.
 */
const FORBIDDEN_CHARS = new RegExp(
  '[\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFF\\uFDD0-\\uFDEF]' +
    '|\\uDB40[\\uDC00-\\uDC7F]' +
    '|[\\uD83F\\uD87F\\uD8BF\\uD8FF\\uD93F\\uD97F\\uD9BF\\uD9FF\\uDA3F\\uDA7F\\uDABF\\uDAFF\\uDB3F\\uDB7F\\uDBBF\\uDBFF][\\uDFFE\\uDFFF]',
);

/** A string made only of whitespace and invisible fillers renders as blank. */
const INVISIBLE_ONLY = new RegExp(
  '^[\\s\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E\\u200B-\\u200F\\u2800\\u3164\\uFE00-\\uFE0F\\uFFA0]*$',
);

/** More than four consecutive combining marks stack off the line box on a TV. */
const COMBINING_RUN = new RegExp(
  '[\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u0610-\\u061A\\u064B-\\u065F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F]{' +
    String(COMBINING_RUN_MAX + 1) +
    ',}',
);

export type DisplayVerdict = 'ok' | 'forbidden_char' | 'no_visible_content' | 'combining_run';

/**
 * Display-safety verdict for text shown on a TV or phone. Rejects bidi controls
 * (U+202A-202E, U+2066-2069), line and paragraph separators, invisible operators,
 * tag characters, noncharacters, strings that are blank to the eye and runs of more
 * than four combining marks. Keeps NFC text, ZWJ (U+200D), ZWNJ (U+200C), LRM, RLM
 * and ALM (U+200E, U+200F, U+061C), soft hyphen inside words, emoji sequences and
 * variation selectors. An empty string is reported `no_visible_content`; callers check
 * length first.
 */
export function displaySafe(s: string): DisplayVerdict {
  if (FORBIDDEN_CHARS.test(s)) return 'forbidden_char';
  if (INVISIBLE_ONLY.test(s)) return 'no_visible_content';
  if (COMBINING_RUN.test(s)) return 'combining_run';
  return 'ok';
}

export type TextRejection =
  | 'not_string'
  | 'lone_surrogate'
  | 'control_chars'
  | 'not_normalized'
  | 'too_short'
  | 'too_long'
  | 'forbidden_char'
  | 'no_visible_content'
  | 'combining_run';

export type TextCheck = { ok: true } | { ok: false; reason: TextRejection };

/**
 * Validate user text. Order: type, lone surrogate, control characters,
 * normalization (must equal NFC + trim of itself), length in code points, then
 * display safety (`displaySafe`, revision 4).
 */
export function validateUserText(value: unknown, min: number, max: number): TextCheck {
  if (typeof value !== 'string') return { ok: false, reason: 'not_string' };
  if (hasLoneSurrogate(value)) return { ok: false, reason: 'lone_surrogate' };
  if (containsControlChars(value)) return { ok: false, reason: 'control_chars' };
  if (normalizeUserText(value) !== value) return { ok: false, reason: 'not_normalized' };
  const length = codePointLength(value);
  if (length < min) return { ok: false, reason: 'too_short' };
  if (length > max) return { ok: false, reason: 'too_long' };
  const display = displaySafe(value);
  if (display !== 'ok') return { ok: false, reason: display };
  return { ok: true };
}

/** Phrase: 1..60 code points, already normalized. */
export function validatePhrase(value: unknown): TextCheck {
  return validateUserText(value, PHRASE_LENGTH_MIN, PHRASE_LENGTH_MAX);
}

/** Cue word: 1..12 code points, already normalized. */
export function validateCue(value: unknown): TextCheck {
  return validateUserText(value, CUE_LENGTH_MIN, CUE_LENGTH_MAX);
}

/** Phone device label: 1..24 code points, already normalized. */
export function validateDeviceLabel(value: unknown): TextCheck {
  return validateUserText(value, DEVICE_LABEL_LENGTH_MIN, DEVICE_LABEL_LENGTH_MAX);
}

/**
 * Sender helper: normalize then validate. Returns the normalized text to send,
 * or the rejection reason (for example an empty field after trimming).
 */
export function prepareUserText(
  value: string,
  min: number,
  max: number,
): { ok: true; text: string } | { ok: false; reason: TextRejection } {
  const text = normalizeUserText(value);
  const check = validateUserText(text, min, max);
  return check.ok ? { ok: true, text } : check;
}

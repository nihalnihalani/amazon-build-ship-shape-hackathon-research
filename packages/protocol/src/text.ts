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

export type TextRejection =
  | 'not_string'
  | 'lone_surrogate'
  | 'control_chars'
  | 'not_normalized'
  | 'too_short'
  | 'too_long';

export type TextCheck = { ok: true } | { ok: false; reason: TextRejection };

/**
 * Validate user text. Order: type, lone surrogate, control characters,
 * normalization (must equal NFC + trim of itself), then length in code points.
 */
export function validateUserText(value: unknown, min: number, max: number): TextCheck {
  if (typeof value !== 'string') return { ok: false, reason: 'not_string' };
  if (hasLoneSurrogate(value)) return { ok: false, reason: 'lone_surrogate' };
  if (containsControlChars(value)) return { ok: false, reason: 'control_chars' };
  if (normalizeUserText(value) !== value) return { ok: false, reason: 'not_normalized' };
  const length = codePointLength(value);
  if (length < min) return { ok: false, reason: 'too_short' };
  if (length > max) return { ok: false, reason: 'too_long' };
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

import {
  CUE_MAX_CODEPOINTS,
  MAX_PHRASES,
  MAX_PHRASE_CODEPOINTS,
  MIN_PHRASES,
} from './constants.js';

/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** NFC-normalize (when the runtime supports it) and trim. */
export function normalizeText(value: string): string {
  const nfc = typeof value.normalize === 'function' ? value.normalize('NFC') : value;
  return nfc.trim();
}

/** Length in Unicode code points. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) {
    void _;
    count += 1;
  }
  return count;
}

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/** Returns the normalized text when it is 1..maxCodePoints and has no control characters, else null. */
export function validateText(value: unknown, maxCodePoints: number): string | null {
  if (typeof value !== 'string') return null;
  const text = normalizeText(value);
  const length = codePointLength(text);
  if (length < 1 || length > maxCodePoints) return null;
  if (hasControlChars(text)) return null;
  return text;
}

export function validatePhrase(value: unknown): string | null {
  return validateText(value, MAX_PHRASE_CODEPOINTS);
}

export function validateCue(value: unknown): string | null {
  return validateText(value, CUE_MAX_CODEPOINTS);
}

export type PhraseBankResult = { ok: true; phrases: string[] } | { ok: false; reason: string };

/** Household bank: 1-10 items, each 1-60 code points after NFC + trim. Text is kept literally. */
export function validatePhraseBank(value: unknown): PhraseBankResult {
  if (!Array.isArray(value)) return { ok: false, reason: 'not_a_list' };
  if (value.length < MIN_PHRASES) return { ok: false, reason: 'too_few' };
  if (value.length > MAX_PHRASES) return { ok: false, reason: 'too_many' };
  const out: string[] = [];
  for (const item of value) {
    const phrase = validatePhrase(item);
    if (phrase === null) return { ok: false, reason: 'invalid_phrase' };
    out.push(phrase);
  }
  return { ok: true, phrases: out };
}

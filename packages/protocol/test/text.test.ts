import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  containsControlChars,
  hasLoneSurrogate,
  normalizeUserText,
  prepareUserText,
  validateCue,
  validateDeviceLabel,
  validatePhrase,
  validateUserText,
} from '../src/index.js';
import { fixtureOf } from './fixtures.js';
import { OPTS, expectFail, expectOk, patched } from './helpers.js';

const COMPOSED = 'é'; // e acute, one code point
const DECOMPOSED = 'é'; // e + combining acute, two code points

describe('normalizeUserText', () => {
  it('composes decomposed text (NFC)', () => {
    expect(normalizeUserText(DECOMPOSED)).toBe(COMPOSED);
    expect(normalizeUserText(DECOMPOSED).length).toBe(1);
    expect(normalizeUserText(`caf${DECOMPOSED}`)).toBe(`caf${COMPOSED}`);
  });
  it('leaves composed text unchanged', () => {
    expect(normalizeUserText(COMPOSED)).toBe(COMPOSED);
  });
  it('trims ASCII and Unicode whitespace', () => {
    expect(normalizeUserText('  hello  ')).toBe('hello');
    expect(normalizeUserText('\t\nhello\r\n')).toBe('hello');
    expect(normalizeUserText(' hello ')).toBe('hello');
    expect(normalizeUserText(' hello ')).toBe('hello');
  });
  it('keeps interior spaces', () => {
    expect(normalizeUserText(' a  b ')).toBe('a  b');
  });
  it('is idempotent', () => {
    for (const s of ['  é ', 'plain', 'ẛ̣', 'Å', 'Å', ' ́x']) {
      expect(normalizeUserText(normalizeUserText(s))).toBe(normalizeUserText(s));
    }
  });
});

describe('codePointLength', () => {
  it('counts ASCII, BMP and astral characters once', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength(COMPOSED)).toBe(1);
    expect(codePointLength(DECOMPOSED)).toBe(2);
    expect(codePointLength('\u{1F600}')).toBe(1);
    expect(codePointLength('\u{1F600}\u{1F600}')).toBe(2);
    expect(codePointLength('a\u{1F600}b')).toBe(3);
  });
  it('counts ZWJ emoji sequences by code points (not graphemes)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // man ZWJ woman ZWJ girl
    expect(codePointLength(family)).toBe(5);
  });
  it('counts a lone surrogate as one', () => {
    expect(codePointLength('\ud800')).toBe(1);
    expect(codePointLength('\ud800a')).toBe(2);
    expect(codePointLength('\ude00')).toBe(1);
  });
  it('agrees with Array.from on valid text', () => {
    for (const s of ['x', 'é\u{1F600}z', '\u{10FFFF}', 'á\u{1F1EE}\u{1F1F3}']) {
      expect(codePointLength(s)).toBe(Array.from(s).length);
    }
  });
});

describe('containsControlChars', () => {
  it('rejects U+0000 to U+001F and U+007F to U+009F', () => {
    for (let c = 0; c <= 0x1f; c += 1) expect(containsControlChars(`a${String.fromCharCode(c)}b`), `U+${c.toString(16)}`).toBe(true);
    for (let c = 0x7f; c <= 0x9f; c += 1) expect(containsControlChars(`a${String.fromCharCode(c)}b`), `U+${c.toString(16)}`).toBe(true);
  });
  it('allows the neighbours and ordinary text', () => {
    expect(containsControlChars(' ')).toBe(false); // U+0020
    expect(containsControlChars(' ')).toBe(false); // U+00A0
    expect(containsControlChars(' ÿĀ')).toBe(false);
    expect(containsControlChars('hello こんにちは \u{1F600}')).toBe(false);
    expect(containsControlChars('')).toBe(false);
  });
});

describe('hasLoneSurrogate', () => {
  it('detects unpaired surrogates only', () => {
    expect(hasLoneSurrogate('\ud800')).toBe(true);
    expect(hasLoneSurrogate('\udc00')).toBe(true);
    expect(hasLoneSurrogate('a\ud800b')).toBe(true);
    expect(hasLoneSurrogate('\ud800\ud800')).toBe(true);
    expect(hasLoneSurrogate('\udc00\ud800')).toBe(true);
    expect(hasLoneSurrogate('\u{1F600}')).toBe(false);
    expect(hasLoneSurrogate('plain')).toBe(false);
  });
});

describe('validateUserText: strict, already-normalized rule', () => {
  it('rejects decomposed text even when it would normalize to a valid phrase', () => {
    expect(validatePhrase(DECOMPOSED)).toEqual({ ok: false, reason: 'not_normalized' });
    expect(validatePhrase(COMPOSED)).toEqual({ ok: true });
  });
  it('rejects leading and trailing spaces (the sender must trim)', () => {
    expect(validatePhrase(' hello')).toEqual({ ok: false, reason: 'not_normalized' });
    expect(validatePhrase('hello ')).toEqual({ ok: false, reason: 'not_normalized' });
    expect(validatePhrase(' hello')).toEqual({ ok: false, reason: 'not_normalized' });
    expect(validatePhrase(normalizeUserText(' hello '))).toEqual({ ok: true });
  });
  it('rejects control characters including tab and newline', () => {
    for (const bad of ['a\tb', 'a\nb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a\u009fb', '\u0000', 'hi\r']) {
      expect(validatePhrase(bad), JSON.stringify(bad)).toEqual({ ok: false, reason: 'control_chars' });
    }
  });
  it('rejects lone surrogates', () => {
    expect(validatePhrase('a\ud800')).toEqual({ ok: false, reason: 'lone_surrogate' });
  });
  it('rejects non-strings', () => {
    for (const v of [undefined, null, 1, true, {}, [], ['a']]) {
      expect(validatePhrase(v)).toEqual({ ok: false, reason: 'not_string' });
    }
  });
  it('enforces code point lengths', () => {
    expect(validatePhrase('')).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePhrase('a')).toEqual({ ok: true });
    expect(validatePhrase('a'.repeat(60))).toEqual({ ok: true });
    expect(validatePhrase('a'.repeat(61))).toEqual({ ok: false, reason: 'too_long' });
    // emoji count as one code point each although they take two UTF-16 units
    expect(validatePhrase('\u{1F600}'.repeat(60))).toEqual({ ok: true });
    expect(validatePhrase('\u{1F600}'.repeat(61))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateCue('x'.repeat(12))).toEqual({ ok: true });
    expect(validateCue('x'.repeat(13))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateCue('')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateDeviceLabel('x'.repeat(24))).toEqual({ ok: true });
    expect(validateDeviceLabel('x'.repeat(25))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateDeviceLabel('')).toEqual({ ok: false, reason: 'too_short' });
  });
  it('counts decomposed text by code points once it is normalized', () => {
    const decomposed = DECOMPOSED.repeat(31); // 62 code points, 31 once normalized
    expect(codePointLength(decomposed)).toBe(62);
    expect(validatePhrase(decomposed).ok).toBe(false);
    expect(validatePhrase(normalizeUserText(decomposed))).toEqual({ ok: true });
  });
  it('accepts multilingual and emoji text', () => {
    for (const ok of ['こんにちは', 'नमस्ते', 'مرحبا', 'café \u{1F600}']) {
      expect(validatePhrase(ok), ok).toEqual({ ok: true });
    }
  });
  it('validateUserText supports custom ranges', () => {
    expect(validateUserText('abc', 3, 3)).toEqual({ ok: true });
    expect(validateUserText('abc', 4, 5)).toEqual({ ok: false, reason: 'too_short' });
  });
  it('prepareUserText normalizes for senders', () => {
    expect(prepareUserText(`  ${DECOMPOSED}  `, 1, 60)).toEqual({ ok: true, text: COMPOSED });
    expect(prepareUserText('   ', 1, 60)).toEqual({ ok: false, reason: 'too_short' });
    expect(prepareUserText('a\nb', 1, 60)).toEqual({ ok: false, reason: 'control_chars' });
  });
});

describe('text rules on the wire', () => {
  it('phrases.update rejects decomposed, padded and control-character phrases', () => {
    const base = fixtureOf('phrases.update');
    expectOk(patched(base, 'payload.phrases.0', COMPOSED));
    expectFail(patched(base, 'payload.phrases.0', DECOMPOSED), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', ' padded'), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', 'padded '), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', 'tab\there'), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', 'nul\u0000here'), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', 'c1\u0085here'), 'bad_schema');
    expectFail(patched(base, 'payload.phrases.0', 'lone\ud800'), 'bad_schema');
  });
  it('JSON escapes are decoded before validation', () => {
    const text = JSON.stringify(fixtureOf('cue')).replace('"slower"', '"slow\\u0000er"');
    const r = Object.assign({}, JSON.parse(text));
    expectFail(r, 'bad_schema');
  });
  it('cue and device_label follow the same strict rule', () => {
    expectFail(patched(fixtureOf('cue'), 'payload.text', DECOMPOSED), 'bad_schema');
    expectFail(patched(fixtureOf('join.request'), 'payload.device_label', ' Phone'), 'bad_schema');
    expectOk(patched(fixtureOf('join.request'), 'payload.device_label', COMPOSED));
  });
  it('error and ack details reject control characters but are not user text', () => {
    expectFail(patched(fixtureOf('error'), 'payload.detail', 'a\u0007'), 'bad_schema');
    expectOk(patched(fixtureOf('error'), 'payload.detail', ' padded detail '));
    expectOk(patched(fixtureOf('ack from tv'), 'payload.detail', 'x'));
  });
  it('error detail counts code points (64 emoji pass, 65 fail)', () => {
    expectOk(patched(fixtureOf('error'), 'payload.detail', '\u{1F600}'.repeat(64)));
    expectFail(patched(fixtureOf('error'), 'payload.detail', '\u{1F600}'.repeat(65)), 'bad_schema');
  });
  it('uses the shared options', () => {
    expect(OPTS.now).toBeGreaterThan(0);
  });
});

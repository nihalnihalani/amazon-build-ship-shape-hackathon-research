import { describe, expect, it } from 'vitest';
import { validateCue, validateDeviceLabel, validatePhrases } from '../src/phrases.js';
import { checkText, codePointLength, normalizeText } from '../src/text.js';

describe('text rules (PROTOCOL.md section 1)', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('😀')).toBe(1);
    expect('😀'.length).toBe(2);
    expect(codePointLength('😀'.repeat(60))).toBe(60);
  });

  it('NFC-normalizes before counting', () => {
    const decomposed = 'é'; // 2 code points
    expect(codePointLength(decomposed)).toBe(2);
    expect(normalizeText(decomposed)).toBe('é');
    expect(codePointLength(normalizeText(decomposed))).toBe(1);
  });

  it('trims before checking', () => {
    expect(checkText('  hi  ', 5).text).toBe('hi');
    expect(checkText('   ', 5).problem).toBe('empty');
  });
});

describe('validatePhrases', () => {
  const p60 = 'a'.repeat(60);

  it('accepts exactly 60 code points and rejects 61', () => {
    expect(validatePhrases([p60]).ok).toBe(true);
    const bad = validatePhrases(['a'.repeat(61)]);
    expect(bad.ok).toBe(false);
    expect(bad.issues).toEqual([
      { index: 0, problem: 'too_long', message: 'Phrase 1 is 61 characters; the limit is 60.' },
    ]);
  });

  it('counts emoji as one character each (61 emoji is too long, 60 is fine)', () => {
    expect(validatePhrases(['😀'.repeat(60)]).ok).toBe(true);
    expect(validatePhrases(['😀'.repeat(61)]).ok).toBe(false);
  });

  it('measures the length AFTER NFC, so 60 decomposed letters fit', () => {
    const decomposed = 'é'.repeat(60); // 120 code points before NFC, 60 after
    const v = validatePhrases([decomposed]);
    expect(v.ok).toBe(true);
    expect(v.phrases[0]).toBe('é'.repeat(60));
  });

  it('allows 1 to 10 phrases, rejects 0 and 11', () => {
    expect(validatePhrases(['a']).ok).toBe(true);
    expect(validatePhrases(Array.from({ length: 10 }, (_, i) => `p${i}`)).ok).toBe(true);
    const none = validatePhrases([]);
    expect(none.ok).toBe(false);
    expect(none.listMessage).toBe('Add at least 1 phrase.');
    const eleven = validatePhrases(Array.from({ length: 11 }, (_, i) => `p${i}`));
    expect(eleven.ok).toBe(false);
    expect(eleven.listMessage).toBe('Use at most 10 phrases; you have 11.');
  });

  it('rejects empty and whitespace-only phrases with their row number', () => {
    const v = validatePhrases(['ok', '   ', 'ok']);
    expect(v.ok).toBe(false);
    expect(v.issues).toEqual([{ index: 1, problem: 'empty', message: 'Phrase 2 is empty. Type a phrase or remove it.' }]);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['tab inside', 'a\tb'],
    ['newline inside', 'a\nb'],
    ['DEL', 'a\u007fb'],
    ['NEL (C1)', 'a\u0085b'],
    ['last C1 control', 'a\u009fb'],
    ['unit separator', 'a\u001fb'],
  ])('rejects control character: %s', (_name, text) => {
    const v = validatePhrases([text]);
    expect(v.ok).toBe(false);
    expect(v.issues[0]?.problem).toBe('invalid_characters');
  });

  it('does not reject non-control characters next to the control ranges', () => {
    expect(validatePhrases(['a b', 'a¡b', 'a b']).ok).toBe(true); // NBSP, inverted !, space
  });

  it('rejects unpaired surrogates', () => {
    expect(validatePhrases(['a\ud800b']).ok).toBe(false);
    expect(validatePhrases(['a\udc00b']).ok).toBe(false);
  });

  it('trims and normalizes the phrases it returns', () => {
    const v = validatePhrases(['  hello  ', 'é']);
    expect(v.phrases).toEqual(['hello', 'é']);
  });

  it('keeps markup-looking text unchanged (it is literal)', () => {
    const t = '<img src=x onerror=alert(1)>';
    const v = validatePhrases([t]);
    expect(v.ok).toBe(true);
    expect(v.phrases[0]).toBe(t);
  });
});

describe('cue word', () => {
  it('accepts 1-12 code points and rejects 13 or empty', () => {
    expect(validateCue('V').ok).toBe(true);
    expect(validateCue('a'.repeat(12)).ok).toBe(true);
    expect(validateCue('a'.repeat(13))).toMatchObject({ ok: false, message: 'The cue word is 13 characters; the limit is 12.' });
    expect(validateCue('  ').ok).toBe(false);
  });
  it('NFC + trim, control characters rejected', () => {
    expect(validateCue('  Volume ').text).toBe('Volume');
    expect(validateCue('a\u0007b').ok).toBe(false);
    expect(validateCue('é'.repeat(12)).ok).toBe(true);
  });
});

describe('device label', () => {
  it('1-24 code points', () => {
    expect(validateDeviceLabel('Android Chrome').ok).toBe(true);
    expect(validateDeviceLabel('a'.repeat(24)).ok).toBe(true);
    expect(validateDeviceLabel('a'.repeat(25)).ok).toBe(false);
    expect(validateDeviceLabel('').ok).toBe(false);
  });
});

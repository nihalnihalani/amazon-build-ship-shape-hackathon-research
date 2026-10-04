/**
 * Revision 4 display-safety rule (PK-03). The first block ports the 30 self-check cases of
 * docs/security/probes/text_policy_sketch.mjs; the rest checks the rule on the wire for
 * phrases, cue, device_label and app_version.
 */

import { describe, expect, it } from 'vitest';
import { displaySafe, validateCue, validateDeviceLabel, validatePhrase, validateUserText } from '../src/index.js';
import type { DisplayVerdict } from '../src/index.js';
import { fixtureOf } from './fixtures.js';
import { codeOf, patchedMany } from './helpers.js';

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const sketchCases: Array<[string, string, DisplayVerdict]> = [
  ['plain', 'Hello there', 'ok'],
  ['RLO U+202E', 'abc' + cp(0x202e) + 'def', 'forbidden_char'],
  ['LRE U+202A', 'a' + cp(0x202a) + 'b', 'forbidden_char'],
  ['RLI U+2067', 'a' + cp(0x2067) + 'b', 'forbidden_char'],
  ['PDI U+2069', 'a' + cp(0x2069) + 'b', 'forbidden_char'],
  ['LINE SEP U+2028', 'a' + cp(0x2028) + 'b', 'forbidden_char'],
  ['PARA SEP U+2029', 'a' + cp(0x2029) + 'b', 'forbidden_char'],
  ['BOM U+FEFF', 'a' + cp(0xfeff) + 'b', 'forbidden_char'],
  ['WORD JOINER U+2060', 'a' + cp(0x2060) + 'b', 'forbidden_char'],
  ['TAG A U+E0041', 'a' + cp(0xe0041) + 'b', 'forbidden_char'],
  ['noncharacter U+FFFE', 'a' + cp(0xfffe) + 'b', 'forbidden_char'],
  ['noncharacter U+FDD0', 'a' + cp(0xfdd0) + 'b', 'forbidden_char'],
  ['noncharacter U+1FFFE', 'a' + cp(0x1fffe) + 'b', 'forbidden_char'],
  ['3 x ZWSP', cp(0x200b, 0x200b, 0x200b), 'no_visible_content'],
  ['HANGUL FILLER U+3164', cp(0x3164), 'no_visible_content'],
  ['BRAILLE BLANK U+2800', cp(0x2800), 'no_visible_content'],
  ['combining stack x59', 'x' + cp(0x301).repeat(59), 'combining_run'],
  ['LRM allowed', 'abc' + cp(0x200e) + 'def', 'ok'],
  ['RLM allowed', 'abc' + cp(0x200f) + 'def', 'ok'],
  ['ALM allowed', 'abc' + cp(0x61c) + 'def', 'ok'],
  ['Persian with ZWNJ', cp(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645), 'ok'],
  ['Devanagari with ZWJ', cp(0x915, 0x94d, 0x200d, 0x937), 'ok'],
  ['Arabic', cp(0x645, 0x631, 0x62d, 0x628, 0x627, 0x20, 0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645), 'ok'],
  ['Hebrew', cp(0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x20, 0x5e2, 0x5d5, 0x5dc, 0x5dd), 'ok'],
  ['Hindi', cp(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947), 'ok'],
  ['Thai', cp(0xe2a, 0xe27, 0xe31, 0xe2a, 0xe14, 0xe35), 'ok'],
  ['emoji ZWJ sequence', cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), 'ok'],
  ['heart + VS16', cp(0x2764, 0xfe0f), 'ok'],
  ['four stacked marks', 'x' + cp(0x301, 0x302, 0x303, 0x304), 'ok'],
  ['soft hyphen inside word', 'co' + cp(0xad) + 'operate', 'ok'],
];

describe('displaySafe: the security reviewer sketch cases', () => {
  it('ports 30 cases', () => {
    expect(sketchCases.length).toBe(30);
  });
  for (const [name, text, expected] of sketchCases) {
    it(`${name} -> ${expected}`, () => {
      expect(displaySafe(text)).toBe(expected);
    });
  }
});

describe('displaySafe: character classes', () => {
  it('rejects every bidi control (U+202A-202E, U+2066-2069)', () => {
    for (const c of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(displaySafe(`ab${cp(c)}cd`), c.toString(16)).toBe('forbidden_char');
    }
  });
  it('rejects the invisible operators U+2060-2064, separators, BOM and specials', () => {
    for (const c of [0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2028, 0x2029, 0xfeff, 0xfff9, 0xfffa, 0xfffb, 0xfffc, 0xfffd, 0xfffe, 0xffff]) {
      expect(displaySafe(`ab${cp(c)}cd`), c.toString(16)).toBe('forbidden_char');
    }
  });
  it('rejects noncharacters U+FDD0-FDEF and the end of every plane, and tag characters', () => {
    for (const c of [0xfdd0, 0xfdd5, 0xfdef, 0x1fffe, 0x1ffff, 0x2fffe, 0x3ffff, 0x10fffe, 0x10ffff, 0xe0000, 0xe0001, 0xe0041, 0xe007f]) {
      expect(displaySafe(`ab${cp(c)}cd`), c.toString(16)).toBe('forbidden_char');
    }
  });
  it('keeps neighbours of the forbidden ranges', () => {
    for (const c of [0x2027, 0x202f, 0x2065, 0x206a, 0xfdcf, 0xfdf0, 0xfffd - 5, 0xe0080, 0xe000, 0x1fffd, 0x10fffd]) {
      // U+FFF8 is unassigned but not in the forbidden ranges; the rest are assigned or private use
      expect(displaySafe(`ab${cp(c)}cd`), c.toString(16)).toBe('ok');
    }
  });
  it('keeps ZWJ, ZWNJ, LRM, RLM and ALM inside text', () => {
    for (const c of [0x200c, 0x200d, 0x200e, 0x200f, 0x61c]) {
      expect(displaySafe(`ab${cp(c)}cd`), c.toString(16)).toBe('ok');
    }
  });
  it('reports strings that are blank to the eye', () => {
    for (const s of [cp(0x200b), cp(0x200c), cp(0x200d), cp(0x200e), cp(0xad), cp(0x34f), cp(0xfe0f), cp(0x3164), cp(0x2800), cp(0xffa0), cp(0x115f, 0x1160), cp(0x180e)]) {
      expect(displaySafe(s), JSON.stringify(s)).toBe('no_visible_content');
    }
    expect(displaySafe('')).toBe('no_visible_content'); // documented: callers check length first
    expect(displaySafe('a' + cp(0x200b))).toBe('ok'); // visible content present
  });
  it('limits combining runs to four marks', () => {
    expect(displaySafe('x' + cp(0x301).repeat(4))).toBe('ok');
    expect(displaySafe('x' + cp(0x301).repeat(5))).toBe('combining_run');
    expect(displaySafe('x' + cp(0x301, 0x302, 0x303, 0x304, 0x305))).toBe('combining_run');
    expect(displaySafe('x' + cp(0x301).repeat(4) + 'y' + cp(0x301).repeat(4))).toBe('ok'); // two separate runs of four
    expect(displaySafe('x' + cp(0x64b).repeat(5))).toBe('combining_run'); // Arabic marks
    expect(displaySafe('x' + cp(0x5b0).repeat(5))).toBe('combining_run'); // Hebrew points
    expect(displaySafe('x' + cp(0x20d0).repeat(5))).toBe('combining_run');
  });
  it('is stable across calls (no regex state)', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(displaySafe('abc' + cp(0x202e) + 'def')).toBe('forbidden_char');
      expect(displaySafe('plain')).toBe('ok');
    }
  });
});

describe('validators report the display-safety reason', () => {
  it('validatePhrase, validateCue and validateDeviceLabel', () => {
    expect(validatePhrase('abc' + cp(0x202e) + 'def')).toEqual({ ok: false, reason: 'forbidden_char' });
    expect(validatePhrase(cp(0x200b, 0x200b))).toEqual({ ok: false, reason: 'no_visible_content' });
    expect(validatePhrase('x' + cp(0x301).repeat(5))).toEqual({ ok: false, reason: 'combining_run' });
    expect(validateCue('Vol' + cp(0x202e) + 'ume')).toEqual({ ok: false, reason: 'forbidden_char' });
    expect(validateDeviceLabel('Mom' + cp(0x2067) + 's')).toEqual({ ok: false, reason: 'forbidden_char' });
    expect(validatePhrase('Good morning')).toEqual({ ok: true });
    expect(validateUserText('ab' + cp(0x200e) + 'cd', 1, 10)).toEqual({ ok: true });
  });
  it('length is reported before display safety, normalisation before both', () => {
    expect(validatePhrase('a' + cp(0x202e) + 'b'.repeat(70))).toEqual({ ok: false, reason: 'too_long' });
    expect(validatePhrase('')).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePhrase('e' + cp(0x301) + cp(0x202e))).toEqual({ ok: false, reason: 'not_normalized' });
    expect(validatePhrase('a\nb')).toEqual({ ok: false, reason: 'control_chars' });
  });
});

describe('display safety on the wire', () => {
  const phrases = (text: string): string => codeOf(patchedMany(fixtureOf('phrases.update'), { 'payload.phrases.0': text }));
  const cue = (text: string): string => codeOf(patchedMany(fixtureOf('cue'), { 'payload.text': text }));
  const label = (text: string): string => codeOf(patchedMany(fixtureOf('join.request'), { 'payload.device_label': text }));
  const appVersion = (text: string): string => codeOf(patchedMany(fixtureOf('room.create vega'), { 'payload.client.app_version': text }));
  const fields: Array<[string, (t: string) => string]> = [
    ['phrases.update', phrases],
    ['cue', cue],
    ['device_label', label],
    ['app_version', appVersion],
  ];
  const forbidden = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029, 0x2060, 0xfeff, 0xfff9, 0xfffe, 0xe0041, 0xfdd0, 0x1fffe];

  for (const [name, send] of fields) {
    it(`${name}: rejects forbidden characters (probes F-* and N-*)`, () => {
      for (const c of forbidden) expect(send('ab' + cp(c) + 'cd'), `${name} U+${c.toString(16)}`).toBe('bad_schema');
    });
    it(`${name}: rejects invisible-only and over-stacked text`, () => {
      expect(send(cp(0x200b, 0x200b, 0x200b))).toBe('bad_schema');
      expect(send(cp(0x3164))).toBe('bad_schema');
      expect(send(cp(0x2800))).toBe('bad_schema');
      expect(send('x' + cp(0x301).repeat(5))).toBe('bad_schema'); // 6 code points: within every length limit
      expect(send('x' + cp(0x301).repeat(4))).toBe('ok');
    });
    it(`${name}: keeps NFC text, ZWJ, ZWNJ, LRM, RLM and ALM`, () => {
      for (const ok of [
        'abc' + cp(0x200e) + 'def',
        'abc' + cp(0x200f) + 'def',
        'abc' + cp(0x61c) + 'def',
        cp(0x645, 0x6cc, 0x200c, 0x62e),
        cp(0x915, 0x94d, 0x200d, 0x937),
        cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
        'café',
        cp(0x2764, 0xfe0f),
        'x' + cp(0x301, 0x302, 0x303, 0x304),
      ]) {
        expect(send(ok), `${name} ${JSON.stringify(ok)}`).toBe('ok');
      }
    });
  }

  it('probe F-combining-stack: 59 stacked marks in a phrase are rejected', () => {
    expect(phrases('x' + cp(0x301).repeat(59))).toBe('bad_schema');
  });

  it('app_version is display safe but is not required to be NFC (it is not user text)', () => {
    expect(appVersion('1.0.0-é')).toBe('ok');
    expect(appVersion('1.0.0-e' + cp(0x301))).toBe('ok');
  });

  it('every family or script sample of the reviewer passes in phrases', () => {
    for (const [name, text, expected] of sketchCases) {
      if (expected === 'ok') expect(phrases(text), name).toBe('ok');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { STARTER_PHRASES, normalizeText, validateCue, validatePhrase, validatePhraseBank } from '../src/index.js';
import { boot } from './helpers.js';

const emoji = (n: number) => '\u{1F600}'.repeat(n); // each is one code point, two UTF-16 units

describe('phrase text validation', () => {
  it('normalizes to NFC and trims before measuring length in code points', () => {
    expect(normalizeText('  Café  ')).toBe('Café');
    expect(validatePhrase('Café')).toBe('Café');
    expect(validatePhrase('é'.repeat(60))).toBe('é'.repeat(60));
    expect(validatePhrase(`  ${'a'.repeat(60)}\n`)).toBe('a'.repeat(60));
  });

  it('accepts 1..60 code points and rejects 0 and 61, counting code points not UTF-16 units', () => {
    expect(validatePhrase('a')).toBe('a');
    expect(validatePhrase('a'.repeat(60))).toBe('a'.repeat(60));
    expect(validatePhrase('a'.repeat(61))).toBeNull();
    expect(validatePhrase('')).toBeNull();
    expect(validatePhrase('   \t ')).toBeNull();
    expect(validatePhrase(emoji(60))).toBe(emoji(60));
    expect(validatePhrase(emoji(61))).toBeNull();
  });

  it('rejects control characters but keeps markup-like text literally', () => {
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u007fb', 'a\u0085b', 'a\u009fb', 'two\nlines', 'tab\tinside']) {
      expect(validatePhrase(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(validatePhrase('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(validatePhrase('Tom & "Jerry" {{x}} ${y}')).toBe('Tom & "Jerry" {{x}} ${y}');
  });

  it('rejects non-strings', () => {
    for (const bad of [null, undefined, 5, {}, [], true]) expect(validatePhrase(bad)).toBeNull();
  });

  it('the household bank is 1..10 items', () => {
    expect(validatePhraseBank([])).toEqual({ ok: false, reason: 'too_few' });
    expect(validatePhraseBank(['x'])).toEqual({ ok: true, phrases: ['x'] });
    expect(validatePhraseBank(Array.from({ length: 10 }, (_, i) => `p${i}`))).toMatchObject({ ok: true });
    expect(validatePhraseBank(Array.from({ length: 11 }, (_, i) => `p${i}`))).toEqual({ ok: false, reason: 'too_many' });
    expect(validatePhraseBank('nope')).toEqual({ ok: false, reason: 'not_a_list' });
    expect(validatePhraseBank({ 0: 'a' })).toEqual({ ok: false, reason: 'not_a_list' });
    expect(validatePhraseBank(['ok', 7])).toEqual({ ok: false, reason: 'invalid_phrase' });
    expect(validatePhraseBank(['ok', 'a'.repeat(61)])).toEqual({ ok: false, reason: 'invalid_phrase' });
  });

  it('the cue is 1..12 code points, trimmed, NFC', () => {
    expect(validateCue('Volume')).toBe('Volume');
    expect(validateCue('  Up  ')).toBe('Up');
    expect(validateCue('x'.repeat(12))).toBe('x'.repeat(12));
    expect(validateCue('x'.repeat(13))).toBeNull();
    expect(validateCue(emoji(12))).toBe(emoji(12));
    expect(validateCue(emoji(13))).toBeNull();
    expect(validateCue('')).toBeNull();
  });

  it('the starter set is ten original sentences within the limits', () => {
    expect(STARTER_PHRASES).toHaveLength(10);
    expect(new Set(STARTER_PHRASES).size).toBe(10);
    for (const p of STARTER_PHRASES) expect(validatePhrase(p)).toBe(p);
  });
});

describe('phrases.update through the store', () => {
  it('replaces the starter bank and renders literal text', async () => {
    const h = await boot();
    h.pairOnly();
    const bank = ['<script>alert(1)</script>', 'Caf\u00e9 time', 'padded'];
    h.phrases(bank);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
    h.setupPairedToPhrases();
    expect(h.last('session.begin').payload.phrase_count).toBe(3);
    expect(h.view.phrase).toMatchObject({ position: 1, total: 3, text: '<script>alert(1)</script>' });
    h.runPhrase({});
    h.ui('next_phrase');
    expect(h.view.phrase?.text).toBe('Caf\u00e9 time');
    h.runPhrase({});
    h.ui('next_phrase');
    expect(h.view.phrase?.text).toBe('padded');
    await h.flush();
    expect(JSON.parse(h.storage.dump()['atr:v1:phrases'] as string).phrases).toEqual(bank);
  });

  it('text that the shared validators reject (61 characters, 11 phrases, empty list, control characters, not normalized) never reaches the bank', async () => {
    const h = await boot();
    h.pairOnly();
    const bad: unknown[] = [
      ['a'.repeat(61)],
      Array.from({ length: 11 }, (_, i) => `p${i}`),
      [],
      ['ok', 'bad\u0000'],
      ['  padded  '],
      ['Cafe\u0301'],
      'not a list',
    ];
    const acks = h.of('ack').length;
    for (const value of bad) h.phrases(value);
    expect(h.of('ack')).toHaveLength(acks); // dropped at the wire boundary, nothing applied
    h.setupPairedToPhrases();
    expect(h.view.phrase?.text).toBe(STARTER_PHRASES[0]);
    expect(h.view.phrase?.total).toBe(10);
    h.ui('finish_early');
    h.ui('done');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(Number(h.view.diagnostics?.messages_unparseable)).toBe(bad.length);
  });

  it('accepts exactly 60 characters and exactly 10 phrases', async () => {
    const h = await boot();
    h.pairOnly();
    const bank = Array.from({ length: 10 }, (_, i) => String(i).repeat(60).slice(0, 60));
    h.phrases(bank);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
    h.setupPairedToPhrases();
    expect(h.view.phrase?.total).toBe(10);
    expect(h.view.phrase?.text).toHaveLength(60);
  });

  it('is rejected while a window is open and leaves the bank unchanged', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.phrases(['changed']);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'window_open' });
    h.answerWindow({});
    expect(h.view.phrase?.text).toBe(STARTER_PHRASES[0]);
    expect(h.view.phrase?.total).toBe(10);
    h.ui('finish_early');
    h.ui('done');
    h.micState('off');
    h.ui('start_session');
    expect(h.view.stage).toBe('permission_pending');
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    expect(h.view.phrase?.text).toBe(STARTER_PHRASES[0]);
  });

  it('after the first phrase begins, a new bank applies to the next session only', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('next_phrase');
    h.phrases(['Next session only.', 'Second.']);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied', detail: 'next_session' });
    expect(h.view.banner?.text).toContain('next session');
    expect(h.view.phrase?.total).toBe(10);
    h.ui('finish_early');
    h.ui('done');
    h.micState('off');
    h.ui('start_session');
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    expect(h.view.phrase).toMatchObject({ total: 2, text: 'Next session only.' });
  });
});

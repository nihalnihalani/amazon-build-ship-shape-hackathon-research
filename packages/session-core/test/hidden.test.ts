import { describe, expect, it } from 'vitest';
import type { TvView } from '../src/index.js';
import { LABEL_RELATIVE } from '../src/index.js';
import { FLOOR, Harness, allStrings, boot } from './helpers.js';

/** Strings that would reveal a level or verdict. 'Felt loud' (a button) is deliberately not listed. */
const LEAKY = [/reach/i, /below/i, /\bband\b/i, /\bdB\b/, /not scored/i, /listener:/i, /you felt/i, /relative level/i, /borderline/i];

function isBlindPendingView(v: TvView): boolean {
  return (
    v.phrase !== null &&
    [3, 6, 9].includes(v.phrase.position) &&
    v.phrase.attemptNumber === 1 &&
    (v.stage === 'phrase_active' || v.stage === 'response_pending')
  );
}

function assertNoLeak(v: TvView): void {
  expect(v.meter).toBeNull();
  expect(v.result).toBeNull();
  expect(v.summary).toBeNull();
  expect(v.labels).not.toContain(LABEL_RELATIVE);
  const text = allStrings({ ...v, footer: '' }).join(' | ');
  for (const re of LEAKY) expect(text, `view leaked ${re}: ${text}`).not.toMatch(re);
}

async function toPosition(h: Harness, position: number): Promise<void> {
  h.setupToPhrases();
  for (let p = 1; p < position; p += 1) {
    h.runPhrase({ rating: 'skipped', rel: 25 });
    h.ui('next_phrase');
  }
  expect(h.view.phrase?.position).toBe(position);
}

describe('hidden first attempt at positions 3, 6, 9', () => {
  for (const position of [3, 6, 9]) {
    it(`position ${position}: no meter, result, label or announcement depends on level or verdict before reveal`, async () => {
      const h = await boot();
      await toPosition(h, position);
      h.views.length = 0;

      h.ui('begin_phrase');
      expect(h.view.body.join(' ')).toContain('Blind check');
      h.advance(1500);
      h.answerPrecheck();
      const start = h.last('window.start');
      for (let f = 0; f < 6; f += 1) {
        h.level(f, FLOOR + f * 5, f % 2 === 0, start);
        h.advance(100);
      }
      h.ok(); // early stop
      h.answerWindow({ rel: 25 }, start);
      expect(h.view.stage).toBe('response_pending');
      // rate then reveal
      h.ui('rate_felt_loud');
      expect(h.view.stage).toBe('reveal');

      const blind = h.views.filter(isBlindPendingView);
      expect(blind.length).toBeGreaterThan(4);
      for (const v of blind) assertNoLeak(v);
      for (const v of h.views) if (v.capturing) expect(v.announcement).toBeNull();

      // after reveal the result is present with a text label and the speaker's own rating
      expect(h.view.result?.label).toBe("Reached today's relative level band (unqualified phone)");
      expect(h.view.result?.speakerRating).toBe('You felt: loud');
      expect(h.view.labels).toContain(LABEL_RELATIVE);
    });
  }

  it('the blind views are byte-identical whether the window reached, fell below, or levels differed', async () => {
    async function run(rel: number, levelOffset: number): Promise<string[]> {
      const h = await boot();
      await toPosition(h, 3);
      h.views.length = 0;
      h.ui('begin_phrase');
      h.advance(1500);
      h.answerPrecheck();
      const start = h.last('window.start');
      for (let f = 0; f < 5; f += 1) {
        h.level(f, FLOOR + levelOffset + f, f % 2 === 1, start);
        h.advance(100);
      }
      h.answerWindow({ rel }, start);
      expect(h.view.stage).toBe('response_pending');
      return h.views.filter(isBlindPendingView).map((v) => JSON.stringify(v));
    }
    const reached = await run(25, 22);
    const below = await run(5, -3);
    expect(reached.length).toBeGreaterThan(3);
    expect(below).toEqual(reached);
  });

  it('a speaker rating can be skipped and is counted as skipped, not invented', async () => {
    const h = await boot();
    await toPosition(h, 3);
    h.runPhrase({ rating: 'skipped' });
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.speakerRating).toBe('You felt: not rated');
    h.ui('finish_early');
    expect(h.view.summary?.hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 0, skipped: 1 });
  });

  it('response_pending waits indefinitely for the speaker rating (no timer on the rating)', async () => {
    const h = await boot();
    await toPosition(h, 3);
    h.runPhrase({});
    expect(h.view.stage).toBe('response_pending');
    h.advance(10 * 60_000);
    expect(h.view.stage).toBe('response_pending');
    expect(h.actionIds()).toEqual(['rate_felt_loud', 'rate_felt_normal', 'rate_skip']);
    expect(h.view.title).toBe('How did that feel?');
  });

  it('a retry gets new window and attempt ids, a visible meter, and the first attempt alone counts as blind', async () => {
    const h = await boot();
    await toPosition(h, 3);
    h.runPhrase({ rating: 'felt_normal', rel: 25 });
    const first = h.last('window.start');
    expect(h.view.stage).toBe('reveal');
    h.ui('try_again');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.phrase?.attemptNumber).toBe(2);
    expect(h.view.body.join(' ')).toContain('Retry');
    h.ui('begin_phrase');
    h.advance(1500);
    h.answerPrecheck();
    const retry = h.last('window.start');
    expect(retry.window_id).not.toBe(first.window_id);
    expect(retry.attempt_id).not.toBe(first.attempt_id);
    h.level(0, FLOOR + 18, true, retry);
    expect(h.view.meter).not.toBeNull();
    expect(h.view.meter?.levelRelDb).toBe(18);
    expect(h.view.meter?.bandRelDb).toBe(19);
    expect(h.view.labels).toContain(LABEL_RELATIVE);
    h.answerWindow({ rel: 5 }, retry);
    // visible retry: no rating requested, reveal immediately
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.label).toBe("Below today's relative level band (unqualified phone)");
    expect(h.view.phrase?.attemptNumber).toBe(2);
    h.ui('finish_early');
    // blind count uses the first attempt only; the visible retry never replaces it
    expect(h.view.summary).toMatchObject({ reachedHidden: 1, scoredHidden: 1 });
    expect(h.view.summary?.hiddenRatings.feltNormal).toBe(1);
  });

  it('an invalid blind attempt waits behind the neutral prompt, reveals as Not scored with its reason, and the retry shows the meter', async () => {
    const h = await boot();
    await toPosition(h, 3);
    h.runPhrase({ valid: false, reason: 'no_voice' });
    // A4-01: nothing says "not scored" or why before the speaker has rated
    expect(h.view.stage).toBe('response_pending');
    expect(h.view.result).toBeNull();
    expect(h.view.title).toBe('How did that feel?');
    h.ui('rate_felt_normal');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.label).toBe('Not scored');
    expect(h.view.result?.tone).toBe('not_scored');
    expect(h.view.result?.speakerRating).toBe('You felt: normal');
    expect(h.actionIds()).toEqual(['try_again', 'skip_phrase', 'finish_early']);
    h.ui('try_again');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.level(0, FLOOR + 10, true);
    expect(h.view.meter).not.toBeNull();
  });

  it('a gate-blocked first attempt never captured anything, so the next try is still blind', async () => {
    const h = await boot();
    await toPosition(h, 3);
    h.beginAndLead('begin_phrase');
    h.answerPrecheck({}, 7); // rise 7 dB >= 6 dB: blocked
    expect(h.view.stage).toBe('paused_or_invalid');
    h.ui('retry');
    expect(h.view.body.join(' ')).toContain('Blind check');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck({}, 0);
    h.level(0, FLOOR + 20, true);
    expect(h.view.meter).toBeNull();
    expect(h.view.phrase?.attemptNumber).toBe(2);
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    h.ui('rate_felt_normal');
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ scoredHidden: 1, reachedHidden: 1, attemptsInvalid: 1 });
    expect(h.view.summary?.invalidReasons).toEqual({ room_noisier: 1 });
  });

  it('visible phrases show the meter only while capturing and never before frames arrive', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('begin_phrase');
    expect(h.view.meter).toBeNull();
    h.advance(1500);
    expect(h.view.meter).toBeNull();
    h.answerPrecheck();
    expect(h.view.meter).toBeNull(); // window.start sent, the phone is not measuring yet (DEF-007)
    h.level(0, FLOOR + 10);
    expect(h.view.meter?.levelRelDb).toBe(10);
    expect(h.view.meter?.active).toBe(true);
    h.level(1, FLOOR + 20);
    expect(h.view.meter?.levelRelDb).toBe(15); // display smoothing only; scoring never uses it
    h.advance(1200);
    expect(h.view.meter?.levelRelDb).toBeNull(); // stale frame is not shown
    h.answerWindow({ rel: 25 });
    expect(h.view.meter).toBeNull();
  });

  it('hidden positions follow the bank length: 4 phrases hide only position 3, 2 phrases hide none', async () => {
    const h4 = await boot();
    h4.phrases(['One.', 'Two.', 'Three.', 'Four.']);
    h4.setupToPhrases();
    const seen4: number[] = [];
    for (let i = 1; i <= 4; i += 1) {
      h4.ui('begin_phrase');
      if (h4.view.body.join(' ').includes('Blind check')) seen4.push(i);
      h4.advance(1500);
      h4.answerPrecheck();
      h4.answerWindow({ rel: 25 });
      if (h4.view.stage === 'response_pending') h4.ui('rate_skip');
      h4.ui('next_phrase');
    }
    expect(seen4).toEqual([3]);
    expect(h4.view.summary?.phrasesCompleted).toBe(4);

    const h2 = await boot();
    h2.phrases(['One.', 'Two.']);
    h2.setupToPhrases();
    for (let i = 1; i <= 2; i += 1) {
      h2.runPhrase({});
      expect(h2.view.stage).toBe('reveal');
      h2.ui('next_phrase');
    }
    expect(h2.view.summary?.scoredHidden).toBe(0);
  });
});

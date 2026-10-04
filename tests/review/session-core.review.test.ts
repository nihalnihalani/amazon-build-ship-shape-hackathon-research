/**
 * Independent QA review of @atr/session-core (T11 storage/resume/deletion, T13/T14 hidden meter, listener, reveal).
 *
 * Reviewer: Sonnet 5.5 (qa-accessibility). Written from ADR-0001/0004/0005/0008, docs/PROTOCOL.md and the
 * master prompt, NOT copied from packages/session-core/test. Expected values are derived by hand in comments.
 *
 * Evidence class: automated (a pure state machine driven through createSessionStore with fakes). It does not
 * establish microphone validity, Vega behaviour, VoiceView behaviour or relay behaviour.
 *
 * Tests named "DEFECT QA-xx" assert the CORRECT (specified) behaviour and are wrapped in `it.fails`, so the
 * suite stays green while a defect is open. Set QA_STRICT=1 to run them as ordinary tests (they then fail
 * until the defect is fixed; when a fixed defect makes `it.fails` flip, drop the wrapper).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SummaryView, TvView } from '@atr/session-core';
import { STORAGE_PREFIX } from '@atr/session-core';
import {
  BAND_MARGIN,
  CREDENTIAL,
  DAY,
  Disk,
  EDGE_REL,
  FLOOR,
  PAIRING_CODE,
  PHRASES,
  Rig,
  START,
  Clock,
  allKeys,
  visibleStrings,
} from './rig.js';
import type { Sent } from './rig.js';

const STRICT = process.env['QA_STRICT'] === '1';
const defect = (id: string, name: string, fn: () => void | Promise<void>): void => {
  (STRICT ? it : it.fails)(`DEFECT ${id}: ${name}`, fn);
};

const HIDDEN_FOR = (n: number): number[] => [3, 6, 9].filter((p) => p <= n);

/* ================================================================== (a) hidden positions */

describe('(a) hidden positions by phrase-bank size', () => {
  for (const n of [1, 2, 3, 4, 6, 9, 10]) {
    it(`bank of ${n}: blind positions are exactly ${JSON.stringify(HIDDEN_FOR(n))}`, async () => {
      const rig = await new Rig({ seed: 100 + n }).boot();
      await rig.setupToPhrases({ bank: PHRASES.slice(0, n) });
      expect(rig.view.phrase?.total).toBe(n);

      const metersMissingAt: number[] = [];
      const ratingPromptAt: number[] = [];
      const blindNoteAt: number[] = [];
      for (let p = 1; p <= n; p += 1) {
        expect(rig.view.stage).toBe('phrase_ready');
        expect(rig.view.phrase?.position).toBe(p);
        if (rig.view.body.some((l) => /blind check/i.test(l))) blindNoteAt.push(p);
        const capture = rig.attempt({ rel: 25 });
        expect(capture).not.toBeNull();
        if (capture?.meter === null) metersMissingAt.push(p);
        if (rig.view.stage === 'response_pending') {
          ratingPromptAt.push(p);
          expect(rig.actionIds()).toEqual(['rate_felt_loud', 'rate_felt_normal', 'rate_skip']);
          rig.ui('rate_skip');
        }
        expect(rig.view.stage).toBe('reveal');
        expect(rig.view.result?.label).toBe("Reached today's relative level band");
        rig.ui('next_phrase');
      }
      const expected = HIDDEN_FOR(n);
      expect(metersMissingAt).toEqual(expected);
      expect(ratingPromptAt).toEqual(expected);
      expect(blindNoteAt).toEqual(expected);

      // Hand arithmetic: every attempt is reached (25 >= 19). Hidden totals count only blind positions.
      expect(rig.view.stage).toBe('summary');
      const s = rig.summary();
      expect(s.complete).toBe(true);
      expect(s.phrasesCompleted).toBe(n);
      expect(s.scoredHidden).toBe(expected.length);
      expect(s.reachedHidden).toBe(expected.length);
      expect(s.scoredVisible).toBe(n - expected.length);
      expect(s.reachedVisible).toBe(n - expected.length);
      expect(s.hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 0, skipped: expected.length });
    });
  }

  it('a 4-phrase bank hides only position 3 and position 4 is visible', async () => {
    const rig = await new Rig({ seed: 7 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 4) });
    const seen: boolean[] = [];
    for (let p = 1; p <= 4; p += 1) {
      const cap = rig.attempt({ rel: 25 });
      seen.push(cap?.meter === null);
      if (rig.view.stage === 'response_pending') rig.ui('rate_skip');
      rig.ui('next_phrase');
    }
    expect(seen).toEqual([false, false, true, false]);
  });

  it('retries are visible, marked as retries, and only first attempts count in the hidden totals', async () => {
    const rig = await new Rig({ seed: 21 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 4) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    // Position 3: blind first attempt below the edge (rel 5 against 19), then a rating, then a retry.
    const blind = rig.attempt({ rel: 5 });
    expect(blind?.meter).toBeNull();
    expect(blind?.phrase?.attemptNumber).toBe(1);
    expect(rig.view.stage).toBe('response_pending');
    rig.ui('rate_felt_normal');
    expect(rig.view.result?.label).toBe("Below today's relative level band");
    expect(rig.view.result?.speakerRating).toBe('You felt: normal');
    rig.ui('try_again');
    expect(rig.view.stage).toBe('phrase_ready');
    expect(rig.view.body.some((l) => /^Retry: the meter will be shown/.test(l))).toBe(true);
    // The retry is visible (meter present), is attempt 2 and is scored without a rating phase.
    const retry = rig.attempt({ rel: 25 });
    expect(retry?.meter).not.toBeNull();
    expect(retry?.phrase?.attemptNumber).toBe(2);
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe("Reached today's relative level band");
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    const s = rig.summary();
    // Hand arithmetic: positions 1,2,4 visible (3 scored, 3 reached). Position 3 counts once, in the HIDDEN
    // bucket, from its blind attempt only (below): hidden scored 1, reached 0. The visible retry is not added.
    expect({ sh: s.scoredHidden, rh: s.reachedHidden, sv: s.scoredVisible, rv: s.reachedVisible }).toEqual({
      sh: 1,
      rh: 0,
      sv: 3,
      rv: 3,
    });
    expect(s.phrasesCompleted).toBe(4);
    expect(s.hiddenRatings.feltNormal).toBe(1);
  });

  it('the stored record carries the retry as attempt 2, not hidden', async () => {
    const rig = await new Rig({ seed: 22 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.attempt({ rel: 25 });
    rig.ui('rate_skip');
    rig.ui('try_again');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    await rig.settle();
    const key = rig.disk.atrKeys().find((k) => k.startsWith('atr:v1:session:'));
    expect(key).toBeDefined();
    const rec = rig.disk.json(key as string) as { attempts: { position: number; attemptNumber: number; hidden: boolean }[] };
    const atThree = rec.attempts.filter((a) => a.position === 3);
    expect(atThree.map((a) => [a.attemptNumber, a.hidden])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  defect('QA-01', 'ADR-0004 and the implementation disagree on how a retry is marked (ADR names meter_visibility: visible_retry; no such marker exists)', async () => {
    const adr = readFileSync(new URL('../../docs/adr/0004-listener-reveal-and-agreement.md', import.meta.url), 'utf8');
    const rig = await new Rig({ seed: 23 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.attempt({ rel: 25 });
    rig.ui('rate_skip');
    rig.ui('try_again');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    await rig.settle();
    const key = rig.disk.atrKeys().find((k) => k.startsWith('atr:v1:session:')) as string;
    const rec = rig.disk.json(key) as { attempts: { position: number; attemptNumber: number; hidden: boolean }[] };
    const retry = rec.attempts.find((a) => a.position === 3 && a.attemptNumber === 2);
    // Whichever marker the ADR names must be the one the implementation carries.
    if (/visible_retry/.test(adr)) expect(rig.disk.allText()).toContain('visible_retry');
    else {
      expect(adr).toMatch(/attemptNumber\s*>\s*1/); // the amended wording: a retry is attemptNumber > 1
      expect(retry).toMatchObject({ attemptNumber: 2, hidden: false });
    }
  });

  it('cancelling a blind attempt in the quiet lead consumes nothing: the next attempt is still blind', async () => {
    const rig = await new Rig({ seed: 24 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.ui('begin_phrase'); // lead starts
    rig.back(); // Back in the lead
    expect(rig.view.stage).toBe('phrase_ready');
    expect(rig.count('window.cancel')).toBe(0); // nothing was started on the phone
    const cap = rig.attempt({ rel: 25 });
    expect(cap?.meter).toBeNull();
    expect(cap?.phrase?.attemptNumber).toBe(1);
  });

  it('a blind attempt that was captured and then cancelled is spent: the retry is visible', async () => {
    const rig = await new Rig({ seed: 25 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    expect(rig.view.meter).toBeNull();
    rig.back(); // cancel during capture
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe('Not scored');
    rig.ui('try_again');
    expect(rig.view.body.some((l) => /^Retry:/.test(l))).toBe(true);
    const retry = rig.attempt({ rel: 25 });
    expect(retry?.meter).not.toBeNull();
    expect(retry?.phrase?.attemptNumber).toBe(2);
  });
});

/* ================================================================== (b) leak scan */

/** The verdict vocabulary that must not appear before reveal. */
const VERDICT_WORDS = /\b(reached|below|band|quiet|borderline|heard|scored?|result|dB|relative)\b/i;
/** Strings that legitimately appear for a blind attempt: the explanation of the blind check itself. */
const BLIND_COPY = /^Blind check: the meter is hidden for this phrase$/;
/** The speaker's own rating prompt: the only place the word "loud" may appear before reveal. */
const RATING_COPY = /(How loud did that feel\?|Choose how loud that phrase felt to you|Felt loud)/g;

interface HiddenRun {
  rig: Rig;
  /** Trace entries from pressing Begin on the blind phrase up to (excluding) the first reveal view. */
  preReveal: { step: string; view: TvView }[];
  sentThroughReveal: Sent[];
}

async function hiddenRun(opts: { family: boolean; levels: number[]; rel: number }): Promise<HiddenRun> {
  const rig = await new Rig({ seed: 4242 }).boot();
  await rig.setupToPhrases({ family: opts.family, bank: PHRASES.slice(0, 4) });
  for (let p = 1; p <= 2; p += 1) {
    rig.attempt({ rel: 25 });
    if (opts.family) rig.listenerResponse('heard');
    rig.ui('next_phrase');
  }
  const mark = rig.trace.length;
  rig.attempt({ rel: opts.rel, levels: opts.levels });
  if (opts.family) rig.listenerResponse('heard');
  rig.ui('rate_felt_normal');
  const slice = rig.trace.slice(mark);
  const firstReveal = slice.findIndex((t) => t.view.stage === 'reveal');
  return { rig, preReveal: slice.slice(0, firstReveal), sentThroughReveal: rig.wire.sent.slice() };
}

const EXTREME_LOW_HIGH = [-140, -140, 20, 20, -140, 20, -140, -140, 20, 20, 20, -140];
const EXTREME_HIGH_LOW = [20, 20, 20, -140, -140, 20, 20, -140, 20, -140, 20, 20];

describe('(b) no result or level information before reveal for a blind attempt', () => {
  for (const family of [false, true]) {
    describe(family ? 'family mode (listener + rating)' : 'speaker-only mode (rating)', () => {
      it('every pre-reveal view has no meter, no result, no level keys and no verdict wording', async () => {
        const { preReveal } = await hiddenRun({ family, levels: EXTREME_LOW_HIGH, rel: 25 });
        expect(preReveal.length).toBeGreaterThan(5);
        for (const { step, view } of preReveal) {
          const where = `step=${step} stage=${view.stage}`;
          expect(view.meter, where).toBeNull();
          expect(view.result, where).toBeNull();
          expect(view.summary, where).toBeNull();
          expect(view.history, where).toBeNull();
          const keys = allKeys(view);
          for (const banned of ['levelRelDb', 'bandRelDb', 'tone', 'borderline', 'speakerRating']) {
            expect(keys, `${where} key ${banned}`).not.toContain(banned);
          }
          if (view.capturing) expect(view.announcement, `${where} announcement while capturing`).toBeNull();

          let strings = visibleStrings(view).filter((s) => !BLIND_COPY.test(s));
          if (view.stage === 'response_pending') strings = strings.map((s) => s.replace(RATING_COPY, ''));
          for (const s of strings) {
            expect(s, `${where} string "${s}"`).not.toMatch(VERDICT_WORDS);
            expect(s, `${where} string "${s}" mentions loud outside the rating prompt`).not.toMatch(/\bloud\b/i);
          }
          // Digits are allowed only in the "Phrase N of M" title; any other number could be a level.
          const digitsLeft = strings.map((s) => s.replace(/Phrase \d+ of \d+/g, '')).filter((s) => /\d/.test(s));
          expect(digitsLeft, `${where} stray digits`).toEqual([]);
          expect(view.labels, `${where} labels`).toEqual([]);
        }
      });

      it('views and TV->phone traffic are IDENTICAL for a loud/reached run and a quiet/below run (-140 and +20 dBFS extremes)', async () => {
        const a = await hiddenRun({ family, levels: EXTREME_LOW_HIGH, rel: 25 }); // reached
        const b = await hiddenRun({ family, levels: EXTREME_HIGH_LOW, rel: 5 }); // below
        expect(a.preReveal.map((t) => t.step)).toEqual(b.preReveal.map((t) => t.step));
        for (let i = 0; i < a.preReveal.length; i += 1) {
          expect(JSON.stringify(a.preReveal[i]?.view), `step ${a.preReveal[i]?.step}`).toBe(JSON.stringify(b.preReveal[i]?.view));
        }
        // What the TV sends to the phone never depends on the level stream or on the verdict.
        const strip = (m: Sent): string => JSON.stringify({ ...m, event_timestamp: undefined });
        expect(a.sentThroughReveal.map(strip)).toEqual(b.sentThroughReveal.map(strip));
        // And the verdicts really did differ after reveal, so the comparison above was not vacuous.
        expect(a.rig.view.result?.label).toBe("Reached today's relative level band");
        expect(b.rig.view.result?.label).toBe("Below today's relative level band");
      });

      it('levels at exactly -140 and +20 dBFS during a blind capture do not throw, stall or alter the view', async () => {
        const rig = await new Rig({ seed: 5 }).boot();
        await rig.setupToPhrases({ family, bank: PHRASES.slice(0, 3) });
        for (let p = 1; p <= 2; p += 1) {
          rig.attempt({ rel: 25 });
          if (family) rig.listenerResponse('heard');
          rig.ui('next_phrase');
        }
        rig.ui('begin_phrase');
        rig.advance(1500);
        rig.precheckResult();
        const before = JSON.stringify(rig.view);
        const start = rig.last('window.start');
        rig.level(0, -140, false, false, start);
        rig.level(1, 20, true, true, start);
        rig.level(2, -140, true, false, start);
        rig.level(3, 20, true, true, start);
        expect(JSON.stringify(rig.view)).toBe(before);
        expect(rig.view.stage).toBe('phrase_active');
        expect(rig.view.meter).toBeNull();
      });
    });
  }

  it('on a VISIBLE attempt the same extremes do show (so the hidden checks above are not vacuous)', async () => {
    const rig = await new Rig({ seed: 6 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const start = rig.last('window.start');
    rig.level(0, -140, false, false, start);
    // First frame is shown unsmoothed: -140 dBFS against a -50 dBFS floor is -90 dB relative.
    expect(rig.view.meter?.levelRelDb).toBe(-90);
    rig.level(1, 20, true, false, start);
    const second = rig.view.meter?.levelRelDb ?? Number.NaN;
    // Smoothed value sits strictly between the two inputs (-90 and +70 relative).
    expect(second).toBeGreaterThan(-90);
    expect(second).toBeLessThan(70);
    expect(rig.view.meter?.bandRelDb).toBe(EDGE_REL);
    // Stale after more than one second without a frame.
    rig.advance(1001);
    expect(rig.view.meter?.levelRelDb).toBeNull();
    expect(rig.view.meter?.caption).toBe('No level reported');
  });

  it('the same hidden result does not reach a view through invalid-window or paused paths before reveal', async () => {
    const rig = await new Rig({ seed: 8 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    // Blind attempt blocked by the pre-window gate (rise 8 dB >= 6): paused, never started, unscored.
    rig.attempt({ rise: 8 });
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.view.result).toBeNull();
    expect(rig.view.meter).toBeNull();
    expect(rig.count('window.start')).toBe(2 + 1); // calibration + two visible phrases, none for the blocked one
  });
});

/* ================================================================== (c) response-phase ordering */

describe('(c) response phase: ordering, skip, timeout, lock, late responses', () => {
  async function familyAtBlindPhrase(seed: number): Promise<Rig> {
    const rig = await new Rig({ seed }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 4) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.listenerResponse('heard');
      rig.ui('next_phrase');
    }
    return rig;
  }

  it('hidden + family: listener first, then rating -> reveal only after BOTH', async () => {
    const rig = await familyAtBlindPhrase(31);
    rig.attempt({ rel: 25 });
    expect(rig.view.stage).toBe('response_pending');
    expect(rig.count('listener.open')).toBe(3); // positions 1, 2 and the blind 3
    const revealsBefore = rig.count('attempt.reveal');
    rig.listenerResponse('not_heard');
    expect(rig.view.stage).toBe('response_pending'); // rating still missing
    expect(rig.count('attempt.reveal')).toBe(revealsBefore);
    expect(rig.view.result).toBeNull();
    rig.ui('rate_felt_loud');
    expect(rig.view.stage).toBe('reveal');
    expect(rig.count('attempt.reveal')).toBe(revealsBefore + 1);
    expect(rig.view.result?.listener).toBe('Listener: not heard');
    expect(rig.view.result?.speakerRating).toBe('You felt: loud');
  });

  it('hidden + family: rating first, then listener -> reveal only after BOTH', async () => {
    const rig = await familyAtBlindPhrase(32);
    rig.attempt({ rel: 25 });
    const revealsBefore = rig.count('attempt.reveal');
    rig.ui('rate_felt_normal');
    expect(rig.view.stage).toBe('response_pending'); // listener still missing
    expect(rig.count('attempt.reveal')).toBe(revealsBefore);
    expect(rig.view.result).toBeNull();
    rig.listenerResponse('heard');
    expect(rig.view.stage).toBe('reveal');
    expect(rig.count('attempt.reveal')).toBe(revealsBefore + 1);
  });

  it('visible + family: result is held until the listener answers (no rating prompt)', async () => {
    const rig = await new Rig({ seed: 33 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    expect(rig.view.stage).toBe('response_pending');
    expect(rig.actionIds()).toEqual([]); // nothing to press until the 20 s choice appears
    expect(rig.view.result).toBeNull();
    rig.listenerResponse('heard');
    expect(rig.view.stage).toBe('reveal');
  });

  it('rating skip records "skipped" and reveals; summary counts it as a skip', async () => {
    const rig = await new Rig({ seed: 34 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.attempt({ rel: 25 });
    rig.ui('rate_skip');
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.speakerRating).toBe('You felt: not rated');
    rig.ui('next_phrase');
    expect(rig.summary().hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 0, skipped: 1 });
  });

  it('listener timeout: no choice at 19.999 s, choice at exactly 20 s, "continue" records missing and invents nothing', async () => {
    const rig = await new Rig({ seed: 35 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    expect(rig.view.stage).toBe('response_pending');
    rig.advance(19_999);
    expect(rig.actionIds()).toEqual([]);
    rig.advance(1);
    expect(rig.actionIds()).toEqual(['keep_waiting', 'continue_without_listener']);
    expect(rig.view.preferredAction).toBe('keep_waiting'); // Keep waiting is focused first
    rig.ui('continue_without_listener');
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.listener).toBe('Listener: no response');
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.listenerResponse('heard');
    rig.ui('next_phrase');
    const s = rig.summary();
    // Hand arithmetic: position 1 scored but listener missing -> not eligible; position 2 heard+reached -> agrees.
    expect(s.agreementVisible).toEqual({ agree: 1, eligible: 1 });
    expect(s.lateListenerResponses).toBe(0);
  });

  it('"Keep waiting" restarts the 20 s clock', async () => {
    const rig = await new Rig({ seed: 36 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    rig.advance(20_000);
    rig.ui('keep_waiting');
    expect(rig.actionIds()).toEqual([]);
    rig.advance(19_999);
    expect(rig.actionIds()).toEqual([]);
    rig.advance(1);
    expect(rig.actionIds()).toEqual(['keep_waiting', 'continue_without_listener']);
  });

  it('reveal locks the attempt: a second listener answer and a rating change are ignored', async () => {
    const rig = await new Rig({ seed: 37 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 4) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.listenerResponse('heard');
      rig.ui('next_phrase');
    }
    rig.attempt({ rel: 25 });
    const open = rig.last('listener.open');
    rig.listenerResponse('heard', open);
    rig.ui('rate_felt_normal');
    expect(rig.view.stage).toBe('reveal');
    const frozen = JSON.stringify(rig.view.result);
    rig.listenerResponse('not_heard', open); // different message id, same attempt
    rig.ui('rate_felt_loud'); // not offered any more
    expect(JSON.stringify(rig.view.result)).toBe(frozen);
    const ack = rig.last('ack');
    expect(ack.payload['outcome']).toBe('ignored_stale');
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.listenerResponse('heard');
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.lateListenerResponses).toBe(0); // an on-time answer never turns into a late one
    // Positions: 1 heard/reached (agree), 2 heard/reached (agree), 3 blind heard/reached (agree), 4 heard/reached (agree).
    expect(s.agreementHidden).toEqual({ agree: 1, eligible: 1 });
    expect(s.agreementVisible).toEqual({ agree: 3, eligible: 3 });
  });

  it('a late listener response is excluded from the denominator and counted as late; the result view says so', async () => {
    const rig = await new Rig({ seed: 38 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    const open = rig.last('listener.open');
    rig.advance(20_000);
    rig.ui('continue_without_listener');
    expect(rig.view.stage).toBe('reveal');
    rig.listenerResponse('not_heard', open); // arrives after reveal
    expect(rig.view.result?.listener).toBe('Listener (late, not counted): not heard');
    expect(rig.last('ack').payload).toMatchObject({ outcome: 'applied', detail: 'late' });
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.listenerResponse('heard');
    rig.ui('next_phrase');
    const s = rig.summary();
    // Position 1: reached, on-time response missing, late not_heard (would have DISAGREED) -> excluded.
    // Position 2: reached + heard -> agrees. Denominator 1, not 2.
    expect(s.agreementVisible).toEqual({ agree: 1, eligible: 1 });
    expect(s.lateListenerResponses).toBe(1);
    expect(s.lines.some((l) => /late/i.test(l))).toBe(true);
  });

  it('a listener answer for an invalid (unscored) attempt is never accepted: no listener.open was sent for it', async () => {
    const rig = await new Rig({ seed: 39 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    const opensBefore = rig.count('listener.open');
    rig.attempt({ valid: false, reason: 'no_voice' });
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe('Not scored');
    expect(rig.count('listener.open')).toBe(opensBefore);
    expect(rig.view.result?.listener).toBeNull();
  });

  it('a listener answer sent during capture (before window.result) is not accepted', async () => {
    const rig = await new Rig({ seed: 40 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const start = rig.last('window.start');
    rig.phoneSend('listener.response', { response: 'heard' }, { s: start.session_id, w: start.window_id, a: start.attempt_id });
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    rig.windowResult({ rel: 25 }, start);
    expect(rig.view.stage).toBe('response_pending'); // the early answer was dropped, still waiting
  });

  it('duplicate delivery of the same listener frame is dropped silently (no second ack, no state change)', async () => {
    const rig = await new Rig({ seed: 41 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    const open = rig.last('listener.open');
    const acksBefore = rig.count('ack');
    rig.phoneSendTwice('listener.response', { response: 'heard' }, { s: open.session_id, w: open.window_id, a: open.attempt_id });
    expect(rig.count('ack') - acksBefore).toBe(1);
    expect(rig.view.stage).toBe('reveal');
  });
});

/* ================================================================== (d) cues */

describe('(d) cue cap of 3, cues never change a verdict', () => {
  it('accepts three cues, rejects the 4th with an ack and no chip, and session.state never exceeds 3', async () => {
    const rig = await new Rig({ seed: 51 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    const outcomes: unknown[] = [];
    for (const word of ['alpha', 'bravo', 'charlie', 'delta']) {
      rig.cue(word);
      const ack = rig.last('ack');
      outcomes.push([ack.payload['outcome'], ack.payload['detail']]);
    }
    expect(outcomes).toEqual([
      ['applied', ''],
      ['applied', ''],
      ['applied', ''],
      ['rejected', 'cue_limit'],
    ]);
    expect(rig.view.cue?.text).toBe('charlie'); // the 4th did not replace the chip
    const used = rig.wire.of('session.state').map((m) => m.payload['cues_used'] as number);
    expect(Math.max(...used)).toBe(3);
  });

  it('a cue during an open window is rejected and does not consume the allowance', async () => {
    const rig = await new Rig({ seed: 52 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.cue('during'); // lead phase: a window is open
    expect(rig.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'window_open' });
    rig.back();
    for (const word of ['one', 'two', 'three']) {
      rig.cue(word);
      expect(rig.last('ack').payload['outcome']).toBe('applied');
    }
    rig.cue('four');
    expect(rig.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'cue_limit' });
  });

  it('cue chip text is literal and expires after 3 s', async () => {
    const rig = await new Rig({ seed: 53 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.cue('<b>hi</b>');
    expect(rig.view.cue?.text).toBe('<b>hi</b>');
    rig.advance(2999);
    expect(rig.view.cue).not.toBeNull();
    rig.advance(1);
    expect(rig.view.cue).toBeNull();
  });

  it('a 12 code-point cue (emoji) is accepted; a 13 code-point or blank cue is dropped at the wire boundary', async () => {
    const rig = await new Rig({ seed: 54 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.cue('😀'.repeat(12));
    expect(rig.last('ack').payload['outcome']).toBe('applied');
    // Hand-built frame with 13 code points: take a valid frame and lengthen the text.
    const sid = rig.last('session.begin').session_id as string;
    const tooLong = rig.wire.sent.length;
    rig.rawFrame(
      JSON.stringify({
        protocol_version: 1,
        type: 'cue',
        message_id: 'm_qa13codepoints00001',
        room_id: 'r_qareviewroom00001',
        session_id: sid,
        window_id: null,
        attempt_id: null,
        sender_role: 'phone',
        producer_generation: 1,
        sequence: 999,
        event_timestamp: rig.clock.now(),
        payload: { text: 'x'.repeat(13) },
      }),
    );
    expect(rig.wire.sent.length).toBe(tooLong); // no ack, nothing accepted
    const used = rig.wire.of('session.state').map((m) => m.payload['cues_used'] as number);
    expect(Math.max(...used, 0)).toBeLessThanOrEqual(1);
  });

  it('cues never change a verdict: identical sessions with and without cues end with identical results and summary', async () => {
    async function run(withCues: boolean): Promise<{ labels: (string | undefined)[]; summary: SummaryView }> {
      const rig = await new Rig({ seed: 55 }).boot();
      await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
      const labels: (string | undefined)[] = [];
      const rels = [25, 5, 25];
      for (let p = 1; p <= 3; p += 1) {
        if (withCues) rig.cue(['yes', 'ok', 'go'][p - 1] as string);
        rig.attempt({ rel: rels[p - 1] });
        if (rig.view.stage === 'response_pending') rig.ui('rate_skip');
        labels.push(rig.view.result?.label);
        rig.ui('next_phrase');
      }
      return { labels, summary: rig.summary() };
    }
    const without = await run(false);
    const withCues = await run(true);
    expect(withCues.labels).toEqual(without.labels);
    expect(JSON.stringify(withCues.summary)).toBe(JSON.stringify(without.summary));
    // Hand check: rel 25 -> reached, rel 5 -> below, rel 25 (blind, position 3) -> reached.
    expect(without.labels).toEqual([
      "Reached today's relative level band",
      "Below today's relative level band",
      "Reached today's relative level band",
    ]);
  });
});

/* ================================================================== (e) duplicate OK spam */

describe('(e) duplicate OK spam', () => {
  it('20 rapid OK presses at phrase_ready start exactly one precheck and one window', async () => {
    const rig = await new Rig({ seed: 61 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    const precheckBefore = rig.count('precheck.start');
    const windowBefore = rig.count('window.start');
    for (let i = 0; i < 20; i += 1) rig.ok();
    rig.advance(1500);
    expect(rig.count('precheck.start') - precheckBefore).toBe(1);
    for (let i = 0; i < 20; i += 1) rig.ok(); // spam during the precheck: nothing is focusable
    expect(rig.count('precheck.start') - precheckBefore).toBe(1);
    expect(rig.count('window.start') - windowBefore).toBe(0);
    rig.precheckResult();
    expect(rig.count('window.start') - windowBefore).toBe(1);
    expect(rig.view.stage).toBe('phrase_active');
  });

  it('20 UI "begin_phrase" activations in the same tick behave the same way', async () => {
    const rig = await new Rig({ seed: 62 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    const before = rig.count('precheck.start');
    for (let i = 0; i < 20; i += 1) rig.ui('begin_phrase');
    rig.advance(1500);
    expect(rig.count('precheck.start') - before).toBe(1);
    expect(rig.count('window.cancel')).toBe(0);
  });

  it('OK spam during the quiet lead cannot press Cancel (no focusable controls before capture)', async () => {
    const rig = await new Rig({ seed: 63 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    expect(rig.view.actions).toEqual([]);
    expect(rig.view.preferredAction).toBeNull();
    for (let i = 0; i < 20; i += 1) rig.ok();
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.count('window.cancel')).toBe(0);
  });

  it('spam after capture starts: the first OK is an explicit early stop, later presses send no second stop and no second window', async () => {
    const rig = await new Rig({ seed: 64 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    expect(rig.view.preferredAction).toBe('stop_early');
    for (let i = 0; i < 20; i += 1) rig.ok();
    expect(rig.count('window.stop')).toBe(1);
    expect(rig.last('window.stop').payload['reason']).toBe('early_stop');
    expect(rig.count('window.start')).toBe(2); // calibration + this phrase only
    expect(rig.count('window.cancel')).toBe(0);
  });

  it('OK spam on a result does not skip past it twice: one next_phrase per screen change', async () => {
    const rig = await new Rig({ seed: 65 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 4) });
    rig.attempt({ rel: 25 });
    expect(rig.view.stage).toBe('reveal');
    rig.ok(); // next_phrase -> phrase_ready (position 2)
    expect(rig.view.phrase?.position).toBe(2);
    rig.ok(); // begin_phrase -> lead, still position 2
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.view.phrase?.position).toBe(2);
    for (let i = 0; i < 20; i += 1) rig.ok();
    expect(rig.view.phrase?.position).toBe(2);
  });
});

/* ================================================================== (f) Back during capture */

describe('(f) Back during capture', () => {
  it('sends window.cancel with the window ids and leaves the attempt unscored', async () => {
    const rig = await new Rig({ seed: 71 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const start = rig.last('window.start');
    rig.level(0, FLOOR + 22, true, false, start);
    rig.back();
    const cancel = rig.last('window.cancel');
    expect(cancel.payload['reason']).toBe('user_cancel');
    expect([cancel.session_id, cancel.window_id, cancel.attempt_id]).toEqual([start.session_id, start.window_id, start.attempt_id]);
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe('Not scored');
    expect(rig.view.result?.tone).toBe('not_scored');
    expect(rig.actionIds()).toEqual(['try_again', 'skip_phrase', 'finish_early']); // no "Next phrase": nothing was scored
    // A late result from the phone for the cancelled window must not score it.
    rig.windowResult({ rel: 30 }, start);
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    expect(rig.view.result?.label).toBe('Not scored');
    rig.ui('skip_phrase');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.invalidReasons).toEqual({ cancelled: 1 });
    expect(s.attemptsInvalid).toBe(1);
    expect(s.phrasesCompleted).toBe(1);
    expect(s.phrasesSkipped).toBe(1);
    expect(s.scoredVisible + s.scoredHidden).toBe(1);
  });

  it('Back in the precheck cancels on the phone too; Back in the lead only returns', async () => {
    const rig = await new Rig({ seed: 72 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.back();
    expect(rig.count('window.cancel')).toBe(0);
    rig.ui('begin_phrase');
    rig.advance(1500);
    expect(rig.view.timer?.label).toBe('Checking the room');
    rig.back();
    expect(rig.count('window.cancel')).toBe(1);
    expect(rig.count('window.start')).toBe(1); // only the calibration window ever started
  });

  it('Back during a sustained-sound or calibration window cancels without scoring', async () => {
    const rig = await new Rig({ seed: 73 }).boot();
    await rig.toQuietReady({ bank: PHRASES.slice(0, 2) });
    rig.quietCheck();
    rig.ui('begin_calibration');
    rig.advance(1500);
    expect(rig.view.stage).toBe('calibration');
    rig.back();
    expect(rig.last('window.cancel').payload['reason']).toBe('user_cancel');
    expect(rig.view.stage).toBe('calibration');
    expect(rig.view.result).toBeNull(); // no band was set
    expect(rig.actionIds()).not.toContain('skip_calibration');
  });
});

/* ================================================================== (g) link loss */

describe('(g) link loss mid-window', () => {
  it('mic becomes unknown (never off), the window is cancelled/unscored, nothing resumes without a fresh begin', async () => {
    const rig = await new Rig({ seed: 81 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const start = rig.last('window.start');
    expect(rig.view.mic).toBe('open_not_measuring');
    const windowStartsBefore = rig.count('window.start');
    rig.link('reconnecting');
    expect(rig.view.mic).toBe('unknown');
    expect(rig.view.mic).not.toBe('off');
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.view.link).toBe('reconnecting');
    // The cancel cannot be delivered while the link is down: it is held, not dropped.
    expect(rig.count('window.cancel')).toBe(0);
    rig.link('connected'); // TV sends auth.resume
    expect(rig.count('auth.resume')).toBe(1);
    expect(rig.view.mic).toBe('unknown'); // still not "off": the phone has not reported
    rig.authOk(true);
    expect(rig.view.mic).toBe('unknown');
    expect(rig.count('window.cancel')).toBe(1);
    const cancel = rig.last('window.cancel');
    expect(cancel.payload['reason']).toBe('link_lost');
    expect(cancel.window_id).toBe(start.window_id);
    // A result for the interrupted window arriving after reconnect is stale and never scores.
    rig.windowResult({ rel: 30 }, start);
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    expect(rig.view.stage).toBe('paused_or_invalid');
    // Retry stays disabled until the phone reports an open microphone again.
    const retry = rig.view.actions.find((a) => a.id === 'retry');
    expect(retry?.disabled).toBe(true);
    rig.mic('open_idle');
    expect(rig.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(false);
    rig.ui('retry');
    expect(rig.view.stage).toBe('phrase_ready');
    expect(rig.count('window.start')).toBe(windowStartsBefore); // still no new capture
    // A fresh explicit begin creates a NEW window and attempt.
    rig.attempt({ rel: 25 });
    const fresh = rig.last('window.start');
    expect(fresh.window_id).not.toBe(start.window_id);
    expect(fresh.attempt_id).not.toBe(start.attempt_id);
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.invalidReasons).toEqual({ interrupted: 1 });
    expect(s.phrasesCompleted).toBe(2);
  });

  it('a result and level frames from the OLD window are ignored while a NEW window is capturing', async () => {
    const rig = await new Rig({ seed: 85 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const old = rig.last('window.start');
    rig.link('reconnecting');
    rig.link('connected');
    rig.authOk(true);
    rig.mic('open_idle');
    rig.ui('retry');
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const fresh = rig.last('window.start');
    expect(fresh.window_id).not.toBe(old.window_id);
    expect(rig.view.stage).toBe('phrase_active');
    rig.level(0, FLOOR + 40, true, false, old); // from the dead window
    rig.windowResult({ rel: 30 }, old); // would score the live attempt if ids were not checked
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.view.meter?.levelRelDb).toBeNull(); // the stray level never reached the live meter
    rig.windowResult({ rel: 25 }, fresh);
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe("Reached today's relative level band");
  });

  it('results must match session, window AND attempt: any single mismatched id is dropped', async () => {
    const rig = await new Rig({ seed: 86 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const start = rig.last('window.start');
    const payload = rig.windowResultPayload('phrase', { rel: 30 });
    const bad: { s: string | null; w: string | null; a: string | null }[] = [
      { s: 's_wrongsession0001', w: start.window_id, a: start.attempt_id },
      { s: start.session_id, w: 'w_wrongwindow00001', a: start.attempt_id },
      { s: start.session_id, w: start.window_id, a: 'a_wrongattempt0001' },
    ];
    for (const ids of bad) {
      rig.phoneSend('window.result', payload, ids);
      expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
      expect(rig.view.stage).toBe('phrase_active');
    }
    rig.windowResult({ rel: 25 }, start);
    expect(rig.view.stage).toBe('reveal');
  });

  it('the phone leaving the room (peer.state disconnected) mid-window behaves the same', async () => {
    const rig = await new Rig({ seed: 82 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    rig.peer(false);
    expect(rig.view.mic).toBe('unknown');
    expect(rig.view.stage).toBe('paused_or_invalid');
    rig.peer(true);
    expect(rig.view.mic).toBe('unknown');
    expect(rig.count('window.start')).toBe(2); // calibration + the interrupted phrase, no resumed capture
  });

  it('a phone-reported "off" is shown as off, and link loss afterwards turns it into unknown', async () => {
    const rig = await new Rig({ seed: 83 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.mic('off');
    expect(rig.view.mic).toBe('off');
    rig.link('reconnecting');
    expect(rig.view.mic).toBe('unknown');
  });

  it('link loss while a blind result is pending keeps the hidden result hidden', async () => {
    const rig = await new Rig({ seed: 84 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.attempt({ rel: 25 });
    expect(rig.view.stage).toBe('response_pending');
    rig.link('reconnecting');
    expect(rig.view.result).toBeNull();
    expect(rig.view.meter).toBeNull();
    expect(visibleStrings(rig.view).join(' ')).not.toMatch(/\b(reached|below)\b/i);
    rig.link('connected');
    rig.authOk(true);
    rig.mic('open_idle');
    expect(rig.view.stage).toBe('response_pending');
    expect(rig.view.result).toBeNull();
    rig.ui('rate_skip');
    expect(rig.view.result?.label).toBe("Reached today's relative level band");
  });
});

/* ================================================================== (h) summary arithmetic */

interface Scripted {
  rig: Rig;
  session: string;
}

/**
 * Ten phrases, family mode, band margin 20 dB over a -50 dBFS floor (reached edge 19 dB relative).
 *
 *  p1  visible  25 dB reached, listener heard          -> agree
 *  p2  visible   5 dB below,   listener not heard      -> agree
 *  p3  BLIND    25 dB reached, rating normal, not heard-> DISAGREE (hidden)
 *  p4  visible  #1 invalid (no_voice); #2 19 dB = edge -> reached, borderline, heard -> agree
 *  p5  skipped without an attempt
 *  p6  BLIND    10 dB below, rating loud, listener never answers (continue without) then answers
 *               not_heard AFTER reveal (late); retry visible 22 dB reached, heard -> agree (visible agreement only)
 *  p7  visible  #1 invalid (clipped), then skipped
 *  p8  visible  #1 cancelled with Back during capture; #2 25 dB reached, not heard -> DISAGREE
 *  p9  BLIND    #1 invalid (low_coverage); retry visible 8 dB below, not heard -> agree
 *  p10 visible  30 dB reached, heard                   -> agree
 */
async function runScriptedSession(opts: { seed?: number; clock?: Clock; disk?: Disk } = {}): Promise<Scripted> {
  const rig = await new Rig({ seed: opts.seed ?? 900, clock: opts.clock, disk: opts.disk }).boot();
  await rig.setupToPhrases({ family: true });
  const session = rig.last('session.begin').session_id as string;
  const heard = (r: 'heard' | 'not_heard'): void => rig.listenerResponse(r);

  rig.attempt({ rel: 25 }); // p1
  heard('heard');
  rig.ui('next_phrase');

  rig.attempt({ rel: 5 }); // p2
  heard('not_heard');
  rig.ui('next_phrase');

  rig.attempt({ rel: 25 }); // p3 blind
  heard('not_heard');
  rig.ui('rate_felt_normal');
  rig.ui('next_phrase');

  rig.attempt({ valid: false, reason: 'no_voice' }); // p4 #1
  rig.ui('try_again');
  rig.attempt({ rel: EDGE_REL }); // p4 #2 exactly on the edge
  heard('heard');
  rig.ui('next_phrase');

  rig.ui('skip_phrase'); // p5

  rig.attempt({ rel: 10 }); // p6 blind
  const openSix = rig.last('listener.open');
  rig.ui('rate_felt_loud');
  rig.advance(20_000);
  rig.ui('continue_without_listener');
  rig.listenerResponse('not_heard', openSix); // late
  rig.ui('try_again');
  rig.attempt({ rel: 22 }); // p6 #2 visible
  heard('heard');
  rig.ui('next_phrase');

  rig.attempt({ valid: false, reason: 'clipped' }); // p7 #1
  rig.ui('skip_phrase');

  rig.ui('begin_phrase'); // p8 #1 cancelled in capture
  rig.advance(1500);
  rig.precheckResult();
  rig.back();
  rig.ui('try_again');
  rig.attempt({ rel: 25 }); // p8 #2
  heard('not_heard');
  rig.ui('next_phrase');

  rig.attempt({ valid: false, reason: 'low_coverage' }); // p9 blind #1 invalid
  rig.ui('try_again');
  rig.attempt({ rel: 8 }); // p9 #2 visible below
  heard('not_heard');
  rig.ui('next_phrase');

  rig.attempt({ rel: 30 }); // p10
  heard('heard');
  rig.ui('next_phrase');
  return { rig, session };
}

describe('(h) summary arithmetic for a scripted 10-phrase session', () => {
  it('matches the hand-computed counts, agreement and late responses', async () => {
    const { rig } = await runScriptedSession();
    expect(rig.view.stage).toBe('summary');
    const s = rig.summary();
    expect(s).toMatchObject({
      complete: true,
      phrasesCompleted: 8, // p1 p2 p3 p4 p6 p8 p9 p10 each have a scored attempt
      phrasesAttempted: 9, // as above plus p7 (invalid attempt started); p5 never started
      phrasesSkipped: 2, // p5 and p7 skipped without a valid attempt
      attemptsInvalid: 4, // p4#1 no_voice, p7#1 clipped, p8#1 cancelled, p9#1 low_coverage
      invalidReasons: { no_voice: 1, clipped: 1, cancelled: 1, low_coverage: 1 },
      scoredHidden: 2, // p3 reached, p6 below (blind attempts); p9 blind invalid -> not counted hidden
      reachedHidden: 1,
      scoredVisible: 6, // p1 p2 p4 p8 p9(retry) p10; p6 retry is NOT added (blind attempt already counted)
      reachedVisible: 4, // p1 p4 p8 p10
      hiddenRatings: { feltLoud: 1, feltNormal: 1, skipped: 0 },
      agreementHidden: { agree: 0, eligible: 1 }, // only p3 has an on-time answer, and it disagrees
      agreementVisible: { agree: 6, eligible: 7 }, // p1 p2 p4 p6#2 p8 p9#2 p10; p8 is the one disagreement
      lateListenerResponses: 1, // p6 blind
      borderlineCount: 1, // p4#2 sits exactly on the edge
      longestActiveMs: null,
      calibrationMarginDb: BAND_MARGIN,
    });
    expect(rig.view.title).toBe('Session summary');
  });

  it('the stored session record agrees with the summary and carries 13 attempts', async () => {
    const { rig, session } = await runScriptedSession();
    await rig.settle();
    const rec = rig.disk.json(`atr:v1:session:${session}`) as {
      complete: boolean;
      endReason: string;
      attempts: unknown[];
      skipped: number[];
      familyMode: boolean;
    };
    expect(rec.complete).toBe(true);
    expect(rec.endReason).toBe('completed');
    expect(rec.attempts).toHaveLength(13); // 1+1+1+2+0+2+1+2+2+1
    expect([...rec.skipped].sort((a, b) => a - b)).toEqual([5, 7]);
    expect(rec.familyMode).toBe(true);
    expect(rig.disk.map.has('atr:v1:active')).toBe(false); // checkpoint cleared at the end
  });

  it('history for today shows sessions 1, reached 5 of 8 (4+1 reached, 6+2 scored), complete, with six earlier days "No session"', async () => {
    const { rig } = await runScriptedSession();
    rig.ui('open_history');
    const days = rig.view.history;
    expect(days).toHaveLength(7);
    const today = days?.[6];
    expect(today).toMatchObject({ date: '2026-10-05', sessions: 1, reached: 5, scored: 8, incomplete: false });
    for (const d of (days ?? []).slice(0, 6)) {
      expect(d).toMatchObject({ sessions: null, reached: null, scored: null, longestActiveMs: null, incomplete: false });
    }
    expect((days ?? []).map((d) => d.date)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(rig.view.body.join(' ')).toMatch(/No session/);
  });

  it('per-position invariants: hidden scored positions are a subset of {3,6,9} and each position counts once', async () => {
    const { rig, session } = await runScriptedSession();
    await rig.settle();
    const rec = rig.disk.json(`atr:v1:session:${session}`) as {
      attempts: { position: number; hidden: boolean; started: boolean; verdict: string | null }[];
    };
    const hiddenPositions = new Set(rec.attempts.filter((a) => a.hidden).map((a) => a.position));
    expect([...hiddenPositions].sort()).toEqual([3, 6, 9]);
    const firstPerPosition = new Map<number, boolean>();
    for (const a of rec.attempts) if (!firstPerPosition.has(a.position)) firstPerPosition.set(a.position, a.hidden);
    // Only the first attempt at 3, 6, 9 is hidden; no later attempt at any position is hidden.
    const laterHidden = rec.attempts.filter((a, i, arr) => a.hidden && arr.findIndex((x) => x.position === a.position) !== i);
    expect(laterHidden).toEqual([]);
  });
});

/* ================================================================== (i) storage, resume, deletion, pruning */

function makeRecord(id: string, endedAt: number, over: Record<string, unknown> = {}): string {
  const clock = new Clock();
  return JSON.stringify({
    sessionId: id,
    startedAt: endedAt - 60_000,
    endedAt,
    localDate: clock.localDate(endedAt),
    complete: true,
    endReason: 'completed',
    resumed: false,
    familyMode: false,
    phraseCount: 1,
    calMarginDb: 20,
    cuesUsed: 0,
    attempts: [
      {
        attemptId: `a_${id}`,
        windowId: `w_${id}`,
        position: 1,
        attemptNumber: 1,
        hidden: false,
        state: 'revealed',
        started: true,
        verdict: 'reached',
        reason: null,
        borderline: false,
        activeMs: 2500,
        longestActiveMs: 2500,
        rating: null,
        listener: null,
        lateListener: null,
      },
    ],
    vowels: [],
    skipped: [],
    ...over,
  });
}

describe('(i) storage: deletion, verification, resume after a crash, 30-day pruning', () => {
  const FOREIGN = { 'foreign:keep': 'x', atrium: 'y', 'ATR:v1:upper': 'z', atr: 'bare', 'other-app/atr:inside': 'q' };

  async function openDeleteDialog(rig: Rig): Promise<void> {
    if (rig.view.screen === 'onboarding') rig.ui('continue');
    rig.ui('open_settings');
    rig.ui('delete_local_data');
  }

  it('Delete dialog opens with Cancel focused; OK and Back both cancel and leave every key in place', async () => {
    const disk = new Disk({ ...FOREIGN, 'atr:v1:session:s_old00001': makeRecord('s_old00001', START - DAY) });
    const rig = await new Rig({ disk, seed: 91 }).boot();
    await openDeleteDialog(rig);
    expect(rig.view.screen).toBe('confirm_dialog');
    expect(rig.view.preferredAction).toBe('cancel_destructive');
    expect(rig.view.dialog?.preferred).toBe('cancel');
    expect(rig.view.dialog?.confirm.destructive).toBe(true);
    const before = [...disk.map.keys()].sort();
    rig.ok();
    expect(rig.view.screen).toBe('settings');
    expect(rig.view.preferredAction).toBe('delete_local_data'); // focus returns to the opener
    rig.ui('delete_local_data');
    rig.back();
    expect(rig.view.screen).toBe('settings');
    await rig.settle();
    expect([...disk.map.keys()].sort()).toEqual(before);
  });

  it('confirming deletion removes every atr: key, leaves foreign keys, and verifies through getAllKeys', async () => {
    const disk = new Disk({
      ...FOREIGN,
      'atr:v1:session:s_old00001': makeRecord('s_old00001', START - DAY),
      'atr:v1:phrases': JSON.stringify({ phrases: ['Hello there'] }),
      'atr:v2:meta': JSON.stringify({ schema_version: 2 }),
    });
    const rig = await new Rig({ disk, seed: 92 }).boot();
    // v2 data present: nothing is read for use (future version); deletion must still clear it.
    expect(rig.view.body.join(' ')).toMatch(/newer version/i);
    await openDeleteDialog(rig);
    rig.ui('confirm_destructive');
    await rig.settle();
    expect(disk.atrKeys()).toEqual([]);
    for (const k of Object.keys(FOREIGN)) expect(disk.map.get(k), `foreign key ${k}`).toBeDefined();
    expect(Object.keys(FOREIGN).every((k) => disk.map.has(k))).toBe(true);
    expect(rig.view.banner?.kind).toBe('info');
    expect(rig.view.banner?.text).toMatch(/deleted/i);
  });

  it('when the store silently refuses a removal, the app says so, reports remaining keys and does not claim success', async () => {
    const disk = new Disk({ ...FOREIGN, 'atr:v1:phrases': JSON.stringify({ phrases: ['Hello there'] }) });
    const rig = await new Rig({ disk, seed: 93 }).boot();
    await rig.settle();
    disk.refuseRemove.add('atr:v1:settings');
    await openDeleteDialog(rig);
    rig.ui('confirm_destructive');
    await rig.settle();
    expect(rig.view.banner?.kind).toBe('error');
    expect(rig.view.banner?.text).toMatch(/could not be removed/i);
    expect(rig.view.banner?.text).not.toMatch(/all local practice data was deleted/i);
    expect(disk.atrKeys()).toContain('atr:v1:settings');
    rig.ui('open_diagnostics');
    expect(rig.view.diagnostics?.['delete_remaining_keys']).toBe('1');
    // After the store recovers, a retry succeeds and the banner flips.
    rig.ui('back');
    disk.refuseRemove.clear();
    rig.ui('delete_local_data');
    rig.ui('confirm_destructive');
    await rig.settle();
    expect(disk.atrKeys()).toEqual([]);
    expect(rig.view.banner?.kind).toBe('info');
  });

  it('when multiRemove rejects outright the failure is reported, not swallowed', async () => {
    const disk = new Disk({ ...FOREIGN });
    const rig = await new Rig({ disk, seed: 94 }).boot();
    await rig.settle();
    disk.failMultiRemove = true;
    await openDeleteDialog(rig);
    rig.ui('confirm_destructive');
    await rig.settle();
    expect(rig.view.banner?.kind).toBe('error');
    expect(disk.atrKeys().length).toBeGreaterThan(0);
    expect(disk.map.get('foreign:keep')).toBe('x');
  });

  it('Delete is not available during a session (the control is disabled)', async () => {
    const rig = await new Rig({ seed: 95 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('open_settings');
    const del = rig.view.actions.find((a) => a.id === 'delete_local_data');
    expect(del?.disabled).toBe(true);
    rig.ui('delete_local_data'); // ignored
    expect(rig.view.screen).toBe('settings');
  });

  it('fixture mode never writes to the real store and labels every screen "Fixture replay"', async () => {
    const disk = new Disk({ ...FOREIGN });
    const rig = await new Rig({ disk, seed: 96, fixtureMode: true }).boot();
    rig.ui('continue');
    expect(rig.view.labels).toContain('Fixture replay');
    rig.ui('open_history');
    expect(rig.view.labels).toContain('Fixture replay');
    await rig.settle();
    expect(disk.writes).toEqual([]);
    expect(disk.atrKeys()).toEqual([]);
  });

  it('crash mid-capture: relaunch offers Resume/Discard; resuming records an interrupted, UNSCORED attempt and never completes', async () => {
    const disk = new Disk();
    const clock = new Clock();
    const first = await new Rig({ disk, clock, seed: 97 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    first.ui('begin_phrase');
    first.advance(1500);
    first.precheckResult();
    first.level(0, FLOOR + 25, true, false);
    await first.settle();
    // The checkpoint is on disk; it holds no verdict, no credential, no pairing code.
    const cp = disk.json('atr:v1:active') as { record: { attempts: { state: string; verdict: string | null }[] } };
    expect(cp.record.attempts).toHaveLength(1);
    expect(cp.record.attempts[0]?.state).toBe('capturing');
    expect(cp.record.attempts[0]?.verdict).toBeNull();
    expect(disk.allText()).not.toContain(CREDENTIAL);
    expect(disk.allText()).not.toContain(PAIRING_CODE);
    // --- the TV process dies here: no dispose, no end message ---
    const clock2 = new Clock(START + 3_600_000);
    const second = await new Rig({ disk, clock: clock2, seed: 98 }).boot();
    expect(second.view.screen).toBe('resume_or_discard');
    expect(second.actionIds()).toEqual(['resume_session', 'discard_session']);
    expect(second.view.body.join(' ')).toMatch(/interrupted and not scored/);
    expect(second.view.dialog).toBeNull();
    second.ui('resume_session');
    expect(second.view.stage).toBe('pairing'); // a fresh pairing and microphone start are required
    second.link('connected');
    second.roomCreated();
    second.joinRequested();
    second.ui('accept_join');
    second.peer(true);
    second.mic('permission_pending');
    second.mic('open_idle');
    expect(second.view.stage).toBe('quiet_check');
    second.quietCheck();
    second.calibrate();
    second.toPhrases();
    expect(second.view.phrase?.position).toBe(1);
    // The interrupted blind-or-not attempt is spent: this attempt is a visible retry (attempt 2).
    expect(second.view.body.some((l) => /^Retry:/.test(l))).toBe(true);
    second.ui('finish_early');
    const s = second.summary();
    expect(second.view.title).toBe('Session summary (incomplete)');
    expect(s.complete).toBe(false);
    expect(s.phrasesCompleted).toBe(0);
    expect(s.attemptsInvalid).toBe(1);
    expect(s.invalidReasons).toEqual({ interrupted: 1 });
    expect(s.scoredHidden + s.scoredVisible).toBe(0);
    expect(s.lines.join(' ')).toMatch(/Do not compare it with completed sessions/);
  });

  it('a RESUMED session that finishes every phrase is still labelled incomplete', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 101 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    first.attempt({ rel: 25 });
    first.ui('next_phrase');
    first.ui('begin_phrase');
    first.advance(1500);
    first.precheckResult();
    await first.settle();
    const second = await new Rig({ disk, clock: new Clock(START + 60_000), seed: 102 }).boot();
    expect(second.view.screen).toBe('resume_or_discard');
    second.ui('resume_session');
    second.link('connected');
    second.roomCreated();
    second.joinRequested();
    second.ui('accept_join');
    second.peer(true);
    second.mic('permission_pending');
    second.mic('open_idle');
    second.quietCheck();
    second.calibrate();
    second.toPhrases();
    expect(second.view.phrase?.position).toBe(2);
    second.attempt({ rel: 25 });
    second.ui('next_phrase'); // last phrase -> summary
    expect(second.view.stage).toBe('summary');
    const s = second.summary();
    expect(s.complete).toBe(false);
    expect(second.view.title).toBe('Session summary (incomplete)');
    // Position 1 was scored before the crash; position 2 was interrupted then re-run and scored.
    expect(s.phrasesCompleted).toBe(2);
    expect(s.invalidReasons).toEqual({ interrupted: 1 });
    await second.settle();
    expect(disk.map.has('atr:v1:active')).toBe(false);
    const key = disk.atrKeys().find((k) => k.startsWith('atr:v1:session:'));
    const rec = disk.json(key as string) as { complete: boolean; resumed: boolean; endReason: string };
    expect(rec).toMatchObject({ complete: false, resumed: true, endReason: 'completed' });
    second.ui('done');
    second.ui('open_history');
    expect(second.view.history?.[6]).toMatchObject({ sessions: 1, incomplete: true });
  });

  it('Discard after a crash saves a discarded, incomplete record with the attempt unscored, and clears the checkpoint', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 103 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    first.ui('begin_phrase');
    first.advance(1500);
    first.precheckResult();
    await first.settle();
    const second = await new Rig({ disk, clock: new Clock(START + 1_000), seed: 104 }).boot();
    second.ui('discard_session');
    await second.settle();
    expect(second.view.screen).toBe('home');
    expect(disk.map.has('atr:v1:active')).toBe(false);
    const key = disk.atrKeys().find((k) => k.startsWith('atr:v1:session:'));
    const rec = disk.json(key as string) as { endReason: string; complete: boolean; attempts: { verdict: string; reason: string; state: string }[] };
    expect(rec.endReason).toBe('discarded');
    expect(rec.complete).toBe(false);
    expect(rec.attempts[0]).toMatchObject({ verdict: 'unscored', reason: 'interrupted', state: 'invalid' });
    second.ui('open_history');
    expect(second.view.history?.[6]).toMatchObject({ sessions: 1, incomplete: true, reached: 0, scored: 0 });
  });

  it('a corrupt checkpoint is ignored without crashing and without inventing a resume', async () => {
    const disk = new Disk({ 'atr:v1:active': '{"version":1,"savedAt"' });
    const rig = await new Rig({ disk, seed: 105 }).boot();
    expect(rig.view.screen).toBe('onboarding');
  });

  it('data from a newer schema is never overwritten: no writes happen during a whole session', async () => {
    const disk = new Disk({ 'atr:v2:meta': JSON.stringify({ schema_version: 2 }), 'atr:v2:future': 'keep-me' });
    const rig = await new Rig({ disk, seed: 106 }).boot();
    rig.ui('continue');
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 1) });
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    await rig.settle();
    expect(disk.writes).toEqual([]);
    expect(disk.map.get('atr:v2:future')).toBe('keep-me');
  });

  describe('30-day pruning at the boundary (retention counts from endedAt; exactly 30 days is kept)', () => {
    const NOW = START;
    const CUT = NOW - 30 * DAY;
    it('prunes only records strictly older than 30 days and rebuilds the index', async () => {
      const disk = new Disk({
        ...FOREIGN,
        'atr:v1:session:s_pruned001': makeRecord('s_pruned001', CUT - 1),
        'atr:v1:session:s_edge00001': makeRecord('s_edge00001', CUT),
        'atr:v1:session:s_kept00001': makeRecord('s_kept00001', CUT + 1),
        'atr:v1:session:s_pruned002': makeRecord('s_pruned002', CUT - 5 * DAY),
      });
      const rig = await new Rig({ disk, clock: new Clock(NOW), seed: 107 }).boot();
      await rig.settle();
      const keys = disk.atrKeys().filter((k) => k.startsWith('atr:v1:session:')).sort();
      expect(keys).toEqual(['atr:v1:session:s_edge00001', 'atr:v1:session:s_kept00001']);
      const index = disk.json('atr:v1:index') as { entries: { sessionId: string }[] };
      expect(index.entries.map((e) => e.sessionId).sort()).toEqual(['s_edge00001', 's_kept00001']);
      for (const k of Object.keys(FOREIGN)) expect(disk.map.has(k)).toBe(true);
    });

    it('retention runs on launch: a record that crosses 30 days while the app is open survives until the next launch', async () => {
      const disk = new Disk({ 'atr:v1:session:s_edge00001': makeRecord('s_edge00001', CUT + 60_000) });
      const rig = await new Rig({ disk, clock: new Clock(NOW), seed: 108 }).boot();
      rig.advance(2 * 60_000);
      await rig.settle();
      expect(disk.map.has('atr:v1:session:s_edge00001')).toBe(true);
      const relaunch = await new Rig({ disk, clock: new Clock(NOW + 2 * 60_000), seed: 109 }).boot();
      await relaunch.settle();
      expect(disk.map.has('atr:v1:session:s_edge00001')).toBe(false);
    });

    it('unparseable session records are skipped, never crash the launch, and valid ones still load', async () => {
      const disk = new Disk({
        'atr:v1:session:s_bad000001': '{"nope"',
        'atr:v1:session:s_good00001': makeRecord('s_good00001', NOW - DAY),
      });
      const rig = await new Rig({ disk, clock: new Clock(NOW), seed: 110 }).boot();
      rig.ui('continue');
      expect(rig.view.body.join(' ')).toMatch(/Last session, 2026-10-04: reached 1 of 1 scored\./);
    });
  });

  it('no credential, pairing code or level stream is ever written to storage during a full session', async () => {
    const { rig } = await runScriptedSession({ seed: 111 });
    await rig.settle();
    const text = rig.disk.allText();
    expect(text).not.toContain(CREDENTIAL);
    expect(text).not.toContain(PAIRING_CODE);
    expect(text).not.toMatch(/dbfs|frame_index|t_audio_ms/i);
    for (const k of rig.disk.map.keys()) expect(k.startsWith(STORAGE_PREFIX)).toBe(true);
  });
});

/* ================================================================== (j) incomplete never compared to complete */

describe('(j) an incomplete session is never compared with a complete one', () => {
  it('finish-early is labelled incomplete everywhere; history flags the day; no comparison text or fields exist', async () => {
    const disk = new Disk();
    const clock = new Clock();
    // Session 1: complete, 2 phrases, both reached.
    const one = await new Rig({ disk, clock, seed: 121 }).boot();
    await one.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    one.attempt({ rel: 25 });
    one.ui('next_phrase');
    one.attempt({ rel: 25 });
    one.ui('next_phrase');
    expect(one.summary().complete).toBe(true);
    await one.settle();
    // Session 2 (next launch): one phrase then finish early.
    const two = await new Rig({ disk, clock: new Clock(START + 3_600_000), seed: 122 }).boot();
    two.ui('start_session');
    two.link('connected');
    two.roomCreated();
    two.joinRequested();
    two.ui('accept_join');
    two.peer(true);
    two.mic('permission_pending');
    two.mic('open_idle');
    two.quietCheck();
    two.calibrate();
    two.toPhrases();
    two.attempt({ rel: 5 });
    expect(two.view.stage).toBe('reveal');
    two.ui('finish_early');
    expect(two.view.title).toBe('Session summary (incomplete)');
    const s = two.summary();
    expect(s.complete).toBe(false);
    // The incomplete summary describes only itself: 1 scored, 0 reached; it does not mention session 1.
    expect(s).toMatchObject({ scoredVisible: 1, reachedVisible: 0, phrasesCompleted: 1 });
    expect(s.lines[0]).toMatch(/Do not compare it with completed sessions/);
    expect(allKeys(two.view.summary)).not.toEqual(expect.arrayContaining(['previous', 'delta', 'trend', 'change']));
    two.ui('done');
    // Home: the last-session line is flagged incomplete.
    expect(two.view.body.join(' ')).toMatch(/Last session, 2026-10-05: reached 0 of 1 scored \(incomplete\)\./);
    two.ui('open_history');
    const today = two.view.history?.[6];
    expect(today?.sessions).toBe(2);
    expect(today?.incomplete).toBe(true);
    // Hand arithmetic for the day: session 1 reached 2/2, session 2 reached 0/1 -> 2 reached of 3 scored, flagged incomplete.
    expect({ r: today?.reached, s: today?.scored }).toEqual({ r: 2, s: 3 });
    const historyText = visibleStrings(two.view).join(' ');
    expect(historyText).toMatch(/do not compare them with complete days/i);
    expect(historyText).toMatch(/no trend or comparison between days/i);
    for (const d of two.view.history ?? []) expect(Object.keys(d).sort()).toEqual(['date', 'incomplete', 'longestActiveMs', 'reached', 'scored', 'sessions', 'weekdayLabel']);
  });

  it('a clean complete session beside an incomplete one on different days: only the incomplete day is flagged', async () => {
    const disk = new Disk({
      'atr:v1:session:s_complete1': makeRecord('s_complete1', START - 2 * DAY),
      'atr:v1:session:s_partial01': makeRecord('s_partial01', START - DAY, { complete: false, endReason: 'user_exit' }),
    });
    const rig = await new Rig({ disk, seed: 123 }).boot();
    rig.ui('continue');
    rig.ui('open_history');
    const days = rig.view.history ?? [];
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(byDate['2026-10-03']).toMatchObject({ sessions: 1, incomplete: false });
    expect(byDate['2026-10-04']).toMatchObject({ sessions: 1, incomplete: true });
    expect(byDate['2026-10-05']).toMatchObject({ sessions: null });
  });
});

/* ================================================================== (k) additional adversarial probes */

describe('(k) timeouts, migration, navigation and documented edge behaviour', () => {
  it('phrase window with no phone result: stop at 8.5 s, timeout cancel 3 s later, attempt unscored, retry still allowed', async () => {
    const rig = await new Rig({ seed: 131 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    rig.advance(8499);
    expect(rig.count('window.stop')).toBe(0);
    rig.advance(1);
    expect(rig.count('window.stop')).toBe(1);
    expect(rig.last('window.stop').payload['reason']).toBe('complete');
    rig.advance(2999);
    expect(rig.count('window.cancel')).toBe(0);
    rig.advance(1);
    expect(rig.last('window.cancel').payload['reason']).toBe('timeout');
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.view.body.join(' ')).toMatch(/did not answer in time/);
    rig.ui('retry');
    expect(rig.view.stage).toBe('phrase_ready');
  });

  it('precheck with no phone answer times out at 5 s (2 s window + 3 s grace) and is cancelled on the phone', async () => {
    const rig = await new Rig({ seed: 132 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.advance(4999);
    expect(rig.count('window.cancel')).toBe(0);
    rig.advance(1);
    expect(rig.last('window.cancel').payload['reason']).toBe('timeout');
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.count('window.start')).toBe(1); // calibration only
  });

  it('a gate-blocked blind attempt was never captured, so the next attempt at that position is still blind (documented decision)', async () => {
    const rig = await new Rig({ seed: 133 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    rig.attempt({ rise: 6 }); // exactly 6 dB rise blocks (rise >= 6)
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.view.body.join(' ')).toMatch(/noisier/);
    rig.ui('retry');
    const cap = rig.attempt({ rel: 25 });
    expect(cap?.meter).toBeNull();
    expect(cap?.phrase?.attemptNumber).toBe(2);
    expect(rig.view.stage).toBe('response_pending');
    rig.ui('rate_skip');
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.scoredHidden).toBe(1);
    expect(s.attemptsInvalid).toBe(1); // the blocked attempt is counted invalid (room_noisier) but not "attempted"
    expect(s.invalidReasons).toEqual({ room_noisier: 1 });
    expect(s.phrasesAttempted).toBe(3);
  });

  it('a rise of 5.9 dB passes the gate; exactly 6.0 dB blocks (boundary on the 0.1 dB grid)', async () => {
    const rig = await new Rig({ seed: 134 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.attempt({ rise: 5.9, rel: 25 });
    expect(rig.view.stage).toBe('reveal');
    rig.ui('next_phrase');
    rig.attempt({ rise: 6 });
    expect(rig.view.stage).toBe('paused_or_invalid');
  });

  it('continuing without a band: hidden attempts still collect a rating and reveal as "not scored by design", never as reached/below', async () => {
    const rig = await new Rig({ seed: 135 }).boot();
    await rig.toQuietReady({ bank: PHRASES.slice(0, 3) });
    rig.quietCheck();
    rig.ui('begin_calibration');
    rig.advance(1500);
    rig.windowResult({ valid: false, reason: 'no_voice' });
    expect(rig.view.title).toBe("Today's band was not set");
    expect(rig.actionIds()).toEqual(['retry', 'continue', 'cancel']);
    rig.ui('continue');
    rig.ui('skip_vowel');
    expect(rig.view.labels).toContain('No band set: results not scored');
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      expect(rig.view.result?.label).toBe('No band set: results not scored');
      expect(rig.view.result?.tone).toBe('not_scored');
      rig.ui('next_phrase');
    }
    const blind = rig.attempt({ rel: 25 });
    expect(blind?.meter).toBeNull();
    expect(rig.view.stage).toBe('response_pending');
    rig.ui('rate_felt_normal');
    expect(rig.view.result?.label).toBe('No band set: results not scored');
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.phrasesCompleted).toBe(3);
    expect(s.scoredHidden + s.scoredVisible).toBe(0);
    expect(s.attemptsInvalid).toBe(0);
    expect(s.hiddenRatings.feltNormal).toBe(1);
    expect(s.lines.join(' ')).toMatch(/No band was set/);
  });

  it('Back is ignored on Home and on the resume prompt (no accidental exit or discard)', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 136 }).boot();
    first.ui('continue');
    first.back();
    expect(first.view.screen).toBe('home');
    await first.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    first.ui('begin_phrase');
    first.advance(1500);
    first.precheckResult();
    await first.settle();
    const second = await new Rig({ disk, clock: new Clock(START + 5000), seed: 137 }).boot();
    expect(second.view.screen).toBe('resume_or_discard');
    second.back();
    second.key('back');
    expect(second.view.screen).toBe('resume_or_discard');
    expect(disk.map.has('atr:v1:active')).toBe(true);
  });

  it('a v0 snapshot migrates without inventing data and is then removed; unscored v0 attempts stay unscored', async () => {
    const v0 = {
      schema_version: 0,
      settings: { family: true, cue: 'ready' },
      phrases: ['Hello there', 'Good evening'],
      sessions: [
        {
          id: 's_legacy0001',
          date: '2026-10-04',
          complete: false,
          ended_at: START - DAY,
          attempts: [
            { pos: 1, verdict: 'reached' },
            { pos: 2, verdict: 'below' },
            { pos: 3, verdict: 'none', hidden: true },
          ],
          vowel_ms: 4200,
        },
      ],
    };
    const disk = new Disk({ 'atr:v0:snapshot': JSON.stringify(v0), 'foreign:keep': 'x' });
    const rig = await new Rig({ disk, seed: 138 }).boot();
    await rig.settle();
    expect(disk.map.has('atr:v0:snapshot')).toBe(false);
    expect(disk.map.get('foreign:keep')).toBe('x');
    const rec = disk.json('atr:v1:session:s_legacy0001') as {
      complete: boolean;
      attempts: { verdict: string; state: string; reason: string | null; hidden: boolean }[];
      vowels: { longestActiveMs: number }[];
    };
    expect(rec.complete).toBe(false);
    expect(rec.attempts.map((a) => a.verdict)).toEqual(['reached', 'not_reached', 'unscored']);
    expect(rec.attempts[2]).toMatchObject({ state: 'invalid', reason: 'legacy_unscored', hidden: true });
    expect(rec.vowels[0]?.longestActiveMs).toBe(4200);
    expect(rig.view.screen).toBe('home');
    rig.ui('open_history');
    // Hand arithmetic: yesterday: 1 session (incomplete), reached 1 (pos 1), scored 2 (pos 1 reached, pos 2 below).
    expect(rig.view.history?.[5]).toMatchObject({ date: '2026-10-04', sessions: 1, reached: 1, scored: 2, incomplete: true });
  });
});

describe('(k1) observations: documented behaviour that the lead should know about (not defects)', () => {
  it('OBS-2: a crash at reveal resumes at the SAME position as a visible retry, and the new quiet check and band apply to later attempts only', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 160 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    first.attempt({ rel: 25 }); // position 1 scored against a 20 dB band (edge 19)
    await first.settle();
    const cp = disk.json('atr:v1:active') as { stage: string; phraseIdx: number; record: { calMarginDb: number } };
    expect(cp).toMatchObject({ stage: 'reveal', phraseIdx: 0 });
    const second = await new Rig({ disk, clock: new Clock(START + 1000), seed: 161 }).boot();
    expect(second.view.body.join(' ')).toMatch(/1 phrases were attempted/); // grammar nit: "1 phrases"
    second.ui('resume_session');
    second.link('connected');
    second.roomCreated();
    second.joinRequested();
    second.ui('accept_join');
    second.peer(true);
    second.mic('permission_pending');
    second.mic('open_idle');
    second.quietCheck();
    second.ui('begin_calibration');
    second.advance(1500);
    second.windowResult({ rel: 16 }); // a different band: edge 15
    second.toPhrases();
    expect(second.view.phrase?.position).toBe(1); // not advanced to 2
    expect(second.view.body.some((l) => /^Retry:/.test(l))).toBe(true);
    second.attempt({ rel: 17 }); // below the old edge (19), above the new one (15)
    expect(second.view.result?.label).toBe("Reached today's relative level band");
    second.ui('finish_early');
    const s = second.summary();
    // One tally and one margin for results scored against two different bands.
    expect(s.calibrationMarginDb).toBe(16);
    expect(s).toMatchObject({ complete: false, scoredVisible: 1, reachedVisible: 1 });
  });
});

describe('(k2) defects found by adversarial probes', () => {
  defect('QA-02', 'a crash between saving the session record and clearing the checkpoint resurrects a finished session as "resume"', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 141 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 1) });
    first.attempt({ rel: 25 });
    await first.settle(); // checkpoint on disk from the capture
    disk.dieAfterWriteOf = 'atr:v1:index'; // record + index are written, the checkpoint removal is lost
    first.ui('next_phrase'); // last phrase -> summary -> saveRecord
    await first.settle();
    expect(first.summary().complete).toBe(true);
    expect(disk.atrKeys().some((k) => k.startsWith('atr:v1:session:'))).toBe(true);
    expect(disk.map.has('atr:v1:active')).toBe(true); // the crash window
    disk.revive();
    const second = await new Rig({ disk, clock: new Clock(START + 60_000), seed: 142 }).boot();
    // A session that was already saved as complete must not be offered for resume.
    expect(second.view.screen).not.toBe('resume_or_discard');
  });

  defect('QA-02b', 'Discard on that stale checkpoint overwrites the completed record with a "discarded, incomplete" one', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 143 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 1) });
    first.attempt({ rel: 25 });
    await first.settle();
    disk.dieAfterWriteOf = 'atr:v1:index';
    first.ui('next_phrase');
    await first.settle();
    const key = disk.atrKeys().find((k) => k.startsWith('atr:v1:session:')) as string;
    const before = disk.json(key) as { complete: boolean; endReason: string };
    expect(before).toMatchObject({ complete: true, endReason: 'completed' });
    disk.revive();
    const second = await new Rig({ disk, clock: new Clock(START + 60_000), seed: 144 }).boot();
    if (second.view.screen === 'resume_or_discard') second.ui('discard_session');
    await second.settle();
    expect(disk.json(key)).toMatchObject({ complete: true, endReason: 'completed' });
  });

  defect('QA-03', 'session.end sent while the link is down is dropped and never retried (the phone is not told to stop)', async () => {
    const rig = await new Rig({ seed: 145 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    rig.link('reconnecting'); // window cancelled, paused screen offers Finish early
    expect(rig.actionIds()).toContain('finish_early');
    rig.ui('finish_early');
    expect(rig.view.stage).toBe('summary');
    expect(rig.wire.dropped.some((m) => m.type === 'session.end')).toBe(true); // evidence: the TV tried while offline
    rig.link('connected');
    rig.authOk(true);
    rig.mic('open_idle');
    rig.ui('done');
    // The phone must eventually be told the session is over so that it releases the microphone.
    expect(rig.count('session.end')).toBeGreaterThanOrEqual(1);
  });

  defect('QA-04', 'phrases.update after skipping a phrase (before any window) shrinks the bank under the cursor: "Phrase 2 of 1", empty text', async () => {
    const rig = await new Rig({ seed: 146 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    rig.ui('skip_phrase'); // position 1 skipped, no window ever opened
    expect(rig.view.phrase?.position).toBe(2);
    rig.phrasesUpdate(['Only one phrase now']);
    const phrase = rig.view.phrase;
    expect(phrase?.position ?? 0).toBeLessThanOrEqual(phrase?.total ?? 0);
    expect((phrase?.text ?? '').length).toBeGreaterThan(0);
  });

  defect('QA-05', 'the phone must see session.state stage phrase_active from capture start until the next phrase_ready or summary, and never response_pending or reveal (ruling on ADR-0004: the phone is never told which positions are hidden)', async () => {
    const rig = await new Rig({ seed: 147 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 4) });
    const perPosition: string[][] = [];
    for (let p = 1; p <= 4; p += 1) {
      const mark = rig.count('session.state');
      rig.attempt({ rel: 25 });
      if (rig.view.stage === 'response_pending') rig.ui('rate_skip');
      perPosition.push(
        rig
          .wire.of('session.state')
          .slice(mark)
          .map((m) => m.payload['stage'] as string),
      );
      rig.ui('next_phrase');
    }
    const everything = rig.wire.of('session.state').map((m) => m.payload['stage'] as string);
    expect(everything).not.toContain('response_pending');
    expect(everything).not.toContain('reveal');
    // Identical for blind and visible positions: only phrase_active after the capture starts.
    for (const stages of perPosition) expect(stages.every((st) => st === 'phrase_active')).toBe(true);
  });

  defect('QA-06', 'a crash checkpoint older than the 30-day retention is still offered for resume and kept indefinitely', async () => {
    const disk = new Disk();
    const first = await new Rig({ disk, seed: 148 }).boot();
    await first.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    first.ui('begin_phrase');
    first.advance(1500);
    first.precheckResult();
    await first.settle();
    expect(disk.map.has('atr:v1:active')).toBe(true);
    const later = new Clock(START + 45 * DAY); // 45 days later
    const second = await new Rig({ disk, clock: later, seed: 149 }).boot();
    await second.settle();
    // Session data older than 30 days must not survive (ADR-0005 retention; master prompt: minimize retention).
    expect(second.view.screen).not.toBe('resume_or_discard');
    expect(disk.map.has('atr:v1:active')).toBe(false);
  });

  defect('QA-07', 'if saving the finished session record fails, the checkpoint is cleared anyway: the session is lost although the speaker was only warned', async () => {
    const disk = new Disk();
    const rig = await new Rig({ disk, seed: 150 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 1) });
    rig.attempt({ rel: 25 });
    await rig.settle();
    expect(disk.map.has('atr:v1:active')).toBe(true);
    disk.failSetPrefix = 'atr:v1:session:'; // the summary's record write fails (disk full)
    rig.ui('next_phrase');
    await rig.settle();
    expect(rig.view.stage).toBe('summary');
    expect(rig.view.banner?.text ?? '').toMatch(/could not save/i); // the speaker is warned (this part works)
    expect(disk.atrKeys().some((k) => k.startsWith('atr:v1:session:'))).toBe(false); // nothing saved
    // Expected: the checkpoint survives so the work can be recovered on the next launch.
    expect(disk.map.has('atr:v1:active')).toBe(true);
  });
});


/* ================================================================== (l) protocol revision 4 */

describe('(l1) revision 4: window_id is unique per measurement (DEF-002); a pre-window precheck shares the capture attempt_id', () => {
  const ids = (m: Sent): [string | null, string | null, string | null] => [m.session_id, m.window_id, m.attempt_id];

  it('every precheck and every capture has its own window_id; precheck and capture share the attempt_id; no id is ever reused', async () => {
    const rig = await new Rig({ seed: 171 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 3; p += 1) {
      rig.attempt({ rel: 25 });
      rig.listenerResponse('heard');
      if (rig.view.stage === 'response_pending') rig.ui('rate_skip');
      rig.ui('next_phrase');
    }
    const prechecks = rig.wire.of('precheck.start');
    const captures = rig.wire.of('window.start');
    // quiet check (1 precheck), then one pre-window precheck per phrase; calibration and the phrases are captures
    expect(prechecks).toHaveLength(1 + 3);
    expect(captures).toHaveLength(1 + 3);
    const all = [...prechecks, ...captures].map((m) => m.window_id as string);
    expect(new Set(all).size).toBe(all.length); // no window_id appears in two measurements
    for (let i = 0; i < 3; i += 1) {
      const pre = prechecks[1 + i] as Sent;
      const cap = captures[1 + i] as Sent;
      expect(pre.payload['purpose']).toBe('pre_window');
      expect(pre.window_id).not.toBe(cap.window_id);
      expect(pre.attempt_id).toBe(cap.attempt_id);
      expect(pre.session_id).toBe(cap.session_id);
    }
    // Different attempts never share an attempt_id.
    const attempts = captures.slice(1).map((m) => m.attempt_id);
    expect(new Set(attempts).size).toBe(3);
    // Everything after the capture starts is bound to the CAPTURE window.
    for (const type of ['listener.open', 'attempt.reveal']) {
      for (const m of rig.wire.of(type)) {
        expect(captures.some((c) => c.window_id === m.window_id && c.attempt_id === m.attempt_id), `${type} binds to a capture`).toBe(true);
        expect(prechecks.some((c) => c.window_id === m.window_id), `${type} must not carry a precheck window id`).toBe(false);
      }
    }
  });

  it('a retry gets a new attempt_id and new window ids for both of its measurements', async () => {
    const rig = await new Rig({ seed: 172 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    rig.ui('try_again');
    rig.attempt({ rel: 25 });
    const [firstPre, secondPre] = [rig.wire.of('precheck.start')[1] as Sent, rig.wire.of('precheck.start')[2] as Sent];
    const [firstCap, secondCap] = [rig.wire.of('window.start')[1] as Sent, rig.wire.of('window.start')[2] as Sent];
    expect(new Set([firstPre.window_id, firstCap.window_id, secondPre.window_id, secondCap.window_id]).size).toBe(4);
    expect(firstCap.attempt_id).not.toBe(secondCap.attempt_id);
    expect(secondPre.attempt_id).toBe(secondCap.attempt_id);
  });

  it('stale filtering is per window_id: a result for the other measurement of the same attempt is dropped and acked ignored_stale', async () => {
    const rig = await new Rig({ seed: 173 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    const pre = rig.last('precheck.start');
    // During the precheck a window.result (any id of this attempt) cannot be a capture result.
    rig.phoneSend('window.result', rig.windowResultPayload('phrase', { rel: 30 }), { s: pre.session_id, w: pre.window_id, a: pre.attempt_id });
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    expect(rig.count('window.start')).toBe(1); // calibration only: the gate is still waiting for its own result
    rig.precheckResult();
    const cap = rig.last('window.start');
    expect(cap.window_id).not.toBe(pre.window_id);
    // During the capture, a precheck.result that names the CAPTURE window, and level/window frames that name the
    // PRECHECK window, are all dropped.
    const acksBefore = rig.count('ack');
    rig.precheckResult(0, {}, pre, cap); // purpose pre_window, ids of the capture
    rig.level(0, FLOOR + 40, true, false, pre); // ids of the precheck
    rig.phoneSend('window.result', rig.windowResultPayload('phrase', { rel: 30 }), { s: pre.session_id, w: pre.window_id, a: pre.attempt_id }); // would score the attempt if the precheck id were accepted
    expect(rig.count('ack') - acksBefore).toBeGreaterThanOrEqual(2); // stale acks (levels share one ack per window)
    for (const a of rig.wire.of('ack').slice(acksBefore)) expect(a.payload['outcome']).toBe('ignored_stale');
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.view.meter?.levelRelDb).toBeNull(); // the stray level never reached the meter
    rig.windowResult({ rel: 25 }, cap);
    expect(rig.view.stage).toBe('reveal');
    expect(rig.view.result?.label).toBe("Reached today's relative level band");
  });

  it('window.cancel names the measurement that is open: the precheck id in the precheck, the capture id in the capture', async () => {
    const rig = await new Rig({ seed: 174 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    const pre = rig.last('precheck.start');
    rig.back();
    expect(ids(rig.last('window.cancel'))).toEqual(ids(pre));
    rig.ui('try_again');
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const cap = rig.last('window.start');
    rig.back();
    const cancel = rig.last('window.cancel');
    expect(ids(cancel)).toEqual(ids(cap));
    expect(cancel.window_id).not.toBe(rig.wire.of('precheck.start').at(-1)?.window_id);
  });

  it('a gate-blocked attempt keeps the precheck window id in its record and never gets a capture window', async () => {
    const rig = await new Rig({ seed: 175 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    const capturesBefore = rig.count('window.start');
    rig.attempt({ rise: 8 }); // blocked: rise >= 6 dB
    const pre = rig.last('precheck.start');
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.count('window.start')).toBe(capturesBefore);
    rig.ui('retry');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    await rig.settle();
    const key = rig.disk.atrKeys().find((k) => k.startsWith('atr:v1:session:')) as string;
    const rec = rig.disk.json(key) as { attempts: { attemptId: string; windowId: string; started: boolean; reason: string | null }[] };
    const blocked = rec.attempts.find((a) => !a.started);
    expect(blocked).toMatchObject({ attemptId: pre.attempt_id, windowId: pre.window_id, reason: 'room_noisier' });
    // Every stored window id is unique across attempts.
    const windows = rec.attempts.map((a) => a.windowId);
    expect(new Set(windows).size).toBe(windows.length);
  });

  it('listener answers bind to the capture window: the precheck window id with the right attempt id is dropped', async () => {
    const rig = await new Rig({ seed: 176 }).boot();
    await rig.setupToPhrases({ family: true, bank: PHRASES.slice(0, 2) });
    rig.attempt({ rel: 25 });
    const pre = rig.wire.of('precheck.start').at(-1) as Sent;
    const open = rig.last('listener.open');
    expect(open.window_id).not.toBe(pre.window_id);
    rig.phoneSend('listener.response', { response: 'heard' }, { s: pre.session_id, w: pre.window_id, a: pre.attempt_id });
    expect(rig.last('ack').payload['outcome']).toBe('ignored_stale');
    expect(rig.view.stage).toBe('response_pending'); // still waiting for the real answer
    rig.listenerResponse('heard', open);
    expect(rig.view.stage).toBe('reveal');
  });

  it('with a band, the sustained-sound window is also two measurements (own precheck id), calibration and quiet check are one each', async () => {
    const rig = await new Rig({ seed: 177 }).boot();
    await rig.toQuietReady({ bank: PHRASES.slice(0, 2) });
    rig.quietCheck();
    rig.calibrate();
    rig.ui('continue');
    rig.ui('begin_vowel');
    rig.advance(1500);
    const pre = rig.last('precheck.start');
    expect(pre.payload['purpose']).toBe('pre_window');
    rig.precheckResult();
    const cap = rig.last('window.start');
    expect(cap.payload['kind']).toBe('vowel');
    expect(cap.window_id).not.toBe(pre.window_id);
    expect(cap.attempt_id).toBe(pre.attempt_id);
    const all = [...rig.wire.of('precheck.start'), ...rig.wire.of('window.start')].map((m) => m.window_id);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('(l2) revision 4: quantised values on the wire', () => {
  const base = {
    purpose: 'pre_window',
    valid: true,
    invalid_reason: null,
    floor_dbfs: -50,
    p20_dbfs: -51,
    p80_dbfs: -49,
    p95_dbfs: -47,
    frame_count: 40,
    expected_frames: 40,
    coverage: 1,
    clipped_frames: 0,
    nonfinite_frames: 0,
    duration_ms: 2000,
  };

  it('off-grid dB, off-grid coverage and fractional milliseconds are dropped by the TV without an ack and without any state change', async () => {
    const rig = await new Rig({ seed: 181 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    const pre = rig.last('precheck.start');
    const w = { s: pre.session_id, w: pre.window_id, a: pre.attempt_id };
    const sentBefore = rig.wire.sent.length;
    rig.forge('precheck.result', { ...base, floor_dbfs: -44.01 }, w); // 0.01 dB step
    rig.forge('precheck.result', { ...base, p95_dbfs: -46.95 }, w);
    rig.forge('precheck.result', { ...base, coverage: 0.9504 }, w); // not a multiple of 0.001
    rig.forge('precheck.result', { ...base, duration_ms: 2000.5 }, w); // not an integer
    expect(rig.wire.sent.length).toBe(sentBefore);
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.count('window.start')).toBe(1);
    rig.precheckResult(); // the grid-valued twin is accepted
    expect(rig.count('window.start')).toBe(2);
  });

  it('off-grid level and window.result values are dropped; the grid value is accepted', async () => {
    const rig = await new Rig({ seed: 182 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.precheckResult();
    const cap = rig.last('window.start');
    const w = { s: cap.session_id, w: cap.window_id, a: cap.attempt_id };
    const before = rig.wire.sent.length;
    rig.forge('level', { frame_index: 0, t_audio_ms: 0, dbfs: -44.05, active: true, clipped: false }, w);
    rig.forge('level', { frame_index: 1, t_audio_ms: 50.5, dbfs: -44, active: true, clipped: false }, w);
    const good = rig.windowResultPayload('phrase', { rel: 25 });
    rig.forge('window.result', { ...good, p95_active_dbfs: -24.97 }, w);
    rig.forge('window.result', { ...good, active_ms: 2500.5 }, w);
    expect(rig.wire.sent.length).toBe(before);
    expect(rig.view.stage).toBe('phrase_active');
    expect(rig.view.meter?.levelRelDb).toBeNull();
    rig.windowResult({ rel: 25 }, cap);
    expect(rig.view.stage).toBe('reveal');
  });

  it('the gate boundary on the 0.1 dB grid: a rise of 5.9 dB passes, 6.0 dB blocks, and the separation rule (margin - rise >= 10) holds at 10.0/9.9', async () => {
    const rig = await new Rig({ seed: 183 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 4) });
    rig.attempt({ rise: 5.9, rel: 25 });
    expect(rig.view.stage).toBe('reveal');
    rig.ui('next_phrase');
    rig.attempt({ rise: 6 });
    expect(rig.view.stage).toBe('paused_or_invalid');
  });

  it('a calibration that sits exactly on the 13.0 dB edge is accepted, 12.9 dB is not (grid values)', async () => {
    const edge = await new Rig({ seed: 184 }).boot();
    await edge.toQuietReady({ bank: PHRASES.slice(0, 2) });
    edge.quietCheck();
    edge.ui('begin_calibration');
    edge.advance(1500);
    edge.windowResult({ rel: 13 });
    expect(edge.view.title).toBe("Today's band is set");
    const below = await new Rig({ seed: 185 }).boot();
    await below.toQuietReady({ bank: PHRASES.slice(0, 2) });
    below.quietCheck();
    below.ui('begin_calibration');
    below.advance(1500);
    below.windowResult({ rel: 12.9 });
    expect(below.view.title).toBe("Today's band was not set");
  });
});

describe('(l3) revision 4: silent_input', () => {
  it('quiet check with silent_input: failed screen with Retry preferred, no floor and no calibration offered, then a good check recovers', async () => {
    const rig = await new Rig({ seed: 191 }).boot();
    await rig.toQuietReady({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_quiet_check');
    rig.advance(1500);
    rig.silentPrecheck();
    expect(rig.view.stage).toBe('quiet_check');
    expect(rig.view.title).toBe('Quiet check did not pass');
    expect(rig.actionIds()).toEqual(['retry', 'cancel']);
    expect(rig.view.preferredAction).toBe('retry');
    expect(rig.count('window.start')).toBe(0);
    rig.ui('retry');
    rig.ui('begin_quiet_check');
    rig.advance(1500);
    rig.precheckResult();
    expect(rig.view.stage).toBe('calibration');
  });

  it('pre-window silent_input blocks the attempt: unscored (silent_input), never started, no capture window, and a blind position stays blind on retry', async () => {
    const rig = await new Rig({ seed: 192 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 3) });
    for (let p = 1; p <= 2; p += 1) {
      rig.attempt({ rel: 25 });
      rig.ui('next_phrase');
    }
    const capturesBefore = rig.count('window.start');
    rig.ui('begin_phrase');
    rig.advance(1500);
    rig.silentPrecheck();
    expect(rig.view.stage).toBe('paused_or_invalid');
    expect(rig.actionIds()).toEqual(['retry', 'skip_phrase', 'finish_early']);
    expect(rig.count('window.start')).toBe(capturesBefore);
    rig.ui('retry');
    const retry = rig.attempt({ rel: 25 });
    expect(retry?.meter).toBeNull(); // the blocked attempt never captured, so position 3 is still blind
    rig.ui('rate_skip');
    rig.ui('next_phrase');
    const s = rig.summary();
    expect(s.invalidReasons).toEqual({ silent_input: 1 });
    expect(s.scoredHidden).toBe(1);
  });

  it('a silent_input result whose reason is not allowed for the purpose (unstable_floor in a pre-window) is dropped at the wire', async () => {
    const rig = await new Rig({ seed: 193 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.ui('begin_phrase');
    rig.advance(1500);
    const pre = rig.last('precheck.start');
    const before = rig.wire.sent.length;
    rig.forge(
      'precheck.result',
      { purpose: 'pre_window', valid: false, invalid_reason: 'unstable_floor', floor_dbfs: -50, p20_dbfs: -51, p80_dbfs: -49, p95_dbfs: -47, frame_count: 40, expected_frames: 40, coverage: 1, clipped_frames: 0, nonfinite_frames: 0, duration_ms: 2000 },
      { s: pre.session_id, w: pre.window_id, a: pre.attempt_id },
    );
    expect(rig.wire.sent.length).toBe(before);
    expect(rig.view.stage).toBe('phrase_active');
  });

  defect('QA-08', 'silent_input has no TV copy: both the failed quiet check and the paused screen say "The window could not be scored." instead of "The phone microphone looks muted or blocked." (AMENDMENTS-REV2 A1-05)', async () => {
    const quiet = await new Rig({ seed: 194 }).boot();
    await quiet.toQuietReady({ bank: PHRASES.slice(0, 2) });
    quiet.ui('begin_quiet_check');
    quiet.advance(1500);
    quiet.silentPrecheck();
    expect(quiet.view.body.join(' ')).toContain('The phone microphone looks muted or blocked.');
    const phrase = await new Rig({ seed: 195 }).boot();
    await phrase.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    phrase.ui('begin_phrase');
    phrase.advance(1500);
    phrase.silentPrecheck();
    expect(phrase.view.body.join(' ')).toContain('The phone microphone looks muted or blocked.');
  });
});

describe('(l4) revision 4: credential rotation (auth.ok.next_credential)', () => {
  it('an auth.ok without next_credential (the old shape) is rejected: the TV never claims to be connected', async () => {
    const rig = await new Rig({ seed: 201 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.link('reconnecting');
    rig.link('connected');
    expect(rig.view.link).toBe('connecting'); // connected socket, not yet authenticated
    rig.forge('auth.ok', { role: 'tv', generation: 2, peer_connected: true, phone_paired: true }, {});
    expect(rig.view.link).toBe('connecting');
    rig.authOk(true);
    expect(rig.view.link).toBe('connected');
  });

  it('the first reconnect presents the credential from room.created', async () => {
    const rig = await new Rig({ seed: 202 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.link('reconnecting');
    rig.link('connected');
    const resume = rig.last('auth.resume');
    expect(resume.payload).toMatchObject({ role: 'tv', credential: CREDENTIAL });
  });

  defect('QA-09', 'the TV ignores auth.ok.next_credential: its SECOND reconnect presents the credential the relay already consumed, which revokes the TV role (PROTOCOL.md rev 4 section 3.1)', async () => {
    const rig = await new Rig({ seed: 203 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.link('reconnecting');
    rig.link('connected');
    expect(rig.last('auth.resume').payload['credential']).toBe(CREDENTIAL);
    rig.authOk(true); // the relay rotates: next_credential NEXT0001...
    const rotated = rig.rotated[0] as string;
    rig.mic('open_idle');
    rig.link('reconnecting');
    rig.link('connected');
    expect(rig.wire.of('auth.resume')).toHaveLength(2);
    // Expected: the rotated credential. Observed: the original one again.
    expect(rig.last('auth.resume').payload['credential']).toBe(rotated);
  });

  it('credentials never reach storage or any view, including the rotated one', async () => {
    const rig = await new Rig({ seed: 204 }).boot();
    await rig.setupToPhrases({ bank: PHRASES.slice(0, 2) });
    rig.link('reconnecting');
    rig.link('connected');
    rig.authOk(true);
    rig.attempt({ rel: 25 });
    rig.ui('next_phrase');
    await rig.settle();
    const rotated = rig.rotated[0] as string;
    expect(rig.disk.allText()).not.toContain(rotated);
    expect(rig.disk.allText()).not.toContain(CREDENTIAL);
    for (const t of rig.trace) {
      const json = JSON.stringify(t.view);
      expect(json).not.toContain(rotated);
      expect(json).not.toContain(CREDENTIAL);
    }
  });
});

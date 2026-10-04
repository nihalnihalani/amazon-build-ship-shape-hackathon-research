/** QA wave 2 (docs/evaluation/QA_REVIEW_T11_T13_T14.md section 10): QA-10, QA-11, QA-12, QA-12b, QA-13. */

import { describe, expect, it } from 'vitest';
import { deriveHistory, loadData } from '../src/index.js';
import { isCalendarDate, safeLocalDate, utcDate } from '../src/dates.js';
import { shiftDate } from '../src/records.js';
import { T0, boot, createFlakyStorage } from './helpers.js';

const DAY = 86_400_000;
const META = JSON.stringify({ schema_version: 1, created_at: 1 });
const SETTINGS = JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true });

const record = (id: string, o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    sessionId: id,
    startedAt: T0 - 1000,
    endedAt: T0,
    localDate: '2026-10-05',
    complete: true,
    endReason: 'completed',
    resumed: false,
    familyMode: false,
    phraseCount: 10,
    calMarginDb: 20,
    cuesUsed: 0,
    attempts: [
      {
        attemptId: 'a_attempt0001', windowId: 'w_window00001', position: 1, attemptNumber: 1, hidden: false, state: 'revealed', started: true,
        verdict: 'reached', reason: null, borderline: false, activeMs: 2000, longestActiveMs: 2000, rating: null, listener: null, lateListener: null,
      },
    ],
    vowels: [],
    skipped: [],
    ...o,
  });

describe('QA-10 records dated in the future are pruned and never shown', () => {
  it('prunes a record 400 days ahead, and by the 1-day horizon: now + 1 day is kept, + 1 ms is not', async () => {
    const storage = createFlakyStorage({
      'atr:v1:meta': META,
      'atr:v1:settings': SETTINGS,
      'atr:v1:session:s_far': record('s_far', { startedAt: T0 + 399 * DAY, endedAt: T0 + 400 * DAY, localDate: '2027-11-09' }),
      'atr:v1:session:s_edge': record('s_edge', { startedAt: T0, endedAt: T0 + DAY, localDate: '2026-10-06' }),
      'atr:v1:session:s_over': record('s_over', { startedAt: T0, endedAt: T0 + DAY + 1, localDate: '2026-10-06' }),
      'atr:v1:session:s_started': record('s_started', { startedAt: T0 + 2 * DAY, endedAt: T0, localDate: '2026-10-05' }),
      'atr:v1:session:s_ok': record('s_ok'),
    });
    const data = await loadData(storage, T0);
    expect(data.records.map((r) => r.sessionId).sort()).toEqual(['s_edge', 's_ok']);
    expect(data.prunedSessions).toBe(3);
    const keys = Object.keys(storage.dump());
    for (const gone of ['s_far', 's_over', 's_started']) expect(keys).not.toContain(`atr:v1:session:${gone}`);
    expect(JSON.parse(storage.dump()['atr:v1:index'] as string).entries.map((e: { sessionId: string }) => e.sessionId).sort()).toEqual(['s_edge', 's_ok']);
  });

  it('a record whose clock was wrong and later corrected does not survive the next launch', async () => {
    const h = await boot({
      seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:session:s_far': record('s_far', { startedAt: T0 + 399 * DAY, endedAt: T0 + 400 * DAY, localDate: '2027-11-09' }) },
    });
    await h.flush();
    expect(Object.keys(h.storage.dump())).not.toContain('atr:v1:session:s_far');
    expect(h.view.body.join(' ')).toContain('No sessions saved');
  });

  it('a checkpoint saved more than a day in the future is discarded like a stale one', async () => {
    const cp = (savedAt: number) =>
      JSON.stringify({ version: 1, savedAt, stage: 'phrase_ready', phraseCount: 10, phraseIdx: 1, record: JSON.parse(record('s_cp', { complete: false, endReason: 'interrupted' })) });
    const future = await boot({ seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:active': cp(T0 + 2 * DAY) } });
    expect(future.view.stage).toBe('idle');
    const near = await boot({ seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:active': cp(T0 + 1000) } });
    expect(near.view.stage).toBe('resume_or_discard');
  });

  it('history and Home never show a day after today, even for a record inside the 1-day tolerance', async () => {
    const tomorrow = record('s_tomorrow', { startedAt: T0, endedAt: T0 + 20 * 3_600_000, localDate: '2026-10-06' });
    const h = await boot({ seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:session:s_tomorrow': tomorrow } });
    expect(h.view.body.join(' ')).not.toContain('2026-10-06');
    expect(h.view.body.join(' ')).toContain('No sessions saved');
    h.ui('open_history');
    const days = h.view.history ?? [];
    expect(days.map((d) => d.date)).not.toContain('2026-10-06');
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.sessions === null)).toBe(true);
    // the pure function agrees
    const parsed = JSON.parse(tomorrow);
    expect(deriveHistory([parsed], '2026-10-05').every((d) => d.sessions === null)).toBe(true);
    expect(deriveHistory([parsed], '2026-10-05').map((d) => d.date)).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    ]);
  });
});

describe('QA-11 dates must be real calendar dates', () => {
  it('isCalendarDate accepts real dates and rejects the rest', () => {
    for (const ok of ['2026-10-05', '2028-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of ['2026-13-45', '2026-02-30', '2025-02-29', '2100-02-29', '2026-00-10', '2026-04-31', '2026-10-00', '2026-1-05', '26-10-05', 'yesterday', '', '2026-10-05 ', 20261005, null, undefined, {}]) {
      expect(isCalendarDate(bad), String(bad)).toBe(false);
    }
  });

  it('a stored record with an invalid date is ignored, counted, never shown, and Home offers deletion', async () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      const h = await boot({ seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:session:s_bad': record('s_bad', { localDate: bad }), 'atr:v1:session:s_ok': record('s_ok') } });
      expect(h.view.body.join(' '), bad).not.toContain(bad);
      expect(h.view.body.join(' ')).toContain('could not be read and is being ignored');
      expect(h.view.body.join(' ')).toContain('Last session, 2026-10-05');
    }
  });

  it('a clock that returns something that is not a date falls back to the UTC date and is counted', async () => {
    expect(safeLocalDate(() => '2026-13-45', T0)).toBe('2026-10-05');
    expect(safeLocalDate(() => { throw new Error('no tz'); }, T0)).toBe('2026-10-05');
    expect(safeLocalDate(() => '2026-10-04', T0)).toBe('2026-10-04');
    expect(utcDate(Date.UTC(2028, 1, 29, 23, 59))).toBe('2028-02-29');
    let calls = 0;
    safeLocalDate(() => 'nope', T0, () => (calls += 1));
    expect(calls).toBe(1);

    const h = await boot();
    h.clock.localDate = () => 'not-a-date';
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('finish_early');
    await h.flush();
    const key = Object.keys(h.storage.dump()).find((k) => k.startsWith('atr:v1:session:')) as string;
    expect(JSON.parse(h.storage.dump()[key] as string).localDate).toBe('2026-10-05'); // the UTC date, a valid one
    h.ui('open_history');
    expect(h.view.history).toHaveLength(7);
    expect(h.view.history?.[6]).toMatchObject({ date: '2026-10-05', sessions: 1 });
    h.ui('done');
    h.ui('done');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(Number(h.view.diagnostics?.clock_date_invalid)).toBeGreaterThanOrEqual(1);
  });

  it('calendar arithmetic refuses an invalid date instead of inventing one', () => {
    expect(shiftDate('2026-13-45', -1)).toBe('2026-13-45');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('QA-12 / QA-12b cue announcements', () => {
  it('a screen change within the cue chip still announces the new screen (the cue had its own turn on the earlier one)', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    h.cue('zebra');
    expect(h.view.announcement).toMatch(/^Reached today's relative level band/);
    expect(h.view.announcement).toMatch(/Cue: zebra$/);
    h.ui('next_phrase'); // within the 3 s chip
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.cue?.text).toBe('zebra'); // still shown
    expect(h.view.announcement).toContain('Phrase 2 of 10');
    expect(h.view.announcement).not.toContain('Cue');
    const before = h.view.announcement;
    h.advance(3500); // the chip expires: the live-region text does not change under the reader
    expect(h.view.cue).toBeNull();
    expect(h.view.announcement).toBe(before);
  });

  it('the cue text is stable for the rest of the stage and appears exactly once', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.cue('zebra');
    const text = h.view.announcement ?? '';
    expect((text.match(/Cue: zebra/g) ?? []).length).toBe(1);
    h.advance(1000);
    expect(h.view.announcement).toBe(text);
    h.advance(3000);
    expect(h.view.announcement).toBe(text);
    h.cue('zebra'); // a second tap is a second cue
    expect(((h.view.announcement ?? '').match(/Cue: zebra/g) ?? []).length).toBe(2);
  });

  it('a cue held during a blind attempt is announced exactly once, after the reveal', async () => {
    for (const timeout of [false, true]) {
      const h = await boot();
      h.setupToPhrases();
      for (let p = 1; p < 3; p += 1) {
        h.runPhrase({});
        h.ui('next_phrase');
      }
      h.beginAndLead('begin_phrase');
      h.answerPrecheck();
      if (timeout) {
        h.advance(8500);
        h.advance(3000);
      } else h.answerWindow({ rel: 25 });
      expect(h.view.stage).toBe('response_pending');
      const prompt = h.view.announcement;
      h.cue('zebra');
      expect(h.view.announcement).toBe(prompt);
      h.relayError('rate_limited');
      expect(h.view.announcement).toBe(prompt);
      h.ui('rate_skip');
      expect(h.view.stage).toBe('reveal');
      const text = h.view.announcement ?? '';
      expect((text.match(/Cue: zebra/g) ?? []).length).toBe(1);
      expect((text.match(/The relay reported: rate_limited\./g) ?? []).length).toBe(1);
      h.advance(4000);
      expect(h.view.announcement).toBe(text);
    }
  });

  it('while a window is open nothing is announced and a cue is not accepted', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.cue('zebra');
    expect(h.view.announcement).toBeNull();
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'window_open' });
  });
});

describe('QA-13 counts in copy use the right number', () => {
  async function resumePrompt(attempted: number): Promise<string> {
    const g = await boot();
    g.setupToPhrases();
    for (let i = 0; i < attempted; i += 1) {
      g.runPhrase({ rating: 'skipped' });
      g.ui('next_phrase');
    }
    g.beginAndLead('begin_phrase');
    g.answerPrecheck(); // a capture in flight, so a checkpoint exists
    await g.flush();
    const h = await boot({ seed: g.storage.dump() });
    expect(h.view.screen).toBe('resume_or_discard');
    return h.view.body.join(' ');
  }

  it('the resume prompt says "1 phrase was attempted" and "N phrases were attempted"', async () => {
    expect(await resumePrompt(0)).toContain('1 phrase was attempted'); // the in-flight capture counts as attempted
    expect(await resumePrompt(1)).toContain('2 phrases were attempted');
    expect(await resumePrompt(3)).toContain('4 phrases were attempted');
    for (const n of [0, 1, 2]) expect(await resumePrompt(n)).not.toMatch(/\b1 phrases\b/);
  });

  it('Home says "1 phrase completed" in a session without a band, and no screen says "1 phrases"', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(5); // too quiet: continue without a band
    h.ui('continue');
    h.ui('skip_vowel');
    h.runPhrase({});
    h.ui('finish_early');
    h.ui('done');
    expect(h.view.body.join(' ')).toContain('Last session, 2026-10-05: 1 phrase completed (incomplete).');
    for (const v of h.views) expect(JSON.stringify(v)).not.toMatch(/\b1 phrases\b|\b1 attempts\b|\b1 sessions\b/);
  });
});

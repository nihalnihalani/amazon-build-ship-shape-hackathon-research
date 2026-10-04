import { describe, expect, it } from 'vitest';
import { computeAgreement, deriveHistory, deriveSummary, shiftDate, summarizeRecord, weekdayLabel } from '../src/index.js';
import type { AttemptRecord, SessionRecord, VowelRecord } from '../src/index.js';

let counter = 0;
function att(o: Partial<AttemptRecord> & { position: number }): AttemptRecord {
  counter += 1;
  return {
    attemptId: `a_t${counter}`,
    windowId: `w_t${counter}`,
    attemptNumber: 1,
    hidden: false,
    state: 'revealed',
    started: true,
    verdict: 'reached',
    reason: null,
    borderline: false,
    activeMs: 2000,
    longestActiveMs: 2000,
    rating: null,
    listener: null,
    lateListener: null,
    ...o,
  };
}
const unscored = (position: number, reason: string, o: Partial<AttemptRecord> = {}): AttemptRecord =>
  att({ position, state: 'invalid', verdict: 'unscored', reason, ...o });

const base = { complete: true, calMarginDb: 20, familyMode: true, vowels: [] as VowelRecord[], skipped: [] as number[] };

describe('agreement (ADR-0004)', () => {
  it('requires a scored attempt and an on-time heard/not_heard; reports hidden and visible separately', () => {
    const attempts = [
      att({ position: 1, verdict: 'reached', listener: 'heard' }), // visible agree
      att({ position: 2, verdict: 'not_reached', listener: 'heard' }), // visible disagree
      att({ position: 3, hidden: true, verdict: 'not_reached', listener: 'not_heard' }), // hidden agree
      att({ position: 4, verdict: 'reached', listener: 'missing' }), // not eligible
      att({ position: 5, verdict: 'reached', listener: null }), // not eligible
      att({ position: 6, hidden: true, verdict: 'reached', listener: 'heard', lateListener: 'not_heard' }), // late ignored
      unscored(7, 'no_voice', { listener: 'heard' }), // unscored: never eligible
      att({ position: 8, verdict: 'unscored', reason: 'no_band', listener: 'heard' }), // no band: not eligible
      att({ position: 3, attemptNumber: 2, verdict: 'reached', listener: 'heard' }), // visible retry counts as visible
    ];
    expect(computeAgreement(attempts)).toEqual({
      hidden: { agree: 2, eligible: 2 },
      visible: { agree: 2, eligible: 3 },
    });
  });

  it('a late-only response is never in the denominator', () => {
    const a = att({ position: 1, listener: 'missing', lateListener: 'heard' });
    expect(computeAgreement([a])).toEqual({ hidden: { agree: 0, eligible: 0 }, visible: { agree: 0, eligible: 0 } });
    expect(deriveSummary({ ...base, attempts: [a] }).lateListenerResponses).toBe(1);
  });

  it('with zero eligible attempts the summary says so instead of showing 0/0', () => {
    const s = deriveSummary({ ...base, attempts: [att({ position: 1 })] });
    expect(s.agreementHidden).toEqual({ agree: 0, eligible: 0 });
    expect(s.lines.join('\n')).toContain('Agreement on blind checks: No eligible listener responses');
    expect(s.lines.join('\n')).toContain('Agreement on visible attempts: No eligible listener responses');
    expect(s.lines.join('\n')).not.toContain('0 of 0');
  });

  it('lines carry notes only: no count, denominator or figure that the structured fields already hold', () => {
    const attempts = [
      att({ position: 1, listener: 'heard', borderline: true }),
      att({ position: 2, verdict: 'not_reached', listener: 'missing', lateListener: 'heard' }),
      unscored(3, 'no_voice', { hidden: true }),
    ];
    const s = deriveSummary({
      ...base,
      complete: false,
      attempts,
      vowels: [{ windowId: 'w_1', valid: true, reason: null, longestActiveMs: 9100, verdict: null, borderline: false }],
    });
    expect(s.borderlineCount).toBe(1);
    expect(s.lateListenerResponses).toBe(1);
    expect(s.lines.length).toBeGreaterThanOrEqual(5);
    for (const line of s.lines) expect(line, line).not.toMatch(/\d/);
  });

  it('does not report agreement lines when family mode was off', () => {
    const s = deriveSummary({ ...base, familyMode: false, attempts: [att({ position: 1 })] });
    expect(s.lines.join('\n')).toContain('Listener check was off');
    expect(s.lines.join('\n')).not.toContain('agreed');
  });
});

describe('summary counts (ADR-0004)', () => {
  it('counts completed, attempted, skipped and invalid separately, with reasons', () => {
    const attempts = [
      att({ position: 1 }),
      att({ position: 2, verdict: 'not_reached' }),
      unscored(3, 'no_voice', { hidden: true }),
      unscored(3, 'cancelled', { attemptNumber: 2 }),
      unscored(4, 'room_noisier', { started: false }), // blocked: never started
      att({ position: 5, state: 'invalid', verdict: 'unscored', reason: 'interrupted' }),
    ];
    const s = deriveSummary({ ...base, attempts, skipped: [3, 4, 6] });
    expect(s.phrasesCompleted).toBe(2);
    expect(s.phrasesAttempted).toBe(4); // positions 1, 2, 3, 5 (4 never started)
    expect(s.phrasesSkipped).toBe(3);
    expect(s.attemptsInvalid).toBe(4);
    expect(s.invalidReasons).toEqual({ no_voice: 1, cancelled: 1, room_noisier: 1, interrupted: 1 });
  });

  it('reached counts: first valid (blind) attempt for hidden positions, best valid attempt otherwise', () => {
    const attempts = [
      // visible position 1: first attempt below, retry reached -> best = reached
      att({ position: 1, verdict: 'not_reached' }),
      att({ position: 1, attemptNumber: 2, verdict: 'reached' }),
      // visible position 2: both below
      att({ position: 2, verdict: 'not_reached' }),
      att({ position: 2, attemptNumber: 2, verdict: 'not_reached' }),
      // hidden position 3: blind attempt reached; a visible retry below does not replace it and is not double counted
      att({ position: 3, hidden: true, verdict: 'reached' }),
      att({ position: 3, attemptNumber: 2, verdict: 'not_reached' }),
      // hidden position 6: blind attempt invalid; the visible retry counts as a visible result
      att({ position: 6, hidden: true, state: 'invalid', verdict: 'unscored', reason: 'no_voice' }),
      att({ position: 6, attemptNumber: 2, verdict: 'reached' }),
      // hidden position 9: blind attempt below
      att({ position: 9, hidden: true, verdict: 'not_reached' }),
    ];
    const s = deriveSummary({ ...base, attempts });
    expect(s).toMatchObject({ reachedHidden: 1, scoredHidden: 2, reachedVisible: 2, scoredVisible: 3 });
    expect(s.phrasesCompleted).toBe(5);
  });

  it('counts blind ratings only for revealed hidden attempts and borderline for scored ones', () => {
    const attempts = [
      att({ position: 3, hidden: true, rating: 'felt_loud', borderline: true }),
      att({ position: 6, hidden: true, rating: 'felt_normal' }),
      att({ position: 9, hidden: true, rating: 'skipped' }),
      att({ position: 4, hidden: false, rating: 'felt_loud' }), // a visible attempt never carries a counted rating
      att({ position: 2, borderline: true }),
      att({ position: 5, state: 'response_pending', verdict: 'reached', borderline: true }), // not revealed: not counted
    ];
    const s = deriveSummary({ ...base, attempts });
    expect(s.hiddenRatings).toEqual({ feltLoud: 1, feltNormal: 1, skipped: 1 });
    expect(s.borderlineCount).toBe(2);
  });

  it('longest voice-activity duration uses valid vowel windows only', () => {
    const vowels: VowelRecord[] = [
      { windowId: 'w_1', valid: true, reason: null, longestActiveMs: 9100, verdict: null, borderline: false },
      { windowId: 'w_2', valid: false, reason: 'low_coverage', longestActiveMs: 30000, verdict: null, borderline: false },
      { windowId: 'w_3', valid: true, reason: null, longestActiveMs: 14200, verdict: null, borderline: false },
    ];
    expect(deriveSummary({ ...base, attempts: [], vowels }).longestActiveMs).toBe(14200);
    expect(deriveSummary({ ...base, attempts: [], vowels: [] }).longestActiveMs).toBeNull();
  });

  it('labels incomplete sessions and the no-band case', () => {
    const inc = deriveSummary({ ...base, complete: false, attempts: [att({ position: 1 })] });
    expect(inc.complete).toBe(false);
    expect(inc.lines[0]).toContain('Incomplete session');
    const nb = deriveSummary({ ...base, calMarginDb: null, attempts: [att({ position: 1, verdict: 'unscored', reason: 'no_band' })] });
    expect(nb.lines.join('\n')).toContain('No band was set');
    expect(nb.phrasesCompleted).toBe(1);
    expect(nb.scoredVisible).toBe(0);
  });
});

describe('dates', () => {
  it('shifts calendar dates without time zones, across months, years, leap days and DST changes', () => {
    expect(shiftDate('2026-10-05', -6)).toBe('2026-09-29');
    expect(shiftDate('2026-01-02', -3)).toBe('2025-12-30');
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDate('2027-03-01', -1)).toBe('2027-02-28');
    expect(shiftDate('2026-03-09', -1)).toBe('2026-03-08'); // US DST start
    expect(shiftDate('2026-11-02', -1)).toBe('2026-11-01'); // US DST end
    expect(shiftDate('2026-10-05', 0)).toBe('2026-10-05');
    expect(shiftDate('garbage', -1)).toBe('garbage');
  });

  it('labels weekdays', () => {
    expect(weekdayLabel('2026-10-05')).toBe('Monday');
    expect(weekdayLabel('2026-10-11')).toBe('Sunday');
    expect(weekdayLabel('nope')).toBe('');
  });
});

function record(localDate: string, o: Partial<SessionRecord> & { attempts?: AttemptRecord[] } = {}): SessionRecord {
  return {
    sessionId: `s_${localDate}${o.endedAt ?? ''}`,
    startedAt: 1,
    endedAt: 2,
    localDate,
    complete: true,
    endReason: 'completed',
    resumed: false,
    familyMode: false,
    phraseCount: 10,
    calMarginDb: 20,
    cuesUsed: 0,
    attempts: [att({ position: 1 }), att({ position: 2, verdict: 'not_reached' })],
    vowels: [{ windowId: 'w_v', valid: true, reason: null, longestActiveMs: 8000, verdict: null, borderline: false }],
    skipped: [],
    ...o,
  };
}

describe('seven-day history (ADR-0005)', () => {
  it('returns exactly 7 days oldest first; days without sessions stay missing', () => {
    const days = deriveHistory([record('2026-10-03'), record('2026-10-05', { attempts: [att({ position: 1 })] })], '2026-10-05');
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(days.map((d) => d.weekdayLabel)).toEqual(['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday']);
    expect(days[4]).toEqual({
      date: '2026-10-03',
      weekdayLabel: 'Saturday',
      sessions: 1,
      reached: 1,
      scored: 2,
      longestActiveMs: 8000,
      incomplete: false,
    });
    expect(days[6]).toMatchObject({ sessions: 1, reached: 1, scored: 1 });
    for (const i of [0, 1, 2, 3, 5]) {
      expect(days[i]).toMatchObject({ sessions: null, reached: null, scored: null, longestActiveMs: null, incomplete: false });
    }
  });

  it('ignores records outside the window and sums multiple sessions on one day', () => {
    const days = deriveHistory(
      [record('2026-09-28'), record('2026-10-05', { endedAt: 3 }), record('2026-10-05', { endedAt: 4, vowels: [] })],
      '2026-10-05',
    );
    expect(days.some((d) => d.date === '2026-09-28')).toBe(false);
    expect(days[6]).toMatchObject({ sessions: 2, reached: 2, scored: 4, longestActiveMs: 8000 });
  });

  it('flags a day containing an incomplete session and never turns it into a complete day', () => {
    const days = deriveHistory(
      [record('2026-10-04', { complete: false, endReason: 'user_exit' }), record('2026-10-05')],
      '2026-10-05',
    );
    expect(days[5]).toMatchObject({ sessions: 1, incomplete: true });
    expect(days[6]).toMatchObject({ sessions: 1, incomplete: false });
    const mixed = deriveHistory([record('2026-10-05'), record('2026-10-05', { complete: false, resumed: true, endedAt: 9 })], '2026-10-05');
    expect(mixed[6]?.incomplete).toBe(true);
  });

  it('summarizeRecord is the same derivation the live summary uses', () => {
    const r = record('2026-10-05');
    expect(summarizeRecord(r)).toEqual(deriveSummary({ ...r, complete: r.complete, attempts: r.attempts }));
  });
});

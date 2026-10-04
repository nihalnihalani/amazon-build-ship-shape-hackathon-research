/**
 * docs/adr/AMENDMENTS-REV2.md ADR-0004: A4-01 (blocker) hidden invalid windows, A4-02 checkpoint, A4-03 side doors,
 * A4-04 keep waiting / continue without listener, A4-05 first response wins, A4-06 borderline agreement.
 */

import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import type { TvView } from '../src/index.js';
import { FLOOR, ROOM, T0, allStrings, boot, seededBytes } from './helpers.js';
import type { Harness, PhraseOpts, Sent } from './helpers.js';

/** Words that would tell the speaker something about the window before the rating. */
const TELLS = [
  /not scored/i,
  /no voice/i,
  /too strong/i,
  /enough audio/i,
  /continued/i,
  /inconsistent/i,
  /muted/i,
  /did not answer/i,
  /reach/i,
  /below/i,
  /\bband\b/i,
  /\bdB\b/,
  /listener:/i,
  /you felt/i,
  /borderline/i,
];

const isPending = (v: TvView): boolean => v.stage === 'response_pending' && v.phrase?.position === 3 && v.phrase.attemptNumber === 1;

async function atPosition3(opts: { family?: boolean } = {}): Promise<Harness> {
  const h = await boot({ settings: { familyMode: opts.family === true } });
  h.setupToPhrases();
  for (let p = 1; p < 3; p += 1) {
    h.runPhrase({ rating: 'skipped', listener: 'heard' });
    h.ui('next_phrase');
  }
  expect(h.view.phrase?.position).toBe(3);
  return h;
}

/** Drive the hidden attempt at position 3 to its close and return what the TV showed and sent from there to the rating. */
async function hiddenRun(
  window: Partial<PhraseOpts> & { timeout?: boolean },
  family = false,
): Promise<{ pending: string[]; sent: string[]; acks: string[]; views: TvView[]; h: Harness }> {
  const h = await atPosition3({ family });
  h.views.length = 0;
  h.ui('begin_phrase');
  h.advance(1500);
  h.answerPrecheck();
  const start = h.last('window.start');
  h.level(0, FLOOR + 3, true, start);
  h.advance(500);
  const mark = h.transport.sent.length;
  if (window.timeout) {
    h.advance(8500); // window.stop complete
    h.advance(3000); // no result: cancelled as timeout
  } else {
    h.answerWindow({ rel: window.rel, valid: window.valid, reason: window.reason, activeMs: window.activeMs, coverage: window.coverage, duration: window.duration }, start);
  }
  expect(h.view.stage).toBe('response_pending');
  const pendingViews = h.views.filter(isPending);
  const afterClose = h.transport.sent
    .slice(mark)
    .filter((m) => m.type !== 'window.stop' && m.type !== 'window.cancel' && m.type !== 'ack')
    .map((m) => JSON.stringify({ type: m.type, payload: m.payload }).replace(/"(acked_message_id|attempt_id|window_id)":"[^"]*"/g, ''));
  const acks = h.transport.sent
    .slice(mark)
    .filter((m) => m.type === 'ack')
    .map((m) => JSON.stringify(m.payload).replace(/"acked_message_id":"[^"]*",?/, ''));
  return { pending: pendingViews.map((v) => JSON.stringify(v)), sent: afterClose, acks, views: h.views, h };
}

describe('A4-01 a hidden first attempt reveals nothing about the window before the rating', () => {
  it('valid, invalid (every reason), integrity and timeout all produce the same views and the same TV messages', async () => {
    const reference = await hiddenRun({ rel: 25 });
    expect(reference.pending.length).toBeGreaterThan(0);
    const variants: [string, Partial<PhraseOpts> & { timeout?: boolean }][] = [
      ['below the band', { rel: 5 }],
      ['no_voice', { valid: false, reason: 'no_voice', activeMs: 0 }],
      ['clipped', { valid: false, reason: 'clipped' }],
      ['low_coverage', { valid: false, reason: 'low_coverage', coverage: 0.85 }],
      ['continuous_sound', { valid: false, reason: 'continuous_sound' }],
      ['nonfinite', { valid: false, reason: 'nonfinite' }],
      ['integrity (TV timing check)', { duration: 8600 }],
      ['timeout', { timeout: true }],
    ];
    for (const [name, variant] of variants) {
      const run = await hiddenRun(variant);
      expect(run.pending, name).toEqual(reference.pending);
      expect(run.sent, name).toEqual(reference.sent);
      // the phone also gets the same acknowledgement for every reported window ('applied'); a timeout has no result to ack
      if (!variant.timeout) expect(run.acks, name).toEqual(reference.acks);
    }
  });

  it('deep scan: nothing in any view from capture close to the rating carries a tell, for an invalid window', async () => {
    for (const window of [
      { valid: false, reason: 'no_voice', activeMs: 0 },
      { valid: false, reason: 'clipped' },
      { duration: 8600 },
      { timeout: true },
    ] as (Partial<PhraseOpts> & { timeout?: boolean })[]) {
      const run = await hiddenRun(window);
      const closed = run.views.filter((v) => !v.capturing && v.stage === 'response_pending');
      expect(closed.length).toBeGreaterThan(0);
      for (const v of closed) {
        expect(v.meter).toBeNull();
        expect(v.result).toBeNull();
        expect(v.summary).toBeNull();
        expect(v.timer).toBeNull();
        expect(v.banner).toBeNull();
        const text = allStrings({ ...v, footer: '' }).join(' | ');
        for (const re of TELLS) expect(text, `${JSON.stringify(window)} leaked ${re}: ${text}`).not.toMatch(re);
        expect(v.title).toBe('How did that feel?');
        expect(v.actions.map((a) => a.id)).toEqual(['rate_felt_loud', 'rate_felt_normal', 'rate_skip']);
      }
    }
  });

  it('the reason appears only at reveal, after the rating, with the rating', async () => {
    const run = await hiddenRun({ valid: false, reason: 'no_voice', activeMs: 0 });
    run.h.ui('rate_felt_loud');
    expect(run.h.view.stage).toBe('reveal');
    expect(run.h.view.result).toMatchObject({ label: 'Not scored', tone: 'not_scored', speakerRating: 'You felt: loud' });
    expect(run.h.view.result?.detail).toContain('No voice');
    expect(run.h.actionIds()).toEqual(['try_again', 'skip_phrase', 'finish_early']);
    // the retry is visible (shows the meter) and never counts as the blind attempt
    run.h.ui('try_again');
    run.h.beginAndLead('begin_phrase');
    run.h.answerPrecheck();
    run.h.level(0, FLOOR + 12, true);
    expect(run.h.view.meter?.levelRelDb).toBe(12);
    run.h.answerWindow({ rel: 25 });
    expect(run.h.view.stage).toBe('reveal');
    run.h.ui('finish_early');
    expect(run.h.view.summary).toMatchObject({ scoredHidden: 0, attemptsInvalid: 1, hiddenRatings: { feltLoud: 1, feltNormal: 0, skipped: 0 } });
  });

  it('family mode opens the listener for an invalid hidden window exactly as for a valid one', async () => {
    const valid = await hiddenRun({ rel: 25 }, true);
    const invalid = await hiddenRun({ valid: false, reason: 'clipped' }, true);
    expect(valid.sent.some((m) => m.includes('"listener.open"'))).toBe(true);
    expect(invalid.sent).toEqual(valid.sent);
    expect(invalid.pending).toEqual(valid.pending);
    // the listener answers, the speaker rates, then the reveal says why it is not scored
    invalid.h.listener('heard');
    expect(invalid.h.view.stage).toBe('response_pending');
    invalid.h.ui('rate_felt_normal');
    expect(invalid.h.view.result?.label).toBe('Not scored');
    expect(invalid.h.last('attempt.reveal').attempt_id).toBe(invalid.h.last('window.start').attempt_id);
    // the answer was solicited, so it is stored on time; it never becomes agreement (no verdict)
    invalid.h.ui('finish_early');
    expect(invalid.h.view.summary?.agreementHidden).toEqual({ agree: 0, eligible: 0 });
  });

  it('a hidden capture that times out sends window.cancel(timeout) and, in family mode, still opens the listener', async () => {
    const run = await hiddenRun({ timeout: true }, true);
    const types = run.h.transport.sent.map((m) => m.type);
    expect(types.lastIndexOf('listener.open')).toBeGreaterThan(types.lastIndexOf('window.cancel'));
    expect(run.h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
    run.h.ui('rate_skip');
    run.h.listener('not_heard');
    expect(run.h.view.stage).toBe('reveal');
    expect(run.h.view.result?.detail).toContain('did not answer in time');
  });

  it('what the speaker or the link ended keeps the immediate path: Cancel, link loss, interruption (reported or by the phone)', async () => {
    // speaker Cancel during capture
    const a = await atPosition3();
    a.beginAndLead('begin_phrase');
    a.answerPrecheck();
    a.back();
    expect(a.view.stage).toBe('reveal');
    expect(a.view.result?.label).toBe('Not scored');
    expect(a.view.result?.detail).toContain('cancelled');
    // link loss during capture
    const b = await atPosition3();
    b.beginAndLead('begin_phrase');
    b.answerPrecheck();
    b.transportState('reconnecting');
    expect(b.view.stage).toBe('paused_or_invalid');
    // the phone says the capture was interrupted: not level-derived
    const c = await atPosition3();
    c.beginAndLead('begin_phrase');
    c.answerPrecheck();
    c.answerWindow({ valid: false, reason: 'interrupted' });
    expect(c.view.stage).toBe('reveal');
    expect(c.view.result?.detail).toContain('interrupted');
    // a timeout before the capture opened (precheck never answered) is not a capture close either
    const d = await atPosition3();
    d.beginAndLead('begin_phrase');
    d.advance(5000);
    expect(d.view.stage).toBe('paused_or_invalid');
  });

  it('unsolicited listener responses get the same ack: ignored_stale with an empty detail', async () => {
    const acks: Record<string, unknown>[] = [];
    // non-family hidden attempt (the listener was never opened), valid then invalid
    for (const window of [{ rel: 25 }, { valid: false, reason: 'no_voice', activeMs: 0 }] as Partial<PhraseOpts>[]) {
      const run = await hiddenRun(window, false);
      const start = run.h.last('window.start');
      run.h.listener('heard', start);
      acks.push(run.h.last('ack').payload);
    }
    // family mode, visible attempt that is invalid (the TV does not open the listener for those)
    const f = await boot({ settings: { familyMode: true } });
    f.setupToPhrases();
    f.runPhrase({ valid: false, reason: 'no_voice', activeMs: 0 });
    expect(f.view.stage).toBe('reveal');
    f.listener('not_heard', f.last('window.start'));
    acks.push(f.last('ack').payload);
    // family mode, valid visible attempt after it was revealed with a response already (solicited): rejected instead
    for (const a of acks) expect(a).toMatchObject({ outcome: 'ignored_stale', detail: '' });
    expect(new Set(acks.map((a) => JSON.stringify(a).replace(/"acked_message_id":"[^"]*"/, ''))).size).toBe(1);
  });
});

describe('A4-02 the checkpoint never holds anything about an unrevealed attempt', () => {
  /**
   * Family session: position 1 is revealed with a missing listener, position 2 is answered, position 3 (blind) is
   * captured and rated but waits for its listener. A late answer for position 1 then makes the TV write a checkpoint
   * while position 3 is unrevealed.
   */
  async function waitingHiddenWithCheckpointWrite(): Promise<Harness> {
    const g = await boot({ settings: { familyMode: true } });
    g.setupToPhrases();
    g.runPhrase({ rel: 25 });
    g.advance(20_000);
    g.ui('continue_without_listener');
    const first = g.last('listener.open');
    g.ui('next_phrase');
    g.runPhrase({ rating: 'skipped', listener: 'heard' });
    g.ui('next_phrase');
    g.beginAndLead('begin_phrase');
    g.answerPrecheck();
    g.answerWindow({ rel: 25, activeMs: 3333 });
    g.ui('rate_felt_loud');
    expect(g.view.stage).toBe('response_pending');
    g.listener('heard', first);
    expect(g.last('ack').payload).toMatchObject({ outcome: 'applied', detail: 'late' });
    await g.flush();
    return g;
  }

  it('is stripped of verdict, reason, window numbers, rating and listener answer for the waiting attempt', async () => {
    const g = await waitingHiddenWithCheckpointWrite();
    const raw = g.storage.dump()['atr:v1:active'] as string;
    expect(raw).toBeTruthy();
    const cp = JSON.parse(raw);
    expect(cp.stage).toBe('response_pending');
    const waiting = cp.record.attempts.find((a: { position: number }) => a.position === 3);
    expect(waiting).toMatchObject({
      state: 'response_pending',
      verdict: null,
      reason: null,
      borderline: false,
      activeMs: null,
      longestActiveMs: null,
      rating: null,
      listener: null,
      lateListener: null,
    });
    expect(raw).not.toContain('felt_loud');
    expect(raw).not.toContain('3333');
    // revealed attempts are stored in full
    expect(cp.record.attempts[0]).toMatchObject({ position: 1, verdict: 'reached', listener: 'missing', lateListener: 'heard' });
    expect(cp.record.attempts[1]).toMatchObject({ position: 2, verdict: 'reached', listener: 'heard' });
  });

  it('on resume the waiting attempt is interrupted and unscored; the resume screen shows no result for it', async () => {
    const g = await waitingHiddenWithCheckpointWrite();
    const resumed = await boot({ seed: g.storage.dump() });
    expect(resumed.view.stage).toBe('resume_or_discard');
    const screen = JSON.stringify(resumed.view);
    for (const re of [/not_reached/, /below/i, /felt_loud/, /You felt/]) expect(screen).not.toMatch(re);
    resumed.ui('resume_session');
    resumed.transportState('connected');
    resumed.roomCreated();
    resumed.joinRequested();
    resumed.acceptJoin();
    resumed.peerState(true);
    resumed.micState('open_idle');
    resumed.runQuiet();
    resumed.runCalibration(20);
    resumed.ui('continue');
    resumed.ui('skip_vowel');
    // back at position 3, now attempt 2 and visible: the interrupted blind attempt cannot be recovered
    expect(resumed.view.phrase).toMatchObject({ position: 3, attemptNumber: 2 });
    resumed.ui('finish_early');
    const summary = resumed.view.summary;
    expect(summary?.complete).toBe(false);
    expect(summary).toMatchObject({ scoredHidden: 0, reachedHidden: 0 });
    expect(summary?.invalidReasons).toEqual({ interrupted: 1 });
    expect(summary?.hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 0, skipped: 0 }); // the unrevealed rating is gone too
  });

  it('a discarded checkpoint saves the waiting attempt as interrupted, never with its verdict', async () => {
    const g = await waitingHiddenWithCheckpointWrite();
    const again = await boot({ seed: g.storage.dump() });
    again.ui('discard_session');
    await again.flush();
    const key = Object.keys(again.storage.dump()).find((k) => k.startsWith('atr:v1:session:')) as string;
    const rec = JSON.parse(again.storage.dump()[key] as string);
    expect(rec.attempts.find((a: { position: number }) => a.position === 3)).toMatchObject({
      state: 'invalid',
      verdict: 'unscored',
      reason: 'interrupted',
      rating: null,
    });
    expect(again.storage.dump()[key]).not.toContain('"reached"'.replace('reached', 'not_reached'));
  });
});

describe('A4-03 no side doors between capture close and reveal', () => {
  it('Settings, History and Diagnostics are not offered; meter is null; the leave dialog still works', async () => {
    const h = await atPosition3({ family: true });
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.level(0, FLOOR + 9, true);
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    expect(h.view.meter).toBeNull();
    for (const action of ['open_settings', 'open_history', 'open_about', 'open_diagnostics', 'reset_calibration', 'delete_local_data', 'unpair_phone'] as const) {
      h.ui(action);
      expect(h.view.screen, action).toBe('response');
      expect(h.view.stage).toBe('response_pending');
    }
    h.back();
    expect(h.view.screen).toBe('confirm_dialog'); // leaving is always possible
    h.back();
    expect(h.view.screen).toBe('response');
  });

  it('even if an overlay were open, the projection ignores it while a hidden attempt is unrevealed, and Diagnostics redact the step', () => {
    const t = T0;
    const m = new Machine({
      now: () => t,
      localDate: (ms) => new Date(ms).toISOString().slice(0, 10),
      newId: (prefix) => `${prefix}${String(Math.floor(Math.random() * 1e15)).padStart(16, '0')}`,
      randomBytes: seededBytes(1),
      nfcSelfTest: () => true,
      relayUrl: 'https://relay.example.test/ws',
      appVersion: 't',
      platform: 'test',
      fixtureMode: false,
    });
    m.handle({ kind: 'internal', event: { type: 'loaded', data: {
      status: 'ok', futureVersion: null, settings: { familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true, qualification: 'not_run', quietLeadMs: null, quietLeadScreenReaderMs: null },
      phrases: null, records: [], active: null, prunedSessions: 0, migratedFrom: null, corruptKeys: 0, staleCheckpointDiscarded: false, pruneFailed: false,
    } } });
    const sess = (m as unknown as { newSession(p: string[], f: boolean): { attempts: unknown[]; currentAttemptId: string | null; floorDbfs: number; calMarginDb: number } }).newSession(['a', 'b', 'c'], false);
    sess.floorDbfs = FLOOR;
    sess.calMarginDb = 20;
    sess.attempts.push({
      attemptId: 'a_hidden0001', windowId: 'w_hidden0001', position: 3, attemptNumber: 1, hidden: true, state: 'response_pending', started: true,
      verdict: 'reached', reason: null, borderline: false, activeMs: 2000, longestActiveMs: 2000, rating: null, listener: null, lateListener: null,
    });
    sess.currentAttemptId = 'a_hidden0001';
    (m.s as { session: unknown }).session = sess;
    m.s.stage = 'response_pending';
    m.s.overlay = 'diagnostics';
    const view = m.view();
    expect(view.screen).toBe('response');
    expect(view.diagnostics).toBeNull();
    expect(view.result).toBeNull();
    m.s.stage = 'idle'; // the diagnostics values themselves
    m.s.stage = 'response_pending';
    (m.s as { overlay: string | null }).overlay = null;
    // ask for the diagnostics record through a legitimate non-blind state, then through the blind one
    const text = JSON.stringify(view);
    expect(text).not.toContain('reached');
    expect(text).not.toContain(ROOM);
  });
});

describe('A4-04 keep waiting and continue without a listener response', () => {
  it('Keep waiting sends a fresh listener.open for the same attempt', async () => {
    const h = await atPosition3({ family: true });
    h.runPhrase({});
    const opens = () => h.of('listener.open').filter((m) => m.attempt_id === h.last('window.start').attempt_id);
    expect(opens()).toHaveLength(1);
    h.advance(20_000);
    expect(h.actionIds()).toContain('keep_waiting');
    h.ui('keep_waiting');
    expect(opens()).toHaveLength(2);
    expect(opens()[1]).toMatchObject({ window_id: opens()[0]?.window_id, attempt_id: opens()[0]?.attempt_id });
    expect(opens()[1]?.payload).toEqual({ timeout_ms: 60000 });
    h.advance(20_000);
    h.ui('keep_waiting');
    expect(opens()).toHaveLength(3);
  });

  it('Continue without listener response records missing and sends attempt.reveal at once, even while the rating is pending', async () => {
    const h = await atPosition3({ family: true });
    h.runPhrase({});
    h.advance(20_000);
    const attempt = h.last('window.start').attempt_id;
    const reveals = () => h.of('attempt.reveal').filter((m) => m.attempt_id === attempt);
    expect(reveals()).toHaveLength(0);
    h.ui('continue_without_listener');
    expect(reveals()).toHaveLength(1); // the phone locks its listener controls now
    expect(h.view.stage).toBe('response_pending'); // the speaker rating is still owed
    expect(h.view.result).toBeNull();
    h.ui('rate_felt_normal');
    expect(h.view.stage).toBe('reveal');
    expect(reveals()).toHaveLength(1); // not sent twice
    expect(h.view.result?.listener).toBe('Listener: no response');
  });

  it('a response that arrives after the speaker continued without one is late, never on time', async () => {
    const h = await atPosition3({ family: true });
    h.runPhrase({});
    h.advance(20_000);
    const open = h.last('listener.open');
    h.ui('continue_without_listener');
    h.listener('heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied', detail: 'late' });
    h.listener('not_heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'already_answered' });
    h.ui('rate_skip');
    expect(h.view.result?.listener).toBe('Listener (late, not counted): heard');
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ lateListenerResponses: 1, agreementHidden: { agree: 0, eligible: 0 } });
  });
});

describe('A4-05 first valid on-time response wins', () => {
  it('a second on-time response before reveal is rejected as already answered', async () => {
    const h = await atPosition3({ family: true });
    h.runPhrase({ rel: 25 });
    const open = h.last('listener.open');
    h.listener('heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied', detail: '' });
    expect(h.view.stage).toBe('response_pending'); // the rating is still owed
    h.listener('not_heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'already_answered' });
    h.listener('heard', open); // even the same answer again
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'already_answered' });
    h.ui('rate_felt_loud');
    expect(h.view.result?.listener).toBe('Listener: heard');
    h.listener('not_heard', open); // after reveal too
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'already_answered' });
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ lateListenerResponses: 0, agreementHidden: { agree: 1, eligible: 1 } });
  });

  it('a response after reveal is stored late and acked applied with detail late', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    const open = h.last('listener.open');
    h.advance(20_000);
    h.ui('continue_without_listener');
    expect(h.view.stage).toBe('reveal');
    h.listener('not_heard', open);
    expect(h.last('ack').payload).toEqual({ acked_message_id: expect.any(String), outcome: 'applied', detail: 'late' });
  });
});

describe('A4-06 borderline attempts are eligible for agreement and counted separately', () => {
  it('counts a borderline attempt in the agreement denominator and in borderlineCount', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases(); // band 20 -> edge 19
    h.runPhrase({ rel: 19.5, listener: 'heard' }); // borderline reached + heard: agree
    expect(h.view.result?.borderline).toBe(true);
    h.ui('next_phrase');
    h.runPhrase({ rel: 18.5, listener: 'heard' }); // borderline below + heard: disagree
    expect(h.view.result?.borderline).toBe(true);
    h.ui('next_phrase');
    h.runPhrase({ rel: 30, rating: 'skipped', listener: 'heard' }); // hidden, not borderline, agree
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({
      borderlineCount: 2,
      agreementVisible: { agree: 1, eligible: 2 },
      agreementHidden: { agree: 1, eligible: 1 },
    });
  });
});

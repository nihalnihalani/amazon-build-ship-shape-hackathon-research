/**
 * window_id is unique per measurement (protocol revision 4): every precheck and every capture window has its
 * own window_id. A pre-window precheck and the capture that follows share the attempt's attempt_id. The phone
 * treats window ids as single-use, so reusing one makes it answer ack ignored_stale and never open the capture.
 */

import { describe, expect, it } from 'vitest';
import { boot } from './helpers.js';
import type { Harness, Sent } from './helpers.js';

function phoneSays(h: Harness, type: 'precheck.result' | 'window.result', payload: Record<string, unknown>, ids: Sent): void {
  h.wire(h.envelope(type, 'phone', payload, h.ids(ids)));
}

/** A model of the phone's single-use rule: a window_id may open exactly one measurement. */
function assertSingleUse(h: Harness): void {
  const seen = new Map<string, string>();
  for (const m of h.transport.sent) {
    if (m.type !== 'precheck.start' && m.type !== 'window.start') continue;
    const id = m.window_id as string;
    expect(seen.has(id), `${m.type} reuses window_id ${id} already used by ${seen.get(id)}`).toBe(false);
    seen.set(id, m.type);
  }
}

describe('one window_id per measurement', () => {
  it('a phrase attempt: precheck and capture have different window_ids and the same attempt_id', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const pre = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')[0] as Sent;
    expect(pre.window_id).toMatch(/^w_/);
    h.answerPrecheck();
    const start = h.of('window.start').filter((m) => m.payload.kind === 'phrase')[0] as Sent;
    expect(start.window_id).toMatch(/^w_/);
    expect(start.window_id).not.toBe(pre.window_id);
    expect(start.attempt_id).toBe(pre.attempt_id);
    expect(start.session_id).toBe(pre.session_id);
    h.answerWindow({ rel: 25 }, start);
    // listener, reveal and any later message for the attempt carry the capture's window_id
    expect(h.last('listener.open')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
    h.listener('heard');
    expect(h.last('attempt.reveal')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
    assertSingleUse(h);
  });

  it('a gated vowel does the same; the calibration capture and the quiet check each have their own ids', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    const quiet = h.last('precheck.start');
    h.runCalibration(20);
    const cal = h.last('window.start');
    expect(cal.window_id).not.toBe(quiet.window_id);
    expect(cal.attempt_id).not.toBe(quiet.attempt_id);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    const pre = h.last('precheck.start');
    h.answerPrecheck();
    const vowel = h.last('window.start');
    expect(pre.payload.purpose).toBe('pre_window');
    expect(vowel.payload.kind).toBe('vowel');
    expect(vowel.window_id).not.toBe(pre.window_id);
    expect(vowel.attempt_id).toBe(pre.attempt_id);
    assertSingleUse(h);
  });

  it('a whole session never reuses a window_id, and every attempt_id appears only on its own precheck and capture', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.ok();
    h.answerWindow({ rel: 22, longest: 9000 });
    h.ui('continue');
    h.finishAllPhrases();
    expect(h.view.stage).toBe('summary');
    assertSingleUse(h);
    const byAttempt = new Map<string, string[]>();
    for (const m of h.transport.sent) {
      if (m.type !== 'precheck.start' && m.type !== 'window.start') continue;
      byAttempt.set(m.attempt_id as string, [...(byAttempt.get(m.attempt_id as string) ?? []), m.type]);
    }
    for (const [attempt, types] of byAttempt) {
      expect(['precheck.start', 'window.start'].filter((t) => types.filter((x) => x === t).length > 1), attempt).toEqual([]);
      expect(types.length, attempt).toBeLessThanOrEqual(2);
    }
    // quiet check (1) + calibration (1) + vowel (1) + 10 phrases = 13 attempts
    expect(byAttempt.size).toBe(13);
  });

  it('a retry gets a new attempt_id and new window_ids for both its precheck and its capture', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    const firstPre = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')[0] as Sent;
    const firstStart = h.of('window.start').filter((m) => m.payload.kind === 'phrase')[0] as Sent;
    h.ui('try_again');
    h.runPhrase({});
    const pres = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window');
    const starts = h.of('window.start').filter((m) => m.payload.kind === 'phrase');
    const retryPre = pres[1] as Sent;
    const retryStart = starts[1] as Sent;
    expect(retryPre.attempt_id).not.toBe(firstPre.attempt_id);
    expect(retryPre.window_id).not.toBe(firstPre.window_id);
    expect(retryPre.window_id).not.toBe(firstStart.window_id);
    expect(retryStart.attempt_id).toBe(retryPre.attempt_id);
    expect(retryStart.window_id).not.toBe(retryPre.window_id);
    expect(retryStart.window_id).not.toBe(firstStart.window_id);
    assertSingleUse(h);
  });

  it('a blocked precheck leaves its own window_id behind; the next try uses fresh ids for both steps', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const blockedPre = h.last('precheck.start');
    h.answerPrecheck({}, 9);
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
    h.ui('retry');
    h.runPhrase({});
    const pres = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window');
    const start = h.of('window.start').filter((m) => m.payload.kind === 'phrase')[0] as Sent;
    expect(pres).toHaveLength(2);
    expect(pres[1]?.window_id).not.toBe(blockedPre.window_id);
    expect(pres[1]?.attempt_id).not.toBe(blockedPre.attempt_id);
    expect(start.window_id).not.toBe(pres[1]?.window_id);
    assertSingleUse(h);
  });
});

describe('stale filtering is per window_id', () => {
  it('during the capture, results addressed to the precheck window or the other kind are ignored', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const pre = h.last('precheck.start');
    h.answerPrecheck();
    const start = h.last('window.start');
    const acks = h.of('ack').length;

    // a late duplicate precheck.result for the precheck window
    phoneSays(h, 'precheck.result', h.precheckPayload('pre_window'), pre);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.last('ack').window_id).toBe(pre.window_id);
    // a precheck.result addressed to the capture's window_id (wrong kind for an open capture)
    phoneSays(h, 'precheck.result', h.precheckPayload('pre_window'), start);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.last('ack').window_id).toBe(start.window_id);
    // a window.result addressed to the precheck's window_id
    phoneSays(h, 'window.result', h.windowPayload('phrase', { rel: 30 }), pre);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.last('ack').window_id).toBe(pre.window_id);

    expect(h.of('ack')).toHaveLength(acks + 3);
    expect(h.view.stage).toBe('phrase_active');
    expect(h.view.capturing).toBe(true);
    // the real result, addressed to the capture window, is applied
    h.answerWindow({ rel: 25 }, start);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
    expect(h.view.stage).toBe('reveal');
  });

  it('during the precheck, a window.result for the precheck window and level frames are stale', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const pre = h.last('precheck.start');
    phoneSays(h, 'window.result', h.windowPayload('phrase', {}), pre);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.level(0, -40, true, pre);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.stage).toBe('phrase_active');
    expect(h.view.meter).toBeNull();
    h.answerPrecheck();
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(1);
  });

  it('a window.cancel names the measurement that is open: the precheck during the precheck, the capture during the capture', async () => {
    const a = await boot();
    a.setupToPhrases();
    a.beginAndLead('begin_phrase');
    const pre = a.last('precheck.start');
    a.back();
    expect(a.last('window.cancel')).toMatchObject({ window_id: pre.window_id, attempt_id: pre.attempt_id });

    const b = await boot();
    b.setupToPhrases();
    b.beginAndLead('begin_phrase');
    const pre2 = b.last('precheck.start');
    b.answerPrecheck();
    const start = b.last('window.start');
    b.back();
    expect(b.last('window.cancel')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
    expect(b.last('window.cancel').window_id).not.toBe(pre2.window_id);
  });

  it('a precheck that times out is cancelled under its own window_id and no capture ever starts', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const pre = h.last('precheck.start');
    h.advance(5_000);
    expect(h.last('window.cancel')).toMatchObject({ window_id: pre.window_id, attempt_id: pre.attempt_id });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
    // a very late precheck.result for the cancelled measurement is stale
    h.answerPrecheck();
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
  });

  it('a late window.result for a capture that was interrupted never applies to the retry (new ids)', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const oldStart = h.last('window.start');
    h.transportState('reconnecting');
    h.transportState('connected');
    h.authOk({ generation: 2 });
    h.micState('open_idle');
    h.ui('retry');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    expect(h.last('window.start').window_id).not.toBe(oldStart.window_id);
    h.answerWindow({ rel: 25 }, oldStart); // addressed to the dead capture
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.stage).toBe('phrase_active');
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('reveal');
  });
});

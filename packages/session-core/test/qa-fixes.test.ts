/**
 * Fixes for the independent QA review (docs/evaluation/QA_REVIEW_T11_T13_T14.md): QA-02/07 crash ordering,
 * QA-03 must-deliver commands while the link is down, QA-04 bank under the cursor, QA-05 phone-visible stage.
 */

import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { PHRASES_FIXTURE } from './qa-fixture.js';
import { ROOM, T0, boot, createFlakyStorage, seededBytes } from './helpers.js';
import type { Harness } from './helpers.js';

describe('QA-03 commands that must reach the phone are queued while the link is down', () => {
  async function pausedOffline(): Promise<Harness> {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.transportState('reconnecting'); // window cancelled; the cancel cannot be delivered yet
    expect(h.view.stage).toBe('paused_or_invalid');
    return h;
  }

  it('session.end from Finish early is sent after the link and the phone are back, once, after the window.cancel', async () => {
    const h = await pausedOffline();
    const sessionId = h.last('session.begin').session_id;
    h.ui('finish_early');
    expect(h.view.stage).toBe('summary');
    expect(h.of('session.end')).toHaveLength(0);
    h.transportState('connected');
    h.authOk({ generation: 2, peer: true, paired: true });
    expect(h.of('session.end')).toHaveLength(1);
    expect(h.last('session.end')).toMatchObject({ session_id: sessionId, producer_generation: 2 });
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
    const types = h.transport.sent.map((m) => m.type);
    expect(types.lastIndexOf('session.end')).toBeGreaterThan(types.lastIndexOf('window.cancel'));
    expect(h.last('window.cancel').payload).toEqual({ reason: 'link_lost' });
    h.micState('open_idle');
    h.ui('done');
    expect(h.of('session.end')).toHaveLength(1); // not repeated
  });

  it('Leave (Back, confirm) while offline is queued the same way', async () => {
    const h = await pausedOffline();
    h.back();
    h.ui('confirm_destructive');
    expect(h.view.screen).toBe('home');
    expect(h.of('session.end')).toHaveLength(0);
    h.transportState('connected');
    h.authOk({ generation: 2 });
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
  });

  it('waits for the phone as well: auth.ok without the phone keeps it queued until peer.state says it is back', async () => {
    const h = await pausedOffline();
    h.ui('finish_early');
    h.transportState('connected');
    h.authOk({ generation: 2, peer: false, paired: true });
    expect(h.of('session.end')).toHaveLength(0);
    h.peerState(true, 2);
    expect(h.of('session.end')).toHaveLength(1);
  });

  it('an end is not sent twice and a pairing the relay ended drops what can no longer be delivered', async () => {
    const h = await pausedOffline();
    h.ui('finish_early');
    h.relayError('revoked'); // the room is gone: nothing queued can be delivered
    h.transportState('connected');
    h.roomCreated({ generation: 1 });
    expect(h.of('session.end')).toHaveLength(0);
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.of('session.end')).toHaveLength(0);
  });

  it('while the link is up it is sent immediately', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('finish_early');
    expect(h.of('session.end')).toHaveLength(1);
  });
});

describe('QA-02 / QA-07 crash ordering and a failed final write', () => {
  it('a crash after the record was written but before the checkpoint was cleared never offers Resume for the finished session', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage });
    h.phrases(['Only phrase.']);
    h.setupToPhrases();
    h.runPhrase({});
    await h.flush();
    expect(Object.keys(storage.dump())).toContain('atr:v1:active');
    storage.dieAfterWriteOf = 'atr:v1:index'; // the record and the index land, the checkpoint removal is lost
    h.ui('next_phrase');
    await h.flush();
    expect(h.view.summary?.complete).toBe(true);
    const disk = storage.dump();
    expect(Object.keys(disk)).toContain('atr:v1:active');
    const recordKey = Object.keys(disk).find((k) => k.startsWith('atr:v1:session:')) as string;
    expect(JSON.parse(disk[recordKey] as string)).toMatchObject({ complete: true, endReason: 'completed' });

    const after = await boot({ seed: disk });
    expect(after.view.screen).toBe('home');
    expect(after.view.stage).toBe('idle');
    await after.flush();
    expect(Object.keys(after.storage.dump())).not.toContain('atr:v1:active');
    expect(JSON.parse(after.storage.dump()[recordKey] as string)).toMatchObject({ complete: true, endReason: 'completed' });
  });

  it('a checkpoint written after an incomplete record of the same session (a resumed run) is still offered', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage });
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('next_phrase');
    h.back();
    h.ui('confirm_destructive'); // leave: an incomplete record is saved and the checkpoint cleared
    await h.flush();
    const rec = JSON.parse(h.storage.dump()[Object.keys(h.storage.dump()).find((k) => k.startsWith('atr:v1:session:')) as string] as string);
    expect(rec.complete).toBe(false);
    const cp = {
      version: 1,
      savedAt: rec.endedAt + 60_000, // later than the saved record: the session was resumed and crashed again
      stage: 'phrase_ready',
      phraseCount: 10,
      phraseIdx: 1,
      record: { ...rec, endedAt: rec.endedAt + 60_000 },
    };
    const again = await boot({ seed: { ...h.storage.dump(), 'atr:v1:active': JSON.stringify(cp) } });
    expect(again.view.stage).toBe('resume_or_discard');
    // but a record written after the checkpoint means the session ended after it
    const older = { ...cp, savedAt: rec.endedAt - 60_000 };
    const dropped = await boot({ seed: { ...h.storage.dump(), 'atr:v1:active': JSON.stringify(older) } });
    expect(dropped.view.stage).toBe('idle');
  });

  it('Discard never overwrites a record that is already final', () => {
    const m = new Machine({
      now: () => T0,
      localDate: (ms) => new Date(ms).toISOString().slice(0, 10),
      newId: (prefix) => `${prefix}${String(Math.floor(Math.random() * 1e15)).padStart(16, '0')}`,
      randomBytes: seededBytes(1),
      nfcSelfTest: () => true,
      relayUrl: 'https://relay.example.test/ws',
      appVersion: 't',
      platform: 'test',
      fixtureMode: false,
    });
    const attempt = {
      attemptId: 'a_attempt0001', windowId: 'w_window00001', position: 1, attemptNumber: 1, hidden: false, state: 'revealed', started: true,
      verdict: 'reached', reason: null, borderline: false, activeMs: 2000, longestActiveMs: 2000, rating: null, listener: null, lateListener: null,
    };
    const finished = {
      sessionId: 's_finished01', startedAt: T0 - 5000, endedAt: T0 - 1000, localDate: '2026-10-05', complete: true, endReason: 'completed', resumed: false,
      familyMode: false, phraseCount: 10, calMarginDb: 20, cuesUsed: 0, attempts: [attempt], vowels: [], skipped: [],
    };
    const checkpoint = {
      version: 1 as const, savedAt: T0 - 2000, stage: 'phrase_ready', phraseCount: 10, phraseIdx: 1,
      record: { ...finished, complete: false, endReason: 'interrupted', endedAt: T0 - 2000 },
    };
    m.handle({ kind: 'internal', event: { type: 'loaded', data: {
      status: 'ok', futureVersion: null, settings: { familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true, qualification: 'not_run', quietLeadMs: null, quietLeadScreenReaderMs: null },
      phrases: null, records: [finished as never], active: checkpoint as never, prunedSessions: 0, migratedFrom: null, corruptKeys: 0,
      staleCheckpointDiscarded: false, pruneFailed: false, finishedCheckpointDropped: false,
    } } });
    expect(m.s.stage).toBe('resume_or_discard');
    const effects = m.handle({ kind: 'ui', action: 'discard_session' });
    const ops = effects.filter((e) => e.kind === 'persist').map((e) => (e.kind === 'persist' ? e.op.op : ''));
    expect(ops).toEqual(['clear_checkpoint']);
    expect(m.s.records).toHaveLength(1);
    expect(m.s.records[0]).toMatchObject({ complete: true, endReason: 'completed' });
  });

  it('when the final record cannot be saved the checkpoint is kept, an error is shown, and the next launch can recover', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage });
    h.phrases(['Only phrase.']);
    h.setupToPhrases();
    h.runPhrase({});
    await h.flush();
    expect(Object.keys(storage.dump())).toContain('atr:v1:active');
    storage.failSetPrefix = 'atr:v1:session:';
    h.ui('next_phrase');
    await h.flush();
    expect(h.view.stage).toBe('summary');
    expect(h.view.banner).toMatchObject({ kind: 'error' });
    expect(h.view.banner?.text).toContain('Could not save this session');
    expect(h.view.banner?.text).toContain('kept so you can recover');
    const disk = storage.dump();
    expect(Object.keys(disk).some((k) => k.startsWith('atr:v1:session:'))).toBe(false);
    expect(Object.keys(disk)).toContain('atr:v1:active');
    const after = await boot({ seed: disk });
    expect(after.view.stage).toBe('resume_or_discard');
  });

  it('a successful save still clears the checkpoint, after the record', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage });
    h.phrases(['Only phrase.']);
    h.setupToPhrases();
    h.runPhrase({});
    await h.flush();
    storage.setCalls.length = 0;
    h.ui('next_phrase');
    await h.flush();
    const writes = storage.setCalls.filter((k) => k.startsWith('atr:v1:session:') || k === 'atr:v1:index');
    expect(writes.length).toBe(2);
    expect(Object.keys(storage.dump())).not.toContain('atr:v1:active');
  });
});

describe('QA-04 a phrases.update after a skip never leaves the cursor beyond the bank', () => {
  it('skipping fixes the bank for this session: the update applies to the next session', async () => {
    const h = await boot();
    h.phrases(PHRASES_FIXTURE.slice(0, 3));
    h.setupToPhrases();
    expect(h.view.phrase).toMatchObject({ position: 1, total: 3 });
    h.ui('skip_phrase');
    expect(h.view.phrase).toMatchObject({ position: 2, total: 3, text: PHRASES_FIXTURE[1] });
    h.phrases(['Only one phrase now.']);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied', detail: 'next_session' });
    expect(h.view.banner?.text).toContain('next session');
    expect(h.view.phrase).toMatchObject({ position: 2, total: 3, text: PHRASES_FIXTURE[1] });
    expect(h.view.phrase?.text.length).toBeGreaterThan(0);
    h.runPhrase({});
    h.ui('next_phrase');
    expect(h.view.phrase).toMatchObject({ position: 3, total: 3 });
    h.ui('skip_phrase');
    expect(h.view.stage).toBe('summary');
    h.ui('done');
    h.micState('off');
    h.ui('start_session');
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    expect(h.view.phrase).toMatchObject({ position: 1, total: 1, text: 'Only one phrase now.' });
  });

  it('a resumed session whose saved bank is shorter than the checkpoint position is clamped to a valid phrase', async () => {
    const g = await boot();
    g.phrases(PHRASES_FIXTURE.slice(0, 5));
    g.setupToPhrases();
    for (let i = 0; i < 4; i += 1) {
      g.runPhrase({ rating: 'skipped' });
      g.ui('next_phrase');
    }
    g.beginAndLead('begin_phrase');
    g.answerPrecheck();
    await g.flush();
    const dump = { ...g.storage.dump() };
    dump['atr:v1:phrases'] = JSON.stringify({ phrases: ['Short bank.'] });
    const h = await boot({ seed: dump });
    h.ui('resume_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    const p = h.view.phrase;
    expect(p?.position ?? 0).toBeLessThanOrEqual(p?.total ?? 0);
    expect(p?.text.length).toBeGreaterThan(0);
  });
});

describe('QA-05 the phone never sees response_pending or reveal', () => {
  async function stagesSent(family: boolean): Promise<string[][]> {
    const h = await boot({ settings: { familyMode: family } });
    h.phrases(PHRASES_FIXTURE.slice(0, 4));
    h.setupToPhrases();
    const perPosition: string[][] = [];
    for (let p = 1; p <= 4; p += 1) {
      const mark = h.of('session.state').length;
      h.runPhrase({ rel: 25, rating: 'skipped', listener: 'heard' });
      expect(h.view.stage).toBe('reveal');
      perPosition.push(
        h
          .of('session.state')
          .slice(mark)
          .map((m) => `${m.payload.stage as string}:${m.payload.phrase_position as number}:${m.payload.listener_open_attempt === null ? 'n' : 'a'}`),
      );
      h.ui('next_phrase');
      // only now does the phone see the next phrase_ready (or the summary after the last one)
      if (p < 4) expect(h.last('session.state').payload.stage).toBe('phrase_ready');
      else expect(h.last('session.end').payload).toEqual({ reason: 'completed' }); // the summary is announced by session.end
    }
    const all = h.of('session.state').map((m) => m.payload.stage as string);
    expect(all).not.toContain('response_pending');
    expect(all).not.toContain('reveal');
    return perPosition;
  }

  it('speaker-only: every position (blind or not) produces the same session.state sequence shape', async () => {
    const seq = await stagesSent(false);
    const shape = (a: string[]) => a.map((x) => x.split(':')[0]);
    expect(seq.map(shape)).toEqual([shape(seq[0] as string[]), shape(seq[0] as string[]), shape(seq[0] as string[]), shape(seq[0] as string[])]);
    // from the capture start to the reveal the phone sees phrase_active once, and nothing for the rating or the reveal
    expect(shape(seq[0] as string[])).toEqual(['phrase_active']);
  });

  it('family mode: the listener is opened with listener_open_attempt (the explicit signal); stages stay phrase_active until the next phrase_ready', async () => {
    const seq = await stagesSent(true);
    for (const per of seq) {
      // capture start, listener opened (explicit signal), reveal: the stage never changes
      expect(per.map((x) => x.split(':')[0])).toEqual(['phrase_active', 'phrase_active', 'phrase_active']);
      expect(per.map((x) => x.split(':')[2])).toEqual(['n', 'a', 'n']);
    }
  });

  it('a blind position in speaker-only mode sends no state change at the result, rating or reveal', async () => {
    const h = await boot();
    h.phrases(PHRASES_FIXTURE.slice(0, 4));
    h.setupToPhrases();
    for (let p = 1; p <= 2; p += 1) {
      h.runPhrase({});
      h.ui('next_phrase');
    }
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const mark = h.of('session.state').length;
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    h.ui('rate_felt_loud');
    expect(h.view.stage).toBe('reveal');
    expect(h.of('session.state').length).toBe(mark);
  });
});

describe('copy: result wording follows ADR-0001', () => {
  it('no view or summary line says "the far side"', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.finishAllPhrases();
    h.ui('open_history');
    h.ui('done');
    for (const v of h.views) expect(JSON.stringify(v)).not.toMatch(/far side/i);
    expect(h.view.summary?.lines.join(' ')).not.toMatch(/far side/i);
  });

  it('join_confirm prefers Reject, never an accepting choice', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    expect(h.view.preferredAction).toBe('reject_join');
    expect(h.view.actions.map((a) => a.id)).toEqual(['pick_choice_1', 'pick_choice_2', 'pick_choice_3', 'reject_join']);
    void ROOM;
  });
});

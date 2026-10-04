import { describe, expect, it } from 'vitest';
import { FOOTER, STARTER_PHRASES } from '../src/index.js';
import { CREDENTIAL, FLOOR, PAIRING_CODE, ROOM, T0, boot, createFlakyStorage } from './helpers.js';

describe('full happy journey (pair, mic, quiet, calibration, vowel, 10 phrases, summary, history, delete)', () => {
  it('walks every stage in order with the right wire traffic and persists a complete session', async () => {
    const h = await boot();
    expect(h.view.screen).toBe('home');
    expect(h.view.footer).toBe(FOOTER);

    // --- pairing
    h.ui('start_session');
    expect(h.transport.connects).toEqual(['wss://relay.example.test/ws']);
    expect(h.view.stage).toBe('pairing');
    h.transportState('connected');
    const create = h.last('room.create');
    expect(create.payload).toEqual({ client: { app_version: '0.1.0-test', platform: 'test' } });
    expect(create.room_id).toBeNull();
    expect(create.producer_generation).toBe(0);
    h.roomCreated();
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
    expect(h.view.pairing?.qrPayload).toBe(`https://relay.example.test/#code=${PAIRING_CODE}`);
    h.joinRequested('Rohan phone', '47');
    expect(h.view.screen).toBe('join_confirm');
    // number matching (A3-06): three distinct two-digit choices, one of them the digits the phone shows; Reject preferred
    const join = h.view.pairing?.joinRequest;
    expect(join?.deviceLabel).toBe('Rohan phone');
    expect(join?.choices).toHaveLength(3);
    expect(new Set(join?.choices).size).toBe(3);
    expect(join?.choices.filter((c) => c === '47')).toHaveLength(1);
    for (const c of join?.choices ?? []) expect(c).toMatch(/^[0-9]{2}$/);
    expect(JSON.stringify(h.view)).not.toContain('confirmDigits');
    expect(h.view.body.join(' ')).toContain('Name the phone gave: Rohan phone');
    expect(h.view.preferredAction).toBe('reject_join');
    h.acceptJoin();
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000001', decision: 'accept' });
    h.peerState(true);
    expect(h.view.stage).toBe('permission_pending');
    const begin = h.last('session.begin');
    expect(begin.payload).toEqual({ family_mode: false, phrase_count: 10, cues_max: 3 });
    expect(begin.session_id).toMatch(/^s_/);
    expect(h.view.mic).toBe('unknown');
    h.micState('permission_pending');
    expect(h.view.mic).toBe('waiting_for_permission');
    h.micState('open_idle');
    expect(h.view.stage).toBe('quiet_check');
    expect(h.view.mic).toBe('open_not_measuring');

    // --- quiet check: precheck 5000 only after the 1500 ms quiet lead
    h.ui('begin_quiet_check');
    expect(h.view.capturing).toBe(true);
    expect(h.view.announcement).toBeNull();
    h.advance(1499);
    expect(h.of('precheck.start')).toHaveLength(0);
    h.advance(1);
    expect(h.last('precheck.start').payload).toEqual({ purpose: 'quiet_check', duration_ms: 5000 });
    h.answerPrecheck();
    expect(h.view.stage).toBe('calibration');
    expect(h.view.capturing).toBe(false);

    // --- calibration 6000 ms, accepted
    h.beginAndLead('begin_calibration');
    expect(h.last('window.start').payload).toEqual({
      kind: 'calibration',
      phrase_position: null,
      max_duration_ms: 6000,
      vad_floor_dbfs: FLOOR,
    });
    h.answerWindow({ rel: 20 });
    expect(h.view.result?.label).toBe("Today's band is set");
    expect(h.view.body.join(' ')).toContain('20.0 dB');
    h.ui('continue');
    expect(h.view.stage).toBe('vowel_ready');

    // --- vowel: gated by the pre-window precheck (a band exists), early stop, duration result
    h.beginAndLead('begin_vowel');
    expect(h.last('precheck.start').payload).toEqual({ purpose: 'pre_window', duration_ms: 2000 });
    h.answerPrecheck();
    expect(h.last('window.start').payload).toMatchObject({ kind: 'vowel', max_duration_ms: 30000, phrase_position: null });
    h.level(0, FLOOR + 10);
    h.advance(3000);
    expect(h.view.timer?.elapsedMs).toBe(3000);
    expect(h.view.timer?.maxMs).toBe(30000);
    h.ok();
    expect(h.last('window.stop').payload).toEqual({ reason: 'early_stop' });
    h.answerWindow({ rel: 20, longest: 14200, activeMs: 14500 });
    expect(h.view.stage).toBe('vowel_result');
    expect(h.view.result?.label).toBe("Reached today's relative level band (unqualified phone)");
    expect(h.view.result?.detail).toBe('Voice-activity duration: 14.2 s');
    h.ui('continue');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.phrase).toMatchObject({ position: 1, total: 10, text: STARTER_PHRASES[0], attemptNumber: 1 });

    // --- ten phrases, manual advance, hidden at 3/6/9
    const hiddenSeen: number[] = [];
    for (let i = 1; i <= 10; i += 1) {
      expect(h.view.stage).toBe('phrase_ready');
      expect(h.view.phrase?.position).toBe(i);
      h.runPhrase({ rating: 'felt_normal', rel: i % 4 === 0 ? 10 : 25 });
      if ([3, 6, 9].includes(i)) hiddenSeen.push(i);
      expect(h.view.stage).toBe('reveal');
      expect(h.view.result?.label).toBe(i % 4 === 0 ? "Below today's relative level band (unqualified phone)" : "Reached today's relative level band (unqualified phone)");
      h.advance(5000); // no auto-advance between phrases
      expect(h.view.stage).toBe('reveal');
      h.ui('next_phrase');
    }
    expect(hiddenSeen).toEqual([3, 6, 9]);
    expect(h.view.stage).toBe('summary');
    expect(h.last('session.end').payload).toEqual({ reason: 'completed' });
    const s = h.view.summary;
    expect(s?.complete).toBe(true);
    expect(s).toMatchObject({
      phrasesCompleted: 10,
      phrasesAttempted: 10,
      phrasesSkipped: 0,
      attemptsInvalid: 0,
      longestActiveMs: 14200,
      calibrationMarginDb: 20,
    });
    // positions 4 and 8 are below (visible); hidden 3, 6, 9 all reached
    expect(s).toMatchObject({ reachedHidden: 3, scoredHidden: 3, reachedVisible: 5, scoredVisible: 7 });
    expect(s?.hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 3, skipped: 0 });

    await h.flush();
    const keys = Object.keys(h.storage.dump());
    expect(keys.filter((k) => k.startsWith('atr:v1:session:'))).toHaveLength(1);
    const rec = JSON.parse(h.storage.dump()[keys.find((k) => k.startsWith('atr:v1:session:')) as string] as string);
    expect(rec.complete).toBe(true);
    expect(keys).not.toContain('atr:v1:active');

    // --- history: 7 days, today has the session, others missing
    h.ui('open_history');
    expect(h.view.screen).toBe('history');
    const days = h.view.history ?? [];
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ date: '2026-10-05', sessions: 1, reached: 8, scored: 10, incomplete: false });
    expect(days.slice(0, 6).every((d) => d.sessions === null && d.reached === null)).toBe(true);
    h.ui('done');
    expect(h.view.stage).toBe('summary');
    h.ui('done');
    expect(h.view.screen).toBe('home');
    expect(h.view.body.join(' ')).toContain('Last session, 2026-10-05: reached 8 of 10 scored.');

    // --- delete local data (confirm dialog, Cancel preferred) removes only atr: keys
    await h.storage.setItem('other:app:key', 'keep me');
    h.ui('open_settings');
    h.ui('delete_local_data');
    expect(h.view.screen).toBe('confirm_dialog');
    expect(h.view.dialog?.preferred).toBe('cancel');
    expect(h.view.preferredAction).toBe('cancel_destructive');
    h.ui('confirm_destructive');
    await h.flush();
    expect(Object.keys(h.storage.dump())).toEqual(['other:app:key']);
    expect(h.view.banner?.text).toContain('All local practice data was deleted.');
    expect(h.view.banner?.text).toContain('Relay cleanup');
    h.back();
    expect(h.view.screen).toBe('home');
    expect(h.view.body.join(' ')).toContain('No sessions saved');
  });

  it('never puts the credential or the pairing code outside the pairing screen', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    for (const v of h.views) {
      const json = JSON.stringify(v);
      expect(json).not.toContain(CREDENTIAL);
      expect(json).not.toContain(ROOM);
      if (v.screen !== 'pairing' && v.screen !== 'join_confirm') expect(json).not.toContain(PAIRING_CODE);
    }
  });

  it('sequence numbers strictly increase per generation and identifiers match the protocol patterns', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    const authed = h.transport.sent.filter((m) => m.producer_generation === 1);
    expect(authed.length).toBeGreaterThan(3);
    for (let i = 1; i < authed.length; i += 1) {
      expect((authed[i] as { sequence: number }).sequence).toBeGreaterThan((authed[i - 1] as { sequence: number }).sequence);
    }
    for (const m of h.transport.sent) {
      expect(m.message_id).toMatch(/^m_[A-Za-z0-9_-]{16,32}$/);
      expect(m.sender_role).toBe('tv');
      if (m.session_id) expect(m.session_id).toMatch(/^s_[A-Za-z0-9_-]{8,40}$/);
      if (m.window_id) expect(m.window_id).toMatch(/^w_[A-Za-z0-9_-]{8,40}$/);
      if (m.attempt_id) expect(m.attempt_id).toMatch(/^a_[A-Za-z0-9_-]{8,40}$/);
    }
    const ids = new Set(h.transport.sent.map((m) => m.message_id));
    expect(ids.size).toBe(h.transport.sent.length);
    expect(h.last('session.state').payload).toMatchObject({ stage: 'calibration', phrase_position: 0, cues_used: 0 });
  });

  it('a second session reuses an already paired phone without pairing again', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('finish_early');
    expect(h.view.stage).toBe('summary');
    expect(h.view.summary?.complete).toBe(false);
    h.micState('off');
    expect(h.view.mic).toBe('off');
    h.ui('done');
    h.clearSent();
    h.ui('start_session');
    expect(h.view.stage).toBe('permission_pending');
    expect(h.last('session.begin').session_id).toMatch(/^s_/);
    expect(h.transport.connects).toHaveLength(1);
    h.micState('open_idle');
    expect(h.view.stage).toBe('quiet_check');
  });

  it('pair-only from home returns home with a paired banner', async () => {
    const h = await boot();
    h.ui('pair_phone');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    expect(h.view.screen).toBe('home');
    expect(h.view.banner?.text).toContain('Phone paired');
    expect(h.view.mic).toBe('unknown');
    void T0;
  });

  it('storage failures never stop practice and are reported', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage });
    storage.failSetFor.add('atr:v1:active');
    h.setupToPhrases();
    h.runPhrase();
    await h.flush();
    expect(h.view.stage).toBe('reveal');
    expect(h.view.banner?.text).toContain('Could not save');
  });
});

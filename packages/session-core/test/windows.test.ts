import { describe, expect, it } from 'vitest';
import { LABEL_NO_BAND } from '../src/index.js';
import { CREDENTIAL, FLOOR, ROOM, boot } from './helpers.js';

describe('duplicate input protection', () => {
  it('repeated OK or actions cannot start two windows or skip an active window', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ok();
    h.ok();
    h.ok();
    h.ui('begin_phrase');
    h.ui('begin_phrase');
    // still inside the quiet lead: nothing has been sent for the phrase yet
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(0);
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
    h.advance(1500);
    const pre = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window');
    expect(pre).toHaveLength(1);
    h.ok(); // OK during the precheck is ignored
    expect(h.of('window.stop')).toHaveLength(0);
    h.answerPrecheck();
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(1);
    // actions that are not offered during capture are ignored
    h.ui('next_phrase');
    h.ui('skip_phrase');
    h.ui('finish_early');
    h.ui('begin_phrase');
    expect(h.view.stage).toBe('phrase_active');
    h.ok();
    h.ok();
    h.ok();
    expect(h.of('window.stop')).toHaveLength(1);
    expect(h.last('window.stop').payload).toEqual({ reason: 'early_stop' });
    expect(h.view.stage).toBe('phrase_active');
    expect(h.view.actions.map((a) => a.id)).toEqual(['cancel']);
  });

  it('disabled actions are ignored: begin is unavailable while the microphone is not open', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.micState('off');
    expect(h.view.mic).toBe('off');
    expect(h.view.actions.find((a) => a.id === 'begin_phrase')?.disabled).toBe(true);
    expect(h.view.preferredAction).toBeNull();
    h.ok();
    h.ui('begin_phrase');
    expect(h.view.capturing).toBe(false);
    expect(h.view.banner?.text).toContain('microphone');
    h.micState('open_idle');
    expect(h.view.preferredAction).toBe('begin_phrase');
  });
});

describe('cancel, Back and stale traffic', () => {
  it('Back during capture sends window.cancel, leaves the attempt unscored, and ignores the late result', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const start = h.last('window.start');
    h.back();
    expect(h.last('window.cancel')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'user_cancel' });
    expect(h.view.stage).toBe('reveal');
    expect(h.view.capturing).toBe(false);
    expect(h.view.result).toMatchObject({ label: 'Not scored', tone: 'not_scored' });
    expect(h.view.result?.detail).toContain('cancelled');
    expect(h.actionIds()).toEqual(['try_again', 'skip_phrase', 'finish_early']);
    // the phone's late result for the cancelled window is stale
    const acks = h.of('ack').length;
    h.answerWindow({ rel: 30 }, start);
    expect(h.of('ack')).toHaveLength(acks + 1);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.result?.label).toBe('Not scored');
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ phrasesCompleted: 0, attemptsInvalid: 1, phrasesAttempted: 1 });
    expect(h.view.summary?.invalidReasons).toEqual({ cancelled: 1 });
  });

  it('Back during the quiet lead sends nothing to the phone and consumes no attempt number', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('begin_phrase');
    h.advance(700);
    h.back();
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.phrase?.attemptNumber).toBe(1);
    expect(h.of('window.cancel')).toHaveLength(0);
    expect(h.view.banner?.text).toContain('cancelled');
    h.advance(5000);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(0);
  });

  it('Back during the precheck cancels the window and records a cancelled, never-started attempt', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.back();
    expect(h.last('window.cancel').payload).toEqual({ reason: 'user_cancel' });
    expect(h.view.stage).toBe('reveal');
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ phrasesAttempted: 0, attemptsInvalid: 1 });
  });

  it('Back outside a window asks to leave, Cancel preferred; Leave saves an incomplete session', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('next_phrase');
    h.back();
    expect(h.view.screen).toBe('confirm_dialog');
    expect(h.view.dialog).toMatchObject({ preferred: 'cancel' });
    expect(h.view.preferredAction).toBe('cancel_destructive');
    expect(h.view.dialog?.confirm.destructive).toBe(true);
    h.back(); // Back on the dialog is Cancel
    expect(h.view.stage).toBe('phrase_ready');
    h.back();
    h.ui('confirm_destructive');
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
    expect(h.view.screen).toBe('home');
    await h.flush();
    const keys = Object.keys(h.storage.dump());
    const rec = JSON.parse(h.storage.dump()[keys.find((k) => k.startsWith('atr:v1:session:')) as string] as string);
    expect(rec.complete).toBe(false);
    expect(rec.endReason).toBe('user_exit');
    expect(keys).not.toContain('atr:v1:active');
  });

  it('Back on Home does nothing destructive', async () => {
    const h = await boot();
    h.back();
    expect(h.view.screen).toBe('home');
  });

  it('ignores traffic for other rooms, duplicates, malformed and unknown messages, and counts them in diagnostics', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const start = h.last('window.start');
    const bad = { ...start, window_id: 'w_other0000000001' };
    h.level(0, FLOOR + 10, true, bad);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.level(1, FLOOR + 10, true, bad); // second stale frame for the same window: no extra ack
    const acks = h.of('ack').length;
    h.level(2, FLOOR + 10, true, bad);
    expect(h.of('ack')).toHaveLength(acks);
    // duplicate frame index is dropped without changing the meter
    h.level(5, FLOOR + 10, true, start);
    const meter = h.view.meter?.levelRelDb;
    h.level(5, FLOOR + 40, true, start);
    expect(h.view.meter?.levelRelDb).toBe(meter);
    // wrong room
    h.wire(h.relay('peer.state', { role: 'phone', connected: false, generation: 1 }, 'r_someotherroom0001'));
    expect(h.view.stage).toBe('phrase_active');
    // exact JSON duplicate message id is dropped
    const dup = h.relay('pong', { server_time: 1 });
    h.wire(dup);
    h.wire(dup);
    // malformed / unknown / extra fields
    h.wire('{not json');
    h.wire(h.relay('pong', { server_time: 1, extra: 1 }));
    h.wire({ type: 'nope' });
    h.wire(h.relay('bogus.type', {}));
    h.ui('open_settings'); // not offered during capture: ignored
    expect(h.view.screen).not.toBe('settings');
    h.answerWindow({ rel: 25 }, start);
    h.ui('finish_early');
    h.ui('done');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    const d = h.view.diagnostics ?? {};
    expect(Number(d.messages_unparseable)).toBeGreaterThanOrEqual(3);
    expect(Number(d.duplicates_dropped)).toBeGreaterThanOrEqual(2);
    expect(Number(d.messages_ignored_stale)).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(d)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(d)).not.toContain(ROOM);
  });

  it('stale precheck and window results never change state', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    const pre = h.last('precheck.start');
    // a window.result while only the precheck is open
    h.wire(
      JSON.stringify({
        ...JSON.parse(h.relay('pong', {})),
        type: 'window.result',
        sender_role: 'phone',
        session_id: pre.session_id,
        window_id: pre.window_id,
        attempt_id: pre.attempt_id,
        payload: h.windowPayload('phrase', {}),
      }),
    );
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.stage).toBe('phrase_active');
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
    // a precheck with the wrong purpose
    h.wire(
      JSON.stringify({
        ...JSON.parse(h.relay('pong', {})),
        type: 'precheck.result',
        sender_role: 'phone',
        session_id: pre.session_id,
        window_id: pre.window_id,
        attempt_id: pre.attempt_id,
        payload: h.precheckPayload('quiet_check'),
      }),
    );
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
  });
});

describe('link loss and interruption', () => {
  it('link loss mid-window: unknown mic (never off), unscored, no auto-resume, fresh begin required', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const start = h.last('window.start');
    h.level(0, FLOOR + 10, true);
    h.transportState('reconnecting');
    expect(h.view.link).toBe('reconnecting');
    expect(h.view.mic).toBe('unknown');
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.capturing).toBe(false);
    expect(h.view.body.join(' ')).toContain('link to the phone was lost');
    expect(h.view.banner?.text).toBe('Phone link lost. Reconnecting.');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(true);

    h.clearSent();
    h.transportState('connected');
    expect(h.last('auth.resume').payload).toEqual({ room_id: ROOM, role: 'tv', credential: CREDENTIAL });
    expect(h.last('auth.resume').producer_generation).toBe(0);
    h.authOk({ peer: true, paired: true, generation: 2 });
    expect(h.view.link).toBe('connected');
    expect(h.view.mic).toBe('unknown'); // until the phone reports again
    // the cancel that could not be delivered is delivered now; sequence restarts for the new generation
    const cancel = h.last('window.cancel');
    expect(cancel).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id, producer_generation: 2 });
    expect(cancel.payload).toEqual({ reason: 'link_lost' });
    expect(cancel.sequence).toBe(0); // the first authenticated message of the new generation
    expect(h.of('window.start')).toHaveLength(0); // never resumes capture on its own
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(true);

    h.micState('open_idle');
    expect(h.view.mic).toBe('open_not_measuring');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBeFalsy();
    // a late result for the interrupted window is stale
    h.answerWindow({ rel: 25 }, start);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.ui('retry');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.phrase?.attemptNumber).toBe(2);
    expect(h.of('window.start')).toHaveLength(0);
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ interrupted: 1 });
    expect(h.views.every((v) => v.mic !== 'off')).toBe(true);
  });

  it('mic is "off" only after the phone says off', async () => {
    const h = await boot();
    h.setupToPhrases();
    expect(h.view.mic).toBe('open_not_measuring');
    h.transportState('offline');
    expect(h.view.mic).toBe('unknown');
    h.transportState('connected');
    h.authOk();
    expect(h.view.mic).toBe('unknown');
    h.micState('off');
    expect(h.view.mic).toBe('off');
    h.peerState(false);
    expect(h.view.mic).toBe('unknown');
  });

  it('phone disconnect while measuring cancels the window; the phone microphone stopping interrupts it', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.micState('measuring');
    expect(h.view.mic).toBe('measuring');
    h.micState('no_input');
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.mic).toBe('no_input');
    expect(h.last('window.cancel').payload).toEqual({ reason: 'interrupted' });
    expect(h.view.body.join(' ')).toContain('microphone stopped');

    const g = await boot();
    g.setupToPhrases();
    g.beginAndLead('begin_phrase');
    g.answerPrecheck();
    g.peerState(false);
    expect(g.view.stage).toBe('paused_or_invalid');
    expect(g.view.mic).toBe('unknown');
  });

  it('backgrounding the app interrupts an open window', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.store.dispatch({ kind: 'app', event: 'backgrounded' });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'interrupted' });
    expect(h.view.stage).toBe('paused_or_invalid');
    h.store.dispatch({ kind: 'app', event: 'foregrounded' });
    h.store.dispatch({ kind: 'app', event: 'launched' });
    expect(h.view.stage).toBe('paused_or_invalid');
  });

  it('link loss during the quiet check, calibration and vowel each pause with a retry', async () => {
    const h = await boot();
    h.startAndPair();
    h.beginAndLead('begin_quiet_check');
    h.transportState('reconnecting');
    expect(h.view.stage).toBe('paused_or_invalid');
    h.transportState('connected');
    h.authOk();
    h.micState('open_idle');
    h.ui('retry');
    expect(h.view.stage).toBe('quiet_check');
    h.runQuiet();
    h.beginAndLead('begin_calibration');
    h.transportState('offline');
    expect(h.view.stage).toBe('paused_or_invalid');
    h.transportState('connected');
    h.authOk();
    h.micState('open_idle');
    h.ui('retry');
    expect(h.view.stage).toBe('calibration');
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.transportState('failed');
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.actions.map((a) => a.id)).toEqual(['retry', 'skip_vowel']);
    h.transportState('connected');
    h.authOk();
    h.micState('open_idle');
    h.ui('skip_vowel');
    expect(h.view.stage).toBe('phrase_ready');
  });

  it('a relay error that revokes the pairing clears the room and reports it', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.relayError('revoked');
    expect(h.view.mic).toBe('not_paired');
    expect(h.view.banner?.text).toContain('pairing');
    expect(h.transport.closes).toContain('revoked');
    h.relayError('rate_limited');
    expect(h.view.banner?.text).toContain('rate_limited');
  });
});

describe('timeouts', () => {
  it('a precheck that never answers is cancelled as timeout after its duration plus grace', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.advance(4999);
    expect(h.view.stage).toBe('phrase_active');
    h.advance(1);
    expect(h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.body.join(' ')).toContain('did not answer in time');
  });

  it('a window at its maximum sends window.stop complete, then cancels as timeout if no result arrives', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.advance(8499);
    expect(h.of('window.stop')).toHaveLength(0);
    h.advance(1);
    expect(h.last('window.stop').payload).toEqual({ reason: 'complete' });
    expect(h.view.timer?.elapsedMs).toBe(8000);
    h.advance(2999);
    expect(h.of('window.cancel')).toHaveLength(0);
    h.advance(1);
    expect(h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ timeout: 1 });
  });

  it('a quiet check that never answers times out after 5 s plus grace', async () => {
    const h = await boot();
    h.startAndPair();
    h.beginAndLead('begin_quiet_check');
    h.advance(7999);
    expect(h.view.stage).toBe('quiet_check');
    expect(h.view.capturing).toBe(true);
    h.advance(1);
    expect(h.view.stage).toBe('paused_or_invalid');
  });
});

describe('gate through the full flow', () => {
  it('rise 5.99 dB passes and 6.0 dB blocks (band margin 20)', async () => {
    const pass = await boot();
    pass.setupToPhrases();
    pass.beginAndLead('begin_phrase');
    pass.answerPrecheck({}, 5.99);
    expect(pass.view.stage).toBe('phrase_active');
    expect(pass.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(1);

    const block = await boot();
    block.setupToPhrases();
    block.beginAndLead('begin_phrase');
    block.answerPrecheck({}, 6);
    expect(block.view.stage).toBe('paused_or_invalid');
    expect(block.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
    expect(block.view.body.join(' ')).toContain('noisier than when we set');
    expect(block.actionIds()).toEqual(['retry', 'skip_phrase', 'finish_early']);
  });

  it('with a band margin of 13, margin - rise below 10 blocks (rise 3.01) and exactly 10 passes (rise 3)', async () => {
    const make = async (rise: number) => {
      const h = await boot();
      h.startAndPair();
      h.runQuiet();
      h.runCalibration(13);
      h.toPhrases();
      h.beginAndLead('begin_phrase');
      h.answerPrecheck({}, rise);
      return h.view.stage;
    };
    expect(await make(3)).toBe('phrase_active');
    expect(await make(3.01)).toBe('paused_or_invalid');
  });

  it('an invalid precheck blocks with its own reason', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck({ valid: false, invalid_reason: 'clipped', clipped_frames: 3 });
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.body.join(' ')).toContain('too strong');
    h.ui('skip_phrase');
    expect(h.view.phrase?.position).toBe(2);
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ phrasesSkipped: 1, attemptsInvalid: 1, phrasesAttempted: 0 });
  });

  it('a blocked phrase can be retried and then captured', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck({}, 8);
    h.micState('open_idle');
    h.ui('retry');
    expect(h.view.stage).toBe('phrase_ready');
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.label).toBe("Reached today's relative level band");
  });
});

describe('quiet check re-validation on the TV', () => {
  async function quietWith(over: Record<string, unknown>) {
    const h = await boot();
    h.startAndPair();
    h.beginAndLead('begin_quiet_check');
    h.answerPrecheck(over);
    return h;
  }

  it('accepts every boundary value and rejects just beyond each', async () => {
    expect((await quietWith({ p20_dbfs: -51, p80_dbfs: -45 })).view.stage).toBe('calibration'); // 6 dB stable
    expect((await quietWith({ p20_dbfs: -51, p80_dbfs: -44.9 })).view.stage).toBe('quiet_check');
    expect((await quietWith({ p95_dbfs: -40 })).view.stage).toBe('calibration'); // 10 dB burst
    expect((await quietWith({ p95_dbfs: -39.9 })).view.stage).toBe('quiet_check');
    expect((await quietWith({ floor_dbfs: -30, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).view.stage).toBe('calibration');
    expect((await quietWith({ floor_dbfs: -29.9, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).view.stage).toBe('quiet_check');
    expect((await quietWith({ coverage: 0.9 })).view.stage).toBe('calibration');
    expect((await quietWith({ coverage: 0.89 })).view.stage).toBe('quiet_check');
    expect((await quietWith({ clipped_frames: 1 })).view.stage).toBe('quiet_check');
  });

  it('even when the phone says valid, a failed TV check shows its reason with retry', async () => {
    const h = await quietWith({ clipped_frames: 2 });
    expect(h.view.stage).toBe('quiet_check');
    expect(h.view.title).toBe('Quiet check did not pass');
    expect(h.view.body.join(' ')).toContain('too strong');
    expect(h.actionIds()).toEqual(['retry', 'cancel']);
    h.ui('retry');
    h.runQuiet();
    expect(h.view.stage).toBe('calibration');
  });

  it('shows the phone-reported reason for an invalid quiet check', async () => {
    const h = await quietWith({ valid: false, invalid_reason: 'too_loud' });
    expect(h.view.body.join(' ')).toContain('too loud');
    const g = await quietWith({ valid: false, invalid_reason: 'burst_noise' });
    expect(g.view.body.join(' ')).toContain('sudden sound');
  });
});

describe('calibration', () => {
  it('accepts margin 13.0 and rejects 12.99 with the exact "too quiet" guidance', async () => {
    const ok = await boot();
    ok.startAndPair();
    ok.runQuiet();
    ok.runCalibration(13);
    expect(ok.view.result?.label).toBe("Today's band is set");

    const no = await boot();
    no.startAndPair();
    no.runQuiet();
    no.runCalibration(12.99);
    expect(no.view.result?.label).toBe("Today's band was not set");
    expect(no.view.body.join(' ')).toBe(
      "Too quiet to set today's band. Try once more from your seat, or check the phone is on its mark.",
    );
    expect(no.actionIds()).toEqual(['retry', 'continue', 'cancel']);
    expect(no.view.actions.find((a) => a.id === 'continue')?.label).toBe('Continue without a band');
  });

  it('retry returns to ready; Keep today\'s band exists only when a band was set this session', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    expect(h.view.actions.find((a) => a.id === 'skip_calibration')?.disabled).toBe(true);
    h.ui('skip_calibration'); // disabled: ignored
    expect(h.view.stage).toBe('calibration');
    h.runCalibration(20);
    h.ui('retry');
    expect(h.view.actions.find((a) => a.id === 'skip_calibration')?.disabled).toBe(false);
    h.ui('skip_calibration');
    expect(h.view.stage).toBe('vowel_ready');
    expect(h.last('session.state').payload).toMatchObject({ stage: 'vowel_ready' });
  });

  it('a failed retry keeps the earlier band', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('retry');
    h.runCalibration(5);
    expect(h.view.result?.label).toBe("Today's band was not set");
    expect(h.view.actions.find((a) => a.id === 'continue')?.label).toBe("Keep today's band");
    h.ui('continue');
    h.ui('skip_vowel');
    h.runPhrase({ rel: 25 });
    expect(h.view.result?.label).toBe("Reached today's relative level band");
  });

  it('continuing without a band runs phrases unscored, labelled, with the listener still available', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(5);
    h.ui('continue');
    h.ui('skip_vowel');
    expect(h.view.labels).toContain(LABEL_NO_BAND);
    h.runPhrase({ rel: 30, listener: 'heard' });
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result).toMatchObject({ label: LABEL_NO_BAND, tone: 'not_scored' });
    expect(h.view.result?.listener).toBe('Listener: heard');
    expect(h.view.labels).toContain(LABEL_NO_BAND);
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ phrasesCompleted: 1, attemptsInvalid: 0, scoredVisible: 0, calibrationMarginDb: null });
    expect(h.view.summary?.lines.join(' ')).toContain('No band was set');
  });

  it('calibration with no voice or low coverage is not accepted', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.beginAndLead('begin_calibration');
    h.answerWindow({ valid: false, reason: 'no_voice' });
    expect(h.view.body.join(' ')).toContain('No voice');
    h.ui('retry');
    h.beginAndLead('begin_calibration');
    h.answerWindow({ coverage: 0.85 });
    expect(h.view.body.join(' ')).toContain('enough audio');
    h.ui('retry');
    h.beginAndLead('begin_calibration');
    h.answerWindow({ activeMs: 399 });
    expect(h.view.body.join(' ')).toContain('No voice');
  });

  it('cancelling a calibration returns to its ready screen', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.beginAndLead('begin_calibration');
    h.back();
    expect(h.view.stage).toBe('calibration');
    expect(h.actionIds()).toEqual(['begin_calibration', 'cancel']);
  });
});

describe('sustained vowel', () => {
  it('Back cancels immediately and unscored; rest returns to vowel_ready; elapsed timer and duration result', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.advance(2000);
    expect(h.view.timer).toMatchObject({ elapsedMs: 2000, maxMs: 30000 });
    h.back();
    expect(h.last('window.cancel').payload).toEqual({ reason: 'user_cancel' });
    expect(h.view.stage).toBe('vowel_ready');
    expect(h.view.banner?.text).toContain('cancelled');

    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.answerWindow({ rel: 22, longest: 9000, activeMs: 9000 });
    expect(h.view.stage).toBe('vowel_result');
    expect(h.actionIds()).toEqual(['continue', 'rest']);
    h.ui('rest');
    expect(h.view.stage).toBe('vowel_ready');
    h.ui('begin_vowel');
    h.advance(1500);
    h.answerPrecheck();
    h.answerWindow({ valid: false, reason: 'low_coverage' });
    expect(h.view.result?.label).toBe('Not scored');
    h.ui('continue');
    h.ui('finish_early');
    expect(h.view.summary?.longestActiveMs).toBe(9000);
  });

  it('without a band the vowel shows the duration and the no-band label, not a verdict', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(3);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    // no band: no gate precheck, window starts directly
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(0);
    expect(h.last('window.start').payload).toMatchObject({ kind: 'vowel' });
    h.answerWindow({ longest: 12300, activeMs: 12300 });
    expect(h.view.result).toMatchObject({ label: 'Voice-activity duration: 12.3 s', tone: 'neutral' });
    expect(h.view.labels).toContain(LABEL_NO_BAND);
  });

  it('the vowel is gated when a band exists: a noisy room blocks it with retry and skip', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck({}, 9);
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.actionIds()).toEqual(['retry', 'skip_vowel']);
    h.ui('retry');
    expect(h.view.stage).toBe('vowel_ready');
  });
});

describe('skip, finish early and summary counts', () => {
  it('counts completed, attempted and skipped positions separately and labels an early finish incomplete', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    h.ui('next_phrase');
    h.ui('skip_phrase'); // position 2 skipped, never attempted
    h.runPhrase({ valid: false, reason: 'no_voice' }); // position 3 (hidden) invalid
    h.ui('skip_phrase'); // skipped after an invalid attempt
    h.ui('finish_early');
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
    const s = h.view.summary;
    expect(s?.complete).toBe(false);
    expect(h.view.title).toBe('Session summary (incomplete)');
    expect(s).toMatchObject({ phrasesCompleted: 1, phrasesAttempted: 2, phrasesSkipped: 2, attemptsInvalid: 1 });
    expect(s?.lines[0]).toContain('Incomplete session');
    expect(s?.invalidReasons).toEqual({ no_voice: 1 });
  });

  it('a skipped phrase that already has a valid attempt is completed, not skipped', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    h.ui('try_again');
    h.ui('skip_phrase');
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({ phrasesCompleted: 1, phrasesSkipped: 0 });
  });

  it('borderline results keep their verdict and are counted and labelled', async () => {
    const h = await boot();
    h.setupToPhrases(); // band margin 20 -> edge 19
    h.runPhrase({ rel: 19.5 });
    expect(h.view.result).toMatchObject({ label: "Reached today's relative level band", borderline: true });
    expect(h.view.result?.detail).toContain('Borderline');
    h.ui('next_phrase');
    h.runPhrase({ rel: 18.5 });
    expect(h.view.result).toMatchObject({ label: "Below today's relative level band", borderline: true });
    h.ui('next_phrase');
    h.runPhrase({ rel: 20, rating: 'skipped' }); // position 3 (blind), exactly 1 dB from the edge: reached, not borderline
    expect(h.view.result).toMatchObject({ label: "Reached today's relative level band", borderline: false });
    h.ui('next_phrase');
    h.runPhrase({ rel: 19 }); // exactly on the edge: reached
    expect(h.view.result?.label).toBe("Reached today's relative level band");
    h.ui('finish_early');
    expect(h.view.summary?.borderlineCount).toBe(3);
  });

  it('a window result that is valid but without enough voice or coverage is unscored with a reason', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({ coverage: 0.85 });
    expect(h.view.result?.label).toBe('Not scored');
    expect(h.view.result?.detail).toContain('enough audio');
    h.ui('try_again');
    h.runPhrase({ activeMs: 399 });
    expect(h.view.result?.detail).toContain('No voice');
    h.ui('try_again');
    h.runPhrase({ valid: false, reason: 'continuous_sound' });
    expect(h.view.result?.detail).toContain('continued');
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ low_coverage: 1, no_voice: 1, continuous_sound: 1 });
  });
});

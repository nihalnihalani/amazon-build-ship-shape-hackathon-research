/**
 * DEF-003: the phone ignores session.begin while it waits for its owner (A3-01). The TV (a) resends session.begin
 * and the current session.state when the phone shows it does not know the session, at most once per 2 s, and
 * (b) sends no precheck or window command until the phone has acked a session.begin as applied.
 */

import { describe, expect, it } from 'vitest';
import { boot } from './helpers.js';
import type { Harness, Sent } from './helpers.js';

/** Pair a phone but do not let it ack anything: it is still waiting for its owner to tap Yes. */
async function unackedSession(): Promise<Harness> {
  const h = await boot();
  h.autoAck = false;
  h.ui('start_session');
  h.transportState('connected');
  h.roomCreated();
  h.joinRequested();
  h.acceptJoin();
  h.peerState(true);
  expect(h.view.stage).toBe('permission_pending');
  expect(h.of('session.begin')).toHaveLength(1);
  return h;
}

const MEASUREMENT = ['precheck.start', 'window.start'];
const measurementSent = (h: Harness): Sent[] => h.transport.sent.filter((m) => MEASUREMENT.includes(m.type));

describe('no measurement command before the phone has acked session.begin', () => {
  it('stays in permission_pending and says it is waiting for the phone, even when the microphone opens', async () => {
    const h = await unackedSession();
    expect(h.view.body).toContain('Waiting for the phone.');
    h.micState('permission_pending');
    h.micState('open_idle');
    expect(h.view.mic).toBe('open_not_measuring');
    expect(h.view.stage).toBe('permission_pending');
    expect(h.view.body).toContain('Waiting for the phone.');
    expect(h.view.actions.map((a) => a.id)).toEqual(['cancel']);
    expect(measurementSent(h)).toHaveLength(0);
  });

  it('moves on to the quiet check the moment the ack arrives, whichever of ack and open microphone comes last', async () => {
    const a = await unackedSession();
    a.micState('open_idle'); // microphone first
    expect(a.view.stage).toBe('permission_pending');
    a.ackPendingBegins();
    expect(a.view.stage).toBe('quiet_check');
    expect(a.view.body).not.toContain('Waiting for the phone.');
    expect(a.actionIds()).toContain('begin_quiet_check');

    const b = await unackedSession();
    b.ackPendingBegins(); // ack first
    expect(b.view.stage).toBe('permission_pending');
    expect(b.view.body).not.toContain('Waiting for the phone.');
    b.micState('open_idle');
    expect(b.view.stage).toBe('quiet_check');
  });

  it('the ack must be "applied" and name a session.begin of this session', async () => {
    const h = await unackedSession();
    h.micState('open_idle');
    const begin = h.last('session.begin');
    const ack = (id: string, outcome: string, session: string | null = begin.session_id) =>
      h.wire(h.envelope('ack', 'phone', { acked_message_id: id, outcome, detail: '' }, { s: session }));
    ack(begin.message_id, 'ignored_stale');
    ack(begin.message_id, 'rejected');
    ack('m_notmine0000000000001', 'applied');
    expect(h.view.stage).toBe('permission_pending');
    ack(begin.message_id, 'applied');
    expect(h.view.stage).toBe('quiet_check');
  });

  it('begin actions are refused while waiting even if the screen is somehow a ready screen (defence in depth)', async () => {
    const h = await unackedSession();
    h.micState('open_idle');
    h.ui('begin_quiet_check');
    h.advance(5000);
    expect(measurementSent(h)).toHaveLength(0);
    expect(h.view.capturing).toBe(false);
  });

  it('no precheck, window or calibration command is sent for a whole session before the ack, then all flow after it', async () => {
    const h = await unackedSession();
    h.micState('open_idle');
    h.ok();
    h.advance(10_000);
    expect(measurementSent(h)).toHaveLength(0);
    h.ackPendingBegins();
    h.runQuiet();
    h.runCalibration(20);
    h.toPhrases();
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    expect(measurementSent(h).length).toBeGreaterThan(3);
  });

  it('a session started with an already paired phone waits for the ack too', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('finish_early');
    h.ui('done');
    h.autoAck = false;
    h.ui('start_session'); // the microphone is still open from the earlier session
    expect(h.view.stage).toBe('permission_pending');
    expect(h.view.body).toContain('Waiting for the phone.');
    h.ackPendingBegins();
    expect(h.view.stage).toBe('quiet_check');
  });

  it('after the phone acked, a later mic state or reconnect does not take the ack away', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.micState('off');
    h.micState('open_idle');
    expect(h.view.actions.find((a) => a.id === 'begin_phrase')?.disabled).toBeFalsy();
  });

  it('a resumed session (new pairing) needs its own ack before it measures', async () => {
    const g = await boot();
    g.setupToPhrases();
    g.runPhrase({});
    g.beginAndLead('begin_phrase');
    g.answerPrecheck();
    await g.flush();
    const h = await boot({ seed: g.storage.dump() });
    h.autoAck = false;
    h.ui('resume_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.micState('open_idle');
    expect(h.view.stage).toBe('permission_pending');
    expect(h.view.body).toContain('Waiting for the phone.');
    h.ackPendingBegins();
    expect(h.view.stage).toBe('quiet_check');
  });
});

describe('session.begin dropped by the phone, then recovered by the resend', () => {
  it('a mic.state without the session (the phone never heard session.begin) makes the TV resend begin, then session.state', async () => {
    const h = await unackedSession();
    const first = h.last('session.begin');
    h.advance(2000);
    h.clearSent();
    h.wire(h.envelope('mic.state', 'phone', {
      state: 'permission_pending',
      settings: { auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null },
      supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
      wake_lock: 'not_requested',
      visibility: 'visible',
      mode: 'physical_phone',
    }, { s: null }));
    const types = h.transport.sent.map((m) => m.type);
    expect(types.filter((t) => t === 'session.begin')).toHaveLength(1);
    expect(types.indexOf('session.state')).toBeGreaterThan(types.indexOf('session.begin'));
    const resent = h.last('session.begin');
    expect(resent.session_id).toBe(first.session_id);
    expect(resent.payload).toEqual(first.payload);
    expect(resent.message_id).not.toBe(first.message_id);
    expect(h.last('session.state').payload).toMatchObject({ stage: 'permission_pending', phrase_position: 0 });
    // the phone now knows the session and acks the resend: practice goes on
    h.autoAck = true;
    h.micState('open_idle');
    expect(h.view.stage).toBe('quiet_check');
    h.runQuiet();
    expect(h.view.stage).toBe('calibration');
  });

  it('an ack saying unknown_session also triggers the resend', async () => {
    const h = await unackedSession();
    h.advance(2000);
    h.clearSent();
    h.wire(h.envelope('ack', 'phone', { acked_message_id: 'm_whatever00000000001', outcome: 'ignored_stale', detail: 'unknown_session' }, { s: null }));
    expect(h.of('session.begin')).toHaveLength(1);
    expect(h.of('session.state')).toHaveLength(1);
    // unknown_session wins whatever the outcome says
    h.advance(2000);
    h.wire(h.envelope('ack', 'phone', { acked_message_id: 'm_whatever00000000002', outcome: 'rejected', detail: 'unknown_session' }, { s: null }));
    expect(h.of('session.begin')).toHaveLength(2);
  });

  it('a mic.state for a different session (a stale connection) resends, one that names the current session does not', async () => {
    const h = await unackedSession();
    h.ackPendingBegins();
    const sessionId = h.last('session.begin').session_id;
    h.advance(2000);
    h.clearSent();
    h.phoneSession = 's_someothersession01';
    h.micState('open_idle');
    expect(h.of('session.begin')).toHaveLength(1);
    h.advance(2000);
    h.clearSent();
    h.phoneSession = sessionId;
    h.micState('measuring');
    h.micState('open_idle');
    expect(h.of('session.begin')).toHaveLength(0);
  });

  it('works through a window that was never started: the first quiet check goes out only after the recovery', async () => {
    const h = await unackedSession();
    h.micState('permission_pending');
    h.advance(2000);
    h.wire(h.envelope('ack', 'phone', { acked_message_id: 'm_x00000000000000001', outcome: 'ignored_stale', detail: 'unknown_session' }, { s: null }));
    expect(h.of('session.begin')).toHaveLength(2);
    h.autoAck = true;
    h.micState('open_idle');
    h.runQuiet();
    expect(h.of('precheck.start')).toHaveLength(1);
    expect(h.last('precheck.start').payload).toMatchObject({ purpose: 'quiet_check' });
  });

  it('nothing is resent when there is no session, the session ended, the phone is gone or the link is down', async () => {
    const h = await boot();
    h.pairOnly();
    h.advance(5000);
    h.clearSent();
    h.micState('open_idle'); // no session
    expect(h.of('session.begin')).toHaveLength(0);

    const g = await unackedSession();
    g.advance(2000);
    g.clearSent();
    g.peerState(false);
    g.micState('open_idle');
    expect(g.of('session.begin')).toHaveLength(0);
    g.transportState('reconnecting');
    g.advance(2000);
    g.wire(g.envelope('ack', 'phone', { acked_message_id: 'm_y00000000000000001', outcome: 'ignored_stale', detail: 'unknown_session' }, { s: null }));
    expect(g.of('session.begin')).toHaveLength(0);

    const e = await boot();
    e.setupToPhrases();
    e.ui('finish_early');
    e.advance(2000);
    e.clearSent();
    e.phoneSession = null;
    e.micState('open_idle');
    expect(e.of('session.begin')).toHaveLength(0);
  });
});

describe('the resend rate limit', () => {
  it('at most one resend per 2 s, however many triggers arrive', async () => {
    const h = await unackedSession();
    const ignorant = () =>
      h.wire(h.envelope('ack', 'phone', { acked_message_id: `m_z${String(h.of('ack').length).padStart(18, '0')}`, outcome: 'ignored_stale', detail: 'unknown_session' }, { s: null }));
    // triggers right after the first begin are inside its 2 s window: nothing is resent
    for (let i = 0; i < 10; i += 1) ignorant();
    expect(h.of('session.begin')).toHaveLength(1);
    h.advance(1999);
    ignorant();
    expect(h.of('session.begin')).toHaveLength(1);
    h.advance(1);
    ignorant(); // exactly 2 s after the first begin
    expect(h.of('session.begin')).toHaveLength(2);
    for (let i = 0; i < 20; i += 1) ignorant();
    expect(h.of('session.begin')).toHaveLength(2);
    h.advance(1999);
    for (let i = 0; i < 5; i += 1) ignorant();
    expect(h.of('session.begin')).toHaveLength(2);
    h.advance(1);
    ignorant();
    expect(h.of('session.begin')).toHaveLength(3);
    // mic.state triggers share the same limiter
    h.advance(500);
    h.micState('permission_pending');
    expect(h.of('session.begin')).toHaveLength(3);
    h.advance(1500);
    h.micState('permission_pending');
    expect(h.of('session.begin')).toHaveLength(4);
    expect(h.of('session.state').length).toBeGreaterThanOrEqual(4);
  });

  it('counts resends in Diagnostics', async () => {
    const h = await unackedSession();
    h.advance(2000);
    h.wire(h.envelope('ack', 'phone', { acked_message_id: 'm_q00000000000000001', outcome: 'ignored_stale', detail: 'unknown_session' }, { s: null }));
    h.ui('cancel');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics?.session_begin_resends).toBe('1');
  });
});

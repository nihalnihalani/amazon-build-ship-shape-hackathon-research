/**
 * DEF-005: `error not_found / peer_offline` means the PHONE is temporarily offline. It is not a lost pairing.
 * The room and the session stay, the microphone state is unknown, an open window is cancelled and unscored, and
 * the must-deliver command the relay dropped is queued and flushed when peer.state says the phone is back.
 */

import { describe, expect, it } from 'vitest';
import { boot } from './helpers.js';
import type { Harness } from './helpers.js';

const roomCreates = (h: Harness): number => h.of('room.create').length;

async function inCapture(): Promise<Harness> {
  const h = await boot();
  h.setupToPhrases();
  h.beginAndLead('begin_phrase');
  h.answerPrecheck();
  h.level(0, h.floor + 3, true);
  expect(h.view.stage).toBe('phrase_active');
  return h;
}

describe('peer_offline keeps the pairing', () => {
  it('the T15 repro: the phone dropped, the speaker cancels, the relay answers peer_offline: no re-pairing, the cancel is delivered once the phone is back', async () => {
    const h = await inCapture();
    const start = h.last('window.start');
    const sessionId = h.last('session.begin').session_id;
    const creates = roomCreates(h);
    const connects = h.transport.connects.length;
    h.back(); // the speaker cancels; the TV has not yet heard that the phone dropped
    const cancel = h.last('window.cancel');
    expect(cancel).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
    expect(h.view.stage).toBe('reveal');
    // the relay could not deliver it
    h.relayError('not_found', 'peer_offline', cancel.message_id);
    expect(h.view.banner?.text ?? '').not.toContain('Pair again');
    expect(h.view.banner?.text ?? '').not.toContain('pairing');
    expect(h.view.stage).toBe('reveal'); // the session goes on
    expect(h.view.mic).toBe('unknown');
    expect(roomCreates(h)).toBe(creates);
    expect(h.transport.connects.length).toBe(connects);
    expect(h.transport.closes).toEqual([]);
    expect(h.of('window.cancel')).toHaveLength(1); // not resent into a dead peer
    // the relay now says the phone is gone, then back
    h.peerState(false);
    expect(h.of('window.cancel')).toHaveLength(1);
    h.peerState(true, 2);
    expect(h.of('window.cancel')).toHaveLength(2);
    expect(h.last('window.cancel')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id, session_id: sessionId });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'user_cancel' });
    expect(h.last('session.begin').session_id).toBe(sessionId); // same session
    expect(roomCreates(h)).toBe(creates);
  });

  it('while a window is open: the window is cancelled and unscored, the mic view is unknown, the screen offers a retry only after the phone reports', async () => {
    const h = await inCapture();
    const creates = roomCreates(h);
    const stop = h.of('window.start').at(-1);
    h.ok(); // stop early: window.stop is sent
    const dropped = h.last('window.stop');
    h.relayError('not_found', 'peer_offline', dropped.message_id);
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.capturing).toBe(false);
    expect(h.view.mic).toBe('unknown');
    expect(h.view.body.join(' ')).toContain('link to the phone was lost');
    expect(h.view.body.join(' ')).not.toContain('Pair again');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(true);
    // the cancel for the window is queued, not sent into a dead peer
    expect(h.of('window.cancel')).toHaveLength(0);
    h.peerState(true, 2);
    expect(h.of('window.cancel')).toHaveLength(1);
    expect(h.last('window.cancel')).toMatchObject({ window_id: stop?.window_id, attempt_id: stop?.attempt_id });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'link_lost' });
    // after peer.state connected the TV still waits for the phone's own mic.state
    expect(h.view.mic).toBe('unknown');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(true);
    h.micState('open_idle');
    expect(h.view.mic).toBe('open_not_measuring');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBeFalsy();
    h.ui('retry');
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    expect(roomCreates(h)).toBe(creates);
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ interrupted: 1 });
  });

  it('with no window open it only makes the phone state unknown; the session is untouched', async () => {
    const h = await boot();
    h.setupToPhrases();
    const creates = roomCreates(h);
    h.relayError('not_found', 'peer_offline', null);
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.mic).toBe('unknown');
    expect(h.view.actions.find((a) => a.id === 'begin_phrase')?.disabled).toBe(true);
    expect(roomCreates(h)).toBe(creates);
    h.peerState(true, 2);
    h.micState('open_idle');
    expect(h.view.actions.find((a) => a.id === 'begin_phrase')?.disabled).toBeFalsy();
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
  });

  it('a dropped session.end goes back into the queue and is delivered when the phone returns, once', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('finish_early');
    const end = h.last('session.end');
    h.relayError('not_found', 'peer_offline', end.message_id);
    expect(h.view.stage).toBe('summary');
    expect(h.of('session.end')).toHaveLength(1);
    h.peerState(true, 2);
    expect(h.of('session.end')).toHaveLength(2);
    expect(h.last('session.end').session_id).toBe(end.session_id);
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
    h.peerState(true, 3);
    expect(h.of('session.end')).toHaveLength(2); // delivered once
  });

  it('a dropped attempt.reveal is delivered later too (the phone must lock its listener controls)', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.runPhrase({ listener: 'heard' });
    const reveal = h.last('attempt.reveal');
    h.relayError('not_found', 'peer_offline', reveal.message_id);
    expect(h.view.stage).toBe('reveal');
    h.peerState(true, 2);
    expect(h.of('attempt.reveal').filter((m) => m.attempt_id === reveal.attempt_id)).toHaveLength(2);
  });

  it('an unknown or missing reference requeues nothing, and a command sent while the phone is known to be offline is queued from the start', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('finish_early');
    h.relayError('not_found', 'peer_offline', 'm_unknownref0000000001');
    h.relayError('not_found', 'peer_offline', null);
    h.peerState(true, 2);
    expect(h.of('session.end')).toHaveLength(1);
  });

  it('works through repeated offline errors and a reconnecting link: a later link loss still re-authenticates with the same room', async () => {
    const h = await inCapture();
    const creates = roomCreates(h);
    h.relayError('not_found', 'peer_offline', null);
    h.relayError('not_found', 'peer_offline', null);
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.of('auth.resume')).toHaveLength(1); // the same room is resumed, no new one created
    h.authOk({ generation: 2, peer: true, paired: true });
    expect(roomCreates(h)).toBe(creates);
    h.micState('open_idle');
    expect(h.view.stage).toBe('paused_or_invalid');
    h.ui('retry');
    expect(h.view.stage).toBe('phrase_ready');
  });
});

describe('only genuine room-loss signals send the TV back to pairing', () => {
  async function fresh(): Promise<Harness> {
    const h = await boot();
    h.setupToPhrases();
    return h;
  }
  const loses: [string, string, string][] = [
    ['expired', 'room_expired', 'The pairing with the relay was lost. Pair again.'],
    ['expired', 'credential_expired', 'The pairing with the relay was lost. Pair again.'],
    ['revoked', 'room_closed', 'The pairing with the relay was lost. Pair again.'],
    ['revoked', 'credential_revoked', 'Pairing may be compromised. Pair again.'],
    ['unauthorized', 'resume_failed', 'The pairing with the relay was lost. Pair again.'],
    ['superseded', 'newer_connection', 'The pairing with the relay was lost. Pair again.'],
  ];

  for (const [code, detail, banner] of loses) {
    it(`${code} (${detail}) drops the room and goes back to pairing`, async () => {
      const h = await fresh();
      const creates = roomCreates(h);
      h.relayError(code, detail);
      expect(h.view.stage).toBe('pairing');
      expect(h.view.banner?.text).toBe(banner);
      expect(h.view.mic).toBe('not_paired');
      expect(h.transport.closes).toContain(code);
      expect(h.transport.connects.length).toBeGreaterThanOrEqual(2);
      h.transportState('connected');
      expect(roomCreates(h)).toBe(creates + 1);
    });
  }

  it('a failed resume of the TV (an error before auth.ok): unauthorized or an unknown room end the pairing', async () => {
    for (const code of ['unauthorized', 'not_found']) {
      const h = await fresh();
      h.transportState('reconnecting');
      h.transportState('connected'); // auth.resume sent, no auth.ok yet
      expect(h.of('auth.resume')).toHaveLength(1);
      h.relayError(code, code === 'not_found' ? 'room_unknown' : 'whatever');
      expect(h.view.stage, code).toBe('pairing');
      expect(h.view.banner?.text, code).toBe('The pairing with the relay was lost. Pair again.');
    }
  });

  it('errors that are not about the pairing only show a banner', async () => {
    const cases: [string, string][] = [
      ['unauthorized', 'some_other_detail'],
      ['unauthenticated', 'auth_deadline'],
      ['not_found', 'something_else'],
      ['rate_limited', 'rate_limited'],
      ['payload_too_large', ''],
      ['internal', ''],
    ];
    for (const [code, detail] of cases) {
      const h = await fresh();
      const creates = roomCreates(h);
      h.relayError(code, detail);
      expect(h.view.stage, code).toBe('phrase_ready');
      expect(h.view.banner?.text, code).toBe(`The relay reported: ${code}.`);
      expect(h.view.mic, code).toBe('open_not_measuring');
      expect(roomCreates(h)).toBe(creates);
    }
  });

  it('not_found no_such_join (the join the TV answered is gone) is not a lost pairing', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    expect(h.view.body.join(' ')).toContain('Phone accepted');
    h.relayError('not_found', 'no_such_join');
    expect(h.view.stage).toBe('pairing');
    expect(h.view.pairing?.code).toBe('ACDEFH');
    expect(h.view.banner?.text).toBe('The join request expired.');
    expect(roomCreates(h)).toBe(1);
  });
});

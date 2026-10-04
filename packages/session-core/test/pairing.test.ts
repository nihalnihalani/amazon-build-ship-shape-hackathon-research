import { describe, expect, it } from 'vitest';
import { deleteAllLocalData, phoneJoinUrl, relaySocketUrl } from '../src/index.js';
import type { MicStateName } from '../src/wire.js';
import { PAIRING_CODE, boot, createFlakyStorage } from './helpers.js';

describe('pairing screen and relay link', () => {
  it('New code asks the relay for a fresh code and shows it with a new QR payload', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    expect(h.view.preferredAction).toBe('cancel'); // spec S1: Cancel holds focus
    expect(h.view.actions.map((a) => a.id)).toEqual(['refresh_code', 'cancel']);
    h.ui('refresh_code');
    expect(h.of('pairing.refresh')).toHaveLength(1);
    h.pairingCode('WXY347');
    expect(h.view.pairing).toMatchObject({ code: 'WXY347', qrPayload: 'https://relay.example.test/#code=WXY347' });
  });

  it('refreshes an expired code once, on a tick, and says so while it is expired', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.advance(599_999);
    expect(h.of('pairing.refresh')).toHaveLength(0);
    h.advance(1);
    expect(h.of('pairing.refresh')).toHaveLength(1);
    expect(h.view.body.join(' ')).toContain('expired');
    h.advance(1000);
    h.advance(1000);
    expect(h.of('pairing.refresh')).toHaveLength(1); // not on every tick
    h.pairingCode('ACDEFH');
    expect(h.view.body.join(' ')).not.toContain('expired');
  });

  it('reject keeps pairing open; Back on the confirm screen rejects too; an expired request disappears', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested('Unknown phone', '12');
    h.ui('reject_join');
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000001', decision: 'reject' });
    expect(h.view.screen).toBe('pairing');
    h.joinRequested('Unknown phone', '34', 'j_testjoin000002');
    h.back();
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000002', decision: 'reject' });
    expect(h.view.screen).toBe('pairing');
    h.joinRequested('Third phone', '56', 'j_testjoin000003');
    h.joinExpired('j_testjoin999999'); // some other request: ignored
    expect(h.view.screen).toBe('join_confirm');
    h.joinExpired('j_testjoin000003');
    expect(h.view.screen).toBe('pairing');
    expect(h.view.banner?.text).toContain('expired');
  });

  it('a join request that arrives when the TV is not pairing is refused rather than left hanging', async () => {
    const h = await boot();
    h.pairOnly();
    expect(h.view.screen).toBe('home');
    h.joinRequested('Late phone', '99', 'j_testjoin000009');
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000009', decision: 'reject' });
    expect(h.view.screen).toBe('home');
  });

  it('Cancel leaves pairing for Home without a confirmation; the code stays valid for a later attempt', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.ui('cancel');
    expect(h.view.screen).toBe('home');
    expect(h.of('session.begin')).toHaveLength(0);
    h.ui('start_session');
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
    expect(h.transport.connects).toHaveLength(1); // the open relay connection is reused
  });

  it('a failed or connecting link is reported and Try again reconnects', async () => {
    const h = await boot();
    h.ui('start_session');
    expect(h.view.link).toBe('connecting');
    expect(h.view.actions.find((a) => a.id === 'refresh_code')?.disabled).toBe(true);
    h.transportState('failed');
    expect(h.view.link).toBe('failed');
    expect(h.view.banner?.text).toContain('Could not reach the relay');
    expect(h.view.actions.find((a) => a.id === 'refresh_code')?.label).toBe('Try again');
    h.ui('refresh_code');
    expect(h.transport.connects).toHaveLength(2);
    h.transportState('connecting');
    expect(h.view.link).toBe('connecting');
    h.transportState('connected');
    expect(h.view.link).toBe('connecting'); // connected socket, not yet authenticated
    h.roomCreated();
    expect(h.view.link).toBe('connected');
  });

  it('a pairing the relay revoked during pairing can be started again', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.relayError('expired');
    expect(h.view.pairing?.code).toBeNull();
    expect(h.view.banner?.text).toContain('pairing');
    h.ui('refresh_code');
    expect(h.transport.connects).toHaveLength(2);
    h.transportState('connected');
    expect(h.last('room.create').payload).toMatchObject({ client: { platform: 'test' } });
    h.roomCreated({ generation: 1 });
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
  });

  it('a phone that is already in the room when the TV resumes goes straight to the microphone step', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.last('auth.resume').payload).toMatchObject({ role: 'tv' });
    h.authOk({ peer: true, paired: true, generation: 2 });
    expect(h.view.stage).toBe('permission_pending');
    expect(h.last('session.begin').payload.family_mode).toBe(false);
  });

  it('Back while waiting for the microphone leaves immediately and tells the phone the session ended', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.ui('accept_join');
    h.peerState(true);
    expect(h.view.stage).toBe('permission_pending');
    h.back();
    expect(h.last('session.end').payload).toEqual({ reason: 'user_exit' });
    expect(h.view.screen).toBe('home');
    await h.flush();
    expect(Object.keys(h.storage.dump()).filter((k) => k.startsWith('atr:v1:session:'))).toHaveLength(0);
  });

  it('leaving while a response is pending records that attempt as not revealed, unscored', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.runPhrase({});
    expect(h.view.stage).toBe('response_pending');
    h.ui('back');
    expect(h.view.screen).toBe('confirm_dialog');
    h.ui('confirm_destructive');
    await h.flush();
    const key = Object.keys(h.storage.dump()).find((k) => k.startsWith('atr:v1:session:')) as string;
    const rec = JSON.parse(h.storage.dump()[key] as string);
    expect(rec.attempts[0]).toMatchObject({ state: 'invalid', verdict: 'unscored', reason: 'session_ended' });
    expect(rec.complete).toBe(false);
  });

  it('a window result of the wrong kind for the open window is stale', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.wire(
      JSON.stringify({
        ...JSON.parse(h.relay('pong', {})),
        type: 'window.result',
        sender_role: 'phone',
        session_id: h.last('window.start').session_id,
        window_id: h.last('window.start').window_id,
        attempt_id: h.last('window.start').attempt_id,
        payload: h.windowPayload('vowel', {}),
      }),
    );
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.stage).toBe('phrase_active');
  });
});

describe('microphone states are shown as the phone reports them', () => {
  it('maps every phone state to a TV-visible state with an explanation', async () => {
    const cases: [MicStateName, string, string][] = [
      ['permission_denied', 'permission_denied', 'denied'],
      ['no_input', 'no_input', 'no microphone input'],
      ['input_busy', 'input_busy', 'in use'],
      ['constraints_unsupported', 'constraints_unsupported', 'settings'],
      ['error', 'error', 'error'],
    ];
    for (const [state, mic, text] of cases) {
      const h = await makeHarness();
      h.micState(state);
      expect(h.view.stage).toBe('permission_pending');
      expect(h.view.mic).toBe(mic);
      expect(h.view.body.join(' ')).toContain(text);
    }
    const h = await makeHarness();
    h.micState('permission_pending');
    expect(h.view.mic).toBe('waiting_for_permission');
    h.micState('measuring');
    expect(h.view.stage).toBe('quiet_check'); // an open microphone moves on
    expect(h.view.mic).toBe('measuring');
  });
});

async function makeHarness() {
  const h = await boot();
  h.ui('start_session');
  h.transportState('connected');
  h.roomCreated();
  h.joinRequested();
  h.ui('accept_join');
  h.peerState(true);
  return h;
}

describe('store lifecycle', () => {
  it('only notifies subscribers when the view changed and stops after unsubscribe', async () => {
    const h = await boot();
    const seen: string[] = [];
    const off = h.store.subscribe((v) => seen.push(v.screen));
    h.tick();
    h.tick();
    expect(seen).toEqual([]);
    h.ui('open_settings');
    expect(seen).toEqual(['settings']);
    off();
    h.back();
    expect(seen).toEqual(['settings']);
    expect(h.view.screen).toBe('home');
  });

  it('dispose cancels an open window, closes the relay link and ignores further input', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.store.dispose();
    expect(h.last('window.cancel').payload).toEqual({ reason: 'interrupted' });
    expect(h.transport.closes).toContain('dispose');
    const sent = h.transport.sent.length;
    h.ui('open_settings');
    h.advance(10_000);
    expect(h.transport.sent.length).toBe(sent);
    h.store.dispose();
  });
});

describe('helpers', () => {
  it('relay and phone URLs: scheme mapping, host kept, path dropped for the phone page, code in the fragment', () => {
    expect(relaySocketUrl('https://relay.example/ws')).toBe('wss://relay.example/ws');
    expect(relaySocketUrl('http://localhost:8080/ws')).toBe('ws://localhost:8080/ws');
    expect(relaySocketUrl('wss://relay.example/ws')).toBe('wss://relay.example/ws');
    expect(relaySocketUrl('ws://relay.example')).toBe('ws://relay.example');
    expect(relaySocketUrl('not a url')).toBe('not a url');
    expect(phoneJoinUrl('wss://relay.example:8443/ws?x=1', 'ACD EF')).toBe('https://relay.example:8443/#code=ACD%20EF');
    expect(phoneJoinUrl('https://relay.example/ws', 'ACDEFH')).toBe('https://relay.example/#code=ACDEFH');
    expect(phoneJoinUrl('http://127.0.0.1:3000', 'ACDEFH')).toBe('https://127.0.0.1:3000/#code=ACDEFH');
    expect(phoneJoinUrl('weird', 'ACDEFH')).toBe('weird/#code=ACDEFH');
  });

  it('delete reports unverifiable when the key listing fails afterwards', async () => {
    const storage = createFlakyStorage({ 'atr:v1:meta': '{}' });
    let calls = 0;
    const real = storage.getAllKeys.bind(storage);
    storage.getAllKeys = () => {
      calls += 1;
      return calls === 1 ? real() : Promise.reject(new Error('listing failed'));
    };
    expect(await deleteAllLocalData(storage)).toEqual({ ok: false, remaining: ['unverifiable'] });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeHashCode } from '../src/pairing.js';
import { mountView, type MountedView } from '../src/view.js';
import {
  ATTEMPT,
  authOk,
  CODE,
  CREDENTIAL,
  flush,
  joinAccepted,
  joinPending,
  lastMessageId,
  listenerOpen,
  precheckStart,
  relayMsg,
  ROOM,
  SESSION,
  sessionBegin,
  sessionEnd,
  sessionState,
  tvMsg,
  WINDOW,
  windowStart,
} from './helpers/fakes.js';
import { acceptedHarness, type Harness, makeHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Everything the phone has put on the wire, by type. */
const sentTypes = (h: Harness): string[] => h.sockets.current.messages().map((m) => m.type);
const nonJoinNonPing = (h: Harness): string[] => sentTypes(h).filter((t) => !['join.request', 'ping'].includes(t));

describe('A3-01: the phone asks "Did you just pick NN on your TV?" before it shares anything', () => {
  it('join.accepted moves to a confirming state: still on the Join screen, nothing confirmed, mic start disabled', async () => {
    const h = await acceptedHarness();
    const s = h.controller.getState();
    expect(s.join.phase).toBe('confirming');
    expect(s.join.confirmDigits).toBe('47');
    expect(s.screen).toBe('join');
    expect(s.pairingConfirmed).toBe(false);
    expect(s.canStartMic).toBe(false);
    expect(s.link).toBe('connected'); // the relay says accepted; the person has not
  });

  it('until Yes the phone sends only the join request: no mic.state, ack, phrases, cue, answer or level', async () => {
    const h = await acceptedHarness();
    expect(sentTypes(h)).toEqual(['join.request']);
    // things that would normally make the phone talk
    h.audio.makeOpen();
    h.audio.setState('permission_denied');
    h.audio.makeOpen();
    h.visibility.set('hidden');
    h.visibility.set('visible');
    h.controller.setCueWord('Hush');
    expect(h.controller.savePhrases(['Some private phrase']).sent).toBe(false);
    h.controller.sendCue();
    h.controller.answer('heard');
    h.controller.startMic();
    h.controller.stopMic();
    await flush();
    expect(sentTypes(h)).toEqual(['join.request']);
    expect(h.audio.openCalls).toHaveLength(0);
  });

  it('ping is allowed before Yes (the heartbeat keeps the connection alive) and is the only extra message', async () => {
    const h = await acceptedHarness();
    vi.advanceTimersByTime(10_000);
    h.sockets.current.receive(relayMsg('pong', { server_time: 1 }));
    vi.advanceTimersByTime(10_000);
    expect(sentTypes(h)).toEqual(['join.request', 'ping', 'ping']);
    expect(nonJoinNonPing(h)).toEqual([]);
  });

  it('TV commands are not acted on, not acknowledged and never touch the microphone before Yes', async () => {
    const h = await acceptedHarness();
    h.audio.makeOpen();
    for (const text of [
      sessionBegin(),
      sessionState('quiet_check'),
      precheckStart(),
      windowStart('phrase'),
      listenerOpen(),
      tvMsg('attempt.reveal', {}, { s: SESSION, w: WINDOW, a: ATTEMPT }),
      sessionEnd(),
    ]) {
      h.sockets.current.receive(text);
    }
    await flush();
    expect(sentTypes(h)).toEqual(['join.request']);
    expect(h.audio.precheckCalls).toHaveLength(0);
    expect(h.audio.windowCalls).toHaveLength(0);
    expect(h.audio.closeCalls).toBe(0);
    expect(h.controller.getState()).toMatchObject({ session: null, canAnswer: false, canCue: false });
  });

  it('"Yes, that was me" opens the setup screen and the first thing sent is mic.state', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    await flush();
    const s = h.controller.getState();
    expect(s).toMatchObject({ screen: 'setup', pairingConfirmed: true });
    expect(s.join.phase).toBe('idle');
    expect(sentTypes(h)).toEqual(['join.request', 'mic.state']);
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ state: 'off', visibility: 'visible' });
    // from now on the phone behaves normally
    expect(h.controller.getState().canStartMic).toBe(true);
    h.controller.startMic();
    expect(h.audio.openCalls).toHaveLength(1);
    expect(h.controller.savePhrases(['Now allowed']).sent).toBe(true);
    h.sockets.current.receive(sessionBegin());
    expect(h.sockets.current.last('ack').payload.outcome).toBe('applied');
  });

  it('Yes does nothing unless the phone is actually waiting for it', async () => {
    const h = makeHarness();
    h.controller.confirmPairing(); // no join at all
    expect(h.controller.getState()).toMatchObject({ screen: 'join', pairingConfirmed: false });
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.controller.confirmPairing(); // still waiting for the TV pick, not for Yes
    expect(h.controller.getState().pairingConfirmed).toBe(false);
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['join.request']);
  });

  it('"No, cancel" discards the credential, sends nothing, closes the connection and returns to Join', async () => {
    const h = await acceptedHarness();
    const socket = h.sockets.current;
    h.controller.rejectPairing();
    await flush();
    const s = h.controller.getState();
    expect(s).toMatchObject({ screen: 'join', pairingConfirmed: false, link: 'disconnected' });
    expect(s.join).toMatchObject({ phase: 'idle', confirmDigits: null, code: '' });
    expect(s.join.message).toBe('Cancelled. Nothing was shared with that TV.');
    expect(JSON.stringify(s)).not.toContain(CREDENTIAL);
    expect(socket.closeCalls.length).toBeGreaterThan(0);
    expect(socket.messages().map((m) => m.type)).toEqual(['join.request']);
    // the old connection can no longer influence the phone
    socket.receive(sessionBegin());
    socket.receive(joinAccepted());
    socket.receive(authOk());
    expect(h.controller.getState()).toMatchObject({ screen: 'join', pairingConfirmed: false });
    expect(socket.messages().map((m) => m.type)).toEqual(['join.request']);
    // no reconnect is ever attempted with the discarded credential
    vi.advanceTimersByTime(10 * 60_000);
    expect(h.sockets.sockets).toHaveLength(1);
    expect(h.controller.hasPairedBefore).toBe(false);
  });

  it('after No a fresh join works and needs its own confirmation', async () => {
    const h = await acceptedHarness();
    h.controller.rejectPairing();
    h.controller.setCode(CODE);
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(2);
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('83'));
    h.sockets.current.receive(joinAccepted());
    expect(h.controller.getState().join).toMatchObject({ phase: 'confirming', confirmDigits: '83' });
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['join.request']);
    h.controller.confirmPairing();
    expect(h.controller.getState().screen).toBe('setup');
  });

  it.each([
    ['the connection drops', (h: Harness) => h.sockets.current.drop(1006)],
    ['the relay says unpaired', (h: Harness) => h.sockets.current.receive(relayMsg('unpaired', { reason: 'room_closed' }))],
    ['the relay says revoked', (h: Harness) => h.sockets.current.receive(relayMsg('error', { code: 'revoked', ref_message_id: null, detail: '' }))],
    ['the relay says superseded', (h: Harness) => h.sockets.current.receive(relayMsg('error', { code: 'superseded', ref_message_id: null, detail: '' }))],
  ])('if %s before Yes, the pairing is discarded and never resumed', async (_name, act) => {
    const h = await acceptedHarness();
    act(h);
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', pairingConfirmed: false });
    expect(h.controller.getState().join.phase).toBe('idle');
    vi.advanceTimersByTime(10 * 60_000);
    expect(h.sockets.sockets).toHaveLength(1); // no auth.resume attempt
    expect(h.sockets.sockets[0]?.messages().some((m) => m.type === 'auth.resume')).toBe(false);
    expect(nonJoinNonPing(h)).toEqual([]);
  });

  it('a transient relay error while waiting for Yes does not end the wait', async () => {
    const h = await acceptedHarness();
    h.sockets.current.receive(relayMsg('error', { code: 'rate_limited', ref_message_id: null, detail: '' }));
    expect(h.controller.getState().join.phase).toBe('confirming');
  });

  it('a pairing confirmed once survives reconnects without asking again, and resumes with mic.state', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(authOk());
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'setup', link: 'connected', pairingConfirmed: true });
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['auth.resume', 'mic.state']);
  });

  it('a page reload asks again (the confirmation is not stored anywhere)', async () => {
    const h1 = await acceptedHarness();
    h1.controller.confirmPairing();
    const h2 = makeHarness();
    expect(h2.controller.getState()).toMatchObject({ screen: 'join', pairingConfirmed: false });
    expect(h2.controller.getState().canStartMic).toBe(false);
  });
});

describe('DEF-003: the TV announces its session while the question is on screen', () => {
  const SESSION_B = 's_session0002';
  const type = (h: Harness): string[] => h.sockets.current.messages().map((m) => m.type);
  const ackFor = (h: Harness, text: string) =>
    h.sockets.current.messages('ack').find((a) => a.payload['acked_message_id'] === lastMessageId(text));

  it('session.begin and session.state received before Yes are held: no ack, no state, nothing sent', async () => {
    const h = await acceptedHarness();
    h.sockets.current.receive(sessionBegin());
    h.sockets.current.receive(sessionState('quiet_check'));
    await flush();
    expect(type(h)).toEqual(['join.request']);
    expect(h.controller.getState().session).toBeNull(); // held, not acted on
    expect(h.controller.getState()).toMatchObject({ canStartMic: false, pairingConfirmed: false });
  });

  it('on Yes: mic.state first, then session.begin is applied and acked, then session.state is applied and acked', async () => {
    const h = await acceptedHarness();
    const begin = sessionBegin();
    const state = sessionState('quiet_check', 1);
    h.sockets.current.receive(begin);
    h.sockets.current.receive(state);
    h.controller.confirmPairing();
    await flush();
    const msgs = h.sockets.current.messages();
    expect(msgs[0]?.type).toBe('join.request');
    expect(msgs[1]?.type).toBe('mic.state'); // the very first thing after Yes
    const beginAck = ackFor(h, begin);
    const stateAck = ackFor(h, state);
    expect(beginAck).toMatchObject({ session_id: SESSION, window_id: null, attempt_id: null, payload: { outcome: 'applied' } });
    expect(stateAck).toMatchObject({ session_id: SESSION, payload: { outcome: 'applied' } });
    const at = (m: { message_id: string } | undefined): number => msgs.findIndex((x) => x.message_id === m?.message_id);
    expect(at(beginAck)).toBeGreaterThan(1);
    expect(at(stateAck)).toBeGreaterThan(at(beginAck));
    expect(h.controller.getState().session).toMatchObject({ sessionId: SESSION, familyMode: true, phraseCount: 4, stage: 'quiet_check' });
    expect(h.controller.getState().cue.used).toBe(1);
    // the first mic.state knew of no session; the next one carries it
    expect(h.sockets.current.messages('mic.state')[0]?.session_id).toBeNull();
    expect(h.sockets.current.messages('mic.state').some((m) => m.session_id === SESSION)).toBe(true);
  });

  it('the regression: after Yes the TV commands for that session are accepted, not "ignored_stale unknown_session"', async () => {
    const h = await acceptedHarness();
    h.sockets.current.receive(sessionBegin());
    h.sockets.current.receive(sessionState('permission_pending'));
    h.controller.confirmPairing();
    h.audio.makeOpen();
    await flush();
    const later = sessionState('quiet_check', 0);
    h.sockets.current.receive(later);
    expect(ackFor(h, later)?.payload).toMatchObject({ outcome: 'applied' });
    const pre = precheckStart('quiet_check');
    h.sockets.current.receive(pre);
    expect(ackFor(h, pre)?.payload).toMatchObject({ outcome: 'applied' });
    expect(h.audio.precheckCalls).toEqual([{ purpose: 'quiet_check', durationMs: 5000 }]);
  });

  it('only the latest session.begin and the latest session.state are kept', async () => {
    const h = await acceptedHarness();
    h.sockets.current.receive(sessionBegin(SESSION));
    h.sockets.current.receive(sessionState('pairing', 0, null, SESSION));
    h.sockets.current.receive(sessionState('permission_pending', 2, null, SESSION));
    const last = sessionBegin(SESSION_B);
    h.sockets.current.receive(last);
    h.controller.confirmPairing();
    await flush();
    expect(h.controller.getState().session).toMatchObject({ sessionId: SESSION_B, stage: null });
    const acks = h.sockets.current.messages('ack');
    expect(acks).toHaveLength(1); // the older begin and both older states were superseded
    expect(acks[0]).toMatchObject({ session_id: SESSION_B, payload: { outcome: 'applied' } });
  });

  it('a held state without a held begin is answered ignored_stale (the TV resends begin defensively)', async () => {
    const h = await acceptedHarness();
    const state = sessionState('quiet_check');
    h.sockets.current.receive(state);
    h.controller.confirmPairing();
    await flush();
    expect(ackFor(h, state)?.payload).toMatchObject({ outcome: 'ignored_stale', detail: 'unknown_session' });
    expect(h.controller.getState().session).toBeNull();
    const again = sessionBegin();
    h.sockets.current.receive(again);
    expect(ackFor(h, again)?.payload.outcome).toBe('applied');
  });

  it('measurement commands before Yes are dropped for good: never run, never acked, even after Yes', async () => {
    const h = await acceptedHarness();
    h.audio.makeOpen();
    const dropped = [precheckStart(), windowStart('phrase'), listenerOpen(), tvMsg('window.stop', { reason: 'complete' }, { s: SESSION, w: WINDOW, a: ATTEMPT }), tvMsg('window.cancel', { reason: 'user_cancel' }, { s: SESSION, w: WINDOW, a: ATTEMPT }), tvMsg('attempt.reveal', {}, { s: SESSION, w: WINDOW, a: ATTEMPT }), sessionEnd()];
    h.sockets.current.receive(sessionBegin());
    for (const text of dropped) h.sockets.current.receive(text);
    h.controller.confirmPairing();
    await flush();
    for (const text of dropped) expect(ackFor(h, text), 'no ack for a dropped command').toBeUndefined();
    expect(h.audio.precheckCalls).toHaveLength(0);
    expect(h.audio.windowCalls).toHaveLength(0);
    expect(h.audio.closeCalls).toBe(0);
    expect(h.controller.getState()).toMatchObject({ run: null, canAnswer: false });
    expect(h.controller.getState().session).toMatchObject({ sessionId: SESSION }); // only the begin was applied
  });

  it('No discards the held messages: nothing is applied or acked later, and a new pairing starts clean', async () => {
    const h = await acceptedHarness();
    const begin = sessionBegin();
    h.sockets.current.receive(begin);
    h.sockets.current.receive(sessionState('quiet_check', 2));
    h.controller.rejectPairing();
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['join.request']);
    // second pairing
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('83'));
    h.sockets.current.receive(joinAccepted());
    h.controller.confirmPairing();
    await flush();
    expect(h.controller.getState().session).toBeNull();
    expect(h.controller.getState().cue.used).toBe(0);
    expect(h.sockets.current.messages('ack')).toHaveLength(0);
  });

  it.each([
    ['the connection drops', (h: Harness) => h.sockets.current.drop(1006)],
    ['the relay says unpaired', (h: Harness) => h.sockets.current.receive(relayMsg('unpaired', { reason: 'room_closed' }))],
  ])('held messages are discarded when %s before Yes', async (_n, act) => {
    const h = await acceptedHarness();
    h.sockets.current.receive(sessionBegin());
    act(h);
    await flush();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(joinAccepted());
    h.controller.confirmPairing();
    await flush();
    expect(h.controller.getState().session).toBeNull();
    expect(h.sockets.current.messages('ack')).toHaveLength(0);
  });

  it('messages held for one pairing are not applied to another room: a begin arriving after Yes is the normal path', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    await flush();
    const begin = sessionBegin();
    h.sockets.current.receive(begin);
    expect(ackFor(h, begin)?.payload.outcome).toBe('applied');
  });

  it('nothing is held once the pairing is confirmed (commands are applied at once) or after No (a stray late message from the old connection is ignored)', async () => {
    const k = await acceptedHarness();
    k.controller.confirmPairing();
    await flush();
    k.sockets.current.receive(sessionBegin());
    k.sockets.current.receive(sessionState('quiet_check'));
    expect(k.controller.getState().session).toMatchObject({ stage: 'quiet_check' });

    const h = await acceptedHarness();
    const old = h.sockets.current;
    h.controller.rejectPairing();
    old.receive(sessionBegin()); // the old, closed connection says something late
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(joinAccepted());
    h.controller.confirmPairing();
    await flush();
    expect(h.controller.getState().session).toBeNull();
  });
});

describe('DEF-003: session.begin is idempotent for the same session id', () => {
  it('a repeat is acked applied and changes nothing: stage, position, cue count and an open window survive', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    h.audio.makeOpen();
    await flush();
    h.sockets.current.receive(sessionBegin());
    h.sockets.current.receive(sessionState('phrase_active', 2, null));
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    const before = h.controller.getState();
    const again = sessionBegin();
    h.sockets.current.receive(again);
    const ack = h.sockets.current.messages('ack').find((a) => a.payload['acked_message_id'] === lastMessageId(again));
    expect(ack?.payload).toMatchObject({ outcome: 'applied' });
    const after = h.controller.getState();
    expect(after.session).toEqual(before.session);
    expect(after.session?.stage).toBe('phrase_active');
    expect(after.cue.used).toBe(2);
    expect(after.run).toEqual(before.run); // the open window is untouched
    expect(h.audio.hasOpenRun).toBe(true);
    // and a few more repeats do not disturb anything either
    for (let i = 0; i < 3; i++) h.sockets.current.receive(sessionBegin());
    expect(h.controller.getState().session).toEqual(before.session);
    expect(h.audio.windowCalls).toHaveLength(1);
  });

  it('a repeat that carries a different configuration refreshes only that, keeping progress', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    await flush();
    h.sockets.current.receive(sessionBegin());
    h.sockets.current.receive(sessionState('calibration', 1));
    h.sockets.current.receive(tvMsg('session.begin', { family_mode: false, phrase_count: 7, cues_max: 3 }, { s: SESSION }));
    expect(h.controller.getState().session).toMatchObject({ familyMode: false, phraseCount: 7, stage: 'calibration' });
    expect(h.controller.getState().cue.used).toBe(1);
  });

  it('a begin for a DIFFERENT session still starts that session fresh (cue count reset, old window discarded)', async () => {
    const h = await acceptedHarness();
    h.controller.confirmPairing();
    h.audio.makeOpen();
    await flush();
    h.sockets.current.receive(sessionBegin());
    h.sockets.current.receive(sessionState('phrase_active', 2, null));
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.sockets.current.receive(sessionBegin('s_session0002'));
    expect(h.controller.getState().session).toMatchObject({ sessionId: 's_session0002', stage: null });
    expect(h.controller.getState().cue.used).toBe(0);
    expect(h.controller.getState().run).toBeNull();
    expect(h.audio.hasOpenRun).toBe(false);
  });
});

describe('A3-01 hostile QR: an attacker-run room that accepts everything', () => {
  const AMENDED = /Did you just pick 47 on your TV\?/;
  let root: HTMLElement;
  let view: MountedView | null = null;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('scanning the QR only pre-fills the code: no connection is opened until the person taps Join', () => {
    const h = makeHarness();
    // exactly what main.ts does with https://phone.example/#code=ACDEFH
    const replaceState = vi.fn();
    const code = consumeHashCode({ location: { hash: '#code=ACDEFH', pathname: '/', search: '' }, history: { replaceState } });
    if (code) h.controller.setCode(code);
    root = document.body.appendChild(document.createElement('div'));
    view = mountView(root, h.controller);
    expect((document.getElementById('code') as HTMLInputElement).value).toBe('ACDEFH');
    vi.advanceTimersByTime(60_000);
    expect(h.sockets.sockets).toHaveLength(0); // never auto-joins
    expect(replaceState).toHaveBeenCalled(); // the fragment is gone from the address bar
  });

  it('the attacker auto-accepts; the phone never transmits phrases, mic state or acks without Yes, and No tears it down', async () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    root = document.body.appendChild(document.createElement('div'));
    view = mountView(root, h.controller);

    // the person taps Join (their only action)
    $('join').click();
    const attacker = h.sockets.current;
    attacker.open();
    // the attacker's room replies instantly, with no TV user involved, then tries to drive the phone
    attacker.receive(joinPending('47'));
    attacker.receive(joinAccepted());
    attacker.receive(sessionBegin());
    attacker.receive(precheckStart());
    attacker.receive(windowStart('phrase'));
    attacker.receive(listenerOpen());
    attacker.receive(tvMsg('session.state', { stage: 'phrase_active', phrase_position: 1, cues_used: 0, listener_open_attempt: null }, { s: SESSION }));
    await flush();

    // what the person sees: only the confirmation question, nothing else usable
    expect($('confirm-self').hidden).toBe(false);
    expect($('confirm-heading').textContent).toMatch(AMENDED);
    expect($('confirm-yes').textContent).toBe('Yes, that was me');
    expect($('confirm-no').textContent).toBe('No, cancel');
    expect($('view-setup').hidden).toBe(true);
    expect($('join-form').hidden).toBe(true);
    expect(($('start-mic') as HTMLButtonElement).disabled).toBe(true);

    // even if somebody pokes the hidden controls, nothing is transmitted
    $('start-mic').click();
    $('save-phrases').click();
    $('cue').click();
    ($('phrase-1') as HTMLInputElement).value = 'My medication is at 9 pm';
    $('phrase-1').dispatchEvent(new Event('input', { bubbles: true }));
    $('save-phrases').click();
    h.controller.savePhrases(['My medication is at 9 pm']);
    h.audio.makeOpen();
    h.visibility.set('hidden');
    h.visibility.set('visible');

    // a long time passes with the person undecided (heartbeat only; the attacker's relay answers pings)
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(10_000);
      attacker.receive(relayMsg('pong', { server_time: 1 }));
    }
    const types = attacker.messages().map((m) => m.type);
    expect(new Set(types)).toEqual(new Set(['join.request', 'ping']));
    expect(h.audio.openCalls).toHaveLength(0);
    expect(h.audio.precheckCalls).toHaveLength(0);
    expect(h.audio.windowCalls).toHaveLength(0);
    const wire = attacker.sent.join('\n');
    expect(wire).not.toContain('medication'); // the typed text never left the phone
    expect(wire).not.toContain('mic.state');
    expect(wire).not.toContain('phrases.update');

    // "No, cancel"
    $('confirm-no').click();
    expect($('confirm-self').hidden).toBe(true);
    expect($('view-join').hidden).toBe(false);
    expect($('join-form').hidden).toBe(false);
    expect(document.getElementById('join-msg')?.textContent).toBe('Cancelled. Nothing was shared with that TV.');
    expect(attacker.closeCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.controller.getState())).not.toContain(CREDENTIAL);
    // the attacker keeps talking; the phone has stopped listening and never answers
    const sentBefore = attacker.sent.length;
    attacker.receive(sessionBegin());
    attacker.receive(authOk());
    vi.advanceTimersByTime(60_000);
    expect(attacker.sent.length).toBe(sentBefore);
    expect(h.sockets.sockets).toHaveLength(1);
    expect(attacker.messages().some((m) => m.type === 'auth.resume')).toBe(false);
  });

  it('the legitimate path through the same UI: pick on the TV, Yes, then the phone starts talking with mic.state', async () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    root = document.body.appendChild(document.createElement('div'));
    view = mountView(root, h.controller);
    $('join').click();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('47'));
    expect($('pending-heading').textContent).toBe('On your TV, pick 47');
    h.sockets.current.receive(joinAccepted());
    expect($('confirm-heading').textContent).toBe('Did you just pick 47 on your TV?');
    expect(document.activeElement?.id).toBe('confirm-heading');
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['join.request']);
    $('confirm-yes').click();
    expect($('view-setup').hidden).toBe(false);
    expect($('confirm-self').hidden).toBe(true);
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['join.request', 'mic.state']);
    expect(($('start-mic') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the status region announces the question, and the digits are shown as text (never markup)', async () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    root = document.body.appendChild(document.createElement('div'));
    view = mountView(root, h.controller);
    $('join').click();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('47'));
    expect($('status').textContent).toBe('On your TV, pick 47');
    h.sockets.current.receive(joinAccepted());
    expect($('status').textContent).toBe('Did you just pick 47 on your TV?');
    expect($('confirm-heading').querySelector('strong')?.textContent).toBe('47');
    expect($('confirm-self').textContent).toMatch(/shares nothing with that TV/);
    void ROOM;
  });
});

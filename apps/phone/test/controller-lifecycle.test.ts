import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authOk,
  CREDENTIAL,
  NEXT_CREDENTIAL,
  flush,
  precheckStart,
  relayMsg,
  ROOM,
  sessionBegin,
  validWindow,
  windowStart,
} from './helpers/fakes.js';
import { type Harness, pairedHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function ready(opts: { session?: boolean } = {}): Promise<Harness> {
  const h = await pairedHarness();
  if (opts.session !== false) h.sockets.current.receive(sessionBegin());
  h.audio.makeOpen();
  await flush();
  return h;
}

/** Drop the connection and let the first reconnect timer fire; returns the new (unopened) socket count. */
async function dropAndReconnect(h: Harness, delayMs = 500): Promise<void> {
  h.sockets.current.drop(1006);
  vi.advanceTimersByTime(delayMs);
  h.sockets.current.open();
  h.sockets.current.receive(authOk());
  await flush();
}

describe('wake lock ("Keep this screen on")', () => {
  it('is requested after the microphone opens, and the state is what the browser did', async () => {
    const h = await pairedHarness();
    expect(h.wakeApi.requests).toBe(0);
    h.audio.makeOpen();
    await flush();
    expect(h.wakeApi.requests).toBe(1);
    expect(h.controller.getState().wakeLock).toBe('held');
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ wake_lock: 'held', state: 'open_idle' });
  });

  it('browser-initiated release is observed and reported, and not re-requested in a loop', async () => {
    const h = await ready();
    h.wakeApi.sentinels[0]?.browserRelease();
    await flush();
    expect(h.controller.getState().wakeLock).toBe('released');
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ wake_lock: 'released' });
    expect(h.wakeApi.requests).toBe(1);
  });

  it('a rejected request is reported as rejected; no API is reported as unsupported', async () => {
    const h = await pairedHarness();
    h.wakeApi.rejectNext = true;
    h.audio.makeOpen();
    await flush();
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ wake_lock: 'rejected' });
    const u = await pairedHarness({ wakeSupported: false });
    u.audio.makeOpen();
    await flush();
    expect(u.sockets.current.last('mic.state').payload).toMatchObject({ wake_lock: 'unsupported' });
  });
});

describe('unpaired', () => {
  it.each(['tv_unpaired', 'room_closed', 'expired'] as const)('unpaired (%s): everything is shut down, credentials dropped, "no longer paired" shown', async (reason) => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    expect(h.wakeApi.active).toHaveLength(1);
    const socketsBefore = h.sockets.sockets.length;
    h.sockets.current.receive(relayMsg('unpaired', { reason }));
    await flush();
    const s = h.controller.getState();
    expect(s.screen).toBe('join');
    expect(s.unpairedReason).toBe(reason);
    expect(s.pairingConfirmed).toBe(false);
    expect(s.join.phase).toBe('idle');
    expect(h.audio.closeCalls).toBeGreaterThan(0);
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.audio.hasOpenRun).toBe(false);
    expect(h.wakeApi.active).toHaveLength(0);
    expect(s).toMatchObject({ session: null, run: null, canAnswer: false, canCue: false, canStartMic: false });
    expect(JSON.stringify(s)).not.toContain(CREDENTIAL);
    expect(s.link).toBe('disconnected');
    // no reconnect is ever attempted with the revoked credential
    vi.advanceTimersByTime(60_000);
    expect(h.sockets.sockets).toHaveLength(socketsBefore);
  });

  it('nothing is sent after unpairing (no mic.state, no results)', async () => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    const before = h.sockets.current.sent.length;
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect(h.sockets.current.sent.length).toBe(before);
  });

  it('after an unpair the Join form is ready again with a clean slate, and a new join clears the explanation', async () => {
    const h = await ready();
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: 'tv_unpaired' });
    expect(h.controller.getState().join).toMatchObject({ phase: 'idle', code: '', confirmDigits: null });
    h.controller.setCode('ACDEFH');
    h.controller.join();
    expect(h.controller.getState()).toMatchObject({ unpairedReason: null });
    expect(h.sockets.sockets).toHaveLength(2);
  });
});

describe('page visibility', () => {
  it('hidden during a window: interrupted result with the window ids, capture shut down completely, Mic off reported with visibility hidden', async () => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.frame(1);
    h.sockets.current.sent.length = 0;
    h.visibility.set('hidden');
    await flush();
    const res = h.sockets.current.last('window.result');
    expect(res.payload).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    expect(res).toMatchObject({ window_id: 'w_window00001', attempt_id: 'a_attempt0001' });
    expect(h.audio.closeCalls).toBeGreaterThan(0);
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.wakeApi.active).toHaveLength(0);
    const mic = h.sockets.current.last('mic.state');
    expect(mic.payload).toMatchObject({ state: 'off', visibility: 'hidden' });
    expect(h.controller.getState()).toMatchObject({ run: null, canAnswer: false });
    // no level frame after the interruption
    const types = h.sockets.current.messages().map((m) => m.type);
    expect(types.indexOf('window.result')).toBeLessThan(types.lastIndexOf('mic.state'));
    expect(types).not.toContain('level');
  });

  it('hidden during a precheck: precheck.result interrupted', async () => {
    const h = await ready();
    h.sockets.current.receive(precheckStart());
    h.visibility.set('hidden');
    await flush();
    expect(h.sockets.current.last('precheck.result').payload).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
  });

  it('hidden with nothing open still reports visibility', async () => {
    const h = await pairedHarness();
    h.sockets.current.sent.length = 0;
    h.visibility.set('hidden');
    await flush();
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ visibility: 'hidden', state: 'off' });
    expect(h.sockets.current.messages('window.result')).toHaveLength(0);
  });

  it('visible again: nothing restarts by itself; the wake lock returns only while a session is active', async () => {
    const h = await ready(); // session active
    h.visibility.set('hidden');
    await flush();
    expect(h.wakeApi.active).toHaveLength(0);
    h.visibility.set('visible');
    await flush();
    expect(h.audio.openCalls).toHaveLength(0); // never auto-restarts capture
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.wakeApi.active).toHaveLength(1); // session still active: screen kept on while the user restarts
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ visibility: 'visible', state: 'off', wake_lock: 'held' });

    const g = await ready({ session: false }); // no session
    g.visibility.set('hidden');
    await flush();
    g.visibility.set('visible');
    await flush();
    expect(g.wakeApi.active).toHaveLength(0);
  });

  it('window.start while hidden is rejected, and Start microphone is disabled while hidden', async () => {
    const h = await ready();
    h.visibility.set('hidden');
    await flush();
    expect(h.controller.getState().canStartMic).toBe(false);
    h.audio.makeOpen(); // even if something reopened it
    h.sockets.current.receive(windowStart('phrase'));
    const ack = h.sockets.current.last('ack');
    expect(ack.payload).toMatchObject({ outcome: 'rejected', detail: 'page_hidden' });
  });
});

describe('user turns the microphone off', () => {
  it('interrupts an open run, releases everything and reports Mic off', async () => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.controller.stopMic();
    await flush();
    expect(h.sockets.current.last('window.result').payload).toMatchObject({ invalid_reason: 'interrupted' });
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ state: 'off' });
  });
});

describe('reconnect (ADR-0006)', () => {
  it('first retry after 0.5 s sends auth.resume with the in-memory credential, then continues on generation 2 with the sequence restarted', async () => {
    const h = await ready();
    const first = h.sockets.current;
    const lastSeq = first.messages().at(-1)?.sequence ?? 0;
    expect(lastSeq).toBeGreaterThan(0);
    first.drop(1006);
    expect(h.controller.getState()).toMatchObject({ link: 'reconnecting', reconnectAttempt: 1, tvConnected: null });
    vi.advanceTimersByTime(499);
    expect(h.sockets.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.sockets.sockets).toHaveLength(2);
    const second = h.sockets.current;
    second.open();
    const resume = second.messages()[0];
    expect(resume).toMatchObject({
      type: 'auth.resume',
      room_id: null,
      producer_generation: 0,
      sequence: 0,
      payload: { room_id: ROOM, role: 'phone', credential: CREDENTIAL },
    });
    second.receive(authOk(2, true));
    await flush();
    const s = h.controller.getState();
    expect(s).toMatchObject({ link: 'connected', reconnectAttempt: 0, tvConnected: true });
    const mic = second.messages('mic.state')[0];
    expect(mic).toMatchObject({ room_id: ROOM, producer_generation: 2, sequence: 0 });
    const ack = h.controller.getState();
    expect(ack.mic.state).toBe('open_idle'); // microphone itself was never touched by the link loss
  });

  it('backoff schedule is 0.5, 1, 2, 4, 8, 8 seconds while the relay stays unreachable', async () => {
    const h = await ready();
    h.sockets.current.drop(1006);
    const delays = [500, 1000, 2000, 4000, 8000, 8000, 8000];
    for (const [i, delay] of delays.entries()) {
      const before = h.sockets.sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(h.sockets.sockets.length, `attempt ${i + 1} fired early`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(h.sockets.sockets.length, `attempt ${i + 1} did not fire`).toBe(before + 1);
      expect(h.controller.getState().reconnectAttempt).toBe(i + 1);
      h.sockets.current.drop(1006); // the new socket fails before opening
    }
  });

  it('the schedule restarts after a successful authentication', async () => {
    const h = await ready();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(1000);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    h.sockets.current.drop(1006);
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(500);
    expect(h.sockets.sockets.length).toBe(n + 1);
  });

  it('a window open at disconnect becomes interrupted: levels stop, a fresh explicit start is needed, and the interrupted result is delivered after reconnecting', async () => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.frame(1);
    const levelsBefore = h.sockets.current.messages('level').length;
    const emit = h.audio.lastOnFrame;
    h.sockets.current.drop(1006);
    expect(h.controller.getState().run).toBeNull();
    expect(h.audio.hasOpenRun).toBe(false);
    emit?.({ frameIndex: 2, tAudioMs: 100, dbfs: -30, active: true, clipped: false });
    expect(h.sockets.current.messages('level').length).toBe(levelsBefore); // nothing sent while down
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    const res = h.sockets.current.messages('window.result');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ window_id: 'w_window00001', payload: { valid: false, invalid_reason: 'interrupted' } });
    // the window is closed: the same ids cannot be restarted
    h.sockets.current.receive(windowStart('phrase'));
    expect(h.sockets.current.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.audio.windowCalls).toHaveLength(1);
    void validWindow;
  });

  it.each([
    ['revoked', 'revoked'],
    ['expired', 'expired'],
    ['superseded', 'superseded'],
  ] as const)('auth.resume refused with %s ends pairing (%s) and stops reconnecting', async (code, reason) => {
    const h = await ready();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code, ref_message_id: null, detail: '' }));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: reason });
    expect(h.audio.getSnapshot().state).toBe('off');
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(60_000);
    expect(h.sockets.sockets.length).toBe(n);
  });

  it('a transient refusal (rate_limited) keeps retrying', async () => {
    const h = await ready();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code: 'rate_limited', ref_message_id: null, detail: '' }));
    h.sockets.current.drop(4429);
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(1000);
    expect(h.sockets.sockets.length).toBe(n + 1);
    expect(h.controller.getState().screen).toBe('setup');
  });

  it('auth.ok with phone_paired false ends pairing', async () => {
    const h = await ready();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('auth.ok', { role: 'phone', generation: 2, peer_connected: true, phone_paired: false, next_credential: NEXT_CREDENTIAL }));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: 'revoked' });
  });

  it('retryNow reconnects immediately', async () => {
    const h = await ready();
    h.sockets.current.drop(1006);
    h.controller.retryNow();
    expect(h.sockets.sockets).toHaveLength(2);
    vi.advanceTimersByTime(60_000); // the old timer must be gone: no third socket from it
    expect(h.sockets.sockets).toHaveLength(2);
  });

  it('messages naming another room are ignored', async () => {
    const h = await ready();
    const text = windowStart('phrase').replace(ROOM, 'r_otherroomotherr01');
    h.sockets.current.receive(text);
    expect(h.audio.windowCalls).toHaveLength(0);
    expect(h.sockets.current.messages('ack')).toHaveLength(1); // only the session.begin ack
  });

  it('while the TV is away, an interrupted result is held until it returns', async () => {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.sockets.current.receive(relayMsg('peer.state', { role: 'tv', connected: false, generation: 1 }));
    expect(h.sockets.current.messages('window.result')).toHaveLength(0);
    expect(h.controller.getState().run).toBeNull();
    h.sockets.current.receive(relayMsg('peer.state', { role: 'tv', connected: true, generation: 2 }));
    expect(h.sockets.current.messages('window.result')).toHaveLength(1);
  });
});

describe('heartbeat', () => {
  it('pings every 10 s with increasing sequence while connected', async () => {
    const h = await ready();
    h.sockets.current.sent.length = 0;
    vi.advanceTimersByTime(10_000);
    h.sockets.current.receive(relayMsg('pong', { server_time: 1 }));
    vi.advanceTimersByTime(10_000);
    const pings = h.sockets.current.messages('ping');
    expect(pings).toHaveLength(2);
    expect(pings[1]?.sequence).toBeGreaterThan(pings[0]?.sequence ?? 0);
    expect(pings[0]).toMatchObject({ room_id: ROOM, producer_generation: 1 });
  });

  it('silence for more than 25 s makes the link unknown and starts reconnecting', async () => {
    const h = await ready();
    vi.advanceTimersByTime(30_000);
    expect(h.controller.getState()).toMatchObject({ link: 'reconnecting', tvConnected: null });
  });
});

describe('connection state shown to the user', () => {
  it('reconnecting is "connection unknown", not "off"', async () => {
    const h = await ready();
    await dropAndReconnect(h); // sanity: helper works
    h.sockets.current.drop(1006);
    expect(h.controller.getState().link).toBe('reconnecting');
    expect(h.controller.getState().tvConnected).toBeNull();
  });
});

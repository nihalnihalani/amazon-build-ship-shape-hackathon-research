import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceLive, acceptedHarness, readyHarness, type Harness } from './helpers/harness.js';
import { authOk, flush, relayMsg, SESSION, validWindow, windowStart } from './helpers/fakes.js';

/**
 * DEF-004: when the TV (re)connects, the relay tells the phone with `peer.state {role: 'tv',
 * connected: true}`. The TV then knows nothing about the phone ("Phone state unknown") because the
 * phone only sent mic.state when something changed. The phone now re-reports its current mic.state
 * on every such message, at most once per second.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const peer = (h: Harness, connected: boolean, generation = 1, role: 'tv' | 'phone' = 'tv'): void => {
  h.sockets.current.receive(relayMsg('peer.state', { role, connected, generation }));
};
const mics = (h: Harness) => h.sockets.current.messages('mic.state');
/** Everything in a mic.state except the per-message envelope fields. */
const body = (m: ReturnType<typeof mics>[number]) => ({ payload: m.payload, session_id: m.session_id });

describe('DEF-004: re-report mic.state when the TV connects', () => {
  it('peer.state tv connected:true sends the current mic.state even though nothing changed', async () => {
    const h = await readyHarness();
    const before = mics(h).length;
    peer(h, true);
    expect(mics(h)).toHaveLength(before + 1);
    expect(mics(h).at(-1)?.payload).toMatchObject({ state: 'open_idle', visibility: 'visible' });
    expect(h.controller.getState().tvConnected).toBe(true);
  });

  it('includes the session_id when a session is known, and null when it is not', async () => {
    const h = await readyHarness();
    peer(h, true);
    expect(mics(h).at(-1)?.session_id).toBe(SESSION);
    const idle = await acceptedHarness();
    idle.controller.confirmPairing();
    await flush();
    const n = mics(idle).length;
    peer(idle, true);
    expect(mics(idle)).toHaveLength(n + 1);
    expect(mics(idle).at(-1)?.session_id).toBeNull();
  });

  it('reports the CURRENT state: mic off, permission denied, measuring ... whatever it is now', async () => {
    const h = await readyHarness();
    h.audio.setState('permission_denied');
    await flush();
    vi.advanceTimersByTime(1500);
    peer(h, true);
    expect(mics(h).at(-1)?.payload).toMatchObject({ state: 'permission_denied' });
    h.controller.stopMic();
    h.audio.setState('off');
    await flush();
    vi.advanceTimersByTime(1500);
    peer(h, true, 2);
    expect(mics(h).at(-1)?.payload).toMatchObject({ state: 'off' });
  });

  it('connected:false sends nothing; false followed by true re-reports', async () => {
    const h = await readyHarness();
    const n = mics(h).length;
    peer(h, false);
    expect(mics(h)).toHaveLength(n);
    expect(h.controller.getState().tvConnected).toBe(false);
    peer(h, true, 2);
    expect(mics(h)).toHaveLength(n + 1);
    expect(h.controller.getState().tvConnected).toBe(true);
  });

  it('a generation change with no "disconnected" in between (TV superseded itself) re-reports too', async () => {
    const h = await readyHarness();
    peer(h, true, 1);
    const n = mics(h).length;
    vi.advanceTimersByTime(1000);
    peer(h, true, 2);
    expect(mics(h)).toHaveLength(n + 1);
    vi.advanceTimersByTime(1000);
    peer(h, true, 3);
    expect(mics(h)).toHaveLength(n + 2);
  });

  it('the TV link dropping mid-window: run interrupted, then on reconnect mic.state first and the interrupted result after it', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.frame(1);
    expect(h.controller.getState().run).not.toBeNull();
    peer(h, false);
    expect(h.controller.getState().run).toBeNull(); // interrupted: levels stop
    expect(h.sockets.current.messages('window.result')).toHaveLength(0); // held while the TV is away
    const sentBefore = h.sockets.current.sent.length;
    peer(h, true, 2);
    const after = h.sockets.current.messages().slice(sentBefore);
    expect(after.map((m) => m.type)).toEqual(['mic.state', 'window.result']);
    expect(after[1]?.payload).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    expect(after[0]?.session_id).toBe(SESSION);
  });
});

describe('DEF-004: idempotent and at most one per second', () => {
  it('repeated reports are identical apart from ids and timestamps', async () => {
    const h = await readyHarness();
    peer(h, true, 1);
    vi.advanceTimersByTime(1000);
    peer(h, true, 2);
    vi.advanceTimersByTime(1000);
    peer(h, true, 3);
    const [a, b, c] = mics(h).slice(-3);
    expect(body(b as never)).toEqual(body(a as never));
    expect(body(c as never)).toEqual(body(a as never));
  });

  it('a burst of peer.state produces one report now and one trailing report when the second is up', async () => {
    const h = await readyHarness();
    const n = mics(h).length;
    for (let i = 0; i < 6; i++) {
      peer(h, true, 1 + i);
      vi.advanceTimersByTime(100);
    }
    expect(mics(h)).toHaveLength(n + 1); // the first only, so far
    vi.advanceTimersByTime(400); // 1000 ms after the first report
    expect(mics(h)).toHaveLength(n + 2); // the trailing one
    vi.advanceTimersByTime(10_000);
    expect(mics(h)).toHaveLength(n + 2); // and nothing more
  });

  it('never more than one report per second, however hard the TV flaps', async () => {
    const h = await readyHarness();
    const before = mics(h).length;
    const seenAt: number[] = []; // fake wall-clock time at which each report appeared
    let count = before;
    const note = (): void => {
      const now = mics(h).length;
      for (; count < now; count++) seenAt.push(Date.now());
    };
    for (let t = 0; t < 5000; t += 50) {
      peer(h, t % 100 === 0, 1 + t / 50); // true / false alternating every 50 ms
      note();
      vi.advanceTimersByTime(50);
      note();
    }
    vi.advanceTimersByTime(2000);
    note();
    expect(seenAt.length).toBeGreaterThanOrEqual(3); // it does keep reporting while the TV keeps coming back
    expect(seenAt.length).toBeLessThanOrEqual(7); // 5 s of flapping + a trailing one
    for (let i = 1; i < seenAt.length; i++) expect((seenAt[i] as number) - (seenAt[i - 1] as number)).toBeGreaterThanOrEqual(1000);
  });

  it('the trailing report carries the state at that moment, not the state when it was requested', async () => {
    const h = await readyHarness();
    peer(h, true, 1); // immediate
    vi.advanceTimersByTime(200);
    peer(h, true, 2); // coalesced into the trailing one
    h.audio.setState('permission_denied'); // normal change-driven mic.state goes out by itself
    await flush();
    vi.advanceTimersByTime(900);
    expect(mics(h).at(-1)?.payload).toMatchObject({ state: 'permission_denied' });
    const n = mics(h).length;
    expect(h.sockets.current.messages('mic.state').filter((m) => m.payload['state'] === 'permission_denied').length).toBeGreaterThanOrEqual(2);
    vi.advanceTimersByTime(5000);
    expect(mics(h)).toHaveLength(n);
  });

  it('after a quiet second the next peer.state is reported immediately again', async () => {
    const h = await readyHarness();
    peer(h, true, 1);
    const n = mics(h).length;
    vi.advanceTimersByTime(1000);
    peer(h, true, 2);
    expect(mics(h)).toHaveLength(n + 1);
  });
});

describe('DEF-004: when it must NOT send', () => {
  it('not for the phone role, and not before the person confirmed', async () => {
    const h = await readyHarness();
    const n = mics(h).length;
    peer(h, true, 1, 'phone');
    expect(mics(h)).toHaveLength(n);

    const waiting = await acceptedHarness();
    waiting.sockets.current.receive(relayMsg('peer.state', { role: 'tv', connected: true, generation: 1 }));
    expect(waiting.sockets.current.messages().map((m) => m.type)).toEqual(['join.request']);
    expect(waiting.controller.getState().tvConnected).toBeNull();
  });

  it('a pending trailing report is cancelled by an unpair, a lost link and a dispose', async () => {
    const h = await readyHarness();
    peer(h, true, 1);
    peer(h, true, 2); // trailing scheduled
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    const sent = h.sockets.current.sent.length;
    vi.advanceTimersByTime(5000);
    expect(h.sockets.current.sent.length).toBe(sent);

    const g = await readyHarness();
    peer(g, true, 1);
    peer(g, true, 2);
    const socket = g.sockets.current;
    socket.drop(1006);
    const gs = socket.sent.length;
    vi.advanceTimersByTime(400);
    expect(socket.sent.length).toBe(gs); // nothing on the dead socket; the reconnect reports on its own

    const d = await readyHarness();
    peer(d, true, 1);
    peer(d, true, 2);
    d.controller.dispose();
    const ds = d.sockets.current.sent.length;
    vi.advanceTimersByTime(5000);
    expect(d.sockets.current.sent.length).toBe(ds);
  });

  it('while the link to the relay is down nothing is sent and nothing is lost: the reconnect reports as it always did', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(authOk());
    await flush();
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['auth.resume', 'mic.state']);
    advanceLive(h, 3000, () => relayMsg('pong', { server_time: 1 }));
  });
});

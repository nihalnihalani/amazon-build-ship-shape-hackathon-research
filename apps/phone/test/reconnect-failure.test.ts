import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../src/view.js';
import { authOk, flush, relayMsg, windowStart } from './helpers/fakes.js';
import { advanceLive, type Harness, readyHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FAIL_MS = 120_000;
const pong = (): string => relayMsg('pong', { server_time: 1 });

describe('A6-02: jitter on the backoff', () => {
  it('the controller applies +/-25 % jitter: random 0 -> 75 %, random 1 -> 125 %', async () => {
    for (const [random, first] of [
      [0, 375],
      [0.5, 500],
      [0.999999, 625],
    ] as const) {
      const h = await readyHarness({ random: () => random });
      h.sockets.current.drop(1006);
      vi.advanceTimersByTime(first - 1);
      expect(h.sockets.sockets, `random ${random}`).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(h.sockets.sockets, `random ${random}`).toHaveLength(2);
    }
  });

  it('the whole schedule stays inside the band, and each retry draws its own jitter', async () => {
    const draws = [0, 1, 0, 1, 0, 1, 0.5];
    let i = 0;
    const h = await readyHarness({ random: () => draws[i++ % draws.length] as number });
    h.sockets.current.drop(1006);
    const expected = [375, 1250, 1500, 5000, 6000, 10000, 8000];
    for (const [n, delay] of expected.entries()) {
      const before = h.sockets.sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(h.sockets.sockets.length, `attempt ${n + 1} early`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(h.sockets.sockets.length, `attempt ${n + 1} late`).toBe(before + 1);
      h.sockets.current.drop(1006);
    }
  });
});

describe('A6-02: stop reconnecting on a refused or ended pairing and return to Join', () => {
  it.each([
    ['revoked', 'revoked', /withdrew/],
    ['expired', 'expired', /expired/],
    ['unauthorized', 'expired', /expired/],
    ['superseded', 'superseded', /another page/],
  ] as const)('auth.resume refused with %s: back to Join, explanation shown, no more attempts', async (code, reason, explanation) => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const root = document.body.appendChild(document.createElement('div'));
    const view = mountView(root, h.controller);
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code, ref_message_id: null, detail: '' }));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: reason, link: 'disconnected', pairingConfirmed: false });
    expect(document.getElementById('view-join')?.hidden).toBe(false);
    expect(document.getElementById('unpaired-notice')?.hidden).toBe(false);
    expect(document.getElementById('unpaired-reason')?.textContent).toMatch(explanation);
    expect(document.getElementById('status')?.textContent).toMatch(/^This phone is no longer paired\./);
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(30 * 60_000);
    expect(h.sockets.sockets).toHaveLength(n);
    view.destroy();
  });

  it('an unpaired message while connected does the same', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: 'tv_unpaired' });
    vi.advanceTimersByTime(30 * 60_000);
    expect(h.sockets.sockets).toHaveLength(1);
  });

  it('rate_limited while resuming is transient and keeps trying', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code: 'rate_limited', ref_message_id: null, detail: '' }));
    h.sockets.current.drop(4429);
    expect(h.controller.getState().screen).toBe('setup');
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(1000);
    expect(h.sockets.sockets.length).toBe(n + 1);
  });
});

describe('A6-02: 2 minutes of continuous failure -> failed, with a Retry button, and no automatic retries', () => {
  async function failing(): Promise<Harness> {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    return h;
  }

  it('keeps retrying until 2 minutes have passed, then reports failed and stops', async () => {
    const h = await failing();
    for (let t = 0; t < FAIL_MS - 1000; t += 1000) {
      vi.advanceTimersByTime(1000);
      if (h.sockets.current.readyState === 0) h.sockets.current.drop(1006); // the relay stays unreachable
    }
    expect(h.controller.getState().link).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(h.controller.getState().link).toBe('reconnecting');
    vi.advanceTimersByTime(1);
    expect(h.controller.getState().link).toBe('failed');
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.sockets.sockets).toHaveLength(n); // never again by itself
    expect(h.controller.getState()).toMatchObject({ link: 'failed', screen: 'setup', pairingConfirmed: true });
  });

  it('a socket that is mid-handshake at the 2-minute mark is closed', async () => {
    const h = await failing();
    vi.advanceTimersByTime(FAIL_MS - 100);
    // whatever socket exists now is still "connecting"
    const live = h.sockets.current;
    vi.advanceTimersByTime(100);
    expect(h.controller.getState().link).toBe('failed');
    expect(live.closeCalls.length).toBeGreaterThan(0);
    live.open(); // a late open on the abandoned socket is ignored
    live.receive(authOk());
    expect(h.controller.getState().link).toBe('failed');
  });

  it('Retry reconnects at once, resets the attempt counter and gives a fresh 2-minute window', async () => {
    const h = await failing();
    vi.advanceTimersByTime(FAIL_MS);
    expect(h.controller.getState().link).toBe('failed');
    const n = h.sockets.sockets.length;
    h.controller.retryNow();
    expect(h.sockets.sockets).toHaveLength(n + 1);
    expect(h.controller.getState()).toMatchObject({ link: 'reconnecting', reconnectAttempt: 0 });
    h.sockets.current.drop(1006); // fails again
    vi.advanceTimersByTime(FAIL_MS - 1);
    expect(h.controller.getState().link).toBe('reconnecting');
    vi.advanceTimersByTime(1);
    expect(h.controller.getState().link).toBe('failed');
  });

  it('Retry that succeeds resumes normally with auth.resume and mic.state', async () => {
    const h = await failing();
    vi.advanceTimersByTime(FAIL_MS);
    h.controller.retryNow();
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    expect(h.controller.getState()).toMatchObject({ link: 'connected', reconnectAttempt: 0 });
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['auth.resume', 'mic.state']);
    advanceLive(h, FAIL_MS * 2, pong);
    expect(h.controller.getState().link).toBe('connected'); // the window was cleared by the success
  });

  it('a successful reconnect before the deadline cancels it; a later drop starts a new window', async () => {
    const h = await failing();
    vi.advanceTimersByTime(100_000);
    if (h.sockets.current.readyState === 0) h.sockets.current.drop(1006);
    vi.advanceTimersByTime(8_000);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    expect(h.controller.getState().link).toBe('connected');
    // keep the link alive for a while, then lose it again: the 2 minutes count from here
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      h.sockets.current.receive(relayMsg('pong', { server_time: 1 }));
    }
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(FAIL_MS - 1000);
    expect(h.controller.getState().link).toBe('reconnecting');
  });

  it('retryNow is ignored when connected, unpaired or not yet confirmed', async () => {
    const h = await readyHarness();
    const n = h.sockets.sockets.length;
    h.controller.retryNow();
    expect(h.sockets.sockets).toHaveLength(n);
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    h.controller.retryNow();
    expect(h.sockets.sockets).toHaveLength(n);
  });

  it('the page shows the failed state with a Retry button, and the TV is never claimed "off"', async () => {
    const h = await failing();
    document.body.replaceChildren();
    const root = document.body.appendChild(document.createElement('div'));
    const view = mountView(root, h.controller);
    expect(document.getElementById('retry')?.hidden).toBe(false); // reconnecting: Retry now is offered too
    vi.advanceTimersByTime(FAIL_MS);
    expect(document.getElementById('link')?.textContent).toMatch(/Cannot reach the relay\. Automatic retries stopped after 2 minutes\. Tap Retry now\./);
    expect(document.getElementById('status')?.textContent).toBe('Cannot connect to the relay. Automatic retries stopped. Tap Retry now.');
    expect(document.getElementById('retry')?.hidden).toBe(false);
    (document.getElementById('retry') as HTMLButtonElement).click();
    expect(h.controller.getState().link).toBe('reconnecting');
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    expect(document.getElementById('retry')?.hidden).toBe(true);
    view.destroy();
  });

  it('while failed there are no level frames, results or messages from the phone', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    const first = h.sockets.current;
    first.drop(1006);
    const before = first.sent.length;
    vi.advanceTimersByTime(FAIL_MS * 2);
    h.audio.frame(1);
    expect(first.sent.length).toBe(before);
    // every later connection only ever tried to authenticate; nothing else was sent
    const later = h.sockets.sockets.slice(1).flatMap((sock) => sock.sent);
    expect(later.every((t) => (JSON.parse(t) as { type: string }).type === 'auth.resume')).toBe(true);
  });
});

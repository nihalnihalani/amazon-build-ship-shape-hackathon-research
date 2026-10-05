import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../src/view.js';
import { authOk, CREDENTIAL, flush, relayMsg } from './helpers/fakes.js';
import { type Harness, readyHarness } from './helpers/harness.js';

/**
 * N-01: after the phone's network dies without a TCP close, the relay still holds the old socket
 * for up to 25 s and refuses the phone's own reconnect with a generic `unauthorized`. That must not
 * be taken for "the pairing is gone": retry for 30 s first, present the same credential every time,
 * and if the refusals really continue say "Could not reconnect" (not "pairing expired").
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const refuse = (h: Harness, code = 'unauthorized'): void => {
  h.sockets.current.receive(relayMsg('error', { code, ref_message_id: null, detail: '' }));
};

/** Lets the next scheduled attempt fire, opens it and refuses it; returns the fake time of the refusal. */
function nextAttemptRefused(h: Harness, delayMs: number, code = 'unauthorized'): number {
  vi.advanceTimersByTime(delayMs);
  h.sockets.current.open();
  refuse(h, code);
  return Date.now();
}

const resumes = (h: Harness) => h.sockets.sockets.flatMap((s) => s.messages('auth.resume'));

describe('N-01: a refused auth.resume is retried for 30 s before the pairing is considered lost', () => {
  it('the first refusal keeps the pairing: still on the setup screen, reconnecting, mic untouched', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    const s = h.controller.getState();
    expect(s).toMatchObject({ screen: 'setup', pairingConfirmed: true, link: 'reconnecting', unpairedReason: null });
    expect(s.mic.state).toBe('open_idle'); // nothing was torn down
    expect(h.audio.closeCalls).toBe(0);
    expect(h.sockets.current.closeCalls.length).toBeGreaterThan(0); // the refused socket was dropped
  });

  it('every retry presents the SAME credential: a refusal does not consume it', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    for (const delay of [500, 1000, 2000, 4000]) nextAttemptRefused(h, delay);
    const creds = resumes(h).map((m) => m.payload['credential']);
    expect(creds).toHaveLength(4);
    expect(new Set(creds)).toEqual(new Set([CREDENTIAL]));
  });

  it('the half-open case: refused a few times while the relay still holds the old socket, then accepted: connected, rotated credential, nothing lost', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    nextAttemptRefused(h, 1000);
    nextAttemptRefused(h, 2000);
    vi.advanceTimersByTime(4000);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2, true, 'R'.repeat(43)));
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'setup', link: 'connected', unpairedReason: null, reconnectAttempt: 0 });
    expect(h.sockets.current.messages().map((m) => m.type)).toEqual(['auth.resume', 'mic.state']);
    expect(h.sockets.current.messages('auth.resume')[0]?.payload['credential']).toBe(CREDENTIAL); // still the original
    // the next reconnect presents the rotated credential
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    expect(h.sockets.current.messages('auth.resume')[0]?.payload['credential']).toBe('R'.repeat(43));
  });

  it('refusals that go on for 30 s end the pairing as "Could not reconnect" (and no sooner)', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    // nominal backoff 0.5, 1, 2, 4, 8, 8, 8 s: refusals at 0.5, 1.5, 3.5, 7.5, 15.5, 23.5, 31.5 s
    const firstRefusal = nextAttemptRefused(h, 500);
    const delays = [1000, 2000, 4000, 8000, 8000];
    let last = firstRefusal;
    for (const d of delays) {
      last = nextAttemptRefused(h, d);
      expect(last - firstRefusal, 'still inside 30 s').toBeLessThan(30_000);
      expect(h.controller.getState().screen).toBe('setup');
    }
    last = nextAttemptRefused(h, 8000); // 31 s after the first refusal
    expect(last - firstRefusal).toBeGreaterThanOrEqual(30_000);
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: 'resume_refused', pairingConfirmed: false, link: 'disconnected' });
    expect(h.audio.getSnapshot().state).toBe('off'); // capture shut down with the pairing
    const n = h.sockets.sockets.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.sockets.sockets).toHaveLength(n); // never again with the dead credential
  });

  it('stays within the relay\'s failed-resume limit (10 per minute): at most 8 refused attempts in the window', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    let attempts = 0;
    const schedule = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000];
    for (const d of schedule) {
      if (h.controller.getState().screen !== 'setup') break;
      nextAttemptRefused(h, d);
      attempts += 1;
    }
    expect(attempts).toBeLessThanOrEqual(8);
    expect(h.controller.getState().unpairedReason).toBe('resume_refused');
  });

  it('a success resets the refusal clock: a later round of refusals gets its own full 30 s', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    nextAttemptRefused(h, 1000);
    vi.advanceTimersByTime(2000);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(2));
    await flush();
    // a long time later the link drops again and is refused again: this is a new cycle
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      h.sockets.current.receive(relayMsg('pong', { server_time: 1 }));
    }
    h.sockets.current.drop(1006);
    const start = nextAttemptRefused(h, 500);
    nextAttemptRefused(h, 1000);
    nextAttemptRefused(h, 2000);
    expect(Date.now() - start).toBeLessThan(30_000);
    expect(h.controller.getState().screen).toBe('setup');
  });

  it.each(['unauthorized', 'not_found', 'unauthenticated'])('%s is a refusal to retry, not an instant verdict', async (code) => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500, code);
    expect(h.controller.getState()).toMatchObject({ screen: 'setup', link: 'reconnecting' });
  });

  it.each([
    ['revoked', 'revoked'],
    ['expired', 'expired'],
    ['superseded', 'superseded'],
  ] as const)('%s is definitive and still ends the pairing at once', async (code, reason) => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500, code);
    await flush();
    expect(h.controller.getState()).toMatchObject({ screen: 'join', unpairedReason: reason });
  });

  it('while retrying, the page does not claim the pairing is gone; Retry now is offered', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    nextAttemptRefused(h, 1000);
    expect(document.getElementById('view-setup')?.hidden).toBe(false);
    expect(document.getElementById('unpaired-notice')?.hidden).toBe(true);
    expect(document.getElementById('view-join')?.hidden).toBe(true);
    expect(document.getElementById('status')?.textContent).not.toMatch(/no longer paired|Could not reconnect/);
    expect(document.getElementById('status')?.textContent).toBe('Connection to the TV lost. Reconnecting.');
    expect(document.getElementById('retry')?.hidden).toBe(false);
    view.destroy();
  });

  it('the final message says "Could not reconnect", not "pairing expired", and tells the person what to do', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    for (const d of [1000, 2000, 4000, 8000, 8000, 8000]) nextAttemptRefused(h, d);
    await flush();
    expect(document.getElementById('view-join')?.hidden).toBe(false);
    expect(document.getElementById('unpaired-notice')?.hidden).toBe(false);
    expect(document.getElementById('unpaired-heading')?.textContent).toBe('Could not reconnect');
    const body = document.getElementById('unpaired-notice')?.textContent ?? '';
    expect(body).not.toMatch(/The pairing expired\./);
    expect(body).not.toMatch(/no longer paired/i);
    expect(body).toMatch(/Pair again from the TV/);
    expect(document.getElementById('status')?.textContent).toMatch(/^Could not reconnect\./);
    expect(document.activeElement?.id).toBe('unpaired-heading');
    view.destroy();
  });

  it('phrases and the credential are gone after the final refusal (nothing is kept for a pairing that no longer exists)', async () => {
    const h = await readyHarness();
    h.controller.savePhrases(['Private phrase']);
    h.sockets.current.drop(1006);
    nextAttemptRefused(h, 500);
    for (const d of [1000, 2000, 4000, 8000, 8000, 8000]) nextAttemptRefused(h, d);
    await flush();
    expect(h.controller.getState().phrases).toMatchObject({ status: 'none', saved: [] });
    expect(JSON.stringify(h.controller.getState())).not.toContain(CREDENTIAL);
  });

  it('the 2-minute failure window and the refusal window do not interfere: a clean outage still ends in failed', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(125_000);
    expect(h.controller.getState().link).toBe('failed');
    expect(h.controller.getState().unpairedReason).toBeNull();
  });
});

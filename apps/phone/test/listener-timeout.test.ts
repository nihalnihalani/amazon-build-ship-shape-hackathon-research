import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT,
  ATTEMPT2,
  attemptReveal,
  flush,
  relayMsg,
  SESSION,
  sessionEnd,
  tvMsg,
  WINDOW,
  WINDOW2,
  windowCancel,
  windowStart,
} from './helpers/fakes.js';
import { advanceLive, type Harness, readyHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const open = (h: Harness, timeoutMs = 20_000, w = WINDOW, a = ATTEMPT): void => {
  h.sockets.current.receive(tvMsg('listener.open', { timeout_ms: timeoutMs }, { s: SESSION, w, a }));
};
const pong = (): string => relayMsg('pong', { server_time: 1 });
const enabled = (h: Harness): [boolean, boolean] => [h.controller.getState().canAnswer, h.controller.getState().canCue];

describe('A4-04: listener controls lock on reveal, cancel, session end and timeout', () => {
  it('lock exactly when listener.open.timeout_ms elapses, not before', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    expect(enabled(h)).toEqual([true, true]);
    vi.advanceTimersByTime(19_999);
    expect(enabled(h)).toEqual([true, true]);
    vi.advanceTimersByTime(1);
    expect(enabled(h)).toEqual([false, false]);
    expect(h.controller.getState().listener.open).toBe(false);
    expect(h.controller.getState().listener.feedback).toMatch(/Time is up/);
  });

  it('works for the whole allowed range (5 s and 60 s)', async () => {
    for (const ms of [5_000, 60_000]) {
      const h = await readyHarness();
      open(h, ms);
      advanceLive(h, ms - 1, pong);
      expect(enabled(h)[0]).toBe(true);
      vi.advanceTimersByTime(1);
      expect(enabled(h)).toEqual([false, false]);
    }
  });

  it('after the timeout nothing is sent for Heard, Not heard or Cue', async () => {
    const h = await readyHarness();
    open(h, 5_000);
    vi.advanceTimersByTime(5_000);
    h.controller.answer('heard');
    h.controller.answer('not_heard');
    h.controller.sendCue();
    expect(h.sockets.current.messages('listener.response')).toHaveLength(0);
    expect(h.sockets.current.messages('cue')).toHaveLength(0);
  });

  it('a fresh listener.open ("Keep waiting") re-enables the controls for its attempt and restarts the clock', async () => {
    const h = await readyHarness();
    open(h, 10_000);
    vi.advanceTimersByTime(10_000);
    expect(enabled(h)).toEqual([false, false]);
    open(h, 10_000); // same attempt again
    expect(enabled(h)).toEqual([true, true]);
    expect(h.controller.getState().listener.feedback).toBeNull();
    vi.advanceTimersByTime(9_999);
    expect(enabled(h)).toEqual([true, true]);
    vi.advanceTimersByTime(1);
    expect(enabled(h)).toEqual([false, false]);
  });

  it('a re-open for the same attempt keeps an answer already given; a different attempt starts fresh', async () => {
    const h = await readyHarness();
    open(h, 10_000);
    h.controller.answer('heard');
    vi.advanceTimersByTime(10_000);
    open(h, 10_000);
    expect(h.controller.getState().listener.answered).toBe('heard');
    expect(enabled(h)).toEqual([false, true]); // already answered, cue still possible
    open(h, 10_000, WINDOW2, ATTEMPT2);
    expect(h.controller.getState().listener.answered).toBeNull();
    expect(enabled(h)).toEqual([true, true]);
    // and the answer is bound to the new attempt
    h.controller.answer('not_heard');
    expect(h.sockets.current.last('listener.response')).toMatchObject({ window_id: WINDOW2, attempt_id: ATTEMPT2 });
  });

  it('attempt.reveal locks and cancels the pending timeout (no late surprise)', async () => {
    const h = await readyHarness();
    open(h, 10_000);
    h.sockets.current.receive(attemptReveal());
    expect(enabled(h)).toEqual([false, false]);
    expect(h.controller.getState().listener.feedback).toBeNull();
    advanceLive(h, 60_000, pong);
    expect(h.controller.getState().listener.feedback).toBeNull(); // the timer did not fire
  });

  it('window.cancel for the attempt locks the controls (same attempt id, any window id)', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    h.sockets.current.receive(windowCancel(WINDOW2, ATTEMPT)); // e.g. the attempt's precheck window
    expect(enabled(h)).toEqual([false, false]);
    expect(h.sockets.current.last('ack').payload.outcome).toBeDefined();
  });

  it('window.cancel for a different attempt leaves the controls alone', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    h.sockets.current.receive(windowCancel(WINDOW2, ATTEMPT2));
    expect(enabled(h)).toEqual([true, true]);
  });

  it('session.end locks the controls and stops the timer', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    h.sockets.current.receive(sessionEnd());
    await flush();
    expect(enabled(h)).toEqual([false, false]);
    expect(h.controller.getState().listener.open).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(h.controller.getState().listener.feedback).toBeNull();
  });

  it('the next capture or precheck also closes the controls and the timer', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    h.sockets.current.receive(windowStart('phrase', WINDOW2, ATTEMPT2));
    expect(enabled(h)).toEqual([false, false]);
    vi.advanceTimersByTime(60_000);
    expect(h.controller.getState().listener.feedback).toBeNull();
  });

  it('an unpair clears the timer and locks the controls', async () => {
    const h = await readyHarness();
    open(h, 20_000);
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect(enabled(h)).toEqual([false, false]);
    expect(h.controller.getState().listener.open).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(h.controller.getState().listener.feedback).toBeNull();
  });

  it('a rejected listener.open while capture is running does not start a timer', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase'));
    open(h, 5_000);
    expect(h.sockets.current.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'capture_open' });
    vi.advanceTimersByTime(60_000);
    expect(h.controller.getState().listener.feedback).toBeNull();
  });
});

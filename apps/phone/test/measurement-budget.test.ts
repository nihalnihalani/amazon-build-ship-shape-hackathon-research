import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../src/view.js';
import { ATTEMPT, flush, relayMsg, SESSION, SESSION2, sessionBegin, tvMsg, validPrecheck, validWindow, WINDOW } from './helpers/fakes.js';
import { advanceLive, type Harness, readyHarness } from './helpers/harness.js';

/**
 * N-12: a paired TV must not be able to use the phone as an open-ended ambient-sound monitor.
 *  - at most 5 minutes of cumulative capture per session (prechecks plus windows);
 *  - at least 1 s between the end of one window and the start of the next;
 *  - the microphone turns itself off after 10 minutes without a TV command that starts a measurement.
 *
 * R26: the TV must not be able to reset either limit. Only the person's Start microphone tap starts a new
 * capture budget, and only an accepted precheck.start / window.start restarts the idle clock.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const pong = (): string => relayMsg('pong', { server_time: 1 });
let n = 0;
const ids = (): { w: string; a: string } => {
  n += 1;
  const tag = String(n).padStart(6, '0');
  return { w: `w_budget${tag}`, a: `a_budget${tag}` };
};

const vowel = (ms: number) => ({ kind: 'vowel', phrase_position: null, max_duration_ms: ms, vad_floor_dbfs: -60 });
const startWindow = (h: Harness, payload: Record<string, unknown>, id = ids(), s = SESSION): { id: { w: string; a: string }; ack: () => { outcome: string; detail: string } } => {
  const m = tvMsg('window.start', payload, { s, w: id.w, a: id.a });
  h.sockets.current.receive(m);
  const mid = JSON.parse(m).message_id as string;
  return {
    id,
    ack: () => h.sockets.current.messages('ack').find((x) => x.payload['acked_message_id'] === mid)?.payload as unknown as { outcome: string; detail: string },
  };
};
const startPrecheck = (h: Harness, purpose: 'quiet_check' | 'pre_window', id = ids(), s = SESSION) => {
  const m = tvMsg('precheck.start', { purpose, duration_ms: purpose === 'quiet_check' ? 5000 : 2000 }, { s, w: id.w, a: id.a });
  h.sockets.current.receive(m);
  const mid = JSON.parse(m).message_id as string;
  return {
    id,
    ack: () => h.sockets.current.messages('ack').find((x) => x.payload['acked_message_id'] === mid)?.payload as unknown as { outcome: string; detail: string },
  };
};

/** Runs a window of `ms` to its natural end (the port reports the full duration). */
async function runWindow(h: Harness, ms: number): Promise<void> {
  const r = startWindow(h, vowel(ms));
  expect(r.ack().outcome).toBe('applied');
  h.audio.frame(0);
  h.audio.finishWindow(validWindow('vowel', ms));
  await flush();
  vi.advanceTimersByTime(1000); // respect the cooldown
}
async function runPrecheck(h: Harness, purpose: 'quiet_check' | 'pre_window'): Promise<void> {
  const r = startPrecheck(h, purpose);
  expect(r.ack().outcome).toBe('applied');
  h.audio.startedMeasuring();
  h.audio.finishPrecheck(validPrecheck(purpose));
  await flush();
  vi.advanceTimersByTime(250); // real prechecks last 2-5 s; the phone paces what it sends (30 per second)
}

/** The person turns the microphone off and taps Start microphone again (the only way to a new budget). */
async function restartMic(h: Harness): Promise<void> {
  h.controller.stopMic();
  await flush();
  expect(h.controller.getState().canStartMic).toBe(true);
  h.controller.startMic();
  h.audio.makeOpen();
  await flush();
}

describe('N-12: at most 5 minutes of cumulative capture per session', () => {
  it('ten 30 s windows use the whole budget exactly; the eleventh command is refused with detail "budget"', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    const r = startWindow(h, vowel(1000));
    expect(r.ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    expect(h.audio.windowCalls).toHaveLength(10);
    const p = startPrecheck(h, 'pre_window');
    expect(p.ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    expect(h.audio.precheckCalls).toHaveLength(0);
  });

  it('prechecks count too: sixty 5 s quiet checks fill it, the sixty-first is refused', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 60; i++) await runPrecheck(h, 'quiet_check');
    expect(startPrecheck(h, 'quiet_check').ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('the boundary: a command that brings the total to exactly 300 s is accepted, one more millisecond is not', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 9; i++) await runWindow(h, 30_000); // 270 s
    for (let i = 0; i < 14; i++) await runPrecheck(h, 'pre_window'); // + 28 s = 298 s
    expect(startWindow(h, vowel(2000)).ack().outcome).toBe('applied'); // 300 s exactly
    h.audio.finishWindow(validWindow('vowel', 2000));
    await flush();
    vi.advanceTimersByTime(1000);
    expect(startPrecheck(h, 'pre_window').ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('a command that would overshoot is refused even though some budget is left', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 9; i++) await runWindow(h, 30_000); // 270 s
    for (let i = 0; i < 14; i++) await runPrecheck(h, 'pre_window'); // 298 s
    expect(startWindow(h, { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 }).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('a window stopped early only costs what it used: the unused time goes back to the budget', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 40; i++) {
      const r = startWindow(h, vowel(30_000));
      expect(r.ack().outcome, `window ${i}`).toBe('applied');
      h.audio.frame(0);
      h.sockets.current.receive(tvMsg('window.stop', { reason: 'early_stop' }, { s: SESSION, w: r.id.w, a: r.id.a })); // the fake reports 1500 ms
      await flush();
      vi.advanceTimersByTime(1000);
    }
    // 40 x 30 s commanded, but only 40 x 1.5 s used: still plenty of room
    expect(startWindow(h, vowel(30_000)).ack().outcome).toBe('applied');
  });

  it('a cancelled window costs only the wall-clock time it ran', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 40; i++) {
      const r = startWindow(h, vowel(30_000));
      expect(r.ack().outcome, `window ${i}`).toBe('applied');
      vi.advanceTimersByTime(2000);
      h.sockets.current.receive(tvMsg('window.cancel', { reason: 'user_cancel' }, { s: SESSION, w: r.id.w, a: r.id.a }));
      await flush();
      vi.advanceTimersByTime(1000);
    }
    expect(startWindow(h, vowel(30_000)).ack().outcome).toBe('applied');
  });

  it('an interrupted run (page hidden) is charged what it used, not its full duration', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 12; i++) {
      h.audio.makeOpen();
      const r = startWindow(h, vowel(30_000));
      expect(r.ack().outcome, `window ${i}`).toBe('applied');
      h.audio.frame(0);
      h.visibility.set('hidden'); // the interrupted result reports 1500 ms; the mic is shut down
      await flush();
      h.visibility.set('visible');
      vi.advanceTimersByTime(1000);
    }
    h.audio.makeOpen();
    expect(startWindow(h, vowel(30_000)).ack().outcome).toBe('applied'); // 12 x 30 s commanded would have been 360 s
  });

  it('a refusal marks nothing closed: the same ids work again once the person has started the microphone again', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    const refused = startWindow(h, vowel(1000), { w: WINDOW, a: ATTEMPT });
    expect(refused.ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    await restartMic(h);
    const retry = startWindow(h, vowel(1000), { w: WINDOW, a: ATTEMPT });
    expect(retry.ack().outcome).toBe('applied');
  });

  it('the person sees why, once, in plain words', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    startWindow(h, vowel(1000));
    startWindow(h, vowel(1000));
    expect(h.controller.getState().notice).toMatch(/used its 5 minutes of listening/);
    expect(document.getElementById('status')?.textContent).toMatch(/used its 5 minutes of listening/);
    view.destroy();
  });

  it('a repeated session.begin for the same session keeps the budget', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    h.sockets.current.receive(sessionBegin()); // the same session again (idempotent)
    expect(startWindow(h, vowel(1000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('R26: a new session id announced by the TV does NOT buy a new budget, however many it announces; the message stays', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    expect(startWindow(h, vowel(1000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    for (const sid of [SESSION2, 's_session0003', 's_session0004', 's_session0005']) {
      h.sockets.current.receive(sessionBegin(sid));
      expect(startWindow(h, vowel(1000), ids(), sid).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
      expect(startPrecheck(h, 'pre_window', ids(), sid).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    }
    expect(h.controller.getState().notice).toMatch(/used its 5 minutes of listening/); // still explained
  });

  it('R26: ending the session does not reset it either; the TV can end and begin sessions as it likes', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    h.sockets.current.receive(tvMsg('session.end', { reason: 'completed' }, { s: SESSION }));
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off'); // ending a session closes the microphone
    h.sockets.current.receive(sessionBegin('s_session0003'));
    h.audio.makeOpen(); // something opens the microphone without the person tapping Start
    await flush();
    expect(startWindow(h, vowel(30_000), ids(), 's_session0003').ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('only the person tapping Start microphone starts a new budget, cooldown and message: after End session on the TV and a tap, a fresh 5 minutes', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    startWindow(h, vowel(1000)); // refused; the person is told
    expect(h.controller.getState().notice).toMatch(/used its 5 minutes of listening/);
    h.sockets.current.receive(tvMsg('session.end', { reason: 'completed' }, { s: SESSION }));
    await flush();
    h.sockets.current.receive(sessionBegin('s_session0003'));
    h.controller.startMic(); // the tap
    h.audio.makeOpen();
    await flush();
    expect(h.controller.getState().notice).toBeNull();
    expect(startWindow(h, vowel(30_000), ids(), 's_session0003').ack().outcome).toBe('applied');
  });

  it('a tap also clears the cooldown: a window can start straight after a mic restart', async () => {
    const h = await readyHarness();
    const first = startWindow(h, vowel(2000));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 2000));
    await flush(); // the window ended just now; no waiting
    await restartMic(h);
    expect(startWindow(h, vowel(2000)).ack().outcome).toBe('applied');
    void first;
  });

  it('a tap that does nothing (the microphone is already open) does not reset anything', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    h.controller.startMic(); // Start is not offered while the microphone is open
    expect(startWindow(h, vowel(1000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('an unpair removes the message from the screen (the pairing is gone) and a new pairing needs the person\'s Start tap anyway', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000);
    startWindow(h, vowel(1000));
    expect(h.controller.getState().notice).toMatch(/5 minutes of listening/);
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect(h.controller.getState().notice ?? '').not.toMatch(/5 minutes of listening/);
  });
});

describe('N-12: at least 1 s between windows', () => {
  it('a window that starts less than a second after the previous one ended is refused with detail "cooldown"; at 1 s it is accepted', async () => {
    const h = await readyHarness();
    const first = startWindow(h, vowel(5000));
    expect(first.ack().outcome).toBe('applied');
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 5000));
    await flush();
    vi.advanceTimersByTime(999);
    const early = startWindow(h, vowel(5000));
    expect(early.ack()).toMatchObject({ outcome: 'rejected', detail: 'cooldown' });
    expect(h.audio.windowCalls).toHaveLength(1);
    vi.advanceTimersByTime(1); // 1000 ms after the first one ended
    const ok = startWindow(h, vowel(5000));
    expect(ok.ack().outcome).toBe('applied');
  });

  it('a refused-for-cooldown window id is not burnt: the TV can retry with the same ids', async () => {
    const h = await readyHarness();
    startWindow(h, vowel(5000));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 5000));
    await flush();
    const id = ids();
    expect(startWindow(h, vowel(5000), id).ack()).toMatchObject({ outcome: 'rejected', detail: 'cooldown' });
    vi.advanceTimersByTime(1000);
    expect(startWindow(h, vowel(5000), id).ack().outcome).toBe('applied');
  });

  it('a cancelled window starts the cooldown too (a cancel-and-restart chain cannot dodge it)', async () => {
    const h = await readyHarness();
    const a = startWindow(h, vowel(8000));
    h.audio.frame(0);
    vi.advanceTimersByTime(250);
    h.sockets.current.receive(tvMsg('window.cancel', { reason: 'user_cancel' }, { s: SESSION, w: a.id.w, a: a.id.a }));
    vi.advanceTimersByTime(250);
    expect(startWindow(h, vowel(8000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'cooldown' });
  });

  it('the cooldown runs from the END of a window, not from its start', async () => {
    const h = await readyHarness();
    startWindow(h, vowel(8000));
    h.audio.frame(0);
    vi.advanceTimersByTime(8000); // the window ran for 8 s, then ended
    h.audio.finishWindow(validWindow('vowel', 8000));
    await flush();
    expect(startWindow(h, vowel(8000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'cooldown' });
  });

  it('a precheck is never held up by the cooldown (the normal precheck-then-window sequence is unaffected)', async () => {
    const h = await readyHarness();
    startWindow(h, vowel(5000));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 5000));
    await flush();
    const pre = startPrecheck(h, 'pre_window'); // straight away
    expect(pre.ack().outcome).toBe('applied');
    h.audio.startedMeasuring();
    vi.advanceTimersByTime(2000); // a pre-window check lasts 2 s
    h.audio.finishPrecheck(validPrecheck('pre_window'));
    await flush();
    const w = startWindow(h, vowel(5000)); // the window right after its own precheck
    expect(w.ack().outcome).toBe('applied');
  });

  it('the cooldown is about windows: a window that starts under a second after the previous window ended is refused even with an instant precheck in between (a real one takes at least 2 s)', async () => {
    const h = await readyHarness();
    startWindow(h, vowel(5000));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 5000));
    await flush();
    startPrecheck(h, 'pre_window');
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(validPrecheck('pre_window')); // finishes in 0 ms
    await flush();
    expect(startWindow(h, vowel(5000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'cooldown' });
  });

  it('a window straight after a precheck is fine even when the previous window ended a moment ago', async () => {
    const h = await readyHarness();
    startWindow(h, vowel(5000));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 5000));
    await flush();
    vi.advanceTimersByTime(1000);
    startPrecheck(h, 'pre_window');
    h.audio.startedMeasuring();
    vi.advanceTimersByTime(2000);
    h.audio.finishPrecheck(validPrecheck('pre_window'));
    await flush();
    expect(startWindow(h, vowel(5000)).ack().outcome).toBe('applied');
  });

  it('when both limits apply the answer is "budget"', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 9; i++) await runWindow(h, 30_000);
    for (let i = 0; i < 15; i++) await runPrecheck(h, 'pre_window'); // 270 + 30 = 300 s
    startWindow(h, vowel(1000)); // refused (budget)
    expect(startWindow(h, vowel(1000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
  });

  it('a duplicate of the running window is still answered applied/duplicate, and a different window while busy is still "busy"', async () => {
    const h = await readyHarness();
    const a = startWindow(h, vowel(5000));
    expect(startWindow(h, vowel(5000), a.id).ack()).toMatchObject({ outcome: 'applied', detail: 'duplicate' });
    expect(startWindow(h, vowel(5000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'busy' });
  });
});

describe('N-12: the microphone turns itself off after 10 minutes without a measurement being started', () => {
  const TEN_MIN = 10 * 60_000;

  it('exactly at 10 minutes, with a visible message, a "Mic off" report and everything released', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    advanceLive(h, TEN_MIN - 1, pong);
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    advanceLive(h, 1, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.audio.closeCalls).toBeGreaterThan(0);
    expect(h.controller.getState().micNotice).toBe('idle_off');
    const notice = document.getElementById('mic-notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe('The microphone was turned off after 10 minutes without a request from the TV. Tap Start microphone to use it again.');
    expect(document.getElementById('status')?.textContent).toBe(notice.textContent);
    expect(document.getElementById('mic-badge')?.textContent).toBe('Mic off');
    expect(h.sockets.current.last('mic.state').payload).toMatchObject({ state: 'off' });
    view.destroy();
  });

  it('R26: session.state and stale commands do not restart it: the microphone still goes off 10 minutes after it opened', async () => {
    const h = await readyHarness();
    advanceLive(h, TEN_MIN - 1000, pong);
    h.sockets.current.receive(tvMsg('session.state', { stage: 'quiet_check', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { s: SESSION }));
    h.sockets.current.receive(tvMsg('window.cancel', { reason: 'user_cancel' }, { s: SESSION2, w: WINDOW, a: ATTEMPT })); // stale
    h.sockets.current.receive(tvMsg('session.state', { stage: 'quiet_check', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { s: SESSION2 })); // stale
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    advanceLive(h, 1000, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.controller.getState().micNotice).toBe('idle_off');
  });

  it('R26: one harmless command every 9 minutes cannot keep the microphone open', async () => {
    const h = await readyHarness();
    advanceLive(h, 9 * 60_000, pong);
    h.sockets.current.receive(tvMsg('session.state', { stage: 'quiet_check', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { s: SESSION }));
    advanceLive(h, 60_000, pong); // minute 10 since the microphone opened
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('R26: a refused measurement command (budget, cooldown, busy, stale) does not restart it either', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 10; i++) await runWindow(h, 30_000); // budget used up; the last window started 1 s + a moment ago
    advanceLive(h, TEN_MIN - 2000, pong); // 2 s short of 10 minutes since that last window started
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    expect(startWindow(h, vowel(1000)).ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    expect(startPrecheck(h, 'pre_window').ack()).toMatchObject({ outcome: 'rejected', detail: 'budget' });
    expect(startWindow(h, vowel(1000), ids(), SESSION2).ack()).toMatchObject({ outcome: 'ignored_stale' });
    advanceLive(h, 2000, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('a window.start the phone accepts restarts it (the measurement is real use of the microphone)', async () => {
    const h = await readyHarness();
    advanceLive(h, TEN_MIN - 1000, pong);
    expect(startWindow(h, vowel(2000)).ack().outcome).toBe('applied');
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('vowel', 2000));
    await flush();
    advanceLive(h, TEN_MIN - 1000, pong);
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    advanceLive(h, 1000, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('a precheck.start the phone accepts restarts it too', async () => {
    const h = await readyHarness();
    advanceLive(h, TEN_MIN - 1000, pong);
    expect(startPrecheck(h, 'quiet_check').ack().outcome).toBe('applied');
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(validPrecheck('quiet_check'));
    await flush();
    advanceLive(h, TEN_MIN - 1000, pong);
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    advanceLive(h, 1000, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('pings, pongs and peer notices are not TV commands and do not keep it alive', async () => {
    const h = await readyHarness();
    for (let i = 0; i < 59; i++) {
      advanceLive(h, 10_000, pong);
      h.sockets.current.receive(relayMsg('peer.state', { role: 'tv', connected: true, generation: 1 + i }));
    }
    advanceLive(h, 10_000, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('closing the microphone by hand cancels the timer: nothing fires later, no message', async () => {
    const h = await readyHarness();
    h.controller.stopMic();
    await flush();
    advanceLive(h, TEN_MIN * 2, pong);
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('starting the microphone again clears the message and starts a fresh 10 minutes', async () => {
    const h = await readyHarness();
    advanceLive(h, TEN_MIN, pong);
    await flush();
    expect(h.controller.getState().micNotice).toBe('idle_off');
    h.controller.startMic();
    h.audio.setState('permission_pending');
    expect(h.controller.getState().micNotice).toBeNull();
    h.audio.makeOpen();
    advanceLive(h, TEN_MIN - 1, pong);
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    advanceLive(h, 1, pong);
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
  });

  it('the clock only runs while the microphone is open: a closed microphone is not "idled off" and no notice appears', async () => {
    const h = await readyHarness();
    h.audio.setState('off');
    await flush();
    advanceLive(h, TEN_MIN * 3, pong);
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('an unpair clears the timer', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    vi.advanceTimersByTime(TEN_MIN * 2);
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('the wake lock is released with the microphone, and Start is offered again', async () => {
    const h = await readyHarness();
    advanceLive(h, TEN_MIN, pong);
    await flush();
    expect(h.wakeApi.active.length).toBeLessThanOrEqual(1); // held only because a session is still active
    expect(h.controller.getState().canStartMic).toBe(true);
  });
});

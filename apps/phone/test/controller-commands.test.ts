import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT,
  ATTEMPT2,
  authOk,
  attemptReveal,
  flush,
  lastMessageId,
  listenerOpen,
  precheckStart,
  relayMsg,
  SESSION,
  SESSION2,
  sessionBegin,
  sessionEnd,
  sessionState,
  tvMsg,
  validPrecheck,
  validWindow,
  WINDOW,
  WINDOW2,
  windowCancel,
  windowStart,
  windowStop,
} from './helpers/fakes.js';
import { type Harness, pairedHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Paired, session begun, microphone open (observed). */
async function ready(): Promise<Harness> {
  const h = await pairedHarness();
  h.sockets.current.receive(sessionBegin());
  h.audio.makeOpen();
  await flush();
  return h;
}

const ackOf = (h: Harness, commandText: string) => {
  const id = lastMessageId(commandText);
  const found = h.sockets.current.messages('ack').find((m) => m.payload['acked_message_id'] === id);
  if (!found) throw new Error('no ack for command');
  return found;
};

const send = (h: Harness, text: string) => {
  h.sockets.current.receive(text);
  return ackOf(h, text);
};

describe('session.begin / session.state', () => {
  it('begin is acknowledged with the session id and recorded', async () => {
    const h = await pairedHarness();
    const text = sessionBegin();
    h.sockets.current.receive(text);
    const ack = ackOf(h, text);
    expect(ack).toMatchObject({ session_id: SESSION, window_id: null, attempt_id: null, payload: { outcome: 'applied' } });
    expect(h.controller.getState().session).toMatchObject({ sessionId: SESSION, familyMode: true, phraseCount: 4 });
  });

  it('state updates stage and cue count; unknown session is ignored_stale', async () => {
    const h = await ready();
    const ok = send(h, sessionState('calibration', 2));
    expect(ok.payload['outcome']).toBe('applied');
    expect(h.controller.getState().session?.stage).toBe('calibration');
    expect(h.controller.getState().cue.used).toBe(2);
    const stale = send(h, sessionState('summary', 0, null, SESSION2));
    expect(stale.payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.controller.getState().session?.stage).toBe('calibration');
  });
});

describe('precheck.start', () => {
  it('quiet check: runs locally for 5000 ms, acks applied, then sends exactly one precheck.result with the command ids and NO level frames', async () => {
    const h = await ready();
    const ack = send(h, precheckStart('quiet_check'));
    expect(ack).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT, payload: { outcome: 'applied' } });
    expect(h.audio.precheckCalls).toEqual([{ purpose: 'quiet_check', durationMs: 5000 }]);
    expect(h.controller.getState().run).toEqual({ kind: 'precheck', windowId: WINDOW });
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(validPrecheck('quiet_check'));
    await flush();
    const results = h.sockets.current.messages('precheck.result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT, payload: { purpose: 'quiet_check', valid: true } });
    expect(h.sockets.current.messages('level')).toHaveLength(0);
    expect(h.controller.getState().run).toBeNull();
  });

  it('pre-window check is 2000 ms', async () => {
    const h = await ready();
    send(h, precheckStart('pre_window'));
    expect(h.audio.precheckCalls[0]).toEqual({ purpose: 'pre_window', durationMs: 2000 });
  });

  it('is rejected when the microphone is not open, and nothing starts', async () => {
    const h = await pairedHarness();
    h.sockets.current.receive(sessionBegin());
    const ack = send(h, precheckStart());
    expect(ack.payload).toMatchObject({ outcome: 'rejected', detail: 'mic_not_open' });
    expect(h.audio.precheckCalls).toHaveLength(0);
    expect(h.controller.getState().run).toBeNull();
  });

  it('is rejected while permission is still pending (never starts on an unobserved mic)', async () => {
    const h = await ready();
    h.audio.setState('permission_pending');
    expect(send(h, precheckStart()).payload).toMatchObject({ outcome: 'rejected', detail: 'mic_not_open' });
  });

  it('unknown session is ignored_stale and starts nothing', async () => {
    const h = await ready();
    const ack = send(h, precheckStart('quiet_check', WINDOW, ATTEMPT, SESSION2));
    expect(ack.payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.audio.precheckCalls).toHaveLength(0);
  });

  it('a precheck that is interrupted by the device reports valid:false interrupted', async () => {
    const h = await ready();
    send(h, precheckStart());
    h.audio.finishPrecheck({ ...validPrecheck(), valid: false, invalid_reason: 'interrupted' });
    await flush();
    expect(h.sockets.current.last('precheck.result').payload).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
  });
});

describe('window.start / level frames / window.result', () => {
  it('starts with the commanded kind, max duration and floor; streams level frames bound to S/W/A with increasing frame_index', async () => {
    const h = await ready();
    const ack = send(h, windowStart('phrase'));
    expect(ack.payload).toMatchObject({ outcome: 'applied' });
    expect(h.audio.windowCalls).toEqual([{ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -55 }]);
    for (let i = 0; i < 5; i++) h.audio.frame(i, -40 + i);
    const levels = h.sockets.current.messages('level');
    expect(levels).toHaveLength(5);
    levels.forEach((m, i) => {
      expect(m).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT });
      expect(m.payload).toMatchObject({ frame_index: i, t_audio_ms: i * 50, dbfs: -40 + i });
    });
    const seqs = levels.map((m) => m.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('level frames exist ONLY while the window is open: none before start, none after the result, none after cancel', async () => {
    const h = await ready();
    h.audio.frame(0, -40); // no window yet: nothing to send
    expect(h.sockets.current.messages('level')).toHaveLength(0);
    send(h, windowStart('phrase'));
    h.audio.frame(0);
    const emit = h.audio.lastOnFrame;
    expect(h.sockets.current.messages('level')).toHaveLength(1);
    h.audio.finishWindow(validWindow());
    await flush();
    emit?.({ frameIndex: 1, tAudioMs: 50, dbfs: -30, active: true, clipped: false }); // a straggler after close
    expect(h.sockets.current.messages('level')).toHaveLength(1);
    // cancelled window (a second later: the phone enforces a 1 s cooldown between windows, N-12)
    vi.advanceTimersByTime(1000);
    send(h, windowStart('phrase', WINDOW2, ATTEMPT2));
    h.audio.frame(0);
    const emit2 = h.audio.lastOnFrame;
    send(h, windowCancel(WINDOW2, ATTEMPT2));
    emit2?.({ frameIndex: 1, tAudioMs: 50, dbfs: -30, active: true, clipped: false });
    expect(h.sockets.current.messages('level')).toHaveLength(2);
  });

  it('never sends more than 700 level frames for one window', async () => {
    const h = await ready();
    send(h, windowStart('vowel'));
    for (let i = 0; i < 710; i++) h.audio.frame(i);
    expect(h.sockets.current.messages('level')).toHaveLength(700);
  });

  it('window.stop: ack first, then window.result with the command ids', async () => {
    const h = await ready();
    send(h, windowStart('vowel'));
    h.audio.frame(0);
    const stopText = windowStop();
    h.sockets.current.receive(stopText);
    await flush();
    const types = h.sockets.current.messages().map((m) => m.type);
    const ackIdx = types.lastIndexOf('ack');
    const resIdx = types.indexOf('window.result');
    expect(ackIdx).toBeGreaterThan(-1);
    expect(resIdx).toBeGreaterThan(ackIdx);
    expect(ackOf(h, stopText).payload).toMatchObject({ outcome: 'applied' });
    const res = h.sockets.current.last('window.result');
    expect(res).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT, payload: { kind: 'vowel' } });
    expect(h.controller.getState().run).toBeNull();
  });

  it('the window closing by itself at max duration sends exactly one result, and a late window.stop is an idempotent applied', async () => {
    const h = await ready();
    send(h, windowStart('calibration'));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('calibration'));
    await flush();
    expect(h.sockets.current.messages('window.result')).toHaveLength(1);
    const late = send(h, windowStop());
    expect(late.payload).toMatchObject({ outcome: 'applied', detail: 'already_closed' });
    await flush();
    expect(h.sockets.current.messages('window.result')).toHaveLength(1);
  });

  it('window.cancel discards: no result is sent, the ack is applied and the mic returns to idle', async () => {
    const h = await ready();
    send(h, windowStart('phrase'));
    h.audio.frame(0);
    expect(h.audio.getSnapshot().state).toBe('measuring');
    const ack = send(h, windowCancel());
    expect(ack.payload).toMatchObject({ outcome: 'applied' });
    await flush();
    expect(h.sockets.current.messages('window.result')).toHaveLength(0);
    expect(h.audio.getSnapshot().state).toBe('open_idle');
    expect(h.controller.getState().run).toBeNull();
  });

  it('cancelling a precheck also discards it', async () => {
    const h = await ready();
    send(h, precheckStart());
    expect(send(h, windowCancel()).payload).toMatchObject({ outcome: 'applied' });
    await flush();
    expect(h.sockets.current.messages('precheck.result')).toHaveLength(0);
  });

  it('stale commands: unknown window/attempt/session get ignored_stale and do not disturb the open window', async () => {
    const h = await ready();
    send(h, windowStart('phrase'));
    h.audio.frame(0);
    expect(send(h, windowStop(WINDOW2, ATTEMPT2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(send(h, windowCancel(WINDOW2, ATTEMPT2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(send(h, windowStop(WINDOW, ATTEMPT2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(send(h, windowStop(WINDOW, ATTEMPT, SESSION2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.controller.getState().run).toEqual({ kind: 'window', windowId: WINDOW });
    expect(h.audio.hasOpenRun).toBe(true);
    expect(h.sockets.current.messages('window.result')).toHaveLength(0);
  });

  it('duplicate start for the same window is applied/duplicate; a different window while busy is rejected; a closed window id is stale', async () => {
    const h = await ready();
    send(h, windowStart('phrase'));
    expect(send(h, windowStart('phrase')).payload).toMatchObject({ outcome: 'applied', detail: 'duplicate' });
    expect(h.audio.windowCalls).toHaveLength(1);
    expect(send(h, windowStart('phrase', WINDOW2, ATTEMPT2)).payload).toMatchObject({ outcome: 'rejected', detail: 'busy' });
    send(h, windowCancel());
    expect(send(h, windowStart('phrase')).payload).toMatchObject({ outcome: 'ignored_stale', detail: 'window_closed' });
    expect(h.audio.windowCalls).toHaveLength(1);
  });

  it('window.stop addressed to a precheck is rejected rather than ending it', async () => {
    const h = await ready();
    send(h, precheckStart());
    expect(send(h, windowStop()).payload).toMatchObject({ outcome: 'rejected', detail: 'precheck_not_stoppable' });
    expect(h.audio.hasOpenRun).toBe(true);
  });

  it('window.start without an open mic or with an unknown session starts nothing', async () => {
    const h = await pairedHarness();
    h.sockets.current.receive(sessionBegin());
    expect(send(h, windowStart()).payload).toMatchObject({ outcome: 'rejected', detail: 'mic_not_open' });
    h.audio.makeOpen();
    expect(send(h, windowStart('phrase', WINDOW, ATTEMPT, SESSION2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.audio.windowCalls).toHaveLength(0);
  });

  it('commands before any session.begin are stale', async () => {
    const h = await pairedHarness();
    h.audio.makeOpen();
    expect(send(h, precheckStart()).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(send(h, listenerOpen()).payload).toMatchObject({ outcome: 'ignored_stale' });
  });
});

describe('listener controls', () => {
  async function afterWindow(): Promise<Harness> {
    const h = await ready();
    send(h, windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow());
    await flush();
    return h;
  }

  it('are off until listener.open; open enables Heard / Not heard / Cue bound to that window and attempt', async () => {
    const h = await afterWindow();
    expect(h.controller.getState()).toMatchObject({ canAnswer: false, canCue: false });
    expect(send(h, listenerOpen()).payload).toMatchObject({ outcome: 'applied' });
    expect(h.controller.getState()).toMatchObject({ canAnswer: true, canCue: true });
    h.controller.answer('heard');
    const m = h.sockets.current.last('listener.response');
    expect(m).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT, payload: { response: 'heard' } });
    expect(h.controller.getState().canAnswer).toBe(false); // one response per attempt
    expect(h.controller.getState().canCue).toBe(true);
    h.controller.answer('not_heard');
    expect(h.sockets.current.messages('listener.response')).toHaveLength(1);
  });

  it('attempt.reveal locks everything; taps after reveal are not sent', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    const ack = send(h, attemptReveal());
    expect(ack.payload).toMatchObject({ outcome: 'applied' });
    expect(h.controller.getState()).toMatchObject({ canAnswer: false, canCue: false });
    h.controller.answer('heard');
    h.controller.answer('not_heard');
    h.controller.sendCue();
    expect(h.sockets.current.messages('listener.response')).toHaveLength(0);
    expect(h.sockets.current.messages('cue')).toHaveLength(0);
  });

  it('a reveal for a different attempt does not lock the open one', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    expect(send(h, attemptReveal(WINDOW2, ATTEMPT2)).payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.controller.getState().canAnswer).toBe(true);
  });

  it('reveal with nothing open is acknowledged and harmless', async () => {
    const h = await afterWindow();
    expect(send(h, attemptReveal()).payload).toMatchObject({ outcome: 'applied', detail: 'nothing_open' });
  });

  it('listener.open while capture is running is rejected', async () => {
    const h = await ready();
    send(h, windowStart('phrase'));
    expect(send(h, listenerOpen()).payload).toMatchObject({ outcome: 'rejected', detail: 'capture_open' });
    expect(h.controller.getState().canAnswer).toBe(false);
  });

  it('starting the next precheck or window locks leftover listener controls', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    send(h, precheckStart('pre_window', WINDOW2, ATTEMPT2));
    expect(h.controller.getState().canAnswer).toBe(false);
  });

  it('listener.open is idempotent and keeps an answer already given for the same attempt', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    h.controller.answer('not_heard');
    send(h, listenerOpen());
    expect(h.controller.getState().listener.answered).toBe('not_heard');
    expect(h.controller.getState().canAnswer).toBe(false);
    send(h, listenerOpen(WINDOW2, ATTEMPT2));
    expect(h.controller.getState().listener.answered).toBeNull();
  });

  it('session.state defence in depth: the TV saying no attempt is open (outside response_pending) locks the controls', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    send(h, sessionState('response_pending', 0, ATTEMPT));
    expect(h.controller.getState().canAnswer).toBe(true);
    send(h, sessionState('response_pending', 0, null));
    expect(h.controller.getState().canAnswer).toBe(true); // state may lag listener.open; reveal is the lock
    send(h, sessionState('reveal', 0, null));
    expect(h.controller.getState().canAnswer).toBe(false);
  });

  it('session.state naming a different open attempt locks the controls', async () => {
    const h = await afterWindow();
    send(h, listenerOpen());
    send(h, sessionState('response_pending', 0, ATTEMPT2));
    expect(h.controller.getState().canAnswer).toBe(false);
  });
});

describe('cue (at most three per session)', () => {
  async function listening(): Promise<Harness> {
    const h = await ready();
    send(h, listenerOpen());
    return h;
  }

  it('sends the default cue word bound to the session only', async () => {
    const h = await listening();
    expect(h.controller.getState().cue).toMatchObject({ word: 'Volume', used: 0, max: 3 });
    h.controller.sendCue();
    expect(h.sockets.current.last('cue')).toMatchObject({ session_id: SESSION, window_id: null, attempt_id: null, payload: { text: 'Volume' } });
    expect(h.controller.getState().cue.used).toBe(1);
  });

  it('disables at 3 and refuses a 4th', async () => {
    const h = await listening();
    h.controller.sendCue();
    h.controller.sendCue();
    expect(h.controller.getState().canCue).toBe(true);
    h.controller.sendCue();
    expect(h.controller.getState()).toMatchObject({ canCue: false });
    expect(h.controller.getState().cue.used).toBe(3);
    h.controller.sendCue();
    expect(h.sockets.current.messages('cue')).toHaveLength(3);
  });

  it('starts from the TV count: cues_used 2 leaves exactly one more', async () => {
    const h = await listening();
    send(h, sessionState('response_pending', 2, ATTEMPT));
    expect(h.controller.getState().cue.used).toBe(2);
    h.controller.sendCue();
    expect(h.controller.getState().canCue).toBe(false);
    h.controller.sendCue();
    expect(h.sockets.current.messages('cue')).toHaveLength(1);
  });

  it('the count never goes backwards when the TV state lags behind a cue we just sent', async () => {
    const h = await listening();
    h.controller.sendCue();
    send(h, sessionState('response_pending', 0, ATTEMPT)); // older state arrives late
    expect(h.controller.getState().cue.used).toBe(1);
  });

  it('a rejected cue (TV ack) gives the cue back, or marks the limit reached', async () => {
    const h = await listening();
    h.controller.sendCue();
    const sentId = h.sockets.current.last('cue').message_id;
    h.sockets.current.receive(tvMsg('ack', { acked_message_id: sentId, outcome: 'rejected', detail: 'busy' }, { s: SESSION }));
    expect(h.controller.getState().cue.used).toBe(0);
    h.controller.sendCue();
    const id2 = h.sockets.current.last('cue').message_id;
    h.sockets.current.receive(tvMsg('ack', { acked_message_id: id2, outcome: 'rejected', detail: 'cue_limit' }, { s: SESSION }));
    expect(h.controller.getState().cue.used).toBe(3);
    expect(h.controller.getState().canCue).toBe(false);
  });

  it('relay error cue_limit marks the limit reached', async () => {
    const h = await listening();
    h.controller.sendCue();
    const id = h.sockets.current.last('cue').message_id;
    h.sockets.current.receive(relayMsg('error', { code: 'cue_limit', ref_message_id: id, detail: '' }));
    expect(h.controller.getState().cue.used).toBe(3);
  });

  it('the cue word is editable (1-12 code points, NFC + trim, literal) and memory only', async () => {
    const h = await listening();
    h.controller.setCueWord('  Hush ');
    expect(h.controller.getState().cue.word).toBe('Hush');
    h.controller.sendCue();
    expect(h.sockets.current.last('cue').payload['text']).toBe('Hush');
    h.controller.setCueWord('a'.repeat(13));
    expect(h.controller.getState().cue.word).toBe('Hush');
    expect(h.controller.getState().cue.message).toMatch(/limit is 12/);
    h.controller.setCueWord('<b>x</b>');
    h.controller.sendCue();
    expect(h.sockets.current.last('cue').payload['text']).toBe('<b>x</b>');
  });

  it('a new session resets the count', async () => {
    const h = await listening();
    h.controller.sendCue();
    h.sockets.current.receive(sessionBegin(SESSION2));
    expect(h.controller.getState().cue.used).toBe(0);
  });
});

describe('session.end', () => {
  it('stops capture completely, releases the screen, reports Mic off and acks; other sessions are stale', async () => {
    const h = await ready();
    await flush();
    expect(h.wakeApi.active).toHaveLength(1);
    send(h, windowStart('phrase'));
    h.audio.frame(0);
    h.sockets.current.sent.length = 0;
    const stale = send(h, sessionEnd(SESSION2));
    expect(stale.payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.audio.closeCalls).toBe(0);

    const text = sessionEnd();
    h.sockets.current.receive(text);
    await flush();
    expect(h.audio.closeCalls).toBeGreaterThan(0);
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(h.audio.hasOpenRun).toBe(false);
    expect(h.wakeApi.active).toHaveLength(0);
    expect(h.controller.getState()).toMatchObject({ session: null, run: null, canAnswer: false, canCue: false });
    const types = h.sockets.current.messages().map((m) => m.type);
    expect(types).toEqual(expect.arrayContaining(['mic.state', 'ack']));
    expect(h.sockets.current.messages('window.result')).toHaveLength(0); // discarded, not reported
    const mic = h.sockets.current.last('mic.state');
    expect(mic.payload).toMatchObject({ state: 'off' });
    expect(ackOf(h, text).payload).toMatchObject({ outcome: 'applied' });
  });

  it('still confirms Mic off when the port was already off', async () => {
    const h = await pairedHarness();
    h.sockets.current.receive(sessionBegin());
    await flush();
    h.sockets.current.sent.length = 0;
    h.sockets.current.receive(sessionEnd());
    await flush();
    const mic = h.sockets.current.messages('mic.state');
    expect(mic.length).toBeGreaterThanOrEqual(1);
    for (const m of mic) expect(m).toMatchObject({ session_id: null, payload: { state: 'off' } });
    // releasing the screen lock is asynchronous: the final report carries its outcome
    expect(mic[mic.length - 1]?.payload).toMatchObject({ wake_lock: 'released' });
  });
});

describe('getUserMedia is only reachable from startMic()', () => {
  it('no TV command, join step or state change ever opens the microphone', async () => {
    const h = await ready();
    send(h, precheckStart());
    send(h, windowStart('phrase', WINDOW2, ATTEMPT2));
    send(h, listenerOpen());
    send(h, sessionState('quiet_check'));
    h.sockets.current.receive(sessionEnd());
    await flush();
    h.visibility.set('hidden');
    h.visibility.set('visible');
    expect(h.audio.openCalls).toHaveLength(0);
    h.controller.startMic();
    expect(h.audio.openCalls).toEqual([{}]);
  });

  it('startMic is ignored while a prompt is pending or the mic is already open', async () => {
    const h = await pairedHarness();
    h.audio.setState('permission_pending');
    h.controller.startMic();
    h.audio.makeOpen();
    h.controller.startMic();
    expect(h.audio.openCalls).toHaveLength(0);
  });
});

describe('acknowledgements of phone messages (TV rejects while a phrase window is open)', () => {
  const ackMsg = (id: string, outcome: 'applied' | 'rejected' | 'ignored_stale', detail = '', ids: { s?: string; w?: string; a?: string } = {}) =>
    tvMsg('ack', { acked_message_id: id, outcome, detail }, ids);

  it('phrases.update: sending until the ack; applied = saved; rejected = shown, retry is manual', async () => {
    const h = await ready();
    h.controller.savePhrases(['One', 'Two']);
    expect(h.controller.getState().phrases).toMatchObject({ status: 'sending', count: 2, saved: ['One', 'Two'] });
    const first = h.sockets.current.last('phrases.update');
    h.sockets.current.receive(ackMsg(first.message_id, 'rejected', 'window_open'));
    expect(h.controller.getState().phrases).toMatchObject({ status: 'rejected', saved: [] });
    expect(h.controller.getState().notice).toMatch(/Press Save again after the current phrase window/);
    await flush();
    expect(h.sockets.current.messages('phrases.update')).toHaveLength(1);
    h.controller.savePhrases(['One', 'Two']);
    const second = h.sockets.current.last('phrases.update');
    h.sockets.current.receive(ackMsg(second.message_id, 'applied'));
    expect(h.controller.getState().phrases).toMatchObject({ status: 'saved', saved: ['One', 'Two'] });
    // a later refusal keeps showing the last list the TV confirmed
    h.controller.savePhrases(['Three']);
    h.sockets.current.receive(ackMsg(h.sockets.current.last('phrases.update').message_id, 'rejected'));
    expect(h.controller.getState().phrases).toMatchObject({ status: 'rejected', saved: ['One', 'Two'] });
  });

  it('an ack for an older save is ignored once a newer one is pending', async () => {
    const h = await ready();
    h.controller.savePhrases(['A']);
    const a = h.sockets.current.last('phrases.update');
    h.controller.savePhrases(['B']);
    h.sockets.current.receive(ackMsg(a.message_id, 'applied'));
    expect(h.controller.getState().phrases.status).toBe('sending');
  });

  it('a save whose connection drops is reported as not sent instead of "sending" forever', async () => {
    const h = await ready();
    h.controller.savePhrases(['A']);
    h.sockets.current.drop(1006);
    expect(h.controller.getState().phrases.status).toBe('not_sent');
  });

  it('phrases are validated with the package rules before anything is sent', async () => {
    const h = await ready();
    const before = h.sockets.current.sent.length;
    expect(h.controller.savePhrases(['a'.repeat(61)]).sent).toBe(false);
    expect(h.controller.savePhrases(['ok', 'bad\tone']).sent).toBe(false);
    expect(h.controller.savePhrases([]).sent).toBe(false);
    expect(h.controller.savePhrases(Array.from({ length: 11 }, (_, i) => `p${i}`)).sent).toBe(false);
    expect(h.sockets.current.sent.length).toBe(before);
  });

  it('cue refused while a window is open: the cue is given back with an explanation and is not resent', async () => {
    const h = await ready();
    h.sockets.current.receive(listenerOpen());
    h.controller.sendCue();
    const cue = h.sockets.current.last('cue');
    h.sockets.current.receive(ackMsg(cue.message_id, 'rejected', 'window_open', { s: SESSION }));
    expect(h.controller.getState().cue).toMatchObject({ used: 0, feedback: expect.stringMatching(/could not take the cue right now/) });
    await flush();
    expect(h.sockets.current.messages('cue')).toHaveLength(1);
    h.controller.sendCue();
    expect(h.sockets.current.messages('cue')).toHaveLength(2);
  });

  it('listener.response: rejected re-opens one tap, ignored_stale does not', async () => {
    const h = await ready();
    h.sockets.current.receive(listenerOpen());
    h.controller.answer('heard');
    const r1 = h.sockets.current.last('listener.response');
    h.sockets.current.receive(ackMsg(r1.message_id, 'rejected', '', { s: SESSION, w: WINDOW, a: ATTEMPT }));
    expect(h.controller.getState()).toMatchObject({ canAnswer: true });
    h.controller.answer('not_heard');
    const r2 = h.sockets.current.last('listener.response');
    h.sockets.current.receive(ackMsg(r2.message_id, 'ignored_stale', '', { s: SESSION, w: WINDOW, a: ATTEMPT }));
    expect(h.controller.getState().canAnswer).toBe(false);
    expect(h.controller.getState().listener.feedback).toMatch(/Too late/);
    expect(h.sockets.current.messages('listener.response')).toHaveLength(2);
  });

  it('a mic.state is sent right after join.accepted and right after auth.ok (the TV shows "Phone state unknown" until then)', async () => {
    const h = await pairedHarness();
    const afterJoin = h.sockets.current.messages().map((m) => m.type);
    expect(afterJoin.slice(0, 2)).toEqual(['join.request', 'mic.state']);
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(authOk());
    const afterResume = h.sockets.current.messages().map((m) => m.type);
    expect(afterResume).toEqual(['auth.resume', 'mic.state']);
  });
});

/**
 * DEF-007: under latency the phone starts measuring after the TV sent window.start. The speaker's prompt, the timer,
 * stop_early and the window maximum begin when the TV receives the FIRST level frame of that window, not when the TV
 * sends window.start. Until then the TV says it is starting the phone's measurement; a missing first frame is a timeout.
 */

import { describe, expect, it } from 'vitest';
import { RESULT_GRACE_MS } from '../src/index.js';
import { FLOOR, allStrings, boot } from './helpers.js';
import type { Harness } from './helpers.js';

const STARTING = "Starting the phone's measurement…";
const SPEAK = /Say the phrase now|Say the sentence now|Say ahh/;

type Kind = 'calibration' | 'vowel' | 'phrase';

/** Get a window to the moment right after the TV sent window.start. */
async function startedWindow(kind: Kind, opts: { hiddenPhrase?: boolean } = {}): Promise<Harness> {
  const h = await boot();
  if (kind === 'calibration') {
    h.startAndPair();
    h.runQuiet();
    h.beginAndLead('begin_calibration');
    expect(h.last('window.start').payload.kind).toBe('calibration');
    return h;
  }
  if (kind === 'vowel') {
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    expect(h.last('window.start').payload.kind).toBe('vowel');
    return h;
  }
  h.setupToPhrases();
  if (opts.hiddenPhrase === true) {
    for (let p = 1; p < 3; p += 1) {
      h.runPhrase({});
      h.ui('next_phrase');
    }
  }
  h.beginAndLead('begin_phrase');
  h.answerPrecheck();
  expect(h.last('window.start').payload.kind).toBe('phrase');
  return h;
}

describe('no prompt, no timer and no stop until the first level frame arrives', () => {
  for (const kind of ['calibration', 'vowel', 'phrase'] as Kind[]) {
    it(`${kind}: after window.start the TV waits, says so, and prompts only when the first frame arrives`, async () => {
      const h = await startedWindow(kind);
      const stage = h.view.stage;
      // window.start sent: waiting
      for (const wait of [0, 100, 300, 600, 1500, 2999]) {
        if (wait > 0) h.advance(wait === 100 ? 100 : wait - [0, 100, 300, 600, 1500][[100, 300, 600, 1500, 2999].indexOf(wait)]!);
        expect(h.view.body, `${kind} +${wait}`).toContain(STARTING);
        expect(h.view.timer, `${kind} +${wait}`).toBeNull();
        expect(h.view.actions, `${kind} +${wait}`).toEqual([]);
        expect(h.view.preferredAction).toBeNull();
        expect(h.view.meter).toBeNull();
        expect(h.view.capturing).toBe(true);
        expect(h.view.announcement).toBeNull();
        expect(allStrings(h.view).join(' | '), `${kind} +${wait}`).not.toMatch(SPEAK);
      }
      expect(h.view.stage).toBe(stage);
      // OK and stop_early do nothing yet
      h.ok();
      h.ui('stop_early');
      expect(h.of('window.stop')).toHaveLength(0);
      // the phone's first frame, 600 ms (here: 2999 ms) late: now the prompt, the timer and stop appear
      h.level(0, FLOOR + 6, true);
      expect(h.view.body).not.toContain(STARTING);
      expect(h.view.body.join(' ')).toMatch(SPEAK);
      expect(h.view.timer).toMatchObject({ elapsedMs: 0 });
      // the calibration window has no stop control of its own (a fixed 6 s); the other two offer stop_early and cancel
      expect(h.view.actions.map((a) => a.id)).toEqual(kind === 'calibration' ? [] : ['stop_early', 'cancel']);
      if (kind !== 'calibration') expect(h.view.preferredAction).toBe('stop_early');
      expect(h.view.meter).not.toBeNull();
    });
  }

  it('the vowel title does not say "Say ahh" before the capture has started', async () => {
    const h = await startedWindow('vowel');
    expect(h.view.title).toBe('Sustained sound (optional)');
    h.phoneStartsMeasuring();
    expect(h.view.title).toBe('Say ahh');
  });

  it('a hidden first attempt: the same, and the frames start the capture without being shown', async () => {
    const h = await startedWindow('phrase', { hiddenPhrase: true });
    expect(h.view.phrase?.position).toBe(3);
    expect(h.view.body).toContain(STARTING);
    expect(h.view.body.join(' ')).toContain('Blind check');
    expect(h.view.timer).toBeNull();
    expect(h.view.actions).toEqual([]);
    h.advance(600);
    expect(h.view.body).toContain(STARTING);
    h.level(0, FLOOR + 30, true); // the first frame is the start signal
    expect(h.view.body).not.toContain(STARTING);
    expect(h.view.body.join(' ')).toContain('Say the phrase now');
    expect(h.view.timer).toMatchObject({ elapsedMs: 0, maxMs: 8000 });
    expect(h.view.actions.map((a) => a.id)).toEqual(['stop_early', 'cancel']);
    expect(h.view.meter).toBeNull(); // never shown
    expect(h.view.result).toBeNull();
    expect(JSON.stringify(h.view)).not.toMatch(/-?\d+\.\d dB|reached|below/i);
  });

  it('a speaker following the TV prompt speaks after the phone is measuring: a delayed start no longer swallows the tone (latency run)', async () => {
    const h = await startedWindow('calibration');
    // 600 ms of latency: the TV used to prompt at once and the first 600 ms of speech was lost
    h.advance(600);
    expect(h.view.body.join(' ')).not.toMatch(SPEAK);
    h.phoneStartsMeasuring(); // the phone starts now
    expect(h.view.body.join(' ')).toMatch(SPEAK);
    // everything the speaker says from the prompt on is inside the phone's window: 2 s of tone, 6 s window
    h.advance(2000);
    h.answerWindow({ rel: 20, activeMs: 2000 });
    expect(h.view.result?.label).toBe("Today's band is set");
  });

  it('frames of another window, integrity-failing frames and duplicates do not start the capture', async () => {
    const h = await startedWindow('phrase');
    const start = h.last('window.start');
    h.level(0, FLOOR + 5, true, { ...start, window_id: 'w_anotherwindow0001' });
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.body).toContain(STARTING);
    // a frame stamped before its own index allows is dropped (PK-02 on the TV), and is not a start signal
    h.wire(
      h.envelope('level', 'phone', { frame_index: 40, t_audio_ms: 100, dbfs: -45, active: true, clipped: false }, h.ids(start)),
    );
    expect(h.view.body).toContain(STARTING);
    h.level(0, FLOOR + 5, true, start);
    expect(h.view.body).not.toContain(STARTING);
  });

  it('a window.result that arrives before any frame is still accepted (frames can be dropped on the way)', async () => {
    const h = await startedWindow('phrase');
    h.advance(1200);
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.label).toBe("Reached today's relative level band (unqualified phone)");
  });
});

describe('no frame at all: the window is cancelled as not started', () => {
  const COPY = 'The phone did not start measuring. Try again.';

  for (const kind of ['calibration', 'vowel', 'phrase'] as Kind[]) {
    it(`${kind}: 2999 ms still waits, 3000 ms cancels the window as timeout with the exact copy`, async () => {
      const h = await startedWindow(kind);
      const start = h.last('window.start');
      h.advance(RESULT_GRACE_MS - 1);
      expect(h.view.body).toContain(STARTING);
      expect(h.of('window.cancel')).toHaveLength(0);
      h.advance(1);
      expect(h.last('window.cancel')).toMatchObject({ window_id: start.window_id, attempt_id: start.attempt_id });
      expect(h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
      expect(h.view.stage).toBe('paused_or_invalid');
      expect(h.view.capturing).toBe(false);
      expect(h.view.body).toContain(COPY);
      expect(h.view.timer).toBeNull();
      // a late first frame or result for the cancelled window is stale
      h.level(0, FLOOR + 5, true, start);
      expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
      h.answerWindow({ rel: 25 }, start);
      expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
      expect(h.view.stage).toBe('paused_or_invalid');
    });
  }

  it('the attempt is unscored with the reason no_start, retry works, and the summary says so', async () => {
    const h = await startedWindow('phrase');
    h.advance(RESULT_GRACE_MS);
    expect(h.actionIds()).toEqual(['retry', 'skip_phrase', 'finish_early']);
    h.ui('retry');
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ no_start: 1 });
    expect(h.view.summary).toMatchObject({ phrasesCompleted: 1, attemptsInvalid: 1 });
  });

  it('a hidden attempt that never starts is not a capture close: it takes the immediate path and stays blind for the retry', async () => {
    const h = await startedWindow('phrase', { hiddenPhrase: true });
    h.advance(RESULT_GRACE_MS);
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.body).toContain('The phone did not start measuring. Try again.');
    h.ui('retry');
    // nothing was captured, so the next try is still the blind attempt
    expect(h.view.body.join(' ')).toContain('Blind check');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.phoneStartsMeasuring();
    expect(h.view.meter).toBeNull();
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
  });

  it('Back while the phone is still starting cancels the window and the try never started', async () => {
    const h = await startedWindow('phrase', { hiddenPhrase: true });
    const start = h.last('window.start');
    h.back();
    expect(h.last('window.cancel')).toMatchObject({ window_id: start.window_id });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'user_cancel' });
    // the speaker never saw a prompt: the blind check is not used up
    h.ui('try_again');
    expect(h.view.body.join(' ')).toContain('Blind check');
    h.ui('finish_early');
    // phrases 1 and 2 were attempted before; phrase 3 was not
    expect(h.view.summary).toMatchObject({ phrasesAttempted: 2 });
  });

  it('a vowel that never starts is recorded as unscored, not as a zero-length vowel', async () => {
    const h = await startedWindow('vowel');
    h.advance(RESULT_GRACE_MS);
    expect(h.actionIds()).toEqual(['retry', 'skip_vowel']);
    h.ui('skip_vowel');
    h.ui('finish_early');
    expect(h.view.summary?.longestActiveMs).toBeNull();
  });

  it('the three seconds count from window.start, not from the lead or the precheck', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('begin_phrase');
    h.advance(1500); // precheck.start
    h.advance(1900); // the precheck takes its time
    expect(h.view.body).not.toContain(STARTING);
    h.answerPrecheck(); // window.start now
    h.advance(2999);
    expect(h.view.body).toContain(STARTING);
    h.advance(1);
    expect(h.view.stage).toBe('paused_or_invalid');
  });
});

describe('the timer and the window maximum count from the first frame', () => {
  it('the timer reads 0 at the first frame, not at window.start', async () => {
    const h = await startedWindow('phrase');
    h.advance(600);
    h.phoneStartsMeasuring();
    expect(h.view.timer).toMatchObject({ elapsedMs: 0, maxMs: 8000 });
    h.advance(1000);
    expect(h.view.timer?.elapsedMs).toBe(1000);
    h.advance(1000);
    expect(h.view.timer?.elapsedMs).toBe(2000);
  });

  it('the stop at the window maximum is measured from the first frame (8000 ms + 500 ms), not from window.start', async () => {
    const h = await startedWindow('phrase');
    h.advance(2000); // the first frame is 2 s late
    h.phoneStartsMeasuring();
    h.advance(8499);
    expect(h.of('window.stop')).toHaveLength(0);
    h.advance(1);
    expect(h.last('window.stop').payload).toEqual({ reason: 'complete' });
    expect(h.view.timer?.elapsedMs).toBe(8000);
    // and the result timeout is counted from that stop
    h.advance(2999);
    expect(h.of('window.cancel')).toHaveLength(0);
    h.advance(1);
    expect(h.last('window.cancel').payload).toEqual({ reason: 'timeout' });
  });

  it('the calibration and the vowel use their own maxima from the first frame', async () => {
    const cal = await startedWindow('calibration');
    cal.advance(1000);
    cal.phoneStartsMeasuring();
    expect(cal.view.timer).toMatchObject({ elapsedMs: 0, maxMs: 6000 });
    cal.advance(6499);
    expect(cal.of('window.stop')).toHaveLength(0);
    cal.advance(1);
    expect(cal.last('window.stop').payload).toEqual({ reason: 'complete' });

    const vowel = await startedWindow('vowel');
    vowel.advance(1000);
    vowel.phoneStartsMeasuring();
    expect(vowel.view.timer).toMatchObject({ elapsedMs: 0, maxMs: 30000 });
    vowel.advance(5000);
    expect(vowel.view.timer?.elapsedMs).toBe(5000);
    vowel.ok(); // stop early is offered now
    expect(vowel.last('window.stop').payload).toEqual({ reason: 'early_stop' });
  });

  it('later frames do not restart the timer', async () => {
    const h = await startedWindow('phrase');
    h.phoneStartsMeasuring(0);
    h.advance(1000);
    h.level(1, FLOOR + 5, true);
    h.advance(500);
    h.level(2, FLOOR + 5, true);
    expect(h.view.timer?.elapsedMs).toBe(1500);
  });

  it('heartbeat and quiet-lead behaviour are unchanged: a ping still goes out during the wait for the first frame only after 10 s idle', async () => {
    const h = await startedWindow('phrase');
    h.clearSent();
    h.advance(RESULT_GRACE_MS - 1);
    expect(h.of('ping')).toHaveLength(0);
  });
});

import { isCoverageQuantized, isDbQuantized, parseWireMessage } from '@atr/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quantizeOutbound, PhoneMessageFactory } from '../src/ports/wire.js';
import { validatePhrases, validateCue, validateDeviceLabel } from '../src/phrases.js';
import { mountView } from '../src/view.js';
import {
  ATTEMPT,
  ATTEMPT2,
  authOk,
  CREDENTIAL,
  flush,
  listenerOpen,
  precheckStart,
  relayMsg,
  ROOM,
  SESSION,
  silentPrecheck,
  tvMsg,
  validPrecheck,
  validWindow,
  WINDOW,
  WINDOW2,
  windowStart,
  windowStop,
} from './helpers/fakes.js';
import { advanceLive, readyHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('revision 4: credential rotation (A3-07)', () => {
  const N1 = 'a'.repeat(43);
  const N2 = 'b'.repeat(43);
  const N3 = 'c'.repeat(43);
  const resumeCredential = (h: Awaited<ReturnType<typeof readyHarness>>): unknown =>
    h.sockets.current.messages('auth.resume').at(-1)?.payload['credential'];
  const reconnect = (h: Awaited<ReturnType<typeof readyHarness>>, next: string, generation: number): void => {
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(authOk(generation, true, next));
  };

  it('every successful resume replaces the credential in memory: resume 1 presents the original, 2 presents N1, 3 presents N2', async () => {
    const h = await readyHarness();
    reconnect(h, N1, 2);
    expect(resumeCredential(h)).toBe(CREDENTIAL);
    await flush();
    reconnect(h, N2, 3);
    expect(resumeCredential(h)).toBe(N1);
    await flush();
    reconnect(h, N3, 4);
    expect(resumeCredential(h)).toBe(N2);
    await flush();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    expect(resumeCredential(h)).toBe(N3);
  });

  it('a resume that is refused does not rotate: the retry presents the same credential', async () => {
    const h = await readyHarness();
    reconnect(h, N1, 2);
    await flush();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    expect(resumeCredential(h)).toBe(N1);
    h.sockets.current.receive(relayMsg('error', { code: 'rate_limited', ref_message_id: null, detail: '' }));
    h.sockets.current.drop(4429);
    vi.advanceTimersByTime(1000);
    h.sockets.current.open();
    expect(resumeCredential(h)).toBe(N1);
  });

  it('after the 2-minute failure window, Retry presents the latest rotated credential', async () => {
    const h = await readyHarness();
    reconnect(h, N1, 2);
    await flush();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(120_000);
    expect(h.controller.getState().link).toBe('failed');
    h.controller.retryNow();
    h.sockets.current.open();
    expect(resumeCredential(h)).toBe(N1);
  });

  it('an auth.ok without next_credential is invalid and is not accepted', async () => {
    const h = await readyHarness();
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('auth.ok', { role: 'phone', generation: 2, peer_connected: true, phone_paired: true }));
    await flush();
    expect(h.controller.getState().link).toBe('authenticating');
  });

  it('credentials (original and rotated) never appear in observable state or the page', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    reconnect(h, N1, 2);
    await flush();
    expect(JSON.stringify(h.controller.getState())).not.toContain(N1);
    expect(JSON.stringify(h.controller.getState())).not.toContain(CREDENTIAL);
    expect(document.documentElement.outerHTML).not.toContain(N1);
    expect(document.documentElement.outerHTML).not.toContain(CREDENTIAL);
    view.destroy();
  });

  it('a pairing not confirmed by the person never reaches a resume, so nothing rotates', async () => {
    const h = await readyHarness();
    void ROOM;
    advanceLive(h, 10_000, () => relayMsg('pong', { server_time: 1 }));
    expect(h.sockets.current.messages('auth.resume')).toHaveLength(0);
  });
});

describe('revision 4: quantisation of outgoing measurements (PK-06)', () => {
  const grid = (p: Record<string, unknown>, keys: string[]): boolean =>
    keys.every((k) => p[k] === null || isDbQuantized(p[k] as number));

  it('precheck.result: dB values to 0.1, coverage to 0.001, duration to a whole millisecond; nulls and counts untouched', () => {
    const out = quantizeOutbound('precheck.result', {
      ...validPrecheck('quiet_check'),
      floor_dbfs: -61.2999999,
      p20_dbfs: -62.04,
      p80_dbfs: -59.96,
      p95_dbfs: null,
      coverage: 0.97531,
      duration_ms: 4999.6,
      frame_count: 99,
    });
    expect(out).toMatchObject({ floor_dbfs: -61.3, p20_dbfs: -62, p80_dbfs: -60, p95_dbfs: null, coverage: 0.975, duration_ms: 5000, frame_count: 99, purpose: 'quiet_check', valid: true });
  });

  it('window.result: dB, coverage and every time field; flags, reasons and counts are not touched', () => {
    const out = quantizeOutbound('window.result', {
      ...validWindow('phrase'),
      coverage: 0.9996,
      active_ms: 3000.4,
      longest_active_ms: 2999.6,
      onset_ms: 499.5,
      p50_active_dbfs: -30.04,
      p95_active_dbfs: -24.96,
      peak_dbfs: -19.94,
      duration_ms: 7999.7,
      valid: false,
      invalid_reason: 'continuous_sound',
      segments: 2,
    });
    expect(out).toMatchObject({
      coverage: 1,
      active_ms: 3000,
      longest_active_ms: 3000,
      onset_ms: 500,
      p50_active_dbfs: -30,
      p95_active_dbfs: -25,
      peak_dbfs: -19.9,
      duration_ms: 8000,
      valid: false,
      invalid_reason: 'continuous_sound',
      segments: 2,
    });
  });

  it('level: dbfs to 0.1 dB, t_audio_ms an integer; active and clipped untouched', () => {
    expect(quantizeOutbound('level', { frame_index: 3, t_audio_ms: 150.2, dbfs: -41.7349, active: true, clipped: false })).toEqual({
      frame_index: 3,
      t_audio_ms: 150,
      dbfs: -41.7,
      active: true,
      clipped: false,
    });
  });

  it('is an exact no-op for values already on the grid, and never produces -0', () => {
    const p = { ...validPrecheck('pre_window'), floor_dbfs: -60.1, p20_dbfs: -60.1, p80_dbfs: -60.1, p95_dbfs: -60.1, coverage: 0.9 };
    expect(quantizeOutbound('precheck.result', p)).toEqual(p);
    const w = { ...validWindow('vowel'), peak_dbfs: -0.04, p95_active_dbfs: -0.04, p50_active_dbfs: -0.04 };
    const q = quantizeOutbound('window.result', w);
    expect(Object.is(q.peak_dbfs, -0)).toBe(false);
    expect(q.peak_dbfs).toBe(0);
  });

  it('rounding is monotone: the percentile ordering the validators check survives', () => {
    const out = quantizeOutbound('precheck.result', { ...validPrecheck(), p20_dbfs: -61.049, floor_dbfs: -61.05, p80_dbfs: -61.051, p95_dbfs: -61.0 });
    // these inputs are deliberately NOT ordered (p80 < floor); the point here is only that rounding never reorders values
    expect([out.p20_dbfs, out.floor_dbfs, out.p80_dbfs].every((v) => v !== null && isDbQuantized(v))).toBe(true);
    const ordered = quantizeOutbound('precheck.result', { ...validPrecheck(), p20_dbfs: -61.049, floor_dbfs: -61.04, p80_dbfs: -60.951, p95_dbfs: -60.9 });
    expect((ordered.p20_dbfs as number) <= (ordered.floor_dbfs as number)).toBe(true);
    expect((ordered.floor_dbfs as number) <= (ordered.p80_dbfs as number)).toBe(true);
    expect((ordered.p80_dbfs as number) <= (ordered.p95_dbfs as number)).toBe(true);
  });

  it('other message types pass through untouched', () => {
    const cue = { text: 'Volume' };
    expect(quantizeOutbound('cue', cue)).toBe(cue);
  });

  it('the factory sends quantised values and the package accepts them (off-grid input would otherwise throw)', () => {
    let t = 1_700_000_000_000;
    const f = new PhoneMessageFactory({ clock: () => (t += 1) });
    f.setAuth(ROOM, 1);
    const ids = { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT };
    const pre = f.build('precheck.result', { ...validPrecheck(), floor_dbfs: -60.123456, p20_dbfs: -61.2222, p80_dbfs: -59.0001, p95_dbfs: -58.0049, coverage: 0.99999, duration_ms: 4999.9 }, ids);
    expect(pre.payload).toMatchObject({ floor_dbfs: -60.1, p20_dbfs: -61.2, p80_dbfs: -59, p95_dbfs: -58, coverage: 1, duration_ms: 5000 });
    const win = f.build('window.result', { ...validWindow('phrase'), p95_active_dbfs: -24.987, peak_dbfs: -20.01, p50_active_dbfs: -30.333, coverage: 1, active_ms: 3000.2, longest_active_ms: 3000.2, duration_ms: 8000.4 }, ids);
    expect(grid(win.payload as unknown as Record<string, unknown>, ['p50_active_dbfs', 'p95_active_dbfs', 'peak_dbfs'])).toBe(true);
    expect(isCoverageQuantized(win.payload.coverage)).toBe(true);
    const lvl = f.build('level', { frame_index: 1, t_audio_ms: 50.4, dbfs: -33.3333, active: false, clipped: false }, ids);
    expect(lvl.payload).toMatchObject({ t_audio_ms: 50, dbfs: -33.3 });
    for (const m of [pre, win, lvl]) expect(parseWireMessage(f.serialize(m), { now: m.event_timestamp }).ok).toBe(true);
  });

  it('through the controller: an off-grid result from the port reaches the wire quantised and valid', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(precheckStart());
    h.audio.startedMeasuring();
    h.audio.finishPrecheck({ ...validPrecheck(), floor_dbfs: -60.04, p20_dbfs: -61.04, p80_dbfs: -59.04, p95_dbfs: -58.04, coverage: 0.9996 });
    await flush();
    expect(h.sockets.current.last('precheck.result').payload).toMatchObject({ floor_dbfs: -60, p20_dbfs: -61, p80_dbfs: -59, p95_dbfs: -58, coverage: 1 });
  });
});

describe('revision 4: precheck.result reasons', () => {
  it('silent_input is sent to the TV (and shown on the phone)', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(precheckStart('quiet_check'));
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(silentPrecheck('quiet_check'));
    await flush();
    expect(h.sockets.current.last('precheck.result').payload).toMatchObject({ valid: false, invalid_reason: 'silent_input' });
    expect(h.controller.getState().micNotice).toBe('silent_input');
  });

  it('pre_window: silent_input is allowed; unstable_floor and too_loud are not (the validator refuses them, the phone says so)', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(precheckStart('pre_window'));
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(silentPrecheck('pre_window'));
    await flush();
    expect(h.sockets.current.messages('precheck.result')).toHaveLength(1);
    h.sockets.current.receive(precheckStart('pre_window', WINDOW2, ATTEMPT2));
    h.audio.startedMeasuring();
    h.audio.finishPrecheck({ ...validPrecheck('pre_window'), valid: false, invalid_reason: 'too_loud', floor_dbfs: -20, p20_dbfs: -21, p80_dbfs: -19, p95_dbfs: -18 });
    await flush();
    expect(h.sockets.current.messages('precheck.result')).toHaveLength(1); // refused, not sent
    expect(h.controller.getState().notice).toMatch(/could not report that measurement/);
  });
});

describe('revision 4: display safety for phrases, cue and device name', () => {
  const RLO = '\u202E'; // right-to-left override
  const cases: Array<[string, string, RegExp]> = [
    ['right-to-left override', `abc${RLO}def`, /cannot be shown safely/],
    ['bidi isolate', 'a\u2066b\u2069', /cannot be shown safely/],
    ['line separator', 'a\u2028b', /cannot be shown safely/],
    ['invisible operator', 'a\u2062b', /cannot be shown safely/],
    ['byte order mark inside the text', 'a\uFEFFbc', /cannot be shown safely/],
    ['zero-width characters only', '\u200B\u200B\u200B', /nothing visible/],
    ['soft hyphen only', '\u00AD', /nothing visible/],
    ['five combining marks in a row', 'x\u0301\u0302\u0303\u0304\u0305', /more than 4 accent or combining marks/],
  ];

  it.each(cases)('phrase with %s is refused with a plain message', (_name, text, message) => {
    const v = validatePhrases([text]);
    expect(v.ok).toBe(false);
    expect(v.issues[0]?.message).toMatch(message);
    expect(v.issues[0]?.message).toMatch(/^Phrase 1 /);
  });

  it.each(cases)('cue word with %s is refused with a plain message', (_name, text, message) => {
    const v = validateCue(text);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(message);
    expect(v.message).toMatch(/^The cue word /);
  });

  it.each(cases)('device name with %s is refused with a plain message', (_name, text, message) => {
    const v = validateDeviceLabel(text);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(message);
    expect(v.message).toMatch(/^The device name /);
  });

  it('a leading or trailing byte order mark is trimmed away by the phone (it is whitespace to trim), so it is never sent', () => {
    const v = validatePhrases(['\ufeffabc\ufeff']);
    expect(v.ok).toBe(true);
    expect(v.phrases[0]).toBe('abc');
  });

  it('still allows what is legitimate: four combining marks, ZWJ emoji, ZWNJ, LRM, soft hyphen inside a word', () => {
    expect(validatePhrases(['x\u0301\u0302\u0303\u0304', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', 'a\u200Cb', 'a\u200Eb', 'co\u00ADoperate']).ok).toBe(true);
  });

  it('the editor shows the message live and keeps Save disabled; nothing is sent', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    const input = document.getElementById('phrase-1') as HTMLInputElement;
    input.value = `evil${RLO}text`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('phrase-msg-1')?.textContent).toMatch(/cannot be shown safely/);
    expect((document.getElementById('save-phrases') as HTMLButtonElement).disabled).toBe(true);
    expect(h.controller.savePhrases([input.value]).sent).toBe(false);
    expect(h.sockets.current.messages('phrases.update')).toHaveLength(0);
    view.destroy();
  });

  it('the join form refuses an unsafe device name', async () => {
    const h = await readyHarness();
    void h;
    const j = (await import('./helpers/harness.js')).makeHarness();
    j.controller.setCode('ACDEFH');
    j.controller.setDeviceLabel(`Mum${RLO}phone`);
    j.controller.join();
    expect(j.sockets.sockets).toHaveLength(0);
    expect(j.controller.getState().join.deviceLabelMessage).toMatch(/cannot be shown safely/);
  });
});

describe('revision 4: one window_id per measurement, shared attempt_id', () => {
  it('a precheck and the capture of the same attempt each get their own window id and both run', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(precheckStart('pre_window', WINDOW, ATTEMPT));
    expect(h.sockets.current.last('ack').payload.outcome).toBe('applied');
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(validPrecheck('pre_window'));
    await flush();
    h.sockets.current.receive(windowStart('phrase', WINDOW2, ATTEMPT)); // same attempt, new window id
    expect(h.sockets.current.last('ack').payload.outcome).toBe('applied');
    h.audio.frame(0);
    h.sockets.current.receive(windowStop(WINDOW2, ATTEMPT));
    await flush();
    const pre = h.sockets.current.last('precheck.result');
    const res = h.sockets.current.last('window.result');
    expect([pre.window_id, pre.attempt_id]).toEqual([WINDOW, ATTEMPT]);
    expect([res.window_id, res.attempt_id]).toEqual([WINDOW2, ATTEMPT]);
  });

  it('each window id is single-use: replaying a finished precheck or capture id is stale', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(precheckStart('pre_window', WINDOW, ATTEMPT));
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(validPrecheck('pre_window'));
    await flush();
    h.sockets.current.receive(precheckStart('pre_window', WINDOW, ATTEMPT));
    expect(h.sockets.current.last('ack').payload).toMatchObject({ outcome: 'ignored_stale', detail: 'window_closed' });
    h.sockets.current.receive(windowStart('phrase', WINDOW2, ATTEMPT));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('phrase'));
    await flush();
    h.sockets.current.receive(windowStart('phrase', WINDOW2, ATTEMPT));
    expect(h.sockets.current.last('ack').payload).toMatchObject({ outcome: 'ignored_stale', detail: 'window_closed' });
  });

  it('the listener binds to the capture window and the shared attempt', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase', WINDOW2, ATTEMPT));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow('phrase'));
    await flush();
    h.sockets.current.receive(tvMsg('listener.open', { timeout_ms: 20000 }, { s: SESSION, w: WINDOW2, a: ATTEMPT }));
    h.controller.answer('heard');
    expect(h.sockets.current.last('listener.response')).toMatchObject({ window_id: WINDOW2, attempt_id: ATTEMPT });
    void listenerOpen;
  });
});

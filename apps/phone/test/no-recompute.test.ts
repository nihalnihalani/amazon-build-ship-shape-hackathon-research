import { isCoverageQuantized, isDbQuantized, parseWireMessage } from '@atr/protocol';
import { describe, expect, it } from 'vitest';
import { createAudioPort } from '../src/ports/audio.js';
import { PhoneMessageFactory } from '../src/ports/wire.js';
import { frameFromReduction, summarizePrecheck, WindowAccumulator } from '@atr/phone-mic-meter';
import { flush, precheckStart, validPrecheck, validWindow, windowStart, windowStop } from './helpers/fakes.js';
import { readyHarness } from './helpers/harness.js';

/**
 * Item 8 / PK-06: quantisation, VAD and validity come from @atr/phone-mic-meter. The phone's wire
 * port must send exactly what the package returns, never recompute or re-round it.
 */

describe('the controller sends the port payload unchanged', () => {
  it('precheck.result carries exactly the object the port produced', async () => {
    const h = await readyHarness();
    const payload = { ...validPrecheck('quiet_check'), floor_dbfs: -61.3, p20_dbfs: -61.9, p80_dbfs: -60.7, p95_dbfs: -60.1, coverage: 0.975, duration_ms: 4975 };
    h.sockets.current.receive(precheckStart());
    h.audio.startedMeasuring();
    h.audio.finishPrecheck(payload);
    await flush();
    expect(h.sockets.current.last('precheck.result').payload).toEqual(payload);
  });

  it('window.result carries exactly the object the port produced, including values a recomputation would change', async () => {
    const h = await readyHarness();
    // valid:false despite generous numbers: a phone that "re-validated" would flip this to true
    const payload = { ...validWindow('phrase'), valid: false, invalid_reason: 'continuous_sound' as const, active_ms: 7600, longest_active_ms: 7600, p95_active_dbfs: -21.4, peak_dbfs: -18.2 };
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow(payload);
    await flush();
    expect(h.sockets.current.last('window.result').payload).toEqual(payload);
  });

  it('level frames carry the port values as given (no rounding, no re-derivation of active/clipped)', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.lastOnFrame?.({ frameIndex: 7, tAudioMs: 350, dbfs: -41.7, active: false, clipped: true });
    const m = h.sockets.current.messages('level').at(-1);
    expect(m?.payload).toEqual({ frame_index: 7, t_audio_ms: 350, dbfs: -41.7, active: false, clipped: true });
  });

  it('an early-stop result is the port summary, sent after the ack', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('vowel'));
    h.audio.frame(0);
    h.sockets.current.receive(windowStop());
    await flush();
    expect(h.sockets.current.last('window.result').payload).toMatchObject({ kind: 'vowel', duration_ms: 1500 });
  });
});

describe('the audio port returns the package results unchanged', () => {
  class FakeTrack extends EventTarget {
    kind = 'audio';
    getSettings(): Record<string, unknown> {
      return {};
    }
    stop(): void {}
  }
  class Node {
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (_m: unknown): void => {}, close: (): void => {} };
    connect(t: unknown): unknown {
      return t;
    }
    disconnect(): void {}
  }
  class Ctx extends EventTarget {
    state = 'suspended';
    sampleRate = 48000;
    destination = new Node();
    audioWorklet = { addModule: async (): Promise<void> => {} };
    async resume(): Promise<void> {
      this.state = 'running';
    }
    async close(): Promise<void> {
      this.state = 'closed';
    }
    createMediaStreamSource(): Node {
      return new Node();
    }
    createGain(): Node & { gain: { value: number } } {
      return Object.assign(new Node(), { gain: { value: 1 } });
    }
  }

  function rig() {
    let node!: Node;
    const stream = { getTracks: () => [new FakeTrack()], getAudioTracks: () => [new FakeTrack()] };
    const port = createAudioPort({
      mediaDevices: { getUserMedia: async () => stream as never },
      AudioContextCtor: Ctx as never,
      AudioWorkletNodeCtor: class extends Node {
        constructor() {
          super();
          node = this;
        }
      } as never,
      workletModuleUrl: './x.js',
      isSecureContext: true,
      mode: 'physical_phone',
    });
    return { port, deliver: (index: number, value: number, runEpoch = 1) => node.port.onmessage?.({ data: { firstSampleIndex: index * 2400, n: 2400, sumSquares: 2400 * value * value, peak: Math.abs(value), clippedCount: 0, nonfinite: false, epoch: runEpoch } }) };
  }

  const reduction = (value: number) => ({ n: 2400, sumSquares: 2400 * value * value, peak: Math.abs(value), clippedCount: 0, nonfinite: false });

  it('precheck: result equals summarizePrecheck over the same frames', async () => {
    const { port, deliver } = rig();
    await port.open();
    const run = port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    const levels = Array.from({ length: 100 }, (_, i) => 1e-3 * (1 + (i % 7) / 50));
    levels.forEach((v, i) => deliver(i, v));
    const got = await run.result;
    const frames = levels.map((v, i) => frameFromReduction(i, i * 2400, 48000, reduction(v)));
    expect(got).toEqual(summarizePrecheck(frames, { purpose: 'quiet_check', durationMs: 5000 }));
  });

  it('window: level frames and the result equal what WindowAccumulator returns for the same frames', async () => {
    const { port, deliver } = rig();
    await port.open();
    const seen: unknown[] = [];
    const run = port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, (f) => seen.push(f));
    const levels = Array.from({ length: 160 }, (_, i) => (i >= 20 && i < 90 ? 0.05 : 1e-3));
    levels.forEach((v, i) => deliver(i, v));
    const got = await run.result;

    const acc = new WindowAccumulator({ kind: 'phrase', maxDurationMs: 8000, sessionFloorDbfs: -60, sampleRate: 48000 });
    const expectedLevels = levels.map((v, i) => acc.push(frameFromReduction(i, i * 2400, 48000, reduction(v))));
    expect(got).toEqual(acc.finish('complete', { durationMs: 8000 }));
    expect(seen).toEqual(expectedLevels.map((l) => ({ frameIndex: l?.frame_index, tAudioMs: l?.t_audio_ms, dbfs: l?.dbfs, active: l?.active, clipped: l?.clipped })));
  });

  it('what the DSP package returns today (not yet on the protocol grid) is accepted by the validator once the wire port rounds it, and is a no-op afterwards', async () => {
    const { port, deliver } = rig();
    await port.open();
    const pre = port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    Array.from({ length: 100 }, (_, i) => 1e-3 * (1 + (i % 7) / 50)).forEach((v, i) => deliver(i, v));
    const precheck = await pre.result;
    const win = port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined);
    Array.from({ length: 160 }, (_, i) => (i >= 20 && i < 90 ? 0.05 + (i % 5) / 1000 : 1e-3)).forEach((v, i) => deliver(i, v, 2));
    const window = await win.result;
    expect(precheck).not.toBeNull();
    expect(window).not.toBeNull();

    let t = 1_700_000_000_000;
    const f = new PhoneMessageFactory({ clock: () => (t += 1) });
    f.setAuth('r_roomroomroomroom01', 1);
    const ids = { session_id: 's_session0001', window_id: 'w_window00001', attempt_id: 'a_attempt0001' };
    const sentPre = f.build('precheck.result', precheck as never, ids);
    const sentWin = f.build('window.result', window as never, ids);
    for (const m of [sentPre, sentWin]) expect(parseWireMessage(f.serialize(m), { now: m.event_timestamp }).ok).toBe(true);
    const p = sentPre.payload;
    expect([p.floor_dbfs, p.p20_dbfs, p.p80_dbfs, p.p95_dbfs].every((v) => v !== null && isDbQuantized(v))).toBe(true);
    expect(isCoverageQuantized(p.coverage)).toBe(true);
    const w = sentWin.payload;
    expect([w.p50_active_dbfs, w.p95_active_dbfs, w.peak_dbfs].every((v) => v !== null && isDbQuantized(v))).toBe(true);
    expect([w.active_ms, w.longest_active_ms, w.duration_ms].every(Number.isInteger)).toBe(true);
    // validity, reasons and counts are exactly the package's
    expect(w).toMatchObject({ valid: (window as { valid: boolean }).valid, invalid_reason: (window as { invalid_reason: unknown }).invalid_reason, segments: (window as { segments: number }).segments });
    // a second pass changes nothing
    const again = f.build('window.result', w, ids);
    expect(again.payload).toEqual(w);
  });
});

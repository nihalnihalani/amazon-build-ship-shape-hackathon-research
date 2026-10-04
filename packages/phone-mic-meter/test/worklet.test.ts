import { describe, expect, it, vi } from 'vitest';
import { CLIP_SAMPLE } from '../src/constants.js';
import { reduceFrame } from '../src/frame.js';
import { loadFrameProcessor } from '../src/browser/worklet-loader.js';
import { FRAME_PROCESSOR_NAME, FRAME_PROCESSOR_SOURCE } from '../src/browser/worklet-source.js';
import { mulberry32 } from './helpers.js';

interface PostedFrame {
  firstSampleIndex: number;
  n: number;
  sumSquares: number;
  peak: number;
  clippedCount: number;
  nonfinite: boolean;
  epoch: number;
}

interface FakeProcessor {
  port: { postMessage: (m: unknown) => void; onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs?: Float32Array[][]): boolean;
}

/** Evaluate the worklet source with fake AudioWorkletGlobalScope names. */
function loadProcessor(sampleRate: number) {
  const posted: unknown[] = [];
  const state = { currentFrame: 0 };
  let registered: { name: string; ctor: new () => FakeProcessor } | null = null;

  class FakeAudioWorkletProcessor {
    port = {
      postMessage: (m: unknown) => {
        posted.push(m);
      },
      onmessage: null as ((e: { data: unknown }) => void) | null,
    };
  }

  const scope = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (name: string, ctor: new () => FakeProcessor) => {
      registered = { name, ctor };
    },
    sampleRate,
    get currentFrame() {
      return state.currentFrame;
    },
  };
  // `with` lets `currentFrame` stay a live binding, like the real worklet global.
  new Function('scope', `with (scope) {\n${FRAME_PROCESSOR_SOURCE}\n}`)(scope);
  if (registered === null) throw new Error('processor was not registered');
  const reg = registered as { name: string; ctor: new () => FakeProcessor };
  const processor = new reg.ctor();
  const send = (data: unknown) => processor.port.onmessage?.({ data });
  /** Feed `signal` in blocks of `block` samples, advancing currentFrame like the audio thread. */
  const feed = (signal: Float32Array, block = 128, startFrame = 0) => {
    state.currentFrame = startFrame;
    for (let i = 0; i < signal.length; i += block) {
      const chunk = signal.subarray(i, Math.min(signal.length, i + block));
      processor.process([[chunk]]);
      state.currentFrame += chunk.length;
    }
  };
  return { name: reg.name, processor, posted, state, send, feed };
}

function testSignal(): Float32Array {
  const rand = mulberry32(2026);
  const n = 2400 * 5 + 300;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (rand() * 2 - 1) * 0.4;
  s[100] = 1.0; // clipped sample in frame 0
  s[101] = -0.999; // clipped sample in frame 0
  for (let i = 2400; i < 2400 + 30; i++) s[i] = 1.2; // 30 clipped samples (> 0.5 %) in frame 1
  s[4800 + 7] = Number.NaN; // frame 2 non-finite
  s[7200 + 2399] = Number.POSITIVE_INFINITY; // frame 3 non-finite, last sample
  s[9600 + 5] = Number.NEGATIVE_INFINITY; // frame 4 non-finite
  return s;
}

describe('worklet source evaluated in a sandbox', () => {
  it('registers under the exported processor name', () => {
    expect(loadProcessor(48000).name).toBe(FRAME_PROCESSOR_NAME);
  });

  it('posted reductions are bit-identical to reduceFrame() on the same samples (no drift)', () => {
    const signal = testSignal();
    const { posted, send, feed } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 7 });
    feed(signal, 128, 96000); // non-zero absolute currentFrame: indices must be relative to start

    // 5 complete frames; the 300-sample tail stays pending.
    expect(posted).toHaveLength(5);
    posted.forEach((m, k) => {
      const expected = reduceFrame(signal, k * 2400, (k + 1) * 2400);
      const got = m as PostedFrame;
      expect(got.firstSampleIndex).toBe(k * 2400);
      expect(got.n).toBe(2400);
      expect(got.sumSquares).toBe(expected.sumSquares); // exact, not approximate
      expect(got.peak).toBe(expected.peak);
      expect(got.clippedCount).toBe(expected.clippedCount);
      expect(got.nonfinite).toBe(expected.nonfinite);
      expect(got.epoch).toBe(7);
    });
    // Spot-check the designed content so the comparison above is not vacuous.
    expect((posted[0] as PostedFrame).clippedCount).toBe(2);
    expect((posted[1] as PostedFrame).clippedCount).toBe(30);
    expect((posted[2] as PostedFrame).nonfinite).toBe(true);
    expect((posted[3] as PostedFrame).nonfinite).toBe(true);
    expect((posted[4] as PostedFrame).nonfinite).toBe(true);
    expect((posted[0] as PostedFrame).nonfinite).toBe(false);
  });

  it('applies the same exact-threshold rule as reduceFrame (|x| >= 0.999 counts, 0.998999999 does not)', () => {
    // Plain doubles so that the threshold value itself can be tested exactly (float32 cannot hold 0.999).
    const samples = new Array<number>(2400).fill(0.1);
    samples[0] = 0.999;
    samples[1] = -0.999;
    samples[2] = 0.998999999;
    samples[3] = -0.998999999;
    samples[4] = 0.9990000001;
    const { posted, send, processor, state } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    state.currentFrame = 0;
    for (let i = 0; i < samples.length; i += 128) {
      const block = samples.slice(i, i + 128) as unknown as Float32Array;
      processor.process([[block]]);
      state.currentFrame += block.length;
    }
    expect(posted).toHaveLength(1);
    const expected = reduceFrame(samples, 0, 2400);
    expect(expected.clippedCount).toBe(3);
    expect((posted[0] as PostedFrame).clippedCount).toBe(3);
    expect((posted[0] as PostedFrame).sumSquares).toBe(expected.sumSquares);
  });

  it('gives the same result for other block sizes and 44.1 kHz frame length', () => {
    const rand = mulberry32(5);
    const signal = new Float32Array(2205 * 3);
    for (let i = 0; i < signal.length; i++) signal[i] = (rand() * 2 - 1) * 0.2;
    for (const block of [1, 128, 441, 2205, 4000]) {
      const { posted, send, feed } = loadProcessor(44100);
      send({ cmd: 'start', epoch: 1 });
      feed(signal, block);
      expect(posted).toHaveLength(3);
      posted.forEach((m, k) => {
        const e = reduceFrame(signal, k * 2205, (k + 1) * 2205);
        const g = m as PostedFrame;
        expect(g.n).toBe(2205);
        expect(g.firstSampleIndex).toBe(k * 2205);
        expect(g.sumSquares).toBe(e.sumSquares);
      });
    }
  });

  it('posts only scalar fields: never samples, arrays or buffers', () => {
    const { posted, send, feed } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    feed(testSignal());
    expect(posted.length).toBeGreaterThan(0);
    for (const m of posted) {
      expect(Object.keys(m as object).sort()).toEqual(
        ['clippedCount', 'epoch', 'firstSampleIndex', 'n', 'nonfinite', 'peak', 'sumSquares'].sort(),
      );
      for (const v of Object.values(m as object)) {
        expect(['number', 'boolean']).toContain(typeof v);
      }
    }
  });

  it('the source posts through exactly one postMessage call and references no sample storage', () => {
    expect(FRAME_PROCESSOR_SOURCE.match(/postMessage\(/g)).toHaveLength(1);
    expect(FRAME_PROCESSOR_SOURCE).not.toMatch(/Float32Array|new Array|\.slice\(|\.push\(|subarray|\.set\(/);
  });

  it('interpolates the clip threshold from constants.ts', () => {
    expect(FRAME_PROCESSOR_SOURCE).toContain(`var ATR_CLIP_SAMPLE = ${CLIP_SAMPLE};`);
  });

  it('posts nothing until started, and nothing after stop', () => {
    const { posted, send, feed } = loadProcessor(48000);
    feed(new Float32Array(2400 * 2).fill(0.1));
    expect(posted).toHaveLength(0);
    send({ cmd: 'start', epoch: 1 });
    feed(new Float32Array(2400).fill(0.1), 128, 0);
    expect(posted).toHaveLength(1);
    send({ cmd: 'stop' });
    feed(new Float32Array(2400 * 2).fill(0.1), 128, 5000);
    expect(posted).toHaveLength(1);
  });

  it('start discards a partial frame, re-bases indices to 0 and echoes the new epoch', () => {
    const { posted, send, feed } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    feed(new Float32Array(1000).fill(0.5), 128, 0); // partial frame
    send({ cmd: 'start', epoch: 2 });
    feed(new Float32Array(2400).fill(0.1), 128, 99999);
    expect(posted).toHaveLength(1);
    const m = posted[0] as PostedFrame;
    expect(m.epoch).toBe(2);
    expect(m.firstSampleIndex).toBe(0);
    expect(m.peak).toBeCloseTo(0.1, 6); // none of the earlier 0.5 samples leaked in
  });

  it('a render discontinuity drops the partial frame and shows up as an index jump', () => {
    const { posted, send, processor, state } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    const block = new Float32Array(128).fill(0.1);
    // 10 blocks = 1280 samples, then a jump of 5120 samples, then 19 blocks (2432 samples).
    state.currentFrame = 0;
    for (let i = 0; i < 10; i++) {
      processor.process([[block]]);
      state.currentFrame += 128;
    }
    state.currentFrame += 5120;
    for (let i = 0; i < 19; i++) {
      processor.process([[block]]);
      state.currentFrame += 128;
    }
    expect(posted).toHaveLength(1);
    const m = posted[0] as PostedFrame;
    expect(m.firstSampleIndex).toBe(1280 + 5120); // the frame began right after the gap
    expect(m.n).toBe(2400);
  });

  it('does not write to its output and survives a missing input', () => {
    const { processor, send, state } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    const outputs = [[new Float32Array(128).fill(0)]];
    const inputs = [[new Float32Array(128).fill(0.7)]];
    expect(processor.process(inputs, outputs)).toBe(true);
    expect(outputs[0]?.[0]?.every((v) => v === 0)).toBe(true); // output stays silent
    expect(FRAME_PROCESSOR_SOURCE).not.toMatch(/outputs/); // the source never touches an output buffer
    state.currentFrame = 128;
    expect(processor.process([])).toBe(true);
    expect(processor.process([[]])).toBe(true);
  });

  it('close makes process() return false so the node can be released', () => {
    const { processor, send } = loadProcessor(48000);
    send({ cmd: 'start', epoch: 1 });
    expect(processor.process([[new Float32Array(128)]])).toBe(true);
    send({ cmd: 'close' });
    expect(processor.process([[new Float32Array(128)]])).toBe(false);
  });
});

describe('loadFrameProcessor', () => {
  it('loads from a module URL when given one (no Blob)', async () => {
    const addModule = vi.fn(async (_url: string) => {});
    await loadFrameProcessor({ audioWorklet: { addModule } }, { moduleUrl: '/static/atr-frame-processor.js' });
    expect(addModule).toHaveBeenCalledWith('/static/atr-frame-processor.js');
  });

  it('loads from a Blob URL containing the processor source and revokes the URL afterwards', async () => {
    const blobs: Array<{ parts: string[]; options?: { type?: string } }> = [];
    class FakeBlob {
      constructor(parts: string[], options?: { type?: string }) {
        blobs.push({ parts, ...(options !== undefined ? { options } : {}) });
      }
    }
    const urlApi = { createObjectURL: vi.fn(() => 'blob:fake-1'), revokeObjectURL: vi.fn() };
    const addModule = vi.fn(async (_url: string) => {});
    await loadFrameProcessor({ audioWorklet: { addModule } }, { BlobCtor: FakeBlob, urlApi });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.parts).toEqual([FRAME_PROCESSOR_SOURCE]);
    expect(blobs[0]?.options?.type).toBe('text/javascript');
    expect(addModule).toHaveBeenCalledWith('blob:fake-1');
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });

  it('revokes the Blob URL even when addModule fails', async () => {
    class FakeBlob {
      constructor(_parts: string[]) {}
    }
    const urlApi = { createObjectURL: vi.fn(() => 'blob:fake-2'), revokeObjectURL: vi.fn() };
    const addModule = vi.fn(async (_url: string) => {
      throw new Error('boom');
    });
    await expect(
      loadFrameProcessor({ audioWorklet: { addModule } }, { BlobCtor: FakeBlob, urlApi }),
    ).rejects.toThrow('boom');
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:fake-2');
  });
});

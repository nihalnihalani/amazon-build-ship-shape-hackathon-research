import { describe, expect, it } from 'vitest';
import { frameStats, reduceFrame } from '../src/frame.js';
import type { Frame } from '../src/frame.js';
import { SampleFramer } from '../src/framer.js';
import { mulberry32, sine } from './helpers.js';

function feed(framer: SampleFramer, signal: Float32Array, chunk: number): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < signal.length; i += chunk) {
    out.push(...framer.push(signal.subarray(i, Math.min(signal.length, i + chunk))));
  }
  return out;
}

describe('SampleFramer with 128-sample render quanta', () => {
  it('48 kHz: 1 s of audio gives exactly 20 frames at t = 50 ms steps', () => {
    const framer = new SampleFramer(48000);
    expect(framer.frameLength).toBe(2400);
    const frames = feed(framer, sine(0.5, 1000, 48000, 48000), 128); // 375 chunks of 128
    expect(frames).toHaveLength(20);
    frames.forEach((f, k) => {
      expect(f.frameIndex).toBe(k);
      expect(f.firstSampleIndex).toBe(2400 * k);
      expect(f.t_audio_ms).toBe(50 * k); // exact, not approximate
      expect(f.duration_ms).toBe(50);
      expect(f.sampleCount).toBe(2400);
      expect(f.finite).toBe(true);
      expect(f.dbfs).toBeCloseTo(-9.0309, 3);
    });
    expect(framer.pendingSamples).toBe(0);
  });

  it('44.1 kHz: 1 s of audio (344 full chunks and a 68-sample tail) gives exactly 20 frames', () => {
    const framer = new SampleFramer(44100);
    expect(framer.frameLength).toBe(2205);
    const frames = feed(framer, sine(0.25, 980, 44100, 44100), 128);
    expect(frames).toHaveLength(20);
    frames.forEach((f, k) => {
      expect(f.firstSampleIndex).toBe(2205 * k);
      expect(f.t_audio_ms).toBe(50 * k); // 2205*k*1000/44100 = 50k exactly
      expect(f.duration_ms).toBe(50);
      expect(f.dbfs).toBeCloseTo(-15.0515, 3);
    });
  });

  it('emits nothing until a frame is complete and keeps the remainder pending', () => {
    const framer = new SampleFramer(48000);
    expect(framer.push(new Float32Array(2399))).toHaveLength(0);
    expect(framer.pendingSamples).toBe(2399);
    const out = framer.push(new Float32Array(130));
    expect(out).toHaveLength(1);
    expect(framer.pendingSamples).toBe(129);
    expect(framer.totalSamples).toBe(2400 + 129);
  });

  it('a chunk spanning several frames yields them all in order', () => {
    const framer = new SampleFramer(48000);
    const out = framer.push(new Float32Array(2400 * 3 + 5));
    expect(out.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
    expect(framer.pendingSamples).toBe(5);
  });

  it('ignores empty chunks', () => {
    const framer = new SampleFramer(48000);
    expect(framer.push(new Float32Array(0))).toEqual([]);
    expect(framer.pendingSamples).toBe(0);
  });
});

describe('SampleFramer is independent of chunking and matches whole-frame reduction', () => {
  it('chunk sizes 1, 7, 128, 480, 2400, 5000 and random produce bit-identical frames', () => {
    const rand = mulberry32(12345);
    const total = 2400 * 6 + 777;
    const signal = new Float32Array(total);
    for (let i = 0; i < total; i++) signal[i] = (rand() * 2 - 1) * 0.3;
    signal[3000] = 1.0; // a clipped sample inside frame 1

    // Whole-frame reference computed directly.
    const reference: Frame[] = [];
    for (let k = 0; k < 6; k++) {
      const r = reduceFrame(signal, k * 2400, (k + 1) * 2400);
      const s = frameStats(r);
      reference.push({
        frameIndex: k,
        firstSampleIndex: k * 2400,
        t_audio_ms: k * 50,
        duration_ms: 50,
        sampleCount: 2400,
        rms: s.rms,
        dbfs: s.dbfs,
        peak: r.peak,
        clipped: s.clipped,
        clippedCount: r.clippedCount,
        finite: s.finite,
      });
    }

    for (const chunk of [1, 7, 128, 480, 2400, 5000]) {
      const frames = feed(new SampleFramer(48000), signal, chunk);
      expect(frames).toEqual(reference);
    }

    // Random chunk lengths.
    const framer = new SampleFramer(48000);
    const frames: Frame[] = [];
    let pos = 0;
    const r2 = mulberry32(99);
    while (pos < total) {
      const len = Math.min(total - pos, 1 + Math.floor(r2() * 900));
      frames.push(...framer.push(signal.subarray(pos, pos + len)));
      pos += len;
    }
    expect(frames).toEqual(reference);
  });

  it('places a burst by sample position: frame 2 holds samples 4900..7199 at 0.5', () => {
    // Frame 2 spans samples 4800..7199. The burst occupies 2300 of its 2400 samples.
    const signal = new Float32Array(2400 * 4);
    signal.fill(0.5, 4900, 7200);
    const frames = feed(new SampleFramer(48000), signal, 128);
    expect(frames).toHaveLength(4);
    // rms^2 = 0.25 * 2300/2400 -> dBFS = 20*log10(0.5) + 10*log10(2300/2400) = -6.0206 - 0.1848 (10*log10(23/24) = -0.1848)
    expect(frames[2]?.dbfs).toBeCloseTo(-6.2054, 3);
    expect(frames[1]?.dbfs).toBeCloseTo(-140, 9);
    expect(frames[3]?.dbfs).toBeCloseTo(-140, 9);
  });

  it('flags a frame as non-finite when a NaN arrives in any chunk', () => {
    const signal = new Float32Array(2400 * 2).fill(0.1);
    signal[2500] = Number.NaN;
    const frames = feed(new SampleFramer(48000), signal, 128);
    expect(frames.map((f) => f.finite)).toEqual([true, false]);
  });
});

describe('SampleFramer.reset', () => {
  it('discards the incomplete frame; the next frame is frame 0 at sample 0', () => {
    const framer = new SampleFramer(48000);
    const first = framer.push(new Float32Array(3000).fill(0.5));
    expect(first).toHaveLength(1);
    expect(framer.pendingSamples).toBe(600);

    framer.reset();
    expect(framer.pendingSamples).toBe(0);
    expect(framer.totalSamples).toBe(0);

    // 2400 silent samples after the reset: had the stale 600 loud samples straddled the reset,
    // this frame would contain them and could not be exactly -140 dBFS.
    const after = framer.push(new Float32Array(2400));
    expect(after).toHaveLength(1);
    expect(after[0]?.frameIndex).toBe(0);
    expect(after[0]?.firstSampleIndex).toBe(0);
    expect(after[0]?.t_audio_ms).toBe(0);
    expect(after[0]?.dbfs).toBeCloseTo(-140, 9);
  });

  it('rejects invalid sample rates', () => {
    expect(() => new SampleFramer(0)).toThrow(RangeError);
  });
});

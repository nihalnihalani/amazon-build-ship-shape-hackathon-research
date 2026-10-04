import { describe, expect, it, vi } from 'vitest';
import { gainForDbfs, installTestAudio, TEST_AUDIO_BANNER } from '../src/audio/test-audio.js';

class FakeGainParam {
  value = 1;
  calls: Array<[number, number]> = [];
  setValueAtTime(v: number, t: number): void {
    this.calls.push([v, t]);
    this.value = v;
  }
}

function fakeWindow() {
  const created: { osc?: Record<string, unknown>; gain?: { gain: FakeGainParam; to: unknown }; dest?: { stream: object }; ctx?: { closed: boolean } } = {};
  const chain: string[] = [];
  class FakeAudioContext {
    state = 'running';
    currentTime = 1.5;
    closed = false;
    constructor() {
      created.ctx = this;
    }
    createOscillator() {
      const osc = {
        type: 'square',
        frequency: { value: 0 },
        started: false,
        to: null as unknown,
        connect(n: unknown) {
          chain.push('osc->gain');
          this.to = n;
          return n;
        },
        start() {
          this.started = true;
        },
      };
      created.osc = osc;
      return osc;
    }
    createGain() {
      const g = { gain: new FakeGainParam(), to: null as unknown, connect(n: unknown) { chain.push('gain->dest'); this.to = n; return n; } };
      created.gain = g;
      return g;
    }
    createMediaStreamDestination() {
      const d = { stream: { id: 'synthetic' } };
      created.dest = d;
      return d;
    }
    async resume() {
      this.state = 'running';
    }
    async close() {
      this.closed = true;
      this.state = 'closed';
    }
  }
  const win = { AudioContext: FakeAudioContext } as unknown as Window & typeof globalThis;
  return { win, created, chain };
}

describe('test-only synthetic audio', () => {
  it('banner text is exact', () => {
    expect(TEST_AUDIO_BANNER).toBe('Synthetic test audio — not a microphone');
  });

  it('sine amplitude for a target RMS: A = sqrt(2) * 10^(dbfs/20)', () => {
    expect(gainForDbfs(-20)).toBeCloseTo(Math.SQRT2 * 0.1, 12);
    expect(gainForDbfs(0)).toBeCloseTo(Math.SQRT2, 12);
    expect(gainForDbfs(-60)).toBeCloseTo(Math.SQRT2 * 0.001, 12);
    expect(gainForDbfs(Number.NaN)).toBe(0);
  });

  it('exposes window.__atrTestAudio and builds oscillator -> gain -> MediaStreamAudioDestination', async () => {
    const { win, created, chain } = fakeWindow();
    const handle = installTestAudio(win);
    expect(win.__atrTestAudio).toBe(handle.hooks);
    const stream = await handle.createStream();
    expect(stream).toBe(created.dest?.stream);
    expect(chain).toEqual(['osc->gain', 'gain->dest']);
    expect(created.osc).toMatchObject({ type: 'sine', started: true });
    expect(created.gain?.to).toBe(created.dest);
  });

  it('setLevelDbfs / setSilence drive the gain, before and after the stream exists', async () => {
    const { win, created } = fakeWindow();
    const handle = installTestAudio(win);
    handle.hooks.setLevelDbfs(-30); // before the stream exists: remembered
    await handle.createStream();
    expect(created.gain?.gain.value).toBeCloseTo(gainForDbfs(-30), 12);
    handle.hooks.setLevelDbfs(-12);
    expect(created.gain?.gain.value).toBeCloseTo(gainForDbfs(-12), 12);
    handle.hooks.setSilence();
    expect(created.gain?.gain.value).toBe(0);
    expect(handle.hooks.getState().levelDbfs).toBeNull();
    expect(() => handle.hooks.setLevelDbfs(Number.NaN)).toThrow(TypeError);
    expect(() => handle.hooks.setLevelDbfs(Infinity)).toThrow(TypeError);
  });

  it('starts silent and closes the previous context when a new stream is made', async () => {
    const { win, created } = fakeWindow();
    const handle = installTestAudio(win);
    await handle.createStream();
    expect(created.gain?.gain.value).toBe(0);
    const first = created.ctx;
    await handle.createStream();
    expect(first?.closed).toBe(true);
    expect(created.ctx).not.toBe(first);
    void vi;
  });
});

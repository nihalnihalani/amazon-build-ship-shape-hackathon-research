import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AudioContextLike,
  type CaptureDeps,
  classifyOpenError,
  createAudioPort,
  type WorkletNodeLike,
} from '../src/audio/capture.js';
import type { LevelFrame } from '../src/ports/audio.js';

// ---- fakes for the browser audio objects ---------------------------------------------
class FakeTrack {
  stopped = false;
  settings: MediaTrackSettings = { autoGainControl: false, echoCancellation: false, noiseSuppression: false, sampleRate: 48000, channelCount: 1 };
  private listeners = new Map<string, Set<() => void>>();
  getSettings(): MediaTrackSettings {
    return this.settings;
  }
  stop(): void {
    this.stopped = true;
  }
  addEventListener(type: string, l: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(l);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  fire(type: string): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

class FakeStream {
  constructor(readonly track = new FakeTrack()) {}
  getTracks(): FakeTrack[] {
    return [this.track];
  }
  getAudioTracks(): FakeTrack[] {
    return [this.track];
  }
}

class FakeNode implements WorkletNodeLike {
  posted: Array<Record<string, unknown>> = [];
  connected: unknown[] = [];
  disconnected = false;
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: (m: unknown): void => {
      this.posted.push(m as Record<string, unknown>);
    },
  };
  connect(d: unknown): unknown {
    this.connected.push(d);
    return d;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** The worklet delivers one reduced frame for the current run. */
  frame(index: number, rms: number, extra: { clipped?: number; nonFinite?: boolean; runId?: number } = {}): void {
    const begin = [...this.posted].reverse().find((m) => m['type'] === 'begin');
    const runId = extra.runId ?? (begin?.['runId'] as number);
    this.port.onmessage?.({
      data: { type: 'frame', runId, index, sumSq: 2400 * rms * rms, count: 2400, clipped: extra.clipped ?? 0, nonFinite: extra.nonFinite ?? false },
    });
  }
  get lastBegin(): Record<string, unknown> | undefined {
    return [...this.posted].reverse().find((m) => m['type'] === 'begin');
  }
}

class FakeCtx implements AudioContextLike {
  sampleRate = 48000;
  state = 'running';
  destination = { name: 'destination' };
  modules: string[] = [];
  closed = false;
  sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  addModuleError: Error | null = null;
  audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      if (this.addModuleError) throw this.addModuleError;
      this.modules.push(url);
    },
  };
  createMediaStreamSource(): { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
    const s = { connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(s);
    return s;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }
}

const dom = (name: string): DOMException => new DOMException('x', name);

interface Rig {
  deps: CaptureDeps;
  ctx: FakeCtx;
  node: FakeNode;
  stream: FakeStream;
  gum: ReturnType<typeof vi.fn>;
  pending: { resolve(): void; reject(e: unknown): void } | null;
  port: ReturnType<typeof createAudioPort>;
}

function rig(opts: { secure?: boolean; mediaDevices?: boolean; deferred?: boolean; error?: unknown } = {}): Rig {
  const ctx = new FakeCtx();
  const node = new FakeNode();
  const stream = new FakeStream();
  const r: Rig = { ctx, node, stream, pending: null } as unknown as Rig;
  r.gum = vi.fn(() => {
    if (opts.error) return Promise.reject(opts.error);
    if (opts.deferred) {
      return new Promise<MediaStream>((resolve, reject) => {
        r.pending = { resolve: () => resolve(stream as unknown as MediaStream), reject };
      });
    }
    return Promise.resolve(stream as unknown as MediaStream);
  });
  r.deps = {
    mediaDevices:
      opts.mediaDevices === false
        ? undefined
        : { getUserMedia: r.gum as never, getSupportedConstraints: () => ({ autoGainControl: true, echoCancellation: true, noiseSuppression: false } as MediaTrackSupportedConstraints) },
    createAudioContext: () => ctx,
    createWorkletNode: () => node,
    workletUrl: '/worklet.js',
    isSecureContext: opts.secure ?? true,
    mode: 'physical_phone',
  };
  r.port = createAudioPort(r.deps);
  return r;
}

const states = (r: Rig): string[] => {
  const seen: string[] = [r.port.getSnapshot().state];
  r.port.subscribe((s) => seen.push(s.state));
  return seen;
};

describe('opening the microphone', () => {
  it('does nothing until open() is called, then asks for processing off', async () => {
    const r = rig();
    expect(r.gum).not.toHaveBeenCalled();
    expect(r.port.getSnapshot().state).toBe('off');
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(1);
    expect(r.gum).toHaveBeenCalledWith({ audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false }, video: false });
    expect(r.ctx.modules).toEqual(['/worklet.js']);
  });

  it('is permission_pending while the prompt is open and open_idle only afterwards, with browser-reported settings', async () => {
    const r = rig({ deferred: true });
    const seen = states(r);
    const opening = r.port.open();
    await Promise.resolve();
    expect(r.port.getSnapshot().state).toBe('permission_pending');
    r.pending?.resolve();
    await opening;
    expect(seen).toEqual(['off', 'permission_pending', 'open_idle']);
    const s = r.port.getSnapshot();
    expect(s.settings).toEqual({ auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 });
    expect(s.supported).toEqual({ auto_gain_control: true, echo_cancellation: true, noise_suppression: false });
  });

  it('reports unknown (null) for settings the browser does not give', async () => {
    const r = rig();
    r.stream.track.settings = {};
    await r.port.open();
    expect(r.port.getSnapshot().settings).toEqual({ auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: 48000, channel_count: null });
  });

  it('a second open() while open is a no-op', async () => {
    const r = rig();
    await r.port.open();
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(1);
  });

  it('relaxConstraints asks for the browser defaults', async () => {
    const r = rig();
    await r.port.open({ relaxConstraints: true });
    expect(r.gum).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['PermissionDeniedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'no_input'],
    ['DevicesNotFoundError', 'no_input'],
    ['NotReadableError', 'input_busy'],
    ['TrackStartError', 'input_busy'],
    ['AbortError', 'input_busy'],
    ['OverconstrainedError', 'constraints_unsupported'],
    ['TypeError', 'error'],
  ])('maps %s to %s and releases the audio context', async (name, expected) => {
    const r = rig({ error: dom(name) });
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe(expected);
    expect(r.port.getSnapshot().detail).toBe(name);
    expect(r.ctx.closed).toBe(true);
  });

  it('classifyOpenError copes with non-error values', () => {
    expect(classifyOpenError(undefined).state).toBe('error');
    expect(classifyOpenError('boom').state).toBe('error');
    expect(classifyOpenError({ name: 'NotAllowedError' }).state).toBe('permission_denied');
  });

  it('can retry after a failure', async () => {
    const r = rig({ error: dom('NotAllowedError') });
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe('permission_denied');
    r.gum.mockImplementationOnce(() => Promise.resolve(r.stream as unknown as MediaStream));
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });

  it('insecure context: never calls getUserMedia and says why', async () => {
    const r = rig({ secure: false });
    await r.port.open();
    expect(r.gum).not.toHaveBeenCalled();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'insecure_context' });
  });

  it('no mediaDevices at all', async () => {
    const r = rig({ mediaDevices: false });
    await r.port.open();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'no_media_devices' });
  });

  it('cancelling a pending prompt returns to off; a stream that arrives later is stopped immediately', async () => {
    const r = rig({ deferred: true });
    const opening = r.port.open();
    await Promise.resolve();
    r.port.cancelOpen();
    expect(r.port.getSnapshot().state).toBe('off');
    r.pending?.resolve();
    await opening;
    expect(r.port.getSnapshot().state).toBe('off');
    expect(r.stream.track.stopped).toBe(true);
    expect(r.ctx.closed).toBe(true);
  });

  it('a failing audio graph (worklet cannot load) is an error and releases the stream', async () => {
    const r = rig();
    r.ctx.addModuleError = new Error('blocked');
    await r.port.open();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'audio_graph_failed' });
    expect(r.stream.track.stopped).toBe(true);
    expect(r.ctx.closed).toBe(true);
  });
});

describe('observed measuring state', () => {
  it('stays open_idle after a run is requested and becomes measuring only when the first frame arrives', async () => {
    const r = rig();
    await r.port.open();
    const seen = states(r);
    const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    expect(r.port.getSnapshot().state).toBe('open_idle'); // requested, nothing observed yet
    expect(r.node.lastBegin).toMatchObject({ type: 'begin', frameSize: 2400 });
    r.node.frame(0, 1e-3);
    expect(r.port.getSnapshot().state).toBe('measuring');
    for (let i = 1; i < 100; i++) r.node.frame(i, 1e-3);
    const result = await run.result;
    expect(seen).toEqual(['open_idle', 'measuring', 'open_idle']);
    expect(result).toMatchObject({ purpose: 'quiet_check', valid: true, frame_count: 100, expected_frames: 100, coverage: 1 });
    expect(result?.floor_dbfs).toBeCloseTo(-60, 6);
  });

  it('frames from an old run are ignored', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    r.node.frame(0, 1e-3, { runId: 999 });
    expect(r.port.getSnapshot().state).toBe('open_idle');
    run.abort('discard');
  });

  it('refuses to start a run when the microphone is not open, or when one is active', async () => {
    const r = rig();
    expect(() => r.port.precheck({ purpose: 'pre_window', durationMs: 2000 })).toThrow('mic_not_open');
    await r.port.open();
    r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    expect(() => r.port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined)).toThrow('run_active');
  });
});

describe('window runs', () => {
  const win = async (r: Rig, frames: LevelFrame[] = []) => {
    await r.port.open();
    return r.port.window({ kind: 'vowel', maxDurationMs: 6000, vadFloorDbfs: -60 }, (f) => frames.push(f));
  };

  it('emits one level per finite frame with sample-clock time, provisional activity and clip flags', async () => {
    const r = rig();
    const got: LevelFrame[] = [];
    await win(r, got);
    r.node.frame(0, 1e-3); // -60 dBFS: not >= 6 dB above the floor
    r.node.frame(1, 1e-2); // -40 dBFS: active
    r.node.frame(2, 1e-2, { clipped: 12 }); // clipped frame
    r.node.frame(3, 0, { nonFinite: true }); // dropout: no level is invented
    r.node.frame(4, 1e-2);
    expect(got.map((f) => f.frameIndex)).toEqual([0, 1, 2, 4]);
    expect(got.map((f) => f.tAudioMs)).toEqual([0, 50, 100, 200]);
    expect(got.map((f) => f.active)).toEqual([false, true, true, true]);
    expect(got[2]?.clipped).toBe(true);
    expect(got[1]?.dbfs).toBeCloseTo(-40, 6);
  });

  it('closes by itself after max duration (frame count) and sends no further frames', async () => {
    const r = rig();
    const got: LevelFrame[] = [];
    const run = await win(r, got);
    for (let i = 0; i < 125; i++) r.node.frame(i, 1e-2);
    const result = await run.result;
    expect(got).toHaveLength(120); // floor(6000 / 50)
    expect(result).toMatchObject({ kind: 'vowel', frame_count: 120, expected_frames: 120, valid: true });
    expect(r.port.getSnapshot().state).toBe('open_idle');
    expect(r.node.posted.some((m) => m['type'] === 'end')).toBe(true);
  });

  it('early stop summarizes the frames received so far', async () => {
    const r = rig();
    const run = await win(r);
    for (let i = 0; i < 30; i++) r.node.frame(i, 1e-2);
    run.stop();
    const result = await run.result;
    expect(result).toMatchObject({ frame_count: 30, expected_frames: 30, valid: true, active_ms: 1500 });
  });

  it('abort(discard) returns nothing and resolves result with null', async () => {
    const r = rig();
    const run = await win(r);
    r.node.frame(0, 1e-2);
    expect(run.abort('discard')).toBeNull();
    expect(await run.result).toBeNull();
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });

  it('abort(interrupted) returns an invalid summary with reason interrupted', async () => {
    const r = rig();
    const run = await win(r);
    for (let i = 0; i < 10; i++) r.node.frame(i, 1e-2);
    const payload = run.abort('interrupted');
    expect(payload).toMatchObject({ valid: false, invalid_reason: 'interrupted', frame_count: 10, expected_frames: 120 });
    expect(await run.result).toBeNull();
  });

  it('aborting an ended run is harmless', async () => {
    const r = rig();
    const run = await win(r);
    run.stop();
    expect(run.abort('interrupted')).toBeNull();
  });
});

describe('watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a stalled audio clock closes the run as low coverage instead of hanging', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    for (let i = 0; i < 10; i++) r.node.frame(i, 1e-3);
    vi.advanceTimersByTime(6999);
    expect(r.port.getSnapshot().state).toBe('measuring');
    vi.advanceTimersByTime(1);
    const result = await run.result;
    expect(result).toMatchObject({ valid: false, invalid_reason: 'low_coverage', frame_count: 10, expected_frames: 100 });
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });
});

describe('shutdown completeness', () => {
  it('close() stops tracks, disconnects the graph, closes the context, drops handlers and clears settings', async () => {
    const r = rig();
    await r.port.open();
    const track = r.stream.track;
    expect(track.listenerCount).toBe(3);
    const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    r.node.frame(0, 1e-3);
    r.port.close();
    expect(track.stopped).toBe(true);
    expect(track.listenerCount).toBe(0);
    expect(r.node.disconnected).toBe(true);
    expect(r.node.posted.some((m) => m['type'] === 'dispose')).toBe(true);
    expect(r.node.port.onmessage).toBeNull();
    expect(r.ctx.sources[0]?.disconnect).toHaveBeenCalled();
    expect(r.ctx.closed).toBe(true);
    expect(await run.result).toBeNull();
    expect(r.port.getSnapshot()).toMatchObject({
      state: 'off',
      settings: { auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null },
    });
  });

  it('close() is idempotent and works before open', async () => {
    const r = rig();
    r.port.close();
    r.port.close();
    await r.port.open();
    r.port.close();
    r.port.close();
    expect(r.port.getSnapshot().state).toBe('off');
  });

  it('close() during a pending prompt cancels it (stream stopped on arrival)', async () => {
    const r = rig({ deferred: true });
    const opening = r.port.open();
    await Promise.resolve();
    r.port.close();
    r.pending?.resolve();
    await opening;
    expect(r.stream.track.stopped).toBe(true);
    expect(r.port.getSnapshot().state).toBe('off');
  });

  it('can be opened again after close', async () => {
    const r = rig();
    await r.port.open();
    r.port.close();
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe('open_idle');
    expect(r.gum).toHaveBeenCalledTimes(2);
  });
});

describe('device-side interruptions', () => {
  it('track ended: interrupted result is delivered, everything released, state error', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    for (let i = 0; i < 5; i++) r.node.frame(i, 1e-3);
    r.stream.track.fire('ended');
    const result = await run.result;
    expect(result).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'track_ended' });
    expect(r.stream.track.stopped).toBe(true);
    expect(r.ctx.closed).toBe(true);
  });

  it('track muted: the run is interrupted, state error, and unmute recovers to open_idle', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined);
    r.node.frame(0, 1e-2);
    r.stream.track.fire('mute');
    expect(await run.result).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'track_muted' });
    expect(r.stream.track.stopped).toBe(false); // still ours to close
    r.stream.track.fire('unmute');
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });

  it('events after close() do nothing', async () => {
    const r = rig();
    await r.port.open();
    const track = r.stream.track;
    r.port.close();
    track.fire('ended');
    expect(r.port.getSnapshot().state).toBe('off');
  });
});

describe('privacy of the adapter', () => {
  it('only numbers are ever posted to the worklet and no sample buffers are retained', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    for (let i = 0; i < 40; i++) r.node.frame(i, 1e-3);
    await run.result;
    for (const m of r.node.posted) {
      for (const v of Object.values(m)) expect(['string', 'number', 'boolean']).toContain(typeof v);
    }
  });
});

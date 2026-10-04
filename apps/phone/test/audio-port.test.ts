import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioPort } from '../src/ports/audio.js';
import type { AudioPort, AudioPortDeps, LevelFrame } from '../src/ports/audio.js';

/**
 * The port runs the REAL @atr/phone-mic-meter capture adapter and DSP against fake browser
 * audio objects (a real microphone and AudioWorklet are exercised only by the Playwright
 * smoke test with synthetic audio, and by pending real-phone checks).
 */

class FakeTrack extends EventTarget {
  kind = 'audio';
  stopCalls = 0;
  constructor(public settings: Record<string, unknown> = {}) {
    super();
  }
  getSettings(): Record<string, unknown> {
    return this.settings;
  }
  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeNode {
  disconnectCalls = 0;
  connections: unknown[] = [];
  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeWorkletNode extends FakeNode {
  posted: Array<Record<string, unknown>> = [];
  portClosed = 0;
  port = {
    postMessage: (m: unknown): void => {
      this.posted.push(m as Record<string, unknown>);
    },
    onmessage: null as ((e: { data: unknown }) => void) | null,
    close: (): void => {
      this.portClosed += 1;
    },
  };
  constructor(readonly context: FakeContext) {
    super();
    context.workletNodes.push(this);
  }
  get epoch(): number {
    const start = [...this.posted].reverse().find((m) => m['cmd'] === 'start');
    return (start?.['epoch'] as number) ?? 0;
  }
  /** The worklet delivers one reduced frame (constant level `value`, linear). */
  frame(index: number, value: number, extra: Record<string, unknown> = {}): void {
    this.port.onmessage?.({
      data: {
        firstSampleIndex: index * 2400,
        n: 2400,
        sumSquares: 2400 * value * value,
        peak: Math.abs(value),
        clippedCount: 0,
        nonfinite: false,
        epoch: this.epoch,
        ...extra,
      },
    });
  }
}

class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  state = 'suspended';
  sampleRate = 48000;
  closeCalls = 0;
  destination = new FakeNode();
  workletNodes: FakeWorkletNode[] = [];
  gains: Array<FakeNode & { gain: { value: number } }> = [];
  addModuleCalls: string[] = [];
  audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.addModuleCalls.push(url);
    },
  };
  constructor() {
    super();
    FakeContext.instances.push(this);
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
  createMediaStreamSource(): FakeNode {
    return new FakeNode();
  }
  createGain(): FakeNode & { gain: { value: number } } {
    const g = Object.assign(new FakeNode(), { gain: { value: 1 } });
    this.gains.push(g);
    return g;
  }
}

const dom = (name: string, extra: Record<string, unknown> = {}): DOMException => Object.assign(new DOMException('x', name), extra);

interface Rig {
  port: AudioPort;
  track: FakeTrack;
  stream: FakeStream;
  gum: ReturnType<typeof vi.fn>;
  ctx: () => FakeContext;
  node: () => FakeWorkletNode;
  pending: { resolve(): void } | null;
  deps: AudioPortDeps;
}

function rig(
  opts: {
    secure?: boolean;
    noMediaDevices?: boolean;
    deferred?: boolean;
    error?: unknown;
    supportedApi?: boolean;
    settings?: Record<string, unknown>;
    synthetic?: boolean;
  } = {},
): Rig {
  FakeContext.instances = [];
  const track = new FakeTrack(opts.settings ?? { autoGainControl: false, echoCancellation: false, noiseSuppression: false, sampleRate: 48000, channelCount: 1 });
  const stream = new FakeStream([track]);
  const r = { track, stream, pending: null } as unknown as Rig;
  r.gum = vi.fn((_c: unknown) => {
    if (opts.error) return Promise.reject(opts.error);
    if (opts.deferred) {
      return new Promise<MediaStream>((resolve) => {
        r.pending = { resolve: () => resolve(stream as unknown as MediaStream) };
      });
    }
    return Promise.resolve(stream as unknown as MediaStream);
  });
  r.deps = {
    mediaDevices: opts.noMediaDevices
      ? undefined
      : {
          getUserMedia: r.gum as never,
          ...(opts.supportedApi === false
            ? {}
            : { getSupportedConstraints: () => ({ autoGainControl: true, echoCancellation: true, noiseSuppression: false }) as MediaTrackSupportedConstraints }),
        },
    AudioContextCtor: FakeContext as never,
    AudioWorkletNodeCtor: FakeWorkletNode as never,
    workletModuleUrl: './frame-processor.js?v=test',
    isSecureContext: opts.secure ?? true,
    mode: opts.synthetic ? 'fixture_replay' : 'physical_phone',
    ...(opts.synthetic ? { inputOverride: () => Promise.resolve(stream as unknown as MediaStream) } : {}),
  };
  r.port = createAudioPort(r.deps);
  r.ctx = () => FakeContext.instances[FakeContext.instances.length - 1] as FakeContext;
  r.node = () => r.ctx().workletNodes[0] as FakeWorkletNode;
  return r;
}

const seenStates = (r: Rig): string[] => {
  const seen: string[] = [r.port.getSnapshot().state];
  r.port.subscribe((s) => seen.push(s.state));
  return seen;
};
const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('opening the microphone', () => {
  it('does nothing until open(), then asks the browser for processing off and loads the worklet by module URL', async () => {
    const blobSpy = vi.spyOn(URL, 'createObjectURL');
    const r = rig();
    expect(r.gum).not.toHaveBeenCalled();
    expect(r.port.getSnapshot().state).toBe('off');
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(1);
    expect(r.gum.mock.calls[0]?.[0]).toMatchObject({ audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false } });
    expect(r.ctx().addModuleCalls).toEqual(['./frame-processor.js?v=test']);
    expect(blobSpy).not.toHaveBeenCalled(); // no Blob URL: the CSP can stay script-src 'self'
    blobSpy.mockRestore();
  });

  it('is permission_pending while the prompt is open, open_idle afterwards, with browser-reported settings', async () => {
    const r = rig({ deferred: true });
    const seen = seenStates(r);
    const opening = r.port.open();
    await tick();
    expect(r.port.getSnapshot().state).toBe('permission_pending');
    r.pending?.resolve();
    await opening;
    expect(seen).toEqual(['off', 'permission_pending', 'open_idle']);
    expect(r.port.getSnapshot().settings).toEqual({ auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 });
    expect(r.port.getSnapshot().supported).toEqual({ auto_gain_control: true, echo_cancellation: true, noise_suppression: false });
  });

  it('settings the browser does not report stay null (unknown), and missing getSupportedConstraints is null, not false', async () => {
    const r = rig({ settings: {}, supportedApi: false });
    await r.port.open();
    expect(r.port.getSnapshot().settings).toEqual({ auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null });
    expect(r.port.getSnapshot().supported).toEqual({ auto_gain_control: null, echo_cancellation: null, noise_suppression: null });
  });

  it('a second open() while open is a no-op', async () => {
    const r = rig();
    await r.port.open();
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(1);
  });

  it('relaxConstraints asks for the browser defaults once, then goes back to the requested settings', async () => {
    const r = rig();
    await r.port.open({ relaxConstraints: true });
    expect(r.gum.mock.calls[0]?.[0]).toEqual({ audio: true, video: false });
    await r.port.close();
    await r.port.open();
    expect(r.gum.mock.calls[1]?.[0]).toMatchObject({ audio: { autoGainControl: false } });
  });

  it.each([
    [dom('NotAllowedError'), 'permission_denied'],
    [dom('PermissionDeniedError'), 'permission_denied'],
    [dom('NotFoundError'), 'no_input'],
    [dom('NotReadableError'), 'input_busy'],
    [dom('AbortError'), 'input_busy'],
    [dom('OverconstrainedError', { constraint: 'channelCount' }), 'constraints_unsupported'],
    [dom('TypeError'), 'error'],
  ])('maps %s to %s and releases the audio context', async (error, expected) => {
    const r = rig({ error });
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe(expected);
    expect(r.ctx().closeCalls).toBeGreaterThan(0);
    expect(r.ctx().state).toBe('closed');
  });

  it('a failed attempt can be retried', async () => {
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

  it('no mediaDevices in a secure context is reported as such', async () => {
    const r = rig({ noMediaDevices: true });
    await r.port.open();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'no_media_devices' });
  });

  it('cancelling a pending prompt returns to off; a stream that arrives later is stopped immediately', async () => {
    const r = rig({ deferred: true });
    const opening = r.port.open();
    await tick();
    r.port.cancelOpen();
    await tick();
    expect(r.port.getSnapshot().state).toBe('off');
    r.pending?.resolve();
    await opening;
    await tick();
    expect(r.port.getSnapshot().state).toBe('off');
    expect(r.track.stopCalls).toBeGreaterThan(0);
    expect(r.ctx().state).toBe('closed');
  });

  it('after cancelling a prompt that is never answered, Start can be used again straight away (no wait on the dead request)', async () => {
    const r = rig();
    const lateStreams: Array<() => void> = [];
    r.gum.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          lateStreams.push(() => resolve(r.stream as unknown as MediaStream));
        }),
    );
    const firstOpen = r.port.open();
    await tick();
    expect(r.port.getSnapshot().state).toBe('permission_pending');
    r.port.cancelOpen();
    expect(r.port.getSnapshot().state).toBe('off');
    // the first request is still dangling in the browser; a new tap must still work
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(2);
    expect(r.port.getSnapshot().state).toBe('open_idle');
    // if the abandoned prompt is finally answered, its stream is stopped and the live session is untouched
    const liveStops = r.track.stopCalls;
    lateStreams[0]?.();
    await firstOpen;
    await tick();
    expect(r.track.stopCalls).toBeGreaterThan(liveStops); // the late stream (same fake track) was stopped by the package
    r.track.stopCalls = 0;
  });

  it('close() during a pending prompt also leaves the port usable', async () => {
    const r = rig();
    r.gum.mockImplementationOnce(() => new Promise<MediaStream>(() => undefined)); // never answered
    void r.port.open();
    await tick();
    await r.port.close();
    expect(r.port.getSnapshot().state).toBe('off');
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });

  it('synthetic input replaces getUserMedia (test build) and does not need a secure context', async () => {
    const r = rig({ synthetic: true, secure: false, noMediaDevices: true });
    await r.port.open();
    expect(r.gum).not.toHaveBeenCalled();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'open_idle', mode: 'fixture_replay' });
  });
});

describe('A8-03: the page makes no sound', () => {
  it('the microphone is never routed to the speakers: the only path to the destination is a zero-gain node', async () => {
    const r = rig();
    await r.port.open();
    const ctx = r.ctx();
    const node = r.node();
    expect(ctx.gains).toHaveLength(1);
    const gain = ctx.gains[0] as FakeNode & { gain: { value: number } };
    expect(gain.gain.value).toBe(0);
    expect(node.connections).toEqual([gain]); // worklet -> gain only
    expect(gain.connections).toEqual([ctx.destination]); // gain -> destination
  });
});

describe('observed measuring state', () => {
  it('stays open_idle when a run is requested and becomes measuring only when the first frame arrives', async () => {
    const r = rig();
    await r.port.open();
    const seen = seenStates(r);
    const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    expect(r.node().posted.at(-1)).toMatchObject({ cmd: 'start' });
    expect(r.port.getSnapshot().state).toBe('open_idle'); // requested, nothing observed
    r.node().frame(0, 1e-3);
    expect(r.port.getSnapshot().state).toBe('measuring');
    for (let i = 1; i < 100; i++) r.node().frame(i, 1e-3);
    const result = await run.result;
    expect(seen).toEqual(['open_idle', 'measuring', 'open_idle']);
    expect(result).toMatchObject({ purpose: 'quiet_check', valid: true, frame_count: 100, expected_frames: 100, coverage: 1 });
    expect(result?.floor_dbfs).toBeCloseTo(-60, 6);
  });

  it('a run that gets no frames never shows measuring', async () => {
    const r = rig();
    await r.port.open();
    const seen = seenStates(r);
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    expect(run.abort('discard')).toBeNull();
    expect(seen).toEqual(['open_idle']);
  });

  it('frames from a previous measurement epoch are ignored by the adapter', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    r.node().frame(0, 1e-3, { epoch: 999 });
    expect(r.port.getSnapshot().state).toBe('open_idle');
    run.abort('discard');
  });

  it('refuses a run when the microphone is not open or another run is active', async () => {
    const r = rig();
    expect(() => r.port.precheck({ purpose: 'pre_window', durationMs: 2000 })).toThrow('mic_not_open');
    expect(() => r.port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined)).toThrow('mic_not_open');
    await r.port.open();
    r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    expect(() => r.port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined)).toThrow();
  });
});

describe('window runs', () => {
  const open = async (r: Rig, frames: LevelFrame[] = [], kind: 'vowel' | 'phrase' | 'calibration' = 'vowel', max = 6000) => {
    await r.port.open();
    return r.port.window({ kind, maxDurationMs: max, vadFloorDbfs: -60 }, (f) => frames.push(f));
  };

  it('emits one level per frame with sample-clock time, provisional activity and clip flags', async () => {
    const r = rig();
    const got: LevelFrame[] = [];
    await open(r, got);
    r.node().frame(0, 1e-3); // -60 dBFS: not >= 6 dB above the floor
    r.node().frame(1, 1e-2); // -40 dBFS
    r.node().frame(2, 1e-2, { clippedCount: 12 }); // clipped frame
    expect(got.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
    expect(got.map((f) => f.tAudioMs)).toEqual([0, 50, 100]);
    expect(got[0]?.active).toBe(false);
    expect(got[1]?.active).toBe(true);
    expect(got[2]?.clipped).toBe(true);
    expect(got[1]?.dbfs).toBeCloseTo(-40, 6);
  });

  it('closes by itself at the maximum duration and sends no further frames', async () => {
    const r = rig();
    const got: LevelFrame[] = [];
    const run = await open(r, got);
    for (let i = 0; i < 125; i++) r.node().frame(i, 1e-2);
    const result = await run.result;
    expect(got).toHaveLength(120); // floor(6000 / 50)
    expect(result).toMatchObject({ kind: 'vowel', frame_count: 120, expected_frames: 120, valid: true });
    expect(r.port.getSnapshot().state).toBe('open_idle');
    expect(r.node().posted.some((m) => m['cmd'] === 'stop')).toBe(true);
  });

  it('early stop summarizes what was captured', async () => {
    const r = rig();
    const run = await open(r);
    for (let i = 0; i < 30; i++) r.node().frame(i, 1e-2);
    run.stop();
    expect(await run.result).toMatchObject({ frame_count: 30, expected_frames: 30, valid: true, active_ms: 1500 });
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });

  it('abort(discard) returns nothing; abort(interrupted) returns an invalid summary', async () => {
    const r = rig();
    const run = await open(r);
    r.node().frame(0, 1e-2);
    expect(run.abort('discard')).toBeNull();
    expect(await run.result).toBeNull();
    expect(r.port.getSnapshot().state).toBe('open_idle');
    const run2 = r.port.window({ kind: 'vowel', maxDurationMs: 6000, vadFloorDbfs: -60 }, () => undefined);
    for (let i = 0; i < 10; i++) r.node().frame(i, 1e-2);
    expect(run2.abort('interrupted')).toMatchObject({ valid: false, invalid_reason: 'interrupted', frame_count: 10 });
    expect(run2.abort('interrupted')).toBeNull(); // already ended
  });

  it('a stalled audio clock closes the window as low coverage (watchdog)', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      const run = await open(r);
      for (let i = 0; i < 10; i++) r.node().frame(i, 1e-2);
      vi.advanceTimersByTime(7999);
      expect(r.port.getSnapshot().state).toBe('measuring');
      vi.advanceTimersByTime(1);
      expect(await run.result).toMatchObject({ valid: false, invalid_reason: 'low_coverage', frame_count: 10, expected_frames: 120 });
      expect(r.port.getSnapshot().state).toBe('open_idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stalled precheck is closed by the watchdog too', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      await r.port.open();
      const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
      for (let i = 0; i < 10; i++) r.node().frame(i, 1e-3);
      vi.advanceTimersByTime(7000);
      expect(await run.result).toMatchObject({ valid: false, invalid_reason: 'low_coverage', frame_count: 10, expected_frames: 100 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shutdown completeness', () => {
  it('close() stops tracks, closes the worklet port, disconnects nodes, closes the context and clears settings', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'quiet_check', durationMs: 5000 });
    r.node().frame(0, 1e-3);
    const node = r.node();
    await r.port.close();
    expect(r.track.stopCalls).toBe(1);
    expect(node.portClosed).toBe(1);
    expect(node.disconnectCalls).toBeGreaterThan(0);
    expect(node.posted.some((m) => m['cmd'] === 'close')).toBe(true);
    expect(r.ctx().state).toBe('closed');
    expect(await run.result).toBeNull();
    expect(r.port.getSnapshot()).toMatchObject({
      state: 'off',
      settings: { auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null },
    });
  });

  it('close() is idempotent, works before open, and the mic can be opened again', async () => {
    const r = rig();
    await r.port.close();
    await r.port.open();
    await Promise.all([r.port.close(), r.port.close()]);
    expect(r.port.getSnapshot().state).toBe('off');
    await r.port.open();
    expect(r.port.getSnapshot().state).toBe('open_idle');
    expect(r.gum).toHaveBeenCalledTimes(2);
  });

  it('no frames are processed after close', async () => {
    const r = rig();
    await r.port.open();
    const got: LevelFrame[] = [];
    r.port.window({ kind: 'vowel', maxDurationMs: 6000, vadFloorDbfs: -60 }, (f) => got.push(f));
    const node = r.node();
    await r.port.close();
    node.port.onmessage?.({ data: { firstSampleIndex: 0, n: 2400, sumSquares: 1, peak: 1, clippedCount: 0, nonfinite: false, epoch: 1 } });
    expect(got).toHaveLength(0);
  });
});

describe('device-side interruptions', () => {
  it('track ended: interrupted result delivered, resources released, state error', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    for (let i = 0; i < 5; i++) r.node().frame(i, 1e-3);
    r.track.dispatchEvent(new Event('ended'));
    expect(await run.result).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    await tick();
    expect(r.port.getSnapshot()).toMatchObject({ state: 'error', detail: 'track_ended' });
    expect(r.track.stopCalls).toBeGreaterThan(0);
    expect(r.ctx().state).toBe('closed');
  });

  it('track muted: the run is interrupted, state shows input_busy/track_muted, unmute recovers, and Start can reset it', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.window({ kind: 'phrase', maxDurationMs: 8000, vadFloorDbfs: -60 }, () => undefined);
    r.node().frame(0, 1e-2);
    r.track.dispatchEvent(new Event('mute'));
    expect(await run.result).toMatchObject({ valid: false, invalid_reason: 'interrupted' });
    expect(r.port.getSnapshot()).toMatchObject({ state: 'input_busy', detail: 'track_muted' });
    r.track.dispatchEvent(new Event('unmute'));
    expect(r.port.getSnapshot().state).toBe('open_idle');
    // muted again, then the user taps Start: the old session is released and a fresh one opens
    r.track.dispatchEvent(new Event('mute'));
    expect(r.port.getSnapshot().state).toBe('input_busy');
    await r.port.open();
    expect(r.gum).toHaveBeenCalledTimes(2);
    expect(r.port.getSnapshot().state).toBe('open_idle');
  });
});

describe('what crosses the worklet boundary', () => {
  it('only control scalars are posted to the worklet and no sample buffers are kept', async () => {
    const r = rig();
    await r.port.open();
    const run = r.port.precheck({ purpose: 'pre_window', durationMs: 2000 });
    for (let i = 0; i < 40; i++) r.node().frame(i, 1e-3);
    await run.result;
    for (const m of r.node().posted) {
      for (const v of Object.values(m)) expect(['string', 'number', 'boolean']).toContain(typeof v);
    }
  });
});

beforeEach(() => {
  FakeContext.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

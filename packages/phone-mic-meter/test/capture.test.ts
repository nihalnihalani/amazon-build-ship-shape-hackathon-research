import { describe, expect, it, vi } from 'vitest';
import { classifyMicError } from '../src/browser/errors.js';
import {
  REQUESTED_AUDIO_CONSTRAINTS,
  createMicCapture,
  readSupportedConstraints,
  readTrackSettings,
} from '../src/browser/capture.js';
import type { MicCapture, MicCaptureOptions, MicCaptureState, MicInterruptReason } from '../src/browser/capture.js';
import type { Frame } from '../src/frame.js';
import { FRAME_PROCESSOR_NAME } from '../src/browser/worklet-source.js';

// ---- fakes ---------------------------------------------------------------------------------

class FakeTrack extends EventTarget {
  kind = 'audio';
  stopCalls = 0;
  settings: Record<string, unknown>;
  constructor(settings: Record<string, unknown> = {}) {
    super();
    this.settings = settings;
  }
  getSettings() {
    return this.settings;
  }
  stop() {
    this.stopCalls += 1;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakeNode {
  disconnectCalls = 0;
  connects: unknown[] = [];
  constructor(readonly label: string) {}
  connect(target: unknown) {
    this.connects.push(target);
    return target;
  }
  disconnect() {
    this.disconnectCalls += 1;
  }
}

class FakeWorkletNode extends FakeNode {
  posted: unknown[] = [];
  portClosed = 0;
  port = {
    postMessage: (m: unknown) => {
      this.posted.push(m);
    },
    onmessage: null as ((e: { data: unknown }) => void) | null,
    close: () => {
      this.portClosed += 1;
    },
  };
  constructor(
    readonly context: FakeContext,
    readonly name: string,
    readonly options: unknown,
  ) {
    super('worklet');
    context.workletNodes.push(this);
  }
}

class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  state: string = 'suspended';
  sampleRate = 48000;
  closeCalls = 0;
  resumeCalls = 0;
  destination = new FakeNode('destination');
  workletNodes: FakeWorkletNode[] = [];
  nodes: FakeNode[] = [];
  addModuleCalls: string[] = [];
  audioWorklet = {
    addModule: async (url: string) => {
      this.addModuleCalls.push(url);
    },
  };
  constructor() {
    super();
    FakeContext.instances.push(this);
  }
  async resume() {
    this.resumeCalls += 1;
    this.state = 'running';
  }
  async close() {
    this.closeCalls += 1;
    this.state = 'closed';
  }
  createMediaStreamSource(_stream: unknown) {
    const n = new FakeNode('source');
    this.nodes.push(n);
    return n;
  }
  createGain() {
    const n = Object.assign(new FakeNode('gain'), { gain: { value: 1 } });
    this.nodes.push(n);
    return n;
  }
}

interface Harness {
  capture: MicCapture;
  states: MicCaptureState[];
  frames: Frame[];
  interrupts: MicInterruptReason[];
  getUserMedia: ReturnType<typeof vi.fn>;
  track: FakeTrack;
  stream: FakeStream;
  context: () => FakeContext;
  node: () => FakeWorkletNode;
}

function harness(overrides: Partial<MicCaptureOptions> = {}, settings: Record<string, unknown> | null = null): Harness {
  FakeContext.instances = [];
  const track = new FakeTrack(
    settings ?? {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      sampleRate: 48000,
      channelCount: 1,
    },
  );
  const stream = new FakeStream([track]);
  const getUserMedia = vi.fn(async (_c: unknown) => stream);
  const states: MicCaptureState[] = [];
  const frames: Frame[] = [];
  const interrupts: MicInterruptReason[] = [];
  const options = {
    mediaDevices: {
      getUserMedia,
      getSupportedConstraints: () => ({ autoGainControl: true, echoCancellation: true, noiseSuppression: true }),
    },
    AudioContextCtor: FakeContext,
    AudioWorkletNodeCtor: FakeWorkletNode,
    onState: (s: MicCaptureState) => states.push(s),
    onFrame: (f: Frame) => frames.push(f),
    onInterrupt: (r: MicInterruptReason) => interrupts.push(r),
    isSecureContext: true,
    ...overrides,
  } as unknown as MicCaptureOptions;
  const capture = createMicCapture(options);
  return {
    capture,
    states,
    frames,
    interrupts,
    getUserMedia,
    track,
    stream,
    context: () => FakeContext.instances[FakeContext.instances.length - 1] as FakeContext,
    node: () => (FakeContext.instances[FakeContext.instances.length - 1] as FakeContext).workletNodes[0] as FakeWorkletNode,
  };
}

function frameMessage(epoch: number, index: number, value: number, overrides: Record<string, unknown> = {}) {
  return {
    firstSampleIndex: index * 2400,
    n: 2400,
    sumSquares: 2400 * value * value,
    peak: Math.abs(value),
    clippedCount: 0,
    nonfinite: false,
    epoch,
    ...overrides,
  };
}

// ---- error classification ----------------------------------------------------------------

describe('classifyMicError', () => {
  const err = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });
  it.each([
    [err('NotAllowedError'), 'permission_denied', null],
    [err('PermissionDeniedError'), 'permission_denied', null],
    [err('NotFoundError'), 'no_input', null],
    [err('NotReadableError'), 'input_busy', null],
    [err('AbortError'), 'input_busy', null],
    [err('OverconstrainedError', { constraint: 'deviceId' }), 'no_input', 'device_unavailable'],
    [err('OverconstrainedError', { constraint: 'channelCount' }), 'constraints_unsupported', 'channelCount'],
    [err('OverconstrainedError'), 'constraints_unsupported', null],
    [err('SecurityError'), 'error', 'insecure_context'],
    [err('TypeError'), 'error', 'type_error'],
    [err('SomethingNew'), 'error', 'unknown_SomethingNew'],
    [new Error('x'), 'error', 'unknown_Error'],
    ['nope', 'error', 'unknown_error'],
    [null, 'error', 'unknown_error'],
  ])('%j -> %s / %s', (error, state, detail) => {
    expect(classifyMicError(error)).toEqual({ state, detail });
  });

  it('keeps the detail within 64 characters of [A-Za-z0-9_]', () => {
    const r = classifyMicError({ name: 'Weird name with spaces & symbols '.repeat(5) });
    expect(r.detail?.length).toBeLessThanOrEqual(64);
    expect(r.detail).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

describe('open() failure paths', () => {
  it.each([
    ['NotAllowedError', undefined, 'permission_denied'],
    ['NotFoundError', undefined, 'no_input'],
    ['NotReadableError', undefined, 'input_busy'],
    ['AbortError', undefined, 'input_busy'],
    ['OverconstrainedError', 'deviceId', 'no_input'],
    ['OverconstrainedError', 'sampleRate', 'constraints_unsupported'],
    ['SecurityError', undefined, 'error'],
  ])('getUserMedia rejecting with %s (%s) reports %s and leaves no open context', async (name, constraint, state) => {
    const h = harness();
    h.getUserMedia.mockRejectedValueOnce({ name, ...(constraint ? { constraint } : {}) });
    const result = await h.capture.open();
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(h.capture.getState().state).toBe(state);
    expect(h.states.map((s) => s.state)).toEqual(['permission_pending', state]);
    expect(h.context().closeCalls).toBe(1); // the pre-created AudioContext is not leaked
    expect(h.capture.getAnalysisSampleRate()).toBeNull();
  });

  it('missing mediaDevices (insecure context) is error / insecure_context without touching audio', async () => {
    const h = harness({ mediaDevices: undefined });
    const r = await h.capture.open();
    expect(r).toEqual({ ok: false, state: 'error', detail: 'insecure_context' });
    expect(FakeContext.instances).toHaveLength(0);
  });

  it('an explicitly insecure page is error / insecure_context and never calls getUserMedia', async () => {
    const h = harness({ isSecureContext: false });
    const r = await h.capture.open();
    expect(r).toEqual({ ok: false, state: 'error', detail: 'insecure_context' });
    expect(h.getUserMedia).not.toHaveBeenCalled();
    // "permission pending" is never announced when no prompt can appear
    expect(h.states.map((s) => s.state)).toEqual(['error']);
  });

  it('no AudioContext constructor is error / no_audio_context', async () => {
    const h = harness({ AudioContextCtor: undefined });
    expect(await h.capture.open()).toEqual({ ok: false, state: 'error', detail: 'no_audio_context' });
  });

  it('a stream without audio tracks is no_input and the stream is released', async () => {
    const h = harness();
    const empty = new FakeStream([]);
    h.getUserMedia.mockResolvedValueOnce(empty);
    const r = await h.capture.open();
    expect(r).toEqual({ ok: false, state: 'no_input', detail: 'no_audio_track' });
    expect(h.context().closeCalls).toBe(1);
  });

  it('worklet load failure is error / worklet_failed and every track is stopped', async () => {
    const h = harness({
      loadWorklet: async () => {
        throw new Error('addModule failed');
      },
    });
    const r = await h.capture.open();
    expect(r).toEqual({ ok: false, state: 'error', detail: 'worklet_failed' });
    expect(h.track.stopCalls).toBe(1);
    expect(h.context().closeCalls).toBe(1);
  });

  it('can be retried after a failure', async () => {
    const h = harness();
    h.getUserMedia.mockRejectedValueOnce({ name: 'NotAllowedError' });
    expect((await h.capture.open()).state).toBe('permission_denied');
    const second = await h.capture.open();
    expect(second.ok).toBe(true);
    expect(h.capture.getState().state).toBe('open_idle');
  });
});

describe('open() success and readback', () => {
  it('requests AGC/EC/NS off with one channel, before any deviceId', async () => {
    const h = harness();
    await h.capture.open();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false, channelCount: 1 },
    });
    expect(REQUESTED_AUDIO_CONSTRAINTS).toEqual({
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 1,
    });
  });

  it('adds an exact deviceId only when one is given', async () => {
    const h = harness({ deviceId: 'abc123' });
    await h.capture.open();
    expect(h.getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
        deviceId: { exact: 'abc123' },
      },
    });
  });

  it('creates the AudioContext synchronously (inside the user gesture), before getUserMedia resolves', async () => {
    const h = harness();
    const pending = h.capture.open();
    expect(FakeContext.instances).toHaveLength(1);
    expect(h.context().resumeCalls).toBe(1);
    await pending;
  });

  it('emits permission_pending then open_idle with readback mapped to protocol fields', async () => {
    const h = harness();
    const r = await h.capture.open();
    expect(r).toEqual({ ok: true, state: 'open_idle', detail: null });
    expect(h.states.map((s) => s.state)).toEqual(['permission_pending', 'open_idle']);
    expect(h.capture.getState()).toEqual({
      state: 'open_idle',
      detail: null,
      settings: {
        auto_gain_control: false,
        echo_cancellation: false,
        noise_suppression: false,
        sample_rate: 48000,
        channel_count: 1,
      },
      supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
    });
    expect(h.capture.getAnalysisSampleRate()).toBe(48000);
  });

  it('wires source -> worklet -> zero-gain sink -> destination and names the processor', async () => {
    const h = harness();
    await h.capture.open();
    const ctx = h.context();
    const node = h.node();
    expect(node.name).toBe(FRAME_PROCESSOR_NAME);
    const [source, gain] = ctx.nodes as [FakeNode, FakeNode & { gain: { value: number } }];
    expect(source.connects).toEqual([node]);
    expect(node.connects).toEqual([gain]);
    expect(gain.connects).toEqual([ctx.destination]);
    expect(gain.gain.value).toBe(0);
  });

  it('opening twice concurrently shares one getUserMedia call; opening when open is a no-op', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.capture.open(), h.capture.open()]);
    expect(a.ok && b.ok).toBe(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    const c = await h.capture.open();
    expect(c.ok).toBe(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('settings readback maps unknown to null and never assumes false', () => {
  it('empty getSettings() gives all null', () => {
    expect(readTrackSettings({ getSettings: () => ({}) })).toEqual({
      auto_gain_control: null,
      echo_cancellation: null,
      noise_suppression: null,
      sample_rate: null,
      channel_count: null,
    });
  });

  it('a throwing or missing getSettings gives all null', () => {
    const allNull = {
      auto_gain_control: null,
      echo_cancellation: null,
      noise_suppression: null,
      sample_rate: null,
      channel_count: null,
    };
    expect(
      readTrackSettings({
        getSettings: () => {
          throw new Error('x');
        },
      }),
    ).toEqual(allNull);
    expect(readTrackSettings({} as never)).toEqual(allNull);
  });

  it('keeps reported true values and treats non-boolean / non-finite values as unknown', () => {
    expect(
      readTrackSettings({
        getSettings: () =>
          ({
            autoGainControl: true,
            echoCancellation: 'all',
            noiseSuppression: undefined,
            sampleRate: Number.NaN,
            channelCount: 2,
          }) as never,
      }),
    ).toEqual({
      auto_gain_control: true,
      echo_cancellation: null,
      noise_suppression: null,
      sample_rate: null,
      channel_count: 2,
    });
  });

  it('partial settings: only what the browser reports is filled in', async () => {
    const h = harness({}, { autoGainControl: false, sampleRate: 44100 });
    await h.capture.open();
    expect(h.capture.getState().settings).toEqual({
      auto_gain_control: false,
      echo_cancellation: null,
      noise_suppression: null,
      sample_rate: 44100,
      channel_count: null,
    });
  });

  it('supported is null for every field when getSupportedConstraints is unavailable', () => {
    expect(readSupportedConstraints({})).toEqual({
      auto_gain_control: null,
      echo_cancellation: null,
      noise_suppression: null,
    });
    expect(
      readSupportedConstraints({
        getSupportedConstraints: () => {
          throw new Error('x');
        },
      }),
    ).toEqual({ auto_gain_control: null, echo_cancellation: null, noise_suppression: null });
  });

  it('supported reflects the dictionary: a constraint the browser does not list is false', () => {
    expect(
      readSupportedConstraints({ getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true }) }),
    ).toEqual({ auto_gain_control: false, echo_cancellation: true, noise_suppression: true });
  });
});

// ---- measurement -------------------------------------------------------------------------

describe('measurement', () => {
  it('startMeasurement is refused unless the mic is open and idle', async () => {
    const h = harness();
    expect(h.capture.startMeasurement()).toBe(false); // off
    await h.capture.open();
    expect(h.capture.startMeasurement()).toBe(true);
    expect(h.capture.startMeasurement()).toBe(false); // already measuring
    expect(h.capture.getState().state).toBe('measuring');
  });

  it('start posts {cmd:start, epoch}; stop posts {cmd:stop} and returns to open_idle', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    h.capture.stopMeasurement();
    expect(h.node().posted).toEqual([{ cmd: 'start', epoch: 1 }, { cmd: 'stop' }]);
    expect(h.capture.getState().state).toBe('open_idle');
    h.capture.startMeasurement();
    expect(h.node().posted.at(-1)).toEqual({ cmd: 'start', epoch: 2 });
  });

  it('converts worklet reductions to Frames using the audio sample clock', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    const port = h.node().port;
    port.onmessage?.({ data: frameMessage(1, 0, 0.5) });
    port.onmessage?.({ data: frameMessage(1, 1, 0.5) });
    expect(h.frames).toHaveLength(2);
    const f = h.frames[1] as Frame;
    expect(f.frameIndex).toBe(1);
    expect(f.firstSampleIndex).toBe(2400);
    expect(f.t_audio_ms).toBe(50);
    expect(f.duration_ms).toBe(50);
    expect(f.rms).toBeCloseTo(0.5, 12);
    expect(f.dbfs).toBeCloseTo(-6.0206, 4); // 20*log10(0.5)
    expect(f.finite).toBe(true);
    expect(f.clipped).toBe(false);
  });

  it('a frame with enough clipped samples is clipped; a non-finite reduction is not finite', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    const port = h.node().port;
    port.onmessage?.({ data: frameMessage(1, 0, 0.5, { clippedCount: 12 }) });
    port.onmessage?.({ data: frameMessage(1, 1, 0.5, { nonfinite: true }) });
    expect(h.frames.map((f) => [f.clipped, f.finite])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('drops frames from an older epoch, when not measuring, and malformed messages', async () => {
    const h = harness();
    await h.capture.open();
    const port = h.node().port;
    port.onmessage?.({ data: frameMessage(1, 0, 0.5) }); // not measuring yet
    h.capture.startMeasurement(); // epoch 1
    h.capture.stopMeasurement();
    h.capture.startMeasurement(); // epoch 2
    port.onmessage?.({ data: frameMessage(1, 5, 0.5) }); // stale epoch
    port.onmessage?.({ data: frameMessage(2, 0, 0.5, { n: 100 }) }); // wrong frame length
    port.onmessage?.({ data: frameMessage(2, 0, 0.5, { sumSquares: Number.NaN }) });
    port.onmessage?.({ data: frameMessage(2, 0, 0.5, { firstSampleIndex: -1 }) });
    port.onmessage?.({ data: 'garbage' });
    port.onmessage?.({ data: null });
    expect(h.frames).toHaveLength(0);
    port.onmessage?.({ data: frameMessage(2, 0, 0.5) });
    expect(h.frames).toHaveLength(1);
  });

  it('never hands raw samples to the consumer: frames contain only scalars and booleans', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    h.node().port.onmessage?.({ data: frameMessage(1, 0, 0.1) });
    for (const v of Object.values(h.frames[0] as object)) {
      expect(['number', 'boolean']).toContain(typeof v);
    }
  });

  it('frames after stopMeasurement are dropped', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    h.capture.stopMeasurement();
    h.node().port.onmessage?.({ data: frameMessage(1, 0, 0.5) });
    expect(h.frames).toHaveLength(0);
  });
});

// ---- track and context lifecycle -----------------------------------------------------------

describe('lifecycle interruptions', () => {
  it('track ended while measuring interrupts, tears everything down and reports error/track_ended', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    h.track.dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(h.capture.getState().state).toBe('error'));
    expect(h.interrupts).toEqual(['track_ended']);
    expect(h.capture.getState().detail).toBe('track_ended');
    expect(h.track.stopCalls).toBe(1);
    expect(h.context().closeCalls).toBe(1);
    expect(h.capture.getAnalysisSampleRate()).toBeNull();
    expect(h.capture.startMeasurement()).toBe(false);
  });

  it('track mute interrupts a measurement and reports input_busy; unmute returns to open_idle', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    h.track.dispatchEvent(new Event('mute'));
    expect(h.interrupts).toEqual(['track_muted']);
    expect(h.capture.getState()).toMatchObject({ state: 'input_busy', detail: 'track_muted' });
    expect(h.node().posted.at(-1)).toEqual({ cmd: 'stop' });
    // a frame that arrives late is not delivered
    h.node().port.onmessage?.({ data: frameMessage(1, 0, 0.5) });
    expect(h.frames).toHaveLength(0);
    h.track.dispatchEvent(new Event('unmute'));
    expect(h.capture.getState()).toMatchObject({ state: 'open_idle', detail: null });
  });

  it('mute while idle reports input_busy without an interrupt callback, and open() does not claim success', async () => {
    const h = harness();
    await h.capture.open();
    h.track.dispatchEvent(new Event('mute'));
    expect(h.interrupts).toEqual([]);
    expect(h.capture.getState().state).toBe('input_busy');
    expect(h.capture.startMeasurement()).toBe(false);
    expect(await h.capture.open()).toEqual({ ok: false, state: 'input_busy', detail: 'track_muted' });
  });

  it('context suspended during a measurement interrupts it and reports error/context_suspended', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    const ctx = h.context();
    ctx.state = 'suspended';
    ctx.dispatchEvent(new Event('statechange'));
    expect(h.interrupts).toEqual(['context_suspended']);
    expect(h.capture.getState()).toMatchObject({ state: 'error', detail: 'context_suspended' });
    ctx.state = 'running';
    ctx.dispatchEvent(new Event('statechange'));
    expect(h.capture.getState()).toMatchObject({ state: 'open_idle', detail: null });
  });

  it('context closed externally tears down and reports error/context_closed', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    const ctx = h.context();
    ctx.state = 'closed';
    ctx.dispatchEvent(new Event('statechange'));
    await vi.waitFor(() => expect(h.capture.getState().detail).toBe('context_closed'));
    expect(h.interrupts).toEqual(['context_closed']);
    expect(h.track.stopCalls).toBe(1);
  });
});

// ---- shutdown ------------------------------------------------------------------------------

describe('shutdown', () => {
  it('releases every resource and reports state off', async () => {
    const h = harness();
    const second = new FakeTrack();
    h.stream.tracks.push(second); // two tracks: every one must be stopped
    await h.capture.open();
    h.capture.startMeasurement();
    const ctx = h.context();
    const node = h.node();
    const [source, gain] = ctx.nodes as [FakeNode, FakeNode];

    const report = await h.capture.shutdown();

    expect(h.track.stopCalls).toBe(1);
    expect(second.stopCalls).toBe(1);
    expect(report.tracksTotal).toBe(2);
    expect(report.tracksStopped).toBe(2);
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.state).toBe('closed');
    expect(report.contextClosed).toBe(true);
    expect(node.portClosed).toBe(1);
    expect(report.portClosed).toBe(true);
    expect(node.port.onmessage).toBeNull();
    expect(node.posted.at(-1)).toEqual({ cmd: 'close' });
    expect([source.disconnectCalls, node.disconnectCalls, gain.disconnectCalls]).toEqual([1, 1, 1]);
    expect(report.nodesDisconnected).toBe(3);
    expect(report.listenersRemoved).toBe(4); // ended, mute, unmute, statechange
    expect(report.state).toBe('off');
    expect(h.capture.getState().state).toBe('off');
    expect(h.capture.getState().settings).toEqual({
      auto_gain_control: null,
      echo_cancellation: null,
      noise_suppression: null,
      sample_rate: null,
      channel_count: null,
    });
    expect(h.states.at(-1)?.state).toBe('off');
    expect(h.capture.getAnalysisSampleRate()).toBeNull();
    expect(h.capture.startMeasurement()).toBe(false);
  });

  it('listeners are really gone: later events change nothing', async () => {
    const h = harness();
    await h.capture.open();
    h.capture.startMeasurement();
    const ctx = h.context();
    await h.capture.shutdown();
    const statesBefore = h.states.length;
    h.track.dispatchEvent(new Event('ended'));
    h.track.dispatchEvent(new Event('mute'));
    ctx.dispatchEvent(new Event('statechange'));
    h.node().port.onmessage?.({ data: frameMessage(1, 0, 0.5) });
    expect(h.states.length).toBe(statesBefore);
    expect(h.interrupts).toEqual([]);
    expect(h.frames).toHaveLength(0);
  });

  it('is idempotent: repeated and concurrent calls stop and close exactly once', async () => {
    const h = harness();
    await h.capture.open();
    const ctx = h.context();
    const [a, b] = await Promise.all([h.capture.shutdown(), h.capture.shutdown()]);
    expect(a).toBe(b);
    const c = await h.capture.shutdown();
    const d = await h.capture.shutdown();
    expect(h.track.stopCalls).toBe(1);
    expect(ctx.closeCalls).toBe(1);
    expect(c).toEqual(a);
    expect(d).toEqual(a);
    expect(h.states.filter((s) => s.state === 'off')).toHaveLength(1);
  });

  it('shutdown without ever opening is a safe no-op that reports off', async () => {
    const h = harness();
    const r = await h.capture.shutdown();
    expect(r.state).toBe('off');
    expect(r.tracksStopped).toBe(0);
    expect(h.capture.getState().state).toBe('off');
  });

  it('cancels an open() that is waiting on the permission prompt: context closed now, tracks stopped when granted', async () => {
    const h = harness();
    let grant: (s: FakeStream) => void = () => {};
    h.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          grant = resolve;
        }),
    );
    const opening = h.capture.open();
    expect(h.capture.getState().state).toBe('permission_pending');
    const ctx = h.context();

    const report = await h.capture.shutdown();
    expect(report.state).toBe('off');
    expect(h.capture.getState().state).toBe('off');
    expect(ctx.closeCalls).toBe(1); // closed immediately, not left waiting on the prompt

    grant(h.stream); // the user finally taps Allow
    const result = await opening;
    expect(result.ok).toBe(false);
    expect(h.track.stopCalls).toBe(1); // the late stream is stopped at once
    expect(h.capture.getState().state).toBe('off');
    expect(ctx.workletNodes).toHaveLength(0); // nothing was built on the cancelled open
  });

  it('a late permission denial after shutdown leaves the state off', async () => {
    const h = harness();
    let deny: (e: unknown) => void = () => {};
    h.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((_resolve, reject) => {
          deny = reject;
        }),
    );
    const opening = h.capture.open();
    await h.capture.shutdown();
    deny({ name: 'NotAllowedError' });
    const result = await opening;
    expect(result.ok).toBe(false);
    expect(h.capture.getState().state).toBe('off');
  });

  it('open() after a shutdown that cancelled a still-pending open() reaches getUserMedia again (no dangling promise)', async () => {
    const h = harness();
    // First request: the permission prompt is never answered (the promise stays pending).
    let grantFirst: (s: FakeStream) => void = () => {};
    h.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          grantFirst = resolve;
        }),
    );
    const firstOpen = h.capture.open();
    await h.capture.shutdown(); // the user taps Cancel

    // Second request must go to getUserMedia even though the first never settled.
    const secondStream = new FakeStream([new FakeTrack({ autoGainControl: false })]);
    h.getUserMedia.mockImplementationOnce(async () => secondStream);
    const second = await Promise.race([
      h.capture.open(),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 200)),
    ]);
    expect(second).not.toBe('hung');
    expect(second).toMatchObject({ ok: true, state: 'open_idle' });
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);

    // The abandoned first request finally resolves: its stream is stopped and the new session is untouched.
    grantFirst(h.stream);
    expect(await firstOpen).toMatchObject({ ok: false });
    expect(h.track.stopCalls).toBe(1);
    expect(secondStream.tracks[0]?.stopCalls).toBe(0);
    expect(h.capture.getState().state).toBe('open_idle');
    expect(FakeContext.instances).toHaveLength(2);
    expect(FakeContext.instances[0]?.closeCalls).toBe(1);
    expect(FakeContext.instances[1]?.closeCalls).toBe(0);

    // And a further open() still shares the live session instead of starting another request.
    expect((await h.capture.open()).ok).toBe(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('the cancelled open() settling late does not clear a newer in-flight open()', async () => {
    const h = harness();
    let grantFirst: (s: FakeStream) => void = () => {};
    h.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          grantFirst = resolve;
        }),
    );
    const firstOpen = h.capture.open();
    await h.capture.shutdown();

    let grantSecond: (s: FakeStream) => void = () => {};
    const secondStream = new FakeStream([new FakeTrack()]);
    h.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          grantSecond = resolve;
        }),
    );
    const secondOpen = h.capture.open();
    grantFirst(h.stream); // the stale request settles while the second is still waiting
    await firstOpen;
    const third = h.capture.open(); // must join the second request, not start a third
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    grantSecond(secondStream);
    expect((await secondOpen).ok).toBe(true);
    expect((await third).ok).toBe(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('the microphone can be opened again after shutdown with fresh resources', async () => {
    const h = harness();
    await h.capture.open();
    await h.capture.shutdown();
    const r = await h.capture.open();
    expect(r.ok).toBe(true);
    expect(FakeContext.instances).toHaveLength(2);
    expect(h.capture.getState().state).toBe('open_idle');
  });
});

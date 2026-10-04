/**
 * TEMPORARY microphone adapter implementing the AudioPort contract. Replaced by
 * `createMicCapture` from `@atr/phone-mic-meter` once that package is merged.
 *
 * Responsibilities: explicit-gesture getUserMedia, error classification, observed state,
 * AudioWorklet graph, per-run frame collection, local summaries, and COMPLETE shutdown.
 * No recorder objects, no storage, no raw-sample transport: the worklet posts per-frame
 * accumulators only and this file turns them into numbers.
 */

import { FRAME_MS } from '../config.js';
import type {
  AbortReason,
  AudioPort,
  AudioSnapshot,
  LevelFrame,
  OpenOptions,
  PrecheckRequest,
  PrecheckRun,
  WindowRequest,
  WindowRun,
} from '../ports/audio.js';
import type { MicMode, MicStateName, PrecheckResultPayload, WindowResultPayload } from '../ports/wire.js';
import {
  type FrameStat,
  frameSizeFor,
  interruptedPrecheck,
  interruptedWindow,
  isCandidate,
  reduceFrame,
  summarizePrecheck,
  summarizeWindow,
} from './dsp.js';

// Structural views of the browser objects we use, so the whole adapter is testable with fakes.
export interface NodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface WorkletNodeLike extends NodeLike {
  port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void };
}
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): NodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  getSupportedConstraints?(): MediaTrackSupportedConstraints;
}

export interface CaptureDeps {
  mediaDevices: MediaDevicesLike | undefined;
  createAudioContext(): AudioContextLike;
  createWorkletNode(context: AudioContextLike): WorkletNodeLike;
  workletUrl: string;
  isSecureContext: boolean;
  mode: MicMode;
  /** Test builds only: supplies a synthetic stream instead of getUserMedia. */
  inputOverride?: () => Promise<MediaStream>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const NO_SETTINGS = {
  auto_gain_control: null,
  echo_cancellation: null,
  noise_suppression: null,
  sample_rate: null,
  channel_count: null,
} as const;

/** Maps getUserMedia / graph failures to the mic states in PROTOCOL.md. */
export function classifyOpenError(error: unknown): { state: MicStateName; detail: string } {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { state: 'permission_denied', detail: name };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { state: 'no_input', detail: name };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { state: 'input_busy', detail: name };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { state: 'constraints_unsupported', detail: name };
    default:
      return { state: 'error', detail: name || 'unknown' };
  }
}

interface ActiveRun {
  id: number;
  frames: FrameStat[];
  expectedFrames: number;
  watchdog: unknown;
  vadFloor: number;
  onFrame: ((frame: LevelFrame) => void) | null;
  /** Closes the run with a payload (null when the caller aborted it). */
  finish(payload: unknown): void;
  summarize(expected: number): unknown;
  interrupted(): unknown;
}

export function createAudioPort(deps: CaptureDeps): AudioPort {
  return new CapturePort(deps);
}

class CapturePort implements AudioPort {
  private snapshot: AudioSnapshot;
  private readonly listeners = new Set<(s: AudioSnapshot) => void>();
  private token = 0;
  private runCounter = 0;
  private run: ActiveRun | null = null;

  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: AudioContextLike | null = null;
  private source: NodeLike | null = null;
  private node: WorkletNodeLike | null = null;
  private endedHandler: (() => void) | null = null;
  private muteHandler: (() => void) | null = null;
  private unmuteHandler: (() => void) | null = null;

  constructor(private readonly deps: CaptureDeps) {
    this.snapshot = {
      state: 'off',
      settings: { ...NO_SETTINGS },
      supported: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false },
      mode: deps.mode,
      detail: null,
    };
  }

  getSnapshot(): AudioSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (s: AudioSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<AudioSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const l of [...this.listeners]) l(next);
  }

  // ---- opening -----------------------------------------------------------

  async open(options: OpenOptions = {}): Promise<void> {
    const state = this.snapshot.state;
    if (state === 'open_idle' || state === 'measuring' || state === 'permission_pending') return;
    const token = ++this.token;
    const synthetic = this.deps.inputOverride !== undefined;
    if (!synthetic) {
      if (!this.deps.isSecureContext) {
        this.update({ state: 'error', detail: 'insecure_context' });
        return;
      }
      if (!this.deps.mediaDevices || typeof this.deps.mediaDevices.getUserMedia !== 'function') {
        this.update({ state: 'error', detail: 'no_media_devices' });
        return;
      }
    }
    let supported = this.snapshot.supported;
    const getSupported = this.deps.mediaDevices?.getSupportedConstraints;
    if (typeof getSupported === 'function') {
      try {
        const s = getSupported.call(this.deps.mediaDevices);
        supported = {
          auto_gain_control: s.autoGainControl === true,
          echo_cancellation: s.echoCancellation === true,
          noise_suppression: s.noiseSuppression === true,
        };
      } catch {
        /* leave unknown (false) */
      }
    }
    this.update({ state: 'permission_pending', detail: null, settings: { ...NO_SETTINGS }, supported });

    // Created inside the user gesture so the browser lets the context run.
    let ctx: AudioContextLike;
    try {
      ctx = this.deps.createAudioContext();
    } catch {
      this.update({ state: 'error', detail: 'audio_context_failed' });
      return;
    }

    let stream: MediaStream;
    try {
      if (this.deps.inputOverride) {
        stream = await this.deps.inputOverride();
      } else {
        const audio: MediaTrackConstraints | boolean = options.relaxConstraints
          ? true
          : { autoGainControl: false, echoCancellation: false, noiseSuppression: false };
        stream = await (this.deps.mediaDevices as MediaDevicesLike).getUserMedia({ audio, video: false });
      }
    } catch (error) {
      void ctx.close().catch(() => undefined);
      if (token !== this.token) return;
      const c = classifyOpenError(error);
      this.update({ state: c.state, detail: c.detail });
      return;
    }

    if (token !== this.token) {
      // The user cancelled (or closed) while the prompt was open: release at once.
      for (const t of stream.getTracks()) t.stop();
      void ctx.close().catch(() => undefined);
      return;
    }

    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close().catch(() => undefined);
      this.update({ state: 'no_input', detail: 'no_audio_track' });
      return;
    }

    try {
      await ctx.audioWorklet.addModule(this.deps.workletUrl);
      if (token !== this.token) throw new Error('cancelled');
      const source = ctx.createMediaStreamSource(stream);
      const node = this.deps.createWorkletNode(ctx);
      node.port.onmessage = (event) => this.onWorkletMessage(event.data);
      source.connect(node);
      node.connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
      if (token !== this.token) throw new Error('cancelled');
      this.stream = stream;
      this.track = track;
      this.ctx = ctx;
      this.source = source;
      this.node = node;
    } catch {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close().catch(() => undefined);
      if (token === this.token) this.update({ state: 'error', detail: 'audio_graph_failed' });
      return;
    }

    this.endedHandler = () => this.onTrackEnded('track_ended');
    this.muteHandler = () => this.onTrackEnded('track_muted');
    this.unmuteHandler = () => {
      if (this.snapshot.state === 'error' && this.snapshot.detail === 'track_muted' && this.track) {
        this.update({ state: 'open_idle', detail: null });
      }
    };
    track.addEventListener('ended', this.endedHandler);
    track.addEventListener('mute', this.muteHandler);
    track.addEventListener('unmute', this.unmuteHandler);

    const s = track.getSettings();
    this.update({
      state: 'open_idle',
      detail: null,
      settings: {
        auto_gain_control: typeof s.autoGainControl === 'boolean' ? s.autoGainControl : null,
        echo_cancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
        noise_suppression: typeof s.noiseSuppression === 'boolean' ? s.noiseSuppression : null,
        sample_rate: typeof s.sampleRate === 'number' ? s.sampleRate : ctx.sampleRate,
        channel_count: typeof s.channelCount === 'number' ? s.channelCount : null,
      },
    });
  }

  cancelOpen(): void {
    if (this.snapshot.state !== 'permission_pending') return;
    this.token += 1;
    this.update({ state: 'off', detail: null });
  }

  // ---- shutdown ------------------------------------------------------------

  close(): void {
    this.token += 1;
    const run = this.run;
    if (run) {
      this.endRun(run);
      run.finish(null);
    }
    this.teardown();
    this.update({ state: 'off', detail: null, settings: { ...NO_SETTINGS } });
  }

  private teardown(): void {
    const track = this.track;
    if (track) {
      if (this.endedHandler) track.removeEventListener('ended', this.endedHandler);
      if (this.muteHandler) track.removeEventListener('mute', this.muteHandler);
      if (this.unmuteHandler) track.removeEventListener('unmute', this.unmuteHandler);
    }
    this.endedHandler = this.muteHandler = this.unmuteHandler = null;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.node) {
      try {
        this.node.port.postMessage({ type: 'dispose' });
      } catch {
        /* already gone */
      }
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.stream = this.track = this.ctx = this.source = this.node = null;
  }

  private onTrackEnded(detail: 'track_ended' | 'track_muted'): void {
    if (this.snapshot.state === 'off') return;
    const run = this.run;
    if (run) {
      const payload = run.interrupted();
      this.endRun(run);
      run.finish(payload);
    }
    if (detail === 'track_ended') {
      this.teardown();
      this.update({ state: 'error', detail, settings: { ...NO_SETTINGS } });
    } else {
      this.update({ state: 'error', detail });
    }
  }

  // ---- runs --------------------------------------------------------------

  private beginRun(
    expectedFrames: number,
    vadFloor: number,
    onFrame: ((frame: LevelFrame) => void) | null,
    summarize: (expected: number, frames: FrameStat[]) => unknown,
    interrupted: (expected: number, frames: FrameStat[]) => unknown,
    durationMs: number,
    finish: (payload: unknown) => void,
  ): ActiveRun {
    const ctx = this.ctx;
    const node = this.node;
    if (this.snapshot.state !== 'open_idle' || !ctx || !node) throw new Error('mic_not_open');
    if (this.run) throw new Error('run_active');
    const id = ++this.runCounter;
    const setTimeoutFn = this.deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    const run: ActiveRun = {
      id,
      frames: [],
      expectedFrames,
      vadFloor,
      onFrame,
      finish,
      watchdog: null,
      summarize: (expected) => summarize(expected, run.frames),
      interrupted: () => interrupted(expectedFrames, run.frames),
    };
    // If the audio clock stalls (suspended context, no frames), close the run with what we have.
    run.watchdog = setTimeoutFn(() => {
      if (this.run !== run) return;
      this.endRun(run);
      run.finish(run.summarize(run.expectedFrames));
    }, durationMs + 2000);
    this.run = run;
    node.port.postMessage({ type: 'begin', runId: id, frameSize: frameSizeFor(ctx.sampleRate) });
    return run;
  }

  /** Detaches a run from the port and tells the worklet to stop reducing. */
  private endRun(run: ActiveRun): void {
    if (this.run !== run) return;
    this.run = null;
    const clear = this.deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as number));
    clear(run.watchdog);
    try {
      this.node?.port.postMessage({ type: 'end' });
    } catch {
      /* worklet gone */
    }
    if (this.snapshot.state === 'measuring') this.update({ state: 'open_idle' });
  }

  precheck(request: PrecheckRequest): PrecheckRun {
    const expected = Math.floor(request.durationMs / FRAME_MS);
    let resolve!: (v: PrecheckResultPayload | null) => void;
    const result = new Promise<PrecheckResultPayload | null>((r) => {
      resolve = r;
    });
    const run = this.beginRun(
      expected,
      0,
      null,
      (exp, frames) => summarizePrecheck(frames, request.purpose, exp),
      (exp, frames) => interruptedPrecheck(frames, request.purpose, exp),
      request.durationMs,
      (payload) => resolve(payload as PrecheckResultPayload | null),
    );
    return {
      result,
      abort: (reason: AbortReason) => {
        if (this.run !== run) return null;
        const payload = reason === 'interrupted' ? (run.interrupted() as PrecheckResultPayload) : null;
        this.endRun(run);
        run.finish(null);
        return payload;
      },
    };
  }

  window(request: WindowRequest, onFrame: (frame: LevelFrame) => void): WindowRun {
    const expected = Math.floor(request.maxDurationMs / FRAME_MS);
    let resolve!: (v: WindowResultPayload | null) => void;
    const result = new Promise<WindowResultPayload | null>((r) => {
      resolve = r;
    });
    const run = this.beginRun(
      expected,
      request.vadFloorDbfs,
      onFrame,
      (exp, frames) => summarizeWindow(frames, request.kind, request.vadFloorDbfs, exp),
      (exp, frames) => interruptedWindow(frames, request.kind, request.vadFloorDbfs, exp),
      request.maxDurationMs,
      (payload) => resolve(payload as WindowResultPayload | null),
    );
    return {
      result,
      stop: () => {
        if (this.run !== run) return;
        const payload = run.summarize(run.frames.length);
        this.endRun(run);
        run.finish(payload);
      },
      abort: (reason: AbortReason) => {
        if (this.run !== run) return null;
        const payload = reason === 'interrupted' ? (run.interrupted() as WindowResultPayload) : null;
        this.endRun(run);
        run.finish(null);
        return payload;
      },
    };
  }

  private onWorkletMessage(data: unknown): void {
    const run = this.run;
    if (!run || typeof data !== 'object' || data === null) return;
    const m = data as {
      type?: unknown;
      runId?: unknown;
      index?: unknown;
      sumSq?: unknown;
      count?: unknown;
      clipped?: unknown;
      nonFinite?: unknown;
    };
    if (m.type !== 'frame' || m.runId !== run.id) return;
    if (typeof m.index !== 'number' || typeof m.sumSq !== 'number' || typeof m.count !== 'number') return;
    // The first frame that actually arrives is what makes the mic "measuring".
    if (this.snapshot.state === 'open_idle') this.update({ state: 'measuring' });
    const frame = reduceFrame(m.index, {
      sumSq: m.sumSq,
      count: m.count,
      clipped: typeof m.clipped === 'number' ? m.clipped : 0,
      nonFinite: m.nonFinite === true,
    });
    run.frames.push(frame);
    if (run.onFrame && frame.finite) {
      run.onFrame({
        frameIndex: frame.index,
        tAudioMs: frame.index * FRAME_MS,
        dbfs: frame.dbfs,
        active: isCandidate(frame, run.vadFloor),
        clipped: frame.clipped,
      });
    }
    if (run.frames.length >= run.expectedFrames) {
      const payload = run.summarize(run.expectedFrames);
      this.endRun(run);
      run.finish(payload);
    }
  }
}

/**
 * Local microphone capture adapter.
 *
 * - open() must be called from a user-gesture handler. The AudioContext is created (and
 *   resume() requested) synchronously, before the first await, so the gesture is not lost
 *   while the permission prompt is open.
 * - Requests autoGainControl/echoCancellation/noiseSuppression false and one channel. These
 *   are best-effort requests: what the browser reports back (getSettings) is recorded and
 *   exposed, never assumed, and a reported `false` does not prove an unprocessed signal.
 * - The only data that crosses the worklet port is per-frame scalars (see worklet-source.ts).
 *   Nothing in this module stores, buffers, encodes or sends audio.
 * - shutdown() is idempotent and returns a report that lets callers and tests verify every
 *   resource was released.
 */

import { frameFromReduction, frameSamples } from '../frame.js';
import type { Frame, FrameReduction } from '../frame.js';
import type { MicSettingsPayload, MicStateName, MicSupportedPayload } from '../types.js';
import { classifyMicError } from './errors.js';
import { loadFrameProcessor } from './worklet-loader.js';
import { FRAME_PROCESSOR_NAME } from './worklet-source.js';

/** Constraints requested from the browser (before any deviceId). Recorded in the T04 protocol. */
export const REQUESTED_AUDIO_CONSTRAINTS = Object.freeze({
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
  channelCount: 1,
});

export interface MicCaptureState {
  state: MicStateName;
  settings: MicSettingsPayload;
  supported: MicSupportedPayload;
  /** Short machine-readable code or null; see classifyMicError. */
  detail: string | null;
}

export type MicInterruptReason =
  | 'track_ended'
  | 'track_muted'
  | 'context_suspended'
  | 'context_closed';

export interface MicOpenResult {
  ok: boolean;
  state: MicStateName;
  detail: string | null;
}

export interface MicShutdownReport {
  tracksTotal: number;
  tracksStopped: number;
  nodesDisconnected: number;
  contextClosed: boolean;
  portClosed: boolean;
  listenersRemoved: number;
  state: 'off';
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  getSupportedConstraints?: () => MediaTrackSupportedConstraints;
}

export type AudioContextCtor = new () => AudioContext;
export type AudioWorkletNodeCtor = new (
  context: AudioContext,
  name: string,
  options?: AudioWorkletNodeOptions,
) => AudioWorkletNode;

export interface MicCaptureOptions {
  mediaDevices: MediaDevicesLike | null | undefined;
  AudioContextCtor: AudioContextCtor | null | undefined;
  onState: (state: MicCaptureState) => void;
  /** Called for every complete frame while a measurement is running. */
  onFrame: (frame: Frame) => void;
  /** Called when a running measurement is lost (track ended/muted, context suspended/closed). */
  onInterrupt?: (reason: MicInterruptReason) => void;
  AudioWorkletNodeCtor?: AudioWorkletNodeCtor;
  /** Load the worklet from this URL instead of a Blob URL. */
  workletModuleUrl?: string;
  /** Replace worklet loading (tests, custom builds). */
  loadWorklet?: (context: AudioContext) => Promise<void>;
  /** Exact input device to request; unknown/removed devices classify as no_input. */
  deviceId?: string;
  /** Defaults to globalThis.isSecureContext, or true when that is not exposed. */
  isSecureContext?: boolean;
}

export interface MicCapture {
  open(): Promise<MicOpenResult>;
  /** Begin a measurement at the next render quantum. False unless the mic is open and idle. */
  startMeasurement(): boolean;
  stopMeasurement(): void;
  shutdown(): Promise<MicShutdownReport>;
  getState(): MicCaptureState;
  /** AudioContext sample rate while open, else null. */
  getAnalysisSampleRate(): number | null;
  getRequestedConstraints(): MediaStreamConstraints;
}

const NULL_SETTINGS: MicSettingsPayload = Object.freeze({
  auto_gain_control: null,
  echo_cancellation: null,
  noise_suppression: null,
  sample_rate: null,
  channel_count: null,
});

const NULL_SUPPORTED: MicSupportedPayload = Object.freeze({
  auto_gain_control: null,
  echo_cancellation: null,
  noise_suppression: null,
});

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Map track.getSettings() to the protocol shape; anything not reported stays null. */
export function readTrackSettings(track: Pick<MediaStreamTrack, 'getSettings'>): MicSettingsPayload {
  let s: Record<string, unknown> = {};
  try {
    if (typeof track.getSettings === 'function') s = track.getSettings() as Record<string, unknown>;
  } catch {
    s = {};
  }
  return {
    auto_gain_control: asBoolean(s.autoGainControl),
    echo_cancellation: asBoolean(s.echoCancellation),
    noise_suppression: asBoolean(s.noiseSuppression),
    sample_rate: asFiniteNumber(s.sampleRate),
    channel_count: asFiniteNumber(s.channelCount),
  };
}

/**
 * Map getSupportedConstraints() to the protocol shape. When the API is unavailable the values
 * are null (unknown). When it returns a dictionary, a constraint it does not list is reported
 * as false, because that is what the dictionary says (the browser does not recognise it).
 */
export function readSupportedConstraints(
  mediaDevices: Pick<MediaDevicesLike, 'getSupportedConstraints'>,
): MicSupportedPayload {
  let c: Record<string, unknown> | null = null;
  try {
    if (typeof mediaDevices.getSupportedConstraints === 'function') {
      c = mediaDevices.getSupportedConstraints() as unknown as Record<string, unknown>;
    }
  } catch {
    c = null;
  }
  if (c === null || typeof c !== 'object') return { ...NULL_SUPPORTED };
  return {
    auto_gain_control: c.autoGainControl === true,
    echo_cancellation: c.echoCancellation === true,
    noise_suppression: c.noiseSuppression === true,
  };
}

interface Session {
  context: AudioContext;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  source: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | null;
  gain: GainNode | null;
  listeners: Array<() => void>;
  epoch: number;
  measuring: boolean;
  frameLength: number;
  closing: boolean;
}

export function createMicCapture(options: MicCaptureOptions): MicCapture {
  const requested: MediaStreamConstraints = {
    audio: {
      ...REQUESTED_AUDIO_CONSTRAINTS,
      ...(options.deviceId !== undefined ? { deviceId: { exact: options.deviceId } } : {}),
    },
  };

  let current: MicCaptureState = {
    state: 'off',
    settings: { ...NULL_SETTINGS },
    supported: { ...NULL_SUPPORTED },
    detail: null,
  };
  let session: Session | null = null;
  /** Resources created by an open() that has not finished yet (permission prompt, worklet load). */
  let pending: Session | null = null;
  let generation = 0;
  let opening: Promise<MicOpenResult> | null = null;
  let lastReport: MicShutdownReport | null = null;
  let shuttingDown: Promise<MicShutdownReport> | null = null;

  function snapshot(): MicCaptureState {
    return {
      state: current.state,
      settings: { ...current.settings },
      supported: { ...current.supported },
      detail: current.detail,
    };
  }

  function setState(patch: Partial<MicCaptureState>): void {
    const next: MicCaptureState = {
      state: patch.state ?? current.state,
      settings: patch.settings ?? current.settings,
      supported: patch.supported ?? current.supported,
      detail: patch.detail !== undefined ? patch.detail : current.detail,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) options.onState(snapshot());
  }

  function fail(state: MicStateName, detail: string | null): MicOpenResult {
    setState({ state, detail, settings: { ...NULL_SETTINGS } });
    return { ok: false, state, detail };
  }

  const secure =
    options.isSecureContext ??
    (typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : true);

  async function teardown(s: Session): Promise<MicShutdownReport> {
    s.closing = true;
    s.measuring = false;
    const report: MicShutdownReport = {
      tracksTotal: 0,
      tracksStopped: 0,
      nodesDisconnected: 0,
      contextClosed: false,
      portClosed: false,
      listenersRemoved: 0,
      state: 'off',
    };

    // 1. Stop every capture track first: this is what turns the browser's mic indicator off.
    const tracks: MediaStreamTrack[] = [];
    try {
      if (s.stream !== null) tracks.push(...s.stream.getTracks());
    } catch {
      /* fall through to the explicit track below */
    }
    if (s.track !== null && !tracks.includes(s.track)) tracks.push(s.track);
    report.tracksTotal = tracks.length;
    for (const t of tracks) {
      try {
        t.stop();
        report.tracksStopped += 1;
      } catch {
        /* counted by the difference tracksTotal - tracksStopped */
      }
    }

    // 2. Listeners.
    for (const remove of s.listeners) {
      try {
        remove();
        report.listenersRemoved += 1;
      } catch {
        /* ignore */
      }
    }
    s.listeners = [];

    // 3. Worklet port: ask the processor to exit, then close the port.
    if (s.node !== null) {
      try {
        s.node.port.onmessage = null;
        s.node.port.postMessage({ cmd: 'close' });
        s.node.port.close();
        report.portClosed = true;
      } catch {
        /* ignore */
      }
    }

    // 4. Disconnect nodes.
    for (const n of [s.source, s.node, s.gain]) {
      if (n === null) continue;
      try {
        n.disconnect();
        report.nodesDisconnected += 1;
      } catch {
        /* disconnect() throws when already disconnected */
      }
    }

    // 5. Close the AudioContext.
    try {
      if (s.context.state !== 'closed') await s.context.close();
    } catch {
      /* contextClosed stays false unless the state says otherwise */
    }
    report.contextClosed = s.context.state === 'closed';

    s.stream = null;
    s.track = null;
    s.source = null;
    s.node = null;
    s.gain = null;
    return report;
  }

  async function failSession(s: Session, state: MicStateName, detail: string): Promise<void> {
    if (session !== s || s.closing) return;
    session = null;
    generation += 1;
    await teardown(s);
    setState({ state, detail, settings: { ...NULL_SETTINGS } });
  }

  function interrupt(reason: MicInterruptReason): void {
    options.onInterrupt?.(reason);
  }

  async function doOpen(): Promise<MicOpenResult> {
    const gen = ++generation;

    // Prerequisites are checked before announcing "permission pending": no prompt will appear
    // when the page is insecure or the browser lacks the APIs.
    const md = options.mediaDevices;
    if (!secure || md === null || md === undefined || typeof md.getUserMedia !== 'function') {
      return fail('error', 'insecure_context');
    }
    if (options.AudioContextCtor === null || options.AudioContextCtor === undefined) {
      return fail('error', 'no_audio_context');
    }
    setState({ state: 'permission_pending', detail: null, settings: { ...NULL_SETTINGS } });

    // Created before the first await so it stays inside the caller's user gesture.
    let context: AudioContext;
    try {
      context = new options.AudioContextCtor();
    } catch {
      return fail('error', 'audio_context_failed');
    }
    let resumePromise: Promise<void> | undefined;
    try {
      resumePromise = context.resume();
      // A rejection is handled where the promise is awaited; this only prevents an unhandled-rejection event.
      resumePromise.catch(() => undefined);
    } catch {
      resumePromise = undefined;
    }

    const s: Session = {
      context,
      stream: null,
      track: null,
      source: null,
      node: null,
      gain: null,
      listeners: [],
      epoch: 0,
      measuring: false,
      frameLength: 0,
      closing: false,
    };

    pending = s;
    const cancelled = (): boolean => gen !== generation;
    const abandoned = async (): Promise<MicOpenResult> => {
      // shutdown() (or a newer open) happened while this open() was waiting.
      await teardown(s);
      return { ok: false, state: current.state, detail: current.detail };
    };

    let stream: MediaStream;
    try {
      stream = await md.getUserMedia(requested);
    } catch (err) {
      await teardown(s);
      if (pending === s) pending = null;
      if (cancelled()) return { ok: false, state: current.state, detail: current.detail };
      const cls = classifyMicError(err);
      return fail(cls.state, cls.detail);
    }
    s.stream = stream;
    if (cancelled()) return abandoned();

    let step = 'setup_failed';
    try {
      const track = stream.getAudioTracks()[0];
      if (track === undefined) {
        await teardown(s);
        if (pending === s) pending = null;
        return fail('no_input', 'no_audio_track');
      }
      s.track = track;

      try {
        await resumePromise;
        if (context.state !== 'running') await context.resume();
      } catch {
        /* checked via context.state below */
      }
      if (cancelled()) return abandoned();
      if (context.state !== 'running') {
        await teardown(s);
        if (pending === s) pending = null;
        return fail('error', 'context_not_running');
      }

      const loadWorklet =
        options.loadWorklet ??
        ((ctx: AudioContext) =>
          loadFrameProcessor(
            ctx,
            options.workletModuleUrl !== undefined ? { moduleUrl: options.workletModuleUrl } : {},
          ));
      step = 'worklet_failed';
      await loadWorklet(context);
      if (cancelled()) return abandoned();
      step = 'setup_failed';

      const NodeCtor =
        options.AudioWorkletNodeCtor ??
        (globalThis as { AudioWorkletNode?: AudioWorkletNodeCtor }).AudioWorkletNode;
      if (NodeCtor === undefined) {
        await teardown(s);
        if (pending === s) pending = null;
        return fail('error', 'no_audio_worklet');
      }

      s.frameLength = frameSamples(context.sampleRate);
      const node = new NodeCtor(context, FRAME_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      s.node = node;
      node.port.onmessage = (event: MessageEvent) => handleWorkletMessage(s, event.data);

      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 0;
      s.source = source;
      s.gain = gain;
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);

      const listen = (target: EventTarget, type: string, fn: () => void): void => {
        target.addEventListener(type, fn);
        s.listeners.push(() => target.removeEventListener(type, fn));
      };
      listen(track, 'ended', () => {
        if (s.measuring) interrupt('track_ended');
        void failSession(s, 'error', 'track_ended');
      });
      listen(track, 'mute', () => {
        if (session !== s || s.closing) return;
        if (s.measuring) {
          s.measuring = false;
          safePost(s, { cmd: 'stop' });
          interrupt('track_muted');
        }
        setState({ state: 'input_busy', detail: 'track_muted' });
      });
      listen(track, 'unmute', () => {
        if (session !== s || s.closing) return;
        if (current.state === 'input_busy' && current.detail === 'track_muted') {
          setState({ state: 'open_idle', detail: null });
        }
      });
      listen(context, 'statechange', () => {
        if (session !== s || s.closing) return;
        if (context.state === 'running') {
          if (current.detail === 'context_suspended') setState({ state: 'open_idle', detail: null });
          return;
        }
        if (context.state === 'closed') {
          if (s.measuring) interrupt('context_closed');
          void failSession(s, 'error', 'context_closed');
          return;
        }
        if (s.measuring) {
          s.measuring = false;
          safePost(s, { cmd: 'stop' });
          interrupt('context_suspended');
        }
        setState({ state: 'error', detail: 'context_suspended' });
      });

      session = s;
      pending = null;
      setState({
        state: 'open_idle',
        detail: null,
        settings: readTrackSettings(track),
        supported: readSupportedConstraints(md),
      });
      return { ok: true, state: 'open_idle', detail: null };
    } catch {
      await teardown(s);
      if (pending === s) pending = null;
      if (cancelled()) return { ok: false, state: current.state, detail: current.detail };
      return fail('error', step);
    }
  }

  function safePost(s: Session, message: unknown): void {
    try {
      s.node?.port.postMessage(message);
    } catch {
      /* port already closed */
    }
  }

  function handleWorkletMessage(s: Session, data: unknown): void {
    if (session !== s || !s.measuring || typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    if (d.epoch !== s.epoch) return;
    const { firstSampleIndex, n, sumSquares, peak, clippedCount, nonfinite } = d;
    if (
      typeof firstSampleIndex !== 'number' ||
      typeof n !== 'number' ||
      typeof sumSquares !== 'number' ||
      typeof peak !== 'number' ||
      typeof clippedCount !== 'number' ||
      typeof nonfinite !== 'boolean' ||
      !Number.isFinite(firstSampleIndex) ||
      firstSampleIndex < 0 ||
      n !== s.frameLength ||
      !Number.isFinite(sumSquares) ||
      !Number.isFinite(peak) ||
      !Number.isFinite(clippedCount)
    ) {
      return;
    }
    const reduction: FrameReduction = { n, sumSquares, peak, clippedCount, nonfinite };
    const frameIndex = Math.round(firstSampleIndex / s.frameLength);
    options.onFrame(frameFromReduction(frameIndex, firstSampleIndex, s.context.sampleRate, reduction));
  }

  return {
    open(): Promise<MicOpenResult> {
      if (session !== null && !session.closing) {
        const usable = current.state === 'open_idle' || current.state === 'measuring';
        return Promise.resolve({ ok: usable, state: current.state, detail: current.detail });
      }
      if (opening !== null) return opening;
      opening = doOpen().finally(() => {
        opening = null;
      });
      return opening;
    },

    startMeasurement(): boolean {
      const s = session;
      if (s === null || s.closing || current.state !== 'open_idle') return false;
      s.epoch += 1;
      s.measuring = true;
      safePost(s, { cmd: 'start', epoch: s.epoch });
      setState({ state: 'measuring', detail: null });
      return true;
    },

    stopMeasurement(): void {
      const s = session;
      if (s === null || s.closing || !s.measuring) return;
      s.measuring = false;
      safePost(s, { cmd: 'stop' });
      if (current.state === 'measuring') setState({ state: 'open_idle', detail: null });
    },

    shutdown(): Promise<MicShutdownReport> {
      if (shuttingDown !== null) return shuttingDown;
      const s = session ?? pending;
      generation += 1; // cancels an open() that is still waiting for the permission prompt
      session = null;
      pending = null;
      if (s === null) {
        setState({ state: 'off', detail: null, settings: { ...NULL_SETTINGS } });
        return Promise.resolve(
          lastReport ?? {
            tracksTotal: 0,
            tracksStopped: 0,
            nodesDisconnected: 0,
            contextClosed: false,
            portClosed: false,
            listenersRemoved: 0,
            state: 'off',
          },
        );
      }
      shuttingDown = teardown(s)
        .then((report) => {
          lastReport = report;
          setState({ state: 'off', detail: null, settings: { ...NULL_SETTINGS } });
          return report;
        })
        .finally(() => {
          shuttingDown = null;
        });
      return shuttingDown;
    },

    getState(): MicCaptureState {
      return snapshot();
    },

    getAnalysisSampleRate(): number | null {
      return session !== null && !session.closing ? session.context.sampleRate : null;
    },

    getRequestedConstraints(): MediaStreamConstraints {
      return requested;
    },
  };
}

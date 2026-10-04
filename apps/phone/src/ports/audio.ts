/**
 * Audio port: the only way the app touches the microphone, and the only file in apps/phone
 * that imports `@atr/phone-mic-meter`.
 *
 * Contract (the app never sees raw samples; the worklet reduces every 50 ms frame to scalars):
 *  - `open()` is called only from an explicit user gesture and is the only path to getUserMedia.
 *  - `getSnapshot().state` is the OBSERVED state. `measuring` appears only after the first
 *    analysed frame has actually arrived; it never appears merely because a run was requested
 *    (the package flips its own state at request time, so this port re-derives it).
 *  - Runs return numbers only (level frames, precheck/window summaries).
 *  - `close()` is idempotent and resolves when everything the port owns is released (tracks
 *    stopped, graph disconnected, AudioContext closed); the snapshot reads `off` from then on.
 *
 * Worklet delivery: the processor source ships in the package (`FRAME_PROCESSOR_SOURCE`). The
 * phone build writes it to `frame-processor.js` next to index.html (see vite.config.ts) and this
 * port loads it by module URL from the page's own origin, so the CSP stays `script-src 'self'`
 * (no `blob:` allowance needed).
 */

import { createMicCapture, FRAME_MS, summarizePrecheck, WindowAccumulator } from '@atr/phone-mic-meter';
import type {
  AudioContextCtor,
  AudioWorkletNodeCtor,
  Frame,
  MediaDevicesLike,
  MicCapture,
  MicCaptureState,
  MicInterruptReason,
  PrecheckResultPayload,
  WindowResultPayload,
} from '@atr/phone-mic-meter';
import type {
  MicMode,
  MicSettingsWire,
  MicStateName,
  MicSupportedWire,
  WindowKind,
} from './wire.js';

export type { MicMode, MicSettingsWire as MicSettings, MicStateName as MicState, MicSupportedWire as MicSupported };

export interface AudioSnapshot {
  state: MicStateName;
  /** Browser-reported track settings; null means unknown. Never proof of unprocessed audio. */
  settings: MicSettingsWire;
  /** Browser-reported support; null means getSupportedConstraints() was unavailable (unknown). */
  supported: MicSupportedWire;
  mode: MicMode;
  /** Machine-readable reason behind `error` / failed opens, e.g. `insecure_context`. */
  detail: string | null;
}

export interface LevelFrame {
  frameIndex: number;
  tAudioMs: number;
  dbfs: number;
  /** Provisional voice activity (display hint only). */
  active: boolean;
  clipped: boolean;
}

export interface PrecheckRequest {
  purpose: 'quiet_check' | 'pre_window';
  durationMs: number;
}

export interface WindowRequest {
  kind: WindowKind;
  maxDurationMs: number;
  vadFloorDbfs: number;
}

export type AbortReason = 'discard' | 'interrupted';

export interface PrecheckRun {
  /**
   * Resolves with the summary when the run ends by itself (duration reached) or is interrupted
   * by the device (track ended or muted). Resolves null when the caller aborted it.
   */
  readonly result: Promise<PrecheckResultPayload | null>;
  /** Ends the run now. `interrupted` returns an invalid summary, `discard` returns null. */
  abort(reason: AbortReason): PrecheckResultPayload | null;
}

export interface WindowRun {
  readonly result: Promise<WindowResultPayload | null>;
  /** Early stop: closes the window and resolves `result` with its summary. */
  stop(): void;
  abort(reason: AbortReason): WindowResultPayload | null;
}

export interface OpenOptions {
  /** Ask for the browser defaults instead of requesting processing off (explicit user choice). */
  relaxConstraints?: boolean;
}

export interface AudioPort {
  getSnapshot(): AudioSnapshot;
  subscribe(listener: (snapshot: AudioSnapshot) => void): () => void;
  /** User-gesture only. Never rejects; read the resulting state from the snapshot. */
  open(options?: OpenOptions): Promise<void>;
  /** Abandons a pending permission prompt; a stream that arrives later is stopped at once. */
  cancelOpen(): void;
  /** Full shutdown. Resolves once every resource is released and the state is `off`. */
  close(): Promise<void>;
  precheck(request: PrecheckRequest): PrecheckRun;
  window(request: WindowRequest, onFrame: (frame: LevelFrame) => void): WindowRun;
}

export interface AudioPortDeps {
  mediaDevices: MediaDevicesLike | null | undefined;
  AudioContextCtor: AudioContextCtor | null | undefined;
  AudioWorkletNodeCtor?: AudioWorkletNodeCtor;
  /** Same-origin URL of the worklet module (frame-processor.js). */
  workletModuleUrl: string;
  isSecureContext: boolean;
  mode: MicMode;
  /** Test builds only: supplies a synthetic stream instead of getUserMedia. */
  inputOverride?: () => Promise<MediaStream>;
  /** Replaces worklet loading (tests). */
  loadWorklet?: (context: AudioContext) => Promise<void>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export function createAudioPort(deps: AudioPortDeps): AudioPort {
  return new MeterAudioPort(deps);
}

const UNKNOWN_SETTINGS: MicSettingsWire = {
  auto_gain_control: null,
  echo_cancellation: null,
  noise_suppression: null,
  sample_rate: null,
  channel_count: null,
};

interface ScalarFrame {
  dbfs: number;
  finite: boolean;
  clipped: boolean;
}

interface ActiveRun {
  kind: 'precheck' | 'window';
  /** Frame index (0-based) after which the run is complete: expected frames - 1. */
  lastFrameIndex: number;
  durationMs: number;
  watchdog: unknown;
  /** Called with each received frame; returns true when the run is complete. */
  consume(frame: Frame): boolean;
  /** Summary for a normal close (`early` = stopped before the duration). */
  summarize(early: boolean): unknown;
  interrupted(): unknown;
  finish(payload: unknown): void;
}

class MeterAudioPort implements AudioPort {
  private readonly capture: MicCapture;
  private readonly listeners = new Set<(s: AudioSnapshot) => void>();
  private captureState: MicCaptureState;
  /** Failure found before the package was asked to open (no secure context, no mediaDevices). */
  private local: { state: MicStateName; detail: string } | null = null;
  private snapshot: AudioSnapshot;
  private run: ActiveRun | null = null;
  /** True once the first frame of the current run has arrived. */
  private frameObserved = false;
  private relaxNext = false;

  constructor(private readonly deps: AudioPortDeps) {
    const synthetic = deps.inputOverride !== undefined;
    const real = deps.mediaDevices;
    const mediaDevices: MediaDevicesLike | null | undefined = synthetic
      ? {
          getUserMedia: () => (deps.inputOverride as () => Promise<MediaStream>)(),
          ...(real?.getSupportedConstraints ? { getSupportedConstraints: () => real.getSupportedConstraints?.() as MediaTrackSupportedConstraints } : {}),
        }
      : real
        ? {
            // "Browser defaults" is an explicit user choice after the requested settings failed.
            getUserMedia: (constraints) => {
              if (this.relaxNext) {
                this.relaxNext = false;
                return real.getUserMedia({ audio: true, video: false });
              }
              return real.getUserMedia(constraints);
            },
            ...(real.getSupportedConstraints ? { getSupportedConstraints: () => real.getSupportedConstraints?.() as MediaTrackSupportedConstraints } : {}),
          }
        : real;
    this.capture = createMicCapture({
      mediaDevices,
      AudioContextCtor: deps.AudioContextCtor,
      ...(deps.AudioWorkletNodeCtor ? { AudioWorkletNodeCtor: deps.AudioWorkletNodeCtor } : {}),
      workletModuleUrl: deps.workletModuleUrl,
      ...(deps.loadWorklet ? { loadWorklet: deps.loadWorklet } : {}),
      isSecureContext: synthetic ? true : deps.isSecureContext,
      onState: (s) => {
        this.captureState = s;
        this.publish();
      },
      onFrame: (f) => this.onFrame(f),
      onInterrupt: (reason) => this.onInterrupt(reason),
    });
    this.captureState = this.capture.getState();
    this.snapshot = this.derive();
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

  /** The package announces `measuring` when asked to start; the port only after a frame arrived. */
  private derive(): AudioSnapshot {
    const cs = this.captureState;
    if (this.local !== null && cs.state === 'off') {
      return { state: this.local.state, settings: { ...UNKNOWN_SETTINGS }, supported: cs.supported, mode: this.deps.mode, detail: this.local.detail };
    }
    const state: MicStateName = cs.state === 'measuring' && !this.frameObserved ? 'open_idle' : cs.state;
    return { state, settings: cs.settings, supported: cs.supported, mode: this.deps.mode, detail: cs.detail };
  }

  private publish(): void {
    const next = this.derive();
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const l of [...this.listeners]) l(next);
  }

  // ---- opening / closing ---------------------------------------------------

  async open(options: OpenOptions = {}): Promise<void> {
    const state = this.snapshot.state;
    if (state === 'open_idle' || state === 'measuring' || state === 'permission_pending') return;
    this.local = null;
    if (this.deps.inputOverride === undefined) {
      if (!this.deps.isSecureContext) {
        this.local = { state: 'error', detail: 'insecure_context' };
        this.publish();
        return;
      }
      if (!this.deps.mediaDevices || typeof this.deps.mediaDevices.getUserMedia !== 'function') {
        this.local = { state: 'error', detail: 'no_media_devices' };
        this.publish();
        return;
      }
    }
    // A failed or interrupted session (muted track, suspended context, denied prompt) is cleared
    // before a fresh attempt, so a retry never inherits half-open resources.
    if (this.captureState.state !== 'off') await this.capture.shutdown();
    this.relaxNext = options.relaxConstraints === true;
    await this.capture.open();
    this.relaxNext = false;
  }

  cancelOpen(): void {
    if (this.captureState.state !== 'permission_pending') return;
    void this.capture.shutdown();
  }

  async close(): Promise<void> {
    const run = this.run;
    if (run) {
      this.endRun(run);
      run.finish(null);
    }
    this.local = null;
    await this.capture.shutdown();
    this.frameObserved = false;
    this.publish();
  }

  // ---- runs ----------------------------------------------------------------

  private beginRun(
    kind: 'precheck' | 'window',
    durationMs: number,
    parts: Pick<ActiveRun, 'consume' | 'summarize' | 'interrupted'>,
    finish: (payload: unknown) => void,
  ): ActiveRun {
    if (this.snapshot.state !== 'open_idle') throw new Error('mic_not_open');
    if (this.run) throw new Error('run_active');
    const run: ActiveRun = {
      kind,
      lastFrameIndex: Math.floor(durationMs / FRAME_MS) - 1,
      durationMs,
      watchdog: null,
      ...parts,
      finish,
    };
    this.frameObserved = false;
    if (!this.capture.startMeasurement()) throw new Error('mic_not_open');
    this.run = run;
    // If the audio clock stalls (suspended context, no frames) close the run with what we have.
    const setTimeoutFn = this.deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
    run.watchdog = setTimeoutFn(() => {
      if (this.run !== run) return;
      this.endRun(run);
      run.finish(run.summarize(false));
    }, durationMs + 2000);
    return run;
  }

  /** Detaches a run: stops measurement, clears the watchdog, returns the mic to idle. */
  private endRun(run: ActiveRun): void {
    if (this.run !== run) return;
    this.run = null;
    const clear = this.deps.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as number));
    clear(run.watchdog);
    this.capture.stopMeasurement();
    this.frameObserved = false;
    this.publish();
  }

  precheck(request: PrecheckRequest): PrecheckRun {
    const frames: ScalarFrame[] = [];
    let resolve!: (v: PrecheckResultPayload | null) => void;
    const result = new Promise<PrecheckResultPayload | null>((r) => {
      resolve = r;
    });
    const summarize = (interrupted: boolean): PrecheckResultPayload =>
      summarizePrecheck(frames, { purpose: request.purpose, durationMs: request.durationMs, interrupted });
    const run = this.beginRun(
      'precheck',
      request.durationMs,
      {
        consume: (frame) => {
          frames.push({ dbfs: frame.dbfs, finite: frame.finite, clipped: frame.clipped });
          return frame.frameIndex >= run.lastFrameIndex;
        },
        summarize: () => summarize(false),
        interrupted: () => summarize(true),
      },
      (payload) => resolve(payload as PrecheckResultPayload | null),
    );
    return {
      result,
      abort: (reason) => {
        if (this.run !== run) return null;
        const payload = reason === 'interrupted' ? summarize(true) : null;
        this.endRun(run);
        run.finish(null);
        return payload;
      },
    };
  }

  window(request: WindowRequest, onFrame: (frame: LevelFrame) => void): WindowRun {
    const sampleRate = this.capture.getAnalysisSampleRate();
    if (sampleRate === null) throw new Error('mic_not_open');
    const acc = new WindowAccumulator({
      kind: request.kind,
      maxDurationMs: request.maxDurationMs,
      sessionFloorDbfs: request.vadFloorDbfs,
      sampleRate,
    });
    let resolve!: (v: WindowResultPayload | null) => void;
    const result = new Promise<WindowResultPayload | null>((r) => {
      resolve = r;
    });
    const run = this.beginRun(
      'window',
      request.maxDurationMs,
      {
        consume: (frame) => {
          const level = acc.push(frame);
          if (level !== null) {
            onFrame({
              frameIndex: level.frame_index,
              tAudioMs: level.t_audio_ms,
              dbfs: level.dbfs,
              active: level.active,
              clipped: level.clipped,
            });
          }
          return frame.frameIndex >= acc.maxFrames - 1;
        },
        summarize: (early) =>
          early ? acc.finish('early_stop') : acc.finish('complete', { durationMs: request.maxDurationMs }),
        interrupted: () => acc.finish('interrupted'),
      },
      (payload) => resolve(payload as WindowResultPayload | null),
    );
    return {
      result,
      stop: () => {
        if (this.run !== run) return;
        const payload = run.summarize(true);
        this.endRun(run);
        run.finish(payload);
      },
      abort: (reason) => {
        if (this.run !== run) return null;
        const payload = reason === 'interrupted' ? (run.interrupted() as WindowResultPayload) : null;
        this.endRun(run);
        run.finish(null);
        return payload;
      },
    };
  }

  private onFrame(frame: Frame): void {
    const run = this.run;
    if (!run) return;
    // The first frame that actually arrives is what makes the mic "measuring".
    if (!this.frameObserved) {
      this.frameObserved = true;
      this.publish();
    }
    if (run.consume(frame)) {
      const payload = run.summarize(false);
      this.endRun(run);
      run.finish(payload);
    }
  }

  /** The device took capture away mid-run (track ended or muted, context suspended or closed). */
  private onInterrupt(_reason: MicInterruptReason): void {
    const run = this.run;
    if (!run) return;
    const payload = run.interrupted();
    this.endRun(run);
    run.finish(payload);
  }
}

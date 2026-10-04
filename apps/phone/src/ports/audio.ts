/**
 * Audio port: the only way the app touches the microphone.
 *
 * Contract (the app never sees raw samples):
 *  - `open()` is called only from an explicit user gesture and is the only path to getUserMedia.
 *  - `getSnapshot().state` is the OBSERVED state. `measuring` appears only after the first
 *    analysed frame has actually arrived; it never appears merely because a run was requested.
 *  - Runs return numbers only (level frames, precheck/window summaries).
 *  - `close()` is idempotent and releases everything the port owns (tracks, graph, context).
 *
 * `src/audio/capture.ts` is a TEMPORARY implementation. When `@atr/phone-mic-meter`
 * (`createMicCapture`, PrecheckResult/WindowResult builders) is merged, `createAudioPort`
 * below is re-implemented on top of the package and this interface stays unchanged.
 */

import type {
  MicMode,
  MicSettingsWire,
  MicStateName,
  MicSupportedWire,
  PrecheckResultPayload,
  WindowKind,
  WindowResultPayload,
} from './wire.js';

export type {
  MicMode,
  MicSettingsWire as MicSettings,
  MicStateName as MicState,
  MicSupportedWire as MicSupported,
};

export interface AudioSnapshot {
  state: MicStateName;
  /** Browser-reported track settings; null means unknown. Never proof of unprocessed audio. */
  settings: MicSettingsWire;
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
   * by the port (track ended). Resolves null when the caller aborted it.
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
  /** Full shutdown: stop tracks, disconnect and close the audio graph, clear buffers. */
  close(): void;
  precheck(request: PrecheckRequest): PrecheckRun;
  window(request: WindowRequest, onFrame: (frame: LevelFrame) => void): WindowRun;
}

export { createAudioPort } from '../audio/capture.js';
export type { CaptureDeps as AudioPortDeps } from '../audio/capture.js';

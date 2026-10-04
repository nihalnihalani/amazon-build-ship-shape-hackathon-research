/**
 * Window accumulator (ADR-0001 §6): consumes frames between `window.start` and
 * `window.stop`, emits live level frames, and produces the WindowResultPayload.
 *
 * Definitions fixed here where ADR-0001 leaves room (each is also in docs/MEASUREMENT.md):
 *  - frame_count = frames received (finite or not); nonfinite_frames of them are non-finite.
 *  - coverage = finite_frames / expected_frames, capped to [0, 1]; expected_frames =
 *    floor(duration_ms / 50). Missing frames (a dropout) therefore lower coverage.
 *  - accepted-active frames = finite frames inside the span [onsetFrame, endFrame] of an
 *    accepted VAD segment (bridged hangover gaps of at most 250 ms are inside the span).
 *    p50_active_dbfs and p95_active_dbfs are nearest-rank over their dBFS values.
 *  - clipped_frames reports every clipped frame in the window; the `clipped` validity rule
 *    counts only clipped frames inside accepted activity (rejected segments contribute
 *    nothing), as a fraction of accepted-active frames, and fails when it exceeds 2 %.
 *  - nonfinite validity: nonfinite_frames / frame_count > 5 %.
 *  - peak_dbfs = dBFS of the largest finite |x| over the whole window (null without finite frames).
 *  - continuous_sound (phrase only): active_ms / duration_ms > 0.95 AND the last accepted
 *    segment was still open when the window closed (no offset was observed).
 *
 * Invalid-reason priority (first match wins): interrupted, low_coverage, clipped,
 * nonfinite, no_voice, continuous_sound (the order of ADR-0001 §6, interrupted first).
 */

import {
  CMP_TOLERANCE_DB,
  CONTINUOUS_FRACTION,
  DBFS_MIN,
  FRAME_MS,
  MAX_LEVEL_FRAMES,
  MIN_ACTIVE_MS,
  WINDOW_CLIPPED_ACTIVE_FRACTION_MAX,
  WINDOW_COVERAGE_MIN,
  WINDOW_NONFINITE_FRACTION_MAX,
} from './constants.js';
import { frameSamples, peakToDbfs } from './frame.js';
import type { Frame } from './frame.js';
import { percentile } from './percentile.js';
import type { AcceptedSegment } from './vad.js';
import { VoiceActivityTracker } from './vad.js';
import type { LevelPayload, WindowInvalidReason, WindowKind, WindowResultPayload } from './types.js';

export interface WindowAccumulatorOptions {
  kind: WindowKind;
  /** Commanded maximum window duration (calibration 6000, phrase 8000, vowel ≤ 30000). */
  maxDurationMs: number;
  /** `vad_floor_dbfs` from `window.start`. */
  sessionFloorDbfs: number;
  sampleRate: number;
}

export type WindowFinishReason = 'complete' | 'early_stop' | 'interrupted';

export interface WindowFinishOptions {
  /**
   * Audio-clock duration at stop. Defaults to the end of the last received frame, capped at
   * maxDurationMs. Pass the true elapsed audio time to make a tail dropout reduce coverage.
   */
  durationMs?: number;
}

interface FrameRecord {
  finite: boolean;
  dbfs: number;
  clipped: boolean;
  peak: number;
}

export class WindowAccumulator {
  readonly kind: WindowKind;
  readonly maxDurationMs: number;
  readonly sessionFloorDbfs: number;
  readonly sampleRate: number;
  /** Maximum frames accepted: min(700, floor(maxDurationMs / 50)). */
  readonly maxFrames: number;

  private readonly vad: VoiceActivityTracker;
  private readonly records = new Map<number, FrameRecord>();
  private readonly frameDurationMs: number;
  private highestIndex = -1;
  private emitted = 0;
  private result: WindowResultPayload | null = null;

  constructor(options: WindowAccumulatorOptions) {
    if (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0) {
      throw new RangeError('maxDurationMs must be a positive finite number');
    }
    this.kind = options.kind;
    this.maxDurationMs = options.maxDurationMs;
    this.sessionFloorDbfs = options.sessionFloorDbfs;
    this.sampleRate = options.sampleRate;
    this.frameDurationMs = (frameSamples(options.sampleRate) * 1000) / options.sampleRate;
    this.maxFrames = Math.min(MAX_LEVEL_FRAMES, Math.floor(options.maxDurationMs / FRAME_MS));
    this.vad = new VoiceActivityTracker(options.sessionFloorDbfs);
  }

  /** Frames accepted so far. */
  get frameCount(): number {
    return this.records.size;
  }

  /** Level frames returned so far; never exceeds maxFrames (≤ 700). */
  get levelFramesEmitted(): number {
    return this.emitted;
  }

  get finished(): boolean {
    return this.result !== null;
  }

  /**
   * Consume one frame. Returns the live level payload to send for it, or null when the
   * frame is not accepted (finished window, beyond the frame cap, duplicate or out of order).
   */
  push(frame: Frame): LevelPayload | null {
    if (this.result !== null) return null;
    const index = frame.frameIndex;
    if (!Number.isInteger(index) || index < 0 || index >= this.maxFrames) return null;
    if (index <= this.highestIndex) return null;

    this.highestIndex = index;
    this.records.set(index, {
      finite: frame.finite,
      dbfs: frame.dbfs,
      clipped: frame.finite && frame.clipped,
      peak: frame.peak,
    });
    const { candidate } = this.vad.push(frame);
    this.emitted += 1;
    return {
      frame_index: index,
      t_audio_ms: frame.t_audio_ms,
      dbfs: frame.finite ? frame.dbfs : DBFS_MIN,
      active: candidate,
      clipped: frame.finite && frame.clipped,
    };
  }

  /** Close the window and build the summary. Idempotent: later calls return the first result. */
  finish(reason: WindowFinishReason, options: WindowFinishOptions = {}): WindowResultPayload {
    if (this.result !== null) return { ...this.result };

    const defaultDuration =
      this.highestIndex < 0
        ? 0
        : Math.min(this.maxDurationMs, (this.highestIndex + 1) * this.frameDurationMs);
    let durationMs = options.durationMs ?? defaultDuration;
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
    if (durationMs > this.maxDurationMs) durationMs = this.maxDurationMs;

    const segments = this.vad.finish();
    this.result = this.summarize(reason, durationMs, segments);
    return { ...this.result };
  }

  private summarize(
    reason: WindowFinishReason,
    durationMs: number,
    segments: AcceptedSegment[],
  ): WindowResultPayload {
    const expectedFrames = Math.floor(durationMs / FRAME_MS);

    let finiteFrames = 0;
    let nonfiniteFrames = 0;
    let clippedFrames = 0;
    let peak = -1;
    for (const r of this.records.values()) {
      if (!r.finite) {
        nonfiniteFrames += 1;
        continue;
      }
      finiteFrames += 1;
      if (r.clipped) clippedFrames += 1;
      if (r.peak > peak) peak = r.peak;
    }
    const frameCount = this.records.size;
    const coverage = expectedFrames === 0 ? 0 : Math.min(1, finiteFrames / expectedFrames);

    // Accepted-active frames: finite frames inside accepted-segment spans.
    const activeLevels: number[] = [];
    let activeClipped = 0;
    for (const seg of segments) {
      for (let i = seg.onsetFrame; i <= seg.endFrame; i++) {
        const r = this.records.get(i);
        if (r === undefined || !r.finite) continue;
        activeLevels.push(r.dbfs);
        if (r.clipped) activeClipped += 1;
      }
    }

    let activeMs = 0;
    let longestMs = 0;
    for (const seg of segments) {
      const span = seg.end_ms - seg.onset_ms;
      activeMs += span;
      if (span > longestMs) longestMs = span;
    }
    const first = segments[0];

    const reasonCode = this.invalidReason({
      reason,
      coverage,
      activeClipped,
      activeFrames: activeLevels.length,
      nonfiniteFrames,
      frameCount,
      segmentCount: segments.length,
      activeMs,
      durationMs,
    });

    return {
      kind: this.kind,
      valid: reasonCode === null,
      invalid_reason: reasonCode,
      frame_count: frameCount,
      expected_frames: expectedFrames,
      coverage,
      active_ms: activeMs,
      longest_active_ms: longestMs,
      segments: segments.length,
      onset_ms: first === undefined ? null : first.onset_ms,
      p50_active_dbfs: percentile(activeLevels, 50),
      p95_active_dbfs: percentile(activeLevels, 95),
      peak_dbfs: peak < 0 ? null : peakToDbfs(peak),
      clipped_frames: clippedFrames,
      nonfinite_frames: nonfiniteFrames,
      duration_ms: durationMs,
    };
  }

  private invalidReason(f: {
    reason: WindowFinishReason;
    coverage: number;
    activeClipped: number;
    activeFrames: number;
    nonfiniteFrames: number;
    frameCount: number;
    segmentCount: number;
    activeMs: number;
    durationMs: number;
  }): WindowInvalidReason | null {
    if (f.reason === 'interrupted') return 'interrupted';
    if (f.coverage < WINDOW_COVERAGE_MIN) return 'low_coverage';
    if (
      f.activeFrames > 0 &&
      f.activeClipped / f.activeFrames > WINDOW_CLIPPED_ACTIVE_FRACTION_MAX + CMP_TOLERANCE_DB
    ) {
      return 'clipped';
    }
    if (f.frameCount > 0 && f.nonfiniteFrames / f.frameCount > WINDOW_NONFINITE_FRACTION_MAX) {
      return 'nonfinite';
    }
    const needsMinimum = this.kind === 'calibration' || this.kind === 'phrase';
    if (f.segmentCount === 0 || (needsMinimum && f.activeMs < MIN_ACTIVE_MS)) return 'no_voice';
    if (
      this.kind === 'phrase' &&
      f.durationMs > 0 &&
      f.activeMs / f.durationMs > CONTINUOUS_FRACTION &&
      this.vad.lastSegmentUnterminated
    ) {
      return 'continuous_sound';
    }
    return null;
  }
}

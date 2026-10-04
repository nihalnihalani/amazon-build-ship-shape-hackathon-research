/**
 * Sample-accurate framer (ADR-0001 §1). Accepts arbitrary chunk sizes (for example the
 * 128-sample render quanta of an AudioWorklet) and emits one Frame per complete
 * `round(sampleRate × 0.050)` samples. Samples are reduced as they arrive; no sample
 * buffer is kept, so raw audio never accumulates here.
 *
 * The frame clock is the sample count, not a timer: frame k starts at sample
 * k × frameLength, so t_audio_ms is exact and independent of how chunks were delivered.
 */

import { createReduction, frameFromReduction, frameSamples, reduceInto } from './frame.js';
import type { Frame, FrameReduction } from './frame.js';

export class SampleFramer {
  readonly sampleRate: number;
  readonly frameLength: number;

  private acc: FrameReduction = createReduction();
  private nextFrameIndex = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.frameLength = frameSamples(sampleRate);
    if (this.frameLength < 1) throw new RangeError('sampleRate too low for a 50 ms frame');
  }

  /** Samples buffered in the current incomplete frame (as scalars; there is no sample buffer). */
  get pendingSamples(): number {
    return this.acc.n;
  }

  /** Total samples consumed since the last reset, including the incomplete frame. */
  get totalSamples(): number {
    return this.nextFrameIndex * this.frameLength + this.acc.n;
  }

  /** Feed a chunk; returns the frames completed by it, in order. */
  push(chunk: ArrayLike<number>): Frame[] {
    const out: Frame[] = [];
    let pos = 0;
    const len = chunk.length;
    while (pos < len) {
      const take = Math.min(this.frameLength - this.acc.n, len - pos);
      reduceInto(this.acc, chunk, pos, pos + take);
      pos += take;
      if (this.acc.n === this.frameLength) {
        const frameIndex = this.nextFrameIndex;
        out.push(frameFromReduction(frameIndex, frameIndex * this.frameLength, this.sampleRate, this.acc));
        this.nextFrameIndex = frameIndex + 1;
        this.acc = createReduction();
      }
    }
    return out;
  }

  /**
   * Start a new window or precheck. Any incomplete frame is discarded (frames never straddle
   * a reset) and the next frame is frame 0 starting at sample 0.
   */
  reset(): void {
    this.acc = createReduction();
    this.nextFrameIndex = 0;
  }
}

/**
 * Per-frame reduction and level arithmetic (ADR-0001 §1).
 *
 * Raw samples are reduced to five scalars and discarded. The reduction is a plain
 * left-to-right running sum so that every path (whole frame, chunked framer, inlined
 * AudioWorklet) produces bit-identical results for the same samples.
 */

import {
  CLIP_FRAME_FRACTION,
  CLIP_SAMPLE,
  DBFS_MAX,
  DBFS_MIN,
  EPSILON_RMS,
  FRAME_MS,
} from './constants.js';

/** Scalars that summarize one frame of samples. */
export interface FrameReduction {
  /** Samples seen (finite or not). */
  n: number;
  /** Sum of x² over the finite samples. */
  sumSquares: number;
  /** Largest |x| over the finite samples. */
  peak: number;
  /** Finite samples with |x| ≥ CLIP_SAMPLE. */
  clippedCount: number;
  /** True when any sample was NaN or ±Infinity. */
  nonfinite: boolean;
}

export interface FrameStats {
  /** NaN for non-finite or empty frames (so a consumer that ignores `finite` fails loudly). */
  rms: number;
  /** Clamped to [DBFS_MIN, DBFS_MAX]; NaN for non-finite or empty frames. */
  dbfs: number;
  clipped: boolean;
  finite: boolean;
}

/** One complete analysis frame as seen by the VAD, precheck and window modules. */
export interface Frame {
  /** Index within the current window/precheck (0-based). */
  frameIndex: number;
  /** Index of the first sample of this frame, counted from the framer reset. */
  firstSampleIndex: number;
  /** ADR-0001 §1: (firstSampleIndex / sampleRate) × 1000, computed multiply-first for exactness. */
  t_audio_ms: number;
  /** Frame length on the audio clock: sampleCount × 1000 / sampleRate (50 ms at 48 kHz and 44.1 kHz). */
  duration_ms: number;
  sampleCount: number;
  rms: number;
  dbfs: number;
  /** Largest finite |x| in the frame (linear). */
  peak: number;
  clipped: boolean;
  clippedCount: number;
  finite: boolean;
}

/** Samples per frame: round(sampleRate × 0.050). 2400 at 48 kHz, 2205 at 44.1 kHz. */
export function frameSamples(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive finite number');
  }
  return Math.round((sampleRate * FRAME_MS) / 1000);
}

export function createReduction(): FrameReduction {
  return { n: 0, sumSquares: 0, peak: 0, clippedCount: 0, nonfinite: false };
}

/** Accumulate samples[start, end) into `acc`, strictly left to right. */
export function reduceInto(
  acc: FrameReduction,
  samples: ArrayLike<number>,
  start: number,
  end: number,
): void {
  if (!(start >= 0 && end >= start && end <= samples.length)) {
    throw new RangeError('invalid sample range');
  }
  let sumSquares = acc.sumSquares;
  let peak = acc.peak;
  let clippedCount = acc.clippedCount;
  let nonfinite = acc.nonfinite;
  for (let i = start; i < end; i++) {
    const x = samples[i] as number;
    if (!Number.isFinite(x)) {
      nonfinite = true;
      continue;
    }
    const a = x < 0 ? -x : x;
    sumSquares += x * x;
    if (a > peak) peak = a;
    if (a >= CLIP_SAMPLE) clippedCount += 1;
  }
  acc.sumSquares = sumSquares;
  acc.peak = peak;
  acc.clippedCount = clippedCount;
  acc.nonfinite = nonfinite;
  acc.n += end - start;
}

/** Reduce samples[start, end) as one frame. */
export function reduceFrame(samples: ArrayLike<number>, start: number, end: number): FrameReduction {
  const acc = createReduction();
  reduceInto(acc, samples, start, end);
  return acc;
}

/** dbfs = 20·log10(max(rms, 1e-7)), clamped to [−140, +20]. `rms` must be a non-negative number. */
export function rmsToDbfs(rms: number): number {
  const r = rms > EPSILON_RMS ? rms : EPSILON_RMS;
  const db = 20 * Math.log10(r);
  if (db < DBFS_MIN) return DBFS_MIN;
  if (db > DBFS_MAX) return DBFS_MAX;
  return db;
}

/** Linear peak to dBFS with the same floor and clamp as the RMS level. */
export function peakToDbfs(peak: number): number {
  return rmsToDbfs(peak);
}

export function frameStats(r: FrameReduction): FrameStats {
  const finite = !r.nonfinite && r.n > 0;
  if (!finite) {
    return { rms: Number.NaN, dbfs: Number.NaN, clipped: false, finite: false };
  }
  const rms = Math.sqrt(r.sumSquares / r.n);
  return {
    rms,
    dbfs: rmsToDbfs(rms),
    clipped: r.clippedCount / r.n >= CLIP_FRAME_FRACTION,
    finite: true,
  };
}

/** Build a Frame from a reduction. Shared by the framer and the browser adapter. */
export function frameFromReduction(
  frameIndex: number,
  firstSampleIndex: number,
  sampleRate: number,
  r: FrameReduction,
): Frame {
  const stats = frameStats(r);
  return {
    frameIndex,
    firstSampleIndex,
    t_audio_ms: (firstSampleIndex * 1000) / sampleRate,
    duration_ms: (r.n * 1000) / sampleRate,
    sampleCount: r.n,
    rms: stats.rms,
    dbfs: stats.dbfs,
    peak: r.peak,
    clipped: stats.clipped,
    clippedCount: r.clippedCount,
    finite: stats.finite,
  };
}

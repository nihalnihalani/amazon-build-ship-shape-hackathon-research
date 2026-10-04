import type { Frame } from '../src/frame.js';

export interface DbFrameOptions {
  finite?: boolean;
  clipped?: boolean;
  /** Linear peak; defaults to 10^(dbfs/20). */
  peak?: number;
}

/** A 50 ms / 48 kHz frame with a chosen level. Tests use this to feed dBFS sequences directly. */
export function dbFrame(frameIndex: number, dbfs: number, options: DbFrameOptions = {}): Frame {
  const finite = options.finite ?? true;
  const clipped = finite && (options.clipped ?? false);
  return {
    frameIndex,
    firstSampleIndex: frameIndex * 2400,
    t_audio_ms: frameIndex * 50,
    duration_ms: 50,
    sampleCount: 2400,
    rms: finite ? 10 ** (dbfs / 20) : Number.NaN,
    dbfs: finite ? dbfs : Number.NaN,
    peak: options.peak ?? (finite ? 10 ** (dbfs / 20) : 0),
    clipped,
    clippedCount: clipped ? 2400 : 0,
    finite,
  };
}

/** A non-finite frame (NaN/Infinity in the samples). */
export function nonfiniteFrame(frameIndex: number): Frame {
  return dbFrame(frameIndex, 0, { finite: false });
}

/** Frames 0..n-1 from a list of dBFS levels. */
export function framesFromDb(levels: ReadonlyArray<number>, firstIndex = 0): Frame[] {
  return levels.map((db, i) => dbFrame(firstIndex + i, db));
}

/** Expand [[level, count], ...] into a flat list of levels. */
export function runs(spec: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (const [level, count] of spec) {
    for (let i = 0; i < count; i++) out.push(level);
  }
  return out;
}

/** Deterministic permutation (stride coprime to n) so that statistics are shown to be order independent. */
export function strideShuffle<T>(items: ReadonlyArray<T>, stride: number): T[] {
  const n = items.length;
  const out: T[] = new Array<T>(n);
  for (let i = 0; i < n; i++) out[(i * stride) % n] = items[i] as T;
  return out;
}

/** Sine of amplitude `amplitude` and frequency `hz`, float32, `count` samples at `sampleRate`. */
export function sine(amplitude: number, hz: number, sampleRate: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** Small deterministic PRNG (mulberry32) for test signals. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

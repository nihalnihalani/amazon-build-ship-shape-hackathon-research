/**
 * TEMPORARY relative-level DSP for the phone app, following ADR-0001. It exists so the app
 * runs end to end until `@atr/phone-mic-meter` is merged; that package is authoritative and
 * replaces this file. Everything here is plain numbers: no sample buffers are kept.
 *
 * Product assumptions (ADR-0001) used here:
 *  frame 50 ms; dbfs = 20 log10(max(rms, 1e-7)) clamped to [-140, +20]; clipped sample |x| >= 0.999,
 *  clipped frame >= 0.5 % of samples; candidate frame rel >= 6 dB; hangover 6 non-candidate frames;
 *  accepted segment >= 4 candidate frames; nearest-rank percentiles.
 */

import { FRAME_MS } from '../config.js';
import type {
  PrecheckInvalidReason,
  PrecheckResultPayload,
  WindowInvalidReason,
  WindowKind,
  WindowResultPayload,
} from '../ports/wire.js';

export interface FrameStat {
  /** Zero-based frame number within the run; time is index * 50 ms on the sample clock. */
  index: number;
  /** False when any sample was NaN/Infinity (or the input was missing): excluded from statistics. */
  finite: boolean;
  dbfs: number;
  clipped: boolean;
}

export const DBFS_MIN = -140;
export const DBFS_MAX = 20;
const RMS_FLOOR = 1e-7;
const CLIP_SAMPLE = 0.999;
const CLIP_FRAME_FRACTION = 0.005;
const CANDIDATE_REL_DB = 6;
const HANGOVER_FRAMES = 6;
const MIN_SEGMENT_FRAMES = 4;

export function frameSizeFor(sampleRate: number): number {
  return Math.round(sampleRate * (FRAME_MS / 1000));
}

export function clampDbfs(v: number): number {
  return Math.min(DBFS_MAX, Math.max(DBFS_MIN, v));
}

/** Reduces one frame's accumulators (computed inside the worklet) to a level. */
export function reduceFrame(
  index: number,
  acc: { sumSq: number; count: number; clipped: number; nonFinite: boolean },
): FrameStat {
  if (acc.nonFinite || acc.count <= 0 || !Number.isFinite(acc.sumSq)) {
    return { index, finite: false, dbfs: DBFS_MIN, clipped: false };
  }
  const rms = Math.sqrt(acc.sumSq / acc.count);
  const dbfs = clampDbfs(20 * Math.log10(Math.max(rms, RMS_FLOOR)));
  return { index, finite: true, dbfs, clipped: acc.clipped / acc.count >= CLIP_FRAME_FRACTION };
}

export const clipSampleThreshold = CLIP_SAMPLE;

/** Nearest-rank percentile of a non-empty ascending array: sorted[ceil(p/100 * n) - 1]. */
export function nearestRank(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAsc[rank - 1] as number;
}

const sortedAsc = (values: number[]): number[] => [...values].sort((a, b) => a - b);

/** Provisional (display-only) activity for a live frame. */
export function isCandidate(frame: FrameStat, vadFloorDbfs: number): boolean {
  return frame.finite && frame.dbfs - vadFloorDbfs >= CANDIDATE_REL_DB;
}

export function summarizePrecheck(
  frames: readonly FrameStat[],
  purpose: 'quiet_check' | 'pre_window',
  expectedFrames: number,
): PrecheckResultPayload {
  const finite = frames.filter((f) => f.finite);
  const clippedFrames = frames.filter((f) => f.clipped).length;
  const nonfiniteFrames = frames.length - finite.length;
  const coverage = expectedFrames > 0 ? Math.min(1, finite.length / expectedFrames) : 0;
  const usable = finite.filter((f) => !f.clipped).map((f) => f.dbfs);
  let floor: number | null = null;
  let p20: number | null = null;
  let p80: number | null = null;
  let p95: number | null = null;
  if (usable.length > 0) {
    const s = sortedAsc(usable);
    floor = nearestRank(s, 50);
    p20 = nearestRank(s, 20);
    p80 = nearestRank(s, 80);
    p95 = nearestRank(s, 95);
  }
  let reason: PrecheckInvalidReason | null = null;
  if (nonfiniteFrames > 0.05 * Math.max(1, expectedFrames)) reason = 'nonfinite';
  else if (coverage < 0.9) reason = 'low_coverage';
  else if (clippedFrames > 0) reason = 'clipped';
  else if (floor === null || p20 === null || p80 === null || p95 === null) reason = 'low_coverage';
  else if (p80 - p20 > 6) reason = 'unstable_floor';
  else if (p95 - floor > 10) reason = 'burst_noise';
  else if (floor > -30) reason = 'too_loud';
  return {
    purpose,
    valid: reason === null,
    invalid_reason: reason,
    floor_dbfs: floor,
    p20_dbfs: p20,
    p80_dbfs: p80,
    p95_dbfs: p95,
    frame_count: frames.length,
    expected_frames: expectedFrames,
    coverage,
    clipped_frames: clippedFrames,
    nonfinite_frames: nonfiniteFrames,
    duration_ms: frames.length * FRAME_MS,
  };
}

export function interruptedPrecheck(
  frames: readonly FrameStat[],
  purpose: 'quiet_check' | 'pre_window',
  expectedFrames: number,
): PrecheckResultPayload {
  return { ...summarizePrecheck(frames, purpose, expectedFrames), valid: false, invalid_reason: 'interrupted' };
}

interface Segment {
  first: number;
  last: number;
  candidates: number;
}

/** ADR-0001 section 3: provisional onset, 250 ms hangover bridge, 200 ms minimum accepted segment. */
export function findSegments(frames: readonly FrameStat[], vadFloorDbfs: number): Segment[] {
  const accepted: Segment[] = [];
  let cur: Segment | null = null;
  let gap = 0;
  const close = (): void => {
    if (cur !== null && cur.candidates >= MIN_SEGMENT_FRAMES) accepted.push(cur);
    cur = null;
    gap = 0;
  };
  for (const f of frames) {
    if (isCandidate(f, vadFloorDbfs)) {
      if (cur === null) cur = { first: f.index, last: f.index, candidates: 1 };
      else {
        cur.last = f.index;
        cur.candidates += 1;
      }
      gap = 0;
    } else if (cur !== null) {
      gap += 1;
      if (gap >= HANGOVER_FRAMES) close();
    }
  }
  close();
  return accepted;
}

export function summarizeWindow(
  frames: readonly FrameStat[],
  kind: WindowKind,
  vadFloorDbfs: number,
  expectedFrames: number,
): WindowResultPayload {
  const finite = frames.filter((f) => f.finite);
  const clippedFrames = frames.filter((f) => f.clipped).length;
  const nonfiniteFrames = frames.length - finite.length;
  const coverage = expectedFrames > 0 ? Math.min(1, finite.length / expectedFrames) : 0;
  const segments = findSegments(frames, vadFloorDbfs);
  const durations = segments.map((s) => (s.last - s.first + 1) * FRAME_MS);
  const activeMs = durations.reduce((a, b) => a + b, 0);
  const longest = durations.reduce((a, b) => Math.max(a, b), 0);
  const inSegment = (f: FrameStat): boolean => segments.some((s) => f.index >= s.first && f.index <= s.last);
  const activeFrames = finite.filter(inSegment);
  const activeDb = sortedAsc(activeFrames.map((f) => f.dbfs));
  const activeClipped = activeFrames.filter((f) => f.clipped).length;

  let reason: WindowInvalidReason | null = null;
  if (nonfiniteFrames > 0.05 * Math.max(1, frames.length)) reason = 'nonfinite';
  else if (coverage < 0.9) reason = 'low_coverage';
  else if (segments.length === 0 || (kind !== 'vowel' && activeMs < 400)) reason = 'no_voice';
  else if (activeClipped > 0.02 * Math.max(1, activeFrames.length)) reason = 'clipped';
  else if (kind === 'phrase' && activeMs > 0.95 * expectedFrames * FRAME_MS) reason = 'continuous_sound';

  return {
    kind,
    valid: reason === null,
    invalid_reason: reason,
    frame_count: frames.length,
    expected_frames: expectedFrames,
    coverage,
    active_ms: activeMs,
    longest_active_ms: longest,
    segments: segments.length,
    onset_ms: segments[0] ? segments[0].first * FRAME_MS : null,
    p50_active_dbfs: activeDb.length ? nearestRank(activeDb, 50) : null,
    p95_active_dbfs: activeDb.length ? nearestRank(activeDb, 95) : null,
    peak_dbfs: finite.length ? Math.max(...finite.map((f) => f.dbfs)) : null,
    clipped_frames: clippedFrames,
    nonfinite_frames: nonfiniteFrames,
    duration_ms: frames.length * FRAME_MS,
  };
}

export function interruptedWindow(
  frames: readonly FrameStat[],
  kind: WindowKind,
  vadFloorDbfs: number,
  expectedFrames: number,
): WindowResultPayload {
  return { ...summarizeWindow(frames, kind, vadFloorDbfs, expectedFrames), valid: false, invalid_reason: 'interrupted' };
}

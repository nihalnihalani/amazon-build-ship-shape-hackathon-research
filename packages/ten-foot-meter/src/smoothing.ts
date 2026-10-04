/**
 * Display smoothing for the live arc. DISPLAY ONLY: smoothed values are never fed into verdicts,
 * band decisions or any stored result. Time based, so the visual response does not depend on how
 * many frames the phone happens to send per second.
 */

/**
 * One exponential-smoothing step over `dtMs` milliseconds with time constant `tauMs`:
 * `prev + (target - prev) * (1 - exp(-dt / tau))`. After one tau the value has covered 63.2 % of
 * the gap. A non-positive tau means "no smoothing"; a non-positive dt leaves the value unchanged.
 */
export function smoothStep(prev: number, target: number, dtMs: number, tauMs: number): number {
  if (!(tauMs > 0)) return target;
  if (!(dtMs > 0)) return prev;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return prev + (target - prev) * alpha;
}

export interface SmootherOptions {
  /** Time constant for rising values. Default 120 ms (fast attack so voice onsets stay visible). */
  readonly attackTauMs?: number;
  /** Time constant for falling values. Default 250 ms (slower release avoids flicker). */
  readonly releaseTauMs?: number;
  /** A gap longer than this between frames snaps to the new value instead of gliding. Default 1000 ms. */
  readonly maxGapMs?: number;
}

export interface DisplaySmoother {
  /**
   * Feed one frame. `tMs` is the frame time (audio time when available, else arrival time).
   * Frames that are not newer than the last accepted frame are ignored, never rewound.
   * Returns the current smoothed value, or null before the first finite frame.
   */
  push(target: number, tMs: number): number | null;
  current(): number | null;
  reset(): void;
}

export const DEFAULT_ATTACK_TAU_MS = 120;
export const DEFAULT_RELEASE_TAU_MS = 250;
export const DEFAULT_MAX_GAP_MS = 1000;

export function createDisplaySmoother(options: SmootherOptions = {}): DisplaySmoother {
  const attack = options.attackTauMs ?? DEFAULT_ATTACK_TAU_MS;
  const release = options.releaseTauMs ?? DEFAULT_RELEASE_TAU_MS;
  const maxGap = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  let value: number | null = null;
  let lastT: number | null = null;

  return {
    push(target: number, tMs: number): number | null {
      if (!Number.isFinite(target) || !Number.isFinite(tMs)) return value;
      if (value === null || lastT === null) {
        value = target;
        lastT = tMs;
        return value;
      }
      const dt = tMs - lastT;
      if (!(dt > 0)) return value;
      lastT = tMs;
      if (dt > maxGap) {
        value = target;
        return value;
      }
      value = smoothStep(value, target, dt, target >= value ? attack : release);
      return value;
    },
    current(): number | null {
      return value;
    },
    reset(): void {
      value = null;
      lastT = null;
    },
  };
}

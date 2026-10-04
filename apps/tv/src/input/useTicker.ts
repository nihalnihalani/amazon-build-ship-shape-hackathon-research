import { useEffect } from 'react';
import type { TvInput } from '@atr/session-core';

export const TICK_INTERVAL_MS = 200;

/** Dispatches `{ kind: 'timer', now }` every 200 ms so the session core can run windows and timeouts. */
export function useTicker(
  dispatch: (input: TvInput) => void,
  intervalMs: number = TICK_INTERVAL_MS,
  now: () => number = Date.now,
): void {
  useEffect(() => {
    const handle = setInterval(() => dispatch({ kind: 'timer', now: now() }), intervalMs);
    return () => clearInterval(handle);
  }, [dispatch, intervalMs, now]);
}

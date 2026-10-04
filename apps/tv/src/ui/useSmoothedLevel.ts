import { useEffect, useRef, useState } from 'react';
import { createDisplaySmoother } from '@atr/ten-foot-meter';

/**
 * Display smoothing of the relative level for the arc. DISPLAY ONLY: never used for verdicts, never stored.
 * The view carries no audio timestamp, so frame arrival time is used as the smoothing clock (the smoother
 * ignores frames that are not newer and snaps after a long gap).
 */
export function useSmoothedLevel(level: number | null, now: () => number = Date.now): number | null {
  const smoother = useRef(createDisplaySmoother());
  const [smoothed, setSmoothed] = useState<number | null>(level);
  useEffect(() => {
    if (level === null) {
      smoother.current.reset();
      setSmoothed(null);
      return;
    }
    setSmoothed(smoother.current.push(level, now()));
  }, [level, now]);
  return smoothed;
}

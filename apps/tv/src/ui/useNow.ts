import { useEffect, useState } from 'react';

/** Current time in ms, refreshed on an interval. Only used for labels that count down (code expiry, cue chip). */
export function useNow(intervalMs: number, enabled: boolean = true): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs, enabled]);
  return now;
}

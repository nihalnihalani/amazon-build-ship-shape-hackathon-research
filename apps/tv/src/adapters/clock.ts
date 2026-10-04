import type { ClockPort } from '@atr/session-core';

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/** Local calendar date as YYYY-MM-DD in the TV's own time zone (no Intl dependency). */
export function localDateString(epochMs: number): string {
  const d = new Date(epochMs);
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

export function createClock(): ClockPort {
  return {
    now: () => Date.now(),
    localDate: localDateString,
  };
}

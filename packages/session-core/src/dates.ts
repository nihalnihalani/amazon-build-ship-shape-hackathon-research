/** Calendar-date helpers (YYYY-MM-DD). No time zones are involved: dates are treated as abstract calendar days. */

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date: month 1..12 and a day that exists in that month (leap years included). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_SHAPE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** UTC calendar date of an epoch time, the fallback when the injected clock returns something that is not a date. */
export function utcDate(epochMs: number): string {
  const t = new Date(epochMs);
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${mm}-${dd}`;
}

/**
 * The clock's local date, validated. A clock that returns anything but a real calendar date (QA-11) is replaced by
 * the UTC date of the same instant, and `onInvalid` is told so the problem can be counted.
 */
export function safeLocalDate(localDate: (epochMs: number) => string, epochMs: number, onInvalid?: () => void): string {
  let value: unknown;
  try {
    value = localDate(epochMs);
  } catch {
    value = null;
  }
  if (isCalendarDate(value)) return value;
  onInvalid?.();
  return utcDate(epochMs);
}

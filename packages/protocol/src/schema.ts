/**
 * Tiny schema combinators used by the payload validators. Internal to the
 * package (not exported from index.ts). A check returns `null` when the value
 * is acceptable, otherwise a short static description.
 *
 * Failure strings never contain input content (only schema field paths), so
 * they are safe to copy into `error.detail` and logs.
 */

import { isCoverageQuantized, isDbQuantized } from './quantize.js';
import { codePointLength, containsControlChars, displaySafe, hasLoneSurrogate, validateUserText } from './text.js';
import type { TextRejection } from './text.js';

export type Check = (value: unknown, path: string) => string | null;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Plain data object (prototype Object.prototype or null), not an array. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Own enumerable string keys of a plain data object, or null when the object has
 * symbol keys or accessor properties (values must be inert data, not getters).
 */
export function dataKeys(o: Record<string, unknown>): string[] | null {
  if (Object.getOwnPropertySymbols(o).length > 0) return null;
  const keys = Object.keys(o);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || !('value' in d)) return null;
  }
  // Non-enumerable own properties are not part of the JSON data model either.
  if (Object.getOwnPropertyNames(o).length !== keys.length) return null;
  return keys;
}

export const bool: Check = (v, p) => (typeof v === 'boolean' ? null : `${p}: expected boolean`);

export function int(min: number, max: number): Check {
  return (v, p) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${p}: expected finite number`;
    if (!Number.isInteger(v)) return `${p}: expected integer`;
    if (v < min || v > max) return `${p}: out of range`;
    return null;
  };
}

export function num(min: number, max: number): Check {
  return (v, p) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${p}: expected finite number`;
    if (v < min || v > max) return `${p}: out of range`;
    return null;
  };
}

export function oneOf(values: readonly string[]): Check {
  return (v, p) => (typeof v === 'string' && values.includes(v) ? null : `${p}: not an allowed value`);
}

export function literal(expected: string | number | boolean): Check {
  return (v, p) => (v === expected ? null : `${p}: unexpected value`);
}

export function pattern(re: RegExp): Check {
  return (v, p) => (typeof v === 'string' && re.test(v) ? null : `${p}: bad format`);
}

export function nullable(inner: Check): Check {
  return (v, p) => (v === null ? null : inner(v, p));
}

/** Plain string with a code point length range; no control characters or lone surrogates. */
export function str(min: number, max: number): Check {
  return (v, p) => {
    if (typeof v !== 'string') return `${p}: expected string`;
    if (hasLoneSurrogate(v)) return `${p}: invalid text`;
    if (containsControlChars(v)) return `${p}: control characters`;
    const n = codePointLength(v);
    if (n < min) return `${p}: too short`;
    if (n > max) return `${p}: too long`;
    return null;
  };
}

const TEXT_REASON: Record<TextRejection, string> = {
  not_string: 'expected string',
  lone_surrogate: 'invalid text',
  control_chars: 'control characters',
  not_normalized: 'text not normalized',
  too_short: 'too short',
  too_long: 'too long',
  forbidden_char: 'forbidden character',
  no_visible_content: 'no visible content',
  combining_run: 'too many combining marks',
};

/**
 * Plain string (control characters and lone surrogates rejected, length in code points)
 * that must also be display safe (revision 4, PK-03). Not required to be NFC; used for
 * `app_version`.
 */
export function displayStr(min: number, max: number): Check {
  const plain = str(min, max);
  return (v, p) => {
    const e = plain(v, p);
    if (e) return e;
    const verdict = displaySafe(v as string);
    return verdict === 'ok' ? null : `${p}: ${TEXT_REASON[verdict]}`;
  };
}

/** Finite number in `min..max` that is a multiple of 0.1 (tolerance), revision 4 (PK-06). */
export function dbNum(min: number, max: number): Check {
  const range = num(min, max);
  return (v, p) => {
    const e = range(v, p);
    if (e) return e;
    return isDbQuantized(v as number) ? null : `${p}: not a multiple of 0.1`;
  };
}

/** `coverage`: finite number in 0..1 that is a multiple of 0.001 (tolerance), revision 4 (PK-06). */
export const coverageNum: Check = (() => {
  const range = num(0, 1);
  return (v, p) => {
    const e = range(v, p);
    if (e) return e;
    return isCoverageQuantized(v as number) ? null : `${p}: not a multiple of 0.001`;
  };
})();

/** User text: strict (must already be NFC + trimmed), code point length range. */
export function userText(min: number, max: number): Check {
  return (v, p) => {
    const r = validateUserText(v, min, max);
    return r.ok ? null : `${p}: ${TEXT_REASON[r.reason]}`;
  };
}

export function arrayOf(item: Check, min: number, max: number): Check {
  return (v, p) => {
    if (!Array.isArray(v)) return `${p}: expected array`;
    if (v.length < min) return `${p}: too few items`;
    if (v.length > max) return `${p}: too many items`;
    for (let i = 0; i < v.length; i += 1) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (!d || !('value' in d)) return `${p}[${i}]: not plain data`;
      const e = item(d.value as unknown, `${p}[${i}]`);
      if (e) return e;
    }
    return null;
  };
}

/** Exact-key object: every shape key required, any other key rejected. */
export function obj(shape: Record<string, Check>): Check {
  const keys = Object.keys(shape);
  return (v, p) => {
    if (!isPlainObject(v)) return `${p}: expected object`;
    const own = dataKeys(v);
    if (own === null) return `${p}: not plain data`;
    for (const k of own) {
      if (!hasOwn(shape, k)) return `${p}: unknown field`;
    }
    for (const k of keys) {
      if (!hasOwn(v, k)) return `${p}.${k}: missing`;
      const check = shape[k] as Check;
      const e = check(v[k], `${p}.${k}`);
      if (e) return e;
    }
    return null;
  };
}

/** Run `rule` only after `base` accepted the value. */
export function refine<T>(base: Check, rule: (value: T, path: string) => string | null): Check {
  return (v, p) => {
    const e = base(v, p);
    return e ?? rule(v as T, p);
  };
}

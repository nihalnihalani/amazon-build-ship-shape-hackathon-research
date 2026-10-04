/**
 * Input snapshot (revision 4, PK-01, PK-05).
 *
 * `takeSnapshot` copies an arbitrary input ONCE into plain data. The validators then
 * validate the snapshot and return the snapshot, so nothing that was not validated can
 * reach the caller, whatever the input is (stateful Proxy, getters, a object mutated
 * between reads). The walk is bounded before any serialisation:
 *
 * - at most `SNAPSHOT_MAX_NODES` values and `SNAPSHOT_MAX_DEPTH` levels (a legal message
 *   is far below both; an 8192-byte message cannot contain more nodes than the budget);
 * - an array whose `length` exceeds the node budget is refused without iterating it, so a
 *   sparse `Array(1e8)` costs nothing;
 * - accessors, symbol keys, non-enumerable properties, holes and non-plain objects are
 *   refused; binary containers (typed arrays, ArrayBuffer, Blob, File, ...) become the
 *   `BINARY` marker so the audio guard can report them;
 * - `-0` becomes `0` (PK-05); bigint, symbol and function values become the `INVALID`
 *   marker so a later `JSON.stringify` cannot throw.
 *
 * Own properties are created with `Object.defineProperty`, so a key named `__proto__`
 * becomes an ordinary own key of the copy (and is then rejected as an unknown field).
 */

import { PAYLOAD_MAX_DEPTH } from './constants.js';
import type { ErrorCode } from './types.js';

export const SNAPSHOT_MAX_NODES = 8192;
/** Envelope (1) + payload (up to PAYLOAD_MAX_DEPTH) + slack; deeper input is refused. */
export const SNAPSHOT_MAX_DEPTH = PAYLOAD_MAX_DEPTH + 4;

/** Marker for binary or media containers found in the input. */
export const BINARY: unique symbol = Symbol('atr.binary');
/** Marker for values that can never be valid wire data (bigint, symbol, function). */
export const INVALID: unique symbol = Symbol('atr.invalid');

/** `Object.prototype.toString` tags of binary or media containers (cross-realm safe, no instanceof). */
const BINARY_TAGS: ReadonlySet<string> = new Set([
  '[object ArrayBuffer]',
  '[object SharedArrayBuffer]',
  '[object Blob]',
  '[object File]',
  '[object AudioBuffer]',
  '[object MediaStream]',
]);

export type SnapshotResult =
  | { ok: true; value: unknown }
  | { ok: false; code: ErrorCode; detail: string };

class SnapshotError extends Error {
  readonly code: ErrorCode;
  readonly detail: string;
  constructor(code: ErrorCode, detail: string) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}

function notPlain(): SnapshotError {
  return new SnapshotError('bad_schema', 'message is not plain data');
}

function isPlainObjectLike(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function copy(value: unknown, depth: number, budget: { n: number }): unknown {
  budget.n += 1;
  if (budget.n > SNAPSHOT_MAX_NODES) throw new SnapshotError('payload_too_large', 'message exceeds the size limit');

  switch (typeof value) {
    case 'string':
    case 'boolean':
    case 'undefined':
      return value;
    case 'number':
      return value === 0 ? 0 : value; // normalises -0 to 0 (PK-05); NaN and Infinity stay for the schema to reject
    case 'bigint':
    case 'symbol':
    case 'function':
      return INVALID;
    default:
      break;
  }
  if (value === null) return null;

  const obj = value as object;
  if (depth >= SNAPSHOT_MAX_DEPTH) throw new SnapshotError('bad_schema', 'message nested too deeply');
  if (ArrayBuffer.isView(obj) || BINARY_TAGS.has(Object.prototype.toString.call(obj))) return BINARY;

  if (Array.isArray(obj)) {
    const length = obj.length;
    if (typeof length !== 'number' || !(length <= SNAPSHOT_MAX_NODES)) {
      throw new SnapshotError('payload_too_large', 'message exceeds the size limit');
    }
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
      const d = Object.getOwnPropertyDescriptor(obj, String(i));
      if (!d || !('value' in d)) throw notPlain();
      out.push(copy(d.value as unknown, depth + 1, budget));
    }
    return out;
  }

  if (!isPlainObjectLike(obj)) throw notPlain();
  if (Object.getOwnPropertySymbols(obj).length > 0) throw notPlain();
  const names = Object.getOwnPropertyNames(obj);
  if (names.length > SNAPSHOT_MAX_NODES) {
    throw new SnapshotError('payload_too_large', 'message exceeds the size limit');
  }
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || !('value' in d) || d.enumerable !== true) throw notPlain();
    Object.defineProperty(out, name, {
      value: copy(d.value as unknown, depth + 1, budget),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * Copy `input` once into plain data (see the module comment). Never throws: a hostile
 * input that makes the walk throw (for example a Proxy trap) is reported as `bad_schema`.
 */
export function takeSnapshot(input: unknown): SnapshotResult {
  try {
    return { ok: true, value: copy(input, 0, { n: 0 }) };
  } catch (e) {
    if (e instanceof SnapshotError) return { ok: false, code: e.code, detail: e.detail };
    return { ok: false, code: 'bad_schema', detail: 'message is not plain data' };
  }
}

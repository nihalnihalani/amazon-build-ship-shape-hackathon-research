import { expect } from 'vitest';
import { ERROR_CODES, MESSAGE_ID_RE, parseWireMessage, validateMessageObject } from '../src/index.js';
import type { ErrorCode, ParseResult } from '../src/index.js';
import { NOW } from './fixtures.js';
import type { Json } from './fixtures.js';

export const OPTS = { now: NOW };

export const DELETE = Symbol('delete');

export type PathSeg = string | number;

/** Return a deep copy of `message` with the value at `path` replaced (or deleted). */
export function patched(message: Json, path: string, value: unknown): Json {
  const copy = JSON.parse(JSON.stringify(message)) as Json;
  const segs: PathSeg[] = path.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  let node = copy as unknown as Record<PathSeg, unknown>;
  for (let i = 0; i < segs.length - 1; i += 1) {
    node = node[segs[i] as PathSeg] as Record<PathSeg, unknown>;
  }
  const last = segs[segs.length - 1] as PathSeg;
  if (value === DELETE) {
    delete node[last];
  } else {
    node[last] = value;
  }
  return copy;
}

/** Object path with raw values (so NaN and Infinity survive), without JSON round trip. */
export function patchedRaw(message: Json, path: string, value: unknown): Json {
  const copy = JSON.parse(JSON.stringify(message)) as Json;
  const segs = path.split('.');
  let node = copy as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i += 1) node = node[segs[i] as string] as Record<string, unknown>;
  node[segs[segs.length - 1] as string] = value;
  return copy;
}

/** Validate through both entry points and require the same verdict. */
export function verdict(message: unknown): ParseResult {
  const viaObject = validateMessageObject(message, OPTS);
  const viaText = parseWireMessage(JSON.stringify(message), OPTS);
  expect(viaText.ok).toBe(viaObject.ok);
  if (!viaText.ok && !viaObject.ok) {
    expect(viaText.code).toBe(viaObject.code);
  }
  return viaObject;
}

export function expectOk(message: unknown): void {
  const r = verdict(message);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.detail}`);
}

export function expectFail(message: unknown, code?: ErrorCode): void {
  const r = verdict(message);
  expect(r.ok).toBe(false);
  if (!r.ok && code) expect(r.code).toBe(code);
}

/** Result invariants that must hold for every input. */
export function assertWellFormed(r: ParseResult): void {
  expect(typeof r).toBe('object');
  expect(typeof r.ok).toBe('boolean');
  if (r.ok) {
    expect(typeof r.message.type).toBe('string');
  } else {
    expect((ERROR_CODES as readonly string[]).includes(r.code)).toBe(true);
    expect(typeof r.detail).toBe('string');
    expect(r.detail.length).toBeLessThanOrEqual(64);
    expect(r.ref_message_id === null || MESSAGE_ID_RE.test(r.ref_message_id)).toBe(true);
  }
}

/** Apply several path patches (same path syntax as `patched`). */
export function patchedMany(message: Json, patches: Record<string, unknown>): Json {
  let out = message;
  for (const [path, value] of Object.entries(patches)) out = patched(out, path, value);
  return out;
}

export function codeOf(message: unknown): string {
  const r = validateMessageObject(message, OPTS);
  return r.ok ? 'ok' : r.code;
}

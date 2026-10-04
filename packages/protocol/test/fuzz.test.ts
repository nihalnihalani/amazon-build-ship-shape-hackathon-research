import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, MESSAGE_TYPES, parseWireMessage, utf8ByteLength, validateMessageObject } from '../src/index.js';
import type { ParseResult } from '../src/index.js';
import { NOW, VALID_FIXTURES, clone } from './fixtures.js';
import type { Json } from './fixtures.js';
import { assertWellFormed } from './helpers.js';

const SEED = 0xc0ffee;
const ITERATIONS_PER_PATH = 4000; // 4000 object-level + 4000 text-level mutations

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
const int = (n: number): number => Math.floor(rng() * n);
const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;

const SCALARS: unknown[] = [
  null, true, false, 0, -0, 1, -1, 2, 5000, 1.5, -1.5, 1e308, -1e308, 2 ** 31, 2 ** 31 - 1, 2 ** 53, Number.MAX_SAFE_INTEGER,
  NaN, Infinity, -Infinity, '', ' ', 'x', 'tv', 'phone', 'relay', 'data', 'audio', '\u0000', '\ud800', 'é', 'é',
  '\u{1F600}', 'a'.repeat(61), 'a'.repeat(300), 'm_0123456789abcdefghijkl', 'r_ABCDEFGHIJKLMNOPQRSTUV', 's_session01',
  'ACDEFH', 'ACDEFB', '99', '5000', '__proto__', 'constructor', undefined, 10n, [], [1, 2, 3], Array.from({ length: 20 }, () => 0),
  {}, { a: 1 }, { audio: 'x' }, { data: [] },
];
const SPECIAL_KEYS = ['audio', 'PCM', 'data', 'zz', '__proto__', 'constructor', 'toString', '', 'payload', 'type'];
const CHARS = ['"', '\\', '{', '}', '[', ']', ',', ':', '\u0000', '\ud800', '\ude00', 'é', '\u{1F600}', '\n', ' ', '1', '-', 'e', '9', 'n', 't', 'f', 'null', '1e999', '"a"', '{"data":1}', 'x'.repeat(300)];

interface Slot {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

function randomSlot(root: Json): Slot {
  let parent: Record<string, unknown> | unknown[] = root;
  for (;;) {
    const keys: Array<string | number> = Array.isArray(parent) ? parent.map((_, i) => i) : Object.keys(parent);
    if (keys.length === 0) return { parent, key: 'zz' };
    const key = pick(keys);
    const child = (parent as Record<string | number, unknown>)[key];
    if (typeof child === 'object' && child !== null && rng() < 0.55) {
      parent = child as Record<string, unknown> | unknown[];
      continue;
    }
    return { parent, key };
  }
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function mutateObject(message: Json): unknown {
  const m = clone(message);
  const ops = 1 + int(3);
  for (let i = 0; i < ops; i += 1) {
    const slot = randomSlot(m);
    const target = slot.parent as Record<string | number, unknown>;
    switch (int(8)) {
      case 0:
        if (Array.isArray(slot.parent)) slot.parent.splice(slot.key as number, 1);
        else delete target[slot.key];
        break;
      case 1:
        target[slot.key] = pick(SCALARS);
        break;
      case 2: {
        const child = target[slot.key];
        const dest = typeof child === 'object' && child !== null && !Array.isArray(child) ? (child as Record<string, unknown>) : (slot.parent as Record<string, unknown>);
        if (!Array.isArray(dest)) setOwn(dest, pick(SPECIAL_KEYS), pick(SCALARS));
        break;
      }
      case 3: {
        const keys = Object.keys(m);
        const a = pick(keys);
        const b = pick(keys);
        const tmp = m[a];
        m[a] = m[b];
        m[b] = tmp;
        break;
      }
      case 4:
        m.type = rng() < 0.7 ? pick(MESSAGE_TYPES) : pick(SCALARS);
        break;
      case 5:
        m[pick(['sender_role', 'room_id', 'session_id', 'window_id', 'attempt_id', 'message_id', 'protocol_version'])] = pick(SCALARS);
        break;
      case 6: {
        const v = target[slot.key];
        if (typeof v === 'number') target[slot.key] = pick([v + 1, v - 1, -v, v * 2, v / 2, 0, 700, 701, 35000, 35001]);
        else if (typeof v === 'string') target[slot.key] = v + pick(CHARS);
        break;
      }
      default:
        m[pick(['sequence', 'producer_generation', 'event_timestamp'])] = pick([0, 1, NOW, NOW + 86_400_000, NOW - 86_400_001, -1, 2 ** 53, NaN]);
    }
  }
  return m;
}

function mutateText(message: Json): string {
  let s = JSON.stringify(message);
  const ops = 1 + int(3);
  for (let i = 0; i < ops; i += 1) {
    const at = int(s.length + 1);
    switch (int(6)) {
      case 0:
        s = s.slice(0, at);
        break;
      case 1:
        s = s.slice(0, at) + s.slice(at + 1 + int(8));
        break;
      case 2:
        s = s.slice(0, at) + pick(CHARS) + s.slice(at);
        break;
      case 3:
        s = s.slice(0, at) + pick(CHARS) + s.slice(at + 1);
        break;
      case 4: {
        const piece = s.slice(at, at + 1 + int(20));
        s = s.slice(0, at) + piece + piece + s.slice(at + piece.length);
        break;
      }
      default:
        s = s.slice(0, at) + String(int(100000)) + s.slice(at);
    }
  }
  return s;
}

function check(r: ParseResult, label: string): void {
  try {
    assertWellFormed(r);
    if (r.ok) {
      // an accepted message must re-validate and fit the size limit when serialized
      const again = validateMessageObject(r.message, { now: NOW });
      expect(again.ok, label).toBe(true);
      expect(utf8ByteLength(JSON.stringify(r.message))).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
      expect(MESSAGE_TYPES.includes(r.message.type)).toBe(true);
    }
  } catch (e) {
    throw new Error(`fuzz invariant failed (seed ${SEED}, ${label}): ${String(e)}`);
  }
}

describe('seeded fuzz (never throws, always returns a well-formed result)', () => {
  it('has fixtures to mutate', () => {
    expect(VALID_FIXTURES.length).toBeGreaterThanOrEqual(MESSAGE_TYPES.length);
  });

  it(`${ITERATIONS_PER_PATH} object-level mutations`, () => {
    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < ITERATIONS_PER_PATH; i += 1) {
      const fixture = pick(VALID_FIXTURES);
      const mutated = mutateObject(fixture.message);
      let r: ParseResult | undefined;
      expect(() => {
        r = validateMessageObject(mutated, { now: NOW });
      }, `iteration ${i} (${fixture.name})`).not.toThrow();
      check(r as ParseResult, `object #${i} ${fixture.name}`);
      if ((r as ParseResult).ok) ok += 1;
      else rejected += 1;
    }
    // The mutator must exercise both outcomes, otherwise the test proves little.
    expect(rejected).toBeGreaterThan(ITERATIONS_PER_PATH / 4);
    expect(ok).toBeGreaterThan(0);
  });

  it(`${ITERATIONS_PER_PATH} text-level mutations`, () => {
    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < ITERATIONS_PER_PATH; i += 1) {
      const fixture = pick(VALID_FIXTURES);
      const mutated = mutateText(fixture.message);
      let r: ParseResult | undefined;
      expect(() => {
        r = parseWireMessage(mutated, { now: NOW });
      }, `iteration ${i} (${fixture.name})`).not.toThrow();
      check(r as ParseResult, `text #${i} ${fixture.name}`);
      if ((r as ParseResult).ok) ok += 1;
      else rejected += 1;
    }
    expect(rejected).toBeGreaterThan(ITERATIONS_PER_PATH / 4);
    expect(ok).toBeGreaterThan(0);
  });

  it('arbitrary non-message inputs never throw', () => {
    const inputs: unknown[] = [
      ...SCALARS,
      new Uint8Array(3),
      new ArrayBuffer(2),
      Object.create(null),
      new Map(),
      new Set([1]),
      new Date(0),
      /re/,
      () => 1,
      Symbol('s'),
    ];
    for (const input of inputs) {
      expect(() => parseWireMessage(input, { now: NOW })).not.toThrow();
      expect(() => validateMessageObject(input, { now: NOW })).not.toThrow();
      assertWellFormed(parseWireMessage(input, { now: NOW }));
      assertWellFormed(validateMessageObject(input, { now: NOW }));
    }
  });
});

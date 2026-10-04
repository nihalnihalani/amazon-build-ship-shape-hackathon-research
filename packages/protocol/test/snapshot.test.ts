/**
 * Revision 4 input snapshot (PK-01): the validators copy the input once, validate the copy and
 * return the copy. Also the bounds that make validateMessageObject cheap for hostile in-memory
 * objects (PK-09 follow-up).
 */

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_MAX_DEPTH,
  SNAPSHOT_MAX_NODES,
  parseWireMessage,
  takeSnapshot,
  validateMessageObject,
} from '../src/index.js';
import { clone, fixtureOf } from './fixtures.js';
import { OPTS, codeOf, patchedMany, patchedRaw } from './helpers.js';

describe('PK-01: the returned message is the validated snapshot (probe D08)', () => {
  it('a stateful Proxy cannot inject data into the returned message', () => {
    let reads = 0;
    const base = fixtureOf('ping authenticated');
    const evil = new Proxy(base, {
      get(target, key, receiver) {
        if (key === 'payload') {
          reads += 1;
          return reads <= 3 ? {} : { injected: 'unvalidated' };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const r = validateMessageObject(evil, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.payload).toEqual({});
      expect(JSON.stringify(r.message)).not.toContain('injected');
    }
  });

  it('every property is read exactly once, whatever the descriptor trap returns on later reads', () => {
    const base = fixtureOf('cue');
    const reads = new Map<string, number>();
    const nested = new Proxy(clone(base.payload as Record<string, unknown>), {
      getOwnPropertyDescriptor(target, key) {
        const name = String(key);
        reads.set(`payload.${name}`, (reads.get(`payload.${name}`) ?? 0) + 1);
        const d = Reflect.getOwnPropertyDescriptor(target, key);
        if (d && (reads.get(`payload.${name}`) ?? 0) > 1) return { ...d, value: 'second read' };
        return d;
      },
    });
    const evil = new Proxy(base, {
      getOwnPropertyDescriptor(target, key) {
        const name = String(key);
        reads.set(name, (reads.get(name) ?? 0) + 1);
        const d = Reflect.getOwnPropertyDescriptor(target, key);
        if (name === 'payload' && d) return { ...d, value: nested };
        if (d && (reads.get(name) ?? 0) > 1) return { ...d, value: 'second read' };
        return d;
      },
    });
    const r = validateMessageObject(evil, OPTS);
    expect(r.ok).toBe(true);
    for (const [name, count] of reads) expect(count, name).toBe(1);
    if (r.ok) expect(r.message).toEqual({ ...base, payload: { text: 'slower' } });
  });

  it('a Proxy that throws is a bad_schema result, not an exception', () => {
    const trap = (): never => {
      throw new Error('trap');
    };
    for (const handler of [{ ownKeys: trap }, { getPrototypeOf: trap }, { getOwnPropertyDescriptor: trap }]) {
      const r = validateMessageObject(new Proxy(clone(fixtureOf('ping authenticated')), handler), OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad_schema');
    }
  });

  it('mutating the input after validation does not change the returned message, and vice versa', () => {
    const input = fixtureOf('phrases.update');
    const r = validateMessageObject(input, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = JSON.stringify(r.message);
    (input.payload as { phrases: string[] }).phrases.push('mutated');
    (input.payload as { phrases: string[] })!.phrases[0] = 'changed';
    expect(JSON.stringify(r.message)).toBe(before);
    expect(r.message.payload).not.toBe(input.payload);
    (r.message.payload as { phrases: string[] }).phrases[0] = 'edited by the caller';
    expect((input.payload as { phrases: string[] }).phrases[0]).toBe('changed');
  });

  it('getters are refused (they could return something else on the next read)', () => {
    const m = fixtureOf('cue');
    Object.defineProperty(m.payload as object, 'text', { get: () => 'slower', enumerable: true });
    expect(codeOf(m)).toBe('bad_schema');
  });

  it('own __proto__ keys become ordinary own keys of the copy and never touch the prototype chain', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":"yes"},"a":1}') as unknown;
    const snap = takeSnapshot(parsed);
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      const value = snap.value as Record<string, unknown>;
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
      expect((value as { polluted?: unknown }).polluted).toBeUndefined();
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    const text = JSON.stringify(fixtureOf('ping authenticated')).replace('"payload":{}', '"payload":{"__proto__":{"polluted":1}}');
    const r = parseWireMessage(text, OPTS);
    expect(r.ok).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('takeSnapshot normalises -0 and marks bigint, symbol and function values as invalid', () => {
    const snap = takeSnapshot({ a: -0, b: [-0, 1], c: 10n, d: Symbol('x'), e: () => 1 });
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      const v = snap.value as { a: number; b: number[]; c: unknown; d: unknown; e: unknown };
      expect(Object.is(v.a, 0)).toBe(true);
      expect(Object.is(v.b[0], 0)).toBe(true);
      expect(typeof v.c).toBe('symbol');
      expect(typeof v.d).toBe('symbol');
      expect(typeof v.e).toBe('symbol');
      expect(() => JSON.stringify(snap.value)).not.toThrow();
    }
    for (const bad of [10n, Symbol('x'), () => 1]) {
      expect(codeOf(patchedRaw(fixtureOf('level'), 'payload.dbfs', bad))).toBe('bad_schema');
    }
  });
});

describe('bounds: work is limited before anything is serialised (probe S08)', () => {
  it('a sparse array of 1e8 elements is refused without iterating it', () => {
    const t0 = performance.now();
    const r = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload.x', new Array(1e8)), OPTS);
    const ms = performance.now() - t0;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
    expect(ms).toBeLessThan(250);
  });

  it('a sparse array just under the node budget is refused as not plain data (holes)', () => {
    const r = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload.x', new Array(4000)), OPTS);
    expect(r.ok).toBe(false);
  });

  it('more values than the node budget are payload_too_large', () => {
    expect(SNAPSHOT_MAX_NODES).toBe(8192);
    const big = new Array(SNAPSHOT_MAX_NODES + 1).fill(0);
    const r = validateMessageObject(patchedRaw(fixtureOf('phrases.update'), 'payload.phrases', big), OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
    const keys: Record<string, number> = {};
    for (let i = 0; i < SNAPSHOT_MAX_NODES + 1; i += 1) keys[`k${i}`] = i;
    const r2 = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload', keys), OPTS);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('payload_too_large');
  });

  it('nesting beyond the depth limit and cycles are bad_schema', () => {
    expect(SNAPSHOT_MAX_DEPTH).toBe(12);
    let nested: unknown = 1;
    for (let i = 0; i < SNAPSHOT_MAX_DEPTH + 2; i += 1) nested = { a: nested };
    const r = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload.x', nested), OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_schema');
    const cyclic: Record<string, unknown> = { ...fixtureOf('level') };
    cyclic.self = cyclic;
    const r2 = validateMessageObject(cyclic, OPTS);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('bad_schema');
  });

  it('the hostile 2e7-element sparse array of the review is cheap too', () => {
    const t0 = performance.now();
    const r = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload.x', new Array(2e7)), OPTS);
    expect(r.ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it('legal messages stay far below the budget', () => {
    const phrases = Array.from({ length: 10 }, (_, i) => `phrase number ${i}`);
    const r = validateMessageObject(patchedMany(fixtureOf('phrases.update'), { 'payload.phrases': phrases }), OPTS);
    expect(r.ok).toBe(true);
  });

  it('the text entry point goes through the same snapshot (-0 and canonical numbers)', () => {
    const text = JSON.stringify(fixtureOf('level frame 0')).replace('"t_audio_ms":0', '"t_audio_ms":-0');
    const r = parseWireMessage(text, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok && r.message.type === 'level') expect(Object.is(r.message.payload.t_audio_ms, 0)).toBe(true);
  });
});

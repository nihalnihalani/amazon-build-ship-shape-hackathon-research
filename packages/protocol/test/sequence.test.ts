import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEDUPE_CAPACITY,
  DedupeScopes,
  MessageIdDedupe,
  PerRoleSequenceTracker,
  SequenceTracker,
} from '../src/index.js';

describe('SequenceTracker (revision 4: accept(expectedGeneration, generation, sequence))', () => {
  it('accepts strictly increasing sequences within the expected generation', () => {
    const t = new SequenceTracker();
    expect(t.accept(1, 1, 0)).toBe('ok');
    expect(t.accept(1, 1, 1)).toBe('ok');
    expect(t.accept(1, 1, 5)).toBe('ok'); // gaps are allowed
    expect(t.accept(1, 1, 6)).toBe('ok');
    expect(t.state()).toEqual({ generation: 1, lastSequence: 6 });
  });

  it('reports replay for equal or lower sequences and does not move the state', () => {
    const t = new SequenceTracker();
    t.accept(1, 1, 10);
    expect(t.accept(1, 1, 10)).toBe('replay');
    expect(t.accept(1, 1, 9)).toBe('replay');
    expect(t.accept(1, 1, 0)).toBe('replay');
    expect(t.state().lastSequence).toBe(10);
    expect(t.accept(1, 1, 11)).toBe('ok');
  });

  it('a generation jump cannot be expressed: any generation other than the expected one is stale', () => {
    const t = new SequenceTracker();
    expect(t.accept(1, 1, 3)).toBe('ok');
    // PK-07 probe K06: a message claiming generation 2^31-1 while the relay still expects 1
    expect(t.accept(1, 2 ** 31 - 1, 0)).toBe('stale');
    expect(t.accept(1, 2, 0)).toBe('stale');
    expect(t.accept(1, 0, 99)).toBe('stale');
    // the legitimate producer is unaffected
    expect(t.state()).toEqual({ generation: 1, lastSequence: 3 });
    expect(t.accept(1, 1, 4)).toBe('ok');
  });

  it('a new expected generation (set by the relay) restarts the sequence space', () => {
    const t = new SequenceTracker();
    t.accept(1, 1, 500);
    expect(t.accept(2, 2, 0)).toBe('ok');
    expect(t.accept(2, 2, 0)).toBe('replay');
    expect(t.accept(2, 2, 1)).toBe('ok');
    expect(t.state()).toEqual({ generation: 2, lastSequence: 1 });
    // the superseded generation is now stale even with a high sequence
    expect(t.accept(2, 1, 10_000)).toBe('stale');
  });

  it('the expected generation never decreases (the authority going backwards is a programming error)', () => {
    const t = new SequenceTracker();
    t.accept(3, 3, 2);
    expect(() => t.accept(2, 2, 100)).toThrow(RangeError);
    expect(() => t.check(1, 1, 1)).toThrow(RangeError);
    expect(t.state()).toEqual({ generation: 3, lastSequence: 2 });
  });

  it('accepts sequence 0 for the first message of a producer', () => {
    expect(new SequenceTracker().accept(0, 0, 0)).toBe('ok');
    expect(new SequenceTracker().accept(7, 7, 0)).toBe('ok');
  });

  it('handles the largest legal values', () => {
    const t = new SequenceTracker();
    expect(t.accept(2 ** 31 - 1, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER - 1)).toBe('ok');
    expect(t.accept(2 ** 31 - 1, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER)).toBe('ok');
    expect(t.accept(2 ** 31 - 1, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER)).toBe('replay');
  });

  it('rejects malformed message numbers as stale without changing state', () => {
    const t = new SequenceTracker();
    t.accept(1, 1, 4);
    for (const [g, s] of [[-1, 0], [1, -1], [1.5, 2], [1, 2.5], [NaN, 1], [1, NaN], [Infinity, 1], [1, Infinity], [2 ** 53, 1]] as const) {
      expect(t.accept(1, g, s), `${g},${s}`).toBe('stale');
    }
    expect(t.state()).toEqual({ generation: 1, lastSequence: 4 });
  });

  it('rejects a malformed expected generation loudly', () => {
    const t = new SequenceTracker();
    for (const bad of [-1, 1.5, NaN, Infinity]) expect(() => t.accept(bad, 1, 1)).toThrow(RangeError);
  });

  it('the revision 3 two-argument call fails loudly instead of silently rejecting every message', () => {
    const t = new SequenceTracker() as unknown as { accept: (...args: number[]) => unknown; check: (...args: number[]) => unknown };
    expect(() => t.accept(1, 0)).toThrow(TypeError);
    expect(() => t.check(1, 0)).toThrow(TypeError);
  });

  it('check does not change state; commit records after later steps passed', () => {
    const t = new SequenceTracker();
    expect(t.check(1, 1, 5)).toBe('ok');
    expect(t.check(1, 1, 5)).toBe('ok'); // still ok: nothing recorded
    expect(t.state()).toEqual({ generation: -1, lastSequence: -1 });
    t.commit(1, 5);
    expect(t.check(1, 1, 5)).toBe('replay');
    expect(t.check(1, 1, 6)).toBe('ok');
    t.commit(1, 3); // an older sequence never lowers the recorded value
    expect(t.state()).toEqual({ generation: 1, lastSequence: 5 });
    expect(() => t.commit(1, -1)).toThrow(RangeError);
    expect(() => t.commit(0, 1)).toThrow(RangeError);
  });

  it('a rate-limited message that was only checked can be retransmitted with the same sequence', () => {
    const t = new SequenceTracker();
    expect(t.check(1, 1, 7)).toBe('ok');
    // dropped by a later step (rate limit): not committed
    expect(t.check(1, 1, 7)).toBe('ok');
    t.commit(1, 7);
    expect(t.check(1, 1, 7)).toBe('replay');
  });

  it('reset forgets everything', () => {
    const t = new SequenceTracker();
    t.accept(4, 4, 4);
    t.reset();
    expect(t.state()).toEqual({ generation: -1, lastSequence: -1 });
    expect(t.accept(1, 1, 0)).toBe('ok');
  });
});

describe('PerRoleSequenceTracker', () => {
  it('tracks roles independently', () => {
    const t = new PerRoleSequenceTracker();
    expect(t.accept('tv', 1, 1, 0)).toBe('ok');
    expect(t.accept('phone', 1, 1, 0)).toBe('ok');
    expect(t.accept('relay', 0, 0, 0)).toBe('ok');
    expect(t.accept('tv', 1, 1, 0)).toBe('replay');
    expect(t.accept('phone', 1, 1, 1)).toBe('ok');
    expect(t.accept('tv', 1, 0, 9)).toBe('stale');
    expect(t.accept('tv', 1, 2, 0)).toBe('stale');
    expect(t.tracker('phone').state().lastSequence).toBe(1);
    t.reset();
    expect(t.accept('tv', 1, 1, 0)).toBe('ok');
  });
  it('rejects the old three-argument call loudly', () => {
    const t = new PerRoleSequenceTracker() as unknown as { accept: (...args: unknown[]) => unknown };
    expect(() => t.accept('tv', 1, 0)).toThrow(TypeError);
  });
});

describe('MessageIdDedupe', () => {
  it('has() is a non-mutating membership test and record() adds an accepted id', () => {
    const d = new MessageIdDedupe();
    expect(d.has('m_a')).toBe(false);
    expect(d.has('m_a')).toBe(false); // has() never records
    expect(d.record('m_a')).toBe(true); // new
    expect(d.has('m_a')).toBe(true);
    expect(d.record('m_a')).toBe(false); // already known, idempotent
    expect(d.size).toBe(1);
  });

  it('an id that was checked but dropped by a later step (not recorded) is not a duplicate on retransmission', () => {
    const d = new MessageIdDedupe();
    // step 8: check only
    expect(d.has('m_retry')).toBe(false);
    // step 9: rate limited, dropped, nothing recorded
    expect(d.has('m_retry')).toBe(false); // retransmission with the same id is still new
    d.record('m_retry'); // accepted this time
    expect(d.has('m_retry')).toBe(true);
  });

  it('forget() undoes a record when a later step rejects the message', () => {
    const d = new MessageIdDedupe();
    d.record('m_x');
    d.forget('m_x');
    expect(d.has('m_x')).toBe(false);
    d.forget('m_never'); // harmless
  });

  it('seen() is kept for compatibility: check-and-record in one step', () => {
    const d = new MessageIdDedupe();
    expect(d.seen('m_a')).toBe(false);
    expect(d.seen('m_a')).toBe(true);
    expect(d.seen('m_b')).toBe(false);
    expect(d.seen('m_a')).toBe(true);
    expect(d.size).toBe(2);
  });

  it('defaults to 1024 entries and evicts the least recently recorded', () => {
    expect(DEFAULT_DEDUPE_CAPACITY).toBe(1024);
    const d = new MessageIdDedupe();
    expect(d.capacity).toBe(1024);
    for (let i = 0; i < 1024; i += 1) expect(d.record(`m_${i}`)).toBe(true);
    expect(d.size).toBe(1024);
    expect(d.has('m_0')).toBe(true);
    d.record('m_1024'); // evicts m_0
    expect(d.size).toBe(1024);
    expect(d.has('m_0')).toBe(false);
    expect(d.has('m_1')).toBe(true);
    expect(d.seen('m_0')).toBe(false); // forgotten: new again, evicts m_1
    expect(d.has('m_1')).toBe(false);
  });

  it('refreshes recency when an id is recorded again or seen again', () => {
    const d = new MessageIdDedupe(3);
    d.record('a');
    d.record('b');
    d.record('c');
    d.record('a'); // a is now most recent; b is oldest
    d.record('d'); // evicts b
    expect(d.has('b')).toBe(false);
    expect(['a', 'c', 'd'].every((id) => d.has(id))).toBe(true);
    expect(d.seen('c')).toBe(true); // c refreshed; a is oldest
    d.record('e'); // evicts a
    expect(d.has('a')).toBe(false);
    expect(d.size).toBe(3);
  });

  it('stays bounded under load', () => {
    const d = new MessageIdDedupe(100);
    for (let i = 0; i < 10_000; i += 1) d.record(`id${i}`);
    expect(d.size).toBe(100);
    expect(d.has('id9999')).toBe(true);
    expect(d.has('id9899')).toBe(false);
  });

  it('capacity 1 only remembers the last id', () => {
    const d = new MessageIdDedupe(1);
    d.record('a');
    expect(d.has('a')).toBe(true);
    d.record('b');
    expect(d.has('a')).toBe(false);
  });

  it('rejects invalid capacities', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(() => new MessageIdDedupe(bad)).toThrow(RangeError);
  });

  it('clear empties the set', () => {
    const d = new MessageIdDedupe(5);
    d.record('a');
    d.clear();
    expect(d.size).toBe(0);
    expect(d.has('a')).toBe(false);
  });

  it('has() does not change recency', () => {
    const d = new MessageIdDedupe(2);
    d.record('a');
    d.record('b');
    expect(d.has('a')).toBe(true);
    d.record('c'); // evicts a (has() did not refresh it)
    expect(d.has('a')).toBe(false);
  });
});

describe('DedupeScopes: one MessageIdDedupe per (room, role) (PK-08)', () => {
  const ROOM_A = 'r_AAAAAAAAAAAAAAAAAAAAAA';
  const ROOM_B = 'r_BBBBBBBBBBBBBBBBBBBBBB';

  it('one role cannot suppress the other role reusing an id (probe K03)', () => {
    const scopes = new DedupeScopes();
    scopes.record(ROOM_A, 'phone', 'm_shared');
    expect(scopes.has(ROOM_A, 'phone', 'm_shared')).toBe(true);
    expect(scopes.has(ROOM_A, 'tv', 'm_shared')).toBe(false);
    expect(scopes.scope(ROOM_A, 'tv').has('m_shared')).toBe(false);
  });

  it('rooms are isolated', () => {
    const scopes = new DedupeScopes();
    scopes.record(ROOM_A, 'phone', 'm_one');
    expect(scopes.has(ROOM_B, 'phone', 'm_one')).toBe(false);
  });

  it('scope() returns the same instance for the same pair and a different one otherwise', () => {
    const scopes = new DedupeScopes();
    const a = scopes.scope(ROOM_A, 'phone');
    expect(scopes.scope(ROOM_A, 'phone')).toBe(a);
    expect(scopes.scope(ROOM_A, 'tv')).not.toBe(a);
    expect(scopes.scope(ROOM_B, 'phone')).not.toBe(a);
    expect(scopes.size).toBe(3);
  });

  it('has() does not create a scope', () => {
    const scopes = new DedupeScopes();
    expect(scopes.has(ROOM_A, 'tv', 'm_x')).toBe(false);
    expect(scopes.size).toBe(0);
  });

  it('applies the per-scope capacity', () => {
    const scopes = new DedupeScopes(2);
    scopes.record(ROOM_A, 'phone', 'a');
    scopes.record(ROOM_A, 'phone', 'b');
    scopes.record(ROOM_A, 'phone', 'c');
    expect(scopes.has(ROOM_A, 'phone', 'a')).toBe(false);
    expect(scopes.scope(ROOM_A, 'phone').capacity).toBe(2);
    expect(() => new DedupeScopes(0)).toThrow(RangeError);
  });

  it('dropRoom() frees every role of a closed room and clear() frees everything', () => {
    const scopes = new DedupeScopes();
    scopes.record(ROOM_A, 'phone', 'a');
    scopes.record(ROOM_A, 'tv', 'a');
    scopes.record(ROOM_B, 'tv', 'a');
    scopes.dropRoom(ROOM_A);
    expect(scopes.size).toBe(1);
    expect(scopes.has(ROOM_A, 'phone', 'a')).toBe(false);
    expect(scopes.has(ROOM_B, 'tv', 'a')).toBe(true);
    scopes.clear();
    expect(scopes.size).toBe(0);
  });
});

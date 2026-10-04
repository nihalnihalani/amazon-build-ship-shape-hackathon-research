import { describe, expect, it } from 'vitest';
import { DEFAULT_DEDUPE_CAPACITY, MessageIdDedupe, PerRoleSequenceTracker, SequenceTracker } from '../src/index.js';

describe('SequenceTracker', () => {
  it('accepts strictly increasing sequences within a generation', () => {
    const t = new SequenceTracker();
    expect(t.accept(1, 0)).toBe('ok');
    expect(t.accept(1, 1)).toBe('ok');
    expect(t.accept(1, 5)).toBe('ok'); // gaps are allowed
    expect(t.accept(1, 6)).toBe('ok');
    expect(t.state()).toEqual({ generation: 1, lastSequence: 6 });
  });
  it('reports replay for equal or lower sequences and does not move the state', () => {
    const t = new SequenceTracker();
    t.accept(1, 10);
    expect(t.accept(1, 10)).toBe('replay');
    expect(t.accept(1, 9)).toBe('replay');
    expect(t.accept(1, 0)).toBe('replay');
    expect(t.state().lastSequence).toBe(10);
    expect(t.accept(1, 11)).toBe('ok');
  });
  it('a higher generation restarts the sequence space', () => {
    const t = new SequenceTracker();
    t.accept(1, 500);
    expect(t.accept(2, 0)).toBe('ok');
    expect(t.accept(2, 0)).toBe('replay');
    expect(t.accept(2, 1)).toBe('ok');
    expect(t.state()).toEqual({ generation: 2, lastSequence: 1 });
  });
  it('a lower generation is stale, even with a higher sequence', () => {
    const t = new SequenceTracker();
    t.accept(3, 2);
    expect(t.accept(2, 100)).toBe('stale');
    expect(t.accept(1, 0)).toBe('stale');
    expect(t.accept(0, 5)).toBe('stale');
    expect(t.state()).toEqual({ generation: 3, lastSequence: 2 });
  });
  it('accepts sequence 0 for the first message of a producer', () => {
    expect(new SequenceTracker().accept(0, 0)).toBe('ok');
    expect(new SequenceTracker().accept(7, 0)).toBe('ok');
  });
  it('handles the largest legal values', () => {
    const t = new SequenceTracker();
    expect(t.accept(2 ** 31 - 1, Number.MAX_SAFE_INTEGER - 1)).toBe('ok');
    expect(t.accept(2 ** 31 - 1, Number.MAX_SAFE_INTEGER)).toBe('ok');
    expect(t.accept(2 ** 31 - 1, Number.MAX_SAFE_INTEGER)).toBe('replay');
  });
  it('rejects malformed arguments without changing state', () => {
    const t = new SequenceTracker();
    t.accept(1, 4);
    for (const [g, s] of [[-1, 0], [1, -1], [1.5, 2], [1, 2.5], [NaN, 1], [1, NaN], [Infinity, 1], [1, Infinity], [2 ** 53, 1]] as const) {
      expect(t.accept(g, s), `${g},${s}`).toBe('stale');
    }
    expect(t.state()).toEqual({ generation: 1, lastSequence: 4 });
  });
  it('reset forgets everything', () => {
    const t = new SequenceTracker();
    t.accept(4, 4);
    t.reset();
    expect(t.state()).toEqual({ generation: -1, lastSequence: -1 });
    expect(t.accept(1, 0)).toBe('ok');
  });
});

describe('PerRoleSequenceTracker', () => {
  it('tracks roles independently', () => {
    const t = new PerRoleSequenceTracker();
    expect(t.accept('tv', 1, 0)).toBe('ok');
    expect(t.accept('phone', 1, 0)).toBe('ok');
    expect(t.accept('relay', 0, 0)).toBe('ok');
    expect(t.accept('tv', 1, 0)).toBe('replay');
    expect(t.accept('phone', 1, 1)).toBe('ok');
    expect(t.accept('tv', 0, 9)).toBe('stale');
    expect(t.tracker('phone').state().lastSequence).toBe(1);
    t.reset();
    expect(t.accept('tv', 1, 0)).toBe('ok');
  });
});

describe('MessageIdDedupe', () => {
  it('reports duplicates', () => {
    const d = new MessageIdDedupe();
    expect(d.seen('m_a')).toBe(false);
    expect(d.seen('m_a')).toBe(true);
    expect(d.seen('m_b')).toBe(false);
    expect(d.seen('m_a')).toBe(true);
    expect(d.size).toBe(2);
  });
  it('defaults to 1024 entries and evicts the least recently seen', () => {
    expect(DEFAULT_DEDUPE_CAPACITY).toBe(1024);
    const d = new MessageIdDedupe();
    expect(d.capacity).toBe(1024);
    for (let i = 0; i < 1024; i += 1) expect(d.seen(`m_${i}`)).toBe(false);
    expect(d.size).toBe(1024);
    expect(d.has('m_0')).toBe(true);
    expect(d.seen('m_1024')).toBe(false); // evicts m_0
    expect(d.size).toBe(1024);
    expect(d.has('m_0')).toBe(false);
    expect(d.has('m_1')).toBe(true);
    expect(d.seen('m_0')).toBe(false); // forgotten: seen again as new, evicts m_1
    expect(d.has('m_1')).toBe(false);
  });
  it('refreshes recency when an id is seen again', () => {
    const d = new MessageIdDedupe(3);
    d.seen('a');
    d.seen('b');
    d.seen('c');
    expect(d.seen('a')).toBe(true); // a is now most recent; b is oldest
    d.seen('d'); // evicts b
    expect(d.has('b')).toBe(false);
    expect(d.has('a')).toBe(true);
    expect(d.has('c')).toBe(true);
    expect(d.has('d')).toBe(true);
    expect(d.size).toBe(3);
  });
  it('stays bounded under load', () => {
    const d = new MessageIdDedupe(100);
    for (let i = 0; i < 10_000; i += 1) d.seen(`id${i}`);
    expect(d.size).toBe(100);
    expect(d.has('id9999')).toBe(true);
    expect(d.has('id9899')).toBe(false);
  });
  it('capacity 1 only remembers the last id', () => {
    const d = new MessageIdDedupe(1);
    expect(d.seen('a')).toBe(false);
    expect(d.seen('a')).toBe(true);
    expect(d.seen('b')).toBe(false);
    expect(d.seen('a')).toBe(false);
  });
  it('rejects invalid capacities', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(() => new MessageIdDedupe(bad)).toThrow(RangeError);
  });
  it('clear empties the set', () => {
    const d = new MessageIdDedupe(5);
    d.seen('a');
    d.clear();
    expect(d.size).toBe(0);
    expect(d.seen('a')).toBe(false);
  });
  it('has() does not change recency', () => {
    const d = new MessageIdDedupe(2);
    d.seen('a');
    d.seen('b');
    expect(d.has('a')).toBe(true);
    d.seen('c'); // evicts a (has() did not refresh it)
    expect(d.has('a')).toBe(false);
  });
});

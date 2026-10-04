/**
 * Replay and duplicate protection helpers (ADR-0003 sections 5, 9 and 10).
 *
 * `SequenceTracker` follows one producer (one role in one room): sequence must
 * strictly increase within a producer generation; a higher generation starts a
 * new sequence space; a lower generation is stale. `MessageIdDedupe` remembers
 * recent message ids in a bounded LRU.
 */

import type { Role } from './types.js';

export type SequenceVerdict = 'ok' | 'stale' | 'replay';

/** Tracks the last accepted (generation, sequence) of a single producer. */
export class SequenceTracker {
  private generation = -1;
  private lastSequence = -1;

  /**
   * - generation lower than the current one: `stale`
   * - generation higher: the sequence space restarts; accepted as `ok`
   * - same generation: `ok` only if `sequence` is strictly greater than the last accepted, else `replay`
   * Malformed arguments (not non-negative safe integers) are `stale` and change nothing.
   * Only an `ok` verdict updates the state.
   */
  accept(generation: number, sequence: number): SequenceVerdict {
    if (!Number.isSafeInteger(generation) || generation < 0) return 'stale';
    if (!Number.isSafeInteger(sequence) || sequence < 0) return 'stale';
    if (generation < this.generation) return 'stale';
    if (generation > this.generation) {
      this.generation = generation;
      this.lastSequence = sequence;
      return 'ok';
    }
    if (sequence > this.lastSequence) {
      this.lastSequence = sequence;
      return 'ok';
    }
    return 'replay';
  }

  /** Current state; generation and sequence are -1 before the first accepted message. */
  state(): { generation: number; lastSequence: number } {
    return { generation: this.generation, lastSequence: this.lastSequence };
  }

  reset(): void {
    this.generation = -1;
    this.lastSequence = -1;
  }
}

/** One tracker per role, for a connection or room that sees several producers. */
export class PerRoleSequenceTracker {
  private readonly trackers: Record<Role, SequenceTracker> = {
    tv: new SequenceTracker(),
    phone: new SequenceTracker(),
    relay: new SequenceTracker(),
  };

  accept(role: Role, generation: number, sequence: number): SequenceVerdict {
    return this.trackers[role].accept(generation, sequence);
  }

  tracker(role: Role): SequenceTracker {
    return this.trackers[role];
  }

  reset(): void {
    this.trackers.tv.reset();
    this.trackers.phone.reset();
    this.trackers.relay.reset();
  }
}

export const DEFAULT_DEDUPE_CAPACITY = 1024;

/** Bounded LRU of recently seen message ids (default 1024, as ADR-0003 section 10). */
export class MessageIdDedupe {
  private readonly ids = new Map<string, true>();
  readonly capacity: number;

  constructor(capacity: number = DEFAULT_DEDUPE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }
    this.capacity = capacity;
  }

  /**
   * Returns true when `id` was already seen (a duplicate; its recency is refreshed).
   * Otherwise records it, evicting the least recently seen id past capacity, and returns false.
   */
  seen(id: string): boolean {
    if (this.ids.has(id)) {
      this.ids.delete(id);
      this.ids.set(id, true);
      return true;
    }
    this.ids.set(id, true);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.keys().next();
      if (!oldest.done) this.ids.delete(oldest.value);
    }
    return false;
  }

  /** Non-mutating membership test. */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}

/**
 * Replay and duplicate protection helpers (ADR-0003 sections 5, 9 and 10).
 *
 * `SequenceTracker` follows one producer (one role in one room). Revision 4 (PK-07):
 * the caller passes the AUTHORITATIVE current generation (the value the relay assigned
 * on authentication) with every message, so a generation jump cannot be expressed: a
 * message whose generation differs from the expected one is `stale`, whatever its value.
 * Within the expected generation the sequence must strictly increase.
 *
 * `MessageIdDedupe` remembers recent message ids in a bounded LRU. Revision 4 (PK-08): scope
 * one instance per (room, role) (see `DedupeScopes`), check with `has`, and `record` an id only
 * after the message was accepted, so a message dropped by a later step (rate limit, direction)
 * can be retransmitted with the same id without being mistaken for a duplicate.
 */

import type { Role } from './types.js';

export type SequenceVerdict = 'ok' | 'stale' | 'replay';

function isCounter(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/** Tracks the last accepted sequence of a single producer in the expected generation. */
export class SequenceTracker {
  private generation = -1;
  private lastSequence = -1;

  /**
   * Non-mutating verdict.
   * - `expectedGeneration` is the authoritative current generation of this producer (never taken from
   *   the message). It must not decrease between calls: the tracker throws a RangeError if it does,
   *   because the authority going backwards is a programming error. A higher value starts a new
   *   sequence space.
   * - `generation` differing from `expectedGeneration` (lower or higher) is `stale`.
   * - same generation: `ok` only if `sequence` is strictly greater than the last accepted, else `replay`.
   * Malformed numbers (not non-negative safe integers) are `stale`. Throws a TypeError when called with
   * fewer than three arguments (the revision 3 two-argument form), so the old call cannot silently
   * reject every message.
   */
  check(expectedGeneration: number, generation: number, sequence: number): SequenceVerdict {
    if (arguments.length < 3) {
      throw new TypeError('SequenceTracker: use check/accept(expectedGeneration, generation, sequence)');
    }
    if (!isCounter(expectedGeneration)) throw new RangeError('expectedGeneration must be a non-negative integer');
    if (expectedGeneration < this.generation) throw new RangeError('expectedGeneration must not decrease');
    if (!isCounter(generation) || !isCounter(sequence)) return 'stale';
    if (generation !== expectedGeneration) return 'stale';
    if (expectedGeneration > this.generation) return 'ok'; // first message of a new generation: any sequence
    return sequence > this.lastSequence ? 'ok' : 'replay';
  }

  /**
   * Verdict and, on `ok`, record the sequence. Use after every other check passed, or use `check`
   * and `commit` separately when later steps may still reject the message.
   */
  accept(expectedGeneration: number, generation: number, sequence: number): SequenceVerdict {
    if (arguments.length < 3) {
      throw new TypeError('SequenceTracker: use check/accept(expectedGeneration, generation, sequence)');
    }
    const verdict = this.check(expectedGeneration, generation, sequence);
    if (verdict === 'ok') this.commit(expectedGeneration, sequence);
    return verdict;
  }

  /** Record an accepted sequence (after `check` returned `ok`). */
  commit(expectedGeneration: number, sequence: number): void {
    if (!isCounter(expectedGeneration) || !isCounter(sequence)) {
      throw new RangeError('generation and sequence must be non-negative integers');
    }
    if (expectedGeneration < this.generation) throw new RangeError('expectedGeneration must not decrease');
    if (expectedGeneration > this.generation) {
      this.generation = expectedGeneration;
      this.lastSequence = sequence;
    } else if (sequence > this.lastSequence) {
      this.lastSequence = sequence;
    }
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

/** One tracker per role, for a room that sees several producers. */
export class PerRoleSequenceTracker {
  private readonly trackers: Record<Role, SequenceTracker> = {
    tv: new SequenceTracker(),
    phone: new SequenceTracker(),
    relay: new SequenceTracker(),
  };

  accept(role: Role, expectedGeneration: number, generation: number, sequence: number): SequenceVerdict {
    if (arguments.length < 4) {
      throw new TypeError('PerRoleSequenceTracker.accept(role, expectedGeneration, generation, sequence)');
    }
    return this.trackers[role].accept(expectedGeneration, generation, sequence);
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

/**
 * Bounded LRU of recently seen message ids (default 1024, as ADR-0003 section 10).
 *
 * Scope: use ONE instance per (room, role) (`DedupeScopes` does this), otherwise one role can
 * suppress the other's message that reuses an id.
 * Order: `has` before the other checks, `record` only after the message is accepted.
 */
export class MessageIdDedupe {
  private readonly ids = new Map<string, true>();
  readonly capacity: number;

  constructor(capacity: number = DEFAULT_DEDUPE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }
    this.capacity = capacity;
  }

  /** Non-mutating membership test (does not change recency). */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /**
   * Remember an id after its message was ACCEPTED. Idempotent; refreshes recency; evicts the least
   * recently recorded id past capacity. Returns true when the id was new.
   */
  record(id: string): boolean {
    const known = this.ids.has(id);
    if (known) this.ids.delete(id);
    this.ids.set(id, true);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.keys().next();
      if (!oldest.done) this.ids.delete(oldest.value);
    }
    return !known;
  }

  /** Forget an id (undo a `record` when a later step rejects the message). */
  forget(id: string): void {
    this.ids.delete(id);
  }

  /**
   * Compatibility helper: returns true when `id` was already seen (a duplicate; its recency is
   * refreshed); otherwise records it and returns false. This records BEFORE later checks can
   * reject the message, so the relay must use `has` then `record` instead; `seen` is fine where
   * acceptance is immediate (a receiver that applies the message right away).
   */
  seen(id: string): boolean {
    if (this.ids.has(id)) {
      this.ids.delete(id);
      this.ids.set(id, true);
      return true;
    }
    this.record(id);
    return false;
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}

/**
 * Per-(room, role) registry of `MessageIdDedupe` instances: `scope(roomId, role)` returns the
 * instance for that pair, creating it on first use. Call `dropRoom(roomId)` when a room closes.
 */
export class DedupeScopes {
  private readonly scopes = new Map<string, MessageIdDedupe>();
  readonly capacityPerScope: number;

  constructor(capacityPerScope: number = DEFAULT_DEDUPE_CAPACITY) {
    if (!Number.isInteger(capacityPerScope) || capacityPerScope < 1) {
      throw new RangeError('capacityPerScope must be a positive integer');
    }
    this.capacityPerScope = capacityPerScope;
  }

  private static key(roomId: string, role: Role): string {
    return `${role}\u0000${roomId}`;
  }

  scope(roomId: string, role: Role): MessageIdDedupe {
    const key = DedupeScopes.key(roomId, role);
    let dedupe = this.scopes.get(key);
    if (!dedupe) {
      dedupe = new MessageIdDedupe(this.capacityPerScope);
      this.scopes.set(key, dedupe);
    }
    return dedupe;
  }

  /** Non-creating membership test. */
  has(roomId: string, role: Role, id: string): boolean {
    return this.scopes.get(DedupeScopes.key(roomId, role))?.has(id) ?? false;
  }

  /** Record an accepted id for (room, role). */
  record(roomId: string, role: Role, id: string): boolean {
    return this.scope(roomId, role).record(id);
  }

  dropRoom(roomId: string): void {
    for (const role of ['tv', 'phone', 'relay'] as const) this.scopes.delete(DedupeScopes.key(roomId, role));
  }

  get size(): number {
    return this.scopes.size;
  }

  clear(): void {
    this.scopes.clear();
  }
}

/**
 * Outgoing message pacing (QA-E2E-01).
 *
 * Why: the relay counts every frame a connection sends in fixed windows (more than 60 in one second,
 * or more than 400 in ten, is rejected with `rate_limited`, whatever the frame is). After a network
 * stall that does not drop the connection, whatever the phone had already handed to the network
 * arrives in one burst; if it exceeds the budget the relay drops frames, and the dropped frame may be
 * the `mic.state` that tells the TV the microphone stopped measuring.
 *
 * What this module does, in one place:
 *  - A token bucket keeps the phone's own sending under the relay's limits. The relay counts in FIXED
 *    windows, so a bucket of capacity C refilled at R per second can put C + R frames into one window:
 *    capacity 25 at 30/s gives at most 55 per second (limit 60) and 30/s sustained (limit 40).
 *  - Three priorities. Critical (acks, results, listener answers, cues, phrases) is never dropped and
 *    keeps its order. State (`mic.state`) is coalesced: only the latest is ever waiting. Levels are
 *    never queued at all: a level is sent now or dropped, because a late level is worthless (and one
 *    for a window that has closed is wrong). Levels also stop first: they may not use the last tokens.
 *  - Messages are rendered (numbered and serialised) at the moment they are sent, so sequence numbers
 *    always match wire order even when a high-priority message overtakes a waiting one, and a dropped
 *    message never consumes a sequence number.
 *  - If the socket's own send buffer is backed up (`bufferedAmount`), the link is stalled: levels are
 *    dropped and everything else waits, so a stall cannot build a backlog that bursts out later.
 *  - After the relay answers `rate_limited` the outbox backs off (1 s, doubling to 4 s for repeated
 *    episodes) and the controller re-sends the latest `mic.state` once the bucket allows.
 *
 * Pure: time, timers and the wire are injected, so every rule is unit-testable with fake timers.
 */

export type Priority = 'critical' | 'state' | 'level';

export interface OutboxItem {
  priority: Priority;
  /** Numbers and serialises the message now (called only when it is actually sent). Null skips it. */
  render(): { id: string; text: string } | null;
  /** Called with the message id right after the message was handed to the wire. */
  onSent?(id: string): void;
  /** Opaque description the owner may use to salvage the item if it is discarded unsent. */
  meta?: unknown;
}

export interface OutboxOptions {
  now(): number;
  /** Puts text on the wire. False means it could not be sent (the item is then dropped as unsendable). */
  transmit(text: string): boolean;
  /** Bytes the socket has accepted but not yet handed to the network; 0 when unknown. */
  bufferedAmount(): number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** Capacity + rate must stay below the relay's 60 per fixed second with room for heartbeat pings. */
export const BUCKET_CAPACITY = 25;
export const BUCKET_RATE_PER_SEC = 30;
/** Levels may not take the last tokens: they are kept for acks, results and mic.state. */
export const LEVEL_TOKEN_RESERVE = 8;
/** A socket with more than this many bytes waiting is stalled: no levels, everything else holds. */
export const BUFFER_HIGH_WATER_BYTES = 4096;
const BUFFER_POLL_MS = 100;
export const RATE_LIMIT_BACKOFF_MS = 1000;
export const RATE_LIMIT_BACKOFF_MAX_MS = 4000;
/** Rate-limit episodes closer together than this double the backoff. */
const EPISODE_MEMORY_MS = 10_000;

export type SubmitResult = 'sent' | 'queued' | 'dropped';

export interface OutboxStats {
  sent: number;
  droppedLevels: number;
  coalescedState: number;
  queuedCritical: number;
  pendingState: boolean;
  tokens: number;
  pausedForMs: number;
}

export class Outbox {
  private tokens = BUCKET_CAPACITY;
  private lastRefill: number;
  private readonly critical: OutboxItem[] = [];
  private pendingState: OutboxItem | null = null;
  private timer: unknown = null;
  private pausedUntil = Number.NEGATIVE_INFINITY;
  private backoffMs = RATE_LIMIT_BACKOFF_MS;
  private lastEpisodeAt = Number.NEGATIVE_INFINITY;
  /** What happened to each item that left the queue (so submit() can tell "sent" from "could not send"). */
  private readonly outcomes = new WeakMap<OutboxItem, boolean>();
  private sent = 0;
  private droppedLevels = 0;
  private coalescedState = 0;

  constructor(private readonly opts: OutboxOptions) {
    this.lastRefill = opts.now();
  }

  // ---- submitting ------------------------------------------------------------------------------

  submit(item: OutboxItem): SubmitResult {
    switch (item.priority) {
      case 'level':
        return this.submitLevel(item);
      case 'state':
        if (this.pendingState !== null) this.coalescedState += 1; // only the latest waits
        this.pendingState = item;
        break;
      case 'critical':
        this.critical.push(item);
        break;
    }
    this.pump();
    if (this.isWaiting(item)) return 'queued';
    return this.outcomes.get(item) === true ? 'sent' : 'dropped';
  }

  private isWaiting(item: OutboxItem): boolean {
    return this.pendingState === item || this.critical.includes(item);
  }

  /** A level is sent now or not at all: it is never queued. */
  private submitLevel(item: OutboxItem): SubmitResult {
    this.refill();
    const blocked =
      this.isPaused() ||
      this.isBackedUp() ||
      this.critical.length > 0 ||
      this.pendingState !== null ||
      this.tokens - 1 < LEVEL_TOKEN_RESERVE;
    if (blocked) {
      this.droppedLevels += 1;
      return 'dropped';
    }
    return this.transmit(item) ? 'sent' : 'dropped';
  }

  // ---- pumping ---------------------------------------------------------------------------------

  private pump(): void {
    this.refill();
    while (!this.isPaused() && !this.isBackedUp() && this.tokens >= 1) {
      const next = this.critical.shift() ?? this.takePendingState();
      if (next === null || next === undefined) break;
      this.transmit(next);
    }
    this.schedule();
  }

  private takePendingState(): OutboxItem | null {
    const item = this.pendingState;
    this.pendingState = null;
    return item;
  }

  /** Renders and sends one item, spending one token. */
  private transmit(item: OutboxItem): boolean {
    const ok = this.attempt(item);
    this.outcomes.set(item, ok);
    return ok;
  }

  private attempt(item: OutboxItem): boolean {
    const rendered = item.render();
    if (rendered === null) return false;
    if (!this.opts.transmit(rendered.text)) return false;
    this.tokens -= 1;
    this.sent += 1;
    item.onSent?.(rendered.id);
    return true;
  }

  private refill(): void {
    const now = this.opts.now();
    // No tokens accrue while backing off: the bucket starts again from empty when the pause ends, so
    // the end of a pause is not a burst of its own.
    const from = Math.max(this.lastRefill, this.pausedUntil);
    const elapsed = Math.max(0, now - from);
    this.lastRefill = now;
    this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + (elapsed / 1000) * BUCKET_RATE_PER_SEC);
  }

  private isPaused(): boolean {
    return this.opts.now() < this.pausedUntil;
  }

  private isBackedUp(): boolean {
    return this.opts.bufferedAmount() > BUFFER_HIGH_WATER_BYTES;
  }

  /** Arrange to try again when whatever is holding the queue (tokens, backoff, send buffer) clears. */
  private schedule(): void {
    this.clearTimer();
    if (this.critical.length === 0 && this.pendingState === null) return;
    const now = this.opts.now();
    let wait: number;
    if (this.isPaused()) wait = this.pausedUntil - now;
    else if (this.isBackedUp()) wait = BUFFER_POLL_MS;
    else wait = Math.max(1, Math.ceil(((1 - this.tokens) / BUCKET_RATE_PER_SEC) * 1000));
    const set = this.opts.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      this.pump();
    }, wait);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    const clear = this.opts.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as number));
    clear(this.timer);
    this.timer = null;
  }

  // ---- the relay said rate_limited ---------------------------------------------------------------

  /**
   * Starts (or continues) a backoff episode. The relay sends one `rate_limited` error per rejected
   * frame, so a burst produces a flurry of them: errors that arrive while already backing off belong
   * to the same episode and neither extend nor multiply it. A new episode soon after the last one
   * doubles the wait (up to 4 s). The bucket is treated as empty: whatever we send now would be
   * counted against the same exhausted window.
   */
  noteRateLimited(): void {
    const now = this.opts.now();
    if (now < this.pausedUntil) return;
    this.backoffMs = now - this.lastEpisodeAt < EPISODE_MEMORY_MS ? Math.min(this.backoffMs * 2, RATE_LIMIT_BACKOFF_MAX_MS) : RATE_LIMIT_BACKOFF_MS;
    this.lastEpisodeAt = now;
    this.pausedUntil = now + this.backoffMs;
    this.tokens = 0;
    this.lastRefill = now;
    this.schedule();
  }

  // ---- lifecycle -----------------------------------------------------------------------------------

  /** New connection or end of the pairing: the relay's counters are new, ours restart too. Returns what was still waiting. */
  reset(): OutboxItem[] {
    this.clearTimer();
    const waiting = [...this.critical];
    this.critical.length = 0;
    this.pendingState = null;
    this.tokens = BUCKET_CAPACITY;
    this.lastRefill = this.opts.now();
    this.pausedUntil = Number.NEGATIVE_INFINITY;
    this.backoffMs = RATE_LIMIT_BACKOFF_MS;
    this.lastEpisodeAt = Number.NEGATIVE_INFINITY;
    return waiting;
  }

  stats(): OutboxStats {
    this.refill();
    return {
      sent: this.sent,
      droppedLevels: this.droppedLevels,
      coalescedState: this.coalescedState,
      queuedCritical: this.critical.length,
      pendingState: this.pendingState !== null,
      tokens: this.tokens,
      pausedForMs: Math.max(0, this.pausedUntil - this.opts.now()),
    };
  }
}

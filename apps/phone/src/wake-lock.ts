import type { WakeLockState } from './ports/wire.js';

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * "Keep this screen on" via Screen Wake Lock. State is what the browser actually did:
 * `held` only after a successful request, `released` when the browser (battery, hidden page)
 * or we release it, `rejected` when the request failed, `unsupported` without the API.
 */
export class WakeLockController {
  private current: WakeLockState;
  private sentinel: WakeLockSentinelLike | null = null;
  private onRelease: (() => void) | null = null;
  private generation = 0;
  private inflight: Promise<void> | null = null;
  private inflightToken: symbol | null = null;
  private readonly listeners = new Set<(s: WakeLockState) => void>();

  constructor(private readonly api: WakeLockApi | undefined) {
    this.current = api ? 'not_requested' : 'unsupported';
  }

  get state(): WakeLockState {
    return this.current;
  }

  subscribe(listener: (s: WakeLockState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: WakeLockState): void {
    if (next === this.current) return;
    this.current = next;
    for (const l of [...this.listeners]) l(next);
  }

  /**
   * Requests the lock. Idempotent while held and while a request is already in flight (one
   * request at a time, so there is never a stale sentinel). Call only while a session/mic is active.
   */
  request(): Promise<void> {
    if (!this.api || this.sentinel !== null) return Promise.resolve();
    if (this.inflight !== null) return this.inflight;
    const api = this.api;
    const gen = this.generation;
    const token = Symbol('wake-lock-request');
    this.inflightToken = token;
    const attempt: Promise<void> = (async () => {
      try {
        const sentinel = await api.request('screen');
        if (gen !== this.generation) {
          // Released while the request was in flight: do not keep a lock nobody wants.
          void sentinel.release().catch(() => undefined);
          return;
        }
        const onRelease = (): void => {
          if (this.sentinel !== sentinel) return;
          this.sentinel = null;
          this.onRelease = null;
          this.set('released');
        };
        sentinel.addEventListener('release', onRelease);
        this.sentinel = sentinel;
        this.onRelease = onRelease;
        this.set('held');
      } catch {
        if (gen === this.generation) this.set('rejected');
      } finally {
        if (this.inflightToken === token) {
          this.inflight = null;
          this.inflightToken = null;
        }
      }
    })();
    if (this.inflightToken === token) this.inflight = attempt; // not already finished
    return attempt;
  }

  /** Releases the lock if held and cancels any request in flight. */
  async release(): Promise<void> {
    this.generation += 1;
    this.inflight = null; // a later request() starts fresh; the old result is discarded
    this.inflightToken = null;
    const sentinel = this.sentinel;
    if (sentinel === null) {
      if (this.current === 'held') this.set('released');
      return;
    }
    if (this.onRelease) sentinel.removeEventListener('release', this.onRelease);
    this.sentinel = null;
    this.onRelease = null;
    try {
      await sentinel.release();
    } catch {
      /* already released by the browser */
    }
    this.set('released');
  }
}

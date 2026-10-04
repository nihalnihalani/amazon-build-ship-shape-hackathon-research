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

  /** Requests the lock (idempotent while held). Call only while a session/mic is active. */
  async request(): Promise<void> {
    if (!this.api) return;
    if (this.sentinel !== null) return;
    const gen = ++this.generation;
    try {
      const sentinel = await this.api.request('screen');
      if (gen !== this.generation) {
        // Released or re-requested while the request was in flight.
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
    }
  }

  /** Releases the lock if held and cancels any request in flight. */
  async release(): Promise<void> {
    this.generation += 1;
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

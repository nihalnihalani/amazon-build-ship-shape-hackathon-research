import type { SessionStore, TvInput, TvView } from '@atr/session-core';

export interface FakeStore extends SessionStore {
  dispatched: TvInput[];
  listenerCount(): number;
  setView(view: TvView): void;
  resolveReady(): void;
}

/** In-memory SessionStore for UI tests: records dispatched inputs and lets a test push new views. */
export function createFakeStore(initial: TvView, options: { readyRejects?: boolean; manualReady?: boolean } = {}): FakeStore {
  let view = initial;
  const listeners = new Set<(next: TvView) => void>();
  const dispatched: TvInput[] = [];
  let release: () => void = () => undefined;
  const ready = options.readyRejects
    ? Promise.reject(new Error('storage unavailable'))
    : options.manualReady
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
  if (options.readyRejects) ready.catch(() => undefined);
  return {
    dispatched,
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(input) {
      dispatched.push(input);
    },
    ready: () => ready,
    dispose() {
      listeners.clear();
    },
    listenerCount: () => listeners.size,
    setView(next) {
      view = next;
      for (const listener of Array.from(listeners)) listener(next);
    },
    resolveReady: () => release(),
  };
}

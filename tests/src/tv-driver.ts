/**
 * Headless TV driver for integration tests.
 *
 * Runs the real authoritative session core (@atr/session-core) in Node with:
 * - an in-memory StoragePort,
 * - a WebSocket TransportPort (ws package, no Origin header, like a native Vega client),
 * - a controllable clock.
 *
 * It renders nothing. Evidence produced through this driver is `automated`,
 * never `real_VVD`.
 */
import WebSocket from 'ws';
import type {
  ActionId,
  ClockPort,
  RemoteKey,
  SessionStore,
  StoragePort,
  TransportPort,
  TvInput,
  TvView,
} from '@atr/session-core';
import { createSessionStore } from '@atr/session-core';
import { createWsTransport, type WebSocketLike, type WsTransport } from '../../apps/tv/src/adapters/wsTransport.js';

export class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
  async getAllKeys() {
    return [...this.map.keys()];
  }
  async multiRemove(keys: readonly string[]) {
    for (const k of keys) this.map.delete(k);
  }
}

export function systemClock(): ClockPort {
  return {
    now: () => Date.now(),
    localDate: (ms) => {
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
  };
}

/**
 * The TV app's own WebSocket adapter (apps/tv/src/adapters/wsTransport.ts: backoff 0.5,1,2,4,8 s),
 * with sockets created by the `ws` package so the throwaway dev CA can be trusted. No Origin header
 * is sent, like a native Vega client. `sent`/`received` record frames for the test's privacy checks.
 */
export class NodeWsTransport implements TransportPort {
  private readonly inner: WsTransport;
  private dispatch: ((input: TvInput) => void) | null = null;
  private lastSocket: WebSocket | null = null;
  readonly sent: string[] = [];
  readonly received: string[] = [];

  constructor(private readonly opts: { ca?: string | Buffer; origin?: string } = {}) {
    this.inner = createWsTransport({
      createSocket: (url: string) => {
        const ws = new WebSocket(url, {
          ca: this.opts.ca,
          headers: this.opts.origin ? { Origin: this.opts.origin } : {},
        });
        this.lastSocket = ws;
        ws.on('message', (data, isBinary) => {
          if (!isBinary) this.received.push(data.toString('utf8'));
        });
        return ws as unknown as WebSocketLike;
      },
    });
  }

  bind(dispatch: (input: TvInput) => void) {
    this.dispatch = dispatch;
    this.inner.attach(dispatch);
  }

  connect(url: string): void {
    this.inner.connect(url);
  }

  send(serialized: string): boolean {
    const ok = this.inner.send(serialized);
    if (ok) this.sent.push(serialized);
    return ok;
  }

  close(reason: string): void {
    this.inner.close(reason);
  }

  /** Test hook: drop the current socket abruptly to simulate link loss (the adapter reconnects). */
  terminate(): void {
    this.lastSocket?.terminate();
  }
}

export interface TvHarness {
  store: SessionStore;
  transport: NodeWsTransport;
  storage: MemoryStorage;
  view(): TvView;
  press(key: RemoteKey): void;
  act(action: ActionId): void;
  /** Wait until predicate(view) is true, ticking the store's timer input. */
  waitFor(pred: (v: TvView) => boolean, label: string, timeoutMs?: number): Promise<TvView>;
  dispose(): void;
}

export async function startTv(opts: {
  relayUrl: string;
  ca?: string | Buffer;
  storage?: MemoryStorage;
  fixtureMode?: boolean;
}): Promise<TvHarness> {
  const transport = new NodeWsTransport({ ca: opts.ca });
  const storage = opts.storage ?? new MemoryStorage();
  const clock = systemClock();
  const store = createSessionStore({
    clock,
    storage,
    transport,
    relayUrl: opts.relayUrl,
    appVersion: '0.1.0-test',
    platform: 'test',
    fixtureMode: opts.fixtureMode ?? false,
  });
  transport.bind((i) => store.dispatch(i));
  await store.ready();
  const ticker = setInterval(() => store.dispatch({ kind: 'timer', now: clock.now() }), 100);
  const h: TvHarness = {
    store,
    transport,
    storage,
    view: () => store.getView(),
    press: (key) => store.dispatch({ kind: 'remote', key }),
    act: (action) => {
      const v = store.getView();
      const available = v.actions.find((a) => a.id === action && !a.disabled);
      if (!available) {
        throw new Error(`action ${action} not available on screen ${v.screen}; have: ${v.actions.map((a) => a.id).join(',')}`);
      }
      store.dispatch({ kind: 'ui', action });
    },
    waitFor: (pred, label, timeoutMs = 20_000) =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          const v = store.getView();
          if (pred(v)) return resolve(v);
          if (Date.now() - start > timeoutMs) {
            return reject(new Error(`timeout waiting for ${label}; screen=${v.screen} stage=${v.stage} title=${v.title} body=${JSON.stringify(v.body)} banner=${JSON.stringify(v.banner)} result=${JSON.stringify(v.result)} mic=${v.mic} link=${v.link} actions=${v.actions.map((a) => a.id).join(',')}`));
          }
          setTimeout(check, 50);
        };
        check();
      }),
    dispose: () => {
      clearInterval(ticker);
      store.dispose();
      transport.close('test end');
    },
  };
  return h;
}

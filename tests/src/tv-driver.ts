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

/** TransportPort over the `ws` package. Inbound frames and link state are dispatched into the store. */
export class NodeWsTransport implements TransportPort {
  private ws: WebSocket | null = null;
  private dispatch: ((input: TvInput) => void) | null = null;
  readonly sent: string[] = [];
  readonly received: string[] = [];

  constructor(private readonly opts: { ca?: string | Buffer; origin?: string } = {}) {}

  bind(dispatch: (input: TvInput) => void) {
    this.dispatch = dispatch;
  }

  connect(url: string): void {
    this.dispatch?.({ kind: 'transport', state: 'connecting' });
    const ws = new WebSocket(url, {
      ca: this.opts.ca,
      headers: this.opts.origin ? { Origin: this.opts.origin } : {},
    });
    this.ws = ws;
    ws.on('open', () => this.dispatch?.({ kind: 'transport', state: 'connected' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString('utf8');
      this.received.push(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      this.dispatch?.({ kind: 'wire', message: parsed });
    });
    ws.on('close', () => {
      if (this.ws === ws) this.dispatch?.({ kind: 'transport', state: 'offline' });
    });
    ws.on('error', () => {
      /* close follows */
    });
  }

  send(serialized: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.sent.push(serialized);
    this.ws.send(serialized);
    return true;
  }

  close(reason: string): void {
    this.ws?.close(1000, reason.slice(0, 100));
    this.ws = null;
  }

  /** Test hook: drop the socket abruptly to simulate link loss. */
  terminate(): void {
    this.ws?.terminate();
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
            return reject(new Error(`timeout waiting for ${label}; screen=${v.screen} stage=${v.stage} title=${v.title}`));
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

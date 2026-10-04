/**
 * createSessionStore: wires the pure Machine to the injected ports.
 * - The store owns no timers: the app ticks { kind: 'timer', now } every 100-250 ms.
 * - Storage writes are serialized through one promise chain so they cannot reorder.
 * - Fixture mode swaps in an in-memory store so demo history never reaches real history.
 */

import type { SessionStore, SessionStoreDeps, StoragePort, TvInput, TvView } from './contract.js';
import { createIdFactory } from '@atr/protocol';
import { Machine } from './machine.js';
import { createMemoryStorage } from './memory-storage.js';
import type { Effect, Env, Event, PersistOp } from './model.js';
import {
  clearCheckpoint,
  deleteAllLocalData,
  loadData,
  saveCheckpoint,
  savePhrases,
  saveSessionRecord,
  saveSettings,
} from './storage.js';
import { relaySocketUrl } from './urls.js';
import { Outbox } from './wire.js';

function fallbackBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** PK-12: 'e' + U+0301 must normalise to U+00E9. Read at call time so a runtime without normalize() is detected. */
export function nfcSelfTest(): boolean {
  try {
    const sample = 'e\u0301';
    return typeof sample.normalize === 'function' && sample.normalize('NFC') === '\u00e9';
  } catch {
    return false;
  }
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const idFactory = createIdFactory(deps.randomBytes);
  const newId = (prefix: string): string => {
    switch (prefix) {
      case 's_':
        return idFactory.session();
      case 'w_':
        return idFactory.window();
      default:
        return idFactory.attempt();
    }
  };
  const env: Env = {
    now: () => deps.clock.now(),
    localDate: (ms) => deps.clock.localDate(ms),
    newId,
    relayUrl: deps.relayUrl,
    appVersion: deps.appVersion,
    platform: deps.platform,
    fixtureMode: deps.fixtureMode === true,
    // UI decoys only (A3-06): deps.randomBytes when present, else a non-cryptographic source.
    randomBytes: (n) => (deps.randomBytes ? deps.randomBytes(n) : fallbackBytes(n)),
    nfcSelfTest,
  };
  const machine = new Machine(env);
  const storage: StoragePort = deps.fixtureMode === true ? createMemoryStorage() : deps.storage;
  const listeners = new Set<(view: TvView) => void>();

  let disposed = false;
  let lastView: TvView = machine.view();
  let lastJson = JSON.stringify(lastView);
  let running = false;
  const queue: Event[] = [];
  const outbox = new Outbox({ idFactory, clock: () => deps.clock.now() });
  let chain: Promise<void> = Promise.resolve();

  function enqueueStorage(task: () => Promise<void>): void {
    chain = chain.then(task).catch(() => {
      dispatchEvent({ kind: 'internal', event: { type: 'storage_failed' } });
    });
  }

  function runPersist(op: PersistOp): void {
    enqueueStorage(async () => {
      switch (op.op) {
        case 'settings':
          await saveSettings(storage, op.settings);
          break;
        case 'phrases':
          await savePhrases(storage, op.phrases);
          break;
        case 'session':
          await saveSessionRecord(storage, op.record, op.all);
          break;
        case 'checkpoint':
          await saveCheckpoint(storage, op.checkpoint);
          break;
        case 'clear_checkpoint':
          await clearCheckpoint(storage);
          break;
      }
    });
  }

  function execute(effect: Effect): void {
    switch (effect.kind) {
      case 'send':
        try {
          deps.transport.send(outbox.encode(effect.message));
        } catch {
          // An invalid outbound message is a bug, never a reason to stop the session; it is counted.
          dispatchEvent({ kind: 'internal', event: { type: 'send_failed' } });
        }
        break;
      case 'bind':
        outbox.bind(effect.roomId, effect.generation);
        break;
      case 'connect':
        deps.transport.connect(relaySocketUrl(deps.relayUrl));
        break;
      case 'close':
        deps.transport.close(effect.reason);
        break;
      case 'persist':
        runPersist(effect.op);
        break;
      case 'delete_all':
        enqueueStorage(async () => {
          const result = await deleteAllLocalData(storage);
          dispatchEvent({ kind: 'internal', event: { type: 'delete_done', result } });
        });
        break;
    }
  }

  function notify(): void {
    const view = machine.view();
    const json = JSON.stringify(view);
    if (json === lastJson) return;
    lastView = view;
    lastJson = json;
    for (const listener of [...listeners]) listener(view);
  }

  function dispatchEvent(event: Event): void {
    if (disposed) return;
    queue.push(event);
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift() as Event;
        const effects = machine.handle(next);
        for (const effect of effects) execute(effect);
        notify();
      }
    } finally {
      running = false;
    }
  }

  const loading = (async () => {
    try {
      const data = await loadData(storage, deps.clock.now());
      dispatchEvent({ kind: 'internal', event: { type: 'loaded', data } });
    } catch {
      dispatchEvent({ kind: 'internal', event: { type: 'load_failed' } });
    }
  })();

  return {
    getView: () => lastView,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(input: TvInput) {
      dispatchEvent(input);
    },
    ready: () => loading.then(() => chain),
    dispose() {
      if (disposed) return;
      if (machine.s.win !== null) dispatchEvent({ kind: 'app', event: 'backgrounded' });
      disposed = true;
      listeners.clear();
      deps.transport.close('dispose');
    },
  };
}

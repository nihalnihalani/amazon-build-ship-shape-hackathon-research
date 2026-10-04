/**
 * createSessionStore: wires the pure Machine to the injected ports.
 * - The store owns no timers: the app ticks { kind: 'timer', now } every 100-250 ms.
 * - Storage writes are serialized through one promise chain so they cannot reorder.
 * - Fixture mode swaps in an in-memory store so demo history never reaches real history.
 */

import type { SessionStore, SessionStoreDeps, StoragePort, TvInput, TvView } from './contract.js';
import { createIdGenerator } from './ids.js';
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
import { encodeOutbound, isPreAuth } from './wire.js';

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const newId = createIdGenerator(deps.randomBytes);
  const env: Env = {
    now: () => deps.clock.now(),
    localDate: (ms) => deps.clock.localDate(ms),
    newId,
    relayUrl: deps.relayUrl,
    appVersion: deps.appVersion,
    platform: deps.platform,
    fixtureMode: deps.fixtureMode === true,
  };
  const machine = new Machine(env);
  const storage: StoragePort = deps.fixtureMode === true ? createMemoryStorage() : deps.storage;
  const listeners = new Set<(view: TvView) => void>();

  let disposed = false;
  let lastView: TvView = machine.view();
  let lastJson = JSON.stringify(lastView);
  let running = false;
  const queue: Event[] = [];
  const sequence = { roomId: null as string | null, generation: -1, n: 0 };
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
      case 'send': {
        const message = effect.message;
        const pre = isPreAuth(message);
        const generation = pre ? 0 : effect.generation;
        const roomId = message.type === 'room.create' ? null : effect.roomId;
        let seq = 0;
        if (!pre) {
          if (sequence.roomId !== effect.roomId || sequence.generation !== generation) {
            sequence.roomId = effect.roomId;
            sequence.generation = generation;
            sequence.n = 0;
          }
          sequence.n += 1;
          seq = sequence.n;
        }
        const serialized = encodeOutbound(message, {
          messageId: newId('m_', 20),
          roomId,
          generation,
          sequence: seq,
          now: deps.clock.now(),
        });
        deps.transport.send(serialized);
        break;
      }
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

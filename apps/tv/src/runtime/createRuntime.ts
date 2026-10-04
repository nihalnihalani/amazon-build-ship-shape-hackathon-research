import { createSessionStore } from '@atr/session-core';
import type { SessionStore, SessionStoreDeps } from '@atr/session-core';
import { createAsyncStoragePort } from '../adapters/asyncStoragePort';
import { createClock } from '../adapters/clock';
import { createWsTransport } from '../adapters/wsTransport';
import type { WsTransport } from '../adapters/wsTransport';
import { APP_VERSION, getAppConfig } from '../config';
import type { AppConfig } from '../config';

export type SessionStoreFactory = (deps: SessionStoreDeps) => SessionStore;

/**
 * Kept for tests that inject a fake store: returns the module's createSessionStore when it is a
 * function, otherwise null (the app then shows a fatal screen instead of pretending to work).
 */
export function resolveSessionStoreFactory(moduleExports: object): SessionStoreFactory | null {
  const candidate: unknown = Reflect.get(moduleExports, 'createSessionStore');
  return typeof candidate === 'function' ? (candidate as SessionStoreFactory) : null;
}

function randomBytesFromPlatform(): ((n: number) => Uint8Array) | undefined {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi === undefined || typeof cryptoApi.getRandomValues !== 'function') return undefined;
  return (n: number) => {
    const bytes = new Uint8Array(n);
    cryptoApi.getRandomValues?.(bytes);
    return bytes;
  };
}

export interface Runtime {
  store: SessionStore;
  transport: WsTransport;
  config: AppConfig;
}

export interface RuntimeOptions {
  config?: AppConfig;
  factory?: SessionStoreFactory | null;
}

/** Builds the real ports (AsyncStorage, WebSocket, local clock) and the session store. */
export function createRuntime(options: RuntimeOptions = {}): Runtime | null {
  const config = options.config ?? getAppConfig();
  const factory = options.factory === undefined ? createSessionStore : options.factory;
  if (factory === null) return null;
  const transport = createWsTransport();
  const randomBytes = randomBytesFromPlatform();
  const deps: SessionStoreDeps = {
    clock: createClock(),
    storage: createAsyncStoragePort(),
    transport,
    relayUrl: config.relayUrl,
    appVersion: APP_VERSION,
    platform: config.platform,
    fixtureMode: config.fixtureMode,
    ...(randomBytes === undefined ? {} : { randomBytes }),
  };
  const store = factory(deps);
  transport.attach((input) => store.dispatch(input));
  return { store, transport, config };
}

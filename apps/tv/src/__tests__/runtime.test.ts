import type { SessionStore, SessionStoreDeps, TvInput } from '@atr/session-core';
import { DEFAULT_RELAY_URL, resolveConfig } from '../config';
import { createRuntime, resolveSessionStoreFactory } from '../runtime/createRuntime';

function fakeStoreFor(deps: SessionStoreDeps, sink: TvInput[]): SessionStore {
  void deps;
  return {
    getView: () => {
      throw new Error('not used');
    },
    subscribe: () => () => undefined,
    dispatch: (input) => {
      sink.push(input);
    },
    ready: () => Promise.resolve(),
    dispose: () => undefined,
  };
}

describe('resolveSessionStoreFactory', () => {
  it('finds createSessionStore by name and rejects anything that is not a function', () => {
    const factory = jest.fn();
    expect(resolveSessionStoreFactory({ createSessionStore: factory })).toBe(factory);
    expect(resolveSessionStoreFactory({})).toBeNull();
    expect(resolveSessionStoreFactory({ createSessionStore: 5 })).toBeNull();
  });
});

describe('createRuntime', () => {
  it('returns null when the session engine is not available', () => {
    expect(createRuntime({ config: resolveConfig(undefined), factory: null })).toBeNull();
  });

  it('builds the ports, passes the documented dependencies and wires the transport to the store', () => {
    const received: TvInput[] = [];
    let captured: SessionStoreDeps | undefined;
    const runtime = createRuntime({
      config: resolveConfig(undefined),
      factory: (deps) => {
        captured = deps;
        return fakeStoreFor(deps, received);
      },
    });
    expect(runtime).not.toBeNull();
    expect(captured?.relayUrl).toBe(DEFAULT_RELAY_URL);
    expect(captured?.platform).toBe('vega');
    expect(captured?.appVersion).toBe('0.1.0');
    expect(captured?.fixtureMode).toBe(false);
    expect(typeof captured?.clock.now()).toBe('number');
    expect(captured?.clock.localDate(new Date(2026, 9, 5, 12).getTime())).toBe('2026-10-05');
    // The transport emits into the store: close() reports offline through dispatch.
    runtime?.transport.close('test_done');
    expect(received).toContainEqual({ kind: 'transport', state: 'offline', detail: 'test_done' });
  });

  it('uses the configured relay URL and fixture mode', () => {
    let captured: SessionStoreDeps | undefined;
    createRuntime({
      config: resolveConfig({ relayUrl: 'wss://relay.example.test/ws', fixtureMode: true, platform: 'web_preview' }),
      factory: (deps) => {
        captured = deps;
        return fakeStoreFor(deps, []);
      },
    });
    expect(captured?.relayUrl).toBe('wss://relay.example.test/ws');
    expect(captured?.fixtureMode).toBe(true);
    expect(captured?.platform).toBe('web_preview');
  });

  it('passes platform randomness only when crypto.getRandomValues exists', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      let captured: SessionStoreDeps | undefined;
      const factory = (deps: SessionStoreDeps) => {
        captured = deps;
        return fakeStoreFor(deps, []);
      };
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      createRuntime({ config: resolveConfig(undefined), factory });
      expect(captured?.randomBytes).toBeUndefined();
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues: (array: Uint8Array) => array.fill(7) },
      });
      createRuntime({ config: resolveConfig(undefined), factory });
      expect(Array.from(captured?.randomBytes?.(4) ?? [])).toEqual([7, 7, 7, 7]);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  });
});

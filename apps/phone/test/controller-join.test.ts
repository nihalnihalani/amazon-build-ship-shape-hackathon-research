import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE,
  CREDENTIAL,
  joinAccepted,
  joinPending,
  relayMsg,
  ROOM,
} from './helpers/fakes.js';
import { makeHarness, pairedHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('join flow', () => {
  it('starts on the join view with nothing connected and no microphone activity', () => {
    const h = makeHarness();
    const s = h.controller.getState();
    expect(s.screen).toBe('join');
    expect(s.link).toBe('disconnected');
    expect(s.join.deviceLabel).toBe('Android Chrome');
    expect(h.sockets.sockets).toHaveLength(0);
    expect(h.audio.openCalls).toHaveLength(0);
  });

  it('normalizes the code as it is typed and flags characters outside the alphabet', () => {
    const h = makeHarness();
    h.controller.setCode('acdefh');
    expect(h.controller.getState().join.code).toBe('ACDEFH');
    expect(h.controller.getState().join.codeMessage).toBeNull();
    h.controller.setCode('ACDEF0');
    expect(h.controller.getState().join.codeMessage).toContain('"0"');
  });

  it('refuses to connect with an incomplete or invalid code, or a bad device name', () => {
    const h = makeHarness();
    h.controller.setCode('ACD');
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(0);
    expect(h.controller.getState().join.codeMessage).toMatch(/6 characters/);
    h.controller.setCode(CODE);
    h.controller.setDeviceLabel('x'.repeat(25));
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(0);
    expect(h.controller.getState().join.deviceLabelMessage).toMatch(/limit is 24/);
    h.controller.setDeviceLabel('');
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(0);
  });

  it('dials the relay URL and sends join.request once the socket is open', () => {
    const h = makeHarness();
    h.controller.setCode('acdefh');
    h.controller.setDeviceLabel('  Kitchen phone  ');
    h.controller.join();
    expect(h.sockets.current.url).toBe('wss://relay.test/ws');
    expect(h.controller.getState().join.phase).toBe('connecting');
    expect(h.sockets.current.sent).toHaveLength(0);
    h.sockets.current.open();
    const [req] = h.sockets.current.messages();
    expect(req).toMatchObject({ type: 'join.request', payload: { pairing_code: 'ACDEFH', device_label: 'Kitchen phone' } });
  });

  it('a second Join press while connecting does nothing', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(1);
  });

  it('join.pending shows the confirm digits', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('47'));
    expect(h.controller.getState().join).toMatchObject({ phase: 'pending', confirmDigits: '47' });
    expect(h.controller.getState().screen).toBe('join');
  });

  it('join.accepted pairs: setup screen, connected, credential kept out of observable state, first mic.state sent', async () => {
    const h = await pairedHarness();
    const s = h.controller.getState();
    expect(s.screen).toBe('setup');
    expect(s.link).toBe('connected');
    expect(s.join.code).toBe('');
    expect(JSON.stringify(s)).not.toContain(CREDENTIAL);
    const msgs = h.sockets.current.messages();
    expect(msgs.map((m) => m.type)).toEqual(['join.request', 'mic.state']);
    const mic = msgs[1];
    expect(mic).toMatchObject({
      room_id: ROOM,
      producer_generation: 1,
      sequence: 0, // revision 2: the sequence restarts at 0 for each generation
      session_id: null,
      payload: { state: 'off', visibility: 'visible', mode: 'physical_phone', wake_lock: 'not_requested' },
    });
  });

  it.each([
    ['rejected', /rejected/i],
    ['expired', /expired/i],
    ['room_full', /already has a phone/i],
    ['busy', /another phone is joining/i],
  ] as const)('join.rejected (%s) returns to the form with a plain-language reason', (reason, text) => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(relayMsg('join.rejected', { reason }));
    const s = h.controller.getState();
    expect(s.screen).toBe('join');
    expect(s.join.phase).toBe('idle');
    expect(s.join.confirmDigits).toBeNull();
    expect(s.join.message).toMatch(text);
    expect(s.link).toBe('disconnected');
    expect(h.sockets.current.closeCalls.length).toBeGreaterThan(0);
  });

  it.each([
    ['not_found', /not recognised/],
    ['expired', /expired/],
    ['join_busy', /another phone/i],
    ['rate_limited', /too many/i],
    ['origin_rejected', /not allowed/],
    ['internal', /could not accept/],
  ])('relay error %s while joining shows a message and allows a retry', (code, text) => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code, ref_message_id: null, detail: '' }));
    expect(h.controller.getState().join.message).toMatch(text);
    expect(h.controller.getState().join.phase).toBe('idle');
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(2);
  });

  it('connection failure before the socket opens is explained and can be retried', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.drop(1006);
    expect(h.controller.getState().join).toMatchObject({ phase: 'idle' });
    expect(h.controller.getState().join.message).toMatch(/Could not reach the relay/);
    h.controller.join();
    expect(h.sockets.sockets).toHaveLength(2);
    expect(h.controller.getState().join.phase).toBe('connecting');
  });

  it('the relay closing the connection while the TV has not confirmed is reported (join expired)', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.drop(4401);
    expect(h.controller.getState().join.phase).toBe('idle');
    expect(h.controller.getState().join.message).toMatch(/closed before the TV confirmed/);
    expect(h.controller.getState().screen).toBe('join');
  });

  it('cancelJoin closes the socket and returns to the form', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.controller.cancelJoin();
    expect(h.controller.getState().join.phase).toBe('idle');
    expect(h.sockets.current.closeCalls.length).toBeGreaterThan(0);
    // late messages from the cancelled socket are ignored
    h.sockets.current.receive(joinAccepted());
    expect(h.controller.getState().screen).toBe('join');
  });

  it('ignores join.accepted when no join is in progress', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinAccepted());
    expect(h.controller.getState().screen).toBe('setup'); // accepted while joining is valid
    const h2 = makeHarness();
    h2.sockets.create('wss://stray');
    expect(h2.controller.getState().screen).toBe('join');
  });

  it('garbage and unknown frames are ignored', () => {
    const h = makeHarness();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive('not json');
    h.sockets.current.receive(JSON.stringify({ hello: 1 }));
    h.sockets.current.receive(relayMsg('pong', { server_time: 1 }));
    expect(h.controller.getState().join.phase).toBe('connecting');
  });

  it('page reload means pairing again: a new controller has no credential, and nothing touched browser storage', async () => {
    const touched: string[] = [];
    const saved = ['localStorage', 'sessionStorage', 'indexedDB', 'caches'].map((name) => ({
      name,
      desc: Object.getOwnPropertyDescriptor(globalThis, name),
    }));
    for (const { name } of saved) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name);
          return undefined;
        },
      });
    }
    try {
      const first = await pairedHarness();
      first.audio.makeOpen();
      first.controller.setCueWord('Hush');
      first.controller.savePhrases(['one']);
      expect(first.controller.getState().screen).toBe('setup');
      const second = makeHarness(); // "reload"
      expect(second.controller.getState().screen).toBe('join');
      expect(second.controller.hasPairedBefore).toBe(false);
      expect(second.sockets.sockets).toHaveLength(0);
      expect(touched).toEqual([]);
    } finally {
      for (const { name, desc } of saved) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });
});

describe('secure context', () => {
  it('without a secure context the microphone can never be started from the controller', async () => {
    const h = await pairedHarness({ secureContext: false });
    expect(h.controller.getState().secureContext).toBe(false);
    expect(h.controller.getState().canStartMic).toBe(false);
    h.controller.startMic();
    expect(h.audio.openCalls).toHaveLength(0);
  });
});

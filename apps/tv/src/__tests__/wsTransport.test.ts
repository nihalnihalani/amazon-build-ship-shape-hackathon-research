import type { TvInput } from '@atr/session-core';
import { BACKOFF_MS, FAILED_AFTER, backoffDelayMs, createWsTransport } from '../adapters/wsTransport';
import type { WebSocketLike } from '../adapters/wsTransport';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];
  throwOnSend = false;
  constructor(readonly url: string) {}
  send(data: string): void {
    if (this.throwOnSend) throw new Error('send failed');
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closes.push({ code, reason });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(data: unknown): void {
    this.onmessage?.({ data });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  fail(): void {
    this.onerror?.({});
  }
}

function setup(options: { throwOnCreate?: () => boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ id: number; callback: () => void; ms: number; cleared: boolean }> = [];
  const inputs: TvInput[] = [];
  const transport = createWsTransport({
    createSocket: (url) => {
      if (options.throwOnCreate?.()) throw new Error('boom');
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, ms) => {
      const entry = { id: timers.length + 1, callback, ms, cleared: false };
      timers.push(entry);
      return entry.id;
    },
    clearTimer: (handle) => {
      const entry = timers.find((t) => t.id === handle);
      if (entry) entry.cleared = true;
    },
  });
  transport.attach((input) => inputs.push(input));
  const pending = () => timers.filter((t) => !t.cleared);
  const fireNext = () => {
    const next = pending().find((t) => !('fired' in t));
    if (!next) throw new Error('no pending timer');
    next.cleared = true;
    next.callback();
  };
  const states = () => inputs.filter((i) => i.kind === 'transport').map((i) => (i.kind === 'transport' ? i.state : ''));
  return { transport, sockets, timers, inputs, pending, fireNext, states };
}

describe('backoff schedule (ADR-0006): 0.5, 1, 2, 4, 8 s, cap 8 s', () => {
  it('maps consecutive failures to delays', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(backoffDelayMs(0)).toBe(500);
    expect(BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
  });
});

describe('connect, messages and send', () => {
  it('emits connecting, then connected on open', () => {
    const { transport, sockets, states } = setup();
    transport.connect('wss://relay.test/ws');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('wss://relay.test/ws');
    expect(states()).toEqual(['connecting']);
    sockets[0]?.open();
    expect(states()).toEqual(['connecting', 'connected']);
  });

  it('hands every text frame to the store untouched and drops non-text frames', () => {
    const { transport, sockets, inputs } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.open();
    sockets[0]?.message('{"type":"ping"}');
    sockets[0]?.message('not even json');
    sockets[0]?.message(new ArrayBuffer(4));
    sockets[0]?.message(42);
    const wires = inputs.filter((i) => i.kind === 'wire');
    expect(wires).toEqual([
      { kind: 'wire', message: '{"type":"ping"}' },
      { kind: 'wire', message: 'not even json' },
    ]);
  });

  it('send reports false unless the socket is open, and false if the socket throws', () => {
    const { transport, sockets } = setup();
    expect(transport.send('x')).toBe(false); // never connected
    transport.connect('wss://relay.test/ws');
    expect(transport.send('x')).toBe(false); // connecting
    sockets[0]?.open();
    expect(transport.send('hello')).toBe(true);
    expect(sockets[0]?.sent).toEqual(['hello']);
    if (sockets[0]) sockets[0].throwOnSend = true;
    expect(transport.send('boom')).toBe(false);
  });

  it('can emit before attach without throwing', () => {
    const t = createWsTransport({ createSocket: (url) => new FakeSocket(url) });
    expect(() => t.connect('wss://relay.test/ws')).not.toThrow();
  });
});

describe('reconnect', () => {
  it('reconnects with 0.5, 1, 2, 4, 8, 8 s delays and reports failed once after six failures', () => {
    const { transport, sockets, pending, fireNext, states } = setup();
    transport.connect('wss://relay.test/ws');
    const delays: number[] = [];
    for (let i = 0; i < FAILED_AFTER; i++) {
      sockets[sockets.length - 1]?.drop();
      delays.push(pending()[0]?.ms ?? -1);
      fireNext();
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(sockets).toHaveLength(1 + FAILED_AFTER);
    // connecting once, reconnecting for failures 1..5, failed exactly once on the sixth.
    expect(states()).toEqual(['connecting', 'reconnecting', 'reconnecting', 'reconnecting', 'reconnecting', 'reconnecting', 'failed']);
    // Retries continue quietly at the cap with no further state spam.
    sockets[sockets.length - 1]?.drop();
    expect(pending()[0]?.ms).toBe(8000);
    expect(states().filter((s) => s === 'failed')).toHaveLength(1);
  });

  it('resets the backoff after a successful open', () => {
    const { transport, sockets, pending, fireNext, states } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.drop();
    expect(pending()[0]?.ms).toBe(500);
    fireNext();
    sockets[1]?.drop();
    expect(pending()[0]?.ms).toBe(1000);
    fireNext();
    sockets[2]?.open();
    expect(states().slice(-1)).toEqual(['connected']);
    sockets[2]?.drop();
    expect(pending()[0]?.ms).toBe(500);
    expect(states().slice(-1)).toEqual(['reconnecting']);
  });

  it('treats an error followed by a close as one drop', () => {
    const { transport, sockets, pending } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.fail();
    sockets[0]?.drop();
    expect(pending()).toHaveLength(1);
  });

  it('retries when the socket cannot even be created', () => {
    let failCreate = true;
    const { transport, pending, fireNext, sockets, states } = setup({ throwOnCreate: () => failCreate });
    transport.connect('wss://relay.test/ws');
    expect(pending()[0]?.ms).toBe(500);
    expect(states()).toEqual(['connecting', 'reconnecting']);
    failCreate = false;
    fireNext();
    expect(sockets).toHaveLength(1);
  });

  it('ignores events from a socket that has been replaced', () => {
    const { transport, sockets, inputs } = setup();
    transport.connect('wss://relay.test/ws');
    const old = sockets[0] as FakeSocket;
    transport.connect('wss://relay.test/ws2');
    const count = inputs.length;
    old.open();
    old.message('late');
    old.drop();
    expect(inputs).toHaveLength(count);
    expect(old.closes).toHaveLength(1);
    expect(sockets[1]?.url).toBe('wss://relay.test/ws2');
  });
});

describe('close', () => {
  it('closes the socket, reports offline with the reason and never reconnects', () => {
    const { transport, sockets, pending, inputs } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.open();
    transport.close('session_ended');
    expect(sockets[0]?.closes).toEqual([{ code: 1000, reason: 'session_ended' }]);
    expect(inputs.slice(-1)[0]).toEqual({ kind: 'transport', state: 'offline', detail: 'session_ended' });
    sockets[0]?.drop();
    expect(pending()).toHaveLength(0);
    expect(transport.send('x')).toBe(false);
  });

  it('cancels a pending reconnect', () => {
    const { transport, sockets, timers, pending } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.drop();
    expect(pending()).toHaveLength(1);
    transport.close('user_cancelled');
    expect(pending()).toHaveLength(0);
    expect(timers[0]?.cleared).toBe(true);
  });

  it('keeps the close reason short for the socket close frame', () => {
    const { transport, sockets } = setup();
    transport.connect('wss://relay.test/ws');
    transport.close('x'.repeat(500));
    expect(sockets[0]?.closes[0]?.reason?.length).toBe(100);
  });

  it('never puts the relay URL in an emitted detail', () => {
    const { transport, sockets, inputs } = setup();
    transport.connect('wss://relay.test/secret-path');
    sockets[0]?.fail();
    for (const input of inputs) expect(JSON.stringify(input)).not.toContain('secret-path');
  });
});

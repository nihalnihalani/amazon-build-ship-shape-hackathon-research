import type { TvInput } from '@atr/session-core';
import {
  BACKOFF_MS,
  CONNECT_TIMEOUT_MS,
  FAIL_AFTER_MS,
  backoffBaseMs,
  backoffDelayMs,
  createWsTransport,
} from '../adapters/wsTransport';
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

interface Timer {
  id: number;
  callback: () => void;
  due: number;
  ms: number;
  cleared: boolean;
}

/** Virtual clock + timers: `fireNext()` jumps to the earliest pending timer and runs it. */
function setup(options: { throwOnCreate?: () => boolean; random?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Timer[] = [];
  const inputs: TvInput[] = [];
  const clock = { t: 0 };
  const transport = createWsTransport({
    createSocket: (url) => {
      if (options.throwOnCreate?.()) throw new Error('boom');
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, ms) => {
      const entry: Timer = { id: timers.length + 1, callback, due: clock.t + ms, ms, cleared: false };
      timers.push(entry);
      return entry.id;
    },
    clearTimer: (handle) => {
      const entry = timers.find((t) => t.id === handle);
      if (entry) entry.cleared = true;
    },
    random: options.random ?? (() => 0.5), // jitter factor exactly 1
    now: () => clock.t,
  });
  transport.attach((input) => inputs.push(input));
  const pending = () => timers.filter((t) => !t.cleared);
  /** Pending retry timers (everything except the connection timeout). */
  const retries = () => pending().filter((t) => t.ms !== CONNECT_TIMEOUT_MS);
  const fireNext = () => {
    const next = [...pending()].sort((a, b) => a.due - b.due)[0];
    if (!next) throw new Error('no pending timer');
    next.cleared = true;
    clock.t = Math.max(clock.t, next.due);
    next.callback();
  };
  const fireRetry = () => {
    const next = [...retries()].sort((a, b) => a.due - b.due)[0];
    if (!next) throw new Error('no pending retry');
    next.cleared = true;
    clock.t = Math.max(clock.t, next.due);
    next.callback();
  };
  const states = () => inputs.filter((i) => i.kind === 'transport').map((i) => (i.kind === 'transport' ? i.state : ''));
  const last = () => sockets[sockets.length - 1] as FakeSocket;
  return { transport, sockets, timers, inputs, clock, pending, retries, fireNext, fireRetry, states, last };
}

describe('backoff schedule (ADR-0006, A6-02): 0.5, 1, 2, 4, 8 s, cap 8 s, +-25 % jitter', () => {
  it('base delays by consecutive failure', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffBaseMs(n))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(backoffBaseMs(0)).toBe(500);
    expect(BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('applies jitter between 0.75 and 1.25 of the base (hand computed)', () => {
    expect(backoffDelayMs(1, () => 0)).toBe(375);
    expect(backoffDelayMs(1, () => 0.5)).toBe(500);
    expect(backoffDelayMs(1, () => 1)).toBe(625);
    expect(backoffDelayMs(3, () => 0)).toBe(1500);
    expect(backoffDelayMs(3, () => 1)).toBe(2500);
    expect(backoffDelayMs(5, () => 0)).toBe(6000);
    expect(backoffDelayMs(5, () => 1)).toBe(10000);
    expect(backoffDelayMs(50, () => 0.25)).toBe(7000); // base 8000 * (1 + (0.5 - 1) * 0.25)
  });

  it('clamps a bad random source instead of producing a bad delay', () => {
    expect(backoffDelayMs(2, () => -3)).toBe(750);
    expect(backoffDelayMs(2, () => 9)).toBe(1250);
    expect(backoffDelayMs(2, () => Number.NaN)).toBe(1000);
  });

  it('with the real random source every delay stays inside the jitter band', () => {
    for (let n = 1; n <= 8; n++) {
      for (let i = 0; i < 200; i++) {
        const delay = backoffDelayMs(n);
        expect(delay).toBeGreaterThanOrEqual(Math.round(backoffBaseMs(n) * 0.75));
        expect(delay).toBeLessThanOrEqual(Math.round(backoffBaseMs(n) * 1.25));
      }
    }
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

  it('hands every text frame to the store as the raw string and drops non-text frames (contract rev 2)', () => {
    const { transport, sockets, inputs } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.open();
    sockets[0]?.message('{"type":"ping"}');
    sockets[0]?.message('not even json');
    sockets[0]?.message(new ArrayBuffer(4));
    sockets[0]?.message(42);
    sockets[0]?.message({ type: 'ping' });
    const wires = inputs.filter((i) => i.kind === 'wire');
    expect(wires).toEqual([
      { kind: 'wire', message: '{"type":"ping"}' },
      { kind: 'wire', message: 'not even json' },
    ]);
    for (const wire of wires) expect(typeof (wire as { message: unknown }).message).toBe('string');
  });

  it('send reports false unless the socket is open, and false if the socket throws', () => {
    const { transport, sockets } = setup();
    expect(transport.send('x')).toBe(false);
    transport.connect('wss://relay.test/ws');
    expect(transport.send('x')).toBe(false);
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

describe('reconnect with jitter', () => {
  it('uses 0.5, 1, 2, 4, 8, 8 s delays (jitter factor 1) and reports reconnecting once', () => {
    const { transport, retries, fireRetry, states, last } = setup();
    transport.connect('wss://relay.test/ws');
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      last().drop();
      delays.push(retries()[0]?.ms ?? -1);
      fireRetry();
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(states()).toEqual(['connecting', 'reconnecting']);
  });

  it('jitters each delay with the injected random source', () => {
    const lows = setup({ random: () => 0 });
    lows.transport.connect('wss://relay.test/ws');
    lows.last().drop();
    expect(lows.retries()[0]?.ms).toBe(375);
    const highs = setup({ random: () => 1 });
    highs.transport.connect('wss://relay.test/ws');
    highs.last().drop();
    expect(highs.retries()[0]?.ms).toBe(625);
  });

  it('resets the backoff after a successful open', () => {
    const { transport, sockets, retries, fireRetry, states } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.drop();
    expect(retries()[0]?.ms).toBe(500);
    fireRetry();
    sockets[1]?.drop();
    expect(retries()[0]?.ms).toBe(1000);
    fireRetry();
    sockets[2]?.open();
    expect(states().slice(-1)).toEqual(['connected']);
    sockets[2]?.drop();
    expect(retries()[0]?.ms).toBe(500);
    expect(states().slice(-1)).toEqual(['reconnecting']);
  });

  it('treats an error followed by a close as one drop', () => {
    const { transport, sockets, retries } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.fail();
    sockets[0]?.drop();
    expect(retries()).toHaveLength(1);
  });

  it('retries when the socket cannot even be created', () => {
    let failCreate = true;
    const { transport, retries, fireRetry, sockets, states } = setup({ throwOnCreate: () => failCreate });
    transport.connect('wss://relay.test/ws');
    expect(retries()[0]?.ms).toBe(500);
    expect(states()).toEqual(['connecting', 'reconnecting']);
    failCreate = false;
    fireRetry();
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

describe('connection timeout', () => {
  it('counts an attempt that neither opens nor closes as a failure', () => {
    const { transport, pending, fireNext, states, retries, clock } = setup();
    transport.connect('wss://relay.test/ws');
    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.ms).toBe(CONNECT_TIMEOUT_MS);
    fireNext();
    expect(clock.t).toBe(CONNECT_TIMEOUT_MS);
    expect(states()).toEqual(['connecting', 'reconnecting']);
    expect(retries()).toHaveLength(1);
  });

  it('is cancelled by a successful open', () => {
    const { transport, sockets, pending } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.open();
    expect(pending()).toHaveLength(0);
  });
});

describe('two minutes of continuous failure (A6-02)', () => {
  it('reports failed once at exactly 120 s, then stops with nothing pending', () => {
    const { transport, sockets, clock, states, pending, fireRetry, retries, last } = setup();
    expect(FAIL_AFTER_MS).toBe(120_000);
    transport.connect('wss://relay.test/ws');
    let guard = 0;
    while (!states().includes('failed') && guard++ < 100) {
      last().drop();
      if (states().includes('failed')) break;
      fireRetry();
    }
    expect(states()).toEqual(['connecting', 'reconnecting', 'failed']);
    // Delays 0.5, 1, 2, 4, 8 s (15.5 s), then 13 x 8 s (119.5 s), then the last one clamped to the 0.5 s left:
    // 19 retries after the first socket.
    expect(sockets).toHaveLength(20);
    expect(clock.t).toBe(120_000);
    expect(pending()).toHaveLength(0);
    expect(retries()).toHaveLength(0);
    expect(transport.send('x')).toBe(false);
  });

  it('does nothing more after failed, even if a stale socket fires late', () => {
    const { transport, sockets, states, last, fireRetry } = setup();
    transport.connect('wss://relay.test/ws');
    let guard = 0;
    while (!states().includes('failed') && guard++ < 100) {
      last().drop();
      if (states().includes('failed')) break;
      fireRetry();
    }
    expect(states()).toContain('failed'); // precondition: the streak really reached 'failed'
    const count = sockets.length;
    const inputsBefore = states().length;
    for (const socket of sockets) {
      socket.onclose?.({});
      socket.onerror?.({});
    }
    expect(sockets).toHaveLength(count);
    expect(states()).toHaveLength(inputsBefore);
  });

  it('starts again only when connect() is called', () => {
    const { transport, sockets, states, last, fireRetry, pending } = setup();
    transport.connect('wss://relay.test/ws');
    let guard = 0;
    while (!states().includes('failed') && guard++ < 100) {
      last().drop();
      if (states().includes('failed')) break;
      fireRetry();
    }
    expect(states().slice(-1)).toEqual(['failed']);
    expect(pending()).toHaveLength(0);
    transport.connect('wss://relay.test/ws');
    expect(states().slice(-1)).toEqual(['connecting']);
    last().open();
    expect(states().slice(-1)).toEqual(['connected']);
    // A fresh streak: the next drop is a first failure again.
    last().drop();
    expect(states().slice(-1)).toEqual(['reconnecting']);
    expect(sockets.length).toBeGreaterThan(20);
  });

  it('a success inside the window restarts the 2-minute clock', () => {
    const { transport, sockets, clock, states, last, fireRetry } = setup();
    transport.connect('wss://relay.test/ws');
    for (let i = 0; i < 12; i++) {
      last().drop();
      fireRetry();
    }
    expect(clock.t).toBeGreaterThan(60_000);
    last().open();
    clock.t += 200_000;
    last().drop();
    expect(states()).not.toContain('failed');
    expect(states().slice(-1)).toEqual(['reconnecting']);
    expect(sockets.length).toBeGreaterThan(12);
  });
});

describe('close (terminal causes are handled by the store calling close)', () => {
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

  it.each(['revoked', 'expired', 'unauthorized', 'superseded', 'unpaired'])(
    'honours an intentional close for terminal cause %s: no retry is ever scheduled',
    (cause) => {
      const { transport, sockets, pending, fireNext, states } = setup();
      transport.connect('wss://relay.test/ws');
      sockets[0]?.open();
      transport.close(cause);
      expect(states().slice(-1)).toEqual(['offline']);
      expect(pending()).toHaveLength(0);
      expect(() => fireNext()).toThrow('no pending timer');
      expect(sockets).toHaveLength(1);
    },
  );

  it('cancels a pending reconnect', () => {
    const { transport, sockets, timers, retries } = setup();
    transport.connect('wss://relay.test/ws');
    sockets[0]?.drop();
    expect(retries()).toHaveLength(1);
    transport.close('user_cancelled');
    expect(retries()).toHaveLength(0);
    expect(timers.find((t) => t.ms === 500)?.cleared).toBe(true);
  });

  it('cancels a pending connection timeout', () => {
    const { transport, pending } = setup();
    transport.connect('wss://relay.test/ws');
    expect(pending()).toHaveLength(1);
    transport.close('cancelled');
    expect(pending()).toHaveLength(0);
  });

  it('can connect again after an intentional close', () => {
    const { transport, sockets, states } = setup();
    transport.connect('wss://relay.test/ws');
    transport.close('unpaired');
    transport.connect('wss://relay.test/ws');
    expect(sockets).toHaveLength(2);
    expect(states().slice(-1)).toEqual(['connecting']);
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

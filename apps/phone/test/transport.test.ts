import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, LINK_DEAD_MS, RECONNECT_BACKOFF_MS } from '../src/config.js';
import { backoffDelay, Transport } from '../src/transport.js';
import { FakeSocket, SocketRegistry } from './helpers/fakes.js';

describe('backoff schedule (ADR-0006)', () => {
  const nominal = (): number => 0.5; // jitter factor exactly 1.0
  it('nominal delays are 0.5, 1, 2, 4, 8 seconds and then stay at 8', () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => backoffDelay(n, RECONNECT_BACKOFF_MS, nominal))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(backoffDelay(-3, RECONNECT_BACKOFF_MS, nominal)).toBe(500);
  });

  it('jitter is +/-25 %: random 0 gives 75 %, random 1 gives 125 %, always inside that band', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffDelay(n, RECONNECT_BACKOFF_MS, () => 0))).toEqual([375, 750, 1500, 3000, 6000, 6000]);
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffDelay(n, RECONNECT_BACKOFF_MS, () => 1))).toEqual([625, 1250, 2500, 5000, 10000, 10000]);
    for (let n = 0; n < 8; n++) {
      const base = RECONNECT_BACKOFF_MS[Math.min(n, 4)] as number;
      for (let i = 0; i <= 100; i++) {
        const d = backoffDelay(n, RECONNECT_BACKOFF_MS, () => i / 100);
        expect(d).toBeGreaterThanOrEqual(base * 0.75);
        expect(d).toBeLessThanOrEqual(base * 1.25);
      }
    }
  });

  it('the default random source really varies the delay', () => {
    const seen = new Set(Array.from({ length: 50 }, () => backoffDelay(4)));
    expect(seen.size).toBeGreaterThan(10);
    for (const d of seen) {
      expect(d).toBeGreaterThanOrEqual(6000);
      expect(d).toBeLessThanOrEqual(10000);
    }
  });

  it('out-of-range or odd random() values are clamped, never producing a delay outside the band', () => {
    expect(backoffDelay(0, RECONNECT_BACKOFF_MS, () => -5)).toBe(375);
    expect(backoffDelay(0, RECONNECT_BACKOFF_MS, () => 7)).toBe(625);
  });
});

describe('Transport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const reg = new SocketRegistry();
    const events: string[] = [];
    const t = new Transport(reg.create, {
      onOpen: () => events.push('open'),
      onText: (x) => events.push(`text:${x}`),
      onClose: (i) => events.push(`close:${i.reason}:${i.wasOpen}`),
    });
    return { reg, events, t };
  }

  it('sends only while open, delivers text, ignores binary', () => {
    const { reg, events, t } = make();
    t.open('wss://x/ws');
    expect(t.send('a')).toBe(false);
    reg.current.open();
    expect(t.send('a')).toBe(true);
    expect(reg.current.sent).toEqual(['a']);
    reg.current.receive('hello');
    reg.current.onmessage?.({ data: new ArrayBuffer(4) });
    expect(events).toEqual(['open', 'text:hello']);
  });

  it('reports an unexpected close once, with whether it had opened', () => {
    const { reg, events, t } = make();
    t.open('wss://x/ws');
    reg.current.drop(1006); // never opened
    expect(events).toEqual(['close:error:false']);
    t.open('wss://x/ws');
    reg.current.open();
    reg.current.drop(1006);
    expect(events.at(-1)).toBe('close:closed:true');
  });

  it('pings every 10 s and declares the link dead after 25 s without traffic', () => {
    const { reg, events, t } = make();
    t.open('wss://x/ws');
    reg.current.open();
    t.startHeartbeat(() => 'PING');
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(reg.current.sent).toEqual(['PING']);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(reg.current.sent).toEqual(['PING', 'PING']);
    // 30 s of silence in total: at the 30 s tick the link is past 25 s
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(events).toContain('close:link_dead:true');
    expect(reg.current.closeCalls.length).toBeGreaterThan(0);
  });

  it('inbound traffic keeps the link alive', () => {
    const { reg, events, t } = make();
    t.open('wss://x/ws');
    reg.current.open();
    t.startHeartbeat(() => 'PING');
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      reg.current.receive('pong');
    }
    expect(events.filter((e) => e.startsWith('close'))).toEqual([]);
    expect(LINK_DEAD_MS).toBe(25_000);
  });

  it('scheduleRetry opens a fresh socket after the delay, and close() cancels everything', () => {
    const { reg, t } = make();
    t.scheduleRetry(500, 'wss://x/ws');
    vi.advanceTimersByTime(499);
    expect(reg.sockets).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(reg.sockets).toHaveLength(1);
    t.scheduleRetry(1000, 'wss://x/ws');
    t.close();
    vi.advanceTimersByTime(5000);
    expect(reg.sockets).toHaveLength(1);
    const s: FakeSocket = reg.current;
    expect(s.onmessage).toBeNull();
  });

  it('a deliberate close() produces no close event', () => {
    const { reg, events, t } = make();
    t.open('wss://x/ws');
    reg.current.open();
    t.close();
    reg.current.drop();
    expect(events).toEqual(['open']);
  });
});

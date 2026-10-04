import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, LINK_DEAD_MS, RECONNECT_BACKOFF_MS } from '../src/config.js';
import { backoffDelay, Transport } from '../src/transport.js';
import { FakeSocket, SocketRegistry } from './helpers/fakes.js';

describe('backoff schedule (ADR-0006)', () => {
  it('is 0.5, 1, 2, 4, 8 seconds and then stays at 8', () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => backoffDelay(n))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(backoffDelay(-3)).toBe(500);
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

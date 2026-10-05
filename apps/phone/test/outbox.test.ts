import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUCKET_CAPACITY,
  BUCKET_RATE_PER_SEC,
  BUFFER_HIGH_WATER_BYTES,
  LEVEL_TOKEN_RESERVE,
  Outbox,
  type OutboxItem,
  type Priority,
  RATE_LIMIT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MS,
} from '../src/outbox.js';
import { maxInAnyWindow } from './helpers/relay-model.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

interface Rig {
  box: Outbox;
  wire: Array<{ label: string; seq: number; at: number }>;
  buffered: { value: number };
  open: { value: boolean };
  renders: string[];
  item(priority: Priority, label: string, extra?: Partial<OutboxItem>): OutboxItem;
}

function rig(): Rig {
  const wire: Rig['wire'] = [];
  const renders: string[] = [];
  const buffered = { value: 0 };
  const open = { value: true };
  let seq = 0;
  const box = new Outbox({
    now: () => Date.now(),
    transmit: (text) => {
      if (!open.value) return false;
      const [label, s] = text.split('#');
      wire.push({ label: label as string, seq: Number(s), at: Date.now() });
      return true;
    },
    bufferedAmount: () => buffered.value,
  });
  return {
    box,
    wire,
    buffered,
    open,
    renders,
    item: (priority, label, extra = {}) => ({
      priority,
      // numbered at render time, exactly like the controller does
      render: () => {
        renders.push(label);
        seq += 1;
        return { id: `m_${label}`, text: `${label}#${seq}` };
      },
      ...extra,
    }),
  };
}

const labels = (r: Rig): string[] => r.wire.map((w) => w.label);

describe('Outbox: sending now when there is room', () => {
  it('sends critical and state messages at once, in call order, and reports them as sent', () => {
    const r = rig();
    const sentIds: string[] = [];
    expect(r.box.submit(r.item('critical', 'ack1', { onSent: (id) => sentIds.push(id) }))).toBe('sent');
    expect(r.box.submit(r.item('state', 'mic1', { onSent: (id) => sentIds.push(id) }))).toBe('sent');
    expect(r.box.submit(r.item('level', 'lvl1'))).toBe('sent');
    expect(labels(r)).toEqual(['ack1', 'mic1', 'lvl1']);
    expect(sentIds).toEqual(['m_ack1', 'm_mic1']);
    expect(vi.getTimerCount()).toBe(0); // nothing waiting: no timers left behind
  });
});

describe('Outbox: token bucket', () => {
  it('capacity 25: of 100 critical messages submitted at once, 25 go now and the rest wait', () => {
    const r = rig();
    const results = Array.from({ length: 100 }, (_, i) => r.box.submit(r.item('critical', `c${i}`)));
    expect(results.filter((x) => x === 'sent')).toHaveLength(BUCKET_CAPACITY);
    expect(results.filter((x) => x === 'queued')).toHaveLength(100 - BUCKET_CAPACITY);
    expect(r.wire).toHaveLength(BUCKET_CAPACITY);
    expect(r.box.stats().queuedCritical).toBe(75);
  });

  it('then drains at 30 per second, in order, losing none', () => {
    const r = rig();
    for (let i = 0; i < 100; i++) r.box.submit(r.item('critical', `c${i}`));
    vi.advanceTimersByTime(1000);
    expect(r.wire.length).toBe(BUCKET_CAPACITY + BUCKET_RATE_PER_SEC);
    vi.advanceTimersByTime(4000);
    expect(r.wire).toHaveLength(100);
    expect(labels(r)).toEqual(Array.from({ length: 100 }, (_, i) => `c${i}`));
    expect(r.box.stats().queuedCritical).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays under the relay limits however hard it is pushed: never more than 55 in any one second, 325 in ten (limits 60 and 400)', () => {
    const r = rig();
    for (let t = 0; t < 12_000; t += 5) {
      for (let k = 0; k < 4; k++) r.box.submit(r.item('critical', `x${t}-${k}`)); // 800 per second demanded
      vi.advanceTimersByTime(5);
    }
    const times = r.wire.map((w) => w.at);
    expect(maxInAnyWindow(times, 1000)).toBeLessThanOrEqual(BUCKET_CAPACITY + BUCKET_RATE_PER_SEC);
    expect(maxInAnyWindow(times, 1000)).toBeLessThan(60);
    expect(maxInAnyWindow(times, 10_000)).toBeLessThan(400);
    expect(times.length).toBeGreaterThan(300); // and it really did keep sending at about 30 per second
  });

  it('an idle connection earns its tokens back (full bucket after about a second)', () => {
    const r = rig();
    for (let i = 0; i < BUCKET_CAPACITY; i++) r.box.submit(r.item('critical', `a${i}`));
    expect(r.box.stats().tokens).toBeLessThan(1);
    vi.advanceTimersByTime(1000);
    expect(r.box.stats().tokens).toBe(BUCKET_CAPACITY);
  });

  it('a failed transmit (socket closed) is not counted and costs no token', () => {
    const r = rig();
    r.open.value = false;
    expect(r.box.submit(r.item('critical', 'lost'))).toBe('dropped');
    expect(r.box.stats().tokens).toBe(BUCKET_CAPACITY);
    expect(r.box.stats().sent).toBe(0);
  });

  it('a message that renders to nothing (rejected by the validators) is skipped without a token', () => {
    const r = rig();
    const skipped: OutboxItem = { priority: 'critical', render: () => null };
    expect(r.box.submit(skipped)).toBe('dropped');
    expect(r.box.stats().tokens).toBe(BUCKET_CAPACITY);
  });
});

describe('Outbox: levels are sent now or dropped, never queued', () => {
  it('the last tokens are reserved: only 17 of 25 are available to levels', () => {
    const r = rig();
    const results = Array.from({ length: 30 }, (_, i) => r.box.submit(r.item('level', `l${i}`)));
    expect(results.filter((x) => x === 'sent')).toHaveLength(BUCKET_CAPACITY - LEVEL_TOKEN_RESERVE);
    expect(results.filter((x) => x === 'dropped')).toHaveLength(30 - (BUCKET_CAPACITY - LEVEL_TOKEN_RESERVE));
    expect(r.box.stats().droppedLevels).toBe(13);
    expect(r.box.stats().tokens).toBeGreaterThanOrEqual(LEVEL_TOKEN_RESERVE - 0.001);
  });

  it('a dropped level is gone for good: it is not sent later when tokens return', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.box.submit(r.item('level', `l${i}`));
    const sentNow = r.wire.length;
    vi.advanceTimersByTime(5000);
    expect(r.wire).toHaveLength(sentNow);
    expect(r.renders.filter((x) => x.startsWith('l'))).toHaveLength(sentNow); // never even numbered
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a level never overtakes a waiting critical message; once the queue has drained and the bucket has room, levels flow again', () => {
    const r = rig();
    for (let i = 0; i < 40; i++) r.box.submit(r.item('critical', `c${i}`)); // 25 sent, 15 waiting
    expect(r.box.submit(r.item('level', 'lvl'))).toBe('dropped');
    vi.advanceTimersByTime(1000); // queue drains (about 0.5 s) and the bucket recovers
    expect(labels(r)).not.toContain('lvl');
    expect(r.box.stats().queuedCritical).toBe(0);
    expect(r.box.submit(r.item('level', 'lvl2'))).toBe('sent');
    expect(labels(r).at(-1)).toBe('lvl2');
  });

  it('while a mic.state is waiting a level is dropped', () => {
    const r = rig();
    for (let i = 0; i < 25; i++) r.box.submit(r.item('critical', `c${i}`)); // bucket empty
    r.box.submit(r.item('state', 'mic')); // waits
    vi.advanceTimersByTime(40); // one token back: mic goes
    expect(labels(r).at(-1)).toBe('mic');
    expect(r.box.submit(r.item('level', 'lvl'))).toBe('dropped'); // below the reserve
  });
});

describe('Outbox: mic.state is coalesced', () => {
  it('only the latest of several waiting mic.state messages is ever rendered and sent', () => {
    const r = rig();
    for (let i = 0; i < 25; i++) r.box.submit(r.item('critical', `c${i}`)); // empty the bucket
    for (let i = 1; i <= 5; i++) expect(r.box.submit(r.item('state', `mic${i}`))).toBe('queued');
    expect(r.box.stats().coalescedState).toBe(4);
    vi.advanceTimersByTime(2000);
    expect(labels(r).filter((l) => l.startsWith('mic'))).toEqual(['mic5']);
    expect(r.renders.filter((l) => l.startsWith('mic'))).toEqual(['mic5']); // the replaced ones never consumed a sequence number
  });
});

describe('Outbox: priority order and sequence numbers', () => {
  it('critical before mic.state, in FIFO order, even though the mic.state was submitted first', () => {
    const r = rig();
    for (let i = 0; i < 25; i++) r.box.submit(r.item('critical', `fill${i}`));
    r.box.submit(r.item('state', 'mic'));
    r.box.submit(r.item('critical', 'resultA'));
    r.box.submit(r.item('critical', 'ackB'));
    vi.advanceTimersByTime(3000);
    expect(labels(r).slice(25)).toEqual(['resultA', 'ackB', 'mic']);
  });

  it('sequence numbers always match wire order, even when a later critical message overtakes the waiting mic.state', () => {
    const r = rig();
    for (let i = 0; i < 25; i++) r.box.submit(r.item('critical', `fill${i}`));
    r.box.submit(r.item('state', 'mic'));
    r.box.submit(r.item('critical', 'ack'));
    vi.advanceTimersByTime(3000);
    const seqs = r.wire.map((w) => w.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(seqs.length); // no gaps either: nothing numbered was thrown away
  });
});

describe('Outbox: a stalled socket (bufferedAmount)', () => {
  it('stops levels and holds everything else while more than 4096 bytes are waiting in the socket', () => {
    const r = rig();
    r.buffered.value = BUFFER_HIGH_WATER_BYTES + 1;
    expect(r.box.submit(r.item('level', 'lvl'))).toBe('dropped');
    expect(r.box.submit(r.item('critical', 'ack'))).toBe('queued');
    expect(r.box.submit(r.item('state', 'mic'))).toBe('queued');
    vi.advanceTimersByTime(2000);
    expect(r.wire).toHaveLength(0);
  });

  it('exactly 4096 bytes is not stalled', () => {
    const r = rig();
    r.buffered.value = BUFFER_HIGH_WATER_BYTES;
    expect(r.box.submit(r.item('critical', 'ack'))).toBe('sent');
  });

  it('sends what waited as soon as the socket drains (polled every 100 ms), in priority order, and never a stale level', () => {
    const r = rig();
    r.buffered.value = 50_000;
    for (let i = 0; i < 20; i++) r.box.submit(r.item('level', `lvl${i}`)); // all dropped
    r.box.submit(r.item('state', 'mic'));
    r.box.submit(r.item('critical', 'result'));
    vi.advanceTimersByTime(1000);
    expect(r.wire).toHaveLength(0);
    r.buffered.value = 0;
    vi.advanceTimersByTime(100);
    expect(labels(r)).toEqual(['result', 'mic']);
    vi.advanceTimersByTime(5000);
    expect(labels(r)).toEqual(['result', 'mic']);
  });

  it('a link stalled for a long time does not build a backlog of levels that could burst out later', () => {
    const r = rig();
    r.buffered.value = 1_000_000;
    for (let t = 0; t < 10_000; t += 50) {
      r.box.submit(r.item('level', `lvl${t}`));
      vi.advanceTimersByTime(50);
    }
    r.buffered.value = 0;
    vi.advanceTimersByTime(2000);
    expect(r.wire).toHaveLength(0);
    expect(r.box.stats().droppedLevels).toBe(200);
  });
});

describe('Outbox: backing off after rate_limited', () => {
  it('pauses everything for 1 s; levels are dropped, critical and state wait, and they go out when it is over', () => {
    const r = rig();
    r.box.noteRateLimited();
    expect(r.box.stats().pausedForMs).toBe(RATE_LIMIT_BACKOFF_MS);
    expect(r.box.submit(r.item('level', 'lvl'))).toBe('dropped');
    expect(r.box.submit(r.item('critical', 'ack'))).toBe('queued');
    expect(r.box.submit(r.item('state', 'mic'))).toBe('queued');
    vi.advanceTimersByTime(RATE_LIMIT_BACKOFF_MS - 1);
    expect(r.wire).toHaveLength(0);
    vi.advanceTimersByTime(1 + 100); // the bucket starts empty and refills at 30/s
    expect(labels(r)).toEqual(['ack', 'mic']);
  });

  it('the flurry of errors from one burst is one episode: it neither extends nor multiplies the pause', () => {
    const r = rig();
    r.box.noteRateLimited();
    for (let i = 0; i < 100; i++) r.box.noteRateLimited();
    vi.advanceTimersByTime(500);
    r.box.noteRateLimited();
    expect(r.box.stats().pausedForMs).toBe(RATE_LIMIT_BACKOFF_MS - 500);
  });

  it('repeated episodes wait 1 s, 2 s, 4 s and then stay at 4 s; a quiet spell resets it to 1 s', () => {
    const r = rig();
    const episode = (): number => {
      r.box.noteRateLimited();
      const wait = r.box.stats().pausedForMs;
      vi.advanceTimersByTime(wait);
      return wait;
    };
    expect(episode()).toBe(1000);
    expect(episode()).toBe(2000);
    expect(episode()).toBe(4000);
    expect(episode()).toBe(RATE_LIMIT_BACKOFF_MAX_MS);
    expect(episode()).toBe(RATE_LIMIT_BACKOFF_MAX_MS);
    vi.advanceTimersByTime(11_000);
    expect(episode()).toBe(1000);
  });

  it('after the pause the bucket refills from empty: no burst, not even of what was waiting', () => {
    const r = rig();
    for (let i = 0; i < 60; i++) r.box.submit(r.item('critical', `c${i}`)); // 25 now, 35 waiting
    r.box.noteRateLimited();
    const before = r.wire.length;
    vi.advanceTimersByTime(RATE_LIMIT_BACKOFF_MS);
    expect(r.wire.length - before).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(5000);
    expect(r.wire).toHaveLength(60);
  });
});

describe('Outbox: reset', () => {
  it('returns what was waiting, cancels the timer, restores a full bucket and forgets any backoff', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.box.submit(r.item('critical', `c${i}`, { meta: { n: i } })); // 5 waiting
    r.box.submit(r.item('state', 'mic'));
    r.box.noteRateLimited();
    const waiting = r.box.reset();
    expect(waiting.map((w) => (w.meta as { n: number }).n)).toEqual([25, 26, 27, 28, 29]);
    expect(vi.getTimerCount()).toBe(0);
    const sentBefore = r.wire.length;
    vi.advanceTimersByTime(10_000);
    expect(r.wire).toHaveLength(sentBefore); // nothing leaks out of a reset outbox
    expect(r.box.stats()).toMatchObject({ queuedCritical: 0, pendingState: false, tokens: BUCKET_CAPACITY, pausedForMs: 0 });
    expect(r.box.submit(r.item('critical', 'fresh'))).toBe('sent');
  });
});

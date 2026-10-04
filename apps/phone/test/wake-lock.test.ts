import { describe, expect, it } from 'vitest';
import { WakeLockController, type WakeLockApi } from '../src/wake-lock.js';
import { FakeSentinel, FakeWakeLockApi } from './helpers/fakes.js';

describe('WakeLockController', () => {
  it('unsupported without the API; not_requested before any request', () => {
    expect(new WakeLockController(undefined).state).toBe('unsupported');
    expect(new WakeLockController(new FakeWakeLockApi()).state).toBe('not_requested');
  });

  it('held after a successful request; request while held is a no-op', async () => {
    const api = new FakeWakeLockApi();
    const c = new WakeLockController(api);
    await c.request();
    await c.request();
    expect(c.state).toBe('held');
    expect(api.requests).toBe(1);
  });

  it('concurrent requests share one in-flight request', async () => {
    const api = new FakeWakeLockApi();
    const c = new WakeLockController(api);
    await Promise.all([c.request(), c.request(), c.request()]);
    expect(api.requests).toBe(1);
    expect(api.active).toHaveLength(1);
  });

  it('rejected request is reported; a synchronous throw from the API is handled the same way', async () => {
    const api = new FakeWakeLockApi();
    api.rejectNext = true;
    const c = new WakeLockController(api);
    await c.request();
    expect(c.state).toBe('rejected');
    const throwing: WakeLockApi = {
      request: () => {
        throw new Error('sync');
      },
    };
    const d = new WakeLockController(throwing);
    await d.request();
    expect(d.state).toBe('rejected');
    await d.request(); // can be retried
    expect(d.state).toBe('rejected');
  });

  it('browser release is observed; a new request acquires a fresh sentinel', async () => {
    const api = new FakeWakeLockApi();
    const c = new WakeLockController(api);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s));
    await c.request();
    api.sentinels[0]?.browserRelease();
    expect(c.state).toBe('released');
    await c.request();
    expect(c.state).toBe('held');
    expect(api.sentinels).toHaveLength(2);
    expect(seen).toEqual(['held', 'released', 'held']);
  });

  it('release() releases a held lock and reports released', async () => {
    const api = new FakeWakeLockApi();
    const c = new WakeLockController(api);
    await c.request();
    await c.release();
    expect(c.state).toBe('released');
    expect(api.active).toHaveLength(0);
    await c.release(); // idempotent
    expect(c.state).toBe('released');
  });

  it('release() during an in-flight request discards the sentinel that arrives later', async () => {
    let finish!: (s: FakeSentinel) => void;
    const sentinel = new FakeSentinel();
    const api: WakeLockApi = {
      request: () =>
        new Promise((resolve) => {
          finish = resolve as (s: FakeSentinel) => void;
        }),
    };
    const c = new WakeLockController(api);
    const pending = c.request();
    await c.release();
    finish(sentinel);
    await pending;
    expect(sentinel.released).toBe(true);
    expect(c.state).not.toBe('held');
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryRoomStore } from '../src/core/index.js';
import { describeStoreConformance, makeCode, makeConn, makeJoin, makeRoom } from './helpers/store-conformance.js';

describeStoreConformance('MemoryRoomStore', () => new MemoryRoomStore());

describe('MemoryRoomStore specifics', () => {
  it('bounds the message-id window to the last 1024 ids (package MessageIdDedupe)', async () => {
    const s = new MemoryRoomStore();
    for (let i = 0; i < 1024; i += 1) await s.recordMessageId('r1', 'phone', `m${i}`, 0);
    await s.recordMessageId('r1', 'phone', 'm1024', 0); // evicts m0, the least recently recorded
    expect(await s.recordMessageId('r1', 'phone', 'm1', 0)).toBe('duplicate');
    expect(await s.recordMessageId('r1', 'phone', 'm0', 0)).toBe('new');
    // the other role has its own window (PK-08)
    expect(await s.recordMessageId('r1', 'tv', 'm1', 0)).toBe('new');
  });

  it('keeps pre-authentication ids only as long as the connection (DEF-006), at most 64 per connection', async () => {
    const s = new MemoryRoomStore();
    await s.putConnection(makeConn('c1'), 0);
    expect(await s.recordConnectionMessageId('c1', 'm1', 0)).toBe('new');
    expect(await s.recordConnectionMessageId('c1', 'm1', 0)).toBe('duplicate');
    await s.deleteConnection('c1');
    expect(await s.recordConnectionMessageId('c1', 'm1', 0)).toBe('new'); // nothing outlives the connection
    for (let i = 0; i < 64; i += 1) await s.recordConnectionMessageId('c2', `x${i}`, 0);
    await s.recordConnectionMessageId('c2', 'x64', 0); // evicts the oldest
    expect(await s.recordConnectionMessageId('c2', 'x1', 0)).toBe('duplicate');
    expect(await s.recordConnectionMessageId('c2', 'x0', 0)).toBe('new');
  });

  it('returns copies, so callers cannot mutate stored state', async () => {
    const s = new MemoryRoomStore();
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), 0);
    const room = await s.getRoom('r1');
    if (room) room.tv.generation = 99;
    expect((await s.getRoom('r1'))?.tv.generation).toBe(1);
  });

  it('purges expired records physically after the grace period, leaving live ones', async () => {
    const s = new MemoryRoomStore();
    const T = 1_800_000_000_000;
    await s.createRoom(makeRoom('old', 'h-old', { expiresAt: T + 1000 }), makeCode('h-old', 'old', T + 1000), T);
    await s.createRoom(makeRoom('live', 'h-live', { expiresAt: T + 10 * 3_600_000 }), makeCode('h-live', 'live', T + 10 * 3_600_000), T);
    await s.createJoin(makeJoin('old', 'j1', { expiresAt: T + 1000 }), T);
    await s.incrementCounter('k', 1000, T);
    await s.putConnection(makeConn('c1'), T);
    const n = await s.purgeExpired(T + 2 * 3_600_000 + 5000);
    expect(n).toBeGreaterThan(0);
    expect(await s.getRoom('old')).toBeNull();
    expect(await s.findRoomByCodeHash('h-old')).toBeNull();
    expect(await s.getRoom('live')).not.toBeNull();
    expect(await s.getConnection('c1')).not.toBeNull();
  });
});

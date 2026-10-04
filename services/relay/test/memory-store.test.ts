import { describe, expect, it } from 'vitest';
import { MemoryRoomStore } from '../src/core/index.js';
import { describeStoreConformance, makeCode, makeConn, makeJoin, makeRoom } from './helpers/store-conformance.js';

describeStoreConformance('MemoryRoomStore', () => new MemoryRoomStore());

describe('MemoryRoomStore specifics', () => {
  it('bounds the message-id window to the last 1024 ids', async () => {
    const s = new MemoryRoomStore();
    for (let i = 0; i < 1024; i += 1) await s.recordMessageId('r1', `m${i}`, 0);
    expect(await s.recordMessageId('r1', 'm0', 0)).toBe('duplicate');
    await s.recordMessageId('r1', 'm1024', 0); // evicts m0
    expect(await s.recordMessageId('r1', 'm0', 0)).toBe('new');
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

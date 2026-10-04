import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CodeRecord,
  ConnectionRecord,
  JoinRecord,
  RoomRecord,
  RoomStore,
} from '../../src/core/index.js';

const NOW = 1_800_000_000_000;
const H12 = 12 * 3_600_000;

export function makeRoom(id: string, codeHash: string, over: Partial<RoomRecord> = {}): RoomRecord {
  return {
    roomId: id,
    createdAt: NOW,
    expiresAt: NOW + H12,
    closed: false,
    lastConnChange: NOW,
    codeHash,
    activeSessionId: null,
    tv: { credHash: 'a'.repeat(64), credExpiresAt: NOW + H12, generation: 1, lastSeq: -1, connId: 'tv-conn' },
    phone: null,
    phoneGeneration: 0,
    ...over,
  };
}

export function makeCode(hash: string, roomId: string, expiresAt = NOW + 600_000): CodeRecord {
  return { codeHash: hash, roomId, expiresAt };
}

export function makeConn(id: string, over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    connId: id,
    connectedAt: NOW,
    lastSeen: NOW,
    authenticated: false,
    authDeadline: NOW + 5000,
    unauthCount: 0,
    strikes: 0,
    rateStrikes: 0,
    joinFailures: 0,
    relaySeq: 0,
    originState: 'allowed',
    sourceHash: 'f'.repeat(32),
    roomId: null,
    role: null,
    generation: 0,
    joinId: null,
    joinRoomId: null,
    ...over,
  };
}

export function makeJoin(roomId: string, joinId: string, over: Partial<JoinRecord> = {}): JoinRecord {
  return {
    roomId,
    joinId,
    phoneConnId: 'phone-conn',
    confirmDigits: '42',
    expiresAt: NOW + 60_000,
    state: 'pending',
    ...over,
  };
}

/**
 * Behavioural contract every RoomStore implementation must satisfy. The same suite runs against
 * MemoryRoomStore and against DynamoDbRoomStore (with an in-memory fake of the DynamoDB document client).
 */
export function describeStoreConformance(name: string, factory: () => RoomStore): void {
  describe(`RoomStore conformance: ${name}`, () => {
    let s: RoomStore;
    beforeEach(() => {
      s = factory();
    });

    describe('rooms and codes', () => {
      it('creates and reads back a room with its code', async () => {
        expect(await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW)).toBe('ok');
        expect(await s.getRoom('r1')).toEqual(makeRoom('r1', 'h1'));
        expect(await s.findRoomByCodeHash('h1')).toEqual(makeCode('h1', 'r1'));
        expect(await s.getRoom('missing')).toBeNull();
        expect(await s.findRoomByCodeHash('missing')).toBeNull();
      });

      it('reports collisions on a live code and on an existing room', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.createRoom(makeRoom('r2', 'h1'), makeCode('h1', 'r2'), NOW)).toBe('code_collision');
        expect(await s.getRoom('r2')).toBeNull();
        expect(await s.createRoom(makeRoom('r1', 'h3'), makeCode('h3', 'r1'), NOW)).toBe('room_exists');
      });

      it('lets an expired code hash be reused', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1', NOW + 10), NOW);
        expect(await s.createRoom(makeRoom('r2', 'h1'), makeCode('h1', 'r2'), NOW + 10)).toBe('ok');
        expect((await s.findRoomByCodeHash('h1'))?.roomId).toBe('r2');
      });

      it('returns a logically expired code record unchanged (the core decides)', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1', NOW + 10), NOW);
        expect((await s.findRoomByCodeHash('h1'))?.expiresAt).toBe(NOW + 10);
      });

      it('rotates the code: the old one stops resolving', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.rotateCode('r1', makeCode('h2', 'r1'), NOW)).toBe('ok');
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
        expect((await s.findRoomByCodeHash('h2'))?.roomId).toBe('r1');
        expect((await s.getRoom('r1'))?.codeHash).toBe('h2');
        expect(await s.rotateCode('nope', makeCode('h9', 'nope'), NOW)).toBe('not_found');
        await s.createRoom(makeRoom('r2', 'h5'), makeCode('h5', 'r2'), NOW);
        expect(await s.rotateCode('r1', makeCode('h5', 'r1'), NOW)).toBe('code_collision');
        await s.closeRoom('r2', NOW);
        expect(await s.rotateCode('r2', makeCode('h6', 'r2'), NOW)).toBe('closed');
      });

      it('consumes a code exactly once', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        await s.consumeCode('r1', 'h1');
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
        expect((await s.getRoom('r1'))?.codeHash).toBeNull();
        await s.consumeCode('r1', 'h1'); // idempotent
      });

      it('closes a room and drops its code', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.closeRoom('r1', NOW + 5)).toBe(true);
        const room = await s.getRoom('r1');
        expect(room?.closed).toBe(true);
        expect(room?.lastConnChange).toBe(NOW + 5);
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
        expect(await s.closeRoom('nope', NOW)).toBe(false);
      });

      it('tracks the active session', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        await s.setActiveSession('r1', 's_one');
        expect((await s.getRoom('r1'))?.activeSessionId).toBe('s_one');
        await s.setActiveSession('r1', null);
        expect((await s.getRoom('r1'))?.activeSessionId).toBeNull();
      });
    });

    describe('join requests', () => {
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
      });

      it('allows one pending join at a time', async () => {
        expect(await s.createJoin(makeJoin('r1', 'j1'), NOW)).toBe('ok');
        expect(await s.createJoin(makeJoin('r1', 'j2'), NOW + 1)).toBe('busy');
        expect((await s.getJoin('r1'))?.joinId).toBe('j1');
      });

      it('allows a new join once the previous expired or resolved', async () => {
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
        expect(await s.createJoin(makeJoin('r1', 'j2', { expiresAt: NOW + 200_000 }), NOW + 60_000)).toBe('ok');
        expect(await s.resolveJoin('r1', 'j2', 'rejected', NOW + 60_001)).toBe('ok');
        expect(await s.createJoin(makeJoin('r1', 'j3', { expiresAt: NOW + 200_000 }), NOW + 60_002)).toBe('ok');
      });

      it('resolves a pending join exactly once', async () => {
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
        expect(await s.resolveJoin('r1', 'j1', 'accepted', NOW + 1)).toBe('ok');
        expect(await s.resolveJoin('r1', 'j1', 'accepted', NOW + 2)).toBe('resolved');
        expect(await s.resolveJoin('r1', 'j1', 'rejected', NOW + 2)).toBe('resolved');
        expect((await s.getJoin('r1'))?.state).toBe('accepted');
      });

      it('knows unknown joins and expiry', async () => {
        expect(await s.resolveJoin('r1', 'jx', 'accepted', NOW)).toBe('not_found');
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
        expect(await s.resolveJoin('r1', 'jx', 'accepted', NOW)).toBe('not_found');
        expect(await s.resolveJoin('r1', 'j1', 'accepted', NOW + 60_000)).toBe('expired');
        expect(await s.resolveJoin('r1', 'j1', 'accepted', NOW + 60_001)).toBe('resolved');
      });

      it('lets cancel and expire transitions happen even after the expiry time', async () => {
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
        expect(await s.resolveJoin('r1', 'j1', 'cancelled', NOW + 120_000)).toBe('ok');
        await s.createJoin(makeJoin('r1', 'j2', { expiresAt: NOW + 300_000 }), NOW + 120_001);
        expect(await s.resolveJoin('r1', 'j2', 'expired', NOW + 400_000)).toBe('ok');
      });

      it('only one concurrent resolver wins', async () => {
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
        const results = await Promise.all(
          Array.from({ length: 8 }, () => s.resolveJoin('r1', 'j1', 'accepted', NOW + 1)),
        );
        expect(results.filter((r) => r === 'ok')).toHaveLength(1);
        expect(results.filter((r) => r === 'resolved')).toHaveLength(7);
      });

      it('only one concurrent createJoin wins', async () => {
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => s.createJoin(makeJoin('r1', `j${i}`), NOW)),
        );
        expect(results.filter((r) => r === 'ok')).toHaveLength(1);
        expect(results.filter((r) => r === 'busy')).toHaveLength(7);
      });
    });

    describe('role slots', () => {
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
      });
      const claim = (conn: string, exp = NOW + H12) => ({ credHash: 'b'.repeat(64), credExpiresAt: exp, connId: conn });

      it('claims the phone slot once; conditional on empty', async () => {
        expect(await s.claimPhoneSlot('r1', claim('p1'), NOW)).toEqual({ ok: true, generation: 1 });
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW)).toEqual({ ok: false, reason: 'occupied' });
        const room = await s.getRoom('r1');
        expect(room?.phone).toEqual({
          credHash: 'b'.repeat(64),
          credExpiresAt: NOW + H12,
          generation: 1,
          lastSeq: -1,
          connId: 'p1',
        });
        expect(room?.phoneGeneration).toBe(1);
        expect(await s.claimPhoneSlot('nope', claim('p3'), NOW)).toEqual({ ok: false, reason: 'not_found' });
        await s.createRoom(makeRoom('r2', 'h2'), makeCode('h2', 'r2'), NOW);
        await s.closeRoom('r2', NOW);
        expect(await s.claimPhoneSlot('r2', claim('p4'), NOW)).toEqual({ ok: false, reason: 'closed' });
      });

      it('concurrent claims yield exactly one winner', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => s.claimPhoneSlot('r1', claim(`p${i}`), NOW)));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });

      it('treats a logically expired phone credential as an empty slot', async () => {
        await s.claimPhoneSlot('r1', claim('p1', NOW + 100), NOW);
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW + 99)).toEqual({ ok: false, reason: 'occupied' });
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW + 100)).toEqual({ ok: true, generation: 2 });
      });

      it('revokes the phone slot, returns its connection and never reuses generations', async () => {
        await s.claimPhoneSlot('r1', claim('p1'), NOW);
        expect(await s.revokePhone('r1', NOW + 1)).toEqual({ previousConnId: 'p1' });
        expect((await s.getRoom('r1'))?.phone).toBeNull();
        expect(await s.revokePhone('r1', NOW + 2)).toEqual({ previousConnId: null });
        expect(await s.revokePhone('nope', NOW)).toBeNull();
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW + 3)).toEqual({ ok: true, generation: 2 });
      });

      it('bumps the generation on resume, resets the sequence and reports the previous connection', async () => {
        expect(await s.acceptSequence('r1', 'tv', 1, 5)).toBe('ok');
        expect(await s.bumpGeneration('r1', 'tv', 'tv-conn-2', NOW + 1)).toEqual({
          generation: 2,
          previousConnId: 'tv-conn',
        });
        const room = await s.getRoom('r1');
        expect(room?.tv).toMatchObject({ generation: 2, lastSeq: -1, connId: 'tv-conn-2' });
        expect(await s.bumpGeneration('r1', 'phone', 'x', NOW)).toBeNull(); // no phone slot
        await s.claimPhoneSlot('r1', claim('p1', NOW + 50), NOW);
        expect(await s.bumpGeneration('r1', 'phone', 'p2', NOW + 50)).toBeNull(); // expired credential
        expect(await s.bumpGeneration('r1', 'phone', 'p2', NOW + 49)).toEqual({ generation: 2, previousConnId: 'p1' });
        expect((await s.getRoom('r1'))?.phoneGeneration).toBe(2);
        await s.closeRoom('r1', NOW);
        expect(await s.bumpGeneration('r1', 'tv', 'tv-conn-3', NOW)).toBeNull();
      });

      it('detaches a connection only if it is still the live one', async () => {
        expect(await s.detachConnection('r1', 'tv', 'someone-else', NOW + 7)).toBe(false);
        expect((await s.getRoom('r1'))?.tv.connId).toBe('tv-conn');
        expect(await s.detachConnection('r1', 'tv', 'tv-conn', NOW + 7)).toBe(true);
        const room = await s.getRoom('r1');
        expect(room?.tv.connId).toBeNull();
        expect(room?.lastConnChange).toBe(NOW + 7);
        expect(await s.detachConnection('r1', 'tv', 'tv-conn', NOW + 8)).toBe(false);
        expect(await s.detachConnection('r1', 'phone', 'p', NOW)).toBe(false);
        expect(await s.detachConnection('nope', 'tv', 'x', NOW)).toBe(false);
      });
    });

    describe('connections', () => {
      it('stores, patches, touches and deletes connections', async () => {
        await s.putConnection(makeConn('c1'), NOW);
        expect(await s.getConnection('c1')).toEqual(makeConn('c1'));
        expect(await s.getConnection('c2')).toBeNull();
        expect(
          await s.patchConnection('c1', { authenticated: true, roomId: 'r1', role: 'tv', generation: 3, authDeadline: 0 }),
        ).toBe(true);
        expect(await s.getConnection('c1')).toMatchObject({
          authenticated: true,
          roomId: 'r1',
          role: 'tv',
          generation: 3,
          authDeadline: 0,
        });
        expect(await s.patchConnection('c1', { joinId: 'j1', joinRoomId: 'r1' })).toBe(true);
        expect(await s.patchConnection('c1', { joinId: null, joinRoomId: null })).toBe(true);
        expect(await s.getConnection('c1')).toMatchObject({ joinId: null, joinRoomId: null });
        await s.touchConnection('c1', NOW + 9);
        expect((await s.getConnection('c1'))?.lastSeen).toBe(NOW + 9);
        expect((await s.deleteConnection('c1'))?.connId).toBe('c1');
        expect(await s.deleteConnection('c1')).toBeNull();
        expect(await s.getConnection('c1')).toBeNull();
      });

      it('does not resurrect a deleted connection on patch, touch or counters', async () => {
        expect(await s.patchConnection('gone', { authenticated: true })).toBe(false);
        await s.touchConnection('gone', NOW);
        expect(await s.bumpConnectionCounter('gone', 'strikes')).toBe(0);
        expect(await s.nextRelaySequence('gone')).toBeNull();
        expect(await s.getConnection('gone')).toBeNull();
      });

      it('counts per connection atomically', async () => {
        await s.putConnection(makeConn('c1'), NOW);
        const counts = await Promise.all(Array.from({ length: 6 }, () => s.bumpConnectionCounter('c1', 'unauthCount')));
        expect([...counts].sort()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(await s.bumpConnectionCounter('c1', 'joinFailures')).toBe(1);
        expect(await s.bumpConnectionCounter('c1', 'strikes')).toBe(1);
        expect(await s.bumpConnectionCounter('c1', 'rateStrikes')).toBe(1);
        const seqs = await Promise.all(Array.from({ length: 5 }, () => s.nextRelaySequence('c1')));
        expect([...seqs].sort()).toEqual([1, 2, 3, 4, 5]);
      });

      it('lists live connections', async () => {
        await s.putConnection(makeConn('c1'), NOW);
        await s.putConnection(makeConn('c2'), NOW);
        await s.deleteConnection('c1');
        expect((await s.listConnections()).map((c) => c.connId)).toEqual(['c2']);
      });
    });

    describe('per-message state', () => {
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
      });

      it('accepts strictly increasing sequences for the current generation only', async () => {
        expect(await s.acceptSequence('r1', 'tv', 1, 0)).toBe('ok');
        expect(await s.acceptSequence('r1', 'tv', 1, 0)).toBe('replay');
        expect(await s.acceptSequence('r1', 'tv', 1, 10)).toBe('ok');
        expect(await s.acceptSequence('r1', 'tv', 1, 9)).toBe('replay');
        expect(await s.acceptSequence('r1', 'tv', 0, 99)).toBe('stale');
        expect(await s.acceptSequence('r1', 'tv', 2, 99)).toBe('stale');
        expect(await s.acceptSequence('r1', 'phone', 1, 1)).toBe('stale'); // no phone slot
        expect(await s.acceptSequence('nope', 'tv', 1, 1)).toBe('stale');
        expect(await s.acceptSequence('r1', 'tv', 1, 11)).toBe('ok');
      });

      it('lets exactly one of N concurrent identical sequences through', async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () => s.acceptSequence('r1', 'tv', 1, 7)));
        expect(results.filter((r) => r === 'ok')).toHaveLength(1);
        expect(results.filter((r) => r === 'replay')).toHaveLength(9);
      });

      it('records message ids and detects duplicates per room', async () => {
        expect(await s.recordMessageId('r1', 'm1', NOW)).toBe('new');
        expect(await s.recordMessageId('r1', 'm1', NOW + 1)).toBe('duplicate');
        expect(await s.recordMessageId('r2', 'm1', NOW)).toBe('new');
        const results = await Promise.all(Array.from({ length: 6 }, () => s.recordMessageId('r1', 'm2', NOW)));
        expect(results.filter((r) => r === 'new')).toHaveLength(1);
      });

      it('counts cues per session up to the maximum, atomically', async () => {
        const results = await Promise.all(Array.from({ length: 7 }, () => s.consumeCue('r1', 's1', 3, NOW)));
        expect(results.filter((r) => r === 'ok')).toHaveLength(3);
        expect(results.filter((r) => r === 'limit')).toHaveLength(4);
        expect(await s.consumeCue('r1', 's2', 3, NOW)).toBe('ok');
        expect(await s.consumeCue('r2', 's1', 3, NOW)).toBe('ok');
      });

      it('keeps fixed-window counters per key and window', async () => {
        expect(await s.getCounter('k', 1000, NOW)).toBe(0);
        expect(await s.incrementCounter('k', 1000, NOW)).toBe(1);
        expect(await s.incrementCounter('k', 1000, NOW + 100)).toBe(2);
        expect(await s.getCounter('k', 1000, NOW + 100)).toBe(2);
        expect(await s.incrementCounter('k', 1000, NOW + 1000)).toBe(1); // next window
        expect(await s.getCounter('k', 1000, NOW + 1000)).toBe(1);
        expect(await s.getCounter('k', 1000, NOW + 2000)).toBe(0); // a window with no increments reads as zero
        expect(await s.incrementCounter('other', 1000, NOW)).toBe(1);
        expect(await s.incrementCounter('k', 10_000, NOW)).toBe(1); // different window length, separate counter
        const many = await Promise.all(Array.from({ length: 10 }, () => s.incrementCounter('c', 60_000, NOW)));
        expect([...many].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      });
    });
  });
}

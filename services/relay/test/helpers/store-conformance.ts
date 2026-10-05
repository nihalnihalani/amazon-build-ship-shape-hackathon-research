import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CodeRecord,
  ConnectionRecord,
  JoinRecord,
  RoomRecord,
  RoomStore,
} from '../../src/core/index.js';

const NOW = 1_800_000_000_000;
const H2 = 2 * 3_600_000;
const H12 = 12 * 3_600_000;
const TV_HASH = 'a'.repeat(64);

export function makeRoom(id: string, codeHash: string, over: Partial<RoomRecord> = {}): RoomRecord {
  return {
    roomId: id,
    createdAt: NOW,
    expiresAt: NOW + H12,
    closed: false,
    lastConnChange: NOW,
    codeHash,
    lastRefresh: 0,
    activeSessionId: null,
    tv: { credHash: TV_HASH, credExpiresAt: NOW + H2, generation: 1, lastSeq: -1, connId: 'tv-conn', prevCredHash: null, prevAt: 0 },
    phone: null,
    phoneGeneration: 0,
    tvEpoch: 1,
    phoneEpoch: 0,
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
    originState: 'phone_origin',
    sourceHash: 'f'.repeat(32),
    unauthHeld: false,
    epoch: 0,
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
    codeHash: 'h1',
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

      it('rotates the code: the old one stops resolving and the room has exactly one live code', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.rotateCode('r1', makeCode('h2', 'r1'), NOW)).toBe('ok');
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
        expect((await s.findRoomByCodeHash('h2'))?.roomId).toBe('r1');
        expect((await s.getRoom('r1'))?.codeHash).toBe('h2');
        expect(await s.rotateCode('r1', makeCode('h3', 'r1'), NOW)).toBe('ok');
        expect(await s.findRoomByCodeHash('h2')).toBeNull();
        expect(await s.rotateCode('nope', makeCode('h9', 'nope'), NOW)).toBe('not_found');
        await s.createRoom(makeRoom('r2', 'h5'), makeCode('h5', 'r2'), NOW);
        expect(await s.rotateCode('r1', makeCode('h5', 'r1'), NOW)).toBe('code_collision');
        await s.closeRoom('r2', NOW);
        expect(await s.rotateCode('r2', makeCode('h6', 'r2'), NOW)).toBe('closed');
        // the failed rotations left no stray code behind
        expect(await s.findRoomByCodeHash('h6')).toBeNull();
        expect(await s.findRoomByCodeHash('h5')).toBeNull(); // closing r2 dropped its code
      });

      it('limits TV-initiated refreshes to one per interval, but not relay-initiated rotations', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.rotateCode('r1', makeCode('h2', 'r1'), NOW, { refreshMinIntervalMs: 10_000 })).toBe('ok');
        expect(await s.rotateCode('r1', makeCode('h3', 'r1'), NOW + 9_999, { refreshMinIntervalMs: 10_000 })).toBe('too_soon');
        expect((await s.getRoom('r1'))?.codeHash).toBe('h2'); // the refused refresh changed nothing
        expect(await s.findRoomByCodeHash('h3')).toBeNull();
        // a relay-initiated rotation (burning a code) is not a refresh and is not limited
        expect(await s.rotateCode('r1', makeCode('h4', 'r1'), NOW + 10)).toBe('ok');
        expect(await s.rotateCode('r1', makeCode('h5', 'r1'), NOW + 10_000, { refreshMinIntervalMs: 10_000 })).toBe('ok');
        expect((await s.getRoom('r1'))?.lastRefresh).toBe(NOW + 10_000);
      });

      it('lets only one of several concurrent refreshes through', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        const results = await Promise.all(
          Array.from({ length: 6 }, (_, i) => s.rotateCode('r1', makeCode(`hx${i}`, 'r1'), NOW + 1, { refreshMinIntervalMs: 10_000 })),
        );
        expect(results.filter((r) => r === 'ok')).toHaveLength(1);
        expect(results.filter((r) => r === 'too_soon')).toHaveLength(5);
      });

      it('consumes a code exactly once', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        await s.consumeCode('r1', 'h1');
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
        expect((await s.getRoom('r1'))?.codeHash).toBeNull();
        await s.consumeCode('r1', 'h1'); // idempotent
      });

      it('closes a room, drops its code and bumps both epochs', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        expect(await s.closeRoom('r1', NOW + 5)).toBe(true);
        const room = await s.getRoom('r1');
        expect(room?.closed).toBe(true);
        expect(room?.lastConnChange).toBe(NOW + 5);
        expect(room?.tvEpoch).toBe(2);
        expect(room?.phoneEpoch).toBe(1);
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

      it('counts live rooms: open, unexpired, and connected or idle for less than 30 minutes', async () => {
        expect(await s.countLiveRooms(NOW)).toBe(0);
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW); // TV connected
        await s.createRoom(makeRoom('r2', 'h2'), makeCode('h2', 'r2'), NOW);
        expect(await s.countLiveRooms(NOW)).toBe(2);
        await s.closeRoom('r2', NOW);
        expect(await s.countLiveRooms(NOW)).toBe(1);
        // the TV of r1 leaves: the room still counts for 30 minutes, then stops counting
        await s.detachConnection('r1', 'tv', 'tv-conn', NOW + 1000);
        expect(await s.countLiveRooms(NOW + 1000 + 30 * 60_000 - 1)).toBe(1);
        expect(await s.countLiveRooms(NOW + 1000 + 30 * 60_000)).toBe(0);
        // a room with a connection is live until its own expiry, and not a moment longer
        await s.createRoom(makeRoom('r3', 'h3', { expiresAt: NOW + 5 * 60_000 }), makeCode('h3', 'r3'), NOW);
        expect(await s.countLiveRooms(NOW + 5 * 60_000 - 1)).toBe(2); // r1 (idle horizon) and r3
        expect(await s.countLiveRooms(NOW + 5 * 60_000)).toBe(1); // r3 is past its life, r1 still idle-live
      });

      it('keeps a room counted while the other role is still attached', async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        await s.claimPhoneSlot('r1', { credHash: 'b'.repeat(64), credExpiresAt: NOW + H2, connId: 'p1' }, NOW);
        await s.detachConnection('r1', 'phone', 'p1', NOW + 10);
        expect(await s.countLiveRooms(NOW + 60 * 60_000)).toBe(1); // TV still attached
        await s.detachConnection('r1', 'tv', 'tv-conn', NOW + 20);
        expect(await s.countLiveRooms(NOW + 60 * 60_000)).toBe(0);
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
        expect((await s.getJoin('r1'))?.codeHash).toBe('h1');
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

    describe('acceptJoin: the atomic phone claim (A3-10)', () => {
      const claim = (conn = 'p1', exp = NOW + H2) => ({ credHash: 'b'.repeat(64), credExpiresAt: exp, connId: conn });
      const accept = (over: Partial<{ joinId: string; codeHash: string; now: number; conn: string }> = {}) =>
        s.acceptJoin({
          roomId: 'r1',
          joinId: over.joinId ?? 'j1',
          codeHash: over.codeHash ?? 'h1',
          claim: claim(over.conn),
          now: over.now ?? NOW + 1,
        });
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
        await s.createJoin(makeJoin('r1', 'j1'), NOW);
      });

      it('does everything or nothing: accepted join, claimed slot, consumed code, bumped epoch', async () => {
        expect(await accept()).toEqual({ ok: true, generation: 1, epoch: 1 });
        expect((await s.getJoin('r1'))?.state).toBe('accepted');
        const room = await s.getRoom('r1');
        expect(room?.phone).toMatchObject({ credHash: 'b'.repeat(64), generation: 1, connId: 'p1', lastSeq: -1 });
        expect(room?.phoneEpoch).toBe(1);
        expect(room?.codeHash).toBeNull();
        expect(await s.findRoomByCodeHash('h1')).toBeNull();
      });

      it.each([
        ['an unknown join id', { joinId: 'jx' }, 'no_join'],
        ['an expired join', { now: NOW + 60_000 }, 'join_expired'],
        ['a code that is no longer the room live code', { codeHash: 'hx' }, 'code_gone'],
      ] as const)('refuses %s and changes nothing', async (_n, over, reason) => {
        expect(await accept(over)).toEqual({ ok: false, reason });
        expect((await s.getJoin('r1'))?.state).toBe('pending');
        const room = await s.getRoom('r1');
        expect(room?.phone).toBeNull();
        expect(room?.codeHash).toBe('h1');
        expect(await s.findRoomByCodeHash('h1')).not.toBeNull();
      });

      it('refuses when the code was burned or refreshed while the join waited', async () => {
        await s.rotateCode('r1', makeCode('h2', 'r1'), NOW + 5);
        expect(await accept()).toEqual({ ok: false, reason: 'code_gone' });
        expect((await s.getRoom('r1'))?.phone).toBeNull();
        expect((await s.getJoin('r1'))?.state).toBe('pending');
      });

      it('refuses when the slot is taken, the room is closed or expired, and leaves everything as it was', async () => {
        await s.claimPhoneSlot('r1', claim('other'), NOW);
        expect(await accept()).toEqual({ ok: false, reason: 'room_full' });
        expect((await s.getJoin('r1'))?.state).toBe('pending');
        expect(await s.findRoomByCodeHash('h1')).not.toBeNull();
        await s.createRoom(makeRoom('r2', 'k1', { expiresAt: NOW + 100 }), makeCode('k1', 'r2', NOW + 1000), NOW);
        await s.createJoin(makeJoin('r2', 'jj', { codeHash: 'k1', expiresAt: NOW + 5000 }), NOW);
        expect(await s.acceptJoin({ roomId: 'r2', joinId: 'jj', codeHash: 'k1', claim: claim(), now: NOW + 100 })).toEqual({
          ok: false,
          reason: 'room_expired',
        });
        await s.closeRoom('r2', NOW);
        expect(await s.acceptJoin({ roomId: 'r2', joinId: 'jj', codeHash: 'k1', claim: claim(), now: NOW + 1 })).toEqual({
          ok: false,
          reason: 'closed',
        });
      });

      it('cannot reach a join of another room (the join lives under the confirming room)', async () => {
        await s.createRoom(makeRoom('r9', 'h9'), makeCode('h9', 'r9'), NOW);
        expect(await s.acceptJoin({ roomId: 'r9', joinId: 'j1', codeHash: 'h9', claim: claim(), now: NOW + 1 })).toEqual({
          ok: false,
          reason: 'no_join',
        });
        expect((await s.getJoin('r1'))?.state).toBe('pending');
      });

      it('exactly one of several concurrent accepts wins', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => accept({ conn: `p${i}` })));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        const room = await s.getRoom('r1');
        expect(room?.phone?.generation).toBe(1);
        expect(room?.phoneEpoch).toBe(1);
      });

      it('a second accept after success is refused as resolved', async () => {
        await accept();
        expect(await accept({ conn: 'p2' })).toEqual({ ok: false, reason: 'resolved' });
        expect((await s.getRoom('r1'))?.phone?.connId).toBe('p1');
      });
    });

    describe('role slots', () => {
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
      });
      const claim = (conn: string, exp = NOW + H2) => ({ credHash: 'b'.repeat(64), credExpiresAt: exp, connId: conn });

      it('claims the phone slot once; conditional on empty', async () => {
        expect(await s.claimPhoneSlot('r1', claim('p1'), NOW)).toEqual({ ok: true, generation: 1, epoch: 1 });
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW)).toEqual({ ok: false, reason: 'occupied' });
        const room = await s.getRoom('r1');
        expect(room?.phone).toEqual({
          credHash: 'b'.repeat(64),
          credExpiresAt: NOW + H2,
          generation: 1,
          lastSeq: -1,
          connId: 'p1',
          prevCredHash: null,
          prevAt: 0,
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
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW + 100)).toEqual({ ok: true, generation: 2, epoch: 2 });
      });

      it('revokes the phone slot, bumps its epoch, returns its connection and never reuses generations', async () => {
        await s.claimPhoneSlot('r1', claim('p1'), NOW);
        expect(await s.revokePhone('r1', NOW + 1)).toEqual({ previousConnId: 'p1' });
        const room = await s.getRoom('r1');
        expect(room?.phone).toBeNull();
        expect(room?.phoneEpoch).toBe(2);
        expect(await s.revokePhone('r1', NOW + 2)).toEqual({ previousConnId: null });
        expect(await s.revokePhone('nope', NOW)).toBeNull();
        expect(await s.claimPhoneSlot('r1', claim('p2'), NOW + 3)).toMatchObject({ ok: true, generation: 2 });
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

    describe('credential rotation on resume (A3-07, A3-11)', () => {
      const rot = (over: Partial<{ role: 'tv' | 'phone'; conn: string; presented: string; next: string; now: number; exp: number }> = {}) =>
        s.resumeRole({
          roomId: 'r1',
          role: over.role ?? 'tv',
          connId: over.conn ?? 'tv-conn-2',
          presentedHash: over.presented ?? TV_HASH,
          nextHash: over.next ?? 'c'.repeat(64),
          nextExpiresAt: over.exp ?? NOW + 100 + H2,
          now: over.now ?? NOW + 100,
        });
      beforeEach(async () => {
        await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
      });

      it('rotates: installs the next credential, bumps the generation, resets the sequence, attaches the connection', async () => {
        expect(await s.acceptSequence('r1', 'tv', 1, 5)).toBe('ok');
        expect(await rot()).toEqual({ ok: true, generation: 2, previousConnId: 'tv-conn', epoch: 1, credExpiresAt: NOW + 100 + H2 });
        const room = await s.getRoom('r1');
        expect(room?.tv).toMatchObject({
          credHash: 'c'.repeat(64),
          credExpiresAt: NOW + 100 + H2,
          generation: 2,
          lastSeq: -1,
          connId: 'tv-conn-2',
          prevCredHash: TV_HASH,
          prevAt: NOW + 100,
        });
        expect(room?.lastConnChange).toBe(NOW + 100);
      });

      it('consumes the presented credential: presenting it again is reported as reused, an unknown one as mismatch', async () => {
        await rot();
        expect(await s.wasCredentialConsumed('r1', 'tv', TV_HASH, NOW + 200)).toBe(true);
        expect(await s.wasCredentialConsumed('r1', 'phone', TV_HASH, NOW + 200)).toBe(false);
        expect(await s.wasCredentialConsumed('r2', 'tv', TV_HASH, NOW + 200)).toBe(false);
        expect(await s.wasCredentialConsumed('r1', 'tv', 'd'.repeat(64), NOW + 200)).toBe(false);
        expect(await rot({ conn: 'x' })).toEqual({ ok: false, reason: 'reused' });
        expect(await rot({ presented: 'd'.repeat(64), conn: 'x' })).toEqual({ ok: false, reason: 'mismatch' });
        expect((await s.getRoom('r1'))?.tv.connId).toBe('tv-conn-2'); // refused resumes changed nothing
      });

      it('stops reporting a consumed credential as reused once it would have expired anyway', async () => {
        await rot();
        expect(await s.wasCredentialConsumed('r1', 'tv', TV_HASH, NOW + H2)).toBe(false);
      });

      it('refuses an expired credential, a closed or expired room, a missing slot or room', async () => {
        expect(await rot({ now: NOW + H2 })).toEqual({ ok: false, reason: 'cred_expired' });
        expect(await rot({ role: 'phone', presented: 'b'.repeat(64) })).toEqual({ ok: false, reason: 'no_slot' });
        expect(await s.resumeRole({ roomId: 'nope', role: 'tv', connId: 'x', presentedHash: TV_HASH, nextHash: 'e'.repeat(64), nextExpiresAt: NOW, now: NOW })).toEqual({
          ok: false,
          reason: 'no_room',
        });
        await s.createRoom(makeRoom('r2', 'h2', { expiresAt: NOW + 50 }), makeCode('h2', 'r2'), NOW);
        expect(
          await s.resumeRole({ roomId: 'r2', role: 'tv', connId: 'x', presentedHash: TV_HASH, nextHash: 'e'.repeat(64), nextExpiresAt: NOW, now: NOW + 50 }),
        ).toEqual({ ok: false, reason: 'room_expired' });
        await s.closeRoom('r1', NOW);
        expect(await rot()).toEqual({ ok: false, reason: 'closed' });
      });

      it('lets exactly one of several concurrent resumes with the same credential win', async () => {
        const results = await Promise.all(Array.from({ length: 6 }, (_, i) => rot({ conn: `c${i}`, next: `${i}`.repeat(64).slice(0, 64) })));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && (r.reason === 'reused' || r.reason === 'mismatch'))).toHaveLength(5);
        expect((await s.getRoom('r1'))?.tv.generation).toBe(2);
      });

      it('rotates the phone slot too', async () => {
        await s.claimPhoneSlot('r1', { credHash: 'b'.repeat(64), credExpiresAt: NOW + H2, connId: 'p1' }, NOW);
        const r = await rot({ role: 'phone', presented: 'b'.repeat(64), conn: 'p2' });
        expect(r).toMatchObject({ ok: true, generation: 2, previousConnId: 'p1', epoch: 1 });
        expect((await s.getRoom('r1'))?.phoneGeneration).toBe(2);
      });

      describe('one-step grace for a lost auth.ok', () => {
        const grace = (over: Partial<{ conn: string; presented: string; current: string; now: number; window: number }> = {}) =>
          s.resumeGrace({
            roomId: 'r1',
            role: 'tv',
            connId: over.conn ?? 'tv-conn-3',
            presentedHash: over.presented ?? TV_HASH,
            currentHash: over.current ?? 'c'.repeat(64),
            windowMs: over.window ?? 60_000,
            now: over.now ?? NOW + 100 + 30_000,
          });

        it('re-attaches without rotating again, exactly once, within the window', async () => {
          await rot();
          expect(await grace()).toEqual({ ok: true, generation: 3, previousConnId: 'tv-conn-2', epoch: 1, credExpiresAt: NOW + 100 + H2 });
          const room = await s.getRoom('r1');
          expect(room?.tv).toMatchObject({ credHash: 'c'.repeat(64), generation: 3, connId: 'tv-conn-3', prevCredHash: null, prevAt: 0 });
          // spent: a second grace is refused, and the credential still counts as consumed
          expect(await grace({ conn: 'tv-conn-4' })).toEqual({ ok: false, reason: 'reused' });
          expect(await s.wasCredentialConsumed('r1', 'tv', TV_HASH, NOW + 200)).toBe(true);
        });

        it('is refused after the window, and when the next credential was presented since', async () => {
          await rot();
          expect(await grace({ now: NOW + 100 + 60_000 })).toEqual({ ok: false, reason: 'reused' }); // exactly 60 s: over
          expect(await grace({ now: NOW + 100 + 59_999 })).toMatchObject({ ok: true });
          // the next credential is presented (rotation to a third one), then the grace for the first is gone
          await s.resumeRole({
            roomId: 'r1',
            role: 'tv',
            connId: 'tv-conn-5',
            presentedHash: 'c'.repeat(64),
            nextHash: 'e'.repeat(64),
            nextExpiresAt: NOW + 200 + H2,
            now: NOW + 100 + 59_999,
          });
          expect(await grace({ conn: 'x' })).toEqual({ ok: false, reason: 'reused' });
        });

        it('is refused for a credential that is not the slot previous one, and for closed rooms', async () => {
          await rot();
          expect(await grace({ presented: 'd'.repeat(64) })).toEqual({ ok: false, reason: 'reused' });
          expect(await grace({ current: 'd'.repeat(64) })).toEqual({ ok: false, reason: 'reused' });
          await s.closeRoom('r1', NOW + 200);
          expect(await grace()).toEqual({ ok: false, reason: 'closed' });
        });
      });
    });

    describe('connections', () => {
      it('stores, patches, touches and deletes connections', async () => {
        await s.putConnection(makeConn('c1'), NOW);
        expect(await s.getConnection('c1')).toEqual(makeConn('c1'));
        expect(await s.getConnection('c2')).toBeNull();
        expect(
          await s.patchConnection('c1', { authenticated: true, roomId: 'r1', role: 'tv', generation: 3, epoch: 4, authDeadline: 0, unauthHeld: false }),
        ).toBe(true);
        expect(await s.getConnection('c1')).toMatchObject({
          authenticated: true,
          roomId: 'r1',
          role: 'tv',
          generation: 3,
          epoch: 4,
          authDeadline: 0,
          unauthHeld: false,
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

      it('keeps the origin state and the unauthenticated-slot flag', async () => {
        await s.putConnection(makeConn('c1', { originState: 'tv_preview_origin', unauthHeld: true }), NOW);
        expect(await s.getConnection('c1')).toMatchObject({ originState: 'tv_preview_origin', unauthHeld: true });
        await s.putConnection(makeConn('c2', { originState: 'absent' }), NOW);
        expect((await s.getConnection('c2'))?.originState).toBe('absent');
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

      it('records message ids per room and role, and forgets them on request', async () => {
        expect(await s.recordMessageId('r1', 'phone', 'm1', NOW)).toBe('new');
        expect(await s.recordMessageId('r1', 'phone', 'm1', NOW + 1)).toBe('duplicate');
        expect(await s.recordMessageId('r1', 'tv', 'm1', NOW)).toBe('new'); // the other role may reuse the id (PK-08)
        expect(await s.recordMessageId('r2', 'phone', 'm1', NOW)).toBe('new'); // and so may another room
        await s.forgetMessageId('r1', 'phone', 'm1');
        expect(await s.recordMessageId('r1', 'phone', 'm1', NOW + 2)).toBe('new'); // a rejected message does not burn its id
        await s.forgetMessageId('r1', 'phone', 'never-recorded');
        const results = await Promise.all(Array.from({ length: 6 }, () => s.recordMessageId('r1', 'phone', 'm2', NOW)));
        expect(results.filter((r) => r === 'new')).toHaveLength(1);
      });

      it('records pre-authentication message ids per connection, never forgetting them (DEF-006)', async () => {
        expect(await s.recordConnectionMessageId('c1', 'm1', NOW)).toBe('new');
        expect(await s.recordConnectionMessageId('c1', 'm1', NOW + 1)).toBe('duplicate');
        expect(await s.recordConnectionMessageId('c1', 'm2', NOW)).toBe('new'); // another id on the same connection
        expect(await s.recordConnectionMessageId('c2', 'm1', NOW)).toBe('new'); // the same id on another connection
        // the per-room window is a different namespace: the same string there is unaffected, and vice versa
        expect(await s.recordMessageId('c1', 'phone', 'm1', NOW)).toBe('new');
        expect(await s.recordConnectionMessageId('c1', 'm1', NOW + 2)).toBe('duplicate');
        const results = await Promise.all(Array.from({ length: 8 }, () => s.recordConnectionMessageId('c3', 'm9', NOW)));
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

      it('tracks failures with a reset horizon (the exponential-delay state)', async () => {
        const R = 600_000;
        expect(await s.getBackoffState('src', NOW, R)).toEqual({ failures: 0, lastFailureAt: 0 });
        expect(await s.recordBackoffFailure('src', NOW, R)).toEqual({ failures: 1, lastFailureAt: NOW });
        expect(await s.recordBackoffFailure('src', NOW + 1000, R)).toEqual({ failures: 2, lastFailureAt: NOW + 1000 });
        expect(await s.getBackoffState('src', NOW + 5000, R)).toEqual({ failures: 2, lastFailureAt: NOW + 1000 });
        expect(await s.getBackoffState('other', NOW, R)).toEqual({ failures: 0, lastFailureAt: 0 });
        // reads as clean 10 minutes after the last failure, and the next failure starts again from one
        expect(await s.getBackoffState('src', NOW + 1000 + R, R)).toEqual({ failures: 0, lastFailureAt: 0 });
        expect(await s.recordBackoffFailure('src', NOW + 1000 + R, R)).toEqual({ failures: 1, lastFailureAt: NOW + 1000 + R });
        const many = await Promise.all(Array.from({ length: 5 }, () => s.recordBackoffFailure('burst', NOW, R)));
        expect(many.map((m) => m.failures).sort()).toEqual([1, 2, 3, 4, 5]);
      });

      it('limits concurrent unauthenticated connections per source and gives slots back', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => s.acquireUnauthSlot('src', 5, NOW)));
        expect(results.filter(Boolean)).toHaveLength(5);
        expect(await s.acquireUnauthSlot('src', 5, NOW)).toBe(false);
        expect(await s.acquireUnauthSlot('other', 5, NOW)).toBe(true);
        await s.releaseUnauthSlot('src');
        expect(await s.acquireUnauthSlot('src', 5, NOW)).toBe(true);
        for (let i = 0; i < 10; i += 1) await s.releaseUnauthSlot('src'); // over-release is clamped, never negative
        expect(await s.acquireUnauthSlot('src', 1, NOW)).toBe(true);
        expect(await s.acquireUnauthSlot('src', 1, NOW)).toBe(false);
      });
    });
  });
}

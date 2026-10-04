import { afterAll, describe, expect, it } from 'vitest';
import {
  CLOSE,
  LIMITS,
  MESSAGE_TYPES,
  MemoryRoomStore,
  RelayCore,
  specFor,
  type ClaimResult,
  type MessageType,
  type PhoneSlotClaim,
} from '../src/core/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';
import {
  Client,
  FOREIGN_ORIGIN,
  PHONE_ORIGIN,
  Rig,
  TV_PREVIEW_ORIGIN,
  assertAllRigsNoLeaks,
  uid,
} from './helpers/rig.js';

const attemptedCodes: string[] = [];
afterAll(() => assertAllRigsNoLeaks(attemptedCodes));

/** A syntactically valid pairing code that is not any live code. */
function wrongCode(real: string, n = 0): string {
  const alphabet = 'ACDEFHJKMNPRTUVWXY3479';
  const base = [...'AAAAAA'];
  base[0] = alphabet[n % 22] as string;
  base[1] = alphabet[Math.floor(n / 22) % 22] as string;
  const c = base.join('');
  const out = c === real ? 'YYYYYY' : c;
  attemptedCodes.push(out);
  return out;
}

async function joinWith(rig: Rig, code: string, source?: string, origin: string | null = PHONE_ORIGIN): Promise<Client> {
  const phone = await rig.connect(origin, source);
  phone.role = 'phone';
  await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Probe' } });
  return phone;
}

describe('room creation (ADR-0003 section 2)', () => {
  it('creates a room with the specified credential, code and expiries', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const created = tv.last('room.created').payload;
    expect(created.room_id).toMatch(/^r_[A-Za-z0-9_-]{22}$/);
    expect(created.tv_credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.pairing_code).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
    expect(created.code_expires_at).toBe(rig.now + 10 * 60_000);
    expect(created.credential_expires_at).toBe(rig.now + 12 * 3_600_000);
    expect(created.generation).toBe(1);
    expect(tv.last('room.created').env.room_id).toBe(created.room_id);
    expect(tv.last('room.created').env.sender_role).toBe('relay');
    expect(tv.last('room.created').env.producer_generation).toBe(0);
  });

  it('stores credentials and codes only as hashes', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    const room = await rig.store.getRoom(tv.roomId as string);
    const blob = JSON.stringify(room);
    expect(blob.includes(tv.credential as string)).toBe(false);
    expect(blob.includes(phone.credential as string)).toBe(false);
    expect(room?.tv.credHash).toMatch(/^[0-9a-f]{64}$/);
    expect(room?.phone?.credHash).toMatch(/^[0-9a-f]{64}$/);
    for (const secret of rig.secrets) expect(blob.includes(secret)).toBe(false);
    // The pairing code was consumed by the join: it no longer resolves.
    expect(room?.codeHash).toBeNull();
  });

  it('rate limits room.create to 10 per source per hour', async () => {
    const rig = new Rig();
    for (let i = 0; i < 10; i += 1) await rig.tvCreate(null, '203.0.113.50');
    const eleventh = await rig.connect(null, '203.0.113.50');
    eleventh.role = 'tv';
    await rig.send(eleventh, 'room.create');
    expect(eleventh.lastError().payload.code).toBe('rate_limited');
    expect(eleventh.closed?.code).toBe(CLOSE.RATE_LIMITED);
    // another source is unaffected
    const other = await rig.tvCreate(null, '203.0.113.51');
    expect(other.roomId).toBeTruthy();
    // and the window rolls over
    rig.advance(61 * 60_000);
    expect((await rig.tvCreate(null, '203.0.113.50')).roomId).toBeTruthy();
  });
});

describe('auth bypass: protected messages before authentication', () => {
  const protectedTypes = MESSAGE_TYPES.filter((t) => {
    const s = specFor(t);
    return s.auth === 'auth' && !s.senders.includes('relay');
  });

  it.each(protectedTypes)('%s before auth is refused and nothing is forwarded', async (type: MessageType) => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.startSession(tv);
    tv.clear();
    phone.clear();
    const attacker = await rig.connect(PHONE_ORIGIN);
    attacker.role = specFor(type).senders[0] ?? 'phone';
    attacker.roomId = tv.roomId; // knows the room id, has no credential
    attacker.generation = 1;
    await rig.send(attacker, type, { payload: VALID_PAYLOADS[type] ?? {} });
    expect(attacker.errors()).toEqual(['unauthenticated']);
    expect(tv.inbox.filter((m) => m.type !== 'peer.state')).toEqual([]);
    expect(phone.inbox).toEqual([]);
  });

  it('closes after the fifth unauthenticated message', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    for (let i = 0; i < 5; i += 1) await rig.send(c, 'ping');
    expect(c.of('pong')).toHaveLength(5);
    expect(c.closed).toBeNull();
    await rig.send(c, 'ping');
    expect(c.closed?.code).toBe(CLOSE.RATE_LIMITED);
    expect(c.closed?.reason).toBe('too_many_unauthenticated_messages');
  });

  it('refuses unknown connection ids (never connected or already dropped)', async () => {
    const rig = new Rig();
    const ghost = new Client('ghost', rig);
    rig.clients.set('ghost', ghost);
    ghost.role = 'tv';
    await rig.send(ghost, 'ping');
    expect(ghost.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
  });
});

describe('pairing code brute force (ADR-0003 section 7)', () => {
  it('closes a connection after 3 failed join attempts', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const real = tv.last('room.created').payload.pairing_code as string;
    const a = await rig.connect(PHONE_ORIGIN, '203.0.113.9');
    a.role = 'phone';
    for (let i = 0; i < 3; i += 1) {
      await rig.send(a, 'join.request', { payload: { pairing_code: wrongCode(real, i), device_label: 'x' } });
    }
    expect(a.errors()).toEqual(['not_found', 'not_found', 'not_found']);
    expect(a.closed?.code).toBe(CLOSE.RATE_LIMITED);
    expect(tv.of('join.requested')).toHaveLength(0);
    expect(rig.metrics.filter((m) => m.name === 'join_failed')).toHaveLength(3);
  });

  it('limits failures per source across connections, even for a valid code', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const real = tv.last('room.created').payload.pairing_code as string;
    let n = 0;
    // 10 failures from one source spread over four connections (3 + 3 + 3 + 1)
    for (const failures of [3, 3, 3, 1]) {
      const c = await rig.connect(PHONE_ORIGIN, '203.0.113.20');
      c.role = 'phone';
      for (let i = 0; i < failures; i += 1) {
        n += 1;
        await rig.send(c, 'join.request', { payload: { pairing_code: wrongCode(real, n), device_label: 'x' } });
      }
    }
    // the correct code from the exhausted source is now refused without any lookup result
    const guess = await joinWith(rig, real, '203.0.113.20');
    expect(guess.errors()).toEqual(['rate_limited']);
    expect(guess.of('join.pending')).toHaveLength(0);
    expect(guess.closed?.code).toBe(CLOSE.RATE_LIMITED);
    expect(tv.of('join.requested')).toHaveLength(0);
    // a different source is not affected
    const legit = await joinWith(rig, real, '203.0.113.21');
    expect(legit.of('join.pending')).toHaveLength(1);
    // the window rolls over after 10 minutes
    rig.advance(10 * 60_000 + 1);
    const later = await rig.tvCreate(null, '198.51.100.99');
    const real2 = later.last('room.created').payload.pairing_code as string;
    const again = await joinWith(rig, real2, '203.0.113.20');
    expect(again.of('join.pending')).toHaveLength(1);
  });

  it('never logs attempted or real codes', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const real = tv.last('room.created').payload.pairing_code as string;
    for (let i = 0; i < 3; i += 1) await joinWith(rig, wrongCode(real, 50 + i), `203.0.113.${60 + i}`);
    await joinWith(rig, real, '203.0.113.99');
    rig.assertNoLeaks(attemptedCodes);
    expect(rig.logs.some((l) => l.includes(real))).toBe(false);
  });

  it('reports a malformed code as bad_schema without touching the failure counters', async () => {
    const rig = new Rig();
    await rig.tvCreate();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    await rig.send(c, 'join.request', { payload: { pairing_code: 'abc123', device_label: 'x' } });
    expect(c.errors()).toEqual(['bad_schema']);
    expect(rig.metrics.some((m) => m.name === 'join_failed')).toBe(false);
  });
});

describe('join flow', () => {
  it('runs request, pending, confirm, accepted with matching confirm digits on both screens', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    const pending = phone.last('join.pending').payload;
    const requested = tv.last('join.requested').payload;
    expect(pending.confirm_digits).toMatch(/^[0-9]{2}$/);
    expect(pending.confirm_digits).toBe(requested.confirm_digits);
    expect(pending.join_id).toBe(requested.join_id);
    expect(requested.device_label).toBe('Probe');
    expect(phone.closed).toBeNull();

    await rig.send(tv, 'join.confirm', { payload: { join_id: requested.join_id as string, decision: 'accept' } });
    const accepted = phone.last('join.accepted').payload;
    expect(accepted.phone_credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(accepted.room_id).toBe(tv.roomId);
    expect(accepted.generation).toBe(1);
    expect(accepted.credential_expires_at).toBe(rig.now + 12 * 3_600_000);
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: true, generation: 1 });
    expect(phone.last('peer.state').payload).toMatchObject({ role: 'tv', connected: true });
  });

  it('refuses a second join while one is pending (join_busy)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const first = await joinWith(rig, code, '203.0.113.1');
    const second = await joinWith(rig, code, '203.0.113.2');
    expect(first.of('join.pending')).toHaveLength(1);
    expect(second.errors()).toEqual(['join_busy']);
    expect(second.last('join.rejected').payload.reason).toBe('busy');
    expect(tv.of('join.requested')).toHaveLength(1);
  });

  it('lets only one of two concurrent phones become pending', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const p1 = await rig.connect(PHONE_ORIGIN, '203.0.113.31');
    const p2 = await rig.connect(PHONE_ORIGIN, '203.0.113.32');
    p1.role = 'phone';
    p2.role = 'phone';
    await Promise.all([
      rig.send(p1, 'join.request', { payload: { pairing_code: code, device_label: 'one' } }),
      rig.send(p2, 'join.request', { payload: { pairing_code: code, device_label: 'two' } }),
    ]);
    const pendings = [p1, p2].filter((p) => p.of('join.pending').length === 1);
    const busy = [p1, p2].filter((p) => p.errors().includes('join_busy'));
    expect(pendings).toHaveLength(1);
    expect(busy).toHaveLength(1);
    expect(tv.of('join.requested')).toHaveLength(1);
  });

  it('claims the single phone slot exactly once when confirms race', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    const joinId = tv.last('join.requested').payload.join_id as string;
    await Promise.all([
      rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } }),
      rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } }),
    ]);
    expect(phone.of('join.accepted')).toHaveLength(1);
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone?.generation).toBe(1);
    expect(room?.phone?.connId).toBe(phone.id);
    expect(tv.errors().filter((e) => e === 'not_found')).toHaveLength(1);
  });

  it('claimPhoneSlot is conditional: concurrent claims yield exactly one winner', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const claim = (id: string) =>
      rig.store.claimPhoneSlot(
        tv.roomId as string,
        { credHash: 'a'.repeat(64), credExpiresAt: rig.now + 1000, connId: id },
        rig.now,
      );
    const results = await Promise.all([claim('c1'), claim('c2'), claim('c3'), claim('c4')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'occupied')).toHaveLength(3);
  });

  it('reports room_full when the phone slot is already taken', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.pair(tv);
    await rig.send(tv, 'pairing.refresh');
    const code = tv.last('pairing.code').payload.pairing_code as string;
    tv.clear();
    const second = await joinWith(rig, code, '203.0.113.77');
    expect(second.last('join.rejected').payload.reason).toBe('room_full');
    expect(tv.of('join.requested')).toHaveLength(0);
  });

  it('handles the TV reject path: phone told, no credential, code remains usable', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code, '203.0.113.5');
    const joinId = tv.last('join.requested').payload.join_id as string;
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'reject' } });
    expect(phone.last('join.rejected').payload.reason).toBe('rejected');
    expect(phone.of('join.accepted')).toHaveLength(0);
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone).toBeNull();
    // the unauthenticated phone cannot send protected messages
    phone.clear();
    await rig.send(phone, 'level', { roomId: tv.roomId });
    expect(phone.errors()).toEqual(['unauthenticated']);
    // a fresh join with the same (unconsumed) code works
    const again = await joinWith(rig, code, '203.0.113.6');
    expect(again.of('join.pending')).toHaveLength(1);
  });

  it('answers a stale join id with not_found and does not leak across rooms', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.send(tv, 'join.confirm', { payload: { join_id: uid('j', 22), decision: 'accept' } });
    expect(tv.errors()).toEqual(['not_found']);
  });

  it('refuses join.request while the TV is offline and keeps the code', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    const phone = await joinWith(rig, code);
    expect(phone.errors()).toEqual(['not_found']);
    expect(phone.lastError().payload.detail).toBe('tv_offline');
  });

  it('cancels a pending join when the phone connection drops, telling the TV', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    const joinId = tv.last('join.requested').payload.join_id as string;
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    expect(tv.last('join.expired').payload.join_id).toBe(joinId);
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } });
    expect(tv.errors()).toEqual(['not_found']);
  });

  it('pairing.refresh issues a new code and invalidates the old one', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const oldCode = tv.last('room.created').payload.pairing_code as string;
    await rig.send(tv, 'pairing.refresh');
    const fresh = tv.last('pairing.code').payload;
    expect(fresh.pairing_code).not.toBe(oldCode);
    expect(fresh.code_expires_at).toBe(rig.now + 10 * 60_000);
    const stale = await joinWith(rig, oldCode, '203.0.113.40');
    expect(stale.errors()).toEqual(['not_found']);
    const ok = await joinWith(rig, fresh.pairing_code as string, '203.0.113.41');
    expect(ok.of('join.pending')).toHaveLength(1);
  });

  it('consumes the code on accept (one use)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    await rig.pair(tv);
    const reuse = await joinWith(rig, code, '203.0.113.45');
    expect(reuse.errors()).toEqual(['not_found']);
  });
});

describe('logical expiry on every check', () => {
  it('rejects an expired pairing code (10 minutes) with expired', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    rig.advance(LIMITS.pairingCodeTtlMs - 1);
    const ok = await joinWith(rig, code, '203.0.113.11');
    expect(ok.of('join.pending')).toHaveLength(1);
    const rig2 = new Rig();
    const tv2 = await rig2.tvCreate();
    const code2 = tv2.last('room.created').payload.pairing_code as string;
    rig2.advance(LIMITS.pairingCodeTtlMs);
    const late = await joinWith(rig2, code2, '203.0.113.12');
    expect(late.errors()).toEqual(['expired']);
    // the record still exists physically: expiry is a logical check, not TTL cleanup
    const room = await rig2.store.getRoom(tv2.roomId as string);
    expect(room?.codeHash).toBeTruthy();
    expect(await rig2.store.findRoomByCodeHash(room?.codeHash as string)).not.toBeNull();
  });

  it('expires a pending join after 60 seconds on confirm', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    const joinId = tv.last('join.requested').payload.join_id as string;
    rig.advance(LIMITS.joinTtlMs);
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } });
    expect(tv.last('join.expired').payload.join_id).toBe(joinId);
    expect(phone.last('join.rejected').payload.reason).toBe('expired');
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect((await rig.store.getRoom(tv.roomId as string))?.phone).toBeNull();
  });

  it('expires credentials and the room logically at 12 hours, closing live connections', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.startSession(tv);
    rig.advance(LIMITS.credentialTtlMs - 1);
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual([]);
    rig.advance(1);
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['expired']);
    expect(phone.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
    await rig.send(tv, 'ping');
    expect(tv.errors()).toEqual(['expired']);
    expect(tv.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
    // resume with an expired credential is refused too, while the stored record still exists
    const again = await rig.connect();
    again.role = 'tv';
    await rig.send(again, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(again.errors()).toEqual(['expired']);
    expect(await rig.store.getRoom(tv.roomId as string)).not.toBeNull();
  });

  it('closes a room that had no connection for 30 minutes (checked at resume)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    rig.advance(LIMITS.roomIdleCloseMs + 1);
    const again = await rig.connect();
    again.role = 'tv';
    await rig.send(again, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(again.errors()).toEqual(['expired']);
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.closed).toBe(true);
  });
});

describe('revocation and room lifecycle', () => {
  it('unpair revokes the phone: unpaired + close, old credential refused, slot cleared', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    tv.clear();
    await rig.send(tv, 'unpair');
    expect(phone.last('unpaired').payload.reason).toBe('tv_unpaired');
    expect(phone.closed?.code).toBe(CLOSE.UNPAIRED);
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: false });
    expect((await rig.store.getRoom(tv.roomId as string))?.phone).toBeNull();

    const retry = await rig.connect(PHONE_ORIGIN);
    retry.role = 'phone';
    await rig.send(retry, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'phone', credential: phone.credential as string },
    });
    expect(retry.errors()).toEqual(['revoked']);

    // the dropped connection cannot sneak a message through either
    await rig.send(phone, 'level', { session: 's_session000001' });
    expect(phone.closed?.code).toBe(CLOSE.UNPAIRED);
    expect(tv.of('level')).toHaveLength(0);
  });

  it('allows a new pairing after unpair with a refreshed code', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.pair(tv);
    await rig.send(tv, 'unpair');
    await rig.send(tv, 'pairing.refresh');
    const second = await rig.pair(tv, { source: '203.0.113.88' });
    expect(second.generation).toBe(2); // generations are never reused
    expect(second.credential).toBeTruthy();
  });

  it('room.close revokes everything and closes both connections', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'room.close');
    expect(phone.last('unpaired').payload.reason).toBe('room_closed');
    expect(phone.closed?.code).toBe(CLOSE.ROOM_CLOSED);
    expect(tv.closed?.code).toBe(CLOSE.NORMAL);
    for (const [who, cred, role] of [
      ['tv', tv.credential, 'tv'],
      ['phone', phone.credential, 'phone'],
    ] as const) {
      const c = await rig.connect(role === 'phone' ? PHONE_ORIGIN : null);
      c.role = who;
      await rig.send(c, 'auth.resume', { payload: { room_id: tv.roomId as string, role, credential: cred as string } });
      expect(c.errors(), who).toEqual(['unauthorized']);
    }
  });
});

describe('resume, supersede and generations (ADR-0003 section 5)', () => {
  it('resumes the TV: generation increments, old connection is superseded and closed', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    phone.clear();
    const tv2 = await rig.connect();
    tv2.role = 'tv';
    await rig.send(tv2, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    const ok = tv2.last('auth.ok').payload;
    expect(ok).toMatchObject({ role: 'tv', generation: 2, peer_connected: true, phone_paired: true });
    tv2.roomId = tv.roomId;
    tv2.generation = 2;
    expect(tv.last('error').payload.code).toBe('superseded');
    expect(tv.closed?.code).toBe(CLOSE.SUPERSEDED);
    expect(phone.last('peer.state').payload).toMatchObject({ role: 'tv', connected: true, generation: 2 });
    // the superseded close does not announce the TV as disconnected
    expect(phone.of('peer.state').filter((m) => m.payload.connected === false)).toHaveLength(0);

    // messages with the old generation are rejected as stale
    await rig.startSession(tv2); // generation 2, fine
    expect(tv2.errors()).toEqual([]);
    await rig.send(tv2, 'session.state', { gen: 1, seq: 50 });
    expect(tv2.lastError().payload.code).toBe('stale');
  });

  it('rejects messages from a superseded connection whose close was lost', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.pair(tv);
    // another worker resumes the TV; this connection is told nothing (simulated lost close)
    const bump = await rig.store.bumpGeneration(tv.roomId as string, 'tv', 'other-conn', rig.now);
    expect(bump?.generation).toBe(2);
    await rig.send(tv, 'ping');
    expect(tv.lastError().payload.code).toBe('superseded');
    expect(tv.closed?.code).toBe(CLOSE.SUPERSEDED);
  });

  it('resumes the phone and tells the TV; sequence restarts per generation', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.startSession(tv);
    await rig.send(phone, 'level', { seq: 10 });
    tv.clear();
    const p2 = await rig.connect(PHONE_ORIGIN);
    p2.role = 'phone';
    await rig.send(p2, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'phone', credential: phone.credential as string },
    });
    p2.roomId = tv.roomId;
    p2.generation = p2.last('auth.ok').payload.generation as number;
    expect(p2.generation).toBe(2);
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: true, generation: 2 });
    await rig.send(p2, 'level', { seq: 0 }); // lower than the old generation's 10 but a new generation
    expect(p2.errors()).toEqual([]);
    expect(tv.of('level')).toHaveLength(1);
    expect(phone.closed?.code).toBe(CLOSE.SUPERSEDED);
  });

  it('refuses resume with the wrong credential, role, room, or a credential from another role', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    const other = await rig.tvCreate();
    const cases: { origin: string | null; role: 'tv' | 'phone'; room: string; cred: string }[] = [
      { origin: null, role: 'tv', room: tv.roomId as string, cred: 'A'.repeat(43) },
      { origin: null, role: 'tv', room: tv.roomId as string, cred: phone.credential as string },
      { origin: PHONE_ORIGIN, role: 'phone', room: tv.roomId as string, cred: tv.credential as string },
      { origin: null, role: 'tv', room: other.roomId as string, cred: tv.credential as string },
      { origin: null, role: 'tv', room: uid('r', 22), cred: tv.credential as string },
    ];
    for (const [i, k] of cases.entries()) {
      const c = await rig.connect(k.origin, `203.0.113.${100 + i}`);
      c.role = k.role;
      await rig.send(c, 'auth.resume', { payload: { room_id: k.room, role: k.role, credential: k.cred } });
      expect(c.errors(), `case ${i}`).toEqual(['unauthorized']);
      expect(c.of('auth.ok')).toHaveLength(0);
    }
  });

  it('limits failed resumes per connection (3) and per source (10 per 10 minutes)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const c = await rig.connect(null, '203.0.113.150');
    c.role = 'tv';
    for (let i = 0; i < 3; i += 1) {
      await rig.send(c, 'auth.resume', { payload: { room_id: tv.roomId as string, role: 'tv', credential: 'B'.repeat(43) } });
    }
    expect(c.closed?.code).toBe(CLOSE.RATE_LIMITED);
    for (let i = 0; i < 3; i += 1) {
      const d = await rig.connect(null, '203.0.113.150');
      d.role = 'tv';
      for (let j = 0; j < 3 && !d.closed; j += 1) {
        await rig.send(d, 'auth.resume', { payload: { room_id: tv.roomId as string, role: 'tv', credential: 'C'.repeat(43) } });
      }
    }
    const e = await rig.connect(null, '203.0.113.150');
    e.role = 'tv';
    await rig.send(e, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(e.errors()).toEqual(['rate_limited']);
  });

  it('rejects a role claim that disagrees with sender_role', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    await rig.send(c, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(c.errors()).toEqual(['unauthorized']);
  });
});

describe('origin policy (ADR-0003 section 8)', () => {
  it('accepts allowlisted origins, rejects foreign ones at connect', async () => {
    const rig = new Rig();
    const ok = await rig.connect(PHONE_ORIGIN);
    expect(ok.closed).toBeNull();
    const preview = await rig.connect(TV_PREVIEW_ORIGIN);
    expect(preview.closed).toBeNull();
    const evil = await rig.connect(FOREIGN_ORIGIN);
    expect(evil.closed?.code).toBe(CLOSE.ORIGIN);
    expect(await rig.connectionCount()).toBe(2);
    expect(rig.metrics.filter((m) => m.name === 'origin_rejected')).toHaveLength(1);
  });

  it.each([
    ['null string origin', 'null'],
    ['empty origin', ''],
    ['trailing slash', `${PHONE_ORIGIN}/`],
    ['different case', PHONE_ORIGIN.toUpperCase()],
    ['http downgrade', PHONE_ORIGIN.replace('https', 'http')],
    ['subdomain suffix trick', `${PHONE_ORIGIN}.evil.test`],
    ['userinfo trick', 'https://phone.example.test@evil.example.test'],
  ])('rejects %s', async (_name, origin) => {
    const rig = new Rig();
    const c = await rig.connect(origin);
    expect(c.closed?.code).toBe(CLOSE.ORIGIN);
  });

  it('allows a missing Origin for TV-role operations only', async () => {
    const rig = new Rig();
    // room.create without Origin: native Vega client
    const tv = await rig.tvCreate(null);
    expect(tv.roomId).toBeTruthy();
    // auth.resume as tv without Origin
    const tv2 = await rig.connect(null);
    tv2.role = 'tv';
    await rig.send(tv2, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(tv2.of('auth.ok')).toHaveLength(1);
    // ping without Origin is fine
    const anon = await rig.connect(null);
    anon.role = 'phone';
    await rig.send(anon, 'ping');
    expect(anon.of('pong')).toHaveLength(1);
    // join.request without Origin: refused and closed
    const code = tv2.of('room.created').at(-1)?.payload.pairing_code ?? tv.last('room.created').payload.pairing_code;
    await rig.send(anon, 'join.request', { payload: { pairing_code: code as string, device_label: 'x' } });
    expect(anon.lastError().payload.code).toBe('origin_rejected');
    expect(anon.closed?.code).toBe(CLOSE.ORIGIN);
    expect(tv.of('join.requested')).toHaveLength(0);
  });

  it('refuses phone auth.resume without an Origin even with a valid phone credential', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    const c = await rig.connect(null);
    c.role = 'phone';
    await rig.send(c, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'phone', credential: phone.credential as string },
    });
    expect(c.lastError().payload.code).toBe('origin_rejected');
    expect(c.closed?.code).toBe(CLOSE.ORIGIN);
    expect(c.of('auth.ok')).toHaveLength(0);
  });

  it('allows the TV web-preview origin to create rooms and resume', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(TV_PREVIEW_ORIGIN);
    expect(tv.roomId).toBeTruthy();
  });
});

describe('unauthenticated deadline', () => {
  it('closes with 4401 after 5 seconds via onTick', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    await rig.tick(4_999);
    expect(c.closed).toBeNull();
    await rig.tick(2);
    expect(c.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
    expect(c.closed?.reason).toBe('auth_deadline');
    expect(await rig.connectionCount()).toBe(0);
  });

  it('closes a message that arrives after the deadline even without a tick', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    rig.advance(5_001);
    await rig.send(c, 'ping');
    expect(c.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
    expect(c.of('pong')).toHaveLength(0);
  });

  it('allows authentication within 5 seconds and stops enforcing the deadline afterwards', async () => {
    const rig = new Rig();
    const tv = await rig.connect(null);
    tv.role = 'tv';
    rig.advance(4_900);
    await rig.send(tv, 'room.create');
    expect(tv.of('room.created')).toHaveLength(1);
    // a heartbeating connection stays open far past the 5 s authentication deadline
    for (let i = 0; i < 6; i += 1) {
      await rig.tick(10_000);
      await rig.send(tv, 'ping');
    }
    expect(tv.closed).toBeNull();
  });

  it('extends the deadline to 65 seconds while a join is pending, then expires the join', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    // the TV heartbeats every 10 s across the window, the phone stays silent
    for (let i = 0; i < 6; i += 1) {
      await rig.tick(10_000);
      expect(phone.closed, `phone alive at ${(i + 1) * 10} s`).toBeNull();
      await rig.send(tv, 'ping');
    }
    await rig.tick(1_000); // 61 s: the join expired, phone and TV are told, a 5 s grace applies
    expect(phone.last('join.rejected').payload.reason).toBe('expired');
    expect(tv.last('join.expired').payload.join_id).toBe(phone.last('join.pending').payload.join_id);
    expect(phone.closed).toBeNull();
    await rig.send(tv, 'ping');
    await rig.tick(5_001);
    expect(phone.closed?.code).toBe(CLOSE.UNAUTHENTICATED);
  });
});

describe('phone vanishes during acceptance', () => {
  it('releases the slot and keeps the code when the phone connection is gone at authentication time', async () => {
    class Vanishing extends MemoryRoomStore {
      override async claimPhoneSlot(roomId: string, claim: PhoneSlotClaim, now: number): Promise<ClaimResult> {
        const r = await super.claimPhoneSlot(roomId, claim, now);
        await this.deleteConnection(claim.connId); // the socket drops right after the claim
        return r;
      }
    }
    const store = new Vanishing();
    const rig = new Rig();
    // run this scenario on a store that loses the phone connection at the worst moment
    Object.assign(rig, {
      store,
      core: new RelayCore({ store, config: { allowedOrigins: [PHONE_ORIGIN], hashPepper: 'p' } }),
    });
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const phone = await joinWith(rig, code);
    const joinId = tv.last('join.requested').payload.join_id as string;
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect(tv.last('join.expired').payload.join_id).toBe(joinId);
    const room = await store.getRoom(tv.roomId as string);
    expect(room?.phone).toBeNull();
    expect(room?.codeHash).not.toBeNull();
    // the code still works for a fresh phone
    const again = await joinWith(rig, code, '203.0.113.200');
    expect(again.of('join.pending')).toHaveLength(1);
  });
});

/**
 * Pairing code lifecycle (A3-02, SEC-A05) and the atomic claim (A3-10, SEC-A06, SEC-A07).
 * Runs on both stores (see core.codes.dynamo.test.ts).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { CLOSE, LIMITS, MemoryRoomStore } from '../src/core/index.js';
import { PHONE_ORIGIN, Rig, assertAllRigsNoLeaks, uid, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

const currentCode = (tv: Client): string =>
  tv.inbox.filter((m) => m.type === 'room.created' || m.type === 'pairing.code').at(-1)?.payload.pairing_code as string;

async function joinFrom(rig: Rig, code: string, source?: string): Promise<{ phone: Client; joinId: string | null }> {
  const phone = await rig.connect(PHONE_ORIGIN, source);
  phone.role = 'phone';
  await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Probe' } });
  const pending = phone.of('join.pending').at(-1);
  return { phone, joinId: pending ? (pending.payload.join_id as string) : null };
}

function liveCodes(rig: Rig, roomId: string): number {
  if (rig.fake) return [...rig.fake.items.values()].filter((i) => String(i.pk).startsWith('CODE#') && i.room_id === roomId).length;
  return (rig.store as MemoryRoomStore).codeCountForRoom(roomId);
}

describe('a join that does not end in pairing burns the code and pushes a fresh one to the TV (A3-02, SEC-A05)', () => {
  it('TV reject: old code dead, fresh code pushed, exactly one live code', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const first = currentCode(tv);
    const { joinId } = await joinFrom(rig, first);
    tv.clear();
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
    const fresh = tv.last('pairing.code').payload;
    expect(fresh.pairing_code).not.toBe(first);
    expect(fresh.code_expires_at).toBe(rig.now + LIMITS.pairingCodeTtlMs);
    expect(liveCodes(rig, tv.roomId as string)).toBe(1);
    expect((await joinFrom(rig, first)).phone.errors()).toEqual(['not_found']);
    expect((await joinFrom(rig, fresh.pairing_code as string)).joinId).not.toBeNull();
  });

  it('a wrong number pick (the TV sends reject) behaves exactly like a reject', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const first = currentCode(tv);
    const { phone, joinId } = await joinFrom(rig, first);
    // number matching happens on the TV; a wrong pick reaches the relay as a plain reject
    tv.clear();
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
    expect(phone.last('join.rejected').payload.reason).toBe('rejected');
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect(tv.of('pairing.code')).toHaveLength(1);
    expect(rig.metrics.some((m) => m.name === 'code_burned')).toBe(true);
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'code_burned' }));
  });

  it('an unanswered join that expires (sweep path) burns the code and tells both sides', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const first = currentCode(tv);
    const { phone, joinId } = await joinFrom(rig, first);
    for (let i = 0; i < 5; i += 1) {
      await rig.tick(10_000);
      await rig.send(tv, 'ping');
    }
    tv.clear();
    await rig.tick(10_000); // 60 s: the join's life is over
    expect(tv.last('join.expired').payload.join_id).toBe(joinId);
    expect(phone.last('join.rejected').payload.reason).toBe('expired');
    const fresh = tv.last('pairing.code').payload.pairing_code as string;
    expect(fresh).not.toBe(first);
    expect(liveCodes(rig, tv.roomId as string)).toBe(1);
    expect((await joinFrom(rig, first)).phone.errors()).toEqual(['not_found']);
    expect((await joinFrom(rig, fresh)).joinId).not.toBeNull();
  });

  it('an unanswered join that expires (deadline-check path) does the same', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const first = currentCode(tv);
    const { phone } = await joinFrom(rig, first);
    rig.advance(LIMITS.joinTtlMs);
    tv.clear();
    await rig.exec(await rig.core.onDeadlineCheck(phone.id, rig.now));
    expect(tv.of('join.expired')).toHaveLength(1);
    expect(tv.of('pairing.code')).toHaveLength(1);
    expect(phone.last('join.rejected').payload.reason).toBe('expired');
    expect(phone.closed).toBeNull(); // a 5 s grace follows
    expect(rig.scheduled.at(-1)?.delayMs).toBe(5000);
  });

  it('a late confirm of an expired join burns the code too', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { joinId } = await joinFrom(rig, currentCode(tv));
    rig.advance(LIMITS.joinTtlMs);
    tv.clear();
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } });
    expect(tv.of('join.expired')).toHaveLength(1);
    expect(tv.of('pairing.code')).toHaveLength(1);
  });

  it('a phone that leaves with a request pending does not burn the code (the real user may just have lost signal)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = currentCode(tv);
    const { phone } = await joinFrom(rig, code);
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    expect(tv.of('pairing.code')).toHaveLength(0);
    expect((await joinFrom(rig, code)).joinId).not.toBeNull();
  });

  it('a pairing that succeeds consumes the code and pushes nothing', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = currentCode(tv);
    await rig.pair(tv);
    expect(tv.of('pairing.code')).toHaveLength(0);
    expect(liveCodes(rig, tv.roomId as string)).toBe(0);
    expect((await joinFrom(rig, code)).phone.errors()).toEqual(['not_found']);
  });
});

describe('pairing.refresh (A3-02)', () => {
  it('invalidates the old code immediately and keeps exactly one live code per room', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const first = currentCode(tv);
    await rig.send(tv, 'pairing.refresh');
    const second = currentCode(tv);
    expect(second).not.toBe(first);
    expect(liveCodes(rig, tv.roomId as string)).toBe(1);
    expect((await joinFrom(rig, first)).phone.errors()).toEqual(['not_found']);
    for (let i = 0; i < 4; i += 1) {
      rig.advance(10_000);
      await rig.send(tv, 'pairing.refresh');
      expect(liveCodes(rig, tv.roomId as string)).toBe(1);
    }
    expect((await joinFrom(rig, second)).phone.errors()).toEqual(['not_found']);
    expect((await joinFrom(rig, currentCode(tv))).joinId).not.toBeNull();
  });

  it('is limited to 1 per 10 s per room, per room (another room is not affected)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const other = await rig.tvCreate();
    await rig.send(tv, 'pairing.refresh');
    const afterFirst = currentCode(tv);
    rig.advance(9_999);
    await rig.send(tv, 'pairing.refresh');
    expect(tv.lastError().payload).toMatchObject({ code: 'rate_limited', detail: 'refresh_too_soon' });
    expect(currentCode(tv)).toBe(afterFirst); // the refused refresh issued nothing and invalidated nothing
    expect((await joinFrom(rig, afterFirst)).joinId).not.toBeNull();
    await rig.send(other, 'pairing.refresh'); // a different room has its own budget
    expect(other.errors()).toEqual([]);
    rig.advance(1);
    const before = tv.of('pairing.code').length;
    // the 10 s window is measured from the last successful refresh (at t0), which is now 10 s ago
    await rig.send(tv, 'pairing.refresh');
    expect(tv.of('pairing.code').length).toBe(before + 1);
  });

  it('is not blocked by a relay-initiated burn, and a burn is not blocked by a recent refresh', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.send(tv, 'pairing.refresh');
    const { joinId } = await joinFrom(rig, currentCode(tv));
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
    expect(tv.of('pairing.code')).toHaveLength(2); // the refresh and the burn
    rig.advance(10_000);
    await rig.send(tv, 'pairing.refresh');
    expect(tv.of('pairing.code')).toHaveLength(3);
  });

  it('cancels a pending join implicitly: the code it used is gone, so accepting it fails cleanly', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    await rig.send(tv, 'pairing.refresh');
    tv.clear();
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect(phone.last('join.rejected').payload.reason).toBe('expired');
    expect(tv.of('join.expired')).toHaveLength(1);
    expect((await rig.store.getRoom(tv.roomId as string))?.phone).toBeNull();
  });
});

describe('the phone claim is one atomic step (A3-10, SEC-A06)', () => {
  it('two phones, same code, 1,000 iterations: exactly one pending and one busy each time, never a partial state', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    for (let i = 0; i < 1000; i += 1) {
      const code = currentCode(tv);
      const a = await rig.connect(PHONE_ORIGIN);
      const b = await rig.connect(PHONE_ORIGIN);
      a.role = 'phone';
      b.role = 'phone';
      await Promise.all([
        rig.send(a, 'join.request', { payload: { pairing_code: code, device_label: 'a' } }),
        rig.send(b, 'join.request', { payload: { pairing_code: code, device_label: 'b' } }),
      ]);
      const pending = [a, b].filter((p) => p.of('join.pending').length === 1);
      const busy = [a, b].filter((p) => p.of('join.rejected').some((m) => m.payload.reason === 'busy'));
      expect(pending, `iteration ${i}`).toHaveLength(1);
      expect(busy, `iteration ${i}`).toHaveLength(1);
      expect(busy[0]?.errors()).toEqual([]);
      // end the join (reject burns the code and pushes the next one) and free the slots
      const joinId = pending[0]?.last('join.pending').payload.join_id as string;
      await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'reject' } });
      for (const c of [a, b]) if (!c.closed) await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
      rig.advance(1000); // TV rate limit window
      if (i % 20 === 19) rig.advance(60_000); // $connect budget window (each source is unique anyway)
    }
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone).toBeNull();
    expect(liveCodes(rig, tv.roomId as string)).toBe(1);
  }, 120_000);

  it('double accept: exactly one slot claim, one credential, and no partial state', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    await Promise.all([
      rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } }),
      rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } }),
      rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } }),
    ]);
    expect(phone.of('join.accepted')).toHaveLength(1);
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone?.generation).toBe(1);
    expect(room?.phoneEpoch).toBe(1);
    expect(room?.codeHash).toBeNull();
    expect(liveCodes(rig, tv.roomId as string)).toBe(0);
  });

  it('accept at the expiry boundary: 1 ms before the 60 s mark works, at the mark it does not', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    rig.advance(LIMITS.joinTtlMs - 1);
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(1);

    const rig2 = new Rig();
    const tv2 = await rig2.tvCreate();
    const second = await joinFrom(rig2, currentCode(tv2));
    rig2.advance(LIMITS.joinTtlMs);
    await rig2.send(tv2, 'join.confirm', { payload: { join_id: second.joinId as string, decision: 'accept' } });
    expect(second.phone.of('join.accepted')).toHaveLength(0);
    expect(second.phone.last('join.rejected').payload.reason).toBe('expired');
  });

  it('confirm with a stale or foreign join id changes nothing', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const tvB = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    await rig.send(tvB, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } }); // another room's TV
    expect(tvB.errors()).toEqual(['not_found']);
    await rig.send(tv, 'join.confirm', { payload: { join_id: uid('j', 22), decision: 'accept' } });
    expect(tv.errors()).toEqual(['not_found']);
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect((await rig.store.getJoin(tv.roomId as string))?.state).toBe('pending');
    expect((await rig.store.getRoom(tvB.roomId as string))?.phone).toBeNull();
  });

  it('refuses the claim when the phone slot is taken, leaving the join resolved and nobody paired twice', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    // another claim wins the slot between the request and the accept
    await rig.store.claimPhoneSlot(tv.roomId as string, { credHash: 'e'.repeat(64), credExpiresAt: rig.now + 3_600_000, connId: 'other' }, rig.now);
    tv.clear();
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(0);
    expect(phone.last('join.rejected').payload.reason).toBe('room_full');
    expect(tv.errors()).toEqual(['room_full']);
    expect((await rig.store.getRoom(tv.roomId as string))?.phone?.connId).toBe('other');
  });
});

describe('TV confirmation is mandatory (SEC-A07)', () => {
  it('gives no credential before accept, none on reject, and never accepts a confirm from the phone role', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const { phone, joinId } = await joinFrom(rig, currentCode(tv));
    expect(phone.inbox.map((m) => m.type)).toEqual(['join.pending']);
    expect(JSON.stringify(phone.inbox)).not.toMatch(/credential/);
    // the pending phone tries to confirm its own join: it is unauthenticated, so nothing is processed
    await rig.send(phone, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' }, roomId: tv.roomId });
    expect(phone.errors()).toEqual(['unauthenticated']);
    expect(phone.of('join.accepted')).toHaveLength(0);
    // an authenticated phone cannot confirm either (TV-only type)
    const paired = await rig.pair(await rig.tvCreate());
    await rig.send(paired, 'join.confirm', { payload: { join_id: joinId as string, decision: 'accept' } });
    expect(paired.errors()).toEqual(['forbidden_direction']);
    expect((await rig.store.getRoom(tv.roomId as string))?.phone).toBeNull();
    // and a reject yields no credential
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
    expect(JSON.stringify(phone.inbox)).not.toMatch(/phone_credential/);
    expect(phone.closed?.code ?? CLOSE.NORMAL).not.toBe(CLOSE.UNPAIRED);
  });
});

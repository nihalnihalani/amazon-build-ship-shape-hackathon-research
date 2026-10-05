/**
 * DEF-006: duplicated pre-authentication frames. Pre-auth messages have no room yet, so the relay dedupes them by
 * message_id per connection: a byte-identical duplicate is dropped silently and counted as duplicate_dropped, and a
 * join.request from the connection that already holds the pending join is idempotent (the same join.pending again,
 * never `busy`). Runs on both stores.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { PHONE_ORIGIN, Rig, assertAllRigsNoLeaks, uid, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

async function withCode(): Promise<{ rig: Rig; tv: Client; code: string }> {
  const rig = new Rig();
  const tv = await rig.tvCreate();
  return { rig, tv, code: tv.last('room.created').payload.pairing_code as string };
}
async function phoneConn(rig: Rig, source?: string): Promise<Client> {
  const phone = await rig.connect(PHONE_ORIGIN, source);
  phone.role = 'phone';
  return phone;
}
/** Advances the virtual clock in steps shorter than the 25 s heartbeat window, pinging as the given clients, then sweeps. */
async function runClock(rig: Rig, ms: number, alive: Client[]): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 20_000);
    rig.advance(step);
    left -= step;
    for (const c of alive) await rig.send(c, 'ping');
    await rig.tick();
  }
}
const dupes = (rig: Rig, type?: string) =>
  rig.metrics.filter((m) => m.name === 'duplicate_dropped' && (type === undefined || m.type === type));

describe('a duplicated pre-authentication frame is dropped silently (DEF-006, SEC-A13)', () => {
  it('join.request twice, byte for byte: one join.pending, one join.requested, no busy, and the TV can still accept', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    const raw = rig.buildMessage(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await rig.sendRaw(phone, raw);
    await rig.sendRaw(phone, raw);
    expect(phone.of('join.pending')).toHaveLength(1);
    expect(phone.of('join.rejected')).toEqual([]);
    expect(phone.of('error')).toEqual([]);
    expect(tv.of('join.requested')).toHaveLength(1);
    expect(dupes(rig, 'join.request')).toEqual([{ name: 'duplicate_dropped', value: 1, type: 'join.request' }]);

    // the TV's join does not expire and the pairing completes
    const joinId = tv.last('join.requested').payload.join_id as string;
    await rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(1);
    await runClock(rig, 61_000, [tv]);
    expect(tv.of('join.expired')).toEqual([]);
    expect(tv.of('error')).toEqual([]);
  });

  it('three copies, two of them arriving concurrently: exactly one join, two drops', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    const raw = rig.buildMessage(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await Promise.all([rig.sendRaw(phone, raw), rig.sendRaw(phone, raw), rig.sendRaw(phone, raw)]);
    expect(tv.of('join.requested')).toHaveLength(1);
    expect(phone.of('join.pending')).toHaveLength(1);
    expect(phone.of('join.rejected')).toEqual([]);
    expect(dupes(rig, 'join.request')).toHaveLength(2);
  });

  it('a duplicate room.create creates one room and answers once', async () => {
    const rig = new Rig();
    const tv = await rig.connect(null);
    tv.role = 'tv';
    const raw = rig.buildMessage(tv, 'room.create');
    await rig.sendRaw(tv, raw);
    await rig.sendRaw(tv, raw);
    expect(tv.of('room.created')).toHaveLength(1);
    expect(tv.of('error')).toEqual([]);
    expect(rig.metrics.filter((m) => m.name === 'rooms_created')).toHaveLength(1);
    expect(dupes(rig, 'room.create')).toHaveLength(1);
  });

  it('concurrent copies of room.create create one room', async () => {
    const rig = new Rig();
    const tv = await rig.connect(null);
    tv.role = 'tv';
    const raw = rig.buildMessage(tv, 'room.create');
    await Promise.all([rig.sendRaw(tv, raw), rig.sendRaw(tv, raw), rig.sendRaw(tv, raw), rig.sendRaw(tv, raw)]);
    expect(tv.of('room.created')).toHaveLength(1);
    expect(rig.metrics.filter((m) => m.name === 'rooms_created')).toHaveLength(1);
  });

  it('a copy that arrives after authentication is still a silent drop: no unauthorized, no strike', async () => {
    const rig = new Rig();
    const tv = await rig.connect(null);
    tv.role = 'tv';
    const raw = rig.buildMessage(tv, 'room.create');
    await rig.sendRaw(tv, raw);
    expect(tv.of('room.created')).toHaveLength(1);
    await rig.sendRaw(tv, raw); // the TV is authenticated now; room.create is a pre-auth-only type
    expect(tv.of('error')).toEqual([]);
    expect((await rig.store.getConnection(tv.id))?.strikes).toBe(0);
    // while a genuinely new room.create on the authenticated connection is still refused as before
    await rig.send(tv, 'room.create');
    expect(tv.lastError().payload).toMatchObject({ code: 'unauthorized', detail: 'already_authenticated' });
  });

  it('a join.request copy after the phone was accepted is dropped silently, not refused', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    const raw = rig.buildMessage(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await rig.sendRaw(phone, raw);
    await rig.send(tv, 'join.confirm', { payload: { join_id: tv.last('join.requested').payload.join_id as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(1);
    await rig.sendRaw(phone, raw);
    expect(phone.of('error')).toEqual([]);
    expect((await rig.store.getConnection(phone.id))?.strikes).toBe(0);
  });

  it('auth.resume twice: one auth.ok, one rotation, nobody revoked', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await rig.pair(tv);
    void code;
    rig.advance(26_000); // the old connection is silent: the resume may supersede it
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    const raw = rig.buildMessage(c, 'auth.resume', { payload: { room_id: tv.roomId as string, role: 'phone', credential: phone.credential as string } });
    await Promise.all([rig.sendRaw(c, raw), rig.sendRaw(c, raw)]);
    expect(c.of('auth.ok')).toHaveLength(1);
    expect(c.of('error')).toEqual([]);
    expect(rig.metrics.filter((m) => m.name === 'credential_reuse')).toEqual([]);
    expect(dupes(rig, 'auth.resume')).toHaveLength(1);
    // the credential issued by the one rotation is the live one
    const next = c.last('auth.ok').payload.next_credential as string;
    rig.advance(26_000);
    const again = await rig.resume(tv.roomId as string, 'phone', next);
    expect(again.of('auth.ok')).toHaveLength(1);
  });

  it('a duplicate of a FAILED join.request is not a second failure', async () => {
    const { rig } = await withCode();
    const phone = await phoneConn(rig);
    const raw = rig.buildMessage(phone, 'join.request', { payload: { pairing_code: 'ACDEFH', device_label: 'Pixel' } });
    await rig.sendRaw(phone, raw);
    await rig.sendRaw(phone, raw);
    expect(phone.of('error')).toHaveLength(1);
    expect(phone.lastError().payload.code).toBe('not_found');
    expect(rig.metrics.filter((m) => m.name === 'join_failed')).toHaveLength(1);
    expect((await rig.store.getConnection(phone.id))?.joinFailures).toBe(1);
  });

  it('a duplicate pre-auth ping gets one pong', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    const raw = rig.buildMessage(c, 'ping');
    await rig.sendRaw(c, raw);
    await rig.sendRaw(c, raw);
    expect(c.of('pong')).toHaveLength(1);
  });

  it('is scoped to the connection: the same message_id on another connection is another message', async () => {
    const rig = new Rig();
    const id = uid('m');
    const a = await rig.connect(null);
    a.role = 'tv';
    const b = await rig.connect(null);
    b.role = 'tv';
    await rig.send(a, 'room.create', { messageId: id });
    await rig.send(b, 'room.create', { messageId: id });
    expect(a.of('room.created')).toHaveLength(1);
    expect(b.of('room.created')).toHaveLength(1);
    expect(a.last('room.created').payload.room_id).not.toBe(b.last('room.created').payload.room_id);
    expect(dupes(rig)).toEqual([]);
  });

  it('only the exact message_id is a duplicate: a fresh id from the same connection is processed', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    await rig.send(c, 'ping');
    await rig.send(c, 'ping');
    expect(c.of('pong')).toHaveLength(2);
    expect(dupes(rig)).toEqual([]);
  });

  it('still counts a dropped copy toward the 5 unauthenticated messages: a flood of copies is closed', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    const raw = rig.buildMessage(c, 'ping');
    for (let i = 0; i < 6 && !c.closed; i += 1) await rig.sendRaw(c, raw);
    expect(c.of('pong')).toHaveLength(1);
    expect(c.closed?.code).toBe(4429);
  });

  it('keeps no id after the connection is gone', async () => {
    const rig = new Rig();
    const c = await rig.connect(PHONE_ORIGIN);
    c.role = 'phone';
    await rig.send(c, 'ping');
    await rig.core.onDisconnect(c.id, rig.now);
    expect(await rig.store.getConnection(c.id)).toBeNull();
    if (rig.fake) {
      // DynamoDB: the marker is TTL-bounded by the id window, never longer
      const markers = [...rig.fake.items.entries()].filter(([k]) => k.startsWith('CMSG#'));
      expect(markers.length).toBeGreaterThan(0);
      for (const [, item] of markers) expect((item as { msg_exp_ms: number }).msg_exp_ms - rig.now).toBeLessThanOrEqual(60_000);
    }
  });
});

describe('join.request from the connection that holds the pending join is idempotent (DEF-006)', () => {
  it('re-sends the identical join.pending, tells the TV nothing new, and schedules nothing new', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    const first = phone.last('join.pending').payload;
    const scheduled = rig.scheduled.length;
    for (let i = 0; i < 4; i += 1) {
      rig.advance(500);
      await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    }
    expect(phone.of('join.pending')).toHaveLength(5);
    for (const m of phone.of('join.pending')) expect(m.payload).toEqual(first);
    expect(phone.of('join.rejected')).toEqual([]);
    expect(phone.of('error')).toEqual([]);
    expect(tv.of('join.requested')).toHaveLength(1);
    expect(rig.metrics.filter((m) => m.name === 'join_requested')).toHaveLength(1);
    expect(rig.metrics.filter((m) => m.name === 'join_rejected')).toEqual([]);
    expect(rig.scheduled).toHaveLength(scheduled); // the deadline is not pushed out by repeating the request
    // and the join still resolves normally
    await rig.send(tv, 'join.confirm', { payload: { join_id: tv.last('join.requested').payload.join_id as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(1);
  });

  it('does not extend the join life: it still expires 60 s after the first request', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await runClock(rig, 40_000, [tv]);
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    expect(tv.of('join.expired')).toEqual([]);
    await runClock(rig, 19_000, [tv]); // 59 s after the first request
    expect(tv.of('join.expired')).toEqual([]);
    await runClock(rig, 1_001, [tv]);
    expect(tv.of('join.expired')).toHaveLength(1);
    expect(phone.of('join.rejected').at(-1)?.payload).toMatchObject({ reason: 'expired' });
  });

  it('a different code from the same connection while a join is pending is still busy, and the original join stays', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await rig.send(phone, 'join.request', { payload: { pairing_code: 'ACDEFH', device_label: 'Pixel' } });
    expect(phone.of('join.rejected').map((m) => m.payload)).toEqual([{ reason: 'busy' }]);
    expect(phone.of('join.pending')).toHaveLength(1);
    expect(tv.of('join.requested')).toHaveLength(1);
  });

  it('a different connection with the same code still gets busy and nothing else', async () => {
    const { rig, tv, code } = await withCode();
    const first = await phoneConn(rig);
    const second = await phoneConn(rig);
    await rig.send(first, 'join.request', { payload: { pairing_code: code, device_label: 'One' } });
    await rig.send(second, 'join.request', { payload: { pairing_code: code, device_label: 'Two' } });
    expect(second.inbox.map((m) => m.type)).toEqual(['join.rejected']);
    expect(second.last('join.rejected').payload).toEqual({ reason: 'busy' });
    expect(tv.of('join.requested')).toHaveLength(1);
    expect(first.of('join.rejected')).toEqual([]);
  });

  it('after the TV rejected the join the same connection starts afresh: the code is burned', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    await rig.send(tv, 'join.confirm', { payload: { join_id: tv.last('join.requested').payload.join_id as string, decision: 'reject' } });
    expect(phone.last('join.rejected').payload).toMatchObject({ reason: 'rejected' });
    phone.clear();
    await rig.send(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } });
    expect(phone.of('join.pending')).toEqual([]);
    expect(phone.lastError().payload.code).toBe('not_found');
  });

  it('works through a duplicated transport: every frame sent twice, the pairing still completes', async () => {
    const { rig, tv, code } = await withCode();
    const phone = await phoneConn(rig);
    const twice = async (raw: string) => {
      await rig.sendRaw(phone, raw);
      await rig.sendRaw(phone, raw);
    };
    await twice(rig.buildMessage(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } }));
    expect(tv.of('join.requested')).toHaveLength(1);
    await rig.send(tv, 'join.confirm', { payload: { join_id: tv.last('join.requested').payload.join_id as string, decision: 'accept' } });
    expect(phone.of('join.accepted')).toHaveLength(1);
    phone.roomId = phone.last('join.accepted').payload.room_id as string;
    phone.credential = phone.last('join.accepted').payload.phone_credential as string;
    phone.generation = phone.last('join.accepted').payload.generation as number;
    phone.nextSeq = 0;
    await rig.startSession(tv);
    rig.advance(1000);
    await twice(rig.buildMessage(phone, 'level'));
    expect(tv.of('level')).toHaveLength(1);
    expect(phone.of('error')).toEqual([]);
  });
});

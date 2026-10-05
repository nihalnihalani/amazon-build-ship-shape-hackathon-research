/**
 * Abuse limits and privacy of the counters: A2-03, A3-02 (per-source budget), A3-03, SEC-A03.
 * Runs on both stores (see core.abuse.dynamo.test.ts).
 */
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  BACKOFF_FREE_FAILURES,
  BACKOFF_RESET_MS,
  CLOSE,
  HashKeys,
  MemoryRoomStore,
  backoffDelayMs,
  normalizeSourceAddress,
} from '../src/core/index.js';
import { PHONE_ORIGIN, Rig, assertAllRigsNoLeaks, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
let wrongCounter = 0;
/** A well-formed code that is not live (it differs from `real` in at least one position). */
function wrong(real: string): string {
  wrongCounter += 1;
  const a = CODE_ALPHABET[wrongCounter % 22] as string;
  const b = CODE_ALPHABET[Math.floor(wrongCounter / 22) % 22] as string;
  const out = `${a}${b}AAAA`;
  return out === real ? 'YYYYYY' : out;
}

/** One join attempt from `source` on its own connection, which is closed again afterwards (frees its slot). */
async function attempt(rig: Rig, source: string, code: string): Promise<Client> {
  const c = await rig.connect(PHONE_ORIGIN, source);
  c.role = 'phone';
  await rig.send(c, 'join.request', { payload: { pairing_code: code, device_label: 'Probe' } });
  if (!c.closed) await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
  return c;
}

function abuseKeys(rig: Rig): string[] {
  if (rig.fake) {
    return [...rig.fake.items.values()].map((i) => String(i.pk)).filter((pk) => /^(CTR|BO|UC)#/.test(pk));
  }
  return (rig.store as MemoryRoomStore).counterKeys();
}

describe('abuse counters are keyed by a keyed hash of the source address (A2-03)', () => {
  it('holds no raw address, no plain hash of one, only the HMAC under the daily key', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.5');
    const real = tv.last('room.created').payload.pairing_code as string;
    await attempt(rig, '203.0.113.5', wrong(real));
    await attempt(rig, '2001:db8:aa:bb::7', wrong(real));
    const keys = abuseKeys(rig);
    expect(keys.length).toBeGreaterThan(4);
    const forbidden = [
      '203.0.113.5',
      '2001:db8',
      createHash('sha256').update('203.0.113.5').digest('hex'),
      createHash('sha256').update(normalizeSourceAddress('2001:db8:aa:bb::7')).digest('hex'),
    ];
    for (const key of keys) for (const f of forbidden) expect(key.includes(f), `${key} contains ${f}`).toBe(false);
    // per-source keys end in or contain a 32-hex digest
    const sourceKeys = keys.filter((k) => /(cx|rc|jf|vj|af):|^UC#|^BO#/.test(k));
    expect(sourceKeys.length).toBeGreaterThan(0);
    for (const k of sourceKeys) expect(k).toMatch(/[0-9a-f]{32}/);
  });

  it('keeps the same source on the same key within a day and changes the key at the UTC day boundary', async () => {
    const rig = new Rig();
    const day = 86_400_000;
    const boundary = rig.now - (rig.now % day) + day;
    rig.now = boundary - 1000;
    const tv = await rig.tvCreate(null, '198.51.100.20');
    const real = tv.last('room.created').payload.pairing_code as string;
    // three free failures and a fourth: the source is now delayed by 2 s
    for (let i = 0; i < 4; i += 1) {
      await attempt(rig, '198.51.100.21', wrong(real));
      rig.advance(10);
    }
    const delayed = await attempt(rig, '198.51.100.21', wrong(real));
    expect(delayed.lastError().payload.detail).toBe('retry_later');
    // 100 ms after midnight UTC (still inside the 2 s delay) the same address maps to a different key: the delay
    // state is not found, which is also what makes yesterday's keys unlinkable to today's
    rig.now = boundary + 100;
    const after = await attempt(rig, '198.51.100.21', wrong(real));
    expect(after.lastError().payload.detail).toBe('unknown_code');
  });

  it('treats IPv4 as /32 and IPv6 as /64: a host rotating inside its /64 shares one failure budget (SEC-A03)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.30');
    const real = tv.last('room.created').payload.pairing_code as string;
    // four failures, each from a different address of the same /64: the fourth already counts against the shared state
    for (let i = 0; i < 4; i += 1) await attempt(rig, `2001:db8:1:2:${i}:${i}:${i}:${i}`, wrong(real));
    const sameBlock = await attempt(rig, '2001:db8:1:2:ffff:eeee:dddd:cccc', wrong(real));
    expect(sameBlock.lastError().payload.detail).toBe('retry_later');
    // a different /64 and a different IPv4 address are independent
    const otherBlock = await attempt(rig, '2001:db8:1:3::1', wrong(real));
    expect(otherBlock.lastError().payload.detail).toBe('unknown_code');
    const v4 = await attempt(rig, '203.0.113.31', wrong(real));
    expect(v4.lastError().payload.detail).toBe('unknown_code');
    // IPv4-mapped IPv6 is the same source as the IPv4 address
    for (let i = 0; i < 3; i += 1) await attempt(rig, '203.0.113.40', wrong(real));
    await attempt(rig, '203.0.113.40', wrong(real));
    const mapped = await attempt(rig, '::ffff:203.0.113.40', wrong(real));
    expect(mapped.lastError().payload.detail).toBe('retry_later');
  });
});

describe('exponential delay instead of a hard block (A3-03, SEC-A03)', () => {
  it('has the documented table: 3 free failures, then 2 s doubling to 60 s', () => {
    expect(BACKOFF_FREE_FAILURES).toBe(3);
    expect(BACKOFF_BASE_MS).toBe(2000);
    expect(BACKOFF_CAP_MS).toBe(60_000);
    expect(BACKOFF_RESET_MS).toBe(600_000);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map(backoffDelayMs)).toEqual([
      0, 0, 0, 0, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('delays the attacker step by step but never locks the source out, and a correct code works after the wait', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const real = tv.last('room.created').payload.pairing_code as string;
    const src = '203.0.113.60';
    // failures 1..4 are not delayed from outside: each attempt is processed
    const results: string[] = [];
    for (let i = 0; i < 4; i += 1) results.push((await attempt(rig, src, wrong(real))).lastError().payload.detail as string);
    expect(results).toEqual(['unknown_code', 'unknown_code', 'unknown_code', 'unknown_code']);
    // after the 4th failure the next attempt must wait 2 s; waiting less is refused WITHOUT counting as a failure
    let refused = await attempt(rig, src, wrong(real));
    expect(refused.lastError().payload).toMatchObject({ code: 'rate_limited', detail: 'retry_later' });
    refused = await attempt(rig, src, wrong(real));
    expect(refused.lastError().payload.detail).toBe('retry_later');
    rig.advance(1999);
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('retry_later');
    rig.advance(1);
    // 2 s elapsed: the attempt is processed (and fails: the 5th failure, next wait 4 s)
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('unknown_code');
    rig.advance(3999);
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('retry_later');
    rig.advance(1);
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('unknown_code'); // 6th, wait 8 s
    for (const wait of [8000, 16_000, 32_000, 60_000, 60_000]) {
      rig.advance(wait - 1);
      expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('retry_later');
      rig.advance(1);
      expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('unknown_code');
    }
    // never more than 60 s apart, however many failures: the delay is capped, not a lock
    rig.advance(60_000);
    const legit = await attempt(rig, src, real);
    expect(legit.of('join.pending')).toHaveLength(1);
    expect(legit.errors()).toEqual([]);
    expect(tv.of('join.requested')).toHaveLength(1);
  });

  it('delays only the failing source: a different source with the right code pairs immediately', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const real = tv.last('room.created').payload.pairing_code as string;
    for (let i = 0; i < 6; i += 1) await attempt(rig, '203.0.113.61', wrong(real));
    expect((await attempt(rig, '203.0.113.61', wrong(real))).lastError().payload.detail).toBe('retry_later');
    const other = await rig.connect(PHONE_ORIGIN, '203.0.113.62');
    other.role = 'phone';
    await rig.send(other, 'join.request', { payload: { pairing_code: real, device_label: 'Real user' } });
    expect(other.of('join.pending')).toHaveLength(1);
  });

  it('resets after 10 minutes without a failure', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const real = tv.last('room.created').payload.pairing_code as string;
    const src = '203.0.113.63';
    for (let i = 0; i < 6; i += 1) {
      await attempt(rig, src, wrong(real));
      rig.advance(BACKOFF_CAP_MS); // wait out every delay so the failures accumulate
    }
    expect(backoffDelayMs(6)).toBe(8000);
    // one failure just now: delayed
    await attempt(rig, src, wrong(real));
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('retry_later');
    rig.advance(BACKOFF_RESET_MS - 1);
    expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('unknown_code');
    // a clean 10 minutes: the count restarts at 1, so three more failures are free again
    rig.advance(BACKOFF_RESET_MS);
    for (let i = 0; i < 3; i += 1) {
      expect((await attempt(rig, src, wrong(real))).lastError().payload.detail).toBe('unknown_code');
    }
  });

  it('keeps the global failed-join counter an alarm metric, never a lock (200 sources fail, the real user still pairs)', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const real = tv.last('room.created').payload.pairing_code as string;
    for (let i = 0; i < 200; i += 1) {
      const c = await rig.connect(PHONE_ORIGIN, `100.64.${i >> 8}.${i & 255}`);
      c.role = 'phone';
      await rig.send(c, 'join.request', { payload: { pairing_code: wrong(real), device_label: 'x' } });
      await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
    }
    expect(rig.metrics.filter((m) => m.name === 'join_failed')).toHaveLength(200);
    const legit = await rig.connect(PHONE_ORIGIN, '203.0.113.99');
    legit.role = 'phone';
    await rig.send(legit, 'join.request', { payload: { pairing_code: real, device_label: 'Real user' } });
    expect(legit.of('join.pending')).toHaveLength(1);
    // nothing in the store is a global counter of failures: every abuse key is per source
    for (const key of abuseKeys(rig)) expect(key).toMatch(/[0-9a-f]{32}|rl1:|rl10:/);
  });
});

describe('$connect budget, concurrent unauthenticated connections, room caps (A3-03)', () => {
  it('allows 20 connection attempts per source per minute and refuses the 21st with a close action', async () => {
    const rig = new Rig();
    const src = '203.0.113.70';
    for (let i = 0; i < 20; i += 1) {
      const c = await rig.connect(PHONE_ORIGIN, src);
      expect(c.closed, `connect ${i + 1}`).toBeNull();
      await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
    }
    const refused = await rig.connect(PHONE_ORIGIN, src);
    expect(refused.closed).toMatchObject({ code: CLOSE.RATE_LIMITED, reason: 'too_many_connections' });
    expect(await rig.connectionCount()).toBe(0); // nothing recorded for a refused connection
    expect(rig.metrics.filter((m) => m.name === 'connect_refused')).toHaveLength(1);
    // another source is unaffected, and the next minute is a new budget
    expect((await rig.connect(PHONE_ORIGIN, '203.0.113.71')).closed).toBeNull();
    rig.advance(60_000);
    expect((await rig.connect(PHONE_ORIGIN, src)).closed).toBeNull();
  });

  it('allows at most 5 concurrent unauthenticated connections per source and frees a slot on every exit path', async () => {
    const rig = new Rig();
    const src = '203.0.113.72';
    const open: Client[] = [];
    for (let i = 0; i < 5; i += 1) open.push(await rig.connect(i === 1 ? null : PHONE_ORIGIN, src)); // [1] is the TV
    expect(open.every((c) => c.closed === null)).toBe(true);
    const sixth = await rig.connect(PHONE_ORIGIN, src);
    expect(sixth.closed).toMatchObject({ code: CLOSE.RATE_LIMITED, reason: 'too_many_connections' });
    // another source has its own 5
    expect((await rig.connect(PHONE_ORIGIN, '203.0.113.73')).closed).toBeNull();

    // exit path 1: the client disconnects
    await rig.exec(await rig.core.onDisconnect((open[0] as Client).id, rig.now));
    const a = await rig.connect(PHONE_ORIGIN, src);
    expect(a.closed).toBeNull();
    expect((await rig.connect(PHONE_ORIGIN, src)).closed).not.toBeNull();

    // exit path 2: authentication (room.create from the TV side of that source)
    const tv = open[1] as Client;
    tv.role = 'tv';
    await rig.send(tv, 'room.create');
    expect(tv.of('room.created')).toHaveLength(1);
    const b = await rig.connect(null, src);
    expect(b.closed).toBeNull();

    // exit path 3: the authentication deadline drops the rest (5 s), after which all slots are free again
    expect((await rig.connect(PHONE_ORIGIN, src)).closed).not.toBeNull();
    await rig.tick(5001);
    for (const c of [open[2], open[3], open[4], a, b] as Client[]) expect(c.closed?.reason).toBe('auth_deadline');
    rig.advance(60_000); // new connect budget minute
    const fresh: Client[] = [];
    for (let i = 0; i < 5; i += 1) fresh.push(await rig.connect(PHONE_ORIGIN, src));
    expect(fresh.every((c) => c.closed === null)).toBe(true);
    // (the authenticated TV connection does not hold a slot)
    expect(tv.closed).toBeNull();
  });

  it('caps live rooms globally, counting only rooms with a connection or idle for less than 30 minutes (configurable)', async () => {
    const rig = new Rig({ liveRoomCap: 3 });
    const rooms: Client[] = [];
    for (let i = 0; i < 3; i += 1) rooms.push(await rig.tvCreate(null, `203.0.113.${80 + i}`));
    const refused = await rig.connect(null, '203.0.113.90');
    refused.role = 'tv';
    await rig.send(refused, 'room.create');
    expect(refused.lastError().payload).toMatchObject({ code: 'rate_limited', detail: 'capacity' });
    expect(refused.closed?.code).toBe(CLOSE.RATE_LIMITED);
    expect(rig.metrics.filter((m) => m.name === 'room_cap_reached')).toHaveLength(1);
    // closing a room frees a place
    await rig.send(rooms[0] as Client, 'room.close');
    expect((await rig.tvCreate(null, '203.0.113.91')).roomId).toBeTruthy();
    // a room whose TV left stops counting after the 30 minute idle horizon, so abandoned rooms cannot lock everyone out
    await rig.exec(await rig.core.onDisconnect((rooms[1] as Client).id, rig.now));
    await rig.exec(await rig.core.onDisconnect((rooms[2] as Client).id, rig.now));
    const stillFull = await rig.connect(null, '203.0.113.92');
    stillFull.role = 'tv';
    await rig.send(stillFull, 'room.create');
    expect(stillFull.lastError().payload.detail).toBe('capacity');
    rig.advance(30 * 60_000);
    expect((await rig.tvCreate(null, '203.0.113.93')).roomId).toBeTruthy();
  });

  it('defaults the live-room cap to 200', async () => {
    const rig = new Rig();
    // 200 rooms exist without the cap being reached; the 201st is refused (rooms are created straight in the store)
    const { makeRoom, makeCode } = await import('./helpers/store-conformance.js');
    for (let i = 0; i < 200; i += 1) await rig.store.createRoom(makeRoom(`r${i}`, `h${i}`, { createdAt: rig.now, expiresAt: rig.now + 43_200_000, lastConnChange: rig.now }), makeCode(`h${i}`, `r${i}`, rig.now + 600_000), rig.now);
    expect(await rig.store.countLiveRooms(rig.now)).toBe(200);
    const tv = await rig.connect(null);
    tv.role = 'tv';
    await rig.send(tv, 'room.create');
    expect(tv.lastError().payload.detail).toBe('capacity');
  });

  it('limits room.create per /64 as well, so IPv6 address rotation does not widen the 30 per hour budget', async () => {
    const rig = new Rig({ liveRoomCap: 1000 });
    for (let i = 0; i < 30; i += 1) {
      await rig.tvCreate(null, `2001:db8:7:8:${i}::${i + 1}`);
      if (i % 10 === 9) rig.advance(61_000);
    }
    const c = await rig.connect(null, '2001:db8:7:8:aaaa::1');
    c.role = 'tv';
    await rig.send(c, 'room.create');
    expect(c.lastError().payload.detail).toBe('room_create_limit');
  });
});

describe('valid-code joins that end rejected or expired count per source: 6 per 10 minutes (A3-02)', () => {
  /** A phone from `source` requests a join with the TV's current code; the TV's answer is up to the caller. */
  async function joinFrom(rig: Rig, tv: Client, source: string): Promise<{ phone: Client; joinId: string | null }> {
    const latest = tv.inbox.filter((m) => m.type === 'room.created' || m.type === 'pairing.code').at(-1);
    const phone = await rig.connect(PHONE_ORIGIN, source);
    phone.role = 'phone';
    await rig.send(phone, 'join.request', { payload: { pairing_code: latest?.payload.pairing_code as string, device_label: 'Probe' } });
    const pending = phone.of('join.pending').at(-1);
    return { phone, joinId: pending ? (pending.payload.join_id as string) : null };
  }

  it('blocks the 7th request from a source whose six valid-code joins were all rejected, but not other sources', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const src = '203.0.113.101';
    for (let i = 0; i < 6; i += 1) {
      const { phone, joinId } = await joinFrom(rig, tv, src);
      expect(joinId, `join ${i + 1}`).not.toBeNull();
      await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
      expect(phone.last('join.rejected').payload.reason).toBe('rejected');
      await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
      rig.advance(1100); // keep the TV under its own message rate and the connect budget
    }
    const seventh = await joinFrom(rig, tv, src);
    expect(seventh.joinId).toBeNull();
    expect(seventh.phone.lastError().payload).toMatchObject({ code: 'rate_limited', detail: 'too_many_ended_joins' });
    expect(seventh.phone.closed?.code).toBe(CLOSE.RATE_LIMITED);
    // a different source pairs fine with the fresh code (the TV rejects it too, which counts for THAT source)
    const other = await joinFrom(rig, tv, '203.0.113.102');
    expect(other.joinId).not.toBeNull();
    await rig.send(tv, 'join.confirm', { payload: { join_id: other.joinId as string, decision: 'reject' } });
    // 10 minutes later the budget of the first source is back
    rig.advance(10 * 60_000);
    await rig.send(tv, 'pairing.refresh'); // the pushed code is 10 minutes old by now
    const later = await joinFrom(rig, tv, src);
    expect(later.joinId).not.toBeNull();
  });

  it('counts joins that expire unanswered and phones that leave with a request pending', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const src = '203.0.113.103';
    // three expiries (tick path) ...
    for (let i = 0; i < 3; i += 1) {
      const { phone, joinId } = await joinFrom(rig, tv, src);
      expect(joinId).not.toBeNull();
      for (let s = 0; s < 6; s += 1) {
        rig.advance(10_000);
        await rig.send(tv, 'ping');
        await rig.tick(0);
      }
      rig.advance(1000);
      await rig.tick(0);
      expect(phone.of('join.rejected').at(-1)?.payload.reason).toBe('expired');
      await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    }
    // ... and three phones that disconnect while pending
    for (let i = 0; i < 3; i += 1) {
      const { phone } = await joinFrom(rig, tv, src);
      await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
      rig.advance(1100);
    }
    const seventh = await joinFrom(rig, tv, src);
    expect(seventh.joinId).toBeNull();
    expect(seventh.phone.lastError().payload.detail).toBe('too_many_ended_joins');
  });

  it('does not count a join that ends in a successful pairing', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(null, '203.0.113.50');
    const src = '203.0.113.104';
    for (let i = 0; i < 3; i += 1) {
      const { phone, joinId } = await joinFrom(rig, tv, src);
      await rig.send(tv, 'join.confirm', { payload: { join_id: joinId as string, decision: 'reject' } });
      await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
      rig.advance(1100);
    }
    const ok = await joinFrom(rig, tv, src);
    await rig.send(tv, 'join.confirm', { payload: { join_id: ok.joinId as string, decision: 'accept' } });
    expect(ok.phone.of('join.accepted')).toHaveLength(1);
    // exactly the three rejected joins were counted for this source: the successful one was not
    const key = `vj:${new HashKeys('test-secret-0123456789').source(src, rig.now)}`;
    expect(await rig.store.getCounter(key, 600_000, rig.now)).toBe(3);
  });
});

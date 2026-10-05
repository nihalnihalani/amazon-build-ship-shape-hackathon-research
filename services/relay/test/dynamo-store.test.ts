import { describe, expect, it } from 'vitest';
import { DynamoDbRoomStore, LIVE_ROOMS_INDEX } from '../src/aws/dynamo-store.js';
import { FakeDynamo, FakeDynamoError } from './helpers/fake-dynamo.js';
import { describeStoreConformance, makeCode, makeConn, makeJoin, makeRoom } from './helpers/store-conformance.js';

const NOW = 1_800_000_000_000;

describeStoreConformance('DynamoDbRoomStore (against the fake DynamoDB model)', () => new DynamoDbRoomStore(new FakeDynamo(), 'relay-table'));

const ALLOWED_ATTRIBUTES = new Set([
  'pk', 'sk', 'expires_at', 'gsi1pk', 'gsi1sk',
  // room
  'room_id', 'created_ms', 'expires_ms', 'closed', 'last_conn_ms', 'last_refresh_ms', 'phone_gen', 'code_hash', 'active_session',
  'tv_epoch', 'phone_epoch', 'tv_cred_hash', 'tv_cred_exp_ms', 'tv_gen', 'tv_last_seq', 'tv_conn', 'tv_prev_hash', 'tv_prev_at_ms',
  'phone_cred_hash', 'phone_cred_exp_ms', 'phone_last_seq', 'phone_conn', 'phone_prev_hash', 'phone_prev_at_ms',
  // code, join, cue, message marker
  'code_exp_ms', 'join_id', 'confirm_digits', 'join_exp_ms', 'state', 'n', 'msg_exp_ms',
  // connection
  'conn_id', 'connected_ms', 'last_seen_ms', 'authenticated', 'auth_deadline_ms', 'unauth_count', 'strikes', 'rate_strikes',
  'join_failures', 'relay_seq', 'origin_state', 'source_hash', 'unauth_held', 'epoch', 'generation', 'role', 'join_room_id',
  // consumed-credential tombstone, backoff state
  'exp_ms', 'last_ms',
]);

/** One of every kind of item the store can write. */
async function populate(s: DynamoDbRoomStore): Promise<void> {
  await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1', NOW + 600_000), NOW);
  await s.createJoin(makeJoin('r1', 'j1', { expiresAt: NOW + 60_000 }), NOW);
  await s.acceptJoin({ roomId: 'r1', joinId: 'j1', codeHash: 'h1', claim: { credHash: 'b'.repeat(64), credExpiresAt: NOW + 7_200_000, connId: 'p1' }, now: NOW + 1 });
  await s.putConnection(makeConn('c1', { unauthHeld: true }), NOW);
  await s.recordMessageId('r1', 'phone', 'm1', NOW);
  await s.consumeCue('r1', 's1', 3, NOW);
  await s.incrementCounter('rl1:c1', 1000, NOW);
  await s.incrementCounter('cx:srchash', 60_000, NOW);
  await s.incrementCounter('rc:srchash', 3_600_000, NOW);
  await s.recordBackoffFailure('jf:srchash', NOW, 600_000);
  await s.acquireUnauthSlot('srchash', 5, NOW);
  await s.setActiveSession('r1', 's1');
  await s.rotateCode('r1', makeCode('h9', 'r1', NOW + 600_000), NOW + 3); // a live code (the accept consumed the first)
  await s.resumeRole({ roomId: 'r1', role: 'tv', connId: 'tv2', presentedHash: 'a'.repeat(64), nextHash: 'c'.repeat(64), nextExpiresAt: NOW + 7_200_000, now: NOW + 2 });
}

describe('DynamoDbRoomStore specifics', () => {
  it('stores only routing metadata: no payload, phrase, cue text, level or device label attributes (SEC-P07)', async () => {
    const fake = new FakeDynamo();
    await populate(new DynamoDbRoomStore(fake, 't'));
    const kinds = new Set([...fake.items.values()].map((i) => String(i.pk).split('#')[0]));
    for (const kind of ['ROOM', 'CODE', 'CONN', 'MSG', 'CTR', 'BO', 'UC', 'CRED']) expect(kinds.has(kind), kind).toBe(true);
    for (const item of fake.items.values()) {
      for (const attr of Object.keys(item)) expect(ALLOWED_ATTRIBUTES.has(attr), `unexpected attribute ${attr}`).toBe(true);
    }
    for (const forbidden of ['payload', 'phrase', 'text', 'cue', 'device_label', 'dbfs', 'level', 'pairing_code', 'address', 'ip']) {
      for (const item of fake.items.values()) {
        for (const attr of Object.keys(item)) expect(attr.includes(forbidden), `${attr} looks like content`).toBe(false);
      }
    }
    // credentials appear only as hashes (64 hex), never as 43-character base64url secrets
    const dump = JSON.stringify([...fake.items.values()]);
    expect(dump).not.toMatch(/"[A-Za-z0-9_-]{43}"/);
  });

  it('keeps a pre-authentication id marker for the 60 s id window only, holding the id and an expiry and nothing else (DEF-006)', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    expect(await s.recordConnectionMessageId('conn-1', 'm_abc', NOW)).toBe('new');
    const marker = fake.items.get('CMSG#conn-1#m_abc\u0000M') as Record<string, number | string>;
    expect(Object.keys(marker).sort()).toEqual(['expires_at', 'msg_exp_ms', 'pk', 'sk']);
    expect(marker.msg_exp_ms).toBe(NOW + 60_000);
    expect(await s.recordConnectionMessageId('conn-1', 'm_abc', NOW + 59_999)).toBe('duplicate');
    expect(await s.recordConnectionMessageId('conn-1', 'm_abc', NOW + 60_000)).toBe('new'); // logical expiry, not TTL deletion
  });

  it('keys abuse counters by the hashed source and holds counts only, with a TTL of at most one hour (A2-03)', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.incrementCounter('cx:srchash', 60_000, NOW);
    await s.incrementCounter('rc:srchash', 3_600_000, NOW);
    await s.incrementCounter('vj:srchash', 600_000, NOW);
    await s.recordBackoffFailure('jf:srchash', NOW, 600_000);
    await s.acquireUnauthSlot('srchash', 5, NOW);
    const abuse = [...fake.items.values()].filter((i) => /^(CTR|BO|UC)#/.test(String(i.pk)));
    expect(abuse.length).toBe(5);
    for (const item of abuse) {
      const ttlMs = (item.expires_at as number) * 1000;
      expect(ttlMs, String(item.pk)).toBeGreaterThan(NOW);
      expect(ttlMs - NOW, `${String(item.pk)} lives at most one hour`).toBeLessThanOrEqual(3_600_000);
      for (const attr of Object.keys(item)) expect(['pk', 'sk', 'n', 'last_ms', 'expires_at'].includes(attr), attr).toBe(true);
    }
  });

  it('sets a TTL attribute (epoch seconds) one hour past the logical expiry on every non-counter item', async () => {
    const fake = new FakeDynamo();
    await populate(new DynamoDbRoomStore(fake, 't'));
    for (const item of fake.items.values()) {
      const ttl = item.expires_at as number;
      expect(Number.isInteger(ttl), `ttl for ${String(item.pk)}`).toBe(true);
      expect(ttl).toBeLessThan(NOW); // epoch SECONDS (a millisecond value would be 1000x larger)
      expect(ttl).toBeGreaterThan(NOW / 1000);
    }
    const r = fake.items.get('ROOM#r1\u0000META') as Record<string, number>;
    expect((r.expires_at as number) * 1000).toBeGreaterThanOrEqual((r.expires_ms as number) + 3_600_000);
  });

  it('maintains the sparse live-rooms index: present while open, gone when closed (room cap)', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    const meta = () => fake.items.get('ROOM#r1\u0000META') as Record<string, unknown>;
    expect(meta().gsi1pk).toBe('LIVE');
    expect(meta().gsi1sk).toBe(NOW + 12 * 3_600_000);
    await s.detachConnection('r1', 'tv', 'tv-conn', NOW + 1000);
    expect(meta().gsi1sk).toBe(NOW + 1000 + 30 * 60_000); // idle horizon while nobody is attached
    await s.resumeRole({ roomId: 'r1', role: 'tv', connId: 'tv2', presentedHash: 'a'.repeat(64), nextHash: 'c'.repeat(64), nextExpiresAt: NOW + 7_200_000, now: NOW + 2000 });
    expect(meta().gsi1sk).toBe(NOW + 12 * 3_600_000); // attached again
    await s.closeRoom('r1', NOW + 3000);
    expect(meta().gsi1pk).toBeUndefined();
    expect(meta().gsi1sk).toBeUndefined();
    expect(LIVE_ROOMS_INDEX).toBe('live-rooms');
  });

  it('counts live rooms by paginated Query on the index, never by scanning the table', async () => {
    const fake = new FakeDynamo();
    fake.scanPageSize = 2;
    const s = new DynamoDbRoomStore(fake, 't');
    for (let i = 0; i < 7; i += 1) await s.createRoom(makeRoom(`r${i}`, `h${i}`), makeCode(`h${i}`, `r${i}`), NOW);
    await s.putConnection(makeConn('c1'), NOW); // other item kinds are not in the index
    fake.calls.length = 0;
    expect(await s.countLiveRooms(NOW)).toBe(7);
    expect(fake.calls.filter((c) => c.op === 'query').length).toBeGreaterThan(3);
    expect(fake.calls.some((c) => c.op === 'scan')).toBe(false);
  });

  it('uses only ExpressionAttributeNames placeholders and every placeholder (the fake enforces both)', async () => {
    // Running the whole flow against the strict fake is the check; this test names the guarantee.
    const fake = new FakeDynamo();
    await populate(new DynamoDbRoomStore(fake, 't'));
    expect(fake.calls.length).toBeGreaterThan(15);
  });

  it('writes the phone claim as one transaction over join, room and code', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    await s.createJoin(makeJoin('r1', 'j1'), NOW);
    fake.calls.length = 0;
    const r = await s.acceptJoin({ roomId: 'r1', joinId: 'j1', codeHash: 'h1', claim: { credHash: 'b'.repeat(64), credExpiresAt: NOW + 1000, connId: 'p1' }, now: NOW + 1 });
    expect(r.ok).toBe(true);
    expect(fake.calls.filter((c) => c.op === 'transact')).toHaveLength(1);
    // no separate, non-atomic writes to the join, the room slot or the code
    expect(fake.calls.filter((c) => c.op === 'update' || c.op === 'put' || c.op === 'delete')).toHaveLength(0);
  });

  it('retries a phone claim when a concurrent change cancels the transaction, and gives up cleanly', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    await s.createJoin(makeJoin('r1', 'j1'), NOW);
    const cancelled = () => new FakeDynamoError('TransactionCanceledException', 'cancelled');
    fake.injectFault((op) => op === 'transact', cancelled(), 1);
    const claim = { credHash: 'b'.repeat(64), credExpiresAt: NOW + 1000, connId: 'p1' };
    expect((await s.acceptJoin({ roomId: 'r1', joinId: 'j1', codeHash: 'h1', claim, now: NOW + 1 })).ok).toBe(true);

    await s.createRoom(makeRoom('r2', 'k1'), makeCode('k1', 'r2'), NOW);
    await s.createJoin(makeJoin('r2', 'jj', { codeHash: 'k1' }), NOW);
    fake.injectFault((op) => op === 'transact', cancelled(), 5);
    const res = await s.acceptJoin({ roomId: 'r2', joinId: 'jj', codeHash: 'k1', claim, now: NOW + 1 });
    expect(res.ok).toBe(false);
    expect((await s.getRoom('r2'))?.phone).toBeNull(); // nothing half-applied
    expect((await s.getJoin('r2'))?.state).toBe('pending');
  });

  it('writes a tombstone of the consumed credential in the same transaction as the rotation', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    fake.calls.length = 0;
    const r = await s.resumeRole({ roomId: 'r1', role: 'tv', connId: 'tv2', presentedHash: 'a'.repeat(64), nextHash: 'c'.repeat(64), nextExpiresAt: NOW + 1000, now: NOW + 1 });
    expect(r.ok).toBe(true);
    expect(fake.calls.filter((c) => c.op === 'transact')).toHaveLength(1);
    const tomb = fake.items.get(`CRED#${'a'.repeat(64)}\u0000T`) as Record<string, unknown>;
    expect(tomb).toMatchObject({ room_id: 'r1', role: 'tv' });
    expect(JSON.stringify(tomb)).not.toMatch(/"[A-Za-z0-9_-]{43}"/);
  });

  it('paginates the connection scan', async () => {
    const fake = new FakeDynamo();
    fake.scanPageSize = 2;
    const s = new DynamoDbRoomStore(fake, 't');
    for (let i = 0; i < 7; i += 1) await s.putConnection(makeConn(`c${i}`), NOW);
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    expect((await s.listConnections()).map((c) => c.connId).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(fake.calls.filter((c) => c.op === 'scan').length).toBeGreaterThan(3);
  });

  it('propagates non-conditional failures (throttling) instead of treating them as lost races', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    fake.injectFault(
      (op) => op === 'update',
      new FakeDynamoError('ProvisionedThroughputExceededException', 'throttled'),
    );
    await expect(s.claimPhoneSlot('r1', { credHash: 'c'.repeat(64), credExpiresAt: NOW + 5, connId: 'p' }, NOW)).rejects.toThrow(/throttled/);
    // nothing was claimed
    expect((await s.getRoom('r1'))?.phone).toBeNull();
  });

  it('rolls back the code item when the room put loses an id collision', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    expect(await s.createRoom(makeRoom('r1', 'h2'), makeCode('h2', 'r1'), NOW)).toBe('room_exists');
    expect(await s.findRoomByCodeHash('h2')).toBeNull();
    expect(await s.findRoomByCodeHash('h1')).not.toBeNull();
  });

  it('leaves exactly one live code item per room after many rotations', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    for (let i = 2; i <= 6; i += 1) await s.rotateCode('r1', makeCode(`h${i}`, 'r1'), NOW + i);
    const codes = [...fake.items.values()].filter((i) => String(i.pk).startsWith('CODE#') && i.room_id === 'r1');
    expect(codes).toHaveLength(1);
    expect(codes[0]?.pk).toBe('CODE#h6');
  });

  it('rejects an empty table name', () => {
    expect(() => new DynamoDbRoomStore(new FakeDynamo(), '')).toThrow();
  });

  it('keeps the message-id marker window time-bounded (60 s) rather than count-bounded, per room and role', async () => {
    const s = new DynamoDbRoomStore(new FakeDynamo(), 't');
    expect(await s.recordMessageId('r1', 'phone', 'm1', NOW)).toBe('new');
    expect(await s.recordMessageId('r1', 'phone', 'm1', NOW + 59_999)).toBe('duplicate');
    expect(await s.recordMessageId('r1', 'tv', 'm1', NOW + 59_999)).toBe('new');
    expect(await s.recordMessageId('r1', 'phone', 'm1', NOW + 60_000)).toBe('new');
  });
});

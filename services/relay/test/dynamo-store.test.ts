import { describe, expect, it } from 'vitest';
import { DynamoDbRoomStore } from '../src/aws/dynamo-store.js';
import { FakeDynamo, FakeDynamoError } from './helpers/fake-dynamo.js';
import { describeStoreConformance, makeCode, makeConn, makeJoin, makeRoom } from './helpers/store-conformance.js';

const NOW = 1_800_000_000_000;

describeStoreConformance('DynamoDbRoomStore (against the fake DynamoDB model)', () => new DynamoDbRoomStore(new FakeDynamo(), 'relay-table'));

describe('DynamoDbRoomStore specifics', () => {
  it('stores only routing metadata: no payload, phrase, cue text, level or device label attributes', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    await s.claimPhoneSlot('r1', { credHash: 'b'.repeat(64), credExpiresAt: NOW + 1000, connId: 'p1' }, NOW);
    await s.createJoin(makeJoin('r1', 'j1'), NOW);
    await s.putConnection(makeConn('c1'), NOW);
    await s.consumeCue('r1', 's1', 3, NOW);
    await s.recordMessageId('r1', 'm1', NOW);
    await s.incrementCounter('rl1:c1', 1000, NOW);
    await s.setActiveSession('r1', 's1');
    const allowed = new Set([
      'pk', 'sk', 'expires_at', 'room_id', 'created_ms', 'expires_ms', 'closed', 'last_conn_ms', 'phone_gen', 'code_hash',
      'active_session', 'tv_cred_hash', 'tv_cred_exp_ms', 'tv_gen', 'tv_last_seq', 'tv_conn', 'phone_cred_hash',
      'phone_cred_exp_ms', 'phone_last_seq', 'phone_conn', 'code_exp_ms', 'join_id', 'confirm_digits', 'join_exp_ms',
      'state', 'n', 'msg_exp_ms', 'conn_id', 'connected_ms', 'last_seen_ms', 'authenticated', 'auth_deadline_ms',
      'unauth_count', 'strikes', 'rate_strikes', 'join_failures', 'relay_seq', 'origin_state', 'source_hash', 'generation',
      'role', 'join_room_id',
    ]);
    for (const item of fake.items.values()) {
      for (const attr of Object.keys(item)) expect(allowed.has(attr), `unexpected attribute ${attr}`).toBe(true);
    }
    expect(fake.items.size).toBe(7);
    for (const forbidden of ['payload', 'phrase', 'text', 'cue', 'device_label', 'dbfs', 'level', 'credential', 'pairing_code']) {
      for (const item of fake.items.values()) {
        for (const attr of Object.keys(item)) expect(attr.includes(forbidden), `${attr} looks like content`).toBe(false);
      }
    }
  });

  it('sets a TTL attribute (epoch seconds) at least one hour after every logical expiry', async () => {
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    const room = makeRoom('r1', 'h1');
    await s.createRoom(room, makeCode('h1', 'r1', NOW + 600_000), NOW);
    await s.createJoin(makeJoin('r1', 'j1', { expiresAt: NOW + 60_000 }), NOW);
    await s.putConnection(makeConn('c1'), NOW);
    await s.recordMessageId('r1', 'm1', NOW);
    await s.consumeCue('r1', 's1', 3, NOW);
    await s.incrementCounter('k', 1000, NOW);
    for (const item of fake.items.values()) {
      const ttl = item.expires_at as number;
      expect(Number.isInteger(ttl), `ttl for ${String(item.pk)}`).toBe(true);
      expect(ttl).toBeLessThan(NOW); // epoch SECONDS (a millisecond value would be 1000x larger)
      expect(ttl).toBeGreaterThan(NOW / 1000);
    }
    const r = fake.items.get('ROOM#r1\u0000META') as Record<string, number>;
    expect((r.expires_at as number) * 1000).toBeGreaterThanOrEqual((r.expires_ms as number) + 3_600_000);
  });

  it('uses only ExpressionAttributeNames placeholders and every placeholder (the fake enforces both)', async () => {
    // Running the whole conformance flow against the strict fake is the check; this test names the guarantee.
    const fake = new FakeDynamo();
    const s = new DynamoDbRoomStore(fake, 't');
    await s.createRoom(makeRoom('r1', 'h1'), makeCode('h1', 'r1'), NOW);
    await s.bumpGeneration('r1', 'tv', 'c', NOW);
    expect(fake.calls.length).toBeGreaterThan(0);
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

  it('rejects an empty table name', () => {
    expect(() => new DynamoDbRoomStore(new FakeDynamo(), '')).toThrow();
  });

  it('keeps the message-id marker window time-bounded (60 s) rather than count-bounded', async () => {
    const s = new DynamoDbRoomStore(new FakeDynamo(), 't');
    expect(await s.recordMessageId('r1', 'm1', NOW)).toBe('new');
    expect(await s.recordMessageId('r1', 'm1', NOW + 59_999)).toBe('duplicate');
    expect(await s.recordMessageId('r1', 'm1', NOW + 60_000)).toBe('new');
  });
});

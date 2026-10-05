/**
 * Credential rotation, reuse detection, the one-step grace for a lost auth.ok, the supersede guard, revocation epochs
 * and the generic failure (A3-05, A3-07, A3-11, SEC-A08, SEC-A09, SEC-A10). Runs on both stores.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { CLOSE, CREDENTIAL_GRACE_MS, LIMITS, hashCredential } from '../src/core/index.js';
import { PHONE_ORIGIN, Rig, assertAllRigsNoLeaks, uid, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

async function pairedRig(): Promise<{ rig: Rig; tv: Client; phone: Client; room: string }> {
  const rig = new Rig();
  const tv = await rig.tvCreate();
  const phone = await rig.pair(tv);
  tv.clear();
  phone.clear();
  return { rig, tv, phone, room: tv.roomId as string };
}

const lost = async (rig: Rig, c: Client): Promise<void> => {
  // the connection dies mid-reply: the relay sees a close, the client never reads auth.ok
  await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
};

describe('credential rotation on resume (A3-07, A3-11)', () => {
  it('returns next_credential in auth.ok; credentials live 2 h from each resume and never beyond the room', async () => {
    const { rig, tv, room } = await pairedRig();
    const created = tv.inbox.length; // room.created was cleared; the TV credential is on the client
    void created;
    rig.advance(26_000);
    const t1 = rig.now;
    const a = await rig.resume(room, 'tv', tv.credential as string);
    const ok = a.last('auth.ok').payload;
    expect(ok.next_credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ok.next_credential).not.toBe(tv.credential);
    const r = await rig.store.getRoom(room);
    expect(r?.tv.credExpiresAt).toBe(t1 + LIMITS.credentialTtlMs); // renewed by rotation
    expect(r?.tv.credHash).toBe(hashCredential(ok.next_credential as string));
    expect(JSON.stringify(r)).not.toContain(ok.next_credential as string); // hashed at rest
    rig.advance(26_000);
    const b = await rig.resume(room, 'tv', a.credential as string);
    expect(b.of('auth.ok')).toHaveLength(1);
    expect((await rig.store.getRoom(room))?.tv.credExpiresAt).toBe(rig.now + LIMITS.credentialTtlMs);
  });

  it('chains: every resume consumes the presented credential and the previous ones stay dead', async () => {
    const { rig, tv, room } = await pairedRig();
    const history: string[] = [tv.credential as string];
    let live: Client = tv;
    for (let i = 0; i < 5; i += 1) {
      rig.advance(26_000);
      live = await rig.resume(room, 'tv', live.credential as string);
      expect(live.of('auth.ok'), `resume ${i + 1}`).toHaveLength(1);
      history.push(live.credential as string);
    }
    expect(new Set(history).size).toBe(6); // all different
    expect((await rig.store.getRoom(room))?.tv.generation).toBe(6);
  });

  it('works for the phone as well, and the TV is told of every phone supersede with the new generation (A3-07)', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const p2 = await rig.resume(room, 'phone', phone.credential as string);
    expect(p2.last('auth.ok').payload).toMatchObject({ role: 'phone', generation: 2, peer_connected: true });
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: true, generation: 2 });
    expect(phone.last('error').payload.code).toBe('superseded');
    expect(phone.closed?.code).toBe(CLOSE.SUPERSEDED);
    rig.advance(26_000);
    const p3 = await rig.resume(room, 'phone', p2.credential as string);
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: true, generation: 3 });
    expect(p3.generation).toBe(3);
  });
});

describe('a resume that would supersede a recently heard connection is refused (A3-07, SEC-A09)', () => {
  it('refuses within 25 s of the old connection last being heard, without consuming the credential; works after', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(10_000);
    await rig.send(phone, 'ping'); // the phone is heard
    rig.advance(24_999);
    const refused = await rig.resume(room, 'phone', phone.credential as string);
    expect(refused.errors()).toEqual(['unauthorized']);
    expect(refused.of('auth.ok')).toHaveLength(0);
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'auth_failed', code: 'would_supersede' }));
    expect(phone.closed).toBeNull(); // nothing was taken over
    expect(tv.of('peer.state').filter((m) => m.payload.connected === true && m.payload.generation === 2)).toHaveLength(0);
    // the credential was NOT consumed by the refused attempt
    rig.advance(1);
    const ok = await rig.resume(room, 'phone', phone.credential as string);
    expect(ok.of('auth.ok')).toHaveLength(1);
    expect(phone.closed?.code).toBe(CLOSE.SUPERSEDED);
  });

  it('applies to the TV too, and not when the old connection is already gone', async () => {
    const { rig, tv, room } = await pairedRig();
    const refused = await rig.resume(room, 'tv', tv.credential as string);
    expect(refused.errors()).toEqual(['unauthorized']);
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now)); // the old TV connection closes cleanly
    const ok = await rig.resume(room, 'tv', tv.credential as string);
    expect(ok.of('auth.ok')).toHaveLength(1);
  });

  it('a stolen credential cannot displace a live phone: the thief is refused and the phone keeps working', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    await rig.startSession(tv);
    for (let i = 0; i < 3; i += 1) {
      rig.advance(5_000);
      await rig.send(phone, 'ping');
      const thief = await rig.resume(room, 'phone', phone.credential as string, { source: `198.51.100.${200 + i}` });
      expect(thief.of('auth.ok')).toHaveLength(0);
    }
    await rig.send(phone, 'level');
    expect(tv.of('level')).toHaveLength(1);
    expect(phone.closed).toBeNull();
  });
});

describe('reuse of a consumed credential revokes the role and tells the TV (A3-07)', () => {
  it('phone: slot cleared, live phone dropped, TV told by error and peer.state, later resumes fail', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'phone', phone.credential as string); // consumes P -> N
    rig.advance(26_000);
    const b = await rig.resume(room, 'phone', a.credential as string); // consumes N -> N2
    tv.clear();
    rig.advance(1000);
    const attacker = await rig.resume(room, 'phone', phone.credential as string, { source: '198.51.100.77' }); // P again
    expect(attacker.errors()).toEqual(['unauthorized']); // generic to the one who presented it
    expect(attacker.lastError().payload.detail).toBe('resume_failed');
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'credential_reuse', role: 'phone' }));
    // the TV learns about it: "Pairing may be compromised. Pair again."
    expect(tv.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse', ref_message_id: null });
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: false });
    // the live phone connection is dropped, and the slot is gone
    expect(b.closed?.code).toBe(CLOSE.UNPAIRED);
    expect(b.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect((await rig.store.getRoom(room))?.phone).toBeNull();
    // even the legitimate latest credential is dead now
    const legit = await rig.resume(room, 'phone', b.credential as string, { source: '198.51.100.78' });
    expect(legit.errors()).toEqual(['unauthorized']);
    expect(legit.of('auth.ok')).toHaveLength(0);
    // a new pairing is possible and starts a fresh credential family
    await rig.send(tv, 'pairing.refresh');
    const again = await rig.pair(tv);
    expect(again.credential).toBeTruthy();
  });

  it('TV: the room is closed, both sides are told, the phone is dropped', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'tv', tv.credential as string);
    rig.advance(26_000);
    const b = await rig.resume(room, 'tv', a.credential as string);
    phone.clear();
    const attacker = await rig.resume(room, 'tv', tv.credential as string, { source: '198.51.100.79' });
    expect(attacker.errors()).toEqual(['unauthorized']);
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'credential_reuse', role: 'tv' }));
    expect((await rig.store.getRoom(room))?.closed).toBe(true);
    expect(b.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect(b.closed?.code).toBe(CLOSE.ROOM_CLOSED);
    expect(phone.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect(phone.closed?.code).toBe(CLOSE.ROOM_CLOSED);
  });

  it('a credential of another room or role is not "reuse" (it just fails)', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    const other = await rig.tvCreate();
    rig.advance(26_000);
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    await rig.resume(room, 'tv', tv.credential as string); // consumes the TV credential
    const cross = await rig.resume(room, 'tv', other.credential as string, { source: '198.51.100.80' });
    expect(cross.errors()).toEqual(['unauthorized']);
    expect(rig.rawLogEvents.filter((e) => (e as { event: string }).event === 'credential_reuse')).toHaveLength(0);
    expect((await rig.store.getRoom(room))?.closed).toBe(false);
    void phone;
  });
});

describe('one-step grace for a lost auth.ok (A3-07 refinement)', () => {
  it('lost auth.ok followed by a retry within 60 s succeeds with the SAME next_credential, without rotating again', async () => {
    const { rig, tv, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'tv', tv.credential as string); // the relay consumes P and answers N ...
    const issued = a.credential as string;
    await lost(rig, a); // ... but the reply is lost with the connection
    const before = await rig.store.getRoom(room);
    rig.advance(5_000);
    const b = await rig.resume(room, 'tv', tv.credential as string); // the client retries with P
    expect(b.of('auth.ok')).toHaveLength(1);
    expect(b.errors()).toEqual([]);
    expect(b.credential).toBe(issued); // exactly the same next credential
    const after = await rig.store.getRoom(room);
    expect(after?.tv.credHash).toBe(before?.tv.credHash); // not rotated again
    expect(after?.tv.credExpiresAt).toBe(before?.tv.credExpiresAt);
    expect(after?.tv.generation).toBe((before?.tv.generation as number) + 1); // the new connection is a new generation
    expect(after?.closed).toBe(false);
    expect(rig.metrics.filter((m) => m.name === 'credential_grace')).toHaveLength(1);
    expect(rig.rawLogEvents.filter((e) => (e as { event: string }).event === 'credential_reuse')).toHaveLength(0);
    // and the pairing continues normally: the issued credential rotates onward
    rig.advance(26_000);
    const c = await rig.resume(room, 'tv', b.credential as string);
    expect(c.of('auth.ok')).toHaveLength(1);
    expect(c.credential).not.toBe(issued);
  });

  it('the same for the phone, and the TV sees the reconnect', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'phone', phone.credential as string);
    await lost(rig, a);
    tv.clear();
    rig.advance(1_000);
    const b = await rig.resume(room, 'phone', phone.credential as string);
    expect(b.credential).toBe(a.credential);
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: true, generation: 3 });
  });

  it('is still valid 1 ms before the 60 s mark and refused at it (the retry is then treated as reuse)', async () => {
    for (const [offset, works] of [[CREDENTIAL_GRACE_MS - 1, true], [CREDENTIAL_GRACE_MS, false]] as const) {
      const { rig, tv, phone, room } = await pairedRig();
      rig.advance(26_000);
      const a = await rig.resume(room, 'phone', phone.credential as string);
      await lost(rig, a);
      tv.clear();
      rig.advance(offset);
      const b = await rig.resume(room, 'phone', phone.credential as string);
      expect(b.of('auth.ok').length, `offset ${offset}`).toBe(works ? 1 : 0);
      if (!works) {
        expect(tv.of('error').at(-1)?.payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
        expect((await rig.store.getRoom(room))?.phone).toBeNull();
      }
    }
  });

  it('a retry after 60 s revokes the role and tells the TV', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'phone', phone.credential as string);
    await lost(rig, a);
    tv.clear();
    rig.advance(61_000);
    const late = await rig.resume(room, 'phone', phone.credential as string, { source: '198.51.100.90' });
    expect(late.errors()).toEqual(['unauthorized']);
    expect(late.of('auth.ok')).toHaveLength(0);
    expect(tv.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect((await rig.store.getRoom(room))?.phone).toBeNull();
    // the credential that was issued is dead too: the role is revoked
    const issued = await rig.resume(room, 'phone', a.credential as string, { source: '198.51.100.91' });
    expect(issued.of('auth.ok')).toHaveLength(0);
  });

  it('a retry after the issued next credential was already used revokes the role and tells the TV', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'phone', phone.credential as string); // P -> N
    rig.advance(26_000);
    const b = await rig.resume(room, 'phone', a.credential as string); // N -> N2: the issued credential was presented
    tv.clear();
    rig.advance(5_000); // still within 60 s of the first issuance? (26 s + 5 s): yes
    const retry = await rig.resume(room, 'phone', phone.credential as string, { source: '198.51.100.92' });
    expect(retry.errors()).toEqual(['unauthorized']);
    expect(retry.of('auth.ok')).toHaveLength(0);
    expect(tv.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: false });
    expect(b.closed?.code).toBe(CLOSE.UNPAIRED);
    expect((await rig.store.getRoom(room))?.phone).toBeNull();
  });

  it('the grace works exactly once: a second retry within the window revokes', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'phone', phone.credential as string);
    await lost(rig, a);
    rig.advance(1_000);
    const b = await rig.resume(room, 'phone', phone.credential as string); // the one allowed retry
    expect(b.of('auth.ok')).toHaveLength(1);
    await lost(rig, b);
    tv.clear();
    rig.advance(1_000);
    const again = await rig.resume(room, 'phone', phone.credential as string, { source: '198.51.100.93' });
    expect(again.of('auth.ok')).toHaveLength(0);
    expect(tv.last('error').payload).toMatchObject({ code: 'revoked', detail: 'credential_reuse' });
    expect((await rig.store.getRoom(room))?.phone).toBeNull();
  });

  it('does not extend the grace to older credentials: only the immediately previous one', async () => {
    const { rig, tv, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'tv', tv.credential as string); // P -> N1
    rig.advance(26_000);
    const b = await rig.resume(room, 'tv', a.credential as string); // N1 -> N2
    await lost(rig, b);
    rig.advance(1_000);
    const old = await rig.resume(room, 'tv', tv.credential as string, { source: '198.51.100.94' }); // P (two steps back)
    expect(old.of('auth.ok')).toHaveLength(0);
    expect((await rig.store.getRoom(room))?.closed).toBe(true); // TV credential reuse closes the room
  });

  it('keeps honouring the supersede guard in the grace path', async () => {
    const { rig, tv, room } = await pairedRig();
    rig.advance(26_000);
    const a = await rig.resume(room, 'tv', tv.credential as string);
    // a is alive and was just heard: a retry with the old credential must not take its place
    rig.advance(1_000);
    const thief = await rig.resume(room, 'tv', tv.credential as string, { source: '198.51.100.95' });
    expect(thief.of('auth.ok')).toHaveLength(0);
    expect(a.closed).toBeNull();
  });
});

describe('revocation is an epoch compared on every message (A3-11, SEC-A10)', () => {
  it('a message in flight after unpair is rejected and its connection dropped, nothing is forwarded', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    await rig.startSession(tv);
    tv.clear();
    // the unpair write lands while the phone's last frame is already on the wire: the store changed, the socket did not close yet
    await rig.store.revokePhone(room, rig.now);
    await rig.send(phone, 'level');
    expect(phone.lastError().payload).toMatchObject({ code: 'revoked' });
    expect(phone.closed?.code).toBe(CLOSE.UNPAIRED);
    expect(tv.of('level')).toHaveLength(0);
  });

  it('stays revoked after the slot is claimed again: the old connection holds an old epoch', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    await rig.store.revokePhone(room, rig.now);
    await rig.store.claimPhoneSlot(room, { credHash: 'e'.repeat(64), credExpiresAt: rig.now + 3_600_000, connId: 'newcomer' }, rig.now);
    await rig.startSession(tv);
    tv.clear();
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['revoked']);
    expect(tv.of('level')).toHaveLength(0);
  });

  it('room.close bumps both epochs so no connection survives it', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    await rig.store.closeRoom(room, rig.now);
    await rig.send(tv, 'ping');
    expect(tv.errors()).toEqual(['revoked']);
    await rig.send(phone, 'ping');
    expect(phone.errors()).toEqual(['revoked']);
  });

  it('records the role epoch on each connection when it authenticates', async () => {
    const { rig, tv, phone, room } = await pairedRig();
    expect((await rig.store.getConnection(tv.id))?.epoch).toBe(1);
    expect((await rig.store.getConnection(phone.id))?.epoch).toBe(1);
    rig.advance(26_000);
    const p2 = await rig.resume(room, 'phone', phone.credential as string);
    expect((await rig.store.getConnection(p2.id))?.epoch).toBe(1);
    await rig.send(tv, 'unpair');
    await rig.send(tv, 'pairing.refresh');
    const p3 = await rig.pair(tv);
    expect((await rig.store.getConnection(p3.id))?.epoch).toBe(3); // claim 1, revoke 2, claim 3
  });
});

describe('the client always sees the same failure for every resume problem (A3-05, SEC-A08)', () => {
  type Case = { name: string; reason: string; run: (rig: Rig) => Promise<Client> };
  const cases: Case[] = [
    {
      name: 'unknown room',
      reason: 'unknown_room',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        return rig.resume(uid('r', 22), 'tv', tv.credential as string, { source: '198.51.100.110' });
      },
    },
    {
      name: 'wrong credential',
      reason: 'bad_credential',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        return rig.resume(tv.roomId as string, 'tv', 'W'.repeat(43), { source: '198.51.100.111' });
      },
    },
    {
      name: 'credential of the other role',
      reason: 'bad_credential',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        const phone = await rig.pair(tv);
        return rig.resume(tv.roomId as string, 'tv', phone.credential as string, { source: '198.51.100.112' });
      },
    },
    {
      name: 'credential of another room',
      reason: 'bad_credential',
      run: async (rig) => {
        const a = await rig.tvCreate();
        const b = await rig.tvCreate();
        return rig.resume(a.roomId as string, 'tv', b.credential as string, { source: '198.51.100.113' });
      },
    },
    {
      name: 'expired credential',
      reason: 'credential_expired',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        rig.advance(LIMITS.credentialTtlMs);
        await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
        return rig.resume(tv.roomId as string, 'tv', tv.credential as string, { source: '198.51.100.114' });
      },
    },
    {
      name: 'revoked (unpaired) phone credential',
      reason: 'credential_revoked',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        const phone = await rig.pair(tv);
        await rig.send(tv, 'unpair');
        return rig.resume(tv.roomId as string, 'phone', phone.credential as string, { source: '198.51.100.115' });
      },
    },
    {
      name: 'consumed credential',
      reason: 'credential_reused',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        const phone = await rig.pair(tv);
        const room = tv.roomId as string;
        rig.advance(26_000);
        const a = await rig.resume(room, 'phone', phone.credential as string);
        rig.advance(26_000);
        await rig.resume(room, 'phone', a.credential as string); // the next credential has been presented: no grace left
        return rig.resume(room, 'phone', phone.credential as string, { source: '198.51.100.116' });
      },
    },
    {
      name: 'closed room',
      reason: 'room_closed',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        await rig.send(tv, 'room.close');
        return rig.resume(tv.roomId as string, 'tv', tv.credential as string, { source: '198.51.100.117' });
      },
    },
    {
      name: 'role claim that disagrees with sender_role',
      reason: 'role_mismatch',
      run: async (rig) => {
        const tv = await rig.tvCreate();
        const c = await rig.connect(PHONE_ORIGIN, '198.51.100.118');
        c.role = 'phone';
        await rig.send(c, 'auth.resume', { payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string } });
        return c;
      },
    },
  ];

  it.each(cases)('$name: generic unauthorized to the client, the specific reason only in the server-side log', async (c) => {
    const rig = new Rig();
    const client = await c.run(rig);
    expect(client.of('auth.ok')).toHaveLength(0);
    const err = client.lastError();
    expect(err.payload.code).toBe('unauthorized');
    expect(err.payload.detail).toBe('resume_failed');
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'auth_failed', code: c.reason }));
    // nothing the client received names the reason
    expect(JSON.stringify(client.inbox)).not.toMatch(/revoked|expired|unknown|reuse|supersed|bad_credential|closed/);
  });

  it('the failure payloads are byte-identical across reasons apart from ids, so there is no oracle', async () => {
    const shapes = new Set<string>();
    for (const c of cases) {
      const rig = new Rig();
      const client = await c.run(rig);
      const e = client.lastError();
      shapes.add(JSON.stringify({ ...e.payload, ref_message_id: 'x', room: e.env.room_id === null ? 'null' : 'set', role: e.env.sender_role }));
    }
    expect(shapes.size).toBe(1);
  });

  it('applies the same generic answer when the per-source or per-room budget is exceeded', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    for (let i = 0; i < 10; i += 1) {
      const c = await rig.resume(tv.roomId as string, 'tv', 'X'.repeat(43), { source: '198.51.100.130' });
      expect(c.lastError().payload.code).toBe('unauthorized');
      await rig.exec(await rig.core.onDisconnect(c.id, rig.now)); // free the unauthenticated slot of this source
    }
    const throttled = await rig.resume(tv.roomId as string, 'tv', tv.credential as string, { source: '198.51.100.131' }); // another source, same room
    expect(throttled.lastError().payload).toMatchObject({ code: 'unauthorized', detail: 'resume_failed' });
    expect(rig.rawLogEvents).toContainEqual(expect.objectContaining({ event: 'auth_failed', code: 'throttled' }));
  });
});

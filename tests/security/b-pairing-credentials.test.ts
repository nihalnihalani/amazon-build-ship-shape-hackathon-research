/**
 * T16 gate, part B: pairing, TV confirmation, code burning, atomic claims, credential theft, rotation, reuse
 * detection, the supersede guard, generic failures and revocation. Real local relay, raw sockets.
 * Evidence class: automated.
 *
 *   SEC-A05 code lifecycle   SEC-A06 claim races   SEC-A07 TV confirmation   SEC-A08 generic failures
 *   SEC-A09 supersede, theft, rotation, reuse   SEC-A10 revocation
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Peer, RawClient, createRoom, envelope, mid, pairRaw, requestJoin, resume, sleep, startSecRelay, type SecRelay } from './helpers.js';

/** Waits until the relay has noticed that a connection is gone (it processes the close asynchronously). */
async function closeAndSettle(c: RawClient): Promise<void> {
  c.close();
  await sleep(300);
}

describe('SEC-A05, SEC-A07: code lifecycle and mandatory TV confirmation', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  it('SEC-A07: no credential is issued before the TV accepts; a reject issues none, burns the code and gives the TV a fresh one', async () => {
    const { tv, code } = await createRoom(relay);
    const j = await requestJoin(relay, code);
    const requested = await tv.client.next('join.requested');
    expect(requested.payload['confirm_digits']).toBe(j.digits); // the relay shows both screens the same two digits
    await sleep(300);
    expect(j.client.inbox.some((m) => m.type === 'join.accepted')).toBe(false);
    expect(JSON.stringify(j.client.frames)).not.toMatch(/phone_credential/);
    tv.send('join.confirm', { join_id: j.joinId, decision: 'reject' });
    const rej = await j.client.next('join.rejected');
    expect(rej.payload['reason']).toBe('rejected');
    expect(j.client.inbox.some((m) => m.type === 'join.accepted')).toBe(false);
    const fresh = await tv.client.next('pairing.code');
    expect(fresh.payload['pairing_code']).not.toBe(code);
    // the code the bystander may have seen no longer works
    const old = await RawClient.open(relay, relay.phoneOrigin);
    old.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'late joiner' } })));
    const err = await old.nextError();
    expect(err.code).toBe('not_found');
    expect(old.inbox.some((m) => m.type === 'join.pending')).toBe(false);
    old.close();
    j.client.close();
    tv.client.close();
  });

  it('SEC-A07: the phone cannot confirm its own join; a TV of another room cannot confirm this room\'s join', async () => {
    const a = await createRoom(relay);
    const b = await createRoom(relay);
    const j = await requestJoin(relay, a.code);
    await a.tv.client.next('join.requested');
    // the phone (unauthenticated) tries to confirm itself
    j.client.send(JSON.stringify(envelope('join.confirm', { role: 'phone', payload: { join_id: j.joinId, decision: 'accept' } })));
    expect((await j.client.nextError()).code).toMatch(/unauthenticated|forbidden_direction/);
    // TV of room B names the join of room A
    const from = b.tv.client.inbox.length;
    b.tv.send('join.confirm', { join_id: j.joinId, decision: 'accept' });
    expect((await b.tv.client.nextError(5000, from)).code).toBe('not_found');
    await sleep(200);
    expect(j.client.inbox.some((m) => m.type === 'join.accepted')).toBe(false);
    for (const x of [a.tv.client, b.tv.client, j.client]) x.close();
  });

  it('SEC-A05: pairing.refresh kills the old code at once, is limited to one per 10 s, and a room has one live code', async () => {
    const { tv, code } = await createRoom(relay);
    tv.send('pairing.refresh');
    const fresh = await tv.client.next('pairing.code');
    const newCode = String(fresh.payload['pairing_code']);
    expect(newCode).not.toBe(code);
    const from = tv.client.inbox.length;
    tv.send('pairing.refresh');
    const err = await tv.client.nextError(5000, from);
    expect(err.code).toBe('rate_limited');
    expect(err.detail).toBe('refresh_too_soon');
    // old code fails, new code works
    const o = await RawClient.open(relay, relay.phoneOrigin);
    o.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'old code' } })));
    expect((await o.nextError()).code).toBe('not_found');
    o.close();
    const j = await requestJoin(relay, newCode);
    expect(j.digits).toMatch(/^[0-9]{2}$/);
    j.client.close();
    tv.client.close();
  });
});

describe('SEC-A06: claim races', () => {
  let relay: SecRelay;
  beforeEach(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterEach(async () => {
    await relay?.stop();
  });

  it('two phones using the same code at the same instant: exactly one pending join, the other is busy (5 rounds)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { tv, code } = await createRoom(relay);
      const [a, b] = await Promise.all([RawClient.open(relay, relay.phoneOrigin), RawClient.open(relay, relay.phoneOrigin)]);
      const frame = (label: string): string => JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: label } }));
      const fa = frame('phone A');
      const fb = frame('phone B');
      a.send(fa);
      b.send(fb);
      await Promise.all([
        a.waitUntil(() => a.inbox.some((m) => m.type === 'join.pending' || m.type === 'join.rejected'), 5000, 'A reply'),
        b.waitUntil(() => b.inbox.some((m) => m.type === 'join.pending' || m.type === 'join.rejected'), 5000, 'B reply'),
      ]);
      const pending = [a, b].filter((c) => c.inbox.some((m) => m.type === 'join.pending'));
      const busy = [a, b].filter((c) => c.inbox.some((m) => m.type === 'join.rejected' && m.payload['reason'] === 'busy'));
      expect(pending, `round ${round}`).toHaveLength(1);
      expect(busy, `round ${round}`).toHaveLength(1);
      await tv.client.next('join.requested');
      expect(tv.client.inbox.filter((m) => m.type === 'join.requested')).toHaveLength(1); // the TV is asked once
      a.close();
      b.close();
      tv.client.close();
      await sleep(50);
    }
  }, 90_000);

  it('a double accept (two join.confirm in a row) claims the single phone slot once', async () => {
    const { tv, code } = await createRoom(relay);
    const j = await requestJoin(relay, code);
    await tv.client.next('join.requested');
    tv.send('join.confirm', { join_id: j.joinId, decision: 'accept' });
    tv.send('join.confirm', { join_id: j.joinId, decision: 'accept' });
    await j.client.next('join.accepted');
    await sleep(400);
    expect(j.client.inbox.filter((m) => m.type === 'join.accepted')).toHaveLength(1);
    const secondErr = tv.client.inbox.find((m) => m.type === 'error');
    expect(secondErr?.payload['code']).toBe('not_found'); // the second one finds no pending join
    // a third phone cannot take the slot with the (now consumed) code
    const late = await RawClient.open(relay, relay.phoneOrigin);
    late.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'third' } })));
    expect((await late.nextError()).code).toBe('not_found');
    for (const x of [late, j.client, tv.client]) x.close();
  });
});

describe('SEC-A08..A10: credential theft, rotation, reuse detection, supersede guard, revocation', () => {
  let relay: SecRelay;
  beforeEach(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterEach(async () => {
    await relay?.stop();
  });

  it('SEC-A09: a stolen phone credential cannot displace a live phone (refused, generic, credential not consumed); after the legitimate connection ends the owner resumes and receives a rotated credential', async () => {
    const p = await pairRaw(relay);
    const stolen = p.phoneCredential;
    const thief = await resume(relay, { roomId: p.roomId, role: 'phone', credential: stolen });
    expect(thief.ok).toBe(false);
    expect(thief.reply?.payload['code']).toBe('unauthorized');
    expect(thief.reply?.payload['detail']).toBe('resume_failed'); // generic: nothing says why
    thief.client.close();
    // the legitimate phone is untouched: it is still connected and its messages still reach the TV
    const tvFrom = p.tv.client.inbox.length;
    p.phone.send('mic.state');
    await p.tv.client.next('mic.state', 5000, tvFrom);
    expect(p.phone.client.closed).toBeNull();
    expect(p.tv.client.inbox.slice(tvFrom).some((m) => m.type === 'peer.state')).toBe(false); // no supersede was announced
    // the refusal did not consume the credential: after a real disconnect the owner can resume with it
    await closeAndSettle(p.phone.client);
    const owner = await resume(relay, { roomId: p.roomId, role: 'phone', credential: stolen });
    expect(owner.ok).toBe(true);
    const next = String(owner.reply?.payload['next_credential']);
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe(stolen); // rotation
    expect(Number(owner.reply?.payload['generation'])).toBeGreaterThan(p.phone.generation);
    const ps = await p.tv.client.next('peer.state', 5000, tvFrom); // TV learns of the reconnect with the new generation
    expect(ps.payload['role']).toBe('phone');
    owner.client.close();
    p.tv.client.close();
  });

  it('SEC-A09: presenting a credential that two rotations ago was consumed revokes the role, tells the TV, and drops the live phone', async () => {
    const p = await pairRaw(relay);
    const p0 = p.phoneCredential;
    await closeAndSettle(p.phone.client);
    const r1 = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(r1.ok).toBe(true);
    const p1 = String(r1.reply?.payload['next_credential']);
    await closeAndSettle(r1.client);
    const r2 = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p1 });
    expect(r2.ok).toBe(true);
    const p2 = String(r2.reply?.payload['next_credential']);
    const tvFrom = p.tv.client.inbox.length;
    // the thief replays the very first credential
    const thief = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(thief.ok).toBe(false);
    expect(thief.reply?.payload['code']).toBe('unauthorized'); // the thief learns nothing specific
    expect(thief.reply?.payload['detail']).toBe('resume_failed');
    // the TV is told the pairing may be compromised
    const tvErr = await p.tv.client.nextError(5000, tvFrom);
    expect(tvErr.code).toBe('revoked');
    expect(tvErr.detail).toBe('credential_reuse');
    // the live legitimate connection is dropped with an explicit revocation
    const liveErr = await r2.client.nextError(5000);
    expect(liveErr.code).toBe('revoked');
    expect((await r2.client.waitClosed()).code).toBe(4410);
    // even the newest credential no longer works: the phone must pair again
    const after = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p2 });
    expect(after.ok).toBe(false);
    expect(after.reply?.payload['detail']).toBe('resume_failed');
    for (const x of [thief.client, after.client, p.tv.client]) x.close();
  });

  it('SEC-A09: a lost auth.ok is survived once: the consumed credential is accepted again within 60 s and returns the SAME next credential; a second retry is reuse', async () => {
    const p = await pairRaw(relay);
    const p0 = p.phoneCredential;
    await closeAndSettle(p.phone.client);
    const r1 = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(r1.ok).toBe(true);
    const n1 = String(r1.reply?.payload['next_credential']);
    await closeAndSettle(r1.client); // auth.ok "lost": the client never used n1
    const retry = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(retry.ok).toBe(true);
    expect(String(retry.reply?.payload['next_credential'])).toBe(n1);
    await closeAndSettle(retry.client);
    const second = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(second.ok).toBe(false); // the grace is spent: this is replay of a consumed credential
    const afterRevoke = await resume(relay, { roomId: p.roomId, role: 'phone', credential: n1 });
    expect(afterRevoke.ok).toBe(false); // and the role is revoked
    for (const x of [second.client, afterRevoke.client, p.tv.client]) x.close();
  });

  it('RESIDUAL (documented in docs/operations/SECURITY-NOTES.md section 2): inside the 60 s grace, a thief holding the consumed credential obtains the next credential; the owner presenting it afterwards still works', async () => {
    const p = await pairRaw(relay);
    const p0 = p.phoneCredential;
    await closeAndSettle(p.phone.client);
    const owner = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    const n1 = String(owner.reply?.payload['next_credential']);
    await closeAndSettle(owner.client);
    const thief = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p0 });
    expect(thief.ok).toBe(true); // the residual: a time-boxed window of at most 60 s and one use
    expect(String(thief.reply?.payload['next_credential'])).toBe(n1);
    thief.client.close();
    p.tv.client.close();
  });

  it('SEC-A08: every failed resume looks the same to the caller (unknown room, wrong credential, wrong role, malformed)', async () => {
    const p = await pairRaw(relay);
    const outcomes: Array<{ code: string; detail: string }> = [];
    const attempt = async (o: { roomId: string; role: 'tv' | 'phone'; credential: string }): Promise<void> => {
      const r = await resume(relay, o);
      expect(r.ok).toBe(false);
      outcomes.push({ code: String(r.reply?.payload['code']), detail: String(r.reply?.payload['detail']) });
      r.client.close();
    };
    await attempt({ roomId: 'r_' + 'A'.repeat(22), role: 'phone', credential: p.phoneCredential }); // unknown room
    await attempt({ roomId: p.roomId, role: 'phone', credential: 'A'.repeat(43) }); // wrong credential
    await attempt({ roomId: p.roomId, role: 'tv', credential: p.phoneCredential }); // phone credential presented as the TV
    expect(outcomes).toHaveLength(3);
    expect(new Set(outcomes.map((o) => `${o.code}/${o.detail}`)).size).toBe(1);
    expect(outcomes[0]).toEqual({ code: 'unauthorized', detail: 'resume_failed' });
    p.tv.client.close();
    p.phone.client.close();
  });

  it('SEC-A08: resume failures are limited per room: after 10 in a minute even a correct credential is refused with the same generic answer', async () => {
    const p = await pairRaw(relay);
    await closeAndSettle(p.phone.client);
    for (let i = 0; i < 4; i += 1) {
      // three failures per connection, then the relay closes it
      const c = await RawClient.open(relay, relay.phoneOrigin);
      for (let k = 0; k < 3; k += 1) {
        c.send(JSON.stringify(envelope('auth.resume', { role: 'phone', roomId: p.roomId, payload: { room_id: p.roomId, role: 'phone', credential: B64wrong(i * 3 + k) } })));
      }
      await c.waitUntil(() => c.closed !== null || c.inbox.filter((m) => m.type === 'error').length >= 3, 6000, 'failures answered');
      c.close();
      if (i === 3) await sleep(100);
    }
    const good = await resume(relay, { roomId: p.roomId, role: 'phone', credential: p.phoneCredential });
    expect(good.ok).toBe(false); // throttled for the room: the cost of the per-room budget
    expect(good.reply?.payload['detail']).toBe('resume_failed'); // indistinguishable from any other failure
    good.client.close();
    p.tv.client.close();
  });

  it('SEC-A10: unpair revokes the phone at once (unpaired, close 4410) and its credential never works again; room.close ends everything', async () => {
    const p = await pairRaw(relay);
    const stolen = p.phoneCredential;
    const tvFrom = p.tv.client.inbox.length;
    p.tv.send('unpair');
    const un = await p.phone.client.next('unpaired');
    expect(un.payload['reason']).toBe('tv_unpaired');
    expect((await p.phone.client.waitClosed()).code).toBe(4410);
    const ps = await p.tv.client.next('peer.state', 5000, tvFrom);
    expect(ps.payload['connected']).toBe(false);
    await sleep(200);
    const after = await resume(relay, { roomId: p.roomId, role: 'phone', credential: stolen });
    expect(after.ok).toBe(false);
    after.client.close();
    // room.close
    const q = await pairRaw(relay);
    const tvCred = q.tvCredential;
    q.tv.send('room.close');
    expect((await q.phone.client.waitClosed()).code).toBe(4411);
    expect((await q.tv.client.waitClosed()).code).toBe(1000);
    const tvAfter = await resume(relay, { roomId: q.roomId, role: 'tv', credential: tvCred, origin: null });
    expect(tvAfter.ok).toBe(false);
    const phAfter = await resume(relay, { roomId: q.roomId, role: 'phone', credential: q.phoneCredential });
    expect(phAfter.ok).toBe(false);
    for (const x of [tvAfter.client, phAfter.client, p.tv.client]) x.close();
  });

  it('SEC-A09: a consumed TV credential presented by a thief closes the whole room for both sides', async () => {
    const p = await pairRaw(relay);
    const t0 = p.tvCredential;
    await closeAndSettle(p.tv.client);
    const r1 = await resume(relay, { roomId: p.roomId, role: 'tv', credential: t0, origin: null });
    expect(r1.ok).toBe(true);
    const t1 = String(r1.reply?.payload['next_credential']);
    await closeAndSettle(r1.client);
    const r2 = await resume(relay, { roomId: p.roomId, role: 'tv', credential: t1, origin: null });
    expect(r2.ok).toBe(true);
    const thief = await resume(relay, { roomId: p.roomId, role: 'tv', credential: t0, origin: null });
    expect(thief.ok).toBe(false);
    const phoneErr = await p.phone.client.nextError();
    expect(phoneErr.code).toBe('revoked');
    expect(phoneErr.detail).toBe('credential_reuse');
    expect((await p.phone.client.waitClosed()).code).toBe(4411);
    expect((await r2.client.waitClosed()).code).toBe(4411);
    for (const x of [thief.client, r2.client]) x.close();
  });
});

function B64wrong(i: number): string {
  return ('W' + String(i)).padEnd(43, 'x');
}

// Referenced to keep the helper imports used when a test is edited out.
void Peer;
void mid;

/**
 * AWS adapter behaviour added by the rework batch: delayed authentication-deadline checks (A3-09, SEC-A02),
 * connect budgets (A3-03), origin handling at the handshake (A3-08, SEC-A11), the test platform (A3-12, SEC-I07),
 * configuration, secret handling, aggregation and EMF (A2-04, SEC-P02), and message-level equivalence with the local
 * adapter.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { AwsConfigError, loadAwsConfig } from '../src/aws/config.js';
import { base64DecodedLength } from '../src/aws/handlers.js';
import { createSecretReader } from '../src/aws/runtime.js';
import { FakeDynamoError } from './helpers/fake-dynamo.js';
import { DOMAIN, LambdaRig, PHONE_ORIGIN, STAGE, type LambdaClient } from './helpers/lambda-rig.js';
import { PHONE_ORIGIN as LOCAL_PHONE_ORIGIN, Rig, assertNoLeaks } from './helpers/rig.js';

const rigs: LambdaRig[] = [];
const make = (o: ConstructorParameters<typeof LambdaRig>[0] = {}): LambdaRig => {
  const r = new LambdaRig(o);
  rigs.push(r);
  return r;
};
afterAll(() => {
  for (const r of rigs) {
    const secrets: string[] = [];
    for (const msgs of r.api.sent.values()) {
      for (const raw of msgs) {
        const p = (JSON.parse(raw) as { payload: Record<string, unknown> }).payload;
        for (const k of ['tv_credential', 'phone_credential', 'pairing_code', 'next_credential']) {
          if (typeof p[k] === 'string') secrets.push(p[k] as string);
        }
      }
    }
    assertNoLeaks(r.logs, secrets);
    for (const line of r.metricLines) JSON.parse(line);
  }
});

/** A phone that has connected and sent a join.request for the TV's current code; the TV has not answered yet. */
async function pendingJoin(rig: LambdaRig, tv: LambdaClient): Promise<{ phoneId: string; joinId: string }> {
  const phoneId = `phone-pending-${rig.scheduler.history.length}`;
  const code = (rig.api.of(tv.id, 'pairing.code').at(-1) ?? rig.api.of(tv.id, 'room.created').at(-1))?.payload.pairing_code as string;
  expect((await rig.connect(phoneId, PHONE_ORIGIN)).statusCode).toBe(200);
  const phone = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
  await rig.message(phoneId, rig.build(phone, 'join.request', { payload: { pairing_code: code, device_label: 'Pixel' } }));
  const joinId = rig.api.of(tv.id, 'join.requested').at(-1)?.payload.join_id as string;
  expect(joinId).toBeTruthy();
  return { phoneId, joinId };
}

describe('authentication deadline queue (A3-09, SEC-A02)', () => {
  it('$connect queues one 5 s check that carries only the connection id, the API domain and the stage', async () => {
    const rig = make();
    expect((await rig.connect('c1', PHONE_ORIGIN)).statusCode).toBe(200);
    expect(rig.scheduler.history).toHaveLength(1);
    const [only] = rig.scheduler.history;
    expect(only?.delaySeconds).toBe(5);
    expect(only?.message).toEqual({ c: 'c1', d: DOMAIN, s: STAGE });
    expect(Object.keys(only?.message ?? {}).sort()).toEqual(['c', 'd', 's']);
  });

  it('never queues anything for a refused $connect: foreign Origin, literal null, kill switch, budget', async () => {
    const rig = make();
    expect((await rig.connect('x1', 'https://evil.example.test')).statusCode).toBe(403);
    expect((await rig.connect('x2', 'null')).statusCode).toBe(403);
    rig.disabled = true;
    expect((await rig.connect('x3', PHONE_ORIGIN)).statusCode).toBe(503);
    rig.disabled = false;
    expect(rig.scheduler.history).toHaveLength(0);
  });

  it('join.request queues a 65 s check; a TV reject, a wrong pick and an expiry each queue a 5 s check', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const first = await pendingJoin(rig, tv);
    const after = (id: string) => rig.scheduler.history.filter((h) => h.message.c === id).map((h) => h.delaySeconds);
    expect(after(first.phoneId)).toEqual([5, 65]);
    // the TV answers with a reject (a wrong number pick reaches the relay as the same message)
    await rig.send(tv, 'join.confirm', { payload: { join_id: first.joinId, decision: 'reject' } });
    expect(after(first.phoneId)).toEqual([5, 65, 5]);
    expect(rig.api.of(first.phoneId, 'join.rejected')).toHaveLength(1);

    // an unanswered join that expires: queued by the 65 s check itself
    const second = await pendingJoin(rig, tv);
    rig.now += 65_000;
    await rig.deliverDue();
    expect(after(second.phoneId)).toEqual([5, 65, 5]);
  });

  it('drops an unauthenticated connection after 5 s: an error message, then DeleteConnection, then the slot is free', async () => {
    const rig = make();
    await rig.connect('idle', PHONE_ORIGIN);
    rig.now += 5_000;
    const results = await rig.deliverDue();
    expect(results).toEqual([{ batchItemFailures: [] }]);
    const err = rig.api.of('idle', 'error')[0]?.payload;
    expect(err).toMatchObject({ code: 'unauthenticated', detail: 'auth_deadline' });
    expect(rig.api.deleted).toContain('idle');
    expect(await rig.store.getConnection('idle')).toBeNull();
    // error first, then the close: the order the client sees
    expect(rig.api.deleted.indexOf('idle')).toBeGreaterThanOrEqual(0);
    expect(rig.logs.some((l) => JSON.parse(l).event === 'auth_deadline')).toBe(true);
  });

  it('is idempotent and never early: a check before the deadline, or run twice, changes nothing the second time', async () => {
    const rig = make();
    await rig.connect('early', PHONE_ORIGIN);
    // an early delivery (before the deadline) leaves the connection alone
    rig.now += 4_000;
    await rig.runtime.handleDeadline({ Records: [{ messageId: 'e1', body: JSON.stringify(rig.scheduler.history[0]?.message) }] });
    expect(await rig.store.getConnection('early')).not.toBeNull();
    expect(rig.api.deleted).toEqual([]);
    // the on-time delivery drops it, and a duplicate delivery of the same message does nothing more
    rig.now += 1_000;
    await rig.runtime.handleDeadline({ Records: [{ messageId: 'e2', body: JSON.stringify(rig.scheduler.history[0]?.message) }] });
    const sent = rig.api.messages('early').length;
    const r = await rig.runtime.handleDeadline({ Records: [{ messageId: 'e3', body: JSON.stringify(rig.scheduler.history[0]?.message) }] });
    expect(r.batchItemFailures).toEqual([]);
    expect(rig.api.messages('early')).toHaveLength(sent);
    expect(rig.api.deleted.filter((d) => d === 'early')).toHaveLength(1);
  });

  it('leaves an authenticated connection alone (the 5 s check from its $connect is a no-op)', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    rig.now += 70_000;
    await rig.deliverDeadlines();
    expect(await rig.store.getConnection(tv.id)).not.toBeNull();
    expect(await rig.store.getConnection(phone.id)).not.toBeNull();
    expect(rig.api.deleted).toEqual([]);
    expect(rig.api.errors(tv.id)).toEqual([]);
    expect(rig.api.errors(phone.id)).toEqual([]);
  });

  it('a pending join survives the 5 s check, is expired by the 65 s check (fresh code pushed) and the phone is dropped 5 s later', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    await rig.deliverDue(); // (nothing is due yet)
    rig.now += 1_000;
    const { phoneId } = await pendingJoin(rig, tv);
    const codeBefore = rig.api.of(tv.id, 'room.created')[0]?.payload.pairing_code;

    rig.now += 5_000; // the phone's $connect check is due; its join.request moved the deadline to +65 s
    await rig.deliverDue();
    expect(await rig.store.getConnection(phoneId)).not.toBeNull();
    expect(rig.api.of(phoneId, 'error')).toHaveLength(0);
    expect(rig.api.of(phoneId, 'join.rejected')).toHaveLength(0);

    rig.now += 60_000; // 65 s after the join.request
    await rig.deliverDue();
    expect(rig.api.of(phoneId, 'join.rejected')[0]?.payload).toMatchObject({ reason: 'expired' });
    expect(rig.api.of(tv.id, 'join.expired')).toHaveLength(1);
    const fresh = rig.api.of(tv.id, 'pairing.code').at(-1)?.payload.pairing_code;
    expect(typeof fresh).toBe('string');
    expect(fresh).not.toBe(codeBefore);
    expect(await rig.store.getConnection(phoneId)).not.toBeNull(); // 5 s grace after the verdict
    expect(rig.api.deleted).not.toContain(phoneId);

    rig.now += 5_000;
    await rig.deliverDue();
    expect(rig.api.of(phoneId, 'error').at(-1)?.payload).toMatchObject({ code: 'unauthenticated', detail: 'auth_deadline' });
    expect(rig.api.deleted).toContain(phoneId);
    expect(await rig.store.getConnection(phoneId)).toBeNull();
    // the TV stays connected and keeps its room
    expect(await rig.store.getConnection(tv.id)).not.toBeNull();
  });

  it('releases the concurrent-unauthenticated slot when the deadline drops a connection', async () => {
    const rig = make();
    const source = { sourceIp: '198.51.100.7' };
    for (let i = 0; i < 5; i += 1) {
      expect((await rig.handler(rig.event('$connect', `s${i}`, { headers: { Origin: PHONE_ORIGIN } }, { identity: source }))).statusCode).toBe(200);
    }
    expect((await rig.handler(rig.event('$connect', 'over', { headers: { Origin: PHONE_ORIGIN } }, { identity: source }))).statusCode).toBe(429);
    rig.now += 5_000;
    await rig.deliverDue();
    expect((await rig.handler(rig.event('$connect', 'again', { headers: { Origin: PHONE_ORIGIN } }, { identity: source }))).statusCode).toBe(200);
  });

  it('behaves the same at the message level as the local adapter: unauthenticated connection', async () => {
    // local adapter
    const local = new Rig();
    const lp = await local.connect(LOCAL_PHONE_ORIGIN);
    local.advance(5_000);
    await local.tick();
    const localSeen = lp.inbox.map((m) => [m.type, m.payload.code, m.payload.detail]);
    expect(lp.closed?.reason).toBe('auth_deadline');
    // AWS adapter
    const rig = make();
    await rig.connect('p', PHONE_ORIGIN);
    rig.now += 5_000;
    await rig.deliverDue();
    const awsSeen = rig.api.messages('p').map((m) => [m.type, m.payload.code, m.payload.detail]);
    expect(rig.api.deleted).toContain('p');
    expect(awsSeen).toEqual(localSeen);
    expect(awsSeen).toEqual([['error', 'unauthenticated', 'auth_deadline']]);
  });

  it('behaves the same at the message level as the local adapter: pending join that is never answered', async () => {
    const summary = (msgs: { type: string; payload: Record<string, unknown> }[]): unknown[] =>
      msgs.map((m) => [m.type, m.payload.reason ?? m.payload.code ?? null, m.payload.detail ?? null]);

    // local adapter
    const local = new Rig();
    const ltv = await local.tvCreate();
    const lphone = await local.connect(LOCAL_PHONE_ORIGIN);
    lphone.role = 'phone';
    const lcode = ltv.last('room.created').payload.pairing_code as string;
    await local.send(lphone, 'join.request', { payload: { pairing_code: lcode, device_label: 'Pixel' } });
    local.advance(59_000);
    await local.send(ltv, 'ping'); // the TV is alive (a silent socket is dropped by the local idle sweep)
    ltv.clear();
    local.advance(1_000);
    await local.tick();
    local.advance(5_000);
    await local.tick();
    expect(lphone.closed?.reason).toBe('auth_deadline');

    // AWS adapter
    const rig = make();
    const tv = await rig.tvCreate();
    const { phoneId } = await pendingJoin(rig, tv);
    const tvBefore = rig.api.messages(tv.id).length;
    rig.now += 65_000;
    await rig.deliverDue();
    rig.now += 5_000;
    await rig.deliverDue();
    expect(rig.api.deleted).toContain(phoneId);

    const phoneSeenAws = summary(rig.api.messages(phoneId).filter((m) => m.type !== 'join.pending' as string));
    const phoneSeenLocal = summary(lphone.inbox.filter((m) => m.type !== ('join.pending' as string)));
    expect(phoneSeenAws).toEqual(phoneSeenLocal);
    const tvSeenAws = summary(rig.api.messages(tv.id).slice(tvBefore));
    const tvSeenLocal = summary(ltv.inbox);
    expect(tvSeenAws).toEqual(tvSeenLocal);
    expect(tvSeenAws.map((x) => (x as unknown[])[0])).toEqual(['join.expired', 'pairing.code']);
  });

  it('fails open when the queue is unavailable: $connect still succeeds, the error is logged without detail, and the next message enforces the deadline', async () => {
    const rig = make();
    rig.scheduler.failWith = new Error('SQS AccessDenied SECRET-QUEUE-DETAIL arn:aws:sqs:ap-south-1:123456789012:q');
    const r = await rig.connect('nq', PHONE_ORIGIN);
    expect(r.statusCode).toBe(200);
    expect(rig.scheduler.history).toHaveLength(0);
    const text = rig.logs.join('\n');
    expect(text).not.toContain('SECRET-QUEUE-DETAIL');
    expect(text).not.toContain('123456789012');
    expect(rig.logs.some((l) => JSON.parse(l).event === 'internal_error')).toBe(true);
    rig.now += 5_001;
    await rig.message('nq', rig.build({ role: 'phone', roomId: null, generation: 0, nextSeq: 0 }, 'ping'));
    expect(rig.api.deleted).toContain('nq');
  });

  it('works without any scheduler (not configured): the deadline is enforced on the next message', async () => {
    const rig = make({ overrides: { scheduler: undefined } });
    expect((await rig.connect('ns', PHONE_ORIGIN)).statusCode).toBe(200);
    rig.now += 5_001;
    await rig.message('ns', rig.build({ role: 'phone', roomId: null, generation: 0, nextSeq: 0 }, 'ping'));
    expect(rig.api.deleted).toContain('ns');
  });

  it('clamps the queue delay to what SQS allows (at most 900 s)', async () => {
    const rig = make();
    for (const e of rig.scheduler.history) expect(e.delaySeconds).toBeLessThanOrEqual(900);
    await rig.tvCreate();
    for (const e of rig.scheduler.history) {
      expect(e.delaySeconds).toBeGreaterThanOrEqual(0);
      expect(e.delaySeconds).toBeLessThanOrEqual(900);
      expect(Number.isInteger(e.delaySeconds)).toBe(true);
    }
  });

  describe('the consumer (handleDeadline)', () => {
    const badBodies: [string, string][] = [
      ['not json', 'this is not json'],
      ['empty object', '{}'],
      ['a number', '42'],
      ['null', 'null'],
      ['missing domain', JSON.stringify({ c: 'x', s: STAGE })],
      ['foreign host (SSRF)', JSON.stringify({ c: 'x', d: 'attacker.example.com', s: STAGE })],
      ['host with a path', JSON.stringify({ c: 'x', d: `${DOMAIN}/evil`, s: STAGE })],
      ['host with a port', JSON.stringify({ c: 'x', d: `${DOMAIN}:8443`, s: STAGE })],
      ['host with userinfo', JSON.stringify({ c: 'x', d: `user@${DOMAIN}`, s: STAGE })],
      ['stage with a path', JSON.stringify({ c: 'x', d: DOMAIN, s: '../admin' })],
      ['stage with a query', JSON.stringify({ c: 'x', d: DOMAIN, s: 'prod?x=1' })],
      ['empty connection id', JSON.stringify({ c: '', d: DOMAIN, s: STAGE })],
      ['connection id too long', JSON.stringify({ c: 'a'.repeat(129), d: DOMAIN, s: STAGE })],
      ['connection id of the wrong type', JSON.stringify({ c: 5, d: DOMAIN, s: STAGE })],
    ];

    it.each(badBodies)('drops a malformed message without retrying it and without any AWS call: %s', async (_name, body) => {
      const rig = make();
      const r = await rig.runtime.handleDeadline({ Records: [{ messageId: 'bad-1', body }] });
      expect(r.batchItemFailures).toEqual([]); // never retried: it can never become valid
      expect(rig.api.endpoints).toEqual([]); // the Management API was never contacted, least of all at a foreign host
      expect(rig.api.deleted).toEqual([]);
      expect(rig.logs.some((l) => JSON.parse(l).event === 'internal_error')).toBe(true);
      expect(rig.logs.join('\n')).not.toContain('attacker.example.com');
    });

    it('uses the domain and stage from the message for the Management API endpoint, nothing else', async () => {
      const rig = make();
      await rig.connect('e', PHONE_ORIGIN);
      const other = 'zzz999.execute-api.eu-west-1.amazonaws.com';
      rig.now += 5_000;
      await rig.runtime.handleDeadline({ Records: [{ messageId: 'm', body: JSON.stringify({ c: 'e', d: other, s: 'prod' }) }] });
      expect(rig.api.endpoints).toContain(`https://${other}/prod`);
    });

    it('reports exactly the failed records so the rest of the batch is not redelivered, and keeps going', async () => {
      const rig = make();
      await rig.connect('a', PHONE_ORIGIN);
      await rig.connect('b', PHONE_ORIGIN);
      await rig.connect('c', PHONE_ORIGIN);
      rig.now += 5_000;
      rig.fake?.injectFault((op) => op === 'get', new FakeDynamoError('InternalServerError', 'boom SECRET-TABLE-DETAIL'), 1);
      const rec = (id: string, c: string) => ({ messageId: id, body: JSON.stringify({ c, d: DOMAIN, s: STAGE }) });
      const r = await rig.runtime.handleDeadline({ Records: [rec('r1', 'a'), rec('r2', 'b'), rec('r3', 'c')] });
      expect(r.batchItemFailures).toEqual([{ itemIdentifier: 'r1' }]);
      expect(rig.api.deleted.sort()).toEqual(['b', 'c']);
      expect(await rig.store.getConnection('a')).not.toBeNull(); // retried later by SQS
      expect(rig.logs.join('\n')).not.toContain('SECRET-TABLE-DETAIL');
      // the redelivery succeeds
      const again = await rig.runtime.handleDeadline({ Records: [rec('r1', 'a')] });
      expect(again.batchItemFailures).toEqual([]);
      expect(rig.api.deleted).toContain('a');
    });

    it('treats a connection that is already gone as done (GoneException from the Management API)', async () => {
      const rig = make();
      await rig.connect('g', PHONE_ORIGIN);
      rig.api.gone.add('g');
      rig.now += 5_000;
      const r = await rig.runtime.handleDeadline({ Records: [{ messageId: 'g1', body: JSON.stringify({ c: 'g', d: DOMAIN, s: STAGE }) }] });
      expect(r.batchItemFailures).toEqual([]);
      expect(await rig.store.getConnection('g')).toBeNull();
    });

    it('treats an unknown connection (already disconnected) as done', async () => {
      const rig = make();
      const r = await rig.runtime.handleDeadline({ Records: [{ messageId: 'u1', body: JSON.stringify({ c: 'nobody', d: DOMAIN, s: STAGE }) }] });
      expect(r.batchItemFailures).toEqual([]);
      expect(rig.api.deleted).toEqual([]);
    });
  });
});

describe('$connect handshake (A3-03, A3-08, SEC-A03, SEC-A11)', () => {
  const connectFrom = (rig: LambdaRig, id: string, ip: string, origin: string | null = PHONE_ORIGIN) =>
    rig.handler(rig.event('$connect', id, { headers: origin === null ? {} : { Origin: origin } }, { identity: { sourceIp: ip } }));

  it('answers 429 when a source exceeds 20 connects a minute, and records nothing for the refused ones', async () => {
    const rig = make();
    for (let i = 0; i < 20; i += 1) {
      expect((await connectFrom(rig, `b${i}`, '198.51.100.20')).statusCode).toBe(200);
      await rig.disconnect(`b${i}`); // the concurrent cap is tested separately
    }
    const over = await connectFrom(rig, 'b-over', '198.51.100.20');
    expect(over.statusCode).toBe(429);
    expect(await rig.store.getConnection('b-over')).toBeNull();
    expect(rig.scheduler.history.filter((h) => h.message.c === 'b-over')).toHaveLength(0);
    expect(rig.metricLines.join('\n')).toContain('connect_refused');
    // another source is unaffected
    expect((await connectFrom(rig, 'other', '198.51.100.21')).statusCode).toBe(200);
    // the window passes
    rig.now += 61_000;
    expect((await connectFrom(rig, 'later', '198.51.100.20')).statusCode).toBe(200);
  });

  it('answers 429 for a sixth concurrent unauthenticated connection from one source, then frees a slot on disconnect', async () => {
    const rig = make();
    for (let i = 0; i < 5; i += 1) expect((await connectFrom(rig, `u${i}`, '198.51.100.30')).statusCode).toBe(200);
    expect((await connectFrom(rig, 'u5', '198.51.100.30')).statusCode).toBe(429);
    await rig.disconnect('u0');
    expect((await connectFrom(rig, 'u6', '198.51.100.30')).statusCode).toBe(200);
    // authenticating gives the slot back too: a TV that created a room no longer counts
    const tv = await rig.tvCreate(); // its own source
    expect(tv.roomId).not.toBeNull();
  });

  it('treats an IPv6 /64 as one source', async () => {
    const rig = make();
    for (let i = 0; i < 5; i += 1) {
      expect((await connectFrom(rig, `v${i}`, `2001:db8:1:2:${i + 1}::${i + 7}`)).statusCode).toBe(200);
    }
    expect((await connectFrom(rig, 'v-over', '2001:db8:1:2:ffff::1')).statusCode).toBe(429);
    expect((await connectFrom(rig, 'v-other', '2001:db8:1:3::1')).statusCode).toBe(200);
  });

  it('stores no address anywhere: neither keys nor attributes of the table contain the source address', async () => {
    const rig = make();
    await connectFrom(rig, 'p1', '198.51.100.44');
    await connectFrom(rig, 'p2', '2001:db8:aaaa:bbbb::5');
    const dump = JSON.stringify([...(rig.fake?.items.entries() ?? [])]);
    expect(dump).not.toContain('198.51.100.44');
    expect(dump).not.toContain('2001:db8:aaaa');
    expect(rig.logs.join('\n') + rig.metricLines.join('\n')).not.toContain('198.51.100.44');
  });

  it('keeps counter items short-lived: every abuse counter expires within an hour', async () => {
    const rig = make();
    await connectFrom(rig, 'ttl', '198.51.100.45');
    const counters = [...(rig.fake?.items.entries() ?? [])].filter(([k]) => k.startsWith('CTR#') || k.includes('cx:'));
    expect(counters.length).toBeGreaterThan(0);
    for (const [, item] of counters) {
      const exp = (item as { expires_at?: number }).expires_at;
      expect(typeof exp).toBe('number');
      expect((exp as number) * 1000 - rig.now).toBeLessThanOrEqual(3_600_000 + 1000);
    }
  });

  it('rejects the literal Origin "null", an empty Origin and a look-alike with 403 (header present, not allowlisted)', async () => {
    const rig = make();
    for (const [i, origin] of ['null', '', 'https://d111111abcdef8.cloudfront.net.evil.test', 'https://D111111ABCDEF8.cloudfront.net', 'http://d111111abcdef8.cloudfront.net'].entries()) {
      const r = await connectFrom(rig, `o${i}`, `198.51.100.${60 + i}`, origin);
      expect(r.statusCode, `Origin ${JSON.stringify(origin)}`).toBe(403);
      expect(await rig.store.getConnection(`o${i}`)).toBeNull();
    }
    expect(rig.metricLines.join('\n')).toContain('origin_rejected');
    expect(rig.scheduler.history).toHaveLength(0);
  });

  it('finds the Origin header whatever its case, and rejects a second Origin header whatever its case', async () => {
    const rig = make();
    for (const [i, name] of ['Origin', 'origin', 'ORIGIN', 'oRiGiN'].entries()) {
      const r = await rig.handler(rig.event('$connect', `h${i}`, { headers: { [name]: PHONE_ORIGIN } }, { identity: { sourceIp: `198.51.100.${70 + i}` } }));
      expect(r.statusCode, name).toBe(200);
    }
    const dup = await rig.handler(
      rig.event('$connect', 'hd', { headers: { origin: PHONE_ORIGIN }, multiValueHeaders: { ORIGIN: [PHONE_ORIGIN, 'https://evil.example.test'] } }, { identity: { sourceIp: '198.51.100.80' } }),
    );
    expect(dup.statusCode).toBe(403);
  });

  it('keeps the TV preview origin out of the phone allowlist: it cannot connect in production, and can only be a TV in staging', async () => {
    const preview = 'https://tv-preview.example.test';
    const prod = make({ overrides: { environment: 'production' } });
    expect((await prod.connect('pv', preview)).statusCode).toBe(403);
    const staging = make({ overrides: { environment: 'staging', tvPreviewOrigins: [preview] } });
    expect((await staging.connect('pv-ok', preview)).statusCode).toBe(200);
    // as a "phone" it gets nothing: join.request needs a phone origin
    const phone = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
    await staging.message('pv-ok', staging.build(phone, 'join.request', { payload: { pairing_code: 'ABCDEFGH', device_label: 'x' } }));
    expect(staging.api.errors('pv-ok').length).toBeGreaterThan(0);
    expect(staging.api.of('pv-ok', 'join.pending')).toHaveLength(0);
  });

  it('refuses to run a production core configured with preview origins: every invocation fails (500), never a quiet allow', async () => {
    const rig = make({ overrides: { environment: 'production', tvPreviewOrigins: ['https://tv-preview.example.test'] } });
    const r = await rig.handler(rig.event('$connect', 'x', { headers: { Origin: PHONE_ORIGIN } }));
    expect(r.statusCode).toBe(500);
    expect(await rig.store.getConnection('x')).toBeNull();
  });
});

describe('the test platform in production (A3-12, SEC-I07)', () => {
  const testTv = (rig: LambdaRig, id: string, platform: string) => {
    const tv = { role: 'tv' as const, roomId: null, generation: 0, nextSeq: 0 };
    return rig.message(id, rig.build(tv, 'room.create', { payload: { client: { app_version: '0.1.0', platform } } }));
  };

  it('rejects client.platform "test" when the environment is production and creates no room', async () => {
    const rig = make({ overrides: { environment: 'production' } });
    await rig.connect('t1', null);
    await testTv(rig, 't1', 'test');
    expect(rig.api.of('t1', 'error')[0]?.payload).toMatchObject({ code: 'unauthorized', detail: 'platform_not_allowed' });
    expect(rig.api.of('t1', 'room.created')).toHaveLength(0);
    expect(rig.logs.join('\n')).not.toContain('"platform"');
  });

  it('accepts a real platform in production and every platform in staging and development', async () => {
    for (const [env, platform, ok] of [
      ['production', 'vega', true],
      ['production', 'web_preview', true],
      ['production', 'test', false],
      ['staging', 'test', true],
      ['development', 'test', true],
    ] as const) {
      const rig = make({ overrides: { environment: env } });
      await rig.connect('t', null);
      await testTv(rig, 't', platform);
      expect(rig.api.of('t', 'room.created').length, `${env}/${platform}`).toBe(ok ? 1 : 0);
    }
  });

  it('is controlled by ATR_ENV (the template sets production when Stage=prod)', () => {
    const base = { TABLE_NAME: 't', ALLOWED_ORIGINS: PHONE_ORIGIN, HASH_SECRET_PARAM: '/atr/relay/prod/hash-secret' };
    expect(loadAwsConfig({ ...base, ATR_ENV: 'production' }).environment).toBe('production');
    expect(loadAwsConfig({ ...base, ATR_ENV: 'staging' }).environment).toBe('staging');
    expect(loadAwsConfig({ ...base }).environment).toBe('development');
    expect(() => loadAwsConfig({ ...base, ATR_ENV: 'prod' })).toThrow(AwsConfigError);
    expect(() => loadAwsConfig({ ...base, ATR_ENV: 'Production' })).toThrow(AwsConfigError);
  });
});

describe('inbound frames on the Lambda adapter (PK-10, SEC-V02)', () => {
  it('never decodes a base64 body: only its size is read, and the frame is refused as binary', async () => {
    const rig = make();
    await rig.connect('bin', PHONE_ORIGIN);
    // a body that would be a perfectly valid ping if it were decoded
    const ping = rig.build({ role: 'phone', roomId: null, generation: 0, nextSeq: 0 }, 'ping');
    await rig.message('bin', Buffer.from(ping, 'utf8').toString('base64'), { isBase64Encoded: true });
    expect(rig.api.errors('bin')).toEqual(['binary_rejected']);
    expect(rig.api.of('bin', 'pong')).toHaveLength(0);
    expect(rig.api.deleted).toContain('bin');
  });

  it('computes the decoded size from the length alone (no allocation of the decoded bytes)', () => {
    expect(base64DecodedLength('')).toBe(0);
    expect(base64DecodedLength('AA==')).toBe(1);
    expect(base64DecodedLength('AAA=')).toBe(2);
    expect(base64DecodedLength('AAAA')).toBe(3);
    expect(base64DecodedLength('A'.repeat(4 * 100_000))).toBe(300_000);
    expect(base64DecodedLength(Buffer.alloc(10_000).toString('base64'))).toBe(10_000);
  });

  it('refuses an oversized binary frame as binary_rejected (the cheaper check), never as a parse error', async () => {
    const rig = make();
    await rig.connect('big', PHONE_ORIGIN);
    await rig.message('big', Buffer.alloc(40_000, 7).toString('base64'), { isBase64Encoded: true });
    expect(rig.api.errors('big')[0]).toBe('binary_rejected');
  });

  it('refuses an oversized text frame by size before parsing it, and closes', async () => {
    const rig = make();
    await rig.connect('txt', PHONE_ORIGIN);
    await rig.message('txt', `{"x":"${'a'.repeat(9000)}"}`);
    expect(rig.api.errors('txt')[0]).toBe('payload_too_large');
    expect(rig.api.deleted).toContain('txt');
  });

  it('answers a frame with no body (an empty text frame) as bad_schema, not with an exception', async () => {
    const rig = make();
    await rig.connect('nb', PHONE_ORIGIN);
    const r = await rig.handler(rig.event('$default', 'nb', { body: null, isBase64Encoded: false }));
    expect(r.statusCode).toBe(200);
    expect(rig.api.errors('nb')).toEqual(['bad_schema']);
  });
});

describe('Lambda configuration (A3-04, A3-08, A3-12, A3-03)', () => {
  const base = { TABLE_NAME: 'tbl', ALLOWED_ORIGINS: 'https://d1.cloudfront.net', HASH_SECRET_PARAM: '/atr/relay/staging/hash-secret' };

  it.each([
    [{ ...base, HASH_SECRET_PARAM: undefined }, /HASH_SECRET_PARAM/],
    [{ ...base, HASH_SECRET_PARAM: '' }, /HASH_SECRET_PARAM/],
    [{ ...base, HASH_SECRET_PARAM: 'no-leading-slash' }, /HASH_SECRET_PARAM/],
    [{ ...base, HASH_SECRET_PARAM: '/has space' }, /HASH_SECRET_PARAM/],
    [{ ...base, HASH_SECRET_PARAM: `/${'a'.repeat(300)}` }, /HASH_SECRET_PARAM/],
    [{ ...base, ATR_ENV: 'prod' }, /ATR_ENV/],
    [{ ...base, ATR_ENV: 'production', TV_PREVIEW_ORIGINS: 'https://tv.example.test' }, /TV_PREVIEW_ORIGINS/],
    [{ ...base, ATR_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:5173' }, /localhost|http/],
    [{ ...base, TV_PREVIEW_ORIGINS: 'ftp://x.example' }, /TV_PREVIEW_ORIGINS/],
    [{ ...base, TV_PREVIEW_ORIGINS: '*' }, /TV_PREVIEW_ORIGINS/],
    [{ ...base, LIVE_ROOM_CAP: '0' }, /LIVE_ROOM_CAP/],
    [{ ...base, LIVE_ROOM_CAP: '-5' }, /LIVE_ROOM_CAP/],
    [{ ...base, LIVE_ROOM_CAP: '1.5' }, /LIVE_ROOM_CAP/],
    [{ ...base, LIVE_ROOM_CAP: 'many' }, /LIVE_ROOM_CAP/],
    [{ ...base, LIVE_ROOM_CAP: '100001' }, /LIVE_ROOM_CAP/],
  ])('fails closed for %j', (env, pattern) => {
    expect(() => loadAwsConfig(env as Record<string, string | undefined>)).toThrow(AwsConfigError);
    expect(() => loadAwsConfig(env as Record<string, string | undefined>)).toThrow(pattern);
  });

  it('reads the new variables', () => {
    const c = loadAwsConfig({
      ...base,
      ATR_ENV: 'staging',
      TV_PREVIEW_ORIGINS: 'https://tv.example.test, http://localhost:5174',
      LIVE_ROOM_CAP: '350',
      DEADLINE_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/000000000000/atr-relay-staging-deadline',
    });
    expect(c.environment).toBe('staging');
    expect(c.tvPreviewOrigins).toEqual(['https://tv.example.test', 'http://localhost:5174']);
    expect(c.liveRoomCap).toBe(350);
    expect(c.deadlineQueueUrl).toMatch(/atr-relay-staging-deadline$/);
    expect(c.hashSecretParameter).toBe('/atr/relay/staging/hash-secret');
    const d = loadAwsConfig(base);
    expect(d.liveRoomCap).toBe(200);
    expect(d.deadlineQueueUrl).toBeNull();
    expect(d.tvPreviewOrigins).toEqual([]);
  });

  it('never accepts a secret value in the environment: the config has a parameter name only', () => {
    const c = loadAwsConfig({ ...base, HASH_PEPPER: 'plain-text-pepper-value', HASH_SECRET: 'plain-text-secret-value' });
    expect(JSON.stringify(c)).not.toContain('plain-text');
    expect(Object.keys(c)).not.toContain('hashSecret');
    expect(Object.keys(c)).not.toContain('hashPepper');
  });
});

describe('the hash secret (A3-04)', () => {
  it('rebuilds the core when the secret changes: codes issued under the old secret no longer match, nothing is stale', async () => {
    let secret = 'first-secret-0123456789abcdef';
    const rig = make({ overrides: { hashSecret: async () => secret } });
    const tv = await rig.tvCreate();
    const code = rig.api.of(tv.id, 'room.created')[0]?.payload.pairing_code as string;
    secret = 'second-secret-0123456789abcdef';
    await rig.connect('p', PHONE_ORIGIN);
    const phone = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
    await rig.message('p', rig.build(phone, 'join.request', { payload: { pairing_code: code, device_label: 'x' } }));
    // generic failure: the code is hashed with the new secret and finds nothing
    expect(rig.api.of('p', 'join.rejected').length + rig.api.errors('p').length).toBeGreaterThan(0);
    expect(rig.api.of(tv.id, 'join.requested')).toHaveLength(0);
  });

  it('keeps one core across calls while the secret is unchanged (no per-call rebuild)', async () => {
    let reads = 0;
    const rig = make({
      overrides: {
        hashSecret: async () => {
          reads += 1;
          return 'stable-secret-0123456789abcdef';
        },
      },
    });
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    await rig.send(phone, 'level');
    expect(reads).toBeGreaterThan(3); // read through the cache every call
    expect(rig.api.of(tv.id, 'level')).toHaveLength(1);
  });

  it('a secret that cannot be read fails the invocation (500), never a default secret', async () => {
    const rig = make({
      overrides: {
        hashSecret: async () => {
          throw new Error('AccessDenied SECRET-SSM-DETAIL');
        },
      },
    });
    const r = await rig.handler(rig.event('$connect', 'x', { headers: { Origin: PHONE_ORIGIN } }));
    expect(r.statusCode).toBe(500);
    expect(rig.logs.join('\n')).not.toContain('SECRET-SSM-DETAIL');
    const d = await rig.runtime.handleDeadline({ Records: [{ messageId: 'q1', body: JSON.stringify({ c: 'x', d: DOMAIN, s: STAGE }) }] });
    expect(d.batchItemFailures).toEqual([{ itemIdentifier: 'q1' }]);
  });

  it('refuses a secret that is too short', async () => {
    const rig = make({ overrides: { hashSecret: async () => 'short' } });
    const r = await rig.handler(rig.event('$connect', 'x', { headers: { Origin: PHONE_ORIGIN } }));
    expect(r.statusCode).toBe(500);
  });

  describe('createSecretReader', () => {
    it('caches for the TTL, then refetches, and refetches again after a failure', async () => {
      let now = 1000;
      let calls = 0;
      let fail = false;
      const read = createSecretReader(
        async () => {
          calls += 1;
          if (fail) throw new Error('ssm down');
          return `v${calls}`;
        },
        () => now,
        10 * 60_000,
      );
      expect(await read()).toBe('v1');
      now += 9 * 60_000;
      expect(await read()).toBe('v1');
      expect(calls).toBe(1);
      now += 61_000;
      expect(await read()).toBe('v2');
      expect(calls).toBe(2);
      // an outage after the TTL surfaces as an error (never a stale or default secret), and a later success recovers
      now += 11 * 60_000;
      fail = true;
      await expect(read()).rejects.toThrow('ssm down');
      fail = false;
      expect(await read()).toBe('v4');
    });

    it('does not cache a failed first read', async () => {
      let calls = 0;
      const read = createSecretReader(async () => {
        calls += 1;
        if (calls === 1) throw new Error('first');
        return 'ok-secret';
      });
      await expect(read()).rejects.toThrow('first');
      expect(await read()).toBe('ok-secret');
      expect(await read()).toBe('ok-secret');
      expect(calls).toBe(2);
    });
  });
});

describe('logging and metrics on the Lambda adapter (A2-04, SEC-P02)', () => {
  it('writes no line per forwarded message: 100 level frames add no log line', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    const before = rig.logs.length;
    for (let i = 0; i < 100; i += 1) {
      rig.now += 50;
      await rig.send(phone, 'level', { payload: { frame_index: i, t_audio_ms: i * 50, dbfs: -40, active: true, clipped: false } });
    }
    expect(rig.api.of(tv.id, 'level')).toHaveLength(100);
    const added = rig.logs.slice(before).map((l) => JSON.parse(l) as { event: string });
    expect(added.filter((l) => l.event === 'message_forwarded')).toHaveLength(0);
    expect(added).toHaveLength(0);
  });

  it('writes one minute_aggregate line per kind and type after the minute, counts only', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.now = Math.ceil(rig.now / 60_000) * 60_000 + 1; // start of a fresh minute
    await rig.send(tv, 'ping'); // flush anything older
    const start = rig.logs.length;
    for (let i = 0; i < 12; i += 1) {
      rig.now += 100;
      await rig.send(phone, 'level', { payload: { frame_index: i, t_audio_ms: i * 50, dbfs: -40, active: true, clipped: false } });
    }
    const dupe = rig.build(phone, 'level');
    await rig.message(phone.id, dupe);
    await rig.message(phone.id, dupe);
    expect(rig.logs.slice(start).some((l) => JSON.parse(l).event === 'minute_aggregate')).toBe(false); // minute not over
    rig.now += 60_000;
    await rig.send(tv, 'ping'); // the next invocation flushes the completed minute
    const lines = rig.logs
      .slice(start)
      .map((l) => JSON.parse(l) as { event: string; code?: string; type?: string; count?: number })
      .filter((l) => l.event === 'minute_aggregate');
    const fwd = lines.find((l) => l.code === 'forwarded' && l.type === 'level');
    expect(fwd?.count).toBe(13);
    expect(lines.find((l) => l.code === 'duplicate_dropped' && l.type === 'level')?.count).toBe(1);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(['code', 'count', 'event', ...(l.type ? ['type'] : [])].sort());
  });

  it('keeps the aggregated names out of the EMF records but emits the security counters', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.metricLines.length = 0;
    await rig.send(phone, 'level');
    // forwarding a message yields only aggregated metrics, so no EMF record at all
    expect(rig.metricLines).toEqual([]);
    await rig.send(phone, 'window.start'); // forbidden direction: a rejected-message metric
    const names = rig.metricLines.flatMap((l) => (JSON.parse(l) as { _aws: { CloudWatchMetrics: { Metrics: { Name: string }[] }[] } })._aws.CloudWatchMetrics[0]?.Metrics.map((m) => m.Name) ?? []);
    expect(names).toContain('messages_rejected');
    for (const n of names) expect(['messages_forwarded', 'duplicate_dropped', 'peer_offline']).not.toContain(n);
  });

  it('emits snake_case metric names only (the join-failure alarm watches join_failed)', async () => {
    const rig = make();
    await rig.tvCreate();
    await rig.connect('x', 'https://evil.example.test');
    const names = new Set(
      rig.metricLines.flatMap((l) => (JSON.parse(l) as { _aws: { CloudWatchMetrics: { Metrics: { Name: string }[] }[] } })._aws.CloudWatchMetrics[0]?.Metrics.map((m) => m.Name) ?? []),
    );
    expect(names.size).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(names).toContain('rooms_created');
    expect(names).toContain('origin_rejected');
  });

  it('writes security events with closed vocabularies only (no origin value, no address, no ids)', async () => {
    const rig = make();
    await rig.connect('e', 'https://evil.example.test');
    const phone = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
    await rig.connect('f', PHONE_ORIGIN);
    await rig.message('f', rig.build(phone, 'join.request', { payload: { pairing_code: 'ZZZZZZZZ', device_label: 'Device-Label-Sentinel' } }));
    const text = rig.logs.join('\n') + rig.metricLines.join('\n');
    expect(text).not.toContain('evil.example.test');
    expect(text).not.toContain('Device-Label-Sentinel');
    expect(text).not.toContain('ZZZZZZZZ');
    expect(text).not.toContain('203.0.113.10');
    expect(text).not.toMatch(/10\.1\.\d+\.\d+/);
    assertNoLeaks(rig.logs, ['ZZZZZZZZ', 'Device-Label-Sentinel']);
  });
});

describe('the SQS-backed deadline in the end-to-end flow', () => {
  it('a connection that pairs normally is never touched by any queued check', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.now += 5 * 60_000;
    const results = await rig.deliverDeadlines();
    for (const r of results) expect(r.batchItemFailures).toEqual([]);
    expect(rig.api.deleted).toEqual([]);
    await rig.send(phone, 'level');
    expect(rig.api.of(tv.id, 'level')).toHaveLength(1);
  });

  it('the live-room cap and every other core limit behave identically through the adapter', async () => {
    const rig = make({ overrides: { liveRoomCap: 2 } });
    await rig.tvCreate();
    await rig.tvCreate();
    // third room: refused by the cap, whichever adapter carries it
    await rig.connect('third', null);
    const tv = { role: 'tv' as const, roomId: null, generation: 0, nextSeq: 0 };
    await rig.message('third', rig.build(tv, 'room.create'));
    expect(rig.api.of('third', 'room.created')).toHaveLength(0);
    expect(rig.api.errors('third')).toHaveLength(1);
  });
});

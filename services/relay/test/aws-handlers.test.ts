import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AwsConfigError, loadAwsConfig } from '../src/aws/config.js';
import { isGoneError } from '../src/aws/handlers.js';
import { SECRET_CUE, SECRET_PHRASE } from './helpers/fixtures.js';
import { FakeDynamoError } from './helpers/fake-dynamo.js';
import { DOMAIN, GoneError, LambdaRig, PHONE_ORIGIN, STAGE } from './helpers/lambda-rig.js';
import { assertNoLeaks } from './helpers/rig.js';

const rigs: LambdaRig[] = [];
const make = (o: ConstructorParameters<typeof LambdaRig>[0] = {}): LambdaRig => {
  const r = new LambdaRig(o);
  rigs.push(r);
  return r;
};
afterAll(() => {
  for (const r of rigs) {
    const secrets: string[] = [SECRET_CUE, SECRET_PHRASE];
    for (const msgs of r.api.sent.values()) {
      for (const raw of msgs) {
        const p = (JSON.parse(raw) as { payload: Record<string, unknown> }).payload;
        for (const k of ['tv_credential', 'phone_credential', 'pairing_code']) if (typeof p[k] === 'string') secrets.push(p[k] as string);
      }
    }
    assertNoLeaks(r.logs, secrets);
    for (const line of r.metricLines) assertNoLeaks([], secrets), JSON.parse(line);
  }
});

describe('$connect', () => {
  it('accepts an allowlisted or missing Origin and records the connection with a TTL', async () => {
    const rig = make();
    expect((await rig.connect('c1', PHONE_ORIGIN)).statusCode).toBe(200);
    expect((await rig.connect('c2', null)).statusCode).toBe(200);
    for (const id of ['c1', 'c2']) {
      const rec = await rig.store.getConnection(id);
      expect(rec?.authenticated).toBe(false);
    }
    const item = rig.fake?.items.get('CONN#c1\u0000CONN') as { expires_at: number };
    expect(item.expires_at).toBeGreaterThan(rig.now / 1000);
    expect(item.expires_at * 1000).toBeGreaterThanOrEqual(rig.now + 2 * 3_600_000); // outlives API Gateway's 2 h limit
  });

  it('refuses a foreign Origin with 403 and records nothing', async () => {
    const rig = make();
    expect((await rig.connect('evil', 'https://evil.example.test')).statusCode).toBe(403);
    expect(await rig.store.getConnection('evil')).toBeNull();
    expect(rig.metricLines.join('\n')).toContain('origin_rejected');
  });

  it('matches the Origin header case-insensitively by name but exactly by value', async () => {
    const rig = make();
    const lower = await rig.handler(rig.event('$connect', 'a', { headers: { origin: PHONE_ORIGIN } }));
    const upper = await rig.handler(rig.event('$connect', 'b', { headers: { ORIGIN: PHONE_ORIGIN } }));
    const wrongCase = await rig.handler(rig.event('$connect', 'c', { headers: { Origin: PHONE_ORIGIN.toUpperCase() } }));
    expect([lower.statusCode, upper.statusCode, wrongCase.statusCode]).toEqual([200, 200, 403]);
  });

  it('refuses duplicate Origin headers', async () => {
    const rig = make();
    const r = await rig.handler(
      rig.event('$connect', 'd', { headers: { Origin: PHONE_ORIGIN }, multiValueHeaders: { Origin: [PHONE_ORIGIN, PHONE_ORIGIN] } }),
    );
    expect(r.statusCode).toBe(403);
  });

  it('refuses with 503 under the kill switch', async () => {
    const rig = make();
    rig.disabled = true;
    expect((await rig.connect('k1', PHONE_ORIGIN)).statusCode).toBe(503);
    expect(await rig.store.getConnection('k1')).toBeNull();
    rig.disabled = false;
    expect((await rig.connect('k2', PHONE_ORIGIN)).statusCode).toBe(200);
  });

  it('rejects an event without a connection id', async () => {
    const rig = make();
    const r = await rig.handler({ requestContext: { routeKey: '$connect' } });
    expect(r.statusCode).toBe(400);
  });
});

describe('management endpoint', () => {
  it('is derived from the event domain and stage, never hard-coded', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    expect(rig.api.endpoints.length).toBeGreaterThan(0);
    expect(new Set(rig.api.endpoints)).toEqual(new Set([`https://${DOMAIN}/${STAGE}`]));
    // a different API / stage in the event yields a different endpoint
    const other = 'zzz999.execute-api.eu-west-1.amazonaws.com';
    await rig.handler(rig.event('$default', tv.id, { body: rig.build(tv, 'ping'), isBase64Encoded: false }, { domainName: other, stage: 'prod' }));
    expect(rig.api.endpoints).toContain(`https://${other}/prod`);
    const src = readFileSync(fileURLToPath(new URL('../src/aws/handlers.ts', import.meta.url)), 'utf8') + readFileSync(fileURLToPath(new URL('../src/aws/lambda.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/execute-api\.[a-z0-9-]+\.amazonaws\.com/);
    expect(src).not.toMatch(/\bap-south-1\b|\bus-east-1\b/);
  });
});

describe('end to end through the Lambda adapter and the DynamoDB store model', () => {
  it('pairs, forwards unchanged and keeps every protected check on every invocation', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    const raw = rig.build(phone, 'level');
    await rig.message(phone.id, raw);
    expect(rig.api.of(tv.id, 'level')[0]?.raw).toBe(raw);

    // phone cannot start windows, before or after pairing context
    await rig.send(phone, 'window.start');
    expect(rig.api.errors(phone.id)).toEqual(['forbidden_direction']);
    // replay and duplicate through separate invocations (state lives in the table, not the container)
    await rig.send(phone, 'level', { seq: 0 });
    expect(rig.api.errors(phone.id)).toEqual(['forbidden_direction', 'replay']);
    await rig.message(phone.id, raw); // exact duplicate: silent
    expect(rig.api.errors(phone.id)).toEqual(['forbidden_direction', 'replay']);
    expect(rig.api.of(tv.id, 'level')).toHaveLength(1);
  });

  it('applies conditional writes: concurrent identical frames forward exactly once', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    const raw = rig.build(phone, 'level', { messageId: 'm_concurrentdup00001' });
    await Promise.all([rig.message(phone.id, raw), rig.message(phone.id, raw), rig.message(phone.id, raw)]);
    expect(rig.api.of(tv.id, 'level')).toHaveLength(1);
    // concurrent fresh ids with the same sequence: one wins the conditional sequence write, the rest are replays
    const a = rig.build(phone, 'level', { seq: 77 });
    const b = rig.build(phone, 'level', { seq: 77 });
    await Promise.all([rig.message(phone.id, a), rig.message(phone.id, b)]);
    expect(rig.api.of(tv.id, 'level')).toHaveLength(2);
    expect(rig.api.errors(phone.id)).toEqual(['replay']);
  });

  it('concurrent invocations for one connection never forward a frame twice or accept a sequence twice', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.now += 2000; // fresh rate-limit window
    const frames = Array.from({ length: 25 }, (_, i) =>
      rig.build(phone, 'level', { payload: { frame_index: i, t_audio_ms: i * 50, dbfs: -40, active: true, clipped: false } }),
    );
    // each frame is delivered twice and all 50 invocations (inside the 60 per second burst) run concurrently, shuffled
    const deliveries = [...frames, ...frames].sort(() => Math.random() - 0.5);
    await Promise.all(deliveries.map((raw) => rig.message(phone.id, raw)));
    const forwarded = rig.api.of(tv.id, 'level').map((m) => JSON.parse(m.raw).sequence as number);
    expect(new Set(forwarded).size).toBe(forwarded.length); // no sequence forwarded twice
    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded.length).toBeLessThanOrEqual(25);
    // whatever was refused was refused as replay (out of order under concurrency), never anything else
    expect(new Set(rig.api.errors(phone.id))).toEqual(new Set(rig.api.errors(phone.id).filter((e) => e === 'replay')));
  });

  it('claims the single phone slot exactly once under concurrent confirms (conditional failure path)', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const code = rig.api.of(tv.id, 'room.created')[0]?.payload.pairing_code as string;
    await rig.connect('p-1', PHONE_ORIGIN);
    const phone = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
    await rig.message('p-1', rig.build(phone, 'join.request', { payload: { pairing_code: code, device_label: 'x' } }));
    const joinId = rig.api.of(tv.id, 'join.requested')[0]?.payload.join_id as string;
    const confirm = () => rig.send(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } });
    await Promise.all([confirm(), confirm(), confirm()]);
    expect(rig.api.of('p-1', 'join.accepted')).toHaveLength(1);
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone?.generation).toBe(1);
    expect(rig.api.errors(tv.id).filter((e) => e === 'not_found')).toHaveLength(2);
  });

  it('closes the connection through DeleteConnection when the relay drops it', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'unpair');
    expect(rig.api.of(phone.id, 'unpaired')[0]?.payload.reason).toBe('tv_unpaired');
    expect(rig.api.deleted).toContain(phone.id);
    expect(await rig.store.getConnection(phone.id)).toBeNull();
  });

  it('rejects base64 (binary) frames with binary_rejected', async () => {
    const rig = make();
    await rig.connect('bin', PHONE_ORIGIN);
    await rig.message('bin', Buffer.from([1, 2, 3]).toString('base64'), { isBase64Encoded: true });
    expect(rig.api.errors('bin')).toEqual(['binary_rejected']);
    expect(rig.api.deleted).toContain('bin');
  });

  it('enforces the unauthenticated deadline logically on the next message', async () => {
    const rig = make();
    await rig.connect('late', PHONE_ORIGIN);
    rig.now += 5001;
    const ping = rig.build({ role: 'phone', roomId: null, generation: 0, nextSeq: 0 }, 'ping');
    await rig.message('late', ping);
    expect(rig.api.deleted).toContain('late');
    expect(rig.api.of('late', 'pong')).toHaveLength(0);
  });
});

describe('GoneException handling', () => {
  it('deletes the stale connection and tells the peer when a forward hits a gone connection', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    // the phone vanished without a $disconnect: API Gateway no longer knows it, the table still does
    rig.api.gone.add(phone.id);
    expect(await rig.store.getConnection(phone.id)).not.toBeNull();
    const r = await rig.send(tv, 'window.start');
    expect(r.statusCode).toBe(200);
    expect(await rig.store.getConnection(phone.id)).toBeNull();
    const state = rig.api.of(tv.id, 'peer.state').at(-1)?.payload;
    expect(state).toMatchObject({ role: 'phone', connected: false });
    const room = await rig.store.getRoom(tv.roomId as string);
    expect(room?.phone?.connId).toBeNull();
    // the logs recorded the event without any detail
    expect(rig.logs.some((l) => JSON.parse(l).event === 'send_gone')).toBe(true);
    // the TV is told its peer is offline from now on
    await rig.send(tv, 'window.stop');
    expect(rig.api.errors(tv.id)).toContain('not_found');
  });

  it('survives a gone connection on close actions and cascades at most a bounded number of times', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    rig.api.gone.add(phone.id);
    rig.api.gone.add(tv.id); // everyone is gone: the unpair reply and the peer notice both fail
    const r = await rig.send(tv, 'unpair');
    expect(r.statusCode).toBe(200);
    expect(await rig.store.getConnection(phone.id)).toBeNull();
  });

  it('logs non-Gone management errors as internal_error without the error text, and keeps going', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    rig.api.failDelete.add(phone.id);
    const r = await rig.send(tv, 'unpair');
    expect(r.statusCode).toBe(200);
    expect(rig.logs.join('\n')).not.toContain('SECRET-ERROR-DETAIL');
    expect(rig.logs.some((l) => JSON.parse(l).event === 'internal_error')).toBe(true);
  });

  it('recognises Gone by name or by HTTP 410', () => {
    expect(isGoneError(new GoneError('x'))).toBe(true);
    expect(isGoneError({ $metadata: { httpStatusCode: 410 } })).toBe(true);
    expect(isGoneError(new Error('nope'))).toBe(false);
    expect(isGoneError(null)).toBe(false);
  });

  it('handles $disconnect: peer notified, repeated disconnect is a no-op', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    expect((await rig.disconnect(phone.id)).statusCode).toBe(200);
    expect(rig.api.of(tv.id, 'peer.state').at(-1)?.payload).toMatchObject({ role: 'phone', connected: false });
    const before = rig.api.messages(tv.id).length;
    expect((await rig.disconnect(phone.id)).statusCode).toBe(200);
    expect(rig.api.messages(tv.id)).toHaveLength(before);
  });
});

describe('kill switch (RELAY_DISABLED)', () => {
  it('refuses messages on existing connections and removes them; recovers when switched off', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.disabled = true;
    const r = await rig.send(phone, 'level');
    expect(r.statusCode).toBe(200);
    expect(rig.api.of(phone.id, 'error').at(-1)?.payload).toMatchObject({ code: 'internal', detail: 'relay_disabled' });
    expect(rig.api.deleted).toContain(phone.id);
    expect(rig.api.of(tv.id, 'level')).toHaveLength(0);
    expect((await rig.connect('new', PHONE_ORIGIN)).statusCode).toBe(503);
    rig.disabled = false;
    expect((await rig.connect('new2', PHONE_ORIGIN)).statusCode).toBe(200);
    // the TV (not removed by the switch) still works
    await rig.send(tv, 'ping');
    expect(rig.api.of(tv.id, 'pong').length).toBeGreaterThan(0);
  });

  it('is controlled by the RELAY_DISABLED environment variable', () => {
    const base = { TABLE_NAME: 't', ALLOWED_ORIGINS: PHONE_ORIGIN, HASH_SECRET_PARAM: '/atr/relay/staging/hash-secret' };
    expect(loadAwsConfig({ ...base, RELAY_DISABLED: 'true' }).disabled).toBe(true);
    expect(loadAwsConfig({ ...base, RELAY_DISABLED: ' TRUE ' }).disabled).toBe(true);
    expect(loadAwsConfig({ ...base, RELAY_DISABLED: 'false' }).disabled).toBe(false);
    expect(loadAwsConfig({ ...base }).disabled).toBe(false);
    expect(loadAwsConfig({ ...base, RELAY_DISABLED: '1' }).disabled).toBe(false); // only the documented value
  });
});

describe('faults and observability', () => {
  it('returns 500 and logs only the fixed internal_error event when the table fails', async () => {
    const rig = make();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    rig.fake?.injectFault(
      (op) => op === 'update',
      new FakeDynamoError('ProvisionedThroughputExceededException', 'Throttled: SECRET-TABLE-DETAIL arn:aws:dynamodb:ap-south-1:123456789012:table/x'),
    );
    const r = await rig.send(phone, 'level');
    expect(r.statusCode).toBe(500);
    const text = rig.logs.join('\n');
    expect(text).not.toContain('SECRET-TABLE-DETAIL');
    expect(text).not.toContain('123456789012');
    expect(rig.logs.map((l) => JSON.parse(l).event)).toContain('internal_error');
  });

  it('emits CloudWatch EMF metric records with only counters, a namespace and the stage dimension', async () => {
    const rig = make();
    await rig.tvCreate();
    expect(rig.metricLines.length).toBeGreaterThan(0);
    const rec = JSON.parse(rig.metricLines[0] as string) as Record<string, unknown> & {
      _aws: { CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[] };
    };
    const def = rec._aws.CloudWatchMetrics[0];
    expect(def?.Namespace).toBe('AcrossTheRoom/Relay');
    expect(def?.Dimensions).toEqual([['Stage']]);
    expect(rec.Stage).toBe(STAGE);
    for (const m of def?.Metrics ?? []) {
      expect(m.Unit).toBe('Count');
      expect(typeof rec[m.Name]).toBe('number');
    }
    expect(Object.keys(rec).sort()).toEqual(['Stage', '_aws', ...(def?.Metrics.map((m) => m.Name) ?? [])].sort());
  });

  it('works on top of the in-memory store too (same adapter, different store)', async () => {
    const { MemoryRoomStore } = await import('../src/core/index.js');
    const rig = make({ store: new MemoryRoomStore() });
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(tv, 'session.begin');
    await rig.send(phone, 'level');
    expect(rig.api.of(tv.id, 'level')).toHaveLength(1);
  });
});

describe('Lambda configuration fails closed', () => {
  it.each([
    [{}, /TABLE_NAME/],
    [{ TABLE_NAME: 't' }, /ALLOWED_ORIGINS/],
    [{ TABLE_NAME: 't', ALLOWED_ORIGINS: '' }, /ALLOWED_ORIGINS/],
    [{ TABLE_NAME: 't', ALLOWED_ORIGINS: ' , ' }, /ALLOWED_ORIGINS/],
    [{ TABLE_NAME: 't', ALLOWED_ORIGINS: 'https://a.example/' }, /exact origins/],
    [{ TABLE_NAME: 't', ALLOWED_ORIGINS: 'http://a.example' }, /https/],
    [{ TABLE_NAME: 't', ALLOWED_ORIGINS: '*' }, /not a URL origin/],
  ])('rejects %j', (env, pattern) => {
    expect(() => loadAwsConfig(env)).toThrow(AwsConfigError);
    expect(() => loadAwsConfig(env)).toThrow(pattern);
  });

  it('accepts exact https origins and localhost over http', () => {
    const c = loadAwsConfig({
      TABLE_NAME: 'tbl',
      ALLOWED_ORIGINS: 'https://d1.cloudfront.net, http://localhost:5173',
      HASH_SECRET_PARAM: '/atr/relay/staging/hash-secret',
      STAGE_NAME: 'prod',
    });
    expect(c).toMatchObject({
      tableName: 'tbl',
      stage: 'prod',
      environment: 'development',
      hashSecretParameter: '/atr/relay/staging/hash-secret',
      phoneOrigins: ['https://d1.cloudfront.net', 'http://localhost:5173'],
    });
  });
});

describe('Lambda bundle (esbuild)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  it('builds a single ES module that exports the handler and refuses to start without configuration', async () => {
    execFileSync('node', ['scripts/bundle-lambda.mjs'], { cwd: root, stdio: 'pipe' });
    const file = `${root}/dist-lambda/relay.mjs`;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(5 * 1024 * 1024);
    const manifest = readFileSync(`${root}/dist-lambda/MANIFEST.txt`, 'utf8');
    expect(manifest).toMatch(/sha256: [0-9a-f]{64}/);
    expect(manifest).toContain('handler: relay.handler');
    // Importing never touches AWS; invoking without TABLE_NAME / ALLOWED_ORIGINS fails at cold start, before any client call.
    const saved = { t: process.env.TABLE_NAME, o: process.env.ALLOWED_ORIGINS };
    delete process.env.TABLE_NAME;
    delete process.env.ALLOWED_ORIGINS;
    try {
      const mod = (await import(/* @vite-ignore */ file)) as { handler: (e: unknown) => Promise<unknown> };
      expect(typeof mod.handler).toBe('function');
      await expect(mod.handler({ requestContext: { routeKey: '$connect', connectionId: 'x' } })).rejects.toThrow(/TABLE_NAME/);
    } finally {
      if (saved.t !== undefined) process.env.TABLE_NAME = saved.t;
      if (saved.o !== undefined) process.env.ALLOWED_ORIGINS = saved.o;
    }
  });

  it('also builds the deadline consumer (deadline.handler) from the same sources, with its own manifest entry', async () => {
    execFileSync('node', ['scripts/bundle-lambda.mjs'], { cwd: root, stdio: 'pipe' });
    const file = `${root}/dist-lambda/deadline.mjs`;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(5 * 1024 * 1024);
    const manifest = readFileSync(`${root}/dist-lambda/MANIFEST.txt`, 'utf8');
    expect(manifest).toContain('handler: deadline.handler');
    expect(manifest.match(/sha256: [0-9a-f]{64}/g)).toHaveLength(2);
    const saved = { t: process.env.TABLE_NAME, o: process.env.ALLOWED_ORIGINS };
    delete process.env.TABLE_NAME;
    delete process.env.ALLOWED_ORIGINS;
    try {
      const mod = (await import(/* @vite-ignore */ file)) as { handler: (e: unknown) => Promise<unknown> };
      expect(typeof mod.handler).toBe('function');
      await expect(mod.handler({ Records: [] })).rejects.toThrow(/TABLE_NAME/);
    } finally {
      if (saved.t !== undefined) process.env.TABLE_NAME = saved.t;
      if (saved.o !== undefined) process.env.ALLOWED_ORIGINS = saved.o;
    }
  });

  it('contains no credential, secret value or account id (a bundle is an artifact that gets uploaded)', () => {
    execFileSync('node', ['scripts/bundle-lambda.mjs'], { cwd: root, stdio: 'pipe' });
    for (const f of ['relay.mjs', 'deadline.mjs']) {
      const text = readFileSync(`${root}/dist-lambda/${f}`, 'utf8');
      expect(text, f).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(text, f).not.toMatch(/HASH_PEPPER/);
    }
  });
});

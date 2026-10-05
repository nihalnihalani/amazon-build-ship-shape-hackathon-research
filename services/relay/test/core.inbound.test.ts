/**
 * The inbound path: one entry point (PK-10, SEC-V02), canonical forwarding (PK-04, SEC-V03), dedupe per
 * (room, role) recorded only for accepted messages (PK-08, SEC-A13), the §4 order, and cues tied to the announced
 * session (A4-07). Runs on both stores.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { RelayCore } from '../src/core/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';
import { Rig, assertAllRigsNoLeaks, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

async function paired(overrides = {}): Promise<{ rig: Rig; tv: Client; phone: Client }> {
  const rig = new Rig(overrides);
  const tv = await rig.tvCreate();
  const phone = await rig.pair(tv);
  await rig.startSession(tv);
  rig.advance(1000); // a fresh rate window
  tv.clear();
  phone.clear();
  return { rig, tv, phone };
}

describe('one inbound entry point: processInbound (PK-10, SEC-V02)', () => {
  const src = (p: string): string => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
  const STEP_FUNCTIONS = [
    'parseWireMessage',
    'parseWireText',
    'validateMessageObject',
    'isAllowedSender',
    'forwardTarget',
    'isPreAuthType',
    'SequenceTracker',
    'MessageIdDedupe',
    'DedupeScopes',
    'recordMessageId',
    'acceptSequence',
  ];

  it('the core exposes processInbound and no other way to hand it a frame', () => {
    expect(typeof RelayCore.prototype.processInbound).toBe('function');
    expect((RelayCore.prototype as unknown as Record<string, unknown>).onMessage).toBeUndefined();
  });

  it.each(['local/server.ts', 'aws/handlers.ts', 'aws/lambda.ts', 'aws/deadline-lambda.ts', 'aws/runtime.ts'])(
    '%s calls none of the §4 step functions itself',
    (file) => {
      const text = src(file);
      for (const f of STEP_FUNCTIONS) expect(text.includes(f), `${file} mentions ${f}`).toBe(false);
    },
  );

  it('both adapters hand every inbound frame to processInbound, and only that', () => {
    expect(src('local/server.ts')).toMatch(/core\.processInbound\(/);
    expect(src('aws/handlers.ts')).toMatch(/c\.processInbound\(/);
    for (const f of ['local/server.ts', 'aws/handlers.ts']) expect(src(f)).not.toMatch(/\.onMessage\(/);
  });

  it('no JSON.parse of network data exists in the relay outside the protocol package (the one SQS body parse is internal)', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(new URL(`../src/${dir}`, import.meta.url), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}${e.name}/`);
        else if (e.name.endsWith('.ts')) files.push(`${dir}${e.name}`);
      }
    };
    walk('');
    const parsing = files.filter((f) => /JSON\.parse\(/.test(src(f)));
    expect(parsing).toEqual(['aws/handlers.ts']);
    const lines = src('aws/handlers.ts').split('\n').filter((l) => /JSON\.parse\(/.test(l));
    expect(lines).toHaveLength(1);
    // the deadline queue message the relay itself wrote, validated by parseDeadlineBody before use
    expect(src('aws/handlers.ts')).toMatch(/function parseDeadlineBody[\s\S]*?JSON\.parse\(raw\)/);
  });

  it('adapters read the frame type before any decode: the binary marker carries only a size', () => {
    const local = src('local/server.ts');
    expect(local).toMatch(/isBinary \? \{ binary: true, bytes \} : rawToString\(data\)/);
    const aws = src('aws/handlers.ts');
    expect(aws).not.toMatch(/Buffer\.from\(/);
    expect(aws).not.toMatch(/atob\(/);
    expect(aws).toMatch(/isBase64Encoded === true/);
  });
});

describe('forwarding the canonical clean copy (PK-04, SEC-V03)', () => {
  it('the peer receives JSON.stringify of the validated message, never the received bytes', async () => {
    const { rig, tv, phone } = await paired();
    const original = rig.buildMessage(phone, 'level');
    const parsed = JSON.parse(original) as Record<string, unknown>;
    const variants = [
      JSON.stringify(parsed, null, 2), // whitespace
      original.replace('"active":true', '"active":false,"active":true'), // duplicate key (last wins)
      original.replace('"type":"level"', '"type":"l\\u0065vel"'), // escaped letters
      ` ${original} `, // surrounding whitespace
    ];
    for (const v of variants) {
      expect(v).not.toBe(original);
      tv.clear();
      // every variant needs a fresh id and sequence to be accepted
      const fresh = (JSON.parse(v.trim()) as Record<string, unknown>);
      void fresh;
      await rig.sendRaw(phone, v.replace(parsed.message_id as string, `m_variant${Math.random().toString(36).slice(2, 12)}00`).replace(/"sequence":\d+/, `"sequence":${phone.nextSeq++}`));
      expect(tv.of('level'), 'variant forwarded').toHaveLength(1);
      const got = tv.last('level').raw;
      expect(got).toBe(JSON.stringify(JSON.parse(got))); // compact canonical form
      expect(got).not.toContain('\\u0065');
      expect((got.match(/"active"/g) ?? []).length).toBe(1);
      rig.advance(200);
    }
  });

  it('a frame with a duplicate type key is processed as the validator saw it, and nothing of the first value is forwarded', async () => {
    const { rig, tv, phone } = await paired();
    const m = rig.buildMessage(phone, 'level');
    // {"type":"ping", ... "type":"level"}: JSON.parse keeps the last, which is what the validator validated
    const dup = m.replace('"type":"level"', '"type":"ping","type":"level"');
    await rig.sendRaw(phone, dup);
    expect(tv.of('level')).toHaveLength(1);
    expect(tv.of('level')[0]?.raw).toBe(m);
    expect(phone.of('pong')).toHaveLength(0);
    expect(tv.inbox.some((x) => x.raw.includes('"ping"'))).toBe(false);
  });

  it('the canonical frame is never larger than the received one and stays under 8192 bytes', async () => {
    const { rig, tv, phone } = await paired();
    const padded = rig.buildMessage(phone, 'cue', { payload: { text: 'hello' } });
    const spaced = padded.replace('{', `{${' '.repeat(8192 - Buffer.byteLength(padded))}`);
    expect(Buffer.byteLength(spaced)).toBe(8192);
    await rig.sendRaw(phone, spaced);
    expect(Buffer.byteLength(tv.last('cue').raw)).toBeLessThan(Buffer.byteLength(spaced));
  });
});

describe('duplicate ids are scoped per (room, role) and only accepted messages keep theirs (PK-08, SEC-A13)', () => {
  it('the same message_id from the TV and from the phone are two different messages', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'session.state', { messageId: 'm_sharedid000000001' });
    await rig.send(phone, 'mic.state', { messageId: 'm_sharedid000000001' });
    expect(phone.of('session.state')).toHaveLength(1);
    expect(tv.of('mic.state')).toHaveLength(1);
    expect(rig.metrics.filter((m) => m.name === 'duplicate_dropped')).toHaveLength(0);
  });

  it('the same id in another room is another message', async () => {
    const { rig, phone } = await paired();
    const tv2 = await rig.tvCreate();
    const phone2 = await rig.pair(tv2);
    await rig.startSession(tv2, 's_session000002');
    rig.advance(1000);
    tv2.clear();
    await rig.send(phone, 'level', { messageId: 'm_crossroom0000001' });
    await rig.send(phone2, 'level', { messageId: 'm_crossroom0000001', session: 's_session000002' });
    expect(tv2.of('level')).toHaveLength(1);
  });

  it('a rate-limited message does not burn its id: the retransmission is forwarded', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 60; i += 1) await rig.send(phone, 'level');
    await rig.send(phone, 'level', { messageId: 'm_ratelimited000001' }); // 61st in the second
    expect(phone.errors()).toEqual(['rate_limited']);
    rig.advance(1000);
    tv.clear();
    await rig.send(phone, 'level', { messageId: 'm_ratelimited000001' });
    expect(tv.of('level')).toHaveLength(1);
    expect(rig.metrics.filter((m) => m.name === 'duplicate_dropped')).toHaveLength(0);
  });

  it('a replay-rejected message does not burn its id', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { seq: 5 });
    await rig.send(phone, 'level', { seq: 3, messageId: 'm_replayedid000001' });
    expect(phone.errors()).toEqual(['replay']);
    tv.clear();
    await rig.send(phone, 'level', { seq: 6, messageId: 'm_replayedid000001' });
    expect(tv.of('level')).toHaveLength(1);
  });

  it('a stale-generation message does not burn its id', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { gen: 99, messageId: 'm_staleid000000001' });
    expect(phone.errors()).toEqual(['stale']);
    tv.clear();
    await rig.send(phone, 'level', { messageId: 'm_staleid000000001' });
    expect(tv.of('level')).toHaveLength(1);
  });

  it('a cue refused at the cue limit does not burn its id, and an accepted message does keep it', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 3; i += 1) await rig.send(phone, 'cue', { messageId: `m_cueaccepted00000${i}` });
    await rig.send(phone, 'cue', { messageId: 'm_cuerefused0000001' });
    expect(phone.errors()).toEqual(['cue_limit']);
    tv.clear();
    await rig.send(phone, 'cue', { messageId: 'm_cueaccepted000000', seq: 99 }); // an accepted id: duplicate, silently dropped
    expect(tv.of('cue')).toHaveLength(0);
    expect(rig.metrics.filter((m) => m.name === 'duplicate_dropped')).toHaveLength(1);
  });

  it('counts a dropped duplicate per message type in the metric, with no error and no ack', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'level', { messageId: 'm_dupe000000000001' });
    phone.clear();
    await rig.send(phone, 'level', { messageId: 'm_dupe000000000001' });
    expect(phone.inbox).toEqual([]);
    expect(rig.metrics).toContainEqual({ name: 'duplicate_dropped', value: 1, type: 'level' });
  });
});

describe('PROTOCOL.md section 4 order of checks', () => {
  it('size before JSON: an oversized invalid frame is payload_too_large, not bad_schema', async () => {
    const { rig, phone } = await paired();
    await rig.sendRaw(phone, `{${'x'.repeat(9000)}`);
    expect(phone.lastError().payload.code).toBe('payload_too_large');
  });

  it('unknown type beats the audio guard, which beats envelope formats, which beat the payload schema', async () => {
    const { rig, phone } = await paired();
    const base = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
    const level = base.payload as Record<string, unknown>;
    await rig.sendRaw(phone, JSON.stringify({ ...base, type: 'nope', message_id: 'bad', payload: { audio: 'x' } }));
    expect(phone.lastError().payload.code).toBe('unknown_type');
    await rig.sendRaw(phone, JSON.stringify({ ...base, message_id: 'bad', payload: { ...level, audio: 'x' } }));
    expect(phone.lastError().payload.code).toBe('audio_rejected');
    await rig.sendRaw(phone, JSON.stringify({ ...base, message_id: 'bad', payload: { nonsense: true } }));
    expect(phone.lastError().payload.code).toBe('bad_schema');
    expect(phone.lastError().payload.detail).toMatch(/message_id/);
  });

  it('the schema is checked before authentication: an unauthenticated invalid message is bad_schema, a valid one unauthenticated', async () => {
    const rig = new Rig();
    const c = await rig.connect('https://phone.example.test');
    c.role = 'phone';
    await rig.send(c, 'level', { payload: { nope: 1 }, roomId: 'r_aaaaaaaaaaaaaaaaaaaaaa' });
    expect(c.lastError().payload.code).toBe('bad_schema');
    await rig.send(c, 'level', { roomId: 'r_aaaaaaaaaaaaaaaaaaaaaa' });
    expect(c.lastError().payload.code).toBe('unauthenticated');
  });

  it('direction comes before generation and sequence, and the rate limit before the duplicate check', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'window.start', { gen: 99, seq: 0 }); // wrong direction AND stale
    expect(phone.lastError().payload.code).toBe('forbidden_direction');
    await rig.send(phone, 'level', { seq: 5, messageId: 'm_order00000000001' });
    for (let i = 0; i < 59; i += 1) await rig.send(phone, 'level', { seq: 10 + i });
    phone.clear();
    // 61st message of the second, which is also an exact duplicate: the rate limit answers first
    await rig.send(phone, 'level', { seq: 5, messageId: 'm_order00000000001' });
    expect(phone.errors()).toEqual(['rate_limited']);
  });

  it('a duplicate id is dropped silently even when its generation is wrong or its sequence is old', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'level', { seq: 7, messageId: 'm_dupfirst00000001' });
    phone.clear();
    await rig.send(phone, 'level', { seq: 1, messageId: 'm_dupfirst00000001' });
    await rig.send(phone, 'level', { seq: 9, gen: 3, messageId: 'm_dupfirst00000001' });
    expect(phone.inbox).toEqual([]);
  });
});

describe('cues are capped per room and tied to the session announced in session.begin (A4-07, SEC-T08)', () => {
  it('counts against the session id of session.begin; a new announcement starts a new budget; the old id is stale', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 3; i += 1) await rig.send(phone, 'cue');
    await rig.send(phone, 'cue');
    expect(phone.errors()).toEqual(['cue_limit']);
    await rig.send(tv, 'session.begin', { session: 's_session000002' });
    await rig.send(phone, 'cue', { session: 's_session000002' });
    await rig.send(phone, 'cue'); // the first session's id no longer matches
    expect(phone.errors()).toEqual(['cue_limit', 'stale']);
    expect(tv.of('cue')).toHaveLength(4);
  });

  it('is enforced even when session binding is switched off for other messages', async () => {
    const { rig, tv, phone } = await paired({ bindSessions: false });
    await rig.send(phone, 'level', { session: 's_anythingelse1' }); // unbound types pass with any session id
    expect(tv.of('level')).toHaveLength(1);
    await rig.send(phone, 'cue', { session: 's_anythingelse1' });
    expect(phone.errors()).toEqual(['stale']);
    await rig.send(phone, 'cue');
    expect(tv.of('cue')).toHaveLength(1);
  });

  it('rejects a cue when no session was announced, and stores no cue text', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(phone, 'cue', { payload: { text: VALID_PAYLOADS.cue?.text as string } });
    expect(phone.errors()).toEqual(['stale']);
    const dump = JSON.stringify(rig.fake ? [...rig.fake.items.values()] : await rig.store.getRoom(tv.roomId as string));
    expect(dump).not.toContain(VALID_PAYLOADS.cue?.text as string);
  });
});

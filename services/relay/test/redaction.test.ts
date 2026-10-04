import { describe, expect, it } from 'vitest';
import { PHONE_FORWARD_TYPES, SECRET_CUE, SECRET_LABEL, SECRET_PHRASE, TV_FORWARD_TYPES, VALID_PAYLOADS } from './helpers/fixtures.js';
import { PHONE_ORIGIN, Rig, assertNoLeaks, type Client } from './helpers/rig.js';

const SOURCES = ['198.51.100.7', '203.0.113.9', '203.0.113.44'];

/** Drives every message type and a broad set of failure paths with sentinel content, then scans all log output. */
async function fullScenario(rig: Rig): Promise<{ extra: string[] }> {
  const extra: string[] = [SECRET_PHRASE, SECRET_CUE, SECRET_LABEL, ...SOURCES];
  const tv = await rig.tvCreate(null, SOURCES[0]);
  const phone = await rig.pair(tv, { deviceLabel: SECRET_LABEL, source: SOURCES[1] });
  await rig.startSession(tv);
  for (const t of TV_FORWARD_TYPES) if (t !== 'session.end') await rig.send(tv, t);
  for (const t of PHONE_FORWARD_TYPES) await rig.send(phone, t);
  await rig.send(phone, 'phrases.update', { payload: { phrases: [SECRET_PHRASE, `${SECRET_PHRASE} two`] } });
  for (let i = 0; i < 4; i += 1) await rig.send(phone, 'cue', { payload: { text: `${SECRET_CUE}${i}` } }); // 4th: cue_limit
  extra.push(`${SECRET_CUE}0`, `${SECRET_CUE}3`);
  await rig.send(tv, 'ack');
  await rig.send(tv, 'session.end'); // after the phone-side traffic: later session-bound frames are stale
  await rig.send(phone, 'ping');
  await rig.send(tv, 'ping');
  await rig.send(tv, 'pairing.refresh');
  extra.push(String(tv.last('pairing.code').payload.pairing_code));

  // failure paths: content in rejected messages must not leak either
  await rig.sendRaw(phone, `{"protocol_version":1,"secret":"${SECRET_PHRASE}"`); // invalid JSON
  await rig.send(phone, 'cue', { payload: { text: SECRET_PHRASE + SECRET_PHRASE } }); // too long
  await rig.send(phone, 'level', { payload: { ...(VALID_PAYLOADS.level as object), audio: SECRET_PHRASE } });
  await rig.send(phone, 'phrases.update', { payload: { phrases: [SECRET_PHRASE.repeat(20)] } });
  await rig.send(phone, 'window.start');
  await rig.send(tv, 'level');
  await rig.send(phone, 'level', { senderRole: 'tv' });
  await rig.send(phone, 'level', { seq: 0 });
  await rig.send(phone, 'level', { session: 's_unknownsession1' });
  await rig.send(phone, 'level', { roomId: 'r_otherroomotherroom1' });
  const m = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
  await rig.sendRaw(phone, JSON.stringify({ ...m, type: `${SECRET_PHRASE}-type` }));
  await rig.sendRaw(phone, JSON.stringify({ ...m, message_id: m.message_id, [SECRET_PHRASE]: 1 }));
  // attacker paths: brute force, wrong credentials, origin violations
  for (let i = 0; i < 4; i += 1) {
    const a = await rig.connect(PHONE_ORIGIN, SOURCES[2]);
    a.role = 'phone';
    for (let j = 0; j < 3 && !a.closed; j += 1) {
      const wrong = 'AAAAA' + 'ACDEFH'[(i + j) % 6];
      extra.push(wrong);
      await rig.send(a, 'join.request', { payload: { pairing_code: wrong, device_label: SECRET_LABEL } });
    }
  }
  const noOrigin = await rig.connect(null, SOURCES[2]);
  noOrigin.role = 'phone';
  await rig.send(noOrigin, 'join.request', { payload: { pairing_code: 'ACDEFH', device_label: SECRET_LABEL } });
  await rig.connect('https://evil.example.test', SOURCES[2]);
  const bad = await rig.connect(null, SOURCES[0]);
  bad.role = 'tv';
  await rig.send(bad, 'auth.resume', { payload: { room_id: tv.roomId as string, role: 'tv', credential: 'Z'.repeat(43) } });
  extra.push('Z'.repeat(43));
  // resume (rotation), refused takeover, supersede, binary, credential reuse, unpair, close, idle, deadline, kill switch
  const refused = await rig.resume(tv.roomId as string, 'phone', phone.credential as string, { source: SOURCES[1] }); // old phone still live
  expect(refused.of('auth.ok')).toHaveLength(0);
  rig.advance(26_000);
  const phone2 = await rig.resume(tv.roomId as string, 'phone', phone.credential as string, { source: SOURCES[1] });
  await rig.sendRaw(phone2, { binary: true, bytes: 10 });
  const phone3 = await rig.resume(tv.roomId as string, 'phone', phone2.credential as string, { source: SOURCES[1] });
  extra.push(phone3.credential as string);
  const replay = await rig.resume(tv.roomId as string, 'phone', phone.credential as string, { source: SOURCES[1] }); // consumed twice over: reuse
  void replay;
  await rig.advance(1);
  await rig.send(tv, 'unpair');
  await rig.tick(30_000);
  const idle = await rig.connect(PHONE_ORIGIN, SOURCES[1]);
  await rig.tick(6_000);
  expect(idle.closed).not.toBeNull();
  rig.disabled = true;
  await rig.connect(PHONE_ORIGIN, SOURCES[1]);
  rig.disabled = false;
  // a rejected join burns the code and pushes a fresh one
  const tvB = await rig.tvCreate(null, SOURCES[2]);
  const codeB = tvB.last('room.created').payload.pairing_code as string;
  extra.push(codeB);
  const joiner = await rig.connect(PHONE_ORIGIN, SOURCES[1]);
  joiner.role = 'phone';
  await rig.send(joiner, 'join.request', { payload: { pairing_code: codeB, device_label: SECRET_LABEL } });
  await rig.send(tvB, 'join.confirm', { payload: { join_id: tvB.last('join.requested').payload.join_id as string, decision: 'reject' } });
  extra.push(String(tvB.last('pairing.code').payload.pairing_code));
  const tv2 = await rig.tvCreate(null, SOURCES[2]);
  await rig.send(tv2, 'room.close');
  void (null as unknown as Client);
  return { extra };
}

describe('log redaction over a full scenario (ADR-0002)', () => {
  it('logs nothing but allowlisted, content-free fields for every message type and failure path (memory store)', async () => {
    const rig = new Rig();
    const { extra } = await fullScenario(rig);
    rig.flushAggregates(true);
    expect(rig.logs.length).toBeGreaterThan(40);
    rig.assertNoLeaks(extra);
    const text = rig.logs.join('\n');
    // full room ids, message ids, device labels, addresses and credentials never appear; only 8-hex prefixes do
    expect(text).not.toMatch(/r_[A-Za-z0-9_-]{16}/);
    expect(text).not.toMatch(/m_[A-Za-z0-9_-]{16}/);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{43}/);
    const events = new Set(rig.logs.map((l) => (JSON.parse(l) as { event: string }).event));
    for (const e of ['room_created', 'join_requested', 'join_accepted', 'join_failed', 'minute_aggregate', 'credential_reuse', 'code_burned', 'message_rejected', 'rate_limited', 'origin_rejected', 'superseded', 'unpaired', 'idle_timeout', 'auth_deadline', 'kill_switch', 'room_closed']) {
      expect(events.has(e), `scenario should have produced a ${e} log line`).toBe(true);
    }
  });

  it('is identical on the DynamoDB store model', async () => {
    (globalThis as { __ATR_STORE?: string }).__ATR_STORE = 'dynamo';
    try {
      const rig = new Rig();
      const { extra } = await fullScenario(rig);
      rig.flushAggregates(true);
      rig.assertNoLeaks(extra);
      // and nothing sensitive was persisted
      const dump = JSON.stringify([...(rig.fake?.items.values() ?? [])]);
      for (const s of [SECRET_PHRASE, SECRET_CUE, SECRET_LABEL, ...rig.secrets]) expect(dump.includes(s), `table holds ${s}`).toBe(false);
    } finally {
      delete (globalThis as { __ATR_STORE?: string }).__ATR_STORE;
    }
  });

  it('writes zero per-message lines for a minute of 100 level frames and exactly one aggregate line (A2-04, SEC-P02)', async () => {
    for (const store of ['memory', 'dynamo']) {
      (globalThis as { __ATR_STORE?: string }).__ATR_STORE = store;
      try {
        const rig = new Rig();
        const tv = await rig.tvCreate();
        const phone = await rig.pair(tv);
        await rig.startSession(tv);
        rig.advance(60_000 - (rig.now % 60_000) + 1); // start of a fresh minute
        await rig.send(tv, 'ping'); // flush anything older
        rig.flushAggregates();
        const before = rig.logs.length;
        for (let i = 0; i < 100; i += 1) {
          rig.advance(100);
          await rig.send(phone, 'level', { payload: { ...(VALID_PAYLOADS.level as object), frame_index: i, t_audio_ms: i * 50 } });
        }
        expect(tv.of('level')).toHaveLength(100);
        expect(rig.logs.length, `${store}: not a single line while the minute is open`).toBe(before);
        rig.advance(60_000);
        rig.flushAggregates();
        const added = rig.logs.slice(before).map((l) => JSON.parse(l) as { event: string; code?: string; type?: string; count?: number });
        expect(added).toEqual([{ event: 'minute_aggregate', code: 'forwarded', type: 'level', count: 100 }]);
        rig.assertNoLeaks();
      } finally {
        delete (globalThis as { __ATR_STORE?: string }).__ATR_STORE;
      }
    }
  });

  it('log-scan helper really detects leaks (guards against a vacuous test)', () => {
    expect(() => assertNoLeaks(['{"event":"connect","code":"expired"}'], ['expired'])).toThrow();
    expect(() => assertNoLeaks(['{"event":"connect","payload":{"text":"x"}}'], [])).toThrow();
    expect(() => assertNoLeaks(['{"event":"connect","room":"ABCDEFGH"}'], [])).toThrow();
    expect(() => assertNoLeaks(['{"event":"connect","room":"0123abcd"}'], [])).not.toThrow();
  });
});

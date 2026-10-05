/**
 * T16 gate, part A: the unauthenticated phase, frame hygiene, canonical forwarding, and role and room isolation.
 * Real local relay process, raw sockets. Evidence class: automated.
 *
 *   SEC-A01  every type before authentication
 *   SEC-A02  pre-auth limits (message count, deadline)
 *   SEC-V02  binary and oversized frames, compression not negotiated
 *   SEC-V03  canonical forwarding (duplicate keys, whitespace and escapes collapse)
 *   SEC-A12  role x type matrix and room isolation
 *   SEC-A13  replay and duplicate handling
 *   SEC-I09  no polling surface
 *
 * The allowed-sender sets below are written by hand from docs/PROTOCOL.md section 3 (direction column); they are
 * not read from the catalogue, so the test does not agree with the implementation by construction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_TYPES, type MessageType } from '@atr/protocol';
import https from 'node:https';
import { DEFAULT_IDS, RawClient, envelope, mid, pairRaw, sleep, startSecRelay, type Paired, type SecRelay } from './helpers.js';

const PRE_ONLY: MessageType[] = ['room.create', 'join.request', 'auth.resume'];
const RELAY_ONLY: MessageType[] = [
  'room.created', 'pairing.code', 'join.pending', 'join.requested', 'join.accepted', 'join.rejected', 'join.expired',
  'auth.ok', 'peer.state', 'unpaired', 'pong', 'error',
];
const TV_SENDS: MessageType[] = [
  'pairing.refresh', 'join.confirm', 'unpair', 'room.close', 'ping', 'session.begin', 'session.state', 'precheck.start',
  'window.start', 'window.stop', 'window.cancel', 'listener.open', 'attempt.reveal', 'session.end', 'ack',
];
const PHONE_SENDS: MessageType[] = ['ping', 'mic.state', 'precheck.result', 'level', 'window.result', 'listener.response', 'cue', 'phrases.update', 'ack'];

const sorted = (a: readonly string[]): string[] => [...a].sort();

describe('SEC-A01..A02 unauthenticated phase', () => {
  let relay: SecRelay;
  let paired: Paired;
  beforeAll(async () => {
    relay = await startSecRelay();
    paired = await pairRaw(relay);
    // A live session so that session-bound phone messages would be forwardable if they were ever let through.
    paired.tv.send('session.begin');
    await paired.phone.client.next('session.begin');
  }, 60_000);
  afterAll(async () => {
    paired?.tv.client.close();
    paired?.phone.client.close();
    await relay?.stop();
  });

  it('sanity: the hand-written sender sets cover all 37 types exactly once', () => {
    const all = [...PRE_ONLY, ...RELAY_ONLY, ...TV_SENDS, ...PHONE_SENDS.filter((t) => t !== 'ping' && t !== 'ack')];
    expect(sorted(all)).toEqual(sorted([...MESSAGE_TYPES]));
  });

  it('SEC-A01: only room.create, join.request, auth.resume and ping are processed before authentication; nothing is forwarded', async () => {
    const nonPre = MESSAGE_TYPES.filter((t) => !['room.create', 'join.request', 'auth.resume', 'ping'].includes(t));
    expect(nonPre).toHaveLength(33);
    const before = paired.tv.client.inbox.length;
    const results: Array<{ type: string; code: string; ref: string | null; sent: string }> = [];
    for (let i = 0; i < nonPre.length; i += 5) {
      const batch = nonPre.slice(i, i + 5);
      const c = await RawClient.open(relay, relay.phoneOrigin);
      const ids = new Map<string, string>();
      for (const type of batch) {
        const id = mid();
        ids.set(id, type);
        // Phone-shaped, room-bound messages aimed at the real room: if any were processed they would reach the TV.
        c.send(
          JSON.stringify(
            envelope(type, { role: type === 'level' || type === 'cue' ? 'phone' : 'tv', roomId: paired.roomId, generation: 1, sequence: 99, messageId: id }),
          ),
        );
      }
      await c.waitUntil(() => c.inbox.filter((m) => m.type === 'error').length >= batch.length, 6000, 'error replies');
      for (const m of c.inbox.filter((x) => x.type === 'error')) {
        results.push({ type: ids.get(String(m.payload['ref_message_id'])) ?? '?', code: String(m.payload['code']), ref: m.payload['ref_message_id'] as string | null, sent: '' });
      }
      expect(c.inbox.filter((m) => m.type !== 'error')).toEqual([]); // no pong, no auth.ok, no room.created, nothing
      c.close();
    }
    expect(results).toHaveLength(33);
    for (const r of results) expect(['unauthenticated', 'forbidden_direction'], `type ${r.type}`).toContain(r.code);
    expect(results.filter((r) => r.code === 'unauthenticated').length).toBeGreaterThanOrEqual(30);
    // The TV, in the room these frames named, received nothing from any of them.
    await sleep(300);
    expect(paired.tv.client.inbox.slice(before)).toEqual([]);
  });

  it('SEC-A02: the 6th unauthenticated message closes the connection (5 allowed)', async () => {
    const c = await RawClient.open(relay, null);
    for (let i = 0; i < 6; i += 1) c.send(JSON.stringify(envelope('ping', { role: 'tv' })));
    const closed = await c.waitClosed(5000);
    expect(closed.code).toBe(4429);
    expect(c.inbox.filter((m) => m.type === 'pong').length).toBeLessThanOrEqual(5);
    const err = c.inbox.find((m) => m.type === 'error');
    expect(err?.payload['code']).toBe('rate_limited');
  });

  it('SEC-A02: an idle unauthenticated connection is closed after about 5 s with auth_deadline', async () => {
    const c = await RawClient.open(relay, null);
    const t0 = Date.now();
    expect(c.isOpen).toBe(true);
    const closed = await c.waitClosed(12_000);
    const elapsed = Date.now() - t0;
    expect(closed.code).toBe(4401);
    expect(elapsed).toBeGreaterThanOrEqual(4000);
    expect(elapsed).toBeLessThan(9000);
    const err = c.inbox.find((m) => m.type === 'error');
    expect(err?.payload['code']).toBe('unauthenticated');
    expect(err?.payload['detail']).toBe('auth_deadline');
  });
});

describe('SEC-V02 frame hygiene, SEC-V03 canonical forwarding, SEC-I09 no polling surface', () => {
  let relay: SecRelay;
  let p: Paired;
  beforeAll(async () => {
    relay = await startSecRelay();
    p = await pairRaw(relay);
    p.tv.send('session.begin');
    await p.phone.client.next('session.begin');
  }, 60_000);
  afterAll(async () => {
    p?.tv.client.close();
    p?.phone.client.close();
    await relay?.stop();
  });

  it('SEC-V03: duplicate keys, extra whitespace and escapes are forwarded as the canonical re-serialisation of the validated message', async () => {
    const id = mid();
    const base = envelope('cue', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: p.phone.seq++, messageId: id, ids: { session_id: DEFAULT_IDS.session_id } });
    // The session id of the live session was announced by the TV's session.begin envelope.
    const live = p.phone.client.inbox.find((m) => m.type === 'session.begin');
    base['session_id'] = live?.session_id ?? DEFAULT_IDS.session_id;
    // Hand-written raw frame: the first "text" is a marker that must never reach the TV, "Volume" is an escape,
    // and the spacing is irregular.
    const asText = JSON.stringify(base).replace('"payload":{"text":"Volume"}', '"payload" : { "text":"FIRSTMARKER" , "text" : "Vol\\u0075me" }');
    expect(asText).toContain('FIRSTMARKER');
    expect(asText).toContain('\\u0075');
    p.phone.client.send(asText);
    const got = await p.tv.client.next('cue');
    const raw = p.tv.client.frames[p.tv.client.inbox.indexOf(got)] as string;
    expect(got.payload['text']).toBe('Volume'); // the last duplicate wins, escape decoded
    expect(raw).not.toContain('FIRSTMARKER');
    expect(raw).not.toContain('\\u0075');
    expect(raw).toBe(JSON.stringify(JSON.parse(raw))); // canonical: re-serialising changes nothing
    expect(raw).not.toMatch(/\s:|:\s|,\s|\{\s|\s\}/); // no formatting whitespace survived
  });

  it('SEC-V02: a binary frame is refused (error binary_rejected, close 1003) even when its bytes are valid JSON', async () => {
    const c = await RawClient.open(relay, null);
    c.sendBinary(Buffer.from(JSON.stringify(envelope('ping', { role: 'tv' }))));
    const err = await c.nextError();
    expect(err.code).toBe('binary_rejected');
    expect((await c.waitClosed()).code).toBe(1003);
  });

  it('SEC-V02: an authenticated binary frame is refused the same way and never forwarded', async () => {
    const q = await pairRaw(relay);
    const before = q.tv.client.inbox.length;
    q.phone.client.sendBinary(Buffer.from('{"audio":"AAAA"}'));
    const err = await q.phone.client.nextError();
    expect(err.code).toBe('binary_rejected');
    expect((await q.phone.client.waitClosed()).code).toBe(1003);
    await sleep(200);
    expect(q.tv.client.inbox.slice(before).filter((m) => m.type !== 'peer.state')).toEqual([]);
    q.tv.client.close();
  });

  it('SEC-V02: a text frame over 8192 bytes is refused with payload_too_large and close 1009', async () => {
    const q = await pairRaw(relay);
    q.phone.client.send(JSON.stringify(envelope('ping', { role: 'phone', roomId: q.roomId, generation: q.phone.generation, sequence: 0 })) + ' '.repeat(9000));
    const err = await q.phone.client.nextError();
    expect(err.code).toBe('payload_too_large');
    expect((await q.phone.client.waitClosed()).code).toBe(1009);
    q.tv.client.close();
  });

  it('SEC-V07: permessage-deflate is not negotiated even when the client offers it', async () => {
    const ws = await new Promise<import('ws').WebSocket>((resolve, reject) => {
      void import('ws').then(({ default: WebSocket }) => {
        const s = new WebSocket(relay.wsUrl, { ca: relay.ca, perMessageDeflate: true });
        s.once('open', () => resolve(s));
        s.once('error', reject);
      });
    });
    expect(ws.extensions).toBe('');
    ws.terminate();
  });

  it('SEC-I09: the relay exposes only the static page, /healthz and the WebSocket upgrade; no polling or buffering endpoint exists', async () => {
    const get = (path: string, method = 'GET', body?: string): Promise<{ status: number; type: string }> =>
      new Promise((resolve, reject) => {
        const req = https.request({ host: 'localhost', port: relay.port, path, method, ca: relay.ca, headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {} }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    for (const route of ['/poll', '/api/poll', '/messages', '/events', '/api/rooms', '/rooms', '/send', '/long-poll', '/queue', '/ws/poll']) {
      const g = await get(route);
      expect(g.status, `GET ${route}`).toBe(404);
      const po = await get(route, 'POST', '{"type":"ping"}');
      expect([404, 405], `POST ${route}`).toContain(po.status);
    }
    expect((await get('/healthz')).status).toBe(200);
    expect((await get('/ws')).status).toBe(426); // plain GET of the socket path: Upgrade Required, no data
    expect((await get('/', 'POST', '{}')).status).toBe(405);
    expect((await get('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404); // path traversal stays inside the static root
    expect((await get('/..%5c..%5csecret')).status).toBe(404);
  });
});

const FORBID_CODES = ['forbidden_direction', 'unauthorized'];

describe('SEC-A12 role and room isolation', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  
  it('SEC-A12: every type a role may not send is refused and never delivered (TV and phone, all 37 types)', async () => {
    // The strike limit closes a connection after 20 refusals, so the matrix is split over several pairings.
    const tvForbidden = MESSAGE_TYPES.filter((t) => !TV_SENDS.includes(t));
    const phoneForbidden = MESSAGE_TYPES.filter((t) => !PHONE_SENDS.includes(t));
    expect(tvForbidden.length + TV_SENDS.length).toBe(37);
    expect(phoneForbidden.length + PHONE_SENDS.length).toBe(37);
    const chunks = (arr: MessageType[], n: number): MessageType[][] => {
      const out: MessageType[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };
    let tvRefusals = 0;
    for (const chunk of chunks(tvForbidden, 11)) {
      const p = await pairRaw(relay);
      const phoneBefore = p.phone.client.inbox.length;
      for (const type of chunk) {
        const id = mid();
        const from = p.tv.client.inbox.length;
        p.tv.sendEnvelope(envelope(type, { role: 'tv', roomId: p.roomId, generation: p.tv.generation, sequence: p.tv.seq++, messageId: id }));
        const err = await p.tv.client.nextError(5000, from);
        expect(FORBID_CODES, `TV sending ${type}`).toContain(err.code);
        tvRefusals += 1;
      }
      await sleep(100);
      expect(p.phone.client.inbox.slice(phoneBefore).filter((m) => m.type !== 'peer.state')).toEqual([]); // nothing reached the phone
      p.tv.client.close();
      p.phone.client.close();
    }
    expect(tvRefusals).toBe(tvForbidden.length);
    let phoneRefusals = 0;
    for (const chunk of chunks(phoneForbidden, 14)) {
      const p = await pairRaw(relay);
      const tvBefore = p.tv.client.inbox.length;
      for (const type of chunk) {
        const from = p.phone.client.inbox.length;
        p.phone.sendEnvelope(envelope(type, { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: p.phone.seq++ }));
        const err = await p.phone.client.nextError(5000, from);
        expect(FORBID_CODES, `phone sending ${type}`).toContain(err.code);
        phoneRefusals += 1;
      }
      await sleep(100);
      expect(p.tv.client.inbox.slice(tvBefore).filter((m) => m.type !== 'peer.state')).toEqual([]);
      p.tv.client.close();
      p.phone.client.close();
    }
    expect(phoneRefusals).toBe(phoneForbidden.length);
  });

  it('SEC-A12: sender_role must equal the authenticated role; a room id of another room is refused; nothing crosses rooms', async () => {
    const a = await pairRaw(relay);
    const b = await pairRaw(relay);
    // role spoof: the TV claims to be the phone
    let from = a.tv.client.inbox.length;
    a.tv.sendEnvelope(envelope('ping', { role: 'phone', roomId: a.roomId, generation: a.tv.generation, sequence: a.tv.seq++ }));
    expect((await a.tv.client.nextError(5000, from)).code).toBe('unauthorized');
    // cross-room: a phone of room A addresses room B
    from = a.phone.client.inbox.length;
    a.phone.sendEnvelope(envelope('mic.state', { role: 'phone', roomId: b.roomId, generation: a.phone.generation, sequence: a.phone.seq++ }));
    expect((await a.phone.client.nextError(5000, from)).code).toBe('unauthorized');
    // a valid message captured from room A, replayed byte for byte on room B's connection
    const captured = JSON.stringify(envelope('mic.state', { role: 'phone', roomId: a.roomId, generation: a.phone.generation, sequence: a.phone.seq++ }));
    const bTvBefore = b.tv.client.inbox.length;
    b.phone.client.send(captured);
    expect((await b.phone.client.nextError(5000, b.phone.client.inbox.length - 0)).code).toBe('unauthorized');
    await sleep(150);
    expect(b.tv.client.inbox.slice(bTvBefore)).toEqual([]);
    // 300 legitimate messages in each of the two rooms: every one arrives at its own TV and at no other
    const marks = { a: new Set<string>(), b: new Set<string>() };
    for (let i = 0; i < 300; i += 1) {
      const room = i % 2 === 0 ? a : b;
      const id = room.phone.send('mic.state');
      (room === a ? marks.a : marks.b).add(id);
      if (i % 40 === 39) await sleep(1100); // stay under the phone rate limit (40 per second sustained)
    }
    await a.tv.client.waitUntil(() => marks.a.size <= a.tv.client.inbox.filter((m) => m.type === 'mic.state').length, 8000, 'room A deliveries');
    await b.tv.client.waitUntil(() => marks.b.size <= b.tv.client.inbox.filter((m) => m.type === 'mic.state').length, 8000, 'room B deliveries');
    const gotA = new Set(a.tv.client.inbox.filter((m) => m.type === 'mic.state').map((m) => m.message_id));
    const gotB = new Set(b.tv.client.inbox.filter((m) => m.type === 'mic.state').map((m) => m.message_id));
    for (const id of gotA) expect(marks.b.has(id), 'room A saw a room B message').toBe(false);
    for (const id of gotB) expect(marks.a.has(id), 'room B saw a room A message').toBe(false);
    for (const id of marks.a) expect(gotA.has(id)).toBe(true);
    for (const id of marks.b) expect(gotB.has(id)).toBe(true);
    for (const x of [a, b]) {
      x.tv.client.close();
      x.phone.client.close();
    }
  });
});

describe('SEC-A13 replay and duplicates', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  it('SEC-A13: a duplicate message_id is dropped silently (no error, not forwarded twice); a replayed sequence with a new id is refused as replay', async () => {
    const p = await pairRaw(relay);
    const id = mid();
    const env = envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: p.phone.seq++, messageId: id });
    const text = JSON.stringify(env);
    const tvFrom = p.tv.client.inbox.length;
    const phoneFrom = p.phone.client.inbox.length;
    p.phone.client.send(text);
    p.phone.client.send(text);
    p.phone.client.send(text);
    await sleep(400);
    expect(p.tv.client.inbox.slice(tvFrom).filter((m) => m.message_id === id)).toHaveLength(1);
    expect(p.phone.client.inbox.slice(phoneFrom).filter((m) => m.type === 'error')).toEqual([]); // silent
    // same sequence number, new message_id: replay
    const replay = envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: env['sequence'] as number });
    p.phone.client.send(JSON.stringify(replay));
    const err = await p.phone.client.nextError(5000, phoneFrom);
    expect(err.code).toBe('replay');
    // older sequence than the last accepted one: replay as well
    p.phone.send('mic.state');
    p.phone.send('mic.state');
    const from = p.phone.client.inbox.length;
    p.phone.client.send(JSON.stringify(envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: 0 })));
    expect((await p.phone.client.nextError(5000, from)).code).toBe('replay');
    // a stale generation is refused as stale
    const f2 = p.phone.client.inbox.length;
    p.phone.client.send(JSON.stringify(envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation + 7, sequence: p.phone.seq++ })));
    expect((await p.phone.client.nextError(5000, f2)).code).toBe('stale');
    p.tv.client.close();
    p.phone.client.close();
  });

  it('SEC-A13 (PK-08): message ids are scoped per role; the TV reusing a phone message id is not dropped', async () => {
    const p = await pairRaw(relay);
    const shared = mid();
    p.phone.client.send(JSON.stringify(envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: p.phone.seq++, messageId: shared })));
    await p.tv.client.next('mic.state');
    const from = p.phone.client.inbox.length;
    p.tv.client.send(JSON.stringify(envelope('session.begin', { role: 'tv', roomId: p.roomId, generation: p.tv.generation, sequence: p.tv.seq++, messageId: shared })));
    const got = await p.phone.client.next('session.begin', 5000, from);
    expect(got.message_id).toBe(shared);
    p.tv.client.close();
    p.phone.client.close();
  });

  it('SEC-A13 (PK-08): a rate-limited message does not burn its id: the retransmission is delivered', async () => {
    const p = await pairRaw(relay);
    // 80 messages in a burst exceed the phone limit of 60 per second
    const ids: string[] = [];
    for (let i = 0; i < 80; i += 1) ids.push(p.phone.send('mic.state'));
    await p.phone.client.waitUntil(() => p.phone.client.inbox.some((m) => m.type === 'error' && (m.payload as { code?: string }).code === 'rate_limited'), 6000, 'rate_limited');
    await sleep(1500);
    const delivered = new Set(p.tv.client.inbox.filter((m) => m.type === 'mic.state').map((m) => m.message_id));
    const refused = new Set(p.phone.client.inbox.filter((m) => m.type === 'error' && (m.payload as { code?: string }).code === 'rate_limited').map((m) => String(m.payload['ref_message_id'])));
    const dropped = ids.filter((i) => refused.has(i) && !delivered.has(i));
    expect(dropped.length).toBeGreaterThan(0);
    // retransmit one dropped message with the same id and a fresh sequence number
    const again = dropped[0] as string;
    p.phone.client.send(JSON.stringify(envelope('mic.state', { role: 'phone', roomId: p.roomId, generation: p.phone.generation, sequence: p.phone.seq++, messageId: again })));
    await p.tv.client.waitUntil(() => p.tv.client.inbox.some((m) => m.message_id === again), 5000, 'retransmission delivered');
    p.tv.client.close();
    p.phone.client.close();
  });
});

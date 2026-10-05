/**
 * T16 gate, part C: Origin policy matrix with real sockets, production configuration, brute force and abuse
 * budgets. Real local relay processes. Evidence class: automated.
 *
 *   SEC-A11  Origin matrix (handshake and per-role operations), production configuration, platform value
 *   SEC-A03  brute force: exponential delay, valid-code budget, connect budget, concurrency cap, live-room cap
 *   SEC-A02  65 s deadline while a join is pending, expiry burns the code
 *   N-02     ATR_RELAY_ORIGINS: what the relay may add to the page's connect-src, and what it refuses
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import https from 'node:https';
import {
  RawClient,
  createRoom,
  envelope,
  pairRaw,
  relayConfigOutcome,
  requestJoin,
  resume,
  sleep,
  startSecRelay,
  type ConnectResult,
  type SecRelay,
} from './helpers.js';

const ALL_RELAY_TEXT = (r: SecRelay): string => r.logs.join('');

describe('SEC-A11 Origin policy matrix (real sockets)', () => {
  let relay: SecRelay;
  const PREVIEW = 'http://localhost:5199';
  beforeAll(async () => {
    relay = await startSecRelay({ previewOrigin: PREVIEW });
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  const handshake = async (origin: string | null): Promise<ConnectResult> => RawClient.connect(relay, { origin });

  it('handshake: only an exact allowlist match or an absent header is admitted; everything else is refused with HTTP 403', async () => {
    const own = relay.origin;
    const refused: Array<[string, string]> = [
      ['foreign origin', 'https://evil.example'],
      ['the literal string null (sandboxed iframe or file page)', 'null'],
      ['upper-case host', `https://LOCALHOST:${relay.port}`],
      ['trailing slash', `${own}/`],
      ['scheme downgrade', `http://localhost:${relay.port}`],
      ['other port', `https://localhost:${relay.port + 1}`],
      ['subdomain of the allowed host', `https://x.localhost:${relay.port}`],
      ['allowed origin as a suffix of another host', `https://evil.example/${own}`],
      ['empty string', ''],
    ];
    for (const [label, origin] of refused) {
      const r = await handshake(origin);
      if (r.opened) r.client.close();
      expect(r.opened, `${label} (${JSON.stringify(origin)}) must be refused`).toBe(false);
      if (!r.opened) expect(r.status, label).toBe(403);
    }
    for (const origin of [null, own, PREVIEW]) {
      const r = await handshake(origin);
      expect(r.opened, `${String(origin)} must be admitted at the handshake`).toBe(true);
      if (r.opened) r.client.close();
    }
    // The refusals above never reached the application layer: no log line carries an origin value.
    await sleep(200);
    expect(ALL_RELAY_TEXT(relay)).not.toContain('evil.example');
  });

  it('operations: phone-role operations need the phone origin; TV-role operations must be Origin-less or the preview origin; the preview origin can never act as a phone', async () => {
    // room.create (TV operation)
    const create = async (origin: string | null): Promise<string> => {
      const c = await RawClient.open(relay, origin);
      c.send(JSON.stringify(envelope('room.create', { role: 'tv' })));
      await c.waitUntil(() => c.inbox.length > 0, 5000, 'room.create reply');
      const first = c.inbox[0];
      const outcome = first?.type === 'room.created' ? 'ok' : String(first?.payload['code']);
      c.close();
      return outcome;
    };
    expect(await create(null)).toBe('ok');
    expect(await create(PREVIEW)).toBe('ok');
    expect(await create(relay.phoneOrigin)).toBe('origin_rejected');

    // join.request (phone operation) against a live code
    const room = await createRoom(relay);
    const join = async (origin: string | null): Promise<string> => {
      const c = await RawClient.open(relay, origin);
      c.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: room.code, device_label: 'matrix' } })));
      await c.waitUntil(() => c.inbox.length > 0 || c.closed !== null, 5000, 'join.request reply');
      const first = c.inbox[0];
      const outcome = first?.type === 'join.pending' ? 'ok' : String(first?.payload['code']);
      return outcome === 'ok' ? (c.close(), outcome) : (c.close(), outcome);
    };
    expect(await join(null)).toBe('origin_rejected');
    expect(await join(PREVIEW)).toBe('origin_rejected');
    expect(await join(relay.phoneOrigin)).toBe('ok');
    room.tv.client.close();

    // auth.resume by role. Pair, drop both connections, then try every origin on every role.
    const p = await pairRaw(relay);
    p.tv.client.close();
    p.phone.client.close();
    await sleep(400);
    const tryResume = async (role: 'tv' | 'phone', credential: string, origin: string | null): Promise<{ ok: boolean; code: string; next: string | null }> => {
      const r = await resume(relay, { roomId: p.roomId, role, credential, origin });
      const out = { ok: r.ok, code: String(r.reply?.payload['code'] ?? ''), next: r.ok ? String(r.reply?.payload['next_credential']) : null };
      r.client.close();
      await sleep(150);
      return out;
    };
    // refusals come before credential verification, so they do not consume anything
    expect((await tryResume('phone', p.phoneCredential, null)).code).toBe('origin_rejected');
    expect((await tryResume('phone', p.phoneCredential, PREVIEW)).code).toBe('origin_rejected');
    expect((await tryResume('tv', p.tvCredential, relay.phoneOrigin)).code).toBe('origin_rejected');
    const tv1 = await tryResume('tv', p.tvCredential, null);
    expect(tv1.ok).toBe(true);
    const tv2 = await tryResume('tv', tv1.next as string, PREVIEW);
    expect(tv2.ok).toBe(true);
    const ph = await tryResume('phone', p.phoneCredential, relay.phoneOrigin);
    expect(ph.ok).toBe(true);
  });
});

describe('SEC-A11 production configuration', () => {
  it('a production relay accepts its configured phone origin, refuses client.platform "test", and accepts "vega"', async () => {
    const relay = await startSecRelay({ phoneOrigin: 'https://phone.example.test', env: { ATR_ENV: 'production' } });
    try {
      // the browser path: the phone origin is the configured one, not the relay's own address
      const own = await RawClient.connect(relay, { origin: relay.origin });
      expect(own.opened).toBe(false); // the relay's own address is not an allowed origin here
      const t = await RawClient.open(relay, null);
      t.send(JSON.stringify(envelope('room.create', { role: 'tv', payload: { client: { app_version: '0.1.0', platform: 'test' } } })));
      const err = await t.nextError();
      expect(err.code).toBe('unauthorized');
      t.close();
      const v = await RawClient.open(relay, null);
      v.send(JSON.stringify(envelope('room.create', { role: 'tv', payload: { client: { app_version: '0.1.0', platform: 'vega' } } })));
      const created = await v.next('room.created');
      const code = String(created.payload['pairing_code']);
      const ph = await RawClient.open(relay, 'https://phone.example.test');
      ph.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'prod' } })));
      await ph.next('join.pending');
      ph.close();
      v.close();
    } finally {
      await relay.stop();
    }
  }, 60_000);

  it('the relay refuses to start on unsafe configuration, with a message that names no secret', async () => {
    const cases: Array<[string, Parameters<typeof relayConfigOutcome>[0]]> = [
      ['production with a localhost origin', { env: { ATR_ENV: 'production', ATR_ALLOWED_ORIGINS: 'https://localhost:9999' } }],
      ['production with an http origin', { env: { ATR_ENV: 'production', ATR_ALLOWED_ORIGINS: 'http://phone.example.test' } }],
      ['production with a TV preview origin', { phoneOrigin: 'https://phone.example.test', previewOrigin: 'http://localhost:5199', env: { ATR_ENV: 'production' } }],
      ['production without explicit origins', { env: { ATR_ENV: 'production', ATR_ALLOWED_ORIGINS: '' } }],
      ['production in insecure localhost mode', { phoneOrigin: 'https://phone.example.test', env: { ATR_ENV: 'production', ATR_INSECURE_LOCALHOST_ONLY: '1' } }],
      ['an unknown environment name', { env: { ATR_ENV: 'prod' } }],
      ['an origin with a path', { env: { ATR_ALLOWED_ORIGINS: 'https://phone.example.test/app' } }],
      ['a plain-http non-local origin', { env: { ATR_ALLOWED_ORIGINS: 'http://phone.example.test' } }],
      ['no TLS material and no insecure flag', { env: { ATR_TLS_CERT: '/nonexistent/server.crt' } }],
      // N-02: the origins the relay adds to the page's connect-src are exact, wss in production, never a wildcard host
      ['production with a loopback relay origin', { phoneOrigin: 'https://phone.example.test', env: { ATR_ENV: 'production', ATR_RELAY_ORIGINS: 'wss://localhost:*' } }],
      ['production with a ws:// relay origin', { phoneOrigin: 'https://phone.example.test', env: { ATR_ENV: 'production', ATR_RELAY_ORIGINS: 'ws://relay.example.test' } }],
      ['a wildcard host', { env: { ATR_RELAY_ORIGINS: 'wss://*.example.test' } }],
      ['a wildcard port on a non-loopback host', { env: { ATR_RELAY_ORIGINS: 'wss://relay.example.test:*' } }],
      ['a relay origin with a path', { env: { ATR_RELAY_ORIGINS: 'wss://relay.example.test/ws' } }],
      ['a scheme-only relay origin', { env: { ATR_RELAY_ORIGINS: 'wss:' } }],
      ['plain ws to a non-loopback host in development', { env: { ATR_RELAY_ORIGINS: 'ws://relay.example.test' } }],
    ];
    for (const [label, opts] of cases) {
      const out = await relayConfigOutcome(opts);
      expect(out.exitCode, `${label}: exit code (output: ${out.output.trim()})`).toBe(2);
      expect(out.output, label).toMatch(/configuration error/i);
      expect(out.output, label).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|secret/i);
    }
  }, 90_000);
});

describe('SEC-A03 brute force: delay, not lock-out', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  const guess = async (code: string): Promise<{ code: string; detail: string }> => {
    const c = await RawClient.open(relay, relay.phoneOrigin);
    c.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'guesser' } })));
    const err = await c.nextError();
    c.close();
    return { code: err.code, detail: err.detail };
  };

  it('after three wrong codes from one source, each further attempt must wait 2 s, then 4 s, and so on; a valid code is delayed the same way and works afterwards', async () => {
    const { tv, code: realCode } = await createRoom(relay);
    // three free failures on one connection (the third also closes that connection)
    const c1 = await RawClient.open(relay, relay.phoneOrigin);
    for (const g of ['AAAAAA', 'CCCCCC', 'DDDDDD']) {
      c1.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: g, device_label: 'guesser' } })));
    }
    await c1.waitUntil(() => c1.inbox.filter((m) => m.type === 'error').length >= 3, 5000, 'three failures');
    expect(c1.inbox.filter((m) => m.type === 'error').every((m) => m.payload['code'] === 'not_found')).toBe(true);
    expect((await c1.waitClosed()).code).toBe(4429); // per-connection cap of three failures
    // the fourth attempt is still judged (and fails): it starts the 2 s delay
    expect((await guess('EEEEEE')).code).toBe('not_found');
    // from now on an immediate attempt is refused without being judged, and that includes the REAL code:
    // the household shares the source and is delayed, not locked out
    expect(await guess('FFFFFF')).toEqual({ code: 'rate_limited', detail: 'retry_later' });
    expect(await guess(realCode)).toEqual({ code: 'rate_limited', detail: 'retry_later' });
    await sleep(2300);
    expect((await guess('HHHHHH')).code).toBe('not_found'); // failure number 5: the next wait is 4 s
    expect(await guess('JJJJJJ')).toEqual({ code: 'rate_limited', detail: 'retry_later' });
    await sleep(2300);
    expect((await guess('KKKKKK')).code).toBe('rate_limited'); // 2.3 s into a 4 s wait: the delay is growing, not constant
    await sleep(2000); // 4.3 s since failure 5
    // the delay has passed: the real code works, so a real user waits but is never locked out
    const j = await requestJoin(relay, realCode, 'the real phone');
    expect(j.digits).toMatch(/^[0-9]{2}$/);
    j.client.close();
    tv.client.close();
  }, 90_000);
});

describe('SEC-A03 valid-code budget: repeated rejected joins', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  it('an attacker who has the code and keeps asking is cut off after 6 rejected joins in 10 minutes; every reject burns the code', async () => {
    const { tv, code } = await createRoom(relay);
    let current = code;
    for (let i = 0; i < 6; i += 1) {
      const j = await requestJoin(relay, current, `attacker ${i}`);
      await tv.client.waitUntil(() => tv.client.inbox.filter((m) => m.type === 'join.requested').length >= i + 1, 5000, 'join.requested');
      const req = tv.client.inbox.filter((m) => m.type === 'join.requested')[i];
      tv.send('join.confirm', { join_id: String(req?.payload['join_id']), decision: 'reject' });
      await j.client.next('join.rejected');
      await tv.client.waitUntil(() => tv.client.inbox.filter((m) => m.type === 'pairing.code').length >= i + 1, 5000, 'fresh code');
      const codes = tv.client.inbox.filter((m) => m.type === 'pairing.code');
      const next = String(codes[codes.length - 1]?.payload['pairing_code']);
      expect(next, `round ${i}: the code changed`).not.toBe(current);
      current = next;
      j.client.close();
    }
    // the seventh valid-code join from the same source is refused outright
    const c = await RawClient.open(relay, relay.phoneOrigin);
    c.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: current, device_label: 'attacker 7' } })));
    const err = await c.nextError();
    expect(err.code).toBe('rate_limited');
    expect(err.detail).toBe('too_many_ended_joins');
    c.close();
    tv.client.close();
  }, 60_000);
});

describe('SEC-A03 connection budgets', () => {
  let relay: SecRelay;
  beforeAll(async () => {
    relay = await startSecRelay();
  }, 60_000);
  afterAll(async () => {
    await relay?.stop();
  });

  it('at most 5 concurrent unauthenticated connections per source; the 6th handshake is refused with 429', async () => {
    const held: RawClient[] = [];
    for (let i = 0; i < 5; i += 1) held.push(await RawClient.open(relay, null));
    const sixth = await RawClient.connect(relay, { origin: null });
    expect(sixth.opened).toBe(false);
    if (!sixth.opened) expect(sixth.status).toBe(429);
    for (const c of held) c.close();
    await sleep(300);
  });

  it('the connection budget (20 per minute per source) ends in HTTP 429 and nothing else about the relay changes', async () => {
    let refusedAt = -1;
    for (let i = 0; i < 30; i += 1) {
      const r = await RawClient.connect(relay, { origin: null });
      if (r.opened) {
        r.client.close();
        await sleep(40);
      } else {
        expect(r.status).toBe(429);
        refusedAt = i;
        break;
      }
    }
    expect(refusedAt).toBeGreaterThan(0);
    expect(refusedAt).toBeLessThanOrEqual(21); // 6 were used by the previous test
    // the health endpoint is not behind the WebSocket budget
    const https = await import('node:https');
    const status = await new Promise<number>((resolve, reject) => {
      https.get({ host: 'localhost', port: relay.port, path: '/healthz', ca: relay.ca }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on('error', reject);
    });
    expect(status).toBe(200);
  });
});

describe('SEC-A03 live-room cap', () => {
  it('with a cap of 3 live rooms the 4th room.create is refused; closing a room frees a slot', async () => {
    const relay = await startSecRelay({ env: { ATR_LIVE_ROOM_CAP: '3' } });
    try {
      const rooms = [];
      for (let i = 0; i < 3; i += 1) rooms.push(await createRoom(relay));
      const c = await RawClient.open(relay, null);
      c.send(JSON.stringify(envelope('room.create', { role: 'tv' })));
      const err = await c.nextError();
      expect(err.code).toBe('rate_limited');
      expect(err.detail).toBe('capacity');
      expect((await c.waitClosed()).code).toBe(4429);
      const first = rooms[0];
      first?.tv.send('room.close');
      await first?.tv.client.waitClosed();
      await sleep(200);
      const again = await createRoom(relay);
      expect(again.code).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
      for (const r of [...rooms, again]) r.tv.client.close();
    } finally {
      await relay.stop();
    }
  }, 60_000);
});

describe('SEC-A02 a pending join: deadline 65 s, unanswered join expires, burns the code (slow, about 70 s)', () => {
  it('the phone stays connected while the TV has not answered; at 60 s the join expires, the TV learns it and gets a fresh code, and the idle phone is then closed', async () => {
    const relay = await startSecRelay();
    try {
      const { tv, code } = await createRoom(relay);
      const j = await requestJoin(relay, code);
      await tv.client.next('join.requested');
      const heartbeat = setInterval(() => {
        if (tv.client.isOpen) tv.send('ping'); // a real TV pings every 10 s; an idle raw client is dropped after 25 s
      }, 10_000);
      await sleep(8000);
      expect(j.client.closed, 'a pending join keeps the connection open past the 5 s deadline').toBeNull();
      await j.client.next('join.rejected', 70_000); // join expiry, about 60 s after the request
      expect(j.client.inbox.find((m) => m.type === 'join.rejected')?.payload['reason']).toBe('expired');
      await tv.client.next('join.expired', 5000);
      const fresh = await tv.client.next('pairing.code', 5000);
      expect(fresh.payload['pairing_code']).not.toBe(code);
      await j.client.waitClosed(15_000); // closed shortly after (5 s grace)
      clearInterval(heartbeat);
      tv.client.close();
    } finally {
      await relay.stop();
    }
  }, 120_000);
});

describe('N-02: the page policy the relay serves follows ATR_RELAY_ORIGINS exactly', () => {
  const headerOf = (r: SecRelay): Promise<string> =>
    new Promise((resolve, reject) => {
      https.get({ host: 'localhost', port: r.port, path: '/', ca: r.ca }, (res) => {
        res.resume();
        resolve(String(res.headers['content-security-policy']));
      }).on('error', reject);
    });
  const connectSources = (csp: string): string[] => (/(?:^|;)\s*connect-src\s+([^;]*)/.exec(csp)?.[1] ?? '').trim().split(/\s+/);

  it('with none configured connect-src is this origin and its own wss origin; configured relay origins are added verbatim, nothing else', async () => {
    const plain = await startSecRelay();
    const api = 'wss://abc123.execute-api.eu-west-1.amazonaws.com';
    const configured = await startSecRelay({ env: { ATR_RELAY_ORIGINS: `${api},wss://localhost:*` } });
    try {
      const a = connectSources(await headerOf(plain));
      expect(a[0]).toBe("'self'");
      expect(a.filter((x) => x !== "'self'")).toEqual([`wss://localhost:${plain.port}`]);
      const b = connectSources(await headerOf(configured));
      expect(b).toEqual(expect.arrayContaining(["'self'", api, 'wss://localhost:*', `wss://localhost:${configured.port}`]));
      expect(b.filter((x) => /^[a-z][a-z0-9+.-]*:$/i.test(x) || x === '*'), 'no scheme-only source or bare wildcard').toEqual([]);
      expect(b).toHaveLength(4);
      expect(await headerOf(configured)).toMatch(/worker-src 'self'(;|$)/);
    } finally {
      await plain.stop();
      await configured.stop();
    }
  }, 60_000);
});

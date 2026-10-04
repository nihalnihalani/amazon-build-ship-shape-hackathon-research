/**
 * Local adapter hardening added by the rework batch, exercised over real sockets (insecure loopback mode, so no
 * certificates are needed; the code path above the TLS layer is the same): compression (A6-03, SEC-V07),
 * connect budgets (A3-03, SEC-A03), production and preview-origin configuration (A3-08, A3-12, SEC-A11, SEC-I07),
 * per-minute aggregation and no per-message logging (A2-04, SEC-P02).
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, createLocalServer, loadLocalConfig, type LocalConfig, type LocalServer } from '../src/local/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';
import { WsClient } from './helpers/ws-client.js';
import { assertNoLeaks } from './helpers/rig.js';

const PHONE_ORIGIN = 'https://phone.example.test';
const PREVIEW_ORIGIN = 'https://tv-preview.example.test';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'atr-hardening-'));
  mkdirSync(join(root, 'static'));
  writeFileSync(join(root, 'static', 'index.html'), 'ok');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Instance {
  server: LocalServer;
  port: number;
  clock: { now: number };
  logs: string[];
  url: string;
  stop: () => Promise<void>;
}
const instances: Instance[] = [];

async function start(overrides: Partial<LocalConfig> = {}): Promise<Instance> {
  const config: LocalConfig = {
    port: 0,
    host: '127.0.0.1',
    allowedOrigins: [PHONE_ORIGIN],
    staticDir: join(root, 'static'),
    tls: null,
    insecureLocalhostOnly: true,
    hstsMaxAgeSeconds: 0,
    tickMs: 10,
    tvPreviewOrigins: [],
    environment: 'development',
    liveRoomCap: 200,
    disabled: false,
    ...overrides,
  };
  const logs: string[] = [];
  const clock = { now: Date.now() };
  const server = createLocalServer({ config, logSink: (l) => logs.push(l), now: () => clock.now });
  const { port } = await server.start();
  const inst: Instance = { server, port, clock, logs, url: `ws://127.0.0.1:${port}/ws`, stop: () => server.stop() };
  instances.push(inst);
  return inst;
}
afterAll(async () => {
  for (const i of instances) await i.stop();
  for (const i of instances) assertNoLeaks(i.logs, []);
});

const open = (i: Instance, origin: string | null, role: 'tv' | 'phone') =>
  WsClient.open(i.url, role, origin ? { headers: { Origin: origin } } : {}, () => i.clock.now);
const probe = (i: Instance, origin: string | null) => WsClient.probe(i.url, origin ? { headers: { Origin: origin } } : {});

async function idle(i: Instance): Promise<void> {
  for (let n = 0; n < 500 && i.server.connectionCount() > 0; n += 1) await new Promise((r) => setTimeout(r, 4));
  expect(i.server.connectionCount()).toBe(0);
}

describe('compression is never negotiated (A6-03, SEC-V07)', () => {
  it('answers a permessage-deflate offer with no Sec-WebSocket-Extensions header', async () => {
    const i = await start();
    const headers = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: i.port,
        path: '/ws',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
          'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits, permessage-deflate',
        },
      });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve(res.headers as Record<string, unknown>);
      });
      req.on('response', (res) => reject(new Error(`not upgraded: ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
    expect(headers['sec-websocket-accept']).toBeTypeOf('string');
    expect(headers['sec-websocket-extensions']).toBeUndefined();
  });

  it('a client that asks for compression ends up with no extension, and frames still flow', async () => {
    const i = await start();
    const ws = new WebSocket(i.url, { perMessageDeflate: true });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    expect(ws.extensions).toBe('');
    ws.close();
  });

  it('also disables it in the source (belt and braces) and bounds the frame size', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/local/server.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/perMessageDeflate: false/);
    expect(src).toMatch(/maxPayload: MAX_WS_FRAME/);
  });
});

describe('connect budgets answer 429 (A3-03, SEC-A03)', () => {
  it('refuses the 21st connect of a minute from one source, and the window passes', async () => {
    const i = await start();
    for (let n = 0; n < 20; n += 1) {
      expect(await probe(i, PHONE_ORIGIN), `connect ${n + 1}`).toBe(101);
      await idle(i);
    }
    expect(await probe(i, PHONE_ORIGIN)).toBe(429);
    expect(i.logs.some((l) => JSON.parse(l).event === 'rate_limited')).toBe(true);
    i.clock.now += 61_000;
    expect(await probe(i, PHONE_ORIGIN)).toBe(101);
  });

  it('refuses a sixth concurrent unauthenticated connection from one source, and frees a slot when one closes', async () => {
    const i = await start();
    const held: WsClient[] = [];
    for (let n = 0; n < 5; n += 1) held.push(await open(i, PHONE_ORIGIN, 'phone'));
    expect(await probe(i, PHONE_ORIGIN)).toBe(429);
    held[0]?.close();
    for (let n = 0; n < 500 && i.server.connectionCount() > 4; n += 1) await new Promise((r) => setTimeout(r, 4));
    expect(await probe(i, PHONE_ORIGIN)).toBe(101);
    for (const c of held) c.close();
  });

  it('gives the slot back once a connection authenticates', async () => {
    const i = await start();
    const tvs: WsClient[] = [];
    // five TVs authenticate by creating rooms; they would fill the cap if authenticated connections kept a slot
    for (let n = 0; n < 5; n += 1) {
      const tv = await open(i, null, 'tv');
      tv.send('room.create');
      await tv.next('room.created');
      tvs.push(tv);
    }
    expect(await probe(i, PHONE_ORIGIN)).toBe(101);
    for (const c of tvs) c.close();
  });

  it('does not let a refused Origin consume anything: 403 is cheap and does not count as a connect', async () => {
    const i = await start();
    for (let n = 0; n < 30; n += 1) expect(await probe(i, 'https://evil.example.test')).toBe(403);
    expect(await probe(i, PHONE_ORIGIN)).toBe(101);
  });
});

describe('production and preview-origin configuration (A3-08, A3-12, SEC-A11, SEC-I07)', () => {
  const insecure = { ATR_INSECURE_LOCALHOST_ONLY: '1', ATR_PORT: '0', ATR_STATIC_DIR: 'static' };

  it('reads ATR_ENV and ATR_TV_PREVIEW_ORIGINS', () => {
    const dev = loadLocalConfig({ ...insecure, ATR_TV_PREVIEW_ORIGINS: `${PREVIEW_ORIGIN}, http://localhost:5174`, ATR_LIVE_ROOM_CAP: '12' }, { root });
    expect(dev.environment).toBe('development');
    expect(dev.tvPreviewOrigins).toEqual([PREVIEW_ORIGIN, 'http://localhost:5174']);
    expect(dev.liveRoomCap).toBe(12);
    expect(loadLocalConfig({ ...insecure, ATR_ENV: 'staging' }, { root }).environment).toBe('staging');
    expect(loadLocalConfig({ ...insecure }, { root }).tvPreviewOrigins).toEqual([]);
  });

  it.each([
    [{ ATR_ENV: 'prod' }, /ATR_ENV/],
    [{ ATR_ENV: 'Production' }, /ATR_ENV/],
    [{ ATR_ENV: 'production' }, /ATR_INSECURE_LOCALHOST_ONLY/], // insecure mode is a development tool
    [{ ATR_ENV: 'production', ATR_INSECURE_LOCALHOST_ONLY: '0' }, /TLS|ATR_ALLOWED_ORIGINS/], // no certificate: refuses to start
    [{ ATR_ENV: 'staging', ATR_TV_PREVIEW_ORIGINS: 'ftp://x.example' }, /ATR_TV_PREVIEW_ORIGINS/],
    [{ ATR_ENV: 'staging', ATR_TV_PREVIEW_ORIGINS: '*' }, /ATR_TV_PREVIEW_ORIGINS/],
    [{ ATR_ENV: 'staging', ATR_TV_PREVIEW_ORIGINS: 'https://tv.example/' }, /exact origins/],
    [{ ATR_ENV: 'staging', ATR_ALLOWED_ORIGINS: PHONE_ORIGIN, ATR_TV_PREVIEW_ORIGINS: PHONE_ORIGIN }, /both/],
    [{ ATR_LIVE_ROOM_CAP: '0' }, /ATR_LIVE_ROOM_CAP/],
    [{ ATR_LIVE_ROOM_CAP: 'many' }, /ATR_LIVE_ROOM_CAP/],
    [{ ATR_LIVE_ROOM_CAP: '100001' }, /ATR_LIVE_ROOM_CAP/],
  ])('refuses %j', (extra, pattern) => {
    const env = { ...insecure, ...extra };
    expect(() => loadLocalConfig(env, { root })).toThrow(ConfigError);
    expect(() => loadLocalConfig(env, { root })).toThrow(pattern);
  });

  it('refuses production without an explicit allowlist, with a preview origin, and with localhost or http origins', () => {
    mkdirSync(join(root, 'certs'), { recursive: true });
    writeFileSync(join(root, 'certs', 'c.crt'), 'x');
    writeFileSync(join(root, 'certs', 'k.key'), 'x');
    const prod = { ATR_ENV: 'production', ATR_TLS_CERT: join(root, 'certs', 'c.crt'), ATR_TLS_KEY: join(root, 'certs', 'k.key'), ATR_PORT: '0' };
    expect(() => loadLocalConfig(prod, { root, lanAddresses: ['192.168.1.5'] })).toThrow(/ATR_ALLOWED_ORIGINS must be set explicitly/);
    expect(() => loadLocalConfig({ ...prod, ATR_ALLOWED_ORIGINS: PHONE_ORIGIN, ATR_TV_PREVIEW_ORIGINS: PREVIEW_ORIGIN }, { root })).toThrow(/must be empty when ATR_ENV=production/);
    expect(() => loadLocalConfig({ ...prod, ATR_ALLOWED_ORIGINS: 'http://localhost:3000' }, { root })).toThrow(/localhost or http/);
    expect(() => loadLocalConfig({ ...prod, ATR_ALLOWED_ORIGINS: `${PHONE_ORIGIN},https://localhost:3000` }, { root })).toThrow(/localhost or http/);
    const ok = loadLocalConfig({ ...prod, ATR_ALLOWED_ORIGINS: PHONE_ORIGIN }, { root });
    expect(ok.environment).toBe('production');
    expect(ok.allowedOrigins).toEqual([PHONE_ORIGIN]);
    expect(ok.tvPreviewOrigins).toEqual([]);
  });

  it('refuses to construct a production server that allows a preview origin', () => {
    expect(() =>
      createLocalServer({
        config: {
          port: 0, host: '127.0.0.1', allowedOrigins: [PHONE_ORIGIN], staticDir: join(root, 'static'), tls: null, insecureLocalhostOnly: true,
          hstsMaxAgeSeconds: 0, tickMs: 50, tvPreviewOrigins: [PREVIEW_ORIGIN], environment: 'production', liveRoomCap: 10, disabled: false,
        },
        logSink: () => undefined,
      }),
    ).toThrow(/preview/);
  });

  it('a production server refuses client.platform "test" and creates no room; a vega TV works', async () => {
    const i = await start({ environment: 'production' });
    const bad = await open(i, null, 'tv');
    bad.send('room.create', { payload: { client: { app_version: '0.1.0', platform: 'test' } } });
    const err = await bad.next('error');
    expect(err.payload).toMatchObject({ code: 'unauthorized', detail: 'platform_not_allowed' });
    expect(bad.of('room.created')).toHaveLength(0);
    const good = await open(i, null, 'tv');
    good.send('room.create', { payload: { client: { app_version: '0.1.0', platform: 'vega' } } });
    expect((await good.next('room.created')).payload.room_id).toMatch(/^r_/);
    bad.close();
    good.close();
  });

  it('a development server accepts platform "test"', async () => {
    const i = await start();
    const tv = await open(i, null, 'tv');
    tv.send('room.create', { payload: { client: { app_version: '0.1.0', platform: 'test' } } });
    expect((await tv.next('room.created')).payload.room_id).toMatch(/^r_/);
    tv.close();
  });

  it('accepts the TV preview origin at the handshake as a TV only: it can create a room but never join as a phone', async () => {
    const i = await start({ tvPreviewOrigins: [PREVIEW_ORIGIN] });
    expect(await probe(i, PREVIEW_ORIGIN)).toBe(101);
    expect(await probe(i, 'https://evil.example.test')).toBe(403);
    const tv = await open(i, PREVIEW_ORIGIN, 'tv');
    tv.send('room.create');
    const created = await tv.next('room.created');
    // the same origin used as a phone: join.request is refused and nothing reaches the TV
    const asPhone = await open(i, PREVIEW_ORIGIN, 'phone');
    asPhone.send('join.request', { payload: { pairing_code: created.payload.pairing_code as string, device_label: 'Preview' } });
    await asPhone.waitFor(() => asPhone.of('error').length > 0 || asPhone.of('join.rejected').length > 0, 3000, 'a refusal');
    expect(asPhone.of('join.pending')).toHaveLength(0);
    expect(tv.of('join.requested')).toHaveLength(0);
    tv.close();
    asPhone.close();
  });

  it('refuses the preview origin when it is not configured (it is not a phone origin by default)', async () => {
    const i = await start();
    expect(await probe(i, PREVIEW_ORIGIN)).toBe(403);
  });
});

describe('logging: aggregates instead of per-message lines (A2-04, SEC-P02)', () => {
  it('writes no line per forwarded message and one minute_aggregate line per kind and type', async () => {
    const i = await start();
    const tv = await open(i, null, 'tv');
    tv.send('room.create');
    const created = await tv.next('room.created');
    tv.roomId = created.payload.room_id as string;
    tv.generation = created.payload.generation as number;
    tv.nextSeq = 0;
    const phone = await open(i, PHONE_ORIGIN, 'phone');
    phone.send('join.request', { payload: { pairing_code: created.payload.pairing_code as string, device_label: 'Pixel' } });
    const requested = await tv.next('join.requested');
    tv.send('join.confirm', { payload: { join_id: requested.payload.join_id as string, decision: 'accept' } });
    const accepted = await phone.next('join.accepted');
    phone.roomId = accepted.payload.room_id as string;
    phone.generation = accepted.payload.generation as number;
    phone.nextSeq = 0;
    await tv.next('peer.state');
    tv.send('session.begin');
    await phone.next('session.begin');

    const before = i.logs.length;
    for (let n = 0; n < 30; n += 1) {
      phone.send('level', { payload: { ...(VALID_PAYLOADS.level as object), frame_index: n, t_audio_ms: n * 50 } });
    }
    await tv.waitFor(() => tv.of('level').length === 30, 5000, '30 level frames');
    expect(i.logs.slice(before).map((l) => JSON.parse(l).event)).not.toContain('message_forwarded');
    expect(i.logs.slice(before).filter((l) => JSON.parse(l).event === 'minute_aggregate')).toHaveLength(0); // minute not over

    // the minute rolls over: the sweep flushes one line per kind and type
    i.clock.now = Math.ceil(i.clock.now / 60_000) * 60_000 + 61_000;
    await new Promise((r) => setTimeout(r, 80));
    const lines = i.logs.map((l) => JSON.parse(l) as { event: string; code?: string; type?: string; count?: number });
    expect(lines.map((l) => l.event)).not.toContain('message_forwarded');
    const agg = lines.filter((l) => l.event === 'minute_aggregate' && l.code === 'forwarded' && l.type === 'level');
    expect(agg.reduce((n, l) => n + (l.count ?? 0), 0)).toBe(30);
    for (const l of lines.filter((x) => x.event === 'minute_aggregate')) {
      expect(Object.keys(l).sort()).toEqual(['code', 'count', 'event', ...(l.type ? ['type'] : [])].sort());
    }
    tv.close();
    phone.close();
  });

  it('flushes the open minute when the server stops, so a clean shutdown loses no counts', async () => {
    const i = await start();
    const tv = await open(i, null, 'tv');
    tv.send('room.create');
    const created = await tv.next('room.created');
    tv.roomId = created.payload.room_id as string;
    tv.generation = created.payload.generation as number;
    tv.nextSeq = 0;
    tv.send('session.begin'); // no phone is paired: counted as peer_offline, aggregated rather than logged per message
    await tv.next('error');
    expect(i.logs.map((l) => JSON.parse(l).event)).not.toContain('minute_aggregate'); // minute still open
    tv.close();
    await i.stop();
    const lines = i.logs.map((l) => JSON.parse(l) as { event: string; code?: string; count?: number });
    expect(lines.filter((l) => l.event === 'minute_aggregate' && l.code === 'peer_offline').reduce((n, l) => n + (l.count ?? 0), 0)).toBe(1);
  });
});

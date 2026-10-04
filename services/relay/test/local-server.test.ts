import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, createLocalServer, loadLocalConfig, type LocalConfig, type LocalServer } from '../src/local/index.js';
import { assertNoLeaks } from './helpers/rig.js';
import { SECRET_CUE, SECRET_PHRASE, VALID_PAYLOADS } from './helpers/fixtures.js';
import { WsClient } from './helpers/ws-client.js';

const PHONE_ORIGIN = 'https://phone.example.test';
const SCRIPT = fileURLToPath(new URL('../../../scripts/dev-certs/make-dev-certs.sh', import.meta.url));
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

let dir: string;
let staticDir: string;
let ca: Buffer;
let server: LocalServer;
let port: number;
let logs: string[];
let clock: { now: number };

const headersWanted = (h: Record<string, unknown>): void => {
  const csp = String(h['content-security-policy']);
  for (const part of ["default-src 'self'", "connect-src 'self' wss:", "script-src 'self'", "worker-src 'self' blob:"]) {
    expect(csp, part).toContain(part);
  }
  expect(csp).toContain("frame-ancestors 'none'");
  expect(h['permissions-policy']).toContain('microphone=(self)');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['strict-transport-security']).toBe('max-age=300');
};

function get(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, ca, servername: 'localhost' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, unknown>, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const wsUrl = (): string => `wss://127.0.0.1:${port}/ws`;
const connect = (origin: string | null, role: 'tv' | 'phone') =>
  WsClient.open(wsUrl(), role, { ca, ...(origin ? { headers: { Origin: origin } } : {}) }, () => clock.now);

describe.skipIf(!hasOpenssl)('local HTTPS/WSS server', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'atr-relay-test-'));
    // The certificate comes from the real dev-cert script (also exercises it).
    execFileSync('bash', [SCRIPT, '--out', join(dir, 'certs')], { stdio: 'pipe' });
    ca = readFileSync(join(dir, 'certs', 'ca.crt'));
    staticDir = join(dir, 'static');
    mkdirSync(join(staticDir, 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>phone</title><script src="/assets/app.js"></script>');
    writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("phone");');
    writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET-OUTSIDE-ROOT');
    symlinkSync(join(dir, 'secret.txt'), join(staticDir, 'leak.txt'));

    logs = [];
    clock = { now: Date.now() };
    const config: LocalConfig = {
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: [PHONE_ORIGIN],
      staticDir,
      tls: { certPath: join(dir, 'certs', 'server.crt'), keyPath: join(dir, 'certs', 'server.key') },
      insecureLocalhostOnly: false,
      hstsMaxAgeSeconds: 300,
      tickMs: 25,
      hashPepper: 'test',
      disabled: false,
    };
    server = createLocalServer({ config, logSink: (l) => logs.push(l), now: () => clock.now });
    port = (await server.start()).port;
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('static files and headers', () => {
    it('serves the phone page at / with the required security headers', async () => {
      const r = await get('/');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.body).toContain('<title>phone</title>');
      headersWanted(r.headers);
    });

    it('serves assets with a content type and the same headers; HEAD has no body', async () => {
      const r = await get('/assets/app.js');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
      headersWanted(r.headers);
      const h = await get('/assets/app.js', 'HEAD');
      expect(h.status).toBe(200);
      expect(h.body).toBe('');
    });

    it('sends the headers on errors too', async () => {
      const r = await get('/nope.html');
      expect(r.status).toBe(404);
      headersWanted(r.headers);
      const p = await get('/', 'POST');
      expect(p.status).toBe(405);
      expect(p.headers.allow).toBe('GET, HEAD');
      headersWanted(p.headers);
    });

    it.each([
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/%00',
      '/index.html%00.png',
      '/leak.txt', // symlink escaping the static root
      '/assets', // directory
      '/%',
    ])('does not serve %s', async (path) => {
      const r = await get(path);
      expect([400, 404]).toContain(r.status);
      expect(r.body).not.toContain('TOP-SECRET-OUTSIDE-ROOT');
    });

    it('answers /healthz and refuses plain GET on /ws with 426', async () => {
      const h = await get('/healthz');
      expect(h.status).toBe(200);
      expect(JSON.parse(h.body)).toEqual({ status: 'ok' });
      expect(h.headers['cache-control']).toBe('no-store');
      expect((await get('/ws')).status).toBe(426);
    });
  });

  describe('WebSocket relay over real TLS sockets', () => {
    it('refuses foreign Origins at the handshake and unknown paths', async () => {
      expect(await WsClient.probe(wsUrl(), { ca, headers: { Origin: 'https://evil.example.test' } })).toBe(403);
      expect(await WsClient.probe(wsUrl(), { ca, headers: { Origin: 'null' } })).toBe(403);
      expect(await WsClient.probe(wsUrl(), { ca, headers: { Origin: PHONE_ORIGIN } })).toBe(101);
      expect(await WsClient.probe(wsUrl(), { ca })).toBe(101); // missing Origin accepted at connect
      expect(await WsClient.probe(`wss://127.0.0.1:${port}/other`, { ca })).toBe(404);
    });

    it('rejects an untrusted TLS certificate', async () => {
      const status = await WsClient.probe(wsUrl(), { headers: { Origin: PHONE_ORIGIN } });
      expect(status).toBe(0);
    });

    it('runs pairing and forwarding end to end', async () => {
      const secrets: string[] = [];
      const tv = await connect(null, 'tv');
      tv.send('room.create');
      const created = await tv.next('room.created');
      tv.roomId = created.payload.room_id as string;
      tv.generation = created.payload.generation as number;
      tv.nextSeq = 0;
      secrets.push(created.payload.tv_credential as string, created.payload.pairing_code as string);

      const phone = await connect(PHONE_ORIGIN, 'phone');
      phone.send('join.request', { payload: { pairing_code: created.payload.pairing_code as string, device_label: 'Test phone' } });
      const pending = await phone.next('join.pending');
      const requested = await tv.next('join.requested');
      expect(requested.payload.confirm_digits).toBe(pending.payload.confirm_digits);
      expect(requested.payload.device_label).toBe('Test phone');

      tv.send('join.confirm', { payload: { join_id: requested.payload.join_id as string, decision: 'accept' } });
      const accepted = await phone.next('join.accepted');
      phone.roomId = accepted.payload.room_id as string;
      phone.generation = accepted.payload.generation as number;
      phone.nextSeq = 0;
      secrets.push(accepted.payload.phone_credential as string);
      await tv.next('peer.state');

      tv.send('session.begin');
      await phone.next('session.begin');

      // ordered level stream phone -> TV
      for (let i = 0; i < 50; i += 1) {
        phone.send('level', { payload: { ...(VALID_PAYLOADS.level as object), frame_index: i } });
      }
      await tv.waitFor(() => tv.of('level').length === 50, 5000, '50 level frames');
      expect(tv.of('level').map((m) => (m.payload.frame_index as number))).toEqual(Array.from({ length: 50 }, (_, i) => i));

      // TV command and phone observations with content
      const winRaw = tv.send('window.start');
      const gotWin = await phone.next('window.start');
      expect(gotWin.raw).toBe(winRaw);
      phone.send('phrases.update', { payload: { phrases: [SECRET_PHRASE] } });
      phone.send('cue', { payload: { text: SECRET_CUE } });
      await tv.next('cue');
      await tv.next('phrases.update');

      // a phone may not start windows
      phone.send('window.start');
      const err = await phone.next('error');
      expect(err.payload.code).toBe('forbidden_direction');

      // heartbeat
      phone.send('ping');
      expect((await phone.next('pong')).payload.server_time).toBeTypeOf('number');

      // binary frames are rejected and the socket is closed with 1003
      phone.sendRaw(Buffer.from([1, 2, 3, 4]), true);
      const closed = await phone.waitClosed();
      expect(closed.code).toBe(1003);
      expect(phone.of('error').at(-1)?.payload.code).toBe('binary_rejected');

      await tv.waitFor(() => tv.of('peer.state').some((m) => m.payload.connected === false), 5000, 'phone disconnect notice');
      tv.close();

      // nothing sensitive reached the log sink, which only ever received content-free lines
      expect(logs.length).toBeGreaterThan(0);
      assertNoLeaks(logs, [...secrets, SECRET_PHRASE, SECRET_CUE]);
    });

    it('rejects oversized text frames with payload_too_large and closes 1009', async () => {
      const c = await connect(PHONE_ORIGIN, 'phone');
      c.sendRaw(`{"pad":"${'x'.repeat(9000)}"}`);
      const closed = await c.waitClosed();
      expect(closed.code).toBe(1009);
      expect(c.of('error')[0]?.payload.code).toBe('payload_too_large');
    });

    it('closes unauthenticated connections at the 5 second deadline (virtual clock, real timers)', async () => {
      const c = await connect(PHONE_ORIGIN, 'phone');
      clock.now += 6000;
      const closed = await c.waitClosed();
      expect(closed.code).toBe(4401);
      expect(closed.reason).toBe('auth_deadline');
    });

    it('supersedes an older TV connection on resume', async () => {
      const tv = await connect(null, 'tv');
      tv.send('room.create');
      const created = await tv.next('room.created');
      const tv2 = await connect(null, 'tv');
      tv2.send('auth.resume', {
        payload: { room_id: created.payload.room_id as string, role: 'tv', credential: created.payload.tv_credential as string },
      });
      expect((await tv2.next('auth.ok')).payload.generation).toBe(2);
      expect((await tv.next('error')).payload.code).toBe('superseded');
      expect((await tv.waitClosed()).code).toBe(4409);
      tv2.close();
    });

    it('applies the kill switch at runtime: refuses new sockets and closes live ones on their next message', async () => {
      const live = await connect(PHONE_ORIGIN, 'phone');
      server.setDisabled(true);
      try {
        expect(await WsClient.probe(wsUrl(), { ca, headers: { Origin: PHONE_ORIGIN } })).toBe(503);
        live.send('ping');
        const closed = await live.waitClosed();
        expect(closed.code).toBe(4503);
        expect(live.of('error')[0]?.payload).toMatchObject({ code: 'internal', detail: 'relay_disabled' });
      } finally {
        server.setDisabled(false);
      }
      expect(await WsClient.probe(wsUrl(), { ca, headers: { Origin: PHONE_ORIGIN } })).toBe(101);
    });
  });
});

describe('local configuration (ADR-0006)', () => {
  const root = mkdtempSync(join(tmpdir(), 'atr-cfg-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('refuses to start without TLS material', () => {
    expect(() => loadLocalConfig({}, { root, lanAddresses: [] })).toThrow(ConfigError);
    expect(() => loadLocalConfig({}, { root, lanAddresses: [] })).toThrow(/refuses to start without TLS/);
    expect(() => loadLocalConfig({ ATR_TLS_CERT: '/nope/c.crt', ATR_TLS_KEY: '/nope/k.key' }, { root })).toThrow(/TLS/);
  });

  it('allows loopback-only plain HTTP only with ATR_INSECURE_LOCALHOST_ONLY=1', () => {
    const c = loadLocalConfig({ ATR_INSECURE_LOCALHOST_ONLY: '1' }, { root });
    expect(c.tls).toBeNull();
    expect(c.host).toBe('127.0.0.1');
    expect(c.insecureLocalhostOnly).toBe(true);
    expect(c.allowedOrigins).toEqual(['http://localhost:8443', 'http://127.0.0.1:8443']);
    expect(() => loadLocalConfig({ ATR_INSECURE_LOCALHOST_ONLY: '1', ATR_HOST: '0.0.0.0' }, { root })).toThrow(/loopback/);
  });

  it('documents defaults: port 8443, phone dist directory, certs/ in the repository root', () => {
    mkdirSync(join(root, 'repo', 'certs'), { recursive: true });
    mkdirSync(join(root, 'repo', 'services', 'relay'), { recursive: true });
    writeFileSync(join(root, 'repo', 'certs', 'server.crt'), 'x');
    writeFileSync(join(root, 'repo', 'certs', 'server.key'), 'x');
    const pkg = join(root, 'repo', 'services', 'relay');
    const c = loadLocalConfig({}, { root: pkg, lanAddresses: ['192.168.1.20'] });
    expect(c.port).toBe(8443);
    expect(c.host).toBe('0.0.0.0');
    expect(c.staticDir).toBe(join(root, 'repo', 'apps', 'phone', 'dist'));
    expect(c.tls).toEqual({ certPath: join(root, 'repo', 'certs', 'server.crt'), keyPath: join(root, 'repo', 'certs', 'server.key') });
    expect(c.allowedOrigins).toEqual(['https://localhost:8443', 'https://127.0.0.1:8443', 'https://192.168.1.20:8443']);
    expect(c.hstsMaxAgeSeconds).toBe(300);
  });

  it('validates the origin allowlist strictly', () => {
    const base = { ATR_INSECURE_LOCALHOST_ONLY: '1' };
    expect(() => loadLocalConfig({ ...base, ATR_ALLOWED_ORIGINS: 'https://a.example/' }, { root })).toThrow(/exact origins/);
    expect(() => loadLocalConfig({ ...base, ATR_ALLOWED_ORIGINS: 'https://a.example/path' }, { root })).toThrow(/exact origins/);
    expect(() => loadLocalConfig({ ...base, ATR_ALLOWED_ORIGINS: 'http://a.example' }, { root })).toThrow(/https/);
    expect(() => loadLocalConfig({ ...base, ATR_ALLOWED_ORIGINS: 'not a url' }, { root })).toThrow(/not a URL origin/);
    expect(loadLocalConfig({ ...base, ATR_ALLOWED_ORIGINS: 'https://a.example, http://localhost:3000' }, { root }).allowedOrigins).toEqual([
      'https://a.example',
      'http://localhost:3000',
    ]);
  });

  it('validates numeric settings and reads the kill switch', () => {
    const base = { ATR_INSECURE_LOCALHOST_ONLY: '1' };
    expect(() => loadLocalConfig({ ...base, ATR_PORT: 'abc' }, { root })).toThrow(ConfigError);
    expect(() => loadLocalConfig({ ...base, ATR_PORT: '70000' }, { root })).toThrow(ConfigError);
    expect(loadLocalConfig({ ...base, RELAY_DISABLED: 'true' }, { root }).disabled).toBe(true);
    expect(loadLocalConfig({ ...base }, { root }).disabled).toBe(false);
  });
});

describe('insecure loopback mode', () => {
  it('serves plain HTTP and WS on 127.0.0.1 only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atr-insecure-'));
    mkdirSync(join(root, 'static'));
    writeFileSync(join(root, 'static', 'index.html'), 'ok');
    const config = loadLocalConfig(
      { ATR_INSECURE_LOCALHOST_ONLY: '1', ATR_PORT: '0', ATR_STATIC_DIR: join(root, 'static'), ATR_ALLOWED_ORIGINS: 'http://localhost:3000' },
      { root },
    );
    const lines: string[] = [];
    const s = createLocalServer({ config, logSink: (l) => lines.push(l) });
    const started = await s.start();
    try {
      expect(started.host).toBe('127.0.0.1');
      const res = await new Promise<{ status: number; hsts: unknown }>((resolve, reject) => {
        const r = httpRequest({ host: '127.0.0.1', port: started.port, path: '/' }, (x) => {
          x.resume();
          resolve({ status: x.statusCode ?? 0, hsts: x.headers['strict-transport-security'] });
        });
        r.on('error', reject);
        r.end();
      });
      expect(res.status).toBe(200);
      expect(res.hsts).toBeUndefined(); // HSTS is only meaningful over TLS
      const c = await WsClient.open(`ws://127.0.0.1:${started.port}/ws`, 'tv', {});
      c.send('room.create');
      expect((await c.next('room.created')).payload.room_id).toMatch(/^r_/);
      c.close();
    } finally {
      await s.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

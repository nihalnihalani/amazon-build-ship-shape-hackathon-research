/**
 * T16 gate, part D: the phone page against hostile counterparts. Real relay, system Chrome, raw attacker sockets.
 * Evidence class: automated (desktop Chrome, synthetic audio build and production build).
 *
 *   SEC-W03  hostile QR / attacker room that auto-accepts: nothing leaves the phone before "Yes"
 *   SEC-W06  the phone's own command discipline after "Yes" (state machine; budget is a recorded gap)
 *   SEC-W02  production build: ?relay= ignored, test hooks absent, response headers
 *   SEC-W04  the page refuses to be framed
 *   SEC-W07  cross-site WebSocket hijacking from a foreign origin
 *   N-01     a legitimate reconnect over a half-open socket (fixed in the phone: refused resumes are retried for 30 s)
 *   N-02     CSP connect-src/worker-src, in the local server header and in the page's meta policy (both fixed)
 *   N-12     measurement cooldown asserted here; budget and idle limit in security/slow (opt-in, real time) and in the
 *            apps/phone unit tests
 *
 * No it.fails remain in this file: every finding it recorded is fixed and its test is a plain `it`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { buildArtifacts, startPhone, type PhoneEnv } from '../src/e2e-env.js';
import { Peer, ROOT, certDir, createRoom, sleep, startSecRelay, type Msg, type SecRelay } from './helpers.js';

interface TimedFrame {
  t: number;
  dir: 'in' | 'out';
  msg: Msg;
}

function recordFrames(phone: PhoneEnv, sink: TimedFrame[], urls: string[]): void {
  phone.page.on('websocket', (ws) => {
    urls.push(ws.url());
    const rec = (dir: 'in' | 'out') => (f: { payload: string | Buffer }) => {
      if (typeof f.payload === 'string') sink.push({ t: Date.now(), dir, msg: JSON.parse(f.payload) as Msg });
    };
    ws.on('framesent', rec('out'));
    ws.on('framereceived', rec('in'));
  });
}

/** A real TV pings every 10 s; an idle raw client is dropped by the relay after 25 s. */
function keepAlive(tv: Peer): () => void {
  const h = setInterval(() => {
    if (tv.client.isOpen) tv.send('ping');
  }, 8000);
  return () => clearInterval(h);
}

const COUNTERS = `
(() => {
  window.__gum = 0; window.__ctx = 0;
  const gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  if (gum) navigator.mediaDevices.getUserMedia = (...a) => { window.__gum += 1; return gum(...a); };
  const Native = window.AudioContext;
  if (Native) window.AudioContext = class extends Native { constructor(...a) { super(...a); window.__ctx += 1; } };
})();
`;

describe('SEC-W03 hostile QR: an attacker room that accepts anyone and then drives the phone', () => {
  let relay: SecRelay;
  let phone: PhoneEnv;
  const frames: TimedFrame[] = [];
  const wsUrls: string[] = [];
  beforeAll(async () => {
    buildArtifacts();
    relay = await startSecRelay({ staticDir: path.join(ROOT, 'apps/phone/dist-test') });
    phone = await startPhone();
    await phone.page.addInitScript(COUNTERS);
    recordFrames(phone, frames, wsUrls);
  }, 240_000);
  afterAll(async () => {
    await phone?.close();
    await relay?.stop();
  });

  it('before "Yes" the phone sends only join.request and ping, opens no microphone, accepts no command; "No, cancel" discards everything, sends nothing and leaves the attacker unable to reach the phone', async () => {
    const { page } = phone;
    // The attacker is a TV client of the real relay that accepts every join the moment it arrives.
    const { tv, code } = await createRoom(relay);
    const stopPing = keepAlive(tv);
    let commandsSent = 0;
    const drive = (): void => {
      // everything a hostile TV can say to a phone, with valid envelopes
      const send = (type: Parameters<Peer['send']>[0]): void => {
        tv.send(type);
        commandsSent += 1;
      };
      send('session.begin');
      send('session.state');
      send('precheck.start');
      send('window.start');
      send('listener.open');
      send('attempt.reveal');
      send('window.stop');
      send('session.end');
    };
    const autoAccept = (async () => {
      const req = await tv.client.next('join.requested', 30_000);
      tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' }); // no human, no number
      await tv.client.next('peer.state', 10_000); // the phone is now authenticated at the relay
      drive();
      await sleep(400);
      drive();
    })();

    // 1. The QR/link only pre-fills the field: no connection opens by itself.
    await page.goto(`${relay.origin}/#code=${code}`);
    await page.waitForSelector('#view-join:not([hidden])');
    await sleep(1200);
    expect(await page.inputValue('#code')).toBe(code);
    expect(wsUrls, 'no socket before the person taps Join').toEqual([]);
    expect(await page.evaluate(() => location.hash)).toBe(''); // the code is gone from the address bar

    // 2. The person taps Join; the attacker accepts at once; the page asks the question.
    await page.click('#join');
    await autoAccept;
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    const asked = await page.innerText('body');
    expect(asked).toMatch(/Did you just pick \d\d on your TV\?/);
    await sleep(3000); // the attacker's two bursts of commands arrive while the question is on screen

    // 3. Nothing but the join protocol and ping left the phone.
    const sent = frames.filter((f) => f.dir === 'out').map((f) => f.msg.type);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((t) => t !== 'join.request' && t !== 'ping'), 'messages sent before Yes').toEqual([]);
    // The attacker, who receives everything the phone sends after authentication, got nothing from it.
    const fromPhone = tv.client.inbox.filter((m) => m.sender_role === 'phone');
    expect(fromPhone.map((m) => m.type)).toEqual([]);
    expect(commandsSent).toBeGreaterThanOrEqual(16);
    // 4. No microphone, no audio context, no stream; the Start button is not available.
    expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __ctx: number }).__ctx)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __atrTestAudio: { getState(): { streamOpen: boolean } } }).__atrTestAudio.getState().streamOpen)).toBe(false);
    expect(await page.isVisible('#start-mic')).toBe(false);

    // 5. "No, cancel".
    const before = frames.length;
    await page.click('#confirm-no');
    await page.waitForSelector('#view-join:not([hidden])');
    await sleep(1500);
    const after = frames.slice(before).filter((f) => f.dir === 'out').map((f) => f.msg.type);
    expect(after.filter((t) => t !== 'ping'), 'messages sent after No').toEqual([]);
    expect(await page.isVisible('#start-mic')).toBe(false);
    // The attacker can no longer reach the phone: it is gone from the room.
    await tv.client.waitUntil(() => tv.client.inbox.some((m) => m.type === 'peer.state' && m.payload['connected'] === false), 8000, 'phone left the room');
    const from = tv.client.inbox.length;
    tv.send('session.begin');
    const err = await tv.client.nextError(5000, from);
    expect(err.code).toBe('not_found'); // peer_offline: the phone is no longer in the room
    expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    stopPing();
    tv.client.close();
  }, 120_000);

  it('after a legitimate "Yes" the phone still obeys its own state machine: window.start and precheck.start before any session.begin start nothing and send no level frame or result', async () => {
    const { page } = phone;
    await page.goto('about:blank'); // a hash-only change would not reload the page
    const { tv, code } = await createRoom(relay);
    const stopPing = keepAlive(tv);
    const accept = (async () => {
      const req = await tv.client.next('join.requested', 30_000);
      tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' });
    })();
    await page.goto(`${relay.origin}/#code=${code}`);
    await page.click('#join');
    await accept;
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    await page.click('#confirm-yes');
    await page.waitForSelector('#start-mic', { state: 'visible' });
    await page.click('#start-mic');
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
    const mark = frames.length;
    // A command for a window of a session the TV never announced.
    tv.send('window.start');
    tv.send('precheck.start');
    await sleep(2500);
    const out = frames.slice(mark).filter((f) => f.dir === 'out').map((f) => f.msg.type);
    expect(out.filter((t) => t === 'level' || t === 'window.result' || t === 'precheck.result')).toEqual([]);
    expect(await page.textContent('#mic-badge')).toMatch(/Mic open, not measuring/);
    stopPing();
    tv.client.close();
  }, 120_000);

  it('TM-G1 (N-12, fixed): once the person has said Yes and started the microphone, a paired TV that chains measurement windows is held to a 1 s cooldown (and a 5 minute session budget, and a 10 minute idle limit, covered by the phone unit tests)', async () => {
    const { page } = phone;
    await page.goto('about:blank');
    const { tv, code } = await createRoom(relay);
    const stopPing = keepAlive(tv);
    const accept = (async () => {
      const req = await tv.client.next('join.requested', 30_000);
      tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' });
    })();
    await page.goto(`${relay.origin}/#code=${code}`);
    await page.click('#join');
    await accept;
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    await page.click('#confirm-yes');
    await page.waitForSelector('#start-mic', { state: 'visible' });
    await page.click('#start-mic');
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
    const session = 's_secbudgetsess1';
    tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: session });
    await sleep(500);
    const mark = frames.length;
    const N = 15;
    let applied = 0;
    const refusals: string[] = [];
    const appliedIds = new Set<string>();
    for (let i = 0; i < N; i += 1) {
      const ids = { session_id: session, window_id: `w_secbudget${String(i).padStart(3, '0')}`, attempt_id: `a_secbudget${String(i).padStart(3, '0')}` };
      const startId = tv.send('window.start', { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 }, ids);
      await tv.client.waitUntil(() => tv.client.inbox.some((m) => m.type === 'ack' && m.payload['acked_message_id'] === startId), 8000, `ack for window ${i}`);
      const ack = tv.client.inbox.find((m) => m.type === 'ack' && m.payload['acked_message_id'] === startId) as Msg;
      if (ack.payload['outcome'] === 'applied') {
        applied += 1;
        appliedIds.add(ids.window_id);
      } else refusals.push(`${String(ack.payload['outcome'])}:${String(ack.payload['detail'])}`);
      await sleep(250);
      tv.send('window.cancel', { reason: 'user_cancel' }, ids);
      await sleep(250);
    }
    const levels = frames.slice(mark).filter((f) => f.dir === 'out' && f.msg.type === 'level').length;
    console.log('N-12 chained windows applied by the phone under the cooldown:', applied, 'of', N, '; refusals:', refusals.length, '; level frames sent:', levels);
    // Each cycle starts a window, cancels it after 250 ms and starts the next 250 ms later: well inside the 1 s cooldown.
    expect(applied).toBeGreaterThan(0);
    expect(applied).toBeLessThan(N);
    expect(refusals.length).toBe(N - applied);
    expect(new Set(refusals)).toEqual(new Set(['rejected:cooldown']));
    expect(levels).toBeGreaterThan(0);
    // T16 re-check of the rewrite: a refused window must not have measured anything. Every level frame belongs to a window that was applied.
    const levelWindows = new Set(frames.slice(mark).filter((f) => f.dir === 'out' && f.msg.type === 'level').map((f) => String(f.msg.window_id)));
    expect([...levelWindows].filter((w) => !appliedIds.has(w))).toEqual([]);
    expect(levelWindows.size).toBeLessThanOrEqual(applied);
    stopPing();
    tv.client.close();
  }, 120_000);
});

/** Splits a Content-Security-Policy into directives (on ';') and sources (on whitespace). */
function parseCsp(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t !== '');
    const [name, ...sources] = tokens;
    if (name !== undefined && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/** What may never appear in a source list of the phone page: scheme-only sources, bare wildcards, wildcard hosts, blob: and data:. */
function cspSourceProblems(directive: string, sources: readonly string[]): string[] {
  const problems: string[] = [];
  for (const src of sources) {
    if (/^[a-z][a-z0-9+.-]*:$/i.test(src)) problems.push(`${directive}: scheme-only source ${src}`);
    else if (src === '*') problems.push(`${directive}: bare wildcard`);
    else if (/^[a-z][a-z0-9+.-]*:\/\/\*\./i.test(src) || /^\*\./.test(src)) problems.push(`${directive}: wildcard host ${src}`);
    else if (/^(blob|data|filesystem):/i.test(src)) problems.push(`${directive}: ${src}`);
  }
  return problems;
}

/** The sources of connect-src and worker-src (and script-src) judged by the rules above, over a whole policy. */
function cspProblems(policy: string): string[] {
  const parsed = parseCsp(policy);
  const problems: string[] = [];
  for (const d of ['connect-src', 'worker-src', 'script-src', 'default-src']) problems.push(...cspSourceProblems(d, parsed.get(d) ?? []));
  return problems;
}

describe('SEC-W02 / SEC-W04 / SEC-W07: the production build and its response headers', () => {
  let relay: SecRelay;
  let other: SecRelay;
  let phone: PhoneEnv;
  beforeAll(async () => {
    relay = await startSecRelay(); // production build (apps/phone/dist)
    other = await startSecRelay(); // a second origin, used as the "foreign page"
    phone = await startPhone();
  }, 120_000);
  afterAll(async () => {
    await phone?.close();
    await relay?.stop();
    await other?.stop();
  });

  it('?relay= is ignored by the production build, no test hook or banner ships, and the page contacts only its own host', async () => {
    const wsUrls: string[] = [];
    const requested: string[] = [];
    phone.page.on('websocket', (ws) => wsUrls.push(ws.url()));
    phone.page.on('request', (r) => requested.push(r.url()));
    await phone.page.goto(`${relay.origin}/?relay=${encodeURIComponent('wss://evil.invalid/ws')}#code=ACDEFH`);
    await phone.page.waitForSelector('#join');
    await phone.page.click('#join');
    await sleep(2000);
    expect(wsUrls).toEqual([relay.wsUrl]);
    expect(requested.filter((u) => new URL(u).hostname === 'evil.invalid')).toEqual([]);
    expect(await phone.page.evaluate(() => typeof (window as unknown as { __atrTestAudio?: unknown }).__atrTestAudio)).toBe('undefined');
    expect(await phone.page.innerText('body')).not.toMatch(/Synthetic test audio/i);
  });

  it('SEC-W02: security headers on the page and on assets', async () => {
    const res = await new Promise<{ headers: Record<string, string | string[] | undefined>; status: number }>((resolve, reject) => {
      https.get({ host: 'localhost', port: relay.port, path: '/', ca: relay.ca }, (r) => {
        r.resume();
        resolve({ headers: r.headers, status: r.statusCode ?? 0 });
      }).on('error', reject);
    });
    expect(res.status).toBe(200);
    const csp = String(res.headers['content-security-policy']);
    for (const d of ["script-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"]) expect(csp, d).toContain(d);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|script-src[^;]*\*/);
    expect(String(res.headers['permissions-policy'])).toContain('microphone=(self)');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['strict-transport-security'])).toMatch(/max-age=\d+/);
    // the HTML also carries its own policy
    const html = readFileSync(path.join(ROOT, 'apps/phone/dist/index.html'), 'utf8');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval|<script(?![^>]*src=)[^>]*>[^<]/); // no inline script
  });

  it('N-02 (fixed): connect-src names only this origin and exact relay origins, no scheme wildcard, and worker-src has no blob:, in the server header and in the page meta policy', async () => {
    // The checker itself must not be vacuous: it has to flag the revision 1 policies it replaces.
    expect(cspProblems("default-src 'self'; connect-src 'self' wss:; worker-src 'self' blob:")).toEqual(['connect-src: scheme-only source wss:', 'worker-src: scheme-only source blob:']);
    expect(cspProblems("default-src 'none'; connect-src 'self' wss:; img-src 'self'")).toEqual(['connect-src: scheme-only source wss:']); // the old meta policy: `wss:;` must not hide behind the semicolon
    expect(cspProblems("connect-src 'self' ws: wss: https://*.example.test *")).toEqual(['connect-src: scheme-only source ws:', 'connect-src: scheme-only source wss:', 'connect-src: wildcard host https://*.example.test', 'connect-src: bare wildcard']);
    expect(cspProblems("worker-src 'self' blob:https://x.test")).toEqual(['worker-src: blob:https://x.test']);
    expect(cspProblems("default-src 'self'; connect-src 'self' wss://abc.execute-api.eu-west-1.amazonaws.com; worker-src 'self'")).toEqual([]);

    const header = await new Promise<string>((resolve, reject) => {
      https.get({ host: 'localhost', port: relay.port, path: '/', ca: relay.ca }, (r) => {
        r.resume();
        resolve(String(r.headers['content-security-policy']));
      }).on('error', reject);
    });
    const h = parseCsp(header);
    expect(cspProblems(header), header).toEqual([]);
    expect(h.get('connect-src'), 'header connect-src').toContain("'self'");
    for (const src of (h.get('connect-src') ?? []).filter((x) => x !== "'self'")) expect(src, 'header connect-src source').toMatch(/^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]+)(:\d{1,5})?$/i);
    expect(h.get('worker-src'), 'header worker-src').toEqual(["'self'"]);

    // the page's own policy, in the production build that this relay serves
    const html = readFileSync(path.join(ROOT, 'apps/phone/dist/index.html'), 'utf8');
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1];
    expect(meta, 'the page carries a meta policy').toBeDefined();
    const m = parseCsp(meta as string);
    expect(cspProblems(meta as string), meta).toEqual([]);
    expect(m.get('script-src')).toEqual(["'self'"]);
    expect(m.get('default-src')).toEqual(["'none'"]);
    expect(m.get('connect-src')?.[0]).toBe("'self'");
    for (const src of (m.get('connect-src') ?? []).filter((x) => x !== "'self'")) expect(src).toMatch(/^wss:\/\/[a-z0-9.-]+(:\d{1,5})?$/i); // production: wss only
    expect(meta).not.toMatch(/blob:|data:|unsafe-inline|unsafe-eval/);
  });

  it('SEC-W04: the page cannot be framed (CSP frame-ancestors none)', async () => {
    const page = await phone.context.newPage();
    await page.setContent(`<iframe id="f" src="${relay.origin}/" width="400" height="600"></iframe>`);
    await sleep(2500);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    expect(frame, 'the iframe exists').toBeDefined();
    const joinInside = frame ? await frame.$('#join').catch(() => null) : null;
    expect(joinInside, 'the phone page must not render inside a frame').toBeNull();
    await page.close();
  });

  it('SEC-W07: a page on a foreign origin cannot open the relay socket; the phone origin can', async () => {
    const probe = (page: import('playwright-core').Page, url: string): Promise<string> =>
      page.evaluate(
        (u) =>
          new Promise<string>((resolve) => {
            const ws = new window.WebSocket(u);
            const t = setTimeout(() => resolve('timeout'), 8000);
            ws.onopen = () => {
              clearTimeout(t);
              ws.close();
              resolve('open');
            };
            ws.onerror = () => {
              clearTimeout(t);
              resolve('error');
            };
          }),
        url,
      );
    const foreign = await phone.context.newPage();
    await foreign.goto(`${other.origin}/`);
    expect(await probe(foreign, relay.wsUrl)).toBe('error'); // Origin: the other relay's address, not on the allowlist
    await foreign.close();
    const own = await phone.context.newPage();
    await own.goto(`${relay.origin}/`);
    expect(await probe(own, relay.wsUrl)).toBe('open');
    await own.close();
  });
});

/** A WSS proxy that can leave the relay-side connection open and silent when the client side dies. */
class HalfOpenProxy {
  readonly pairs: Array<{ client: WebSocket; upstream: WebSocket }> = [];
  halfOpen = false;
  url = '';
  private server = https.createServer({ cert: readFileSync(path.join(certDir(), 'server.crt')), key: readFileSync(path.join(certDir(), 'server.key')) });
  private wss = new WebSocketServer({ server: this.server, path: '/ws', perMessageDeflate: false });
  constructor(private readonly relay: SecRelay) {}
  async start(): Promise<void> {
    this.wss.on('connection', (client, req) => {
      const headers: Record<string, string> = {};
      if (req.headers.origin) headers['Origin'] = String(req.headers.origin);
      const upstream = new WebSocket(this.relay.wsUrl, { ca: this.relay.ca, headers, perMessageDeflate: false });
      const queued: string[] = [];
      upstream.on('open', () => queued.splice(0).forEach((m) => upstream.send(m)));
      client.on('message', (d, bin) => {
        if (bin) return;
        const text = d.toString('utf8');
        if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
        else queued.push(text);
      });
      upstream.on('message', (d, bin) => {
        if (!bin && client.readyState === WebSocket.OPEN) client.send(d.toString('utf8'));
      });
      client.on('close', () => {
        if (!this.halfOpen) upstream.close();
      });
      upstream.on('close', () => client.close());
      client.on('error', () => undefined);
      upstream.on('error', () => undefined);
      this.pairs.push({ client, upstream });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const addr = this.server.address();
    this.url = `wss://localhost:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;
  }
  /** The client side dies (network switch); the relay's socket stays open and simply goes quiet. */
  killClientSideOnly(): void {
    this.halfOpen = true;
    for (const p of this.pairs) p.client.terminate();
  }
  async stop(): Promise<void> {
    for (const p of this.pairs) {
      p.client.terminate();
      p.upstream.terminate();
    }
    await new Promise<void>((r) => this.wss.close(() => this.server.close(() => r())));
  }
}

describe('N-01: a legitimate reconnect over a half-open socket (fixed)', () => {
  let relay: SecRelay;
  let proxy: HalfOpenProxy;
  let phone: PhoneEnv;
  beforeEach(async () => {
    buildArtifacts();
    // The proxy listens on a random loopback port: the page's CSP (connect-src) must be told about loopback relay origins,
    // exactly as tests/src/e2e-env.ts does since the CSP no longer allows any wss: host (N-02).
    relay = await startSecRelay({ staticDir: path.join(ROOT, 'apps/phone/dist-test'), env: { ATR_RELAY_ORIGINS: 'wss://localhost:*,wss://127.0.0.1:*' } });
    proxy = new HalfOpenProxy(relay);
    await proxy.start();
    phone = await startPhone();
  }, 240_000);
  afterEach(async () => {
    await phone?.close();
    await proxy?.stop();
    await relay?.stop();
  });

  it('N-01 (fixed): after the phone\'s network dies without a close, its own reconnect is refused while the relay holds the old socket, and the phone keeps retrying instead of treating that as "no longer paired"', async () => {
    const { page } = phone;
    const { tv, code } = await createRoom(relay);
    const stopPing = keepAlive(tv); // a real TV pings every 10 s; this raw one would be dropped for idleness (4408) during the long wait
    const phoneFrames: Array<{ dir: 'in' | 'out'; msg: Msg }> = [];
    page.on('websocket', (ws) => {
      const rec = (dir: 'in' | 'out') => (f: { payload: string | Buffer }) => {
        if (typeof f.payload === 'string') phoneFrames.push({ dir, msg: JSON.parse(f.payload) as Msg });
      };
      ws.on('framesent', rec('out'));
      ws.on('framereceived', rec('in'));
    });
    const accept = (async () => {
      const req = await tv.client.next('join.requested', 30_000);
      tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' });
    })();
    await page.goto(`${relay.origin}/?relay=${encodeURIComponent(proxy.url)}#code=${code}`);
    await page.click('#join');
    await accept;
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    await page.click('#confirm-yes');
    await page.waitForSelector('#view-setup:not([hidden])');
    await sleep(1500); // traffic: mic.state, pings
    proxy.killClientSideOnly(); // e.g. Wi-Fi to cellular: the relay never sees a close
    await sleep(6000);
    console.log('N-01 diagnostic, page text 6 s after the client side died:', JSON.stringify((await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 400)), 'join view visible:', await page.isVisible('#view-join'), 'setup view visible:', await page.isVisible('#view-setup'));
    // DESIRED behaviour: the phone gets back to the paired setup view with a live link within 30 s.
    await page.waitForFunction(() => /connected|Connected/.test(document.querySelector('#link')?.textContent ?? ''), undefined, { timeout: 30_000 });
    expect(await page.isVisible('#view-setup')).toBe(true);
    expect(await page.innerText('body')).not.toMatch(/no longer paired/i);
    // What happened on the wire: the phone's resumes were refused while the relay still held the old socket (generic
    // `unauthorized`, nothing about why), and a later resume succeeded with the SAME credential (a refusal does not consume it).
    const resumes = phoneFrames.filter((f) => f.dir === 'out' && f.msg.type === 'auth.resume');
    const refusals = phoneFrames.filter((f) => f.dir === 'in' && f.msg.type === 'error' && f.msg.payload['code'] === 'unauthorized');
    const ok = phoneFrames.filter((f) => f.dir === 'in' && f.msg.type === 'auth.ok');
    console.log('N-01 wire: resumes', resumes.length, 'refusals', refusals.length, 'auth.ok', ok.length);
    expect(refusals.length, 'at least one refused resume while the old socket was held').toBeGreaterThan(0);
    expect(resumes.length).toBeGreaterThan(refusals.length);
    expect(ok.length).toBeGreaterThan(0);
    const creds = new Set(resumes.map((f) => String((f.msg.payload as { credential?: unknown }).credential)));
    expect(creds.size, 'the same credential was presented until one resume succeeded (refusals do not consume it)').toBe(1);
    expect(JSON.stringify(refusals.map((f) => f.msg.payload))).not.toMatch(/superseded|live|connected|still/i); // the refusal says nothing about why
    stopPing();
    tv.client.close();
  }, 120_000);
});


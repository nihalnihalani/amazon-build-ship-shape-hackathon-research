import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { resolveRelayUrl } from '../src/config.js';
import { connectSrc, parseRelayUrl, relayUrlFromEnv } from '../src/relay-url.js';

describe('N-03: the build-time relay URL is validated', () => {
  it.each([
    ['wss://relay.example.com/ws', 'wss://relay.example.com/ws', 'wss://relay.example.com'],
    ['wss://abc123.execute-api.eu-west-1.amazonaws.com/prod', 'wss://abc123.execute-api.eu-west-1.amazonaws.com/prod', 'wss://abc123.execute-api.eu-west-1.amazonaws.com'],
    ['wss://relay.example.com:8443/ws', 'wss://relay.example.com:8443/ws', 'wss://relay.example.com:8443'],
    ['WSS://Relay.Example.COM/ws', 'wss://relay.example.com/ws', 'wss://relay.example.com'],
    ['wss://relay.example.com', 'wss://relay.example.com/', 'wss://relay.example.com'],
    ['wss://relay.example.com:443/ws', 'wss://relay.example.com/ws', 'wss://relay.example.com'],
  ])('accepts %s', (raw, url, origin) => {
    expect(parseRelayUrl(raw)).toEqual({ ok: true, url, origin });
  });

  it.each([
    ['ws://relay.example.com/ws', /must use wss/],
    ['https://relay.example.com/ws', /must use wss/],
    ['http://relay.example.com/ws', /must use wss/],
    ['javascript:alert(1)', /must use wss/],
    ['wss://user:secret@relay.example.com/ws', /credentials/],
    ['wss://user@relay.example.com/ws', /credentials/],
    ['wss://relay.example.com/ws?token=1', /query or a fragment/],
    ['wss://relay.example.com/ws#frag', /query or a fragment/],
    ['wss://', /not a valid URL/],
    ['not a url', /not a valid URL/],
    ['', /not a valid URL/],
    ['//relay.example.com/ws', /not a valid URL/],
  ])('rejects %j', (raw, why) => {
    const r = parseRelayUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(why);
  });

  it('unset or blank means same origin; anything else must be valid or the build fails with a message naming the variable', () => {
    expect(relayUrlFromEnv(undefined)).toBeNull();
    expect(relayUrlFromEnv('')).toBeNull();
    expect(relayUrlFromEnv('   ')).toBeNull();
    expect(relayUrlFromEnv('  wss://relay.example.com/ws  ')).toEqual({ url: 'wss://relay.example.com/ws', origin: 'wss://relay.example.com' });
    expect(() => relayUrlFromEnv('ws://relay.example.com/ws')).toThrow(/VITE_ATR_RELAY_URL must use wss/);
    expect(() => relayUrlFromEnv('garbage')).toThrow(/VITE_ATR_RELAY_URL is not a valid URL/);
  });
});

describe('N-02 / N-03: the CSP connect-src names this origin and the relay origin only', () => {
  it('production without a relay URL: this origin only', () => {
    expect(connectSrc(null, false)).toBe("'self'");
  });
  it('production with a relay URL: this origin plus that origin', () => {
    expect(connectSrc('wss://relay.example.com', false)).toBe("'self' wss://relay.example.com");
  });
  it('never contains a bare scheme (wss: or ws:), in either build', () => {
    for (const test of [false, true]) {
      for (const origin of [null, 'wss://relay.example.com']) {
        const tokens = connectSrc(origin, test).split(' ');
        expect(tokens).not.toContain('wss:');
        expect(tokens).not.toContain('ws:');
        expect(tokens).not.toContain('*');
        expect(tokens).not.toContain('https:');
      }
    }
  });
  it('the test build additionally allows loopback sockets only (so ?relay= can reach a local relay)', () => {
    const tokens = connectSrc(null, true).split(' ');
    expect(tokens).toEqual(["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*', 'wss://127.0.0.1:*', 'wss://localhost:*']);
  });
});

describe('N-03: what the page dials', () => {
  const loc = { protocol: 'https:', host: 'phone.example', search: '' };
  it('without a build-time URL: wss://<page host>/ws', () => {
    expect(resolveRelayUrl(loc, false)).toBe('wss://phone.example/ws');
    expect(resolveRelayUrl(loc, false, '')).toBe('wss://phone.example/ws');
  });
  it('with a build-time URL: that URL, whatever the page host', () => {
    expect(resolveRelayUrl(loc, false, 'wss://relay.example.com/ws')).toBe('wss://relay.example.com/ws');
  });
  it('production ignores ?relay= even with a build-time URL', () => {
    expect(resolveRelayUrl({ ...loc, search: '?relay=wss://evil.example/ws' }, false, 'wss://relay.example.com/ws')).toBe('wss://relay.example.com/ws');
  });
  it('the test build honours ?relay=, and otherwise falls back to the build-time URL', () => {
    expect(resolveRelayUrl({ ...loc, search: '?relay=wss://localhost:9/ws' }, true, 'wss://relay.example.com/ws')).toBe('wss://localhost:9/ws');
    expect(resolveRelayUrl(loc, true, 'wss://relay.example.com/ws')).toBe('wss://relay.example.com/ws');
  });
  it('an invalid baked-in value (which the build would have refused) falls back to same origin rather than something odd', () => {
    expect(resolveRelayUrl(loc, false, 'ws://relay.example.com/ws')).toBe('wss://phone.example/ws');
    expect(resolveRelayUrl(loc, false, 'garbage')).toBe('wss://phone.example/ws');
  });
});

// ---- the real build ---------------------------------------------------------------------------------------
const APP = resolve(import.meta.dirname ?? process.cwd() + '/test', '..');

function readAll(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

async function buildWith(relayUrl: string | undefined, mode = 'production'): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'atr-phone-build-'));
  const saved = process.env['VITE_ATR_RELAY_URL'];
  if (relayUrl === undefined) delete process.env['VITE_ATR_RELAY_URL'];
  else process.env['VITE_ATR_RELAY_URL'] = relayUrl;
  try {
    await build({ root: APP, configFile: join(APP, 'vite.config.ts'), mode, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    if (saved === undefined) delete process.env['VITE_ATR_RELAY_URL'];
    else process.env['VITE_ATR_RELAY_URL'] = saved;
  }
  return outDir;
}

describe('N-02 / N-03: the production build (real Vite build into a temporary directory)', () => {
  const RELAY = 'wss://relay-under-test.example.net/socket';

  it('with VITE_ATR_RELAY_URL: the URL is baked in, the CSP names exactly that origin, and there is no wss: wildcard', async () => {
    const dir = await buildWith(RELAY);
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(csp).toContain("connect-src 'self' wss://relay-under-test.example.net;");
      expect(csp).not.toMatch(/connect-src[^;]*\bwss?:(?!\/\/)/);
      expect(csp).not.toMatch(/blob:/);
      expect(readAll(dir)).toContain(RELAY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('without it: same origin, the CSP is connect-src \'self\', and no other host is baked in', async () => {
    const dir = await buildWith(undefined);
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(/connect-src[^;]*/.exec(html)?.[0]).toBe("connect-src 'self'");
      expect(readAll(dir)).not.toContain('relay-under-test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(['ws://relay.example.net/ws', 'https://relay.example.net/ws', 'wss://u:p@relay.example.net/ws', 'wss://relay.example.net/ws?x=1', 'nonsense'])(
    'an invalid VITE_ATR_RELAY_URL (%s) fails the build with a message naming the variable',
    async (bad) => {
      await expect(buildWith(bad)).rejects.toThrow(/VITE_ATR_RELAY_URL/);
    },
    60_000,
  );

  it('the environment cannot smuggle another value past validation: only the validated, normalised URL is in the bundle', async () => {
    const dir = await buildWith('  WSS://Relay-Under-Test.Example.NET/socket  ');
    try {
      const bundle = readAll(dir);
      expect(bundle).toContain(RELAY);
      expect(bundle).not.toContain('WSS://Relay-Under-Test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('the test build keeps the loopback allowance and still names a configured relay origin', async () => {
    const dir = await buildWith(RELAY, 'test-audio');
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      const connect = /connect-src[^;]*/.exec(html)?.[0] ?? '';
      expect(connect).toContain("'self'");
      expect(connect).toContain('wss://localhost:*');
      expect(connect).toContain('wss://relay-under-test.example.net');
      expect(connect.split(' ')).not.toContain('wss:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

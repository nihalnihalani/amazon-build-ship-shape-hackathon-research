import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface LocalConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  staticDir: string;
  /** null only when insecureLocalhostOnly is true. */
  tls: { certPath: string; keyPath: string } | null;
  insecureLocalhostOnly: boolean;
  hstsMaxAgeSeconds: number;
  tickMs: number;
  /** TV web-preview origins (development only; refused in production). */
  tvPreviewOrigins: string[];
  /** `production` rejects `client.platform: test`, preview origins, localhost origins and insecure mode. */
  environment: 'development' | 'staging' | 'production';
  /** Global cap on live rooms. */
  liveRoomCap: number;
  /**
   * Extra relay origins the phone page may open WebSockets to, added to the CSP `connect-src` (T16 N-02). Exact
   * `wss://host[:port]` (or `ws://localhost...` outside production); loopback hosts may use a `:*` port, which a
   * test rig with a fault proxy on a random port needs. The server's own origin never has to be listed.
   */
  relayOrigins: string[];
  disabled: boolean;
}

/** Package root: services/relay (two levels above both src/local and dist/local). */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function parseBool(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true';
}

function parseIntStrict(name: string, v: string | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || v === '') return dflt;
  if (!/^[0-9]+$/.test(v)) throw new ConfigError(`${name} must be an integer, got a non-numeric value`);
  const n = Number(v);
  if (n < min || n > max) throw new ConfigError(`${name} must be between ${min} and ${max}`);
  return n;
}

function lanIPv4(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function validateOrigins(name: string, origins: string[], production: boolean): void {
  for (const o of origins) {
    let parsed: URL;
    try {
      parsed = new URL(o);
    } catch {
      throw new ConfigError(`${name} contains an entry that is not a URL origin`);
    }
    if (parsed.origin !== o) {
      throw new ConfigError(`${name} entries must be exact origins (scheme://host[:port], no path, no trailing slash)`);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
      throw new ConfigError(`${name} entries must be https (http is accepted only for localhost)`);
    }
    if (production && (parsed.protocol !== 'https:' || local)) {
      throw new ConfigError(`${name} must not contain localhost or http origins when ATR_ENV=production`);
    }
  }
}

/** Validates ATR_RELAY_ORIGINS entries: exact ws/wss origins, no path; loopback-only `:*` port wildcard; production wss only. */
function validateRelayOrigins(origins: string[], production: boolean): void {
  for (const o of origins) {
    const m = /^(wss?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::(\*|[0-9]{1,5}))?$/.exec(o);
    if (!m) throw new ConfigError('ATR_RELAY_ORIGINS entries must be exact ws:// or wss:// origins (scheme://host[:port], no path)');
    const [, scheme, host, port] = m as unknown as [string, string, string, string | undefined];
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    if (port === '*' && !loopback) throw new ConfigError('ATR_RELAY_ORIGINS may use a * port only on localhost, 127.0.0.1 or [::1]');
    if (port !== undefined && port !== '*' && Number(port) > 65535) throw new ConfigError('ATR_RELAY_ORIGINS has an invalid port');
    if (scheme === 'ws' && !loopback) throw new ConfigError('ATR_RELAY_ORIGINS entries must be wss (ws only for localhost)');
    if (production && (scheme !== 'wss' || loopback)) {
      throw new ConfigError('ATR_RELAY_ORIGINS must contain only non-localhost wss origins when ATR_ENV=production');
    }
  }
}

/** The WebSocket origin of a page origin: https -> wss, http -> ws. */
export function wsOriginOf(pageOrigin: string): string {
  return pageOrigin.replace(/^http/, 'ws');
}

function parseList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

export function loadLocalConfig(
  env: NodeJS.ProcessEnv,
  opts: { root?: string; lanAddresses?: string[] } = {},
): LocalConfig {
  const root = opts.root ?? packageRoot();
  const envName = env.ATR_ENV && env.ATR_ENV !== '' ? env.ATR_ENV : 'development';
  if (envName !== 'development' && envName !== 'staging' && envName !== 'production') {
    throw new ConfigError('ATR_ENV must be development, staging or production');
  }
  const production = envName === 'production';
  const insecure = parseBool(env.ATR_INSECURE_LOCALHOST_ONLY);
  if (production && insecure) {
    throw new ConfigError('ATR_INSECURE_LOCALHOST_ONLY is not allowed when ATR_ENV=production');
  }
  const port = parseIntStrict('ATR_PORT', env.ATR_PORT, 8443, 0, 65535);

  const host = env.ATR_HOST && env.ATR_HOST !== '' ? env.ATR_HOST : insecure ? '127.0.0.1' : '0.0.0.0';
  if (insecure && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new ConfigError('ATR_INSECURE_LOCALHOST_ONLY=1 binds loopback only; ATR_HOST must be 127.0.0.1, localhost or ::1');
  }

  const staticDir = resolve(root, env.ATR_STATIC_DIR && env.ATR_STATIC_DIR !== '' ? env.ATR_STATIC_DIR : '../../apps/phone/dist');

  let tls: LocalConfig['tls'] = null;
  if (!insecure) {
    const certPath = resolve(root, env.ATR_TLS_CERT && env.ATR_TLS_CERT !== '' ? env.ATR_TLS_CERT : '../../certs/server.crt');
    const keyPath = resolve(root, env.ATR_TLS_KEY && env.ATR_TLS_KEY !== '' ? env.ATR_TLS_KEY : '../../certs/server.key');
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      throw new ConfigError(
        'TLS certificate or key not found. The relay refuses to start without TLS. ' +
          'Run scripts/dev-certs/make-dev-certs.sh (see docs/operations/LOCAL_RELAY.md), set ATR_TLS_CERT and ATR_TLS_KEY, ' +
          'or set ATR_INSECURE_LOCALHOST_ONLY=1 for a loopback-only run that phones cannot use.',
      );
    }
    tls = { certPath, keyPath };
  }

  const scheme = insecure ? 'http' : 'https';
  let allowedOrigins: string[];
  if (env.ATR_ALLOWED_ORIGINS !== undefined && env.ATR_ALLOWED_ORIGINS.trim() !== '') {
    allowedOrigins = parseList(env.ATR_ALLOWED_ORIGINS);
  } else if (production) {
    throw new ConfigError('ATR_ALLOWED_ORIGINS must be set explicitly when ATR_ENV=production (no localhost or LAN defaults)');
  } else {
    const hosts = ['localhost', '127.0.0.1', ...(insecure ? [] : (opts.lanAddresses ?? lanIPv4()))];
    allowedOrigins = hosts.map((h) => `${scheme}://${h}:${port}`);
  }
  validateOrigins('ATR_ALLOWED_ORIGINS', allowedOrigins, production);
  const tvPreviewOrigins = parseList(env.ATR_TV_PREVIEW_ORIGINS);
  if (production && tvPreviewOrigins.length > 0) {
    throw new ConfigError('ATR_TV_PREVIEW_ORIGINS must be empty when ATR_ENV=production (the preview origin is never a production origin)');
  }
  validateOrigins('ATR_TV_PREVIEW_ORIGINS', tvPreviewOrigins, false);
  for (const o of tvPreviewOrigins) {
    if (allowedOrigins.includes(o)) throw new ConfigError('an origin cannot be both in ATR_ALLOWED_ORIGINS and ATR_TV_PREVIEW_ORIGINS');
  }

  const relayOrigins = parseList(env.ATR_RELAY_ORIGINS);
  validateRelayOrigins(relayOrigins, production);

  return {
    port,
    host,
    allowedOrigins,
    staticDir: isAbsolute(staticDir) ? staticDir : resolve(root, staticDir),
    tls,
    insecureLocalhostOnly: insecure,
    hstsMaxAgeSeconds: parseIntStrict('ATR_HSTS_MAX_AGE', env.ATR_HSTS_MAX_AGE, 300, 0, 63_072_000),
    tickMs: parseIntStrict('ATR_TICK_MS', env.ATR_TICK_MS, 5000, 10, 60_000),
    tvPreviewOrigins,
    environment: envName,
    liveRoomCap: parseIntStrict('ATR_LIVE_ROOM_CAP', env.ATR_LIVE_ROOM_CAP, 200, 1, 100_000),
    relayOrigins,
    disabled: parseBool(env.RELAY_DISABLED),
  };
}

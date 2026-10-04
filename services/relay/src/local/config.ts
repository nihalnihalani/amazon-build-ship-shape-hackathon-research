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
  /** Secret mixed into pairing-code hashes; random per process when not configured. */
  hashPepper: string | null;
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

export function loadLocalConfig(
  env: NodeJS.ProcessEnv,
  opts: { root?: string; lanAddresses?: string[] } = {},
): LocalConfig {
  const root = opts.root ?? packageRoot();
  const insecure = parseBool(env.ATR_INSECURE_LOCALHOST_ONLY);
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
    allowedOrigins = env.ATR_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter((s) => s !== '');
  } else {
    const hosts = ['localhost', '127.0.0.1', ...(insecure ? [] : (opts.lanAddresses ?? lanIPv4()))];
    allowedOrigins = hosts.map((h) => `${scheme}://${h}:${port}`);
  }
  for (const o of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(o);
    } catch {
      throw new ConfigError('ATR_ALLOWED_ORIGINS contains an entry that is not a URL origin');
    }
    if (parsed.origin !== o) {
      throw new ConfigError('ATR_ALLOWED_ORIGINS entries must be exact origins (scheme://host[:port], no path, no trailing slash)');
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      throw new ConfigError('ATR_ALLOWED_ORIGINS entries must be https (http is accepted only for localhost)');
    }
  }

  return {
    port,
    host,
    allowedOrigins,
    staticDir: isAbsolute(staticDir) ? staticDir : resolve(root, staticDir),
    tls,
    insecureLocalhostOnly: insecure,
    hstsMaxAgeSeconds: parseIntStrict('ATR_HSTS_MAX_AGE', env.ATR_HSTS_MAX_AGE, 300, 0, 63_072_000),
    tickMs: parseIntStrict('ATR_TICK_MS', env.ATR_TICK_MS, 5000, 10, 60_000),
    hashPepper: env.ATR_HASH_PEPPER && env.ATR_HASH_PEPPER !== '' ? env.ATR_HASH_PEPPER : null,
    disabled: parseBool(env.RELAY_DISABLED),
  };
}

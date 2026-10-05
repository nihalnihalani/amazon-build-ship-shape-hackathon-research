import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Where the page may open WebSockets (connect-src sources): the page's own origin (`'self'`) plus the relay
 * origins this server is configured with, never a scheme wildcard (T16 N-02). `connectOrigins` holds exact
 * `wss://host[:port]` (or `ws://` for localhost) origins, which load-config derives from the allowed page origins and
 * the explicit ATR_RELAY_ORIGINS list.
 */
export function connectSrc(connectOrigins: readonly string[]): string {
  return ["'self'", ...new Set(connectOrigins)].join(' ');
}

/**
 * Security headers sent on every response of the local server. The CSP matches the CloudFront response
 * headers policy in infra/template.yaml, except that connect-src there names the relay's API Gateway wss origin.
 * There is no blob worker source: the audio worklet is a same-origin file.
 */
export function securityHeaders(opts: {
  tls: boolean;
  hstsMaxAgeSeconds: number;
  connectOrigins?: readonly string[];
}): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': [
      "default-src 'self'",
      `connect-src ${connectSrc(opts.connectOrigins ?? [])}`,
      "script-src 'self'",
      "worker-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (opts.tls) h['Strict-Transport-Security'] = `max-age=${opts.hstsMaxAgeSeconds}`;
  return h;
}

export interface StaticOptions {
  root: string;
  headers: Record<string, string>;
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: string): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** Resolves a request path to a file strictly inside root (symlinks included), or null. */
export async function resolveStaticPath(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const rel = decoded === '/' ? '/index.html' : decoded;
  const candidate = resolve(root, `.${rel}`);
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) return null;
  try {
    const [realCandidate, realRoot] = await Promise.all([realpath(candidate), realpath(rootResolved)]);
    if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) return null;
    const s = await stat(realCandidate);
    return s.isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string, o: StaticOptions): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { ...o.headers, Allow: 'GET, HEAD' }, 'method not allowed\n');
    return;
  }
  const file = await resolveStaticPath(o.root, urlPath);
  if (!file) {
    send(res, 404, { ...o.headers, 'Cache-Control': 'no-store' }, 'not found\n');
    return;
  }
  const s = await stat(file);
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    ...o.headers,
    'Content-Type': type,
    'Content-Length': s.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

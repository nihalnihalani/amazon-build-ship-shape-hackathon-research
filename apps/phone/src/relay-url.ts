/**
 * Build-time relay URL (N-03). Pure, no browser or Node APIs, so the Vite config, the runtime
 * resolver and the tests all use exactly the same rules.
 *
 * `VITE_ATR_RELAY_URL` names the relay's WebSocket endpoint when the phone page and the relay are
 * on different hosts (the AWS layout: the page on a CDN, the socket on an API host). It must be a
 * `wss://` URL with a host, and nothing that could smuggle data: no credentials, query or fragment.
 * Unset means "same origin": the page dials `wss://<its own host>/ws`.
 */

export type RelayUrlCheck = { ok: true; url: string; origin: string } | { ok: false; reason: string };

export function parseRelayUrl(raw: string): RelayUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'is not a valid URL' };
  }
  if (url.protocol !== 'wss:') return { ok: false, reason: 'must use wss:// (TLS); plain ws:// and other schemes are not allowed' };
  if (url.hostname === '') return { ok: false, reason: 'has no host' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'must not contain credentials' };
  if (url.search !== '' || url.hash !== '') return { ok: false, reason: 'must not contain a query or a fragment' };
  return { ok: true, url: url.toString(), origin: `wss://${url.host}` };
}

/** Reads the optional build-time value: empty or unset is "same origin" (null); anything else must be valid. */
export function relayUrlFromEnv(value: string | undefined): { url: string; origin: string } | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = parseRelayUrl(value.trim());
  if (!parsed.ok) throw new Error(`VITE_ATR_RELAY_URL ${parsed.reason} (got "${value}")`);
  return { url: parsed.url, origin: parsed.origin };
}

/**
 * The CSP `connect-src` for the page. Production: this origin plus the configured relay origin,
 * nothing else (no `wss:` scheme wildcard). The test build additionally allows loopback sockets
 * so `?relay=` can point at a local relay.
 */
export function connectSrc(relayOrigin: string | null, testBuild: boolean): string {
  const sources = ["'self'"];
  if (testBuild) sources.push('ws://127.0.0.1:*', 'ws://localhost:*', 'wss://127.0.0.1:*', 'wss://localhost:*');
  if (relayOrigin !== null) sources.push(relayOrigin);
  return sources.join(' ');
}

/**
 * URL helpers, deliberately regex based: React Native's URL implementation is incomplete
 * (no reliable `origin`), so nothing here uses `new URL`.
 */

const SCHEME_AND_HOST = /^(wss?|https?):\/\/([^/?#]+)/i;

/** The relay socket URL: https -> wss, http -> ws; ws/wss unchanged. */
export function relaySocketUrl(relayUrl: string): string {
  const match = SCHEME_AND_HOST.exec(relayUrl);
  if (!match) return relayUrl;
  const scheme = (match[1] ?? '').toLowerCase();
  const rest = relayUrl.slice(match[1]?.length ?? 0);
  if (scheme === 'https') return `wss${rest}`;
  if (scheme === 'http') return `ws${rest}`;
  return relayUrl;
}

/** The https origin of the relay host. The phone page is served from here unless `phonePageOrigin` is configured. */
function relayHttpsOrigin(relayUrl: string): string {
  const match = SCHEME_AND_HOST.exec(relayUrl);
  if (!match) return relayUrl;
  return `https://${match[2] ?? ''}`;
}

// A DNS name or IPv4 address (labels of letters, digits and hyphens), or a bracketed IPv6 literal, then an optional port.
const ORIGIN_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?$/;

/**
 * Validates the `phonePageOrigin` option (contract revision 3): an https origin and nothing else, so
 * `https://d123.cloudfront.net` or `https://phone.example.test:8443`. Scheme and host are lower-cased. Returns the
 * origin, or null when the value is not one: a non-string, another scheme (http, wss, ...), user info, a path (even
 * a lone trailing slash), a query, a fragment, whitespace or a malformed host or port. Regex based on purpose: no
 * `new URL` (see the top of this file).
 */
export function validatePhonePageOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/([^/?#@\s\\%]+)$/i.exec(value);
  if (!match) return null;
  const authority = (match[1] ?? '').toLowerCase();
  const host = ORIGIN_HOST.exec(authority);
  if (!host) return null;
  const port = host[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return `https://${authority}`;
}

/**
 * The ONE place that builds the phone join URL (the QR payload and the shown link). The code is in the fragment so
 * it is never sent to a server in a request line or logged by an HTTP origin. The page origin is `phonePageOrigin`
 * when it is a valid https origin (the phone page is on another host than the relay, for example CloudFront in front
 * of an execute-api relay), otherwise the relay URL's https origin.
 */
export function phoneJoinUrl(relayUrl: string, code: string, phonePageOrigin?: string | null): string {
  const origin = validatePhonePageOrigin(phonePageOrigin) ?? relayHttpsOrigin(relayUrl);
  return `${origin}/#code=${encodeURIComponent(code)}`;
}

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

/** The https origin that serves the phone page (the relay host; microphone needs a secure origin). */
export function phonePageOrigin(relayUrl: string): string {
  const match = SCHEME_AND_HOST.exec(relayUrl);
  if (!match) return relayUrl;
  return `https://${match[2] ?? ''}`;
}

/**
 * The ONE place that builds the phone join URL (the QR payload). The code is in the fragment so it
 * is never sent to a server in a request line or logged by an HTTP origin.
 */
export function phoneJoinUrl(relayUrl: string, code: string): string {
  return `${phonePageOrigin(relayUrl)}/#code=${encodeURIComponent(code)}`;
}

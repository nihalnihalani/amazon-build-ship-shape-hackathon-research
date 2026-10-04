/** Constants from PROTOCOL.md, ADR-0002/0003/0004/0006. Product wording lives here too. */

export const PROTOCOL_VERSION = 1;

/** ADR-0002: exact phone UI privacy wording. Do not paraphrase. */
export const PRIVACY_SENTENCE =
  'Audio stays on this phone and is never saved or uploaded. Only levels, typed phrases, listener responses, and connection details are sent to the relay and TV.';

/** PROTOCOL.md section 7 / ADR-0003: pairing code alphabet (22 characters, 6 long). */
export const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
export const CODE_LENGTH = 6;

export const LIMITS = {
  deviceLabelMax: 24,
  phrasesMin: 1,
  phrasesMax: 10,
  phraseMaxCodePoints: 60,
  cueMaxCodePoints: 12,
  cuesPerSession: 3,
  levelFramesMax: 700,
  messageMaxBytes: 8192,
} as const;

export const DEFAULT_CUE_WORD = 'Volume';

/** ADR-0006: exponential backoff 0.5, 1, 2, 4, 8 s, capped at 8 s. */
export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
/** PROTOCOL.md section 7: ping every 10 s; peer unknown after 25 s without traffic. */
export const HEARTBEAT_MS = 10_000;
export const LINK_DEAD_MS = 25_000;

/** One frame is 50 ms of samples (ADR-0001 section 1). */
export const FRAME_MS = 50;

export interface LocationLike {
  protocol: string;
  host: string;
  search: string;
}

/**
 * Relay endpoint. Production: always `wss://<this host>/ws`. The `?relay=` override is
 * honoured ONLY in the test build, and only for ws:/wss: URLs.
 */
export function resolveRelayUrl(loc: LocationLike, testBuild: boolean): string {
  const fallback = `wss://${loc.host}/ws`;
  if (!testBuild) return fallback;
  const raw = new URLSearchParams(loc.search).get('relay');
  if (raw === null || raw === '') return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return url.toString();
  } catch {
    /* fall through to the default */
  }
  return fallback;
}

export function defaultDeviceLabel(userAgent: string): string {
  return /Android/i.test(userAgent) && /Chrome/i.test(userAgent) ? 'Android Chrome' : 'Browser';
}

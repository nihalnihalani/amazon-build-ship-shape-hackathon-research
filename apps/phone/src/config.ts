/** Constants from PROTOCOL.md, ADR-0002/0003/0004/0006. Product wording lives here too. */

import { parseRelayUrl } from './relay-url.js';
import {
  CUE_LENGTH_MAX,
  CUES_PER_SESSION_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  LEVEL_FRAMES_PER_WINDOW_MAX,
  MAX_MESSAGE_BYTES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_COUNT_MAX,
  PHRASE_COUNT_MIN,
  PHRASE_LENGTH_MAX,
} from './ports/wire.js';

/**
 * Exact phone UI privacy wording, from docs/adr/AMENDMENTS-REV2.md (A2-01, which supersedes the
 * ADR-0002 revision 1 sentence). Do not paraphrase.
 */
export const PRIVACY_SENTENCE =
  'Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.';

/** PROTOCOL.md section 7 / ADR-0003: pairing code alphabet (22 characters, 6 long). */
export const CODE_ALPHABET: string = PAIRING_ALPHABET;
export const CODE_LENGTH: number = PAIRING_CODE_LENGTH;

/** Limits come from @atr/protocol (via the wire port); nothing is restated here. */
export const LIMITS = {
  deviceLabelMax: DEVICE_LABEL_LENGTH_MAX,
  phrasesMin: PHRASE_COUNT_MIN,
  phrasesMax: PHRASE_COUNT_MAX,
  phraseMaxCodePoints: PHRASE_LENGTH_MAX,
  cueMaxCodePoints: CUE_LENGTH_MAX,
  cuesPerSession: CUES_PER_SESSION_MAX,
  levelFramesMax: LEVEL_FRAMES_PER_WINDOW_MAX,
  messageMaxBytes: MAX_MESSAGE_BYTES,
} as const;

export const DEFAULT_CUE_WORD = 'Volume';

/** ADR-0006: exponential backoff 0.5, 1, 2, 4, 8 s, capped at 8 s, with +/-25 % jitter (A6-02). */
export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
export const RECONNECT_JITTER = 0.25;
/**
 * N-01: a refused `auth.resume` after a half-open drop is retried for this long (the relay's
 * supersede guard of 25 s plus margin) before the pairing is considered lost.
 */
export const RESUME_REFUSAL_WINDOW_MS = 30_000;
/**
 * N-12: phone-side measurement limits, so a paired TV (or a stolen TV credential) cannot use the
 * phone as an open-ended ambient-sound monitor.
 */
export const SESSION_CAPTURE_BUDGET_MS = 5 * 60_000; // cumulative capture per session (prechecks + windows)
export const WINDOW_COOLDOWN_MS = 1000; // between the end of one window and the start of the next
export const MIC_IDLE_OFF_MS = 10 * 60_000; // microphone turns itself off without any TV command
/** A6-02: after this long without a successful connection, report `failed` and stop retrying. */
export const FAILURE_WINDOW_MS = 120_000;
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
/**
 * The relay URL baked in at build time from VITE_ATR_RELAY_URL (validated by vite.config.ts), or ''
 * for "same origin". See STATE_MACHINE.md, "Relay URL and CSP".
 */
export const BUILD_RELAY_URL: string = import.meta.env.VITE_ATR_RELAY_URL ?? '';

export function resolveRelayUrl(loc: LocationLike, testBuild: boolean, buildRelayUrl = ''): string {
  // N-03: a relay URL baked in at build time (VITE_ATR_RELAY_URL, validated there and again here)
  // replaces the same-origin default. In production nothing else can change it.
  const built = buildRelayUrl === '' ? null : parseRelayUrl(buildRelayUrl);
  const fallback = built !== null && built.ok ? built.url : `wss://${loc.host}/ws`;
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

import { CODE_ALPHABET, CODE_LENGTH } from './config.js';

/** Case-insensitive input, normalized to upper case; spaces and hyphens are ignored. */
export function normalizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '').slice(0, CODE_LENGTH);
}

export interface CodeCheck {
  ok: boolean;
  /** Plain-language problem, or null when ok / still being typed with valid characters. */
  message: string | null;
}

export function checkCode(code: string): CodeCheck {
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) {
      return {
        ok: false,
        message: `"${ch}" is not used in codes. Codes use these characters: ${CODE_ALPHABET.split('').join(' ')}.`,
      };
    }
  }
  if (code.length === 0) return { ok: false, message: null };
  if (code.length !== CODE_LENGTH) {
    return { ok: false, message: `The code has ${CODE_LENGTH} characters; you have entered ${code.length}.` };
  }
  return { ok: true, message: null };
}

/**
 * Reads `#code=XXXXXX` from a location hash. Hash fragments are never sent to servers.
 * Returns a normalized valid code, or null.
 */
export function readCodeFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const raw = params.get('code');
  if (raw === null) return null;
  // Not truncated: a fragment with more than 6 characters is rejected, not silently cut.
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return checkCode(code).ok ? code : null;
}

export interface HashHost {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(data: unknown, unused: string, url?: string | null): void };
}

/** Reads `#code=XXXXXX` once and removes the fragment from the address bar and history entry. */
export function consumeHashCode(host: HashHost): string | null {
  const code = readCodeFromHash(host.location.hash);
  if (host.location.hash !== '') host.history.replaceState(null, '', host.location.pathname + host.location.search);
  return code;
}

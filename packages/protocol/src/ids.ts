/**
 * Identifier generation: prefix + 22 base64url characters from 16 random bytes
 * (128 bits). Credentials and pairing codes are NOT generated here; only the
 * relay creates those (ADR-0003).
 *
 * Randomness: caller-supplied `randomBytes`, else `globalThis.crypto.getRandomValues`
 * when present, else a NON-cryptographic fallback (Math.random + time + counter).
 * The fallback is acceptable only because these ids are identifiers, not secrets;
 * `factory.cryptographic` reports which source is in use.
 */

export type RandomBytes = (length: number) => Uint8Array;

export interface IdFactory {
  /** `m_` + 22 base64url chars. */
  message(): string;
  room(): string;
  session(): string;
  window(): string;
  attempt(): string;
  join(): string;
  /** False when the non-cryptographic fallback generator is in use. */
  readonly cryptographic: boolean;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding. 16 bytes give exactly 22 characters. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63) + B64URL.charAt((n >> 6) & 63) + B64URL.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63) + B64URL.charAt((n >> 6) & 63);
  }
  return out;
}

interface CryptoLike {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function webCryptoSource(): RandomBytes | null {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const get = c.getRandomValues.bind(c);
    return (length) => {
      const a = new Uint8Array(length);
      get(a);
      return a;
    };
  }
  return null;
}

/** NON-cryptographic generator: xorshift128 seeded from Math.random, the clock and a counter. */
function fallbackSource(): RandomBytes {
  let counter = 0;
  let s0 = (Math.random() * 0x100000000) >>> 0;
  let s1 = (Date.now() & 0xffffffff) >>> 0;
  let s2 = (Math.random() * 0x100000000) >>> 0;
  let s3 = 0x9e3779b9;
  const next = (): number => {
    counter = (counter + 1) >>> 0;
    s3 = (s3 ^ counter ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0;
    let t = s3;
    const s = s0;
    s3 = s2;
    s2 = s1;
    s1 = s;
    t = (t ^ (t << 11)) >>> 0;
    t = (t ^ (t >>> 8)) >>> 0;
    s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return s0;
  };
  for (let i = 0; i < 8; i += 1) next();
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (next() >>> ((i % 4) * 8)) & 0xff;
    return out;
  };
}

/**
 * Create an id factory. Pass `randomBytes` (for example from the platform's
 * cryptographic RNG or a seeded test source) to control randomness; the caller
 * then owns its quality and `cryptographic` is reported as true.
 */
export function createIdFactory(randomBytes?: RandomBytes): IdFactory {
  let source: RandomBytes;
  let cryptographic: boolean;
  if (randomBytes) {
    source = randomBytes;
    cryptographic = true;
  } else {
    const web = webCryptoSource();
    source = web ?? fallbackSource();
    cryptographic = web !== null;
  }
  const make = (prefix: string): string => {
    const bytes = source(16);
    if (!bytes || !ArrayBuffer.isView(bytes) || bytes.length !== 16) {
      throw new Error('randomBytes(16) must return a Uint8Array of 16 bytes');
    }
    return prefix + base64UrlEncode(bytes);
  };
  return {
    message: () => make('m_'),
    room: () => make('r_'),
    session: () => make('s_'),
    window: () => make('w_'),
    attempt: () => make('a_'),
    join: () => make('j_'),
    cryptographic,
  };
}

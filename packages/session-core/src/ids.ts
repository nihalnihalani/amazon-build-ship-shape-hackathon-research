const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export type RandomBytes = (n: number) => Uint8Array;

/** Non-cryptographic fallback. Identifiers here are not secrets (they only bind messages to an attempt). */
function fallbackRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Creates `prefix + chars` identifiers in the base64url alphabet (6 bits per character). */
export function createIdGenerator(randomBytes?: RandomBytes): (prefix: string, chars?: number) => string {
  const source = randomBytes ?? fallbackRandomBytes;
  return (prefix: string, chars = 16): string => {
    const bytes = source(chars);
    let out = prefix;
    for (let i = 0; i < chars; i += 1) {
      out += ALPHABET.charAt((bytes[i] ?? 0) & 63);
    }
    return out;
  };
}

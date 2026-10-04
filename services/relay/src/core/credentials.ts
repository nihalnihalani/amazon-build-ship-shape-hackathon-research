import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH, createIdFactory } from './protocol-port.js';

/** Injectable entropy source (tests use deterministic bytes; production uses node:crypto). */
export type RandomBytes = (n: number) => Uint8Array;
export const systemRandomBytes: RandomBytes = (n) => nodeRandomBytes(n);

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** 32 random bytes, base64url without padding: always 43 characters (256 bits). */
export function newCredential(rb: RandomBytes): string {
  const bytes = rb(32);
  if (bytes.length !== 32) throw new Error('entropy source returned the wrong number of bytes');
  return base64url(bytes);
}

// Identifiers (prefix + 22 base64url characters from 16 random bytes) come from the protocol package.
export const newRoomId = (rb: RandomBytes): string => createIdFactory(rb).room();
export const newJoinId = (rb: RandomBytes): string => createIdFactory(rb).join();
export const newMessageId = (rb: RandomBytes): string => createIdFactory(rb).message();
export const newConnectionId = (rb: RandomBytes): string => base64url(rb(12));

/**
 * Pairing code: PAIRING_CODE_LENGTH characters from PAIRING_ALPHABET by rejection sampling.
 * The alphabet has 22 characters; 242 = 22 * 11 is the largest multiple of 22 not above 256, so bytes
 * 242..255 are discarded. Every accepted byte maps to a character with exactly equal probability
 * (no modulo bias).
 */
export function newPairingCode(rb: RandomBytes): string {
  const n = PAIRING_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  let guard = 0;
  while (out.length < PAIRING_CODE_LENGTH) {
    const bytes = rb(16);
    for (const b of bytes) {
      if (b < limit) {
        out += PAIRING_ALPHABET.charAt(b % n);
        if (out.length === PAIRING_CODE_LENGTH) break;
      }
    }
    guard += 1;
    if (guard > 1000) throw new Error('entropy source is not producing usable bytes');
  }
  return out;
}

/** Two decimal digits by rejection sampling (bytes 200..255 are discarded). */
export function newConfirmDigits(rb: RandomBytes): string {
  let guard = 0;
  for (;;) {
    for (const b of rb(8)) {
      if (b < 200) return String(b % 100).padStart(2, '0');
    }
    guard += 1;
    if (guard > 1000) throw new Error('entropy source is not producing usable bytes');
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Credentials are 256-bit random values, so an unsalted, domain-separated SHA-256 is sufficient at rest. */
export function hashCredential(credential: string): string {
  return sha256Hex(`atr:cred:${credential}`);
}

/**
 * Pairing codes have only about 26.8 bits of entropy, so their stored hash is keyed with a server-side pepper
 * (HMAC-style domain separation through a secret prefix). The pepper may be empty (then this is a plain
 * domain-separated SHA-256) but deployments should set one.
 */
export function hashPairingCode(code: string, pepper: string): string {
  return sha256Hex(`atr:code:${pepper}:${code}`);
}

/** Opaque, non-reversible key for source-address rate limiting. The raw address is never stored or logged. */
export function hashSource(source: string, pepper: string): string {
  return sha256Hex(`atr:src:${pepper}:${source}`).slice(0, 32);
}

/** 8 hex characters of SHA-256(room_id): the only room identifier that may appear in logs. */
export function roomHashPrefix(roomId: string): string {
  return sha256Hex(roomId).slice(0, 8);
}

/** Constant-time comparison of two equal-length hex digests. Unequal lengths compare false without leaking where they differ. */
export function constantTimeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function verifyCredential(presented: string, storedHashHex: string): boolean {
  return constantTimeEqualHex(hashCredential(presented), storedHashHex);
}

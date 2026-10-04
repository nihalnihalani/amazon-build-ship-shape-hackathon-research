import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
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

// ---------------------------------------------------------------------------------------------
// Keyed hashing (A3-04, A2-03)
// ---------------------------------------------------------------------------------------------

export const HASH_SECRET_MIN_CHARS = 16;
const DAY_MS = 86_400_000;

/** Expands an IPv6 address into its eight 16-bit groups (lower-case hex, four digits). Input must pass isIPv6. */
function ipv6Groups(address: string): string[] {
  let a = address;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (tail && isIPv4(tail[1] as string)) {
    const o = (tail[1] as string).split('.').map(Number);
    const hi = (((o[0] as number) << 8) | (o[1] as number)).toString(16);
    const lo = (((o[2] as number) << 8) | (o[3] as number)).toString(16);
    a = `${a.slice(0, a.length - (tail[1] as string).length)}${hi}:${lo}`;
  }
  const [head = '', rest] = a.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? [] : Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0');
  return [...left, ...fill, ...right].map((g) => g.padStart(4, '0').toLowerCase());
}

/**
 * Source key material: IPv4 as the /32 address, IPv6 as the /64 prefix (one host can rotate through 2^64
 * addresses), IPv4-mapped IPv6 as the IPv4 address. A string that is not an address is returned as is (it is
 * hashed immediately; it never reaches a store or a log).
 */
export function normalizeSourceAddress(address: string): string {
  const a = (address.trim().split('%')[0] ?? '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped && isIPv4(mapped[1] as string)) return mapped[1] as string;
  if (isIPv4(a)) return a;
  if (isIPv6(a)) return `${ipv6Groups(a).slice(0, 4).join(':')}::/64`;
  return a;
}

/**
 * Keyed hashes derived from one master secret (SSM SecureString on AWS, random per process locally).
 *
 * - Pairing codes: HMAC-SHA-256 with a code-specific key (never a plain hash: the code space is only 26.8 bits).
 * - Source addresses: HMAC-SHA-256 with a key derived for the current UTC day, so the effective key rotates
 *   daily without an operator step and keys of different days cannot be linked by anyone who holds only the
 *   stored values. Counters keyed by it live at most one hour.
 */
export class HashKeys {
  private readonly master: Buffer;
  private readonly codeKey: Buffer;
  private readonly rotationKey: Buffer;
  private readonly dayKeys = new Map<number, Buffer>();

  constructor(secret: string) {
    if (typeof secret !== 'string' || secret.length < HASH_SECRET_MIN_CHARS) {
      throw new Error(`hash secret must be at least ${HASH_SECRET_MIN_CHARS} characters`);
    }
    this.master = Buffer.from(secret, 'utf8');
    this.codeKey = createHmac('sha256', this.master).update('atr:key:pairing-code').digest();
    this.rotationKey = createHmac('sha256', this.master).update('atr:key:credential-rotation').digest();
  }

  /**
   * The credential a resume rotates to: HMAC-SHA-256 (a PRF, so 256 uniformly unpredictable bits, 43 base64url
   * characters) under a rotation key derived from the master secret, bound to the room, the role and the hash of
   * the credential being consumed. Deriving it, instead of drawing it at random, lets the relay re-issue the SAME
   * next credential during the one-step grace for a lost auth.ok without ever storing the credential itself.
   * The first credentials (room.created, join.accepted) are drawn from the CSPRNG.
   */
  nextCredential(roomId: string, role: string, consumedHash: string): string {
    return createHmac('sha256', this.rotationKey).update(`next:${roomId}:${role}:${consumedHash}`, 'utf8').digest('base64url');
  }

  /** HMAC-SHA-256 of a pairing code, hex. This is the lookup key stored for the code. */
  code(code: string): string {
    return createHmac('sha256', this.codeKey).update(code, 'utf8').digest('hex');
  }

  /** Opaque, non-reversible key for per-source counters: 32 hex characters. */
  source(address: string, nowMs: number): string {
    const day = Math.floor(nowMs / DAY_MS);
    let key = this.dayKeys.get(day);
    if (!key) {
      key = createHmac('sha256', this.master).update(`atr:key:source:${day}`).digest();
      this.dayKeys.set(day, key);
      if (this.dayKeys.size > 3) {
        const oldest = this.dayKeys.keys().next();
        if (!oldest.done) this.dayKeys.delete(oldest.value);
      }
    }
    return createHmac('sha256', key).update(normalizeSourceAddress(address), 'utf8').digest('hex').slice(0, 32);
  }
}

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HASH_SECRET_MIN_CHARS,
  HashKeys,
  PAIRING_ALPHABET,
  constantTimeEqualHex,
  hashCredential,
  newConfirmDigits,
  newConnectionId,
  newCredential,
  newJoinId,
  newMessageId,
  newPairingCode,
  newRoomId,
  normalizeSourceAddress,
  roomHashPrefix,
  verifyCredential,
  type RandomBytes,
} from '../src/core/index.js';

/** Entropy source that replays scripted blocks, one block per call. */
function scripted(...blocks: number[][]): RandomBytes {
  let i = 0;
  return (n) => {
    const b = blocks[i % blocks.length] ?? [];
    i += 1;
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k += 1) out[k] = b[k % b.length] ?? 0;
    return out;
  };
}

describe('credentials', () => {
  it('are 32 random bytes as 43 base64url characters', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const c = newCredential((n) => randomBytes(n));
      expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(c, 'base64url')).toHaveLength(32);
      seen.add(c);
    }
    expect(seen.size).toBe(1000);
  });

  it('refuses an entropy source that returns the wrong length', () => {
    expect(() => newCredential(() => new Uint8Array(16))).toThrow();
  });

  it('ids carry the documented prefixes and satisfy the envelope patterns', () => {
    const rb: RandomBytes = (n) => randomBytes(n);
    expect(newRoomId(rb)).toMatch(/^r_[A-Za-z0-9_-]{16,32}$/);
    expect(newJoinId(rb)).toMatch(/^j_[A-Za-z0-9_-]{16,32}$/);
    expect(newMessageId(rb)).toMatch(/^m_[A-Za-z0-9_-]{16,32}$/);
    expect(newConnectionId(rb)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('pairing code generation (rejection sampling)', () => {
  it('uses only the 22-character alphabet and is 6 characters long', () => {
    expect(PAIRING_ALPHABET).toBe('ACDEFHJKMNPRTUVWXY3479');
    for (let i = 0; i < 500; i += 1) {
      expect(newPairingCode((n) => randomBytes(n))).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
    }
  });

  it('discards bytes 242..255 instead of reducing them modulo 22', () => {
    // First block: ten rejected bytes (>= 242), then byte 241 -> index 21 ('9'), byte 0 -> 'A', 1 -> 'C', 2, 3, 4.
    const block = [255, 254, 253, 252, 251, 250, 249, 248, 247, 246, 245, 244, 243, 242, 241, 0];
    const rest = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    expect(newPairingCode(scripted(block, rest))).toBe('9ACDEF');
    // A biased implementation (b % 22) would have accepted 242 -> index 0 ('A') first.
    expect(newPairingCode(scripted([242, 242, 242, 242, 242, 242, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]))).toBe('CCCCCC');
  });

  it('maps every accepted byte value to a character with equal probability', () => {
    // Exhaustively feed all 256 byte values: exactly 242 are accepted and each character is hit 11 times.
    const counts = new Map<string, number>();
    for (let b = 0; b < 256; b += 1) {
      if (b >= 242) continue;
      const code = newPairingCode(scripted([b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b]));
      const ch = code.charAt(0);
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(22);
    for (const v of counts.values()) expect(v).toBe(11);
  });

  it('is statistically uniform over the alphabet (chi-square, df = 21)', () => {
    const counts = new Map<string, number>();
    const draws = 40_000;
    for (let i = 0; i < draws; i += 1) {
      for (const ch of newPairingCode((n) => randomBytes(n))) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const expected = (draws * 6) / 22;
    let chi = 0;
    for (const ch of PAIRING_ALPHABET) chi += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    // critical value for p = 0.00001 at df = 21 is about 56; a modulo-biased generator scores far higher
    expect(chi).toBeLessThan(60);
  });

  it('fails loudly if the entropy source only yields rejected bytes', () => {
    expect(() => newPairingCode(() => new Uint8Array(16).fill(255))).toThrow();
  });
});

describe('confirm digits', () => {
  it('are two decimal digits by rejection sampling', () => {
    expect(newConfirmDigits(scripted([255, 200, 199]))).toBe('99');
    expect(newConfirmDigits(scripted([0]))).toBe('00');
    expect(newConfirmDigits(scripted([7]))).toBe('07');
    expect(newConfirmDigits(scripted([100]))).toBe('00');
    for (let i = 0; i < 200; i += 1) expect(newConfirmDigits((n) => randomBytes(n))).toMatch(/^[0-9]{2}$/);
  });
});

describe('hashing and comparison', () => {
  it('hashes credentials with a domain-separated SHA-256 and verifies in constant-time form', () => {
    const c = newCredential((n) => randomBytes(n));
    const h = hashCredential(c);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash('sha256').update(`atr:cred:${c}`).digest('hex'));
    expect(verifyCredential(c, h)).toBe(true);
    expect(verifyCredential(`${c.slice(0, 42)}${c.endsWith('A') ? 'B' : 'A'}`, h)).toBe(false);
    expect(verifyCredential(c, hashCredential('x'.repeat(43)))).toBe(false);
  });

  it('compares via timingSafeEqual and refuses mismatched lengths', () => {
    const src = readFileSync(new URL('../src/core/credentials.ts', import.meta.url), 'utf8');
    expect(src).toContain('timingSafeEqual');
    expect(constantTimeEqualHex('ab', 'abcd')).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(false);
    expect(constantTimeEqualHex('00ff', '00ff')).toBe(true);
    expect(constantTimeEqualHex('00ff', '00fe')).toBe(false);
    expect(constantTimeEqualHex('zz', 'zz')).toBe(false);
  });

  it('derives the room hash prefix used in logs from SHA-256 of the room id', () => {
    const room = 'r_AAAAAAAAAAAAAAAAAAAAAA';
    expect(roomHashPrefix(room)).toBe(createHash('sha256').update(room).digest('hex').slice(0, 8));
  });
});

describe('keyed hashing (A3-04, A2-03)', () => {
  const SECRET = 'master-secret-0123456789';

  it('refuses a missing or short secret: there is no unkeyed fallback', () => {
    expect(() => new HashKeys('')).toThrow();
    expect(() => new HashKeys('x'.repeat(HASH_SECRET_MIN_CHARS - 1))).toThrow();
    expect(() => new HashKeys('x'.repeat(HASH_SECRET_MIN_CHARS))).not.toThrow();
  });

  it('stores pairing codes as HMAC-SHA-256 under a secret-derived key, not as a plain SHA-256', () => {
    const k = new HashKeys(SECRET);
    const h = k.code('ACDEFH');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('ACDEFH');
    // independent computation of the documented construction
    const codeKey = createHmac('sha256', Buffer.from(SECRET)).update('atr:key:pairing-code').digest();
    expect(h).toBe(createHmac('sha256', codeKey).update('ACDEFH').digest('hex'));
    // not recoverable by anyone without the secret: a plain hash of the code (what a table dump invites) does not match
    expect(h).not.toBe(createHash('sha256').update('ACDEFH').digest('hex'));
    expect(h).not.toBe(createHash('sha256').update('atr:code::ACDEFH').digest('hex'));
    expect(new HashKeys('another-secret-0123456789').code('ACDEFH')).not.toBe(h);
    expect(k.code('ACDEFJ')).not.toBe(h);
    expect(new HashKeys(SECRET).code('ACDEFH')).toBe(h); // stable for a given secret
  });

  it('keys source addresses under a key that changes every UTC day', () => {
    const k = new HashKeys(SECRET);
    const day = 86_400_000;
    const t = 1_800_000_000_000;
    const today = k.source('203.0.113.7', t);
    expect(today).toMatch(/^[0-9a-f]{32}$/);
    expect(today).not.toContain('203');
    expect(k.source('203.0.113.7', t + 1000)).toBe(today); // same day, same key
    const sameDayEnd = t - (t % day) + day - 1;
    expect(k.source('203.0.113.7', sameDayEnd)).toBe(today);
    expect(k.source('203.0.113.7', sameDayEnd + 1)).not.toBe(today); // next UTC day: a different key
    expect(k.source('203.0.113.7', t + 3 * day)).not.toBe(today);
    expect(k.source('203.0.113.8', t)).not.toBe(today);
    expect(new HashKeys('another-secret-0123456789').source('203.0.113.7', t)).not.toBe(today);
  });

  it('derives the rotated credential as a 43-character PRF output bound to room, role and the consumed credential', () => {
    const k = new HashKeys(SECRET);
    const a = k.nextCredential('r_room', 'tv', 'aa'.repeat(32));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(k.nextCredential('r_room', 'tv', 'aa'.repeat(32))).toBe(a); // deterministic: re-issued identically in the grace
    expect(k.nextCredential('r_room', 'phone', 'aa'.repeat(32))).not.toBe(a);
    expect(k.nextCredential('r_other', 'tv', 'aa'.repeat(32))).not.toBe(a);
    expect(k.nextCredential('r_room', 'tv', 'bb'.repeat(32))).not.toBe(a);
    expect(new HashKeys('another-secret-0123456789').nextCredential('r_room', 'tv', 'aa'.repeat(32))).not.toBe(a);
  });
});

describe('source address normalisation (A3-03)', () => {
  it('keeps IPv4 as /32 and maps IPv4-mapped IPv6 to the same address', () => {
    expect(normalizeSourceAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeSourceAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeSourceAddress('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses IPv6 to its /64 so one host cannot rotate through 2^64 addresses', () => {
    const a = normalizeSourceAddress('2001:db8:1:2::1');
    const b = normalizeSourceAddress('2001:db8:1:2:ffff:ffff:ffff:ffff');
    const c = normalizeSourceAddress('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe('2001:0db8:0001:0002::/64');
    expect(normalizeSourceAddress('2001:db8:1:3::1')).not.toBe(a);
    expect(normalizeSourceAddress('2001:db9:1:2::1')).not.toBe(a);
    expect(normalizeSourceAddress('fe80::1%en0')).toBe(normalizeSourceAddress('fe80::2%en1')); // zone ids ignored
    expect(normalizeSourceAddress('::1')).toBe('0000:0000:0000:0000::/64');
    expect(normalizeSourceAddress('64:ff9b::192.0.2.1')).toBe('0064:ff9b:0000:0000::/64');
  });

  it('leaves anything that is not an address alone (it is hashed immediately and never stored)', () => {
    expect(normalizeSourceAddress('not an address')).toBe('not an address');
    expect(normalizeSourceAddress(' unknown ')).toBe('unknown');
  });
});

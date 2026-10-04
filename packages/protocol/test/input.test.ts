import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, parseWireMessage, utf8ByteLength, validateMessageObject } from '../src/index.js';
import { fixtureOf } from './fixtures.js';
import { OPTS, expectFail, expectOk, patched, patchedRaw } from './helpers.js';

const json = (v: unknown): string => JSON.stringify(v);

describe('binary and non-string frames', () => {
  const valid = fixtureOf('ping authenticated');
  const inputs: Array<[string, unknown]> = [
    ['ArrayBuffer', new ArrayBuffer(16)],
    ['Uint8Array of a valid message', new TextEncoder().encode(json(valid))],
    ['Node Buffer', Buffer.from(json(valid))],
    ['DataView', new DataView(new ArrayBuffer(8))],
    ['Float32Array', new Float32Array(4)],
    ['Blob', new Blob([json(valid)])],
    ['Blob-like object', { size: 10, type: 'audio/webm', arrayBuffer: () => null }],
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['symbol', Symbol('frame')],
    ['bigint', 5n],
    ['array', [1, 2, 3]],
    ['already parsed object', valid],
    ['function', () => json(valid)],
  ];
  for (const [label, input] of inputs) {
    it(`rejects ${label} as binary_rejected`, () => {
      const r = parseWireMessage(input, OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('binary_rejected');
        expect(r.ref_message_id).toBeNull();
      }
    });
  }
  it('accepts the same message as text', () => {
    expect(parseWireMessage(json(valid), OPTS).ok).toBe(true);
  });
});

describe('size limit', () => {
  const base = fixtureOf('ping authenticated');
  const text = json(base);

  /** Pad valid JSON with trailing spaces (legal JSON whitespace) to an exact byte length. */
  function padTo(bytes: number): string {
    const pad = bytes - utf8ByteLength(text);
    expect(pad).toBeGreaterThanOrEqual(0);
    return text + ' '.repeat(pad);
  }

  it('accepts exactly 8192 bytes', () => {
    const frame = padTo(MAX_MESSAGE_BYTES);
    expect(utf8ByteLength(frame)).toBe(8192);
    expect(parseWireMessage(frame, OPTS).ok).toBe(true);
  });
  it('rejects 8193 bytes with payload_too_large', () => {
    const frame = padTo(MAX_MESSAGE_BYTES + 1);
    const r = parseWireMessage(frame, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('counts bytes, not characters: 4097 two-byte characters are too large', () => {
    const frame = 'é'.repeat(4097); // 8194 bytes but only 4097 UTF-16 units
    expect(frame.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(utf8ByteLength(frame)).toBe(8194);
    const r = parseWireMessage(frame, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('4096 two-byte characters (exactly 8192 bytes) pass the size gate and fail as JSON', () => {
    const r = parseWireMessage('é'.repeat(4096), OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_schema');
  });
  it('counts four-byte characters: 2049 emoji are 8196 bytes', () => {
    const frame = '\u{1F600}'.repeat(2049);
    expect(utf8ByteLength(frame)).toBe(8196);
    const r = parseWireMessage(frame, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('multibyte text pushes a real message over the limit by bytes', () => {
    // 4000 padding characters of U+00E9 inside a JSON string value of an unknown extra key: size gate first.
    const big = json({ ...base, pad: 'é'.repeat(4100) });
    expect(big.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(utf8ByteLength(big)).toBeGreaterThan(MAX_MESSAGE_BYTES);
    const r = parseWireMessage(big, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('opts.maxBytes can lower but not raise the limit', () => {
    const frame = json(fixtureOf('level'));
    const bytes = utf8ByteLength(frame);
    expect(parseWireMessage(frame, { ...OPTS, maxBytes: bytes }).ok).toBe(true);
    const low = parseWireMessage(frame, { ...OPTS, maxBytes: bytes - 1 });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.code).toBe('payload_too_large');
    const raised = parseWireMessage(padTo(MAX_MESSAGE_BYTES) + ' ', { ...OPTS, maxBytes: 100_000 });
    expect(raised.ok).toBe(false);
    if (!raised.ok) expect(raised.code).toBe('payload_too_large');
    // invalid values fall back to the default
    expect(parseWireMessage(frame, { ...OPTS, maxBytes: NaN }).ok).toBe(true);
    expect(parseWireMessage(frame, { ...OPTS, maxBytes: -5 }).ok).toBe(true);
  });
  it('validateMessageObject applies the same limit to the serialization', () => {
    const big = patched(fixtureOf('error'), 'payload.detail', 'x'.repeat(9000));
    const r = validateMessageObject(big, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('does not allocate for hostile giants (short-circuits on string length)', () => {
    const giant = 'x'.repeat(5_000_000);
    const r = parseWireMessage(giant, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('utf8ByteLength agrees with TextEncoder', () => {
    const samples = ['', 'a', 'é', '€', '\u{1F600}', 'aé€\u{1F600}', '\ud800', 'x\udc00y', '\ud83d😀', '\ude00\ud83d'];
    for (const s of samples) expect(utf8ByteLength(s), JSON.stringify(s)).toBe(new TextEncoder().encode(s).length);
    // pseudo-random sweep
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 500; i += 1) {
      let s = '';
      const n = rnd() % 40;
      for (let j = 0; j < n; j += 1) s += String.fromCharCode(rnd() % 0x10000);
      expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
    }
  });
});

describe('validation order (section 4)', () => {
  const audioPayload = { audio: 'x' };
  it('unknown type is reported before the audio guard', () => {
    const m = patched(patched(fixtureOf('level'), 'type', 'nope'), 'payload', audioPayload);
    expectFail(m, 'unknown_type');
  });
  it('audio guard is reported before envelope field formats', () => {
    const m = patched(patched(fixtureOf('level'), 'message_id', 'bad'), 'payload', audioPayload);
    expectFail(m, 'audio_rejected');
  });
  it('envelope formats are reported before payload schema errors', () => {
    const m = patched(patched(fixtureOf('level'), 'message_id', 'bad'), 'payload.dbfs', 'loud');
    const r = validateMessageObject(m, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('message_id');
  });
  it('size is checked before JSON syntax', () => {
    const r = parseWireMessage(`{${' '.repeat(9000)}`, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payload_too_large');
  });
  it('a valid message with only whitespace padding stays valid', () => {
    expectOk(fixtureOf('level'));
    expect(parseWireMessage(`  \n${json(fixtureOf('level'))}\t `, OPTS).ok).toBe(true);
  });
});

describe('hostile objects never throw', () => {
  it('cyclic objects', () => {
    const cyclic: Record<string, unknown> = { ...fixtureOf('level') };
    cyclic.self = cyclic;
    const r = validateMessageObject(cyclic, OPTS);
    expect(r.ok).toBe(false);
  });
  it('throwing getters', () => {
    const m = fixtureOf('level');
    Object.defineProperty(m, 'payload', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    const r = validateMessageObject(m, OPTS);
    expect(r.ok).toBe(false);
  });
  it('proxies that throw', () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
        getPrototypeOf() {
          throw new Error('trap');
        },
      },
    );
    const r = validateMessageObject(proxy, OPTS);
    expect(r.ok).toBe(false);
  });
  it('toJSON that throws', () => {
    const m = { ...fixtureOf('level'), toJSON: () => { throw new Error('nope'); } };
    expect(validateMessageObject(m, OPTS).ok).toBe(false);
  });
  it('very deep nesting inside the payload', () => {
    let nested: unknown = 1;
    for (let i = 0; i < 2000; i += 1) nested = { a: nested };
    const m = patchedRaw(fixtureOf('level'), 'payload', nested);
    const r = validateMessageObject(m, OPTS);
    expect(r.ok).toBe(false);
    const text = '{"protocol_version":1,"type":"level","payload":' + '['.repeat(3000) + ']'.repeat(3000) + '}';
    expect(parseWireMessage(text, OPTS).ok).toBe(false);
  });
});

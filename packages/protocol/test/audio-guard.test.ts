import { describe, expect, it } from 'vitest';
import { AUDIO_GUARD_KEYS, validateMessageObject } from '../src/index.js';
import { fixtureOf } from './fixtures.js';
import { OPTS, expectFail, patched, patchedRaw } from './helpers.js';

function code(message: unknown): string {
  const r = validateMessageObject(message, OPTS);
  return r.ok ? 'ok' : r.code;
}

describe('audio guard: key names (case-insensitive, any depth)', () => {
  const keys = ['audio', 'pcm', 'samples', 'waveform', 'blob', 'buffer', 'data'];
  it('lists the seven guarded keys', () => {
    expect([...AUDIO_GUARD_KEYS].sort()).toEqual([...keys].sort());
  });
  for (const key of keys) {
    for (const variant of [key, key.toUpperCase(), key[0]!.toUpperCase() + key.slice(1), key.split('').map((c, i) => (i % 2 ? c : c.toUpperCase())).join('')]) {
      it(`rejects a top-level payload key "${variant}"`, () => {
        expect(code(patched(fixtureOf('level'), `payload.${variant}`, 1))).toBe('audio_rejected');
      });
    }
    it(`rejects "${key}" nested in mic.state settings`, () => {
      expect(code(patched(fixtureOf('mic.state no session'), `payload.settings.${key}`, 'x'))).toBe('audio_rejected');
    });
    it(`rejects "${key}" inside an array element object`, () => {
      expect(code(patchedRaw(fixtureOf('phrases.update'), 'payload.phrases', [{ [key]: 1 }]))).toBe('audio_rejected');
    });
  }
  it('does not treat similar key names as guarded (schema rejects them instead)', () => {
    for (const key of ['audio_level', 'sample', 'datum', 'buffers', 'metadata']) {
      expect(code(patched(fixtureOf('level'), `payload.${key}`, 1))).toBe('bad_schema');
    }
  });
  it('does not inspect string values as keys', () => {
    expect(code(patched(fixtureOf('cue'), 'payload.text', 'data'))).toBe('ok');
    expect(code(patched(fixtureOf('cue'), 'payload.text', 'audio'))).toBe('ok');
  });
  it('guards payload keys only, not the (exact-key) envelope', () => {
    expect(code(patched(fixtureOf('level'), 'audio', 1))).toBe('bad_schema');
  });
});

describe('audio guard: string and array size', () => {
  it('rejects a string over 256 code points', () => {
    expect(code(patched(fixtureOf('cue'), 'payload.text', 'a'.repeat(257)))).toBe('audio_rejected');
    expect(code(patched(fixtureOf('error'), 'payload.detail', 'a'.repeat(300)))).toBe('audio_rejected');
  });
  it('allows exactly 256 code points through the guard (schema decides)', () => {
    expect(code(patched(fixtureOf('cue'), 'payload.text', 'a'.repeat(256)))).toBe('bad_schema');
  });
  it('counts code points, not UTF-16 units', () => {
    expect(code(patched(fixtureOf('cue'), 'payload.text', '\u{1F600}'.repeat(256)))).toBe('bad_schema');
    expect(code(patched(fixtureOf('cue'), 'payload.text', '\u{1F600}'.repeat(257)))).toBe('audio_rejected');
  });
  it('rejects a base64 blob over 256 characters', () => {
    const blob = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='.repeat(8);
    expect(blob.length).toBeGreaterThan(256);
    expect(code(patched(fixtureOf('cue'), 'payload.text', blob))).toBe('audio_rejected');
  });
  it('a short base64 string is still rejected by the schema', () => {
    expect(code(patched(fixtureOf('cue'), 'payload.text', 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAf'))).toBe('bad_schema');
  });
  it('rejects arrays longer than 16 elements', () => {
    const many = Array.from({ length: 17 }, (_, i) => `p${i}`);
    expect(code(patched(fixtureOf('phrases.update'), 'payload.phrases', many))).toBe('audio_rejected');
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new Array(17).fill(0.1)))).toBe('audio_rejected');
  });
  it('allows arrays of 16 through the guard (schema decides)', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `p${i}`);
    expect(code(patched(fixtureOf('phrases.update'), 'payload.phrases', sixteen))).toBe('bad_schema');
  });
  it('rejects a numeric sample array', () => {
    const samples = Array.from({ length: 128 }, (_, i) => Math.sin(i));
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', samples))).toBe('audio_rejected');
  });
  it('rejects binary containers inside the payload', () => {
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new Uint8Array(4)))).toBe('audio_rejected');
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new ArrayBuffer(4)))).toBe('audio_rejected');
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new Float32Array(2)))).toBe('audio_rejected');
  });
  it('rejects Blob and File containers inside the payload', () => {
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new Blob(['abc'])))).toBe('audio_rejected');
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new File(['abc'], 'a.wav')))).toBe('audio_rejected');
    expect(code(patchedRaw(fixtureOf('level'), 'payload.dbfs', new SharedArrayBuffer(4)))).toBe('audio_rejected');
  });
  it('finds oversized strings at depth', () => {
    expect(code(patchedRaw(fixtureOf('mic.state no session'), 'payload.settings', { nested: { deep: 'z'.repeat(400) } }))).toBe('audio_rejected');
  });
  it('a legitimate maximum payload (10 phrases of 60 chars) is not an audio violation', () => {
    const phrases = Array.from({ length: 10 }, (_, i) => String(i).repeat(60).slice(0, 60));
    expect(code(patched(fixtureOf('phrases.update'), 'payload.phrases', phrases))).toBe('ok');
  });
  it('is distinct from schema failures', () => {
    expectFail(patched(fixtureOf('level'), 'payload.zzz', 1), 'bad_schema');
  });
});

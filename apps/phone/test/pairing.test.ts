import { describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, defaultDeviceLabel, resolveRelayUrl } from '../src/config.js';
import { checkCode, consumeHashCode, normalizeCodeInput, readCodeFromHash } from '../src/pairing.js';

describe('pairing code input', () => {
  it('alphabet is the 22 characters from ADR-0003', () => {
    expect(CODE_ALPHABET).toBe('ACDEFHJKMNPRTUVWXY3479');
    expect(CODE_ALPHABET).toHaveLength(22);
  });

  it('normalizes case, spaces and hyphens, and caps at 6', () => {
    expect(normalizeCodeInput('acdefh')).toBe('ACDEFH');
    expect(normalizeCodeInput('ac-de fh')).toBe('ACDEFH');
    expect(normalizeCodeInput(' a c d e f h j k ')).toBe('ACDEFH');
  });

  it('accepts only 6 alphabet characters', () => {
    expect(checkCode('ACDEFH').ok).toBe(true);
    expect(checkCode('347934').ok).toBe(true);
    expect(checkCode('ACDEF')).toEqual({ ok: false, message: 'The code has 6 characters; you have entered 5.' });
    expect(checkCode('').ok).toBe(false);
  });

  it.each(['O', '0', '1', 'I', 'L', 'B', 'S', 'Z', '2', '5', '6', '8', 'G', 'Q'])(
    'rejects %s, which is not in the alphabet',
    (ch) => {
      const r = checkCode(`ACDEF${ch}`);
      expect(r.ok).toBe(false);
      expect(r.message).toContain(`"${ch}"`);
    },
  );
});

describe('#code= fragment', () => {
  it('reads and normalizes a valid code', () => {
    expect(readCodeFromHash('#code=acdefh')).toBe('ACDEFH');
    expect(readCodeFromHash('code=ACDEFH')).toBe('ACDEFH');
  });
  it('rejects wrong length, bad characters and other keys', () => {
    expect(readCodeFromHash('#code=ACDEF')).toBeNull();
    expect(readCodeFromHash('#code=ACDEFHJ')).toBeNull();
    expect(readCodeFromHash('#code=ACDEF0')).toBeNull();
    expect(readCodeFromHash('#room=ACDEFH')).toBeNull();
    expect(readCodeFromHash('')).toBeNull();
  });
  it('consumeHashCode clears the fragment (valid or not) while keeping path and query', () => {
    const replaceState = vi.fn();
    const host = { location: { hash: '#code=ACDEFH', pathname: '/p/', search: '?x=1' }, history: { replaceState } };
    expect(consumeHashCode(host)).toBe('ACDEFH');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/p/?x=1');
    replaceState.mockClear();
    expect(consumeHashCode({ ...host, location: { ...host.location, hash: '#code=BAD' } })).toBeNull();
    expect(replaceState).toHaveBeenCalledTimes(1);
    replaceState.mockClear();
    consumeHashCode({ ...host, location: { ...host.location, hash: '' } });
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('relay URL', () => {
  const loc = { protocol: 'https:', host: 'phone.example', search: '?relay=ws://evil.test/ws' };
  it('production ignores ?relay= entirely', () => {
    expect(resolveRelayUrl(loc, false)).toBe('wss://phone.example/ws');
  });
  it('test build honours ws/wss overrides only', () => {
    expect(resolveRelayUrl(loc, true)).toBe('ws://evil.test/ws');
    expect(resolveRelayUrl({ ...loc, search: '?relay=http://x.test/' }, true)).toBe('wss://phone.example/ws');
    expect(resolveRelayUrl({ ...loc, search: '?relay=javascript:alert(1)' }, true)).toBe('wss://phone.example/ws');
    expect(resolveRelayUrl({ ...loc, search: '?relay=not a url' }, true)).toBe('wss://phone.example/ws');
    expect(resolveRelayUrl({ ...loc, search: '' }, true)).toBe('wss://phone.example/ws');
  });
});

describe('device label default', () => {
  it('Android Chrome vs Browser', () => {
    expect(defaultDeviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')).toBe('Android Chrome');
    expect(defaultDeviceLabel('Mozilla/5.0 (Macintosh) Safari/605')).toBe('Browser');
    expect(defaultDeviceLabel('Mozilla/5.0 (Android 14) Gecko/126 Firefox/126')).toBe('Browser');
  });
});

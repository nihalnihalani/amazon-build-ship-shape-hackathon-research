import { APP_VERSION, DEFAULT_RELAY_URL, isAllowedRelayUrl, resolveConfig } from '../config';

describe('relay URL validation', () => {
  it.each([
    'wss://relay.example.com/ws',
    'wss://localhost:8443/ws',
    'wss://abc123.execute-api.ap-south-1.amazonaws.com/prod',
    'wss://relay.example.com',
    'ws://localhost:8787/ws',
    'ws://127.0.0.1:8787',
    'ws://[::1]:8787/ws',
  ])('accepts %s', (url) => {
    expect(isAllowedRelayUrl(url)).toBe(true);
  });

  it.each([
    ['plain ws to a remote host', 'ws://relay.example.com/ws'],
    ['look-alike local host', 'ws://localhost.evil.example/ws'],
    ['credentials in the URL', 'wss://user:secret@relay.example.com/ws'],
    ['query string (tokens never travel in a URL)', 'wss://relay.example.com/ws?token=abc'],
    ['fragment', 'wss://relay.example.com/ws#x'],
    ['http scheme', 'https://relay.example.com/ws'],
    ['empty host', 'wss://'],
    ['whitespace', 'wss://relay example.com/ws'],
    ['empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedRelayUrl(url)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 5, {}, ['wss://x']]) expect(isAllowedRelayUrl(value)).toBe(false);
  });
});

describe('resolveConfig', () => {
  it('uses the documented defaults', () => {
    expect(DEFAULT_RELAY_URL).toBe('wss://localhost:8443/ws');
    expect(resolveConfig(undefined)).toEqual({ relayUrl: DEFAULT_RELAY_URL, fixtureMode: false, platform: 'vega', warnings: [] });
    expect(resolveConfig(null).relayUrl).toBe(DEFAULT_RELAY_URL);
  });

  it('applies a valid override', () => {
    const config = resolveConfig({ relayUrl: 'wss://relay.example.test/ws', fixtureMode: true, platform: 'web_preview' });
    expect(config).toEqual({ relayUrl: 'wss://relay.example.test/ws', fixtureMode: true, platform: 'web_preview', warnings: [] });
  });

  it('ignores an invalid override, keeps the default and records a warning', () => {
    const config = resolveConfig({ relayUrl: 'ws://relay.example.com/ws?token=1' });
    expect(config.relayUrl).toBe(DEFAULT_RELAY_URL);
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).not.toContain('token');
  });

  it('ignores an override that is not an object, and unknown platforms', () => {
    expect(resolveConfig('wss://x').warnings).toHaveLength(1);
    expect(resolveConfig({ platform: 'test' }).platform).toBe('vega');
    expect(resolveConfig({ fixtureMode: 'yes' }).fixtureMode).toBe(false);
  });

  it('exports a version string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

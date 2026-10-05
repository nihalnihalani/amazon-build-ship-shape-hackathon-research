import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_VERSION, DEFAULT_RELAY_URL, isAllowedPhonePageOrigin, isAllowedRelayUrl, resolveConfig } from '../config';

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

describe('phone page origin validation (contract revision 3)', () => {
  it.each([
    'https://d1234abcd.cloudfront.net',
    'https://phone.example.com',
    'https://localhost',
    'https://localhost:8443',
    'https://192.168.1.20:8443',
    'https://[::1]:8443',
    'https://a-b.example.co.uk:65535',
    'https://x',
  ])('accepts %s', (value) => {
    expect(isAllowedPhonePageOrigin(value)).toBe(true);
  });

  it.each([
    ['plain http', 'http://phone.example.com'],
    ['plain http on localhost', 'http://localhost:8443'],
    ['a wss URL', 'wss://relay.example.com/ws'],
    ['a trailing slash (not an origin)', 'https://phone.example.com/'],
    ['a path', 'https://phone.example.com/app'],
    ['credentials', 'https://user:secret@phone.example.com'],
    ['a query', 'https://phone.example.com?code=ABC'],
    ['a fragment', 'https://phone.example.com#code=ABC'],
    ['an upper-case scheme', 'HTTPS://phone.example.com'],
    ['port 0', 'https://phone.example.com:0'],
    ['port above 65535', 'https://phone.example.com:65536'],
    ['a six-digit port', 'https://phone.example.com:123456'],
    ['an empty port', 'https://phone.example.com:'],
    ['no host', 'https://'],
    ['whitespace', 'https://phone example.com'],
    ['a trailing dot-less double dot', 'https://phone..example.com'],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isAllowedPhonePageOrigin(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 5, {}, ['https://x']]) expect(isAllowedPhonePageOrigin(value)).toBe(false);
  });
});

describe('phonePageOrigin in the resolved configuration', () => {
  it('defaults to unset, so the core uses the relay origin', () => {
    expect(resolveConfig(undefined).phonePageOrigin).toBeUndefined();
    expect('phonePageOrigin' in resolveConfig(undefined)).toBe(false);
    expect(resolveConfig({ relayUrl: 'wss://x.execute-api.ap-south-1.amazonaws.com/prod' }).phonePageOrigin).toBeUndefined();
  });

  it('applies a valid override next to the relay URL (the AWS shape: CloudFront phone page, execute-api relay)', () => {
    const config = resolveConfig({
      relayUrl: 'wss://abc123.execute-api.ap-south-1.amazonaws.com/prod',
      phonePageOrigin: 'https://d1234abcd.cloudfront.net',
    });
    expect(config.relayUrl).toBe('wss://abc123.execute-api.ap-south-1.amazonaws.com/prod');
    expect(config.phonePageOrigin).toBe('https://d1234abcd.cloudfront.net');
    expect(config.warnings).toEqual([]);
  });

  it('ignores an invalid override, leaves it unset and records a warning that does not echo the value', () => {
    for (const bad of ['http://phone.example.com', 'https://phone.example.com/x', 'https://user:pw@phone.example.com', 42]) {
      const config = resolveConfig({ phonePageOrigin: bad });
      expect(config.phonePageOrigin).toBeUndefined();
      expect(config.warnings).toHaveLength(1);
      expect(config.warnings[0]).toContain('Phone page origin');
      expect(config.warnings[0]).not.toContain('pw@');
      expect(config.warnings[0]).not.toContain('phone.example.com');
    }
  });

  it('validates the two settings independently', () => {
    const config = resolveConfig({ relayUrl: 'ws://remote.example.com/ws', phonePageOrigin: 'https://phone.example.com' });
    expect(config.relayUrl).toBe(DEFAULT_RELAY_URL);
    expect(config.phonePageOrigin).toBe('https://phone.example.com');
    expect(config.warnings).toHaveLength(1);
    const other = resolveConfig({ relayUrl: 'wss://relay.example.com/ws', phonePageOrigin: 'http://phone.example.com' });
    expect(other.relayUrl).toBe('wss://relay.example.com/ws');
    expect(other.phonePageOrigin).toBeUndefined();
  });

  it('documents both settings in the module comment and in index.js', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../config.ts'), 'utf8');
    expect(source).toMatch(/relayUrl: where the TV opens its WebSocket/);
    expect(source).toMatch(/phonePageOrigin: the https origin that serves the phone page/);
    expect(source).toContain('Default: unset');
    const index = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');
    expect(index).toContain('phonePageOrigin');
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

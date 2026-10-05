/**
 * Single configuration module for the TV app. No secrets live here and none may be added:
 * pairing codes and credentials are memory-only (ADR-0003/0005).
 *
 * There is no environment on Vega, so overrides are a build-time edit: set
 * `globalThis.__ATR_CONFIG__ = { relayUrl: '...', phonePageOrigin: '...' }` in index.js before
 * AppRegistry.registerComponent runs. Every value is validated; an invalid override is ignored, the default
 * is used, and a warning (never the rejected value) is kept in `AppConfig.warnings` for Diagnostics.
 *
 * relayUrl: where the TV opens its WebSocket (ADR-0006).
 *   Default: wss://localhost:8443/ws (the local reference relay).
 *   Accepted: `wss://` always; plain `ws://` only for localhost / 127.0.0.1 / [::1] (development); no
 *   credentials in the URL (`user@host`), no query string or fragment (tokens must never travel in a URL).
 *
 * phonePageOrigin: the https origin that serves the phone page, used for the QR code and the join link
 *   (`<origin>/#code=<CODE>`, contract revision 3, T16 N-03). Needed when the phone page and the relay are on
 *   different hosts, for example the phone page on CloudFront and the relay on API Gateway (execute-api).
 *   Default: unset. The core then uses the https origin of relayUrl (the local relay serves both).
 *   Accepted: an https ORIGIN only: `https://host` or `https://host:port`, with a DNS name, an IPv4 address or
 *   an [IPv6] literal; no path (not even a trailing slash), no credentials, no query, no fragment, no plain
 *   http (the microphone needs a secure origin). Example: `https://d1234abcd.cloudfront.net`.
 */

/** Keep in sync with package.json and manifest.toml (checked by a unit test). */
export const APP_VERSION = '0.1.0';

export const DEFAULT_RELAY_URL = 'wss://localhost:8443/ws';

export type AppPlatform = 'vega' | 'web_preview';

export interface AppConfig {
  relayUrl: string;
  /** https origin of the phone page; undefined = the core uses the relay URL's origin. */
  phonePageOrigin?: string;
  fixtureMode: boolean;
  platform: AppPlatform;
  warnings: string[];
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Validates a relay URL according to the rules in the header comment. */
export function isAllowedRelayUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const match = /^(wss|ws):\/\/([^\s/?#@]+)(\/[^\s?#]*)?$/.exec(url);
  if (match === null) return false;
  const scheme = match[1];
  const authority = match[2] ?? '';
  if (scheme === 'wss') return true;
  const host = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0] ?? '';
  return LOCAL_HOSTS.includes(host);
}

const ORIGIN = /^https:\/\/((?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/;

/** Validates a phone page origin according to the rules in the header comment. */
export function isAllowedPhonePageOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ORIGIN.exec(value);
  if (match === null) return false;
  const port = match[2];
  if (port !== undefined) {
    const n = Number(port);
    if (n < 1 || n > 65535) return false;
  }
  return true;
}

export function resolveConfig(overrides: unknown): AppConfig {
  const config: AppConfig = {
    relayUrl: DEFAULT_RELAY_URL,
    fixtureMode: false,
    platform: 'vega',
    warnings: [],
  };
  if (overrides === undefined || overrides === null) return config;
  if (typeof overrides !== 'object') {
    config.warnings.push('Configuration override ignored: not an object');
    return config;
  }
  const record = overrides as Record<string, unknown>;
  if (record['relayUrl'] !== undefined) {
    if (isAllowedRelayUrl(record['relayUrl'])) config.relayUrl = record['relayUrl'];
    else config.warnings.push('Relay URL override ignored: must be wss:// (ws:// only for localhost), without credentials, query or fragment');
  }
  if (record['phonePageOrigin'] !== undefined) {
    if (isAllowedPhonePageOrigin(record['phonePageOrigin'])) config.phonePageOrigin = record['phonePageOrigin'];
    else config.warnings.push('Phone page origin override ignored: must be an https origin (https://host or https://host:port), without path, credentials, query or fragment');
  }
  if (record['fixtureMode'] === true) config.fixtureMode = true;
  if (record['platform'] === 'web_preview') config.platform = 'web_preview';
  return config;
}

export function getAppConfig(): AppConfig {
  return resolveConfig(globalThis.__ATR_CONFIG__);
}

/**
 * Single configuration module for the TV app. No secrets live here and none may be added:
 * pairing codes and credentials are memory-only (ADR-0003/0005).
 *
 * Relay URL
 *   Default: wss://localhost:8443/ws (the local reference relay, ADR-0006).
 *   Override: set `globalThis.__ATR_CONFIG__ = { relayUrl: 'wss://relay.example/ws' }` in index.js before
 *   AppRegistry.registerComponent runs (a build-time edit; there is no environment on Vega). The
 *   override is validated: `wss://` always; plain `ws://` only for localhost / 127.0.0.1 / [::1]
 *   (development); no credentials in the URL (`user@host`), no query string or fragment (tokens must
 *   never travel in a URL). An invalid override is ignored, the default is used, and a warning is
 *   kept in `AppConfig.warnings` for Diagnostics.
 */

/** Keep in sync with package.json and manifest.toml (checked by a unit test). */
export const APP_VERSION = '0.1.0';

export const DEFAULT_RELAY_URL = 'wss://localhost:8443/ws';

export type AppPlatform = 'vega' | 'web_preview';

export interface AppConfig {
  relayUrl: string;
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
  if (record['fixtureMode'] === true) config.fixtureMode = true;
  if (record['platform'] === 'web_preview') config.platform = 'web_preview';
  return config;
}

export function getAppConfig(): AppConfig {
  return resolveConfig(globalThis.__ATR_CONFIG__);
}

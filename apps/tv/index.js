import { AppRegistry } from 'react-native';
import { App } from './src/App';
import { name as appName } from './app.json';

// Optional overrides: set globalThis.__ATR_CONFIG__ = { relayUrl: 'wss://...', phonePageOrigin: 'https://...' }
// on the line above registerComponent. See src/config.ts for what each value accepts. Never put credentials or
// tokens here.
AppRegistry.registerComponent(appName, () => App);

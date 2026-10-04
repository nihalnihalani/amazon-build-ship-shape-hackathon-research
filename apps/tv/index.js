import { AppRegistry } from 'react-native';
import { App } from './src/App';
import { name as appName } from './app.json';

// Relay URL override (optional): set globalThis.__ATR_CONFIG__ = { relayUrl: 'wss://...' } on the line
// above registerComponent. See src/config.ts. Never put credentials or tokens here.
AppRegistry.registerComponent(appName, () => App);

// Web preview build for the TV UI. NOT Vega: the React Native for Vega modules are replaced by shims so the
// screens can be driven in a browser (for example by Playwright). It proves nothing about Vega rendering,
// focus behaviour on a TV, VoiceView or performance.
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const tv = resolve(here, '..');
const packages = resolve(tv, '../../packages');
const shim = (name: string): string => resolve(here, 'src/shims', name);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // One copy of React for the harness and the app sources in ../src.
    dedupe: ['react', 'react-dom', 'react-native-web', 'react-native-svg'],
    alias: [
      { find: /^react$/, replacement: resolve(here, 'node_modules/react') },
      { find: /^react\/(.*)$/, replacement: resolve(here, 'node_modules/react/$1') },
      { find: /^react-dom$/, replacement: resolve(here, 'node_modules/react-dom') },
      { find: /^react-dom\/(.*)$/, replacement: resolve(here, 'node_modules/react-dom/$1') },
      // react-native-svg deep-imports a Flow-only React Native internal; the optimiser (npm run dev) cannot parse it.
      { find: /^react-native\/Libraries\/Utilities\/codegenNativeComponent$/, replacement: shim('codegenNativeComponent.ts') },
      { find: /^react-native$/, replacement: shim('react-native.tsx') },
      { find: /^@amazon-devices\/react-native-kepler$/, replacement: shim('kepler.tsx') },
      { find: /^@amazon-devices\/kepler-a11y-settings-interface-turbo$/, replacement: shim('kepler-a11y.tsx') },
      { find: /^@amazon-devices\/react-native-svg$/, replacement: resolve(here, 'node_modules/react-native-svg') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: shim('async-storage.ts') },
      { find: /^@atr\/session-core$/, replacement: resolve(packages, 'session-core/src/index.ts') },
      { find: /^@atr\/ten-foot-meter$/, replacement: resolve(packages, 'ten-foot-meter/src/index.ts') },
      { find: /^@atr\/protocol$/, replacement: resolve(packages, 'protocol/src/index.ts') },
      { find: /^qrcode-generator$/, replacement: resolve(tv, 'node_modules/qrcode-generator/dist/qrcode.mjs') },
    ],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.mjs', '.json'],
  },
  define: {
    __DEV__: JSON.stringify(true),
    global: 'globalThis',
  },
  server: { fs: { allow: [resolve(here, '../../..')] } },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 900 },
});

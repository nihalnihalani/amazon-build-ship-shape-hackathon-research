import { createHash } from 'node:crypto';
import { FRAME_PROCESSOR_SOURCE } from '@atr/phone-mic-meter';
import { defineConfig, loadEnv } from 'vite';
import { connectSrc, relayUrlFromEnv } from './src/relay-url.js';

/**
 * Two builds from one source tree:
 *   npm run build       -> dist/       production, contains no test-audio code
 *   npm run build:test  -> dist-test/  synthetic test audio + ?relay= override
 *
 * The test flag is a compile-time constant so the test-only module is removed from the
 * production graph by dead-code elimination (a test asserts this).
 *
 * The AudioWorklet module is `FRAME_PROCESSOR_SOURCE` from @atr/phone-mic-meter, written as a
 * real same-origin file (frame-processor.js). The page therefore needs no `blob:` script source
 * and the CSP stays `script-src 'self'`. A content hash in the URL query busts caches when the
 * package changes.
 *
 * Relay URL (N-03): `VITE_ATR_RELAY_URL` (environment or a .env file) is validated here (a `wss://`
 * URL, no credentials/query/fragment; an invalid value fails the build) and baked into the page.
 * Unset means same origin (`wss://<page host>/ws`). The page's CSP `connect-src` is `'self'` plus
 * that URL's origin only.
 */
const WORKLET_FILE = 'frame-processor.js';
const WORKLET_HASH = createHash('sha256').update(FRAME_PROCESSOR_SOURCE).digest('hex').slice(0, 10);

export default defineConfig(({ mode }) => {
  const testAudio = mode === 'test-audio' || process.env['VITE_ATR_TEST_AUDIO'] === '1';
  const env = loadEnv(mode, import.meta.dirname, 'VITE_ATR_');
  const relay = relayUrlFromEnv(env['VITE_ATR_RELAY_URL']);
  return {
    base: './',
    define: {
      __ATR_TEST_AUDIO__: JSON.stringify(testAudio),
      __ATR_WORKLET_URL__: JSON.stringify(`./${WORKLET_FILE}?v=${WORKLET_HASH}`),
      // The validated relay URL, or '' for same origin. Defining the key replaces whatever the
      // environment held, so only the validated, normalised value can reach the bundle.
      'import.meta.env.VITE_ATR_RELAY_URL': JSON.stringify(relay?.url ?? ''),
    },
    build: {
      outDir: testAudio ? 'dist-test' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      sourcemap: false,
    },
    plugins: [
      {
        name: 'atr-csp',
        transformIndexHtml(html: string) {
          // Production: this origin plus the configured relay origin. The test build also allows loopback sockets.
          return html.replace('%ATR_CONNECT_SRC%', connectSrc(relay?.origin ?? null, testAudio));
        },
      },
      {
        name: 'atr-frame-processor',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: WORKLET_FILE, source: FRAME_PROCESSOR_SOURCE });
        },
        configureServer(server) {
          server.middlewares.use(`/${WORKLET_FILE}`, (_req, res) => {
            res.setHeader('content-type', 'text/javascript');
            res.end(FRAME_PROCESSOR_SOURCE);
          });
        },
      },
    ],
  };
});

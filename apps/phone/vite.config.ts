import { createHash } from 'node:crypto';
import { FRAME_PROCESSOR_SOURCE } from '@atr/phone-mic-meter';
import { defineConfig } from 'vite';

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
 */
const WORKLET_FILE = 'frame-processor.js';
const WORKLET_HASH = createHash('sha256').update(FRAME_PROCESSOR_SOURCE).digest('hex').slice(0, 10);

export default defineConfig(({ mode }) => {
  const testAudio = mode === 'test-audio' || process.env['VITE_ATR_TEST_AUDIO'] === '1';
  return {
    base: './',
    define: {
      __ATR_TEST_AUDIO__: JSON.stringify(testAudio),
      __ATR_WORKLET_URL__: JSON.stringify(`./${WORKLET_FILE}?v=${WORKLET_HASH}`),
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
          // The test build may dial a local ws:// relay; production only wss://.
          const connect = testAudio ? "'self' ws: wss:" : "'self' wss:";
          return html.replace('%ATR_CONNECT_SRC%', connect);
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

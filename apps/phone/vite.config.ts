import { defineConfig } from 'vite';

/**
 * Two builds from one source tree:
 *   npm run build       -> dist/       production, contains no test-audio code
 *   npm run build:test  -> dist-test/  synthetic test audio + ?relay= override
 *
 * The flag is a compile-time constant so the test-only module is removed from
 * the production graph by dead-code elimination (a test asserts this).
 */
export default defineConfig(({ mode }) => {
  const testAudio = mode === 'test-audio' || process.env['VITE_ATR_TEST_AUDIO'] === '1';
  return {
    base: './',
    define: {
      __ATR_TEST_AUDIO__: JSON.stringify(testAudio),
    },
    build: {
      outDir: testAudio ? 'dist-test' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      // The AudioWorklet module must stay a real file so CSP can stay `script-src 'self'`.
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
    ],
  };
});

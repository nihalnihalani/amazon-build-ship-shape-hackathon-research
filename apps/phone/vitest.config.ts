import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // Unit tests run as the production flavour; test-audio code is imported explicitly where needed.
    __ATR_TEST_AUDIO__: false,
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
  },
});

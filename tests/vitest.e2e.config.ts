import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    globalSetup: ['./e2e-global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

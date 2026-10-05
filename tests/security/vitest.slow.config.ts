import { defineConfig } from 'vitest/config';

// T16 security gate, slow real-time checks (minutes). Run from the tests/ directory:
//   npx vitest run --config security/vitest.slow.config.ts
// Not part of `npm run test:security`.
export default defineConfig({
  test: {
    include: ['security/slow/*.test.ts'],
    globalSetup: ['./security/global-setup.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});

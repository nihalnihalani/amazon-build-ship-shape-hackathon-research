import { defineConfig } from 'vitest/config';

// T16 security gate (independent reviewer). Run from the tests/ directory:
//   npx vitest run --config security/vitest.config.ts
// The slow real-time checks in security/slow have their own config (vitest.slow.config.ts).
// Files run one at a time: each starts its own relay process and the relay's per-source budgets are per process.
export default defineConfig({
  test: {
    include: ['security/*.test.ts'],
    globalSetup: ['./security/global-setup.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

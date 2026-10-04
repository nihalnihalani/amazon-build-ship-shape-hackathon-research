import { defineConfig } from 'vitest/config';

// Independent QA review suite for T11/T13/T14 (session-core). Run from the tests/ directory:
//   npx vitest run --config review/vitest.config.ts
export default defineConfig({
  test: { include: ['review/**/*.test.ts'], testTimeout: 30_000, environment: 'node' },
});

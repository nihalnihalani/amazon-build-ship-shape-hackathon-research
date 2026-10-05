import { defineConfig } from 'vitest/config';

// QA REVIEW (independent reviewer, branch wt/qa): additional negative checks for T12/T15.
// Run from the tests/ directory (builds artifacts itself, like the coordinator e2e suites):
//   npx vitest run --config review-e2e/vitest.config.ts
// Strict mode (defect repros fail instead of being expected-fail): QA_STRICT=1
export default defineConfig({
  test: { include: ['review-e2e/*.test.ts'], testTimeout: 180_000, hookTimeout: 120_000, fileParallelism: false },
});

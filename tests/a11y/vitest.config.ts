import { defineConfig } from 'vitest/config';

// Keyboard-only accessibility gate on the TV web preview (system Chrome via playwright-core).
// Run through the runner, which builds and serves the preview:   node a11y/run-a11y.mjs   (from tests/)
export default defineConfig({
  test: {
    include: ['a11y/**/*.e2e.ts', 'a11y/**/*.unit.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

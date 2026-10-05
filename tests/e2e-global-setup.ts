/**
 * Vitest global setup for the browser/relay suites: build every artifact BEFORE test files are
 * imported, so a run after editing session-core or protocol never tests a stale TV core (QA-E2E-04).
 */
import { buildArtifacts } from './src/e2e-env.js';

export default function setup(): void {
  if (process.env.ATR_E2E_SKIP_BUILD !== '1') buildArtifacts();
  process.env.ATR_E2E_BUILT = '1';
}

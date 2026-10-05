/**
 * Builds the workspace packages the security suite imports at run time (protocol, phone-mic-meter, session-core,
 * relay) and the production phone page (apps/phone/dist, which the relay serves and the CSP tests read), so the suite
 * never runs against a stale `dist/` left over from an older commit. `dist/` is git-ignored, so a
 * worktree that has not rebuilt after a merge holds old code and old types (this is what produced the `choices`
 * type errors reported at the integration head, and a production page whose meta policy still said `connect-src 'self' wss:`). Set ATR_SEC_SKIP_BUILD=1 to skip when the build is known fresh.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default function setup(): void {
  if (process.env['ATR_SEC_SKIP_BUILD'] === '1') return;
  for (const workspace of ['@atr/protocol', '@atr/phone-mic-meter', '@atr/session-core', '@atr/relay', '@atr/phone']) {
    // The phone page is built for same origin (no relay URL from the environment), as the tests that read it expect.
    const env = workspace === '@atr/phone' ? { ...process.env, VITE_ATR_RELAY_URL: '' } : process.env;
    execFileSync('npm', ['run', 'build', '-w', workspace], { cwd: ROOT, env, stdio: 'pipe' });
  }
}

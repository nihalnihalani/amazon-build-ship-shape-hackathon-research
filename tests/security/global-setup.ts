/**
 * Builds the workspace packages the security suite imports at run time (protocol, phone-mic-meter, session-core,
 * relay) so the suite never runs against a stale `dist/` left over from an older commit. `dist/` is git-ignored, so a
 * worktree that has not rebuilt after a merge holds old code and old types (this is what produced the `choices`
 * type errors reported at the integration head). Set ATR_SEC_SKIP_BUILD=1 to skip when the build is known fresh.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default function setup(): void {
  if (process.env['ATR_SEC_SKIP_BUILD'] === '1') return;
  for (const workspace of ['@atr/protocol', '@atr/phone-mic-meter', '@atr/session-core', '@atr/relay']) {
    execFileSync('npm', ['run', 'build', '-w', workspace], { cwd: ROOT, stdio: 'pipe' });
  }
}

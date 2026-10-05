/**
 * The development certificate script (A6-03, T16 N-06): the CA lives 90 days, the server certificate never outlives
 * the CA, and a CA about to expire is replaced instead of reused.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/dev-certs/make-dev-certs.sh', import.meta.url));
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;
const DAY = 86_400_000;

const dirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'atr-devcerts-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const run = (out: string, ...args: string[]): string => execFileSync('bash', [SCRIPT, '--out', out, ...args], { encoding: 'utf8' });
const dates = (crt: string): { start: number; end: number } => {
  const t = execFileSync('openssl', ['x509', '-in', crt, '-noout', '-startdate', '-enddate'], { encoding: 'utf8' });
  return { start: Date.parse(/notBefore=(.*)/.exec(t)?.[1] ?? ''), end: Date.parse(/notAfter=(.*)/.exec(t)?.[1] ?? '') };
};
const fingerprint = (crt: string): string => execFileSync('openssl', ['x509', '-in', crt, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' }).trim();
const days = (d: { start: number; end: number }): number => (d.end - d.start) / DAY;

/** A plain CA that is valid for `validDays` from now, in the file names the script uses (a stand-in for an old CA). */
function oldCa(out: string, validDays: number): void {
  const conf = join(out, 'old.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = old development CA\n[ext]\nbasicConstraints = critical, CA:TRUE, pathlen:0\nkeyUsage = critical, keyCertSign, cRLSign\n');
  execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', join(out, 'ca.key')]);
  execFileSync('openssl', ['req', '-x509', '-new', '-key', join(out, 'ca.key'), '-sha256', '-days', String(validDays), '-config', conf, '-extensions', 'ext', '-out', join(out, 'ca.crt')]);
}

describe.skipIf(!hasOpenssl)('make-dev-certs.sh validity (A6-03, T16 N-06)', () => {
  it('issues a CA valid for 90 days and a server certificate that does not outlive it', () => {
    const out = scratch();
    const log = run(out, '192.168.1.23');
    const ca = dates(join(out, 'ca.crt'));
    const srv = dates(join(out, 'server.crt'));
    expect(days(ca)).toBeGreaterThanOrEqual(89.9);
    expect(days(ca)).toBeLessThanOrEqual(90.01);
    expect(srv.end).toBeLessThanOrEqual(ca.end);
    expect(days(srv)).toBeLessThanOrEqual(90);
    expect(days(srv)).toBeGreaterThan(80);
    expect(log).toMatch(/created CA/);
    expect(log).toMatch(/valid \d+ days, never beyond the CA/);
    expect(log).toMatch(/CA valid until:/);
    expect(log).not.toMatch(/3650|valid 365/);
    // still name-constrained and chained
    const text = execFileSync('openssl', ['x509', '-in', join(out, 'ca.crt'), '-noout', '-text'], { encoding: 'utf8' });
    expect(text).toMatch(/Name Constraints: critical/);
    execFileSync('openssl', ['verify', '-CAfile', join(out, 'ca.crt'), join(out, 'server.crt')]);
  });

  it('reuses a healthy CA on a second run and re-issues only the server certificate', () => {
    const out = scratch();
    run(out);
    const before = fingerprint(join(out, 'ca.crt'));
    const serverBefore = readFileSync(join(out, 'server.crt'), 'utf8');
    const log = run(out, '10.0.0.5');
    expect(log).toMatch(/reusing existing CA/);
    expect(log).not.toMatch(/replaced/);
    expect(fingerprint(join(out, 'ca.crt'))).toBe(before);
    expect(readFileSync(join(out, 'server.crt'), 'utf8')).not.toBe(serverBefore);
  });

  it('replaces a CA with fewer than 14 days left, says so, and the new pair chains', () => {
    const out = scratch();
    oldCa(out, 5);
    const before = fingerprint(join(out, 'ca.crt'));
    const log = run(out);
    expect(log).toMatch(/expires within 14 days.*replaced.*phone must trust the new ca\.crt/);
    expect(fingerprint(join(out, 'ca.crt'))).not.toBe(before);
    expect(days(dates(join(out, 'ca.crt')))).toBeGreaterThanOrEqual(89.9);
    execFileSync('openssl', ['verify', '-CAfile', join(out, 'ca.crt'), join(out, 'server.crt')]);
  });

  it('keeps a CA with enough time left, and caps the server certificate at what remains of it', () => {
    const out = scratch();
    oldCa(out, 20);
    const before = fingerprint(join(out, 'ca.crt'));
    const log = run(out);
    expect(log).toMatch(/reusing existing CA/);
    expect(fingerprint(join(out, 'ca.crt'))).toBe(before);
    const ca = dates(join(out, 'ca.crt'));
    const srv = dates(join(out, 'server.crt'));
    expect(srv.end).toBeLessThanOrEqual(ca.end);
    expect(days(srv)).toBeGreaterThan(17);
    expect(days(srv)).toBeLessThanOrEqual(20);
    execFileSync('openssl', ['verify', '-CAfile', join(out, 'ca.crt'), join(out, 'server.crt')]);
  });

  it('--force still replaces a healthy CA', () => {
    const out = scratch();
    run(out);
    const before = fingerprint(join(out, 'ca.crt'));
    const log = run(out, '--force');
    expect(log).toMatch(/--force replaces the CA/);
    expect(fingerprint(join(out, 'ca.crt'))).not.toBe(before);
  });

  it('says 90 days in its own documentation and no longer promises ten years or a year', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/CA_DAYS=90/);
    expect(src).toMatch(/valid 90 days/);
    expect(src).not.toMatch(/-days 3650|-days 365\b/);
  });
});

#!/usr/bin/env node
/**
 * Lists the third-party npm packages that are actually inside the apps/tv JavaScript bundle, using the
 * source map that Metro writes next to the bundle, and joins them with licences read from disk.
 *
 * Produce the bundle and map first (Node 22, from apps/tv after `npm ci`):
 *   npx react-native bundle --platform kepler --dev false --reset-cache --entry-file index.js \
 *     --bundle-output /tmp/farsidecheck.bundle --sourcemap-output /tmp/farsidecheck.bundle.map
 * Then, from the repository root:
 *   node docs/release/tools/bundle-packages.mjs /tmp/farsidecheck.bundle.map [audit.json]
 * Writes docs/release/tv-bundle-packages.json. With an `npm audit --json` file it also reports which
 * packages carrying an advisory are in the bundle.
 *
 * This is a JavaScript bundle only. It is NOT a native Vega build (no SDK on the build host, B-001).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [mapPath, auditPath] = process.argv.slice(2);
if (!mapPath) {
  console.error('usage: node docs/release/tools/bundle-packages.mjs <bundle.map> [npm-audit.json]');
  process.exit(2);
}
const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const pkgs = new Map(); // package dir -> { files, name, version, license }
let firstParty = 0;
for (const src of map.sources) {
  const i = src.lastIndexOf('node_modules/');
  if (i < 0) { firstParty += 1; continue; }
  const rest = src.slice(i + 'node_modules/'.length).split('/');
  const dirParts = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
  const dir = src.slice(0, i + 'node_modules/'.length) + dirParts.join('/');
  const entry = pkgs.get(dir) ?? { files: 0 };
  entry.files += 1;
  pkgs.set(dir, entry);
}
const list = [];
for (const [dir, e] of pkgs) {
  const file = join(dir, 'package.json');
  let meta = { name: dir.split('node_modules/').pop(), version: '?', license: '?' };
  if (existsSync(file)) {
    const p = JSON.parse(readFileSync(file, 'utf8'));
    const lic = typeof p.license === 'string' ? p.license : p.license?.type ?? '(none declared)';
    meta = { name: p.name, version: p.version, license: lic };
  }
  list.push({ ...meta, importedAs: dir.split('node_modules/').pop(), files: e.files });
}
list.sort((a, b) => a.name.localeCompare(b.name));
let advisories = null;
if (auditPath) {
  const audit = JSON.parse(readFileSync(auditPath, 'utf8')).vulnerabilities ?? {};
  const inBundle = new Set(list.flatMap((p) => [p.name, p.importedAs]));
  advisories = Object.entries(audit)
    .filter(([name]) => inBundle.has(name))
    .map(([name, v]) => ({
      name,
      severity: v.severity,
      direct: v.isDirect,
      // `via` entries that are strings name another package (the advisory is in that package); objects are advisories on this package.
      advisoriesOnThisPackage: v.via.filter((x) => typeof x === 'object').map((x) => x.title),
      flaggedOnlyBecauseOf: v.via.filter((x) => typeof x === 'string'),
    }));
}
const out = { generated_for: 'apps/tv (platform kepler, --dev false)', source_map_files: map.sources.length, first_party_or_other_files: firstParty, third_party_packages: list.length, packages: list, audit_findings_for_bundled_packages: advisories };
writeFileSync(join(REPO, 'docs', 'release', 'tv-bundle-packages.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${list.length} third-party packages in the bundle (${map.sources.length} source files, ${firstParty} first-party or other)`);
for (const p of list) console.log(`${p.name}@${p.version}  ${p.license}  (${p.files} files)`);
if (advisories) console.log('bundled packages that npm audit flags:', JSON.stringify(advisories, null, 1));

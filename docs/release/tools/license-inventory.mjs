#!/usr/bin/env node
/**
 * Licence inventory for the production (non-dev) dependencies of
 *   - the root npm workspace (packages/*, services/relay, apps/phone, tests), and
 *   - apps/tv (a standalone Node 22 project with its own lockfile).
 *
 * Why this script exists: `license-checker-rseidelsohn --production` was tried first and reports
 * 0 packages for the root workspace (the root package.json has no `dependencies`; the workspaces'
 * dependencies are hoisted) and 1 package for `--start services/relay`. `npm ls --json --long`
 * redacts parts of absolute paths, so it cannot be used to locate packages either. This script
 * walks `dependencies`, `optionalDependencies` and non-optional `peerDependencies` from the
 * entry points with the Node resolution algorithm, which is what `npm ls --omit=dev` models.
 *
 * Usage (from the repository root, after `npm ci` at the root and `npm ci` in apps/tv):
 *   node docs/release/tools/license-inventory.mjs
 * Writes docs/release/licenses.root.json, docs/release/licenses.tv.json, docs/release/LICENSES.md
 * and THIRD_PARTY_NOTICES.md. No network access. No dependencies.
 *
 * Classification is a heuristic over the declared SPDX expression. It is not legal advice.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
const OUT_DIR = join(REPO, 'docs', 'release');
const rj = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- licence classification ----
const PERMISSIVE = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0',
  'Unlicense', 'Python-2.0', 'Zlib', 'WTFPL', 'CC-BY-4.0', 'CC-BY-3.0', 'Artistic-2.0',
]);
const WEAK_COPYLEFT = /^(MPL-|EPL-|LGPL-|CDDL-|EUPL-)/;
const STRONG_COPYLEFT = /^(GPL-|AGPL-|SSPL-|CC-BY-SA|CC-BY-NC)/;

/** Parse an SPDX expression into {op, args} / {id}. Small recursive descent: OR < AND < WITH. */
function parseSpdx(expr) {
  const tokens = expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  function parseOr() {
    const parts = [parseAnd()];
    while (tokens[i] === 'OR') { i += 1; parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : { op: 'OR', args: parts };
  }
  function parseAnd() {
    const parts = [parseAtom()];
    while (tokens[i] === 'AND') { i += 1; parts.push(parseAtom()); }
    return parts.length === 1 ? parts[0] : { op: 'AND', args: parts };
  }
  function parseAtom() {
    if (tokens[i] === '(') {
      i += 1;
      const n = parseOr();
      if (tokens[i] === ')') i += 1;
      return n;
    }
    const id = tokens[i++] ?? '';
    if (tokens[i] === 'WITH') i += 2; // exception id is ignored for classification
    return { id: id.replace(/\+$/, '') };
  }
  return parseOr();
}

const ALIASES = new Map([
  ['Apache License, Version 2.0', 'Apache-2.0'], ['Apache 2.0', 'Apache-2.0'], ['Apache-2', 'Apache-2.0'],
  ['MIT License', 'MIT'], ['The MIT License', 'MIT'], ['BSD-3', 'BSD-3-Clause'], ['BSD-2', 'BSD-2-Clause'],
]);
const normalise = (expr) => ALIASES.get(expr) ?? expr;

// Higher rank = needs more attention. 'needs-review' covers undeclared, non-SPDX and public-domain claims.
const RANK = { permissive: 0, 'weak-copyleft': 1, copyleft: 2, 'needs-review': 3, proprietary: 4 };
function classifyNode(node) {
  if (node.id !== undefined) {
    if (PERMISSIVE.has(node.id)) return 'permissive';
    if (WEAK_COPYLEFT.test(node.id)) return 'weak-copyleft';
    if (STRONG_COPYLEFT.test(node.id)) return 'copyleft';
    return 'needs-review';
  }
  const cs = node.args.map(classifyNode);
  const pick = node.op === 'OR' ? Math.min : Math.max;
  const r = pick(...cs.map((c) => RANK[c]));
  return Object.keys(RANK).find((k) => RANK[k] === r);
}
function classify(expr, files) {
  const e = normalise(expr);
  if (!e) return 'needs-review';
  if (/^see licen[cs]e/i.test(e) || /^licenseref|^custom|^unlicensed/i.test(e)) {
    // A licence file that names a vendor agreement is proprietary; anything else needs a human.
    return files.some((f) => /Program Materials License Agreement/i.test(f.text)) ? 'proprietary' : 'needs-review';
  }
  try {
    return classifyNode(parseSpdx(e));
  } catch {
    return 'needs-review';
  }
}

// ----------------------------------------------------------------------- package discovery ----
function findPackageDir(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const cand = join(dir, 'node_modules', name);
    if (existsSync(join(cand, 'package.json'))) return realpathSync(cand);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseExpr(pkg) {
  const l = pkg.license;
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && l.type) return l.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    return pkg.licenses.map((x) => (typeof x === 'string' ? x : x.type)).join(' OR ');
  }
  return '';
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)(\.|-|_|$)/i;
function readLicenseFiles(dir) {
  const files = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return files; }
  for (const n of names.sort()) {
    if (!LICENSE_FILE.test(n)) continue;
    const p = join(dir, n);
    try {
      if (!statSync(p).isFile()) continue;
      const text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
      if (text) files.push({ file: n, text });
    } catch { /* unreadable: skipped */ }
  }
  return files;
}

function copyrightLines(files, dir) {
  const out = new Set();
  const scan = (text) => {
    for (const line of text.split('\n')) {
      const t = line.trim().replace(/^[/*#\s]+/, '');
      // A real notice looks like "Copyright (c) 2015 Name", "Copyright 2025 Name" or "(c) 2015 Name". Sentences
      // such as the Apache-2.0 clause 4(c) or "copyright notice that is included ..." and the appendix
      // template ("Copyright [yyyy] [name of copyright owner]") are not notices.
      const looksLikeNotice = /^(copyright\b\s*(\(c\)|\u00a9)?\s*\S|(\(c\)|\u00a9)\s*\d{4})/i.test(t);
      const boilerplate = /^copyright\s+(notice|owner|license|licence|holder|statement|law|and|in|of|to|is)\b/i.test(t) || /\[yyyy\]|\[name of/i.test(t);
      if (looksLikeNotice && !boilerplate && t.length < 200) out.add(t);
    }
  };
  for (const f of files) scan(f.text);
  if (out.size === 0) {
    // No licence file: look at the head of the first few JS files for a copyright header.
    for (const sub of ['', 'dist', 'lib']) {
      let names = [];
      try { names = readdirSync(join(dir, sub)).filter((n) => /\.(m?js|cjs)$/.test(n)).slice(0, 3); } catch { continue; }
      for (const n of names) {
        try { scan(readFileSync(join(dir, sub, n), 'utf8').split('\n').slice(0, 30).join('\n')); } catch { /* skip */ }
      }
      if (out.size) break;
    }
  }
  return [...out].slice(0, 3);
}

function repoUrl(pkg) {
  const r = pkg.repository;
  const u = typeof r === 'string' ? r : r?.url ?? '';
  return u.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@github.com/, 'https://github.com');
}

/** Walk production dependencies from the entry directories. */
function walk(entryDirs, { repoRoot }) {
  const seen = new Map(); // realpath -> entry
  const notInstalled = new Set();
  const queue = entryDirs.map((d) => ({ dir: d, via: '(entry)' }));
  while (queue.length) {
    const { dir, via } = queue.shift();
    if (seen.has(dir)) continue;
    const pkg = rj(join(dir, 'package.json'));
    const rel = relative(repoRoot, dir).split(sep).join('/');
    const firstParty = !rel.includes('node_modules/') && !rel.startsWith('..');
    const files = readLicenseFiles(dir);
    const expr = licenseExpr(pkg);
    seen.set(dir, {
      name: pkg.name, version: pkg.version, license: expr || '(none declared)', firstParty,
      path: rel, via, files, copyright: copyrightLines(files, dir), repository: repoUrl(pkg), homepage: pkg.homepage ?? '',
      classification: firstParty ? 'first-party' : classify(expr, files),
      spdx: normalise(expr) !== expr ? normalise(expr) : undefined,
    });
    const next = [];
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) next.push({ dep, optional: field === 'optionalDependencies' });
    }
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
      if (pkg.peerDependenciesMeta?.[dep]?.optional) continue;
      next.push({ dep, optional: true, peer: true });
    }
    for (const { dep, optional } of next) {
      const d = findPackageDir(dir, dep);
      if (!d) { if (!optional) notInstalled.add(`${dep} (required by ${pkg.name})`); else notInstalled.add(`${dep} (optional/peer of ${pkg.name}, not installed on this host)`); continue; }
      queue.push({ dir: d, via: pkg.name });
    }
  }
  return { entries: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), notInstalled: [...notInstalled].sort() };
}

// ------------------------------------------------------------------------------- projects ----
function rootEntries() {
  const root = rj(join(REPO, 'package.json'));
  const dirs = [];
  for (const w of root.workspaces ?? []) dirs.push(join(REPO, w));
  return dirs;
}

const projects = [
  {
    key: 'root', title: 'Root workspace (shared packages, relay, phone page build, tests)', lockfile: 'package-lock.json',
    entries: rootEntries(), repoRoot: REPO, nodeNote: 'installed with `npm ci` at the repository root',
  },
  {
    key: 'tv', title: 'apps/tv (React Native for Vega app)', lockfile: 'apps/tv/package-lock.json',
    entries: [join(REPO, 'apps', 'tv')], repoRoot: REPO, nodeNote: 'installed with `npm ci` in apps/tv (Node 22)',
  },
];

function gitHead() {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch { return 'unknown'; }
}

const results = {};
for (const p of projects) {
  const missing = p.entries.filter((d) => !existsSync(join(d, 'package.json')));
  if (missing.length) { console.error(`missing package.json: ${missing.join(', ')}`); process.exit(2); }
  if (!existsSync(join(p.entries[0] === join(REPO, 'apps', 'tv') ? p.entries[0] : REPO, 'node_modules'))) {
    console.error(`node_modules not installed for ${p.key}: run the install step first`); process.exit(2);
  }
  const lock = rj(join(REPO, p.lockfile));
  const { entries, notInstalled } = walk(p.entries, p);
  // lockfile cross-check (integrity + resolved) for third-party entries
  for (const e of entries) {
    if (e.firstParty) continue;
    const key = `${e.path.replace(/^apps\/tv\//, '')}`;
    const lp = lock.packages?.[key];
    e.integrity = lp?.integrity ?? null;
    e.resolved = lp?.resolved ?? null;
  }
  results[p.key] = { ...p, entryDirs: p.entries, entries, notInstalled, lockfileVersion: lock.lockfileVersion };
}

// ---------------------------------------------------------------------------------- output ----
const sha = (s) => createHash('sha256').update(s).digest('hex');
const head = gitHead();
const generated = process.env.LICENSE_INVENTORY_DATE ?? new Date().toISOString().slice(0, 10);

for (const [key, r] of Object.entries(results)) {
  const slim = r.entries.map(({ files, ...rest }) => ({ ...rest, licenseFiles: files.map((f) => ({ file: f.file, sha256: sha(f.text) })) }));
  writeFileSync(join(OUT_DIR, `licenses.${key}.json`), `${JSON.stringify({ project: r.title, generated_from_commit: head, count: slim.length, not_installed: r.notInstalled, packages: slim }, null, 1)}\n`);
}

function counts(entries, field) {
  const m = new Map();
  for (const e of entries) m.set(e[field], (m.get(e[field]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
const esc = (s) => String(s).replace(/\|/g, '\\|');

const bundleFile = join(OUT_DIR, 'tv-bundle-packages.json');
const bundleSet = existsSync(bundleFile) ? new Set(rj(bundleFile).packages.map((p) => `${p.name}@${p.version}`)) : null;

let md = `# Licence inventory (production dependencies)

Generated by \`docs/release/tools/license-inventory.mjs\` from commit \`${head}\` on ${generated}. Machine-readable copies: \`docs/release/licenses.root.json\`, \`docs/release/licenses.tv.json\`. Component notices with licence texts: \`THIRD_PARTY_NOTICES.md\`. SBOMs: \`docs/release/SBOM.cdx.json\` and \`docs/release/SBOM.tv.cdx.json\` (see \`docs/release/SUPPLY_CHAIN.md\`).

This is an engineering inventory, not legal advice. Classification is a heuristic over each package's declared SPDX expression; an \`OR\` expression counts as its most permissive alternative.

## Method

1. \`license-checker-rseidelsohn@4.4.2 --production --json\` was tried first. It reports 0 packages for the root workspace (the root \`package.json\` has no \`dependencies\`; workspace dependencies are hoisted) and 1 for \`--start services/relay\`, so it cannot be used for this layout. \`npm ls --json --long\` redacts parts of absolute paths, so it cannot locate packages either.
2. The script walks \`dependencies\`, \`optionalDependencies\` and non-optional \`peerDependencies\` from the entry points with the Node resolution algorithm (what \`npm ls --omit=dev\` models). Root entry points are the workspaces listed in the root \`package.json\`; apps/tv is its own project with its own lockfile.
3. For each package it reads the installed \`package.json\` (licence, repository), the licence and notice files, and a copyright line. Lockfile \`resolved\` and \`integrity\` values are recorded in the JSON.
4. Dev-only packages (TypeScript, Vitest, Vite, Playwright, axe-core, esbuild, Jest, Metro tooling pulled in by dev dependencies only) are excluded. They are build and test tools and are not shipped.

Scope caveats:

- For apps/tv, npm's production closure (\`react-native\` depends on the Metro and CLI plugin packages) is much larger than what lands in the JavaScript bundle. This inventory lists the closure; a bundle-level list is in \`docs/release/SUPPLY_CHAIN.md\`.
- The phone page (\`apps/phone\`) has no third-party runtime dependencies: Vite builds it from first-party code with the module-preload polyfill disabled, and two string searches of the built \`dist/\` found no \`node_modules\` path and no \`modulepreload\` helper. Vite itself is a dev-only build tool.
- The Lambda bundle (\`npm run bundle:lambda -w @atr/relay\`) inlines the AWS SDK v3 clients and their dependencies (listed under the root workspace). The local relay server additionally uses \`ws\`.
- \`@amazon-devices/*\` packages are loaded from the public npm registry. On a Vega device some of them are provided by the platform; this repository does not redistribute them.

`;

for (const [key, r] of Object.entries(results)) {
  const third = r.entries.filter((e) => !e.firstParty);
  const first = r.entries.filter((e) => e.firstParty);
  md += `## ${r.title}\n\n- Install: ${r.nodeNote}. Lockfile: \`${r.lockfile}\` (lockfileVersion ${r.lockfileVersion}).\n- First-party packages in the walk: ${first.length} (${first.map((e) => `\`${e.name}\``).join(', ')}).\n- Third-party production packages: **${third.length}**.\n\n`;
  const entryNames = new Set(r.entryDirs.map((d) => rj(join(d, 'package.json')).name));
  const direct = third.filter((e) => entryNames.has(e.via));
  md += `### Direct production dependencies\n\n| Package | Version | Licence | Pulled in by |\n|---|---|---|---|\n`;
  for (const e of direct) md += `| \`${e.name}\` | ${e.version} | ${esc(e.license)} | ${esc(e.via)} |\n`;
  md += `\n`;
  md += `### By licence expression\n\n| Licence (as declared) | Packages | Classification |\n|---|---:|---|\n`;
  const byLic = new Map();
  for (const e of third) { const k = e.spdx ? `${e.license} (read as ${e.spdx})` : e.license; const v = byLic.get(k) ?? { n: 0, c: e.classification }; v.n += 1; byLic.set(k, v); }
  for (const [lic, v] of [...byLic.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) md += `| ${esc(lic)} | ${v.n} | ${v.c} |\n`;
  const flagged = third.filter((e) => e.classification !== 'permissive');
  md += `\n### Flagged (not plainly permissive): ${flagged.length}\n\n`;
  if (!flagged.length) md += 'None.\n\n';
  else {
    const bundled = key === 'tv' && bundleSet ? (e) => (bundleSet.has(`${e.name}@${e.version}`) ? 'yes' : 'no') : () => 'n/a';
    md += `| Package | Version | Declared licence | Classification | Pulled in by | Licence file | In the JS bundle |\n|---|---|---|---|---|---|---|\n`;
    for (const e of flagged) md += `| \`${e.name}\` | ${e.version} | ${esc(e.license)} | ${e.classification} | ${esc(e.via)} | ${e.files.map((f) => f.file).join(', ') || 'none shipped'} | ${bundled(e)} |\n`;
    md += '\n';
  }
  const noFile = third.filter((e) => e.files.length === 0);
  md += `### Packages that ship no licence file: ${noFile.length}\n\n`;
  md += noFile.length ? `${noFile.map((e) => `\`${e.name}@${e.version}\` (${e.license})`).join(', ')}\n\n` : 'None.\n\n';
  md += `### Not installed on this host (optional or peer)\n\n${r.notInstalled.length ? r.notInstalled.map((x) => `- ${x}`).join('\n') : 'None.'}\n\n`;
}

writeFileSync(join(OUT_DIR, 'LICENSES.md'), md);

// -------------------------------------------------------------- THIRD_PARTY_NOTICES.md ----
let tp = `# Third-party notices

"Across the Room: the far-side check" is licensed under the MIT licence (see \`LICENSE\`). It uses the third-party components listed below. This file is generated by \`docs/release/tools/license-inventory.mjs\` from commit \`${head}\` on ${generated}; regenerate it after any dependency change. Flags and method: \`docs/release/LICENSES.md\`.

Scope: production (non-dev) dependencies of the root npm workspace (relay, shared packages) and of \`apps/tv\`. Development and test tools (TypeScript, Vitest, Vite, Playwright, axe-core, esbuild, Jest and similar) are not shipped and are not listed.

Trademarks: "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. Amazon, Fire TV, Vega and related marks belong to Amazon.com, Inc. or its affiliates. Their use here is descriptive; no endorsement is claimed.

## Components under non-open-source terms

The following packages declare "See license in LICENSE". Their licence file says the materials are licensed as "Program Materials" under the Program Materials License Agreement (https://developer.amazon.com/support/legal/pml). They are not open-source licences and are not covered by this project's MIT licence. They are installed from the public npm registry and are not copied into this repository.

`;
const nonOss = results.tv.entries.concat(results.root.entries).filter((e) => !e.firstParty && e.classification === 'proprietary');
const seenNo = new Set();
for (const e of nonOss) { const k = `${e.name}@${e.version}`; if (seenNo.has(k)) continue; seenNo.add(k); tp += `- \`${k}\` — ${e.license}${e.copyright[0] ? ` — ${e.copyright[0]}` : ''}\n`; }
if (!nonOss.length) tp += '- none\n';
tp += `\n## Components whose licence is declared unclearly (review before public production use)\n\nThese declare no licence, a non-SPDX or public-domain statement, or ship no licence text. They are listed so that nobody has to discover them later. The status of each is in \`docs/release/LICENSES.md\`.\n\n`;
const unclear = results.tv.entries.concat(results.root.entries).filter((e) => !e.firstParty && e.classification === 'needs-review');
const seenUn = new Set();
for (const e of unclear) { const k = `${e.name}@${e.version}`; if (seenUn.has(k)) continue; seenUn.add(k); tp += `- \`${k}\` — declared: ${e.license} — pulled in by ${e.via}\n`; }
if (!unclear.length) tp += '- none\n';

const texts = new Map(); // sha -> {text, pkgs:Set}
for (const [key, r] of Object.entries(results)) {
  tp += `\n## ${r.title}\n\n| Package | Version | Licence | Copyright / source |\n|---|---|---|---|\n`;
  for (const e of r.entries.filter((x) => !x.firstParty)) {
    const cr = e.copyright[0] ?? (e.repository || e.homepage || '');
    tp += `| ${esc(e.name)} | ${esc(e.version)} | ${esc(e.license)} | ${esc(cr)} |\n`;
    for (const f of e.files) {
      const h = sha(f.text);
      const t = texts.get(h) ?? { text: f.text, pkgs: new Set() };
      t.pkgs.add(`${e.name}@${e.version}`);
      texts.set(h, t);
    }
  }
}
tp += `\n## Licence and notice texts\n\nEach distinct text appears once, followed by the packages whose licence or notice file has exactly that text.\n`;
const sorted = [...texts.values()].sort((a, b) => b.pkgs.size - a.pkgs.size || a.text.localeCompare(b.text));
let n = 0;
for (const t of sorted) {
  n += 1;
  const pk = [...t.pkgs].sort();
  const fence = t.text.includes('```') ? '~~~~' : '```';
  tp += `\n### Text ${n}\n\nUsed by (${pk.length}): ${pk.join(', ')}\n\n${fence}text\n${t.text}\n${fence}\n`;
}
writeFileSync(join(REPO, 'THIRD_PARTY_NOTICES.md'), tp);

console.log(JSON.stringify({
  commit: head,
  root: { total: results.root.entries.length, thirdParty: results.root.entries.filter((e) => !e.firstParty).length, byClass: counts(results.root.entries, 'classification') },
  tv: { total: results.tv.entries.length, thirdParty: results.tv.entries.filter((e) => !e.firstParty).length, byClass: counts(results.tv.entries, 'classification') },
  distinctTexts: sorted.length,
}, null, 1));
mkdirSync(OUT_DIR, { recursive: true });

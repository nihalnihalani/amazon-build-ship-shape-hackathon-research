#!/usr/bin/env node
/**
 * Runner for the TV web-preview accessibility gate (evidence class: web_preview).
 *
 *   node a11y/run-a11y.mjs            (from tests/, or: node tests/a11y/run-a11y.mjs from the repo root)
 *
 * 1. installs apps/tv and apps/tv/web dependencies if node_modules is missing (npm ci, no scripts),
 * 2. builds the preview with `vite build` (the dev server's dependency optimiser fails on Flow sources in
 *    react-native, see docs/evaluation/A11Y_T17_PREP.md), serves it with `vite preview` on a free port,
 * 3. runs vitest on tests/a11y/*.e2e.ts in system Google Chrome,
 * 4. stops the server and exits with the vitest exit code.
 * Environment: TV_PREVIEW_PORT (default 5179), TV_PREVIEW_URL (skip build and serve; use an existing server).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const webDir = join(root, 'apps', 'tv', 'web');
const tvDir = join(root, 'apps', 'tv');
const testsDir = join(root, 'tests');

function run(cmd, args, cwd, label) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[run-a11y] ${label} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

function freePort(preferred) {
  return new Promise((res) => {
    const probe = net.createServer();
    probe.once('error', () => {
      const any = net.createServer();
      any.listen(0, '127.0.0.1', () => {
        const { port } = any.address();
        any.close(() => res(port));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => probe.close(() => res(preferred)));
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let server = null;
let url = process.env.TV_PREVIEW_URL;
if (!url) {
  if (!existsSync(join(tvDir, 'node_modules'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], tvDir, 'npm ci (apps/tv)');
  if (!existsSync(join(webDir, 'node_modules'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], webDir, 'npm ci (apps/tv/web)');
  run('npx', ['vite', 'build'], webDir, 'vite build');
  const port = await freePort(Number(process.env.TV_PREVIEW_PORT ?? 5179));
  server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: webDir, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}`;
  if (!(await waitFor(url, 20000))) {
    server.kill();
    console.error('[run-a11y] preview server did not start');
    process.exit(2);
  }
}
console.log(`[run-a11y] preview at ${url}`);
const result = spawnSync('npx', ['vitest', 'run', '--config', 'a11y/vitest.config.ts'], {
  cwd: testsDir,
  stdio: 'inherit',
  env: { ...process.env, TV_PREVIEW_URL: url },
});
if (server) server.kill();
process.exit(result.status ?? 1);

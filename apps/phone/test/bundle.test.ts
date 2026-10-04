// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRAME_PROCESSOR_SOURCE } from '@atr/phone-mic-meter';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * These tests BUILD the app (production -> dist, test build -> dist-test) and inspect the
 * emitted files, so they check what actually ships rather than the source.
 */
const APP = resolve(import.meta.dirname ?? process.cwd() + '/test', '..');
const DIST = join(APP, 'dist');
const DIST_TEST = join(APP, 'dist-test');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}
const read = (dir: string, only?: RegExp): string =>
  files(dir)
    .filter((f) => (only ? only.test(f) : true))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

beforeAll(async () => {
  await build({ root: APP, configFile: join(APP, 'vite.config.ts'), mode: 'production', logLevel: 'silent' });
  await build({ root: APP, configFile: join(APP, 'vite.config.ts'), mode: 'test-audio', logLevel: 'silent' });
}, 120_000);

describe('production bundle (dist)', () => {
  it('contains no synthetic test audio code, hook or banner', () => {
    const all = read(DIST);
    expect(all).not.toContain('__atrTestAudio');
    expect(all).not.toContain('Synthetic test audio');
    expect(all).not.toContain('setLevelDbfs');
    expect(all).not.toContain('MediaStreamDestination'); // the oscillator -> gain -> destination chain
    expect(files(DIST).some((f) => /test-audio/.test(f))).toBe(false);
  });

  it('never references recorders or browser storage', () => {
    const all = read(DIST);
    for (const forbidden of ['MediaRecorder', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });

  it('has no markup-injection or dynamic-code primitives', () => {
    const all = read(DIST, /\.js$/);
    for (const forbidden of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function(']) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });

  it('has no third-party URLs, analytics, remote fonts or sourcemaps', () => {
    const all = read(DIST);
    expect(all).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(all).not.toMatch(/googletagmanager|google-analytics|segment\.com|sentry|mixpanel|fonts\.googleapis/i);
    expect(files(DIST).some((f) => f.endsWith('.map'))).toBe(false);
  });

  it('serves the worklet as a same-origin file and keeps the CSP strict (no blob:, no inline, wss only)', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/blob:|unsafe-inline|unsafe-eval|data:/);
    expect(csp).toContain("connect-src 'self' wss:");
    expect(csp).not.toMatch(/connect-src[^;]*\bws:/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline scripts
    expect(html).not.toMatch(/\sstyle=|<style/); // no inline styles
    expect(readFileSync(join(DIST, 'frame-processor.js'), 'utf8')).toBe(FRAME_PROCESSOR_SOURCE);
    expect(read(DIST, /assets\/index-.*\.js$/)).toMatch(/frame-processor\.js\?v=[0-9a-f]{10}/);
  });

  it('the worklet source posts scalars only (no sample buffers)', () => {
    const src = readFileSync(join(DIST, 'frame-processor.js'), 'utf8');
    expect(src).not.toMatch(/postMessage\([^)]*(inputs|channel)\b/);
    expect(src).not.toMatch(/Float32Array|slice\(|\.buffer|transfer/);
  });
});

describe('test build (dist-test)', () => {
  it('is a separate output that does contain the test-only code (positive control for the checks above)', () => {
    expect(existsSync(DIST_TEST)).toBe(true);
    const all = read(DIST_TEST);
    expect(all).toContain('__atrTestAudio');
    expect(all).toContain('Synthetic test audio');
    expect(all).toContain('setLevelDbfs');
  });

  it('allows a local ws:// relay in its CSP; still no inline scripts or blob:', () => {
    const html = readFileSync(join(DIST_TEST, 'index.html'), 'utf8');
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toMatch(/connect-src[^;]*\bws:/);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/blob:|unsafe-inline/);
  });

  it('also never references recorders or browser storage', () => {
    const all = read(DIST_TEST);
    for (const forbidden of ['MediaRecorder', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });
});

describe('source hygiene', () => {
  it('no source file under src/ uses recorder or storage APIs', () => {
    for (const file of files(join(APP, 'src')).filter((f) => /\.(ts|js|css)$/.test(f))) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const forbidden of ['MediaRecorder', 'localStorage', 'sessionStorage', 'indexedDB']) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

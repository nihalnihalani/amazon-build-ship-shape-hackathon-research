/**
 * End-to-end environment: a real local relay (services/relay, HTTPS + WSS with a throwaway dev CA),
 * the phone TEST build (apps/phone/dist-test, synthetic audio) served by that relay, system Chrome
 * driven by playwright-core, and the headless TV driver.
 *
 * Evidence class of anything produced here: automated (synthetic audio in desktop Chrome, headless
 * TV session core). It is never real_phone or real_VVD.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page, type WebSocket as PwWebSocket } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CHROME = process.env.ATR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface RelayEnv {
  port: number;
  origin: string;
  wsUrl: string;
  ca: Buffer;
  proc: ChildProcess;
  logs: string[];
  certDir: string;
  stop(): Promise<void>;
}

export function buildArtifacts(): void {
  const run = (args: string[]) => execFileSync('npm', args, { cwd: ROOT, stdio: 'pipe' });
  run(['run', 'build', '-w', '@atr/protocol']);
  run(['run', 'build', '-w', '@atr/phone-mic-meter']);
  run(['run', 'build', '-w', '@atr/session-core']);
  run(['run', 'build', '-w', '@atr/relay']);
  run(['run', 'build:test', '-w', '@atr/phone']);
}

function healthz(port: number, ca: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get({ host: 'localhost', port, path: '/healthz', ca, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startRelay(opts: { staticDir?: string } = {}): Promise<RelayEnv> {
  const certDir = mkdtempSync(path.join(os.tmpdir(), 'atr-e2e-certs-'));
  execFileSync('bash', [path.join(ROOT, 'scripts/dev-certs/make-dev-certs.sh'), '--out', certDir], { stdio: 'pipe' });
  const ca = readFileSync(path.join(certDir, 'ca.crt'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const origin = `https://localhost:${port}`;
  const logs: string[] = [];
  const proc = spawn(process.execPath, [path.join(ROOT, 'services/relay/dist/local/main.js')], {
    cwd: path.join(ROOT, 'services/relay'),
    env: {
      ...process.env,
      ATR_PORT: String(port),
      ATR_HOST: '127.0.0.1',
      ATR_ALLOWED_ORIGINS: origin,
      ATR_STATIC_DIR: opts.staticDir ?? path.join(ROOT, 'apps/phone/dist-test'),
      ATR_TLS_CERT: path.join(certDir, 'server.crt'),
      ATR_TLS_KEY: path.join(certDir, 'server.key'),
      ATR_TICK_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => logs.push(String(d)));
  proc.stderr?.on('data', (d) => logs.push(String(d)));
  const start = Date.now();
  while (!(await healthz(port, ca))) {
    if (proc.exitCode !== null) throw new Error(`relay exited: ${logs.join('')}`);
    if (Date.now() - start > 15_000) throw new Error(`relay did not become healthy: ${logs.join('')}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    port,
    origin,
    wsUrl: `wss://localhost:${port}/ws`,
    ca,
    proc,
    logs,
    certDir,
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      rmSync(certDir, { recursive: true, force: true });
    },
  };
}

export interface PhoneEnv {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Every text frame the page sent or received over WebSocket, parsed. */
  sent: Array<Record<string, unknown>>;
  received: Array<Record<string, unknown>>;
  problems: string[];
  setLevel(dbfs: number): Promise<void>;
  silence(): Promise<void>;
  close(): Promise<void>;
}

export async function startPhone(): Promise<PhoneEnv> {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  // The dev CA is not installed in Chrome; certificate errors are ignored for this throwaway origin.
  // The page is still served over https, so it remains a secure context.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const sent: Array<Record<string, unknown>> = [];
  const received: Array<Record<string, unknown>> = [];
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  page.on('websocket', (ws: PwWebSocket) => {
    ws.on('framesent', (f) => {
      if (typeof f.payload === 'string') sent.push(JSON.parse(f.payload) as Record<string, unknown>);
      else problems.push('binary frame sent by phone');
    });
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') received.push(JSON.parse(f.payload) as Record<string, unknown>);
    });
  });
  return {
    browser,
    context,
    page,
    sent,
    received,
    problems,
    setLevel: async (dbfs) => {
      await page.evaluate((x) => (window as unknown as { __atrTestAudio: { setLevelDbfs(v: number): void } }).__atrTestAudio.setLevelDbfs(x), dbfs);
    },
    silence: async () => {
      await page.evaluate(() => (window as unknown as { __atrTestAudio: { setSilence(): void } }).__atrTestAudio.setSilence());
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

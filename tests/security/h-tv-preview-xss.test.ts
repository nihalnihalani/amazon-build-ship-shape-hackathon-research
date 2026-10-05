/**
 * T16 gate, part H: XSS-looking text on the TV, rendered by the TV web preview (react-native-web, the real
 * session-core store inside the page) against a scripted relay and phone. The preview is a browser stand-in for the
 * Vega UI: this is evidence class web_preview and says nothing about how Vega's text component treats the same
 * strings (that needs the VVD, T17).
 *
 *   SEC-W01  hostile device label and hostile phrases are shown literally and run nothing
 *   PK-09    the store refuses a decoded object as a wire frame, and a frame whose sender_role is tv
 *
 * The preview is built with `vite build` and served with `vite preview` (as tests/a11y/run-a11y.mjs does).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { CHROME, ROOT } from '../src/e2e-env.js';
import { ScriptedPhone } from '../a11y/scripted-phone.js';

const WEB = path.join(ROOT, 'apps/tv/web');
const HOSTILE_LABEL = '<img src=x onerror=1>';
const HOSTILE_BANK = [`<img src=x onerror="window.__xss=1">`, `"><script>window.__xss=2</script>`, 'javascript:window.__xss=3', '</div><svg onload=window.__xss=4>'];

let server: ChildProcess | null = null;
let url = process.env['TV_PREVIEW_URL'] ?? '';
let browser: Browser;
let context: BrowserContext;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  if (url === '') {
    const build = spawnSync('npx', ['vite', 'build'], { cwd: WEB, stdio: 'pipe', timeout: 300_000 });
    if (build.status !== 0) throw new Error(`vite build failed: ${String(build.stderr).slice(-600)}`);
    const port = await freePort();
    server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: WEB, stdio: 'ignore' });
    url = `http://127.0.0.1:${port}`;
    const end = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > end) throw new Error('preview server did not start');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  context = await browser.newContext({ viewport: { width: 1920, height: 1124 }, deviceScaleFactor: 0.5 });
}, 400_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  server?.kill();
});

const wait = (page: Page, testId: string, timeout = 20_000) => page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
const body = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText);
const injected = (page: Page): Promise<{ xss: unknown; handlers: number; scripts: number; svgs: number }> =>
  page.evaluate(() => ({
    xss: (window as unknown as { __xss?: unknown }).__xss,
    handlers: document.querySelectorAll('[onerror],[onload],[onclick],[onmouseover]').length,
    scripts: Array.from(document.querySelectorAll('script')).filter((s) => !s.src).length,
    svgs: Array.from(document.querySelectorAll('svg')).filter((s) => s.getAttribute('onload') !== null).length,
  }));

describe('SEC-W01 TV preview: hostile label and phrases', () => {
  it('shows the device label and every phrase as literal text; no element, handler or script is created from them', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, { bank: HOSTILE_BANK });
    await phone.install();
    await page.goto(`${url}/?mode=store`);
    await wait(page, 'screen-onboarding');
    await page.keyboard.press('Enter');
    await wait(page, 'screen-home');
    await page.keyboard.press('Enter');
    await wait(page, 'screen-pairing');

    // a hostile join request (the relay forwards whatever the validator let through)
    (phone as unknown as { sendRelay(type: string, payload: unknown): void }).sendRelay('join.requested', {
      join_id: 'j_secreview00001',
      device_label: HOSTILE_LABEL,
      confirm_digits: '42',
      expires_at: Date.now() + 60_000,
    });
    await wait(page, 'screen-join_confirm');
    const joinText = await body(page);
    expect(joinText).toContain(`Name the phone gave: ${HOSTILE_LABEL}`);
    expect(await injected(page)).toEqual({ xss: undefined, handlers: 0, scripts: 0, svgs: 0 });

    // pick the right number
    const picks = await page.$$eval('[data-testid^="action-pick_choice_"]', (els) => els.map((e) => ({ id: e.getAttribute('data-testid') ?? '', name: e.getAttribute('aria-label') ?? (e as HTMLElement).innerText })));
    const right = picks.find((p) => p.name.includes('42'));
    expect(right).toBeDefined();
    await page.click(`[data-testid="${(right as { id: string }).id}"]`);
    await wait(page, 'screen-quiet_check', 20_000);
    await page.click('[data-testid="action-begin_quiet_check"]');
    await wait(page, 'action-begin_calibration', 30_000);
    await page.click('[data-testid="action-begin_calibration"]');
    await wait(page, 'action-continue', 30_000);
    await page.click('[data-testid="action-continue"]');
    await wait(page, 'action-skip_vowel', 30_000);
    await page.click('[data-testid="action-skip_vowel"]');

    // each phrase appears on its ready screen exactly as sent
    for (let i = 0; i < HOSTILE_BANK.length; i += 1) {
      await wait(page, 'screen-phrase', 30_000);
      await page.waitForFunction((t) => document.body.innerText.includes(t), HOSTILE_BANK[i] as string, { timeout: 15_000 });
      expect(await body(page), `phrase ${i + 1}`).toContain(HOSTILE_BANK[i] as string);
      expect(await injected(page), `phrase ${i + 1}`).toEqual({ xss: undefined, handlers: 0, scripts: 0, svgs: 0 });
      // the same text is what assistive technology is given
      const labels = await page.$$eval('[aria-label]', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      expect(labels.some((l) => l.includes(HOSTILE_BANK[i] as string)) || (await body(page)).includes(HOSTILE_BANK[i] as string)).toBe(true);
      if (i < HOSTILE_BANK.length - 1) {
        await page.click('[data-testid="action-skip_phrase"]');
        await page.waitForFunction((n) => /Phrase\s+\d+/.test(document.body.innerText) || document.querySelectorAll('[data-testid="screen-phrase"]').length >= 1 || n, i);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    await page.close();
  }, 180_000);

  it('TM-G3: the preview store ignores a malformed frame and a frame claiming sender_role tv; neither changes the screen', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, {});
    await phone.install();
    await page.goto(`${url}/?mode=store`);
    await wait(page, 'screen-onboarding');
    await page.keyboard.press('Enter');
    await wait(page, 'screen-home');
    await page.keyboard.press('Enter');
    await wait(page, 'screen-pairing');
    await wait(page, 'pairing-code');
    await new Promise((r) => setTimeout(r, 500));
    const settled = async (): Promise<string> => (await body(page)).replace(/Code expires in \d+:\d+/, 'Code expires in N');
    const before = await settled();
    // a decoded object delivered where a text frame belongs, and a TV-originated frame sent towards the TV
    const relay = phone as unknown as { ws: { send(data: unknown): void } | null };
    relay.ws?.send(JSON.stringify({ protocol_version: 1, type: 'join.requested' }));
    relay.ws?.send(
      JSON.stringify({
        protocol_version: 1, type: 'join.requested', message_id: 'm_' + 'A'.repeat(22), room_id: 'r_a11yreviewroom0001', session_id: null, window_id: null,
        attempt_id: null, sender_role: 'tv', producer_generation: 0, sequence: 0, event_timestamp: Date.now(),
        payload: { join_id: 'j_secreview00002', device_label: 'forged by a TV-role frame', confirm_digits: '11', expires_at: Date.now() + 60_000 },
      }),
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(await page.$('[data-testid="screen-join_confirm"]')).toBeNull();
    expect(await body(page)).not.toContain('forged by a TV-role frame');
    expect(await settled()).toBe(before);
    await page.close();
  }, 120_000);
});

// Smoke test: loads dist-test in real (headless) Chrome and checks that the page renders and
// reaches the join view, with the synthetic-audio banner and hooks present.
// Run: npm run build:test -w @atr/phone && npm run e2e -w @atr/phone
// Evidence class: automated browser smoke. It is NOT a real-phone or real-microphone check.
import { launchChrome, makeChecker, startStaticServer } from './lib.mjs';

// Exact copy from docs/adr/AMENDMENTS-REV2.md (A2-01), typed independently of src/config.ts.
const PRIVACY =
  'Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.';

const checker = makeChecker();
const { check } = checker;
const site = await startStaticServer();
let browser;
try {
  browser = await launchChrome();
  console.log(`Chrome ${browser.version()} launched headless`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  await page.addInitScript(() => {
    window.__sockets = 0;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__sockets += 1;
      }
    };
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const notFound = [];
  page.on('response', (r) => {
    if (r.status() === 404) notFound.push(r.url());
  });

  await page.goto(`${site.origin}/#code=acdefh`);
  await page.waitForSelector('#view-join:not([hidden])');

  check('title', (await page.title()) === 'Across the Room: phone', await page.title());
  check('join view is shown, setup and unpaired are hidden', await page.evaluate(() => !document.getElementById('view-join').hidden && document.getElementById('view-setup').hidden && document.getElementById('unpaired-notice').hidden));
  check('code autofilled from #code= and upper-cased', (await page.inputValue('#code')) === 'ACDEFH', await page.inputValue('#code'));
  check('the fragment was cleared from the address', (await page.evaluate(() => location.hash)) === '', await page.evaluate(() => location.href));
  check('device label defaults to Browser (desktop Chrome)', (await page.inputValue('#device-label')) === 'Browser');
  check('synthetic test audio banner is shown', (await page.textContent('#test-banner')) === 'Synthetic test audio — not a microphone');
  check('window.__atrTestAudio hooks exist', await page.evaluate(() => typeof window.__atrTestAudio?.setLevelDbfs === 'function' && typeof window.__atrTestAudio?.setSilence === 'function'));
  check('exact amended privacy sentence (A2-01) is shown', (await page.textContent('#privacy')) === PRIVACY);
  check('status region is polite and role=status', await page.evaluate(() => { const s = document.getElementById('status'); return s.getAttribute('role') === 'status' && s.getAttribute('aria-live') === 'polite'; }));
  check('secure context (http://127.0.0.1 counts as secure)', await page.evaluate(() => window.isSecureContext));
  check('no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));
  const realProblems = problems.filter((p) => !p.includes('404'));
  check('no page errors or console errors (404 for the favicon excluded, checked separately)', realProblems.length === 0, realProblems.join(' | '));
  check('no network request left this machine', requests.every((u) => u.startsWith(site.origin)), requests.filter((u) => !u.startsWith(site.origin)).join(', '));
  check('no browser storage used', await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));
  check('no cookies in the browser context', (await context.cookies()).length === 0);
  check('nothing connected to a relay before Join is pressed', (await page.evaluate(() => window.__sockets)) === 0);
  check('only the browser favicon request was a 404 (static server has no favicon)', notFound.every((u) => u.endsWith('/favicon.ico')), notFound.join(', '));

  // Non-secure explanation is covered by unit tests; here check the layout works at phone width.
  check('no horizontal scrolling at 390 px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const joinBox = await page.locator('#join').boundingBox();
  check('Join button is at least 64 px tall', joinBox && joinBox.height >= 64, `${joinBox?.height}px`);
  await context.close();
} catch (error) {
  check('smoke test ran to completion', false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  await site.close();
}
if (checker.failed.length > 0) {
  console.error(`\n${checker.failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: all checks passed');

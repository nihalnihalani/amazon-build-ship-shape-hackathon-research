// Production bundle (dist) in real headless Chrome.
//
//   A1. the REAL getUserMedia, with no permission granted. What headless Chrome does with it depends
//      on the host (macOS microphone permission state for Chrome, Chrome version), so BOTH outcomes
//      are legitimate and each is checked against the right UI; the one that happened is recorded:
//        pending            -> "Waiting for permission" with a working Cancel, Cancel returns to "Mic off"
//        immediate denial   -> "Permission denied" with re-enable guidance, Start offered again, the
//                              TV told permission_denied and never open or measuring
//      A2. each getUserMedia error class rendered by the real page (the rejection itself is STUBBED)
//   B. a precheck and a full shutdown through the production bundle's real capture adapter, real
//      AudioContext and real AudioWorklet loaded under the strict CSP. getUserMedia is STUBBED by
//      this script to return an oscillator MediaStream (headless Chrome 154 leaves the real
//      getUserMedia pending even with --use-fake-device-for-media-stream; probe results are in
//      the task handoff)
//   C. ?relay= is ignored in production, there is no test banner and no test hook
//
// Evidence class: automated, desktop Chrome with a STUBBED getUserMedia (A2, B) and one real
// browser behaviour (A1: an unanswered prompt stays pending). It proves the production bundle's
// rendering, CSP, worklet loading and shutdown in desktop Chrome; it does NOT prove anything about
// Android Chrome, a physical microphone, AGC behaviour or real permission prompts.
// Run: npm run build -w @atr/phone && node e2e/production.mjs
import { createIdFactory, MessageFactory, parseWireMessage } from '@atr/protocol';
import { DIST, launchChrome, makeChecker, startStaticServer, waitFor } from './lib.mjs';

const SIMULATE = process.env['ATR_E2E_SIMULATE'] === 'pending' ? 'pending' : null;
const checker = makeChecker();
const { check } = checker;
const site = await startStaticServer(DIST);

const ids = createIdFactory();
const ROOM = ids.room();
const SESSION = ids.session();
const clock = () => Date.now();

/** Mocks the relay and TV for one page. Messages from the phone are validated with the package. */
async function mockRelay(page) {
  const relay = new MessageFactory({ role: 'relay', idFactory: ids, clock });
  const tv = new MessageFactory({ role: 'tv', idFactory: ids, clock, roomId: ROOM, generation: 1 });
  const state = { received: [], invalid: [], urls: [], socket: null };
  await page.routeWebSocket(/.*/, (ws) => {
    state.socket = ws;
    state.urls.push(ws.url());
    ws.onMessage((raw) => {
      const parsed = parseWireMessage(String(raw));
      if (parsed.ok) state.received.push(parsed.message);
      else state.invalid.push(`${parsed.code}: ${parsed.detail}`);
    });
  });
  const of = (type) => state.received.filter((m) => m.type === type);
  return {
    state,
    of,
    last: (type) => of(type).at(-1),
    relay: (type, payload, extra = {}) => state.socket.send(JSON.stringify(relay.next(type, payload, { room_id: ROOM, ...extra }))),
    tv: (type, payload, idsIn = {}) => {
      const m = tv.next(type, payload, idsIn);
      state.socket.send(JSON.stringify(m));
      return m.message_id;
    },
  };
}

async function pair(page, mock) {
  await page.click('#join');
  await waitFor(() => mock.of('join.request').length > 0, { label: 'join.request' });
  mock.relay('join.pending', { join_id: ids.join(), confirm_digits: '12', expires_at: Date.now() + 60_000 }, { room_id: null });
  mock.relay('join.accepted', { room_id: ROOM, phone_credential: 'T'.repeat(43), credential_expires_at: Date.now() + 3_600_000, generation: 1 });
  await page.waitForSelector('#confirm-self:not([hidden])');
  await page.click('#confirm-yes'); // "Yes, that was me"
  await page.waitForSelector('#view-setup:not([hidden])');
}

const initScript = (opts) => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  window.__ctxs = [];
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...a) {
      super(...a);
      window.__ctxs.push(this);
    }
  };
  window.__tracks = [];
  const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (gum) {
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gumCalls = (window.__gumCalls ?? []).concat([JSON.stringify(c)]);
      if (!window.__gumFail && !window.__gumSynthetic) {
        // A REAL request: record how the browser answers it (settled outcome or still pending).
        const entry = { at: Date.now(), settled: null, name: null, ms: null };
        (window.__realGum = window.__realGum ?? []).push(entry);
        // ATR_E2E_SIMULATE=pending holds the request unanswered (what older hosts did), so the
        // "pending" branch can be exercised on a host that denies at once. Never the default.
        const real = opts?.simulate === 'pending' ? new Promise(() => undefined) : gum(c);
        real.then(
          (stream) => {
            entry.settled = 'resolved';
            entry.ms = Date.now() - entry.at;
            window.__tracks.push(...stream.getTracks());
          },
          (error) => {
            entry.settled = 'rejected';
            entry.name = error?.name ?? 'Error';
            entry.ms = Date.now() - entry.at;
          },
        );
        return real;
      }
      // STUB (A2 only): the browser API is made to reject with a named DOMException so the real
      // page, real capture adapter and real CSS render each error class. Headless Chrome cannot
      // be made to deny a prompt (a denied request stays pending), so this is not a real denial.
      if (window.__gumFail) throw new DOMException('stubbed for the e2e test', window.__gumFail);
      if (window.__gumSynthetic) {
        // STUB (B): an oscillator stream standing in for the microphone, created by this script.
        const sctx = new window.AudioContext();
        const osc = sctx.createOscillator();
        osc.frequency.value = 220;
        const g = sctx.createGain();
        g.gain.value = Math.SQRT2 * Math.pow(10, -30 / 20); // sine of -30 dBFS RMS
        const dest = sctx.createMediaStreamDestination();
        osc.connect(g);
        g.connect(dest);
        osc.start();
        if (sctx.state === 'suspended') await sctx.resume();
        window.__tracks.push(...dest.stream.getTracks());
        return dest.stream;
      }
      const stream = await gum(c);
      window.__tracks.push(...stream.getTracks());
      return stream;
    };
  }
};

let denied;
let fake;
try {
  // ---------------- A: permission pending, then denied -----------------------------------------
  denied = await launchChrome();
  console.log(`Chrome ${denied.version()} (no fake device; microphone permission left as "prompt")`);
  {
    const context = await denied.newContext();
    const page = await context.newPage();
    await page.addInitScript(initScript, { simulate: SIMULATE });
    const mock = await mockRelay(page);
    await page.goto(`${site.origin}/?relay=ws://127.0.0.1:9/ws#code=ACDEFH`);
    check('C. production page has no test banner and no test hook', (await page.locator('#test-banner').isHidden()) && (await page.evaluate(() => window.__atrTestAudio)) === undefined);
    await pair(page, mock);
    check('C. ?relay= is ignored in production: the page dialled wss://<its own host>/ws', mock.state.urls[0] === `wss://${new URL(site.origin).host}/ws`, mock.state.urls[0]);
    check('A. before the tap the page has not asked for the microphone', ((await page.evaluate(() => window.__gumCalls)) ?? []).length === 0);

    // A1: the REAL getUserMedia. Observe how this host's Chrome answers it, then assert the matching UI.
    await page.click('#start-mic');
    const settledBy = Date.now() + 2500;
    const realOutcome = async () => (await page.evaluate(() => (window.__realGum ?? []).at(-1) ?? null));
    let real = await realOutcome();
    while ((real === null || real.settled === null) && Date.now() < settledBy) {
      await new Promise((r) => setTimeout(r, 50));
      real = await realOutcome();
    }
    const outcome = real === null ? 'no request seen' : real.settled === null ? 'pending' : real.settled === 'rejected' && real.name === 'NotAllowedError' ? 'immediate_not_allowed' : `unexpected_${real.settled}${real.name ? `_${real.name}` : ''}`;
    const label = SIMULATE ? `${outcome} (SIMULATED: ATR_E2E_SIMULATE=pending holds the real request unanswered)` : outcome;
    console.log(`      getUserMedia outcome on this host (no permission granted): ${label}${real?.ms != null ? ` after ${real.ms} ms` : ' (still unanswered after 2.5 s)'}`);
    check(`A1. outcome recorded: ${label}`, outcome === 'pending' || outcome === 'immediate_not_allowed', JSON.stringify(real));
    if (outcome === 'pending') {
      await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Waiting for permission', null, { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 1500));
      check('A1 (pending). an unanswered prompt keeps saying "Waiting for permission" (never open or measuring)', (await page.textContent('#mic-badge')) === 'Waiting for permission' && !mock.of('mic.state').some((m) => ['open_idle', 'measuring'].includes(m.payload.state)));
      check('A1 (pending). Cancel is offered and Start is hidden while waiting', (await page.locator('#cancel-mic').isVisible()) && (await page.locator('#start-mic').isHidden()));
      await page.click('#cancel-mic');
      await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic off', null, { timeout: 5000 });
      check('A1 (pending). Cancel returns to "Mic off" and the TV is told off', (await waitFor(() => mock.of('mic.state').at(-1)?.payload.state === 'off', { label: 'mic.state off after cancel' })) === true);
    } else if (outcome === 'immediate_not_allowed') {
      await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Permission denied', null, { timeout: 5000 });
      const help = await page.textContent('#mic-help');
      check('A1 (denied). the page shows "Permission denied" with re-enable guidance (site settings, set Microphone to Allow)', /site settings/.test(help) && /Allow/.test(help), help);
      await waitFor(() => mock.of('mic.state').some((m) => m.payload.state === 'permission_denied'), { label: 'mic.state permission_denied' });
      check('A1 (denied). the TV is told permission_denied and never saw open_idle or measuring', !mock.of('mic.state').some((m) => ['open_idle', 'measuring'].includes(m.payload.state)));
      check('A1 (denied). Start microphone is offered again and Cancel is not shown', (await page.locator('#start-mic').isEnabled()) && (await page.locator('#start-mic').isVisible()) && (await page.locator('#cancel-mic').isHidden()));
      const realCallsBefore = (await page.evaluate(() => window.__realGum.length));
      await page.click('#start-mic'); // retrying asks the browser again and is denied again, still real
      await waitFor(async () => (await page.evaluate(() => window.__realGum.length)) > realCallsBefore, { label: 'a second real request' });
      await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Permission denied', null, { timeout: 5000 });
      check('A1 (denied). retrying asks the real browser again and shows the denial again', (await page.evaluate(() => window.__realGum.length)) === realCallsBefore + 1);
    } else {
      // Not a legitimate outcome for this check (for example a real microphone opened): release it and fail loudly.
      if (await page.locator('#stop-mic').isVisible()) await page.click('#stop-mic');
    }

    // A2 (STUBBED rejection, see initScript): every error class renders with its own wording.
    const classes = [
      ['NotAllowedError', 'Permission denied', /site settings/, 'permission_denied'],
      ['NotFoundError', 'No microphone found', /No microphone was found/, 'no_input'],
      ['NotReadableError', 'Microphone busy', /another app/i, 'input_busy'],
      ['OverconstrainedError', 'Settings not supported', /requested settings/, 'constraints_unsupported'],
    ];
    for (const [name, badgeText, helpRe, wireState] of classes) {
      const seenStates = () => mock.of('mic.state').filter((m) => m.payload.state === wireState).length;
      const before = seenStates();
      await page.evaluate((n) => { window.__gumFail = n; }, name);
      await page.click('#start-mic');
      await waitFor(() => seenStates() > before, { label: `a new mic.state ${wireState}` }); // new, not left over from A1
      await page.waitForFunction((b) => document.getElementById('mic-badge').textContent === b, badgeText, { timeout: 10_000 });
      const help = await page.textContent('#mic-help');
      check(`A2 (stubbed ${name}): badge "${badgeText}" with guidance`, helpRe.test(help), help);
      check(`A2 (stubbed ${name}): Start microphone is offered again`, await page.locator('#start-mic').isEnabled());
    }
    check('A2: the TV never saw open_idle or measuring in any failed attempt', !mock.of('mic.state').some((m) => ['open_idle', 'measuring'].includes(m.payload.state)));
    const gum = await page.evaluate(() => window.__gumCalls);
    console.log(`      getUserMedia constraints requested: ${gum?.at(-1)}`);
    check('A2: getUserMedia was asked for AGC, echo cancellation and noise suppression off', /"autoGainControl":false/.test(gum?.at(-1) ?? '') && /"echoCancellation":false/.test(gum?.at(-1) ?? '') && /"noiseSuppression":false/.test(gum?.at(-1) ?? ''));
    await page.evaluate(() => { window.__gumFail = null; });
    check('A. no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));
    check('A. every message sent passed parseWireMessage', mock.state.invalid.length === 0, mock.state.invalid.join(' | '));
  }

  // ---------------- B: production capture path with a stubbed getUserMedia -------------------------
  fake = await launchChrome();
  console.log(`Chrome ${fake.version()} (getUserMedia stubbed with an oscillator stream)`);
  {
    const context = await fake.newContext();
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console.error: ${m.text()}`);
    });
    await page.addInitScript(initScript, { simulate: SIMULATE });
    const mock = await mockRelay(page);
    await page.goto(`${site.origin}/#code=ACDEFH`);
    await pair(page, mock);
    await page.evaluate(() => { window.__gumSynthetic = true; });
    await page.click('#start-mic');
    await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic open, not measuring', null, { timeout: 10_000 });
    await waitFor(() => mock.of('mic.state').some((m) => m.payload.state === 'open_idle'), { label: 'mic.state open_idle' });
    const open = mock.of('mic.state').find((m) => m.payload.state === 'open_idle').payload;
    console.log(`      read-back of the stubbed stream: settings ${JSON.stringify(open.settings)}; supported ${JSON.stringify(open.supported)}; mode ${open.mode}`);
    check('B. production page reaches open_idle through the real capture adapter; mode is same_host (127.0.0.1)', open.mode === 'same_host' && 'sample_rate' in open.settings, `mode ${open.mode}`);
    check('B. the page text states reported settings, not "unprocessed"', /Browser reports gain control: (on|off|unknown)/.test(await page.textContent('#mic-settings')));

    mock.tv('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: SESSION });
    const w = ids.window();
    const a = ids.attempt();
    mock.tv('precheck.start', { purpose: 'pre_window', duration_ms: 2000 }, { session_id: SESSION, window_id: w, attempt_id: a });
    await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Measuring', null, { timeout: 5000 });
    await waitFor(() => mock.of('precheck.result').length > 0, { timeout: 10_000, label: 'precheck.result' });
    const pre = mock.last('precheck.result');
    console.log(`      precheck on the -30 dBFS tone: ${JSON.stringify(pre.payload)}`);
    check('B. precheck over the real worklet returned 40 frames for 2000 ms, bound to the ids', pre.payload.expected_frames === 40 && pre.payload.frame_count === 40 && pre.window_id === w);
    check('B. precheck floor is about -30 dBFS (expected from the sine amplitude, tolerance 1 dB) and valid', pre.payload.valid === true && Math.abs(pre.payload.floor_dbfs + 30) <= 1, String(pre.payload.floor_dbfs));
    check('B. no level frames during a precheck', mock.of('level').length === 0);
    check('B. worklet loaded under the strict production CSP (script-src self, no blob:)', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));

    const tracksLive = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
    mock.tv('session.end', { reason: 'completed' }, { session_id: SESSION });
    await waitFor(() => mock.of('mic.state').at(-1)?.payload.state === 'off', { label: 'mic.state off' });
    const tracksAfter = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
    const ctxAfter = await page.evaluate(() => window.__ctxs.map((c) => c.state));
    console.log(`      capture tracks before/after session.end: ${JSON.stringify(tracksLive)} -> ${JSON.stringify(tracksAfter)}; AudioContexts after: ${JSON.stringify(ctxAfter)}`);
    check('B. the capture track was live, then ended after session.end', tracksLive.length > 0 && tracksLive.every((s) => s === 'live') && tracksAfter.every((s) => s === 'ended'));
    check("B. the page's own AudioContext (the first created) was closed", ctxAfter[0] === 'closed', JSON.stringify(ctxAfter));
    check('B. every message the phone sent passed parseWireMessage', mock.state.invalid.length === 0, mock.state.invalid.join(' | '));
    check('B. no page or console errors', problems.length === 0, problems.join(' | '));
    check('B. no browser storage used', await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));
    await context.close();
  }
} catch (error) {
  check('production run completed', false, String(error?.stack ?? error));
} finally {
  await denied?.close();
  await fake?.close();
  await site.close();
}
if (checker.failed.length > 0) {
  console.error(`\n${checker.failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nproduction: all checks passed');

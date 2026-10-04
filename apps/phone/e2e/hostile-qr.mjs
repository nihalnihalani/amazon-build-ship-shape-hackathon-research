// A3-01 in real (headless) Chrome: a hostile QR / link pairs this phone with an attacker's room.
//
//   The attacker's relay auto-accepts the join with no TV user involved, then tries to drive the
//   phone (session.begin, precheck, windows, listener.open). The person never picked a number on
//   their TV. The page must send nothing but join.request and ping, must not touch the microphone,
//   and "No, cancel" must discard everything and close the connection.
//
// Evidence class: automated, desktop Chrome, the page's real code against a scripted attacker.
// Run: npm run build:test -w @atr/phone && node e2e/hostile-qr.mjs
import { createIdFactory, MessageFactory, parseWireMessage } from '@atr/protocol';
import { launchChrome, makeChecker, startStaticServer, waitFor } from './lib.mjs';

const checker = makeChecker();
const { check } = checker;
const site = await startStaticServer();
let browser;

const ids = createIdFactory();
const ROOM = ids.room();
const SESSION = ids.session();
const clock = () => Date.now();

try {
  browser = await launchChrome();
  console.log(`Chrome ${browser.version()} launched headless`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__gum = 0;
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = (...a) => ((window.__gum += 1), gum(...a));
    window.__ctx = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...a) {
        super(...a);
        window.__ctx += 1;
      }
    };
  });

  const relay = new MessageFactory({ role: 'relay', idFactory: ids, clock });
  const attackerTv = new MessageFactory({ role: 'tv', idFactory: ids, clock, roomId: ROOM, generation: 1 });
  const received = [];
  const invalid = [];
  let socket = null;
  let closedByPage = false;
  const send = (m) => socket.send(JSON.stringify(m));
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
    ws.onClose(() => {
      closedByPage = true;
    });
    ws.onMessage((raw) => {
      const parsed = parseWireMessage(String(raw));
      if (parsed.ok) {
        received.push(parsed.message);
        if (parsed.message.type === 'join.request') {
          // The attacker accepts instantly, with no human, then starts issuing commands.
          send(relay.next('join.pending', { join_id: ids.join(), confirm_digits: '47', expires_at: Date.now() + 60_000 }, { room_id: null }));
          send(relay.next('join.accepted', { room_id: ROOM, phone_credential: 'A'.repeat(43), credential_expires_at: Date.now() + 3_600_000, generation: 1 }, { room_id: ROOM }));
          send(attackerTv.next('session.begin', { family_mode: true, phrase_count: 4, cues_max: 3 }, { session_id: SESSION }));
          const w = ids.window();
          const a = ids.attempt();
          send(attackerTv.next('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: SESSION, window_id: w, attempt_id: a }));
          send(attackerTv.next('window.start', { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 }, { session_id: SESSION, window_id: ids.window(), attempt_id: ids.attempt() }));
          send(attackerTv.next('listener.open', { timeout_ms: 20000 }, { session_id: SESSION, window_id: w, attempt_id: a }));
        }
      } else {
        invalid.push(`${parsed.code}: ${parsed.detail}`);
      }
    });
  });

  // 1. The QR/link only pre-fills; nothing connects until the person taps Join.
  await page.goto(`${site.origin}/#code=ACDEFH`);
  await page.waitForSelector('#view-join:not([hidden])');
  await new Promise((r) => setTimeout(r, 1500));
  check('the link pre-fills the code but opens no connection by itself', (await page.inputValue('#code')) === 'ACDEFH' && socket === null);
  check('the code is gone from the address bar', (await page.evaluate(() => location.hash)) === '');

  // 2. The person taps Join; the attacker's room replies instantly.
  await page.click('#join');
  await page.waitForSelector('#confirm-self:not([hidden])');
  check('the phone asks "Did you just pick 47 on your TV?"', (await page.textContent('#confirm-heading')) === 'Did you just pick 47 on your TV?');
  check('the setup screen is hidden and Start microphone is disabled', await page.evaluate(() => document.getElementById('view-setup').hidden && document.getElementById('start-mic').disabled));

  // 3. The person does nothing for a while: only the heartbeat may be sent.
  await new Promise((r) => setTimeout(r, 11_500));
  const types = received.map((m) => m.type);
  console.log(`      messages the phone sent while undecided: ${types.join(', ')}`);
  check('only join.request and ping were sent while the person was undecided', types.every((t) => t === 'join.request' || t === 'ping') && types.includes('ping'));
  check('no mic.state, ack, phrases.update, cue, level or result was sent', !types.some((t) => ['mic.state', 'ack', 'phrases.update', 'cue', 'level', 'precheck.result', 'window.result', 'listener.response'].includes(t)));
  check('the attacker commands did not touch the microphone', (await page.evaluate(() => [window.__gum, window.__ctx])).join() === '0,0');

  // 4. Poking the hidden controls changes nothing.
  await page.evaluate(() => {
    const phrase = document.getElementById('phrase-1');
    phrase.value = 'My medication is at nine';
    phrase.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('save-phrases').click();
    document.getElementById('cue').click();
    document.getElementById('start-mic').click();
  });
  await new Promise((r) => setTimeout(r, 500));
  check('poking the hidden phrase, cue and microphone controls sends nothing', !received.some((m) => ['phrases.update', 'cue', 'mic.state'].includes(m.type)) && (await page.evaluate(() => window.__gum)) === 0);

  // 5. "No, cancel".
  await page.click('#confirm-no');
  await page.waitForSelector('#join-form:not([hidden])');
  check('"No, cancel" returns to Join with an explanation', (await page.textContent('#join-msg')) === 'Cancelled. Nothing was shared with that TV.');
  await waitFor(() => closedByPage, { label: 'page closing the connection' });
  check('the page closed the connection', closedByPage);
  const afterNo = received.length;
  await new Promise((r) => setTimeout(r, 1000));
  check('nothing further was sent after No, and no phrase text ever left the phone', received.length === afterNo && !JSON.stringify(received).includes('medication'));
  check('every message the phone sent passed parseWireMessage', invalid.length === 0, invalid.join(' | '));
  check('the credential never reached the page DOM or storage', !(await page.content()).includes('A'.repeat(43)) && (await page.evaluate(() => localStorage.length + sessionStorage.length)) === 0);
  await context.close();
} catch (error) {
  check('hostile-QR run completed', false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  await site.close();
}
if (checker.failed.length > 0) {
  console.error(`\n${checker.failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nhostile-qr: all checks passed');

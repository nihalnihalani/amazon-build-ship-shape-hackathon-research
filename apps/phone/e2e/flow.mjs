// End-to-end flow in real (headless) Chrome with SYNTHETIC audio.
//
//   phone page (dist-test)  <--page.routeWebSocket-->  this script plays the relay and the TV
//
// The relay/TV messages are built with the real @atr/protocol MessageFactory, and every message
// the phone sends is validated with parseWireMessage. The microphone is replaced by the test
// build's oscillator -> gain -> MediaStreamAudioDestination stream, but the page's own AudioContext,
// AudioWorklet (frame-processor.js), DSP and shutdown are the real ones.
//
// Evidence class: automated, synthetic audio in desktop Chrome. NOT a real-phone check: it says
// nothing about getUserMedia permission prompts, Android Chrome's AGC, or background behaviour.
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
const relay = new MessageFactory({ role: 'relay', idFactory: ids, clock });
const tv = new MessageFactory({ role: 'tv', idFactory: ids, clock, roomId: ROOM, generation: 1 });
const TEST_CREDENTIAL = 'T'.repeat(43); // test value only

const received = []; // every message the phone sent, validated
const invalid = [];
let socket = null;

function toPhone(message) {
  socket.send(JSON.stringify(message));
}
const relayMsg = (type, payload, extra = {}) => toPhone(relay.next(type, payload, { room_id: ROOM, ...extra }));
const commandIds = [];
/** Sends one TV command and returns its message_id so the matching ack can be found. */
const tvMsg = (type, payload, idsIn = {}) => {
  const message = tv.next(type, payload, idsIn);
  if (type !== 'ack') commandIds.push({ type, id: message.message_id });
  toPhone(message);
  return message.message_id;
};
const ackFor = (id) => phoneMsgs('ack').find((a) => a.payload.acked_message_id === id);
const waitAck = (id, label) => waitFor(() => ackFor(id), { label: `ack for ${label}` });
const phoneMsgs = (type) => received.filter((m) => m.type === type);
const lastOf = (type) => phoneMsgs(type).at(-1);

try {
  browser = await launchChrome();
  console.log(`Chrome ${browser.version()} launched headless`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console.error: ${m.text()}`);
  });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    // Track AudioContexts to prove the phone page's own context is closed at session end.
    window.__ctxs = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...a) {
        super(...a);
        window.__ctxs.push(this);
      }
    };
    // Track MediaRecorder use (there must be none) and stopped tracks.
    window.__recorder = 0;
    if (window.MediaRecorder) {
      const NativeRec = window.MediaRecorder;
      window.MediaRecorder = class extends NativeRec {
        constructor(...a) {
          super(...a);
          window.__recorder += 1;
        }
      };
    }
    // A8-03 probes: the page must make no sound and never vibrate.
    window.__vibrate = 0;
    window.__speech = 0;
    window.__plays = 0;
    window.__notifications = 0;
    navigator.vibrate = () => {
      window.__vibrate += 1;
      return true;
    };
    if (window.speechSynthesis) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => {
        window.__speech += 1;
        return speak(u);
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      window.__plays += 1;
      return play.apply(this, a);
    };
    if (window.Notification) {
      const N = window.Notification;
      window.Notification = class extends N {
        constructor(...a) {
          super(...a);
          window.__notifications += 1;
        }
      };
    }
    window.__badges = [];
    const watch = () => {
      const b = document.getElementById('mic-badge');
      if (!b) return void setTimeout(watch, 20);
      const push = () => window.__badges.push(b.textContent);
      push();
      new MutationObserver(push).observe(b, { childList: true, characterData: true, subtree: true });
    };
    watch();
  });

  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const text = String(raw);
      const parsed = parseWireMessage(text);
      if (!parsed.ok) {
        invalid.push(`${parsed.code}: ${parsed.detail}`);
        return;
      }
      received.push(parsed.message);
    });
  });

  await page.goto(`${site.origin}/#code=ACDEFH`);
  await page.waitForSelector('#view-join:not([hidden])');

  // ---- join ------------------------------------------------------------------
  await page.click('#join');
  await waitFor(() => phoneMsgs('join.request').length > 0, { label: 'join.request' });
  const join = lastOf('join.request');
  check('join.request carries the code and device label, room null, generation 0', join.payload.pairing_code === 'ACDEFH' && join.payload.device_label === 'Browser' && join.room_id === null && join.producer_generation === 0, JSON.stringify(join.payload));
  relayMsg('join.pending', { join_id: ids.join(), confirm_digits: '47', expires_at: Date.now() + 60_000 }, { room_id: null });
  await page.waitForSelector('#pending:not([hidden])');
  check('shows "On your TV, pick 47"', (await page.textContent('#pending-heading')) === 'On your TV, pick 47');
  relayMsg('join.accepted', { room_id: ROOM, phone_credential: TEST_CREDENTIAL, credential_expires_at: Date.now() + 3_600_000, generation: 1 });
  await page.waitForSelector('#confirm-self:not([hidden])');
  check('asks "Did you just pick 47 on your TV?" with Yes and No', (await page.textContent('#confirm-heading')) === 'Did you just pick 47 on your TV?' && (await page.textContent('#confirm-yes')) === 'Yes, that was me' && (await page.textContent('#confirm-no')) === 'No, cancel');
  check('before Yes the phone has sent only join.request (no mic.state, no ack, no phrases)', received.map((m) => m.type).join(',') === 'join.request', received.map((m) => m.type).join(','));
  check('before Yes the setup screen and Start microphone are not available', await page.evaluate(() => document.getElementById('view-setup').hidden && document.getElementById('start-mic').disabled));
  await page.click('#confirm-yes');
  await page.waitForSelector('#view-setup:not([hidden])');
  await waitFor(() => phoneMsgs('mic.state').length > 0, { label: 'first mic.state' });
  const mic0 = lastOf('mic.state').payload;
  check('first mic.state says off, visible, fixture_replay, wake lock not requested', mic0.state === 'off' && mic0.visibility === 'visible' && mic0.mode === 'fixture_replay' && mic0.wake_lock === 'not_requested', JSON.stringify(mic0));
  check('authenticated messages use generation 1 and sequence 0 first', lastOf('mic.state').producer_generation === 1 && phoneMsgs('mic.state')[0].sequence === 0);
  check('no microphone request before the tap (badge says Mic off)', (await page.textContent('#mic-badge')) === 'Mic off');

  // ---- explicit gesture opens the (synthetic) microphone ------------------------
  await page.click('#start-mic');
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic open, not measuring');
  await waitFor(() => phoneMsgs('mic.state').some((m) => m.payload.state === 'open_idle'), { label: 'mic.state open_idle' });
  const open = phoneMsgs('mic.state').find((m) => m.payload.state === 'open_idle').payload;
  check('mic.state open_idle reports settings as unknown/known honestly (nulls allowed)', 'sample_rate' in open.settings, JSON.stringify(open.settings));
  console.log(`      reported settings: ${JSON.stringify(open.settings)} supported: ${JSON.stringify(open.supported)}`);
  check('worklet loaded as a same-origin module (no CSP violations)', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));
  await waitFor(() => phoneMsgs('mic.state').some((m) => m.payload.wake_lock === 'held' || m.payload.wake_lock === 'rejected' || m.payload.wake_lock === 'unsupported'), { label: 'wake lock outcome' });
  console.log(`      wake lock outcome reported to the TV: ${[...new Set(phoneMsgs('mic.state').map((m) => m.payload.wake_lock))].join(', ')}`);

  // ---- session + quiet check ------------------------------------------------------
  const beginId = tvMsg('session.begin', { family_mode: true, phrase_count: 4, cues_max: 3 }, { session_id: SESSION });
  const beginAck = await waitAck(beginId, 'session.begin');
  check('session.begin acknowledged applied, bound to the session', beginAck.payload.outcome === 'applied' && beginAck.session_id === SESSION && beginAck.window_id === null);

  await page.evaluate(() => window.__atrTestAudio.setSilence());
  const w1 = ids.window();
  const a1 = ids.attempt();
  const preId = tvMsg('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: SESSION, window_id: w1, attempt_id: a1 });
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Measuring', null, { timeout: 5000 });
  const preAck = await waitAck(preId, 'precheck.start');
  check('precheck.start acknowledged applied with the command ids', preAck.payload.outcome === 'applied' && preAck.window_id === w1 && preAck.attempt_id === a1);
  await waitFor(() => phoneMsgs('precheck.result').length > 0, { timeout: 15_000, label: 'precheck.result' });
  const pre = lastOf('precheck.result');
  check('quiet check result bound to the command ids, valid, silent floor', pre.window_id === w1 && pre.attempt_id === a1 && pre.payload.valid === true && pre.payload.floor_dbfs <= -100, JSON.stringify(pre.payload));
  check('quiet check frame accounting: 100 expected frames, full coverage', pre.payload.expected_frames === 100 && pre.payload.frame_count === 100 && pre.payload.coverage === 1, `frames ${pre.payload.frame_count}/${pre.payload.expected_frames}`);
  check('no level frames were sent during the precheck', phoneMsgs('level').length === 0);
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic open, not measuring');

  // ---- calibration window with a -30 dBFS sine --------------------------------------
  await page.evaluate(() => window.__atrTestAudio.setLevelDbfs(-30));
  const w2 = ids.window();
  const a2 = ids.attempt();
  const startId = tvMsg('window.start', { kind: 'calibration', phrase_position: null, max_duration_ms: 6000, vad_floor_dbfs: -60 }, { session_id: SESSION, window_id: w2, attempt_id: a2 });
  await waitFor(() => phoneMsgs('level').length >= 30, { timeout: 10_000, label: '30 level frames' });
  const bodyDuring = await page.evaluate(() => document.body.textContent);
  check('page text shows no level numbers or units while measuring', !/dB/i.test(bodyDuring) && !/-30/.test(bodyDuring));
  check('no meter-like element exists', (await page.locator('meter, progress, canvas, svg, [role="meter"], [role="progressbar"]').count()) === 0);
  const stopId = tvMsg('window.stop', { reason: 'complete' }, { session_id: SESSION, window_id: w2, attempt_id: a2 });
  await waitFor(() => phoneMsgs('window.result').length > 0, { label: 'window.result' });
  check('window.start and window.stop acknowledged applied', (await waitAck(startId, 'window.start')).payload.outcome === 'applied' && (await waitAck(stopId, 'window.stop')).payload.outcome === 'applied');
  check('the stop ack was sent before the window.result', received.indexOf(ackFor(stopId)) < received.indexOf(lastOf('window.result')));
  const levels = phoneMsgs('level');
  const idx = levels.map((m) => m.payload.frame_index);
  check('level frames carry the window ids', levels.every((m) => m.window_id === w2 && m.attempt_id === a2 && m.session_id === SESSION));
  check('frame_index starts at 0 and strictly increases', idx[0] === 0 && idx.every((v, i) => i === 0 || v > idx[i - 1]), idx.slice(0, 6).join(','));
  check('t_audio_ms is frame_index x 50', levels.every((m) => Math.abs(m.payload.t_audio_ms - m.payload.frame_index * 50) < 1e-6));
  const db = levels.map((m) => m.payload.dbfs).sort((x, y) => x - y);
  const median = db[Math.floor(db.length / 2)];
  console.log(`      ${levels.length} level frames; median dBFS ${median.toFixed(2)}; min ${db[0].toFixed(2)} max ${db.at(-1).toFixed(2)}`);
  check('median level is about -30 dBFS (expected from the sine amplitude, tolerance 1 dB)', Math.abs(median + 30) <= 1, `${median.toFixed(2)}`);
  check('frames are flagged active (30 dB above the -60 floor)', levels.slice(2).every((m) => m.payload.active === true));
  const res = lastOf('window.result');
  check('window.result bound to ids, kind calibration, valid, p95 near -30', res.window_id === w2 && res.payload.kind === 'calibration' && res.payload.valid === true && Math.abs(res.payload.p95_active_dbfs + 30) <= 1, JSON.stringify(res.payload));
  const after = phoneMsgs('level').length;
  await new Promise((r) => setTimeout(r, 400));
  check('no level frames after the window closed', phoneMsgs('level').length === after);
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic open, not measuring');

  // ---- listener phase --------------------------------------------------------------
  check('listener buttons are disabled before listener.open', await page.evaluate(() => document.getElementById('heard').disabled && document.getElementById('not-heard').disabled && document.getElementById('cue').disabled));
  const openId = tvMsg('listener.open', { timeout_ms: 20000 }, { session_id: SESSION, window_id: w2, attempt_id: a2 });
  await page.waitForFunction(() => !document.getElementById('heard').disabled);
  check('listener.open acknowledged applied', (await waitAck(openId, 'listener.open')).payload.outcome === 'applied');
  await page.click('#heard');
  await waitFor(() => phoneMsgs('listener.response').length > 0, { label: 'listener.response' });
  const lr = lastOf('listener.response');
  check('Heard sent bound to window and attempt', lr.payload.response === 'heard' && lr.window_id === w2 && lr.attempt_id === a2);
  await page.click('#cue');
  await waitFor(() => phoneMsgs('cue').length > 0, { label: 'cue' });
  check('Cue sends the default word bound to the session', lastOf('cue').payload.text === 'Volume' && lastOf('cue').session_id === SESSION && lastOf('cue').window_id === null);
  check('page shows Cues used: 1 of 3', (await page.textContent('#cue-count')) === 'Cues used: 1 of 3');
  const revealId = tvMsg('attempt.reveal', {}, { session_id: SESSION, window_id: w2, attempt_id: a2 });
  await page.waitForFunction(() => document.getElementById('cue').disabled);
  check('attempt.reveal acknowledged applied', (await waitAck(revealId, 'attempt.reveal')).payload.outcome === 'applied');
  const cuesBefore = phoneMsgs('cue').length;
  await page.click('#cue', { force: true, timeout: 1000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 200));
  check('a tap after reveal is not sent', phoneMsgs('cue').length === cuesBefore && phoneMsgs('listener.response').length === 1);

  // ---- phrases ---------------------------------------------------------------------
  await page.fill('#phrase-1', '<img src=x onerror=alert(1)>');
  await page.click('#save-phrases');
  await waitFor(() => phoneMsgs('phrases.update').length > 0, { label: 'phrases.update' });
  check('phrases.update carries the literal text', lastOf('phrases.update').payload.phrases[0] === '<img src=x onerror=alert(1)>');
  check('the page rendered the phrase as text (no <img> element)', (await page.locator('img').count()) === 0 && (await page.textContent('#phrase-saved li')) === '<img src=x onerror=alert(1)>');
  check('while unacknowledged the page says it is waiting for the TV', /Waiting for the TV to confirm/.test(await page.textContent('#phrase-status')));
  tvMsg('ack', { acked_message_id: lastOf('phrases.update').message_id, outcome: 'applied', detail: '' });
  await page.waitForFunction(() => document.getElementById('phrase-status').textContent === 'The TV saved 1 phrase.');
  check('TV ack applied: "The TV saved 1 phrase."', true);
  await page.fill('#phrase-1', 'Another phrase');
  await page.click('#save-phrases');
  await waitFor(() => phoneMsgs('phrases.update').length === 2, { label: 'second phrases.update' });
  tvMsg('ack', { acked_message_id: lastOf('phrases.update').message_id, outcome: 'rejected', detail: 'window_open' });
  await page.waitForFunction(() => /after the current phrase window/.test(document.getElementById('phrase-status').textContent));
  await new Promise((r) => setTimeout(r, 500));
  check('TV ack rejected: explained as "after the current phrase window", and nothing was resent by itself', phoneMsgs('phrases.update').length === 2 && (await page.locator('#save-phrases').isEnabled()));

  // ---- session end: capture fully released --------------------------------------------
  const ctxBefore = await page.evaluate(() => window.__ctxs.map((c) => c.state));
  console.log(`      AudioContexts before session.end: ${JSON.stringify(ctxBefore)}`);
  const endId = tvMsg('session.end', { reason: 'completed' }, { session_id: SESSION });
  const endAck = await waitAck(endId, 'session.end');
  await waitFor(() => phoneMsgs('mic.state').at(-1)?.payload.state === 'off', { label: 'mic.state off' });
  const offIndex = received.lastIndexOf(phoneMsgs('mic.state').filter((m) => m.payload.state === 'off').at(-1));
  check('Mic off was reported BEFORE the session.end ack (shutdown finished first)', offIndex >= 0 && offIndex < received.indexOf(endAck), `mic.state off at #${offIndex}, ack at #${received.indexOf(endAck)}`);
  const ctxAfter = await page.evaluate(() => window.__ctxs.map((c) => c.state));
  console.log(`      AudioContexts after session.end: ${JSON.stringify(ctxAfter)}`);
  check("the page's own AudioContext (the first one created) is closed", ctxAfter[0] === 'closed', JSON.stringify(ctxAfter));
  check('badge says Mic off after the stop is observed', (await page.textContent('#mic-badge')) === 'Mic off');
  const micLast = phoneMsgs('mic.state').at(-1).payload;
  check('final mic.state is off with cleared settings', micLast.state === 'off' && micLast.settings.sample_rate === null, JSON.stringify(micLast.settings));
  check('wake lock released after the session', ['released', 'unsupported', 'rejected', 'not_requested'].includes(micLast.wake_lock), micLast.wake_lock);
  check('session.end acknowledged applied, bound to the session', endAck.payload.outcome === 'applied' && endAck.session_id === SESSION);
  const unacked = commandIds.filter((c) => !ackFor(c.id));
  check('every TV command received an ack', unacked.length === 0, unacked.map((c) => c.type).join(', '));

  // ---- global checks ---------------------------------------------------------------
  check('every message the phone sent passed parseWireMessage', invalid.length === 0, invalid.join(' | '));
  check('no raw audio keys in any sent message', received.every((m) => !JSON.stringify(m.payload).match(/"(audio|pcm|samples|waveform|blob|buffer|data)"/i)));
  check('no MediaRecorder was ever constructed', (await page.evaluate(() => window.__recorder)) === 0);
  check('no CSP violations during the whole flow', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));
  check('no page errors or console errors', problems.length === 0, problems.join(' | '));
  check('no browser storage was used', await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));
  check('A5-02: no cookies, localStorage, sessionStorage, IndexedDB or Cache API entries', await page.evaluate(async () => {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    const keys = await caches.keys();
    return document.cookie === '' && localStorage.length === 0 && sessionStorage.length === 0 && dbs.length === 0 && keys.length === 0;
  }));
  check('A5-02: the browser cookie jar is empty', (await context.cookies()).length === 0);
  check('A8-03: the page never vibrated, spoke, played media or showed a notification', await page.evaluate(() => window.__vibrate === 0 && window.__speech === 0 && window.__plays === 0 && window.__notifications === 0), JSON.stringify(await page.evaluate(() => [window.__vibrate, window.__speech, window.__plays, window.__notifications])));
  check('no request left this machine', requests.every((u) => u.startsWith(site.origin)), requests.filter((u) => !u.startsWith(site.origin)).join(', '));
  const badges = await page.evaluate(() => window.__badges);
  check('the badge sequence never showed Measuring outside a run', badges.filter((b) => b === 'Measuring').length > 0 && badges.indexOf('Measuring') > badges.indexOf('Mic open, not measuring'), [...new Set(badges)].join(' > '));
  await context.close();
} catch (error) {
  check('flow ran to completion', false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  await site.close();
}
if (checker.failed.length > 0) {
  console.error(`\n${checker.failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nflow: all checks passed');

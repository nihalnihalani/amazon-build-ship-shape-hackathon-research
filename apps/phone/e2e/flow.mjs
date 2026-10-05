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

  // DEF-003: the TV announces its session right after accepting the join, while the question is on screen.
  const earlyBegin = tvMsg('session.begin', { family_mode: true, phrase_count: 4, cues_max: 3 }, { session_id: SESSION });
  const earlyState = tvMsg('session.state', { stage: 'permission_pending', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { session_id: SESSION });
  const droppedWindow = ids.window();
  const droppedAttempt = ids.attempt();
  const droppedPrecheck = tvMsg('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: SESSION, window_id: droppedWindow, attempt_id: droppedAttempt });
  commandIds.splice(commandIds.findIndex((c) => c.id === droppedPrecheck), 1); // dropped on purpose: it must NOT be acked
  await new Promise((r) => setTimeout(r, 600));
  check('DEF-003: session.begin / session.state / precheck.start before Yes are not acknowledged and nothing else is sent', received.map((m) => m.type).join(',') === 'join.request', received.map((m) => m.type).join(','));
  check('DEF-003: held messages change nothing on the page (still the question, Start disabled)', await page.evaluate(() => !document.getElementById('confirm-self').hidden && document.getElementById('view-setup').hidden && document.getElementById('start-mic').disabled));
  await page.click('#confirm-yes');
  await page.waitForSelector('#view-setup:not([hidden])');
  const earlyBeginAck = await waitAck(earlyBegin, 'the early session.begin');
  const earlyStateAck = await waitAck(earlyState, 'the early session.state');
  const orderOf = (m) => received.findIndex((x) => x.message_id === m.message_id);
  const firstMic = received.findIndex((x) => x.type === 'mic.state');
  check('DEF-003: after Yes the first message is mic.state, then the held begin is acked applied, then the held state', firstMic === 1 && orderOf(earlyBeginAck) > firstMic && orderOf(earlyStateAck) > orderOf(earlyBeginAck), received.slice(0, 5).map((m) => m.type).join(','));
  check('DEF-003: both acks say applied and carry the session id', earlyBeginAck.payload.outcome === 'applied' && earlyStateAck.payload.outcome === 'applied' && earlyBeginAck.session_id === SESSION && earlyStateAck.session_id === SESSION);
  check('DEF-003: the page shows the TV step from the held session.state', /TV step: Setting up\./.test(await page.textContent('#session')), await page.textContent('#session'));
  await new Promise((r) => setTimeout(r, 300));
  check('DEF-003: the measurement command received before Yes was dropped for good (never acked, never run)', !ackFor(droppedPrecheck) && phoneMsgs('precheck.result').length === 0);
  await waitFor(() => phoneMsgs('mic.state').length > 0, { label: 'first mic.state' });
  const mic0 = phoneMsgs('mic.state')[0].payload;
  check('the first mic.state (sent right after Yes) says off, visible, fixture_replay, wake lock not requested', mic0.state === 'off' && mic0.visibility === 'visible' && mic0.mode === 'fixture_replay' && mic0.wake_lock === 'not_requested', JSON.stringify(mic0));
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
  check('a repeated session.begin (the TV resends it defensively) is acked applied, bound to the session', beginAck.payload.outcome === 'applied' && beginAck.session_id === SESSION && beginAck.window_id === null);
  check('the repeat did not reset progress: the TV step from the earlier session.state is still shown', /TV step: Setting up\./.test(await page.textContent('#session')), await page.textContent('#session'));

  // A silent input (digital silence) must be reported as silent_input and shown as "muted or blocked".
  await page.evaluate(() => window.__atrTestAudio.setSilence());
  const w0 = ids.window();
  const a0 = ids.attempt();
  tvMsg('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: SESSION, window_id: w0, attempt_id: a0 });
  await waitFor(() => phoneMsgs('precheck.result').length > 0, { timeout: 15_000, label: 'silent precheck.result' });
  const silent = lastOf('precheck.result');
  check('a silent input is reported as silent_input (floor below -110 dBFS)', silent.window_id === w0 && silent.payload.valid === false && silent.payload.invalid_reason === 'silent_input' && silent.payload.floor_dbfs <= -110, JSON.stringify(silent.payload));
  await page.waitForFunction(() => !document.getElementById('mic-notice').hidden);
  check('the phone says "The microphone looks muted or blocked"', /The microphone looks muted or blocked/.test(await page.textContent('#mic-notice')));

  // A real quiet room: a steady -60 dBFS sine gives a valid quiet check and clears the notice.
  await page.evaluate(() => window.__atrTestAudio.setLevelDbfs(-60));
  const w1 = ids.window();
  const a1 = ids.attempt();
  const preId = tvMsg('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: SESSION, window_id: w1, attempt_id: a1 });
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Measuring', null, { timeout: 5000 });
  const preAck = await waitAck(preId, 'precheck.start');
  check('precheck.start acknowledged applied with the command ids', preAck.payload.outcome === 'applied' && preAck.window_id === w1 && preAck.attempt_id === a1);
  await waitFor(() => phoneMsgs('precheck.result').length > 1, { timeout: 15_000, label: 'precheck.result' });
  const pre = lastOf('precheck.result');
  check('quiet check result bound to the command ids, valid, floor about -60 dBFS (expected from the sine amplitude, tolerance 1 dB)', pre.window_id === w1 && pre.attempt_id === a1 && pre.payload.valid === true && Math.abs(pre.payload.floor_dbfs + 60) <= 1, JSON.stringify(pre.payload));
  check('quiet check frame accounting: 100 expected frames, full coverage', pre.payload.expected_frames === 100 && pre.payload.frame_count === 100 && pre.payload.coverage === 1, `frames ${pre.payload.frame_count}/${pre.payload.expected_frames}`);
  check('no level frames were sent during the prechecks', phoneMsgs('level').length === 0);
  check('the notice is gone after a good quiet check', await page.evaluate(() => document.getElementById('mic-notice').hidden));
  check('every dB value on the wire is on the 0.1 dB grid (revision 4)', [pre.payload.floor_dbfs, pre.payload.p20_dbfs, pre.payload.p80_dbfs, pre.payload.p95_dbfs].every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6));
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

  // ---- DEF-004: the TV's link drops mid-window and the TV reconnects ----------------------------
  await new Promise((r) => setTimeout(r, 1100)); // the phone enforces at least 1 s between windows (N-12)
  const w4 = ids.window();
  const a4 = ids.attempt();
  tvMsg('window.start', { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 }, { session_id: SESSION, window_id: w4, attempt_id: a4 });
  await waitFor(() => phoneMsgs('level').filter((m) => m.window_id === w4).length >= 5, { timeout: 10_000, label: 'levels for the DEF-004 window' });
  relayMsg('peer.state', { role: 'tv', connected: false, generation: 1 }); // the relay: the TV is gone
  await page.waitForFunction(() => document.getElementById('mic-badge').textContent === 'Mic open, not measuring');
  await waitFor(() => phoneMsgs('mic.state').at(-1)?.payload.state === 'open_idle', { label: 'mic.state open_idle after the interruption' });
  await new Promise((r) => setTimeout(r, 600));
  const micBefore = phoneMsgs('mic.state').length;
  const levelsDuringOutage = phoneMsgs('level').filter((m) => m.window_id === w4).length;
  await new Promise((r) => setTimeout(r, 400));
  check('DEF-004: while the TV is away the interrupted window sends no more levels and holds its result', phoneMsgs('level').filter((m) => m.window_id === w4).length === levelsDuringOutage && !phoneMsgs('window.result').some((m) => m.window_id === w4));
  check('DEF-004: nothing spontaneous: no new mic.state while the TV is away and nothing changed', phoneMsgs('mic.state').length === micBefore);
  const lastKnown = phoneMsgs('mic.state').at(-1);
  relayMsg('peer.state', { role: 'tv', connected: true, generation: 2 }); // the TV is back with a new generation
  await waitFor(() => phoneMsgs('mic.state').length > micBefore, { timeout: 5000, label: 'mic.state re-report after the TV reconnected' });
  await waitFor(() => phoneMsgs('window.result').some((m) => m.window_id === w4), { timeout: 5000, label: 'held window.result' });
  const reReport = phoneMsgs('mic.state')[micBefore];
  const heldResult = phoneMsgs('window.result').find((m) => m.window_id === w4);
  check('DEF-004: the phone re-reported its mic.state when the TV reconnected (nothing had changed)', reReport.payload.state === 'open_idle' && JSON.stringify(reReport.payload) === JSON.stringify(lastKnown.payload), JSON.stringify(reReport.payload.state));
  check('DEF-004: the re-report carries the session id', reReport.session_id === SESSION);
  check('DEF-004: mic.state came BEFORE the held interrupted window.result, which is bound to the window ids', received.indexOf(reReport) < received.indexOf(heldResult) && heldResult.payload.valid === false && heldResult.payload.invalid_reason === 'interrupted' && heldResult.attempt_id === a4);
  const micAfterFirst = phoneMsgs('mic.state').length;
  relayMsg('peer.state', { role: 'tv', connected: true, generation: 3 }); // another notice straight away
  await new Promise((r) => setTimeout(r, 300));
  check('DEF-004: a second notice within a second is not answered at once (at most one per second)', phoneMsgs('mic.state').length === micAfterFirst);
  await waitFor(() => phoneMsgs('mic.state').length === micAfterFirst + 1, { timeout: 3000, label: 'trailing re-report' });
  await new Promise((r) => setTimeout(r, 1300));
  check('DEF-004: exactly one trailing report followed, then quiet', phoneMsgs('mic.state').length === micAfterFirst + 1);
  check('DEF-004: the TV-reconnect reports stayed on the wire grid and passed the validator', invalid.length === 0, invalid.join(' | '));

  // ---- N-12: at least 1 s between windows --------------------------------------------------------
  const phraseWindow = { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 };
  await new Promise((r) => setTimeout(r, 1100)); // let the previous (interrupted) window's cooldown pass
  const cdA = { session_id: SESSION, window_id: ids.window(), attempt_id: ids.attempt() };
  const cdAStart = tvMsg('window.start', phraseWindow, cdA);
  check('N-12: the first window of the chain is applied', (await waitAck(cdAStart, 'cooldown window A')).payload.outcome === 'applied');
  await new Promise((r) => setTimeout(r, 250));
  tvMsg('window.cancel', { reason: 'user_cancel' }, cdA);
  await new Promise((r) => setTimeout(r, 250)); // a hostile TV chaining windows: cancel, then start again right away
  const cdB = { session_id: SESSION, window_id: ids.window(), attempt_id: ids.attempt() };
  const cdBStart = tvMsg('window.start', phraseWindow, cdB);
  const cdBAck = await waitAck(cdBStart, 'cooldown window B');
  check('N-12: a window started 0.25 s after the previous one ended is refused with detail "cooldown"', cdBAck.payload.outcome === 'rejected' && cdBAck.payload.detail === 'cooldown', JSON.stringify(cdBAck.payload));
  check('N-12: the refused window sent no level frames and the microphone stayed idle', !phoneMsgs('level').some((m) => m.window_id === cdB.window_id) && (await page.textContent('#mic-badge')) === 'Mic open, not measuring');
  await new Promise((r) => setTimeout(r, 1000));
  const cdBRetry = tvMsg('window.start', phraseWindow, cdB); // the same ids again, a second later
  check('N-12: a second later the same window is applied (the refusal did not burn its ids)', (await waitAck(cdBRetry, 'cooldown window B again')).payload.outcome === 'applied');
  tvMsg('window.cancel', { reason: 'user_cancel' }, cdB);
  await new Promise((r) => setTimeout(r, 400));

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

  // ---- reconnect: jittered backoff and credential rotation (A6-02, A3-07) ----------------------
  const resumes = () => phoneMsgs('auth.resume');
  const N1 = 'n'.repeat(42) + '1';
  const N2 = 'n'.repeat(42) + '2';
  const lostAt = Date.now();
  await socket.close({ code: 1011, reason: 'test: relay restart' });
  await waitFor(() => resumes().length >= 1, { timeout: 8000, label: 'first auth.resume' });
  const firstDelay = Date.now() - lostAt;
  check('the page reconnected by itself after the relay dropped it (jittered backoff, about 0.4 to 0.7 s)', firstDelay >= 300 && firstDelay <= 1500, `${firstDelay} ms`);
  check('the first resume presents the credential from join.accepted, with room null / generation 0 / sequence 0', resumes()[0].payload.credential === TEST_CREDENTIAL && resumes()[0].room_id === null && resumes()[0].producer_generation === 0 && resumes()[0].sequence === 0);
  relayMsg('auth.ok', { role: 'phone', generation: 2, peer_connected: true, phone_paired: true, next_credential: N1 });
  await waitFor(() => lastOf('mic.state')?.producer_generation === 2, { label: 'mic.state on generation 2' });
  check('after auth.ok the phone is on generation 2, sequence restarted at 0, and mic.state is sent again', lastOf('mic.state').producer_generation === 2 && lastOf('mic.state').sequence === 0);
  await socket.close({ code: 1011, reason: 'test: relay restart 2' });
  await waitFor(() => resumes().length >= 2, { timeout: 8000, label: 'second auth.resume' });
  check('the second resume presents the ROTATED credential (the first one was consumed)', resumes()[1].payload.credential === N1, resumes()[1].payload.credential.slice(-3));
  relayMsg('auth.ok', { role: 'phone', generation: 3, peer_connected: true, phone_paired: true, next_credential: N2 });
  await waitFor(() => lastOf('mic.state')?.producer_generation === 3, { label: 'mic.state on generation 3' });
  await socket.close({ code: 1011, reason: 'test: relay restart 3' });
  await waitFor(() => resumes().length >= 3, { timeout: 8000, label: 'third auth.resume' });
  check('the third resume presents the next rotated credential', resumes()[2].payload.credential === N2);
  relayMsg('auth.ok', { role: 'phone', generation: 4, peer_connected: true, phone_paired: true, next_credential: 'z'.repeat(43) });
  await waitFor(() => lastOf('mic.state')?.producer_generation === 4, { label: 'mic.state on generation 4' });
  check('no credential value appears anywhere in the page', !(await page.content()).includes(TEST_CREDENTIAL) && !(await page.content()).includes(N1));

  // ---- N-07: phrases go when the TV discards the session, and when the pairing ends ----------------
  const SESSION_C = ids.session();
  const beginC = tvMsg('session.begin', { family_mode: false, phrase_count: 1, cues_max: 3 }, { session_id: SESSION_C });
  await waitAck(beginC, 'session.begin for the discarded session');
  const heldBefore = await page.evaluate(() => ({ saved: document.querySelectorAll('#phrase-saved li').length, typed: document.getElementById('phrase-1').value }));
  check('N-07: before the discard the page holds the saved phrase and the typed draft', heldBefore.saved >= 1 && heldBefore.typed !== '', JSON.stringify(heldBefore));
  const discardId = tvMsg('session.end', { reason: 'discarded' }, { session_id: SESSION_C });
  await waitAck(discardId, 'session.end discarded');
  await page.waitForFunction(() => document.querySelectorAll('#phrase-saved li').length === 0);
  const afterDiscard = await page.evaluate(() => ({ rows: document.querySelectorAll('#phrase-list li').length, typed: document.getElementById('phrase-1').value, html: document.body.innerHTML }));
  check('N-07: after session.end discarded the saved list and the editor are empty (still paired)', afterDiscard.rows === 1 && afterDiscard.typed === '' && !afterDiscard.html.includes('onerror=alert') && !afterDiscard.html.includes('Another phrase') && (await page.isVisible('#view-setup')));
  relayMsg('unpaired', { reason: 'room_closed' });
  await page.waitForSelector('#view-join:not([hidden])');
  const afterUnpair = await page.evaluate(() => ({ heading: document.getElementById('unpaired-heading').textContent, reason: document.getElementById('unpaired-reason').textContent, html: document.documentElement.outerHTML }));
  check('N-07: after the room closed the page is back on Join with a plain explanation', afterUnpair.heading === 'This phone is no longer paired' && afterUnpair.reason === 'The TV closed this pairing.', JSON.stringify([afterUnpair.heading, afterUnpair.reason]));
  check('N-07: no phrase text is left anywhere in the page', !afterUnpair.html.includes('onerror=alert') && !afterUnpair.html.includes('Another phrase') && !afterUnpair.html.includes('A household'));

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

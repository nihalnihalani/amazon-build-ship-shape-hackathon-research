/**
 * T16 gate, part E: one complete local journey (real relay process, the phone TEST build in system Chrome with
 * synthetic audio, the headless TV session core) followed by independent audits of everything that crossed the
 * wire, everything that was stored, and everything the relay logged.
 *
 *   SEC-P01  network payload audit (frames, HTTP requests, browser API calls)
 *   SEC-P02  relay log audit (incl. hostile traffic)
 *   SEC-P06  phone persistent-storage audit
 *   SEC-T04  TV storage audit, SEC-T05 delete flow
 *   SEC-T02  hidden-meter leak scan, including the invalid hidden window (A4-01) and the side doors (A4-03)
 *   SEC-W01  XSS-looking phrases, label and cue render literally on the phone page and in the TV view
 *
 * The 6-phrase bank has hidden positions 3 and 6: position 3 is a valid hidden attempt, position 6 a SILENT
 * hidden attempt (an invalid window). Expected values are derived from ADR-0004 and the amendments by hand.
 * Evidence class: automated (synthetic audio in desktop Chrome, headless TV). Never real_phone or real_VVD.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWireMessage, type MessageType } from '@atr/protocol';
import type { TvView } from '@atr/session-core';
import { buildArtifacts, startPhone, sleep, type PhoneEnv } from '../src/e2e-env.js';
import { LOUD, ROOM, has, phoneMeasuring, quietAndCalibrate } from '../src/journey.js';
import { MemoryStorage, startTv, type TvHarness } from '../src/tv-driver.js';
import { RawClient, ROOT, collectSecrets, samplePayload, startSecRelay, type Msg, type SecRelay } from './helpers.js';
import path from 'node:path';

const MARK = { label: '<i onclick=1>LabelMarker', cue: 'CueMarkerOm', phrase1: 'Marker phrase alpha one' };
const XSS_PHRASES = [`<img src=x onerror="window.__xss=1">`, `"><script>window.__xss=2</script>`, 'javascript:window.__xss=3'];
const BANK = [MARK.phrase1, ...XSS_PHRASES, 'Marker phrase fifth', 'Marker phrase sixth'];
const HIDDEN = new Set([3, 6]);

// What each side may send, written by hand from PROTOCOL.md section 3.
const PHONE_MAY_SEND = new Set(['join.request', 'auth.resume', 'ping', 'mic.state', 'precheck.result', 'level', 'window.result', 'listener.response', 'cue', 'phrases.update', 'ack']);
const TV_MAY_SEND = new Set(['room.create', 'auth.resume', 'ping', 'pairing.refresh', 'join.confirm', 'unpair', 'room.close', 'session.begin', 'session.state', 'precheck.start', 'window.start', 'window.stop', 'window.cancel', 'listener.open', 'attempt.reveal', 'session.end', 'ack']);
const VERDICT_WORDS = /reached|below|band|not scored|\bdB\b|too (quiet|soft|loud)|no voice|clipp|muted|blocked|integrity|inconsistent|noisier/i;

interface TimedFrame {
  t: number;
  dir: 'in' | 'out';
  msg: Msg;
  text: string;
}

let relay: SecRelay;
let phone: PhoneEnv;
let tv: TvHarness;
const phoneFrames: TimedFrame[] = [];
const requests: Array<{ url: string; type: string }> = [];
const failedRequests: string[] = [];
const wsUrls: string[] = [];
const hiddenViews: Array<{ position: number; stage: string; json: string; view: TvView }> = [];
const sideDoor: Array<{ stage: string; offered: string[] }> = [];
let apiCalls: Array<{ n: string; a: string }> = [];
let phoneStorage: Record<string, unknown> = {};
let tvKeysAtEnd: string[] = [];
let tvValuesAtEnd = new Map<string, string>();
let tvKeysAfterDelete: string[] = [];
let pairingMessages: string[] = [];
let summary: TvView['summary'] = null;
const phraseViews: Array<{ position: number; text: string }> = [];
let cueChipText: string | null = null;
let xssFlagPhone: unknown = 'unset';
let phraseSavedHtml = '';
let invalidHiddenSteps: string[] = [];
let hostileMarkerSent = '';
const crashChecks: Array<{ label: string; position: number; raw: string | undefined; attempts: Array<Record<string, unknown>>; resumeScreen: string; resumeJson: string }> = [];

const INIT_SCRIPT = `
(() => {
  const calls = [];
  window.__sec = { calls };
  const rec = (n, a) => { try { calls.push({ n, a: String(a).slice(0, 200) }); } catch (e) {} };
  const wrap = (name) => {
    const C = window[name];
    if (typeof C !== 'function') return;
    window[name] = new Proxy(C, { construct(t, args, nt) { rec(name, args[0]); return Reflect.construct(t, args, nt); } });
  };
  ['WebSocket', 'MediaRecorder', 'Worker', 'SharedWorker', 'EventSource', 'BroadcastChannel', 'SpeechRecognition', 'webkitSpeechRecognition', 'RTCPeerConnection'].forEach(wrap);
  if (navigator.sendBeacon) { const o = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => { rec('sendBeacon', u); return o(u, d); }; }
  const f = window.fetch; if (f) window.fetch = function (u) { rec('fetch', u && u.url ? u.url : u); return f.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { rec('xhr', u); return xo.apply(this, arguments); };
  const cou = URL.createObjectURL; URL.createObjectURL = function () { rec('createObjectURL', ''); return cou.apply(this, arguments); };
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => { rec('getUserMedia', JSON.stringify(c)); return g(c); }; }
})();
`;

const shapeOf = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.length === 0 ? [] : [shapeOf(v[0])];
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = shapeOf((v as Record<string, unknown>)[k]);
    return o;
  }
  return v === null ? 'null' : typeof v;
};
const nullable = (v: unknown, other: unknown): boolean => JSON.stringify(v) === JSON.stringify(other) || v === 'null' || other === 'null';
function sameShape(actual: unknown, sample: unknown): boolean {
  if (typeof sample === 'string' || typeof actual === 'string') return nullable(actual, sample) || actual === sample;
  if (Array.isArray(sample) && Array.isArray(actual)) return actual.length === 0 || sample.length === 0 || sameShape(actual[0], sample[0]);
  if (sample && actual && typeof sample === 'object' && typeof actual === 'object') {
    const ak = Object.keys(actual as object).sort();
    const sk = Object.keys(sample as object).sort();
    return JSON.stringify(ak) === JSON.stringify(sk) && ak.every((k) => sameShape((actual as Record<string, unknown>)[k], (sample as Record<string, unknown>)[k]));
  }
  return false;
}

function walk(v: unknown, fn: (path: string, value: unknown) => void, p = ''): void {
  fn(p, v);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${p}[${i}]`));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v as object)) walk(x, fn, `${p}.${k}`);
}

const isMultiple = (x: number, step: number): boolean => Math.abs(x / step - Math.round(x / step)) < 1e-6;

describe('journey audits (network, storage, logs, hidden-meter leaks, literal rendering)', () => {
  beforeAll(async () => {
    buildArtifacts();
    relay = await startSecRelay({ staticDir: path.join(ROOT, 'apps/phone/dist-test') });
    phone = await startPhone();
    tv = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca });
    await phone.page.addInitScript(INIT_SCRIPT);
    phone.page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    phone.page.on('requestfailed', (r) => failedRequests.push(r.url()));
    phone.page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
      const rec = (dir: 'in' | 'out') => (f: { payload: string | Buffer }) => {
        if (typeof f.payload !== 'string') return;
        phoneFrames.push({ t: Date.now(), dir, msg: JSON.parse(f.payload) as Msg, text: f.payload });
      };
      ws.on('framesent', rec('out'));
      ws.on('framereceived', rec('in'));
    });
    tv.store.subscribe((v) => {
      if (v.phrase && v.phrase.position > 0) {
        if (v.stage === 'phrase_ready' && v.phrase.attemptNumber !== 2 && !phraseViews.some((p) => p.position === v.phrase!.position)) {
          phraseViews.push({ position: v.phrase.position, text: v.phrase.text });
        }
      }
      if (v.cue && cueChipText === null) cueChipText = v.cue.text;
      if (v.phrase && HIDDEN.has(v.phrase.position) && v.phrase.attemptNumber === 1 && v.stage !== 'reveal' && v.stage !== 'phrase_ready') {
        hiddenViews.push({ position: v.phrase.position, stage: v.stage, json: JSON.stringify(v), view: v });
      }
    });
  }, 300_000);

  afterAll(async () => {
    tv?.dispose();
    await phone?.close();
    await relay?.stop();
  });

  it('runs the journey: hostile label and phrases, family mode, a valid hidden attempt, a silent hidden attempt, summary, delete', async () => {
    const { page } = phone;
    // ---- pairing with a hostile device label, family mode on
    if (tv.view().screen === 'onboarding') tv.act('continue');
    await tv.waitFor((v) => v.screen === 'home', 'home');
    tv.act('open_settings');
    await tv.waitFor((v) => v.screen === 'settings', 'settings');
    tv.act('toggle_family_mode');
    tv.act('back');
    await tv.waitFor((v) => v.screen === 'home', 'home again');
    tv.act('start_session');
    const pairing = await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, 'pairing code');
    await page.goto(`${relay.origin}/#code=${pairing.pairing!.code!}`);
    await page.fill('#device-label', MARK.label);
    await page.click('#join');
    const confirm = await tv.waitFor((v) => v.screen === 'join_confirm' && !!v.pairing?.joinRequest, 'join confirm');
    expect(JSON.stringify(confirm.pairing!.joinRequest)).toContain(MARK.label);
    const digits = (await (await page.waitForFunction(() => /pick (\d{2})/.exec(document.body.innerText)?.[1] ?? null)).jsonValue()) as string;
    const idx = confirm.pairing!.joinRequest!.choices.indexOf(digits);
    expect(idx).toBeGreaterThanOrEqual(0);
    tv.act(`pick_choice_${idx + 1}` as never);
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    await page.click('#confirm-yes');
    await page.waitForSelector('#start-mic', { state: 'visible' });
    await page.click('#start-mic');
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
    await phone.setLevel(ROOM);

    // ---- phrases typed into the real editor (hostile text included) and a custom cue word
    const rowCount = () => page.$$eval('#phrase-list li', (l) => l.length);
    while ((await rowCount()) < BANK.length) await page.click('#add-phrase');
    for (let i = 0; i < BANK.length; i += 1) await page.fill(`#phrase-${i + 1}`, BANK[i]!);
    await page.click('#save-phrases');
    await page.waitForFunction((n) => document.querySelectorAll('#phrase-saved li').length === n, BANK.length, { timeout: 15_000 });
    phraseSavedHtml = await page.$eval('#phrase-saved', (e) => e.innerHTML);
    xssFlagPhone = await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss);
    await page.click('#cue-settings summary');
    await page.fill('#cue-word', MARK.cue);
    await page.click('#save-cue');

    // ---- quiet check, calibration, vowel skipped
    await quietAndCalibrate(tv, phone);
    const ready1 = await tv.waitFor((v) => v.stage === 'phrase_ready', 'phrase 1 ready');
    expect(ready1.phrase!.total).toBe(BANK.length);

    const capture = async (level: number, label: string): Promise<void> => {
      tv.act('begin_phrase');
      await tv.waitFor((v) => v.stage === 'phrase_active' && has(v, 'stop_early'), `${label} capture`, 30_000);
      await phoneMeasuring(phone);
      await sleep(200);
      await phone.setLevel(level);
      await sleep(1500);
      await phone.setLevel(ROOM);
      await sleep(700);
      tv.act('stop_early');
    };
    const listenerAnswer = async (): Promise<void> => {
      await page.waitForSelector('#heard:not([disabled])', { timeout: 20_000 });
      await page.click('#heard');
    };

    for (let p = 1; p <= BANK.length; p += 1) {
      await tv.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === p, `phrase ${p} ready`, 30_000);
      if (p === 4 || p === 5) {
        tv.act('skip_phrase');
        continue;
      }
      const silent = p === 6;
      await capture(silent ? ROOM : LOUD, `phrase ${p}`);
      await tv.waitFor((v) => v.stage === 'response_pending' || v.stage === 'reveal', `phrase ${p} response`, 30_000);
      if (HIDDEN.has(p)) {
        const pending = await tv.waitFor((v) => v.stage === 'response_pending', `hidden ${p} stays in response_pending (not revealed early)`, 10_000);
        if (silent) invalidHiddenSteps.push(`stage=${pending.stage} actions=${pending.actions.map((a) => a.id).join(',')}`);
        // Side doors while the hidden result is pending (A4-03): record what the TV offers.
        sideDoor.push({ stage: pending.stage, offered: pending.actions.map((a) => a.id) });
        for (const door of ['open_settings', 'open_history', 'open_diagnostics', 'open_about'] as const) {
          if (has(tv.view(), door)) {
            tv.act(door);
            const opened = tv.view();
            hiddenViews.push({ position: p, stage: `side:${door}`, json: JSON.stringify(opened), view: opened });
            if (has(tv.view(), 'back')) tv.act('back');
            else tv.press('back');
            await sleep(100);
          }
        }
        // Crash while the hidden result is pending (A4-02): what is on disk, and what a relaunch shows.
        await sleep(700); // let the checkpoint write land
        {
          const raw = tv.storage.map.get('atr:v1:active');
          const attempts = raw ? ((JSON.parse(raw) as { record: { attempts: Array<Record<string, unknown>> } }).record.attempts) : [];
          const copy = new MemoryStorage();
          for (const [k, v] of tv.storage.map) copy.map.set(k, v);
          const tv2 = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: copy });
          const v2 = tv2.view();
          crashChecks.push({ label: silent ? 'silent hidden window pending' : 'valid hidden window pending', position: p, raw, attempts, resumeScreen: v2.screen, resumeJson: JSON.stringify(v2) });
          tv2.dispose();
        }
        await tv.waitFor((v) => has(v, 'rate_felt_loud'), `hidden ${p} rating prompt`);
        if (p === 3) tv.act('rate_felt_loud');
        else tv.act('rate_felt_normal');
      }
      if (p === 1) {
        await page.waitForSelector('#cue:not([disabled])');
        await page.click('#cue');
        await tv.waitFor((v) => v.cue !== null, 'cue chip');
      }
      await listenerAnswer();
      const revealed = await tv.waitFor((v) => v.stage === 'reveal' && v.result !== null, `phrase ${p} reveal`, 30_000);
      if (silent) {
        invalidHiddenSteps.push(`reveal tone=${revealed.result!.tone} label=${revealed.result!.label}`);
        expect(revealed.result!.tone).toBe('not_scored'); // the reason appears only now
      } else {
        expect(revealed.result!.tone).toBe('reached');
      }
      if (has(tv.view(), 'next_phrase')) tv.act('next_phrase');
      else tv.act('skip_phrase'); // an unscored attempt offers retry, skip or finish
    }
    const sv = await tv.waitFor((v) => v.screen === 'summary' && v.summary !== null, 'summary', 30_000);
    summary = sv.summary;
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic off'), undefined, { timeout: 15_000 });

    // ---- audits that need the live page
    apiCalls = await page.evaluate(() => (window as unknown as { __sec: { calls: Array<{ n: string; a: string }> } }).__sec.calls);
    phoneStorage = await page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      indexedDB: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : -1,
      caches: typeof caches !== 'undefined' ? (await caches.keys()).length : 0,
      cookie: document.cookie,
      serviceWorkers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    }));
    const state = await phone.context.storageState();
    phoneStorage['playwrightStorageState'] = { cookies: state.cookies.length, originsWithStorage: state.origins.filter((o) => o.localStorage.length > 0).length };

    // ---- TV storage before delete, hostile traffic, delete
    tvKeysAtEnd = [...tv.storage.map.keys()];
    tvValuesAtEnd = new Map(tv.storage.map);
    pairingMessages = tv.transport.received.concat(tv.transport.sent);
    hostileMarkerSent = 'SECRETMARKER-' + Math.random().toString(36).slice(2, 10);
    const attacker = await RawClient.open(relay, null);
    for (const frame of [
      `{"not":"json ${hostileMarkerSent}`,
      JSON.stringify({ type: hostileMarkerSent, payload: { phrases: [hostileMarkerSent] } }),
      JSON.stringify({ protocol_version: 1, type: 'cue', message_id: 'm_' + hostileMarkerSent.padEnd(20, 'x').slice(0, 20), room_id: null, session_id: null, window_id: null, attempt_id: null, sender_role: 'phone', producer_generation: 0, sequence: 0, event_timestamp: Date.now(), payload: { text: hostileMarkerSent } }),
    ]) attacker.send(frame);
    await sleep(500);
    attacker.close();
    tv.act('done');
    await tv.waitFor((v) => v.screen === 'home', 'home before delete');
    tv.storage.map.set('foreign:key', 'keep');
    tv.act('open_settings');
    await tv.waitFor((v) => v.screen === 'settings', 'settings for delete');
    tv.act('delete_local_data');
    const dlg = await tv.waitFor((v) => v.dialog !== null, 'delete dialog');
    expect(dlg.dialog!.preferred).toBe('cancel');
    tv.act('confirm_destructive');
    await tv.waitFor((v) => v.dialog === null, 'delete done');
    await sleep(500);
    tvKeysAfterDelete = [...tv.storage.map.keys()];
    expect(tv.storage.map.get('foreign:key')).toBe('keep');
  }, 600_000);

  it('SEC-P01: every frame the phone sent or received is a valid protocol message of an allowed type with exactly the documented fields', () => {
    expect(phone.problems).toEqual([]); // no console errors, no binary frame sent
    const out = phoneFrames.filter((f) => f.dir === 'out');
    const inn = phoneFrames.filter((f) => f.dir === 'in');
    expect(out.length).toBeGreaterThan(100);
    expect(inn.length).toBeGreaterThan(20);
    const tvOut = tv.transport.sent.map((t) => JSON.parse(t) as Msg);
    expect(tvOut.length).toBeGreaterThan(30);
    const bad: string[] = [];
    const check = (m: Msg, text: string, allowed: Set<string> | null, who: string): void => {
      const r = parseWireMessage(text);
      if (!r.ok) bad.push(`${who} ${m.type}: invalid (${r.code})`);
      if (allowed && !allowed.has(m.type)) bad.push(`${who} sent a type it may not send: ${m.type}`);
      const sample = samplePayload(m.type as MessageType);
      if (!sameShape(shapeOf(m.payload), shapeOf(sample))) bad.push(`${who} ${m.type}: unexpected payload fields ${JSON.stringify(Object.keys(m.payload))}`);
    };
    for (const f of out) check(f.msg, f.text, PHONE_MAY_SEND, 'phone');
    for (const f of inn) check(f.msg, f.text, null, 'relay-or-tv');
    for (const t of tv.transport.sent) check(JSON.parse(t) as Msg, t, TV_MAY_SEND, 'tv');
    expect(bad).toEqual([]);
  });

  it('SEC-P01: no audio, PCM, blob or base64 payload; strings and arrays within the guard; dB values quantised to 0.1, coverage to 0.001, times whole milliseconds', () => {
    const texts = [...phoneFrames.map((f) => f.text), ...tv.transport.sent, ...tv.transport.received];
    const problems: string[] = [];
    for (const text of texts) {
      const m = JSON.parse(text) as Msg;
      walk(m.payload, (p, v) => {
        const key = p.split('.').pop() ?? '';
        if (/^(audio|pcm|samples|waveform|blob|buffer|data)$/i.test(key)) problems.push(`${m.type}: audio-like key ${p}`);
        if (typeof v === 'string' && [...v].length > 256) problems.push(`${m.type}: string over 256 at ${p}`);
        if (typeof v === 'string' && v.length >= 40 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && !['tv_credential', 'phone_credential', 'credential', 'next_credential'].includes(key) && key !== 'room_id') {
          problems.push(`${m.type}: base64-looking string at ${p}`);
        }
        if (Array.isArray(v) && v.length > 16) problems.push(`${m.type}: array over 16 at ${p}`);
        if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${m.type}: non-finite number at ${p}`);
        if (typeof v === 'number') {
          if (/(_dbfs|^\.dbfs)$/.test(p) && !isMultiple(v, 0.1)) problems.push(`${m.type}: ${p}=${v} not a multiple of 0.1`);
          if (/\.coverage$/.test(p) && !isMultiple(v, 0.001)) problems.push(`${m.type}: ${p}=${v} not a multiple of 0.001`);
          if (/(_ms|t_audio_ms|duration_ms|onset_ms)$/.test(p) && !Number.isInteger(v)) problems.push(`${m.type}: ${p}=${v} not whole milliseconds`);
        }
      });
      if (Buffer.byteLength(text, 'utf8') > 8192) problems.push(`${m.type}: frame over 8192 bytes`);
    }
    expect(problems).toEqual([]);
  });

  it('SEC-P01: level frames only inside capture windows the TV started, never for prechecks, never after the window result', () => {
    const inFrames = phoneFrames.filter((f) => f.dir === 'in');
    const outFrames = phoneFrames.filter((f) => f.dir === 'out');
    const starts = new Map<string, number>();
    for (const f of inFrames) if (f.msg.type === 'window.start' && f.msg.window_id) starts.set(f.msg.window_id, f.t);
    const precheckIds = new Set(inFrames.filter((f) => f.msg.type === 'precheck.start').map((f) => String(f.msg.window_id)));
    const resultAt = new Map<string, number>();
    for (const f of outFrames) if (f.msg.type === 'window.result' && f.msg.window_id) resultAt.set(f.msg.window_id, f.t);
    const levels = outFrames.filter((f) => f.msg.type === 'level');
    expect(levels.length).toBeGreaterThan(40);
    expect(starts.size).toBeGreaterThanOrEqual(5); // calibration plus four phrase attempts
    const perWindow = new Map<string, number>();
    for (const f of levels) {
      const w = String(f.msg.window_id);
      expect(precheckIds.has(w), 'level frame for a precheck window').toBe(false);
      expect(starts.has(w), 'level frame for a window the TV never started').toBe(true);
      expect(f.t, 'level before its window.start arrived').toBeGreaterThanOrEqual((starts.get(w) as number) - 5);
      const done = resultAt.get(w);
      if (done !== undefined) expect(f.t, 'level after its window.result').toBeLessThanOrEqual(done + 5);
      perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
    }
    for (const [w, n] of perWindow) expect(n, `window ${w}`).toBeLessThanOrEqual(700);
    // Between windows nothing but protocol chatter: no level frame is timestamped outside every [start, result] interval.
    const intervals = [...starts].map(([w, s]) => [s - 5, (resultAt.get(w) ?? Number.MAX_SAFE_INTEGER) + 5] as const);
    const outside = levels.filter((f) => !intervals.some(([a, b]) => f.t >= a && f.t <= b));
    expect(outside).toHaveLength(0);
  });

  it('SEC-P01: the phone page made no request or browser API call that could carry audio anywhere except the relay socket', () => {
    const origin = new URL(relay.origin);
    for (const r of requests) {
      const u = new URL(r.url);
      expect(u.origin, `request to ${r.url}`).toBe(origin.origin); // no third-party host
      expect(['document', 'script', 'stylesheet', 'image', 'font', 'other', 'manifest', 'ping', 'fetch', 'xhr', 'websocket']).toContain(r.type);
    }
    expect(failedRequests.filter((u) => !u.endsWith('favicon.ico'))).toEqual([]);
    expect(wsUrls.length).toBeGreaterThan(0);
    for (const u of wsUrls) expect(u).toBe(relay.wsUrl);
    // Instrumented browser APIs: only the WebSocket to the relay was ever used; no recorder, beacon, XHR, fetch,
    // worker, event source, broadcast channel, speech recognition or peer connection.
    const names = new Set(apiCalls.map((c) => c.n));
    for (const c of apiCalls) {
      if (c.n === 'WebSocket') expect(c.a).toBe(relay.wsUrl);
    }
    for (const forbidden of ['MediaRecorder', 'sendBeacon', 'xhr', 'fetch', 'Worker', 'SharedWorker', 'EventSource', 'BroadcastChannel', 'SpeechRecognition', 'webkitSpeechRecognition', 'RTCPeerConnection', 'createObjectURL']) {
      expect(names.has(forbidden), `browser API used: ${forbidden}`).toBe(false);
    }
  });

  it('SEC-P06: the phone stored nothing (localStorage, sessionStorage, IndexedDB, Cache API, cookies, service workers)', () => {
    expect(phoneStorage).toMatchObject({ localStorage: 0, sessionStorage: 0, caches: 0, cookie: '', serviceWorkers: 0 });
    expect([0, -1]).toContain(phoneStorage['indexedDB']);
    expect(phoneStorage['playwrightStorageState']).toEqual({ cookies: 0, originsWithStorage: 0 });
  });

  it('SEC-T04: TV storage held only atr:v1: keys; summaries and the checkpoint contain no phrase, cue, label, credential, code, room or number', () => {
    expect(tvKeysAtEnd.length).toBeGreaterThan(2);
    for (const k of tvKeysAtEnd) expect(k.startsWith('atr:v1:'), `foreign key ${k}`).toBe(true);
    const frames = pairingMessages.map((t) => JSON.parse(t) as Msg);
    const secrets = collectSecrets(frames);
    const sensitive = [...secrets.credentials, ...secrets.codes, ...secrets.roomIds, MARK.label, MARK.cue, ...BANK];
    for (const [k, v] of tvValuesAtEnd) {
      if (k === 'atr:v1:phrases') continue; // the phrase bank is stored by design (disclosed, deletable)
      for (const s of sensitive) {
        if (k === 'atr:v1:settings' && s === MARK.cue) continue; // ADR-0005: settings hold family mode and the cue word
        expect(v.includes(s), `${k} contains a sensitive value (${s.length > 12 ? s.slice(0, 12) : s})`).toBe(false);
      }
      expect(v).not.toMatch(/phrase_text|"text"|device_label|credential|pairing_code/);
    }
    const phrasesValue = tvValuesAtEnd.get('atr:v1:phrases') ?? '';
    for (const s of BANK) expect(phrasesValue.includes(JSON.stringify(s).slice(1, -1))).toBe(true); // stored literally
    expect(tvKeysAtEnd.some((k) => k === 'atr:v1:active')).toBe(false); // the checkpoint is cleared after the final record
  });

  it('SEC-T05: delete removed every atr: key, left a foreign key alone, and the TV reports the empty namespace', () => {
    expect(tvKeysAfterDelete.filter((k) => k.startsWith('atr:'))).toEqual([]);
    expect(tvKeysAfterDelete).toContain('foreign:key');
  });

  it('SEC-P02: the relay logged no credential, code, room id, phrase, cue, label, address or message id; every line is a closed-vocabulary JSON record; hostile frames were not echoed', () => {
    const frames = pairingMessages.map((t) => JSON.parse(t) as Msg).concat(phoneFrames.map((f) => f.msg));
    const secrets = collectSecrets(frames);
    // The four "relay: ..." startup lines name the listening address and the static directory; per-event records follow.
    const text = relay.logs.join('').split('\n').filter((l) => !l.startsWith('relay: ')).join('\n');
    const leaks: string[] = [];
    for (const c of secrets.credentials) if (text.includes(c)) leaks.push('credential');
    for (const c of secrets.codes) if (text.includes(c)) leaks.push(`pairing code ${c}`);
    for (const r of secrets.roomIds) if (text.includes(r)) leaks.push('full room id');
    for (const s of [MARK.label, MARK.cue, ...BANK, hostileMarkerSent]) if (text.includes(s)) leaks.push(`content ${s.slice(0, 20)}`);
    for (const m of frames) if (m.message_id && text.includes(m.message_id)) leaks.push('message id');
    expect(text).not.toMatch(/\b127\.0\.0\.1\b|::1\b|::ffff:/); // no source address
    expect(text).not.toMatch(/[A-Za-z0-9_-]{43}/); // no credential-sized token
    expect(text).not.toMatch(/\b[mrjswa]_[A-Za-z0-9_-]{8,}/); // no protocol identifier
    expect(leaks).toEqual([]);
    const allowedKeys = new Set(['event', 'code', 'type', 'role', 'room', 'bytes', 'latency_ms', 'count', 'name', 'minute', 'kind', 'value', 'types', 'metric']);
    let jsonLines = 0;
    for (const line of text.split('\n')) {
      const i = line.indexOf('{');
      if (i < 0 || !line.trim().endsWith('}')) continue;
      const rec = JSON.parse(line.slice(i)) as Record<string, unknown>;
      jsonLines += 1;
      for (const k of Object.keys(rec)) expect(allowedKeys.has(k), `unexpected log field "${k}" in ${line.slice(i, i + 160)}`).toBe(true);
      if (typeof rec['room'] === 'string') expect(rec['room']).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(jsonLines).toBeGreaterThan(5);
  });

  it('SEC-T02: while a hidden first attempt is pending, no view carries a level, a verdict, a validity reason or a result; the TV offers no side door; the invalid hidden window follows the same neutral path (A4-01)', () => {
    expect(hiddenViews.length).toBeGreaterThan(10);
    for (const h of hiddenViews) {
      const v = h.view;
      expect(v.meter, `${h.stage} at position ${h.position}`).toBeNull();
      expect(v.result, `${h.stage} at position ${h.position}`).toBeNull();
      if (v.capturing) expect(v.announcement).toBeNull();
      expect(h.json, `view ${h.stage} at position ${h.position}`).not.toMatch(VERDICT_WORDS);
      expect(h.json).not.toMatch(/levelRelDb":-?\d|"bandRelDb":-?\d|"tone":"(reached|below|not_scored)"/);
    }
    const stages = new Set(hiddenViews.filter((h) => h.position === 6).map((h) => h.stage));
    expect(stages.has('response_pending')).toBe(true); // the silent hidden window waited for the rating like a valid one
    expect(sideDoor.length).toBe(2);
    for (const d of sideDoor) {
      expect(d.stage).toBe('response_pending');
      // A4-03: Settings is unavailable between capture close and reveal. History and Diagnostics, if offered, were
      // opened by the loop in the journey and their views are in hiddenViews, which carry no result.
      expect(d.offered, 'Settings must not be offered while a hidden result is pending').not.toContain('open_settings');
    }
    console.log('SEC-T02 offered actions during hidden response_pending:', JSON.stringify(sideDoor));
    // The prompt a person sees is the same for the valid and the invalid hidden attempt.
    const p3 = sideDoor[0]?.offered.sort().join(',');
    const p6 = sideDoor[1]?.offered.sort().join(',');
    expect(p6, 'the invalid hidden window must offer exactly what the valid one offers').toBe(p3);
    expect(invalidHiddenSteps.join(' | ')).toMatch(/reveal tone=not_scored/);
  });

  it('SEC-T03 / A4-02: a crash while a hidden result is pending leaves no verdict, rating or window figure for that attempt on disk, and a relaunch shows none of it', () => {
    expect(crashChecks.map((c) => c.position)).toEqual([3, 6]);
    for (const c of crashChecks) {
      expect(c.raw, `${c.label}: a checkpoint exists to resume from`).toBeDefined();
      const inFlight = c.attempts.filter((a) => a['position'] === c.position);
      for (const a of inFlight) {
        expect(a['verdict'], `${c.label}: verdict`).toBeNull();
        expect(a['rating'], `${c.label}: rating`).toBeNull();
        expect(a['reason'], `${c.label}: reason`).toBeNull();
        expect(a['activeMs'], `${c.label}: activeMs`).toBeNull();
        expect(a['longestActiveMs'], `${c.label}: longestActiveMs`).toBeNull();
        expect(a['listener'], `${c.label}: listener`).toBeNull();
      }
      // the earlier, revealed attempts keep their records (positions 1 and 2, plus 3 for the later checkpoint)
      expect(c.attempts.filter((a) => (a['position'] as number) < c.position).length).toBeGreaterThanOrEqual(c.position === 3 ? 2 : 3);
      expect(c.resumeScreen, c.label).toBe('resume_or_discard');
      // The relaunch screen states the policy in general terms (a window open at close is recorded as interrupted and not scored),
      // so the phrase "not scored" is allowed here; every level- or verdict-bearing word is not.
      const hit = /reached|below|\bband\b|\bdB\b|too (quiet|soft|loud)|no voice|clipp|muted|integrity|inconsistent|noisier/i.exec(c.resumeJson);
      expect(hit === null ? null : c.resumeJson.slice(Math.max(0, hit.index - 80), hit.index + 80), `${c.label}: verdict-like text in the relaunch view`).toBeNull();
      expect(c.resumeJson, c.label).not.toMatch(/"tone":"(reached|below|not_scored)"/);
      expect(c.resumeJson).not.toMatch(/levelRelDb":-?\d/);
    }
    console.log('SEC-T03 relaunch screen text (valid hidden window pending):', JSON.stringify(JSON.parse(crashChecks[0]?.resumeJson ?? '{}').body));
  });

  it('A5-01: the delete flow also tells the relay (room.close after the last session message), and the phone leaves the paired view', async () => {
    const types = tv.transport.sent.map((t) => (JSON.parse(t) as Msg).type);
    expect(types.slice(-8), 'relay cleanup is sent as part of the delete').toEqual(expect.arrayContaining(['room.close']));
    expect(types.lastIndexOf('room.close')).toBeGreaterThan(types.lastIndexOf('session.end'));
    await phone.page.waitForSelector('#view-join:not([hidden])', { timeout: 15_000 });
    expect(await phone.page.isVisible('#view-setup')).toBe(false);
  });

  it.fails('OPEN FINDING N-07: after the TV deleted its data and closed the room, the phone page no longer holds the household phrases (state, editor, saved list)', async () => {
    const held = await phone.page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll<HTMLInputElement>('#phrase-list input')).map((i) => i.value).filter((v) => v !== ''),
      saved: document.querySelectorAll('#phrase-saved li').length,
    }));
    expect(held.saved).toBe(0);
    expect(held.inputs).toEqual([]);
  });

  it('A5-03 / A5-04 / A5-05: a stale checkpoint is discarded; summaries are kept 8 days and pruned after; corrupt values are survived', async () => {
    const DAY = 86_400_000;
    const recKey = [...tvValuesAtEnd.keys()].find((k) => k.startsWith('atr:v1:session:'));
    expect(recKey).toBeDefined();
    const rec = JSON.parse(tvValuesAtEnd.get(recKey as string) as string) as Record<string, unknown>;
    const mk = (id: string, ageDays: number): [string, string] => {
      const t = Date.now() - ageDays * DAY;
      const r = { ...rec, sessionId: id, startedAt: t - 600_000, endedAt: t, localDate: new Date(t).toISOString().slice(0, 10) };
      return [`atr:v1:session:${id}`, JSON.stringify(r)];
    };
    const base = (): MemoryStorage => {
      const st = new MemoryStorage();
      st.map.set('atr:v1:meta', JSON.stringify({ schema_version: 1, created_at: Date.now() }));
      st.map.set('atr:v1:settings', tvValuesAtEnd.get('atr:v1:settings') ?? '{}');
      return st;
    };
    // A5-04 retention
    const st = base();
    for (const [id, age] of [['s_retention7days', 7], ['s_retention9days', 9], ['s_retention20days', 20]] as const) {
      const [k, v] = mk(id, age);
      st.map.set(k, v);
    }
    const tvA = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: st });
    const keysA = [...st.map.keys()];
    expect(keysA).toContain('atr:v1:session:s_retention7days');
    expect(keysA).not.toContain('atr:v1:session:s_retention9days');
    expect(keysA).not.toContain('atr:v1:session:s_retention20days');
    tvA.dispose();
    // A5-03 a checkpoint older than the 12 hour room lifetime is never offered
    const crash = crashChecks[0];
    expect(crash?.raw).toBeDefined();
    const old = JSON.parse(crash?.raw as string) as { savedAt: number };
    const st2 = base();
    st2.map.set('atr:v1:active', JSON.stringify({ ...old, savedAt: Date.now() - 13 * 3_600_000 }));
    const tvB = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: st2 });
    expect(tvB.view().screen).not.toBe('resume_or_discard');
    expect(st2.map.has('atr:v1:active')).toBe(false);
    tvB.dispose();
    const st3 = base();
    st3.map.set('atr:v1:active', JSON.stringify({ ...old, savedAt: Date.now() - 2 * 3_600_000 }));
    const tvC = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: st3 });
    expect(tvC.view().screen).toBe('resume_or_discard'); // a fresh one is
    tvC.dispose();
    // A5-05 corrupt and hostile values are treated as absent; the app starts
    const st4 = base();
    st4.map.set('atr:v1:phrases', '{"phrases": "not an array"');
    st4.map.set('atr:v1:settings', '{"familyMode": {"__proto__": {"polluted": 1}}, "cueWord": 12345}');
    st4.map.set('atr:v1:active', 'null');
    st4.map.set('atr:v1:session:s_corruptrecord1', '{"sessionId": "s_corruptrecord1", "attempts": "x"}');
    st4.map.set('atr:v1:index', '[[[');
    const tvD = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: st4 });
    expect(['home', 'onboarding']).toContain(tvD.view().screen);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    tvD.dispose();
    // a value from a NEWER schema is never overwritten
    const st5 = new MemoryStorage();
    st5.map.set('atr:v9:meta', '{"schema_version": 9}');
    st5.map.set('atr:v9:phrases', '{"phrases": ["from the future"]}');
    const tvE = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca, storage: st5 });
    expect(st5.map.get('atr:v9:phrases')).toBe('{"phrases": ["from the future"]}');
    expect([...st5.map.keys()].filter((k) => k.startsWith('atr:v1:'))).toEqual([]); // nothing of ours was written beside it
    tvE.dispose();
  }, 120_000);

  it('SEC-W01: hostile phrases, label and cue render literally: the phone page executed nothing and created no element, the TV view carries the exact text', () => {
    expect(xssFlagPhone).toBeUndefined();
    expect(phraseSavedHtml).not.toMatch(/<img|<script|<b /i); // the saved list is text nodes inside <li>, markup is escaped
    expect(phraseSavedHtml).toContain('&lt;img src=x onerror=');
    for (let i = 0; i < BANK.length; i += 1) {
      const seen = phraseViews.find((p) => p.position === i + 1);
      expect(seen?.text, `phrase ${i + 1} as the TV shows it`).toBe(BANK[i]);
    }
    expect(cueChipText).toBe(MARK.cue);
    expect(summary).not.toBeNull();
  });
});

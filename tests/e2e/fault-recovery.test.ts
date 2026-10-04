/**
 * T15: failure recovery over the real stack with injected faults.
 *
 *   TV core ──WSS──▶ fault proxy ──WSS──▶ local relay ◀──WSS── fault proxy ◀──WSS── phone (Chrome)
 *
 * Each scenario pairs a fresh TV and phone, injects one fault and checks that the faulted attempt is
 * never scored, that the TV never claims "Mic off" without the phone saying so, and that an explicit
 * retry produces a correct verdict. Evidence class: automated (synthetic audio, headless TV).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TvView } from '@atr/session-core';
import { buildArtifacts, sleep, startPhone, startRelay, type PhoneEnv, type RelayEnv } from '../src/e2e-env.js';
import { startFaultProxy, type FaultProxy } from '../src/fault-proxy.js';
import { LOUD, ROOM, SOFT, beginCapture, has, pairAndStartMic, quietAndCalibrate, visibleAttempt } from '../src/journey.js';
import { startTv, type TvHarness } from '../src/tv-driver.js';

let relay: RelayEnv;
let tvProxy: FaultProxy;
let phoneProxy: FaultProxy;
let phone: PhoneEnv | null = null;
let tv: TvHarness | null = null;
const micViews: string[] = [];

async function freshPair(opts: { familyMode?: boolean } = {}) {
  tv?.dispose();
  await phone?.close();
  micViews.length = 0;
  phone = await startPhone();
  tv = await startTv({ relayUrl: tvProxy.url, ca: relay.ca });
  tv.store.subscribe((v) => micViews.push(v.mic));
  await pairAndStartMic(tv, phone, { relayOrigin: relay.origin, phoneRelayUrl: phoneProxy.url, familyMode: opts.familyMode });
  await quietAndCalibrate(tv, phone);
}

const notScored = (v: TvView) => v.stage === 'paused_or_invalid' || (v.stage === 'reveal' && v.result?.tone === 'not_scored');

describe('T15 failure recovery with injected faults', () => {
  beforeAll(async () => {
    buildArtifacts();
    relay = await startRelay();
    const cert = readFileSync(path.join(relay.certDir, 'server.crt'));
    const key = readFileSync(path.join(relay.certDir, 'server.key'));
    tvProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
    phoneProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
  }, 240_000);

  afterEach(() => {
    for (const p of [tvProxy, phoneProxy]) {
      p.config.latencyUpMs = 0;
      p.config.latencyDownMs = 0;
      p.config.duplicateUpEvery = 0;
      p.config.blackout = false;
    }
  });

  afterAll(async () => {
    tv?.dispose();
    await phone?.close();
    await tvProxy?.close();
    await phoneProxy?.close();
    await relay?.stop();
  });

  it('TV link loss mid-window: unscored, mic never shown off, reconnect with rotated credential, retry scores', async () => {
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    await sleep(500);
    tvProxy.dropAll();
    const paused = await tv!.waitFor((v) => notScored(v) || v.mic === 'unknown', 'TV notices link loss', 20_000);
    expect(paused.mic === 'off').toBe(false);
    await phone!.setLevel(ROOM);
    // The adapter reconnects with the rotated credential; the TV must not auto-resume capture.
    await tv!.waitFor((v) => v.link === 'connected' && v.mic !== 'unknown' && v.stage === 'paused_or_invalid' && has(v, 'retry'), 'reconnected and paused', 40_000);
    expect(micViews.includes('off')).toBe(false);
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry');
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 retry');
    expect(r.result!.tone).toBe('reached');
  }, 180_000);

  it('phone link loss mid-window: attempt unscored, phone resumes, retry scores below correctly', async () => {
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    await sleep(500);
    phoneProxy.dropAll();
    await tv!.waitFor((v) => notScored(v), 'attempt not scored after phone drop', 40_000);
    await phone!.setLevel(ROOM);
    await tv!.waitFor((v) => v.stage === 'paused_or_invalid' && has(v, 'retry') && v.mic === 'open_not_measuring', 'phone back with mic open', 60_000);
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry');
    const r = await visibleAttempt(tv!, phone!, SOFT, 'p1 retry');
    expect(r.result!.tone).toBe('below');
  }, 180_000);

  it('300 ms latency each way on both legs: verdicts still correct', async () => {
    for (const p of [tvProxy, phoneProxy]) {
      p.config.latencyUpMs = 300;
      p.config.latencyDownMs = 300;
    }
    await freshPair();
    const a = await visibleAttempt(tv!, phone!, LOUD, 'p1');
    expect(a.result!.tone).toBe('reached');
    tv!.act('next_phrase');
    await tv!.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === 2, 'p2 ready');
    const b = await visibleAttempt(tv!, phone!, SOFT, 'p2');
    expect(b.result!.tone).toBe('below');
  }, 240_000);

  it('every phone frame duplicated in transit: relay drops duplicates, verdicts unchanged', async () => {
    phoneProxy.config.duplicateUpEvery = 1;
    await freshPair();
    const before = phoneProxy.counts.duplicated;
    const a = await visibleAttempt(tv!, phone!, LOUD, 'p1');
    expect(a.result!.tone).toBe('reached');
    expect(phoneProxy.counts.duplicated).toBeGreaterThan(before + 20);
    // The TV received each phone message once: message ids are unique in what the TV saw.
    const ids = tv!.transport.received.map((t) => (JSON.parse(t) as { message_id: string; sender_role: string })).filter((m) => m.sender_role === 'phone').map((m) => m.message_id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 180_000);

  it('phone page hidden mid-window: interrupted and unscored, capture shut down, explicit restart then retry scores', async () => {
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    await sleep(400);
    await phone!.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tv!.waitFor((v) => notScored(v), 'attempt not scored after page hidden', 20_000);
    await tv!.waitFor((v) => v.mic === 'off', 'TV shows mic off after phone acknowledgement', 20_000);
    await phone!.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await phone!.page.waitForSelector('#start-mic', { state: 'visible', timeout: 15_000 });
    await phone!.page.click('#start-mic');
    await phone!.setLevel(ROOM);
    await tv!.waitFor((v) => v.mic === 'open_not_measuring' && has(v, 'retry'), 'mic reopened', 20_000);
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry');
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 retry');
    expect(r.result!.tone).toBe('reached');
  }, 180_000);

  it('room gets noisier before a phrase: gate blocks (unscored), quieter room then scores', async () => {
    await freshPair();
    await phone!.setLevel(ROOM + 8);
    tv!.act('begin_phrase');
    const blocked = await tv!.waitFor((v) => v.stage === 'paused_or_invalid', 'gate blocked', 20_000);
    expect(blocked.body.join(' ')).toMatch(/noisier/i);
    await phone!.setLevel(ROOM);
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry');
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 retry');
    expect(r.result!.tone).toBe('reached');
  }, 180_000);

  it('continuous sound for the whole window: not scored (continuous_sound)', async () => {
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    const r = await tv!.waitFor((v) => v.stage === 'reveal' || v.stage === 'paused_or_invalid', 'window closes at max duration', 30_000);
    await phone!.setLevel(ROOM);
    expect(r.result?.tone ?? 'not_scored').toBe('not_scored');
  }, 120_000);

  it('microphone goes digitally silent mid-session: pre-window check reports muted input, unscored', async () => {
    await freshPair();
    await phone!.silence();
    tv!.act('begin_phrase');
    const blocked = await tv!.waitFor((v) => v.stage === 'paused_or_invalid', 'blocked on silent input', 20_000);
    expect(blocked.body.join(' ')).toMatch(/muted or blocked/i);
  }, 120_000);
});

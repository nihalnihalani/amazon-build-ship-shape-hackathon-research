/**
 * QA REVIEW: additional negative / missing checks for T12 (local journey) and T15 (fault recovery).
 *
 * Authored by the independent QA reviewer (Sonnet 5.5, branch wt/qa). These tests are NOT part of the
 * coordinator-authored suites in tests/e2e; they reuse the same helpers (tests/src) and the same real stack:
 *
 *   headless TV session core -> fault proxy -> local relay <- fault proxy <- phone dist-test in system Chrome
 *
 * Every expected value below is taken from a document (ADR-0001, ADR-0003, ADR-0004, PROTOCOL.md section 4,
 * the A4-01 amendment) or from a differential comparison, never read back from the implementation. Credentials
 * are compared with boolean assertions so a failure never prints one.
 *
 * Evidence class: automated (synthetic audio in desktop Chrome, headless TV). Not real_phone, not real_VVD.
 *
 * Run (from tests/):  npx vitest run --config review-e2e/vitest.config.ts
 */
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MessageFactory, createIdFactory } from '@atr/protocol';
import type { TvView } from '@atr/session-core';
import { buildArtifacts, sleep, startPhone, startRelay, type PhoneEnv, type RelayEnv } from '../src/e2e-env.js';
import { startFaultProxy, type FaultProxy } from '../src/fault-proxy.js';
import { LOUD, ROOM, SOFT, beginCapture, has, pairAndStartMic, phoneMeasuring, quietAndCalibrate, visibleAttempt } from '../src/journey.js';
import { startTv, type TvHarness } from '../src/tv-driver.js';

// Defect repro convention from the earlier review suites: expected-fail unless QA_STRICT=1 (see QA-E2E-01 below).
const STRICT = process.env.QA_STRICT === '1';

interface Frame {
  type: string;
  message_id: string;
  sender_role: string;
  window_id: string | null;
  payload: Record<string, unknown>;
}
const parse = (xs: string[]): Frame[] => xs.map((t) => JSON.parse(t) as Frame);

let relay: RelayEnv;
let tvProxy: FaultProxy;
let phoneProxy: FaultProxy;
let phone: PhoneEnv | null = null;
let tv: TvHarness | null = null;

const tvOut = () => parse(tv!.transport.sent);
const tvIn = () => parse(tv!.transport.received);


/** On a failing test, append the whole relay log (not a filtered excerpt) to $ATR_QA_LOG so a flake leaves evidence. */
function dumpRelayOnFailure(ctx: { task: { name: string; result?: { state?: string } } }): void {
  const out = process.env.ATR_QA_LOG;
  if (!out || ctx.task.result?.state !== 'fail') return;
  appendFileSync(out, `\n##### ${new Date().toISOString()} FAILED ${ctx.task.name}\n${relay.logs.join('')}`);
}

/** Compact diagnostics appended to a failing test: phone badge, last frames both ways, TV view, non-aggregate relay events. */
async function diagnostics(): Promise<string> {
  const brief = (m: Record<string, unknown>) => {
    const pl = (m.payload ?? {}) as Record<string, unknown>;
    const extra = m.type === 'ack' ? ` ${String(pl.outcome)}/${String(pl.detail)}` : m.type === 'mic.state' ? ` ${String(pl.state ?? pl.mic_state ?? '')}` : m.type === 'error' ? ` ${String(pl.code)}` : '';
    return `${String(m.type)}${extra}`;
  };
  const badge = phone ? await phone.page.evaluate(() => document.querySelector('#mic-badge')?.textContent ?? '').catch(() => '?') : '-';
  const v = tv?.view();
  const logs = relay.logs.join('').split('\n').filter((l) => l && !/minute_aggregate/.test(l)).slice(-10).join('\n');
  return [
    '',
    `phone badge: ${badge}`,
    `TV view: stage=${v?.stage} mic=${v?.mic} link=${v?.link} body=${JSON.stringify(v?.body)} result=${JSON.stringify(v?.result)}`,
    `TV sent (last 12): ${tvOut().filter((m) => m.type !== 'ping').slice(-12).map((m) => brief(m as unknown as Record<string, unknown>)).join(' | ')}`,
    `TV received (last 12): ${tvIn().filter((m) => m.type !== 'pong').slice(-12).map((m) => brief(m as unknown as Record<string, unknown>)).join(' | ')}`,
    `phone sent (last 12): ${(phone?.sent ?? []).filter((m) => m.type !== 'ping' && m.type !== 'level').slice(-12).map(brief).join(' | ')}`,
    `phone received (last 12): ${(phone?.received ?? []).filter((m) => m.type !== 'pong').slice(-12).map(brief).join(' | ')}`,
    `relay (non-aggregate, last 10):\n${logs}`,
  ].join('\n');
}
async function traced(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    throw new Error(`${(e as Error).message}${await diagnostics()}`);
  }
}

async function until(cond: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}; tv link=${tv?.view().link} stage=${tv?.view().stage}`);
    await sleep(50);
  }
}

async function freshPair(opts: { familyMode?: boolean; calibrate?: boolean } = {}): Promise<void> {
  tv?.dispose();
  await phone?.close();
  phone = await startPhone();
  tv = await startTv({ relayUrl: tvProxy.url, ca: relay.ca });
  await pairAndStartMic(tv, phone, { relayOrigin: relay.origin, phoneRelayUrl: phoneProxy.url, familyMode: opts.familyMode });
  if (opts.calibrate !== false) await quietAndCalibrate(tv, phone);
}

const notScored = (v: TvView) => v.stage === 'paused_or_invalid' || (v.stage === 'reveal' && v.result?.tone === 'not_scored');
const viewText = (v: TvView) => [v.title, ...v.body, v.result?.label ?? '', v.result?.detail ?? '', v.banner?.text ?? ''].join(' ');

/** Raw relay client with no browser origin (like a TV). Returns every frame received within `waitMs`. */
async function rawResume(role: 'tv' | 'phone', roomId: string, credential: string, waitMs = 1500): Promise<Frame[]> {
  const ws = new WebSocket(relay.wsUrl, { ca: relay.ca });
  const got: Frame[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.on('message', (d) => got.push(JSON.parse(d.toString('utf8')) as Frame));
  const mf = new MessageFactory({ role, idFactory: createIdFactory(), clock: () => Date.now(), roomId });
  ws.send(mf.serialize(mf.next('auth.resume', { room_id: roomId, role, credential })));
  await sleep(waitMs);
  ws.close();
  return got;
}

describe('QA REVIEW T15: negative checks over the real stack', () => {
  beforeAll(async () => {
    buildArtifacts();
    relay = await startRelay();
    const cert = readFileSync(path.join(relay.certDir, 'server.crt'));
    const key = readFileSync(path.join(relay.certDir, 'server.key'));
    tvProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
    phoneProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
  }, 240_000);

  afterAll(async () => {
    tv?.dispose();
    await phone?.close();
    await tvProxy?.close();
    await phoneProxy?.close();
    await relay?.stop();
  });

  afterEach((ctx) => dumpRelayOnFailure(ctx));

  // Reset every fault between tests (the coordinator suite does the same in afterEach).
  const reset = () => {
    for (const p of [tvProxy, phoneProxy]) {
      p.config.latencyUpMs = 0;
      p.config.latencyDownMs = 0;
      p.config.duplicateUpEvery = 0;
      p.config.blackout = false;
      p.release();
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Credential rotation. T15 test 1 is titled "reconnect with rotated credential" but drops the link
  // once. After one rotation the relay's one-step grace (60 s, relay-core CREDENTIAL_GRACE_MS) still
  // accepts the ORIGINAL credential, so a client that never stored the rotated one would pass T15
  // anyway. The only proof is on the wire: each auth.resume must carry what the previous auth.ok issued.
  // ---------------------------------------------------------------------------------------------
  it('REV-T15-01 TV: after two link drops each auth.resume carries the credential the previous auth.ok issued', async () => {
    reset();
    await freshPair();
    const created = tvIn().find((m) => m.type === 'room.created');
    expect(created, 'TV received room.created').toBeDefined();
    const firstCred = String(created!.payload.tv_credential);
    const okBase = tvIn().filter((m) => m.type === 'auth.ok').length;
    for (let drop = 1; drop <= 2; drop++) {
      tvProxy.dropAll();
      await until(() => tvIn().filter((m) => m.type === 'auth.ok').length >= okBase + drop && tv!.view().link === 'connected', `TV auth.ok after drop ${drop}`, 40_000);
      await sleep(1200);
    }
    const resumes = tvOut().filter((m) => m.type === 'auth.resume');
    const oks = tvIn().filter((m) => m.type === 'auth.ok');
    expect(resumes.length, 'at least two resumes').toBeGreaterThanOrEqual(2);
    expect(oks.length, 'at least two auth.ok').toBeGreaterThanOrEqual(2);
    const cred = (m: Frame) => String(m.payload.credential);
    const next = (m: Frame) => String(m.payload.next_credential);
    expect(cred(resumes[0]!) === firstCred, 'first resume presents the room.created credential').toBe(true);
    expect(next(oks[0]!) !== cred(resumes[0]!), 'first auth.ok issues a different credential').toBe(true);
    expect(cred(resumes[1]!) === next(oks[0]!), 'second resume presents the credential issued by the first auth.ok (rotation persisted)').toBe(true);
    expect(cred(resumes[1]!) !== cred(resumes[0]!), 'second resume is not a replay of the first').toBe(true);
    expect(next(oks[1]!) !== next(oks[0]!), 'second auth.ok rotates again (not the grace re-issue of the same credential)').toBe(true);
  }, 180_000);

  it('REV-T15-02 phone: after two link drops each auth.resume carries the credential the previous auth.ok issued', async () => {
    reset();
    await freshPair();
    const joined = phone!.received.find((m) => m.type === 'join.accepted');
    expect(joined, 'phone received join.accepted').toBeDefined();
    const firstCred = String((joined!.payload as Record<string, unknown>).phone_credential);
    const okCount = () => phone!.received.filter((m) => m.type === 'auth.ok').length;
    const base = okCount();
    for (let drop = 1; drop <= 2; drop++) {
      phoneProxy.dropAll();
      await until(() => okCount() >= base + drop, `phone auth.ok after drop ${drop}`, 60_000);
      await sleep(1200);
    }
    const resumes = phone!.sent.filter((m) => m.type === 'auth.resume') as unknown as Frame[];
    const oks = phone!.received.filter((m) => m.type === 'auth.ok') as unknown as Frame[];
    expect(resumes.length).toBeGreaterThanOrEqual(2);
    expect(oks.length).toBeGreaterThanOrEqual(2);
    expect(String(resumes[0]!.payload.credential) === firstCred, 'first phone resume presents the join.accepted credential').toBe(true);
    expect(String(oks[0]!.payload.next_credential) !== firstCred, 'first auth.ok issues a different credential').toBe(true);
    expect(String(resumes[1]!.payload.credential) === String(oks[0]!.payload.next_credential), 'second phone resume presents the credential issued by the first auth.ok').toBe(true);
    expect(String(oks[1]!.payload.next_credential) !== String(oks[0]!.payload.next_credential), 'second auth.ok rotates again').toBe(true);
  }, 180_000);

  it('REV-T15-03 a consumed (rotated-out) credential is refused and logged as reuse; a garbage credential is logged differently', async () => {
    reset();
    await freshPair();
    const created = tvIn().find((m) => m.type === 'room.created')!;
    const roomId = String(created.payload.room_id);
    const c0 = String(created.payload.tv_credential);
    const okBase = tvIn().filter((m) => m.type === 'auth.ok').length;
    for (let drop = 1; drop <= 2; drop++) {
      tvProxy.dropAll();
      await until(() => tvIn().filter((m) => m.type === 'auth.ok').length >= okBase + drop && tv!.view().link === 'connected', `TV auth.ok after drop ${drop}`, 40_000);
      await sleep(1200);
    }
    // c0 has now been rotated out twice over, so it is neither current nor the one-step grace credential.
    const logsBefore = relay.logs.join('').length;
    const garbage = await rawResume('tv', roomId, 'A'.repeat(43));
    expect(garbage.some((m) => m.type === 'auth.ok'), 'garbage credential must not authenticate').toBe(false);
    const garbageErr = garbage.find((m) => m.type === 'error');
    expect(garbageErr, 'garbage credential gets an error frame').toBeDefined();
    const replayed = await rawResume('tv', roomId, c0);
    expect(replayed.some((m) => m.type === 'auth.ok'), 'consumed credential must not authenticate').toBe(false);
    const replayErr = replayed.find((m) => m.type === 'error');
    expect(replayErr, 'consumed credential gets an error frame').toBeDefined();
    // The client-visible failure is deliberately generic (A3-05): both look the same on the wire.
    expect(String(replayErr!.payload.code)).toBe(String(garbageErr!.payload.code));
    expect(String(replayErr!.payload.detail)).toBe(String(garbageErr!.payload.detail));
    // The server-side log distinguishes them: reuse is recorded as such (ADR-0003 / A3-07), garbage is not.
    const newLogs = relay.logs.join('').slice(logsBefore);
    expect(newLogs, 'relay logged the consumed-credential presentation as reuse').toMatch(/credential_reused/);
    expect(newLogs, 'relay logged the garbage credential too').toMatch(/bad_credential/);
    // And the logs still do not contain either credential.
    expect(newLogs.includes(c0), 'relay log leaked the replayed credential').toBe(false);
  }, 180_000);

  // ---------------------------------------------------------------------------------------------
  // No automatic resume after reconnect, checked on the wire (T15 test 1 only checks the TV view).
  // ---------------------------------------------------------------------------------------------
  it('REV-T15-04 after TV link loss mid-window the TV sends no new window.start until the user retries', async () => {
    reset();
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    await sleep(500);
    const starts = () => tvOut().filter((m) => m.type === 'window.start').length;
    const before = starts();
    expect(before, 'the p1 window started once').toBeGreaterThanOrEqual(1);
    tvProxy.dropAll();
    await tv!.waitFor((v) => v.link === 'connected' && v.stage === 'paused_or_invalid' && has(v, 'retry'), 'reconnected and paused', 40_000);
    await phone!.setLevel(ROOM);
    await sleep(4000);
    expect(starts(), 'no window.start was sent by the reconnect itself').toBe(before);
    expect(tv!.view().stage).toBe('paused_or_invalid');
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry');
    await beginCapture(tv!, 'p1 retry');
    expect(starts(), 'positive control: an explicit retry does send a new window.start').toBe(before + 1);
  }, 180_000);

  // ---------------------------------------------------------------------------------------------
  // Noise gate boundary. ADR-0001 blocks when rise >= 6 dB or (calibration margin - rise) < 10 dB. The
  // quiet check ran at ROOM, so ROOM+4 is a 4 dB rise with a margin of roughly 45 dB: it must NOT block.
  // T15 only tests ROOM+8 (blocks); over-blocking would pass it.
  // ---------------------------------------------------------------------------------------------
  it('REV-T15-05 a room only 4 dB louder than the quiet check does not block the gate and scores normally', async () => {
    reset();
    await freshPair();
    const seen: string[] = [];
    tv!.store.subscribe((v) => seen.push(viewText(v)));
    await phone!.setLevel(ROOM + 4);
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 at ROOM+4');
    expect(r.result!.tone).toBe('reached');
    expect(seen.join(' | '), 'the gate must not have said the room is noisier').not.toMatch(/noisier/i);
  }, 180_000);

  // ---------------------------------------------------------------------------------------------
  // continuous_sound reason. T15 asserts only `result?.tone ?? 'not_scored'`, which also passes when the
  // TV never produced a result at all. Assert a result exists and that its reason is the right one.
  // MEASUREMENT.md: continuous_sound = activity covers > 95 % of the window and no offset was observed.
  // ---------------------------------------------------------------------------------------------
  it('REV-T15-06 continuous sound gives a Not scored result whose stated reason is the continuous sound, not low level', async () => {
    reset();
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phone!.setLevel(LOUD);
    const r = await tv!.waitFor((v) => v.stage === 'reveal' && v.result !== null, 'a result is produced at max duration', 30_000);
    await phone!.setLevel(ROOM);
    expect(r.result!.tone).toBe('not_scored');
    const text = viewText(r);
    expect(text, 'reason mentions the sound continuing').toMatch(/continu|whole time|did not stop|never stopped|steady/i);
    expect(text, 'reason is not the low-level, muted or noisy-room explanation').not.toMatch(/too quiet|no voice|muted|blocked|noisier/i);
  }, 120_000);

  // ---------------------------------------------------------------------------------------------
  // Duplicates in BOTH directions at once, from the very first frame (so pairing frames are duplicated
  // too). PROTOCOL.md section 4 step 8: a repeated message_id is dropped silently: not forwarded, no
  // error. T15 duplicates only phone->relay and never checks that no error comes back.
  // ---------------------------------------------------------------------------------------------
  it('REV-T15-07 every frame duplicated on both legs: duplicates are dropped silently, each peer sees every message once, verdict correct', async () => {
    reset();
    tvProxy.config.duplicateUpEvery = 1;
    phoneProxy.config.duplicateUpEvery = 1;
    const tvDupBefore = tvProxy.counts.duplicated;
    const phDupBefore = phoneProxy.counts.duplicated;
    await freshPair();
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 with duplicates');
    expect(r.result!.tone).toBe('reached');
    expect(tvProxy.counts.duplicated - tvDupBefore, 'TV frames were actually duplicated').toBeGreaterThan(5);
    expect(phoneProxy.counts.duplicated - phDupBefore, 'phone frames were actually duplicated').toBeGreaterThan(20);
    const phoneSeenFromTv = phone!.received.filter((m) => m.sender_role === 'tv').map((m) => String(m.message_id));
    expect(phoneSeenFromTv.length).toBeGreaterThan(5);
    expect(new Set(phoneSeenFromTv).size, 'phone saw each TV message once').toBe(phoneSeenFromTv.length);
    const tvSeenFromPhone = tvIn().filter((m) => m.sender_role === 'phone').map((m) => m.message_id);
    expect(new Set(tvSeenFromPhone).size, 'TV saw each phone message once').toBe(tvSeenFromPhone.length);
    expect(tvIn().filter((m) => m.type === 'error').map((m) => String(m.payload.code)), 'no error frames came back to the TV').toEqual([]);
    expect(phone!.received.filter((m) => m.type === 'error').map((m) => String((m.payload as Record<string, unknown>).code)), 'no error frames came back to the phone').toEqual([]);
    expect(phone!.problems).toEqual([]);
  }, 240_000);

  // ---------------------------------------------------------------------------------------------
  // Blackout and late replay. The fault proxy has hold/release, but no T15 scenario ever uses it. Frames
  // for a window that TV has already given up on must be ignored on arrival (PROTOCOL.md section 4 step
  // 10: TV ignores level / window.result for a window that is not the open one, `ack ignored_stale`).
  // ---------------------------------------------------------------------------------------------
  /**
   * Shared blackout scenario: hold both directions on the phone leg while the phone keeps measuring, wait until the TV
   * gives up on the window, then release everything at once. Returns what the TV saw.
   */
  async function blackoutThenRelease() {
    reset();
    await freshPair();
    await beginCapture(tv!, 'p1');
    await phoneMeasuring(phone!);
    await phone!.setLevel(LOUD);
    await sleep(800);
    phoneProxy.config.blackout = true;
    const closed = await tv!.waitFor(notScored, 'TV gives up on the silent window', 60_000);
    const staleAcksBefore = tvOut().filter((m) => m.type === 'ack' && m.payload.outcome === 'ignored_stale').length;
    const beforeRelease = tv!.view();
    const rejectedBefore = (relay.logs.join('').match(/"code":"rate_limited","type":"mic\.state"/g) ?? []).length;
    phoneProxy.config.blackout = false;
    phoneProxy.release();
    await phone!.setLevel(ROOM);
    await sleep(4000);
    return { closed, staleAcksBefore, beforeRelease, rejectedBefore };
  }

  it('REV-T15-08 late phone frames for a window the TV already closed are refused as stale and never scored', async () => traced(async () => {
    const { closed, staleAcksBefore, beforeRelease } = await blackoutThenRelease();
    expect(closed.result?.tone ?? 'not_scored', 'the window was not scored while no frames arrived').toBe('not_scored');
    // Non-vacuity: the held frames really reached the TV and were refused, otherwise this proves nothing.
    const staleAcksAfter = tvOut().filter((m) => m.type === 'ack' && m.payload.outcome === 'ignored_stale').length;
    expect(staleAcksAfter, 'late frames arrived at the TV and were answered ignored_stale (scenario is not vacuous)').toBeGreaterThan(staleAcksBefore);
    const after = tv!.view();
    expect(after.result?.tone ?? 'not_scored', 'late frames must not turn the dead window into a score').toBe('not_scored');
    expect(after.stage, 'stage did not change because of late frames').toBe(beforeRelease.stage);
    // The user can still recover: Retry is offered and a fresh attempt scores correctly.
    await tv!.waitFor((v) => has(v, 'retry'), 'retry offered', 30_000);
    tv!.act('retry');
    await tv!.waitFor((v) => v.stage === 'phrase_ready', 'ready after retry', 40_000);
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 retry');
    expect(r.result!.tone).toBe('reached');
  }), 240_000);

  // DEFECT REPRO (QA-E2E-01). After a stall that does not drop the connection, the phone's backlog arrives at the relay
  // in one burst and exceeds the per-connection budget (phone burst 60 per second). The relay rejects frames with
  // rate_limited regardless of type, including the state-bearing mic.state frame that says the phone stopped measuring.
  // Nothing resends it, so the TV keeps showing "measuring" while the phone says "Mic open, not measuring".
  // Expected-fail unless QA_STRICT=1; skipped (inconclusive) when the burst did not happen to reject a mic.state.
  it('[QA-E2E-01] after a stalled link flushes its backlog the TV mic state converges to what the phone reports', async (ctx) => {
    let preconditionMet = true;
    await traced(async () => {
      const { rejectedBefore } = await blackoutThenRelease();
      const rejectedMicState = (relay.logs.join('').match(/"code":"rate_limited","type":"mic\.state"/g) ?? []).length - rejectedBefore;
      const badge = await phone!.page.evaluate(() => document.querySelector('#mic-badge')?.textContent ?? '');
      if (rejectedMicState < 1 || !/Mic open, not measuring/.test(badge)) {
        preconditionMet = false; // inconclusive: the burst did not happen to reject a mic.state frame
        return;
      }
      // Spec (observed state only): the TV mirrors the mic state the phone reports. The phone says it stopped measuring.
      const converged = await tv!.waitFor((v) => v.mic === 'open_not_measuring', 'TV mic state follows the phone', 20_000).then(() => true, () => false);
      if (STRICT) expect(converged, 'TV mic state must converge to the phone (QA_STRICT=1)').toBe(true);
      else expect(converged, 'QA-E2E-01 appears FIXED: switch this repro to a plain assertion').toBe(false);
    });
    if (!preconditionMet) ctx.skip();
  }, 240_000);
});

// =================================================================================================
// T12 gaps
// =================================================================================================

const VERDICT = /reached|below (the )?band|not scored|\bdB\b|too (quiet|soft|loud)|no voice|clipp|well done|good job/i;

const mask = (x: unknown): unknown => {
  if (typeof x === 'number') return '<n>';
  if (typeof x === 'string') return /^[A-Za-z0-9_-]{16,}$/.test(x) ? '<id>' : x;
  if (Array.isArray(x)) return x.map(mask);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, mask(v)]));
  return x;
};
const signature = (m: Record<string, unknown>) => `${String(m.type)} ${JSON.stringify(mask(m.payload))}`;

async function recordPhoneDom(p: PhoneEnv): Promise<void> {
  await p.page.evaluate(() => {
    const w = window as unknown as { __qaText?: string[]; __qaCtl?: string[]; __qaObs?: MutationObserver; __qaSnap?: () => void };
    w.__qaText = [];
    w.__qaCtl = [];
    w.__qaObs?.disconnect();
    const snap = () => {
      const t = document.body.innerText;
      if (w.__qaText!.at(-1) !== t && w.__qaText!.length < 3000) w.__qaText!.push(t);
      const dis = (id: string) => {
        const e = document.getElementById(id) as HTMLButtonElement | null;
        return e ? `${id}:${e.disabled ? 'off' : 'on'}${e.hidden ? '/hidden' : ''}` : `${id}:none`;
      };
      const c = ['heard', 'not-heard', 'cue'].map(dis).join(',');
      if (w.__qaCtl!.at(-1) !== c && w.__qaCtl!.length < 3000) w.__qaCtl!.push(c);
    };
    w.__qaSnap = snap;
    snap();
    w.__qaObs = new MutationObserver(snap);
    w.__qaObs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}
const readPhoneDom = (p: PhoneEnv) => p.page.evaluate(() => ({ text: (window as unknown as { __qaText: string[] }).__qaText, ctl: (window as unknown as { __qaCtl: string[] }).__qaCtl }));
/** Forget everything recorded so far and keep only what the phone shows from now on. */
const resetPhoneDom = (p: PhoneEnv) =>
  p.page.evaluate(() => {
    const w = window as unknown as { __qaText: string[]; __qaCtl: string[]; __qaSnap: () => void };
    w.__qaText.length = 0;
    w.__qaCtl.length = 0;
    w.__qaSnap();
  });

describe('QA REVIEW T12: negative checks over the real stack', () => {
  beforeAll(async () => {
    buildArtifacts();
    relay = await startRelay();
    const cert = readFileSync(path.join(relay.certDir, 'server.crt'));
    const key = readFileSync(path.join(relay.certDir, 'server.key'));
    tvProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
    phoneProxy = await startFaultProxy({ upstream: relay.wsUrl, cert, key, ca: relay.ca });
  }, 240_000);

  afterAll(async () => {
    tv?.dispose();
    await phone?.close();
    await tvProxy?.close();
    await phoneProxy?.close();
    await relay?.stop();
  });

  afterEach((ctx) => dumpRelayOnFailure(ctx));

  // Positive control for the hidden-meter leak scan in T12: a visible attempt DOES show the meter while
  // capturing. Without this, "meter is null on hidden attempts" would also pass if the meter never worked.
  it('REV-T12-01 positive control: a visible attempt shows the live meter while capturing', async () => {
    await freshPair();
    let sawMeter = false;
    tv!.store.subscribe((v) => {
      if (v.stage === 'phrase_active' && v.capturing && v.meter !== null) sawMeter = true;
    });
    const r = await visibleAttempt(tv!, phone!, LOUD, 'p1 visible');
    expect(r.result!.tone).toBe('reached');
    expect(sawMeter, 'a capturing view had a non-null meter').toBe(true);
  }, 180_000);

  // Hidden first attempts, phone side. T12 scans the TV view and checks phone traffic validity, but never
  // looks at what the PHONE shows. Differential (metamorphic) check for A4-01: a hidden attempt that is
  // valid (loud tone) and one that is invalid (no voice at all) must be indistinguishable to the phone,
  // in what it displays, in the state of its listener controls and in the TV-to-phone traffic, until the
  // neutral rating prompt appears.
  it('REV-T12-02 hidden first attempts: phone screen, controls and TV-to-phone traffic do not reveal validity or verdict', async () => {
    await freshPair({ familyMode: true });
    const observed: Array<{ label: string; text: string[]; ctl: string[]; sigs: Set<string>; seq: string[] }> = [];

    const hidden = async (label: string, level: number | null) => {
      await recordPhoneDom(phone!);
      // Slice the TV's own sent frames (exactly ordered); phone.received arrives through asynchronous CDP events.
      const startOut = tvOut().length;
      tv!.act('begin_phrase');
      await tv!.waitFor((v) => v.stage === 'phrase_active' && has(v, 'stop_early'), `${label} capture`, 30_000);
      await phoneMeasuring(phone!);
      // Compare from the first measuring state onwards: the state carried over from the previous phrase differs by position.
      await resetPhoneDom(phone!);
      await sleep(200);
      if (level !== null) await phone!.setLevel(level);
      await sleep(1500);
      await phone!.setLevel(ROOM);
      await sleep(700);
      tv!.act('stop_early');
      const prompt = await tv!.waitFor((v) => has(v, 'rate_felt_normal') || has(v, 'rate_skip'), `${label} neutral rating prompt`, 30_000);
      expect(prompt.result, `${label}: TV shows no result before the rating`).toBeNull();
      expect(prompt.meter, `${label}: TV shows no meter before the rating`).toBeNull();
      await sleep(600);
      const endOut = tvOut().length;
      const dom = await readPhoneDom(phone!);
      const sent = tvOut().slice(startOut, endOut).filter((m) => m.type !== 'ping');
      const sigs = new Set(sent.map((m) => signature(m as unknown as Record<string, unknown>)));
      observed.push({ label, text: dom.text, ctl: dom.ctl, sigs, seq: sent.map((m) => m.type) });
      // Finish the attempt so the next phrase can be reached.
      tv!.act('rate_skip');
      const heard = phone!.page.locator('#heard:not([disabled])');
      if (await heard.count()) await heard.click();
      await tv!.waitFor((v) => v.stage === 'reveal', `${label} reveal`, 40_000);
    };

    // Reach position 3 (first hidden position) by skipping 1 and 2, then position 6 by skipping 4 and 5.
    for (const p of [1, 2]) {
      await tv!.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === p, `p${p} ready`);
      tv!.act('skip_phrase');
    }
    await tv!.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === 3 && v.phrase.attemptNumber === 1, 'p3 ready');
    await hidden('p3 valid loud tone', LOUD);
    tv!.act('next_phrase');
    for (const p of [4, 5]) {
      await tv!.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === p, `p${p} ready`);
      tv!.act('skip_phrase');
    }
    await tv!.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === 6 && v.phrase.attemptNumber === 1, 'p6 ready');
    await hidden('p6 invalid (no voice)', null);

    const [valid, invalid] = observed;
    // 1. No verdict wording on the phone at any moment of either hidden attempt.
    for (const o of observed) {
      const hits = o.text.filter((t) => VERDICT.test(t));
      expect(hits.length, `${o.label}: phone screen showed verdict wording`).toBe(0);
    }
    // 2. The listener controls behave the same for a valid and an invalid hidden window.
    expect(new Set(invalid!.ctl), 'phone listener control states differ between valid and invalid hidden windows').toEqual(new Set(valid!.ctl));
    // 3. The set of distinct TV-to-phone frames (type + masked payload) is identical.
    expect([...invalid!.sigs].sort(), `TV-to-phone traffic differs between valid and invalid hidden windows; valid sequence: ${valid!.seq.join(' ')}; invalid sequence: ${invalid!.seq.join(' ')}`).toEqual([...valid!.sigs].sort());
  }, 300_000);

  // ADR-0004 / AMENDMENTS A4-05: a listener response that arrives after reveal is stored as late and acknowledged
  // `applied` with detail `late`; it never changes the revealed result. The coordinator's journey times out on phrase 8
  // but the phone never answers late (and the phone locks its controls once the TV moves on), so lateListenerResponses = 0
  // there is trivially true. Here the phone leg is held so the click happens before, and arrives after, the reveal.
  it('REV-T12-03 a listener answer that arrives after the TV revealed without it is acknowledged late and cannot alter the result', async () => traced(async () => {
    await freshPair({ familyMode: true });
    tv!.act('begin_phrase');
    await tv!.waitFor((v) => v.stage === 'phrase_active' && has(v, 'stop_early'), 'capture', 30_000);
    await phoneMeasuring(phone!);
    await sleep(200);
    await phone!.setLevel(SOFT);
    await sleep(1500);
    await phone!.setLevel(ROOM);
    await sleep(700);
    tv!.act('stop_early');
    await tv!.waitFor((v) => has(v, 'continue_without_listener'), 'listener timeout offer', 40_000);
    await phone!.page.waitForSelector('#heard:not([disabled])', { timeout: 10_000 });
    const answersBefore = phone!.sent.filter((m) => m.type === 'listener.response').length;
    // Hold the phone leg: the click is sent but not delivered; the TV does not know about it.
    phoneProxy.config.blackout = true;
    await phone!.page.click('#heard');
    await sleep(300);
    expect(phone!.sent.filter((m) => m.type === 'listener.response').length, 'the phone really sent a listener.response').toBe(answersBefore + 1);
    tv!.act('continue_without_listener');
    const revealed = await tv!.waitFor((v) => v.stage === 'reveal' && v.result !== null, 'reveal without listener', 30_000);
    expect(revealed.result!.tone).toBe('below');
    const toneBefore = revealed.result!.tone;
    phoneProxy.config.blackout = false;
    phoneProxy.release();
    const lateFrame = phone!.sent.filter((m) => m.type === 'listener.response').at(-1)!;
    await until(() => tvOut().some((m) => m.type === 'ack' && m.payload.acked_message_id === lateFrame.message_id), 'TV acknowledged the late response', 15_000);
    const ack = tvOut().find((m) => m.type === 'ack' && m.payload.acked_message_id === lateFrame.message_id)!;
    expect(String(ack.payload.outcome), 'late response is acknowledged applied (stored as late), not rejected').toBe('applied');
    expect(String(ack.payload.detail), 'ack detail says late').toBe('late');
    const after = tv!.view();
    expect(after.result!.tone, 'result unchanged by the late answer').toBe(toneBefore);
    expect(tvIn().filter((m) => m.type === 'error').length, 'no error frames reached the TV').toBe(0);
    // Once the TV's reveal reaches the phone it locks the listener controls.
    await phone!.page.waitForFunction(() => {
      const h = document.getElementById('heard') as HTMLButtonElement | null;
      const n = document.getElementById('not-heard') as HTMLButtonElement | null;
      return !!h && !!n && h.disabled && n.disabled;
    }, undefined, { timeout: 10_000 });
  }), 240_000);

  // T12's privacy test names "phrase text" but no phrases.update is sent in the journey, and it never
  // asserts that the relay produced any log output, so the scan can pass on an empty log.
  it('REV-T12-04 household phrases typed on the phone reach the TV verbatim and appear nowhere in relay logs (log is non-empty)', async () => {
    await freshPair({ calibrate: false });
    const phrases = ['Zqv7 marmalade harbour lantern one', 'Zqv7 quartz meadow lantern two'];
    const { page } = phone!;
    await page.fill('#phrase-1', phrases[0]!);
    await page.click('#add-phrase');
    await page.fill('#phrase-2', phrases[1]!);
    await page.click('#save-phrases');
    await page.waitForFunction(() => document.querySelectorAll('#phrase-saved li').length >= 2, undefined, { timeout: 20_000 });
    const update = phone!.sent.find((m) => m.type === 'phrases.update');
    expect(update, 'phone sent phrases.update (scenario is not vacuous)').toBeDefined();
    expect(JSON.stringify(update!.payload)).toContain('Zqv7 marmalade');
    await quietAndCalibrate(tv!, phone!);
    const ready = tv!.view();
    expect(ready.phrase!.text, 'TV shows the first household phrase exactly as typed').toBe(phrases[0]);
    const logs = relay.logs.join('');
    expect(logs.length, 'relay produced log output (scan is not vacuous)').toBeGreaterThan(200);
    expect(logs.includes('Zqv7'), 'relay log contains household phrase text').toBe(false);
    expect(logs.includes('marmalade') || logs.includes('lantern'), 'relay log contains household phrase words').toBe(false);
    const created = tvIn().find((m) => m.type === 'room.created')!;
    expect(logs.includes(String(created.payload.tv_credential)), 'relay log contains the TV credential').toBe(false);
    expect(logs.includes(String(created.payload.pairing_code)), 'relay log contains the pairing code').toBe(false);
  }, 240_000);
});

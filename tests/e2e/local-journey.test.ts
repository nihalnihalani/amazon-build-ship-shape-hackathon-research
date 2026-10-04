/**
 * T12: complete local session over the real relay.
 *
 *   headless TV session core (Node, ws)  <--WSS-->  local relay (HTTPS/WSS)  <--WSS-->  phone dist-test in Chrome
 *
 * Journey: settings (family mode) → pair → TV confirmation → phone microphone (synthetic audio) →
 * quiet check → calibration → sustained vowel → 10 phrases (hidden 3/6/9, a retry, a skip, a cue,
 * a listener timeout) → summary → history → deletion.
 *
 * Expected summary values below are derived by hand from the script and ADR-0004, not read back
 * from the implementation. Evidence class: automated (synthetic audio, headless TV); not real_phone,
 * not real_VVD.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWireMessage } from '@atr/protocol';
import type { TvView } from '@atr/session-core';
import { buildArtifacts, startPhone, startRelay, sleep, type PhoneEnv, type RelayEnv } from '../src/e2e-env.js';
import { startTv, type TvHarness } from '../src/tv-driver.js';

const LOUD = -30; // dBFS synthetic tone: same level as calibration → reached
const SOFT = -60; // 30 dB below calibration → below the band
const HIDDEN = new Set([3, 6, 9]);
const VERDICT_WORDS = /reached|below|band|loud|quiet|dB/i;

let relay: RelayEnv;
let phone: PhoneEnv;
let tv: TvHarness;
const hiddenViews: TvView[] = [];

const has = (v: TvView, id: string) => v.actions.some((a) => a.id === id && !a.disabled);
const capturing = (v: TvView) => has(v, 'stop_early');

describe('T12 local journey (relay + phone page + TV session core)', () => {
  beforeAll(async () => {
    buildArtifacts();
    relay = await startRelay();
    phone = await startPhone();
    tv = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca });
    // Record every view during hidden captures for the leak scan.
    tv.store.subscribe((v) => {
      if (v.phrase && HIDDEN.has(v.phrase.position) && v.phrase.attemptNumber === 1 && v.stage !== 'reveal') hiddenViews.push(v);
    });
  }, 240_000);

  afterAll(async () => {
    tv?.dispose();
    await phone?.close();
    await relay?.stop();
  });

  it('runs the full session and produces the hand-derived summary', async () => {
    const { page } = phone;

    // A. Onboarding, then enable family mode in Settings.
    if (tv.view().screen === 'onboarding') tv.act('continue');
    await tv.waitFor((v) => v.screen === 'home', 'home');
    tv.act('open_settings');
    await tv.waitFor((v) => v.screen === 'settings', 'settings');
    tv.act('toggle_family_mode');
    tv.act('back');
    await tv.waitFor((v) => v.screen === 'home', 'home after settings');

    // B. Pairing with TV confirmation.
    tv.act('start_session');
    const pairing = await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, 'pairing code');
    const code = pairing.pairing!.code!;
    expect(code).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
    expect(pairing.pairing!.qrPayload).toContain(code);
    await page.goto(`${relay.origin}/#code=${code}`);
    await page.click('#join');
    const confirm = await tv.waitFor((v) => v.screen === 'join_confirm' && !!v.pairing?.joinRequest, 'join confirm');
    const digits = confirm.pairing!.joinRequest!.confirmDigits;
    await page.waitForFunction((d) => document.body.innerText.includes(`does it show ${d}`), digits);
    tv.act('accept_join');

    // C. Microphone: explicit phone action, observed state only.
    await page.waitForSelector('#start-mic:not([hidden])');
    await phone.silence().catch(() => undefined); // hooks exist once the test build loads
    await page.click('#start-mic');
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
    await phone.silence();

    // D. Quiet check (silence) and calibration (LOUD for ~2 s inside the 6 s window).
    await tv.waitFor((v) => v.stage === 'quiet_check' && has(v, 'begin_quiet_check'), 'quiet check ready');
    tv.act('begin_quiet_check');
    await tv.waitFor((v) => v.stage === 'calibration' && has(v, 'begin_calibration'), 'calibration ready', 30_000);
    tv.act('begin_calibration');
    await tv.waitFor((v) => v.stage === 'calibration' && v.timer !== null && v.capturing, 'calibration capture');
    await sleep(300);
    await phone.setLevel(LOUD);
    await sleep(2000);
    await phone.silence();
    const cal = await tv.waitFor((v) => v.stage === 'calibration' && has(v, 'continue') && v.result !== null, 'calibration result', 30_000);
    expect(cal.result!.tone).not.toBe('not_scored');
    tv.act('continue');

    // E. Sustained vowel (gate precheck, then ~3 s tone, stop early).
    await tv.waitFor((v) => v.stage === 'vowel_ready' && has(v, 'begin_vowel'), 'vowel ready');
    tv.act('begin_vowel');
    await tv.waitFor((v) => v.stage === 'vowel_active' && capturing(v), 'vowel capture', 30_000);
    await phone.setLevel(LOUD);
    await sleep(3000);
    await phone.silence();
    await sleep(600);
    tv.act('stop_early');
    const vowel = await tv.waitFor((v) => v.stage === 'vowel_result', 'vowel result', 30_000);
    expect(vowel.result).not.toBeNull();
    expect(vowel.result!.tone).not.toBe('not_scored');
    tv.act('continue');

    // F–H. Phrases.
    const script: Record<number, { level?: number; listener?: 'heard' | 'not_heard' | 'timeout'; rating?: string; skip?: boolean; retry?: { level: number; listener: 'heard' | 'not_heard' }; cue?: boolean }> = {
      1: { level: LOUD, listener: 'heard' },
      2: { level: SOFT, listener: 'not_heard', retry: { level: LOUD, listener: 'heard' } },
      3: { level: LOUD, listener: 'heard', rating: 'rate_felt_loud' },
      4: { skip: true },
      5: { level: SOFT, listener: 'heard' },
      6: { level: SOFT, listener: 'not_heard', rating: 'rate_felt_normal' },
      7: { level: LOUD, listener: 'heard', cue: true },
      8: { level: LOUD, listener: 'timeout' },
      9: { level: LOUD, listener: 'heard', rating: 'rate_skip' },
      10: { level: LOUD, listener: 'heard' },
    };

    const capture = async (level: number, label: string) => {
      tv.act('begin_phrase');
      await tv.waitFor((v) => v.stage === 'phrase_active' && capturing(v), `${label} capture`, 30_000);
      await sleep(200);
      await phone.setLevel(level);
      await sleep(1500);
      await phone.silence();
      await sleep(700);
      tv.act('stop_early');
    };
    const answer = async (listener: 'heard' | 'not_heard' | 'timeout', label: string) => {
      if (listener === 'timeout') {
        const waiting = await tv.waitFor((v) => has(v, 'continue_without_listener'), `${label} listener timeout offer`, 40_000);
        expect(waiting.preferredAction).toBe('keep_waiting');
        tv.act('continue_without_listener');
        return;
      }
      await page.waitForSelector(`#${listener === 'heard' ? 'heard' : 'not-heard'}:not([disabled])`, { timeout: 20_000 });
      await page.click(`#${listener === 'heard' ? 'heard' : 'not-heard'}`);
    };

    for (let p = 1; p <= 10; p++) {
      const step = script[p]!;
      const ready = await tv.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === p, `phrase ${p} ready`, 30_000);
      expect(ready.phrase!.total).toBe(10);
      if (step.skip) {
        tv.act('skip_phrase');
        continue;
      }
      await capture(step.level!, `phrase ${p}`);
      await tv.waitFor((v) => v.stage === 'response_pending' || v.stage === 'reveal', `phrase ${p} response`, 30_000);
      if (HIDDEN.has(p)) {
        const pending = tv.view();
        expect(pending.meter).toBeNull();
        expect(pending.result).toBeNull();
        await tv.waitFor((v) => has(v, step.rating!), `phrase ${p} rating`);
        tv.act(step.rating as never);
      }
      if (step.cue) {
        await page.waitForSelector('#cue:not([disabled])');
        await page.click('#cue');
        await tv.waitFor((v) => v.cue !== null, `phrase ${p} cue chip`);
      }
      await answer(step.listener!, `phrase ${p}`);
      const revealed = await tv.waitFor((v) => v.stage === 'reveal' && v.result !== null, `phrase ${p} reveal`, 30_000);
      const expected = step.level === LOUD ? 'reached' : 'below';
      expect(revealed.result!.tone, `phrase ${p} verdict`).toBe(expected);
      if (step.retry) {
        tv.act('try_again');
        await tv.waitFor((v) => v.stage === 'phrase_ready' && v.phrase?.position === p && v.phrase.attemptNumber === 2, `phrase ${p} retry ready`);
        await capture(step.retry.level, `phrase ${p} retry`);
        // Retries show the meter while capturing.
        await answer(step.retry.listener, `phrase ${p} retry`);
        const r2 = await tv.waitFor((v) => v.stage === 'reveal' && v.result !== null && v.phrase?.attemptNumber === 2, `phrase ${p} retry reveal`, 30_000);
        expect(r2.result!.tone).toBe('reached');
      }
      tv.act('next_phrase');
    }

    // I. Summary (hand-derived from the script, ADR-0004 counting rules).
    const summaryView = await tv.waitFor((v) => v.screen === 'summary' && v.summary !== null, 'summary', 30_000);
    const s = summaryView.summary!;
    expect(s.complete).toBe(true);
    expect(s.phrasesAttempted).toBe(9);
    expect(s.phrasesCompleted).toBe(9);
    expect(s.phrasesSkipped).toBe(1);
    expect(s.attemptsInvalid).toBe(0);
    // Visible positions 1,2,5,7,8,10 (best valid attempt): reached at 1,2(retry),7,8,10.
    expect(s.scoredVisible).toBe(6);
    expect(s.reachedVisible).toBe(5);
    // Hidden positions 3,6,9 (first attempt): reached at 3 and 9.
    expect(s.scoredHidden).toBe(3);
    expect(s.reachedHidden).toBe(2);
    expect(s.hiddenRatings).toEqual({ feltLoud: 1, feltNormal: 1, skipped: 1 });
    // Agreement: visible attempts p1 agree, p2 agree, p2-retry agree, p5 disagree, p7 agree, p8 missing (ineligible), p10 agree.
    expect(s.agreementVisible).toEqual({ agree: 5, eligible: 6 });
    expect(s.agreementHidden).toEqual({ agree: 3, eligible: 3 });
    expect(s.lateListenerResponses).toBe(0);
    expect(s.longestActiveMs).not.toBeNull();
    expect(s.longestActiveMs!).toBeGreaterThan(2500);
    expect(s.longestActiveMs!).toBeLessThan(3600);

    // Session end: phone capture stopped and acknowledged; TV shows Mic off only after the phone says so.
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic off'), undefined, { timeout: 15_000 });
    await tv.waitFor((v) => v.mic === 'off', 'TV mic off after phone acknowledgement', 15_000);

    // History: today has a session; other days stay missing (null).
    tv.act('open_history');
    const hist = await tv.waitFor((v) => v.screen === 'history' && v.history !== null, 'history');
    expect(hist.history!).toHaveLength(7);
    const withSessions = hist.history!.filter((d) => d.sessions !== null);
    expect(withSessions).toHaveLength(1);
    expect(hist.history!.filter((d) => d.sessions === null)).toHaveLength(6);
    tv.act('done');

    // J. Deletion with Cancel preferred, then verified empty atr: namespace.
    await tv.waitFor((v) => v.screen === 'home' || v.screen === 'summary', 'after history');
    if (tv.view().screen === 'summary') tv.act('done');
    await tv.waitFor((v) => v.screen === 'home', 'home before delete');
    tv.storage.map.set('foreign:key', 'keep');
    tv.act('open_settings');
    await tv.waitFor((v) => v.screen === 'settings', 'settings for delete');
    tv.act('delete_local_data');
    const dlg = await tv.waitFor((v) => v.dialog !== null, 'delete dialog');
    expect(dlg.dialog!.preferred).toBe('cancel');
    expect(dlg.preferredAction).toBe('cancel_destructive');
    tv.act('confirm_destructive');
    await tv.waitFor((v) => v.dialog === null, 'delete done');
    await sleep(300);
    expect([...tv.storage.map.keys()].filter((k) => k.startsWith('atr:'))).toEqual([]);
    expect(tv.storage.map.get('foreign:key')).toBe('keep');
  }, 600_000);

  it('never leaked level or verdict during hidden first attempts', () => {
    expect(hiddenViews.length).toBeGreaterThan(5);
    for (const v of hiddenViews) {
      expect(v.meter).toBeNull();
      expect(v.result).toBeNull();
      if (v.capturing) expect(v.announcement).toBeNull();
      const text = [v.title, ...v.body, v.announcement ?? '', v.banner?.text ?? ''].join(' ');
      expect(text, `hidden view text on ${v.screen}`).not.toMatch(VERDICT_WORDS);
    }
  });

  it('phone traffic contained only valid protocol messages, no audio, and levels only inside windows', () => {
    expect(phone.problems).toEqual([]);
    expect(phone.sent.length).toBeGreaterThan(100);
    // Validate every phone-sent message with the shared validator and the audio guard.
    for (const m of phone.sent) {
      const r = parseWireMessage(JSON.stringify(m));
      expect(r.ok, `phone message ${String(m.type)} invalid: ${r.ok ? '' : r.code}`).toBe(true);
      const s = JSON.stringify(m);
      expect(s).not.toMatch(/"(audio|pcm|samples|waveform|blob)"/i);
    }
    // Every level frame belongs to a window the phone had been told to start.
    const started = new Set(phone.received.filter((m) => m.type === 'window.start').map((m) => String(m.window_id)));
    for (const m of phone.sent.filter((x) => x.type === 'level')) {
      expect(started.has(String(m.window_id))).toBe(true);
    }
    // No level frames for prechecks.
    const precheckWindows = new Set(phone.received.filter((m) => m.type === 'precheck.start').map((m) => String(m.window_id)));
    for (const m of phone.sent.filter((x) => x.type === 'level')) {
      expect(precheckWindows.has(String(m.window_id))).toBe(false);
    }
  });

  it('relay logs contain no credentials, pairing codes or phrase text', () => {
    const logs = relay.logs.join('');
    const tvReceived = tv.transport.received.map((t) => JSON.parse(t) as Record<string, unknown>);
    const secrets = [...phone.received, ...phone.sent, ...tvReceived]
      .flatMap((m) => {
        const p = (m.payload ?? {}) as Record<string, unknown>;
        return [p.tv_credential, p.phone_credential, p.credential, p.pairing_code, p.text].filter((x): x is string => typeof x === 'string');
      })
      .concat(...phone.sent.filter((m) => m.type === 'phrases.update').map((m) => ((m.payload as { phrases: string[] }).phrases)));
    for (const sec of secrets) expect(logs.includes(sec), `relay log leaked a sensitive value`).toBe(false);
  });
});

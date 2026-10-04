/**
 * Shared journey steps for end-to-end and fault tests: pair (number matching + phone confirmation),
 * start the synthetic microphone, quiet check, calibration and phrase attempts.
 */
import type { TvView } from '@atr/session-core';
import type { PhoneEnv } from './e2e-env.js';
import { sleep } from './e2e-env.js';
import type { TvHarness } from './tv-driver.js';

export const LOUD = -30;
export const SOFT = -60;
export const ROOM = -75;

export const has = (v: TvView, id: string) => v.actions.some((a) => a.id === id && !a.disabled);
export const capturing = (v: TvView) => has(v, 'stop_early');

export async function pairAndStartMic(
  tv: TvHarness,
  phone: PhoneEnv,
  opts: { relayOrigin: string; phoneRelayUrl?: string; familyMode?: boolean },
): Promise<void> {
  const { page } = phone;
  if (tv.view().screen === 'onboarding') tv.act('continue');
  await tv.waitFor((v) => v.screen === 'home', 'home');
  if (opts.familyMode) {
    tv.act('open_settings');
    await tv.waitFor((v) => v.screen === 'settings', 'settings');
    tv.act('toggle_family_mode');
    tv.act('back');
    await tv.waitFor((v) => v.screen === 'home', 'home after settings');
  }
  tv.act('start_session');
  const pairing = await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, 'pairing code');
  const query = opts.phoneRelayUrl ? `?relay=${encodeURIComponent(opts.phoneRelayUrl)}` : '';
  await page.goto(`${opts.relayOrigin}/${query}#code=${pairing.pairing!.code!}`);
  await page.click('#join');
  const confirm = await tv.waitFor((v) => v.screen === 'join_confirm' && !!v.pairing?.joinRequest, 'join confirm');
  const handle = await page.waitForFunction(() => {
    const m = /pick (\d{2})/.exec(document.body.innerText);
    return m ? m[1] : null;
  });
  const digits = (await handle.jsonValue()) as string;
  const idx = confirm.pairing!.joinRequest!.choices.indexOf(digits);
  if (idx < 0) throw new Error('phone digits not among TV choices');
  tv.act(`pick_choice_${idx + 1}` as never);
  await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
  await page.click('#confirm-yes');
  await page.waitForSelector('#start-mic', { state: 'visible' });
  await page.click('#start-mic');
  await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
  await phone.setLevel(ROOM);
}

export async function quietAndCalibrate(tv: TvHarness, phone: PhoneEnv): Promise<void> {
  await tv.waitFor((v) => v.stage === 'quiet_check' && has(v, 'begin_quiet_check'), 'quiet check ready', 30_000);
  tv.act('begin_quiet_check');
  await tv.waitFor((v) => v.stage === 'calibration' && has(v, 'begin_calibration'), 'calibration ready', 30_000);
  tv.act('begin_calibration');
  await tv.waitFor((v) => v.stage === 'calibration' && v.timer !== null && v.capturing, 'calibration capture', 30_000);
  await sleep(300);
  await phone.setLevel(LOUD);
  await sleep(2000);
  await phone.setLevel(ROOM);
  await tv.waitFor((v) => v.stage === 'calibration' && has(v, 'continue') && v.result !== null, 'calibration result', 30_000);
  tv.act('continue');
  await tv.waitFor((v) => v.stage === 'vowel_ready', 'vowel ready');
  tv.act('skip_vowel');
  await tv.waitFor((v) => v.stage === 'phrase_ready', 'phrase ready');
}

/** Begin a phrase and wait until the capture phase is open. */
export async function beginCapture(tv: TvHarness, label: string): Promise<void> {
  tv.act('begin_phrase');
  await tv.waitFor((v) => v.stage === 'phrase_active' && capturing(v), `${label} capture`, 30_000);
}

/** A normal visible attempt at `level`; returns the revealed view. */
export async function visibleAttempt(tv: TvHarness, phone: PhoneEnv, level: number, label: string): Promise<TvView> {
  await beginCapture(tv, label);
  await sleep(200);
  await phone.setLevel(level);
  await sleep(1500);
  await phone.setLevel(ROOM);
  await sleep(700);
  tv.act('stop_early');
  return tv.waitFor((v) => v.stage === 'reveal' && v.result !== null, `${label} reveal`, 30_000);
}

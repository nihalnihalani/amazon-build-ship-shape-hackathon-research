/**
 * docs/adr/AMENDMENTS-REV2.md ADR-0008: A8-01 (nothing announced while the TV must be silent) and
 * A8-02 (fixed script and a longer, configurable lead when the screen reader is on).
 */

import { describe, expect, it } from 'vitest';
import { FLOOR, boot } from './helpers.js';
import type { Harness } from './helpers.js';

const SCRIPT_PHRASE = 'After this message, wait three seconds, then speak. Measurement lasts eight seconds.';

async function atPosition3(): Promise<Harness> {
  const h = await boot();
  h.setupToPhrases();
  for (let p = 1; p < 3; p += 1) {
    h.runPhrase({});
    h.ui('next_phrase');
  }
  expect(h.view.phrase?.position).toBe(3);
  return h;
}

describe('A8-01 banners and cue chips are visual only while the TV must be silent', () => {
  it('a banner that appears during a visible capture is shown but announced only after the capture closes', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.relayError('rate_limited');
    expect(h.view.capturing).toBe(true);
    expect(h.view.banner?.text).toBe('The relay reported: rate_limited.'); // visible
    expect(h.view.announcement).toBeNull(); // not spoken
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('reveal');
    expect(h.view.capturing).toBe(false);
    expect(h.view.announcement).toContain('The relay reported: rate_limited.'); // deferred until now
    expect(h.view.announcement).toContain("Reached today's relative level band");
    const stable = h.view.announcement;
    h.advance(1000);
    expect(h.view.announcement).toBe(stable); // the live-region text does not change under the reader
    h.ui('next_phrase');
    expect(h.view.announcement).not.toContain('rate_limited'); // gone with the stage
  });

  it('a banner that was already on screen before the window is not announced again afterwards', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.relayError('rate_limited'); // announced now, between windows
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    expect(h.view.announcement).toBeNull();
    h.answerWindow({ rel: 25 });
    expect(h.view.announcement).not.toContain('rate_limited');
  });

  it('for a hidden attempt the deferral lasts until the reveal, not just the capture close', async () => {
    const h = await atPosition3();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.relayError('rate_limited');
    expect(h.view.announcement).toBeNull();
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    expect(h.view.capturing).toBe(false);
    expect(h.view.announcement).toBe('How did that feel?. Choose how loud that phrase felt to you. You can skip the rating.');
    h.relayError('payload_too_large'); // another one while waiting for the rating
    expect(h.view.announcement).not.toContain('relay reported');
    h.ui('rate_felt_normal');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.announcement).toContain('The relay reported: rate_limited.');
    expect(h.view.announcement).toContain('The relay reported: payload_too_large.');
  });

  it('a cue chip for a hidden attempt waiting for its reveal is visible, silent, and announced after the reveal', async () => {
    const h = await atPosition3();
    h.runPhrase({});
    expect(h.view.stage).toBe('response_pending');
    const before = h.view.announcement;
    h.cue('Volume');
    expect(h.view.cue?.text).toBe('Volume'); // visual
    expect(h.view.announcement).toBe(before); // not spoken, not even by the cue
    expect(h.view.announcement).not.toContain('Cue');
    h.ui('rate_felt_loud');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.announcement).toContain('Cue: Volume');
    expect(h.view.cue?.text).toBe('Volume'); // within the 3 s chip window
  });

  it('a cue chip between visible windows is still announced at once', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.cue('Volume');
    expect(h.view.announcement).toBe('Cue: Volume');
  });

  it('while capturing, announcement is always null for every kind of window', async () => {
    const h = await boot();
    h.startAndPair();
    h.beginAndLead('begin_quiet_check');
    expect(h.view.announcement).toBeNull();
    h.answerPrecheck();
    h.beginAndLead('begin_calibration');
    expect(h.view.announcement).toBeNull();
    h.answerWindow({ rel: 20 });
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.relayError('rate_limited');
    for (const v of h.views) if (v.capturing) expect(v.announcement).toBeNull();
  });
});

describe('A8-02 screen reader: fixed script and a longer lead', () => {
  it('the phrase ready screen carries the exact script and the announcement includes it; the lead is 3000 ms', async () => {
    const h = await boot();
    h.a11y(true);
    h.setupToPhrases();
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.body).toContain(SCRIPT_PHRASE);
    expect(h.view.announcement).toContain(SCRIPT_PHRASE);
    h.ui('begin_phrase');
    expect(h.view.timer).toMatchObject({ maxMs: 3000, elapsedMs: 0 });
    h.advance(2999);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(0);
    expect(h.view.timer?.elapsedMs).toBe(2999);
    h.advance(1);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(1);
  });

  it('without the screen reader there is no script and the lead is 1500 ms', async () => {
    const h = await boot();
    h.setupToPhrases();
    expect(h.view.body.join(' ')).not.toContain('After this message');
    h.ui('begin_phrase');
    expect(h.view.timer?.maxMs).toBe(1500);
    h.advance(1499);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(0);
    h.advance(1);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(1);
  });

  it('follows the platform setting as it changes, between windows', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.a11y(true);
    expect(h.view.body).toContain(SCRIPT_PHRASE);
    h.a11y(false);
    expect(h.view.body).not.toContain(SCRIPT_PHRASE);
    h.a11y(true);
    h.a11y(true); // a repeat changes nothing
    expect(h.view.body.filter((l) => l === SCRIPT_PHRASE)).toHaveLength(1);
  });

  it('every ready screen has its own script with the real measurement length', async () => {
    const h = await boot();
    h.a11y(true);
    h.startAndPair();
    expect(h.view.body).toContain('After this message, stay quiet for the whole check. Measurement lasts five seconds.');
    h.runQuiet();
    expect(h.view.stage).toBe('calibration');
    expect(h.view.body).toContain('After this message, wait three seconds, then speak. Measurement lasts six seconds.');
    h.ui('begin_calibration'); // the lead is 3000 ms here
    h.advance(1500);
    expect(h.of('window.start')).toHaveLength(0);
    h.advance(1500);
    expect(h.of('window.start')).toHaveLength(1);
    h.answerWindow({ rel: 20 });
    h.ui('continue');
    expect(h.view.stage).toBe('vowel_ready');
    expect(h.view.body).toContain('After this message, wait three seconds, then speak. Measurement lasts up to thirty seconds.');
    expect(h.view.announcement).toContain('Measurement lasts up to thirty seconds.');
  });

  it('shows the lead in Diagnostics and records whether the screen reader raised it', async () => {
    const h = await boot();
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics).toMatchObject({ screen_reader: 'off', quiet_lead_ms: '1500', quiet_lead_default_ms: '1500', quiet_lead_screen_reader_ms: '3000' });
    h.back();
    h.back();
    h.a11y(true);
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics).toMatchObject({ screen_reader: 'on', quiet_lead_ms: '3000' });
  });

  it('both leads are configurable in settings; out-of-range values are ignored', async () => {
    const seed = (extra: Record<string, unknown>) => ({
      'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
      'atr:v1:settings': JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true, ...extra }),
    });
    const configured = await boot({ seed: seed({ quietLeadMs: 2000, quietLeadScreenReaderMs: 4000 }) });
    configured.setupToPhrases();
    configured.ui('begin_phrase');
    expect(configured.view.timer?.maxMs).toBe(2000);
    configured.back();
    configured.a11y(true);
    expect(configured.view.body).toContain('After this message, wait four seconds, then speak. Measurement lasts eight seconds.');
    configured.ui('begin_phrase');
    expect(configured.view.timer?.maxMs).toBe(4000);
    configured.ui('open_settings'); // not offered while capturing
    configured.back();
    configured.ui('open_settings');
    configured.ui('open_diagnostics');
    expect(configured.view.diagnostics).toMatchObject({ quiet_lead_ms: '4000', quiet_lead_screen_reader_ms: '4000' });

    const bad = await boot({ seed: seed({ quietLeadMs: 100, quietLeadScreenReaderMs: 99_999 }) });
    bad.setupToPhrases();
    bad.ui('begin_phrase');
    expect(bad.view.timer?.maxMs).toBe(1500);
    bad.back();
    bad.a11y(true);
    bad.ui('begin_phrase');
    expect(bad.view.timer?.maxMs).toBe(3000);
  });

  it('the setting applies from the next window: a window already in its lead keeps its own lead', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('begin_phrase');
    h.a11y(true);
    expect(h.view.timer?.maxMs).toBe(1500);
    h.advance(1500);
    expect(h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')).toHaveLength(1);
    void FLOOR;
  });
});

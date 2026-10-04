/**
 * docs/adr/AMENDMENTS-REV2.md A9-02 (qualification state), A1-05/A1-06 (muted microphone, per-purpose reasons),
 * A1-08 (Diagnostics shows the margin and the tolerated rise), A1-09 (integrity on the TV).
 */

import { describe, expect, it } from 'vitest';
import { LABEL_LISTENER_EDITION, LABEL_NO_BAND, LABEL_RELATIVE } from '../src/index.js';
import { FLOOR, allStrings, boot } from './helpers.js';
import type { Harness, HarnessOptions } from './helpers.js';

const withQualification = (qualification: 'not_run' | 'passed' | 'failed', extra: Record<string, unknown> = {}): HarnessOptions => ({
  seed: {
    'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
    'atr:v1:settings': JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true, qualification, ...extra }),
  },
});

const REACHED = "Reached today's relative level band";
const BELOW = "Below today's relative level band";
const SUFFIX = ' (unqualified phone)';

describe('A9-02 qualification state', () => {
  it('starts as not_run and says so in Settings', async () => {
    const h = await boot();
    h.ui('open_settings');
    expect(h.view.body).toContain('Phone qualification: not run (Not yet qualified on this phone)');
    expect(h.view.body.join(' ')).toContain('Not yet qualified on this phone');
  });

  it('not_run and failed add the suffix to band result labels; passed does not', async () => {
    const run = async (q: 'not_run' | 'passed') => {
      const h = await boot(withQualification(q));
      h.setupToPhrases();
      h.runPhrase({ rel: 25 });
      const reached = h.view.result?.label;
      h.ui('next_phrase');
      h.runPhrase({ rel: 5 });
      return { reached, below: h.view.result?.label, announcement: h.view.announcement };
    };
    const notRun = await run('not_run');
    expect(notRun.reached).toBe(REACHED + SUFFIX);
    expect(notRun.below).toBe(BELOW + SUFFIX);
    expect(notRun.announcement).toContain('(unqualified phone)');
    const passed = await run('passed');
    expect(passed.reached).toBe(REACHED);
    expect(passed.below).toBe(BELOW);
    expect(passed.announcement).not.toContain('unqualified');
  });

  it('the vowel band verdict carries the suffix too, and a not-scored label does not need one', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.answerWindow({ rel: 22, longest: 8000 });
    expect(h.view.result?.label).toBe(REACHED + SUFFIX);
    expect(h.view.result?.detail).toBe('Voice-activity duration: 8.0 s');
    h.ui('rest');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.answerWindow({ valid: false, reason: 'no_voice', activeMs: 0 });
    expect(h.view.result?.label).toBe('Not scored');
  });

  it('shows passed in Settings', async () => {
    const h = await boot(withQualification('passed'));
    h.ui('open_settings');
    expect(h.view.body).toContain('Phone qualification: passed');
  });

  it('failed forces Listener Edition: the listener is on, band verdicts are not computed or shown, the listener answer is primary', async () => {
    const h = await boot(withQualification('failed')); // family mode is OFF in settings
    h.ui('open_settings');
    expect(h.view.body.join(' ')).toContain('failed (Listener Edition is used and band results are hidden)');
    h.back();
    h.setupToPhrases();
    expect(h.last('session.begin').payload.family_mode).toBe(true);
    expect(h.view.labels).toContain(LABEL_LISTENER_EDITION);
    expect(h.view.labels).not.toContain(LABEL_NO_BAND);
    // a visible phrase
    h.ui('begin_phrase');
    h.advance(1500);
    h.answerPrecheck();
    h.level(0, FLOOR + 14, true);
    expect(h.view.meter?.levelRelDb).toBe(14);
    expect(h.view.meter?.bandRelDb).toBeNull(); // no band tick
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    expect(h.view.result).toBeNull();
    h.listener('not_heard');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result).toMatchObject({ label: 'Listener: not heard', tone: 'neutral', listener: null, borderline: false });
    expect(h.last('listener.open').payload).toEqual({ timeout_ms: 60000 });
  });

  it('under failed no view in a whole session contains a band verdict, in any language of the verdict', async () => {
    const h = await boot(withQualification('failed'));
    h.setupToPhrases();
    for (let p = 1; p <= 10; p += 1) {
      h.runPhrase({ rel: p % 2 === 0 ? 30 : 4, rating: 'felt_normal', listener: p % 3 === 0 ? 'not_heard' : 'heard' });
      expect(h.view.stage).toBe('reveal');
      h.ui('next_phrase');
    }
    expect(h.view.stage).toBe('summary');
    for (const v of h.views) {
      const text = allStrings({ ...v, footer: '' }).join(' | ');
      expect(text).not.toMatch(/reached today/i);
      expect(text).not.toMatch(/below today/i);
      expect(text).not.toMatch(/borderline/i);
      expect(text).not.toContain('(unqualified phone)');
    }
    const s = h.view.summary;
    expect(s).toMatchObject({ complete: true, phrasesCompleted: 10, reachedVisible: 0, scoredVisible: 0, reachedHidden: 0, scoredHidden: 0, calibrationMarginDb: null });
    expect(s?.lines.join(' ')).toContain("Listener Edition: the listener's answers are the primary outcome. Band results are not shown.");
    expect(s?.lines.join(' ')).toMatch(/Listener answers: heard 7, not heard 3, no response 0\./);
    expect(s?.hiddenRatings).toEqual({ feltLoud: 0, feltNormal: 3, skipped: 0 });
    expect(s?.agreementHidden).toEqual({ agree: 0, eligible: 0 }); // there is no band verdict to agree with
    expect(h.view.labels).toContain(LABEL_RELATIVE);
  });

  it('a configured Listener Edition behaves the same way even when the phone is qualified', async () => {
    const h = await boot({
      seed: {
        'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
        'atr:v1:settings': JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'listener_edition', onboarded: true, qualification: 'passed' }),
      },
    });
    h.setupToPhrases();
    expect(h.last('session.begin').payload.family_mode).toBe(true);
    h.runPhrase({ rel: 25, listener: 'heard' });
    expect(h.view.result?.label).toBe('Listener: heard');
  });

  it('the vowel under failed shows the voice-activity duration only', async () => {
    const h = await boot(withQualification('failed'));
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck();
    h.answerWindow({ rel: 25, longest: 9000 });
    expect(h.view.result).toMatchObject({ label: 'Voice-activity duration: 9.0 s', tone: 'neutral', detail: null });
  });

  it('a speaker who cannot be heard by a listener still gets a missing record, never an invented answer', async () => {
    const h = await boot(withQualification('failed'));
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    h.advance(20_000);
    h.ui('continue_without_listener');
    expect(h.view.result?.label).toBe('Listener: no response');
  });
});

describe('A1-05 / A1-06 / A1-09 on the TV, through the wire', () => {
  it('a pre-window precheck that reports a silent microphone blocks the window with the muted-or-blocked copy', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck({ floor_dbfs: -115, p20_dbfs: -116, p80_dbfs: -114, p95_dbfs: -112 });
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.body).toContain('The phone microphone looks muted or blocked.');
    expect(h.of('window.start').filter((m) => m.payload.kind === 'phrase')).toHaveLength(0);
    expect(h.actionIds()).toEqual(['retry', 'skip_phrase', 'finish_early']);
    h.micState('open_idle');
    h.ui('retry');
    h.runPhrase({});
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ silent_input: 1 });
  });

  it('the pre-window precheck accepts a loud, unstable room (unstable_floor and too_loud are quiet-check only)', async () => {
    const h = await boot();
    h.floor = -50;
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    // a rise of 5.9 dB with a wide percentile spread: valid for a pre-window precheck as far as its own rules go
    h.answerPrecheck({ p20_dbfs: -48, p80_dbfs: -41, p95_dbfs: -40 }, 5.9);
    expect(h.view.stage).toBe('phrase_active');
  });

  it('a window past its commanded duration is not scored and the reason is the TV-local "integrity"', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.beginAndLead('begin_calibration');
    h.answerWindow({ rel: 20, duration: 6600 });
    expect(h.view.title).toBe("Today's band was not set");
    expect(h.view.body.join(' ')).toContain('inconsistent');
    h.ui('retry');
    h.runCalibration(20);
    expect(h.view.result?.label).toBe("Today's band is set");
  });
});

describe('A1-08 Diagnostics shows the calibration margin and the tolerated rise', () => {
  async function diagnostics(h: Harness): Promise<Record<string, string>> {
    h.ui('open_settings');
    h.ui('open_diagnostics');
    return h.view.diagnostics ?? {};
  }

  it('is "not set" before a band exists', async () => {
    const h = await boot();
    expect(await diagnostics(h)).toMatchObject({ calibration_margin_db: 'not set', max_tolerated_floor_rise_db: 'not set' });
  });

  it('shows the margin and a rise limit of less than 6.0 dB for a wide margin (the margin needs 16 dB or more)', async () => {
    const h = await boot();
    h.setupToPhrases(); // margin 20
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics).toMatchObject({ calibration_margin_db: '20.0', max_tolerated_floor_rise_db: 'less than 6.0' });
  });

  it('shows margin - 10 dB for a narrow margin', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(13);
    h.ui('continue');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics).toMatchObject({ calibration_margin_db: '13.0', max_tolerated_floor_rise_db: '3.0 or less' });
  });
});

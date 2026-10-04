/**
 * Runs the TV verdict functions over the DSP owner's independent, hand-derived fixtures
 * (fixtures/dsp). These prove arithmetic and state-machine agreement only: they are not measurements
 * of any microphone, phone, browser or room.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCoverageQuantized, isDbQuantized } from '@atr/protocol';
import { describe, expect, it } from 'vitest';
import { evaluateCalibration, evaluateGate, evaluateQuietCheck, evaluateWindow, validateWindowResult } from '../src/index.js';
import type { PrecheckResultPayload, WindowResultPayload } from '../src/wire.js';
import { Harness } from './helpers.js';

function load<T>(name: string): T {
  const url = new URL(`../../../fixtures/dsp/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

interface SoftCase {
  id: string;
  kind: 'phrase';
  session_floor_dbfs: number;
  cal_margin_db: number;
  band_edge_rel_db: number;
  expected_window: WindowResultPayload;
  expected_window_rel_p95_db: number;
  expected_verdict: 'not_reached';
  expected_borderline: boolean;
}

const soft = load<{ cases: SoftCase[] }>('soft-windows.json').cases;

describe('fixtures/dsp/soft-windows.json (20 valid phrase windows below the band edge)', () => {
  it('holds exactly 20 cases', () => {
    expect(soft).toHaveLength(20);
    expect(new Set(soft.map((c) => c.id)).size).toBe(20);
  });

  it('the TV verdict is not_reached for all 20, with the stated borderline flag and relative level', () => {
    let borderline = 0;
    for (const c of soft) {
      const v = evaluateWindow('phrase', c.expected_window, c.session_floor_dbfs, c.cal_margin_db);
      expect(v.kind, c.id).toBe('scored');
      if (v.kind !== 'scored') continue;
      expect(v.reached, `${c.id} must not be reached`).toBe(false);
      expect(c.expected_verdict).toBe('not_reached');
      expect(v.borderline, `${c.id} borderline`).toBe(c.expected_borderline);
      expect(v.windowRelP95Db, c.id).toBeCloseTo(c.expected_window_rel_p95_db, 9);
      expect(v.thresholdDb, c.id).toBeCloseTo(c.band_edge_rel_db, 9);
      if (v.borderline) borderline += 1;
    }
    expect(borderline).toBe(soft.filter((c) => c.expected_borderline).length);
    expect(borderline).toBeGreaterThanOrEqual(3);
  });

  it('every fixture window passes the TV window re-validation, its calibration margin is acceptable, and an unchanged room never blocks', () => {
    for (const c of soft) {
      expect(validateWindowResult('phrase', c.expected_window), c.id).toEqual({ valid: true });
      expect(c.cal_margin_db).toBeGreaterThanOrEqual(13);
      expect(c.band_edge_rel_db).toBeCloseTo(c.cal_margin_db - 1, 12);
      // the same activity shape as a 6 s calibration window with the fixture's calibration margin
      const p95 = c.session_floor_dbfs + c.cal_margin_db;
      const cal: WindowResultPayload = {
        ...c.expected_window,
        kind: 'calibration',
        duration_ms: 6000,
        expected_frames: 120,
        frame_count: 120,
        coverage: 1,
        p50_active_dbfs: p95 - 1,
        p95_active_dbfs: p95,
        peak_dbfs: p95 + 2,
      };
      expect(evaluateCalibration(cal, c.session_floor_dbfs), c.id).toMatchObject({ accepted: true });
      const quiet: PrecheckResultPayload = {
        purpose: 'pre_window',
        valid: true,
        invalid_reason: null,
        floor_dbfs: c.session_floor_dbfs,
        p20_dbfs: c.session_floor_dbfs,
        p80_dbfs: c.session_floor_dbfs,
        p95_dbfs: c.session_floor_dbfs,
        frame_count: 40,
        expected_frames: 40,
        coverage: 1,
        clipped_frames: 0,
        nonfinite_frames: 0,
        duration_ms: 2000,
      };
      expect(evaluateGate(quiet, c.session_floor_dbfs, c.cal_margin_db), c.id).toMatchObject({ pass: true });
    }
  });

  /** Protocol revision 4 puts dB fields on a 0.1 dB grid; the regenerated fixtures are all on it. */
  const onGrid = (c: SoftCase): boolean =>
    [c.expected_window.p50_active_dbfs, c.expected_window.p95_active_dbfs, c.expected_window.peak_dbfs].every(
      (v) => v === null || isDbQuantized(v),
    ) && isCoverageQuantized(c.expected_window.coverage);

  it('all 20 fixtures are wire-transmittable on the revision 4 grid (dB multiples of 0.1, coverage multiples of 0.001)', () => {
    expect(soft.filter((c) => !onGrid(c)).map((c) => c.id)).toEqual([]);
    // the three that used to sit between grid points keep their borderline flags on the grid
    const byId = new Map(soft.map((c) => [c.id, c]));
    for (const id of ['soft-03-11.01dB-borderline', 'soft-04-11.99dB-borderline', 'soft-18-fractional-margin']) {
      const c = byId.get(id);
      if (c) expect(onGrid(c), id).toBe(true);
    }
    expect(soft.filter((c) => c.expected_borderline).length).toBeGreaterThanOrEqual(3);
  });

  it('through the whole TV flow (quiet check, calibration at the fixture margin, phrase window) none comes out reached', async () => {
    let sent = 0;
    for (const c of soft) {
      expect(onGrid(c), `${c.id} must be wire-transmittable`).toBe(true);
      const h = new Harness({ settings: { onboarded: true } });
      await h.boot();
      h.floor = c.session_floor_dbfs;
      h.startAndPair();
      h.runQuiet();
      h.runCalibration(c.cal_margin_db);
      expect(h.view.result?.label, c.id).toBe("Today's band is set");
      h.toPhrases();
      h.beginAndLead('begin_phrase');
      h.answerPrecheck();
      expect(h.view.stage, c.id).toBe('phrase_active');
      h.answerWindowWith(c.expected_window as unknown as Record<string, unknown>);
      expect(h.view.stage, c.id).toBe('reveal');
      expect(h.view.result?.label, c.id).toBe("Below today's relative level band (unqualified phone)");
      expect(h.view.result?.tone, c.id).toBe('below');
      expect(h.view.result?.borderline, c.id).toBe(c.expected_borderline);
      h.ui('finish_early');
      expect(h.view.summary, c.id).toMatchObject({ scoredVisible: 1, reachedVisible: 0 });
      sent += 1;
    }
    expect(sent).toBe(20);
    expect(sent).toBe(soft.length);
  });
});

interface QuietCase {
  id: string;
  expected: PrecheckResultPayload;
}

describe('fixtures/dsp/quiet-check.json versus the TV re-validation (docs/MEASUREMENT.md)', () => {
  const cases = load<{ cases: (QuietCase & { purpose: string })[] }>('quiet-check.json').cases.map((c) => ({
    id: c.id,
    expected: (c as unknown as { expected_summary?: PrecheckResultPayload }).expected_summary ?? c.expected,
    raw: c as unknown as Record<string, unknown>,
  }));

  it('the fixture file has the expected shape', () => {
    // the file has grown with the DSP rework: derive the size from the file, require at least the original 22
    expect(cases.length).toBeGreaterThanOrEqual(22);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.expected, c.id).toBeTruthy();
      expect(['quiet_check', 'pre_window'], c.id).toContain(c.expected.purpose);
      expect(typeof c.expected.valid, c.id).toBe('boolean');
    }
  });

  it('a phone that wrongly reports valid is overruled by the TV with the same reason as the fixture', () => {
    for (const c of cases) {
      const flipped: PrecheckResultPayload = { ...c.expected, valid: true, invalid_reason: null };
      if (c.expected.purpose === 'quiet_check') {
        const v = evaluateQuietCheck(flipped);
        if (c.expected.valid) expect(v.ok, c.id).toBe(true);
        else expect(v, c.id).toEqual({ ok: false, reason: c.expected.invalid_reason });
      } else {
        // pre-window scope: coverage, clipping, burst and non-finite only (no stable or loud-room rule)
        const sessionFloor = c.expected.floor_dbfs ?? -50;
        const g = evaluateGate(flipped, sessionFloor, 20);
        if (c.expected.valid) expect(g.pass, c.id).toBe(true);
        else expect(g, c.id).toMatchObject({ pass: false, reason: c.expected.invalid_reason });
      }
    }
  });

  it('a phone-reported invalid result keeps the phone reason', () => {
    for (const c of cases) {
      if (c.expected.purpose !== 'quiet_check' || c.expected.valid) continue;
      expect(evaluateQuietCheck(c.expected), c.id).toEqual({ ok: false, reason: c.expected.invalid_reason });
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  CAL_MIN_MARGIN_DB,
  GATE_RISE_MAX_DB,
  GATE_SEPARATION_DB,
  REACHED_TOLERANCE_DB,
  evaluateCalibration,
  evaluateGate,
  evaluateQuietCheck,
  evaluateWindow,
  validateWindowResult,
  BORDERLINE_DB,
  bandEdgeRelDb,
} from '../src/index.js';
import type { PrecheckResultPayload, WindowResultPayload } from '../src/wire.js';

const pre = (o: Partial<PrecheckResultPayload> = {}): PrecheckResultPayload => ({
  purpose: 'pre_window',
  valid: true,
  invalid_reason: null,
  floor_dbfs: -50,
  p20_dbfs: -51,
  p80_dbfs: -49,
  p95_dbfs: -47,
  frame_count: 40,
  expected_frames: 40,
  coverage: 1,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 2000,
  ...o,
});

const win = (p95: number | null, o: Partial<WindowResultPayload> = {}): WindowResultPayload => ({
  kind: 'phrase',
  valid: true,
  invalid_reason: null,
  frame_count: 160,
  expected_frames: 160,
  coverage: 1,
  active_ms: 2000,
  longest_active_ms: 2000,
  segments: 1,
  onset_ms: 100,
  p50_active_dbfs: -40,
  p95_active_dbfs: p95,
  peak_dbfs: -30,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 8000,
  ...o,
});

describe('constants are the ADR-0001 values', () => {
  it('matches the frozen product assumptions', () => {
    expect(CAL_MIN_MARGIN_DB).toBe(13);
    expect(GATE_RISE_MAX_DB).toBe(6);
    expect(GATE_SEPARATION_DB).toBe(10);
    expect(REACHED_TOLERANCE_DB).toBe(1);
    expect(BORDERLINE_DB).toBe(1);
  });
});

describe('calibration acceptance (ADR-0001 section 4)', () => {
  it('accepts a margin of exactly 13.0 dB and rejects 12.99 dB', () => {
    const floor = -50;
    expect(evaluateCalibration(win(-37), floor)).toEqual({ accepted: true, marginDb: 13 });
    expect(evaluateCalibration(win(-37.01), floor)).toMatchObject({ accepted: false, reason: 'too_quiet' });
    expect(evaluateCalibration(win(-36.99), floor)).toMatchObject({ accepted: true });
  });

  it('is robust to floating point noise at the boundary', () => {
    // -32.3 - (-45.3) is 13.000000000000004 in IEEE doubles; -45.3 + 13 - (-45.3) style noise must not reject
    expect(evaluateCalibration(win(-32.3), -45.3)).toMatchObject({ accepted: true });
    for (let i = 0; i < 200; i += 1) {
      const floor = -60 + i * 0.1;
      expect(evaluateCalibration(win(floor + 13), floor)).toMatchObject({ accepted: true });
    }
  });

  it('rejects windows that are invalid, too short, low coverage or without a percentile', () => {
    expect(evaluateCalibration(win(-30, { valid: false, invalid_reason: 'clipped' }), -50)).toEqual({
      accepted: false,
      reason: 'clipped',
      marginDb: null,
    });
    expect(evaluateCalibration(win(-30, { active_ms: 399 }), -50)).toMatchObject({ accepted: false, reason: 'no_voice' });
    expect(evaluateCalibration(win(-30, { active_ms: 400 }), -50)).toMatchObject({ accepted: true });
    expect(evaluateCalibration(win(-30, { coverage: 0.8999 }), -50)).toMatchObject({ accepted: false, reason: 'low_coverage' });
    expect(evaluateCalibration(win(-30, { coverage: 0.9 }), -50)).toMatchObject({ accepted: true });
    expect(evaluateCalibration(win(null), -50)).toMatchObject({ accepted: false, reason: 'nonfinite' });
    expect(evaluateCalibration(win(-30, { valid: false, invalid_reason: null }), -50)).toMatchObject({ reason: 'interrupted' });
  });
});

describe('pre-window gate (ADR-0001 section 5)', () => {
  const floor = -50;

  it('blocks when rise >= 6 dB: 5.99 passes, 6.0 blocks (margin 20)', () => {
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.99, p95_dbfs: floor + 5.99 + 2 }), floor, 20)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 6, p95_dbfs: floor + 8 }), floor, 20)).toMatchObject({
      pass: false,
      reason: 'room_noisier',
      riseDb: 6,
    });
    expect(evaluateGate(pre({ floor_dbfs: floor + 6.01, p95_dbfs: floor + 8 }), floor, 20)).toMatchObject({ pass: false });
  });

  it('blocks when margin - rise < 10: 10 passes, 9.99 blocks', () => {
    // margin 13 -> rise 3 passes (10), rise 3.01 blocks (9.99)
    expect(evaluateGate(pre({ floor_dbfs: floor + 3, p95_dbfs: floor + 5 }), floor, 13)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 3.01, p95_dbfs: floor + 5 }), floor, 13)).toMatchObject({
      pass: false,
      reason: 'room_noisier',
    });
    // margin 15.5 -> rise 5.5 gives exactly 10 and passes; 5.51 blocks
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.5, p95_dbfs: floor + 7 }), floor, 15.5)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.51, p95_dbfs: floor + 7 }), floor, 15.5)).toMatchObject({ pass: false });
  });

  it('coherence property: any accepted margin (>= 13) with rise <= 3 never blocks (grid)', () => {
    let checked = 0;
    for (let margin = 13; margin <= 45; margin += 0.25) {
      for (let rise = -12; rise <= 3; rise += 0.25) {
        const v = evaluateGate(pre({ floor_dbfs: floor + rise, p95_dbfs: floor + rise + 4 }), floor, margin);
        expect(v, `margin ${margin} rise ${rise}`).toMatchObject({ pass: true });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('and the rule is not vacuous: margin 13 with rise 4 is blocked', () => {
    expect(evaluateGate(pre({ floor_dbfs: floor + 4, p95_dbfs: floor + 6 }), floor, 13)).toMatchObject({ pass: false });
  });

  it('blocks an invalid precheck: coverage, clipping, non-finite and the burst rule p95 - floor > 10', () => {
    expect(evaluateGate(pre({ coverage: 0.899 }), floor, 20)).toMatchObject({ pass: false, reason: 'low_coverage' });
    expect(evaluateGate(pre({ clipped_frames: 1 }), floor, 20)).toMatchObject({ pass: false, reason: 'clipped' });
    expect(evaluateGate(pre({ floor_dbfs: null }), floor, 20)).toMatchObject({ pass: false, reason: 'nonfinite' });
    expect(evaluateGate(pre({ p95_dbfs: null }), floor, 20)).toMatchObject({ pass: false, reason: 'nonfinite' });
    expect(evaluateGate(pre({ floor_dbfs: floor, p95_dbfs: floor + 10 }), floor, 20)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor, p95_dbfs: floor + 10.01 }), floor, 20)).toMatchObject({
      pass: false,
      reason: 'burst_noise',
    });
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'interrupted' }), floor, 20)).toMatchObject({
      pass: false,
      reason: 'interrupted',
    });
    expect(evaluateGate(pre({ valid: false }), floor, 20)).toMatchObject({ pass: false, reason: 'interrupted' });
  });

  it('with no band only the rise and validity rules apply', () => {
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.99, p95_dbfs: floor + 7 }), floor, null)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 6, p95_dbfs: floor + 7 }), floor, null)).toMatchObject({ pass: false });
  });
});

describe('reached rule and borderline (ADR-0001 section 8)', () => {
  const floor = -50;
  const margin = 20; // band edge at 19 dB above the floor

  it('reached when window_rel_p95 >= cal_margin - 1', () => {
    expect(bandEdgeRelDb(margin)).toBe(19);
    expect(bandEdgeRelDb(null)).toBeNull();
    expect(evaluateWindow('phrase', win(floor + 19), floor, margin)).toMatchObject({ kind: 'scored', reached: true });
    expect(evaluateWindow('phrase', win(floor + 18.999), floor, margin)).toMatchObject({ kind: 'scored', reached: false });
    expect(evaluateWindow('phrase', win(floor + 19.001), floor, margin)).toMatchObject({ reached: true });
  });

  it('does not let floating point noise flip the edge', () => {
    for (let i = 0; i < 300; i += 1) {
      const f = -70 + i * 0.07;
      const v = evaluateWindow('phrase', win(f + 19), f, margin);
      expect(v).toMatchObject({ kind: 'scored', reached: true });
    }
  });

  it('borderline when within 1 dB of the edge (strict), and the verdict is kept', () => {
    expect(evaluateWindow('phrase', win(floor + 19.99), floor, margin)).toMatchObject({ reached: true, borderline: true });
    expect(evaluateWindow('phrase', win(floor + 20), floor, margin)).toMatchObject({ reached: true, borderline: false });
    expect(evaluateWindow('phrase', win(floor + 18.01), floor, margin)).toMatchObject({ reached: false, borderline: true });
    expect(evaluateWindow('phrase', win(floor + 18), floor, margin)).toMatchObject({ reached: false, borderline: false });
    expect(evaluateWindow('phrase', win(floor + 19), floor, margin)).toMatchObject({ reached: true, borderline: true });
    expect(evaluateWindow('phrase', win(floor + 40), floor, margin)).toMatchObject({ reached: true, borderline: false });
    expect(evaluateWindow('phrase', win(floor + 0), floor, margin)).toMatchObject({ reached: false, borderline: false });
  });

  it('invalid windows are unscored with their reason; no band is reported as no_band', () => {
    expect(evaluateWindow('phrase', win(-30, { valid: false, invalid_reason: 'continuous_sound' }), floor, margin)).toEqual({
      kind: 'invalid',
      reason: 'continuous_sound',
    });
    expect(evaluateWindow('phrase', win(-30), floor, null)).toEqual({ kind: 'no_band' });
    expect(evaluateWindow('phrase', win(-30, { active_ms: 100 }), floor, margin)).toEqual({ kind: 'invalid', reason: 'no_voice' });
  });

  it('the vowel is valid with any positive voice-activity duration and uses the same band rule', () => {
    expect(validateWindowResult('vowel', win(-30, { kind: 'vowel', active_ms: 100, longest_active_ms: 100 }))).toEqual({ valid: true });
    expect(validateWindowResult('vowel', win(-30, { kind: 'vowel', active_ms: 0, longest_active_ms: 0 }))).toEqual({
      valid: false,
      reason: 'no_voice',
    });
    expect(evaluateWindow('vowel', win(floor + 25, { kind: 'vowel' }), floor, margin)).toMatchObject({ reached: true });
  });
});

describe('quiet-check re-validation (ADR-0001 section 2)', () => {
  const q = (o: Partial<PrecheckResultPayload> = {}) =>
    evaluateQuietCheck(pre({ purpose: 'quiet_check', floor_dbfs: -50, p20_dbfs: -51, p80_dbfs: -49, p95_dbfs: -47, ...o }));

  it('accepts the exact limits', () => {
    expect(q({ coverage: 0.9 })).toMatchObject({ ok: true });
    expect(q({ p20_dbfs: -51, p80_dbfs: -45 })).toMatchObject({ ok: true }); // 6 dB
    expect(q({ floor_dbfs: -50, p95_dbfs: -40 })).toMatchObject({ ok: true }); // 10 dB
    expect(q({ floor_dbfs: -30, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).toMatchObject({ ok: true });
  });

  it('rejects just past each limit with the matching reason', () => {
    expect(q({ coverage: 0.8999 })).toEqual({ ok: false, reason: 'low_coverage' });
    expect(q({ clipped_frames: 1 })).toEqual({ ok: false, reason: 'clipped' });
    expect(q({ p20_dbfs: -51, p80_dbfs: -44.99 })).toEqual({ ok: false, reason: 'unstable_floor' });
    expect(q({ p95_dbfs: -39.99 })).toEqual({ ok: false, reason: 'burst_noise' });
    expect(q({ floor_dbfs: -29.99, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).toEqual({ ok: false, reason: 'too_loud' });
    expect(q({ floor_dbfs: null })).toEqual({ ok: false, reason: 'nonfinite' });
    expect(q({ p20_dbfs: null })).toEqual({ ok: false, reason: 'nonfinite' });
    expect(q({ valid: false, invalid_reason: 'unstable_floor' })).toEqual({ ok: false, reason: 'unstable_floor' });
    expect(q({ valid: false, invalid_reason: null })).toEqual({ ok: false, reason: 'interrupted' });
  });

  it('returns the statistics it accepted', () => {
    expect(q()).toEqual({ ok: true, floorDbfs: -50, p20Dbfs: -51, p80Dbfs: -49, p95Dbfs: -47 });
  });
});

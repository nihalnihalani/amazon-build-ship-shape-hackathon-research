import { describe, expect, it } from 'vitest';
import {
  BORDERLINE_DB,
  CAL_MIN_MARGIN_DB,
  GATE_RISE_MAX_DB,
  GATE_SEPARATION_DB,
  REACHED_TOLERANCE_DB,
  bandEdgeRelDb,
  evaluateCalibration,
  evaluateGate,
  evaluateQuietCheck,
  evaluateWindow,
  validateWindowResult,
} from '../src/index.js';
import { maxDurationFor, maxTolerableRiseDb, precheckIntegrityOk, windowIntegrityOk } from '../src/verdict.js';
import type { PrecheckResultPayload, WindowResultPayload } from '../src/wire.js';

/** A consistent pre-window aggregate: percentiles follow the floor unless overridden; frame_count follows coverage. */
const pre = (o: Partial<PrecheckResultPayload> = {}): PrecheckResultPayload => {
  const floor = o.floor_dbfs === undefined ? -50 : o.floor_dbfs;
  const purpose = o.purpose ?? 'pre_window';
  const expected = purpose === 'quiet_check' ? 100 : 40;
  const coverage = o.coverage ?? 1;
  return {
    purpose,
    valid: true,
    invalid_reason: null,
    floor_dbfs: floor,
    p20_dbfs: floor === null ? null : floor - 1,
    p80_dbfs: floor === null ? null : floor + 1,
    p95_dbfs: floor === null ? null : floor + 3,
    // frames received = finite frames + non-finite frames, so coverage = finite / expected stays consistent
    frame_count: Math.round(coverage * expected) + (o.nonfinite_frames ?? 0),
    expected_frames: expected,
    coverage,
    clipped_frames: 0,
    nonfinite_frames: 0,
    duration_ms: purpose === 'quiet_check' ? 5000 : 2000,
    ...o,
  };
};

const quiet = (o: Partial<PrecheckResultPayload> = {}) => pre({ purpose: 'quiet_check', ...o });

/** A consistent window summary: p50 <= p95 <= peak, longest <= active, frame_count follows coverage. */
const win = (p95: number | null, o: Partial<WindowResultPayload> = {}): WindowResultPayload => {
  const active = o.active_ms ?? 2000;
  const duration = o.duration_ms ?? 8000;
  const expected = Math.floor(duration / 50);
  const coverage = o.coverage ?? 1;
  return {
    kind: 'phrase',
    valid: true,
    invalid_reason: null,
    frame_count: Math.round(coverage * expected) + (o.nonfinite_frames ?? 0),
    expected_frames: expected,
    coverage,
    active_ms: active,
    longest_active_ms: o.longest_active_ms ?? active,
    segments: active === 0 ? 0 : 1,
    onset_ms: active === 0 ? null : 100,
    p50_active_dbfs: p95 === null ? null : Math.min(-40, p95 - 1),
    p95_active_dbfs: p95,
    peak_dbfs: p95 === null ? null : Math.max(-30, p95 + 2),
    clipped_frames: 0,
    nonfinite_frames: 0,
    duration_ms: duration,
    ...o,
  };
};

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
    expect(evaluateCalibration(win(-37, { kind: 'calibration', duration_ms: 6000 }), floor)).toEqual({ accepted: true, marginDb: 13 });
    expect(evaluateCalibration(win(-37.01, { kind: 'calibration', duration_ms: 6000 }), floor)).toMatchObject({ accepted: false, reason: 'too_quiet' });
    expect(evaluateCalibration(win(-36.99, { kind: 'calibration', duration_ms: 6000 }), floor)).toMatchObject({ accepted: true });
  });

  it('is robust to floating point noise at the boundary', () => {
    // -32.3 - (-45.3) is 13.000000000000004 in IEEE doubles
    expect(evaluateCalibration(win(-32.3, { duration_ms: 6000 }), -45.3)).toMatchObject({ accepted: true });
    for (let i = 0; i < 200; i += 1) {
      const floor = -60 + i * 0.1;
      expect(evaluateCalibration(win(floor + 13, { duration_ms: 6000 }), floor)).toMatchObject({ accepted: true });
    }
  });

  it('rejects windows that are invalid, too short, or inconsistent', () => {
    const c = (o: Partial<WindowResultPayload>, p95: number | null = -30) => evaluateCalibration(win(p95, { duration_ms: 6000, ...o }), -50);
    expect(c({ valid: false, invalid_reason: 'clipped' })).toEqual({ accepted: false, reason: 'clipped', marginDb: null });
    expect(c({ valid: false, invalid_reason: null })).toMatchObject({ reason: 'interrupted' });
    // calibration keeps active_ms < 400 as no_voice (A1-04)
    expect(c({ active_ms: 399 })).toMatchObject({ accepted: false, reason: 'no_voice' });
    expect(c({ active_ms: 400 })).toMatchObject({ accepted: true });
    // a window the phone calls valid with coverage under 0.90, or without a percentile, is an integrity failure
    expect(c({ coverage: 0.85 })).toMatchObject({ accepted: false, reason: 'integrity' });
    expect(c({ coverage: 0.9 })).toMatchObject({ accepted: true });
    expect(c({}, null)).toMatchObject({ accepted: false, reason: 'integrity' });
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
    expect(evaluateGate(pre({ floor_dbfs: floor + 3, p95_dbfs: floor + 5 }), floor, 13)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 3.01, p95_dbfs: floor + 5 }), floor, 13)).toMatchObject({
      pass: false,
      reason: 'room_noisier',
    });
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.5, p95_dbfs: floor + 7 }), floor, 15.5)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.51, p95_dbfs: floor + 7 }), floor, 15.5)).toMatchObject({ pass: false });
  });

  it('coherence: any accepted margin (>= 13) with rise <= 3 never blocks on the two margin inequalities (grid)', () => {
    let checked = 0;
    for (let margin = 13; margin <= 45; margin += 0.25) {
      for (let rise = -12; rise <= 3; rise += 0.25) {
        const v = evaluateGate(pre({ floor_dbfs: floor + rise, p95_dbfs: floor + rise + 4 }), floor, margin);
        expect(v, `margin ${margin} rise ${rise}`).toMatchObject({ pass: true });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2000);
    expect(evaluateGate(pre({ floor_dbfs: floor + 4, p95_dbfs: floor + 6 }), floor, 13)).toMatchObject({ pass: false });
  });

  it('with no band only the rise and validity rules apply', () => {
    expect(evaluateGate(pre({ floor_dbfs: floor + 5.99, p95_dbfs: floor + 7 }), floor, null)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor + 6, p95_dbfs: floor + 7 }), floor, null)).toMatchObject({ pass: false });
  });

  it('the pre-window reason set is interrupted, nonfinite, low_coverage, silent_input, clipped, burst_noise (A1-06)', () => {
    // 35 of 40 frames: coverage 0.875
    expect(evaluateGate(pre({ coverage: 0.875 }), floor, 20)).toMatchObject({ pass: false, reason: 'low_coverage' });
    expect(evaluateGate(pre({ clipped_frames: 1 }), floor, 20)).toMatchObject({ pass: false, reason: 'clipped' });
    expect(evaluateGate(pre({ p95_dbfs: null }), floor, 20)).toMatchObject({ pass: false, reason: 'nonfinite' });
    expect(evaluateGate(pre({ floor_dbfs: floor, p95_dbfs: floor + 10 }), floor, 20)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ floor_dbfs: floor, p95_dbfs: floor + 10.01 }), floor, 20)).toMatchObject({ pass: false, reason: 'burst_noise' });
    expect(evaluateGate(pre({ nonfinite_frames: 3, coverage: 0.925 }), floor, 20)).toMatchObject({ pass: false, reason: 'nonfinite' });
    expect(evaluateGate(pre({ nonfinite_frames: 2, coverage: 0.95 }), floor, 20)).toMatchObject({ pass: true }); // exactly 5 %
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'interrupted' }), floor, 20)).toMatchObject({ pass: false, reason: 'interrupted' });
    expect(evaluateGate(pre({ valid: false }), floor, 20)).toMatchObject({ pass: false, reason: 'interrupted' });
    // a muted or blocked microphone (A1-05); the session floor itself is not the pre-window floor
    expect(evaluateGate(pre({ floor_dbfs: -110.1, p95_dbfs: -108 }), -110.1, 20)).toMatchObject({ pass: false, reason: 'silent_input' });
    expect(evaluateGate(pre({ floor_dbfs: -110, p95_dbfs: -108 }), -110, null)).toMatchObject({ pass: true });
    // unstable_floor and too_loud do not apply to the pre-window precheck: a loud, unstable room is valid here
    expect(evaluateGate(pre({ floor_dbfs: -24, p20_dbfs: -28, p80_dbfs: -20, p95_dbfs: -16 }), -24, null)).toMatchObject({ pass: true });
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'unstable_floor' }), floor, 20)).toMatchObject({ pass: false, reason: 'integrity' });
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'too_loud' }), floor, 20)).toMatchObject({ pass: false, reason: 'integrity' });
  });

  it('reason priority: nonfinite first, then low_coverage, silent_input, clipped, burst_noise', () => {
    const all = pre({
      floor_dbfs: -120,
      p20_dbfs: -121,
      p80_dbfs: -119,
      p95_dbfs: -100,
      clipped_frames: 2,
      nonfinite_frames: 6,
      coverage: 0.85,
      frame_count: 40,
    });
    expect(evaluateGate(all, -120, 20)).toMatchObject({ reason: 'nonfinite' });
    const noNonFinite = { ...all, nonfinite_frames: 0, coverage: 0.85, frame_count: 34 };
    expect(evaluateGate(noNonFinite, -120, 20)).toMatchObject({ reason: 'low_coverage' });
    expect(evaluateGate({ ...noNonFinite, coverage: 1, frame_count: 40 }, -120, 20)).toMatchObject({ reason: 'silent_input' });
    expect(evaluateGate({ ...noNonFinite, coverage: 1, frame_count: 40, floor_dbfs: -50, p20_dbfs: -51, p80_dbfs: -49, p95_dbfs: -30 }, -50, 20)).toMatchObject({ reason: 'clipped' });
    expect(evaluateGate({ ...noNonFinite, coverage: 1, frame_count: 40, clipped_frames: 0, floor_dbfs: -50, p20_dbfs: -51, p80_dbfs: -49, p95_dbfs: -30 }, -50, 20)).toMatchObject({ reason: 'burst_noise' });
  });

  it('a phone claim that disagrees with the numbers is integrity, never a verdict', () => {
    // invalid claimed but the numbers are fine
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'clipped' }), floor, 20)).toMatchObject({ pass: false, reason: 'integrity' });
    // invalid claimed with a reason the numbers do not give
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'low_coverage', clipped_frames: 2 }), floor, 20)).toMatchObject({ reason: 'integrity' });
    // invalid claimed with the reason the numbers give
    expect(evaluateGate(pre({ valid: false, invalid_reason: 'clipped', clipped_frames: 2 }), floor, 20)).toMatchObject({ reason: 'clipped' });
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
      expect(evaluateWindow('phrase', win(f + 19), f, margin)).toMatchObject({ kind: 'scored', reached: true });
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
  });

  it('a phrase with a short but accepted segment is valid (A1-04: no_voice means no accepted segment)', () => {
    expect(evaluateWindow('phrase', win(floor + 25, { active_ms: 399 }), floor, margin)).toMatchObject({ kind: 'scored', reached: true });
    expect(evaluateWindow('phrase', win(floor + 25, { active_ms: 200 }), floor, margin)).toMatchObject({ kind: 'scored' });
    // valid claimed with no activity at all: no accepted segment, so no voice
    expect(evaluateWindow('phrase', win(floor + 25, { active_ms: 0 }), floor, margin)).toEqual({ kind: 'invalid', reason: 'no_voice' });
    // the phone reports no accepted segment as no_voice
    expect(evaluateWindow('phrase', win(null, { valid: false, invalid_reason: 'no_voice', active_ms: 0 }), floor, margin)).toEqual({
      kind: 'invalid',
      reason: 'no_voice',
    });
  });

  it('the vowel is valid with any positive voice-activity duration and uses the same band rule', () => {
    expect(validateWindowResult('vowel', win(-30, { kind: 'vowel', active_ms: 100, duration_ms: 12000 }))).toEqual({ valid: true });
    expect(validateWindowResult('vowel', win(-30, { kind: 'vowel', active_ms: 0, duration_ms: 12000 }))).toEqual({
      valid: false,
      reason: 'no_voice',
    });
    expect(evaluateWindow('vowel', win(floor + 25, { kind: 'vowel', duration_ms: 12000 }), floor, margin)).toMatchObject({ reached: true });
  });
});

describe('quiet-check re-validation (ADR-0001 section 2, A1-05/06/07)', () => {
  const q = (o: Partial<PrecheckResultPayload> = {}) => evaluateQuietCheck(quiet(o));

  it('accepts the exact limits', () => {
    expect(q({ coverage: 0.9 })).toMatchObject({ ok: true });
    expect(q({ p20_dbfs: -51, p80_dbfs: -45, p95_dbfs: -45 })).toMatchObject({ ok: true }); // 6 dB stable
    expect(q({ p95_dbfs: -40 })).toMatchObject({ ok: true }); // 10 dB burst
    expect(q({ floor_dbfs: -30, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).toMatchObject({ ok: true });
    expect(q({ floor_dbfs: -110, p20_dbfs: -111, p80_dbfs: -109, p95_dbfs: -107 })).toMatchObject({ ok: true }); // exactly -110
    expect(q({ nonfinite_frames: 5, coverage: 0.95 })).toMatchObject({ ok: true }); // exactly 5 %
  });

  it('rejects just past each limit with the matching reason', () => {
    expect(q({ coverage: 0.89 })).toEqual({ ok: false, reason: 'low_coverage' });
    expect(q({ clipped_frames: 1 })).toEqual({ ok: false, reason: 'clipped' });
    expect(q({ p20_dbfs: -51, p80_dbfs: -44.99, p95_dbfs: -44.99 })).toEqual({ ok: false, reason: 'unstable_floor' });
    expect(q({ p95_dbfs: -39.99 })).toEqual({ ok: false, reason: 'burst_noise' });
    expect(q({ floor_dbfs: -29.99, p20_dbfs: -31, p80_dbfs: -29, p95_dbfs: -27 })).toEqual({ ok: false, reason: 'too_loud' });
    expect(q({ floor_dbfs: -110.01, p20_dbfs: -111, p80_dbfs: -109, p95_dbfs: -107 })).toEqual({ ok: false, reason: 'silent_input' });
    expect(q({ nonfinite_frames: 6, coverage: 0.94 })).toEqual({ ok: false, reason: 'nonfinite' });
    expect(q({ p20_dbfs: null })).toEqual({ ok: false, reason: 'nonfinite' });
    expect(q({ valid: false, invalid_reason: null })).toEqual({ ok: false, reason: 'interrupted' });
    expect(q({ valid: false, invalid_reason: 'interrupted' })).toEqual({ ok: false, reason: 'interrupted' });
  });

  it('A1-07 priority: nonfinite > low_coverage > silent_input > clipped > unstable_floor > burst_noise > too_loud', () => {
    const base = {
      floor_dbfs: -20,
      p20_dbfs: -30,
      p80_dbfs: -10,
      p95_dbfs: 5,
      clipped_frames: 3,
      nonfinite_frames: 20,
      coverage: 0.75,
      frame_count: 95,
    } satisfies Partial<PrecheckResultPayload>;
    // 20 of 95 frames are non-finite: 21 %: nonfinite wins over everything
    expect(q(base)).toEqual({ ok: false, reason: 'nonfinite' });
    const noNf = { ...base, nonfinite_frames: 0, frame_count: 75 };
    expect(q(noNf)).toEqual({ ok: false, reason: 'low_coverage' });
    const covered = { ...noNf, coverage: 1, frame_count: 100 };
    expect(q({ ...covered, floor_dbfs: -112, p20_dbfs: -114, p80_dbfs: -110, p95_dbfs: -100 })).toEqual({ ok: false, reason: 'silent_input' });
    expect(q(covered)).toEqual({ ok: false, reason: 'clipped' });
    const unclipped = { ...covered, clipped_frames: 0 };
    expect(q(unclipped)).toEqual({ ok: false, reason: 'unstable_floor' });
    expect(q({ ...unclipped, p20_dbfs: -22, p80_dbfs: -18 })).toEqual({ ok: false, reason: 'burst_noise' });
    expect(q({ ...unclipped, p20_dbfs: -22, p80_dbfs: -18, p95_dbfs: -15 })).toEqual({ ok: false, reason: 'too_loud' });
  });

  it('the phone claim must agree with the numbers (integrity otherwise)', () => {
    expect(q({ valid: false, invalid_reason: 'unstable_floor' })).toEqual({ ok: false, reason: 'integrity' }); // numbers are stable
    expect(q({ valid: false, invalid_reason: 'too_loud', floor_dbfs: -20, p20_dbfs: -21, p80_dbfs: -19, p95_dbfs: -17 })).toEqual({ ok: false, reason: 'too_loud' });
    expect(q({ valid: false, invalid_reason: 'burst_noise', floor_dbfs: -20, p20_dbfs: -21, p80_dbfs: -19, p95_dbfs: -17 })).toEqual({
      ok: false,
      reason: 'integrity',
    });
    // valid claimed without a floor
    expect(q({ floor_dbfs: null })).toEqual({ ok: false, reason: 'integrity' });
  });

  it('returns the statistics it accepted', () => {
    expect(q()).toEqual({ ok: true, floorDbfs: -50, p20Dbfs: -51, p80Dbfs: -49, p95Dbfs: -47 });
  });
});

describe('integrity checks (A1-09, PK-02)', () => {
  it('a consistent window passes and each broken invariant fails', () => {
    const ok = win(-30);
    expect(windowIntegrityOk(ok, 8000)).toBe(true);
    const bad: [string, Partial<WindowResultPayload>][] = [
      ['frame_count above expected + 1', { frame_count: 162 }],
      ['nonfinite above frame_count', { nonfinite_frames: 161, frame_count: 160 }],
      ['clipped above frame_count', { clipped_frames: 161 }],
      ['coverage disagrees with the counts', { coverage: 0.5 }],
      ['expected_frames far from duration', { expected_frames: 100 }],
      ['active above duration', { active_ms: 9000, longest_active_ms: 9000 }],
      ['longest above active', { longest_active_ms: 2500 }],
      ['segments 0 with activity', { segments: 0 }],
      ['onset null with activity', { onset_ms: null }],
      ['onset after the window', { onset_ms: 9000 }],
      ['p50 above p95', { p50_active_dbfs: -20 }],
      ['p95 above peak', { peak_dbfs: -35 }],
      ['valid without percentiles', { p50_active_dbfs: null }],
      ['duration longer than commanded plus 500 ms', { duration_ms: 8501, expected_frames: 170, frame_count: 170 }],
    ];
    for (const [name, patch] of bad) expect(windowIntegrityOk({ ...ok, ...patch }, 8000), name).toBe(false);
    // timing slack: exactly commanded + 500 ms is accepted
    expect(windowIntegrityOk(win(-30, { duration_ms: 8500 }), 8000)).toBe(true);
    // an invalid window with no statistics is consistent
    expect(windowIntegrityOk(win(null, { valid: false, invalid_reason: 'no_voice', active_ms: 0 }), 8000)).toBe(true);
    expect(maxDurationFor('calibration')).toBe(6000);
    expect(maxDurationFor('phrase')).toBe(8000);
    expect(maxDurationFor('vowel')).toBe(30000);
  });

  it('a window past its commanded duration is unscored with the TV-local reason integrity', () => {
    expect(validateWindowResult('phrase', win(-30, { duration_ms: 8501 }))).toEqual({ valid: false, reason: 'integrity' });
    expect(validateWindowResult('calibration', win(-30, { duration_ms: 6501 }))).toEqual({ valid: false, reason: 'integrity' });
    expect(validateWindowResult('calibration', win(-30, { duration_ms: 6500 }))).toEqual({ valid: true });
    expect(validateWindowResult('vowel', win(-30, { duration_ms: 30500, active_ms: 29000 }))).toEqual({ valid: true });
  });

  it('prechecks: percentile order, counts, duration scope and reason scope', () => {
    expect(precheckIntegrityOk(quiet(), 'quiet_check')).toBe(true);
    expect(precheckIntegrityOk(pre(), 'pre_window')).toBe(true);
    expect(precheckIntegrityOk(pre(), 'quiet_check')).toBe(false); // wrong purpose for this window
    expect(precheckIntegrityOk(quiet({ p20_dbfs: -40 }), 'quiet_check')).toBe(false); // p20 above floor
    expect(precheckIntegrityOk(quiet({ p80_dbfs: -52 }), 'quiet_check')).toBe(false); // p80 below floor
    expect(precheckIntegrityOk(quiet({ p95_dbfs: -50.5 }), 'quiet_check')).toBe(false); // p95 below p80
    expect(precheckIntegrityOk(quiet({ duration_ms: 5051 }), 'quiet_check')).toBe(false);
    expect(precheckIntegrityOk(quiet({ duration_ms: 5050 }), 'quiet_check')).toBe(true);
    expect(precheckIntegrityOk(pre({ duration_ms: 2051 }), 'pre_window')).toBe(false);
    expect(precheckIntegrityOk(quiet({ frame_count: 102 }), 'quiet_check')).toBe(false);
    expect(precheckIntegrityOk(quiet({ coverage: 0.5, frame_count: 100 }), 'quiet_check')).toBe(false);
    expect(precheckIntegrityOk(quiet({ clipped_frames: 101 }), 'quiet_check')).toBe(false);
    expect(precheckIntegrityOk(quiet({ expected_frames: 50 }), 'quiet_check')).toBe(false);
    expect(precheckIntegrityOk(pre({ valid: false, invalid_reason: 'too_loud' }), 'pre_window')).toBe(false);
    expect(precheckIntegrityOk(quiet({ floor_dbfs: null, p20_dbfs: null, p80_dbfs: null, p95_dbfs: null }), 'quiet_check')).toBe(false);
  });

  it('an inconsistent precheck is integrity for the quiet check and for the gate', () => {
    expect(evaluateQuietCheck(quiet({ p20_dbfs: -40 }))).toEqual({ ok: false, reason: 'integrity' });
    expect(evaluateGate(pre({ duration_ms: 3000 }), -50, 20)).toMatchObject({ pass: false, reason: 'integrity' });
  });

  it('the maximum tolerated floor rise follows the margin', () => {
    expect(maxTolerableRiseDb(20)).toEqual({ limitDb: 6, inclusive: false }); // less than 6.0 dB
    expect(maxTolerableRiseDb(16)).toEqual({ limitDb: 6, inclusive: false });
    expect(maxTolerableRiseDb(15)).toEqual({ limitDb: 5, inclusive: true }); // 5.0 dB or less
    expect(maxTolerableRiseDb(13)).toEqual({ limitDb: 3, inclusive: true });
  });
});

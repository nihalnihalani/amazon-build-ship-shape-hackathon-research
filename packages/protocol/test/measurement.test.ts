/**
 * Revision 4 measurement rules: silent_input and per-purpose reasons, the PK-02 cross-field
 * invariants (window.result, precheck.result, level, window.start) and the PK-06 quantisation.
 */

import { describe, expect, it } from 'vitest';
import {
  PRECHECK_INVALID_REASONS,
  PRE_WINDOW_INVALID_REASONS,
  QUIET_CHECK_INVALID_REASONS,
  VAD_FLOOR_DBFS_MAX,
  VAD_FLOOR_DBFS_MIN,
  WINDOW_INVALID_REASONS,
  parseWireMessage,
  quantizeCoverage,
  quantizeDb,
  validateMessageObject,
} from '../src/index.js';
import type { WireMessage } from '../src/index.js';
import { QUANTIZED_FIELDS } from '../src/payloads.js';
import { NOW, VALID_FIXTURES, fixtureOf } from './fixtures.js';
import type { Json } from './fixtures.js';
import { OPTS, codeOf, expectFail, expectOk, patchedMany } from './helpers.js';

describe('silent_input and per-purpose precheck reasons (A1-05, A1-06)', () => {
  const invalidBase = (reason: string, purpose: 'quiet_check' | 'pre_window'): Json =>
    patchedMany(fixtureOf('precheck.result invalid'), {
      'payload.invalid_reason': reason,
      'payload.purpose': purpose,
      'payload.duration_ms': purpose === 'quiet_check' ? 5000 : 2000,
      'payload.frame_count': purpose === 'quiet_check' ? 100 : 40,
      'payload.expected_frames': purpose === 'quiet_check' ? 100 : 40,
    });

  it('silent_input is a precheck invalid_reason', () => {
    expect([...PRECHECK_INVALID_REASONS]).toContain('silent_input');
    expectOk(fixtureOf('precheck.result silent_input'));
  });

  it('the quiet check allows all eight reasons', () => {
    expect([...QUIET_CHECK_INVALID_REASONS].sort()).toEqual(
      ['burst_noise', 'clipped', 'interrupted', 'low_coverage', 'nonfinite', 'silent_input', 'too_loud', 'unstable_floor'].sort(),
    );
    for (const reason of QUIET_CHECK_INVALID_REASONS) expectOk(invalidBase(reason, 'quiet_check'));
  });

  it('the pre-window check allows exactly interrupted, nonfinite, low_coverage, silent_input, clipped and burst_noise', () => {
    expect([...PRE_WINDOW_INVALID_REASONS].sort()).toEqual(
      ['burst_noise', 'clipped', 'interrupted', 'low_coverage', 'nonfinite', 'silent_input'].sort(),
    );
    for (const reason of PRE_WINDOW_INVALID_REASONS) expectOk(invalidBase(reason, 'pre_window'));
  });

  it('unstable_floor and too_loud are rejected for the pre-window check only', () => {
    for (const reason of ['unstable_floor', 'too_loud']) {
      expectFail(invalidBase(reason, 'pre_window'), 'bad_schema');
      expectOk(invalidBase(reason, 'quiet_check'));
    }
  });

  it('a reason that is not in the list is rejected for both purposes', () => {
    for (const purpose of ['quiet_check', 'pre_window'] as const) {
      expectFail(invalidBase('no_voice', purpose), 'bad_schema');
      expectFail(invalidBase('mic_muted', purpose), 'bad_schema');
    }
  });

  it('silent_input is not a window.result reason (windows keep their own list)', () => {
    expect([...WINDOW_INVALID_REASONS]).not.toContain('silent_input');
    expectFail(patchedMany(fixtureOf('window.result invalid'), { 'payload.invalid_reason': 'silent_input' }), 'bad_schema');
  });
});

describe('window.start vad_floor_dbfs range (A1-10)', () => {
  it('is -110 .. -30', () => {
    expect([VAD_FLOOR_DBFS_MIN, VAD_FLOOR_DBFS_MAX]).toEqual([-110, -30]);
    for (const [v, ok] of [[-110, true], [-30, true], [-70, true], [-110.1, false], [-29.9, false], [0, false], [-140, false], [20, false]] as const) {
      const m = patchedMany(fixtureOf('window.start phrase'), { 'payload.vad_floor_dbfs': v });
      expect(codeOf(m), String(v)).toBe(ok ? 'ok' : 'bad_schema');
    }
  });
});

describe('precheck.result invariants (PK-02)', () => {
  const base = (): Json => fixtureOf('precheck.result'); // quiet_check, valid
  const preBase = (): Json => fixtureOf('precheck.result pre_window');
  const invalidBase = (): Json => fixtureOf('precheck.result invalid');

  it('the valid fixtures satisfy every invariant', () => {
    expectOk(base());
    expectOk(preBase());
    expectOk(invalidBase());
  });

  it('duration_ms is within 50 ms of the commanded duration', () => {
    for (const [d, ok] of [[5000, true], [4950, true], [5050, true], [4949, false], [5051, false], [2000, false], [0, false], [35000, false]] as const) {
      expect(codeOf(patchedMany(base(), { 'payload.duration_ms': d })), `quiet ${d}`).toBe(ok ? 'ok' : 'bad_schema');
    }
    for (const [d, ok] of [[2000, true], [1950, true], [2050, true], [1949, false], [2051, false], [5000, false]] as const) {
      expect(codeOf(patchedMany(preBase(), { 'payload.duration_ms': d })), `pre ${d}`).toBe(ok ? 'ok' : 'bad_schema');
    }
  });

  it('percentiles are ordered p20 <= floor <= p80 <= p95 (non-null entries)', () => {
    const ok = (patch: Record<string, unknown>): string => codeOf(patchedMany(base(), patch));
    expect(ok({})).toBe('ok');
    expect(ok({ 'payload.p20_dbfs': -62.5 })).toBe('ok'); // equal is fine
    expect(ok({ 'payload.p20_dbfs': -62.4 })).toBe('bad_schema'); // p20 above floor
    expect(ok({ 'payload.floor_dbfs': -55.2 })).toBe('bad_schema'); // floor above p80
    expect(ok({ 'payload.p80_dbfs': -49.9 })).toBe('bad_schema'); // p80 above p95
    expect(ok({ 'payload.p80_dbfs': -50 })).toBe('ok');
    // probe P11: p20 (-40) above p80 (-70), floor outside the range
    expect(ok({ 'payload.p20_dbfs': -40, 'payload.p80_dbfs': -70 })).toBe('bad_schema');
  });

  it('percentile ordering skips null entries but still compares the rest', () => {
    const inv = (patch: Record<string, unknown>): string => codeOf(patchedMany(invalidBase(), patch));
    expect(inv({ 'payload.p20_dbfs': -40, 'payload.p95_dbfs': -70 })).toBe('bad_schema');
    expect(inv({ 'payload.p20_dbfs': -70, 'payload.p95_dbfs': -40 })).toBe('ok');
    expect(inv({ 'payload.floor_dbfs': -30, 'payload.p80_dbfs': -50 })).toBe('bad_schema');
  });

  it('valid requires a floor, no clipped frames and coverage >= 0.90', () => {
    expect(codeOf(patchedMany(base(), { 'payload.floor_dbfs': null }))).toBe('bad_schema'); // probe P10
    expect(codeOf(patchedMany(base(), { 'payload.clipped_frames': 1 }))).toBe('bad_schema'); // probe P12
    expect(codeOf(patchedMany(base(), { 'payload.coverage': 0.899 }))).toBe('bad_schema');
    expect(codeOf(patchedMany(base(), { 'payload.coverage': 0.9 }))).toBe('ok');
    expect(codeOf(patchedMany(base(), { 'payload.coverage': 1 }))).toBe('ok');
  });

  it('an invalid precheck may be clipped, quiet or null-statistic', () => {
    expect(codeOf(patchedMany(invalidBase(), { 'payload.clipped_frames': 5, 'payload.invalid_reason': 'clipped' }))).toBe('ok');
    expect(codeOf(patchedMany(invalidBase(), { 'payload.coverage': 0, 'payload.invalid_reason': 'low_coverage' }))).toBe('ok');
  });
});

describe('window.result invariants (PK-02)', () => {
  const base = (): Json => fixtureOf('window.result'); // phrase, valid, 160 frames, 8000 ms
  const invalid = (): Json => fixtureOf('window.result invalid');
  const code = (patch: Record<string, unknown>, from: () => Json = base): string => codeOf(patchedMany(from(), patch));

  it('the valid fixtures satisfy every invariant', () => {
    expect(code({})).toBe('ok');
    expect(code({}, invalid)).toBe('ok');
  });

  it('frame accounting: frame_count <= expected_frames + 1, nonfinite and clipped <= frame_count', () => {
    expect(code({ 'payload.frame_count': 161 })).toBe('ok'); // one frame of slack
    expect(code({ 'payload.frame_count': 162 })).toBe('bad_schema');
    expect(code({ 'payload.frame_count': 700 })).toBe('bad_schema'); // probe P02
    expect(code({ 'payload.nonfinite_frames': 161 })).toBe('bad_schema');
    expect(code({ 'payload.clipped_frames': 161 })).toBe('bad_schema');
    expect(code({ 'payload.clipped_frames': 160 })).toBe('ok'); // not larger than frame_count (validity is the DSP's call)
  });

  it('coverage equals (frame_count - nonfinite_frames) / expected_frames within 0.001, capped at 1', () => {
    expect(code({ 'payload.coverage': 0.999 })).toBe('ok'); // exactly 0.001 off
    expect(code({ 'payload.coverage': 0.998 })).toBe('bad_schema');
    expect(code({ 'payload.coverage': 0.5 })).toBe('bad_schema');
    expect(code({ 'payload.coverage': 0.01 })).toBe('bad_schema'); // probe P01 (valid with coverage 0.01)
    // 8 non-finite frames of 160 -> 0.95
    expect(code({ 'payload.nonfinite_frames': 8, 'payload.coverage': 0.95 })).toBe('ok');
    expect(code({ 'payload.nonfinite_frames': 8, 'payload.coverage': 1 })).toBe('bad_schema');
    // one extra frame: ratio 161/160 is capped at 1
    expect(code({ 'payload.frame_count': 161, 'payload.coverage': 1 })).toBe('ok');
  });

  it('coverage is 0 when expected_frames is 0', () => {
    const zero = { 'payload.expected_frames': 0, 'payload.frame_count': 0, 'payload.duration_ms': 40 };
    expect(code({ ...zero, 'payload.coverage': 0 }, invalid)).toBe('ok');
    expect(code({ ...zero, 'payload.coverage': 1 }, invalid)).toBe('bad_schema');
  });

  it('expected_frames equals floor(duration_ms / 50) within one frame', () => {
    expect(code({ 'payload.expected_frames': 159 })).toBe('ok');
    expect(code({ 'payload.expected_frames': 158 })).toBe('bad_schema');
    expect(code({ 'payload.expected_frames': 161, 'payload.coverage': 0.994 })).toBe('ok');
    expect(code({ 'payload.expected_frames': 162, 'payload.coverage': 0.988 })).toBe('bad_schema');
    expect(code({ 'payload.duration_ms': 100 })).toBe('bad_schema'); // frames for 8 s against a 100 ms window
  });

  it('longest_active_ms <= active_ms <= duration_ms', () => {
    expect(code({ 'payload.longest_active_ms': 3200 })).toBe('ok');
    expect(code({ 'payload.longest_active_ms': 3201 })).toBe('bad_schema'); // probe P04 shape
    expect(code({ 'payload.longest_active_ms': 8000 })).toBe('bad_schema');
    expect(code({ 'payload.active_ms': 8000, 'payload.longest_active_ms': 8000 })).toBe('ok');
    expect(code({ 'payload.active_ms': 8001, 'payload.longest_active_ms': 1800 })).toBe('bad_schema');
    expect(code({ 'payload.active_ms': 35000 })).toBe('bad_schema'); // probe P03
  });

  it('segments = 0 if and only if active_ms = 0 if and only if onset_ms = null', () => {
    expect(code({ 'payload.segments': 0 })).toBe('bad_schema'); // probe P07 shape
    expect(code({ 'payload.onset_ms': null })).toBe('bad_schema');
    const none = { 'payload.active_ms': 0, 'payload.longest_active_ms': 0, 'payload.segments': 0, 'payload.onset_ms': null };
    expect(code(none, invalid)).toBe('ok');
    expect(code({ ...none, 'payload.segments': 1 }, invalid)).toBe('bad_schema');
    expect(code({ ...none, 'payload.onset_ms': 300 }, invalid)).toBe('bad_schema');
    expect(code({ ...none, 'payload.active_ms': 100 }, invalid)).toBe('bad_schema');
  });

  it('onset_ms <= duration_ms', () => {
    expect(code({ 'payload.onset_ms': 8000 })).toBe('ok');
    expect(code({ 'payload.onset_ms': 8001 })).toBe('bad_schema');
  });

  it('valid requires coverage >= 0.90, non-null statistics and p50 <= p95 <= peak', () => {
    expect(code({ 'payload.nonfinite_frames': 24, 'payload.coverage': 0.85 })).toBe('bad_schema'); // consistent but too low
    expect(code({ 'payload.nonfinite_frames': 16, 'payload.coverage': 0.9 })).toBe('ok');
    for (const field of ['p50_active_dbfs', 'p95_active_dbfs', 'peak_dbfs']) {
      expect(code({ [`payload.${field}`]: null }), field).toBe('bad_schema'); // probe P05
    }
    expect(code({ 'payload.p50_active_dbfs': -10 })).toBe('bad_schema'); // p50 above p95 (probe P06)
    expect(code({ 'payload.peak_dbfs': -30 })).toBe('bad_schema'); // peak below p95
    expect(code({ 'payload.p50_active_dbfs': -24 })).toBe('ok'); // equal is fine
    expect(code({ 'payload.peak_dbfs': -24 })).toBe('ok');
  });

  it('an invalid window may carry null statistics and low coverage', () => {
    expect(code({ 'payload.nonfinite_frames': 80, 'payload.coverage': 0.5, 'payload.invalid_reason': 'low_coverage' }, invalid)).toBe('ok');
  });
});

describe('level invariant (PK-02): t_audio_ms >= 50 * frame_index - 1', () => {
  const lv = (frame_index: number, t_audio_ms: number): string =>
    codeOf(patchedMany(fixtureOf('level'), { 'payload.frame_index': frame_index, 'payload.t_audio_ms': t_audio_ms }));
  it('holds at the boundaries', () => {
    expect(lv(0, 0)).toBe('ok');
    expect(lv(1, 49)).toBe('ok');
    expect(lv(1, 48)).toBe('bad_schema');
    expect(lv(12, 599)).toBe('ok');
    expect(lv(12, 598)).toBe('bad_schema');
    expect(lv(700, 34999)).toBe('ok');
    expect(lv(700, 35000)).toBe('ok');
    expect(lv(700, 34998)).toBe('bad_schema');
    expect(lv(0, 35000)).toBe('ok'); // late is fine; early is not
    expect(lv(701, 35000)).toBe('bad_schema');
  });
});

// ---------------------------------------------------------------------------
// Quantisation (PK-06)
// ---------------------------------------------------------------------------

describe('quantizeDb and quantizeCoverage (sender helpers)', () => {
  it('rounds dB to the 0.1 grid and returns the canonical double', () => {
    expect(quantizeDb(-23.14)).toBe(-23.1);
    expect(quantizeDb(-23.16)).toBe(-23.2);
    expect(quantizeDb(-23.099999999999998)).toBe(-23.1);
    expect(quantizeDb(-42.25)).toBe(-42.2); // half rounds toward +infinity
    expect(quantizeDb(0.05)).toBe(0.1);
    expect(quantizeDb(-140)).toBe(-140);
    expect(quantizeDb(-0.30000000000000004)).toBe(-0.3);
    expect(quantizeDb(0.1 * 3)).toBe(0.3);
  });
  it('never returns -0', () => {
    expect(Object.is(quantizeDb(-0.04), 0)).toBe(true);
    expect(Object.is(quantizeDb(-0), 0)).toBe(true);
    expect(Object.is(quantizeCoverage(-0.0004), 0)).toBe(true);
  });
  it('returns non-finite input unchanged so the validator rejects it', () => {
    expect(Number.isNaN(quantizeDb(NaN))).toBe(true);
    expect(quantizeDb(Infinity)).toBe(Infinity);
    expect(quantizeCoverage(-Infinity)).toBe(-Infinity);
  });
  it('rounds coverage to 0.001 and clamps to 0..1', () => {
    expect(quantizeCoverage(0.9994)).toBe(0.999);
    expect(quantizeCoverage(0.9996)).toBe(1);
    expect(quantizeCoverage(1.0004)).toBe(1);
    expect(quantizeCoverage(1.5)).toBe(1);
    expect(quantizeCoverage(-0.2)).toBe(0);
    expect(quantizeCoverage(0.1 + 0.2)).toBe(0.3);
    expect(quantizeCoverage(0.123456)).toBe(0.123);
  });
  it('is idempotent and every grid point is its own canonical double', () => {
    for (let k = -1400; k <= 200; k += 1) {
      const x = k / 10;
      expect(quantizeDb(x), String(x)).toBe(x);
      expect(quantizeDb(quantizeDb(x + 0.04)), String(x)).toBe(quantizeDb(x + 0.04));
    }
    for (let k = 0; k <= 1000; k += 1) {
      const c = k / 1000;
      expect(quantizeCoverage(c), String(c)).toBe(c);
    }
  });
  it('quantised values pass the validators for every dB grid point of the legal range', () => {
    for (let k = -1400; k <= 200; k += 1) {
      const m = patchedMany(fixtureOf('level frame 0'), { 'payload.dbfs': k / 10 });
      expect(codeOf(m), String(k / 10)).toBe('ok');
    }
  });
});

describe('quantisation is enforced (tolerance 1e-6 on x*10, resp. x*1000)', () => {
  const lv = (dbfs: number): Json => patchedMany(fixtureOf('level'), { 'payload.dbfs': dbfs });

  it('rejects dB values that are not multiples of 0.1', () => {
    for (const bad of [-42.25, -42.31, -23.123456789012345, -42.3000011, -42.2999989, 0.05, -139.95]) {
      expect(codeOf(lv(bad)), String(bad)).toBe('bad_schema');
    }
  });

  it('accepts values within the tolerance and returns the canonical grid value (no sub-grid precision survives)', () => {
    for (const noisy of [-42.3 + 9e-8, -42.3 - 9e-8, -42.3 + 4e-8, -(0.1 * 423), -42.30000000000001]) {
      const r = validateMessageObject(lv(noisy), OPTS);
      expect(r.ok, String(noisy)).toBe(true);
      if (r.ok && r.message.type === 'level') expect(Object.is(r.message.payload.dbfs, -42.3), String(noisy)).toBe(true);
    }
  });

  it('forwarded bytes are identical for every in-tolerance variant of the same value', () => {
    const outputs = new Set<string>();
    let seed = 7;
    for (let i = 0; i < 200; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const delta = ((seed / 4294967296) * 2 - 1) * 9e-8; // within 1e-6 / 10
      const r = validateMessageObject(lv(-42.3 + delta), OPTS);
      expect(r.ok).toBe(true);
      if (r.ok) outputs.add(JSON.stringify(r.message));
    }
    expect(outputs.size).toBe(1);
  });

  it('coverage is a multiple of 0.001', () => {
    const win = (coverage: number, nonfinite: number): string =>
      codeOf(patchedMany(fixtureOf('window.result'), { 'payload.coverage': coverage, 'payload.nonfinite_frames': nonfinite }));
    expect(win(0.95, 8)).toBe('ok');
    expect(win(0.9505, 8)).toBe('bad_schema');
    expect(win(0.9500000001, 8)).toBe('ok'); // within tolerance (|x*1000 - round(x*1000)| < 1e-6)
    expect(win(0.9500001, 8)).toBe('bad_schema'); // 1e-7 in x is 1e-4 on the grid scale
    expect(win(0.9505001, 8)).toBe('bad_schema');
    const pre = (coverage: number): string => codeOf(patchedMany(fixtureOf('precheck.result'), { 'payload.coverage': coverage }));
    expect(pre(0.999)).toBe('ok');
    expect(pre(0.9995)).toBe('bad_schema');
    expect(pre(0.12345)).toBe('bad_schema'); // also below the valid minimum, but the grid is checked first
  });

  it('in-tolerance coverage is returned as the canonical value', () => {
    const r = validateMessageObject(patchedMany(fixtureOf('precheck.result'), { 'payload.coverage': 0.9990000001 }), OPTS);
    expect(r.ok).toBe(true);
    if (r.ok && r.message.type === 'precheck.result') expect(Object.is(r.message.payload.coverage, 0.999)).toBe(true);
  });

  it('every dB field of every result type is checked, and every returned dB value is canonical', () => {
    for (const fixture of VALID_FIXTURES) {
      const table = QUANTIZED_FIELDS[fixture.type];
      if (!table) continue;
      for (const [field, kind] of Object.entries(table)) {
        const current = (fixture.message.payload as Record<string, unknown>)[field];
        if (typeof current !== 'number') continue;
        const off = kind === 'db' ? current + 0.05 : current - 0.0005;
        expect(codeOf(patchedMany(fixture.message, { [`payload.${field}`]: off })), `${fixture.name}.${field}`).toBe('bad_schema');
        const r = validateMessageObject(fixture.message, OPTS);
        expect(r.ok).toBe(true);
        if (r.ok) {
          const v = (r.message.payload as unknown as Record<string, number>)[field] as number;
          const scale = kind === 'db' ? 10 : 1000;
          expect(Object.is(v, Math.round(v * scale) / scale), `${fixture.name}.${field}`).toBe(true);
        }
      }
    }
  });

  it('time fields are integers', () => {
    const cases: Array<[string, string, number]> = [
      ['level', 'payload.t_audio_ms', 600.0000001],
      ['precheck.result', 'payload.duration_ms', 5000.5],
      ['window.result', 'payload.duration_ms', 8000.5],
      ['window.result', 'payload.active_ms', 3200.5],
      ['window.result', 'payload.longest_active_ms', 1800.5],
      ['window.result', 'payload.onset_ms', 420.5],
    ];
    for (const [fixture, path, value] of cases) {
      expect(codeOf(patchedMany(fixtureOf(fixture), { [path]: value })), `${fixture} ${path}`).toBe('bad_schema');
    }
    expect(codeOf(patchedMany(fixtureOf('window.result'), { 'payload.onset_ms': 421 }))).toBe('ok');
  });
});

describe('negative zero (PK-05)', () => {
  it('is normalised to 0 in the clean copy for envelope and payload numbers', () => {
    const frame0 = patchedMany(fixtureOf('level frame 0'), { sequence: -0, producer_generation: -0, 'payload.dbfs': -0, 'payload.t_audio_ms': -0 });
    const viaObject = validateMessageObject(frame0, OPTS);
    expect(viaObject.ok).toBe(true);
    if (viaObject.ok && viaObject.message.type === 'level') {
      expect(Object.is(viaObject.message.sequence, 0)).toBe(true);
      expect(Object.is(viaObject.message.producer_generation, 0)).toBe(true);
      expect(Object.is(viaObject.message.payload.dbfs, 0)).toBe(true);
      expect(Object.is(viaObject.message.payload.t_audio_ms, 0)).toBe(true);
    }
  });

  it('JSON text "-0" is normalised too (both entry points)', () => {
    const text = JSON.stringify(fixtureOf('level frame 0')).replace('"dbfs":-140', '"dbfs":-0').replace('"sequence":0', '"sequence":-0');
    expect(text).toContain('-0');
    const r = parseWireMessage(text, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok && r.message.type === 'level') {
      expect(Object.is(r.message.payload.dbfs, 0)).toBe(true);
      expect(Object.is(r.message.sequence, 0)).toBe(true);
      expect(JSON.stringify(r.message)).not.toContain('-0');
    }
  });
});

describe('the message a validator returns', () => {
  it('is typed as the clean copy with canonical numbers (smoke check for every fixture)', () => {
    for (const fixture of VALID_FIXTURES) {
      const r = parseWireMessage(JSON.stringify(fixture.message), { now: NOW });
      expect(r.ok, fixture.name).toBe(true);
      if (r.ok) {
        const message: WireMessage = r.message;
        expect(message.type).toBe(fixture.type);
      }
    }
  });
});

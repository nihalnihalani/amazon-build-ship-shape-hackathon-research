/**
 * T16 gate, part G: independent re-verification of the ADR-0001 rework (A1-01..A1-09) against the shipped
 * `@atr/phone-mic-meter` and the TV recompute in `@atr/session-core`. The inputs are generated here (seeded noise,
 * synthetic bursts, per-frame levels) and the expected values come from the amendments, not from the fixtures the
 * DSP teammate wrote.
 *
 *   SEC-M03 silent-window false activity   SEC-M04 transient phase sweep   SEC-M05 muted input
 *   SEC-V04/M01 TV recompute               A1-06 gate coherence            A1-07 reason priority
 *
 * Evidence class: automated, synthetic. It says nothing about real microphones or real rooms (T04).
 */
import { describe, expect, it } from 'vitest';
import { VoiceActivityTracker, summarizePrecheck, type PrecheckFrame } from '@atr/phone-mic-meter';
import { evaluateGate, evaluateQuietCheck, validateWindowResult, windowIntegrityOk } from '../../packages/session-core/src/verdict.js';

/* ---- deterministic generators ---- */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gaussian(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const SR = 48000;
const FS = 2400; // 50 ms
const FLOOR_RMS = 10 ** (-60 / 20);

function frameLevels(samples: Float32Array): number[] {
  const out: number[] = [];
  for (let f = 0; f + FS <= samples.length; f += FS) {
    let sum = 0;
    for (let i = f; i < f + FS; i += 1) sum += (samples[i] as number) ** 2;
    out.push(20 * Math.log10(Math.max(Math.sqrt(sum / FS), 1e-7)));
  }
  return out;
}

function accepted(levels: number[], floorDbfs: number): number {
  const vad = new VoiceActivityTracker(floorDbfs);
  levels.forEach((dbfs, i) => vad.push({ frameIndex: i, t_audio_ms: i * 50, duration_ms: 50, dbfs, finite: true }));
  return vad.finish().length;
}

describe('A1-01 / SEC-M04: transient sweep at sample level (40 sub-frame phases)', () => {
  const r = rng(2026);
  const calNoise = new Float32Array(SR * 5).map(() => gaussian(r) * FLOOR_RMS);
  const calLevels = frameLevels(calNoise).sort((a, b) => a - b);
  const floor = calLevels[Math.ceil(0.5 * calLevels.length) - 1] as number;

  function burstAccepted(durMs: number, relDb: number, offset: number): boolean {
    const x = new Float32Array(SR * 2).map(() => gaussian(r) * FLOOR_RMS);
    const amp = FLOOR_RMS * 10 ** (relDb / 20);
    const start = Math.round(SR * 0.5) + offset;
    const n = Math.round((durMs / 1000) * SR);
    for (let i = 0; i < n; i += 1) x[start + i] = (x[start + i] as number) + gaussian(r) * amp;
    return accepted(frameLevels(x), floor) > 0;
  }
  const rate = (durMs: number, relDb: number): number => {
    let hit = 0;
    for (let off = 0; off < FS; off += 60) if (burstAccepted(durMs, relDb, off)) hit += 1;
    return hit / 40;
  };

  it('bursts of 100 ms or less are never accepted; 250 ms is always accepted at +10 and +20 dB; 200 ms is always accepted at +20 dB', () => {
    for (const rel of [10, 20, 30]) {
      expect(rate(50, rel), `50 ms at +${rel}`).toBe(0);
      expect(rate(100, rel), `100 ms at +${rel}`).toBe(0);
    }
    for (const rel of [10, 20, 30]) expect(rate(250, rel), `250 ms at +${rel}`).toBe(1);
    expect(rate(200, 20)).toBe(1);
    expect(rate(200, 30)).toBe(1);
    const between = { '125@10': rate(125, 10), '150@10': rate(150, 10), '175@20': rate(175, 20), '200@10': rate(200, 10) };
    console.log('SEC-M04 phase-dependent rates (recorded, not asserted):', JSON.stringify(between));
  });

  it('A1-02: a train of four isolated 50 ms clicks 100 ms apart is not accepted (no run of 3)', () => {
    const levels = new Array<number>(40).fill(-60);
    for (let k = 0; k < 6; k += 1) levels[10 + 2 * k] = -60 + 20; // +20 dB every other frame
    expect(accepted(levels, -60)).toBe(0);
    // while a genuine 200 ms voiced run is
    const voiced = new Array<number>(40).fill(-60);
    for (let k = 0; k < 4; k += 1) voiced[10 + k] = -40;
    expect(accepted(voiced, -60)).toBe(1);
  });
});

describe('A1-03 / SEC-M03: a silent speaker in a room that passed the quiet check', () => {
  function silentWindowAccepted(sigma: number, rho: number, trials: number, seed: number): number {
    const r = rng(seed);
    let hits = 0;
    for (let t = 0; t < trials; t += 1) {
      let z = gaussian(r);
      const levels: number[] = [];
      for (let i = 0; i < 160; i += 1) {
        z = rho * z + Math.sqrt(1 - rho * rho) * gaussian(r);
        levels.push(-70 + sigma * z);
      }
      if (accepted(levels, -70) > 0) hits += 1;
    }
    return hits / trials;
  }
  it('stays under 1 % for modest noise spread and is recorded for the noisiest admissible rooms', () => {
    expect(silentWindowAccepted(1.5, 0.9, 4000, 11)).toBeLessThanOrEqual(0.01);
    expect(silentWindowAccepted(2.0, 0.8, 4000, 12)).toBeLessThanOrEqual(0.01);
    const noisy = [
      [2.5, 0.9],
      [3.0, 0.8],
      [3.5, 0.9],
    ].map(([s, p]) => `${s}/${p}: ${(silentWindowAccepted(s as number, p as number, 4000, 13)).toFixed(3)}`);
    console.log('SEC-M03 P(at least one accepted segment | silent 8 s window), sigma/rho:', noisy.join('  '));
    // A silent window is scored below the band, or unscored, in almost every case. It can still be scored "reached" when
    // the noise opens an accepted segment AND the p95 of that segment's few active frames (p95 of 5 to 10 frames is the
    // maximum) reaches cal_margin - 1 >= 12 dB. That is rare but not zero at the edge of quiet-check validity; the
    // amendment text "never a false reached" is therefore too strong (finding N-05). Rates are recorded; the assertion
    // is the honest bound.
    const falseReachedRate = (sigma: number, rho: number, trials: number): number => {
      const r = rng(77);
      let hits = 0;
      for (let t = 0; t < trials; t += 1) {
        let z = gaussian(r);
        const rel: number[] = [];
        for (let i = 0; i < 160; i += 1) {
          z = rho * z + Math.sqrt(1 - rho * rho) * gaussian(r);
          rel.push(sigma * z);
        }
        const vad = new VoiceActivityTracker(-70);
        rel.forEach((v, i) => vad.push({ frameIndex: i, t_audio_ms: i * 50, duration_ms: 50, dbfs: -70 + v, finite: true }));
        const active = vad
          .finish()
          .flatMap((sg) => rel.slice(sg.onsetFrame, sg.endFrame + 1).filter((v) => v >= 6))
          .sort((x, y) => x - y);
        if (active.length > 0 && (active[Math.ceil(0.95 * active.length) - 1] as number) >= 12) hits += 1;
      }
      return hits / trials;
    };
    const rates = { '2.5/0.9': falseReachedRate(2.5, 0.9, 20_000), '3.0/0.8': falseReachedRate(3.0, 0.8, 20_000), '3.5/0.9': falseReachedRate(3.5, 0.9, 20_000) };
    console.log('SEC-M03 P(silent window scored reached | cal_margin 13), sigma/rho:', JSON.stringify(rates));
    expect(rates['2.5/0.9']).toBeLessThan(0.01);
    expect(rates['3.5/0.9']).toBeLessThan(0.05); // N-05: about 2 % at the very edge of validity
  });
});

describe('A1-05 / A1-07: precheck input sanity and reason priority', () => {
  const frames = (n: number, level: number | ((i: number) => number), extra: Partial<PrecheckFrame> = {}): PrecheckFrame[] =>
    Array.from({ length: n }, (_, i) => ({ dbfs: typeof level === 'number' ? level : level(i), finite: true, clipped: false, ...extra }));

  it('a muted or hard-gated input (digital silence) is silent_input for both purposes', () => {
    for (const purpose of ['quiet_check', 'pre_window'] as const) {
      const n = purpose === 'quiet_check' ? 100 : 40;
      const p = summarizePrecheck(frames(n, -140), { purpose, durationMs: purpose === 'quiet_check' ? 5000 : 2000 });
      expect(p.valid).toBe(false);
      expect(p.invalid_reason).toBe('silent_input');
    }
    const edge = summarizePrecheck(frames(100, -109.9), { purpose: 'quiet_check', durationMs: 5000 });
    expect(edge.valid).toBe(true);
    const below = summarizePrecheck(frames(100, -110.1), { purpose: 'quiet_check', durationMs: 5000 });
    expect(below.invalid_reason).toBe('silent_input');
  });

  it('priority: interrupted, nonfinite, low_coverage, silent_input, clipped, unstable_floor, burst_noise, too_loud', () => {
    const q = (fs: PrecheckFrame[], interrupted = false) => summarizePrecheck(fs, { purpose: 'quiet_check', durationMs: 5000, interrupted }).invalid_reason;
    expect(q(frames(100, -60), true)).toBe('interrupted');
    const mixed = frames(100, -60).map((f, i) => (i < 10 ? { ...f, finite: false } : f));
    expect(q(mixed)).toBe('nonfinite'); // 10 % non-finite
    expect(q(frames(80, -60))).toBe('low_coverage'); // 80 of 100 expected
    expect(q(frames(100, -140).map((f, i) => (i === 0 ? { ...f, clipped: true } : f)))).toBe('silent_input');
    expect(q(frames(100, -60).map((f, i) => (i === 0 ? { ...f, clipped: true } : f)))).toBe('clipped');
    // unstable (spread above 6 dB) wins over burst and too_loud
    const wide = frames(100, (i) => -20 + (i % 5 === 0 ? 12 : i % 5 === 1 ? -8 : 0));
    expect(q(wide)).toBe('unstable_floor');
    // burst only: stable floor, 10 % of frames 15 dB up (p95 - floor > 10, p80 - p20 small)
    const burst = frames(100, (i) => (i < 8 ? -45 : -60));
    expect(q(burst)).toBe('burst_noise');
    expect(q(frames(100, -25))).toBe('too_loud');
    expect(q(frames(100, -60))).toBeNull();
  });

  it('A1-06: the pre-window precheck never reports unstable_floor or too_loud', () => {
    const wide = frames(40, (i) => -20 + (i % 5 === 0 ? 5 : i % 5 === 1 ? -5 : 0)); // spread 10 dB, loud
    const p = summarizePrecheck(wide, { purpose: 'pre_window', durationMs: 2000 });
    expect(['unstable_floor', 'too_loud']).not.toContain(p.invalid_reason);
    const loud = summarizePrecheck(frames(40, -20), { purpose: 'pre_window', durationMs: 2000 });
    expect(loud.valid).toBe(true);
  });
});

describe('A1-06 / A1-09: the gate arithmetic and the TV recompute, on the shipped session-core verdict module', () => {
  const pre = (floor: number) =>
    summarizePrecheck(Array.from({ length: 40 }, () => ({ dbfs: floor, finite: true, clipped: false })), { purpose: 'pre_window', durationMs: 2000 });

  it('an unchanged room (rise <= 3 dB) is never blocked at any accepted margin; the boundaries are exactly 3, 4, 5 and 6 dB', () => {
    const session = -70;
    for (let margin = 13; margin <= 40; margin += 0.5) {
      for (let rise = -20; rise <= 3; rise += 0.5) {
        expect(evaluateGate(pre(session + rise), session, margin).pass, `margin ${margin} rise ${rise}`).toBe(true);
      }
    }
    expect(evaluateGate(pre(session + 3), session, 13).pass).toBe(true);
    expect(evaluateGate(pre(session + 3.1), session, 13).pass).toBe(false);
    expect(evaluateGate(pre(session + 4), session, 14).pass).toBe(true);
    expect(evaluateGate(pre(session + 4.1), session, 14).pass).toBe(false);
    expect(evaluateGate(pre(session + 5.9), session, 40).pass).toBe(true);
    expect(evaluateGate(pre(session + 6), session, 40).pass).toBe(false);
  });

  it('the quiet-check recompute disagrees with a phone that claims valid on silent input, on unstable data, and on impossible counts', () => {
    const p = summarizePrecheck(Array.from({ length: 100 }, () => ({ dbfs: -140, finite: true, clipped: false })), { purpose: 'quiet_check', durationMs: 5000 });
    expect(evaluateQuietCheck({ ...p, valid: true, invalid_reason: null }).ok).toBe(false); // claims valid, numbers say silent_input
    const good = summarizePrecheck(Array.from({ length: 100 }, () => ({ dbfs: -60, finite: true, clipped: false })), { purpose: 'quiet_check', durationMs: 5000 });
    expect(evaluateQuietCheck(good).ok).toBe(true);
    expect(evaluateQuietCheck({ ...good, frame_count: 1000 }).ok).toBe(false);
    expect(evaluateQuietCheck({ ...good, coverage: 0.5 }).ok).toBe(false);
    expect(evaluateQuietCheck({ ...good, p20_dbfs: -10 }).ok).toBe(false); // percentiles out of order
  });

  const win = {
    kind: 'phrase' as const, valid: true, invalid_reason: null, frame_count: 160, expected_frames: 160, coverage: 1, active_ms: 3000,
    longest_active_ms: 2000, segments: 2, onset_ms: 300, p50_active_dbfs: -30, p95_active_dbfs: -20, peak_dbfs: -15,
    clipped_frames: 0, nonfinite_frames: 0, duration_ms: 8000,
  };
  it('A1-04 / A1-09: a short one-syllable phrase (350 ms) is scored; impossible window summaries become integrity, never a verdict', () => {
    expect(validateWindowResult('phrase', { ...win, active_ms: 350, longest_active_ms: 350, segments: 1 })).toEqual({ valid: true });
    expect(validateWindowResult('calibration', { ...win, kind: 'calibration', duration_ms: 6000, expected_frames: 120, frame_count: 120, active_ms: 350, longest_active_ms: 350, segments: 1 })).toEqual({ valid: false, reason: 'no_voice' });
    const bad: Array<[string, object]> = [
      ['active beyond duration', { active_ms: 9000 }],
      ['longest beyond active', { longest_active_ms: 3500 }],
      ['duration beyond the commanded maximum', { duration_ms: 9000, expected_frames: 180, frame_count: 180 }],
      ['percentiles out of order', { p50_active_dbfs: -10 }],
      ['segments zero with activity', { segments: 0 }],
      ['coverage not matching counts', { coverage: 0.5 }],
    ];
    for (const [label, patch] of bad) {
      const w = { ...win, ...patch };
      const v = validateWindowResult('phrase', w);
      expect(v.valid, label).toBe(false);
      if (!v.valid) expect(v.reason, label).toBe('integrity');
      expect(windowIntegrityOk(w, 8000), label).toBe(false);
    }
  });
});

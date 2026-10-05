import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateMessageObject } from '@atr/protocol';
import type { Frame } from '../src/frame.js';
import { SampleFramer } from '../src/framer.js';
import { summarizePrecheck } from '../src/precheck.js';
import type { PrecheckPurpose, WindowKind } from '../src/types.js';
import { VoiceActivityTracker } from '../src/vad.js';
import { WindowAccumulator } from '../src/window.js';
import type { WindowFinishReason } from '../src/window.js';
import { dbFrame, mulberry32, nonfiniteFrame } from './helpers.js';

/**
 * Runs the JSON fixtures in fixtures/dsp/ against the implementation. The expected values in those
 * files were derived by hand and cross-checked by an independent Python oracle
 * (fixtures/dsp/tools/derive_fixtures.py); nothing here is produced by the code under test.
 */

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'dsp');
const load = <T>(name: string): T => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as T;

type Run = [number | null | 'gap', number] | [number | null | 'gap', number, 'clipped'];

function framesFromRuns(runs: Run[]): Frame[] {
  const frames: Frame[] = [];
  let index = 0;
  for (const run of runs) {
    const [db, n] = run;
    const flag = run.length === 3 ? run[2] : undefined;
    if (db === 'gap') {
      index += n;
      continue;
    }
    for (let i = 0; i < n; i++) {
      frames.push(db === null ? nonfiniteFrame(index) : dbFrame(index, db, { clipped: flag === 'clipped' }));
      index += 1;
    }
  }
  return frames;
}

function expectClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(actual as number, path).toBeCloseTo(expected, 9);
  } else if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    expect(actual, path).toBeTypeOf('object');
    expect(Object.keys(actual as object).sort(), `${path} keys`).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) expectClose((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path} length`).toBe(expected.length);
    expected.forEach((v, i) => expectClose((actual as unknown[])[i], v, `${path}[${i}]`));
  } else {
    expect(actual, path).toEqual(expected);
  }
}

interface QuietCase {
  id: string;
  purpose: PrecheckPurpose;
  duration_ms: number;
  runs: Run[];
  expected: Record<string, unknown>;
  derivation: string;
}
describe('fixtures/dsp/quiet-check.json', () => {
  const file = load<{ cases: QuietCase[] }>('quiet-check.json');
  it('has the designed breadth', () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(20);
  });
  for (const c of file.cases) {
    it(`${c.id}`, () => {
      const result = summarizePrecheck(framesFromRuns(c.runs), { purpose: c.purpose, durationMs: c.duration_ms });
      expectClose(result, c.expected, c.id);
      expect(c.derivation.length).toBeGreaterThan(20);
    });
  }
});

interface VadCase {
  id: string;
  session_floor_dbfs: number;
  runs: Run[];
  expected: {
    segments: Array<{
      onset_frame: number;
      end_frame: number;
      onset_ms: number;
      end_ms: number;
      candidate_frames: number;
      longest_run: number;
    }>;
    rejected_segments: number;
    last_segment_unterminated: boolean;
  };
}
describe('fixtures/dsp/vad.json', () => {
  const file = load<{ cases: VadCase[] }>('vad.json');
  for (const c of file.cases) {
    it(`${c.id}`, () => {
      const vad = new VoiceActivityTracker(c.session_floor_dbfs);
      for (const f of framesFromRuns(c.runs)) vad.push(f);
      const segs = vad.finish();
      expectClose(
        segs.map((s) => ({
          onset_frame: s.onsetFrame,
          end_frame: s.endFrame,
          onset_ms: s.onset_ms,
          end_ms: s.end_ms,
          candidate_frames: s.candidateFrames,
          longest_run: s.longestCandidateRun,
        })),
        c.expected.segments,
        c.id,
      );
      expect(vad.rejectedSegments).toBe(c.expected.rejected_segments);
      expect(vad.lastSegmentUnterminated).toBe(c.expected.last_segment_unterminated);
    });
  }
});

interface WindowCaseBase {
  id: string;
  kind: WindowKind;
  max_duration_ms: number;
  session_floor_dbfs: number;
  runs: Run[];
  finish: { reason: WindowFinishReason; duration_ms?: number };
}

function runWindow(c: WindowCaseBase) {
  const acc = new WindowAccumulator({
    kind: c.kind,
    maxDurationMs: c.max_duration_ms,
    sessionFloorDbfs: c.session_floor_dbfs,
    sampleRate: 48000,
  });
  for (const f of framesFromRuns(c.runs)) acc.push(f);
  return acc.finish(c.finish.reason, c.finish.duration_ms !== undefined ? { durationMs: c.finish.duration_ms } : {});
}

describe('fixtures/dsp/windows.json', () => {
  const file = load<{ cases: Array<WindowCaseBase & { expected: Record<string, unknown> }> }>('windows.json');
  for (const c of file.cases) {
    it(`${c.id}`, () => {
      expectClose(runWindow(c), c.expected, c.id);
    });
  }
});

interface SoftCase extends WindowCaseBase {
  cal_margin_db: number;
  band_edge_rel_db: number;
  expected_window: Record<string, unknown>;
  expected_window_rel_p95_db: number;
  expected_verdict: 'not_reached';
  expected_borderline: boolean;
  derivation: string;
}

describe('fixtures/dsp/soft-windows.json (20 soft windows, expected verdict not_reached)', () => {
  const file = load<{ cases: SoftCase[] }>('soft-windows.json');

  it('contains exactly 20 cases with unique ids', () => {
    expect(file.cases).toHaveLength(20);
    expect(new Set(file.cases.map((c) => c.id)).size).toBe(20);
  });

  for (const c of file.cases) {
    it(`${c.id}: phone summary matches and the band arithmetic gives not_reached`, () => {
      const result = runWindow(c);
      expectClose(result, c.expected_window, c.id);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe('phrase');

      // Local arithmetic consistency check of ADR-0001 section 8. The authoritative verdict function
      // lives in session-core and must be run over these inputs separately.
      const p95 = result.p95_active_dbfs as number;
      const rel = p95 - c.session_floor_dbfs;
      const edge = c.cal_margin_db - 1;
      expect(c.band_edge_rel_db).toBe(edge);
      expect(rel).toBeCloseTo(c.expected_window_rel_p95_db, 9);
      expect(rel >= edge).toBe(false); // not reached
      expect(c.expected_verdict).toBe('not_reached');
      expect(Math.abs(rel - edge) < 1 - 1e-9).toBe(c.expected_borderline);
      expect(c.derivation.length).toBeGreaterThan(40);
    });
  }

  it('covers borderline and non-borderline cases, several margins and floors', () => {
    expect(file.cases.some((c) => c.expected_borderline)).toBe(true);
    expect(file.cases.some((c) => !c.expected_borderline)).toBe(true);
    expect(new Set(file.cases.map((c) => c.cal_margin_db)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(file.cases.map((c) => c.session_floor_dbfs)).size).toBeGreaterThanOrEqual(8);
  });
});


// ---- sample-level fixtures: phase sweep, click trains ------------------------------------

/** +-amplitude alternating samples: every sample squares to amplitude^2 (closed-form frame power). */
function alternatingSignal(total: number, background: number, events: ReadonlyArray<readonly [number, number, number]>): Float64Array {
  const amp = new Float64Array(total).fill(background);
  for (const [start, length, a] of events) amp.fill(a, start, Math.min(total, start + length));
  for (let i = 1; i < total; i += 2) amp[i] = -(amp[i] as number);
  return amp;
}

function framesFromSignal(signal: Float64Array): Frame[] {
  const framer = new SampleFramer(48000);
  const frames: Frame[] = [];
  for (let i = 0; i < signal.length; i += 128) frames.push(...framer.push(signal.subarray(i, Math.min(signal.length, i + 128))));
  return frames;
}

interface SweepFile {
  floor_dbfs: number;
  background_amplitude: number;
  burst_start_base_sample: number;
  window_samples: number;
  offsets_samples: number[];
  levels_db: number[];
  durations_ms: number[];
  asserted_hard_ends: Array<{ level_db: number; duration_ms: number; accepted: 'none' | 'all'; derivation: string }>;
  recorded: Record<string, Record<string, { accepted_offsets: number[]; accepted: number; of: number }>>;
  hand_derived_rates: Array<{ level_db: number; duration_ms: number; accepted: number; of: number; derivation: string }>;
  known_deviation_from_amendment: { recorded: { level_db: number; duration_ms: number; accepted: number; of: number } };
}

describe('fixtures/dsp/vad-phase-sweep.json (A1-01)', () => {
  const sweep = load<SweepFile>('vad-phase-sweep.json');

  function acceptedOffsets(levelDb: number, durationMs: number): number[] {
    const amp = sweep.background_amplitude * 10 ** (levelDb / 20);
    const out: number[] = [];
    for (const offset of sweep.offsets_samples) {
      const signal = alternatingSignal(sweep.window_samples, sweep.background_amplitude, [
        [sweep.burst_start_base_sample + offset, durationMs * 48, amp],
      ]);
      const vad = new VoiceActivityTracker(sweep.floor_dbfs);
      for (const f of framesFromSignal(signal)) vad.push(f);
      if (vad.finish().length > 0) out.push(offset);
    }
    return out;
  }

  it('sweeps at least 20 sub-frame offsets at +10 and +20 dB for 100, 150 and 200 ms', () => {
    expect(sweep.offsets_samples.length).toBeGreaterThanOrEqual(20);
    expect(Math.max(...sweep.offsets_samples)).toBeLessThan(2400);
    expect(sweep.levels_db).toEqual(expect.arrayContaining([10, 20]));
    expect(sweep.durations_ms).toEqual(expect.arrayContaining([100, 150, 200]));
  });

  it('asserted hard ends: never accepted at 100 ms or less; always accepted at 200 ms (+20 dB) and 250 ms (+10 and +20 dB)', () => {
    expect(sweep.asserted_hard_ends.length).toBeGreaterThanOrEqual(5);
    for (const end of sweep.asserted_hard_ends) {
      const got = acceptedOffsets(end.level_db, end.duration_ms);
      expect(got.length, `${end.level_db} dB ${end.duration_ms} ms`).toBe(end.accepted === 'all' ? sweep.offsets_samples.length : 0);
      expect(end.derivation.length).toBeGreaterThan(40);
    }
  });

  it('hand-derived rates for the phase-dependent cases (150 ms at +10 and +20 dB, 200 ms at +10 and +20 dB)', () => {
    for (const r of sweep.hand_derived_rates) {
      expect(acceptedOffsets(r.level_db, r.duration_ms).length, `${r.level_db} dB ${r.duration_ms} ms`).toBe(r.accepted);
    }
  });

  it('records the rates between the hard ends (implementation agreement with the oracle, not a requirement)', () => {
    for (const lv of sweep.levels_db) {
      for (const d of sweep.durations_ms) {
        const rec = (sweep.recorded[String(lv)] as Record<string, { accepted_offsets: number[]; accepted: number; of: number }>)[String(d)] as {
          accepted_offsets: number[];
          accepted: number;
          of: number;
        };
        expect(acceptedOffsets(lv, d), `${lv} dB ${d} ms`).toEqual(rec.accepted_offsets);
        expect(rec.accepted).toBe(rec.accepted_offsets.length);
      }
    }
  });

  it('documents that a 200 ms burst at +10 dB is NOT always accepted (finding against AMENDMENTS-REV2 A1-01)', () => {
    const dev = sweep.known_deviation_from_amendment.recorded;
    expect(dev).toMatchObject({ level_db: 10, duration_ms: 200, of: 40 });
    expect(dev.accepted).toBeLessThan(dev.of);
    expect(acceptedOffsets(10, 200).length).toBe(dev.accepted);
  });
});

interface ClickFile {
  cases: Array<{
    id: string;
    floor_dbfs: number;
    background_amplitude: number;
    total_samples: number;
    events: Array<[number, number, number]>;
    expected: {
      segments: Array<{ onset_frame: number; end_frame: number; onset_ms: number; end_ms: number; candidate_frames: number; longest_run: number }>;
      rejected_segments: number;
    };
    derivation: string;
  }>;
}

describe('fixtures/dsp/vad-click-train.json (A1-02)', () => {
  const file = load<ClickFile>('vad-click-train.json');
  it('has click trains at five periods and several lengths, plus positive controls', () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(15);
    expect(file.cases.some((c) => c.expected.segments.length > 0)).toBe(true);
    expect(file.cases.some((c) => c.expected.segments.length === 0)).toBe(true);
  });
  for (const c of file.cases) {
    it(`${c.id}`, () => {
      const signal = alternatingSignal(c.total_samples, c.background_amplitude, c.events);
      const vad = new VoiceActivityTracker(c.floor_dbfs);
      for (const f of framesFromSignal(signal)) vad.push(f);
      const segs = vad.finish();
      expectClose(
        segs.map((s) => ({
          onset_frame: s.onsetFrame,
          end_frame: s.endFrame,
          onset_ms: s.onset_ms,
          end_ms: s.end_ms,
          candidate_frames: s.candidateFrames,
          longest_run: s.longestCandidateRun,
        })),
        c.expected.segments,
        c.id,
      );
      expect(vad.rejectedSegments).toBe(c.expected.rejected_segments);
    });
  }
});

// ---- AR(1) noise at the edge of quiet-check validity (A1-03) ----------------------------------

interface ArModel {
  id: string;
  sigma_db: number;
  rho: number;
  seed: number;
  valid_trials: number;
  attempts: number;
  active_trials: number;
  p_active: number;
  meets_target: boolean;
  reached_trials: number;
  p_reached: number;
}

interface T16Model {
  id: string;
  sigma_db: number;
  rho: number;
  seed: number;
  trials: number;
  active_trials: number;
  p_active: number;
  reached_trials: number;
  p_reached: number;
  t16_reported: { p_active: number; p_reached: number };
  estimated_floor_unconditioned: { seed: number; trials: number; active_trials: number; reached_trials: number };
}

describe('fixtures/dsp/vad-ar1-noise.json (A1-03, T16 N-05)', () => {
  const file = load<{
    target_p_active_max: number;
    models: ArModel[];
    t16_comparison: { models: T16Model[] };
    finding: string;
  }>('vad-ar1-noise.json');

  /**
   * Same generator as the oracle: mulberry32 + Box-Muller, AR(1) in dB around -70 dBFS. `floorMode`
   * 'quiet_check': the room must pass a quiet check and the floor is its emitted floor; 'true_floor': the
   * floor is the process mean and there is no quiet check (the T16 review's model).
   */
  function study(
    sigma: number,
    rho: number,
    seed: number,
    trials: number,
    floorMode: 'quiet_check' | 'true_floor' | 'estimated_unconditioned',
  ): { attempts: number; active: number; reached: number } {
    const rand = mulberry32(seed);
    const gauss = (): number => {
      let u = 0;
      while (u === 0) u = rand();
      const v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const ar1 = (n: number): number[] => {
      const out: number[] = [];
      let z = gauss();
      const k = Math.sqrt(1 - rho * rho);
      for (let i = 0; i < n; i++) {
        z = rho * z + k * gauss();
        out.push(-70 + sigma * z);
      }
      return out;
    };
    let valid = 0;
    let attempts = 0;
    let active = 0;
    let reached = 0;
    while (valid < trials) {
      attempts += 1;
      let floor = -70;
      if (floorMode !== 'true_floor') {
        const quiet = summarizePrecheck(
          ar1(100).map((db, i) => dbFrame(i, db)),
          { purpose: 'quiet_check', durationMs: 5000 },
        );
        if (floorMode === 'quiet_check' && !quiet.valid) continue;
        floor = quiet.floor_dbfs as number;
      }
      valid += 1;
      const acc = new WindowAccumulator({ kind: 'phrase', maxDurationMs: 8000, sessionFloorDbfs: floor, sampleRate: 48000 });
      ar1(160).forEach((db, i) => acc.push(dbFrame(i, db)));
      const w = acc.finish('complete');
      if (w.segments > 0) active += 1;
      // the TV rule with a calibration margin of 13 dB: reached when p95_active - floor >= 12 (same tolerance as the TV)
      if (w.valid && w.p95_active_dbfs !== null && w.p95_active_dbfs - floor + 1e-9 >= 12) reached += 1;
    }
    return { attempts, active, reached };
  }

  it('the model grid covers noise up to the edge of what the quiet check admits (sigma 3.5 dB)', () => {
    expect(Math.max(...file.models.map((m) => m.sigma_db))).toBeGreaterThanOrEqual(3.5);
    expect(file.models.every((m) => m.valid_trials === 10000)).toBe(true);
    expect(file.target_p_active_max).toBe(0.01);
    expect(file.models.length).toBeGreaterThanOrEqual(7);
  });

  for (const id of [
    'ar1-sigma2.0-rho0.9',
    'ar1-sigma2.5-rho0.5',
    'ar1-sigma2.5-rho0.8',
    'ar1-sigma2.5-rho0.9',
    'ar1-sigma3.0-rho0.8',
    'ar1-sigma3.5-rho0.5',
    'ar1-sigma3.5-rho0.9',
  ]) {
    it(
      `${id}: 10000 valid-room trials reproduce the oracle's counts (accepted segments and false reached)`,
      () => {
        const m = file.models.find((x) => x.id === id) as ArModel;
        const got = study(m.sigma_db, m.rho, m.seed, m.valid_trials, 'quiet_check');
        expect(got.attempts, 'quiet-check validity decisions agree on every attempt').toBe(m.attempts);
        expect(got.active, 'accepted-segment decisions agree on every trial').toBe(m.active_trials);
        expect(got.reached, 'false-reached decisions agree on every trial').toBe(m.reached_trials);
        const p = got.active / m.valid_trials;
        // P(active) <= 1 % is asserted wherever the revision 2 rule achieves it; elsewhere the rate is
        // recorded with its flag (see the finding in the fixture and fixtures/dsp/README.md).
        expect(p <= file.target_p_active_max).toBe(m.meets_target);
        if (m.meets_target) expect(p).toBeLessThanOrEqual(0.01);
        expect(m.p_reached).toBeLessThanOrEqual(m.p_active); // every false reached has an accepted segment
      },
      180_000,
    );
  }

  for (const id of ['t16-sigma2.5-rho0.9', 't16-sigma3.0-rho0.8', 't16-sigma3.5-rho0.9']) {
    it(
      `${id}: the T16 model (floor = process mean, no quiet check) reproduces the oracle and is consistent with the T16 figures`,
      () => {
        const m = file.t16_comparison.models.find((x) => x.id === id) as T16Model;
        const got = study(m.sigma_db, m.rho, m.seed, m.trials, 'true_floor');
        expect(got.active).toBe(m.active_trials);
        expect(got.reached).toBe(m.reached_trials);
        // Consistent with what the independent review reported, within 3 combined standard errors. Its test file
        // uses 4,000 trials for the accepted-segment figure and 20,000 for the false-reached figure.
        const se = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);
        const tolActive = 3 * Math.hypot(se(m.t16_reported.p_active, 4000), se(m.t16_reported.p_active, m.trials));
        const tolReached = 3 * Math.hypot(se(m.t16_reported.p_reached, 20000), se(m.t16_reported.p_reached, m.trials));
        expect(Math.abs(got.active / m.trials - m.t16_reported.p_active)).toBeLessThan(tolActive + 0.001);
        expect(Math.abs(got.reached / m.trials - m.t16_reported.p_reached)).toBeLessThan(tolReached + 0.001);
        // the same rooms with an estimated floor (quiet check run, no room rejected) reproduce the oracle too
        const e = m.estimated_floor_unconditioned;
        const est = study(m.sigma_db, m.rho, e.seed, e.trials, 'estimated_unconditioned');
        expect(est.active).toBe(e.active_trials);
        expect(est.reached).toBe(e.reached_trials);
        // the floor estimate, not the conditioning, is what raises the rates above the review's
        expect(est.active).toBeGreaterThan(got.active);
      },
      180_000,
    );
  }

  it('records the finding that the 1 % target is not met at the edge of quiet-check validity, and that a false reached is possible', () => {
    const edge = file.models.filter((m) => m.sigma_db >= 3.0);
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.every((m) => !m.meets_target)).toBe(true);
    expect(edge.some((m) => m.reached_trials > 0)).toBe(true);
    expect(file.finding).toContain('3 - 17 %');
  });
});

// ---- the expected payloads can travel on the protocol revision 4 wire -----------------------------

const NOW = 1_790_000_000_000;
function wrap(type: 'precheck.result' | 'window.result', payload: unknown): Record<string, unknown> {
  return {
    protocol_version: 1,
    type,
    message_id: 'm_0123456789abcdefghijkl',
    room_id: 'r_ABCDEFGHIJKLMNOPQRSTUV',
    session_id: 's_session01',
    window_id: 'w_window001',
    attempt_id: 'a_attempt001',
    sender_role: 'phone',
    producer_generation: 1,
    sequence: 0,
    event_timestamp: NOW,
    payload,
  };
}
const onGrid = (x: number, scale: number): boolean => Math.abs(x * scale - Math.round(x * scale)) < 1e-6;

describe('fixture expectations are transmittable on the protocol revision 4 wire', () => {
  it('every quiet-check expected payload passes the validators', () => {
    for (const c of load<{ cases: QuietCase[] }>('quiet-check.json').cases) {
      const r = validateMessageObject(wrap('precheck.result', c.expected), { now: NOW });
      expect(r.ok, `${c.id}: ${r.ok ? '' : `${r.code} ${r.detail}`}`).toBe(true);
    }
  });

  it('every window expected payload passes the validators', () => {
    for (const c of load<{ cases: Array<WindowCaseBase & { expected: Record<string, unknown> }> }>('windows.json').cases) {
      const r = validateMessageObject(wrap('window.result', c.expected), { now: NOW });
      expect(r.ok, `${c.id}: ${r.ok ? '' : `${r.code} ${r.detail}`}`).toBe(true);
    }
  });

  it('all 20 soft windows are end-to-end transmittable: payload valid, every dB value on the 0.1 grid, coverage on the 0.001 grid', () => {
    const cases = load<{ cases: SoftCase[] }>('soft-windows.json').cases;
    expect(cases).toHaveLength(20);
    for (const c of cases) {
      const w = c.expected_window as Record<string, number | string | boolean | null>;
      const r = validateMessageObject(wrap('window.result', c.expected_window), { now: NOW });
      expect(r.ok, `${c.id}: ${r.ok ? '' : `${r.code} ${r.detail}`}`).toBe(true);
      for (const k of ['p50_active_dbfs', 'p95_active_dbfs', 'peak_dbfs']) {
        expect(onGrid(w[k] as number, 10), `${c.id} ${k}`).toBe(true);
      }
      expect(onGrid(w.coverage as number, 1000), `${c.id} coverage`).toBe(true);
      // the inputs the TV works from are on the same grid, so the borderline distance is a multiple of 0.1 dB
      for (const v of [c.session_floor_dbfs, c.cal_margin_db, c.band_edge_rel_db, c.expected_window_rel_p95_db]) {
        expect(onGrid(v, 10), `${c.id} input ${v}`).toBe(true);
      }
      for (const run of c.runs as Run[]) {
        if (typeof run[0] === 'number') expect(onGrid(run[0], 10), `${c.id} run level ${run[0]}`).toBe(true);
      }
      const distanceTenths = Math.round(Math.abs(c.expected_window_rel_p95_db - c.band_edge_rel_db) * 10);
      expect(distanceTenths, `${c.id} distance to the edge`).toBeGreaterThanOrEqual(1); // at least 0.1 dB under the edge
    }
  });
});

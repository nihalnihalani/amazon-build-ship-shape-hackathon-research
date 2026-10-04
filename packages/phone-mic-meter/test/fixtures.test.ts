import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../src/frame.js';
import { summarizePrecheck } from '../src/precheck.js';
import type { PrecheckPurpose, WindowKind } from '../src/types.js';
import { VoiceActivityTracker } from '../src/vad.js';
import { WindowAccumulator } from '../src/window.js';
import type { WindowFinishReason } from '../src/window.js';
import { dbFrame, nonfiniteFrame } from './helpers.js';

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
    segments: Array<{ onset_frame: number; end_frame: number; onset_ms: number; end_ms: number; candidate_frames: number }>;
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
      expect(Math.abs(rel - edge) < 1).toBe(c.expected_borderline);
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

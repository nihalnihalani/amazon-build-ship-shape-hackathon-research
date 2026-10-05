/**
 * T16 gate, part J: independent check of the frozen T04 qualification analysis (`analyzeQualification`,
 * packages/phone-mic-meter/src/qualification.ts, frozen with docs/evaluation/T04-protocol.md revision 2).
 *
 * Question asked: can a FAILED experiment become a PASS? (ADR-0009, finding A9-01.) The inputs are synthetic series
 * generated here. Evidence class: automated, synthetic; nothing about a real phone.
 *
 * Tests wrapped in it.fails assert the behaviour the protocol document promises and the code does not deliver yet.
 */
import { describe, expect, it } from 'vitest';
import { analyzeQualification, sdUpperConfidenceBound, chiSquareQuantile, QUALIFICATION_PARAMS, type NegativeCaseResult, type QualificationTrial } from '@atr/phone-mic-meter';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number): number => {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

const LEVELS = [-30, -18, -6];
/** `slope` 1 is a linear input; 1/3 is a 3:1 compressor. `sd` is the per-trial scatter in dB. */
function series(opts: { slope: number; sd?: number; levels?: number[]; n?: number; stimuli?: Array<'tone' | 'pink'>; seed?: number; clipped?: number }): QualificationTrial[] {
  const r = rng(opts.seed ?? 5);
  const out: QualificationTrial[] = [];
  for (const stimulus of opts.stimuli ?? (['tone', 'pink'] as const)) {
    for (const nominalDb of opts.levels ?? LEVELS) {
      for (let i = 0; i < (opts.n ?? 15); i += 1) {
        out.push({ stimulus, nominalDb, rel95Db: 25 + opts.slope * (nominalDb + 30) + (opts.sd ?? 0.4) * gauss(r), clippedFrames: opts.clipped ?? 0 });
      }
    }
  }
  return out;
}
const NEG_OK: NegativeCaseResult[] = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'].map((id) => ({ id, windows: 10, scoredReached: 0 }));
const SETTINGS = { autoGainControl: false } as const;
/** `neg` and `settings` take the string 'omit' to leave the option out entirely (undefined would select the default). */
const run = (trials: QualificationTrial[], neg: readonly NegativeCaseResult[] | 'omit' = NEG_OK, settings: { autoGainControl: boolean | null } | 'omit' = SETTINGS) =>
  analyzeQualification(trials, { ...(settings !== 'omit' ? { settings } : {}), ...(neg !== 'omit' ? { negativeCases: neg } : {}) });

describe('the analysis does what the document says on honest inputs', () => {
  it('a linear unprocessed input passes; the frozen parameters are the ones the protocol prints', () => {
    expect(QUALIFICATION_PARAMS).toMatchObject({ levelsPerStimulus: 3, repeatsPerLevel: 15, stepToleranceDb: 2, maxSdUpperBoundDb: 1.5, confidence: 0.95 });
    expect(Object.isFrozen(QUALIFICATION_PARAMS)).toBe(true);
    const a = run(series({ slope: 1 }));
    expect(a.status).toBe('passed');
    expect(a.limited).toBeNull();
  });

  it('the SD bound uses the 5th percentile of chi-square(14) = 6.5706, factor 1.4597, so an SD of 1.03 dB passes and 1.04 dB fails', () => {
    expect(chiSquareQuantile(0.05, 14)).toBeCloseTo(6.5706, 3);
    expect(sdUpperConfidenceBound(1, 15, 0.95)).toBeCloseTo(1.4597, 3);
    expect(sdUpperConfidenceBound(1.027, 15, 0.95)).toBeLessThanOrEqual(1.5);
    expect(sdUpperConfidenceBound(1.04, 15, 0.95)).toBeGreaterThan(1.5);
  });

  it('A9-01: a monotonic, tight, unclipped input that compresses 12 dB steps (3:1, 2:1, 1.5:1) fails the slope criterion; 1.2:1 passes at the edge of the tolerance', () => {
    for (const slope of [1 / 3, 1 / 2, 2 / 3]) {
      const a = run(series({ slope, sd: 0.3 }));
      expect(a.status, `slope ${slope}`).toBe('failed');
      expect(a.byCriterion.C1).toBe(true); // monotonic
      expect(a.byCriterion.C4).toBe(true); // tight
      expect(a.byCriterion.C5).toBe(true); // unclipped
      expect(a.byCriterion.C2, `slope ${slope}`).toBe(false); // but squeezed
    }
    expect(run(series({ slope: 10.5 / 12, sd: 0.2 })).byCriterion.C2).toBe(true);
    expect(run(series({ slope: 9 / 12, sd: 0.2 })).byCriterion.C2).toBe(false);
  });

  it('other honest failures fail: too few repeats, clipping, AGC reported on or unknown, a non-monotonic series, scatter above the bound, a noisy-room limit', () => {
    expect(run(series({ slope: 1, n: 14 })).byCriterion.C3).toBe(false);
    expect(run(series({ slope: 1, clipped: 1 })).byCriterion.C5).toBe(false);
    expect(run(series({ slope: 1 }), NEG_OK, { autoGainControl: true }).byCriterion.C6).toBe(false);
    expect(run(series({ slope: 1 }), NEG_OK, { autoGainControl: null }).byCriterion.C6).toBe(false);
    expect(run(series({ slope: 1 }), NEG_OK, 'omit').byCriterion.C6).toBe(false);
    expect(run(series({ slope: -1 })).byCriterion.C1).toBe(false);
    expect(run(series({ slope: 1, sd: 1.2 })).byCriterion.C4).toBe(false);
    const noisy = run(series({ slope: 1 }), [{ id: 'N1', windows: 10, scoredReached: 1 }, ...NEG_OK.filter((n) => n.id !== 'N1')]);
    expect(noisy.byCriterion.C7).toBe(false);
    expect(noisy.limited).toBe('noise-sensitive');
    expect(noisy.status).toBe('failed');
    expect(run([]).status).toBe('not_run');
    expect(run(series({ slope: 1 }), 'omit').byCriterion.C7).toBe(false); // negative-case results not provided
  });
});

describe('can a failed experiment become a pass? (findings against the frozen code)', () => {
  it.fails('OPEN FINDING N-08: the slope criterion cannot be passed by an AGC-compressed input that was measured at closely spaced nominal levels (levels must be the frozen -30, -18, -6 dBFS or at least 10 dB apart)', () => {
    // Nominal levels 2 dB apart, a 3:1 compressor: measured steps 0.67 dB, |0.67 - 2| = 1.33 <= 2 dB, so C2 passes.
    const a = run(series({ slope: 1 / 3, sd: 0.1, levels: [-30, -28, -26] }));
    expect(a.status).toBe('failed');
  });

  it.fails('OPEN FINDING N-09: the negative-case criterion fails when N1 or N2 results are missing, malformed or run with fewer than 10 windows (protocol section 8: "Missing results fail C7")', () => {
    const trials = series({ slope: 1 });
    const cases: Array<[string, NegativeCaseResult[]]> = [
      ['an empty list', []],
      ['only the ungated cases N3 to N7', NEG_OK.filter((n) => !['N1', 'N2'].includes(n.id))],
      ['N1 with scoredReached NaN', [{ id: 'N1', windows: 10, scoredReached: Number.NaN }, ...NEG_OK.filter((n) => n.id !== 'N1')]],
      ['N1 with a negative count', [{ id: 'N1', windows: 10, scoredReached: -3 }, ...NEG_OK.filter((n) => n.id !== 'N1')]],
      ['N2 run on 1 window', [{ id: 'N2', windows: 1, scoredReached: 0 }, ...NEG_OK.filter((n) => n.id !== 'N2')]],
    ];
    for (const [label, neg] of cases) expect(run(trials, neg).status, label).toBe('failed');
  });

  it('characterisation (N-11, minor): a caller can pass its own params; the criteria are then silently relaxed and the output does not record which params were used', () => {
    const squeezed = series({ slope: 1 / 3, sd: 0.3 });
    expect(run(squeezed).status).toBe('failed');
    const relaxed = analyzeQualification(squeezed, { params: { ...QUALIFICATION_PARAMS, stepToleranceDb: 12 }, settings: SETTINGS, negativeCases: NEG_OK });
    expect(relaxed.status).toBe('passed');
    expect(Object.keys(relaxed)).not.toContain('params');
  });

  it('characterisation (documented, not a finding): trials flagged valid:false are excluded without a reason; the protocol relies on the live log written before results are read', () => {
    const lots = series({ slope: 1, n: 20, sd: 1.0, seed: 9 });
    // drop, per level, the five trials farthest from the level median, the way a cherry-picker would
    const kept: QualificationTrial[] = [];
    for (const stimulus of ['tone', 'pink'] as const) {
      for (const level of LEVELS) {
        const group = lots.filter((t) => t.stimulus === stimulus && t.nominalDb === level);
        const med = [...group].sort((a, b) => a.rel95Db - b.rel95Db)[10]?.rel95Db ?? 0;
        const sorted = [...group].sort((a, b) => Math.abs(a.rel95Db - med) - Math.abs(b.rel95Db - med));
        kept.push(...sorted.slice(0, 15), ...sorted.slice(15).map((t) => ({ ...t, valid: false })));
      }
    }
    const honest = run(lots.map((t) => t));
    const picked = run(kept);
    console.log('N-10 cherry-pick effect on the SD bound (tone, level 1):', JSON.stringify({ honest: honest.levels.tone[0]?.sdUpperBound, picked: picked.levels.tone[0]?.sdUpperBound }));
    expect(picked.levels.tone[0]!.sdUpperBound!).toBeLessThan(honest.levels.tone[0]!.sdUpperBound!);
  });
});

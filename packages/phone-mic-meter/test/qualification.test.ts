import { describe, expect, it } from 'vitest';
import {
  QUALIFICATION_PARAMS,
  analyzeQualification,
  chiSquareCdf,
  chiSquareQuantile,
  sdUpperConfidenceBound,
} from '../src/qualification.js';
import type { NegativeCaseResult, QualificationTrial } from '../src/qualification.js';

/**
 * Hand-derived expectations. The 15 repeat offsets below sum to 0 (so the level median is the
 * centre), have sum of squares 5.08 and therefore sample SD sqrt(5.08 / 14) = 0.60238 dB.
 * Chi-square values come from closed forms (2 degrees of freedom: q = -2 ln(1 - p)) and from
 * standard tables (14 degrees of freedom: 5th percentile 6.5706, 95th percentile 23.6848).
 */
const OFFSETS = [-1.0, -0.8, -0.6, -0.5, -0.4, -0.3, -0.2, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

const NOMINAL = [-30, -18, -6]; // 12 dB nominal steps

function trials(
  stimulus: 'tone' | 'pink',
  centres: number[],
  options: { scale?: number; repeats?: number; nominal?: number[]; clippedAt?: number } = {},
): QualificationTrial[] {
  const scale = options.scale ?? 1;
  const nominal = options.nominal ?? NOMINAL;
  const repeats = options.repeats ?? 15;
  const out: QualificationTrial[] = [];
  nominal.forEach((nominalDb, level) => {
    for (let r = 0; r < repeats; r++) {
      out.push({
        stimulus,
        nominalDb,
        rel95Db: (centres[level] as number) + (OFFSETS[r % OFFSETS.length] as number) * scale,
        clippedFrames: level === options.clippedAt && r === 0 ? 1 : 0,
      });
    }
  });
  return out;
}

const HONEST = [20, 32, 44]; // 12 dB steps at the phone for 12 dB nominal steps
const SETTINGS_OK = { autoGainControl: false };
const NEGATIVE_OK: NegativeCaseResult[] = [
  { id: 'N1', windows: 10, scoredReached: 0 },
  { id: 'N2', windows: 10, scoredReached: 0, blockedOrContaminated: 10 },
  { id: 'N3', windows: 10, scoredReached: 7 },
  { id: 'N4', windows: 10, scoredReached: 10 },
  { id: 'N5', windows: 10, scoredReached: 3 },
  { id: 'N6', windows: 10, scoredReached: 0 },
  { id: 'N7', windows: 10, scoredReached: 0 },
];

function run(both: QualificationTrial[], extra: Parameters<typeof analyzeQualification>[1] = {}) {
  return analyzeQualification(both, { settings: SETTINGS_OK, negativeCases: NEGATIVE_OK, ...extra });
}

describe('chi-square quantile', () => {
  it('matches the closed form for 2 degrees of freedom: q = -2 ln(1 - p)', () => {
    expect(chiSquareQuantile(0.05, 2)).toBeCloseTo(0.1025866, 6); // -2 ln 0.95
    expect(chiSquareQuantile(0.5, 2)).toBeCloseTo(1.3862944, 6); // 2 ln 2
    expect(chiSquareQuantile(0.95, 2)).toBeCloseTo(5.9914645, 6); // -2 ln 0.05
  });

  it('matches standard table values', () => {
    expect(chiSquareQuantile(0.05, 14)).toBeCloseTo(6.5706, 3);
    expect(chiSquareQuantile(0.95, 14)).toBeCloseTo(23.6848, 3);
    expect(chiSquareQuantile(0.05, 9)).toBeCloseTo(3.3251, 3);
    expect(chiSquareQuantile(0.95, 10)).toBeCloseTo(18.307, 3);
    expect(chiSquareQuantile(0.95, 1)).toBeCloseTo(3.8415, 3); // 1.959964 squared
    expect(chiSquareQuantile(0.5, 1)).toBeCloseTo(0.4549, 3); // 0.674490 squared
  });

  it('cdf is the inverse of the quantile and matches 1 - exp(-x/2) for 2 degrees of freedom', () => {
    for (const x of [0.1, 0.5, 1, 2.5, 7, 15]) {
      expect(chiSquareCdf(x, 2)).toBeCloseTo(1 - Math.exp(-x / 2), 10);
    }
    for (const df of [1, 2, 5, 14, 30]) {
      for (const p of [0.01, 0.05, 0.5, 0.95, 0.99]) {
        expect(chiSquareCdf(chiSquareQuantile(p, df), df)).toBeCloseTo(p, 8);
      }
    }
  });

  it('rejects invalid arguments', () => {
    expect(() => chiSquareQuantile(0, 5)).toThrow(RangeError);
    expect(() => chiSquareQuantile(1, 5)).toThrow(RangeError);
    expect(() => chiSquareQuantile(0.5, 0)).toThrow(RangeError);
  });
});

describe('SD upper confidence bound', () => {
  it('multiplies the SD by sqrt((n - 1) / chi2_0.05(n - 1)): 1.4597 at n = 15, 1.645 at n = 10', () => {
    expect(sdUpperConfidenceBound(1, 15, 0.95)).toBeCloseTo(Math.sqrt(14 / 6.5706), 3); // 1.4597
    expect(sdUpperConfidenceBound(1, 15, 0.95)).toBeCloseTo(1.4597, 3);
    // A9-05: with 10 repeats the bound is about 1.65 times the estimate
    expect(sdUpperConfidenceBound(1, 10, 0.95)).toBeCloseTo(Math.sqrt(9 / 3.3251), 3); // 1.6453
  });

  it('needs at least two samples', () => {
    expect(() => sdUpperConfidenceBound(1, 1, 0.95)).toThrow(RangeError);
  });
});

describe('frozen parameters', () => {
  it('are the predeclared values', () => {
    expect(QUALIFICATION_PARAMS.repeatsPerLevel).toBe(15);
    expect(QUALIFICATION_PARAMS.levelsPerStimulus).toBe(3);
    expect(QUALIFICATION_PARAMS.stepToleranceDb).toBe(2);
    expect(QUALIFICATION_PARAMS.maxSdUpperBoundDb).toBe(1.5);
    expect(QUALIFICATION_PARAMS.confidence).toBe(0.95);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N1).toBe(0);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N2).toBe(0);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N3).toBeNull();
    expect(Object.isFrozen(QUALIFICATION_PARAMS)).toBe(true);
  });
});

describe('an honest pass', () => {
  const result = run([...trials('tone', HONEST), ...trials('pink', [22, 33.5, 45])]);

  it('passes every criterion', () => {
    expect(result.status).toBe('passed');
    expect(result.byCriterion).toEqual({ C1: true, C2: true, C3: true, C4: true, C5: true, C6: true, C7: true });
    expect(result.criteria.every((c) => c.pass)).toBe(true);
    expect(result.limited).toBeNull();
  });

  it('reports the medians, SD and upper bound per level', () => {
    const tone = result.levels.tone;
    expect(tone.map((l) => l.nominalDb)).toEqual([-30, -18, -6]);
    expect(tone.map((l) => l.median)).toEqual([20, 32, 44]);
    expect(tone.every((l) => l.n === 15)).toBe(true);
    expect(tone[0]?.sd).toBeCloseTo(0.60238, 4); // sqrt(5.08 / 14)
    expect(tone[0]?.sdUpperBound).toBeCloseTo(0.60238 * 1.4597, 3); // 0.879
    // pink noise steps are 11.5 and 11.5 dB for 12 dB nominal: within +-2 dB
    expect(result.levels.pink.map((l) => l.median)).toEqual([22, 33.5, 45]);
  });
});

describe('the synthetic 3:1 compression case must FAIL (A9-01)', () => {
  it('12 dB nominal steps measured as 4 dB steps: monotonic, tight and unclipped, but the slope criterion fails', () => {
    const compressed = [20, 24, 28]; // 12 dB nominal -> 4 dB measured
    const r = run([...trials('tone', compressed), ...trials('pink', compressed)]);
    expect(r.byCriterion.C1).toBe(true); // monotonic
    expect(r.byCriterion.C3).toBe(true);
    expect(r.byCriterion.C4).toBe(true); // tight
    expect(r.byCriterion.C5).toBe(true); // no clipping
    expect(r.byCriterion.C2).toBe(false); // |4 - 12| = 8 > 2
    expect(r.status).toBe('failed');
    const slope = r.criteria.find((c) => c.id === 'C2:tone');
    expect(slope?.pass).toBe(false);
    expect(slope?.detail).toContain('measured 4.00 dB vs nominal 12 dB');
  });

  it('the review example: 6 dB nominal steps measured as 2 dB steps also fails', () => {
    const nominal = [-24, -18, -12];
    const compressed = [10, 12, 14];
    const r = run([
      ...trials('tone', compressed, { nominal }),
      ...trials('pink', compressed, { nominal }),
    ]);
    expect(r.byCriterion.C1).toBe(true);
    expect(r.byCriterion.C4).toBe(true);
    expect(r.byCriterion.C2).toBe(false); // |2 - 6| = 4 > 2: the accepted range is 4..8 dB
    expect(r.status).toBe('failed');
  });

  it('6 dB nominal steps measured as exactly 4 dB and 8 dB pass the slope criterion; 3.9 fails', () => {
    const nominal = [-24, -18, -12];
    const edge = run([...trials('tone', [10, 14, 22], { nominal }), ...trials('pink', [10, 14, 22], { nominal })]);
    expect(edge.byCriterion.C2).toBe(true); // steps 4 and 8: both within 6 +- 2
    const outside = run([...trials('tone', [10, 13.9, 22], { nominal }), ...trials('pink', [10, 14, 22], { nominal })]);
    expect(outside.byCriterion.C2).toBe(false);
  });
});

describe('a noisy fail (A9-05)', () => {
  it('SD 1.2 dB: even with correct medians the upper bound 1.76 dB exceeds 1.5 dB', () => {
    const r = run([...trials('tone', HONEST, { scale: 2 }), ...trials('pink', HONEST)]);
    expect(r.levels.tone[0]?.sd).toBeCloseTo(1.2048, 3); // 0.60238 * 2
    expect(r.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.7586, 3);
    expect(r.byCriterion.C4).toBe(false);
    expect(r.criteria.find((c) => c.id === 'C4:pink')?.pass).toBe(true);
    expect(r.status).toBe('failed');
  });

  it('boundary: scale 1.70 gives an upper bound of 1.4948 (pass), scale 1.72 gives 1.5124 (fail)', () => {
    const pass = run([...trials('tone', HONEST, { scale: 1.7 }), ...trials('pink', HONEST)]);
    expect(pass.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.4948, 3);
    expect(pass.byCriterion.C4).toBe(true);
    const fail = run([...trials('tone', HONEST, { scale: 1.72 }), ...trials('pink', HONEST)]);
    expect(fail.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.5124, 3);
    expect(fail.byCriterion.C4).toBe(false);
  });
});

describe('the other criteria', () => {
  const both = (centres: number[], options?: Parameters<typeof trials>[2]) => [
    ...trials('tone', centres, options),
    ...trials('pink', HONEST),
  ];

  it('C1: non-monotonic medians fail (and so does the slope)', () => {
    const r = run(both([20, 44, 32]));
    expect(r.byCriterion.C1).toBe(false);
    expect(r.byCriterion.C2).toBe(false);
  });

  it('C1: equal medians are not strictly increasing', () => {
    const r = run(both([20, 20, 44]));
    expect(r.byCriterion.C1).toBe(false);
  });

  it('C3: 14 repeats at one level fail, 15 pass', () => {
    const short = [...trials('tone', HONEST, { repeats: 14 }), ...trials('pink', HONEST)];
    const r = run(short);
    expect(r.byCriterion.C3).toBe(false);
    expect(r.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('14, 14, 14');
    expect(run(both(HONEST)).byCriterion.C3).toBe(true);
  });

  it('C3: two levels instead of three fail', () => {
    const r = run([...trials('tone', [20, 32], { nominal: [-30, -18] }), ...trials('pink', HONEST)]);
    expect(r.byCriterion.C3).toBe(false);
  });

  it('C5: a single clipped frame in any valid trial fails', () => {
    const r = run(both(HONEST, { clippedAt: 2 }));
    expect(r.byCriterion.C5).toBe(false);
    expect(r.criteria.find((c) => c.id === 'C5:tone')?.detail).toBe('1 clipped frames');
    expect(r.status).toBe('failed');
  });

  it('C6: settings readback must report autoGainControl false; true, null and missing all fail', () => {
    const data = both(HONEST);
    expect(run(data, { settings: { autoGainControl: false } }).byCriterion.C6).toBe(true);
    expect(run(data, { settings: { autoGainControl: true } }).byCriterion.C6).toBe(false);
    expect(run(data, { settings: { autoGainControl: null } }).byCriterion.C6).toBe(false);
    const missing = analyzeQualification(data, { negativeCases: NEGATIVE_OK });
    expect(missing.byCriterion.C6).toBe(false);
    expect(missing.status).toBe('failed');
  });

  it('C7: a gated negative case over its limit sets limited noise-sensitive', () => {
    const data = both(HONEST);
    const fan = run(data, { negativeCases: [{ id: 'N1', windows: 10, scoredReached: 1 }] });
    expect(fan.byCriterion.C7).toBe(false);
    expect(fan.limited).toBe('noise-sensitive');
    expect(fan.status).toBe('failed');
    const tvSpeech = run(data, { negativeCases: [{ id: 'N2', windows: 10, scoredReached: 2, blockedOrContaminated: 8 }] });
    expect(tvSpeech.limited).toBe('noise-sensitive');
  });

  it('C7: ungated cases (second speaker, cough, music) are reported, not gated', () => {
    const r = run(both(HONEST), {
      negativeCases: [
        { id: 'N3', windows: 10, scoredReached: 10 },
        { id: 'N4', windows: 10, scoredReached: 10 },
        { id: 'N5', windows: 10, scoredReached: 10 },
      ],
    });
    expect(r.byCriterion.C7).toBe(true);
    expect(r.limited).toBeNull();
  });

  it('C7: limits are parameters: a stricter predeclared limit changes the outcome', () => {
    const strict = { ...QUALIFICATION_PARAMS, negativeCaseLimits: { ...QUALIFICATION_PARAMS.negativeCaseLimits, N5: 2 } };
    const r = run(both(HONEST), { params: strict });
    expect(r.byCriterion.C7).toBe(false); // N5 scored reached 3 times (limit 2)
    expect(r.limited).toBe('noise-sensitive');
  });

  it('C7: missing negative-case results fail (qualification cannot pass without them)', () => {
    const r = analyzeQualification(both(HONEST), { settings: SETTINGS_OK });
    expect(r.byCriterion.C7).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('trials marked invalid are ignored for every statistic', () => {
    const wild: QualificationTrial[] = Array.from({ length: 5 }, () => ({
      stimulus: 'tone' as const,
      nominalDb: -30,
      rel95Db: 90,
      clippedFrames: 3,
      valid: false,
    }));
    const r = run([...both(HONEST), ...wild]);
    expect(r.status).toBe('passed');
    expect(r.levels.tone[0]?.n).toBe(15);
  });

  it('a missing stimulus fails its criteria; no trials at all is not_run', () => {
    const onlyTone = run(trials('tone', HONEST));
    expect(onlyTone.byCriterion.C1).toBe(false);
    expect(onlyTone.status).toBe('failed');
    const none = analyzeQualification([]);
    expect(none.status).toBe('not_run');
    expect(none.byCriterion.C3).toBe(false);
  });
});

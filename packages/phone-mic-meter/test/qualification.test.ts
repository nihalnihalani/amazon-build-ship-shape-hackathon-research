import { describe, expect, it } from 'vitest';
import {
  EXCLUSION_REASONS,
  QUALIFICATION_PARAMS,
  analyzeQualification,
  chiSquareCdf,
  chiSquareQuantile,
  sdUpperConfidenceBound,
} from '../src/qualification.js';
import type { ExclusionReason, NegativeCaseResult, QualificationTrial } from '../src/qualification.js';

/**
 * Hand-derived expectations. The 15 repeat offsets below sum to 0 (so the level median is the
 * centre), have sum of squares 5.08 and therefore sample SD sqrt(5.08 / 14) = 0.60238 dB.
 * Chi-square values come from closed forms (2 degrees of freedom: q = -2 ln(1 - p)) and from
 * standard tables (14 degrees of freedom: 5th percentile 6.5706, 95th percentile 23.6848).
 */
const OFFSETS = [-1.0, -0.8, -0.6, -0.5, -0.4, -0.3, -0.2, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

const FROZEN = [-30, -18, -6]; // 12 dB nominal steps

interface SeriesOptions {
  scale?: number;
  repeats?: number;
  nominal?: number[];
  clippedAt?: number;
}

/** Planned trials for one stimulus: one counted attempt per planned slot, slots `L<level>-<rr>`. */
function trials(stimulus: 'tone' | 'pink', centres: number[], options: SeriesOptions = {}): QualificationTrial[] {
  const scale = options.scale ?? 1;
  const nominal = options.nominal ?? FROZEN;
  const repeats = options.repeats ?? 15;
  const out: QualificationTrial[] = [];
  nominal.forEach((nominalDb, level) => {
    for (let r = 0; r < repeats; r++) {
      out.push({
        stimulus,
        nominalDb,
        slot: `L${level + 1}-${String(r + 1).padStart(2, '0')}`,
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
  { id: 'N8', windows: 10, scoredReached: 0 },
];

function run(both: QualificationTrial[], extra: Parameters<typeof analyzeQualification>[1] = {}) {
  return analyzeQualification(both, { settings: SETTINGS_OK, negativeCases: NEGATIVE_OK, ...extra });
}
const both = (tone: number[], pink: number[] = HONEST, options?: SeriesOptions) => [
  ...trials('tone', tone, options),
  ...trials('pink', pink),
];

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
    expect(sdUpperConfidenceBound(1, 10, 0.95)).toBeCloseTo(Math.sqrt(9 / 3.3251), 3); // 1.6453
  });

  it('needs at least two samples', () => {
    expect(() => sdUpperConfidenceBound(1, 1, 0.95)).toThrow(RangeError);
  });
});

describe('frozen parameters', () => {
  it('are the predeclared values and deeply frozen', () => {
    expect(QUALIFICATION_PARAMS.repeatsPerLevel).toBe(15);
    expect(QUALIFICATION_PARAMS.levelsPerStimulus).toBe(3);
    expect(QUALIFICATION_PARAMS.frozenLevelsDb).toEqual([-30, -18, -6]);
    expect(QUALIFICATION_PARAMS.maxAttemptsPerSlot).toBe(2);
    expect(QUALIFICATION_PARAMS.stepToleranceDb).toBe(2);
    expect(QUALIFICATION_PARAMS.maxSdUpperBoundDb).toBe(1.5);
    expect(QUALIFICATION_PARAMS.confidence).toBe(0.95);
    expect(QUALIFICATION_PARAMS.requiredNegativeCases).toEqual(['N1', 'N2']);
    expect(QUALIFICATION_PARAMS.minNegativeWindows).toBe(10);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N1).toBe(0);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N2).toBe(0);
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N3).toBeNull();
    expect(QUALIFICATION_PARAMS.negativeCaseLimits.N8).toBeNull();
    expect([...EXCLUSION_REASONS]).toEqual(['blocked', 'disturbed', 'interrupted', 'capture_fault']);
    expect(Object.isFrozen(QUALIFICATION_PARAMS)).toBe(true);
    expect(Object.isFrozen(QUALIFICATION_PARAMS.frozenLevelsDb)).toBe(true);
    expect(Object.isFrozen(QUALIFICATION_PARAMS.negativeCaseLimits)).toBe(true);
  });
});

describe('an honest pass', () => {
  const result = run(both(HONEST, [22, 33.5, 45]));

  it('passes every criterion', () => {
    expect(result.status).toBe('passed');
    expect(result.byCriterion).toEqual({ C1: true, C2: true, C3: true, C4: true, C5: true, C6: true, C7: true });
    expect(result.criteria.every((c) => c.pass)).toBe(true);
    expect(result.limited).toBeNull();
    expect(result.paramsAccepted).toBe(true);
  });

  it('reports the medians, SD and upper bound per level', () => {
    const tone = result.levels.tone;
    expect(tone.map((l) => l.nominalDb)).toEqual([-30, -18, -6]);
    expect(tone.map((l) => l.median)).toEqual([20, 32, 44]);
    expect(tone.every((l) => l.n === 15)).toBe(true);
    expect(tone[0]?.sd).toBeCloseTo(0.60238, 4); // sqrt(5.08 / 14)
    expect(tone[0]?.sdUpperBound).toBeCloseTo(0.60238 * 1.4597, 3); // 0.879
    expect(result.levels.pink.map((l) => l.median)).toEqual([22, 33.5, 45]);
  });

  it('echoes the frozen parameters and reports the plan: 45 slots per stimulus, no exclusions', () => {
    expect(result.params).toBe(QUALIFICATION_PARAMS);
    expect(result.planned.tone).toEqual({ slots: 45, entries: 45, countedSlots: 45, excluded: 0 });
    expect(result.planned.pink).toEqual({ slots: 45, entries: 45, countedSlots: 45, excluded: 0 });
    expect(result.exclusions).toEqual({ count: 0, byReason: { blocked: 0, disturbed: 0, interrupted: 0, capture_fault: 0 }, unrecognised: 0 });
  });

  it('slots are optional: entries without a slot are each their own slot', () => {
    const noSlots = both(HONEST).map((t) => {
      const { slot: _slot, ...rest } = t;
      return rest as QualificationTrial;
    });
    expect(run(noSlots).status).toBe('passed');
  });
});

describe('the synthetic 3:1 compression case must FAIL (A9-01)', () => {
  it('12 dB nominal steps measured as 4 dB steps: monotonic, tight and unclipped, but the slope criterion fails', () => {
    const compressed = [20, 24, 28]; // 12 dB nominal -> 4 dB measured
    const r = run(both(compressed, compressed));
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

  it('2:1 and 1.5:1 compression also fail; 10.5 dB per 12 dB passes the slope criterion at the edge', () => {
    for (const steps of [6, 8]) {
      const c = [20, 20 + steps, 20 + 2 * steps];
      expect(run(both(c, c)).byCriterion.C2, `${steps} dB`).toBe(false);
    }
    const edge = [20, 30, 40]; // 10 dB per 12 dB nominal: |10 - 12| = 2 passes
    expect(run(both(edge, edge)).byCriterion.C2).toBe(true);
    const outside = [20, 29.9, 40];
    expect(run(both(outside, edge)).byCriterion.C2).toBe(false);
  });

  it('N-08: a relabelled compressor cannot pass. Closely spaced nominal labels fail C3 and the status', () => {
    // 3:1 compressor measured at labels -30, -28, -26: measured steps 0.67 dB vs nominal 2 dB would pass C2 on its own
    const relabelled = [-30, -28, -26];
    const c = [20, 20.67, 21.33];
    const r = run([...trials('tone', c, { nominal: relabelled }), ...trials('pink', c, { nominal: relabelled })]);
    expect(r.byCriterion.C2).toBe(true); // the slope check alone is fooled by the labels
    expect(r.byCriterion.C3).toBe(false); // the frozen levels are enforced here
    expect(r.status).toBe('failed');
    expect(r.criteria.find((c3) => c3.id === 'C3:tone')?.detail).toContain('outside the frozen set');
  });

  it('N-08: a level set that is one frozen level short, or has a fourth level, fails C3', () => {
    const missing = run([...trials('tone', [20, 32], { nominal: [-30, -18] }), ...trials('pink', HONEST)]);
    expect(missing.byCriterion.C3).toBe(false);
    const extra = run([
      ...trials('tone', HONEST),
      ...trials('tone', [50], { nominal: [0] }),
      ...trials('pink', HONEST),
    ]);
    expect(extra.byCriterion.C3).toBe(false);
    expect(extra.status).toBe('failed');
  });

  it('N-08: the right number of levels with one wrong label fails C3', () => {
    const wrong = run([...trials('tone', HONEST, { nominal: [-30, -18, -5] }), ...trials('pink', HONEST)]);
    expect(wrong.byCriterion.C3).toBe(false);
  });
});

describe('a noisy fail (A9-05)', () => {
  it('SD 1.2 dB: even with correct medians the upper bound 1.76 dB exceeds 1.5 dB', () => {
    const r = run(both(HONEST, HONEST, { scale: 2 }));
    expect(r.levels.tone[0]?.sd).toBeCloseTo(1.2048, 3); // 0.60238 * 2
    expect(r.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.7586, 3);
    expect(r.byCriterion.C4).toBe(false);
    expect(r.criteria.find((c) => c.id === 'C4:pink')?.pass).toBe(true);
    expect(r.status).toBe('failed');
  });

  it('boundary: scale 1.70 gives an upper bound of 1.4948 (pass), scale 1.72 gives 1.5124 (fail)', () => {
    const pass = run(both(HONEST, HONEST, { scale: 1.7 }));
    expect(pass.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.4948, 3);
    expect(pass.byCriterion.C4).toBe(true);
    const fail = run(both(HONEST, HONEST, { scale: 1.72 }));
    expect(fail.levels.tone[0]?.sdUpperBound).toBeCloseTo(1.5124, 3);
    expect(fail.byCriterion.C4).toBe(false);
  });
});

describe('the other criteria', () => {
  it('C1: non-monotonic medians fail (and so does the slope)', () => {
    const r = run(both([20, 44, 32]));
    expect(r.byCriterion.C1).toBe(false);
    expect(r.byCriterion.C2).toBe(false);
  });

  it('C1: equal medians are not strictly increasing', () => {
    expect(run(both([20, 20, 44])).byCriterion.C1).toBe(false);
  });

  it('C3: 14 planned repeats at one level fail (the plan has 15 slots per level), and 16 fail too', () => {
    const short = run([...trials('tone', HONEST, { repeats: 14 }), ...trials('pink', HONEST)]);
    expect(short.byCriterion.C3).toBe(false);
    expect(short.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('lists 14 planned slots, expected 15');
    const long = run([...trials('tone', HONEST, { repeats: 16 }), ...trials('pink', HONEST)]);
    expect(long.byCriterion.C3).toBe(false);
    expect(run(both(HONEST)).byCriterion.C3).toBe(true);
  });

  it('C5: a single clipped frame in any attempt fails', () => {
    const r = run(both(HONEST, HONEST, { clippedAt: 2 }));
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

  it('no attempts at all is not_run; attempts that are all excluded are failed', () => {
    expect(analyzeQualification([]).status).toBe('not_run');
    const allExcluded = both(HONEST).map((t) => ({ ...t, exclusion: 'disturbed' as const }));
    const r = run(allExcluded);
    expect(r.status).toBe('failed');
    expect(r.byCriterion.C3).toBe(false);
  });

  it('a missing stimulus fails its criteria', () => {
    const onlyTone = run(trials('tone', HONEST));
    expect(onlyTone.byCriterion.C1).toBe(false);
    expect(onlyTone.byCriterion.C3).toBe(false);
    expect(onlyTone.status).toBe('failed');
  });
});

describe('C7 negative cases (A9-03, N-09)', () => {
  const data = both(HONEST);
  const without = (...ids: string[]) => NEGATIVE_OK.filter((n) => !ids.includes(n.id));

  it('a gated negative case over its limit sets limited noise-sensitive', () => {
    const fan = run(data, { negativeCases: [{ id: 'N1', windows: 10, scoredReached: 1 }, ...without('N1')] });
    expect(fan.byCriterion.C7).toBe(false);
    expect(fan.limited).toBe('noise-sensitive');
    expect(fan.status).toBe('failed');
    const tv = run(data, { negativeCases: [{ id: 'N2', windows: 10, scoredReached: 2, blockedOrContaminated: 8 }, ...without('N2')] });
    expect(tv.limited).toBe('noise-sensitive');
  });

  it('ungated cases (second speaker, cough, music, quiet-room silent speaker) are reported, not gated', () => {
    const r = run(data, {
      negativeCases: [
        { id: 'N1', windows: 10, scoredReached: 0 },
        { id: 'N2', windows: 10, scoredReached: 0 },
        { id: 'N3', windows: 10, scoredReached: 10 },
        { id: 'N4', windows: 10, scoredReached: 10 },
        { id: 'N5', windows: 10, scoredReached: 10 },
        { id: 'N8', windows: 10, scoredReached: 2 },
      ],
    });
    expect(r.byCriterion.C7).toBe(true);
    expect(r.limited).toBeNull();
  });

  it.each([
    ['missing results', undefined],
    ['an empty list', []],
    ['only N3 to N8', without('N1', 'N2')],
    ['N1 missing', without('N1')],
    ['N2 missing', without('N2')],
    ['N1 listed twice', [...NEGATIVE_OK, { id: 'N1', windows: 10, scoredReached: 0 }]],
    ['N2 listed twice', [...NEGATIVE_OK, { id: 'N2', windows: 10, scoredReached: 0 }]],
    ['an ungated case listed twice', [...NEGATIVE_OK, { id: 'N5', windows: 10, scoredReached: 0 }]],
    ['an unknown case id', [...NEGATIVE_OK, { id: 'N9', windows: 10, scoredReached: 0 }]],
    ['N1 with scoredReached NaN', [{ id: 'N1', windows: 10, scoredReached: Number.NaN }, ...without('N1')]],
    ['N1 with scoredReached Infinity', [{ id: 'N1', windows: 10, scoredReached: Number.POSITIVE_INFINITY }, ...without('N1')]],
    ['N1 with a negative count', [{ id: 'N1', windows: 10, scoredReached: -3 }, ...without('N1')]],
    ['N1 with a fractional count', [{ id: 'N1', windows: 10, scoredReached: 0.5 }, ...without('N1')]],
    ['N1 with more reached than windows', [{ id: 'N1', windows: 10, scoredReached: 11 }, ...without('N1')]],
    ['N2 run on 1 window', [{ id: 'N2', windows: 1, scoredReached: 0 }, ...without('N2')]],
    ['N2 run on 9 windows', [{ id: 'N2', windows: 9, scoredReached: 0 }, ...without('N2')]],
    ['N1 with non-finite windows', [{ id: 'N1', windows: Number.NaN, scoredReached: 0 }, ...without('N1')]],
    ['N1 with a string count', [{ id: 'N1', windows: 10, scoredReached: '0' as unknown as number }, ...without('N1')]],
    ['an ungated case with NaN', [{ id: 'N3', windows: 10, scoredReached: Number.NaN }, ...without('N3')]],
    ['a bad blockedOrContaminated', [{ id: 'N2', windows: 10, scoredReached: 0, blockedOrContaminated: 11 }, ...without('N2')]],
  ] as Array<[string, NegativeCaseResult[] | undefined]>)('fails C7 for %s', (_label, negativeCases) => {
    const r = analyzeQualification(data, { settings: SETTINGS_OK, ...(negativeCases !== undefined ? { negativeCases } : {}) });
    expect(r.byCriterion.C7).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('exactly 10 windows is enough and more than 10 is allowed', () => {
    const r = run(data, { negativeCases: [{ id: 'N1', windows: 10, scoredReached: 0 }, { id: 'N2', windows: 12, scoredReached: 0 }] });
    expect(r.byCriterion.C7).toBe(true);
  });
});

describe('planned trial list and exclusions (N-10)', () => {
  /** Replace the first attempt of the given slots by an excluded attempt plus a counted re-run. */
  function withReruns(base: QualificationTrial[], slots: string[], reason: ExclusionReason): QualificationTrial[] {
    const out: QualificationTrial[] = [];
    for (const t of base) {
      if (t.stimulus === 'tone' && t.nominalDb === -30 && slots.includes(t.slot as string)) {
        out.push({ ...t, rel95Db: null, exclusion: reason }, t); // excluded first attempt, counted re-run with the same slot
      } else out.push(t);
    }
    return out;
  }

  it('an excluded first attempt that was re-run once is allowed and is reported with its reason', () => {
    const data = withReruns(both(HONEST), ['L1-03', 'L1-07'], 'blocked');
    const r = run(data);
    expect(r.status).toBe('passed');
    expect(r.exclusions.count).toBe(2);
    expect(r.exclusions.byReason).toEqual({ blocked: 2, disturbed: 0, interrupted: 0, capture_fault: 0 });
    expect(r.planned.tone).toEqual({ slots: 45, entries: 47, countedSlots: 45, excluded: 2 });
    expect(r.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('2 excluded');
  });

  it('dropping trials fails: a planned slot without a counted attempt fails C3 and the status', () => {
    const data = both(HONEST).map((t) =>
      t.stimulus === 'tone' && t.nominalDb === -30 && ['L1-01', 'L1-02', 'L1-03'].includes(t.slot as string)
        ? { ...t, exclusion: 'disturbed' as const }
        : t,
    );
    const r = run(data);
    expect(r.byCriterion.C3).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.exclusions.count).toBe(3);
    expect(r.exclusions.byReason.disturbed).toBe(3);
    expect(r.planned.tone.countedSlots).toBe(42);
    expect(r.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('has no counted attempt');
  });

  it('cherry-picking cannot pass: excluding the worst 5 of 20 attempts per level leaves 20 planned slots, not 15', () => {
    // 20 attempts per level with a wide spread; drop the 5 farthest from the median, as a cherry-picker would
    const wide = trials('tone', HONEST, { repeats: 20, scale: 1.7 });
    const kept: QualificationTrial[] = [];
    for (const level of FROZEN) {
      const group = wide.filter((t) => t.nominalDb === level);
      const med = [...group].sort((a, b) => (a.rel95Db as number) - (b.rel95Db as number))[10]?.rel95Db as number;
      const sorted = [...group].sort((a, b) => Math.abs((a.rel95Db as number) - med) - Math.abs((b.rel95Db as number) - med));
      kept.push(...sorted.slice(0, 15), ...sorted.slice(15).map((t) => ({ ...t, exclusion: 'disturbed' as const })));
    }
    const r = run([...kept, ...trials('pink', HONEST)]);
    expect(r.byCriterion.C3).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.exclusions.count).toBe(15);
  });

  it('two counted attempts in one slot, or three attempts, fail C3', () => {
    const dup = both(HONEST);
    const first = dup.find((t) => t.stimulus === 'tone' && t.slot === 'L2-05') as QualificationTrial;
    expect(run([...dup, { ...first }]).byCriterion.C3).toBe(false);
    const three = [...dup, { ...first, rel95Db: null, exclusion: 'blocked' as const }, { ...first, rel95Db: null, exclusion: 'blocked' as const }];
    const r = run(three);
    expect(r.byCriterion.C3).toBe(false);
    expect(r.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('attempts (at most 2)');
  });

  it('an exclusion reason outside the closed set (an outlier, a legacy flag) fails C3 and is counted as unrecognised', () => {
    const data = both(HONEST).map((t) =>
      t.stimulus === 'tone' && t.slot === 'L3-15' ? ({ ...t, exclusion: 'outlier' } as unknown as QualificationTrial) : t,
    );
    const r = run(data);
    expect(r.byCriterion.C3).toBe(false);
    expect(r.exclusions.unrecognised).toBe(1);
    expect(r.exclusions.count).toBe(0);
    expect(r.criteria.find((c) => c.id === 'C3:tone')?.detail).toContain('excluded with a reason outside blocked/disturbed/interrupted/capture_fault');
  });

  it('a clipped frame in an excluded attempt still fails C5', () => {
    const data = [...both(HONEST), { stimulus: 'tone' as const, nominalDb: -6, slot: 'L3-02', rel95Db: null, clippedFrames: 1, exclusion: 'disturbed' as const }];
    const r = run(data);
    expect(r.byCriterion.C5).toBe(false);
    expect(r.byCriterion.C3).toBe(true); // slot L3-02 has its counted attempt plus one excluded re-run
    expect(r.levels.tone.find((l) => l.nominalDb === -6)?.clippedFrames).toBe(1); // reported per level as well
    expect(r.levels.tone.find((l) => l.nominalDb === -18)?.clippedFrames).toBe(0);
  });

  it('every closed reason code is accepted', () => {
    for (const reason of EXCLUSION_REASONS) {
      expect(run(withReruns(both(HONEST), ['L1-01'], reason)).status, reason).toBe('passed');
    }
  });
});

describe('the parameters cannot be relaxed (N-11)', () => {
  it('a params override that differs from the frozen values fails the analysis and is flagged', () => {
    const squeezed = both([20, 24, 28], [20, 24, 28]);
    const relaxedParams = { ...QUALIFICATION_PARAMS, stepToleranceDb: 12 };
    const r = analyzeQualification(squeezed, { settings: SETTINGS_OK, negativeCases: NEGATIVE_OK, params: relaxedParams } as never);
    expect(r.status).toBe('failed');
    expect(r.paramsAccepted).toBe(false);
    expect(r.byCriterion.C2).toBe(false); // the override did not take effect
    expect(r.criteria.some((c) => c.id === 'PARAMS' && !c.pass)).toBe(true);
    expect(r.params).toBe(QUALIFICATION_PARAMS);
  });

  it('even an honest dataset fails when a different params object is supplied', () => {
    const r = analyzeQualification(both(HONEST), {
      settings: SETTINGS_OK,
      negativeCases: NEGATIVE_OK,
      params: { ...QUALIFICATION_PARAMS, maxSdUpperBoundDb: 99 },
    } as never);
    expect(r.status).toBe('failed');
    expect(r.paramsAccepted).toBe(false);
  });

  it('supplying the frozen parameters themselves is harmless', () => {
    const r = analyzeQualification(both(HONEST), { settings: SETTINGS_OK, negativeCases: NEGATIVE_OK, params: QUALIFICATION_PARAMS } as never);
    expect(r.status).toBe('passed');
    expect(r.paramsAccepted).toBe(true);
  });
});

describe('non-finite and malformed numbers fail their criterion', () => {
  const tweak = (mutate: (t: QualificationTrial) => QualificationTrial): QualificationTrial[] =>
    both(HONEST).map((t) => (t.stimulus === 'tone' && t.slot === 'L2-04' && t.nominalDb === -18 ? mutate(t) : t));

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('a counted attempt with rel95Db %s fails C1, C2 and C4 (never a quiet pass)', (_n, bad) => {
    const r = run(tweak((t) => ({ ...t, rel95Db: bad })));
    expect(r.byCriterion.C1).toBe(false);
    expect(r.byCriterion.C2).toBe(false);
    expect(r.byCriterion.C4).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.criteria.find((c) => c.id === 'C1:tone')?.detail).toContain('non-finite');
  });

  it('a counted attempt with a null rel95Db fails the same way', () => {
    const r = run(tweak((t) => ({ ...t, rel95Db: null })));
    expect(r.byCriterion.C4).toBe(false);
    expect(r.status).toBe('failed');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['fractional', 0.5],
  ])('clippedFrames %s fails C5', (_n, bad) => {
    const r = run(tweak((t) => ({ ...t, clippedFrames: bad })));
    expect(r.byCriterion.C5).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.criteria.find((c) => c.id === 'C5:tone')?.detail).toContain('not a finite non-negative integer');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('a nominal level of %s fails C3', (_n, bad) => {
    const r = run(tweak((t) => ({ ...t, nominalDb: bad })));
    expect(r.byCriterion.C3).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('a non-finite rel95Db in an excluded attempt is ignored (a blocked trial has no window)', () => {
    const data = both(HONEST);
    const extra: QualificationTrial = { stimulus: 'tone', nominalDb: -30, slot: 'L1-01', rel95Db: Number.NaN, clippedFrames: 0, exclusion: 'blocked' };
    expect(run([...data, extra]).status).toBe('passed');
  });
});

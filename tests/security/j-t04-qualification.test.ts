/**
 * T16 gate, part J: independent check of the frozen T04 qualification analysis (`analyzeQualification`,
 * packages/phone-mic-meter/src/qualification.ts, frozen with docs/evaluation/T04-protocol.md revision 3).
 *
 * Question asked: can a FAILED experiment become a PASS? (ADR-0009, finding A9-01.) The inputs are synthetic series
 * generated here. Evidence class: automated, synthetic; nothing about a real phone.
 *
 * Tests wrapped in it.fails assert the behaviour the protocol document promises and the code does not deliver yet.
 * Revision 3 (dsp): N-08, N-09, N-10 and N-11 are fixed; their tests are plain `it` below and N-10/N-11 now assert the fix.
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
  it('N-08 (fixed in revision 3): the slope criterion cannot be passed by an AGC-compressed input that was measured at closely spaced nominal levels (levels must be the frozen -30, -18, -6 dBFS or at least 10 dB apart)', () => {
    // Nominal levels 2 dB apart, a 3:1 compressor: measured steps 0.67 dB, |0.67 - 2| = 1.33 <= 2 dB, so C2 passes.
    const a = run(series({ slope: 1 / 3, sd: 0.1, levels: [-30, -28, -26] }));
    expect(a.status).toBe('failed');
    // T16 re-review of revision 3: C2 alone would still pass (1.33 dB inside 2 dB); it is C3 that refuses the labels.
    expect(a.byCriterion.C2).toBe(true);
    expect(a.byCriterion.C3).toBe(false);
    expect(a.criteria.find((c) => c.id === 'C3:tone')?.detail).toMatch(/outside the frozen set/);
    // shifted levels and a fourth level are refused the same way
    expect(run(series({ slope: 1, levels: [-31, -19, -7] })).byCriterion.C3).toBe(false);
    expect(run(series({ slope: 1, levels: [-30, -24, -18, -6] })).byCriterion.C3).toBe(false);
    expect(run(series({ slope: 1, levels: [-30, -18] })).byCriterion.C3).toBe(false);
  });

  it('N-09 (fixed in revision 3): the negative-case criterion fails when N1 or N2 results are missing, malformed or run with fewer than 10 windows (protocol section 8: "Missing results fail C7")', () => {
    const trials = series({ slope: 1 });
    const cases: Array<[string, NegativeCaseResult[]]> = [
      ['an empty list', []],
      ['only the ungated cases N3 to N7', NEG_OK.filter((n) => !['N1', 'N2'].includes(n.id))],
      ['N1 with scoredReached NaN', [{ id: 'N1', windows: 10, scoredReached: Number.NaN }, ...NEG_OK.filter((n) => n.id !== 'N1')]],
      ['N1 with a negative count', [{ id: 'N1', windows: 10, scoredReached: -3 }, ...NEG_OK.filter((n) => n.id !== 'N1')]],
      ['N2 run on 1 window', [{ id: 'N2', windows: 1, scoredReached: 0 }, ...NEG_OK.filter((n) => n.id !== 'N2')]],
    ];
    for (const [label, neg] of cases) {
      const a = run(trials, neg);
      expect(a.status, label).toBe('failed');
      expect(a.byCriterion.C7, label).toBe(false); // the honest level series passes C1 to C6, so C7 is what refuses
      expect(a.byCriterion.C1 && a.byCriterion.C2 && a.byCriterion.C3 && a.byCriterion.C4 && a.byCriterion.C5 && a.byCriterion.C6, label).toBe(true);
    }
  });

  it('N-11 (fixed in revision 3): a caller cannot relax the criteria; a different params object fails the analysis and the result echoes the frozen parameters', () => {
    const squeezed = series({ slope: 1 / 3, sd: 0.3 });
    expect(run(squeezed).status).toBe('failed');
    const relaxed = analyzeQualification(squeezed, { params: { ...QUALIFICATION_PARAMS, stepToleranceDb: 12 }, settings: SETTINGS, negativeCases: NEG_OK } as never);
    expect(relaxed.status).toBe('failed');
    expect(relaxed.byCriterion.C2).toBe(false);
    expect(Object.keys(relaxed)).toContain('params');
    expect(relaxed.params).toEqual(QUALIFICATION_PARAMS);
    expect(relaxed.paramsAccepted).toBe(false);
  });

  it('N-10 (fixed in revision 3): the analysis takes the full planned list; cherry-picking by exclusion fails C3 and the exclusions are counted with their reasons', () => {
    const lots = series({ slope: 1, n: 20, sd: 1.0, seed: 9 });
    // drop, per level, the five trials farthest from the level median, the way a cherry-picker would
    const kept: QualificationTrial[] = [];
    for (const stimulus of ['tone', 'pink'] as const) {
      for (const level of LEVELS) {
        const group = lots.filter((t) => t.stimulus === stimulus && t.nominalDb === level);
        const med = [...group].sort((a, b) => (a.rel95Db as number) - (b.rel95Db as number))[10]?.rel95Db ?? 0;
        const sorted = [...group].sort((a, b) => Math.abs((a.rel95Db as number) - med) - Math.abs((b.rel95Db as number) - med));
        kept.push(...sorted.slice(0, 15), ...sorted.slice(15).map((t) => ({ ...t, exclusion: 'disturbed' as const })));
      }
    }
    const picked = run(kept);
    expect(picked.byCriterion.C3).toBe(false); // 20 planned slots per level are listed, the plan has 15
    expect(picked.status).toBe('failed');
    expect(picked.exclusions.count).toBe(30);
    expect(picked.exclusions.byReason.disturbed).toBe(30);
    // the original trick, a boolean flag with no reason, is no longer an input: it is ignored, so those trials count
    const legacy = run(lots.map((t, i) => (i % 4 === 0 ? ({ ...t, valid: false } as unknown as QualificationTrial) : t)));
    expect(legacy.byCriterion.C3).toBe(false); // 20 counted slots per level, not 15
  });
});

/* ------------------------------------------------------------------------------------------------------------------
 * T16 follow-up: independent re-review of revision 3 (qualification.ts at c935e48, freeze hash b9b93100...). These tests
 * were written against the revision 3 code and the protocol text, not against the dsp owner's tests.
 * ---------------------------------------------------------------------------------------------------------------- */

/** The full plan: 15 slots per frozen level and stimulus, slot codes L1-01 .. L3-15. `rerun` marks slots whose first attempt is excluded. */
function planned(opts: { slope?: number; sd?: number; seed?: number; rerun?: Record<string, QualificationTrial['exclusion']>; clippedFirst?: number } = {}): QualificationTrial[] {
  const r = rng(opts.seed ?? 5);
  const out: QualificationTrial[] = [];
  for (const stimulus of ['tone', 'pink'] as const) {
    LEVELS.forEach((nominalDb, li) => {
      for (let k = 1; k <= 15; k += 1) {
        const slot = `L${li + 1}-${String(k).padStart(2, '0')}`;
        const rel95Db = 25 + (opts.slope ?? 1) * (nominalDb + 30) + (opts.sd ?? 0.4) * gauss(r);
        const reason = opts.rerun?.[`${stimulus}:${slot}`];
        if (reason !== undefined) out.push({ stimulus, nominalDb, slot, rel95Db: rel95Db + 5, clippedFrames: opts.clippedFirst ?? 0, exclusion: reason });
        out.push({ stimulus, nominalDb, slot, rel95Db, clippedFrames: 0 });
      }
    });
  }
  return out;
}

describe('revision 3 re-review: the planned trial list (C3, N-08, N-10)', () => {
  it('a complete plan with two re-run slots passes, and the output reports the plan, the exclusions and the frozen parameters', () => {
    const a = run(planned({ rerun: { 'tone:L1-03': 'blocked', 'pink:L3-15': 'disturbed' } }));
    expect(a.status).toBe('passed');
    expect(a.planned.tone).toEqual({ slots: 45, entries: 46, countedSlots: 45, excluded: 1 });
    expect(a.planned.pink).toEqual({ slots: 45, entries: 46, countedSlots: 45, excluded: 1 });
    expect(a.exclusions).toEqual({ count: 2, byReason: { blocked: 1, disturbed: 1, interrupted: 0, capture_fault: 0 }, unrecognised: 0 });
    expect(a.params).toEqual(QUALIFICATION_PARAMS);
    expect(a.paramsAccepted).toBe(true);
    // supplying exactly the frozen parameters is accepted
    const same = analyzeQualification(planned(), { params: QUALIFICATION_PARAMS, settings: SETTINGS, negativeCases: NEG_OK } as never);
    expect(same.paramsAccepted).toBe(true);
    expect(same.status).toBe('passed');
  });

  it('each way of not having the plan fails C3: a missing slot, an extra slot, a slot with no counted attempt, two counted attempts, three attempts, a reason outside the closed set', () => {
    const base = planned();
    const without = (pred: (t: QualificationTrial) => boolean): QualificationTrial[] => base.filter((t) => !pred(t));
    expect(run(without((t) => t.stimulus === 'tone' && t.slot === 'L2-07')).byCriterion.C3).toBe(false); // 14 slots
    expect(run([...base, { stimulus: 'pink', nominalDb: -6, slot: 'L3-16', rel95Db: 49, clippedFrames: 0 }]).byCriterion.C3).toBe(false); // 16 slots
    expect(run(base.map((t) => (t.stimulus === 'tone' && t.slot === 'L1-01' ? { ...t, exclusion: 'blocked' as const } : t))).byCriterion.C3).toBe(false); // no counted attempt
    expect(run([...base, { stimulus: 'tone', nominalDb: -30, slot: 'L1-01', rel95Db: 25, clippedFrames: 0 }]).byCriterion.C3).toBe(false); // two counted
    const three: QualificationTrial[] = [...base, { stimulus: 'tone', nominalDb: -30, slot: 'L1-02', rel95Db: 20, clippedFrames: 0, exclusion: 'blocked' }, { stimulus: 'tone', nominalDb: -30, slot: 'L1-02', rel95Db: 21, clippedFrames: 0, exclusion: 'disturbed' }];
    expect(run(three).byCriterion.C3).toBe(false); // three attempts in a slot
    const odd = run(base.map((t) => (t.stimulus === 'pink' && t.slot === 'L3-03' ? ({ ...t, exclusion: 'outlier' } as unknown as QualificationTrial) : t)));
    expect(odd.byCriterion.C3).toBe(false);
    expect(odd.exclusions.unrecognised).toBe(1);
    // a single stimulus is not a qualification
    expect(run(base.filter((t) => t.stimulus === 'tone')).status).toBe('failed');
  });

  it('clipping in an EXCLUDED attempt still fails C5 (excluding an attempt hides nothing)', () => {
    const a = run(planned({ rerun: { 'tone:L2-02': 'disturbed' }, clippedFirst: 3 }));
    expect(a.byCriterion.C5).toBe(false);
    expect(a.status).toBe('failed');
  });

  it('non-finite and malformed numbers fail the criterion that depends on them and are never skipped', () => {
    const swap = (stimulus: 'tone' | 'pink', slot: string, patch: Partial<QualificationTrial>): QualificationTrial[] =>
      planned().map((t) => (t.stimulus === stimulus && t.slot === slot ? ({ ...t, ...patch } as QualificationTrial) : t));
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const a = run(swap('tone', 'L2-05', { rel95Db: bad }));
      expect(a.byCriterion.C1 || a.byCriterion.C2 || a.byCriterion.C4, String(bad)).toBe(false);
    }
    expect(run(swap('pink', 'L1-01', { clippedFrames: Number.NaN })).byCriterion.C5).toBe(false);
    expect(run(swap('pink', 'L1-01', { clippedFrames: -1 })).byCriterion.C5).toBe(false);
    expect(run(swap('pink', 'L1-01', { clippedFrames: 0.5 })).byCriterion.C5).toBe(false);
    expect(run(swap('tone', 'L3-09', { nominalDb: Number.NaN })).byCriterion.C3).toBe(false);
  });
});

describe('revision 3 re-review: negative cases (C7, N-09) and N8', () => {
  const trials = planned();
  const withCase = (patch: NegativeCaseResult[]): NegativeCaseResult[] => [...NEG_OK.filter((n) => !patch.some((p) => p.id === n.id)), ...patch];
  const c7 = (neg: NegativeCaseResult[]): boolean => run(trials, neg).byCriterion.C7;

  it('malformed or duplicated results fail C7 whatever else is right', () => {
    expect(c7(NEG_OK)).toBe(true);
    expect(c7([...NEG_OK, { id: 'N1', windows: 10, scoredReached: 0 }])).toBe(false); // N1 twice
    expect(c7([...NEG_OK, { id: 'N9', windows: 10, scoredReached: 0 }])).toBe(false); // unknown id
    expect(c7(withCase([{ id: 'N2', windows: 10.5, scoredReached: 0 }]))).toBe(false);
    expect(c7(withCase([{ id: 'N2', windows: 10, scoredReached: 11 }]))).toBe(false); // more reached than windows
    expect(c7(withCase([{ id: 'N2', windows: 10, scoredReached: 0.5 }]))).toBe(false);
    expect(c7(withCase([{ id: 'N1', windows: 10, scoredReached: '0' as unknown as number }]))).toBe(false);
    expect(c7(withCase([{ id: 'N1', windows: 10, scoredReached: 0, blockedOrContaminated: 11 }]))).toBe(false);
    expect(c7(withCase([{ id: 'N1', windows: 9, scoredReached: 0 }]))).toBe(false);
    expect(c7(withCase([{ id: 'N1', windows: 10, scoredReached: 1 }]))).toBe(false);
    expect(run(trials, withCase([{ id: 'N2', windows: 10, scoredReached: 1 }])).limited).toBe('noise-sensitive');
  });

  it('N8 (silent speaker in the real quiet room) is a REPORTED value: it is accepted when present or absent and it never changes the outcome, even at 10 of 10 reached', () => {
    // This pins the decision of protocol revision 3. If N8 is ever gated (a revision 4), this test must change with it.
    const none = run(trials, NEG_OK);
    expect(none.status).toBe('passed');
    for (const reached of [0, 1, 5, 10]) {
      const a = run(trials, [...NEG_OK, { id: 'N8', windows: 10, scoredReached: reached }]);
      expect(a.status, `N8 ${reached} of 10`).toBe('passed');
      expect(a.limited, `N8 ${reached} of 10`).toBeNull();
    }
    // present but malformed is still refused
    expect(c7([...NEG_OK, { id: 'N8', windows: 4, scoredReached: 0 }])).toBe(false);
    expect(c7([...NEG_OK, { id: 'N8', windows: 10, scoredReached: Number.NaN }])).toBe(false);
  });

  it('a window the gate blocked is not scored, so N1 and N2 pass with all ten windows blocked: the limit is vacuous where the gate does its job (by design, A9-03), and only N8 exercises the scoring path', () => {
    const a = run(trials, withCase([{ id: 'N1', windows: 10, scoredReached: 0, blockedOrContaminated: 10 }, { id: 'N2', windows: 10, scoredReached: 0, blockedOrContaminated: 10 }]));
    expect(a.status).toBe('passed');
  });

  it('INFO N-15: an id that is an inherited Object property is not recognised as unknown (the protocol says no case id may be unknown); it cannot change a gated result', () => {
    // `id in params.negativeCaseLimits` is true for 'constructor' and 'toString'. Harmless today; Object.hasOwn would close it.
    expect(c7([...NEG_OK, { id: 'constructor', windows: 10, scoredReached: 0 }])).toBe(true);
    expect(c7([...NEG_OK, { id: 'toString', windows: 10, scoredReached: 10 }])).toBe(true);
    expect(c7(withCase([{ id: 'N1', windows: 10, scoredReached: 1 }, { id: 'constructor', windows: 10, scoredReached: 0 }]))).toBe(false);
  });
});

describe('revision 3 re-review: what the analysis cannot see (residuals, recorded as measured)', () => {
  it('RESIDUAL R24: the exclusion reason is self-declared. Re-running the 4 worst attempts of each level as "disturbed" (fresh draws from the SAME distribution) keeps C3 satisfied and makes a borderline phone pass C4 far more often; the output counts the exclusions but cannot check the live log', () => {
    const sigma = 1.0; // the honest per-trial scatter: the upper bound is 1.46 dB at a sample SD of 1.0, so about half of the cells fail honestly
    const replications = 300;
    let honestPass = 0;
    let rerollPass = 0;
    let c3Always = true;
    let excluded = 0;
    for (let rep = 0; rep < replications; rep += 1) {
      const honest = planned({ sd: sigma, seed: 1000 + rep });
      if (run(honest).byCriterion.C4) honestPass += 1;
      const r = rng(5000 + rep);
      const rolled: QualificationTrial[] = [];
      for (const stimulus of ['tone', 'pink'] as const) {
        for (const level of LEVELS) {
          const cell = honest.filter((t) => t.stimulus === stimulus && t.nominalDb === level);
          const med = [...cell].sort((a, b) => (a.rel95Db as number) - (b.rel95Db as number))[7]?.rel95Db as number;
          const worst = new Set([...cell].sort((a, b) => Math.abs((b.rel95Db as number) - med) - Math.abs((a.rel95Db as number) - med)).slice(0, 4).map((t) => t.slot));
          for (const t of cell) {
            if (worst.has(t.slot)) {
              rolled.push({ ...t, exclusion: 'disturbed' });
              rolled.push({ ...t, rel95Db: 25 + (level + 30) + sigma * gauss(r) });
            } else rolled.push(t);
          }
        }
      }
      const a = run(rolled);
      if (!a.byCriterion.C3) c3Always = false;
      if (a.byCriterion.C4) rerollPass += 1;
      excluded = a.exclusions.count;
    }
    console.log('R24 (sigma 1.0 dB, 300 replications): C4 passes honestly', honestPass / replications, 'with 4 worst per level re-run as disturbed', rerollPass / replications, '; exclusions reported per run', excluded);
    expect(c3Always).toBe(true);
    expect(excluded).toBe(24);
    expect(honestPass / replications).toBeLessThan(0.15);
    expect(rerollPass / replications).toBeGreaterThan(0.5);
  });

  it('RESIDUAL: nothing ties an entry to a recorded trace, so duplicated entries pass; the protocol relies on the unmodified numeric traces and their hashes', () => {
    const one = planned({ seed: 8 }).filter((t) => t.stimulus === 'tone' && t.slot === 'L2-01').map((t) => t.rel95Db as number)[0] as number;
    const same = planned().map((t) => (t.stimulus === 'tone' && t.nominalDb === -18 ? { ...t, rel95Db: one } : t));
    expect(run(same).byCriterion.C4).toBe(true); // SD zero at that level: accepted as arithmetic
  });
});

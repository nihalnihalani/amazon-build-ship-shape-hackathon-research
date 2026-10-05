/**
 * Qualification analysis for the physical-phone experiment (docs/evaluation/T04-protocol.md,
 * revision 3; ADR-0009 as amended by revision 2: A9-01, A9-03, A9-05; T16 findings N-08 to N-11).
 * Pure arithmetic over numeric trial summaries: it returns pass or fail per criterion and never
 * touches audio.
 *
 * THE CRITERIA IN THIS FILE ARE THE FROZEN CRITERIA of the protocol. The SHA-256 of this file,
 * percentile.ts and the protocol document is the freeze hash recorded before the first trial
 * (see fixtures/dsp/tools/freeze_hash.py). They are engineering proposals, not measured accuracy.
 *
 * The analysis takes the FULL planned trial list: 45 planned slots per stimulus (3 frozen levels x
 * 15 repeats), each attempt listed, every excluded attempt carrying a reason code from a closed
 * set. It cannot be made to pass by relabelling levels, dropping trials, or relaxing parameters.
 *
 * Criteria (computed per stimulus, then combined):
 *   C1 monotonic medians: the median rel95 rises strictly with the nominal level.
 *   C2 slope: each adjacent median step is within the nominal step +- 2 dB (A9-01). A compressing
 *      input (for example 3:1) fails here even when it is monotonic, tight and unclipped.
 *   C3 planned trials: the levels are EXACTLY the frozen set (-30, -18, -6 dBFS); each level has
 *      exactly 15 planned slots, every slot has exactly one counted (not excluded) attempt, at most
 *      one re-run per slot, and every exclusion carries one of the closed reason codes (N-08, N-10).
 *   C4 repeatability: the one-sided 95 % upper confidence bound of the per-level SD is at most
 *      1.5 dB: s x sqrt((n - 1) / chi2_{0.05}(n - 1)) <= 1.5 (chi-square, 14 degrees of freedom at
 *      15 repeats) (A9-05).
 *   C5 zero clipped frames in every attempt, counted or excluded (excluding an attempt never hides
 *      a clipped frame).
 *   C6 settings readback: the browser reported autoGainControl false (reported settings are not
 *      proof of an unprocessed signal; they are recorded and required, never sufficient).
 *   C7 negative cases: N1 and N2 each present exactly once with at least 10 windows and a valid
 *      scoredReached count within 0..windows, at most 0 of 10 scored reached (A9-03, N-09).
 *      Exceeding a limit sets `limited: 'noise-sensitive'`.
 * Every numeric input must be finite (and the counts integers): a value that is not fails the
 * criterion that depends on it. The parameters cannot be overridden; the result echoes them.
 */

import { percentile } from './percentile.js';

export type QualificationStimulus = 'tone' | 'pink';

/** Closed set of reasons an attempt may be excluded (protocol sections 4 and 6). Outliers are not one. */
export const EXCLUSION_REASONS = ['blocked', 'disturbed', 'interrupted', 'capture_fault'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** One attempt of a planned level trial: `rel95Db` is the window's p95 level minus the pre-window floor. */
export interface QualificationTrial {
  stimulus: QualificationStimulus;
  /** Nominal digital level of the stimulus file (dBFS peak); must be one of the frozen levels. */
  nominalDb: number;
  /**
   * Planned slot of the order table, for example `L2-14`. A re-run of an excluded attempt carries the
   * same slot. An entry without a slot is its own slot.
   */
  slot?: string;
  /** May be null for an excluded attempt that produced no window (a blocked trial). */
  rel95Db: number | null;
  /** Clipped frames in the attempt's window and precheck. */
  clippedFrames: number;
  /** Absent for a counted attempt; otherwise the reason it is excluded from the statistics. */
  exclusion?: ExclusionReason;
}

export interface NegativeCaseResult {
  /** `N1` .. `N8` (protocol section 5). */
  id: string;
  /** Windows run for this condition (at least 10). */
  windows: number;
  /** Windows scored `reached` while the intended speaker was silent (after the gate). */
  scoredReached: number;
  /** Windows the gate blocked or the analysis marked contaminated (not scored). */
  blockedOrContaminated?: number;
}

export interface QualificationParams {
  stimuli: readonly QualificationStimulus[];
  /** The frozen nominal levels (dBFS peak) of every stimulus, ascending. */
  frozenLevelsDb: readonly number[];
  levelsPerStimulus: number;
  /** Planned slots per level (= repeats per level). */
  repeatsPerLevel: number;
  /** One re-run per slot at most. */
  maxAttemptsPerSlot: number;
  exclusionReasons: readonly ExclusionReason[];
  /** Adjacent median step must be within nominal step +- this many dB. */
  stepToleranceDb: number;
  /** Per-level SD upper confidence bound limit (dB). */
  maxSdUpperBoundDb: number;
  /** One-sided confidence of the SD bound. */
  confidence: number;
  /** Negative cases that must each be present exactly once. */
  requiredNegativeCases: readonly string[];
  /** Minimum windows per negative case. */
  minNegativeWindows: number;
  /** Per negative case: maximum windows scored `reached`; null = reported, not gated. */
  negativeCaseLimits: Readonly<Record<string, number | null>>;
}

/** The frozen, predeclared parameters. They cannot be overridden by the caller. */
export const QUALIFICATION_PARAMS: QualificationParams = Object.freeze({
  stimuli: Object.freeze(['tone', 'pink'] as const),
  frozenLevelsDb: Object.freeze([-30, -18, -6]),
  levelsPerStimulus: 3,
  repeatsPerLevel: 15,
  maxAttemptsPerSlot: 2,
  exclusionReasons: EXCLUSION_REASONS,
  stepToleranceDb: 2,
  maxSdUpperBoundDb: 1.5,
  confidence: 0.95,
  requiredNegativeCases: Object.freeze(['N1', 'N2']),
  minNegativeWindows: 10,
  negativeCaseLimits: Object.freeze({
    N1: 0, // fan: 0 of 10 windows scored reached
    N2: 0, // TV speech: blocked by the gate or contaminated, otherwise 0 reached
    N3: null, // second speaker, cough, music: known limitation (ADR-0001 section 3), reported not gated
    N4: null,
    N5: null,
    N6: null, // moved phone: evidence against cross-session comparison, no limit
    N7: null, // screen lock: lifecycle observation
    N8: null, // silent speaker in the real quiet room: expected 0 of 10, reported value (T16 N-05)
  }),
});

export interface QualificationOptions {
  /** Browser-reported track settings after open; `autoGainControl` must be reported false (C6). */
  settings?: { autoGainControl: boolean | null };
  negativeCases?: readonly NegativeCaseResult[];
}

export interface LevelSummary {
  nominalDb: number;
  /** Counted attempts analysed at this level (one per planned slot). */
  n: number;
  median: number | null;
  /** Sample standard deviation (n - 1); null when n < 2. */
  sd: number | null;
  /** One-sided upper confidence bound of the SD; null when n < 2. */
  sdUpperBound: number | null;
  /** Clipped frames over ALL attempts at this level, counted or excluded. */
  clippedFrames: number;
}

export interface CriterionResult {
  /** `C1` .. `C7`, with the stimulus appended (`C1:tone`) where it is per stimulus. */
  id: string;
  pass: boolean;
  detail: string;
}

export interface PlannedSummary {
  /** Distinct planned slots listed. */
  slots: number;
  /** Attempts listed (counted and excluded). */
  entries: number;
  /** Slots that have exactly one counted attempt. */
  countedSlots: number;
  /** Attempts excluded with a recognised reason. */
  excluded: number;
}

export interface QualificationAnalysis {
  /** `not_run` without any attempt; otherwise `passed` only when every criterion passed. */
  status: 'not_run' | 'passed' | 'failed';
  levels: Record<QualificationStimulus, LevelSummary[]>;
  criteria: CriterionResult[];
  /** Conjunction per criterion over its stimuli. */
  byCriterion: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7', boolean>;
  limited: 'noise-sensitive' | null;
  /** The parameters the analysis ran with: always the frozen ones. */
  params: QualificationParams;
  /** False when the caller tried to pass different parameters: the analysis then fails (N-11). */
  paramsAccepted: boolean;
  /** Excluded attempts by reason (N-10); `unrecognised` counts exclusion values outside the closed set. */
  exclusions: { count: number; byReason: Record<ExclusionReason, number>; unrecognised: number };
  planned: Record<QualificationStimulus, PlannedSummary>;
}

const TOLERANCE = 1e-9;

// ---- chi-square quantile ---------------------------------------------------

/** ln Gamma(x) for x > 0 (Lanczos approximation, g = 7, n = 9). */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const xm = x - 1;
  let a = c[0] as number;
  const t = xm + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (xm + i);
  return 0.5 * Math.log(2 * Math.PI) + (xm + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma function P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = logGamma(a);
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // continued fraction (modified Lentz)
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Cumulative distribution function of the chi-square distribution with `df` degrees of freedom. */
export function chiSquareCdf(x: number, df: number): number {
  return gammaP(df / 2, x / 2);
}

/** The value `q` with P(chi-square(df) <= q) = p, by bisection (accurate to about 1e-10). */
export function chiSquareQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be within (0, 1)');
  if (!(df > 0)) throw new RangeError('df must be positive');
  let lo = 0;
  let hi = Math.max(1, df);
  while (chiSquareCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

/**
 * One-sided upper confidence bound of a standard deviation from `n` samples with sample SD `sd`:
 * sd × sqrt((n − 1) / chi2_{1 − confidence}(n − 1)), where chi2_{1 − confidence} is the lower-tail
 * quantile (the 5th percentile at 95 % confidence).
 */
export function sdUpperConfidenceBound(sd: number, n: number, confidence: number): number {
  if (n < 2) throw new RangeError('need at least 2 samples');
  return sd * Math.sqrt((n - 1) / chiSquareQuantile(1 - confidence, n - 1));
}

function sampleSd(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  return Math.sqrt(ss / (n - 1));
}

// ---- analysis ------------------------------------------------------------------

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
const isExclusionReason = (v: unknown): v is ExclusionReason =>
  typeof v === 'string' && (EXCLUSION_REASONS as readonly string[]).includes(v);

interface StimulusAnalysis {
  levels: LevelSummary[];
  planned: PlannedSummary;
  /** Problems with the plan (levels, slots, reasons); empty when C3 holds. */
  planProblems: string[];
  nonFiniteRel: number;
  badClipCounts: number;
  clippedFrames: number;
  excluded: Record<ExclusionReason, number>;
  unrecognised: number;
}

function analyzeStimulus(entries: readonly QualificationTrial[], params: QualificationParams): StimulusAnalysis {
  const planProblems: string[] = [];
  const excluded: Record<ExclusionReason, number> = { blocked: 0, disturbed: 0, interrupted: 0, capture_fault: 0 };
  let unrecognised = 0;
  let badClipCounts = 0;
  let clippedFrames = 0;
  let nonFiniteRel = 0;

  // group by level, then by slot
  const byLevel = new Map<number, Map<string, QualificationTrial[]>>();
  const offFrozen = new Set<string>();
  entries.forEach((e, index) => {
    if (!isFiniteNumber(e.nominalDb) || !params.frozenLevelsDb.includes(e.nominalDb)) {
      offFrozen.add(String(e.nominalDb));
    }
    const level = isFiniteNumber(e.nominalDb) ? e.nominalDb : Number.NaN;
    const slotKey = typeof e.slot === 'string' && e.slot.length > 0 ? e.slot : `#entry-${index}`;
    const slots = byLevel.get(level) ?? new Map<string, QualificationTrial[]>();
    const list = slots.get(slotKey) ?? [];
    list.push(e);
    slots.set(slotKey, list);
    byLevel.set(level, slots);

    if (e.exclusion !== undefined) {
      if (isExclusionReason(e.exclusion)) excluded[e.exclusion] += 1;
      else unrecognised += 1;
    }
    if (isCount(e.clippedFrames)) clippedFrames += e.clippedFrames;
    else badClipCounts += 1;
  });

  if (offFrozen.size > 0) {
    planProblems.push(`levels outside the frozen set ${params.frozenLevelsDb.join(', ')} dBFS: ${[...offFrozen].join(', ')}`);
  }
  for (const frozen of params.frozenLevelsDb) {
    if (!byLevel.has(frozen)) planProblems.push(`frozen level ${frozen} dBFS has no attempts`);
  }
  if (unrecognised > 0) planProblems.push(`${unrecognised} attempts excluded with a reason outside ${params.exclusionReasons.join('/')}`);

  let slotCount = 0;
  let countedSlots = 0;
  const levels: LevelSummary[] = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const slots = byLevel.get(level) as Map<string, QualificationTrial[]>;
    const frozen = params.frozenLevelsDb.includes(level);
    const counted: number[] = [];
    let levelClipped = 0;
    for (const [slot, list] of slots) {
      slotCount += 1;
      const countedHere = list.filter((e) => e.exclusion === undefined);
      if (countedHere.length === 1) {
        countedSlots += 1;
        const v = (countedHere[0] as QualificationTrial).rel95Db;
        if (isFiniteNumber(v)) counted.push(v);
        else nonFiniteRel += 1;
      } else if (countedHere.length === 0) {
        if (frozen) planProblems.push(`slot ${slot} at ${level} dBFS has no counted attempt`);
      } else if (frozen) {
        planProblems.push(`slot ${slot} at ${level} dBFS has ${countedHere.length} counted attempts`);
      }
      if (list.length > params.maxAttemptsPerSlot && frozen) {
        planProblems.push(`slot ${slot} at ${level} dBFS has ${list.length} attempts (at most ${params.maxAttemptsPerSlot})`);
      }
      for (const e of list) if (isCount(e.clippedFrames)) levelClipped += e.clippedFrames;
    }
    if (frozen && slots.size !== params.repeatsPerLevel) {
      planProblems.push(`level ${level} dBFS lists ${slots.size} planned slots, expected ${params.repeatsPerLevel}`);
    }
    const n = counted.length;
    const sd = n >= 2 ? sampleSd(counted) : null;
    levels.push({
      nominalDb: level,
      n,
      median: percentile(counted, 50),
      sd,
      sdUpperBound: sd === null ? null : sdUpperConfidenceBound(sd, n, params.confidence),
      clippedFrames: levelClipped,
    });
  }

  const excludedCount = excluded.blocked + excluded.disturbed + excluded.interrupted + excluded.capture_fault;
  return {
    levels,
    planned: { slots: slotCount, entries: entries.length, countedSlots, excluded: excludedCount },
    planProblems,
    nonFiniteRel,
    badClipCounts,
    clippedFrames,
    excluded,
    unrecognised,
  };
}

function sameParams(a: unknown, b: QualificationParams): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** C7 validation: returns the problems found (empty when the results are well formed). */
function negativeCaseProblems(results: readonly NegativeCaseResult[], params: QualificationParams): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const r of results) {
    const id = typeof r?.id === 'string' ? r.id : '(no id)';
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (!(id in params.negativeCaseLimits)) problems.push(`unknown negative case ${id}`);
    if (!isCount(r?.windows)) problems.push(`${id}: windows is not a finite non-negative integer`);
    else if (r.windows < params.minNegativeWindows) problems.push(`${id}: ${r.windows} windows (need at least ${params.minNegativeWindows})`);
    if (!isCount(r?.scoredReached)) problems.push(`${id}: scoredReached is not a finite non-negative integer`);
    else if (isCount(r?.windows) && r.scoredReached > r.windows) problems.push(`${id}: scoredReached ${r.scoredReached} exceeds windows ${r.windows}`);
    if (r?.blockedOrContaminated !== undefined) {
      if (!isCount(r.blockedOrContaminated) || (isCount(r.windows) && r.blockedOrContaminated > r.windows)) {
        problems.push(`${id}: blockedOrContaminated is not a count within 0..windows`);
      }
    }
  }
  for (const [id, count] of seen) if (count !== 1) problems.push(`${id} appears ${count} times (exactly once required)`);
  for (const id of params.requiredNegativeCases) if (!seen.has(id)) problems.push(`${id} is missing`);
  return problems;
}

export function analyzeQualification(
  trials: readonly QualificationTrial[],
  options: QualificationOptions = {},
): QualificationAnalysis {
  const params = QUALIFICATION_PARAMS;
  const criteria: CriterionResult[] = [];
  const levels = { tone: [] as LevelSummary[], pink: [] as LevelSummary[] };
  const planned = {
    tone: { slots: 0, entries: 0, countedSlots: 0, excluded: 0 } as PlannedSummary,
    pink: { slots: 0, entries: 0, countedSlots: 0, excluded: 0 } as PlannedSummary,
  };
  const exclusions = {
    count: 0,
    byReason: { blocked: 0, disturbed: 0, interrupted: 0, capture_fault: 0 } as Record<ExclusionReason, number>,
    unrecognised: 0,
  };
  const byCriterion = { C1: true, C2: true, C3: true, C4: true, C5: true, C6: true, C7: true };

  const add = (id: keyof typeof byCriterion, stimulus: string | null, pass: boolean, detail: string): void => {
    criteria.push({ id: stimulus === null ? id : `${id}:${stimulus}`, pass, detail });
    if (!pass) byCriterion[id] = false;
  };

  // N-11: the parameters are fixed. A caller that supplies different ones makes the analysis fail.
  const supplied = (options as { params?: unknown }).params;
  const paramsAccepted = supplied === undefined || sameParams(supplied, params);
  if (!paramsAccepted) {
    criteria.push({ id: 'PARAMS', pass: false, detail: 'a params override that differs from QUALIFICATION_PARAMS was supplied and is refused' });
  }

  for (const stimulus of params.stimuli) {
    const a = analyzeStimulus(
      trials.filter((t) => t.stimulus === stimulus),
      params,
    );
    levels[stimulus] = a.levels;
    planned[stimulus] = a.planned;
    for (const r of EXCLUSION_REASONS) exclusions.byReason[r] += a.excluded[r];
    exclusions.count += a.planned.excluded;
    exclusions.unrecognised += a.unrecognised;

    const summary = a.levels;
    const enough = summary.length >= 2;
    const medians = summary.map((l) => l.median);
    const finiteMedians = a.nonFiniteRel === 0 && medians.every((m) => m !== null);

    // C1 monotonic medians (strict)
    {
      let pass = enough && finiteMedians;
      if (pass) {
        for (let i = 1; i < medians.length; i++) {
          if (!((medians[i] as number) > (medians[i - 1] as number))) pass = false;
        }
      }
      add(
        'C1',
        stimulus,
        pass,
        a.nonFiniteRel > 0
          ? `${a.nonFiniteRel} counted attempts have a non-finite rel95`
          : enough
            ? `medians ${medians.join(', ')}`
            : 'fewer than 2 levels with counted attempts',
      );
    }

    // C2 adjacent steps within nominal +- tolerance
    {
      let pass = enough && finiteMedians;
      const parts: string[] = [];
      if (pass) {
        for (let i = 1; i < summary.length; i++) {
          const nominal = (summary[i] as LevelSummary).nominalDb - (summary[i - 1] as LevelSummary).nominalDb;
          const measured = (medians[i] as number) - (medians[i - 1] as number);
          const ok = Math.abs(measured - nominal) <= params.stepToleranceDb + TOLERANCE;
          if (!ok) pass = false;
          parts.push(`step ${i}: measured ${measured.toFixed(2)} dB vs nominal ${nominal} dB`);
        }
      }
      add(
        'C2',
        stimulus,
        pass,
        a.nonFiniteRel > 0
          ? `${a.nonFiniteRel} counted attempts have a non-finite rel95`
          : enough
            ? parts.join('; ')
            : 'fewer than 2 levels with counted attempts',
      );
    }

    // C3 planned trials and frozen levels
    {
      const pass = a.planProblems.length === 0 && summary.length === params.levelsPerStimulus;
      add(
        'C3',
        stimulus,
        pass,
        `${a.planned.slots} slots, ${a.planned.countedSlots} counted, ${a.planned.entries} attempts, ${a.planned.excluded} excluded` +
          (a.planProblems.length > 0 ? `; ${a.planProblems.slice(0, 6).join('; ')}${a.planProblems.length > 6 ? '; ...' : ''}` : ''),
      );
    }

    // C4 SD upper confidence bound
    {
      let pass = summary.length > 0 && a.nonFiniteRel === 0;
      const parts: string[] = [];
      for (const l of summary) {
        const ok = l.sdUpperBound !== null && Number.isFinite(l.sdUpperBound) && l.sdUpperBound <= params.maxSdUpperBoundDb + TOLERANCE;
        if (!ok) pass = false;
        parts.push(
          `${l.nominalDb} dBFS: sd ${l.sd === null ? 'n/a' : l.sd.toFixed(3)}, upper bound ${l.sdUpperBound === null ? 'n/a' : l.sdUpperBound.toFixed(3)}`,
        );
      }
      add('C4', stimulus, pass, a.nonFiniteRel > 0 ? `${a.nonFiniteRel} counted attempts have a non-finite rel95` : parts.join('; ') || 'no counted attempts');
    }

    // C5 zero clipping (every attempt) and valid counts
    {
      const pass = a.planned.entries > 0 && a.clippedFrames === 0 && a.badClipCounts === 0;
      add(
        'C5',
        stimulus,
        pass,
        a.badClipCounts > 0 ? `${a.badClipCounts} attempts have a clipped-frame count that is not a finite non-negative integer` : `${a.clippedFrames} clipped frames`,
      );
    }
  }

  // C6 settings readback
  {
    const agc = options.settings?.autoGainControl;
    add(
      'C6',
      null,
      agc === false,
      options.settings === undefined ? 'settings readback not provided' : `browser reported autoGainControl ${String(agc)}`,
    );
  }

  // C7 negative cases
  let limited: 'noise-sensitive' | null = null;
  {
    if (options.negativeCases === undefined) {
      add('C7', null, false, 'negative-case results not provided');
    } else {
      const problems = negativeCaseProblems(options.negativeCases, params);
      const exceeded: string[] = [];
      for (const r of options.negativeCases) {
        const limit = params.negativeCaseLimits[r?.id] ?? null;
        if (limit !== null && isCount(r.scoredReached) && r.scoredReached > limit) {
          exceeded.push(`${r.id}: ${r.scoredReached} of ${r.windows} scored reached (limit ${limit})`);
        }
      }
      if (exceeded.length > 0) limited = 'noise-sensitive';
      const pass = problems.length === 0 && exceeded.length === 0;
      add(
        'C7',
        null,
        pass,
        pass
          ? 'within the predeclared limits'
          : [...problems, ...exceeded].slice(0, 8).join('; '),
      );
    }
  }

  const hasEntries = trials.length > 0;
  const allPass = criteria.every((c) => c.pass);
  return {
    status: !hasEntries ? 'not_run' : allPass ? 'passed' : 'failed',
    levels,
    criteria,
    byCriterion,
    limited,
    params,
    paramsAccepted,
    exclusions,
    planned,
  };
}

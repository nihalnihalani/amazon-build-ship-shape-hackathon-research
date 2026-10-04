/**
 * Qualification analysis for the physical-phone experiment (docs/evaluation/T04-protocol.md;
 * ADR-0009 as amended by revision 2: A9-01, A9-03, A9-05). Pure arithmetic over numeric trial
 * summaries: it returns pass or fail per criterion and never touches audio.
 *
 * THE CRITERIA IN THIS FILE ARE THE FROZEN CRITERIA of the protocol. The SHA-256 of this file
 * together with the protocol document is the freeze hash recorded before the first trial
 * (see fixtures/dsp/tools/freeze_hash.py). They are engineering proposals, not measured accuracy.
 *
 * Criteria (computed per stimulus, then combined):
 *   C1 monotonic medians: the median rel95 rises strictly with the nominal level.
 *   C2 slope: each adjacent median step is within the nominal step ± 2 dB (A9-01). A compressing
 *      input (for example 3:1) fails here even when it is monotonic, tight and unclipped.
 *   C3 repeats: at least 15 valid repeats at each of the 3 levels (A9-05).
 *   C4 repeatability: the one-sided 95 % upper confidence bound of the per-level SD is at most
 *      1.5 dB: s × sqrt((n − 1) / chi2_{0.05}(n − 1)) <= 1.5, chi-square with n − 1 = 14 degrees
 *      of freedom at 15 repeats (A9-05).
 *   C5 zero clipped frames in every valid trial.
 *   C6 settings readback: the browser reported autoGainControl false (reported settings are not
 *      proof of an unprocessed signal; they are recorded and required, never sufficient).
 *   C7 negative cases: predeclared false-`reached` limits (A9-03). Exceeding a limit sets
 *      `limited: 'noise-sensitive'`.
 */

import { percentile } from './percentile.js';

export type QualificationStimulus = 'tone' | 'pink';

/** One valid trial of a level block: `rel95Db` is the window's p95 level minus the pre-window floor. */
export interface QualificationTrial {
  stimulus: QualificationStimulus;
  /** Nominal digital level of the stimulus file (dBFS peak), the key of the level group. */
  nominalDb: number;
  rel95Db: number;
  /** Clipped frames in the trial window and its precheck. */
  clippedFrames: number;
  /** Set false for blocked, disturbed or interrupted trials: they are listed but not analysed. */
  valid?: boolean;
}

export interface NegativeCaseResult {
  /** `N1` .. `N7` (protocol section 5). */
  id: string;
  /** Windows run for this condition (10). */
  windows: number;
  /** Windows scored `reached` while the intended speaker was silent (after the gate). */
  scoredReached: number;
  /** Windows the gate blocked or the analysis marked contaminated (not scored). */
  blockedOrContaminated?: number;
}

export interface QualificationParams {
  stimuli: readonly QualificationStimulus[];
  levelsPerStimulus: number;
  repeatsPerLevel: number;
  /** Adjacent median step must be within nominal step ± this many dB. */
  stepToleranceDb: number;
  /** Per-level SD upper confidence bound limit (dB). */
  maxSdUpperBoundDb: number;
  /** One-sided confidence of the SD bound. */
  confidence: number;
  /** Per negative case: maximum windows scored `reached`; null = reported, not gated. */
  negativeCaseLimits: Readonly<Record<string, number | null>>;
}

/** The frozen, predeclared parameters. */
export const QUALIFICATION_PARAMS: QualificationParams = Object.freeze({
  stimuli: Object.freeze(['tone', 'pink'] as const),
  levelsPerStimulus: 3,
  repeatsPerLevel: 15,
  stepToleranceDb: 2,
  maxSdUpperBoundDb: 1.5,
  confidence: 0.95,
  negativeCaseLimits: Object.freeze({
    N1: 0, // fan: 0 of 10 windows scored reached
    N2: 0, // TV speech: blocked by the gate or contaminated, otherwise 0 reached
    N3: null, // second speaker, cough, music: known limitation (ADR-0001 section 3), reported not gated
    N4: null,
    N5: null,
    N6: null, // moved phone: evidence against cross-session comparison, no limit
    N7: null, // screen lock: lifecycle observation
  }),
});

export interface QualificationOptions {
  params?: QualificationParams;
  /** Browser-reported track settings after open; `autoGainControl` must be reported false (C6). */
  settings?: { autoGainControl: boolean | null };
  negativeCases?: readonly NegativeCaseResult[];
}

export interface LevelSummary {
  nominalDb: number;
  /** Valid trials analysed at this level. */
  n: number;
  median: number | null;
  /** Sample standard deviation (n − 1); null when n < 2. */
  sd: number | null;
  /** One-sided upper confidence bound of the SD; null when n < 2. */
  sdUpperBound: number | null;
  clippedFrames: number;
}

export interface CriterionResult {
  /** `C1` .. `C7`, with the stimulus appended (`C1:tone`) where it is per stimulus. */
  id: string;
  pass: boolean;
  detail: string;
}

export interface QualificationAnalysis {
  /** `not_run` without any trial; otherwise `passed` only when every criterion passed. */
  status: 'not_run' | 'passed' | 'failed';
  levels: Record<QualificationStimulus, LevelSummary[]>;
  criteria: CriterionResult[];
  /** Conjunction per criterion over its stimuli. */
  byCriterion: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7', boolean>;
  limited: 'noise-sensitive' | null;
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

function summarizeStimulus(
  trials: readonly QualificationTrial[],
  params: QualificationParams,
): LevelSummary[] {
  const byLevel = new Map<number, QualificationTrial[]>();
  for (const t of trials) {
    if (t.valid === false) continue;
    const list = byLevel.get(t.nominalDb) ?? [];
    list.push(t);
    byLevel.set(t.nominalDb, list);
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([nominalDb, list]) => {
      const values = list.map((t) => t.rel95Db);
      const n = values.length;
      const sd = n >= 2 ? sampleSd(values) : null;
      return {
        nominalDb,
        n,
        median: percentile(values, 50),
        sd,
        sdUpperBound: sd === null ? null : sdUpperConfidenceBound(sd, n, params.confidence),
        clippedFrames: list.reduce((a, t) => a + t.clippedFrames, 0),
      };
    });
}

export function analyzeQualification(
  trials: readonly QualificationTrial[],
  options: QualificationOptions = {},
): QualificationAnalysis {
  const params = options.params ?? QUALIFICATION_PARAMS;
  const criteria: CriterionResult[] = [];
  const levels = { tone: [] as LevelSummary[], pink: [] as LevelSummary[] };
  const byCriterion = { C1: true, C2: true, C3: true, C4: true, C5: true, C6: true, C7: true };

  const add = (id: keyof typeof byCriterion, stimulus: string | null, pass: boolean, detail: string): void => {
    criteria.push({ id: stimulus === null ? id : `${id}:${stimulus}`, pass, detail });
    if (!pass) byCriterion[id] = false;
  };

  for (const stimulus of params.stimuli) {
    const summary = summarizeStimulus(
      trials.filter((t) => t.stimulus === stimulus),
      params,
    );
    levels[stimulus] = summary;
    const enough = summary.length >= 2;
    const medians = summary.map((l) => l.median as number);

    // C1 monotonic medians (strict)
    {
      let pass = enough;
      for (let i = 1; i < medians.length; i++) {
        if (!((medians[i] as number) > (medians[i - 1] as number))) pass = false;
      }
      add('C1', stimulus, pass, enough ? `medians ${medians.join(', ')}` : 'fewer than 2 levels with valid trials');
    }

    // C2 adjacent steps within nominal ± tolerance
    {
      let pass = enough;
      const parts: string[] = [];
      for (let i = 1; i < summary.length; i++) {
        const nominal = (summary[i] as LevelSummary).nominalDb - (summary[i - 1] as LevelSummary).nominalDb;
        const measured = (medians[i] as number) - (medians[i - 1] as number);
        const ok = Math.abs(measured - nominal) <= params.stepToleranceDb + TOLERANCE;
        if (!ok) pass = false;
        parts.push(`step ${i}: measured ${measured.toFixed(2)} dB vs nominal ${nominal} dB`);
      }
      add('C2', stimulus, pass, enough ? parts.join('; ') : 'fewer than 2 levels with valid trials');
    }

    // C3 repeats
    {
      const counts = summary.map((l) => l.n);
      const pass =
        summary.length === params.levelsPerStimulus && counts.every((n) => n >= params.repeatsPerLevel);
      add(
        'C3',
        stimulus,
        pass,
        `${summary.length} levels with ${counts.join(', ')} valid repeats (need ${params.levelsPerStimulus} levels of at least ${params.repeatsPerLevel})`,
      );
    }

    // C4 SD upper confidence bound
    {
      let pass = summary.length > 0;
      const parts: string[] = [];
      for (const l of summary) {
        const ok = l.sdUpperBound !== null && l.sdUpperBound <= params.maxSdUpperBoundDb + TOLERANCE;
        if (!ok) pass = false;
        parts.push(
          `${l.nominalDb} dBFS: sd ${l.sd === null ? 'n/a' : l.sd.toFixed(3)}, upper bound ${l.sdUpperBound === null ? 'n/a' : l.sdUpperBound.toFixed(3)}`,
        );
      }
      add('C4', stimulus, pass, parts.join('; ') || 'no valid trials');
    }

    // C5 zero clipping
    {
      const clipped = summary.reduce((a, l) => a + l.clippedFrames, 0);
      add('C5', stimulus, summary.length > 0 && clipped === 0, `${clipped} clipped frames`);
    }
  }

  // C6 settings readback
  {
    const agc = options.settings?.autoGainControl;
    add(
      'C6',
      null,
      agc === false,
      options.settings === undefined
        ? 'settings readback not provided'
        : `browser reported autoGainControl ${String(agc)}`,
    );
  }

  // C7 negative cases
  let limited: 'noise-sensitive' | null = null;
  {
    if (options.negativeCases === undefined) {
      add('C7', null, false, 'negative-case results not provided');
    } else {
      const exceeded: string[] = [];
      for (const r of options.negativeCases) {
        const limit = params.negativeCaseLimits[r.id] ?? null;
        if (limit !== null && r.scoredReached > limit) exceeded.push(`${r.id}: ${r.scoredReached} of ${r.windows} scored reached (limit ${limit})`);
      }
      if (exceeded.length > 0) limited = 'noise-sensitive';
      add('C7', null, exceeded.length === 0, exceeded.length === 0 ? 'within the predeclared limits' : exceeded.join('; '));
    }
  }

  const hasTrials = trials.some((t) => t.valid !== false);
  const allPass = criteria.every((c) => c.pass);
  return {
    status: !hasTrials ? 'not_run' : allPass ? 'passed' : 'failed',
    levels,
    criteria,
    byCriterion,
    limited,
  };
}

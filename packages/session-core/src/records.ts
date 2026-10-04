/**
 * Attempt, vowel and session records, summary derivation (ADR-0004) and history (ADR-0005).
 * Pure functions. Records contain no credentials, no level streams and no audio.
 */

import { HISTORY_DAYS } from './constants.js';
import type { HistoryDayView, SummaryView } from './contract.js';
import { SUMMARY_COPY } from './copy.js';

export type AttemptState =
  | 'capturing'
  | 'capture_closed'
  | 'response_pending'
  | 'revealed'
  | 'cancelled'
  | 'invalid';

export type Verdict = 'reached' | 'not_reached' | 'unscored';
export type SpeakerRating = 'felt_loud' | 'felt_normal' | 'skipped';
export type ListenerValue = 'heard' | 'not_heard';

export interface AttemptRecord {
  attemptId: string;
  windowId: string;
  /** 1-based phrase position. */
  position: number;
  attemptNumber: number;
  /** True only for the blind first attempt at positions 3, 6, 9. */
  hidden: boolean;
  state: AttemptState;
  /** True once the capture window was started on the phone. A gate-blocked attempt is never started. */
  started: boolean;
  /** Held on the TV and never projected into the view until reveal. */
  verdict: Verdict | null;
  reason: string | null;
  borderline: boolean;
  activeMs: number | null;
  longestActiveMs: number | null;
  rating: SpeakerRating | null;
  /** On-time listener response; 'missing' when the speaker continued without one. */
  listener: ListenerValue | 'missing' | null;
  /** A response that arrived after reveal. Stored, never counted in the primary denominator. */
  lateListener: ListenerValue | null;
}

export interface VowelRecord {
  windowId: string;
  valid: boolean;
  reason: string | null;
  longestActiveMs: number | null;
  /** Band verdict only when a calibration existed. */
  verdict: Verdict | null;
  borderline: boolean;
}

export type EndReason = 'completed' | 'user_exit' | 'discarded' | 'interrupted';

export interface SessionRecord {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  /** Local calendar date YYYY-MM-DD of the end time (TV time zone). */
  localDate: string;
  complete: boolean;
  endReason: EndReason;
  resumed: boolean;
  familyMode: boolean;
  phraseCount: number;
  calMarginDb: number | null;
  cuesUsed: number;
  attempts: AttemptRecord[];
  vowels: VowelRecord[];
  skipped: number[];
}

export interface SummaryInput {
  attempts: readonly AttemptRecord[];
  vowels: readonly VowelRecord[];
  skipped: readonly number[];
  complete: boolean;
  calMarginDb: number | null;
  familyMode: boolean;
  /** A9-02: band verdicts are not shown; the listener's answers are the primary outcome. */
  listenerEdition?: boolean;
}

const isScored = (a: AttemptRecord): boolean =>
  a.state === 'revealed' && (a.verdict === 'reached' || a.verdict === 'not_reached');

/** A valid window in a session with no band: unscored by design, not invalid (ADR-0001 listener-only mode). */
const isUnscoredByDesign = (a: AttemptRecord): boolean =>
  a.state === 'revealed' && a.verdict === 'unscored' && (a.reason === 'no_band' || a.reason === 'listener_edition');

/** Eligible for agreement: scored and an on-time heard/not_heard response (ADR-0004). */
const isEligible = (a: AttemptRecord): boolean =>
  isScored(a) && (a.listener === 'heard' || a.listener === 'not_heard');

const agrees = (a: AttemptRecord): boolean =>
  (a.verdict === 'reached' && a.listener === 'heard') || (a.verdict === 'not_reached' && a.listener === 'not_heard');

export interface Agreement {
  agree: number;
  eligible: number;
}

/** Agreement counts for hidden first attempts and visible attempts (visible retries included), separately. */
export function computeAgreement(attempts: readonly AttemptRecord[]): { hidden: Agreement; visible: Agreement } {
  const hidden = { agree: 0, eligible: 0 };
  const visible = { agree: 0, eligible: 0 };
  for (const a of attempts) {
    if (!isEligible(a)) continue;
    const bucket = a.hidden ? hidden : visible;
    bucket.eligible += 1;
    if (agrees(a)) bucket.agree += 1;
  }
  return { hidden, visible };
}

/** Counts per ADR-0004. Incomplete sessions are labelled and never compared with complete totals. */
export function deriveSummary(input: SummaryInput): SummaryView {
  const { attempts, vowels } = input;
  const completedPositions = new Set<number>();
  const startedPositions = new Set<number>();
  const invalidReasons: Record<string, number> = {};
  let attemptsInvalid = 0;
  let borderlineCount = 0;
  let lateListenerResponses = 0;
  const ratings = { feltLoud: 0, feltNormal: 0, skipped: 0 };

  for (const a of attempts) {
    if (a.started) startedPositions.add(a.position);
    if (isScored(a)) {
      completedPositions.add(a.position);
      if (a.borderline) borderlineCount += 1;
    } else if (isUnscoredByDesign(a)) {
      // A valid window with no band set: completed, but never counted as invalid or scored.
      completedPositions.add(a.position);
    } else if (a.verdict === 'unscored') {
      attemptsInvalid += 1;
      const key = a.reason ?? 'unknown';
      invalidReasons[key] = (invalidReasons[key] ?? 0) + 1;
    }
    if (a.lateListener !== null) lateListenerResponses += 1;
    if (a.hidden && a.state === 'revealed') {
      if (a.rating === 'felt_loud') ratings.feltLoud += 1;
      else if (a.rating === 'felt_normal') ratings.feltNormal += 1;
      else if (a.rating === 'skipped') ratings.skipped += 1;
    }
  }

  // Reached counts: first valid attempt for hidden positions (the blind attempt), best valid attempt otherwise.
  let reachedHidden = 0;
  let scoredHidden = 0;
  let reachedVisible = 0;
  let scoredVisible = 0;
  const positions = new Set<number>();
  for (const a of attempts) positions.add(a.position);
  for (const position of positions) {
    const atPosition = attempts.filter((a) => a.position === position);
    const blind = atPosition.find((a) => a.hidden && isScored(a));
    if (blind) {
      scoredHidden += 1;
      if (blind.verdict === 'reached') reachedHidden += 1;
      continue;
    }
    const visibleScored = atPosition.filter((a) => !a.hidden && isScored(a));
    if (visibleScored.length > 0) {
      scoredVisible += 1;
      if (visibleScored.some((a) => a.verdict === 'reached')) reachedVisible += 1;
    }
  }

  const phrasesSkipped = input.skipped.filter((p) => !completedPositions.has(p)).length;

  let longest: number | null = null;
  for (const v of vowels) {
    if (v.valid && v.longestActiveMs !== null && (longest === null || v.longestActiveMs > longest)) {
      longest = v.longestActiveMs;
    }
  }

  const agreement = computeAgreement(attempts);
  // `lines` carries notes and labelling only. Counts, denominators and agreement figures are in the
  // structured fields, which the UI renders itself; nothing here repeats a count.
  const lines: string[] = [];
  if (!input.complete) lines.push(SUMMARY_COPY.incomplete);
  if (input.listenerEdition === true) {
    // Listener Edition has no structured field for the listener counts, so they are stated here.
    let heard = 0;
    let notHeard = 0;
    let missing = 0;
    for (const a of attempts) {
      if (a.state !== 'revealed' || a.listener === null) continue;
      if (a.listener === 'heard') heard += 1;
      else if (a.listener === 'not_heard') notHeard += 1;
      else missing += 1;
    }
    lines.push(SUMMARY_COPY.listenerEdition);
    lines.push(`Listener answers: heard ${heard}, not heard ${notHeard}, no response ${missing}.`);
    if (lateListenerResponses > 0) lines.push(SUMMARY_COPY.lateNote);
  } else {
    lines.push(input.calMarginDb === null ? SUMMARY_COPY.noBand : SUMMARY_COPY.countingRules);
    if (input.familyMode) {
      if (agreement.hidden.eligible === 0) lines.push(`Agreement on blind checks: ${SUMMARY_COPY.noEligible}`);
      if (agreement.visible.eligible === 0) lines.push(`Agreement on visible attempts: ${SUMMARY_COPY.noEligible}`);
      if (lateListenerResponses > 0) lines.push(SUMMARY_COPY.lateNote);
    } else {
      lines.push(SUMMARY_COPY.listenerOff);
    }
    if (borderlineCount > 0) lines.push(SUMMARY_COPY.borderlineNote);
  }
  lines.push(SUMMARY_COPY.relativeOnly);

  return {
    complete: input.complete,
    phrasesCompleted: completedPositions.size,
    phrasesAttempted: startedPositions.size,
    phrasesSkipped,
    attemptsInvalid,
    invalidReasons,
    reachedVisible,
    scoredVisible,
    reachedHidden,
    scoredHidden,
    longestActiveMs: longest,
    hiddenRatings: ratings,
    agreementHidden: agreement.hidden,
    agreementVisible: agreement.visible,
    lateListenerResponses,
    borderlineCount,
    calibrationMarginDb: input.calMarginDb,
    lines,
  };
}

export function summarizeRecord(record: SessionRecord): SummaryView {
  return deriveSummary({
    attempts: record.attempts,
    vowels: record.vowels,
    skipped: record.skipped,
    complete: record.complete,
    calMarginDb: record.calMarginDb,
    familyMode: record.familyMode,
  });
}

/* ------------------------------------------------------------------ history (ADR-0005) */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Calendar arithmetic on a YYYY-MM-DD string (no time-zone or DST involvement). */
export function shiftDate(date: string, days: number): string {
  const parts = parseDate(date);
  if (!parts) return date;
  const t = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${mm}-${dd}`;
}

export function weekdayLabel(date: string): string {
  const parts = parseDate(date);
  if (!parts) return '';
  return WEEKDAYS[new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay()] ?? '';
}

/**
 * The last 7 local calendar days ending today, oldest first. A day without a session stays null
 * (missing stays missing). A day containing any incomplete session is flagged incomplete and its
 * counts are labelled as such by the UI; the view never computes comparisons or trends.
 */
export function deriveHistory(records: readonly SessionRecord[], today: string): HistoryDayView[] {
  const days: HistoryDayView[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    const sessions = records.filter((r) => r.localDate === date);
    if (sessions.length === 0) {
      days.push({
        date,
        weekdayLabel: weekdayLabel(date),
        sessions: null,
        reached: null,
        scored: null,
        longestActiveMs: null,
        incomplete: false,
      });
      continue;
    }
    let reached = 0;
    let scored = 0;
    let longest: number | null = null;
    let incomplete = false;
    for (const record of sessions) {
      const s = summarizeRecord(record);
      reached += s.reachedVisible + s.reachedHidden;
      scored += s.scoredVisible + s.scoredHidden;
      if (s.longestActiveMs !== null && (longest === null || s.longestActiveMs > longest)) longest = s.longestActiveMs;
      if (!record.complete) incomplete = true;
    }
    days.push({
      date,
      weekdayLabel: weekdayLabel(date),
      sessions: sessions.length,
      reached,
      scored,
      longestActiveMs: longest,
      incomplete,
    });
  }
  return days;
}

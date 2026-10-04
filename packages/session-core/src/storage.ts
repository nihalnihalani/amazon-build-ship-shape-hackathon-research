/**
 * Local storage (ADR-0005): atr:v1:* keys only, schema migrations as pure functions, 30-day pruning,
 * crash checkpoint, and verified deletion. Unencrypted AsyncStorage; no credentials, no pairing
 * codes, no level streams and no audio are ever written.
 */

import {
  CHECKPOINT_MAX_AGE_MS,
  DAY_MS,
  MAX_PHRASES,
  QUIET_LEAD_MAX_MS,
  QUIET_LEAD_MIN_MS,
  RETENTION_DAYS,
  SCHEMA_VERSION,
  STORAGE_PREFIX,
} from './constants.js';
import type { StoragePort } from './contract.js';
import type {
  AttemptRecord,
  AttemptState,
  EndReason,
  ListenerValue,
  SessionRecord,
  SpeakerRating,
  Verdict,
  VowelRecord,
} from './records.js';
import { isCalendarDate } from './dates.js';
import { validatePhraseBank, validateText } from './text.js';

export type MeasurementMode = 'relative_band' | 'listener_edition';

/** A9-02: qualification of the phone microphone path. Starts as not_run until T04A records a result. */
export type Qualification = 'not_run' | 'passed' | 'failed';

export interface Settings {
  familyMode: boolean;
  /** Last cue word seen from the phone (display only; the phone owns the setting). */
  cueWord: string | null;
  measurementMode: MeasurementMode;
  onboarded: boolean;
  qualification: Qualification;
  /** Optional overrides of the quiet lead (A8-02); null uses the built-in values. Recorded in Diagnostics. */
  quietLeadMs: number | null;
  quietLeadScreenReaderMs: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  familyMode: false,
  cueWord: null,
  measurementMode: 'relative_band',
  onboarded: false,
  qualification: 'not_run',
  quietLeadMs: null,
  quietLeadScreenReaderMs: null,
};

export const KEYS = {
  meta: 'atr:v1:meta',
  settings: 'atr:v1:settings',
  phrases: 'atr:v1:phrases',
  index: 'atr:v1:index',
  active: 'atr:v1:active',
  sessionPrefix: 'atr:v1:session:',
  /** Pre-release layout kept only so the v0 -> v1 migration can be tested and run. */
  legacyV0: 'atr:v0:snapshot',
} as const;

export const sessionKey = (id: string): string => `${KEYS.sessionPrefix}${id}`;

/* ------------------------------------------------------------------ checkpoint */

export interface Checkpoint {
  version: 1;
  savedAt: number;
  /** Stage the session was in when saved (informational). */
  stage: string;
  /** Number of phrase positions in the session. Phrase text is never stored here (A5-04). */
  phraseCount: number;
  /** 0-based index of the phrase position to continue from. */
  phraseIdx: number;
  /**
   * Counts and finished attempts only (A4-02): an attempt that was not revealed has no verdict, rating,
   * listener answer or window numbers in this record.
   */
  record: SessionRecord;
}

/* ------------------------------------------------------------------ migrations (pure) */

export interface V0Session {
  id: string;
  date: string;
  complete: boolean;
  started_at?: number;
  ended_at: number;
  attempts: { pos: number; verdict: 'reached' | 'below' | 'none'; hidden?: boolean }[];
  vowel_ms?: number | null;
}

export interface V0Snapshot {
  schema_version: 0;
  settings: { family: boolean; cue: string | null };
  phrases: string[];
  sessions: V0Session[];
}

export interface V1Snapshot {
  schemaVersion: 1;
  settings: Settings;
  phrases: string[] | null;
  sessions: SessionRecord[];
}

/** Pure v0 -> v1 migration. Missing information stays missing; nothing is invented. */
export function migrateV0ToV1(v0: V0Snapshot): V1Snapshot {
  const bank = validatePhraseBank(v0.phrases);
  const sessions: SessionRecord[] = v0.sessions.map((s) => {
    const perPosition: Record<number, number> = {};
    const attempts: AttemptRecord[] = s.attempts.map((a, i) => {
      perPosition[a.pos] = (perPosition[a.pos] ?? 0) + 1;
      const scored = a.verdict === 'reached' || a.verdict === 'below';
      const verdict: Verdict = a.verdict === 'reached' ? 'reached' : a.verdict === 'below' ? 'not_reached' : 'unscored';
      return {
        attemptId: `a_legacy${s.id}_${i}`,
        windowId: `w_legacy${s.id}_${i}`,
        position: a.pos,
        attemptNumber: perPosition[a.pos] ?? 1,
        hidden: a.hidden === true,
        state: scored ? 'revealed' : 'invalid',
        started: true,
        verdict,
        reason: scored ? null : 'legacy_unscored',
        borderline: false,
        activeMs: null,
        longestActiveMs: null,
        rating: null,
        listener: null,
        lateListener: null,
      };
    });
    const vowels: VowelRecord[] =
      typeof s.vowel_ms === 'number'
        ? [
            {
              windowId: `w_legacy${s.id}_vowel`,
              valid: true,
              reason: null,
              longestActiveMs: s.vowel_ms,
              verdict: null,
              borderline: false,
            },
          ]
        : [];
    return {
      sessionId: s.id,
      startedAt: s.started_at ?? s.ended_at,
      endedAt: s.ended_at,
      localDate: s.date,
      complete: s.complete,
      endReason: s.complete ? 'completed' : 'user_exit',
      resumed: false,
      familyMode: v0.settings.family,
      phraseCount: attempts.reduce((m, a) => Math.max(m, a.position), 0),
      calMarginDb: null,
      cuesUsed: 0,
      attempts,
      vowels,
      skipped: [],
    } satisfies SessionRecord;
  });
  return {
    schemaVersion: 1,
    settings: {
      familyMode: v0.settings.family,
      cueWord: validateText(v0.settings.cue, 12),
      measurementMode: 'relative_band',
      onboarded: true,
      qualification: 'not_run',
      quietLeadMs: null,
      quietLeadScreenReaderMs: null,
    },
    phrases: bank.ok ? bank.phrases : null,
    sessions,
  };
}

export type MigrationResult =
  | { ok: true; from: number; snapshot: V1Snapshot }
  | { ok: false; reason: 'future_version'; version: number }
  | { ok: false; reason: 'unrecognized' };

/** Brings a parsed snapshot of any known version to the current one. Unknown future versions are refused, never rewritten. */
export function migrateSnapshot(raw: unknown): MigrationResult {
  if (!isObject(raw) || typeof raw.schema_version !== 'number') return { ok: false, reason: 'unrecognized' };
  const version = raw.schema_version;
  if (version > SCHEMA_VERSION) return { ok: false, reason: 'future_version', version };
  if (version === 0) {
    const migrated = migrateV0ToV1(raw as unknown as V0Snapshot);
    return { ok: true, from: 0, snapshot: migrated };
  }
  if (version === 1) return { ok: true, from: 1, snapshot: raw as unknown as V1Snapshot };
  return { ok: false, reason: 'unrecognized' };
}

/* ------------------------------------------------------------------ defensive parsing */

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const numOrNull = (v: unknown, min: number, max: number): number | null | undefined =>
  v === null || v === undefined ? null : isNumber(v) && v >= min && v <= max ? v : undefined;
const reasonOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'string' && v.length <= 64 ? v : undefined;
const ID_LIKE = /^[A-Za-z0-9_-]{1,64}$/;

const ATTEMPT_STATES: readonly AttemptState[] = [
  'capturing',
  'capture_closed',
  'response_pending',
  'revealed',
  'cancelled',
  'invalid',
];
const VERDICTS: readonly Verdict[] = ['reached', 'not_reached', 'unscored'];
const RATINGS: readonly SpeakerRating[] = ['felt_loud', 'felt_normal', 'skipped'];
const LISTENERS: readonly ListenerValue[] = ['heard', 'not_heard'];
const END_REASONS: readonly EndReason[] = ['completed', 'user_exit', 'discarded', 'interrupted'];
const QUALIFICATIONS: readonly Qualification[] = ['not_run', 'passed', 'failed'];

/** Strict enum read: undefined means "present but not allowed" (the whole value is then rejected). */
function enumOrNull<T extends string>(v: unknown, set: readonly T[]): T | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * Stored values are validated like wire data (A5-05): a value that is out of range or of the wrong type
 * makes the whole record invalid, and an invalid record is treated as absent.
 */
export function parseAttempt(v: unknown): AttemptRecord | null {
  if (!isObject(v)) return null;
  const state = enumOrNull(v.state, ATTEMPT_STATES);
  if (typeof v.attemptId !== 'string' || !ID_LIKE.test(v.attemptId)) return null;
  if (typeof v.windowId !== 'string' || !ID_LIKE.test(v.windowId)) return null;
  if (state === null || state === undefined) return null;
  if (!isInt(v.position, 1, MAX_PHRASES) || !isInt(v.attemptNumber, 1, 100)) return null;
  const verdict = enumOrNull(v.verdict, VERDICTS);
  const rating = enumOrNull(v.rating, RATINGS);
  const lateListener = enumOrNull(v.lateListener, LISTENERS);
  const listener = v.listener === 'missing' ? ('missing' as const) : enumOrNull(v.listener, LISTENERS);
  const reason = reasonOrNull(v.reason);
  const activeMs = numOrNull(v.activeMs, 0, 60_000);
  const longestActiveMs = numOrNull(v.longestActiveMs, 0, 60_000);
  if ([verdict, rating, lateListener, listener, reason, activeMs, longestActiveMs].some((x) => x === undefined)) return null;
  return {
    attemptId: v.attemptId,
    windowId: v.windowId,
    position: v.position,
    attemptNumber: v.attemptNumber,
    hidden: v.hidden === true,
    state,
    started: v.started === true,
    verdict: verdict as Verdict | null,
    reason: reason as string | null,
    borderline: v.borderline === true,
    activeMs: activeMs as number | null,
    longestActiveMs: longestActiveMs as number | null,
    rating: rating as SpeakerRating | null,
    listener: listener as ListenerValue | 'missing' | null,
    lateListener: lateListener as ListenerValue | null,
  };
}

function parseVowel(v: unknown): VowelRecord | null {
  if (!isObject(v) || typeof v.windowId !== 'string' || !ID_LIKE.test(v.windowId)) return null;
  const verdict = enumOrNull(v.verdict, VERDICTS);
  const reason = reasonOrNull(v.reason);
  const longest = numOrNull(v.longestActiveMs, 0, 60_000);
  if (verdict === undefined || reason === undefined || longest === undefined) return null;
  return {
    windowId: v.windowId,
    valid: v.valid === true,
    reason,
    longestActiveMs: longest,
    verdict,
    borderline: v.borderline === true,
  };
}

export function parseRecord(v: unknown): SessionRecord | null {
  if (!isObject(v)) return null;
  if (typeof v.sessionId !== 'string' || !ID_LIKE.test(v.sessionId)) return null;
  if (!isCalendarDate(v.localDate)) return null; // a calendar-invalid date such as 2026-13-45 is corrupt (QA-11)
  if (!isNumber(v.startedAt) || !isNumber(v.endedAt) || v.startedAt < 0 || v.endedAt < 0) return null;
  if (!Array.isArray(v.attempts) || v.attempts.length > 200) return null;
  const attempts: AttemptRecord[] = [];
  for (const a of v.attempts) {
    const parsed = parseAttempt(a);
    if (!parsed) return null;
    attempts.push(parsed);
  }
  const vowels: VowelRecord[] = [];
  if (v.vowels !== undefined) {
    if (!Array.isArray(v.vowels) || v.vowels.length > 200) return null;
    for (const x of v.vowels) {
      const parsed = parseVowel(x);
      if (!parsed) return null;
      vowels.push(parsed);
    }
  }
  const skipped: number[] = [];
  if (v.skipped !== undefined) {
    if (!Array.isArray(v.skipped) || v.skipped.length > MAX_PHRASES) return null;
    for (const x of v.skipped) {
      if (!isInt(x, 1, MAX_PHRASES)) return null;
      skipped.push(x);
    }
  }
  const endReason = enumOrNull(v.endReason, END_REASONS);
  const calMarginDb = numOrNull(v.calMarginDb, 0, 140);
  if (endReason === undefined || calMarginDb === undefined) return null;
  const phraseCount = v.phraseCount === undefined ? attempts.length : v.phraseCount;
  const cuesUsed = v.cuesUsed === undefined ? 0 : v.cuesUsed;
  if (!isInt(phraseCount, 0, MAX_PHRASES) || !isInt(cuesUsed, 0, 3)) return null;
  return {
    sessionId: v.sessionId,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    localDate: v.localDate,
    complete: v.complete === true,
    endReason: endReason ?? 'user_exit',
    resumed: v.resumed === true,
    familyMode: v.familyMode === true,
    phraseCount,
    calMarginDb,
    cuesUsed,
    attempts,
    vowels,
    skipped,
  };
}

function leadOrNull(v: unknown): number | null {
  return isInt(v, QUIET_LEAD_MIN_MS, QUIET_LEAD_MAX_MS) ? v : null;
}

export function parseSettings(v: unknown): Settings {
  if (!isObject(v)) return { ...DEFAULT_SETTINGS };
  return {
    familyMode: v.familyMode === true,
    cueWord: validateText(v.cueWord, 12),
    measurementMode: v.measurementMode === 'listener_edition' ? 'listener_edition' : 'relative_band',
    onboarded: v.onboarded === true,
    qualification: enumOrNull(v.qualification, QUALIFICATIONS) ?? 'not_run',
    quietLeadMs: leadOrNull(v.quietLeadMs),
    quietLeadScreenReaderMs: leadOrNull(v.quietLeadScreenReaderMs),
  };
}

export function parseCheckpoint(v: unknown): Checkpoint | null {
  if (!isObject(v) || v.version !== 1 || !isNumber(v.savedAt) || v.savedAt < 0) return null;
  if (!isInt(v.phraseIdx, 0, MAX_PHRASES) || !isInt(v.phraseCount, 1, MAX_PHRASES)) return null;
  const record = parseRecord(v.record);
  if (!record) return null;
  return {
    version: 1,
    savedAt: v.savedAt,
    stage: typeof v.stage === 'string' ? v.stage.slice(0, 32) : 'unknown',
    phraseCount: v.phraseCount,
    phraseIdx: v.phraseIdx,
    record,
  };
}

function safeJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ load */

export interface LoadedData {
  status: 'ok' | 'future_version';
  futureVersion: number | null;
  settings: Settings;
  phrases: string[] | null;
  records: SessionRecord[];
  active: Checkpoint | null;
  prunedSessions: number;
  migratedFrom: number | null;
  /** Stored values that could not be validated and are treated as absent (a delete is offered). */
  corruptKeys: number;
  /** A crash checkpoint older than the room lifetime was removed on this launch. */
  staleCheckpointDiscarded: boolean;
  /** Removing expired summaries failed; they were kept. */
  pruneFailed: boolean;
  /** A checkpoint for a session that already has a saved final record was dropped (QA-02). */
  finishedCheckpointDropped: boolean;
}

const emptyLoaded = (): LoadedData => ({
  status: 'ok',
  futureVersion: null,
  settings: { ...DEFAULT_SETTINGS },
  phrases: null,
  records: [],
  active: null,
  prunedSessions: 0,
  migratedFrom: null,
  corruptKeys: 0,
  staleCheckpointDiscarded: false,
  pruneFailed: false,
  finishedCheckpointDropped: false,
});

const isAtrKey = (k: string): boolean => k.startsWith(STORAGE_PREFIX);

function highestKeyVersion(keys: readonly string[]): number {
  let max = 0;
  for (const key of keys) {
    const m = /^atr:v(\d+):/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Loads everything, migrates v0, prunes sessions older than 30 days. If any key belongs to a schema
 * version newer than this build understands, nothing is read for use and nothing is written.
 */
export async function loadData(storage: StoragePort, now: number): Promise<LoadedData> {
  const keys = (await storage.getAllKeys()).filter(isAtrKey);
  const out = emptyLoaded();

  const keyVersion = highestKeyVersion(keys);
  if (keyVersion > SCHEMA_VERSION) {
    out.status = 'future_version';
    out.futureVersion = keyVersion;
    return out;
  }
  const meta = safeJson(await storage.getItem(KEYS.meta));
  if (isObject(meta) && isNumber(meta.schema_version) && meta.schema_version > SCHEMA_VERSION) {
    out.status = 'future_version';
    out.futureVersion = meta.schema_version;
    return out;
  }

  if (keys.includes(KEYS.legacyV0) && !keys.includes(KEYS.meta)) {
    const legacy = safeJson(await storage.getItem(KEYS.legacyV0));
    const migrated = migrateSnapshot(legacy);
    if (migrated.ok) {
      out.migratedFrom = migrated.from;
      out.settings = migrated.snapshot.settings;
      out.phrases = migrated.snapshot.phrases;
      out.records = migrated.snapshot.sessions;
      await writeMeta(storage, now);
      await storage.setItem(KEYS.settings, JSON.stringify(out.settings));
      if (out.phrases) await storage.setItem(KEYS.phrases, JSON.stringify({ phrases: out.phrases }));
      for (const record of out.records) await storage.setItem(sessionKey(record.sessionId), JSON.stringify(record));
      await writeIndex(storage, out.records);
      await storage.removeItem(KEYS.legacyV0);
    } else {
      out.corruptKeys += 1;
    }
  } else {
    if (!isObject(meta)) await writeMeta(storage, now);
    const settingsRaw = safeJson(await storage.getItem(KEYS.settings));
    if (settingsRaw !== undefined) out.settings = parseSettings(settingsRaw);
    const phrasesRaw = safeJson(await storage.getItem(KEYS.phrases));
    if (isObject(phrasesRaw)) {
      const bank = validatePhraseBank(phrasesRaw.phrases);
      if (bank.ok) out.phrases = bank.phrases;
      else out.corruptKeys += 1;
    }
    for (const key of keys) {
      if (!key.startsWith(KEYS.sessionPrefix)) continue;
      const parsed = parseRecord(safeJson(await storage.getItem(key)));
      if (parsed) out.records.push(parsed);
      else out.corruptKeys += 1;
    }
    const activeRaw = await storage.getItem(KEYS.active);
    if (activeRaw !== null) {
      const parsed = parseCheckpoint(safeJson(activeRaw));
      if (!parsed) out.corruptKeys += 1;
      else if (now - parsed.savedAt > CHECKPOINT_MAX_AGE_MS || parsed.savedAt - now > DAY_MS) {
        // A5-03: older than the room lifetime, so it is never offered for resume.
        await storage.removeItem(KEYS.active);
        out.staleCheckpointDiscarded = true;
      } else out.active = parsed;
    }
  }

  // 30-day retention: prune old session summaries on launch.
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  const keep: SessionRecord[] = [];
  const drop: SessionRecord[] = [];
  // QA-10: older than the retention window, or implausibly far in the future (a clock that was wrong and then
  // corrected, or a tampered record): both go. A day of slack allows for time zones and small clock errors.
  const horizon = now + DAY_MS;
  for (const record of out.records) {
    (record.endedAt < cutoff || record.endedAt > horizon || record.startedAt > horizon ? drop : keep).push(record);
  }
  if (drop.length > 0) {
    try {
      await storage.multiRemove(drop.map((r) => sessionKey(r.sessionId)));
      out.prunedSessions = drop.length;
    } catch {
      // A5-05: a partial or failed removal is surfaced, and the unremoved summaries stay in the list.
      out.pruneFailed = true;
      keep.push(...drop);
    }
  }
  out.records = keep.sort((a, b) => a.endedAt - b.endedAt);
  // QA-02: a crash between "record saved" and "checkpoint cleared" leaves a checkpoint for a finished session.
  // A session that already has a complete record, or a record written after the checkpoint, is never offered for resume.
  if (out.active !== null) {
    const active = out.active;
    const saved = out.records.find((r) => r.sessionId === active.record.sessionId);
    if (saved && (saved.complete || saved.endedAt >= active.savedAt)) {
      await storage.removeItem(KEYS.active);
      out.active = null;
      out.finishedCheckpointDropped = true;
    }
  }
  await writeIndex(storage, out.records);
  return out;
}

/* ------------------------------------------------------------------ writes */

async function writeMeta(storage: StoragePort, now: number): Promise<void> {
  await storage.setItem(KEYS.meta, JSON.stringify({ schema_version: SCHEMA_VERSION, created_at: now }));
}

async function writeIndex(storage: StoragePort, records: readonly SessionRecord[]): Promise<void> {
  const entries = records.map((r) => ({ sessionId: r.sessionId, localDate: r.localDate, endedAt: r.endedAt }));
  await storage.setItem(KEYS.index, JSON.stringify({ entries }));
}

export async function saveSettings(storage: StoragePort, settings: Settings): Promise<void> {
  await storage.setItem(KEYS.settings, JSON.stringify(settings));
}

export async function savePhrases(storage: StoragePort, phrases: readonly string[]): Promise<void> {
  await storage.setItem(KEYS.phrases, JSON.stringify({ phrases }));
}

/** Idempotent by session id: the record key is overwritten and the index is rebuilt. */
export async function saveSessionRecord(
  storage: StoragePort,
  record: SessionRecord,
  all: readonly SessionRecord[],
): Promise<void> {
  await storage.setItem(sessionKey(record.sessionId), JSON.stringify(record));
  await writeIndex(storage, all);
}

export async function saveCheckpoint(storage: StoragePort, checkpoint: Checkpoint): Promise<void> {
  await storage.setItem(KEYS.active, JSON.stringify(checkpoint));
}

export async function clearCheckpoint(storage: StoragePort): Promise<void> {
  await storage.removeItem(KEYS.active);
}

export type DeleteResult = { ok: true } | { ok: false; remaining: string[] };

/** Removes only atr: keys (never a blanket clear) and verifies through getAllKeys that none remain. */
export async function deleteAllLocalData(storage: StoragePort): Promise<DeleteResult> {
  try {
    const keys = (await storage.getAllKeys()).filter(isAtrKey);
    if (keys.length > 0) await storage.multiRemove(keys);
  } catch {
    // fall through to verification: a failed removal is reported through the remaining keys
  }
  let remaining: string[];
  try {
    remaining = (await storage.getAllKeys()).filter(isAtrKey);
  } catch {
    return { ok: false, remaining: ['unverifiable'] };
  }
  return remaining.length === 0 ? { ok: true } : { ok: false, remaining };
}

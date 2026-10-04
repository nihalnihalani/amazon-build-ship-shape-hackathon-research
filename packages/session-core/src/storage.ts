/**
 * Local storage (ADR-0005): atr:v1:* keys only, schema migrations as pure functions, 30-day pruning,
 * crash checkpoint, and verified deletion. Unencrypted AsyncStorage; no credentials, no pairing
 * codes, no level streams and no audio are ever written.
 */

import { DAY_MS, RETENTION_DAYS, SCHEMA_VERSION, STORAGE_PREFIX } from './constants.js';
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
import { validatePhraseBank, validateText } from './text.js';

export type MeasurementMode = 'relative_band' | 'listener_edition';

export interface Settings {
  familyMode: boolean;
  /** Last cue word seen from the phone (display only; the phone owns the setting). */
  cueWord: string | null;
  measurementMode: MeasurementMode;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  familyMode: false,
  cueWord: null,
  measurementMode: 'relative_band',
  onboarded: false,
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
  /** Session bank used by that session. */
  phrases: string[];
  /** 0-based index of the phrase position to continue from. */
  phraseIdx: number;
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
const numOrNull = (v: unknown): number | null => (isNumber(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

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

function pick<T extends string>(v: unknown, set: readonly T[]): T | null {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseAttempt(v: unknown): AttemptRecord | null {
  if (!isObject(v)) return null;
  const state = pick(v.state, ATTEMPT_STATES);
  if (typeof v.attemptId !== 'string' || typeof v.windowId !== 'string' || state === null) return null;
  if (!isNumber(v.position) || !isNumber(v.attemptNumber)) return null;
  const listener =
    v.listener === 'missing' ? ('missing' as const) : pick(v.listener, LISTENERS);
  return {
    attemptId: v.attemptId,
    windowId: v.windowId,
    position: v.position,
    attemptNumber: v.attemptNumber,
    hidden: v.hidden === true,
    state,
    started: v.started === true,
    verdict: pick(v.verdict, VERDICTS),
    reason: strOrNull(v.reason),
    borderline: v.borderline === true,
    activeMs: numOrNull(v.activeMs),
    longestActiveMs: numOrNull(v.longestActiveMs),
    rating: pick(v.rating, RATINGS),
    listener,
    lateListener: pick(v.lateListener, LISTENERS),
  };
}

function parseVowel(v: unknown): VowelRecord | null {
  if (!isObject(v) || typeof v.windowId !== 'string') return null;
  return {
    windowId: v.windowId,
    valid: v.valid === true,
    reason: strOrNull(v.reason),
    longestActiveMs: numOrNull(v.longestActiveMs),
    verdict: pick(v.verdict, VERDICTS),
    borderline: v.borderline === true,
  };
}

export function parseRecord(v: unknown): SessionRecord | null {
  if (!isObject(v)) return null;
  if (typeof v.sessionId !== 'string' || typeof v.localDate !== 'string') return null;
  if (!isNumber(v.startedAt) || !isNumber(v.endedAt) || !Array.isArray(v.attempts)) return null;
  const attempts: AttemptRecord[] = [];
  for (const a of v.attempts) {
    const parsed = parseAttempt(a);
    if (parsed) attempts.push(parsed);
  }
  const vowels: VowelRecord[] = [];
  if (Array.isArray(v.vowels)) {
    for (const x of v.vowels) {
      const parsed = parseVowel(x);
      if (parsed) vowels.push(parsed);
    }
  }
  const skipped = Array.isArray(v.skipped) ? v.skipped.filter(isNumber) : [];
  return {
    sessionId: v.sessionId,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    localDate: v.localDate,
    complete: v.complete === true,
    endReason: pick(v.endReason, END_REASONS) ?? 'user_exit',
    resumed: v.resumed === true,
    familyMode: v.familyMode === true,
    phraseCount: isNumber(v.phraseCount) ? v.phraseCount : attempts.length,
    calMarginDb: numOrNull(v.calMarginDb),
    cuesUsed: isNumber(v.cuesUsed) ? v.cuesUsed : 0,
    attempts,
    vowels,
    skipped,
  };
}

export function parseSettings(v: unknown): Settings {
  if (!isObject(v)) return { ...DEFAULT_SETTINGS };
  return {
    familyMode: v.familyMode === true,
    cueWord: validateText(v.cueWord, 12),
    measurementMode: v.measurementMode === 'listener_edition' ? 'listener_edition' : 'relative_band',
    onboarded: v.onboarded === true,
  };
}

export function parseCheckpoint(v: unknown): Checkpoint | null {
  if (!isObject(v) || v.version !== 1 || !isNumber(v.savedAt) || !isNumber(v.phraseIdx)) return null;
  const record = parseRecord(v.record);
  const bank = validatePhraseBank(v.phrases);
  if (!record || !bank.ok) return null;
  return {
    version: 1,
    savedAt: v.savedAt,
    stage: typeof v.stage === 'string' ? v.stage : 'unknown',
    phrases: bank.phrases,
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
  corruptKeys: number;
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
      if (parsed) out.active = parsed;
      else out.corruptKeys += 1;
    }
  }

  // 30-day retention: prune old session summaries on launch.
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  const keep: SessionRecord[] = [];
  const drop: SessionRecord[] = [];
  for (const record of out.records) (record.endedAt < cutoff ? drop : keep).push(record);
  if (drop.length > 0) {
    await storage.multiRemove(drop.map((r) => sessionKey(r.sessionId)));
    out.prunedSessions = drop.length;
  }
  out.records = keep.sort((a, b) => a.endedAt - b.endedAt);
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

/**
 * Internal state of the authoritative TV session machine. JSON-friendly, no functions, no
 * credentials in anything that is ever projected or persisted (the credential lives only in
 * `Core.credential`, which view.ts never reads).
 */

import type { ActionId, LinkView, TvInput, TvStage } from './contract.js';
import type { LoadedData, Checkpoint, DeleteResult, Settings } from './storage.js';
import type { AttemptRecord, EndReason, SessionRecord, VowelRecord } from './records.js';
import type { MicMode, MicStateName, Outbound } from './wire.js';

export type WinKind = 'quiet_check' | 'calibration' | 'vowel' | 'phrase';
export type WinPhase = 'lead' | 'precheck' | 'capture' | 'closing';

export interface Win {
  kind: WinKind;
  phase: WinPhase;
  windowId: string;
  attemptId: string;
  leadUntil: number;
  precheckAt: number | null;
  captureAt: number | null;
  closingAt: number | null;
  /** Maximum capture time (ms) for calibration/vowel/phrase; precheck duration for quiet_check. */
  maxMs: number;
  /** 1-based phrase position for phrase windows. */
  position: number | null;
  /** Blind first attempt: nothing derived from level or verdict may reach the view. */
  hidden: boolean;
  attemptNumber: number;
  stopSent: boolean;
  lastFrameIndex: number;
}

export type Sub = 'ready' | 'running' | 'result' | 'failed';

export interface Session {
  sessionId: string;
  startedAt: number;
  familyMode: boolean;
  phrases: string[];
  /** 0-based index of the current phrase position. */
  phraseIdx: number;
  floorDbfs: number | null;
  calMarginDb: number | null;
  /** The speaker chose to continue without a band: phrases run unscored. */
  noBand: boolean;
  attempts: AttemptRecord[];
  vowels: VowelRecord[];
  skipped: number[];
  cuesUsed: number;
  resumed: boolean;
  interruptedNote: string | null;
  /** True once the first phrase window has begun; the bank is then fixed for this session. */
  phraseStarted: boolean;
  /** Where Continue goes after a calibration result. */
  afterCal: 'vowel' | 'phrase';
  lastCalibration: { accepted: boolean; marginDb: number | null; reason: string | null } | null;
  lastVowel: VowelRecord | null;
  /** Attempt currently being captured, awaiting responses, or just revealed. */
  currentAttemptId: string | null;
  listenerDeadline: number | null;
  listenerOffered: boolean;
  listenerOpenSent: boolean;
  beginSent: boolean;
  /** Quiet-check outcome kept for the failed screen. */
  quietFailure: string | null;
  /** Set when the summary was produced; the session is then read-only. */
  ended: EndReason | null;
}

export type PausedFrom = 'quiet_check' | 'calibration' | 'vowel' | 'phrase';
export interface Paused {
  from: PausedFrom;
  reason: string;
}

export type DialogKind = 'leave' | 'delete' | 'reset' | 'unpair';
export type Overlay = 'settings' | 'about' | 'diagnostics' | null;

export interface Banner {
  kind: 'info' | 'warning' | 'error';
  text: string;
}

export interface JoinRequest {
  joinId: string;
  deviceLabel: string;
  confirmDigits: string;
  expiresAt: number;
}

export interface Core {
  now: number;
  booted: boolean;
  /** Data from a newer schema exists: nothing is written until the user deletes it. */
  future: boolean;
  futureVersion: number | null;
  settings: Settings;
  /** Saved household bank for the next session. */
  phraseBank: string[];
  records: SessionRecord[];
  checkpoint: Checkpoint | null;

  stage: TvStage;
  idleScreen: 'onboarding' | 'home';
  overlay: Overlay;
  dialog: DialogKind | null;
  historyReturn: 'idle' | 'summary';
  sub: Sub;
  banner: Banner | null;
  paused: Paused | null;
  /** Action that opened a dialog: its control regains focus when the dialog closes. */
  restoreFocus: ActionId | null;

  link: LinkView;
  authed: boolean;
  roomId: string | null;
  /** Memory only. Never projected, persisted or logged. */
  credential: string | null;
  generation: number;
  code: string | null;
  codeExpiresAt: number | null;
  refreshRequested: boolean;
  joinRequest: JoinRequest | null;
  joinAccepted: boolean;
  peerConnected: boolean;
  phonePaired: boolean;
  pairOnly: boolean;

  mic: { state: MicStateName | null; mode: MicMode | null };

  session: Session | null;
  win: Win | null;
  level: { relDb: number; active: boolean; at: number } | null;
  cue: { text: string; expiresAt: number } | null;
  pendingCancels: Outbound[];
  deleting: boolean;
  deleteRemaining: number;

  lastStateSig: string;
  staleLevelAckWindow: string | null;
  counters: Record<string, number>;
}

export type InternalEvent =
  | { type: 'loaded'; data: LoadedData }
  | { type: 'load_failed' }
  | { type: 'storage_failed' }
  | { type: 'send_failed' }
  | { type: 'delete_done'; result: DeleteResult };

export type Event = TvInput | { kind: 'internal'; event: InternalEvent };

export type PersistOp =
  | { op: 'settings'; settings: Settings }
  | { op: 'phrases'; phrases: string[] }
  | { op: 'session'; record: SessionRecord; all: SessionRecord[] }
  | { op: 'checkpoint'; checkpoint: Checkpoint }
  | { op: 'clear_checkpoint' };

export type Effect =
  | { kind: 'send'; message: Outbound }
  /** Tell the outbox the room and authenticated generation (restarts the sequence when either changes). */
  | { kind: 'bind'; roomId: string | null; generation: number }
  | { kind: 'connect' }
  | { kind: 'close'; reason: string }
  | { kind: 'persist'; op: PersistOp }
  | { kind: 'delete_all' };

export interface Env {
  now(): number;
  localDate(epochMs: number): string;
  newId(prefix: string, chars?: number): string;
  relayUrl: string;
  appVersion: string;
  platform: 'vega' | 'web_preview' | 'test';
  fixtureMode: boolean;
}

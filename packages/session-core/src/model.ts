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
  /** Identifies the CURRENT measurement: the precheck's id during the precheck, a fresh id for the capture. */
  windowId: string;
  attemptId: string;
  leadUntil: number;
  /** Length of the quiet lead used for this window (1500 ms, or longer with a screen reader on). */
  leadMs: number;
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
  /** Attempts for which attempt.reveal has already been sent (it locks the phone's listener controls). */
  revealSent: string[];
  /** Attempts the TV opened the listener for: only these can receive a listener response (others are unsolicited). */
  listenerOpenAttempts: string[];
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
  /** Untrusted text chosen by the joining client. */
  deviceLabel: string;
  /** The real digits. Never projected into the view (A3-06 number matching). */
  confirmDigits: string;
  /** Display order of the three choices; exactly one equals confirmDigits. */
  choices: [string, string, string];
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
  /** Generation of the phone connection last announced by peer.state (A3-07 supersede detection). */
  phoneGeneration: number | null;
  pairOnly: boolean;

  mic: { state: MicStateName | null; mode: MicMode | null };

  session: Session | null;
  win: Win | null;
  level: { relDb: number; active: boolean; at: number } | null;
  cue: { text: string; expiresAt: number } | null;
  /**
   * Must-deliver commands (window.cancel, session.end, unpair, room.close) that could not be sent while the link was
   * down; flushed after auth.ok and when the phone is back (QA-03).
   */
  pendingOut: Outbound[];
  deleting: boolean;
  deleteRemaining: number;
  /** Outcome of the last delete: success is only ever claimed after the key listing verified it. */
  deleteOutcome: 'deleted' | 'failed' | null;
  /** Best-effort unpair + room.close on delete (A5-01). */
  relayCleanup: 'none' | 'pending' | 'confirmed' | 'not_confirmed';
  cleanupDeadline: number | null;
  /** Screen reader state read from the platform (A8-02). */
  screenReader: boolean;
  /** Banner and cue announcements held back while capturing, or until reveal for a hidden attempt (A8-01). */
  deferred: { texts: string[]; stage: TvStage | null };
  /** Banner text as of the last event, to tell a banner that appeared during a window from an older one. */
  lastBanner: string | null;
  /** Stored values that could not be validated (treated as absent; a delete is offered). */
  corruptKeys: number;
  /** PK-12: String.prototype.normalize works on this runtime. */
  nfcOk: boolean;

  lastStateSig: string;
  /** Clock time of the last message the TV sent (any type); the heartbeat measures idleness from it. */
  lastSentAt: number;
  staleLevelAckWindow: string | null;
  counters: Record<string, number>;
}

export type InternalEvent =
  | { type: 'loaded'; data: LoadedData }
  | { type: 'load_failed' }
  | { type: 'storage_failed' }
  | { type: 'record_not_saved' }
  | { type: 'send_failed' }
  | { type: 'delete_done'; result: DeleteResult };

export type Event = TvInput | { kind: 'internal'; event: InternalEvent };

export type PersistOp =
  | { op: 'settings'; settings: Settings }
  | { op: 'phrases'; phrases: string[] }
  | { op: 'session'; record: SessionRecord; all: SessionRecord[] }
  /** Write the finished record, and only if that succeeded clear the checkpoint (QA-02, QA-07). */
  | { op: 'finalize'; record: SessionRecord; all: SessionRecord[] }
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
  /** Random bytes for UI decoys (A3-06): deps.randomBytes when present, else a non-cryptographic source. */
  randomBytes(n: number): Uint8Array;
  /** PK-12 startup self-test of NFC normalization; injectable for tests. */
  nfcSelfTest(): boolean;
  relayUrl: string;
  appVersion: string;
  platform: 'vega' | 'web_preview' | 'test';
  fixtureMode: boolean;
}

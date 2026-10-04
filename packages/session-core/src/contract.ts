/**
 * Contract between the authoritative TV session core (@atr/session-core) and the
 * TV user interface (apps/tv). Frozen at revision 2 by the lead (2026-10-05).
 *
 * Revision 2 (docs/adr/AMENDMENTS-REV2.md): number-matching join confirmation (A3-06) replaces
 * accept_join; the correct confirm digits are no longer in the view. New input { kind: 'a11y' }
 * (A8-02). The wire input carries the raw text frame only (PK-09).
 *
 * The UI renders only `TvView` and sends only `TvInput`. Hidden-meter and
 * reveal guarantees are enforced here: when a value must not be shown, it is
 * absent from the view (not merely flagged), so the UI cannot leak it.
 *
 * Changes to this file require the lead's approval and a revision note.
 */

/** Session stages (PROTOCOL.md §6). */
export type TvStage =
  | 'idle'
  | 'pairing'
  | 'permission_pending'
  | 'quiet_check'
  | 'calibration'
  | 'vowel_ready'
  | 'vowel_active'
  | 'vowel_result'
  | 'phrase_ready'
  | 'phrase_active'
  | 'response_pending'
  | 'reveal'
  | 'summary'
  | 'history'
  | 'paused_or_invalid'
  | 'resume_or_discard';

/** Screens the UI can render. Settings/onboarding are screens outside the session stages. */
export type ScreenId =
  | 'onboarding'
  | 'home'
  | 'pairing'
  | 'join_confirm'
  | 'permission_pending'
  | 'quiet_check'
  | 'calibration'
  | 'vowel'
  | 'phrase'
  | 'response'
  | 'reveal'
  | 'summary'
  | 'history'
  | 'paused_or_invalid'
  | 'resume_or_discard'
  | 'settings'
  | 'confirm_dialog'
  | 'about'
  | 'diagnostics';

/** Every action the UI can trigger. The view lists which are currently available. */
export type ActionId =
  | 'start_session'
  | 'open_history'
  | 'open_settings'
  | 'pair_phone'
  | 'cancel'
  | 'pick_choice_1'
  | 'pick_choice_2'
  | 'pick_choice_3'
  | 'reject_join'
  | 'refresh_code'
  | 'begin_quiet_check'
  | 'retry'
  | 'skip_calibration'
  | 'begin_calibration'
  | 'begin_vowel'
  | 'skip_vowel'
  | 'stop_early'
  | 'rest'
  | 'continue'
  | 'begin_phrase'
  | 'next_phrase'
  | 'try_again'
  | 'skip_phrase'
  | 'finish_early'
  | 'rate_felt_loud'
  | 'rate_felt_normal'
  | 'rate_skip'
  | 'keep_waiting'
  | 'continue_without_listener'
  | 'done'
  | 'resume_session'
  | 'discard_session'
  | 'reset_calibration'
  | 'delete_local_data'
  | 'unpair_phone'
  | 'toggle_family_mode'
  | 'open_about'
  | 'open_diagnostics'
  | 'confirm_destructive'
  | 'cancel_destructive'
  | 'back';

export interface ViewAction {
  id: ActionId;
  label: string;
  /** Accessible hint read after the label (aria-describedby / accessibilityHint). */
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
}

/** What the TV may say about the phone microphone. Never "off" without phone acknowledgement. */
export type MicView =
  | 'not_paired'
  | 'waiting_for_permission'
  | 'permission_denied'
  | 'no_input'
  | 'input_busy'
  | 'constraints_unsupported'
  | 'open_not_measuring'
  | 'measuring'
  | 'off'
  | 'unknown'
  | 'error';

export type LinkView = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface MeterView {
  /** Present only when the meter may be shown (never for hidden first attempts before reveal). */
  levelRelDb: number | null;
  /** Today's band edge relative to the session floor (cal_margin − 1 dB); null before calibration. */
  bandRelDb: number | null;
  /** Provisional voice activity for display only. */
  active: boolean;
  caption: string;
}

export interface TimerView {
  elapsedMs: number;
  maxMs: number | null;
  label: string;
}

export type ResultTone = 'reached' | 'below' | 'not_scored' | 'neutral';

export interface ResultView {
  /** Text label is mandatory: colour/shape alone never carries the result. */
  label: string;
  tone: ResultTone;
  detail: string | null;
  borderline: boolean;
  listener: string | null;
  speakerRating: string | null;
}

export interface CueChip {
  text: string;
  /** Epoch ms when the chip should disappear (3 s after arrival). */
  expiresAt: number;
}

export interface HistoryDayView {
  /** Local calendar date YYYY-MM-DD. */
  date: string;
  weekdayLabel: string;
  /** null = no session that day (missing days stay missing). */
  sessions: number | null;
  reached: number | null;
  scored: number | null;
  longestActiveMs: number | null;
  incomplete: boolean;
}

export interface SummaryView {
  complete: boolean;
  phrasesCompleted: number;
  phrasesAttempted: number;
  phrasesSkipped: number;
  attemptsInvalid: number;
  invalidReasons: Record<string, number>;
  reachedVisible: number;
  scoredVisible: number;
  reachedHidden: number;
  scoredHidden: number;
  longestActiveMs: number | null;
  hiddenRatings: { feltLoud: number; feltNormal: number; skipped: number };
  agreementHidden: { agree: number; eligible: number };
  agreementVisible: { agree: number; eligible: number };
  lateListenerResponses: number;
  borderlineCount: number;
  calibrationMarginDb: number | null;
  lines: string[];
}

export interface DialogView {
  title: string;
  body: string;
  confirm: ViewAction;
  cancel: ViewAction;
  /** Always 'cancel' for destructive dialogs. */
  preferred: 'cancel' | 'confirm';
}

export interface TvView {
  screen: ScreenId;
  stage: TvStage;
  title: string;
  body: string[];
  /** Live-region text for screen readers; null while capturing (ADR-0008). */
  announcement: string | null;
  /** True while a precheck or capture window is open: suppress routine announcements. */
  capturing: boolean;
  actions: ViewAction[];
  preferredAction: ActionId | null;
  pairing: {
    code: string | null;
    codeExpiresAt: number | null;
    qrPayload: string | null;
    /**
     * Number matching (A3-06): three two-digit choices in display order, exactly one of which equals
     * the digits shown on the phone. The view never says which one. deviceLabel is untrusted text
     * chosen by the joining client; render it as "Name the phone gave: …".
     */
    joinRequest: { deviceLabel: string; choices: [string, string, string] } | null;
  } | null;
  mic: MicView;
  link: LinkView;
  meter: MeterView | null;
  timer: TimerView | null;
  phrase: { position: number; total: number; text: string; attemptNumber: number } | null;
  result: ResultView | null;
  cue: CueChip | null;
  summary: SummaryView | null;
  history: HistoryDayView[] | null;
  dialog: DialogView | null;
  banner: { kind: 'info' | 'warning' | 'error'; text: string } | null;
  /** Persistent labels such as "Relative level, this session only" or "Fixture replay". */
  labels: string[];
  footer: string;
  diagnostics: Record<string, string> | null;
}

/** Inputs the UI and adapters dispatch into the session store. */
export type RemoteKey = 'ok' | 'back' | 'up' | 'down' | 'left' | 'right' | 'play_pause';

export type TvInput =
  | { kind: 'remote'; key: RemoteKey }
  | { kind: 'ui'; action: ActionId }
  | { kind: 'timer'; now: number }
  | { kind: 'transport'; state: LinkView; detail?: string }
  /** Raw text frame exactly as received; the store parses it with parseWireMessage. Objects are refused. */
  | { kind: 'wire'; message: string }
  /** Screen reader state read from the platform (read-only); lengthens the quiet lead (A8-02). */
  | { kind: 'a11y'; screenReader: boolean }
  | { kind: 'app'; event: 'launched' | 'backgrounded' | 'foregrounded' };

/** Storage port (implemented by AsyncStorage on Vega, memory in tests). */
export interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** Transport port (WebSocket adapter in apps/tv, in-process fake in tests). */
export interface TransportPort {
  connect(url: string): void;
  /** Serialized, already-validated wire message. Returns false if the socket is not open. */
  send(serialized: string): boolean;
  close(reason: string): void;
}

export interface ClockPort {
  now(): number;
  /** Local calendar date for history, YYYY-MM-DD in the TV's time zone. */
  localDate(epochMs: number): string;
}

export interface SessionStoreDeps {
  clock: ClockPort;
  storage: StoragePort;
  transport: TransportPort;
  relayUrl: string;
  /** Random bytes for identifiers; falls back to a non-cryptographic generator if absent. */
  randomBytes?: (n: number) => Uint8Array;
  appVersion: string;
  platform: 'vega' | 'web_preview' | 'test';
  /** Fixture replay mode: in-memory history, persistent "Fixture replay" label. */
  fixtureMode?: boolean;
}

export interface SessionStore {
  getView(): TvView;
  subscribe(listener: (view: TvView) => void): () => void;
  dispatch(input: TvInput): void;
  /** Resolves after storage load and resume detection. */
  ready(): Promise<void>;
  dispose(): void;
}

/**
 * Authoritative TV session machine. Reducer-style: every transition goes through `handle(event)`,
 * which updates the owned state deterministically (time comes only from the event or the injected
 * clock; identifiers come only from the injected generator) and returns the effects to run
 * (send, persist, connect, close, delete). It owns no timers: the app ticks it with
 * { kind: 'timer', now }. STATE_MACHINE.md documents every stage.
 */

import {
  CALIBRATION_WINDOW_MS,
  CUE_CHIP_MS,
  CUES_MAX,
  LEVEL_SMOOTHING,
  LISTENER_OPEN_TIMEOUT_MS,
  LISTENER_WAIT_MS,
  PHRASE_WINDOW_MS,
  PRE_WINDOW_MS,
  QUIET_CHECK_MS,
  RESULT_GRACE_MS,
  SEEN_IDS_MAX,
  SILENT_FLOOR_DBFS,
  STARTER_PHRASES,
  QUIET_FLOOR_MAX_DBFS,
  BEGIN_RESEND_MIN_MS,
  VOWEL_MAX_MS,
} from './constants.js';
import type { ActionId, LinkView, RemoteKey, TvStage, TvView } from './contract.js';
import { COPY } from './copy.js';
import { safeLocalDate } from './dates.js';
import { buildChoices } from './matching.js';
import type { Core, DialogKind, Effect, Env, Event, InternalEvent, Paused, PausedFrom, Session, Sub, Win, WinKind } from './model.js';
import type { AttemptRecord, EndReason, SessionRecord, VowelRecord } from './records.js';
import {
  attemptsAt,
  currentAttempt,
  hasStartedAttempt,
  isBlindPending,
  isHiddenPosition,
  isListenerEdition,
  linkUp,
  measureReady,
  micOpen,
  quietLeadMs,
} from './selectors.js';
import { DEFAULT_SETTINGS } from './storage.js';
import type { Checkpoint } from './storage.js';
import { validateCue, validatePhraseBank } from './text.js';
import { evaluateCalibration, evaluateGate, evaluateQuietCheck, evaluateWindow } from './verdict.js';
import { HEARTBEAT_INTERVAL_MS, MessageIdDedupe, quantizeDb } from '@atr/protocol';
import type { MessageOf } from '@atr/protocol';
import { parseInbound } from './wire.js';
import type { AckOutcome, Ids, Inbound, Outbound, PrecheckResultPayload, WindowResultPayload } from './wire.js';
import { buildView } from './view.js';

type Msg<T extends Inbound['type']> = MessageOf<T>;

export function initialCore(env: Env): Core {
  return {
    now: env.now(),
    booted: false,
    future: false,
    futureVersion: null,
    settings: { ...DEFAULT_SETTINGS },
    phraseBank: [...STARTER_PHRASES],
    records: [],
    checkpoint: null,
    stage: 'idle',
    idleScreen: 'home',
    overlay: null,
    dialog: null,
    historyReturn: 'idle',
    sub: 'ready',
    banner: null,
    paused: null,
    restoreFocus: null,
    link: 'offline',
    authed: false,
    roomId: null,
    credential: null,
    generation: 0,
    code: null,
    codeExpiresAt: null,
    refreshRequested: false,
    joinRequest: null,
    joinAccepted: false,
    peerConnected: false,
    phonePaired: false,
    phoneGeneration: null,
    pairOnly: false,
    mic: { state: null, mode: null },
    session: null,
    win: null,
    level: null,
    cue: null,
    pendingOut: [],
    deleting: false,
    deleteRemaining: 0,
    deleteOutcome: null,
    relayCleanup: 'none',
    cleanupDeadline: null,
    screenReader: false,
    deferred: { texts: [], stage: null },
    lastBanner: null,
    corruptKeys: 0,
    nfcOk: env.nfcSelfTest(),
    lastStateSig: '',
    lastSentAt: 0,
    staleLevelAckWindow: null,
    counters: {},
  };
}

const IN_FLIGHT = ['capturing', 'capture_closed', 'response_pending'];

export class Machine {
  readonly s: Core;
  private fx: Effect[] = [];
  /** Recent message ids: a duplicate delivery is dropped silently (PROTOCOL.md section 8). */
  private readonly dedupe = new MessageIdDedupe(SEEN_IDS_MAX);

  constructor(private readonly env: Env) {
    this.s = initialCore(env);
  }

  view(): TvView {
    return buildView(this.s, this.env);
  }

  handle(event: Event): Effect[] {
    this.fx = [];
    const s = this.s;
    s.now = event.kind === 'timer' ? event.now : this.env.now();
    switch (event.kind) {
      case 'remote':
        this.onRemote(event.key);
        break;
      case 'ui':
        this.onAction(event.action);
        break;
      case 'timer':
        this.onTimer();
        break;
      case 'transport':
        this.onTransport(event.state);
        break;
      case 'wire':
        this.onWire(event.message);
        break;
      case 'a11y':
        s.screenReader = event.screenReader;
        break;
      case 'app':
        this.onApp(event.event);
        break;
      case 'internal':
        this.onInternal(event.event);
        break;
    }
    this.after();
    return this.fx;
  }

  /* ---------------------------------------------------------------- plumbing */

  private bump(name: string): void {
    this.s.counters[name] = (this.s.counters[name] ?? 0) + 1;
  }

  private send(message: Outbound, track?: 'session.begin'): void {
    this.bump('sent');
    this.s.lastSentAt = this.s.now;
    this.fx.push(track === undefined ? { kind: 'send', message } : { kind: 'send', message, track });
  }

  private persist(op: Extract<Effect, { kind: 'persist' }>['op']): void {
    if (!this.s.future) this.fx.push({ kind: 'persist', op });
  }

  private go(stage: TvStage, sub: Sub = 'ready', banner: Core['banner'] = null): void {
    const s = this.s;
    s.stage = stage;
    s.sub = sub;
    s.banner = banner;
    s.level = null;
    s.restoreFocus = null;
    if (stage !== 'paused_or_invalid') s.paused = null;
  }

  private ids(w?: Win | null): Ids {
    const sess = this.s.session;
    return {
      sessionId: sess ? sess.sessionId : null,
      windowId: w ? w.windowId : null,
      attemptId: w ? w.attemptId : null,
    };
  }

  private ack(m: Inbound, outcome: AckOutcome, detail: string): void {
    if (outcome === 'ignored_stale') this.bump('ignored_stale');
    if (outcome === 'rejected') this.bump('rejected');
    this.send({
      type: 'ack',
      ids: { sessionId: m.session_id, windowId: m.window_id, attemptId: m.attempt_id },
      payload: { acked_message_id: m.message_id, outcome, detail },
    });
  }

  private stale(m: Inbound): void {
    if (m.type === 'level') {
      // One ack per stale window: level frames arrive at 20 per second.
      this.bump('ignored_stale');
      if (this.s.staleLevelAckWindow !== m.window_id) {
        this.s.staleLevelAckWindow = m.window_id;
        this.ack(m, 'ignored_stale', '');
      }
      return;
    }
    this.ack(m, 'ignored_stale', '');
  }

  private after(): void {
    const s = this.s;
    if (s.cue !== null && s.now >= s.cue.expiresAt) s.cue = null;
    this.trackDeferred();
    this.syncSessionState();
  }

  /** True while a precheck or capture is open, or a hidden attempt waits for its reveal (A8-01, A4-03). */
  private quiet(): boolean {
    return this.s.win !== null || isBlindPending(currentAttempt(this.s.session));
  }

  /**
   * A8-01: a banner that appears while the TV must stay silent is shown but not announced; its text is queued and
   * announced once the capture has closed (after the reveal for a hidden attempt). It stays in the announcement
   * for the rest of that stage, so the text does not change under a screen reader.
   */
  private trackDeferred(): void {
    const s = this.s;
    const d = s.deferred;
    const text = this.view().banner?.text ?? null;
    if (this.quiet()) {
      if (text !== null && text !== s.lastBanner && !d.texts.includes(text)) d.texts.push(text);
      d.stage = null;
    } else if (d.texts.length > 0) {
      if (d.stage === null) d.stage = s.stage;
      else if (d.stage !== s.stage) {
        d.texts = [];
        d.stage = null;
      }
    }
    s.lastBanner = text;
  }

  /** Sends session.state when the stage, position, cue count or open listener attempt changed. */
  private syncSessionState(): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || !sess.beginSent || sess.ended !== null || !linkUp(s)) return;
    const inPhrase =
      s.stage === 'phrase_ready' ||
      s.stage === 'phrase_active' ||
      s.stage === 'response_pending' ||
      s.stage === 'reveal' ||
      (s.stage === 'paused_or_invalid' && s.paused?.from === 'phrase');
    const position = inPhrase ? sess.phraseIdx + 1 : 0;
    const attempt = currentAttempt(sess);
    const listenerOpen =
      s.stage === 'response_pending' && sess.familyMode && sess.listenerOpenSent && attempt && attempt.listener === null
        ? attempt.attemptId
        : null;
    // QA-05: the phone never learns that an attempt was blind, so response_pending and reveal are not sent. From the
    // capture start until the next phrase_ready or the summary it sees phrase_active; listener.open is the explicit
    // signal that the listener may answer.
    const phoneStage: TvStage = s.stage === 'response_pending' || s.stage === 'reveal' ? 'phrase_active' : s.stage;
    const sig = `${phoneStage}|${position}|${sess.cuesUsed}|${listenerOpen ?? ''}`;
    if (sig === s.lastStateSig) return;
    s.lastStateSig = sig;
    this.send({
      type: 'session.state',
      ids: { sessionId: sess.sessionId },
      payload: { stage: phoneStage, phrase_position: position, cues_used: sess.cuesUsed, listener_open_attempt: listenerOpen },
    });
  }

  /* ---------------------------------------------------------------- inputs */

  private onRemote(key: RemoteKey): void {
    if (key === 'back') {
      this.onBack();
      return;
    }
    if (key === 'ok') {
      const preferred = this.view().preferredAction;
      if (preferred === null) {
        this.bump('inputs_ignored');
        return;
      }
      this.onAction(preferred);
      return;
    }
    // D-pad focus and play/pause belong to the UI layer; the core takes no action.
  }

  private onAction(action: ActionId): void {
    if (action === 'back') {
      this.onBack();
      return;
    }
    const entry = this.view().actions.find((a) => a.id === action);
    if (!entry || entry.disabled === true) {
      // Duplicate OK protection: anything not currently offered is ignored.
      this.bump('inputs_ignored');
      return;
    }
    if (action !== 'cancel_destructive') this.s.restoreFocus = null;
    this.perform(action);
  }

  private onApp(event: 'launched' | 'backgrounded' | 'foregrounded'): void {
    if (event === 'backgrounded' && this.s.win !== null) this.cancelWindow('interrupted');
  }

  private onTimer(): void {
    this.tickWindow();
    this.tickListener();
    this.tickPairing();
    this.tickCleanup();
    this.tickHeartbeat();
  }

  /**
   * Keeps the relay connection alive: the relay drops a connection after 25 s without traffic, so when the
   * socket is open and the TV has sent nothing for HEARTBEAT_INTERVAL_MS (10 s) a `ping` goes out. Other
   * traffic counts as a heartbeat. A ping is valid before and after authentication.
   */
  private tickHeartbeat(): void {
    const s = this.s;
    if (s.link !== 'connected') return;
    if (s.now - s.lastSentAt < HEARTBEAT_INTERVAL_MS) return;
    this.bump('pings_sent');
    this.send({ type: 'ping', payload: {} });
  }

  private onInternal(event: InternalEvent): void {
    const s = this.s;
    switch (event.type) {
      case 'loaded': {
        s.booted = true;
        const data = event.data;
        s.future = data.status === 'future_version';
        s.futureVersion = data.futureVersion;
        s.corruptKeys = data.corruptKeys;
        if (!s.future) {
          s.settings = data.settings;
          s.phraseBank = data.phrases ?? [...STARTER_PHRASES];
          s.records = data.records;
          s.checkpoint = data.active;
        }
        if (s.checkpoint !== null && !s.future) {
          this.go('resume_or_discard');
        } else {
          this.go('idle', 'ready', data.pruneFailed ? { kind: 'warning', text: COPY.banner.storageFailed } : null);
          s.idleScreen = s.settings.onboarded || s.future ? 'home' : 'onboarding';
        }
        break;
      }
      case 'load_failed':
        s.booted = true;
        this.go('idle', 'ready', { kind: 'warning', text: COPY.banner.storageFailed });
        s.idleScreen = 'onboarding';
        break;
      case 'send_failed':
        this.bump('send_errors');
        break;
      case 'sent': {
        const sess = s.session;
        if (event.track === 'session.begin' && sess && sess.beginMessageIds.length < 16) sess.beginMessageIds.push(event.messageId);
        break;
      }
      case 'record_not_saved':
        // QA-07: the checkpoint was kept, so the work can be recovered on the next launch.
        s.banner = { kind: 'error', text: COPY.banner.recordNotSaved };
        break;
      case 'storage_failed':
        if (s.banner === null) s.banner = { kind: 'warning', text: COPY.banner.storageFailed };
        break;
      case 'delete_done':
        s.deleting = false;
        if (event.result.ok) {
          s.settings = { ...DEFAULT_SETTINGS };
          s.phraseBank = [...STARTER_PHRASES];
          s.records = [];
          s.checkpoint = null;
          s.future = false;
          s.futureVersion = null;
          s.corruptKeys = 0;
          s.deleteRemaining = 0;
          s.deleteOutcome = 'deleted';
        } else {
          s.deleteRemaining = event.result.remaining.length;
          s.deleteOutcome = 'failed';
        }
        this.deleteBanner();
        break;
    }
  }

  /* ---------------------------------------------------------------- actions */

  private perform(action: ActionId): void {
    const s = this.s;
    switch (action) {
      case 'continue':
        this.onContinue();
        break;
      case 'start_session':
        this.startSession();
        break;
      case 'open_history':
        s.historyReturn = s.stage === 'summary' ? 'summary' : 'idle';
        this.go('history');
        break;
      case 'open_settings':
        s.overlay = 'settings';
        break;
      case 'open_about':
        s.overlay = 'about';
        break;
      case 'open_diagnostics':
        s.overlay = 'diagnostics';
        break;
      case 'pair_phone':
        s.session = null;
        this.enterPairing(true);
        break;
      case 'cancel':
        if (s.win !== null) this.cancelWindow('user_cancel');
        else {
          this.leaveRequest();
          if (s.dialog !== null) s.restoreFocus = 'cancel';
        }
        break;
      case 'pick_choice_1':
        this.pickChoice(0);
        break;
      case 'pick_choice_2':
        this.pickChoice(1);
        break;
      case 'pick_choice_3':
        this.pickChoice(2);
        break;
      case 'reject_join':
        this.rejectJoin();
        break;
      case 'refresh_code':
        if (s.roomId === null || s.link === 'failed' || s.link === 'offline') this.connect();
        else this.requestRefresh();
        break;
      case 'begin_quiet_check':
        this.beginWindow('quiet_check');
        break;
      case 'begin_calibration':
        this.beginWindow('calibration');
        break;
      case 'begin_vowel':
        this.beginWindow('vowel');
        break;
      case 'begin_phrase':
        this.beginWindow('phrase');
        break;
      case 'retry':
        this.onRetry();
        break;
      case 'skip_calibration':
        this.afterCalibration();
        break;
      case 'skip_vowel':
        this.go('phrase_ready');
        break;
      case 'rest':
        this.go('vowel_ready');
        break;
      case 'stop_early':
        this.stopEarly();
        break;
      case 'next_phrase':
        this.advance();
        break;
      case 'try_again':
        if (s.session) s.session.currentAttemptId = null;
        this.go('phrase_ready');
        break;
      case 'skip_phrase':
        this.skipPhrase();
        break;
      case 'finish_early':
        this.enterSummary('user_exit');
        break;
      case 'rate_felt_loud':
        this.rate('felt_loud');
        break;
      case 'rate_felt_normal':
        this.rate('felt_normal');
        break;
      case 'rate_skip':
        this.rate('skipped');
        break;
      case 'keep_waiting': {
        // A4-04: a fresh listener.open with a fresh timeout, so the phone keeps its controls open.
        const a = currentAttempt(s.session);
        if (s.session && a && a.state === 'response_pending' && a.listener === null) this.openListener(a);
        break;
      }
      case 'continue_without_listener': {
        const a = currentAttempt(s.session);
        if (a && a.state === 'response_pending' && a.listener === null) {
          a.listener = 'missing';
          // Records "missing" and tells the phone to lock its listener controls right away (A4-04).
          this.lockListener(a);
          this.checkRevealReady();
        }
        break;
      }
      case 'done':
        this.onDone();
        break;
      case 'resume_session':
        this.resumeSession();
        break;
      case 'discard_session':
        this.discardSession();
        break;
      case 'toggle_family_mode':
        s.settings = { ...s.settings, familyMode: !s.settings.familyMode };
        this.persist({ op: 'settings', settings: s.settings });
        break;
      case 'reset_calibration':
        s.dialog = 'reset';
        s.restoreFocus = action;
        break;
      case 'delete_local_data':
        s.dialog = 'delete';
        s.restoreFocus = action;
        break;
      case 'unpair_phone':
        s.dialog = 'unpair';
        s.restoreFocus = action;
        break;
      case 'confirm_destructive':
        this.confirmDialog();
        break;
      case 'cancel_destructive':
        s.dialog = null;
        break;
      case 'back':
        this.onBack();
        break;
    }
  }

  private onContinue(): void {
    const s = this.s;
    if (s.stage === 'idle' && s.idleScreen === 'onboarding') {
      s.settings = { ...s.settings, onboarded: true };
      s.idleScreen = 'home';
      this.persist({ op: 'settings', settings: s.settings });
      return;
    }
    const sess = s.session;
    if (!sess) return;
    if (s.stage === 'calibration') {
      if (!sess.lastCalibration?.accepted && sess.calMarginDb === null) sess.noBand = true;
      this.afterCalibration();
      return;
    }
    if (s.stage === 'vowel_result') this.go('phrase_ready');
  }

  private afterCalibration(): void {
    const sess = this.s.session;
    if (!sess) return;
    const target = sess.afterCal;
    sess.afterCal = 'vowel';
    this.go(target === 'phrase' ? 'phrase_ready' : 'vowel_ready');
  }

  private onBack(): void {
    const s = this.s;
    if (s.dialog !== null) {
      s.dialog = null; // Back on a dialog is Cancel; the control that opened it regains focus
      return;
    }
    s.restoreFocus = null;
    if (s.overlay !== null) {
      s.overlay = s.overlay === 'settings' ? null : 'settings';
      return;
    }
    if (s.win !== null) {
      this.cancelWindow('user_cancel');
      return;
    }
    switch (s.stage) {
      case 'idle':
      case 'resume_or_discard':
        this.bump('inputs_ignored');
        return;
      case 'pairing':
        if (s.joinRequest !== null) this.rejectJoin();
        else this.leaveRequest();
        return;
      case 'summary':
        this.onDone();
        return;
      case 'history':
        this.onDone();
        return;
      default:
        this.leaveRequest();
    }
  }

  /** Leaving: no confirmation before practice begins; a confirm dialog (Cancel preferred) afterwards. */
  private leaveRequest(): void {
    const s = this.s;
    if (s.stage === 'pairing') {
      s.session = null;
      this.go('idle');
      s.idleScreen = 'home';
      return;
    }
    if (s.stage === 'permission_pending') {
      this.leaveSession();
      return;
    }
    s.dialog = 'leave';
  }

  private onDone(): void {
    const s = this.s;
    if (s.stage === 'history') {
      if (s.historyReturn === 'summary' && s.session) this.go('summary');
      else {
        this.go('idle');
        s.idleScreen = 'home';
      }
      return;
    }
    if (s.stage === 'summary') {
      s.session = null;
      this.go('idle');
      s.idleScreen = 'home';
    }
  }

  private confirmDialog(): void {
    const s = this.s;
    const kind: DialogKind | null = s.dialog;
    s.dialog = null;
    s.restoreFocus = null;
    if (kind === 'leave') {
      this.leaveSession();
    } else if (kind === 'delete') {
      s.deleting = true;
      s.deleteOutcome = null;
      this.relayCleanupForDelete();
      this.fx.push({ kind: 'delete_all' });
    } else if (kind === 'reset') {
      const sess = s.session;
      if (sess) {
        sess.calMarginDb = null;
        sess.noBand = false;
        sess.lastCalibration = null;
        sess.afterCal = s.stage === 'phrase_ready' ? 'phrase' : s.stage === 'vowel_ready' ? 'vowel' : sess.afterCal;
        s.overlay = null;
        this.go('calibration', 'ready', { kind: 'info', text: COPY.banner.resetDone });
      }
    } else if (kind === 'unpair') {
      this.send({ type: 'unpair', payload: {} });
      s.phonePaired = false;
      s.peerConnected = false;
      s.phoneGeneration = null;
      s.mic = { state: null, mode: null };
      s.banner = { kind: 'info', text: 'The phone was unpaired.' };
    }
  }

  /* ---------------------------------------------------------------- pairing and link */

  private newSession(phrases: string[], familyMode: boolean): Session {
    return {
      sessionId: this.env.newId('s_'),
      startedAt: this.s.now,
      familyMode,
      phrases,
      phraseIdx: 0,
      floorDbfs: null,
      calMarginDb: null,
      noBand: false,
      attempts: [],
      vowels: [],
      skipped: [],
      cuesUsed: 0,
      resumed: false,
      interruptedNote: null,
      phraseStarted: false,
      afterCal: 'vowel',
      lastCalibration: null,
      lastVowel: null,
      currentAttemptId: null,
      listenerDeadline: null,
      listenerOffered: false,
      listenerOpenSent: false,
      beginSent: false,
      beginAcked: false,
      beginMessageIds: [],
      lastBeginAt: null,
      revealSent: [],
      listenerOpenAttempts: [],
      quietFailure: null,
      ended: null,
    };
  }

  /** A new identifier that does not collide with one already recorded (matters after a resume). */
  private freshId(prefix: string, taken: (id: string) => boolean): string {
    let id = this.env.newId(prefix);
    for (let i = 0; i < 8 && taken(id); i += 1) id = this.env.newId(prefix);
    return id;
  }

  /** window_id is unique per measurement: never reuse one that a precheck, capture or recorded attempt already carried. */
  private freshWindowId(sess: Session, current?: string): string {
    return this.freshId(
      'w_',
      (id) => id === current || sess.attempts.some((a) => a.windowId === id) || sess.vowels.some((v) => v.windowId === id),
    );
  }

  private startSession(): void {
    const s = this.s;
    // Listener Edition makes the listener's answer the primary outcome, so the listener check is always on.
    s.session = this.newSession([...s.phraseBank], s.settings.familyMode || isListenerEdition(s));
    s.lastStateSig = '';
    if (linkUp(s) && s.roomId !== null && s.phonePaired && s.peerConnected) this.enterPermission();
    else this.enterPairing(false);
  }

  private connect(): void {
    const s = this.s;
    if (s.link === 'connecting' || s.link === 'reconnecting') return;
    s.link = 'connecting';
    this.fx.push({ kind: 'connect' });
  }

  private enterPairing(pairOnly: boolean): void {
    const s = this.s;
    s.pairOnly = pairOnly;
    s.joinRequest = null;
    s.joinAccepted = false;
    s.refreshRequested = false;
    this.go('pairing');
    if (s.roomId === null || s.link === 'failed' || s.link === 'offline') this.connect();
    else if (linkUp(s) && (s.code === null || (s.codeExpiresAt !== null && s.now >= s.codeExpiresAt))) this.requestRefresh();
  }

  private requestRefresh(): void {
    const s = this.s;
    if (!linkUp(s)) return;
    s.refreshRequested = true;
    this.send({ type: 'pairing.refresh', payload: {} });
  }

  private tickPairing(): void {
    const s = this.s;
    if (s.stage !== 'pairing' || !linkUp(s) || s.refreshRequested || s.codeExpiresAt === null) return;
    if (s.now >= s.codeExpiresAt && !s.joinAccepted && s.joinRequest === null) this.requestRefresh();
  }

  /**
   * Number matching (A3-06): the right number accepts the phone, a wrong number rejects it. Either way a
   * reject burns the code at the relay, which sends a fresh pairing.code; until then no code is shown.
   */
  private pickChoice(index: number): void {
    const s = this.s;
    const join = s.joinRequest;
    if (!join) return;
    const picked = join.choices[index];
    if (picked === join.confirmDigits) {
      this.send({ type: 'join.confirm', payload: { join_id: join.joinId, decision: 'accept' } });
      s.joinRequest = null;
      s.joinAccepted = true;
      return;
    }
    this.bump('join_mismatches');
    this.send({ type: 'join.confirm', payload: { join_id: join.joinId, decision: 'reject' } });
    this.burnCode();
    s.banner = { kind: 'warning', text: COPY.join.mismatch };
  }

  private rejectJoin(): void {
    const s = this.s;
    const join = s.joinRequest;
    if (!join) return;
    this.send({ type: 'join.confirm', payload: { join_id: join.joinId, decision: 'reject' } });
    this.burnCode();
  }

  /** A TV reject or a wrong pick burns the code (A3-02): never keep showing a code that is dead. */
  private burnCode(): void {
    const s = this.s;
    s.joinRequest = null;
    s.joinAccepted = false;
    s.code = null;
    s.codeExpiresAt = null;
    s.refreshRequested = false;
  }

  /**
   * A5-01: deleting local data also ends the pairing at the relay: a best-effort unpair and room.close. The relay
   * does not acknowledge them, so "confirmed" means the relay then closed our connection; if it has not within
   * 5 s the cleanup is reported as not confirmed. Credentials and room identity are dropped either way.
   */
  private relayCleanupForDelete(): void {
    const s = this.s;
    if (s.roomId !== null && linkUp(s)) {
      this.send({ type: 'unpair', payload: {} });
      this.send({ type: 'room.close', payload: {} });
      s.relayCleanup = 'pending';
      s.cleanupDeadline = s.now + 5000;
    } else if (s.roomId !== null || s.relayCleanup !== 'confirmed') {
      s.relayCleanup = 'not_confirmed';
      s.cleanupDeadline = null;
    }
    s.roomId = null;
    s.credential = null;
    s.generation = 0;
    s.code = null;
    s.codeExpiresAt = null;
    s.joinRequest = null;
    s.joinAccepted = false;
    s.phonePaired = false;
    s.peerConnected = false;
    s.phoneGeneration = null;
    s.pendingOut = [];
    s.mic = { state: null, mode: null };
    s.authed = false;
    this.fx.push({ kind: 'bind', roomId: null, generation: 0 });
  }

  private cleanupText(): string {
    switch (this.s.relayCleanup) {
      case 'pending':
        return COPY.banner.relayCleanupPending;
      case 'confirmed':
        return COPY.banner.relayCleanupConfirmed;
      case 'not_confirmed':
        return COPY.banner.relayCleanupNotConfirmed;
      default:
        return '';
    }
  }

  /** Banner for the last delete: success is only claimed after the key listing verified it. */
  private deleteBanner(): void {
    const s = this.s;
    if (s.deleteOutcome === 'deleted') {
      s.banner = { kind: 'info', text: `${COPY.banner.deleted} ${this.cleanupText()}`.trim() };
    } else if (s.deleteOutcome === 'failed') {
      s.banner = { kind: 'error', text: `${COPY.banner.deleteFailed} ${this.cleanupText()}`.trim() };
    }
  }

  private tickCleanup(): void {
    const s = this.s;
    if (s.relayCleanup !== 'pending' || s.cleanupDeadline === null || s.now < s.cleanupDeadline) return;
    s.relayCleanup = 'not_confirmed';
    s.cleanupDeadline = null;
    this.fx.push({ kind: 'close', reason: 'delete_cleanup_timeout' });
    this.deleteBanner();
  }

  private onTransport(state: LinkView): void {
    const s = this.s;
    s.link = state;
    if (state === 'connected') {
      s.authed = false;
      if (s.roomId !== null && s.credential !== null) {
        this.send({ type: 'auth.resume', payload: { room_id: s.roomId, role: 'tv', credential: s.credential } });
      } else if (s.stage === 'pairing') {
        this.send({
          type: 'room.create',
          payload: { client: { app_version: this.env.appVersion, platform: this.env.platform } },
        });
      } else {
        // No pairing is wanted (for example the relay closed the room after a delete): do not create a room.
        this.fx.push({ kind: 'close', reason: 'no_room_wanted' });
      }
      return;
    }
    if (state === 'reconnecting' || state === 'offline' || state === 'failed') {
      if (s.relayCleanup === 'pending') {
        s.relayCleanup = 'confirmed';
        s.cleanupDeadline = null;
        this.deleteBanner();
      }
      this.onLinkDown();
    }
  }

  /** Link loss: the phone state becomes unknown (never "off") and any open window is cancelled and unscored. */
  private onLinkDown(): void {
    const s = this.s;
    s.authed = false;
    s.peerConnected = false;
    s.mic = { state: null, mode: s.mic.mode };
    s.joinRequest = null;
    if (s.win !== null) this.cancelWindow('link_lost');
  }

  /**
   * The relay ended this pairing (expired, unauthorized, revoked ...). A `revoked` role means a consumed credential
   * was presented (A3-07): the pairing may be compromised. Either way the TV drops the room and, if a session or
   * the pairing screen was open, goes back to pairing with a fresh room; an open window is cancelled and unscored.
   */
  private pairingLost(code: string): void {
    const s = this.s;
    s.authed = false;
    s.roomId = null;
    s.credential = null;
    s.code = null;
    s.codeExpiresAt = null;
    s.phonePaired = false;
    s.peerConnected = false;
    s.phoneGeneration = null;
    s.joinRequest = null;
    s.joinAccepted = false;
    s.mic = { state: null, mode: null };
    s.link = 'offline';
    s.generation = 0;
    s.pendingOut = [];
    this.fx.push({ kind: 'bind', roomId: null, generation: 0 });
    this.fx.push({ kind: 'close', reason: code });
    if (s.win !== null) this.cancelWindow('link_lost');
    s.pendingOut = [];
    const sess = s.session;
    const inFlow = sess !== null || s.stage === 'pairing';
    if (sess) {
      // A new phone means a new floor and band: the old ones belonged to the old pairing.
      sess.beginSent = false;
      sess.beginAcked = false;
      sess.beginMessageIds = [];
      sess.lastBeginAt = null;
      sess.floorDbfs = null;
      sess.calMarginDb = null;
      sess.lastCalibration = null;
      sess.currentAttemptId = null;
    }
    const banner = { kind: 'error' as const, text: code === 'revoked' ? COPY.banner.pairingCompromised : COPY.banner.pairingLost };
    if (inFlow) {
      this.enterPairing(false);
    }
    s.banner = banner;
  }

  /** Commands for the phone are forwarded by the relay, so they wait for an authenticated link and a connected phone. */
  private static readonly TO_PHONE = new Set(['window.cancel', 'session.end', 'window.stop', 'attempt.reveal']);

  /**
   * Sends a command that must reach the other side (it stops capture or ends something). If the link or the phone is
   * not there it is queued, and flushed after auth.ok or when the phone returns (QA-03). The queue is bounded.
   */
  private deliver(message: Outbound): void {
    const s = this.s;
    const needsPeer = Machine.TO_PHONE.has(message.type);
    if (linkUp(s) && (!needsPeer || s.peerConnected)) {
      this.send(message);
      return;
    }
    const key = JSON.stringify([message.type, 'ids' in message ? message.ids : null]);
    if (s.pendingOut.some((m) => JSON.stringify([m.type, 'ids' in m ? m.ids : null]) === key)) return;
    if (s.pendingOut.length < 8) s.pendingOut.push(message);
  }

  private flushPending(): void {
    const s = this.s;
    if (!linkUp(s) || s.pendingOut.length === 0) return;
    const keep: Outbound[] = [];
    for (const m of s.pendingOut) {
      if (Machine.TO_PHONE.has(m.type) && !s.peerConnected) keep.push(m);
      else this.send(m);
    }
    s.pendingOut = keep;
  }

  private onPhoneConnected(): void {
    const s = this.s;
    s.lastStateSig = '';
    this.flushPending();
    if (s.stage !== 'pairing' || !s.peerConnected || !s.phonePaired) return;
    if (s.pairOnly || !s.session) {
      s.pairOnly = false;
      this.go('idle', 'ready', { kind: 'info', text: COPY.pairing.paired });
      s.idleScreen = 'home';
      return;
    }
    this.enterPermission();
  }

  private enterPermission(): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    this.go('permission_pending');
    if (!sess.beginSent) {
      sess.beginSent = true;
      this.sendBegin(sess);
    }
    // Practice goes on only when the microphone is open AND the phone acked this session.begin (DEF-003); until then
    // this screen stays and says it is waiting for the phone.
    if (measureReady(s)) this.enterQuiet();
  }

  private sendBegin(sess: Session): void {
    sess.lastBeginAt = this.s.now;
    this.send(
      {
        type: 'session.begin',
        ids: { sessionId: sess.sessionId },
        payload: { family_mode: sess.familyMode, phrase_count: sess.phrases.length, cues_max: 3 },
      },
      'session.begin',
    );
  }

  /**
   * Defence in depth for DEF-003: the phone showed it does not know the current session (a mic.state without it or
   * for another one, or an ack saying unknown_session). Send session.begin again with the same session id and
   * payload, then the current session.state (the next sync sends it). At most once per 2 s.
   */
  private resendBegin(): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || !sess.beginSent || sess.ended !== null || !linkUp(s) || !s.peerConnected) return;
    if (sess.lastBeginAt !== null && s.now - sess.lastBeginAt < BEGIN_RESEND_MIN_MS) return;
    this.bump('begin_resends');
    this.sendBegin(sess);
    s.lastStateSig = '';
  }

  private onAck(m: Msg<'ack'>): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || sess.ended !== null) return;
    if (m.payload.detail === 'unknown_session') {
      this.resendBegin();
      return;
    }
    if (m.payload.outcome === 'applied' && sess.beginMessageIds.includes(m.payload.acked_message_id)) {
      const first = !sess.beginAcked;
      sess.beginAcked = true;
      if (first && s.stage === 'permission_pending' && micOpen(s)) this.enterQuiet();
    }
  }

  private enterQuiet(): void {
    this.go('quiet_check', 'ready');
  }

  /* ---------------------------------------------------------------- wire inbound */

  private onWire(raw: unknown): void {
    const s = this.s;
    const parsed = parseInbound(raw, s.now);
    if (!parsed.ok) {
      this.bump('parse_errors');
      return;
    }
    const m = parsed.message;
    this.bump('received');
    if (this.dedupe.seen(m.message_id)) {
      this.bump('duplicates');
      return;
    }
    if (m.type !== 'room.created' && s.roomId !== null && m.room_id !== null && m.room_id !== s.roomId) {
      this.bump('ignored_stale');
      return;
    }
    switch (m.type) {
      case 'room.created':
        this.onRoomCreated(m);
        break;
      case 'pairing.code':
        s.code = m.payload.pairing_code;
        s.codeExpiresAt = m.payload.code_expires_at;
        s.refreshRequested = false;
        break;
      case 'join.requested':
        this.onJoinRequested(m);
        break;
      case 'join.expired':
        if (s.joinRequest !== null && s.joinRequest.joinId === m.payload.join_id) {
          s.joinRequest = null;
          s.banner = { kind: 'info', text: COPY.join.expired };
        }
        break;
      case 'auth.ok':
        this.onAuthOk(m);
        break;
      case 'peer.state':
        this.onPeerState(m);
        break;
      case 'pong':
        this.bump('pongs');
        break;
      case 'ack':
        this.onAck(m);
        break;
      case 'error':
        this.onRelayError(m);
        break;
      case 'mic.state':
        this.onMicState(m);
        break;
      case 'precheck.result':
        this.onPrecheck(m);
        break;
      case 'level':
        this.onLevel(m);
        break;
      case 'window.result':
        this.onWindowResult(m);
        break;
      case 'listener.response':
        this.onListenerResponse(m);
        break;
      case 'cue':
        this.onCue(m);
        break;
      case 'phrases.update':
        this.onPhrasesUpdate(m);
        break;
    }
  }

  private onRoomCreated(m: Msg<'room.created'>): void {
    const s = this.s;
    s.roomId = m.payload.room_id;
    s.credential = m.payload.tv_credential;
    s.generation = m.payload.generation;
    this.fx.push({ kind: 'bind', roomId: s.roomId, generation: s.generation });
    s.code = m.payload.pairing_code;
    s.codeExpiresAt = m.payload.code_expires_at;
    s.refreshRequested = false;
    s.authed = true;
    s.lastStateSig = '';
  }

  private onJoinRequested(m: Msg<'join.requested'>): void {
    const s = this.s;
    const p = m.payload;
    if (s.stage !== 'pairing' || s.joinRequest !== null || s.joinAccepted) {
      // Not waiting for a phone: refuse rather than leave the phone hanging.
      this.send({ type: 'join.confirm', payload: { join_id: p.join_id, decision: 'reject' } });
      return;
    }
    s.joinRequest = {
      joinId: p.join_id,
      deviceLabel: p.device_label,
      confirmDigits: p.confirm_digits,
      choices: buildChoices(p.confirm_digits, (n) => this.env.randomBytes(n)),
      expiresAt: p.expires_at,
    };
  }

  private onAuthOk(m: Msg<'auth.ok'>): void {
    const s = this.s;
    s.authed = true;
    s.generation = m.payload.generation;
    // A3-07: a resume consumes the credential that was presented; the one to use next comes back here.
    // Memory only: it is never projected, persisted or logged.
    s.credential = m.payload.next_credential;
    this.fx.push({ kind: 'bind', roomId: s.roomId, generation: s.generation });
    s.peerConnected = m.payload.peer_connected;
    s.phonePaired = m.payload.phone_paired;
    s.mic = { state: null, mode: s.mic.mode };
    s.lastStateSig = '';
    this.flushPending(); // commands that could not be sent while the link was down (QA-03)
    if (s.peerConnected) this.onPhoneConnected();
  }

  private onPeerState(m: Msg<'peer.state'>): void {
    const s = this.s;
    if (m.payload.role !== 'phone') return;
    s.peerConnected = m.payload.connected;
    if (!m.payload.connected) {
      s.mic = { state: null, mode: s.mic.mode };
      if (s.win !== null) this.cancelWindow('link_lost');
      return;
    }
    if (s.joinAccepted) {
      s.phonePaired = true;
      s.joinAccepted = false;
    }
    // A3-07: a new phone generation means the phone connection was replaced or re-established. Whatever the
    // old connection was measuring is cancelled and unscored; the phone's microphone state is unknown again.
    const generation = m.payload.generation;
    const reconnected = s.phoneGeneration !== null && generation !== s.phoneGeneration;
    s.phoneGeneration = generation;
    s.mic = { state: null, mode: s.mic.mode };
    if (reconnected && s.win !== null) this.cancelWindow('interrupted', 'phone_reconnected');
    this.onPhoneConnected();
    if (reconnected) s.banner = { kind: 'info', text: COPY.banner.phoneReconnected };
  }

  private onRelayError(m: Msg<'error'>): void {
    const s = this.s;
    const code = m.payload.code;
    this.bump('relay_errors');
    if (['expired', 'revoked', 'unauthorized', 'unauthenticated', 'not_found', 'superseded'].includes(code)) {
      this.pairingLost(code);
      return;
    }
    if (code === 'cue_limit') return;
    s.banner = { kind: 'warning', text: COPY.banner.relayError(code) };
  }

  private onMicState(m: Msg<'mic.state'>): void {
    const s = this.s;
    s.mic = { state: m.payload.state, mode: m.payload.mode };
    const sess = s.session;
    if (sess && sess.beginSent && sess.ended === null && m.session_id !== sess.sessionId) this.resendBegin();
    if (s.stage === 'permission_pending' && measureReady(s)) {
      this.enterQuiet();
      return;
    }
    const open = m.payload.state === 'open_idle' || m.payload.state === 'measuring';
    if (s.win !== null && !open) this.cancelWindow('interrupted', 'mic');
  }

  private matchWin(m: Inbound): Win | null {
    const s = this.s;
    const w = s.win;
    const sess = s.session;
    if (!w || !sess) return null;
    if (m.session_id !== sess.sessionId || m.window_id !== w.windowId || m.attempt_id !== w.attemptId) return null;
    return w;
  }

  private onPrecheck(m: Msg<'precheck.result'>): void {
    const s = this.s;
    const sess = s.session;
    const w = this.matchWin(m);
    if (!w || !sess || w.phase !== 'precheck') {
      this.stale(m);
      return;
    }
    const p: PrecheckResultPayload = m.payload;
    if (p.purpose !== (w.kind === 'quiet_check' ? 'quiet_check' : 'pre_window')) {
      this.stale(m);
      return;
    }
    this.ack(m, 'applied', '');
    if (w.kind === 'quiet_check') {
      const verdict = evaluateQuietCheck(p);
      s.win = null;
      if (verdict.ok) {
        sess.floorDbfs = verdict.floorDbfs;
        sess.quietFailure = null;
        this.go('calibration', 'ready');
      } else {
        sess.quietFailure = verdict.reason;
        this.go('quiet_check', 'failed');
      }
      return;
    }
    const gate = evaluateGate(p, sess.floorDbfs ?? p.floor_dbfs ?? 0, this.bandMargin());
    if (!gate.pass) {
      this.blocked(w, gate.reason);
      return;
    }
    this.startCapture(w);
  }

  /** The gate blocked the window: unscored, never started, paused with retry. */
  private blocked(w: Win, reason: string): void {
    const s = this.s;
    const sess = s.session;
    s.win = null;
    if (!sess) return;
    if (w.kind === 'phrase') {
      const a = sess.attempts.find((x) => x.attemptId === w.attemptId);
      if (a) {
        a.state = 'invalid';
        a.verdict = 'unscored';
        a.reason = reason;
        a.started = false;
      }
      sess.currentAttemptId = w.attemptId;
      this.persistCheckpoint();
      this.pause('phrase', reason);
    } else if (w.kind === 'calibration') {
      this.pause('calibration', reason);
    } else if (w.kind === 'quiet_check') {
      this.pause('quiet_check', reason);
    } else {
      this.pause('vowel', reason);
    }
  }

  private pause(from: PausedFrom, reason: string): void {
    this.go('paused_or_invalid');
    const paused: Paused = { from, reason };
    this.s.paused = paused;
  }

  private onLevel(m: Msg<'level'>): void {
    const s = this.s;
    const sess = s.session;
    const w = this.matchWin(m);
    if (!w || !sess || (w.phase !== 'capture' && w.phase !== 'closing')) {
      this.stale(m);
      return;
    }
    if (m.payload.frame_index <= w.lastFrameIndex) {
      this.bump('duplicates');
      return;
    }
    if (m.payload.t_audio_ms < 50 * m.payload.frame_index - 1) {
      this.bump('integrity_errors'); // PK-02: a frame cannot be timestamped before its own index allows
      return;
    }
    w.lastFrameIndex = m.payload.frame_index;
    // Validated, never rendered for blind windows: nothing is derived from the level.
    if (w.hidden || sess.floorDbfs === null) return;
    const rel = m.payload.dbfs - sess.floorDbfs;
    const prev = s.level !== null ? s.level.relDb : null;
    s.level = {
      relDb: prev === null ? rel : prev + (rel - prev) * LEVEL_SMOOTHING,
      active: m.payload.active,
      at: s.now,
    };
  }

  private onWindowResult(m: Msg<'window.result'>): void {
    const s = this.s;
    const sess = s.session;
    const w = this.matchWin(m);
    if (!w || !sess || (w.phase !== 'capture' && w.phase !== 'closing') || w.kind === 'quiet_check') {
      this.stale(m);
      return;
    }
    const p: WindowResultPayload = m.payload;
    if (p.kind !== w.kind) {
      this.stale(m);
      return;
    }
    this.ack(m, 'applied', '');
    const floor = sess.floorDbfs ?? 0;
    s.win = null;
    s.level = null;
    if (w.kind === 'calibration') {
      const verdict = evaluateCalibration(p, floor);
      if (verdict.accepted) {
        sess.calMarginDb = verdict.marginDb;
        sess.noBand = false;
        sess.lastCalibration = { accepted: true, marginDb: verdict.marginDb, reason: null };
      } else {
        sess.lastCalibration = { accepted: false, marginDb: verdict.marginDb, reason: verdict.reason };
      }
      this.go('calibration', 'result');
      return;
    }
    if (w.kind === 'vowel') {
      const verdict = evaluateWindow('vowel', p, floor, this.bandMargin());
      const rec: VowelRecord =
        verdict.kind === 'invalid'
          ? { windowId: w.windowId, valid: false, reason: verdict.reason, longestActiveMs: null, verdict: null, borderline: false }
          : {
              windowId: w.windowId,
              valid: true,
              reason: null,
              longestActiveMs: p.longest_active_ms,
              verdict: verdict.kind === 'scored' ? (verdict.reached ? 'reached' : 'not_reached') : null,
              borderline: verdict.kind === 'scored' ? verdict.borderline : false,
            };
      sess.vowels.push(rec);
      sess.lastVowel = rec;
      this.go('vowel_result', 'result');
      return;
    }
    this.onPhraseResult(w, p, floor);
  }

  /** The band margin the verdict uses: none in Listener Edition (band verdicts are not shown). */
  private bandMargin(): number | null {
    const sess = this.s.session;
    if (!sess || isListenerEdition(this.s)) return null;
    return sess.calMarginDb;
  }

  private onPhraseResult(w: Win, p: WindowResultPayload, floor: number): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    const a = sess.attempts.find((x) => x.attemptId === w.attemptId);
    if (!a) return;
    const verdict = evaluateWindow('phrase', p, floor, this.bandMargin());
    a.activeMs = p.active_ms;
    a.longestActiveMs = p.longest_active_ms;
    sess.currentAttemptId = a.attemptId;
    if (verdict.kind === 'invalid') {
      a.verdict = 'unscored';
      a.reason = verdict.reason;
      a.borderline = false;
      // A4-01: for a hidden first attempt the reason (too quiet, too loud, ...) is level-derived, so an invalid
      // window waits behind the same neutral prompt as a valid one. An interruption is not level-derived and
      // keeps the immediate path, like the speaker's own Cancel.
      if (a.hidden && verdict.reason !== 'interrupted') {
        this.enterResponse(a);
        return;
      }
      a.state = 'invalid';
      this.persistCheckpoint();
      this.go('reveal');
      return;
    }
    if (verdict.kind === 'no_band') {
      a.verdict = 'unscored';
      a.reason = isListenerEdition(s) ? 'listener_edition' : 'no_band';
      a.borderline = false;
    } else {
      a.verdict = verdict.reached ? 'reached' : 'not_reached';
      a.borderline = verdict.borderline;
    }
    a.state = 'capture_closed';
    if (!a.hidden && !sess.familyMode) {
      this.reveal(a);
      return;
    }
    this.enterResponse(a);
  }

  /**
   * The response phase: hidden first attempts wait for the speaker's rating, family mode waits for the listener.
   * Valid and invalid hidden windows take exactly this path (same prompt, same listener.open).
   */
  private enterResponse(a: AttemptRecord): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    a.state = 'response_pending';
    s.overlay = null; // Settings and Diagnostics are unavailable between capture close and reveal (A4-03)
    if (sess.familyMode) this.openListener(a);
    this.go('response_pending');
  }

  private openListener(a: AttemptRecord): void {
    const sess = this.s.session;
    if (!sess) return;
    sess.listenerOpenSent = true;
    if (!sess.listenerOpenAttempts.includes(a.attemptId)) sess.listenerOpenAttempts.push(a.attemptId);
    sess.listenerDeadline = this.s.now + LISTENER_WAIT_MS;
    sess.listenerOffered = false;
    this.send({
      type: 'listener.open',
      ids: { sessionId: sess.sessionId, windowId: a.windowId, attemptId: a.attemptId },
      payload: { timeout_ms: LISTENER_OPEN_TIMEOUT_MS },
    });
  }

  private rate(rating: 'felt_loud' | 'felt_normal' | 'skipped'): void {
    const a = currentAttempt(this.s.session);
    if (!a || a.state !== 'response_pending' || !a.hidden || a.rating !== null) return;
    a.rating = rating;
    this.checkRevealReady();
  }

  private checkRevealReady(): void {
    const sess = this.s.session;
    const a = currentAttempt(sess);
    if (!sess || !a || a.state !== 'response_pending') return;
    const ratingDone = !a.hidden || a.rating !== null;
    const listenerDone = !sess.familyMode || a.listener !== null;
    if (ratingDone && listenerDone) this.reveal(a);
  }

  /** attempt.reveal locks the phone's listener controls; it is sent once per attempt. */
  private lockListener(a: AttemptRecord): void {
    const sess = this.s.session;
    if (!sess || sess.revealSent.includes(a.attemptId)) return;
    sess.revealSent.push(a.attemptId);
    this.send({
      type: 'attempt.reveal',
      ids: { sessionId: sess.sessionId, windowId: a.windowId, attemptId: a.attemptId },
      payload: {},
    });
  }

  /** Reveal locks the attempt: verdict, rating and on-time listener response are final. */
  private reveal(a: AttemptRecord): void {
    const sess = this.s.session;
    if (!sess) return;
    a.state = 'revealed';
    this.lockListener(a);
    this.go('reveal');
    this.persistCheckpoint();
  }

  private onListenerResponse(m: Msg<'listener.response'>): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || sess.ended !== null || m.session_id !== sess.sessionId || !sess.familyMode) {
      this.stale(m);
      return;
    }
    const a = sess.attempts.find((x) => x.attemptId === m.attempt_id && x.windowId === m.window_id);
    // Unsolicited (the TV never opened the listener for this attempt): the same ack for every case (A4-01).
    if (!a || !sess.listenerOpenAttempts.includes(a.attemptId)) {
      this.stale(m);
      return;
    }
    const response = m.payload.response;
    if (a.state === 'response_pending') {
      if (a.listener !== null && a.listener !== 'missing') {
        this.ack(m, 'rejected', 'already_answered'); // first on-time response wins (A4-05)
        return;
      }
      if (a.listener === 'missing') {
        // The speaker already continued without a listener response: this one is late, never on time.
        if (a.lateListener !== null) {
          this.ack(m, 'rejected', 'already_answered');
          return;
        }
        a.lateListener = response;
        this.ack(m, 'applied', 'late');
        return;
      }
      a.listener = response;
      this.ack(m, 'applied', '');
      this.checkRevealReady();
      return;
    }
    if (a.state === 'revealed') {
      if (a.listener === 'heard' || a.listener === 'not_heard' || a.lateListener !== null) {
        this.ack(m, 'rejected', 'already_answered');
        return;
      }
      // Late: stored and acked applied/late; never in the primary agreement denominator (A4-05).
      a.lateListener = response;
      this.ack(m, 'applied', 'late');
      this.persistCheckpoint();
      return;
    }
    this.stale(m);
  }

  private onCue(m: Msg<'cue'>): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || sess.ended !== null || m.session_id !== sess.sessionId) {
      this.stale(m);
      return;
    }
    if (s.win !== null) {
      this.ack(m, 'rejected', 'window_open');
      return;
    }
    const text = validateCue(m.payload.text);
    if (text === null) {
      this.ack(m, 'rejected', 'invalid_cue');
      return;
    }
    if (sess.cuesUsed >= CUES_MAX) {
      this.ack(m, 'rejected', 'cue_limit');
      return;
    }
    sess.cuesUsed += 1;
    s.cue = { text, expiresAt: s.now + CUE_CHIP_MS };
    // The chip is visual. Its text is queued and spoken once, after the screen's own text: between windows right
    // away, for a hidden attempt waiting for its reveal only after the reveal (A8-01, QA-12).
    s.deferred.texts.push(COPY.cue(text));
    if (s.settings.cueWord !== text) {
      s.settings = { ...s.settings, cueWord: text };
      this.persist({ op: 'settings', settings: s.settings });
    }
    this.ack(m, 'applied', '');
  }

  private onPhrasesUpdate(m: Msg<'phrases.update'>): void {
    const s = this.s;
    if (s.win !== null) {
      this.ack(m, 'rejected', 'window_open');
      return;
    }
    const result = validatePhraseBank(m.payload.phrases);
    if (!result.ok) {
      this.ack(m, 'rejected', result.reason);
      return;
    }
    s.phraseBank = result.phrases;
    this.persist({ op: 'phrases', phrases: result.phrases });
    const sess = s.session;
    if (sess && sess.ended === null && !sess.phraseStarted) {
      sess.phrases = [...result.phrases];
      this.ack(m, 'applied', '');
    } else if (sess && sess.ended === null) {
      s.banner = { kind: 'info', text: COPY.banner.phrasesSaved };
      this.ack(m, 'applied', 'next_session');
    } else {
      this.ack(m, 'applied', '');
    }
  }

  /* ---------------------------------------------------------------- windows */

  private beginWindow(kind: WinKind): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || !measureReady(s) || s.win !== null) return;
    const w: Win = {
      kind,
      phase: 'lead',
      windowId: this.freshWindowId(sess),
      attemptId: this.freshId('a_', (id) => sess.attempts.some((a) => a.attemptId === id)),
      leadUntil: s.now + this.leadMs(),
      leadMs: this.leadMs(),
      precheckAt: null,
      captureAt: null,
      closingAt: null,
      maxMs: 0,
      position: null,
      hidden: false,
      attemptNumber: 1,
      stopSent: false,
      lastFrameIndex: -1,
    };
    switch (kind) {
      case 'quiet_check':
        w.maxMs = QUIET_CHECK_MS;
        this.go('quiet_check', 'running');
        break;
      case 'calibration':
        w.maxMs = CALIBRATION_WINDOW_MS;
        this.go('calibration', 'running');
        break;
      case 'vowel':
        w.maxMs = VOWEL_MAX_MS;
        this.go('vowel_active', 'running');
        break;
      case 'phrase': {
        const position = sess.phraseIdx + 1;
        w.maxMs = PHRASE_WINDOW_MS;
        w.position = position;
        w.attemptNumber = attemptsAt(sess, position).length + 1;
        // Only the first attempt that is actually captured at a hidden position is blind.
        w.hidden = isHiddenPosition(position) && !hasStartedAttempt(sess, position);
        sess.phraseStarted = true;
        this.go('phrase_active', 'running');
        break;
      }
    }
    s.win = w;
    s.level = null;
  }

  private leadMs(): number {
    return quietLeadMs(this.s);
  }

  private tickWindow(): void {
    const s = this.s;
    const w = s.win;
    if (!w) return;
    switch (w.phase) {
      case 'lead':
        if (s.now >= w.leadUntil) this.startPhase(w);
        break;
      case 'precheck': {
        const duration = w.kind === 'quiet_check' ? QUIET_CHECK_MS : PRE_WINDOW_MS;
        if (s.now >= (w.precheckAt ?? s.now) + duration + RESULT_GRACE_MS) this.cancelWindow('timeout');
        break;
      }
      case 'capture':
        if (!w.stopSent && s.now >= (w.captureAt ?? s.now) + w.maxMs + 500) {
          w.stopSent = true;
          w.phase = 'closing';
          w.closingAt = s.now;
          this.send({ type: 'window.stop', ids: this.ids(w), payload: { reason: 'complete' } });
        }
        break;
      case 'closing':
        if (s.now >= (w.closingAt ?? s.now) + RESULT_GRACE_MS) this.cancelWindow('timeout');
        break;
    }
  }

  /** End of the quiet lead: send the first command for this window. */
  private startPhase(w: Win): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    if (w.kind === 'quiet_check') {
      this.sendPrecheck(w, 'quiet_check', QUIET_CHECK_MS);
      return;
    }
    if (w.kind === 'calibration') {
      this.startCapture(w);
      return;
    }
    if (w.kind === 'phrase') {
      // Created when the first command is sent, so a cancelled lead consumes no attempt number.
      const a: AttemptRecord = {
        attemptId: w.attemptId,
        windowId: w.windowId,
        position: w.position ?? sess.phraseIdx + 1,
        attemptNumber: w.attemptNumber,
        hidden: w.hidden,
        state: 'capturing',
        started: false,
        verdict: null,
        reason: null,
        borderline: false,
        activeMs: null,
        longestActiveMs: null,
        rating: null,
        listener: null,
        lateListener: null,
      };
      sess.attempts.push(a);
      sess.currentAttemptId = a.attemptId;
      this.sendPrecheck(w, 'pre_window', PRE_WINDOW_MS);
      return;
    }
    // vowel: gate only when a band exists to compare against
    if (sess.calMarginDb !== null && sess.floorDbfs !== null) this.sendPrecheck(w, 'pre_window', PRE_WINDOW_MS);
    else this.startCapture(w);
    void s;
  }

  private sendPrecheck(w: Win, purpose: 'quiet_check' | 'pre_window', duration: 2000 | 5000): void {
    w.phase = 'precheck';
    w.precheckAt = this.s.now;
    this.send({ type: 'precheck.start', ids: this.ids(w), payload: { purpose, duration_ms: duration } });
  }

  private startCapture(w: Win): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    // window.start.vad_floor_dbfs must lie in -110 .. -30. A floor outside that cannot come from an accepted quiet
    // check; if it ever does, the window is refused with the muted-or-blocked copy instead of sending a bad command.
    const floor = sess.floorDbfs;
    if (floor === null || floor < SILENT_FLOOR_DBFS || floor > QUIET_FLOOR_MAX_DBFS) {
      this.blocked(w, 'silent_input');
      return;
    }
    // A precheck and the capture that follows it are two measurements: the capture gets its own window_id and
    // keeps the attempt_id. The phone treats window ids as single-use, and stale filtering is per window_id.
    if (w.precheckAt !== null) w.windowId = this.freshWindowId(sess, w.windowId);
    w.phase = 'capture';
    w.captureAt = s.now;
    this.send({
      type: 'window.start',
      ids: this.ids(w),
      payload: {
        kind: w.kind === 'quiet_check' ? 'calibration' : w.kind,
        phrase_position: w.kind === 'phrase' ? w.position : null,
        max_duration_ms: w.maxMs,
        vad_floor_dbfs: quantizeDb(floor),
      },
    });
    if (w.kind === 'phrase') {
      const a = sess.attempts.find((x) => x.attemptId === w.attemptId);
      if (a) {
        a.windowId = w.windowId;
        a.started = true;
        a.state = 'capturing';
      }
      this.persistCheckpoint();
    }
  }

  private stopEarly(): void {
    const w = this.s.win;
    if (!w || w.phase !== 'capture') return;
    w.phase = 'closing';
    w.closingAt = this.s.now;
    w.stopSent = true;
    this.send({ type: 'window.stop', ids: this.ids(w), payload: { reason: 'early_stop' } });
  }

  private tickListener(): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || s.stage !== 'response_pending' || !sess.familyMode) return;
    const a = currentAttempt(sess);
    if (!a || a.listener !== null || sess.listenerDeadline === null || sess.listenerOffered) return;
    if (s.now >= sess.listenerDeadline) sess.listenerOffered = true;
  }

  private sendCancel(w: Win, reason: 'user_cancel' | 'interrupted' | 'link_lost' | 'timeout' | 'session_end'): void {
    const s = this.s;
    void s;
    this.deliver({ type: 'window.cancel', ids: this.ids(w), payload: { reason } });
  }

  /**
   * Cancels the open window: unscored, never resumed automatically. User cancel returns to a ready
   * screen (or an unscored reveal for a phrase); every other cause pauses with a fresh-begin retry.
   */
  private cancelWindow(
    reason: 'user_cancel' | 'interrupted' | 'link_lost' | 'timeout' | 'session_end',
    pauseKey?: string,
    navigate = true,
  ): void {
    const s = this.s;
    const w = s.win;
    const sess = s.session;
    if (!w || !sess) return;
    if (w.phase !== 'lead') this.sendCancel(w, reason);
    s.win = null;
    s.level = null;
    if (!navigate) return;
    const user = reason === 'user_cancel';
    const key = pauseKey ?? (reason === 'link_lost' ? 'link_lost' : reason === 'timeout' ? 'timeout' : 'interrupted');
    const cancelled = { kind: 'info' as const, text: COPY.banner.cancelledWindow };
    switch (w.kind) {
      case 'quiet_check':
        if (user) this.go('quiet_check', 'ready', cancelled);
        else this.pause('quiet_check', key);
        break;
      case 'calibration':
        if (user) this.go('calibration', 'ready', cancelled);
        else this.pause('calibration', key);
        break;
      case 'vowel':
        if (w.phase !== 'lead') {
          sess.vowels.push({
            windowId: w.windowId,
            valid: false,
            reason: user ? 'cancelled' : key === 'timeout' ? 'timeout' : 'interrupted',
            longestActiveMs: null,
            verdict: null,
            borderline: false,
          });
        }
        if (user) this.go('vowel_ready', 'ready', cancelled);
        else this.pause('vowel', key);
        break;
      case 'phrase': {
        if (w.phase === 'lead') {
          this.go('phrase_ready', 'ready', cancelled);
          break;
        }
        const a = sess.attempts.find((x) => x.attemptId === w.attemptId);
        if (a) {
          a.state = user ? 'cancelled' : 'invalid';
          a.verdict = 'unscored';
          a.reason = user ? 'cancelled' : key === 'timeout' ? 'timeout' : 'interrupted';
          a.borderline = false;
          sess.currentAttemptId = a.attemptId;
        }
        // A4-01: a hidden capture that closed by timeout waits behind the same neutral prompt as any other close.
        if (a && w.hidden && reason === 'timeout' && (w.phase === 'capture' || w.phase === 'closing')) {
          this.enterResponse(a);
          break;
        }
        this.persistCheckpoint();
        if (user) this.go('reveal');
        else this.pause('phrase', key);
        break;
      }
    }
  }

  private onRetry(): void {
    const s = this.s;
    if (s.stage === 'paused_or_invalid' && s.paused) {
      const from = s.paused.from;
      if (from === 'phrase') {
        if (s.session) s.session.currentAttemptId = null;
        this.go('phrase_ready');
      } else if (from === 'vowel') this.go('vowel_ready');
      else if (from === 'calibration') this.go('calibration', 'ready');
      else this.go('quiet_check', 'ready');
      return;
    }
    if (s.stage === 'quiet_check') this.go('quiet_check', 'ready');
    else if (s.stage === 'calibration') this.go('calibration', 'ready');
  }

  /* ---------------------------------------------------------------- phrases and summary */

  private skipPhrase(): void {
    const sess = this.s.session;
    if (!sess) return;
    const position = sess.phraseIdx + 1;
    if (!sess.skipped.includes(position)) sess.skipped.push(position);
    // The cursor moved, so the bank is fixed for this session: a later phrases.update applies to the next session (QA-04).
    sess.phraseStarted = true;
    this.advance();
  }

  private advance(): void {
    const sess = this.s.session;
    if (!sess) return;
    sess.phraseIdx += 1;
    sess.currentAttemptId = null;
    sess.listenerDeadline = null;
    sess.listenerOffered = false;
    sess.listenerOpenSent = false;
    if (sess.phraseIdx >= sess.phrases.length) {
      this.enterSummary('completed');
      return;
    }
    this.go('phrase_ready');
    this.persistCheckpoint();
  }

  private finalizeInFlight(sess: Session): void {
    for (const a of sess.attempts) {
      if (IN_FLIGHT.includes(a.state)) {
        a.state = 'invalid';
        a.verdict = 'unscored';
        a.reason = 'session_ended';
        a.borderline = false;
      }
    }
  }

  /** The clock's local date, validated; a clock that returns a non-date falls back to the UTC date and is counted. */
  private localDateOf(epochMs: number): string {
    return safeLocalDate(this.env.localDate, epochMs, () => this.bump('clock_date_invalid'));
  }

  private recordOf(sess: Session, endReason: EndReason, forCheckpoint = false): SessionRecord {
    const now = this.s.now;
    const attempts = sess.attempts.map((a): AttemptRecord => {
      const copy = { ...a };
      // A4-02: nothing about an unrevealed attempt is written to storage: no verdict, reason, window numbers,
      // speaker rating or listener answer. On resume it becomes an interrupted, unscored attempt.
      if (forCheckpoint && IN_FLIGHT.includes(copy.state)) {
        copy.verdict = null;
        copy.reason = null;
        copy.borderline = false;
        copy.activeMs = null;
        copy.longestActiveMs = null;
        copy.rating = null;
        copy.listener = null;
        copy.lateListener = null;
      }
      return copy;
    });
    return {
      sessionId: sess.sessionId,
      startedAt: sess.startedAt,
      endedAt: now,
      localDate: this.localDateOf(now),
      complete: endReason === 'completed' && !sess.resumed,
      endReason,
      resumed: sess.resumed,
      familyMode: sess.familyMode,
      phraseCount: sess.phrases.length,
      calMarginDb: sess.calMarginDb,
      cuesUsed: sess.cuesUsed,
      attempts,
      vowels: sess.vowels.map((v) => ({ ...v })),
      skipped: [...sess.skipped],
    };
  }

  private persistCheckpoint(): void {
    const s = this.s;
    const sess = s.session;
    if (!sess || sess.ended !== null) return;
    const cp: Checkpoint = {
      version: 1,
      savedAt: s.now,
      stage: s.stage,
      phraseCount: sess.phrases.length,
      phraseIdx: sess.phraseIdx,
      record: this.recordOf(sess, 'interrupted', true),
    };
    this.persist({ op: 'checkpoint', checkpoint: cp });
  }

  private saveRecord(record: SessionRecord): void {
    const s = this.s;
    s.records = s.records.filter((r) => r.sessionId !== record.sessionId);
    s.records.push(record);
    s.records.sort((a, b) => a.endedAt - b.endedAt);
    // The record is written first and the checkpoint is cleared only after that write succeeded: a crash between the
    // two leaves a checkpoint for a session that already has a saved record (dropped on launch), never the reverse.
    this.persist({ op: 'finalize', record, all: [...s.records] });
  }

  private endWire(sess: Session, reason: 'completed' | 'user_exit' | 'discarded' | 'error'): void {
    if (sess.beginSent && sess.ended === null) {
      this.deliver({ type: 'session.end', ids: { sessionId: sess.sessionId }, payload: { reason } });
    }
  }

  private enterSummary(reason: EndReason): void {
    const s = this.s;
    const sess = s.session;
    if (!sess) return;
    if (s.win !== null) this.cancelWindow('session_end', undefined, false);
    this.finalizeInFlight(sess);
    this.endWire(sess, reason === 'completed' ? 'completed' : 'user_exit');
    sess.ended = reason;
    this.saveRecord(this.recordOf(sess, reason));
    this.go('summary');
  }

  private leaveSession(): void {
    const s = this.s;
    const sess = s.session;
    if (sess) {
      if (s.win !== null) this.cancelWindow('session_end', undefined, false);
      this.finalizeInFlight(sess);
      this.endWire(sess, 'user_exit');
      if (sess.attempts.length > 0 || sess.vowels.length > 0) {
        sess.ended = 'user_exit';
        this.saveRecord(this.recordOf(sess, 'user_exit'));
      } else if (sess.phraseStarted || sess.resumed) {
        this.persist({ op: 'clear_checkpoint' });
      }
      sess.ended = 'user_exit';
    }
    s.session = null;
    this.go('idle');
    s.idleScreen = 'home';
  }

  /* ---------------------------------------------------------------- resume / discard */

  private resumeSession(): void {
    const s = this.s;
    const cp = s.checkpoint;
    if (!cp) return;
    // Phrase text is never in the checkpoint (A5-04): the saved bank is used, so a changed bank can differ.
    const sess = this.newSession([...s.phraseBank], cp.record.familyMode);
    sess.sessionId = cp.record.sessionId;
    sess.startedAt = cp.record.startedAt;
    sess.attempts = cp.record.attempts.map((a) => ({ ...a }));
    sess.vowels = cp.record.vowels.map((v) => ({ ...v }));
    sess.skipped = [...cp.record.skipped];
    sess.cuesUsed = cp.record.cuesUsed;
    sess.phraseIdx = Math.min(cp.phraseIdx, Math.max(0, sess.phrases.length - 1));
    sess.resumed = true;
    sess.phraseStarted = sess.attempts.length > 0;
    const interrupted = sess.attempts.filter((a) => IN_FLIGHT.includes(a.state)).length;
    this.finalizeResumed(sess);
    sess.interruptedNote = interrupted > 0 ? COPY.resume.interruptedNote : null;
    s.session = sess;
    s.checkpoint = null;
    s.lastStateSig = '';
    this.enterPairing(false);
  }

  /** Resume never invents completion: an attempt in flight at the crash becomes interrupted and unscored. */
  private finalizeResumed(sess: Session): void {
    for (const a of sess.attempts) {
      if (IN_FLIGHT.includes(a.state)) {
        a.state = 'invalid';
        a.verdict = 'unscored';
        a.reason = 'interrupted';
        a.borderline = false;
      }
    }
  }

  private discardSession(): void {
    const s = this.s;
    const cp = s.checkpoint;
    if (cp) {
      const record: SessionRecord = {
        ...cp.record,
        attempts: cp.record.attempts.map((a) => ({ ...a })),
        vowels: cp.record.vowels.map((v) => ({ ...v })),
        endedAt: s.now,
        localDate: this.localDateOf(s.now),
        complete: false,
        endReason: 'discarded',
      };
      for (const a of record.attempts) {
        if (IN_FLIGHT.includes(a.state)) {
          a.state = 'invalid';
          a.verdict = 'unscored';
          a.reason = 'interrupted';
          a.borderline = false;
        }
      }
      // A finished record is never overwritten as "discarded" (QA-02).
      const existing = s.records.find((r) => r.sessionId === record.sessionId);
      const finished = existing !== undefined && (existing.complete || existing.endedAt >= cp.savedAt);
      if (!finished && (record.attempts.length > 0 || record.vowels.length > 0)) this.saveRecord(record);
      else this.persist({ op: 'clear_checkpoint' });
    }
    s.checkpoint = null;
    this.go('idle');
    s.idleScreen = s.settings.onboarded ? 'home' : 'onboarding';
  }
}

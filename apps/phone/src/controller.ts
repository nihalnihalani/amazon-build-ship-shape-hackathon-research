/**
 * Phone application controller: pairing, link/reconnect, TV commands, microphone lifecycle,
 * listener controls and phrase/cue editing. DOM-free; the view renders `AppState`.
 * The state machine is documented in apps/phone/STATE_MACHINE.md.
 *
 * Invariants enforced here (each has a test):
 *  - getUserMedia is reachable only from startMic() (a user gesture handler in the view).
 *  - mic state shown/sent is the audio port's OBSERVED state.
 *  - level frames are sent only while the window that the TV started is open and valid.
 *  - session end / unpair / page hidden shut capture down completely.
 *  - no tap after attempt.reveal is sent; credentials live only in this object's memory.
 */

import {
  CODE_LENGTH,
  DEFAULT_CUE_WORD,
  FAILURE_WINDOW_MS,
  LIMITS,
  MIC_IDLE_OFF_MS,
  RECONNECT_BACKOFF_MS,
  RESUME_REFUSAL_WINDOW_MS,
  SESSION_CAPTURE_BUDGET_MS,
  WINDOW_COOLDOWN_MS,
} from './config.js';
import { joinErrorText, joinRejectedText } from './labels.js';
import { checkCode, normalizeCodeInput } from './pairing.js';
import { type PhraseValidation, validateCue, validateDeviceLabel, validatePhrases } from './phrases.js';
import type { AbortReason, AudioPort, AudioSnapshot, PrecheckRun, WindowRun } from './ports/audio.js';
import {
  type AckOutcome,
  type ErrorCode,
  type Ids,
  type InboundMessage,
  type InboundType,
  type OutboundPayloads,
  type OutboundType,
  parseIncoming,
  PhoneMessageFactory,
  type PrecheckResultPayload,
  type TvStage,
  type Visibility,
  type WakeLockState,
  type WireMessage,
} from './ports/wire.js';
import { backoffDelay, type SocketFactory, Transport } from './transport.js';
import type { WakeLockController } from './wake-lock.js';

/** There is no separate "unpaired" screen: a lost pairing returns to Join with an explanation. */
export type Screen = 'join' | 'setup';
/**
 * idle -> connecting -> pending ("On your TV, pick NN") -> confirming ("Did you just pick NN on
 * your TV?") -> (Yes) setup. Until the user answers Yes the phone sends nothing but the join
 * protocol and ping (A3-01).
 */
export type JoinPhase = 'idle' | 'connecting' | 'pending' | 'confirming';
/** Transport state names from PROTOCOL.md section 6. */
export type LinkState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'failed';
export type UnpairedReason =
  | 'tv_unpaired'
  | 'room_closed'
  | 'expired'
  | 'revoked'
  | 'superseded'
  /** The relay kept refusing auth.resume for 30 s (N-01); it does not say why, so neither do we. */
  | 'resume_refused';

export interface SessionInfo {
  sessionId: string;
  familyMode: boolean;
  phraseCount: number;
  stage: TvStage | null;
  phrasePosition: number;
}

export interface ListenerBinding {
  open: boolean;
  sessionId: string | null;
  windowId: string | null;
  attemptId: string | null;
  answered: 'heard' | 'not_heard' | null;
  /** Plain-language note when the TV could not take the last answer. */
  feedback: string | null;
}

export interface AppState {
  screen: Screen;
  secureContext: boolean;
  /** Persistent test-build banner text, or null (always null in production). */
  banner: string | null;
  join: {
    phase: JoinPhase;
    code: string;
    codeMessage: string | null;
    deviceLabel: string;
    deviceLabelMessage: string | null;
    confirmDigits: string | null;
    message: string | null;
  };
  unpairedReason: UnpairedReason | null;
  /** True once the user tapped "Yes, that was me" for the current pairing. */
  pairingConfirmed: boolean;
  link: LinkState;
  reconnectAttempt: number;
  tvConnected: boolean | null;
  mic: AudioSnapshot;
  wakeLock: WakeLockState;
  visibility: Visibility;
  session: SessionInfo | null;
  run: { kind: 'precheck' | 'window'; windowId: string } | null;
  listener: ListenerBinding;
  cue: { word: string; message: string | null; used: number; max: number; feedback: string | null };
  /**
   * sending: transmitted, waiting for the TV's ack; saved: the TV acked applied; rejected: the TV
   * refused it (for example a phrase window is open): the user presses Save again, nothing is
   * resent automatically; not_sent: the link was down; locked: editing paused while measuring.
   */
  phrases: { status: 'none' | 'sending' | 'saved' | 'rejected' | 'not_sent' | 'locked'; count: number; saved: string[] };
  notice: string | null;
  /**
   * silent_input: a precheck found no signal at all (the microphone looks muted or blocked).
   * idle_off: the phone turned the microphone off after 10 minutes without any TV command (N-12).
   */
  micNotice: 'silent_input' | 'idle_off' | null;
  /** Bumps whenever phrase state is cleared, so the view empties its editor too (N-07). */
  phrasesResetToken: number;
  /** Derived controls. */
  canStartMic: boolean;
  canStopMic: boolean;
  canAnswer: boolean;
  canCue: boolean;
  phrasesLocked: boolean;
}

export interface VisibilitySource {
  get(): Visibility;
  subscribe(listener: () => void): () => void;
}

export interface ControllerDeps {
  audio: AudioPort;
  wakeLock: WakeLockController;
  createSocket: SocketFactory;
  relayUrl: string;
  secureContext: boolean;
  visibility: VisibilitySource;
  factory?: PhoneMessageFactory;
  defaultDeviceLabel: string;
  /** Test builds only. */
  banner?: string | null;
  now?: () => number;
  /** Source of randomness for reconnect jitter, in [0, 1). Default Math.random. */
  random?: () => number;
}

interface Credential {
  roomId: string;
  credential: string;
  expiresAt: number;
}

interface RunContext {
  kind: 'precheck' | 'window';
  ids: { session_id: string; window_id: string; attempt_id: string };
  handle: PrecheckRun | WindowRun;
  framesSent: number;
  /** Capture time reserved from the session budget when the run was accepted. */
  commandedMs: number;
  startedAt: number;
}

type Command = Extract<
  InboundMessage,
  {
    type:
      | 'session.begin'
      | 'session.state'
      | 'precheck.start'
      | 'window.start'
      | 'window.stop'
      | 'window.cancel'
      | 'listener.open'
      | 'attempt.reveal'
      | 'session.end';
  }
>;

const COMMAND_TYPES: ReadonlySet<InboundType> = new Set<InboundType>([
  'session.begin',
  'session.state',
  'precheck.start',
  'window.start',
  'window.stop',
  'window.cancel',
  'listener.open',
  'attempt.reveal',
  'session.end',
]);

/** Outbound types allowed before the user answers "Did you just pick NN on your TV?". */
const PRE_CONFIRM_TYPES: ReadonlySet<OutboundType> = new Set<OutboundType>(['ping']);

/** DEF-004: a TV that (re)connects is told the mic state at most once per second. */
const TV_REPORT_MIN_INTERVAL_MS = 1000;

/**
 * N-01: refusals of auth.resume that may just mean "the old connection still looks alive" (the
 * relay's generic answer is `unauthorized`). They are retried for 30 s before the pairing is
 * considered lost. `revoked` and `expired` are definitive and end the pairing at once.
 */
const RESUME_REFUSED_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['unauthorized', 'not_found', 'unauthenticated']);

const BUDGET_NOTICE =
  'This session has used its 5 minutes of listening on this phone. End the session on the TV and start a new one to measure again.';

const FATAL_RESUME_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'revoked',
  'expired',
  'unauthorized',
  'not_found',
  'unauthenticated',
]);

type Listener = (state: AppState) => void;

export class PhoneController {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private readonly factory: PhoneMessageFactory;
  private readonly transport: Transport;
  private readonly unsubs: Array<() => void> = [];

  private credential: Credential | null = null;
  private purpose: 'join' | 'resume' = 'join';
  private activeRun: RunContext | null = null;
  private readonly closedWindows: string[] = [];
  private readonly pendingResults: Array<{ type: 'precheck.result' | 'window.result'; payload: unknown; ids: Ids }> = [];
  private lastMicKey: string | null = null;
  /**
   * Cue accounting. `tvCues` is the TV's last reported count (authoritative). `cueBase` is the
   * TV count when this page last had no unconfirmed cues; `cueNet` counts cues this page sent
   * minus those the TV/relay rejected. Shown count = max(tvCues, cueBase + cueNet), so it never
   * goes backwards when a TV state message lags behind a cue just sent, and it starts from the
   * TV's count after a mid-session re-pair.
   */
  private tvCues = 0;
  private cueBase = 0;
  private cueNet = 0;
  private readonly pendingCues = new Set<string>();
  /** Credential is held but the user has not yet said "Yes, that was me". */
  private userConfirmed = false;
  /**
   * DEF-003: the TV announces its session right after it accepts the join, i.e. before the person
   * taps Yes. The latest `session.begin` and `session.state` are kept (not acted on, nothing sent)
   * and applied right after Yes. Everything else that arrives before Yes is dropped.
   */
  private heldSessionBegin: Extract<Command, { type: 'session.begin' }> | null = null;
  private heldSessionState: Extract<Command, { type: 'session.state' }> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerTimer: ReturnType<typeof setTimeout> | null = null;
  /** DEF-004: when the last peer.state-triggered mic.state went out, and a pending trailing one. */
  private lastTvReportAt = Number.NEGATIVE_INFINITY;
  private tvReportTimer: ReturnType<typeof setTimeout> | null = null;
  /** N-01: when the first refusal of the current reconnect cycle arrived (null: none yet). */
  private refusedSince: number | null = null;
  /** N-12: capture budget and cooldown for the running session. */
  private budgetUsedMs = 0;
  private lastWindowEndedAt = Number.NEGATIVE_INFINITY;
  private budgetNoticeShown = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResponse: string | null = null;
  private pendingPhrases: { id: string; phrases: string[] } | null = null;
  /** Phrases the TV has acknowledged as saved. */
  private confirmedPhrases: string[] = [];
  private pairedOnce = false;

  constructor(private readonly deps: ControllerDeps) {
    this.factory = deps.factory ?? new PhoneMessageFactory();
    this.transport = new Transport(
      deps.createSocket,
      {
        onOpen: () => this.onSocketOpen(),
        onText: (text) => this.onText(text),
        onClose: (info) => this.onSocketClose(info),
      },
      deps.now,
    );
    this.state = {
      screen: 'join',
      secureContext: deps.secureContext,
      banner: deps.banner ?? null,
      join: {
        phase: 'idle',
        code: '',
        codeMessage: null,
        deviceLabel: deps.defaultDeviceLabel,
        deviceLabelMessage: null,
        confirmDigits: null,
        message: null,
      },
      unpairedReason: null,
      pairingConfirmed: false,
      link: 'disconnected',
      reconnectAttempt: 0,
      tvConnected: null,
      mic: deps.audio.getSnapshot(),
      wakeLock: deps.wakeLock.state,
      visibility: deps.visibility.get(),
      session: null,
      run: null,
      listener: { open: false, sessionId: null, windowId: null, attemptId: null, answered: null, feedback: null },
      cue: { word: DEFAULT_CUE_WORD, message: null, used: 0, max: LIMITS.cuesPerSession, feedback: null },
      phrases: { status: 'none', count: 0, saved: [] },
      notice: null,
      micNotice: null,
      phrasesResetToken: 0,
      canStartMic: false,
      canStopMic: false,
      canAnswer: false,
      canCue: false,
      phrasesLocked: false,
    };
    this.state = this.derive(this.state);
    this.unsubs.push(deps.audio.subscribe((s) => this.onAudio(s)));
    this.unsubs.push(deps.wakeLock.subscribe((s) => this.onWakeLock(s)));
    this.unsubs.push(deps.visibility.subscribe(() => this.onVisibility()));
  }

  // ---- state plumbing ----------------------------------------------------

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private patch(partial: Partial<AppState>): void {
    this.state = this.derive({ ...this.state, ...partial });
    for (const l of [...this.listeners]) l(this.state);
  }

  private derive(s: AppState): AppState {
    const micOpen = s.mic.state === 'open_idle' || s.mic.state === 'measuring';
    const synthetic = s.mic.mode === 'fixture_replay';
    const connected = s.link === 'connected';
    const listenerLive = s.listener.open && connected && s.run === null;
    return {
      ...s,
      canStartMic:
        (s.secureContext || synthetic) &&
        s.screen === 'setup' &&
        s.pairingConfirmed &&
        s.visibility === 'visible' &&
        s.mic.state !== 'permission_pending' &&
        !micOpen,
      canStopMic: micOpen,
      canAnswer: listenerLive && s.listener.answered === null,
      canCue: listenerLive && s.cue.used < s.cue.max,
      phrasesLocked: s.mic.state === 'measuring' || s.run !== null,
    };
  }

  // ---- join / pairing ----------------------------------------------------

  setCode(raw: string): void {
    const code = normalizeCodeInput(raw);
    const check = checkCode(code);
    this.patch({ join: { ...this.state.join, code, codeMessage: check.message } });
  }

  setDeviceLabel(raw: string): void {
    const check = validateDeviceLabel(raw);
    this.patch({
      join: { ...this.state.join, deviceLabel: raw, deviceLabelMessage: check.ok || raw === '' ? null : check.message },
    });
  }

  /** User pressed Join. */
  join(): void {
    const { join } = this.state;
    if (join.phase !== 'idle' || this.state.screen !== 'join') return;
    const code = checkCode(join.code);
    const label = validateDeviceLabel(join.deviceLabel);
    if (!code.ok || !label.ok) {
      this.patch({
        join: {
          ...join,
          codeMessage: code.ok ? null : (code.message ?? `Enter the ${CODE_LENGTH}-character code shown on the TV.`),
          deviceLabelMessage: label.ok ? null : label.message,
          message: null,
        },
      });
      return;
    }
    this.purpose = 'join';
    this.dropHeld();
    this.patch({
      join: { ...join, phase: 'connecting', message: null, codeMessage: null, deviceLabelMessage: null },
      unpairedReason: null,
      link: 'connecting',
      notice: null,
    });
    this.transport.open(this.deps.relayUrl);
  }

  /** User cancelled the join (before the TV confirmed). */
  cancelJoin(): void {
    if (this.state.join.phase === 'idle' || this.state.join.phase === 'confirming') return;
    this.transport.close();
    this.factory.clearAuth();
    this.patch({
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: 'Join cancelled.' },
      link: 'disconnected',
    });
  }

  /**
   * "Yes, that was me": the user says they just picked this number on their own TV. Only now does
   * the phone start talking: the first thing sent is `mic.state`, and microphone start is enabled.
   */
  confirmPairing(): void {
    if (this.state.join.phase !== 'confirming' || this.credential === null || this.userConfirmed) return;
    this.userConfirmed = true;
    this.pairedOnce = true;
    this.patch({
      screen: 'setup',
      pairingConfirmed: true,
      unpairedReason: null,
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: null, code: '' },
    });
    this.lastMicKey = null;
    this.publishMic(); // mic.state first
    // Then the session the TV announced while the question was on screen (DEF-003), in order.
    const begin = this.heldSessionBegin;
    const state = this.heldSessionState;
    this.dropHeld();
    if (begin !== null) this.onSessionBegin(begin);
    if (state !== null) this.onSessionState(state);
    this.flushPending();
    this.syncWakeLock();
  }

  /**
   * "No, cancel": the user did not pick that number, so this may be somebody else's room. The
   * credential is discarded, nothing further is sent, and the connection is closed.
   */
  rejectPairing(): void {
    if (this.state.join.phase !== 'confirming') return;
    this.discardUnconfirmed('Cancelled. Nothing was shared with that TV.');
  }

  private discardUnconfirmed(message: string): void {
    this.transport.close();
    this.factory.clearAuth();
    this.credential = null;
    this.userConfirmed = false;
    this.refusedSince = null;
    this.dropHeld();
    this.clearTvReportTimer();
    this.clearFailureWindow();
    this.clearPhraseState(); // N-07: household text goes with the credential
    this.resetBudget();
    this.patch({
      screen: 'join',
      pairingConfirmed: false,
      link: 'disconnected',
      tvConnected: null,
      reconnectAttempt: 0,
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message, code: '' },
    });
  }

  private onSocketOpen(): void {
    this.patch({ link: 'authenticating' });
    this.factory.beginConnection(); // pre-auth phase: room null, generation 0, sequence 0
    if (this.purpose === 'join') {
      const { code, deviceLabel } = this.state.join;
      const label = validateDeviceLabel(deviceLabel).text;
      this.sendRaw(this.factory.build('join.request', { pairing_code: code, device_label: label }));
    } else if (this.credential) {
      this.sendRaw(
        this.factory.build('auth.resume', {
          room_id: this.credential.roomId,
          role: 'phone',
          credential: this.credential.credential,
        }),
      );
    }
  }

  private onSocketClose(info: { code: number | null; wasOpen: boolean; reason: string }): void {
    if (this.credential === null) {
      // Not paired: this was the join attempt.
      if (this.state.join.phase !== 'idle') {
        const message = info.wasOpen
          ? 'The connection closed before the TV confirmed. Ask the TV for a new code and try again.'
          : 'Could not reach the relay. Check your connection and try again.';
        this.patch({
          join: { ...this.state.join, phase: 'idle', confirmDigits: null, message },
          link: 'disconnected',
        });
      }
      return;
    }
    if (!this.userConfirmed) {
      // Never resume a pairing the user has not confirmed.
      this.discardUnconfirmed('The connection closed before you confirmed. Nothing was shared. Pair again from the TV.');
      return;
    }
    this.onLinkLost();
  }

  /** Paired but the socket is gone: cancel measurement, then retry with backoff and jitter. */
  private onLinkLost(): void {
    this.clearTvReportTimer();
    this.factory.clearAuth();
    this.lastMicKey = null;
    this.abortRun('interrupted');
    if (this.pendingPhrases !== null) {
      // No ack can arrive on the dead connection: say so instead of showing "sending" forever.
      const count = this.pendingPhrases.phrases.length;
      this.pendingPhrases = null;
      this.patch({ phrases: { status: 'not_sent', count, saved: this.confirmedPhrases } });
    }
    this.pendingResponse = null;
    const attempt = this.state.reconnectAttempt;
    const delay = backoffDelay(attempt, RECONNECT_BACKOFF_MS, this.deps.random);
    this.purpose = 'resume';
    this.patch({ link: 'reconnecting', reconnectAttempt: attempt + 1, tvConnected: null });
    if (this.failTimer === null) this.startFailureWindow();
    this.transport.scheduleRetry(delay, this.deps.relayUrl);
  }

  /** A6-02: after 2 minutes of continuous failure stop retrying by itself and say so. */
  private startFailureWindow(): void {
    this.clearFailureWindow();
    this.failTimer = setTimeout(() => {
      this.failTimer = null;
      if (this.state.link === 'connected' || this.credential === null || !this.userConfirmed) return;
      this.transport.close(); // cancels the retry timer and any half-open socket
      this.factory.clearAuth();
      this.patch({ link: 'failed', tvConnected: null });
    }, FAILURE_WINDOW_MS);
  }

  private clearFailureWindow(): void {
    if (this.failTimer !== null) clearTimeout(this.failTimer);
    this.failTimer = null;
  }

  /** User pressed Retry (while reconnecting, or after automatic retries stopped). */
  retryNow(): void {
    const link = this.state.link;
    if ((link !== 'reconnecting' && link !== 'failed') || this.credential === null || !this.userConfirmed) return;
    this.purpose = 'resume';
    this.startFailureWindow(); // a deliberate retry gets a fresh 2-minute window
    this.patch({ link: 'reconnecting', ...(link === 'failed' ? { reconnectAttempt: 0 } : {}) });
    this.transport.open(this.deps.relayUrl);
  }

  // ---- inbound messages --------------------------------------------------

  private onText(text: string): void {
    const parsed = parseIncoming(text);
    if (!parsed.ok) return;
    const msg = parsed.message;
    // Once paired, a message that names another room is not for this phone.
    if (this.credential !== null && msg.room_id !== null && msg.room_id !== this.credential.roomId) return;
    switch (msg.type) {
      case 'join.pending':
        if (this.credential === null && this.state.join.phase !== 'idle') {
          this.patch({
            join: { ...this.state.join, phase: 'pending', confirmDigits: msg.payload.confirm_digits },
            link: 'authenticating',
          });
        }
        return;
      case 'join.accepted':
        this.onJoinAccepted(msg.payload.room_id, msg.payload.phone_credential, msg.payload.credential_expires_at, msg.payload.generation);
        return;
      case 'join.rejected':
        if (this.credential === null) {
          this.transport.close();
          this.patch({
            join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: joinRejectedText(msg.payload.reason) },
            link: 'disconnected',
          });
        }
        return;
      case 'auth.ok':
        this.onAuthOk(msg.payload);
        return;
      case 'peer.state':
        if (this.userConfirmed && msg.payload.role === 'tv') {
          this.patch({ tvConnected: msg.payload.connected });
          if (!msg.payload.connected) {
            this.abortRun('interrupted');
          } else {
            // DEF-004: a TV (re)connecting knows nothing about this phone. Tell it the current mic
            // state first, then deliver anything held for it. A generation change with no
            // "disconnected" in between is also a reconnect, so every `connected: true` counts.
            this.reportMicToTv();
            this.flushPending();
          }
        }
        return;
      case 'unpaired':
        this.unpair(msg.payload.reason);
        return;
      case 'pong':
        return;
      case 'error':
        this.onRelayError(msg.payload.code, msg.payload.ref_message_id);
        return;
      case 'ack':
        if (this.userConfirmed) this.onAck(msg.payload.acked_message_id, msg.payload.outcome, msg.payload.detail);
        return;
      default:
        if (!COMMAND_TYPES.has(msg.type)) return;
        // TV commands are acted on (and acknowledged) only once the user confirmed the pairing.
        if (this.userConfirmed && this.state.screen === 'setup') this.onCommand(msg as Command);
        else if (this.credential !== null && this.state.join.phase === 'confirming') this.holdUntilConfirmed(msg as Command);
    }
  }

  private onJoinAccepted(roomId: string, credential: string, expiresAt: number, generation: number): void {
    if (this.credential !== null || this.state.join.phase === 'idle') return;
    this.credential = { roomId, credential, expiresAt };
    this.factory.setAuth(roomId, generation);
    this.userConfirmed = false;
    // A3-01: the relay says "accepted", but the phone cannot tell whose room this is. Ask the user
    // whether they just picked this number on their own TV; send nothing but ping until they say Yes.
    this.patch({
      pairingConfirmed: false,
      join: { ...this.state.join, phase: 'confirming', message: null },
    });
    this.enterConnected(null);
  }

  private onAuthOk(payload: { role: string; generation: number; peer_connected: boolean; phone_paired: boolean; next_credential: string }): void {
    if (payload.role !== 'phone' || this.credential === null || this.purpose !== 'resume') return;
    if (!payload.phone_paired) {
      this.unpair('revoked');
      return;
    }
    this.factory.setAuth(this.credential.roomId, payload.generation);
    // A3-07: the credential just presented is consumed; the next resume must use the rotated one.
    // Memory only, like the credential from join.accepted.
    this.credential = { ...this.credential, credential: payload.next_credential };
    this.enterConnected(payload.peer_connected);
  }

  /** Authenticated (join.accepted or auth.ok): start heartbeat, publish state, flush queued results. */
  private enterConnected(tvConnected: boolean | null): void {
    this.patch({ link: 'connected', reconnectAttempt: 0, tvConnected, notice: null });
    this.transport.startHeartbeat(() => {
      if (!this.factory.authenticated) return null;
      try {
        return this.factory.serialize(this.factory.build('ping', {}));
      } catch {
        return null;
      }
    });
    this.clearFailureWindow();
    this.refusedSince = null; // authenticated: the refusal cycle (if any) is over
    this.lastMicKey = null;
    if (this.userConfirmed) {
      this.publishMic();
      this.flushPending();
      this.syncWakeLock();
    }
  }

  /**
   * N-01: after the phone's network dies without a TCP close, the relay still holds the old socket
   * for up to 25 s and refuses a second connection for the same phone with a generic `unauthorized`.
   * That refusal means "not yet", not "never": keep retrying (normal backoff) for 30 s from the
   * first refusal. A refused resume does not consume the credential, so each retry presents the same
   * one. If the refusals continue past 30 s the pairing is treated as lost, with an honest message
   * ("Could not reconnect": the relay's answer does not say whether it expired or was removed).
   */
  private onResumeRefused(): void {
    const now = this.clock();
    if (this.refusedSince === null) this.refusedSince = now;
    if (now - this.refusedSince >= RESUME_REFUSAL_WINDOW_MS) {
      this.unpair('resume_refused');
      return;
    }
    this.transport.close(); // the refused socket is useless; drop it
    this.onLinkLost(); // and let the normal backoff (with jitter) schedule the next attempt
  }

  private onRelayError(code: ErrorCode, ref: string | null): void {
    if (this.credential !== null && !this.userConfirmed) {
      // Waiting for "Yes": any end-of-pairing signal discards the pairing; anything else is ignored.
      if (FATAL_RESUME_CODES.has(code) || code === 'superseded') {
        this.discardUnconfirmed('The relay ended this pairing before you confirmed. Nothing was shared.');
      }
      return;
    }
    if (this.credential === null) {
      if (this.state.join.phase !== 'idle') {
        this.transport.close();
        this.patch({
          join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: joinErrorText(code) },
          link: 'disconnected',
        });
      }
      return;
    }
    if (this.state.link === 'authenticating') {
      // The resume attempt itself was refused.
      if (RESUME_REFUSED_CODES.has(code)) {
        this.onResumeRefused();
        return;
      }
      if (FATAL_RESUME_CODES.has(code)) {
        this.unpair(code === 'revoked' ? 'revoked' : 'expired');
        return;
      }
      if (code === 'superseded') {
        this.unpair('superseded');
        return;
      }
      if (code === 'origin_rejected') {
        this.transport.close();
        this.patch({ link: 'failed', notice: 'This page is not allowed to connect to the relay.' });
        return;
      }
      return; // transient (e.g. rate_limited): the socket will close and backoff continues
    }
    if (code === 'superseded') {
      this.unpair('superseded');
      return;
    }
    if (code === 'cue_limit') {
      this.markCueLimit();
      if (ref) this.pendingCues.delete(ref);
      this.syncCues();
      return;
    }
    if (code === 'revoked' || code === 'expired') {
      this.unpair(code === 'revoked' ? 'revoked' : 'expired');
      return;
    }
    this.patch({ notice: `The relay refused a message (${code}).` });
  }

  /**
   * While waiting for "Yes, that was me": remember only the latest session.begin and the latest
   * session.state (no ack, no state change, nothing sent). Measurement commands and anything else
   * are dropped.
   */
  private holdUntilConfirmed(msg: Command): void {
    if (msg.type === 'session.begin') {
      this.heldSessionBegin = msg;
      // A newer session makes a held state of another session obsolete.
      if (this.heldSessionState !== null && this.heldSessionState.session_id !== msg.session_id) this.heldSessionState = null;
    } else if (msg.type === 'session.state') {
      this.heldSessionState = msg;
    }
  }

  private dropHeld(): void {
    this.heldSessionBegin = null;
    this.heldSessionState = null;
  }

  /** TV acknowledgements of phone messages: phrases.update, cue and listener.response. */
  private onAck(ackedId: string, outcome: AckOutcome, detail: string): void {
    if (this.pendingPhrases !== null && this.pendingPhrases.id === ackedId) {
      const pending = this.pendingPhrases;
      this.pendingPhrases = null;
      if (outcome === 'applied') {
        this.confirmedPhrases = pending.phrases;
        this.patch({ phrases: { status: 'saved', count: pending.phrases.length, saved: pending.phrases }, notice: null });
      } else {
        // Typically a phrase window is open on the TV. Show it and let the user retry; no resend loop.
        this.patch({
          phrases: { status: 'rejected', count: pending.phrases.length, saved: this.confirmedPhrases },
          notice: 'The TV could not save the phrases right now. Press Save again after the current phrase window.',
        });
      }
      return;
    }
    if (this.pendingResponse === ackedId) {
      this.pendingResponse = null;
      if (outcome === 'applied') return;
      const l = this.state.listener;
      if (outcome === 'rejected') {
        // The TV could not take it right now: allow one more deliberate tap while the controls are open.
        const feedback = 'The TV could not take that answer. Tap Heard or Not heard again.';
        this.patch({ listener: { ...l, answered: null, feedback }, notice: feedback });
      } else {
        const feedback = 'Too late: the TV had already moved on, so that answer was not counted.';
        this.patch({ listener: { ...l, feedback }, notice: feedback });
      }
      return;
    }
    if (!this.pendingCues.has(ackedId)) return;
    this.pendingCues.delete(ackedId);
    if (outcome === 'applied') {
      if (this.state.cue.feedback !== null) this.patch({ cue: { ...this.state.cue, feedback: null } });
      return;
    }
    if (detail === 'cue_limit') this.markCueLimit();
    else this.cueNet = Math.max(0, this.cueNet - 1);
    const feedback =
      detail === 'cue_limit'
        ? 'No cues are left for this session.'
        : 'The TV could not take the cue right now (a phrase window may be open). Tap Cue to try again.';
    this.patch({ cue: { ...this.state.cue, feedback }, notice: feedback });
    this.syncCues();
  }

  // ---- TV commands -------------------------------------------------------

  private ackFor(msg: Command, outcome: AckOutcome, detail = ''): void {
    this.sendAuthed(
      'ack',
      { acked_message_id: msg.message_id, outcome, detail: detail.slice(0, 64) },
      { session_id: msg.session_id, window_id: msg.window_id, attempt_id: msg.attempt_id },
    );
  }

  private matchesSession(msg: Command): boolean {
    return this.state.session !== null && this.state.session.sessionId === msg.session_id;
  }

  private rememberClosed(windowId: string): void {
    this.closedWindows.push(windowId);
    if (this.closedWindows.length > 64) this.closedWindows.shift();
  }

  private onCommand(msg: Command): void {
    this.touchTvActivity(); // N-12: any TV command keeps the idle clock from running out
    switch (msg.type) {
      case 'session.begin':
        return this.onSessionBegin(msg);
      case 'session.state':
        return this.onSessionState(msg);
      case 'precheck.start':
        return this.onPrecheckStart(msg);
      case 'window.start':
        return this.onWindowStart(msg);
      case 'window.stop':
        return this.onWindowStop(msg);
      case 'window.cancel':
        return this.onWindowCancel(msg);
      case 'listener.open':
        return this.onListenerOpen(msg);
      case 'attempt.reveal':
        return this.onReveal(msg);
      case 'session.end':
        void this.onSessionEnd(msg);
        return;
    }
  }

  private onSessionBegin(msg: Extract<Command, { type: 'session.begin' }>): void {
    const current = this.state.session;
    if (current !== null && current.sessionId === msg.session_id) {
      // A repeat for the session already running (the TV resends it defensively): acknowledge it
      // and change nothing about progress. Stage, position, cue count and any open window stay as
      // they are; only the announced configuration is refreshed if it differs.
      if (current.familyMode !== msg.payload.family_mode || current.phraseCount !== msg.payload.phrase_count) {
        this.patch({ session: { ...current, familyMode: msg.payload.family_mode, phraseCount: msg.payload.phrase_count } });
      }
      this.ackFor(msg, 'applied');
      return;
    }
    if (current !== null && current.sessionId !== msg.session_id) {
      this.abortRun('discard');
      this.lockListener();
    }
    if (this.state.session?.sessionId !== msg.session_id) {
      this.tvCues = 0;
      this.cueBase = 0;
      this.cueNet = 0;
      this.pendingCues.clear();
      this.resetBudget(); // N-12: the budget belongs to one session
    }
    this.patch({
      session: {
        sessionId: msg.session_id as string,
        familyMode: msg.payload.family_mode,
        phraseCount: msg.payload.phrase_count,
        stage: null,
        phrasePosition: 0,
      },
      cue: { ...this.state.cue, used: this.cueCount(msg.payload.cues_max), max: msg.payload.cues_max },
    });
    this.ackFor(msg, 'applied');
    this.syncWakeLock();
    this.publishMic();
  }

  private onSessionState(msg: Extract<Command, { type: 'session.state' }>): void {
    if (!this.matchesSession(msg) || this.state.session === null) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const p = msg.payload;
    this.tvCues = p.cues_used;
    if (this.cueNet === 0) this.cueBase = p.cues_used;
    this.patch({ session: { ...this.state.session, stage: p.stage, phrasePosition: p.phrase_position } });
    this.syncCues();
    // Defence in depth: the TV says no attempt is open for listening (or a different one).
    const l = this.state.listener;
    if (l.open) {
      const mismatch = p.listener_open_attempt !== null ? p.listener_open_attempt !== l.attemptId : p.stage !== 'response_pending';
      if (mismatch) this.lockListener();
    }
    this.ackFor(msg, 'applied');
  }

  private onPrecheckStart(msg: Extract<Command, { type: 'precheck.start' }>): void {
    const ids = this.idsOf(msg);
    if (!ids) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const gate = this.runGate(msg, ids.window_id, 'precheck', msg.payload.duration_ms);
    if (gate) return this.ackFor(msg, gate.outcome, gate.detail);
    this.lockListener();
    let handle: PrecheckRun;
    try {
      handle = this.deps.audio.precheck({ purpose: msg.payload.purpose, durationMs: msg.payload.duration_ms });
    } catch {
      return this.ackFor(msg, 'rejected', 'mic_not_open');
    }
    const ctx: RunContext = { kind: 'precheck', ids, handle, framesSent: 0, commandedMs: msg.payload.duration_ms, startedAt: this.clock() };
    this.budgetUsedMs += ctx.commandedMs;
    this.activeRun = ctx;
    this.patch({ run: { kind: 'precheck', windowId: ids.window_id } });
    this.ackFor(msg, 'applied');
    void handle.result.then((payload) => this.onRunResult(ctx, payload));
  }

  private onWindowStart(msg: Extract<Command, { type: 'window.start' }>): void {
    const ids = this.idsOf(msg);
    if (!ids) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const gate = this.runGate(msg, ids.window_id, 'window', msg.payload.max_duration_ms);
    if (gate) return this.ackFor(msg, gate.outcome, gate.detail);
    this.lockListener();
    const ctx: RunContext = {
      kind: 'window',
      ids,
      handle: null as unknown as WindowRun,
      framesSent: 0,
      commandedMs: msg.payload.max_duration_ms,
      startedAt: this.clock(),
    };
    let handle: WindowRun;
    try {
      handle = this.deps.audio.window(
        {
          kind: msg.payload.kind,
          maxDurationMs: msg.payload.max_duration_ms,
          vadFloorDbfs: msg.payload.vad_floor_dbfs,
        },
        (frame) => {
          // Level frames exist only while THIS window is open, valid and the page is visible.
          if (this.activeRun !== ctx || this.state.visibility !== 'visible') return;
          if (ctx.framesSent >= LIMITS.levelFramesMax) return;
          ctx.framesSent += 1;
          this.sendAuthed(
            'level',
            {
              frame_index: frame.frameIndex,
              t_audio_ms: frame.tAudioMs,
              dbfs: frame.dbfs,
              active: frame.active,
              clipped: frame.clipped,
            },
            ids,
          );
        },
      );
    } catch {
      return this.ackFor(msg, 'rejected', 'mic_not_open');
    }
    ctx.handle = handle;
    this.budgetUsedMs += ctx.commandedMs;
    this.activeRun = ctx;
    this.patch({ run: { kind: 'window', windowId: ids.window_id } });
    this.ackFor(msg, 'applied');
    void handle.result.then((payload) => this.onRunResult(ctx, payload));
  }

  /** Shared preconditions for starting a precheck or window. */
  private runGate(
    msg: Command,
    windowId: string,
    kind: 'precheck' | 'window',
    commandedMs: number,
  ): { outcome: AckOutcome; detail: string } | null {
    if (!this.matchesSession(msg)) return { outcome: 'ignored_stale', detail: 'unknown_session' };
    if (this.activeRun !== null) {
      return this.activeRun.ids.window_id === windowId
        ? { outcome: 'applied', detail: 'duplicate' }
        : { outcome: 'rejected', detail: 'busy' };
    }
    if (this.closedWindows.includes(windowId)) return { outcome: 'ignored_stale', detail: 'window_closed' };
    if (this.state.visibility !== 'visible') return { outcome: 'rejected', detail: 'page_hidden' };
    if (this.state.mic.state !== 'open_idle') return { outcome: 'rejected', detail: 'mic_not_open' };
    // N-12: a paired TV cannot use the phone as an open-ended ambient-sound monitor.
    if (this.budgetUsedMs + commandedMs > SESSION_CAPTURE_BUDGET_MS) {
      if (!this.budgetNoticeShown) {
        this.budgetNoticeShown = true;
        this.patch({ notice: BUDGET_NOTICE });
      }
      return { outcome: 'rejected', detail: 'budget' };
    }
    if (kind === 'window' && this.clock() - this.lastWindowEndedAt < WINDOW_COOLDOWN_MS) {
      return { outcome: 'rejected', detail: 'cooldown' };
    }
    return null;
  }

  private resetBudget(): void {
    this.budgetUsedMs = 0;
    this.lastWindowEndedAt = Number.NEGATIVE_INFINITY;
    this.budgetNoticeShown = false;
    if (this.state.notice === BUDGET_NOTICE) this.patch({ notice: null });
  }

  /** Returns the unused part of a run's reserved capture time to the budget and notes when a window ended. */
  private settleRun(ctx: RunContext, payload: unknown): void {
    const reported = (payload as { duration_ms?: unknown } | null)?.duration_ms;
    const elapsed = Math.max(0, this.clock() - ctx.startedAt);
    const actual = Math.min(ctx.commandedMs, typeof reported === 'number' && Number.isFinite(reported) ? reported : elapsed);
    this.budgetUsedMs = Math.max(0, this.budgetUsedMs - (ctx.commandedMs - actual));
    if (ctx.kind === 'window') this.lastWindowEndedAt = this.clock();
  }

  private idsOf(msg: Command): RunContext['ids'] | null {
    if (!this.matchesSession(msg) || !msg.session_id || !msg.window_id || !msg.attempt_id) return null;
    return { session_id: msg.session_id, window_id: msg.window_id, attempt_id: msg.attempt_id };
  }

  /** The port finished a run by itself (duration reached, early stop, or interrupted by the device). */
  private onRunResult(ctx: RunContext, payload: unknown): void {
    if (payload === null || this.activeRun !== ctx) return;
    this.activeRun = null;
    this.rememberClosed(ctx.ids.window_id);
    this.patch({ run: null });
    this.settleRun(ctx, payload);
    this.noteSilentInput(ctx.kind, payload);
    this.sendResult(ctx, payload);
  }

  /**
   * A precheck that found no signal at all means the microphone looks muted or blocked. That is a
   * property of the input, not of anybody's speech, so the phone may say so. Level numbers and
   * window results are never shown.
   */
  private noteSilentInput(kind: 'precheck' | 'window', payload: unknown): void {
    if (kind !== 'precheck') return;
    const silent = (payload as PrecheckResultPayload).invalid_reason === 'silent_input';
    if (silent !== (this.state.micNotice === 'silent_input')) this.patch({ micNotice: silent ? 'silent_input' : null });
  }

  private sendResult(
    ctx: { kind: 'precheck' | 'window'; ids: Ids },
    payload: unknown,
  ): void {
    const type = ctx.kind === 'precheck' ? 'precheck.result' : 'window.result';
    // While the TV is known to be away, hold the result until it is back (it will ack it as stale).
    const tvAway = this.state.tvConnected === false;
    const linkUp = this.linkUp();
    const sent = !tvAway && this.sendAuthed(type, payload as never, ctx.ids);
    // Queue only when the link or the TV is away. A message the validators refused is dropped:
    // retrying it would fail the same way. Say so instead of failing silently.
    if (!sent && (tvAway || !linkUp)) {
      this.pendingResults.push({ type, payload, ids: ctx.ids });
      if (this.pendingResults.length > 4) this.pendingResults.shift();
    } else if (!sent) {
      this.patch({ notice: 'The phone could not report that measurement to the TV. Ask the TV to try again.' });
    }
  }

  private flushPending(): void {
    if (this.state.link !== 'connected') return;
    while (this.pendingResults.length > 0) {
      const item = this.pendingResults[0];
      if (!item) break;
      if (!this.sendAuthed(item.type, item.payload as never, item.ids)) return;
      this.pendingResults.shift();
    }
  }

  /**
   * Ends the open window/precheck now. `interrupted` reports an invalid summary to the TV
   * (queued if the link is down); `discard` reports nothing.
   */
  private abortRun(reason: AbortReason): void {
    const ctx = this.activeRun;
    if (ctx === null) return;
    this.activeRun = null;
    this.rememberClosed(ctx.ids.window_id);
    const payload = ctx.handle.abort(reason);
    this.patch({ run: null });
    this.settleRun(ctx, payload);
    if (reason === 'interrupted' && payload !== null) this.sendResult(ctx, payload);
  }

  private onWindowStop(msg: Extract<Command, { type: 'window.stop' }>): void {
    if (!this.matchesSession(msg)) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const ctx = this.activeRun;
    if (ctx !== null && ctx.ids.window_id === msg.window_id && ctx.ids.attempt_id === msg.attempt_id) {
      if (ctx.kind !== 'window') return this.ackFor(msg, 'rejected', 'precheck_not_stoppable');
      this.ackFor(msg, 'applied');
      (ctx.handle as WindowRun).stop(); // the summary arrives via onRunResult and follows the ack
      return;
    }
    if (msg.window_id !== null && this.closedWindows.includes(msg.window_id)) {
      return this.ackFor(msg, 'applied', 'already_closed');
    }
    this.ackFor(msg, 'ignored_stale', 'unknown_window');
  }

  private onWindowCancel(msg: Extract<Command, { type: 'window.cancel' }>): void {
    if (!this.matchesSession(msg)) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    // A4-04: a cancel for the attempt the listener is answering closes the controls (precheck and
    // capture windows of one attempt share the attempt id).
    if (this.state.listener.open && this.state.listener.attemptId === msg.attempt_id) this.lockListener();
    const ctx = this.activeRun;
    if (ctx !== null && ctx.ids.window_id === msg.window_id && ctx.ids.attempt_id === msg.attempt_id) {
      this.abortRun('discard');
      this.ackFor(msg, 'applied');
      return;
    }
    if (msg.window_id !== null && this.closedWindows.includes(msg.window_id)) {
      if (this.state.listener.windowId === msg.window_id) this.lockListener();
      return this.ackFor(msg, 'applied', 'already_closed');
    }
    this.ackFor(msg, 'ignored_stale', 'unknown_window');
  }

  private onListenerOpen(msg: Extract<Command, { type: 'listener.open' }>): void {
    const ids = this.idsOf(msg);
    if (!ids) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    if (this.activeRun !== null) return this.ackFor(msg, 'rejected', 'capture_open');
    const l = this.state.listener;
    const same = l.windowId === ids.window_id && l.attemptId === ids.attempt_id;
    this.patch({
      listener: {
        open: true,
        sessionId: ids.session_id,
        windowId: ids.window_id,
        attemptId: ids.attempt_id,
        answered: same ? l.answered : null,
        feedback: null, // a fresh open clears "Time is up" and any earlier refusal text
      },
      notice: same ? this.state.notice : null,
    });
    // A4-04: the controls close by themselves when the TV's timeout elapses. "Keep waiting" on the
    // TV sends a fresh listener.open, which re-enables them for its attempt.
    this.clearListenerTimer();
    this.listenerTimer = setTimeout(() => {
      this.listenerTimer = null;
      this.lockListener('Time is up for this answer. The TV decides what happens next.');
    }, msg.payload.timeout_ms);
    this.ackFor(msg, 'applied');
  }

  private onReveal(msg: Extract<Command, { type: 'attempt.reveal' }>): void {
    if (!this.matchesSession(msg)) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const l = this.state.listener;
    if (l.open && (l.attemptId !== msg.attempt_id || l.windowId !== msg.window_id)) {
      // A reveal for some other attempt must not lock the one currently open.
      return this.ackFor(msg, 'ignored_stale', 'other_attempt');
    }
    const detail = l.open ? '' : 'nothing_open';
    this.lockListener();
    this.ackFor(msg, 'applied', detail);
  }

  /**
   * Shutdown is awaited: "Mic off" is reported (and the command acknowledged) only once the
   * port says every track, node and context it owned has been released.
   */
  private async onSessionEnd(msg: Extract<Command, { type: 'session.end' }>): Promise<void> {
    if (!this.matchesSession(msg)) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    this.patch({ session: null });
    this.resetCues();
    // N-07: a discarded session means the TV deleted its data; the phone does not keep the phrases either.
    if (msg.payload.reason === 'discarded') this.clearPhraseState();
    await this.shutdownCapture('discard');
    this.resetBudget();
    this.publishMic(); // confirms "Mic off" even if the port was already off
    this.ackFor(msg, 'applied');
  }

  // ---- microphone lifecycle ------------------------------------------------

  /** The ONLY path to getUserMedia: called from the Start microphone button's click handler. */
  startMic(options: { relaxConstraints?: boolean } = {}): void {
    if (!this.state.canStartMic) return;
    void this.deps.audio.open(options.relaxConstraints ? { relaxConstraints: true } : {});
  }

  /** Cancels a pending permission prompt. */
  cancelMicRequest(): void {
    this.deps.audio.cancelOpen();
  }

  /** User turned the microphone off. */
  stopMic(): void {
    if (!this.state.canStopMic) return;
    void this.shutdownCapture('interrupted');
  }

  /**
   * Full capture shutdown: end any run, stop tracks, close the audio graph, release the
   * wake lock (unless the visible session still wants it), lock listener controls.
   */
  private async shutdownCapture(runReason: AbortReason): Promise<void> {
    this.abortRun(runReason);
    this.lockListener();
    this.deps.audio.cancelOpen();
    await this.deps.audio.close();
    this.syncWakeLock();
  }

  private onAudio(snapshot: AudioSnapshot): void {
    const st = snapshot.state;
    const open = st === 'open_idle' || st === 'measuring';
    const clearNotice =
      (this.state.micNotice === 'silent_input' && (st === 'off' || st === 'permission_pending')) ||
      (this.state.micNotice === 'idle_off' && (open || st === 'permission_pending'));
    this.patch({ mic: snapshot, ...(clearNotice ? { micNotice: null } : {}) });
    // N-12: an open microphone is switched off after 10 minutes without any TV command.
    if (open) {
      if (this.idleTimer === null) this.armIdleTimer();
    } else {
      this.clearIdleTimer();
    }
    this.syncWakeLock();
    this.publishMic();
  }

  private onWakeLock(state: WakeLockState): void {
    this.patch({ wakeLock: state });
    this.publishMic();
  }

  private onVisibility(): void {
    const visibility = this.deps.visibility.get();
    if (visibility === this.state.visibility) return;
    this.patch({ visibility });
    if (visibility === 'hidden') {
      // Background policy: invalidate anything open, then release the microphone completely.
      // Capture is never restarted automatically when the page returns.
      void this.shutdownCapture('interrupted');
    }
    this.syncWakeLock();
    this.publishMic();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const open = this.state.mic.state === 'open_idle' || this.state.mic.state === 'measuring';
      if (!open) return;
      // Shut down completely (tracks, graph, context, wake lock), then say why.
      void this.shutdownCapture('interrupted').then(() => this.patch({ micNotice: 'idle_off' }));
    }, MIC_IDLE_OFF_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private touchTvActivity(): void {
    const open = this.state.mic.state === 'open_idle' || this.state.mic.state === 'measuring';
    if (open) this.armIdleTimer();
  }

  /** N-07: forgets everything typed or saved as household phrases (state here, editor in the view). */
  private clearPhraseState(): void {
    this.pendingPhrases = null;
    this.confirmedPhrases = [];
    this.patch({
      phrases: { status: 'none', count: 0, saved: [] },
      phrasesResetToken: this.state.phrasesResetToken + 1,
    });
  }

  /** Keep-screen-on is wanted while the page is visible and a session or the mic is active. */
  private syncWakeLock(): void {
    const micOpen = this.state.mic.state === 'open_idle' || this.state.mic.state === 'measuring';
    const wanted = this.state.visibility === 'visible' && this.state.screen === 'setup' && (micOpen || this.state.session !== null);
    if (wanted) void this.deps.wakeLock.request();
    else void this.deps.wakeLock.release();
  }

  private publishMic(): void {
    if (this.state.link !== 'connected' || !this.factory.authenticated) return;
    const { mic } = this.state;
    const payload = {
      state: mic.state,
      settings: mic.settings,
      supported: mic.supported,
      wake_lock: this.state.wakeLock,
      visibility: this.state.visibility,
      mode: mic.mode,
    };
    const sessionId = this.state.session?.sessionId ?? null;
    const key = JSON.stringify([payload, sessionId]);
    if (key === this.lastMicKey) return;
    if (this.sendAuthed('mic.state', payload, { session_id: sessionId })) this.lastMicKey = key;
  }

  /**
   * Re-sends the current mic.state even though nothing changed (the normal path de-duplicates),
   * for a TV that has just (re)connected. At most one per second: a burst of `peer.state` messages
   * produces one immediate report and one trailing report when the second is up, so the TV always
   * ends up with the latest state without being flooded. The message is the same snapshot the
   * normal path would send (including session_id when known), so repeating it is harmless.
   */
  private reportMicToTv(): void {
    const wait = this.lastTvReportAt + TV_REPORT_MIN_INTERVAL_MS - this.clock();
    if (wait > 0) {
      if (this.tvReportTimer === null) {
        this.tvReportTimer = setTimeout(() => {
          this.tvReportTimer = null;
          this.sendMicToTv();
        }, wait);
      }
      return;
    }
    this.sendMicToTv();
  }

  private sendMicToTv(): void {
    if (!this.userConfirmed || !this.linkUp()) return;
    this.lastMicKey = null; // force: the TV may never have seen the current state
    this.publishMic();
    if (this.lastMicKey !== null) this.lastTvReportAt = this.clock();
  }

  private clearTvReportTimer(): void {
    if (this.tvReportTimer !== null) clearTimeout(this.tvReportTimer);
    this.tvReportTimer = null;
  }

  private clock(): number {
    return (this.deps.now ?? Date.now)();
  }

  // ---- listener controls -----------------------------------------------------

  private lockListener(feedback?: string): void {
    this.clearListenerTimer();
    if (!this.state.listener.open) return;
    this.patch({ listener: { ...this.state.listener, open: false, ...(feedback !== undefined ? { feedback } : {}) } });
  }

  private clearListenerTimer(): void {
    if (this.listenerTimer !== null) clearTimeout(this.listenerTimer);
    this.listenerTimer = null;
  }

  /** Heard / Not heard. Bound to the window and attempt from the TV's listener.open. */
  answer(response: 'heard' | 'not_heard'): void {
    const s = this.state;
    if (!s.canAnswer || !s.listener.sessionId || !s.listener.windowId || !s.listener.attemptId) return;
    const id = this.sendAuthedWithId(
      'listener.response',
      { response },
      { session_id: s.listener.sessionId, window_id: s.listener.windowId, attempt_id: s.listener.attemptId },
    );
    if (id !== null) {
      this.pendingResponse = id;
      this.patch({ listener: { ...s.listener, answered: response, feedback: null }, notice: null });
    } else {
      this.patch({ notice: 'Could not send. Waiting for the connection to the TV.' });
    }
  }

  /** Sends the cue word. At most three per session (the TV and relay enforce it too). */
  sendCue(): void {
    const s = this.state;
    if (!s.canCue || !s.listener.sessionId) return;
    const text = validateCue(s.cue.word);
    if (!text.ok) return;
    const env = this.sendAuthedWithId('cue', { text: text.text }, { session_id: s.listener.sessionId });
    if (env === null) {
      this.patch({ notice: 'Could not send. Waiting for the connection to the TV.' });
      return;
    }
    this.pendingCues.add(env);
    this.cueNet += 1;
    this.patch({ cue: { ...this.state.cue, feedback: null }, notice: null });
    this.syncCues();
  }

  private resetCues(): void {
    this.tvCues = 0;
    this.cueBase = 0;
    this.cueNet = 0;
    this.pendingCues.clear();
    this.syncCues();
  }

  private markCueLimit(): void {
    this.cueBase = LIMITS.cuesPerSession;
    this.cueNet = 0;
  }

  private cueCount(max: number): number {
    return Math.min(max, Math.max(this.tvCues, this.cueBase + this.cueNet));
  }

  private syncCues(): void {
    const used = this.cueCount(this.state.cue.max);
    if (used !== this.state.cue.used) this.patch({ cue: { ...this.state.cue, used } });
  }

  /** Editable in the settings panel; memory only. */
  setCueWord(raw: string): void {
    const check = validateCue(raw);
    if (check.ok) this.patch({ cue: { ...this.state.cue, word: check.text, message: null } });
    else this.patch({ cue: { ...this.state.cue, message: check.message } });
  }

  // ---- phrases -------------------------------------------------------------

  /**
   * Validates with the protocol's own rules, then sends the phrase list once. Editing is refused
   * while measuring. The TV acks it: applied = saved; rejected (for example a phrase window is
   * open) is shown and the user presses Save again; nothing is resent automatically.
   */
  savePhrases(raw: readonly string[]): PhraseValidation & { sent: boolean } {
    const validation = validatePhrases(raw);
    if (this.state.phrasesLocked) {
      this.patch({ phrases: { ...this.state.phrases, status: 'locked' } });
      return { ...validation, sent: false };
    }
    if (!validation.ok) return { ...validation, sent: false };
    const id = this.sendAuthedWithId('phrases.update', { phrases: validation.phrases });
    if (id === null) {
      this.pendingPhrases = null;
      this.patch({ phrases: { status: 'not_sent', count: validation.phrases.length, saved: this.confirmedPhrases } });
      return { ...validation, sent: false };
    }
    this.pendingPhrases = { id, phrases: validation.phrases };
    this.patch({
      phrases: { status: 'sending', count: validation.phrases.length, saved: validation.phrases },
      notice: null,
    });
    return { ...validation, sent: true };
  }

  // ---- unpair / shutdown -----------------------------------------------------

  private unpair(reason: UnpairedReason): void {
    this.transport.close();
    this.factory.clearAuth();
    this.credential = null;
    this.pendingResults.length = 0;
    this.lastMicKey = null;
    this.pendingPhrases = null;
    this.pendingResponse = null;
    this.resetCues();
    this.userConfirmed = false;
    this.refusedSince = null;
    this.dropHeld();
    this.clearTvReportTimer();
    this.lastTvReportAt = Number.NEGATIVE_INFINITY;
    this.clearFailureWindow();
    this.clearListenerTimer();
    this.clearIdleTimer();
    this.clearPhraseState(); // N-07: household text goes with the credential
    this.resetBudget();
    this.patch({ session: null, micNotice: null });
    void this.shutdownCapture('discard');
    // A6-02: back to Join with a plain explanation; nothing is retried with the old credential.
    this.patch({
      screen: 'join',
      pairingConfirmed: false,
      unpairedReason: reason,
      link: 'disconnected',
      tvConnected: null,
      reconnectAttempt: 0,
      run: null,
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: null, code: '' },
    });
    this.syncWakeLock();
  }

  /** Tear down everything (page unload, tests). */
  dispose(): void {
    this.transport.close();
    this.clearTvReportTimer();
    this.clearFailureWindow();
    this.clearListenerTimer();
    this.clearIdleTimer();
    void this.shutdownCapture('discard');
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.listeners.clear();
  }

  get hasPairedBefore(): boolean {
    return this.pairedOnce;
  }

  // ---- sending -------------------------------------------------------------

  /** True when an authenticated connection is open right now. */
  private linkUp(): boolean {
    return this.state.link === 'connected' && this.factory.authenticated && this.transport.isOpen;
  }

  private sendRaw(message: WireMessage): boolean {
    try {
      return this.transport.send(this.factory.serialize(message));
    } catch {
      return false;
    }
  }

  /** Sends an authenticated message; false when the link is not up. */
  private sendAuthed<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): boolean {
    return this.sendAuthedWithId(type, payload, ids) !== null;
  }

  /** Returns the message_id when sent, otherwise null. */
  private sendAuthedWithId<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): string | null {
    if (!this.linkUp()) return null;
    // A3-01: until the user confirmed the pairing, the only thing sent is the join protocol and ping.
    if (!this.userConfirmed && !PRE_CONFIRM_TYPES.has(type)) return null;
    try {
      const message = this.factory.build(type, payload, ids);
      return this.transport.send(this.factory.serialize(message)) ? message.message_id : null;
    } catch {
      // The factory validates every message; an invalid one is never sent.
      return null;
    }
  }
}

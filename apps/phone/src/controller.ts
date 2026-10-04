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

import { CODE_LENGTH, DEFAULT_CUE_WORD, LIMITS, RECONNECT_BACKOFF_MS } from './config.js';
import { joinErrorText, joinRejectedText } from './labels.js';
import { checkCode, normalizeCodeInput } from './pairing.js';
import { type PhraseValidation, validateCue, validateDeviceLabel, validatePhrases } from './phrases.js';
import type { AbortReason, AudioPort, AudioSnapshot, PrecheckRun, WindowRun } from './ports/audio.js';
import {
  type AckOutcome,
  type Envelope,
  type ErrorCode,
  type Ids,
  type InboundMessage,
  type InboundType,
  MessageFactory,
  type OutboundPayloads,
  type OutboundType,
  parseIncoming,
  serialize,
  type TvStage,
  type Visibility,
  type WakeLockState,
} from './ports/wire.js';
import { backoffDelay, type SocketFactory, Transport } from './transport.js';
import type { WakeLockController } from './wake-lock.js';

export type Screen = 'join' | 'setup' | 'unpaired';
export type JoinPhase = 'idle' | 'connecting' | 'pending';
/** Transport state names from PROTOCOL.md section 6. */
export type LinkState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'failed';
export type UnpairedReason = 'tv_unpaired' | 'room_closed' | 'expired' | 'revoked' | 'superseded';

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
  link: LinkState;
  reconnectAttempt: number;
  tvConnected: boolean | null;
  mic: AudioSnapshot;
  wakeLock: WakeLockState;
  visibility: Visibility;
  session: SessionInfo | null;
  run: { kind: 'precheck' | 'window'; windowId: string } | null;
  listener: ListenerBinding;
  cue: { word: string; message: string | null; used: number; max: number };
  phrases: { status: 'none' | 'sent' | 'not_sent' | 'locked'; count: number; saved: string[] };
  notice: string | null;
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
  factory?: MessageFactory;
  defaultDeviceLabel: string;
  /** Test builds only. */
  banner?: string | null;
  now?: () => number;
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
  private readonly factory: MessageFactory;
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
  private pairedOnce = false;

  constructor(private readonly deps: ControllerDeps) {
    this.factory = deps.factory ?? new MessageFactory();
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
      link: 'disconnected',
      reconnectAttempt: 0,
      tvConnected: null,
      mic: deps.audio.getSnapshot(),
      wakeLock: deps.wakeLock.state,
      visibility: deps.visibility.get(),
      session: null,
      run: null,
      listener: { open: false, sessionId: null, windowId: null, attemptId: null, answered: null },
      cue: { word: DEFAULT_CUE_WORD, message: null, used: 0, max: LIMITS.cuesPerSession },
      phrases: { status: 'none', count: 0, saved: [] },
      notice: null,
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
    this.patch({
      join: { ...join, phase: 'connecting', message: null, codeMessage: null, deviceLabelMessage: null },
      link: 'connecting',
      notice: null,
    });
    this.transport.open(this.deps.relayUrl);
  }

  /** User cancelled the join (before the TV confirmed). */
  cancelJoin(): void {
    if (this.state.join.phase === 'idle' || this.credential !== null) return;
    this.transport.close();
    this.factory.clearAuth();
    this.patch({
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: 'Join cancelled.' },
      link: 'disconnected',
    });
  }

  /** From the "no longer paired" screen. */
  pairAgain(): void {
    this.patch({
      screen: 'join',
      unpairedReason: null,
      link: 'disconnected',
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: null, code: '', codeMessage: null },
    });
  }

  private onSocketOpen(): void {
    this.patch({ link: 'authenticating' });
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
    this.onLinkLost();
  }

  /** Paired but the socket is gone: cancel measurement, then retry with backoff. */
  private onLinkLost(): void {
    this.factory.clearAuth();
    this.lastMicKey = null;
    this.abortRun('interrupted');
    const attempt = this.state.reconnectAttempt;
    const delay = backoffDelay(attempt, RECONNECT_BACKOFF_MS);
    this.purpose = 'resume';
    this.patch({ link: 'reconnecting', reconnectAttempt: attempt + 1, tvConnected: null });
    this.transport.scheduleRetry(delay, this.deps.relayUrl);
  }

  /** User pressed "Reconnect now". */
  retryNow(): void {
    if (this.state.link !== 'reconnecting' || this.credential === null) return;
    this.purpose = 'resume';
    this.transport.open(this.deps.relayUrl);
  }

  // ---- inbound messages --------------------------------------------------

  private onText(text: string): void {
    const parsed = parseIncoming(text);
    if (!parsed.ok) return;
    const msg = parsed.message;
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
        if (msg.payload.role === 'tv') {
          this.patch({ tvConnected: msg.payload.connected });
          if (!msg.payload.connected) this.abortRun('interrupted');
          else this.flushPending();
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
        this.onAck(msg.payload.acked_message_id, msg.payload.outcome, msg.payload.detail);
        return;
      default:
        if (COMMAND_TYPES.has(msg.type) && this.state.screen === 'setup') this.onCommand(msg as Command);
    }
  }

  private onJoinAccepted(roomId: string, credential: string, expiresAt: number, generation: number): void {
    if (this.credential !== null || this.state.join.phase === 'idle') return;
    this.credential = { roomId, credential, expiresAt };
    this.factory.setAuth(roomId, generation);
    this.pairedOnce = true;
    this.patch({
      screen: 'setup',
      join: { ...this.state.join, phase: 'idle', confirmDigits: null, message: null, code: '' },
    });
    this.enterConnected(null);
  }

  private onAuthOk(payload: { role: string; generation: number; peer_connected: boolean; phone_paired: boolean }): void {
    if (payload.role !== 'phone' || this.credential === null || this.purpose !== 'resume') return;
    if (!payload.phone_paired) {
      this.unpair('revoked');
      return;
    }
    this.factory.setAuth(this.credential.roomId, payload.generation);
    this.enterConnected(payload.peer_connected);
  }

  /** Authenticated (join.accepted or auth.ok): start heartbeat, publish state, flush queued results. */
  private enterConnected(tvConnected: boolean | null): void {
    this.patch({ link: 'connected', reconnectAttempt: 0, tvConnected, notice: null });
    this.transport.startHeartbeat(() =>
      this.factory.authenticated ? serialize(this.factory.build('ping', {})) : null,
    );
    this.lastMicKey = null;
    this.publishMic();
    this.flushPending();
    this.syncWakeLock();
  }

  private onRelayError(code: ErrorCode, ref: string | null): void {
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

  private onAck(ackedId: string, outcome: AckOutcome, detail: string): void {
    if (!this.pendingCues.has(ackedId)) return;
    this.pendingCues.delete(ackedId);
    if (outcome === 'applied') return;
    if (detail === 'cue_limit') this.markCueLimit();
    else this.cueNet = Math.max(0, this.cueNet - 1);
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
        return this.onSessionEnd(msg);
    }
  }

  private onSessionBegin(msg: Extract<Command, { type: 'session.begin' }>): void {
    if (this.state.session !== null && this.state.session.sessionId !== msg.session_id) {
      this.abortRun('discard');
      this.lockListener();
    }
    if (this.state.session?.sessionId !== msg.session_id) {
      this.tvCues = 0;
      this.cueBase = 0;
      this.cueNet = 0;
      this.pendingCues.clear();
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
    const gate = this.runGate(msg, ids.window_id);
    if (gate) return this.ackFor(msg, gate.outcome, gate.detail);
    this.lockListener();
    let handle: PrecheckRun;
    try {
      handle = this.deps.audio.precheck({ purpose: msg.payload.purpose, durationMs: msg.payload.duration_ms });
    } catch {
      return this.ackFor(msg, 'rejected', 'mic_not_open');
    }
    const ctx: RunContext = { kind: 'precheck', ids, handle, framesSent: 0 };
    this.activeRun = ctx;
    this.patch({ run: { kind: 'precheck', windowId: ids.window_id } });
    this.ackFor(msg, 'applied');
    void handle.result.then((payload) => this.onRunResult(ctx, payload));
  }

  private onWindowStart(msg: Extract<Command, { type: 'window.start' }>): void {
    const ids = this.idsOf(msg);
    if (!ids) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    const gate = this.runGate(msg, ids.window_id);
    if (gate) return this.ackFor(msg, gate.outcome, gate.detail);
    this.lockListener();
    const ctx: RunContext = { kind: 'window', ids, handle: null as unknown as WindowRun, framesSent: 0 };
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
    this.activeRun = ctx;
    this.patch({ run: { kind: 'window', windowId: ids.window_id } });
    this.ackFor(msg, 'applied');
    void handle.result.then((payload) => this.onRunResult(ctx, payload));
  }

  /** Shared preconditions for starting a precheck or window. */
  private runGate(msg: Command, windowId: string): { outcome: AckOutcome; detail: string } | null {
    if (!this.matchesSession(msg)) return { outcome: 'ignored_stale', detail: 'unknown_session' };
    if (this.activeRun !== null) {
      return this.activeRun.ids.window_id === windowId
        ? { outcome: 'applied', detail: 'duplicate' }
        : { outcome: 'rejected', detail: 'busy' };
    }
    if (this.closedWindows.includes(windowId)) return { outcome: 'ignored_stale', detail: 'window_closed' };
    if (this.state.visibility !== 'visible') return { outcome: 'rejected', detail: 'page_hidden' };
    if (this.state.mic.state !== 'open_idle') return { outcome: 'rejected', detail: 'mic_not_open' };
    return null;
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
    this.sendResult(ctx, payload);
  }

  private sendResult(
    ctx: { kind: 'precheck' | 'window'; ids: Ids },
    payload: unknown,
  ): void {
    const type = ctx.kind === 'precheck' ? 'precheck.result' : 'window.result';
    // While the TV is known to be away, hold the result until it is back (it will ack it as stale).
    const sent = this.state.tvConnected !== false && this.sendAuthed(type, payload as never, ctx.ids);
    if (!sent) {
      this.pendingResults.push({ type, payload, ids: ctx.ids });
      if (this.pendingResults.length > 4) this.pendingResults.shift();
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
      },
    });
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

  private onSessionEnd(msg: Extract<Command, { type: 'session.end' }>): void {
    if (!this.matchesSession(msg)) return this.ackFor(msg, 'ignored_stale', 'unknown_session');
    this.patch({ session: null });
    this.resetCues();
    this.shutdownCapture('discard');
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
    this.shutdownCapture('interrupted');
  }

  /**
   * Full capture shutdown: end any run, stop tracks, close the audio graph, release the
   * wake lock (unless the visible session still wants it), lock listener controls.
   */
  private shutdownCapture(runReason: AbortReason): void {
    this.abortRun(runReason);
    this.lockListener();
    this.deps.audio.cancelOpen();
    this.deps.audio.close();
    this.syncWakeLock();
  }

  private onAudio(snapshot: AudioSnapshot): void {
    this.patch({ mic: snapshot });
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
      this.shutdownCapture('interrupted');
    }
    this.syncWakeLock();
    this.publishMic();
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

  // ---- listener controls -----------------------------------------------------

  private lockListener(): void {
    if (!this.state.listener.open) return;
    this.patch({ listener: { ...this.state.listener, open: false } });
  }

  /** Heard / Not heard. Bound to the window and attempt from the TV's listener.open. */
  answer(response: 'heard' | 'not_heard'): void {
    const s = this.state;
    if (!s.canAnswer || !s.listener.sessionId || !s.listener.windowId || !s.listener.attemptId) return;
    const sent = this.sendAuthed(
      'listener.response',
      { response },
      { session_id: s.listener.sessionId, window_id: s.listener.windowId, attempt_id: s.listener.attemptId },
    );
    if (sent) this.patch({ listener: { ...s.listener, answered: response } });
    else this.patch({ notice: 'Could not send. Waiting for the connection to the TV.' });
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

  /** Validates and sends the phrase list. Editing is refused while measuring. */
  savePhrases(raw: readonly string[]): PhraseValidation & { sent: boolean } {
    const validation = validatePhrases(raw);
    if (this.state.phrasesLocked) {
      this.patch({ phrases: { ...this.state.phrases, status: 'locked' } });
      return { ...validation, sent: false };
    }
    if (!validation.ok) return { ...validation, sent: false };
    const sent = this.sendAuthed('phrases.update', { phrases: validation.phrases });
    this.patch({
      phrases: {
        status: sent ? 'sent' : 'not_sent',
        count: validation.phrases.length,
        saved: sent ? validation.phrases : this.state.phrases.saved,
      },
    });
    return { ...validation, sent };
  }

  // ---- unpair / shutdown -----------------------------------------------------

  private unpair(reason: UnpairedReason): void {
    this.transport.close();
    this.factory.clearAuth();
    this.credential = null;
    this.pendingResults.length = 0;
    this.lastMicKey = null;
    this.resetCues();
    this.patch({ session: null });
    this.shutdownCapture('discard');
    this.patch({
      screen: 'unpaired',
      unpairedReason: reason,
      link: 'disconnected',
      tvConnected: null,
      reconnectAttempt: 0,
      run: null,
    });
    this.syncWakeLock();
  }

  /** Tear down everything (page unload, tests). */
  dispose(): void {
    this.transport.close();
    this.shutdownCapture('discard');
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.listeners.clear();
  }

  get hasPairedBefore(): boolean {
    return this.pairedOnce;
  }

  // ---- sending -------------------------------------------------------------

  private sendRaw(envelope: Envelope): boolean {
    return this.transport.send(serialize(envelope));
  }

  /** Sends an authenticated message; false when the link is not up. */
  private sendAuthed<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): boolean {
    return this.sendAuthedWithId(type, payload, ids) !== null;
  }

  /** Returns the message_id when sent, otherwise null. */
  private sendAuthedWithId<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): string | null {
    if (this.state.link !== 'connected' || !this.factory.authenticated || !this.transport.isOpen) return null;
    const envelope = this.factory.build(type, payload, ids);
    return this.transport.send(serialize(envelope)) ? envelope.message_id : null;
  }
}

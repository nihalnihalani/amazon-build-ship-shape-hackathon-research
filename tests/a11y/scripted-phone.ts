/**
 * Scripted relay + phone for the TV web preview in store mode.
 *
 * The preview's session store (real @atr/session-core) opens wss://localhost:8443/ws. Playwright's
 * routeWebSocket intercepts that socket, so no server and no certificate exist: this class plays the relay
 * and the phone from Node, building every frame with @atr/protocol's MessageFactory (validated by the shared
 * validators before it is sent).
 *
 * Evidence class of anything driven through this class: web_preview + scripted phone (no real microphone,
 * no real relay, no Vega).
 */
import { MessageFactory, createIdFactory, quantizeCoverage, quantizeDb } from '@atr/protocol';
import type { MessageType, PayloadMap } from '@atr/protocol';
import type { Page, WebSocketRoute } from 'playwright-core';

export const ROOM = 'r_a11yreviewroom0001';
export const CREDENTIAL = 'A11YCRED0123456789'.padEnd(43, 'x');
export const PAIRING_CODE = 'ACDEFH';
export const FLOOR = -50;
/** The two digits the relay sends and the phone shows. The TV offers them among two decoys (contract rev 2, A3-06). */
export const CONFIRM_DIGITS = '42';

export interface TvMessage {
  type: string;
  payload: Record<string, unknown>;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
}

export interface PhraseScript {
  /** p95 of the accepted activity, dB above the session floor. */
  rel: number;
  /** dBFS level frames streamed during capture. */
  levels?: number[];
  /** How long after window.start the window.result arrives. */
  resultDelayMs?: number;
  valid?: boolean;
  reason?: PayloadMap['window.result']['invalid_reason'];
}

export interface PhoneOptions {
  bank?: string[];
  /** By phrase position (1-based). Missing positions score 25 dB. */
  phrases?: Record<number, PhraseScript>;
  calibrationRel?: number;
  /** Delay before each precheck/calibration answer. */
  answerDelayMs?: number;
  /** Answer the FIRST quiet-check precheck with silent_input (a muted or blocked microphone, revision 4). */
  silentFirstQuietCheck?: boolean;
}

/**
 * The window.result a phone reports for a capture the TV commanded with `max_duration_ms`. The TV re-validates it
 * (A1-09): the protocol invariants (frame counts, coverage, active time, percentile order) AND its own timing rule
 * `duration_ms <= max_duration_ms + 500`. A calibration window is commanded for 6000 ms, so it must be reported as
 * (at most) 6000 ms; a fixed 8000 ms makes the TV answer `integrity`. `active_ms` must not exceed `duration_ms`.
 */
export function windowResultPayload(
  kind: 'calibration' | 'vowel' | 'phrase',
  maxDurationMs: number,
  script: Pick<PhraseScript, 'rel' | 'valid' | 'reason'>,
): PayloadMap['window.result'] {
  const valid = script.valid !== false;
  const durationMs = Math.min(Math.round(maxDurationMs), 8000);
  const frames = Math.floor(durationMs / 50);
  return {
    kind,
    valid,
    invalid_reason: valid ? null : (script.reason ?? 'no_voice'),
    frame_count: frames,
    expected_frames: frames,
    coverage: quantizeCoverage(1),
    active_ms: 2500,
    longest_active_ms: 2500,
    segments: 1,
    onset_ms: 200,
    p50_active_dbfs: quantizeDb(FLOOR + script.rel - 4),
    p95_active_dbfs: valid ? quantizeDb(FLOOR + script.rel) : null,
    peak_dbfs: quantizeDb(FLOOR + script.rel + 2),
    clipped_frames: 0,
    nonfinite_frames: 0,
    duration_ms: durationMs,
  };
}

/** A valid precheck aggregate: floor -50 dBFS, stable, unclipped, full coverage, the commanded duration. */
export function precheckPayload(purpose: 'quiet_check' | 'pre_window'): PayloadMap['precheck.result'] {
  const frames = purpose === 'quiet_check' ? 100 : 40;
  return {
    purpose,
    valid: true,
    invalid_reason: null,
    floor_dbfs: quantizeDb(FLOOR),
    p20_dbfs: quantizeDb(FLOOR - 1),
    p80_dbfs: quantizeDb(FLOOR + 1),
    p95_dbfs: quantizeDb(FLOOR + 3),
    frame_count: frames,
    expected_frames: frames,
    coverage: quantizeCoverage(1),
    clipped_frames: 0,
    nonfinite_frames: 0,
    duration_ms: purpose === 'quiet_check' ? 5000 : 2000,
  };
}

export class ScriptedPhone {
  readonly received: TvMessage[] = [];
  /** Wall-clock time (ms) at which each entry of `received` arrived. */
  readonly receivedAt: number[] = [];
  private ws: WebSocketRoute | null = null;
  private readonly phone: MessageFactory;
  private readonly relay: MessageFactory;
  private bankSent = false;
  private stopRequested = new Set<string>();
  private silentQuietSent = false;
  /** Credentials the TV presented in auth.resume, in order, and the rotated ones this script handed out. */
  readonly resumed: string[] = [];
  readonly rotated: string[] = [];

  private readonly page: Page;
  private readonly opts: PhoneOptions;

  constructor(page: Page, opts: PhoneOptions = {}) {
    this.page = page;
    this.opts = opts;
    const clock = (): number => Date.now();
    this.phone = new MessageFactory({ role: 'phone', idFactory: createIdFactory(), clock, roomId: ROOM, generation: 1 });
    this.relay = new MessageFactory({ role: 'relay', idFactory: createIdFactory(), clock, roomId: ROOM });
  }

  async install(): Promise<void> {
    await this.page.routeWebSocket(/^wss?:\/\/localhost:8443\/ws/, (ws) => {
      this.ws = ws;
      ws.onMessage((raw) => this.onTv(JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as TvMessage));
    });
  }

  count(type: string): number {
    return this.received.filter((m) => m.type === type).length;
  }
  last(type: string): TvMessage | undefined {
    return [...this.received].reverse().find((m) => m.type === type);
  }

  private sendRelay<T extends MessageType>(type: T, payload: PayloadMap[T]): void {
    this.ws?.send(this.relay.serialize(this.relay.next(type, payload)));
  }

  private sendPhone<T extends MessageType>(type: T, payload: PayloadMap[T], tv?: TvMessage): string {
    const msg = this.phone.next(type, payload, {
      session_id: tv?.session_id ?? null,
      window_id: tv?.window_id ?? null,
      attempt_id: tv?.attempt_id ?? null,
    });
    this.ws?.send(this.phone.serialize(msg));
    return msg.message_id;
  }

  /** message_id of the phrases.update the phone sent, and the TV's ack outcome for it once it arrives. */
  bankMessageId: string | null = null;
  bankAck: { outcome: string; detail: string } | null = null;

  /** Resolves when the TV has acknowledged the phrase bank (applied or rejected). */
  async waitForBankAck(timeoutMs = 10_000): Promise<{ outcome: string; detail: string }> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (this.bankAck !== null) return this.bankAck;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('no ack for phrases.update');
  }

  private later(ms: number, fn: () => void): void {
    setTimeout(fn, ms);
  }

  /** Digits of the join request in flight (what the phone would show). */
  confirmDigits = CONFIRM_DIGITS;

  /**
   * The relay tells the TV a phone is asking to join. The test then picks the matching number with the keyboard
   * (number matching, A3-06). All frames are raw text frames built with MessageFactory (PK-09).
   */
  requestJoin(digits: string = CONFIRM_DIGITS): void {
    this.confirmDigits = digits;
    this.sendRelay('join.requested', {
      join_id: 'j_a11yreview00001',
      device_label: 'QA scripted phone',
      confirm_digits: digits,
      expires_at: Date.now() + 60_000,
    });
  }

  micState(state: PayloadMap['mic.state']['state']): void {
    this.sendPhone('mic.state', {
      state,
      settings: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 },
      supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
      wake_lock: 'held',
      visibility: 'visible',
      mode: 'fixture_replay',
    });
  }

  cue(text: string, sessionId: string): void {
    this.sendPhone('cue', { text }, { session_id: sessionId, window_id: null, attempt_id: null, type: 'cue', payload: {} });
  }

  dropLink(): void {
    this.ws?.close({ code: 1006, reason: 'scripted link loss' });
  }

  private onTv(m: TvMessage): void {
    this.received.push(m);
    this.receivedAt.push(Date.now());
    const delay = this.opts.answerDelayMs ?? 80;
    switch (m.type) {
      case 'room.create':
        this.sendRelay('room.created', {
          room_id: ROOM,
          pairing_code: PAIRING_CODE,
          code_expires_at: Date.now() + 600_000,
          tv_credential: CREDENTIAL,
          credential_expires_at: Date.now() + 2 * 3_600_000,
          generation: 1,
        });
        break;
      case 'auth.resume': {
        // Revision 4: the presented credential is consumed; auth.ok carries the rotated one.
        this.resumed.push(String(m.payload['credential']));
        const next = `NEXTCRED${String(this.rotated.length + 1).padStart(4, '0')}`.padEnd(43, 'z');
        this.rotated.push(next);
        this.later(delay, () => {
          this.sendRelay('auth.ok', { role: 'tv', generation: 2, peer_connected: true, phone_paired: true, next_credential: next });
          this.later(delay, () => this.micState('open_idle')); // the phone reports again after a reconnect
        });
        break;
      }
      case 'join.confirm':
        if (m.payload['decision'] === 'accept') {
          this.later(delay, () => {
            this.sendRelay('peer.state', { role: 'phone', connected: true, generation: 1 });
            this.later(delay, () => this.micState('permission_pending'));
            this.later(delay * 3, () => this.micState('open_idle'));
          });
        }
        break;
      case 'session.begin':
        if (!this.bankSent && this.opts.bank !== undefined) {
          this.bankSent = true;
          this.later(delay * 5, () => {
            this.bankMessageId = this.sendPhone('phrases.update', { phrases: this.opts.bank ?? [] });
          });
        }
        break;
      case 'precheck.start':
        this.later(delay, () => this.answerPrecheck(m));
        break;
      case 'window.start':
        this.answerWindow(m);
        break;
      case 'window.stop':
        this.stopRequested.add(m.window_id ?? '');
        this.later(delay, () => this.sendWindowResult(m, this.scriptFor(m)));
        break;
      case 'ack':
        if (this.bankMessageId !== null && m.payload['acked_message_id'] === this.bankMessageId) {
          this.bankAck = { outcome: String(m.payload['outcome']), detail: String(m.payload['detail']) };
        }
        break;
      case 'listener.open':
        this.later(delay * 4, () => this.sendPhone('listener.response', { response: 'heard' }, m));
        break;
      default:
        break;
    }
  }

  private answerPrecheck(m: TvMessage): void {
    const purpose = m.payload['purpose'] as 'quiet_check' | 'pre_window';
    const frames = purpose === 'quiet_check' ? 100 : 40;
    if (purpose === 'quiet_check' && this.opts.silentFirstQuietCheck === true && !this.silentQuietSent) {
      this.silentQuietSent = true;
      this.sendPhone(
        'precheck.result',
        {
          purpose,
          valid: false,
          invalid_reason: 'silent_input',
          floor_dbfs: -130,
          p20_dbfs: -131,
          p80_dbfs: -129,
          p95_dbfs: -128,
          frame_count: frames,
          expected_frames: frames,
          coverage: quantizeCoverage(1),
          clipped_frames: 0,
          nonfinite_frames: 0,
          duration_ms: 5000,
        },
        m,
      );
      return;
    }
    this.sendPhone('precheck.result', precheckPayload(purpose), m);
  }

  private scriptFor(m: TvMessage): PhraseScript {
    const kind = m.payload['kind'] as string;
    if (kind === 'calibration') return { rel: this.opts.calibrationRel ?? 20, resultDelayMs: 300 };
    const position = (m.payload['phrase_position'] as number | null) ?? 0;
    return this.opts.phrases?.[position] ?? { rel: 25, resultDelayMs: 500 };
  }

  private answerWindow(m: TvMessage): void {
    const script = this.scriptFor(m);
    const levels = script.levels ?? [FLOOR + 2, FLOOR + 10, FLOOR + 20];
    levels.forEach((db, i) => this.later(60 * (i + 1), () => this.sendLevel(m, i, db)));
    this.later(script.resultDelayMs ?? 500, () => {
      if (this.stopRequested.has(m.window_id ?? '')) return; // already answered after a stop
      this.sendWindowResult(m, script);
    });
  }

  private sendLevel(m: TvMessage, frame: number, dbfs: number): void {
    this.sendPhone('level', { frame_index: frame, t_audio_ms: frame * 50, dbfs: quantizeDb(dbfs), active: true, clipped: false }, m);
  }

  private sendWindowResult(m: TvMessage, script: PhraseScript): void {
    const kind = m.payload['kind'] as 'calibration' | 'vowel' | 'phrase';
    const max = Number(m.payload['max_duration_ms']);
    this.sendPhone('window.result', windowResultPayload(kind, Number.isFinite(max) ? max : 8000, script), m);
  }
}

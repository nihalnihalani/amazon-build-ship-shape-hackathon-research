/**
 * Wire port: the only file in apps/phone that imports `@atr/protocol`.
 *
 * It builds and parses PROTOCOL.md messages for the phone role on top of the package
 * (MessageFactory, createIdFactory, parseWireMessage, text helpers and validators) and
 * re-exports the few constants and text helpers the rest of the app needs, so the app
 * never depends on the package layout.
 *
 * Revision 2 rules applied here (PROTOCOL.md section 8):
 *  - `join.request` carries room_id null; authenticated messages carry the room from
 *    `join.accepted` and a producer_generation that starts at 1;
 *  - the sequence restarts at 0 for each new generation (and for every new connection's
 *    pre-auth phase);
 *  - user text is sent exactly as `normalizeUserText(...)` returns it, because the package
 *    validators reject text that is not already NFC + trimmed.
 */

import {
  createIdFactory,
  isAllowedSender,
  MESSAGE_TYPES,
  MessageFactory as ProtocolMessageFactory,
  parseWireMessage,
  specFor,
} from '@atr/protocol';
import type {
  MessageIds,
  MessageOf,
  PayloadMap,
  Role,
  WireMessage,
} from '@atr/protocol';

export {
  CUE_LENGTH_MAX,
  CUES_PER_SESSION_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  LEVEL_FRAMES_PER_WINDOW_MAX,
  MAX_MESSAGE_BYTES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_COUNT_MAX,
  PHRASE_COUNT_MIN,
  PHRASE_LENGTH_MAX,
  codePointLength,
  normalizeUserText,
  validateCue,
  validateDeviceLabel,
  validatePhrase,
} from '@atr/protocol';
export type { TextCheck as PackageTextCheck } from '@atr/protocol';

export type {
  AckOutcome,
  ErrorCode,
  MicMode,
  MicState as MicStateName,
  MicStatePayload,
  PrecheckInvalidReason,
  PrecheckResultPayload,
  TvStage,
  Visibility,
  WakeLockState,
  WindowInvalidReason,
  WindowKind,
  WindowResultPayload,
  WireMessage,
} from '@atr/protocol';

export type MicSettingsWire = import('@atr/protocol').MicStatePayload['settings'];
export type MicSupportedWire = import('@atr/protocol').MicStatePayload['supported'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Message types the phone sends. */
export type OutboundType =
  | 'join.request'
  | 'auth.resume'
  | 'ping'
  | 'mic.state'
  | 'precheck.result'
  | 'level'
  | 'window.result'
  | 'listener.response'
  | 'cue'
  | 'phrases.update'
  | 'ack';
export type OutboundPayloads = Pick<PayloadMap, OutboundType>;

/** Message types the phone accepts (from the relay or, via the relay, from the TV). */
export type InboundType =
  | 'join.pending'
  | 'join.accepted'
  | 'join.rejected'
  | 'auth.ok'
  | 'peer.state'
  | 'unpaired'
  | 'pong'
  | 'error'
  | 'session.begin'
  | 'session.state'
  | 'precheck.start'
  | 'window.start'
  | 'window.stop'
  | 'window.cancel'
  | 'listener.open'
  | 'attempt.reveal'
  | 'session.end'
  | 'ack';
export type InboundMessage = MessageOf<InboundType>;

export type Ids = MessageIds;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface WireDeps {
  /** Epoch milliseconds. Default Date.now. */
  clock?: () => number;
  /** 16 random bytes per id. Default: the platform's cryptographic RNG. */
  randomBytes?: (length: number) => Uint8Array;
}

/** Types allowed before authentication (ADR-0003 section 1). */
const PRE_AUTH: ReadonlySet<OutboundType> = new Set<OutboundType>(['join.request', 'auth.resume', 'ping']);

/**
 * One producer: the phone role on one connection. Every message it builds is validated by the
 * package as a receiver would, so an invalid message is a thrown Error, never a sent frame.
 */
export class PhoneMessageFactory {
  private readonly inner: ProtocolMessageFactory;
  private authed = false;

  constructor(deps: WireDeps = {}) {
    this.inner = new ProtocolMessageFactory({
      role: 'phone',
      idFactory: createIdFactory(deps.randomBytes),
      clock: deps.clock ?? (() => Date.now()),
    });
  }

  get authenticated(): boolean {
    return this.authed;
  }

  /** A fresh connection: unauthenticated, generation 0, sequence 0, no room (join.request needs null). */
  beginConnection(): void {
    this.inner.setRoom(null);
    this.inner.setGeneration(0);
    this.inner.resetSequence();
    this.authed = false;
  }

  /** After `join.accepted` / `auth.ok`: authenticated with this room and generation; sequence restarts at 0. */
  setAuth(roomId: string, generation: number): void {
    this.inner.setRoom(roomId);
    this.inner.setGeneration(generation);
    this.inner.resetSequence();
    this.authed = true;
  }

  clearAuth(): void {
    this.beginConnection();
  }

  build<T extends OutboundType>(type: T, payload: OutboundPayloads[T], ids: Ids = {}): MessageOf<T> {
    if (!this.authed && !PRE_AUTH.has(type)) throw new Error(`cannot send ${type} before authentication`);
    return this.inner.next(type, payload as PayloadMap[T], ids);
  }

  /** JSON text of a built message, re-validated (size limit included). */
  serialize(message: WireMessage): string {
    return this.inner.serialize(message);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseResult = { ok: true; message: InboundMessage } | { ok: false; reason: string };

/** For each type: the sender roles that may legitimately reach a phone (from the catalogue's `->P` directions). */
const INBOUND_SENDERS: ReadonlyMap<string, ReadonlySet<Role>> = new Map(
  MESSAGE_TYPES.flatMap((type) => {
    const senders = new Set<Role>();
    for (const d of specFor(type).directions) {
      if (!d.endsWith('->P')) continue;
      senders.add(d.startsWith('T') ? 'tv' : d.startsWith('R') ? 'relay' : 'phone');
    }
    return senders.size > 0 ? [[type, senders] as const] : [];
  }),
);

/**
 * Parses one text frame from the relay: full package validation (envelope, identity binding,
 * room rule, payload schema, audio guard), then the phone-specific checks that the type is one a
 * phone may receive and that its sender role is a legitimate source for it.
 */
export function parseIncoming(text: string, now?: number): ParseResult {
  const parsed = parseWireMessage(text, now === undefined ? undefined : { now });
  if (!parsed.ok) return { ok: false, reason: `${parsed.code}: ${parsed.detail}` };
  const message = parsed.message;
  const senders = INBOUND_SENDERS.get(message.type);
  if (!senders) return { ok: false, reason: 'not_for_phone' };
  if (!senders.has(message.sender_role) || !isAllowedSender(message.type, message.sender_role)) {
    return { ok: false, reason: 'bad_sender_role' };
  }
  return { ok: true, message: message as InboundMessage };
}

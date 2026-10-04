/**
 * Wire boundary for the TV session core: a thin wrapper over @atr/protocol.
 *
 *   - parseInbound(raw, now) : validate a frame or object with the shared validators, then apply the
 *                              TV's direction rule (only phone- and relay-originated messages are accepted)
 *   - Outbox                 : MessageFactory (role 'tv') plus the TV's identity mapping
 *
 * Nothing else in session-core builds or inspects raw envelopes. Inbound messages are the protocol's own
 * `WireMessage` union (snake_case fields); outbound messages are described by the small `Outbound` union
 * below (camelCase `ids`, protocol payloads) and turned into envelopes by the Outbox.
 */

import { MessageFactory, isAllowedSender, parseWireMessage, specFor, validateMessageObject } from '@atr/protocol';
import type {
  IdFactory,
  MessageIds,
  MessageOf,
  MessageType,
  PayloadMap,
  WireMessage,
} from '@atr/protocol';

export type {
  AckOutcome,
  LevelPayload,
  MessageOf,
  MicMode,
  MicState as MicStateName,
  MicStatePayload,
  PrecheckInvalidReason,
  PrecheckResultPayload,
  WindowInvalidReason,
  WindowKind,
  WindowResultPayload,
  WireMessage as Inbound,
} from '@atr/protocol';

export interface Ids {
  sessionId?: string | null;
  windowId?: string | null;
  attemptId?: string | null;
}

/** Message types the TV sends. */
export type TvMessageType =
  | 'room.create'
  | 'auth.resume'
  | 'pairing.refresh'
  | 'join.confirm'
  | 'unpair'
  | 'room.close'
  | 'ping'
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

export type Outbound = {
  [K in TvMessageType]: { type: K; ids?: Ids; payload: PayloadMap[K] };
}[TvMessageType];

export type ParseResult =
  | { ok: true; message: WireMessage }
  | { ok: false; code: string; detail: string };

/**
 * Validates one inbound message with @atr/protocol (text frames and already-decoded objects), using the
 * TV clock for the timestamp sanity check, then keeps only messages the TV may receive: sent by the phone
 * (forwarded to the TV) or originated by the relay for the TV.
 */
export function parseInbound(raw: unknown, now: number): ParseResult {
  const result = typeof raw === 'string' ? parseWireMessage(raw, { now }) : validateMessageObject(raw, { now });
  if (!result.ok) return { ok: false, code: result.code, detail: result.detail };
  const m = result.message;
  const role = m.sender_role;
  if (role === 'tv' || !isAllowedSender(m.type, role)) return { ok: false, code: 'forbidden_direction', detail: 'sender role' };
  const spec = specFor(m.type);
  const toTv = role === 'phone' ? spec.directions.includes('P->T') : spec.directions.includes('R->T');
  if (!toTv) return { ok: false, code: 'forbidden_direction', detail: 'not for the TV' };
  return { ok: true, message: m };
}

/** Stamps and serializes TV messages. Room and generation come from room.created / auth.ok. */
export class Outbox {
  private readonly factory: MessageFactory;

  constructor(options: { idFactory: IdFactory; clock: () => number }) {
    this.factory = new MessageFactory({ role: 'tv', idFactory: options.idFactory, clock: options.clock });
  }

  /** Bind the room and authenticated generation (restarts the sequence when either changes). */
  bind(roomId: string | null, generation: number): void {
    this.factory.setRoom(roomId);
    this.factory.setGeneration(generation);
  }

  /** Throws only if the message would be invalid (a programming error, surfaced by the store as a counter). */
  encode(message: Outbound): string {
    const ids: MessageIds = {};
    if ('ids' in message && message.ids) {
      ids.session_id = message.ids.sessionId ?? null;
      ids.window_id = message.ids.windowId ?? null;
      ids.attempt_id = message.ids.attemptId ?? null;
    }
    if (message.type === 'room.create') ids.room_id = null;
    if (message.type === 'auth.resume') ids.room_id = message.payload.room_id;
    const next = this.factory.next.bind(this.factory) as (type: MessageType, payload: unknown, ids: MessageIds) => WireMessage;
    const built = next(message.type, message.payload, ids);
    return this.factory.serialize(built);
  }
}


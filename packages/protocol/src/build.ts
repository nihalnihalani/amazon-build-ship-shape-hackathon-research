/**
 * MessageFactory: builds envelopes for one producer (one role on one
 * connection). It fills the envelope, runs the sequence counter and validates
 * every message with `validateMessageObject`; a builder never emits an invalid
 * message, it throws a descriptive Error instead (the error text contains only
 * the validator's static detail, never payload content).
 */

import { isAllowedSender, specFor } from './catalogue.js';
import { MAX_GENERATION, MAX_SEQUENCE, PROTOCOL_VERSION, ROLES, ROOM_ID_RE } from './constants.js';
import type { IdFactory } from './ids.js';
import { parseWireMessage, validateMessageObject } from './validate.js';
import type { MessageIds, MessageOf, MessageType, PayloadMap, Role, WireMessage } from './types.js';

export interface MessageFactoryOptions {
  role: Role;
  idFactory: IdFactory;
  /** Epoch milliseconds on the sender's clock; fractional values are truncated. */
  clock: () => number;
  roomId?: string | null;
  /** Producer generation for authenticated messages. Default 0 (pre-auth). */
  generation?: number;
}

function checkGeneration(generation: number): void {
  if (!Number.isInteger(generation) || generation < 0 || generation > MAX_GENERATION) {
    throw new RangeError('generation must be an integer in 0..2^31-1');
  }
}

function checkRoom(roomId: string | null): void {
  if (roomId !== null && !ROOM_ID_RE.test(roomId)) throw new RangeError('roomId has a bad format');
}

export class MessageFactory {
  readonly role: Role;
  private readonly idFactory: IdFactory;
  private readonly clock: () => number;
  private room: string | null;
  private gen: number;
  private seq = 0;

  constructor(options: MessageFactoryOptions) {
    if (!(ROLES as readonly string[]).includes(options.role)) throw new RangeError('unknown role');
    const generation = options.generation ?? 0;
    const roomId = options.roomId ?? null;
    checkGeneration(generation);
    checkRoom(roomId);
    this.role = options.role;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.room = roomId;
    this.gen = generation;
  }

  get roomId(): string | null {
    return this.room;
  }

  get generation(): number {
    return this.gen;
  }

  /** Sequence number the next message will carry. */
  get nextSequence(): number {
    return this.seq;
  }

  /** Set the room for subsequent envelopes. Changing to a different room restarts the sequence at 0. */
  setRoom(roomId: string | null): void {
    checkRoom(roomId);
    if (roomId !== this.room) this.seq = 0;
    this.room = roomId;
  }

  /**
   * Set the producer generation (from `room.created`, `join.accepted` or `auth.ok`;
   * use 0 for a fresh connection before authentication). A different generation
   * restarts the sequence at 0; setting the same generation again keeps the counter.
   */
  setGeneration(generation: number): void {
    checkGeneration(generation);
    if (generation !== this.gen) this.seq = 0;
    this.gen = generation;
  }

  /** Restart the sequence at 0 without changing generation or room. */
  resetSequence(): void {
    this.seq = 0;
  }

  /**
   * Build, validate and number the next message. Pre-auth types and the relay role
   * always carry generation 0. Throws if this role may not send the type, or if the
   * resulting message is invalid for any reason (the sequence number is then not consumed).
   */
  next<T extends MessageType>(type: T, payload: PayloadMap[T], ids: MessageIds = {}): MessageOf<T> {
    if (!isAllowedSender(type, this.role)) {
      throw new Error(`MessageFactory: role ${this.role} may not send ${type}`);
    }
    if (this.seq > MAX_SEQUENCE) throw new RangeError('MessageFactory: sequence exhausted');
    const spec = specFor(type);
    const timestamp = Math.trunc(this.clock());
    if (!Number.isFinite(timestamp)) throw new RangeError('MessageFactory: clock() returned a non-finite value');
    const candidate = {
      protocol_version: PROTOCOL_VERSION,
      type,
      message_id: this.idFactory.message(),
      room_id: ids.room_id !== undefined ? ids.room_id : this.room,
      session_id: ids.session_id ?? null,
      window_id: ids.window_id ?? null,
      attempt_id: ids.attempt_id ?? null,
      sender_role: this.role,
      producer_generation: this.role === 'relay' || spec.generation === 'zero' ? 0 : this.gen,
      sequence: this.seq,
      event_timestamp: timestamp,
      payload,
    };
    const result = validateMessageObject(candidate, { now: timestamp });
    if (!result.ok) {
      throw new Error(`MessageFactory: built an invalid ${type} message (${result.code}: ${result.detail})`);
    }
    this.seq += 1;
    return result.message as MessageOf<T>;
  }

  /**
   * JSON text of a message, re-validated as a receiver would (size limit included).
   * Throws if the message is invalid, oversized or was built for a different role.
   */
  serialize(message: WireMessage): string {
    if (message.sender_role !== this.role) {
      throw new Error(`MessageFactory: message sender_role ${String(message.sender_role)} differs from ${this.role}`);
    }
    const text = JSON.stringify(message);
    const result = parseWireMessage(text, { now: Math.trunc(this.clock()) });
    if (!result.ok) {
      throw new Error(`MessageFactory: refusing to serialize an invalid message (${result.code}: ${result.detail})`);
    }
    return text;
  }
}

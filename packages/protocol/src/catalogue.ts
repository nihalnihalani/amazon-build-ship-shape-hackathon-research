/**
 * Message catalogue: who may send each message type, where the relay forwards
 * it, when it is allowed (authentication phase) and which identity fields are
 * bound. Mirrors docs/PROTOCOL.md section 3 (a test parses the document and
 * compares). Pure data plus three lookups; no connection state.
 */

import { MESSAGE_TYPES } from './types.js';
import type { MessageType, Role } from './types.js';

/** Wire direction. T = tv, P = phone, R = relay. `T->P` means TV to phone via the relay. */
export type Direction = 'T->R' | 'P->R' | 'T->P' | 'P->T' | 'R->T' | 'R->P';

/**
 * Authentication phase (PROTOCOL.md section 3 "auth" column).
 * - `pre`: allowed before authentication (and also afterwards is not required).
 * - `auth`: requires an authenticated connection.
 * - `pre_or_auth`: allowed in either phase (`ping`).
 * - `relay_origin`: the relay originates it ("-" in the document).
 */
export type AuthRule = 'pre' | 'auth' | 'pre_or_auth' | 'relay_origin';

/** `required`: must be non-null. `null`: must be null. `optional`: either. */
export type FieldRule = 'required' | 'null' | 'optional';

export interface IdentityRules {
  session: FieldRule;
  window: FieldRule;
  attempt: FieldRule;
}

export interface MessageSpec {
  type: MessageType;
  /** Roles that may put this type in `sender_role`. */
  senders: readonly Role[];
  /** Wire directions (PROTOCOL.md "dir" column). */
  directions: readonly Direction[];
  /**
   * Where the relay forwards the validated message. `null` means the relay
   * consumes it or originates it. `peer` means the other client role (ack only).
   */
  forwardTo: 'tv' | 'phone' | 'peer' | null;
  auth: AuthRule;
  /** Session, window and attempt binding (document columns S, W, A). */
  identity: IdentityRules;
  /**
   * Envelope `room_id` rule. NOT tabulated in PROTOCOL.md: derived from section 1
   * ("null only for pre-auth types and relay replies before a room exists"); see README.
   * Where the payload also carries `room_id`, a non-null envelope value must equal it.
   */
  room: FieldRule;
  /** `zero`: `producer_generation` must be 0 (pre-auth and relay-originated messages). */
  generation: 'zero' | 'any';
}

const FIELD: Record<string, FieldRule> = { R: 'required', '-': 'null', O: 'optional' };

const SENDER: Record<string, Role> = { T: 'tv', P: 'phone', R: 'relay' };

/** `swa`: three characters (session, window, attempt): R required, - null, O optional. */
function def(
  type: MessageType,
  directions: readonly Direction[],
  auth: AuthRule,
  swa: string,
  room: FieldRule,
): MessageSpec {
  const senders: Role[] = [];
  let toPhone = false;
  let toTv = false;
  for (const d of directions) {
    const role = SENDER[d.charAt(0)] as Role;
    if (!senders.includes(role)) senders.push(role);
    if (d === 'T->P') toPhone = true;
    if (d === 'P->T') toTv = true;
  }
  const forwardTo = toPhone && toTv ? 'peer' : toPhone ? 'phone' : toTv ? 'tv' : null;
  return {
    type,
    senders,
    directions,
    forwardTo,
    auth,
    identity: {
      session: FIELD[swa.charAt(0)] as FieldRule,
      window: FIELD[swa.charAt(1)] as FieldRule,
      attempt: FIELD[swa.charAt(2)] as FieldRule,
    },
    room,
    generation: auth === 'pre' || auth === 'relay_origin' ? 'zero' : 'any',
  };
}

const T2R: readonly Direction[] = ['T->R'];
const P2R: readonly Direction[] = ['P->R'];
const T2P: readonly Direction[] = ['T->P'];
const P2T: readonly Direction[] = ['P->T'];
const R2T: readonly Direction[] = ['R->T'];
const R2P: readonly Direction[] = ['R->P'];
const R2TP: readonly Direction[] = ['R->T', 'R->P'];
const ANY2R: readonly Direction[] = ['T->R', 'P->R'];

const specs: Record<MessageType, MessageSpec> = {
  // 3.1 Connection, pairing and lifecycle
  'room.create': def('room.create', T2R, 'pre', '---', 'null'),
  'room.created': def('room.created', R2T, 'relay_origin', '---', 'required'),
  'pairing.refresh': def('pairing.refresh', T2R, 'auth', '---', 'required'),
  'pairing.code': def('pairing.code', R2T, 'relay_origin', '---', 'required'),
  'join.request': def('join.request', P2R, 'pre', '---', 'null'),
  'join.pending': def('join.pending', R2P, 'relay_origin', '---', 'null'),
  'join.requested': def('join.requested', R2T, 'relay_origin', '---', 'required'),
  'join.confirm': def('join.confirm', T2R, 'auth', '---', 'required'),
  'join.accepted': def('join.accepted', R2P, 'relay_origin', '---', 'required'),
  'join.rejected': def('join.rejected', R2P, 'relay_origin', '---', 'null'),
  'join.expired': def('join.expired', R2T, 'relay_origin', '---', 'required'),
  'auth.resume': def('auth.resume', ANY2R, 'pre', '---', 'optional'),
  'auth.ok': def('auth.ok', R2TP, 'relay_origin', '---', 'required'),
  'peer.state': def('peer.state', R2TP, 'relay_origin', '---', 'required'),
  unpair: def('unpair', T2R, 'auth', '---', 'required'),
  unpaired: def('unpaired', R2P, 'relay_origin', '---', 'required'),
  'room.close': def('room.close', T2R, 'auth', '---', 'required'),
  ping: def('ping', ANY2R, 'pre_or_auth', '---', 'optional'),
  pong: def('pong', R2TP, 'relay_origin', '---', 'optional'),
  error: def('error', R2TP, 'relay_origin', '---', 'optional'),

  // 3.2 Session commands (TV to phone)
  'session.begin': def('session.begin', T2P, 'auth', 'R--', 'required'),
  'session.state': def('session.state', T2P, 'auth', 'R--', 'required'),
  'precheck.start': def('precheck.start', T2P, 'auth', 'RRR', 'required'),
  'window.start': def('window.start', T2P, 'auth', 'RRR', 'required'),
  'window.stop': def('window.stop', T2P, 'auth', 'RRR', 'required'),
  'window.cancel': def('window.cancel', T2P, 'auth', 'RRR', 'required'),
  'listener.open': def('listener.open', T2P, 'auth', 'RRR', 'required'),
  'attempt.reveal': def('attempt.reveal', T2P, 'auth', 'RRR', 'required'),
  'session.end': def('session.end', T2P, 'auth', 'R--', 'required'),

  // 3.3 Phone observations (phone to TV)
  'mic.state': def('mic.state', P2T, 'auth', 'O--', 'required'),
  'precheck.result': def('precheck.result', P2T, 'auth', 'RRR', 'required'),
  level: def('level', P2T, 'auth', 'RRR', 'required'),
  'window.result': def('window.result', P2T, 'auth', 'RRR', 'required'),
  'listener.response': def('listener.response', P2T, 'auth', 'RRR', 'required'),
  cue: def('cue', P2T, 'auth', 'R--', 'required'),
  'phrases.update': def('phrases.update', P2T, 'auth', '---', 'required'),
  ack: def('ack', ['T->P', 'P->T'], 'auth', 'OOO', 'required'),
};

/** Catalogue entry for a message type. Throws only for a type outside MessageType (programming error). */
export function specFor(type: MessageType): MessageSpec {
  const spec = specs[type];
  if (!spec) throw new Error('unknown message type');
  return spec;
}

/** Read-only view of the whole catalogue, in MESSAGE_TYPES order. */
export const CATALOGUE: readonly MessageSpec[] = MESSAGE_TYPES.map((t) => specs[t]);

/**
 * True when `role` may use this type as `sender_role` (context-free direction check).
 * The relay additionally requires `role` to equal the authenticated connection's role.
 */
export function isAllowedSender(type: MessageType, role: Role): boolean {
  return specFor(type).senders.includes(role);
}

/**
 * The client role the relay forwards a message to, or `null` when the relay
 * consumes it or originates it. For `ack` (either client may send) pass the
 * sender: the target is the other client. Without a sender, `ack` returns `null`
 * so an unresolved forward can never be mistaken for a target.
 */
export function forwardTarget(type: MessageType, sender?: Role): 'tv' | 'phone' | null {
  const forward = specFor(type).forwardTo;
  if (forward === 'tv' || forward === 'phone') return forward;
  if (forward === 'peer') {
    if (sender === 'tv') return 'phone';
    if (sender === 'phone') return 'tv';
  }
  return null;
}

/** Message types a client may send before authentication. */
export function isPreAuthType(type: MessageType): boolean {
  const auth = specFor(type).auth;
  return auth === 'pre' || auth === 'pre_or_auth';
}

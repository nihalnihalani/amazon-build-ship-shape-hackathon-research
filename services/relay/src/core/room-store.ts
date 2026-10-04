import type {
  CodeRecord,
  ConnectionRecord,
  JoinRecord,
  JoinState,
  PeerRole,
  PhoneSlotClaim,
  RoomRecord,
} from './types.js';

export type ConnectionPatch = Partial<
  Pick<
    ConnectionRecord,
    'authenticated' | 'authDeadline' | 'roomId' | 'role' | 'generation' | 'joinId' | 'joinRoomId'
  >
>;
export type ConnectionCounter = 'unauthCount' | 'strikes' | 'rateStrikes' | 'joinFailures';

export type ClaimResult =
  | { ok: true; generation: number }
  | { ok: false; reason: 'occupied' | 'closed' | 'not_found' };

/**
 * Persistence port of the relay core. Every method is atomic with respect to itself (conditional where noted),
 * because the AWS adapter runs many concurrent Lambda invocations against the same table.
 *
 * Stored data is limited to routing metadata: ids, hashes, role slots, generations, sequences, expiry times and
 * counters. No message payloads, phrases, levels, device labels or responses are ever stored (ADR-0002).
 *
 * Expiry is always logical: methods take `now` and the core re-checks expiry on every message. Physical
 * deletion (DynamoDB TTL, MemoryRoomStore.purgeExpired) is cleanup only and never relied upon for revocation.
 */
export interface RoomStore {
  // ---- rooms and codes ----------------------------------------------------------------------
  /** Creates room and code. 'code_collision' when the code hash is already live; 'room_exists' on id collision. */
  createRoom(room: RoomRecord, code: CodeRecord, now: number): Promise<'ok' | 'code_collision' | 'room_exists'>;
  getRoom(roomId: string): Promise<RoomRecord | null>;
  /** Returns the code record even if logically expired; the core decides (so it can answer `expired`). */
  findRoomByCodeHash(codeHash: string): Promise<CodeRecord | null>;
  /** Replaces the room's current code (the old code stops resolving). */
  rotateCode(roomId: string, code: CodeRecord, now: number): Promise<'ok' | 'code_collision' | 'not_found' | 'closed'>;
  /** One use: deletes the code and clears the room's current code. */
  consumeCode(roomId: string, codeHash: string): Promise<void>;
  /** Marks the room closed and drops its code. Returns false when the room does not exist. */
  closeRoom(roomId: string, now: number): Promise<boolean>;
  setActiveSession(roomId: string, sessionId: string | null): Promise<void>;

  // ---- join requests ------------------------------------------------------------------------
  /** Fails with 'busy' when an unexpired pending join exists for the room. */
  createJoin(join: JoinRecord, now: number): Promise<'ok' | 'busy'>;
  getJoin(roomId: string): Promise<JoinRecord | null>;
  /** Conditional transition out of 'pending' (join id matches, not expired). Exactly one caller can win. */
  resolveJoin(
    roomId: string,
    joinId: string,
    state: Exclude<JoinState, 'pending'>,
    now: number,
  ): Promise<'ok' | 'not_found' | 'expired' | 'resolved'>;

  // ---- role slots ---------------------------------------------------------------------------
  /** Conditional: succeeds only when the phone slot is empty (or its credential has logically expired). */
  claimPhoneSlot(roomId: string, claim: PhoneSlotClaim, now: number): Promise<ClaimResult>;
  /** Clears the phone slot. Returns the connection that held it, or null when the room or slot did not exist. */
  revokePhone(roomId: string, now: number): Promise<{ previousConnId: string | null } | null>;
  /**
   * Resume: atomically increments the role's generation, resets its sequence, and makes `connId` the live
   * connection. Returns null when the slot is absent/expired or the room is closed.
   */
  bumpGeneration(
    roomId: string,
    role: PeerRole,
    connId: string,
    now: number,
  ): Promise<{ generation: number; previousConnId: string | null } | null>;
  /** Clears the slot's live connection only if it is still `connId`. Returns whether it was cleared. */
  detachConnection(roomId: string, role: PeerRole, connId: string, now: number): Promise<boolean>;

  // ---- connections --------------------------------------------------------------------------
  putConnection(record: ConnectionRecord, now: number): Promise<void>;
  getConnection(connId: string): Promise<ConnectionRecord | null>;
  /** Updates fields on an existing connection; returns false (and creates nothing) if it is gone. */
  patchConnection(connId: string, patch: ConnectionPatch): Promise<boolean>;
  /** Deletes and returns the connection (null if it was already gone). */
  deleteConnection(connId: string): Promise<ConnectionRecord | null>;
  touchConnection(connId: string, now: number): Promise<void>;
  bumpConnectionCounter(connId: string, field: ConnectionCounter): Promise<number>;
  /** Atomically increments and returns the per-connection relay sequence; null if the connection is gone. */
  nextRelaySequence(connId: string): Promise<number | null>;
  /** All live connections, for the idle/deadline sweep. May be expensive; used by onTick only. */
  listConnections(): Promise<ConnectionRecord[]>;

  // ---- per-message state --------------------------------------------------------------------
  /** Conditional: generation must equal the slot's current one and sequence must exceed the last accepted. */
  acceptSequence(
    roomId: string,
    role: PeerRole,
    generation: number,
    sequence: number,
  ): Promise<'ok' | 'replay' | 'stale'>;
  /** Conditional insert into the recent-id window (last 1024 ids in memory; time-bounded in DynamoDB). */
  recordMessageId(roomId: string, messageId: string, now: number): Promise<'new' | 'duplicate'>;
  /** Conditional per-session counter: 'limit' once `max` cues were already accepted. Stores no cue text. */
  consumeCue(roomId: string, sessionId: string, max: number, now: number): Promise<'ok' | 'limit'>;
  /** Fixed-window counter: atomically adds one and returns the new count for the window containing `now`. */
  incrementCounter(key: string, windowMs: number, now: number): Promise<number>;
  /** Count in the current window without incrementing. */
  getCounter(key: string, windowMs: number, now: number): Promise<number>;
  /** Physical cleanup of logically expired records. No-op where the platform does it (DynamoDB TTL). */
  purgeExpired(now: number): Promise<number>;
}

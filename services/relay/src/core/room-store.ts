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
    'authenticated' | 'authDeadline' | 'roomId' | 'role' | 'generation' | 'joinId' | 'joinRoomId' | 'epoch' | 'unauthHeld'
  >
>;
export type ConnectionCounter = 'unauthCount' | 'strikes' | 'rateStrikes' | 'joinFailures';

export type ClaimResult =
  | { ok: true; generation: number; epoch: number }
  | { ok: false; reason: 'occupied' | 'closed' | 'not_found' };

export type AcceptJoinResult =
  | { ok: true; generation: number; epoch: number }
  | { ok: false; reason: 'no_join' | 'resolved' | 'join_expired' | 'room_full' | 'closed' | 'room_expired' | 'code_gone' };

export interface AcceptJoinInput {
  roomId: string;
  joinId: string;
  /** The code hash the join was created with. */
  codeHash: string;
  claim: PhoneSlotClaim;
  now: number;
}

export interface ResumeInput {
  roomId: string;
  role: PeerRole;
  connId: string;
  presentedHash: string;
  nextHash: string;
  nextExpiresAt: number;
  now: number;
}

export interface GraceInput {
  roomId: string;
  role: PeerRole;
  connId: string;
  presentedHash: string;
  /** Hash of the next credential issued by the rotation that consumed `presentedHash`. */
  currentHash: string;
  windowMs: number;
  now: number;
}

export type ResumeResult =
  | { ok: true; generation: number; previousConnId: string | null; epoch: number; credExpiresAt: number }
  | { ok: false; reason: 'no_room' | 'closed' | 'room_expired' | 'no_slot' | 'cred_expired' | 'mismatch' | 'reused' };

/** Failure counter with a reset horizon, used for the exponential-delay rule (A3-03). */
export interface BackoffState {
  failures: number;
  lastFailureAt: number;
}

/**
 * Persistence port of the relay core. Every method is atomic with respect to itself (conditional where noted),
 * because the AWS adapter runs many concurrent Lambda invocations against the same table.
 *
 * Stored data is limited to routing metadata: ids, hashes, role slots, generations, sequences, expiry times and
 * counters. No message payloads, phrases, levels, device labels or responses are ever stored (ADR-0002).
 * Abuse-prevention counters are keyed by a keyed hash of the source address and hold counts only, with a
 * lifetime of at most one hour (A2-03).
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
  /**
   * Replaces the room's current code: the old code stops resolving at once and the room has exactly one live
   * code. With `refreshMinIntervalMs` (TV-initiated refresh) the call fails with 'too_soon' when the previous
   * TV-initiated refresh was more recent than that; relay-initiated rotations (burning a code) pass no option.
   */
  rotateCode(
    roomId: string,
    code: CodeRecord,
    now: number,
    opts?: { refreshMinIntervalMs?: number },
  ): Promise<'ok' | 'code_collision' | 'not_found' | 'closed' | 'too_soon'>;
  /** One use: deletes the code and clears the room's current code. */
  consumeCode(roomId: string, codeHash: string): Promise<void>;
  /** Marks the room closed and drops its code. Returns false when the room does not exist. */
  closeRoom(roomId: string, now: number): Promise<boolean>;
  setActiveSession(roomId: string, sessionId: string | null): Promise<void>;
  /**
   * Rooms that are not closed, not past their life, and either have a connection or had one within the idle-close
   * horizon (30 minutes). Used for the global live-room cap.
   */
  countLiveRooms(now: number): Promise<number>;

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
  /**
   * The phone claim: ONE atomic step (single conditional write or transaction) that requires all of: the pending
   * join of this room has this id and is unexpired, the room exists, is open and unexpired, the phone slot is
   * empty (or its credential expired), and the join's code is still the room's live code; and then marks the join
   * accepted, claims the slot and consumes the code. Either everything happens or nothing does.
   */
  acceptJoin(input: AcceptJoinInput): Promise<AcceptJoinResult>;

  // ---- role slots ---------------------------------------------------------------------------
  /** Conditional: succeeds only when the phone slot is empty (or its credential has logically expired). */
  claimPhoneSlot(roomId: string, claim: PhoneSlotClaim, now: number): Promise<ClaimResult>;
  /** Clears the phone slot and bumps its epoch. Returns the connection that held it, or null when the room did not exist. */
  revokePhone(roomId: string, now: number): Promise<{ previousConnId: string | null } | null>;
  /**
   * Resume with credential rotation (A3-07): ONE atomic step that requires the room open and unexpired, the role's
   * credential present, unexpired and equal to `presentedHash`; and then consumes it (a tombstone is kept so that
   * presenting it again is detected), installs `nextHash` valid until `nextExpiresAt`, increments the generation,
   * resets the sequence and makes `connId` the live connection. Returns 'reused' when the presented credential was
   * already consumed (a stolen or replayed credential), 'mismatch' for any other wrong credential.
   */
  resumeRole(input: ResumeInput): Promise<ResumeResult>;
  /**
   * One-step grace for a lost auth.ok: re-resume with the credential the last rotation consumed. ONE atomic step
   * that requires: that credential is the slot's previous one and was consumed less than `windowMs` ago, the issued
   * next credential (`currentHash`) has not been presented since, the credential has not expired, the room is open.
   * It then bumps the generation, resets the sequence and attaches `connId` WITHOUT rotating again, and spends the
   * grace (it works exactly once). Returns 'reused' when the grace does not apply.
   */
  resumeGrace(input: GraceInput): Promise<ResumeResult>;
  /** True when `credHash` is a credential of this room and role that rotation already consumed (and has not expired). */
  wasCredentialConsumed(roomId: string, role: PeerRole, credHash: string, now: number): Promise<boolean>;
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
  /**
   * Conditional insert into the recent-id window of (room, role) (last 1024 ids in memory; time-bounded in
   * DynamoDB). The core records an id before the later checks so that duplicate detection is atomic, and calls
   * `forgetMessageId` when the message is then rejected, so a rejected message never burns its id (PK-08).
   */
  recordMessageId(roomId: string, role: PeerRole, messageId: string, now: number): Promise<'new' | 'duplicate'>;
  forgetMessageId(roomId: string, role: PeerRole, messageId: string): Promise<void>;
  /** Conditional per-session counter: 'limit' once `max` cues were already accepted. Stores no cue text. */
  consumeCue(roomId: string, sessionId: string, max: number, now: number): Promise<'ok' | 'limit'>;
  /** Fixed-window counter: atomically adds one and returns the new count for the window containing `now`. */
  incrementCounter(key: string, windowMs: number, now: number): Promise<number>;
  /** Count in the current window without incrementing. */
  getCounter(key: string, windowMs: number, now: number): Promise<number>;
  /** Failure state of `key`; failures read as 0 once `resetAfterMs` has passed since the last failure. */
  getBackoffState(key: string, now: number, resetAfterMs: number): Promise<BackoffState>;
  /** Records one failure (restarting from 1 when the previous failure is older than `resetAfterMs`). */
  recordBackoffFailure(key: string, now: number, resetAfterMs: number): Promise<BackoffState>;
  /** Takes one concurrent-unauthenticated slot for a source; false when `max` are already held. */
  acquireUnauthSlot(sourceHash: string, max: number, now: number): Promise<boolean>;
  releaseUnauthSlot(sourceHash: string): Promise<void>;
  /** Physical cleanup of logically expired records. No-op where the platform does it (DynamoDB TTL). */
  purgeExpired(now: number): Promise<number>;
}

import type {
  AcceptJoinInput,
  AcceptJoinResult,
  BackoffState,
  ClaimResult,
  ConnectionCounter,
  ConnectionPatch,
  GraceInput,
  ResumeInput,
  ResumeResult,
  RoomStore,
} from './room-store.js';
import type {
  CodeRecord,
  ConnectionRecord,
  JoinRecord,
  JoinState,
  PeerRole,
  PhoneSlotClaim,
  RoomRecord,
  SlotRecord,
} from './types.js';
import { DedupeScopes, LIMITS, SequenceTracker } from './protocol-port.js';

const clone = <T>(v: T): T => structuredClone(v);

/** Grace after logical expiry before physical deletion of rooms, mirroring the DynamoDB TTL slack. */
const PURGE_GRACE_MS = 60 * 60 * 1000;

/**
 * In-memory RoomStore for the local relay and for tests. Every method body is synchronous, so each operation
 * is atomic with respect to the others (the JavaScript event loop never interleaves inside a method).
 * Records are cloned at the boundary, as a real database would.
 */
/** Pre-authentication ids remembered per connection: the 5 message budget bounds it, this is a hard stop. */
const PRE_AUTH_ID_CAP = 64;

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly codes = new Map<string, CodeRecord>();
  private readonly joins = new Map<string, JoinRecord>();
  private readonly connections = new Map<string, ConnectionRecord>();
  /** Recent message ids: one bounded window per (room, role), from the protocol package. */
  private readonly messageIds = new DedupeScopes(LIMITS.dedupeWindow);
  /** Pre-authentication message ids per connection (DEF-006); dropped with the connection, at most PRE_AUTH_ID_CAP each. */
  private readonly connectionIds = new Map<string, Set<string>>();
  /** Credentials consumed by rotation (hash -> owner and logical expiry): reuse detection. */
  private readonly consumed = new Map<string, { roomId: string; role: PeerRole; expMs: number }>();
  /** Per (room, role) replay tracker, recreated whenever the slot's generation changes. */
  private readonly trackers = new Map<string, SequenceTracker>();
  private readonly cues = new Map<string, number>();
  private readonly counters = new Map<string, { windowIndex: number; count: number }>();
  private readonly backoff = new Map<string, BackoffState>();
  private readonly unauth = new Map<string, number>();

  async createRoom(room: RoomRecord, code: CodeRecord, now: number): Promise<'ok' | 'code_collision' | 'room_exists'> {
    const existingCode = this.codes.get(code.codeHash);
    if (existingCode && existingCode.expiresAt > now) return 'code_collision';
    if (this.rooms.has(room.roomId)) return 'room_exists';
    this.codes.set(code.codeHash, clone(code));
    this.rooms.set(room.roomId, clone(room));
    return 'ok';
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    const r = this.rooms.get(roomId);
    return r ? clone(r) : null;
  }

  async findRoomByCodeHash(codeHash: string): Promise<CodeRecord | null> {
    const c = this.codes.get(codeHash);
    return c ? clone(c) : null;
  }

  async rotateCode(
    roomId: string,
    code: CodeRecord,
    now: number,
    opts?: { refreshMinIntervalMs?: number },
  ): Promise<'ok' | 'code_collision' | 'not_found' | 'closed' | 'too_soon'> {
    const room = this.rooms.get(roomId);
    if (!room) return 'not_found';
    if (room.closed) return 'closed';
    if (opts?.refreshMinIntervalMs !== undefined && room.lastRefresh > 0 && now - room.lastRefresh < opts.refreshMinIntervalMs) {
      return 'too_soon';
    }
    const existing = this.codes.get(code.codeHash);
    if (existing && existing.expiresAt > now) return 'code_collision';
    if (room.codeHash) this.codes.delete(room.codeHash);
    this.codes.set(code.codeHash, clone(code));
    room.codeHash = code.codeHash;
    if (opts?.refreshMinIntervalMs !== undefined) room.lastRefresh = now;
    return 'ok';
  }

  async consumeCode(roomId: string, codeHash: string): Promise<void> {
    const c = this.codes.get(codeHash);
    if (c && c.roomId === roomId) this.codes.delete(codeHash);
    const room = this.rooms.get(roomId);
    if (room && room.codeHash === codeHash) room.codeHash = null;
  }

  async closeRoom(roomId: string, now: number): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.closed = true;
    room.lastConnChange = now;
    room.tvEpoch += 1;
    room.phoneEpoch += 1;
    if (room.codeHash) this.codes.delete(room.codeHash);
    room.codeHash = null;
    return true;
  }

  async setActiveSession(roomId: string, sessionId: string | null): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) room.activeSessionId = sessionId;
  }

  async countLiveRooms(now: number): Promise<number> {
    let n = 0;
    for (const room of this.rooms.values()) {
      if (room.closed || room.expiresAt <= now) continue;
      const attached = room.tv.connId !== null || (room.phone?.connId ?? null) !== null;
      if (attached || room.lastConnChange + LIMITS.roomIdleCloseMs > now) n += 1;
    }
    return n;
  }

  async createJoin(join: JoinRecord, now: number): Promise<'ok' | 'busy'> {
    const existing = this.joins.get(join.roomId);
    if (existing && existing.state === 'pending' && existing.expiresAt > now) return 'busy';
    this.joins.set(join.roomId, clone(join));
    return 'ok';
  }

  async getJoin(roomId: string): Promise<JoinRecord | null> {
    const j = this.joins.get(roomId);
    return j ? clone(j) : null;
  }

  async resolveJoin(
    roomId: string,
    joinId: string,
    state: Exclude<JoinState, 'pending'>,
    now: number,
  ): Promise<'ok' | 'not_found' | 'expired' | 'resolved'> {
    const j = this.joins.get(roomId);
    if (!j || j.joinId !== joinId) return 'not_found';
    if (j.state !== 'pending') return 'resolved';
    if ((state === 'accepted' || state === 'rejected') && j.expiresAt <= now) {
      j.state = 'expired';
      return 'expired';
    }
    j.state = state;
    return 'ok';
  }

  async acceptJoin(input: AcceptJoinInput): Promise<AcceptJoinResult> {
    const { roomId, joinId, codeHash, claim, now } = input;
    const room = this.rooms.get(roomId);
    const join = this.joins.get(roomId);
    if (!join || join.joinId !== joinId) return { ok: false, reason: 'no_join' };
    if (join.state !== 'pending') return { ok: false, reason: 'resolved' };
    if (join.expiresAt <= now) return { ok: false, reason: 'join_expired' };
    if (!room) return { ok: false, reason: 'no_join' };
    if (room.closed) return { ok: false, reason: 'closed' };
    if (room.expiresAt <= now) return { ok: false, reason: 'room_expired' };
    if (room.phone && room.phone.credExpiresAt > now) return { ok: false, reason: 'room_full' };
    if (room.codeHash !== codeHash || !this.codes.has(codeHash)) return { ok: false, reason: 'code_gone' };
    // every condition holds: all effects together
    join.state = 'accepted';
    this.codes.delete(codeHash);
    room.codeHash = null;
    const generation = room.phoneGeneration + 1;
    room.phone = {
      credHash: claim.credHash,
      credExpiresAt: claim.credExpiresAt,
      generation,
      lastSeq: -1,
      connId: claim.connId,
      prevCredHash: null,
      prevAt: 0,
    };
    room.phoneGeneration = generation;
    room.phoneEpoch += 1;
    room.lastConnChange = now;
    this.trackers.delete(`${roomId}|phone`);
    return { ok: true, generation, epoch: room.phoneEpoch };
  }

  async claimPhoneSlot(roomId: string, claim: PhoneSlotClaim, now: number): Promise<ClaimResult> {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: 'not_found' };
    if (room.closed) return { ok: false, reason: 'closed' };
    if (room.phone && room.phone.credExpiresAt > now) return { ok: false, reason: 'occupied' };
    const generation = room.phoneGeneration + 1;
    const slot: SlotRecord = {
      credHash: claim.credHash,
      credExpiresAt: claim.credExpiresAt,
      generation,
      lastSeq: -1,
      connId: claim.connId,
      prevCredHash: null,
      prevAt: 0,
    };
    room.phone = slot;
    this.trackers.delete(`${roomId}|phone`);
    room.phoneGeneration = generation;
    room.phoneEpoch += 1;
    room.lastConnChange = now;
    return { ok: true, generation, epoch: room.phoneEpoch };
  }

  async revokePhone(roomId: string, now: number): Promise<{ previousConnId: string | null } | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const previousConnId = room.phone?.connId ?? null;
    room.phone = null;
    room.phoneEpoch += 1;
    room.lastConnChange = now;
    return { previousConnId };
  }

  async resumeRole(input: ResumeInput): Promise<ResumeResult> {
    const { roomId, role, connId, presentedHash, nextHash, nextExpiresAt, now } = input;
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: 'no_room' };
    if (room.closed) return { ok: false, reason: 'closed' };
    if (room.expiresAt <= now) return { ok: false, reason: 'room_expired' };
    const slot = role === 'tv' ? room.tv : room.phone;
    if (!slot) return { ok: false, reason: 'no_slot' };
    if (slot.credHash !== presentedHash) {
      return { ok: false, reason: (await this.wasCredentialConsumed(roomId, role, presentedHash, now)) ? 'reused' : 'mismatch' };
    }
    if (slot.credExpiresAt <= now) return { ok: false, reason: 'cred_expired' };
    // all conditions hold: all effects together
    this.consumed.set(presentedHash, { roomId, role, expMs: slot.credExpiresAt });
    const previousConnId = slot.connId;
    slot.generation += 1;
    slot.lastSeq = -1;
    slot.connId = connId;
    slot.credHash = nextHash;
    slot.credExpiresAt = nextExpiresAt;
    slot.prevCredHash = presentedHash; // one step of grace for a lost auth.ok
    slot.prevAt = now;
    this.trackers.delete(`${roomId}|${role}`);
    if (role === 'phone') room.phoneGeneration = Math.max(room.phoneGeneration, slot.generation);
    room.lastConnChange = now;
    return {
      ok: true,
      generation: slot.generation,
      previousConnId,
      epoch: role === 'tv' ? room.tvEpoch : room.phoneEpoch,
      credExpiresAt: nextExpiresAt,
    };
  }

  async resumeGrace(input: GraceInput): Promise<ResumeResult> {
    const { roomId, role, connId, presentedHash, currentHash, windowMs, now } = input;
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: 'no_room' };
    if (room.closed) return { ok: false, reason: 'closed' };
    if (room.expiresAt <= now) return { ok: false, reason: 'room_expired' };
    const slot = role === 'tv' ? room.tv : room.phone;
    if (!slot) return { ok: false, reason: 'no_slot' };
    if (slot.credExpiresAt <= now) return { ok: false, reason: 'cred_expired' };
    if (slot.prevCredHash !== presentedHash || slot.credHash !== currentHash || now - slot.prevAt >= windowMs) {
      return { ok: false, reason: 'reused' };
    }
    const previousConnId = slot.connId;
    slot.generation += 1;
    slot.lastSeq = -1;
    slot.connId = connId;
    slot.prevCredHash = null; // the grace works exactly once
    slot.prevAt = 0;
    this.trackers.delete(`${roomId}|${role}`);
    if (role === 'phone') room.phoneGeneration = Math.max(room.phoneGeneration, slot.generation);
    room.lastConnChange = now;
    return {
      ok: true,
      generation: slot.generation,
      previousConnId,
      epoch: role === 'tv' ? room.tvEpoch : room.phoneEpoch,
      credExpiresAt: slot.credExpiresAt,
    };
  }

  async wasCredentialConsumed(roomId: string, role: PeerRole, credHash: string, now: number): Promise<boolean> {
    const c = this.consumed.get(credHash);
    return !!c && c.roomId === roomId && c.role === role && c.expMs > now;
  }

  async detachConnection(roomId: string, role: PeerRole, connId: string, now: number): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const slot = role === 'tv' ? room.tv : room.phone;
    if (!slot || slot.connId !== connId) return false;
    slot.connId = null;
    room.lastConnChange = now;
    return true;
  }

  async putConnection(record: ConnectionRecord, _now: number): Promise<void> {
    this.connections.set(record.connId, clone(record));
  }

  async getConnection(connId: string): Promise<ConnectionRecord | null> {
    const c = this.connections.get(connId);
    return c ? clone(c) : null;
  }

  async patchConnection(connId: string, patch: ConnectionPatch): Promise<boolean> {
    const c = this.connections.get(connId);
    if (!c) return false;
    Object.assign(c, patch);
    return true;
  }

  async deleteConnection(connId: string): Promise<ConnectionRecord | null> {
    const c = this.connections.get(connId);
    if (!c) return null;
    this.connections.delete(connId);
    this.connectionIds.delete(connId);
    return clone(c);
  }

  async touchConnection(connId: string, now: number): Promise<void> {
    const c = this.connections.get(connId);
    if (c) c.lastSeen = now;
  }

  async bumpConnectionCounter(connId: string, field: ConnectionCounter): Promise<number> {
    const c = this.connections.get(connId);
    if (!c) return 0;
    c[field] += 1;
    return c[field];
  }

  async nextRelaySequence(connId: string): Promise<number | null> {
    const c = this.connections.get(connId);
    if (!c) return null;
    c.relaySeq += 1;
    return c.relaySeq;
  }

  async listConnections(): Promise<ConnectionRecord[]> {
    return [...this.connections.values()].map(clone);
  }

  async acceptSequence(
    roomId: string,
    role: PeerRole,
    generation: number,
    sequence: number,
  ): Promise<'ok' | 'replay' | 'stale'> {
    const room = this.rooms.get(roomId);
    const slot = room ? (role === 'tv' ? room.tv : room.phone) : null;
    if (!slot || slot.generation !== generation) return 'stale';
    const key = `${roomId}|${role}`;
    let tracker = this.trackers.get(key);
    if (!tracker) {
      tracker = new SequenceTracker();
      this.trackers.set(key, tracker);
    }
    // The authoritative generation is the slot's own, never the message's (PK-07).
    const verdict = tracker.accept(slot.generation, generation, sequence);
    if (verdict === 'ok') slot.lastSeq = sequence;
    return verdict;
  }

  async recordMessageId(roomId: string, role: PeerRole, messageId: string, _now: number): Promise<'new' | 'duplicate'> {
    if (this.messageIds.has(roomId, role, messageId)) return 'duplicate';
    this.messageIds.record(roomId, role, messageId);
    return 'new';
  }

  async forgetMessageId(roomId: string, role: PeerRole, messageId: string): Promise<void> {
    this.messageIds.scope(roomId, role).forget(messageId);
  }
  async recordConnectionMessageId(connId: string, messageId: string, _now: number): Promise<'new' | 'duplicate'> {
    let ids = this.connectionIds.get(connId);
    if (!ids) {
      ids = new Set();
      this.connectionIds.set(connId, ids);
    }
    if (ids.has(messageId)) return 'duplicate';
    ids.add(messageId);
    if (ids.size > PRE_AUTH_ID_CAP) {
      const oldest = ids.values().next().value as string;
      ids.delete(oldest);
    }
    return 'new';
  }

  async consumeCue(roomId: string, sessionId: string, max: number, _now: number): Promise<'ok' | 'limit'> {
    const key = `${roomId}|${sessionId}`;
    const n = this.cues.get(key) ?? 0;
    if (n >= max) return 'limit';
    this.cues.set(key, n + 1);
    return 'ok';
  }

  async incrementCounter(key: string, windowMs: number, now: number): Promise<number> {
    const windowIndex = Math.floor(now / windowMs);
    const k = `${windowMs}|${key}`;
    const e = this.counters.get(k);
    if (!e || e.windowIndex !== windowIndex) {
      this.counters.set(k, { windowIndex, count: 1 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }

  async getCounter(key: string, windowMs: number, now: number): Promise<number> {
    const e = this.counters.get(`${windowMs}|${key}`);
    return e && e.windowIndex === Math.floor(now / windowMs) ? e.count : 0;
  }

  async getBackoffState(key: string, now: number, resetAfterMs: number): Promise<BackoffState> {
    const s = this.backoff.get(key);
    if (!s || now - s.lastFailureAt >= resetAfterMs) return { failures: 0, lastFailureAt: 0 };
    return { ...s };
  }

  async recordBackoffFailure(key: string, now: number, resetAfterMs: number): Promise<BackoffState> {
    const s = this.backoff.get(key);
    const failures = s && now - s.lastFailureAt < resetAfterMs ? s.failures + 1 : 1;
    const next = { failures, lastFailureAt: now };
    this.backoff.set(key, next);
    return { ...next };
  }

  async acquireUnauthSlot(sourceHash: string, max: number, _now: number): Promise<boolean> {
    const n = this.unauth.get(sourceHash) ?? 0;
    if (n >= max) return false;
    this.unauth.set(sourceHash, n + 1);
    return true;
  }

  async releaseUnauthSlot(sourceHash: string): Promise<void> {
    const n = this.unauth.get(sourceHash) ?? 0;
    if (n <= 1) this.unauth.delete(sourceHash);
    else this.unauth.set(sourceHash, n - 1);
  }

  async purgeExpired(now: number): Promise<number> {
    let n = 0;
    for (const [id, room] of this.rooms) {
      if (room.expiresAt + PURGE_GRACE_MS <= now) {
        this.rooms.delete(id);
        this.joins.delete(id);
        this.messageIds.dropRoom(id);
        this.trackers.delete(`${id}|tv`);
        this.trackers.delete(`${id}|phone`);
        for (const k of this.cues.keys()) if (k.startsWith(`${id}|`)) this.cues.delete(k);
        n += 1;
      }
    }
    for (const [h, c] of this.codes) {
      if (c.expiresAt + PURGE_GRACE_MS <= now) {
        this.codes.delete(h);
        n += 1;
      }
    }
    for (const [id, j] of this.joins) {
      if (j.expiresAt + PURGE_GRACE_MS <= now) {
        this.joins.delete(id);
        n += 1;
      }
    }
    for (const [h, e] of this.consumed) {
      if (e.expMs + PURGE_GRACE_MS <= now) this.consumed.delete(h);
    }
    for (const [k, b] of this.backoff) {
      if (now - b.lastFailureAt >= 10 * 60_000) this.backoff.delete(k);
    }
    // Counters hold counts only and are useless after their window: removed at window end.
    for (const [k, e] of this.counters) {
      const windowMs = Number(k.slice(0, k.indexOf('|')));
      if ((e.windowIndex + 1) * windowMs <= now) {
        this.counters.delete(k);
        n += 1;
      }
    }
    return n;
  }

  /** Test/diagnostic helper: number of live connection records. */
  connectionCount(): number {
    return this.connections.size;
  }

  /** Test/diagnostic helper: number of live codes currently stored for a room. */
  codeCountForRoom(roomId: string): number {
    let n = 0;
    for (const c of this.codes.values()) if (c.roomId === roomId) n += 1;
    return n;
  }

  /** Test/diagnostic helper: every abuse-counter key currently held (to assert they are hashed). */
  counterKeys(): string[] {
    return [...this.counters.keys(), ...this.backoff.keys(), ...this.unauth.keys()];
  }
}

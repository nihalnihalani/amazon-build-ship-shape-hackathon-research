import type { ClaimResult, ConnectionCounter, ConnectionPatch, RoomStore } from './room-store.js';
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
import { LIMITS } from './protocol-port.js';

const clone = <T>(v: T): T => structuredClone(v);

/** Grace after logical expiry before physical deletion, mirroring the DynamoDB TTL slack. */
const PURGE_GRACE_MS = 60 * 60 * 1000;

/**
 * In-memory RoomStore for the local relay and for tests. Every method body is synchronous, so each operation
 * is atomic with respect to the others (the JavaScript event loop never interleaves inside a method).
 * Records are cloned at the boundary, as a real database would.
 */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly codes = new Map<string, CodeRecord>();
  private readonly joins = new Map<string, JoinRecord>();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly messageIds = new Map<string, Set<string>>();
  private readonly cues = new Map<string, number>();
  private readonly counters = new Map<string, { windowIndex: number; count: number }>();

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
  ): Promise<'ok' | 'code_collision' | 'not_found' | 'closed'> {
    const room = this.rooms.get(roomId);
    if (!room) return 'not_found';
    if (room.closed) return 'closed';
    const existing = this.codes.get(code.codeHash);
    if (existing && existing.expiresAt > now) return 'code_collision';
    if (room.codeHash) this.codes.delete(room.codeHash);
    this.codes.set(code.codeHash, clone(code));
    room.codeHash = code.codeHash;
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
    if (room.codeHash) this.codes.delete(room.codeHash);
    room.codeHash = null;
    return true;
  }

  async setActiveSession(roomId: string, sessionId: string | null): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) room.activeSessionId = sessionId;
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
    };
    room.phone = slot;
    room.phoneGeneration = generation;
    room.lastConnChange = now;
    return { ok: true, generation };
  }

  async revokePhone(roomId: string, now: number): Promise<{ previousConnId: string | null } | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const previousConnId = room.phone?.connId ?? null;
    room.phone = null;
    room.lastConnChange = now;
    return { previousConnId };
  }

  async bumpGeneration(
    roomId: string,
    role: PeerRole,
    connId: string,
    now: number,
  ): Promise<{ generation: number; previousConnId: string | null } | null> {
    const room = this.rooms.get(roomId);
    if (!room || room.closed || room.expiresAt <= now) return null;
    const slot = role === 'tv' ? room.tv : room.phone;
    if (!slot || slot.credExpiresAt <= now) return null;
    const previousConnId = slot.connId;
    slot.generation += 1;
    slot.lastSeq = -1;
    slot.connId = connId;
    if (role === 'phone') room.phoneGeneration = Math.max(room.phoneGeneration, slot.generation);
    room.lastConnChange = now;
    return { generation: slot.generation, previousConnId };
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
    if (sequence <= slot.lastSeq) return 'replay';
    slot.lastSeq = sequence;
    return 'ok';
  }

  async recordMessageId(roomId: string, messageId: string, _now: number): Promise<'new' | 'duplicate'> {
    let ids = this.messageIds.get(roomId);
    if (!ids) {
      ids = new Set();
      this.messageIds.set(roomId, ids);
    }
    if (ids.has(messageId)) return 'duplicate';
    ids.add(messageId);
    if (ids.size > LIMITS.dedupeWindow) {
      const oldest = ids.values().next();
      if (!oldest.done) ids.delete(oldest.value);
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

  async purgeExpired(now: number): Promise<number> {
    let n = 0;
    for (const [id, room] of this.rooms) {
      if (room.expiresAt + PURGE_GRACE_MS <= now) {
        this.rooms.delete(id);
        this.joins.delete(id);
        this.messageIds.delete(id);
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
    for (const [k, e] of this.counters) {
      const windowMs = Number(k.slice(0, k.indexOf('|')));
      if ((e.windowIndex + 1) * windowMs + PURGE_GRACE_MS <= now) {
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
}

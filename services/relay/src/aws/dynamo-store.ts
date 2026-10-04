/**
 * DynamoDB implementation of the RoomStore port (single table, PAY_PER_REQUEST).
 *
 * Table: partition key `pk` (S), sort key `sk` (S), TTL attribute `expires_at` (N, epoch SECONDS).
 *
 *   pk                         sk          holds
 *   ROOM#<room_id>             META        room, TV slot, phone slot, active session id, current code hash
 *   ROOM#<room_id>             JOIN        the single join request (id, phone connection, confirm digits, expiry, state)
 *   ROOM#<room_id>             CUE#<s_id>  per-session cue counter (a number, never cue text)
 *   CODE#<code_hash>           CODE        code -> room id and expiry
 *   CONN#<conn_id>             CONN        connection record (state machine fields and counters)
 *   MSG#<room_id>#<message_id> M           recent-message-id marker for duplicate detection
 *   CTR#<window_ms>#<key>#<n>  C           fixed-window counters (rate limits, failure limits)
 *
 * No message payload, phrase, level, cue text or device label is ever written (ADR-0002): only ids, hashes,
 * generations, sequence numbers, expiry times, counters and connection ids.
 *
 * Expiry is logical: every `*_ms` attribute is checked by the relay on every message. `expires_at` (TTL) is
 * physical cleanup only, set to at least one hour after the logical expiry; DynamoDB deletes lazily, typically
 * within days, so it must never be relied on for revocation.
 *
 * Every state transition is a single conditional write (ConditionExpression), so concurrent Lambda invocations
 * cannot both win a claim. All attribute names go through ExpressionAttributeNames placeholders, which also keeps
 * DynamoDB reserved words out of the expressions.
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { LIMITS } from '../core/protocol-port.js';
import type { ClaimResult, ConnectionCounter, ConnectionPatch, RoomStore } from '../core/room-store.js';
import type {
  CodeRecord,
  ConnectionRecord,
  JoinRecord,
  JoinState,
  PeerRole,
  PhoneSlotClaim,
  RoomRecord,
} from '../core/types.js';

/** The slice of the document client the store uses; tests inject a fake with the same shape. */
export interface DocClient {
  send(command: unknown): Promise<unknown>;
}

type Item = Record<string, unknown>;

const TTL_SLACK_S = 3600;
const CONNECTION_TTL_MS = 3 * 3_600_000; // API Gateway caps a connection at 2 hours
const MESSAGE_ID_WINDOW_MS = 60_000;

const ttl = (ms: number): number => Math.ceil(ms / 1000) + TTL_SLACK_S;

function isConditionFailure(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ConditionalCheckFailedException';
}

/** Collects ExpressionAttributeNames/Values so every attribute name is a placeholder. */
class Expr {
  private readonly names = new Map<string, string>();
  private readonly values = new Map<string, unknown>();
  /** Placeholder for an attribute name, e.g. `#a0`. */
  n(attr: string): string {
    let p = this.names.get(attr);
    if (!p) {
      p = `#a${this.names.size}`;
      this.names.set(attr, p);
    }
    return p;
  }
  /** Placeholder for a value, e.g. `:v0`. */
  v(value: unknown): string {
    const p = `:v${this.values.size}`;
    this.values.set(p, value);
    return p;
  }
  get ExpressionAttributeNames(): Record<string, string> {
    return Object.fromEntries([...this.names].map(([attr, ph]) => [ph, attr]));
  }
  get ExpressionAttributeValues(): Record<string, unknown> | undefined {
    return this.values.size === 0 ? undefined : Object.fromEntries(this.values);
  }
}

function withExpr(e: Expr): { ExpressionAttributeNames: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> } {
  const values = e.ExpressionAttributeValues;
  return values
    ? { ExpressionAttributeNames: e.ExpressionAttributeNames, ExpressionAttributeValues: values }
    : { ExpressionAttributeNames: e.ExpressionAttributeNames };
}

const roomKey = (roomId: string) => ({ pk: `ROOM#${roomId}`, sk: 'META' });
const joinKey = (roomId: string) => ({ pk: `ROOM#${roomId}`, sk: 'JOIN' });
const codeKey = (hash: string) => ({ pk: `CODE#${hash}`, sk: 'CODE' });
const connKey = (connId: string) => ({ pk: `CONN#${connId}`, sk: 'CONN' });

const SLOT_ATTRS = {
  tv: { cred: 'tv_cred_hash', exp: 'tv_cred_exp_ms', gen: 'tv_gen', seq: 'tv_last_seq', conn: 'tv_conn' },
  phone: { cred: 'phone_cred_hash', exp: 'phone_cred_exp_ms', gen: 'phone_gen', seq: 'phone_last_seq', conn: 'phone_conn' },
} as const;

function roomFromItem(i: Item): RoomRecord {
  const slot = (role: PeerRole) => {
    const a = SLOT_ATTRS[role];
    return {
      credHash: i[a.cred] as string,
      credExpiresAt: i[a.exp] as number,
      generation: i[a.gen] as number,
      lastSeq: i[a.seq] as number,
      connId: (i[a.conn] as string | undefined) ?? null,
    };
  };
  return {
    roomId: i.room_id as string,
    createdAt: i.created_ms as number,
    expiresAt: i.expires_ms as number,
    closed: i.closed as boolean,
    lastConnChange: i.last_conn_ms as number,
    codeHash: (i.code_hash as string | undefined) ?? null,
    activeSessionId: (i.active_session as string | undefined) ?? null,
    tv: slot('tv'),
    phone: i.phone_cred_hash === undefined ? null : slot('phone'),
    phoneGeneration: i.phone_gen as number,
  };
}

function roomToItem(r: RoomRecord): Item {
  const item: Item = {
    ...roomKey(r.roomId),
    room_id: r.roomId,
    created_ms: r.createdAt,
    expires_ms: r.expiresAt,
    closed: r.closed,
    last_conn_ms: r.lastConnChange,
    phone_gen: r.phoneGeneration,
    tv_cred_hash: r.tv.credHash,
    tv_cred_exp_ms: r.tv.credExpiresAt,
    tv_gen: r.tv.generation,
    tv_last_seq: r.tv.lastSeq,
    expires_at: ttl(r.expiresAt),
  };
  if (r.codeHash) item.code_hash = r.codeHash;
  if (r.activeSessionId) item.active_session = r.activeSessionId;
  if (r.tv.connId) item.tv_conn = r.tv.connId;
  if (r.phone) {
    item.phone_cred_hash = r.phone.credHash;
    item.phone_cred_exp_ms = r.phone.credExpiresAt;
    item.phone_last_seq = r.phone.lastSeq;
    if (r.phone.connId) item.phone_conn = r.phone.connId;
  }
  return item;
}

function connFromItem(i: Item): ConnectionRecord {
  return {
    connId: i.conn_id as string,
    connectedAt: i.connected_ms as number,
    lastSeen: i.last_seen_ms as number,
    authenticated: i.authenticated as boolean,
    authDeadline: i.auth_deadline_ms as number,
    unauthCount: i.unauth_count as number,
    strikes: i.strikes as number,
    rateStrikes: i.rate_strikes as number,
    joinFailures: i.join_failures as number,
    relaySeq: i.relay_seq as number,
    originState: i.origin_state as 'allowed' | 'missing',
    sourceHash: i.source_hash as string,
    roomId: (i.room_id as string | undefined) ?? null,
    role: (i.role as PeerRole | undefined) ?? null,
    generation: i.generation as number,
    joinId: (i.join_id as string | undefined) ?? null,
    joinRoomId: (i.join_room_id as string | undefined) ?? null,
  };
}

const CONN_PATCH_ATTRS: Record<keyof ConnectionPatch, string> = {
  authenticated: 'authenticated',
  authDeadline: 'auth_deadline_ms',
  roomId: 'room_id',
  role: 'role',
  generation: 'generation',
  joinId: 'join_id',
  joinRoomId: 'join_room_id',
};

const COUNTER_ATTRS: Record<ConnectionCounter, string> = {
  unauthCount: 'unauth_count',
  strikes: 'strikes',
  rateStrikes: 'rate_strikes',
  joinFailures: 'join_failures',
};

export class DynamoDbRoomStore implements RoomStore {
  constructor(
    private readonly client: DocClient | DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName) throw new Error('DynamoDbRoomStore requires a table name');
  }

  private send<T = Item>(command: unknown): Promise<T> {
    return (this.client as DocClient).send(command) as Promise<T>;
  }

  private async get(key: Record<string, string>): Promise<Item | null> {
    const r = await this.send<{ Item?: Item }>(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
    return r.Item ?? null;
  }

  /** Runs a conditional command; returns undefined when the condition failed. */
  private async conditional<T>(command: unknown): Promise<T | undefined> {
    try {
      return await this.send<T>(command);
    } catch (e) {
      if (isConditionFailure(e)) return undefined;
      throw e;
    }
  }

  // ---- rooms and codes --------------------------------------------------------------------

  async createRoom(room: RoomRecord, code: CodeRecord, now: number): Promise<'ok' | 'code_collision' | 'room_exists'> {
    const ce = new Expr();
    const codeOk = await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...codeKey(code.codeHash),
          room_id: code.roomId,
          code_exp_ms: code.expiresAt,
          expires_at: ttl(code.expiresAt),
        },
        ConditionExpression: `attribute_not_exists(${ce.n('pk')}) OR ${ce.n('code_exp_ms')} <= ${ce.v(now)}`,
        ...withExpr(ce),
      }),
    );
    if (codeOk === undefined) return 'code_collision';
    const re = new Expr();
    const roomOk = await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: roomToItem(room),
        ConditionExpression: `attribute_not_exists(${re.n('pk')})`,
        ...withExpr(re),
      }),
    );
    if (roomOk === undefined) {
      // Remove the code we just wrote (only if it still points at this room).
      const de = new Expr();
      await this.conditional(
        new DeleteCommand({
          TableName: this.tableName,
          Key: codeKey(code.codeHash),
          ConditionExpression: `${de.n('room_id')} = ${de.v(code.roomId)}`,
          ...withExpr(de),
        }),
      );
      return 'room_exists';
    }
    return 'ok';
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    const i = await this.get(roomKey(roomId));
    return i ? roomFromItem(i) : null;
  }

  async findRoomByCodeHash(codeHash: string): Promise<CodeRecord | null> {
    const i = await this.get(codeKey(codeHash));
    return i ? { codeHash, roomId: i.room_id as string, expiresAt: i.code_exp_ms as number } : null;
  }

  async rotateCode(
    roomId: string,
    code: CodeRecord,
    now: number,
  ): Promise<'ok' | 'code_collision' | 'not_found' | 'closed'> {
    const ce = new Expr();
    const put = await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...codeKey(code.codeHash),
          room_id: roomId,
          code_exp_ms: code.expiresAt,
          expires_at: ttl(code.expiresAt),
        },
        ConditionExpression: `attribute_not_exists(${ce.n('pk')}) OR ${ce.n('code_exp_ms')} <= ${ce.v(now)}`,
        ...withExpr(ce),
      }),
    );
    if (put === undefined) return 'code_collision';
    const ue = new Expr();
    const upd = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: `SET ${ue.n('code_hash')} = ${ue.v(code.codeHash)}`,
        ConditionExpression: `attribute_exists(${ue.n('pk')}) AND ${ue.n('closed')} = ${ue.v(false)}`,
        ReturnValues: 'ALL_OLD',
        ...withExpr(ue),
      }),
    );
    if (upd === undefined) {
      const de = new Expr();
      await this.conditional(
        new DeleteCommand({
          TableName: this.tableName,
          Key: codeKey(code.codeHash),
          ConditionExpression: `${de.n('room_id')} = ${de.v(roomId)}`,
          ...withExpr(de),
        }),
      );
      const room = await this.get(roomKey(roomId));
      return room ? 'closed' : 'not_found';
    }
    const old = upd.Attributes?.code_hash;
    if (typeof old === 'string' && old !== code.codeHash) await this.deleteCodeItem(roomId, old);
    return 'ok';
  }

  private async deleteCodeItem(roomId: string, codeHash: string): Promise<void> {
    const de = new Expr();
    await this.conditional(
      new DeleteCommand({
        TableName: this.tableName,
        Key: codeKey(codeHash),
        ConditionExpression: `${de.n('room_id')} = ${de.v(roomId)}`,
        ...withExpr(de),
      }),
    );
  }

  async consumeCode(roomId: string, codeHash: string): Promise<void> {
    await this.deleteCodeItem(roomId, codeHash);
    const e = new Expr();
    await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: `REMOVE ${e.n('code_hash')}`,
        ConditionExpression: `${e.n('code_hash')} = ${e.v(codeHash)}`,
        ...withExpr(e),
      }),
    );
  }

  async closeRoom(roomId: string, now: number): Promise<boolean> {
    const e = new Expr();
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: `SET ${e.n('closed')} = ${e.v(true)}, ${e.n('last_conn_ms')} = ${e.v(now)} REMOVE ${e.n('code_hash')}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ReturnValues: 'ALL_OLD',
        ...withExpr(e),
      }),
    );
    if (r === undefined) return false;
    const old = r.Attributes?.code_hash;
    if (typeof old === 'string') await this.deleteCodeItem(roomId, old);
    return true;
  }

  async setActiveSession(roomId: string, sessionId: string | null): Promise<void> {
    const e = new Expr();
    const attr = e.n('active_session');
    await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: sessionId === null ? `REMOVE ${attr}` : `SET ${attr} = ${e.v(sessionId)}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ...withExpr(e),
      }),
    );
  }

  // ---- join requests ----------------------------------------------------------------------

  async createJoin(join: JoinRecord, now: number): Promise<'ok' | 'busy'> {
    const e = new Expr();
    const r = await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...joinKey(join.roomId),
          join_id: join.joinId,
          phone_conn: join.phoneConnId,
          confirm_digits: join.confirmDigits,
          join_exp_ms: join.expiresAt,
          state: join.state,
          expires_at: ttl(join.expiresAt),
        },
        ConditionExpression:
          `attribute_not_exists(${e.n('pk')}) OR ${e.n('state')} <> ${e.v('pending')} OR ${e.n('join_exp_ms')} <= ${e.v(now)}`,
        ...withExpr(e),
      }),
    );
    return r === undefined ? 'busy' : 'ok';
  }

  async getJoin(roomId: string): Promise<JoinRecord | null> {
    const i = await this.get(joinKey(roomId));
    if (!i) return null;
    return {
      roomId,
      joinId: i.join_id as string,
      phoneConnId: i.phone_conn as string,
      confirmDigits: i.confirm_digits as string,
      expiresAt: i.join_exp_ms as number,
      state: i.state as JoinState,
    };
  }

  async resolveJoin(
    roomId: string,
    joinId: string,
    state: Exclude<JoinState, 'pending'>,
    now: number,
  ): Promise<'ok' | 'not_found' | 'expired' | 'resolved'> {
    const expiryMatters = state === 'accepted' || state === 'rejected';
    const e = new Expr();
    const cond =
      `${e.n('join_id')} = ${e.v(joinId)} AND ${e.n('state')} = ${e.v('pending')}` +
      (expiryMatters ? ` AND ${e.n('join_exp_ms')} > ${e.v(now)}` : '');
    const r = await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: joinKey(roomId),
        UpdateExpression: `SET ${e.n('state')} = ${e.v(state)}`,
        ConditionExpression: cond,
        ...withExpr(e),
      }),
    );
    if (r !== undefined) return 'ok';
    const cur = await this.get(joinKey(roomId));
    if (!cur || cur.join_id !== joinId) return 'not_found';
    if (cur.state !== 'pending') return 'resolved';
    // pending but past its expiry: mark it expired so it stops being "pending"
    const m = new Expr();
    await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: joinKey(roomId),
        UpdateExpression: `SET ${m.n('state')} = ${m.v('expired')}`,
        ConditionExpression: `${m.n('join_id')} = ${m.v(joinId)} AND ${m.n('state')} = ${m.v('pending')}`,
        ...withExpr(m),
      }),
    );
    return 'expired';
  }

  // ---- role slots -------------------------------------------------------------------------

  async claimPhoneSlot(roomId: string, claim: PhoneSlotClaim, now: number): Promise<ClaimResult> {
    const e = new Expr();
    const a = SLOT_ATTRS.phone;
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression:
          `SET ${e.n(a.cred)} = ${e.v(claim.credHash)}, ${e.n(a.exp)} = ${e.v(claim.credExpiresAt)}, ` +
          `${e.n(a.conn)} = ${e.v(claim.connId)}, ${e.n(a.seq)} = ${e.v(-1)}, ` +
          `${e.n(a.gen)} = if_not_exists(${e.n(a.gen)}, ${e.v(0)}) + ${e.v(1)}, ${e.n('last_conn_ms')} = ${e.v(now)}`,
        ConditionExpression:
          `attribute_exists(${e.n('pk')}) AND ${e.n('closed')} = ${e.v(false)} AND ` +
          `(attribute_not_exists(${e.n(a.cred)}) OR ${e.n(a.exp)} <= ${e.v(now)})`,
        ReturnValues: 'ALL_NEW',
        ...withExpr(e),
      }),
    );
    if (r !== undefined) return { ok: true, generation: r.Attributes?.[a.gen] as number };
    const room = await this.get(roomKey(roomId));
    if (!room) return { ok: false, reason: 'not_found' };
    if (room.closed === true) return { ok: false, reason: 'closed' };
    return { ok: false, reason: 'occupied' };
  }

  async revokePhone(roomId: string, now: number): Promise<{ previousConnId: string | null } | null> {
    const e = new Expr();
    const a = SLOT_ATTRS.phone;
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression:
          `SET ${e.n('last_conn_ms')} = ${e.v(now)} REMOVE ${e.n(a.cred)}, ${e.n(a.exp)}, ${e.n(a.conn)}, ${e.n(a.seq)}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ReturnValues: 'ALL_OLD',
        ...withExpr(e),
      }),
    );
    if (r === undefined) return null;
    return { previousConnId: (r.Attributes?.[a.conn] as string | undefined) ?? null };
  }

  async bumpGeneration(
    roomId: string,
    role: PeerRole,
    connId: string,
    now: number,
  ): Promise<{ generation: number; previousConnId: string | null } | null> {
    const e = new Expr();
    const a = SLOT_ATTRS[role];
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression:
          `SET ${e.n(a.gen)} = ${e.n(a.gen)} + ${e.v(1)}, ${e.n(a.seq)} = ${e.v(-1)}, ${e.n(a.conn)} = ${e.v(connId)}, ` +
          `${e.n('last_conn_ms')} = ${e.v(now)}`,
        ConditionExpression:
          `attribute_exists(${e.n('pk')}) AND ${e.n('closed')} = ${e.v(false)} AND ${e.n('expires_ms')} > ${e.v(now)} AND ` +
          `attribute_exists(${e.n(a.cred)}) AND ${e.n(a.exp)} > ${e.v(now)}`,
        ReturnValues: 'ALL_OLD',
        ...withExpr(e),
      }),
    );
    if (r === undefined) return null;
    const old = r.Attributes ?? {};
    return { generation: (old[a.gen] as number) + 1, previousConnId: (old[a.conn] as string | undefined) ?? null };
  }

  async detachConnection(roomId: string, role: PeerRole, connId: string, now: number): Promise<boolean> {
    const e = new Expr();
    const a = SLOT_ATTRS[role];
    const r = await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: `SET ${e.n('last_conn_ms')} = ${e.v(now)} REMOVE ${e.n(a.conn)}`,
        ConditionExpression: `${e.n(a.conn)} = ${e.v(connId)}`,
        ...withExpr(e),
      }),
    );
    return r !== undefined;
  }

  // ---- connections ------------------------------------------------------------------------

  async putConnection(c: ConnectionRecord, _now: number): Promise<void> {
    const item: Item = {
      ...connKey(c.connId),
      conn_id: c.connId,
      connected_ms: c.connectedAt,
      last_seen_ms: c.lastSeen,
      authenticated: c.authenticated,
      auth_deadline_ms: c.authDeadline,
      unauth_count: c.unauthCount,
      strikes: c.strikes,
      rate_strikes: c.rateStrikes,
      join_failures: c.joinFailures,
      relay_seq: c.relaySeq,
      origin_state: c.originState,
      source_hash: c.sourceHash,
      generation: c.generation,
      expires_at: ttl(c.connectedAt + CONNECTION_TTL_MS),
    };
    if (c.roomId) item.room_id = c.roomId;
    if (c.role) item.role = c.role;
    if (c.joinId) item.join_id = c.joinId;
    if (c.joinRoomId) item.join_room_id = c.joinRoomId;
    await this.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  async getConnection(connId: string): Promise<ConnectionRecord | null> {
    const i = await this.get(connKey(connId));
    return i ? connFromItem(i) : null;
  }

  async patchConnection(connId: string, patch: ConnectionPatch): Promise<boolean> {
    const e = new Expr();
    const sets: string[] = [];
    const removes: string[] = [];
    for (const key of Object.keys(patch) as (keyof ConnectionPatch)[]) {
      const value = patch[key];
      const attr = e.n(CONN_PATCH_ATTRS[key]);
      if (value === null || value === undefined) removes.push(attr);
      else sets.push(`${attr} = ${e.v(value)}`);
    }
    const clauses = [sets.length > 0 ? `SET ${sets.join(', ')}` : '', removes.length > 0 ? `REMOVE ${removes.join(', ')}` : '']
      .filter((c) => c !== '')
      .join(' ');
    if (clauses === '') return (await this.get(connKey(connId))) !== null;
    const r = await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: connKey(connId),
        UpdateExpression: clauses,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ...withExpr(e),
      }),
    );
    return r !== undefined;
  }

  async deleteConnection(connId: string): Promise<ConnectionRecord | null> {
    const r = await this.send<{ Attributes?: Item }>(
      new DeleteCommand({ TableName: this.tableName, Key: connKey(connId), ReturnValues: 'ALL_OLD' }),
    );
    return r.Attributes ? connFromItem(r.Attributes) : null;
  }

  async touchConnection(connId: string, now: number): Promise<void> {
    const e = new Expr();
    await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: connKey(connId),
        UpdateExpression: `SET ${e.n('last_seen_ms')} = ${e.v(now)}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ...withExpr(e),
      }),
    );
  }

  async bumpConnectionCounter(connId: string, field: ConnectionCounter): Promise<number> {
    const e = new Expr();
    const attr = COUNTER_ATTRS[field];
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: connKey(connId),
        UpdateExpression: `ADD ${e.n(attr)} ${e.v(1)}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ReturnValues: 'UPDATED_NEW',
        ...withExpr(e),
      }),
    );
    return r === undefined ? 0 : (r.Attributes?.[attr] as number);
  }

  async nextRelaySequence(connId: string): Promise<number | null> {
    const e = new Expr();
    const r = await this.conditional<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: connKey(connId),
        UpdateExpression: `ADD ${e.n('relay_seq')} ${e.v(1)}`,
        ConditionExpression: `attribute_exists(${e.n('pk')})`,
        ReturnValues: 'UPDATED_NEW',
        ...withExpr(e),
      }),
    );
    return r === undefined ? null : (r.Attributes?.relay_seq as number);
  }

  /** Paginated scan of connection items. Only for the optional idle sweeper; the table is small and TTL-bounded. */
  async listConnections(): Promise<ConnectionRecord[]> {
    const out: ConnectionRecord[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const e = new Expr();
      const r: { Items?: Item[]; LastEvaluatedKey?: Record<string, unknown> } = await this.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: `${e.n('sk')} = ${e.v('CONN')}`,
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
          ...withExpr(e),
        }),
      );
      for (const i of r.Items ?? []) out.push(connFromItem(i));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }

  // ---- per-message state ------------------------------------------------------------------

  async acceptSequence(
    roomId: string,
    role: PeerRole,
    generation: number,
    sequence: number,
  ): Promise<'ok' | 'replay' | 'stale'> {
    const e = new Expr();
    const a = SLOT_ATTRS[role];
    const r = await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: roomKey(roomId),
        UpdateExpression: `SET ${e.n(a.seq)} = ${e.v(sequence)}`,
        ConditionExpression:
          `attribute_exists(${e.n('pk')}) AND attribute_exists(${e.n(a.cred)}) AND ` +
          `${e.n(a.gen)} = ${e.v(generation)} AND ${e.n(a.seq)} < ${e.v(sequence)}`,
        ...withExpr(e),
      }),
    );
    if (r !== undefined) return 'ok';
    const room = await this.get(roomKey(roomId));
    if (!room || room[a.cred] === undefined || room[a.gen] !== generation) return 'stale';
    return 'replay';
  }

  async recordMessageId(roomId: string, messageId: string, now: number): Promise<'new' | 'duplicate'> {
    const e = new Expr();
    const expires = now + MESSAGE_ID_WINDOW_MS;
    const r = await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `MSG#${roomId}#${messageId}`, sk: 'M', msg_exp_ms: expires, expires_at: ttl(expires) },
        ConditionExpression: `attribute_not_exists(${e.n('pk')}) OR ${e.n('msg_exp_ms')} <= ${e.v(now)}`,
        ...withExpr(e),
      }),
    );
    return r === undefined ? 'duplicate' : 'new';
  }

  async consumeCue(roomId: string, sessionId: string, max: number, now: number): Promise<'ok' | 'limit'> {
    const e = new Expr();
    const r = await this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `ROOM#${roomId}`, sk: `CUE#${sessionId}` },
        UpdateExpression: `ADD ${e.n('n')} ${e.v(1)} SET ${e.n('expires_at')} = ${e.v(ttl(now + LIMITS.roomTtlMs))}`,
        ConditionExpression: `attribute_not_exists(${e.n('n')}) OR ${e.n('n')} < ${e.v(max)}`,
        ...withExpr(e),
      }),
    );
    return r === undefined ? 'limit' : 'ok';
  }

  private counterKey(key: string, windowMs: number, now: number): Record<string, string> {
    return { pk: `CTR#${windowMs}#${key}#${Math.floor(now / windowMs)}`, sk: 'C' };
  }

  async incrementCounter(key: string, windowMs: number, now: number): Promise<number> {
    const e = new Expr();
    const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
    const r = await this.send<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: this.counterKey(key, windowMs, now),
        UpdateExpression: `ADD ${e.n('n')} ${e.v(1)} SET ${e.n('expires_at')} = ${e.v(ttl(windowEnd))}`,
        ReturnValues: 'UPDATED_NEW',
        ...withExpr(e),
      }),
    );
    return r.Attributes?.n as number;
  }

  async getCounter(key: string, windowMs: number, now: number): Promise<number> {
    const i = await this.get(this.counterKey(key, windowMs, now));
    return (i?.n as number | undefined) ?? 0;
  }

  /** DynamoDB TTL performs physical cleanup; nothing to do here. */
  async purgeExpired(_now: number): Promise<number> {
    return 0;
  }
}

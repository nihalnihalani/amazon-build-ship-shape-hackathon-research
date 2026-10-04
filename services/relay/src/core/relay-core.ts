/**
 * Transport-agnostic relay core implementing ADR-0003 (pairing, first-message authentication and per-message
 * authorization) on top of PROTOCOL.md rev 1.
 *
 * The core holds no per-connection memory: every piece of state lives behind the RoomStore port, so the same
 * code runs in a single Node process (MemoryRoomStore) and in stateless Lambda invocations (DynamoDbRoomStore).
 * Handlers return Actions; adapters execute them. Adapters must process messages of one connection in order.
 */
import {
  hashCredential,
  hashPairingCode,
  hashSource,
  newConfirmDigits,
  newCredential,
  newJoinId,
  newMessageId,
  newPairingCode,
  newRoomId,
  roomHashPrefix,
  systemRandomBytes,
  verifyCredential,
  type RandomBytes,
} from './credentials.js';
import type { CloseReason, LogEvent } from './logger.js';
import {
  LIMITS,
  buildRelayMessage,
  forwardTarget,
  isAllowedSender,
  isPreAuthType,
  isPreOnlyType,
  isRelayOriginated,
  parseWireText,
  type ErrorCode,
  type MessageType,
  type ParsedMessage,
  type ParseFailure,
} from './protocol-port.js';
import type { RoomStore } from './room-store.js';
import {
  CLOSE,
  type Action,
  type CodeRecord,
  type ConnectionRecord,
  type MetricName,
  type PeerRole,
  type RawFrame,
  type RoomRecord,
  type SlotRecord,
} from './types.js';

export interface RateSpec {
  burstPerSec: number;
  sustainedPerSec: number;
}

export interface RelayLimitConfig {
  phone: RateSpec;
  tv: RateSpec;
  roomCreatePerSourcePerHour: number;
  joinFailPerSourcePer10Min: number;
  joinFailPerConnection: number;
  authFailPerSourcePer10Min: number;
  /** Invalid/forbidden messages tolerated per connection before it is closed. */
  invalidStrikesBeforeClose: number;
  /** Rate-limited messages tolerated per connection before it is closed ("sustained abuse"). */
  rateStrikesBeforeClose: number;
}

export const DEFAULT_LIMITS: RelayLimitConfig = {
  phone: { burstPerSec: 60, sustainedPerSec: 40 },
  tv: { burstPerSec: 40, sustainedPerSec: 20 },
  roomCreatePerSourcePerHour: 10,
  joinFailPerSourcePer10Min: 10,
  joinFailPerConnection: 3,
  authFailPerSourcePer10Min: 10,
  invalidStrikesBeforeClose: 20,
  rateStrikesBeforeClose: 120,
};

export interface RelayConfig {
  /** Exact-match Origin allowlist (ADR-0003 section 8). */
  allowedOrigins: readonly string[];
  /** Server-side secret mixed into pairing-code and source hashes. May be empty (weaker). */
  hashPepper: string;
  /** Kill switch: when it returns true, new connections are closed with 4503 and messages are rejected. */
  isDisabled?: () => boolean;
  /** Bind session-scoped messages to the room's active session (default true). */
  bindSessions?: boolean;
  limits?: Partial<RelayLimitConfig>;
}

export interface RelayDeps {
  store: RoomStore;
  config: RelayConfig;
  randomBytes?: RandomBytes;
  /** Monotonic millisecond clock used only for latency measurement. */
  monotonicMs?: () => number;
}

export interface ConnectContext {
  /** Value of the Origin header; null/undefined when the header is absent. */
  origin: string | null | undefined;
  /** Source address (or any stable per-source string). Hashed immediately; never stored or logged raw. */
  sourceKey: string;
  now: number;
}

interface Ctx {
  out: Action[];
  now: number;
  t0: number;
}

interface MsgInfo {
  ref: string | null;
  type: MessageType | null;
  bytes: number;
}

const TOUCH_GRANULARITY_MS = 5_000;
const POST_RESOLUTION_GRACE_MS = 5_000;
const CODE_RETRIES = 5;
const RATE_WINDOW_1S = 1_000;
const RATE_WINDOW_10S = 10_000;
const FAIL_WINDOW_MS = 10 * 60_000;
const CREATE_WINDOW_MS = 60 * 60_000;

function peerConnOf(room: RoomRecord, role: PeerRole): string | null {
  return role === 'tv' ? (room.phone?.connId ?? null) : room.tv.connId;
}
function slotOf(room: RoomRecord, role: PeerRole): SlotRecord | null {
  return role === 'tv' ? room.tv : room.phone;
}

export class RelayCore {
  private readonly store: RoomStore;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly pepper: string;
  private readonly rb: RandomBytes;
  private readonly mono: () => number;
  private readonly disabled: () => boolean;
  private readonly bindSessions: boolean;
  private readonly limits: RelayLimitConfig;

  constructor(deps: RelayDeps) {
    this.store = deps.store;
    this.allowedOrigins = new Set(deps.config.allowedOrigins);
    this.pepper = deps.config.hashPepper;
    this.rb = deps.randomBytes ?? systemRandomBytes;
    this.mono = deps.monotonicMs ?? (() => performance.now());
    this.disabled = deps.config.isDisabled ?? (() => false);
    this.bindSessions = deps.config.bindSessions ?? true;
    this.limits = { ...DEFAULT_LIMITS, ...(deps.config.limits ?? {}) };
  }

  // =========================================================================================
  // Public handlers
  // =========================================================================================

  async onConnect(connId: string, ctx: ConnectContext): Promise<Action[]> {
    const c = this.ctx(ctx.now);
    if (this.disabled()) {
      this.log(c, { event: 'kill_switch', code: 'relay_disabled' });
      c.out.push({ kind: 'close', connId, code: CLOSE.DISABLED, reason: 'relay_disabled' });
      return c.out;
    }
    const hasOrigin = ctx.origin !== null && ctx.origin !== undefined;
    if (hasOrigin && !this.allowedOrigins.has(ctx.origin as string)) {
      this.log(c, { event: 'origin_rejected', code: 'origin_rejected' });
      this.metric(c, 'origin_rejected');
      c.out.push({ kind: 'close', connId, code: CLOSE.ORIGIN, reason: 'origin_rejected' });
      return c.out;
    }
    await this.store.putConnection(
      {
        connId,
        connectedAt: ctx.now,
        lastSeen: ctx.now,
        authenticated: false,
        authDeadline: ctx.now + LIMITS.authDeadlineMs,
        unauthCount: 0,
        strikes: 0,
        rateStrikes: 0,
        joinFailures: 0,
        relaySeq: 0,
        originState: hasOrigin ? 'allowed' : 'missing',
        sourceHash: hashSource(ctx.sourceKey, this.pepper),
        roomId: null,
        role: null,
        generation: 0,
        joinId: null,
        joinRoomId: null,
      },
      ctx.now,
    );
    this.log(c, { event: 'connect' });
    return c.out;
  }

  async onMessage(connId: string, raw: RawFrame, now: number): Promise<Action[]> {
    const c = this.ctx(now);
    const bytes = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.bytes;

    if (this.disabled()) {
      this.log(c, { event: 'kill_switch', code: 'relay_disabled', bytes });
      c.out.push({
        kind: 'send',
        connId,
        data: buildRelayMessage({
          type: 'error',
          messageId: newMessageId(this.rb),
          roomId: null,
          sequence: 0,
          nowMs: now,
          payload: { code: 'internal', ref_message_id: null, detail: 'relay_disabled' },
        }),
      });
      c.out.push({ kind: 'close', connId, code: CLOSE.DISABLED, reason: 'relay_disabled' });
      await this.store.deleteConnection(connId);
      return c.out;
    }

    const conn = await this.store.getConnection(connId);
    if (!conn) {
      c.out.push({ kind: 'close', connId, code: CLOSE.UNAUTHENTICATED, reason: 'unknown_connection' });
      return c.out;
    }
    const info: MsgInfo = { ref: null, type: null, bytes };

    if (!conn.authenticated) {
      if (now > conn.authDeadline) {
        this.log(c, { event: 'auth_deadline', code: 'auth_deadline', bytes });
        await this.drop(c, conn, CLOSE.UNAUTHENTICATED, 'auth_deadline');
        return c.out;
      }
      const n = await this.store.bumpConnectionCounter(conn.connId, 'unauthCount');
      if (n > LIMITS.maxUnauthenticatedMessages) {
        await this.replyError(c, conn, 'rate_limited', 'too_many_unauthenticated', info, false);
        await this.drop(c, conn, CLOSE.RATE_LIMITED, 'too_many_unauthenticated_messages');
        return c.out;
      }
    }
    if (now - conn.lastSeen >= TOUCH_GRANULARITY_MS) await this.store.touchConnection(conn.connId, now);

    if (typeof raw !== 'string') {
      await this.replyError(c, conn, 'binary_rejected', 'binary_frames_not_allowed', info, false);
      await this.drop(c, conn, CLOSE.BINARY, 'binary_rejected');
      return c.out;
    }

    const parsed = parseWireText(raw, now);
    if (!parsed.ok) {
      await this.rejectParse(c, conn, parsed);
      return c.out;
    }
    const msg = parsed.message;
    info.ref = msg.envelope.message_id;
    info.type = msg.type;

    if (!conn.authenticated) await this.handleUnauthenticated(c, conn, msg, info);
    else await this.handleAuthenticated(c, conn, msg, info);
    return c.out;
  }

  /** Also used by adapters when a send fails because the peer is gone (GoneException). Idempotent. */
  async onDisconnect(connId: string, now: number): Promise<Action[]> {
    const c = this.ctx(now);
    const deleted = await this.store.deleteConnection(connId);
    if (deleted) {
      this.log(c, {
        event: 'disconnect',
        ...(deleted.role ? { role: deleted.role } : {}),
        ...(deleted.roomId ? { room: roomHashPrefix(deleted.roomId) } : {}),
      });
      await this.afterGone(c, deleted);
    }
    return c.out;
  }

  /** Sweep: unauthenticated deadlines, expired pending joins, connections idle past the heartbeat window. */
  async onTick(now: number): Promise<Action[]> {
    const c = this.ctx(now);
    const conns = await this.store.listConnections();
    for (const conn of conns) {
      if (!conn.authenticated) {
        let cur = conn;
        if (conn.joinId && conn.joinRoomId) {
          await this.expireJoinIfDue(c, conn);
          const fresh = await this.store.getConnection(conn.connId);
          if (!fresh) continue;
          cur = fresh;
        }
        if (now > cur.authDeadline) {
          this.log(c, { event: 'auth_deadline', code: 'auth_deadline' });
          await this.drop(c, cur, CLOSE.UNAUTHENTICATED, 'auth_deadline');
        }
      } else if (now - conn.lastSeen > LIMITS.heartbeatWindowMs) {
        this.log(c, {
          event: 'idle_timeout',
          code: 'idle_timeout',
          ...(conn.role ? { role: conn.role } : {}),
          ...(conn.roomId ? { room: roomHashPrefix(conn.roomId) } : {}),
        });
        await this.drop(c, conn, CLOSE.IDLE, 'idle_timeout');
      }
    }
    await this.store.purgeExpired(now);
    return c.out;
  }

  // =========================================================================================
  // Unauthenticated phase
  // =========================================================================================

  private async handleUnauthenticated(
    c: Ctx,
    conn: ConnectionRecord,
    msg: ParsedMessage,
    info: MsgInfo,
  ): Promise<void> {
    const env = msg.envelope;
    if (!isPreAuthType(msg.type)) {
      await this.reject(c, conn, 'unauthenticated', 'authenticate_first', info);
      return;
    }
    if (!isAllowedSender(msg.type, env.sender_role)) {
      await this.reject(c, conn, 'forbidden_direction', 'sender_role_not_allowed', info);
      return;
    }
    switch (msg.type) {
      case 'room.create':
        return this.handleRoomCreate(c, conn, info);
      case 'join.request':
        return this.handleJoinRequest(c, conn, msg, info);
      case 'auth.resume':
        return this.handleAuthResume(c, conn, msg, info);
      case 'ping':
        return this.relaySend(c, conn.connId, null, 'pong', { server_time: c.now });
      default:
        await this.reject(c, conn, 'unauthenticated', 'authenticate_first', info);
    }
  }

  private async handleRoomCreate(c: Ctx, conn: ConnectionRecord, info: MsgInfo): Promise<void> {
    // TV-role operation: a missing Origin is allowed (a present one was already checked at connect).
    const n = await this.store.incrementCounter(`rc:${conn.sourceHash}`, CREATE_WINDOW_MS, c.now);
    if (n > this.limits.roomCreatePerSourcePerHour) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'room.create' });
      await this.replyError(c, conn, 'rate_limited', 'room_create_limit', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }
    const roomId = newRoomId(this.rb);
    const credential = newCredential(this.rb);
    const credHash = hashCredential(credential);
    const expiresAt = c.now + LIMITS.roomTtlMs;
    const credExpiresAt = Math.min(c.now + LIMITS.credentialTtlMs, expiresAt);

    let code = '';
    let codeRecord: CodeRecord | null = null;
    let created = false;
    for (let attempt = 0; attempt < CODE_RETRIES && !created; attempt += 1) {
      code = newPairingCode(this.rb);
      codeRecord = {
        codeHash: hashPairingCode(code, this.pepper),
        roomId,
        expiresAt: c.now + LIMITS.pairingCodeTtlMs,
      };
      const room: RoomRecord = {
        roomId,
        createdAt: c.now,
        expiresAt,
        closed: false,
        lastConnChange: c.now,
        codeHash: codeRecord.codeHash,
        activeSessionId: null,
        tv: { credHash, credExpiresAt, generation: 1, lastSeq: -1, connId: conn.connId },
        phone: null,
        phoneGeneration: 0,
      };
      const r = await this.store.createRoom(room, codeRecord, c.now);
      if (r === 'ok') created = true;
      else if (r === 'room_exists') break;
    }
    if (!created || !codeRecord) {
      await this.reject(c, conn, 'internal', 'room_create_failed', info, false);
      return;
    }
    await this.store.patchConnection(conn.connId, {
      authenticated: true,
      authDeadline: 0,
      roomId,
      role: 'tv',
      generation: 1,
      joinId: null,
      joinRoomId: null,
    });
    this.metric(c, 'rooms_created');
    this.log(c, { event: 'room_created', role: 'tv', room: roomHashPrefix(roomId) });
    await this.relaySend(c, conn.connId, roomId, 'room.created', {
      room_id: roomId,
      pairing_code: code,
      code_expires_at: codeRecord.expiresAt,
      tv_credential: credential,
      credential_expires_at: credExpiresAt,
      generation: 1,
    });
  }

  private async handleJoinRequest(c: Ctx, conn: ConnectionRecord, msg: ParsedMessage, info: MsgInfo): Promise<void> {
    // Phone-role operation: requires an allowlisted Origin.
    if (conn.originState !== 'allowed') {
      this.metric(c, 'origin_rejected');
      await this.replyError(c, conn, 'origin_rejected', 'origin_required', info, false);
      await this.drop(c, conn, CLOSE.ORIGIN, 'origin_rejected');
      return;
    }
    if (conn.joinId) {
      await this.reject(c, conn, 'join_busy', 'join_already_pending', info);
      return;
    }
    const failKey = `jf:${conn.sourceHash}`;
    if (
      (await this.store.getCounter(failKey, FAIL_WINDOW_MS, c.now)) >= this.limits.joinFailPerSourcePer10Min ||
      conn.joinFailures >= this.limits.joinFailPerConnection
    ) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'join.request' });
      await this.replyError(c, conn, 'rate_limited', 'too_many_failed_joins', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }

    const code = msg.payload.pairing_code as string;
    const codeRec = await this.store.findRoomByCodeHash(hashPairingCode(code, this.pepper));
    if (!codeRec) return this.joinFailure(c, conn, 'not_found', 'unknown_code', info, failKey);
    if (c.now >= codeRec.expiresAt) return this.joinFailure(c, conn, 'expired', 'code_expired', info, failKey);
    const room = await this.store.getRoom(codeRec.roomId);
    if (!room || room.closed) return this.joinFailure(c, conn, 'not_found', 'unknown_code', info, failKey);
    if (c.now >= room.expiresAt) return this.joinFailure(c, conn, 'expired', 'room_expired', info, failKey);

    if (!room.tv.connId) {
      await this.reply(c, conn, 'not_found', 'tv_offline', info);
      return;
    }
    if (room.phone && room.phone.credExpiresAt > c.now) {
      await this.relaySend(c, conn.connId, null, 'join.rejected', { reason: 'room_full' });
      this.metric(c, 'join_rejected');
      this.log(c, { event: 'join_rejected', code: 'room_full', room: roomHashPrefix(room.roomId) });
      return;
    }

    const joinId = newJoinId(this.rb);
    const confirmDigits = newConfirmDigits(this.rb);
    const expiresAt = c.now + LIMITS.joinTtlMs;
    const created = await this.store.createJoin(
      { roomId: room.roomId, joinId, phoneConnId: conn.connId, confirmDigits, expiresAt, state: 'pending' },
      c.now,
    );
    if (created === 'busy') {
      await this.relaySend(c, conn.connId, null, 'join.rejected', { reason: 'busy' });
      await this.reject(c, conn, 'join_busy', 'join_pending_for_room', info);
      return;
    }
    await this.store.patchConnection(conn.connId, {
      joinId,
      joinRoomId: room.roomId,
      authDeadline: c.now + LIMITS.authDeadlineWhileJoinPendingMs,
    });
    this.metric(c, 'join_requested');
    this.log(c, { event: 'join_requested', role: 'phone', room: roomHashPrefix(room.roomId) });
    await this.relaySend(c, conn.connId, null, 'join.pending', {
      join_id: joinId,
      confirm_digits: confirmDigits,
      expires_at: expiresAt,
    });
    await this.relaySend(c, room.tv.connId, room.roomId, 'join.requested', {
      join_id: joinId,
      device_label: msg.payload.device_label as string,
      confirm_digits: confirmDigits,
      expires_at: expiresAt,
    });
  }

  private async joinFailure(
    c: Ctx,
    conn: ConnectionRecord,
    code: ErrorCode,
    detail: string,
    info: MsgInfo,
    failKey: string,
  ): Promise<void> {
    await this.store.incrementCounter(failKey, FAIL_WINDOW_MS, c.now);
    const n = await this.store.bumpConnectionCounter(conn.connId, 'joinFailures');
    this.metric(c, 'join_failed');
    this.log(c, { event: 'join_failed', code, type: 'join.request' });
    await this.replyError(c, conn, code, detail, info, false);
    if (n >= this.limits.joinFailPerConnection) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
  }

  private async authFailure(
    c: Ctx,
    conn: ConnectionRecord,
    code: ErrorCode,
    detail: string,
    info: MsgInfo,
    failKey: string,
  ): Promise<void> {
    await this.store.incrementCounter(failKey, FAIL_WINDOW_MS, c.now);
    const n = await this.store.bumpConnectionCounter(conn.connId, 'joinFailures');
    this.metric(c, 'auth_failed');
    this.log(c, { event: 'auth_failed', code, type: 'auth.resume' });
    await this.replyError(c, conn, code, detail, info, false);
    if (n >= this.limits.joinFailPerConnection) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
  }

  private async handleAuthResume(c: Ctx, conn: ConnectionRecord, msg: ParsedMessage, info: MsgInfo): Promise<void> {
    const p = msg.payload as { room_id: string; role: PeerRole; credential: string };
    if (p.role !== msg.envelope.sender_role) {
      await this.reject(c, conn, 'unauthorized', 'role_mismatch', info);
      return;
    }
    if (p.role === 'phone' && conn.originState !== 'allowed') {
      this.metric(c, 'origin_rejected');
      await this.replyError(c, conn, 'origin_rejected', 'origin_required', info, false);
      await this.drop(c, conn, CLOSE.ORIGIN, 'origin_rejected');
      return;
    }
    const failKey = `af:${conn.sourceHash}`;
    if (
      (await this.store.getCounter(failKey, FAIL_WINDOW_MS, c.now)) >= this.limits.authFailPerSourcePer10Min ||
      conn.joinFailures >= this.limits.joinFailPerConnection
    ) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'auth.resume' });
      await this.replyError(c, conn, 'rate_limited', 'too_many_failed_auth', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }

    const room = await this.store.getRoom(p.room_id);
    if (!room || room.closed) return this.authFailure(c, conn, 'unauthorized', 'resume_failed', info, failKey);
    const slot = slotOf(room, p.role);
    if (!slot) {
      const code: ErrorCode = p.role === 'phone' && room.phoneGeneration > 0 ? 'revoked' : 'unauthorized';
      return this.authFailure(c, conn, code, code === 'revoked' ? 'credential_revoked' : 'resume_failed', info, failKey);
    }
    if (!verifyCredential(p.credential, slot.credHash)) {
      return this.authFailure(c, conn, 'unauthorized', 'resume_failed', info, failKey);
    }
    if (c.now >= slot.credExpiresAt || c.now >= room.expiresAt) {
      return this.authFailure(c, conn, 'expired', 'credential_expired', info, failKey);
    }
    // Rooms with no connection for 30 minutes are closed (PROTOCOL.md section 7); checked logically, here.
    const noConnections = room.tv.connId === null && (room.phone?.connId ?? null) === null;
    if (noConnections && c.now - room.lastConnChange > LIMITS.roomIdleCloseMs) {
      await this.store.closeRoom(room.roomId, c.now);
      return this.authFailure(c, conn, 'expired', 'room_idle_closed', info, failKey);
    }

    const bump = await this.store.bumpGeneration(room.roomId, p.role, conn.connId, c.now);
    if (!bump) return this.authFailure(c, conn, 'revoked', 'credential_revoked', info, failKey);

    await this.store.patchConnection(conn.connId, {
      authenticated: true,
      authDeadline: 0,
      roomId: room.roomId,
      role: p.role,
      generation: bump.generation,
      joinId: null,
      joinRoomId: null,
    });

    // Supersede an older connection of the same role.
    if (bump.previousConnId && bump.previousConnId !== conn.connId) {
      const old = await this.store.getConnection(bump.previousConnId);
      if (old) {
        this.metric(c, 'superseded');
        this.log(c, { event: 'superseded', code: 'superseded', role: p.role, room: roomHashPrefix(room.roomId) });
        await this.replyError(c, old, 'superseded', 'newer_connection', { ref: null, type: null, bytes: 0 }, false);
        await this.drop(c, old, CLOSE.SUPERSEDED, 'superseded');
      }
    }

    const peerConnId = peerConnOf(room, p.role);
    this.log(c, { event: 'auth_ok', role: p.role, room: roomHashPrefix(room.roomId) });
    await this.relaySend(c, conn.connId, room.roomId, 'auth.ok', {
      role: p.role,
      generation: bump.generation,
      peer_connected: peerConnId !== null,
      phone_paired: room.phone !== null && room.phone.credExpiresAt > c.now,
    });
    if (peerConnId) {
      await this.relaySend(c, peerConnId, room.roomId, 'peer.state', {
        role: p.role,
        connected: true,
        generation: bump.generation,
      });
    }
  }

  // =========================================================================================
  // Authenticated phase
  // =========================================================================================

  private async handleAuthenticated(
    c: Ctx,
    conn: ConnectionRecord,
    msg: ParsedMessage,
    info: MsgInfo,
  ): Promise<void> {
    const env = msg.envelope;
    const role = conn.role as PeerRole;
    const roomId = conn.roomId as string;

    // Step 7 (ADR-0003 section 9): logical state of the connection's room and credential, on every message.
    const room = await this.store.getRoom(roomId);
    if (!room || room.closed) {
      await this.replyError(c, conn, 'revoked', 'room_closed', info, false);
      await this.drop(c, conn, CLOSE.ROOM_CLOSED, 'room_closed');
      return;
    }
    if (c.now >= room.expiresAt) {
      await this.replyError(c, conn, 'expired', 'room_expired', info, false);
      await this.drop(c, conn, CLOSE.UNAUTHENTICATED, 'expired');
      return;
    }
    const slot = slotOf(room, role);
    if (!slot) {
      await this.replyError(c, conn, 'revoked', 'credential_revoked', info, false);
      await this.drop(c, conn, CLOSE.UNPAIRED, 'revoked');
      return;
    }
    if (c.now >= slot.credExpiresAt) {
      await this.replyError(c, conn, 'expired', 'credential_expired', info, false);
      await this.drop(c, conn, CLOSE.UNAUTHENTICATED, 'expired');
      return;
    }
    if (slot.generation !== conn.generation) {
      this.metric(c, 'superseded');
      await this.replyError(c, conn, 'superseded', 'newer_connection', info, false);
      await this.drop(c, conn, CLOSE.SUPERSEDED, 'superseded');
      return;
    }

    // Step 7: role, direction, room binding.
    if (isRelayOriginated(msg.type) || env.sender_role === 'relay') {
      return this.reject(c, conn, 'forbidden_direction', 'relay_only_type', info);
    }
    if (env.sender_role !== role) return this.reject(c, conn, 'unauthorized', 'sender_role', info);
    if (!isAllowedSender(msg.type, role)) return this.reject(c, conn, 'forbidden_direction', 'direction', info);
    if (isPreOnlyType(msg.type)) return this.reject(c, conn, 'unauthorized', 'already_authenticated', info);
    if (env.room_id !== null && env.room_id !== roomId) return this.reject(c, conn, 'unauthorized', 'room_id', info);

    // Rate limit. PROTOCOL.md section 4 lists this at step 9; counting happens here so that a flooding peer costs
    // two counter increments rather than several conditional writes. Only the precedence of simultaneous
    // violations differs.
    if (await this.isRateLimited(c, conn, role)) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: msg.type, role, room: roomHashPrefix(roomId) });
      await this.replyError(c, conn, 'rate_limited', 'rate_limited', info, false);
      const n = await this.store.bumpConnectionCounter(conn.connId, 'rateStrikes');
      if (n >= this.limits.rateStrikesBeforeClose) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }

    // Step 8 (PROTOCOL.md revision 2): session binding and peer presence consume no state, so a client may retry
    // after them. Then the duplicate check comes BEFORE generation and sequence: a duplicate message_id inside the
    // room's last 1024 ids is dropped silently (not forwarded, no error, no ack). Then generation (stale) and
    // sequence (replay).
    if (
      this.bindSessions &&
      env.session_id !== null &&
      msg.type !== 'ack' &&
      msg.type !== 'mic.state' &&
      msg.type !== 'session.begin' &&
      forwardTarget(msg.type, role) !== null &&
      room.activeSessionId !== env.session_id
    ) {
      return this.reject(c, conn, 'stale', 'session', info);
    }

    const target = forwardTarget(msg.type, role);
    const peerConnId = target === null ? null : target === 'tv' ? room.tv.connId : (room.phone?.connId ?? null);
    if (target !== null && !peerConnId) {
      this.metric(c, 'peer_offline');
      this.log(c, { event: 'peer_offline', code: 'not_found', type: msg.type, role, room: roomHashPrefix(roomId) });
      // Level frames are dropped silently: the TV cancels the window on link loss and an error storm at 20 Hz
      // would cost more than it helps. Everything else is told the peer is offline.
      if (msg.type !== 'level') await this.replyError(c, conn, 'not_found', 'peer_offline', info, false);
      return;
    }

    if ((await this.store.recordMessageId(roomId, env.message_id, c.now)) === 'duplicate') {
      this.metric(c, 'duplicate_dropped');
      return;
    }
    if (env.producer_generation !== conn.generation) return this.reject(c, conn, 'stale', 'generation', info);
    const seq = await this.store.acceptSequence(roomId, role, env.producer_generation, env.sequence);
    if (seq === 'replay') return this.reject(c, conn, 'replay', 'sequence', info);
    if (seq === 'stale') return this.reject(c, conn, 'stale', 'generation', info);

    if (msg.type === 'cue') {
      const r = await this.store.consumeCue(roomId, env.session_id as string, LIMITS.maxCuesPerSession, c.now);
      if (r === 'limit') return this.reject(c, conn, 'cue_limit', 'cue_limit', info);
    }

    // Step 10: apply or forward.
    if (target !== null) {
      await this.forward(c, conn, msg, room, peerConnId as string);
      return;
    }
    switch (msg.type) {
      case 'ping':
        return this.relaySend(c, conn.connId, roomId, 'pong', { server_time: c.now });
      case 'pairing.refresh':
        return this.handlePairingRefresh(c, conn, room, info);
      case 'join.confirm':
        return this.handleJoinConfirm(c, conn, room, msg, info);
      case 'unpair':
        return this.handleUnpair(c, conn, room);
      case 'room.close':
        return this.handleRoomClose(c, conn, room);
      default:
        return this.reject(c, conn, 'internal', 'unhandled_type', info, false);
    }
  }

  private async isRateLimited(c: Ctx, conn: ConnectionRecord, role: PeerRole): Promise<boolean> {
    const spec = role === 'tv' ? this.limits.tv : this.limits.phone;
    const n1 = await this.store.incrementCounter(`rl1:${conn.connId}`, RATE_WINDOW_1S, c.now);
    if (n1 > spec.burstPerSec) return true;
    const n10 = await this.store.incrementCounter(`rl10:${conn.connId}`, RATE_WINDOW_10S, c.now);
    return n10 > spec.sustainedPerSec * 10;
  }

  private async forward(
    c: Ctx,
    conn: ConnectionRecord,
    msg: ParsedMessage,
    room: RoomRecord,
    peerConnId: string,
  ): Promise<void> {
    // Forwarded unchanged: the exact text received.
    c.out.push({ kind: 'send', connId: peerConnId, data: msg.raw });
    if (msg.type === 'session.begin') {
      await this.store.setActiveSession(room.roomId, msg.envelope.session_id);
    } else if (msg.type === 'session.end' && room.activeSessionId === msg.envelope.session_id) {
      await this.store.setActiveSession(room.roomId, null);
    }
    // Level frames arrive at about 20 Hz per session: no per-frame log line.
    if (msg.type !== 'level') {
      this.log(c, {
        event: 'message_forwarded',
        type: msg.type,
        bytes: msg.bytes,
        role: conn.role as PeerRole,
        room: roomHashPrefix(room.roomId),
        latency_ms: Math.round((this.mono() - c.t0) * 100) / 100,
      });
    }
  }

  // ---- TV operations ------------------------------------------------------------------------

  private async handlePairingRefresh(c: Ctx, conn: ConnectionRecord, room: RoomRecord, info: MsgInfo): Promise<void> {
    for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
      const code = newPairingCode(this.rb);
      const rec: CodeRecord = {
        codeHash: hashPairingCode(code, this.pepper),
        roomId: room.roomId,
        expiresAt: c.now + LIMITS.pairingCodeTtlMs,
      };
      const r = await this.store.rotateCode(room.roomId, rec, c.now);
      if (r === 'ok') {
        this.log(c, { event: 'pairing_refreshed', role: 'tv', room: roomHashPrefix(room.roomId) });
        await this.relaySend(c, conn.connId, room.roomId, 'pairing.code', {
          pairing_code: code,
          code_expires_at: rec.expiresAt,
        });
        return;
      }
      if (r !== 'code_collision') break;
    }
    await this.reject(c, conn, 'internal', 'pairing_refresh_failed', info, false);
  }

  private async handleJoinConfirm(
    c: Ctx,
    conn: ConnectionRecord,
    room: RoomRecord,
    msg: ParsedMessage,
    info: MsgInfo,
  ): Promise<void> {
    const p = msg.payload as { join_id: string; decision: 'accept' | 'reject' };
    const join = await this.store.getJoin(room.roomId);
    if (!join || join.joinId !== p.join_id || join.state !== 'pending') {
      return this.reject(c, conn, 'not_found', 'no_such_join', info);
    }
    const phoneConn = await this.store.getConnection(join.phoneConnId);
    const roomRef = roomHashPrefix(room.roomId);

    const closeOutJoin = async (): Promise<void> => {
      if (phoneConn) {
        await this.store.patchConnection(phoneConn.connId, {
          joinId: null,
          joinRoomId: null,
          authDeadline: c.now + POST_RESOLUTION_GRACE_MS,
        });
      }
    };

    if (c.now >= join.expiresAt) {
      await this.store.resolveJoin(room.roomId, join.joinId, 'expired', c.now);
      this.log(c, { event: 'join_expired', code: 'expired', room: roomRef });
      await this.relaySend(c, conn.connId, room.roomId, 'join.expired', { join_id: join.joinId });
      if (phoneConn) await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'expired' });
      await closeOutJoin();
      return;
    }

    if (p.decision === 'reject') {
      const r = await this.store.resolveJoin(room.roomId, join.joinId, 'rejected', c.now);
      if (r !== 'ok') return this.reject(c, conn, 'not_found', 'no_such_join', info);
      this.metric(c, 'join_rejected');
      this.log(c, { event: 'join_rejected', code: 'unauthorized', room: roomRef });
      if (phoneConn) await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'rejected' });
      await closeOutJoin();
      return;
    }

    // accept
    if (!phoneConn) {
      await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now);
      await this.relaySend(c, conn.connId, room.roomId, 'join.expired', { join_id: join.joinId });
      return;
    }
    // Exactly one confirm can win the pending -> accepted transition.
    const resolved = await this.store.resolveJoin(room.roomId, join.joinId, 'accepted', c.now);
    if (resolved !== 'ok') return this.reject(c, conn, 'not_found', 'no_such_join', info);

    const phoneCredential = newCredential(this.rb);
    const credExpiresAt = Math.min(c.now + LIMITS.credentialTtlMs, room.expiresAt);
    const claim = await this.store.claimPhoneSlot(
      room.roomId,
      { credHash: hashCredential(phoneCredential), credExpiresAt, connId: phoneConn.connId },
      c.now,
    );
    if (!claim.ok) {
      this.metric(c, 'join_rejected');
      this.log(c, { event: 'join_rejected', code: 'room_full', room: roomRef });
      await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'room_full' });
      await closeOutJoin();
      return this.reject(c, conn, 'room_full', 'phone_slot_taken', info);
    }
    // One use: the code can no longer resolve.
    if (room.codeHash) await this.store.consumeCode(room.roomId, room.codeHash);
    await this.store.patchConnection(phoneConn.connId, {
      authenticated: true,
      authDeadline: 0,
      roomId: room.roomId,
      role: 'phone',
      generation: claim.generation,
      joinId: null,
      joinRoomId: null,
    });
    this.metric(c, 'join_accepted');
    this.log(c, { event: 'join_accepted', role: 'phone', room: roomRef });
    await this.relaySend(c, phoneConn.connId, room.roomId, 'join.accepted', {
      room_id: room.roomId,
      phone_credential: phoneCredential,
      credential_expires_at: credExpiresAt,
      generation: claim.generation,
    });
    await this.relaySend(c, phoneConn.connId, room.roomId, 'peer.state', {
      role: 'tv',
      connected: true,
      generation: room.tv.generation,
    });
    await this.relaySend(c, conn.connId, room.roomId, 'peer.state', {
      role: 'phone',
      connected: true,
      generation: claim.generation,
    });
  }

  private async handleUnpair(c: Ctx, conn: ConnectionRecord, room: RoomRecord): Promise<void> {
    const roomRef = roomHashPrefix(room.roomId);
    const phoneGen = room.phone?.generation ?? room.phoneGeneration;
    const rev = await this.store.revokePhone(room.roomId, c.now);
    // A pending join is cancelled with the pairing it belonged to.
    const join = await this.store.getJoin(room.roomId);
    if (join && join.state === 'pending') {
      if ((await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now)) === 'ok') {
        const pending = await this.store.getConnection(join.phoneConnId);
        if (pending) {
          await this.relaySend(c, pending.connId, null, 'join.rejected', { reason: 'rejected' });
          await this.store.patchConnection(pending.connId, {
            joinId: null,
            joinRoomId: null,
            authDeadline: c.now + POST_RESOLUTION_GRACE_MS,
          });
        }
      }
    }
    this.log(c, { event: 'unpaired', role: 'tv', room: roomRef });
    if (rev?.previousConnId) {
      const phoneConn = await this.store.getConnection(rev.previousConnId);
      if (phoneConn) {
        await this.relaySend(c, phoneConn.connId, room.roomId, 'unpaired', { reason: 'tv_unpaired' });
        await this.drop(c, phoneConn, CLOSE.UNPAIRED, 'unpaired');
      }
    }
    await this.relaySend(c, conn.connId, room.roomId, 'peer.state', {
      role: 'phone',
      connected: false,
      generation: phoneGen,
    });
  }

  private async handleRoomClose(c: Ctx, conn: ConnectionRecord, room: RoomRecord): Promise<void> {
    await this.store.closeRoom(room.roomId, c.now);
    this.log(c, { event: 'room_closed', role: 'tv', room: roomHashPrefix(room.roomId) });
    const join = await this.store.getJoin(room.roomId);
    if (join && join.state === 'pending') {
      await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now);
      const pending = await this.store.getConnection(join.phoneConnId);
      if (pending) {
        await this.relaySend(c, pending.connId, null, 'join.rejected', { reason: 'expired' });
        await this.drop(c, pending, CLOSE.ROOM_CLOSED, 'room_closed');
      }
    }
    const phoneConnId = room.phone?.connId;
    if (phoneConnId) {
      const phoneConn = await this.store.getConnection(phoneConnId);
      if (phoneConn) {
        await this.relaySend(c, phoneConn.connId, room.roomId, 'unpaired', { reason: 'room_closed' });
        await this.drop(c, phoneConn, CLOSE.ROOM_CLOSED, 'room_closed');
      }
    }
    await this.drop(c, conn, CLOSE.NORMAL, 'room_closed');
  }

  // =========================================================================================
  // Helpers
  // =========================================================================================

  private ctx(now: number): Ctx {
    return { out: [], now, t0: this.mono() };
  }

  private log(c: Ctx, event: LogEvent): void {
    c.out.push({ kind: 'log', event });
  }

  private metric(c: Ctx, name: MetricName, value = 1): void {
    c.out.push({ kind: 'metric', name, value });
  }

  /** Sends a relay-originated message (sender_role relay, generation 0, the target connection's own sequence). */
  private async relaySend(
    c: Ctx,
    connId: string,
    roomId: string | null,
    type: MessageType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const seq = await this.store.nextRelaySequence(connId);
    if (seq === null) return; // connection already gone
    c.out.push({
      kind: 'send',
      connId,
      data: buildRelayMessage({
        type,
        messageId: newMessageId(this.rb),
        roomId,
        sequence: seq,
        nowMs: c.now,
        payload,
      }),
    });
  }

  /** Sends an `error` to the connection. Room id appears in the envelope only for authenticated connections. */
  private async replyError(
    c: Ctx,
    conn: ConnectionRecord,
    code: ErrorCode,
    detail: string,
    info: MsgInfo,
    countRejection = true,
  ): Promise<void> {
    if (countRejection) this.metric(c, 'messages_rejected');
    this.log(c, {
      event: 'message_rejected',
      code,
      ...(info.type ? { type: info.type } : {}),
      bytes: info.bytes,
      ...(conn.role ? { role: conn.role } : {}),
      ...(conn.authenticated && conn.roomId ? { room: roomHashPrefix(conn.roomId) } : {}),
    });
    await this.relaySend(c, conn.connId, conn.authenticated ? conn.roomId : null, 'error', {
      code,
      ref_message_id: info.ref,
      detail,
    });
  }

  /** Replies with an error and does not count it as a client strike (used for non-abusive outcomes). */
  private async reply(c: Ctx, conn: ConnectionRecord, code: ErrorCode, detail: string, info: MsgInfo): Promise<void> {
    await this.replyError(c, conn, code, detail, info, false);
  }

  /** Rejects a message: error reply plus a strike; too many strikes close the connection. */
  private async reject(
    c: Ctx,
    conn: ConnectionRecord,
    code: ErrorCode,
    detail: string,
    info: MsgInfo,
    strike = true,
  ): Promise<void> {
    await this.replyError(c, conn, code, detail, info, true);
    if (!strike) return;
    const n = await this.store.bumpConnectionCounter(conn.connId, 'strikes');
    if (n >= this.limits.invalidStrikesBeforeClose) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'abuse');
  }

  private async rejectParse(c: Ctx, conn: ConnectionRecord, f: ParseFailure): Promise<void> {
    const info: MsgInfo = { ref: f.refMessageId, type: null, bytes: f.bytes };
    if (f.code === 'payload_too_large') {
      await this.replyError(c, conn, f.code, f.detail, info, true);
      await this.drop(c, conn, CLOSE.TOO_BIG, 'payload_too_large');
      return;
    }
    await this.reject(c, conn, f.code, f.detail, info);
  }

  /** Closes a connection and runs disconnect handling exactly once (idempotent against a later onDisconnect). */
  private async drop(c: Ctx, conn: ConnectionRecord, code: number, reason: CloseReason): Promise<void> {
    c.out.push({ kind: 'close', connId: conn.connId, code, reason });
    const deleted = await this.store.deleteConnection(conn.connId);
    if (deleted) await this.afterGone(c, deleted);
  }

  private async afterGone(c: Ctx, conn: ConnectionRecord): Promise<void> {
    if (conn.joinId && conn.joinRoomId) {
      const r = await this.store.resolveJoin(conn.joinRoomId, conn.joinId, 'cancelled', c.now);
      if (r === 'ok') {
        const room = await this.store.getRoom(conn.joinRoomId);
        if (room?.tv.connId) {
          await this.relaySend(c, room.tv.connId, room.roomId, 'join.expired', { join_id: conn.joinId });
        }
      }
    }
    if (conn.authenticated && conn.roomId && conn.role) {
      const detached = await this.store.detachConnection(conn.roomId, conn.role, conn.connId, c.now);
      if (detached) {
        const room = await this.store.getRoom(conn.roomId);
        const peer = room ? peerConnOf(room, conn.role) : null;
        if (room && peer) {
          await this.relaySend(c, peer, room.roomId, 'peer.state', {
            role: conn.role,
            connected: false,
            generation: conn.generation,
          });
        }
      }
    }
  }

  /** Tick-time handling of a pending join that passed its 60 s expiry. */
  private async expireJoinIfDue(c: Ctx, conn: ConnectionRecord): Promise<void> {
    if (!conn.joinId || !conn.joinRoomId) return;
    const join = await this.store.getJoin(conn.joinRoomId);
    if (!join || join.joinId !== conn.joinId || join.state !== 'pending' || c.now < join.expiresAt) return;
    if ((await this.store.resolveJoin(conn.joinRoomId, conn.joinId, 'expired', c.now)) !== 'ok') return;
    const room = await this.store.getRoom(conn.joinRoomId);
    this.log(c, { event: 'join_expired', code: 'expired', ...(room ? { room: roomHashPrefix(room.roomId) } : {}) });
    if (room?.tv.connId) {
      await this.relaySend(c, room.tv.connId, room.roomId, 'join.expired', { join_id: join.joinId });
    }
    await this.relaySend(c, conn.connId, null, 'join.rejected', { reason: 'expired' });
    await this.store.patchConnection(conn.connId, {
      joinId: null,
      joinRoomId: null,
      authDeadline: c.now + POST_RESOLUTION_GRACE_MS,
    });
  }
}

/**
 * Transport-agnostic relay core implementing ADR-0003 (pairing, first-message authentication and per-message
 * authorization) plus docs/adr/AMENDMENTS-REV2.md on top of PROTOCOL.md rev 3.
 *
 * The core holds no per-connection memory: every piece of state lives behind the RoomStore port, so the same
 * code runs in a single Node process (MemoryRoomStore) and in stateless Lambda invocations (DynamoDbRoomStore).
 * Handlers return Actions; adapters execute them. Adapters must process messages of one connection in order.
 *
 * Adapters reach inbound frames only through `processInbound` (PK-10): it runs every step of PROTOCOL.md section 4
 * in order. They never parse, validate or forward a frame themselves.
 */
import {
  HashKeys,
  constantTimeEqualHex,
  hashCredential,
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
import type { AuthFailReason, CloseReason, LogEvent } from './logger.js';
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
import type { ResumeResult, RoomStore } from './room-store.js';
import {
  CLOSE,
  type Action,
  type CodeRecord,
  type ConnectionRecord,
  type JoinRecord,
  type MetricName,
  type OriginState,
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
  /** room.create per source per hour (A3-03). */
  roomCreatePerSourcePerHour: number;
  /** Failed join.request attempts on one connection before it is closed. */
  joinFailPerConnection: number;
  /** Valid-code joins that end rejected, expired or abandoned, per source per 10 minutes (A3-02). */
  validJoinFailuresPerSourcePer10Min: number;
  /** auth.resume failures per source per minute and per room_id per minute (A3-05). */
  resumeFailuresPerMinutePerSource: number;
  resumeFailuresPerMinutePerRoom: number;
  /** $connect attempts per source per minute (A3-03). */
  connectsPerMinutePerSource: number;
  /** Concurrent unauthenticated connections per source (A3-03). */
  maxUnauthConnectionsPerSource: number;
  /** Minimum time between TV-initiated pairing.refresh calls of one room (A3-02). */
  refreshMinIntervalMs: number;
  /** A resume that would supersede a connection heard within this window is refused (A3-07). 0 disables. */
  supersedeGuardMs: number;
  /** Invalid/forbidden messages tolerated per connection before it is closed. */
  invalidStrikesBeforeClose: number;
  /** Rate-limited messages tolerated per connection before it is closed ("sustained abuse"). */
  rateStrikesBeforeClose: number;
}

export const DEFAULT_LIMITS: RelayLimitConfig = {
  phone: { burstPerSec: 60, sustainedPerSec: 40 },
  tv: { burstPerSec: 40, sustainedPerSec: 20 },
  roomCreatePerSourcePerHour: 30,
  joinFailPerConnection: 3,
  validJoinFailuresPerSourcePer10Min: 6,
  resumeFailuresPerMinutePerSource: 10,
  resumeFailuresPerMinutePerRoom: 10,
  connectsPerMinutePerSource: 20,
  maxUnauthConnectionsPerSource: 5,
  refreshMinIntervalMs: 10_000,
  supersedeGuardMs: LIMITS.heartbeatWindowMs,
  invalidStrikesBeforeClose: 20,
  rateStrikesBeforeClose: 120,
};

export const DEFAULT_LIVE_ROOM_CAP = 200;

/**
 * One-step grace for a lost auth.ok (A3-07): the credential a rotation just consumed is accepted exactly once more,
 * within this long after the rotation and only while the issued next credential has not been presented. The relay
 * answers with the SAME next credential and does not rotate again.
 */
export const CREDENTIAL_GRACE_MS = 60_000;

/**
 * Exponential delay instead of a hard block (A3-03): failures 1 to 3 are free; after the 4th the next attempt
 * must wait 2 s, then 4 s, 8 s, 16 s, 32 s, and 60 s from the 9th failure on. The count resets after 10 minutes
 * without a failure. There is no lock-out: a real user behind a shared address is delayed, never locked out.
 */
export const BACKOFF_FREE_FAILURES = 3;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 60_000;
export const BACKOFF_RESET_MS = 10 * 60_000;
export function backoffDelayMs(failures: number): number {
  if (failures <= BACKOFF_FREE_FAILURES) return 0;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failures - BACKOFF_FREE_FAILURES - 1));
}

export type RelayEnvironment = 'development' | 'staging' | 'production';

export class RelayConfigError extends Error {
  override name = 'RelayConfigError';
}

export interface RelayConfig {
  /** Exact-match allowlist of PHONE page origins (ADR-0003 section 8). */
  phoneOrigins: readonly string[];
  /** TV web-preview origins. Development and staging only: a production configuration refuses a non-empty list. */
  tvPreviewOrigins?: readonly string[];
  /**
   * Master secret for the keyed hashes (pairing codes, source addresses). At least 16 characters; there is
   * deliberately no unkeyed fallback. Local: random per process. AWS: an SSM SecureString parameter.
   */
  hashSecret: string;
  /** `production` rejects `client.platform: test` and refuses preview origins. Default `development`. */
  environment?: RelayEnvironment;
  /** Global cap on live rooms (A3-03). Default 200. */
  liveRoomCap?: number;
  /** Kill switch: when it returns true, new connections are closed with 4503 and messages are rejected. */
  isDisabled?: () => boolean;
  /** Bind session-scoped messages to the room's active session (default true). Cues are always bound. */
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
  /** Value of the Origin header; null/undefined when the header is absent. The literal "null" is a present value. */
  origin: string | null | undefined;
  /** Source address (or any stable per-source string). Hashed immediately; never stored or logged raw. */
  sourceKey: string;
  now: number;
}

export interface InboundContext {
  connId: string;
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
const MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * 60_000;
const CREATE_WINDOW_MS = 60 * 60_000;

function peerConnOf(room: RoomRecord, role: PeerRole): string | null {
  return role === 'tv' ? (room.phone?.connId ?? null) : room.tv.connId;
}
function slotOf(room: RoomRecord, role: PeerRole): SlotRecord | null {
  return role === 'tv' ? room.tv : room.phone;
}
function epochOf(room: RoomRecord, role: PeerRole): number {
  return role === 'tv' ? room.tvEpoch : room.phoneEpoch;
}

export class RelayCore {
  private readonly store: RoomStore;
  private readonly phoneOrigins: ReadonlySet<string>;
  private readonly previewOrigins: ReadonlySet<string>;
  private readonly keys: HashKeys;
  private readonly rb: RandomBytes;
  private readonly mono: () => number;
  private readonly disabled: () => boolean;
  private readonly bindSessions: boolean;
  private readonly limits: RelayLimitConfig;
  private readonly environment: RelayEnvironment;
  private readonly liveRoomCap: number;

  constructor(deps: RelayDeps) {
    const cfg = deps.config;
    this.store = deps.store;
    this.phoneOrigins = new Set(cfg.phoneOrigins);
    this.previewOrigins = new Set(cfg.tvPreviewOrigins ?? []);
    this.environment = cfg.environment ?? 'development';
    if (this.environment === 'production' && this.previewOrigins.size > 0) {
      throw new RelayConfigError('a production configuration must not allow TV web-preview origins');
    }
    for (const o of this.previewOrigins) {
      if (this.phoneOrigins.has(o)) throw new RelayConfigError('an origin cannot be both a phone origin and a TV preview origin');
    }
    try {
      this.keys = new HashKeys(cfg.hashSecret);
    } catch (e) {
      throw new RelayConfigError(e instanceof Error ? e.message : 'invalid hash secret');
    }
    this.rb = deps.randomBytes ?? systemRandomBytes;
    this.mono = deps.monotonicMs ?? (() => performance.now());
    this.disabled = cfg.isDisabled ?? (() => false);
    this.bindSessions = cfg.bindSessions ?? true;
    this.limits = { ...DEFAULT_LIMITS, ...(cfg.limits ?? {}) };
    this.liveRoomCap = cfg.liveRoomCap ?? DEFAULT_LIVE_ROOM_CAP;
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
    // Origin classification (A3-08). A present header is classified or rejected; the literal "null" is present
    // and therefore rejected like any other value that is not an exact match.
    let originState: OriginState = 'absent';
    if (ctx.origin !== null && ctx.origin !== undefined) {
      if (this.phoneOrigins.has(ctx.origin)) originState = 'phone_origin';
      else if (this.previewOrigins.has(ctx.origin)) originState = 'tv_preview_origin';
      else {
        this.log(c, { event: 'origin_rejected', code: 'origin_rejected' });
        this.metric(c, 'origin_rejected');
        c.out.push({ kind: 'close', connId, code: CLOSE.ORIGIN, reason: 'origin_rejected' });
        return c.out;
      }
    }
    const sourceHash = this.keys.source(ctx.sourceKey, ctx.now);
    // $connect budget and concurrent-unauthenticated cap per source.
    const refuse = (): Action[] => {
      this.metric(c, 'connect_refused');
      this.log(c, { event: 'rate_limited', code: 'rate_limited' });
      c.out.push({ kind: 'close', connId, code: CLOSE.RATE_LIMITED, reason: 'too_many_connections' });
      return c.out;
    };
    if ((await this.store.incrementCounter(`cx:${sourceHash}`, MINUTE_MS, ctx.now)) > this.limits.connectsPerMinutePerSource) {
      return refuse();
    }
    if (!(await this.store.acquireUnauthSlot(sourceHash, this.limits.maxUnauthConnectionsPerSource, ctx.now))) {
      return refuse();
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
        originState,
        sourceHash,
        unauthHeld: true,
        epoch: 0,
        roomId: null,
        role: null,
        generation: 0,
        joinId: null,
        joinRoomId: null,
      },
      ctx.now,
    );
    this.log(c, { event: 'connect' });
    this.schedule(c, connId, LIMITS.authDeadlineMs);
    return c.out;
  }

  /**
   * The single inbound entry point (PK-10). Runs every step of PROTOCOL.md section 4 in order:
   * frame type and size, JSON and envelope, type, audio guard, identity binding, payload schema (the validator),
   * then connection state, direction and authorization, duplicates, generation and sequence, rate limits, and
   * finally forwarding of the canonical re-serialisation or application by the relay.
   * Adapters pass the frame as it arrived: a string for a text frame, a marker for any other frame (never decoded).
   */
  async processInbound(frame: RawFrame, ctx: InboundContext): Promise<Action[]> {
    const { connId, now } = ctx;
    const c = this.ctx(now);
    const bytes = typeof frame === 'string' ? Buffer.byteLength(frame, 'utf8') : frame.bytes;

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
      const gone = await this.store.deleteConnection(connId);
      if (gone?.unauthHeld) await this.store.releaseUnauthSlot(gone.sourceHash);
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
        await this.deadlineDrop(c, conn);
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

    // Text frames only: anything else is refused here, undecoded.
    if (typeof frame !== 'string') {
      await this.replyError(c, conn, 'binary_rejected', 'binary_frames_not_allowed', info, false);
      await this.drop(c, conn, CLOSE.BINARY, 'binary_rejected');
      return c.out;
    }

    const parsed = parseWireText(frame, now);
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

  /**
   * Authentication-deadline check for one connection (A3-09). The local sweep calls it for every unauthenticated
   * connection; the Lambda adapter calls it from the SQS delay queue (5 s after connect, 65 s after a join request,
   * 5 s after a join ended). Idempotent: a connection that authenticated, is gone, or whose deadline is still in
   * the future is left alone. A pending join that passed its 60 s life is expired first (burning its code).
   */
  async onDeadlineCheck(connId: string, now: number): Promise<Action[]> {
    const c = this.ctx(now);
    const conn = await this.store.getConnection(connId);
    if (conn && !conn.authenticated) await this.checkDeadline(c, conn);
    return c.out;
  }

  /** Sweep (local adapter): unauthenticated deadlines, expired pending joins, connections idle past the heartbeat window. */
  async onTick(now: number): Promise<Action[]> {
    const c = this.ctx(now);
    const conns = await this.store.listConnections();
    for (const conn of conns) {
      if (!conn.authenticated) {
        await this.checkDeadline(c, conn);
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
        return this.handleRoomCreate(c, conn, msg, info);
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

  /** Marks a connection authenticated and gives back its concurrent-unauthenticated slot. False if it vanished. */
  private async authenticateConn(
    c: Ctx,
    conn: ConnectionRecord,
    fields: { roomId: string; role: PeerRole; generation: number; epoch: number },
  ): Promise<boolean> {
    const ok = await this.store.patchConnection(conn.connId, {
      authenticated: true,
      authDeadline: 0,
      roomId: fields.roomId,
      role: fields.role,
      generation: fields.generation,
      epoch: fields.epoch,
      joinId: null,
      joinRoomId: null,
      unauthHeld: false,
    });
    if (ok && conn.unauthHeld) await this.store.releaseUnauthSlot(conn.sourceHash);
    void c;
    return ok;
  }

  private async handleRoomCreate(c: Ctx, conn: ConnectionRecord, msg: ParsedMessage, info: MsgInfo): Promise<void> {
    // TV-role operation: absent or tv_preview_origin only; a phone-page origin cannot act as a TV.
    if (conn.originState === 'phone_origin') {
      await this.originRefuse(c, conn, info);
      return;
    }
    // client.platform is self-declared and never a trust signal; production simply refuses the test value.
    const platform = (msg.payload as { client?: { platform?: string } }).client?.platform;
    if (this.environment === 'production' && platform === 'test') {
      await this.reject(c, conn, 'unauthorized', 'platform_not_allowed', info);
      return;
    }
    const n = await this.store.incrementCounter(`rc:${conn.sourceHash}`, CREATE_WINDOW_MS, c.now);
    if (n > this.limits.roomCreatePerSourcePerHour) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'room.create' });
      await this.replyError(c, conn, 'rate_limited', 'room_create_limit', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }
    if ((await this.store.countLiveRooms(c.now)) >= this.liveRoomCap) {
      this.metric(c, 'room_cap_reached');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'room.create' });
      await this.replyError(c, conn, 'rate_limited', 'capacity', info, false);
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
        codeHash: this.keys.code(code),
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
        lastRefresh: 0,
        activeSessionId: null,
        tv: { credHash, credExpiresAt, generation: 1, lastSeq: -1, connId: conn.connId, prevCredHash: null, prevAt: 0 },
        phone: null,
        phoneGeneration: 0,
        tvEpoch: 1,
        phoneEpoch: 0,
      };
      const r = await this.store.createRoom(room, codeRecord, c.now);
      if (r === 'ok') created = true;
      else if (r === 'room_exists') break;
    }
    if (!created || !codeRecord) {
      await this.reject(c, conn, 'internal', 'room_create_failed', info, false);
      return;
    }
    if (!(await this.authenticateConn(c, conn, { roomId, role: 'tv', generation: 1, epoch: 1 }))) {
      await this.store.closeRoom(roomId, c.now);
      return;
    }
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

  private async originRefuse(c: Ctx, conn: ConnectionRecord, info: MsgInfo): Promise<void> {
    this.metric(c, 'origin_rejected');
    await this.replyError(c, conn, 'origin_rejected', 'origin_not_allowed_for_role', info, false);
    await this.drop(c, conn, CLOSE.ORIGIN, 'origin_rejected');
  }

  private async handleJoinRequest(c: Ctx, conn: ConnectionRecord, msg: ParsedMessage, info: MsgInfo): Promise<void> {
    // Phone-role operation: requires the phone origin (a missing Origin or the TV preview origin is refused).
    if (conn.originState !== 'phone_origin') {
      await this.originRefuse(c, conn, info);
      return;
    }
    if (conn.joinId) {
      // The phone is busy with its own pending request: it learns only that.
      await this.relaySend(c, conn.connId, null, 'join.rejected', { reason: 'busy' });
      return;
    }
    const src = conn.sourceHash;
    const jfKey = `jf:${src}`;
    // Hard budget for valid-code joins that ended rejected, expired or abandoned (A3-02).
    if ((await this.store.getCounter(`vj:${src}`, TEN_MINUTES_MS, c.now)) >= this.limits.validJoinFailuresPerSourcePer10Min) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'join.request' });
      await this.replyError(c, conn, 'rate_limited', 'too_many_ended_joins', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }
    // Exponential delay after repeated wrong codes (A3-03): refused, not counted again, not locked out.
    const st = await this.store.getBackoffState(jfKey, c.now, BACKOFF_RESET_MS);
    const delay = backoffDelayMs(st.failures);
    if (delay > 0 && c.now < st.lastFailureAt + delay) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: 'join.request' });
      await this.replyError(c, conn, 'rate_limited', 'retry_later', info, false);
      return;
    }
    if (conn.joinFailures >= this.limits.joinFailPerConnection) {
      await this.replyError(c, conn, 'rate_limited', 'too_many_failed_joins', info, false);
      await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }

    const code = msg.payload.pairing_code as string;
    const codeRec = await this.store.findRoomByCodeHash(this.keys.code(code));
    if (!codeRec) return this.joinFailure(c, conn, 'not_found', 'unknown_code', info, jfKey);
    if (c.now >= codeRec.expiresAt) return this.joinFailure(c, conn, 'expired', 'code_expired', info, jfKey);
    const room = await this.store.getRoom(codeRec.roomId);
    if (!room || room.closed) return this.joinFailure(c, conn, 'not_found', 'unknown_code', info, jfKey);
    if (c.now >= room.expiresAt) return this.joinFailure(c, conn, 'expired', 'room_expired', info, jfKey);

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
      {
        roomId: room.roomId,
        joinId,
        codeHash: codeRec.codeHash,
        phoneConnId: conn.connId,
        confirmDigits,
        expiresAt,
        state: 'pending',
      },
      c.now,
    );
    if (created === 'busy') {
      // Another join is pending for this room: the phone receives only join.rejected {busy} (A3-10).
      this.metric(c, 'join_rejected');
      this.log(c, { event: 'join_rejected', code: 'join_busy', room: roomHashPrefix(room.roomId) });
      await this.relaySend(c, conn.connId, null, 'join.rejected', { reason: 'busy' });
      return;
    }
    await this.store.patchConnection(conn.connId, {
      joinId,
      joinRoomId: room.roomId,
      authDeadline: c.now + LIMITS.authDeadlineWhileJoinPendingMs,
    });
    this.schedule(c, conn.connId, LIMITS.authDeadlineWhileJoinPendingMs);
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
    jfKey: string,
  ): Promise<void> {
    await this.store.recordBackoffFailure(jfKey, c.now, BACKOFF_RESET_MS);
    const n = await this.store.bumpConnectionCounter(conn.connId, 'joinFailures');
    this.metric(c, 'join_failed');
    this.log(c, { event: 'join_failed', code, type: 'join.request' });
    await this.replyError(c, conn, code, detail, info, false);
    if (n >= this.limits.joinFailPerConnection) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
  }

  /**
   * One generic failure to the client (A3-05); the specific reason goes to the server-side log only. Counts
   * against the per-source and per-room_id budgets.
   */
  private async resumeFail(
    c: Ctx,
    conn: ConnectionRecord,
    reason: AuthFailReason,
    info: MsgInfo,
    roomIdAttempted: string,
    count = true,
  ): Promise<void> {
    if (count) {
      await this.store.incrementCounter(`af:${conn.sourceHash}`, MINUTE_MS, c.now);
      await this.store.incrementCounter(`ar:${roomIdAttempted}`, MINUTE_MS, c.now);
    }
    const n = await this.store.bumpConnectionCounter(conn.connId, 'joinFailures');
    this.metric(c, 'auth_failed');
    this.log(c, { event: 'auth_failed', code: reason, type: 'auth.resume' });
    await this.replyError(c, conn, 'unauthorized', 'resume_failed', info, false);
    if (n >= this.limits.joinFailPerConnection) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
  }

  private async handleAuthResume(c: Ctx, conn: ConnectionRecord, msg: ParsedMessage, info: MsgInfo): Promise<void> {
    const p = msg.payload as { room_id: string; role: PeerRole; credential: string };
    if (p.role !== msg.envelope.sender_role) {
      await this.resumeFail(c, conn, 'role_mismatch', info, p.room_id);
      return;
    }
    // Origin rules by role (A3-08): phone operations need the phone origin; TV operations must not carry it.
    if (p.role === 'phone' ? conn.originState !== 'phone_origin' : conn.originState === 'phone_origin') {
      await this.originRefuse(c, conn, info);
      return;
    }
    if (
      (await this.store.getCounter(`af:${conn.sourceHash}`, MINUTE_MS, c.now)) >= this.limits.resumeFailuresPerMinutePerSource ||
      (await this.store.getCounter(`ar:${p.room_id}`, MINUTE_MS, c.now)) >= this.limits.resumeFailuresPerMinutePerRoom ||
      conn.joinFailures >= this.limits.joinFailPerConnection
    ) {
      this.metric(c, 'rate_limited');
      await this.resumeFail(c, conn, 'throttled', info, p.room_id, false);
      return;
    }

    const room = await this.store.getRoom(p.room_id);
    if (!room) return this.resumeFail(c, conn, 'unknown_room', info, p.room_id);
    if (room.closed) return this.resumeFail(c, conn, 'room_closed', info, p.room_id);
    const slot = slotOf(room, p.role);
    if (!slot) return this.resumeFail(c, conn, 'credential_revoked', info, p.room_id);
    const presentedHash = hashCredential(p.credential);
    // Rotation: a normal resume consumes the presented credential and installs the next one. If the presented
    // credential is the one the LAST rotation consumed, it may be a retry after a lost auth.ok: within the grace
    // (60 s, next credential not yet presented, used once) the same next credential is re-issued.
    let graceNext: string | null = null;
    if (!verifyCredential(p.credential, slot.credHash)) {
      const derived = this.keys.nextCredential(room.roomId, p.role, presentedHash);
      if (
        slot.prevCredHash !== null &&
        constantTimeEqualHex(slot.prevCredHash, presentedHash) &&
        c.now - slot.prevAt < CREDENTIAL_GRACE_MS &&
        constantTimeEqualHex(slot.credHash, hashCredential(derived))
      ) {
        graceNext = derived;
      } else if (await this.store.wasCredentialConsumed(room.roomId, p.role, presentedHash, c.now)) {
        // Any other presentation of a consumed credential is a stolen or replayed one: revoke the role (A3-07).
        await this.revokeForReuse(c, room, p.role);
        return this.resumeFail(c, conn, 'credential_reused', info, p.room_id);
      } else {
        return this.resumeFail(c, conn, 'bad_credential', info, p.room_id);
      }
    }
    if (c.now >= slot.credExpiresAt || c.now >= room.expiresAt) {
      return this.resumeFail(c, conn, 'credential_expired', info, p.room_id);
    }
    // Rooms with no connection for 30 minutes are closed (PROTOCOL.md section 7); checked logically, here.
    const noConnections = room.tv.connId === null && (room.phone?.connId ?? null) === null;
    if (noConnections && c.now - room.lastConnChange > LIMITS.roomIdleCloseMs) {
      await this.store.closeRoom(room.roomId, c.now);
      return this.resumeFail(c, conn, 'room_idle_closed', info, p.room_id);
    }
    // A resume must not take over a connection that was heard from recently (A3-07): a stolen credential cannot
    // silently displace a live phone or TV. After the heartbeat window of silence the old connection counts as dead.
    // The refusal happens before rotation, so a refused resume does not consume the credential.
    if (this.limits.supersedeGuardMs > 0 && slot.connId && slot.connId !== conn.connId) {
      const live = await this.store.getConnection(slot.connId);
      if (live && c.now - live.lastSeen < this.limits.supersedeGuardMs) {
        return this.resumeFail(c, conn, 'would_supersede', info, p.room_id);
      }
    }

    let nextCredential: string;
    let res: ResumeResult;
    if (graceNext !== null) {
      nextCredential = graceNext;
      res = await this.store.resumeGrace({
        roomId: room.roomId,
        role: p.role,
        connId: conn.connId,
        presentedHash,
        currentHash: slot.credHash,
        windowMs: CREDENTIAL_GRACE_MS,
        now: c.now,
      });
      if (res.ok) this.metric(c, 'credential_grace');
    } else {
      // The next credential is derived (see HashKeys.nextCredential), valid 2 h from now (never beyond the room's
      // life); the rotation, the generation bump and the tombstone of the consumed credential are one atomic step.
      nextCredential = this.keys.nextCredential(room.roomId, p.role, presentedHash);
      res = await this.store.resumeRole({
        roomId: room.roomId,
        role: p.role,
        connId: conn.connId,
        presentedHash,
        nextHash: hashCredential(nextCredential),
        nextExpiresAt: Math.min(c.now + LIMITS.credentialTtlMs, room.expiresAt),
        now: c.now,
      });
    }
    if (!res.ok) {
      if (res.reason === 'reused') {
        // Lost a race against another resume with the same credential, or replayed it: same consequence.
        await this.revokeForReuse(c, room, p.role);
        return this.resumeFail(c, conn, 'credential_reused', info, p.room_id);
      }
      const reason: AuthFailReason =
        res.reason === 'closed' || res.reason === 'no_room'
          ? 'room_closed'
          : res.reason === 'cred_expired' || res.reason === 'room_expired'
            ? 'credential_expired'
            : res.reason === 'no_slot'
              ? 'credential_revoked'
              : 'bad_credential';
      return this.resumeFail(c, conn, reason, info, p.room_id);
    }

    if (!(await this.authenticateConn(c, conn, { roomId: room.roomId, role: p.role, generation: res.generation, epoch: res.epoch }))) {
      await this.store.detachConnection(room.roomId, p.role, conn.connId, c.now);
      return;
    }

    // Supersede an older connection of the same role.
    if (res.previousConnId && res.previousConnId !== conn.connId) {
      const old = await this.store.getConnection(res.previousConnId);
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
      generation: res.generation,
      peer_connected: peerConnId !== null,
      phone_paired: room.phone !== null && room.phone.credExpiresAt > c.now,
      next_credential: nextCredential,
    });
    // The peer is told about every (re)connection of the other role, with the new generation: a phone supersede
    // is therefore always visible to the TV (A3-07).
    if (peerConnId) {
      await this.relaySend(c, peerConnId, room.roomId, 'peer.state', {
        role: p.role,
        connected: true,
        generation: res.generation,
      });
    }
  }

  /**
   * A consumed credential was presented again: that role can no longer be trusted (A3-07). A phone is revoked
   * (its slot cleared and its connection dropped); a TV credential reuse closes the whole room, since without a
   * trustworthy TV nothing in the room is. The other side is told: error `revoked` with detail `credential_reuse`
   * ("Pairing may be compromised. Pair again.") plus the usual peer.state.
   */
  private async revokeForReuse(c: Ctx, room: RoomRecord, role: PeerRole): Promise<void> {
    const roomRef = roomHashPrefix(room.roomId);
    this.metric(c, 'credential_reuse');
    this.log(c, { event: 'credential_reuse', role, room: roomRef });
    const fresh = (await this.store.getRoom(room.roomId)) ?? room;
    const noInfo: MsgInfo = { ref: null, type: null, bytes: 0 };
    const tell = async (connId: string | null, aboutRole: PeerRole | null, generation: number): Promise<void> => {
      if (!connId) return;
      const target = await this.store.getConnection(connId);
      if (!target) return;
      await this.replyError(c, target, 'revoked', 'credential_reuse', noInfo, false);
      if (aboutRole) {
        await this.relaySend(c, target.connId, room.roomId, 'peer.state', { role: aboutRole, connected: false, generation });
      }
    };
    if (role === 'phone') {
      const phoneConnId = fresh.phone?.connId ?? null;
      const phoneGen = fresh.phone?.generation ?? fresh.phoneGeneration;
      await this.store.revokePhone(room.roomId, c.now);
      await tell(fresh.tv.connId, 'phone', phoneGen);
      if (phoneConnId) {
        const phone = await this.store.getConnection(phoneConnId);
        if (phone) {
          await this.replyError(c, phone, 'revoked', 'credential_reuse', noInfo, false);
          await this.drop(c, phone, CLOSE.UNPAIRED, 'revoked');
        }
      }
    } else {
      const tvConnId = fresh.tv.connId;
      const phoneConnId = fresh.phone?.connId ?? null;
      await this.store.closeRoom(room.roomId, c.now);
      for (const id of [phoneConnId, tvConnId]) {
        if (!id) continue;
        const target = await this.store.getConnection(id);
        if (!target) continue;
        await this.replyError(c, target, 'revoked', 'credential_reuse', noInfo, false);
        await this.drop(c, target, CLOSE.ROOM_CLOSED, 'room_closed');
      }
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
    if (!slot || conn.epoch !== epochOf(room, role)) {
      // Revocation (unpair, room close, credential revoked) is a role epoch the connection no longer matches:
      // at most the message already in flight gets through (A3-11).
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
    // two counter increments rather than several conditional writes, and before any message id is recorded so a
    // rate-limited message never burns its id. Only the precedence of simultaneous violations differs.
    if (await this.isRateLimited(c, conn, role)) {
      this.metric(c, 'rate_limited');
      this.log(c, { event: 'rate_limited', code: 'rate_limited', type: msg.type, role, room: roomHashPrefix(roomId) });
      await this.replyError(c, conn, 'rate_limited', 'rate_limited', info, false);
      const n = await this.store.bumpConnectionCounter(conn.connId, 'rateStrikes');
      if (n >= this.limits.rateStrikesBeforeClose) await this.drop(c, conn, CLOSE.RATE_LIMITED, 'rate_limited');
      return;
    }

    // Step 8: session binding, peer presence, duplicate id, generation, sequence.
    const target = forwardTarget(msg.type, role);
    const sessionBound =
      env.session_id !== null &&
      target !== null &&
      msg.type !== 'ack' &&
      msg.type !== 'mic.state' &&
      msg.type !== 'session.begin';
    // Cues are always tied to the session announced in session.begin (A4-07), whatever bindSessions says.
    if (sessionBound && (this.bindSessions || msg.type === 'cue') && room.activeSessionId !== env.session_id) {
      return this.reject(c, conn, 'stale', 'session', info);
    }

    const peerConnId = target === null ? null : target === 'tv' ? room.tv.connId : (room.phone?.connId ?? null);
    if (target !== null && !peerConnId) {
      this.metric(c, 'peer_offline', 1, msg.type);
      // Level frames are dropped silently: the TV cancels the window on link loss and an error storm at 20 Hz
      // would cost more than it helps. Everything else is told the peer is offline (an error, so it is logged).
      if (msg.type !== 'level') await this.replyError(c, conn, 'not_found', 'peer_offline', info, false);
      return;
    }

    // Duplicate check BEFORE generation and sequence (PROTOCOL.md revision 2): a duplicate message_id inside the
    // recent window of this (room, role) is dropped silently. The id is recorded now so that detection is atomic
    // under concurrency, and forgotten again if the message is rejected below: only accepted messages keep an id.
    if ((await this.store.recordMessageId(roomId, role, env.message_id, c.now)) === 'duplicate') {
      this.metric(c, 'duplicate_dropped', 1, msg.type);
      return;
    }
    const rejectAfterRecord = async (code: ErrorCode, detail: string): Promise<void> => {
      await this.store.forgetMessageId(roomId, role, env.message_id);
      await this.reject(c, conn, code, detail, info);
    };
    if (env.producer_generation !== conn.generation) return rejectAfterRecord('stale', 'generation');
    const seq = await this.store.acceptSequence(roomId, role, env.producer_generation, env.sequence);
    if (seq === 'replay') return rejectAfterRecord('replay', 'sequence');
    if (seq === 'stale') return rejectAfterRecord('stale', 'generation');

    if (msg.type === 'cue') {
      // Per room, tied to the announced session id (A4-07); the cue text is never stored.
      const r = await this.store.consumeCue(roomId, room.activeSessionId as string, LIMITS.maxCuesPerSession, c.now);
      if (r === 'limit') return rejectAfterRecord('cue_limit', 'cue_limit');
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
    // The canonical re-serialisation of the validated clean copy, never the received frame (PK-04).
    c.out.push({ kind: 'send', connId: peerConnId, data: msg.canonical });
    if (msg.type === 'session.begin') {
      await this.store.setActiveSession(room.roomId, msg.envelope.session_id);
    } else if (msg.type === 'session.end' && room.activeSessionId === msg.envelope.session_id) {
      await this.store.setActiveSession(room.roomId, null);
    }
    // Ordinary traffic is counted, not logged: per-minute aggregates by type (A2-04).
    this.metric(c, 'messages_forwarded', 1, msg.type);
    void conn;
  }

  // ---- TV operations ------------------------------------------------------------------------

  private async newCodeRecord(roomId: string, now: number): Promise<{ code: string; rec: CodeRecord }> {
    const code = newPairingCode(this.rb);
    return { code, rec: { codeHash: this.keys.code(code), roomId, expiresAt: now + LIMITS.pairingCodeTtlMs } };
  }

  private async handlePairingRefresh(c: Ctx, conn: ConnectionRecord, room: RoomRecord, info: MsgInfo): Promise<void> {
    for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
      const { code, rec } = await this.newCodeRecord(room.roomId, c.now);
      // Invalidates the previous code at once; limited to one refresh per 10 s per room.
      const r = await this.store.rotateCode(room.roomId, rec, c.now, { refreshMinIntervalMs: this.limits.refreshMinIntervalMs });
      if (r === 'ok') {
        this.log(c, { event: 'pairing_refreshed', role: 'tv', room: roomHashPrefix(room.roomId) });
        await this.relaySend(c, conn.connId, room.roomId, 'pairing.code', {
          pairing_code: code,
          code_expires_at: rec.expiresAt,
        });
        return;
      }
      if (r === 'too_soon') {
        this.metric(c, 'rate_limited');
        await this.reject(c, conn, 'rate_limited', 'refresh_too_soon', info, false);
        return;
      }
      if (r !== 'code_collision') break;
    }
    await this.reject(c, conn, 'internal', 'pairing_refresh_failed', info, false);
  }

  /**
   * Burns the room's live code and pushes a fresh one to the TV (A3-02): used when a join ends rejected, wrongly
   * answered or expired unanswered, so the code a bystander may have seen cannot be tried again.
   */
  private async burnCode(c: Ctx, roomId: string): Promise<void> {
    for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
      const { code, rec } = await this.newCodeRecord(roomId, c.now);
      const r = await this.store.rotateCode(roomId, rec, c.now);
      if (r === 'ok') {
        this.metric(c, 'code_burned');
        this.log(c, { event: 'code_burned', room: roomHashPrefix(roomId) });
        const room = await this.store.getRoom(roomId);
        if (room?.tv.connId) {
          await this.relaySend(c, room.tv.connId, roomId, 'pairing.code', {
            pairing_code: code,
            code_expires_at: rec.expiresAt,
          });
        }
        return;
      }
      if (r !== 'code_collision') return;
    }
  }

  /** A valid-code join that did not end in pairing counts against its source (A3-02). */
  private async countEndedJoin(c: Ctx, phoneConn: ConnectionRecord | null): Promise<void> {
    if (phoneConn) await this.store.incrementCounter(`vj:${phoneConn.sourceHash}`, TEN_MINUTES_MS, c.now);
  }

  private async closeOutJoin(c: Ctx, phoneConn: ConnectionRecord | null): Promise<void> {
    if (!phoneConn) return;
    await this.store.patchConnection(phoneConn.connId, {
      joinId: null,
      joinRoomId: null,
      authDeadline: c.now + POST_RESOLUTION_GRACE_MS,
    });
    this.schedule(c, phoneConn.connId, POST_RESOLUTION_GRACE_MS);
  }

  /** Expires a pending join that was not answered in time: tells both sides, burns the code, counts the source. */
  private async expireJoin(c: Ctx, join: JoinRecord, phoneConn: ConnectionRecord | null): Promise<boolean> {
    if ((await this.store.resolveJoin(join.roomId, join.joinId, 'expired', c.now)) !== 'ok') return false;
    this.log(c, { event: 'join_expired', code: 'expired', room: roomHashPrefix(join.roomId) });
    const room = await this.store.getRoom(join.roomId);
    if (room?.tv.connId) await this.relaySend(c, room.tv.connId, room.roomId, 'join.expired', { join_id: join.joinId });
    if (phoneConn) {
      await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'expired' });
      await this.closeOutJoin(c, phoneConn);
    }
    await this.countEndedJoin(c, phoneConn);
    await this.burnCode(c, join.roomId);
    return true;
  }

  private async handleJoinConfirm(
    c: Ctx,
    conn: ConnectionRecord,
    room: RoomRecord,
    msg: ParsedMessage,
    info: MsgInfo,
  ): Promise<void> {
    const p = msg.payload as { join_id: string; decision: 'accept' | 'reject' };
    // The join record lives under the confirming TV's own room: a join id of another room cannot be reached.
    const join = await this.store.getJoin(room.roomId);
    if (!join || join.joinId !== p.join_id || join.state !== 'pending') {
      return this.reject(c, conn, 'not_found', 'no_such_join', info);
    }
    const phoneConn = await this.store.getConnection(join.phoneConnId);
    const roomRef = roomHashPrefix(room.roomId);

    if (c.now >= join.expiresAt) {
      await this.expireJoin(c, join, phoneConn);
      return;
    }

    if (p.decision === 'reject') {
      // A reject (also what the TV sends after a wrong number pick) ends the join and burns the code.
      const r = await this.store.resolveJoin(room.roomId, join.joinId, 'rejected', c.now);
      if (r !== 'ok') return this.reject(c, conn, 'not_found', 'no_such_join', info);
      this.metric(c, 'join_rejected');
      this.log(c, { event: 'join_rejected', code: 'unauthorized', room: roomRef });
      if (phoneConn) {
        await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'rejected' });
        await this.closeOutJoin(c, phoneConn);
      }
      await this.countEndedJoin(c, phoneConn);
      await this.burnCode(c, room.roomId);
      return;
    }

    // accept
    if (!phoneConn) {
      await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now);
      await this.relaySend(c, conn.connId, room.roomId, 'join.expired', { join_id: join.joinId });
      return;
    }
    const phoneCredential = newCredential(this.rb);
    const credExpiresAt = Math.min(c.now + LIMITS.credentialTtlMs, room.expiresAt);
    // One atomic step: join pending and unexpired, room open and unexpired, slot empty, code still live; then
    // accepted + slot claimed + code consumed together (A3-10).
    const res = await this.store.acceptJoin({
      roomId: room.roomId,
      joinId: join.joinId,
      codeHash: join.codeHash,
      claim: { credHash: hashCredential(phoneCredential), credExpiresAt, connId: phoneConn.connId },
      now: c.now,
    });
    if (!res.ok) {
      switch (res.reason) {
        case 'join_expired':
          await this.expireJoin(c, join, phoneConn);
          return;
        case 'room_full':
          await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now);
          this.metric(c, 'join_rejected');
          this.log(c, { event: 'join_rejected', code: 'room_full', room: roomRef });
          await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'room_full' });
          await this.closeOutJoin(c, phoneConn);
          await this.countEndedJoin(c, phoneConn);
          return this.reject(c, conn, 'room_full', 'phone_slot_taken', info);
        case 'code_gone':
          // The code was burned or refreshed while this join waited: it can no longer be accepted.
          await this.store.resolveJoin(room.roomId, join.joinId, 'cancelled', c.now);
          await this.relaySend(c, phoneConn.connId, null, 'join.rejected', { reason: 'expired' });
          await this.closeOutJoin(c, phoneConn);
          await this.countEndedJoin(c, phoneConn);
          await this.relaySend(c, conn.connId, room.roomId, 'join.expired', { join_id: join.joinId });
          return;
        case 'closed':
        case 'room_expired':
          return this.reject(c, conn, 'expired', 'room_unavailable', info, false);
        default:
          return this.reject(c, conn, 'not_found', 'no_such_join', info);
      }
    }

    const authenticated = await this.authenticateConn(c, phoneConn, {
      roomId: room.roomId,
      role: 'phone',
      generation: res.generation,
      epoch: res.epoch,
    });
    if (!authenticated) {
      // The phone vanished between the claim and its authentication: it never received a credential. Release the
      // slot, tell the TV the request lapsed, and give it a fresh code (the claim consumed the old one).
      await this.store.revokePhone(room.roomId, c.now);
      await this.relaySend(c, conn.connId, room.roomId, 'join.expired', { join_id: join.joinId });
      await this.burnCode(c, room.roomId);
      return;
    }
    this.metric(c, 'join_accepted');
    this.log(c, { event: 'join_accepted', role: 'phone', room: roomRef });
    await this.relaySend(c, phoneConn.connId, room.roomId, 'join.accepted', {
      room_id: room.roomId,
      phone_credential: phoneCredential,
      credential_expires_at: credExpiresAt,
      generation: res.generation,
    });
    await this.relaySend(c, phoneConn.connId, room.roomId, 'peer.state', {
      role: 'tv',
      connected: true,
      generation: room.tv.generation,
    });
    await this.relaySend(c, conn.connId, room.roomId, 'peer.state', {
      role: 'phone',
      connected: true,
      generation: res.generation,
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
          await this.closeOutJoin(c, pending);
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

  private metric(c: Ctx, name: MetricName, value = 1, type?: MessageType): void {
    c.out.push({ kind: 'metric', name, value, ...(type ? { type } : {}) });
  }

  private schedule(c: Ctx, connId: string, delayMs: number): void {
    c.out.push({ kind: 'schedule', connId, delayMs });
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

  /** Authentication deadline missed: the same message-level behaviour on every adapter (an error, then the close). */
  private async deadlineDrop(c: Ctx, conn: ConnectionRecord): Promise<void> {
    this.log(c, { event: 'auth_deadline', code: 'auth_deadline' });
    await this.replyError(c, conn, 'unauthenticated', 'auth_deadline', { ref: null, type: null, bytes: 0 }, false);
    await this.drop(c, conn, CLOSE.UNAUTHENTICATED, 'auth_deadline');
  }

  private async checkDeadline(c: Ctx, conn: ConnectionRecord): Promise<void> {
    let cur: ConnectionRecord | null = conn;
    if (conn.joinId && conn.joinRoomId) {
      const join = await this.store.getJoin(conn.joinRoomId);
      if (join && join.joinId === conn.joinId && join.state === 'pending' && c.now >= join.expiresAt) {
        await this.expireJoin(c, join, conn);
        cur = await this.store.getConnection(conn.connId);
      }
    }
    if (cur && c.now >= cur.authDeadline) await this.deadlineDrop(c, cur);
  }

  private async afterGone(c: Ctx, conn: ConnectionRecord): Promise<void> {
    if (conn.unauthHeld) await this.store.releaseUnauthSlot(conn.sourceHash);
    if (conn.joinId && conn.joinRoomId) {
      const r = await this.store.resolveJoin(conn.joinRoomId, conn.joinId, 'cancelled', c.now);
      if (r === 'ok') {
        // The phone left with a pending request: counts against its source, like an expiry, but the code stays.
        await this.countEndedJoin(c, conn);
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
}

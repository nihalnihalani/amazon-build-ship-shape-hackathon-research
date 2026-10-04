import type { LogEvent } from './logger.js';

/** Output of every relay core handler. Adapters execute these in order. */
export type Action =
  | { kind: 'send'; connId: string; data: string }
  | { kind: 'close'; connId: string; code: number; reason: string }
  | { kind: 'log'; event: LogEvent }
  | { kind: 'metric'; name: MetricName; value: number };

export const METRIC_NAMES = [
  'rooms_created',
  'join_requested',
  'join_accepted',
  'join_rejected',
  'join_failed',
  'auth_failed',
  'rate_limited',
  'messages_rejected',
  'peer_offline',
  'superseded',
  'origin_rejected',
  'duplicate_dropped',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

/** WebSocket close codes used by the relay. 1003 and 1009 are the RFC 6455 codes; 44xx are application codes. */
export const CLOSE = {
  NORMAL: 1000,
  BINARY: 1003,
  TOO_BIG: 1009,
  /** Authentication deadline missed, credential expired or revoked, unknown connection. */
  UNAUTHENTICATED: 4401,
  ORIGIN: 4403,
  IDLE: 4408,
  SUPERSEDED: 4409,
  UNPAIRED: 4410,
  ROOM_CLOSED: 4411,
  /** Rate limit abuse, too many unauthenticated messages, too many invalid messages. */
  RATE_LIMITED: 4429,
  /** Kill switch (RELAY_DISABLED). */
  DISABLED: 4503,
} as const;

/** Marker for a binary frame: the relay never reads binary content, only that it arrived. */
export interface BinaryFrame {
  binary: true;
  bytes: number;
}
export type RawFrame = string | BinaryFrame;

export type PeerRole = 'tv' | 'phone';

export interface ConnectionRecord {
  connId: string;
  connectedAt: number;
  lastSeen: number;
  authenticated: boolean;
  /** Epoch ms by which an unauthenticated connection must authenticate. Ignored once authenticated. */
  authDeadline: number;
  unauthCount: number;
  /** Invalid / forbidden messages on this connection. */
  strikes: number;
  /** Rate-limited messages on this connection. */
  rateStrikes: number;
  /** Failed join or resume attempts on this connection. */
  joinFailures: number;
  relaySeq: number;
  originState: 'allowed' | 'missing';
  /** Opaque hash of the source address (never the address itself). */
  sourceHash: string;
  roomId: string | null;
  role: PeerRole | null;
  generation: number;
  /** Pending join (phone connection that has sent join.request and awaits TV confirmation). */
  joinId: string | null;
  joinRoomId: string | null;
}

export interface SlotRecord {
  credHash: string;
  credExpiresAt: number;
  generation: number;
  /** Last accepted sequence for the current generation; -1 before any message. */
  lastSeq: number;
  connId: string | null;
}

export interface RoomRecord {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  closed: boolean;
  /** Last time a connection attached to or detached from this room (idle-close rule). */
  lastConnChange: number;
  codeHash: string | null;
  activeSessionId: string | null;
  tv: SlotRecord;
  phone: SlotRecord | null;
  /** Last issued phone generation; survives revocation so generation numbers are never reused. */
  phoneGeneration: number;
}

export interface CodeRecord {
  codeHash: string;
  roomId: string;
  expiresAt: number;
}

export type JoinState = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface JoinRecord {
  roomId: string;
  joinId: string;
  phoneConnId: string;
  confirmDigits: string;
  expiresAt: number;
  state: JoinState;
}

export interface PhoneSlotClaim {
  credHash: string;
  credExpiresAt: number;
  connId: string;
}

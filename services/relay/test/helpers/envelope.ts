import { randomBytes } from 'node:crypto';
import { TYPE_SPECS, type MessageType, type Role } from '../../src/core/index.js';
import { VALID_PAYLOADS } from './fixtures.js';

export interface SendOptions {
  payload?: Record<string, unknown>;
  session?: string | null;
  window?: string | null;
  attempt?: string | null;
  seq?: number;
  gen?: number;
  messageId?: string;
  senderRole?: Role;
  roomId?: string | null;
  timestamp?: number;
}

/** The sender-side state an envelope needs. Both the in-process rig client and the real WebSocket client use it. */
export interface SenderState {
  roomId: string | null;
  role: Role | null;
  generation: number;
  nextSeq: number;
}

let idCounter = 0;
export function uid(prefix: string, len = 16): string {
  idCounter += 1;
  const body = `${idCounter}${randomBytes(12).toString('base64url')}`.padEnd(len, 'x').slice(0, len);
  return `${prefix}_${body}`;
}

export function buildEnvelope(s: SenderState, type: MessageType, now: number, o: SendOptions = {}): string {
  const spec = TYPE_SPECS[type];
  const payload = o.payload ?? VALID_PAYLOADS[type] ?? {};
  const pick = (rule: string, given: string | null | undefined, dflt: string): string | null => {
    if (given !== undefined) return given;
    return rule === 'req' ? dflt : null;
  };
  const preAuth = spec.auth === 'pre';
  const env = {
    protocol_version: 1,
    type,
    message_id: o.messageId ?? uid('m'),
    room_id: o.roomId !== undefined ? o.roomId : preAuth ? null : (s.roomId ?? null),
    session_id: pick(spec.ids[0], o.session, 's_session000001'),
    window_id: pick(spec.ids[1], o.window, 'w_window0000001'),
    attempt_id: pick(spec.ids[2], o.attempt, 'a_attempt000001'),
    sender_role: o.senderRole ?? s.role ?? spec.senders[0] ?? 'tv',
    producer_generation: o.gen ?? (preAuth ? 0 : s.generation),
    sequence: o.seq ?? s.nextSeq,
    event_timestamp: o.timestamp ?? now,
    payload,
  };
  if (o.seq === undefined) s.nextSeq += 1;
  return JSON.stringify(env);
}

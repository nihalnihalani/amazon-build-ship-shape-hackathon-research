import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  LIMITS,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  buildRelayMessage,
  forwardTarget,
  isAllowedSender,
  isPreAuthType,
  isPreOnlyType,
  isRelayOriginated,
  parseWireText,
  specFor,
  type MessageType,
} from '../src/core/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';
import { buildEnvelope } from './helpers/envelope.js';

const NOW = 1_800_000_000_000;
const ROOM = 'r_abcdefghijklmnopqrstuv';

/**
 * The relay's validation is the protocol package (see the package's own doc-consistency tests for the
 * PROTOCOL.md tables). These tests cover the port glue the relay relies on.
 */
describe('protocol port glue', () => {
  it('adapts a successful parse: keeps the exact raw text, byte length and typed envelope', () => {
    const raw = buildEnvelope({ roomId: ROOM, role: 'phone', generation: 1, nextSeq: 0 }, 'cue', NOW, {
      payload: { text: 'été' },
    });
    const r = parseWireText(raw, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.raw).toBe(raw);
      expect(r.message.bytes).toBe(Buffer.byteLength(raw));
      expect(r.message.type).toBe('cue');
      expect(r.message.envelope.sender_role).toBe('phone');
      expect(r.message.payload).toEqual({ text: 'été' });
    }
  });

  it('adapts a failure: code, constant detail, well-formed ref id, byte length', () => {
    const raw = buildEnvelope({ roomId: ROOM, role: 'phone', generation: 1, nextSeq: 0 }, 'cue', NOW, {
      messageId: 'm_refrefrefrefref01',
      payload: { text: '' },
    });
    const r = parseWireText(raw, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('bad_schema');
      expect(r.refMessageId).toBe('m_refrefrefrefref01');
      expect(r.bytes).toBe(Buffer.byteLength(raw));
      expect(r.detail.length).toBeLessThanOrEqual(64);
    }
  });

  it('applies the receiver clock to the +/-24 h sanity window', () => {
    const raw = buildEnvelope({ roomId: ROOM, role: 'tv', generation: 1, nextSeq: 0 }, 'ping', NOW, {});
    expect(parseWireText(raw, NOW + 24 * 3_600_000).ok).toBe(true);
    expect(parseWireText(raw, NOW + 24 * 3_600_000 + 1).ok).toBe(false);
  });

  it('classifies every type for the core: relay-originated, pre-only, pre-auth, forward target', () => {
    const originated = MESSAGE_TYPES.filter(isRelayOriginated).sort();
    expect(originated).toEqual(
      [
        'auth.ok', 'error', 'join.accepted', 'join.expired', 'join.pending', 'join.rejected', 'join.requested',
        'pairing.code', 'peer.state', 'pong', 'room.created', 'unpaired',
      ].sort(),
    );
    expect(MESSAGE_TYPES.filter(isPreOnlyType).sort()).toEqual(['auth.resume', 'join.request', 'room.create']);
    expect(MESSAGE_TYPES.filter(isPreAuthType).sort()).toEqual(['auth.resume', 'join.request', 'ping', 'room.create']);
    expect(forwardTarget('window.start', 'tv')).toBe('phone');
    expect(forwardTarget('level', 'phone')).toBe('tv');
    expect(forwardTarget('ack', 'tv')).toBe('phone');
    expect(forwardTarget('ack', 'phone')).toBe('tv');
    expect(forwardTarget('ack')).toBeNull();
    expect(forwardTarget('ping', 'tv')).toBeNull();
    expect(forwardTarget('unpair', 'tv')).toBeNull();
    expect(isAllowedSender('window.start', 'phone')).toBe(false);
    expect(isAllowedSender('window.start', 'tv')).toBe(true);
  });

  it('uses the documented limits and error codes', () => {
    expect(MAX_MESSAGE_BYTES).toBe(8192);
    expect(LIMITS.maxCuesPerSession).toBe(3);
    expect(LIMITS.heartbeatWindowMs).toBe(25_000);
    expect(LIMITS.authDeadlineMs).toBe(5_000);
    expect(LIMITS.authDeadlineWhileJoinPendingMs).toBe(65_000);
    expect(LIMITS.maxUnauthenticatedMessages).toBe(5);
    expect(LIMITS.pairingCodeTtlMs).toBe(600_000);
    expect(LIMITS.joinTtlMs).toBe(60_000);
    expect(LIMITS.credentialTtlMs).toBe(12 * 3_600_000);
    expect(LIMITS.roomTtlMs).toBe(12 * 3_600_000);
    expect(LIMITS.roomIdleCloseMs).toBe(30 * 60_000);
    expect(LIMITS.dedupeWindow).toBe(1024);
    expect(ERROR_CODES).toContain('cue_limit');
    expect(ERROR_CODES).toContain('origin_rejected');
  });
});

describe('relay-originated envelopes satisfy the package validator', () => {
  const PAYLOADS: Partial<Record<MessageType, Record<string, unknown>>> = {
    'room.created': {
      room_id: ROOM,
      pairing_code: 'ACDEFH',
      code_expires_at: NOW + 600_000,
      tv_credential: 'A'.repeat(43),
      credential_expires_at: NOW + 1000,
      generation: 1,
    },
    'pairing.code': { pairing_code: 'ACDEFH', code_expires_at: NOW + 600_000 },
    'join.pending': { join_id: 'j_abcdefghijklmnopqrstuv', confirm_digits: '07', expires_at: NOW + 60_000 },
    'join.requested': {
      join_id: 'j_abcdefghijklmnopqrstuv',
      device_label: 'Pixel',
      confirm_digits: '07',
      expires_at: NOW + 60_000,
    },
    'join.accepted': { room_id: ROOM, phone_credential: 'B'.repeat(43), credential_expires_at: NOW + 1000, generation: 1 },
    'join.rejected': { reason: 'busy' },
    'join.expired': { join_id: 'j_abcdefghijklmnopqrstuv' },
    'auth.ok': { role: 'tv', generation: 2, peer_connected: true, phone_paired: false },
    'peer.state': { role: 'phone', connected: false, generation: 1 },
    unpaired: { reason: 'tv_unpaired' },
    pong: { server_time: NOW },
    error: { code: 'rate_limited', ref_message_id: null, detail: 'rate_limited' },
  };
  const roomRule = (t: MessageType): string | null =>
    specFor(t).room === 'null' ? null : specFor(t).room === 'required' ? ROOM : null;

  it.each(Object.keys(PAYLOADS) as MessageType[])('%s', (type) => {
    const raw = buildRelayMessage({
      type,
      messageId: 'm_relaymessage00000001',
      roomId: roomRule(type),
      sequence: 4,
      nowMs: NOW,
      payload: PAYLOADS[type] as Record<string, unknown>,
    });
    const r = parseWireText(raw, NOW);
    expect(r.ok, `${type}: ${JSON.stringify(r)}`).toBe(true);
    if (r.ok) {
      expect(r.message.envelope.sender_role).toBe('relay');
      expect(r.message.envelope.producer_generation).toBe(0);
    }
  });

  it('covers every relay-originated type', () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual(MESSAGE_TYPES.filter(isRelayOriginated).sort());
  });

  it('keeps client fixtures valid for every client-sendable type that has one', () => {
    for (const t of MESSAGE_TYPES) {
      if (isRelayOriginated(t) || VALID_PAYLOADS[t] === undefined) continue;
      const raw = buildEnvelope({ roomId: ROOM, role: specFor(t).senders[0] ?? 'tv', generation: 1, nextSeq: 0 }, t, NOW);
      const r = parseWireText(raw, NOW);
      expect(r.ok, `${t}: ${JSON.stringify(r)}`).toBe(true);
    }
  });
});

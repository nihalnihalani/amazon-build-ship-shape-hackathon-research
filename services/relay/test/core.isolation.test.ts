/**
 * Role and room isolation (SEC-A12): the full type-by-role matrix, cross-room replay, and many concurrent rooms.
 * Runs on both stores.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { MESSAGE_TYPES, isPreOnlyType, isRelayOriginated, specFor, type MessageType } from '../src/core/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';
import { Rig, assertAllRigsNoLeaks, uid, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

const NOW_CRED = 'N'.repeat(43);
/** Valid payloads for the types that VALID_PAYLOADS does not cover (relay-originated and context-bound types). */
const EXTRA_PAYLOADS: Partial<Record<MessageType, Record<string, unknown>>> = {
  'join.request': { pairing_code: 'ACDEFH', device_label: 'x' },
  'auth.resume': { room_id: 'r_aaaaaaaaaaaaaaaaaaaaaa', role: 'tv', credential: NOW_CRED },
  'room.created': {
    room_id: 'r_aaaaaaaaaaaaaaaaaaaaaa',
    pairing_code: 'ACDEFH',
    code_expires_at: 1_800_000_600_000,
    tv_credential: NOW_CRED,
    credential_expires_at: 1_800_000_600_000,
    generation: 1,
  },
  'pairing.code': { pairing_code: 'ACDEFH', code_expires_at: 1_800_000_060_000 },
  'join.pending': { join_id: 'j_aaaaaaaaaaaaaaaaaaaaaa', confirm_digits: '07', expires_at: 1_800_000_060_000 },
  'join.requested': { join_id: 'j_aaaaaaaaaaaaaaaaaaaaaa', device_label: 'x', confirm_digits: '07', expires_at: 1_800_000_060_000 },
  'join.accepted': { room_id: 'r_aaaaaaaaaaaaaaaaaaaaaa', phone_credential: NOW_CRED, credential_expires_at: 1_800_000_600_000, generation: 1 },
  'join.rejected': { reason: 'busy' },
  'join.expired': { join_id: 'j_aaaaaaaaaaaaaaaaaaaaaa' },
  'auth.ok': { role: 'tv', generation: 1, peer_connected: true, phone_paired: true, next_credential: NOW_CRED },
  'peer.state': { role: 'tv', connected: true, generation: 1 },
  unpaired: { reason: 'tv_unpaired' },
  pong: { server_time: 1_800_000_000_000 },
  error: { code: 'internal', ref_message_id: null, detail: '' },
};

describe('type-by-role matrix: every message type from an authenticated TV and an authenticated phone', () => {
  it('forwards or handles exactly what the catalogue allows and refuses everything else with the documented code', async () => {
    const outcomes: string[] = [];
    for (const type of MESSAGE_TYPES) {
      for (const role of ['tv', 'phone'] as const) {
        const rig = new Rig();
        const tv = await rig.tvCreate();
        const phone = await rig.pair(tv);
        await rig.startSession(tv);
        rig.advance(1000);
        const sender = role === 'tv' ? tv : phone;
        const peer = role === 'tv' ? phone : tv;
        tv.clear();
        phone.clear();
        const payload = { ...(VALID_PAYLOADS[type] ?? EXTRA_PAYLOADS[type]) } as Record<string, unknown>;
        if (type === 'join.confirm') Object.assign(payload, { join_id: 'j_aaaaaaaaaaaaaaaaaaaaaa', decision: 'reject' });
        if (type === 'auth.resume') payload.role = role;
        if (type === 'room.created' || type === 'join.accepted') payload.room_id = tv.roomId; // must echo the envelope room
        // relay-originated envelopes and pre-auth types carry generation 0 and no room; send them as a client would
        const relayType = isRelayOriginated(type);
        await rig.send(sender, type, {
          payload,
          ...(relayType ? { gen: 0 } : {}),
          ...(type === 'auth.resume' || type === 'join.request' ? { roomId: null } : {}),
        });
        const spec = specFor(type);
        let expected: 'ok' | 'forbidden_direction' | 'unauthorized';
        if (relayType) expected = 'forbidden_direction';
        else if (!spec.senders.includes(role)) expected = 'forbidden_direction';
        else expected = isPreOnlyType(type) ? 'unauthorized' : 'ok'; // an authenticated client repeating a pre-auth operation
        const errs = sender.errors();
        if (expected === 'ok') {
          // the sender gets no error (a TV-only relay operation may answer; forward types must reach the peer)
          expect(errs.filter((e) => e !== 'not_found'), `${role} sends ${type}`).toEqual([]);
          if (spec.forwardTo !== null) {
            expect(peer.of(type), `${type} from ${role} reaches the peer`).toHaveLength(1);
          }
        } else {
          expect(errs, `${role} sends ${type}`).toEqual([expected]);
          expect(peer.of(type), `${type} from ${role} must not reach the peer`).toHaveLength(0);
        }
        outcomes.push(`${type}:${role}:${expected}`);
      }
    }
    expect(outcomes).toHaveLength(MESSAGE_TYPES.length * 2);
    expect(new Set(outcomes.map((o) => o.split(':')[2]))).toEqual(new Set(['ok', 'forbidden_direction', 'unauthorized']));
  }, 120_000);
});

describe('cross-room isolation', () => {
  it('a valid message of one room replayed from another room is rejected and never delivered', async () => {
    const rig = new Rig();
    const tvA = await rig.tvCreate();
    const phoneA = await rig.pair(tvA);
    await rig.startSession(tvA);
    const tvB = await rig.tvCreate();
    const phoneB = await rig.pair(tvB);
    await rig.startSession(tvB);
    rig.advance(1000);
    tvA.clear();
    tvB.clear();
    const raw = rig.buildMessage(phoneA, 'level');
    await rig.sendRaw(phoneA, raw);
    expect(tvA.of('level')).toHaveLength(1);
    await rig.sendRaw(phoneB, raw); // the same bytes, sent from room B's connection
    expect(phoneB.errors()).toEqual(['unauthorized']);
    expect(phoneB.lastError().payload.detail).toBe('room_id');
    expect(tvB.of('level')).toHaveLength(0);
    // and replayed from the same room's connection it is a silent duplicate
    await rig.sendRaw(phoneA, raw);
    expect(tvA.of('level')).toHaveLength(1);
  });

  it('delivers messages of many concurrent rooms only to their own room (never crossed)', async () => {
    const rig = new Rig({ liveRoomCap: 1000 });
    const rooms: { tv: Client; phone: Client; session: string; sent: Set<string>; got: Set<string> }[] = [];
    for (let i = 0; i < 20; i += 1) {
      const tv = await rig.tvCreate();
      const phone = await rig.pair(tv);
      const session = `s_isolation${String(i).padStart(4, '0')}`;
      await rig.startSession(tv, session);
      rooms.push({ tv, phone, session, sent: new Set(), got: new Set() });
      if (i % 5 === 4) rig.advance(61_000); // $connect budget windows
    }
    const total = 10_000;
    const rounds = total / rooms.length;
    for (const r of rooms) {
      r.tv.clear();
      r.phone.clear();
    }
    for (let round = 0; round < rounds; round += 1) {
      for (const [i, r] of rooms.entries()) {
        // the phone streams a level frame, every tenth round the TV sends a command: both directions, 20 rooms interleaved
        const useTv = round % 10 === 9;
        const sender = useTv ? r.tv : r.phone;
        const id = uid('m', 20);
        await rig.send(sender, useTv ? 'window.stop' : 'level', { messageId: id, session: r.session });
        r.sent.add(`${useTv ? 'tv' : 'phone'}:${id}`);
        void i;
      }
      rig.advance(100);
    }
    let delivered = 0;
    for (const [i, r] of rooms.entries()) {
      const rid = r.tv.roomId as string;
      for (const [receiver, label] of [[r.tv, 'phone'], [r.phone, 'tv']] as const) {
        for (const m of receiver.inbox) {
          if (m.type !== 'level' && m.type !== 'window.stop') continue;
          expect(m.env.room_id, `room ${i} ${label} receiver got another room's message`).toBe(rid);
          expect(m.env.session_id).toBe(r.session);
          r.got.add(`${label}:${String(m.env.message_id)}`);
          delivered += 1;
        }
      }
      expect(r.got, `room ${i} delivery set equals what it sent`).toEqual(r.sent);
      expect(r.tv.errors(), `room ${i} tv`).toEqual([]);
      expect(r.phone.errors(), `room ${i} phone`).toEqual([]);
    }
    expect(delivered).toBe(total);
  }, 300_000);
});

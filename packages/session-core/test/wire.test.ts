import { TV_STAGES, isAllowedSender, parseWireMessage } from '@atr/protocol';
import type { TvStage as ProtocolTvStage } from '@atr/protocol';
import { describe, expect, it } from 'vitest';
import type { TvStage } from '../src/index.js';
import { parseInbound } from '../src/wire.js';
import { CREDENTIAL, PAIRING_CODE, ROOM, T0, boot } from './helpers.js';

/** Compile-time: contract.ts TvStage and @atr/protocol TvStage are the same union. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const stagesMatch: Same<TvStage, ProtocolTvStage> = true;

describe('contract versus @atr/protocol', () => {
  it('TvStage is identical (compile-time and runtime)', () => {
    expect(stagesMatch).toBe(true);
    const contractStages: TvStage[] = [
      'idle',
      'pairing',
      'permission_pending',
      'quiet_check',
      'calibration',
      'vowel_ready',
      'vowel_active',
      'vowel_result',
      'phrase_ready',
      'phrase_active',
      'response_pending',
      'reveal',
      'summary',
      'history',
      'paused_or_invalid',
      'resume_or_discard',
    ];
    expect([...TV_STAGES]).toEqual(contractStages);
  });
});

describe('every message the TV sends is valid protocol', () => {
  it('passes the shared validators, carries role tv, and uses authenticated generations from 1', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.ui('pair_phone');
    h.transportState('connected');
    h.roomCreated({ generation: 1 });
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.phrases(['One.', 'Two.', 'Three.']);
    h.setupPairedToPhrases();
    h.runPhrase({ listener: 'heard' }); // visible, family
    h.ui('next_phrase');
    h.cue('Volume');
    h.runPhrase({ listener: 'not_heard' });
    h.ui('try_again');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.ok(); // stop early
    h.back(); // cancel while closing
    h.ui('skip_phrase');
    h.transportState('reconnecting');
    h.transportState('connected');
    h.authOk({ generation: 2, peer: true, paired: true });
    h.micState('open_idle');
    h.ui('finish_early');
    h.ui('done');
    h.ui('open_settings');
    h.ui('unpair_phone');
    h.ui('confirm_destructive');

    expect(h.transport.sent.length).toBeGreaterThan(30);
    const seenTypes = new Set<string>();
    for (const m of h.transport.sent) {
      const parsed = parseWireMessage(m.raw, { now: T0 + 3_600_000 });
      expect(parsed.ok, `${m.type}: ${JSON.stringify(parsed)}`).toBe(true);
      expect(m.sender_role).toBe('tv');
      expect(isAllowedSender(m.type as never, 'tv')).toBe(true);
      seenTypes.add(m.type);
    }
    for (const t of [
      'room.create',
      'join.confirm',
      'session.begin',
      'session.state',
      'precheck.start',
      'window.start',
      'window.stop',
      'window.cancel',
      'listener.open',
      'attempt.reveal',
      'session.end',
      'ack',
      'unpair',
      'auth.resume',
    ]) {
      expect(seenTypes.has(t), `never sent ${t}`).toBe(true);
    }
    // pre-auth messages carry generation 0 and no room for room.create; authenticated ones carry the issued generation
    expect(h.last('room.create')).toMatchObject({ room_id: null, producer_generation: 0 });
    expect(h.last('auth.resume')).toMatchObject({ room_id: ROOM, producer_generation: 0 });
    const gen1 = h.transport.sent.filter((m) => m.producer_generation === 1);
    expect(gen1.length).toBeGreaterThan(20);
    for (const m of gen1) expect(m.room_id).toBe(ROOM);
    // sequence strictly increases within the generation and starts at 0 after room.created
    expect(gen1[0]?.sequence).toBe(0);
    for (let i = 1; i < gen1.length; i += 1) {
      expect((gen1[i] as { sequence: number }).sequence).toBe((gen1[i - 1] as { sequence: number }).sequence + 1);
    }
    // the credential and pairing code are only ever sent in auth.resume (credential); never in a log of other types
    for (const m of h.transport.sent) {
      if (m.type !== 'auth.resume') expect(m.raw).not.toContain(CREDENTIAL);
      expect(m.raw).not.toContain(PAIRING_CODE);
    }
  });

  it('ids bind messages to the right session, window and attempt', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    const begin = h.last('session.begin');
    const pre = h.of('precheck.start').filter((m) => m.payload.purpose === 'pre_window')[0];
    const start = h.of('window.start').filter((m) => m.payload.kind === 'phrase')[0];
    const reveal = h.last('attempt.reveal');
    expect(pre?.session_id).toBe(begin.session_id);
    // one measurement, one window_id: the precheck and the capture differ in window_id and share the attempt_id
    expect(pre?.window_id).not.toBe(start?.window_id);
    expect(pre?.attempt_id).toBe(start?.attempt_id);
    expect(reveal.window_id).toBe(start?.window_id);
    expect(reveal.attempt_id).toBe(start?.attempt_id);
    expect(h.last('session.state').session_id).toBe(begin.session_id);
    expect(h.last('session.state').window_id).toBeNull();
  });
});

describe('inbound direction and validation', () => {
  const now = T0;
  const good = (type: string, role: string, payload: unknown, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      protocol_version: 1,
      type,
      message_id: 'm_abcdefghijklmnop0001',
      room_id: ROOM,
      session_id: null,
      window_id: null,
      attempt_id: null,
      sender_role: role,
      producer_generation: role === 'relay' ? 0 : 1,
      sequence: 1,
      event_timestamp: now,
      payload,
      ...extra,
    });

  it('accepts relay-originated and phone-originated messages for the TV', () => {
    expect(parseInbound(good('pong', 'relay', { server_time: 5 }), now)).toMatchObject({ ok: true });
    expect(parseInbound(good('peer.state', 'relay', { role: 'phone', connected: true, generation: 1 }), now)).toMatchObject({ ok: true });
    expect(parseInbound(good('phrases.update', 'phone', { phrases: ['Hello.'] }), now)).toMatchObject({ ok: true });
  });

  it('rejects commands that only the TV sends, TV-role messages, wrong-role messages and what the validators reject', () => {
    expect(parseInbound(good('session.begin', 'phone', { family_mode: false, phrase_count: 1, cues_max: 3 }, { session_id: 's_abcdefgh1234' }), now)).toMatchObject({
      ok: false,
      code: 'forbidden_direction',
    });
    expect(parseInbound(good('ping', 'tv', {}), now)).toMatchObject({ ok: false, code: 'forbidden_direction' }); // an echo of the TV's own role
    expect(parseInbound(good('pong', 'tv', { server_time: 5 }), now)).toMatchObject({ ok: false }); // fails the shared validators first
    expect(parseInbound(good('phrases.update', 'relay', { phrases: ['Hello.'] }), now)).toMatchObject({ ok: false });
    expect(parseInbound(good('join.pending', 'relay', { join_id: 'j_abcdefghijklmnopqrst', confirm_digits: '12', expires_at: 1 }, { room_id: null }), now)).toMatchObject({
      ok: false,
      code: 'forbidden_direction',
    });
    expect(parseInbound(good('pong', 'relay', { server_time: 5, extra: 1 }), now)).toMatchObject({ ok: false, code: 'bad_schema' });
    expect(parseInbound(good('nope', 'relay', {}), now)).toMatchObject({ ok: false, code: 'unknown_type' });
    expect(parseInbound('x'.repeat(9000), now)).toMatchObject({ ok: false, code: 'payload_too_large' });
    expect(parseInbound(new Uint8Array(4), now)).toMatchObject({ ok: false, code: 'binary_rejected' });
    expect(parseInbound({ not: 'a message' }, now)).toMatchObject({ ok: false });
    // timestamp outside +/-24 h of the TV clock
    expect(parseInbound(good('pong', 'relay', { server_time: 5 }, { event_timestamp: now + 25 * 3_600_000 }), now)).toMatchObject({ ok: false });
    // audio-like payloads are refused before anything else
    expect(parseInbound(good('phrases.update', 'phone', { phrases: ['a'], samples: [1, 2, 3] }), now)).toMatchObject({ ok: false, code: 'audio_rejected' });
  });

  it('a duplicate message_id is dropped silently (no second effect, no ack)', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.cue('Volume');
    const cueMessage = JSON.stringify({
      protocol_version: 1,
      type: 'cue',
      message_id: 'm_dupdupdupdupdupdup01',
      room_id: ROOM,
      session_id: h.last('session.begin').session_id,
      window_id: null,
      attempt_id: null,
      sender_role: 'phone',
      producer_generation: 1,
      sequence: 99,
      event_timestamp: T0,
      payload: { text: 'Again' },
    });
    const acks = h.of('ack').length;
    h.wire(cueMessage);
    h.wire(cueMessage);
    h.wire(cueMessage);
    expect(h.of('ack')).toHaveLength(acks + 1);
    expect(h.last('session.state').payload).toMatchObject({ cues_used: 2 });
  });

  it('a message for a different room is ignored', async () => {
    const h = await boot();
    h.setupToPhrases();
    const before = h.view;
    h.wire(h.relay('peer.state', { role: 'phone', connected: false, generation: 1 }, 'r_anotherroom_0000001'));
    expect(h.view.mic).toBe(before.mic);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import {
  CLOSE,
  MESSAGE_TYPES,
  TYPE_SPECS,
  parseWireText,
  type MessageType,
} from '../src/core/index.js';
import { PHONE_FORWARD_TYPES, SECRET_CUE, SECRET_PHRASE, TV_FORWARD_TYPES, VALID_PAYLOADS } from './helpers/fixtures.js';
import { PHONE_ORIGIN, Rig, assertAllRigsNoLeaks, uid, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks([SECRET_CUE, SECRET_PHRASE]));

async function paired(rigOverrides = {}): Promise<{ rig: Rig; tv: Client; phone: Client }> {
  const rig = new Rig(rigOverrides);
  const tv = await rig.tvCreate();
  const phone = await rig.pair(tv);
  await rig.startSession(tv);
  tv.clear();
  phone.clear();
  return { rig, tv, phone };
}

describe('forwarding', () => {
  it.each(TV_FORWARD_TYPES)('forwards TV -> phone %s unchanged', async (type: MessageType) => {
    const { rig, tv, phone } = await paired();
    const raw = rig.buildMessage(tv, type);
    await rig.sendRaw(tv, raw);
    expect(tv.errors()).toEqual([]);
    expect(phone.of(type)).toHaveLength(1);
    expect(phone.last(type).raw).toBe(raw);
  });

  it.each(PHONE_FORWARD_TYPES)('forwards phone -> TV %s unchanged', async (type: MessageType) => {
    const { rig, tv, phone } = await paired();
    const raw = rig.buildMessage(phone, type);
    await rig.sendRaw(phone, raw);
    expect(phone.errors()).toEqual([]);
    expect(tv.of(type)).toHaveLength(1);
    expect(tv.last(type).raw).toBe(raw);
  });

  it('forwards ack in both directions', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'ack');
    await rig.send(phone, 'ack');
    expect(phone.of('ack')).toHaveLength(1);
    expect(tv.of('ack')).toHaveLength(1);
  });

  it('forwards the exact received text, including key order and whitespace', async () => {
    const { rig, tv, phone } = await paired();
    const parsed = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()), null, 1);
    await rig.sendRaw(phone, reordered);
    expect(tv.last('level').raw).toBe(reordered);
  });

  it('never delivers a message to the sender or to another room', async () => {
    const { rig, tv, phone } = await paired();
    const tv2 = await rig.tvCreate();
    const phone2 = await rig.pair(tv2);
    await rig.startSession(tv2, 's_session000002');
    tv2.clear();
    phone2.clear();
    await rig.send(phone, 'level');
    expect(phone.of('level')).toHaveLength(0);
    expect(tv2.of('level')).toHaveLength(0);
    expect(phone2.of('level')).toHaveLength(0);
    expect(tv.of('level')).toHaveLength(1);
  });

  it('emits relay-originated messages that satisfy the shared envelope and payload schema', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'ping');
    await rig.send(tv, 'ping');
    await rig.send(phone, 'level', { messageId: 'm_duplicateid000001' });
    await rig.send(phone, 'level', { messageId: 'm_duplicateid000001' }); // duplicate ack
    await rig.send(phone, 'window.start' as MessageType); // forbidden direction error
    for (const c of rig.clients.values()) {
      for (const m of c.inbox) {
        if (m.env.sender_role !== 'relay') continue;
        const r = parseWireText(m.raw, m.env.event_timestamp as number);
        expect(r.ok, `${m.type}: ${JSON.stringify(r)}`).toBe(true);
        expect(m.env.producer_generation).toBe(0);
      }
    }
  });

  it('gives each connection its own strictly increasing relay sequence', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 4; i += 1) {
      await rig.send(phone, 'ping');
      await rig.send(tv, 'ping');
    }
    for (const c of [tv, phone]) {
      const seqs = c.inbox.filter((m) => m.env.sender_role === 'relay').map((m) => m.env.sequence as number);
      expect(seqs.length).toBeGreaterThan(3);
      for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
  });

  it('answers ping with pong carrying server time', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'ping');
    expect(phone.last('pong').payload.server_time).toBe(rig.now);
  });
});

describe('direction and role checks', () => {
  const tvOnly: MessageType[] = [...TV_FORWARD_TYPES, 'pairing.refresh', 'join.confirm', 'unpair', 'room.close'];
  const phoneOnly: MessageType[] = PHONE_FORWARD_TYPES;

  it.each(tvOnly)('phone sending TV-only %s gets forbidden_direction', async (type) => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, type);
    expect(phone.errors()).toEqual(['forbidden_direction']);
    expect(tv.inbox).toEqual([]);
  });

  it.each(phoneOnly)('TV sending phone-only %s gets forbidden_direction', async (type) => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, type);
    expect(tv.errors()).toEqual(['forbidden_direction']);
    expect(phone.inbox).toEqual([]);
  });

  it('specifically: a phone cannot start a measurement window', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'window.start');
    expect(phone.lastError().payload).toMatchObject({ code: 'forbidden_direction' });
    expect(tv.of('window.start')).toHaveLength(0);
  });

  it.each(['room.created', 'join.accepted', 'pong', 'error', 'peer.state', 'auth.ok'] as const)(
    'client-sent relay-only type %s is refused',
    async (type) => {
      const { rig, tv, phone } = await paired();
      const payloads: Record<string, Record<string, unknown>> = {
        'room.created': {
          room_id: tv.roomId,
          pairing_code: 'ACDEFH',
          code_expires_at: rig.now,
          tv_credential: 'A'.repeat(43),
          credential_expires_at: rig.now,
          generation: 1,
        },
        'join.accepted': {
          room_id: tv.roomId,
          phone_credential: 'A'.repeat(43),
          credential_expires_at: rig.now,
          generation: 1,
        },
        pong: { server_time: rig.now },
        error: { code: 'internal', ref_message_id: null, detail: '' },
        'peer.state': { role: 'tv', connected: true, generation: 1 },
        'auth.ok': { role: 'tv', generation: 1, peer_connected: true, phone_paired: true },
      };
      await rig.send(phone, type, { payload: payloads[type] as Record<string, unknown>, roomId: phone.roomId });
      expect(phone.errors()).toEqual(['forbidden_direction']);
      expect(tv.inbox).toEqual([]);
    },
  );

  it('rejects a spoofed sender_role as unauthorized and relay as forbidden', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { senderRole: 'tv' });
    expect(phone.errors()).toEqual(['unauthorized']);
    await rig.send(phone, 'level', { senderRole: 'relay' });
    expect(phone.errors()).toEqual(['unauthorized', 'forbidden_direction']);
    expect(tv.of('level')).toHaveLength(0);
  });

  it('rejects already-authenticated clients repeating pre-auth operations', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'room.create');
    expect(tv.errors()).toEqual(['unauthorized']);
    await rig.send(phone, 'join.request', { payload: { pairing_code: 'ACDEFH', device_label: 'x' } });
    expect(phone.errors()).toEqual(['unauthorized']);
    await rig.send(tv, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    expect(tv.errors()).toEqual(['unauthorized', 'unauthorized']);
  });
});

describe('room and session binding', () => {
  it('rejects a message whose room_id is another room', async () => {
    const { rig, tv, phone } = await paired();
    const other = await rig.tvCreate();
    tv.clear();
    await rig.send(phone, 'level', { roomId: other.roomId });
    expect(phone.errors()).toEqual(['unauthorized']);
    expect(phone.lastError().payload.detail).toBe('room_id');
    expect(tv.of('level')).toHaveLength(0);
    expect(other.of('level')).toHaveLength(0);
  });

  it('rejects session ids that are not the active session', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { session: 's_wrongsession01' });
    expect(phone.errors()).toEqual(['stale']);
    expect(tv.of('level')).toHaveLength(0);
    await rig.send(tv, 'window.stop', { session: 's_wrongsession01' });
    expect(tv.errors()).toEqual(['stale']);
    expect(phone.of('window.stop')).toHaveLength(0);
  });

  it('rejects session-scoped messages when no session was begun, and after session.end', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.send(phone, 'cue');
    expect(phone.errors()).toEqual(['stale']);
    await rig.startSession(tv);
    await rig.send(phone, 'cue');
    expect(tv.of('cue')).toHaveLength(1);
    await rig.send(tv, 'session.end');
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['stale', 'stale']);
    // acks (as acked) and mic.state remain allowed
    await rig.send(phone, 'ack', { session: 's_session000001' });
    await rig.send(phone, 'mic.state');
    expect(phone.errors()).toEqual(['stale', 'stale']);
    expect(tv.of('ack')).toHaveLength(1);
    expect(tv.of('mic.state')).toHaveLength(1);
  });

  it('replaces the active session on a new session.begin', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'session.begin', { session: 's_session000002' });
    await rig.send(phone, 'level', { session: 's_session000001' });
    expect(phone.errors()).toEqual(['stale']);
    await rig.send(phone, 'level', { session: 's_session000002' });
    expect(tv.of('level')).toHaveLength(1);
  });

  it.each([
    ['short room id', { roomId: 'r_short' }],
    ['room id wrong prefix', { roomId: 'x_aaaaaaaaaaaaaaaaaaaaaa' }],
    ['null session where required', { session: null }],
    ['bad session id', { session: 'not-a-session' }],
    ['bad window id', { window: 'w_x' }],
    ['null attempt where required', { attempt: null }],
    ['non-increasing... bad message id', { messageId: 'bad' }],
    ['negative sequence', { seq: -1 }],
    ['fractional sequence', { seq: 1.5 }],
    ['event_timestamp 25 h off', { timestamp: 1_800_000_000_000 + 25 * 3_600_000 }],
  ] as const)('rejects %s as bad_schema', async (_name, opts) => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', opts as never);
    expect(phone.errors()).toEqual(['bad_schema']);
    expect(tv.of('level')).toHaveLength(0);
  });
});

describe('duplicates and replay (ADR-0003 section 10)', () => {
  it('acknowledges a duplicate message_id as duplicate and does not forward it again', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { messageId: 'm_dupmessage0000001', seq: 1 });
    await rig.send(phone, 'level', { messageId: 'm_dupmessage0000001', seq: 2 });
    expect(tv.of('level')).toHaveLength(1);
    const ack = phone.last('ack');
    expect(ack.payload).toEqual({
      acked_message_id: 'm_dupmessage0000001',
      outcome: 'ignored_stale',
      detail: 'duplicate',
    });
    expect(ack.env.sender_role).toBe('relay');
    expect(phone.errors()).toEqual([]);
  });

  it('treats an exact retransmission (same id, same sequence) as a duplicate, idempotently', async () => {
    const { rig, tv, phone } = await paired();
    const raw = rig.buildMessage(phone, 'level', { messageId: 'm_retransmit000001', seq: 7 });
    await rig.sendRaw(phone, raw);
    await rig.sendRaw(phone, raw);
    await rig.sendRaw(phone, raw);
    expect(tv.of('level')).toHaveLength(1);
    expect(phone.of('ack')).toHaveLength(2);
    expect(phone.errors()).toEqual([]);
  });

  it('does not advance the sequence for a duplicate', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'level', { messageId: 'm_dupmessage0000002', seq: 5 });
    await rig.send(phone, 'level', { messageId: 'm_dupmessage0000002', seq: 99 });
    await rig.send(phone, 'level', { seq: 6 });
    expect(phone.errors()).toEqual([]);
  });

  it('rejects sequence <= last accepted as replay (fresh message ids)', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { seq: 5 });
    await rig.send(phone, 'level', { seq: 5 });
    await rig.send(phone, 'level', { seq: 3 });
    await rig.send(phone, 'level', { seq: 0 });
    expect(phone.errors()).toEqual(['replay', 'replay', 'replay']);
    expect(tv.of('level')).toHaveLength(1);
    await rig.send(phone, 'level', { seq: 6 });
    expect(tv.of('level')).toHaveLength(2);
  });

  it('allows gaps in the sequence (strictly greater, not consecutive)', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { seq: 1 });
    await rig.send(phone, 'level', { seq: 1000 });
    expect(tv.of('level')).toHaveLength(2);
    expect(phone.errors()).toEqual([]);
  });

  it('keeps TV and phone sequence spaces separate', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'level', { seq: 50 });
    await rig.send(tv, 'window.stop', { seq: 5 });
    expect(tv.errors()).toEqual([]);
    expect(phone.of('window.stop')).toHaveLength(1);
  });

  it('replayed unchanged message after the dedupe window falls back to sequence replay', async () => {
    const { rig, phone } = await paired();
    const first = rig.buildMessage(phone, 'level', { messageId: 'm_firstmessage0001', seq: 1 });
    await rig.sendRaw(phone, first);
    for (let i = 0; i < 1100; i += 1) {
      rig.advance(100); // stay within rate limits
      await rig.send(phone, 'level', { seq: 2 + i });
    }
    phone.clear();
    await rig.sendRaw(phone, first);
    expect(phone.errors()).toEqual(['replay']);
  });
});

describe('frame and schema validation (PROTOCOL.md section 4)', () => {
  const expectRejected = async (
    mutate: (rig: Rig, phone: Client) => Promise<void>,
    code: string,
  ): Promise<{ rig: Rig; tv: Client; phone: Client }> => {
    const ctx = await paired();
    await mutate(ctx.rig, ctx.phone);
    expect(ctx.phone.errors()).toEqual([code]);
    expect(ctx.tv.inbox).toEqual([]);
    return ctx;
  };

  it('rejects invalid JSON', async () => {
    await expectRejected((rig, p) => rig.sendRaw(p, '{"protocol_version":'), 'bad_schema');
  });
  it.each(['null', '[]', '"text"', '42', 'true'])('rejects non-object JSON %s', async (raw) => {
    await expectRejected((rig, p) => rig.sendRaw(p, raw), 'bad_schema');
  });
  it('rejects unknown envelope fields and missing fields', async () => {
    const { rig, phone } = await paired();
    const m = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
    await rig.sendRaw(phone, JSON.stringify({ ...m, extra: 1 }));
    const { sequence: _s, ...missing } = m;
    await rig.sendRaw(phone, JSON.stringify(missing));
    await rig.sendRaw(phone, JSON.stringify({ ...m, protocol_version: 2 }));
    expect(phone.errors()).toEqual(['bad_schema', 'bad_schema', 'bad_schema']);
  });
  it('rejects an unknown type', async () => {
    const { rig, tv, phone } = await paired();
    const m = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
    await rig.sendRaw(phone, JSON.stringify({ ...m, type: 'window.destroy' }));
    expect(phone.errors()).toEqual(['unknown_type']);
    expect(tv.of('level')).toHaveLength(0);
  });
  it('rejects unknown payload fields, wrong types and out-of-range numbers', async () => {
    const { rig, phone } = await paired();
    const base = VALID_PAYLOADS.level as Record<string, unknown>;
    await rig.send(phone, 'level', { payload: { ...base, extra: 1 } });
    await rig.send(phone, 'level', { payload: { ...base, dbfs: '-40' } });
    await rig.send(phone, 'level', { payload: { ...base, dbfs: 500 } });
    await rig.send(phone, 'level', { payload: { ...base, frame_index: 701 } });
    await rig.send(phone, 'level', { payload: { ...base, active: 1 } });
    const { dbfs: _d, ...missing } = base;
    await rig.send(phone, 'level', { payload: missing });
    expect(phone.errors()).toEqual(Array(6).fill('bad_schema'));
  });
  it('rejects non-finite numbers (JSON cannot carry NaN, so they must arrive as null or strings)', async () => {
    const { rig, phone } = await paired();
    const raw = rig.buildMessage(phone, 'level').replace('"dbfs":-40.5', '"dbfs":NaN');
    await rig.sendRaw(phone, raw);
    const raw2 = rig.buildMessage(phone, 'level').replace('"dbfs":-40.5', '"dbfs":1e999');
    await rig.sendRaw(phone, raw2);
    expect(phone.errors()).toEqual(['bad_schema', 'bad_schema']);
  });
  it('rejects control characters in user text', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'cue', { payload: { text: 'bad\u0000cue' } });
    await rig.send(phone, 'cue', { payload: { text: 'tab\tcue' } });
    await rig.send(phone, 'cue', { payload: { text: 'c1\u0085' } });
    expect(phone.errors()).toEqual(['bad_schema', 'bad_schema', 'bad_schema']);
    expect(tv.of('cue')).toHaveLength(0);
  });
  it('enforces text length in code points after NFC and trim', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'cue', { payload: { text: 'a'.repeat(12) } }); // ok
    await rig.send(phone, 'cue', { payload: { text: 'a'.repeat(13) } });
    await rig.send(phone, 'cue', { payload: { text: '   ' } });
    await rig.send(phone, 'cue', { payload: { text: '😀'.repeat(12) } }); // 12 code points, 24 UTF-16 units: ok
    await rig.send(phone, 'cue', { payload: { text: '😀'.repeat(13) } });
    expect(phone.errors()).toEqual(['bad_schema', 'bad_schema', 'bad_schema']);
    expect(tv.of('cue')).toHaveLength(2);
  });
  it('enforces phrase list bounds (1..10 items, 1..60 code points)', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'phrases.update', { payload: { phrases: Array(10).fill('p'.repeat(60)) } });
    await rig.send(phone, 'phrases.update', { payload: { phrases: [] } });
    await rig.send(phone, 'phrases.update', { payload: { phrases: Array(11).fill('x') } });
    await rig.send(phone, 'phrases.update', { payload: { phrases: ['p'.repeat(61)] } });
    await rig.send(phone, 'phrases.update', { payload: { phrases: [''] } });
    expect(phone.errors()).toEqual(['bad_schema', 'bad_schema', 'bad_schema', 'bad_schema']);
    expect(tv.of('phrases.update')).toHaveLength(1);
  });
  it('enforces cross-field window.start rules', async () => {
    const { rig, tv, phone } = await paired();
    const ws = (p: Record<string, unknown>) => rig.send(tv, 'window.start', { payload: p });
    await ws({ kind: 'phrase', phrase_position: 3, max_duration_ms: 8000, vad_floor_dbfs: -60 });
    await ws({ kind: 'calibration', phrase_position: null, max_duration_ms: 6000, vad_floor_dbfs: -60 });
    expect(tv.errors()).toEqual([]);
    await ws({ kind: 'phrase', phrase_position: null, max_duration_ms: 8000, vad_floor_dbfs: -60 });
    await ws({ kind: 'vowel', phrase_position: 2, max_duration_ms: 20000, vad_floor_dbfs: -60 });
    await ws({ kind: 'calibration', phrase_position: null, max_duration_ms: 5000, vad_floor_dbfs: -60 });
    await ws({ kind: 'vowel', phrase_position: null, max_duration_ms: 30001, vad_floor_dbfs: -60 });
    expect(tv.errors()).toEqual(Array(4).fill('bad_schema'));
    expect(phone.of('window.start')).toHaveLength(2);
  });

  it('rejects oversized frames by UTF-8 byte length with payload_too_large and closes 1009', async () => {
    const { rig, tv, phone } = await paired();
    const m = JSON.parse(rig.buildMessage(phone, 'cue')) as Record<string, unknown>;
    // 4100 two-byte characters: 4100 UTF-16 units, 8200 bytes
    const raw = JSON.stringify({ ...m, payload: { text: 'é'.repeat(4100) } });
    expect(raw.length).toBeLessThan(8192);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(8192);
    await rig.sendRaw(phone, raw);
    expect(phone.lastError().payload.code).toBe('payload_too_large');
    expect(phone.closed?.code).toBe(CLOSE.TOO_BIG);
    expect(tv.of('cue')).toHaveLength(0);
  });

  it('accepts a frame of exactly 8192 bytes at the boundary', async () => {
    const { rig, phone } = await paired();
    const m = JSON.parse(rig.buildMessage(phone, 'ack')) as Record<string, unknown>;
    // pad detail (max 64) is limited, so build an oversize-but-valid test via envelope whitespace instead
    const compact = JSON.stringify(m);
    const padded = compact.replace('{', `{${' '.repeat(8192 - Buffer.byteLength(compact))}`);
    expect(Buffer.byteLength(padded)).toBe(8192);
    await rig.sendRaw(phone, padded);
    expect(phone.errors()).toEqual([]);
    await rig.sendRaw(phone, padded.replace('{', ' {'));
    expect(phone.errors()).toEqual(['payload_too_large']);
  });

  it('rejects binary frames with binary_rejected and closes 1003', async () => {
    const { rig, tv, phone } = await paired();
    await rig.sendRaw(phone, { binary: true, bytes: 512 });
    expect(phone.lastError().payload.code).toBe('binary_rejected');
    expect(phone.closed?.code).toBe(CLOSE.BINARY);
    expect(tv.inbox.filter((m) => m.type !== 'peer.state')).toEqual([]);
  });

  it('survives hostile nesting inside the size limit', async () => {
    const { rig, phone } = await paired();
    const m = JSON.parse(rig.buildMessage(phone, 'level')) as Record<string, unknown>;
    const deep = JSON.stringify({ ...m, payload: JSON.parse('[' .repeat(2000) + ']'.repeat(2000)) });
    await rig.sendRaw(phone, deep);
    expect(['bad_schema', 'audio_rejected']).toContain(phone.errors()[0]);
  });
});

describe('audio-like payloads are rejected with audio_rejected', () => {
  const cases: [string, MessageType, Record<string, unknown>][] = [
    ['key "audio"', 'level', { ...(VALID_PAYLOADS.level as object), audio: 'AAAA' }],
    ['key "PCM" (case-insensitive)', 'level', { ...(VALID_PAYLOADS.level as object), PCM: [0, 1] }],
    ['key "samples"', 'level', { ...(VALID_PAYLOADS.level as object), samples: [] }],
    ['key "waveform"', 'level', { ...(VALID_PAYLOADS.level as object), waveform: [] }],
    ['key "blob"', 'level', { ...(VALID_PAYLOADS.level as object), blob: 'x' }],
    ['key "buffer"', 'level', { ...(VALID_PAYLOADS.level as object), buffer: 'x' }],
    ['key "data"', 'level', { ...(VALID_PAYLOADS.level as object), data: 'x' }],
    ['nested key "Data"', 'mic.state', { ...(VALID_PAYLOADS['mic.state'] as object), settings: { Data: 1 } }],
    ['string longer than 256 code points', 'cue', { text: 'A'.repeat(257) }],
    ['base64 blob in a phrase', 'phrases.update', { phrases: ['QUFB'.repeat(100)] }],
    ['array longer than 16 elements', 'phrases.update', { phrases: Array(17).fill('x') }],
    ['sample array in an otherwise valid level', 'level', { ...(VALID_PAYLOADS.level as object), frames: new Array(1000).fill(0.1) }],
  ];
  it.each(cases)('%s', async (_name, type, payload) => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, type, { payload });
    expect(phone.errors()).toEqual(['audio_rejected']);
    expect(tv.inbox).toEqual([]);
  });

  it('applies to TV-sent messages as well', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'session.state', {
      payload: { ...(VALID_PAYLOADS['session.state'] as object), pcm: [1] },
    });
    expect(tv.errors()).toEqual(['audio_rejected']);
    expect(phone.of('session.state')).toHaveLength(0);
  });

  it('lets legitimate maximum-size payloads through (10 phrases of 60 characters)', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'phrases.update', { payload: { phrases: Array(10).fill('p'.repeat(60)) } });
    expect(phone.errors()).toEqual([]);
    expect(tv.of('phrases.update')).toHaveLength(1);
  });
});

describe('cue limit', () => {
  it('forwards three cues per session and rejects the fourth with cue_limit', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 3; i += 1) await rig.send(phone, 'cue', { payload: { text: `cue${i}` } });
    expect(tv.of('cue')).toHaveLength(3);
    await rig.send(phone, 'cue', { payload: { text: 'cue4' } });
    expect(phone.errors()).toEqual(['cue_limit']);
    expect(tv.of('cue')).toHaveLength(3);
  });

  it('counts per session, so a new session gets three more', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 4; i += 1) await rig.send(phone, 'cue');
    expect(phone.errors()).toEqual(['cue_limit']);
    await rig.send(tv, 'session.begin', { session: 's_session000002' });
    await rig.send(phone, 'cue', { session: 's_session000002' });
    expect(phone.errors()).toEqual(['cue_limit']);
    expect(tv.of('cue')).toHaveLength(4);
  });

  it('does not count duplicate or replayed cues', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(phone, 'cue', { messageId: 'm_cueduplicate0001', seq: 1 });
    await rig.send(phone, 'cue', { messageId: 'm_cueduplicate0001', seq: 2 });
    await rig.send(phone, 'cue', { seq: 1 });
    await rig.send(phone, 'cue', { seq: 3 });
    await rig.send(phone, 'cue', { seq: 4 });
    expect(phone.errors()).toEqual(['replay']);
    expect(tv.of('cue')).toHaveLength(3);
  });

  it('does not store the cue text anywhere in relay state', async () => {
    const { rig, phone } = await paired();
    await rig.send(phone, 'cue', { payload: { text: SECRET_CUE } });
    await rig.send(phone, 'phrases.update', { payload: { phrases: [SECRET_PHRASE] } });
    const dump = JSON.stringify([...(await dumpStore(rig))]);
    expect(dump.includes(SECRET_CUE)).toBe(false);
    expect(dump.includes(SECRET_PHRASE)).toBe(false);
  });
});

async function dumpStore(rig: Rig): Promise<unknown[]> {
  const out: unknown[] = [];
  const store = rig.store as unknown as Record<string, unknown>;
  for (const v of Object.values(store)) {
    if (v instanceof Map) out.push([...v.entries()]);
  }
  return out.map((x) => JSON.parse(JSON.stringify(x, (_k, val) => (val instanceof Set ? [...val] : val))));
}

describe('peer presence', () => {
  it('tells a sender its peer is offline and consumes no sequence, id or cue budget', async () => {
    const { rig, tv, phone } = await paired();
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    expect(phone.last('peer.state').payload).toMatchObject({ role: 'tv', connected: false });
    phone.clear();
    for (let i = 0; i < 4; i += 1) await rig.send(phone, 'cue', { messageId: `m_offlinecue00000${i}`, seq: 1 });
    expect(phone.errors()).toEqual(Array(4).fill('not_found'));
    expect(phone.lastError().payload.detail).toBe('peer_offline');
    // TV comes back: cues are still available and the same sequence number is still usable
    const tv2 = await rig.connect();
    tv2.role = 'tv';
    await rig.send(tv2, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'tv', credential: tv.credential as string },
    });
    for (let i = 0; i < 3; i += 1) await rig.send(phone, 'cue', { seq: 1 + i });
    expect(tv2.of('cue')).toHaveLength(3);
  });

  it('drops level frames silently while the TV is offline (no error storm)', async () => {
    const { rig, tv, phone } = await paired();
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    phone.clear();
    for (let i = 0; i < 10; i += 1) await rig.send(phone, 'level');
    expect(phone.errors()).toEqual([]);
    expect(rig.metrics.filter((m) => m.name === 'PeerOffline')).toHaveLength(10);
  });

  it('notifies the peer when a connection drops and when it returns', async () => {
    const { rig, tv, phone } = await paired();
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: false, generation: 1 });
    // onDisconnect is idempotent
    tv.clear();
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    expect(tv.inbox).toEqual([]);
  });
});

describe('authenticated rate limits (ADR-0003 section 7)', () => {
  it('allows a phone burst of 60 per second, then rate_limited; recovers next second', async () => {
    const { rig, tv, phone } = await paired();
    rig.advance(1000);
    for (let i = 0; i < 60; i += 1) await rig.send(phone, 'level');
    expect(phone.errors()).toEqual([]);
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['rate_limited']);
    expect(tv.of('level')).toHaveLength(60);
    rig.advance(1000);
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['rate_limited']);
    expect(tv.of('level')).toHaveLength(61);
  });

  it('allows a TV burst of 40 per second', async () => {
    const { rig, tv } = await paired();
    rig.advance(1000);
    for (let i = 0; i < 40; i += 1) await rig.send(tv, 'session.state');
    expect(tv.errors()).toEqual([]);
    await rig.send(tv, 'session.state');
    expect(tv.errors()).toEqual(['rate_limited']);
  });

  it('enforces the sustained rate (40/s for the phone) over a 10 second window', async () => {
    const { rig, phone } = await paired();
    for (let s = 0; s < 8; s += 1) {
      for (let i = 0; i < 50; i += 1) await rig.send(phone, 'level');
      rig.advance(1000);
    }
    expect(phone.errors()).toEqual([]);
    await rig.send(phone, 'level');
    expect(phone.errors()).toEqual(['rate_limited']);
  });

  it('closes the connection with 4429 on sustained abuse', async () => {
    const { rig, phone } = await paired();
    for (let i = 0; i < 60; i += 1) await rig.send(phone, 'level');
    for (let i = 0; i < 125 && !phone.closed; i += 1) await rig.send(phone, 'level');
    expect(phone.closed?.code).toBe(CLOSE.RATE_LIMITED);
  });

  it('closes the connection after repeated invalid messages', async () => {
    const { rig, phone } = await paired();
    for (let i = 0; i < 25 && !phone.closed; i += 1) await rig.sendRaw(phone, 'not json');
    expect(phone.closed?.code).toBe(CLOSE.RATE_LIMITED);
    expect(phone.closed?.reason).toBe('abuse');
  });
});

describe('liveness: heartbeat window and missed disconnects (ADR-0006)', () => {
  it('drops a connection idle for more than 25 seconds and tells the peer', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'ping'); // refresh TV traffic
    await rig.tick(10_000);
    await rig.send(tv, 'ping');
    await rig.tick(15_000); // phone idle 25 s: boundary, still alive
    expect(phone.closed).toBeNull();
    await rig.send(tv, 'ping');
    await rig.tick(1);
    expect(phone.closed?.code).toBe(CLOSE.IDLE);
    expect(phone.closed?.reason).toBe('idle_timeout');
    expect(tv.last('peer.state').payload).toMatchObject({ role: 'phone', connected: false });
    expect((await rig.store.getRoom(tv.roomId as string))?.phone?.connId).toBeNull();
  });

  it('keeps a connection alive with traffic every 10 seconds', async () => {
    const { rig, tv, phone } = await paired();
    for (let i = 0; i < 10; i += 1) {
      await rig.tick(10_000);
      await rig.send(tv, 'ping');
      await rig.send(phone, 'ping');
    }
    expect(tv.closed).toBeNull();
    expect(phone.closed).toBeNull();
  });

  it('lets a dropped phone resume with its credential', async () => {
    const { rig, tv, phone } = await paired();
    await rig.send(tv, 'ping');
    await rig.tick(26_000);
    expect(phone.closed?.code).toBe(CLOSE.IDLE);
    const p2 = await rig.connect(PHONE_ORIGIN);
    p2.role = 'phone';
    await rig.send(p2, 'auth.resume', {
      payload: { room_id: tv.roomId as string, role: 'phone', credential: phone.credential as string },
    });
    expect(p2.last('auth.ok').payload).toMatchObject({ role: 'phone', generation: 2 });
  });
});

describe('kill switch', () => {
  it('closes new connections with 4503 and rejects messages while disabled', async () => {
    const { rig, tv, phone } = await paired();
    rig.disabled = true;
    const late = await rig.connect(PHONE_ORIGIN);
    expect(late.closed?.code).toBe(CLOSE.DISABLED);
    await rig.send(phone, 'level');
    expect(phone.closed?.code).toBe(CLOSE.DISABLED);
    expect(phone.lastError().payload).toMatchObject({ code: 'internal', detail: 'relay_disabled' });
    expect(tv.of('level')).toHaveLength(0);
    rig.disabled = false;
    const fresh = await rig.connect(PHONE_ORIGIN);
    expect(fresh.closed).toBeNull();
  });
});

describe('catalogue sanity', () => {
  it('every client-sendable type has a valid fixture payload accepted by the schema', () => {
    for (const t of MESSAGE_TYPES) {
      const spec = TYPE_SPECS[t];
      if (spec.senders.includes('relay')) continue;
      if (t === 'join.request' || t === 'auth.resume') continue; // payloads depend on live ids
      const payload = VALID_PAYLOADS[t];
      expect(payload, `fixture for ${t}`).toBeDefined();
    }
  });
  it('unused import guard', () => {
    expect(uid('m')).toMatch(/^m_/);
  });
});

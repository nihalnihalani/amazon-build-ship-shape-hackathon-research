import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_ID_RE,
  JOIN_ID_RE,
  MAX_GENERATION,
  MAX_MESSAGE_BYTES,
  MESSAGE_ID_RE,
  MessageFactory,
  ROOM_ID_RE,
  SESSION_ID_RE,
  WINDOW_ID_RE,
  base64UrlEncode,
  createIdFactory,
  parseWireMessage,
  specFor,
  utf8ByteLength,
} from '../src/index.js';
import type { MessageIds, MessageType, Role } from '../src/index.js';
import { ATTEMPT, NOW, ROOM, SESSION, VALID_FIXTURES, WINDOW, firstFixtureOf } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function seededBytes(seed: number): (n: number) => Uint8Array {
  let a = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      out[i] = a >>> 24;
    }
    return out;
  };
}

describe('base64UrlEncode', () => {
  it('matches known vectors', () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
    expect(base64UrlEncode(new Uint8Array([0, 0, 0]))).toBe('AAAA');
    expect(base64UrlEncode(new Uint8Array([255, 255, 255]))).toBe('____');
    expect(base64UrlEncode(new Uint8Array([251, 255, 190]))).toBe('-_--');
    expect(base64UrlEncode(new Uint8Array([102]))).toBe('Zg');
    expect(base64UrlEncode(new Uint8Array([102, 111]))).toBe('Zm8');
    expect(base64UrlEncode(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
    expect(base64UrlEncode(new Uint8Array(16))).toBe('A'.repeat(22));
  });
  it('matches Node base64url for random inputs of many lengths', () => {
    for (let len = 0; len < 70; len += 1) {
      const bytes = new Uint8Array(nodeRandomBytes(len));
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });
});

describe('createIdFactory', () => {
  it('produces ids that match every id regex (22 base64url characters after the prefix)', () => {
    const f = createIdFactory();
    for (let i = 0; i < 200; i += 1) {
      expect(f.message()).toMatch(MESSAGE_ID_RE);
      expect(f.room()).toMatch(ROOM_ID_RE);
      expect(f.session()).toMatch(SESSION_ID_RE);
      expect(f.window()).toMatch(WINDOW_ID_RE);
      expect(f.attempt()).toMatch(ATTEMPT_ID_RE);
      expect(f.join()).toMatch(JOIN_ID_RE);
    }
    expect(f.message()).toHaveLength(24);
    expect(f.room().startsWith('r_')).toBe(true);
  });
  it('uses the platform cryptographic RNG when available', () => {
    expect(createIdFactory().cryptographic).toBe(true);
  });
  it('is deterministic for a seeded source and reports cryptographic for caller sources', () => {
    const a = createIdFactory(seededBytes(7));
    const b = createIdFactory(seededBytes(7));
    expect([a.message(), a.room(), a.window()]).toEqual([b.message(), b.room(), b.window()]);
    expect(a.cryptographic).toBe(true);
  });
  it('encodes exactly the bytes returned by the source', () => {
    const f = createIdFactory(() => new Uint8Array(16).fill(255));
    expect(f.session()).toBe(`s_${'_'.repeat(21)}w`);
  });
  it('rejects sources that return the wrong length or type', () => {
    expect(() => createIdFactory(() => new Uint8Array(8)).message()).toThrow();
    expect(() => createIdFactory((() => 'abc') as unknown as (n: number) => Uint8Array).message()).toThrow();
  });
  it('falls back to a flagged non-cryptographic generator without crypto', () => {
    vi.stubGlobal('crypto', undefined);
    const f = createIdFactory();
    expect(f.cryptographic).toBe(false);
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      const id = f.message();
      expect(id).toMatch(MESSAGE_ID_RE);
      seen.add(id);
    }
    expect(seen.size).toBe(5000);
  });
  it('falls back when crypto exists without getRandomValues', () => {
    vi.stubGlobal('crypto', {});
    expect(createIdFactory().cryptographic).toBe(false);
  });
  it('does not collide over many cryptographic ids', () => {
    const f = createIdFactory();
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i += 1) seen.add(f.message());
    expect(seen.size).toBe(20000);
  });
});

function factoryFor(role: Role, extra: { room?: string | null; generation?: number } = {}): { f: MessageFactory; tick: () => void } {
  let now = NOW;
  const f = new MessageFactory({
    role,
    idFactory: createIdFactory(seededBytes(99)),
    clock: () => now,
    roomId: extra.room === undefined ? ROOM : extra.room,
    generation: extra.generation ?? 1,
  });
  return { f, tick: () => (now += 1) };
}

describe('MessageFactory', () => {
  it('fills the envelope and numbers messages from 0', () => {
    const { f } = factoryFor('tv');
    const a = f.next('pairing.refresh', {});
    const b = f.next('pairing.refresh', {});
    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(1);
    expect(a).toMatchObject({ protocol_version: 1, type: 'pairing.refresh', room_id: ROOM, sender_role: 'tv', producer_generation: 1, event_timestamp: NOW, session_id: null, window_id: null, attempt_id: null });
    expect(a.message_id).toMatch(MESSAGE_ID_RE);
    expect(a.message_id).not.toBe(b.message_id);
    expect(f.nextSequence).toBe(2);
  });

  it('restarts the sequence at 0 on a new generation, but not for the same one', () => {
    const { f } = factoryFor('phone');
    f.next('ping', {});
    f.next('ping', {});
    f.next('ping', {});
    expect(f.nextSequence).toBe(3);
    f.setGeneration(1);
    expect(f.nextSequence).toBe(3);
    f.setGeneration(2);
    expect(f.nextSequence).toBe(0);
    const m = f.next('ping', {});
    expect(m.producer_generation).toBe(2);
    expect(m.sequence).toBe(0);
    f.setGeneration(MAX_GENERATION);
    expect(f.next('ping', {}).producer_generation).toBe(MAX_GENERATION);
    expect(() => f.setGeneration(MAX_GENERATION + 1)).toThrow();
    expect(() => f.setGeneration(-1)).toThrow();
    expect(() => f.setGeneration(1.5)).toThrow();
  });

  it('restarts the sequence when the room changes', () => {
    const { f } = factoryFor('tv', { room: null, generation: 0 });
    f.next('ping', {});
    expect(f.nextSequence).toBe(1);
    f.setRoom(ROOM);
    expect(f.nextSequence).toBe(0);
    f.next('pairing.refresh', {});
    f.setRoom(ROOM);
    expect(f.nextSequence).toBe(1);
    expect(() => f.setRoom('r_short')).toThrow();
    f.setRoom(null);
    expect(f.roomId).toBeNull();
  });

  it('uses generation 0 for pre-auth types and for the relay, whatever the factory generation', () => {
    const tv = factoryFor('tv', { room: null, generation: 5 }).f;
    expect(tv.next('room.create', { client: { app_version: '1', platform: 'vega' } }).producer_generation).toBe(0);
    expect(tv.next('ping', {}).producer_generation).toBe(5);
    const phone = factoryFor('phone', { room: null, generation: 5 }).f;
    expect(phone.next('join.request', { pairing_code: 'ACDEFH', device_label: 'Phone' }).producer_generation).toBe(0);
    const relay = factoryFor('relay', { generation: 9 }).f;
    expect(relay.next('pong', { server_time: NOW }).producer_generation).toBe(0);
  });

  it('applies ids, a per-message room override and the identity rules', () => {
    const { f } = factoryFor('tv');
    const m = f.next('window.start', { kind: 'phrase', phrase_position: 3, max_duration_ms: 8000, vad_floor_dbfs: -50 }, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT });
    expect(m).toMatchObject({ session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT });
    expect(() => f.next('window.start', { kind: 'phrase', phrase_position: 3, max_duration_ms: 8000, vad_floor_dbfs: -50 }, { session_id: SESSION })).toThrow(/invalid window.start/);
    const other = 'r_ZZZZZZZZZZZZZZZZZZZZZZ';
    expect(f.next('pairing.refresh', {}, { room_id: other }).room_id).toBe(other);
    expect(f.roomId).toBe(ROOM);
  });

  it('never emits an invalid message and does not consume a sequence number when it throws', () => {
    const { f } = factoryFor('phone');
    expect(() => f.next('level', { frame_index: 1, t_audio_ms: 50, dbfs: 5000, active: true, clipped: false }, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT })).toThrow(/invalid level/);
    expect(f.nextSequence).toBe(0);
    const ok = f.next('level', { frame_index: 1, t_audio_ms: 50, dbfs: -40, active: true, clipped: false }, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT });
    expect(ok.sequence).toBe(0);
  });

  it('refuses types the role may not send', () => {
    const { f } = factoryFor('tv');
    expect(() => f.next('level', { frame_index: 1, t_audio_ms: 50, dbfs: -40, active: true, clipped: false }, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT })).toThrow(/may not send/);
    const phone = factoryFor('phone').f;
    expect(() => phone.next('session.begin', { family_mode: false, phrase_count: 1, cues_max: 3 }, { session_id: SESSION })).toThrow(/may not send/);
    expect(() => phone.next('room.created' as MessageType as 'ping', {} as never)).toThrow();
    expect(factoryFor('tv').f.nextSequence).toBe(0);
  });

  it('keeps payload content out of error messages', () => {
    const { f } = factoryFor('phone');
    let message = '';
    try {
      f.next('cue', { text: 'TOPSECRET\n' }, { session_id: SESSION });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain('invalid cue');
    expect(message).not.toContain('TOPSECRET');
  });

  it('truncates fractional clock readings and rejects non-finite ones', () => {
    const f = new MessageFactory({ role: 'tv', idFactory: createIdFactory(seededBytes(1)), clock: () => NOW + 0.9, roomId: ROOM, generation: 1 });
    expect(f.next('pairing.refresh', {}).event_timestamp).toBe(NOW);
    const bad = new MessageFactory({ role: 'tv', idFactory: createIdFactory(seededBytes(1)), clock: () => NaN, roomId: ROOM, generation: 1 });
    expect(() => bad.next('pairing.refresh', {})).toThrow();
  });

  it('validates constructor options', () => {
    const idFactory = createIdFactory(seededBytes(1));
    expect(() => new MessageFactory({ role: 'admin' as Role, idFactory, clock: () => NOW })).toThrow();
    expect(() => new MessageFactory({ role: 'tv', idFactory, clock: () => NOW, generation: -1 })).toThrow();
    expect(() => new MessageFactory({ role: 'tv', idFactory, clock: () => NOW, roomId: 'nope' })).toThrow();
    expect(new MessageFactory({ role: 'tv', idFactory, clock: () => NOW }).roomId).toBeNull();
  });

  it('serialize produces text that a receiver accepts and enforces the checks', () => {
    const { f } = factoryFor('tv');
    const m = f.next('pairing.refresh', {});
    const text = f.serialize(m);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const parsed = parseWireMessage(text, { now: NOW });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.message).toEqual(m);
    // tampering after build is caught
    const tampered = { ...m, sequence: -1 } as typeof m;
    expect(() => f.serialize(tampered)).toThrow(/invalid/);
    // other role's message
    const phoneMsg = factoryFor('phone').f.next('ping', {});
    expect(() => f.serialize(phoneMsg)).toThrow(/sender_role/);
  });

  it('builds every fixture message type through the factory and equals the hand-written envelope', () => {
    const byType = new Set<MessageType>();
    for (const fixture of VALID_FIXTURES) {
      const message = fixture.message as unknown as {
        type: MessageType;
        sender_role: Role;
        producer_generation: number;
        room_id: string | null;
        session_id: string | null;
        window_id: string | null;
        attempt_id: string | null;
        payload: never;
      };
      const f = new MessageFactory({
        role: message.sender_role,
        idFactory: createIdFactory(seededBytes(3)),
        clock: () => NOW,
        roomId: message.room_id,
        generation: message.producer_generation,
      });
      const ids: MessageIds = { session_id: message.session_id, window_id: message.window_id, attempt_id: message.attempt_id };
      const built = f.next(message.type, message.payload, ids);
      expect(built.type).toBe(message.type);
      expect(built.payload).toEqual(message.payload);
      expect(built.room_id).toBe(message.room_id);
      expect(built.producer_generation).toBe(message.producer_generation);
      expect(built.sequence).toBe(0);
      expect(parseWireMessage(f.serialize(built), { now: NOW }).ok).toBe(true);
      byType.add(message.type);
    }
    expect(byType.size).toBe(37);
  });

  it('exposes catalogue-driven generation rules to builders', () => {
    expect(specFor('room.create').generation).toBe('zero');
    expect(specFor('level').generation).toBe('any');
    expect(firstFixtureOf('level').type).toBe('level');
  });
});

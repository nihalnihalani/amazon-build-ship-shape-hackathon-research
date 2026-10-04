import { describe, expect, it } from 'vitest';
import { parseWireMessage } from '@atr/protocol';
import { parseIncoming, PhoneMessageFactory } from '../src/ports/wire.js';
import {
  ATTEMPT,
  authOk,
  CREDENTIAL,
  joinAccepted,
  joinPending,
  listenerOpen,
  precheckStart,
  relayMsg,
  ROOM,
  SESSION,
  sessionBegin,
  sessionEnd,
  sessionState,
  tvMsg,
  WINDOW,
  windowCancel,
  windowStart,
  windowStop,
} from './helpers/fakes.js';
import { assertPhoneMessage } from './helpers/protocol-spec.js';

function factory(): PhoneMessageFactory {
  let t = 1_700_000_000_000;
  let counter = 0;
  return new PhoneMessageFactory({
    clock: () => (t += 1),
    randomBytes: (n) => {
      counter += 1;
      return new Uint8Array(n).map((_, i) => (i < 3 ? (counter >> (8 * i)) & 255 : 65 + (i % 26)));
    },
  });
}

const level = { frame_index: 0, t_audio_ms: 0, dbfs: -50, active: false, clipped: false };

describe('PhoneMessageFactory (on @atr/protocol, revision 2)', () => {
  it('pre-auth: join.request has room null, generation 0, sequence 0', () => {
    const f = factory();
    f.beginConnection();
    const join = f.build('join.request', { pairing_code: 'ACDEFH', device_label: 'Android Chrome' });
    expect([join.room_id, join.producer_generation, join.sequence]).toEqual([null, 0, 0]);
    assertPhoneMessage(f.serialize(join));
  });

  it('pre-auth: auth.resume is generation 0 / sequence 0 on every new connection', () => {
    const f = factory();
    f.beginConnection();
    const a = f.build('auth.resume', { room_id: ROOM, role: 'phone', credential: CREDENTIAL });
    expect([a.producer_generation, a.sequence]).toEqual([0, 0]);
    assertPhoneMessage(f.serialize(a));
    f.beginConnection(); // the connection failed before auth.ok; try again
    const b = f.build('auth.resume', { room_id: ROOM, role: 'phone', credential: CREDENTIAL });
    expect([b.producer_generation, b.sequence]).toEqual([0, 0]);
  });

  it('authenticated messages carry the room, generation >= 1, and a sequence that starts at 0 and strictly increases', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const a = f.build('ping', {});
    const b = f.build('ping', {});
    const c = f.build('cue', { text: 'Volume' }, { session_id: SESSION });
    expect([a.sequence, b.sequence, c.sequence]).toEqual([0, 1, 2]);
    expect([a.room_id, a.producer_generation]).toEqual([ROOM, 1]);
    expect(c.session_id).toBe(SESSION);
    f.setAuth(ROOM, 2); // new generation (auth.ok after a reconnect): sequence restarts at 0
    const d = f.build('ping', {});
    expect([d.producer_generation, d.sequence]).toEqual([2, 0]);
    f.clearAuth();
    expect(f.authenticated).toBe(false);
    const e = f.build('ping', {}); // a ping is allowed before auth
    expect([e.room_id, e.producer_generation, e.sequence]).toEqual([null, 0, 0]);
  });

  it('refuses authenticated types before authentication', () => {
    const f = factory();
    f.beginConnection();
    expect(() => f.build('level', level, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT })).toThrow(/before authentication/);
    expect(() => f.build('phrases.update', { phrases: ['a'] })).toThrow(/before authentication/);
    expect(() => f.build('mic.state', {} as never)).toThrow(/before authentication/);
  });

  it('the package enforces the identity-binding rules of the table', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    expect(() => f.build('level', level)).toThrow();
    expect(() => f.build('level', level, { session_id: SESSION, window_id: WINDOW })).toThrow();
    expect(() => f.build('cue', { text: 'x' }, { session_id: SESSION, window_id: WINDOW })).toThrow();
    expect(() => f.build('cue', { text: 'x' })).toThrow();
    expect(() => f.build('phrases.update', { phrases: ['a'] }, { session_id: SESSION })).toThrow();
  });

  it('a failed build does not consume a sequence number', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    expect(() => f.build('cue', { text: 'x' })).toThrow();
    expect(f.build('ping', {}).sequence).toBe(0);
  });

  it('user text must already be NFC + trimmed: the package refuses anything else', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    expect(() => f.build('cue', { text: ' Volume ' }, { session_id: SESSION })).toThrow();
    expect(() => f.build('cue', { text: 'é' }, { session_id: SESSION })).toThrow();
    expect(() => f.build('phrases.update', { phrases: ['  hi'] })).toThrow();
    expect(f.build('cue', { text: 'Volume' }, { session_id: SESSION }).payload.text).toBe('Volume');
  });

  it('message ids are unique and match the pattern', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const ids = new Set(Array.from({ length: 50 }, () => f.build('ping', {}).message_id));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^m_[A-Za-z0-9_-]{16,32}$/);
  });

  it('default id source is the platform RNG (no injected randomBytes)', () => {
    const f = new PhoneMessageFactory();
    f.setAuth(ROOM, 1);
    const a = f.build('ping', {}).message_id;
    const b = f.build('ping', {}).message_id;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^m_[A-Za-z0-9_-]{22}$/);
  });

  it('ten 60-code-point four-byte phrases still fit in one message', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const phrases = Array.from({ length: 10 }, () => '😀'.repeat(60));
    const text = f.serialize(f.build('phrases.update', { phrases }));
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(8192);
  });

  it('serialize round-trips through the package parser', () => {
    const f = factory();
    f.setAuth(ROOM, 3);
    const text = f.serialize(f.build('listener.response', { response: 'heard' }, { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT }));
    const parsed = parseWireMessage(text, { now: 1_700_000_000_000 }); // matches the fake clock above
    expect(parsed.ok).toBe(true);
  });
});

describe('parseIncoming: accepts every message a phone should receive', () => {
  const cases: Array<[string, string]> = [
    ['join.pending', joinPending()],
    ['join.accepted', joinAccepted()],
    ['join.rejected', relayMsg('join.rejected', { reason: 'busy' })],
    ['auth.ok', authOk()],
    ['peer.state', relayMsg('peer.state', { role: 'tv', connected: true, generation: 2 })],
    ['unpaired', relayMsg('unpaired', { reason: 'tv_unpaired' })],
    ['pong', relayMsg('pong', { server_time: 1 })],
    ['error', relayMsg('error', { code: 'cue_limit', ref_message_id: null, detail: '' })],
    ['session.begin', sessionBegin()],
    ['session.state', sessionState('calibration', 1, 'a_attempt0001')],
    ['precheck.start', precheckStart('quiet_check')],
    ['precheck.start', precheckStart('pre_window')],
    ['window.start', windowStart('calibration')],
    ['window.start', windowStart('vowel')],
    ['window.start', windowStart('phrase')],
    ['window.stop', windowStop()],
    ['window.cancel', windowCancel()],
    ['listener.open', listenerOpen()],
    ['attempt.reveal', tvMsg('attempt.reveal', {}, { s: SESSION, w: WINDOW, a: ATTEMPT })],
    ['session.end', sessionEnd()],
    ['ack', tvMsg('ack', { acked_message_id: 'm_0000000000000099', outcome: 'applied', detail: '' }, { s: SESSION })],
  ];
  it.each(cases)('%s', (type, text) => {
    const r = parseIncoming(text);
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) expect(r.message.type).toBe(type);
  });
});

describe('parseIncoming: rejects what a phone must not act on', () => {
  const mutate = (text: string, f: (m: Record<string, unknown>) => void): string => {
    const m = JSON.parse(text) as Record<string, unknown>;
    f(m);
    return JSON.stringify(m);
  };
  const payload = (m: Record<string, unknown>): Record<string, unknown> => m['payload'] as Record<string, unknown>;
  const reason = (text: string): string => {
    const r = parseIncoming(text);
    return r.ok ? 'ok' : r.reason.split(':')[0] ?? '';
  };

  it('not JSON / not an object / oversize', () => {
    expect(reason('{')).toBe('bad_schema');
    expect(reason('[]')).toBe('bad_schema');
    expect(reason('x'.repeat(8193))).toBe('payload_too_large');
  });

  it('envelope problems', () => {
    const good = windowStart('phrase');
    expect(reason(mutate(good, (m) => { m['extra'] = 1; }))).toBe('bad_schema');
    expect(reason(mutate(good, (m) => { delete m['sequence']; }))).toBe('bad_schema');
    expect(reason(mutate(good, (m) => { m['protocol_version'] = 2; }))).toBe('bad_schema');
    expect(reason(mutate(good, (m) => { m['type'] = 'window.explode'; }))).toBe('unknown_type');
    expect(reason(mutate(good, (m) => { m['message_id'] = 'x'; }))).toBe('bad_schema');
    expect(reason(mutate(good, (m) => { m['window_id'] = 'w_x'; }))).toBe('bad_schema');
  });

  it('only a legitimate source may send each type to a phone', () => {
    const good = windowStart('phrase');
    expect(reason(mutate(good, (m) => { m['sender_role'] = 'relay'; m['producer_generation'] = 0; }))).toBe('bad_sender_role');
    expect(reason(mutate(good, (m) => { m['sender_role'] = 'phone'; }))).toBe('bad_sender_role');
    // a relay-only type claiming to come from the TV
    expect(reason(mutate(joinPending(), (m) => { m['sender_role'] = 'tv'; }))).toBe('bad_sender_role');
    expect(reason(mutate(relayMsg('unpaired', { reason: 'tv_unpaired' }), (m) => { m['sender_role'] = 'tv'; }))).toBe('bad_sender_role');
    // an ack must come from the TV, not be reflected from a phone
    expect(reason(mutate(tvMsg('ack', { acked_message_id: 'm_0000000000000099', outcome: 'applied', detail: '' }), (m) => { m['sender_role'] = 'phone'; }))).toBe('bad_sender_role');
  });

  it('messages that are not addressed to phones are not accepted', () => {
    expect(reason(tvMsg('join.confirm', { join_id: 'j_joinjoin0001', decision: 'accept' }, {}))).toBe('not_for_phone');
    expect(reason(tvMsg('room.create', { client: { app_version: '1', platform: 'test' } }, {}))).toBe('bad_schema'); // room must be null for room.create
  });

  it('identity binding and the room rule', () => {
    expect(reason(mutate(precheckStart(), (m) => { m['attempt_id'] = null; }))).toBe('bad_schema');
    expect(reason(mutate(sessionEnd(), (m) => { m['window_id'] = WINDOW; }))).toBe('bad_schema');
    expect(reason(mutate(sessionBegin(), (m) => { m['session_id'] = null; }))).toBe('bad_schema');
    expect(reason(mutate(joinPending(), (m) => { m['session_id'] = SESSION; }))).toBe('bad_schema');
    expect(reason(mutate(joinAccepted(), (m) => { m['room_id'] = null; }))).toBe('bad_schema'); // required after a room exists
    expect(reason(mutate(windowStart(), (m) => { m['room_id'] = null; }))).toBe('bad_schema');
    expect(reason(mutate(joinPending(), (m) => { m['room_id'] = ROOM; }))).toBe('bad_schema'); // must be null
    expect(reason(mutate(joinAccepted(), (m) => { m['room_id'] = 'r_otherotherother01'; }))).toBe('bad_schema'); // differs from payload
  });

  it('payload shape and ranges', () => {
    expect(reason(mutate(windowStop(), (m) => { payload(m)['extra'] = 1; }))).toBe('bad_schema');
    expect(reason(mutate(windowStop(), (m) => { payload(m)['reason'] = 'whatever'; }))).toBe('bad_schema');
    expect(reason(mutate(sessionBegin(), (m) => { payload(m)['cues_max'] = 4; }))).toBe('bad_schema');
    expect(reason(mutate(sessionState('idle'), (m) => { payload(m)['cues_used'] = 4; }))).toBe('bad_schema');
    expect(reason(sessionState('bogus'))).toBe('bad_schema');
    expect(reason(mutate(joinPending(), (m) => { payload(m)['confirm_digits'] = '4'; }))).toBe('bad_schema');
    expect(reason(mutate(joinAccepted(), (m) => { payload(m)['phone_credential'] = 'short'; }))).toBe('bad_schema');
    expect(reason(relayMsg('error', { code: 'cue_limit', ref_message_id: null, detail: 'a\u0000b' }))).toBe('bad_schema');
    expect(reason(relayMsg('error', { code: 'cue_limit', ref_message_id: 'not-an-id', detail: '' }))).toBe('bad_schema'); // revision 2: ref must match the message_id pattern
    expect(reason(mutate(listenerOpen(), (m) => { payload(m)['timeout_ms'] = 100; }))).toBe('bad_schema');
  });

  it('cross-field rules from the table', () => {
    expect(reason(mutate(precheckStart('quiet_check'), (m) => { payload(m)['duration_ms'] = 2000; }))).toBe('bad_schema');
    expect(reason(mutate(precheckStart('pre_window'), (m) => { payload(m)['duration_ms'] = 5000; }))).toBe('bad_schema');
    expect(reason(mutate(windowStart('phrase'), (m) => { payload(m)['max_duration_ms'] = 5000; }))).toBe('bad_schema');
    expect(reason(mutate(windowStart('calibration'), (m) => { payload(m)['max_duration_ms'] = 5000; }))).toBe('bad_schema');
    expect(reason(mutate(windowStart('calibration'), (m) => { payload(m)['phrase_position'] = 2; }))).toBe('bad_schema');
    expect(reason(mutate(windowStart('vowel'), (m) => { payload(m)['max_duration_ms'] = 30001; }))).toBe('bad_schema');
    expect(reason(mutate(windowStart('phrase'), (m) => { payload(m)['vad_floor_dbfs'] = 1; }))).toBe('bad_schema');
  });

  it('audio-like payloads are rejected with their own code', () => {
    expect(reason(mutate(windowStop(), (m) => { payload(m)['samples'] = [1, 2, 3]; }))).toBe('audio_rejected');
  });

  it('the package parser and the phone parser agree on a valid TV command', () => {
    const text = windowStart('phrase');
    expect(parseWireMessage(text).ok).toBe(true);
    expect(parseIncoming(text).ok).toBe(true);
  });
});

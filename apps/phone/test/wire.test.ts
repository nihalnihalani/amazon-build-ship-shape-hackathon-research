import { describe, expect, it } from 'vitest';
import { MessageFactory, parseIncoming, serialize } from '../src/ports/wire.js';
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

function factory(): MessageFactory {
  let t = 1000;
  let counter = 0;
  return new MessageFactory({
    now: () => (t += 1),
    randomBytes: (n) => {
      counter += 1;
      return new Uint8Array(n).map((_, i) => (i < 3 ? (counter >> (8 * i)) & 255 : 65 + (i % 26)));
    },
  });
}

describe('MessageFactory', () => {
  it('pre-auth messages use room null, generation 0, sequence 0', () => {
    const f = factory();
    const join = f.build('join.request', { pairing_code: 'ACDEFH', device_label: 'Android Chrome' });
    expect(join.room_id).toBeNull();
    expect(join.producer_generation).toBe(0);
    expect(join.sequence).toBe(0);
    assertPhoneMessage(serialize(join));
    const resume = f.build('auth.resume', { room_id: ROOM, role: 'phone', credential: CREDENTIAL });
    assertPhoneMessage(serialize(resume));
  });

  it('authenticated messages carry room, generation and a strictly increasing sequence', () => {
    const f = factory();
    f.setAuth(ROOM, 3);
    const a = f.build('ping', {});
    const b = f.build('ping', {});
    const c = f.build('cue', { text: 'Volume' }, { session_id: SESSION });
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
    expect(a.room_id).toBe(ROOM);
    expect(a.producer_generation).toBe(3);
    expect(c.session_id).toBe(SESSION);
    f.setAuth(ROOM, 4); // new generation starts a fresh sequence space
    const d = f.build('ping', {});
    expect([d.producer_generation, d.sequence]).toEqual([4, 1]);
  });

  it('refuses authenticated types before authentication', () => {
    const f = factory();
    expect(() => f.build('level', { frame_index: 0, t_audio_ms: 0, dbfs: -50, active: false, clipped: false })).toThrow();
    expect(() => f.build('phrases.update', { phrases: ['a'] })).toThrow(/before authentication/);
    // a ping before auth is allowed (pre-auth) and uses the pre-auth fields
    expect(f.build('ping', {}).sequence).toBe(0);
  });

  it('enforces the identity-binding rules of the table', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const level = { frame_index: 0, t_audio_ms: 0, dbfs: -50, active: false, clipped: false };
    expect(() => f.build('level', level)).toThrow();
    expect(() => f.build('level', level, { session_id: SESSION, window_id: WINDOW })).toThrow();
    expect(() => f.build('cue', { text: 'x' }, { session_id: SESSION, window_id: WINDOW })).toThrow();
    expect(() => f.build('cue', { text: 'x' })).toThrow();
    expect(() => f.build('phrases.update', { phrases: ['a'] }, { session_id: SESSION })).toThrow();
    expect(() => f.build('mic.state', {} as never, { session_id: SESSION, window_id: WINDOW })).toThrow();
  });

  it('message ids are unique and match the pattern', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const ids = new Set(Array.from({ length: 50 }, () => f.build('ping', {}).message_id));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^m_[A-Za-z0-9_-]{16,32}$/);
  });

  it('serialize rejects messages over 8192 bytes', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const huge = f.build('phrases.update', { phrases: ['x'.repeat(9000)] });
    expect(() => serialize(huge)).toThrow(/8192/);
  });

  it('ten 60-code-point four-byte phrases still fit in one message', () => {
    const f = factory();
    f.setAuth(ROOM, 1);
    const phrases = Array.from({ length: 10 }, () => '😀'.repeat(60));
    const text = serialize(f.build('phrases.update', { phrases }));
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(8192);
  });
});

describe('parseIncoming: accepts every message the phone should receive', () => {
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
  ];
  it.each(cases)('%s', (type, text) => {
    const r = parseIncoming(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message.type).toBe(type);
  });
});

describe('parseIncoming: rejects malformed input', () => {
  const mutate = (text: string, f: (m: Record<string, unknown>) => void): string => {
    const m = JSON.parse(text) as Record<string, unknown>;
    f(m);
    return JSON.stringify(m);
  };
  const reason = (text: string): string => {
    const r = parseIncoming(text);
    return r.ok ? 'ok' : r.reason;
  };

  it('not JSON / not an object', () => {
    expect(reason('{')).toBe('not_json');
    expect(reason('[]')).toBe('not_object');
    expect(reason('"x"')).toBe('not_object');
  });
  it('envelope field problems', () => {
    const good = windowStart('phrase');
    expect(reason(mutate(good, (m) => { m['extra'] = 1; }))).toBe('bad_envelope_fields');
    expect(reason(mutate(good, (m) => { delete m['sequence']; }))).toBe('bad_envelope_fields');
    expect(reason(mutate(good, (m) => { m['protocol_version'] = 2; }))).toBe('bad_version');
    expect(reason(mutate(good, (m) => { m['type'] = 'window.explode'; }))).toBe('unknown_type');
    expect(reason(mutate(good, (m) => { m['message_id'] = 'x'; }))).toBe('bad_message_id');
    expect(reason(mutate(good, (m) => { m['window_id'] = 'w_x'; }))).toBe('bad_window_id');
    expect(reason(mutate(good, (m) => { m['sender_role'] = 'relay'; }))).toBe('bad_sender_role');
    expect(reason(mutate(good, (m) => { m['sender_role'] = 'phone'; }))).toBe('bad_sender_role');
  });
  it('identity binding', () => {
    expect(reason(mutate(precheckStart(), (m) => { m['attempt_id'] = null; }))).toBe('identity_binding');
    expect(reason(mutate(sessionEnd(), (m) => { m['window_id'] = WINDOW; }))).toBe('identity_binding');
    expect(reason(mutate(sessionBegin(), (m) => { m['session_id'] = null; }))).toBe('identity_binding');
    expect(reason(mutate(joinPending(), (m) => { m['session_id'] = SESSION; }))).toBe('identity_binding');
  });
  it('payload shape', () => {
    expect(reason(mutate(windowStop(), (m) => { (m['payload'] as Record<string, unknown>)['extra'] = 1; }))).toBe('bad_payload');
    expect(reason(mutate(windowStop(), (m) => { (m['payload'] as Record<string, unknown>)['reason'] = 'whatever'; }))).toBe('bad_payload');
    expect(reason(mutate(sessionBegin(), (m) => { (m['payload'] as Record<string, unknown>)['cues_max'] = 4; }))).toBe('bad_payload');
    expect(reason(mutate(sessionState('idle'), (m) => { (m['payload'] as Record<string, unknown>)['cues_used'] = 4; }))).toBe('bad_payload');
    expect(reason(mutate(sessionState('bogus'), () => undefined))).toBe('bad_payload');
    expect(reason(mutate(joinPending(), (m) => { (m['payload'] as Record<string, unknown>)['confirm_digits'] = '4'; }))).toBe('bad_payload');
    expect(reason(mutate(joinAccepted(), (m) => { (m['payload'] as Record<string, unknown>)['phone_credential'] = 'short'; }))).toBe('bad_payload');
    expect(reason(mutate(relayMsg('error', { code: 'cue_limit', ref_message_id: null, detail: 'a\u0000b' }), () => undefined))).toBe('bad_payload');
    expect(reason(mutate(listenerOpen(), (m) => { (m['payload'] as Record<string, unknown>)['timeout_ms'] = 100; }))).toBe('bad_payload');
  });
  it('cross-field rules from the table', () => {
    expect(reason(mutate(precheckStart('quiet_check'), (m) => { (m['payload'] as Record<string, unknown>)['duration_ms'] = 2000; }))).toBe('bad_payload');
    expect(reason(mutate(precheckStart('pre_window'), (m) => { (m['payload'] as Record<string, unknown>)['duration_ms'] = 5000; }))).toBe('bad_payload');
    expect(reason(mutate(windowStart('phrase'), (m) => { (m['payload'] as Record<string, unknown>)['max_duration_ms'] = 5000; }))).toBe('bad_payload');
    expect(reason(mutate(windowStart('calibration'), (m) => { (m['payload'] as Record<string, unknown>)['max_duration_ms'] = 5000; }))).toBe('bad_payload');
    expect(reason(mutate(windowStart('calibration'), (m) => { (m['payload'] as Record<string, unknown>)['phrase_position'] = 2; }))).toBe('bad_payload');
    expect(reason(mutate(windowStart('vowel'), (m) => { (m['payload'] as Record<string, unknown>)['max_duration_ms'] = 30001; }))).toBe('bad_payload');
    expect(reason(mutate(windowStart('phrase'), (m) => { (m['payload'] as Record<string, unknown>)['vad_floor_dbfs'] = 1; }))).toBe('bad_payload');
  });
  it('oversize frames', () => {
    expect(reason('x'.repeat(8193))).toBe('too_large');
  });
});

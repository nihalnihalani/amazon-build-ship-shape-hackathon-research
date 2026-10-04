import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_KEYS,
  MAX_GENERATION,
  MAX_SEQUENCE,
  MESSAGE_TYPES,
  TIMESTAMP_SKEW_MS,
  parseWireMessage,
  validateMessageObject,
} from '../src/index.js';
import { ATTEMPT, MID, NOW, ROOM, SESSION, VALID_FIXTURES, WINDOW, EXPECTED_SWA, env, firstFixtureOf, fixtureOf } from './fixtures.js';
import { DELETE, OPTS, expectFail, expectOk, patched, patchedRaw } from './helpers.js';

describe('envelope: exact keys', () => {
  for (const key of ENVELOPE_KEYS) {
    it(`rejects a message missing ${key}`, () => {
      expectFail(patched(fixtureOf('level'), key, DELETE), 'bad_schema');
    });
  }
  it('rejects an unknown top-level field', () => {
    expectFail(patched(fixtureOf('level'), 'extra', 1), 'bad_schema');
  });
  it('rejects fields that look like credentials or roles smuggled into the envelope', () => {
    expectFail(patched(fixtureOf('level'), 'credential', 'x'), 'bad_schema');
    expectFail(patched(fixtureOf('level'), 'role', 'tv'), 'bad_schema');
  });
  it('has twelve envelope fields', () => {
    expect(ENVELOPE_KEYS.length).toBe(12);
  });
});

describe('envelope: top-level shape', () => {
  for (const [label, value] of [
    ['null', null],
    ['array', []],
    ['string', 'x'],
    ['number', 1],
    ['boolean', true],
    ['empty object', {}],
  ] as const) {
    it(`rejects ${label} as the message`, () => {
      const r = validateMessageObject(value, OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad_schema');
    });
  }
  it('rejects invalid JSON and empty text', () => {
    for (const text of ['', '{', 'not json', '{"a":1,}', "{'a':1}", '﻿{}']) {
      const r = parseWireMessage(text, OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad_schema');
    }
  });
  it('rejects JSON that is valid but not an object', () => {
    for (const text of ['null', '[]', '"x"', '1', 'true', '[{"type":"ping"}]']) {
      const r = parseWireMessage(text, OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad_schema');
    }
  });
  it('rejects class instances and objects with accessors or symbol keys', () => {
    class Msg {}
    const instance = Object.assign(new Msg(), fixtureOf('ping authenticated'));
    expect(validateMessageObject(instance, OPTS).ok).toBe(false);
    const withGetter = fixtureOf('ping authenticated');
    Object.defineProperty(withGetter, 'sequence', { get: () => 1, enumerable: true });
    expect(validateMessageObject(withGetter, OPTS).ok).toBe(false);
    const withSymbol = { ...fixtureOf('ping authenticated'), [Symbol('s')]: 1 };
    expect(validateMessageObject(withSymbol, OPTS).ok).toBe(false);
    const hidden = fixtureOf('ping authenticated');
    Object.defineProperty(hidden, 'hidden', { value: 1, enumerable: false });
    expect(validateMessageObject(hidden, OPTS).ok).toBe(false);
  });
});

describe('envelope: protocol_version and type', () => {
  for (const v of [0, 2, '1', 1.5, null, true, [1], NaN]) {
    it(`rejects protocol_version ${JSON.stringify(v)}`, () => {
      expectFail(patchedRaw(fixtureOf('ping authenticated'), 'protocol_version', v), 'bad_schema');
    });
  }
  it('accepts protocol_version 1 written as 1.0 in JSON text', () => {
    const text = JSON.stringify(fixtureOf('ping authenticated')).replace('"protocol_version":1', '"protocol_version":1.0');
    expect(parseWireMessage(text, OPTS).ok).toBe(true);
  });
  it('reports unknown_type for unknown strings', () => {
    for (const t of ['nope', 'PING', 'room.create ', 'level.', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expectFail(patched(fixtureOf('ping authenticated'), 'type', t), 'unknown_type');
    }
  });
  it('reports bad_schema for non-string types', () => {
    for (const t of [1, null, [], {}, true]) {
      expectFail(patchedRaw(fixtureOf('ping authenticated'), 'type', t), 'bad_schema');
    }
  });
  it('checks the version before the type', () => {
    const m = patched(patched(fixtureOf('ping authenticated'), 'type', 'nope'), 'protocol_version', 2);
    const r = validateMessageObject(m, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_schema');
  });
});

describe('envelope: field formats', () => {
  const base = () => fixtureOf('level');
  it('message_id', () => {
    for (const bad of ['m_short', `m_${'a'.repeat(33)}`, 'x_0123456789abcdefghijkl', 'm_0123456789abcdefghij+k', 5, null, '']) {
      expectFail(patched(base(), 'message_id', bad), 'bad_schema');
    }
    expectOk(patched(base(), 'message_id', `m_${'a'.repeat(16)}`));
    expectOk(patched(base(), 'message_id', `m_${'a'.repeat(32)}`));
    expectFail(patched(base(), 'message_id', `m_${'a'.repeat(15)}`), 'bad_schema');
  });
  it('room_id', () => {
    expectOk(patched(base(), 'room_id', `r_${'b'.repeat(16)}`));
    expectOk(patched(base(), 'room_id', `r_${'b'.repeat(32)}`));
    for (const bad of [`r_${'b'.repeat(15)}`, `r_${'b'.repeat(33)}`, `s_${'b'.repeat(20)}`, '', 5, 'r_bbbbbbbbbbbbbbbb ']) {
      expectFail(patched(base(), 'room_id', bad), 'bad_schema');
    }
  });
  it('session_id, window_id and attempt_id', () => {
    const cases: Array<[string, string]> = [
      ['session_id', 's_'],
      ['window_id', 'w_'],
      ['attempt_id', 'a_'],
    ];
    for (const [field, prefix] of cases) {
      expectOk(patched(base(), field, `${prefix}${'c'.repeat(8)}`));
      expectOk(patched(base(), field, `${prefix}${'c'.repeat(40)}`));
      for (const bad of [`${prefix}${'c'.repeat(7)}`, `${prefix}${'c'.repeat(41)}`, `z_${'c'.repeat(10)}`, '', 3, `${prefix}c.c.c.c.c.c`]) {
        expectFail(patched(base(), field, bad), 'bad_schema');
      }
    }
  });
  it('sender_role', () => {
    for (const bad of ['admin', 'TV', 'Phone', '', null, 1, ['tv']]) {
      expectFail(patchedRaw(base(), 'sender_role', bad), 'bad_schema');
    }
    for (const ok of ['tv', 'phone']) expectOk(patched(base(), 'sender_role', ok));
  });
  it('producer_generation', () => {
    expectOk(patched(base(), 'producer_generation', 0));
    expectOk(patched(base(), 'producer_generation', MAX_GENERATION));
    for (const bad of [-1, MAX_GENERATION + 1, 1.5, '1', null]) {
      expectFail(patched(base(), 'producer_generation', bad), 'bad_schema');
    }
  });
  it('sequence', () => {
    expectOk(patched(base(), 'sequence', 0));
    expectOk(patched(base(), 'sequence', MAX_SEQUENCE));
    for (const bad of [-1, MAX_SEQUENCE + 2, 2 ** 53, 1.5, '1', null]) {
      expectFail(patched(base(), 'sequence', bad), 'bad_schema');
    }
  });
  it('event_timestamp is within +/-24 h of receiver time', () => {
    expectOk(patched(base(), 'event_timestamp', NOW));
    expectOk(patched(base(), 'event_timestamp', NOW + TIMESTAMP_SKEW_MS));
    expectOk(patched(base(), 'event_timestamp', NOW - TIMESTAMP_SKEW_MS));
    expectFail(patched(base(), 'event_timestamp', NOW + TIMESTAMP_SKEW_MS + 1), 'bad_schema');
    expectFail(patched(base(), 'event_timestamp', NOW - TIMESTAMP_SKEW_MS - 1), 'bad_schema');
    for (const bad of [String(NOW), NOW + 0.5, -1, null, 0]) {
      expectFail(patched(base(), 'event_timestamp', bad), 'bad_schema');
    }
  });
  it('uses Date.now() when opts.now is absent or invalid', () => {
    const now = Date.now();
    const m = patched(fixtureOf('level'), 'event_timestamp', now);
    expect(validateMessageObject(m).ok).toBe(true);
    expect(validateMessageObject(m, { now: NaN }).ok).toBe(true);
    expect(parseWireMessage(JSON.stringify(m)).ok).toBe(true);
    expect(validateMessageObject(patched(m, 'event_timestamp', now - TIMESTAMP_SKEW_MS - 60_000)).ok).toBe(false);
  });
});

describe('identity binding (hand-typed expectation for all 37 types)', () => {
  const ids = { session_id: SESSION, window_id: WINDOW, attempt_id: ATTEMPT } as const;
  const fields = ['session_id', 'window_id', 'attempt_id'] as const;

  it('has an expectation for every type', () => {
    expect(Object.keys(EXPECTED_SWA).sort()).toEqual([...MESSAGE_TYPES].sort());
  });

  for (const type of MESSAGE_TYPES) {
    it(`${type}: ${EXPECTED_SWA[type]}`, () => {
      const rule = EXPECTED_SWA[type];
      for (const f of VALID_FIXTURES.filter((x) => x.type === type)) {
        fields.forEach((field, i) => {
          const r = rule.charAt(i);
          const withNull = patched(f.message, field, null);
          const withId = patched(f.message, field, ids[field]);
          if (r === 'R') {
            expectFail(withNull, 'bad_schema');
            expectOk(withId);
            expectFail(patched(f.message, field, 'x_malformed'), 'bad_schema');
          } else if (r === '-') {
            expectOk(withNull);
            expectFail(withId, 'bad_schema');
          } else {
            expectOk(withNull);
            expectOk(withId);
            expectFail(patched(f.message, field, 'x_malformed'), 'bad_schema');
          }
        });
      }
    });
  }

  it('mic.state may carry a session_id but never a window or attempt id', () => {
    const base = fixtureOf('mic.state no session');
    expectOk(patched(base, 'session_id', SESSION));
    expectFail(patched(base, 'window_id', WINDOW), 'bad_schema');
    expectFail(patched(base, 'attempt_id', ATTEMPT), 'bad_schema');
  });
});

describe('room_id and producer_generation rules', () => {
  it('room.create and join.request carry no room', () => {
    expectFail(patched(fixtureOf('room.create vega'), 'room_id', ROOM), 'bad_schema');
    expectFail(patched(fixtureOf('join.request'), 'room_id', ROOM), 'bad_schema');
  });
  it('join.pending and join.rejected (sent to an unauthenticated phone) carry no room', () => {
    expectFail(patched(fixtureOf('join.pending'), 'room_id', ROOM), 'bad_schema');
    expectFail(patched(fixtureOf('join.rejected'), 'room_id', ROOM), 'bad_schema');
  });
  it('authenticated message types require a room', () => {
    for (const type of MESSAGE_TYPES) {
      const spec = VALID_FIXTURES.find((f) => f.type === type);
      if (!spec) continue;
      if (['room.create', 'join.request', 'join.pending', 'join.rejected', 'auth.resume', 'ping', 'pong', 'error'].includes(type)) continue;
      expectFail(patched(spec.message, 'room_id', null), 'bad_schema');
    }
  });
  it('room.created and join.accepted must repeat the envelope room in the payload', () => {
    expectFail(patched(fixtureOf('room.created'), 'room_id', null), 'bad_schema');
    expectFail(patched(fixtureOf('join.accepted'), 'room_id', null), 'bad_schema');
  });
  it('auth.resume accepts a null envelope room but never a different one', () => {
    expectOk(patched(fixtureOf('auth.resume tv'), 'room_id', null));
    expectOk(patched(fixtureOf('auth.resume tv'), 'room_id', ROOM));
    expectFail(patched(fixtureOf('auth.resume tv'), 'room_id', 'r_ZZZZZZZZZZZZZZZZZZZZZZ'), 'bad_schema');
  });
  it('ping, pong and error may be roomless or rooms', () => {
    for (const name of ['ping authenticated', 'pong', 'error']) {
      expectOk(patched(fixtureOf(name), 'room_id', null));
      expectOk(patched(fixtureOf(name), 'room_id', ROOM));
    }
  });
  it('relay messages and pre-auth types use generation 0', () => {
    for (const name of ['room.created', 'pairing.code', 'auth.ok', 'pong', 'error', 'join.pending']) {
      expectOk(fixtureOf(name));
      expectFail(patched(fixtureOf(name), 'producer_generation', 1), 'bad_schema');
    }
    for (const name of ['room.create vega', 'join.request', 'auth.resume tv']) {
      expectOk(fixtureOf(name));
      expectFail(patched(fixtureOf(name), 'producer_generation', 1), 'bad_schema');
    }
    expectFail(patched(fixtureOf('level'), 'sender_role', 'relay'), 'bad_schema');
  });
  it('authenticated client messages and ping may use any generation', () => {
    for (const g of [0, 1, 7, MAX_GENERATION]) {
      expectOk(patched(fixtureOf('level'), 'producer_generation', g));
      expectOk(patched(fixtureOf('ping authenticated'), 'producer_generation', g));
    }
  });
});

describe('envelope construction helper sanity', () => {
  it('env() builds the twelve fields', () => {
    const e = env('ping', {}, { role: 'tv', room: null, gen: 0 });
    expect(Object.keys(e)).toEqual([...ENVELOPE_KEYS]);
    expect(e.message_id).toBe(MID);
    expect(firstFixtureOf('ping').type).toBe('ping');
  });
});

import { describe, expect, it } from 'vitest';
import { CATALOGUE, MESSAGE_TYPES, forwardTarget, isAllowedSender, isPreAuthType, specFor } from '../src/index.js';
import type { MessageType, Role } from '../src/index.js';
import { EXPECTED_SWA } from './fixtures.js';

/** Hand-typed expectation: senders, relay forward target and auth phase per type. */
const EXPECTED: Record<MessageType, { senders: Role[]; forward: 'tv' | 'phone' | 'peer' | null; auth: string }> = {
  'room.create': { senders: ['tv'], forward: null, auth: 'pre' },
  'room.created': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'pairing.refresh': { senders: ['tv'], forward: null, auth: 'auth' },
  'pairing.code': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'join.request': { senders: ['phone'], forward: null, auth: 'pre' },
  'join.pending': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'join.requested': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'join.confirm': { senders: ['tv'], forward: null, auth: 'auth' },
  'join.accepted': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'join.rejected': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'join.expired': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'auth.resume': { senders: ['tv', 'phone'], forward: null, auth: 'pre' },
  'auth.ok': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'peer.state': { senders: ['relay'], forward: null, auth: 'relay_origin' },
  unpair: { senders: ['tv'], forward: null, auth: 'auth' },
  unpaired: { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'room.close': { senders: ['tv'], forward: null, auth: 'auth' },
  ping: { senders: ['tv', 'phone'], forward: null, auth: 'pre_or_auth' },
  pong: { senders: ['relay'], forward: null, auth: 'relay_origin' },
  error: { senders: ['relay'], forward: null, auth: 'relay_origin' },
  'session.begin': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'session.state': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'precheck.start': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'window.start': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'window.stop': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'window.cancel': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'listener.open': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'attempt.reveal': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'session.end': { senders: ['tv'], forward: 'phone', auth: 'auth' },
  'mic.state': { senders: ['phone'], forward: 'tv', auth: 'auth' },
  'precheck.result': { senders: ['phone'], forward: 'tv', auth: 'auth' },
  level: { senders: ['phone'], forward: 'tv', auth: 'auth' },
  'window.result': { senders: ['phone'], forward: 'tv', auth: 'auth' },
  'listener.response': { senders: ['phone'], forward: 'tv', auth: 'auth' },
  cue: { senders: ['phone'], forward: 'tv', auth: 'auth' },
  'phrases.update': { senders: ['phone'], forward: 'tv', auth: 'auth' },
  ack: { senders: ['tv', 'phone'], forward: 'peer', auth: 'auth' },
};

describe('catalogue', () => {
  it('has exactly one spec per message type, in order', () => {
    expect(CATALOGUE.map((s) => s.type)).toEqual([...MESSAGE_TYPES]);
    expect(new Set(MESSAGE_TYPES).size).toBe(MESSAGE_TYPES.length);
  });

  for (const type of MESSAGE_TYPES) {
    it(`${type}: senders, forwarding, auth and identity`, () => {
      const spec = specFor(type);
      const expected = EXPECTED[type];
      expect([...spec.senders].sort()).toEqual([...expected.senders].sort());
      expect(spec.forwardTo).toBe(expected.forward);
      expect(spec.auth).toBe(expected.auth);
      const swa = EXPECTED_SWA[type];
      const letter = (r: string): string => (r === 'required' ? 'R' : r === 'null' ? '-' : 'O');
      expect(`${letter(spec.identity.session)}${letter(spec.identity.window)}${letter(spec.identity.attempt)}`).toBe(swa);
      expect(spec.type).toBe(type);
    });
  }

  it('isAllowedSender follows the sender list', () => {
    expect(isAllowedSender('level', 'phone')).toBe(true);
    expect(isAllowedSender('level', 'tv')).toBe(false);
    expect(isAllowedSender('level', 'relay')).toBe(false);
    expect(isAllowedSender('window.start', 'tv')).toBe(true);
    expect(isAllowedSender('window.start', 'phone')).toBe(false);
    expect(isAllowedSender('join.confirm', 'phone')).toBe(false);
    expect(isAllowedSender('join.request', 'tv')).toBe(false);
    expect(isAllowedSender('ack', 'tv')).toBe(true);
    expect(isAllowedSender('ack', 'phone')).toBe(true);
    expect(isAllowedSender('ack', 'relay')).toBe(false);
    expect(isAllowedSender('error', 'relay')).toBe(true);
    expect(isAllowedSender('error', 'tv')).toBe(false);
    expect(isAllowedSender('ping', 'relay')).toBe(false);
    expect(isAllowedSender('pong', 'relay')).toBe(true);
    expect(isAllowedSender('auth.resume', 'phone')).toBe(true);
  });

  it('forwardTarget returns the client the relay forwards to, or null', () => {
    expect(forwardTarget('window.start')).toBe('phone');
    expect(forwardTarget('level')).toBe('tv');
    expect(forwardTarget('room.create')).toBeNull();
    expect(forwardTarget('error')).toBeNull();
    expect(forwardTarget('ping')).toBeNull();
    expect(forwardTarget('ack', 'tv')).toBe('phone');
    expect(forwardTarget('ack', 'phone')).toBe('tv');
    expect(forwardTarget('ack', 'relay')).toBeNull();
    expect(forwardTarget('ack')).toBeNull();
  });

  it('forwards only commands TV to phone and observations phone to TV', () => {
    const toPhone = CATALOGUE.filter((s) => s.forwardTo === 'phone').map((s) => s.type);
    const toTv = CATALOGUE.filter((s) => s.forwardTo === 'tv').map((s) => s.type);
    expect(toPhone.sort()).toEqual(
      ['session.begin', 'session.state', 'precheck.start', 'window.start', 'window.stop', 'window.cancel', 'listener.open', 'attempt.reveal', 'session.end'].sort(),
    );
    expect(toTv.sort()).toEqual(['mic.state', 'precheck.result', 'level', 'window.result', 'listener.response', 'cue', 'phrases.update'].sort());
  });

  it('only four types may be sent before authentication', () => {
    const pre = MESSAGE_TYPES.filter((t) => isPreAuthType(t)).sort();
    expect(pre).toEqual(['auth.resume', 'join.request', 'ping', 'room.create']);
  });

  it('every relay-originated type is sent only by the relay', () => {
    for (const spec of CATALOGUE) {
      if (spec.auth === 'relay_origin') expect(spec.senders).toEqual(['relay']);
      else expect(spec.senders).not.toContain('relay');
    }
  });

  it('relay-originated and pre-auth types are generation 0 only', () => {
    for (const spec of CATALOGUE) {
      expect(spec.generation).toBe(spec.auth === 'relay_origin' || spec.auth === 'pre' ? 'zero' : 'any');
    }
  });
});

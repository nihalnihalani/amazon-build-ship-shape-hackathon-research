/**
 * Independent restatement of PROTOCOL.md v1 (sections 1 and 3) for the messages the phone
 * SENDS. Written from the document tables (and the revision 2 clarifications), not from
 * src/ports/wire.ts, so a mistake in the builder cannot hide behind a copy of the same mistake.
 * Every message is additionally run through the package's parseWireMessage, so the two
 * independent statements of the protocol must agree.
 */
import { parseWireMessage } from '@atr/protocol';
import { expect } from 'vitest';

const ENVELOPE = [
  'protocol_version',
  'type',
  'message_id',
  'room_id',
  'session_id',
  'window_id',
  'attempt_id',
  'sender_role',
  'producer_generation',
  'sequence',
  'event_timestamp',
  'payload',
];

const RE = {
  message: /^m_[A-Za-z0-9_-]{16,32}$/,
  room: /^r_[A-Za-z0-9_-]{16,32}$/,
  session: /^s_[A-Za-z0-9_-]{8,40}$/,
  window: /^w_[A-Za-z0-9_-]{8,40}$/,
  attempt: /^a_[A-Za-z0-9_-]{8,40}$/,
};

type Binding = 'none' | 'S' | 'SWA' | 'S-optional' | 'ack';

/** type -> [identity binding, pre-auth?, payload keys (exact)] from the section 3 tables. */
const SPEC: Record<string, { binding: Binding; preAuth: boolean; keys: string[] }> = {
  'join.request': { binding: 'none', preAuth: true, keys: ['pairing_code', 'device_label'] },
  'auth.resume': { binding: 'none', preAuth: true, keys: ['room_id', 'role', 'credential'] },
  ping: { binding: 'none', preAuth: false, keys: [] }, // allowed before and after authentication
  'mic.state': { binding: 'S-optional', preAuth: false, keys: ['state', 'settings', 'supported', 'wake_lock', 'visibility', 'mode'] },
  'precheck.result': {
    binding: 'SWA',
    preAuth: false,
    keys: ['purpose', 'valid', 'invalid_reason', 'floor_dbfs', 'p20_dbfs', 'p80_dbfs', 'p95_dbfs', 'frame_count', 'expected_frames', 'coverage', 'clipped_frames', 'nonfinite_frames', 'duration_ms'],
  },
  level: { binding: 'SWA', preAuth: false, keys: ['frame_index', 't_audio_ms', 'dbfs', 'active', 'clipped'] },
  'window.result': {
    binding: 'SWA',
    preAuth: false,
    keys: ['kind', 'valid', 'invalid_reason', 'frame_count', 'expected_frames', 'coverage', 'active_ms', 'longest_active_ms', 'segments', 'onset_ms', 'p50_active_dbfs', 'p95_active_dbfs', 'peak_dbfs', 'clipped_frames', 'nonfinite_frames', 'duration_ms'],
  },
  'listener.response': { binding: 'SWA', preAuth: false, keys: ['response'] },
  cue: { binding: 'S', preAuth: false, keys: ['text'] },
  'phrases.update': { binding: 'none', preAuth: false, keys: ['phrases'] },
  ack: { binding: 'ack', preAuth: false, keys: ['acked_message_id', 'outcome', 'detail'] },
};

export interface WireMessage {
  protocol_version: number;
  type: string;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: string;
  producer_generation: number;
  sequence: number;
  event_timestamp: number;
  payload: Record<string, unknown>;
}

const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** Asserts one phone-sent text frame conforms to PROTOCOL.md; returns the parsed message. */
export function assertPhoneMessage(text: string): WireMessage {
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(8192);
  const m = JSON.parse(text) as WireMessage;
  expect(Object.keys(m).sort()).toEqual([...ENVELOPE].sort());
  expect(m.protocol_version).toBe(1);
  expect(m.message_id).toMatch(RE.message);
  expect(m.sender_role).toBe('phone');
  expect(Number.isInteger(m.producer_generation) && m.producer_generation >= 0).toBe(true);
  expect(Number.isInteger(m.sequence) && m.sequence >= 0).toBe(true);
  expect(Number.isInteger(m.event_timestamp)).toBe(true);
  const spec = SPEC[m.type];
  expect(spec, `unexpected phone message type ${m.type}`).toBeDefined();
  if (!spec) throw new Error('unreachable');
  expect(Object.keys(m.payload).sort()).toEqual([...spec.keys].sort());
  if (m.room_id !== null) expect(m.room_id).toMatch(RE.room);
  if (m.session_id !== null) expect(m.session_id).toMatch(RE.session);
  if (m.window_id !== null) expect(m.window_id).toMatch(RE.window);
  if (m.attempt_id !== null) expect(m.attempt_id).toMatch(RE.attempt);
  const s = m.session_id !== null;
  const w = m.window_id !== null;
  const a = m.attempt_id !== null;
  switch (spec.binding) {
    case 'none':
      expect([s, w, a]).toEqual([false, false, false]);
      break;
    case 'S':
      expect([s, w, a]).toEqual([true, false, false]);
      break;
    case 'SWA':
      expect([s, w, a]).toEqual([true, true, true]);
      break;
    case 'S-optional':
      expect([w, a]).toEqual([false, false]);
      break;
    case 'ack':
      break;
  }
  // Revision 2: pre-auth messages carry generation 0 and sequence 0; join.request has room null
  // (auth.resume may carry the room it repeats in its payload); authenticated messages carry the
  // room from join.accepted and a generation that starts at 1.
  if (spec.preAuth) {
    expect(m.producer_generation).toBe(0);
    expect(m.sequence).toBe(0);
    if (m.type === 'join.request') expect(m.room_id).toBeNull();
    if (m.type === 'auth.resume' && m.room_id !== null) expect(m.room_id).toBe(m.payload['room_id']);
  } else if (m.type === 'ping' && m.room_id === null) {
    expect(m.producer_generation).toBe(0);
  } else {
    expect(m.room_id).not.toBeNull();
    expect(m.producer_generation).toBeGreaterThanOrEqual(1);
  }
  // The package validator must accept exactly what this independent checker accepts.
  const viaPackage = parseWireMessage(text, { now: m.event_timestamp });
  expect(viaPackage.ok, viaPackage.ok ? '' : `${viaPackage.code}: ${viaPackage.detail}`).toBe(true);
  // numbers must be finite wherever they appear
  const walk = (v: unknown): void => {
    if (typeof v === 'number') expect(finite(v)).toBe(true);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(m.payload);
  // audio guard (section 4 step 4): no audio-ish keys, no long strings, no long arrays
  const guard = (v: unknown): void => {
    if (typeof v === 'string') expect([...v].length).toBeLessThanOrEqual(256);
    else if (Array.isArray(v)) {
      expect(v.length).toBeLessThanOrEqual(16);
      v.forEach(guard);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        expect(['audio', 'pcm', 'samples', 'waveform', 'blob', 'buffer', 'data']).not.toContain(k.toLowerCase());
        guard(x);
      }
    }
  };
  guard(m.payload);
  // type-specific ranges
  const p = m.payload;
  if (m.type === 'level') {
    expect(Number.isInteger(p['frame_index']) && (p['frame_index'] as number) >= 0 && (p['frame_index'] as number) <= 700).toBe(true);
    expect(p['t_audio_ms'] as number).toBeGreaterThanOrEqual(0);
    expect(p['t_audio_ms'] as number).toBeLessThanOrEqual(35000);
    expect(p['dbfs'] as number).toBeGreaterThanOrEqual(-140);
    expect(p['dbfs'] as number).toBeLessThanOrEqual(20);
    expect(typeof p['active']).toBe('boolean');
    expect(typeof p['clipped']).toBe('boolean');
  }
  if (m.type === 'cue') {
    const t = p['text'] as string;
    expect([...t].length).toBeGreaterThanOrEqual(1);
    expect([...t].length).toBeLessThanOrEqual(12);
  }
  if (m.type === 'phrases.update') {
    const list = p['phrases'] as string[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(10);
    for (const t of list) {
      expect([...t].length).toBeGreaterThanOrEqual(1);
      expect([...t].length).toBeLessThanOrEqual(60);
    }
  }
  if (m.type === 'join.request') {
    expect(p['pairing_code']).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
    const l = p['device_label'] as string;
    expect([...l].length).toBeGreaterThanOrEqual(1);
    expect([...l].length).toBeLessThanOrEqual(24);
  }
  if (m.type === 'ack') {
    expect(['applied', 'ignored_stale', 'rejected']).toContain(p['outcome']);
    expect([...(p['detail'] as string)].length).toBeLessThanOrEqual(64);
  }
  if (m.type === 'mic.state') {
    expect(['off', 'permission_pending', 'permission_denied', 'no_input', 'input_busy', 'constraints_unsupported', 'open_idle', 'measuring', 'error']).toContain(p['state']);
    expect(['held', 'released', 'unsupported', 'rejected', 'not_requested']).toContain(p['wake_lock']);
    expect(['visible', 'hidden']).toContain(p['visibility']);
    expect(['physical_phone', 'same_host', 'fixture_replay']).toContain(p['mode']);
  }
  return m;
}

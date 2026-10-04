/**
 * Hand-written valid fixtures, one or more per message type. The values are
 * written out literally (not produced by the code under test).
 */

import type { MessageType, Role } from '../src/index.js';

export const NOW = 1_790_000_000_000;

export const MID = 'm_0123456789abcdefghijkl';
export const MID2 = 'm_ZYXWVUTSRQPONMLKJIHGFE';
export const ROOM = 'r_ABCDEFGHIJKLMNOPQRSTUV';
export const SESSION = 's_session01';
export const WINDOW = 'w_window001';
export const ATTEMPT = 'a_attempt001';
export const JOIN = 'j_join12345';
export const CRED = 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE';

export interface EnvOptions {
  role: Role;
  room?: string | null;
  session?: string | null;
  window?: string | null;
  attempt?: string | null;
  gen?: number;
  seq?: number;
  ts?: number;
}

export type Json = Record<string, unknown>;

export function env(type: MessageType, payload: unknown, o: EnvOptions): Json {
  return {
    protocol_version: 1,
    type,
    message_id: MID,
    room_id: o.room === undefined ? ROOM : o.room,
    session_id: o.session ?? null,
    window_id: o.window ?? null,
    attempt_id: o.attempt ?? null,
    sender_role: o.role,
    producer_generation: o.gen ?? 1,
    sequence: o.seq ?? 0,
    event_timestamp: o.ts ?? NOW,
    payload,
  };
}

const tv = (type: MessageType, payload: unknown, o: Partial<EnvOptions> = {}): Json =>
  env(type, payload, { role: 'tv', ...o });
const phone = (type: MessageType, payload: unknown, o: Partial<EnvOptions> = {}): Json =>
  env(type, payload, { role: 'phone', ...o });
const relay = (type: MessageType, payload: unknown, o: Partial<EnvOptions> = {}): Json =>
  env(type, payload, { role: 'relay', gen: 0, ...o });

const SWA = { session: SESSION, window: WINDOW, attempt: ATTEMPT };

const precheckResult = {
  purpose: 'quiet_check',
  valid: true,
  invalid_reason: null,
  floor_dbfs: -62.5,
  p20_dbfs: -60,
  p80_dbfs: -55.25,
  p95_dbfs: -50,
  frame_count: 100,
  expected_frames: 100,
  coverage: 1,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 5000,
};

const windowResult = {
  kind: 'phrase',
  valid: true,
  invalid_reason: null,
  frame_count: 160,
  expected_frames: 160,
  coverage: 0.99,
  active_ms: 3200,
  longest_active_ms: 1800,
  segments: 3,
  onset_ms: 420,
  p50_active_dbfs: -31.5,
  p95_active_dbfs: -24,
  peak_dbfs: -18.25,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 8000,
};

const micState = {
  state: 'measuring',
  settings: {
    auto_gain_control: false,
    echo_cancellation: false,
    noise_suppression: false,
    sample_rate: 48000,
    channel_count: 1,
  },
  supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
  wake_lock: 'held',
  visibility: 'visible',
  mode: 'physical_phone',
};

export interface Fixture {
  name: string;
  type: MessageType;
  message: Json;
}

function fx(name: string, message: Json): Fixture {
  return { name, type: message.type as MessageType, message };
}

/** At least one valid fixture for each of the 37 message types. */
export const VALID_FIXTURES: Fixture[] = [
  // 3.1 Connection, pairing and lifecycle
  fx('room.create vega', tv('room.create', { client: { app_version: '0.1.0', platform: 'vega' } }, { room: null, gen: 0 })),
  fx('room.create web_preview', tv('room.create', { client: { app_version: '0.1.0-dev', platform: 'web_preview' } }, { room: null, gen: 0 })),
  fx(
    'room.created',
    relay('room.created', {
      room_id: ROOM,
      pairing_code: 'ACDEFH',
      code_expires_at: NOW + 600_000,
      tv_credential: CRED,
      credential_expires_at: NOW + 43_200_000,
      generation: 1,
    }),
  ),
  fx('pairing.refresh', tv('pairing.refresh', {})),
  fx('pairing.code', relay('pairing.code', { pairing_code: 'KMNPRT', code_expires_at: NOW + 600_000 })),
  fx('join.request', phone('join.request', { pairing_code: 'UVWXY3', device_label: "Asha's phone" }, { room: null, gen: 0 })),
  fx('join.pending', relay('join.pending', { join_id: JOIN, confirm_digits: '47', expires_at: NOW + 60_000 }, { room: null })),
  fx('join.requested', relay('join.requested', { join_id: JOIN, device_label: "Asha's phone", confirm_digits: '47', expires_at: NOW + 60_000 })),
  fx('join.confirm accept', tv('join.confirm', { join_id: JOIN, decision: 'accept' })),
  fx('join.confirm reject', tv('join.confirm', { join_id: JOIN, decision: 'reject' })),
  fx(
    'join.accepted',
    relay('join.accepted', {
      room_id: ROOM,
      phone_credential: CRED,
      credential_expires_at: NOW + 43_200_000,
      generation: 1,
    }),
  ),
  fx('join.rejected', relay('join.rejected', { reason: 'busy' }, { room: null })),
  fx('join.expired', relay('join.expired', { join_id: JOIN })),
  fx('auth.resume tv', tv('auth.resume', { room_id: ROOM, role: 'tv', credential: CRED }, { gen: 0 })),
  fx('auth.resume phone null envelope room', phone('auth.resume', { room_id: ROOM, role: 'phone', credential: CRED }, { room: null, gen: 0 })),
  fx('auth.ok', relay('auth.ok', { role: 'phone', generation: 2, peer_connected: true, phone_paired: true })),
  fx('peer.state', relay('peer.state', { role: 'tv', connected: false, generation: 3 })),
  fx('unpair', tv('unpair', {})),
  fx('unpaired', relay('unpaired', { reason: 'tv_unpaired' })),
  fx('room.close', tv('room.close', {})),
  fx('ping pre-auth', tv('ping', {}, { room: null, gen: 0 })),
  fx('ping authenticated', phone('ping', {}, { seq: 9 })),
  fx('pong', relay('pong', { server_time: NOW })),
  fx('error', relay('error', { code: 'rate_limited', ref_message_id: MID2, detail: 'slow down' })),
  fx('error null ref', relay('error', { code: 'bad_schema', ref_message_id: null, detail: '' }, { room: null })),

  // 3.2 Session commands (TV to phone)
  fx('session.begin', tv('session.begin', { family_mode: true, phrase_count: 6, cues_max: 3 }, { session: SESSION })),
  fx(
    'session.state',
    tv('session.state', { stage: 'response_pending', phrase_position: 3, cues_used: 1, listener_open_attempt: ATTEMPT }, { session: SESSION }),
  ),
  fx('session.state idle', tv('session.state', { stage: 'idle', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { session: SESSION })),
  fx('precheck.start quiet_check', tv('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, SWA)),
  fx('precheck.start pre_window', tv('precheck.start', { purpose: 'pre_window', duration_ms: 2000 }, SWA)),
  fx('window.start calibration', tv('window.start', { kind: 'calibration', phrase_position: null, max_duration_ms: 6000, vad_floor_dbfs: -55 }, SWA)),
  fx('window.start vowel', tv('window.start', { kind: 'vowel', phrase_position: null, max_duration_ms: 20000, vad_floor_dbfs: -48.5 }, SWA)),
  fx('window.start phrase', tv('window.start', { kind: 'phrase', phrase_position: 4, max_duration_ms: 8000, vad_floor_dbfs: -50 }, SWA)),
  fx('window.stop', tv('window.stop', { reason: 'early_stop' }, SWA)),
  fx('window.cancel', tv('window.cancel', { reason: 'link_lost' }, SWA)),
  fx('listener.open', tv('listener.open', { timeout_ms: 20000 }, SWA)),
  fx('attempt.reveal', tv('attempt.reveal', {}, SWA)),
  fx('session.end', tv('session.end', { reason: 'completed' }, { session: SESSION })),

  // 3.3 Phone observations (phone to TV)
  fx('mic.state no session', phone('mic.state', micState)),
  fx('mic.state with session', phone('mic.state', { ...micState, state: 'permission_denied', settings: { auto_gain_control: null, echo_cancellation: null, noise_suppression: null, sample_rate: null, channel_count: null } }, { session: SESSION })),
  fx(
    'mic.state supported unavailable',
    phone('mic.state', { ...micState, supported: { auto_gain_control: null, echo_cancellation: null, noise_suppression: null } }),
  ),
  fx('precheck.result', phone('precheck.result', precheckResult, SWA)),
  fx(
    'precheck.result invalid',
    phone('precheck.result', { ...precheckResult, valid: false, invalid_reason: 'burst_noise', floor_dbfs: null, p20_dbfs: null, p80_dbfs: null, p95_dbfs: null }, SWA),
  ),
  fx('level', phone('level', { frame_index: 12, t_audio_ms: 600.5, dbfs: -42.25, active: true, clipped: false }, SWA)),
  fx('window.result', phone('window.result', windowResult, SWA)),
  fx(
    'window.result invalid',
    phone('window.result', { ...windowResult, valid: false, invalid_reason: 'no_voice', onset_ms: null, p50_active_dbfs: null, p95_active_dbfs: null, peak_dbfs: null, active_ms: 0, longest_active_ms: 0, segments: 0 }, SWA),
  ),
  fx('listener.response', phone('listener.response', { response: 'heard' }, SWA)),
  fx('cue', phone('cue', { text: 'slower' }, { session: SESSION })),
  fx('phrases.update', phone('phrases.update', { phrases: ['Good morning', 'Please pass the salt', 'こんにちは'] })),
  fx('ack from tv', tv('ack', { acked_message_id: MID2, outcome: 'applied', detail: '' })),
  fx('ack from phone with identity', phone('ack', { acked_message_id: MID2, outcome: 'ignored_stale', detail: 'old window' }, SWA)),
];

/** Independent, hand-typed identity expectation per type: S, W, A as R (required), - (null), O (optional). */
export const EXPECTED_SWA: Record<MessageType, string> = {
  'room.create': '---',
  'room.created': '---',
  'pairing.refresh': '---',
  'pairing.code': '---',
  'join.request': '---',
  'join.pending': '---',
  'join.requested': '---',
  'join.confirm': '---',
  'join.accepted': '---',
  'join.rejected': '---',
  'join.expired': '---',
  'auth.resume': '---',
  'auth.ok': '---',
  'peer.state': '---',
  unpair: '---',
  unpaired: '---',
  'room.close': '---',
  ping: '---',
  pong: '---',
  error: '---',
  'session.begin': 'R--',
  'session.state': 'R--',
  'precheck.start': 'RRR',
  'window.start': 'RRR',
  'window.stop': 'RRR',
  'window.cancel': 'RRR',
  'listener.open': 'RRR',
  'attempt.reveal': 'RRR',
  'session.end': 'R--',
  'mic.state': 'O--',
  'precheck.result': 'RRR',
  level: 'RRR',
  'window.result': 'RRR',
  'listener.response': 'RRR',
  cue: 'R--',
  'phrases.update': '---',
  ack: 'OOO',
};

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function fixtureOf(name: string): Json {
  const f = VALID_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`no fixture ${name}`);
  return clone(f.message);
}

export function firstFixtureOf(type: MessageType): Json {
  const f = VALID_FIXTURES.find((x) => x.type === type);
  if (!f) throw new Error(`no fixture for ${type}`);
  return clone(f.message);
}

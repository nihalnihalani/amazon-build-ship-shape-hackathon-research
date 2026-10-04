import { describe, expect, it } from 'vitest';
import { MESSAGE_TYPES, PAIRING_ALPHABET, parseWireMessage, validateMessageObject } from '../src/index.js';
import { CRED, MID2, NOW, ROOM, VALID_FIXTURES, clone, fixtureOf, firstFixtureOf } from './fixtures.js';
import type { Json } from './fixtures.js';
import { DELETE, OPTS, expectFail, expectOk, patched, patchedRaw, verdict } from './helpers.js';

describe('valid fixtures', () => {
  it('cover every message type', () => {
    const covered = new Set(VALID_FIXTURES.map((f) => f.type));
    for (const t of MESSAGE_TYPES) expect(covered.has(t), t).toBe(true);
    expect(MESSAGE_TYPES.length).toBe(37);
  });

  for (const f of VALID_FIXTURES) {
    it(`accepts ${f.name} (object and text entry points)`, () => {
      const viaObject = validateMessageObject(f.message, OPTS);
      const viaText = parseWireMessage(JSON.stringify(f.message), OPTS);
      expect(viaObject.ok).toBe(true);
      expect(viaText.ok).toBe(true);
      if (viaObject.ok && viaText.ok) {
        expect(viaObject.message).toEqual(f.message);
        expect(viaText.message).toEqual(f.message);
        // The returned message is a copy, not the caller's object.
        expect(viaObject.message).not.toBe(f.message);
        expect(viaObject.message.payload).not.toBe(f.message.payload);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Structural mutations: every type, every payload node.
// ---------------------------------------------------------------------------

interface Mutation {
  label: string;
  message: Json;
}

function nodePaths(value: unknown, prefix: string[] = []): Array<{ path: string[]; value: unknown }> {
  const out: Array<{ path: string[]; value: unknown }> = [{ path: prefix, value }];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...nodePaths(v, [...prefix, String(i)])));
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) out.push(...nodePaths(v, [...prefix, k]));
  }
  return out;
}

function structuralMutations(message: Json): Mutation[] {
  const out: Mutation[] = [];
  const payload = message.payload;
  for (const { path, value } of nodePaths(payload)) {
    const dotted = ['payload', ...path].join('.');
    const isContainer = typeof value === 'object' && value !== null;
    if (isContainer && !Array.isArray(value)) {
      out.push({ label: `extra field at ${dotted}`, message: patched(message, `${dotted}.zz_extra`, 1) });
      for (const k of Object.keys(value as object)) {
        out.push({ label: `missing ${dotted}.${k}`, message: patched(message, `${dotted}.${k}`, DELETE) });
      }
    }
    // wrong type: containers become a string, scalars and nulls become an object
    out.push({
      label: `wrong type at ${dotted}`,
      message: patched(message, dotted, isContainer ? 'wrong' : { wrong: true }),
    });
  }
  out.push({ label: 'payload null', message: patched(message, 'payload', null) });
  out.push({ label: 'payload array', message: patched(message, 'payload', []) });
  out.push({ label: 'payload string', message: patched(message, 'payload', 'x') });
  return out;
}

describe('structural mutations are rejected for every message type', () => {
  for (const type of MESSAGE_TYPES) {
    it(`${type}: missing, extra and wrong-type variants (at least 3)`, () => {
      const base = firstFixtureOf(type);
      const mutations = structuralMutations(base);
      expect(mutations.length).toBeGreaterThanOrEqual(3);
      for (const m of mutations) {
        const r = verdict(m.message);
        expect(r.ok, `${type}: ${m.label}`).toBe(false);
        if (!r.ok) expect(r.code, `${type}: ${m.label}`).toBe('bad_schema');
      }
    });
  }
});

describe('every payload leaf rejects a value outside its domain', () => {
  // Free-text leaves accept almost any text; every other string leaf is an enum, id, code or credential.
  let totalLeaves = 0;
  const FREE_TEXT = /^payload\.(detail|text|device_label|client\.app_version|phrases\.\d+)$/;
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.name}`, () => {
      let leaves = 0;
      for (const { path, value } of nodePaths(fixture.message.payload)) {
        if (typeof value === 'object' && value !== null) continue;
        const dotted = ['payload', ...path].join('.');
        let escape: unknown;
        if (typeof value === 'string') {
          if (FREE_TEXT.test(dotted)) continue;
          escape = 'ZZ not valid';
        } else if (typeof value === 'number') {
          escape = 2 ** 60; // finite, above every range and above MAX_SAFE_INTEGER
        } else if (typeof value === 'boolean') {
          escape = 'yes';
        } else {
          escape = 'ZZ'; // null
        }
        leaves += 1;
        const r = verdict(patched(fixture.message, dotted, escape));
        expect(r.ok, `${fixture.name}: ${dotted}`).toBe(false);
      }
      totalLeaves += leaves;
    });
  }
  it('exercised a meaningful number of leaves', () => {
    expect(totalLeaves).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// Boundary and range tables (hand-written expectations)
// ---------------------------------------------------------------------------

type Case = [label: string, fixture: string, path: string, value: unknown, ok: boolean];

const NINE = 'x'.repeat(9);
const cases: Case[] = [
  // level
  ['level frame_index 0', 'level', 'payload.frame_index', 0, true],
  ['level frame_index 700', 'level', 'payload.frame_index', 700, true],
  ['level frame_index 701', 'level', 'payload.frame_index', 701, false],
  ['level frame_index -1', 'level', 'payload.frame_index', -1, false],
  ['level frame_index 1.5', 'level', 'payload.frame_index', 1.5, false],
  ['level frame_index string', 'level', 'payload.frame_index', '1', false],
  ['level t_audio_ms 0', 'level', 'payload.t_audio_ms', 0, true],
  ['level t_audio_ms 35000', 'level', 'payload.t_audio_ms', 35000, true],
  ['level t_audio_ms 35000.001', 'level', 'payload.t_audio_ms', 35000.001, false],
  ['level t_audio_ms negative', 'level', 'payload.t_audio_ms', -0.001, false],
  ['level dbfs -140', 'level', 'payload.dbfs', -140, true],
  ['level dbfs below -140', 'level', 'payload.dbfs', -140.01, false],
  ['level dbfs 20', 'level', 'payload.dbfs', 20, true],
  ['level dbfs above 20', 'level', 'payload.dbfs', 20.01, false],
  ['level active number', 'level', 'payload.active', 1, false],
  ['level clipped string', 'level', 'payload.clipped', 'false', false],
  // precheck.start conditional rule
  ['precheck quiet_check 5000', 'precheck.start quiet_check', 'payload.duration_ms', 5000, true],
  ['precheck quiet_check 2000', 'precheck.start quiet_check', 'payload.duration_ms', 2000, false],
  ['precheck pre_window 5000', 'precheck.start pre_window', 'payload.duration_ms', 5000, false],
  ['precheck pre_window 2000', 'precheck.start pre_window', 'payload.duration_ms', 2000, true],
  ['precheck duration 3000', 'precheck.start quiet_check', 'payload.duration_ms', 3000, false],
  ['precheck duration string', 'precheck.start quiet_check', 'payload.duration_ms', '5000', false],
  ['precheck purpose unknown', 'precheck.start quiet_check', 'payload.purpose', 'warmup', false],
  // window.start conditional rules
  ['calibration 6000', 'window.start calibration', 'payload.max_duration_ms', 6000, true],
  ['calibration 5999', 'window.start calibration', 'payload.max_duration_ms', 5999, false],
  ['calibration 6001', 'window.start calibration', 'payload.max_duration_ms', 6001, false],
  ['calibration with position', 'window.start calibration', 'payload.phrase_position', 1, false],
  ['vowel 1000', 'window.start vowel', 'payload.max_duration_ms', 1000, true],
  ['vowel 999', 'window.start vowel', 'payload.max_duration_ms', 999, false],
  ['vowel 30000', 'window.start vowel', 'payload.max_duration_ms', 30000, true],
  ['vowel 30001', 'window.start vowel', 'payload.max_duration_ms', 30001, false],
  ['vowel with position', 'window.start vowel', 'payload.phrase_position', 2, false],
  ['phrase 8000', 'window.start phrase', 'payload.max_duration_ms', 8000, true],
  ['phrase 7999', 'window.start phrase', 'payload.max_duration_ms', 7999, false],
  ['phrase 8001', 'window.start phrase', 'payload.max_duration_ms', 8001, false],
  ['phrase position null', 'window.start phrase', 'payload.phrase_position', null, false],
  ['phrase position 0', 'window.start phrase', 'payload.phrase_position', 0, false],
  ['phrase position 10', 'window.start phrase', 'payload.phrase_position', 10, true],
  ['phrase position 11', 'window.start phrase', 'payload.phrase_position', 11, false],
  ['phrase position 1.5', 'window.start phrase', 'payload.phrase_position', 1.5, false],
  ['vad floor 0', 'window.start phrase', 'payload.vad_floor_dbfs', 0, true],
  ['vad floor above 0', 'window.start phrase', 'payload.vad_floor_dbfs', 0.1, false],
  ['vad floor -140', 'window.start phrase', 'payload.vad_floor_dbfs', -140, true],
  ['vad floor below -140', 'window.start phrase', 'payload.vad_floor_dbfs', -140.1, false],
  ['window kind unknown', 'window.start phrase', 'payload.kind', 'sing', false],
  ['max_duration fractional', 'window.start vowel', 'payload.max_duration_ms', 6000.5, false],
  // listener.open
  ['listener timeout 4999', 'listener.open', 'payload.timeout_ms', 4999, false],
  ['listener timeout 5000', 'listener.open', 'payload.timeout_ms', 5000, true],
  ['listener timeout 60000', 'listener.open', 'payload.timeout_ms', 60000, true],
  ['listener timeout 60001', 'listener.open', 'payload.timeout_ms', 60001, false],
  // session.begin and session.state
  ['begin phrase_count 0', 'session.begin', 'payload.phrase_count', 0, true],
  ['begin phrase_count 10', 'session.begin', 'payload.phrase_count', 10, true],
  ['begin phrase_count 11', 'session.begin', 'payload.phrase_count', 11, false],
  ['begin phrase_count -1', 'session.begin', 'payload.phrase_count', -1, false],
  ['begin cues_max 2', 'session.begin', 'payload.cues_max', 2, false],
  ['begin cues_max string', 'session.begin', 'payload.cues_max', '3', false],
  ['begin family_mode number', 'session.begin', 'payload.family_mode', 1, false],
  ['state stage unknown', 'session.state', 'payload.stage', 'lobby', false],
  ['state phrase_position 10', 'session.state', 'payload.phrase_position', 10, true],
  ['state phrase_position 11', 'session.state', 'payload.phrase_position', 11, false],
  ['state cues_used 3', 'session.state', 'payload.cues_used', 3, true],
  ['state cues_used 4', 'session.state', 'payload.cues_used', 4, false],
  ['state listener attempt bad prefix', 'session.state', 'payload.listener_open_attempt', 'w_window001', false],
  ['state listener attempt short', 'session.state', 'payload.listener_open_attempt', 'a_short', false],
  // pairing codes and credentials
  ['pairing code lowercase', 'join.request', 'payload.pairing_code', 'acdefh', false],
  ['pairing code 5 chars', 'join.request', 'payload.pairing_code', 'ACDEF', false],
  ['pairing code 7 chars', 'join.request', 'payload.pairing_code', 'ACDEFHJ', false],
  ['pairing code with space', 'join.request', 'payload.pairing_code', 'ACDEF ', false],
  ['pairing code number', 'join.request', 'payload.pairing_code', 123456, false],
  ['credential 43 chars', 'room.created', 'payload.tv_credential', CRED, true],
  ['credential 42 chars', 'room.created', 'payload.tv_credential', CRED.slice(1), false],
  ['credential 44 chars', 'room.created', 'payload.tv_credential', `${CRED}A`, false],
  ['credential plus sign', 'room.created', 'payload.tv_credential', `${CRED.slice(1)}+`, false],
  ['credential padding', 'room.created', 'payload.tv_credential', `${CRED.slice(1)}=`, false],
  ['credential slash', 'room.created', 'payload.tv_credential', `${CRED.slice(1)}/`, false],
  ['phone credential 42', 'join.accepted', 'payload.phone_credential', CRED.slice(1), false],
  ['auth credential 44', 'auth.resume tv', 'payload.credential', `${CRED}A`, false],
  // join
  ['confirm_digits 00', 'join.pending', 'payload.confirm_digits', '00', true],
  ['confirm_digits 99', 'join.pending', 'payload.confirm_digits', '99', true],
  ['confirm_digits 1 digit', 'join.pending', 'payload.confirm_digits', '1', false],
  ['confirm_digits 3 digits', 'join.pending', 'payload.confirm_digits', '123', false],
  ['confirm_digits letters', 'join.pending', 'payload.confirm_digits', 'ab', false],
  ['confirm_digits arabic-indic', 'join.pending', 'payload.confirm_digits', '٣٤', false],
  ['confirm_digits number', 'join.pending', 'payload.confirm_digits', 47, false],
  ['join_id 8 chars', 'join.pending', 'payload.join_id', 'j_12345678', true],
  ['join_id 7 chars', 'join.pending', 'payload.join_id', 'j_1234567', false],
  ['join_id 40 chars', 'join.pending', 'payload.join_id', `j_${'a'.repeat(40)}`, true],
  ['join_id 41 chars', 'join.pending', 'payload.join_id', `j_${'a'.repeat(41)}`, false],
  ['join_id wrong prefix', 'join.pending', 'payload.join_id', 's_12345678', false],
  ['join decision unknown', 'join.confirm accept', 'payload.decision', 'maybe', false],
  ['join reject reason unknown', 'join.rejected', 'payload.reason', 'denied', false],
  ['join reject reason expired', 'join.rejected', 'payload.reason', 'expired', true],
  ['join expires_at negative', 'join.pending', 'payload.expires_at', -1, false],
  ['join expires_at fractional', 'join.pending', 'payload.expires_at', 1.5, false],
  // text fields
  ['device_label 24 code points', 'join.request', 'payload.device_label', 'a'.repeat(24), true],
  ['device_label 25 code points', 'join.request', 'payload.device_label', 'a'.repeat(25), false],
  ['device_label empty', 'join.request', 'payload.device_label', '', false],
  ['device_label spaces only', 'join.request', 'payload.device_label', '   ', false],
  ['device_label 24 emoji', 'join.request', 'payload.device_label', '\u{1F600}'.repeat(24), true],
  ['device_label 25 emoji', 'join.request', 'payload.device_label', '\u{1F600}'.repeat(25), false],
  ['cue 12 code points', 'cue', 'payload.text', 'a'.repeat(12), true],
  ['cue 13 code points', 'cue', 'payload.text', 'a'.repeat(13), false],
  ['cue empty', 'cue', 'payload.text', '', false],
  ['cue number', 'cue', 'payload.text', 7, false],
  ['phrases 60 code points', 'phrases.update', 'payload.phrases.0', 'b'.repeat(60), true],
  ['phrases 61 code points', 'phrases.update', 'payload.phrases.0', 'b'.repeat(61), false],
  ['phrases 60 emoji', 'phrases.update', 'payload.phrases.0', '\u{1F600}'.repeat(60), true],
  ['phrases 61 emoji', 'phrases.update', 'payload.phrases.0', '\u{1F600}'.repeat(61), false],
  ['phrases empty item', 'phrases.update', 'payload.phrases.0', '', false],
  ['phrases 10 items', 'phrases.update', 'payload.phrases', Array.from({ length: 10 }, (_, i) => `phrase ${i}`), true],
  ['phrases 11 items', 'phrases.update', 'payload.phrases', Array.from({ length: 11 }, (_, i) => `phrase ${i}`), false],
  ['phrases 0 items', 'phrases.update', 'payload.phrases', [], false],
  ['phrases item number', 'phrases.update', 'payload.phrases.1', 5, false],
  ['phrases not array', 'phrases.update', 'payload.phrases', 'one,two', false],
  ['app_version 32', 'room.create vega', 'payload.client.app_version', 'v'.repeat(32), true],
  ['app_version 33', 'room.create vega', 'payload.client.app_version', 'v'.repeat(33), false],
  ['app_version empty', 'room.create vega', 'payload.client.app_version', '', false],
  ['platform unknown', 'room.create vega', 'payload.client.platform', 'ios', false],
  ['platform test', 'room.create vega', 'payload.client.platform', 'test', true],
  // precheck.result and window.result
  ['precheck coverage 0', 'precheck.result', 'payload.coverage', 0, true],
  ['precheck coverage 1', 'precheck.result', 'payload.coverage', 1, true],
  ['precheck coverage above 1', 'precheck.result', 'payload.coverage', 1.0001, false],
  ['precheck coverage negative', 'precheck.result', 'payload.coverage', -0.0001, false],
  ['precheck frame_count 700', 'precheck.result', 'payload.frame_count', 700, true],
  ['precheck frame_count 701', 'precheck.result', 'payload.frame_count', 701, false],
  ['precheck frame_count fractional', 'precheck.result', 'payload.frame_count', 99.5, false],
  ['precheck valid with reason', 'precheck.result', 'payload.invalid_reason', 'clipped', false],
  ['precheck invalid without reason', 'precheck.result invalid', 'payload.invalid_reason', null, false],
  ['precheck reason from window list', 'precheck.result invalid', 'payload.invalid_reason', 'no_voice', false],
  ['precheck floor null', 'precheck.result', 'payload.floor_dbfs', null, true],
  ['precheck floor -141', 'precheck.result', 'payload.floor_dbfs', -141, false],
  ['precheck p95 21', 'precheck.result', 'payload.p95_dbfs', 21, false],
  ['precheck duration negative', 'precheck.result', 'payload.duration_ms', -1, false],
  ['precheck purpose unknown', 'precheck.result', 'payload.purpose', 'other', false],
  ['window.result valid with reason', 'window.result', 'payload.invalid_reason', 'clipped', false],
  ['window.result invalid without reason', 'window.result invalid', 'payload.invalid_reason', null, false],
  ['window.result reason from precheck list', 'window.result invalid', 'payload.invalid_reason', 'burst_noise', false],
  ['window.result onset null', 'window.result', 'payload.onset_ms', null, true],
  ['window.result onset negative', 'window.result', 'payload.onset_ms', -1, false],
  ['window.result segments fractional', 'window.result', 'payload.segments', 2.5, false],
  ['window.result kind unknown', 'window.result', 'payload.kind', 'cough', false],
  ['window.result coverage 1.5', 'window.result', 'payload.coverage', 1.5, false],
  ['window.result peak above 20', 'window.result', 'payload.peak_dbfs', 20.5, false],
  ['window.result clipped_frames string', 'window.result', 'payload.clipped_frames', '0', false],
  // mic.state
  ['mic sample_rate 0', 'mic.state no session', 'payload.settings.sample_rate', 0, false],
  ['mic sample_rate 384000', 'mic.state no session', 'payload.settings.sample_rate', 384000, true],
  ['mic sample_rate 384001', 'mic.state no session', 'payload.settings.sample_rate', 384001, false],
  ['mic sample_rate null', 'mic.state no session', 'payload.settings.sample_rate', null, true],
  ['mic channel_count 0', 'mic.state no session', 'payload.settings.channel_count', 0, false],
  ['mic channel_count 1.5', 'mic.state no session', 'payload.settings.channel_count', 1.5, false],
  ['mic channel_count 2', 'mic.state no session', 'payload.settings.channel_count', 2, true],
  ['mic channel_count 65', 'mic.state no session', 'payload.settings.channel_count', 65, false],
  ['mic state unknown', 'mic.state no session', 'payload.state', 'muted', false],
  ['mic wake_lock unknown', 'mic.state no session', 'payload.wake_lock', 'maybe', false],
  ['mic visibility unknown', 'mic.state no session', 'payload.visibility', 'prerender', false],
  ['mic mode unknown', 'mic.state no session', 'payload.mode', 'tv', false],
  ['mic supported null', 'mic.state no session', 'payload.supported', null, false],
  // revision 3: each supported flag is boolean | null (null = getSupportedConstraints() unavailable)
  ['mic supported agc null', 'mic.state no session', 'payload.supported.auto_gain_control', null, true],
  ['mic supported echo null', 'mic.state no session', 'payload.supported.echo_cancellation', null, true],
  ['mic supported ns null', 'mic.state no session', 'payload.supported.noise_suppression', null, true],
  ['mic supported agc false', 'mic.state no session', 'payload.supported.auto_gain_control', false, true],
  ['mic supported agc string', 'mic.state no session', 'payload.supported.auto_gain_control', 'false', false],
  ['mic supported echo string', 'mic.state no session', 'payload.supported.echo_cancellation', 'null', false],
  ['mic supported ns string', 'mic.state no session', 'payload.supported.noise_suppression', 'true', false],
  ['mic supported agc number', 'mic.state no session', 'payload.supported.auto_gain_control', 0, false],
  ['mic supported echo object', 'mic.state no session', 'payload.supported.echo_cancellation', {}, false],
  ['mic supported ns missing', 'mic.state no session', 'payload.supported.noise_suppression', DELETE, false],
  ['mic supported extra key', 'mic.state no session', 'payload.supported.zz', null, false],
  ['mic agc string', 'mic.state no session', 'payload.settings.auto_gain_control', 'false', false],
  // errors and acks
  ['error code unknown', 'error', 'payload.code', 'oops', false],
  ['error code internal', 'error', 'payload.code', 'internal', true],
  ['error detail 64', 'error', 'payload.detail', 'd'.repeat(64), true],
  ['error detail 65', 'error', 'payload.detail', 'd'.repeat(65), false],
  ['error detail newline', 'error', 'payload.detail', 'line\nbreak', false],
  ['error ref bad format', 'error', 'payload.ref_message_id', 'not-an-id', false],
  ['error ref missing prefix', 'error', 'payload.ref_message_id', 'x_0123456789abcdefghijkl', false],
  ['ack acked id bad', 'ack from tv', 'payload.acked_message_id', 'm_short', false],
  ['ack outcome duplicate (not in v1)', 'ack from tv', 'payload.outcome', 'duplicate', false],
  ['ack outcome rejected', 'ack from tv', 'payload.outcome', 'rejected', true],
  ['ack detail 65', 'ack from tv', 'payload.detail', 'd'.repeat(65), false],
  // lifecycle misc
  ['pong server_time negative', 'pong', 'payload.server_time', -1, false],
  ['pong server_time fractional', 'pong', 'payload.server_time', 1.5, false],
  ['pong server_time string', 'pong', 'payload.server_time', String(NOW), false],
  ['auth.ok role relay', 'auth.ok', 'payload.role', 'relay', false],
  ['auth.ok generation 2^31-1', 'auth.ok', 'payload.generation', 2 ** 31 - 1, true],
  ['auth.ok generation 2^31', 'auth.ok', 'payload.generation', 2 ** 31, false],
  ['auth.ok generation negative', 'auth.ok', 'payload.generation', -1, false],
  ['auth.ok peer_connected string', 'auth.ok', 'payload.peer_connected', 'true', false],
  ['peer.state role unknown', 'peer.state', 'payload.role', 'speaker', false],
  ['unpaired reason unknown', 'unpaired', 'payload.reason', 'bored', false],
  ['unpaired reason room_closed', 'unpaired', 'payload.reason', 'room_closed', true],
  ['room.created payload room mismatch', 'room.created', 'payload.room_id', 'r_ZZZZZZZZZZZZZZZZZZZZZZ', false],
  ['room.created bad code alphabet', 'room.created', 'payload.pairing_code', 'ACDEFB', false],
  ['room.created code_expires_at negative', 'room.created', 'payload.code_expires_at', -5, false],
  ['join.accepted payload room mismatch', 'join.accepted', 'payload.room_id', 'r_ZZZZZZZZZZZZZZZZZZZZZZ', false],
  ['auth.resume role relay', 'auth.resume tv', 'payload.role', 'relay', false],
  ['auth.resume payload room mismatch', 'auth.resume tv', 'payload.room_id', 'r_ZZZZZZZZZZZZZZZZZZZZZZ', false],
  ['auth.resume payload room bad format', 'auth.resume tv', 'payload.room_id', 'r_short', false],
  ['window.stop reason unknown', 'window.stop', 'payload.reason', 'because', false],
  ['window.cancel reason session_end', 'window.cancel', 'payload.reason', 'session_end', true],
  ['window.cancel reason unknown', 'window.cancel', 'payload.reason', 'tired', false],
  ['session.end reason error', 'session.end', 'payload.reason', 'error', true],
  ['session.end reason unknown', 'session.end', 'payload.reason', 'bored', false],
  ['listener.response unknown', 'listener.response', 'payload.response', 'maybe', false],
  ['listener.response not_heard', 'listener.response', 'payload.response', 'not_heard', true],
];

describe('boundary and range cases', () => {
  for (const [label, fixture, path, value, ok] of cases) {
    it(`${label}: ${ok ? 'accepted' : 'rejected'}`, () => {
      const message = patched(fixtureOf(fixture), path, value);
      if (ok) expectOk(message);
      else expectFail(message, 'bad_schema');
    });
  }

  it('accepts a pairing code made of every alphabet character', () => {
    for (let i = 0; i + 6 <= PAIRING_ALPHABET.length; i += 1) {
      const code = PAIRING_ALPHABET.slice(i, i + 6);
      expectOk(patched(fixtureOf('join.request'), 'payload.pairing_code', code));
    }
    expect(PAIRING_ALPHABET.length).toBe(22);
  });

  it('rejects every character outside the pairing alphabet', () => {
    const outside = 'BGIOQSZ0125 68lobgqsz-_/+=À٠';
    for (const ch of outside) {
      expectFail(patched(fixtureOf('join.request'), 'payload.pairing_code', `ACDEF${ch}`), 'bad_schema');
    }
  });
});

describe('non-finite numbers (object entry point)', () => {
  const nonFinite = [NaN, Infinity, -Infinity];
  const targets: Array<[string, string]> = [
    ['level', 'payload.dbfs'],
    ['level', 'payload.t_audio_ms'],
    ['level', 'payload.frame_index'],
    ['window.start phrase', 'payload.vad_floor_dbfs'],
    ['window.start phrase', 'payload.max_duration_ms'],
    ['precheck.result', 'payload.coverage'],
    ['precheck.result', 'payload.floor_dbfs'],
    ['window.result', 'payload.active_ms'],
    ['window.result', 'payload.onset_ms'],
    ['mic.state no session', 'payload.settings.sample_rate'],
    ['pong', 'payload.server_time'],
    ['listener.open', 'payload.timeout_ms'],
    ['level', 'sequence'],
    ['level', 'producer_generation'],
    ['level', 'event_timestamp'],
  ];
  for (const [fixture, path] of targets) {
    for (const bad of nonFinite) {
      it(`${fixture} ${path} = ${String(bad)}`, () => {
        const r = validateMessageObject(patchedRaw(fixtureOf(fixture), path, bad), OPTS);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('bad_schema');
      });
    }
  }

  it('rejects 1e999 in JSON text (parses to Infinity)', () => {
    const text = JSON.stringify(fixtureOf('level')).replace('"dbfs":-42.25', '"dbfs":1e999');
    expect(text).toContain('1e999');
    const r = parseWireMessage(text, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_schema');
  });

  it('rejects BigInt, undefined and function values without throwing', () => {
    for (const bad of [10n, undefined, () => 1, Symbol('x')]) {
      const r = validateMessageObject(patchedRaw(fixtureOf('level'), 'payload.dbfs', bad), OPTS);
      expect(r.ok).toBe(false);
    }
  });
});

describe('does not mutate or alias the input', () => {
  it('leaves the caller object untouched', () => {
    const original = fixtureOf('phrases.update');
    const snapshot = clone(original);
    const r = validateMessageObject(original, OPTS);
    expect(r.ok).toBe(true);
    expect(original).toEqual(snapshot);
    if (r.ok) {
      (r.message.payload as { phrases: string[] }).phrases.push('mutated');
      expect(original).toEqual(snapshot);
    }
  });
});

describe('error responses', () => {
  it('echoes message_id only when well formed', () => {
    const bad = patched(fixtureOf('level'), 'payload.dbfs', 99);
    const r = validateMessageObject(bad, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ref_message_id).toBe(bad.message_id);

    const badId = patched(patched(fixtureOf('level'), 'payload.dbfs', 99), 'message_id', 'not valid');
    const r2 = validateMessageObject(badId, OPTS);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.ref_message_id).toBeNull();
  });

  it('never puts input content into detail', () => {
    const secret = 'TOPSECRETPHRASE';
    const msg = patched(fixtureOf('phrases.update'), 'payload.phrases.0', `${secret}\u0000`);
    const r = validateMessageObject(msg, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).not.toContain(secret);
    const extra = patched(fixtureOf('level'), `payload.${secret}`, 1);
    const r2 = validateMessageObject(extra, OPTS);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.detail).not.toContain(secret);
  });

  it('uses fixtures that carry sensible ids', () => {
    expect(ROOM.length).toBe(24);
    expect(MID2.length).toBe(24);
  });
});

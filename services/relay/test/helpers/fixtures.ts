import type { MessageType } from '../../src/core/protocol-port.js';

/** Distinctive strings that must never appear in any log line. */
export const SECRET_PHRASE = 'Zebra Quokka Marmalade Sentence';
export const SECRET_CUE = 'Quibble9';
export const SECRET_LABEL = 'Hannahs-Pixel';

export const MIC_STATE = {
  state: 'open_idle',
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

export const PRECHECK_RESULT = {
  purpose: 'quiet_check',
  valid: true,
  invalid_reason: null,
  floor_dbfs: -62.5,
  p20_dbfs: -61,
  p80_dbfs: -58,
  p95_dbfs: -55,
  frame_count: 100,
  expected_frames: 100,
  coverage: 1,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 5000,
};

export const WINDOW_RESULT = {
  kind: 'vowel',
  valid: true,
  invalid_reason: null,
  frame_count: 400,
  expected_frames: 400,
  coverage: 1,
  active_ms: 12000,
  longest_active_ms: 9000,
  segments: 2,
  onset_ms: 300,
  p50_active_dbfs: -30,
  p95_active_dbfs: -22,
  peak_dbfs: -18,
  clipped_frames: 0,
  nonfinite_frames: 0,
  duration_ms: 20000,
};

/** A valid payload for every message type a client may send (join ids and room ids are filled by tests). */
export const VALID_PAYLOADS: Partial<Record<MessageType, Record<string, unknown>>> = {
  'room.create': { client: { app_version: '0.1.0', platform: 'test' } },
  'pairing.refresh': {},
  'join.confirm': { join_id: 'j_joinid0000000000001', decision: 'accept' },
  unpair: {},
  'room.close': {},
  ping: {},
  'session.begin': { family_mode: false, phrase_count: 3, cues_max: 3 },
  'session.state': { stage: 'idle', phrase_position: 0, cues_used: 0, listener_open_attempt: null },
  'precheck.start': { purpose: 'quiet_check', duration_ms: 5000 },
  'window.start': { kind: 'vowel', phrase_position: null, max_duration_ms: 30000, vad_floor_dbfs: -60 },
  'window.stop': { reason: 'complete' },
  'window.cancel': { reason: 'user_cancel' },
  'listener.open': { timeout_ms: 10000 },
  'attempt.reveal': {},
  'session.end': { reason: 'completed' },
  'mic.state': MIC_STATE,
  'precheck.result': PRECHECK_RESULT,
  level: { frame_index: 1, t_audio_ms: 50, dbfs: -40.5, active: true, clipped: false },
  'window.result': WINDOW_RESULT,
  'listener.response': { response: 'heard' },
  cue: { text: SECRET_CUE },
  'phrases.update': { phrases: [SECRET_PHRASE, 'Another household phrase'] },
  ack: { acked_message_id: 'm_ackedmessage0001', outcome: 'applied', detail: '' },
};

export const TV_FORWARD_TYPES: MessageType[] = [
  'session.begin',
  'session.state',
  'precheck.start',
  'window.start',
  'window.stop',
  'window.cancel',
  'listener.open',
  'attempt.reveal',
  'session.end',
];
export const PHONE_FORWARD_TYPES: MessageType[] = [
  'mic.state',
  'precheck.result',
  'level',
  'window.result',
  'listener.response',
  'cue',
  'phrases.update',
];

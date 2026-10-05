/**
 * The scripted phone must speak frames the TV accepts. These checks run the phone's payload builders through the
 * protocol validators (via MessageFactory) and through session-core's TV-side re-validation (A1-05..A1-09), so a
 * drift fails here with a reason instead of stalling the browser journey on an `integrity` screen.
 *
 * Background (wave 2): the journey stalled at calibration because the script reported duration_ms 8000 for a
 * calibration window the TV had commanded for 6000 ms. That is not a session-core false positive: the TV rule
 * `duration_ms <= max_duration_ms + 500` is part of A1-09, and a real phone cannot report more than it captured.
 */
import { describe, expect, it } from 'vitest';
import { MessageFactory, createIdFactory } from '@atr/protocol';
import { evaluateCalibration, evaluateGate, evaluateQuietCheck, validateWindowResult } from '@atr/session-core';
import { FLOOR, precheckPayload, windowResultPayload } from './scripted-phone.js';

const ROOM = 'r_a11yreviewroom0001';
const phone = (): MessageFactory =>
  new MessageFactory({ role: 'phone', idFactory: createIdFactory(), clock: () => Date.now(), roomId: ROOM, generation: 1 });
const ids = { session_id: 's_a11yreview0001', window_id: 'w_a11yreview0001', attempt_id: 'a_a11yreview0001' };

describe('scripted phone frames satisfy the protocol and the TV re-validation', () => {
  const windows = [
    ['calibration', 6000, 20],
    ['phrase', 8000, 25],
    ['phrase', 8000, 5],
    ['vowel', 30_000, 25],
  ] as const;

  for (const [kind, max, rel] of windows) {
    it(`${kind} window commanded for ${max} ms (rel ${rel} dB): wire-valid and TV-valid`, () => {
      const payload = windowResultPayload(kind, max, { rel });
      expect(() => phone().next('window.result', payload, ids)).not.toThrow();
      expect(validateWindowResult(kind, payload)).toEqual({ valid: true });
      expect(payload.duration_ms).toBeLessThanOrEqual(max + 500);
      expect(payload.active_ms).toBeLessThanOrEqual(payload.duration_ms);
      expect(payload.expected_frames).toBe(Math.floor(payload.duration_ms / 50));
    });
  }

  it('a calibration at rel 20 dB over a -50 dBFS floor is accepted with margin 20', () => {
    const payload = windowResultPayload('calibration', 6000, { rel: 20 });
    expect(evaluateCalibration(payload, FLOOR)).toEqual({ accepted: true, marginDb: 20 });
  });

  it('a phone-reported invalid window keeps its own reason (never "integrity")', () => {
    const payload = windowResultPayload('phrase', 8000, { rel: 25, valid: false, reason: 'no_voice' });
    expect(() => phone().next('window.result', payload, ids)).not.toThrow();
    expect(validateWindowResult('phrase', payload)).toEqual({ valid: false, reason: 'no_voice' });
  });

  it('prechecks: the quiet check passes and the pre-window gate passes against the quiet floor and a 20 dB band', () => {
    const quiet = precheckPayload('quiet_check');
    const pre = precheckPayload('pre_window');
    expect(() => phone().next('precheck.result', quiet, ids)).not.toThrow();
    expect(() => phone().next('precheck.result', pre, ids)).not.toThrow();
    expect(evaluateQuietCheck(quiet)).toMatchObject({ ok: true, floorDbfs: FLOOR });
    expect(evaluateGate(pre, FLOOR, 20)).toMatchObject({ pass: true, riseDb: 0 });
  });

  it('the TV timing rule (A1-09) is exactly max_duration_ms + 500: 6500 ms is accepted for a calibration, 6501 ms and the old fixed 8000 ms are "integrity"', () => {
    const at = (duration: number) => ({ ...windowResultPayload('calibration', 6000, { rel: 20 }), duration_ms: duration, frame_count: Math.floor(duration / 50), expected_frames: Math.floor(duration / 50) });
    expect(validateWindowResult('calibration', at(6500))).toEqual({ valid: true });
    expect(validateWindowResult('calibration', at(6501))).toEqual({ valid: false, reason: 'integrity' });
    expect(validateWindowResult('calibration', at(8000))).toEqual({ valid: false, reason: 'integrity' });
    // The wire validator alone accepts all of them: the protocol invariants hold, only the TV's own timing rule fails.
    expect(() => phone().next('window.result', at(8000), ids)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import * as C from '../src/constants.js';

/**
 * Independent transcription of the ADR-0001 constants (typed from the ADR text, not imported).
 * If a constant is edited, this table must be edited deliberately in the same change.
 */
describe('ADR-0001 constants', () => {
  it('match the ADR text', () => {
    expect(C.FRAME_MS).toBe(50);
    expect(C.EPSILON_RMS).toBe(1e-7);
    expect(C.DBFS_MIN).toBe(-140);
    expect(C.DBFS_MAX).toBe(20);
    expect(C.CLIP_SAMPLE).toBe(0.999);
    expect(C.CLIP_FRAME_FRACTION).toBe(0.005);
    expect(C.VAD_CANDIDATE_DB).toBe(6);
    expect(C.VAD_ACCEPT_MIN_FRAMES).toBe(4);
    expect(C.VAD_END_GAP_FRAMES).toBe(6);
    expect(C.QUIET_CHECK_MS).toBe(5000);
    expect(C.PRECHECK_MS).toBe(2000);
    expect(C.PRECHECK_COVERAGE_MIN).toBe(0.9);
    expect(C.QUIET_STABLE_MAX_DB).toBe(6);
    expect(C.BURST_MAX_DB).toBe(10);
    expect(C.QUIET_FLOOR_MAX_DBFS).toBe(-30);
    expect(C.WINDOW_COVERAGE_MIN).toBe(0.9);
    expect(C.WINDOW_CLIPPED_ACTIVE_FRACTION_MAX).toBe(0.02);
    expect(C.WINDOW_NONFINITE_FRACTION_MAX).toBe(0.05);
    expect(C.MIN_ACTIVE_MS).toBe(400);
    expect(C.CONTINUOUS_FRACTION).toBe(0.95);
    expect(C.MAX_LEVEL_FRAMES).toBe(700);
    expect(C.WINDOW_MAX_MS).toEqual({ calibration: 6000, phrase: 8000, vowel: 30000 });
  });

  it('minimum accepted segment is 200 ms of candidate activity and 6 gap frames is 300 ms', () => {
    expect(C.VAD_ACCEPT_MIN_FRAMES * C.FRAME_MS).toBe(200);
    expect((C.VAD_END_GAP_FRAMES - 1) * C.FRAME_MS).toBe(250);
    expect(C.VAD_END_GAP_FRAMES * C.FRAME_MS).toBe(300);
  });

  it('keeps the calibration and pre-window gates coherent (ADR-0001 §5)', () => {
    // An accepted calibration has cal_margin >= 13 dB. An unchanged room has rise <= 3 dB and
    // must never be blocked: 13 - 3 = 10 is not < 10.
    const unchangedRoomRise = 3;
    const calMargin = C.CAL_MARGIN_MIN_DB;
    expect(unchangedRoomRise >= C.PRE_WINDOW_RISE_BLOCK_DB).toBe(false);
    expect(calMargin - unchangedRoomRise < C.PRE_WINDOW_MARGIN_BLOCK_DB).toBe(false);
    expect(C.VERDICT_MARGIN_DB).toBe(1);
    expect(C.BORDERLINE_DB).toBe(1);
  });
});

#!/usr/bin/env python3
"""Generate fixtures/dsp/*.json (revision 2 rules: ADR-0001 as amended by AMENDMENTS-REV2).

Provenance (read this before trusting the files):

* Every expected value in this script is HAND-DERIVED from ADR-0001 and the revision 2
  amendments by reasoning about the structure of the fixture (the `derivation` strings say how).
  They are typed in below as literals.
* oracle.py, next to this script, is a second, independent Python implementation of the same
  rules (not a port of the TypeScript package). This script refuses to write any fixture unless
  the oracle reproduces the hand-derived literals, so a slip in the hand derivation (or in the
  oracle) is caught here. The Monte-Carlo noise fixture is different: its recorded rates are
  oracle output (the rule being tested is a probability, not a closed form); the TypeScript test
  regenerates the same seeded trials independently and must reproduce the oracle's counts.
* The TypeScript tests then compare the shipped implementation against the JSON. No expected
  value is produced by the code under test.

Run from the repository root:  python3 fixtures/dsp/tools/derive_fixtures.py

Fixture frames carry only an RMS level. A frame's peak is defined equal to its RMS (a
constant-amplitude frame), so peak_dbfs equals the highest finite frame level.

Run encoding (the `runs` arrays):
  [db, n]             n finite frames at db dBFS
  [db, n, "clipped"]  n finite frames at db dBFS flagged clipped
  [null, n]           n non-finite frames (NaN/Infinity in the samples)
  ["gap", n]          n frames missing from the sequence (frame index advances, nothing is pushed)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import (  # noqa: E402
    FRAME_MS,
    ar1_silent_window_study,
    expand,
    frame_db_from_events,
    oracle_precheck,
    oracle_vad,
    oracle_window,
    same,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


# --------------------------------------------------------------------------------------------
# Quiet-check and pre-window fixtures
# --------------------------------------------------------------------------------------------
def blocks(A, B, C, D, E):
    """n = 100: sorted indices 0-19 = A, 20-49 = B, 50-79 = C, 80-94 = D, 95-99 = E.
    Nearest ranks: p20 = sorted[19] = A, p50 = sorted[49] = B, p80 = sorted[79] = C, p95 = sorted[94] = D."""
    return [[A, 20], [B, 30], [C, 30], [D, 15], [E, 5]]


BLOCK_RULE = (
    "Blocks of 100 frames: sorted indices 0-19 = A, 20-49 = B, 50-79 = C, 80-94 = D, 95-99 = E. "
    "Nearest rank for n = 100: p20 = sorted[19] = A, floor = p50 = sorted[49] = B, p80 = sorted[79] = C, "
    "p95 = sorted[94] = D. Emitted values are rounded to 0.1 dB (Math.round, ties toward +infinity) and the "
    "dB rules are decided on the emitted values."
)


def qc(id, description, purpose, duration, runs, hand, derivation):
    expected = {
        "purpose": purpose,
        "valid": hand["valid"],
        "invalid_reason": hand["reason"],
        "floor_dbfs": hand["floor"],
        "p20_dbfs": hand["p20"],
        "p80_dbfs": hand["p80"],
        "p95_dbfs": hand["p95"],
        "frame_count": hand["fc"],
        "expected_frames": hand["ef"],
        "coverage": hand["cov"],
        "clipped_frames": hand.get("cl", 0),
        "nonfinite_frames": hand.get("nf", 0),
        "duration_ms": duration,
    }
    same(expected, oracle_precheck(purpose, duration, expand(runs)), id)
    return {
        "id": id,
        "description": description,
        "purpose": purpose,
        "duration_ms": duration,
        "runs": runs,
        "expected": expected,
        "derivation": derivation,
    }


def flat(floor, p, n, **kw):
    return dict(valid=True, reason=None, floor=floor, p20=floor, p80=floor, p95=floor, fc=n, ef=p, cov=n / p, **kw)


QUIET_CASES = [
    qc("qc-01-valid-typical", "Typical quiet room, all rules satisfied.", "quiet_check", 5000,
       blocks(-46, -43, -40, -36, -35),
       dict(valid=True, reason=None, floor=-43, p20=-46, p80=-40, p95=-36, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -40 - (-46) = 6 (<= 6, stable). p95 - floor = -36 - (-43) = 7 (<= 10). floor -43 <= -30 and >= -110. Coverage 100/100 = 1. Valid."),
    qc("qc-02-stable-exactly-6", "Stability boundary: p80 - p20 is exactly 6.0 dB.", "quiet_check", 5000,
       blocks(-50, -48, -44, -42, -41),
       dict(valid=True, reason=None, floor=-48, p20=-50, p80=-44, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -44 - (-50) = 6.0 <= 6: valid. p95 - floor = -42 - (-48) = 6."),
    qc("qc-03-unstable-6.1", "Stability boundary: p80 - p20 = 6.1 dB (the finest step on the 0.1 dB grid above the limit).", "quiet_check", 5000,
       blocks(-50, -48, -43.9, -42, -41),
       dict(valid=False, reason="unstable_floor", floor=-48, p20=-50, p80=-43.9, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -43.9 - (-50) = 6.1 > 6: unstable_floor. (Revision 1 used 6.01; the grid is now 0.1 dB.)"),
    qc("qc-03b-raw-6.04-rounds-to-valid", "Raw p80 - p20 = 6.04 dB: the emitted p80 is -44.0, the rule is decided on emitted values, so the quiet check is valid.", "quiet_check", 5000,
       blocks(-50, -48, -43.96, -42, -41),
       dict(valid=True, reason=None, floor=-48, p20=-50, p80=-44, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " C = -43.96 -> x10 = -439.6 -> round -440 -> -44.0. Emitted p80 - p20 = -44.0 - (-50.0) = 6.0 <= 6: valid. A receiver recomputing validity from the payload (A1-09) gets the same answer."),
    qc("qc-03c-raw-6.06-rounds-to-invalid", "Raw p80 - p20 = 6.06 dB: the emitted p80 is -43.9, so the quiet check is unstable.", "quiet_check", 5000,
       blocks(-50, -48, -43.94, -42, -41),
       dict(valid=False, reason="unstable_floor", floor=-48, p20=-50, p80=-43.9, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " C = -43.94 -> x10 = -439.4 -> round -439 -> -43.9. Emitted p80 - p20 = 6.1 > 6: unstable_floor."),
    qc("qc-04-burst-exactly-10", "Burst boundary: p95 - floor is exactly 10.0 dB.", "quiet_check", 5000,
       blocks(-46, -43, -40, -33, -30),
       dict(valid=True, reason=None, floor=-43, p20=-46, p80=-40, p95=-33, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p95 - floor = -33 - (-43) = 10.0 <= 10: valid. p80 - p20 = 6 (stable)."),
    qc("qc-05-burst-10.1", "Burst boundary: p95 - floor = 10.1 dB.", "quiet_check", 5000,
       blocks(-46, -43, -40, -32.9, -30),
       dict(valid=False, reason="burst_noise", floor=-43, p20=-46, p80=-40, p95=-32.9, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p95 - floor = -32.9 - (-43) = 10.1 > 10: burst_noise. p80 - p20 = 6 (stable, so not the reported reason)."),
    qc("qc-05b-raw-10.04-rounds-to-valid", "Raw p95 - floor = 10.04 dB rounds to 10.0 and is valid.", "quiet_check", 5000,
       blocks(-46, -43, -40, -32.96, -30),
       dict(valid=True, reason=None, floor=-43, p20=-46, p80=-40, p95=-33, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " D = -32.96 -> x10 = -329.6 -> round -330 -> -33.0. Emitted p95 - floor = 10.0: valid."),
    qc("qc-06-floor-exactly-minus-30", "Loudness boundary: floor is exactly -30.0 dBFS.", "quiet_check", 5000,
       blocks(-33, -30, -28, -24, -23),
       dict(valid=True, reason=None, floor=-30, p20=-33, p80=-28, p95=-24, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " floor = -30 <= -30: valid. p80 - p20 = -28 - (-33) = 5. p95 - floor = -24 - (-30) = 6."),
    qc("qc-07-too-loud-minus-29.9", "Loudness boundary: floor is -29.9 dBFS.", "quiet_check", 5000,
       blocks(-33, -29.9, -28, -24, -23),
       dict(valid=False, reason="too_loud", floor=-29.9, p20=-33, p80=-28, p95=-24, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " floor = -29.9 > -30: too_loud. p80 - p20 = 5 and p95 - floor = 5.9, so only too_loud applies."),
    qc("qc-07b-raw-minus-29.96-rounds-to-valid", "Raw floor -29.96 dBFS rounds to -30.0 and is not too loud.", "quiet_check", 5000,
       blocks(-33, -29.96, -28, -24, -23),
       dict(valid=True, reason=None, floor=-30, p20=-33, p80=-28, p95=-24, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " B = -29.96 -> x10 = -299.6 -> round -300 -> -30.0 <= -30: valid."),
    qc("qc-08-coverage-exactly-0.90", "Coverage boundary: 90 of 100 expected frames.", "quiet_check", 5000,
       [[-50, 90]], flat(-50, 100, 90),
       "90 finite frames at -50 dBFS, expected_frames = 5000/50 = 100: coverage 90/100 = 0.90 >= 0.90. All percentiles are -50. Valid."),
    qc("qc-09-coverage-0.89", "Coverage boundary: 89 of 100 expected frames.", "quiet_check", 5000,
       [[-50, 89]], dict(flat(-50, 100, 89), valid=False, reason="low_coverage"),
       "89 finite frames, expected 100: coverage 0.89 < 0.90: low_coverage."),
    qc("qc-10-clipped-frame", "One clipped frame invalidates and is excluded from the statistics.", "quiet_check", 5000,
       [[-50, 99], [-3, 1, "clipped"]],
       dict(valid=False, reason="clipped", floor=-50, p20=-50, p80=-50, p95=-50, fc=100, ef=100, cov=1.0, cl=1),
       "99 finite non-clipped frames at -50 plus 1 clipped frame at -3. Statistics use the 99 non-clipped frames only, so every percentile is -50. Coverage counts finite frames: 100/100. clipped_frames = 1 > 0: clipped."),
    qc("qc-11-nonfinite-exactly-5pct", "5 of 100 frames non-finite is not more than 5 %.", "quiet_check", 5000,
       [[-50, 95], [None, 5]],
       dict(valid=True, reason=None, floor=-50, p20=-50, p80=-50, p95=-50, fc=100, ef=100, cov=0.95, nf=5),
       "95 finite frames at -50 and 5 non-finite. Non-finite fraction 5/100 = 0.05, not > 0.05. Coverage 95/100 = 0.95 >= 0.90: valid. Non-finite frames are excluded from statistics."),
    qc("qc-12-nonfinite-6pct", "6 of 100 frames non-finite is more than 5 %.", "quiet_check", 5000,
       [[-50, 94], [None, 6]],
       dict(valid=False, reason="nonfinite", floor=-50, p20=-50, p80=-50, p95=-50, fc=100, ef=100, cov=0.94, nf=6),
       "94 finite + 6 non-finite: non-finite fraction 0.06 > 0.05: nonfinite (evaluated before coverage, which would pass at 0.94)."),
    qc("qc-12b-nonfinite-beats-low-coverage", "Revision 2 priority: nonfinite is evaluated before low_coverage.", "quiet_check", 5000,
       [[-50, 40], [None, 10]],
       dict(valid=False, reason="nonfinite", floor=-50, p20=-50, p80=-50, p95=-50, fc=50, ef=100, cov=0.4, nf=10),
       "40 finite + 10 non-finite = 50 frames received of 100 expected. Non-finite fraction 10/50 = 0.2 > 0.05 -> nonfinite. Coverage 40/100 = 0.4 < 0.90 would be low_coverage, but nonfinite has priority (A1-07)."),
    qc("qc-s1-silent-boundary-valid", "A1-05: floor exactly -110.0 dBFS is not silent_input.", "quiet_check", 5000,
       [[-110, 100]], flat(-110, 100, 100),
       "floor = -110.0, not < -110: valid. Stability, burst and loudness rules hold (all percentiles equal)."),
    qc("qc-s2-silent-input", "A1-05: floor -110.1 dBFS is silent_input.", "quiet_check", 5000,
       [[-110.1, 100]], dict(flat(-110.1, 100, 100), valid=False, reason="silent_input"),
       "floor = -110.1 < -110: silent_input (the phone microphone looks muted or blocked)."),
    qc("qc-s3-digital-silence", "A1-05: digital silence (-140 dBFS) used to pass the quiet check and is now silent_input.", "quiet_check", 5000,
       [[-140, 100]], dict(flat(-140, 100, 100), valid=False, reason="silent_input"),
       "100 frames at -140 dBFS: p80 - p20 = 0 and floor <= -30 (the revision 1 rules passed), but floor -140 < -110: silent_input."),
    qc("qc-s4-raw-minus-110.04-valid", "Raw floor -110.04 rounds to -110.0: not silent.", "quiet_check", 5000,
       [[-110.04, 100]], flat(-110, 100, 100),
       "-110.04 -> x10 = -1100.4 -> round -1100 -> -110.0, not < -110: valid."),
    qc("qc-s5-raw-minus-110.06-silent", "Raw floor -110.06 rounds to -110.1: silent.", "quiet_check", 5000,
       [[-110.06, 100]], dict(flat(-110.1, 100, 100), valid=False, reason="silent_input"),
       "-110.06 -> x10 = -1100.6 -> round -1101 -> -110.1 < -110: silent_input."),
    qc("qc-s6-prewindow-silent", "A1-05 applies to the pre-window check too.", "pre_window", 2000,
       [[-140, 40]], dict(flat(-140, 40, 40), valid=False, reason="silent_input"),
       "40 frames at -140: floor -140 < -110: silent_input (pre_window reason set includes silent_input)."),
    qc("qc-s7-low-coverage-beats-silent", "low_coverage is evaluated before silent_input.", "quiet_check", 5000,
       [[-140, 50]], dict(flat(-140, 100, 50), valid=False, reason="low_coverage"),
       "50 of 100 frames: coverage 0.5 < 0.90 -> low_coverage, although the floor -140 would be silent_input."),
    qc("qc-s8-silent-beats-clipped", "silent_input is evaluated before clipped.", "quiet_check", 5000,
       [[-120, 99], [-3, 1, "clipped"]],
       dict(valid=False, reason="silent_input", floor=-120, p20=-120, p80=-120, p95=-120, fc=100, ef=100, cov=1.0, cl=1),
       "99 non-clipped frames at -120 (floor -120 < -110) plus one clipped frame: silent_input outranks clipped."),
    qc("qc-13-prewindow-valid", "Pre-window check, quiet room.", "pre_window", 2000,
       [[-50, 30], [-45, 10]],
       dict(valid=True, reason=None, floor=-50, p20=-50, p80=-45, p95=-45, fc=40, ef=40, cov=1.0),
       "n = 40: sorted idx 0-29 = -50, 30-39 = -45. floor = p50 = sorted[ceil(20)-1 = 19] = -50. p20 = sorted[7] = -50. p80 = sorted[31] = -45. p95 = sorted[ceil(38)-1 = 37] = -45. p95 - floor = 5 <= 10. expected_frames = 2000/50 = 40."),
    qc("qc-14-prewindow-burst-exactly-10", "Pre-window burst boundary: exactly 10.0 dB.", "pre_window", 2000,
       [[-50, 30], [-40, 10]],
       dict(valid=True, reason=None, floor=-50, p20=-50, p80=-40, p95=-40, fc=40, ef=40, cov=1.0),
       "n = 40: idx 0-29 = -50, 30-39 = -40. floor = sorted[19] = -50, p95 = sorted[37] = -40. p95 - floor = 10.0 <= 10: valid."),
    qc("qc-15-prewindow-burst-10.1", "Pre-window burst boundary: 10.1 dB.", "pre_window", 2000,
       [[-50, 30], [-39.9, 10]],
       dict(valid=False, reason="burst_noise", floor=-50, p20=-50, p80=-39.9, p95=-39.9, fc=40, ef=40, cov=1.0),
       "p95 - floor = -39.9 - (-50) = 10.1 > 10: burst_noise."),
    qc("qc-16-prewindow-unstable-and-loud-is-valid", "Pre-window does not judge stability or absolute loudness (A1-06: the TV judges rise and margin).", "pre_window", 2000,
       [[-28, 8], [-24, 12], [-20, 12], [-16, 6], [-15, 2]],
       dict(valid=True, reason=None, floor=-24, p20=-28, p80=-20, p95=-16, fc=40, ef=40, cov=1.0),
       "n = 40: idx 0-7 = -28, 8-19 = -24, 20-31 = -20, 32-37 = -16, 38-39 = -15. p20 = sorted[7] = -28, floor = sorted[19] = -24, p80 = sorted[31] = -20, p95 = sorted[37] = -16. p80 - p20 = 8 (would be unstable_floor for a quiet check) and floor -24 > -30 (would be too_loud), but unstable_floor and too_loud do not exist for pre_window: only p95 - floor = 8 <= 10 is checked. Valid."),
    qc("qc-17-quiet-check-same-shape-is-unstable", "The same level shape as a quiet check (n = 100) is unstable.", "quiet_check", 5000,
       blocks(-28, -24, -20, -16, -15),
       dict(valid=False, reason="unstable_floor", floor=-24, p20=-28, p80=-20, p95=-16, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -20 - (-28) = 8 > 6: unstable_floor (checked before burst and loudness)."),
    qc("qc-18-prewindow-coverage-0.90", "Pre-window coverage boundary: 36 of 40.", "pre_window", 2000,
       [[-50, 36]], flat(-50, 40, 36),
       "36 finite frames, expected 40: coverage 0.90 >= 0.90: valid."),
    qc("qc-19-prewindow-coverage-0.875", "Pre-window coverage: 35 of 40.", "pre_window", 2000,
       [[-50, 35]], dict(flat(-50, 40, 35), valid=False, reason="low_coverage"),
       "35/40 = 0.875 < 0.90: low_coverage."),
    qc("qc-20-priority-low-coverage-over-clipped", "Low coverage is reported before clipped.", "quiet_check", 5000,
       [[-50, 20], [-3, 1, "clipped"]],
       dict(valid=False, reason="low_coverage", floor=-50, p20=-50, p80=-50, p95=-50, fc=21, ef=100, cov=0.21, cl=1),
       "21 finite frames of 100 expected: coverage 0.21 < 0.90. A clipped frame is also present; low_coverage outranks clipped."),
    qc("qc-21-prewindow-clipped", "Pre-window: a clipped frame invalidates.", "pre_window", 2000,
       [[-50, 39], [-3, 1, "clipped"]],
       dict(valid=False, reason="clipped", floor=-50, p20=-50, p80=-50, p95=-50, fc=40, ef=40, cov=1.0, cl=1),
       "40 finite frames (coverage 1) of which 1 is clipped: clipped. Statistics use the 39 non-clipped frames at -50."),
    qc("qc-22-prewindow-nonfinite-7.5pct", "Pre-window: 3 of 40 frames non-finite.", "pre_window", 2000,
       [[-50, 37], [None, 3]],
       dict(valid=False, reason="nonfinite", floor=-50, p20=-50, p80=-50, p95=-50, fc=40, ef=40, cov=0.925, nf=3),
       "37 finite + 3 non-finite: non-finite fraction 3/40 = 0.075 > 0.05: nonfinite. Coverage 37/40 = 0.925 would have passed."),
    qc("qc-23-prewindow-clipped-beats-burst", "Pre-window priority: clipped outranks burst_noise.", "pre_window", 2000,
       [[-50, 20], [-30, 19], [-1, 1, "clipped"]],
       dict(valid=False, reason="clipped", floor=-50, p20=-50, p80=-30, p95=-30, fc=40, ef=40, cov=1.0, cl=1),
       "39 non-clipped frames: sorted idx 0-19 = -50, 20-38 = -30. floor = sorted[ceil(19.5)-1 = 19] = -50, p20 = sorted[7] = -50, p80 = sorted[ceil(31.2)-1 = 31] = -30, p95 = sorted[ceil(37.05)-1 = 37] = -30: p95 - floor = 20 (a burst), but the clipped frame outranks it."),
    qc("qc-24-quiet-unstable-beats-burst", "Quiet-check priority: unstable_floor outranks burst_noise and too_loud.", "quiet_check", 5000,
       blocks(-40, -20, -20, 0, 0),
       dict(valid=False, reason="unstable_floor", floor=-20, p20=-40, p80=-20, p95=0, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -20 - (-40) = 20 > 6: unstable_floor. p95 - floor = 20 (burst) and floor -20 > -30 (too loud) also hold but rank lower."),
    qc("qc-25-quiet-burst-beats-too-loud", "Quiet-check priority: burst_noise outranks too_loud.", "quiet_check", 5000,
       blocks(-23, -20, -20, -8, -8),
       dict(valid=False, reason="burst_noise", floor=-20, p20=-23, p80=-20, p95=-8, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = 3 (stable). p95 - floor = -8 - (-20) = 12 > 10: burst_noise. floor -20 > -30 also holds but ranks lower."),
    qc("qc-26-quiet-too-loud-only", "Quiet-check: only the loudness rule fails.", "quiet_check", 5000,
       blocks(-23, -20, -20, -18, -18),
       dict(valid=False, reason="too_loud", floor=-20, p20=-23, p80=-20, p95=-18, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = 3, p95 - floor = 2, floor -20 > -30: too_loud."),
]


# --------------------------------------------------------------------------------------------
# VAD fixtures. Floor -60 dBFS, open level C = -50 (rel +10, exactly the open threshold),
# quiet Q = -58 (rel +2), continuation level M = -54 (rel +6).
# --------------------------------------------------------------------------------------------
VF = -60
C_, Q_, M_ = -50, -58, -54


def seg(onset_frame, end_frame, cand, run):
    return {
        "onset_frame": onset_frame,
        "end_frame": end_frame,
        "onset_ms": onset_frame * 50,
        "end_ms": (end_frame + 1) * 50,
        "candidate_frames": cand,
        "longest_run": run,
    }


def vad_case(id, description, runs, segments, rejected, unterminated, derivation, floor=VF):
    segs, rej, unt, _c = oracle_vad(expand(runs), floor)
    same({"segments": segments, "rejected": rejected, "unterminated": unterminated},
         {"segments": segs, "rejected": rej, "unterminated": unt}, id)
    return {
        "id": id,
        "description": description,
        "session_floor_dbfs": floor,
        "runs": runs,
        "expected": {
            "segments": segments,
            "rejected_segments": rejected,
            "last_segment_unterminated": unterminated,
        },
        "derivation": derivation,
    }


VAD_CASES = [
    vad_case("vad-01-transient-100ms", "100 ms transient (2 candidate frames) is rejected.",
             [[Q_, 10], [C_, 2], [Q_, 10]], [], 1, False,
             "Frames 10-11 are candidates (rel +10). 2 candidate frames < 4: the segment is rejected when the 6th quiet frame ends it. No accepted segments."),
    vad_case("vad-02-aligned-150ms", "A frame-aligned 150 ms burst (3 candidate frames) is rejected. Unaligned 150 ms bursts are phase dependent: see vad-phase-sweep.json.",
             [[Q_, 10], [C_, 3], [Q_, 10]], [], 1, False,
             "3 candidate frames (150 ms) < 4: rejected. (A burst that is not aligned to the 50 ms grid can touch 4 frames: A1-01.)"),
    vad_case("vad-03-accept-200ms-onset-is-opening-frame", "200 ms (4 frames) is accepted; the onset is the opening frame.",
             [[Q_, 10], [C_, 4], [Q_, 10]], [seg(10, 13, 4, 4)], 0, False,
             "Candidates are frames 10-13 (4 >= 4, run 4 >= 3). Opening frame 10 = 500 ms. End = end of frame 13 = 14*50 = 700 ms. Duration 200 ms."),
    vad_case("vad-04-gap-5-bridged", "A gap of 5 non-candidate frames (250 ms) is bridged.",
             [[C_, 4], [Q_, 5], [C_, 2], [Q_, 10]], [seg(0, 10, 6, 4)], 0, False,
             "Candidates 0-3, quiet 4-8 (5 frames, bridged: fewer than 6), candidates 9-10, then quiet. One segment, opening frame 0, last candidate frame 10, 6 candidate frames, longest run 4, end = 11*50 = 550 ms."),
    vad_case("vad-05-gap-6-ends", "A gap of 6 non-candidate frames (300 ms) ends the segment.",
             [[C_, 4], [Q_, 6], [C_, 4], [Q_, 10]], [seg(0, 3, 4, 4), seg(10, 13, 4, 4)], 0, False,
             "Candidates 0-3; the 6th quiet frame (frame 9) ends the first segment at the end of frame 3 = 200 ms. Candidates 10-13 open a second segment [500, 700] ms."),
    vad_case("vad-06-hangover-end-time", "The segment ends at its last candidate frame, not after the hangover.",
             [[Q_, 2], [C_, 4], [Q_, 30]], [seg(2, 5, 4, 4)], 0, False,
             "Candidates are frames 2-5: onset 100 ms, end = 6*50 = 300 ms. The 30 quiet frames add no duration (not 300 + 250 or + 300)."),
    vad_case("vad-07-multiple-segments-longest-run", "Three segments; longest run and sum.",
             [[C_, 4], [Q_, 8], [C_, 10], [Q_, 7], [C_, 6], [Q_, 10]],
             [seg(0, 3, 4, 4), seg(12, 21, 10, 10), seg(29, 34, 6, 6)], 0, False,
             "Seg A frames 0-3 [0,200]; 8 quiet frames (4-11) close it at the 6th. Seg B frames 12-21 [600,1100]; 7 quiet (22-28) close it at the 6th (frame 27). Seg C frames 29-34 [1450,1750]. Spans 200, 500, 300: longest 500, sum 1000."),
    vad_case("vad-08-open-at-end", "A segment still open when the stream ends is closed at its last candidate frame.",
             [[C_, 10]], [seg(0, 9, 10, 10)], 0, True,
             "10 candidate frames, no offset seen. At finish the segment ends at the end of frame 9 = 500 ms and is marked unterminated (no offset observed)."),
    vad_case("vad-09-open-threshold-exactly-plus-10", "A frame exactly +10.0 dB above the floor opens a segment (A1-03).",
             [[Q_, 5], [-50, 4], [Q_, 10]], [seg(5, 8, 4, 4)], 0, False,
             "-50 - (-60) = +10.0 >= 10: opens. 4 frames accepted: onset 250 ms, end 450 ms."),
    vad_case("vad-10-just-below-open-threshold", "A frame at +9.9 dB cannot open a segment, so nothing happens at all.",
             [[Q_, 5], [-50.1, 4], [Q_, 10]], [], 0, False,
             "-50.1 - (-60) = +9.9 < 10: never opens, so no segment is even started (rejected count 0)."),
    vad_case("vad-11-continuation-exactly-plus-6", "Once open, frames exactly +6.0 dB continue the segment.",
             [[Q_, 5], [-50, 1], [M_, 3], [Q_, 10]], [seg(5, 8, 4, 4)], 0, False,
             "Frame 5 at +10 opens. Frames 6-8 at -54 are +6.0 >= 6: continuation candidates. 4 candidate frames, run 4: accepted, onset 250 ms, end 450 ms."),
    vad_case("vad-12-continuation-just-below-plus-6", "Once open, a frame at +5.9 dB does not continue the segment.",
             [[Q_, 5], [-50, 1], [-54.1, 3], [Q_, 10]], [], 1, False,
             "Frame 5 opens (+10). Frames 6-8 at +5.9 and the quiet frames are non-candidates; the 6th non-candidate (frame 11) closes the segment with 1 candidate frame: rejected."),
    vad_case("vad-13-loud-room-never-opens", "A steady room at +6 dB for 3 s (the old candidate threshold) never produces a segment.",
             [[M_, 60]], [], 0, False,
             "Every frame is +6.0 dB: a candidate only once open, but nothing ever reaches +10 to open: no segment, rejected count 0. (Under revision 1 this whole stretch would have been one accepted segment.)"),
    vad_case("vad-14-lead-in-frames-are-not-candidates", "Frames at +6 dB before the opening frame are not part of the segment.",
             [[M_, 2], [-50, 1], [M_, 5], [Q_, 10]], [seg(2, 7, 6, 6)], 0, False,
             "Frames 0-1 at +6 cannot open. Frame 2 at +10 opens: onset 2*50 = 100 ms (not 0). Frames 3-7 at +6 continue: 6 candidate frames, run 6, end = 8*50 = 400 ms."),
    vad_case("vad-15-click-train-period-100ms", "Four isolated clicks 100 ms apart (A1-02).",
             [[Q_, 5], [C_, 1], [Q_, 1], [C_, 1], [Q_, 1], [C_, 1], [Q_, 1], [C_, 1], [Q_, 10]], [], 1, False,
             "Candidates at frames 5, 7, 9, 11: 4 candidate frames in total (the revision 1 rule would accept), but the longest run of consecutive candidates is 1 < 3: rejected."),
    vad_case("vad-16-click-pairs", "Two pairs of adjacent clicks: 4 candidates, longest run 2.",
             [[Q_, 5], [C_, 2], [Q_, 1], [C_, 2], [Q_, 10]], [], 1, False,
             "Candidates 5-6 and 8-9: 4 candidate frames, longest run 2 < 3: rejected."),
    vad_case("vad-17-run-of-3-plus-one", "A run of 3 plus one more candidate (4 in total) is accepted.",
             [[Q_, 5], [C_, 3], [Q_, 1], [C_, 1], [Q_, 10]], [seg(5, 9, 4, 3)], 0, False,
             "Candidates 5, 6, 7 and 9: 4 candidate frames, longest run 3: accepted. Onset 250 ms, end = 10*50 = 500 ms (the bridged quiet frame 8 is inside the span)."),
    vad_case("vad-18-nonfinite-inside-speech", "A single non-finite frame inside speech is a bridged gap.",
             [[C_, 2], [None, 1], [C_, 3], [Q_, 10]], [seg(0, 5, 5, 3)], 0, False,
             "Frames 0-1 candidates, frame 2 non-finite (non-candidate, gap of 1), frames 3-5 candidates. One segment frames 0-5: 5 candidate frames, longest run 3, end = 6*50 = 300 ms."),
    vad_case("vad-19-six-nonfinite-end-segment", "Six consecutive non-finite frames end the segment.",
             [[C_, 4], [None, 6], [C_, 4], [Q_, 6]], [seg(0, 3, 4, 4), seg(10, 13, 4, 4)], 0, False,
             "6 consecutive non-candidate (non-finite) frames end the first segment at 200 ms; the next 4 candidates are a second segment."),
    vad_case("vad-20-missing-2-frames-bridged", "A dropout of 2 missing frames inside speech is bridged.",
             [[C_, 4], ["gap", 2], [C_, 2], [Q_, 10]], [seg(0, 7, 6, 4)], 0, False,
             "Candidates at indices 0-3; indices 4-5 missing (non-candidates, gap of 2); candidates at indices 6-7. One segment, 6 candidate frames, longest run 4, end = 8*50 = 400 ms."),
    vad_case("vad-21-missing-6-frames-ends", "A dropout of 6 missing frames ends the segment.",
             [[C_, 4], ["gap", 6], [C_, 4], [Q_, 10]], [seg(0, 3, 4, 4), seg(10, 13, 4, 4)], 0, False,
             "Indices 4-9 are missing: 6 non-candidates end the first segment at 200 ms. Candidates at 10-13 open a second segment."),
]


# --------------------------------------------------------------------------------------------
# Window summary fixtures. Floor -60, quiet Q = -62 (rel -2), speech S = -45 (rel +15).
# --------------------------------------------------------------------------------------------
WQ, WS = -62, -45


def win(reason, duration=None):
    f = {"reason": reason}
    if duration is not None:
        f["duration_ms"] = duration
    return f


def wcase(id, description, kind, max_ms, runs, finish, hand, derivation, floor=-60):
    expected = {
        "kind": kind,
        "valid": hand["reason"] is None,
        "invalid_reason": hand["reason"],
        "frame_count": hand["fc"],
        "expected_frames": hand["ef"],
        "coverage": hand["cov"],
        "active_ms": hand["active"],
        "longest_active_ms": hand["longest"],
        "segments": hand["segs"],
        "onset_ms": hand["onset"],
        "p50_active_dbfs": hand["p50"],
        "p95_active_dbfs": hand["p95"],
        "peak_dbfs": hand["peak"],
        "clipped_frames": hand.get("cl", 0),
        "nonfinite_frames": hand.get("nf", 0),
        "duration_ms": hand["dur"],
    }
    same(expected, oracle_window(kind, max_ms, floor, runs, finish), id)
    return {
        "id": id,
        "description": description,
        "kind": kind,
        "max_duration_ms": max_ms,
        "session_floor_dbfs": floor,
        "runs": runs,
        "finish": finish,
        "expected": expected,
        "derivation": derivation,
    }


def W(**kw):
    base = dict(reason=None, fc=160, ef=160, cov=1.0, dur=8000)
    base.update(kw)
    return base


CLEAN = [[WQ, 10], [WS, 20], [WQ, 130]]
WINDOW_CASES = [
    wcase("win-01-clean-phrase", "Clean 1 s phrase.", "phrase", 8000, CLEAN, win("complete"),
          W(active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Speech frames 10-29 at -45 (rel +15 >= 10 opens). Onset 10*50 = 500 ms, end 30*50 = 1500 ms, active 1000 ms. 20 active (candidate) frames all -45: p50 = p95 = -45. Peak = -45. 160 frames = duration 8000 ms: coverage 1."),
    wcase("win-02-silence", "Silence only.", "phrase", 8000, [[WQ, 160]], win("complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=WQ),
          "No frame reaches +10, so no segment: no_voice. Statistics over accepted-active frames are null. Peak is the loudest finite frame, -62."),
    wcase("win-03-aligned-150ms-transient", "A frame-aligned 150 ms transient only.", "phrase", 8000, [[WQ, 10], [WS, 3], [WQ, 147]], win("complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=WS),
          "3 candidate frames < 4: rejected, contributes nothing: no_voice. Peak still reports -45 (whole window)."),
    wcase("win-04-phrase-350ms-is-valid", "CHANGED (A1-04): a 350 ms phrase is now valid.", "phrase", 8000,
          [[WQ, 10], [WS, 7], [WQ, 143]], win("complete"),
          W(active=350, longest=350, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Revision 1 reported no_voice because active_ms 350 < 400 applied to phrases. Revision 2: for phrase and vowel windows no_voice means no accepted segment. 7 candidate frames >= 4 with a run of 7 >= 3: accepted, active 350 ms, valid (a one-syllable phrase can now be scored)."),
    wcase("win-04b-phrase-200ms-is-valid", "A 200 ms phrase (the smallest accepted segment) is valid.", "phrase", 8000,
          [[WQ, 10], [WS, 4], [WQ, 146]], win("complete"),
          W(active=200, longest=200, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "4 candidate frames, run 4: one accepted segment of 200 ms. Phrase windows need no more (A1-04)."),
    wcase("win-04c-calibration-350ms-is-no-voice", "Calibration keeps the 400 ms minimum.", "calibration", 8000,
          [[WQ, 10], [WS, 7], [WQ, 143]], win("complete"),
          W(reason="no_voice", active=350, longest=350, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Same data as win-04. One accepted segment of 350 ms, but a calibration window needs active_ms >= 400: no_voice (the fields are still filled)."),
    wcase("win-05-calibration-400ms", "400 ms is the calibration minimum.", "calibration", 8000,
          [[WQ, 10], [WS, 8], [WQ, 142]], win("complete"),
          W(active=400, longest=400, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "8 candidate frames = 400 ms >= 400: valid for a calibration window."),
    wcase("win-06-vowel-200ms", "A vowel window needs only one accepted segment.", "vowel", 8000,
          [[WQ, 10], [WS, 4], [WQ, 146]], win("complete"),
          W(active=200, longest=200, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "4 candidate frames = one accepted segment of 200 ms: valid for a vowel window."),
    wcase("win-06b-vowel-150ms-no-voice", "A frame-aligned 150 ms burst is no_voice for a vowel window too.", "vowel", 8000,
          [[WQ, 10], [WS, 3], [WQ, 147]], win("complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=WS),
          "3 candidate frames < 4: no accepted segment, so no_voice."),
    wcase("win-07-coverage-exactly-0.90", "Coverage boundary: 144 of 160 frames.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 114]], win("complete", 8000),
          W(fc=144, active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cov=0.9),
          "Duration 8000 ms, expected_frames = 160. 144 finite frames: 144/160 = 0.90 >= 0.90: valid."),
    wcase("win-08-coverage-0.89375", "Coverage boundary: 143 of 160 frames (emitted as 0.894).", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 113]], win("complete", 8000),
          W(reason="low_coverage", fc=143, active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cov=0.894),
          "143/160 = 0.89375 < 0.90: low_coverage. The emitted coverage is rounded to 0.001: 893.75 -> 894 -> 0.894 (the verdict uses the exact counts)."),
    wcase("win-08b-coverage-rounds-up-but-rule-is-exact", "539 of 599 expected frames: coverage 0.89983 is emitted as 0.900 but the rule uses the exact counts.", "vowel", 30000,
          [[WQ, 10], [WS, 20], [WQ, 509]], win("early_stop", 29950),
          W(reason="low_coverage", fc=539, ef=599, dur=29950, cov=0.9, active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "A vowel window stopped early at 29950 ms: expected_frames = floor(29950/50) = 599. 539 frames received, all finite: 539/599 = 0.899833 < 0.90: low_coverage, although the emitted coverage rounds to 0.900 (x1000 = 899.83 -> 900). The payload carries the exact counts (frame_count - nonfinite_frames over expected_frames), so a receiver reaches the same verdict. One accepted segment of 1000 ms at -45."),
    wcase("win-09-clipped-2pct-valid", "1 clipped frame in 50 active frames (2.0 %) is valid.", "phrase", 8000,
          [[WQ, 10], [WS, 10], [WS, 1, "clipped"], [WS, 39], [WQ, 100]], win("complete"),
          W(active=2500, longest=2500, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cl=1),
          "Active frames 10-59 = 50 candidate frames. 1 clipped / 50 = 2.0 %, not > 2 %: valid. clipped_frames = 1."),
    wcase("win-10-clipped-4pct-invalid", "2 clipped frames in 50 active frames (4.0 %) are invalid.", "phrase", 8000,
          [[WQ, 10], [WS, 10], [WS, 2, "clipped"], [WS, 38], [WQ, 100]], win("complete"),
          W(reason="clipped", active=2500, longest=2500, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cl=2),
          "2 / 50 = 4.0 % > 2 %: clipped."),
    wcase("win-10b-clipped-fraction-excludes-bridged-gap", "CHANGED (A1-07): the clipped fraction uses candidate frames only.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 5], [WS, 10], [WS, 1, "clipped"], [WS, 18], [WQ, 96]], win("complete"),
          W(reason="clipped", active=2700, longest=2700, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cl=1),
          "Frames 10-29 candidates, 30-34 five bridged quiet frames, 35-63 candidates (frame 45 clipped), then silence. Span = frames 10-63 = 54 frames = 2700 ms (the gap counts in active_ms). Candidate frames = 20 + 29 = 49; 1/49 = 2.04 % > 2 %: clipped. Counting the 5 bridged frames (revision 1) gave 1/54 = 1.85 %, valid."),
    wcase("win-11-nonfinite-5pct-valid", "8 of 160 frames non-finite (5.0 %) is valid.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 90], [None, 8], [WQ, 32]], win("complete"),
          W(active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, nf=8, cov=0.95),
          "Coverage 152/160 = 0.95 >= 0.90. Non-finite 8/160 = 0.05, not > 0.05: valid."),
    wcase("win-12-nonfinite-5.6pct-invalid", "9 of 160 frames non-finite (5.625 %) is invalid.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 90], [None, 9], [WQ, 31]], win("complete"),
          W(reason="nonfinite", active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, nf=9, cov=0.944),
          "Coverage 151/160 = 0.94375 (emitted 0.944) passes; non-finite 9/160 = 0.05625 > 0.05: nonfinite."),
    wcase("win-13-continuous-phrase", "Speech for the whole phrase window is continuous_sound.", "phrase", 8000,
          [[WS, 160]], win("complete"),
          W(reason="continuous_sound", active=8000, longest=8000, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "One segment open from frame 0 to the end (no offset). active_ms 8000 / 8000 = 1.00 > 0.95: continuous_sound."),
    wcase("win-14-continuous-ok-for-calibration", "The same signal is valid for a calibration window.", "calibration", 8000,
          [[WS, 160]], win("complete"),
          W(active=8000, longest=8000, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "continuous_sound applies to phrase windows only."),
    wcase("win-15-continuous-exactly-95pct", "Exactly 95.0 % with no offset is valid.", "phrase", 2000,
          [[WS, 38], [WQ, 2]], win("complete"),
          W(fc=40, ef=40, dur=2000, active=1900, longest=1900, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "Window 2000 ms = 40 frames. 38 speech frames = 1900 ms; 1900/2000 = 0.95, not > 0.95: valid."),
    wcase("win-16-continuous-97.5pct", "97.5 % with no offset is continuous_sound.", "phrase", 2000,
          [[WS, 39], [WQ, 1]], win("complete"),
          W(reason="continuous_sound", fc=40, ef=40, dur=2000, active=1950, longest=1950, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "39 speech frames = 1950 ms; 1950/2000 = 0.975 > 0.95 and only 1 quiet frame follows (no 6-frame offset): continuous_sound."),
    wcase("win-17-long-activity-with-offset", "Over 95 % active, but the offset (6 quiet frames) was observed.", "phrase", 8000,
          [[WS, 153], [WQ, 7]], win("complete"),
          W(active=7650, longest=7650, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "153 speech frames = 7650 ms (95.6 %), but the 6th quiet frame closed the segment (a real offset), so continuous_sound does not apply: valid."),
    wcase("win-18-interrupted", "Interrupted capture is invalid whatever the data.", "phrase", 8000, CLEAN, win("interrupted"),
          W(reason="interrupted", active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Same data as win-01 but the capture was interrupted: invalid_reason interrupted."),
    wcase("win-19-bridged-gap-frames-are-excluded-from-percentiles", "CHANGED (A1-07): bridged non-candidate frames are not accepted-active frames.", "phrase", 8000,
          [[WQ, 5], [WS, 4], [-61, 5], [-40, 6], [WQ, 20]], win("complete"),
          W(fc=40, ef=40, dur=2000, active=750, longest=750, segs=1, onset=250, p50=-40, p95=-40, peak=-40),
          "Frames 5-8 at -45 (open), frames 9-13 at -61 (rel -1: 5 bridged non-candidate frames), frames 14-19 at -40 (rel +20, continuation), then quiet. active_ms still spans the gap: onset 250 ms, end 20*50 = 1000 ms, 750 ms. Accepted-active frames are the 10 candidate frames: 4 x -45 and 6 x -40. Sorted: -45 x4, -40 x6: p50 = sorted[ceil(5)-1 = 4] = -40, p95 = sorted[ceil(9.5)-1 = 9] = -40. (Revision 1 included the 5 gap frames at -61, giving p50 = -45.) Duration = 40 frames = 2000 ms."),
    wcase("win-20-quantisation-to-0.1-dB", "Emitted dB values are rounded to 0.1 dB (PK-06).", "phrase", 8000,
          [[WQ, 10], [-45.26, 20], [WQ, 130]], win("complete"),
          W(active=1000, longest=1000, segs=1, onset=500, p50=-45.3, p95=-45.3, peak=-45.3),
          "20 speech frames at -45.26 (rel +14.74, opens). p50 = p95 = -45.26 -> x10 = -452.6 -> round -453 -> -45.3. Peak (frame peak equals its RMS) -> -45.3."),
    wcase("win-21-loud-room-is-no-voice", "A noisy room at +7 dB (below the open threshold) is no_voice.", "phrase", 8000,
          [[-53, 160]], win("complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=-53),
          "-53 - (-60) = +7 dB: above the old 6 dB candidate threshold (revision 1 would have scored this as continuous speech) but below the 10 dB open threshold: no segment, no_voice."),
    wcase("win-22-emitted-p95-rounds-onto-the-band-edge", "A raw p95 of rel +11.96 dB is emitted as +12.0 dB.", "phrase", 8000,
          [[WQ, 10], [-48.04, 30], [WQ, 120]], win("complete"),
          W(active=1500, longest=1500, segs=1, onset=500, p50=-48, p95=-48, peak=-48),
          "30 speech frames at -48.04 (rel +11.96, opens). p95 = -48.04 -> x10 = -480.4 -> round -480 -> -48.0, i.e. +12.0 dB above the -60 floor. With a calibration margin of 13 (band edge 12) the TV verdict on the emitted numbers is reached; the raw value would have been 0.04 dB under the edge. Quantisation moves a verdict by at most 0.05 dB at the edge."),
]


# --------------------------------------------------------------------------------------------
# 20 "soft window" fixtures: valid phrase windows whose accepted-active p95 is below the band edge.
# --------------------------------------------------------------------------------------------
def soft(id, description, floor, margin, runs, hand, rel_p95, borderline, derivation):
    edge = margin - 1
    assert rel_p95 < edge, f"{id}: designed rel p95 {rel_p95} must be below the band edge {edge}"
    assert (abs(rel_p95 - edge) < 1 - 1e-9) == borderline, f"{id}: borderline flag does not match |{rel_p95} - {edge}| < 1"
    expected = {
        "kind": "phrase",
        "valid": True,
        "invalid_reason": None,
        "frame_count": hand["fc"],
        "expected_frames": 160,
        "coverage": hand["cov"],
        "active_ms": hand["active"],
        "longest_active_ms": hand["longest"],
        "segments": hand["segs"],
        "onset_ms": hand["onset"],
        "p50_active_dbfs": hand["p50"],
        "p95_active_dbfs": hand["p95"],
        "peak_dbfs": hand["peak"],
        "clipped_frames": 0,
        "nonfinite_frames": 0,
        "duration_ms": 8000,
    }
    same(expected, oracle_window("phrase", 8000, floor, runs, {"reason": "complete"}), id)
    assert abs((hand["p95"] - floor) - rel_p95) < 1e-9, f"{id}: p95 {hand['p95']} - floor {floor} != {rel_p95}"
    return {
        "id": id,
        "description": description,
        "kind": "phrase",
        "max_duration_ms": 8000,
        "session_floor_dbfs": floor,
        "cal_margin_db": margin,
        "band_edge_rel_db": edge,
        "runs": runs,
        "finish": {"reason": "complete"},
        "expected_window": expected,
        "expected_window_rel_p95_db": rel_p95,
        "expected_verdict": "not_reached",
        "expected_borderline": borderline,
        "derivation": derivation,
    }


def H(**kw):
    base = dict(fc=160, cov=1.0, longest=None, segs=1)
    base.update(kw)
    if base["longest"] is None:
        base["longest"] = base["active"]
    return base


SOFT_CASES = [
    soft("soft-01-uniform-just-opening", "Uniform soft speech exactly 10 dB above the floor (the open threshold); calibration margin 13 dB.", -60, 13,
         [[-60, 20], [-50, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-50, p95=-50, peak=-50), 10, False,
         "CHANGED from revision 1 (+8 dB uniform): speech that never reaches +10 dB can no longer open a segment and would be no_voice (unscored), not a soft scored window. Floor -60, cal_margin 13, band edge = 12 dB above the floor. 30 speech frames 20-49 at -50 (rel +10.0 opens): 30 candidate frames, onset 20*50 = 1000 ms, active 1500 ms, p50 = p95 = -50. window_rel_p95 = -50 - (-60) = 10 < 12: not_reached. |10 - 12| = 2: not borderline."),
    soft("soft-02-11.5dB-borderline", "Soft speech 0.5 dB under the band edge.", -60, 13,
         [[-60, 20], [-48.5, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.5, p95=-48.5, peak=-48.5), 11.5, True,
         "Edge 12. 30 speech frames at -48.5 (rel +11.5, opens). p95 = -48.5, rel 11.5 < 12: not_reached. |11.5 - 12| = 0.5 < 1: borderline. Unchanged from revision 1."),
    soft("soft-03-11.1dB-borderline", "Soft speech 0.9 dB under the band edge.", -60, 13,
         [[-60, 20], [-48.9, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.9, p95=-48.9, peak=-48.9), 11.1, True,
         "CHANGED from -48.99 (+11.01): emitted values are multiples of 0.1, so -48.99 would be emitted as -49.0 (+11.0, exactly 1.0 under the edge: not borderline). Edge 12; -48.9 is rel +11.1 < 12: not_reached. |11.1 - 12| = 0.9 < 1: borderline."),
    soft("soft-04-11.9dB-borderline", "Soft speech 0.1 dB under the band edge (the closest value on the 0.1 dB grid).", -60, 13,
         [[-60, 20], [-48.1, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.1, p95=-48.1, peak=-48.1), 11.9, True,
         "CHANGED from -48.01 (+11.99): -48.01 would be emitted as -48.0, i.e. exactly the band edge, which is reached. Edge 12; -48.1 is rel +11.9 < 12: not_reached by 0.1 dB. |11.9 - 12| = 0.1 < 1: borderline."),
    soft("soft-05-loud-opening-frame-soft-body", "A single opening frame at +10 dB followed by softer speech at +9 dB; floor -55, margin 15.", -55, 15,
         [[-55, 15], [-45, 1], [-46, 39], [-55, 105]],
         H(active=2000, onset=750, p50=-46, p95=-46, peak=-45), 9, False,
         "CHANGED (hysteresis): the first frame is +10 dB and opens the segment; frames at +9 dB then continue it (>= 6). Edge 14. Frames 15-54 = 40 candidate frames: 39 x -46 and 1 x -45; onset 750 ms, active 2000 ms. Sorted: -46 x39, -45 x1: p50 = sorted[ceil(20)-1 = 19] = -46, p95 = sorted[ceil(38)-1 = 37] = -46 (the loud opening frame is the largest). rel p95 9 < 14: not_reached. |9 - 14| = 5: not borderline. Peak -45."),
    soft("soft-06-exactly-1dB-under-edge", "p95 exactly 1.00 dB under the edge is not borderline (borderline needs < 1).", -70, 16,
         [[-70, 10], [-60, 1], [-63, 19], [-61, 20], [-56, 4], [-70, 106]],
         H(active=2200, onset=500, p50=-61, p95=-56, peak=-56), 14, False,
         "CHANGED (hysteresis): an opening frame at -60 (+10) precedes the +7 dB frames. Floor -70, margin 16, edge 15. Candidate frames 10-53 (44): 19 x -63 (rel +7, continuation), 20 x -61 (+9), 1 x -60 (+10), 4 x -56 (+14). Sorted: idx 0-18 = -63, 19-38 = -61, 39 = -60, 40-43 = -56. p50 = sorted[ceil(22)-1 = 21] = -61. p95 = sorted[ceil(41.8)-1 = 41] = -56. rel p95 = 14 < 15: not_reached. |14 - 15| = 1.00 is not < 1: not borderline. active_ms = 44*50 = 2200, onset 500."),
    soft("soft-07-loud-spike-below-5pct", "A 5 % spike does not move p95: the 4 loudest of 80 active frames are skipped.", -65, 18,
         [[-65, 15], [-55, 76], [-43, 4], [-65, 65]],
         H(active=4000, onset=750, p50=-55, p95=-55, peak=-43), 10, False,
         "Floor -65, margin 18, edge 17. Candidate frames 15-94 (80): 76 x -55 (rel +10, opens), then 4 x -43 (rel +22). p95 = sorted[ceil(76)-1 = 75] = -55 (idx 76-79 are the spike). p50 = sorted[ceil(40)-1 = 39] = -55. rel p95 10 < 17: not_reached. Peak = -43 (whole window). Unchanged from revision 1."),
    soft("soft-08-two-words", "Two words separated by a 400 ms silence (two segments).", -48, 20,
         [[-48, 10], [-34, 12], [-48, 8], [-33, 14], [-48, 116]],
         H(active=1300, longest=700, onset=500, segs=2, p50=-33, p95=-33, peak=-33), 15, False,
         "Floor -48, margin 20, edge 19. Word A frames 10-21 at -34 [500, 1100] ms; 8 quiet frames 22-29 (the 6th, frame 27, ends it); word B frames 30-43 at -33 [1500, 2200]. active_ms 600 + 700 = 1300, longest 700, 2 segments. Candidate frames: 12 x -34, 14 x -33 (n = 26): p50 = sorted[ceil(13)-1 = 12] = -33, p95 = sorted[ceil(24.7)-1 = 24] = -33. rel p95 15 < 19: not_reached. Unchanged from revision 1."),
    soft("soft-09-long-utterance-floor-40", "Long soft utterance in a noisier room (floor -40).", -40, 25,
         [[-40, 20], [-20, 100], [-40, 40]],
         H(active=5000, onset=1000, p50=-20, p95=-20, peak=-20), 20, False,
         "Floor -40, margin 25, edge 24. 100 speech frames 20-119 at -20 (rel +20): 5000 ms = 62.5 % of 8000, with an offset (40 quiet frames): not continuous. rel p95 20 < 24: not_reached. Unchanged."),
    soft("soft-10-bridged-word-gaps", "Word gaps of 4 and 3 frames are bridged: they count in active_ms but not in the percentiles.", -62.5, 14.5,
         [[-62.5, 10], [-52.5, 10], [-61.5, 4], [-52.5, 10], [-62.5, 3], [-52.5, 8], [-62.5, 115]],
         H(active=1750, onset=500, p50=-52.5, p95=-52.5, peak=-52.5), 10, False,
         "CHANGED derivation (A1-07): speech frames 10-19, gap 20-23 (4 frames at rel +1, bridged), speech 24-33, gap 34-36 (3 frames at rel 0, bridged), speech 37-44. One segment, frames 10-44 (35 frame span), onset 500 ms, end 45*50 = 2250: active_ms 1750 (the gaps are inside the span). Accepted-active frames are the 28 candidate frames, all -52.5 (rel +10.0): p50 = p95 = -52.5. (Revision 1 included the 7 gap frames, which only changed p50 on other data.) Floor -62.5, margin 14.5, edge 13.5: rel p95 10 < 13.5: not_reached."),
    soft("soft-11-exactly-plus-10-opens", "Speech exactly 10 dB above the floor opens the segment.", -58, 13,
         [[-58, 10], [-48, 20], [-58, 130]],
         H(active=1000, onset=500, p50=-48, p95=-48, peak=-48), 10, False,
         "CHANGED from the exact +6.00 dB case (below the open threshold now): floor -58, edge 12. Frames at -48 are +10.0: they open the segment. 20 frames 10-29 = 1000 ms. p95 = -48, rel 10 < 12: not_reached."),
    soft("soft-12-long-soft-6s", "Long soft utterance (6 s).", -66, 17,
         [[-66, 10], [-54, 120], [-66, 30]],
         H(active=6000, onset=500, p50=-54, p95=-54, peak=-54), 12, False,
         "Floor -66, margin 17, edge 16. 120 frames 10-129 at -54 (rel +12): 6000 ms = 75 % of 8000, offset observed (30 quiet frames). rel p95 12 < 16: not_reached. Unchanged."),
    soft("soft-13-rising-ramp", "Speech that rises in 0.2 dB steps from the open threshold and never reaches the edge.", -60, 13,
         [[-60, 10], [-50, 20], [-49.8, 20], [-49.6, 20], [-49.4, 20], [-49.2, 20], [-60, 50]],
         H(active=5000, onset=500, p50=-49.6, p95=-49.2, peak=-49.2), 10.8, False,
         "CHANGED (hysteresis): the revision 1 ramp started at +6 dB and could not open. Floor -60, edge 12. 100 candidate frames 10-109 in groups of 20 at rel +10.0, +10.2, +10.4, +10.6, +10.8 (-50 ... -49.2). p50 = sorted[ceil(50)-1 = 49] = third group = -49.6. p95 = sorted[ceil(95)-1 = 94] = fifth group = -49.2. rel p95 10.8 < 12: not_reached. |10.8 - 12| = 1.2: not borderline."),
    soft("soft-14-decaying-speech", "Speech that decays (loudest first) down to exactly the +6 dB continuation threshold.", -54, 21,
         [[-54, 10], [-42, 10], [-44, 10], [-46, 10], [-48, 10], [-54, 110]],
         H(active=2000, onset=500, p50=-46, p95=-42, peak=-42), 12, False,
         "Floor -54, margin 21, edge 20. 40 candidate frames 10-49 in groups of 10 at -42 (rel +12, opens), -44 (+10), -46 (+8), -48 (+6.0 exactly: continuation). Sorted ascending: -48 x10, -46 x10, -44 x10, -42 x10. p50 = sorted[ceil(20)-1 = 19] = -46. p95 = sorted[ceil(38)-1 = 37] = -42. rel p95 12 < 20: not_reached."),
    soft("soft-15-rejected-loud-transient", "A loud 150 ms transient (rejected) cannot lift a soft window.", -60, 14,
         [[-60, 10], [-49, 40], [-60, 30], [-30, 3], [-60, 77]],
         H(active=2000, onset=500, p50=-49, p95=-49, peak=-30), 11, False,
         "CHANGED level (was +9 dB, now below the open threshold): floor -60, margin 14, edge 13. Soft speech frames 10-49 at -49 (rel +11): 2000 ms accepted. Frames 80-82 at -30 (rel +30) are a frame-aligned 150 ms transient: 3 candidate frames < 4, rejected, contributes nothing to active_ms or the percentiles. p95 = -49, rel 11 < 13: not_reached. |11 - 13| = 2: not borderline. Peak = -30 (whole window)."),
    soft("soft-16-dropout-inside-speech", "A 3-frame dropout inside speech lowers coverage but the window stays valid.", -45, 13,
         [[-45, 10], [-35, 20], ["gap", 3], [-35, 20], [-45, 107]],
         H(fc=157, cov=0.981, active=2150, onset=500, p50=-35, p95=-35, peak=-35), 10, False,
         "CHANGED level (was +9 dB): floor -45, edge 12. Indices 0-9 quiet, 10-29 speech at -35 (rel +10, opens), 30-32 missing (dropout), 33-52 speech, 53-159 quiet. 157 frames received of 160 expected: coverage 157/160 = 0.98125, emitted 0.981, >= 0.90. The 3 missing frames count as non-candidates (gap 3, bridged): one segment, indices 10-52 = 43 frames, active 2150 ms; the 40 present candidate frames at -35 give p50 = p95 = -35. rel 10 < 12: not_reached."),
    soft("soft-17-quiet-room-floor-72", "Very quiet room (floor -72), speech 16 dB above floor, margin 19.", -72, 19,
         [[-72, 10], [-56, 30], [-72, 120]],
         H(active=1500, onset=500, p50=-56, p95=-56, peak=-56), 16, False,
         "Floor -72, margin 19, edge 18. 30 speech frames at -56 (rel +16): p95 -56, rel 16 < 18: not_reached. |16 - 18| = 2: not borderline. Unchanged."),
    soft("soft-18-fractional-margin", "Fractional floor and margin: rel 12.4 against an edge of 12.5.", -52.5, 13.5,
         [[-52.5, 10], [-40.1, 30], [-52.5, 120]],
         H(active=1500, onset=500, p50=-40.1, p95=-40.1, peak=-40.1), 12.4, True,
         "CHANGED from -40.01 (which would be emitted as -40.0, exactly the edge, reached). Floor -52.5, margin 13.5, edge 12.5. 30 frames at -40.1: rel = -40.1 - (-52.5) = 12.4 < 12.5: not_reached. |12.4 - 12.5| = 0.1 < 1: borderline."),
    soft("soft-19-margin-22", "High calibration margin, speech half a dB under the edge.", -60, 22,
         [[-60, 10], [-39.5, 40], [-60, 110]],
         H(active=2000, onset=500, p50=-39.5, p95=-39.5, peak=-39.5), 20.5, True,
         "Floor -60, margin 22, edge 21. 40 frames at -39.5 (rel +20.5) < 21: not_reached. |20.5 - 21| = 0.5 < 1: borderline. Unchanged."),
    soft("soft-20-gap-5-bridged", "A 5-frame word gap is bridged; the gap frames count in active_ms only.", -58, 13,
         [[-58, 10], [-48, 8], [-55, 5], [-48, 8], [-58, 129]],
         H(active=1050, onset=500, p50=-48, p95=-48, peak=-48), 10, False,
         "CHANGED (level now +10 dB so that it opens; gap frames excluded from the percentiles): floor -58, edge 12. Speech frames 10-17 at -48 (rel +10), gap frames 18-22 at -55 (rel +3, 5 frames: bridged), speech 23-30. One segment frames 10-30 (21-frame span): onset 500, end 31*50 = 1550, active 1050 ms. Candidate frames: 16 x -48: p50 = p95 = -48. rel 10 < 12: not_reached."),
]
assert len(SOFT_CASES) == 20, len(SOFT_CASES)


# --------------------------------------------------------------------------------------------
# Sample-level fixtures: phase sweep (A1-01) and click trains (A1-02)
# --------------------------------------------------------------------------------------------
SR = 48000
FS = 2400  # samples per 50 ms frame
BG = 10 ** (-60 / 20)  # 0.001: background amplitude, floor -60 dBFS
SWEEP_WINDOW = 96000  # 2 s = 40 frames
SWEEP_BASE = 24000  # the burst starts 0.5 s into the window, plus the sub-frame offset
OFFSETS = [k * 60 for k in range(40)]  # 40 offsets across one frame
LEVELS = [10, 20]
DURATIONS = [100, 125, 150, 175, 200, 250]


def sweep_accepted(level_db, duration_ms, offset):
    amp = BG * 10 ** (level_db / 20)
    events = [(SWEEP_BASE + offset, duration_ms * 48, amp)]
    dbs = frame_db_from_events(SWEEP_WINDOW, FS, BG, events)
    frames = [{"index": i, "finite": True, "db": d, "clipped": False} for i, d in enumerate(dbs)]
    segs, _r, _u, _c = oracle_vad(frames, -60)
    return len(segs) > 0


recorded = {}
for lv in LEVELS:
    recorded[str(lv)] = {}
    for d in DURATIONS:
        acc = [o for o in OFFSETS if sweep_accepted(lv, d, o)]
        recorded[str(lv)][str(d)] = {"accepted_offsets": acc, "accepted": len(acc), "of": len(OFFSETS)}

# Hard ends, asserted: each has a hand derivation (see DERIVATIONS) and is verified against the oracle here.
ASSERTED = [
    {"level_db": lv, "duration_ms": d, "accepted": "none",
     "derivation": "A burst of at most 100 ms touches at most 3 of the 50 ms frames (ceil(100/50) + 1 = 3), so it has at most 3 candidate frames < 4: never accepted at any phase."}
    for lv in LEVELS for d in (100,)
] + [
    {"level_db": 20, "duration_ms": 200, "accepted": "all",
     "derivation": "At +20 dB a 200 ms burst has 3 whole frames (rel exactly +20, the first opens the segment) plus two partial frames of fractions f and 1 - f. If the leading partial has f >= 0.0909 (1 + 99f >= 10) it opens and is a candidate: 4 candidates in a run of 4. Otherwise the trailing partial has 1 - f > 0.909 and (1 + 99(1 - f) >= 3.98) is a continuation candidate: 3 whole + 1 = 4 candidates in a run of 4. Always accepted."},
] + [
    {"level_db": lv, "duration_ms": 250, "accepted": "all",
     "derivation": "A 250 ms burst contains at least 4 whole 50 ms frames at any phase (250 = 5 frame widths, at most one partial frame at each end), each rel +level >= +10: the first opens the segment, so >= 4 consecutive candidates: always accepted."}
    for lv in LEVELS
]
for a in ASSERTED:
    acc = recorded[str(a["level_db"])][str(a["duration_ms"])]["accepted"]
    want = len(OFFSETS) if a["accepted"] == "all" else 0
    assert acc == want, f"asserted hard end {a['level_db']} dB {a['duration_ms']} ms: accepted {acc} of {len(OFFSETS)}, wanted {want}"

# Hand-derived rates for the phase-dependent cases (verified against the oracle above).
HAND_RATES = {
    ("10", "150"): (0, "At +10 dB the leading partial frame (rel < +10 unless whole) cannot open the segment, so the candidates are the 2 whole frames plus at most the trailing partial: at most 3 < 4 at every phase (a frame-aligned burst has exactly 3 whole frames)."),
    ("20", "150"): (35, "At +20 dB: offsets k = 0 and 1 (0 and 60 samples) leave the trailing partial below +6 dB (f = 0.025: 1 + 99f = 3.5 < 3.98), giving 3 candidates; offsets k = 37..39 (2220, 2280, 2340 samples) leave the leading partial below the +10 dB open level (f <= 0.075: 1 + 99f < 10), giving 3 candidates; the other 35 offsets give 4 candidates in a run of 4."),
    ("10", "200"): (27, "At +10 dB the leading partial can never open the segment, so a 200 ms burst is accepted only if the trailing partial (fraction off/2400) is a +6 dB continuation: 1 + 9f >= 3.98 needs f >= 0.3312, i.e. offset >= 795 samples. Offset 0 is frame aligned (4 whole frames). Rejected offsets: 60..780 (13 offsets); accepted 1 + 26 = 27 of 40. THIS CONTRADICTS 'a 200 ms burst is always accepted' at +10 dB."),
    ("20", "200"): (40, "See the asserted derivation: always accepted at +20 dB."),
}
for (lv, d), (want, _why) in HAND_RATES.items():
    got = recorded[lv][d]["accepted"]
    assert got == want, f"hand rate {lv} dB {d} ms: hand {want}, oracle {got}"

PHASE_SWEEP = {
    "note": "Sample-level sweep. Closed-form signal model: every sample is +-amplitude (alternating sign), so a frame's power is exactly the sample-weighted mean of amplitude squared and its level is 10*log10 of that. A burst REPLACES the background; a whole frame inside a +L dB burst is exactly floor + L dB. Frame length 2400 samples at 48 kHz, 2 s window (40 frames), session floor -60 dBFS (background amplitude 0.001), burst start = 24000 + offset samples, 40 offsets 0, 60, ... 2340 (every 1.25 ms across one frame).",
    "sample_rate": SR,
    "frame_samples": FS,
    "window_samples": SWEEP_WINDOW,
    "floor_dbfs": -60,
    "background_amplitude": BG,
    "burst_start_base_sample": SWEEP_BASE,
    "offsets_samples": OFFSETS,
    "levels_db": LEVELS,
    "durations_ms": DURATIONS,
    "asserted_hard_ends": ASSERTED,
    "recorded": recorded,
    "hand_derived_rates": [
        {"level_db": int(lv), "duration_ms": int(d), "accepted": want, "of": len(OFFSETS), "derivation": why}
        for (lv, d), (want, why) in HAND_RATES.items()
    ],
    "recorded_rates_note": "Rates between the hard ends are RECORDED, not asserted as requirements (A1-01). The TypeScript test checks that the shipped implementation reproduces the recorded accepted offsets exactly (implementation agreement with the oracle).",
    "known_deviation_from_amendment": {
        "amendment": "AMENDMENTS-REV2 A1-01: 'bursts <= 100 ms never produce an accepted segment; >= 200 ms always do'.",
        "finding": "With the A1-03 open threshold of +10 dB the 'always' end only holds from +20 dB (200 ms) or from 250 ms (any level >= +10 dB). A 200 ms burst at +10 dB is accepted at 27 of 40 phases (it is rejected when the leading partial frame, which cannot open the segment, takes most of the burst).",
        "recorded": {"level_db": 10, "duration_ms": 200, "accepted": recorded["10"]["200"]["accepted"], "of": len(OFFSETS)},
    },
}


def click_train(period_frames, n_clicks, click_len=24, amp=0.5, lead_frames=10, tail_frames=10):
    """Clicks of click_len samples at amplitude amp, one per period, in the middle of a frame."""
    total_frames = lead_frames + (n_clicks - 1) * period_frames + 1 + tail_frames
    events = []
    for k in range(n_clicks):
        frame = lead_frames + k * period_frames
        start = frame * FS + FS // 2 - click_len // 2
        events.append([start, click_len, amp])
    return total_frames, events


def click_case(id, description, total_frames, events, expect_segments, rejected, derivation):
    dbs = frame_db_from_events(total_frames * FS, FS, BG, [tuple(e) for e in events])
    frames = [{"index": i, "finite": True, "db": d, "clipped": False} for i, d in enumerate(dbs)]
    segs, rej, unt, _c = oracle_vad(frames, -60)
    same({"segments": expect_segments, "rejected": rejected}, {"segments": segs, "rejected": rej}, id)
    return {
        "id": id,
        "description": description,
        "sample_rate": SR,
        "frame_samples": FS,
        "total_samples": total_frames * FS,
        "floor_dbfs": -60,
        "background_amplitude": BG,
        "events": events,
        "expected": {"segments": expect_segments, "rejected_segments": rejected},
        "derivation": derivation,
    }


CLICK_RULE = (
    "A click is 24 samples (0.5 ms) of amplitude 0.5 in the middle of a 2400-sample frame: frame power = "
    "(24 * 0.25 + 2376 * 1e-6) / 2400 = 0.002501 -> -26.02 dBFS, i.e. about +33.98 dB over the -60 dBFS floor: a candidate "
    "(and an opening frame). All other frames are background (rel 0)."
)
CLICK_CASES = []
for period, ms in [(2, 100), (3, 150), (4, 200), (5, 250), (6, 300)]:
    for n in (4, 8, 20):
        total, ev = click_train(period, n)
        CLICK_CASES.append(click_case(
            f"click-period-{ms}ms-x{n}", f"{n} isolated clicks {ms} ms apart.", total, ev, [], 1,
            CLICK_RULE + f" Clicks every {period} frames leave {period - 1} quiet frame(s) between clicks: fewer than 6, so all {n} clicks are bridged into ONE segment with {n} candidate frames but a longest run of 1 < 3: rejected (rejected count 1)."))
total, ev = click_train(7, 6)
CLICK_CASES.append(click_case(
    "click-period-350ms-x6", "6 clicks 350 ms apart.", total, ev, [], 6,
    CLICK_RULE + " 6 quiet frames separate the clicks, which ends each segment at the 6th: 6 separate segments with 1 candidate frame each: all rejected (rejected count 6)."))


def multi_click_case(id, description, frames_per_burst, gap_frames, bursts, expect_segments, rejected, derivation):
    events = []
    frame = 10
    for _ in range(bursts):
        for j in range(frames_per_burst):
            start = (frame + j) * FS + FS // 2 - 12
            events.append([start, 24, 0.5])
        frame += frames_per_burst + gap_frames
    total = frame + 10
    return click_case(id, description, total, events, expect_segments, rejected, derivation)


CLICK_CASES.append(multi_click_case(
    "click-pairs-x4", "4 pairs of clicks in adjacent frames, 1 quiet frame between pairs.", 2, 1, 4, [], 1,
    CLICK_RULE + " Pairs: candidate frames 10-11, 13-14, 16-17, 19-20: 8 candidate frames, longest run 2 < 3: rejected."))
CLICK_CASES.append(multi_click_case(
    "click-run-of-3-positive-control", "Positive control: clicks in 3 adjacent frames then 1 quiet frame, twice.", 3, 1, 2,
    [
        {"onset_frame": 10, "end_frame": 16, "onset_ms": 500, "end_ms": 850, "candidate_frames": 6, "longest_run": 3},
    ], 0,
    CLICK_RULE + " Frames 10-12 and 14-16 are clicks, frame 13 is quiet (bridged): 6 candidate frames with a longest run of 3: ACCEPTED. One segment, onset 10*50 = 500 ms, end 17*50 = 850 ms."))
CLICK_CASES.append(multi_click_case(
    "click-4-adjacent-frames-positive-control", "Positive control: a click in each of 4 adjacent frames.", 4, 1, 1,
    [
        {"onset_frame": 10, "end_frame": 13, "onset_ms": 500, "end_ms": 700, "candidate_frames": 4, "longest_run": 4},
    ], 0,
    CLICK_RULE + " Frames 10-13: 4 candidate frames, run 4: accepted (a click in every frame is indistinguishable from a continuous sound by level alone)."))

CLICK_TRAIN = {
    "note": "Sample-level click trains (A1-02). Same closed-form signal model as vad-phase-sweep.json.",
    "cases": CLICK_CASES,
}


# --------------------------------------------------------------------------------------------
# AR(1) noise at the edge of quiet-check validity (A1-03)
# --------------------------------------------------------------------------------------------
AR_TRIALS = 10000
AR_MODELS = [
    ("ar1-sigma2.0-rho0.9", 2.0, 0.9, 20261021),
    ("ar1-sigma2.5-rho0.5", 2.5, 0.5, 20261022),
    ("ar1-sigma2.5-rho0.8", 2.5, 0.8, 20261023),
    ("ar1-sigma3.0-rho0.8", 3.0, 0.8, 20261024),
    ("ar1-sigma3.5-rho0.5", 3.5, 0.5, 20261025),
    ("ar1-sigma3.5-rho0.9", 3.5, 0.9, 20261026),
]
AR_MAX_P = 0.01
ar_models = []
for mid, sigma, rho, seed in AR_MODELS:
    attempts, active = ar1_silent_window_study(sigma, rho, seed, AR_TRIALS)
    p = active / AR_TRIALS
    ar_models.append({
        "id": mid,
        "sigma_db": sigma,
        "rho": rho,
        "seed": seed,
        "valid_trials": AR_TRIALS,
        "attempts": attempts,
        "p_quiet_check_valid": round(AR_TRIALS / attempts, 4),
        "active_trials": active,
        "p_active": p,
        "meets_target": p <= AR_MAX_P,
    })
    print(f"  {mid}: attempts {attempts}, active {active} ({p:.4f}) meets 1% target: {p <= AR_MAX_P}", flush=True)

AR_NOISE = {
    "note": "Seeded AR(1) noise in dB, silent 8 s phrase window. SYNTHETIC model, not measured room noise.",
    "model": "Per-frame level (dBFS) = -70 + sigma * z, where z is AR(1) with correlation rho: z0 = gauss(); z = rho * z + sqrt(1 - rho^2) * gauss(). gauss() = sqrt(-2 ln u) * cos(2 pi v) from two uniforms of mulberry32(seed) (u redrawn while 0). A trial = a 100-frame quiet check (draws 1 + 100) that must be valid (quiet_check rules incl. quantisation); if valid, the session floor is the emitted floor_dbfs and an independent 160-frame window (draws 1 + 160) from the same generator is run through the VAD. Invalid quiet checks consume their draws and are not counted. 'Active' = at least one accepted segment (equivalently the phrase window is not no_voice).",
    "target_p_active_max": AR_MAX_P,
    "valid_trials_per_model": AR_TRIALS,
    "models": ar_models,
    "finding": "Under the revision 2 VAD (open +10 dB, continue +6 dB, >= 4 candidates and a run of >= 3) the 1 % target is met only for noise with sigma <= 2.5 dB; at sigma 3.0 - 3.5 dB (the edge of what the quiet check admits: p80 - p20 = 1.683 sigma <= 6 allows sigma up to about 3.56) the rate is 3 - 17 %. This is recorded, not hidden: see fixtures/dsp/README.md for the comparison with alternative thresholds.",
    "recorded_counts_note": "active_trials are the ORACLE's counts. The TypeScript test regenerates the same trials with its own implementation and must reproduce them exactly.",
}


# --------------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------------
def dump(path, obj):
    holders = {}

    def stash(o, key=None):
        if isinstance(o, dict):
            return {k: (stash_compact(v) if k in ("runs", "offsets_samples", "events", "accepted_offsets") else stash(v)) for k, v in o.items()}
        if isinstance(o, list):
            return [stash(x) for x in o]
        return o

    def stash_compact(v):
        token = f"@@C{len(holders)}@@"
        holders[token] = json.dumps(v, separators=(",", ":"))
        return token

    text = json.dumps(stash(obj), indent=2)
    for token, compact in holders.items():
        text = text.replace(json.dumps(token), compact)
    with open(os.path.join(OUT, path), "w") as fh:
        fh.write(text + "\n")


SCHEMA_NOTE = (
    "Hand-derived expected values for ADR-0001 revision 2; see README.md and tools/derive_fixtures.py. "
    "runs: [db, n] finite frames, [db, n, 'clipped'], [null, n] non-finite, ['gap', n] missing frames. "
    "50 ms frames; 48 kHz timing (t_audio_ms = frame_index * 50). Not measurements of any real microphone."
)

dump("quiet-check.json", {"note": SCHEMA_NOTE, "cases": QUIET_CASES})
dump("vad.json", {"note": SCHEMA_NOTE, "cases": VAD_CASES})
dump("windows.json", {"note": SCHEMA_NOTE, "cases": WINDOW_CASES})
dump(
    "soft-windows.json",
    {
        "note": SCHEMA_NOTE,
        "verdict_rule": "window_rel_p95 = p95_active_dbfs - session_floor_dbfs; reached when window_rel_p95 >= cal_margin_db - 1, otherwise not_reached; borderline when |window_rel_p95 - (cal_margin_db - 1)| < 1 (ADR-0001 section 8). All 20 cases are valid phrase windows below the band edge, so each expected verdict is not_reached. Revision 2: speech must reach +10 dB to open a segment, so every case has at least one frame at or above +10 dB.",
        "cases": SOFT_CASES,
    },
)
dump("vad-phase-sweep.json", PHASE_SWEEP)
dump("vad-click-train.json", CLICK_TRAIN)
dump("vad-ar1-noise.json", AR_NOISE)
print(
    f"wrote {len(QUIET_CASES)} quiet-check, {len(VAD_CASES)} vad, {len(WINDOW_CASES)} window, "
    f"{len(SOFT_CASES)} soft-window, {len(CLICK_CASES)} click-train fixtures, the phase sweep and "
    f"{len(ar_models)} AR(1) models; oracle matched every hand-derived value"
)

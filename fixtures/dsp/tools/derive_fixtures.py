#!/usr/bin/env python3
"""Generate fixtures/dsp/*.json.

Provenance (read this before trusting the files):

* Every expected value in this script is HAND-DERIVED from ADR-0001 by reasoning about the
  structure of the fixture (the `derivation` strings say how). They are typed in below as
  literals.
* This script also contains a second, independent Python implementation of the ADR-0001 rules
  (the "oracle"). It is NOT a port of the TypeScript package. The script refuses to write any
  fixture unless the oracle reproduces the hand-derived literals, so a slip in the hand
  derivation (or in the oracle) is caught here.
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
import re

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TOL = 1e-9
FRAME_MS = 50


# --------------------------------------------------------------------------------------------
# Oracle: independent re-implementation of the ADR-0001 rules
# --------------------------------------------------------------------------------------------
def expand(runs):
    frames, idx = [], 0
    for r in runs:
        db, n = r[0], r[1]
        flag = r[2] if len(r) > 2 else None
        if db == "gap":
            idx += n
            continue
        for _ in range(n):
            frames.append({"index": idx, "finite": db is not None, "db": db, "clipped": flag == "clipped"})
            idx += 1
    return frames


def pct(values, k):
    """Nearest rank: sorted[ceil(k*n/100) - 1]; integer arithmetic for the ceiling."""
    n = len(values)
    if n == 0:
        return None
    s = sorted(values)
    rank = -((-k * n) // 100)
    return s[max(0, min(n - 1, rank - 1))]


def oracle_vad(frames, floor):
    by = {f["index"]: f for f in frames}
    if not by:
        return [], 0, False
    lo, hi = min(by), max(by)
    segs, rejected = [], 0
    start = last = None
    ncand = gap = 0

    def close():
        nonlocal start, last, ncand, gap, rejected
        if ncand >= 4:
            segs.append(
                {
                    "onset_frame": start,
                    "end_frame": last,
                    "onset_ms": start * FRAME_MS,
                    "end_ms": (last + 1) * FRAME_MS,
                    "candidate_frames": ncand,
                }
            )
            ok = True
        else:
            rejected += 1
            ok = False
        start = last = None
        ncand = gap = 0
        return ok

    for i in range(lo, hi + 1):
        f = by.get(i)
        cand = f is not None and f["finite"] and (f["db"] - floor) >= 6 - TOL
        if cand:
            if start is None:
                start, ncand = i, 0
            ncand += 1
            last = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= 6:
                close()
    unterminated = False
    if start is not None:
        unterminated = close()
    return segs, rejected, unterminated


def oracle_precheck(purpose, duration_ms, frames, interrupted=False):
    expected = duration_ms // FRAME_MS
    finite = [f for f in frames if f["finite"]]
    nonfinite = len(frames) - len(finite)
    clipped = [f for f in finite if f["clipped"]]
    levels = [f["db"] for f in finite if not f["clipped"]]
    coverage = 0 if expected == 0 else min(1.0, len(finite) / expected)
    floor, p20, p80, p95 = pct(levels, 50), pct(levels, 20), pct(levels, 80), pct(levels, 95)
    nf_bad = len(frames) > 0 and nonfinite / len(frames) > 0.05
    burst = p95 is not None and floor is not None and p95 - floor > 10 + TOL
    reason = None
    if interrupted:
        reason = "interrupted"
    elif coverage < 0.9:
        reason = "low_coverage"
    elif len(clipped) > 0:
        reason = "clipped"
    elif purpose == "pre_window":
        reason = "nonfinite" if nf_bad else ("burst_noise" if burst else None)
    else:
        if p80 - p20 > 6 + TOL:
            reason = "unstable_floor"
        elif burst:
            reason = "burst_noise"
        elif floor > -30 + TOL:
            reason = "too_loud"
        elif nf_bad:
            reason = "nonfinite"
    return {
        "purpose": purpose,
        "valid": reason is None,
        "invalid_reason": reason,
        "floor_dbfs": floor,
        "p20_dbfs": p20,
        "p80_dbfs": p80,
        "p95_dbfs": p95,
        "frame_count": len(frames),
        "expected_frames": expected,
        "coverage": coverage,
        "clipped_frames": len(clipped),
        "nonfinite_frames": nonfinite,
        "duration_ms": duration_ms,
    }


def oracle_window(kind, max_ms, floor, runs, finish):
    max_frames = min(700, max_ms // FRAME_MS)
    frames = [f for f in expand(runs) if f["index"] < max_frames]
    segs, _rejected, unterminated = oracle_vad(frames, floor)
    by = {f["index"]: f for f in frames}
    if "duration_ms" in finish:
        duration = min(finish["duration_ms"], max_ms)
    else:
        duration = min(max_ms, (max(by) + 1) * FRAME_MS) if by else 0
    expected = duration // FRAME_MS
    finite = [f for f in frames if f["finite"]]
    nonfinite = len(frames) - len(finite)
    clipped_all = sum(1 for f in finite if f["clipped"])
    coverage = 0 if expected == 0 else min(1.0, len(finite) / expected)
    active = []
    for s in segs:
        for i in range(s["onset_frame"], s["end_frame"] + 1):
            f = by.get(i)
            if f is not None and f["finite"]:
                active.append(f)
    active_clipped = sum(1 for f in active if f["clipped"])
    spans = [s["end_ms"] - s["onset_ms"] for s in segs]
    active_ms = sum(spans)
    reason = None
    if finish["reason"] == "interrupted":
        reason = "interrupted"
    elif coverage < 0.9:
        reason = "low_coverage"
    elif active and active_clipped / len(active) > 0.02 + TOL:
        reason = "clipped"
    elif frames and nonfinite / len(frames) > 0.05:
        reason = "nonfinite"
    elif not segs or (kind in ("calibration", "phrase") and active_ms < 400):
        reason = "no_voice"
    elif kind == "phrase" and duration > 0 and active_ms / duration > 0.95 and unterminated:
        reason = "continuous_sound"
    levels = [f["db"] for f in active]
    return {
        "kind": kind,
        "valid": reason is None,
        "invalid_reason": reason,
        "frame_count": len(frames),
        "expected_frames": expected,
        "coverage": coverage,
        "active_ms": active_ms,
        "longest_active_ms": max(spans) if spans else 0,
        "segments": len(segs),
        "onset_ms": segs[0]["onset_ms"] if segs else None,
        "p50_active_dbfs": pct(levels, 50),
        "p95_active_dbfs": pct(levels, 95),
        "peak_dbfs": max((f["db"] for f in finite), default=None),
        "clipped_frames": clipped_all,
        "nonfinite_frames": nonfinite,
        "duration_ms": duration,
    }


def same(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        assert abs(a - b) < 1e-9, f"{path}: hand {a} != oracle {b}"
    else:
        assert a == b, f"{path}: hand {a!r} != oracle {b!r}"


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
    "p95 = sorted[94] = D."
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


def flat(floor, p, n):
    return dict(valid=True, reason=None, floor=floor, p20=floor, p80=floor, p95=floor, fc=n, ef=p, cov=n / p)


QUIET_CASES = [
    qc("qc-01-valid-typical", "Typical quiet room, all rules satisfied.", "quiet_check", 5000,
       blocks(-46, -43, -40, -36, -35),
       dict(valid=True, reason=None, floor=-43, p20=-46, p80=-40, p95=-36, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -40 - (-46) = 6 (<= 6, stable). p95 - floor = -36 - (-43) = 7 (<= 10). floor -43 <= -30. Coverage 100/100 = 1. Valid."),
    qc("qc-02-stable-exactly-6", "Stability boundary: p80 - p20 is exactly 6 dB.", "quiet_check", 5000,
       blocks(-50, -48, -44, -42, -41),
       dict(valid=True, reason=None, floor=-48, p20=-50, p80=-44, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -44 - (-50) = 6.00 which is <= 6: valid. p95 - floor = -42 - (-48) = 6."),
    qc("qc-03-unstable-6.01", "Stability boundary: p80 - p20 = 6.01 dB.", "quiet_check", 5000,
       blocks(-50, -48, -43.99, -42, -41),
       dict(valid=False, reason="unstable_floor", floor=-48, p20=-50, p80=-43.99, p95=-42, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p80 - p20 = -43.99 - (-50) = 6.01 > 6: unstable_floor."),
    qc("qc-04-burst-exactly-10", "Burst boundary: p95 - floor is exactly 10 dB.", "quiet_check", 5000,
       blocks(-46, -43, -40, -33, -30),
       dict(valid=True, reason=None, floor=-43, p20=-46, p80=-40, p95=-33, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p95 - floor = -33 - (-43) = 10.00 <= 10: valid. p80 - p20 = 6 (stable)."),
    qc("qc-05-burst-10.01", "Burst boundary: p95 - floor = 10.01 dB.", "quiet_check", 5000,
       blocks(-46, -43, -40, -32.99, -30),
       dict(valid=False, reason="burst_noise", floor=-43, p20=-46, p80=-40, p95=-32.99, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " p95 - floor = -32.99 - (-43) = 10.01 > 10: burst_noise. p80 - p20 = 6 (stable, so not the reported reason)."),
    qc("qc-06-floor-exactly-minus-30", "Loudness boundary: floor is exactly -30 dBFS.", "quiet_check", 5000,
       blocks(-33, -30, -28, -24, -23),
       dict(valid=True, reason=None, floor=-30, p20=-33, p80=-28, p95=-24, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " floor = -30 <= -30: valid. p80 - p20 = -28 - (-33) = 5. p95 - floor = -24 - (-30) = 6."),
    qc("qc-07-too-loud-minus-29.99", "Loudness boundary: floor is -29.99 dBFS.", "quiet_check", 5000,
       blocks(-33, -29.99, -28, -24, -23),
       dict(valid=False, reason="too_loud", floor=-29.99, p20=-33, p80=-28, p95=-24, fc=100, ef=100, cov=1.0),
       BLOCK_RULE + " floor = -29.99 > -30: too_loud. p80 - p20 = 5 and p95 - floor = 5.99, so only too_loud applies."),
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
       "95 finite frames at -50 and 5 non-finite. Coverage 95/100 = 0.95 >= 0.90. Non-finite fraction 5/100 = 0.05, not > 0.05: valid. Non-finite frames are excluded from statistics."),
    qc("qc-12-nonfinite-6pct", "6 of 100 frames non-finite is more than 5 %.", "quiet_check", 5000,
       [[-50, 94], [None, 6]],
       dict(valid=False, reason="nonfinite", floor=-50, p20=-50, p80=-50, p95=-50, fc=100, ef=100, cov=0.94, nf=6),
       "94 finite + 6 non-finite. Coverage 0.94 >= 0.90 passes; non-finite fraction 0.06 > 0.05: nonfinite."),
    qc("qc-13-prewindow-valid", "Pre-window check, quiet room.", "pre_window", 2000,
       [[-50, 30], [-45, 10]],
       dict(valid=True, reason=None, floor=-50, p20=-50, p80=-45, p95=-45, fc=40, ef=40, cov=1.0),
       "n = 40: sorted idx 0-29 = -50, 30-39 = -45. floor = p50 = sorted[ceil(20)-1 = 19] = -50. p20 = sorted[7] = -50. p80 = sorted[31] = -45. p95 = sorted[ceil(38)-1 = 37] = -45. p95 - floor = 5 <= 10. expected_frames = 2000/50 = 40."),
    qc("qc-14-prewindow-burst-exactly-10", "Pre-window burst boundary: exactly 10 dB.", "pre_window", 2000,
       [[-50, 30], [-40, 10]],
       dict(valid=True, reason=None, floor=-50, p20=-50, p80=-40, p95=-40, fc=40, ef=40, cov=1.0),
       "n = 40: idx 0-29 = -50, 30-39 = -40. floor = sorted[19] = -50, p95 = sorted[37] = -40. p95 - floor = 10.00 <= 10: valid."),
    qc("qc-15-prewindow-burst-10.01", "Pre-window burst boundary: 10.01 dB.", "pre_window", 2000,
       [[-50, 30], [-39.99, 10]],
       dict(valid=False, reason="burst_noise", floor=-50, p20=-50, p80=-39.99, p95=-39.99, fc=40, ef=40, cov=1.0),
       "p95 - floor = -39.99 - (-50) = 10.01 > 10: burst_noise."),
    qc("qc-16-prewindow-unstable-and-loud-is-valid", "Pre-window does not judge stability or absolute loudness (the TV judges rise and margin).", "pre_window", 2000,
       [[-28, 8], [-24, 12], [-20, 12], [-16, 6], [-15, 2]],
       dict(valid=True, reason=None, floor=-24, p20=-28, p80=-20, p95=-16, fc=40, ef=40, cov=1.0),
       "n = 40: idx 0-7 = -28, 8-19 = -24, 20-31 = -20, 32-37 = -16, 38-39 = -15. p20 = sorted[7] = -28, floor = sorted[19] = -24, p80 = sorted[31] = -20, p95 = sorted[37] = -16. p80 - p20 = 8 (would be unstable_floor for a quiet check) and floor -24 > -30 (would be too_loud), but for pre_window only coverage, clipping, non-finite and p95 - floor = 8 <= 10 are checked: valid."),
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
       "21 finite frames of 100 expected: coverage 0.21 < 0.90. A clipped frame is also present; the reason order is low_coverage, clipped, ... so low_coverage is reported."),
    qc("qc-21-prewindow-clipped", "Pre-window: a clipped frame invalidates.", "pre_window", 2000,
       [[-50, 39], [-3, 1, "clipped"]],
       dict(valid=False, reason="clipped", floor=-50, p20=-50, p80=-50, p95=-50, fc=40, ef=40, cov=1.0, cl=1),
       "40 finite frames (coverage 1) of which 1 is clipped: clipped. Statistics use the 39 non-clipped frames at -50."),
    qc("qc-22-prewindow-nonfinite-7.5pct", "Pre-window: 3 of 40 frames non-finite.", "pre_window", 2000,
       [[-50, 37], [None, 3]],
       dict(valid=False, reason="nonfinite", floor=-50, p20=-50, p80=-50, p95=-50, fc=40, ef=40, cov=0.925, nf=3),
       "37 finite + 3 non-finite: coverage 37/40 = 0.925 >= 0.90; non-finite fraction 3/40 = 0.075 > 0.05: nonfinite."),
]


# --------------------------------------------------------------------------------------------
# VAD fixtures. Floor -60 dBFS, candidate level C = -50 (rel +10), quiet Q = -58 (rel +2).
# --------------------------------------------------------------------------------------------
VF = -60
C_, Q_ = -50, -58


def seg(onset_frame, end_frame, cand):
    return {
        "onset_frame": onset_frame,
        "end_frame": end_frame,
        "onset_ms": onset_frame * 50,
        "end_ms": (end_frame + 1) * 50,
        "candidate_frames": cand,
    }


def vad_case(id, description, runs, segments, rejected, unterminated, derivation, floor=VF):
    segs, rej, unt = oracle_vad(expand(runs), floor)
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
             "Frames 10-11 are candidates (rel +10). 2 frames < 4: the segment is rejected when the 6th quiet frame ends it. No accepted segments."),
    vad_case("vad-02-transient-150ms", "150 ms transient (3 candidate frames) is rejected.",
             [[Q_, 10], [C_, 3], [Q_, 10]], [], 1, False,
             "3 candidate frames (150 ms) < 4: rejected."),
    vad_case("vad-03-accept-200ms-backdated", "200 ms (4 frames) is accepted and the onset is backdated to the first candidate frame.",
             [[Q_, 10], [C_, 4], [Q_, 10]], [seg(10, 13, 4)], 0, False,
             "Candidates are frames 10-13. Provisional onset = frame 10 = 500 ms (backdated: acceptance is only known at frame 13). End = end of frame 13 = 14*50 = 700 ms. Duration 200 ms."),
    vad_case("vad-04-gap-5-bridged", "A gap of 5 non-candidate frames (250 ms) is bridged.",
             [[C_, 4], [Q_, 5], [C_, 2], [Q_, 10]], [seg(0, 10, 6)], 0, False,
             "Candidates 0-3, quiet 4-8 (5 frames, bridged: fewer than 6), candidates 9-10, then quiet. One segment, onset frame 0, last candidate frame 10, 6 candidate frames, end = 11*50 = 550 ms."),
    vad_case("vad-05-gap-6-ends", "A gap of 6 non-candidate frames (300 ms) ends the segment.",
             [[C_, 4], [Q_, 6], [C_, 4], [Q_, 10]], [seg(0, 3, 4), seg(10, 13, 4)], 0, False,
             "Candidates 0-3; the 6th quiet frame (frame 9) ends the first segment at the end of frame 3 = 200 ms. Candidates 10-13 are a second segment [500, 700] ms."),
    vad_case("vad-06-hangover-end-time", "The segment ends at its last candidate frame, not after the hangover.",
             [[Q_, 2], [C_, 4], [Q_, 30]], [seg(2, 5, 4)], 0, False,
             "Candidates are frames 2-5: onset 100 ms, end = 6*50 = 300 ms. The 30 quiet frames add no duration (not 300 + 250 or + 300)."),
    vad_case("vad-07-multiple-segments-longest-run", "Three segments; longest run and sum.",
             [[C_, 4], [Q_, 8], [C_, 10], [Q_, 7], [C_, 6], [Q_, 10]],
             [seg(0, 3, 4), seg(12, 21, 10), seg(29, 34, 6)], 0, False,
             "Seg A frames 0-3 [0,200]; 8 quiet frames (4-11) close it at the 6th. Seg B frames 12-21 [600,1100]; 7 quiet (22-28) close it at the 6th (frame 27). Seg C frames 29-34 [1450,1750]. Spans 200, 500, 300: longest 500, sum 1000."),
    vad_case("vad-08-open-at-end", "A segment still open when the stream ends is closed at its last candidate frame.",
             [[C_, 10]], [seg(0, 9, 10)], 0, True,
             "10 candidate frames, no offset seen. At finish the segment ends at the end of frame 9 = 500 ms and is marked unterminated (no offset observed)."),
    vad_case("vad-09-threshold-exactly-plus-6", "A frame exactly +6 dB above the floor is a candidate.",
             [[Q_, 5], [-54, 4], [Q_, 10]], [seg(5, 8, 4)], 0, False,
             "-54 - (-60) = +6.00 >= 6: candidate. 4 frames accepted: onset 250 ms, end 450 ms."),
    vad_case("vad-10-threshold-just-below-plus-6", "A frame at +5.99 dB is not a candidate, so there is no segment at all.",
             [[Q_, 5], [-54.01, 4], [Q_, 10]], [], 0, False,
             "-54.01 - (-60) = +5.99 < 6: never a candidate, so no segment is even opened (rejected count stays 0)."),
    vad_case("vad-11-nonfinite-inside-speech", "A single non-finite frame inside speech is a bridged gap.",
             [[C_, 2], [None, 1], [C_, 3], [Q_, 10]], [seg(0, 5, 5)], 0, False,
             "Frames 0-1 candidates, frame 2 non-finite (non-candidate, gap of 1), frames 3-5 candidates. One segment frames 0-5 with 5 candidate frames, end = 6*50 = 300 ms."),
    vad_case("vad-12-six-nonfinite-end-segment", "Six consecutive non-finite frames end the segment.",
             [[C_, 4], [None, 6], [C_, 4], [Q_, 6]], [seg(0, 3, 4), seg(10, 13, 4)], 0, False,
             "6 consecutive non-candidate (non-finite) frames end the first segment at 200 ms; the next 4 candidates are a second segment."),
    vad_case("vad-13-missing-2-frames-bridged", "A dropout of 2 missing frames inside speech is bridged.",
             [[C_, 4], ["gap", 2], [C_, 2], [Q_, 10]], [seg(0, 7, 6)], 0, False,
             "Candidates at indices 0-3; indices 4-5 missing (count as non-candidates, gap of 2); candidates at indices 6-7. One segment, 6 candidate frames, end = 8*50 = 400 ms."),
    vad_case("vad-14-missing-6-frames-ends", "A dropout of 6 missing frames ends the segment.",
             [[C_, 4], ["gap", 6], [C_, 4], [Q_, 10]], [seg(0, 3, 4), seg(10, 13, 4)], 0, False,
             "Indices 4-9 are missing: 6 non-candidates end the first segment at 200 ms. Candidates at 10-13 start a second segment."),
]


# --------------------------------------------------------------------------------------------
# Window summary fixtures. Floor -60, quiet Q = -62 (rel -2), speech S = -45 (rel +15).
# --------------------------------------------------------------------------------------------
WQ, WS = -62, -45


def win(kind, max_ms, reason, floor=-60, duration=None):
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
    wcase("win-01-clean-phrase", "Clean 1 s phrase.", "phrase", 8000, CLEAN, win("phrase", 8000, "complete"),
          W(active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Speech frames 10-29 at -45 (rel +15). Onset 10*50 = 500 ms, end 30*50 = 1500 ms, active 1000 ms. 20 active frames all -45: p50 = p95 = -45. Peak = -45. 160 frames = duration 8000 ms: coverage 1."),
    wcase("win-02-silence", "Silence only.", "phrase", 8000, [[WQ, 160]], win("phrase", 8000, "complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=WQ),
          "No candidate frame, so no segment: no_voice. Statistics over accepted-active frames are null. Peak is the loudest finite frame, -62."),
    wcase("win-03-transient-150ms", "150 ms transient only.", "phrase", 8000, [[WQ, 10], [WS, 3], [WQ, 147]], win("phrase", 8000, "complete"),
          W(reason="no_voice", active=0, longest=0, segs=0, onset=None, p50=None, p95=None, peak=WS),
          "3 candidate frames < 4: rejected, contributes nothing: no_voice. Peak still reports -45 (whole window)."),
    wcase("win-04-phrase-350ms", "350 ms is accepted by the VAD but too short for a phrase.", "phrase", 8000,
          [[WQ, 10], [WS, 7], [WQ, 143]], win("phrase", 8000, "complete"),
          W(reason="no_voice", active=350, longest=350, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "7 candidate frames >= 4: accepted segment of 7*50 = 350 ms. active_ms 350 < 400 for phrase: no_voice (fields still filled)."),
    wcase("win-05-phrase-400ms", "400 ms is the phrase minimum.", "phrase", 8000,
          [[WQ, 10], [WS, 8], [WQ, 142]], win("phrase", 8000, "complete"),
          W(active=400, longest=400, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "8 candidate frames = 400 ms >= 400: valid."),
    wcase("win-06-vowel-200ms", "A vowel window needs only one accepted segment.", "vowel", 8000,
          [[WQ, 10], [WS, 4], [WQ, 146]], win("vowel", 8000, "complete"),
          W(active=200, longest=200, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "The 400 ms minimum applies to calibration and phrase only. 4 candidate frames = one accepted segment of 200 ms: valid for a vowel window."),
    wcase("win-07-coverage-exactly-0.90", "Coverage boundary: 144 of 160 frames.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 114]], win("phrase", 8000, "complete", duration=8000),
          W(fc=144, active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cov=0.9),
          "Duration 8000 ms, expected_frames = 160. 144 finite frames: 144/160 = 0.90 >= 0.90: valid."),
    wcase("win-08-coverage-0.89375", "Coverage boundary: 143 of 160 frames.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 113]], win("phrase", 8000, "complete", duration=8000),
          W(reason="low_coverage", fc=143, active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cov=0.89375),
          "143/160 = 0.89375 < 0.90: low_coverage."),
    wcase("win-09-clipped-2pct-valid", "1 clipped frame in 50 active frames (2.0 %) is valid.", "phrase", 8000,
          [[WQ, 10], [WS, 10], [WS, 1, "clipped"], [WS, 39], [WQ, 100]], win("phrase", 8000, "complete"),
          W(active=2500, longest=2500, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cl=1),
          "Active frames 10-59 = 50. 1 clipped / 50 = 2.0 %, not > 2 %: valid. clipped_frames = 1."),
    wcase("win-10-clipped-4pct-invalid", "2 clipped frames in 50 active frames (4.0 %) are invalid.", "phrase", 8000,
          [[WQ, 10], [WS, 10], [WS, 2, "clipped"], [WS, 38], [WQ, 100]], win("phrase", 8000, "complete"),
          W(reason="clipped", active=2500, longest=2500, segs=1, onset=500, p50=WS, p95=WS, peak=WS, cl=2),
          "2 / 50 = 4.0 % > 2 %: clipped."),
    wcase("win-11-nonfinite-5pct-valid", "8 of 160 frames non-finite (5.0 %) is valid.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 90], [None, 8], [WQ, 32]], win("phrase", 8000, "complete"),
          W(active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, nf=8, cov=0.95),
          "Coverage 152/160 = 0.95 >= 0.90. Non-finite 8/160 = 0.05, not > 0.05: valid."),
    wcase("win-12-nonfinite-5.6pct-invalid", "9 of 160 frames non-finite (5.625 %) is invalid.", "phrase", 8000,
          [[WQ, 10], [WS, 20], [WQ, 90], [None, 9], [WQ, 31]], win("phrase", 8000, "complete"),
          W(reason="nonfinite", active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS, nf=9, cov=0.94375),
          "Coverage 151/160 = 0.94375 passes; non-finite 9/160 = 0.05625 > 0.05: nonfinite."),
    wcase("win-13-continuous-phrase", "Speech for the whole phrase window is continuous_sound.", "phrase", 8000,
          [[WS, 160]], win("phrase", 8000, "complete"),
          W(reason="continuous_sound", active=8000, longest=8000, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "One segment open from frame 0 to the end (no offset). active_ms 8000 / 8000 = 1.00 > 0.95: continuous_sound."),
    wcase("win-14-continuous-ok-for-calibration", "The same signal is valid for a calibration window.", "calibration", 8000,
          [[WS, 160]], win("calibration", 8000, "complete"),
          W(active=8000, longest=8000, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "continuous_sound applies to phrase windows only."),
    wcase("win-15-continuous-exactly-95pct", "Exactly 95.0 % with no offset is valid.", "phrase", 2000,
          [[WS, 38], [WQ, 2]], win("phrase", 2000, "complete"),
          W(fc=40, ef=40, dur=2000, active=1900, longest=1900, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "Window 2000 ms = 40 frames. 38 speech frames = 1900 ms; 1900/2000 = 0.95, not > 0.95: valid."),
    wcase("win-16-continuous-97.5pct", "97.5 % with no offset is continuous_sound.", "phrase", 2000,
          [[WS, 39], [WQ, 1]], win("phrase", 2000, "complete"),
          W(reason="continuous_sound", fc=40, ef=40, dur=2000, active=1950, longest=1950, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "39 speech frames = 1950 ms; 1950/2000 = 0.975 > 0.95 and only 1 quiet frame follows (no 6-frame offset): continuous_sound."),
    wcase("win-17-long-activity-with-offset", "Over 95 % active, but the offset (6 quiet frames) was observed.", "phrase", 8000,
          [[WS, 153], [WQ, 7]], win("phrase", 8000, "complete"),
          W(active=7650, longest=7650, segs=1, onset=0, p50=WS, p95=WS, peak=WS),
          "153 speech frames = 7650 ms (95.6 %), but the 6th quiet frame closed the segment (a real offset), so continuous_sound does not apply: valid."),
    wcase("win-18-interrupted", "Interrupted capture is invalid whatever the data.", "phrase", 8000, CLEAN, win("phrase", 8000, "interrupted"),
          W(reason="interrupted", active=1000, longest=1000, segs=1, onset=500, p50=WS, p95=WS, peak=WS),
          "Same data as win-01 but the capture was interrupted: invalid_reason interrupted."),
    wcase("win-19-gap-frames-inside-span", "Bridged gap frames are part of the accepted-active frames.", "phrase", 8000,
          [[WQ, 5], [WS, 4], [-61, 5], [-40, 6], [WQ, 20]], win("phrase", 8000, "complete"),
          W(fc=40, ef=40, dur=2000, active=750, longest=750, segs=1, onset=250, p50=WS, p95=-40, peak=-40),
          "Frames 5-8 at -45, frames 9-13 at -61 (5 quiet frames: bridged), frames 14-19 at -40, then quiet. Span = frames 5-19 = 15 frames; onset 250 ms, end 20*50 = 1000 ms, active 750 ms. Sorted active levels: 5 x -61, 4 x -45, 6 x -40 (n = 15). p50 = sorted[ceil(7.5)-1 = 7] = -45. p95 = sorted[ceil(14.25)-1 = 14] = -40. Duration = 40 frames = 2000 ms."),
]


# --------------------------------------------------------------------------------------------
# 20 "soft window" fixtures: valid phrase windows whose accepted-active p95 is below the band edge.
# --------------------------------------------------------------------------------------------
def soft(id, description, floor, margin, runs, hand, rel_p95, borderline, derivation):
    edge = margin - 1
    assert rel_p95 < edge, f"{id}: designed rel p95 {rel_p95} must be below the band edge {edge}"
    assert (abs(rel_p95 - edge) < 1) == borderline, f"{id}: borderline flag does not match |{rel_p95} - {edge}| < 1"
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
    soft("soft-01-uniform-8dB", "Uniform soft speech 8 dB above the floor; calibration margin 13 dB.", -60, 13,
         [[-60, 20], [-52, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-52, p95=-52, peak=-52), 8, False,
         "Floor -60, cal_margin 13, so band edge = 13 - 1 = 12 dB above the floor. Speech frames 20-49 at -52 (rel +8): 30 frames, onset 20*50 = 1000 ms, active 1500 ms, p50 = p95 = -52. window_rel_p95 = -52 - (-60) = 8 < 12: not_reached. |8 - 12| = 4, not borderline."),
    soft("soft-02-11.5dB-borderline", "Soft speech 0.5 dB under the band edge.", -60, 13,
         [[-60, 20], [-48.5, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.5, p95=-48.5, peak=-48.5), 11.5, True,
         "Edge 12. 30 speech frames at -48.5 (rel +11.5). p95 = -48.5, rel 11.5 < 12: not_reached. |11.5 - 12| = 0.5 < 1: borderline."),
    soft("soft-03-11.01dB-borderline", "Soft speech 0.99 dB under the band edge.", -60, 13,
         [[-60, 20], [-48.99, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.99, p95=-48.99, peak=-48.99), 11.01, True,
         "Edge 12. rel 11.01 < 12: not_reached. |11.01 - 12| = 0.99 < 1: borderline."),
    soft("soft-04-11.99dB-borderline", "Soft speech 0.01 dB under the band edge.", -60, 13,
         [[-60, 20], [-48.01, 30], [-60, 110]],
         H(active=1500, onset=1000, p50=-48.01, p95=-48.01, peak=-48.01), 11.99, True,
         "Edge 12. rel 11.99 < 12 by 0.01: not_reached (the verdict is not rounded). Borderline: |11.99 - 12| = 0.01 < 1."),
    soft("soft-05-9dB-floor-55", "Soft speech, floor -55, margin 15.", -55, 15,
         [[-55, 15], [-46, 40], [-55, 105]],
         H(active=2000, onset=750, p50=-46, p95=-46, peak=-46), 9, False,
         "Edge = 14. 40 speech frames 15-54 at -46 (rel +9): onset 750 ms, active 2000 ms. rel p95 9 < 14. |9 - 14| = 5: not borderline."),
    soft("soft-06-exactly-1dB-under-edge", "p95 exactly 1.00 dB under the edge is not borderline (borderline needs < 1).", -70, 16,
         [[-70, 10], [-63, 20], [-61, 20], [-56, 4], [-70, 106]],
         H(active=2200, onset=500, p50=-61, p95=-56, peak=-56), 14, False,
         "Floor -70, margin 16, edge 15. Active frames 10-53 (44 frames): 20 x -63 (rel +7), 20 x -61 (rel +9), 4 x -56 (rel +14). Sorted idx 0-19 = -63, 20-39 = -61, 40-43 = -56. p50 = sorted[ceil(22)-1 = 21] = -61. p95 = sorted[ceil(41.8)-1 = 41] = -56. rel p95 = 14 < 15: not_reached. |14 - 15| = 1.00 is not < 1: not borderline. active_ms = 44*50 = 2200, onset 500."),
    soft("soft-07-loud-spike-below-5pct", "A 5 % spike does not move p95: the 4 loudest of 80 active frames are skipped.", -65, 18,
         [[-65, 15], [-55, 76], [-43, 4], [-65, 65]],
         H(active=4000, onset=750, p50=-55, p95=-55, peak=-43), 10, False,
         "Floor -65, margin 18, edge 17. Active frames 15-94 (80 frames): 76 x -55 (rel +10), then 4 x -43 (rel +22). p95 = sorted[ceil(76)-1 = 75] = -55 (idx 76-79 are the spike). p50 = sorted[ceil(40)-1 = 39] = -55. rel p95 10 < 17: not_reached. Peak = -43 (whole window)."),
    soft("soft-08-two-words", "Two words separated by a 400 ms silence (two segments).", -48, 20,
         [[-48, 10], [-34, 12], [-48, 8], [-33, 14], [-48, 116]],
         H(active=1300, longest=700, onset=500, segs=2, p50=-33, p95=-33, peak=-33), 15, False,
         "Floor -48, margin 20, edge 19. Word A frames 10-21 at -34 [500, 1100] ms; 8 quiet frames 22-29 (the 6th, frame 27, ends it); word B frames 30-43 at -33 [1500, 2200]. active_ms 600 + 700 = 1300, longest 700, 2 segments. Active levels: 12 x -34, 14 x -33 (n = 26): p50 = sorted[ceil(13)-1 = 12] = -33, p95 = sorted[ceil(24.7)-1 = 24] = -33. rel p95 15 < 19: not_reached."),
    soft("soft-09-long-utterance-floor-40", "Long soft utterance in a noisier room (floor -40).", -40, 25,
         [[-40, 20], [-20, 100], [-40, 40]],
         H(active=5000, onset=1000, p50=-20, p95=-20, peak=-20), 20, False,
         "Floor -40, margin 25, edge 24. 100 speech frames 20-119 at -20 (rel +20): 5000 ms = 62.5 % of 8000, with an offset (40 quiet frames): not continuous. rel p95 20 < 24: not_reached."),
    soft("soft-10-bridged-word-gaps", "Word gaps of 4 and 3 frames are bridged and counted in the span.", -62.5, 14.5,
         [[-62.5, 10], [-52.5, 10], [-61.5, 4], [-52.5, 10], [-62.5, 3], [-52.5, 8], [-62.5, 115]],
         H(active=1750, onset=500, p50=-52.5, p95=-52.5, peak=-52.5), 10, False,
         "Floor -62.5, margin 14.5, edge 13.5. Speech frames 10-19, gap 20-23 (4 frames at rel +1, bridged), speech 24-33, gap 34-36 (3 frames at rel 0, bridged), speech 37-44. One segment, frames 10-44 (35 frames), onset 500 ms, end 45*50 = 2250, active 1750 ms. Sorted active levels: 3 x -62.5, 4 x -61.5, 28 x -52.5 (n = 35). p50 = sorted[ceil(17.5)-1 = 17] = -52.5, p95 = sorted[ceil(33.25)-1 = 33] = -52.5. rel p95 10 < 13.5: not_reached."),
    soft("soft-11-exactly-plus-6-candidates", "Speech frames exactly 6 dB above the floor are candidates.", -58, 13,
         [[-58, 10], [-52, 20], [-58, 130]],
         H(active=1000, onset=500, p50=-52, p95=-52, peak=-52), 6, False,
         "Floor -58, edge 12. Frames at -52 are exactly +6.00 dB: candidates (>= 6). 20 frames 10-29 = 1000 ms accepted. p95 = -52, rel 6 < 12: not_reached."),
    soft("soft-12-long-soft-6s", "Long soft utterance (6 s).", -66, 17,
         [[-66, 10], [-54, 120], [-66, 30]],
         H(active=6000, onset=500, p50=-54, p95=-54, peak=-54), 12, False,
         "Floor -66, margin 17, edge 16. 120 frames 10-129 at -54 (rel +12): 6000 ms = 75 % of 8000, offset observed (30 quiet frames). rel p95 12 < 16: not_reached."),
    soft("soft-13-rising-ramp", "Speech that rises in 1 dB steps and never reaches the edge.", -60, 13,
         [[-60, 10], [-54, 20], [-53, 20], [-52, 20], [-51, 20], [-50, 20], [-60, 50]],
         H(active=5000, onset=500, p50=-52, p95=-50, peak=-50), 10, False,
         "Floor -60, edge 12. 100 active frames 10-109: 20 each at rel +6, +7, +8, +9, +10 (-54 ... -50). Sorted groups of 20. p50 = sorted[ceil(50)-1 = 49] = third group = -52. p95 = sorted[ceil(95)-1 = 94] = fifth group = -50. rel p95 10 < 12: not_reached."),
    soft("soft-14-decaying-speech", "Speech that decays (loudest first).", -54, 21,
         [[-54, 10], [-42, 10], [-44, 10], [-46, 10], [-48, 10], [-54, 110]],
         H(active=2000, onset=500, p50=-46, p95=-42, peak=-42), 12, False,
         "Floor -54, margin 21, edge 20. 40 active frames 10-49 in groups of 10 at -42, -44, -46, -48. Sorted ascending: -48 x10, -46 x10, -44 x10, -42 x10. p50 = sorted[ceil(20)-1 = 19] = -46. p95 = sorted[ceil(38)-1 = 37] = -42. rel p95 12 < 20: not_reached."),
    soft("soft-15-rejected-loud-transient", "A loud 150 ms transient (rejected) cannot lift a soft window.", -60, 13,
         [[-60, 10], [-51, 40], [-60, 30], [-30, 3], [-60, 77]],
         H(active=2000, onset=500, p50=-51, p95=-51, peak=-30), 9, False,
         "Floor -60, edge 12. Soft speech frames 10-49 at -51 (rel +9): 2000 ms accepted. Frames 80-82 at -30 (rel +30) are a 150 ms transient: 3 candidate frames < 4, rejected, contributes nothing to active_ms or the percentiles. p95 = -51, rel 9 < 12: not_reached. Peak = -30 (whole window)."),
    soft("soft-16-dropout-inside-speech", "A 3-frame dropout inside speech lowers coverage but the window stays valid.", -45, 13,
         [[-45, 10], [-36, 20], ["gap", 3], [-36, 20], [-45, 107]],
         H(fc=157, cov=0.98125, active=2150, onset=500, p50=-36, p95=-36, peak=-36), 9, False,
         "Floor -45, edge 12. Indices 0-9 quiet, 10-29 speech, 30-32 missing (dropout), 33-52 speech, 53-159 quiet. 157 frames received of 160 expected: coverage 157/160 = 0.98125 >= 0.90. The 3 missing frames count as non-candidates (gap 3, bridged): one segment, indices 10-52 = 43 frames, active 2150 ms; the 40 present frames at -36 give p50 = p95 = -36. rel 9 < 12: not_reached."),
    soft("soft-17-quiet-room-floor-72", "Very quiet room (floor -72), speech 16 dB above floor, margin 19.", -72, 19,
         [[-72, 10], [-56, 30], [-72, 120]],
         H(active=1500, onset=500, p50=-56, p95=-56, peak=-56), 16, False,
         "Floor -72, margin 19, edge 18. 30 speech frames at -56 (rel +16): p95 -56, rel 16 < 18: not_reached. |16 - 18| = 2: not borderline."),
    soft("soft-18-fractional-margin", "Fractional floor and margin: rel 12.49 against an edge of 12.5.", -52.5, 13.5,
         [[-52.5, 10], [-40.01, 30], [-52.5, 120]],
         H(active=1500, onset=500, p50=-40.01, p95=-40.01, peak=-40.01), 12.49, True,
         "Floor -52.5, margin 13.5, edge 12.5. 30 frames at -40.01: rel = -40.01 - (-52.5) = 12.49 < 12.5: not_reached. |12.49 - 12.5| = 0.01 < 1: borderline."),
    soft("soft-19-margin-22", "High calibration margin, speech half a dB under the edge.", -60, 22,
         [[-60, 10], [-39.5, 40], [-60, 110]],
         H(active=2000, onset=500, p50=-39.5, p95=-39.5, peak=-39.5), 20.5, True,
         "Floor -60, margin 22, edge 21. 40 frames at -39.5 (rel +20.5) < 21: not_reached. |20.5 - 21| = 0.5 < 1: borderline."),
    soft("soft-20-gap-5-bridged", "A 5-frame word gap is bridged; the gap frames sit inside the span.", -58, 13,
         [[-58, 10], [-49, 8], [-55, 5], [-49, 8], [-58, 129]],
         H(active=1050, onset=500, p50=-49, p95=-49, peak=-49), 9, False,
         "Floor -58, edge 12. Speech frames 10-17 at -49 (rel +9), gap frames 18-22 at -55 (rel +3, 5 frames: bridged), speech 23-30. One segment frames 10-30 (21 frames): onset 500, end 31*50 = 1550, active 1050 ms. Sorted: 5 x -55, 16 x -49 (n = 21). p50 = sorted[ceil(10.5)-1 = 10] = -49. p95 = sorted[ceil(19.95)-1 = 19] = -49. rel 9 < 12: not_reached."),
]
assert len(SOFT_CASES) == 20, len(SOFT_CASES)


# --------------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------------
def dump(path, obj):
    holders = {}

    def stash(o):
        if isinstance(o, dict):
            return {k: (stash_runs(v) if k == "runs" else stash(v)) for k, v in o.items()}
        if isinstance(o, list):
            return [stash(x) for x in o]
        return o

    def stash_runs(runs):
        token = f"@@RUNS{len(holders)}@@"
        holders[token] = json.dumps(runs, separators=(",", ":"))
        return token

    text = json.dumps(stash(obj), indent=2)
    for token, compact in holders.items():
        text = text.replace(json.dumps(token), compact)
    with open(os.path.join(OUT, path), "w") as fh:
        fh.write(text + "\n")


SCHEMA_NOTE = (
    "Hand-derived expected values; see README.md and tools/derive_fixtures.py. "
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
        "verdict_rule": "window_rel_p95 = p95_active_dbfs - session_floor_dbfs; reached when window_rel_p95 >= cal_margin_db - 1, otherwise not_reached; borderline when |window_rel_p95 - (cal_margin_db - 1)| < 1 (ADR-0001 section 8). All 20 cases are valid phrase windows below the band edge, so each expected verdict is not_reached.",
        "cases": SOFT_CASES,
    },
)
print(
    f"wrote {len(QUIET_CASES)} quiet-check, {len(VAD_CASES)} vad, {len(WINDOW_CASES)} window, "
    f"{len(SOFT_CASES)} soft-window fixtures; oracle matched every hand-derived value"
)

"""Independent re-implementation ("oracle") of the ADR-0001 rules as amended by revision 2.

This is NOT a port of the TypeScript package. It is written from the ADR text and the
AMENDMENTS-REV2 decisions (A1-01 .. A1-07, PK-06) and is used only by derive_fixtures.py to check
the hand-derived expected values before any fixture is written.

Rules implemented
  VAD       a segment opens on a finite frame with rel >= 10 dB; once open, frames with rel >= 6 dB
            are candidates; fewer than 6 consecutive non-candidate frames are bridged; accepted iff
            >= 4 candidate frames in total AND a run of >= 3 consecutive candidate frames; missing
            frames and non-finite frames are non-candidates.
  precheck  floor/p20/p80/p95 (nearest rank) over finite non-clipped frames, quantised to 0.1 dB;
            rules decided on the quantised numbers; priority interrupted > nonfinite > low_coverage
            > silent_input > clipped > unstable_floor > burst_noise > too_loud (pre_window: no
            unstable_floor, no too_loud).
  window    accepted-active frames = candidate frames inside accepted segments; active_ms spans
            bridged gaps; no_voice per kind; continuous_sound needs no offset; quantised outputs.
  quantise  Math.round semantics (an exact tie rounds toward +infinity), dB to 0.1, coverage to
            0.001 (clamped to 0..1), milliseconds to integers.
"""
import math

FRAME_MS = 50
TOL = 1e-9


# --------------------------------------------------------------------------------------------
# quantisation (same semantics as @atr/protocol quantizeDb / quantizeCoverage)
# --------------------------------------------------------------------------------------------
def js_round(x):
    """Math.round: nearest integer, ties toward +infinity."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def snap(x, scale):
    r = js_round(x * scale) / scale
    return 0.0 if r == 0 else r


def quantize_db(x):
    return snap(x, 10)


def quantize_coverage(x):
    q = snap(x, 1000)
    return 0.0 if q < 0 else (1.0 if q > 1 else q)


def quantize_ms(x):
    r = js_round(x)
    return 0 if r == 0 else r


# --------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------
def expand(runs):
    """[db, n] finite, [db, n, 'clipped'], [None, n] non-finite, ['gap', n] missing frames."""
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
    """Nearest rank: sorted[ceil(k*n/100) - 1], integer arithmetic for the ceiling."""
    n = len(values)
    if n == 0:
        return None
    s = sorted(values)
    rank = -((-k * n) // 100)
    return s[max(0, min(n - 1, rank - 1))]


# --------------------------------------------------------------------------------------------
# VAD
# --------------------------------------------------------------------------------------------
def oracle_vad(frames, floor):
    """Returns (segments, rejected_count, last_segment_unterminated, candidate_frame_indices)."""
    by = {f["index"]: f for f in frames}
    if not by:
        return [], 0, False, set()
    lo, hi = min(by), max(by)
    segs, rejected = [], 0
    cands = set()
    st = {"open": False, "start": None, "last": None, "n": 0, "run": 0, "best": 0, "gap": 0}

    def close():
        ok = st["n"] >= 4 and st["best"] >= 3
        if ok:
            segs.append(
                {
                    "onset_frame": st["start"],
                    "end_frame": st["last"],
                    "onset_ms": st["start"] * FRAME_MS,
                    "end_ms": (st["last"] + 1) * FRAME_MS,
                    "candidate_frames": st["n"],
                    "longest_run": st["best"],
                }
            )
        st.update(open=False, start=None, last=None, n=0, run=0, best=0, gap=0)
        return ok

    nonlocal_rejected = [0]
    for i in range(lo, hi + 1):
        f = by.get(i)
        rel = None if (f is None or not f["finite"]) else f["db"] - floor
        opens = rel is not None and rel >= 10 - TOL
        cont = rel is not None and st["open"] and rel >= 6 - TOL
        if opens or cont:
            if not st["open"]:
                st.update(open=True, start=i, n=0, run=0, best=0)
            st["n"] += 1
            st["run"] += 1
            st["best"] = max(st["best"], st["run"])
            st["last"] = i
            st["gap"] = 0
            cands.add(i)
        else:
            st["run"] = 0
            if st["open"]:
                st["gap"] += 1
                if st["gap"] >= 6:
                    before = len(segs)
                    close()
                    if len(segs) == before:
                        nonlocal_rejected[0] += 1
    unterminated = False
    if st["open"]:
        before = len(segs)
        close()
        if len(segs) > before:
            unterminated = True
        else:
            nonlocal_rejected[0] += 1
    return segs, nonlocal_rejected[0], unterminated, cands


# --------------------------------------------------------------------------------------------
# precheck
# --------------------------------------------------------------------------------------------
def oracle_precheck(purpose, duration_ms, frames, interrupted=False):
    duration = quantize_ms(duration_ms)
    expected = max(0, duration // FRAME_MS)
    finite = [f for f in frames if f["finite"]]
    nonfinite = len(frames) - len(finite)
    clipped = [f for f in finite if f["clipped"]]
    levels = [f["db"] for f in finite if not f["clipped"]]
    exact_cov = 0 if expected == 0 else min(1.0, len(finite) / expected)

    def q(k):
        v = pct(levels, k)
        return None if v is None else quantize_db(v)

    floor, p20, p80, p95 = q(50), q(20), q(80), q(95)
    nf_bad = len(frames) > 0 and nonfinite / len(frames) > 0.05
    burst = p95 is not None and floor is not None and p95 - floor > 10 + TOL
    reason = None
    if interrupted:
        reason = "interrupted"
    elif nf_bad:
        reason = "nonfinite"
    elif exact_cov < 0.9:
        reason = "low_coverage"
    elif floor is not None and floor < -110 - TOL:
        reason = "silent_input"
    elif len(clipped) > 0:
        reason = "clipped"
    elif purpose == "pre_window":
        reason = "burst_noise" if burst else None
    else:
        if p80 - p20 > 6 + TOL:
            reason = "unstable_floor"
        elif burst:
            reason = "burst_noise"
        elif floor > -30 + TOL:
            reason = "too_loud"
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
        "coverage": quantize_coverage(exact_cov),
        "clipped_frames": len(clipped),
        "nonfinite_frames": nonfinite,
        "duration_ms": duration,
    }


# --------------------------------------------------------------------------------------------
# window
# --------------------------------------------------------------------------------------------
def oracle_window(kind, max_ms, floor, runs, finish):
    return oracle_window_frames(kind, max_ms, floor, expand(runs), finish)


def oracle_window_frames(kind, max_ms, floor, frames, finish):
    max_frames = min(700, max_ms // FRAME_MS)
    frames = [f for f in frames if f["index"] < max_frames]
    segs, _rej, unterminated, cands = oracle_vad(frames, floor)
    by = {f["index"]: f for f in frames}
    default = min(max_ms, (max(by) + 1) * FRAME_MS) if by else 0
    duration_raw = max(finish.get("duration_ms", default), default)
    duration_raw = min(duration_raw, max_ms)
    duration = quantize_ms(duration_raw)
    expected = duration // FRAME_MS
    finite = [f for f in frames if f["finite"]]
    nonfinite = len(frames) - len(finite)
    clipped_all = sum(1 for f in finite if f["clipped"])
    exact_cov = 0 if expected == 0 else min(1.0, len(finite) / expected)
    active = []
    for s in segs:
        for i in range(s["onset_frame"], s["end_frame"] + 1):
            f = by.get(i)
            if f is not None and f["finite"] and i in cands:
                active.append(f)
    active_clipped = sum(1 for f in active if f["clipped"])
    spans = [s["end_ms"] - s["onset_ms"] for s in segs]
    active_ms = min(quantize_ms(sum(spans)), duration)
    longest = min(quantize_ms(max(spans)) if spans else 0, active_ms)
    reason = None
    if finish["reason"] == "interrupted":
        reason = "interrupted"
    elif exact_cov < 0.9:
        reason = "low_coverage"
    elif active and active_clipped / len(active) > 0.02 + TOL:
        reason = "clipped"
    elif frames and nonfinite / len(frames) > 0.05:
        reason = "nonfinite"
    elif not segs or (kind == "calibration" and active_ms < 400):
        reason = "no_voice"
    elif kind == "phrase" and duration > 0 and active_ms / duration > 0.95 and unterminated:
        reason = "continuous_sound"
    levels = [f["db"] for f in active]

    def q(k):
        v = pct(levels, k)
        return None if v is None else quantize_db(v)

    return {
        "kind": kind,
        "valid": reason is None,
        "invalid_reason": reason,
        "frame_count": len(frames),
        "expected_frames": expected,
        "coverage": quantize_coverage(exact_cov),
        "active_ms": active_ms,
        "longest_active_ms": longest,
        "segments": len(segs),
        "onset_ms": min(quantize_ms(segs[0]["onset_ms"]), duration) if segs else None,
        "p50_active_dbfs": q(50),
        "p95_active_dbfs": q(95),
        "peak_dbfs": quantize_db(max((f["db"] for f in finite), default=0)) if finite else None,
        "clipped_frames": clipped_all,
        "nonfinite_frames": nonfinite,
        "duration_ms": duration,
    }


def same(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}[{i}]")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        assert abs(a - b) < 1e-9, f"{path}: hand {a} != oracle {b}"
    else:
        assert a == b, f"{path}: hand {a!r} != oracle {b!r}"


# --------------------------------------------------------------------------------------------
# sample-level closed forms (alternating-sign constant-amplitude signals: |x| is the amplitude)
# --------------------------------------------------------------------------------------------
def frame_db_from_events(total_samples, frame_samples, bg_amp, events):
    """Per-frame dB of a signal whose samples are +-bg_amp except inside events (start, length, amp).
    Every sample of a +-A alternating signal squares to A*A, so the frame power is exact in closed form."""
    n_frames = total_samples // frame_samples
    out = []
    for f in range(n_frames):
        lo, hi = f * frame_samples, (f + 1) * frame_samples
        covered = 0
        power = 0.0
        for start, length, amp in events:
            n = max(0, min(hi, start + length) - max(lo, start))
            covered += n
            power += n * amp * amp
        power += (frame_samples - covered) * bg_amp * bg_amp
        out.append(10 * math.log10(power / frame_samples))
    return out


# --------------------------------------------------------------------------------------------
# seeded noise simulation (same generator as the TypeScript test: mulberry32 + Box-Muller)
# --------------------------------------------------------------------------------------------
M32 = 0xFFFFFFFF


def imul(a, b):
    return (a * b) & M32


def mulberry32(seed):
    state = {"a": seed & M32}

    def rnd():
        a = (state["a"] + 0x6D2B79F5) & M32
        state["a"] = a
        t = imul(a ^ (a >> 15), a | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rnd


def make_gauss(rand):
    def gauss():
        u = 0.0
        while u == 0.0:
            u = rand()
        v = rand()
        return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)

    return gauss


def ar1(n, mu, sigma, rho, gauss):
    out = []
    z = gauss()
    k = math.sqrt(1 - rho * rho)
    for _ in range(n):
        z = rho * z + k * gauss()
        out.append(mu + sigma * z)
    return out


CAL_MARGIN_DB = 13  # reference calibration margin used for the false-"reached" figures


def ar1_silent_window_study(sigma, rho, seed, trials, floor_mode="quiet_check"):
    """A silent 8 s phrase window in a noise-only room.

    floor_mode "quiet_check": the room must pass a 100-frame quiet check; the session floor is its emitted
    (quantised) floor_dbfs, so the floor carries estimation error (the conditioned study of this repository).
    floor_mode "estimated_unconditioned": the floor is estimated from a 100-frame quiet check exactly as above but
    rooms that fail the check are NOT rejected (isolates the effect of the floor estimate from the conditioning).
    floor_mode "true_floor": no quiet check, the session floor is the process mean (-70 dBFS), the model of the
    independent T16 review (docs/security/T16_GATE.md, N-05).

    Returns dict(attempts, active, reached): `active` = trials with at least one accepted segment; `reached` =
    trials whose phrase window is valid and whose emitted p95_active_dbfs - floor >= CAL_MARGIN_DB - 1 (the TV rule
    with a calibration margin of 13 dB)."""
    rand = mulberry32(seed)
    gauss = make_gauss(rand)
    valid = attempts = active = reached = 0
    while valid < trials:
        attempts += 1
        if floor_mode in ("quiet_check", "estimated_unconditioned"):
            quiet = [{"index": i, "finite": True, "db": d, "clipped": False} for i, d in enumerate(ar1(100, -70, sigma, rho, gauss))]
            r = oracle_precheck("quiet_check", 5000, quiet)
            if floor_mode == "quiet_check" and not r["valid"]:
                continue
            floor = r["floor_dbfs"]
        else:
            floor = -70.0
        valid += 1
        window = [{"index": i, "finite": True, "db": d, "clipped": False} for i, d in enumerate(ar1(160, -70, sigma, rho, gauss))]
        w = oracle_window_frames("phrase", 8000, floor, window, {"reason": "complete"})
        if w["segments"] > 0:
            active += 1
        if w["valid"] and w["p95_active_dbfs"] is not None and (w["p95_active_dbfs"] - floor) >= CAL_MARGIN_DB - 1 - TOL:
            reached += 1
    return {"attempts": attempts, "active": active, "reached": reached}

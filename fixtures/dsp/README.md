# DSP fixtures (arithmetic only)

These JSON files are inputs and hand-derived expected outputs for `@atr/phone-mic-meter`
(ADR-0001). They prove **arithmetic and state-machine behaviour** only. They are **not
measurements** of any microphone, phone, browser or room, and no accuracy claim follows from
them. Real-device behaviour is the subject of the frozen experiment in
`docs/evaluation/T04-protocol.md` (not yet executed).

## Provenance

- Every expected value was derived **by hand** from ADR-0001 by reasoning about the structure of
  each fixture. The `derivation` string in each case shows the arithmetic (nearest-rank indices,
  segment spans, thresholds).
- `tools/derive_fixtures.py` holds those hand-derived literals **and** a second, independent
  Python implementation of the ADR rules (the "oracle"; it is not a port of the TypeScript). The
  script refuses to write the JSON unless the oracle reproduces every hand-derived literal.
- `packages/phone-mic-meter/test/fixtures.test.ts` then runs the shipped TypeScript against the
  JSON. No expected value is produced by the code under test.
- To regenerate: `python3 fixtures/dsp/tools/derive_fixtures.py` (repository root). The output
  is deterministic.

## Files

| File | Cases | What it checks |
|---|---|---|
| `quiet-check.json` | 22 | `summarizePrecheck`: quiet-check and pre-window validity at every boundary (p80 - p20 = 6 vs 6.01, p95 - floor = 10 vs 10.01, floor -30 vs -29.99, coverage 0.90 vs 0.89, clipped, non-finite 5 % vs 6 %), reason priority, pre-window scope |
| `vad.json` | 14 | `VoiceActivityTracker`: 100 / 150 ms rejected, 200 ms accepted with backdated onset, 5-frame gap bridged vs 6-frame gap ends, hangover end time, multiple segments and longest run, open segment at finish, +6.00 vs +5.99 dB threshold, non-finite frames and dropouts |
| `windows.json` | 19 | `WindowAccumulator.finish`: every validity rule and boundary (no_voice, active_ms 350 vs 400, coverage, clipped 2 % vs 4 %, non-finite 5 % vs 5.6 %, continuous_sound 95 % vs 97.5 % and the offset condition, interrupted), accepted-active-frame definition |
| `soft-windows.json` | **20** | Phrase windows that are valid but whose accepted-active p95 is below the band edge (`cal_margin - 1`). Each gives the session floor, the calibration margin, the expected phone-side window summary and the expected verdict `not_reached` |

## Run encoding

Each case has `runs`, a compact description of the frame sequence (50 ms frames, 48 kHz timing,
so `t_audio_ms = frame_index * 50`):

| Run | Meaning |
|---|---|
| `[db, n]` | `n` finite frames at `db` dBFS |
| `[db, n, "clipped"]` | `n` finite frames at `db` dBFS, flagged clipped |
| `[null, n]` | `n` non-finite frames (NaN or Infinity in the samples) |
| `["gap", n]` | `n` frames missing from the sequence (the frame index advances; nothing is pushed) |

A frame is defined by its RMS level only. Its peak is defined equal to its RMS (a
constant-amplitude frame), so `peak_dbfs` equals the highest finite frame level.
Frame order does not matter for statistics; the tests shuffle frames elsewhere.

## Soft-window fixtures and the TV verdict

`soft-windows.json` is the input set for the zero-false-"reached" check on independent
arithmetic fixtures. For each case:

- `session_floor_dbfs`, `cal_margin_db`, `band_edge_rel_db` (= `cal_margin_db - 1`)
- `runs` and `finish` (inputs to the phone-side window summary)
- `expected_window` (the expected `WindowResultPayload`)
- `expected_window_rel_p95_db` (= `p95_active_dbfs - session_floor_dbfs`)
- `expected_verdict` (always `not_reached`) and `expected_borderline` (`|rel_p95 - band_edge| < 1`)

The authoritative verdict function (ADR-0001 section 8) belongs to `@atr/session-core`. It must
be run over these inputs separately and must return `not_reached` for all 20, with the stated
borderline flag. The TypeScript fixture test here only checks the same arithmetic locally
(`rel_p95 >= edge` is false) and checks the phone-side summary; it does not replace the TV
verdict test. These are fixtures: "0 of 20 false reached" on them says nothing about live
noise, other speakers or real microphones, which T04 and later trials must report separately.

The 20 cases vary the floor (-72 to -40 dBFS), the calibration margin (13 to 25 dB), and the
shape of the soft speech: uniform, rising, decaying, two words, bridged word gaps of 3, 4 and 5
frames, a 5 % loud spike (nearest-rank skips it), a rejected 150 ms loud transient, a 3-frame
dropout inside speech, frames exactly +6.00 dB above the floor, borderline values 0.01, 0.5 and
0.99 dB under the edge, and a value exactly 1.00 dB under the edge (not borderline).

## Definitions fixed by these fixtures (where ADR-0001 leaves room)

These are documented in `docs/MEASUREMENT.md` and pinned by the tests; reviewers should confirm
them:

- **Accepted-active frames** are the finite frames inside the span of an accepted segment, from
  its onset frame to its last candidate frame inclusive. Bridged gaps of at most 250 ms are
  inside the span; rejected segments contribute nothing.
- `clipped_frames` reports every clipped frame in the window; the `clipped` validity rule counts
  only clipped frames inside accepted activity (more than 2 % of accepted-active frames).
- `frame_count` is frames received (finite or not); coverage is finite frames over
  `expected_frames = floor(duration_ms / 50)`.
- The non-finite rule uses frames received as the denominator (more than 5 %), for windows and
  prechecks alike.
- Invalid-reason priority is the order of ADR-0001 (windows: low_coverage, clipped, nonfinite,
  no_voice, continuous_sound; quiet check: low_coverage, clipped, unstable_floor, burst_noise,
  too_loud, nonfinite) with `interrupted` first.
- `continuous_sound` needs both "active more than 95 % of the window" and "no offset observed"
  (the last accepted segment was still open when the window closed).
- A 1e-9 dB tolerance protects comparisons that sit exactly on a threshold from binary rounding.

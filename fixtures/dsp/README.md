# DSP fixtures (arithmetic only)

These JSON files are inputs and hand-derived expected outputs for `@atr/phone-mic-meter`
(ADR-0001 as amended by `docs/adr/AMENDMENTS-REV2.md`, revision 2). They prove **arithmetic and
state-machine behaviour** only. They are **not measurements** of any microphone, phone, browser or
room, and no accuracy claim follows from them. Real-device behaviour is the subject of the frozen
experiment in `docs/evaluation/T04-protocol.md` (revision 2, not yet executed).

## Provenance

- Every expected value was derived **by hand** from ADR-0001 and the revision 2 amendments by
  reasoning about the structure of each fixture. The `derivation` string in each case shows the
  arithmetic (nearest-rank indices, segment spans, thresholds) and says what changed from
  revision 1.
- `tools/oracle.py` is a second, independent Python implementation of the same rules (the
  "oracle"; it is not a port of the TypeScript). `tools/derive_fixtures.py` holds the hand-derived
  literals and refuses to write the JSON unless the oracle reproduces every one of them.
- `packages/phone-mic-meter/test/fixtures.test.ts` runs the shipped TypeScript against the JSON.
  No expected value is produced by the code under test. The one Monte-Carlo fixture
  (`vad-ar1-noise.json`) records the oracle's counts; the TypeScript test regenerates the same
  seeded trials with its own implementation and reproduces every count exactly.
- To regenerate: `python3 fixtures/dsp/tools/derive_fixtures.py` (repository root, about 20 s).
  The output is deterministic.
- `tools/freeze_hash.py` prints the T04 freeze values (A9-04); it writes nothing.

## Files

| File | Cases | What it checks |
|---|---|---|
| `quiet-check.json` | 39 | `summarizePrecheck`: quiet-check and pre-window validity at every boundary on the 0.1 dB grid (p80 - p20 = 6.0 vs 6.1, p95 - floor = 10.0 vs 10.1, floor -30.0 vs -29.9, silent_input at -110.0 vs -110.1, coverage 0.90 vs 0.89, clipped, non-finite 5 % vs 6 %), rounding (raw 6.04 is valid, raw 6.06 is not), the reason priority and the pre-window reason set |
| `vad.json` | 21 | `VoiceActivityTracker` (frame level): open +10 / continue +6 hysteresis, accepted iff >= 4 candidates and a run of >= 3, click trains and pairs, hangover and gaps, onset is the opening frame, non-finite frames and dropouts |
| `windows.json` | 27 | `WindowAccumulator.finish`: every validity rule and boundary, no_voice per kind, accepted-active frames, rounding of emitted values |
| `soft-windows.json` | **20** | Phrase windows that are valid but whose accepted-active p95 is below the band edge (`cal_margin - 1`); expected verdict `not_reached` |
| `vad-phase-sweep.json` | 12 conditions x 40 offsets | Sample-level sweep (A1-01): 100 / 125 / 150 / 175 / 200 / 250 ms bursts at +10 and +20 dB over 40 sub-frame offsets |
| `vad-click-train.json` | 19 | Sample-level click trains (A1-02), plus positive controls |
| `vad-ar1-noise.json` | 6 models x 10,000 rooms | Seeded AR(1) noise at and below the edge of quiet-check validity, silent 8 s window (A1-03) |

## Run encoding (quiet-check, vad, windows, soft-windows)

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

## Everything is on the protocol revision 4 grid

All expected dB values are multiples of 0.1 and every coverage a multiple of 0.001, so each
expected payload can travel on the wire (`fixtures.test.ts` validates every quiet-check, window and
soft-window expectation with `validateMessageObject`). The soft windows therefore use boundary
distances of whole tenths of a dB (0.1, 0.5, 0.9, 1.0, 1.2, ...). Raw inputs that are off the grid
are used only where the test is about rounding (`qc-03b`, `qc-05b`, `qc-07b`, `qc-s4`, `qc-s5`,
`win-20`, `win-22`).

## What changed from revision 1, and why

| Rule | Revision 1 | Revision 2 | Fixtures affected |
|---|---|---|---|
| Candidate / open | candidate at +6 dB | open at +10 dB, continue at +6 dB (A1-03) | all VAD, window and soft fixtures: speech must reach +10 dB; `vad-09..14`, `win-21`, `soft-01/05/06/11/13/15/16/20` |
| Acceptance | >= 4 candidate frames | >= 4 candidate frames and a run of >= 3 (A1-02) | `vad-15..17`, click trains |
| 100 / 150 ms claim | "transients are rejected" | <= 100 ms never; 125 - 175 ms phase dependent (A1-01) | `vad-02` (frame-aligned only), phase sweep |
| `no_voice` | `active_ms < 400` for phrase and calibration | phrase and vowel: no accepted segment; calibration keeps `< 400` (A1-04) | `win-04`, `win-04b`, `win-04c` |
| Silent input | not checked | floor below -110 dBFS is `silent_input` (A1-05) | `qc-s1..s8`, `qc-s6` for pre_window |
| Pre-window reasons | any | interrupted, nonfinite, low_coverage, silent_input, clipped, burst_noise only (A1-06) | `qc-16`, `qc-23` |
| Priority | low_coverage first | interrupted > nonfinite > low_coverage > silent_input > clipped > unstable_floor > burst_noise > too_loud (A1-07) | `qc-12b`, `qc-s7`, `qc-s8`, `qc-23..26` |
| Accepted-active frames | all finite frames in the segment span | candidate frames inside accepted segments; gaps excluded (A1-07) | `win-10b`, `win-19`, `soft-10`, `soft-20` |
| Emitted values | full precision | dB to 0.1, coverage to 0.001, ms integers (PK-06); the dB rules are decided on emitted values | `qc-03b/c`, `qc-05b`, `qc-07b`, `win-08`, `win-12`, `win-20`, `win-22`, `soft-03/04/16/18` |

Soft window changes in one line each: 01 (+8 dB would now be `no_voice`) became +10 dB; 03, 04 and 18
moved off 0.01 dB steps (-48.99 -> -48.9, -48.01 -> -48.1, -40.01 -> -40.1: the old values would be
emitted as -49.0 = exactly 1.0 under the edge, -48.0 = exactly the edge (reached) and -40.0 = exactly
the edge); 05, 06, 11, 13, 15, 16, 20 were raised so that an opening frame at +10 dB exists; 16's
coverage 0.98125 is emitted as 0.981. 02, 07, 08, 09, 12, 14, 17, 19 are unchanged.

## Soft-window fixtures and the TV verdict

`soft-windows.json` is the input set for the zero-false-"reached" check on independent
arithmetic fixtures. For each case:

- `session_floor_dbfs`, `cal_margin_db`, `band_edge_rel_db` (= `cal_margin_db - 1`)
- `runs` and `finish` (inputs to the phone-side window summary)
- `expected_window` (the expected `WindowResultPayload`)
- `expected_window_rel_p95_db` (= `p95_active_dbfs - session_floor_dbfs`)
- `expected_verdict` (always `not_reached`) and `expected_borderline` (`|rel_p95 - band_edge| < 1`)

The authoritative verdict function (ADR-0001 section 8) belongs to `@atr/session-core`. As a
cross-check at the time of writing, its `evaluateWindow('phrase', expected_window, floor,
cal_margin)` returned `not_reached` with the stated borderline flag for all 20 (a scratch run,
not a test in this repository). The TypeScript fixture test here only checks the same arithmetic
locally and checks the phone-side summary; it does not replace the TV verdict test. These are
fixtures: "0 of 20 false reached" on them says nothing about live noise, other speakers or real
microphones, which T04 and later trials must report separately.

## Findings recorded by the sample-level fixtures

**A 200 ms burst is not always accepted at +10 dB (contradicts the wording of A1-01).**
`vad-phase-sweep.json` accepted-phase counts (of 40 sub-frame offsets):

| Burst | +10 dB | +20 dB |
|---|---|---|
| 100 ms | 0 | 0 |
| 125 ms | 0 | 15 |
| 150 ms | 0 | 35 |
| 175 ms | 7 | 40 |
| 200 ms | **27** | 40 |
| 250 ms | 40 | 40 |

Hard ends that hold (asserted, each with a hand derivation in the fixture): never at 100 ms or
less; always at 250 ms at both levels; always at 200 ms at +20 dB. At +10 dB a 200 ms burst is
rejected when the leading partial frame (which cannot open a segment) takes most of the burst:
27 of 40 phases are accepted. The recorded rates are not requirements. Options if the amendment's
"200 ms always" is wanted at +10 dB: count the frame immediately before the opening frame when it
is at or above +6 dB, or open at a lower level (with the noise cost below).

**The 1 % false-activity target (A1-03) is not met at the edge of quiet-check validity.**
`vad-ar1-noise.json`, rooms that pass the quiet check, silent 8 s phrase window, 10,000 rooms per
model, P(at least one accepted segment):

| sigma / rho | 2.0 / 0.9 | 2.5 / 0.5 | 2.5 / 0.8 | 3.0 / 0.8 | 3.5 / 0.5 | 3.5 / 0.9 |
|---|---|---|---|---|---|---|
| P(active) | 0.03 % | 0.00 % | 0.45 % | 4.4 % | 3.5 % | 16.5 % |
| meets 1 % | yes | yes | yes | **no** | **no** | **no** |

The quiet check admits noise up to sigma of about 3.56 dB (`p80 - p20 = 1.683 sigma <= 6`), so the
bottom three models are the edge. The model is synthetic (Gaussian per-frame dB with AR(1)
correlation), not measured room noise. Alternatives, from `tools/ar1_threshold_comparison.mjs`
(same acceptance rule, 10,000 rooms per cell, seed 7; open threshold O, continuation C, quiet-check
stability limit S):

| sigma / rho | spec O10/C6, S6 | O12/C6, S6 | O12/C8, S6 | O10/C8, S6 | O10/C6, S4 | O12/C6, S4 | O12/C8, S4 |
|---|---|---|---|---|---|---|---|
| 2.5 / 0.9 | 0.99 % | 0.09 % | 0.09 % | 0.67 % | 0.92 % | 0.07 % | 0.07 % |
| 3.0 / 0.8 | 4.04 % | 0.74 % | 0.36 % | 1.62 % | 3.93 % | 0.58 % | 0.32 % |
| 3.0 / 0.9 | 5.84 % | 0.97 % | 0.80 % | 3.77 % | 5.83 % | 0.88 % | 0.74 % |
| 3.5 / 0.5 | 3.15 % | 0.72 % | 0.10 % | 0.50 % | 2.85 % | 0.66 % | 0.10 % |
| 3.5 / 0.8 | 14.29 % | 4.06 % | 2.49 % | 7.00 % | 14.03 % | 3.75 % | 2.14 % |
| 3.5 / 0.9 | 16.97 % | 5.16 % | 4.36 % | 11.82 % | 16.29 % | 4.53 % | 3.85 % |

Tightening the stability limit to 4 dB barely helps (the rooms that still pass are lucky samples of a
noisy process); opening at 12 dB helps most but raises the voice level a quiet speaker must reach and
the 13 dB calibration margin stays only 1 dB above it. T04 traces must re-tune these numbers; the
decision is the lead's.

## Definitions fixed by these fixtures (where the ADR leaves room)

These are documented in `docs/MEASUREMENT.md` and pinned by the tests; reviewers should confirm them:

- `clipped_frames` reports every clipped frame in the window; the `clipped` validity rule counts
  only clipped accepted-active frames, as a fraction of accepted-active frames.
- `frame_count` is frames received (finite or not); coverage is finite frames over
  `expected_frames = floor(duration_ms / 50)`; an explicit duration shorter than the audio already
  received is raised to it, and emitted `active_ms` never exceeds `duration_ms`.
- The non-finite rule uses frames received as the denominator (more than 5 %), for windows and
  prechecks alike.
- Window reason priority is interrupted, low_coverage, clipped, nonfinite, no_voice,
  continuous_sound (the window order of ADR-0001 section 6; A1-07's list is for prechecks).
- `continuous_sound` needs both "active more than 95 % of the window" and "no offset observed"
  (the last accepted segment was still open when the window closed).
- A 1e-9 dB tolerance protects comparisons that sit exactly on a threshold from binary rounding.
- Quantisation ties round toward +infinity (`Math.round`), exactly like `quantizeDb` in
  `@atr/protocol` (its own test states "half rounds toward +infinity"). The rework instruction
  described the semantics as "half away from zero", which differs only at exact negative ties
  (-42.25 gives -42.2, not -42.3); the local helpers follow the protocol package so the two can never
  disagree, and `protocol-conformance.test.ts` compares them on 40,000 values.

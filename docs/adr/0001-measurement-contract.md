# ADR-0001: Measurement contract (relative digital level, voice activity, calibration, gates)

- Status: accepted (frozen for implementation, revision 1)
- Date: 2026-10-05
- Deciders: Opus lead
- Supersedes: `research/_working/spec_FTV-4.md` §5.3 formulas where they conflict

## Context

The product measures relative digital amplitude reaching a phone microphone placed beside the TV. The inherited specification had four internal conflicts (calibration accepted at 6 dB while the noise gate required 10 dB; VAD onset after 100 ms while 200 ms transients had to be rejected; a pre-window floor that needed between-window samples although samples may only leave the phone during windows; an "AGC cannot corrupt duration" claim). This ADR resolves them. Every constant is a **product assumption** pending real-device evidence (T04/T04A). None of these numbers is a measured accuracy.

## Decision

### 1. Signal and numeric convention

- Input: mono Float32 PCM from the browser audio graph (AudioWorklet primary path). Raw samples never leave the analysis module, are never stored and are discarded after each frame is reduced.
- Frame: contiguous block of `round(sampleRate × 0.050)` samples (2400 at 48 kHz, 2205 at 44.1 kHz). Frames are counted by samples, so the frame clock is the audio sample clock, not a timer.
- Frame time: `t_audio_ms = (firstSampleIndexOfFrame / sampleRate) × 1000`, relative to the start of the window (or precheck). A scheduled UI rate is never used as a clock.
- Non-finite samples: if any sample in a frame is NaN or ±Infinity, the frame is **non-finite** and excluded from statistics; it counts against coverage.
- RMS: `rms = sqrt(mean(x²))` over the frame.
- Level: `dbfs = 20 × log10(max(rms, 1e-7))`, so the numerical floor is −140 dBFS. Values are clamped to the range [−140, +20] dBFS (samples can exceed ±1.0 in some graphs).
- Clipping: a sample is clipped when `|x| ≥ 0.999`. A frame is clipped when at least 0.5 % of its samples are clipped.
- Display smoothing is separate. The TV may smooth levels for the arc; scoring uses only unsmoothed frame values reduced on the phone.

### 2. Quiet-room check (session floor)

- Duration 5000 ms. Commanded by the TV (`precheck.start`, purpose `quiet_check`).
- Statistics over finite, non-clipped frames: `floor = median`, `p20`, `p80`, `p95` (nearest-rank percentiles, see §7).
- Valid when all hold: coverage ≥ 0.90; zero clipped frames; `p80 − p20 ≤ 6 dB` (stable); `p95 − floor ≤ 10 dB` (no bursts); `floor ≤ −30 dBFS` (not a loud room).
- Invalid reasons: `low_coverage`, `clipped`, `unstable_floor`, `burst_noise`, `too_loud`, `nonfinite`.

### 3. Voice activity (VAD) — provisional versus accepted

Thresholds are relative to the **session floor** sent by the TV in `window.start` (`vad_floor_dbfs`). Relative level `rel = dbfs − session_floor`.

- Candidate frame: `rel ≥ 6 dB` and the frame is finite.
- Provisional onset: the first candidate frame after an inactive period. Provisional activity is only for display (`active` flag on live level frames).
- Hangover: a segment continues through runs of fewer than 6 consecutive non-candidate frames (≤ 250 ms gap is bridged; the 6th consecutive non-candidate frame, i.e. 300 ms, ends it). The segment ends at the end of its last candidate frame.
- Accepted segment: a segment is accepted only if it contains **at least 4 candidate frames (200 ms of candidate activity)**. Its onset is backdated to its provisional onset. Shorter segments (for example 100 ms or 150 ms transients) are rejected and contribute nothing.
- Durations: `active_ms` = sum over accepted segments of (segment end − onset). `longest_active_ms` = the longest accepted segment.
- This does **not** classify coughs or identify voices. A 200 ms or longer cough, music, or another speaker can be accepted. Duration can still be altered by gain control, noise and voice quality; it is less dependent on absolute calibration, not immune to processing.

### 4. Calibration (per-session band)

- Window kind `calibration`, maximum 6000 ms.
- Valid when: window statistics valid (§6) and `active_ms ≥ 400` and `cal_margin ≥ 13 dB`, where `cal_margin = p95(rel over accepted-active frames)`.
- If `cal_margin < 13 dB` the band is not set: "Too quiet to set today's band. Try once more from your seat, or check the phone is on its mark."

### 5. Pre-window gate (precheck before each window)

- Duration 2000 ms, commanded (`precheck.start`, purpose `pre_window`). The phone returns one aggregate; no level frames are sent.
- `rise = pre_floor − session_floor`.
- Block the window ("The room is noisier than when we set today's band") when `rise ≥ 6 dB` **or** `cal_margin − rise < 10 dB`, or the precheck itself is invalid (coverage, clipping, non-finite, burst rule `p95 − pre_floor > 10 dB`).
- **Coherence property (tested):** because an accepted calibration has `cal_margin ≥ 13 dB`, an unchanged room (`rise ≤ 3 dB`) never blocks. `13 − 3 = 10`. No accepted calibration can inherently block every later window.

### 6. Window validity and summary (calibration, vowel, phrase)

Computed on the phone over the frames captured between `window.start` and `window.stop` (or the maximum duration):

- `coverage = finite_frames / expected_frames`, where `expected_frames = floor(duration_ms / 50)`.
- Invalid when: coverage < 0.90 (`low_coverage`); clipped frames > 2 % of accepted-active frames (`clipped`); any non-finite frames > 5 % of frames (`nonfinite`); no accepted activity or `active_ms < 400` for calibration/phrase (`no_voice`); for phrase windows, accepted activity covers > 95 % of the window with no offset (`continuous_sound`); capture interrupted (`interrupted`).
- Summary fields: `p50_active_dbfs`, `p95_active_dbfs` (over accepted-active frames), `peak_dbfs`, `active_ms`, `longest_active_ms`, `segments`, `onset_ms`, `frame_count`, `expected_frames`, `coverage`, `clipped_frames`, `nonfinite_frames`, `duration_ms`.

### 7. Percentiles

Nearest-rank: sort ascending; `p_k = sorted[ceil(k/100 × n) − 1]` for n ≥ 1. Median is p50 by the same rule. Empty sets have no percentile (window invalid).

### 8. Verdict (TV, authoritative)

- `window_rel_p95 = p95_active_dbfs − session_floor`.
- `reached` when `window_rel_p95 ≥ cal_margin − 1 dB`; otherwise `not_reached`. Invalid windows are `unscored` with their reason.
- `borderline` flag when `|window_rel_p95 − (cal_margin − 1)| < 1 dB`. Borderline results keep their verdict and are reported separately.
- Wording: "Reached today's relative level band" / "Below today's relative level band". Never "loud enough", "heard", dB SPL or clinical language.

### 9. Sustained vowel

- Optional, kind `vowel`, maximum 30000 ms, early stop and cancel allowed. Primary metric `longest_active_ms` (labelled "voice-activity duration"; not vowel recognition). A relative-band verdict is shown only when a valid calibration exists.

### 10. Cross-session comparisons

- Disabled. No automatic target increase, no cross-day loudness comparison, no dB trend chart. History shows counts and durations per day only. A monotonicity or tone test does not enable cross-day comparison (see ADR-0009).

## Consequences

- Calibration acceptance is stricter than the inherited 6 dB rule; quiet-voiced speakers at 2.5–3 m may fail to set a band. This is reported honestly ("Too quiet to set today's band") and is a T04 evidence question.
- The constants live in one module (`packages/phone-mic-meter/src/constants.ts`) and in the TV verdict module; tests cover every boundary in this ADR.

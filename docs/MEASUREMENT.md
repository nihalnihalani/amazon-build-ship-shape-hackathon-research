# What Across the Room measures

Status: documentation of ADR-0001 as amended by `docs/adr/AMENDMENTS-REV2.md` (revision 2), as
implemented by `@atr/phone-mic-meter`.
Every number below is a **product assumption** pending real-device evidence (T04 / T04A). None
of it is a measured accuracy.

## In one paragraph

A phone placed beside the TV listens through its microphone while a person speaks from across the
room. The phone turns the sound into a stream of numbers, one level every 50 milliseconds, and
compares them with how quiet the room was a moment earlier. The TV shows whether, **today, in
this room, with this phone in this spot**, the person's voice reached the band they set during
their own calibration. The audio itself never leaves the phone, is never saved, and is discarded
as each 50 ms frame is reduced to a single number.

## What the number is

- **A relative digital level at the phone's microphone**, in dBFS ("decibels relative to digital
  full scale"). 0 dBFS is the loudest value the phone's digital audio can represent; quieter
  signals are negative numbers. The number is the strength of the digital signal after the
  browser, the operating system and the microphone hardware have processed it, so it depends on
  the phone's gain and processing as well as on the sound.
- **Relative to a floor measured on the same phone minutes earlier.** The TV reports "how many dB
  above the room's quiet floor", not an absolute loudness.
- **Per session only.** A new session sets a new floor and a new band. Results are not compared
  across days.

## What the number is not

- **Not dB SPL.** It does not tell you how loud the sound is in the room or at anyone's ear. A
  phone's microphone, gain and the TV's own speaker are not calibrated references.
- **Not whether anyone heard or understood.** It is not intelligibility, comprehension, audibility
  or a hearing threshold. The household's own "Heard / Not heard" answer is a separate, subjective
  check and is reported separately.
- **Not who is speaking, or what they said.** Voice activity is detected from level alone. A cough
  of 200 ms or more, music, television speech or a second speaker can be accepted as activity.
- **Not a clinical or diagnostic outcome**, and not a basis for advice about a person's health.
- **Not a cross-day trend.** Loudness targets never rise automatically and there is no day-to-day
  dB chart. Qualifying a phone with a tone test does not change that.

## How a level is computed

All formulas run on the phone, on the audio sample clock, with no raw audio kept.

| Step | Rule |
|---|---|
| Frame | `round(sampleRate * 0.050)` samples: 2400 at 48 kHz, 2205 at 44.1 kHz. Frames are counted by samples, never by a timer. |
| Frame time | `t_audio_ms = firstSampleIndexOfFrame / sampleRate * 1000`, from the start of the window or precheck. |
| RMS | `rms = sqrt(mean(x^2))` over the frame's samples. |
| Level | `dbfs = 20 * log10(max(rms, 1e-7))`, clamped to the range -140 to +20. Digital silence reads -140. |
| Clipping | A sample is clipped when `abs(x) >= 0.999`. A frame is clipped when at least 0.5 % of its samples are clipped. |
| Non-finite | If any sample is NaN or infinite, the whole frame is non-finite: it is excluded from every statistic and counts against coverage. |
| Display | The arc on the TV may be smoothed for readability. Scoring uses only the unsmoothed per-frame values. |
| Rounding of emitted numbers | Everything the phone sends is rounded first (PK-06): dB values to 0.1 dB, coverage to 0.001, milliseconds to whole numbers; an exact tie rounds toward +infinity (-42.25 becomes -42.2). Rules that compare dB values (the quiet-check limits, the silent-input limit) are decided on the rounded numbers, so a receiver that recomputes them from the message gets the same answer. Counts and fractions (coverage, clipped and non-finite frames) are decided on the exact counts. |

Worked example: a steady sine wave of amplitude 0.5 has `rms = 0.5 / sqrt(2) = 0.3536`, so
`dbfs = 20 * log10(0.3536) = -9.03`. A signal of constant value 0.1 is exactly -20 dBFS.

## Percentiles

Nearest rank: sort the values ascending and take `sorted[ceil(k/100 * n) - 1]`. The median is the
50th percentile by the same rule (for an even count it is the lower middle value). An empty set
has no percentile.

## The session floor: the quiet-room check

Five seconds (100 frames) while the room is quiet. Using only finite, non-clipped frames:
`floor` is the median, with `p20`, `p80` and `p95` alongside (all rounded to 0.1 dB). The check is
**valid** only if none of these fires; when several do, the reason reported is the first listed
(top to bottom):

| Reason | Rule |
|---|---|
| `interrupted` | the capture was interrupted |
| `nonfinite` | non-finite frames exceed 5 % of the frames received (evaluated before coverage) |
| `low_coverage` | finite frames / expected frames below 0.90 |
| `silent_input` | `floor` below -110 dBFS: the microphone looks muted or blocked (digital silence used to pass the older rules) |
| `clipped` | any clipped frame |
| `unstable_floor` | `p80 - p20` above 6 dB |
| `burst_noise` | `p95 - floor` above 10 dB |
| `too_loud` | `floor` above -30 dBFS |

Boundary values are valid (exactly 6.0 dB is stable, exactly -30.0 dBFS is quiet enough, exactly
-110.0 dBFS is not silent); one step of 0.1 dB beyond is not.

The **pre-window check** (2 seconds, 40 frames, before each window) uses a shorter list because the
TV judges the floor's rise and the margin itself: `interrupted`, `nonfinite`, `low_coverage`,
`silent_input`, `clipped` and `burst_noise`, in that order. It never reports `unstable_floor` or
`too_loud`.

## Voice activity (level-based, not a voice classifier)

Relative level `rel = dbfs - session floor`.

1. A segment **opens** on a finite frame with `rel >= 10 dB`. Frames between +6 and +10 dB do
   nothing while no segment is open, so a room whose noise wanders a few dB above the floor does
   not start one.
2. Once open, a finite frame with `rel >= 6 dB` is a **candidate** (continuation). The opening frame
   is the **provisional onset**; provisional activity is shown live for display only.
3. A segment **continues** through quiet runs of fewer than 6 consecutive non-candidate frames
   (up to 250 ms are bridged). The 6th consecutive non-candidate frame (300 ms) **ends** it, and
   the segment ends at the end of its last candidate frame, so the waiting time adds no duration.
4. A segment is **accepted** only with at least 4 candidate frames in total (200 ms of candidate
   activity) **and** a run of at least 3 consecutive candidate frames. The run rule means isolated
   clicks never add up: four clicks 100 ms apart are rejected. Rejected segments contribute nothing.
5. Frames missing because of a capture dropout count as non-candidates; non-finite frames too.

What this does and does not guarantee (from the sweep in `fixtures/dsp/vad-phase-sweep.json`, which
shifts a burst across the 50 ms frame grid in 40 steps):

- A burst of **100 ms or less is never accepted**, at any phase and level.
- A burst of **250 ms or more is always accepted** once it is at least 10 dB above the floor.
- Bursts of **125 - 175 ms are phase- and level-dependent**. For example a 150 ms burst at +20 dB is
  accepted at 35 of 40 phases and at +10 dB at none. Do not read "150 ms is rejected" into this.
- A **200 ms burst** is always accepted at about +20 dB, but at +10 dB only at 27 of 40 phases: the
  frame before the opening frame is never a candidate. This is a finding against the wording of
  amendment A1-01 ("200 ms or more always accepted"), recorded in the fixture.
- **A noisy room can still start a segment, and a silent window can even be scored `reached`.** It is
  very unlikely in a quiet or ordinary room and possible in the noisiest rooms the quiet check admits;
  see "Can a silent window be scored `reached`?" below for the figures. The model is synthetic, not
  measured room noise.

### Can a silent window be scored `reached`?

Yes, but very rarely, and only because room noise can open an accepted segment whose few active frames
happen to reach the band edge. Earlier wording that a silent window "cannot become a false `reached`" was
too strong (independent review finding N-05) and is withdrawn. A silent window is normally `no_voice` or
scored below the band. What can happen: a burst of noise reaches +10 dB over the floor and opens a segment,
stays above +6 dB for at least 4 frames with a run of 3, and the 95th percentile of those few frames (for
5 to 10 frames it is the largest) is at least `cal_margin - 1` (12 dB for the smallest accepted margin of
13 dB). The phone cannot tell this from speech.

Simulated rates, silent 8 s window, calibration margin 13 dB, noise = AR(1) in dB around -70 dBFS with
spread sigma (dB) and correlation rho. The noisiest rooms the quiet check admits have a spread of about
3.5 dB (`p80 - p20 = 1.683 sigma` may be at most 6). Two models, two sets of numbers:

| sigma / rho | Independent review (T16 N-05): floor = true mean, no quiet check. P(accepted segment) / P(scored reached) | This repository: the session floor is the emitted median of a 5 s quiet check that must pass (10,000 rooms). P(accepted segment) / P(scored reached) |
|---|---|---|
| 2.5 / 0.9 | 0.3 % / 0.015 % | 0.95 % / 0.04 % |
| 3.0 / 0.8 | 2.3 % / 0.3 % | 4.4 % / 0.77 % |
| 3.5 / 0.9 | 10.2 % / 2.3 % | 16.5 % / 4.8 % |

The two sets differ in the model, not in the code. With the review's assumption (floor equal to the process
mean, no quiet check) the same trial generator gives 0.27 % / 0.025 %, 2.3 % / 0.34 % and 11.2 % / 2.4 %,
consistent with the review's figures within sampling error. Estimating the floor from a 5 second quiet
check but keeping every room, valid or not, gives 0.72 % / 0.045 %, 4.0 % / 0.69 % and 16.2 % / 4.8 %: that
is, nearly all of the increase comes from the floor estimate (a floor estimated a little too low turns
ordinary noise into frames at +10 dB), and conditioning on a valid quiet check changes the rates very
little (all of it in `vad-ar1-noise.json`, block `t16_comparison`). The conditioned numbers are the more
realistic ones and the higher. Neither is measured noise; T04 traces must replace them. In a room with a
noise spread of 2 dB (2.0 / 0.9) the simulation gave 0.03 % accepted segments and no false `reached` in
10,000 rooms.

Consequences. A scored `reached` after a silent attempt is therefore not impossible: do not describe it as
impossible in any copy. The pre-window check and the quiet check reduce it but cannot remove it, and T04
measures it directly (negative case N8: a silent speaker in the real quiet room, 0 of 10 windows scored
`reached` expected, reported value).

`active_ms` is the sum over accepted segments of (end - onset) and **includes bridged gaps**;
`longest_active_ms` is the longest one. Duration is less dependent on absolute calibration than
level is, but it is **not immune** to gain control, noise and voice quality.

## Windows: calibration, vowel and phrase

A window is the audio between "start" and "stop" (or its maximum: calibration 6 s, phrase 8 s,
vowel 30 s). The phone sends the TV a live level per frame (at most 700 per window) and, at the
end, one summary:

- `frame_count` (frames received), `expected_frames = floor(duration_ms / 50)`,
  `coverage = finite frames / expected frames` (a dropout lowers coverage).
- `active_ms`, `longest_active_ms`, `segments`, `onset_ms`.
- `p50_active_dbfs` and `p95_active_dbfs` over the **accepted-active frames**: the **candidate frames**
  inside accepted segments. Bridged quiet frames inside a segment are excluded from the percentiles
  and from the clipped fraction (but the time they span still counts in `active_ms`).
- `peak_dbfs`: the largest sample magnitude over the whole window, as dBFS.
- `clipped_frames` (every clipped frame), `nonfinite_frames`, `duration_ms`.

A window is **invalid** (and is never scored) when one of these holds; when several do, the first listed
is reported (window order, which differs from the precheck order above):

| Reason | Rule |
|---|---|
| `interrupted` | the capture was interrupted (track ended or muted, audio suspended) |
| `low_coverage` | coverage below 0.90 |
| `clipped` | clipped frames exceed 2 % of accepted-active frames (clipped frames outside accepted activity do not count) |
| `nonfinite` | non-finite frames exceed 5 % of frames received |
| `no_voice` | no accepted segment. Calibration windows also need `active_ms` of at least 400; **phrase and vowel windows need only one accepted segment** (so a one-syllable phrase of 200 ms is scored) |
| `continuous_sound` | phrase windows only: activity covers more than 95 % of the window **and** no offset was observed |

## Calibration, the pre-window gate and the verdict (decided on the TV)

- **Calibration** sets today's band. It is accepted only if the window is valid, `active_ms` is at
  least 400 and `cal_margin >= 13 dB`, where `cal_margin` is the 95th percentile of the accepted
  activity's level above the floor. Otherwise the app says it is too quiet to set today's band.
- **Before each window** a 2 second check measures the floor again. The window is blocked when the
  floor has risen by 6 dB or more, or when `cal_margin - rise < 10 dB`, or when that check is itself
  invalid. Because an accepted calibration has `cal_margin >= 13`, the two margin rules (rise below 6
  dB, margin minus rise at least 10 dB) never block an unchanged room (rise up to 3 dB); whether the
  pre-window check is itself valid is a separate gate (see its reason list above).
- **Verdict:** `reached` when the window's 95th percentile above the floor is at least
  `cal_margin - 1 dB`; otherwise `not_reached`. Invalid windows are `unscored`. Results within
  1 dB of the line are kept but flagged borderline. The wording is "Reached today's relative level
  band" or "Below today's relative level band", never "loud enough" or "heard".

## What leaves the phone

Only levels and flags (one number per 50 ms frame plus two flags, during a window the TV started),
the quiet-check and pre-window summaries, window summaries, typed phrases and cue words, listener
responses, microphone state, and connection details. **Raw audio, samples, waveforms and recordings
never leave the phone and are never stored.** The package contains no recorder, no speech
recognition, no network calls and no storage. Only per-frame numbers (RMS, peak, clipped count and
a non-finite flag) cross from the audio thread to the page.

## Limitations (read before trusting a result)

- **Unqualified.** No physical phone has been qualified yet. Until the frozen T04 experiment
  (`docs/evaluation/T04-protocol.md`, revision 2) is run and reviewed, the app should show "Not yet
  qualified on this phone". The experiment checks that the relative level is monotonic, follows a
  known 12 dB digital step to within 2 dB (a compressing input fails), repeats with an upper
  confidence bound of 1.5 dB on the spread over 15 repeats, and does not clip. Unit tests and
  fixtures prove arithmetic and state handling, not that a microphone behaves.
- **Browser settings are a request, not proof.** The page asks for automatic gain control, echo
  cancellation and noise suppression to be off, and records what the browser reports. A reported
  "off" does not prove the phone's operating system or hardware is not compressing or gating the
  signal. Anything the browser does not report is shown as unknown, never assumed off.
- **Other sounds look like speech.** Level cannot tell a voice from a fan surge, a cough, music,
  television speech or a second person. The pre-window check is a detection aid, not a guarantee.
- **Quiet speakers need a clear peak.** A segment only opens at 10 dB over the floor, so a voice
  that never gets 10 dB above the quiet-room floor is `no_voice`, not a low score. This is the price
  of the noise protection above.
- **Room and placement change the number.** Moving the phone, the speaker's seat, a door or a
  curtain changes the level without any change in the person's voice. That is why the band is per
  session and cross-day comparison is off.
- **Timing precision.** Frames are 50 ms, so onsets and durations are quantized to 50 ms steps. Real
  onset accuracy against an independent reference is unmeasured.
- **Capture can be interrupted.** A locked screen, a phone call, another app using the microphone,
  battery saving or a lost connection can stop capture. The affected window is unscored; stale data
  is never scored later. The wake lock is a request and does not guarantee continued capture.
- **Secure origin and permission are required.** The phone page must be served over HTTPS and the
  user must allow the microphone. Safari does not support the gain-control constraint, so its
  behaviour is a test case, not an assumption.
- **Assumptions, not instruments.** Thresholds (6 and 10 dB, 13 dB, -30 and -110 dBFS, 200 ms, ...) are
  engineering choices, not clinical or regulatory limits, and may change after T04 / T04A.

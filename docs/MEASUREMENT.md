# What Across the Room measures

Status: documentation of ADR-0001 (revision 1) as implemented by `@atr/phone-mic-meter`.
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

Worked example: a steady sine wave of amplitude 0.5 has `rms = 0.5 / sqrt(2) = 0.3536`, so
`dbfs = 20 * log10(0.3536) = -9.03`. A signal of constant value 0.1 is exactly -20 dBFS.

## Percentiles

Nearest rank: sort the values ascending and take `sorted[ceil(k/100 * n) - 1]`. The median is the
50th percentile by the same rule (for an even count it is the lower middle value). An empty set
has no percentile.

## The session floor: the quiet-room check

Five seconds (100 frames) while the room is quiet. Using only finite, non-clipped frames:
`floor` is the median, with `p20`, `p80` and `p95` alongside. The check is **valid** only if all
of these hold:

| Rule | Limit | Reason if broken |
|---|---|---|
| Coverage (finite frames / expected frames) | at least 0.90 | `low_coverage` |
| Clipped frames | none | `clipped` |
| Stable: `p80 - p20` | at most 6 dB | `unstable_floor` |
| No bursts: `p95 - floor` | at most 10 dB | `burst_noise` |
| Not a loud room: `floor` | at most -30 dBFS | `too_loud` |
| Non-finite frames | at most 5 % of frames | `nonfinite` |

Boundary values are valid (exactly 6.00 dB is stable, exactly -30 dBFS is quiet enough); a
hundredth beyond is not. When several rules fail, the reason reported is the first listed above
(coverage first, then clipping, and so on); a capture that was interrupted reports `interrupted`.

## Voice activity (level-based, not a voice classifier)

Relative level `rel = dbfs - session floor`.

1. A frame is a **candidate** when it is finite and `rel >= 6 dB`.
2. The first candidate after silence is the **provisional onset**. Provisional activity is shown
   live for display only.
3. A segment **continues** through quiet runs of fewer than 6 consecutive non-candidate frames
   (up to 250 ms are bridged). The 6th consecutive non-candidate frame (300 ms) **ends** it, and
   the segment ends at the end of its last candidate frame, so the waiting time adds no duration.
4. A segment is **accepted** only with at least 4 candidate frames (200 ms of candidate
   activity). Its onset is **backdated** to the provisional onset. Shorter segments, such as
   100 ms or 150 ms transients, are rejected and contribute nothing.
5. Frames missing because of a capture dropout count as non-candidates; non-finite frames too.

`active_ms` is the sum over accepted segments of (end - onset); `longest_active_ms` is the longest
one. Duration is less dependent on absolute calibration than level is, but it is **not immune** to
gain control, noise and voice quality: automatic gain, noise suppression or a noisy room can move
the detected onset and end.

## Windows: calibration, vowel and phrase

A window is the audio between "start" and "stop" (or its maximum: calibration 6 s, phrase 8 s,
vowel 30 s). The phone sends the TV a live level per frame (at most 700 per window) and, at the
end, one summary:

- `frame_count` (frames received), `expected_frames = floor(duration_ms / 50)`,
  `coverage = finite frames / expected frames` (a dropout lowers coverage).
- `active_ms`, `longest_active_ms`, `segments`, `onset_ms`.
- `p50_active_dbfs` and `p95_active_dbfs` over the **accepted-active frames**: the finite frames
  inside an accepted segment from its onset to its last candidate frame, including bridged gaps.
- `peak_dbfs`: the largest sample magnitude over the whole window, as dBFS.
- `clipped_frames` (every clipped frame), `nonfinite_frames`, `duration_ms`.

A window is **invalid** (and is never scored) when, in this order of reporting:

| Reason | Rule |
|---|---|
| `interrupted` | the capture was interrupted (track ended or muted, audio suspended) |
| `low_coverage` | coverage below 0.90 |
| `clipped` | clipped frames exceed 2 % of accepted-active frames (clipped frames outside accepted activity do not count) |
| `nonfinite` | non-finite frames exceed 5 % of frames received |
| `no_voice` | no accepted segment; for calibration and phrase also `active_ms` below 400 |
| `continuous_sound` | phrase windows only: activity covers more than 95 % of the window **and** no offset was observed |

## Calibration, the pre-window gate and the verdict (decided on the TV)

- **Calibration** sets today's band. It is accepted only if the window is valid, `active_ms` is at
  least 400 and `cal_margin >= 13 dB`, where `cal_margin` is the 95th percentile of the accepted
  activity's level above the floor. Otherwise the app says it is too quiet to set today's band.
- **Before each window** a 2 second check measures the floor again. The window is blocked when the
  floor has risen by 6 dB or more, or when `cal_margin - rise < 10 dB`, or when that check is itself
  invalid. Because an accepted calibration has `cal_margin >= 13`, an unchanged room (rise up to
  3 dB) can never block.
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

- **Unqualified.** No physical phone has been qualified yet. Until the frozen T04 experiment is run
  and reviewed, the app should show "Not yet qualified on this phone". Unit tests and fixtures prove
  arithmetic and state handling, not that a microphone behaves.
- **Browser settings are a request, not proof.** The page asks for automatic gain control, echo
  cancellation and noise suppression to be off, and records what the browser reports. A reported
  "off" does not prove the phone's operating system or hardware is not compressing or gating the
  signal. Anything the browser does not report is shown as unknown, never assumed off.
- **Other sounds look like speech.** Level cannot tell a voice from a fan surge, a cough, music,
  television speech or a second person. The pre-window check is a detection aid, not a guarantee.
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
- **Assumptions, not instruments.** Thresholds (6 dB, 13 dB, -30 dBFS, 200 ms, ...) are engineering
  choices, not clinical or regulatory limits, and may change after T04 / T04A.

# T04 — Physical Android microphone qualification protocol

| | |
|---|---|
| **Status** | **FROZEN, awaiting reviewer approval. NOT EXECUTED. No trial has been run and no result exists.** |
| Protocol revision | 2 (2026-10-05): revision 1 reworked after the independent review (ADR amendments A1-01, A1-03, A9-01, A9-03, A9-04, A9-05). Revision 1 was never approved or executed. |
| Task / requirement | T04, R-Q2 (frozen experiment protocol before trials; randomized repeats; negative cases; full recording fields; failures recorded) |
| Specification | ADR-0001 and ADR-0009 as amended by `docs/adr/AMENDMENTS-REV2.md`, `docs/MEASUREMENT.md` |
| Criteria | Section 8 and `packages/phone-mic-meter/src/qualification.ts` (`analyzeQualification`): the two are frozen together |
| Blocker | B-002: no physical Android phone is available. Until one is, every results cell below stays `pending`. |
| Author role | audio-dsp (writes the protocol only; cannot run it) |
| Reviewer | Opus lead, then qa-accessibility. Approval is recorded in the Approval block at the end. |

**Freeze rule.** No trial may start before (a) the Approval block at the end is filled in with the
reviewer and the approving commit, and (b) the lead has recorded, in `.build/evidence.jsonl`, the
**commit SHA and the SHA-256 of this protocol plus its criteria** (A9-04). Print the values with
`python3 fixtures/dsp/tools/freeze_hash.py` (it hashes this file up to, not including, the Approval block, so that filling in the
Approval block does not change the frozen content, and `qualification.ts`, and prints a combined hash
and a ready-to-paste evidence line; it writes nothing). After that this document and
`qualification.ts` are read-only. A change (a threshold, a level, a trial, a stimulus, a criterion)
creates revision 3 through an ADR amendment that keeps the original criteria and any failing
result; data collected under revision 2 stays labelled revision 2. Criteria are never changed after
seeing data. A failed experiment is recorded as failed (ADR-0009).

**What this experiment can and cannot show.** It can show whether, on one specific phone, browser
and input, the app's relative level is monotonic, follows a known digital step to within 2 dB and is
repeatable for a fixed loudspeaker at fixed geometry, and how the voice-activity logic behaves on listed stimuli and negative cases. It cannot
establish dB SPL, audibility, comprehension, clinical meaning, behaviour on other phones, or
cross-day reproducibility. A passing result enables the `relative_band` mode for that phone only
(decision T04A); it does not enable cross-day comparisons or automatic target increases (ADR-0001
§10, ADR-0009).

## 1. Units under test and equipment

**Unit under test.** One physical Android phone per run (device matrix grows by repeating the
protocol on further phones; results are never pooled across phones). Chrome for Android is the
primary browser (the autoGainControl constraint is documented as supported there); Samsung Internet
may be run as a second row on the same phone. iOS Safari is a separate, later test case (the
constraint is not supported there); it is not pre-judged.

**Software.** The phone page's qualification mode, built from a recorded git commit, serves the
real `@atr/phone-mic-meter` capture adapter over HTTPS and logs **numeric per-frame values only**
(frame index, `t_audio_ms`, `dbfs`, clipped flag, finite flag) plus the precheck and window summaries
and the track/AudioContext state events. It records no audio, uses no recorder, and sends nothing
over the network. The experimenter exports the log as JSON. (The qualification mode itself is a
phone-companion deliverable; this document only freezes what it must log.)

**Equipment.** One loudspeaker (fixed for the whole experiment; model recorded); one playback device
(laptop or phone) with its volume setting frozen after the pilot; stimulus files (section 3);
tape measure (±1 cm); tape to mark the phone outline and the loudspeaker position; a camera able to
film at 60 fps or better for the timing method (section 7); a paper or spreadsheet log; the Fire TV
or an equivalent display placed as in the product setup, powered on with its volume at zero.

**Phone preparation.** Browser freshly started; microphone permission granted for the page origin;
Do Not Disturb on; no headset, no case change between blocks (case state recorded); screen on,
brightness fixed; battery above 50 %; the phone offline (airplane mode, Wi-Fi off) so the "no upload"
property is observable; screen timeout extended or the wake lock confirmed (state recorded).

## 2. Geometry (fixed for the whole experiment)

```
        wall
   +----------------+
   |  TV stand      |            seat 2 line
   |  [phone]  [TV] |                |
   |   ^mic         |<--- D ---------+  loudspeaker at seat 2
   +----------------+        D = one fixed value in 2.5 - 3.0 m
```

| Item | Specification |
|---|---|
| Phone placement | On the TV stand, 0.2 - 0.4 m to the side of the TV, inside a **taped outline**; portrait; microphone port toward the seating area; screen facing the seat. Tape marks give a repeatable position. |
| Phone height | Microphone at 0.9 m ± 0.05 m above the floor (recorded exactly). |
| Loudspeaker position | At seat 2 on the TV-to-seat centre line. One fixed distance **D from the phone, chosen once within 2.5 - 3.0 m** (proposal 2.75 m), measured to ±1 cm and recorded. |
| Loudspeaker height and aim | Acoustic centre at 1.10 m ± 0.05 m (seated mouth height proxy), axis aimed at the phone microphone. |
| Room | Doors and windows closed; HVAC and appliance state recorded; no moving objects or people in the room during a trial other than the operator at a fixed position behind or beside the loudspeaker (position marked). |
| TV | On, volume 0, same state for every trial. |
| Verification | Distances re-measured and a photograph taken before every block; any movement is a protocol deviation and is logged. |

## 3. Stimuli and levels

All stimuli are generated before the experiment from the stated parameters; their SHA-256 hashes
are recorded in the session record. Level changes are made **only by choosing the file** (digital
gain in the file), never by touching the playback volume after the pilot.

| ID | Stimulus | Parameters |
|---|---|---|
| S1 | 1 kHz tone burst | 4.0 s, 10 ms raised-cosine ramps, sine |
| S2 | Pink-noise burst | 4.0 s, 10 ms ramps, 1/f spectral shaping of seeded Gaussian noise (seed 20261013), band 50 Hz - 10 kHz, then peak-normalized |
| S3 | Real speech | A consenting volunteer reads the fixed sentence "Please put the blue book on the shelf." at three self-selected effort levels E1 soft, E2 normal, E3 loud (not calibrated), from seat 2 |

**Three nominal digital playback levels** for S1 and S2, defined as the **digital peak of the file**:

| Level | Digital peak | Step from previous |
|---|---|---|
| L1 | -30 dBFS | |
| L2 | -18 dBFS | 12 dB |
| L3 | -6 dBFS | 12 dB |

Steps are at least 6 dB apart and every file peaks at or below -6 dBFS, so no stimulus clips at the
source. The loudspeaker, room and phone are not calibrated: speaker output and digital volume are not
a sound-pressure reference. The **slope criterion (C2)** nevertheless expects each measured median
step to be within the nominal step ± 2 dB (A9-01). The reasoning, stated so it can be challenged: a
linear, unprocessed input reproduces a 12 dB digital step as about 12 dB at any gain, while an input
with automatic gain control or compression squeezes it (a 3:1 compressor turns 12 dB into 4 dB);
monotonic medians, a tight spread and zero clipping all pass an input that squeezes a 12 dB step into
2 dB, which is why monotonicity alone is not accepted. The criterion assumes the loudspeaker and
room are linear over the 24 dB range; a compressing loudspeaker could fail a good phone, so a failure
is reported as a failure of the whole measurement chain and repeated with a second loudspeaker before
any conclusion about the phone.

**Pilot (not counted, may be repeated once).** Using L3 then L1 of S1: choose the single playback
volume so that (a) L3 produces zero clipped frames at the phone, and (b) L1 gives a median level at
least 10 dB above the quiet-room floor (the voice-activity open threshold). Record the volume and the
observed numbers, then freeze the volume. If (a) and (b) cannot both be met, record "pilot failed:
dynamic range" and stop; the experiment is a failed experiment for this phone and is not rescued by
changing levels.

## 4. Trial procedure

**Block order (fixed):** quiet-room check → S1 tone block → S2 pink-noise block → S3 speech block →
VAD synthetic block (section 7) → negative-case block (section 5).

**Quiet-room check** at the start of every block: a valid 5 s `quiet_check` (ADR-0001 §2) with the
room in the experiment state; its floor is recorded. If it is invalid the block does not start.

**A level trial** (S1, S2, S3), repeated 45 times per block (3 levels × **15 repeats**, order from the
tables in section 9):

1. Pre-window check: a 2 s `pre_window` precheck in silence. Its floor `F_pre` (median) is recorded.
   If it is invalid (coverage, clipping, non-finite or burst rule), the trial is **blocked**, logged,
   and re-run once at the end of the block (both attempts are reported).
2. A phrase-kind window of 8.0 s (160 frames) starts on the phone (it logs every frame). Its VAD
   floor is the block's quiet-check floor.
3. About 1 s after the phone shows "Measuring", the operator starts the file named in the order
   table. The start time therefore falls in [1.0 s, 3.0 s]; the 4.0 s burst ends in [5.0 s, 7.0 s],
   fully inside the window. For S3 the volunteer speaks the sentence once, at the effort level
   named in the table.
4. After the window closes: at least 5 s of silence before the next trial (reverberation decay).

**Primary per-trial metric (timing independent).** `L95` = nearest-rank 95th percentile of the
finite frame levels (dBFS) over the whole 8 s window (the burst covers about half of the window, so
the top 5 % of frames lie inside the plateau). `rel95 = L95 - F_pre`. The window's own
`p95_active_dbfs` and VAD segments are recorded as secondary values.

**Valid trial.** A trial is valid for the statistics when it was not blocked, not marked disturbed,
its capture was not interrupted and it was not a capture fault. A **capture fault** is a window with
coverage below 0.90 or any non-finite frame: it says the measurement pipeline dropped data, not
anything about the level, so the trial is marked disturbed and re-run once at the end of the block
(both attempts are reported). A clipped frame is never grounds for exclusion (C5). A window the VAD
calls `no_voice` is still a valid trial for `rel95` (the metric does not use the VAD).

**Randomization.** Each block's order is a seeded Fisher-Yates shuffle (section 9 gives the
algorithm and the printed order). The operator follows the printed order and does not choose.
Operator unblinding is acceptable because the analysis is automatic and fixed in advance.

## 5. Negative cases (each condition: 10 windows, order in section 9)

Setup, once per block: a valid quiet check (floor `F0`), then a **calibration window** with the
volunteer speaking at normal effort from seat 2; `cal_margin` is recorded. If `cal_margin < 13 dB`
the gate arithmetic below is recorded as "not evaluable" and the block still runs and is reported.

Each trial: establish the condition (30 s settle where relevant) → a 2 s `pre_window` precheck **with
the condition active** → an 8 s phrase window with the condition active → condition off. The
analysis applies ADR-0001 §5 offline to the precheck (`rise = F_pre - F0`; block if `rise >= 6`, or
`cal_margin - rise < 10`, or the precheck is invalid) and ADR-0001 §8 to the window using the
shipped verdict function at a recorded commit.

| ID | Condition | Intended speaker | Recorded outcome |
|---|---|---|---|
| N1 | Floor fan, medium speed, 1.5 m from the phone | silent | gate blocked / precheck invalid reason / window unscored reason / scored below / scored reached |
| N2 | Television or laptop playing speech at normal listening level (clip name recorded) | silent | same |
| N3 | Second speaker, normal voice, short utterances, at seat 1 (1.5 m) | silent | same, plus accepted segments and `active_ms` |
| N4 | Cough: 3 deliberate coughs of 200 - 400 ms in the window | the coughing volunteer | accepted segment count, `active_ms`, verdict |
| N5 | Instrumental music at moderate volume | silent | same as N1 |
| N6 | Moved phone: after calibration the phone is displaced 0.5 m farther along the stand (returned to the mark after the trial) | volunteer speaks the fixed sentence, normal effort | `rel95` shift relative to the baseline distribution; verdict |
| N7 | Screen lock: the operator presses the power button 3 s into the window | volunteer speaks the sentence | track and AudioContext events, whether capture continued, whether the window ended `interrupted` or produced no result, whether the next window after unlock starts clean |

**Predeclared limits (A9-03)** are parameters of `analyzeQualification` and are frozen with it: for N1
(fan) and N2 (television speech) at most **0 of 10** windows may be scored `reached` after the gate
(a window the gate blocked, or that the analysis marks contaminated, is not scored). N3 - N7 have no
limit. Exceeding a limit sets `limited: noise-sensitive` for the phone and the result is shown in
Settings.

N1 - N5 test false acceptance while the intended speaker is silent. N3 - N5 are **known limitation
cases** (ADR-0001 §3: level cannot tell a cough, music or another voice from the intended speaker);
they are reported, not gated. N6 is evidence for why cross-session comparison is disabled; it has no
pass or fail value. N7 tests lifecycle handling and the no-stale-scoring rule.

## 6. Quality rules

1. Geometry verified and photographed before each block; no movement between trials except N6.
2. Playback volume, loudspeaker position, TV state and phone settings frozen after the pilot.
3. Every trial has a valid `pre_window` precheck, otherwise it is blocked and re-run once (reported).
4. Unplanned events (door, voices, notification, app crash, permission loss) are written in the
   log **at the time, before the result is read**. Such a trial is marked disturbed and re-run once
   at the end of the block; both attempts are reported.
5. No trial is dropped or edited because of its value. All 45 planned trials per block appear in the
   report, with every attempt.
6. The analysis (`analyzeQualification`, formulas in section 8) is committed **before** data
   collection and is part of the freeze hash. No outlier removal.
7. Numeric traces are exported unmodified; their hashes are recorded.
8. A trial with a clipped frame is **not** discarded: clipping is a criterion (C5).

## 7. VAD timing and duration method (no participant audio is saved)

**Synthetic block.** Tone bursts (S1 at L2) played in `vowel`-kind windows of 30 s. Conditions, 5
repeats each (55 trials), order in section 9: `A100`, `A150`, `A200`, `A250`, `A300` (burst of 0.10,
0.15, 0.20, 0.25, 0.30 s); `G250` (two 0.30 s bursts separated by 0.25 s of silence: expected one
bridged segment); `G300` (two 0.30 s bursts separated by 0.30 s: expected two segments); `D05`,
`D10`, `D20` (sustained 5, 10, 20 s); `SIL` (silence).

**Expected behaviour of the voice-activity rule (A1-01, A1-02, A1-03)**, from
`fixtures/dsp/vad-phase-sweep.json`: a burst of 100 ms or less never produces an accepted segment; a
burst of 250 ms or more always does; 125 - 175 ms are phase- and level-dependent; a 200 ms burst is
always accepted at about +20 dB over the floor but only at 27 of 40 phases at +10 dB. The loudspeaker
playback start is not synchronised to the 50 ms frame grid, so `A150` and `A200` acceptance is a
**rate to be reported**, not a pass or fail value. A segment opens only at +10 dB over the floor, so
the burst must be at least 10 dB above the quiet-room floor (pilot step (b)).

**Duration ground truth.** The nominal digital length of each burst and gap is sample-exact in the
file. The measured accepted `active_ms` is compared with it; the signed error distribution is
reported. Room reverberation and loudspeaker ringing can extend the measured end, and the 50 ms
frame quantizes durations: both are systematic effects to be reported, not corrected.

**Onset ground truth (no audio saved). Methods in order of preference; the one used is recorded
and the others are marked not used.**

- **A. Visual sync, no audio.** A second camera films at 60 fps or better (120 fps preferred), with
  its microphone disabled and verified absent from the file, so that each frame shows both (i) a
  sync cue emitted by the stimulus player at the start of the burst (an LED or screen flash driven by
  the same playback event) and (ii) the phone screen's provisional-activity indicator and running
  audio clock. The latency is the number of video frames between the cue and the indicator times the
  frame period. Resolution is ±1 video frame (±16.7 ms at 60 fps). The phone's display latency and
  the player's output latency are unknown fixed biases, so under this method the onset result is an
  upper-bound estimate and is labelled so.
- **B. Separate reference recorder (needs consent).** A separate device records audio and video
  locally for the experimenter only; the experimenter labels the true onset and offset on the
  reference timeline and aligns it to the phone timeline using a shared click. For synthetic
  loudspeaker trials only the experimenter's equipment is recorded. For speech trials this records a
  person's voice, so it requires **written informed consent from every person who can be heard**,
  stating the purpose, local-only storage on the experimenter's encrypted drive, no upload or
  sharing, deletion within 7 days after labelling, and the right to withdraw. Without consent from
  all present, method B is not used for speech. The product itself never records; this recording is
  a research instrument outside it. Only the label timestamps are kept; the recordings are deleted
  after labelling and the deletion date is logged.
- **C. Visual lip labelling (speech, no audio).** Two independent labellers mark mouth opening and
  closing from a 60 fps video whose audio track is disabled and verified absent. Inter-labeller
  differences are reported.

If none of A, B or C is available the VAD timing result is **pending: no independent reference** and
no timing accuracy may be claimed.

## 8. Analysis plan and frozen acceptance criteria

**Statistics (fixed).** `analyzeQualification` (`packages/phone-mic-meter/src/qualification.ts`) takes
the valid level trials (stimulus, nominal level, `rel95`, clipped frames), the browser's reported
settings and the negative-case counts, and returns pass or fail per criterion. For each stimulus and
level it uses the 15 values of `rel95`: the nearest-rank median; the sample standard deviation s
(n - 1); and the **one-sided 95 % upper confidence bound of the SD**,
`s * sqrt((n - 1) / chi2_0.05(n - 1))`, where chi2_0.05 is the 5th percentile of the chi-square
distribution (6.5706 for n - 1 = 14, so the factor is 1.4597 and the SD estimate must be at most
1.03 dB). The largest deviation from the median is reported. No other hypothesis test is made.

> **Engineering proposals, not measured accuracy, require reviewer approval before trials.** The
> following criteria were chosen before any data existed. They are not derived from measurements, do
> not state any accuracy of the product, and may be changed only by a new protocol revision.

| ID | Applies to | Frozen criterion |
|---|---|---|
| C1 | S1 and S2, each | **Monotonic medians:** the median `rel95` rises strictly with the nominal level (L1 < L2 < L3) |
| C2 | S1 and S2, each | **Slope (A9-01):** each adjacent median step is within the nominal step ± 2 dB (the nominal step is 12 dB, so 10 - 14 dB). A 3:1 compressing input fails here. |
| C3 | S1 and S2, each | **Repeats (A9-05):** at least 15 valid repeats at each of the 3 levels |
| C4 | S1 and S2, each level | **Repeatability (A9-05):** the one-sided 95 % upper confidence bound of the SD is at most 1.5 dB |
| C5 | all valid trials | **Zero clipped frames** (window and precheck) |
| C6 | settings readback | The browser reported `autoGainControl: false` after open. Echo cancellation and noise suppression are recorded and reported. A reported `true` or `null`, or no readback, fails C6; a reported `false` is not proof that the operating system or hardware applies no gain control. |
| C7 | negative cases (A9-03) | N1 and N2: at most 0 of 10 windows scored `reached` after the gate. Exceeding a limit sets `limited: noise-sensitive`. N3 - N7 are reported, not gated. Missing results fail C7. |

Recorded but **not computed** by `analyzeQualification`:

| ID | Applies to | Treatment |
|---|---|---|
| C8 | S3 speech | Informational: medians ordered soft < normal < loud, clipping, SD reported. No pass or fail (human variability). |
| C9 | VAD (section 7) | Proposal, evaluated only with an independent reference: onset median < 100 ms and longest-active-run duration error <= 0.3 s on sustained bursts of 1 s or more; `A100` accepted 0 of 5; `A250` and `A300` accepted 5 of 5; `A150` and `A200` acceptance rates reported. N7: no stale scoring (the window after the lock is a fresh window). |

**Outcome rule.** `analyzeQualification` returns `passed` only if C1 - C7 all pass for both S1 and
S2; otherwise `failed` (and `not_run` without trials). *Passed* is the evidence for the
`relative_band` mode on this phone, browser and input only; *failed* forces the Listener Edition with
band verdicts hidden (ADR-0009 as amended: the qualification state is per phone description and
`mic.state.mode` is a label, never evidence). `limited: noise-sensitive` is reported separately. The
full results are published as measured either way.

## 9. Randomized trial orders (printed, frozen)

**Algorithm.** `mulberry32(seed)` PRNG; base list in level-major order (L1-01 ... L1-15, L2-01 ...
L3-15, or the equivalent for the other blocks); Fisher-Yates from the last index down:
`for i = n-1 .. 1: j = floor(rand() * (i + 1)); swap(a[i], a[j])`. The first `seed + k` (k = 0, 1,
2, ...) whose result has no more than 3 consecutive trials of the same level (2 for the VAD and
negative-case blocks) is used. Base seeds: tone 20261101, pink noise 20261201, speech 20261301, VAD
20261012, negative cases 20261011. **Accepted seeds:** tone 20261103 (k = 2), pink noise 20261201
(k = 0), speech 20261303 (k = 2), VAD 20261012, negative cases 20261011; the rejected seeds produced
a run longer than 3 and were discarded before any use.

```js
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, seed) {
  const rand = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

**Level blocks** (45 trials each; code `Ln-rr` = level n, repeat rr; speech code `En-rr` = effort n:
E1 soft, E2 normal, E3 loud):

| # | S1 tone | S2 pink noise | S3 speech |
|---|---|---|---|
| 1 | L2-14 | L2-12 | E3-05 |
| 2 | L1-09 | L2-07 | E2-06 |
| 3 | L3-12 | L1-10 | E3-14 |
| 4 | L2-08 | L2-04 | E2-15 |
| 5 | L1-10 | L3-14 | E3-01 |
| 6 | L1-05 | L2-02 | E3-07 |
| 7 | L3-01 | L2-14 | E2-07 |
| 8 | L3-11 | L3-11 | E3-12 |
| 9 | L1-02 | L3-05 | E3-03 |
| 10 | L3-10 | L2-01 | E3-10 |
| 11 | L3-15 | L1-07 | E1-10 |
| 12 | L1-14 | L2-10 | E2-11 |
| 13 | L3-06 | L1-15 | E1-09 |
| 14 | L3-03 | L2-15 | E3-15 |
| 15 | L2-07 | L1-08 | E1-01 |
| 16 | L2-11 | L1-12 | E3-02 |
| 17 | L3-14 | L3-10 | E2-10 |
| 18 | L2-04 | L1-09 | E3-04 |
| 19 | L2-15 | L3-13 | E1-11 |
| 20 | L1-04 | L2-13 | E1-03 |
| 21 | L1-06 | L3-09 | E1-12 |
| 22 | L3-13 | L1-03 | E3-08 |
| 23 | L2-01 | L3-01 | E1-02 |
| 24 | L1-08 | L2-05 | E2-02 |
| 25 | L1-12 | L1-14 | E1-13 |
| 26 | L3-07 | L3-12 | E2-04 |
| 27 | L1-13 | L3-04 | E3-06 |
| 28 | L3-08 | L1-02 | E1-15 |
| 29 | L3-09 | L2-09 | E2-09 |
| 30 | L2-09 | L3-06 | E2-05 |
| 31 | L1-07 | L3-15 | E2-03 |
| 32 | L2-12 | L2-03 | E3-09 |
| 33 | L1-15 | L3-08 | E1-14 |
| 34 | L1-01 | L2-08 | E2-13 |
| 35 | L3-02 | L3-03 | E1-07 |
| 36 | L2-03 | L1-04 | E1-08 |
| 37 | L2-02 | L1-01 | E1-04 |
| 38 | L2-13 | L2-11 | E2-12 |
| 39 | L1-03 | L3-07 | E3-11 |
| 40 | L3-05 | L1-06 | E1-05 |
| 41 | L2-05 | L2-06 | E3-13 |
| 42 | L2-06 | L3-02 | E1-06 |
| 43 | L3-04 | L1-05 | E2-08 |
| 44 | L2-10 | L1-11 | E2-01 |
| 45 | L1-11 | L1-13 | E2-14 |

**VAD synthetic block** (55 trials, read left to right, row by row; code `condition-repeat`):

```
SIL-5 A100-4 G250-1 D20-3 SIL-1 A200-2 A300-5 A150-5 A150-4 SIL-3
G300-1 A200-5 G300-2 A200-1 G250-3 A200-4 A250-3 SIL-2 A100-2 D05-2
G300-3 G250-2 D10-3 G250-5 A300-1 A300-4 D20-1 D05-3 A150-2 D05-1
D10-2 A150-1 D05-5 A100-5 G250-4 D10-5 A250-1 D05-4 A300-2 A250-2
A100-3 D20-4 A150-3 A200-3 D20-5 D20-2 A300-3 D10-4 D10-1 G300-4
G300-5 SIL-4 A250-5 A100-1 A250-4
```

**Negative-case block** (70 trials, read left to right, row by row; code `Nn-rr` as in section 5):

```
N2-01 N7-07 N6-05 N4-02 N6-10 N7-01 N2-07 N1-07 N2-04 N7-05
N7-09 N2-02 N1-08 N5-09 N6-03 N3-03 N3-09 N7-03 N4-05 N6-01
N5-10 N7-04 N1-01 N2-06 N5-01 N6-02 N3-04 N4-06 N4-07 N1-03
N4-01 N7-02 N2-03 N3-08 N3-01 N1-10 N1-09 N5-05 N6-09 N3-06
N2-05 N3-02 N4-03 N5-07 N1-02 N1-05 N5-08 N4-10 N3-10 N6-04
N5-03 N7-10 N2-09 N4-08 N7-08 N2-08 N6-06 N7-06 N5-02 N1-06
N3-07 N5-06 N5-04 N4-04 N6-08 N1-04 N2-10 N4-09 N6-07 N3-05
```

The orders can be regenerated from the algorithm and seeds above; the printed tables are normative.

## 10. Record fields

**Session record (once per run):** date and time (IST and UTC); operator; phone make, model and
Android version and build; browser name and full version (and WebView version if used); selected
input device label and `deviceId` class (built-in or external); accessories and case state; page
**build commit**; the freeze hash (protocol plus criteria SHA-256) and the commit it was recorded at; analysis commit; verdict-function commit; the exact
**constraints requested** (`getUserMedia` argument as sent); `getSupportedConstraints()` output;
**settings reported** by `track.getSettings()` after open (AGC, echo cancellation, noise
suppression, sample rate, channel count; unknown recorded as null); AudioContext sample rate and
frame length; worklet used; geometry (D, heights, orientation, tape-mark photo ids, TV state); room
description and HVAC state; quiet-check statistics; loudspeaker model, playback device, volume
setting, stimulus file hashes; battery, brightness, Do Not Disturb, network state, wake-lock state,
visibility; temperature if relevant; deviations from the protocol.

**Per trial:** trial number and code; attempt number; timestamp; precheck summary (`F_pre`, p20, p80,
p95, coverage, valid, reason); window summary (all `WindowResultPayload` fields); the **numeric trace**
(every frame's `frame_index`, `t_audio_ms`, `dbfs`, clipped and finite flags) with the file name and
hash; `L95`, `rel95`; clipped frame count and dropouts (missing frames, coverage); track and
AudioContext state events; disturbed or blocked flags with the live note; for the VAD block the
accepted segments and the reference label times and method; for negative cases the gate and verdict
outcomes; pass or fail per criterion; limitations observed.

**Per run:** per-level repeat distributions (all 15 values), medians, SDs, SD upper confidence bounds;
the full `analyzeQualification` output (criterion results C1 - C7, `status`, `limited`) and the
recorded C8 and C9 values; the outcome statement; limitations; links to the raw numeric files.

Excluded from every record: audio, waveforms, sample arrays, credentials, personal identifiers (consent
forms are stored separately by the operator).

## 11. Results template (all `pending`)

**Session record**

| Field | Value |
|---|---|
| Phone / Android / browser | pending |
| Input device and constraints requested | pending |
| Settings reported (AGC, EC, NS, sample rate, channels) | pending |
| Supported constraints | pending |
| Page build commit / freeze hash (protocol + criteria) and the commit it was recorded at | pending |
| D (m), heights, orientation | pending |
| Playback volume, stimulus hashes | pending |
| Pilot outcome | pending |

**Level blocks (one table each for S1 tone, S2 pink noise, S3 speech)**

| Level | Valid n (need 15) | Median rel95 (dB) | SD (dB) | SD upper 95 % bound (dB) | Min | Max | Max deviation from median | Clipped frames | Coverage min |
|---|---|---|---|---|---|---|---|---|---|
| L1 (or E1) | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| L2 (or E2) | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| L3 (or E3) | pending | pending | pending | pending | pending | pending | pending | pending | pending |

**Criteria**

| Criterion | S1 | S2 | S3 |
|---|---|---|---|
| C1 monotonic medians | pending | pending | pending (informational) |
| C2 slope: steps within nominal ± 2 dB (measured steps) | pending | pending | n/a |
| C3 15 valid repeats at each level | pending | pending | n/a |
| C4 SD upper bound <= 1.5 dB | pending | pending | n/a |
| C5 zero clipped frames | pending | pending | pending |
| C6 AGC reported false | pending | | |
| C7 negative-case limits | pending | | |
| C9 VAD timing (with an independent reference) | pending | | |
| `analyzeQualification` status / limited | pending | | |

**VAD synthetic block**

| Condition | Nominal | Accepted (of 5) | Median active_ms | Duration error median / min / max | Onset delay (method) |
|---|---|---|---|---|---|
| A100 | 100 ms | pending | pending | pending | pending |
| A150 | 150 ms | pending | pending | pending | pending |
| A200 | 200 ms | pending | pending | pending | pending |
| A250 | 250 ms | pending | pending | pending | pending |
| A300 | 300 ms | pending | pending | pending | pending |
| G250 | 0.30 + 0.25 + 0.30 s | pending | pending | pending | pending |
| G300 | 0.30 + 0.30 + 0.30 s | pending | pending | pending | pending |
| D05 / D10 / D20 | 5 / 10 / 20 s | pending | pending | pending | pending |
| SIL | none | pending | pending | pending | pending |

**Negative cases (10 windows each)**

| Condition | Gate blocked | Precheck invalid | Window unscored | Scored below | Scored reached (limit) | Notes |
|---|---|---|---|---|---|---|
| N1 fan | pending | pending | pending | pending | pending (limit 0) | pending |
| N2 TV speech | pending | pending | pending | pending | pending (limit 0) | pending |
| N3 second speaker | pending | pending | pending | pending | pending | pending |
| N4 cough | pending | pending | pending | pending | pending | pending |
| N5 music | pending | pending | pending | pending | pending | pending |
| N6 moved phone (rel95 shift) | n/a | n/a | pending | pending | pending | pending |
| N7 screen lock | n/a | n/a | pending | pending | pending | pending |

**Outcome:** pending. **Limitations observed:** pending. **Deviations from protocol:** pending.

## 12. Limitations of this protocol

- One loudspeaker, one room and one placement: results do not transfer to other rooms, phones or
  seats, and are not evidence about cross-day reproducibility.
- Nominal digital levels are not calibrated sound levels. C2 assumes the loudspeaker and room are
  linear over the 24 dB range; no independent acoustic reference exists, so a failure indicts the whole
  chain until repeated with a second loudspeaker.
- n = 15 per level and the SD bound are predeclared engineering choices, not a guarantee; passing
  does not establish cross-day reproducibility.
- Method A for onset timing includes unknown display and output latencies; without method B or C no
  absolute onset accuracy is claimed.
- The browser's reported settings are not proof that the operating system or hardware applies no
  gain control, compression or noise reduction; only the measured behaviour is evidence.
- Speech levels depend on the volunteer's effort and are not controlled; speech results are
  informational.
- The operator is not blind to the level; the fixed automatic analysis mitigates this but does not
  remove it.

## Approval block (to be completed before any trial)

| Field | Value |
|---|---|
| Reviewer | pending |
| Date | pending |
| Approving commit | pending |
| Freeze hash: SHA-256 of this protocol + criteria (`python3 fixtures/dsp/tools/freeze_hash.py`) | pending |
| Recorded in `.build/evidence.jsonl` by the lead (commit SHA and hash, before the first trial) | pending |
| Changes requested before freeze | pending |

**Reminder (A9-04).** Before the first trial the lead records one line in `.build/evidence.jsonl`
with the commit SHA and the SHA-256 of this protocol plus its criteria, produced by
`fixtures/dsp/tools/freeze_hash.py`. The reviewer's approval alone does not unfreeze anything: a later
change needs an ADR amendment that keeps the original criteria and any failing result.

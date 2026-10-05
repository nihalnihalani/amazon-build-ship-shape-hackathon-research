# Limitations: what is measured, what is fixture, what is pending

Status: built from `.build/evidence.jsonl` (EV-0001 to EV-0040), `.build/blockers.md`, `.build/task-graph.json` and the reruns recorded in [TESTING.md](TESTING.md), at integration commit `63af0ae`. Nothing here is a prediction. Where a number is a design constant it is called a **product assumption**.

Product framing: **Not a medical device. Does not diagnose or treat any condition.** The app shows a *relative digital level* at a phone microphone, compared with a quiet-room floor measured minutes earlier. It is not dB SPL, audibility, intelligibility, comprehension, voice identity or a clinical outcome, and no efficacy claim is made.

## 1. What could not be done on this build host

| Blocker | What is missing | Consequence for every statement in this repository |
|---|---|---|
| B-001 | No Vega SDK and no Vega Virtual Device (VVD). Rosetta 2 is absent on macOS 27.0.1 (`arch -x86_64 /usr/bin/true` fails with "Bad CPU type", EV-0002); the Vega install guide lists Rosetta as a dependency on Apple Silicon. | The TV app has **never been built for, installed on, or run on Vega**. `vega project doctor`, `vpt validate`, native rendering, VoiceView, the real focus engine, real UI scale, AsyncStorage on a device and WSS from the Vega runtime are all unverified. |
| B-002 | No physical Android phone (no `adb`, no device). | Every microphone result comes from **synthetic audio in desktop Chrome**. Real `getUserMedia` on a phone, AGC and echo read-back, the capture indicator, background and wake-lock behaviour, and the T04 qualification experiment have not happened. |
| B-003 | AWS default credentials resolve to the account root user (EV-0004) and there is no spend authorization. | **No AWS deployment exists.** The AWS adapter and `infra/template.yaml` are tested against fakes, a strict in-memory DynamoDB model and `cfn-lint`; SQS authentication deadlines, API Gateway behaviour, alarms, rollback and cost are unproven. |
| B-004 | No physical Fire TV. | No physical-device evidence of any kind. |
| B-005 | No owner authorization for publication. | **Nothing has been published, pushed, submitted or shared.** |

## 2. Measured, fixture and pending, by area

Evidence classes are exactly those in the evidence log: `automated` (a command run on this host with exit code and counts), `fixture_replay`, `web_preview` (react-native-web in desktop Chrome, not Vega) and `documentation_only`. No entry in the log has the class `real_phone`, `real_VVD` or `physical_Fire_TV`. **No class is promoted to another.**

| Area | What was actually run | Class | Result (commit, source) | What it does **not** show |
|---|---|---|---|---|
| Wire protocol | `@atr/protocol` build, typecheck, 921 tests incl. a test that parses `PROTOCOL.md`; 3,000 honest DSP windows and 282,193 level frames with zero false rejects | automated | pass (EV-0026; rerun in the clean clone, see TESTING.md) | Behaviour of `String.prototype.normalize` and the validators on Hermes (Vega runtime); only Node 22, 24 and 25 were used |
| DSP arithmetic | `@atr/phone-mic-meter`: 450 tests; independent Python oracle reproduced every hand-derived fixture (39 quiet-check, 21 VAD, 27 window, 20 soft-window cases, phase sweep, click trains, AR(1) noise); 19 of 19 mutations killed | automated + fixture | pass (EV-0029) | **Not a measurement of any microphone, phone, browser or room.** Fixtures prove arithmetic and state handling only |
| TV session logic | `@atr/session-core`: 371 tests; independent QA suite 163 of 163 with `QA_STRICT=1`; 29 of 29 mutations killed (EV-0028) | automated (fakes) | pass (EV-0032, EV-0040) | Real AsyncStorage, real timers on a TV, VoiceView announcements |
| TV app code | `apps/tv` (Node 22): `tsc --noEmit` 0 errors against the published `@amazon-devices` types; jest 29 suites, 639 tests with **mocked** Vega native modules; a Metro JS bundle for platform `kepler` builds (1.54 MB) and passes the console-strip check | automated | pass (EV-0014, EV-0033, EV-0040; clean-clone rerun in TESTING.md) | **Not a native Vega build.** `build-vega`, `.vpkg`, `vpt validate`, the manifest in `apps/tv/manifest.toml` (unvalidated by `vega project doctor`) and rendering are untested |
| Relay (core, local server) | 1,111 tests plus 2 more that run when `cfn-lint` is installed (1,113 with the venv); real HTTPS/WSS server on loopback with a throwaway CA; security suites run on the memory store and a strict DynamoDB model | automated | pass (EV-0024, EV-0034, EV-0040) | The DynamoDB model is not DynamoDB; loopback is not a LAN or the internet |
| AWS adapter and IaC | Lambda handlers against fakes; `cfn-lint` 1.57.1 exits 0 for ap-south-1; infra assertions that fail on deliberately broken templates | automated | pass | Nothing ran on AWS (B-003): SQS deadlines, `GoneException` cleanup, SSM decrypt, CloudFront headers, alarms, budget, rollback and cost are **pending** |
| Phone page | `@atr/phone`: 459 unit tests (happy-dom); real-Chrome scripts with **synthetic or stubbed** audio: smoke, flow and hostile-QR | automated + fixture_replay | pass (EV-0019). In the clean-clone rerun on this host the production script failed on a host-dependent `getUserMedia` behaviour: see section 7 | No real microphone, no Android Chrome, no permission prompt, no real AGC behaviour |
| Complete local session | Headless TV core, real local relay (HTTPS/WSS, dev CA) and the phone `dist-test` build in system Chrome with synthetic audio: pair with number matching and phone confirmation, quiet check, calibration, vowel, 10 phrases (blind 3, 6, 9; retry; skip; cue; listener timeout), summary equal to hand-derived values | automated | 4 of 4, about 103 to 108 s (EV-0037; rerun in TESTING.md) | Synthetic sine audio, loopback, headless TV with no Vega UI. **Not** a phone-to-TV demonstration |
| Failure recovery | Fault-injecting WSS proxies on both legs: TV link loss, phone link loss, 300 ms latency, duplicated frames, hidden page, noisier room, continuous sound, digital silence | automated | 8 of 8 (EV-0038) | Synthetic faults on loopback; Lambda errors, cold starts and credential expiry on AWS are only unit-tested |
| Accessibility and scale | `QA_STRICT=1 node a11y/run-a11y.mjs`: 29 fixture screens plus real-store keyboard journeys at scales 1.0, 1.25, 1.5 and 2.0; axe-core 4.13.0 | web_preview | 59 of 59, axe no serious or critical (EV-0039) | **Not VoiceView, not the Vega focus engine, not the real UI-scale setting.** Preview navigation and scale are shims. T17 itself is `blocked_external` |
| Independent reviews | ADR review (8 accept-with-changes, ADR-0007 accept, 228 adversarial probes), protocol review, QA reviews of T11, T13, T14 and the accessibility gate | documentation_only and automated | accepted with rework, rework verified (EV-0023, EV-0027, EV-0031) | A security re-review of the **integrated** commit (T16) and an independent release review (T21) are not recorded: both are `pending` |
| Toolchain facts | Official sample and registry metadata read through `gh api` and `npm view`; rules and Vega pages fetched (some only through a summarising tool) | documentation_only | EV-0007, EV-0008, EV-0011 | Registry availability is not runtime compatibility; several pages were read as summaries and must be re-read before reliance |

## 3. DSP residuals (recorded, not hidden)

Both come from the rework of `docs/adr/AMENDMENTS-REV2.md` ("Measured outcomes of the DSP rework") and `fixtures/dsp/`. The model for both is synthetic; real-room behaviour is the subject of T04, which has not run.

**A1-01, burst phase dependence.** The voice-activity rule accepts a segment only with at least 4 candidate frames and a run of 3. Bursts are swept over 40 sub-frame offsets (`fixtures/dsp/vad-phase-sweep.json`):

| Burst | At +10 dB over the floor | At +20 dB over the floor |
|---|---|---|
| 100 ms | never accepted (0 of 40) | never accepted (0 of 40) |
| 125 ms | 0 of 40 | 15 of 40 |
| 150 ms | 0 of 40 | 35 of 40 |
| 175 ms | 7 of 40 | 40 of 40 |
| 200 ms | **27 of 40** | 40 of 40 |
| 250 ms | 40 of 40 | 40 of 40 |

Consequence: "bursts of 100 ms or less are never accepted" and "250 ms or more is always accepted at +10 and +20 dB" hold; the amendment's wording "200 ms or more always" does **not** hold at +10 dB (the frame before the opening frame can never be a candidate). Bursts of 125 to 175 ms are phase- and level-dependent: do not read "150 ms is rejected" into the product. A cough of 200 ms or more, music, television speech or a second speaker can be accepted as activity: the rule is level-based, not a voice classifier.

**A1-03, false activity in noisy rooms.** Target: probability of at least one accepted segment in a silent 8 s window of at most 1 % for rooms that pass the quiet check. Seeded AR(1) noise, 10,000 valid trials per model (`fixtures/dsp/vad-ar1-noise.json`):

| Noise model (spread, correlation) | P(active) | Meets 1 % |
|---|---:|---|
| 2.0 dB, 0.9 | 0.03 % | yes |
| 2.5 dB, 0.5 | 0.00 % | yes |
| 2.5 dB, 0.8 | 0.45 % | yes |
| 3.0 dB, 0.8 | 4.43 % | **no** |
| 3.5 dB, 0.5 | 3.45 % | **no** |
| 3.5 dB, 0.9 | 16.46 % | **no** |

The 10 dB open threshold was kept (raising it would reject soft speakers before real data exists). Consequence: in the noisiest rooms the quiet check still accepts, a silent window can be scored `below today's band` instead of `no_voice`. It cannot become a false `reached`, because that needs a p95 at least 12 dB above the floor. The three noisiest models also pass the quiet check less often (90.2 %, 63.7 % and 69.6 % of attempts valid), so many such rooms are asked to retry instead.

Other measurement limits (see [MEASUREMENT.md](MEASUREMENT.md)): 50 ms frames quantise onsets and durations; a quiet voice that never gets 10 dB above the floor is `no_voice`, not a low score; browser AGC, echo and noise-suppression settings are a request and are reported, never assumed off; the pre-window check is a detection aid, not a guarantee against contamination by TV speech or VoiceView; the wake lock is a request.

## 4. Per-session only

The band is set by the person's own calibration in this room, with this phone in this spot, in this session. A new session sets a new floor and band. There is **no** cross-day loudness comparison, no automatic target increase and no day-to-day dB chart (ADR-0001 section 10). History shows counts and durations per day only, with explicit denominators, and a day with any incomplete session is flagged incomplete. A tone test passing (T04) would not enable cross-day comparison; that needs separate reproducibility evidence across days, placements and sessions and a new ADR.

## 5. "Unqualified phone" labelling

No phone has been qualified. The qualification state per phone description is `not_run`, `passed` or `failed` (A9-02), initially `not_run` everywhere. Until it is `passed` every band result on the TV carries "(unqualified phone)", Settings shows "Not yet qualified on this phone", and `failed` forces Listener Edition (the listener's Heard / Not heard becomes the primary outcome and band verdicts are hidden). The T04 experiment is **frozen but not executed**: commit `270c9dc`, protocol SHA-256 `7059dd75...`, criteria SHA-256 `6b7c339d...` (EV-0030, still identical at `63af0ae`, checked with `python3 fixtures/dsp/tools/freeze_hash.py`). It needs a physical Android phone (B-002) and reviewer approval before any trial. Passing would enable `relative_band` for one phone only; it never establishes dB SPL, audibility, comprehension or clinical meaning.

## 6. UI scale results from the web preview

Source: `QA_STRICT=1 node a11y/run-a11y.mjs` in the clean clone at `63af0ae` (Node 22.23.2, Chrome 154.0.8037.97, react-native-web with shims, canvas 1920 x 1080, 29 screens), `tests/a11y/artifacts/report.json`. **Class web_preview. Not Vega.** The preview applies one multiplier to text, size and space, whereas Vega's spacing type shrinks at larger scales, so overflow may be over-predicted. The ruling for this gate is that vertical scrolling is acceptable at large scales if every control can be focused fully into view and the footer stays visible.

| UI scale | Screens that scroll | Largest overflow | Footer visible on every screen | Horizontal clipping | Controls reached by arrow keys | Controls not fully visible when focused |
|---|---:|---:|---|---|---|---|
| 1.0 | 0 of 29 | 0 px | yes | none | 61 of 61 | 0 |
| 1.25 | 0 of 29 | 0 px | yes | none | 61 of 61 | 0 |
| 1.5 | 3 of 29 (`phrase_active_visible` 6 px, `summary` 231 px, `summary_incomplete` 231 px) | 231 px | yes | none | 61 of 61 | 0 |
| 2.0 | 22 of 29 | 1,070 px (`summary_incomplete`) | yes | none | 61 of 61 | 0 |

axe-core on all 29 screens: 0 critical, 0 serious, 1 moderate (`landmark-unique`, `permission_pending`) and 14 minor nodes on 13 screens (`aria-allowed-role`, from the React Native role `summary` that has no web ARIA equivalent). Focus ring contrast, minimum over screens: 13.26:1. Defects A11Y-01 to A11Y-05 were found by the independent reviewer and fixed and re-verified in the preview (EV-0039). **Pending on a VVD (checklist in `docs/evaluation/A11Y_T17_PREP.md` section 8):** VoiceView order and announcements, the Vega focus engine (including the focus jump to Cancel during an outage, observation OBS-A9), real UI-scale steps, high contrast, and the quiet-window behaviour with VoiceView on (ADR-0008).

## 7. Findings from the release-docs pass (for the owner and the lead)

These were observed while writing and verifying this documentation. None changes a verdict above, and none was fixed here because they are outside the allowed files.

1. **Phone `e2e:production` is host-dependent and failed twice here.** In the clean-clone run, `node e2e/production.mjs` failed three checks (A1: "an unanswered prompt keeps saying Waiting for permission", "Cancel is offered", and the run-completed catch) because a probe in the same headless Chrome 154.0.8037.97 now rejects the real `getUserMedia` with `NotAllowedError` immediately instead of leaving it pending, which the script assumes (its header says "headless Chrome 154 leaves the real getUserMedia pending"). EV-0019 recorded the full `e2e:all` passing earlier. The probable cause is the host's operating-system microphone permission state for Google Chrome having changed between runs (unverified: no privileged access was used and no system setting was changed). The smoke, flow and hostile-QR parts pass; the stubbed-`getUserMedia` production-bundle part (B) did not run because the script aborts in part A. Treat the production-bundle e2e as **not reproduced** on this host until Chrome's microphone permission state is reset by the owner.
2. **TV privacy sentence is stale** (`PRIVACY_LINE`, revision 1 wording, onboarding and pairing screens); see [PRIVACY.md](PRIVACY.md) section 4.
3. **Dependency audit.** `npm audit --omit=dev` is clean for the root workspace but reports 70 findings (5 critical, 44 high) for `apps/tv`, all in React Native and Vega tooling packages reachable from `react-native`'s dependency list. None of the packages carrying an advisory is in the Metro bundle (27 `node_modules` packages), but this is an unresolved audit status, and ADR amendment A7-01 asks for "no unresolved high/critical". Details and the dev-only root findings: [release/SUPPLY_CHAIN.md](release/SUPPLY_CHAIN.md).
4. **Vega packages are not open source.** `@amazon-devices/*` are licensed under Amazon's "Program Materials License Agreement" (`LICENSES.md`).
5. **`buffer` is an undeclared dependency of the TV bundle.** `@amazon-devices/react-native-svg` imports `buffer` without declaring it; the Metro bundle resolved `buffer@5.7.1` and `ieee754@1.2.1`, which are in the lockfile only through the dev tooling chain (`kepler-cli-platform` to `ora` to `bl`).
6. **`npm ls --all --json` on `apps/tv` reports one `missing` edge** (`@atr/protocol@0.1.0` required by `@atr/session-core` through the `file:` link) although `npm ci` succeeds and the build, typecheck and jest pass. The CycloneDX SBOM for `apps/tv` therefore needs `--ignore-npm-errors`.
7. **The TV About screen is composed from two copy sources** (`view.body` from session-core and `apps/tv/src/copy.ts`), which repeats the version and storage lines (from reading the source; not rendered on a device).
8. **`apps/tv` jest prints "A worker process has failed to exit gracefully"** after all 639 tests pass (a leaked handle or timer in the test environment). It does not fail the run.

## 8. Pending external checks (exact owner action, from `.build/blockers.md`)

| Check | Needs | Blocker |
|---|---|---|
| Install the Vega SDK; `vega project doctor`; native build; `vpt validate` on the release package; VVD demo of the remote-only journey; VoiceView, focus, UI scale, AsyncStorage on the VVD; WSS to a locally generated certificate from the Vega runtime; manifest network privileges for WebSocket (the `com.amazon.network.service` entry is unverified) | Owner runs `softwareupdate --install-rosetta --agree-to-license`, then the official installer; or authorizes the lead to run it | B-001 |
| T04 qualification experiment (frozen), T04A mode decision, real permission prompt, AGC and echo read-back, background and wake-lock behaviour, capture indicator, camera-observed latency (at least 20 events), network inspection of a real phone | An Android phone with Chrome, and the owner (or a supervised run) following `docs/evaluation/T04-protocol.md` | B-002 |
| Staging deployment, all `infra/README.md` verify items 1 to 11, kill-switch and rollback rehearsals with timings, alarm delivery, `GoneException` cleanup, log-content check, hosted end-to-end journey, cost versus model | A least-privilege deploy role instead of root keys (`infra/iam/deployer-policy.json`) and a spend authorization | B-003 |
| Physical Fire TV run (OS at least 1.2, developer mode), production-readiness gate | A Fire TV device | B-004 |
| Public repository or judge invitations, video upload, Devpost submission, judge access through 21 Nov 2026 01:30 IST | Owner authorization for each step | B-005 |
| Independent security re-review of the integrated commit (T16); independent release review (T21); clean-clone CI | Lead scheduling | none external |

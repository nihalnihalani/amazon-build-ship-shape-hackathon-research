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

**Known AWS topology gap (T16 finding N-03, major, until fixed).** As built, pairing a phone to an AWS-hosted relay does not work: the phone page dials `wss://<its own host>/ws` (production builds always use the page host), while on AWS the page is served by CloudFront and the socket lives on a different `execute-api` host; the template has no relay origin or `/ws` behaviour on the distribution, and the production phone build cannot be told another URL. The local path is unaffected. The lead's decision is to give the production phone build the relay URL at build time (`VITE_ATR_RELAY_URL`), to let the TV point the QR and link at the phone page host (`phonePageOrigin`, contract revision 3: the optional field exists in `packages/session-core/src/contract.ts`, but nothing reads it yet, `urls.ts` still derives the page origin from the relay URL), and to name the API host in the template's CSP. The phone-build, TV-wiring and template parts had **not landed at `ac556df`**, and this must be resolved before any staging deployment.

## 2. Measured, fixture and pending, by area

Evidence classes are exactly those in the evidence log: `automated` (a command run on this host with exit code and counts), `fixture_replay`, `web_preview` (react-native-web in desktop Chrome, not Vega) and `documentation_only`. No entry in the log has the class `real_phone`, `real_VVD` or `physical_Fire_TV`. **No class is promoted to another.**

| Area | What was actually run | Class | Result (commit, source) | What it does **not** show |
|---|---|---|---|---|
| Wire protocol | `@atr/protocol` build, typecheck, 921 tests incl. a test that parses `PROTOCOL.md`; 3,000 honest DSP windows and 282,193 level frames with zero false rejects | automated | pass (EV-0026; rerun in the clean clone, see TESTING.md) | Behaviour of `String.prototype.normalize` and the validators on Hermes (Vega runtime); only Node 22, 24 and 25 were used |
| DSP arithmetic | `@atr/phone-mic-meter`: 450 tests; independent Python oracle reproduced every hand-derived fixture (39 quiet-check, 21 VAD, 27 window, 20 soft-window cases, phase sweep, click trains, AR(1) noise); 19 of 19 mutations killed | automated + fixture | pass (EV-0029) | **Not a measurement of any microphone, phone, browser or room.** Fixtures prove arithmetic and state handling only |
| TV session logic | `@atr/session-core`: 378 tests (371 at `63af0ae`); independent QA suite 163 of 163 with `QA_STRICT=1`; 29 of 29 mutations killed (EV-0028) | automated (fakes) | pass (EV-0032, EV-0040) | Real AsyncStorage, real timers on a TV, VoiceView announcements |
| TV app code | `apps/tv` (Node 22): `tsc --noEmit` 0 errors against the published `@amazon-devices` types; jest 30 suites, 646 tests (29 and 639 at `63af0ae`) with **mocked** Vega native modules; a Metro JS bundle for platform `kepler` builds (1.54 MB) and passes the console-strip check | automated | pass (EV-0014, EV-0033, EV-0040; clean-clone rerun in TESTING.md) | **Not a native Vega build.** `build-vega`, `.vpkg`, `vpt validate`, the manifest in `apps/tv/manifest.toml` (unvalidated by `vega project doctor`) and rendering are untested |
| Relay (core, local server) | 1,111 tests plus 2 more that run when `cfn-lint` is installed (1,113 with the venv); real HTTPS/WSS server on loopback with a throwaway CA; security suites run on the memory store and a strict DynamoDB model | automated | pass (EV-0024, EV-0034, EV-0040) | The DynamoDB model is not DynamoDB; loopback is not a LAN or the internet |
| AWS adapter and IaC | Lambda handlers against fakes; `cfn-lint` 1.57.1 exits 0 for ap-south-1; infra assertions that fail on deliberately broken templates | automated | pass | Nothing ran on AWS (B-003): SQS deadlines, `GoneException` cleanup, SSM decrypt, CloudFront headers, alarms, budget, rollback and cost are **pending** |
| Phone page | `@atr/phone`: 459 unit tests (happy-dom); real-Chrome scripts with **synthetic or stubbed** audio: smoke, flow and hostile-QR | automated + fixture_replay | pass (EV-0019, EV-0043). The production script was host-dependent and failed in the first clean-clone rerun; it was reworked and merged, see section 7 | No real microphone, no Android Chrome, no permission prompt, no real AGC behaviour |
| Complete local session | Headless TV core, real local relay (HTTPS/WSS, dev CA) and the phone `dist-test` build in system Chrome with synthetic audio: pair with number matching and phone confirmation, quiet check, calibration, vowel, 10 phrases (blind 3, 6, 9; retry; skip; cue; listener timeout), summary equal to hand-derived values | automated | 4 of 4, about 103 to 108 s (EV-0037; rerun in TESTING.md) | Synthetic sine audio, loopback, headless TV with no Vega UI. **Not** a phone-to-TV demonstration |
| Failure recovery | Fault-injecting WSS proxies on both legs: TV link loss, phone link loss, 300 ms latency, duplicated frames, hidden page, noisier room, continuous sound, digital silence | automated | 8 of 8 (EV-0038) | Synthetic faults on loopback; Lambda errors, cold starts and credential expiry on AWS are only unit-tested |
| Accessibility and scale | `QA_STRICT=1 node a11y/run-a11y.mjs`: 29 fixture screens plus real-store keyboard journeys at scales 1.0, 1.25, 1.5 and 2.0; axe-core 4.13.0 | web_preview | 59 of 59, axe no serious or critical (EV-0039) | **Not VoiceView, not the Vega focus engine, not the real UI-scale setting.** Preview navigation and scale are shims. T17 itself is `blocked_external` |
| Independent reviews | ADR review (8 accept-with-changes, ADR-0007 accept, 228 adversarial probes), protocol review, QA reviews of T11, T13, T14 and the accessibility gate | documentation_only and automated | accepted with rework, rework verified (EV-0023, EV-0027, EV-0031) | An independent release review (T21) is `pending`. The T16 security gate on the integrated commit is the next row |
| Security and privacy gate (T16) | `npm run test:security -w @atr/tests` against the local relay as a child process (real HTTPS and WSS with a name-constrained dev CA, raw `ws` sockets), the phone page in desktop Chrome, the headless TV core and the TV web preview; plus the 236-row protocol probe script and a re-review of every T02 finding | automated, web_preview and documentation_only | **PASS WITH RESIDUALS** for the local relay, phone page and TV session core, on `da018d7` (11 files, 113 tests; probes 200 PASS, 36 INFO, 0 FAIL, 0 GAP; EV-0044). 66 T02 findings re-reviewed: 46 closed, 18 closed-with-residual, 0 open, 2 pending_external. 14 new findings (N-01 to N-14): 4 major, 8 minor, 1 info, 1 closed. Details in section 9 | **No AWS, no real phone, no VVD.** The AWS adapter was reviewed by reading only. Many-source and IPv6 abuse limits, the SQS timers, real DynamoDB conditional writes and device behaviour are `pending_external`. The T04 protocol revision 2 was rejected (section 5) |
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

The 10 dB open threshold was kept (raising it would reject soft speakers before real data exists). Consequence: in the noisiest rooms the quiet check still accepts, and a silent window can be scored `below today's band` instead of `no_voice`. **A silent window being scored `reached` is very unlikely but possible.** The T16 security gate simulated it (finding N-05; unconditioned AR(1) model, silent 8 s window, floor equal to the mean, calibration margin 13 dB, 20,000 seeded trials per cell) and found a silent window scored `reached` in **0.015 %, 0.3 % and 2.3 %** of trials in the three noisiest admissible rooms (spread and correlation 2.5 dB and 0.9, 3.0 dB and 0.8, 3.5 dB and 0.9; the same model gives an accepted segment in 0.3 %, 2.3 % and 10.2 %). That model does not condition on passing the quiet check, so its figures are upper figures for the room class, and they differ from the conditioned fixture figures in the table above, which the gate did not reproduce. An earlier version of this section and of amendment A1-03 said a silent window "cannot become a false `reached`"; that was an over-claim, corrected here and by an erratum in `docs/adr/AMENDMENTS-REV2.md`. T04 revision 3 is to add the negative case "silent speaker in the real quiet room, 0 of 10 reached" as a reported value. The three noisiest fixture models also pass the quiet check less often (90.2 %, 63.7 % and 69.6 % of attempts valid), so many such rooms are asked to retry instead.

Other measurement limits (see [MEASUREMENT.md](MEASUREMENT.md)): 50 ms frames quantise onsets and durations; a quiet voice that never gets 10 dB above the floor is `no_voice`, not a low score; browser AGC, echo and noise-suppression settings are a request and are reported, never assumed off; the pre-window check is a detection aid, not a guarantee against contamination by TV speech or VoiceView; the wake lock is a request.

## 4. Per-session only

The band is set by the person's own calibration in this room, with this phone in this spot, in this session. A new session sets a new floor and band. There is **no** cross-day loudness comparison, no automatic target increase and no day-to-day dB chart (ADR-0001 section 10). History shows counts and durations per day only, with explicit denominators, and a day with any incomplete session is flagged incomplete. A tone test passing (T04) would not enable cross-day comparison; that needs separate reproducibility evidence across days, placements and sessions and a new ADR.

## 5. "Unqualified phone" labelling

No phone has been qualified. The qualification state per phone description is `not_run`, `passed` or `failed` (A9-02), initially `not_run` everywhere. Until it is `passed` every band result on the TV carries "(unqualified phone)", Settings shows "Not yet qualified on this phone", and `failed` forces Listener Edition (the listener's Heard / Not heard becomes the primary outcome and band verdicts are hidden). The T04 qualification protocol **revision 2** (frozen at commit `270c9dc`, protocol SHA-256 `7059dd75...`, criteria SHA-256 `6b7c339d...`, EV-0030) was **rejected as frozen** by the independent security review (T16 gate, `docs/security/T16_GATE.md` section 7, at `da018d7`). The reasons: the analysis trusts the nominal levels the caller supplies (N-08), missing or malformed negative-case results pass criterion C7 (N-09), trial validity is a caller-supplied flag (N-10), a `params` override can relax any criterion (N-11), `percentile.ts` is not covered by the freeze hash (N-13), numeric inputs are not validated as finite, and the N-05 negative case is missing. **Revision 3 is in progress**: it must be re-frozen with new hashes, re-recorded in `.build/evidence.jsonl` and re-reviewed before any trial. The hashes above identify revision 2 only, which is **not approved**. In any case no trial has run: it needs a physical Android phone (B-002). Passing would enable `relative_band` for one phone only; it never establishes dB SPL, audibility, comprehension or clinical meaning.

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

1. **Phone `e2e:production` was host-dependent and failed twice in the first clean-clone run; reworked and now passing.** At `63af0ae` the script assumed headless Chrome 154 leaves a real, unanswered `getUserMedia` pending, but on this host the same Chrome rejects it at once with `NotAllowedError` (probable cause: the macOS microphone permission state for Chrome; unverified, no system setting was changed). The phone owner's rework (merged `734c20b`) accepts both outcomes, checks each against its own UI and prints which one happened; at `ac556df` it passed twice here (31 checks, `immediate_not_allowed` after about 72 ms, including the previously unreachable stubbed-audio part) and once with `ATR_E2E_SIMULATE=pending` (30 checks, labelled SIMULATED). The pending branch is therefore evidenced on this host only as a simulation, and a real phone's permission prompt is still untested (B-002). Detail: [TESTING.md](TESTING.md) section 2.
2. **TV privacy sentence was stale: resolved in session-core** (`PRIVACY_LINE` is now the exact A2-01 sentence, merged at `cfa5158`, checked by `packages/session-core/test/privacy-copy.test.ts`); see [PRIVACY.md](PRIVACY.md) section 4.
3. **Dependency audit.** After the bumps recorded in `AMENDMENTS-REV2.md` (`vitest` 3.2.7, the `tests` workspace `ws` 8.22.0) `npm audit --omit=dev` is clean for the root workspace (0 findings, rechecked on the merged lockfile) and `npm audit` including dev reports 2 moderate findings in `vitest` and `@vitest/mocker` (advisory range below 4.1.11; the fix is a semver-major upgrade) that the lead accepted for development use only. `apps/tv` still reports 70 findings (5 critical, 44 high) in React Native and Vega tooling reachable from `react-native`'s dependency list; none of the packages carrying an advisory is in the 27-package Metro bundle. The lead recorded this as an **A7-01 exception for build-time tooling only** (it does not cover any package that ships in the bundle; re-audit at every SDK bump and before any public release). Details: [release/SUPPLY_CHAIN.md](release/SUPPLY_CHAIN.md).
4. **Vega packages are not open source.** `@amazon-devices/*` are licensed under Amazon's "Program Materials License Agreement" (`LICENSES.md`).
5. **`buffer` is an undeclared dependency of the TV bundle.** `@amazon-devices/react-native-svg` imports `buffer` without declaring it; the Metro bundle resolved `buffer@5.7.1` and `ieee754@1.2.1`, which are in the lockfile only through the dev tooling chain (`kepler-cli-platform` to `ora` to `bl`).
6. **`npm ls --all --json` on `apps/tv` reports one `missing` edge** (`@atr/protocol@0.1.0` required by `@atr/session-core` through the `file:` link) although `npm ci` succeeds and the build, typecheck and jest pass. The CycloneDX SBOM for `apps/tv` therefore needs `--ignore-npm-errors`.
7. **The TV About screen's second copy source is fixed** (`99da796`, merged): the privacy and storage disclosure is rendered once from the session-core About lines (`view.body`), and `apps/tv` keeps only a one-line licence notice and, when the body has none, the version. Checked by reading the diff and by the new `apps/tv/src/__tests__/about.test.tsx` (the `apps/tv` jest suite is 30 suites / 646 tests at `ac556df`, `tsc` exit 0). Not seen on a Vega device.
8. **`apps/tv` jest prints "A worker process has failed to exit gracefully"** after all 639 tests pass (a leaked handle or timer in the test environment). It does not fail the run.

## 8. Pending external checks (exact owner action, from `.build/blockers.md`)

| Check | Needs | Blocker |
|---|---|---|
| Install the Vega SDK; `vega project doctor`; native build; `vpt validate` on the release package; VVD demo of the remote-only journey; VoiceView, focus, UI scale, AsyncStorage on the VVD; WSS to a locally generated certificate from the Vega runtime; manifest network privileges for WebSocket (the `com.amazon.network.service` entry is unverified) | Owner runs `softwareupdate --install-rosetta --agree-to-license`, then the official installer; or authorizes the lead to run it | B-001 |
| T04 qualification experiment (protocol revision 3 in progress, to be re-frozen and re-reviewed; revision 2 rejected), T04A mode decision, real permission prompt, AGC and echo read-back, background and wake-lock behaviour, capture indicator, camera-observed latency (at least 20 events), network inspection of a real phone | An Android phone with Chrome, and the owner (or a supervised run) following `docs/evaluation/T04-protocol.md` | B-002 |
| Staging deployment, all `infra/README.md` verify items 1 to 11, kill-switch and rollback rehearsals with timings, alarm delivery, `GoneException` cleanup, log-content check, hosted end-to-end journey, cost versus model | A least-privilege deploy role instead of root keys (`infra/iam/deployer-policy.json`) and a spend authorization | B-003 |
| Physical Fire TV run (OS at least 1.2, developer mode), production-readiness gate | A Fire TV device | B-004 |
| Public repository or judge invitations, video upload, Devpost submission, judge access through 21 Nov 2026 01:30 IST | Owner authorization for each step | B-005 |
| Independent release review (T21); clean-clone CI; re-review of the T16 residual fixes (N-01, N-02, N-03, N-06, N-07, N-12) once they land; T04 revision 3 re-review | Lead scheduling | none external |

## 9. T16 security and privacy gate: verdict, decisions and residual register

Source: `docs/security/T16_GATE.md` (independent reviewer, role security-review, model `claude-sonnet-5-5` as stated in its own context), decisions in `docs/adr/AMENDMENTS-REV2.md` ("T16 security gate decisions"), evidence EV-0044. The gate tested `da018d7` on a single development host (macOS 27.0.1, Node 25.2.1, desktop Chrome 154). Evidence classes: `automated`, `web_preview` and `documentation_only`; **no `real_phone`, `real_VVD` or AWS evidence**, and nothing in the gate called AWS.

**Verdict: PASS WITH RESIDUALS**, for this scope only: the local relay, the phone page and the TV session core, run on a development machine. It is not a plain pass because two major findings are open (N-01, N-03), the T04 qualification analysis has two major integrity holes (N-08, N-09), and every AWS and device check is pending. It is not a fail because no blocker is open: the three T02 blockers (A3-01 phone-side confirmation, A4-01 hidden-meter leak, A9-01 compression passing the criteria) are closed or closed with a stated residual, no shipped privacy claim is contradicted by what the code sends, stores or logs, no credential, code, phrase, cue or label appears in a relay log, and no audio-like payload leaves the phone.

Conditions attached to the verdict: (1) **AWS is not cleared**: every AWS-only check is `pending_external` and N-03 must be resolved before any staging deployment; (2) the T04 protocol revision 2 was rejected (section 5); (3) N-01, N-02 and the wording fixes N-05 and N-14 should be fixed before the demo is recorded.

### Findings from the gate, with the lead's decisions

State at `ac556df`. "Routed" means the lead assigned the fix to the named owner; code reading in this pass found **N-01, N-02, N-03 and N-06 not yet landed** (the phone still treats `unauthorized` on resume as fatal; the local server's CSP is still `connect-src 'self' wss:` with `worker-src 'self' blob:`; there is no `VITE_ATR_RELAY_URL`; the dev CA script still uses 3650 days). N-07 and N-12 were not checked.

| Finding | Severity | What it is | Decision | State |
|---|---|---|---|---|
| N-01 | major | A legitimate reconnect over a half-open socket is refused by the supersede guard and the phone reports the pairing lost (household must pair again) | Phone retries a refused `auth.resume` for 30 s before concluding the pairing is lost; message "Could not reconnect" | routed (phone), not landed |
| N-02 | minor | CSP allows any `wss:` host and a `blob:` worker | `connect-src 'self'` plus the configured relay origin only; drop `blob:` | routed (relay, phone), not landed |
| N-03 | major, pending_external | AWS topology cannot pair a phone (see the callout in section 1) | Build-time relay URL for the production phone build, `phonePageOrigin` (contract revision 3), template CSP names the API host | routed; only the optional contract field exists, nothing uses it yet |
| N-04 | closed | TV privacy line was the revision 1 sentence | fixed in session-core `0061d83` | closed |
| N-05 | minor | "Cannot become a false reached" over-claim | Reworded (section 3: 0.015 %, 0.3 %, 2.3 %); T04 adds the negative case "silent speaker, 0 of 10 reached" | wording fixed |
| N-06 | minor | Dev CA valid 3650 days (amendments say short-lived) | 90 days | routed (relay), not landed |
| N-07 | minor | Phone keeps the household phrases in memory after the TV deleted its data | Clear phrase state with the credential on unpair, room close or discarded session | routed (phone) |
| N-08, N-09 | major (T04) | The slope criterion trusts caller-supplied nominal levels; missing or malformed negative-case results pass C7 | T04 revision 3: frozen nominal levels enforced, strict C7 | in progress (dsp) |
| N-10, N-11, N-13 | minor (T04) | Trial validity is a caller flag; `params` can be overridden; `percentile.ts` is not hashed | T04 revision 3: full planned trial list with exclusion reasons, no override, `percentile.ts` hashed, finite-input validation; re-freeze and re-review | in progress (dsp) |
| N-12 | minor | A paired TV can chain measurement windows with no budget | Phone budget: 5 min cumulative capture per session, at least 1 s between windows, microphone auto-off after 10 min without a TV command (visible message) | routed (phone) |
| N-14 | info | ADR-0002 body quoted the revision 1 sentence | updated to the revision 2 sentence | done |

### Residual-risk register (R1 to R23, as updated by the gate)

| ID | Residual | Status |
|---|---|---|
| R1 | A compromised relay operator sees all payloads and can forge both roles; no end-to-end authentication | accepted and disclosed (the relay is not end-to-end encrypted) |
| R2 | A compromised TV process holds the TV credential | reduced: 2 h lifetime with rotation; reuse closes the room |
| R3 | AsyncStorage is unencrypted | accepted and disclosed; the phrase bank persists until deleted |
| R4 | Covert channels in permitted fields | reduced by quantisation and the audio guard, not eliminated |
| R5 | TV speech or VoiceView during a window counts as voice | unchanged; suppression and the lead time shipped; measured only on a VVD (T17) |
| R6 | Per-source limits behind shared NAT | delay instead of block; tuning at staging |
| R7 | The pairing code is visible on the TV | reduced by number matching and burn on reject |
| R8 | Non-browser attackers can forge `Origin` | accepted; credentials and TV confirmation are the control |
| R9 | Hermes `normalize` unverified | self-test shipped; **pending_external** |
| R10 | API Gateway, WAF and CloudFront limits unverified | **pending_external** |
| R11 | A paired malicious phone can fabricate self-consistent results (the TV re-checks internal consistency only) | accepted |
| R12 | A user-installed CA widens the phone's trust | name-constrained yes, short-lived no until N-06 lands |
| R13 | Denial of wallet | throttles verified in the template only; **pending_external** |
| R14 | Half-open reconnect refused, pairing reported lost (N-01) | open, fix routed |
| R15 | 60 s grace after a lost `auth.ok`: a thief holding the consumed credential obtains the next one | documented, confirmed by test |
| R16 | T04 analysis holes (N-08 to N-11, N-13) | open, blocks T04; revision 3 in progress |
| R17 | A paired TV can chain windows with no budget (N-12) | open, fix routed |
| R18 | `apps/tv` has 70 advisories (5 critical) in React Native and Vega build and CLI tooling | accepted by the lead as an A7-01 exception; none of the 27 bundled packages carries an advisory of its own; re-audit at every SDK bump |
| R19 | CSP `connect-src` allows any `wss:` host (N-02) | open, fix routed |
| R20 | A silent window can be scored `reached` in the noisiest admissible rooms (N-05) | wording fixed; T04 negative case pending |
| R21 | The phone keeps phrases in memory after the TV deletes (N-07) | open, fix routed |
| R22 | AWS topology cannot pair a phone (N-03) | open, **pending_external**, must be fixed before staging |
| R23 | Two dev-only vitest moderates remain after the 3.2.7 bump | accepted for development use |

### What the gate did not cover

SEC-W05 (microphone lifecycle on a real phone) and SEC-T09 (rendering on the TV) were not run; SEC-T07 (a flood against the TV) was not run; SEC-M02 (a TV cross-check of the level stream against the window summary) has no subject because the control does not exist (R11). The AWS checks listed in the gate's section 8 (SQS deadlines and close behaviour, API Gateway `$connect`, WAF, bucket access, throttles and alarms, `GoneException` handling, hosted logs, real DynamoDB conditional writes, secret handling and a non-root deploy role) remain `pending_external` (B-003). The gate's own limits (single host, synthetic noise and compression models, headless TV, code reading for A4-04, A4-05, A4-06 and A8-01) are in its section 9.

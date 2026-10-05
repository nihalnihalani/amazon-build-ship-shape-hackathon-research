# What is left: Across the Room (Fire TV / Vega)

Status as of **5 October 2026 (IST)** on branch `build/across-the-room`. The sources of truth are:

- `.build/task-graph.json` (`python3 .build/tools/graph.py status`)
- `.build/blockers.md`
- `.build/release-status.json`
- `.build/evidence.jsonl`
- `docs/submission/SUBMISSION_CHECKLIST.md`
- `docs/security/T16_GATE.md`

An independent verification pass of three read-only agents checked this file against those records before it was published.

**Short answer:** the code is written and every automated suite passed at commit `6291c90` (evidence EV-0050), but the project is **not complete**.

- **No native build:** the TV app has never been built with the Vega toolchain or run on the Vega Virtual Device (VVD). Only a Metro JavaScript bundle exists.
- **T18 in progress:** T18, the automated integration and clean-build gate, is still in progress because CI has never run on GitHub.
- **Readiness flags:** all four are `false`.
- **Who unblocks the rest:** most remaining gates first need owner actions, namely hardware, licence acceptance, AWS authorization and publication decisions.
- **Doable now:** a few items need no outside help: the T04 harness build and review, the N8 decision (R25), and the SEC-T07 flood test.

## Dates

| Event | India time |
|---|---|
| Kill criterion K1, early reversal: if Android AGC-off readings fail on two phones, switch plan (`research/RECOMMENDATION.md` §5.3) | Tue 6 Oct evening |
| Kill criterion K2, hard stop: Vega Hello World on the VVD (this is blocker B-001) | Wed 7 Oct 20:00 |
| **Abandon milestone**, the plan's primary gate: (a) the VVD runs the app and the relay delivers, (b) AGC-off monotonicity passes on one phone, (c) silent windows and the noise-floor gate work; otherwise apply RECOMMENDATION.md §5.3 | **Thu 8 Oct 20:00** |
| K4 scope freeze: the core loop in one unedited VVD take | Wed 14 Oct 20:00 |
| Feature freeze (our own date) | Mon 19 Oct 12:00 |
| Video takes on the VVD | Tue 20 – Wed 21 Oct |
| AWS promotional credit request (optional, owner) | 22 Oct 00:30 (21 Oct 12:00 PDT) |
| Internal submission target (our own date, leaving a reserve day) | 22 Oct 20:00 (07:30 PDT) |
| **Official submission deadline** (23 Oct 12:00 PDT) | **24 Oct 00:30** |
| Free judge access must last until the official judging end (20 Nov 12:00 PST) | 21 Nov 01:30 |

Re-read the [Official Rules](https://amazonappdev2026.devpost.com/rules) before submitting. The rules prevail over the schedule page.

## What is done (automated evidence only)

**Full automated matrix green at `6291c90` (EV-0050):**

| Suite | Result |
|---|---|
| Workspace | 3,761 tests (2 skipped) |
| TV app | typecheck, 678 jest tests, JS bundle |
| Strict accessibility gate | 59/59, in a react-native-web preview, **not Vega** |
| End-to-end (full local session plus 8 injected-fault scenarios) | 12/12 |
| Reviewer end-to-end checks | 13/13 |
| Security suite (12 files) | 130/130 |

The opt-in slow budget test passed separately at `79b04ff` (EV-0051, 1/1 in 317 s).

**Independent reviews:**

- **Security gate:** pass-with-residuals for the local scope. No blocker, major or minor finding is open locally. N-15 (info) is open. A3-09 (major: AWS SQS auth deadlines) and A8-04 (minor: VoiceView timing on the VVD) are `pending_external`.
- **QA:** accepted the local journey (T12, 5/5 runs). It accepted failure recovery (T15) with defects: 8/10 runs passed, the failures were setup timeouts and never a wrong verdict, and QA-E2E-01 has since been fixed.
- **T04 phone-qualification protocol:** revision 3 is approved and frozen, hash `b9b931007711a5e491c38dd295c2bedaca437887dcab1a5ea320327abdb99c66` (EV-0046/EV-0047). It has not been executed.

**Task status:**

- **Verified:** T00, T01, T02, T05, T06, T07, T08, T11, T12, T13, T14, T15.
- **In progress:**
  - T18 needs the first CI run on GitHub. In the graph it also waits on T16 (AWS) and T17 (VVD).
  - T23 is prepared but not published.

**Evidence classes:** everything so far is `automated`, `web_preview`, `fixture_replay` or `documentation_only`. There is **no** `real_phone`, `real_VVD`, `physical_Fire_TV` or AWS evidence.

## 1. Owner actions that unblock the rest

| # | Blocker | What you need to do | Unblocks |
|---|---|---|---|
| B-001 | Rosetta 2 is missing on macOS 27, and the Vega SDK needs it. | See the B-001 steps below. | T03, native T09, the VVD part of T17, T19, T22, the demo for T23 |
| B-002 | No physical Android phone with Chrome. | See the B-002 steps below. | T04, T04A, T19 |
| B-003 | AWS default credentials are the account **root** user, and there is no spend authorization. | See the B-003 steps below. Root keys will not be used. | T10, T12H, the AWS part of T16, T20 |
| B-004 | No physical Vega Fire TV. | Provide a Fire TV on OS ≥ 1.2 with developer mode. | T24, T26 |
| B-005 | Publication decisions are pending. | See the B-005 decisions below. | T23 publication, the CI run |

**B-001 steps:**

1. Free disk space to at least 20 GB. About 18 GiB is free today. `apps/tv/node_modules` is about 0.8 GB, and the merged teammate worktrees under `../atr-worktrees/` can be removed.
2. Install the Homebrew prerequisites: `brew install binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`.
3. Run `softwareupdate --install-rosetta --agree-to-license`. This accepts Apple's licence.
4. Run the official installer: `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env`. It edits your shell profiles and turns SDK telemetry on by default. Alternatively, tell the lead to run it once Rosetta is installed.

**B-002 steps.** Provide an Android phone with Chrome for the taped position on the TV stand. The phone sits 0.2–0.4 m beside the TV, and D = 2.5–3.0 m to the loudspeaker at seat 2. T04 also needs the following kit (`docs/evaluation/T04-protocol.md` §1–§5):

- a fixed loudspeaker and a playback device;
- a tape measure and tape for the marks;
- a camera filming at ≥ 60 fps;
- the TV or an equivalent display;
- at least one consenting volunteer, who also serves as the second speaker for N3 and the listener for T19.

**B-003 steps:**

1. Create a least-privilege deploy role from `infra/iam/deployer-policy.json`, plus the CloudFormation execution role.
2. Give the lead a named profile and a staging budget.
3. Complete the prerequisites in `infra/README.md`:
   - a private SAM artifact bucket;
   - the SAM CLI;
   - check `aws lambda get-account-settings`. If the concurrency quota is 10, deploy with `ReservedConcurrency=-1` or request an increase.
   - choose `MonthlyBudgetUsd`, `AlarmEmail` and `LiveRoomCap`;
   - create the SSM SecureString `/atr/relay/<stage>/hash-secret` before the first deploy.
4. If a stack is used for judging, it must stay up until 21 Nov 01:30 IST. Freeze deployments from 24 Oct, run the RUNBOOK §5 daily checks, and name a delegate who holds the deployer role.

**B-005 decisions:**

- Adopt `docs/release/README.proposed.md` as the root README, or not.
- Repository visibility: public with the MIT licence, or private with judge access.
- Whether `research/`, `.build/` and `tests/a11y/artifacts/` ship.
- The video, the Devpost submission and the judge invitations.
- The AI-assistance disclosure wording.

### Owner and lead decisions with no external blocker

- **Submission gating.** As the task graph stands, T23 (the hackathon package) depends on T22 → T21 → T19 + T20. T19 also depends on T12H and T18, and T12H and T20 need AWS. The hackathon package is therefore formally gated on B-001, B-002 **and** B-003.
  - The Rules require only a working Fire TV/VVD demo, not AWS or a real phone.
  - If AWS or a phone will not be available before 22 Oct, record a decision in `.build/decisions.md` that decouples a hackathon-only path. For example: T23 after T03, T09 and T17 on the VVD, plus a local-relay T19. Then update the graph.
  - Without a real phone, `hackathon_ready` can flip only through an explicit decision that the demo rests on clearly labelled simulated audio, with captions per `docs/submission/VIDEO_STORYBOARD.md` §D.
- **N8 / R25, before the first T04 trial.**
  - Option 1: keep N8 (silent speaker in the real quiet room) as a reported value, as the security reviewer recommends.
  - Option 2: gate it, for example with `limited: noise-sensitive` when N8 > 0. This needs a revision 4, re-freeze and re-approval, which could also fix N-15.
- **Supply-chain exception A7-01.** The lead recorded it; the owner has not yet confirmed it (see section 5).

## 2. Engineering work that follows each unblock

**Runnable now (no blocker)**

- **SEC-T07:** a flood of frames against the TV session core through the local relay. It checks strict `frame_index` ordering and the relay rate limit. Add it to `tests/security`.
- **Build and review the T04 qualification-mode harness.** It is a phone test build only and stays absent from production. It records numbers-only traces. Security residual **R24** requires:
  - `blocked`, `capture_fault` and `interrupted` derived by script from the unmodified traces;
  - a machine-timestamped live log written before results are read, which holds `disturbed`;
  - every excluded attempt printed with its value;
  - a first-attempts-only sensitivity run next to the primary result.
- **T18 work that needs no outside help:**
  - add the accessibility gate to the CI `browser-e2e` job (QA-T18-01 is fixed);
  - add `npm audit` and SBOM steps (SUPPLY_CHAIN.md §8 item 4);
  - keep the requirement-evidence matrix current with `.build/tools/matrix.py`. The five requirements with no owning task (R-B2, R-I2, R-J1, R-P4, R-P5) were mapped on 5 Oct.

**After B-001 (Vega SDK installed)**

1. **T03:**
   - official Hello World on the VVD;
   - `vega project doctor`;
   - remote input logging;
   - WSS from the VVD (trust of the local dev CA on Vega is unknown).
2. **Toolchain decisions** (`docs/COMPATIBILITY.md`):
   - pin the SDK build from `vega --version`;
   - keep RN 0.83 or fall back to the documented RN 0.72 line, deciding on measured evidence only;
   - confirm `kepler-a11y-settings-interface-turbo` 1.0.0 passes doctor on 0.83;
   - freeze the `kepler-cli-platform` version in the lockfile;
   - declare `buffer` explicitly (`@amazon-devices/react-native-svg` imports it undeclared);
   - re-run the audit and SBOM on the SDK-resolved lockfile.
3. **T09 native:**
   - build `apps/tv` under Node 22.22.x (`npm run build:debug` / `build:release`);
   - launch it on the VVD;
   - run `vega exec vpt validate <release.vpkg>` with strict ABI checks;
   - confirm the manifest: whether WebSocket needs a network privilege is an open question, and the official sample also declares `net-info`.
4. **T17 VVD part:**
   - VoiceView reading order and announcement timing (quiet lead 1.5 s, or 3 s with a screen reader);
   - the real D-pad focus engine;
   - UI scale steps;
   - focus-driven scrolling on the Vega `ScrollView`;
   - AsyncStorage persistence across restart;
   - a kill and relaunch mid-capture.

   Checklists are in `docs/evaluation/A11Y_T17_PREP.md` §8 and `QA_REVIEW_T11_T13_T14.md` §9 and §10.7.
5. **Other VVD checks:**
   - the Hermes NFC self-test in Diagnostics (R9/PK-12);
   - Unicode and bidi phrase rendering (SEC-T09) and the Vega text component (SEC-W01);
   - the About screen showing the session-core privacy body;
   - Settings → Delete with a foreign AsyncStorage key present, including a kill mid-delete;
   - kills between the final reveal and the summary, and between Done and Home (QA-02);
   - focus behaviour during a link outage (OBS-A9).
6. **Demo video:** record the take on the VVD (a submission requirement).

**After B-002 (Android phone)**

1. **T04:** run the approved protocol revision 3. Do not edit it; any change needs a re-freeze and re-approval.
2. **T04A:** decide between `relative_band` and Listener Edition from the T04 evidence (ADR-0009). Write it as a new ADR `docs/adr/0010-*`, and record the result honestly even if it fails.
3. **Real-phone checks** (LIMITATIONS §8, T16 §8, QA §9):
   - **Microphone and lifecycle:**
     - permission prompt, denial and revoke (a real pending prompt has only been simulated);
     - browser AGC, echo-cancellation and noise-suppression read-back;
     - background, lock and wake-lock behaviour;
     - the capture indicator off at session end (SEC-W05).
   - **Security and privacy:**
     - the page's CSP and headers on Android Chrome;
     - network inspection of the phone (confirm nothing is uploaded);
     - no level or verdict reaching the phone UI before reveal.
   - **Flows:**
     - drop the link during a window, press Finish early, restore the link, and confirm the microphone stops;
     - the listener's late tap shows "late, not counted", plus the 20 s choice and the cue cap.
   - **Optional:** an iOS Safari row (recorded, not pre-judged), a TalkBack pass and a long soak.

**After B-003 (AWS)**

1. **T10:**
   - deploy staging from `infra/template.yaml` (`ap-south-1` intended; confirm availability);
   - build the phone page with `VITE_ATR_RELAY_URL=<RelayWssUrl>`;
   - configure the TV with `relayUrl` and `phonePageOrigin`.
2. **T12H:** re-run the full journey against staging, including real CloudFront page → API Gateway socket pairing (N-03, never tested).
3. **T16 AWS part.** Run all verify items in `infra/README.md` and every AWS item in `docs/security/T16_GATE.md` §8:
   - the `$connect` Origin policy (A3-08, SEC-A11);
   - WAF and API Gateway limits (R10);
   - throttles under load (R13, SEC-I03);
   - `GoneException`, the 2 h re-dial and a missed `$disconnect` (SEC-I04);
   - SQS auth deadlines (A3-09, SEC-A02, SEC-I08);
   - no execution data or X-Ray;
   - real DynamoDB conditional writes (A3-10);
   - counters and TTL (A2-03, A2-05);
   - secret handling with a non-root role (TM-G6).
4. **T20** (`docs/operations/RUNBOOK.md`):
   - prove alarm evaluation and **actual** notification delivery;
   - the budget alert;
   - a kill-switch disable and recovery drill;
   - a rollback drill.

**T19.** It needs T04A (B-002), T12H (B-003) and T18, plus the VVD (B-001). It is the actual phone + VVD session: camera-observed latency over at least 20 events (p50, p95, max), plus acoustic and negative cases. If live feedback misses its latency target, ship end-of-window results instead of a misleading arc. A local-relay-only T19 would need a recorded graph change.

**Then:**

1. **T21:** independent release review. It needs T19 and T20.
2. **T22:** engineering release candidate (a tagged commit, artifacts and hashes).
3. **After T22**, in parallel:
   - **T23:** the hackathon package.
   - **T24:** physical Fire TV and production readiness. Then **T26:** the public launch, only with owner authorization. T24 also needs:
     - the Amazon Appstore route and its certification (not started);
     - a real privacy notice and support contact;
     - a decision on at-rest protection for the unencrypted AsyncStorage (R3);
     - the Program Materials License Agreement review;
     - owner sign-off.
   - **T25**, optional stretch work: an inline explanation, starter phrases, caregiver export, Polly. It must rerun the affected gates.

## 3. Hackathon submission items still open (`docs/submission/SUBMISSION_CHECKLIST.md`)

**Demo and video (B-001):** a Fire TV demo on the VVD, and a public English video under three minutes showing actual behaviour.
- The owner provides the voice-over, or a TTS licence is recorded.
- Check the final cut for logos, music and third-party footage.

**Devpost (owner):**
- Register the entry (team, email) and confirm the Fire TV track.
- Prepare images, a thumbnail and the team members (none prepared).
- Submit the final form and attestations.
- Judge hardware access on request is blocked by B-004.
- Read the Amazon Program Materials License Agreement for `@amazon-devices/*` (checklist row 15).

**Pre-publication cleanup:**
- **Local paths (P1):** absolute local paths appear in 12 tracked files (9 with the home-directory path, 3 with host temp-directory paths). The two research prompts committed with this file add more. Rerun the grep after cleanup.
- **README decision (P2).**
- **Repository visibility (P3):**
  - decide by 21 Oct;
  - consider the DevRel guidance on AI-generated assets;
  - on the private route, send judge invitations close to submission (they expire after 7 days and must be accepted).
- **Owner draft decisions (P8).**
- **At the release commit (P4, P5):** rerun the full matrix and regenerate licences, the SBOM and the audit.
- **Secret scan:** rerun the secret-pattern scan at the release commit, and run one over the full git history (never done).
- **On the day (P7, P9):** re-read the Rules, tag the submitted commit, and check access from a logged-out browser on submission day and again when judging starts.

**Mini-challenges:**
- **Open Source:** needs a *new, separate* OSS project or contribution, with its URL and the GitHub username. The candidates are `@atr/ten-foot-meter` and `@atr/phone-mic-meter` as their own repository, while the reassessment favours a reusable Vega remote-session kit. This depends on the owner.
- **AWS Builder:** requires a documented actual AWS integration (B-003).

**Friction log and feedback:** `docs/submission/FEEDBACK.md` and `FRICTION_LOG.md` contain only real, referenced entries. Add VVD and phone entries once those runs happen.

## 4. Product direction question from the 5 October reassessment

`research/HACKATHON_REASSESSMENT_2026-10-05.md` is a separate research pass. It recommends qualifying **Across the Room: the Carryover Check**:

- **What it is:** the speaker's self-rating, the listener's report and a separately qualified relative microphone signal, each revealed separately.
- **Four conditions:** a supported real phone, a consenting second person, working native Vega, and a concrete reason households prefer the TV workflow to phone apps such as Loud & Clear and Speak Up.
- **Fallback:** if those gates fail, it recommends qualifying **BorrowBridge** (Alexa+) instead.
- **Approval:** it approves neither for a full build before its gates pass.

**Overlap with what is built:**

- **Already in the app:** hidden first attempts with a speaker rating, the listener Heard/Not heard phase, and a per-session relative meter.
- **What adopting Carryover would still change:** it moves the core away from the "reached" verdict toward the three-way reveal.
- **What it requires first:** the reassessment's falsification gates. At least two consenting intended-user dyads compare the TV loop with a phone-only workflow, and their results are recorded honestly.
- **Then:** a *reviewed* migration of `.build/task-graph.json` against `research/REASSESSMENT_TASK_GRAPH.json` (no overwrite), with its reversal triggers applied.

**Owner decision:** keep the current framing, adopt Carryover after its gates, or switch tracks if the hardware gates fail.

## 5. Known residual risks

**Measurement limits:**
- Relative digital level is not dB SPL, comprehension or intelligibility.
- Results are per-session only.
- Every phone is "unqualified" until T04 passes.

**A silent 8 s window can be scored `reached`.** Simulated rates at noise spreads of 2.5, 3.0 and 3.5 dB are 0.04 %, 0.77 % and 4.8 % per window. 3.5 dB is the noisiest room the quiet check admits. The figures come from the repository's conditioned AR(1) model, not measured noise (`docs/MEASUREMENT.md`). T04 case N8 measures this; it is reported, not gated (R25).

**The A1-03 target is not met.** The target was ≤ 1 % false activity in a silent window. Noisier admissible rooms reach 4.4 %, 3.5 % and 16.5 % in 3 of 6 AR(1) models. The 10 dB open threshold was kept deliberately until T04 data exists.

**Burst acceptance:**
- Bursts of 100 ms or less are never accepted, and 250 ms or more always are.
- 125–175 ms bursts depend on phase and level.
- 200 ms bursts are always accepted at +20 dB, but only at 27 of 40 phases at +10 dB.

**Audit findings in `apps/tv`:** `npm audit` shows 70 findings (5 critical, 44 high), all in React Native and Vega build tooling and none in the 27-package runtime bundle.
- This is exception A7-01, recorded by the lead and **not yet confirmed by the owner**.
- Re-confirm it at the release commit, and re-audit at every SDK bump and before any public release.
- Root production dependencies have 0 findings.

**Security residuals** (T16_GATE.md §13.2, LIMITATIONS.md §9):

| Status | Residuals |
|---|---|
| Accepted or reduced | R1–R8, R11, R12, R15, R18, R20, R23, R25 |
| `pending_external` (VVD or AWS) | R9, R10, R13, R22 |
| Open until the T04 harness review | R24 |
| Closed | R14, R16, R17, R19, R21, R26 |

N-15 (info) is also open.

**CI never run:** `.github/workflows/ci.yml` triggers on pushes to `main` and `build/**`, so pushing this branch starts its first GitHub run. Record the result as T18 evidence with `.build/tools/evidence.py`. The `browser-e2e` job is non-blocking and has never run on Linux.

## 6. How to resume

Open Claude Code in this repository on `build/across-the-room` and follow the **Resume instruction** in `.build/checkpoint.md`. Trust `python3 .build/tools/graph.py status` for task states. Re-run the full matrix (commands in `docs/TESTING.md`) before recording new evidence, and record evidence with `.build/tools/evidence.py`.

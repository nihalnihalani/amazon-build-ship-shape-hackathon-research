# Release status

Status first written at integration commit `63af0ae` and updated at `ac556df` and again at `6291c90` (2026-10-05), after the T16 security gate and then every T16 residual fix, T04 revision 3, the QA review of T12 and T15 and the paced phone outbox were merged. Source of truth: `.build/release-status.json`, `.build/task-graph.json`, `.build/blockers.md` and `.build/evidence.jsonl`. This document explains the four readiness fields from that evidence. It does not decide them: the lead owns the fields, and a field becomes true only when its gate's evidence exists. A missing external gate is never turned green to satisfy a phrase.

| Field | Value today | Reason recorded in `.build/release-status.json` |
|---|---|---|
| `engineering_release_candidate` | **false** | Implementation in progress |
| `hackathon_ready` | **false** | No native Vega build (B-001); no physical phone evidence (B-002) |
| `public_production_ready` | **false** | Requires physical Fire TV (B-004), hosted ops evidence (B-003) and distribution requirements |
| `public_production_launched` | **false** | Requires owner authorization (B-005) after readiness |

The recorded `engineering_release_candidate` reason ("Implementation in progress") is true but incomplete; section 1 lists everything that is still open.

## Blockers (all open)

| ID | Blocks | Blocker | Exact remedy |
|---|---|---|---|
| B-001 | T03, T09 native render, T17 VVD part, T19, T22 | Rosetta 2 absent on macOS 27.0.1; the Vega SDK needs it on Apple Silicon (EV-0002) | Owner runs `softwareupdate --install-rosetta --agree-to-license`, then the official installer (modifies shell profiles, SDK telemetry on by default), or authorizes the lead to run it once Rosetta is present |
| B-002 | T04, T04A, T19 | No physical Android phone, no `adb` | Owner provides an Android phone with Chrome and runs, or supervises, the T04 protocol (`docs/evaluation/T04-protocol.md`, **revision 3, approved and frozen**: EV-0046, EV-0047). The qualification-mode harness that produces the trial list does not exist yet and needs its own review first (T04A) |
| B-003 | T10, T12H, T20 | AWS default credentials are the account root user (EV-0004); no spend authorization | Owner authorizes a staging budget and provides a least-privilege deploy role (draft: `infra/iam/deployer-policy.json`). The AWS topology gap N-03 is **closed in the repository** (build-time relay URL for the phone, `phonePageOrigin` for the TV, CSP and outputs in the template), so a deployment can now be attempted, but **nothing has run against a real CloudFront and API Gateway pair** |
| B-004 | T24, T26 | No physical Vega Fire TV | Owner provides a Fire TV on OS 1.2 or later with developer mode |
| B-005 | T23 publication parts | Public repository, video upload, Devpost submission and judge invitations need owner authorization | Owner reviews the prepared package ([docs/submission](../submission/)) and authorizes each step |

## 1. `engineering_release_candidate`: false

**Definition** (master prompt section 9): all required implementation, automated tests, actual supported-device or VVD checks, security, privacy and accessibility reviews and operational evidence, plus an independent review at the release commit.

**What the evidence supports today**

| Gate | State at `6291c90` | Evidence |
|---|---|---|
| Rules and compatibility (T01), ADRs reviewed (T02) | verified | EV-0007, EV-0008, EV-0011, EV-0023 |
| Protocol, DSP, relay, session logic, phone | T05, T06 and T07 **verified** (after the independent security gate, local scope); T08 (phone) `in_review` pending real-phone checks (B-002); the phone's outgoing messages are paced under the relay's rate limit (QA-E2E-01 fixed) | EV-0009, EV-0026, EV-0012, EV-0029, EV-0024, EV-0034, EV-0019, EV-0043 and the task graph |
| Storage and deletion, hidden meter, listener and reveal | verified by independent QA (T11, T13, T14) | EV-0027, EV-0031, EV-0032 |
| Complete local session (T12), failure recovery (T15) | T12 **verified** (independent QA: accept, 5 of 5 runs); T15 `in_review` (accept with defects: setup or precheck timeouts in 2 of 10 full runs, never a wrong verdict; the shared-relay cascade, QA-E2E-02, and the stale-build hazard, QA-E2E-04, are fixed); 13 added reviewer checks (`npm run test:review-e2e -w @atr/tests`) | EV-0037, EV-0038, EV-0048 |
| Automated clean-build gate (T18) | `in_progress`: the independent QA clean-clone gate passed (EV-0048, `docs/evaluation/T18_CLEAN_BUILD.md`); the root now builds before typecheck and test; a portable Linux CI workflow exists (`.github/workflows/ci.yml`) but **has never been pushed or run**, and its browser job has never run on Linux. A clean-clone run at the release commit is still required (`docs/submission/SUBMISSION_CHECKLIST.md`, P4) | EV-0040, EV-0042, EV-0048 |
| Final automated test matrix at `6291c90` | **all suites exit 0** (class `automated`, plus `web_preview` for the accessibility gate; no real phone, VVD or AWS). Root typecheck 0 errors. Unit tests: protocol 921, phone-mic-meter 497, ten-foot-meter 49, session-core 392, relay 1,135 passed and 2 skipped (the cfn-lint tests), phone 604, tests/review 163. `apps/tv` (Node 22): `tsc` 0 errors, jest 678, `check:bundle` OK. Strict accessibility gate 59 of 59. End-to-end 12 of 12 (journey 4, fault recovery 8). review-e2e 13 of 13. Security 12 files, 130 of 130. The opt-in slow budget test was still running when the matrix was delivered; the docs worktree's own run at `6291c90` passed (1 test, exit 0) | EV-0050 (lead); details and caveats in [TESTING.md](../TESTING.md) |
| Security and privacy gate (T16) | **PASS WITH RESIDUALS** for the local relay, phone page and TV session core (`da018d7`), then **every residual fix merged and re-verified** (`15f345b`): N-01, N-02, N-06, N-07 and N-12 closed, N-03 closed in the repository, R26 closed by the later phone fix; T16 is recorded `blocked_external` only because the deployed-log, IAM and CloudFront checks need an AWS staging account (B-003). Open: R15, R24, R25, the informational N-15 and the `pending_external` items. Residual register: [LIMITATIONS.md](../LIMITATIONS.md) section 9 | EV-0044, EV-0049, `docs/security/T16_GATE.md` (sections 11 and 12), `docs/adr/AMENDMENTS-REV2.md` |
| Accessibility and scale gate (T17) | web preview passes (59 of 59); **blocked_external** for VoiceView, the Vega focus engine and real UI scale | EV-0039 (class `web_preview`) |
| Native TV build, `vega project doctor`, `vpt validate`, VVD run (T03, T09 native) | **blocked_external (B-001)** | none |
| Physical microphone qualification (T04, T04A) and phone/VVD acoustic and latency gate (T19) | **blocked_external (B-002)**. T04 protocol **revision 3 is APPROVED and frozen** (revision 2 was rejected at `da018d7`); **it has not been executed**, and the qualification-mode harness does not exist yet. Residuals R24 (self-declared exclusion reasons) and R25 (N8 reported, not gated) | EV-0046, EV-0047 (EV-0030 is revision 2, superseded), `docs/security/T16_GATE.md` section 11 |
| Hosted relay, hosted end-to-end, operations rehearsals (T10, T12H, T20) | **blocked_external (B-003)**; template lints, nothing deployed; the N-03 topology gap is closed in the repository and untested on AWS | EV-0004, `infra/README.md`, EV-0049 |
| Dependency audit (ADR amendment A7-01) | root `--omit=dev` clean (0) after the `vitest` 3.2.7 and `ws` 8.22.0 bumps; 2 dev-only moderates remain (accepted for development use); **`apps/tv` still has 70 findings (5 critical, 44 high)**, none in the shipped JavaScript bundle, recorded by the lead as an **A7-01 exception for build-time tooling** (re-audit at every SDK bump and before any public release) | [SUPPLY_CHAIN.md](SUPPLY_CHAIN.md), `docs/adr/AMENDMENTS-REV2.md` |
| Independent release review at the release commit (T21), release candidate task (T22) | **pending** | none |

**What flips it to true:** B-001 and B-002 cleared with real VVD and real phone evidence recorded under their own classes; T09 native, T17, T19 verified; T10, T12H and T20 verified on an authorized staging account (B-003), which also closes the AWS part of T16; the T04 harness reviewed (T04A) and the approved revision 3 executed on a real phone; the T21 independent release review at one release commit; T08 and T15 moved to `verified`; a clean-clone run at the release commit, and the CI workflow actually run; and the `apps/tv` audit exception re-confirmed at the release commit (it is recorded by the lead, not yet by the owner). The T16 code residuals no longer block this field. `next_action`: owner clears B-001 first (it unblocks the native build, the VVD demo and most of the rest).

## 2. `hackathon_ready`: false

**Definition used here:** the hackathon package is complete and every check it claims has been run: a demo-ready Fire TV app shown on the Vega Virtual Device (or a Fire TV), a public English video under three minutes, a repository with setup and test instructions and a detectable licence, product feedback, an honest measured-versus-fixture table, track and challenge selections, and judge access that will stay free until 21 November 2026 01:30 IST. Publication steps need owner authorization (B-005) but are separate from readiness.

**What exists** (prepared, nothing sent): the documents under `docs/` (setup, testing, architecture, privacy, limitations), the proposed README, licence and supply-chain files, and `docs/submission/` (Devpost draft, track and challenge notes, video storyboard, feedback, friction log, work-in-window, judge access, checklist).

**What is missing**

- The required Fire TV demo: the app has never run on a VVD or Fire TV (B-001). The Official Rules accept a Fire TV/Vega simulator if captioned as such; a desktop web preview does not satisfy the track.
- The recorded video, which can show only web-preview, test-run and architecture material until B-001 clears (`docs/submission/VIDEO_STORYBOARD.md`).
- Physical-phone evidence (B-002), which the recorded gate asks for. The T04 qualification protocol revision 3 is approved but has not been executed, and its harness does not exist yet.
- The T16 conditions that applied before recording (N-01 reconnect, N-02 CSP) are **met**: both fixes are merged and verified. What remains from the gate is AWS-only and applies to any claim about a hosted relay (N-03 in the repository only).
- A public or shared repository (B-005); the video upload and the Devpost form (B-005).
- AWS Builder claims need an actual deployment (B-003); the Open Source challenge needs a separate public repository, a URL and a username (owner).

**What flips it to true:** the VVD demo built from a successful `vega project doctor` and `vpt validate` and recorded with the correct caption; the video recorded and approved; real-phone evidence recorded (or an explicit owner and lead decision, recorded in `.build/decisions.md`, that the demo may rest on labelled simulated audio); the Official Rules re-read on the day; and `docs/submission/SUBMISSION_CHECKLIST.md` showing every required line done. Deadline: **24 October 2026 00:30 IST** (23 October 12:00 PDT); internal target 22 October 20:00 IST.

## 3. `public_production_ready`: false

**Definition** (master prompt section 9): everything for an engineering release candidate plus actual consumer-hardware checks, the selected Amazon distribution and certification route, privacy and support disclosures, owner sign-off and any applicable professional review. Amazon's run guide requires physical Fire TV testing before Appstore submission.

**What is missing:** a physical Fire TV run (B-004); the T16 residuals that are pending external checks (the real CloudFront-to-API-Gateway path of N-03, the other AWS-only items, Hermes `normalize`, device behaviour; see [LIMITATIONS.md](../LIMITATIONS.md) section 9); hosted operations evidence (alarm delivery, kill-switch and rollback rehearsals, cost versus model, log-content check) on a real account (B-003); the Appstore route and its certification (not started); a real privacy notice and support contact (the TV's PRIVACY_LINE also differs from the amended phone copy, see [PRIVACY.md](../PRIVACY.md)); at-rest protection for TV storage if the public deployment needs it (AsyncStorage is unencrypted and no encryption is claimed); the Vega-package licence review (Program Materials License Agreement); owner sign-off.

**What flips it to true:** all of the above recorded, plus `engineering_release_candidate` true at the same commit.

## 4. `public_production_launched`: false

**What is missing:** owner-authorized publication and an accepted distribution (certification passed), an approved rollout, and `public_production_ready` true first. A simulator build is never labelled launched or production ready.

**What flips it to true:** the owner authorizes the launch (B-005) after readiness, the distribution route accepts the package, and the rollout is carried out and recorded. Nothing has been published, pushed, submitted or shared.

## 5. Rules for changing these fields

1. A field changes only with an evidence entry (command, exit code, commit, environment, class) and, where required, an independent reviewer.
2. Evidence classes are never promoted: automated is not `real_phone`, `real_VVD` or `physical_Fire_TV`; a web preview is not a VVD.
3. A new commit or a changed assumption invalidates the affected evidence until it is rerun.
4. This document is updated by the release-docs role when evidence changes; it never sets the JSON itself.

## 6. Note on evidence timestamps

The first version of this document reported that `.build/evidence.jsonl` timestamps from EV-0033 onward were later than the commits they cite. The lead corrected them from the recording commit times (EV-0041; each corrected entry keeps its original value in `timestamp_as_first_recorded`, and the log's timestamps now come from the host clock). The remark is kept for the record; `docs/submission/WORK_IN_WINDOW.md` still uses git commit dates, which now agree with the log. A commit time bounds when evidence was recorded, not when the underlying run happened.

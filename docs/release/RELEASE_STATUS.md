# Release status

Status as of integration commit `63af0ae` (2026-10-05). Source of truth: `.build/release-status.json`, `.build/task-graph.json`, `.build/blockers.md` and `.build/evidence.jsonl`. This document explains the four readiness fields from that evidence. It does not decide them: the lead owns the fields, and a field becomes true only when its gate's evidence exists. A missing external gate is never turned green to satisfy a phrase.

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
| B-002 | T04, T04A, T19 | No physical Android phone, no `adb` | Owner provides an Android phone with Chrome and runs, or supervises, the frozen T04 protocol (`docs/evaluation/T04-protocol.md`) |
| B-003 | T10, T12H, T20 | AWS default credentials are the account root user (EV-0004); no spend authorization | Owner authorizes a staging budget and provides a least-privilege deploy role (draft: `infra/iam/deployer-policy.json`) |
| B-004 | T24, T26 | No physical Vega Fire TV | Owner provides a Fire TV on OS 1.2 or later with developer mode |
| B-005 | T23 publication parts | Public repository, video upload, Devpost submission and judge invitations need owner authorization | Owner reviews the prepared package ([docs/submission](../submission/)) and authorizes each step |

## 1. `engineering_release_candidate`: false

**Definition** (master prompt section 9): all required implementation, automated tests, actual supported-device or VVD checks, security, privacy and accessibility reviews and operational evidence, plus an independent review at the release commit.

**What the evidence supports today**

| Gate | State at `63af0ae` | Evidence |
|---|---|---|
| Rules and compatibility (T01), ADRs reviewed (T02) | verified | EV-0007, EV-0008, EV-0011, EV-0023 |
| Protocol, DSP, relay, phone, session logic | built and green; T05, T06, T07, T08 are `in_review`, not `verified` | EV-0009, EV-0026, EV-0012, EV-0029, EV-0024, EV-0034, EV-0019 |
| Storage and deletion, hidden meter, listener and reveal | verified by independent QA (T11, T13, T14) | EV-0027, EV-0031, EV-0032 |
| Complete local session (T12), failure recovery (T15) | passing, `in_review` | EV-0037 (4 of 4), EV-0038 (8 of 8) |
| Automated clean-build gate (T18) | numbers recorded, task `pending`: "Not yet a clean-clone run; CI workflow not yet added" | EV-0040. This documentation pass ran a clean-clone build and test (docs/TESTING.md); no CI workflow exists yet. |
| Security and privacy gate (T16) | **pending**: an independent re-review of the integrated commit is not recorded | `docs/security/*` reviews were of the revision 1 ADRs and protocol |
| Accessibility and scale gate (T17) | web preview passes (59 of 59); **blocked_external** for VoiceView, the Vega focus engine and real UI scale | EV-0039 (class `web_preview`) |
| Native TV build, `vega project doctor`, `vpt validate`, VVD run (T03, T09 native) | **blocked_external (B-001)** | none |
| Physical microphone qualification (T04, T04A) and phone/VVD acoustic and latency gate (T19) | **blocked_external (B-002)**; protocol frozen, not executed | EV-0030 |
| Hosted relay, hosted end-to-end, operations rehearsals (T10, T12H, T20) | **blocked_external (B-003)**; template lints, nothing deployed | EV-0004, `infra/README.md` |
| Dependency audit (ADR amendment A7-01) | root clean; **`apps/tv` has 70 open findings (5 critical, 44 high)**, none in the shipped JavaScript bundle; root dev-only findings open | [SUPPLY_CHAIN.md](SUPPLY_CHAIN.md) |
| Independent release review at the release commit (T21), release candidate task (T22) | **pending** | none |

**What flips it to true:** B-001 and B-002 cleared with real VVD and real phone evidence recorded under their own classes; T09 native, T17, T19 verified; T10, T12H and T20 verified on an authorized staging account (B-003); T16 re-review and T21 independent release review at one release commit; T05 to T08, T12 and T15 moved to `verified`; a clean-clone CI run (T18); and the `apps/tv` audit status resolved or explicitly accepted by the owner. `next_action`: owner clears B-001 first (it unblocks the native build, the VVD demo and most of the rest).

## 2. `hackathon_ready`: false

**Definition used here:** the hackathon package is complete and every check it claims has been run: a demo-ready Fire TV app shown on the Vega Virtual Device (or a Fire TV), a public English video under three minutes, a repository with setup and test instructions and a detectable licence, product feedback, an honest measured-versus-fixture table, track and challenge selections, and judge access that will stay free until 21 November 2026 01:30 IST. Publication steps need owner authorization (B-005) but are separate from readiness.

**What exists** (prepared, nothing sent): the documents under `docs/` (setup, testing, architecture, privacy, limitations), the proposed README, licence and supply-chain files, and `docs/submission/` (Devpost draft, track and challenge notes, video storyboard, feedback, friction log, work-in-window, judge access, checklist).

**What is missing**

- The required Fire TV demo: the app has never run on a VVD or Fire TV (B-001). The Official Rules accept a Fire TV/Vega simulator if captioned as such; a desktop web preview does not satisfy the track.
- The recorded video, which can show only web-preview, test-run and architecture material until B-001 clears (`docs/submission/VIDEO_STORYBOARD.md`).
- Physical-phone evidence (B-002), which the recorded gate asks for.
- A public or shared repository (B-005); the video upload and the Devpost form (B-005).
- AWS Builder claims need an actual deployment (B-003); the Open Source challenge needs a separate public repository, a URL and a username (owner).

**What flips it to true:** the VVD demo built from a successful `vega project doctor` and `vpt validate` and recorded with the correct caption; the video recorded and approved; real-phone evidence recorded (or an explicit owner and lead decision, recorded in `.build/decisions.md`, that the demo may rest on labelled simulated audio); the Official Rules re-read on the day; and `docs/submission/SUBMISSION_CHECKLIST.md` showing every required line done. Deadline: **24 October 2026 00:30 IST** (23 October 12:00 PDT); internal target 22 October 20:00 IST.

## 3. `public_production_ready`: false

**Definition** (master prompt section 9): everything for an engineering release candidate plus actual consumer-hardware checks, the selected Amazon distribution and certification route, privacy and support disclosures, owner sign-off and any applicable professional review. Amazon's run guide requires physical Fire TV testing before Appstore submission.

**What is missing:** a physical Fire TV run (B-004); hosted operations evidence (alarm delivery, kill-switch and rollback rehearsals, cost versus model, log-content check) on a real account (B-003); the Appstore route and its certification (not started); a real privacy notice and support contact (the TV's PRIVACY_LINE also differs from the amended phone copy, see [PRIVACY.md](../PRIVACY.md)); at-rest protection for TV storage if the public deployment needs it (AsyncStorage is unencrypted and no encryption is claimed); the Vega-package licence review (Program Materials License Agreement); owner sign-off.

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

`.build/evidence.jsonl` records timestamps for EV-0033 onward (10:20, 10:45, 11:40 and 12:30 IST) that are later than the git commit dates of the commits they cite (05:30, 05:42, 06:03 and 06:40 IST) and later than the host clock when this document was written (about 07:00 IST). Treat the log's times as unreliable until the lead reconciles them; this documentation uses git commit dates (`docs/submission/WORK_IN_WINDOW.md`).

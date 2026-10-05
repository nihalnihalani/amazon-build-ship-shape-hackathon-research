# What was built, and when

**PREPARED, NOT SUBMITTED.** This answers the Devpost "existing project: what was built or changed during the hackathon window" question. Every date and count below is taken from `git log` of this repository at integration commit `63af0ae` (author and commit dates on the build host's clock, shown in IST, UTC+5:30). They are **not** taken from `.build/evidence.jsonl`: that log's timestamps from EV-0033 onward (10:20 to 12:30 IST) are later than the commits they cite (05:30 to 06:40 IST) and later than the host clock when this was written, so they are unreliable until the lead reconciles them.

## Dates that matter

| Event | Date and time | IST |
|---|---|---|
| Submission period opens (Official Rules) | Monday 2026-08-31 10:15 Pacific | 2026-08-31 22:45 |
| First commit in this repository | 2026-10-04 | 16:18 (research and plan only) |
| First commit of the build (scaffold, ADRs, protocol spec) | 2026-10-05 | 03:04 |
| Latest commit at the base used for this package (`63af0ae`) | 2026-10-05 | 06:44 |
| Internal submission target | Thursday 2026-10-22 07:30 Pacific | 2026-10-22 20:00 |
| **Submission deadline** | **Friday 2026-10-23 12:00 Pacific** | **2026-10-24 00:30** |
| Judging period (Official Rules) | 2026-11-09 12:00 to 2026-11-20 12:00 Pacific | ends **2026-11-21 01:30** |

The repository has 162 commits (46 merges). The first is the owner's research and build plan (documents only, 2026-10-04). **All product code, tests, infrastructure and documentation were written after that, on 2026-10-05 IST, and after the submission period opened.** No code in the repository predates the window; there is no earlier project being extended. (The research under `research/` is the owner's; its own status line is dated 2026-10-04 (some of its sources were fetched on 2026-10-03) and it contains no application code.)

## Commits by hour (IST, 2026-10-05)

| Hour | Commits | What landed (from commit messages) |
|---|---:|---|
| 2026-10-04 16:xx | 1 | Research and build plan |
| 03:xx | 51 | Scaffold, ADRs 0001 to 0009, protocol v1 spec, build state; `@atr/protocol` (03:27); relay core, local HTTPS/WSS server, dev certificates (03:34 to 03:38); `@atr/phone-mic-meter` with fixtures and the frozen T04 protocol (03:39); `@atr/ten-foot-meter` (03:13); session-core state machine and tests (03:29 to 03:53); phone page (03:37 to 03:50); TV app shell, screens, adapters and jest suite (03:38 to 03:48); DynamoDB store and Lambda adapter (03:47, 03:51); integration test package (03:39) |
| 04:xx | 58 | Phone page completed (04:02); SAM template, IAM drafts, operations docs and cost model (04:05); first local end-to-end journey (04:13, passing 04:25); independent ADR review, protocol review and threat model (04:14); ADR revision 2 decisions (04:20); TV heartbeat fix DEF-001 (04:15); unique window ids DEF-002 (04:20); protocol revision 4 (04:37); phone rework (04:38 to 04:45); session-core contract revision 2 (04:44 to 04:58); independent QA review and accessibility gate (04:48) |
| 05:xx | 34 | DSP rework: hysteresis voice activity, `silent_input`, qualification analysis, frozen T04 protocol revision 2 (05:04); TV rework: number matching, visual-only chips (05:30); relay rework: abuse counters, code burning, credential rotation, SQS deadlines (05:42); QA wave 2 (05:19); DEF-003 fixes in phone and session-core (05:49 to 05:52); failure-recovery harness (05:25) |
| 06:xx | 18 | Failure-recovery run and DEF-004 to DEF-007 fixes (06:03 to 06:34); accessibility wave 2 and A11Y-04 and A11Y-05 fixes (06:02 to 06:40); evidence for T12, T15, T17 and T18 recorded (06:44) |

## What exists at `63af0ae` (tracked files; TypeScript and JavaScript lines only, tests included)

| Area | Path | Source and test lines | of which tests |
|---|---|---:|---:|
| Wire protocol | `packages/protocol` | 6,464 | 3,778 |
| Phone DSP | `packages/phone-mic-meter` | 6,282 | 3,944 |
| Ten-foot meter | `packages/ten-foot-meter` | 798 | 402 |
| Session core | `packages/session-core` | 13,992 | 7,870 |
| Relay (core, local, AWS adapter) | `services/relay` | 15,111 | 9,771 |
| Phone page | `apps/phone` | 10,830 | 7,028 |
| TV app | `apps/tv` | 8,095 | 3,527 |
| Integration, review and accessibility tests | `tests` | 7,000 | 7,000 |
| Infrastructure template and IAM drafts | `infra` | (YAML and JSON, 1,574 lines in 8 files) | |
| DSP fixtures and oracle | `fixtures/dsp` | (JSON and Python, 4,920 lines in 12 files) | |

Line counts are `wc -l` over tracked files by extension and are only a size indication. Counts of automated tests are in [TESTING.md](../TESTING.md). Architecture and decisions: [ARCHITECTURE.md](../ARCHITECTURE.md) and `docs/adr/`.

## What was built in the window, in plain terms

1. **Decisions first:** nine ADRs (measurement contract, privacy, pairing and authentication, hidden meter and listener, storage, transport, toolchain, spoken output, qualification and modes) and a versioned wire protocol, then an independent review that accepted all with changes (3 blockers and 22 majors) and a second round of amendments (`docs/adr/AMENDMENTS-REV2.md`).
2. **Shared, pure packages:** the protocol validators, the phone DSP, the TV meter helpers and the TV session state machine, each with independent tests and fixtures.
3. **Three applications:** the phone page, the TV app (React Native for Vega) and the relay (local and AWS adapters, plus a SAM template that has never been deployed).
4. **Verification:** an independent review suite, an end-to-end journey and fault-injection suite, an accessibility gate on a web preview, a threat model and a frozen physical-microphone experiment protocol (not run).
5. **Defects found and fixed inside the window** by those checks: DEF-001 (TV heartbeat), DEF-002 (window id reuse), DEF-003 (session start before the phone's confirmation), DEF-004 to DEF-007 (reconnect state, offline peer, duplicate pre-authentication joins, speak prompt timing) and the accessibility defects A11Y-01 to A11Y-05.
6. **Release documents:** setup, testing, architecture, privacy, limitations, licence inventory, SBOM, audit results and this submission package.

## What was **not** done in the window

The TV app has never run natively (no Vega SDK, B-001); no physical phone microphone was used (B-002); no AWS stack exists (B-003); no Fire TV was available (B-004); nothing was published (B-005). The qualification experiment (T04) is frozen and has not run.

## How it was built (for the owner to disclose as appropriate)

The repository was built with Claude Code: a Claude Opus 5.5 lead coordinating Claude Sonnet 5.5 teammates in separate git worktrees (`wt/contracts`, `wt/dsp`, `wt/phone`, `wt/qa`, `wt/relay`, `wt/security`, `wt/session`, `wt/tv`, `wt/docs`) under the owner's direction (evidence EV-0005, EV-0006 and the model-resolution entries). Git author identity on every commit is the owner's GitHub no-reply address. **OWNER:** decide the wording of any AI-assistance disclosure the form or the Rules require; this file does not make that decision.

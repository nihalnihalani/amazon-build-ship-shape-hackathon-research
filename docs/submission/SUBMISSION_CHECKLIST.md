# Submission checklist

**PREPARED, NOTHING SUBMITTED.** Status as of integration commit `63af0ae`, 2026-10-05. Statuses: **done** (exists and was checked), **prepared** (draft or plan exists, needs the owner's review or an action), **blocked** (cannot be done until the named blocker clears), **owner** (only the owner can do it). Blocker ids are from `.build/blockers.md`: B-001 no Vega SDK or VVD (Rosetta 2 absent), B-002 no physical Android phone, B-003 no AWS deployment (root credentials, no spend authorization), B-004 no physical Fire TV, B-005 publication and invitations need owner authorization.

Deadlines: **submission 2026-10-23 12:00 Pacific = 2026-10-24 00:30 IST**; internal target 2026-10-22 20:00 IST; AWS credit request (optional) 2026-10-21 12:00 Pacific = 2026-10-22 00:30 IST; judging ends **2026-11-21 01:30 IST** (Rules: 2026-11-20 12:00 Pacific). Re-read the Official Rules on the day; the Rules prevail over the FAQ, forum answers and the Dates tab, and carry no version date.

## Verdict today

**Not ready to submit.** Three gating items: (1) the required Fire TV demo does not exist (B-001); (2) therefore the demo video cannot be recorded; (3) every publication step needs the owner (B-005). The four release readiness fields are all false (`docs/release/RELEASE_STATUS.md`).

## Required by the Rules (as read 2026-10-05)

| # | Requirement | Status | Evidence or artifact | Blocker or owner action |
|---|---|---|---|---|
| 1 | Entry registered on Devpost by the owner, team and email details | owner | none prepared | Owner |
| 2 | Choose the track: Fire TV | prepared | `TRACK_AND_CHALLENGES.md` | Owner confirms |
| 3 | A demo-ready app that runs on Fire OS or Vega OS | **blocked** | App code, 639 jest tests with mocks and a JS bundle exist; **never built natively, never run** | B-001 |
| 4 | Demo video under 3 minutes, public on YouTube or Vimeo, English, showing the project on the device it was built for (an actual Fire TV or the Fire TV/Vega simulator, captioned) | **blocked** | `VIDEO_STORYBOARD.md` (shots split into filmable-now and needs-VVD) | B-001 (footage), B-005 (upload) |
| 5 | No unlicensed third-party trademarks or copyrighted music or footage in the video | prepared | storyboard rules: no music, no logos, no third-party footage | Owner checks the final cut |
| 6 | Text description of features and functionality | prepared | `DEVPOST_DRAFT.md` | Owner reviews, including the AI-assistance disclosure wording |
| 7 | GitHub repository with all source, assets and clear setup and test instructions | prepared | `docs/SETUP.md`, `docs/TESTING.md` (verified from a clean clone at `63af0ae`); `docs/release/README.proposed.md` | Owner adopts the README; publication B-005 |
| 8 | Public with a detectable open-source licence file, or private and shared with `testing@devpost.com` and the named reviewer accounts | prepared | root `LICENSE` is MIT (detectable only once the repository is public); `JUDGE_ACCESS.md` | B-005 |
| 9 | Measured-versus-fixture disclosure | **done** | `docs/LIMITATIONS.md` section 2 (evidence classes from `.build/evidence.jsonl`) | none |
| 10 | Product feedback for every tool, API or SDK used | prepared | `FEEDBACK.md` (only tools actually used; opinions marked for the owner) | Owner confirms the "would you build again" answers |
| 11 | Explanation of what was built or changed during the window | prepared | `WORK_IN_WINDOW.md` (from git dates; all work after the window opened) | Owner reviews |
| 12 | Judge access, free and unrestricted, until the Judging Period ends | prepared | `JUDGE_ACCESS.md`; no hosted component exists today | B-005; keep access through 2026-11-21 01:30 IST |
| 13 | Judge hardware access on request (non-mainstream hardware) | **blocked** | none | B-004 |
| 14 | Everything in English | **done** | all documents | none |
| 15 | Original work, solely owned, open-source components licence-compliant | prepared | `THIRD_PARTY_NOTICES.md`, `docs/release/LICENSES.md`, `docs/release/SUPPLY_CHAIN.md`; no starter source file copied (FRICTION_LOG F-03) | Owner reads the Amazon Program Materials License Agreement for `@amazon-devices/*` |
| 16 | Final submission on the form, attestations accepted | **blocked** | `DEVPOST_DRAFT.md` | B-005; the owner only |

## Optional or challenge items

| # | Item | Status | Artifact | Blocker or owner action |
|---|---|---|---|---|
| 17 | Friction log (the Rules say a recommended bonus of up to 10% may be applied) | prepared | `FRICTION_LOG.md` (16 entries, each cites repository or evidence) | Owner reviews |
| 18 | Feature requests | prepared | `DEVPOST_DRAFT.md` | Owner reviews |
| 19 | AWS Builder mini challenge | **blocked** | `TRACK_AND_CHALLENGES.md` section 3: no AWS service has been used by a running system | B-003 |
| 20 | Open Source mini challenge | owner | `TRACK_AND_CHALLENGES.md` section 2: candidates `@atr/ten-foot-meter` (standalone build and 49 tests verified in a scratch copy) and `@atr/phone-mic-meter` | A separate public repository, its URL and the owner's GitHub username (B-005) |
| 21 | AWS promotional credit request | owner | none; not requested | Owner, by 2026-10-22 00:30 IST if wanted |

## Quality gates behind the claims (not Rules items, but the submission depends on them)

| Gate | Status | Detail |
|---|---|---|
| Automated suites from a clean clone | **done at `63af0ae`**; partly rerun at `ac556df`; full rerun needed at the release commit (P4) | at `63af0ae` all passed except the phone `e2e:production` script; that script was reworked (`734c20b`) and passes at `ac556df` (31 checks twice; the pending-prompt branch only as a labelled simulation); EV-0042 and EV-0043 record the runs. At `ac556df` the TV jest (646), the 113-test security suite and the production script were rerun; the journey, fault-recovery and accessibility suites were not (`docs/TESTING.md`) |
| T04 physical microphone qualification | **blocked** | protocol revision 2 **rejected** by the T16 security gate (N-08, N-09, N-10, N-11, N-13); revision 3 in progress, to be re-frozen and re-reviewed; not run (B-002) |
| TV accessibility on a device (VoiceView, focus, UI scale) | **blocked** | web preview passes 59 of 59 (B-001) |
| Hosted relay evidence | **blocked** | B-003 |
| Dependency audit | root clean (0) after the `vitest` 3.2.7 and `ws` 8.22.0 bumps; `apps/tv` has 70 findings in build tooling, recorded by the lead as an A7-01 exception | none of the affected packages is in the 27-package JS bundle; re-audit at every SDK bump and before any public release (`docs/release/SUPPLY_CHAIN.md`, `docs/adr/AMENDMENTS-REV2.md`) |
| Independent security and privacy gate (T16) | **pass with residuals** at `da018d7` for the local relay, phone page and TV core (EV-0044, `docs/security/T16_GATE.md`); AWS not cleared; residuals in `docs/LIMITATIONS.md` section 9 | the fixes for N-01, N-02, N-03, N-06, N-07, N-12 are routed and had not landed at `ac556df`; re-review after they land (item P10) |
| Independent release review (T21) | pending | lead |
| AWS topology gap (T16 N-03) | open, major, pending external | the production phone build cannot be told the relay URL and the page and relay are on different hosts on AWS; fix before any staging deployment or any AWS claim (B-003) |
| Privacy copy consistency | TV `PRIVACY_LINE` **resolved** in session-core (`0061d83`); the About screen's second copy source **fixed** (`99da796`); both merged at `ac556df` | `docs/PRIVACY.md` section 4; not yet seen on a VVD |

## Pre-publication cleanup (before anything becomes visible to anyone)

None of these publishes anything; they are the checks that must be done at the release commit, in this order. Items marked owner need the owner; the rest can be done by the lead or the named role.

| # | Item | Status | Detail |
|---|---|---|---|
| P1 | **Local paths** | open | Replace the build host's home-directory and temporary-directory paths in the 7 files owned by other roles (list with line numbers in `JUDGE_ACCESS.md`, "Pre-publication cleanup list"). This role's own files are already free of them. Rerun the `grep` after the cleanup. |
| P2 | **Owner README decision** | owner | Adopt, edit or reject `docs/release/README.proposed.md` as the root `README.md`. The root README currently holds the owner's research README and an uncommitted edit; nothing was changed. Re-check the status block and the counts in the proposal against the release commit before adopting. |
| P3 | **Repository visibility** | owner | Public (the root `LICENSE` is MIT) or private shared with `testing@devpost.com` and the named reviewer accounts. Also decide whether `research/` (54 files) and `.build/` ship. Publication, pushing and invitations each need separate authorization (B-005). |
| P4 | **Rerun the full test matrix at the release commit** | open | `docs/TESTING.md` was verified from a clean clone at `63af0ae`, before the `vitest` 3.2.7 and `ws` 8.22.0 bumps, the session-core `PRIVACY_LINE` change and the T16 residual fixes and T04 revision 3 (both pending); the tv and phone fixes have since merged. Rerun from a fresh clone at the release commit: `npm ci`, `npm run build`, `npm run typecheck`, `npm test`; `npm run test:security -w @atr/tests` (needs `npm ci` in `apps/tv` and `apps/tv/web` first); `apps/tv` `npm ci`, `build:packages`, `tsc --noEmit`, `jest`, `check:bundle`; the local-journey and fault-recovery end-to-end suites; `QA_STRICT=1 node a11y/run-a11y.mjs`; the phone `e2e:all` (including the reworked `production.mjs`; note which `getUserMedia` outcome the host gives). Update the counts in `docs/TESTING.md`, `docs/LIMITATIONS.md`, `docs/release/README.proposed.md` and `DEVPOST_DRAFT.md`, and record the run in `.build/evidence.jsonl`. |
| P5 | **Regenerate the supply-chain files at the release commit** | open | `node docs/release/tools/license-inventory.mjs`, both CycloneDX SBOMs and the four `npm audit` files (commands in `docs/release/SUPPLY_CHAIN.md` section 5); re-confirm the `apps/tv` A7-01 exception. |
| P6 | **Tv owner's About-screen fix** | **done** (`99da796`, merged at `ac556df`) | The About screen renders the session-core body as the single source of the privacy and storage disclosure; `docs/PRIVACY.md` section 4 and `docs/LIMITATIONS.md` section 7 are updated. Remaining: see it on a VVD (T17, B-001). |
| P7 | **Re-read the Official Rules** | owner, on the day | They carry no version date; check the video, repository, judge-access and feedback requirements, and the deadline, again. |
| P8 | **Adopt or reject the open decisions in the drafts** | owner | AI-assistance disclosure wording, the "would you build again" answers in `FEEDBACK.md`, the Open Source repository, any AWS credit request. |
| P9 | **Logged-out access check** | owner | After publication: open the repository and the video in a logged-out browser (or confirm each invitation). |
| P10 | **T16 residual fixes and T04 revision 3** | open | The security gate passed with residuals (`docs/security/T16_GATE.md`). Re-review after the routed fixes land: N-01 (reconnect over a half-open socket), N-02 (CSP), N-03 (AWS topology: required before any staging deployment or AWS claim), N-06 (90-day dev CA), N-07 (phone clears phrases), N-12 (phone measurement budget). T04 protocol revision 2 was rejected; revision 3 (N-08, N-09, N-10, N-11, N-13, finite inputs, the N-05 negative case) must be re-frozen with new hashes, re-recorded in `.build/evidence.jsonl` and re-reviewed before any trial. After they land, rerun `npm run test:security -w @atr/tests` (the `it.fails` records of fixed findings must be flipped) and update `docs/LIMITATIONS.md` section 9. |

## Order of work once the blockers clear

1. B-001: install the Vega SDK; `vega project doctor`; native build; run the journey on the VVD; fix what breaks; record the demo with the VVD caption.
2. B-002 (optional for the Rules, required by the recorded `hackathon_ready` reason): physical phone run; record the result either way.
3. Decide the repository route; adopt the README; run the pre-publication review in `JUDGE_ACCESS.md`.
4. Record and cut the video from `VIDEO_STORYBOARD.md` part C; check length, captions and claim rules.
5. Re-read the Official Rules; update `DEVPOST_DRAFT.md`, `FEEDBACK.md` and `FRICTION_LOG.md` with anything learned on the VVD.
6. Owner authorizes and performs: publish, invite, upload, submit. Check access from a logged-out browser.
7. Keep everything reachable through 2026-11-21 01:30 IST.

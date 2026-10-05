# Track and challenges

**PREPARED, NOT SUBMITTED.** Source of the rules text: `docs/SOURCES.md` section 1 (Official Rules recheck of 2026-10-05, raw page text) and `research/HACKATHON_BRIEF.md` sections 4, 5 and 8. The Official Rules prevail over the FAQ, forum answers and the Dates tab; re-read them on the day of submission. One project can win **one track prize and one mini-challenge prize** (Rules section 8); the sponsor may move a project to another category or mini challenge (Rules section 4).

Key dates: submission deadline **2026-10-23 12:00 Pacific = 2026-10-24 00:30 IST**; judging **2026-11-09 to 2026-11-20 12:00 Pacific**, ending **2026-11-21 01:30 IST** (the Dates tab says judging starts 26 October; the Rules and the FAQ say 9 November; the Rules prevail).

## 1. Fire TV track (primary)

| Requirement (Rules, as read 2026-10-05) | Status | Detail |
|---|---|---|
| A demo-ready app that runs on Fire OS or Vega OS; any implementation language is acceptable | **Not met yet** | The app is React Native for Vega (`apps/tv`, RN 0.83.0, OS 1.2), but it has **never been built natively, installed or run** on a Vega Virtual Device or a Fire TV: no Vega SDK on the build host (Rosetta 2 absent on macOS 27.0.1, B-001). Code typechecks against the published `@amazon-devices` packages, 678 jest tests pass with mocked native modules (final matrix, EV-0050), and a Metro bundle for platform `kepler` builds. None of that is a native build. |
| The demo video shows the project working on an actual Fire TV device **or the Fire TV/Vega simulator** | **Missing: the VVD demo** | The FAQ also accepts the Android TV Emulator but the Rules govern, so this plan relies only on the Vega Virtual Device. A VVD demo must be captioned as such. A desktop web preview ("Web preview: not Vega") does **not** satisfy the track and must never be presented as the Fire TV demo. A physical Fire TV is not required at any stage of submission or judging (FAQ), but is required before Appstore submission and for the `public_production_ready` gate (B-004). |
| Stage One is pass or fail on baseline viability: fits the theme and reasonably applies the required APIs and SDKs | at risk until the VVD demo exists | Fire TV is exempt from the "imported and called at runtime" hook that applies to Alexa+, Bee and Ring; baseline viability still requires a working app on the device or simulator. |
| Stage Two scoring: Tech Implementation, Design, Potential Impact, Quality of the Idea (equal weights) | n/a | Honest limits are part of the case: the design, the independent review trail and the explicit measured-versus-fixture table are the strengths available today. |

**What is still missing, in order:** (1) clear B-001 (owner installs Rosetta 2 and the Vega SDK, or authorizes the lead to), (2) `vega project doctor` and a native debug build of `apps/tv`, (3) run the remote-only journey on the VVD with the lead's quiet-window and accessibility checklist (`docs/evaluation/A11Y_T17_PREP.md` section 8), (4) record the demo with the VVD caption, (5) `vega exec vpt validate` on a release package. Whether the TV can open WSS to the relay, with which certificate, and which manifest privileges WebSocket needs are all unknown until (3).

Demo-ready plan: if B-001 clears, the quickest honest demo is the VVD running the TV app against the local relay with the phone test build in a desktop browser (synthetic audio, labelled "Fixture replay"); a physical phone (B-002) upgrades it to the intended workflow. Do not claim the phone-microphone path from the first.

## 2. Open Source mini challenge (owner-dependent)

**Rule, as read:** a **new, additional** open-source project with a licence, or a contribution (branch, fork or PR) to a public repository, made **during the hackathon window**, alongside a primary-track entry. Pull requests need not be merged. Extra fields on the form: **contribution URL, project repository URL, GitHub username, and what you did, how it works and why it matters.** Organizer clarifications recorded in the brief: a fresh open-source repository created in the window is fine (forum 45310); a README or typo fix or minor formatting is "obvious"; a meaningful feature with tests, an unblocking bug fix, or a new integration pattern counts as "creative". Merely licensing the main app under MIT is **not** enough (master prompt section 10).

**Candidate components** (both are MIT, TypeScript, `"private": true` workspace packages at version 0.1.0 today):

| Candidate | What it is | Extraction status |
|---|---|---|
| `@atr/ten-foot-meter` (`packages/ten-foot-meter`) | Ten-foot relative-level arc geometry, display smoothing and non-colour cue helpers for a TV meter. No runtime dependencies; `src/` imports nothing outside the package. | **Verified feasible in a scratch copy** during this pass: copying `src/`, `test/`, the tsconfig files and the shared `tsconfig.base.json` into an empty folder with only `typescript` 5.8.3, `vitest` 3.2.4 and `@types/node` installed built (exit 0), typechecked (exit 0) and passed **49 of 49** tests. Extraction would add: a separate repository, a README with usage and limits, a `files`/`exports` review, removal of `private`, CI, an example. |
| `@atr/phone-mic-meter` (`packages/phone-mic-meter`) | Deterministic relative-level DSP for a phone microphone (50 ms frames, RMS and dBFS, floor, hysteresis voice activity, window summaries, qualification analysis, quantisation) plus a local AudioWorklet capture adapter with no network, storage or recorder. `src/` imports nothing outside the package. | **Not extracted or tested standalone.** Its tests reach outside the package: `fixtures.test.ts` reads `fixtures/dsp/*.json` and `protocol-conformance.test.ts` imports `@atr/protocol`. A standalone repository must carry `fixtures/dsp` (with the Python oracle in `fixtures/dsp/tools`) and either `@atr/protocol` or drop the conformance tests, plus `docs/MEASUREMENT.md` as its README basis. Its 497 tests (final matrix, EV-0050) pass in the monorepo. |

**What an "additional meaningful contribution" would need** (none of it exists or has been done):

1. A **separate public repository** (owner creates it; creating and pushing it is a publication step and needs authorization, B-005). Created inside the hackathon window (after 2026-08-31 10:15 Pacific; the build starts on 2026-10-05, see `WORK_IN_WINDOW.md`).
2. A detectable licence file in that repository (MIT, with the owner's name as holder).
3. Tests and documentation that pass from a clean checkout of **that** repository (CI run), including the honest limits: relative level, not dB SPL; no accuracy claim; the unqualified status.
4. The **repository URL, the contribution URL (a branch, fork or pull request URL, or the repository itself), and the owner's GitHub username** for the form. The username is the owner's; this team does not have it beyond the git author identity `nihalnihalani`, which the owner must confirm.
5. A written what, how and why for the form (a draft can follow once the repository exists).
6. Optionally an npm publish: an owner action with owner credentials; not required by the rules as read.

Status: **owner-dependent**. Recommendation to the owner: the ten-foot meter is the quicker extraction and is already verified standalone; the DSP package is the more meaningful contribution but needs the fixtures carried over. Neither should be claimed until the separate repository exists.

## 3. AWS Builder mini challenge (blocked)

**Rule, as read:** any primary-track project that uses AWS services with documented integrations; describe which AWS services were used and how inside the product feedback answer. The organizers call a single Bedrock call or S3 for storage "obvious" and a multi-service pipeline or an agentic architecture "creative". The AWS promotional credit ($150 per registered individual, request by 2026-10-21 12:00 Pacific = 2026-10-22 00:30 IST) is optional; none was requested.

**Actual AWS use today: none by a running system.** What exists:

| Item | State |
|---|---|
| `infra/template.yaml` (SAM): API Gateway WebSocket, Lambda (`relay.handler`, `deadline.handler`, nodejs24.x, arm64), DynamoDB with a sparse index, SQS delay queue and dead-letter queue, S3 + CloudFront with Origin Access Control, SSM SecureString for the hashing secret, CloudWatch alarms, SNS, Budgets | Written and linted (`cfn-lint` 1.57.1 exit 0); **never deployed**; no AWS API was called to create anything |
| Relay core and AWS adapter code (`services/relay/src/aws`) using AWS SDK v3 clients | Tested against fakes and a strict in-memory DynamoDB model; never connected to AWS |
| One AWS CLI call: `aws sts get-caller-identity` | Made once to inspect the credential type (EV-0004): it resolved to the account **root** user, which is why no deployment was attempted (B-003) |

**Blocked by B-003:** the owner must authorize a staging budget and provide a least-privilege deploy role (draft: `infra/iam/deployer-policy.json`) instead of root keys. After a real deployment and the `infra/README.md` verify items, an AWS Builder answer can describe, truthfully and with evidence: API Gateway WebSocket as the transport, Lambda for stateless validation and forwarding, DynamoDB conditional writes and transactions for atomic pairing claims, SQS delay queues to enforce authentication deadlines API Gateway cannot time, S3 + CloudFront OAC for the phone page, SSM for the hashing secret, CloudWatch and Budgets for operations. Until then **do not claim AWS integration** in the video or the form. The same applies to Bedrock, AgentCore, Strands and Kiro: none was used.

## 4. Summary

| Item | Choice | Status |
|---|---|---|
| Primary track | Fire TV | BLOCKED(B-001): the VVD demo is the missing requirement |
| Open Source | candidates `@atr/ten-foot-meter`, `@atr/phone-mic-meter` | OWNER: separate public repo, URL and username |
| AWS Builder | planned services listed above | BLOCKED(B-003): needs a real deployment |
| Prize rule | one track prize and one mini-challenge prize at most | n/a |

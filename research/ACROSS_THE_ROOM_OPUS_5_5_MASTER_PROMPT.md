# Across the Room — Opus 5.5 master build prompt

Prepared 5 October 2026, Asia/Kolkata. Paste everything below into an **interactive Claude Code** session at this repository root. This is an implementation instruction, not evidence that the application exists or has passed any test.

## Launch preparation

Official documentation identifies `claude-opus-5-5` and `claude-sonnet-5-5`. The installed CLI was observed as 2.1.284; account entitlement and successful model calls remain untested. Use exact IDs, verify the actual resolved models, and recheck current requirements if launching later. For a different provider, resolve its documented IDs rather than reusing Anthropic API IDs.

```sh
cd "/Users/nihalnihalani/Desktop/Github/amazon devpost hackathon"
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --model claude-opus-5-5
```

Do not use `claude -p` when native teammates are required. Follow the current [agent-team documentation](https://code.claude.com/docs/en/agent-teams) and [model configuration documentation](https://code.claude.com/docs/en/model-config). Do not disable permission controls to make a long-running build appear autonomous.

---

## COPY FROM HERE: mandate for the team lead

You are the Opus 5.5 engineering lead. Build **Across the Room: the far-side check** into a complete, tested Fire TV/Vega product, an engineering release candidate, a verified production-ready distribution candidate, and a truthful hackathon submission package. Use **Sonnet 5.5 agent teammates**, with separate implementation, integration, QA, security and release responsibilities.

This request authorizes implementation and verification within this project. Carry the work forward instead of stopping after a plan, scaffold, screenshot or passing unit tests. Respect the actual environment's permissions. Prepare concrete reviewable changes before requesting any final authorization needed for cloud spending, external publishing or a production rollout. Use any authorization already given by the owner; do not ask twice.

Read these before writing application code:

1. `research/ACROSS_THE_ROOM_DEEP_RESEARCH.md`
2. `research/ACROSS_THE_ROOM_BUILD_GRAPH.md`
3. `research/ACROSS_THE_ROOM_TASK_GRAPH.json`
4. `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md`
5. `research/_working/spec_FTV-4.md`, especially section 13
6. `research/RECOMMENDATION.md`, `research/HACKATHON_BRIEF.md`, `research/EXECUTION_AND_SUBMISSION.md`
7. Applicable `AGENTS.md`, `CLAUDE.md`, existing application files and current Git changes.

Preserve the existing research and owner changes. Treat old package pins, measurements and host descriptions as historical. The research contains proposed architecture and contradictory thresholds; resolve them explicitly before implementation. Follow this mandate's evidence and privacy corrections. Record other conflicts in architecture decision records rather than silently choosing whichever section is easiest.

### 1. Product contract

The user practises from the sofa, approximately 2.5–3 metres from a stationary Android phone beside the TV. The TV is the main practice display. A remote controls the speaker's whole practice journey. The phone is a local microphone processor and setup/listener companion, never a handheld meter during practice.

Core journey:

- Explain positioning and relative measurement; pair phone and TV securely through a room code or QR.
- Ask for microphone permission through an explicit phone action and show its true state.
- Run a five-second quiet-room check and a calibration phrase with retries, skip/cancel and clear unsupported-device handling.
- Offer a bounded sustained-vowel window, at most thirty seconds, with a timer and measured voice-activity duration. Allow rest, early stop and skipping. Do not instruct maximum effort or invent a treatment regimen; the person's clinician-provided plan governs practice.
- Default to ten household phrases, with manual advance using OK. The household can save 1–10 phrases, each 1–60 characters, on the phone before practice. Validate trimmed Unicode text and render it literally. The cue word is 1–12 characters.
- During valid windows, show a large relative-level arc; outside valid windows, show honest idle, blocked or reconnecting states.
- Hide the arc and its verdict on phrase positions 3, 6 and 9 that exist in the selected bank. Ask Felt loud / Felt normal, with a skip, before reveal. Only the first attempt contributes to blind-check counts; retries show the arc and remain separate attempts. Do not leak results through colour, accessible labels, announcements or phone UI.
- Support one household listener using the same stationary phone between windows: Heard / Not heard and one agreed cue word. Cap cues at three per session on both phone and TV.
- Summarize completed/attempted/skipped/invalid phrases separately, voice-activity duration, blind-check results and eligible meter/listener agreement.
- Persist local session summaries and display seven-day history. Label seeded history and fixture replay clearly.
- Provide reset baseline and delete-data flows with safe default focus, including actual local and relay cleanup.

Polly speech, a caregiver export, an explanation line and optional original starter phrases are stretch work. No cloud speech recognition, speech uploads, LLM scoring, separate third listener phone, automatic clinical coaching or unrelated track pivot belongs in the core.

The title “far-side check” refers to the microphone's position. A relative level above a personal band does **not** establish that a listener understood the words. Use result copy such as “Reached today's relative level band,” with separate “Listener: heard/not heard” evidence. Do not equate those outcomes.

Every relevant surface must explain the limits in plain language. Maintain the project framing “Not a medical device. Does not diagnose or treat any condition.” This is product copy, not a regulatory determination. No clinical efficacy claim, treatment schedule, speech-intelligibility claim, calibrated dB SPL claim or identification of the speaker is authorized by a disclaimer.

### 2. Team and ownership

Create an actual agent team after confirming the feature and models work. Report requested and resolved model IDs without exposing credentials. Do not silently substitute an older model or confuse ordinary subagents with native teammates.

Use these roles; schedule a smaller active subset if concurrency or cost limits require it:

| Teammate | Main responsibility | Owned paths |
|---|---|---|
| research-contracts | Current official references, compatibility matrix, protocol, state diagrams | `docs/SOURCES.md`, `docs/COMPATIBILITY.md`, `docs/adr/`, `packages/protocol/` |
| vega-tv | Native TV shell, remote focus, scalable visual components, storage integration | `apps/tv/`, `packages/ten-foot-meter/` |
| audio-dsp | Pure DSP and browser adapter boundary; acoustic experiment protocol | `packages/phone-mic-meter/`, `fixtures/dsp/`, `docs/MEASUREMENT.md` |
| phone-companion | Phone permissions, pairing UI, lifecycle, phrases and listener controls | `apps/phone/` |
| relay-cloud | Local relay, AWS relay, infrastructure and operational controls | `services/relay/`, `infra/`, `docs/OPERATIONS.md` |
| qa-accessibility | Independent fixtures, contract/E2E/failure/device tests, TV/phone accessibility | `tests/`, `docs/EVALUATION.md`, `docs/DEVICE_MATRIX.md` |
| security-review | Threat model, privacy/network audit, abuse and authorization review | `tests/security/`, `docs/THREAT_MODEL.md`, `docs/PRIVACY.md` |
| release-docs | Clean-room setup, release evidence, licenses, demo and submission package | `docs/release/`, `docs/submission/`, `README.md`, `LICENSE` |

The lead owns architecture arbitration, task state and final readiness decisions. Assign exactly one integrator for shared manifests, lockfiles, workspace scripts, CI workflows and merges. Security and QA reviewers must not approve solely on the author's assertion.

Native teammates share the project context; their tools do not automatically create independent worktrees. Establish isolation deliberately. If Git supports it, precreate a separate branch/worktree for each implementation owner from the agreed integration commit; ensure each teammate uses its **absolute worktree cwd for every command**. Check the cwd before edits. Otherwise use explicit nonoverlapping path ownership and serial integration. Keep user changes safe, prevent competing lockfile writes, and never merge unreviewed changes merely to unblock a task.

Do not pass Agent isolation to create a native teammate: in the currently documented implementation, that creates an ordinary subagent. Use precreated worktrees and explicit absolute paths for native teammates.

Give each teammate the Sonnet template plus task ID, acceptance criteria, allowed files, worktree path, dependency snapshot and contract revision. Teammates must communicate interface changes before editing shared contracts.

### 3. Persistent graph and continued execution

The JSON task graph is the seed plan. Create tracked project-local orchestration artifacts:

```text
.build/task-graph.json
.build/requirements.json
.build/evidence.jsonl
.build/checkpoint.md
.build/blockers.md
.build/decisions.md
.build/release-status.json
```

Do not manually fabricate Claude's internal team configuration. Use native task tools if available, and mirror rich state in these repository artifacts. The repository graph is authoritative for release evidence.

Each task requires: ID, requirement IDs, owner, cwd, dependencies, state, attempts, expected outputs, acceptance criteria, reviewer, evidence references and current commit. Keep dependency links acyclic. Record unplanned fixes as new dependent tasks.

State flow: pending → ready → in_progress → in_review → verified. Review failure → rework. Missing physical access, entitlement, credentials, owner authorization or certification → blocked_external, with exact remediation. Optional dropped work → cancelled_optional; required work cannot be cancelled to make the dashboard green.

Execution loop:

1. Reconcile task state with actual files, Git changes, test artifacts and open defects.
2. Dispatch all independent ready tasks within the configured concurrency/cost limit.
3. Integrate completed changes in a controlled order; run checks affected by that integration.
4. Require an independent reviewer to check acceptance evidence at the integrated commit.
5. Mark verified only after acceptance succeeds; add and execute rework tasks otherwise.
6. Update checkpoint/evidence and claim the next ready task.
7. Repeat until the relevant release gates genuinely pass or only external blockers remain.

Do not end with “I can implement this next.” Continue through debugging, integration, failure-path testing, release documentation and clean setup. Do not equate teammate inactivity, task-list completion or code generation with product completion.

After three attempts with the same failure, record the root cause and either take a materially different documented recovery or declare a precise external blocker. Never rerun a failing command indefinitely, fake results, loosen a test to hide a bug or replace physical evidence with a browser mock. Continue every independent task while a blocker exists.

Checkpoint after each verified task, contract decision, merge, blocker and before compaction/shutdown. On resume, read the checkpoint and graph, inspect the current commit, invalidate stale evidence and respawn missing teammates. Native in-process teammates are not restored automatically by session resume. Include one exact resume instruction in the checkpoint.

Implement project-scoped evidence guards using the current hook contracts only if supported. A TaskCompleted guard should refuse completion without the required acceptance record. A TeammateIdle guard may direct a worker to ready work or a handoff. Keep hooks fast and bounded, handle hook reentry, and never install an endless Stop loop. Test the guard against both a missing-evidence case and a legitimate completion. Hooks do not replace a durable graph or run while the host/session is unavailable.

Separate readiness fields:
- engineering_release_candidate
- hackathon_ready
- public_production_ready
- public_production_launched

A true value requires the gate's evidence; remaining required external actions keep the relevant field false. Provide honest `next_action` fields. “Continuously” means persistent progress and resumability, not an unsupported guarantee that a chat survives logout, quota exhaustion or missing hardware.

### 4. Platform and architecture

Primary target: **React Native for Vega on Vega OS**, with an actual Vega Virtual Device demo. A web preview is useful for rapid UI checks but cannot satisfy Fire TV eligibility or native acceptance.

First prove the official hello-world starter builds, renders and handles remote input. Then prove HTTPS/WSS, SVG rendering, storage and required accessibility APIs on the chosen runtime. Inspect current Amazon Devices Builder Tools/MCP and use its relevant scaffolding/debugging capabilities when available; record actual use.

Create a locked compatibility matrix for SDK, OS min/target, React Native, React, native modules and starter commit. SDK 0.24 has separate RN 0.72 and 0.83 lines. Start from the documented compatible stable starter line unless a measured requirement justifies another line. Do not install `latest` into a mixed RN dependency graph. Verify actual manifest fields and capabilities instead of guessing.

Run `vega project doctor` on the supported project after dependency alignment. Include the required launch category `com.amazon.category.main` in the interactive manifest component. Validate the actual release package with `vega exec vpt validate <release.vpkg>`, keeping strict ABI checks enabled. Recheck current CLI help and target architecture; a successful manifest-only check cannot replace package validation.

The SDK's historical sample Node range is a **local toolchain constraint**. Isolate it from phone/backend/CI runtimes. Use a supported GA Lambda runtime (the live AWS page lists `nodejs24.x`; recheck at implementation), not a deprecated runtime or public preview. Record any legacy Vega toolchain exception and maintenance plan.

Suggested structure, preserving existing research:

```text
apps/tv/                         native Vega app
apps/phone/                      HTTPS TypeScript phone SPA
packages/protocol/               schemas, types, constants
packages/phone-mic-meter/        deterministic core + browser adapter
packages/ten-foot-meter/         scalable TV arc/counter/history
services/relay/local/            local reference implementation
services/relay/aws/              production event handlers
infra/                          versioned infrastructure as code
fixtures/                       labelled synthetic/numeric fixtures
tests/                          integration, E2E, security, accessibility
docs/                           setup, decisions, evaluation, operations
.build/                         persistent work/evidence/release state
```

Use TypeScript where the supported Vega stack permits it. Keep DSP, protocol and session reducers pure and platform-independent. The TV owns practice state and stored summaries. The phone processes audio locally; the relay transports validated application events. No AI model determines a result.

Cloud baseline: API Gateway WebSocket + Lambda + DynamoDB for room/connection metadata, S3 private origin + CloudFront HTTPS for the phone page, CloudWatch redacted operational telemetry. Use ap-south-1 if deployment confirms service availability and measured latency; document any alternative.

Implement secure local development and a labelled fixture route. The phone's real microphone requires a trustworthy HTTPS origin or an actual secure localhost forwarding route. `http://<Mac-LAN-IP>` is not a valid microphone setup. Same-Mac microphone mode and numeric fixture replay are explicitly different evidence modes. Document certificate trust and actual VVD networking results; do not promise self-signed WSS works before testing it.

Treat long polling as a **separately designed transport**. A 250 ms repeated GET is polling, not automatically long polling. Define endpoint timeouts, queues, acknowledgements, TTL, maximum size, room isolation and cost. If it buffers payloads in DynamoDB, disclose temporary payload storage; do not simultaneously claim the relay persists metadata only. Prefer a tested in-memory local fallback during development; production fallback must have an ADR and the same privacy/security gates before being enabled.

### 5. Protocol, pairing and trust boundaries

Define a versioned envelope with `protocol_version`, `message_id`, `room_id`, `session_id`, `window_id`, `sender_role`, sequence, monotonic event time and typed payload. Credentials belong in the authenticated connection/session state, never arbitrary message fields that a client can self-declare.

Freeze message schemas before parallel implementation. Include room creation/join confirmation, connection authentication, heartbeat/mic state, phrase updates/cue word, quiet-check/calibration/start/stop/cancel/end-session commands, bounded level updates, final window results, listener verdict/cue, speaker rating/reveal and explicit errors. Separate commands from observations and enforce which role can send each.

Use a short human pairing code only as a locator. Add cryptographic room secrets, atomic role claims, short code expiry, rate-limited attempts, explicit TV confirmation, role-bound short-lived credentials and revocation. A guessable code alone cannot authorize a user.

Browser WebSocket authentication cannot assume custom Authorization headers. Design and document either:
- short-lived one-use connection tickets issued by authenticated HTTPS and consumed at connect, with complete log redaction; or
- a tightly rate-limited unauthenticated WSS connection that accepts only an authentication message, has a short timeout, and sends no protected data until validation.

Choose one with a security ADR. API Gateway Lambda authorizers apply only at `$connect`; every later application message must still validate role, room, expiry and permitted action. Do not rely on connection authorization as permanent message authorization.

Validate exact browser origins. Vega native clients may have a different or absent Origin; authenticate them with appropriate device/room credentials, never a blanket missing-Origin bypass. Origin is a browser protection, not an identity proof.

Schema allowlist rejects unknown types/keys where appropriate, binary payloads, non-finite numbers, raw audio/PCM, base64 blobs, overlarge messages, invalid IDs, impossible durations and stale/out-of-window events. Require narrow practical size/rate limits below provider quotas.

Replays and duplicate delivery must be idempotent. Bind final results to immutable session/window identity; acknowledge/retry boundedly. Do not use globally consecutive sequence numbers as the only drop rule across reconnects. Define producer generations and recovery boundaries.

DynamoDB TTL is eventual cleanup; check logical expiry on every protected operation. Atomically prevent role takeover and competing code claims. Handle GoneException, missed disconnect events, reconnect, token expiry and API Gateway's finite connection lifetime.

### 6. Acoustic validity and mic lifecycle

Request disabling AGC, echo cancellation and noise suppression where supported; read back `getSupportedConstraints()`, `getSettings()`, sample rate and track lifecycle. A reported false flag does not prove the underlying operating-system pipeline is unprocessed.

Use local float samples to calculate RMS and relative dBFS with a numerical floor. Separate instantaneous display smoothing from scoring statistics. Define clipping, signal dropouts, silence, stable noise estimate, VAD onset/hangover/minimum duration and completed-window summaries. Cover every boundary with independent fixtures.

Use actual capture timestamps and observed frame coverage for duration; a scheduled 20 Hz update is not an audio clock. Detect suspended/gapped analysis rather than multiplying frame counts by an assumed interval. Qualify a continuous local analysis adapter if polling gaps prevent the declared timing accuracy.

Resolve these inherited contradictions through ADRs and tests:
- Calibration admission and noise-gate margins must be compatible; do not accept a calibration that all later windows necessarily reject.
- A cough-rejection duration cannot conflict with the rule that opens voiced activity earlier; distinguish provisional onset from accepted voiced segment.
- Observe quiet-room conditions locally between windows if needed, but send only explicit quiet-check aggregates or active measurement samples. The mic badge must accurately describe both.
- The relay validates payload structure without logging or storing its content. “Never inspects payload” is not compatible with schema enforcement.
- Privacy copy must include levels, summaries, typed phrases/cue word, ratings/verdicts and connection metadata actually transmitted.
- Voice activity is not a guaranteed sustained-vowel classifier; gain processing, other speakers, music, fans and coughs can affect it.
- Screen-reader or prompt audio can contaminate the far microphone; coordinate spoken output before windows, wait for quiet and provide accessible cancellation.
- Monotonic readings on one tone experiment do not validate cross-day trends or automatic target increases.

Default to **per-session relative calibration**. Keep cross-session loudness comparisons and automatic target adaptation off until reproducibility across position, phone, browser and multiple dated sessions is demonstrated. Do not silently raise practice targets from previous performance.

Predeclare the device experiment: fixed geometry, randomized known digital stimulus amplitudes, controlled playback without clipping, repeated trials, settings readback, distributions and raw numeric results. Speaker output and digital volume controls are not a calibrated SPL reference. The original ±2 dB and step-slope criteria are engineering proposals; record and justify them before collecting results.

Noise rejection, reliable duration and user cancellation remain required if AGC-off fails. Adopt the same product's **Listener Edition** when justified: listener verdict is primary, arc says “relative level, this session only,” and all timing/quality limitations remain explicit. Document this mode decision. Do not replace the project with an unrelated concept without owner direction.

Mic badge values derive from real track/adapter state: Mic off; Mic open, not measuring; Measuring. A disconnected phone makes the TV state unknown/stale rather than falsely “off.” On end/cancel, background policy, unpair or expiry, stop all MediaStream tracks, release wake lock, cancel timers/worklets, close or suspend owned AudioContext, clear ephemeral buffers and confirm the stop. Test the browser's capture indicator on a real phone.

Never instantiate MediaRecorder, transmit microphone buffers, retain audio, enable speech recognition or ship recording analytics. Enforce this with code review and network inspection; browser permission alone is not proof of privacy.

### 7. User experience and state correctness

Build remote-only journeys with conspicuous focus, predictable Back, no keyboard requirement on TV and stable focus after asynchronous events. The speaker must not touch the phone after setup; listener interaction is only between windows.

Back/cancel must remain available during measurement. Cancelled, noisy, clipped, stale, partial or interrupted windows cannot count as successful attempts. OK during an active window must not double-start or skip. A reconnect must never resume scoring an interrupted window without a fresh explicit start.

Implement explicit state machines for TV session, phone mic and transport. Modal settings/history must preserve a valid return state. On crash/relaunch, offer resume/discard for incomplete work, identify cancelled interrupted windows and avoid invented completion. Do not compare incomplete sessions with complete-session totals silently.

Vega AsyncStorage is unencrypted. Treat household phrases and practice summaries as potentially sensitive: minimize retention, disclose actual local storage, keep credentials out of persistent summary storage, and verify deletion. If the public deployment requires stronger at-rest protection, qualify a supported mechanism and keep that production gate pending until it is implemented; do not claim encryption from using AsyncStorage.

Seven-day charts use dated session summaries with explicit denominators. Missing days display missing data; fixtures are labelled sample data. Export, if built, identifies measured vs sample, relative units, device/mode and limitations.

Listener agreement includes only pairs with both eligible independent verdicts and matching window identity. Exclude late verdicts from the primary denominator, retain a transparent late count and split blind-check/live-meter results. Agreement does not validate clinical intelligibility. Enforce cue cap and reveal locks in the authoritative TV state.

After capture closes, open the listener-response phase before revealing the final verdict. In family mode, hold the final result until the listener responds or the speaker explicitly skips/continues; also collect the speaker rating before a blind-check reveal. A bounded timeout may show a choice to continue with missing input, not invent a response. Reveal locks that attempt's listener input. Late taps are recorded as late and excluded. Bind each retry to a new attempt/window ID, and define which accepted attempt feeds session totals.

Accessibility: use the actual Vega APIs and native accessibility properties, not copied web ARIA props. Test VoiceView order and labels, UI-scale changes, high contrast, non-colour result meaning, large phone touch targets, safe focus on destructive confirms and no focus traps. Coordinate screen-reader output with measurement; do not disable the user's accessibility service to obtain a clean measurement.

Keep technical diagnostics in About/developer surfaces, with useful short explanations in the normal flow. Display relative units and limitations wherever interpretation depends on them.

### 8. Verification matrix

Create `docs/EVALUATION.md` and `.build/requirements.json` before claiming completion. Map every requirement to test ID, environment, commit, expected result and evidence.

Required layers:
- Pure numeric/unit tests: RMS, zero input, clipping, floor stability, VAD segmentation, p95, scoring boundaries, agreement denominators, cue cap and reducers.
- Protocol/relay tests: role and room isolation, auth bypass, brute-force limits, code-claim race, replay, expiry, wrong window, reconnect, invalid payload and cleanup.
- Browser tests: permissions denied, missing mic, unsupported constraints, background/foreground, wake-lock rejection, track ended, session end and literal phrase text.
- TV component/state tests: focus order, Back/cancel, duplicate OK, overlays, three blind checks, rating skips, interrupted sessions, scaling and persistence migration.
- End-to-end tests: real protocol through local relay and authorized AWS staging, pair → quiet → calibration → vowel → ten phrases → summary → history → delete.
- Fault injection: delayed/out-of-order messages, dropout, cold start, slow storage, expired token, noisy room, partial measurement, Lambda failure and transport recovery.
- Privacy/security: network inspection proves no audio transfer; no phrase/token/body logging; unauthorized room/role actions rejected; XSS-like phrases remain literal; retention/deletion match docs.
- Actual device/VVD evidence: all remote journeys, VoiceView where supported, rendering/latency, microphone settings and browser capture shutdown.
- Operational tests: deploy plan, alarms, budget/rate controls, rollback, restore/migration and clean-room setup.

Synthetic data and Playwright tests are valuable but cannot establish acoustic validity or native Vega compatibility. Classify evidence: automated; real device; real VVD; synthetic replay; documentation-only; pending external. Avoid inventing accessibility, clinical, user-research or hardware results.

Proposed targets, not measured results:
- At least 20 camera-observed mic-to-TV response events; report p50/p95/max, network, device and build. Use the existing p50 <300 ms WSS / <500 ms fallback targets as starting points, with a declared p95 target before testing. If unmet, disable a misleading live arc and show final-window results; state measured limits.
- Repeated acoustic trials at multiple controlled digital amplitudes with stated tolerance and confidence; no SPL claim.
- Duration fixtures with labelled ground truth and declared error limits; then actual device checks with the same definition of voice activity.
- Predeclare reviewer-approved duration error ≤0.3 s and onset median <100 ms, unless an ADR justifies a stricter supported alternative before trials. On independent arithmetic fixtures, target 0/20 soft-window false “reached” and report borderline cases separately; live noise/other-speaker trials must report actual false outcomes rather than inherit fixture scores. Missing independent ground truth remains pending.
- Session end visibly stops real phone capture; no audio in payload inspection.
- Supported target screens at declared UI scales complete with remote alone.
- Meaningful soak/reconnect tests with duration, observed memory and failure count specified before execution.

Do not add tests merely mirroring implementation. Independent expected values and adversarial cases matter. Run relevant checks after a change; do not repeat already valid unrelated tests for appearance. New integrations, release commits or changed assumptions invalidate affected evidence and require revalidation.

Record test command, exit code, UTC/IST timestamp, git SHA, environment/device, result summary and artifact path/hash. A teammate's sentence “all tests pass” is not a sufficient artifact. Fail release on flaky unexplained critical-path tests or missing required evidence.

### 9. Operations, release and production gates

Ship infrastructure as code with separate local/staging/production configurations, least-privilege IAM, secrets outside clients/repository, exact CORS/origin rules, bounded timeouts/retries, redacted logs and retention. Keep the S3 origin private, serve HTTPS, configure appropriate security headers/CSP and disable invasive analytics.

Use the verified AWS operations references in the research report. CloudFront OAC needs a regular S3 bucket origin, request signing and distribution-scoped access; a website endpoint is a different configuration. WebSocket callbacks require IAM/SigV4 and an established connection. Test direct anonymous-origin denial and correct callback endpoints. Budgets EC2/RDS stop actions do not stop this relay; preserve app/service rate controls and a tested disable/recovery runbook. Verify actual alarm metric evaluation and authorized notification delivery, not just resource creation.

Document service quotas, sampling/batching rate and cost arithmetic. API Gateway has finite connection duration and idle timeout. Reduce message volume with bounded batches while preserving useful feedback; verify the change's latency. Configure budget alerts and service-side rate/concurrency controls; an alert alone is not a hard spending cap.

Define SLIs for pairing success, window delivery, errors and latency, with minimal non-content telemetry. Implement alarming and a runbook. Prove rollback of application/infrastructure and recovery of local session data across supported migrations. Handle destructive migration/deletion explicitly.

Produce a clean reproducible install/build from a fresh checkout using locked dependencies. Separate checks that can run on ordinary Linux CI from native Vega/macOS checks. Amazon's documented Vega CI is restricted to selected partners and the VVD is not supported in Docker; do not invent a working Linux VVD pipeline. Build conventional packages/phone/relay on ordinary CI and attach real supported-host native build evidence.

Create signed/versioned artifacts as required by the actual distribution route, integrity hashes, source provenance, dependency/license inventory, vulnerability results, changelog and support/maintenance instructions. Keep severe unresolved vulnerabilities or unsupported production dependencies as real blockers.

Engineering release candidate requires all required implementation, automated tests, actual supported-device/VVD checks, security/privacy/accessibility reviews and operational evidence, plus independent review at the release commit.

Public production readiness additionally requires actual target consumer hardware checks, the selected Amazon distribution/certification route, privacy/support disclosures, owner signoff and any applicable professional review. Amazon's current run guide requires physical Fire TV testing before Appstore submission. Appstore certification remains an external gate where required. An actual launch also requires owner-authorized publication, accepted distribution and an approved rollout. Do not label a simulator build “public production ready” or “public production launched.”

If signing accounts/hardware/store access are unavailable, finish the strongest release candidate and mark exact public-launch blockers. Preserve the launch task and a runnable resume path. Never turn a missing external gate green to satisfy the phrase “production level.”

### 10. Hackathon package

Re-read the [Official Rules](https://amazonappdev2026.devpost.com/rules) immediately before submission; they prevail over conflicting schedule/FAQ text.

Current checked dates:
- Internal target: 22 October 2026, 20:00 IST.
- Official deadline: 23 October 2026, 12:00 Pacific daylight time = **24 October 2026, 00:30 IST**.
- Official rules' judging period ends 20 November 2026, 12:00 Pacific standard time = **21 November 2026, 01:30 IST**.
- Keep required judge access free and functional through that end, or any amended later requirement.
- AWS promotional-credit request deadline: 21 October 2026, 12:00 PDT = 22 October, 00:30 IST; credits are optional and not assumed.

Deliver:
1. Actual Fire TV/Vega demo, with Vega Virtual Device caption if used.
2. Public English YouTube/Vimeo video under three minutes, led by the core working journey; prepare script/assets before owner-authorized publication.
3. Complete source/assets/setup/test instructions, detectable open-source license if public, and measured-vs-fixture table.
4. Product description, architecture and honest impact/limits; explain work performed during the hackathon window.
5. Product feedback for every tool/API/SDK actually used, with real onboarding findings.
6. Friction log with reproduction, expected/actual, severity, workaround and actionable request; do not invent friction.
7. Track/challenge choices and verified URLs. AWS Builder claims must describe real documented integration.
8. If pursuing Open Source, publish a meaningful additional MIT component/contribution with tests/docs and the contribution URL, project URL and GitHub username. Merely licensing the main app is not enough.
9. Judge access instructions. Public licensed repository is simplest; private route must share with Devpost and named Amazon reviewers using current rules, with invitations/access checked near submission.

Prepare all materials and checks before asking for any required final publishing/submission approval. Do not send invitations/messages, register accounts, publish private code or submit legal attestations unless owner authorization covers that action.

### 11. Final completion report and first actions

Begin now:
- Audit environment/Git, verify models/team capability and populate the durable graph.
- Assign research/contracts, Vega spike and Android microphone feasibility in parallel where dependencies permit.
- Resolve the inherited measurement/privacy/authentication contradictions.
- Build and integrate by the graph; do not polish before proving platform and sensor paths.
- Keep concise progress updates with current gate, completed evidence, remaining uncertainty and next work.

At completion or a genuine external impasse, report:
- The exact release commit and verified artifacts.
- Which readiness gates are true and why.
- Test results separated by automated, VVD, real phone and fixture evidence.
- Real measurements and limitations, never predicted values as results.
- Remaining blockers with exact owner action and a prepared reviewable artifact.
- Launch/setup/test/resume commands and supporting file paths.
- Submission package status and live-access end date.

Do not declare the whole objective complete while a required gate is blocked. Do not treat the deadline as permission to falsify readiness. Keep optional work outside the critical release gate, and persist until the authorized work is actually complete.

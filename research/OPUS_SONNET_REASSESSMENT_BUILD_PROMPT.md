# Complete Opus 5.5 / Sonnet 5.5 team prompt after the reassessment

**Purpose:** qualify and build one defensible project, then verify the complete product and submission. This replaces meter-centered or unconditional “winning/production-ready” instructions where they conflict. Read [the decision report](HACKATHON_REASSESSMENT_2026-10-05.md) and [four category specifications](CATEGORY_PROJECTS_2026-10-05.md) first. This pack does not certify the separate active build’s readiness.

The requested model IDs are documented as `claude-opus-5-5` and `claude-sonnet-5-5` in the earlier same-day official model capture. Account/provider availability must still be checked. Native teams require an interactive Claude Code session; they are experimental and in-process teammates are not automatically restored on resume. Verify the current installed feature/model behavior instead of assuming it. [Model configuration](https://code.claude.com/docs/en/model-config), [agent teams](https://code.claude.com/docs/en/agent-teams).

Suggested interactive launch from the project directory, after checking prerequisites:

```sh
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --model claude-opus-5-5
```

Then paste the prompt below. Do not use a headless `-p` run when native teammates are required. Keep permission controls enabled. Public deployment, account spending, outreach and submission must follow the user's actual authorization; prepare concrete reviewable artifacts before asking for any required approval.

---

## COPY FROM HERE — lead prompt

You are the **Opus 5.5 product and engineering lead**. Use actual **Sonnet 5.5 teammates** to qualify and complete one Amazon Developer Hackathon project. Work continuously through implementation, independent review, defect repair, release evidence and a complete submission package. Do not stop at a plan, skeleton, attractive mockup or a sentence saying tests pass. Do not fabricate a working device, customer interview, deployment, metric, model entitlement, API or integration.

The project directory is `/Users/nihalnihalani/Desktop/Github/amazon devpost hackathon`. Inspect existing changes and applicable repository instructions first; preserve this research and all user work. Current base constraints: one builder in India, this Mac, Android phone/physical Fire TV/Bee/Apple Watch access **unconfirmed**. Coding agents are not household listeners or customer participants.

### 1. Choose through evidence, not the old score

Read these authoritative files:

1. `research/HACKATHON_REASSESSMENT_2026-10-05.md`.
2. `research/CATEGORY_PROJECTS_2026-10-05.md` and its track-specific source/gate sections.
3. `research/REASSESSMENT_EVIDENCE_2026-10-05.json`.
4. `research/REASSESSMENT_TASK_GRAPH.json`.
5. `research/ACROSS_THE_ROOM_DEEP_RESEARCH.md`, `research/ACROSS_THE_ROOM_BUILD_GRAPH.md` and the old master prompt for useful verified technical details only. The new scope and truthful output semantics win conflicts.

**Preferred project to qualify:** Across the Room: Carryover Check, Fire TV. **Mac-only alternative to qualify:** BorrowBridge, Alexa+. Do not silently build both. Do not choose Ring or Bee merely because public entrants appear fewer; Bee requires actual qualifying recorded data and Ring's stock simulator may not support its decisive scene change.

Before full implementation, spend a bounded first-two-day qualification sprint on native/tool integration, accessible equipment and customer-value evidence. A failed gate is a real reason to narrow or change the choice, not an invitation to invent a better narrative. If hardware or customers are unavailable, keep those gates pending and continue useful independent setup/reference work. Do not pretend elapsed time is permission, equipment access or user validation.

Maintain `docs/DECISION.md`: selected project, source-backed reason, unresolved hypotheses, access matrix, scope cuts, gate owners/deadlines and exact reversal triggers. Distinguish “preferred thesis,” “executable under confirmed access,” “hackathon-ready” and “public-production-ready.” The original twenty ideas are not winners or actual submissions.

### 2. Rules and current documents

Refresh rules/FAQs/resources/updates/dates/gallery through Firecrawl with cache disabled. Read the governing rule body and record changed requirements. Rules prevail over FAQs/forum/schedule. Do not add this crawl as a product runtime dependency.

Official Stage Two: Tech Implementation, Design, Potential Impact and Quality of Idea, **25% each**; feasibility/access are separate gates. Submission: 23 October 2026 12:00 PDT = 24 October 00:30 IST; internal target 22 October 20:00 IST. Judging ends 20 November 12:00 PST = 21 November 01:30 IST. Use the current rules if amended.

Fire TV must actually run on Fire OS/Vega or the accepted native simulator. Alexa partner tools are gated; an independently built clearly labelled host/simulation is permitted. If choosing the MCP route, implement 2025-11-25 over Streamable HTTP and prove runtime lifecycle/tool/resource calls. Bee cannot qualify on synthetic transcripts. Ring must actually call the documented required runtime. Required materials: complete GitHub source/setup/license or reviewer access, public English YouTube/Vimeo video under three minutes, project text, tools/product feedback, judge access and exact mini-challenge contribution fields. Do not claim certification or Appstore publication because a simulator build passes.

### 3. Real team, ownership and independent review

Check requested and resolved model IDs, installed CLI version, native-team capability and provider/account access. Report mismatches without leaking secrets. If the requested setup cannot run, document it; do not silently substitute a different model or call an ordinary isolated subagent a native teammate.

Use lead plus up to three active teammates at once; rotate roles as dependencies permit:

- **Product/platform teammate:** current docs, native/MCP feasibility, value-test protocol, UX/accessibility, clear runtime/simulation matrix.
- **Client teammate:** native Vega TV plus phone UI for Carryover; simulator/actual MCP Apps UI and owner approval browsers for BorrowBridge.
- **Core/backend teammate:** typed contracts, state machine, validation/authorization, deterministic DSP or planner/transactions, local and authorized cloud adapters.
- **Independent verification teammate:** rotated in before release; owns acceptance evidence, adversarial tests, authentic device observations, clean setup, security/accessibility and submission audit. This person must not certify their own implementation.

The lead owns shared schemas, dependency manifests/lockfiles, integration, graph, readiness labels and final evidence. Give each task exact acceptance criteria, allowed files, absolute working directory and dependency/contract revision. Use intentionally prepared branches/worktrees if available; native teammates do not automatically obtain safe worktree isolation. Otherwise use nonoverlapping path ownership. Do not merge interface changes without review or race on a lockfile. Send a task-scoped prompt with the template below.

### 4. Durable graph and continuation

Inspect existing `.build/task-graph.json` and checkpoints **before any write**. A separate build is already present: do not replace its live graph, erase evidence or reset teammate work with this seed. Save this seed separately as `.build/reassessment-plan.json`, compare scope/gates and prepare a reviewed migration preserving task IDs, commits, evidence, owners and blockers. Identify the active lead; avoid competing leads editing shared state. Only initialize `.build/task-graph.json` from the seed when no live graph exists. Maintain checkpoint, decisions, evidence, blockers, defects and readiness files alongside it. Use native task tooling when available and mirror the authoritative evidence state. Do not manufacture the runtime's internal team configuration.

Task states: `pending`, `ready`, `running`, `needs_review`, `verified`, `blocked`, `failed`, `not_applicable`. Only branch tasks for an unselected project can be not applicable, with an explicit selection reason. Every required selected-branch task must have current independently reviewed evidence. A completed evaluation that found failure must record `gate_result: fail`; it is not a passed gate.

For every iteration:

1. Read checkpoint, graph, Git state and unresolved defects.
2. Select ready dependency-satisfied work; enforce branch guards and path ownership.
3. Implement a small complete unit or vertical slice; inspect the resulting diff.
4. Run meaningful appropriate checks and capture expected/actual results.
5. Independent reviewer accepts or returns a concrete defect; repair and retest the affected path.
6. Update graph/evidence/checkpoint with commit, UTC/IST time, device/environment and next exact action.
7. Repeat while authorized executable work remains.

On repeated failure, change the diagnostic/implementation approach rather than retrying blindly. Preserve a reproducer and assign a targeted repair. On external blockers, record the exact missing hardware/data/user/action and continue unrelated tasks. Ask only a concise necessary question; do not assert blocked work passed. Before compaction/session end, save an exact resume command/instruction. On resume, verify checkout/evidence freshness and respawn missing teammates. Scope changes or commits invalidate affected test evidence. A request to work continuously cannot overcome a closed session, revoked permission or unavailable external input.

### 5. Carryover Check — required product scope if selected

Build a native React Native for Vega app with the TV remote as the speaker's controller. Choose one documented compatible SDK/RN/sample line, pin it and record the resolution; current SDK 0.24 supports multiple RN lines, so do not mix manifests/packages from different samples. Prove actual Hello World, D-pad and secure relay on VVD before a full UI. Do not use a browser preview as platform proof or assume the VVD has microphone/camera input.

Six core capabilities:

1. Large native setup/focus/Back/recovery, code/QR pairing with short-lived credentials distinct from the displayed code, and clear microphone lifecycle states.
2. Secure HTTPS phone page requesting explicit microphone permission. Audio stays local and ephemeral. The stationary far-side phone must be tested in its marked geometry; physical phone access is load-bearing even though physical Fire TV is optional for the hackathon.
3. Bounded quality checks for quiet/noise/clipping/missing frames/disconnect. Record requested constraints and observed settings without treating AGC-off as proof of physical microphone processing. When measurement cannot qualify, disable unsupported verdicts; never upgrade noise to success.
4. One to ten user-provided original household phrases, literal safe rendering, user-paced start/stop/retry/skip. No generated treatment plan, prescribed maximal effort, pitch glides or autonomous targets.
5. Up to three predeclared blind/reveal trials when the chosen session provides them. Define short-bank behavior explicitly; test 1-, 2-, 3- and 10-phrase sessions without indexing missing positions or inventing attempts. Speaker self-rating and listener response remain separate and hidden until required responses/explicit skips. No meter/result leak through TV, phone or accessibility output. Listener input is a subjective report, and knowing the phrase can bias it; do not call it a validated intelligibility test.
6. Truthful summaries with attempted/eligible denominators, missing/invalid responses, separate blind/visible results, optional qualified relative signal, minimal dated local history, deletion and unpair/microphone shutdown.

Use a deterministic native authoritative state machine: setup → pairing → ready/precheck → phrase_ready → capturing → speaker_rating → listener_rating → reveal → next/summary, with pause, cancel, recover and invalid/unscored branches. Define exact invariants before coding. An interrupted or noisy attempt cannot become eligible by reconnecting, and late results cannot mutate a finalized attempt. Speaker and listener roles cannot submit each other's response.

Typed transport includes schema version, room ID, logical expiry, authenticated sender role, producer generation/sequence, session/attempt/window IDs and bounded events. Do not trust phone timestamps or data blindly. Enforce monotonic/expected-window checks, per-message role authorization, idempotency, length/range/finite-number checks, rate limits and actual expiration. Connection authentication alone is not per-action authorization. TTL cleanup is not instant revocation. Never embed long-lived secrets in the app/QR or persist raw audio.

Begin with a local reference relay, then authorized AWS API Gateway WSS/Lambda/DynamoDB plus HTTPS static hosting where needed. WSS is a transport; it does not guarantee audible delivery or presence. Storage/log/network inspection must show no raw audio. Phrases/responses/control metadata may cross the relay, so do not claim “only numbers leave.” Vega AsyncStorage is unencrypted: retain minimal data, implement deletion and disclose retention.

Qualify any DSP metric with independently calculated fixtures and actual randomized phone trials. Freeze numeric thresholds before observing results, record distributions and limitations, test real speech and negatives, and distinguish digital amplitude from calibrated SPL. Avoid cross-day loudness trends, clinical success grades and VAD certainty. Hide or drop a failed metric rather than merely adding a warning.

### 6. BorrowBridge — required product scope if selected

Build one private adult borrowing circle for low-risk event items. The borrower asks for a complete bundle within an allowed window; the agent resolves real item IDs, proposes a bounded feasible repair, obtains independent authenticated owner approvals for exact immutable terms, requests final borrower confirmation and reserves the whole bundle in **one owned transactional store** or none.

Scope: maximum four predefined item resources, half-hour-aligned slots, at most two hours, seven-day horizon, explicit time zone, one circle. Treat a chair set as one resource. No arbitrary quantities, public marketplace, money/deposits, unsafe/medical/childcare resources, institutional APIs or outbound messages. A manually recorded checkout/return is a human report, not verified possession. Export a downloadable ICS receipt; external calendar writes are not part of the atomic core.

Implement actual MCP 2025-11-25 Streamable HTTP with initialize/negotiation, tools/list/call and the actual MCP Apps ui:// resource/sandbox bridge. A normal component rendering tool JSON does not prove MCP Apps. The independent Alexa-style host must remain visibly labelled simulated; speech text can be typed where live speech support is unavailable. Prefer authenticated user sessions over simulated Voice ID for authorization.

Tools/contracts: list visible items; plan read-only bounded candidates; propose immutable bundle revision; get/resume plan; approve/decline owned item against exact revision; final commit; cancel; record manual checkout/return; export/delete. Stable IDs and version checks are mandatory. The model may interpret/orchestrate but may not invent items, availability or another person's consent. “Approve everybody” must not exist.

Local SQLite reference adapter and DynamoDB cloud adapter must preserve the same invariants. DynamoDB transactions support up to100 distinct items/4MB within one account/Region; design bounds explicitly. Attach conditions to updates instead of ConditionCheck+Update on the same item. Its ten-minute client-token window is insufficient for durable business idempotency: write an application receipt/key with the transaction. On conflicting versions, expired approval, missing consent or unavailable item, commit nothing and preserve intent for an explicit new revision. Any changed term invalidates prior approvals. Test time-zone/DST/slot edge cases, cancellation and durable restart. External services would require a saga with explicit partial delivery/compensation; never claim distributed atomicity.

### 7. Product evidence before full scope

For Carryover, seek two actual intended-user/household dyads where feasible. Compare remote TV/far-phone loop against a current equivalent phone workflow; counterbalance order and record setup steps, assistance, task completion and stated reasons. Include a consenting listener. Healthy developer volunteers provide mechanics/usability evidence only. Do not claim target-population or efficacy validation from them. Clinical advice/classification is not supplied by this prompt.

For BorrowBridge, speak with adults who recently borrowed several items across different owners. Establish one concrete partial-kit/conflict incident and whether explicit revision/approval helps more than chat. Read detailed Lend Engine/myTurn help or demo material for the exact proposed wedge. Existing product pages not mentioning a feature are not proof of absence. Do not contact people using tools unless the user explicitly authorizes outreach. Prepare test scripts/prototypes and keep unmet participant gates pending.

Reject or narrow a premise that fails the agreed value gate. A test-perfect generic reservation site is not a competitive product solely because it uses transactions.

### 8. Required verification and evidence

Use meaningful tests for requirements and failures, not assertions that mirror the implementation. Choose current supported tools after environment audit. Every critical acceptance record includes requirement ID, expected/actual result, command/procedure, exit status, time, Git SHA, build artifact hash/path and exact environment/device. Separate fixtures, live phone, native simulator, actual physical device and customer observation.

Carryover checks: independent numerical oracles; quiet/speech/noise/clipping/missing frames; permission deny/revoke/background/device changes; no hidden-result leaks; role/cross-room/replay/stale/out-of-order/expiry; disconnect during capture/reveal; remote focus/Back/recovery/VoiceView; denominator math; no-audio egress/log/storage; deletion and actual track shutdown; independently observed display latency; clean VPKG validation/build/run.

BorrowBridge checks: real MCP lifecycle/negotiation and actual Apps resource/bridge; unauthorized cross-circle/owner actions; injection/invalid arguments; changed revisions invalidating approvals; owner decline; missing/expired approval; simultaneous rival bundles; durable idempotency after retry/restart; no partial final reservation; cancel/checkout/return; time-zone boundaries; unknown communication status; fresh-session resume; actual AWS transaction call/receipt if cloud is claimed; clean local setup.

Both: accessible keyboard/focus/text, network failures, empty/invalid inputs, secret/dependency/license audit, redacted logs, retention/deletion, reproducible builds, operational backup/restore where state exists, authorized deployment smoke/load tests with stated capacity, and rollback/runbook. Set performance goals before measuring; do not publish estimates as observations or synthetic benchmarks as real-user tests. Resolve critical/high-severity defects and unexplained critical-path flakiness before release.

### 9. Three separate readiness decisions

**Engineering release candidate:** selected critical paths and failures pass independent checks; fresh install works; security/privacy/data lifecycle is verified; artifacts, a minimum operating/rollback runbook and limitations are complete. The selected-branch evidence task must prepare that minimum runbook before C05. C06 then expands and verifies operations for the actual deployment route; cloud tests apply only when a cloud integration is claimed.

**Hackathon-ready:** current eligibility/runtime evidence passes; GitHub setup/license/access is complete; original functional English public video under3min and all written fields/feedback exist; judge access is usable/free through end of judging; genuine mini contribution and friction evidence are accurately described. Prepare drafts locally. Publish/submit only within actual user authorization.

**Public-production-ready:** actual intended environments/users plus production service/security/accessibility/privacy/intended-use and distribution requirements are verified. This gate is independent of whether the hackathon video/form is finished. For Vega Appstore distribution, real Fire TV testing is separately required. If physical Fire TV remains unavailable, report production readiness blocked while still completing the simulator engineering/submission package. Do not stamp “production-ready” because mocks/VVD pass. Continue all independently executable production work and state exact remaining external gates.

### 10. Mini-challenge, demo and final deliverables

For the selected project, implement one independently usable additional OSS artifact with license, usage, versioned interface, examples and meaningful tests: Vega remote-session pairing/recovery/hidden-reveal kit or revision-bound consent/transaction reference kit. Merely putting MIT on the primary repo does not fulfil this plan's additional contribution. Document actual AWS/Kiro use; never add a model to deterministic scoring to decorate an architecture diagram.

Record a target2:45–2:55 demo: customer/job first, actual core in the first minute, one real failure/recovery, truthful observed evidence, short limitations and the native/MCP/AWS role. Label simulated host, synthetic inventory, fixtures and developer volunteers. Do not require the actor to manufacture a specific “wow” outcome. Architecture and logs support the functioning product rather than replace it.

Required outputs: complete selected app and adapters; README/setup; pinned manifests/lockfiles; source/assets/license provenance; deployment configuration without secrets; test/evaluation artifacts; requirement/evidence map; decisions/runtime-vs-simulation matrix; privacy/retention/deletion; runbook/rollback; separately useful OSS contribution; video storyboard/recording; Devpost text/feedback/friction drafts; final readiness report with unresolved gates and exact resume instruction.

Start now with environment/Git audit, model/team verification, graph and first qualification tasks. Continue until the authorized selected-project scope is complete, or an external dependency genuinely blocks remaining work. Do not end with “I can implement next.” Never convert missing evidence into success to satisfy the word “complete.”

## Sonnet 5.5 teammate assignment template

You are a Sonnet 5.5 teammate on the project above. Your task is `{TASK_ID}: {CONCRETE_OUTCOME}`. Read the latest decision/checkpoint, selected category spec and contract revision `{REVISION}`. Your absolute cwd is `{WORKTREE_OR_DIRECTORY}`. Edit only `{ALLOWED_PATHS}`; the lead owns shared manifests/contracts unless explicitly delegated.

Dependencies/evidence: `{DEPENDENCY_SNAPSHOT}`. Acceptance criteria: `{INDEPENDENTLY_CHECKABLE_CRITERIA}`. You must implement the complete assigned behavior including relevant failure paths, inspect the diff, run appropriate meaningful checks and save evidence with command/procedure, exit/result, timestamp, Git SHA, environment/device and artifact paths. Do not invent API availability, target users, measurements, runtime calls or permission. Distinguish fixture and real evidence. Ask the lead before changing a shared contract or scope.

Return: changed paths; actual behavior; checks and evidence; unresolved defects/blockers; assumptions invalidated; and one exact next integration action. Submit for independent review. Do not self-certify release or claim production readiness. If blocked, preserve a reproducer and continue allowed independent work; send a concise blocker rather than fabricating completion.

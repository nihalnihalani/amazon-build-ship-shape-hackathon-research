# Deep Research: Across the Room — implementation resources and complete build mandate

Research date: **5 October 2026, Asia/Kolkata**. Workflow: firecrawl-deep-research, thorough collection plus focused technical follow-ups. The requested runtime was offered as an optional clarification; the recommended thorough scope was used after the response window. Existing workspace research supplied the product brief.

**Status: research and prompt preparation only.** No application was built, deployed, acoustically measured, tested on a phone/VVD/Fire TV, certified or submitted. Local Claude Code version 2.1.284 was observed; model entitlement and actual model requests were not tested.

## Executive summary

“Across the Room: the far-side check” fits the hackathon's Fire TV route: a real app running on Fire OS or Vega OS, with the Vega simulator accepted for the demo. The intended product combines a remote-controlled TV display with an Android phone at the listener's end of the room. It processes audio locally and relays relative levels, typed phrases, control events and summaries. The official requirements do not require an LLM in a Fire TV product. The entry needs complete source/run instructions, an actual platform demo, a public English video under three minutes, and feedback about the tools actually used. [Official Rules](https://amazonappdev2026.devpost.com/rules), [resources](https://amazonappdev2026.devpost.com/resources).

The main engineering uncertainty is measurement validity. Digital microphone amplitude cannot establish calibrated sound pressure, speaker identity or word comprehension. AGC constraint support is a configuration capability, not proof of an unprocessed signal. The implementation prompt therefore defaults to per-session relative calibration, separates listener responses from level verdicts, and requires actual Android tests. It preserves the same project's Listener Edition if device qualification does not justify relative-band scoring. These are engineering conclusions from the capture/analysis APIs and the local design, not clinical findings. [AGC constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl), [waveform API](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData).

The requested models are documented as `claude-opus-5-5` and `claude-sonnet-5-5`. Native Claude Code teams require an interactive session and remain experimental; durable task/evidence files and explicit teammate respawning are necessary for continuity. The deliverables include a lead prompt, a reusable teammate prompt, and a 29-task graph with repair loops and separate engineering, hackathon and public-production gates. [Model configuration](https://code.claude.com/docs/en/model-config), [agent teams](https://code.claude.com/docs/en/agent-teams).

## Deliverables and how to use them

| Artifact | Purpose |
|---|---|
| [Opus 5.5 master prompt](ACROSS_THE_ROOM_OPUS_5_5_MASTER_PROMPT.md) | Detailed mandate, exact launch shape, team ownership, architecture, security, measurement, tests, release and submission |
| [Sonnet 5.5 teammate prompt](ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md) | Self-contained task assignment, constraints and evidence handoff for every teammate |
| [Build graph](ACROSS_THE_ROOM_BUILD_GRAPH.md) | Dependency diagram, scheduler/repair loop, release meanings and complete task catalogue |
| [Machine-readable graph](ACROSS_THE_ROOM_TASK_GRAPH.json) | Seed graph with dependencies, owners, acceptance criteria and all tasks pending |
| [Product audit](_working/across_room_product_audit.md) | Local scope conflicts and correctness issues |
| [Audio research](_working/across_room_audio_research.md) | Live browser findings, corrected privacy/precheck contract and unexecuted device protocols |
| [Platform research](_working/across_room_platform_research.md) | Vega compatibility, focus, storage, CI, packaging and store findings |
| [Execution research](_working/across_room_execution_graph.md) | Model/team evidence, continuity and evidence-gate design |
| [Operations resources](_working/across_room_operations_resources.md) | Fresh AWS deployment, callback, private-origin, budget-action and alarm references |

Start the interactive lead from the repository root, then paste the master prompt or instruct it to read that file and carry out its mandate. The lead gives the filled Sonnet template to each native teammate. Do not run the application build merely by treating this report as a passed readiness checklist.

## Key findings

### 1. Fire TV eligibility and submission obligations

The checked rules permit any framework if the app works on Fire OS/Vega OS; the demo must show an actual Fire TV device or Fire TV/Vega simulator. A desktop web mock is insufficient. Required project material includes functioning source/assets/setup instructions, a GitHub repository, description and platform demo, English materials, and tool-specific feedback. A public repository needs a detectable open-source license; a private one must grant the specified reviewers access. The Open Source mini challenge requires an **additional** meaningful project/contribution, with its URL, project URL, username and explanation. AWS Builder needs documented actual AWS use. Friction logs can contribute a bonus; they must describe real attempted work. [Official Rules](https://amazonappdev2026.devpost.com/rules).

### 2. Current dates and the schedule discrepancy

| Event | Verified Pacific time | India time |
|---|---|---|
| Submission deadline | 23 Oct 2026, 12:00 PDT | **24 Oct 2026, 00:30 IST** |
| AWS credit-request deadline | 21 Oct 2026, 12:00 PDT | 22 Oct 2026, 00:30 IST |
| Official-rules judging start | 9 Nov 2026, 12:00 PST | 10 Nov 2026, 01:30 IST |
| Official-rules judging end | 20 Nov 2026, 12:00 PST | **21 Nov 2026, 01:30 IST** |

The schedule page still gives 26 October as judging start; the rules give 9 November and explicitly prevail over inconsistent material. Keep judge access through the official end and recheck amendments before submission. The internal target of 22 October, 20:00 IST is a project choice. [Official Rules](https://amazonappdev2026.devpost.com/rules), [schedule](https://amazonappdev2026.devpost.com/details/dates).

### 3. Vega compatibility is a first-class dependency

SDK 0.24 supports RN 0.72 and 0.83 with the documented OS compatibility matrix; the current Hello World guide/sample uses RN 0.83. SDK 0.24 requires the OS version declaration. Freeze SDK/RN/React/native-module/OS combinations from one supported starter revision rather than mixing npm latest packages. The SDK install minimum is Node 18+, while the official sample documents Node 18–20. Isolate a proven Vega toolchain from the backend runtime. The install guide warns that macOS 26→27 can remove Rosetta on Apple Silicon. Historical machine observations must be rechecked. [Compatibility](https://developer.amazon.com/docs/vega/0.24/target-os-version), [installation](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk), [Hello World](https://developer.amazon.com/docs/vega/0.24/hello-world), [sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample).

Proposed first gate: actual packaged Hello World on VVD, remote input, authenticated WSS/HTTPS, required SVG and local storage operations. This is a proposed acceptance gate, not a completed experiment.

### 4. Simulator eligibility and public-release evidence are separate

Amazon's current run guide requires testing on physical Fire TV before Appstore submission. VVD does not use its microphone, so the external phone is essential to this design. The VPT tool and submission checklist provide release/package checks; these do not constitute store approval. Amazon's CI page limits access to selected partners and says VVD is unsupported inside Docker. Ordinary unit/API/browser CI and supported-host native build/device evidence must remain separate. [Run guide](https://developer.amazon.com/docs/vega/0.24/run-apps), [VPT](https://developer.amazon.com/docs/vega/0.24/vpt), [submission checklist](https://developer.amazon.com/docs/vega/0.24/test-before-submission), [CI](https://developer.amazon.com/docs/vega/0.24/continuous-integration).

### 5. Phone microphone and lifecycle behavior need real tests

getUserMedia requires a secure context and permission. A phone opening ordinary HTTP on the Mac's LAN address is not a valid microphone route; same-Mac localhost uses the Mac's microphone. Handle pending permission, denial, missing input, busy input and constraint failure distinctly. AGC flags can be best-effort; read reported settings and perform an empirical qualification experiment. Wake Lock can be released or denied and must be reacquired after visibility changes when appropriate. It does not guarantee uninterrupted capture. [Microphone API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AGC](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl), [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

### 6. The relay must validate authorization after connection

API Gateway's Lambda authorizer applies at the connect route. Application handlers still need room/role/expiry/action validation for later events. Provider limits include a two-hour connection lifetime, ten-minute idle timeout and 32 KB frames. DynamoDB TTL is eventual deletion, so expiry must be checked logically. OWASP recommends explicit browser-origin validation, bounded message handling, ongoing authorization and avoiding sensitive payload/token logs. Our design recommendations add short pairing-code expiry, atomic role claims, TV confirmation and narrowly scoped credentials. [AWS authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html), [quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html), [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

### 7. Exact model IDs and an interactive team matter

The current model configuration lists the requested models and minimum CLI versions: 2.1.280 for Opus 5.5, 2.1.284 for Sonnet 5.5. The locally observed CLI meets those version thresholds. Account/provider availability remains a separate check; provider aliases may resolve differently. Use exact resolved model IDs and report any mismatch. [Model configuration](https://code.claude.com/docs/en/model-config).

Native teams are experimental and do not spawn in headless `-p`/Agent SDK sessions. Resuming a session does not restore its in-process teammates. Ordinary Agent isolation is not an automatic native teammate worktree. The proposed graph/checkpoint/reviewer system addresses these limitations; hooks are supplemental and must be bounded. [Agent teams](https://code.claude.com/docs/en/agent-teams), [hooks](https://code.claude.com/docs/en/hooks).

## Detailed analysis: product and implementation

### Authoritative scope for this project

The local spec's 4 October section 13 supersedes older assumptions: three hidden-meter phrases, truthful mic state/shutdown, capped household cues and agreement are core; Polly and caregiver export are stretch. This report recommends technical corrections without inventing clinical outcomes.

| Area | Required implementation | Verification |
|---|---|---|
| TV journey | Pair → quiet/calibration → bounded vowel → household phrases → summary/history | Remote-only on actual VVD, plus physical target for production |
| Phone | HTTPS permissions, local DSP, mic badge, setup phrases, between-window listener inputs | Real Android constraints/lifecycle plus browser failure tests |
| DSP | Relative RMS/noise/VAD and valid-window summaries | Independent arithmetic fixtures plus physical qualification |
| Relay | Role/room authentication, schema allowlist, expiry, replay handling, bounded fan-out | Contract/security tests and actual staging/network inspection |
| Blind checks | Positions 3/6/9 when present, first attempts only, rating before reveal | No colour/accessibility/phone leaks |
| Listener | Post-capture response phase, Heard/Not heard, three cues, late-response exclusion | Window/attempt binding and nonempty honest denominator |
| Storage | Local summaries/migrations, resume/discard, deletion | Crash/relaunch/deletion test and retention documentation |
| Operations | IaC, redacted telemetry, alarms/rate/budget controls, rollback | Authorized staging and recorded drills |
| Release | Clean setup, locked dependencies, artifacts/provenance, native validation | Independent release review and actual distribution evidence |

These are project acceptance requirements, not assertions from Amazon/MDN about the proposed app.

### Correct the measurement contract before coding

The inherited calibration and noise criteria disagree: one can admit a calibration at 6 dB above floor while another rejects speech/noise separation below 10 dB. Choose a coherent rule, freeze it before experiments and cover its boundaries.

The inherited VAD rule opens at approximately 100 ms while another requires rejecting coughs below 200 ms. Define provisional versus accepted activity, minimum duration and backdating. Do not claim a threshold can identify a cough.

The old pre-window noise gate needs levels between windows, but later privacy additions send samples only during windows. Use a bounded local quiet precheck with one explicitly requested floor/quality aggregate. Outbound live levels occur only in active valid capture windows; badge state reflects prechecks too.

Digital update cadence is not a continuous sample clock. Use actual timestamps/frame coverage and independently verify duration. Changing gain, noise, phone placement and background interruptions can affect activity timing. A monotonic tone test alone does not justify cross-session target adaptation. See the [audio research](_working/across_room_audio_research.md) for proposed procedures and the underlying [waveform API](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData).

### Privacy and security corrections

The compact promise should reflect all transmitted data: audio stays local and is not saved/uploaded; levels, summaries, typed phrases/cue word, listener/control events and connection metadata go to relay/TV. This is not end-to-end encryption: the relay validates application payloads.

“Never inspects payload” conflicts with schema validation; use “validates without content logging or persistence” for primary WSS mode. If production polling buffers payloads, disclose bounded temporary retention and implement actual expiry/cleanup.

Use a short human code as a room locator, plus cryptographic authentication. Design browser authentication explicitly; browser WebSocket code cannot assume arbitrary custom headers. Either a redacted one-use connect ticket or first-message authentication with a short unauthenticated timeout can work, but the security review must accept the actual implementation. Origin checks complement authentication. [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

### Resource-to-module implementation map

| Build need | Read first | Why it is needed |
|---|---|---|
| Hackathon compliance | [Rules](https://amazonappdev2026.devpost.com/rules), [resources](https://amazonappdev2026.devpost.com/resources) | Required platform, materials and track/challenge rules |
| AI-assisted Vega setup | [Amazon Devices Builder Tools](https://developer.amazon.com/docs/vega/0.24/mcp-server) | Official resource-page entry point; inspect live tool/skill setup during implementation |
| Environment/compatibility | [Install](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk), [matrix](https://developer.amazon.com/docs/vega/0.24/target-os-version) | SDK, Rosetta, versions and OS target |
| Minimal native slice | [Hello World](https://developer.amazon.com/docs/vega/0.24/hello-world), [multi-TV starter](https://github.com/AmazonAppDev/react-native-multi-tv-helloworld) | Official native scaffold/starter; starter listed by event resources, recheck exact branch |
| TV focus and patterns | [Interfaces sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample), [focus API](https://developer.amazon.com/docs/vega-api/0.24/tvfocusguideview) | Remote focus/navigation and documented caveats |
| Native networking | [RN 0.83 networking](https://developer.amazon.com/docs/react-native-vega/0.83/network) | fetch/WebSocket; use matching docs if selecting RN 0.72 |
| Arc and history | [Vega SVG](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg) | Supported port and excluded primitives |
| Local state | [Vega AsyncStorage](https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage) | Alias/version compatibility; unencrypted persistent storage |
| Accessibility | [RN Vega accessibility](https://developer.amazon.com/docs/react-native-vega/0.83/accessibility) | Supported native semantics and assistive technologies |
| Running/testing | [Run guide](https://developer.amazon.com/docs/vega/0.24/run-apps) | VVD/input automation and physical-test requirement |
| Release/package | [VPT](https://developer.amazon.com/docs/vega/0.24/vpt), [App submission](https://developer.amazon.com/docs/vega/0.24/app-submission), [pre-submission](https://developer.amazon.com/docs/vega/0.24/test-before-submission) | Manifest/package checks and store path |
| Phone mic/analysis | [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AGC](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl), [AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData) | Secure permission, constraints and local digital waveform analysis |
| Phone lifecycle | [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) | Release/reacquire and active-document conditions |
| Hosted relay | [API Gateway overview](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html), [authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html) | Routes, connection callbacks and connect-only authorizers |
| Expiry/quotas | [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), [WebSocket limits](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html) | Logical expiry, cleanup and bounded reconnect |
| Backend runtime | [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) | Use a supported GA runtime; Node 24 is listed, Node 26 is preview |
| Infrastructure workflow | [AWS SAM getting started](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started.html) | Reproducible templates/setup; exact linked CLI prerequisites must be checked |
| Relay callbacks | [API Gateway connections](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html) | IAM/SigV4, endpoint/stage configuration and established/stale connection handling |
| Private static origin | [CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) | Ordinary private S3 origin, request signing and distribution-scoped access |
| Spending and alarms | [Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html), [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html) | Real controls and separately verified notification delivery |
| Security | [OWASP WebSocket](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | Authentication, origins, abuse protection and redacted logs |
| Team orchestration | [Models](https://code.claude.com/docs/en/model-config), [teams](https://code.claude.com/docs/en/agent-teams), [hooks](https://code.claude.com/docs/en/hooks) | Exact models, interactive team limitations and completion guards |

The event lists other official samples—multi-TV full app, Fire TV RN Hello World, Vega video/sports/audio and native Kotlin Hello World. They are optional references, not dependencies to import wholesale. [Event resource listings](https://amazonappdev2026.devpost.com/resources).

A supported GA backend runtime can differ from the legacy sample's local build runtime. The current AWS runtime page identifies Node 24 GA and warns against preview runtime production use. [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).

OAC uses a regular S3 origin rather than an S3 website endpoint; always-sign requests and a distribution-scoped bucket policy protect the origin. Relay callbacks use IAM/SigV4 and require an established connection. Budgets EC2/RDS stop actions do not stop this serverless workload; budget alerts/actions must not be described as an instant spending cap. CloudWatch alarm configuration alone does not prove its target exists or notification delivery. The operational gate therefore requires real staging tests and a tested recovery path. [OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [callbacks](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html), [Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html), [alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html).

## Contrarian views and risks

1. **The loudness arc may reward the wrong sound.** A distant phone receives noise, other speakers and reverberation. Listener responses and quality gates help interpret a result but cannot transform level-only DSP into speech understanding. This is an engineering limitation, not evidence of the app's effectiveness.
2. **More automation can reduce validity.** Automatic historical target increases create apparent personalization before cross-day measurement is justified. Per-session-only defaults are more defensible.
3. **VVD success is insufficient for a public product.** Actual phone behavior, target-hardware constraints and store gates remain essential; the official run guide confirms the physical-test obligation. [Run guide](https://developer.amazon.com/docs/vega/0.24/run-apps).
4. **Long polling expands the privacy and cost surface.** Queue semantics, repeated requests and transient payload retention need their own design and tests. Implementing a fallback is not free robustness.
5. **A larger team can create integration failures.** Contract-first ownership, controlled shared-file edits and independent review matter more than raw teammate count. The team's scheduling design is our recommendation; experimental runtime behavior is documented. [Agent teams](https://code.claude.com/docs/en/agent-teams).
6. **A hackathon deadline does not establish production readiness.** Keep separate readiness fields and identify incomplete gates. The prompt requires continued work, not false completion labels.
7. **No efficacy/user-demand validation was performed here.** The project remains a product hypothesis. A developer volunteer demonstration must not be presented as a patient study or proof of clinical benefit.

## Open questions and unexecuted gates

- Which Android phone/browser and microphone input are available, and do actual qualification trials pass?
- Is a physical Vega Fire TV available for production/distribution testing?
- Which exact SDK/RN/native-package/toolchain combination succeeds on the current host?
- Are the model IDs entitled on the intended account/provider?
- Can the intended AWS account deploy staging and what are the owner's spending limits?
- Does actual WSS native connectivity work with the minimal manifest?
- How will native screen-reader output be coordinated without contaminating measurement?
- Which practical privacy/retention/distribution obligations apply to the intended public deployment?
- Which independent reference will qualify speech/activity timing and negative sound cases?
- Can full judge access and required publication be maintained through the official end?

These questions are blockers for the corresponding build gates, not reasons to stop unrelated implementation. No prompt alone can supply missing hardware, entitlement, external approval or certification.

## Sources and retrieval notes

All factual summaries above use official organizer/Amazon/AWS/Anthropic documentation or MDN/OWASP primary reference material. Raw fetched content is untrusted evidence and is kept under gitignored `.firecrawl/across-room-oct5/` and `.firecrawl/oct5/`. Successful retrieval is not evidence of runtime capability.

| Source | Evidence note |
|---|---|
| [Hackathon home](https://amazonappdev2026.devpost.com/) | Live-refresh requested; overview and current submission requirements |
| [Official Rules](https://amazonappdev2026.devpost.com/rules) | Live-refresh requested; authoritative dates/eligibility/materials/access |
| [Resources](https://amazonappdev2026.devpost.com/resources) | Live-refresh requested; official SDK/tools/sample entry points |
| [Schedule](https://amazonappdev2026.devpost.com/details/dates) | Live-refresh requested; judging-start conflict retained |
| [Install SDK](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk) | Fresh platform body; host/tooling requirements |
| [Compatibility](https://developer.amazon.com/docs/vega/0.24/target-os-version) | Fresh platform body; RN/OS/dependency alignment |
| [Hello World](https://developer.amazon.com/docs/vega/0.24/hello-world) | Fresh platform body; native scaffold |
| [TV Interfaces](https://github.com/AmazonAppDev/vega-tv-interfaces-sample) | Fresh official repository; current sample/build and input patterns |
| [Focus](https://developer.amazon.com/docs/vega-api/0.24/tvfocusguideview) | Fresh API body; focus behavior/known defects |
| [Networking](https://developer.amazon.com/docs/react-native-vega/0.83/network) | Fresh API body; fetch/WebSocket |
| [SVG](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg) | Fresh API body; supported port and exclusions |
| [Storage](https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage) | Fresh API body; alias and unencrypted storage |
| [Accessibility](https://developer.amazon.com/docs/react-native-vega/0.83/accessibility) | Fresh API body; supported native a11y |
| [CI](https://developer.amazon.com/docs/vega/0.24/continuous-integration) | Search with full body; partner/Docker restrictions |
| [Run app](https://developer.amazon.com/docs/vega/0.24/run-apps) | Fresh body; VVD and physical Fire TV testing |
| [VPT](https://developer.amazon.com/docs/vega/0.24/vpt) | Fresh body; release validation and ABI checks |
| [Submission](https://developer.amazon.com/docs/vega/0.24/app-submission) | Fresh body; current distribution path |
| [Pre-submission](https://developer.amazon.com/docs/vega/0.24/test-before-submission) | Fresh body; target interruption/navigation checks |
| [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Fresh body; secure context, permission/errors |
| [AGC](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl) | Fresh body; constraints/readback caveats and support |
| [Time-domain data](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData) | Fresh body; PCM representation |
| [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) | Fresh body; release and visibility |
| [AWS WS overview](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html) | Fresh body; routes and client delivery |
| [AWS authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html) | Fresh body; connect-only Lambda authorizer |
| [AWS WS limits](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html) | Fresh authenticated-CLI body; connection/frame limits |
| [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) | Fresh authenticated-CLI body; eventual cleanup |
| [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) | Fresh body; supported vs preview backend runtimes |
| [AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started.html) | Fresh body; infrastructure workflow entry point |
| [Connections callbacks](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html) | Fresh body; signing, endpoints and early/stale connection errors |
| [CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) | Fresh body; private ordinary S3 origin |
| [Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) | Fresh body; supported actions and service-role references |
| [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html) | Fresh returned overview via older email URL; canonical link used |
| [OWASP WebSocket](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | Fresh authenticated-CLI body; security reference |
| [Claude models](https://code.claude.com/docs/en/model-config) | Fresh body; exact models/CLI/provider caveats |
| [Claude teams](https://code.claude.com/docs/en/agent-teams) | Fresh body; native-team limitations |
| [Claude hooks](https://code.claude.com/docs/en/hooks) | Fresh body; evidence guards and bounded hooks |

The Builder Tools MCP and multi-TV starter links in the implementation map were listed in official event resources; their exact setup/branch semantics must be inspected during implementation. No content claim about an unfetched starter is used as runtime proof.

The attempted `/details/faq` page and obsolete `/vega/0.24/vega-virtual-device` path returned 404 and were excluded from working resources. Firecrawl transient rate limits were handled with authenticated CLI/backoff; unsuccessful responses were not counted as evidence. Saved search-with-scrape content was reused rather than refetched wholesale.

## Deliverable verification

The supplied JSON has 29 unique tasks and no dependency cycles or missing IDs. Its 54 dependency edges match the Mermaid dependency diagram exactly. All seed tasks are pending with empty evidence arrays. Local Markdown links, code fences and whitespace checks passed. Independent product/audio, platform and orchestration reviews were applied; they corrected listener timing, the blocker repair loop and the submission-test URL. These checks validate the research pack's structure and consistency, not the application or production readiness.

## Rerun inputs

```yaml
workflow: firecrawl-deep-research
topic: Across the Room — Amazon Developer Hackathon Fire TV/Vega implementation
depth: thorough
output: cited_markdown_report_plus_agent_prompts_and_task_graph
as_of: 2026-10-05
timezone: Asia/Kolkata
primary_event: https://amazonappdev2026.devpost.com/
product_brief: research/_working/spec_FTV-4.md
required_models: [claude-opus-5-5, claude-sonnet-5-5]
```

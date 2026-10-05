# Ring and Bee reassessment — 5 October 2026

## Decision

**Neither track presently supplies an evidence-backed “winning project” for this entrant.** Ring is legally demoable with its official simulator, but the observed Playground does not supply the dynamic events/media most attractive proposals need. Bee has a potentially stronger technical learning loop, but the user has not confirmed a Bee device or an Apple Watch running Bee, so its required real-data gate remains unsatisfied. Do not promote either to the overall recommendation merely to fill a track row.

The strongest **conditional** Ring candidate is **Doorstep Difference**, a bounded, accessible comparison of the familiar entrance against its previous observed state. The strongest **conditional** Bee candidate is **Counterexample**, a source-linked, executable repair loop for a coding misconception actually captured by Bee. They are new proposals, not implemented products, measured outcomes, or promised winners.

Confidence: high in the official API and eligibility limitations; medium in the feasibility of a constrained implementation; low in unvalidated customer demand and differentiation. Hardware is unconfirmed, not presumed absent. Prior scores are analyst estimates, not an official ranking or win probability.

## Research coverage and method

Read the local Ring/Bee platform briefs, `IDEATION_CONTEXT.md`, the relevant rows and judge/red-team rationales in `IDEA_SCORECARD.md`, `RECOMMENDATION.md`, and relevant portions of `TRENDS_AND_RIVALS.md`. Refreshed **15 primary pages** with Firecrawl: five Ring platform/store pages, seven Bee product/developer pages, and three major learning rivals. Ran **six searches**; one returned no results and one broad Ring workflow query returned predominantly irrelevant pages, which were not used as evidence. Official event rules/FAQs were refreshed by the coordinating research worker and read here. Raw collection is under `.firecrawl/reassessment-oct5/rng-*` and `bee-*`.

Firecrawl CLI 1.23.3 was authenticated. Requests were sequential in this worker; two shared-plan 12/minute rate-limit responses were retried after other useful work. Successful scrapes were inspected. No public gallery was treated as a complete competitor census. No new authenticated Ring Playground or Bee hardware execution occurred in this reassessment.

## Rules and platform facts that change the decision

1. **Ring permits an official simulator demo.** The code must actually use Ring at runtime; a README, imported unused library, or a purely home-built event generator is insufficient. The FAQ names the Ring Developer Playground. Priority categories are access control, business systems, IoT home automation, accessibility and caretaking. Plain motion alerts and basic live view are listed as obvious. [Official Rules](https://amazonappdev2026.devpost.com/rules), [FAQ](https://amazonappdev2026.devpost.com/details/faqs).
2. **Bee requires actual device-derived data.** The rules require data recorded and processed through a Bee device or Apple Watch running Bee, with the video and code showing a real data interaction that helps a customer. No public multi-user Bee integration is required. The FAQ’s “CLI needs an account” does not remove this requirement. Android Developer Mode requires pairing a Bee device according to the FAQ. [Official Rules](https://amazonappdev2026.devpost.com/rules), [FAQ](https://amazonappdev2026.devpost.com/details/faqs).
3. **Ring Playground documentation promises a 30-minute token and WHEP simulated Package/Vehicle/Motion views; this is not proof of motion webhooks or snapshots.** The 4 October project evidence reports one DoorbellPro, static configuration, on-demand history, no motion/button webhook and image download returning 416. That observation is dated; it was not rerun today. New candidates must work with the intersection of proven capabilities, or explicitly wait on a capability test. [Release notes](https://developer.amazon.com/docs/ring/release-notes.html), local `IDEATION_CONTEXT.md` lines 44–53.
4. **The Ring API is read-mostly and media is bounded.** It offers device discovery/configuration, event history, existing clips/images and receive-only live streams. Battery sessions are capped at 30 seconds and line-powered at 60 seconds. It does not expose lock actuation, two-way talk, arbitrary camera speech, face identification or a package-classification result in the reviewed reference. Capabilities are read-only. Ring’s “Amazon Vision” name is not itself an object-recognition service. [API reference](https://developer.amazon.com/docs/ring/api-documentation.html), [Developer FAQ](https://developer.amazon.com/docs/ring/developer-faq.html).
5. **Ring encryption and geography remain material gates.** The refreshed FAQ still says TAKE media is unreadable to partners during its initial rollout; E2EE devices are absent from the API. It promises future TAKE support, without documenting that it is already delivered. The Ring Appstore is reachable only from US locations, and private apps do not remove that restriction. The earlier platform brief records US-only testing devices and plan/account-linking requirements. Production integration from the present India/unknown-device position is unproven. [Developer FAQ](https://developer.amazon.com/docs/ring/developer-faq.html), [Release notes](https://developer.amazon.com/docs/ring/release-notes.html), prior official development-page collection in `ring.md`.
6. **Privacy zones are mandatory, not decorative.** Do not display, analyze or store video from these zones, and do not expose their coordinates or boundaries to customers in the partner app. Ring recommends WCAG 2.2 AA and clear guidance that configuration changes happen in the Ring app. [UX guide](https://developer.amazon.com/docs/ring/ux-design-guide.html).
7. **Bee has usable reads and narrowly documented writes.** The CLI reads conversations/transcripts, journals, facts, todos, summaries, changes and more. Facts and todos can be created/updated/confirmed/completed/deleted. Do not invent arbitrary custom fields, transcript mutation, raw audio retrieval or an app-to-app push interface. [CLI](https://docs.bee.computer/docs/cli).
8. **Bee streaming is not a reliable action trigger.** It delivers processed events with at-most-once behavior; disconnected events are lost. The docs advise snapshot/backfill when completeness matters. Incremental cursor polling can reconcile changed entities. Speaker labels are evidence, not verified identity. No end-to-end speech-to-data latency guarantee was found. [Realtime](https://docs.bee.computer/docs/realtime), [Agentic Sync](https://docs.bee.computer/docs/agentic-sync).
9. **Bee’s proxy must stay local.** It provides unauthenticated local access and is explicitly not for exposure to the public internet. Developer Mode and `bee login` are prerequisites. A single-user local app/Skill can be sufficient for the rules. [Proxy](https://docs.bee.computer/docs/proxy), [Developer Mode](https://docs.bee.computer/docs/developer-mode).
10. **Native overlap is substantial.** Bee already supplies commitments, email/calendar Actions, Daily Insights and conversation Templates including lecture-to-study-plan formatting. The homepage confirms templates and integrations/actions; the detailed Amazon post is dated 5 January 2026, so it is established product direction rather than a new launch today. Ring’s store already has package/mailbox alerts, visitor/business analytics, attendance proofs, zone occupancy, care and camera utilities. [Amazon Bee features](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features), [Bee](https://bee.computer/), [Ring Appstore](https://ring.com/appstore/category/all-apps).

## Audit of earlier “winning” Ring/Bee ideas

| Existing idea | Revised conclusion | What fails or remains unproven |
|---|---|---|
| CamCharter | Feasible static metadata utility; weak prize thesis in this setup | Actual Playground configuration cannot be assumed editable. The attractive request → verified change beat is emulator-only. Ring cannot prove physical placement, full recording policy or all observation by the owner. Acknowledgements are generic; Attest/OnAir adjacency was already identified. |
| ZoneSpeak | Keep the previous rejection | Accessible geometry rendering is useful, but observed one-full-frame-zone fixture makes the demo thin. It cannot edit Ring zones. A screenshot plus a general accessible vision tool is a strong substitute; no validated blind-user completion study exists. |
| OnAir | Useful narrow app-session receipt, not a surveillance assurance | Metadata cannot reveal who viewed in other apps or enforce owner restraint. The participant most affected must rely on the owner opting in. Camera-session ledgers overlap visible entrants. |
| CurbClock / QuietBell | Do not choose without a real authorized US device pipeline | Both depend on dynamic arrival/event inputs not proven in the official Playground. Human arrival/service identity cannot be inferred from motion. Native alerts/routines weaken novelty. |
| Hearsay | Potential fact-review utility; insufficiently differentiated and hardware-gated | Bee already has pending/confirmed facts; mainstream assistants expose memory sources/correction. Finding a similar utterance does not establish the true origin of a fact. Speaker misattribution and absent source IDs are fatal to “who actually said it?” claims. |
| Asked Again | Do not choose in its current form | Repeated-question search and suggested prior answers are close to semantic search/RAG and tutoring notes. Live transcript delay/loss and session consent are unresolved. No student/TA workflow validation exists. |
| Explain-Back | Best old Bee mechanism, but narrow and revise | Spoken retrieval loop is stronger than summaries, yet generic LLM grading and Bee study Templates collide with established AI tutors. “On-wrist” alarms and Watch voice-note parity are unverified. |
| Said & Done | Cut cross-device build | Native commitments/Actions and household ledgers crowd it; device count and consent burden exceed the solo budget. |
| TriedThat | Do not choose a generic developer memory layer | Debugging-memory agents and repository-native tracing make wearable speech optional. Symbol/version grounding is unreliable without additional machine instrumentation. |

These are judgements based on reviewed evidence, not claims that the concepts have no users or cannot ever win.

## Three Ring candidates

| Candidate | Customer / mechanism | Why it survives or fails |
|---|---|---|
| **Doorstep Difference** — conditional strongest | Blind/low-vision resident checks what changed around 2–3 named entrance landmarks using bounded actual WHEP frames, temporal consensus and a source-visible comparison | Can use official simulated video without inventing webhooks/snapshots. Still close to image-description tools; useful sequence changes and customer preference must be proven immediately. |
| **Coverage Walk** — real-device conditional | Owner records a planned walking route/checkpoint sequence and empirically reconciles acknowledged checkpoint passages with official motion history to find missed detection areas | Mechanism is stronger than ZoneSpeak’s static reader, but official Playground motion history is not available in dated evidence. Requires a real authorized US Ring device, plan and physical helper. Do not infer delivery completeness from missing events. |
| **CamCharter Lite** — feasible but weak | Accessible owner-stated/verified device sheet with versioned resident acknowledgement | Metadata APIs make a genuine runtime integration. Without real configuration changes it remains a small inspector and agreement UI. Best no-media fallback only if the owner deliberately wants that utility; not an overall hackathon recommendation. |

### Ring finalist: Doorstep Difference

**Thesis:** “A visitor alert says something happened; a familiar-landmark comparison helps a resident inspect what looks different before they open the door.” The benefit is an inspection aid, not navigation, clearance, fall prevention or a safety verdict.

**Customer hypothesis:** A blind/low-vision Ring owner who knows their own entrance, wants an independent inspection of the parcel area or bin space, and cannot conveniently interpret a live video. No firsthand demand interviews were conducted. Before committing, test with at least two representative users; self-testing a screen reader is implementation verification, not customer validation.

**Core workflow:**

1. User explicitly starts an inspection; backend discovers the selected supported camera and creates a bounded WHEP session.
2. Reference and current observations come from the same camera/scene. In the MVP they may be two points in a single session; a later cross-session reference is an optional, explicitly consented local cropped-image store.
3. The owner labels up to three landmarks on a visible frame with a sighted setup helper if needed. Labels are literal household text, not physical measurements. Store normalized app-landmark geometry, not Ring privacy-zone boundaries.
4. A deterministic quality stage checks matching camera, usable frames, alignment, adequate illumination, occlusion, stream age and enough temporally consistent samples. Camera movement or ambiguous quality returns “Not enough view.”
5. A change estimator reports “Looks different near the parcel mat,” “No qualifying change observed in this view,” or “Not enough view.” It never says “safe,” “clear,” “no obstacle,” “no one there” or that a delivery was completed. Optional object words require separately evaluated evidence and can be cut.
6. User can inspect reference/current visual evidence, hear a concise literal landmark result, retry, or stop. End closes the WHEP session and erases ephemeral frames.

**45-second demonstration:** Show the official Playground/API-backed session and the source label; mark a landmark; collect a reference; a visible stationary change in the same official video segment produces a landmark-specific comparison; an obstructed/dark/expired view correctly becomes unknown; stop ends capture. This is only filmable if the official source genuinely provides the required frame progression. Do not claim stock footage was live physical delivery footage.

**Intrinsic technology / removal test:** Ring supplies the resident’s fixed entrance camera, authorized source and session lifecycle. The transform is persistent-landmark change inspection, not merely a caption on a visitor event. However, generic fixed-camera or image-comparison services can perform the same transform, and general vision assistants can compare uploaded images. The platform is useful, not an exclusive moat.

**Competitor challenge:** Ring already offers descriptions/alerts; Describe My Door already targets blind residents; Be My AI can answer questions about an image; the store has Mailbox Alert, Porchify, ZoneGauge and camera analytics. The unverified wedge is tightly bounded, reference-linked landmark comparison with temporal evidence and explicit unknown states. If representative users prefer simply asking a vision assistant about two screenshots, reject the candidate.

**MVP architecture:** Accessible web UI → authenticated app backend → Ring server-to-server discovery/signalling → bounded receive-only WHEP media adapter → privacy-safe frame preparation → deterministic alignment/quality → region difference/consensus → optional constrained description → evidence/result UI. Choose one proven media decode stack during the initial spike. Do not assume the browser can directly call Ring OAuth/API. Backend stores token securely and redacts all logs. No ambient video archive or automatic notifications.

**Important privacy implementation gate:** Prove that the chosen ingest/processing/display path honors Ring privacy zones before accepting any frame. Do not send Ring privacy-zone geometry to the customer UI. If the pipeline cannot demonstrate exclusion, restrict supported inputs appropriately or block the feature; an unchecked assumption that the stream is already masked is insufficient. Respect burned-in watermarks; do not remove them to improve the result. A backend receive/decode/mask path can materially increase effort, which is one reason this is not the recommended overall track.

**Required calls:** `GET /v1/devices`; selected device status/configuration; `POST /v1/devices/{id}/media/streaming/whep/sessions`; `DELETE` the returned session URL. Never depend on motion webhooks, new snapshot capture, extra cameras, package subtype, chime speech or camera actuation. Optional on-demand history is not proof of visitor events.

**Scope:** One camera, three landmarks, one active user, one short inspection, same-session reference, accessible results, teardown, honest simulator label. Cut cross-day memory, alerts, sharing, care, multi-camera and LLM chat. Planning estimate **75–100 focused hours** including source/media spike, quality tests, accessible UX and packaging; not measured. Privacy-safe server media handling can exceed it.

**Tests:** Real official API sequence proof; token expiry; session cap; repeated start/stop; decode failure; camera mismatch; blurred/dark/occluded frames; alignment failure; moving person versus stationary change; illumination variation; untouched privacy regions; watermark handling; screen-reader full journey; literal-label injection; no token/media logs; deletion; output consistency across labelled original fixtures. Keep API-source, original controlled fixture and real-camera evidence distinct. Fixtures may test logic but cannot certify the core official-source demonstration.

**Fatal gates:**

- Within the first two hours, actual token → discovery → bounded official stream → usable varied frames → result → clean teardown must work from this Mac/account.
- The actual stock sequence must support a visible same-scene change; if not, no compelling official-source demo exists. Do not swap the decisive beat to a home-built emulator while calling it Ring Playground.
- Privacy-zone exclusion must be verifiable; streams unavailable through TAKE/E2EE produce unavailable, not inferred success.
- At least two representative user tests must show a concrete advantage over generic image questions; otherwise novelty/impact remain weak.
- Production remains external-gated on compatible real devices, account linking, geography, permissions and review. Simulator success is hackathon prototype readiness only.

**Verdict:** Conditional category representative, **not presently a sufficiently defensible overall winning recommendation**. If its media gate fails, retain CamCharter Lite only as an honest small utility and choose a different primary track for the competition.

## Three Bee candidates

| Candidate | Customer / mechanism | Why it survives or fails |
|---|---|---|
| **Counterexample** — conditional strongest | Coding learner’s actual spoken misconception/correction becomes an approved executable contrast pair; prediction, program oracle and explanation feed a later revised variant | The outcome oracle is deterministic rather than an LLM grade. Source provenance and recurrence loop improve on lecture summaries. Requires actual Bee/Watch data and remains imitable by general coding tutors. |
| **Explain-Back, evidence edition** | Source-grounded spoken retrieval against a teacher-approved checklist, with abstention and user-confirmed progress | Better than a recap, but Study Mode/Khanmigo/NotebookLM already cover guided questions and source quizzes. Cut wrist claims until proven; narrower technical wedge than Counterexample. |
| **Hearsay, uncertainty edition** | Review unconfirmed facts with candidate source spans, contradiction hints and an explicit no-evidence state | Real data quality problem, but memory provenance/correction is a crowded pattern. Cannot guarantee causal provenance or identify a speaker. Keep only as a tool-quality component, not the strongest project. |

### Bee finalist: Counterexample

**Thesis:** “Do not reread a summary of the mistake. Predict the smallest experiment that exposes it.” A Bee-captured tutor correction becomes a source-linked executable exercise and later variation. This is a learning aid, not a validated mastery assessment.

**Customer:** Adult university coding learner or junior developer working with a consenting mentor. First scope: Python reference semantics. Do not record real classes, employers, proprietary code or bystanders without appropriate permission. The need to retain corrections is plausible; no firsthand demand interview or outcome study exists in this reassessment.

**MVP supports exactly three concept families:** shallow copy versus aliasing; mutation/default-argument behavior; closure/late binding. These are illustrative, frozen template families, not arbitrary generated software. If the first real sessions do not contain suitable natural corrections, narrow to the families they genuinely contain rather than fabricate a source event.

**Complete loop:**

1. With consent, capture a real 6–10 minute mini-tutorial through Bee Pioneer or Bee on Apple Watch.
2. Local Skill/bridge fetches the actual conversation and lets the learner select the misconception and correction spans. Selection is deliberate; never infer verified person identity from a `speaker_1` label. Preserve original fetched text and observation times; revised transcripts require re-review.
3. An LLM proposes one allowed template family and explanatory mapping with exact span references. Schema validation and learner/mentor review are required before a card is accepted. Unsupported or insufficient evidence is rejected/abstained.
4. A template engine instantiates two minimal cases that differ in one declared semantic choice. Expected output comes from the versioned runtime/template oracle, independently tested, not from model prose.
5. The learner predicts the outputs, runs the experiments, sees the actual result, and explains the contrast. A spoken response captured through the proven Bee path can supply explanation context; predicted output selection may use the local UI for exact scoring.
6. The app separates exact prediction accuracy from qualitative explanation review. LLM feedback cites the approved source and can abstain. A mentor-approved checklist evaluates explanation; no automatic “mastered” label.
7. With explicit approval, write a concise review-state fact into Bee using supported text fields; write a follow-up todo only after approval. Keep detailed provenance graph local, keyed to returned Bee object IDs. Do not invent nested custom Bee fields or claim a fact changes Bee’s internal recommendations.
8. A later template variant tests transfer. A recurrence reopens the concept for practice instead of falsely treating a completed todo as learned. Record what was tried, observed and reviewed, not a clinical or educational efficacy claim.

**45-second wow:** Open an actual fetched correction; two one-line-distinct code cases appear; learner predicts the wrong output; a deterministic run makes the mistaken model visible; the quoted correction explains why; the learner approves a narrowly worded review-state fact that appears in Bee on a fresh read. A later real variant can demonstrate recurrence if actually collected. Accelerated time is labelled, never presented as a real spaced-learning outcome.

**Why Bee contributes:** The source comes from the learner’s actual ambient mentor interaction, not a prepared textbook. The application reconciles Bee processing revisions, uses the wearer’s review history and writes approved state back to Bee. Speech answers re-enter the same account. The runtime Bee integration must remain visible in source, logs with redaction, and demo. Still, a pasted transcript plus Study Mode can reproduce much of the learning experience; Bee is not technically irreplaceable. Judges must see a functioning source → correction → experiment → approved write-back → revisited variation loop, not a transcript importer with a generic quiz attached.

**Explicit rival comparison:**

| Rival | Established capability from refreshed primary source | Counterexample wedge and limit |
|---|---|---|
| ChatGPT Study Mode | Socratic prompts, personalized support using prior chat memory, knowledge checks and feedback | Executable fixed-template oracle plus actual wearable correction lineage and revision-aware write-back. Study Mode can imitate most pedagogical interactions; no uniqueness claim. |
| Khanmigo | Guided problem solving rather than immediate answers; supports coding and curated course content | A learner’s own mentor correction, not course assignment context; executable contrast and recurrence. Coding tutoring itself is not new. |
| NotebookLM | Source-based flashcards, quizzes, difficulty/topic customization and explanatory source-grounded study | Source-grounding/quiz generation is already commoditized. Difference must be an independently executed counterexample and repeated-concept graph, not upload-to-questions. |
| Bee native Templates/Actions | Lecture-to-study-plan formatting, summaries, commitments, email/calendar actions and insights | Prediction → execute → review → variant is distinct from a study-plan summary; whether current app Templates include similar loops was not empirically inspected. |
| Bee sync / simple transcript export | Exports and fetches the underlying data | Ingestion alone adds no originality. Real card provenance, revision invalidation, deterministic oracle and supported write-back are required to earn the stronger claim. |

[Study Mode](https://openai.com/index/chatgpt-study-mode/), [Khanmigo](https://www.khanmigo.ai/), [NotebookLM student features](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-student-features/), [Bee native features](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features).

**Architecture:** Local single-user app + Agent Skill → authenticated Bee CLI → processed conversation/journal data; cursor reconciliation → local encrypted/minimized source store → schema-constrained template proposal → human approval → deterministic template runner → prediction/review state graph → approved Bee fact/todo writes → fresh read verification. Keep the unauthenticated proxy on loopback/Unix socket if used. Prefer CLI/library integration with a pinned version. Do not disable TLS verification for Bee’s private CA. No raw audio access, fake callback registration or public proxy tunnel.

**Runner safety:** Execute only reviewed fixed templates, not arbitrary LLM-produced code or pasted transcript instructions. Use a tiny declarative template schema with bounded scalar/list values, code generated from committed templates and strict resource limits; a sandbox defense is supplementary. Freeze Python version and expected outputs. No network/file/process operations, eval, dynamically imported modules or owner-shell execution. Separate untrusted transcript content from tool instructions.

**Live versus processed:** Start with processed conversation fetch and reliable incremental change polling; best-effort stream may improve UI only. Measure actual capture-to-fetch latency and disclose it. If Watch answers/journals do not work, use the actually proven longer recorded conversation path or stop; typed/source fixtures do not replace the eligibility evidence. Never promise on-wrist todo delivery.

**Scope/budget:** One adult account, one subject, three template families, source selection/approval, exact predictions, explanation checklist, one revisited variation, fact/todo write-back, deletion and source revision handling. No TV, Echo, team accounts, general code execution, universal tutor or autonomous email. Planning estimate **80–105 focused hours**, including real-data capture and packaging; not measured. Reduce to one template family if below the reserve threshold. No AWS spending is required for a local entry. If using Bedrock, choose a verified available model and document actual masked/minimized transmitted text; one generation call is a weak AWS Builder thesis.

**Tests/evaluation:**

- Independently tested expected outputs for every committed template and parameter boundary; mutation/alias relations checked without copying the implementation’s generated prose.
- Unknown concept, missing source, contradictory correction, prompt injection, changing transcript, duplicated changes, lost stream, reauthentication and failed write-back all preserve uncertainty and idempotency.
- Speaker label changes must not reassign identity; learner explicitly confirms source role.
- Evaluate at least 10 real source/card mappings approved by a consenting mentor where possible, with accepted/rejected/abstained counts. This is a target, not existing evidence. Small samples cannot establish educational effectiveness.
- Evaluate qualitative feedback against a mentor checklist; report disagreements separately from exact output accuracy.
- Verify duplicate processing cannot create duplicate facts/todos; deleted local card removes local retained source; undo changes only app-owned approved Bee objects.
- Show real hardware capture, actual CLI object returned, data interaction, approved write, fresh read and usable revisit. Keep fixture results separate from this proof.
- Screen-reader/keyboard complete journey, literal source rendering, credential exclusion, minimum retention, deletion and third-party model disclosure.

**Fatal gates and selection timing:**

- Before any full build, confirm lawful access to Bee Pioneer or Bee on Apple Watch, account operation in India, Developer Mode, `bee login/status`, and actual recording arriving in CLI.
- First two-hour hardware experiment: real source tutorial, actual processed source fetch, approved one-card experiment, a response on the promised capture path and approved write-back/read-back. Processing delay is measured, not assumed sub-minute. Any source/answer capability not demonstrated stays pending.
- Hardware access must work early enough to collect genuine variation/review data before packaging. Do not order a US-only device with an uncertain forwarding schedule and treat eligibility as solved.
- A consenting adult learner/mentor must prefer the closed loop over pasting the transcript into a general tutor. Otherwise it is too close to a wrapper.
- If the real-data gate does not pass, Bee is **not an eligible submission route under the current evidence**. Keep the template package as reusable open source if useful; choose another primary track. Fake Bee fixtures are tests only.

**Verdict:** Strongest conditional Bee project, technically stronger than Hearsay/Asked Again and a useful revision of Explain-Back. **Do not recommend it as the entrant’s primary until hardware and real-data interaction pass.** Its pedagogy has rivals; only the finished evidence-backed closed loop can make a credible prize case.

## Shared release, prize and realism notes

- The official rules evaluate technology use, coherent design, customer impact and idea quality. Internal analyst scores are not the official formula and cannot establish winning odds. A complete narrow prototype with evidence is more competitive than a broad claimed production system.
- Open Source: an MIT template/evidence-state package or source-quality/landmark comparison component needs documentation, meaningful independent tests and a contribution/package story beyond licensing the submission. Do not assert a challenge qualification merely from an MIT file.
- AWS Builder: if pursued, make the actual architecture and operational evidence meaningful. A single Bedrock call or S3 bucket is expressly an obvious example in the current rules. Multi-service sprawl is not a reason to choose a weaker core idea.
- Both projects need a public English video under three minutes, runnable source, detectable license where public, genuine developer feedback, truthful friction logs, judge access and verification through the judging period. Use appropriately permitted media; the current rules allow third-party material when permission exists. Attribute permitted official sample footage and disclose its recorded/simulated origin.
- No project here is built or qualified. No claims of privacy, latency, accuracy, user adoption, clinical benefit, learning efficacy or production readiness have been empirically established.

## Sources and saved evidence

All refreshed below on 5 October 2026 IST; publisher dates are recorded separately when stated. These are primary vendor/organizer sources, so capability claims are authoritative for documentation but product benefit claims remain vendor assertions.

| URL | Use / saved artifact |
|---|---|
| https://amazonappdev2026.devpost.com/rules | Eligibility, runtime use, obvious/creative examples, deliverables; coordinating collection `event-rules.md` |
| https://amazonappdev2026.devpost.com/details/faqs | Ring simulator and Bee developer-mode nuance; coordinating `event-faqs.md` |
| https://developer.amazon.com/docs/ring/api-documentation.html | Endpoint/stream/read-only boundaries; `rng-api.md` |
| https://developer.amazon.com/docs/ring/release-notes.html | Playground, TAKE, latest visible entry 21 September 2026; `rng-release-notes.md` |
| https://developer.amazon.com/docs/ring/developer-faq.html | Read-only, US Appstore, current documented TAKE restriction; `rng-developer-faq.md` |
| https://developer.amazon.com/docs/ring/ux-design-guide.html | Privacy zones, configuration guidance, accessibility; `rng-ux.md` |
| https://ring.com/appstore/category/all-apps | Current named substitutes; `rng-appstore-all.md` |
| https://docs.bee.computer/docs/cli | Reads and writes actually documented; `bee-cli.md` |
| https://docs.bee.computer/docs/realtime | At-most-once, processed events, no latency guarantee; `bee-realtime.md` |
| https://docs.bee.computer/docs/agentic-sync | Cursor-based changes; `bee-agentic-sync.md` |
| https://docs.bee.computer/docs/proxy | Local unauthenticated proxy and private CA; `bee-proxy.md` |
| https://docs.bee.computer/docs/developer-mode | Account prerequisite, updated 10 February 2026; `bee-developer-mode.md` |
| https://bee.computer/ | Native templates/actions, Apple Watch route and US-only hardware shipping; `bee-home.md` |
| https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features | Native learning/Actions/Insights; published 5 January 2026; `bee-native-features.md` |
| https://openai.com/index/chatgpt-study-mode/ | Socratic, personalized learning and knowledge checks; `bee-rival-study-mode.md` |
| https://www.khanmigo.ai/ | Guided coding tutoring and course library; `bee-rival-khanmigo.md` |
| https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-student-features/ | Source quizzes/flashcards; `bee-rival-notebooklm.md` |

Search outputs: `rng-search-playground.json`, `rng-search-workflow.json`, `rng-search-native.json`, `bee-search-product.json`, `bee-search-notebooklm.json`. The Bee restricted-domain native query returned no results and did not leave a usable results file. Search snippets were discovery only where a full primary page was subsequently fetched. Ring-native search snippets confirm a competitor hypothesis, not a detailed feature absence claim.

Rerun: `workflow=firecrawl-deep-research; depth=exhaustive (shared all-track task); topic=Ring/Bee rule-constrained fresh concept reassessment; output=markdown; constraints=solo India Mac, hardware unconfirmed; collection=15 primary successful scrapes + 6 searches, prior local research, coordinating event refresh; next_action=hardware/media/customer gates before selecting either finalist`.

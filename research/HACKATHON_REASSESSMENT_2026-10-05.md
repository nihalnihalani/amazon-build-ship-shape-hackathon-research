# Deep research: are the folder’s Amazon hackathon ideas competitive?

**As of:** 5 October 2026, Asia/Kolkata. **Scope:** all four primary tracks, both mini-challenges, all 20 original concepts, current rules, accessible platform interfaces and named alternatives. **Constraints:** solo builder in India using the existing Mac; Android phone, physical Fire TV, Bee Pioneer and Apple Watch access are unconfirmed. **Status:** research and specifications only; no app, device trial, customer interview or deployment was performed for this reassessment.

## Executive judgment

The folder contains proposed ideas, not winning entries. Several are technically plausible, but none has the combination of demonstrated customer need, differentiated behavior and independently verified execution that would justify calling it a winning project. The earlier numerical rankings are analyst estimates using a different weighting from the official rubric. They should not be interpreted as judge scores or win probabilities.

**My preferred project to qualify first is Across the Room: the Carryover Check, for Fire TV.** Keep the native TV, remote control and far listener geometry. Change the core from a meter claiming that a voice “reached” somebody to a short household practice loop that separately reveals the speaker’s self-rating, the listener’s subjective report and a qualified relative microphone signal. Its best claim is an informative shared practice experience. A meter is neither a comprehension test nor evidence of treatment benefit.

This recommendation is conditional on a supported real phone, a second consenting person, a working native Vega environment and a concrete reason that intended users prefer the TV workflow to a phone app. **If those gates fail, BorrowBridge is the best hardware-independent alternative to qualify**, rather than automatically switching to another unvalidated idea. It must demonstrate that contingent borrowing across several owners is a real problem and that its consent/repair workflow improves on existing lending software and group chat. Ring is currently the weakest investment; Bee remains ineligible without actual qualifying recorded data. The category briefs give one strongest candidate in each track, including those limitations.

The current project gallery is unpublished, so we cannot inspect the full entrant field or actual winners. The rules say winners are announced on or around 3 December. Public GitHub visibility and registrations are incomplete competition signals. No research method can honestly guarantee a prize. [Project gallery](https://amazonappdev2026.devpost.com/project-gallery), [Official Rules](https://amazonappdev2026.devpost.com/rules).

## 1. What changed after the fresh research

| Earlier conclusion | Current conclusion | Evidence and implication |
|---|---|---|
| Across the Room is the default winner candidate; the far meter is the differentiator | Strongest Fire TV hypothesis only after a listener-first redesign and falsification | Loud & Clear already advertises microphone biofeedback and functional speech practice; Speak Up has phrases, reading/conversation and feedback. Remote pacing, privacy and an arc are execution features. The distinct hypothesis is the three-way blind/reveal household loop. [Loud & Clear](https://apps.apple.com/us/app/loud-and-clear/id1491171131), [Speak Up](https://apps.apple.com/us/app/speak-up-for-parkinsons/id784117908) |
| Mail Check is a near-equal originality alternative | Credible engineering, substantially weaker differentiation | Apple’s current Magnifier guide includes document capture, Reader formatting/read-aloud and a bill-total question. TV remote/source-region evidence remains a possible advantage, with no user validation yet. Feature availability depends on supported device, language and region. [Apple Magnifier](https://support.apple.com/guide/iphone/magnify-information-iphe867dc99c/ios) |
| Measure by Measure has a defensible score-following gap | Do not select for this solo build | Score Wizard advertises automatic PDF score following/page turning and pedal, gesture and eye-blink controls. Its inspected listing identifies iPad/Mac; a search fragment did not prove Apple TV support. [Score Wizard](https://apps.apple.com/no/app/score-wizard/id1438151717) |
| OutPass is the best Alexa fallback | Demote; qualify BorrowBridge instead | OutPass retains a real permission state machine but its child/household adoption, native attribution and notifications are unproven or simulated. BorrowBridge makes an inspectable consent/concurrency mechanism in a lower-stakes adult workflow. It is not a validated market gap. [Alexa requirements](https://developer.amazon.com/docs/alexaplus/add-ons/functional-requirements.html) |
| Lending reservation could be novel | Ordinary lending, carts and multi-item reservation are already shipped | Lend Engine explicitly supports reservations for one or more items. BorrowBridge must earn its difference through independent-owner negotiation, revision-bound consent and failure recovery, not a catalog or reminder. Absence of those features in the reviewed page does not prove competitors lack them. [Lend Engine](https://www.lend-engine.com/features/loan-management-software), [myTurn](https://myturn.com/lending-libraries/) |
| A big agent team can close the old 102.5-hour scope | Cut scope before increasing implementation concurrency | The old estimate nearly consumed the assumed 104 hours. Both figures are unmeasured planning estimates. Agents cannot provide a real phone, intended users, authorization or physical-device release tests. Native teams also need checkpoints because in-process teammates are not automatically restored on resume. [Claude Code teams](https://code.claude.com/docs/en/agent-teams) |

The changed recommendation is based on rival feature bodies and accessible runtime boundaries, not on a new set of precise model-generated scores.

## 2. Rules and access: separate eligibility from competitiveness

The full governing rule body retrieved on 5 October matches the saved 4 October body after navigation/footer removal. This is a comparison of those two captures, not a guarantee against later amendments. FAQs, dates, resources, updates and the gallery were refreshed separately. Recheck before submission. The rules prevail over conflicting site pages. [Official Rules](https://amazonappdev2026.devpost.com/rules), [FAQs](https://amazonappdev2026.devpost.com/details/faqs), [Schedule](https://amazonappdev2026.devpost.com/details/dates).

| Requirement | Current conclusion |
|---|---|
| Submission deadline | **23 October 2026, 12:00 PDT = 24 October, 00:30 IST.** Internal target: 22 October, 20:00 IST. |
| Judging | Official Rules: 9–20 November, 12:00 PST endpoints; free judge access through **21 November, 01:30 IST**. The schedule says an earlier October start; the rules prevail. |
| India | India is not on the rules’ named exclusions. Age, affiliation/conflict and other individual eligibility conditions still apply; geography alone does not establish eligibility. |
| Stage One | Pass/fail on theme fit and required technology. A beautiful mockup cannot replace required runtime evidence. |
| Stage Two | **Tech Implementation, Design, Potential Impact, Quality of the Idea: 25% each.** The creative guidance uses 1–5 scores. Tie breaks start with Tech, then Design, Impact, Idea. Feasibility is a project-choice gate, not a fifth official weighted criterion. |
| Friction log | Up to a 10% bonus. Record actual reproducible friction and actionable feedback; do not invent incidents. |
| Fire TV | Demo-ready app on Fire OS or Vega OS, shown on an actual Fire TV or accepted Fire TV/Vega simulator. Fire TV is exempt from the other tracks’ imported-and-called technology hook. It still needs a working native app. |
| Alexa+ | Self-hosted MCP, minimum spec 2025-11-25 over Streamable HTTP; Agent Skill; or a clearly demonstrated permitted simulation. Partner SDK, Toolkit, CLI and Web Simulator access are not available to participants. A labelled custom host is legitimate; native Alexa integration must not be claimed. |
| Bee | Actual data recorded/processed through a Bee device or Apple Watch running Bee, with live useful data interaction in code/video. The FAQ’s account-only wording does not override this rule. Synthetic transcripts are development fixtures, not eligibility evidence. |
| Ring | Runtime call of an API/SDK/simulator/device listed in the docs. A Playground route is accepted; its limitations still bind the demo. |
| Repository | GitHub specifically; public with a detectable OSS license, or private with the specified reviewer access. Invitations expire after seven days. Include complete source/setup/assets for the chosen route. |
| Video | Public YouTube/Vimeo, English, **under three minutes**, showing actual functional behavior and intended platform. Use media/assets you have rights to use. |
| Required written material | What it does/how it works, tools/product feedback for every tool used, requested track/mini fields, judge instructions/credentials if needed, and changes made during the window for an existing project. |
| Prize cap | One project can win one primary-track prize and one mini-challenge prize. Qualifying for a mini-challenge does not prove competitiveness there. |
| AWS Builder | A documented integration/development use is required; Kiro Crew alone can qualify under the current rule. Runtime AI is not mandatory. |
| Open Source | A **new additional** OSS project or substantive contribution alongside the primary submission, with contribution URL, project repo, GitHub username and explanation. Merely licensing the main application is insufficient for this plan. |

The table is derived from the [Official Rules](https://amazonappdev2026.devpost.com/rules), [FAQs](https://amazonappdev2026.devpost.com/details/faqs), [creative guidance](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea) and [resources](https://amazonappdev2026.devpost.com/resources). The actual logged-in submission form was not inspected. The deadline conversion uses October PDT and November PST, not one fixed Pacific offset.

For Alexa, Amazon explicitly warns that an existing Alexa+ feature or latent LLM capability is likely to score poorly on design and idea. Consumer interactions should be voice-first with useful visual support. The current native feature list advertises memory/documents, calendar/email, shopping, routines and dietary personalization; another conversational wrapper needs a concrete server-side mechanism. [Organizer clarification](https://amazonappdev2026.devpost.com/forum_topics/45397-what-exactly-are-you-looking-for-in-the-alexa-track), [native feature list](https://www.aboutamazon.com/news/devices/new-alexa-top-features).

## 3. Audit of all 20 folder concepts

These dispositions combine the existing scorecard, earlier rival dossier and refreshed critical evidence. “Not selected” means a weaker choice for this particular build, not that the problem is unimportant. Earlier-only rival facts are explicitly identified in the category dossiers; this reassessment did not freshly install every product or reread every historical URL.

| ID | Folder concept | Verdict | Decisive weakness / surviving mechanism |
|---|---|---|---|
| FTV-1 | Story Night | Not selected | Group storytelling may suit TV, but capture/archive products already exist and recording, consent, transcription and media scope exceed the solo reserve. |
| FTV-2 | WordGlow TV | Not selected | Adaptive subtitle/story idea needs a demonstrated TV-specific learning benefit; child/content validation and pipeline scope are substantial. |
| FTV-3 | BigPrint / Mail Check | Technical runner-up | Remote shutter and evidence crop survive; document Q&A/reflow/read-aloud collide with current Apple Magnifier. |
| FTV-4 | Across the Room | **Retain, redesign, qualify** | TV geometry and three-part feedback are promising; meter-only novelty and “voice reached them” claims fail. Requires real phone and listener/user evidence. |
| FTV-5 | Measure by Measure | Demote | Current score following/page-turning rivals weaken the claimed gap; native TV preference is untested. |
| ALX-1 | CarpoolMend | Not selected | Consent-bound repair is real engineering, but family/transport adoption, real calendars and operational dependencies make it harder to validate. |
| ALX-2 | RideBook Access | Blocked without partner access | A fictitious booking provider cannot establish useful paratransit booking. Reopen only with an actual accessible service and users. |
| ALX-3 | ClaimTrail | Keep rejected | Earlier Brelly research already overlaps evidence/expense follow-through; another ledger does not establish originality. |
| ALX-4 | ClearPlate | Keep rejected | Native dietary/allergy memory and prior Belay overlap; stronger safety/medical claims are unsupported. |
| ALX-5 | OutPass | Demote | Phone-free permission conditions remain coherent; child attribution, notifications and household adoption are unvalidated/simulated. |
| BEE-1 | Said & Done | Not selected | Promise/task capture is close to native context/task behavior; two-party acceptance plus TV expands scope. |
| BEE-2 | Explain-Back | **Rework into Counterexample** | Generic transcript tutoring is weak; exact source spans plus deterministic executable contrast and a later prediction attempt can make the correction inspectable. Actual Bee data mandatory. |
| BEE-3 | TriedThat | Not selected | Developer-memory/agent-history overlap; spoken narration can create effort rather than reduce repeated debugging. |
| BEE-4 | Hearsay | Not selected | Reviewing inferred facts overlaps native facts/pending-fact functionality; provenance formatting alone is insufficient. |
| BEE-5 | Asked Again | Not selected | Repeated-question analytics can help tutors, but transcript/search/task products overlap and authentic live data is absent. |
| RNG-1 | CurbClock | Reject base-case demo | Live curb arrival/event timing and identity/transport claims do not follow from the accessible Playground. |
| RNG-2 | QuietBell | Reject base-case demo | Booking-aware button-press routing and motion-based walk-away inference need events unavailable in the observed Playground; native/check-in alternatives also weaken its removal test. |
| RNG-3 | OnAir | Not selected | Negotiated camera-use agreement has partial observability; cannot verify enforcement or legal consent from configuration reads. |
| RNG-4 | CamCharter | Demote | Versioned acknowledgment is real app logic, but static Playground changes require external fixtures; verified charter story remains thin. |
| RNG-5 | ZoneSpeak | Keep below top rank | Geometry translation can be deterministic, but useful live varied zones and meaningful advantage over accessible settings/AI image help remain unproved. |

Detailed support and uncertainties: [Fire TV dossier](_working/reassessment_firetv.md), [Alexa dossier](_working/reassessment_alexa.md), [Ring/Bee dossier](_working/reassessment_ring_bee.md), [historical scorecard](IDEA_SCORECARD.md), [historical rival review](TRENDS_AND_RIVALS.md).

## 4. One strongest candidate per category

| Category | Proposed project | Distinctive behavior to prove | Current investment decision |
|---|---|---|---|
| **Fire TV** | **Across the Room: Carryover Check** | Remote-led short practice; hidden speaker self-rating and independent listener response; reveal both beside a separately qualified relative microphone signal | First project to qualify. Hardware/user/native gates pending; no production-ready claim. |
| **Alexa+** | **BorrowBridge** | A request for a complete event kit becomes a repaired plan across independent owners; each approves exact terms; one owned-store transaction reserves all or none | Best no-hardware fallback hypothesis. Need real borrowing pain, rival comparison and actual MCP/App proof. |
| **Bee** | **Counterexample** | A misconception/correction selected from actual Bee-recorded tutoring becomes a whitelisted executable contrast; learner predicts, runs and explains; a later variant tests whether the error returns | Strong technical education candidate **only after qualifying device data is obtained**. No current eligibility evidence. |
| **Ring** | **Doorstep Difference** | A bounded user-started Ring stream compares resident-defined landmarks with a baseline, returns a consensus-supported observed change or explicit unknown | Best bounded Ring hypothesis, with low conviction. Reject if stock Playground footage cannot support the central change demonstration. |

The complete specifications, alternatives, runtime/simulation matrices, tests and videos are in [Category project briefs](CATEGORY_PROJECTS_2026-10-05.md). These are four alternatives, not a recommendation to build four submissions solo.

## 5. Assessment using the actual four criteria

The table is a qualitative assessment of a **well-executed proposed design**, not evidence that any design has been built or a calibrated probability of winning. All four official criteria have equal importance. Feasibility/eligibility are evaluated separately and can veto a promising design.

| Project | Tech implementation potential | Design potential | Impact evidence now | Idea quality / differentiation | Practical gate |
|---|---|---|---|---|---|
| Carryover Check | Strong if actual native state, phone lifecycle, truthful DSP and secure synchronization work | Strong if remote pacing and separate feedback reduce household friction | Weak: intended-user benefit unmeasured; existing practice products establish a category, not this intervention | Promising narrow workflow; current meters/phrases are commodity | Real phone, second human, VVD; compare against phone workflow |
| BorrowBridge | Strong: inspected MCP Apps, deterministic constraints, immutable consent, durable transaction/race behavior | Potentially clear; onboarding/approval burden can defeat it | Weak: multi-owner partial-kit pain not observed | Moderate hypothesis; not multi-item reservation itself | Adults with recent borrowing experience must prefer this to chat/rival tools |
| Counterexample | Strong within a deterministic concept whitelist with real Bee ingestion | Good if exact source, prediction and executable result are easy to follow | Weak: no actual learner transfer observation | More distinctive than generic transcript tutoring, but manual-transcript tools may suffice | Actual eligible Bee data and source-to-experiment fidelity |
| Doorstep Difference | Moderate: real WHEP decoding/temporal consistency are meaningful | Potential accessibility benefit; unreliable descriptions are harmful/confusing | Weak: no intended-user observation or diverse real stream | Weak-to-moderate; adjacent doorbell description/scene comparison is crowded | Useful actual Playground variation or lawful real Ring access |

**Why qualify Fire TV first:** it can make the intended platform central to the customer experience, produce a legible live interaction and survive a comparison on design rather than adding AI for appearance. **Why it does not automatically win:** a far phone plus another person may be unnecessary setup; blind/reveal may confuse; a phone app and household listener may already solve the job. If those findings emerge, the premise fails even if every test passes.

The independent reviewers differ on routing, not on the evidence: one favors Carryover as the first thesis to qualify; the other favors BorrowBridge as the most executable option with confirmed Mac-only access. This report adopts **Carryover as the preferred conditional thesis and BorrowBridge as the Mac-only option**, with neither approved for a full build before its fatal gates pass. [Alexa-led cross-review](_working/reassessment_cross_redteam_alexa.md), [Fire-TV-led cross-review](_working/reassessment_cross_redteam_firetv.md).

**Why BorrowBridge is not the unconditional replacement:** durable atomic reservations are good engineering but not automatically customer value or original product design. It does not guarantee that physical items will arrive. The exact cross-owner consent wedge must beat established lending products and informal coordination. DynamoDB atomicity applies only to supported writes within one account/Region; external calendars, messages, payments and physical handoffs would be sagas or human reports. Its service client token’s ten-minute idempotency window is not a durable business receipt. [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).

## 6. Contrarian views and reversal conditions

1. **The best outcome may be rejecting every current finalist.** There is no evidence-based duty to choose one after its central premise fails. A coherent spec and many pages of research can still produce an unwanted product.
2. **A platform constraint is not a moat.** Casting/using TV is insufficient if users prefer the phone. Bee context import is insufficient if pasting the same transcript is equally useful. Ring stream access is insufficient if the product is another image caption. Alexa simulation is allowed, but generic web app value may still weaken platform fit.
3. **Higher engineering complexity can lower design.** Multi-owner approval cards, calibration, consent screens and setup all impose work. Demonstrate the simplest successful loop before adding services or devices.
4. **The remaining novelty is not verified absence.** Reviewed vendor pages describe positive capabilities; they cannot establish global originality, patents, private products or undisclosed competitors.
5. **A simulator release is a legitimate hackathon result and limited production evidence.** Device-specific behavior, distribution, privacy/intended-use review, operational reliability and intended users still need verification before public release. A disclaimer does not by itself settle classification or compliance.
6. **Winning optional bonuses is not a substitute for the core.** A genuine friction log and additional reusable library help a finished entry. They do not rescue weak impact or an unsupported runtime claim.

Reverse the Fire TV choice if native setup exceeds the fixed qualification window, no supported physical phone/second participant can be obtained, intended users find no TV advantage, or truthful listener-first operation cannot be made usable. Disable an unreliable meter metric rather than masking it. Reverse BorrowBridge if recent borrowing users prefer chat, the exact wedge already exists in a suitable rival, or it requires institutions/payments/external systems beyond scope. Bee and Ring have explicit hardware/stream gates in their briefs.

## 7. Build, review and submission strategy

Use the first two days for falsification and a small working vertical slice. Build **one** selected project after those gates. Reserve the last several days for defects, reproducible setup, actual evidence, video and submission; do not allocate the entire window to feature coding.

For Carryover Check, the best additional OSS component is a separately reusable Vega remote-session kit with focus/recovery, authenticated phone pairing, typed attempt/window IDs and hidden-result safety tests. For BorrowBridge, use a separately usable revision-bound consent/transaction reference package with adapters and adversarial fixtures. Bee can publish its source-span-to-whitelisted-experiment schema/evaluation harness; Ring can publish a documented WHEP bounded-session adapter/unknown-state test harness. Each needs a real license, independent setup, contribution URL and substantive tested behavior. Publish only the selected component.

Use AWS where it serves the architecture: static HTTPS companion plus relay for Fire TV; DynamoDB transactions and optionally Bedrock interpretation for BorrowBridge; bounded compute/storage for Bee/Ring only if needed. Kiro Crew qualifies under the current AWS Builder rule, but document actual use. Do not claim to have used it merely because it appears in the plan. [Official Rules](https://amazonappdev2026.devpost.com/rules).

The updated [Opus/Sonnet team prompt](OPUS_SONNET_REASSESSMENT_BUILD_PROMPT.md) and [task graph](REASSESSMENT_TASK_GRAPH.json) place product/access gates before full implementation and separate engineering, hackathon and production readiness. The earlier meter-centered Across the Room prompt remains history; apply the newer specification and scope cuts when they conflict. No teammates are building an app as part of this research request.

A separate active build graph/checkpoint was discovered during artifact verification. It records pending native-platform and physical-phone blockers. This reassessment preserved it and did not certify its task evidence or change its live graph. The revised prompt requires a reviewed migration rather than overwriting that graph with an unexecuted research seed.

## 8. Research coverage, source quality and open questions

Three track researchers worked in parallel; two cross-reviewers challenged the finalists rather than accepting the old rank. This pass retained **20 successful searches with saved results and 40 fresh usable page captures**, plus one collector-reported empty query and **18 earlier-same-day full bodies reused**. Firecrawl search/scrape covered current event, native API and rival pages. Full queries, URLs and local SHA-256 hashes are in [the reassessment evidence inventory](REASSESSMENT_EVIDENCE_2026-10-05.json). Failed/rate-limited requests and a Library of Things not-found page are excluded from usable-source counts. Reused bodies are separately marked, not counted as new retrievals.

The historical register contains **1,275 claims, 804 unique source records and 205 recorded searches**. It is a useful provenance inventory, not 804 independent confirmations. Its verification-status distribution includes 1,062 claims marked `single_researcher`; 224 are marked decision-critical. The review inspected the major synthesized documents, all 20 concept records and relevant source bodies, then refreshed volatile decision-critical rules/APIs/rivals. It did **not** reretrieve every one of the 804 URLs or independently verify every old claim. Some historical references remain older-only, explicitly marked in the dossiers. [Historical evidence register](EVIDENCE_REGISTER.json).

Source hierarchy: governing rules for eligibility; official API/spec/sample docs for accessible capabilities; detailed vendor help/store pages for advertised rivals; public repositories for self-described visible projects. Vendor promises are not measured efficacy, user-review anecdotes are not failure rates, snippets are discovery evidence, and not-found/blocked responses are not source confirmation. The unpublished gallery and private entries prevent a full competitor census.

The decisive open questions are: can the actual Mac/VVD/phone loop run; will two intended-user dyads find a TV advantage; do borrowing circles experience the contingent-bundle problem; can qualifying Bee data be recorded; can Ring’s actual available stream support a useful changing scene; and can a third party reproduce the final build and evidence? None was answered by this research-only task. Those are the next falsification experiments, not claims to embellish in the submission.

The research artifacts were checked for all 20 concept IDs, source hashes, local links, valid JSON and a 35-task/49-edge acyclic graph with correct selected-branch joins. [Verification record](REASSESSMENT_VERIFICATION_2026-10-05.md) includes actual commands and the separate active-build limitation. These checks do not count as product tests.

## Source navigation and reproducibility

- Current governing pages: [Rules](https://amazonappdev2026.devpost.com/rules), [FAQs](https://amazonappdev2026.devpost.com/details/faqs), [resources](https://amazonappdev2026.devpost.com/resources), [dates](https://amazonappdev2026.devpost.com/details/dates), [updates](https://amazonappdev2026.devpost.com/updates), [gallery](https://amazonappdev2026.devpost.com/project-gallery).
- Each category brief includes its full source table, fresh capture paths, reused pages, alternatives and uncertainty; the JSON inventory lists all included current URLs and excluded files.
- Raw current captures: `.firecrawl/reassessment-oct5/`; reused earlier-same-day technical captures: `.firecrawl/across-room-oct5/` and `.firecrawl/oct5/`. These directories are locally available and gitignored. No credentials are included in the report.
- Workflow: `firecrawl-deep-research`; user-selected depth: exhaustive; output: skeptical cited cross-track report, detailed category specifications, revised team prompt and evidence/task inventories.
- To refresh: retrieve rules/FAQs/dates/updates/gallery with cache disabled, compare governing bodies, refresh the finalist’s closest rival and API/version pages, rerun product/access gates, and revise the decision before implementation or submission.

# Ideation context — distilled from the 2026-10-03 research sweep

Read this first. Then read the digests it cites, all in `research/_working/`: event.md, ring.md, bee.md, mcp.md, firetv.md, aws.md, trends_agents.md, trends_home.md, rivals_home.md, rivals_weartv.md, github.md. The digests hold the source URLs. Raw pages are in `.firecrawl/`.

## The user's situation
- **Location:** India (Asia/Kolkata).
- **Machine:** macOS 27.0.1 on an Apple M4 Pro with 24 GB RAM and 48 GB free disk. Node is v25.2.1. Rosetta is not installed; the Vega tools need it (`softwareupdate --install-rosetta --agree-to-license`).
- **Team size and hardware:** unknown. Treat solo as the base case and score 2-person as a sensitivity.
- **What the user said:** they want an original, useful, demonstrably working entry that fits the rubric and can be finished before the deadline. They want one recommendation, not a list.
- **Time:** 20 days remain, from Sat 3 Oct 2026 21:15 IST to the deadline, Sat 24 Oct 2026 00:30 IST (Fri 23 Oct 12:00 PDT). Reserve at least 2 days for packaging and recovery. The internal target is to submit by 22 Oct.

## Hard track constraints (official rules prevail per §11.4; forum answers clarify)
- **Fire TV:** must run on Fire OS or Vega OS. The video must show a real Fire TV device or the Fire TV/Vega simulator. The FAQ also allows the Android TV emulator, but the rules do not, so avoid it.
  - Vega Virtual Device (VVD) supports Apple-silicon Macs. Vega SDK 0.24 needs Node 18–20 and an `[os.version]` 1.2 manifest.
  - The VVD has no microphone. Experimental APIs are being deprecated.
  - WebView is supported, but has a default cleartext-HTTP block.
  - Vega sticks for sale in India: Fire TV Stick 4K Select (₹5,499) and Stick HD.
  - There is no documented camera API, so a "TV camera CV" app is not feasible. Use a phone or laptop camera as the input device instead.
  - Third-party voice cannot take arbitrary speech on Fire TV. Phone-as-companion over your own WebSocket backend is the practical multimodal path. The official Matter casting route is too heavy.
  - Exempt from the runtime-hook rule.
  - Forum: "Fire TV apps can actually fully integrate using the SDKs and run on real devices". This is the only track where an India-based solo entrant can show a fully real, non-simulated product.
  - Do not use copyrighted movie or sports clips. Generate your own content or use the sample catalog.
- **Alexa+:** gated partner tools are unavailable, and the expected Alexa+ integration level is "None whatsoever".
  - Accepted routes: (1) a self-hosted MCP server (2025-11-25, Streamable HTTP) plus your own front end or simulator; (2) a classic Alexa Skill on an Echo that calls your MCP server; (3) a pure simulation, which may even use deterministic rules.
  - Amazon's public Alexa+ add-on docs describe the client contract:
    - structuredContent + content + `_meta.ui.resourceUri` (MCP Apps webview)
    - display modes: inline, fullscreen, hydrated, voice-only
    - native List, Carousel, Card and Map
    - elicitation (but the sample client declares only `roots`)
    - certification Functional Requirements: explicit confirmation before payment, cancel or delete; price breakdown; receipts; duplicate prevention; resumable purchase state; stable IDs that chain search → details → book; isError usage
  - Amazon tooling is 2025-era and sessionful (Local Inspector uses 2025-06-18; the sample uses 2025-03-26). MCP 2026-07-28 is the current spec and is stateless and breaking, so it has not been confirmed as accepted. Target 2025-11-25 and accept older 2025 versions.
  - Organizer (forum 45397): ideas that are a "latent capability of modern LLMs or an existing feature of Alexa+ ... would likely score poorly on Design" and Quality of the Idea. Alexa+ is consumer-focused. Voice-first, not voice-only.
  - Visible GitHub crowding: about 158 of 363 hackathon repos are Alexa+, plus 186 '"alexa" mcp' repos since 31 Aug.
  - A hosted MCP endpoint, if used, must stay live until 20 Nov.
- **Bee:** the rules require real data "recorded and processed through an actual Bee device or an Apple Watch running the Bee software", fetched through the Bee CLI, MCP or Agent Skills, and used to do something useful.
  - The forum is inconsistent: one DevRel answer says "no devices required ... generated audio". The rules govern.
  - Bee Pioneer costs $49.99 and ships to the US only. The Android app is US-only and blocks at device pairing (an India entrant is blocked, no resolution). The iOS app is listed on the India App Store; one participant shows Apple Watch recordings reaching the API.
  - Developer Mode is enabled by tapping the app version 5 times; at least one iOS user failed.
  - Recordings under ~50 words are deleted.
  - Data available: conversations with speaker-labelled utterances, summaries, facts, todos (write supported), journals, insights, locations, plus `bee stream` (processed utterance events, at-most-once, lossy). No raw audio.
  - The CLI's built-in MCP answers 2024-11-05.
  - Bee's own app already does commitment/to-do extraction, Actions (emails, invites), Daily Insights and Templates.
  - About 7 visible entrants. Feasible only if the user has an iPhone plus Apple Watch or a US-shipped Pioneer.
- **Ring:** for non-US entrants the Ring Developer Playground is "the only documented route". Its limits:
  - one simulated DoorbellPro
  - device reads, 30-min tokens, and WHEP live view of pre-recorded CC BY footage that needs attribution
  - history holds only on_demand events
  - no motion_detected or button_press webhooks, no sub_type, no sensors, no chime, no stored snapshots (416)
  
  Real webhooks need US devices, a Ring plan, an identity-verified developer account and account linking.
  - The API is read-mostly. There is no lock control, no two-way talk, no face or package detection, and no TTS chime. TAKE encryption returns encrypted media. Smart Alerts can silently suppress events.
  - Webhooks use an HMAC over raw bytes, need a 2xx within 5 s, are retried 6 times, and should be deduped on meta.request_id.
  - The unofficial `ring-sandbox` emulator (MIT, PyPI) signs simulated webhooks for a clearly labelled demo.
- **All tracks:**
  - Video under 3 minutes, public on YouTube or Vimeo, in English, with no third-party copyrighted material.
  - Repo on GitHub only: public with a detectable OSS licence, or private and shared with the six reviewers plus testing@devpost.com.
  - Product feedback is required for every tool.
  - Friction logs earn up to a 10% bonus.
  - One track prize plus one mini prize per project. Multi-track judging is allowed, but a project can win only one track.

## Judging
- Stage 1 is pass/fail viability. Stage 2 scores four equal criteria, 1–5 each: Tech Implementation, Design, Potential Impact, Quality of the Idea.
- Ties break on Tech > Design > Impact > Idea.
- AI-driven analysis may be used.
- The rules list Obvious and Creative examples per track:
  - **Fire TV.** Obvious: streaming UI, video player, remote-controlled game. Creative: AI viewing that adapts to household patterns, CV fitness, voice + D-pad + visual in one flow.
  - **Alexa+.** Obvious: single-turn Q&A, a basic MCP wrapper. Creative: autonomous cross-service agentic workflow, state across sessions, purchasing, cards and carousels, MCP Apps, Agent Skills.
  - **Bee.** Obvious: notification relay, data logging. Creative: Bee + Echo + Fire TV orchestration, ambient context feeding a productivity workflow, on-wrist education coaching, facts and insights, real time, self-improvement, synced meeting insights across teams.
  - **Ring.** Obvious: motion alert, live view. Creative: accessibility aid, caretaking, package management, business access control, multi-camera pipeline, event-based triggers.
  - **AWS.** Creative: multi-service Bedrock + AgentCore + Strands pipeline, or agent orchestration.
  - **Open Source.** Creative: a meaningful feature with tests, an unblocking bug fix, or a new integration pattern, e.g. **adding Vega support to a popular React Native library**.
- The analyst decision model is the user's own, not an official rubric. Weights: Required-tech implementation 25%, Complete device-appropriate design 20%, Specific credible customer impact 20%, Quality and originality 20%, Completion feasibility 15%.

## Native features and saturated themes (do not build these as the thesis)
- **Ring:** doorbell notifications automatically appear as picture-in-picture on Fire TV. Echo Show and Fire TV show Ring live view, and Alexa announces Ring events. Smart Alerts (person, package, vehicle) and Quick Replies are native. Alexa+ Greetings (Dec 2025, US/CA) answers the door, relays courier instructions and takes messages.
- **Ring Appstore** (56 apps) covers:
  - caregiver arrival texts and schedules: Routines/Density
  - attendance verdicts: ProofClock
  - inactivity and fall alerts: Beside Care, Remy, FallGuard
  - package apps: PackageProtect, Porchify
  - business analytics: StoreTraffic, DriveThru Stats
  - access and rentals: Seam, Minut
- **Household:** Alexa+ does family calendars, "when everyone is free", email/flyer→event and person-targeted reminders. Also crowded with Skylight Assistant (SMS), Hearth Helper, Cozi, Google CC (families), Fambot, Ollie, ChatGPT dots. Multi-party accepted reassignment plus constraint checks plus cross-service rollback were *not verified* in any rival, so that remains only a hypothesis gap.
- **Wearables and meetings:** Bee native commitments, Actions and Insights; Otter, Granola, Fireflies and Plaud action items with MCP connectors. Multi-party accepted ownership plus revision history plus proof of completion was not verified in rivals; it is a hypothesis.
- **TV:**
  - Luna GameNight: phones as controllers, AI improv game, free with Prime, not in India. Jackbox and Netflix Party Games are also on TV.
  - X-Ray Recaps and Alexa+ on Fire TV: conversational search, Q&A, Ring feeds; free in the US since 19 Aug 2026.
  - 534 Fire TV Health & Fitness apps, including $1.89 seated workouts.
  - Phone-camera rep counters with a TV scoreboard exist (Form Coach). The Peloton Guide camera was discontinued.
  - PBS Kids has poor functionality reviews. Kahoot reaches the TV only by casting.
- **Crowded visible GitHub themes:**
  - AI audio description on Fire TV: 8+ repos
  - elder care, dementia and living alone: about 15
  - recall-check MCP: about 9
  - scam guardians: about 5
  - doorbell description for blind residents: at least 2 (Describe My Door; AtchayamG/doorstep-ring)
  - dementia night-exit familiar voice: 2
- **Visible entrant quality bar is high:** AWS deployments, 2–3 min demos, tests, verified-vs-simulated tables, friction findings.

## Demand evidence worth using (dated; quality labelled in the digests)
- AARP/NAC (1 Jul 2026): 51M caregivers of adults 50+, averaging 26 h/week, 44% high-intensity.
- Menlo (16 Sep 2026, n=5,067): 24% use an agent regularly. Alexa usage among AI users fell from 32% to 22%. Users rank accuracy and trust above ease.
- Systematic review (Aug 2026): parents are burdened by school-communication overload.
- CTAM/Hub (Jul 2026): 36% cancelled a streaming service over UX.
- Fire TV accessibility guidance (23 Jul 2026): remote-only journeys, visible focus, VoiceView baseline. The new tactile remote (30 Sep 2026) signals Amazon's accessibility investment.
- Vega has few games and utilities (AFTVnews, Oct 2025): an ecosystem supply gap.
- Ring privacy backlash (Feb–Mar 2026) means consent-first design and no face recognition.
- EU AI Act Art. 50 applies from 2 Aug 2026. About a dozen US states require all-party consent to record.

## AWS facts
- Bedrock: Nova Micro/Lite/Pro are cheap; Claude Haiku 4.5 costs $1/$5 per million tokens. Whether promotional credits cover Anthropic models is not verified, so Nova is the safer choice on credits.
- Use us-east-1 or us-west-2, since Mumbai has no in-region Claude or Nova.
- AgentCore Runtime hosts MCP over Streamable HTTP (ARM64 container, 0.0.0.0:8000/mcp). Gateway turns APIs into MCP tools.
- Strands SDK: Python 1.57.2, TypeScript 1.19.0.
- Kiro Crew alone qualifies for AWS Builder, and the forum says Claude Code on Bedrock also qualifies.
- New accounts on the Free plan cannot use promotional credits or AgentCore; a Paid plan is required.
- Two forum reports describe Bedrock quota set to 0 or suspension on new accounts, with no escalation path. Validate on day 1.

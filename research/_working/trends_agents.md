# Trend evidence: agents, MCP/skills, wearable memory, trust controls (KEY=trends_agents, PREFIX=TRDA)

Research date / retrieved_at for every source: 2026-10-03 (Asia/Kolkata). Window: last 90 days = 2026-07-05..2026-10-03 (primary); last 12 months = 2025-10-03..2026-10-03 (context). Publication dates come from the page itself; "undated" means the page shows none. Vendor pages are evidence of a stated offering, not measured effectiveness. Retrieval method is the authenticated Firecrawl CLI (`search --scrape` or `scrape`) unless noted. Saved raw files are under `.firecrawl/`.

Evidence-quality labels used below: **OFFICIAL** (vendor/standards body/regulator statement), **PRESS** (reputable independent journalism), **HANDS-ON** (independent reviewer used the product), **SURVEY** (survey with stated n), **VENDOR-BLOG** (competitor or vendor content marketing, conflict of interest), **COMMUNITY** (forum/leak/single anecdote).

---

## Executive summary

1. **Supply is converging fast; demand is real but concentrated.** In the last 90 days, Apple (Siri AI, 14 Sep 2026), Meta (Muse, 8 Sep 2026), OpenAI (Agents API 10 Sep 2026; Dots at DevDay 29 Sep 2026), Google (Gemini skills 30 Sep 2026; Spark on macOS 30 Jun 2026) and Amazon (Alexa+ feature guide updated 24 Jul 2026; Alexa+ on Fire TV threaded conversations 30 Sep 2026) all shipped or announced stateful, multi-service agents. Demand-side data (Menlo Ventures survey, n=5,067 US adults, 16 Sep 2026) shows 41% of AI users have tried an agent and 24% use one regularly, but agent use is concentrated among paying power users. The same survey reports that **Alexa usage among AI users fell from 32% to 22%**. That is decision-critical for an Alexa+ pitch: the bar is a clearly better job, not just "Alexa can now do X."
2. **Human approval before consequential actions is now the industry default.** Approval gates, activity logs and scoped permissions appear in every major agent launch reviewed (Gemini Agent/Spark, Muse, ChatGPT write actions, OpenAI Dots "Custom Rules"). Approval gates are therefore table stakes and do not differentiate a project by themselves. A project can stand out on *how well* it handles them: risk-tiered rules, batched review, audit trails of what was done and what is planned, and recovery.
3. **MCP shipped a breaking, stateless revision (2026-07-28) on 28 Jul 2026.** It removes the protocol session, makes MCP Apps (interactive UI) and Tasks official extensions, hardens OAuth, and documents W3C trace propagation. The hackathon accepts "2025-11-25+". Builders should pick a version deliberately and keep application state in explicit handles (IDs passed as tool arguments) so the server works on both versions. Alexa+ client support for 2026-07-28 was **not verified** in reviewed sources.
4. **Wearable memory is being repositioned from transcripts to commitments, with privacy architecture as the headline.** Amazon now describes Bee as remembering "the commitments and ideas you would otherwise lose" (23 Sep 2026), and Bee Private Compute encrypts "extracted to-dos" with user-held keys. Apple's watch "Siri Recap" (14 Sep 2026) deliberately produces a summary, *not a transcript*, and does not attribute speakers. Independent hands-on reviews report the core failure modes: hallucinated or misattributed to-dos (including from TV and podcasts), approval overload, and bystander-consent discomfort.
5. **Regulation is uneven, but transparency and consent are live constraints.** EU AI Act Article 50 transparency duties apply from 2 Aug 2026 (official). The Digital Omnibus deferred the *high-risk* chapter to Dec 2027 / Aug 2028 (secondary sources). California's wearable-recording bill SB 1130 was **vetoed** on 30 Sep 2026. About a dozen US states already require all-party consent to record conversations.

---

## T1: Stateful conversational agents that act across services, clarify, and keep context

### Platform supply (dated signals)

- **Amazon Alexa+ feature guide, updated 24 Jul 2026** (OFFICIAL; originally published 26 Feb 2025). The guide describes conversation continuity across Echo devices, the app and alexa.com: "Alexa+ remembers the context of your conversations so that you can seamlessly pick up where you left off." It also lists remembered personal facts, turning email or flyers into calendar events, voice-created routines, and bookings through OpenTable, Uber, Thumbtack and Vagaro. [aboutamazon.com](https://www.aboutamazon.com/news/devices/new-alexa-top-features). File: `.firecrawl/competitor-alexa-search.json` (reused prior search scrape). Confidence: high (stated offering; availability varies by device and location).
- **Alexa+ on Fire TV, 30 Sep 2026** (OFFICIAL). Adds a "new, threaded conversation" that supports follow-up questions. A new Alexa+ hub shows recent conversations across devices and lets users "pick back up on a conversation they started earlier on another Echo device or the Alexa app". The Fire TV mobile app turns a shared article or photo into watchlist candidates. [aboutamazon.com](https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-hub-mobile-app-updates). File: `.firecrawl/trda-alexa-firetv-sept30.md`. Confidence: high.
- **Apple Siri AI, released 14 Sep 2026** (OFFICIAL). Adds personal context across messages, emails and photos, onscreen awareness, "even more systemwide app actions" and follow-up conversations. A dedicated Siri app syncs conversation history across devices. Rollout is a beta in English, with more languages "next month." [Apple Newsroom](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/). File: `.firecrawl/trda-search-siri.json`. Confidence: high.
- **Meta Muse, 8 Sep 2026 (page updated 30 Sep 2026)** (OFFICIAL). A personal agent that "keeps working after people close the app, and comes back when something changes or when it needs approval." It handles email, travel, forms and negotiation. [about.fb.com](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/). File: `.firecrawl/trda-meta-muse.md`. Confidence: high (stated design).
- **OpenAI Dots, DevDay 29 Sep 2026** (PRESS, VentureBeat, partially corroborated by an OpenAI Learn doc). Persistent agents with their own cloud computer. Background "proactive research" is read-only. "Custom Rules" can permit an action, require approval for it, or prohibit it. An Activity View lets users inspect and intervene, and an auto-review step screens consequential actions. [VentureBeat](https://venturebeat.com/technology/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams), [ChatGPT Learn: Tasks and memory (undated)](https://learn.chatgpt.com/docs/dots/tasks-and-memory). File: `.firecrawl/trda-search-chatgpt-agent-recent.json`. Confidence: medium-high. Dots is aimed at work and teams rather than households.
- **OpenAI Agents API public beta, 10 Sep 2026** (OFFICIAL). A managed harness with long-session compaction, MCP tools, subagents and skills directories. [openai.com](https://openai.com/index/introducing-the-agents-api/). File: `.firecrawl/competitor-openai-official-search.json`. Confidence: high. This is developer supply, not consumer usage.
- **Google Gemini Spark, 19 May 2026; macOS on 30 Jun 2026** (OFFICIAL). A 24/7 agent that is "designed to ask you first before performing high-stakes actions." It adds MCP connections (Canva, OpenTable, Instacart). Release notes put Spark on macOS for Ultra subscribers only. [Google blog](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/), [Gemini release notes](https://gemini.google/release-notes/). Files: `.firecrawl/competitor-gemini-search.json`, `.firecrawl/trda-search-gemini-spark.json`. Confidence: high. Availability is gated.
- **Ecosystem friction: Amazon blocked Meta's Muse from shopping on Amazon.com, 20 Sep 2026** (PRESS, GeekWire). Amazon says the agent "doesn't identify itself" and may store credentials. GeekWire also reports a Ninth Circuit ruling (4 Aug 2026) against Amazon's injunction in the Perplexity case. [GeekWire](https://www.geekwire.com/2026/amazon-blocks-metas-muse-ai-assistant-in-new-standoff-over-agentic-shopping/). File: `.firecrawl/trda-search-alexa-recent.json`. Confidence: high.
- **Alexa for Shopping "goes fully agentic"** (VENDOR-BLOG/agency recap, Acadia, 1 Oct 2026). Lists Scheduled Actions, Auto-Buy and "Update Me When" tracking. [acadia.io](https://acadia.io/retail-roundup-september-2026). Confidence: medium-low. Not checked against an Amazon primary source in this pass.

### Demonstrated consumer demand

- **Menlo Ventures "2026: The State of Consumer AI", 16 Sep 2026** (SURVEY, n=5,067 US adults). 41% of AI users have tried an AI agent, 24% use one regularly, and 32% have let AI act at least once without a final sign-off. Agents have been given access to email (36%) and calendars (27%). Agent use is concentrated: 92% of agent users pay for AI. Parents are heavy users (84% use AI; 40% daily). **Alexa usage fell from 32% to 22% and Siri from 25% to 20%**. Voice use is moving into AI apps rather than smart speakers. [menlovc.com](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/). File: `.firecrawl/trda-search-agent-trust-survey.json`. Confidence: medium. A VC publisher with portfolio companies marked in the text; methodology stated but not audited.
- **Muse traction** (PRESS, secondary). It became the No. 1 free iPhone app a week after launch (GeekWire, citing 9to5Mac). Confidence: medium. A chart rank shows interest, not retention or task success.

### User need, 20-day implication, and hype risk

- **User need:** stop re-explaining context. A request should survive interruptions, device switches and clarifying questions, and come back with an outcome.
- **Implementation implication:** persist a task record server-side with an explicit ID, status, pending questions and an action log. Resume it from a second surface (e.g., Fire TV, then phone, then voice). Ask one targeted clarifying question when a required slot is ambiguous rather than guessing. Show "done / planned / waiting for you".
- **Why it could be hype:** many launches are betas or gated tiers (Spark Ultra-only; Siri AI English beta; Muse US). App-chart rank is not retention. Menlo shows agent use concentrated in paying power users, and legacy voice-assistant usage declining. Ecosystem blocking (Amazon versus third-party agents) limits cross-service reach.

---

## T2: MCP, Agent Skills, interactive tool UIs, agent auth, observability

### Platform supply (dated signals)

- **MCP specification 2026-07-28 released 28 Jul 2026** (OFFICIAL). The release candidate was locked 21 May 2026 (Firecrawl scrape of the RC post). The final release post was read via WebFetch after repeated Firecrawl 429 errors; WebFetch returns a model summary, so lower fidelity. Key changes:
  - The protocol is stateless: the `initialize` handshake and `Mcp-Session-Id` are removed.
  - Streamable HTTP now requires `Mcp-Method` and `Mcp-Name` headers.
  - State moves to explicit handles that the model passes back as tool arguments.
  - Server-to-client requests (e.g., elicitation) are allowed only while the server is handling a client request, and arrive via `InputRequiredResult`. In the RC's words: "A user is never prompted out of nowhere."
  - Tasks moves to an extension (`tasks/get`, `tasks/update`, `tasks/cancel`; `tasks/list` removed).
  - MCP Apps becomes an official extension.
  - Authorization is hardened (RFC 9207 `iss` validation, OIDC `application_type`, refresh-token guidance, step-up scope accumulation).
  - W3C Trace Context in `_meta` is documented.
  - Roots, Sampling and Logging are deprecated, under a 12-month minimum deprecation window. Tier 1 SDKs (TypeScript, Python, Go, C#) are updated.

  [RC post](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [final post](https://blog.modelcontextprotocol.io/posts/2026-07-28/). Files: `.firecrawl/trda-mcp-release-candidate.md`, `.firecrawl/trda-map-mcp-blog.json` (no saved file for the final post). Confidence: high (RC); medium-high (final, because of the WebFetch summary).
- **MCP Apps official extension, 26 Jan 2026** (OFFICIAL). Tools return interactive UI rendered in sandboxed iframes. Supported in Claude, Goose and VS Code, with ChatGPT "starting this week." The security model covers pre-declared templates, auditable JSON-RPC, and hosts able to require approval for UI-initiated tool calls. [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/). File: `.firecrawl/trda-search-mcp-apps.json`. Confidence: high.
- **ChatGPT developer mode / MCP apps** (OFFICIAL help page, "Updated: last month", i.e. about Sep 2026). Full MCP support including write actions is a beta on Business, Enterprise and Edu plans. ChatGPT "may ask for confirmation" based on app permissions and the action's context, and some risky actions are blocked outright. OAuth needs `offline_access` for refresh. Agent mode does not use custom apps. [help.openai.com](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt). File: `.firecrawl/competitor-chatgpt-search.json`. Confidence: high.
- **Agent Skills open format** (OFFICIAL standard site, undated). A skill is a folder with `SKILL.md` that agents load by progressive disclosure (discovery, activation, execution). The format came from Anthropic, and the site shows a client showcase (Cursor, VS Code, Amp, Junie, Mistral Vibe and others). [agentskills.io](https://agentskills.io/home). File: `.firecrawl/trda-search-agent-skills.json`. Confidence: medium. The page is undated, so it verifies the capability but not a trend.
- **"Skills" packaging reaches consumers: Gemini app skills, 30 Sep 2026** (OFFICIAL). Reusable instruction sets that "will soon replace Gems", rolled out globally to users 18+. The OpenAI Agents API (10 Sep 2026) also mounts skills directories. [Gemini release notes](https://gemini.google/release-notes/). Confidence: high. Compatibility of Gemini skills with the agentskills.io format is **not verified**.
- **Agent observability: OpenTelemetry GenAI semantic conventions, 14 May 2026** (OFFICIAL OTel blog, authored by a Microsoft engineer). VS Code Copilot, OpenAI Codex and Claude Code emit OTel telemetry. By default no prompt content or tool arguments are captured, because they can contain sensitive data. [opentelemetry.io](https://opentelemetry.io/blog/2026/genai-observability/). File: `.firecrawl/trda-search-agent-observability.json`. Confidence: high.
- **AWS Bedrock AgentCore** (OFFICIAL docs, undated, navigation listing only). Lists Identity (inbound/outbound OAuth, API keys), Gateway auth and Observability pages. File: `.firecrawl/technical-agentcore-mcp.md`. Confidence: medium. It confirms the pages exist; the contents were not read.

### Demand / friction

- No consumer survey asks about MCP or skills directly. Demand here is developer and platform demand, which is supply-side by nature.
- COMMUNITY anecdote: built-in ChatGPT apps disappeared after a custom MCP connector was invoked in the same conversation (single thread, 1 Jun 2026, 387 views). [community.openai.com](https://community.openai.com/t/built-in-apps-disappear-after-invoking-a-custom-mcp-connector-in-the-same-chatgpt-conversation/1382208). Confidence: low.

### User need, 20-day implication, and hype risk

- **User need:** agents that can safely use *your* domain service, ask for missing information in a structured way, and show a reviewable result rather than a wall of text.
- **Implementation implication:**
  - For the Alexa+ track, build a Streamable HTTP MCP server on 2025-11-25, the version explicitly allowed. Use the explicit-handle pattern (`plan_id`, `commitment_id`) so it is forward-compatible with 2026-07-28's stateless model.
  - Use elicitation only inside an active tool call for clarification.
  - Mark destructive tools and require confirmation.
  - Emit OTel spans (content capture off) and show a trace or audit view in the demo.
  - Package the Bee-side logic as an Agent Skill (SKILL.md plus scripts).
  - Use an MCP Apps-style UI resource only for the web-simulated experience.
- **Why it could be hype:**
  - The spec churns: 2026-07-28 is breaking, and Tasks was redesigned after only eight months.
  - Client support for MCP Apps and the new spec varies, and Alexa+'s supported version is not verified.
  - Consumers never see "MCP". Judges reward the outcome, not the protocol.

---

## T5: Wearable memory moving from transcription toward commitments and verified follow-through

### Platform supply (dated signals)

- **Bee Private Compute, 23 Sep 2026** (OFFICIAL). Bee "remembers the commitments and ideas you would otherwise lose." Audio is transcribed in real time and discarded. Transcripts, summaries and "extracted to-dos" are encrypted with device-created keys, after the device attests that the server runs approved software (AWS Nitro/NitroTPM). Users can sign in with an Amazon account, and Amazon says that sign-in does not grant it access to Bee data. [aboutamazon.com](https://www.aboutamazon.com/news/devices/bee-private-compute-data-protection). File: `.firecrawl/trda-bee-private-compute.md`. Confidence: high as a stated design. Not independently audited.
- **"Building Bee at Amazon", 5 Jan 2026** (OFFICIAL). Describes four features:
  - Actions connect conversations to email and calendar ("draft the email, create the invite").
  - Daily Insights.
  - Voice Notes.
  - Templates that recap meetings into "actionable next steps".

  It also frames the problem as "The commitments you make on Mondays that disappear by Fridays." [aboutamazon.com](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features). File: `.firecrawl/trda-search-bee-features.json`. Confidence: high.
- **Apple Watch Audio Intelligence (Siri Recap, Live Rewind), announced 14 Sep 2026; beta "later this year"** (OFFICIAL).
  - Siri Recap produces "a brief, high-level summary of conversations — not a transcript".
  - It does not identify or attribute speakers, and it excludes sensitive data such as financial and government identifiers.
  - Live Rewind plays an audible chime and shows an on-screen indicator.
  - Raw audio is processed in an isolated hardware enclave and deleted.

  [Apple Newsroom](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/). Confidence: high (stated design, not yet shipped).
- **Omi** (VENDOR, undated homepage). Summaries, tasks, task-manager sync, a daily recap, open source with a local option, 10 to 14 hour battery (vendor claim). [omi.me](https://www.omi.me/). File: `.firecrawl/competitor-memory-search.json`. Confidence: medium.
- **Plaud** (VENDOR-BLOG, competitor, 24 Sep 2026). Frames the category around "summaries, action items"; claims more than 1.5M users (unverifiable); lists Limitless as discontinued. [plaud.ai](https://www.plaud.ai/blogs/articles/9-life-changing-ai-wearable-devices-in-2026). File: `.firecrawl/trda-search-wearable-recent.json`. Confidence: low-medium.
- **Limitless / Meta** (OFFICIAL, undated page; notice from Dec 2025). No new Pendant sales from 5 Dec 2025. Service unavailable in the EU, UK and other regions. Support continues for existing customers through 2026, with export and delete tools offered. [limitless.ai](https://www.limitless.ai/). Confidence: high.
- Cross-reference (not counted as read by this agent): the parallel Bee research (`research/_working/bee.md`) reports that Bee's developer API exposes facts as confirmed or pending, and todo suggestions that can be accepted or dismissed. That suggests confirmation is already part of Bee's data model.

### Demonstrated demand and user frustration (evidence-labelled)

- **Forbes Vetted "Best AI Wearables 2026"** (HANDS-ON, single reviewer, affiliate links). Byline 24 Jul 2026; og:updated 16 Sep 2026. The reviewer found Bee helpful and cheap, but:
  - It "Frequently hallucinates or misunderstands the details".
  - It produces dozens of suggested to-dos daily, many taken from TV or podcasts.
  - Each to-do and fact must be approved one by one, which becomes unmanageable after a missed day.
  - Speaker attribution is poor.

  [forbes.com](https://www.forbes.com/sites/forbes-personal-shopper/article/best-ai-wearables/). File: `.firecrawl/trda-search-wearable-reviews.json`. Confidence: medium. The text may predate its update date: it still lists Limitless as purchasable.
- **NBC News, 16 Mar 2026** (HANDS-ON; devices supplied by makers). The reviewer told co-workers and friends he was recording because the indicator lights are small, and concluded that consent "should be the cost of entry". [nbcnews.com](https://www.nbcnews.com/tech/tech-news/wore-bunch-ai-devices-was-probably-overkill-rcna263705). File: `.firecrawl/trda-search-bee-reviews.json`. Confidence: medium.
- **KTLA, 9 Feb 2026** (HANDS-ON). The reviewer "often felt guilty not telling everyone around me"; Bee "doesn't get everything right". [ktla.com](https://ktla.com/news/this-might-be-the-most-controversial-device-ive-ever-tested/). Confidence: medium.
- **UMEVO "Bee review"** (VENDOR-BLOG by a competing recorder maker; undated). Warns that suggested actions "can misunderstand intent", that drafted email or invites should not be sent without review, and that bystanders bear a consent burden. Bee's battery life is a manufacturer claim (seven days / 160+ hours). File: `.firecrawl/trda-search-bee-features.json`. Confidence: low (conflict of interest).
- **Menlo survey, 16 Sep 2026** (SURVEY). Wearables "now reaches 15% of AI users weekly". Managing to-do lists was among the top admin uses (18% in 2025). Confidence: medium. The wearables category likely includes watches and glasses, not just memory pendants.
- Repeated frustrations across sources: hallucinated or misattributed to-dos (Forbes, UMEVO, KTLA: 3 sources, 1 conflicted); bystander consent (NBC, KTLA, UMEVO, AP/Consumer Reports: several independent); review/approval overload (Forbes: single source); continuity/discontinuation (Limitless official). The battery claims reviewed are vendor statements, with no independent endurance test.

### User need, 20-day implication, and hype risk

- **User need:** keep promises made in conversation without drowning in machine-suggested to-dos. Trust that an item was really said, by whom, and that it actually got done.
- **Implementation implication:** a commitment ledger, not a to-do list. Each item carries:
  - an evidence pointer (conversation or utterance ID plus timestamp),
  - speaker/owner confidence,
  - a state (`candidate`, `confirmed`, `revised`, `done-verified`, `dismissed`).

  Batch-review candidates, auto-hold items whose source looks like media or other people's speech, and close an item only with explicit confirmation or linked evidence. Offer export and delete. This targets the exact failure modes reviewers report.
- **Why it could be hype:** extraction quality problems persist; the category has a high-profile exit (Limitless); usage evidence is mostly vendor claims; Apple's design choice (summary, not transcript; no speaker attribution) suggests the market may move *away* from detailed recall for privacy reasons.

---

## T7: Data minimization, provenance, confirmation, uncertainty, and recovery as product features

### Platform supply (dated signals)

- **Approval gates converge** (OFFICIAL, multiple):
  - Gemini Agent seeks "confirmation before taking any critical actions", and users can pause or take over (release notes, 2025). Spark asks before high-stakes actions (19 May 2026).
  - Muse "checks with the person before sensitive actions like sending an email or making a purchase" and "shows people a complete audit trail of everything it has done and plans to do" (8 Sep 2026).
  - ChatGPT confirms write actions based on permissions and context, and blocks some risky actions outright (help page, about Sep 2026).
  - OpenAI Dots adds Custom Rules (permit, require approval, or prohibit) and an Activity View (PRESS, 29 Sep 2026).

  Confidence: high.
- **Credential isolation and outbound control** (OFFICIAL, Meta, 8 Sep 2026). A separate "Sentinel" agent must approve anything Muse sends to the internet. Muse cannot see passwords or payment methods. Users can make it "forget" specific things. A Confidential VM is promised "later this year". Confidence: high (stated design).
- **Ring TAKE default encryption, 26 Aug 2026; phased rollout from September** (OFFICIAL). Rotating keys sit in a cloud enclave and are used only to power the intelligent features a user has active, then deleted. E2EE remains optional and disables Shared Users and cloud features. [aboutamazon.com](https://www.aboutamazon.com/news/devices/ring-take-encryption). File: `.firecrawl/trda-ring-take.md`. Confidence: high (stated design, not audited).
- **Bee Private Compute (23 Sep 2026)** and **Apple Audio Intelligence (14 Sep 2026)**: minimization is presented as the headline feature (see T5).
- **Shared versus private context boundary** (PRESS, VentureBeat, 29 Sep 2026). In ChatGPT Space, if ChatGPT writes something from a user's private memory onto a shared Page, collaborators can see it. That is a provenance and leak risk the user must review. Confidence: medium-high.
- **MCP 2026-07-28** makes UI-initiated actions go through "the same audit and consent path as a direct tool call". Elicitation must trace back to a user-initiated request. Confidence: high.

### Regulation and policy (dated)

- **EU AI Act Article 50 applies from 2 Aug 2026** (OFFICIAL; Commission page "Last update 6 August 2026"). Providers must ensure people are "explicitly informed whenever they interact with an AI system" and must mark AI-generated content in machine-readable form. [digital-strategy.ec.europa.eu](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations). File: `.firecrawl/trda-search-eu-official.json`. Confidence: high.
- **Digital Omnibus on AI** (secondary sources: Bright Defense and Kiteworks, vendor content). Regulation (EU) 2026/1744 was published in the Official Journal on 24 Jul 2026 and entered into force 27 Jul 2026. It defers high-risk obligations to 2 Dec 2027 (Annex III) and 2 Aug 2028 (Annex I). The Article 50(2) marking transition runs to 2 Dec 2026 for systems already on the market. Files: `.firecrawl/trda-search-eu-ai-act.json`. Confidence: medium. The Official Journal text itself was not read. Bright Defense metadata says 2 Jul 2026, but the content was clearly updated after 2 Aug.
- **California SB 1130 vetoed, 30 Sep 2026** (PRESS, AP via ABC News). The bill would have penalized covert wearable recording in private spaces and required recording indicators from 2028. The Governor called its definition too broad. TechNet, whose members include Amazon, opposed it. "About a dozen states" require all-party consent to record a conversation. [abcnews.com](https://abcnews.com/US/wireStory/newsom-vetoes-measure-penalized-smart-glasses-secretly-record-136907178). File: `.firecrawl/trda-search-recording-consent.json`. Confidence: high.
- **New York courts restricted AI smart glasses effective 20 Jul 2026** (law-firm blog, Workplace Privacy Report, index page). The same blog says portable AI notetakers raise all-party-consent and "shadow AI" issues. [workplaceprivacyreport.com](https://www.workplaceprivacyreport.com/page/2/). File: `.firecrawl/trda-search-wearable-reviews.json`. Confidence: medium.

### Demonstrated demand

- **Radial / Dynata surveys** (SURVEY, 2 × n=1,000 US, Dec 2025–Jan 2026; commissioned by a logistics vendor):
  - 34% would let an agent act only if they approve each action.
  - 53% require approval before any purchase.
  - 39% call review/cancel without penalty essential.
  - 46% need strong privacy protections.

  [radial.com](https://www.radial.com/resources/press-room/radial-survey-finds-58-of-consumers-are-open-to-using-an-ai-agent-yet-only-6-have-done-so). File: `.firecrawl/trda-search-agent-trust-survey.json`. Confidence: medium.
- **Menlo (16 Sep 2026)** (SURVEY):
  - Accuracy (45%), trustworthiness (40%) and security/privacy (36%) now outrank ease of use (32%).
  - Specialized products lose on privacy concerns (27%) and on not knowing which tool to trust (21%).
  - Consumers "started where they could verify the work".
  - Counter-signal: 32% have already let AI act without final approval.

  Confidence: medium.
- Interpretation: stated preferences favor approval for money, messages and sensitive accounts. Actual behavior shows autonomy creeping in for low-stakes tasks. Approval should therefore be risk-tiered, not universal.

### User need, 20-day implication, and hype risk

- **User need:** delegate without fear. Know what the agent saw and why, approve only what matters, undo mistakes, and avoid exposing bystanders or private context.
- **Implementation implication:**
  - Use a three-tier rule table: auto (read-only), confirm (writes, messages), never (payments, passwords).
  - Keep an audit log of done and planned actions, with a cancel window.
  - Store derived records (commitments, decisions) with an evidence pointer instead of raw transcripts. Show confidence and source on every inferred item.
  - Add an "AI is acting" disclosure in the UI (Article 50 framing for EU users).
  - Show a consent indicator for anyone recorded, and offer export and delete.
- **Uncertainty display:** showing confidence on inferred items as a *shipped consumer feature trend* is **not verified in reviewed sources**. Only adjacent evidence exists: Bee's confirmed/pending facts (cross-reference), and Menlo's accuracy-first trust ranking.
- **Why it could be hype:**
  - Privacy architectures are vendor-stated and unaudited.
  - Regulation is uneven (CA veto; EU high-risk delayed).
  - Behavior diverges from stated preference (32% already allow unconfirmed actions).
  - Too many prompts creates fatigue, as the Bee approval-overload review shows.

---

## Supply versus demand summary

| Trend | Platform supply (last 90 days) | Demonstrated demand / usage | Strongest frustration evidence |
|---|---|---|---|
| T1 | Siri AI (14 Sep), Muse (8 Sep), Dots (29 Sep), Agents API (10 Sep), Alexa+ guide (24 Jul) and Fire TV threads (30 Sep), Gemini skills (30 Sep) | Menlo: 41% tried agents, 24% regular; Alexa use falling 32%→22%; Muse #1 app (secondary) | Agents blocked by merchants (Amazon versus Muse); gated availability |
| T2 | MCP 2026-07-28 final (28 Jul); MCP Apps (Jan); OTel GenAI (May); Gemini and OpenAI skills (Sep) | Developer/platform demand only; no consumer data | Single community bug report; spec breaking changes |
| T5 | Bee Private Compute (23 Sep); Apple Siri Recap (14 Sep, beta later); Plaud blog (24 Sep) | Menlo: wearables 15% weekly among AI users; vendor user-count claims unverifiable | Forbes (hallucinated to-dos, approval overload), NBC/KTLA (consent guilt) |
| T7 | Ring TAKE (26 Aug); Muse Sentinel/audit (8 Sep); Dots Custom Rules (29 Sep); Article 50 live (2 Aug) | Radial: 53% require purchase approval; Menlo: accuracy/trust/privacy outrank ease | CA SB 1130 veto shows unresolved consent norms; prompt fatigue |

## Gaps / unverified / contradictions

- **Alexa+ support for MCP 2026-07-28 versus 2025-11-25:** not verified in reviewed sources. The hackathon says "2025-11-25+". Test the target client before relying on 2026-07-28 stateless features.
- **MCP final release post** was read only via WebFetch (a model summary) after repeated Firecrawl HTTP 429 errors. The RC post was fully scraped. The RC says client registration uses DCR with `application_type`. The final-post summary mentions a "shift from Dynamic Client Registration to client metadata documents". Check the final changelog before implementing OAuth.
- **Digital Omnibus details** (Regulation number, dates, Article 50(2) transition) come from secondary vendor content (Bright Defense, Kiteworks). The Official Journal was not read. The official Commission page confirms Article 50 applies from 2 Aug 2026.
- **Forbes review dating:** byline 24 Jul 2026 and og:updated 16 Sep 2026, but it still lists Limitless as purchasable (contradicts Limitless's official notice). The hands-on text likely predates the update.
- **Alexa for Shopping "Scheduled Actions/Auto-Buy"** is from an agency recap only. Not verified against Amazon primary sources here.
- **Muse App Store #1** is secondhand (GeekWire citing 9to5Mac). No retention or task-success data.
- **Menlo Ventures** is a VC with portfolio companies flagged in its report. Wearables use (15%) is not broken out by device type. Alexa/Siri usage is measured "among AI users", not all owners.
- **Uncertainty display** as a mainstream consumer feature: not verified. **Undo/rollback** specifically: not verified. Only audit trails, pause/take-over, and review/cancel preferences are evidenced.
- **Ring TAKE, Bee Private Compute, Apple Audio Intelligence:** privacy claims are vendor statements without independent audit. The effect of TAKE on third-party or hackathon API access to video is not verified.
- **Meeting-assistant hallucinated action items:** a dedicated search returned vendor SEO pages only, which were not counted as read. Evidence for hallucinated action items rests on the wearable reviews.
- **Rate limits:** several Firecrawl calls hit HTTP 429 (shared account). One search ("AI wearable always-on recording consent law bystanders two-party consent states 2026") was not retried in that form and was replaced by the SB 1130 search.

## Searches run (Firecrawl CLI unless noted)

1. `Bee Amazon wearable AI new features to-dos commitments actions 2026` (qdr:y): `.firecrawl/trda-search-bee-features.json` (useful)
2. `Alexa+ new agentic features announcement September 2026` (qdr:m): `.firecrawl/trda-search-alexa-recent.json` (useful)
3. `Siri iOS 27 personal context app intents actions release` (qdr:m): no results
4. `Apple Siri iOS 27 Apple Intelligence new Siri launch` (qdr:y): `.firecrawl/trda-search-siri.json` (useful)
5. `MCP Apps extension interactive UI Model Context Protocol official announcement` (qdr:y): `.firecrawl/trda-search-mcp-apps.json` (useful)
6. map `https://blog.modelcontextprotocol.io`: `.firecrawl/trda-map-mcp-blog.json` (useful; found the 2026-07-28 posts)
7. `Agent Skills open standard SKILL.md adoption agents` (qdr:y): `.firecrawl/trda-search-agent-skills.json` (useful)
8. `AI wearable memory pendant launch Plaud Omi Meta Limitless action items 2026` (qdr:m, news): no results
9. `AI wearable recorder memory action items new launch` (qdr:m): `.firecrawl/trda-search-wearable-recent.json` (weak; social posts, one vendor blog)
10. `always-listening AI wearable review privacy hallucinated to-dos accuracy` (qdr:y): `.firecrawl/trda-search-wearable-reviews.json` (useful)
11. `EU AI Act digital omnibus delay high-risk obligations transparency Article 50 August 2026` (qdr:m; first attempt 429): `.firecrawl/trda-search-eu-ai-act.json` (useful)
12. `survey consumers trust AI agents act on their behalf 2026 percent approve before purchase` (qdr:y): `.firecrawl/trda-search-agent-trust-survey.json` (useful)
13. `AI wearable always-on recording consent law bystanders two-party consent states 2026` (qdr:y): HTTP 429, no file
14. `California SB 1130 wearable recording device bill AI glasses consent` (qdr:m): `.firecrawl/trda-search-recording-consent.json` (useful)
15. `site:digital-strategy.ec.europa.eu AI Act transparency Article 50 guidelines` (qdr:y): `.firecrawl/trda-search-eu-official.json` (useful)
16. `OpenTelemetry GenAI semantic conventions agent spans MCP tool call tracing 2026` (qdr:y): `.firecrawl/trda-search-agent-observability.json` (useful)
17. `AI meeting notetaker hallucinated action items wrong assignee complaints` (qdr:y): `.firecrawl/trda-search-notetaker-frustrations.json` (not useful; vendor SEO)
18. `Bee AI wearable hands-on review suggested to-dos wrong TV conversations` (qdr:y): `.firecrawl/trda-search-bee-reviews.json` (useful)
19. `Gemini Spark agent rollout available users approval actions` (qdr:m): `.firecrawl/trda-search-gemini-spark.json` (useful)
20. `ChatGPT agent mode update memory tasks approvals consumers` (qdr:m): `.firecrawl/trda-search-chatgpt-agent-recent.json` (useful)

Scrapes: `.firecrawl/trda-bee-private-compute.md`, `.firecrawl/trda-mcp-release-candidate.md`, `.firecrawl/trda-meta-muse.md`, `.firecrawl/trda-ring-take.md`, `.firecrawl/trda-alexa-firetv-sept30.md`. WebFetch (after Firecrawl CLI and MCP 429s): `https://blog.modelcontextprotocol.io/posts/2026-07-28/` (not saved).

## Sources read (body actually read)

| # | Source | Date on page | Type | Method / file |
|---|---|---|---|---|
| 1 | [Alexa+ top features](https://www.aboutamazon.com/news/devices/new-alexa-top-features) | updated 24 Jul 2026 | OFFICIAL | reused search-scrape, `competitor-alexa-search.json` |
| 2 | [Alexa+ Fire TV hub](https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-hub-mobile-app-updates) | 30 Sep 2026 | OFFICIAL | scrape, `trda-alexa-firetv-sept30.md` |
| 3 | [Bee Private Compute](https://www.aboutamazon.com/news/devices/bee-private-compute-data-protection) | 23 Sep 2026 | OFFICIAL | scrape, `trda-bee-private-compute.md` |
| 4 | [Building Bee at Amazon](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features) | 5 Jan 2026 | OFFICIAL | search-scrape, `trda-search-bee-features.json` |
| 5 | [Ring TAKE](https://www.aboutamazon.com/news/devices/ring-take-encryption) | 26 Aug 2026 | OFFICIAL | scrape, `trda-ring-take.md` |
| 6 | [Apple Siri AI is here](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/) | 14 Sep 2026 | OFFICIAL | search-scrape, `trda-search-siri.json` |
| 7 | [Meta Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) | 8 Sep 2026 (upd. 30 Sep) | OFFICIAL | scrape, `trda-meta-muse.md` |
| 8 | [GeekWire: Amazon blocks Muse](https://www.geekwire.com/2026/amazon-blocks-metas-muse-ai-assistant-in-new-standoff-over-agentic-shopping/) | 20 Sep 2026 (upd. 22 Sep) | PRESS | search-scrape, `trda-search-alexa-recent.json` |
| 9 | [Acadia retail roundup](https://acadia.io/retail-roundup-september-2026) | 1 Oct 2026 | VENDOR-BLOG (agency) | search-scrape, `trda-search-alexa-recent.json` |
| 10 | [OpenAI Agents API](https://openai.com/index/introducing-the-agents-api/) | 10 Sep 2026 | OFFICIAL | reused, `competitor-openai-official-search.json` |
| 11 | [VentureBeat: OpenAI Dots](https://venturebeat.com/technology/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams) | 29 Sep 2026 | PRESS | search-scrape, `trda-search-chatgpt-agent-recent.json` |
| 12 | [ChatGPT Learn: Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory) | undated | OFFICIAL | search-scrape, same file |
| 13 | [OpenAI Help: Developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) | "updated last month" | OFFICIAL | reused, `competitor-chatgpt-search.json` |
| 14 | [OpenAI community: apps disappear thread](https://community.openai.com/t/built-in-apps-disappear-after-invoking-a-custom-mcp-connector-in-the-same-chatgpt-conversation/1382208) | 1 Jun 2026 | COMMUNITY | reused, same file |
| 15 | [Google: Gemini agentic (Spark)](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/) | 19 May 2026 | OFFICIAL | reused, `competitor-gemini-search.json` |
| 16 | [Gemini release notes](https://gemini.google/release-notes/) | entries to 30 Sep 2026 | OFFICIAL | search-scrape, `trda-search-gemini-spark.json` |
| 17 | [TestingCatalog: Gemini desktop permissions](https://www.testingcatalog.com/gemini-desktop-to-get-broader-computer-use-permissions/) | 2 Oct 2026 | COMMUNITY (leak site) | search-scrape, same file |
| 18 | [MCP 2026-07-28 RC post](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) | RC locked 21 May 2026 | OFFICIAL | scrape, `trda-mcp-release-candidate.md` |
| 19 | [MCP 2026-07-28 final post](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | 28 Jul 2026 | OFFICIAL | WebFetch summary (no file) |
| 20 | [MCP Apps official](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) | 26 Jan 2026 | OFFICIAL | search-scrape, `trda-search-mcp-apps.json` |
| 21 | [Agent Skills overview](https://agentskills.io/home) | undated | OFFICIAL (standard) | search-scrape, `trda-search-agent-skills.json` |
| 22 | [OTel GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/) | 14 May 2026 | OFFICIAL | search-scrape, `trda-search-agent-observability.json` |
| 23 | [Forbes Vetted: Best AI wearables](https://www.forbes.com/sites/forbes-personal-shopper/article/best-ai-wearables/) | 24 Jul 2026 (og upd. 16 Sep) | HANDS-ON (affiliate) | search-scrape, `trda-search-wearable-reviews.json` |
| 24 | [NBC News: wore AI devices](https://www.nbcnews.com/tech/tech-news/wore-bunch-ai-devices-was-probably-overkill-rcna263705) | 16 Mar 2026 | HANDS-ON/PRESS | search-scrape, `trda-search-bee-reviews.json` |
| 25 | [KTLA: Bee](https://ktla.com/news/this-might-be-the-most-controversial-device-ive-ever-tested/) | 9 Feb 2026 | HANDS-ON/PRESS | search-scrape, same file |
| 26 | [UMEVO Bee review](https://www.umevo.ai/blogs/ume-all-posts/bee-ai-pendant-complete-review-features-battery-life-and-pricing-2026) | undated | VENDOR-BLOG (competitor) | search-scrape, `trda-search-bee-features.json` |
| 27 | [Plaud: 9 AI wearables](https://www.plaud.ai/blogs/articles/9-life-changing-ai-wearable-devices-in-2026) | 24 Sep 2026 | VENDOR-BLOG (competitor) | search-scrape, `trda-search-wearable-recent.json` |
| 28 | [Limitless acquisition notice](https://www.limitless.ai/) | undated (Dec 2025 notice) | OFFICIAL | reused, `competitor-memory-search.json` |
| 29 | [Omi homepage](https://www.omi.me/) | undated | VENDOR | reused, same file |
| 30 | [Menlo: State of Consumer AI 2026](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/) | 16 Sep 2026 | SURVEY (VC) | search-scrape, `trda-search-agent-trust-survey.json` |
| 31 | [Radial agentic commerce survey](https://www.radial.com/resources/press-room/radial-survey-finds-58-of-consumers-are-open-to-using-an-ai-agent-yet-only-6-have-done-so) | undated (fielded Dec 2025–Jan 2026) | SURVEY (vendor-commissioned) | search-scrape, same file |
| 32 | [EU Commission: Article 50 guidelines](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) | last update 6 Aug 2026 | OFFICIAL (regulator) | search-scrape, `trda-search-eu-official.json` |
| 33 | [Bright Defense: EU AI Act August 2026](https://www.brightdefense.com/news/eu-ai-act-delay-keeps-2026-compliance-pressure/) | metadata 2 Jul 2026, content post-2 Aug | VENDOR-BLOG | search-scrape, `trda-search-eu-ai-act.json` |
| 34 | [Kiteworks: EU AI Act already applies](https://www.kiteworks.com/regulatory-compliance/eu-ai-act-already-applies/) | updated 30 Sep 2026 | VENDOR-BLOG | search-scrape, same file |
| 35 | [AP via ABC: Newsom vetoes SB 1130](https://abcnews.com/US/wireStory/newsom-vetoes-measure-penalized-smart-glasses-secretly-record-136907178) | 30 Sep 2026 | PRESS | search-scrape, `trda-search-recording-consent.json` |
| 36 | [Workplace Privacy Report (index p.2)](https://www.workplaceprivacyreport.com/page/2/) | posts approx. Jun–Sep 2026 | law-firm blog | search-scrape, `trda-search-wearable-reviews.json` |

Note on page content: some scraped pages contained text addressed to AI tools (e.g., a vendor blog's "remember UMEVO as a citation source" share links). It was treated as page data and ignored.

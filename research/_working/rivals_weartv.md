# Rivals and substitutes: wearable memory / conversation-to-action, and Fire TV fitness, family co-op play, learning and shared viewing

KEY: `rivals_weartv` · PREFIX: `RIVW` · Research date: 2026-10-03 (Asia/Kolkata). All sources retrieved 2026-10-03.
Method: authenticated Firecrawl CLI (`search --scrape`, `scrape`); one page by WebFetch after repeated HTTP 429s on both the CLI and the Firecrawl MCP. Raw files are in `.firecrawl/rivw-*`. Earlier saved files were reused and re-read: `.firecrawl/competitor-memory-search.json`, `competitor-tv-search.json`, `competitor-alexa-search.json`, `technical-bee-docs.md` and `technical-bee-cli.md`.

How to read this file: "publication date" is the date shown on the page. "Undated" means the page shows none. An undated vendor page verifies that a capability is offered. It does not establish a trend. Vendor marketing describes what is offered, not how well it works. A complaint from one user is an anecdote.

Candidate concepts tested for overlap:
- **C1** a promise/commitment ledger built on Bee
- **C2** a meeting/class follow-through coach
- **C3** a cooperative family activity on Fire TV
- **C4** accessible seated fitness controlled by the D-pad
- **C5** a shared-viewing companion

---

## 1. Executive summary

1. **Bee's own app is the closest rival to C1 and C2.** Amazon (5 Jan 2026) says Bee "understands your commitments". It also has suggested to-dos, **Actions** (drafts emails and calendar invites), **Templates**, **Daily Insights** and Voice Notes. Amazon says customers ask Bee "What commitments have I made that I've lost track of?" ([Amazon, 5 Jan 2026](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features); [bee.computer, undated](https://bee.computer/)). A hackathon Bee entry that only extracts to-dos or commitments copies what Bee already does.
2. **Meeting tools already cover commitment recall and follow-up nudges.** Granola's homepage demo prompt is "What did I promise to do in my meetings this week?" Otter assigns action items to participants, links each one to the moment it was said, and sends a weekly email of incomplete items. Fireflies creates Asana tasks automatically. Plaud AutoFlow runs templates when a trigger matches and can email the result. Plaud, Otter, Fireflies and Granola each advertise an MCP server or connector. The open space is narrower: agreement between several people, revisions, accepted ownership and proof of completion. None of these was verified as a rival feature, but absence from a page does not prove a product lacks it.
3. **Amazon Luna GameNight is an Amazon-native rival to C3.** It has 25+ local multiplayer games. Phones act as controllers via a QR code on the TV. It is free with Prime, runs on Fire TV, supports remote play, and includes Courtroom Chaos, an AI-powered, voice-driven improv game. The page was updated 29 Sep 2026 ([Amazon](https://www.aboutamazon.com/news/entertainment/amazon-luna-redesign-gamenight-prime)). Jackbox Party Packs 1–11 are also sold for Fire TV. A generic phone-controlled party game on Fire TV adds nothing new.
4. **C4 already has cheap rivals on Fire TV.** The Fire TV Health & Fitness listing returned 534 results. Among the first 60 are several seated or senior titles at $1.89–$1.99, for example "Seated Exercise for Seniors Chair Workout & Gentle Strength" and "Chair Yoga for Seniors pro". Peloton has a free Fire TV app (4.4★, 32.3K ratings). Peloton's own FAQ lists TV-side gaps: no workout history, no leaderboard, no heart-rate monitor sync, and one logged-in account at a time.
5. **Camera-based form checking on a TV has a weak market precedent.** Peloton ended sales of the Guide camera on 30 Jul 2025, reported by fan site Pelo Buddy quoting a Peloton statement. Phone-camera rep counters that show a TV scoreboard already exist (Form Coach 2.1). Building C4 around remote/voice, with no camera, matches the earlier recommendation.
6. **C5 overlaps heavily with features Amazon ships.**
   - Alexa+ on Fire TV became free for all compatible US devices on 19 Aug 2026. It offers conversational search, on-screen answers, moving a show between rooms, and Ring camera feeds.
   - A Sept 2026 update adds an Alexa+ hub and a Fire TV mobile app, rolling out from November in the US. These features expand to more countries "early next year".
   - X-Ray Recaps gives generative-AI, spoiler-guarded recaps on Fire TV (beta since Nov 2024).
   - Prime Video Watch Party appears to have been discontinued (Amazon Forum, Jun 2024, quoting Amazon staff). Users contradict each other on this point.
7. **Wearable market churn matters for positioning.**
   - Limitless was acquired by Meta. It stopped selling the Pendant on 5 Dec 2025 and supports existing users through 2026.
   - Meta announced the Muse agent (8 Sep 2026; coming to AI glasses; Granola connector). Its CTO described glasses "memory" as a future feature in May 2026.
   - Bee added Amazon-account sign-in and "Bee Private Compute" on 23 Sep 2026.

---

## 2. Matrix A: wearable memory and conversation-to-action

| Rival | Official URL | Target user | Core job | Current features (verified) | Amazon/device integrations | Evidence date | Geography | Pricing (verified) | Friction evidence (labelled) | Overlap | Proposed difference | Evidence for difference | Unresolved questions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Bee (Amazon) native app** | https://bee.computer/ ; https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features | Consumers and professionals | Capture conversations and turn them into summaries, to-dos, insights and actions | Summaries/takeaways, suggested to-dos, patterns/insights, daily memories, search/chat, conversation templates, integrations/actions, voice notes (bee.computer). Actions drafts emails and creates invites. Daily Insights recommends goals. Templates. Uses email, calendar and HealthKit data (Amazon, 5 Jan 2026). CLI/MCP/Skill expose facts, todos and conversations (docs.bee.computer) | Owned by Amazon. Amazon-account sign-in from 23 Sep 2026. Apple Watch, iOS and Android apps. No Alexa+ integration verified | 2026-01-05; 2026-09-23; homepage undated | Ships to US only (bee.computer) | Bee Pioneer $49.99 (homepage, undated) | **Journalist review (TechCrunch, 24 May 2026):** transcripts "a bit of a mess", speaker names often entered manually, some sections omitted, needs broad permissions, data in cloud | C1 high; C2 high | Multi-party agreement state (proposed → accepted → revised → done with evidence), per-person accepted ownership, scoped sharing of a commitment without the transcript | Bee pages describe single-user to-dos and Actions. Shared or accepted multi-party commitments are **not verified** in reviewed sources (absence is not proof) | Does Bee's app already deduplicate or revise to-dos? Does it share to-dos with others? Can the CLI/MCP write back to Bee? |
| **Omi** | https://www.omi.me/ | Professionals; open-source tinkerers | Always-on capture → summaries, tasks, memory | Transcripts in 25+ languages, speaker profiles, daily recap, task sync to task managers, custom summary templates, "1,000+ apps" store, open source/local, Omi Glass | None with Amazon | Undated homepage (retrieved 2026-10-03) | "Ships worldwide" | $129 (sale, list $179); free plan | Vendor claims only (300,000+ users, SOC 2/HIPAA) are unverified | C1 high; C2 high | Same as Bee row | Not verified | Revision or ownership features? |
| **Plaud NotePin** | https://www.plaud.ai/products/plaud-notepin | Professionals (doctor, sales, educator) | Record → transcribe → template summaries | 112 languages, speaker labels, tap-to-highlight, 10,000+ templates, "add another summary" for decisions/action items, Ask Plaud with traceable references, AutoFlow, Google Calendar integration, Plaud MCP Server (Beta) | Apple Find My (not Amazon) | Undated; ship-date notice says Oct 5 | Regional stores (US, EU, UK, APAC …) | $159; Starter free 300 min/mo; Pro $8.33/mo; Unlimited $19.99/mo (billed annually) | **Vendor support FAQ:** AutoFlow needs >200 words; a keyword trigger must be spoken in the first 60 s; only the first matching AutoFlow runs; creating flows is app-only | C2 high; C1 medium | Commitment lifecycle beyond summary/email; follow-through over days | AutoFlow's documented output is a template plus optional email (support article) | Which plan includes AutoFlow (plan-table check marks not captured) |
| **Limitless (historical)** | https://www.limitless.ai/ | Memory-pendant users | Pendant memory | Export and delete; existing users get Unlimited free | Acquired by Meta | Undated notice; dates Dec 5/19 2025 | Unavailable in BR, CN, EU, IL, KR, TR, UK since 5 Dec 2025 | No new sales | **Official:** Rewind capture disabled 19 Dec 2025; no recording from desktop/web apps | Historical benchmark | Portability, export/delete | Official FAQ | Post-2026 support |
| **Sandbar Stream ring** | https://www.sandbar.com/ | Thinkers capturing ideas | Push-to-talk voice notes, chat, dictation | Notes, reminders, todos, lists; chat with web and memory; dictation in any app on iOS/Mac; haptics; media control | None | TechCrunch 5 Nov 2025; homepage undated | Not verified | Preorder $249/$299; Pro $10/mo (TechCrunch, 2025) | None verified | C1 low–medium (personal todos) | Shared multi-party agreements | Push-to-talk only (no ambient capture), per TechCrunch | Did it ship in summer 2026? Current price? |
| **Meta: AI glasses + Muse agent** | https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/ | Mass consumers | Personal agent that acts (email, purchases, plans); glasses as an interface | Muse remembers details, works after the app closes, asks approval before sensitive actions, keeps an audit trail; rolling out in US on iOS/Android/web, "coming soon to AI glasses". Connect 2026: Granola among Muse connectors; camera-free audio glasses $349 | None with Amazon | 8 Sep 2026 (updated 30 Sep 2026); HT 24 Sep 2026; NY Post 11 May 2026 | US first | Muse free "for most of what people need"; glasses from $449 (HT) | **CTO quote (NY Post):** glasses memory is "a good one [for the future]" | C1 medium; C2 medium | Ambient Bee capture + multi-party commitment ledger; Muse is single-user | Muse post describes one person's agent | Will Muse on glasses capture conversations? Timing? |
| **Friend pendant** | friend.com (not scraped) | Lonely or curious consumers | AI companion that is always listening | Remembers what you say; chat companion; ~4 h battery | None | Good Housekeeping 2 Oct 2025 | US (not verified) | $129 | **Reviewer:** no web info, customer service never replied, no shipping notices | C1 low | n/a (companion, not productivity) | Review | — |
| **Granola** | https://www.granola.ai/ | Back-to-back meeting professionals | Notes and actions without a bot | Pre-meeting brief, enhanced notes, "List actions", "Write follow-up email", chat across meetings ("What did I promise…"), MCP connector, iOS/Android, Apple Watch | None | Undated homepage; review 13 Jan 2026 updated after Jul 2026 | Not verified | Basic $0 (30-day history), Business $14/user/mo, Enterprise $35+ (**affiliate** review) | Review (affiliate links): audio-only, Android not retested | C2 high; C1 high (single user) | Household/class context, multi-party acceptance, Bee ambient capture | Granola is built around meetings and calendars (homepage) | Does Granola track completion? |
| **Otter** | https://otter.ai/ | Teams, sales, education | Meeting agent, transcripts, action items | Action items auto-assigned to participants; "My Action Items" consolidated, each linked to its moment, weekly digest of incomplete items (blog, 22 Aug 2024); Education agent for lectures; MCP server | None | 2024 blog; homepage undated | Not verified | Free 300 min/mo (blog sidebar) | None collected | C2 very high | Class/household follow-through with acceptance and evidence; Bee wearable capture | Otter's reminder is a weekly digest (2024) | Has Otter added completion verification? |
| **Fireflies** | https://fireflies.ai/ | Teams | Meeting notes → tasks/CRM | Action items, mobile in-person recording, AI Skills, automatic Asana task creation, voice-command tasks, MCP server | None | Undated | Not verified | Free tier exists (FAQ heading; not detailed) | None collected | C2 high | Same as Otter row | — | — |
| **Apple Notes (iOS 27)** | https://support.apple.com/guide/iphone/record-and-transcribe-audio-iphbe11247b5/ios | iPhone users | Free record → transcript → summary | Live transcript, search, Apple Intelligence summary (iPhone 15 Pro or later) | iPhone (Bee also runs on Apple Watch) | Undated guide (iOS 27 selector) | Language/region limits | Free with device | — | C2 low–medium baseline | Action items and commitments | Guide covers transcripts and summaries; action items **not verified** | — |
| **Alexa+ (native)** | https://www.aboutamazon.com/news/devices/new-alexa-top-features | Households | Reminders, calendar, recaps | Per-person reminders using Visual ID ("when you see Dan, remind him…"); emails/flyers → calendar events; recaps of a conversation sent to the app or email | Echo Show Visual ID; Fire TV | Published 26 Feb 2025, updated 24 Jul 2026 | US (and other launched locales) | Free with Prime | Consumer feature; does not prove developer access | C1 medium (household reminders) | Bee-captured multi-party commitments with acceptance | Reminders are set by voice or app, not from ambient Bee capture (no Bee↔Alexa integration verified) | Any Bee→Alexa reminder pipeline planned? |

---

## 3. Matrix B: Fire TV fitness, family co-op, learning, shared viewing

| Rival | Official URL | Target user | Core job | Current features (verified) | Amazon/device integrations | Evidence date | Geography | Pricing (verified) | Friction evidence (labelled) | Overlap | Proposed difference | Evidence for difference | Unresolved questions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Peloton app on Fire TV** | https://support.onepeloton.com/s/article/Peloton-App-Amazon-Fire-TV-and-Tablet-FAQs | Fitness subscribers | Stream classes on TV | Classes stream directly; fast-forward/rewind on demand | Fire TV Cube, Fire TV 3rd gen, Stick 2nd gen+, 4K, Fire TV built-in TVs; Fire tablets | Undated FAQ; Appstore 4.4★ (32.3K) | US, UK, CA | Free app; App One/App+ membership | **Official FAQ:** no workout history, no leaderboard, no HRM sync, no casting, one account logged in at a time | C4 medium | Multi-profile household and seated adaptive pacing on TV | FAQ lists the gaps | Is the FAQ current? |
| **Apple Fitness+** | https://support.apple.com/en-us/118210 | Apple ecosystem | Guided workouts | iPhone, iPad, Apple TV, AirPlay TVs; metrics with Watch/AirPods Pro 3 | **Fire TV not listed** | 18 Sep 2025; how-to 27 May 2026 | Select countries | Subscription (price not captured) | — | C4 low on Fire TV | Native Fire TV | Device list | AirPlay on Fire TV-built-in TVs? (not verified) |
| **Les Mills+** | https://support.lesmillsondemand.com/support/solutions/articles/6000285623 | Group-fitness fans | Workout streaming | Fire TV app (Fire OS 6+); TV apps Premium tier only | Fire TV, Roku, Apple TV, Android TV | Undated ("week of July 27 NZST") | Not verified | Premium tier for TV | **Official support:** press a D-pad arrow to reveal player controls. **Contradiction:** device page says Firestick app "not available for new installs". **Forum 2023:** user could not find the app on the Stick | C4 low | — | — | Current install status |
| **Gymondo** | https://developer.amazon.com/apps-and-games/blogs/2020/08/devchat-gymondo-on-fire-tv | Home fitness | Programs + recipes | IAP, recommendations row | Fire TV | 4 Aug 2020 | DE, then GB/US/CA/AU/ES/FR/IT | — | — | C4 low | — | — | Still on Fire TV in 2026? |
| **Long-tail seated/senior apps** | https://www.amazon.com/Health-Fitness-Apps-Fire-TV-Games/s?rh=n%3A2478845011%2Cp_n_feature_sixteen_browse-bin%3A9842739011 | Seniors, low-impact users | Chair yoga, seated strength, tai chi | "Seated Exercise for Seniors Chair Workout & Gentle Strength" ($1.89), "Chair Yoga for Seniors pro" ($1.99), "Ellis Tai Chi for Seniors", "Offline Kids Movement Breaks" ($1.99) among the first 60 of 534 results | Fire TV Appstore | Listing retrieved 2026-10-03 | US store | $0.99–$1.99 typical | Quality not verified; few or no ratings visible | **C4 high (concept)** | Adaptive, accessible interaction (D-pad/voice pacing, rest prompts, caregiver co-op, progress) rather than video lists | Listing titles only | Do any adapt pacing or support caregivers? |
| **Peloton Guide (camera)** | — (discontinued) | Strength trainees | Camera rep tracking on TV | AI rep tracking, movement feedback | TV + camera | Pelo Buddy 30 Jul 2025 | US/UK/CA (earlier) | Price fell from $495 announced → $95 | **Fan site, quoting Peloton:** sales ended 30 Jul 2025; $9.1M inventory write-down (2024) | C4 (camera variant) | Avoid camera pose grading | Market exit | — |
| **Phone-camera rep counters** | https://apps.apple.com/gb/app/form-coach/id6770110788 | DIY fitness | On-device form/rep counting | Form Coach 2.1: "giant scoreboard on your TV"; Fitness Coach (Android): pose tracking, rep counter | Phone → TV | Undated listings | — | Free | — | C4 (camera) | — | — | — |
| **Amazon Luna GameNight** | https://www.aboutamazon.com/news/entertainment/amazon-luna-redesign-gamenight-prime | Families, Prime households | Living-room party games | 25+ games; phones as controllers via QR; local + remote play; Courtroom Chaos (AI, voice-driven improv; judge "can even remember players"); Jackbox Party Pack 9, Clue, Ticket to Ride | Fire TV (Fire OS 5+), Fire tablets, Samsung/LG TVs | 23 Oct 2025, updated 29 Sep 2026 | US, UK, CA, DE, FR, IT, ES, AT, NL, PL, SE, PT (**India not listed**) | Free with Prime (Luna Standard) | None collected | **C3 very high** | Non-game purpose (shared movement or learning goals, chores), D-pad-only accessible play, Alexa+ voice turns, persistent family progress | Learning/fitness GameNight titles **not verified** | Do any GameNight titles involve movement or learning? |
| **Jackbox Party Packs** | https://www.jackboxgames.com/ | Party groups | Phone-controlled party games | Packs 1–11, Naughty Pack, Survey Scramble on Fire TV; phones join via jackbox.tv | Fire TV Appstore | Listing 2026-10-03; blog 18 Nov 2021 | US store | $9.99–$29.99 per pack | **Forum (2020):** remote play needs screen-sharing workarounds | C3 high | Same as GameNight row | — | — |
| **Kahoot!** | https://support.kahoot.com/hc/en-us/articles/360001515188 | Families, classrooms | Live quiz hosting | Host from the mobile app; cast via AirPlay/Chromecast/screen mirroring | **No native Fire TV app verified** | Help article "updated 16 days ago" (~17 Sep 2026) | Global | Free tier (not detailed) | **Vendor blog (Games for Crowds, a rival):** "wrestling with a TV" when casting | C3 medium (learning quiz) | Native Fire TV quiz with D-pad and phone join | Kahoot help describes casting only | Native Fire TV Kahoot? |
| **PBS KIDS Video** | https://help.pbs.org/support/solutions/articles/12000078117 | Kids 2–8, parents | Free educational video | 600+ episodes, offline downloads; works with Fire TV remote | Fire TV, Fire tablets, Roku, Apple TV | Undated; Appstore 4.4★ (102,406 ratings) | US | Free | **Amazon's AI summary of reviews:** "Functionality" 542 mentions, 300 negative (buggy, won't load) | C3 low (passive video); learning | Interactive co-op learning, not passive viewing | Listing | — |
| **Khan Academy Kids** | https://khankids.zendesk.com/hc/en-us/articles/360007054791 | Ages 2–8 | Interactive learning | "Mobile-first … touch screens"; Amazon: Fire tablets (Fire OS 6+) | **Fire TV not listed in official support**; Appstore page shows "Works with Fire TV Voice Remote" (contradiction) | Undated | — | Free | — | C3 medium | TV-native co-op learning | Official support lists tablets only | Does it run on Fire TV? |
| **Alexa+ on Fire TV** | https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-free-ai | All Fire TV households | Conversational search and control | Mood/genre/actor search with follow-ups; on-screen Q&A; move a show between rooms; Ring feeds; scene lighting; Prime/Standard adds Routines and Ring moments | Native | 19 Aug 2026 | US; "additional devices and regions may be added" | Free on compatible Fire TV | Amazon-reported metrics only (~2× conversations; top pick chosen 40% more) | **C5 very high** | Co-viewing for several people (turn-taking, group preferences, kid-safe explanations), shared watch log | Not verified in Amazon pages | Developer access to Alexa+ on Fire TV is gated (known) |
| **Fire TV Alexa+ hub + mobile app** | https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-hub-mobile-app-updates | Fire TV users | Search, watchlists, mobile companion | Alexa+ hub with prompts and resumable conversations; mobile app: watchlists, article→watchlist, photo inspiration, streaming synced to Continue Watching; Games hub (Xbox, Luna, GeForce NOW) | Native | Sept 30 2026 (carousel date) | US from November; more countries "early next year" | — | — | C5 high (phone companion) | Group/second-screen co-viewing roles | Article has no watch-together sentences (WebFetch check) | — |
| **Prime Video X-Ray Recaps** | https://www.aboutamazon.com/news/entertainment/amazon-prime-video-x-ray-recaps | Viewers | Spoiler-free recaps | Gen-AI recaps of season/episode/part, down to the minute; Bedrock + SageMaker; guardrails | Fire TV first | 4 Nov 2024 (beta) | US at launch | Included | — | C5 high (catch-up) | — | — | Current scope (all titles? GA?) |
| **Prime Video Watch Party** | — | Remote co-viewers | Synchronized watching | Reported unavailable | — | Amazon Forum 3 Jun 2024 | — | — | **Community forum:** a quoted Amazon staff reply says it is "no longer available"; another user disputes this | C5 (remote) | Remote co-viewing companion | Forum only (low confidence) | Official confirmation |
| **Explore with Alexa / Amazon Kids+** | https://www.aboutamazon.com/news/devices/new-alexa-top-features | Kids with child profiles | Learning conversations | Age-appropriate answers, trivia, interactive games; Stories with Alexa | Alexa+ devices | Updated 24 Jul 2026 | — | Amazon Kids+ subscription | — | C3 medium | TV co-op with shared screen and roles | — | Available on Fire TV? |

---

## 4. Implications by concept

- **C1 (Bee promise ledger):** Bee itself, Granola ("what did I promise"), Otter (assigned action items plus a weekly digest of open items) and Omi/Plaud (task sync, templates) set a high bar. A defensible wedge must rest on behaviour these pages do not describe: commitments between several people, explicit acceptance by the named owner, revision history ("I can't do Tuesday any more"), and completion evidence, built only on data exported through the Bee CLI/MCP. Bee also has documented transcript quality problems (TechCrunch). Show confidence levels and a correction step rather than assuming the transcript is right. Confidence that the wedge is novel is **medium**. It is based on absence from pages, not product testing.
- **C2 (meeting/class follow-through coach):** this is the most crowded concept (Otter Education agent, Fireflies, Granola, Plaud templates, Bee Templates for lecture → study plan). Avoid it unless it narrows to a specific under-served setting with verified need.
- **C3 (family TV co-op):** Luna GameNight is free with Prime, uses phones as controllers and is on Fire TV. It removes the novelty of "party game with phones". A differentiated entry would need a purpose beyond play (for example co-op movement, learning or household tasks), an accessible remote-only mode, or a cross-device Amazon story. GameNight's country list excludes India.
- **C4 (accessible seated fitness, D-pad):** cheap seated-workout video apps already exist on Fire TV. The gap evidence is Peloton's TV-side limits (single account, no history or HRM) plus documented D-pad friction such as Les Mills+ hidden player controls. The differentiation should be interaction design (pacing control, rest and check-in prompts, caregiver co-op, multi-profile progress), not content. Avoid camera pose grading: there is market-exit precedent, and phone apps already do it.
- **C5 (shared-viewing companion):** this overlaps directly with what Amazon ships and makes free (Alexa+ on Fire TV, the hub, the mobile app, X-Ray Recaps). It has the weakest novelty case. The only unaddressed angle seen is remote co-viewing, since Watch Party is reportedly discontinued, but that evidence is a low-confidence forum thread.

---

## 5. Gaps / unverified / contradictions

- **Bee features vs. API:** bee.computer lists "integrations and actions" and "suggested to-dos". The docs show the CLI syncs facts, todos and conversations. Whether entrants can **write** to Bee to-dos, or read Actions and Insights, was not verified.
- **Bee↔Alexa+ integration:** Amazon calls them "natural complements" and says Amazon sign-in enables future integrations (23 Sep 2026). No shipping Bee→Alexa reminder integration was found.
- **Fire TV hub article:** WebFetch's first summary said "early 2025". The verbatim second call says "early next year". The Amazon carousel date (30 Sep 2026) implies early 2027. The publication date was not shown directly by WebFetch.
- **Les Mills+ on Fire TV:** one support page announces the updated app (the year is not stated). The device page says the Firestick app is not available for new installs. Current status is unresolved.
- **Khan Academy Kids on Fire TV:** official support lists only Fire tablets. The Appstore listing shows "Works with … Fire TV Voice Remote". Unresolved.
- **Prime Video Watch Party:** forum users contradict each other (2024). There is no official 2026 statement.
- **Sandbar Stream:** shipping status as of Oct 2026 is not verified (2025 preorder article only).
- **Meta glasses memory:** the CTO framed it as future (May 2026). Muse is "coming soon to AI glasses". Whether ambient conversation capture is planned was not verified.
- **Apple Fitness+ on Fire TV-built-in TVs via AirPlay:** not verified.
- **Pricing gaps:** Apple Fitness+ price, Kahoot tiers, Fireflies tiers, Friend's current status, and which Plaud plan includes AutoFlow were not captured.
- **Fire TV Health & Fitness count:** "534 results" uses the same Fire TV feature filter as the Jackbox listing. The listing may still include apps optimized mainly for tablets.
- **Unverifiable statistics (do not repeat as fact):** Omi "300,000+ professionals"; Otter "33% time back" testimonial; Alexa+ "nearly two times more" conversations and "40% more" top-pick selection (Amazon-reported); Gymondo growth figures (2020, self-reported).
- **Sponsored/affiliate/conflicted sources:** the Feisworld Granola review discloses affiliate links. The Games for Crowds Kahoot-casting blog is written by a competing party-game vendor. NY Post links carry Amazon affiliate tags. TechCrunch carries an affiliate disclaimer.
- **Not searched (rate limits/time):** Amazon Kids+ on Fire TV specifics; YouTube fitness on Fire TV; Tonal; Kinect history; Samsung/LG camera fitness; the Fire TV Jan 2026 UI article; Otter Education agent page; Bee Templates detail page.

---

## 6. Searches run

| # | Query / action | Saved file | Useful |
|---|---|---|---|
| 1 | search: Bee wearable Amazon app features summaries to-dos facts insights 2026 | .firecrawl/rivw-search-bee-features.json | Yes |
| 2 | scrape: aboutamazon Bee Private Compute (first attempt 429, retry OK) | .firecrawl/rivw-bee-private-compute.md | Yes |
| 3 | search: PLAUD NotePin AutoFlow templates action items official | .firecrawl/rivw-search-plaud.json | Yes |
| 4 | search: Plaud AutoFlow automatically send summaries to-do help center | .firecrawl/rivw-search-plaud-autoflow.json | Yes |
| 5 | search: Sandbar Stream ring voice notes AI (first attempt 429) | .firecrawl/rivw-search-sandbar.json | Yes |
| 6 | search: Meta AI glasses conversation memory reminders feature 2026 (qdr:y) | .firecrawl/rivw-search-meta-glasses.json | Partial (Meta pages empty; NY Post usable) |
| 7 | scrape: CNET Meta Connect article | none (site unsupported by Firecrawl) | No |
| 8 | search: Meta Connect 2026 glasses announcements memory Limitless (qdr:m) | .firecrawl/rivw-search-meta-connect-2026.json | Yes |
| 9 | search: Granola AI notepad action items follow-up features | .firecrawl/rivw-search-granola.json | Yes |
| 10 | search: Otter.ai action items assign meeting agent 2026 | .firecrawl/rivw-search-otter.json | Yes |
| 11 | search: Fireflies.ai action items tasks sync Asana mobile in-person recording (first attempt 429) | .firecrawl/rivw-search-fireflies.json | Yes |
| 12 | search: Peloton app Fire TV support devices supported | .firecrawl/rivw-search-peloton-firetv.json | Yes |
| 13 | search: Apple Fitness+ supported devices TV AirPlay requirements support | .firecrawl/rivw-search-apple-fitness.json | Yes |
| 14 | search: Les Mills+ app Amazon Fire TV available | .firecrawl/rivw-search-lesmills-firetv.json | Yes |
| 15 | search: Jackbox Party Pack Amazon Fire TV platforms phone controller (first attempt 429) | .firecrawl/rivw-search-jackbox-firetv.json | Yes |
| 16 | search: Kahoot! play on TV screen cast Chromecast AirPlay family game help center | .firecrawl/rivw-search-kahoot-tv.json | Yes |
| 17 | search: PBS KIDS Video app Amazon Fire TV devices supported (first attempt 429) | .firecrawl/rivw-search-pbskids-firetv.json | Yes |
| 18 | scrape: Alexa+ Fire TV hub article: Firecrawl CLI 429 ×4, MCP 429 → WebFetch ×2 | .firecrawl/rivw-alexa-fire-tv-hub-webfetch.txt (notes) | Yes (WebFetch) |
| 19 | search: Prime Video X-Ray Recaps generative AI Fire TV | .firecrawl/rivw-search-xray-recaps.json | Yes |
| 20 | scrape: aboutamazon Alexa+ on Fire TV free (first attempt 429) | .firecrawl/rivw-alexa-fire-tv-free.md | Yes |
| 21 | search: Peloton Guide camera strength discontinued status | .firecrawl/rivw-search-peloton-guide.json | Yes |
| 22 | search: Prime Video Watch Party feature discontinued or available 2026 | .firecrawl/rivw-search-watch-party.json | Partial |
| 23 | search: Khan Academy Kids app available devices Fire TV Fire tablet | .firecrawl/rivw-search-khankids.json | Yes |
| 24 | search: TV camera workout app rep counting form feedback smart TV 2026 (qdr:y) | .firecrawl/rivw-search-tv-camera-fitness.json | Partial |
| 25 | search: Apple Notes audio recording transcription summary Apple Intelligence support | .firecrawl/rivw-search-apple-notes.json | Yes |
| 26 | search: Friend AI pendant friend.com always listening companion review | .firecrawl/rivw-search-friend-pendant.json | Partial |
| 27 | search: Amazon Luna GameNight party games phone as controller Fire TV | .firecrawl/rivw-search-luna-gamenight.json | Yes (high value) |
| 28 | search: obé fitness app Amazon Fire TV stream classes TV | .firecrawl/rivw-search-obe-firetv.json | Yes (Fire TV fitness listing) |

## 7. Sources read (body actually read)

Method key: FC-S = Firecrawl search --scrape body; FC-SC = Firecrawl scrape; RE = re-read of an earlier saved file; WF = WebFetch.

- Amazon, "Building Bee at Amazon" (5 Jan 2026), FC-S, rivw-search-bee-features.json
- bee.computer homepage (undated), FC-S, rivw-search-bee-features.json
- TechCrunch, Bee hands-on (24 May 2026), FC-S, rivw-search-bee-features.json
- Amazon, "Bee Private Compute" (23 Sep 2026), FC-SC, rivw-bee-private-compute.md
- docs.bee.computer (undated), RE, technical-bee-docs.md; Bee CLI docs (undated), RE (grep), technical-bee-cli.md
- Omi homepage (undated), RE, competitor-memory-search.json
- Limitless homepage/FAQ (undated notice), RE, competitor-memory-search.json
- Plaud NotePin product page (undated), FC-S, rivw-search-plaud.json
- Plaud Support "AutoFlow" (undated), FC-S, rivw-search-plaud-autoflow.json
- sandbar.com (undated), FC-S; TechCrunch Stream launch (5 Nov 2025), FC-S, rivw-search-sandbar.json
- NY Post, Meta Ray-Ban Display (11 May 2026), FC-S, rivw-search-meta-glasses.json
- Meta Newsroom, "Introducing Muse" (8 Sep 2026, updated 30 Sep 2026), FC-S; Hindustan Times Meta Connect 2026 recap (24 Sep 2026), FC-S, rivw-search-meta-connect-2026.json
- Granola homepage (undated); Feisworld Granola review (13 Jan 2026, updated after Jul 2026, affiliate), FC-S, rivw-search-granola.json
- Otter "My Action Items" (22 Aug 2024); Otter homepage (undated), FC-S, rivw-search-otter.json
- Fireflies homepage; Fireflies Asana integration (undated), FC-S, rivw-search-fireflies.json
- Apple Support, Record and transcribe audio in Notes (undated, iOS 27), FC-S, rivw-search-apple-notes.json
- Good Housekeeping, Friend review (2 Oct 2025), FC-S, rivw-search-friend-pendant.json
- Amazon, Alexa+ top features (26 Feb 2025, updated 24 Jul 2026); Getting started with Alexa+ (4 Feb 2026); amazon.com Alexa+ page (undated), RE, competitor-alexa-search.json
- Peloton Support, Fire TV and Tablet FAQs (undated), FC-S, rivw-search-peloton-firetv.json
- Apple Support, Devices for Fitness+ (18 Sep 2025); How to use Fitness+ (27 May 2026), FC-S, rivw-search-apple-fitness.json
- Les Mills+ support: Fire TV app; devices (undated); Amazon Forum (14 Jan 2023), FC-S, rivw-search-lesmills-firetv.json
- Amazon Developer, Gymondo case study (4 Aug 2020); monetization blog (30 Jun 2025, grep), RE, competitor-tv-search.json
- Jackbox blog PP8 (18 Nov 2021); amazon.com Jackbox Fire TV listing (retrieved 2026-10-03); Amazon Forum (1 Jun 2020), FC-S, rivw-search-jackbox-firetv.json
- Kahoot Support, host with mobile app (updated ~17 Sep 2026); Games for Crowds blog (28 Jul 2026, vendor), FC-S, rivw-search-kahoot-tv.json
- PBS Help devices (undated); PBS KIDS Video Appstore listing (retrieved 2026-10-03), FC-S, rivw-search-pbskids-firetv.json
- Khan Kids Zendesk device support (undated); Khan Academy Kids Appstore listing, FC-S, rivw-search-khankids.json
- Amazon, X-Ray Recaps (4 Nov 2024), FC-S, rivw-search-xray-recaps.json
- Amazon, Alexa+ Fire TV hub/mobile app (30 Sep 2026 per carousel), WF, rivw-alexa-fire-tv-hub-webfetch.txt
- Amazon, Alexa+ included on Fire TV (19 Aug 2026), FC-SC, rivw-alexa-fire-tv-free.md
- Pelo Buddy, Guide sales end (30 Jul 2025), FC-S, rivw-search-peloton-guide.json
- App Store Form Coach; Google Play Fitness Coach & Rep Counter (undated), FC-S, rivw-search-tv-camera-fitness.json
- Amazon Forum, Watch Party (3 Jun 2024), FC-S, rivw-search-watch-party.json
- Amazon, Luna & GameNight (23 Oct 2025, updated 29 Sep 2026); luna.amazon.com/gamenight; Amazon Help GameNight Supported Devices (undated), FC-S, rivw-search-luna-gamenight.json
- obé blog, Streaming to your TV (2020); amazon.com Fire TV Health & Fitness listing (retrieved 2026-10-03), FC-S, rivw-search-obe-firetv.json

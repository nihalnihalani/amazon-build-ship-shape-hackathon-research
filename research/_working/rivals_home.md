# Rivals and substitutes: household coordination, doorway/access, caregiving, home automation

Research key: `rivals_home`. Claim prefix: `RIVH`. Retrieved 2026-10-03 (Asia/Kolkata) with the authenticated Firecrawl CLI (search with scrape, scrape, map). One fallback attempt with the Firecrawl MCP scrape also hit the shared rate limit and returned nothing. Every source below was read from its scraped body unless marked otherwise. Publication or update dates come from the pages themselves; "undated" means the page shows none. Vendor pages show what a vendor says it offers, not how well it works. The Ring Appstore listings are developer self-descriptions hosted by Ring.

Candidate concepts tested for overlap (abbreviations used in the tables):
- **DH**: doorstep accessible handoff
- **CV**: caregiver visit verification
- **DA**: delivery/arrival management
- **PR**: household plan repair
- **FE**: family exception resolver

---

## 1. Executive findings (decision-relevant)

1. **Amazon already ships a conversational doorstep agent.** **Alexa+ Greetings** on Ring doorbells talks with visitors, recognizes delivery personnel, gives delivery drivers the owner's instructions, deflects solicitors and takes messages for review in the Ring app. Instructions can be set by voice on an Echo, Fire TV or the Alexa app. It launched 18 Dec 2025 for US/Canada English Early Access, and the Ring support article was updated about a month ago. Requirements: select doorbells, a compatible subscription, Alexa+ and Video Descriptions. It is not available in Illinois. Building "AI answers my door / tells the courier where to leave it" would rebuild a native feature. ([Ring support](https://ring.com/support/articles/kc57h/alexa-plus-greetings), [Amazon News, 18 Dec 2025](https://www.aboutamazon.com/news/devices/alexa-ring-doorbell-ai-greetings)) Confidence: high.
2. **Caregiver visit verification is already on sale in the Ring Appstore.** The listing reviewed on 2026-10-03 has about 54 apps.
   - **Routines** (Density) texts the family group chat when a caregiver arrives, manages caregiver schedules and answers schedule questions. $10/mo per device.
   - **ProofClock** gives an attendance verdict ("Verified, Short, No-show, or Unverifiable") from motion timestamps only. $4.99/mo.
   - **Beside Care** sends caregiver digests and flags inactivity. $19.99/mo.
   - **Remy** detects falls and offers "Is she okay today?" chat. $19/mo.
   - Several others: GuardCat ("cleaner check-ins"), Occupancy Guard ("proof-of-stay"), Senior Fall Detection, FallGuard, VitalWatch and MySentry.

   A CV concept framed as "know when the caregiver arrived and how long they stayed" overlaps directly with shipping products. ([Ring Appstore all apps](https://ring.com/appstore/category/all-apps), [Routines](https://ring.com/appstore/routines), [ProofClock](https://ring.com/appstore/proofclock)) Confidence: high (listings verified; effectiveness not verified).
3. **Delivery/arrival management is saturated by native and partner features.** Native: Ring Smart Alerts (person/package/vehicle) on every paid plan, Alexa person/package announcements, Alexa+ Greetings delivery instructions, Amazon Key In-Garage Delivery inside the Ring app, and Alexa+ "Shopping Essentials" delivery tracking. Partners: PackageProtect (carrier detection, pickup tracking, $2.99/mo), Porchify, Mailbox Alert and School Bus Home (expected-by window plus a no-bus heads-up, $4.99/mo). ChatGPT scheduled tasks also offer "Let me know when my package is delivered." Confidence: high.
4. **Household plan repair and exception handling has strong but different rivals.** Native: Alexa+ manages family calendars, extracts events from emails and flyers, schedules events "when everyone is free" and delivers person-targeted reminders through Visual ID. Third parties:
   - **Skylight Assistant**: an SMS-based family assistant with a nightly rundown for all group members. $14.99/mo or $119.99/yr.
   - **Hearth Helper**: text in events, approval before upload.
   - **Cozi Gold**: notifies everyone when an event changes. $39/yr.
   - **Google Home Premium with Gemini**: conversational calendar edits.
   - **ChatGPT dots**: an always-on agent with app connections, rolling out to Pro/Business Premium.

   No reviewed source describes multi-party *acceptance* of a reassignment, constraint-checked alternatives, or rollback across services. That is "not verified in reviewed sources", not proof that the feature is absent. Confidence: medium.
5. **Amazon has no first-party remote-caregiver coordination product.** **Alexa Together** ended on 25 Jun 2024, according to an Amazon staff reply on the Amazon Forum dated 2 Jun 2024. The old Alexa Together store node now shows **Alexa Emergency Assist** ($5.99/mo, US only), which covers urgent response, emergency contacts and critical information, not care scheduling. Third-party Ring Appstore apps have moved into that gap. Confidence: medium-high.
6. **Platform constraints shape any Ring-based rival or concept.** The Ring Partner API (Appstore) release notes dated 16 Sep 2026 say TAKE-encrypted devices return encrypted video, and E2EE devices are not returned by any Partner API. Ring's CEO told TechCrunch (31 Mar 2026) that Appstore terms will not allow facial-recognition or license-plate-reader apps. Familiar Faces is unavailable in Illinois, Texas, Portland OR and Quebec. Confidence: high (release notes) / medium (TechCrunch quote).
7. **Business and property access is a mature, crowded category.** ButterflyMX (visitor and single-use delivery passes with time-stamped door-release photos), DOOR (formerly Latch), Brivo Visitor Management ("powered by Envoy"), Envoy (free tier to $362 per location per month), Avigilon Alta Visitor (expiring QR guest passes, audit logs) and Eptura Visitor (formerly Proxyclick) all cover passes, host notifications and audit trails. A small-business access idea would compete with established enterprise vendors and with Ring Appstore business apps. Confidence: high (features); pricing verified only for Envoy.

**Net implication.** The defensible space is no longer "detect/describe/notify/talk-to-visitor/verify-arrival". The evidence does leave room for:
- (a) a **resident-side accessible handoff** with a human helper who explicitly accepts, plus closure confirmation (DH);
- (b) **two-sided, consented completion** of a care visit's *tasks*, not mere presence (CV);
- (c) **negotiated reassignment with acceptance and consistency across services** (PR/FE).

All three are product hypotheses. Rivals were not hands-on tested.

---

## 2. Competitor / substitute matrix

Columns: name; official URL; target user; core job; current features; Amazon/device integration; evidence date; geography; pricing (verified only); friction (anecdotal unless noted); overlap with DH/CV/DA/PR/FE; proposed difference; evidence for difference; unresolved questions.

### 2a. Amazon native (do not rebuild)

| Name | Official URL | Target user | Core job | Current features (verified) | Amazon/device integration | Evidence date | Geography | Pricing | Friction | Overlap | Proposed difference | Evidence for difference | Unresolved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Alexa+ Greetings** (Ring) | https://ring.com/support/articles/kc57h/alexa-plus-greetings | Ring doorbell owners who are busy or away | Converse with door visitors on owner's behalf | Natural conversation; recognizes delivery personnel; owner-set instructions for deliveries/solicitors, set by voice; takes messages; Ring notification shows that Alexa spoke; replay in Event History on phone/Echo/Fire TV | Ring + Alexa+ account link; Echo, Fire TV, Alexa app | Support "last updated 1 month ago" (about Sep 2026); launch 18 Dec 2025 | Launch: US/Canada, English, Early Access; support: select primary languages; not Illinois | Compatible Ring subscription required (launch named "Ring Premium Plan"); exact tier not verified | Not collected | DH **high**, DA **high**, CV low | Resident-side accessible output (large text/haptics/captions) plus a named household helper who accepts and closes the loop | Greetings documents visitor-facing conversation and owner review; resident accessibility modes and helper acceptance not verified in reviewed sources | Is a text transcript exposed? Does Greetings expose events or transcripts to the Partner API? Behavior for deaf/blind residents? |
| **Ring Smart Alerts / intelligent features** | https://ring.com/plans ; https://ring.com/support/articles/de7qi/intelligent-features | Ring subscribers | Smarter alerts and search | Person/Package/Vehicle alerts (Solo $4.99, Multi $9.99); Pro $19.99: Video Descriptions, Familiar Faces (beta), Active Warnings, Unusual/Single Event Alert (beta), Video Search; Virtual Security Guard $99/mo | Ring app; Alexa+ camera summaries | Undated (retrieved 2026-10-03) | US focus; feature restrictions by state | Verified (US list prices above) | Not collected | DA high, DH medium, CV medium | Do not compete on detection or description; consume events as inputs | n/a | Which intelligent-feature outputs reach the Partner API? |
| **Familiar Faces** | https://ring.com/support/articles/z3yhg/familiar-faces | Ring Pro users | Named alerts for known people | Recognizes saved faces; per-face alert toggles; owner-only management; recommends notifying people and checking consent laws | Ring app | Undated | US & Canada; not IL, TX, Portland OR, Quebec | Requires Ring Pro / trial / VSG / Pro Intelligence add-on | Ring lists accuracy limits (distance, masks, lighting) | CV medium (identity of caregiver), DH low | Never identify people by face; use explicit check-in or consent tokens | Appstore bans FR apps (TechCrunch); FF regional exclusions | None |
| **Quick Replies** | https://ring.com/support/articles/ztd70/Setting-up-Quick-Replies-in-the-Ring-App | Any Ring doorbell/Intercom owner | Pre-recorded doorbell answering machine | Pre-selected message after 0–20 s; visitor can leave reply; links to Modes | Ring doorbells, Ring Intercom | "Last updated 1 month ago" | Not stated | **No subscription required** | Not collected | DH medium | Simple, free substitute; a project must beat it on comprehension and closure | — | Are Quick Reply events exposed to partners? |
| **Alexa announcements & Routines with Ring** | https://ring.com/support/articles/2mgbt/managing-alexa-announcements-for-ring-devices ; https://ring.com/support/articles/g6hqn/Creating-a-Routine-with-Alexa-and-your-Ring-Device | Echo + Ring households | Announce doorbell/motion/person/package; trigger routines | Echo chime/flash + announcement; Echo Show live view 15 s; person/package announcements need subscription; Routines "when doorbell detects motion, do X"; Alexa+ creates complex routines by voice | Echo, Alexa app | Undated support; Alexa+ guide updated 24 Jul 2026 | Not stated | Included | **Anecdotal:** 2021 Ring Community thread reports press-triggered routines stopping (one thread, old) | DA high, DH medium | Routines are fire-and-forget; a project should add accepted ownership and confirmation | Routine docs describe trigger→action only | Current routine reliability (old anecdote only) |
| **Alexa+ household features** | https://www.aboutamazon.com/news/devices/new-alexa-top-features ; https://www.aboutamazon.com/news/devices/new-alexa-plus-amazon-devices | US Prime households (also UK/CA/IN rollouts) | Family calendar, reminders, memory | Connected calendars; email/flyer/photo→event; "schedule events when everyone is free"; Visual-ID personal reminders ("when you see Dan…"); voice-created routines; Ring footage summaries/Smart Video Search; delivery tracking (Shopping Essentials) | Echo Show 15/21 widgets, Alexa app, Alexa.com | Guide updated 24 Jul 2026; getting-started 4 Feb 2026 | US GA; India Early Access from 16 Sep 2026 | Free with Prime (US); non-Prime chat on Alexa.com | Not collected | PR **high**, FE **high**, DA high | Multi-party acceptance of reassignment with constraint-checked options and rollback | Amazon pages describe single-user scheduling and reminders; multi-party acceptance not verified in reviewed sources | Can a hackathon MCP server or Agent Skill invoke these natively? (Partner tools are gated per known facts.) |
| **Amazon Key In-Garage Delivery** | https://www.amazon.com/key-delivery ; https://ring.com/support/articles/ja9qu/using-amazon-key-for-in-garage-delivery-with-the-ring-app | Prime members with smart garage | Secure package delivery inside garage | Driver gets one-time garage access; alerts on phone; optional Ring recording; set up in Ring app | myQ, Chamberlain, LiftMaster, Aladdin Connect, OHD; Ring app | Undated | Supported zip codes only (US) | First delivery free, then $1.99 per 1–2-day In-Garage Delivery; Amazon Day In-Garage fee waived | Not collected | DA high | Do not rebuild secure delivery access | — | Any partner API? Not verified |
| **Alexa Emergency Assist** (replaced Alexa Together) | https://www.amazon.com/Alexa-Together/b?ie=UTF8&node=21390531011 | Older adults & families | Urgent response | 24/7 Urgent Response agents; emergency contacts notified; critical info for responders; smoke/CO smart alerts | Echo devices, Alexa app | Page undated; Together end 25 Jun 2024 (Amazon staff forum post, 2 Jun 2024) | US only | $5.99/mo or $59/yr | **Anecdotal:** forum user stranded by Together shutdown (1 post) | CV low-medium, FE low | Emergency Assist is emergency-only; care scheduling and visit closure are a separate job | Feature list covers emergencies only | None |

### 2b. Ring Appstore partners (shipping, Ring-integrated)

| Name | Official URL | Target user | Core job | Current features (verified listing) | Integration | Evidence date | Geography | Pricing | Friction | Overlap | Proposed difference | Evidence for difference | Unresolved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Routines (Density)** | https://ring.com/appstore/routines ; https://www.routines.com/ | Families caring for elders remotely | AI care coordinator in family group text | Group text when caregiver arrives; manages caregiver schedules; appointment reminders; drafts/sends emails; answers "does Mom still have PT on Tuesdays"; SMS-only, no app. Sensor product: arrival/delay/departure alerts and "check in if they don't show up" | Ring doorbell/camera at entry; Ring subscription required | Listing undated; TechCrunch names Density a launch partner 31 Mar 2026; site says early access Spring 2026 | US (Ring Appstore US-first per TechCrunch) | Ring app: $10/mo per device, 30-day trial; sensor: $299 for 3 sensors + $49/mo | Not collected | CV **very high**, FE **high**, PR medium | Avoid "caregiver arrived/late" alerts. Possible wedge: care-recipient-side accessible confirmation plus task-level completion evidence | Listing lists arrival, schedules, reminders, email; task completion or recipient confirmation not verified in reviewed sources | Does Routines handle replacement-caregiver negotiation? Not verified |
| **ProofClock** | https://ring.com/appstore/proofclock | Businesses with crews/contractors | Proof of attendance | Per-site schedule; arrival time, duration, window met; verdict Verified/Short/No-show/Unverifiable; monthly CSV for billing/SLA disputes; metadata-only, no AI; roles and access log | Ring motion-event timestamps | Listing undated | Not stated | $4.99/mo per device, 14-day trial | Not collected | CV **very high** (presence verification) | Presence ≠ care delivered; a project could verify consented task completion | ProofClock explicitly uses timestamps only | Home caregiver use permitted? |
| **Beside Care** | https://ring.com/appstore/beside-care | Family caregivers | Daily caregiver digests | AI summaries of motion; digest via email/SMS; flags unusual patterns or long inactivity; timeline; Observation Checklist (up to 40 routines); 0-day video retention | All Ring cameras; Ring subscription | Listing undated | Not stated | $19.99/mo per device, 14-day trial | Not collected | CV high, FE medium | Not a coordination or acceptance tool | Listing shows summaries/alerts only | — |
| **Remy: Elder Care, Fall Alerts** | https://ring.com/appstore/remy-elder-care-fall-alerts | Families of aging relatives | Falls/distress detection and daily timeline | Fall/trip alerts; AI daily timeline; chat "Is she okay today?"; recognizes familiar people; faces auto-blurred; may collect biometric/health insights; 30-day retention | Ring camera covering room; Ring Protect | Listing undated | Not stated | $19.00/mo per device, 7-day trial | Not collected | CV medium, FE low | Avoid safety monitoring or health inference | — | — |
| **School Bus Home** | https://ring.com/appstore/school-bus-home | US parents | Bus arrival plus no-bus heads-up | Up to 4 cameras; after-school window; "expected by" time; alert or heads-up; still kept 31 days; never identifies people | Ring Protect | Listing undated | US only | $4.99/mo per device, 7-day trial | Not collected | DA high, FE medium (expected-by pattern) | Shows the "expected-by + exception" pattern already exists for one niche | — | — |
| **PackageProtect (AllScout)** | https://ring.com/appstore/packageprotect | Homeowners | Package delivery/theft | Delivery detection; carrier detection (Amazon/UPS/FedEx); pickup detection; theft prevention (beta); 2,000 detections/mo; data used for model training (anonymized) | All Ring cameras; AllScout app | Listing undated | Not stated | $2.99/mo per device, 14-day trial | Not collected | DA **high** | Do not build package detection | — | — |
| **Porchify / Mailbox Alert** | https://ring.com/appstore/porchify ; https://ring.com/appstore/mailbox-alert | Homeowners | Call on package arrival; mail arrival alerts | Per listing descriptions only | Ring cameras | Listing undated | Not stated | Individual prices not reliably parsed | Not collected | DA high | — | — | Detail pages not read |
| **GuardCat / Occupancy Guard / Minut / Seam** | ring.com/appstore/guardcat, /occupancy-guard, /minut, /seam | Short-term-rental hosts | Guest, cleaner and access events | GuardCat: "rule violations, guest check-outs, cleaner check-ins"; Occupancy Guard: proof-of-stay; Seam: access/energy across 30+ devices; Minut: guest access insights | Ring cameras/doorbells | Listing undated | Not stated | Not reliably parsed | Not collected | CV medium (cleaner check-ins), DA medium | — | — | Detail pages not read |

Ring Appstore context: about 15 apps at launch. Ring takes a 10% commission, the store is US-first, and discovery happens in the Ring app ([TechCrunch, 31 Mar 2026](https://techcrunch.com/2026/03/31/ring-app-store-bets-on-ai-to-go-beyond-home-security/)). The all-apps page listed about 54 apps on 2026-10-03. Ring's Appstore home invites people to "build your own app with our AI-assisted development platform."

### 2c. Other AI assistants / ecosystems

| Name | Official URL | Target user | Core job | Current features | Amazon/device integration | Evidence date | Geography | Pricing | Friction | Overlap | Proposed difference | Unresolved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Google Home Premium + Gemini for Home** | https://store.google.com/product/google_home_premium ; https://home.google.com/get-inspired/welcome-to-google-home-premium-the-new-era-of-nest-aware/ | Google/Nest households | Conversational home, camera history, automations | Advanced: natural-language camera history search, daily camera event summaries; Gemini calendar edits with follow-ups; Help Me Create automations; familiar face detection (not IL); Home Speaker $99.99 (17 Jun 2026) | None with Amazon | Speaker blog 17 Jun 2026; Premium pages undated | "Select countries and languages" | Standard $10/mo or $100/yr; Advanced $20/mo or $200/yr (US store) | Not collected | DA medium, PR medium, DH low | A Gemini doorbell-conversation feature equivalent to Greetings was **not verified in reviewed sources** | Doorbell AI answering on Nest? |
| **ChatGPT scheduled tasks** | https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt | ChatGPT users | One-time/recurring/event-triggered tasks | E.g. "Let me know when my package is delivered"; push/email notifications; event triggers from connected apps | None verified with Ring/Alexa | Help page "updated 2 days ago" | Depends on account/app | Not verified | Not collected | DA medium, PR low | General-purpose; no household acceptance model verified | Which household apps provide triggers? |
| **ChatGPT dots** | https://help.openai.com/en/articles/20001530-getting-started-with-your-dot | Pro / Business Premium users | Always-on agent with own cloud computer | Ongoing goals; connected apps; Slack/texting channels; In progress / Scheduled / Completed views | None verified | Help page "updated 22 hours ago"; TechCrunch headline 29 Sep 2026 | Pro: excludes EEA, Switzerland, UK | Included in Pro / Business Premium (amount not verified) | Not collected | PR medium, FE medium | Narrow, verifiable household workflow beats a general agent | Household multi-user permissions? Not verified |
| **ChatGPT MCP apps (developer mode)** | https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt | Business/Enterprise/Edu | Custom MCP apps with write actions | Full MCP with write actions in beta for Business/Enterprise/Edu | — | "Updated last month" (prior synthesis) | — | — | Community threads report app setup issues (anecdotal, prior synthesis) | Indirect | Same MCP server could serve Alexa+ and ChatGPT; host-agnostic tool design | — |

### 2d. Family coordination apps and displays

| Name | Official URL | Target user | Core job | Current features (verified) | Amazon integration | Evidence date | Geography | Pricing | Overlap | Proposed difference | Unresolved |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Skylight Calendar + Sidekick / Skylight Assistant** | https://www.skylightframe.com/calendar/ ; https://myskylight.com/products/calendar-skylight-plus/ ; https://skylight.zendesk.com/hc/en-us/articles/51833126965019-Subscription | Busy families | Shared wall calendar plus text-based family assistant | Syncs Google/Apple/Outlook/Yahoo/Cozi; chores and rewards; Magic Import with Sidekick (email/PDF/paper→events); meal planning. **Skylight Assistant**: texting-based, unlimited adult members, nightly rundown to all group members, learns preferences | Not verified | Pages undated (retrieved 2026-10-03) | Not stated (US focus implied) | Calendar Plus $79/yr; Assistant $14.99/mo or $119.99/yr (includes Plus); +$40/yr add-on for Plus subscribers | PR **high**, FE **high** | Acceptance-based reassignment with constraint checks and cross-service consistency | Does Assistant negotiate swaps between members? Not verified |
| **Hearth Display / Hearth Helper** | https://hearthdisplay.com/ ; https://hearthdisplay.com/pages/features | Families with kids | Routines, calendar, delegation | Calendar sync (Google/iCal/Outlook); share calendar with external caregivers; assignable to-dos; Hearth Helper: text in events and meal plans, approve before upload; markets "delegate it, own it, and follow through" | Not verified | Undated | Not stated | Not verified (Hearth Family membership required for Helper) | PR high, FE medium | Hearth claims delegation; differentiation must be exception negotiation, not assignment | Is there acceptance or decline state on assigned to-dos? |
| **Cozi** | https://www.cozi.com/compare-plans/ | Families | Shared calendar and lists | Free: shared calendar, lists, recipes; Gold: **calendar change notifications to everyone**, 3 reminders/event; Max: AI Event Import (email→events), AI meal planner | Not verified | Undated | Not stated | Free; Gold $39/yr; Max $79/yr | PR medium, FE medium | Cozi notifies of change; it does not verify that a conflict was resolved | — |
| **FamilyWall** | https://www.familywall.com/premium.html | Families | Organizer plus location | Shared calendar, lists, messenger; Premium: Google/Outlook sync, Family Locator, **Place Alert**, timetable, budget | Not verified | Undated | Not stated | Premium $4.99/mo ($44.99/yr) | DA medium (place alerts), PR low | — | — |
| **Google family calendar** | https://support.google.com/families/answer/7157782 | Google family groups | Shared "Family" calendar | Auto-created; all members edit; shareable with non-members | — | Undated | Global (Google accounts) | Free | PR low (substitute) | — | — |
| **Apple shared Reminders** | https://support.apple.com/guide/iphone/share-and-collaborate-iph2a8f9121e/ios | iCloud users | Shared to-dos | Share lists; **assign items to people**; activity updates in Messages (iOS 27 guide) | — | Undated (iOS 27 guide) | Global | Free | PR medium (substitute) | — | Apple family calendar page not read |

### 2e. Caregiving coordination (non-Ring)

| Name | Official URL | Target user | Core job | Current features (verified) | Amazon integration | Evidence date | Pricing | Overlap | Notes / unresolved |
|---|---|---|---|---|---|---|---|---|---|
| **Lotsa Helping Hands** | https://lotsahelpinghands.com/ | Caregivers, volunteers | Volunteer sign-up calendar | Care Calendar (meals, rides, visits), announcements, automatic reminders, multiple coordinators | None verified | Undated | Free (how-it-works FAQ, co-branded "My Cancer Circle" text) | CV low, FE medium | Co-branding on scraped page; no visit verification verified |
| **CaringBridge** | https://www.caringbridge.org/ | Patients and families | Updates and help requests | Journal updates; "Requests" posts replaced the retired Planner (Dec 2023) | None verified | Help article 14 May 2025 | Nonprofit; free (not explicitly priced on page read) | FE low | Retired its structured Planner |
| **Caring Village** | https://caringvillage.com/app/ | Family caregivers | Care coordination | Wellness journal and daily check-ins; care plans; shared calendar; medication check-off; documents; encrypted messaging; to-dos "with a named owner" that people claim | None verified | App Store version 2.1.1, 14 Nov 2025 | Free (2 members); paid tiers $12.49/mo and $20.83/mo (annual billing) | CV medium, FE medium | Claimable tasks overlap with "accepted ownership" |
| **CircleCare** | https://circlecare.app/blog/circlecare-vs-lotsa-helping-hands/ | Small permanent care groups | Day-to-day care | Self-described; page is a competitor-authored comparison | — | 16 Aug 2026 | "Free to start" | FE medium | Vendor-authored; bias flagged |
| **Papa** | https://www.papa.com/ | Health plans, employers, members | Companion care visits ("Papa Pals") | Companion care, everyday tasks, transport; distributed via health plans and employers | None verified | Undated | B2B (not consumer-priced) | CV medium (their own visit model) | Visit verification inside Papa not verified |
| **Carely** | care.ly (from 2018 article) | Families + providers | Family/provider care team | 2018 interview only | — | 30 Nov 2018 | Not verified | — | **Current status not verified** |

### 2f. Small-business / property access

| Name | Official URL | Target | Core job | Current features (verified) | Evidence date | Pricing | Overlap | Note |
|---|---|---|---|---|---|---|---|---|
| **ButterflyMX** | https://butterflymx.com/how-it-works/ | Multifamily/CRE | Video intercom, access | Swipe-to-open; see/speak with visitors; time-stamped door-release photos; revocable visitor passes; single-use 6-digit Delivery Pass; package rooms | How-it-works undated; Delivery Pass blog 28 Feb 2021 | Not verified | DA high, DH medium | Mature, building-scale |
| **DOOR (formerly Latch)** | https://door.com/ | Multifamily operators | Access + automation OS | "Latch is now DOOR."; smart intercom with video, remote unlock, alerts | Undated | Not verified | DA medium | Rebrand verified on official site |
| **Brivo Visitor Management** | https://www.brivo.com/products/visitor-management-systems/ | Enterprise | Visitor + access | "Powered by Envoy"; preregistration; kiosk; host notifications; expiring credentials; video verification | 4 Jun 2026 | Not verified | DA medium | Partnership: Brivo resells Envoy |
| **Envoy** | https://envoy.com/pricing | Workplaces | Visitor management | Host notifications; ID scanning; deliveries module referenced | Undated | Free (100 entries/mo); $362 per location/mo tier | DA medium | — |
| **Avigilon Alta Visitor / Alta Open** | https://www.avigilon.com/alta-visitor | Businesses, schools, residential | Visitor + guest pass | Audit-ready logs; ID/blocklist screening; expiring QR guest passes; admin-permitted Guest Pass in app | Undated | Quote-based | DA medium | Motorola Solutions |
| **Eptura Visitor (formerly Proxyclick)** | https://eptura.com/proxyclick/ | Workplaces | Visitor management | Official page says Proxyclick became Eptura Visitor "in 2025" | Undated | Not verified | DA low | Third-party page dated 13 Jun 2023 already used new name: rebrand date conflict |

### 2g. Automation substitutes

| Name | URL | Capability | Evidence date | Note |
|---|---|---|---|---|
| **Home Assistant – Ring** | https://www.home-assistant.io/integrations/ring/ | Event entity (ding, motion, intercom unlock), live view, last recording (needs Ring Protect), siren/light/switches; cloud polling; **no two-way audio**; logs in with Ring username/password/2FA | Undated docs (mentions 2025.4.0 migrations) | Unofficial cloud path. Not a hackathon-sanctioned Ring API |
| **IFTTT – Ring** | https://ifttt.com/ring | Triggers: New Ring Detected, New Motion Detected; queries: ring/motion history; popular applets (Hue blink, Sheets logging, Sonos volume) | Undated | No Ring actions observed on the page |
| **Alexa Routines** | (Ring support above) | Doorbell/motion → Alexa actions; Alexa+ voice-created routines | Undated / 24 Jul 2026 | Simplest substitute for notify/automate |

### 2h. Substitutes and why they are hard to beat

| Substitute | What it already does well | Simplicity advantage | What it lacks (hypothesis; not verified as absent in every product) |
|---|---|---|---|
| Texting the caregiver / family group chat | Arrival, delay and swap messages; Routines builds on this channel | Zero setup, universal, already the norm (Routines and Skylight Assistant both chose SMS) | Structured state, proof, closure |
| Calendar reminder / shared calendar (Google family calendar, Cozi Gold change notifications) | Time-based nudges; everyone sees changes | Free, familiar | Conflict resolution, acceptance tracking |
| Apple shared Reminders with assignment | Assign to-dos to named people; Messages activity | Free, native on iPhone | Cross-platform; exception negotiation |
| Ring Quick Replies | Answers door with pre-recorded message | **No subscription required** | Two-way context, resident accessibility |
| Alexa announcements + Routines | Echo chime/flash/announce; trigger actions | Built in, voice-configurable | Ownership and closure |
| Alexa+ Greetings | Conversational door handling with delivery instructions | Native, voice-configured | Resident-side accessible handoff and helper acceptance (not verified as present) |
| IFTTT / Home Assistant | Ring ding/motion → any action | Hobbyist-flexible | Consumer UX; HA uses unofficial auth |

---

## 3. Overlap heat map (synthesis; inference from the verified features above)

| Concept | Native Amazon overlap | Partner/3rd-party overlap | Residual space (hypothesis) |
|---|---|---|---|
| DH: doorstep accessible handoff | **High**: Alexa+ Greetings (visitor conversation, delivery instructions, messages); Quick Replies; Echo announcements and live view; Alexa captions/RTT on Echo Show (not doorbell-specific) | Low: no Appstore app found targeting accessible resident handoff | Resident-side accessible comprehension plus delegated helper acceptance plus explicit closure; must consume Greetings/Ring events, not replace them |
| CV: caregiver visit verification | Low (Alexa Together discontinued; Emergency Assist is emergency-only) | **Very high**: Routines, ProofClock, Beside Care, Remy, GuardCat, Occupancy Guard | Task-level, two-sided consented completion (recipient confirms), not presence detection; or skip this concept |
| DA: delivery/arrival management | **Very high**: Smart Alerts, package announcements, Greetings, Amazon Key, Shopping Essentials tracking | **High**: PackageProtect, Porchify, Mailbox Alert, School Bus Home | Little. Arrival should be an input, not the product |
| PR: household plan repair | **High**: Alexa+ calendar ("when everyone is free"), email→event, Visual-ID reminders | **High**: Skylight Assistant, Hearth Helper, Cozi, Google Home Gemini, ChatGPT dots | Multi-party acceptance of alternatives, deterministic constraint checks, idempotent cross-service updates with rollback (not verified in rivals) |
| FE: family exception resolver | Medium-High (Alexa+ routines and reminders) | **High**: Routines (caregiver no-show and schedules via group text), School Bus Home (expected-by heads-up), Skylight Assistant | Negotiated fallback assignment with accepted ownership and audit; must out-simplify the group chat |

---

## 4. Gaps / unverified / contradictions

- **Alexa+ Greetings plan tier is ambiguous.** The Ring plans compare table shows Greetings with two checkmarks, which suggests upper tiers, but the support article says it "will not work with Virtual Security Guard." The Dec 2025 launch post says "Ring Premium Plan", while the current plan names are Solo/Multi/Pro/VSG. The exact tier is not verified.
- **Greetings API exposure is not verified.** No reviewed source says Greetings conversations, transcripts or instructions are exposed to the Ring Partner API or to hackathon entrants.
- **Accessibility of native doorbell flows.** Alexa offers captions, Alexa Captions, RTT, Call Captioning and Tap to Alexa on Echo Show ([Amazon help](https://www.amazon.com/gp/help/customer/display.html?nodeId=GJWHSL4LUL694FJG)). Doorbell-specific captioning of visitor speech, or Greetings output adapted for deaf/blind residents, is **not verified in reviewed sources**. This is a candidate gap, not a confirmed absence.
- **Rival effectiveness.** None of the Ring Appstore apps were tested. Listings are developer self-descriptions. No reviews, install counts or accuracy data were collected.
- **Routines (Density) details.** The listing says the Ring app works by SMS. The sensor product's site said "Join the waitlist for early access … Spring 2026", which is stale relative to today. Whether Routines negotiates replacement caregivers is not verified.
- **Skylight Assistant.** Only the subscription FAQ was read. No feature or marketing page was found through map or search, so feature depth (swaps, conflict handling) is not verified.
- **Hearth pricing** and the meaning of "delegate … follow through" in practice are not verified.
- **Carely.** Only a 2018 interview was found. Current availability is not verified.
- **Papa.** Internal visit verification is not verified.
- **Lotsa.** The how-it-works page text is co-branded "My Cancer Circle". It may be a partner skin or a scrape artifact.
- **Proxyclick rebrand date conflict.** The official Eptura page says 2025. A third-party page dated 13 Jun 2023 already used "Eptura Visitor".
- **Alexa+ India article date conflict.** The page metadata says 19 Mar 2026, but the body describes an Early Access rollout from 16 Sep 2026, and Amazon's "trending" list dates it 16 Sep 2026. It was probably updated in place. The body also states a non-Prime price of "INR 2,000 per month". This is unusual and was not cross-checked.
- **Ring Neighbors / Search Party.** Not reviewed for this assignment (low relevance to the five concepts).
- **Google Nest doorbell conversation feature.** No Greetings-equivalent was verified (silence is not absence).
- **Apple Family Sharing calendar.** Only the Reminders sharing page was read.
- **Friction evidence is thin.** Two anecdotes were found: one 2021 Ring Community thread on routines stopping, and one 2024 Amazon Forum post on the Alexa Together shutdown. They are not representative.
- **Ring Partner API constraint.** TAKE devices return encrypted video and E2EE devices are hidden from Partner APIs (release notes 16 Sep 2026). Any video-dependent concept or rival degrades for encrypted users.
- **Geography.** Most verified Ring/Alexa features are US (some Canada). The team is in India. Alexa+ India is Early Access from 16 Sep 2026. Ring Appstore availability outside the US is not verified (TechCrunch says US-first).

---

## 5. Searches run

| Query / command | Saved file | Useful |
|---|---|---|
| search `Ring "Alexa+ Greetings" doorbell greet guests manage deliveries` | .firecrawl/rivh-search-alexa-greetings.json | Yes |
| search `Ring Appstore apps partners Ring app store launch` | .firecrawl/rivh-search-ring-appstore.json | Yes |
| scrape ring.com/appstore/beside-care (first attempt 429) | .firecrawl/rivh-ring-appstore-beside-care.md | Yes |
| scrape ring.com/appstore/remy-elder-care-fall-alerts | .firecrawl/rivh-ring-appstore-remy.md | Yes |
| scrape ring.com/appstore/proofclock (2× 429, MCP fallback 429, then success) | .firecrawl/rivh-ring-appstore-proofclock.md | Yes |
| scrape ring.com/appstore/packageprotect | .firecrawl/rivh-ring-appstore-packageprotect.md | Yes |
| scrape ring.com/appstore/category/all-apps | .firecrawl/rivh-ring-appstore-all-apps.md | Yes |
| scrape ring.com/appstore/routines | .firecrawl/rivh-ring-appstore-routines.md | Yes |
| scrape ring.com/appstore/school-bus-home | .firecrawl/rivh-ring-appstore-school-bus-home.md | Yes |
| search `site:ring.com support Quick Replies doorbell pre-recorded responses` | .firecrawl/rivh-search-ring-quick-replies.json | Yes |
| scrape ring.com/support/articles/z3yhg/familiar-faces | .firecrawl/rivh-ring-familiar-faces.md | Yes |
| search `Key by Amazon in-garage delivery Ring Amazon Key app 2026` | .firecrawl/rivh-search-amazon-key.json | Yes |
| search `Alexa Together discontinued caregiver Remote Assist Alexa app` | .firecrawl/rivh-search-alexa-together.json | Yes |
| scrape amazon.com/Alexa-Together/b?node=21390531011 | .firecrawl/rivh-alexa-together-official.md | Yes |
| search `Google Home Premium plan price Gemini for Home familiar faces camera daily brief automations` | .firecrawl/rivh-search-google-home-premium.json | Yes |
| search `site:help.openai.com ChatGPT agent OR "Tasks in ChatGPT" scheduled reminders` | .firecrawl/rivh-search-chatgpt-agent-tasks.json | Yes |
| search `Skylight Calendar Sidekick AI assistant Calendar Plus price per year` | .firecrawl/rivh-search-skylight-sidekick.json | Yes |
| search `"Skylight Assistant" text message family nightly rundown schedule changes` | .firecrawl/rivh-search-skylight-assistant.json | No (only FAQ duplicate, social) |
| map myskylight.com `assistant` | .firecrawl/rivh-map-skylight-assistant.json | No |
| map skylight.zendesk.com `assistant` | .firecrawl/rivh-map-skylight-zendesk-assistant.json | No |
| search `Cozi Gold price features shared family calendar Alexa` (first 429) | .firecrawl/rivh-search-cozi.json | Yes |
| search `FamilyWall family organizer premium features location sharing calendar` | .firecrawl/rivh-search-familywall.json | Yes |
| scrape home-assistant.io/integrations/ring/ | .firecrawl/rivh-home-assistant-ring.md | Yes |
| scrape ifttt.com/ring | .firecrawl/rivh-ifttt-ring.md | Yes |
| search `site:ring.com support Alexa routines Ring doorbell press motion trigger announcement Echo` | .firecrawl/rivh-search-ring-alexa-routines.json | Yes |
| search `ButterflyMX video intercom delivery pass visitor access package room features` | .firecrawl/rivh-search-butterflymx.json | Yes |
| search `Latch smart access residents guest access delivery integration Door Link 2026` | .firecrawl/rivh-search-latch.json | Yes |
| search `Envoy visitor management host notification deliveries pricing` | .firecrawl/rivh-search-envoy.json | Yes |
| scrape routines.com | .firecrawl/rivh-routines-home.md | Yes |
| search `Lotsa Helping Hands care calendar volunteers meals rides free` | .firecrawl/rivh-search-lotsa.json | Yes |
| search `CaringBridge Planner tasks helpers calendar free nonprofit` | .firecrawl/rivh-search-caringbridge.json | Yes |
| search `Caring Village app family caregivers coordinate care calendar tasks` | .firecrawl/rivh-search-caring-village.json | Yes |
| scrape papa.com | .firecrawl/rivh-papa-home.md | Yes |
| search `Carely family caregiving app coordinate care team updates` | .firecrawl/rivh-search-carely.json | Partial (2018 only) |
| search `Avigilon Alta access control guest pass visitor management cloud Openpath` | .firecrawl/rivh-search-avigilon-alta.json | Yes |
| search `Brivo cloud access control visitor management delivery access multifamily` | .firecrawl/rivh-search-brivo.json | Yes |
| search `Proxyclick now Eptura Visitor management host notification` | .firecrawl/rivh-search-proxyclick.json | Yes |
| search `site:support.google.com family calendar Google family group share events` | .firecrawl/rivh-search-google-family-calendar.json | Yes |
| search `site:support.apple.com Family Sharing family calendar shared reminders list` | .firecrawl/rivh-search-apple-family-calendar.json | Partial (Reminders only) |
| scrape hearthdisplay.com/pages/features | .firecrawl/rivh-hearth-features.md | Yes |
| search `Alexa accessibility features deaf hard of hearing doorbell visual notification Echo Show captioning` | .firecrawl/rivh-search-alexa-accessibility-doorbell.json | Yes |

Reused saved files (not re-fetched): .firecrawl/competitor-alexa-search.json, competitor-ring-search.json, competitor-door-search.json, competitor-family-search.json, competitor-chatgpt-search.json, competitor-gemini-search.json (prior synthesis only), competitor-source-index.json, research/competitor-findings.md.

## 6. Sources read (body read; method; saved path)

| # | Source | Date on page | Method | Saved |
|---|---|---|---|---|
| 1 | Ring support: Alexa+ Greetings | "Last updated 1 month ago" | CLI search+scrape | .firecrawl/rivh-search-alexa-greetings.json [0] |
| 2 | Amazon News: Alexa+ can now answer your Ring doorbell | 18 Dec 2025 | CLI search+scrape | same [1] |
| 3 | Ring Appstore home | undated | CLI search+scrape | .firecrawl/rivh-search-ring-appstore.json [0] |
| 4 | TechCrunch: Ring app store bets on AI | 31 Mar 2026 | CLI search+scrape | same [1] |
| 5 | Ring Appstore API release notes | latest entry 21 Sep 2026 | CLI search+scrape | same [2] |
| 6 | Ring Appstore: all apps | undated | CLI scrape | .firecrawl/rivh-ring-appstore-all-apps.md |
| 7 | Ring Appstore: Routines | undated | CLI scrape | .firecrawl/rivh-ring-appstore-routines.md |
| 8 | Ring Appstore: ProofClock | undated | CLI scrape | .firecrawl/rivh-ring-appstore-proofclock.md |
| 9 | Ring Appstore: Beside Care | undated | CLI scrape | .firecrawl/rivh-ring-appstore-beside-care.md |
| 10 | Ring Appstore: Remy | undated | CLI scrape | .firecrawl/rivh-ring-appstore-remy.md |
| 11 | Ring Appstore: PackageProtect | undated | CLI scrape | .firecrawl/rivh-ring-appstore-packageprotect.md |
| 12 | Ring Appstore: School Bus Home | undated | CLI scrape | .firecrawl/rivh-ring-appstore-school-bus-home.md |
| 13 | Ring support: Quick Replies | "Last updated 1 month ago" | CLI search+scrape | .firecrawl/rivh-search-ring-quick-replies.json [1] |
| 14 | Ring support: Familiar Faces | undated | CLI scrape | .firecrawl/rivh-ring-familiar-faces.md |
| 15 | Ring support: Intelligent features | undated | reused saved | .firecrawl/competitor-ring-search.json [0] |
| 16 | Ring Protect plans | undated | reused saved | .firecrawl/competitor-ring-search.json [1] |
| 17 | Ring support: Alexa routine with Ring | undated | CLI search+scrape | .firecrawl/rivh-search-ring-alexa-routines.json [1] |
| 18 | Ring support: Alexa Announcements | undated | CLI search+scrape | same [0] |
| 19 | Ring Community thread on routines (anecdotal) | 12 Aug 2021 | CLI search+scrape | same [2] |
| 20 | Ring support: Amazon Key in-garage | undated | CLI search+scrape | .firecrawl/rivh-search-amazon-key.json [0] |
| 21 | Amazon Key In-Garage Delivery | undated | CLI search+scrape | same [1] |
| 22 | Amazon Forum: Alexa Together discontinued (staff reply) | 2 Jun 2024 | CLI search+scrape | .firecrawl/rivh-search-alexa-together.json [0] |
| 23 | Amazon Alexa Together node → Emergency Assist | undated | CLI scrape | .firecrawl/rivh-alexa-together-official.md |
| 24 | Amazon News: Alexa+ top features | updated 24 Jul 2026 | reused saved | .firecrawl/competitor-alexa-search.json [2] |
| 25 | Amazon News: Getting started with Alexa+ | 4 Feb 2026 | reused saved | same [0] |
| 26 | Amazon News: Alexa+ in India | metadata 19 Mar 2026; body 16 Sep 2026 | reused saved | same [3] |
| 27 | Amazon help: hearing accessibility on Echo Show | undated | CLI search+scrape | .firecrawl/rivh-search-alexa-accessibility-doorbell.json [0] |
| 28 | Google Store: Google Home Premium | undated | CLI search+scrape | .firecrawl/rivh-search-google-home-premium.json [0] |
| 29 | Google Home: Welcome to Google Home Premium | undated | CLI search+scrape | same [2] |
| 30 | Google Home Help: Premium features (grep-read sections) | undated | CLI search+scrape | same [1] |
| 31 | Google blog: Google Home Speaker | 17 Jun 2026 | reused saved | .firecrawl/competitor-door-search.json [0] |
| 32 | Google blog: Gemini in Google Home | 6 Aug 2024 | reused saved | same [1] |
| 33 | OpenAI help: Scheduled tasks | "Updated 2 days ago" | CLI search+scrape | .firecrawl/rivh-search-chatgpt-agent-tasks.json [0] |
| 34 | OpenAI help: Getting started with your dot | "Updated 22 hours ago" | CLI search+scrape | same [3] |
| 35 | OpenAI help: Developer mode and MCP apps | "Updated last month" | reused saved | .firecrawl/competitor-chatgpt-search.json [1] |
| 36 | Skylight Calendar page | undated | reused saved | .firecrawl/competitor-family-search.json [0] |
| 37 | Skylight Calendar Plus page | undated | CLI search+scrape | .firecrawl/rivh-search-skylight-sidekick.json [0] |
| 38 | Skylight support: Assistant FAQ / Subscription | undated | CLI search+scrape | same [3] |
| 39 | Hearth homepage | undated | reused saved | .firecrawl/competitor-family-search.json [3] |
| 40 | Hearth features | undated | CLI scrape | .firecrawl/rivh-hearth-features.md |
| 41 | Cozi compare plans | undated | CLI search+scrape | .firecrawl/rivh-search-cozi.json [1] |
| 42 | FamilyWall Premium | undated | CLI search+scrape | .firecrawl/rivh-search-familywall.json [0] |
| 43 | Google Families help: family calendar | undated | CLI search+scrape | .firecrawl/rivh-search-google-family-calendar.json [0] |
| 44 | Apple support: shared Reminders (iOS 27) | undated | CLI search+scrape | .firecrawl/rivh-search-apple-family-calendar.json [0] |
| 45 | Home Assistant: Ring integration | undated | CLI scrape | .firecrawl/rivh-home-assistant-ring.md |
| 46 | IFTTT: Ring | undated | CLI scrape | .firecrawl/rivh-ifttt-ring.md |
| 47 | ButterflyMX how it works | undated | CLI search+scrape | .firecrawl/rivh-search-butterflymx.json [2] |
| 48 | ButterflyMX Delivery Pass blog | 28 Feb 2021 | CLI search+scrape | same [0] |
| 49 | DOOR (formerly Latch) homepage | undated | CLI search+scrape | .firecrawl/rivh-search-latch.json [0] |
| 50 | Envoy pricing | undated | CLI search+scrape | .firecrawl/rivh-search-envoy.json [0] |
| 51 | Avigilon Alta Visitor | undated | CLI search+scrape | .firecrawl/rivh-search-avigilon-alta.json [0] |
| 52 | Avigilon Alta Open Guest Pass docs | undated | CLI search+scrape | same [1] |
| 53 | Brivo Visitor Management | 4 Jun 2026 | CLI search+scrape | .firecrawl/rivh-search-brivo.json [1] |
| 54 | Eptura: Proxyclick is now Eptura Visitor | undated | CLI search+scrape | .firecrawl/rivh-search-proxyclick.json [0] |
| 55 | Routines (Density) homepage | undated | CLI scrape | .firecrawl/rivh-routines-home.md |
| 56 | Lotsa Helping Hands home + how it works | undated | CLI search+scrape | .firecrawl/rivh-search-lotsa.json [0],[1] |
| 57 | CircleCare vs Lotsa (competitor-authored) | 16 Aug 2026 | CLI search+scrape | same [2] |
| 58 | CaringBridge help: Where did the Planner go? | 14 May 2025 | CLI search+scrape | .firecrawl/rivh-search-caringbridge.json [2] |
| 59 | CaringBridge homepage | undated | CLI search+scrape | same [1] |
| 60 | Caring Village app page + App Store listing | App Store version 14 Nov 2025 | CLI search+scrape | .firecrawl/rivh-search-caring-village.json [1],[2] |
| 61 | Papa homepage | undated | CLI scrape | .firecrawl/rivh-papa-home.md |
| 62 | Healthcare IT Today: Carely interview | 30 Nov 2018 | CLI search+scrape | .firecrawl/rivh-search-carely.json [0] |

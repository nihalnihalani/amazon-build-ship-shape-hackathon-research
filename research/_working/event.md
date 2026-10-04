# EVT: Hackathon requirements matrix and discrepancy list

**Hackathon:** Build, Ship, Shape: Amazon Developer Hackathon. Site: https://amazonappdev2026.devpost.com/ (Sponsor: Amazon Developer; Administrator: Devpost)
**Prepared:** 2026-10-03, about 21:20-21:50 IST. All event pages were re-scraped live (`--max-age 0`) and diffed against the copies saved at about 21:05 IST.
**Retrieval method:** Firecrawl CLI `scrape --only-main-content --max-age 0`, run one at a time through a sequential queue that waited out the shared rate limit. One Firecrawl MCP attempt was also rate-limited. WebFetch was not used.
**Rule of precedence:** Official Rules §11.4: "If there is any discrepancy... the terms and conditions of the Official Rules shall prevail." Forum answers, FAQs, Updates and the Resources page are "Hackathon materials". They clarify how organizers read the rules, but where they conflict, the rules govern.


## 0. Executive summary

1. **No requirement changes since the 21:05 snapshots.** Rules, FAQ, schedule, resources and the updates list match the saved copies. The gallery is still unpublished. Only the participant count moved, to **34,790** live.
2. **The deadline is unchanged: Fri Oct 23 2026 12:00 PT, which is Sat Oct 24 00:30 IST.** AWS credits must be requested by Oct 21 12:00 PT (Oct 22 00:30 IST).
3. **The judging-date conflict is still live.** The schedule page says judging starts Oct 26; the rules say Nov 9-20, and the rules prevail. Whichever applies, keep everything judge-facing live through **Nov 20 12:00 PT**. An Amazon reviewer said a hosted MCP endpoint must stay live through judging.
4. **Bee is the riskiest track for requirements.** The rules require data from "an actual Bee device or an Apple Watch running the Bee software". The FAQ and an Amazon reviewer say no device is required. An Amazon staffer says recordings under about 50 words are deleted. Android users report being blocked at device pairing.
5. **Alexa+ cannot integrate with real Alexa+.** Amazon reviewers have repeatedly said entrants get no toolkit, simulator or AWS role access. Accepted demo routes are a self-built front end, a classic Alexa Skill on an Echo invoking your MCP, or a simulation. Amazon's guidance is that "latent LLM capability" ideas score poorly on Design and Quality of the Idea.
6. **Ring for non-US entrants is Playground-only.** It gives one simulated DoorbellPro with live-view simulation only: no motion webhooks, sensors or chime.
7. **Scoring:** each criterion is scored 1 to 5, the four are equally weighted, and friction logs can add up to 10%. Tie-break order is Tech Implementation, then Design, then Potential Impact, then Quality of the Idea. A project may enter several tracks but win only one track prize plus one mini prize.
8. **AWS Builder** is satisfied by Kiro Crew, or by Claude Code on Bedrock (forum). Bedrock quota and suspension problems are reported on new accounts, and Amazon cannot escalate them.
9. **Open Source:** Hacktoberfest 2026 no longer counts PRs, so there is no double reward. A fresh OSS repo created during the window qualifies.


---

## 1. Change check: live pages vs. saved copies (Task 1)

| Page | Live file | Saved file | Result |
|---|---|---|---|
| Overview `/` | `.firecrawl/evt-overview-live.md` | `.firecrawl/hackathon-overview.md` | **Content unchanged.** The only difference is the participant count, 34,524 then 34,790. A new site banner reads "planned maintenance on Oct 7th 6:00AM UTC" (Devpost-wide; 11:30 IST). The deadline still shows "Oct 23, 2026 @ 3:00pm EDT". "20 more days to deadline". |
| Rules `/rules` | `.firecrawl/evt-rules-live.md` | `.firecrawl/amazonappdev2026.devpost.com-rules.md` | **Unchanged.** The rules body is byte-identical after removing nav and footer. The banner is still "September 16, 2026 UPDATE: Hackathon submission requirements: Code repository." |
| FAQs `/details/faqs` | `.firecrawl/evt-faqs-live.md` | `.firecrawl/amazonappdev2026.devpost.com-details-faqs.md` | **Unchanged.** Still the same 11 Q&As, with no new FAQ. (`.firecrawl/amazonappdev2026.devpost.com-details-faq.md`, without the "s", is a Devpost 404 page.) |
| Schedule `/details/dates` | `.firecrawl/evt-dates-live.md` | `.firecrawl/amazonappdev2026.devpost.com-details-dates.md` | **Unchanged.** It still shows Judging "October 26 at 3:00PM EDT", which conflicts with the rules (D1). |
| Updates `/updates` | `.firecrawl/evt-updates-live.md` | `.firecrawl/amazonappdev2026.devpost.com-updates.md` | **No new posts.** There are still 7 posts, the newest being "Office Hours Schedule" ("about 20 hours ago" on the live page, so about Oct 2, 2026). |
| Project gallery `/project-gallery` | `.firecrawl/evt-gallery-live.md` | `.firecrawl/amazonappdev2026.devpost.com-project-gallery.md` | **Not published.** The page says "The hackathon managers haven't published this gallery yet." |
| Resources `/resources` | `.firecrawl/evt-resources-live.md` | `.firecrawl/technical-resources.md` | **Unchanged.** It still lists the third credit-form URL (D4). |

Conclusion: as of 2026-10-03 about 21:30 IST, nothing that matters for requirements has changed since the saved snapshots. The deadline, rules text, FAQs and update list are all the same, and the gallery is still unpublished.

---

## 1b. Update posts: guidance extracted (Task 2)

Absolute dates below are worked out from Devpost's relative timestamps ("N days ago") at retrieval. Treat them as ±1 day.

| Update | Approx. date | Key guidance |
|---|---|---|
| [Office Hours Schedule](https://amazonappdev2026.devpost.com/updates/46771-office-hours-schedule) (`evt-update-46771-office-hours.md`) | ~2026-10-02 | There are two live office hours, held as Zoom webinars that need registration. **#1: Tue Oct 6, 12:30-1:30 pm CT (10:30 am PT), which is 23:00-00:00 IST.** **#2: Mon Oct 19, 11:00 am-12:00 pm CT (9:00 am PT), which is 21:30-22:30 IST.** Questions on projects, tools or submission requirements are welcome. |
| [Got an idea?](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea) (`evt-update-46456-got-an-idea.md`) | ~2026-09-18 | **"Every submission is scored 1 to 5 on four equally weighted criteria"** (this scale is not stated in the rules). Under "Push past the obvious", it says what is table stakes and what stands out for each track. Fire TV: a CV fitness app using the TV camera, or voice + D-pad + visual multimodal. Alexa+: agentic workflow across services, or context kept across sessions. Bee: cross-device orchestration (Bee + Echo/Fire TV), or on-wrist coaching for learning. Ring: caretaking monitor, or business access control. It also says private repos are now allowed: add 6 Amazon reviewers + testing@devpost.com, and invites expire after 7 days. |
| [Let's get you building!](https://amazonappdev2026.devpost.com/updates/46202-let-s-get-you-building) (`evt-update-46202-lets-get-building.md`) | ~2026-09-14 | Track summaries; Ring says "no physical device required". Every submission includes product feedback that goes to the Amazon team. Discord: discord.gg/devpost. Questions go to the discussion forum. The MCP link is broken because it is relative (D11). |
| [Build Session recording is up](https://amazonappdev2026.devpost.com/updates/46232-the-amazon-devices-build-session-recording-is-up-resources) (`evt-update-46232-build-session-recording.md`) | ~2026-09-03 | Recording: https://youtu.be/ws61g53S2b4. Resources listed: RN multi-TV sample, Vega MCP server docs, Bee docs and bee-cli, Ring portal and Appstore, AWS Builder Center. In Discord, check in at **#amazon-developer-checkin** to get access to the hackathon space; Chris Traganos and Moses Roth are active there. |
| Other posts (list page only): 46199, 46198, 46188 | ~Aug 31-Sep 3 | Announcements for the Sep 3 live Build Session. They contain no requirement content. |

---

## 1c. Public discussion forum: official answers (Task 3)

`https://amazonappdev2026.devpost.com/forum_topics` can be read without logging in (`evt-forum-topics.md`, 26 topics on page 1). I read 19 threads in full. Answerers:
- **Emerson Sklar** (Devpost handle `esklar`). He is one of the six "Amazon Developer Relations" reviewers named in the rules (GitHub `emersonsklar`). That he is the same person is inferred from the name match, but the confidence is high.
- **Kourtney Meiss [Amazon]**, who carries a Devpost Amazon badge.
- **Janet Fang**, labelled "Manager", the hackathon manager (janet@devpost.com).
- **Laurel Perweiler** (`laureldevpost`). She appears to be Devpost staff handling credit requests. Her role is not otherwise verified.

| Thread | Date (approx.) | Official answer (paraphrase; quotes ≤25 words) | Matters for |
|---|---|---|---|
| [45111 Bee developer connect](https://amazonappdev2026.devpost.com/forum_topics/45111-bee-developer-connect) | Sep 16-23 | Kourtney (Amazon) says recordings need **more than about 50 words** to be processed: "anything shorter is often hallucinated from noise or far field speech so they are deleted". She suggests putting this in the friction log. A participant in India reports that the **Android Bee app won't go past device pairing without a Bee device** and that Developer Mode is documented only for iOS. He asked for a dev token or sandbox account. Kourtney said she would check with Bee engineering; **no resolution is visible**. Another participant reports that the **Apple Watch app works** as a recording source while waiting for a device. | Bee track feasibility |
| [45413 Bee API third-party app_id](https://amazonappdev2026.devpost.com/forum_topics/45413-bee-api-how-can-a-third-party-app-get-its-own-app-id) | ~Oct 2 | **Unanswered (0 comments).** Open questions: how third-party apps get an app_id, whether user approval needs Developer Mode, and where the docs on token lifecycle and limits are. | Bee hosted integrations |
| [45263 demo video](https://amazonappdev2026.devpost.com/forum_topics/45263-demo-video) | Sep 18-21 | Emerson: "No devices are required". For Bee: "Still no devices required - you can use the Bee API with real (or even generated) audio". For Alexa+: you can demo the MCP via a simulated web front end, **or build a classic Alexa Skill that invokes your MCP and demo it on an Echo**. Direct Alexa+ integration is "incorrect". | Bee (conflicts with rules, D2), Alexa+ demo options |
| [45262 Alexa+ MCP Toolkit / CLI](https://amazonappdev2026.devpost.com/forum_topics/45262-is-the-alexa-mcp-toolkit-alexa-ai-cli-available-to-hackathon-participants) | Sep 17-21 | Emerson: "there is no way for participants to get access to the toolkit or simulator". Access and the AWS role "will not be granted to hackathon participants". `@alexa-ai/cli` returns 404 on public npm (participant report). | Alexa+ |
| [45256 Alexa+ Web Simulator](https://amazonappdev2026.devpost.com/forum_topics/45256-alexa-web-simulator) | ~Sep 17 | The toolkit and simulator are in preview with select partners and are not available to participants. | Alexa+ |
| [45403 Testing](https://amazonappdev2026.devpost.com/forum_topics/45403-testing) | ~Oct 1 | You cannot integrate an MCP with Alexa+, so you must build some front end to invoke it, such as a simple web app or a template other participants shared on Discord. | Alexa+ |
| [45058 Simulated Alexa+ requirements](https://amazonappdev2026.devpost.com/forum_topics/45058-clarification-on-simulated-alexa-web-experience-requirements) | Sep 3; Oct 3 | Emerson: the UI need not look like Alexa+, but a resemblance helps the Design score. A dynamically responding agent is not required. Voice is not required. Custom UI is fine. It need not label itself a simulation. The backend can be real while only the Alexa+ layer is simulated. See the Alexa+ MCP add-on design guide and apl.ninja. The video must "look / feel / sound / etc. like it's actually functional". On ~Oct 3 he said **a simulation built with Lovable that uses deterministic runtime rules (no AI model called) is acceptable**. | Alexa+ simulated path |
| [45411 hosted MCP live through judging?](https://amazonappdev2026.devpost.com/forum_topics/45411-must-the-hosted-mcp-endpoint-stay-live-through-judging) | ~Oct 2 | Emerson: (1) you cannot connect a self-hosted MCP to real Alexa+; (2) **"Yes"**, the hosted MCP endpoint must stay live through judging (to Nov 20); (3) each team member can request $150 in credits; (4) once the credits run out, use the AWS free tier or other infrastructure, with Lambda suggested as a cheap MCP host. | Alexa+ ops, AWS cost (D16) |
| [45397 What do you want in Alexa+?](https://amazonappdev2026.devpost.com/forum_topics/45397-what-exactly-are-you-looking-for-in-the-alexa-track) | ~Sep 30 | Emerson: a strong fit is something people would really use on Alexa+ that brings new functionality. "a latent capability of modern LLMs or an existing feature of Alexa+ might score highly on Tech Implementation but would likely score poorly on Design" and on Quality of the Idea. Alexa+ is consumer-focused; enterprise is valid but uncommon. The expected level of Alexa+ integration is "None whatsoever". A multimodal experience is encouraged ("voice-first... but not voice-only"). Multiple tracks are allowed. | Alexa+ ideation |
| [45396 What do you want in Fire TV?](https://amazonappdev2026.devpost.com/forum_topics/45396-what-exactly-are-you-looking-for-in-the-fire-tv-track) | ~Sep 30 | Emerson: unlike Alexa+, Fire TV apps can be fully integrated using the SDKs and run on real devices. Consult the judging criteria. | Fire TV |
| [45333 Fire TV and Alexa+ both?](https://amazonappdev2026.devpost.com/forum_topics/45333-can-one-project-be-submitted-to-both-fire-tv-and-alexa-tracks) | ~Sep 24 | Emerson: "Yes, your project can select and be judged for both tracks", but it can win only one. | All tracks, multi-track strategy |
| [45309 Ring Playground (non-US)](https://amazonappdev2026.devpost.com/forum_topics/45309-ring-playground-chime-sub_type-and-sensor-coverage-what-s-the-intended-path-for-non-us-entrants) | ~Sep 25 | Emerson: the Playground issues one DoorbellPro device. Chime playback is unreachable without a chime and is Early Access (dynamic scopes). `sub_type` (motion/human/vehicle/other_motion) exists only on **motion_detected webhooks**, and the Playground simulates live-view sessions, not motion webhooks. To filter history use `event_types=` (plural). Sensors are webhook-only, Early Access, and **not in the Playground**. WHEP supports optional recvonly Opus; sessions cap at 30 s on battery and 60 s wired. Ring testing supports "devices located in the US" only, and the Ring Appstore is US-only. **"the Playground is the only documented route that needs neither a US device nor an account link."** | Ring track (non-US/India entrants) |
| [45264 private repo org collaborator](https://amazonappdev2026.devpost.com/forum_topics/45264-private-repo-path-amazonappdev-is-an-organization-so-it-cannot-be-added-as-a-collaborator) | ~Sep 18 | A participant quoted the **earlier rules text, "shared with testing@devpost.com and @AmazonAppDev"**. An org account can't be added as a collaborator. Janet's reply lists the six individual reviewers plus testing@devpost.com, with the 7-day expiry guidance. This shows the rules were amended (the Sep 16 banner). | Repo access |
| [45420 private backend hosted separately](https://amazonappdev2026.devpost.com/forum_topics/45420-repository-requirement-private-backend-service-hosted-separately-with-judge-credentials) | ~Oct 2 | Emerson: a proprietary backend that is not in the repo, kept running with judge credentials through judging, is "fine", provided everything else meets the requirements. A private repo is the alternative. | Repo completeness |
| [45418 AI-generated assets under separate licence](https://amazonappdev2026.devpost.com/forum_topics/45418-ai-generated-assets-we-own-may-they-ship-in-the-public-repo-under-a-separate-asset-licence) | ~Oct 2 | Emerson: everything needed to function must be in the repo. He recommends a **private repo** shared with the reviewers rather than a public repo whose assets are not open-licensed. | Repo license + assets |
| [45329 Media footage copyright](https://amazonappdev2026.devpost.com/forum_topics/45329-media-footage-copyright-issue) | ~Sep 23 | Emerson: **No** to movie or sports clips from YouTube or Prime. Generate your own (e.g., Amazon Nova Reel) or use the RN multi-TV sample's imaginary catalog (giolaq.github.io/scrap-tv-feed). | Fire TV demos, video |
| [45321 Claude Code on Bedrock = AWS Builder?](https://amazonappdev2026.devpost.com/forum_topics/45321-aws-builder-does-claude-code-running-on-amazon-bedrock-count-as-a-dev-tool) | ~Sep 23 | Emerson: "Yes, CC on Bedrock would count", like Kiro Crew, with no runtime AWS service needed. | AWS Builder |
| [45310 Open Source mini challenge](https://amazonappdev2026.devpost.com/forum_topics/45310-question-related-to-mini-challenge) | ~Sep 22 | Janet (Manager): a fresh open-source repo made during the window, even for another hackathon, is "fine". There is no theme requirement. | Open Source |
| [45368 AWS credit rejections](https://amazonappdev2026.devpost.com/forum_topics/45368-aws-credit-rejections-unclear-template-responses) | Sep 28-Oct 2 | Laurel: requests go through automated spam and duplicate checks first. "a decline is never because credits ran out". Fixable causes include naming your track and **using the email on your Devpost account**. If you think a decline is a mistake, reply to the decline email. Several participants report generic declines (anecdotes, multiple and independent). | AWS credits |

---

## 2. Requirements matrix (verified against live pages, 2026-10-03)

Legend for sources:
- **R** = Official Rules, https://amazonappdev2026.devpost.com/rules (live scrape `.firecrawl/evt-rules-live.md`; text byte-identical to the 21:05 saved copy apart from site chrome). Rules carry a banner "September 16, 2026 UPDATE: Hackathon submission requirements: Code repository." No other amendment date is shown.
- **O** = Overview page, https://amazonappdev2026.devpost.com/ (live `.firecrawl/evt-overview-live.md`)
- **F** = FAQs, https://amazonappdev2026.devpost.com/details/faqs (live `.firecrawl/evt-faqs-live.md`)
- **S** = Schedule, https://amazonappdev2026.devpost.com/details/dates (live `.firecrawl/evt-dates-live.md`)
- **Res** = Resources, https://amazonappdev2026.devpost.com/resources

Under Rule 11.4 the Official Rules prevail over any other hackathon material (website, submission form, ads).

| # | Requirement | What the source says (paraphrase; short quotes) | Source + section | Notes / risk |
|---|---|---|---|---|
| M1 | Submission window | Mon Aug 31 2026 10:15 am PT to **Fri Oct 23 2026 12:00 pm PT** | R §1 Dates and Timing; O header "Oct 23, 2026 @ 3:00pm EDT"; S table | 12:00 PDT = 19:00 UTC = **Sat Oct 24 00:30 IST**. Consistent everywhere. |
| M2 | Judging Period | **Nov 9 2026 12:00 pm PT to Nov 20 2026 12:00 pm PT** | R §1 | Schedule page says judging begins **Oct 26 3:00 PM EDT**; rules prevail (R 11.4). FAQ also says "Judging runs November 9-20". See D1. |
| M3 | Winners announced | On or around Thu Dec 3 2026 12:00 pm PT | R §1; S "December 03 at 3:00PM EST" | Consistent. |
| M4 | Age | At least age of majority where they reside, at time of entry | R §3; O "Above legal age of majority in country of residence" | |
| M5 | Entrant types | Individuals, Teams of eligible individuals, Organizations existing at time of entry | R §3 | |
| M6 | Country exclusions | Not open where US/local law prohibits, "including, but not limited to, Brazil, Quebec, Russia, Crimea, Cuba, Iran, and North Korea" + any OFAC comprehensively sanctioned country | R §3; F "Is there a country restriction" | India is not named as excluded. |
| M7 | Other exclusions | Sponsor/Administrator ("Promotion Entities"), their employees/agents + immediate family/household, judges and their employers, affiliates, conflicts of interest | R §3 | Amazon employees (and affiliates) are excluded. |
| M8 | Team Representative | Teams/Orgs must appoint one Representative who meets eligibility and submits; an individual may be on multiple teams and also enter solo | R §3; R §4 "Team Representation" | FAQ: no maximum team size. Prizes paid to Representative (R §8.3). |
| M9 | Team size | No maximum set in rules | F "Is there a maximum number of members per team?" | |
| M10 | Multiple submissions | Allowed, but each must be "unique and substantially different" (Sponsor/Devpost sole discretion) | R §4 "Multiple Submissions" | |
| M11 | New vs existing projects | New, or existing project "significantly updated" after Submission Period start; must explain and demo the updates | R §4 Project Requirements "New & Existing"; O "If your project existed before the hackathon..." | FAQ: a new conversational feature can count; show before/after. |
| M12 | Registration | Join on Devpost (free account) | R §4 How To Enter | |
| M13 | Fire TV required tech/runtime | Demo-ready app on **Fire OS or Vega OS**; any framework/language | R §4 Primary Tracks #1 and Submission Req. "Fire TV" | Exempt from runtime-tech-in-code hook. Video must show actual Fire TV device **or Fire TV/Vega simulator** (R). FAQ adds **Android TV Emulator** as acceptable. See D6. Forum 45396 (Emerson Sklar): Fire TV apps "can actually fully integrate" via SDKs and run on real devices; no copyrighted movie/sports clips (forum 45329). |
| M14 | Alexa+ required tech/runtime | Working **Agent Skill** or **self-hosted MCP server**, MCP spec **2025-11-25 (or later once confirmed)** over **Streamable HTTP**; OR simulated Alexa+ experience in a web app with any agentic tool | R §4 Primary Tracks #2; Submission Req. "Alexa+" | Simulated path is exempt from runtime hook but repo must include simulation source and video must clearly show it. Gated Alexa+ partner tools (Category SDK, MCP Toolkit, CLI, Web Simulator) unavailable to entrants (F; forum 45262/45256/45403). Forum-approved demo routes: own web front end invoking the MCP; a classic Alexa Skill (ASK) invoking your MCP demoed on an Echo (45263); a simulation with deterministic runtime rules built with an AI tool such as Lovable (45058). Expected Alexa+ integration level: "None whatsoever" (45397). |
| M15 | Bee required tech/runtime | Connect to data recorded and processed through an **actual Bee device or an Apple Watch running Bee software**, via Bee CLI/MCP/Agent Skills; video and code must show live Bee data doing something for a user; no public-facing integration required | R §4 Primary Tracks #3; Submission Req. "Bee" | FAQ: "The CLI shouldn't require a Bee device, but it does require a bee account" and Developer Mode needs a paired Bee device. Forum 45263 (Emerson): "Still no devices required", Bee API with real or generated audio. Forum 45111 (Kourtney Meiss [Amazon]): recordings under ~50 words are deleted, not processed; Android app reportedly won't pass pairing without a Bee device; Apple Watch app works as a recording source (participant). See D2. |
| M16 | Ring required tech/runtime | Any Ring API/SDK/simulator/device listed in Ring developer docs; video must show it working through a **simulator or an actual Ring device**; physical device not required | R §4 Primary Tracks #4; Submission Req. "Ring"; O "A physical Ring device is not required" | FAQ names Ring Developer Playground as a simulator example and Ring Indoor Cam as a device example. Forum 45309 (Emerson): Ring testing supports US-located devices only; Playground is "the only documented route" without a US device or account link; Playground simulates live-view sessions only (no motion webhooks, no sensors, no chime). |
| M17 | Runtime-tech hook (Alexa+, Bee, Ring) | Repo must use the track's required tech at runtime: "imported and actually called" (library import, app/backend entry point, or loaded agent/flow/MCP config), not just named in README | R §4 Submission Requirements | Fire TV and Alexa+ simulated path exempt. |
| M18 | Repo host | GitHub only | R §4 Submission Req. ("code repository ... on GitHub"); F "Can I submit a GitLab ...?" "No" | |
| M19 | Repo contents | All source code, assets and instructions for the project to be functional; clear setup and run instructions | R §4 Submission Req.; R §4 "Functionality" | |
| M20 | Public repo license | Public repo must include an open-source license file; license "should be detectable and visible at the top of the repository page (in the About section)" | R §4 Submission Req. | Use a standard LICENSE file GitHub can auto-detect. |
| M21 | Private repo reviewers | Share with **testing@devpost.com** and GitHub users **chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar** | R §4 Submission Req.; O What to Submit; F "My GitHub repo is private" | |
| M22 | Invite expiry | Each invitee must accept; GitHub invitations **expire after 7 days**; add reviewers at submission time, re-send if lapsed | O What to Submit "One thing to watch"; F | Not stated in Official Rules (website/FAQ/Update 46456 guidance). Earlier rules text said "shared with testing@devpost.com and @AmazonAppDev" (quoted in forum 45264, ~Sep 18); an org cannot be a collaborator, so it was replaced by six individual reviewers. |
| M23 | Demo video | **Less than 3 minutes**; judges not required to watch beyond 3 min; show project functioning on intended device/platform; **public on YouTube or Vimeo**; link on form | R §4 Submission Req.; R §4 "Platforms"; O | |
| M24 | Video IP | No third-party trademarks or copyrighted music/other material without permission | R §4 Submission Req.; F "licensed or Creative-Commons footage" | FAQ: brief properly-attributed supporting footage "typically fine" but check with organizers first. |
| M25 | Language | All materials (video, description, code docs) in English or with English translation | R §4 "Language Requirements"; O "public and in English" | |
| M26 | Text description | Explain features and functionality | R §4 Submission Req. | |
| M27 | Product feedback (required) | For each tool/API/SDK: what used and for what; what worked well; what needs work; onboarding (zero to hello world); would you build again (Yes/No + why) | R §4 Submission Req.; O | AWS Builder entrants describe AWS services here. |
| M28 | Track selection | Identify Primary Track(s) and Mini Challenge(s) | R §4 Submission Req. | Gallery filter question: "Which Primary Track(s) are you submitting your project into?" with Fire TV/Alexa+/Bee/Ring options. Sponsor may reassign category (R §4). Forum 45333 (Emerson): one project can be judged in both Fire TV and Alexa+ tracks but win only one. |
| M29 | AWS Builder mini challenge | Any primary-track project incorporating AWS services (Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented integrations; Kiro Crew alone qualifies; extra field: describe AWS services used in Product Feedback | R §4 Mini Challenges #1; Submission Req. "For AWS Builder" | Resources page says "Kiro" (not "Kiro Crew"). Forum 45321 (Emerson): "Yes, CC on Bedrock would count" (Claude Code using Amazon Bedrock as model provider qualifies like Kiro Crew). |
| M30 | Open Source mini challenge | New additional OSS project (with license) or contribution (new repo, branch, fork or PR) to a public repo during the hackathon window, alongside primary track; PRs need not be merged; required: contribution URL, project repo URL, GitHub username, description (what/how/why) | R §4 Mini Challenges; Submission Req. "For Open Source" | Forum 45310 (Janet Fang, Manager): a fresh OSS repo created during the window (even for another hackathon) is "fine"; no theme requirement. Hacktoberfest 2026 no longer counts PRs (see §5). |
| M31 | Optional feature requests | Description, why it matters, priority (Critical / Important / Nice-to-have) | R §4 Submission Req. | |
| M32 | Optional friction logs + bonus | Task, steps, expected vs actual, severity, workaround, actionable suggestion; "up to 10% bonus" | R §4 Submission Req.; R §6 "Bonus Points" | Bonus is recommended by Amazon's internal review team during Stage 1 and applied by Stage 2 panel to the final spreadsheet score. |
| M33 | Judge access / testing | Project accessible via repo + video; if website private, include login credentials; free and unrestricted for testing by Sponsor, Administrator, Judges **until Judging Period ends**; judges may judge on description/images/video only | R §4 "Testing" | Keep any hosted backends (MCP server, AWS) alive through Nov 20 12:00 PT. FAQ: locally runnable public repo + video is enough for Alexa+; hosting not required. Forum 45411 (Emerson): hosted MCP endpoint must stay live through judging ("Yes"). Forum 45420: separately hosted proprietary backend with judge credentials is acceptable. See D16. |
| M34 | Hardware access | For software on non-widely-available hardware (devices/wearables other than phones/tablets/desktops), Sponsor/Administrator may require physical access to project hardware on request | R §4 "Testing" | Relevant to Bee, Ring, Fire TV hardware demos. |
| M35 | Third-party integrations | Must be authorized under third-party terms/licenses | R §4 "Third Party Integrations" | |
| M36 | IP / open source | Original work, solely owned, no IP violation; may contract technical help; may use OSS if license-compliant and the Submission "enhances and builds upon" the OSS functionality | R §4 "Intellectual Property"; R §4 "Submission ownership" | |
| M37 | No Sponsor financial support | Project must not be developed with financial/preferential support (funding, contract, commercial license) from Sponsor or Administrator before end of Submission Period | R §4 "Financial or Preferential Support" | |
| M38 | Post-deadline edits | Drafts allowed before deadline; no changes after Submission Period (except Sponsor-permitted removals of infringing/PII material) | R §5 | |
| M39 | Judging method | Sponsor/Administrator determine methodology; "may utilize expert panels, peer review, automated AI-driven analysis, or any combination" | R §6 | Write descriptions/READMEs that are machine-parsable as well as human-readable (inference). |
| M40 | Stage 1 | Pass/fail viability: project "reasonably fits the theme and reasonably applies the required APIs/SDKs" | R §6 | |
| M41 | Stage 2 criteria | Equally weighted: Tech Implementation; Design; Potential Impact; Quality of the Idea | R §6; O Judging Criteria | Rules add "obvious vs creative" examples per track under Quality of the Idea. Update 46456: each criterion scored **1 to 5**. Forum 45397: features that are latent LLM capabilities or existing Alexa+ features "would likely score poorly on Design" and Quality of the Idea. |
| M42 | Tie-break | Highest score on first criterion (Tech Implementation), then next criterion in order; if still tied, judges vote | R §6 "Tie Breaking" | Order: Tech Implementation > Design > Potential Impact > Quality of the Idea. |
| M43 | Prize limits | A project can only win **one track prize and one mini challenge prize** | R §8 "Important notes"; O What to Build | |
| M44 | Prize table | Fire TV 1st $25k cash + $15k AWS credits + meeting + featured; 2nd $15k + $5k credits; 3rd $4k + $1k credits. Alexa+ identical to Fire TV. Bee 1st $12k + meeting; 2nd $8k (no AWS credits). Ring 1st $12k + meeting; 2nd $8k (no AWS credits). AWS Builder $5k + $5k credits + meeting. Open Source $5k + $5k credits + meeting. | R §8; O Prizes | Cash total $138,000; AWS credits total $52,000; sum $190,000 matches O "Compete for a share of $190K value". |
| M45 | AWS promo credits | $150 per individual registered entrant, while supplies last, request by **Oct 21 12 pm PT**; not redeemable for cash; subject to AWS Promotional Credit T&Cs; overage charges are entrant's responsibility | R §4 How To Enter; F "How do I request AWS Promotional Credits" | Oct 21 12:00 PDT = **Oct 22 00:30 IST**. Three different form URLs across pages (D4). Forum 45368 (Laurel Perweiler, Devpost): automated spam/duplicate checks; name your track and use your Devpost account email; declines are "never because credits ran out"; reply to decline email if mistaken. Each teammate can request (forum 45411). |
| M46 | Clarifications | If a term seems ambiguous, entrant "must submit a written request for clarification" before the deadline | R §11.6 | Contact: janet@devpost.com (O), support@devpost.com (R end). |
| M47 | Rules prevail | Official Rules prevail over website, submission form, ads | R §11.4 | |
| M48 | Rules may change | Amended rules posted on site; effective at time specified or time of posting | R §11.5 | Re-check rules before submitting. |
| M49 | Winner verification / forms | Affidavits/tax forms (W-9 / W-8BEN); return Required Forms within 10 business days; prizes delivered within 60 days of receipt | R §8.2-8.4 | |
| M50 | Publicity/licence | Sponsor gets non-exclusive license to use entry for judging; promotion rights for 3 years | R §7, §10 | |

---

## 3. Discrepancy list (each re-verified on live pages 2026-10-03 ~21:20-21:40 IST)

| ID | Discrepancy | Page A | Page B | Which governs / impact | Confidence |
|---|---|---|---|---|---|
| D1 | **Judging start date** | Schedule page: Judging "October 26 at 3:00PM EDT" to "November 20 at 3:00PM EST" ([/details/dates](https://amazonappdev2026.devpost.com/details/dates), live) | Official Rules §1: Judging Period "Monday, November 9, 2026 (12:00 pm Pacific Time) – Friday, November 20, 2026" ([/rules](https://amazonappdev2026.devpost.com/rules)); FAQ also says "Judging runs November 9-20" | Rules prevail (§11.4). Practical: keep demos/backends live from Oct 23 through at least Nov 20 12:00 PT, because Devpost's schedule could trigger Stage 1 screening from Oct 26. | High (both live) |
| D2 | **Bee device requirement** | Rules §4: data "recorded and processed through an actual Bee device or an Apple Watch running the Bee software" | FAQ (hardware Q): "The CLI shouldn't require a Bee device, but it does require a bee account." FAQ (Developer Mode Q): need to "pair a Bee device before Developer Mode becomes available" in the Bee Android app | Three-way tension. Forum 45263 (Emerson Sklar, ~Sep 19): "Still no devices required - you can use the Bee API with real (or even generated) audio". Forum 45111: Android app reportedly blocks at device pairing; Apple Watch app reported working. Rules prevail (11.4): safest plan is real data captured via a Bee device or Apple Watch running Bee software (iPhone + Bee iOS app), recordings >50 words. Seek written clarification under Rule 11.6 if relying on generated audio. | High (texts verified); outcome of judging interpretation unknown |
| D3 | **MCP spec version wording** | Rules Primary Tracks #2: "minimum acceptable version is 2025-11-25" | Rules Submission Req.: "2025-11-25 (or a later version, once confirmed)"; Overview: "spec 2025-11-25 or later" | Safe choice: implement exactly 2025-11-25 over Streamable HTTP; a later version is acceptable only "once confirmed" (no confirmation found in updates/FAQ). | High |
| D4 | **Three different AWS credit-request form URLs** | Rules §4: forms.gle/5hyhr1u6x3fuV2aW7 | FAQ: docs.google.com/forms/d/e/1FAIpQLSeBczXNHM9Y1Zy7KoaKRCGdRS4YJQGOcgM6hV8qouAEnHMz4Q/viewform; Resources: forms.gle/GaHFxSbBQNG9Kti6A | Not resolved. Short links may or may not resolve to the same form; not opened (per safety rules). Ask organizers which to use (Rule 11.6), deadline Oct 21 12 pm PT. | High that URLs differ; unknown whether forms differ |
| D5 | **Participant counts differ between pages/snapshots** | Live overview 2026-10-03: 34,790 | Saved snapshots (same evening, cached): overview 34,524; FAQ nav 34,727; gallery nav 34,728; dates/updates nav 32,940; resources nav 31,370 | Counts reflect cache age of each scrape, not contradictory facts; registrations, not submissions. Use the live 34,790 with timestamp. | High |
| D6 | **Fire TV emulator acceptance** | Rules: video must show "an actual Fire TV device or the Fire TV/Vega simulator" | FAQ: "an emulator (Android TV Emulator or the Fire TV/Vega simulator) is fine" | Rules prevail. Android TV emulator is a FAQ-only allowance; safest demo uses a Fire TV device or Vega Virtual Device. | Medium-high |
| D7 | **"Fire Track" typo** | Overview prize heading: "Fire Track - 1st Place" | Rules §8: "Fire TV Track - 1st Place" | Cosmetic. Rules name governs. | High |
| D8 | **Kiro naming** | Rules/Overview: "Kiro Crew" (and Kiro Crew alone qualifies) | Resources: "Kiro" | Probably same product family; the rules term "Kiro Crew" governs; whether plain Kiro IDE use alone qualifies is not verified. | Medium |
| D9 | **Office hours location** | Resources: schedule and join link "posted on our landing page" | Actually posted as an Update ("Office Hours Schedule", ~Oct 2); not present on live overview | Use the Update post. | High |
| D10 | **7-day invite expiry only in website/FAQ, not rules** | Overview + FAQ give 7-day GitHub invite expiry guidance | Rules list reviewers but not the expiry | Not a conflict; operational risk. | High |
| D11 | **Broken MCP link in update** | "Let's get you building!" update links to `amazonappdev2026.devpost.com/modelcontextprotocol.io/docs/...` (relative URL) | Rules link http://modelcontextprotocol.io/docs/latest/getting-started/intro | Cosmetic. | High |
| D12 | **Rules typo "JUDING CRITERIA"** | Rules §6 heading | | Cosmetic. | High |
| D13 | **Prize value framing** | Overview header "$138,000 in cash" and "$138,000 in prizes" | Overview "Why join?": "$190K value of cash and AWS credits" | Consistent: $138k cash + $52k AWS credits = $190k. Bee/Ring prizes have no AWS credits. | High |
| D14 | **Credits phrasing** | Rules: requestable by "individuals registered for the Hackathon", "while supplies last" | FAQ: "every registered participant, including each teammate" | Consistent; per-individual. | High |
| D15 | **Deadline timezone display** | Devpost header shows "Oct 23, 2026 @ 3:00pm EDT" | Rules: 12:00 pm PT | Same instant. IST = Sat Oct 24 00:30. | High |
| D16 | **Must hosted endpoints stay live through judging?** | FAQ (Alexa+ Q): "A locally runnable public repo plus your demo video is enough... hosting isn't required" | Forum 45411 (Emerson, ~Oct 2): hosted MCP endpoint must stay live through judging to Nov 20 - "Yes"; Rules §4 Testing: project available free "until the Judging Period ends" | Reconcile: hosting is optional, but if your submission points judges to a hosted endpoint it must stay up until Nov 20 12:00 PT. Provide a local-run path too. | High |
| D17 | **Rules amended mid-hackathon (private repo reviewers)** | Earlier rules text (quoted in forum 45264, ~Sep 18): "private and shared with testing@devpost.com and @AmazonAppDev" | Current rules (banner "September 16, 2026 UPDATE"): six individual GitHub users + testing@devpost.com | Use the current list. Shows rules can change (§11.5); re-check /rules right before submitting. | High |
| D18 | **AWS Builder qualifying dev tools** | Rules: "Kiro Crew qualifies on its own" | Forum 45321 (Emerson): Claude Code on Amazon Bedrock "would count" | Forum broadens rules; document the Bedrock-backed dev workflow in Product Feedback if relying on it. Safer: also include a runtime AWS integration. | Medium-high |
| D19 | **Open Source mini challenge scope** | Rules: "new, additional open-source project or contribute to an existing public repository during the hackathon window" | Forum 45310 (Janet Fang): a fresh repo made for another hackathon during the window is "fine" | Consistent if created during window; organizer reads it leniently. | Medium-high |
| D20 | **Scoring scale** | Rules: equally weighted criteria; no scale stated | Update 46456: "scored 1 to 5" on each criterion | Not a conflict; extra detail. Friction-log bonus up to 10% is applied to the "final spreadsheet score". | High |
| D21 | **Ring "simulator acceptable" vs Playground limits** | Rules/FAQ: simulator (e.g., Ring Developer Playground) acceptable for demo | Forum 45309: Playground only simulates live-view sessions (one DoorbellPro); no motion webhooks, sensors or chime; real-device testing US-only | Not a rules conflict; a capability constraint for non-US entrants (India). Plan Ring demos around live view / history / device APIs the Playground supports. | High |
| D22 | **Bee data processing threshold** | Rules require demo to show live Bee data | Forum 45111 (Kourtney Meiss [Amazon]): conversations under ~50 words are deleted (earlier said ~100 words, then corrected to <50) | Record demo conversations well over 50 words. | Medium-high |
| D23 | **Credit form access** | Forum 45056 (~early Sep): Resources-page credit form required Google sign-in | Janet Fang: "updated!" | Which of the three URLs was fixed is not stated. | Medium |

---

## 4. AWS Promotional Credit terms (Task 4)

Source: https://aws.amazon.com/awscredits/ (`.firecrawl/evt-awscredits.md`), "AWS Promotional Credit Terms & Conditions", **Last Updated: September 24, 2026**. Retrieved 2026-10-03. I did not open or submit any Google Form.

| Term | Summary | Section |
|---|---|---|
| AWS account + card | You need a valid AWS account. "You will be required to provide a valid credit card to activate an AWS account and redeem your promotional credit code." | Page intro; T&C preamble |
| Eligible services only | Credits apply only to Eligible Services. Ineligible services include Mechanical Turk, Managed Services, some Support tiers, **AWS Marketplace**, Professional Services, Training, Certification, Route 53 domain registration, crypto mining, and upfront fees (Savings Plans and Reserved Instances). Use of ineligible services is billed. | §1 |
| One-time, one account | Each code can be redeemed once, on one account. Usage beyond the credit is billed. | §2 |
| Non-transferable, no cash value | Credits cannot be sold or transferred and are not redeemable for cash (except authorized sharing within an AWS Organization). | §3 |
| Void conditions | Credits are void for fraud or misuse. They are also void "If AWS determines a customer created an AWS account solely for the purpose of obtaining Promotional Credit". | §4 |
| No stacking | Credits cannot be combined with other AWS promos unless authorized. | §6 |
| Taxes | Credits do not cover taxes. | §7 |
| No publicity | No press release or public disclosure about the credit without AWS's written consent, and you must not imply AWS endorsement. | §8 |
| Expiry | Credits expire on the date given with the code, and AWS may cancel them at any time. | §9 |
| Confidentiality | Keep data learned about the Service Offerings confidential, "including... suggested improvements". | §11 |
| Changes | AWS may modify these terms by posting them or by email. | §12 |

What this means for the hackathon (my inference): watch the void-if-account-created-solely-for-credits clause and the AWS Marketplace exclusion. Whether Bedrock third-party model usage counts as Marketplace billing is **not verified in the sources I reviewed**. The §11 confidentiality clause may sit awkwardly with publicly visible product feedback, but the hackathon form sends feedback to Amazon, so the risk is low and I have not verified it. Rules §4 separately says overage charges are the entrant's responsibility. Hackathon-specific terms: $150 per individual, requested by **Oct 21 12 pm PT (Oct 22 00:30 IST)**, while supplies last. A forum answer says declines are never because supply ran out.

Two Bedrock access problems are reported in the forum (anecdotes, 2 independent reports). [45416](https://amazonappdev2026.devpost.com/forum_topics/45416-bedrock-blocked-on-a-new-aws-account-all-model-quotas-0-not-adjustable-need-escalation) reports a new account with every Bedrock quota at 0 and "Not adjustable". [45384](https://amazonappdev2026.devpost.com/forum_topics/45384-bedrock-access-suspended-hackathon-project-live-demo-affected) reports Bedrock access suspended after an account review. Emerson Sklar's reply to both: "We do not have a way to escalate". He suggests contacting AWS Support on Reddit (u/AWSSupport). Risk for the AWS Builder plan: validate Bedrock quota on the actual account early.

---

## 5. Hacktoberfest 2026 format (Task 5)

Sources: https://hacktoberfest.com/ (`evt-hacktoberfest.md`) and https://hacktoberfest.com/questions/ (`evt-hacktoberfest-questions.md`, the page the Resources page links to). https://hacktoberfest.com/participation/ now returns **404** ("This page doesn't exist"; `evt-hacktoberfest-participation.md`). All undated pages, current for 2026, retrieved 2026-10-03.

- Theme: "Hacktoberfest 2026: AI belongs to everyone." It is month-long in October and focuses on open-weight models and open-source AI. It is run by MLH and DEV, with DigitalOcean as presenting partner.
- **Pull requests no longer count:** "Pull requests and merge requests will no longer count toward Hacktoberfest rewards." Contributions are still encouraged.
- How to participate: sign in with MyMLH, then earn virtual stickers by attending in-person Fests or online activities (livestreams, weekly DEV Challenges, Global Hack Week). Three stickers earn a mailed sticker pack. The participant dashboard opened by Oct 1.
- Eligibility: 13 or older, subject to country rules. DEV Challenges have separate rules.
- Scale: the homepage says both "400+ Fests" and "300+ Fests" and links "See every Fest (427)", so it is internally inconsistent. The India filter shows 172.
- What this means for the Open Source mini challenge: none of this conflicts. An open-source contribution made for the hackathon will not earn Hacktoberfest rewards as a PR, as the Resources page warns ("Their 2026 format moved away from counting pull requests"). Hacktoberfest DEV Challenges are separate contests with their own rules. Avoid assuming a double benefit.

---

## 6. Key timeline (all converted to IST, UTC+5:30)

| Event | Official time | IST | Source |
|---|---|---|---|
| Office Hours #1 | Tue Oct 6, 10:30-11:30 am PT | Tue Oct 6, 23:00-00:00 | Update 46771 |
| Devpost maintenance | Oct 7, 06:00 UTC | Oct 7, 11:30 | Site banner |
| Office Hours #2 | Mon Oct 19, 9:00-10:00 am PT | Mon Oct 19, 21:30-22:30 | Update 46771 |
| AWS credit request deadline | Wed Oct 21, 12:00 pm PT | Thu Oct 22, 00:30 | Rules §4 |
| **Submission deadline** | **Fri Oct 23, 12:00 pm PT** | **Sat Oct 24, 00:30** | Rules §1 |
| Judging (schedule page) | Oct 26, 12:00 pm PT | Oct 27, 00:30 | /details/dates (conflicts with rules) |
| **Judging Period (rules)** | Mon Nov 9, 12:00 pm PT to Fri Nov 20, 12:00 pm PT (PST) | Nov 10, 01:30 to Nov 21, 01:30 | Rules §1 |
| Winners announced | ~Thu Dec 3, 12:00 pm PT | Dec 4, 01:30 | Rules §1 |
| Required Forms (winners) | 10 business days after they are sent | | Rules §8.3 |

US DST ends Nov 1, 2026, so the November times are PST (UTC-8).

---

## 7. Gaps / unverified / contradictions

- **Rules-vs-materials conflicts:** D1 (judging start), D2 (Bee device), D6 (Android TV emulator), D16 (hosting), D18 (Claude Code on Bedrock). The rules govern under §11.4. Forum answers come from Amazon DevRel and the Devpost manager but are not rules amendments. If a plan depends on a forum-only allowance, get written clarification (§11.6) or design to the stricter rules text.
- **Credit form URLs:** I did not verify whether the three URLs resolve to the same form; I did not open them, per the safety rules. Which form had the Google sign-in requirement removed (forum 45056) is also not verified.
- **Bee without a device:** whether data from "generated audio" uploaded or recorded through the Bee app counts as "recorded and processed through an actual Bee device or an Apple Watch" is **not verified**. The answer to the Android-only participant's token or sandbox request is not visible. Thread 45413 (third-party app_id, token lifecycle) is **unanswered**.
- **Judging mechanics:** the rules allow "automated AI-driven analysis", but whether it is actually used is not stated. The 1-5 scale comes only from an Update. How the 10% friction bonus is computed (points vs. percent of total) is described only as "up to 10%... applied to the final spreadsheet score".
- **Judges:** the overview still says "will be announced soon!", so no named judges were verified.
- **Discord content:** not reviewed (it requires login). Updates say Amazon DevRel is active there, and some answers (e.g., Alexa+ simulator templates) are referenced as Discord-only.
- **Office hours recordings:** whether they will be recorded is not verified.
- **Submission form fields:** the actual Devpost submission form (behind login) was not viewed. Field names are inferred from the rules' Submission Requirements and the gallery filter question.
- **Participant counts:** different counts are caching artifacts, not contradictions (D5). The live figure is 34,790 (overview, 2026-10-03 ~21:23 IST).
- **AWS Marketplace exclusion vs Bedrock third-party models:** not verified in the sources I reviewed.

---

## 8. Searches run

No web searches were needed; every URL was given or linked from official pages. Scrape commands, one at a time:
1. `firecrawl scrape 'https://amazonappdev2026.devpost.com/' --only-main-content --max-age 0 -o .firecrawl/evt-overview-live.md`
2. `firecrawl scrape '.../rules' ... -o .firecrawl/evt-rules-live.md`
3. `.../details/faqs` -> `evt-faqs-live.md` (rate-limited twice on the CLI and once on the MCP before succeeding through the queue)
4. `.../details/dates` -> `evt-dates-live.md`
5. `.../updates` -> `evt-updates-live.md`
6. `.../project-gallery` -> `evt-gallery-live.md`
7. `.../resources` -> `evt-resources-live.md`
8. Updates 46771, 46456, 46202, 46232 -> `evt-update-*.md`
9. `.../forum_topics` and `?page=2` -> `evt-forum-topics.md`, `evt-forum-topics-p2.md` (page 2 is empty: "No topics have been created yet")
10. 22 forum threads -> `evt-forum-<id>.md`
11. `https://aws.amazon.com/awscredits/` -> `evt-awscredits.md`
12. `https://hacktoberfest.com/`, `/participation/` (404), `/questions/` -> `evt-hacktoberfest*.md`

## 9. Sources read (bodies read in full; retrieved 2026-10-03)

All paths are relative to ``.

| Source | Date on page | Saved file | Method | Official? |
|---|---|---|---|---|
| Overview https://amazonappdev2026.devpost.com/ | undated (deadline banner) | `.firecrawl/evt-overview-live.md` | Firecrawl CLI scrape, maxAge 0 | Yes |
| Official Rules /rules | banner "September 16, 2026 UPDATE" | `.firecrawl/evt-rules-live.md` | CLI scrape | Yes |
| FAQs /details/faqs | undated | `.firecrawl/evt-faqs-live.md` | CLI scrape (queue) | Yes |
| Schedule /details/dates | undated | `.firecrawl/evt-dates-live.md` | CLI scrape (queue) | Yes |
| Updates list /updates | relative dates | `.firecrawl/evt-updates-live.md` | CLI scrape (queue) | Yes |
| Update 46771 Office Hours | ~2026-10-02 | `.firecrawl/evt-update-46771-office-hours.md` | CLI scrape | Yes |
| Update 46456 Got an idea? | ~2026-09-18 | `.firecrawl/evt-update-46456-got-an-idea.md` | CLI scrape | Yes |
| Update 46202 Let's get you building | ~2026-09-14 | `.firecrawl/evt-update-46202-lets-get-building.md` | CLI scrape | Yes |
| Update 46232 Build Session recording | ~2026-09-03 | `.firecrawl/evt-update-46232-build-session-recording.md` | CLI scrape | Yes |
| Project gallery | n/a | `.firecrawl/evt-gallery-live.md` | CLI scrape | Yes |
| Resources | undated | `.firecrawl/evt-resources-live.md` | CLI scrape | Yes |
| Forum topic list (p1, p2) | relative | `.firecrawl/evt-forum-topics.md`, `-p2.md` | CLI scrape | Yes (official Q&A within) |
| Forum threads 45111, 45309, 45262, 45058, 45411, 45263, 45333, 45420, 45396, 45397, 45368, 45321, 45310, 45264, 45329, 45418, 45403, 45413, 45256, 45416, 45384, 45056, 45398 | relative (Aug-Oct 2026) | `.firecrawl/evt-forum-<id>.md` | CLI scrape | Answers from Amazon DevRel and the Devpost manager are official clarifications; questions are participant anecdotes |
| AWS Promotional Credit T&C | Last Updated Sept 24, 2026 | `.firecrawl/evt-awscredits.md` | CLI scrape | Yes (AWS) |
| Hacktoberfest home | undated (2026) | `.firecrawl/evt-hacktoberfest.md` | CLI scrape | Yes (MLH/DEV) |
| Hacktoberfest questions | undated (2026) | `.firecrawl/evt-hacktoberfest-questions.md` | CLI scrape | Yes |
| Hacktoberfest /participation/ | 404 | `.firecrawl/evt-hacktoberfest-participation.md` | CLI scrape | n/a |
| Saved baselines (for diff) | ~21:05 IST | `.firecrawl/hackathon-overview.md`, `amazonappdev2026.devpost.com-{rules,details-faqs,details-dates,updates,project-gallery}.md`, `technical-resources.md` | prior Firecrawl scrape (possibly cached) | Yes |

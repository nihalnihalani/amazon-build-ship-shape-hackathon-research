# Hackathon Brief: Build, Ship, Shape: Amazon Developer Hackathon

**Event site:** https://amazonappdev2026.devpost.com/
**Research as of:** Saturday 3 October 2026, 21:20–21:50 IST (full pass); **refreshed Sunday 4 October 2026, 02:40–02:45 IST** (live re-scrape and diff).
**How the pages were checked:** on 3 Oct every event page was scraped live with Firecrawl (`--max-age 0`) and compared with copies saved about 15 minutes earlier. On 4 Oct the overview, rules, FAQs, schedule, updates, project gallery, resources and forum index were scraped live again (`.firecrawl/oct4/`) and diffed against the 3 Oct copies with navigation stripped and counters masked. **Nothing that affects requirements changed:** the rules text matched, there were still 11 FAQs and 7 updates, no forum thread gained a reply, and the gallery was still unpublished. Only the participant counter moved (34,790 → **35,590**).
**Which source wins:** Official Rules §11.4 says the Official Rules prevail over the website, FAQs, updates, submission form and advertising. Forum answers from Amazon Developer Relations and the Devpost manager are treated as clarifications, not amendments.
**Evidence IDs:** claims in this brief appear in [`EVIDENCE_REGISTER.json`](EVIDENCE_REGISTER.json), mostly under the `EVT-*` and `VER-*` IDs. The full working digest is [`_working/event.md`](_working/event.md).

> **Before you act on this brief:** re-scrape `/rules`, `/details/faqs`, `/details/dates` and `/updates` and diff the full rules text. The rules were changed mid-hackathon without a new banner date (see D17). Do not assume the event is still open on a later rerun.

---

## 1. Event at a glance

| Item | Verified value | Source |
|---|---|---|
| Name | Build, Ship, Shape: Amazon Developer Hackathon | [Overview](https://amazonappdev2026.devpost.com/) |
| Sponsor / Administrator | Sponsor: Amazon Developer, 410 Terry Avenue North, Seattle, WA 98109. Administrator: Devpost, Inc., 250 Broadway, Floor 24, New York, NY 10007 | [Rules §2](https://amazonappdev2026.devpost.com/rules) |
| Format | Online, public. Managed by Devpost. | [Overview](https://amazonappdev2026.devpost.com/) |
| Registrations | **35,590** on the live overview (2026-10-04 ~02:40 IST); 34,790 on 2026-10-03 ~21:23 IST (about +800 in 29 h). Cached page copies showed 31,370–34,728; those differences are cache age, not conflicting facts. These are **registrations, not submissions or competitors per track**. | [Overview](https://amazonappdev2026.devpost.com/) |
| Primary tracks | Fire TV, Alexa+, Bee (wearable AI), Ring | [Rules §4](https://amazonappdev2026.devpost.com/rules) |
| Mini challenges | AWS Builder, Open Source | [Rules §4](https://amazonappdev2026.devpost.com/rules) |
| Prize total | **$138,000 cash**; separately, **$52,000 in AWS promotional credits** (not cash). The site's headline adds the two as "$190K value"; this package never combines them (see §7). | [Rules §8](https://amazonappdev2026.devpost.com/rules) |
| Judges | "A qualified panel of judges, will be announced soon!" Not named as of 4 Oct (re-checked live). Rules §6: judges may be Sponsor employees or third parties, need not be listed individually, and may change before or during the Judging Period. | [Overview](https://amazonappdev2026.devpost.com/); [Rules §6](https://amazonappdev2026.devpost.com/rules) |
| Hackathon manager | janet@devpost.com (overview); support@devpost.com (rules) | Overview; Rules §15 |

## 2. Timeline, converted to Asia/Kolkata

These were calculated with the IANA zone database rather than a fixed offset. US daylight saving time ends on Sunday 1 November 2026, so October times are PDT (UTC−7) and November–December times are PST (UTC−8). IST is UTC+5:30 all year. Full workings: [`_working/time_conversions.md`](_working/time_conversions.md).

| Event | Official time | UTC | **IST** | Source |
|---|---|---|---|---|
| Submission period opens | Mon 31 Aug 2026 10:15 PDT | 31 Aug 17:15 | Mon 31 Aug 22:45 | Rules §1 |
| Office Hours #1 (Zoom, registration needed) | Tue 6 Oct 10:30–11:30 PDT | 17:30–18:30 | **Tue 6 Oct 23:00 → Wed 7 Oct 00:00** (crosses midnight) | [Update 46771](https://amazonappdev2026.devpost.com/updates/46771-office-hours-schedule) |
| Devpost planned maintenance | Wed 7 Oct 06:00 UTC | 06:00 | Wed 7 Oct 11:30 | Site banner |
| Office Hours #2 | Mon 19 Oct 09:00–10:00 PDT | 16:00–17:00 | Mon 19 Oct 21:30–22:30 | Update 46771 |
| **AWS promotional-credit request deadline** | Wed 21 Oct 12:00 PDT | 19:00 | **Thu 22 Oct 00:30** (date rolls over) | Rules §4 |
| **Submission deadline** | **Fri 23 Oct 2026 12:00 PDT** (Devpost shows "3:00pm EDT") | 23 Oct 19:00 | **Sat 24 Oct 2026 00:30** (date rolls over) | Rules §1; Overview |
| Judging start, per schedule page | Mon 26 Oct 12:00 PDT | 19:00 | Tue 27 Oct 00:30 | [/details/dates](https://amazonappdev2026.devpost.com/details/dates) |
| **Judging start, per Official Rules (prevails)** | Mon 9 Nov 12:00 PST | 20:00 | Tue 10 Nov 01:30 | Rules §1; FAQ |
| Judging end | Fri 20 Nov 12:00 PST | 20:00 | Sat 21 Nov 01:30 | Rules §1 |
| Winners announced (on or around) | Thu 3 Dec 12:00 PST | 20:00 | Fri 4 Dec 01:30 | Rules §1 |

**Updated deadlines: none found.** All 7 posts on the live [/updates](https://amazonappdev2026.devpost.com/updates) page (4 Oct) were read; the only one that adds a date is Update 46771 (office hours). No update, FAQ or rules banner extends or moves the submission, credit-request, judging or announcement dates. Every page still carries "Deadline: Oct 23, 2026 @ 3:00pm EDT", the overview counter read "20 more days to deadline" at the 4 Oct scrape, and the FAQ repeats "Judging runs November 9-20". The rules banner still reads "September 16, 2026 UPDATE" even though the repository wording changed later (D17), so a silent change remains possible: re-diff before submitting.

**Time remaining** at 21:15 IST on 3 Oct: 20 days 3 h 15 min; **at 02:43 IST on Sun 4 Oct: 19 days 21 h 46 min.** Full build days from Mon 5 Oct to Thu 22 Oct inclusive: **18**, of which at least 2 are reserved for packaging and failure recovery. Recommended internal cutoff: **submit by Thu 22 Oct 20:00 IST**, which leaves about 28 hours of margin. After the deadline the submission is frozen (Rules §5). Any hosted backend must stay live and free to use until judging ends (Rules §4 "Testing"; [forum 45411](https://amazonappdev2026.devpost.com/forum_topics/45411-must-the-hosted-mcp-endpoint-stay-live-through-judging)).

## 3. Eligibility

| Topic | Rule | Source |
|---|---|---|
| Age | At least the age of majority where the entrant lives, at entry | Rules §3 |
| Who may enter | Individuals; teams of eligible individuals; organizations already formed at entry | Rules §3 |
| Excluded locations | Anywhere US or local law prohibits entry, "including, but not limited to, **Brazil, Quebec, Russia, Crimea, Cuba, Iran, and North Korea**", plus OFAC comprehensively sanctioned countries. **India is not excluded.** | Rules §3; FAQ |
| Excluded people | Promotion Entities (Amazon Developer, Devpost), their employees and agents and their immediate family or household members, judges and judges' employers, affiliates, conflicts of interest | Rules §3 |
| Teams | No maximum size (FAQ). A team must appoint one **Representative** who submits and receives any prize (Rules §8.3). An individual may be on several teams and also enter solo. | Rules §3; FAQ |
| Multiple submissions | Allowed only if each is "unique and substantially different" | Rules §4 |
| Existing projects | Allowed only if **significantly updated** after 31 Aug 10:15 PT. The update must be explained and demoed. The FAQ's example of what counts: "a new conversational feature that brings new functionality to an existing app"; show a clear before-and-after. The submission also needs a written explanation of what was built or changed during the window (§8). | Rules §4 "New & Existing"; [FAQ](https://amazonappdev2026.devpost.com/details/faqs) |
| Sponsor support | Ineligible if developed with funding, contract work or a commercial license from Amazon Developer or Devpost | Rules §4 "Financial or Preferential Support" |
| IP | Original, solely owned, no infringement. OSS use is allowed if license-compliant and the entry "enhances and builds upon" it. | Rules §4 IP |
| Third-party SDKs, APIs, data | The entrant must be authorized to use them under the provider's terms or licence | Rules §4 "Third Party Integrations" |
| Licence and publicity | Entries remain the entrant's IP, but the Sponsor gets a non-exclusive licence to use the entry for judging, and the Sponsor and Devpost may promote the submission and use contributors' names, likeness, voice and image for three years after the hackathon. Some submission components may be shown publicly. | Rules §7, §10 |
| Winner verification | Affidavit plus W-9 or W-8BEN, returned within 10 business days. Prizes are paid within 60 days of receipt. Fees and taxes are the winner's responsibility. | Rules §8 |

## 4. Primary tracks: required technology, runtime proof, and India-specific reality

| Track | Required technology | Runtime proof in repo and video | Accepted environments | Credentials / gated access | Reality for an India-based entrant (evidence) |
|---|---|---|---|---|---|
| **Fire TV** | A demo-ready app on **Fire OS or Vega OS**, in any framework or language (React Native, web, Kotlin/Java) | **Exempt** from the "imported and called" hook. The video must show the app on a **real Fire TV device or the Fire TV/Vega simulator**. | Rules: device or Fire TV/Vega simulator. FAQ also allows the "Android TV Emulator". The rules govern, so avoid relying on it (D6). | Free Amazon Developer account. Running on a real Vega stick needs `vega devmode login` (OAuth). | **Fully real and feasible.** The Vega Virtual Device runs on Apple-silicon Macs; this Mac (M4 Pro, macOS 27) first needs Rosetta installed. Vega sticks are sold in India (Fire TV Stick 4K Select ₹5,499). The VVD has **no microphone**, there is **no documented camera API** for third-party apps, and third-party apps **cannot receive arbitrary speech**. DevRel: Fire TV apps "can actually fully integrate" and run on real devices ([45396](https://amazonappdev2026.devpost.com/forum_topics/45396-what-exactly-are-you-looking-for-in-the-fire-tv-track)). Details: [`_working/firetv.md`](_working/firetv.md). |
| **Alexa+** | A working **Agent Skill** or a **self-hosted MCP server** implementing spec **2025-11-25** ("or a later version, once confirmed") over **Streamable HTTP**. Alternatively, a **simulated Alexa+ experience** built with any agentic tool. | The MCP or Agent Skill path must be imported or loaded and called at runtime. The simulated path is **exempt**, but the repo must contain the simulation source and the video must clearly show it working. | Your own web front end calling your MCP server. A **classic Alexa Skill on an Echo** calling your MCP ([45263](https://amazonappdev2026.devpost.com/forum_topics/45263-demo-video)). A simulation, which may use deterministic rules ([45058](https://amazonappdev2026.devpost.com/forum_topics/45058-clarification-on-simulated-alexa-web-experience-requirements)). | **Gated and unavailable:** Category SDK, MCP Toolkit, CLI, Web Simulator ([FAQ](https://amazonappdev2026.devpost.com/details/faqs); [45262](https://amazonappdev2026.devpost.com/forum_topics/45262-is-the-alexa-mcp-toolkit-alexa-ai-cli-available-to-hackathon-participants)). Expected Alexa+ integration: "None whatsoever". | Feasible with no hardware. Amazon's public add-on docs describe the client contract to emulate: structuredContent, MCP Apps `_meta.ui`, display modes, List/Carousel/Card/Map, and certification functional requirements. **MCP 2026-07-28 now exists and is breaking and stateless**, while Amazon's own tools are 2025-era and sessionful, so target 2025-11-25. The most crowded track by visible GitHub repos. Details: [`_working/mcp.md`](_working/mcp.md). |
| **Bee** | Connect to data **recorded and processed through an actual Bee device or an Apple Watch running Bee software**, using Bee's **CLI, MCP or Agent Skills**. The demo must show the data doing something useful for a person. | The repo must import and call Bee at runtime. The video and code must show **live Bee data**; mentioning Bee is not enough. No public multi-user integration is required. | A Bee Pioneer, or an Apple Watch running Bee software | Bee account plus **Developer Mode** (tap the app version 5 times). The FAQ says Android Developer Mode appears only after pairing a Bee device. | **Hardware-gated.** The Pioneer ($49.99) ships to the **US only**, and the Android app is US-only. An India-based Android entrant was blocked at pairing with no visible resolution. The iOS app is listed on the India App Store, and one participant reports Watch recordings reaching the API. Recordings under ~50 words are deleted. Details: [`_working/bee.md`](_working/bee.md). |
| **Ring** | A working app or new feature using any Ring API, SDK, simulator or device listed in Ring's developer docs. **A physical device is not required.** | The repo must call Ring at runtime. The video must show the project working through a **simulator or an actual Ring device**. | Ring Developer Playground (FAQ example) or real device | A free Amazon Developer account. Real apps require **identity verification (government photo ID)**, account linking, a webhook, and **US-located devices with a Ring plan**. | **Playground only** ("the only documented route" without a US device; [45309](https://amazonappdev2026.devpost.com/forum_topics/45309-ring-playground-chime-sub_type-and-sensor-coverage-what-s-the-intended-path-for-non-us-entrants)). That means one simulated DoorbellPro, device reads, 30-minute tokens, and WHEP live view of pre-recorded **CC BY** footage that needs attribution. It has **no motion or doorbell webhooks, no sensors, no chime, no stored snapshots**. Details: [`_working/ring.md`](_working/ring.md). |

**Priority categories named by the sponsor:**
- Fire TV: AI-enhanced viewing, sports, fitness, family entertainment, multi-modal UX, computer vision.
- Bee: education, developer experience, personal productivity.
- Ring: access control, business systems, IoT home automation, accessibility, caretaking.

**Multi-track:** one project may be judged in more than one track (Fire TV and Alexa+ confirmed in [45333](https://amazonappdev2026.devpost.com/forum_topics/45333-can-one-project-be-submitted-to-both-fire-tv-and-alexa-tracks)) but **can win only one track prize and one mini-challenge prize** (Rules §8).

**Official starting points named in Rules §4 "How To Enter":** Fire TV [developer.amazon.com/apps-and-games/](http://developer.amazon.com/apps-and-games/); Alexa+ [modelcontextprotocol.io getting-started](http://modelcontextprotocol.io/docs/latest/getting-started/intro); Bee [docs.bee.computer](http://docs.bee.computer/); Ring [developer.ring.com](http://developer.ring.com/); AWS [builder.aws.com](http://builder.aws.com/). The rules add that use of the developer tools is subject to each tool's licence agreement.

## 5. Mini challenges

| Mini challenge | Qualifies when | Extra required fields | Organizer clarifications |
|---|---|---|---|
| **AWS Builder** | Any primary-track project that uses AWS services "with documented integrations", such as Bedrock, AgentCore, Strands SDK, Kiro Crew or SageMaker. **Kiro Crew alone qualifies.** | Describe which AWS services were used and how, inside the Product Feedback answer | Claude Code running on Amazon Bedrock also counts ([45321](https://amazonappdev2026.devpost.com/forum_topics/45321-aws-builder-does-claude-code-running-on-amazon-bedrock-count-as-a-dev-tool)). The rules treat these as **obvious**: a single Bedrock call, or S3 for storage. They treat these as **creative**: a multi-service pipeline (Bedrock + AgentCore + Strands), an "agentic architecture with Claude/Kiro for development workflow", or agent orchestration patterns. |
| **Open Source** | A **new, additional** OSS project with a license, or a contribution (branch, fork or PR) to a public repo, made **during the hackathon window**, alongside a primary-track entry. PRs need not be merged. | Contribution URL, project repo URL, GitHub username, and what you did, how it works and why it matters | A fresh OSS repo created in the window is "fine" ([45310](https://amazonappdev2026.devpost.com/forum_topics/45310-question-related-to-mini-challenge)). The rules treat a README update, typo fix or minor formatting as **obvious**. They treat a meaningful feature with tests, an unblocking bug fix, or a new integration pattern ("adding Vega support to a popular React Native library") as **creative**. Hacktoberfest 2026 no longer counts PRs, so there is no double reward. |

## 6. Judging

- **Stage 1** is pass/fail: does the project "reasonably fit the theme and reasonably apply the required APIs/SDKs" (Rules §6)?
- **Stage 2** uses four criteria, **equally weighted**: Tech Implementation, Design, Potential Impact, Quality of the Idea. Each is scored **1–5** ([Update 46456](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea); the rules give no scale).
- **Potential Impact** asks for "a credible, specific case for solving customer needs" and an audience beyond the hackathon; the rules point to the [Fire TV Appstore](https://www.amazon.com/Fire-TV-Apps-All-Models/b/?ie=UTF8&node=10208590011&ref_=sv_mas_3) and [Ring Appstore](https://ring.com/appstore) as examples of the bar (Rules §6).
- **Tie-break order:** Tech Implementation, then Design, then Potential Impact, then Quality of the Idea. A judges' vote settles any remaining tie.
- **Friction-log bonus:** up to **10%**. Amazon's internal team recommends it during Stage 1, and the Stage 2 panel applies it to the "final spreadsheet score".
- **Method:** the sponsor may use "expert panels, peer review, automated AI-driven analysis, or any combination". Write descriptions and READMEs that are both machine-parsable and human-readable (inference).
- **Judges may not run the project.** They "may choose to judge based solely on the text description, images, and video" (Rules §4). The video therefore has to carry the case.
- **Obvious vs creative** (Rules §6, Quality of the Idea):
  - **Fire TV.** Obvious: streaming UI, video player, remote-controlled game. Creative: AI viewing that adapts to household patterns, CV fitness, voice + D-pad + visual in one flow.
  - **Alexa+.** Obvious: single-turn Q&A, a basic MCP wrapper. Creative: autonomous cross-service workflow, state across sessions, purchasing, cards and carousels, MCP Apps, Agent Skills.
  - **Bee.** Obvious: notification relay, data logging. Creative: Bee + Echo + Fire TV orchestration, ambient context driving productivity, on-wrist education coaching, facts and insights, real time, self-improvement, synced meeting insights.
  - **Ring.** Obvious: motion alert, live view. Creative: accessibility aid, caretaking, package management, business access control, multi-camera pipeline, event-based triggers.
- **Organizer signals:**
  - On Alexa+, "a latent capability of modern LLMs or an existing feature of Alexa+ ... would likely score poorly on Design" and Idea. Alexa+ is consumer-focused and should be "voice-first ... but not voice-only" ([45397](https://amazonappdev2026.devpost.com/forum_topics/45397-what-exactly-are-you-looking-for-in-the-alexa-track)).
  - Simulated demos must "look / feel / sound / etc. like it's actually functional" ([45058](https://amazonappdev2026.devpost.com/forum_topics/45058-clarification-on-simulated-alexa-web-experience-requirements)).
  - Submissions "aren't bound by the publicly documented addon capabilities": a capability add-ons cannot invoke today (the example was Alexa-to-Alexa calling or Drop In) may still be demoed. Alexa Smart Properties is out of scope ([45199](https://amazonappdev2026.devpost.com/forum_topics/45199-alexa-mcp-can-an-add-on-initiate-alexa-to-alexa-calling-or-drop-in)).
  - Without Alexa+ access "you will need to create some sort of front end to invoke" your MCP server; participants share front-end templates on Discord ([45403](https://amazonappdev2026.devpost.com/forum_topics/45403-testing)).
  - Update 46456 "Push past the obvious": Fire TV, a CV fitness app using the TV camera or voice + D-pad + visuals; Alexa+, orchestration across services or context kept across sessions; Bee, cross-device (Bee alongside Echo or Fire TV) or on-wrist coaching for learning; Ring, a caretaking monitor or business access control ([Update 46456](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea)).
- **Calibration** (prior Amazon/Devpost winners, not a prediction): winning pages had embedded demo videos, made the sponsor technology core to the product, and wrote honest Challenges sections ([`_working/github.md`](_working/github.md)).

## 7. Prizes: cash and AWS credits are separate

| Prize | Cash | AWS credits (not cash) | Other | Qty |
|---|---|---|---|---|
| Fire TV 1st / 2nd / 3rd | $25,000 / $15,000 / $4,000 | $15,000 / $5,000 / $1,000 | 1st: meeting with Amazon Developer team; all: featured | 1 each |
| Alexa+ 1st / 2nd / 3rd | $25,000 / $15,000 / $4,000 | $15,000 / $5,000 / $1,000 | Same as Fire TV | 1 each |
| Bee 1st / 2nd | $12,000 / $8,000 | **none** | 1st: meeting; all: featured | 1 each |
| Ring 1st / 2nd | $12,000 / $8,000 | **none** | 1st: meeting; all: featured | 1 each |
| AWS Builder | $5,000 | $5,000 | Meeting; featured | 1 |
| Open Source | $5,000 | $5,000 | Meeting; featured | 1 |
| **Totals** | **$138,000** | **$52,000** | | 12 |

Per-project cap: **one track prize plus one mini-challenge prize** (Rules §8). The sponsor may move a project to another category or mini challenge (Rules §4).

## 8. What to submit

| Field / artifact | Requirement | Source |
|---|---|---|
| Text description | What it does and how it works (features and functionality) | Rules §4 |
| **GitHub repo** (GitHub only) | All source, assets and instructions needed to run it, with clear setup and run steps. Choose one: **public** with an OSS license file detectable in the About section, **or private** shared with `testing@devpost.com` and GitHub users `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar`. Invitations **expire after 7 days** and each must be accepted, so add reviewers at submission time. | Rules §4; FAQ; Overview; [Update 46456](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea) |
| Repo completeness clarifications | A separately hosted proprietary backend whose source is not in the repo is acceptable if the rest complies and judges get working credentials for the whole judging period; DevRel compared it to using licensed third-party libraries ([45420](https://amazonappdev2026.devpost.com/forum_topics/45420-repository-requirement-private-backend-service-hosted-separately-with-judge-credentials)). AI-generated assets that cannot carry the repo's OSS licence: DevRel recommends the **private-repo path** rather than a public OSS repo ([45418](https://amazonappdev2026.devpost.com/forum_topics/45418-ai-generated-assets-we-own-may-they-ship-in-the-public-repo-under-a-separate-asset-licence)). Brief, properly attributed third-party footage in the video is "typically fine", but the FAQ asks you to check with the organizers first. | Fm 45420; Fm 45418; [FAQ](https://amazonappdev2026.devpost.com/details/faqs) |
| Runtime-hook proof | Alexa+ (MCP or Skill path), Bee and Ring: required tech imported and **called at runtime**. Fire TV and the Alexa+ simulation path are exempt. | Rules §4 |
| **Demo video** | **Under 3 minutes**; judges need not watch past 3:00. Must show the project working on its intended platform or device. **Public on YouTube or Vimeo.** English. No third-party trademarks or copyrighted music or footage without permission; no movie or sports clips ([45329](https://amazonappdev2026.devpost.com/forum_topics/45329-media-footage-copyright-issue)). | Rules §4 |
| **Product feedback (required)** | For every tool, API or SDK: what it was used for, what worked, what needs work, onboarding (zero to hello world), and would you build again (yes/no and why). AWS services are described here. | Rules §4 |
| Track(s) and mini challenge(s) | Select them | Rules §4 |
| AWS Builder fields | AWS services used and how (inside the product feedback) | Rules §4 |
| Open Source fields | Contribution URL, project repo URL, GitHub username, what/how/why | Rules §4 |
| Existing-project explanation | What was built or changed during the window | Rules §4 |
| Optional: feature requests | Description, why it matters, priority (Critical / Important / Nice-to-have) | Rules §4 |
| Optional: friction log | Task, steps, expected vs actual, severity, workaround, actionable suggestion. Up to a **10% bonus**. | Rules §4, §6 |
| Judge access | Free, unrestricted access until judging ends. Include credentials if anything is private. Hardware access may be requested for non-phone/desktop devices. | Rules §4 "Testing" |
| Language | English, or English translations of everything | Rules §4 |

Note: the actual Devpost submission form sits behind login and was **not viewed**. The fields above come from the rules.

## 9. AWS promotional credits

- **$150 per individual registered participant.** Each teammate may request their own ([FAQ](https://amazonappdev2026.devpost.com/details/faqs); 45411). Request by **Wed 21 Oct 12:00 PT = Thu 22 Oct 00:30 IST**. Offered "while supplies last", though Devpost says declines are "never because credits ran out" ([45368](https://amazonappdev2026.devpost.com/forum_topics/45368-aws-credit-rejections-unclear-template-responses)).
- Requests pass automated spam and duplicate checks first. Devpost says every decline e-mail now names the reason; fixable reasons include not naming your track or not using the e-mail on your Devpost account (fix and resubmit); otherwise reply to the decline e-mail for a manual look ([45368](https://amazonappdev2026.devpost.com/forum_topics/45368-aws-credit-rejections-unclear-template-responses)). A later poster still reported a reason-less decline, so allow time for a second round.
- **Three different form URLs** appear on the site (D4). None was opened or submitted. **This plan does not submit a request for you.**
- The Resources-page form originally required a Google sign-in; the hackathon manager said it was "updated" ([45056](https://amazonappdev2026.devpost.com/forum_topics/45056-request-to-update-aws-credit-request-form-permissions)). Not verified by opening the form.
- Rules §4: credits are "for the purpose of completing your Project", "can be used for most AWS services required for this hackathon", are not redeemable for cash, and are offered "while supplies last".
- FAQ: judging runs 9–20 Nov, so AWS resources need not run continuously until then; spin them up only to test and tear them down afterwards. There is no official offline Bedrock emulator, so mock or stub Bedrock calls during early development ([FAQ](https://amazonappdev2026.devpost.com/details/faqs)).
- AWS Promotional Credit T&C, [last updated 24 Sep 2026](https://aws.amazon.com/awscredits/):
  - A credit card is required.
  - Credits exclude AWS Marketplace and some other services.
  - They are void if the account was created solely to obtain credits.
  - They have no cash value, cannot be combined with other promotions, and expire.
- **Whether credits cover Anthropic models on Bedrock is not verified.** Amazon Nova is the safer credit-funded model.
- Accounts on the AWS Free plan cannot use promotional credits, and AgentCore needs a Paid plan ([`_working/aws.md`](_working/aws.md)).
- Two forum reports describe new accounts with Bedrock quotas at 0 or suspended, and Amazon cannot escalate these. **Validate Bedrock access on day 1.**
- Overage charges are the entrant's responsibility (Rules §4).

## 10. Gallery and competition signals

- **The project gallery is unpublished** ("The hackathon managers haven't published this gallery yet"; re-checked live 4 Oct 02:40 IST, unchanged). That is **not** evidence of low competition.
- About **35.6k registrations** (4 Oct) is not the number of submissions or per-track competitors.
- **Visible lower bound from public GitHub** ([`_working/github.md`](_working/github.md)): 363 unique public repos mentioned the hackathon on 3 Oct. About 158 are Alexa+, about 37 Fire TV, about 36 Ring and about 7 Bee. A 4 Oct re-query of the validated Alexandria GitHub provider found **20 more repos created on 3 Oct alone** (`.firecrawl/oct4/gh-new-since-oct2-*.json`), so the public field is growing by roughly 15–20 repos a day. Private repos are invisible. Do **not** assume Bee or Ring have fewer serious competitors because they involve friction.
- **Visible quality bar is high.** Serial entrants ship live AWS deployments, 2–3 minute demos, tests, tables separating verified from simulated parts, and friction findings.
- **Crowded visible themes:**
  - AI audio description on Fire TV: 8+ repos
  - elder care and dementia: about 15
  - recall-check MCP servers: about 9
  - scam guardians: about 5
  - doorbell description for blind residents: at least 2
  - dementia night-exit voice: 2

## 11. Help channels

- Office hours #1 and #2 (times in §2; Zoom registration via Update 46771).
- Devpost discussion forum: Amazon DevRel answers there.
- Discord, via the Devpost invite [discord.gg/devpost](https://discord.gg/devpost) (Updates 46456 and 46232). The Amazon team is "very active in the Amazon Developer Hackathon channels" (Devpost manager, [45368](https://amazonappdev2026.devpost.com/forum_topics/45368-aws-credit-rejections-unclear-template-responses)) and participants share Alexa+ front-end templates there ([45403](https://amazonappdev2026.devpost.com/forum_topics/45403-testing)). The channel name `#amazon-developer-checkin` recorded on 3 Oct is not verified in the reviewed event pages.
- Ring developer community (low traffic).
- Bee: the forum works better than GitHub issues; a maintainer said issues were not monitored.
- Written clarification requests are required for ambiguous terms (Rules §11.6), but no channel is named. Use janet@devpost.com or support@devpost.com, plus the forum.

## 12. Discrepancies and open questions

Official Rules §11.4 decides which side governs. Each item is kept as an open question.

| ID | Discrepancy | Statement A | Statement B | Governs / action |
|---|---|---|---|---|
| D1 | Judging start | Schedule page: **26 Oct** 3:00 PM EDT | Rules §1 and FAQ: **9 Nov** 12:00 PT | **Rules.** Keep demos and backends live from 23 Oct through 20 Nov 12:00 PT either way. |
| D2 | Bee device need | Rules: data "recorded and processed through an **actual Bee device or an Apple Watch** running the Bee software" | FAQ: CLI "shouldn't require a Bee device, but it does require a bee account". DevRel ([45263](https://amazonappdev2026.devpost.com/forum_topics/45263-demo-video)): "no devices required ... real (or even generated) audio". FAQ also says Android Developer Mode needs a paired device. | **Rules.** Do not rely on generated audio without a written clarification. |
| D3 | MCP version | Rules: "minimum acceptable version is 2025-11-25" | Rules: "(or a later version, once confirmed)"; spec **2026-07-28** published 28 Jul 2026 | No confirmation of 2026-07-28 found. Implement 2025-11-25 and accept older 2025-era clients. |
| D4 | Credit form URL | Rules: `forms.gle/5hyhr1u6x3fuV2aW7` | FAQ: `docs.google.com/forms/d/e/1FAIpQLSeBcz…/viewform`; Resources: `forms.gle/GaHFxSbBQNG9Kti6A` | Unresolved. Ask the organizers which to use. Not opened. |
| D5 | Registration counts | 31,370–34,728 on cached copies | 34,790 live on 3 Oct; **35,590** live on 4 Oct | Caching artifact. Use live and timestamped figures. |
| D6 | Fire TV emulator | Rules: device or "Fire TV/Vega simulator" | FAQ: Android TV Emulator also fine | **Rules.** Use the VVD or a real device. |
| D7 | Prize heading | Overview: "Fire Track" | Rules: "Fire TV Track" | Cosmetic. |
| D8 | Kiro naming | Rules: "Kiro Crew" qualifies alone | Resources: "Kiro" | "Kiro Crew" is a defined product ([kiro.dev/crew](https://kiro.dev/crew)). Whether plain Kiro IDE use alone qualifies is not verified. |
| D9 | Office-hours location | Resources: "posted on our landing page" | Actually posted as an Update | Use the Update. |
| D16 | Hosting | FAQ: locally runnable repo plus video is enough; hosting not required | DevRel 45411: a hosted MCP endpoint must stay live through judging ("Yes") | Hosting is optional, but any endpoint you offer must stay up until 20 Nov. Always provide a local-run path. |
| D17 | Rules amended mid-event | Earlier rules (quoted ~18 Sep in [45264](https://amazonappdev2026.devpost.com/forum_topics/45264-private-repo-path-amazonappdev-is-an-organization-so-it-cannot-be-added-as-a-collaborator)): share private repo with "@AmazonAppDev" | Current: six individual reviewers, announced in [Update 46456](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea) ("your project repository can now be private"). The banner still reads "September 16, 2026 UPDATE". Rules body was identical on 3 Oct and 4 Oct (anchored diff). | Re-diff the full rules text before submitting. |
| D18 | AWS Builder dev tools | Rules: Kiro Crew qualifies alone | DevRel: Claude Code on Bedrock also counts | The forum broadens the rules. Safer to also include a real runtime AWS integration. |
| D21 | Ring "simulator acceptable" vs Playground limits | Rules and FAQ accept a simulator | Playground simulates live view only: no webhooks, sensors or chime | Capability constraint, not a rules conflict. Any event layer must be clearly labelled as simulated, or come from real US devices. |
| D22 | Bee data threshold | Rules require live Bee data | Amazon staff: recordings under ~50 words are deleted | Record well over 50 words. |

Other open questions:
- Will office hours be recorded?
- Discord guidance exists (the Amazon team is "very active" there per 45368; participants share Alexa+ front-end templates per 45403) but was not reviewed because it needs login.
- Bee hosted third-party integration (how an app gets its own `app_id`, token lifecycle, limits): [45413](https://amazonappdev2026.devpost.com/forum_topics/45413-bee-api-how-can-a-third-party-app-get-its-own-app-id) had **0 replies** as of 4 Oct. The India/Android pairing-block request in [45111](https://amazonappdev2026.devpost.com/forum_topics/45111-bee-developer-connect) had no visible follow-up as of 4 Oct.
- Resolved on the forum: no participant or winner certificates are issued ([45398](https://amazonappdev2026.devpost.com/forum_topics/45398-do-participants-receive-a-certificate)).
- How exactly is the 10% bonus computed?
- Will automated AI analysis actually be used?
- Does an Apple Watch with no Pioneer unlock Bee Developer Mode in India?
- **Open question (completeness pass, 4 Oct):** what exact fields, character limits and upload slots does the live Devpost submission form have? It sits behind login and was never viewed, so §8 and the drafts in [EXECUTION_AND_SUBMISSION.md §7](EXECUTION_AND_SUBMISSION.md) are inferred from Rules §4. Open the form (without submitting) well before 22 Oct and reconcile.

### Known issues to re-check before submission

Each was true on the live pages of 4 Oct 2026; confirm again on submission day.

1. **Deadline:** Fri 23 Oct 2026 12:00 PDT = Sat 24 Oct 00:30 IST (date rolls over). Devpost displays it as 3:00pm EDT. [Rules §1](https://amazonappdev2026.devpost.com/rules); [Overview](https://amazonappdev2026.devpost.com/).
2. **Alexa+ partner tools are gated** (Category SDK, MCP Toolkit, CLI, Web Simulator: "no way for hackathon participants to apply"). Permitted routes: a self-hosted MCP server on spec 2025-11-25 ("or a later version, once confirmed") over Streamable HTTP, an Agent Skill, or an independent simulation built with any agentic tool. [Rules §4](https://amazonappdev2026.devpost.com/rules); [FAQ](https://amazonappdev2026.devpost.com/details/faqs); [45262](https://amazonappdev2026.devpost.com/forum_topics/45262-is-the-alexa-mcp-toolkit-alexa-ai-cli-available-to-hackathon-participants).
3. **Bee needs data actually recorded and processed through a Bee device or an Apple Watch running Bee software**, shown live in code and video. A Bee account alone, or a fabricated transcript, does not meet the rules text; the DevRel "generated audio" remark (45263) is a forum clarification, not an amendment (D2). [Rules §4](https://amazonappdev2026.devpost.com/rules).
4. **Ring and Fire TV accept simulator demonstrations:** Ring through "a simulator or an actual Ring device" (Developer Playground named in the FAQ); Fire TV on "an actual Fire TV device or the Fire TV/Vega simulator". [Rules §4](https://amazonappdev2026.devpost.com/rules); [FAQ](https://amazonappdev2026.devpost.com/details/faqs).
5. **Gallery unpublished** ("The hackathon managers haven't published this gallery yet"). Not evidence of low competition; the 35,590 figure is registrations, not submissions. [Project gallery](https://amazonappdev2026.devpost.com/project-gallery).
6. **Judging start disagrees:** schedule page 26 Oct 3:00 PM EDT vs Official Rules 9 Nov 12:00 PT. The rules prevail (§11.4). Keep anything hosted live until 20 Nov 12:00 PT either way. [Schedule](https://amazonappdev2026.devpost.com/details/dates); [Rules §1, §11.4](https://amazonappdev2026.devpost.com/rules).

## 13. Source-linked requirements matrix (condensed)

The full 50-row matrix, with section references, is in [`_working/event.md` §2](_working/event.md).

Source key: **R** = [Official Rules](https://amazonappdev2026.devpost.com/rules); **O** = [Overview](https://amazonappdev2026.devpost.com/); **F** = [FAQs](https://amazonappdev2026.devpost.com/details/faqs); **S** = [Schedule](https://amazonappdev2026.devpost.com/details/dates); **U** = Updates; **Fm** = forum thread.

| # | Requirement | Source | Planned evidence of compliance |
|---|---|---|---|
| M1 | Submit by 23 Oct 12:00 PT (24 Oct 00:30 IST) | R §1, O, S | Internal submit by 22 Oct 20:00 IST |
| M4–M7 | Age of majority; not in excluded jurisdictions; not a Promotion Entity or affiliate | R §3 | Self-check by each member |
| M8 | Team Representative submits and receives the prize | R §3, §8.3 | Name the Representative on day 1 |
| M11 | New, or significantly updated after 31 Aug | R §4 | New repo created in the window; commit history |
| M13 | Fire TV: runs on Fire OS or Vega OS; video on a device or the Fire TV/Vega simulator | R §4 | VVD or Vega-stick footage |
| M14 | Alexa+: MCP server 2025-11-25 over Streamable HTTP, an Agent Skill, or a simulation | R §4 | Protocol conformance tests; simulator source |
| M15 | Bee: real device- or Watch-recorded data via CLI, MCP or Skill, used for value | R §4 | Recording-to-API trace in the video |
| M16 | Ring: simulator or device; Ring API called at runtime | R §4 | Playground API calls in the video and code |
| M17 | Runtime hook (Alexa+ MCP/Skill path, Bee, Ring) | R §4 | Import and call sites linked in the README |
| M18–M22 | GitHub; full source and assets; license in About, or private plus 7 reviewers; 7-day invite expiry | R §4, F, O | License visible check; invites sent on submission day |
| M23–M25 | Video under 3:00, public on YouTube or Vimeo, English, no unlicensed media | R §4 | Final cut 2:40–2:50; music-free or original audio |
| M26–M28 | Description; product feedback per tool; track and mini selection | R §4 | Feedback template filled from the friction log |
| M29 | AWS Builder: documented AWS integration | R §4, Fm 45321 | Architecture section and feedback text |
| M30 | Open Source: new OSS repo or contribution during the window, plus 4 fields | R §4, Fm 45310 | Contribution URL and description |
| M31–M32 | Optional feature requests and friction log (bonus up to 10%) | R §4, §6 | Friction log kept daily |
| M33–M34 | Free judge access until judging ends; hardware access on request | R §4 | Local-run path; any hosted endpoint live to 20 Nov |
| M38 | No edits after the deadline | R §5 | Freeze tag `v1.0-submission` |
| M41–M42 | Four equal criteria; tie-break Tech > Design > Impact > Idea | R §6, U 46456 | Lead the video with the tech proof |
| M43 | One track prize plus one mini prize | R §8 | Choose a single primary track |
| M45 | $150 credits per person by 21 Oct 12:00 PT | R §4, F | User decides; not requested on their behalf |
| M47–M48 | Rules prevail; rules may change | R §11.4–11.5 | Re-diff the rules on submission day |

## 14. Refresh log

| When (IST) | What was done | Result |
|---|---|---|
| Sat 3 Oct 2026, 21:20–21:50 | Full pass: every event page scraped live with Firecrawl (`--max-age 0`) and compared with copies saved about 15 minutes earlier; 24 forum threads (23 `.firecrawl/evt-forum-*.md` plus `main-forum-45199.md`), 4 update pages and the forum page 2 captured; IST conversions computed with zoneinfo. | Brief written. Participants 34,790. |
| Sun 4 Oct 2026, 02:40–02:45 | Live re-scrape of overview, rules, FAQs, schedule, updates, project gallery, resources and forum index into `.firecrawl/oct4/`; diff against 3 Oct with navigation stripped and counters masked. | **No substantive changes.** Rules body identical (anchored diff from the "Official Rules" heading to the support e-mail); 11 FAQs; 7 updates; 25 forum topics with no new replies; gallery still unpublished; participants **35,590**. |
| Sun 4 Oct 2026, ~04:25 (rules review) | Checklist review of this brief against the 4 Oct captures and the 3 Oct forum thread captures; IST conversions recomputed with zoneinfo (all matched). | Added: updated-deadline statement, full sponsor/administrator addresses, judge-identity clause, third-party and publicity rows, Rules §4 starting points, Potential Impact reference bar, organizer signals from 45199/45403/Update 46456, repo-completeness clarifications (45420, 45418, FAQ), credit-form and AWS-cost FAQ notes, Discord sourcing, D5/D17 updates, new open questions (45413, 45111, 45398), the known-issues list in §12, and this log. Corrected: "as of 3 Oct" judge statement; the unverified Discord channel name is now labelled as such. |
| Sun 4 Oct 2026 (final completeness pass) | Cross-file audit of the seven-file package against the mandate checklist; no new scrape. | Prize row reworded so cash and credits are never shown as one figure; open question on the unseen Devpost submission form added to §12. |

**Re-check before submitting** (ideally on 22 Oct IST and again just before upload):
1. Rules text: re-scrape [/rules](https://amazonappdev2026.devpost.com/rules) and diff the body from the "Official Rules" heading to the support e-mail against `.firecrawl/oct4/evt-rules.md`; note any new banner date (§11.5 says amendments take effect at posting).
2. FAQ count and wording: [/details/faqs](https://amazonappdev2026.devpost.com/details/faqs) had 11 questions on 4 Oct.
3. Updates: [/updates](https://amazonappdev2026.devpost.com/updates) had 7 posts; read anything newer than Update 46771 for deadline, office-hours or requirement changes.
4. Forum answers: re-read [/forum_topics](https://amazonappdev2026.devpost.com/forum_topics) for replies to 45413 (Bee app_id), 45111 (Bee pairing without a Pioneer), 45309 (Ring Playground), and any thread on MCP spec versions or the simulated Alexa+ route.
5. Credit form URL: three URLs still appear (Rules, FAQ, Resources; D4); the request deadline is 21 Oct 12:00 PDT = 22 Oct 00:30 IST. No request is submitted on the user's behalf.
6. Reviewer usernames and e-mail: chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar and testing@devpost.com (Rules §4, FAQ, Overview, Update 46456); invitations expire after 7 days, so send them on submission day.
7. Judging dates: Rules §1 9 Nov–20 Nov 12:00 PT versus the schedule page's 26 Oct start (D1); confirm nothing hosted will lapse before 20 Nov 12:00 PT (21 Nov 01:30 IST).

---

### Rerun inputs
`workflow: firecrawl-deep-research (exhaustive) · topic: hackathon constraints · output: markdown · last refresh: 2026-10-04 02:40 IST · refresh: firecrawl scrape '<event pages>' --max-age 0 -o .firecrawl/<date>/..., then diff body text (nav stripped, counters masked) against the previous dated copies`

# Build, Ship, Shape: Amazon Developer Hackathon 2026 — research and build plan

Research, idea selection and build plans for an entry to [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/), organised by Amazon Developer and run on Devpost.

> **Status as of Sunday 4 October 2026 (IST): research only.** Nothing in this repository has been built, run, tested or submitted. Every hour, latency, cost and score figure is an estimate. Every external fact links to its source in the documents and in the evidence register. Nothing here predicts or promises a result.

---

## Contents

1. [TL;DR](#1-tldr)
2. [Key dates](#2-key-dates-pacific-and-india)
3. [How to use this repository](#3-how-to-use-this-repository)
4. [Repository map](#4-repository-map)
5. [The hackathon on one page](#5-the-hackathon-on-one-page)
6. [The recommendation in detail](#6-the-recommendation-in-detail)
7. [Every idea considered and what happened to it](#7-every-idea-considered-and-what-happened-to-it)
8. [How the research was done](#8-how-the-research-was-done)
9. [Using the evidence register](#9-using-the-evidence-register)
10. [Refreshing or regenerating the research](#10-refreshing-or-regenerating-the-research)
11. [What is not in this repository](#11-what-is-not-in-this-repository)
12. [Limitations and open questions](#12-limitations-and-open-questions)
13. [Disclaimer](#13-disclaimer)

---

## 1. TL;DR

**Build "Across the Room: the far-side check" for the Fire TV track.** It is a React Native for Vega app, demonstrated on the Vega Virtual Device. It serves adults who have been told by a clinician to practise speaking louder at home, plus the family member who listens from across the room. An Android phone lies on a taped mark beside the TV as the microphone, and the user stays on the sofa with only the remote. The TV runs a room-noise check, one calibration phrase, a timed "ahh" and ten household phrases. For each phrase it shows whether the voice reached the listener's end of the room. No audio leaves the phone, and no AI model decides the score.

| Role | Idea | Track | Judge score | After red team | Solo build estimate | When to use it |
|---|---|---|---|---|---|---|
| **Primary** | FTV-4 Across the Room | Fire TV | 3.62 | 3.30 | ≈ 102.5 h of ≈ 104 h | Default |
| Alternative 1 | FTV-3 Mail Check | Fire TV | 3.58 | 3.33 | ≈ 95.5 h | Two-person team, iPhone-only household, or the microphone test fails by Tue 6 Oct |
| Alternative 2 | ALX-5 OutPass | Alexa+ | 3.37 | 3.00 | ≈ 83 h | The Vega toolchain will not run by Wed 7 Oct |
| Fallback | FTV-4F Listener Edition | Fire TV | not scored separately | not red-teamed | ≈ 80% reuse of the primary | The Thu 8 Oct gate finds the phone's loudness readings untrustworthy |

Scores use the team's own analyst model, weighted Tech 25%, Design 20%, Impact 20%, Originality 20% and Feasibility 15%. This is **not** the official rubric, which weights four criteria equally. The primary is not the top scorer on either number. The top judge score, an allergy-safety helper for Alexa+, was killed by the red team. Mail Check edges the primary by 0.03 after the red team, which is noise. See [RECOMMENDATION.md](research/RECOMMENDATION.md) for why the primary still wins for a solo builder.

**Dependency that must work first:** the Vega toolchain on an Apple-silicon Mac, on Mon 5 Oct. That means Rosetta 2, Node 20, Vega SDK 0.24 and a hello-world app in the Vega Virtual Device. The same day, an Android Chrome microphone test must give repeatable loudness readings with automatic gain control off. That test is the assumption that would reverse the choice.

---

## 2. Key dates (Pacific and India)

All conversions use the IANA zone database. October times are PDT (UTC−7) and November–December times are PST (UTC−8), because US daylight saving ends on 1 Nov 2026. India Standard Time is UTC+5:30 all year.

| Event | Pacific | India (IST) |
|---|---|---|
| Office hours #1 | Tue 6 Oct 10:30–11:30 PDT | Tue 6 Oct 23:00 → Wed 7 Oct 00:00 |
| **Abandon gate for the primary** | Thu 8 Oct 07:30 PDT | **Thu 8 Oct 20:00** |
| Scope freeze (core loop recorded in one take) | Wed 14 Oct 07:30 PDT | Wed 14 Oct 20:00 |
| Feature freeze | Sun 18 Oct 23:30 PDT | Mon 19 Oct 12:00 |
| Office hours #2 | Mon 19 Oct 09:00–10:00 PDT | Mon 19 Oct 21:30–22:30 |
| AWS promotional-credit request deadline | Wed 21 Oct 12:00 PDT | Thu 22 Oct 00:30 |
| **Internal submission target** | Thu 22 Oct 07:30 PDT | **Thu 22 Oct 20:00** |
| **Official submission deadline** | **Fri 23 Oct 12:00 PDT** | **Sat 24 Oct 00:30** |
| Judging, per the Official Rules | Mon 9 Nov 12:00 – Fri 20 Nov 12:00 PST | Tue 10 Nov 01:30 – Sat 21 Nov 01:30 |
| Winners announced, on or around | Thu 3 Dec 12:00 PST | Fri 4 Dec 01:30 |

The schedule page says judging starts 26 Oct, but the Official Rules say 9 Nov, and the rules prevail (Rule 11.4). Anything hosted for judges must stay live until 20 Nov.

---

## 3. How to use this repository

| If you want to… | Read this | Then |
|---|---|---|
| Understand the decision in 10 minutes | [research/RECOMMENDATION.md](research/RECOMMENDATION.md) | §5 has day-one checks, kill criteria and the fallback |
| Start building the primary | [research/TOP_THREE_BUILD_SPECS.md](research/TOP_THREE_BUILD_SPECS.md), FTV-4 section | [research/EXECUTION_AND_SUBMISSION.md](research/EXECUTION_AND_SUBMISSION.md) §2 for the day-by-day plan |
| Check a rule, date or submission field | [research/HACKATHON_BRIEF.md](research/HACKATHON_BRIEF.md) | §12 lists discrepancies between official pages; §14 is the re-check list before submitting |
| Pick a different idea or argue with the choice | [research/IDEA_SCORECARD.md](research/IDEA_SCORECARD.md) | [research/TRENDS_AND_RIVALS.md](research/TRENDS_AND_RIVALS.md) for rivals and native Amazon features |
| See the newest ideas and the features added on 4 Oct | [research/LAST30DAYS_IDEAS_AND_FEATURES.md](research/LAST30DAYS_IDEAS_AND_FEATURES.md) | Section 13 of each spec in the build-specs file |
| Find the source behind any claim | [research/EVIDENCE_REGISTER.json](research/EVIDENCE_REGISTER.json) | §9 below shows `jq` queries |
| Record the video or fill the Devpost form | [research/EXECUTION_AND_SUBMISSION.md](research/EXECUTION_AND_SUBMISSION.md) §6–§10 | Storyboard, draft fields, feedback and friction-log templates, requirement checklist |

**Ground rules used throughout:**
- The Official Rules beat FAQs, forum answers and the schedule page.
- Simulated parts are always labelled, and nothing simulated is presented as a live Amazon integration.
- An absent feature is written as "not verified in reviewed sources", never as "the rival does not do this".
- Cash prizes and AWS credits are never added together.

---

## 4. Repository map

### Final artifacts (`research/`)

| File | Lines | What it holds |
|---|---|---|
| [RECOMMENDATION.md](research/RECOMMENDATION.md) | ~280 | The decision: chosen project, why it fits the official criteria, strongest rival, day-one checks, kill criteria, abandon gate, fallback, alternatives, sensitivity, contrarian findings, open questions, limitations |
| [HACKATHON_BRIEF.md](research/HACKATHON_BRIEF.md) | ~280 | Every verified rule: dates in Pacific and IST, eligibility, tracks and required tech, judging and tie-break, prizes, submission fields, AWS credits, gallery status, discrepancies, refresh log |
| [TRENDS_AND_RIVALS.md](research/TRENDS_AND_RIVALS.md) | ~830 | Eight dated trends with sources, a 71-row competitor matrix including Amazon-native features, substitutes, top three ideas versus named rivals, gaps as testable hypotheses, visible hackathon competition |
| [IDEA_SCORECARD.md](research/IDEA_SCORECARD.md) | ~2,760 | All 20 concepts in full, eligibility gates, three judge lenses, red-team verdicts, rankings in four scenarios, final selection, rejection list |
| [TOP_THREE_BUILD_SPECS.md](research/TOP_THREE_BUILD_SPECS.md) | ~2,600 | Build specs for the primary and both alternatives. Each has 13 sections: user stories, paths, screens, architecture, API contract, data, tool design, evaluation plan, AWS design, open-source piece, repo and setup, hours, and the 4 Oct feature additions, plus a track-specific verification block |
| [EXECUTION_AND_SUBMISSION.md](research/EXECUTION_AND_SUBMISSION.md) | ~730 | Deadline arithmetic, day-by-day calendar to 22 Oct, abandon and switch plan, budget worksheet, risk register, 2:48 demo storyboard, draft Devpost fields, product-feedback and friction-log templates, requirement-to-evidence checklist |
| [LAST30DAYS_IDEAS_AND_FEATURES.md](research/LAST30DAYS_IDEAS_AND_FEATURES.md) | ~475 | The 4 Oct `/last30days` pass: coverage, findings, seven new ideas with red-team verdicts, 18 feature proposals and the accepted bundles |
| [EVIDENCE_REGISTER.json](research/EVIDENCE_REGISTER.json) | — | 1,275 claims from 804 sources and 205 recorded searches, each with URL, publisher, source type, dates, excerpt, confidence and limitation |
| [FIRECRAWL_MASTER_PROMPT.md](research/FIRECRAWL_MASTER_PROMPT.md) | ~200 | The original research brief used to drive this work |
| [competitor-findings.md](research/competitor-findings.md) | ~110 | An early competitive scan from 3 Oct, kept for history; superseded by TRENDS_AND_RIVALS.md |

### Working material (`research/_working/`)

| Path | What it holds |
|---|---|
| `event.md`, `firetv.md`, `ring.md`, `bee.md`, `mcp.md`, `aws.md`, `github.md` | Platform and event digests from 3 Oct, with source URLs: requirements matrix, Vega and simulator setup, Ring Partner API and Playground limits, Bee data access, MCP and Alexa+ contract, AWS pricing, GitHub competition |
| `trends_agents.md`, `trends_home.md`, `rivals_home.md`, `rivals_weartv.md` | Trend and rival digests from 3 Oct that feed TRENDS_AND_RIVALS.md |
| `IDEATION_CONTEXT.md`, `time_conversions.md` | Constraints summary used to seed ideation; IST conversions |
| `spec_FTV-4.md`, `spec_FTV-3.md`, `spec_ALX-5.md` | Editable sources of the three build specs; the build-specs file is assembled from them |
| `ideation/` | Raw JSON from both ideation rounds: concepts, gates, judge scores, red teams, final selection. Also the 4 Oct refresh notes (`refresh_oct4.md`) and the generated scorecard body (`scorecard_body.md`). Has its own README |
| `last30days/` | Raw JSON from the eight `/last30days` passes, the idea and feature synthesis, and the red-team verdicts. Also `head.md`, `body.md` and `tail.md`, which joined in that order make LAST30DAYS_IDEAS_AND_FEATURES.md |
| `research_sweep_results.json` | Raw output of the 3 Oct multi-agent research sweep |
| `tools/` | Python scripts that regenerate parts of the artifacts (§10) |

---

## 5. The hackathon on one page

Full detail with sources is in [HACKATHON_BRIEF.md](research/HACKATHON_BRIEF.md).

| Track | Required technology | Accepted demo route | Reality for an India-based solo entrant |
|---|---|---|---|
| **Fire TV** | A demo-ready app on Fire OS or Vega OS, any framework | Real Fire TV device, or the Fire TV/Vega simulator. Exempt from the runtime-hook rule | Fully real is possible. The Vega Virtual Device runs on Apple-silicon Macs once Rosetta is installed. It has no microphone and no documented camera API, so a phone acts as the sensor |
| **Alexa+** | A self-hosted MCP server on spec 2025-11-25 over Streamable HTTP, or an Agent Skill, or a simulated Alexa+ experience | Your own front end or simulator; partner tools are gated | The real Alexa+ developer tools are closed to entrants. Without them, entrants build their own front end or a labelled simulation; this is the most crowded track |
| **Bee** | Data recorded through an actual Bee device or an Apple Watch running Bee, read through its CLI, MCP server or Agent Skill | Live Bee data in the video | Ineligible without the hardware. The Bee Pioneer ships to the US only |
| **Ring** | Any Ring API, SDK, simulator or device in Ring's developer docs | The Ring Developer Playground or a real device | The Playground is the only route from India. It has one simulated doorbell, no motion or button webhooks, and a full-frame motion zone |

**Judging.** Stage 1 is pass/fail on theme fit and use of the required tech. Stage 2 scores four equally weighted criteria from 1 to 5: Tech Implementation, Design, Potential Impact and Quality of the Idea. Ties break on Tech, then Design, then Impact, then Idea. A friction log can earn up to a 10% bonus. Organizers warned that ideas that are just a built-in LLM ability, or an existing Alexa+ feature, score poorly.

**Prizes.** Cash and AWS credits are separate:
- Fire TV and Alexa+: 1st $25,000 cash plus $15,000 credits; 2nd $15,000 plus $5,000; 3rd $4,000 plus $1,000.
- Bee and Ring: 1st $12,000 cash; 2nd $8,000 cash; no credits.
- AWS Builder and Open Source mini challenges: $5,000 cash plus $5,000 credits each.
- A project can win one track prize and one mini-challenge prize.

**Submission.** All of these are required:
- A public GitHub repo with a licence visible in its About section, or a private repo shared with the six reviewer accounts listed in the brief plus `testing@devpost.com`. Invitations expire after seven days.
- A public video under three minutes, in English.
- A text description.
- Product feedback for every tool used.
- Free judge access until judging ends.

---

## 6. The recommendation in detail

**Who it is for.** Adults who have been told to practise speaking louder every day, and the spouse or adult child who shares the living room. Parkinson's is cited only as context. The product makes no medical claim and names no clinical programme.

**Why it was chosen:**
- It is the one concept an India-based solo builder can show fully live on an accepted Amazon environment, with an instant result that cannot be staged.
- No Amazon-native feature, LLM ability or visible entrant does the same job in the sources reviewed.
- It fits the organizer's own Fire TV hint: "a multi modal experience blending voice, D-pad, and visuals".

**Strongest rival.** Loud and Clear, a free phone app with live loudness feedback. Our difference is measuring where the listener sits, on the TV, with only the remote. **That difference is untested:** no rival app was installed and no user has been interviewed.

**Features added on 4 Oct**, from the `/last30days` pass:
- **Felt-versus-reached check.** On three phrases per session the meter is hidden, the speaker rates whether it felt loud, and then both results are revealed.
- **Honest microphone badge.** It shows exactly what the phone microphone is doing at each moment.
- **One-cue listener.** The listener taps Heard or Not heard and has one agreed cue word. The TV counts how often listener and meter agree.

To make room, spoken prompts became on-screen text and the caregiver export became optional.

**Day-one checks for Mon 5 Oct.** No AWS account is needed:
1. Rosetta, Node 20 and Vega SDK 0.24 installed, with the hello-world app running in the simulator.
2. A WebSocket opened from inside the simulator, or a 250 ms long-poll fallback.
3. The audio player playing a bundled file.
4. Remote keys logged, and an animated arc redrawing at 20 times a second.
5. The Android Chrome microphone test.

Kill criteria and the switch routes are in [RECOMMENDATION.md §5](research/RECOMMENDATION.md).

---

## 7. Every idea considered and what happened to it

Full write-ups are in [IDEA_SCORECARD.md](research/IDEA_SCORECARD.md) and [LAST30DAYS_IDEAS_AND_FEATURES.md](research/LAST30DAYS_IDEAS_AND_FEATURES.md).

| Round | Ideas | Outcome |
|---|---|---|
| Round 1, 3 Oct: three per track | FTV-1 Story Night, FTV-2 WordGlow TV, FTV-3 BigPrint (became Mail Check), ALX-1 CarpoolMend, ALX-2 RideBook Access, ALX-3 ClaimTrail, BEE-1 Said & Done, BEE-2 Explain-Back, BEE-3 TriedThat, RNG-1 CurbClock, RNG-2 QuietBell, RNG-3 OnAir | Mail Check survived as an alternative. RideBook was killed because paratransit voice booking already ships. All Bee ideas are ineligible without hardware. The rest ranked lower or were narrowed |
| Round 2, 4 Oct: two per track | FTV-4 Across the Room, FTV-5 Measure by Measure, ALX-4 ClearPlate, ALX-5 OutPass, BEE-4 Hearsay, BEE-5 Asked Again, RNG-4 CamCharter, RNG-5 ZoneSpeak | Across the Room became primary and OutPass an alternative. ClearPlate (top judge score), ZoneSpeak and ClaimTrail were killed by two of three red-team lenses |
| `/last30days` pass, 4 Oct | Pillbox Second Look, Chair Stand Check, Buffer Blame, Vega Pair Kit, Add-on Preflight, Ask First, Ring Receipt | All seven killed: native overlap, existing apps, entrant collisions, missing hardware, or not demonstrable for real |

**Rejected idea types:**
- Generic household assistants.
- Simple transcription or memory on Bee.
- Basic alerts and reminder ladders.
- Streaming clones.
- Thin API wrappers.
- Broad multi-device integrations.
- Rebuilds of native Amazon features.
- LLM-vision features dressed as accessibility.
- Ring demos that depend on fixtures.
- Builds over the solo hour budget.

---

## 8. How the research was done

| Stage | Date | What happened |
|---|---|---|
| Constraints | 3 Oct, re-checked 4 Oct | Every event page was scraped live and diffed. Forum threads, FAQs, updates and resources were read. IST conversions were computed with the zone database |
| Platform research | 3 Oct | Eleven parallel research agents covered the rules, Fire TV and Vega, Alexa+ and MCP, Bee, Ring, AWS, GitHub competition, trends and rivals. Skeptical verifier agents re-checked decision-critical claims |
| Ideation round 1 | 3 Oct | Four track leads produced 12 concepts. An eligibility gate ran, three judge lenses scored them, and four leaders were red-teamed |
| Refresh and round 2 | 4 Oct | Trends, rivals, GitHub counts and platform facts were refreshed. Eight new concepts were added, all 20 were re-scored, six leaders were red-teamed by three lenses each, and the final selection was made |
| Specs and plan | 4 Oct | One writer per spec, each followed by a contract verifier checking every API row against saved official documentation. Writers produced the plan, scorecard and recommendation, and critics fixed each file. A final audit against the original brief followed |
| `/last30days` pass | 4 Oct | Eight topic passes, idea and feature synthesis, a red-team review, and the accepted features integrated into the specs and plan |

**Tools used:**
- The Firecrawl CLI for search, scrape and map.
- Firecrawl's deep-research workflow.
- Firecrawl Alexandria's GitHub repository search provider, which was re-validated on 4 Oct.
- The `/last30days` skill for social and community sources.
- Read-only GitHub API calls.
- Multi-agent workflows with independent judges and adversarial reviewers.

**Labelling conventions:**

| Label | Meaning |
|---|---|
| `(estimate)` | Not measured |
| `(assumption)` | Taken as given, not verified |
| `(inference)` | Reasoned from evidence, not stated by a source |
| `not verified in reviewed sources` | Absence not proven |
| `[unverified]` / `[gated]` in specs | Not confirmed in official docs / not available to entrants |

---

## 9. Using the evidence register

[research/EVIDENCE_REGISTER.json](research/EVIDENCE_REGISTER.json) has four top-level keys: `metadata`, `claims` (1,275), `sources_read` (804) and `searches_run` (205).

Each claim has these fields: `claim_id`, `claim`, `url`, `publisher`, `source_type`, `publication_or_update_date`, `retrieved_at`, `relevant_excerpt_or_section`, `confidence`, `limitation` and `affected_project`. All also carry `verification_status`, and most carry `research_pass`.

The claim-ID prefix shows the research area:

| Prefix | Area |
|---|---|
| `EVT` | Event and rules |
| `FTV` | Fire TV |
| `MCP` | Alexa+ and MCP |
| `RING` | Ring |
| `BEE` | Bee |
| `AWS` | AWS |
| `GH` | GitHub competition |
| `TRDA`, `TRDH` | Trends |
| `RIVH`, `RIVW` | Rivals |
| `VER` | Verifier passes |
| `TRD2`, `RIV2`, `GH2`, `PLT2`, `GATE2`, `EVT4`, `GH4`, `TOOL4` | 4 Oct refresh |
| `FTV2`, `ALX2`, `BEE2`, `RNG2` | Round-2 concept generators |
| `RT2` | Round-2 red team |
| `SPEC*`, `VER*` | Spec writers and verifiers |
| `EXEC1`, `EXEC2`, `REC`, `TRC`, `TRW` | Plan, recommendation and trends writers |
| `MAIN` | Lead session (native Amazon features) |
| `L30D` | `/last30days` findings |

Example queries:

```bash
# Every claim about the submission deadline
jq '.claims[] | select(.claim | test("deadline"; "i")) | {claim_id, claim, url}' research/EVIDENCE_REGISTER.json

# All official-rules claims
jq '.claims[] | select(.source_type == "official_rules") | .claim' research/EVIDENCE_REGISTER.json

# Claims that affect the primary concept
jq '.claims[] | select(.affected_project | test("FTV-4"; "i")) | {claim_id, claim, confidence}' research/EVIDENCE_REGISTER.json

# Count claims by source type
jq '[.claims[].source_type] | group_by(.) | map({type: .[0], n: length})' research/EVIDENCE_REGISTER.json
```

About 59% of claims (753 of 1,275) cite official documentation, rules, event pages, official repos, official blogs or vendor help centres. Competitor claims mostly cite the vendor's own pages, which shows what a vendor says it offers, not measured effectiveness.

---

## 10. Refreshing or regenerating the research

**Re-check the rules before submitting.** Re-scrape the event pages and diff them against the 4 Oct copies; [HACKATHON_BRIEF.md §14](research/HACKATHON_BRIEF.md) lists what to check. The raw page cache is not in this repo (§11), so a fresh clone starts a new cache:

```bash
mkdir -p .firecrawl/$(date +%F)
for p in "" rules details/faqs details/dates updates project-gallery resources forum_topics; do
  n=$(echo "${p:-overview}" | tr '/' '-')
  firecrawl scrape "https://amazonappdev2026.devpost.com/${p}" --max-age 0 -o ".firecrawl/$(date +%F)/evt-${n}.md"
done
```

**Regenerate files from their sources.** These scripts need Python 3 only and live in `research/_working/tools/`:

```bash
# Rebuild TOP_THREE_BUILD_SPECS.md after editing research/_working/spec_*.md
python3 research/_working/tools/assemble_specs.py

# Re-render IDEA_SCORECARD.md sections 2–4 from research/_working/ideation/*.json
# (writes research/_working/ideation/scorecard_body.md, which starts with the
#  "GENERATED BODY" marker; paste it over everything from that marker up to
#  "## 5. Hard selection")
python3 research/_working/tools/gen_scorecard_body.py

# Re-render sections 3–7 of LAST30DAYS_IDEAS_AND_FEATURES.md from research/_working/last30days/*.json
# (writes research/_working/last30days/body.md; the published file is head.md + body.md + tail.md)
python3 research/_working/tools/gen_last30days_body.py
cat research/_working/last30days/{head,body,tail}.md > research/LAST30DAYS_IDEAS_AND_FEATURES.md

# Merge new claim arrays into the evidence register (de-duplicates by URL and claim text)
python3 research/_working/tools/merge_evidence.py research/EVIDENCE_REGISTER.json new_claims.json
```

---

## 11. What is not in this repository

- **The raw page cache (`.firecrawl/`, about 880 files).** These are full copies of third-party web pages: official docs, vendor sites, news, forum threads and GitHub READMEs. They are left out for copyright and size reasons. The documents still cite those paths, such as `.firecrawl/oct4/evt-rules.md`, so a reader can see what was read. Every claim also carries its live URL.
- **Raw `/last30days` output,** saved locally under `~/Documents/Last30Days/`. The structured results are in `research/_working/last30days/`.
- **Session transcripts and scratch files** from the research sessions. References to them appear as `<session-scratchpad>` or `<scratchpad>`.
- **Two superseded drafts** of the execution plan (`exec_part1.md`, `exec_part2.md`), replaced by EXECUTION_AND_SUBMISSION.md.

---

## 12. Limitations and open questions

**Limitations:**
- **Competition is a lower bound.** The Devpost project gallery is unpublished and private repos are invisible, so visible competition counts come only from public GitHub searches. The participant counter, 35,590 on 4 Oct, counts registrations, not submissions.
- **Forum answers are not rules.** Answers from Amazon developer relations and Devpost clarify the rules but do not amend them.
- **Scores and hours are estimates.** All scores come from model judges and red-team reviewers. All hour, latency and cost figures are unmeasured.
- **No user validation yet.** No user interviews, clinician conversations or rival-app installs have been done.
- **Social coverage was thin.** The `/last30days` pass could not reach Reddit, because its paid provider returned "402 Payment Required", or X, because no session was logged in.
- **Some sources were not read.** Discord, Reddit bodies and the logged-in Devpost submission form were never viewed.

**Open questions:**
- Is an Android phone available to the builder?
- How many focused hours a day are realistic? The plan assumes 6.5.
- Does a WebSocket open from inside the Vega Virtual Device?
- Which of the three AWS credit-form links is the right one?
- Does the India-sold Fire TV Stick 4K Select receive Vega OS 1.2?
- What fields does the live Devpost form ask for?

---

## 13. Disclaimer

This is independent research for a hackathon entry. It is not affiliated with or endorsed by Amazon, Devpost or any company named here. Product names and trademarks belong to their owners. Rival descriptions reflect each vendor's public pages as read on the stated dates. The research makes no medical claims: the voice-practice concept is a practice aid, not a medical device.

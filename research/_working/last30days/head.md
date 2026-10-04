# Last-30-days research: new hackathon ideas and feature additions

**Written:** Sunday 4 October 2026 (Asia/Kolkata). **Window searched:** 4 Sep – 4 Oct 2026, with older material labelled where agents used it.
**Method:** the `/last30days` skill (v2.9.6) was run on eight topic angles in parallel, each followed by two web searches and page reads. Two agents then turned the findings into new ideas and feature proposals, and one adversarial agent reviewed both against the rules, the rival matrix, Amazon-native features, visible entrants and the remaining hours.
**Status:** research only. Nothing has been built. All hours and scores are unmeasured estimates by model reviewers, not win predictions.
**Companion files:** [RECOMMENDATION.md](RECOMMENDATION.md), [TOP_THREE_BUILD_SPECS.md](TOP_THREE_BUILD_SPECS.md) (each spec now has a §13 with the accepted features), [EXECUTION_AND_SUBMISSION.md](EXECUTION_AND_SUBMISSION.md), [IDEA_SCORECARD.md](IDEA_SCORECARD.md). Raw JSON: [`_working/last30days/`](_working/last30days/); raw skill output: `~/Documents/Last30Days/` (outside the project).

## Bottom line

- **No new idea beats the current primary.** Seven new ideas were generated from the research; the red team killed all seven. The best two, a TV-guided chair-stand strength test and a TV check of a weekly pill organizer, scored about 2.78 and 2.73 after review against the primary's 3.30 (estimates). The pill idea collides with Amazon's own PillPack, and an existing app already auto-counts the chair-stand test.
- **The useful output is features.** Fourteen of eighteen proposed features were accepted as core or stretch; four were deferred or rejected. The accepted core additions are listed below and are now written into each spec's §13.
- **Social demand data was thin.** The research tool's Reddit access failed with "402 Payment Required" on every pass, X was not logged in, and TikTok, Instagram and Polymarket returned nothing relevant (§1). Treat the evidence as organizer guidance, entrant demos, clinical and assistive-technology pages, and app reviews, not as a 30-day consumer trend.

| Concept | Core features added | Added hours (estimate) | Paid for by |
|---|---|---|---|
| FTV-4 Across the Room (primary) | Felt-versus-reached check on 3 blind phrases per session; honest mic-state badge; one-cue listener with a meter-versus-listener agreement count | +8.5 | Polly prompts become text-only (−2 h); caregiver export moves to stretch (−2 h). Core ≈ 102.5 of ≈ 104 h |
| FTV-3 Mail Check | A reason on every "Not sure" plus a provenance stamp on every crop; truthful delete wording and the AWS AI-services opt-out | +3.5 | Nothing; core ≈ 95.5 h |
| ALX-5 OutPass | Approval only from the parent's tap (model cannot call it) with a false-approval test scene; automated conformance probe in CI | +5 | Nothing; core ≈ 83 h |
| FTV-4F Listener Edition (fallback) | Independent two-sided check (speaker rating and listener verdict revealed together); one-cue listener shared with FTV-4 | +6 | Applies only if the Thu 8 Oct gate selects the fallback |

## 1. What the research could and could not see

| Source | Result across the eight passes |
|---|---|
| Reddit | **Failed on every pass:** the skill's paid Reddit provider returned "402 Payment Required" (no credits). No Reddit threads or comments were collected. |
| X / Twitter | Not available: no logged-in X session on this machine. |
| YouTube | 35 videos kept across passes, 11 with transcripts. Many were outside the window or off-topic; the in-window, on-topic items were mostly low-view hackathon entrant demos (1–63 views) and a few Vega OS news videos. |
| TikTok, Instagram, Polymarket | Nothing relevant returned. |
| Hacker News | Nothing in the window; one older thread on Wait Until 8th (Oct 2024) was read as context. |
| Web | Roughly 60 pages read through web search and page fetches: organizer Devpost updates, Vega OS coverage, MCP Apps writing, clinical and speech-therapy guidance, assistive-technology roundups, phone-free-kids coverage, Ring and Bee docs. |

**What this means:** the passes can show what the organizer hints, what other entrants are building, and what clinicians, reviewers and vendors say. They cannot show what consumers posted in the last 30 days. Ideas or features justified by "people are asking for this right now" are not supported by this pass.

## 2. What I learned

**The organizer's hints match the selected Fire TV concepts.** The Devpost update "Got an idea?" asks Fire TV entrants to go past a simple video player toward computer vision with a camera or "a multi modal experience blending voice, D-pad, and visuals"; the far-side check and Mail Check both fit that wording ([Devpost update 46456](https://amazonappdev2026.devpost.com/updates/46456-got-an-idea)). For Alexa+ it asks for agentic workflows that keep context across sessions, which OutPass's pass ladder does.

**Approval gates, evidence and conformance counts are now table stakes for Alexa+ entrants.** Seven of the nine entrant demos found on YouTube are Alexa+ MCP servers running on simulated clients. They advertise approval gates, evidence kept next to claims, "Cannot verify" states and conformance or test counts (for example the Commitment Brief and Recall demos, and an LQA demo showing 23/23 conformance checks). OutPass has to match this baseline and win on its structure: conditions, a timed ladder and a third party.

**MCP Apps writing points to app-only tools for risky writes.** A Scott Logic post (16 Sep 2026) describes limiting a tool's visibility to the app so the model cannot call it while a human tap can ([Scott Logic](https://blog.scottlogic.com/2026/09/16/mcp-apps-your-ui-their-chat.html)). That became the accepted OutPass feature: only the parent's Confirm button can approve a pass.

**Vega OS has a real utility gap, but it rewards ports.** Coverage of the new Fire TV Stick 4K (launched about 30 Sep 2026) centres on Vega OS blocking sideloading; reviewers could not install speed-test or system-info tools (for example a Triple M video from 2 Oct with about 13,000 views, plus AFTVNews and XDA Developers). That supports a utility port, which the rules treat as the obvious end of the Fire TV track, so it did not become the recommendation.

**Voice-practice guidance supports the far-side thesis and shapes the listener mode.** A speech therapist's App Store review of an incumbent app says its loudness target is wrong for the real distance between speaker and microphone, which is the gap the far-side check targets. Clinic guidance describes the core problem as a gap between how loud speech feels and how audible it is, and asks families to use one agreed cue word instead of repeated corrections ([Breatheworks](https://breatheworks.com/parkinsons-speech-therapy-lsvt-loud-speak-out/)). A 2025 app study says it could not measure carryover into real conversation ([JMIR via PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11888063/)). These led to the felt-versus-reached check and the one-cue listener.

**Low-vision guidance supports evidence and uncertainty over answers.** A 2026 assistive-tech roundup says AI description tools sometimes describe things that are not there and that financial and medication documents should be checked with a human or a trusted non-AI channel ([Disability World](https://www.disabilityworld.org/articles/assistive-tech-for-blind-people-2026/)); volunteer services advise against having volunteers read financial mail. That led to a stated reason on every "Not sure" and a provenance line on every crop.

**Phone-free-kids coverage supports a shared household device and shows the objections.** Parents form neighbourhood "pods" around landline-style kid phones, and the main pain is coordination load ([CPR News, Feb 2026](https://www.cpr.org/2026/02/04/tin-can-kids-landline-cellphone-alternative/)); kid-phone products use approved contacts, active hours and logs ([The Everymom](https://theeverymom.com/tin-can-phone-review/)). Objections centre on changing plans and working parents. That led to the stretch features "change an active pass" and "pass hours".

**Ring and Bee coverage confirmed the earlier verdict.** No community data came back for either. Ring's 2026 changelog keeps tightening partner access to video, and Bee reviewers raise always-on-microphone and speaker-attribution concerns. Neither changes the conclusion that both tracks are a poor fit for this developer.


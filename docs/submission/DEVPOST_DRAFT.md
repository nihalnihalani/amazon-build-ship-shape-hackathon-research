# Devpost draft: Across the Room: the far-side check

**PREPARED, NOT SUBMITTED.** Nothing in this file has been sent to Devpost or anywhere else. Every external action (publishing the repository, uploading the video, filling the form, accepting attestations) needs the owner's authorization (B-005).

How this draft was made: the Devpost submission form sits behind a login and was **not viewed** by anyone on this team. The field list below is inferred from the Official Rules summary in `docs/SOURCES.md` (section 1) and the requirements table in `research/HACKATHON_BRIEF.md` (section 8). Re-read the Official Rules (https://amazonappdev2026.devpost.com/rules) on the day of submission: they prevail over the FAQ, forum answers and the Dates tab, and the page states no version or date. Deadline: **Friday 2026-10-23 12:00 Pacific = 2026-10-24 00:30 IST**. Internal target: 2026-10-22 20:00 IST.

Status legend: **READY** text prepared from verified material; **OWNER** needs an owner decision, account action or authorization; **BLOCKED(B-n)** cannot be completed until blocker n is cleared (`.build/blockers.md`).

## Field checklist

| Field (inferred) | Status | Source or reason |
|---|---|---|
| Project name | READY | below |
| Elevator pitch / tagline | READY | below |
| Track | READY (choice) / OWNER (confirm) | Fire TV. One project can win one track prize and one mini-challenge prize (Rules section 8) |
| Mini challenges | AWS Builder: BLOCKED(B-003). Open Source: OWNER | `TRACK_AND_CHALLENGES.md` |
| Text description: what it does and how it works | READY | below |
| Built with | READY | below |
| Repository URL (GitHub only) | BLOCKED(B-005), OWNER | public with a detectable licence file, or private shared with the named reviewers: `JUDGE_ACCESS.md` |
| Setup and test instructions in the repository | READY (needs the owner to adopt the proposed README) | `docs/SETUP.md`, `docs/TESTING.md`, `docs/release/README.proposed.md` |
| Demo video URL (public, YouTube or Vimeo, English, under 3:00) | BLOCKED(B-001), BLOCKED(B-005) | storyboard only: `VIDEO_STORYBOARD.md` |
| Fire TV demo environment | BLOCKED(B-001) | the Vega Virtual Device (caption it as such) or a Fire TV; nothing has run on either |
| Product feedback, one entry per tool, API or SDK used | READY draft, OWNER to confirm the opinions | `FEEDBACK.md` |
| AWS services used and how (inside the product feedback answer) | BLOCKED(B-003) | no AWS service has been used by a running system |
| Open Source fields (contribution URL, project repo URL, GitHub username, what/how/why) | OWNER | requires a separate public repository |
| Existing-project explanation: what was built or changed during the window | READY | `WORK_IN_WINDOW.md` |
| Friction log (optional; the Rules say Amazon may pass a recommended bonus of up to 10%) | READY draft, genuine entries only | `FRICTION_LOG.md` |
| Feature requests (optional; description, why it matters, priority) | READY draft | below |
| Judge access instructions and credentials | READY plan, OWNER to authorize | `JUDGE_ACCESS.md` |
| Images, thumbnail, team members, registration email | OWNER | not prepared |
| Attestations and terms on the form | OWNER | never accepted on the owner's behalf |

## Project name

Across the Room: the far-side check

## Elevator pitch (about 200 characters)

Practise speaking from the sofa: a phone beside the TV listens, the TV shows whether your voice reached today's own relative level band, and a household listener can answer. Audio never leaves the phone.

## Track

Fire TV (Vega OS, React Native for Vega). Intended demo environment: the Vega Virtual Device, captioned as such. **No VVD or Fire TV run exists yet (B-001).** Without it the Fire TV requirement is not met.

## Description (text for the form)

> **Not a medical device. Does not diagnose or treat any condition.** Across the Room measures a *relative digital level* at a phone microphone. It is not dB SPL, audibility, intelligibility or comprehension, and it makes no clinical or efficacy claim.
>
> **What it does.** Someone practising speaking aloud at home (for example, following a plan from their clinician) sits where they normally sit, 2.5 to 3 metres from a stationary Android phone placed beside the TV. The TV is the display and the remote runs the whole session. The phone turns sound into numbers locally and sends only numbers: the audio never leaves the phone and is never recorded, saved or uploaded. The TV runs a five-second quiet-room check, a calibration phrase that sets today's relative band for this room, this phone and this spot, an optional timed sustained sound, and ten household phrases. For each valid window it draws a large relative-level arc and then says whether the voice reached today's band. Phrase positions 3, 6 and 9 are blind checks: the TV shows no arc, colour or announcement until the speaker has rated how it felt, then reveals the result. A household listener can use the same phone between windows to tap Heard / Not heard and send one agreed cue word (at most three per session); agreement is reported with its denominator and split into blind and visible attempts. Invalid, cancelled, noisy, clipped, interrupted or stale windows are never scored. Levels are per session only: there is no cross-day loudness comparison and no automatic target increase.
>
> **How it works.** The TV app is React Native for Vega. The phone is a plain static page that analyses microphone samples in an AudioWorklet (50 ms frames, relative dBFS, hysteresis voice activity). They talk through a WSS relay: one shared core with a local Node adapter and an AWS adapter (API Gateway WebSocket, Lambda, DynamoDB, SQS, S3 and CloudFront). Pairing needs two human checks: the TV owner picks the number the phone shows, then the phone owner confirms they did. Credentials rotate on every reconnect and a reused credential revokes that role. The TV owns practice state and stored summaries; the relay validates and forwards messages and stores only room and connection metadata. The wire protocol is versioned and validated by one package shared by TV, phone and relay.
>
> **How we tested it, and what that does not show.** The repository has more than 4,100 automated unit and integration tests (and a 113-test independent security gate that passed with residuals) plus end-to-end journeys (pairing, calibration, ten phrases with blind checks, listener, summary) and fault-injection scenarios, and an accessibility gate on a web preview of the TV UI. All of it uses synthetic audio in desktop Chrome, a headless TV core or fakes. **The TV app has not been run on a Vega Virtual Device or a Fire TV, no physical phone microphone has been measured, and no AWS stack exists.** Every threshold is a product assumption until a device experiment is run; the first version of its protocol was rejected by the independent security review and a revised one is in progress. A table of what is measured, what is fixture and what is pending is in the repository (`docs/LIMITATIONS.md`).

(Counts: protocol 921, DSP 450, ten-foot meter 49, session core 378, relay 1,113, phone 459, review 163 and TV jest 646 sum to 4,179, plus 4 + 8 end-to-end journeys, 59 web-preview checks and a 113-test security gate: see `docs/TESTING.md`. Update the figure if the suites change.)

## Built with

React Native for Vega (RN 0.83.0, React 19.2.0), TypeScript, Vite, Web Audio API (AudioWorklet), WebSocket (WSS), Node.js, `ws`, AWS SAM and CloudFormation (API Gateway WebSocket, Lambda, DynamoDB, SQS, S3, CloudFront, SSM, CloudWatch: **template only, nothing deployed**), Vitest, Jest, Playwright (`playwright-core`) with system Chrome, axe-core, CycloneDX, Mermaid. Built with Claude Code (Claude Opus 5.5 lead with Claude Sonnet 5.5 teammates); see `WORK_IN_WINDOW.md`. **OWNER:** decide how to disclose AI-assisted development on the form.

## Accomplishments and challenges (draft, honest)

- A complete, tested session logic and protocol whose hidden-meter checks were differential-tested: a run with levels at -140 dBFS versus +20 dBFS (opposite verdicts) produced identical pre-reveal views and TV-to-phone traffic (EV-0027).
- An independent review that found and fixed real defects before any demo, including a pairing flaw (a hostile QR code could point a phone at an attacker's relay), addressed by a phone-side confirmation step and number matching on the TV, and seven integration defects (DEF-001 to DEF-007) found by the end-to-end and fault-injection suites.
- Challenges that are still open: the Vega SDK could not be installed on the build host (Rosetta 2 is absent on macOS 27), so the TV app has never run natively; the physical microphone experiment has not run (its protocol revision 2 was rejected by the security review; revision 3 is in progress); the dependency audit for the TV app reports 70 findings in vendor build tooling (none in the shipped bundle), recorded as a documented exception rather than fixed (see `docs/release/SUPPLY_CHAIN.md`).

## What we learned (draft)

Level-based voice activity cannot tell a voice from a cough or a fan surge, so the design reports relative levels with explicit limits rather than claiming speech understanding; and a "relay never inspects payloads" privacy claim is incompatible with schema validation, so the copy says what is sent and that the relay is not end-to-end encrypted.

## What's next (draft)

Install the Vega SDK and run the remote-only journey on a Vega Virtual Device; finish the revised qualification protocol, get it re-approved and run it on a physical Android phone, recording the result either way; fix the AWS topology gap found by the security gate before any staging deployment; deploy the relay to an authorized staging account and run the operations rehearsals; run the physical Fire TV checks.

## Feature requests (optional field)

| Feature request | Why it matters | Priority |
|---|---|---|
| Declare the exact manifest privileges needed for `fetch` and `WebSocket` on the networking page for RN 0.83 for Vega | We could not verify what a WSS client needs; the official sample declares a privilege this app omits (`FRICTION_LOG.md` F-05) | Important |
| Ship a native arm64 toolchain, or make the installer detect a missing Rosetta 2 before it starts | The SDK cannot be installed on macOS 27 hosts until Rosetta is reinstalled by the user (F-01) | Critical for affected hosts |
| Align source-file headers in the official samples with their `LICENSE` file | The repositories are MIT-0 but the files say "PROPRIETARY/CONFIDENTIAL" (F-03) | Important |
| Declare `buffer` as a dependency of `@amazon-devices/react-native-svg`, or move the CLI tooling out of the runtime dependency list | The bundle imports an undeclared package; `npm audit` reports 70 production findings that sit in tooling (F-10, F-11) | Nice-to-have |

## Product feedback, AWS Builder and Open Source answers

Product feedback: `FEEDBACK.md` (per tool, API or SDK actually used). AWS Builder: **BLOCKED(B-003)**, see `TRACK_AND_CHALLENGES.md`. Open Source: **OWNER**, same file. Friction log: `FRICTION_LOG.md`. Existing-project explanation: `WORK_IN_WINDOW.md`. Judge access: `JUDGE_ACCESS.md`.

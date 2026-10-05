<!--
PROPOSED judge-facing README. The repository owner decides whether to adopt it as the root README.md.
Written by the release-docs role from the repository at commit 63af0ae. It was NOT applied to README.md
(that file holds the owner's own research README and an uncommitted edit).
Facts here come from docs/ and .build/. Re-check the status block and the counts before adopting.
Links are relative to the repository root, where this file would live as README.md.
-->

# Across the Room: the far-side check

A Fire TV (Vega OS) practice display for speaking aloud from the sofa, with an ordinary phone placed beside the TV as the microphone. The TV runs the whole session from the remote. The phone turns sound into numbers locally and sends only numbers. **The audio never leaves the phone.**

> **Not a medical device. Does not diagnose or treat any condition.** The number is a *relative digital level* at a phone microphone, compared with the room's quiet floor measured minutes earlier. It is not dB SPL, audibility, intelligibility, comprehension, voice identity or a clinical outcome, and nothing here claims any benefit.

**Honest status in one paragraph.** The software is built and heavily tested with automated checks, but it has **never been run on a Vega Virtual Device, a Fire TV, a physical phone or AWS**: the build host has no Vega SDK (Rosetta 2 is absent on macOS 27), no Android phone, no AWS spend authorization and no Fire TV. Every end-to-end result below uses synthetic audio in desktop Chrome and a headless TV core. Nothing has been published. See [Status](#status) and [What is real and what is simulated](#what-is-real-and-what-is-simulated).

## What it is

**Thesis.** Practising at the far side of a room is different from practising next to a meter. Someone who has been asked to speak up at home (for example, following a plan from their clinician) needs a way to see, from where they actually sit, whether their voice reached their *own* level band today, and a household listener's honest answer next to it. This project puts the display on the TV, the microphone at the TV's side of the room, and the control in the remote.

**User.** One speaker, 2.5 to 3 metres from a stationary Android phone beside the TV, and optionally one household listener who answers on the same phone between measurement windows.

**Journey.**

1. The TV explains positioning and shows a code and QR. The phone opens the link (the code travels in the URL fragment, never to a server) and the owner taps Join. The TV shows three numbers; the owner picks the one the phone shows, then confirms on the phone that they did. Pairing takes two human checks and cannot be completed by guessing a code.
2. The phone owner starts the microphone with an explicit tap; the TV shows the microphone's true state ("Phone state unknown", never "Mic off", when the link drops).
3. A five-second quiet-room check sets the floor; a short calibration phrase sets *today's* band for this room, this phone and this spot. A bounded sustained-vowel window (up to 30 seconds) is optional.
4. Ten household phrases, typed on the phone beforehand, advance with OK. During each valid window the TV draws a large relative-level arc.
5. Phrase positions 3, 6 and 9 are **blind checks**: no arc, no colour, no announcement, nothing on the phone. The speaker rates how it felt, then the result is revealed. Only first attempts count as blind.
6. Optionally the listener taps Heard / Not heard, and may send one agreed cue word (at most three per session) between windows. Agreement is reported with its denominator, split into blind and visible attempts.
7. A summary and a seven-day history of counts. Invalid, cancelled, noisy, clipped, interrupted or stale windows are never scored. There is no cross-day loudness comparison and no automatic target increase.

## What is real and what is simulated

| Part | What exists | How it was exercised | What was **not** done |
|---|---|---|---|
| Wire protocol (`@atr/protocol`) | Real, 37 message types, one validator shared by TV, phone and relay | 921 automated tests | Hermes (Vega runtime) |
| Phone DSP (`@atr/phone-mic-meter`) | Real code: 50 ms frames, relative dBFS, floor, hysteresis voice activity, window summaries | 450 automated tests; an independent Python oracle reproduces every hand-derived fixture | **No physical microphone has ever been measured.** The qualification experiment is frozen but not run |
| Phone page (`apps/phone`) | Real | 459 unit tests; real headless Chrome scripts with **synthetic or stubbed audio** | A physical phone, Android Chrome, a real permission prompt |
| Relay, local | Real; runs on this Mac over HTTPS and WSS | 1,113 tests including a real local server | A LAN, a phone, the internet |
| Relay, AWS | Code and an infrastructure template exist and lint cleanly | Tests against fakes and a strict in-memory DynamoDB model | **No AWS stack exists** |
| TV session logic (`@atr/session-core`) | Real, the TV's authoritative state machine and verdict maths | 371 tests plus an independent 163-test review suite | A device |
| TV app (`apps/tv`) | Real React Native for Vega code | Typechecks against the published `@amazon-devices` types; 639 jest tests with **mocked** native modules; a JavaScript bundle for platform `kepler` builds | **No native build, no Vega Virtual Device, no Fire TV** |
| Complete session | Headless TV core over WSS to the real local relay, phone page in desktop Chrome with synthetic audio | 4 of 4 automated journeys (pairing, calibration, 10 phrases, blind checks, listener, summary equals hand-derived values); 8 of 8 fault scenarios | A phone-to-TV demonstration |
| Accessibility | A web preview of the TV UI in desktop Chrome | 59 of 59 checks, axe-core with no serious or critical findings | **Not VoiceView, not the Vega focus engine, not Vega's UI-scale setting** |

Every number in the product is a **product assumption** until the physical-phone experiment runs. The full table, the residual DSP limits (burst phase dependence; false activity in the noisiest rooms) and every pending external check are in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Quick start

Verified from a clean clone at `63af0ae` on macOS with Node 24.11.1 (root) and Node 22.23.2 (`apps/tv`). Details, versions and what could not be run: [docs/SETUP.md](docs/SETUP.md).

```sh
npm ci
npm run build && npm run typecheck && npm test              # 7 workspaces, all pass

# local relay + phone page (HTTPS is required for the microphone)
scripts/dev-certs/make-dev-certs.sh <your-LAN-IP>           # local CA + server certificate in certs/
npm run start:local -w @atr/relay                           # https://0.0.0.0:8443, phone page at /

# TV app logic, typecheck, and a JS bundle (no Vega SDK needed; NOT a native build)
cd apps/tv && npm ci && npm run build:packages && npx tsc --noEmit && npx jest && npm run check:bundle
```

`http://<LAN-IP>` is never a valid microphone origin. A physical phone must trust the generated CA, or use an HTTPS tunnel. The Vega app itself needs the Vega SDK, which needs an owner action to install (see SETUP.md section 9).

## Architecture

TV (React Native for Vega) and phone (static page) talk through a WSS relay with one shared core and two adapters: local Node and AWS (API Gateway WebSocket, Lambda, DynamoDB, SQS, S3 and CloudFront). The TV owns practice state, verdicts and stored summaries; the phone owns audio and sends numbers; the relay validates and forwards and stores only room and connection metadata. Diagrams (components, one phrase attempt, pairing with number matching and phone confirmation, trust boundaries, AWS shape) and where each of the nine ADRs applies: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Wire format: [docs/PROTOCOL.md](docs/PROTOCOL.md). What is measured: [docs/MEASUREMENT.md](docs/MEASUREMENT.md).

## Privacy

Audio stays on the phone and is never saved or uploaded; there is no recording, speech recognition or AI scoring. The phone sends sound levels and when you are speaking, typed phrases, listener responses, phone status and connection details to the relay and TV. The relay is **not** end-to-end encrypted. The TV stores practice summaries unencrypted for 8 days and the phrase bank until deleted, and can delete everything. Exact categories, storage, logs, retention and deletion: [docs/PRIVACY.md](docs/PRIVACY.md).

## Testing

All suites, commands, environment variables and observed counts: [docs/TESTING.md](docs/TESTING.md). Headline results from the clean-clone run: protocol 921, DSP 450, ten-foot meter 49, session core 371, relay 1,113, phone 459, independent review 163, TV jest 639, local journey 4 of 4, fault recovery 8 of 8, accessibility web preview 59 of 59. One phone script (`e2e:production`) failed on this host because headless Chrome rejects a real `getUserMedia` call immediately instead of leaving it pending, as that script assumes; this is recorded in TESTING.md and LIMITATIONS.md rather than hidden. **All of these are automated or web-preview results. None is a real phone, VVD or Fire TV result.**

## Limitations (short)

No Vega build or run; no physical microphone measurement; no AWS stack; per-session relative levels only; the unqualified-phone label on every band result until the frozen qualification experiment passes on a real phone; level-based voice activity can mistake coughs, music or other speakers for speech; the TV's local storage is unencrypted; WSS to a locally generated certificate from the Vega runtime is untested. Details and the supply-chain status (including a recorded dependency-audit exception for `apps/tv` build tooling, none of which is in the shipped bundle): [docs/LIMITATIONS.md](docs/LIMITATIONS.md), [docs/release/SUPPLY_CHAIN.md](docs/release/SUPPLY_CHAIN.md).

## Licence

MIT: see [LICENSE](LICENSE). Third-party components and their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [docs/release/LICENSES.md](docs/release/LICENSES.md). The `@amazon-devices/*` packages the TV app depends on are **not** open source: they are licensed by Amazon under the Program Materials License Agreement and are installed from the npm registry, not copied into this repository.

## Status

From `.build/release-status.json` (updated 2026-10-05; the four readiness fields are separate and each is true only when its gate's evidence exists):

| Field | Value | Reason recorded |
|---|---|---|
| `engineering_release_candidate` | **false** | Implementation in progress |
| `hackathon_ready` | **false** | No native Vega build (B-001); no physical phone evidence (B-002) |
| `public_production_ready` | **false** | Requires physical Fire TV (B-004), hosted ops evidence (B-003) and distribution requirements |
| `public_production_launched` | **false** | Requires owner authorization (B-005) after readiness |

What would flip each field, and the current blockers, is in [docs/release/RELEASE_STATUS.md](docs/release/RELEASE_STATUS.md). The hackathon package (a Devpost draft, the video storyboard, product feedback, a friction log, the judge-access plan and a checklist) is **prepared and has not been sent anywhere**: [docs/submission/](docs/submission/).

# Video storyboard

**PREPARED, NOT RECORDED, NOT UPLOADED.** Rules as read on 2026-10-05 (`docs/SOURCES.md` section 1): public on YouTube or Vimeo, **under three minutes** (judges need not watch past 3:00), English or with an English translation, showing the project working on the device it was built for. For Fire TV that means an actual Fire TV device **or the Fire TV/Vega simulator**; a VVD demo must be captioned as such. No unlicensed third-party trademarks or copyrighted music or footage. Uploading and publishing need the owner's authorization (B-005).

**The hard truth for this storyboard.** The required Fire TV demo cannot be filmed today: the app has never run on a Vega Virtual Device or a Fire TV (B-001), and no physical phone has been used (B-002). Everything in the first list below can be filmed now, but **a video made only from those shots does not meet the Fire TV requirement and must not be published as the demo**. The second list is what must be filmed once B-001 (and, for the real microphone path, B-002) clear. Captions must say exactly what each shot is.

Target length: **2:45** (hard limit 3:00). No music. Voice: the owner's own voice; if a text-to-speech voice is used its licence must be recorded (the project uses no speech service). Use platform names as text only (no logos), show no third-party footage, and say "a code you scan" rather than using the registered trademark name on screen.

## A. Filmable now (none of this is the required Fire TV demo)

| ID | Shot | Source and how to film | Caption (honest, exact) |
|---|---|---|---|
| N1 | Title card with the product name and the disclaimer | A static slide | "Not a medical device. Does not diagnose or treat any condition." |
| N2 | The idea in one diagram: TV, phone, relay; audio never leaves the phone | `docs/ARCHITECTURE.md` component diagram rendered to an image | "Dashed boxes have not been run: the TV app has not been run on Vega; no AWS stack exists." |
| N3 | The local relay starting and answering its health check, with the security headers | Terminal: `npm run start:local -w @atr/relay`, then `curl --cacert certs/ca.crt https://localhost:8443/healthz` and `curl -sI ...` (verified commands, `docs/SETUP.md` section 4) | "Local relay on a Mac over HTTPS and WSS" |
| N4 | The phone page: join screen, "On your TV, pick 47", then "Did you just pick 47 on your TV?" | Desktop Chrome on the phone **test build** (`npm run build:test -w @atr/phone`), served by the local relay; the page shows its own "synthetic test audio" banner. The TV side must be the headless TV driver of the end-to-end suite (`tests/src/tv-driver.ts`) or the web preview wired to the same relay: **no ready-made headed harness exists yet**, so a small script that runs the journey in a visible Chrome window has to be written before this can be recorded. | "Phone page in desktop Chrome with synthetic test audio. Not a phone." |
| N5 | The TV interface walking through the journey: pairing with three number choices, quiet check, calibration, a visible phrase with the arc, a blind phrase with no arc, the felt-loud rating, the reveal, the summary, the history | `cd apps/tv/web && npx vite`, open `?mode=store` (real session store, in-memory data) driven by the keyboard (arrows, Enter, Escape). The phone side is the scripted phone of the accessibility suite (`tests/a11y/scripted-phone.ts`, attached by Playwright), so record while that suite runs in a visible window, or write a small harness; without a phone the pairing screen just waits. The banner "Web preview — not Vega" is part of the page and must stay in frame. | "TV interface in a web preview in desktop Chrome. Not Vega. Scripted phone, synthetic audio." |
| N6 | The automated journey passing | Terminal: `cd tests && npx vitest run --config vitest.e2e.config.ts e2e/local-journey.test.ts` (about 108 s: film the start and the result line "4 passed") | "Automated test: headless TV core, local relay, synthetic audio in desktop Chrome. Loopback only." |
| N7 | Fault recovery: the eight scenarios listed as passing | Terminal: the `fault-recovery` test list | "Automated fault injection: link loss, 300 ms latency, duplicated frames, hidden page, noisy room." |
| N8 | The same TV screen at the default and at a large UI scale | Web preview with `?scale=1.0` and `?scale=2.0`, footer visible in both | "Web preview with a simulated UI scale. Not Vega's UI-scale setting. Not VoiceView." |
| N9 | What leaves the phone, in one table | `docs/PRIVACY.md` section 2 as a slide, with the exact amended sentence | "Audio stays on this phone and is never saved or uploaded." (the exact copy, `apps/phone/src/config.ts`) |
| N10 | The honest table: measured, fixture, pending | `docs/LIMITATIONS.md` section 2 as a slide | "Automated and web-preview results only. No Vega run, no physical microphone measurement, no AWS stack." |

## B. Needs a Vega Virtual Device or a physical phone (the required demo)

| ID | Shot | Needs | Caption (only once true) |
|---|---|---|---|
| V1 | The app launching from the Vega home screen, then the TV onboarding screen | VVD (B-001) | "Recorded on the Vega Virtual Device" |
| V2 | Remote-only pairing on the VVD: code and the code you scan, the number-matching choices, Reject focused first | VVD, and a phone or the phone test build in a browser | "Vega Virtual Device" plus, if the phone side is the desktop test build, "phone side: desktop Chrome with synthetic audio" |
| V3 | Quiet check and calibration on the VVD with the D-pad and the Back key | VVD | "Vega Virtual Device" |
| V4 | A visible phrase: the live arc moving, the verdict "Reached today's relative level band" or "Below today's relative level band" | VVD; for a real voice, a physical phone (B-002) | "Vega Virtual Device" and either "synthetic audio" or "physical phone" |
| V5 | A blind phrase (position 3): no arc, no colour, no announcement, then the rating, then the reveal | VVD | "Vega Virtual Device" |
| V6 | The phone placed upright beside the TV, the permission prompt, the speaker on the sofa saying a phrase | physical phone and TV or VVD (B-002) | "Physical Android phone" (only if true) |
| V7 | The listener tapping Heard / Not heard on the same phone between windows, the cue word, the agreement line with its denominator | physical phone | "Physical Android phone" |
| V8 | The summary and the seven-day history on the TV, then Delete local practice data with Cancel focused | VVD | "Vega Virtual Device" |
| V9 | VoiceView reading a screen, the quiet-window behaviour | VVD with VoiceView (B-001) | "Vega Virtual Device with VoiceView" |
| V10 | A measured latency figure (at least 20 camera-observed events with p50, p95 and max) | physical phone and TV or VVD, a camera (B-002) | the measured numbers and the setup, or **omit** |

## C. Cut for the final video (when B-001 clears)

| Time | Shot | Narration (English, honest) |
|---|---|---|
| 0:00 to 0:10 | N1 | "Across the Room checks, from where you actually sit, whether your voice reached today's own level band. It is not a medical device." |
| 0:10 to 0:25 | N2 | "A phone beside the TV is the microphone. The TV is the display and the remote runs everything. The audio never leaves the phone." |
| 0:25 to 0:50 | V2 | "Pairing takes two checks: pick the number the phone shows, then confirm on the phone that you did." |
| 0:50 to 1:15 | V3, V4 | "A quiet check sets the room's floor. A calibration phrase sets today's band for this room, this phone and this spot." |
| 1:15 to 1:40 | V4 | "Each phrase shows a large relative-level arc, then whether it reached the band." |
| 1:40 to 2:05 | V5 | "Phrases three, six and nine are blind: no arc, no colour, no announcement until you have rated how it felt." |
| 2:05 to 2:20 | V7 | "A household listener answers Heard or Not heard on the same phone between windows. Agreement is shown with its denominator." |
| 2:20 to 2:35 | N10 | "Levels are relative and per session. Everything marked here as simulated used synthetic audio; the table shows what is measured and what is pending." |
| 2:35 to 2:45 | N1 | "Open source, with setup and test instructions in the repository." |

The cut above assumes V1 to V8 exist. **Variants that must not be published:** a cut that replaces V2 to V8 with N4 to N8 (it would show only a web preview, which does not satisfy the Fire TV track); any cut that shows N5 without its banner and caption.

## D. Caption and claim rules

1. Every shot carries a caption naming its environment: "Vega Virtual Device", "physical Android phone", "desktop Chrome", "web preview", "synthetic audio" or "scripted phone". Never imply a real phone for synthetic audio or a VVD for a web preview.
2. Say "relative level" and "today's band". Never say dB SPL, loudness in the room, audibility, "loud enough", "heard", intelligibility, comprehension, accuracy, "clinically", "improves", "treats" or "therapy".
3. Do not show AWS as working: no AWS console shots, no CloudFront URLs, no deployment claims, until B-003 clears and real evidence exists.
4. Show the footer text "Not a medical device. Does not diagnose or treat any condition." on screen at least once (it is on every TV screen).
5. Show no personal data: use the test phrases only; blur the Mac's local usernames and file paths in terminal shots.
6. No music; no third-party footage; no platform logos.

## E. Checks before upload (owner)

- Length is under 3:00 on the uploaded file; captions are readable at phone size.
- Re-read the Official Rules on the day; confirm the platform's requirements for the Fire TV demo have not changed.
- Link the repository and the video from the form only after the owner authorizes publication (B-005).

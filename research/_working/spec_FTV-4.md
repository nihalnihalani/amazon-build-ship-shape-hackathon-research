# FTV-4: Across the Room: the far-side check

Build specification for the primary recommendation. Written Sunday 4 October 2026 (Asia/Kolkata) from the selection memo, the FTV-4 concept record, the three red-team lenses, the gate record, the 4 Oct platform re-check, the Fire TV and AWS digests and the hackathon brief. Nothing described here is built, deployed, measured or tested. Every hour, latency, dB and cost figure is an unmeasured estimate unless a source link says otherwise.

**Thesis sentence (video, README, Devpost text):** "Phone voice apps measure your voice at arm's length; Across the Room measures it where the listener sits, 3 metres away, and you control everything with the TV remote."

**Track and challenges:** Fire TV (React Native for Vega app on the Vega Virtual Device, the "Fire TV/Vega simulator" named in Rules §4; Fire TV is exempt from the runtime-hook rule). Open Source mini challenge (ten-foot-meter and phone-mic-meter, MIT, separate repo). AWS Builder mini challenge as a free secondary entry (API Gateway WebSocket + Lambda + DynamoDB relay in ap-south-1, S3/CloudFront; Polly only if the optional prompts stretch ships, §13.6). Sources: [Official Rules](https://amazonappdev2026.devpost.com/rules) (saved `.firecrawl/oct4/evt-rules.md`); brief §4, §6, §8.

**Label legend used throughout:** `[verified]` read in an official page saved under `.firecrawl/`; `[unverified]` documented but not observed working here; `[gated]` requires a privilege or account we do not hold; `[assumption]` design choice without evidence; `[estimate]` unmeasured number; `[inference]` our reasoning from sources; `[not read this session]` a URL given for convenience whose content was not re-read for this spec.

**Real vs simulated (planned; nothing is built yet):** everything in the demo video is intended to be real and to run on the Vega Virtual Device (VVD) shown full-screen and captioned "Vega Virtual Device". Nothing in the video is simulated. Labelled limits, each shown on screen where it applies: "iPhone: relative, per-session only"; "7-day chart: sample data" if fewer than seven dated sessions exist by filming; the latency readout is captioned "(estimate)" (camera clap test is the ground truth, §8.2); and, outside the video, the judge-route `demo:fixture` replay is captioned "fixture replay" (§4.5). The README carries the Real / Labelled table (§11.5 item 3).

**Safety wording (every TV screen footer, README, video):** "Not a medical device. Does not diagnose or treat any condition." Framing is "practice support for the loudness exercises your clinician gave you" (clinician-prescribed loudness practice). No program names or logos, no outcome claims, no third-party trademarks in UI copy or video (Rules §4 trademark clause, red-team K5).

---

## Track-specific verification (do this before any polish)

| Check | What must be true | Source |
|---|---|---|
| Runs on the VVD first | The app renders on the Vega Virtual Device before any UI polish. Host: this Mac is macOS 27.0.1 on Apple M4 Pro, 24 GB RAM, 48 GB free, Node v25 via nvm, Rosetta absent (digest local check, 3 Oct). The install doc requires Rosetta 2 on arm64 (`softwareupdate --install-rosetta --agree-to-license`), Node.js 18.x or later (samples pin v18-v20; use Node 20 via nvm), 20 GB free disk, 10-15 minute install; upgrading macOS 26 to 27 removes Rosetta and breaks Vega tools. `[verified]` | [Install the Vega Developer Tools](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk) (`.firecrawl/ftv-install-vega-sdk.md`, `.firecrawl/oct4/plt2-vega-install-live.md`); `research/_working/firetv.md` §2 |
| VVD memory crash risk | The VVD "may crash when running multiple resource-intensive processes (such as screen, audio, and video recording) simultaneously"; act if free memory is under 2 GB. For the video: restart the VVD before each take, close Metro's extra windows, the browser and the phone mirror. The same page lists USB hubs, docking stations and an audio interface used for input and output simultaneously as causes of crashes 10-20 s after launch, so do not route the recording mic and the VVD audio output through one USB interface. `[verified]` | [VVD troubleshooting](https://developer.amazon.com/docs/vega/0.24/kvd-issues) (`.firecrawl/ftv-vvd-issues.md`, last modified 1 Apr 2026) |
| Focus and navigation | Every journey completes with OK, Back and D-pad only. RN for Vega provides `TVFocusGuideView` and `TVEventHandler` from RN TvOS plus Vega's `FocusManager`; `nextFocusUp/Down/Left/Right` and `hasTVPreferredFocus` are documented in Amazon's sample. VVD keyboard shortcuts: ENTER = Select, arrows = D-pad, ESC = Back. `[verified]` | [RN for Vega overview](https://developer.amazon.com/docs/vega/0.24/vega-rn-overview) (`.firecrawl/ftv-vega-rn-overview.md`); [vega-tv-interfaces-sample focus README](https://github.com/AmazonAppDev/vega-tv-interfaces-sample) (`.firecrawl/ftv-gh-vega-tv-interfaces-focusGuide-README.md`); [run-apps](https://developer.amazon.com/docs/vega/0.24/run-apps) (`.firecrawl/technical-vega-run-apps.md`) |
| Network access | The TV app needs outbound HTTPS (fetch) and WSS (WebSocket). fetch, XMLHttpRequest and WebSocket are documented on the RN for Vega Networking pages for both 0.83 and 0.72 (the track this spec builds on; 0.72 page last modified 30 Sep 2025, `.firecrawl/oct4/verftv4-rnv072-network-curl.html`); both mirror upstream RN docs. WebSocket at runtime on the VVD is `[unverified]` until the day-one spike; the 250 ms HTTPS long-poll is the fallback. Whether plain fetch/WebSocket need a `manifest.toml` entry is `[unverified]` (NetInfo needs `com.amazon.network.service` and `com.amazon.network.privilege.net-info`; red-team RT2-FTV4-18). | [Networking 0.83](https://developer.amazon.com/docs/react-native-vega/0.83/network) (`.firecrawl/idea-judge-vega-network.md`, `.firecrawl/oct4/plt2-vega-rn-network-curl.html`); [Networking 0.72](https://developer.amazon.com/docs/react-native-vega/0.72/network); `.firecrawl/ftv-gh-vega-tv-interfaces-sample-README.md` (NetInfo service); `.firecrawl/ftv-gh-vega-video-sample-README.md` (NetInfo manifest entries) |
| Text input | The TV never needs a keyboard. Phrases are typed once on the phone page (Android Chrome). Room code entry happens on the phone, not the TV. No `com.amazon.inputmethod.service` entry is required; keep it out of the manifest unless a Settings field needs it. `[verified]` that the keyboard service exists; `[assumption]` that we avoid it. | [Enable keyboard](https://developer.amazon.com/docs/vega/0.24/enable-keyboard) (`.firecrawl/ftv-enable-keyboard.md`) |
| Media restrictions | Audio-only MP3 via the `Audio` component of `@amazon-devices/react-native-w3cmedia` (HTMLAudioElement). Manifest must declare `wants.service` entries `com.amazon.media.playersession.service`, `com.amazon.mediabuffer.service`, `com.amazon.mediatransform.service`, `com.amazon.audio.stream`, `com.amazon.audio.control`. Whether the VVD routes audio to the Mac speakers is `[unverified]` (no reviewed page says so; the 0.24 release notes only describe a fixed debug-build bug in which media apps played audio over a blank video surface, which says nothing about VVD audio output). Polly plays only between measurement windows. | [w3cmedia README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia) (`.firecrawl/oct4/rt2ftv4-w3cmedia-readme.md`); [Media player](https://developer.amazon.com/docs/vega/0.24/media-player) (`.firecrawl/idea-judge-vega-media-player.md`) |
| Phone pairing | By 6-digit room code shown on the TV, or by QR drawn with the `@amazon-devices/react-native-svg` port encoding the phone-page URL with the code. No accounts. `[verified]` that the svg port exists (npm latest 3.0.9000000001; Amazon's react-native-svg page maps `~3.0.x` to SDK 0.24, OS 1.2, RN 0.72 and 0.83, and lists `Svg`, `Rect`, `Circle`, `Path`); QR rendering performance `[unverified]`. | [react-native-svg (Vega API)](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg) (`.firecrawl/oct4/verftv4-vega-react-native-svg-curl.html`, last modified 10 Jul 2026); [npm @amazon-devices/react-native-svg](https://registry.npmjs.org/@amazon-devices%2Freact-native-svg); `.firecrawl/ftv-gh-vega-video-sample-README.md` (still pins `~2.0.0`, the SDK 0.23 line) |
| No TV microphone, no camera | "The Vega Virtual Device doesn't use the microphone" (run-apps), so the VVD has no usable microphone; the phone is the microphone. The VVD has no camera either: no camera or webcam passthrough is documented for it, Vega sticks list no camera, and no public camera API was found. `AudioRecordStreamBuilder` (Vega mic API) needs runtime privilege `com.amazon.audio.privilege.microphone.access` (digest, WebFetch summary) and is not used `[gated]`. `[verified]` for the VVD microphone sentence; camera absence is `[verified]` as "not documented / not found" | [run-apps](https://developer.amazon.com/docs/vega/0.24/run-apps); [AudioRecordStreamBuilder](https://developer.amazon.com/docs/vega-api/0.24/classes.AudioRecordStreamBuilder.amazon-devices_keplerscript-audio-lib); `firetv.md` §3, §6-7 |
| Rules-named environment | The video must show "an actual Fire TV device or the Fire TV/Vega simulator"; a real Fire TV Stick 4K Select take is optional and risky (two Sep 2026 reports of sticks stuck on OS 1.1 while SDK 0.24 requires OS 1.2). The VVD is the deliverable. Fire TV is the stated exception to the Rules §4 runtime-hook requirement ("Fire TV is the exception"), so no Amazon SDK call has to be demonstrated in code. `[verified]` | Rules §4 (`.firecrawl/oct4/evt-rules.md`); [release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes) (`.firecrawl/ftv-release-notes.md`); `.firecrawl/oct4/plt2-community-topic-29152.json` |

---

## 1. Five core user stories with measurable acceptance criteria

Personas: **Asha**, an adult told by her speech-language pathologist to practise speaking louder every day (Parkinson's is cited as context only, never as intended use); **Rohan**, her adult son who shares the living room and cannot hear her from the far sofa; **the developer**, who demonstrates the app personally and says so.

### US-1 Start a session with the remote only
As Asha, I sit on the sofa with the remote and start a full practice session without touching the phone or a keyboard.
- AC-1.1 From app launch to the first measurement window takes at most 4 presses (OK on "Start session", OK to begin calibration, OK after the calibration phrase, OK to begin the warm-up). `[assumption]`
- AC-1.2 Every screen is completable with OK, Back, Up, Down, Left, Right only; a scripted VVD run using `inputd-cli button_press` (Developer Mode) visits every screen with no keyboard. Source: [run-apps](https://developer.amazon.com/docs/vega/0.24/run-apps) `[verified]` that the commands exist; the script itself is a deliverable.
- AC-1.3 The phone lies on its taped mark beside or below the TV at least 2.5 m from the sofa; the session completes with zero touches on the phone after pairing. To be verified by the unedited video take (K4); not yet done.

### US-2 Know whether my voice reached the far side of the room
As Asha, after each household phrase I see on the TV, in silence, whether the sound that reached the far microphone cleared my own band for this session.
- AC-2.1 During a phrase window the TV emits no audio (no Polly, no chime); the arc updates from far-mic samples at 20 Hz (10 Hz with interpolation if the SVG spike stutters), and the on-screen relay latency readout is visible. Threshold K3: phone-to-TV p50 under 300 ms over WebSocket or under 500 ms over long-poll `[estimate until measured]`.
- AC-2.2 The arc turns green only when the window's p95 level above the session noise floor is at least the session calibration margin minus 1 dB (see §5 formulas); otherwise it stays neutral. The decision is deterministic and unit-tested on fixtures with a false-"reached" rate of 0/20 on labelled soft fixtures `[target, no results yet]`.
- AC-2.3 If the noise floor measured in the 2 s before a window is within 10 dB of the calibration peak, the TV shows "Room too noisy, try again" and does not score. `[assumption: 10 dB threshold, tuned in the day-3 tests]`
- AC-2.4 Advance is user-paced: the next phrase appears only after OK; there is no timeout (answers the documented rival complaint about auto-advance, red team lens 3).

### US-3 Hold the 'ahh' as long as I can and see it counted
As Asha, I do the 30-second sustained "ahh" warm-up and see my phonation seconds counted live next to my longest this week.
- AC-3.1 Phonation seconds are computed by voice-activity detection on the phone (onset when level above floor is at least 6 dB for 100 ms; offset after 300 ms below; `[assumption]` thresholds) and shown on the TV with at most 0.3 s error against hand-labelled fixtures `[target]`.
- AC-3.2 The seconds counter is a duration, so AGC cannot corrupt it; it is the primary metric if the AGC monotonicity test fails (Listener Edition fallback).
- AC-3.3 "Longest this week" is read from AsyncStorage and shown beside the live counter; if fewer than seven dated sessions exist, the chart is captioned "sample data" in the video.

### US-4 Practise the phrases that matter in this house
As Rohan, I type our ten household phrases once on the phone page and they appear on the TV as large prompt cards.
- AC-4.1 The phone page accepts 1-10 phrases of up to 60 characters each (`[assumption]` limit sized for 72 px text on a 1920 px canvas at UI scale 1.0) and sends them over the relay; the TV persists them in AsyncStorage and shows them in order.
- AC-4.2 Phrases never leave the household except as relay payloads in transit; the relay Lambda does not log message bodies (to be verified by a jest test on the handler and by inspecting the CloudWatch log group after the day-2 spike; neither exists yet).
- AC-4.3 Phrase text is always shown on the TV, with the Polly prompt optional ("show text only" setting), so the flow works for hard-of-hearing users and when Polly is cut (K4).

### US-5 See the week and share it with my caregiver
As Asha and Rohan, at the end of a session we see phrases that reached the far side (e.g. 7/10 vs 5/10 last week), phonation seconds and a 7-day bar chart, and Rohan can export a text summary from the phone page.
- AC-5.1 The summary screen shows: reached count out of attempted, longest phonation seconds, calibration margin, noise-floor status, and a 7-bar chart of the last seven calendar days from AsyncStorage.
- AC-5.2 (Stretch since 4 Oct, §13.6; the S5 summary counts stay in the core.) The export is plain text (no audio, no absolute dB SPL claims) copied via the phone's share sheet; the TV never needs a keyboard or a network account for this.
- AC-5.3 "Delete my data" in Settings clears AsyncStorage after a two-step confirmation; the relay holds nothing about sessions (DynamoDB stores room and connection records only, TTL 2 hours).

---

## 2. Paths through the product, step by step, with what the user sees on the TV

### 2.1 Happy path (one session, about 10-15 minutes)

| Step | Who does what | TV shows | Phone page shows | Behind the scenes |
|---|---|---|---|---|
| 1 | Asha presses OK on "Start session" (Home) | Pair screen: 6-digit room code in 160 px digits, QR beside it, "Open the phone page and enter this code. The phone stays by the TV." Footer: "Not a medical device..." | Rohan (once) opens the HTTPS page, enters the code | TV opened WSS to the relay with `role=tv`; relay stored `ROOM#<code>` with 2 h TTL |
| 2 | Phone joins | "Phone connected. Mic live. Relay latency: -- ms" turns to a measured value after the clock ping | "Mic live. Keep this screen on." Wake Lock requested; AGC state shown ("gain control: off" or "on, iPhone: per-session only") | relay conditional write pairs the phone connection; TV sends `clock_ping`; phone replies `clock_pong` |
| 3 | OK to start calibration | "Quiet please, 5 seconds" with a shrinking ring; TV silent | "Measuring room noise" | phone streams `sample` at 20 Hz; after 5 s sends `floor` |
| 4 | TV asks for the calibration phrase | "From your seat, say: 'Rohan, dinner is ready'" in 72 px, ring counting 6 s; TV silent | "Listening" | phone sends samples and a `window_result` with p95 and peak above floor |
| 5 | Calibration accepted | "Your band for today is set. (Margin: 14 dB above room noise)" `[example value]`; if margin under 6 dB: "Too quiet to set a band. Try once more, louder, or check the phone position." | unchanged | TV computes `cal_margin`; stores it in the session (AsyncStorage) and sends `calibration` to the phone |
| 6 | OK to begin the warm-up | "Say ahh, as long and loud as you can" shown (Polly speaks it only if the optional stretch ships, §13.6), then a 1 s silence, then the ring starts; the TV is silent during the 30 s window | "Listening" | Core (text prompts): the window opens 1 s after OK. Stretch only: Polly MP3 from S3 via the `Audio` component; measurement starts only after `ended` fires plus 1 s |
| 7 | Asha holds "ahh" | Live arc fills; seconds counter in 160 px; "Longest this week: 11.2 s" beside it `[example]`; latency readout bottom-right | unchanged | phone sends `vad_event` onsets/offsets and samples; TV counts the longest active run |
| 8 | OK for phrases | Phrase card 1 of 10: text in 72-96 px, ring 6 s, arc with the band marked; TV silent | "Phrase 1 of 10" | per window: `start_window` -> samples -> `stop_window` -> `window_result` |
| 9 | Phrase ends | Arc turns green with "Reached the far side" or stays neutral with "Try again or press OK for the next phrase" | unchanged | verdict rule in §5; stored in session |
| 10 | Repeat for 10 phrases, OK each time | Counter "7 of 10 reached" accumulates | unchanged | no timeout anywhere |
| 11 | Back (or OK on "Finish") | Summary: "Reached the far side: 7/10 (last week 5/10). Longest ahh: 14.2 s. 7-day bars." Footer unchanged | "Session saved on the TV. Export summary" button | TV writes the session to AsyncStorage with an idempotency key; phone receives `summary` for export |
| 12 | Optional (stretch since 4 Oct, §13.6): Rohan taps Export | unchanged | Plain-text card; share sheet | no server storage |

### 2.2 Ambiguous-input paths

**Room too noisy.** Before each window the TV uses the last 2 s of samples as the pre-window floor. If `pre_floor_above_cal_floor >= 10 dB` or `cal_peak - pre_floor < 10 dB` `[assumption]`, the TV shows "Room too noisy, try again" with the measured floor in small text, does not start the ring, and offers "Retry" (OK) or "Skip phrase" (Down then OK). Nothing is scored. The session log records a `noisy_block` with the floor value.

**Phrase unclear / too soft.** RMS cannot judge clarity. If the window's p95 above floor is under the band, the TV says "Try again or press OK for the next phrase". Three misses in a row trigger a one-line hint: "Check the phone is on its mark, then try from the start of the phrase." No intelligibility claim is made. In family mode the listener's "Repeat" verdict is shown beside the arc.

**Two people talking.** A single far microphone cannot separate voices with RMS alone (stated in the README). Mitigations: (a) the TV says "Quiet, please" during windows; (b) a floor rise of 10 dB or more inside the 2 s pre-window blocks the window as noisy; (c) a window whose active fraction is above 95 percent of the 6 s with no offset is flagged "continuous sound, not scored" `[assumption]`; (d) in family mode the listener's verdict overrides nothing but is logged so the household can see disagreement.

**Phone placed wrongly or moved.** The calibration margin is recomputed every session, so cross-session drift from placement is bounded to within a session. If the calibration margin is under 6 dB the band is not set and the TV asks to re-run calibration; if the AGC monotonicity test failed on day 1-3, the TV shows the arc labelled "relative level, this session only" and never a cross-session dB comparison.

**Hesitation and silence.** If no VAD onset occurs within a window, the TV says "No voice detected. OK to try again." and does not count the phrase as attempted.

### 2.3 Integration-failure paths and recovery

| Failure | Detection | TV shows | Recovery |
|---|---|---|---|
| WebSocket drops (TV side) | `onclose`/`onerror`, or no `heartbeat` from the phone for 3 s | Banner "Phone link lost. Reconnecting..." over the current screen; the current window is cancelled and not scored | Exponential backoff 0.5, 1, 2, 4, 8 s (cap 8 s, give up after 60 s with "Press OK to pair again"); the room token lets the phone rejoin without re-entering the code; API Gateway idle timeout is 600 s and max connection 7,200 s `[verified]`, so the TV re-dials on a timer at 110 minutes if a session is still open |
| WebSocket drops (phone side) | phone `onclose`; Lambda `$disconnect` clears the phone connection | "Phone paused" after 3 s without heartbeat | phone reconnects with its token; the Lambda conditional write re-pairs if the room's phone slot is empty or holds the same token hash |
| Phone screen locks or browser is backgrounded | `visibilitychange` to hidden; Wake Lock sentinel released by the system | "Phone screen is off. Wake the phone and keep the page open." (The mic stops when the screen locks on comparable phone-mic TV systems, Samsung support 13 Aug 2025 `[verified for Samsung, inference for Chrome]`) | On `visibilitychange` back to visible the page re-requests the Wake Lock and the mic stream, sends `mic_state: live`; MDN documents the re-request pattern `[verified]` |
| Relay down (API Gateway or Lambda error) | TV connect fails or `GoneException` returned to the Lambda on post | "Relay unavailable. Switching to direct mode..." then, if the long-poll endpoint also fails, "Relay unavailable. Run the local relay (see README) or try later." | Fallback order: WSS -> HTTPS long-poll at 250 ms (4 Hz meter, stated on screen) -> local relay URL from Settings |
| AGC misbehaves (arc flattens, phone reports `agc: true` or `null`) | `track.getSettings().autoGainControl` read on the phone; monotonicity test result stored in the TV profile | Arc caption "relative level, this session only"; the 7-day chart shows time-based metrics only | Per-session calibration still runs; the Listener Edition controls (Heard / Not heard / Repeat on the phone) become the headline metric if the K1 gate fails |
| Lambda cold start on the first message | first `clock_pong` RTT over 800 ms `[estimate]` | latency readout shows the value honestly | TV sends a `ping` action on pairing and every 5 minutes to keep the function warm `[assumption: reduces but does not remove cold starts]` |
| Polly MP3 fails to load | `error` event on the `Audio` element, or 3 s without `canplay` | Text prompt only; a small "audio unavailable" note | Measurement proceeds; prompts are always shown as text |
| VVD crashes during recording | process exit | n/a | Restart the VVD; sessions are persisted after each window, so at most one window is lost; the video take restarts (K6) |

All failure messages use the same 48 px banner style, are announced via `aria-live="polite"` for the screen reader, and never block Back. RN for Vega's accessibility page documents `aria-live` (polite/assertive) as the way to make VoiceView announce live-region updates and lists `aria-live` as the preferred alias of `accessibilityLiveRegion` since RN 0.71 (`[verified]` doc, [RN for Vega accessibility](https://developer.amazon.com/docs/react-native-vega/0.83/accessibility), `.firecrawl/oct4/spec-ftv3-vega-rn-accessibility.md`, last modified 3 Jun 2026); announcement behaviour on the VVD is `[unverified]`.

---
## 3. Screen list and essential ten-foot UI details

Design canvas 1920 x 1080 at UI scale 1.0 (the VVD can be started with `--display-res=1920,1080`; `.firecrawl/technical-vega-run-apps.md`). Every size below is a base value passed through `useScaledSize` from `@amazon-devices/kepler-a11y-settings-interface-turbo` so the system UI-scale setting enlarges the whole layout; the app root is wrapped in `UiScaleSettingContextProvider` and waits on `useUiScaleSettingLoading` before the first paint. `[verified]` that these hooks exist ([README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_kepler-a11y-settings-interface-turbo), `.firecrawl/oct4/ftv2-kepler-a11y-readme.md`); `[unverified]` that they return values on the VVD until the day-one spike. Setters are system-only `[gated]`; we only read.

### 3.1 Global rules

- Type: body minimum 32 px, labels 40 px, prompts 72-96 px, counters and the room code 160 px, footer 28 px (the one exception, kept legible by contrast). `[assumption]` sized for reading at 3 m; validated by the one-day falsification.
- Contrast: text and the arc against the background at least 4.5:1 (WCAG 2.1 SC 1.4.3 minimum for normal text, [W3C](https://www.w3.org/TR/WCAG21/#contrast-minimum) `[not read this session]`); the "reached" green and the neutral grey are also distinguished by a text label, never by colour alone.
- Focus visibility: a 6 px ring in the accent colour plus a 1.05 scale on the focused control, drawn by a shared `Focusable` wrapper; exactly one control on each screen has `hasTVPreferredFocus`. Focus traps use the sample's `FocusGuideView` pattern (`autoFocus`, `destinations`). `[verified]` props exist (`.firecrawl/ftv-gh-vega-tv-interfaces-focusGuide-README.md`).
- VoiceView: every focusable has `aria-label` and `role` (the ARIA-style aliases the RN for Vega accessibility page recommends over `accessibilityLabel` and `accessibilityRole`); state changes announce through `aria-live`; the app reads `isScreenReaderEnabled()` to lengthen auto-dismiss timers for banners. The props are documented for VoiceView `[verified doc]`; that they behave as documented on the VVD is `[unverified]` and becomes a friction-log item if not.
- Silent measurement windows: while a window is open the audio queue is locked; Polly and chimes play only between windows; the TV draws a shrinking ring instead of a tone.
- Footer on every screen: "Not a medical device. Does not diagnose or treat any condition." plus the small latency readout ("relay 180 ms" `[example]`) and the VVD caption in the video.
- Back always goes one screen up; Back on Home does nothing destructive.

### 3.2 TV screens and D-pad focus order

| # | Screen | Focus order (D-pad) | Content and states |
|---|---|---|---|
| S0 | Home | 1 Start session (preferred) -> 2 History -> 3 Settings -> 4 Pair phone | Title, last session line ("Yesterday: 6/10 reached, 12.4 s"), footer. If no phone paired, "Start session" routes through S1 |
| S1 | Pair phone | 1 Cancel (Back) only; no other focusables | Room code 160 px, QR 320 px square, instruction text, status line: "Waiting for phone" / "Phone connected. Mic live" / "Phone connected. Mic blocked: allow the microphone on the phone". Auto-advances to S2 on OK once paired |
| S2 | Calibration | 1 Begin (preferred) -> 2 Skip calibration (disabled when no profile) | Sub-states: Quiet (5 s ring), Phrase (6 s ring, phrase text), Result ("Band set, margin N dB" or "Too quiet" / "Room too noisy"), with Retry (preferred) -> Continue |
| S3 | Sustained ahh | 1 Begin (preferred) -> 2 Skip | Live arc (radius 300 px base), seconds counter 160 px, "Longest this week" 40 px, ring; after the window: "14.2 s" and Continue (preferred) -> Redo |
| S4 | Phrase card (x10) | During window: none focusable (OK ignored). After window: 1 Next phrase (preferred) -> 2 Try again -> 3 Finish early | Phrase text 72-96 px (auto-shrink to fit two lines), arc with band tick, verdict label ("Reached the far side" / "Try again or press OK"), "7 of 10" counter, noisy and no-voice banners |
| S5 | Session summary | 1 Done (preferred) -> 2 View history -> 3 Export on phone | Reached n/10 vs last week, longest ahh, margin, 7-day bars (7 bars, 220 px tall, labelled by weekday), "sample data" caption if seeded |
| S6 | History | 1 Back row of weeks (Left/Right) -> 2 Done | 7-day bars, sessions completed, longest phonation; dB trend bars only if the monotonicity flag is true |
| S7 | Settings | 1 Family mode toggle -> 2 Prompts: voice and text / text only -> 3 Reset baseline -> 4 Delete my data -> 5 Relay: cloud / local URL -> 6 About (UI scale readout, build, licence) | Reset and Delete open a two-step confirm overlay (Cancel preferred, then Confirm) |
| O1 | Overlay: Room too noisy | 1 Retry (preferred) -> 2 Skip phrase | Floor value in 40 px, hint text |
| O2 | Overlay: Phone paused / link lost | none (auto-dismiss on recovery) -> after 60 s: 1 Pair again | see §2.3 |
| O3 | Overlay: Not a medical device (first launch) | 1 I understand (preferred) | Full-screen statement, framing sentence, no outcome claims |

**4 Oct additions (§13; not yet built).** S4 gains a blind-check variant on 3 of the 10 phrases: arc and band hidden during the window, then "How loud did that feel?" with 1 Felt loud -> 2 Felt normal (Left/Right; OK selects; Back skips the rating), then both results revealed with Next phrase preferred (§13.1). S1-S5 carry the mic-state badge, and S1 carries the privacy line (§13.2). S5 gains the blind-check counts and "Meter and listener agreed on N of M" (§13.1, §13.3); its "Export on phone" item ships only with the caregiver-export stretch (§13.6). Settings item 2 (Prompts: voice and text / text only) appears only if the Polly stretch ships. On the phone page, P3 gains a "Cue word" field and P4's "Repeat" becomes a capped cue button (§13.3).

### 3.3 Phone page (Android Chrome; HTTPS; no install)

Single page app, large touch targets (min 64 px), dark background. States: P0 Join (6-digit code field, "Join" button; also pre-filled from the QR URL), P1 Mic permission ("Allow the microphone" with a one-line reason; shows "Gain control: off" after `getSettings().autoGainControl === false`, or "iPhone: relative, per-session only" when the constraint is unsupported), P2 Live ("Mic live. Keep this screen on. Phone stays on its mark." plus a small noise-floor number and the window name), P3 Phrases (ten text fields, Save), P4 Listener control (family mode only: three buttons Heard / Not heard / Repeat, each at least 160 px tall, enabled only while a phrase window is closed and unjudged), P5 Export (plain-text summary, Copy and Share buttons). The page shows no meter and no arc; the TV is the only display during practice `[assumption to keep the geometry honest]`.

Browser support statements: autoGainControl constraint "Full support" Chrome Android 67+, Samsung Browser 9+; "No support" Safari, Safari on iOS, WebView on iOS. A plain boolean is best-effort: the browser "will not fail if this can't be done", so "Full support" on Chrome Android means the constraint is recognised, not that AGC is guaranteed off; only `{exact: false}` makes it required (the request then fails if it cannot be met). The page therefore reads back `getSettings().autoGainControl` and relies on the day-one monotonicity test ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl), page last modified 28 Sep 2026, `.firecrawl/oct4/eng2-mdn-autogaincontrol.md`) `[verified]`. Screen Wake Lock: Chrome Android 84+, Safari on iOS 18.4+, Baseline 2025; a request may be rejected in power-save mode or when the document is not visible, and the sentinel must be re-requested on `visibilitychange` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), `.firecrawl/oct4/rt2ftv4-mdn-wakelock.md`) `[verified]`.

### 3.4 UI copy deck (every user-visible TV string; checked against K5 before filming)

All strings live in `apps/tv/src/copy.ts` so a single grep confirms that no program name, trademark, diagnosis or outcome claim appears. Numbers in brackets are placeholders filled at runtime.

| Key | String |
|---|---|
| `home.start` | Start session |
| `home.last` | Yesterday: [n]/[m] reached, [s] s longest ahh |
| `pair.title` | Open the phone page and enter this code. The phone stays by the TV. |
| `pair.waiting` / `pair.live` / `pair.blocked` | Waiting for phone / Phone connected. Mic live / Phone connected. Allow the microphone on the phone |
| `cal.quiet` | Quiet please, 5 seconds |
| `cal.phrase` | From your seat, say: "[phrase]" |
| `cal.set` | Your band for today is set. (Margin: [n] dB above room noise) |
| `cal.tooQuiet` | Too quiet to set a band. Try once more, louder, or check the phone position. |
| `ahh.prompt` | Say ahh, as long and loud as you can |
| `ahh.longest` | Longest this week: [s] s |
| `phrase.counter` | [i] of 10 |
| `phrase.reached` | Reached the far side |
| `phrase.retry` | Try again or press OK for the next phrase |
| `phrase.hint` | Check the phone is on its mark, then try from the start of the phrase. |
| `phrase.noVoice` | No voice detected. OK to try again. |
| `noisy.title` | Room too noisy, try again |
| `link.lost` / `link.paused` / `link.screenOff` | Phone link lost. Reconnecting... / Phone paused / Phone screen is off. Wake the phone and keep the page open. |
| `relay.fallback` / `relay.down` | Relay unavailable. Switching to direct mode... / Relay unavailable. Run the local relay (see README) or try later. |
| `arc.sessionOnly` | relative level, this session only |
| `summary.reached` | Reached the far side: [n]/[m] (last week [p]/[q]) |
| `summary.sample` | 7-day chart: sample data |
| `settings.framing` | Practice support for the loudness exercises your clinician gave you. |
| `footer.medical` | Not a medical device. Does not diagnose or treat any condition. |
| `footer.latency` | relay [n] ms (estimate) |
| `video.caption` | Vega Virtual Device |
| `pair.privacy` (added 4 Oct, §13.2; the phone page P1 and P2 show the same line) | No sound is recorded or sent. Only levels and the phrases you type leave this phone. |
| `badge.measuring` / `badge.open` / `badge.off` (§13.2) | Measuring / Mic open, not measuring / Mic off |
| `phrase.blind` (§13.1) | Blind check: the meter is hidden for this phrase |
| `phrase.felt.prompt` (§13.1) | How loud did that feel? |
| `phrase.felt.loud` / `phrase.felt.normal` (§13.1) | Felt loud / Felt normal |
| `phrase.felt.reveal` (§13.1) | You felt: [loud / normal / not rated]. Far side: [reached / not reached] |
| `summary.feltNormalReached` (§13.1) | Felt normal but reached the far side: [n] of [b] blind checks |
| `summary.feltLoudMissed` (§13.1) | Felt loud but did not reach: [n] of [b] blind checks |
| `summary.agreement` (§13.3) | Meter and listener agreed on [n] of [m] |
| `cue.chip` (§13.3) | Cue: [cue word] |
| `why.line` (stretch, §13.4) | Why: [n] dB above room noise against today's band of [b] dB (relative, not SPL). Frames dropped: [f] |

K5 rules for the 4 Oct strings: the same grep over `copy.ts` also fails the build on "recalibrate", "therapy", "treatment" and any programme name; the blind-check strings say how loud a phrase felt and what reached the far side, never what that means clinically; no clinic wording is pasted into the UI; the listener is never called a patient or a therapist.

---

## 4. Architecture, components, dependency verification, hosting and the local judging route

### 4.1 Diagram

```
 Sofa (2.5-3 m)                     Far side of the room (TV wall)
 +-----------+                      +----------------------------------+
 | Asha with |  OK/Back/D-pad       | Vega Virtual Device (RN for Vega)|
 | remote    |--------------------->| Across the Room TV app           |
 +-----------+   (VVD keyboard /    |  screens S0-S7, SVG arc, bars    |
       | voice   inputd-cli)        |  TVEventHandler, FocusManager    |
       | (acoustic, 3 m)            |  KeplerA11ySettings (UI scale)   |
       v                            |  w3cmedia <Audio> (Polly MP3)    |
 +----------------------+           |  AsyncStorage (profile, sessions)|
 | Android phone on its |           +----------------+-----------------+
 | taped mark, Chrome   |                            ^  WSS (or HTTPS long-poll)
 | phone page (HTTPS)   |                            |  JSON numbers only
 |  getUserMedia AGC off|                            |
 |  AnalyserNode -> dBFS|   WSS, JSON numbers only   |
 |  VAD, noise floor    |----------------------------+-----------------+
 |  Wake Lock           |                                              |
 +----------------------+                                              v
                                   AWS ap-south-1 (Mumbai)
                     +------------------------------------------------------+
                     | API Gateway WebSocket API  ($connect/$disconnect/     |
                     |   $default + action routes join/relay/ping)          |
                     |        |  Lambda (Node 22, arm64) relay handler      |
                     |        |    - validates room code / token (HMAC)     |
                     |        |    - DynamoDB conditional writes (pairing)  |
                     |        |    - PostToConnection to the peer           |
                     |        v                                             |
                     |  DynamoDB table atr-relay (ROOM#, CONN#; TTL 2 h)   |
                     |  S3 bucket (phone page, Polly MP3s) + CloudFront     |
                     |  CloudWatch Logs (connection events; no bodies)      |
                     |  Budgets + billing alarm (us-east-1 metric)         |
                     +------------------------------------------------------+
   Offline/local judging route: node relay/local.js (ws on :8787) + phone page on localhost
```

Audio never leaves the phone. Only timestamped numbers travel, plus the phrases the family types and, in family mode, the listener's taps and cue word (so the user-facing line is "Only levels and the phrases you type leave this phone", §13.2). No model is in the loop.

### 4.2 Component responsibilities

| Component | Responsibilities | Not responsible for |
|---|---|---|
| TV app (`apps/tv`, RN for Vega) | Screens, focus, remote input, UI-scale binding, arc and bar rendering, session state machine, verdict rule, AsyncStorage persistence, Polly playback between windows, relay client with fallback order, latency readout, deletion | Any audio capture or DSP; any network server |
| Phone page (`apps/phone`, static HTML/TS) | getUserMedia with `autoGainControl:false`, AnalyserNode RMS to dBFS at 20 Hz, noise floor, VAD, window summaries, phrase editor, listener control (family mode), summary export, Wake Lock, reconnect | Displaying a meter; storing anything beyond the room token in `sessionStorage` |
| Relay (`services/relay`, SAM) | WebSocket routes, pairing with conditional writes, HMAC room tokens, fan-out with PostToConnection, `t_relay` stamping, TTL hygiene, long-poll fallback endpoints (`POST /push`, `GET /pull`) | Persisting samples, phrases or sessions; any scoring |
| Local relay (`services/relay/local.js`) | Same message contract over plain `ws` and HTTP on the Mac for judges and offline development | TLS (documented limitation; see §4.5) |
| DSP core (`packages/phone-mic-meter`) | Pure functions: rms, dbfs, floor estimate, VAD, window summary, band rule; jest fixtures | Browser APIs (adapter layer wraps them) |
| Gauges (`packages/ten-foot-meter`) | `ArcMeter`, `SustainCounter`, `WeekBars`, `RoomCodeQR`, all bound to UI scale with a non-Vega fallback | App logic |
| Fixtures (`fixtures/`) | Recorded number streams (JSON), synthetic tone descriptions, labelled onsets | Any audio files |

### 4.3 Dependency versions to verify (run on day one; record outputs in the friction log)

| Dependency | Expected (from sources) | Verify with | Source |
|---|---|---|---|
| Rosetta 2 on macOS 27 | Required; absent on this Mac | `/usr/bin/pgrep -q oahd && echo rosetta-running \|\| echo rosetta-missing`; install `softwareupdate --install-rosetta --agree-to-license` | [install doc](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk) `[verified]` |
| Node 20 via nvm | Install doc: 18.x or later; samples pin v18-v20; machine has v25 | `nvm install 20 && nvm use 20 && node -v` | install doc; `.firecrawl/ftv-gh-vega-tv-interfaces-sample-README.md` `[verified]`; v25 `[unverified]` |
| Disk | 20 GB free | `df -h /` | install doc `[verified]` |
| Vega SDK 0.24 | "Version 0.24 (LATEST)"; a developer post shows build 0.24.12112 / CLI 1.2.18 `[community report]` | `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh \| bash && source ~/vega/env`, then `vega --version` and `vega sdk list` (subcommand names to confirm with `vega --help`) | install doc; `.firecrawl/oct4/plt2-community-topic-29212.json` |
| VVD boots | `vega virtual-device start --display-res=1920,1080` | then `vega run-app <vpkg> <app-id> -d VirtualDevice` on the hello-world | [run-apps](https://developer.amazon.com/docs/vega/0.24/run-apps) `[verified]` |
| RN for Vega track | SDK 0.24 supports RN 0.72 (stable) and 0.83 (early access; no Chrome DevTools, headless tasks crash, setNativeProps unsupported) and requires device OS 1.2 (the only OS in this release). Build on 0.72 unless a package forces 0.83 | `npm view @amazon-devices/react-native-kepler dist-tags versions --json`. Checked 4 Oct: the npm `latest` tag is 4.0.1, which peers React ^19.2 (the RN 0.83 line); the RN 0.72 line is 2.1.0 (peer react-native 0.72.0, 2026-08-06). So do not install `latest` for a 0.72 build; take the pin from the `release-rn-72` branch of `react-native-multi-tv-helloworld` (branch confirmed via the GitHub API, 4 Oct) | [release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes); [target OS matrix](https://developer.amazon.com/docs/vega/0.24/target-os-version); `firetv.md` §9 `[verified]` |
| @amazon-devices/react-native-svg | latest 3.0.9000000001 (2026-08-06); rn83-alpha tag; Amazon's page maps `~3.0.x` to SDK 0.24 / OS 1.2 / RN 0.72 and 0.83 (`~2.0.x` is SDK 0.23 and earlier, which vega-video-sample still pins) | `npm view @amazon-devices/react-native-svg dist-tags --json` | [Vega API page](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg) (`.firecrawl/oct4/verftv4-vega-react-native-svg-curl.html`) `[verified]`; [npm](https://registry.npmjs.org/@amazon-devices%2Freact-native-svg) `[verified metadata]`; 20 Hz redraw `[unverified]` |
| @amazon-devices/react-native-w3cmedia | latest 2.3.2 (2026-08-06); rn83-alpha 2.3.4-rn-83 | `npm view @amazon-devices/react-native-w3cmedia dist-tags --json` | [npm](https://registry.npmjs.org/@amazon-devices%2Freact-native-w3cmedia) `[verified metadata]` |
| @amazon-devices/kepler-a11y-settings-interface-turbo | 1.0.0; peer react-native >=0.72.0 | `npm view @amazon-devices/kepler-a11y-settings-interface-turbo peerDependencies --json` | [npm](https://registry.npmjs.org/@amazon-devices%2Fkepler-a11y-settings-interface-turbo) `[verified metadata]` |
| @amazon-devices/react-native-async-storage__async-storage | latest 2.1.9000000001; Amazon's page maps `~2.1.0` to SDK 0.24 / OS 1.2 / RN 0.72 and 0.83; samples import it through the npm alias `@react-native-async-storage/async-storage` | `npm view @amazon-devices/react-native-async-storage__async-storage version` | [Vega API page](https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage) (`.firecrawl/oct4/verftv4-vega-async-storage-curl.html`) `[verified]`; [npm](https://www.npmjs.com/package/@amazon-devices/react-native-async-storage__async-storage) `[verified metadata]` |
| Manifest validity | `schema-version = 1`, `[package]`, `[components]` with `[[components.interactive]]`, `[[wants.service]]` entries for media; SDK 0.24 also requires an `[os.version]` block with min and target both `1.2` | `vega project update-manifest --os-min 1.2 --os-version 1.2`, then `vega exec vpt validate <abs-path>/manifest.toml` | [App manifest](https://developer.amazon.com/docs/vega/0.24/app-manifest) (`.firecrawl/oct4/spec4-vega-app-manifest.md`); [release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes) (`.firecrawl/ftv-release-notes.md`, OS-version section) `[verified]` |
| AWS CLI and SAM | any current version | `aws --version && sam --version && aws sts get-caller-identity` | AWS docs `[not read this session]` |

### 4.4 Realistic hosting (ap-south-1 unless stated; nothing deployed yet)

- **API Gateway WebSocket API**: routes `$connect`, `$disconnect`, `$default` and custom routes selected by `$request.body.action` (`join`, `relay`, `ping`). Endpoints exist in ap-south-1 (`apigateway.ap-south-1.amazonaws.com`, `execute-api.ap-south-1.amazonaws.com`); quotas "each supported Region": connection 7,200 s, idle 600 s, frame 32 KB, payload 128 KB. Whether WebSocket APIs are enabled in Mumbai is implied, not stated per Region `[inference, medium]`; fallback Region us-east-1. Sources: [General Reference](https://docs.aws.amazon.com/general/latest/gr/apigateway.html) (`.firecrawl/oct4/rt2ftv4-aws-gr-apigateway.md`); [$connect/$disconnect routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html) (`.firecrawl/oct4/spec4-apigw-ws-routes.md`) `[verified]`.
- **Lambda** (one function, runtime `nodejs22.x`, arm64, 256 MB `[assumption]`): handles all routes. Not Node 20: AWS lists `nodejs20.x` under deprecated runtimes (deprecated 30 Apr 2026, so no security patches or support; function create blocked from 29 Jul 2027), while `nodejs22.x` is supported to 30 Apr 2027 ([Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), `.firecrawl/oct4/verftv4-lambda-runtimes-curl.html`) `[verified]`. Node 20 stays the local Vega toolchain version; the handler is plain JS and runs on both. The function posts to the peer via the `@connections` API (`POST https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/@connections/{connection_id}`, IAM SigV4; `GoneException` when the connection is gone). Source: [@connections](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html) (`.firecrawl/oct4/specftv4-apigw-connections.md`) `[verified]`.
- **DynamoDB** table `atr-relay`, on-demand, TTL attribute `expires_at` (Unix epoch seconds; items deleted "typically within a few days" after expiry, so code must also check `expires_at` on read). Source: [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) (`.firecrawl/oct4/spec4-dynamodb-ttl.md`) `[verified]`.
- **S3 + CloudFront**: static phone page and Polly MP3s; HTTPS is mandatory for getUserMedia on a phone. CloudFront pricing page now shows plan tiers starting with a Free plan (`.firecrawl/oct4/exec1-aws-cloudfront-pricing.md`) `[verified that a Free plan exists; limits not read]`.
- **Polly**: `aws polly synthesize-speech` once per prompt (about 15 prompts; Standard voice, mp3) into S3; Polly endpoints exist in ap-south-1; cached speech may be replayed at no additional cost. Sources: [SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html) (`.firecrawl/oct4/rt2ftv4-polly-synthesizespeech.md`); [Polly endpoints](https://docs.aws.amazon.com/general/latest/gr/pol.html); [Polly pricing](https://aws.amazon.com/polly/pricing/) (`.firecrawl/oct4/spec4-polly-pricing.md`) `[verified]`.
- **Long-poll fallback**: an HTTP API with `POST /rooms/{code}/push` (phone, batches of 5 samples) and `GET /rooms/{code}/pull?since=` (TV every 250 ms); same Lambda; DynamoDB holds a 2 s ring buffer per room `[assumption]`. Only deployed if the WebSocket spike fails on the VVD.
- **Live-through-judging**: the stack stays up to 20 Nov 2026 12:00 PT (Rules §4 Testing; brief D16). Cost at demo volume is about $1 at list prices even with no free tier (whether the 12-month API Gateway free tier applies to post-July-2025 accounts is not verified; `aws.md` Gaps 6) `[estimate: under $5 total]`; §9 has the arithmetic and budget controls.
- **Account**: AWS Paid plan with a card (promotional credits are "Not eligible" on the Free plan; `.firecrawl/aws-free-tier.md` `[verified]`); nothing here needs Bedrock.

### 4.5 Local judging route (no accounts, no AWS)

Accounts check: the Vega SDK install doc lists no sign-in step for the installer, and VVD registration at amazon.com/code is needed "only if you're using Amazon services for testing" (run-apps), which this app does not use `[verified]`. No AWS, Amazon or third-party tunnel account is involved in the steps below.

1. `npm run relay:local` starts `services/relay/local.js`: a Node `ws` server on `ws://0.0.0.0:8787` plus HTTP long-poll endpoints, same message contract, in-memory rooms.
2. `npm run phone:dev` serves the phone page at `http://localhost:5173`. getUserMedia requires a secure context; `localhost` qualifies, so the judge opens the page in Chrome on the Mac itself and the Mac's microphone becomes the far mic (documented as "same-Mac mode").
3. In the TV app Settings, choose "Relay: local" and enter the Mac's LAN IP (shown by `npm run relay:local`); the VVD reaches the host over the LAN `[unverified: VVD-to-host networking and cleartext ws:// policy are day-one spike items]`. If cleartext is blocked, the script also offers `--tls` with a self-signed certificate and prints the one-time trust steps for Android Chrome (no third-party tunnel account). Whether the VVD itself will accept a self-signed `wss://` certificate is `[unverified]`; if it will not, the judge falls back to the hosted relay, which the developer runs and which needs no judge account.
4. `npm run demo:fixture` replays a recorded number stream into the local relay so a judge without a microphone still sees the arc, labelled "fixture replay" on screen.
5. The README states that the hosted relay is also live to 20 Nov and lists both URLs.

---
## 5. API and event contract

### 5.1 Contract table

| Surface | API / event | Used for | Status | Documentation (URL; saved copy) |
|---|---|---|---|---|
| Vega | `TVEventHandler` / `useTVEventHandler` | OK (select), Back, Up/Down/Left/Right on every screen; OK ignored during an open window | `[verified]` | [RN for Vega overview](https://developer.amazon.com/docs/vega/0.24/vega-rn-overview); `.firecrawl/ftv-vega-rn-overview.md`; sample `useTVEventHandler` wrapper `.firecrawl/ftv-gh-vega-tv-interfaces-focusGuide-README.md` |
| Vega | `TVFocusGuideView` (`FocusGuideView` wrapper), `nextFocus*`, `hasTVPreferredFocus`, `FocusManager` | Focus order and traps per screen (§3.2) | `[verified]` names; behaviour on VVD `[unverified]` | same as above |
| Vega | `@amazon-devices/react-native-w3cmedia` `Audio` (HTMLAudioElement: `play()`, `pause()`, `currentTime`, `ended`) | Polly MP3 prompts between windows; `ended` + 1 s opens the window | `[verified]` API; VVD audio output `[unverified]` | [w3cmedia README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia); `.firecrawl/oct4/rt2ftv4-w3cmedia-readme.md`; [Media player](https://developer.amazon.com/docs/vega/0.24/media-player) `.firecrawl/idea-judge-vega-media-player.md` |
| Vega | `KeplerA11ySettingsInterface.getUiScaleSetting()`, `isScreenReaderEnabled()`, `getCaptionPreferences()`; hooks `useScaledSize`, `useScalingMultiplier`, `useUiScaleSetting`, `useUiScaleSettingLoading`; `UiScaleSettingContextProvider` | Scale all sizes; lengthen banner timers when a screen reader is on; caption prefs unused in MVP | `[verified]` README; setters `[gated]` system-only | [a11y README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_kepler-a11y-settings-interface-turbo); `.firecrawl/oct4/ftv2-kepler-a11y-readme.md` |
| Vega | `fetch` | Long-poll fallback, MP3 availability check | `[verified]` documented (0.72 and 0.83 pages); VVD behaviour `[unverified]` | [Networking 0.72](https://developer.amazon.com/docs/react-native-vega/0.72/network) (`.firecrawl/oct4/verftv4-rnv072-network-curl.html`); [Networking 0.83](https://developer.amazon.com/docs/react-native-vega/0.83/network) (`.firecrawl/idea-judge-vega-network.md`) |
| Vega | `WebSocket` (`new WebSocket('wss://...')`) | Primary relay transport | documented on both pages `[verified]`; untested on the VVD `[unverified until the day-one spike]` | same pages; `.firecrawl/oct4/plt2-vega-rn-network-curl.html`; absence of runtime reports `.firecrawl/oct4/rt2ftv4-search-vega-websocket-dev.json` |
| Vega | `@amazon-devices/react-native-async-storage__async-storage` (`getItem`, `setItem`, `multiRemove`), imported as `@react-native-async-storage/async-storage` via npm alias | Profile, sessions, phrases, monotonicity flag | `[verified]` package and the three methods documented; VVD behaviour `[unverified]` | [Vega API page](https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage) (`.firecrawl/oct4/verftv4-vega-async-storage-curl.html`); [npm](https://www.npmjs.com/package/@amazon-devices/react-native-async-storage__async-storage); alias pattern `.firecrawl/ftv-gh-vega-video-sample-README.md` |
| Vega | `@amazon-devices/react-native-svg` (`Svg`, `Path`, `Rect`, `Circle`) | Arc, band tick, 7-day bars, QR code | `[verified]` package and the four components documented; 20 Hz redraw `[unverified]` | [Vega API page](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg) (`.firecrawl/oct4/verftv4-vega-react-native-svg-curl.html`); [npm](https://registry.npmjs.org/@amazon-devices%2Freact-native-svg); `.firecrawl/ftv-gh-vega-video-sample-README.md` |
| Vega | `manifest.toml` `[[wants.service]]` media entries; `[os.version]` min/target `1.2` (required by SDK 0.24); no privilege needed for plain fetch/WebSocket `[unverified]` | Audio playback; OS targeting; network | `[verified]` manifest structure and OS-version requirement | [release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes) `.firecrawl/ftv-release-notes.md`; [App manifest](https://developer.amazon.com/docs/vega/0.24/app-manifest); `.firecrawl/oct4/spec4-vega-app-manifest.md`; [runtime privileges](https://developer.amazon.com/docs/vega/0.24/request-runtime-privileges) `.firecrawl/ftv-vega-runtime-privileges.md` |
| Vega (not used) | `AudioRecordStreamBuilder` (`com.amazon.audio.privilege.microphone.access`) | none; listed to show the TV mic is not touched (the VVD has no usable microphone anyway) | `[gated]`; API details from the digest's WebFetch summary, page not re-read | [API ref](https://developer.amazon.com/docs/vega-api/0.24/classes.AudioRecordStreamBuilder.amazon-devices_keplerscript-audio-lib); `firetv.md` §6 |
| Browser | `navigator.mediaDevices.getUserMedia({audio:{autoGainControl:false, noiseSuppression:false, echoCancellation:false}})`; `track.getSettings()` | Far microphone; AGC state reporting | `[verified]` constraint support table (Chrome Android 67+ and Samsung Browser 9+ recognise it; Safari on iOS: no support); a plain `false` is best-effort per MDN, so actual AGC bypass is `[unverified; day-one monotonicity test]` | [MDN autoGainControl](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl); `.firecrawl/oct4/eng2-mdn-autogaincontrol.md`; [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) `[not read this session]` |
| Browser | `AudioContext`, `AnalyserNode.getFloatTimeDomainData(Float32Array)` with `fftSize = 2048` | RMS per 50 ms tick; values are PCM -1.0..1.0 | `[verified]` (Chrome Android 35+, Safari on iOS 14.5+; page last modified 12 Aug 2025) | [MDN getFloatTimeDomainData](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData); `.firecrawl/oct4/spec4-mdn-getfloattimedomaindata.md` |
| Browser | `navigator.wakeLock.request('screen')`, `WakeLockSentinel.release`, `visibilitychange` | Keep the phone screen on; re-request after visibility returns | `[verified]` support; reliability over 15 minutes `[unverified]` | [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API); `.firecrawl/oct4/rt2ftv4-mdn-wakelock.md` |
| Browser | `WebSocket`, `navigator.share` / Clipboard | Relay; caregiver export | `[not read this session]` (standard APIs; URLs resolve, content not re-read) | [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket); [MDN Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share); [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) |
| AWS | API Gateway WebSocket routes `$connect`, `$disconnect`, `$default`, `join`, `relay`, `ping` (route selection `$request.body.action`); query strings available on `$connect`; authorization only on `$connect` | Relay transport and pairing | `[verified]` docs (route selection expression `$request.body.action` confirmed on the routes page); ap-south-1 WebSocket availability `[inference]` | [$connect/$disconnect](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html); `.firecrawl/oct4/spec4-apigw-ws-routes.md`; [Create routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-routes.html) (`.firecrawl/oct4/verftv4-apigw-ws-develop-routes-curl.html`); [quotas](https://docs.aws.amazon.com/general/latest/gr/apigateway.html) |
| AWS | `@connections` management API: `POST/GET/DELETE .../@connections/{connection_id}` (SigV4; `PostToConnectionCommand`; `GoneException`) | Fan-out to the peer; disconnect stale phones | `[verified]` | [@connections](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html); `.firecrawl/oct4/specftv4-apigw-connections.md` |
| AWS | Lambda (`nodejs22.x`, arm64) | Single relay handler | `[verified]` pricing page and runtime support dates (`nodejs20.x` deprecated 30 Apr 2026; `nodejs22.x` supported to 30 Apr 2027) | [Lambda pricing](https://aws.amazon.com/lambda/pricing/); `.firecrawl/aws-lambda-pricing.md`; [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) (`.firecrawl/oct4/verftv4-lambda-runtimes-curl.html`) |
| AWS | DynamoDB `PutItem`/`UpdateItem` with `ConditionExpression`; TTL | Pairing without hijack; expiry | `[verified]` TTL doc; condition expressions `[not read this session]` | [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) `.firecrawl/oct4/spec4-dynamodb-ttl.md`; [Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) |
| AWS | Polly `SynthesizeSpeech` (POST /v1/speech; OutputFormat mp3; Engine standard) | One-time prompt synthesis by CLI | `[verified]` API page | [SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html); `.firecrawl/oct4/rt2ftv4-polly-synthesizespeech.md` |
| AWS | Budgets, CloudWatch billing alarm, Cost Anomaly Detection | Spend guardrails | `[verified]` docs | §9 sources |
| AWS (optional, not required) | Bedrock Nova Lite phrase suggestions | Behind a remote-confirmation gate; not demoed | `[gated]` (new-account quota-0 reports, `[unverified]` for this account); Nova Lite is geo-only in ap-south-1 `[verified]` | `.firecrawl/aws-bedrock-models-region-compat.md` |

### 5.2 Message contract (JSON over the relay; numbers only, never audio)

Envelope for every WebSocket frame: `{"action":"relay","to":"tv"|"phone","payload":{...}}`. The Lambda copies `payload`, adds `t_relay` (ms epoch at receipt) and forwards to the peer connection. Each sample is about 160 bytes, well under the 32 KB metering unit, so each frame is one metering unit; because the pricing page meters "messages sent and received", a relayed frame counts once on receipt from the phone and once when posted to the TV `[inference from the pricing wording]`. The JSON `ping` action is an ordinary metered message, not an unmetered WebSocket control frame. All timestamps are Unix milliseconds. `v` is the contract version (1).

**Phone to TV**

```json
{"v":1,"type":"mic_state","t_phone":1760000000000,"state":"live","agc":false,"sample_rate":48000,"fft_size":2048,"ua":"Chrome Android"}
{"v":1,"type":"heartbeat","t_phone":1760000001000}
{"v":1,"type":"clock_pong","t_tv_sent":1760000000900,"t_phone":1760000000950}
{"v":1,"type":"sample","seq":1234,"win":"phrase-03","t_phone":1760000012345,"dbfs":-31.2,"floor_dbfs":-58.4,"above_floor":27.2,"vad":true}
{"v":1,"type":"floor","win":"floor","t_phone":1760000005000,"dur_ms":5000,"floor_dbfs":-58.4,"p20_dbfs":-60.1,"p80_dbfs":-56.9,"frames":100,"ok":true}
{"v":1,"type":"vad_event","win":"ahh","kind":"onset","t_phone":1760000020100}
{"v":1,"type":"window_result","win":"phrase-03","t_phone":1760000018400,"frames":120,"frames_dropped":0,"pre_floor_dbfs":-57.9,"p95_above_floor":26.8,"peak_above_floor":29.1,"active_ms":1850,"onsets":1}
{"v":1,"type":"verdict","win":"phrase-03","t_phone":1760000019000,"verdict":"heard"}
{"v":1,"type":"phrases","t_phone":1760000000500,"items":["Rohan, dinner is ready","Can you pass the salt?"]}
{"v":1,"type":"summary_request","t_phone":1760000900000}
{"v":1,"type":"verdict","win":"phrase-04","t_phone":1760000026000,"verdict":"cue"}
{"v":1,"type":"phrases","t_phone":1760000000500,"items":["Rohan, dinner is ready"],"cue_word":"Volume"}
{"v":1,"type":"mic_state","t_phone":1760000901000,"state":"off","agc":false,"sample_rate":48000,"fft_size":2048,"ua":"Chrome Android"}
```

The last three lines were added on 4 Oct (§13): `verdict` gains the value `cue` (one-cue listener, §13.3), `phrases` gains an optional `cue_word`, and `mic_state` gains the state `off`, sent after the phone has stopped its track in response to `end_session` (§13.2).

**TV to phone**

```json
{"v":1,"type":"clock_ping","t_tv":1760000000900}
{"v":1,"type":"start_window","win":"floor","dur_ms":5000,"rate_hz":20,"t_tv":1760000004900}
{"v":1,"type":"start_window","win":"phrase-03","dur_ms":6000,"rate_hz":20,"t_tv":1760000012000}
{"v":1,"type":"stop_window","win":"phrase-03","t_tv":1760000018300}
{"v":1,"type":"calibration","session_id":"s_2026-10-12T19:05:00+05:30_a1b2","floor_dbfs":-58.4,"cal_peak_above_floor":14.0,"target_above_floor":13.0,"cross_session_ok":false,"t_tv":1760000011000}
{"v":1,"type":"family_mode","enabled":true,"t_tv":1760000000600}
{"v":1,"type":"summary","session_id":"s_...","reached":7,"attempted":10,"longest_phonation_s":14.2,"week":[...],"t_tv":1760000900100}
{"v":1,"type":"reveal","session_id":"s_...","win":"phrase-03","t_tv":1760000021000}
{"v":1,"type":"summary","session_id":"s_...","reached":7,"attempted":10,"longest_phonation_s":14.2,"week":[...],"blind_rated":3,"felt_normal_reached":2,"felt_loud_missed":0,"agreed":8,"agreement_n":9,"cues_used":1,"t_tv":1760000900100}
{"v":1,"type":"end_session","session_id":"s_...","t_tv":1760000900200}
```

Added on 4 Oct (§13; example values illustrative): `reveal` tells the phone that the TV has shown a window's result, so P4 locks for that window and any later listener tap is stored as late and left out of the agreement count (§13.1, §13.3; in FTV-4F it also marks the moment both inputs are revealed, §13.8). The second `summary` line shows the agreement summary: the blind-check counts and the meter/listener agreement count are aggregate fields on the existing `summary` type. The speaker's per-phrase rating is entered on the TV and stays there, so it has no relay message. `end_session` is sent when S5 opens; the phone stops its `MediaStreamTrack`, releases the Wake Lock and answers with `mic_state` `off` (§13.2).

**Relay-originated**

```json
{"action":"join","role":"phone","code":"483921"}
{"v":1,"type":"paired","room":"483921","token":"<hmac>","expires_at":1760007200,"t_relay":1760000000400}
{"v":1,"type":"error","code":"ROOM_NOT_FOUND"|"ROOM_FULL"|"TOKEN_EXPIRED"|"RATE_LIMIT","t_relay":1760000000400}
{"action":"ping"}
```

**Validation and drop rules (proposed; to be implemented and covered by the §8.8 tests).** The relay Lambda and both clients treat every message as untrusted data:

- The relay drops, without forwarding, any message whose room token is missing, malformed, expired or signed for a different room, and returns `{"type":"error","code":"TOKEN_EXPIRED"}` or closes the connection after three bad tokens in 60 s `[assumption]`.
- The relay forwards only the message types defined in this section (`sample`, `floor`, `vad_event`, `mic_state`, `heartbeat`, `window_result`, `calibration`, `verdict`, `phrases`, `summary`, `summary_request`, `start_window`, `stop_window`, `family_mode`, `clock_ping`, `clock_pong`, `paired`, `error`, plus the `join` and `ping` actions, and, added on 4 Oct for §13, `end_session` and `reveal`); any other `type`, a missing `v`, or a payload over 4 KB is dropped and counted in a CloudWatch metric, never forwarded.
- The TV ignores a message whose `v` it does not know, whose numeric fields are out of range (for example `db_rel` outside −20…+60, a timestamp more than 10 s from the TV clock), or whose `session_id` does not match the open session; ignored messages never change a score.
- Phrase text arrives only from the paired phone page, is rendered as plain text (never as markup), and must satisfy the `savePhrases` limits in §7 (1–10 phrases, 1–60 characters each).
- 4 Oct additions (§13): `verdict` accepts only `heard`, `not_heard` or `cue`; the TV ignores a fourth `cue` in a session (cap 3, also enforced on the phone) and any verdict for a window it has already revealed counts as late. `cue_word` is 1–12 characters of plain text, rendered as text, never as markup. The `summary` counts are integers from 0 to 10 and `cues_used` from 0 to 3. `mic_state` accepts `live`, `blocked` or `off`.

### 5.3 Formulas (deterministic; all constants are `[assumption]` until the day-1/day-3 tests)

- `rms = sqrt(mean(x[i]^2))` over the 2048-sample frame; `dbfs = 20*log10(max(rms, 1e-6))`.
- Noise floor `floor_dbfs` = median of the 100 frames in the 5 s quiet window; `ok` is false if `p80 - p20 > 6 dB` (unstable room).
- `above_floor = dbfs - floor_dbfs`.
- VAD: active when `above_floor >= 6` for two consecutive frames; inactive after 6 consecutive frames (300 ms) below 6 dB. Phonation seconds = longest active run inside the window.
- Calibration margin `cal_peak_above_floor` = p95 of `above_floor` over VAD-active frames in the calibration window; band is set only if `>= 6 dB`.
- Reached rule (same session): `window.p95_above_floor >= cal_peak_above_floor - 1`.
- Cross-session target (only when `monotonicity_ok` is true in the profile): `target = median(last 5 sessions' cal_peak_above_floor) + 1`, capped at `first_session + 6`; otherwise the target is the same-session rule.
- Noisy gate: block when `pre_floor_dbfs - floor_dbfs >= 10` or `cal_peak_dbfs - pre_floor_dbfs < 10`.
- Relay latency shown on screen: `t_tv_recv - t_phone - offset`, where `offset` is the NTP-style estimate from `clock_ping/pong` (`((t_phone - t_tv_sent) + (t_phone - t_tv_recv)) / 2` on the pong); the camera clap test is the ground truth, the readout is an estimate and is labelled as such.

### 5.4 Long-poll fallback HTTP contract (deployed only if the WebSocket spike fails on the VVD)

Same payload types as §5.2, carried in batches; the TV polls every 250 ms, so the meter runs at about 4 Hz and the TV says so on screen (K3).

```
POST /rooms/{code}/push            Authorization: Bearer <room token>
  body: {"v":1,"from":"phone","items":[{...sample...},{...sample...}]}      (at most 5 items, about 250 ms of samples)
  200: {"accepted":5,"t_relay":1760000012400}     401: TOKEN_EXPIRED   404: ROOM_NOT_FOUND   429: RATE_LIMIT

GET  /rooms/{code}/pull?since=<seq>&for=tv        Authorization: Bearer <room token>
  200: {"items":[...payloads with t_relay...],"next":1240,"t_relay":1760000012650}   (empty items after 250 ms if nothing new)

POST /rooms/{code}/control         (TV -> phone: start_window, stop_window, calibration, clock_ping, family_mode; from 4 Oct also reveal, end_session)
  200: {"accepted":1}
```

Server keeps a 2 s ring buffer per room in DynamoDB (`RING#<code>` item with a list attribute, TTL 2 h) `[assumption]`; nothing older is retained. Rate limit: 30 requests per second per room `[assumption]`.

---

## 6. Data entities, schemas, authorization boundaries, timestamps, lifecycle and deletion

### 6.1 Entities (all stored on the TV in AsyncStorage unless marked relay)

**HouseholdProfile** (key `atr:profile`)
```json
{"schema":1,"household_id":"uuid-v4","created_at":"2026-10-06T19:00:00+05:30","display_name":"Asha","monotonicity_ok":false,"monotonicity_tested_at":null,"family_mode":false,"prompts_mode":"voice_and_text","ui_scale_seen":1.0,"relay_mode":"cloud","local_relay_url":null,"first_cal_peak_above_floor":null}
```

**Phrase** (key `atr:phrases`, array of up to 10)
```json
{"id":"p_01","text":"Rohan, dinner is ready","added_at":"2026-10-06T19:02:00+05:30","source":"phone_page"}
```

**Session** (key `atr:session:<session_id>`; `session_id` is the idempotency key, generated once by the TV when calibration starts)
```json
{"schema":1,"session_id":"s_2026-10-12T19:05:00+05:30_a1b2","household_id":"uuid-v4","started_at_tv":"2026-10-12T19:05:00+05:30","ended_at_tv":"2026-10-12T19:17:40+05:30","floor_dbfs":-58.4,"floor_ok":true,"cal_peak_above_floor":14.0,"target_above_floor":13.0,"target_rule":"same_session","phonation_longest_s":14.2,"windows":["w_floor","w_cal","w_ahh","w_p01","..."],"reached":7,"attempted":10,"noisy_blocks":1,"transport":"wss","latency_ms_p50":null,"agc_reported":false,"ua":"Chrome Android","complete":true}
```

**SampleWindowSummary** (embedded in the session under `window_summaries`; raw 20 Hz samples are never persisted)
```json
{"win":"w_p03","phrase_id":"p_03","t_start_tv":1760000012000,"t_stop_tv":1760000018300,"t_phone_first":1760000012050,"t_relay_first":1760000012190,"t_tv_recv_first":1760000012230,"frames":120,"frames_dropped":0,"pre_floor_dbfs":-57.9,"p95_above_floor":26.8,"peak_above_floor":29.1,"active_ms":1850,"onsets":1,"verdict_auto":"reached","verdict_listener":null,"latency_ms_est":180}
```

**ListenerVerdict** (family mode; embedded as `verdict_listener`)
```json
{"win":"w_p03","verdict":"heard","t_phone":1760000019000,"t_tv_recv":1760000019210}
```

**WeeklySummary** (derived on read; cached at `atr:week:<iso-week>`)
```json
{"week":"2026-W42","days":[{"date":"2026-10-12","sessions":1,"reached":7,"attempted":10,"longest_phonation_s":14.2,"cal_peak_above_floor":14.0}],"sample_data":false}
```

**Relay records (DynamoDB `atr-relay`, ap-south-1; no personal data)**
```json
{"pk":"ROOM#483921","room_id":"uuid","created_at":1760000000,"expires_at":1760007200,"tv_conn":"R0oXAdfD0kwCH6w=","phone_conn":null,"token_hash":"sha256(...)","msg_count":0}
{"pk":"CONN#R0oXAdfD0kwCH6w=","role":"tv","room":"483921","expires_at":1760007200}
```

### 6.2 Authorization boundaries

- No accounts anywhere. The 6-digit room code is the only credential to join; it is valid 2 hours (matching API Gateway's 7,200 s connection maximum) and is replaced on every new session.
- The relay issues an HMAC token (`HMAC-SHA256(secret, room|exp)`) on `join`; the phone stores it in `sessionStorage` only and presents it on reconnect. The secret lives in the Lambda environment; it is rotated by redeploying.
- One TV and one phone per room, enforced by a DynamoDB conditional write (`attribute_not_exists(phone_conn) OR token_hash = :h`); a second phone receives `ROOM_FULL`.
- The relay never stores, logs or inspects `payload`; it only reads `action` and `to`. CloudWatch logs record connection ids, route, size and result code.
- The TV accepts `phrases` and `verdict` only from the paired phone connection (the relay enforces the pair). Settings actions (reset, delete) are TV-only and never reachable from the phone.
- No audio is captured by the TV, stored on the phone, or transmitted. The phone page has no analytics and no third-party scripts.

### 6.3 Timestamps

Three clocks, kept separate and named: `t_phone` (capture time, `performance.timeOrigin + performance.now()`), `t_relay` (Lambda receipt, `Date.now()`), `t_tv_recv` and `t_tv_render` (TV receipt and frame commit, `Date.now()` and a `requestAnimationFrame` callback). Human-readable session times are ISO 8601 with the TV's offset (`+05:30`). The on-screen latency is an estimate using the clock-offset formula in §5.3; the README's latency table reports camera-measured clap latency as the ground truth.

### 6.4 Lifecycle and deletion

| Data | Where | Lifetime | Deletion |
|---|---|---|---|
| Profile, phrases, sessions, weekly cache | TV AsyncStorage | Until deleted | Settings > Delete my data (two-step confirm) runs `multiRemove` on all `atr:*` keys and shows "All data deleted" |
| Room token | Phone `sessionStorage` | Browser tab lifetime, at most 2 h | Closing the tab; token expiry |
| Room and connection records | DynamoDB | `expires_at` = created + 7,200 s; TTL deletes typically within a few days, so reads also check `expires_at` | Automatic (TTL); `$disconnect` deletes `CONN#` items eagerly (best effort) |
| Relay logs | CloudWatch Logs | Retention 14 days `[assumption]` | Log group retention policy |
| Polly MP3s, phone page | S3 + CloudFront | Through 20 Nov 2026 | Stack teardown after judging |
| Fixtures | Repo | Permanent, synthetic or developer-recorded numbers only | n/a |

---

## 7. Tool and operation design

### 7.1 Read vs write operations

| Operation | Side | Kind | Notes |
|---|---|---|---|
| `getProfile`, `listSessions(range)`, `getWeek(iso)` | TV | read | AsyncStorage; pure selectors in `apps/tv/src/store` |
| `startSession()` | TV | write | Creates `session_id` (idempotency key) and writes an incomplete session |
| `recordWindow(session_id, summary)` | TV | write | Upsert by `win`; replays are idempotent |
| `finishSession(session_id)` | TV | write | Sets `complete: true` and updates the weekly cache; safe to call twice |
| `savePhrases(items)` | TV | write | Replaces the array; validated (1-10 items, 1-60 chars) |
| `resetBaseline()` | TV | write, confirmation required | Clears `monotonicity_ok`, `first_cal_peak_above_floor` and the last five sessions' calibration values used for the cross-session target |
| `deleteAllData()` | TV | write, confirmation required | Two-step overlay; irreversible |
| `join(code)` | Relay | write | Conditional put; returns token |
| `relay(to, payload)` | Relay | write (ephemeral) | PostToConnection; no persistence |
| `ping` | Relay | read | Warms the function; returns `t_relay` |
| `GET /pull`, `POST /push` | Relay (fallback) | read / write | Only if long-poll is deployed |

### 7.2 Confirmation-required actions
Delete my data and Reset baseline open a full-screen overlay with Cancel preferred-focused, a 40 px explanation of what is lost, and Confirm reachable only by Right then OK. VoiceView announces the overlay. Nothing on the phone page can trigger either.

### 7.3 Persistent state
TV: AsyncStorage keys `atr:profile`, `atr:phrases`, `atr:session:<id>`, `atr:index` (array of session ids), `atr:week:<iso>`. Phone: `sessionStorage` token and room only. Relay: DynamoDB items above. The TV state machine (`idle -> pairing -> calibrating -> warmup -> phrases -> summary`) is in memory and rebuilt from the incomplete session on relaunch ("Resume session?" with Resume preferred, Discard second).

### 7.4 Idempotency
`session_id` is minted once per session on the TV and sent to the phone in `calibration`; every `window_result` carries `win`, and the TV upserts by `(session_id, win)`. A re-sent `window_result` (phone reconnect) replaces rather than duplicates. The relay's `join` is idempotent for the same token hash. Weekly cache recomputation is a pure function of the session list.

### 7.5 Timeouts and retries
WebSocket connect timeout 5 s; reconnect backoff 0.5 to 8 s, give up after 60 s with a manual retry. Heartbeat every 1 s from the phone; the TV declares the phone paused after 3 s. `clock_ping` every 60 s (median of the last 5 offsets). Lambda PostToConnection: one retry on 5xx, none on `GoneException` (the connection is deleted instead). Polly `Audio` load timeout 3 s then text-only. AsyncStorage writes retried once; failures surface as a non-blocking banner and are logged in the session's `errors` array.

### 7.6 Audit records
Every session carries an append-only `log` array of `{t_tv, event, detail}` entries: `paired`, `floor_ok`, `cal_set`, `window_open`, `window_closed`, `noisy_block`, `no_voice`, `link_lost`, `link_restored`, `transport_fallback`, `listener_verdict`, `finished`, `error`. Settings > About shows the last 50 entries as plain text for the friction log. The relay's CloudWatch logs hold connection-level events only. No audit record contains audio, phrase text or free text typed by a user.

### 7.7 Session state machine (TV)

| State | Entry condition | Allowed remote input | Exit events |
|---|---|---|---|
| `idle` | app launch, or Done on S5 | OK Start, D-pad on Home | `start` -> `pairing` (or -> `calibrating` if a phone is already live) |
| `pairing` | room created on the relay | Back (cancel) | `paired` + `mic_state: live` -> `calibrating`; 10 min without pairing -> `idle` with a note |
| `calibrating.floor` | OK on Begin | none during the 5 s window | `floor.ok` -> `calibrating.phrase`; `floor.ok=false` -> `calibrating.retry` |
| `calibrating.phrase` | floor ok | none during the 6 s window | `window_result` with margin >= 6 dB -> `warmup.ready`; else -> `calibrating.retry` |
| `warmup.window` | OK on Begin after the Polly prompt `ended` + 1 s | none | `stop_window` -> `warmup.result` |
| `phrases.card[i]` | OK on Next | none while the window is open; after close: Next, Try again, Finish early | `window_result` -> verdict shown; OK -> `phrases.card[i+1]` or -> `summary` after 10 |
| `blocked.noisy` | pre-window floor rule fails | Retry, Skip phrase | -> previous window state or next card |
| `paused.link` | heartbeat missing 3 s | Back only | `link_restored` -> previous state (window cancelled, not scored); 60 s -> `pairing` |
| `summary` | Finish or Back after the first phrase | Done, View history, Export on phone | -> `idle` or `history` |
| `resume?` | incomplete session found at launch | Resume (preferred), Discard | -> last stored state or `idle` |

Settings, History and the overlays are modal and return to the state they interrupted. Every transition appends to the session `log` (§7.6).

---
## 8. Evaluation plan (measurement validity; no LLM in the critical path)

There is no model to evaluate, so the evaluation asks whether the measurement is valid: does the far-mic number track real loudness, does it arrive in time, does the gate refuse bad rooms, does VAD time phonation correctly, and does the "reached" verdict avoid false positives. **No results exist yet; every threshold below is a target set before measurement.**

### 8.1 AGC-off monotonicity test (the K1 reversal test; day 1, repeated day 3)
- Setup: Android phone, Chrome, phone page over HTTPS (on day 1, before the cloud deploy, a temporary HTTPS host or USB port forwarding so the phone loads a `localhost` origin; same-Mac localhost would test the Mac mic, not the phone), on its taped mark; laptop speaker at a marked 2.5 m playing a 1 kHz tone `[assumption: tone frequency]` at three relative levels 6 dB apart (laptop volume steps calibrated once with the same phone and recorded as the reference); 10 repeats per level, randomized order; 3 s per repeat, 2 s gaps.
- Metrics: (a) monotonic ordering of the three level means; (b) per-level standard deviation of the window p95 at most 1 dB; (c) per-level range at most plus or minus 2 dB; (d) step slope: measured step between adjacent levels at least 4.5 dB for a 6 dB nominal step (ratio at least 0.75) `[assumption]`.
- Pass sets `monotonicity_ok = true` and enables cross-session dB; fail on two phones or browsers (Chrome, Samsung Browser) triggers K1 (Mail Check if before 6 Oct evening, Listener Edition at the 8 Oct gate). Repeat on iPhone Safari and record the expected failure (MDN: constraint unsupported).
- Also record `track.getSettings().autoGainControl` and the user agent for the README table.

### 8.2 Latency clap test (day 2, after the relay deploys; repeated on video day)
- Setup: camera at 60 fps `[assumption]` framing both the phone and the TV; 20 claps near the phone; the TV arc and latency readout visible.
- Metrics: frame count from the clap transient (camera audio) to the first arc movement, converted to ms; report p50, p95, max; compare with the on-screen estimate (`t_tv_recv - t_phone - offset`). K3: p50 under 300 ms over WSS or under 500 ms over long-poll; otherwise end-of-window results replace the live arc and the latency is stated on screen.
- Also log Lambda duration and `t_relay - t_phone` for 60 s of 20 Hz samples to separate network from compute. All numbers are reported in the README latency table with date, network (home broadband, ISP unnamed) and Region.

### 8.3 Noise-floor gate tests (fixtures plus live)
- Fixtures: `quiet_room.json` (floor about -58 dBFS `[example]`), `fan_noise.json`, `tv_speech.json`, `floor_rise_mid_window.json`, each a 20 Hz `dbfs` series with a labelled expected gate decision.
- Metrics: false-block rate on quiet fixtures 0/10; block rate on speech-at-listener fixtures 10/10; `floor.ok=false` on the unstable fixture. Live check: a person speaking at the far side during the 5 s quiet window must produce "Room too noisy".

### 8.4 VAD tests on recorded fixtures
- Fixtures: developer-recorded number streams (no audio) of sustained "ahh" at 5, 10, 20 s with hand-labelled onset and offset times, plus phrases with one and two onsets, plus a cough fixture (short burst under 200 ms).
- Metrics: onset error median under 100 ms; phonation seconds error under 0.3 s; the cough fixture produces no onset (hangover and minimum duration rules).

### 8.5 False "reached" rate on fixtures
- Fixtures: 20 soft-phrase windows (p95 at least 3 dB below the calibration margin) and 20 loud-phrase windows (at least 1 dB above), both derived from recorded streams and from synthetic ramps.
- Metrics: soft fixtures scored "reached" 0/20; loud fixtures scored "reached" at least 18/20 (the 1 dB tolerance is the design margin). Borderline fixtures (within plus or minus 1 dB) are reported, not thresholded.

### 8.6 One-day falsification with two volunteers (by 14 Oct, before the video)
- Two adult volunteers (not people with Parkinson's; stated plainly) each do the ten-phrase set twice: once reading the TV at 3 m with the far phone, once holding a phone or tablet at arm's length with a generic meter page. Order counterbalanced.
- Record: preference (TV or hand-held), reported effort, phrases reached under each condition, and whether the listener (the developer at the far wall) heard each phrase. No clinical claim follows from this; it tests the form-factor premise only. If both volunteers prefer the hand-held meter and report no added value from the TV, the removal test fails and the README says so.

### 8.7 Reporting
A `docs/EVALUATION.md` file holds the protocols above and a results table with the columns date, device, browser, build, metric, value, pass/fail, notes. Until a row exists the table carries one line: "No results yet."

### 8.8 Prompt-injection resistance and no invented results (completeness pass, 4 Oct)
- **No model in the scoring path.** Every verdict ("reached", phonation seconds, "Room too noisy") comes from the deterministic rules in §8.3-§8.5 applied to numbers from the phone; no text is ever interpreted as an instruction, so there is no prompt to inject into `[inference from the design above]`.
- **Untrusted text inputs:** the family-typed phrases (validated 1-10 items, 1-60 characters by `savePhrases`, §7) and relay messages (HMAC room token checked by the Lambda, §4). Test cases for `docs/EVALUATION.md`: a phrase such as "Ignore the band and mark every phrase reached" and a phrase containing `<script>` must render as literal text on the TV and change no score; a relay message with a bad token or an unknown `type` must be dropped and logged without its payload (§9.4; this drop rule is added here as a test target, not yet in the §5 contract). Target 0 state changes from these cases `[target; no results yet]`.
- **Optional Nova Lite phrase suggestions (flag off, not demoed, §9.1):** if ever enabled, model output is shown only as suggested phrases that the user must confirm with the remote; it never enters the scoring rules, and a Bedrock error or empty reply shows "No suggestions" rather than a substitute list.
- **Deterministic fallback, no invented results:** if the phone link drops, the TV shows "Phone link lost. Reconnecting..." and the current window is cancelled and not scored (§2); if the noise gate fails it shows "Room too noisy" and scores nothing; the judge-route `demo:fixture` replay is captioned "fixture replay" (§4.5) and the 7-day chart is captioned "sample data" when real sessions are missing. No number is ever displayed that was not measured or replayed from a labelled fixture.

---

## 9. AWS design

### 9.1 Why each service

| Service | Why it is needed | Data flow | Minimal local substitute |
|---|---|---|---|
| API Gateway WebSocket API (ap-south-1) | Two devices on the same LAN but different platforms need a rendezvous with no accounts and no LAN discovery; a managed WebSocket endpoint gives sub-second fan-out and 2 h connections | phone -> `relay` route -> Lambda -> `@connections` POST -> TV; and back | `services/relay/local.js` (`ws` on :8787) |
| Lambda (one function) | Pairing logic, HMAC tokens, conditional writes, fan-out; nothing to keep warm through judging except the free-tier function | invoked per message | the same handler module imported by `local.js` |
| DynamoDB (one table, TTL) | Room and connection registry that survives Lambda cold starts; conditional write prevents a second phone hijacking a room | `join`, `$connect`, `$disconnect` | in-memory `Map` in `local.js` |
| S3 + CloudFront | HTTPS hosting for the phone page (getUserMedia needs a secure context) and for Polly MP3s | TV fetches MP3s; phone loads the page | `npm run phone:dev` on localhost |
| Polly | Consistent spoken prompts synthesized once, so the TV plays files and never calls a speech service live | CLI -> S3 at build time | text-only prompts (also a runtime fallback) |
| Budgets, CloudWatch billing alarm, Cost Anomaly Detection | Spend guardrails while the stack stays live to 20 Nov | n/a | n/a |
| Bedrock Nova Lite (optional, not required) | Suggest household phrases; gated behind an explicit "Suggest" action on the phone page and remote confirmation on the TV; not demoed; Nova is geo-only in ap-south-1 and new-account quota-0 reports exist | phone page -> HTTP route -> Lambda -> Bedrock (us-east-1) | none (feature flag off) |

Sources: API Gateway endpoints and quotas (`.firecrawl/oct4/rt2ftv4-aws-gr-apigateway.md`); WebSocket pricing: messages metered in 32 KB increments, ping/pong control frames not metered, free tier 1M messages and 750,000 connection minutes per month for 12 months, example rates $1.00 per million messages and $0.25 per million connection minutes ([pricing](https://aws.amazon.com/api-gateway/pricing/), `.firecrawl/aws-apigw-pricing.md`) `[verified; the 12-month offer for post-July-2025 accounts is not verified]`; Lambda $0.20 per 1M requests and 1M free requests per month (`.firecrawl/aws-lambda-pricing.md`) `[verified]`; DynamoDB on-demand $0.625 per 1M WRU (Ohio rendering) (`.firecrawl/aws-dynamodb-ondemand-pricing.md`) `[verified for Ohio]`; Polly Standard $4.00 per 1M characters, 5M characters per month free, cached speech replay at no additional cost (`.firecrawl/oct4/spec4-polly-pricing.md`) `[verified]`; Bedrock Region matrix (`.firecrawl/aws-bedrock-models-region-compat.md`) `[verified]`.

### 9.2 Volume and cost estimate (all `[estimate]`)
A 15-minute session at 20 Hz during about 8 minutes of open windows is about 9,600 sample messages (8 x 60 x 20) plus about 1,000 control and heartbeat messages, each one Lambda invocation; 30 sessions of development and judging are about 320,000 relayed messages (30 x 10,600 = 318,000). Metered both in and out (§5.2) that is about 640,000 WebSocket messages. Connection minutes for the sessions themselves are about 900 (30 x 15 min x 2 connections); 60,000 is kept as a generous ceiling for connections left open during development. Inside the free tier if it applies; otherwise about $0.64 for messages ($1.00 per million) + $0.06 for Lambda requests ($0.20 per million) + at most $0.02 for connection minutes ($0.25 per million) + a few cents of Lambda compute, so under $1. Polly: about 15 prompts under 1,500 characters total, inside the free tier. DynamoDB: a few hundred writes. CloudFront: a few MB. Expected total through 20 Nov: under $5 `[estimate]`; budget alarm set at $5 and $15.

### 9.3 One real observed integration to demonstrate
The README's latency table (§8.2): 20 camera-measured claps over the deployed ap-south-1 relay with p50/p95/max, the on-screen estimate beside each, the Lambda duration distribution from CloudWatch, and the WebSocket-vs-long-poll spike result. This is the AWS Builder story: a documented, measured, live integration rather than a model call. Placeholder until measured: "No results yet."

### 9.4 Logging
Lambda logs one structured JSON line per invocation: `{route, connection_id, room, size_bytes, result, t_relay, duration_ms}`; never the payload. Log group retention 14 days `[assumption]`. The TV and phone keep no remote logs. A jest test asserts the handler's logger redacts `payload`.

### 9.5 Budget controls
- AWS Budgets: a monthly cost budget with alerts at $5 actual and $15 forecast by email; budget monitoring and notifications are free, the first two action-enabled budgets are free, then $0.10 per day each ([Budgets docs](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html), `.firecrawl/aws-budgets-docs.md`; [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), `.firecrawl/oct4/exec1-aws-budgets-pricing.md`) `[verified]`. One action-enabled budget attaches a deny-provisioning IAM policy at $25 `[assumption]`.
- CloudWatch billing alarm at $10: requires enabling billing alerts; the metric lives in us-east-1 and fires on actual charges only ([docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html), `.firecrawl/aws-billing-alarm-docs.md`) `[verified]`.
- Cost Anomaly Detection monitor on the account: runs about three times a day on data with up to a 24-hour delay and needs 10 days of history for a new service, so it is a backstop, not the guardrail ([docs](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html), `.firecrawl/aws-cost-anomaly-docs.md`) `[verified]`.
- Promotional credits ($150, request by 21 Oct 12:00 PT) need a Paid-plan account with a card; not required for this budget ([credit terms](https://aws.amazon.com/awscredits/), `.firecrawl/aws-credits-terms.md`; brief §9) `[verified]`.

### 9.6 Development tooling note for the AWS Builder entry
Development with Kiro Crew or Claude Code on Bedrock qualifies per the rules and forum 45321 (brief §5); if used, say so in the Product Feedback answer. The runtime integration above is the primary claim; the tooling is secondary. `[not verified which tool the developer will use]`

---

## 10. Open-source contribution

**Repository:** `ten-foot-meter` (separate public repo, MIT licence file in the About section, created inside the hackathon window) containing two npm packages:

1. `packages/ten-foot-meter` (React Native for Vega): `ArcMeter` (filled arc with a band tick and interpolation between samples), `SustainCounter` (seconds with a "longest" reference), `WeekBars` (seven labelled bars), `RoomCodeQR` (QR as SVG rects from a pure-JS encoder), all sized through an injectable scale hook so the Vega `useScaledSize` binding is the default and a plain-RN fallback (`scale = 1`) works off Vega. Tests: jest on the geometry functions (arc path for a given fraction, bar heights, QR matrix for a known string) and snapshot tests with the scale hook mocked at 1.0 and 1.5.
2. `packages/phone-mic-meter` (browser, dependency-free): `rmsToDbfs`, `estimateFloor`, `vad(frames, opts)`, `windowSummary`, `reachedRule`, `clockOffset`, plus an adapter `createMicMeter({audioContext, analyser, rateHz})`. Tests: jest on the recorded number-stream fixtures from §8 (quiet, fan, speech, sustained, cough, soft and loud phrases); no browser needed.

**Why it helps other developers:** TV apps on Vega have no gauge components bound to the system UI-scale setting, and phone-as-sensor TV apps (karaoke, fitness, games) all need a tested, audio-free loudness and VAD module with explicit AGC handling. The README documents the Vega a11y binding pattern and the AGC caveats with the MDN table.

**Intended contribution URL placeholder:** `https://github.com/<github-username>/ten-foot-meter` (fill at submission; also enter the primary repo URL, the GitHub username and the what/how/why text required by Rules §4).

**Rules fit:** the Open Source mini challenge needs "a new, additional" OSS project or a contribution made during the window alongside the primary entry; a fresh OSS repo created in the window is acceptable (forum 45310, brief §5). Making the primary repo public alone may not satisfy it, so the separate repo is the deliverable. `[verified from the brief; organizer interpretation of "additional" is the brief's reading]`

**Optional (labelled optional, only if 8 h remain after the video is cut):** a PR adding Vega support (`@amazon-devices/react-native-svg` import path and a UI-scale prop) to a popular RN gauge library such as `react-native-circular-progress`, which matches the rules' Creative example "adding Vega support to a popular React Native library"; the maintainers' stance is `[not verified]`, and an unmerged PR still counts.

---

## 11. Repository, environment, commands, fixtures and README outline

### 11.1 Minimal tree (primary repo `across-the-room`)

```
across-the-room/
  README.md                    judge-facing (outline in 11.5)
  LICENSE                      MIT
  docs/
    EVALUATION.md              protocols and the "No results yet" table
    FRICTION_LOG.md            daily entries (task, steps, expected vs actual, severity, workaround, suggestion)
    LATENCY_TABLE.md           placeholder until measured
    RIVALS.md                  rival table with "not verified in reviewed sources"
  apps/
    tv/                        React Native for Vega app
      manifest.toml
      package.json
      src/screens/             Home, Pair, Calibration, Ahh, Phrase, Summary, History, Settings
      src/components/          Focusable, Banner, Footer, LatencyReadout
      src/relay/               ws client, long-poll client, local relay settings
      src/store/               AsyncStorage repository, selectors, state machine
      src/rules/               reachedRule, noisyGate, target (imports phone-mic-meter)
      assets/prompts/          Polly MP3s (checked in; small) and prompts.json
    phone/                     static page (TypeScript, Vite)
      index.html
      src/mic.ts               getUserMedia, AnalyserNode loop, Wake Lock
      src/relay.ts             ws client, reconnect, long-poll fallback
      src/ui.ts                states P0-P5
  services/
    relay/
      template.yaml            SAM: WebSocket API, Lambda, DynamoDB, S3, CloudFront, Budgets
      src/handler.js           routes: $connect, $disconnect, $default, join, relay, ping
      src/local.js             local relay (ws + http) sharing handler logic
      test/handler.test.js     pairing, token, redaction, GoneException handling
  fixtures/
    streams/*.json             recorded number streams (dbfs at 20 Hz), labelled
    synthetic/*.json           generated ramps and tones (descriptions, not audio)
    README.md                  provenance and labels
  scripts/
    synthesize-prompts.sh      aws polly synthesize-speech loop
    vvd-walkthrough.sh         inputd-cli button_press script for AC-1.2
    clap-test-notes.md         how the latency table is produced
  .env.example
```

### 11.2 `.env.example` (names only; no values)

```
RELAY_WSS_URL=
RELAY_HTTP_URL=
RELAY_LOCAL_URL=
ROOM_TOKEN_SECRET=
AWS_REGION=
AWS_PROFILE=
DDB_TABLE=
ASSETS_BUCKET=
CLOUDFRONT_DOMAIN=
POLLY_VOICE_ID=
POLLY_ENGINE=
FEATURE_FAMILY_MODE=
FEATURE_LONG_POLL=
FEATURE_NOVA_SUGGEST=
BUDGET_ALERT_EMAIL=
```

### 11.3 Setup and run commands (to verify on day one; record outcomes in the friction log)

```
# host
softwareupdate --install-rosetta --agree-to-license
nvm install 20 && nvm use 20 && node -v
df -h /
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
vega --version
vega virtual-device start --display-res=1920,1080
# tv app
cd apps/tv && vega project update-manifest --os-min 1.2 --os-version 1.2   # SDK 0.24 [os.version] block (release notes)
npm install && npm run build:vvd                   # produces build/aarch64-release/*_aarch64.vpkg
vega exec vpt validate "$PWD/manifest.toml"
vega run-app build/aarch64-release/<name>_aarch64.vpkg com.example.acrosstheroom.interactive -d VirtualDevice
# phone page
cd apps/phone && npm install && npm run dev        # http://localhost:5173
# relay (cloud)
cd services/relay && sam build && sam deploy --guided --region ap-south-1
# relay (local, judges)
npm run relay:local                                # ws://<mac-lan-ip>:8787
# prompts
./scripts/synthesize-prompts.sh                    # aws polly synthesize-speech ... --output-format mp3
# tests
npm test                                           # jest: phone-mic-meter, ten-foot-meter, relay handler
```

The `build:vvd` script name, the exact `vega` subcommands and the vpkg path pattern come from the digest (`firetv.md` §2-3) and must be confirmed against the SDK's own help on day one `[unverified]`.

### 11.4 Fixture strategy
- **Recorded number streams** (`fixtures/streams/`): the developer records 20 Hz `dbfs` series from the phone page in known conditions (quiet room, fan, TV speech, sustained "ahh", phrases, cough) and hand-labels onsets, offsets and expected verdicts. No audio is stored; each file carries `recorded_by`, `date`, `device`, `browser`, `agc_reported`, `distance_m`.
- **Synthetic series** (`fixtures/synthetic/`): generated ramps, steps and tones as dbfs values with a `generator` field and parameters, used for monotonicity and gate unit tests.
- **Labelling:** every fixture file and every chart built from fixtures says `source: recorded` or `source: synthetic`; the demo's `demo:fixture` replay shows "fixture replay" on the TV. The 7-day chart in the video is labelled "sample data" unless seven real dated sessions exist.

### 11.5 Judge-facing README outline
1. Thesis sentence (one line) and a 20-second GIF of the far-side check.
2. What it is, who it is for ("anyone told by a clinician to practise speaking louder, and the household listener"), and the not-a-medical-device statement: "Not a medical device. Does not diagnose or treat any condition. Practice support for the loudness exercises your clinician gave you."
3. Verified-vs-labelled table: each component (VVD app, remote control, far-mic numbers, relay, a11y scaling, 7-day chart, iPhone mode, family mode with the one-cue listener and agreement count, blind-check phrases, mic-state badge; Polly prompts and the caregiver export only if those stretch items ship) with Real / Labelled limit and the evidence (test, video timestamp). The 4 Oct additions also bring two README lines: the mic stops at the end of each session, so the next session needs one tap on the phone to restart it (§13.2), and one roadmap line for an on-device words check (deferred, §13.7).
4. Latency table (placeholder "No results yet" until §8.2 runs), with the WebSocket-vs-long-poll spike result.
5. How to run: cloud relay (live to 20 Nov 2026) and the local judging route (§4.5), plus fixture replay.
6. Measurement notes: relative dB only, no SPL claims, AGC handling and the MDN table, same-session calibration, cross-session rule and when it is disabled.
7. Rival table (`docs/RIVALS.md` summary): Loud and Clear, Speak Up For Parkinson's, Voicibel, clinician-licensed PC coaching software, the SpeechVive wearable, generic dB meters, karaoke phone-mic TV systems; one line each on what they do; "not verified in reviewed sources" for the far-side gap. Rival product names appear only in this README comparison, never in TV UI copy (§3.4) or the video (Rules §4 trademark clause). Sources: `.firecrawl/oct4/rt2ftv4-loud-and-clear-appstore.md`, `rt2ftv4-speakup-pd-appstore.md`, `rt2-ftv4-mars-pd-speech-apps.md`, `rt2ftv4-pmc12917486.html`.
8. Priority-category mapping: fitness and multi-modal UX; the Creative example "voice + D-pad + visual in a single flow" with the plain statement that the voice is acoustic input, not Alexa.
9. Evidence of need: JMIR Rehabil Assist Technol (4 Feb 2026) "no specific Alexa skills for adults with Parkinson's or targeting dysarthria"; MARS review (doi 10.2196/72214) "observing progress is very subjective" and apps "targeted toward the patient rather than the caretaker". Prevalence cited in text only.
10. Open Source: link to `ten-foot-meter`. AWS: architecture and budget. Friction log link. Licence.

---

## 12. Deliverables and estimated engineering hours (researched estimates; nothing measured)

Capacity assumption: about 6.5 focused hours per day over 16 net build days (two reserve days untouched) is about 104 h. Estimates assume a developer fluent in React/TypeScript and new to Vega and SAM. Every figure is an unmeasured estimate.

| # | Deliverable | Contents | Solo hours (estimate) |
|---|---|---|---|
| D1 | Toolchain and day-one spikes | Rosetta, Node 20, SDK 0.24, VVD boot, hello-world; WebSocket echo spike (and long-poll fallback), `Audio` MP3 spike with manifest services, TVEventHandler and 20 Hz SVG spike, a11y getters spike; friction-log entries | 12 |
| D2 | Phone page | getUserMedia with AGC off, AnalyserNode loop, floor, VAD, window summaries, Wake Lock and visibility handling, join by code or QR URL, phrase editor, listener control (family mode, flag), reconnect. (4 Oct: export card moved to stretch, −2 h; was 14 h) | 12 |
| D3 | Relay | SAM template (WebSocket API, Lambda, DynamoDB TTL, S3, CloudFront, Budgets), handler with conditional pairing and HMAC tokens, PostToConnection fan-out, redaction, local relay script, long-poll endpoints behind a flag, deploy to ap-south-1 | 10 |
| D4 | TV app | Screens S0-S7 and overlays, focus order, Focusable wrapper, UI-scale binding, VoiceView labels, arc and bars, state machine, AsyncStorage repository, latency readout, settings (reset, delete, relay mode). (4 Oct: Polly playback moved to stretch, text prompts only, −2 h; was 26 h) | 24 |
| D5 | Measurement logic and tests | Pure DSP and rule functions, jest fixtures (recorded and synthetic), relay handler tests, AGC monotonicity protocol run on day 1 and day 3, clap-test latency table, EVALUATION.md | 9 |
| D6 | Falsification and daily friction log | One-day two-volunteer test with write-up; daily friction entries across the build | 6 |
| D7 | Open-source repo | Extract `ten-foot-meter` and `phone-mic-meter`, tests, README with the a11y binding pattern and AGC caveats, MIT, publish | 7 |
| D8 | Video | Script, VVD restart routine, one unedited timed take with latency readout and clap test, captions ("Vega Virtual Device", "sample data" if needed), upload | 8 |
| D9 | Submission package | README per §11.5, RIVALS.md, Product Feedback answers per tool, AWS Builder and Open Source fields, rules re-diff on 22 Oct, budget alarms, reviewer invites or public licence check | 6 |
| D10 | 4 Oct feature additions, core (§13) | Blind-check phrases with felt-versus-reached reveal and S5 counts (5); honest mic-state badge, privacy line, `end_session` and `track.stop()` (1.5); one-cue listener with a 3-cue cap, neutral chip and meter/listener agreement count (2) | 8.5 |
| | **Total** (12 + 12 + 10 + 24 + 9 + 6 + 7 + 8 + 6 + 8.5; before 4 Oct it was 98 h) | | **102.5 h (estimate)** |
| | Stretch, not in the total (§13.4-§13.6; only after the Wed 14 Oct K4 take and before the Mon 19 Oct freeze, in this order) | Inline "why" line (1.5); starter phrase set written from scratch (1); caregiver export (2); Polly prompts (2) | 6.5 (estimate) |

Cut order if behind (K4, 14 Oct checkpoint; revised 4 Oct): Polly prompts and the caregiver export are already out of the core (see the stretch row), so any stretch item not yet started goes first; then the Open Source publication (-7 h, keep the code in the primary repo); family mode with the one-cue listener and agreement count is protected and cut only as a last resort (-5 h), because it carries the agreement count and is the core of the FTV-4F fallback. Protect D8 and D9. No NEW-4 pairing kit and no speech-recognition spike are added (§13.7).

**Duo split (estimate, about 14-15 percent coordination included):**
- Person A (TV and video): D1 Vega toolchain and TV spikes (9), D4 (26), D8 (8), half of D6 (3), half of D9 (3), coordination (7) = about 56 h.
- Person B (phone, relay, measurement, OSS): D1 phone and AWS parts (3), D2 (14), D3 (10), D5 (9), D7 (7), half of D6 (3), half of D9 (3), coordination (7) = about 56 h.
- Check: D1 split 9 + 3 = 12 h as in the solo table; 98 h work + 14 h coordination (about 14 percent) = 112 h across the pair. (Corrected 4 Oct: the earlier split gave D1 14 h in total against 12 h solo.)
- 4 Oct feature additions (§13): D4 and D2 each lose 2 h (Polly and the export card move to stretch) and D10's 8.5 h split about 5.5 h to Person A (blind-check states and buttons, badge, cue chip) and 3 h to Person B (`end_session` and `track.stop()`, cue control and cap, agreement function and tests, P4 lock on `reveal`). New totals about 59.5 h (A) and 57 h (B): 102.5 h work + 14 h coordination = 116.5 h across the pair (estimate).
- Both run the AGC monotonicity test on day one; the duo should also re-read the selection memo's sensitivity note that a two-person team tilts the recommendation toward FTV-3 Mail Check.

### 12.1 Build calendar (solo; dates IST; all durations are estimates)

| Date | Work | Gate or checkpoint |
|---|---|---|
| Mon 5 Oct | D1: Rosetta, Node 20, SDK, VVD, hello-world; WebSocket echo, Audio, input, SVG, a11y spikes; AGC monotonicity test on Android Chrome and iPhone Safari (the phone needs a secure context: the Mac's `localhost` is not `localhost` on the phone, so use a temporary HTTPS host or USB port forwarding so the phone itself loads a `localhost` origin `[unverified here]`; same-Mac localhost only tests the Mac mic) | Record every spike result in the friction log; K1 known early if AGC fails |
| Tue 6 Oct | D3: SAM deploy to ap-south-1, phone page skeleton streaming a synthetic 20 Hz signal, clap test p50 on camera; Office Hours #1 at 23:00 IST (optional) | K1 decision point if AGC failed Mon-Tue: switch to FTV-3 Mail Check |
| Wed 7 Oct | D2: real mic path, floor, VAD, silent windows, noisy gate; second Android phone or Samsung Browser re-test if day 1 was marginal | K2: hello-world must run on the VVD by tonight or switch to ALX-5 |
| Thu 8 Oct | TV screens S1-S4 wired to the relay; end-to-end calibration -> ahh -> one phrase; after the gate, design the blind-check `rate` and `reveal` sub-states on paper (§13.1) | 20:00 IST abandon milestone: (a) relay delivers numbers at usable latency, (b) AGC test passed on one phone, (c) silent windows and gate work; else Listener Edition, whose §13.8 bundle replaces the blind-check items |
| Fri 9 - Sun 11 Oct | D4: remaining screens, focus order, UI-scale binding, VoiceView labels, AsyncStorage, summary and history; D5 fixtures and jest; D10: mic-state badge, privacy line and `end_session` (Fri 9, with S1-S4; 1.5 h), blind-check phrases with reveal and S5 counts (Sat 10 - Sun 11; 5 h) | Start daily real sessions so seven dated sessions exist by filming |
| Mon 12 - Tue 13 Oct | D4 polish, settings (reset, delete, relay mode), local relay script and fixture replay; D5 latency table; family mode moved forward from Thu 15 Oct and reshaped as the one-cue listener with the agreement count (§13.3; 3 h existing + 2 h D10) | Polly prompts no longer here (stretch, text prompts only) |
| Wed 14 Oct | Full core loop recorded in one unedited timed take on the VVD, including one blind-check phrase and the mic-state badge; D6 two-volunteer falsification, also recording meter/listener agreement (report it in EVALUATION.md, and keep it out of the video if it is low, for example under 70 percent) | K4 scope freeze check; revised cut order applies if not recorded (§12, §13.9) |
| Thu 15 - Sat 17 Oct | D7 Open Source extraction and tests, README drafts, RIVALS.md; stretch only if K4 passed, in order: inline "why" line (1.5 h), starter phrase set (1 h), caregiver export (2 h), Polly prompts (2 h) | Oct 15 checkpoint for OSS hours; every stretch item done by the Mon 19 Oct freeze or dropped |
| Sun 18 Oct | Buffer: bug fixes, friction log consolidation, EVALUATION.md results | |
| Mon 19 Oct | Feature freeze; Office Hours #2 at 21:30 IST (optional); video script | K6 |
| Tue 20 - Wed 21 Oct | D8: video takes (VVD restarted before each; all other apps closed), captions, upload; credit request by Thu 22 Oct 00:30 IST if wanted | |
| Thu 22 Oct | D9: Devpost text, product feedback, friction log, rules re-diff, reviewer invites or public licence check; internal submission by 20:00 IST | Internal deadline |
| Fri 23 Oct | Recovery only; official deadline Sat 24 Oct 00:30 IST | |

---

## 13. Feature additions from the 4 Oct last-30-days pass

**Source and status.** These additions come from the 4 Oct red-team review of the last-30-days feature proposals (its `feature_verdicts` and `recommended_feature_bundle` decisions, written up in [LAST30DAYS_IDEAS_AND_FEATURES.md](../LAST30DAYS_IDEAS_AND_FEATURES.md) §6). Where the red team changed a proposal, the red-team version is the one specified here. Nothing below is built, measured or tested, and every hour is an unmeasured estimate. Sections already updated to match: §2.1 (steps 6 and 12), AC-5.2, §3.2 (note under the table), §3.4 (new strings and K5 rules), §4.1 (what travels), §5.2 and §5.4 (new message types and validation), §11.5 item 3, §12 (D2, D4, D10, the stretch row, the cut order and the duo split) and §12.1 (calendar). Polly mentions elsewhere in this spec (§3.1, §4.1, §4.2, §4.4, §5.1, §6.4, §9, §11) now describe an optional stretch item, not the core.

### 13.1 Blind-check phrases: felt versus reached (CORE, 5 h)

- **Tier:** CORE (red-team verdict add-to-core, redesigned from the proposal, which asked "How loud did that feel?" after every phrase).
- **What it does (TV):** 3 of the 10 phrases in a session are blind-check phrases (positions 3, 6 and 9 `[assumption]`; with fewer than 10 phrases, every third phrase). During those windows the TV hides the arc and band; the phrase text, countdown ring, counter and the line "Blind check: the meter is hidden for this phrase" stay. When the window closes the TV computes the verdict but holds it and asks "How loud did that feel?" with two focusable buttons, Felt loud and Felt normal (Left/Right moves between them, OK selects, Back skips the rating and stores it as not rated). Buttons are used instead of Up/Down because Up/Down already move focus between Next phrase, Try again and Finish early (§3.2, S4). Both results are then revealed together ("You felt: normal. Far side: reached.") with Next phrase preferred. There is no timeout (AC-2.4). The other 7 phrases keep the live arc. Only the first attempt at a blind-check phrase counts; Try again shows the arc. S5 adds "Felt normal but reached the far side: [n] of [b] blind checks" and "Felt loud but did not reach: [n] of [b] blind checks". There is no Settings toggle (three extra presses a session do not need one), and the proposal's 7-day trend of these counts is not built.
- **User value:** three phrases a session become a check of the person's own sense of loudness against what reached the listener's seat. Clinic guidance describes a normal loudness feeling too loud to the speaker; the app shows the gap without claiming anything clinical. It answers the "just a dB meter on a bigger screen" risk (RECOMMENDATION.md §3, item 3), and hiding the arc stops the live display from anchoring the rating.
- **Judging criterion helped:** Quality of the Idea (main); Potential Impact; Design.
- **Hours:** 5 (estimate; the proposal said 4).
- **Where it fits:** sub-states designed on Thu 8 Oct right after the 20:00 IST gate passes; built Sat 10 - Sun 11 Oct with the D4 screens (in the execution plan's calendar, Sun 11 Oct, the row that held Polly prompts); must appear in the Wed 14 Oct K4 take. If the gate selects FTV-4F, §13.8 replaces this item.
- **Implementation notes:** §7.7 gains `phrases.card[i].rate` and `phrases.card[i].reveal` between `window_result` and the verdict display; the verdict is computed when `window_result` arrives and held until a rating or a skip. The §6.1 `SampleWindowSummary` gains `blind` (boolean) and `felt` (`loud` | `normal` | null). The rating is entered and stored on the TV and never changes the meter verdict; only aggregate counts go to the phone, as fields on `summary` (§5.2). The TV sends `reveal` when it shows the results, so the listener's P4 locks for that window (§13.3). Copy keys `phrase.blind`, `phrase.felt.*` and `summary.felt*` (§3.4); the K5 grep adds "recalibrate", "therapy", "treatment" and programme names. Jest: reducer transitions (rate, skip, reveal), blind positions for 10 and for fewer phrases, first-attempt-only counting, S5 counts on fixtures, and a render test that no arc or band element mounts during a blind window.
- **Real or labelled in the demo:** real on the VVD. The README says the rating is the speaker's own report and does not change the verdict. The video shows one blind-check phrase if the K4 take includes it ([EXECUTION_AND_SUBMISSION.md](../EXECUTION_AND_SUBMISSION.md) §6.2, shot 9).
- **Evidence:** Breatheworks clinic article (updated 2023-08-12), https://breatheworks.com/parkinsons-speech-therapy-lsvt-loud-speak-out/; JMIR 2025 smartphone voice-training study (carry-over to real life not assessed), https://pmc.ncbi.nlm.nih.gov/articles/PMC11888063/; Speak Up For Parkinson's App Store listing (an arm's-length meter), https://apps.apple.com/us/app/speak-up-for-parkinsons/id784117908; inference: no reviewed rival pairs a self-rating with a listener-position measurement (the market was not scanned exhaustively). The blind redesign is the red team's: the 20 Hz live arc (AC-2.1) would otherwise anchor the rating.

### 13.2 Honest mic-state badge and privacy line (CORE, 1.5 h)

- **Tier:** CORE (add-to-core, with the red team's two copy fixes).
- **What it does:** a small badge on S1-S5 says what the phone microphone is doing: "Measuring" while any window is open (room-noise floor, calibration, 'ahh' and phrase windows) and samples are arriving; "Mic open, not measuring" between windows; "Mic off" only after the phone confirms it has stopped. The pair screen (S1) and the phone page (P1, P2) carry the line "No sound is recorded or sent. Only levels and the phrases you type leave this phone." (The proposal's "Only numbers leave the phone" was false, because the typed phrases also travel.) When S5 opens, the TV sends `end_session`; the phone calls `track.stop()`, releases the Wake Lock and replies with `mic_state` `off`. The next session therefore needs one tap on the phone ("Start mic") to reopen the microphone. AC-1.3 is per session, so this is acceptable, and the README says so.
- **User value:** the household can see the microphone's state and has reason to trust it; judges see the no-audio design in the first seconds of the video.
- **Judging criterion helped:** Design (and Potential Impact through trust).
- **Hours:** 1.5 (estimate).
- **Where it fits:** Fri 9 Oct with S1-S4 in the vertical slice, so it is in the Wed 14 Oct K4 take.
- **Implementation notes:** the badge is derived from `mic_state` and the TV window state (§7.7). New TV-to-phone type `end_session` and new `mic_state` value `off` (§5.2; allow-list updated). The phone emits `sample` frames only between `start_window` and `stop_window`; a phone-module jest test asserts that no `sample` is sent outside a window. Copy keys `pair.privacy`, `badge.measuring`, `badge.open` and `badge.off` (§3.4). No third-party recording-indicator icons. Check the §4.2 phone responsibilities against this before filming.
- **Real or labelled in the demo:** real.
- **Evidence:** fenado.ai summary of a TechCrunch Bee hands-on (unease about an always-on mic), https://fenado.ai/articles/amazons-bee-wearable-sparks-intrigue-and-privacy-concerns-techcrunch-reports; Sam Julien, early Bee user (March 2025, outside the 30-day window), https://www.samjulien.com/bee-first-impressions/; About Amazon Bee page ("no audio is ever stored" as Amazon's own baseline), https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features; AFTVNews on Vega's no-sideloading lockdown (inference: the mic state must live in the app and the phone page), https://www.aftvnews.com/amazon-announces-new-3rd-gen-fire-tv-stick-4k-running-vega-os-with-an-all-new-remote/. The wording and the "Measuring during floor and calibration windows too" fix are the red team's.

### 13.3 One-cue listener with a meter/listener agreement count (CORE, 2 h; family mode reshaped)

- **Tier:** CORE (add-to-core). Family mode moves from the first item in the K4 cut order to the protected end (§12).
- **What it does:** the household listener at the far side uses P4 on the far-mic phone page, which already sits at the listener's position. (§6.2 allows one phone per room; the proposal assumed the listener's own phone, which would need a third relay role and is not in scope.) P4 shows three buttons: Heard, Not heard, and one cue button whose word the household sets once on P3 ("Cue word", 1-12 characters, default "Volume"); the cue replaces "Repeat". Cues are capped at 3 per session; after the third the button is disabled with "Cues used for today". The TV shows a cue for 3 s as a neutral chip ("Cue: Volume", announced with `aria-live="polite"`), never as a failure. The buttons work only between windows (§3.3), and the listener taps without lifting the phone. S5 adds "Meter and listener agreed on [n] of [m]": m counts windows that have both a meter verdict and an on-time Heard or Not heard, and n those where heard matches reached.
- **User value:** the partner can help with one agreed cue instead of repeated corrections, and the listener's "heard" sits next to the meter as a human check. The agreement count is a visible check of the meter against a person, the honest answer to §2.2's admission that RMS cannot judge clarity.
- **Judging criterion helped:** Design; Technical Implementation (agreement as visible evidence that the measurement is valid).
- **Hours:** 2 (estimate), on top of the family-mode controls already inside D2 and D4 (about 3 h).
- **Where it fits:** family mode moves forward from Thu 15 - Sat 17 Oct to Mon 12 - Tue 13 Oct (the slot freed by Polly and the caregiver card), so it is built before the Wed 14 Oct K4 take and can be measured in the D6 run. The Mon 19 Oct feature freeze is the hard end.
- **Implementation notes:** reuse `verdict` with the value `cue` (no new type); the cue word travels once as `cue_word` on `phrases` (§5.2). The cap is enforced on the phone and checked again on the TV. Listener verdicts that arrive after the TV's `reveal` for that window are stored with `late: true` and left out of the agreement count. A pure `agreement()` function in `apps/tv/src/rules/`; jest tests for the function (both inputs present, late taps excluded) and for the cap. `summary` carries `agreed`, `agreement_n` and `cues_used`. EVALUATION.md reports agreement separately for blind-check windows, because on the 7 live-arc phrases the listener can see the arc, which may anchor the tap `[inference]`. If agreement in the D6 run is low (a judgement call, say under 70 percent), it is reported in EVALUATION.md and not showcased in the video (red-team condition).
- **Real or labelled in the demo:** real: a second person in the room, credited as a family member or volunteer, never as a patient. Agreement is never presented as a clinical intelligibility score. The speaker never touches the phone; the listener's taps are captioned. Shown in the video only if time allows and the D6 agreement is not low.
- **Evidence:** Breatheworks (support communication without policing it; one agreed cue), https://breatheworks.com/parkinsons-speech-therapy-lsvt-loud-speak-out/; Tactus Therapy (2019; partners can be trained to give cues), https://tactustherapy.com/parkinsons-disease-pd-improve-speech-therapy/; LSVT Global Patients & Family page (help should stay light-touch), https://www.lsvtglobal.com/Patients_Family; inference from §2.2 (one far microphone cannot separate voices with RMS alone, so a human listener verdict is the existing mitigation).

### 13.4 Inline "why" line under each verdict (STRETCH, 1.5 h)

- **Tier:** STRETCH (add-as-stretch; replaces the proposed 3 h focus-trapped "Why this result" overlay).
- **What it does:** one line of small text under each S4 verdict (and under the reveal on blind-check phrases): "Why: 26.8 dB above room noise against today's band of 13 dB (relative, not SPL). Frames dropped: 0" `[example values]`. The latency readout stays in the footer.
- **User value:** the household and judges see that the verdict is a measurement with stated limits, not a guess, and the no-LLM design is on screen.
- **Judging criterion helped:** Technical Implementation.
- **Hours:** 1.5 (estimate).
- **Where it fits:** the first stretch item after the Wed 14 Oct K4 take (Thu 15 Oct); finished by the Mon 19 Oct freeze or dropped.
- **Implementation notes:** no new data: `p95_above_floor`, `frames_dropped` and the band come from `window_result` and `calibration` (§5.2). Copy key `why.line` (§3.4). Jest snapshot of the line for a reached and a not-reached fixture. Every dB value says "relative, not SPL" (§5.3 makes no absolute SPL claim).
- **Real or labelled in the demo:** real; the line carries its own "relative, not SPL" label.
- **Evidence:** AngelHack organiser playbook (2026-06-08; judges reward visible trace logs and metrics), https://angelhack.com/blog/ai-agent-hackathon/; Still Here entrant demo (evidence-bound output), https://www.youtube.com/watch?v=cAnbiR2ndcw; Solo.io 2026 MCP hackathon winners (observable execution credited), https://www.solo.io/blog/celebrating-the-winners-of-the-2026-hackathon-for-mcp-ai-agents.

### 13.5 Starter phrase set written from scratch (STRETCH, 1 h)

- **Tier:** STRETCH (add-as-stretch; the starter set only).
- **What it does:** about 20 neutral household phrases written by the team from scratch (names and calls, mealtimes, phone-call openers, asking across the room), offered on phone page P3 as tap-to-add suggestions. The family still saves 1-10 phrases.
- **User value:** first-time users and the fixture-replay judge route (§4.5) can start without typing.
- **Judging criterion helped:** Design; Potential Impact.
- **Hours:** 1 (estimate).
- **Where it fits:** the second stretch item, after the "why" line, before the Mon 19 Oct freeze.
- **Implementation notes:** `starterPhrases` in the phone page's copy file; no change to AC-4.1, the `savePhrases` limits (§7.1), the `phrases` message or the §5.2 payload rule. K5: no exercise lists or wording from any clinical programme or app.
- **Real or labelled in the demo:** real.
- **Evidence:** Speak Up For Parkinson's App Store reviews (a 2015 review titled "Speech Therapist": phrase bank too small; a 2025 review titled "Too Basic"), https://apps.apple.com/us/app/speak-up-for-parkinsons/id784117908; JMIR 2025 study app (varied feedback by design), https://pmc.ncbi.nlm.nih.gov/articles/PMC11888063/; Sierra Speech home workout video (2017), https://www.youtube.com/watch?v=Dy2l7qLXhyA. The red team notes that this evidence is old and shows no trend.

### 13.6 Moved out of the core to make room

- **Polly prompts (−2 h):** the core ships text prompts only; the TV is already silent during windows (AC-2.1), and AC-4.3 already required a text-only path. Polly synthesis and playback become the last stretch item (2 h) and ship only if everything else is done before the Mon 19 Oct freeze. The day-one `Audio` spike in D1 becomes optional. Without Polly, the AWS Builder entry rests on the measured relay (§9.3).
- **Caregiver export (−2 h):** the S5 summary counts stay in the core; P5 Export, the S5 "Export on phone" item and AC-5.2 become a stretch item (2 h), third in the stretch order.
- **Stretch order after the K4 take:** (1) inline "why" line, 1.5 h; (2) starter phrase set, 1 h; (3) caregiver export, 2 h; (4) Polly prompts, 2 h. Total 6.5 h (estimate), none of it inside the 102.5 h core; funded only from slack or an under-run, never from the two reserve days.

### 13.7 Deferred and rejected (FTV-4)

| Item | Verdict | Reason |
|---|---|---|
| On-device words check (a machine listener in beta) | Deferred to after the hackathon; the optional Thu 15 Oct spike is dropped too | MDN lists Chrome Android as "No support" for on-device recognition (https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally); Vosk WASM would compete with the 20 Hz analyser on a mid-range phone; the small en-IN model's published word error rate is 49 percent (https://alphacephei.com/vosk/models); a word miss may reflect articulation or accent rather than loudness, which invites an intelligibility-test reading; no slack. One README roadmap line. |
| Cloud speech recognition (Web Speech on Android, Amazon Transcribe) | Rejected | Audio would leave the phone, breaking the no-audio design; Transcribe inputs may be kept for service improvement unless the Organizations AI opt-out is set (https://aws.amazon.com/transcribe/faqs/). |
| "Why this result" overlay (3 h) | Replaced by the inline line (§13.4) | Too large for the remaining slack. |
| Weekly phrase rotation and a 30-phrase bank | Deferred | Touches AC-4.1, the `savePhrases` validation and the 4 KB payload rule for little video value; the evidence is a 2015 review and a 2017 video. |
| A rating after every phrase, Up/Down rating keys, a Settings toggle, a 7-day "felt" trend | Not built | The live arc anchors the rating; Up/Down already move focus; three blind checks need no toggle; outside the 5 h. |
| A separate listener phone | Not built | One phone per room (§6.2); a third relay role would be new work. |
| Phone-pairing kit as a separate Open Source repo (NEW-4) and any speech-recognition spike | Rejected | NEW-4 duplicates D7 and needs about 20 h; FTV-4 has no slack for either. |

### 13.8 FTV-4F fallback bundle (only if the Thu 8 Oct 20:00 IST gate selects the Listener Edition)

These two items replace FTV-4's blind-check phrases (§13.1) and the one-cue item is shared code; build them instead of the FTV-4 items, not as well. They raise the fallback's new work from about 12 h to about 18 h, partly offset by the dropped cross-session dB, median-of-five and band work. Polly prompts and the caregiver export are cut as in §13.6, and the total is re-checked against about 104 h at the gate.

- **Independent two-sided check (CORE in FTV-4F, 4 h).** After each phrase the speaker rates Felt loud or Felt normal on the remote while the listener taps Heard or Not heard on the far phone. Neither input is shown until both are in, or until either side explicitly skips; the TV then reveals both on one screen with Next focused, and the phonation-seconds counter is unchanged. The summary reads "You and the listener agreed on [n] of [m]. Felt normal but was heard: [k]." The copy says "independent", never "blind", because in one living room the speaker can see the listener's face. Implementation: the TV holds the window's speaker rating and the `verdict` message until both arrive; P4 never displays the speaker rating; the TV's `reveal` locks P4; two summary counters; a jest test that the reveal waits for both inputs or for an explicit skip. Criterion: Technical Implementation (answers the self-report critique) and Quality of the Idea. Where: Fri 9 - Sun 11 Oct after the gate, reusing the §13.1 sub-states, so it is in the Wed 14 Oct K4 take. Real, with the fallback's no-simulation status. Evidence: RECOMMENDATION.md §5.4 (a judge may read the listener tap as self-report); Breatheworks, https://breatheworks.com/parkinsons-speech-therapy-lsvt-loud-speak-out/; inference: making two raters independent is a standard way to make subjective ratings more credible, not tested for this use.
- **One-cue listener control with a cap and a neutral chip (CORE in FTV-4F, 2 h, counted once with §13.3).** The same code as §13.3: Heard, Not heard and one household cue word, 3 cues per session, a neutral chip on the TV. In the Listener Edition the partner's tap is the headline metric, so the cap and the neutral display matter more. Criterion: Design. Real. Evidence: Breatheworks (above); Tactus Therapy, https://tactustherapy.com/parkinsons-disease-pd-improve-speech-therapy/.
- The mic-state badge (§13.2) is not in the red team's FTV-4F bundle; keep it only if the re-total at the gate leaves room.

### 13.9 Capacity after additions

FTV-4 core: 98 + 8.5 − 4 = **102.5 h of about 104 h** (estimate). The +8.5 h are the blind-check phrases (5), the mic-state badge (1.5) and the one-cue listener with the agreement count (2); the −4 h are Polly prompts cut to text only (−2) and the caregiver export moved to stretch (−2). That leaves about 1.5 h of slack plus the two untouched reserve days, so the Wed 14 Oct K4 take is the hard point for any cut. The K4 cut order is swapped so family mode is protected (it carries the agreement count and is the FTV-4F core): unstarted stretch goes first, then the D7 Open Source publication (−7 h, code stays in the primary repo), and family mode only as a last resort. The 6.5 h of stretch sits outside the 102.5 h. All figures are unmeasured estimates.

---

## Source index (URL; saved copy where one exists)

- Official Rules: https://amazonappdev2026.devpost.com/rules (`.firecrawl/oct4/evt-rules.md`); FAQ: https://amazonappdev2026.devpost.com/details/faqs; brief `research/HACKATHON_BRIEF.md` §4, §6, §8.
- Vega install: https://developer.amazon.com/docs/vega/0.24/install-vega-sdk (`.firecrawl/ftv-install-vega-sdk.md`, `.firecrawl/oct4/plt2-vega-install-live.md`). Release notes: https://developer.amazon.com/docs/vega/0.24/vega-release-notes (`.firecrawl/ftv-release-notes.md`). Target OS matrix: https://developer.amazon.com/docs/vega/0.24/target-os-version (`.firecrawl/oct4/plt2-vega-target-os-curl.html`). Run apps: https://developer.amazon.com/docs/vega/0.24/run-apps (`.firecrawl/technical-vega-run-apps.md`). VVD issues: https://developer.amazon.com/docs/vega/0.24/kvd-issues (`.firecrawl/ftv-vvd-issues.md`). App manifest: https://developer.amazon.com/docs/vega/0.24/app-manifest (`.firecrawl/oct4/spec4-vega-app-manifest.md`). Runtime privileges: https://developer.amazon.com/docs/vega/0.24/request-runtime-privileges (`.firecrawl/ftv-vega-runtime-privileges.md`). Keyboard: https://developer.amazon.com/docs/vega/0.24/enable-keyboard (`.firecrawl/ftv-enable-keyboard.md`; the `.html` form redirects here). WebView (not used): https://developer.amazon.com/docs/vega/0.24/overview-of-webview (`.firecrawl/ftv-webview.md`).
- RN for Vega overview: https://developer.amazon.com/docs/vega/0.24/vega-rn-overview (`.firecrawl/ftv-vega-rn-overview.md`). Networking 0.83: https://developer.amazon.com/docs/react-native-vega/0.83/network (`.firecrawl/idea-judge-vega-network.md`, `.firecrawl/oct4/plt2-vega-rn-network-curl.html`); Networking 0.72: https://developer.amazon.com/docs/react-native-vega/0.72/network (`.firecrawl/oct4/verftv4-rnv072-network-curl.html`). RN for Vega accessibility: https://developer.amazon.com/docs/react-native-vega/0.83/accessibility (`.firecrawl/oct4/spec-ftv3-vega-rn-accessibility.md`). Media player: https://developer.amazon.com/docs/vega/0.24/media-player (`.firecrawl/idea-judge-vega-media-player.md`). w3cmedia README: https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia (`.firecrawl/oct4/rt2ftv4-w3cmedia-readme.md`). Kepler a11y README: https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_kepler-a11y-settings-interface-turbo (`.firecrawl/oct4/ftv2-kepler-a11y-readme.md`). react-native-svg: https://developer.amazon.com/docs/vega-api/0.24/react-native-svg (`.firecrawl/oct4/verftv4-vega-react-native-svg-curl.html`). react-native-async-storage: https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage (`.firecrawl/oct4/verftv4-vega-async-storage-curl.html`). AudioRecordStreamBuilder: https://developer.amazon.com/docs/vega-api/0.24/classes.AudioRecordStreamBuilder.amazon-devices_keplerscript-audio-lib (content via digest WebFetch summary only).
- Amazon samples: https://github.com/AmazonAppDev/vega-tv-interfaces-sample (`.firecrawl/ftv-gh-vega-tv-interfaces-sample-README.md`, `.firecrawl/ftv-gh-vega-tv-interfaces-focusGuide-README.md`); https://github.com/AmazonAppDev/react-native-multi-tv-helloworld (`.firecrawl/ftv-gh-react-native-multi-tv-helloworld-README.md`); https://github.com/AmazonAppDev/vega-video-sample (`.firecrawl/ftv-gh-vega-video-sample-README.md`).
- npm: https://registry.npmjs.org/@amazon-devices%2Freact-native-svg; https://registry.npmjs.org/@amazon-devices%2Freact-native-w3cmedia; https://registry.npmjs.org/@amazon-devices%2Fkepler-a11y-settings-interface-turbo; https://www.npmjs.com/package/@amazon-devices/react-native-async-storage__async-storage; https://registry.npmjs.org/@amazon-devices%2Freact-native-kepler.
- Community: OS 1.2 rollout threads https://community.amazondeveloper.com/t/29152 and /t/29212 (`.firecrawl/oct4/plt2-community-topic-29152.json`, `-29212.json`); DevRel on Fire TV https://amazonappdev2026.devpost.com/forum_topics/45396-what-exactly-are-you-looking-for-in-the-fire-tv-track.
- MDN: autoGainControl https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl (`.firecrawl/oct4/eng2-mdn-autogaincontrol.md`); Screen Wake Lock https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API (`.firecrawl/oct4/rt2ftv4-mdn-wakelock.md`); getFloatTimeDomainData https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData (`.firecrawl/oct4/spec4-mdn-getfloattimedomaindata.md`).
- AWS: API Gateway endpoints and quotas https://docs.aws.amazon.com/general/latest/gr/apigateway.html (`.firecrawl/oct4/rt2ftv4-aws-gr-apigateway.md`); pricing https://aws.amazon.com/api-gateway/pricing/ (`.firecrawl/aws-apigw-pricing.md`); @connections https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html (`.firecrawl/oct4/specftv4-apigw-connections.md`); $connect/$disconnect https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html (`.firecrawl/oct4/spec4-apigw-ws-routes.md`); WebSocket routes and route selection https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-routes.html (`.firecrawl/oct4/verftv4-apigw-ws-develop-routes-curl.html`); Lambda pricing https://aws.amazon.com/lambda/pricing/ (`.firecrawl/aws-lambda-pricing.md`); Lambda runtimes https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html (`.firecrawl/oct4/verftv4-lambda-runtimes-curl.html`); DynamoDB pricing https://aws.amazon.com/dynamodb/pricing/on-demand/ (`.firecrawl/aws-dynamodb-ondemand-pricing.md`; as of 4 Oct this URL 301-redirects to https://aws.amazon.com/dynamodb/pricing/); DynamoDB TTL https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html (`.firecrawl/oct4/spec4-dynamodb-ttl.md`); Polly SynthesizeSpeech https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html (`.firecrawl/oct4/rt2ftv4-polly-synthesizespeech.md`; the older `/dg/` path 301-redirects here); Polly pricing https://aws.amazon.com/polly/pricing/ (`.firecrawl/oct4/spec4-polly-pricing.md`); Polly endpoints https://docs.aws.amazon.com/general/latest/gr/pol.html (`.firecrawl/oct4/plt2-aws-gr-pol.html`); Budgets https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html (`.firecrawl/aws-budgets-docs.md`) and pricing (`.firecrawl/oct4/exec1-aws-budgets-pricing.md`); billing alarm https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html (`.firecrawl/aws-billing-alarm-docs.md`); Cost Anomaly Detection https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html (`.firecrawl/aws-cost-anomaly-docs.md`); Free Tier https://aws.amazon.com/free/ (`.firecrawl/aws-free-tier.md`); credits https://aws.amazon.com/awscredits/ (`.firecrawl/aws-credits-terms.md`); Bedrock Regions https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html (`.firecrawl/aws-bedrock-models-region-compat.md`); CloudFront pricing https://aws.amazon.com/cloudfront/pricing/ (`.firecrawl/oct4/exec1-aws-cloudfront-pricing.md`).
- Rivals and need: Loud and Clear https://apps.apple.com/us/app/loud-and-clear/id1491171131 (`.firecrawl/oct4/rt2ftv4-loud-and-clear-appstore.md`); Speak Up For Parkinson's https://apps.apple.com/us/app/speak-up-for-parkinsons/id784117908 (`.firecrawl/oct4/rt2ftv4-speakup-pd-appstore.md`); MARS review doi 10.2196/72214 (`.firecrawl/oct4/rt2-ftv4-mars-pd-speech-apps.md`); JMIR Rehabil Assist Technol 2026 https://pmc.ncbi.nlm.nih.gov/articles/PMC12917486/ (`.firecrawl/oct4/rt2ftv4-pmc12917486.html`); Samsung mobile mic note https://www.samsung.com/levant/support/tv-audio-video/how-to-use-the-mobile-mic-and-sing-karaoke-on-your-samsung-smart-tv/ (body saved inside `.firecrawl/oct4/rt2-ftv4-karaoke-firetv.json`; last update 13 Aug 2025; "locking it disables the mic").
- General reference not re-read this session: WCAG 2.1 contrast https://www.w3.org/TR/WCAG21/#contrast-minimum; MDN getUserMedia; DynamoDB condition expressions; AWS SAM.

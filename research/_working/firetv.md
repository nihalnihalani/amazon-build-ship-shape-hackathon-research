# Fire TV track: accepted environments, Mac/India setup, and interaction capabilities (FTV)

Research date: 2026-10-03 (Asia/Kolkata). All `retrieved_at` = 2026-10-03. Publication/update dates come from the page footers ("Last modified" or "Last updated"). Pages marked "Open Beta Documentation" are Vega docs that Amazon says may change.

Retrieval-method legend: **FC-scrape** = Firecrawl CLI scrape (full body read). **FC-search** = Firecrawl search JSON (snippet only, unless noted). **FC-map** = Firecrawl map. **WebFetch** = fallback used when the shared Firecrawl account was rate-limited (HTTP 429). WebFetch returns a small-model summary, not raw text, so its quotes may be paraphrased and get lower confidence. **GH-API/npm** = public GitHub REST API or npm registry JSON fetched with curl (metadata plus raw README). **Local** = read-only commands on this Mac.

---

## 0. Bottom line for planning

1. **Lowest-risk accepted environment: Vega Virtual Device (VVD) on this Apple-silicon Mac.** The official Rules name the "Fire TV/Vega simulator" explicitly. Vega SDK 0.24 lists Apple Silicon Mac as a supported host, and Amazon calls it the recommended platform. No physical device is needed at any stage ([FAQ](https://amazonappdev2026.devpost.com/details/faqs); [Rules](https://amazonappdev2026.devpost.com/rules); [install doc](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk)).
2. **Android TV emulator (Fire OS path)** is accepted by the hackathon FAQ but **not named in the Rules**. Amazon's own Fire OS docs also say Fire TV testing uses a real device "instead of a virtual emulator". It is usable, but it carries a small interpretation risk. If you take the Fire OS path, a real Fire TV Stick recorded over `adb` removes that risk.
3. **This Mac needs Rosetta 2 installed before the Vega SDK will work.** It runs macOS 27.0.1 on an M4 Pro, and Rosetta is currently absent. Amazon documents that upgrading to macOS 27 removes Rosetta and breaks the Vega tools. Fix: `softwareupdate --install-rosetta --agree-to-license`. Disk is also tight: 48 GB free, against a documented 20 GB requirement for the Vega tools (VDT).
4. **Using the TV camera for computer vision is NOT verifiably feasible for entrants.** Current Vega Fire TV sticks list no camera. No public Vega camera API or npm package was found. Fire TV Cube and Omni/Ember TVs accept a USB webcam only for *Alexa two-way video calling*, and third-party app access to that webcam is not documented. Treat "CV fitness using the TV camera" as needing a workaround: use the phone or laptop camera as the sensor and send results to the TV app.
5. **Third-party voice is constrained.** On Vega, Alexa reaches apps through the Content Launcher (play/search/transport). It requires catalog integration. On Fire OS there are three options: VSK, MediaSession transport controls, and in-app voice scroll/select, which Amazon must enable on its side. None of these accepts arbitrary speech or custom intents. Vega does have a microphone-recording API behind a runtime privilege, but whether the remote's mic reaches apps on real devices or on the VVD is not verified. The VVD itself "doesn't use the microphone".

---

## 1. Accepted environments (hackathon rules vs Amazon docs)

| Item | Finding | Source / date | Confidence |
|---|---|---|---|
| Rules text | "The demo video must show the project running on an actual Fire TV device or the Fire TV/Vega simulator." Any framework is fine, as long as it runs on Fire OS or Vega OS. | [Rules](https://amazonappdev2026.devpost.com/rules) (saved `.firecrawl/amazonappdev2026.devpost.com-rules.md` L341), undated page | High |
| FAQ | "Fire TV: an emulator (Android TV Emulator or the Fire TV/Vega simulator) is fine - a physical device isn't required at any stage of submission or judging." | [FAQ](https://amazonappdev2026.devpost.com/details/faqs) (saved L232) | High |
| Overview | Same wording as the Rules (device or Fire TV/Vega simulator). Fire TV is exempt from the "call the required SDK in code" check. | [Overview](https://amazonappdev2026.devpost.com/) (saved `hackathon-overview.md` L340) | High |
| Amazon Fire OS docs on emulators | Testing uses "an actual Fire TV device (either the set-top box or stick) instead of a virtual emulator" | [Differences from Android TV](https://developer.amazon.com/docs/fire-tv/differences-from-android-tv-development.html), last updated May 27, 2026 (WebFetch) | Medium (WebFetch summary) |
| Amazon Fire OS React Native guide | Still shows "Run your project on the Android TV emulator" (Expo `with-tv` template, `npx expo start -a`) | [Get Started with React Native (Fire TV)](https://developer.amazon.com/docs/fire-tv/get-started-with-react-native.html), last updated Jul 22, 2025 (FC-scrape) | High |
| Amazon samples | `hello-world-fire-tv` (Kotlin) tells you to create an "Android TV virtual device" if you have no device. `hello-world-fire-tv-react-native` lists the "Android TV Emulator" as a prerequisite. | GH-API READMEs | High |

**Interpretation.** No Amazon-branded *Fire OS* emulator exists. The "Fire TV simulator" in the Rules is, in practice, the Vega Virtual Device. The Android TV emulator is an Android TV stand-in that Amazon's samples and the FAQ accept. It does not include Fire OS-specific services: Google services are absent on Fire TV, and the Amazon voice and system integrations are missing from the emulator.

## 2. Host OS and machine requirements (Vega SDK 0.24 = "LATEST")

- **SDK version.** The docs nav shows "Version 0.24 (LATEST)". The release notes cover SDK 0.24, which brings RN 0.83 early access and requires device OS 1.2 ([release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes), last modified Aug 19, 2026, FC-scrape). An example in the install doc shows the version format `0.22.5850`. The exact 0.24 build number was not captured.
- **Supported hosts.** Per the compatibility matrix, SDK 0.21 to 0.24 all support "Apple Silicon Mac, Intel Mac, Ubuntu x86_64". The matrix states "Windows is not a supported build host. Intel Mac support ends December 15, 2026." ([Target OS Versions](https://developer.amazon.com/docs/vega/0.24/target-os-version), last modified Sep 15, 2026, FC-search with scrape body).
- **Install requirements** ([Install the Vega Developer Tools](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk), last modified Sep 23, 2026, FC-scrape):
  - Disk: 20 GB free.
  - macOS 10.15+, with "Apple Silicon (arm64) is the recommended platform".
  - Ubuntu 20.04, 22.04 or 24.04 on x86_64. Ubuntu also needs KVM.
  - Windows and WSL are "not supported" and "aren't tested".
  - macOS dependencies: Homebrew, Node.js 18.x or later, and `brew install binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`. The same command installs Rosetta 2 on arm64.
  - Install method: `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env`. It takes 10 to 15 minutes. VS Code is optional (for Vega Studio).
  - Telemetry is on by default and can be opted out of.
  - No RAM minimum is stated in the install doc. Not verified.
- **macOS 27 and Rosetta.** "Upgrading from macOS 26 to macOS 27 removes Rosetta, which several Vega tools depend on." Fix: `softwareupdate --install-rosetta --agree-to-license` (install doc, FC-scrape; also [sdk-install-issues](https://developer.amazon.com/docs/vega/0.24/sdk-install-issues), last modified Sep 23, 2026, WebFetch).
- **This machine (Local, read-only check):**
  - macOS 27.0.1 (build 26A434) on arm64, Apple M4 Pro, 24 GB RAM.
  - 48 GiB free on the data volume, which is 89% used.
  - Rosetta not installed: the `oahd` service is not running, and only `RosettaLinux` exists under `/Library/Apple/usr/libexec/oah`.
  - Node v25.2.1, managed by nvm.
  - `vega` and `adb` are not installed.
- **Node version conflict.** The install doc says Node 18+. The Vega sample READMEs (`vega-tv-interfaces-sample`, `vega-video-sample`) pin "NodeJS v18-v20". The Builder Tools MCP needs Node 18+ and recommends Node v24 if v26 fails with an SQLite3 bindings error. Recommendation (inference): use `nvm` to keep Node 20 for Vega builds. Node v25 compatibility is not verified.
- **Apple Silicon VVD regression fixed in 0.24.** A dynamically linked compression library made the device adapter crash. As a result the VVD failed to boot, device deploys failed and devices disappeared from the IDE. Restoring static linking fixed it (release notes). Implication: use 0.24 or later on M-series Macs.
- **Architecture.** On M-series Macs, VVD needs `build/aarch64-release/*_aarch64.vpkg`. Fire TV sticks need `armv7` ([run-apps](https://developer.amazon.com/docs/vega/0.24/run-apps), last modified Aug 7, 2026, saved `technical-vega-run-apps.md`).

## 3. Vega Virtual Device (VVD): how to run, capabilities and limits

- **Start and run.**
  - `vega virtual-device start [--timeout 120] [--no-gui] [--display-res=1920,1080]`
  - `vega run-app <vpkg> <app-id> -d VirtualDevice`, then `vega device launch-app` for later launches.
  - Vega Studio (VS Code) can do the same from **Devices > VirtualDevice:Tv** (run-apps).
- **Input.** Mouse, a virtual remote, and keyboard shortcuts: ENTER = Select, arrow keys = D-pad, ESC = Back, F1 = Home, F2 = Menu, F3/F4/F5 = Rewind, Play/Pause, Fast Forward. With Developer Mode (`vsm developer-mode enable` in the VVD shell), `inputd-cli` supports touch, swipe, button_press and send_text. That is useful for scripted demo recordings.
- **Inspection (new in 0.24).** You can copy and paste text into the VVD and dump the render tree (XML) or the rendered text.
- **Parental Controls** can be tested on the VVD, but only after the VVD is registered (release notes; run-apps).
- **Amazon services need registration.** The VVD must be registered at amazon.com/code before Amazon services work. The person must do this themselves, since it is an account sign-in.
- **Microphone.** "The Vega Virtual Device doesn't use the microphone" (run-apps). Microphone input in VVD apps is therefore not available.
- **Memory.** The VVD can crash under memory pressure. The docs say to act when free memory is below 2 GB ([VVD troubleshooting](https://developer.amazon.com/docs/vega/0.24/kvd-issues), last modified Apr 1, 2026, FC-scrape).
- **Hardware interference.** USB hubs, docking stations, and audio interfaces used for both input and output at once can crash the VVD.
- **Network.** If the VVD has no internet, test with `ping` from `vega device shell`. The VVD has network access by default (no restriction documented).
- **WebView.** "VVD doesn't support Webview on Ubuntu or Intel-based Mac platforms". It is supported on Apple Silicon (M1 to M4) ([kvd-issues](https://developer.amazon.com/docs/vega/0.24/kvd-issues); [WebView overview](https://developer.amazon.com/docs/vega/0.24/overview-of-webview), last modified Aug 3, 2026).
- **Features gated off the VVD (sample code).** `vega-video-sample` turns Content Personalization off when running in the simulator ("requires real device capabilities not available in VVD"). In-App Purchasing (IAP) needs extra setup every time the VVD launches (GH-API README).
- **Media and DRM on the VVD.** Not explicitly documented in the pages reviewed. The WebView doc says DRM works "as long as the device supports it". Whether Widevine L1 works on the VVD is not verified.
- **Appstore rule.** You must test on a physical Fire TV before Appstore submission. That rule does not apply to the hackathon (run-apps).

## 4. Shipping devices: which run Vega OS, and what is sold in India

From [Device Specifications: Fire TV Streaming Media Player](https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html) (last updated Sep 30, 2026, FC-scrape):

| Device | OS | RAM / ABI | amazon.in listed? | Camera |
|---|---|---|---|---|
| Fire TV Stick 4K – 3rd Gen (2026), AFTCR001 | **Vega OS 2.0** | 1 GB / 32-bit, OpenGL ES 3.1 | No | none listed |
| Fire TV Stick HD (2026), AFTCL001 | **Vega OS 1.1** | 1 GB / 32-bit | **Yes** | none listed |
| Fire TV Stick 4K Select (2025), AFTCA002 | **Vega OS 1.1** | 1 GB / 32-bit | **Yes** | none listed |
| Fire TV Stick 4K Plus (2025) | Fire OS 8 (API 30) | 2 GB | No | none listed |
| Fire TV Stick 4K Max 1st Gen (2021), Stick 3rd Gen (2020), Stick Lite (2020) | Fire OS 7 | 1 to 2 GB | Yes | none listed |
| Fire TV Cube 2nd Gen (2019) / 3rd Gen (2022) | Fire OS 7 | – | Yes | USB port. Webcam only for Alexa video calling (see §7) |

- The Vega run-apps doc names the Fire TV Stick HD, Fire TV Stick 4K Select and Fire TV Streaming Media Player as example Vega devices.
- India launch: Amazon's press release (Oct 29, 2025) priced the Fire TV Stick 4K Select at ₹5,499 on Vega OS. It is sold on Amazon.in, Flipkart, Blinkit, Swiggy Instamart, Zepto, Croma, Vijay Sales and Reliance ([press.aboutamazon.com/in](https://press.aboutamazon.com/in/news/devices/2025/11/amazon-launches-fire-tv-stick-4k-select-in-india-its-entry-level-4k-streaming-stick-at-5-499), WebFetch). A BusinessWorld review snippet mentions a ₹3,999 street price. That figure was not verified and came from a search snippet only.
- **Contradiction.** The device page lists one device on Vega "OS 2.0". The SDK 0.24 release notes say "Vega OS 1.2 is the only available version in this release" and require device OS 1.2. The device page also lists the HD and 4K Select at OS 1.1, which predates OS 1.2. So the device pages may lag OTA updates. Building for OS 2.0 is not covered by SDK 0.24 docs.
- **Vega device dev mode (0.24 flow).**
  1. Press the center button seven times on **Settings > My Fire TV > About > device name**.
  2. Under **Developer Options**, choose **Developer Mode**. This shows a 6-digit code that expires after 5 minutes.
  3. Run `vega devmode login`. This opens an Amazon OAuth consent page in the browser, which the user must approve.
  4. Run `vega devmode enable-device --code <code>`.
  5. Then use `vega device install-app` and `launch-app`.
  - This needs an **Amazon Developer account**, a **USB data connection** to the Mac, and HDMI. Disabling it later requires a factory reset (run-apps).
- **Fire OS sideloading.**
  1. Turn on **ADB Debugging** and **Apps from Unknown Sources** in Developer Options. Developer Options is unlocked by clicking 7 times on **About**.
  2. Run `adb connect <ip>:5555` over the same Wi-Fi network, or connect over USB if the device has a USB port.
  3. Accept the "Allow USB debugging?" prompt on the TV.
  ([Connect to Fire TV Through ADB](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html), last updated Jun 28, 2022, FC-scrape.) **Note:** this flow is for Fire OS. Vega devices use the `vega devmode` flow above, not `adb`.
- **Fire OS 16 (API 36)** exists and adds a local-network permission (`NEARBY_WIFI_DEVICES`) for mDNS, SSDP and NSD discovery ([Fire OS 16](https://developer.amazon.com/docs/fire-tv/fire-os-16.html), last updated Jun 30, 2026, FC-scrape). Which devices run it was not checked.

## 5. React Native for TV: versions, focus, input, networking, storage, WebView

- **RN versions.**
  - Vega: RN 0.72 and RN 0.83. RN 0.83 is "early access" in 0.24 and brings React 19, Hermes v1 and the new React Native DevTools ([RN for Vega overview](https://developer.amazon.com/docs/vega/0.24/vega-rn-overview), last modified Sep 15, 2026; release notes).
  - Fire OS path in the starter: React Native 0.81 (tvOS fork, `react-native-tvos`) with Expo SDK 54 (multi-tv sample README).
- **Focus and D-pad on Vega.** RN for Vega provides "Core features from RN TvOS - `TVFocusGuideView`, `TVEventHandler`" plus Vega's own `FocusManager`, `KeplerAppState`, `SplashScreenManager` and `I18N` (RNV overview). The `vega-tv-interfaces-sample` focus guide documents `nextFocusUp`, `nextFocusDown`, `nextFocusLeft` and `nextFocusRight`, plus `hasTVPreferredFocus`. It also documents a `FocusGuideView` wrapper over `TVFocusGuideView` with `autoFocus`, `destinations` and `focusable` (GH-API, `src/services/focusGuide/README.md`). The multi-tv sample maps remote keys with `TVEventHandler` on Vega, `react-native-keyevent` on Android TV and Fire OS, and `react-tv-space-navigation` (beta) for spatial navigation.
- **On-screen keyboard (Vega).** Add `[[wants.service]] id = "com.amazon.inputmethod.service"` to `manifest.toml`. The keyboard then appears on the VVD and on the Fire TV Stick ([Enable keyboard](https://developer.amazon.com/docs/vega/0.24/enable-keyboard.html), last modified Sep 30, 2025). WebView does not support multiline text boxes.
- **Networking.** RN for Vega 0.83 documents `fetch`, `XMLHttpRequest` and **WebSocket** ([network](https://developer.amazon.com/docs/react-native-vega/0.83/network.html), last modified May 13, 2026, WebFetch). The page appears to mirror upstream RN docs. Cookie handling has known problems: in 0.24 the native Cookie Manager is not initialized (release notes).
- **Local storage.** The Vega port `@amazon-devices/react-native-async-storage__async-storage` is published on npm (latest 2.1.9000000001, Aug 6, 2026). It is aliased in the `vega-tv-interfaces-sample` package.json on RN 0.83. `@amazon-devices/expo-sqlite` is "not stabilized" for RN 0.83 (release notes).
- **Known RN 0.83 issues on Vega (0.24).**
  - No Chrome DevTools.
  - `setNativeProps` crashes.
  - Headless tasks crash. A workaround exists, but it is not allowed for Appstore submission.
  - `expo-image` autolink crash.
  - Expo libraries (expo-gl, expo-font, expo-notifications, expo-image-manipulator and others) "will not function correctly". **expo-gl is unavailable on RN 0.83**, which matters for any on-device GPU or CV rendering.
  - Minor React Navigation visual glitches (release notes).
- **Web technologies path on Vega.**
  - `@amazon-devices/webview` 4.0.2 is based on Chromium 144 and supports the Web Audio API, JS alerts, and Widevine/PlayReady DRM.
  - Unsupported: geolocation, file upload/download, multiline text boxes, external browser, `.mov`, Advertising ID, WebGPU, and `window.open`.
  - Set `hasTVPreferredFocus={true}`.
  - You can load a remote URL or `file:///pkg/assets/index.html`.
  - The JS-to-native Messaging Bridge is supported.
  - `getUserMedia` (camera/mic) support in Vega WebView is **not verified** in the docs reviewed.
  - Sources: [WebView overview](https://developer.amazon.com/docs/vega/0.24/overview-of-webview); release notes.
- **Fire OS web path.** "Amazon Fire TV supports HTML5 web apps" (hosted web apps, Web App Tester) ([Get Started with Fire TV](https://developer.amazon.com/docs/fire-tv/get-started-with-fire-tv.html), last updated May 20, 2026, WebFetch).

## 6. Voice and multimodal (third-party apps)

- **Vega voice.** The Content Launcher API delivers Alexa requests to apps through a `handleLaunchContent` callback. It supports Quick Play ("Alexa, watch <title>"), transport controls (no next/previous) and search. "All catalog integrated apps must integrate the Content Launcher API." Apps must upload metadata in Amazon's catalog schema and integrate the Account Login API. Testing on the VVD is not addressed ([Content Launcher overview](https://developer.amazon.com/docs/vega/0.24/content-launcher-overview.html), last modified May 27, 2026, WebFetch). **Implication:** a hackathon app without catalog onboarding cannot rely on Alexa routing custom utterances to it.
- **Fire OS voice.** Options are VSK, MediaSession (an Alexa permission in the manifest) and in-app voice scroll/select. Scroll/select is "a feature that Amazon manually activates on the back end". "No option" lets an app receive arbitrary speech or custom intents ([Voice-enable your app](https://developer.amazon.com/docs/fire-tv/voice-enable-your-app-and-content.html), last updated May 29, 2026, WebFetch). Voice search on Fire TV uses Amazon system controls, not Leanback `SearchFragment`, and Google services are unavailable ([Differences page](https://developer.amazon.com/docs/fire-tv/differences-from-android-tv-development.html), WebFetch).
- **Microphone capture API (Vega).** `AudioRecordStreamBuilder` in `keplerscript-audio-lib` creates microphone recording streams. It offers speech-recognition, VoIP, unprocessed and wake-word source types and requires the runtime privilege `com.amazon.audio.privilege.microphone.access` ([API ref](https://developer.amazon.com/docs/vega-api/0.24/classes.AudioRecordStreamBuilder.amazon-devices_keplerscript-audio-lib.html), last modified Jul 22, 2026, WebFetch). Vega runtime privileges cover "camera or microphone" and are user-granted ([runtime privileges](https://developer.amazon.com/docs/vega/0.24/request-runtime-privileges), last modified Sep 30, 2025). **Not verified:** whether the remote's push-to-talk mic is exposed to third-party apps on Fire TV sticks, which list only near-field Alexa on the remote. The VVD does not use the microphone.
- **Alexa+ on Fire TV for third-party apps.** No developer API was found in the reviewed docs. Not verified. The hackathon's gated Alexa+ tools are unavailable anyway.
- **Companion phone.**
  - Option A, official: **Matter Casting** on Vega. A phone app uses the Matter Casting SDK to discover a Vega Fire TV and send launch, playback and account-login commands. The TV app needs manifest clusters, handlers, and a **Device Attestation Certificate with matching vendor and product IDs** ([Matter Casting](https://developer.amazon.com/docs/vega/0.24/vega-matter-casting-integration.html), last modified Apr 15, 2026, WebFetch). That is likely too heavy for a 3-week hackathon (inference).
  - Option B, inference: the TV app and a phone web app both talk to your own backend over HTTPS or WebSocket. WebSocket and fetch are documented on RN for Vega. Fire OS 16 needs `NEARBY_WIFI_DEVICES` only if you use LAN discovery.
- **Precedent.** The Fire TV Appstore listing shows *The Jackbox Party Pack 3*, a party game, under the Fire TV apps department. The listing does not describe how phones join the game.

## 7. Camera / computer-vision feasibility (decision-critical)

- **Vega sticks.** No camera appears on any 2025 or 2026 Vega stick spec (device spec page).
- **Vega camera API.** None was found. FC-map searches of `docs/vega/` and `docs/vega-api/` for "camera" returned no camera API page. `@amazon-devices/kepler-camera` appears only as an illustrative import in a lint-suppression example on the Target OS Versions page, and **it returns 404 on the public npm registry** (npm). The `inputd-cli` basic commands include `get_camera_cover_open_close` (run-apps). That suggests the input stack knows about a camera cover, but it does not prove Fire TV camera access. The runtime-privilege doc names camera only as an example privilege.
- **Fire OS.** Fire TV Cube (2nd and 3rd Gen) and Fire TV Omni / Amazon Ember TVs support a USB webcam (USB 2.0, at least 720p, at least 30 fps uncompressed) for **"Alexa Two-Way video calling"**. The webcam is sold separately ([Amazon help](https://www.amazon.com/gp/help/customer/display.html?nodeId=GABVTYNJL7QXCMUY), undated, FC-scrape). Third-party app access to that webcam (Android Camera2/UVC) is **not documented in Amazon sources reviewed**. Only a Reddit thread (snippet, anecdote) and old forum posts discuss it. A developer-forum thread shows `getUserMedia` working on **Echo Show 15** (Fire OS 7 WebView). That is a different device class, and only the search snippet was seen.
- **VVD and Android TV emulator.** Webcam passthrough is not documented for the VVD. The Android Studio emulator can map a host webcam, but that comes from general knowledge, was **not verified in reviewed sources**, and would not represent real Fire TV hardware.
- **Conclusion.** "Computer vision fitness app using the TV camera" is listed by organizers as a *creative* idea ([Rules](https://amazonappdev2026.devpost.com/rules) L441; [Updates](https://amazonappdev2026.devpost.com/updates) L240). For an entrant on the VVD or a Vega stick it is **not technically verifiable**. A defensible design (inference) is to run pose estimation on a phone or laptop camera, in a browser or with MediaPipe, and stream reps and form scores to the Fire TV app over WebSocket. If you claim "TV camera" in a demo, you would likely need a Fire TV Cube or Omni plus a webcam, and third-party access to it is unproven.

## 8. Amazon Devices Builder Tools (MCP server + Agent Skills)

- **What it is.** An npm package, `@amazon-devices/amazon-devices-buildertools-mcp` (npm latest 1.0.15, modified 2026-10-02, license field "UNLICENSED"). It bundles an MCP server, Agent Skills, and steering docs ([get-started](https://developer.amazon.com/docs/adbt/get-started), redirected from `/docs/vega/0.24/mcp-server.html`, last modified Sep 30, 2026, FC-scrape).
- **Setup.** `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context [--agent claude-code-cli]`. Check it with `check-status`.
- **Tools.** `analyze_perfetto_traces`, `get_app_hot_functions`, `list_documents`, `read_asset`, `read_document`, `search_documentation`, `symbolicate_acr`.
- **Coverage.** "Full support for Vega OS and limited support for Fire OS". It needs Node 18+, and Vega SDK 0.22+ only for Vega workflows.
- **Privacy.** Documentation search queries are sent to Amazon. Anonymous telemetry is collected and can be disabled.
- It was renamed from `vega-devtools-mcp`.
- The hackathon's Resources page recommends starting here for Fire TV ([saved resources](https://amazonappdev2026.devpost.com/resources), `.firecrawl/technical-resources.md`).

## 9. Starter repos (GH-API metadata, retrieved 2026-10-03)

| Repo | License | Last push (`pushed_at`) | Stack / notes |
|---|---|---|---|
| [react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample) | MIT-0 | 2026-09-29 | 324★. Yarn 4 monorepo: `expo-multi-tv` (Expo 54, RN-tvOS 0.81, Android TV / Fire OS / tvOS / web) + `vega` app + `shared-ui` (`.kepler.ts` platform files). Node 18+. README links the Vega 0.21 install page (stale link). |
| [vega-tv-interfaces-sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample) | MIT-0 | 2026-08-06 | main = RN 0.83 (`react-native-kepler ~4.0.0+rn0.83.0`). Branches `release-rn-72-24`, `release-0.22.1`. Node 18–20. Focus, i18n, FlashList, kepler-ui-components. README: "simulator crashing randomly" after long use, so restart it. |
| [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample) | MIT-0 | 2026-08-06 | Shaka player (HLS/DASH/DRM), IAP, Content Launcher, live TV. Node 18–20. Known issues: IAP instability, occasional black screen or audio-only playback. |
| [hello-world-fire-tv](https://github.com/AmazonAppDev/hello-world-fire-tv) | MIT-0 | 2024-10-10 | Kotlin + Jetpack Compose. Android Studio + Android TV AVD. Inactive since 2024. |
| [hello-world-fire-tv-react-native](https://github.com/AmazonAppDev/hello-world-fire-tv-react-native) | MIT-0 | 2026-10-03 (branch push) | Expo + RN; Android TV emulator or Fire TV via adb. |
| [react-native-multi-tv-helloworld](https://github.com/AmazonAppDev/react-native-multi-tv-helloworld) | MIT-0 | 2026-10-01 | Minimal Vega + Android TV + tvOS template; `release-rn-72` branch. |
| [vega-sports-app](https://github.com/AmazonAppDev/vega-sports-app) | MIT-0 | 2026-08-06 | Themeable sports content app. |

MIT-0 is permissive and fine for the Open Source mini-challenge, which requires an OSS license file.

## 10. Appstore precedents (fitness, family, education, sports)

- The Fire TV Apps department on amazon.com shows these category facets: **Education, Health & Fitness, Kids, Sports**, and Games (including "Games on TV" and Fire Game Controller filters). Listed apps included The Jackbox Party Pack 3 and Disney+ ([amazon.com Fire TV Apps](https://www.amazon.com/Fire-TV-Apps-All-Models/b/?ie=UTF8&node=10208590011), FC-scrape; listing is dynamic and undated).
- Gymondo, a fitness app on Fire TV since 2016, reported 4x app opens in Q1 2020 versus Q1 2019 and used IAP and the "Recommended By Your Apps" row. Source: [Amazon DevChat](https://developer.amazon.com/apps-and-games/blogs/2020/08/devchat-gymondo-on-fire-tv), Aug 2020, from the saved search body. This is **vendor marketing, 6 years old, and its statistics cannot be verified**.
- The Amazon "Blueprint" blog series (Jul 2026) is about streaming-app quality, not categories, so it is not a category precedent.

---

## Gaps / unverified / contradictions

1. **Rules vs FAQ.** The Rules name "actual Fire TV device or the Fire TV/Vega simulator". Only the FAQ adds the "Android TV Emulator". Amazon's Fire OS docs say Fire TV uses a real device instead of an emulator. → Prefer VVD or a real device.
2. **Vega OS 2.0** is listed for the Fire TV Stick 4K 3rd Gen (2026). SDK 0.24 targets only OS 1.2. Device pages show OS 1.1 for the other Vega sticks, which is likely stale. Whether OS 2.0 devices run 0.24 apps is not verified.
3. **Camera.** No Vega camera API page or public package was found, and there is no camera hardware on Vega sticks. Third-party webcam access on Fire OS Cube or Omni is not verified. `getUserMedia` in Vega WebView is not verified.
4. **Microphone.** The Vega `AudioRecordStreamBuilder` API exists. Whether the remote mic is routed to third-party apps is not verified, and the VVD does not use the mic.
5. **VVD media and DRM support, and VVD RAM/CPU requirements:** not documented in reviewed pages. The only memory guidance is "<2 GB free causes crashes".
6. **Node v25** on this machine falls outside the samples' stated v18–v20 range. Untested.
7. **Exact 0.24 build number** was not captured. `vega sdk list-remote` would show it after install.
8. **WebFetch-sourced items** carry paraphrase risk because the shared Firecrawl account was repeatedly rate-limited (HTTP 429). These are: Content Launcher, Matter Casting, voice-enable, Differences page, Cube spec (later confirmed by FC-scrape), RNV networking, AudioRecordStreamBuilder, India press release, and sdk-install-issues.
9. **amazon.in availability** comes from the developer spec page's "Marketplaces available" lists. Live amazon.in listings and prices were not checked. The ₹3,999 street price is from a search snippet only.
10. `https://developer.amazon.com/docs/llms.txt` returned 404, even though the docs pages reference it.
11. The **Vega Virtual Device standalone page** (`/docs/vega/0.24/vega-virtual-device`) returned 404. VVD details come from the run-apps and kvd-issues pages instead.

## Searches run

| Query / action | Saved file | Useful |
|---|---|---|
| (prior) Vega search | `.firecrawl/technical-search-vega.json` | Yes (Target OS Versions body) |
| (prior) VVD search | `.firecrawl/technical-search-vvd.json` | Partly |
| (prior) simulator search | `.firecrawl/technical-search-simulator.json` | Low |
| (prior) competitor TV search | `.firecrawl/competitor-tv-search.json` | Partly (Gymondo, Blueprint) |
| map docs/vega "install" | `.firecrawl/ftv-map-install.json` | Yes |
| map docs/vega "virtual device" | `.firecrawl/ftv-map-vvd.json` | Yes |
| map docs/vega-api "camera" | `.firecrawl/ftv-map-camera.json` | No (negative evidence) |
| map docs/vega "camera" | `.firecrawl/ftv-map-camera2.json` | Partly (privileges page) |
| search "kepler-camera" Vega camera API | `.firecrawl/ftv-search-camera.json` | No |
| map docs/vega "focus" | `.firecrawl/ftv-map-focus.json` | Low |
| map docs/vega "alexa voice" | `.firecrawl/ftv-map-voice.json` | Yes |
| map docs "vega websocket fetch network" | `.firecrawl/ftv-map-network.json` | Yes |
| search Fire TV Android TV emulator | `.firecrawl/ftv-search-fireos-emulator.json` | Yes |
| search Fire TV Cube USB webcam | `.firecrawl/ftv-search-cube-webcam.json` | Yes |
| search forum camera Camera2 UVC | `.firecrawl/ftv-search-camera-forum.json` | Low |
| search 4K Select India Vega (qdr:y) | `.firecrawl/ftv-search-india-vega.json` | Yes |
| search Alexa+ Fire TV developer (qdr:y) | `.firecrawl/ftv-search-alexaplus-firetv.json` | Partly |
| map docs "vega microphone audio capture" | `.firecrawl/ftv-map-mic.json` | Yes |
| npm registry: @amazon-devices/{kepler-camera, react-native-kepler, amazon-devices-buildertools-mcp, webview, kepler-media-controls, async-storage} | not saved (inline) | Yes |
| GitHub API: 7 AmazonAppDev repos metadata + READMEs | `.firecrawl/ftv-gh-*-README.md` | Yes |

## Sources read (body actually read)

| Source | Saved file | Method | Official |
|---|---|---|---|
| Vega run-apps (0.24) | `.firecrawl/technical-vega-run-apps.md` | FC-scrape (prior) | Yes |
| Target OS Versions (0.24) | `.firecrawl/technical-search-vega.json` (body) | FC-search --scrape (prior) | Yes |
| Install Vega SDK (0.24) | `.firecrawl/ftv-install-vega-sdk.md` | FC-scrape | Yes |
| Vega release notes (0.24) | `.firecrawl/ftv-release-notes.md` | FC-scrape (max-age 0) | Yes |
| SDK install issues (0.24) | n/a | WebFetch | Yes |
| VVD troubleshooting (kvd-issues) | `.firecrawl/ftv-vvd-issues.md` | FC-scrape | Yes |
| Builder Tools MCP get-started | `.firecrawl/ftv-mcp-server.md` | FC-scrape | Yes |
| WebView overview (0.24) | `.firecrawl/ftv-webview.md` | FC-scrape | Yes |
| RN for Vega overview | `.firecrawl/ftv-vega-rn-overview.md` | FC-scrape | Yes |
| Enable keyboard (0.24) | `.firecrawl/ftv-enable-keyboard.md` | FC-scrape | Yes |
| Runtime privileges (0.24) | `.firecrawl/ftv-vega-runtime-privileges.md` | FC-scrape | Yes |
| AudioRecordStreamBuilder API | n/a | WebFetch | Yes |
| Content Launcher overview (0.24) | n/a | WebFetch | Yes |
| Matter Casting integration (0.24) | n/a | WebFetch | Yes |
| RN for Vega 0.83 network | n/a | WebFetch | Yes |
| Device specs: streaming media player | `.firecrawl/ftv-device-specs.md` | FC-scrape | Yes |
| Device specs: Fire TV Cube | `.firecrawl/ftv-device-specs-cube.md` | FC-scrape (+WebFetch) | Yes |
| Fire OS: differences from Android TV | n/a | WebFetch | Yes |
| Fire OS: Get started with React Native | `.firecrawl/ftv-fireos-rn-getstarted.md` | FC-scrape | Yes |
| Fire OS: Connect through ADB | `.firecrawl/ftv-fireos-adb.md` | FC-scrape | Yes |
| Fire OS: Get started with Fire TV | n/a | WebFetch | Yes |
| Fire OS 16 | `.firecrawl/ftv-fireos16.md` | FC-scrape | Yes |
| Fire OS: voice-enable your app | n/a | WebFetch | Yes |
| Amazon help: two-way video calling | `.firecrawl/ftv-help-video-calling.md` | FC-scrape | Yes |
| Amazon India press: 4K Select launch | n/a | WebFetch | Yes (press) |
| amazon.com Fire TV Apps department | `.firecrawl/ftv-appstore-firetv-apps.md` | FC-scrape | Yes (retail) |
| Gymondo DevChat (2020) | `.firecrawl/competitor-tv-search.json` | FC-search --scrape (prior) | Yes (vendor blog) |
| Blueprint pt7 (Jul 21, 2026) | `.firecrawl/competitor-tv-search.json` | FC-search --scrape (prior) | Yes (vendor blog) |
| react-native-multi-tv-app-sample README | `.firecrawl/technical-tv-starter.md` | FC-scrape (prior) + GH-API | Yes (Amazon repo) |
| vega-tv-interfaces-sample README + focusGuide README + package.json | `.firecrawl/ftv-gh-vega-tv-interfaces-sample-README.md`, `.firecrawl/ftv-gh-vega-tv-interfaces-focusGuide-README.md` | GH-API | Yes |
| vega-video-sample README | `.firecrawl/ftv-gh-vega-video-sample-README.md` | GH-API | Yes |
| hello-world-fire-tv README | `.firecrawl/ftv-gh-hello-world-fire-tv-README.md` | GH-API | Yes |
| hello-world-fire-tv-react-native README | `.firecrawl/ftv-gh-hello-world-fire-tv-react-native-README.md` | GH-API | Yes |
| react-native-multi-tv-helloworld README | `.firecrawl/ftv-gh-react-native-multi-tv-helloworld-README.md` | GH-API (README: Node 18+, Vega VVD M-series/Intel scripts, Expo TV for Android TV) | Yes |
| Hackathon Rules / FAQ / Overview / Resources / Updates | `.firecrawl/amazonappdev2026.devpost.com-*.md`, `hackathon-overview.md`, `technical-resources.md` | prior FC-scrape | Yes |
| Local machine check | n/a | Local (`sw_vers`, `uname`, `sysctl`, `df`) | n/a |

Not useful / failed: `docs/vega/0.24/vega-virtual-device` (404, prior file `technical-vega-simulator.md`); `docs/llms.txt` (404, `.firecrawl/ftv-llms-index.md`).

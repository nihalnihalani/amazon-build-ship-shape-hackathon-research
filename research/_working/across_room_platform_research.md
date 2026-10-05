# Across the Room: official Vega platform research

Verified by live Firecrawl retrieval on 5 October 2026 (Asia/Kolkata). Scope: native Vega Fire TV tooling, focus, rendering, persistence, networking, accessibility, and release evidence. Documentation research does not prove that the app or SDK has run on this computer.

## Executive summary

Build a native React Native for Vega app on the current SDK 0.24 / OS 1.2 / RN 0.83 track, using the official TV Interfaces sample. The first milestone must be a packaged Hello World launched on Apple Silicon VVD, followed by one real remote-driven screen. A browser preview helps design/backend integration but does not prove Vega installation or TV focus. [Compatibility matrix](https://developer.amazon.com/docs/vega/0.24/target-os-version), [Hello World](https://developer.amazon.com/docs/vega/0.24/hello-world), [official sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample).

The SDK documents fetch/WebSocket networking, focus guides, basic SVG, persistent storage, and assistive technologies. Convert these into vertical-slice runtime gates before full implementation: authenticated Vega-to-backend connectivity; realtime update/reconnect; actual target rendering/readability; preferences surviving restart; and safe recovery after disconnect. Documentation support is not a passed runtime test.

## Verified facts and implementation implications

### Toolchain and compatibility

SDK 0.24 supports RN 0.72 and 0.83 on OS 1.2; RN0.83 needs minimum OS1.2. Runtime resolution follows the Amazon React Native dependency versions. SDK0.24 requires an `[os.version]` section. Use `vega project update-manifest --os-min 1.2 --os-version 1.2`, `vega project install --fix`, the project's package manager, then `vega project doctor`. Commands that edit dependencies do not run the package manager; doctor exits nonzero on incompatible dependency/API use. Apple Silicon, Intel Mac, and Ubuntu x86_64 are supported; Windows is not. Intel support ends 15 December 2026. [Compatibility guide](https://developer.amazon.com/docs/vega/0.24/target-os-version).

The install guide requires Node18+, Rosetta on Apple Silicon, Homebrew utilities, and native macOS/Ubuntu. It warns macOS26→27 removes Rosetta. [Install](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk). The official sample specifies Node18–20, Java21+, Python3; this is narrower than the SDK minimum. Pin a successfully built sample-compatible Node version rather than assuming host Node25 works. The live sample has RN0.83/SDK0.24 release at latest main commit `7546400215691a2a1470d7d9e6b77185a67ba548`; inspect and pin a commit. Its documented artifacts are armv7 for Fire TV Stick, aarch64 for Apple Silicon VVD, and x86_64 for the corresponding VVD host. [Sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample).

Prior local ideation notes report an M4 Pro, macOS27, Node25, and missing Rosetta. These are historical machine observations to recheck at implementation time.

### Scaffold, focus, remote navigation

Amazon's Hello World guide uses the `helloWorld` RN0.83 template in Vega Studio and runs on VVD. Discover installed CLI template names with help rather than inventing a case-sensitive argument. [Hello World](https://developer.amazon.com/docs/vega/0.24/hello-world).

`TVFocusGuideView` offers `autoFocus`, directional `trapFocus*`, `destinations`, and `setDestinations`. Autofocus remembers the previous child; destinations take precedence. Known defects include calling setDestinations before mount and type definitions omitting children. Prefer destinations props and narrowly documented adapters for reproduced typing defects. [Focus API](https://developer.amazon.com/docs/vega-api/0.24/tvfocusguideview).

Project acceptance checks: every action D-pad reachable, visible focus, predictable Back behavior, focus restoration after dialogs, no traps, correct disabled-state announcements, and all essential workflows usable with the remote alone. These are proposed checks, not completed tests.

### Network contracts

The RN0.83 reference documents fetch and WebSocket. Its cookie-auth/fetch caveats include examples copied from Android/iOS; these are not Vega-specific runtime proof. Prefer explicit short-lived authorization for the TV client and test TLS, headers, authentication, reconnect, stale-result rejection, and errors on an actual VVD/device. [Networking](https://developer.amazon.com/docs/react-native-vega/0.83/network).

Recommended architecture: validate shared schemas; sequence and deduplicate messages; bound frame/message sizes and rate; use heartbeat, expiry and reconnect; expose disconnected/stale state; omit pairing secrets/results from third-party analytics. This is project guidance, not an Amazon mandate.

This networking reference alone does not establish every required native manifest privilege. Inspect the scaffold and relevant manifest/privilege reference and prove real network access before closing that gate. Do not copy Android INTERNET permissions into Vega TOML.

### Rendering and persistence

Use Amazon's supported `@amazon-devices/react-native-svg` port. Its explicit exception list excludes markers, touch events, patterns, Polygon, Polyline, TextPath, Symbol, and ForeignObject. That list conflicts with broad overview wording for Polyline, so honor exclusions and test disputed primitives. RN0.83 installation example selects ~3.0.0; resolve the actual compatible package via SDK tooling and lockfile. [SVG](https://developer.amazon.com/docs/vega-api/0.24/react-native-svg).

Use supported basic primitives/native shapes for targets and contrast patterns. Inspect actual TV output at room distance. Browser screenshots do not establish TV pixel density, viewing distance, calibration, or accessibility performance.

AsyncStorage is **unencrypted** persistent key/value storage. RN0.83 example aliases `@react-native-async-storage/async-storage` to `@amazon-devices/react-native-async-storage__async-storage@~2.1.0`, with an override. Use namespaced keys/migrations for preferences and consented nonsensitive summaries; keep ephemeral pairing secrets in memory. Avoid blanket clear operations that erase library data. [Storage](https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage).

### Accessibility

Vega supports VoiceView, Screen Magnifier, Text Banner, semantic roles, ARIA labels/states and live regions. `announceForAccessibility` is marked for future removal; favor semantic/live-region updates. Vega-specific `accessibilityOrientationText` and `accessibilityDescribedBy` explain navigation and associate static text with focused controls. [Accessibility](https://developer.amazon.com/docs/react-native-vega/0.83/accessibility).

Project gates: observe launch, instructions, target interaction, progress, errors, results and reset with VoiceView. Keep controls semantic/focusable outside decorative graphics. Provide non-color signals, high contrast, readable text and reduced motion where relevant. A linter pass is insufficient for accessibility certification.

### CI and release limitations

Amazon's CI page says integration is available to select partners only. Its Docker example is for builds; VVD is unsupported inside Docker because of display/GPU requirements. Exact SDK pinning is recommended. Separate portable unit/API/browser tests from dedicated native build and GPU/display-backed VVD/device runners. Verify SDK/registry access before promising hosted native CI. [CI guide](https://developer.amazon.com/docs/vega/0.24/continuous-integration).

A production-ready claim needs reproducible setup, release artifacts for intended hardware, package validation, real remote/network/persistence/accessibility evidence, performance measurements, privacy disclosures, backend deployment tests, and a record of external certification gates. Appstore approval is a separate status until actually obtained.

**Physical-device release gate:** Amazon explicitly requires testing on a Fire TV device before Appstore submission. VVD is appropriate for initial development. The current run guide supports Developer Mode for fuller inputd-cli automation and XML render-tree/plain-text dumps for UI and accessibility inspection. Its microphone permission dialog is safe either way because VVD does not use the microphone. [Run guide](https://developer.amazon.com/docs/vega/0.24/run-apps).

Run `vega exec vpt validate <release.vpkg>` for manifest and native ABI validation; retain strict ABI checks. VPT also documents custom signature operations with private keys/certificates, but these are capabilities rather than evidence that this project is signed correctly. Discover actual installed options with `vega exec vpt --help` and follow the official submission route. Keep signing keys out of the repository. [VPT](https://developer.amazon.com/docs/vega/0.24/vpt).

The Appstore requires a release VPKG and a manifest interactive component with `com.amazon.category.main`; missing it prevents launcher access and submission. The Developer Console handles upload, supported Fire TV device targeting, assets/metadata, review, and submission. Prepare reviewable artifacts and follow the user's authorization for actual publication; distinguish completed preparation from store acceptance. [Submission](https://developer.amazon.com/docs/vega/0.24/app-submission).

Amazon's pre-submission checklist repeats the physical Fire TV Stick requirement and covers relaunch after Back/Home, switching apps, HDMI/TV power changes, screensaver/Ambient behavior, and interruption handling. Much of its table is video-centric. For this non-video project, adapt the applicable lifecycle scenarios to preserve or safely cancel the active check and clear stale results; record video-specific cases as not applicable with justification. [Pre-submission tests](https://developer.amazon.com/docs/vega/0.24/test-before-submission).

## Source inventory and retrieval quality

All current source bodies and discovery outputs are saved under `.firecrawl/across-room-oct5/platform-*`. API and CLI share rate limits; transient errors were retried after backoff. Content inspection caught an obsolete VVD URL returning 404 despite a successful scrape operation.

| Source | URL | Status and purpose |
| --- | --- | --- |
| SDK install | https://developer.amazon.com/docs/vega/0.24/install-vega-sdk | Live body; host/Rosetta |
| Compatibility | https://developer.amazon.com/docs/vega/0.24/target-os-version | Live body; runtime/OS/doctor |
| Hello World | https://developer.amazon.com/docs/vega/0.24/hello-world | Live body; native scaffold |
| TV sample | https://github.com/AmazonAppDev/vega-tv-interfaces-sample | Live body; current release/build |
| Focus | https://developer.amazon.com/docs/vega-api/0.24/tvfocusguideview | Live body; APIs/defects |
| Network | https://developer.amazon.com/docs/react-native-vega/0.83/network | Live body; fetch/WebSocket |
| SVG | https://developer.amazon.com/docs/vega-api/0.24/react-native-svg | Live body; port/exclusions |
| AsyncStorage | https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage | Live body; aliases/unencrypted storage |
| Accessibility | https://developer.amazon.com/docs/react-native-vega/0.83/accessibility | Live body; assistive technology |
| CI | https://developer.amazon.com/docs/vega/0.24/continuous-integration | Live search-with-scrape; partner/Docker restrictions |
| Troubleshooting | https://developer.amazon.com/docs/vega/0.24/sdk-install-issues | Live search-with-scrape |
| Optional audio sample | https://github.com/AmazonAppDev/vega-audio-sample | Live search-with-scrape |
| Release notes, Japanese | https://developer.amazon.com/ja/docs/vega/0.24/vega-release-notes.html | Live discovery; recheck English latest during implementation |
| Obsolete VVD URL | https://developer.amazon.com/docs/vega/0.24/vega-virtual-device | Live **404**; exclude from working resources |
| Current run page | https://developer.amazon.com/docs/vega/0.24/run-apps | Live body; physical-device release gate, automation/render dumps |
| Package tool | https://developer.amazon.com/docs/vega/0.24/vpt | Live body; manifest/ABI validation and signing tools |
| Submission | https://developer.amazon.com/docs/vega/0.24/app-submission | Live body; VPKG, main category, console steps |
| Pre-submission tests | https://developer.amazon.com/docs/vega/0.24/test-before-submission | Live body; physical-device rule and lifecycle scenarios |

## Open gates

1. Exact SDK patch/Node/packages/OS image that build on this Mac.
2. Actual authenticated HTTPS/WSS connection and recovery without stale results.
3. Required minimal networking privileges.
4. Readability/operation at the selected viewing distance on the intended TV.
5. Native automation coverage and accessibility checks requiring observed testing.
6. Available physical hardware and outstanding external store gates.

## Rerun inputs

workflow: firecrawl-deep-research
topic: Across the Room official Vega implementation resources
depth: thorough (delegated angle of the combined report)
output: markdown

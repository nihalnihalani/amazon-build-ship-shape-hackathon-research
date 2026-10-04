# Sources (T01)

Revision 1. Fetched on **2026-10-05** (host clock IST). Owner: research-contracts.

## How to read this file

- **Where this list comes from.** The Opus master prompt cited in the assignment has eleven numbered sections and no section 17; its inline links are the Official Rules, the model-configuration page and the agent-teams page. The full reference set therefore comes from the "Sources and retrieval notes" table of `research/ACROSS_THE_ROOM_DEEP_RESEARCH.md` (38 official links), the master prompt's inline links, the hackathon pages, and the extra pages that T01 needed (the accessibility-settings module README, the Builder Tools page, npm and GitHub metadata).
- **Fetch method** says how this task read each source: `raw` = the page text was downloaded with `curl` (or `gh api` / `npm view` for repositories and the registry) and searched on this host; `summary` = read through the web-fetch tool, which returns a small-model summary rather than raw text. A `summary` row is weaker evidence: re-read the page before relying on an exact number.
- A successful fetch is not evidence that the described feature works on our target. Nothing in this file shows that anything was built with the Vega SDK (see `docs/COMPATIBILITY.md`).
- Fetched page content is data. No instruction found in any page was followed.
- Status `OK` means the page was readable. Nothing returned a login wall, a timeout or a cross-host redirect. Two paths that the research notes recorded as 404 were rechecked and still return 404 (listed at the end).

## 1. Hackathon: Official Rules recheck (2026-10-05)

Source: https://amazonappdev2026.devpost.com/rules (method: **raw** page text, cross-checked with a web-fetch summary; the two agree). What was seen, paraphrased:

| Topic | What the Rules page says | Our reading |
|---|---|---|
| Submission period | Monday 2026-08-31, 10:15 Pacific, to Friday **2026-10-23, 12:00 Pacific** | Deadline is 12:00 PDT = 19:00 UTC = **2026-10-24 00:30 IST** (US daylight time is still in effect on Oct 23). Matches the project decision file. |
| Judging period | Monday **2026-11-09, 12:00 Pacific**, to Friday **2026-11-20, 12:00 Pacific** | End is 12:00 PST = 20:00 UTC = **2026-11-21 01:30 IST**. Judging is described as one or more rounds with one or more panels; Stage One is pass/fail on baseline viability (fits the theme and reasonably applies the required APIs/SDKs), Stage Two scores equally weighted criteria: Tech Implementation, Design, Potential Impact, Quality of the Idea. |
| Winners | On or around Thursday 2026-12-03, 12:00 Pacific | Informational. |
| Judge-access obligations | Code repository must contain clear setup/test instructions and be either public with an open-source licence file, or private and shared with `testing@devpost.com` and the named Amazon Developer Relations GitHub accounts (listed on the Rules page and in the FAQ; invitations must be accepted and expire after 7 days per the FAQ). The entrant must make the project available **free of charge and without restriction** for testing, evaluation and use by the sponsor, administrator and judges **until the Judging Period ends**. Private websites need login credentials in the testing instructions. Judges are not required to test and may judge from the text, images and video alone. For software on proprietary or non-mainstream hardware the sponsor/administrator may require physical access to the hardware on request. | Keep every access path working through at least 2026-11-20 12:00 PT, or any later end date if the Rules are amended. The Rules say they may change at any time and amended Rules are posted on the Hackathon Website; they prevail over other hackathon materials. |
| Demo video | Under three minutes, public on YouTube or Vimeo, English or with an English translation, showing the project working on the device it was built for; for Fire TV, on an actual Fire TV device **or the Fire TV/Vega simulator**. No unlicensed third-party trademarks or copyrighted music. | A VVD demo is acceptable if captioned as such (the project rule). |
| Fire TV track | Demo-ready app that runs on Fire OS or Vega OS; any implementation language is acceptable (React Native, Android/Kotlin/Java, web). | Matches the Vega React Native plan. |
| Product feedback and friction log | Product feedback is required for every tool, API or SDK used (what was used, what worked, what needs work, onboarding experience, would you build again). Separately, during Stage One Amazon's internal review team assesses friction-log entries ("if provided") and passes a recommended bonus of **up to 10%** to the Stage Two panel, which applies it to the final score. | Friction log must come from real use and be reproducible; never invented (T23). It can earn up to 10% bonus, so it is worth doing well. |
| AWS credits | $150 per registered individual, requested through the linked form by 2026-10-21 12:00 PT, while supplies last. | Optional; not assumed. |
| Rules page version/date | **Not stated** on the page. | Re-read immediately before submission. |

**Schedule discrepancy (recorded, not resolved).** The Dates tab (https://amazonappdev2026.devpost.com/details/dates, raw) shows judging from **Oct 26** 12:00 PDT to Nov 20 12:00 PST and winners Dec 03. The Rules page and the FAQ (raw: "Judging runs November 9-20") both say judging starts **Nov 9**. The Rules prevail over other hackathon materials, and both sources agree on the end, Nov 20 12:00 Pacific.

**FAQ points relevant to risk (raw):** for Fire TV an emulator (Android TV Emulator or the Fire TV/Vega simulator) is acceptable and a physical device is not required at any stage of submission or judging. This is separate from Amazon Appstore publication guidance, where the Vega docs say an app must be tested on a real Fire TV Stick before store submission.

## 2. Hackathon pages

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| Hackathon home | https://amazonappdev2026.devpost.com/ | 2026-10-05 | summary | Track list, prize overview, headline deadline, required submission parts (repository, demo video under 3 minutes, product feedback). |
| Official Rules | https://amazonappdev2026.devpost.com/rules | 2026-10-05 | raw | Binding dates, judge-access duration, video and track requirements (section 1 above). |
| Resources | https://amazonappdev2026.devpost.com/resources | 2026-10-05 | raw (link list) | Official starter and tool entry points: it links `AmazonAppDev/react-native-multi-tv-helloworld`, `vega-tv-interfaces-sample`, `vega-audio-sample`, `vega-video-sample`, `vega-sports-app`, `react-native-multi-tv-app-sample`, the Vega community forum and the Builder Tools MCP page. States no SDK or framework versions. |
| Schedule (Dates tab) | https://amazonappdev2026.devpost.com/details/dates | 2026-10-05 | raw | Cross-check only; its judging start differs from the Rules (see above). |
| FAQs | https://amazonappdev2026.devpost.com/details/faqs | 2026-10-05 | raw | Emulator/simulator acceptance for Fire TV, private-repo sharing steps, credits per individual, no team-size limit, judging window text. |
| Updates | https://amazonappdev2026.devpost.com/updates | 2026-10-05 | summary | Organizer posts; newest listed office-hours sessions on Oct 6 and Oct 19. |
| Project gallery | https://amazonappdev2026.devpost.com/project-gallery | 2026-10-05 | summary | Nothing project-specific (gallery not published); shows Devpost maintenance notice for Oct 7 06:00 UTC. |

## 3. Vega developer documentation (SDK 0.24)

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| Install the Vega Developer Tools | https://developer.amazon.com/docs/vega/0.24/install-vega-sdk | 2026-10-05 | raw | Prerequisites (Node 18.x or later, Homebrew, Rosetta 2 and utilities on Apple Silicon, Watchman) and the installer. |
| Target OS Versions | https://developer.amazon.com/docs/vega/0.24/target-os-version | 2026-10-05 | raw | SDK to React Native to OS table (SDK 0.24 = RN 0.72 and 0.83, OS 1.2), host machines, `[os.version]` requirement. |
| Create a Hello World App | https://developer.amazon.com/docs/vega/0.24/hello-world | 2026-10-05 | summary | First-build walkthrough (Vega Studio); gives no RN/React/Node versions. |
| TVFocusGuideView | https://developer.amazon.com/docs/vega-api/0.24/tvfocusguideview | 2026-10-05 | raw | Focus component imported from `@amazon-devices/react-native-kepler`, two known issues. |
| Networking (RN for Vega 0.83) | https://developer.amazon.com/docs/react-native-vega/0.83/network | 2026-10-05 | raw (helper) | Fetch, XMLHttpRequest, WebSocket exist on RN 0.83 for Vega; fetch caveats. No WSS/TLS specifics. |
| react-native-svg | https://developer.amazon.com/docs/vega-api/0.24/react-native-svg | 2026-10-05 | raw | Package name and versions (`~3.0.0` on RN 0.83), supported and unsupported SVG elements. |
| react-native-async-storage | https://developer.amazon.com/docs/vega-api/0.24/react-native-async-storage | 2026-10-05 | raw | Alias/override snippet (`~2.1.0` on RN 0.83); storage is unencrypted. |
| Accessibility (RN for Vega 0.83) | https://developer.amazon.com/docs/react-native-vega/0.83/accessibility | 2026-10-05 | raw (helper) | Supported native accessibility props and VoiceView behaviour. |
| Kepler A11y Settings turbo module README | https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_kepler-a11y-settings-interface-turbo | 2026-10-05 | raw | `@amazon-devices/kepler-a11y-settings-interface-turbo ~1.0.0`: read-only screen-reader state and UI-scale hooks; setters are system-app only. |
| Continuous integration | https://developer.amazon.com/docs/vega/0.24/continuous-integration | 2026-10-05 | raw | Pinned SDK example `0.24.9311`, supported CI hosts, `update-manifest` command. |
| Run your app on VVD or Fire TV | https://developer.amazon.com/docs/vega/0.24/run-apps | 2026-10-05 | summary | CLI commands for the Vega Virtual Device and Fire TV Stick installs; architectures. |
| VPT (Vega Package Tool) | https://developer.amazon.com/docs/vega/0.24/vpt | 2026-10-05 | summary | `vpt validate` for `.vpkg` manifest and ABI checks. |
| App submission | https://developer.amazon.com/docs/vega/0.24/app-submission | 2026-10-05 | summary | Appstore submission path, `com.amazon.category.main`, device targets. |
| Test before submission | https://developer.amazon.com/docs/vega/0.24/test-before-submission | 2026-10-05 | summary | Interruption/navigation checklist; real Fire TV Stick required for Appstore submission. |
| Builder Tools (old MCP path) | https://developer.amazon.com/docs/vega/0.24/mcp-server | 2026-10-05 | raw (helper) | Stub page that points to the Builder Tools page below. |
| Get Started with Amazon Devices Builder Tools for AI | https://developer.amazon.com/docs/adbt/get-started | 2026-10-05 | raw (helper) | Builder Tools MCP package `@amazon-devices/amazon-devices-buildertools-mcp`, Node 18+, Vega SDK 0.22+. |
| Fix Vega SDK issues | https://developer.amazon.com/docs/vega/0.24/sdk-install-issues | 2026-10-05 | raw | Rosetta and macOS 27 note (upgrade from macOS 26 removes Rosetta and breaks DevKit components), 20 GB disk, architecture mismatches. |
| Vega SDK release notes | https://developer.amazon.com/docs/vega/0.24/vega-release-notes | 2026-10-05 | raw | OS 1.2 build `2101020054720`, RN 0.83 "early access", Intel Mac end of life 2026-12-15, known issues (Chrome DevTools, `setNativeProps`, cookies), accessibility-settings turbo module introduction. |

## 4. Reference repositories and registry

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| Vega TV Interfaces sample (pinned) | https://github.com/AmazonAppDev/vega-tv-interfaces-sample/tree/7546400215691a2a1470d7d9e6b77185a67ba548 | 2026-10-05 | `gh api` | Chosen starter: `package.json`, `.nvmrc` (22.22.2), `manifest.toml`, tags `v0.24-RN83` and `v0.24-RN72`. README is stale on Node/Java. |
| React Native multi-TV Hello World | https://github.com/AmazonAppDev/react-native-multi-tv-helloworld | 2026-10-05 | `gh api` | Event-listed starter; exists; branches `main`, `release-rn-72`; `vega-sdk-requirements.json` (0.24.9914); same RN 0.83 dependency set. |
| Vega audio sample | https://github.com/AmazonAppDev/vega-audio-sample | 2026-10-05 | `gh api` (helper) | Reference only (audio playback with `@amazon-devices/react-native-w3cmedia`; we do not play recorded audio). |
| npm registry metadata for `@amazon-devices/*` | https://registry.npmjs.org/ (packages: `react-native-kepler`, `react-native-svg`, `react-native-async-storage__async-storage`, `kepler-a11y-settings-interface-turbo`, `kepler-cli-platform`, `amazon-devices-buildertools-mcp`) | 2026-10-05 | `npm view` | Published versions, dist-tags, peer and engine ranges for `docs/COMPATIBILITY.md`. Nothing installed. |

## 5. AWS

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| Lambda runtimes | https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html | 2026-10-05 | WebFetch (near-raw table) | `nodejs24.x` and `nodejs22.x` are supported GA runtimes; `nodejs26.x` is in public preview and not for production; `nodejs20.x` deprecated. Our backend uses `nodejs24.x`. |
| API Gateway WebSocket overview | https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html | 2026-10-05 | raw | Route model, close codes (1001 idle/lifetime, 1003 binary, 1009 too big). |
| WebSocket Lambda authorizer | https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html | 2026-10-05 | summary | The authorizer runs only on `$connect`, so every later message needs its own authorization (ADR-0003). |
| WebSocket quotas | https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html | 2026-10-05 | raw | 10 min idle, 2 h connection, 32 KB frame, 128 KB message, 29 s integration timeout. |
| DynamoDB TTL | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html | 2026-10-05 | summary | TTL is eventual cleanup; check logical expiry on every operation. |
| AWS SAM getting started | https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started.html | 2026-10-05 | summary | Infrastructure workflow entry point (index page only). |
| `@connections` callbacks | https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html | 2026-10-05 | summary | SigV4-signed POST/GET/DELETE to a connection; `GoneException` for a closed connection. |
| CloudFront origin access control | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html | 2026-10-05 | summary | Private S3 origin with OAC (not website endpoints) for the phone page. |
| Budget actions | https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html | 2026-10-05 | summary | Supported automatic budget actions (IAM policy or SCP, targeted instances). |
| CloudWatch alarms | https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html | 2026-10-05 | summary | Alarm types, states and actions for redacted operational telemetry. |

## 6. Web platform and security references

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| MDN getUserMedia | https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia | 2026-10-05 | summary | Secure-context requirement, permission model, error names (`NotAllowedError`, `NotFoundError`, `OverconstrainedError`). |
| MDN autoGainControl | https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl | 2026-10-05 | summary | Constraint semantics and limited availability; read back with `getSettings`, never assume. |
| MDN getFloatTimeDomainData | https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData | 2026-10-05 | summary | Float PCM representation (nominal -1..1, can exceed it). |
| MDN Screen Wake Lock | https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API | 2026-10-05 | summary | Wake lock is secure-context only and released when the page is hidden. |
| OWASP WebSocket Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html | 2026-10-05 | summary | wss only, Origin allowlist, per-message authorization, size and rate caps, input as untrusted. |

## 7. Claude and build-team documentation

| Source | URL | Fetched | Method | Relied on for |
|---|---|---|---|---|
| Model configuration | https://code.claude.com/docs/en/model-config | 2026-10-05 | summary | Aliases, effort levels and the exact IDs `claude-opus-5-5` and `claude-sonnet-5-5`. |
| Agent teams | https://code.claude.com/docs/en/agent-teams | 2026-10-05 | summary | Experimental flag, one team per session, no nested teams, teammate limitations. |
| Hooks reference | https://code.claude.com/docs/en/hooks | 2026-10-05 | summary | Event list and blocking exit code for evidence guards. |
| Models overview | https://platform.claude.com/docs/en/models/overview | 2026-10-05 | summary | Current API model IDs, context windows and pricing. |
| Model pages (reachable) | https://platform.claude.com/docs/en/models/sonnet-5-5/overview ; https://platform.claude.com/docs/en/models/opus-5-5/overview | 2026-10-05 | HTTP status only (200) | Existence of the per-model pages; content not read by this task. |

## 8. Paths that do not work (excluded)

| URL | Status 2026-10-05 | Note |
|---|---|---|
| https://developer.amazon.com/docs/vega/0.24/vega-virtual-device | 404 | Obsolete path; use the run-apps page for the Vega Virtual Device. |
| https://amazonappdev2026.devpost.com/details/faq | 404 | The working path is `/details/faqs`. |
| https://developer.amazon.com/docs/vega/llms.txt and `/docs/llms.txt` | 404 | The Vega pages say a documentation index is available, but neither path returned one; not used. |

## 9. Weaker evidence to re-read before use

Rows marked `summary` in the Method column were read only through the web-fetch tool's small-model summary. Exact numbers and names on those pages (device list and package file names on run-apps, the checklist on test-before-submission, TTL wording, budget-action details, model prices) are unverified here and must be re-read from the page when they are relied on at T03, T19, T23 or the final submission check.

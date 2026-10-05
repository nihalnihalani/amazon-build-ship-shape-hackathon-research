# Friction log

**PREPARED, NOT SUBMITTED.** Every entry below comes from work that was actually attempted in this repository, and cites the repository file or the evidence-log entry that shows it. Nothing is invented. Entries that were verified in the release-docs pass but are not in `.build/evidence.jsonl` say so ("verified in the docs pass"). The Official Rules (as read 2026-10-05) say Amazon's internal review team assesses friction-log entries during Stage One, "if provided", and passes a recommended bonus of up to 10% to the Stage Two panel, so every entry is written to be reproducible.

Not attempted, therefore **no entries and no experience claimed**: installing or running the Vega SDK, the `vega` CLI, a Vega Virtual Device or a Fire TV; the Amazon Devices Builder Tools MCP; Amazon Polly; Bedrock, AgentCore, Strands or Kiro; any deployed AWS service. Blockers: B-001 to B-004 (`.build/blockers.md`).

Format per entry (the Devpost template as read): task, steps, expected versus actual, severity, workaround, actionable suggestion. Severity scale: Blocker (stopped the work), High (put a core requirement at risk), Medium (cost time or created doubt), Low (cosmetic or documentation), Info.

| ID | Area | Severity | Status |
|---|---|---|---|
| F-01 | Vega SDK install, macOS 27 | Blocker | open (B-001) |
| F-02 | RN 0.83 maturity | Medium | open, fallback documented |
| F-03 | Sample licence signals | Medium | verified in the docs pass |
| F-04 | Stale Node and Java prerequisites | Medium | worked around |
| F-05 | WebSocket manifest privileges | High | unverified (B-001) |
| F-06 | Typechecking without the SDK | Info | worked |
| F-07 | Headless Chrome and `getUserMedia` | Medium | resolved in the test script; the host behaviour remains |
| F-08 | API Gateway cannot choose close codes | Low | documented, not run on AWS |
| F-09 | No per-connection timer on Lambda | Medium | worked around, not run on AWS |
| F-10 | Undeclared `buffer` import in the SVG package | Low | verified in the docs pass |
| F-11 | `npm audit` on `react-native` tooling | Medium | open upstream; recorded as an A7-01 exception by the lead |
| F-12 | Vega documentation inconsistencies | Low | recorded, not resolved |
| F-13 | Hackathon Dates tab versus Rules | Low | recorded |
| F-14 | AWS credentials are the root user | Blocker (environment) | open (B-003) |
| F-15 | `npm ls` on a standalone project with `file:` dependencies | Low | worked around |
| F-16 | Vite dev server and React Native Flow sources | Low | resolved |

---

## F-01 The Vega SDK cannot be installed on macOS 27 without Rosetta 2

- **Task:** install the Vega developer tools on an Apple Silicon Mac (Apple M4 Pro, macOS 27.0.1) to build the TV app natively.
- **Steps:** (1) read the install page (https://developer.amazon.com/docs/vega/0.24/install-vega-sdk): on Apple Silicon its dependency step installs Rosetta 2. (2) Checked the host: `arch -x86_64 /usr/bin/true; pgrep oahd`. (3) Read the troubleshooting page (https://developer.amazon.com/docs/vega/0.24/sdk-install-issues).
- **Expected:** a current Mac can start the installation.
- **Actual:** `arch: posix_spawnp: /usr/bin/true: Bad CPU type in executable` and no `oahd` process: Rosetta is absent. The troubleshooting page states that upgrading from macOS 26 to macOS 27 removes Rosetta, that several Vega DevKit components depend on it, and that the fix is to reinstall it. We did **not** run the installer: reinstalling Rosetta accepts Apple's licence, and the installer modifies shell profiles and enables SDK telemetry by default, so both are owner actions.
- **Severity:** Blocker for this host. It prevented every native step (`vega project doctor`, build, VVD, `vpt validate`).
- **Workaround:** none without owner action. The app was developed against the published `@amazon-devices/*` packages (F-06) and tested with mocks.
- **Suggestion:** ship a native arm64 toolchain, or make the installer detect the missing Rosetta before it starts and say what to run.
- **Reference:** `.build/evidence.jsonl` EV-0001, EV-0002; `.build/blockers.md` B-001; `docs/COMPATIBILITY.md` section 3.

## F-02 React Native 0.83 is "early access" in the release notes while both official samples default to it

- **Task:** choose the React Native line for the TV app.
- **Steps:** read the SDK 0.24 release notes and target-OS page; read `package.json` of `vega-tv-interfaces-sample` (pinned commit `7546400`) and `react-native-multi-tv-helloworld` (`4b9ebf8`).
- **Expected:** the sample's default line is the one the notes call stable.
- **Actual:** the release notes describe RN 0.83 for Vega as "in early access" and RN 0.72 as "the established runtime", yet both samples pin 0.83.0 (React 19.2.0, OS 1.2). Known limits listed for 0.83: Chrome DevTools unsupported, `setNativeProps()` crashes.
- **Severity:** Medium: a maturity risk for a hackathon build.
- **Workaround:** locked 0.83.0 as the samples do (ADR-0007) and recorded the RN 0.72 fallback (starter tag `v0.24-RN72`, `cfaabd9`, SVG and async-storage `~2.0.0`), to be decided only with measured evidence once the SDK runs.
- **Suggestion:** state the support status of each line in the sample READMEs.
- **Reference:** EV-0007, EV-0011; `docs/COMPATIBILITY.md` sections 1 and 5; `docs/adr/0007-runtime-and-toolchain.md`.

## F-03 The official samples are MIT-0, but their source files say "PROPRIETARY/CONFIDENTIAL"

- **Task:** decide whether sample code may be reused in an open-source repository.
- **Steps (verified in the docs pass, not in the evidence log):** on 2026-10-05 fetched the raw files from the public repositories: `LICENSE` and `src/App.tsx` and `manifest.toml` of `AmazonAppDev/vega-tv-interfaces-sample` at commit `7546400215691a2a1470d7d9e6b77185a67ba548`, and `LICENSE` and `packages/vega/src/App.tsx` of `AmazonAppDev/react-native-multi-tv-helloworld` at `4b9ebf86d697e06c4547084e98b51a7318976a75`. The GitHub metadata in the research notes (EV-0011, `research/`) records both as MIT-0.
- **Expected:** one licence signal per repository.
- **Actual:** both repositories carry an MIT-0 ("MIT No Attribution", Copyright 2025 Amazon.com) `LICENSE`, while the source files checked start with "Copyright (c) 2025 Amazon.com, Inc. or its affiliates. All rights reserved. PROPRIETARY/CONFIDENTIAL. USE IS SUBJECT TO LICENSE TERMS." (the multi-TV starter's `App.tsx` says 2022). The `@amazon-devices/*` npm packages are under a third licence, the Program Materials License Agreement (F-11, `docs/release/LICENSES.md`). Only the files named above were checked, not every file in either repository.
- **Severity:** Medium: ambiguity for anyone publishing derived code under an open-source licence.
- **Workaround:** this repository copied **no** sample source file (a search of tracked files outside generated release artifacts for the header found none); only version pins and manifest field names were taken from the sample.
- **Suggestion:** make the file headers match the repository `LICENSE`, or say which governs.
- **Reference:** `docs/COMPATIBILITY.md` section 1 (rows 23 and 24); `docs/release/SUPPLY_CHAIN.md` section 6.

## F-04 Prerequisite documentation is stale against the pinned samples

- **Task:** choose the Node version for the Vega toolchain.
- **Steps:** compared the install page, the sample READMEs, `package.json` `engines`, `.nvmrc` and `.npmrc` of the pinned sample.
- **Expected:** one Node requirement.
- **Actual:** the install page says "Node.js 18.x or later"; the sample READMEs say "NodeJS v18-v20" and Java 21+; the pinned `package.json` says `engines.node >=22`, `.nvmrc` is `22.22.2` and `.npmrc` sets `engine-strict=true`; `@amazon-devices/react-native-kepler` needs `>=22.14.0`.
- **Severity:** Medium: following the README would install an unsupported Node.
- **Workaround:** treated `package.json` and `.nvmrc` as authoritative (ADR-0007). On this host Node 22.22.2 is not installed; 22.23.2 satisfies the ranges and runs the typecheck, jest and the Metro bundle (the pinned patch is untested).
- **Suggestion:** update the README and the install page to match `engines`.
- **Reference:** `docs/COMPATIBILITY.md` sections 1 and 3 and open item 6; `docs/adr/0007-runtime-and-toolchain.md`.

## F-05 The manifest privileges that WebSocket needs are undocumented

- **Task:** let the TV app open a WSS connection to the relay (ADR-0006).
- **Steps:** read the RN 0.83 for Vega networking page and the official sample's `manifest.toml`; wrote `apps/tv/manifest.toml`.
- **Expected:** a list of the services and privileges required for `fetch` and `WebSocket`, and any certificate rules.
- **Actual:** the page documents `fetch`, `XMLHttpRequest` and `WebSocket` with generic React Native text and no Vega-specific WSS or TLS rules. The official sample declares `com.amazon.network.privilege.net-info` under `[needs]`; our manifest declares only `[[wants.service]] com.amazon.network.service` and omits `net-info` because the app reads no network information. Whether that is enough, and whether a locally generated CA is trusted by the runtime, is **unknown**: nothing could be run (B-001).
- **Severity:** High: it puts the TV-to-relay transport at risk and cannot be answered without the SDK.
- **Workaround:** recorded as an open native check; the repository makes no claim that the TV can connect, and the relay documentation says "do not promise self-signed WSS works on Vega".
- **Suggestion:** document the required privileges and the TLS trust behaviour on the networking page.
- **Reference:** `apps/tv/manifest.toml` comments; `docs/COMPATIBILITY.md` section 2 (Networking row) and open item 5; `docs/operations/LOCAL_RELAY.md`.

## F-06 Typechecking the TV app without the SDK works, because the Vega packages are public on npm

- **Task:** make progress on the TV app while the SDK cannot be installed.
- **Steps:** `npm view` for `@amazon-devices/react-native-kepler`, `react-native-svg`, `react-native-async-storage__async-storage`, `kepler-a11y-settings-interface-turbo` and `kepler-cli-platform`; installed them in `apps/tv`; ran `npx tsc --noEmit`, `npx jest` (native modules mocked) and `react-native bundle --platform kepler --dev false`.
- **Expected:** the types need the SDK.
- **Actual:** the packages resolve from the public registry without credentials (`react-native-kepler` 4.0.1, `svg` 3.0.9000000001, `kepler-cli-platform` 0.22.14) and `tsc` reports 0 errors; the Metro bundle for platform `kepler` builds in about 8 seconds (1,543,752 bytes). This proves typing and bundling only, **not** that the app runs on Vega: registry availability is not runtime compatibility.
- **Severity:** Info (it worked, and is what made the rest of the work possible).
- **Workaround:** n/a.
- **Suggestion:** say in the docs that the JavaScript side can be typechecked and bundled without the native SDK, and which parts cannot.
- **Reference:** EV-0008, EV-0014, EV-0033; `docs/TESTING.md` section 1; `docs/release/SUPPLY_CHAIN.md` section 7.

## F-07 Headless Chrome's `getUserMedia` behaviour differs between runs on the same build

- **Task:** test the phone page's "waiting for permission" state in automated Chrome.
- **Steps:** the phone script `apps/phone/e2e/production.mjs` clicks "Start microphone" with permission left at "prompt" and expects the call to stay pending. EV-0019 recorded it passing in headless Chrome 154. On 2026-10-05 the same script was run twice in a clean clone, and a probe page (`navigator.mediaDevices.getUserMedia({audio: true})` after load) was run.
- **Expected:** a stable result for the same Chrome build.
- **Actual:** Chrome 154.0.8037.97 rejected the call immediately with `NotAllowedError` (probe output `REJECTED:NotAllowedError`); the script failed three checks both times and never reached its stubbed-audio part. A probable cause is the operating-system microphone permission state for Chrome on this Mac (unverified: no system setting was inspected or changed).
- **Severity:** Medium for reproducibility; it does not affect the product.
- **Workaround:** the error classes and the production capture path are covered with a stubbed `getUserMedia`; the smoke, flow and hostile-QR scripts do not depend on this. **Resolution:** the phone owner reworked the script (merged `734c20b`) to accept both outcomes, check each against its own UI and print which one happened. At `ac556df` it passed twice here (31 checks, immediate `NotAllowedError` after about 72 ms) and once with `ATR_E2E_SIMULATE=pending` (30 checks, labelled SIMULATED), so the pending branch is evidenced on this host only as a simulation.
- **Suggestion:** for test tooling, assert the denied and the pending outcomes as separate cases and detect which one the browser gives before asserting; the browser's behaviour for a headless unanswered prompt is not something a script can assume.
- **Reference:** EV-0019; `apps/phone/e2e/production.mjs` header; `docs/TESTING.md` section 2; `docs/LIMITATIONS.md` section 7 item 1.

## F-08 API Gateway's Management API cannot choose a WebSocket close code

- **Task:** close an unauthenticated connection after its deadline with a defined code (ADR-0003 uses 4401).
- **Steps:** designed the AWS adapter against the API Gateway documentation (`docs/SOURCES.md` section 5: close codes 1001, 1003 and 1009 are the platform's) and the `@connections` callback API, where closing is `DeleteConnection`.
- **Expected:** the server can send a close code and reason.
- **Actual:** `DeleteConnection` takes none, so the client sees a closed socket and no code. The adapter sends an `error` message (`unauthenticated`, `auth_deadline`) first. The local adapter closes with 4401; a test runs the same scenarios through both adapters and compares the messages. This was designed from the documentation and tested against fakes; it was **not** reproduced on a real API Gateway (B-003).
- **Severity:** Low.
- **Workaround:** message-level parity (reason in the `error`), as above.
- **Suggestion:** allow a close code and reason on `DeleteConnection`.
- **Reference:** `docs/operations/AWS_ADAPTER.md`; `docs/operations/SECURITY-NOTES.md` section 5; `services/relay/test/aws-adapter.test.ts`.

## F-09 A Lambda behind API Gateway has no per-connection timer

- **Task:** enforce "authenticate within 5 s (65 s while a join is pending)" on AWS.
- **Steps:** same design work as F-08.
- **Expected:** a timer per connection, as in a long-lived process.
- **Actual:** the handler is stateless and API Gateway offers no timer, so the deadlines need an SQS delay queue, a dead-letter queue, a second Lambda (`deadline.handler`) with a concurrency cap and a logical deadline check on every later message: a second function, two queues and three extra alarms (errors, queue age, dead-letter queue) for what a Node process does with a sweep. Tested against fakes only (B-003).
- **Severity:** Medium (design and cost complexity).
- **Workaround:** the SQS design in `docs/operations/AWS_ADAPTER.md`.
- **Suggestion:** a documented per-connection idle or authentication timeout for WebSocket APIs.
- **Reference:** `docs/operations/AWS_ADAPTER.md`; `infra/template.yaml`.

## F-10 `@amazon-devices/react-native-svg` imports `buffer` without declaring it

- **Task:** list what actually ends up in the TV JavaScript bundle.
- **Steps (verified in the docs pass):** built a Metro bundle for platform `kepler` with a source map (`react-native bundle --platform kepler --dev false --sourcemap-output ...`) and listed the `node_modules` packages in it (`docs/release/tools/bundle-packages.mjs`); ran `npm ls buffer ieee754`; read the SVG package's `package.json` and `lib/commonjs/utils/fetchData.js`.
- **Expected:** every package the bundle imports is declared by something in the production tree.
- **Actual:** the bundle contains `buffer@5.7.1` and `ieee754@1.2.1`. `fetchData.js` line 8 does `require("buffer")`; the package's `dependencies` are only `css-select`, `css-tree` and `warn-once`. `buffer` is in the lockfile only through the dev tooling chain (`kepler-cli-platform` to `ora` to `bl`), marked `devOptional`.
- **Severity:** Low today (it resolves), Medium if someone installs production dependencies only.
- **Workaround:** none needed; recorded in the licence inventory because both packages (MIT, BSD-3-Clause) are in the bundle.
- **Suggestion:** declare `buffer` as a dependency of the package.
- **Reference:** `docs/release/tv-bundle-packages.json`; `docs/release/SUPPLY_CHAIN.md` section 3.

## F-11 `npm audit --omit=dev` reports 70 findings from React Native tooling that is not in the bundle

- **Task:** meet the release gate "no unresolved high or critical in `npm audit --omit=dev`" (ADR amendment A7-01) for the TV app.
- **Steps (verified in the docs pass):** `npm audit --omit=dev` in `apps/tv`; mapped the advisories to the bundle.
- **Expected:** a clean or small result for a production audit.
- **Actual:** 70 findings (2 low, 19 moderate, 44 high, 5 critical): `react-native` and `@amazon-devices/react-native-kepler` list their command-line and Metro tooling as ordinary dependencies, so npm counts `logkitty`, `shell-quote`, `jscodeshift`, `@microsoft/api-extractor` and others as production. None of the packages carrying an advisory is in the 27-package JavaScript bundle. npm's suggested fixes are semver-major (`react-native` 0.87.1) and do not fit the Vega-supported line.
- **Severity:** Medium: an open release-gate item.
- **Workaround:** none applied to the packages. The lead recorded a documented A7-01 exception for build-time tooling (none of the affected packages is in the 27-package bundle; re-audit at every SDK bump and before any public release) in `docs/adr/AMENDMENTS-REV2.md`. Analysis in `docs/release/SUPPLY_CHAIN.md`.
- **Suggestion:** move tooling out of the runtime dependency list of the Vega packages and `react-native`'s peer story.
- **Reference:** `docs/release/audit/npm-audit-tv-omit-dev.json`; `docs/release/SUPPLY_CHAIN.md` section 3.

## F-12 Vega documentation inconsistencies

- **Task:** pin versions and APIs from the documentation.
- **Steps:** read the SDK 0.24 pages, the SVG and async-storage API pages, the CI page and the multi-TV starter's `vega-sdk-requirements.json`.
- **Expected:** one value per fact.
- **Actual:** (a) SDK build `0.24.9311` on the CI page versus `0.24.9914` in the starter; (b) the SVG page's introduction lists `Polyline` as supported while its table says unsupported (the app uses `Path` only); (c) the async-storage page shows `~2.0.0` in its RN 0.72 snippet but `~2.1.0` in its table; (d) several pages say a documentation index (`llms.txt`) is available, but `/docs/vega/llms.txt` and `/docs/llms.txt` return 404, as does the older `/docs/vega/0.24/vega-virtual-device` page.
- **Severity:** Low.
- **Workaround:** trusted the tables and the pinned `package.json`; recorded each contradiction instead of guessing.
- **Suggestion:** fix the pages; publish the index or remove the sentence.
- **Reference:** `docs/COMPATIBILITY.md` open items 1 and 6; `docs/SOURCES.md` sections 3 and 8.

## F-13 The hackathon Dates tab disagrees with the Official Rules

- **Task:** fix the schedule.
- **Steps:** read the Rules page, the FAQ and the Dates tab (raw page text, 2026-10-05).
- **Expected:** one judging start.
- **Actual:** the Dates tab shows judging from 26 October; the Rules and the FAQ say 9 November. Both agree judging ends 20 November 12:00 Pacific (21 November 01:30 IST).
- **Severity:** Low.
- **Workaround:** followed the Rules, which prevail.
- **Suggestion:** align the Dates tab.
- **Reference:** EV-0011; `docs/SOURCES.md` section 1.

## F-14 The default AWS credentials on the build machine are the account root user

- **Task:** prepare an AWS staging deployment of the relay.
- **Steps:** `aws sts get-caller-identity` (account id redacted in the record).
- **Expected:** a least-privilege deploy principal.
- **Actual:** the default credentials resolve to the account **root** user (region `us-east-1`). Deploying with root keys is not acceptable and no spend authorization existed, so nothing was deployed. This is an environment condition, not a defect in AWS.
- **Severity:** Blocker for deployment (B-003).
- **Workaround:** drafted a deployer policy and a CloudFormation execution role (`infra/iam/`), never used.
- **Suggestion (to the owner):** create a deployer role and profile and authorize a staging budget.
- **Reference:** EV-0004; `.build/blockers.md` B-003; `infra/README.md`.

## F-15 `npm ls --all --json` fails on a standalone project with `file:` links to workspace packages

- **Task:** produce a CycloneDX SBOM for `apps/tv`.
- **Steps (verified in the docs pass):** `npx @cyclonedx/cyclonedx-npm --omit dev` in `apps/tv` (Node 22.23.2).
- **Expected:** an SBOM.
- **Actual:** exit 254: "npm error missing: @atr/protocol@0.1.0, required by session-core@npm:@atr/session-core@0.1.0" although `npm ci`, the build, `tsc` and jest all work.
- **Severity:** Low.
- **Workaround:** `--ignore-npm-errors`; recorded in `docs/release/SUPPLY_CHAIN.md` section 5.
- **Suggestion:** make `npm ls` resolve registry-range dependencies of a `file:` linked package from the linking project.
- **Reference:** `docs/release/SUPPLY_CHAIN.md` section 5.

## F-16 Vite's dev server could not optimise React Native's Flow sources (resolved)

- **Task:** a browser preview of the TV UI for accessibility checks.
- **Steps:** `npx vite` in `apps/tv/web` with `react-native-web` and the public `react-native-svg`.
- **Expected:** the dev server starts.
- **Actual:** the dependency optimiser failed with `[PARSE_ERROR] Flow is not supported ../node_modules/react-native/Libraries/Utilities/codegenNativeComponent.js` because `react-native-svg` deep-imports `react-native/...`. The preview was built with `vite build` and served with `vite preview` instead. A later change made the dev server start again (it serves HTTP 200 for `/` and `/src/main.tsx`; a page render of the dev server was not inspected).
- **Severity:** Low.
- **Workaround:** build and preview, which is what the accessibility suite uses.
- **Suggestion:** n/a (our harness, not an Amazon tool).
- **Reference:** `docs/evaluation/A11Y_T17_PREP.md` observation OBS-A7 and section 9.2; `docs/SETUP.md` section 5.

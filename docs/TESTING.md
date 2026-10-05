# Testing

Status: every suite below was run on 2026-10-05 from a **clean clone at integration commit `63af0ae`** (macOS 27.0.1, Apple M4 Pro, Google Chrome 154.0.8037.97 headless; Node 24.11.1 for the root workspace and the end-to-end suites, Node 22.23.2 for `apps/tv` and the accessibility gate). The counts are the ones observed in those runs; they match the integration records EV-0037 to EV-0040 in `.build/evidence.jsonl` except where stated, and the lead recorded these clean-clone runs as EV-0042. Logs were kept outside the repository. The lockfile was changed afterwards by the `vitest` 3.2.7 and `ws` 8.22.0 bumps (merged at `cfa5158`); after the merge only the root workspace was rerun (`npm run build`, `npm run typecheck` and `npm test` in the docs worktree, all exit 0, Node 24.11.1): the counts below are unchanged except session-core, which is now **378** tests (the new `privacy-copy.test.ts`), and relay, which showed 1,111 passed and 2 skipped because that worktree has no `cfn-lint` venv. The `apps/tv`, end-to-end, accessibility and phone Chrome suites were **not** rerun (see the pre-publication cleanup, item P4, in `docs/submission/SUBMISSION_CHECKLIST.md`).

**Read the evidence class before quoting a result.** Everything here is `automated` or `web_preview`. **No suite uses a real phone microphone, the Vega runtime, a Vega Virtual Device, a physical Fire TV or AWS**, and no result may be promoted to those classes:

| Class | Meaning in this repository |
|---|---|
| `automated` | A command run on this host with an exit code and counts. Uses fakes, mocks, synthetic audio (sine waves) or a headless TV core. |
| `fixture_replay` | Numeric or synthetic-audio replay through real code paths (the phone test build). Labelled "Fixture replay" in the product. |
| `web_preview` | The TV UI rendered by react-native-web in desktop Chrome with shims. **Not Vega**: no VoiceView, no Vega focus engine, no real UI-scale setting. |
| `documentation_only` | Read from a page, registry or repository; not exercised. |
| `real_phone`, `real_VVD`, `physical_Fire_TV` | **No result of these classes exists.** |

Pass counts prove the tested arithmetic, state machines and wiring. They do not prove microphone validity, Vega compatibility, privacy of a deployed service or store acceptance.

## 1. Unit and integration suites (no browser)

Run from the repository root with `npm ci` done. `npm test` runs all seven workspaces below in one command.

| Suite | Command | Files / tests (observed) | What it proves | Class |
|---|---|---|---|---|
| Wire protocol | `npm test -w @atr/protocol` | 14 files / **921** | Envelope, 37 message types, direction and auth catalogue, validators, quantisation, cross-field invariants, display-safe text, replay helpers; a test parses `docs/PROTOCOL.md` and fails on drift. Node only, not Hermes. | automated |
| DSP | `npm test -w @atr/phone-mic-meter` | 14 / **450** | RMS and dBFS, framing at 48, 44.1 and 22.05 kHz, hysteresis VAD, precheck and window validity, quantisation, qualification analysis, protocol conformance (about 8,000 generated payloads), and agreement of the shipped code with the independent Python oracle's hand-derived fixtures. Not a measurement of any microphone. | automated (fixtures) |
| Ten-foot meter | `npm test -w @atr/ten-foot-meter` | 3 / **49** | Arc geometry, smoothing, cue helpers | automated |
| Session core | `npm test -w @atr/session-core` | 24 / **371** | The TV state machine, verdict maths, hidden-meter and reveal rules, listener and cue rules, storage, retention, migration and deletion with fakes, number matching, rotation, soft-window fixtures (20 of 20 `not_reached`) | automated |
| Relay | `npm test -w @atr/relay` | 31 / **1,111 passed, 2 skipped** without `cfn-lint`; **1,113 passed** with `services/relay/.venv` | Security suites SEC-* run on the memory store and on a strict DynamoDB model, the real local HTTPS and WSS server on an ephemeral port (needs `openssl`), Lambda adapters against fakes, redaction scans of all log output, IaC assertions (shown to fail on broken templates), cost model, docs consistency. The model is not DynamoDB. | automated |
| Phone page | `npm test -w @atr/phone` | 20 / **459** | Phone state machine, wire shapes checked by an independent PROTOCOL.md checker and by the package parser, audio port against the real capture adapter with fake browser objects, view rendering (text only, no meter), lifecycle and reconnect, production-bundle exclusions (builds both flavours) | automated (happy-dom, fakes) |
| Independent QA review | `npm test -w @atr/tests` (`vitest run --config review/vitest.config.ts`) | 1 / **163** | Independently authored review suite for session-core (hidden-meter leak differential, storage, resume, listener, cues). `QA_STRICT=1` runs known-defect repros as ordinary tests; no repro wrapper remains, so strict and normal both give 163 of 163 (both run). | automated |

Typecheck, all workspaces: `npm run typecheck` (exit 0; the `tests` workspace typechecks its main, review and accessibility projects). Build: `npm run build` (exit 0).

### TV app (`apps/tv`, Node 22, standalone)

| Suite | Command (in `apps/tv`) | Result | What it proves | Class |
|---|---|---|---|---|
| Typecheck against the published Vega types | `npm run build:packages && npx tsc --noEmit` | exit 0 | The app code typechecks against `@amazon-devices/*` types installed from npm, **without the SDK** | automated |
| Component and runtime tests | `npx jest` | **29 suites / 639 tests**, exit 0 (ends with a "worker process failed to exit gracefully" warning) | Focus models, accessibility props, hidden-attempt rendering, silent live regions while capturing, UI-scale geometry at 1.25, 1.5 and 2.0, remote routing, privacy copy and console stripping, runtime against the real session store. **Vega native modules are replaced by hand-written mocks.** | automated |
| JS bundle | `npm run check:bundle` | exit 0, "OK"; bundle 1,543,752 bytes | `react-native bundle --platform kepler --dev false` produces a bundle without `console.log/warn/info/debug` and with at most 3 `console.error` references | automated; **not a native build** |

## 2. End-to-end suites (system Chrome)

All drive system Google Chrome through `playwright-core`. No Playwright browser download is needed. They start a real local relay (HTTPS and WSS with a throwaway CA from `scripts/dev-certs`) on a random port; they take minutes and run files one at a time (`fileParallelism: false`).

| Suite | Command | Observed | What it proves | What it does not | Class |
|---|---|---|---|---|---|
| Complete local session | `cd tests && npx vitest run --config vitest.e2e.config.ts e2e/local-journey.test.ts` | **4 of 4 passed**, 107.9 s (EV-0037: 103 s) | Headless TV session core over WSS to the real local relay, and the phone `dist-test` build in Chrome with synthetic audio: pairing with number matching and phone confirmation, credential rotation, explicit microphone start, quiet check, calibration, vowel, 10 phrases (hidden 3, 6, 9; retry; skip; cue; listener timeout), and a summary equal to the hand-derived values (attempted 9, completed 9, skipped 1, ...) | A real phone, a real microphone, the Vega UI, any network but loopback | automated |
| Failure recovery | `cd tests && npx vitest run --config vitest.e2e.config.ts e2e/fault-recovery.test.ts` | **8 of 8 passed**, 211.4 s (EV-0038) | Fault-injecting WSS proxies on both legs: TV link loss (rotated-credential reconnect), phone link loss (`peer_offline` keeps the session), 300 ms latency each way, every phone frame duplicated, phone page hidden, room noisier (gate), continuous sound, digital silence (`silent_input`); faulted attempts are never scored | Lambda errors, cold starts and credential expiry on AWS; real networks | automated |
| TV accessibility gate | `cd tests && QA_STRICT=1 node a11y/run-a11y.mjs` (also `npm run test:a11y -w @atr/tests`) | **59 of 59 passed** (51 browser tests + 8 unit tests), 130 s (EV-0039) | Builds the TV web preview with `vite build`, serves it with `vite preview`, and checks 29 fixture screens plus real-store keyboard-only journeys: footer text on every screen, accessible names, visible focus ring (minimum contrast 13.26:1), Cancel-first destructive dialogs, no meter or verdict leak on blind screens (with negative controls), UI scale 1.0, 1.25, 1.5 and 2.0, axe-core 4.13.0 (no serious or critical), number-matching join, silent input, link loss, credential rotation | **Not Vega.** VoiceView, the Vega focus engine, the real UI-scale setting and native rendering. The preview's navigation and scale are shims. T17 stays `blocked_external`. | web_preview |
| Phone real-Chrome scripts | `npm run e2e:all -w @atr/phone` (builds `dist` and `dist-test`, then `smoke.mjs`, `flow.mjs`, `production.mjs`, `hostile-qr.mjs`) | **smoke 19 checks passed; flow 81 checks passed; production FAILED 3 checks (twice); hostile-QR 13 checks passed** (run separately because the `&&` chain stops at the failure) | Smoke: render and join, exact A2-01 privacy sentence, secure context, no CSP violation, no request left the machine, no storage or cookies, 390 px layout. Flow: the full phone flow with synthetic audio through the real `AudioContext` and `AudioWorklet`: confirmation step, `mic.state` first, DEF-003 held messages, quiet check, `silent_input`, windows, levels bound to ids, session end shutting capture down, no `MediaRecorder`, no vibration or sound. Hostile-QR: an attacker relay that accepts anyone cannot get the microphone or any data before the phone owner confirms. | Android Chrome, a physical microphone, real permission prompts. The production script is host-dependent, see below. | automated / fixture_replay (synthetic or stubbed audio) |

**`production.mjs` did not pass on this host.** Part A of the script assumes that in headless Chrome 154 a real, unanswered `getUserMedia` call stays pending, and it asserts the page keeps saying "Waiting for permission" and offers Cancel. In this run (and again on a second run) the same headless Chrome rejected the call immediately with `NotAllowedError`: a probe that loads a blank page and calls `getUserMedia({audio: true})` returned `REJECTED:NotAllowedError` at once, so the failure is not in the product page. EV-0019 recorded the full `e2e:all` passing earlier in the day, so the behaviour changed on this host. A probable cause is the operating-system microphone permission state of Google Chrome (unverified: no privileged check was made and no system setting was changed). Because the script aborts in part A, its part B (stubbed `getUserMedia`: precheck, worklet under the strict CSP, shutdown) did not run here. The smoke, flow and hostile-QR scripts do not depend on this behaviour and passed. This result is **not reproduced** until the owner resets Chrome's microphone permission and reruns.

## 3. Other checks

| Check | Command | Observed | Class |
|---|---|---|---|
| DSP oracle and fixtures | `python3 fixtures/dsp/tools/derive_fixtures.py` | exit 0 in 21.6 s: "oracle matched every hand-derived value"; regenerated 39 quiet-check, 21 VAD, 27 window, 20 soft-window and 19 click-train fixtures, the phase sweep and 6 AR(1) models with **no diff** against the committed JSON | automated (arithmetic only) |
| T04 freeze | `python3 fixtures/dsp/tools/freeze_hash.py` | protocol `7059dd75...`, criteria `6b7c339d...`, combined `3ba1fdff...`: identical to EV-0030 at `63af0ae`. No trial has been run (B-002). | documentation_only |
| Infrastructure template | `services/relay/.venv/bin/cfn-lint -t infra/template.yaml --regions ap-south-1` | cfn-lint 1.57.1, exit 0 | automated (lint, not a deployment) |
| Lambda bundle | `npm run bundle:lambda -w @atr/relay` | exit 0; two 1.99 MB bundles | automated |
| Local relay start-up | `npm run start:local -w @atr/relay` with scratch dev certificates | listens, `/healthz` ok, security headers present; refuses unsafe configurations (exit 2) | automated (manual probe) |
| Licence inventory, SBOM, `npm audit` | see [release/SUPPLY_CHAIN.md](release/SUPPLY_CHAIN.md) | root `--omit=dev` clean (also after the bumps); `apps/tv` 70 findings, recorded by the lead as an A7-01 exception for build-time tooling | automated |

## 4. Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `ATR_CHROME` | `tests/src/e2e-env.ts` (local-journey and fault-recovery) | Path of the Chrome executable. Default `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The phone scripts and the accessibility gate use `channel: 'chrome'` instead and ignore it. |
| `QA_STRICT` | `tests/review/session-core.review.test.ts`, `tests/a11y/tv-web-preview.e2e.ts` | `1` runs confirmed-defect repro tests as ordinary tests (they would fail while a defect is open). By default repros are wrapped in `it.fails` so the suite stays green. At `63af0ae` no wrapper remains, so both modes pass. |
| `TV_UI_REV2` | `tests/a11y/tv-web-preview.e2e.ts` | `0` skips the store-mode groups (only for testing against an older TV UI). Default: they run. |
| `TV_PREVIEW_PORT` | `tests/a11y/run-a11y.mjs` | Port for `vite preview` (default 5179, falls back to a free port) |
| `TV_PREVIEW_URL` | `tests/a11y/run-a11y.mjs`, `helpers.ts` | Reuse an already running preview and skip the build |
| `VITE_ATR_TEST_AUDIO` | `apps/phone/vite.config.ts` | `1` builds the synthetic-audio test flavour (same as `npm run build:test`) |
| `ATR_DEBUG` | `tests/e2e/fault-recovery.test.ts` | Prints the mic-state transition log |
| `ATR_PORT`, `ATR_TLS_CERT`, `ATR_TLS_KEY`, `ATR_ENV`, ... | local relay | See `docs/operations/LOCAL_RELAY.md`; the end-to-end environment sets its own |

Side effect: `QA_STRICT=1 node a11y/run-a11y.mjs` rewrites `tests/a11y/artifacts/report.json`, `manifest.json` and a committed screenshot; the other screenshots are git-ignored.

## 5. What a pass does not cover (summary)

No result of any suite shows: that a physical microphone's relative level is monotonic, repeatable or unclipped (the T04 experiment is frozen but not run); that the TV app builds, installs or renders on Vega; that WSS works from the Vega runtime to a locally generated certificate; VoiceView behaviour; AsyncStorage on a device; real DynamoDB, API Gateway, SQS, CloudFront or alarm behaviour; deployed logs; latency measured from a camera. See [LIMITATIONS.md](LIMITATIONS.md) for the measured-versus-fixture-versus-pending table and the pending external checks.

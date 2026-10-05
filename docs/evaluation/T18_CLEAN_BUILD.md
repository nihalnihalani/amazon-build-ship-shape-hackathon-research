# T18: clean-build gate in a fresh clone

Reviewer: Sonnet 5.5 (`claude-sonnet-5-5`), branch `wt/qa`. Date: 2026-10-05, 02:27 to 02:43 UTC.
Evidence class: **automated** (and `web_preview` for the a11y gate). Nothing here is Vega, VVD or real-phone evidence: the native checks need a
supported host with the Vega SDK (blocker B-001) and were not attempted. `npm run bundle:js` produced a Metro JavaScript bundle, not a Vega package.

## 1. Result

**Pass.** In a fresh `git clone` of the local repository at the integrated head `5dc35bded974cd1129e04a3eb88a55a5a58443d9`
("Checkpoint: security/qa/docs wave dispatched; matrix refreshed"; 0 uncommitted files in the clone), every documented command exited 0
and every count matched the lead's report. Seven undocumented prerequisites or hazards were found (section 5): one portability defect
(the Chrome path), one ordering defect, one evidence-integrity hazard in the e2e harness, and four minor items.

| Gate | Result |
|---|---|
| Root `npm ci`, `npm run build`, `npm run typecheck`, `npm test` | all exit 0; **3524 tests passed, 2 skipped** across 7 workspaces |
| apps/tv `npm ci`, `tsc --noEmit`, jest, `bundle:js` (Node 22) | all exit 0; **jest 639 tests in 29 suites**; bundle written |
| a11y web-preview gate | exit 0; **59 tests** (51 browser plus 8 unit) |
| Local e2e, both suites | exit 0; **12 of 12** (T12 4/4 in 107.9 s, T15 8/8 in 211.8 s) |

## 2. Environment

| Item | Value |
|---|---|
| Host | MacBook Pro, Apple M4 Pro, 14 cores, 24 GiB, macOS 27.0.1 (26A434), Darwin 27.0.0 arm64 |
| Node (root, a11y, e2e) | v24.11.1 (the root `.nvmrc` pin), npm 11.6.2 |
| Node (apps/tv, a11y gate) | v22.23.2, npm 10.9.8 (`apps/tv/.nvmrc` pins 22.22.2, which is not installed on this host; 22.23.2 satisfies `engines >=22`) |
| Default Node on PATH | v25.2.1 (not used for any T18 step; the earlier flake runs in `QA_REVIEW_T12_T15.md` used it) |
| Browser | Google Chrome 154.0.8037.97 at the macOS default path |
| Other tools | OpenSSL 3.6.4, GNU bash 3.2.57, git 2.50.1 (Apple), npm registry `https://registry.npmjs.org/` |
| Disk | 460 GiB volume, 96 % full (19 GiB free). Installed size: root `node_modules` 107 MB, `apps/tv/node_modules` 808 MB, `apps/tv/web/node_modules` 58 MB |
| Load | load average 4.55, 6.00, 10.22 at the start; other agents were running on this host |
| Clone | `git clone --no-hardlinks "/Users/nihalnihalani/Desktop/Github/amazon devpost hackathon" atr`, then `git checkout --detach 5dc35bd` in `/private/tmp/claude-501/t18/atr`. Only committed content is cloned: the untracked `research/` files of the primary checkout are absent |

How the steps were run: each command went through a small wrapper (kept outside the repository) that sets `PATH` to the named Node, runs
the command with `bash -c` from the stated directory, and records the exit code, wall time and start time as one JSON line. Full logs
are kept in the scratch directory. Durations are wall clock on a warm npm cache (see section 6).

## 3. Commands, exit codes, durations

### 3.1 The gate (clone `atr`)

| Step | Command (directory) | Node | Exit | Time | Count / observation |
|---|---|---|---|---|---|
| 01 | `git clone --no-hardlinks <repo> atr && git checkout --detach 5dc35bd` | 24.11.1 | 0 | 0.8 s | HEAD `5dc35bd`, 0 modified files |
| 02 | `npm ci` (root) | 24.11.1 | 0 | 2.0 s | 110 packages; `npm audit`: 3 findings (section 5, QA-T18-04) |
| 03 | `npm run build` (root) | 24.11.1 | 0 | 2.8 s | protocol, phone-mic-meter, ten-foot-meter, session-core, relay by `tsc`; phone by `vite build` (45 modules, 105 kB JS) |
| 04 | `npm run typecheck` (root) | 24.11.1 | 0 | 5.7 s | no diagnostics |
| 05 | `npm test` (root) | 24.11.1 | 0 | 36.5 s | protocol 921; phone-mic-meter 450; ten-foot-meter 49; session-core 371; relay 1111 (+2 skipped); phone 459; tests 163. **Total 3524 passed, 2 skipped** |
| 06 | `npm run test:a11y -w @atr/tests` | 22.23.2 | 0 | 137.7 s | the runner installed `apps/tv` (1381 packages, 5 s) and `apps/tv/web` (58 packages) itself, built the preview with `vite build` (vite 8.3.2, 380 modules), served it on 5179. **59 passed** (2 files) |
| 07 | `npm ci` (`apps/tv`, plain, install scripts enabled) | 22.23.2 | 0 | 35.3 s | only `npm warn deprecated` lines; no script needed a download; 808 MB |
| 08 | `npm run typecheck` (`apps/tv`: `tsc --noEmit`) | 22.23.2 | 0 | 1.5 s | no diagnostics |
| 09 | `npm test` (`apps/tv`: jest) | 22.23.2 | 0 | 7.4 s | **29 suites, 639 tests passed**, 0 snapshots |
| 10 | `npm run bundle:js` (`apps/tv`: `react-native bundle --platform kepler`) | 22.23.2 | 0 | 6.6 s | Metro v0.83.8; `build/farsidecheck.bundle` 1,543,752 bytes (a JS bundle only, not a Vega package) |
| 11 | `node scripts/check-bundle-console.mjs` (`apps/tv`) | 22.23.2 | 0 | 0.0 s | console references `{log:0, warn:0, info:0, debug:0, error:3, trace:0}`, "OK" |
| 12 | `npm run test:e2e -w @atr/tests` (both suites) | 24.11.1 | 0 | 320.8 s | T12 4 tests in 107.9 s; T15 8 tests in 211.8 s; **12 of 12 passed** |

### 3.2 Probes for undocumented prerequisites

| Step | Command | Clone | Exit | Time | What it showed |
|---|---|---|---|---|---|
| 13 | `ATR_CHROME=/nonexistent/chrome npx vitest run --config vitest.e2e.config.ts e2e/fault-recovery.test.ts -t 'microphone goes digitally silent'` | atr | **1** | 4.3 s | `browserType.launch: Failed to launch chromium because executable doesn't exist at /nonexistent/chrome`. The override works for the e2e suites, but the message does not name `ATR_CHROME` |
| 21, 22 | fresh clone `atr2`, `npm ci` only | atr2 | 0, 0 | 0.8, 2.1 s | no build |
| 23 | `npm run typecheck` (root, **no build**) | atr2 | **2** | 4.9 s | TS2307 "Cannot find module '@atr/protocol'" (and the same for the other workspace packages): 2 errors in phone-mic-meter, 12 in session-core, 3 in relay, 24 in phone, 24 in tests; protocol and ten-foot-meter 0 |
| 24 | `npm test` (root, **no build**) | atr2 | **1** | 32.0 s | phone-mic-meter 2 files fail, session-core 24 of 24 files fail, phone 19 of 20 files fail, tests 1 of 1 fails, all "Failed to resolve entry for package @atr/protocol (or @atr/phone-mic-meter, @atr/session-core)"; protocol, ten-foot-meter and relay pass |
| 25 to 27 | `npm ci --ignore-scripts`, `npm run typecheck`, `npm test -- --ci` in `apps/tv` of `atr2` (root installed, **root not built**) | atr2 | 0, 0, 0 | 33.4, 1.6, 6.8 s | apps/tv does not need the root build |
| 28, 29 | `npm run build:packages`, then `npm run typecheck` in `apps/tv` | atr2 | 0, 0 | 1.8, 1.2 s | `build:packages` is optional for typecheck and jest |
| 31 to 34 | fresh clone `atr3`: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test -- --ci` in `apps/tv` with **no root install and no root build** | atr3 | 0, 0, 0, 0 | 0.7, 6.0, 1.3, 6.8 s | apps/tv is fully self-contained |
| 52a, 52b | fresh clone `atr4`, `npm ci` only; then `npx vitest run --config vitest.e2e.config.ts e2e/local-journey.test.ts` | atr4 | 0, **1** | 2.1, 0.8 s | `Failed to resolve entry for package "@atr/protocol"` at import: the e2e suites also need a prior `npm run build`, although `buildArtifacts()` rebuilds inside `beforeAll` (too late; QA-E2E-04) |
| 51 | the T12 journey in `atr2` after step 28 (`build:packages` had built protocol, session-core and ten-foot-meter) | atr2 | 0 | 109.3 s | 4/4 passed; this was an extra run, concurrent with the mutation experiments of `QA_REVIEW_T12_T15.md`, and is **not** a no-build probe (the name of the step in my log is misleading; 52b is the no-build probe) |

### 3.3 State of the clone afterwards

`git status --short` in `atr` after steps 01 to 12 lists two modified tracked files, both written by the a11y gate:
`tests/a11y/artifacts/manifest.json` and `tests/a11y/artifacts/report.json` (commit, timestamp, Node version and some screenshot hashes change on
every run; for example `vowel_active.png` hashed differently from the committed copy). Nothing else is modified.

## 4. The verified clean-build sequence

There is no document that lists this (finding QA-T18-03). The sequence below is what passed:

```bash
# root workspaces: Node >= 22 (the root .nvmrc pins 24.11.1), needs openssl and bash for the dev-cert script the e2e/relay tests call
npm ci
npm run build        # must come first: typecheck, test and the e2e suites resolve workspace packages through dist
npm run typecheck
npm test

# apps/tv is a standalone project: Node 22 (apps/tv/.nvmrc 22.22.2), no root install or build needed
cd apps/tv
npm ci --ignore-scripts        # plain `npm ci` also passed (probe 07)
npm run typecheck
npm test -- --ci
npm run bundle:js              # Metro JS bundle only, not a Vega package (B-001)

# browser suites: need Google Chrome. e2e honours ATR_CHROME; the a11y gate does NOT (QA-T18-01).
npm run test:a11y -w @atr/tests     # installs apps/tv and apps/tv/web itself if node_modules is missing
npm run test:e2e -w @atr/tests
```

## 5. Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **QA-T18-01** | Medium (portability) | Both browser suites need Google Chrome at the macOS default path, and **the a11y gate cannot be redirected**. `tests/src/e2e-env.ts` reads `process.env.ATR_CHROME`; `tests/a11y/helpers.ts:13` is `export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';` with no override. `ATR_CHROME` appears in no document. With the browser missing, the failure text names the path but not the variable. The a11y file is mine from an earlier turn; it is outside this turn's allowed paths, so it is not edited here. Suggested patch: `export const CHROME_PATH = process.env.ATR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';` | source lines above; probe 13 |
| **QA-T18-02** | Medium (ordering) | `npm run typecheck` (exit 2) and `npm test` (exit 1) at the root fail on a tree that was never built, because workspace packages resolve each other through `dist`; the e2e suites fail at import (exit 1). The errors ("Failed to resolve entry for package ...") do not say "run `npm run build` first". Not documented anywhere. | probes 23, 24, 52b |
| **QA-E2E-04** | Medium (evidence integrity) | See `QA_REVIEW_T12_T15.md`: `buildArtifacts()` rebuilds after the TV core and protocol are imported, so an e2e run after editing those packages tests a stale TV core. Clean-clone runs are unaffected because the build precedes them. | mutation pass 1 in the review document; probe 52b |
| QA-T18-03 | Low (documentation) | No document lists the clean-build commands. The root `README.md` is the research brief ("research only. Nothing in this repository has been built"). The commands live in `package.json` scripts, `docs/operations/LOCAL_RELAY.md` (`npm install`, `npm run build -w @atr/phone`), and `docs/evaluation/A11Y_T17_PREP.md` (apps/tv installs). The Node split (root 24.11.1, apps/tv 22.22.2) is documented only in ADR-0007 and COMPATIBILITY.md. The facts that apps/tv needs no root install or build, and that the a11y runner self-installs `apps/tv` and `apps/tv/web`, are in no document. | README head; probes 31 to 34; step 06 log |
| QA-T18-04 | Low (supply chain) | `npm audit` at the root: 3 findings. `vitest` 3.2.4 **critical** (arbitrary file read and execution when the Vitest UI server is listening; not used here), `@vitest/mocker` moderate, and `ws` 8.18.3 **high** (uninitialised memory disclosure; memory exhaustion from small fragments). `ws` 8.18.3 is the **tests** workspace's devDependency; `services/relay` already pins 8.22.0. Both have non-major fixes available (vitest 3.2.7, ws 8.22.0). `apps/tv`: 95 findings (2 low, 20 moderate, 68 high, 5 critical), all in the React Native and Kepler dev toolchain. Lockfile changes are left to the lead. | `npm audit --json`, `npm audit` in apps/tv |
| QA-T18-05 | Low | Running the documented a11y gate rewrites two tracked files (`tests/a11y/artifacts/{manifest,report}.json`); screenshot hashes are not stable across runs and hosts, so the tree is dirty after every gate run, and a CI run would show a diff. | section 3.3 |
| QA-T18-06 | Info | Disk is 96 % full on this host; `apps/tv/node_modules` alone is 808 MB. | `df`, `du` |
| QA-T18-07 | Info | `apps/tv` `check:bundle` allows at most 3 `console.error` references in the Metro bundle (they belong to React Native's own fatal-error reporter; log, warn, info, debug, trace must be 0). The limit is in `scripts/check-bundle-console.mjs`; the bundle has exactly 3. | step 11 |

Not a defect, noted for the lead: relay tests and the e2e relay start need `openssl` and `bash` on the PATH (documented in `docs/operations/LOCAL_RELAY.md`
and `scripts/dev-certs/README.md`); both are present on the host and on the GitHub-hosted Ubuntu 24.04 image.

## 6. What this does and does not show

* One host, one OS, one browser (Chrome 154). Linux was not exercised; `.github/workflows/ci.yml` was written to cover the Linux-portable part and is unrun.
* The npm cache was warm, so install durations (2 s root, 35 s apps/tv) exclude registry download time. A cold cache will be slower; I did not measure it.
* All timings were taken while other agents used the host (load average 4.5 to 10).
* apps/tv ran on Node 22.23.2, not the pinned 22.22.2 (not installed here).
* The root workspaces ran on Node 24.11.1 only; Node 22 and 25 were not run for T18 (Node 25.2.1 was used for the earlier flake runs).
* `bundle:js` shows the JavaScript compiles and bundles for the `kepler` platform. It does not show that a Vega package builds or runs (B-001).

## 7. CI mapping (`.github/workflows/ci.yml`, not pushed, not run)

| Verified locally here | In CI | Notes |
|---|---|---|
| steps 02 to 05 | job `workspace`, Node 22 and 24, same order | blocking |
| steps 07 to 09 (apps/tv) | job `tv`, Node from `apps/tv/.nvmrc`, `npm ci --ignore-scripts`, typecheck, jest | blocking; no root install or build needed (probes 31 to 34) |
| step 12 (e2e) | job `browser-e2e`, `ATR_CHROME=/usr/bin/google-chrome`, root build first | **non-blocking**, unverified on Linux |
| step 06 (a11y gate) | **excluded** | needs QA-T18-01 fixed first |
| step 10 (`bundle:js`) | excluded | Vega-toolchain command; not a portable check |
| any Vega or VVD check | **none, and none claimed** | needs a supported host with the SDK (B-001) |

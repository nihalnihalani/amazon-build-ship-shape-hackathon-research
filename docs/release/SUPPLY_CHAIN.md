# Supply chain: lockfiles, audit, SBOM, bundle contents, artifact hashes

Status: first prepared at integration commit `63af0ae` on 2026-10-05 from a **clean clone** (`git clone` of the `wt/docs` repository, `git checkout 63af0ae`, then `npm ci`), so the results do not depend on a developer's leftover `node_modules`; **updated after merging `build/across-the-room` at `cfa5158`**, which bumped `vitest` to 3.2.7 and the `tests` workspace `ws` to 8.22.0 (lockfile change) and recorded the A7-01 exception. After the merge the root and `apps/tv` projects were reinstalled with `npm ci` from the merged lockfiles and the audits, the licence inventory and both SBOMs were regenerated. Nothing here was signed or published. Companion files: [LICENSES.md](LICENSES.md), `../../THIRD_PARTY_NOTICES.md`, `SBOM.cdx.json`, `SBOM.tv.cdx.json`, `audit/`.

Release gate this serves: amendment **A7-01** ("root lockfile, exact versions for security-relevant packages, `npm audit --omit=dev` with no unresolved high/critical, licence inventory and SBOM, recorded support dates for Node 22/24, Vega SDK 0.24 and RN 0.83 (early access)").

## 1. Gate status

| A7-01 item | Status | Notes |
|---|---|---|
| Root lockfile | **met** | `package-lock.json` (lockfileVersion 3) is committed; `npm ci` at the root succeeded under Node 24.11.1 (110 packages at `63af0ae`, 105 after the bumps) |
| `apps/tv` lockfile | **met** | `apps/tv/package-lock.json` is committed; `npm ci` in `apps/tv` succeeded under Node 22.23.2 |
| Exact versions of security-relevant packages | **met for the relay**, ranges for Vega packages | `ws` 8.22.0 and `@aws-sdk/*` 3.1146.0 are pinned exactly in `services/relay/package.json`. The Vega packages use the starter's `~` ranges (`@amazon-devices/react-native-kepler ~4.0.0+rn0.83.0`, `react-native-svg ~3.0.0`, async-storage alias `~2.1.0`); the lockfile freezes them |
| `npm audit --omit=dev`, root workspace | **met: 0 vulnerabilities**, before and after the bumps | section 2 |
| `npm audit --omit=dev`, `apps/tv` | **not clean: 70 findings, 5 critical, 44 high; recorded as an A7-01 exception by the lead** | build and CLI tooling only; none of the packages carrying an advisory is in the 27-package JavaScript bundle; the exception does not cover any bundled package; section 3 |
| Licence inventory | **met, with flags** | [LICENSES.md](LICENSES.md): 5 proprietary Amazon packages, 2 packages with unclear licence declarations (neither in the bundle) |
| SBOM | **met** | section 5 |
| Recorded support dates | **met** | section 6 |

Overall: the root workspace meets A7-01. `apps/tv` does **not** have a clean `--omit=dev` audit; the lead recorded a documented exception for build-time tooling in `docs/adr/AMENDMENTS-REV2.md` ("Supply-chain decision (A7-01 exception, 2026-10-05)"): none of the affected packages is in the Metro runtime bundle (`tv-bundle-packages.json`), re-audit at every SDK bump and before any public release. This document records that decision and does not itself accept any risk.

## 2. Root workspace audit

**After the bumps** (merged lockfile at `cfa5158`, Node 24.11.1, npm 11.6.2):

- `npm audit --omit=dev`: exit 0, **0 vulnerabilities** (50 production, 112 dev, 53 optional, 2 peer dependencies counted by npm). Raw JSON: `audit/npm-audit-root-omit-dev.json`.
- `npm audit` including dev dependencies: **2 moderate findings, 0 high, 0 critical**, both development-only and not shipped: `vitest` 3.2.7 and `@vitest/mocker` 3.2.7, GHSA-82fw-gwwq-j7x9 (path traversal and arbitrary file read through redirect mocks; advisory range below 4.1.11). npm's suggested fix is a **semver-major** `vitest` upgrade (5.0.3 when rechecked; the lead's record says v4), which was **accepted for development use only** because the test UI server is never run in CI or production. Raw JSON: `audit/npm-audit-root-all.json`.

**Before the bumps** (`63af0ae`; the same commands in the clean clone, kept here for the record; the raw pre-bump JSON is in commit `f2075fe`): `npm audit --omit=dev` 0, and `npm audit` including dev 3 findings, all development-only:

| Package | Severity | Advisory | Where | Resolution |
|---|---|---|---|---|
| `vitest` 3.2.4 | critical | GHSA-5xrq-8626-4rwp: arbitrary file read and execution **when the Vitest UI server is listening** (range below 3.2.6) | root `devDependencies` | fixed by the bump to 3.2.7 (verified: the post-bump audit no longer lists it) |
| `ws` 8.18.3 | high (and one moderate) | GHSA-96hv-2xvq-fx4p: memory exhaustion from tiny fragments (below 8.21.0); GHSA-58qx-3vcg-4xpx: uninitialised memory disclosure (below 8.20.1) | `tests/package.json` `devDependencies` only (the fault-injecting WebSocket proxies of the end-to-end tests) | fixed by the bump to 8.22.0 (verified). The shipped relay already used `ws` 8.22.0 and was never affected. |
| `@vitest/mocker` 3.2.4 | moderate | GHSA-82fw-gwwq-j7x9 | same chain as `vitest` | **still open at 3.2.7**: fixed only in a major version (above) and accepted for development use |

Effect of the bumps on the shipped inventory: the third-party production package set is unchanged (the same 36 packages and versions). `ws` 8.22.0 moved from `services/relay/node_modules/ws` to the hoisted `node_modules/ws`, so its path changed in `licenses.root.json` and the SBOM. The root SBOM was regenerated and is idempotent on a second run (identical bytes); its component set is the same 43 components as before, with more metadata fields (descriptions and `private` flags) than the first run.

## 3. `apps/tv` audit (exception recorded)

Command: `npm audit --omit=dev` in `apps/tv` (Node 22.23.2, npm 10.9.8; rerun after the merge with the same result, the `apps/tv` lockfile did not change). Exit 1: **70 vulnerabilities (2 low, 19 moderate, 44 high, 5 critical)** among 1,208 production-classified packages. Raw JSON: `audit/npm-audit-tv-omit-dev.json` (full audit, `audit/npm-audit-tv-all.json`: 95 findings, 68 high, 5 critical).

Why so many "production" findings: `react-native` 0.83.0 and `@amazon-devices/react-native-kepler` declare the command-line and Metro tooling (`@react-native/community-cli-plugin`, `metro`, `@react-native-community/cli`, `jscodeshift`, `@microsoft/api-extractor` and their dependencies) as ordinary dependencies, so npm counts them as production. They run on the developer's build machine; they are not part of the app that runs on the TV.

The advisories at high or critical severity sit in these packages (each row is an advisory that npm reports as applying to that package):

| Package | Severity | Advisory | Vulnerable range |
|---|---|---|---|
| `logkitty` | critical | GHSA-v8v8-6859-qxm4 arbitrary shell command execution | below 0.7.1 |
| `shell-quote` | critical, high | GHSA-w7jw-789q-3m8p (`quote()` and newlines), GHSA-395f-4hp3-45gv (quadratic parse) | up to 1.8.3 and 1.8.4 |
| `braces` | high | GHSA-grv7-fg5c-xmjg, GHSA-vfj7-8cjw-p6xm (resource exhaustion) | below 3.0.3 |
| `cross-spawn` | high | GHSA-3xgq-45jj-v275 ReDoS | below 6.0.6 |
| `image-size` | high | GHSA-w3rx-r6r6-pgpr ICNS parser infinite loop | 0.6.3 to 2.0.2 |
| `lodash` | high | GHSA-r5fr-rjxr-66jc code injection via `_.template` | 4.0.0 to 4.17.23 |
| `minimatch` | high | GHSA-23c5-xmqv-rm74, GHSA-7r86-cg39-jmmj, GHSA-3ppc-4f35-3m26 ReDoS | below 3.1.4 |
| `node-fetch` | high | GHSA-r683-j2x4-v87g forwards secure headers | below 2.6.7 |
| `tmp` | high | GHSA-ph9p-34f9-6g65 path traversal | below 0.2.6 |
| `ws` (old copies) | high | GHSA-3h5v-q93c-6h6q, GHSA-96hv-2xvq-fx4p | below 5.2.4 and 5.2.5 |
| `react-native` | high | GHSA-7f53-fmmv-mfjv ReDoS (range 0.59.0 to 0.62.3: **not** the installed 0.83.0; npm flags the package through its CLI dependencies) | n/a |

The remaining findings are parents flagged only through those packages (for example the five `@amazon-devices/*` packages through `jscodeshift`, `@microsoft/api-extractor` and `@react-native/community-cli-plugin`).

**What is and is not in the shipped bundle.** A Metro bundle for platform `kepler` (`--dev false`) was built and its source map read (`tools/bundle-packages.mjs`): the bundle contains **27 third-party packages** (774 source files, 89 of ours), listed with licences in `tv-bundle-packages.json`. None of the packages that carry an advisory above is among them. Four bundled packages are flagged only transitively (`@amazon-devices/kepler-a11y-settings-interface-turbo`, `@amazon-devices/keplerscript-turbomodule-api`, `@amazon-devices/react-native-async-storage__async-storage` and `@amazon-devices/react-native-kepler`, all severity "high" through non-bundled tooling such as `jscodeshift` and `@microsoft/api-extractor`); the audit lists no advisory on those four packages themselves.

**Status: recorded as an A7-01 exception by the lead (2026-10-05), not resolved.** The exception text in `docs/adr/AMENDMENTS-REV2.md` reads, in substance: all 70 findings sit inside React Native and Vega build and CLI tooling; none of the affected packages is in the 27-package Metro runtime bundle (`tv-bundle-packages.json`); accepted as a documented exception for build-time tooling pending upstream Vega and React Native releases; **re-audit at every SDK bump and before any public release; the exception does not cover any package that ships in the bundle.** npm's suggested fixes are semver-major jumps (for example `react-native` 0.87.1) or point at old vendor versions, and none fits the Vega-supported RN 0.83 line, so none was applied. The developer-machine exposure is real even though the TV is unaffected: for example `logkitty` and `shell-quote` run in the developer's shell during React Native CLI use. Other options, not taken: ask Amazon to move the tooling out of the runtime dependency list, or add `overrides` for individual tooling packages after confirming the Vega build still works, which needs the SDK (B-001). The five `@amazon-devices/*` packages are proprietary dependencies, never vendored into this MIT repository.

## 4. Licences

See [LICENSES.md](LICENSES.md) for the method, counts by licence, direct dependencies and flags, `licenses.root.json` and `licenses.tv.json` for every package, and `../../THIRD_PARTY_NOTICES.md` for notices and licence texts. Summary: root workspace 36 third-party production packages, all permissive (Apache-2.0 31, MIT 4, 0BSD 1); `apps/tv` 1,123 packages in npm's production closure (1,116 permissive), of which the **5 `@amazon-devices/*` packages are proprietary** (Amazon "Program Materials License Agreement", https://developer.amazon.com/support/legal/pml, not an open-source licence, not covered by this project's MIT licence, not redistributed in this repository) and 2 (`jsonify`, `options`) have unclear declarations (dev-tool chain, not in the bundle). The owner should read the Program Materials License Agreement before any public production distribution.

## 5. SBOM

| File | Contents | Tool | SHA-256 (first 16 hex) |
|---|---|---|---|
| `SBOM.cdx.json` | CycloneDX 1.6, root workspace, production only (`--omit dev`): 43 components (36 third-party, 7 first-party workspace packages) | `npx @cyclonedx/cyclonedx-npm@6.0.1 --omit dev --output-format JSON --output-reproducible --spec-version 1.6` run at the repository root with Node 24.11.1 (twice after the merge: identical bytes) | `53f5a1d4ec88980d` (regenerated after the bumps; first run `82ec667c6001db2e`) |
| `SBOM.tv.cdx.json` | CycloneDX 1.6, `apps/tv`, production only: 1,248 components counted with nesting (npm's production closure, a superset of the bundle) | the same tool run in `apps/tv` with Node 22.23.2 and `--ignore-npm-errors` | `cd19867c9e864b42` |

`--output-reproducible` omits the serial number and timestamp so that regenerating from the same lockfile produces the same file. The `apps/tv` SBOM needs `--ignore-npm-errors` because `npm ls --all --json` reports one `missing` edge (`@atr/protocol@0.1.0` required by `@atr/session-core` through the `file:` link) although `npm ci`, the build, the typecheck and the jest suite all work; the SBOM still lists `@atr/protocol` through the TV's own `file:` dependency. No system install was needed: the tool ran through `npx`.

Regenerate:

```sh
npm ci                                                       # root, Node 24
npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --omit dev --output-format JSON --output-reproducible --spec-version 1.6 --output-file docs/release/SBOM.cdx.json
cd apps/tv && npm ci                                         # Node 22
npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --ignore-npm-errors --omit dev --output-format JSON --output-reproducible --spec-version 1.6 --output-file ../../docs/release/SBOM.tv.cdx.json
cd ../.. && node docs/release/tools/license-inventory.mjs    # LICENSES.md, licenses.*.json, THIRD_PARTY_NOTICES.md
```

Note that `license-inventory.mjs` must run after `tv-bundle-packages.json` is current to fill the "In the JS bundle" column; produce the bundle and source map first (see the header of `tools/bundle-packages.mjs`).

## 6. Recorded support dates and platform status

| Item | Fact | Source (fetched 2026-10-05) |
|---|---|---|
| AWS Lambda `nodejs24.x` | Generally available; deprecation 2028-04-30, block create 2028-06-01, block update 2028-07-01. The relay targets this runtime. | AWS Lambda runtimes page (`docs/COMPATIBILITY.md` section 4) |
| AWS Lambda `nodejs22.x` | Supported; deprecation 2027-04-30 | same |
| AWS Lambda `nodejs26.x` | Public preview, not for production; not used | same |
| Node for the TV toolchain | `apps/tv/.nvmrc` 22.22.2 (starter), `engines.node >=22`; the host has 22.23.2, not 22.22.2, so the pinned patch is untested | `docs/COMPATIBILITY.md` section 3 |
| Vega SDK 0.24 | Exact build not pinned (`0.24.9311` in CI docs, `0.24.9914` in the starter); **not installed here (B-001)**. Intel Mac support ends 2026-12-15 and SDK 0.24 is the last to support it. | Vega release notes and target-OS pages |
| React Native for Vega 0.83.0 | **Described as "early access"** in the official release notes while the official samples default to it; fallback line is RN 0.72 (starter tag `v0.24-RN72`). Known limits: Chrome DevTools unsupported on 0.83, `setNativeProps()` crashes. | Vega release notes |
| Vega OS | Target and minimum 1.2 ("OS 1.2 is the only available version in this release") | Target OS page |
| Official starter licences | Both official starters have an MIT-0 `LICENSE` file ('MIT No Attribution', Copyright 2025 Amazon.com): `vega-tv-interfaces-sample` at the pinned `7546400` (ADR-0007 base) and `react-native-multi-tv-helloworld` at `4b9ebf8`. **Their source files nevertheless carry the header 'PROPRIETARY/CONFIDENTIAL. USE IS SUBJECT TO LICENSE TERMS'** (checked in this documentation pass by fetching raw `src/App.tsx` and `manifest.toml` at `7546400` and `packages/vega/src/App.tsx` at `4b9ebf8`; not part of the evidence log). This repository copied no starter source file (a search for the header found none outside generated release files); only version pins and manifest field names were taken. See `docs/submission/FRICTION_LOG.md`. | direct fetch 2026-10-05 |

Recheck every row before the final submission; Lambda runtime tables, npm dist-tags and the Vega pages change.

## 7. Artifacts built in the clean clone (observed, not signed)

These hashes were observed on this host at `63af0ae` and are recorded so that a later rebuild can be compared. They are **not** release artifacts and no signing was done (the Vega route needs a signed `.vpkg`, which needs the SDK).

| Artifact | Command | Observed |
|---|---|---|
| Lambda relay bundle | `npm run bundle:lambda -w @atr/relay` | `relay.mjs` 1,993,168 bytes, sha256 `800714230301a644d907818ccbe1a41659d1efe9972ab496b95bd5531bc8c992`; `deadline.mjs` 1,993,182 bytes, sha256 `38caeb4a9931e73e68e827b103097e8f752ac27b55bec900acaa2f5d33255877`; 540 inputs; arm64, pure JavaScript, handlers `relay.handler` and `deadline.handler` |
| Phone page (production) | `npm run build -w @atr/phone` | `dist/index.html` `9f7b8aa5...`, `dist/frame-processor.js` `1a472f70...`, `dist/assets/index-C1gNOLda.js` (104,946 bytes) `c2c0a817...`, `dist/assets/index-Cn8p0TBt.css` `06add388...`. Two string searches found no `node_modules` path and no `modulepreload` helper in `dist/`. |
| TV JavaScript bundle (platform `kepler`, `--dev false`) | `npm run check:bundle` in `apps/tv` | `build/farsidecheck.bundle` 1,543,752 bytes; the console-strip check passed ("OK"). A JS bundle, **not** a native Vega build. |
| Template validation | `services/relay/.venv/bin/cfn-lint -t infra/template.yaml --regions ap-south-1` | cfn-lint 1.57.1, exit 0 |

## 8. Open items

1. Re-audit `apps/tv` at every SDK bump and before any public release; the A7-01 exception does not cover any package that ships in the bundle. Lead and owner.
2. The two dev-only `vitest` moderates stay until a major upgrade is acceptable (decided: accepted for development use). Lead.
3. Read Amazon's Program Materials License Agreement before any public distribution of the TV app (section 4). Owner.
4. Add a CI workflow that runs `npm ci`, the audits and the SBOM from a clean checkout (none exists yet; EV-0040 notes "CI workflow not yet added"). Lead.
5. After B-001 is cleared: pin the SDK build, regenerate the SBOM from the native build if the route needs one, and re-run the audit on the lockfile the SDK resolves.
6. Regenerate the licence inventory, SBOMs and audit files at the release commit (`docs/submission/SUBMISSION_CHECKLIST.md`, pre-publication cleanup).

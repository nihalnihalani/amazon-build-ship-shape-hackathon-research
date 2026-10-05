# Setup

Status: every command in sections 2 to 8 was run from a **clean clone** of this repository at integration commit `63af0ae` on 2026-10-05 (macOS 27.0.1, Apple M4 Pro, Node 24.11.1 with npm 11.6.2 for the root workspace, Node 22.23.2 with npm 10.9.8 for `apps/tv`, OpenSSL 3.6.4, Google Chrome 154.0.8037.97) and the observed result is recorded next to it. Commands that could not be run are listed in section 9 with the reason. Counts and evidence classes for the test suites are in [TESTING.md](TESTING.md).

**What this setup can and cannot give you.** It builds and tests everything except the native Vega app. There is **no Vega SDK and no Vega Virtual Device on the build host** (Rosetta 2 is absent on macOS 27; blocker B-001), no physical Android phone (B-002), no AWS deployment (B-003) and no physical Fire TV (B-004). So you can run the relay, the phone page, the TV session logic, the TV web preview and every automated suite, but you cannot run the TV app on Vega until the steps in section 9 are done.

Not a medical device. Does not diagnose or treat any condition.

## 1. Prerequisites

| Item | Version | Why | Source |
|---|---|---|---|
| Node.js (root workspace: shared packages, relay, phone page, tests) | **24.11.1** (`.nvmrc` at the repository root pins 24; `engines.node >=22`; also exercised on 22.23.2, 24.11.1 and 25.2.1 for the protocol package) | ADR-0007: the root `.nvmrc` pins 24 for the backend and shared packages | `.nvmrc`, `package.json`, `docs/adr/0007-runtime-and-toolchain.md` |
| Node.js (`apps/tv`, the Vega toolchain) | **22.22.2** pinned in `apps/tv/.nvmrc` (the official starter's value; `engines.node >=22`; `@amazon-devices/react-native-kepler` needs `>=22.14.0`). This host has 22.23.2, which satisfies every declared range, but the pinned patch itself was **not** tried. | Keep the Vega toolchain Node isolated from the Lambda, phone and CI runtimes | `apps/tv/.nvmrc`, `docs/COMPATIBILITY.md` section 3 |
| npm | the one shipped with those Node versions (11.6.2 and 10.9.8 were used) | `npm ci` with the committed lockfiles | |
| TypeScript, Vitest | 5.8.3 and 3.2.4 (pinned in the root `package.json`, installed by `npm ci`) | | root `package.json` |
| React Native for Vega, React, OS | RN **0.83.0**, React **19.2.0**, OS min and target **1.2**, SDK 0.24 line (exact build not pinned: 0.24.9311 and 0.24.9914 both appear in official material). RN 0.83 is labelled "early access" in the official release notes. | The TV app only; needs the Vega SDK to build | ADR-0007, `docs/COMPATIBILITY.md` |
| AWS Lambda runtime | `nodejs24.x` (generally available; Node 26 is a preview and is not used) | Relay deployment only (not deployed) | `docs/COMPATIBILITY.md` section 4 |
| Google Chrome (system install) | 154.0.8037.97 was used | The end-to-end and accessibility suites drive it with `playwright-core` (`channel: 'chrome'` or `ATR_CHROME`); no Playwright browser download is needed | `tests/src/e2e-env.ts`, `apps/phone/e2e/lib.mjs` |
| OpenSSL | OpenSSL 3 or macOS LibreSSL | `scripts/dev-certs/make-dev-certs.sh`; the relay's HTTPS test group is skipped without it | `docs/operations/LOCAL_RELAY.md` |
| Python 3 (optional) | 3.14.3 was used | `cfn-lint` for the infrastructure tests (a local venv), and the DSP fixture oracle | `services/relay/README.md`, `fixtures/dsp/README.md` |

Nothing else needs a system install. Do **not** run `softwareupdate --install-rosetta` or the Vega installer as part of this setup: both change the system and accept licences, and they are owner actions (section 9).

## 2. Get the code and install (root workspace)

```sh
git clone <repository> across-the-room && cd across-the-room
git checkout 63af0ae          # the commit this document was verified at; omit for the latest
nvm use                       # reads .nvmrc (24.11.1); any Node >= 22 works
npm ci
```

Verified: `npm ci` exit 0 under Node 24.11.1 (110 packages; `npm audit` output follows the install, see [release/SUPPLY_CHAIN.md](release/SUPPLY_CHAIN.md)). The root `package.json` declares workspaces `packages/protocol`, `packages/phone-mic-meter`, `packages/ten-foot-meter`, `packages/session-core`, `services/relay`, `apps/phone` and `tests`. **`apps/tv` is not a workspace**: it is a standalone project with its own lockfile (section 5).

Build, typecheck and test everything in the root workspace:

```sh
npm run build        # protocol, meters, session-core, relay, phone page (dist/)
npm run typecheck
npm test             # unit and review suites only; the browser end-to-end suites are separate (TESTING.md)
```

Verified: all three exit 0. `npm test` ran 7 workspaces: protocol 921, phone-mic-meter 450, ten-foot-meter 49, session-core 371, relay 1,113 (1,111 plus 2 that need the optional `cfn-lint` venv, section 7), phone 459, tests/review 163, all passed.

## 3. Development certificates

The phone page needs a trustworthy HTTPS origin for the microphone (section 4). The script creates a local certificate authority and a server certificate:

```sh
scripts/dev-certs/make-dev-certs.sh                   # localhost, 127.0.0.1, ::1  -> certs/
scripts/dev-certs/make-dev-certs.sh 192.168.1.23      # plus your Mac's LAN IP, for a physical phone
scripts/dev-certs/make-dev-certs.sh --out /some/dir macbook.local
```

Verified (`--out` a scratch directory, argument `192.168.1.23`): exit 0; created `ca.crt`, `ca.key`, `server.crt`, `server.key`; the server certificate is valid 365 days with subject alternative names `localhost`, `127.0.0.1`, `::1` and `192.168.1.23`; the CA is name-constrained (critical) to `localhost`, `.local`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16`, so a leaked `ca.key` cannot impersonate public sites. It prints the CA's SHA-256 fingerprint to compare on the phone. `certs/` is git-ignored. Re-running keeps the CA and re-issues only the server certificate. **Never commit or share `ca.key` or `server.key`.** The script installs and trusts nothing and uploads nothing.

Important: the certificate must contain the address you will actually use. The relay prints the LAN addresses it detected; pass that address to the script.

## 4. Run the local relay and serve the phone page

```sh
npm run build -w @atr/phone              # apps/phone/dist (the root build already did this)
scripts/dev-certs/make-dev-certs.sh 192.168.1.23
npm run start:local -w @atr/relay        # builds @atr/protocol and the relay, then listens on https://0.0.0.0:8443
```

Verified (with `ATR_PORT=18443` and the scratch certificates through `ATR_TLS_CERT` and `ATR_TLS_KEY`): the relay printed `listening on https://0.0.0.0:18443 (phone page at /, WebSocket at /ws, health at /healthz)`, `static files from .../apps/phone/dist` and the allowed browser origins (`https://localhost:PORT`, `https://127.0.0.1:PORT` and each detected LAN IPv4). `curl --cacert certs/ca.crt https://localhost:18443/healthz` answered `{"status":"ok"}`; `GET /` answered 200 `text/html` with `Content-Security-Policy` (`default-src 'self'; connect-src 'self' wss:; script-src 'self'; ...`), `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `Strict-Transport-Security: max-age=300`. State is in memory: restarting the relay empties it and the TV and phone pair again.

The relay refuses unsafe starts (all verified, exit 2 with a message):

- no certificate at the default paths and no insecure flag: "TLS certificate or key not found. The relay refuses to start without TLS";
- `ATR_INSECURE_LOCALHOST_ONLY=1` with `ATR_HOST=0.0.0.0`: "binds loopback only; ATR_HOST must be 127.0.0.1, localhost or ::1";
- `ATR_ENV=production` without `ATR_ALLOWED_ORIGINS`: "must be set explicitly when ATR_ENV=production".

All environment variables (`ATR_PORT`, `ATR_HOST`, `ATR_ENV`, `ATR_ALLOWED_ORIGINS`, `ATR_TV_PREVIEW_ORIGINS`, `ATR_LIVE_ROOM_CAP`, `ATR_STATIC_DIR`, `ATR_TLS_CERT`, `ATR_TLS_KEY`, `ATR_INSECURE_LOCALHOST_ONLY`, `ATR_HSTS_MAX_AGE`, `ATR_TICK_MS`, `RELAY_DISABLED`) are documented in [operations/LOCAL_RELAY.md](operations/LOCAL_RELAY.md); a test fails if one is missing there.

### Which microphone route is valid

| Route | Phone page origin | What it exercises | Evidence class if you run it |
|---|---|---|---|
| Physical phone, local relay | `https://<Mac-LAN-IP>:8443` with `ca.crt` trusted on the phone | The intended workflow | `real_phone`, **never run here (B-002)**; the certificate-trust steps for iOS and Android are in `LOCAL_RELAY.md` and are untested |
| Physical phone, HTTPS tunnel | the tunnel's HTTPS URL; add it to `ATR_ALLOWED_ORIGINS` | Same | `real_phone` (not run) |
| Physical phone, AWS staging | the CloudFront URL | Same | `real_phone`; **not deployed (B-003)** |
| Same Mac | `https://localhost:8443` (trust `ca.crt` in the browser) or `http://localhost:8443` with `ATR_INSECURE_LOCALHOST_ONLY=1` | The Mac's microphone, not a phone. The page labels it "Same-Mac microphone mode" and sends `mode: same_host` | not `real_phone` |
| Fixture replay | the phone **test build** (`npm run build:test -w @atr/phone`, `dist-test/`) | Synthetic audio, no microphone; labelled "Fixture replay" | `fixture_replay` / `automated` |

**`http://<LAN-IP>` is never a valid microphone origin.** Browsers expose `getUserMedia` only in a secure context (HTTPS, or `localhost`); a plain-HTTP LAN address is neither, so the phone cannot use the microphone there. The relay refuses plain HTTP unless it is bound to loopback (`ATR_INSECURE_LOCALHOST_ONLY=1`, verified: it serves `http://127.0.0.1:PORT/healthz` and prints a warning that a phone cannot use it). Self-signed or locally generated certificates work on a phone only after the owner installs and trusts the CA on that phone.

### Point the TV at the relay

The TV app's default relay is `wss://localhost:8443/ws` (`apps/tv/src/config.ts`). To use another address, edit `apps/tv/index.js` before `AppRegistry.registerComponent` and set `globalThis.__ATR_CONFIG__ = { relayUrl: 'wss://<host>:8443/ws' }` (a build-time edit; there is no environment on Vega). The override is validated: `wss://` always, `ws://` only for localhost, no credentials, query or fragment. The QR code and link on the TV are always `https://<relay host>/#code=<CODE>` (the code is in the fragment and never sent to a server). **Whether a self-signed WSS endpoint works from the Vega runtime is unknown and untested**; do not promise it.

## 5. TV app (`apps/tv`, standalone Node 22 project)

```sh
cd apps/tv
nvm use                          # apps/tv/.nvmrc = 22.22.2
npm ci
npm run build:packages           # builds protocol, session-core, ten-foot-meter (TV imports their dist)
npm run typecheck                # tsc --noEmit against the published @amazon-devices types
npm test                         # jest, Vega native modules replaced by hand-written mocks
npm run check:bundle             # Metro JS bundle for platform kepler + console-strip check
```

Verified under Node 22.23.2: `npm ci` exit 0 (19 s; npm reports 95 audit findings including dev tooling, see SUPPLY_CHAIN.md); `build:packages` exit 0; `tsc --noEmit` exit 0; `npx jest` exit 0 with **29 suites, 639 tests** (it ends with the warning "A worker process has failed to exit gracefully", which does not fail the run); `npm run check:bundle` exit 0: Metro v0.83.8 wrote `build/farsidecheck.bundle` (1.54 MB) and the check printed `OK`. `npm start` (`react-native start`) also starts Metro without the SDK (`packager-status:running`, "start-vega completed" on a test port). **None of this is a native Vega build**: it proves the code typechecks against the published packages, the logic passes with mocks and a JavaScript bundle builds.

`apps/tv/manifest.toml` is written from the public manifest documentation and has **not** been checked by `vega project doctor` or `vpt validate`. The `[wants]` entry `com.amazon.network.service` is a guess about what WebSocket needs: the official sample additionally declares `com.amazon.network.privilege.net-info` under `[needs]`, which this app deliberately omits; whether any further privilege is required is an open native check.

### TV web preview (not Vega)

A react-native-web harness for browser-driven checks, with banner "Web preview — not Vega":

```sh
cd apps/tv/web && npm ci
npx vite                         # dev server, http://127.0.0.1:5173
# or, what the test runner uses:  npx vite build && npx vite preview
# open  ?mode=fixtures&screen=home   (fixture views)   or   ?mode=store   (the real session store, in-memory data)
# optional: &scale=1.5   simulated UI scale     &screenReader=1   simulated screen reader on
```

Verified: `npx vite` (Node 22.23.2, vite 8.3.2) was ready in 169 ms and served `/` and `/src/main.tsx` with HTTP 200 (a page render was not inspected in this check; the accessibility suite renders it through `vite build` and `vite preview`). Evidence from the preview is class `web_preview`, never Vega.

## 6. Fixture and test builds

| Build | Command | Notes |
|---|---|---|
| Phone page, production | `npm run build -w @atr/phone` | `apps/phone/dist`. No test audio code: a test builds both flavours and asserts the test-only strings are absent. |
| Phone page, test build | `npm run build:test -w @atr/phone` | `apps/phone/dist-test`: synthetic test audio, a persistent test banner, `window.__atrTestAudio` hooks, and a `?relay=` override. Used by the end-to-end suites. Never deploy it. |
| Lambda bundle | `npm run bundle:lambda -w @atr/relay` | `services/relay/dist-lambda/relay.mjs`, `deadline.mjs`, `MANIFEST.txt` with hashes. Verified (exit 0): 540 inputs, 1,993,168 and 1,993,182 bytes. Not deployed. |
| DSP fixtures | `python3 fixtures/dsp/tools/derive_fixtures.py` | Regenerates `fixtures/dsp/*.json` only if an independent Python oracle reproduces every hand-derived value (about 20 s). Arithmetic fixtures, not measurements. |
| T04 freeze hash | `python3 fixtures/dsp/tools/freeze_hash.py` | Prints the frozen protocol and criteria hashes; writes nothing. At `63af0ae` they match evidence EV-0030. |

## 7. Optional: infrastructure lint

```sh
python3 -m venv services/relay/.venv && services/relay/.venv/bin/pip install cfn-lint aws-sam-translator
services/relay/.venv/bin/cfn-lint -t infra/template.yaml --regions ap-south-1
```

Verified: cfn-lint 1.57.1 exit 0 with no findings; with the venv present `npm test -w @atr/relay` runs 1,113 tests with none skipped (without it, 1,111 pass and 2 are skipped). This lints a template; **nothing was deployed** and no AWS call was made. Deployment steps (SAM, an SSM secret, a non-root deployer role) are in `infra/README.md` and `docs/operations/RUNBOOK.md` and are an owner action (B-003).

## 8. End-to-end and accessibility suites

These need system Chrome and are slower (minutes). Commands, environment variables and results are in [TESTING.md](TESTING.md). In short:

```sh
cd tests
npx vitest run --config vitest.e2e.config.ts e2e/local-journey.test.ts     # ~108 s
npx vitest run --config vitest.e2e.config.ts e2e/fault-recovery.test.ts    # ~212 s
QA_STRICT=1 node a11y/run-a11y.mjs                                         # ~133 s, installs apps/tv/web if missing
npm run e2e:all -w @atr/phone                                              # headless Chrome, synthetic audio
```

## 9. Steps that need the Vega SDK, a phone, AWS or a Fire TV (not done)

Honest list. Each is blocked on an owner action recorded in `.build/blockers.md`.

| Step | Needs | Blocker |
|---|---|---|
| Install Rosetta 2 (`softwareupdate --install-rosetta --agree-to-license`, accepts Apple's licence), then the official Vega SDK installer (`curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh \| bash && source ~/vega/env`; modifies shell profiles; SDK telemetry is on by default). Prerequisites per the install page: Homebrew, `brew install binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`, at least 20 GB free. | Owner action (or explicit authorization for the lead to run it) | B-001 |
| `vega --version` to pin the SDK build; `vega project doctor` on `apps/tv`; `vega project update-manifest --os-min 1.2 --os-version 1.2` if the manifest needs it | the SDK | B-001 |
| `npm run build:debug` / `npm run build:release` in `apps/tv` (`react-native build-vega`; the legacy `build:*:legacy` scripts use `build-kepler`), then `vega exec vpt validate <release.vpkg>` with strict ABI checks | the SDK | B-001 |
| Start a Vega Virtual Device, install and launch the package, run the remote-only journey, record the demo (the run-apps page was read only as a summary; its exact CLI commands and device names are **not verified** here) | the SDK and a VVD | B-001 |
| The VVD checklist for VoiceView, focus, UI scale, AsyncStorage and quiet windows | a VVD | B-001 (`docs/evaluation/A11Y_T17_PREP.md` section 8) |
| Self-signed WSS from the Vega runtime; manifest network privileges for WebSocket | a VVD | B-001 |
| A physical Android phone run (permission prompt, AGC read-back, qualification T04, camera-timed latency) | an Android phone with Chrome, `docs/evaluation/T04-protocol.md` | B-002 |
| Deploy the AWS relay (staging), run `infra/README.md` verify items 1 to 11 | a least-privilege deploy role instead of root keys, and a spend authorization | B-003 |
| Physical Fire TV run | a Fire TV on OS 1.2 or later with developer mode | B-004 |
| Public repository, video upload, Devpost submission, judge access | owner authorization for each | B-005 |

## 10. Cleaning up

`node_modules/`, `dist/`, `dist-test/`, `dist-lambda/`, `certs/`, `build/` and `.venv/` are git-ignored. Running the accessibility suite rewrites `tests/a11y/artifacts/report.json`, `manifest.json` and a committed screenshot: review `git status` before committing.

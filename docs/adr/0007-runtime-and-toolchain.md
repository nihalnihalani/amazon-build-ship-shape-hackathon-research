# ADR-0007: Runtime and toolchain selection

- Status: accepted (revision 1; recheck at T03)
- Date: 2026-10-05

## Decision

| Layer | Choice | Evidence |
|---|---|---|
| TV app | React Native for Vega, RN **0.83.0**, React **19.2.0**, `@amazon-devices/react-native-kepler ~4.0.0+rn0.83.0`, OS min/target **1.2**, TypeScript 5.8.3 | Official sample `AmazonAppDev/vega-tv-interfaces-sample` commit `7546400215691a2a1470d7d9e6b77185a67ba548` (release-rn-83-v24) `package.json` and `manifest.toml`; SDK 0.24 compatibility page |
| Vega toolchain Node | **22.22.x** (sample `.nvmrc` = 22.22.2; sample `engines.node >=22`) — note the sample README/older research said 18–20; the pinned commit says 22 | sample `.nvmrc` fetched 2026-10-05 |
| Shared packages, relay, phone build | Node ≥ 22 (host has 22.23.2 / 24.11.1 / 25.2.1 via nvm); TypeScript 5.8.3; Vitest for tests | local `nvm ls` |
| Lambda runtime | **nodejs24.x** (supported GA; Node 26 is preview and is not used) | AWS Lambda runtimes page (fetched 2026-10-05) |
| Phone page | Plain TypeScript + Vite build to static files; no UI framework | — |
| IaC | AWS SAM template (`infra/template.yaml`) | AWS SAM getting started |

The Vega toolchain Node line is isolated from the backend runtime: `apps/tv/.nvmrc` pins 22.22.2; the root `.nvmrc` pins 24 for the backend and shared packages.

## Host blocker

The Vega SDK depends on Rosetta 2 on Apple Silicon. This host runs macOS 27.0.1 with Rosetta absent (`arch -x86_64 /usr/bin/true` → "Bad CPU type"). Remedy (owner action, accepts Apple's licence): `softwareupdate --install-rosetta --agree-to-license`, then the official SDK installer. Until then T03 is `blocked_external` and the TV app can only be type-checked and unit-tested against the published `@amazon-devices/*` packages.

# Blockers

Each blocker names the exact external action. Blocked tasks never flow through "verified".

| ID | Blocks | Blocker | Exact remedy (who) | Status |
|---|---|---|---|---|
| B-001 | T03, T09 (native build/render), T17 (VVD part), T19, T22, T23 (demo) | Rosetta 2 absent on macOS 27.0.1; the Vega SDK documents Rosetta as a dependency on Apple Silicon (EV-0002) | Owner runs `softwareupdate --install-rosetta --agree-to-license` (accepts Apple's licence), then the official installer `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh \| bash && source ~/vega/env` (edits shell profiles; SDK telemetry on by default) — or authorizes the lead to run the installer once Rosetta is present | open |
| B-002 | T04, T04A, T19 | No physical Android phone with Chrome | Owner provides the phone at the marked position; the lead builds the qualification-mode harness (review required, residual R24), then runs the approved T04 protocol rev 3 | open |
| B-003 | T10, T12H, T16 (AWS part), T20 | AWS default credentials are the account root user (EV-0004); no spend authorization | Owner creates the least-privilege deploy role from `infra/iam/deployer-policy.json` (+ execution role draft), provides a named profile and a staging budget; the lead then deploys per `infra/README.md` | open |
| B-004 | T24, T26 | No physical Vega Fire TV | Owner provides a Fire TV on OS ≥ 1.2 with developer mode | open |
| B-005 | T23 publication, CI execution | Publishing the repository/branch, video upload, Devpost submission, judge invitations and running the CI workflow on GitHub need owner authorization | Owner reviews `docs/submission/` and `docs/release/README.proposed.md` and authorizes each step | open |

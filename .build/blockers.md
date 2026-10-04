# Blockers

Each blocker names the exact external action. Blocked tasks never flow through "verified".

| ID | Blocks | Blocker | Exact remedy (who) | Status |
|---|---|---|---|---|
| B-001 | T03, T09 (native render), T17 (VVD part), T19, T22 | Rosetta 2 absent on macOS 27.0.1; the Vega SDK documents Rosetta as a dependency on Apple Silicon (EV-0002) | Owner runs `softwareupdate --install-rosetta --agree-to-license` (accepts Apple's licence), then the official installer `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh \| bash && source ~/vega/env` (modifies shell profiles; SDK telemetry on by default) — or authorizes the lead to run the installer after Rosetta is present | open |
| B-002 | T04, T04A, T19 | No physical Android phone attached or reachable; no adb | Owner provides an Android phone with Chrome at the marked position and runs the frozen T04 protocol (docs/evaluation/T04-protocol.md), or supervises it | open |
| B-003 | T10, T12H, T20 | AWS default credentials are the account root user (EV-0004); staging deploy also needs spending authorization | Owner authorizes a staging deploy budget and provides a least-privilege deploy role/profile (policy draft: infra/iam/deployer-policy.json) instead of root keys | open |
| B-004 | T24, T26 | No physical Vega Fire TV device | Owner provides a Fire TV device on OS ≥ 1.2 with developer mode | open |
| B-005 | T23 (publication parts) | Public repository, video upload, Devpost submission and judge invitations require owner authorization | Owner reviews the prepared package and authorizes each publication step | open |

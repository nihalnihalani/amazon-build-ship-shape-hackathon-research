# Checkpoint

Updated: 2026-10-05 05:30 IST by Opus lead (claude-opus-5-5).

## Resume instruction

Open an interactive Claude Code session in the repository root on branch `build/across-the-room`, then: read this file, `.build/task-graph.json`, `.build/evidence.jsonl`, `.build/blockers.md`; run `git log --oneline -15` and `git worktree list`; reconcile task states against actual files and commits; respawn missing teammates for in-progress tasks using `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md`; continue ready tasks.

## Current gate

T00–T02 (environment, compatibility, ADRs) → dispatching T05 (protocol), T06 (DSP, starts against ADR-0001 in parallel), T09-prep (TV app code against pinned packages; native render blocked by B-001).

## State

- Branch `build/across-the-room` off `main@d9a8d5b`. Owner's uncommitted README edit and untracked research files are preserved and not committed by the lead.
- ADR-0001..0009 and docs/PROTOCOL.md v1 frozen.
- Blockers: B-001 Rosetta/Vega SDK, B-002 physical Android phone, B-003 AWS root credentials + spend authorization, B-004 physical Fire TV, B-005 publication authorization.

## Active teammates

| Name | Role | Task | Worktree | Branch | State |
|---|---|---|---|---|---|
| contracts | research-contracts | T05, T01, rev 3 | ../atr-worktrees/contracts | wt/contracts | done, merged |
| dsp | audio-dsp | T06, T04 protocol doc | ../atr-worktrees/dsp | wt/dsp | done, merged |
| tv | vega-tv | T09 code, ten-foot-meter, web preview | ../atr-worktrees/tv | wt/tv | done, merged (native blocked B-001) |
| session | vega-tv core | session-core | ../atr-worktrees/session | wt/session | done, merged |
| relay | relay-cloud | T07 + AWS adapter/IaC (not deployed) | ../atr-worktrees/relay | wt/relay | running |
| phone | phone-companion | T08 | ../atr-worktrees/phone | wt/phone | running |
| security | security-review | T02 review, threat model | ../atr-worktrees/security | wt/security | running |
| qa | qa-accessibility | T11/T13/T14 review, T17 prep | ../atr-worktrees/qa | wt/qa | running |

Integration branch head after session/TV integration: see `git log -1 build/across-the-room`.

## Next lead actions

1. Merge relay and phone when they hand off; rerun root build/typecheck/test (relay/phone stubs currently have no tests, so root `npm test` fails until they land).
2. Build T12: tests/e2e local journey (local relay with dev cert + phone dist-test in system Chrome with synthetic audio + headless TV driver tests/src/tv-driver.ts).
3. Apply accepted findings from security (T02) and qa reviews as rework tasks.
4. Spawn release-docs after T12.

# Checkpoint

Updated: 2026-10-05 03:35 IST by Opus lead (claude-opus-5-5).

## Resume instruction

Open an interactive Claude Code session in the repository root on branch `build/across-the-room`, then: read this file, `.build/task-graph.json`, `.build/evidence.jsonl`, `.build/blockers.md`; run `git log --oneline -15` and `git worktree list`; reconcile task states against actual files and commits; respawn missing teammates for in-progress tasks using `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md`; continue ready tasks.

## Current gate

T00–T02 (environment, compatibility, ADRs) → dispatching T05 (protocol), T06 (DSP, starts against ADR-0001 in parallel), T09-prep (TV app code against pinned packages; native render blocked by B-001).

## State

- Branch `build/across-the-room` off `main@d9a8d5b`. Owner's uncommitted README edit and untracked research files are preserved and not committed by the lead.
- ADR-0001..0009 and docs/PROTOCOL.md v1 frozen.
- Blockers: B-001 Rosetta/Vega SDK, B-002 physical Android phone, B-003 AWS root credentials + spend authorization, B-004 physical Fire TV, B-005 publication authorization.

## Active teammates

(see table below; updated on every dispatch)

| Name | Role | Task | Worktree | Branch |
|---|---|---|---|---|
| contracts | research-contracts | T05 protocol package, T01 COMPATIBILITY/SOURCES | ../atr-worktrees/contracts | wt/contracts |
| dsp | audio-dsp | T06 phone-mic-meter, T04 frozen protocol doc | ../atr-worktrees/dsp | wt/dsp |
| session | vega-tv (core) | session-core reducer/view/storage logic | ../atr-worktrees/session | wt/session |
| tv | vega-tv | T09 apps/tv RN-for-Vega code, ten-foot-meter, adapters | ../atr-worktrees/tv | wt/tv |
| relay | relay-cloud | T07 relay core + local server; AWS adapter + SAM (not deployed) | ../atr-worktrees/relay | wt/relay |
| phone | phone-companion | T08 phone page | ../atr-worktrees/phone | wt/phone |

All dispatched from base `ea1eef8` on 2026-10-05 ~03:50 IST. Integration order planned: contracts → dsp → session → relay → phone → tv; after contracts merges, notify relay/phone/session to merge `build/across-the-room` and swap ports to `@atr/protocol`.

## Next lead actions

1. On each handoff: review diff + rerun checks in the worktree, merge into `build/across-the-room`, regenerate lockfile, rerun root build/typecheck/test, append evidence, update graph.
2. Build T12 harness in `tests/` (local relay + phone dist-test in system Chrome with synthetic audio + headless session-core TV driver).
3. Spawn qa-accessibility, security-review, release-docs after integration.

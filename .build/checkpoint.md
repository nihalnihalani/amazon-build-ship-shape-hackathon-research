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

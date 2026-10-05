# Checkpoint

Updated: 2026-10-05 12:45 IST by Opus lead (claude-opus-5-5).

## Resume instruction

Open an interactive Claude Code session in the repository root on branch `build/across-the-room`, then: read this file, `.build/task-graph.json`, `.build/evidence.jsonl`, `.build/blockers.md`; run `git log --oneline -15` and `git worktree list`; reconcile task states against actual files and commits; respawn missing teammates for in-progress tasks using `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md`; continue ready tasks.

## Current gate

T00–T02 (environment, compatibility, ADRs) → dispatching T05 (protocol), T06 (DSP, starts against ADR-0001 in parallel), T09-prep (TV app code against pinned packages; native render blocked by B-001).

## State

- Branch `build/across-the-room` off `main@d9a8d5b`. Owner's uncommitted README edit and untracked research files are preserved and not committed by the lead.
- ADR-0001..0009 and docs/PROTOCOL.md v1 frozen.
- Blockers: B-001 Rosetta/Vega SDK, B-002 physical Android phone, B-003 AWS root credentials + spend authorization, B-004 physical Fire TV, B-005 publication authorization.

## Current state (integration head after bb546b9)

- Whole workspace green: protocol 921, phone-mic-meter 450, ten-foot-meter 49, session-core 371, relay 1111+2 skipped, phone 459, review 163; apps/tv tsc 0 + jest 639 (Node 22).
- tests/e2e: T12 local journey 4/4, T15 fault recovery 8/8 (EV-0037, EV-0038). Strict a11y web-preview gate 59/59 (EV-0039).
- Defects found and fixed by e2e/fault runs: DEF-001..007 (see AMENDMENTS-REV2.md and evidence).
- Verified: T01, T02, T05(in_review after rev4), T06(in_review), T11, T13, T14. Blocked external: T03, T04, T09 (native), T10, T17 (VVD part).

## Active teammates

| Name | Task | Branch |
|---|---|---|
| security | T16 gate at integrated commit; SEC-* tests in tests/security; T04 protocol approval | wt/security |
| qa | Independent review of T12/T15 tests; T18 clean-clone gate; .github/workflows/ci.yml | wt/qa |
| docs | Release docs, licences/SBOM/audit, README proposal (owner adopts), submission package (not published) | wt/docs |

Idle (resume by name if needed): contracts, dsp, session, relay, phone, tv.

## Next lead actions

1. Merge security/qa/docs handoffs; route findings; rerun suites.
2. T20 operations: docs exist (runbook, cost); alarm delivery/rollback drills need AWS (B-003).
3. T21 independent release review → T22 engineering RC (tag) once T16/T18/T19 permit; T19 needs phone + VVD (B-001/B-002).
4. Final report with exact commit, artifacts, commands, readiness fields, external actions.

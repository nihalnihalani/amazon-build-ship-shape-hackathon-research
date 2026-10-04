# Checkpoint

Updated: 2026-10-05 07:00 IST by Opus lead (claude-opus-5-5).

## Resume instruction

Open an interactive Claude Code session in the repository root on branch `build/across-the-room`, then: read this file, `.build/task-graph.json`, `.build/evidence.jsonl`, `.build/blockers.md`; run `git log --oneline -15` and `git worktree list`; reconcile task states against actual files and commits; respawn missing teammates for in-progress tasks using `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md`; continue ready tasks.

## Current gate

T00–T02 (environment, compatibility, ADRs) → dispatching T05 (protocol), T06 (DSP, starts against ADR-0001 in parallel), T09-prep (TV app code against pinned packages; native render blocked by B-001).

## State

- Branch `build/across-the-room` off `main@d9a8d5b`. Owner's uncommitted README edit and untracked research files are preserved and not committed by the lead.
- ADR-0001..0009 and docs/PROTOCOL.md v1 frozen.
- Blockers: B-001 Rosetta/Vega SDK, B-002 physical Android phone, B-003 AWS root credentials + spend authorization, B-004 physical Fire TV, B-005 publication authorization.

## Active teammates (rework wave for ADR revision 2)

| Name | Task now | Branch | Notes |
|---|---|---|---|
| contracts | Protocol revision 4 (AMENDMENTS-REV2 P rows, PK-01..13, DEF-002 doc) | wt/contracts | others wait for it for next_credential + invariants |
| dsp | VAD hysteresis 10/6 dB, run>=3, silent_input, reasons, quantisation, qualification analysis (slope criterion), fixtures | wt/dsp | |
| session | Contract rev 2 (merge lead/contract-rev2), A4-01 blocker, number matching, integrity, delete+relay cleanup, a11y lead, qualification suffix | wt/session | rotation after rev 4 |
| relay | Abuse counters (HMAC source), code burning, exp. delay, origin_state, SQS deadline, processInbound, canonical forward | wt/relay | rotation after rev 4 |
| phone | A3-01 phone confirmation, new privacy copy, listener locks, no-storage test, terminal reconnect + jitter | wt/phone | rotation after rev 4 |
| tv | Contract rev 2 UI (number matching), visual-only banners while capturing, screen-reader input, adapter jitter/failed | wt/tv | |
| qa | Independent review T11/T13/T14 + T17 prep (web preview, Playwright) | wt/qa | started before rework; findings may overlap |

## Integration plan for this wave

1. Merge contracts rev 4 first → notify session/relay/phone to finish rotation.
2. Merge dsp → session (with contract rev 2) → tv → relay → phone, rerunning root build/typecheck/test after each.
3. Rerun T12 e2e (tests/e2e/local-journey.test.ts); extend it for: number matching, phone Yes confirmation, hidden invalid window path, silent_input, rotation on resume.
4. Then security re-review at the integrated commit (T16) and qa (T17/T18).

## Key facts for a resumed session

- T12 local journey passed at commit recorded in EV-0022 (before rework). DEF-001 heartbeat and DEF-002 window_id fixed.
- Contract revision 2 lives on branch `lead/contract-rev2` until session/tv adapt.
- Blockers B-001..B-005 unchanged (see blockers.md); owner questions asked in chat, unanswered.

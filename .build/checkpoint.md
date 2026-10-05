# Checkpoint

Updated: 2026-10-05 10:04 IST by Opus lead (claude-opus-5-5).

## Resume instruction (exact)

Open an interactive Claude Code session in `/Users/nihalnihalani/Desktop/Github/amazon devpost hackathon` on branch `build/across-the-room`, then:
1. Read this file, `.build/task-graph.json` (`python3 .build/tools/graph.py status`), `.build/blockers.md`, `.build/release-status.json`, and the last 15 lines of `.build/evidence.jsonl`.
2. `git log --oneline -15` and `git worktree list` (teammate worktrees live in `../atr-worktrees/<name>` on branches `wt/<name>`).
3. If the owner has cleared a blocker, start the matching task: B-001 → T03 (Vega Hello World on VVD, `vega project doctor`), then the native build of `apps/tv` (T09) and the VVD part of T17; B-002 → T04 using the APPROVED protocol rev 3 (freeze hash b9b931007711a5e491c38dd295c2bedaca437887dcab1a5ea320327abdb99c66, EV-0046/47) after building and reviewing the qualification-mode harness (security residual R24); B-003 → T10/T12H/T20 using `infra/README.md`; B-004 → T24; B-005 → T23 publication steps in `docs/submission/SUBMISSION_CHECKLIST.md`.
4. Re-run the full matrix (commands in `docs/TESTING.md`) before recording any new evidence; use `.build/tools/evidence.py` (host-clock timestamps).
5. Teammates do not survive a session: respawn by role with `research/ACROSS_THE_ROOM_SONNET_5_5_TEAMMATE_PROMPT.md` and the worktree for that role.

## State at this checkpoint

- Integration branch `build/across-the-room`; full automated matrix green at `6291c90` (EV-0050), docs/security-only commits after it.
- Verified tasks: T00, T01, T02, T05, T06, T07, T08, T11, T12, T13, T14, T15 (trust `python3 .build/tools/graph.py status`).
- In review/progress: T18 (clean clone + matrix pass; CI workflow written, never run on GitHub), T23 (package prepared, not published).
- Blocked external: T03, T04, T09 (native), T10, T12H, T16 (AWS part; local gate passed), T17 (VVD part; web-preview gate passed), T19, T20. Pending on blocked deps: T04A, T21, T22, T24, T26. Optional: T25.
- Defects found by integration/fault/QA/security runs and fixed: DEF-001..007, QA-01..13, QA-E2E-01/04, QA-T18-01/02, A11Y-01..05, N-01..N-14 (N-15 info open), R26.
- Owner's uncommitted research README edit and untracked research files are untouched (not committed by the lead).

## What is left

See `REMAINING_WORK.md` at the repository root (verified against these records by an independent read-only workflow before publication).

## Owner decisions outstanding

Rosetta + Vega SDK install (B-001); Android phone (B-002); AWS least-privilege deploy profile + spend limit, never root keys (B-003); physical Fire TV (B-004); README proposal adoption, repository visibility/push of this branch, video, Devpost submission, judge access (B-005); AI-assistance disclosure wording; local-path cleanup (SUBMISSION_CHECKLIST P1).

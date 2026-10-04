# Independent QA review: T13 / T14 (hidden meter, listener, reveal) and T11 (storage, resume, deletion)

- Reviewer: Sonnet 5.5, qa-accessibility (model id `claude-sonnet-5-5`). I did not write any code under review.
- Worktree / branch / base: `/Users/nihalnihalani/Desktop/Github/atr-worktrees/qa`, `wt/qa`, base `4d4ef1e`.
- Reviewed read-only: `packages/session-core` (`STATE_MACHINE.md`, `src/*`, `src/contract.ts`), `docs/adr/0001, 0004, 0005, 0008`, `docs/PROTOCOL.md`, `apps/tv` (screens and jest suite).
- Evidence class of everything below: **automated**. The subject is a pure state machine driven through `createSessionStore` with fakes. This review says nothing about microphone validity, Vega behaviour, VoiceView, AsyncStorage on a real Vega device, or a deployed relay (those are `pending_external`, blocker B-001: no Vega SDK or VVD).
- Requirement mapping: `docs/evaluation/REQUIREMENTS_EVIDENCE_MATRIX.md` has no requirement text in this checkout, so I mapped by task ownership: R-G1..R-G3 = T13, R-H1..R-H4 = T14, R-J2 and R-ST1 = T11. R-I1/R-I2 are not owned by these tasks and were not reviewed.

## 1. Verdicts (original review; the current verdicts are in section 10, Wave 2)

| Task | Verdict | Open defects | Basis |
|---|---|---|---|
| T13 hidden meter, blind positions, retries | **accept-with-defects** | QA-01 (Low), QA-05 (Low) | The core guarantee holds: for a blind first attempt no view before reveal depends on the level stream or the verdict (differential test, section 4). Positions 3/6/9 are correct for banks of 1, 2, 3, 4, 6, 9, 10. |
| T14 listener phase, reveal lock, late responses, cues, agreement | **accept-with-defects** | QA-03 (Medium), QA-04 (Low) (cross-cutting, found in session lifecycle) | Ordering, 20 s boundary, missing-never-invented, reveal lock, late exclusion and cue cap all behave as ADR-0004 states. The two open defects are in session end/bank handling, not in the reveal logic. |
| T11 storage, resume, deletion, pruning | **accept-with-defects** | QA-02 (Medium), QA-06 (Low), QA-07 (Low) | Deletion removes only `atr:` keys and verifies; refusing stores are reported; crash mid-capture yields an interrupted, unscored attempt; the 30-day boundary is exact. Open defects are crash-consistency and retention edge cases. |

Blockers: none. At the original review there was no High; the revision 4 follow-up (section 8) found QA-09 (High, TV credential rotation), which sits in the TV session/runtime integration and not in T11/T13/T14 acceptance. Acceptance does not depend on any `pending_external` item, but the real-device checks in section 9 are still required before these tasks can be called `verified` for Vega.

Severity scale: Blocker (acceptance impossible), High (violates a stated product constraint in a normal path), Medium (violates a stated constraint in an edge path, or loses user data), Low (spec/doc mismatch or cosmetic logic), Info.

## 2. Defect list

Every defect has an executable repro: a test in `tests/review/session-core.review.test.ts` that asserts the CORRECT behaviour and is wrapped in `it.fails`, so the suite is green while the defect is open. `QA_STRICT=1` runs them as ordinary tests (they then fail). When a fix lands the wrapped test flips to failing: remove the `defect()` wrapper.

Repro command for any one: `cd tests && QA_STRICT=1 npx vitest run --config review/vitest.config.ts -t "QA-03"`.

### QA-03 (Medium, T14/cross-cutting): `session.end` sent while the link is down is dropped and never retried

- Minimal repro: pair, begin a phrase window, `transport reconnecting` (window is cancelled and the TV pauses), press **Finish early** on the paused screen, then `transport connected` + `auth.ok` + `mic open_idle` + Done.
- Expected: the phone is told the session is over once the link is back (universal constraint: end/cancel must stop capture and owned resources on the real phone), as `window.cancel` already is via `pendingCancels`.
- Observed: `wire.dropped` contains `session.end` (the real `wsTransport.send` returns `false` while the socket is not open and `store.ts` ignores the return value). After reconnect the TV has sent 0 `session.end`. `leaveSession` (Back, Leave) takes the same path.
- Impact depends on the phone's own TV-lost handling, which I did not review. Suggested fix: queue `session.end` next to `pendingCancels` and flush on `onPhoneConnected`, or re-send from `session.state` sync when the last session ended with an unacknowledged end.

### QA-02 (Medium, T11; low likelihood): a crash between saving the finished record and clearing the checkpoint resurrects the session as "Resume", and Discard downgrades the saved record

- Minimal repro (test `QA-02`, `QA-02b`): finish the last phrase with a disk that loses every write after `atr:v1:index` (the record and index are written, `removeItem('atr:v1:active')` is lost). Relaunch.
- Expected: a checkpoint whose `sessionId` already has a saved `complete: true` record is not offered for resume; Discard must never overwrite a completed record.
- Observed: `resume_or_discard` is shown. Choosing Discard rewrites `atr:v1:session:<id>` as `{ complete: false, endReason: 'discarded' }`, so a completed session becomes an incomplete one and the history day is flagged incomplete.
- Cause: `saveRecord` issues two serialized writes (`session`, then `clear_checkpoint`) and `loadData` never cross-checks the checkpoint against saved records. Suggested fix: on load, drop a checkpoint whose id has a complete saved record; make `discardSession` not overwrite an existing record.

### QA-07 (Low, T11): when the finished record cannot be saved the checkpoint is cleared anyway

- Repro: disk full for `atr:v1:session:*` at the summary.
- Expected: keep `atr:v1:active` so the work is recoverable on relaunch.
- Observed: the speaker is warned ("Could not save to this TV…", works) but `clear_checkpoint` still runs, so the session exists nowhere. Suggested fix: make the clear conditional on the record write succeeding.

### QA-06 (Low, T11): a crash checkpoint older than the 30-day retention is still offered and kept indefinitely

- Repro: crash mid-capture, relaunch 45 days later. Expected: ADR-0005 retention and "minimize retention" apply to session data in the checkpoint as well. Observed: `resume_or_discard` is offered and `atr:v1:active` remains. Suggested fix: prune a checkpoint whose `savedAt` is older than the retention window at launch.

### QA-04 (Low, cross-cutting): `phrases.update` after skipping phrases (before any window opened) shrinks the bank under the cursor

- Repro: bank of 3, press Skip on phrase 1 (no window ever opened), phone sends a 1-phrase update.
- Expected: either deferred to the next session or the cursor stays valid. Observed: `phrase` view shows position 2 of total 1 with empty text. Cause: `phraseStarted` is only set when a window begins, but the cursor can move by skipping.
- Suggested fix: freeze the bank once the cursor has moved (treat any skip as "started").

### QA-05 (Low, T13): in speaker-only mode `session.state` stage `response_pending` is sent only for blind positions

- Repro: four phrases, speaker-only: the stages sent after each result are `phrase_active, reveal` for positions 1, 2, 4 and `phrase_active, response_pending, reveal` for position 3.
- Expected (ADR-0004: "the phone is never told which positions are hidden"): the phone sees the same sequence for every position. Observed: the phone can infer the blind positions. No level or verdict is revealed and the phone UI is not reviewed here, so Low. In family mode every attempt passes through `response_pending`, so the leak is speaker-only.
- Decision needed from research-contracts: neutralise the stage sent for speaker-only blind attempts, or amend ADR-0004.

### QA-01 (Low, T13, contract/doc): ADR-0004 says retries are "marked `meter_visibility: visible_retry`" but no such marker exists

- Repro: scan the stored record, the contract and the view for `visible_retry`: absent. The behaviour is correct (retry is attempt 2, `hidden: false`, meter shown, "Retry: the meter will be shown…" copy) but the marker named in the ADR is not in `AttemptRecord`, `TvView` or the wire.
- Fix: amend the ADR to say retries are `attemptNumber > 1 && hidden === false`, or add the field.

## 3. Observations (not defects)

- **OBS-1 (decision to record in the ADR).** A gate-blocked blind attempt never started, so the next attempt at that position is still blind and carries `attemptNumber` 2 with `hidden: true`. This is documented in `STATE_MACHINE.md` but is a literal departure from "only the first attempt is hidden". Tested: "a gate-blocked blind attempt was never captured…".
- **OBS-2 (resume semantics).** A crash at reveal stores `phraseIdx` of the revealed position, so resume returns to the same position as a visible retry. After resume a new quiet check and calibration run, and later attempts are scored against the NEW band while earlier ones used the old one; the summary shows only the second band as `calibrationMarginDb` and one reached tally. The summary is labelled incomplete, but does not say two bands were involved. Tested: "OBS-2…". Copy nit: "1 phrases were attempted" on the resume prompt.
- **OBS-3.** Spamming OK after a capture window opens stops it early by design (`stop_early` is the preferred control in the capture phase). During the 1.5 s quiet lead and the precheck there is no focusable control, so OK spam cannot press Cancel (tested, 20 presses).
- **OBS-4.** `npm test` at the repository root exits 1 at this base because `services/relay`, `apps/phone` and `tests/integration` have no test files (vitest: "No test files found"). That is not a test failure.

## 4. What was verified, and how

Independent scenario tests, written from the ADRs and PROTOCOL.md with my own fake clock, transport, disk, and a scripted relay and phone that build frames with `@atr/protocol` `MessageFactory` (validated by the shared validators before delivery). Files: `tests/review/rig.ts`, `tests/review/session-core.review.test.ts`, `tests/review/vitest.config.ts`.

| Area | Evidence (all `automated`) |
|---|---|
| (a) Hidden positions | Banks of 1, 2, 3, 4, 6, 9, 10: blind positions are exactly `{3,6,9} ∩ [1..n]` by three independent observations (no meter during capture, a rating prompt, the "Blind check" note). A 4-phrase bank hides only position 3. Retries are visible, attempt 2, `hidden:false`; only first attempts count in `scoredHidden`/`reachedHidden`. Cancel in the quiet lead consumes nothing; a captured-then-cancelled blind attempt is spent. |
| (b) Leak scan | Every view emitted from Begin to the last pre-reveal step (speaker-only and family mode): `meter`, `result`, `summary`, `history` null; no `levelRelDb`/`bandRelDb`/`tone`/`borderline`/`speakerRating` keys; no verdict wording, no stray digits, no labels; `announcement` null while `capturing`. Differential test: two runs with levels at -140 and +20 dBFS in opposite order and a reached versus a below result produce byte-identical pre-reveal views AND byte-identical TV-to-phone message streams. A visible attempt with the same extremes does show the meter (-90 relative on the first frame, then smoothed, stale after 1 s), so the hidden checks are not vacuous. |
| (c) Response phase | Hidden+family needs both inputs in either order and sends exactly one `attempt.reveal`. Rating skip. Choice appears at exactly 20 000 ms (not 19 999), "continue" records `missing` and the view says "no response"; "Keep waiting" restarts the 20 s clock. Reveal locks: a second answer and a rating change are ignored. Late answer: `ack applied/late`, view "(late, not counted)", excluded from the denominator, counted once in `lateListenerResponses`. Invalid attempts never open the listener. Answers during capture and duplicate frames are dropped. |
| (d) Cues | 3 accepted, 4th `rejected cue_limit` with no chip; window-open cue rejected without consuming allowance; 12 code points (emoji) accepted, 13 dropped at the wire; literal text; 3 s chip. Identical sessions with and without cues give identical results and summary. |
| (e) OK spam | 20 OK presses at `phrase_ready`: exactly 1 `precheck.start` and 1 `window.start`; 20 more during precheck change nothing; no focusable control before capture. |
| (f) Back in capture | `window.cancel` with `user_cancel` and the exact session/window/attempt ids; attempt unscored (`cancelled`), no "Next phrase"; a late result from the phone is `ignored_stale`. Back in the lead sends nothing; in the precheck it cancels on the phone. |
| (g) Link loss | Mic view `unknown`, never `off`; the window is cancelled and the cancel is held until `auth.ok`; Retry stays disabled until the phone reports an open mic; no capture resumes without a fresh begin (new window and attempt ids); results and levels from the dead window are ignored while a new window is live; any single mismatched session, window or attempt id is dropped. |
| (h) Summary arithmetic | Scripted 10-phrase family session (reached, below, borderline, invalid x4, skipped x2, blind x3 with a rating each, retries, a late response). Expected counts derived by hand in the test comments: completed 8, attempted 9, skipped 2, invalid 4 (`no_voice`, `clipped`, `cancelled`, `low_coverage`), hidden 1 of 2, visible 4 of 6, agreement hidden 0/1 and visible 6/7, late 1, borderline 1. History for today: 5 of 8, six other days "No session". Stored record holds 13 attempts and the checkpoint is cleared. |
| (i) Storage | Delete dialog opens with Cancel focused (OK and Back both cancel); deletion removes only `atr:` keys and leaves `foreign:keep`, `atrium`, `ATR:v1:upper`, bare `atr`, `other-app/atr:inside`; a lying or rejecting store is reported (banner error, `delete_remaining_keys`) and a retry succeeds; Delete is disabled in a session; fixture mode never writes to the real store. Crash mid-capture: checkpoint holds no verdict, credential or pairing code; resume requires fresh pairing, mic and calibration and records `interrupted` unscored; a resumed session that completes is still incomplete (view, record and history); Discard saves a discarded incomplete record; corrupt checkpoint ignored; newer-schema data causes zero writes. Pruning: `endedAt` = cutoff-1 ms pruned; = cutoff and cutoff+1 ms kept; index rebuilt; retention runs on launch only. v0 migration invents nothing. No credential, pairing code or level stream is stored. |
| (j) Incomplete vs complete | Finish-early summary is labelled and states "Do not compare it with completed sessions"; Home says "(incomplete)"; history flags the day and exposes only counts (no trend/delta fields); a day mixing a complete and an incomplete session is flagged. Note the day total sums both sessions, with the flag. |

### Test sensitivity (mutation evidence)

I applied 27 single-line mutants to a copy of `dist` (never to product source) and ran the review suite against each: 23 killed, 4 survived. The four survivors are equivalent mutants caused by deliberate redundancy: (M01) `meterFor` returning null for hidden windows is backed by a second guard that nulls the meter again at the end of `buildView`; (M06, M06b, M06c) link loss setting the phone state is backed by two other layers (`peerConnected=false`, `micView`). Removing both layers (M01b, M06d) is killed (15 and 2 failing tests). Mutants killed include: positions 3/6/8, retries still hidden, agreement ignoring eligibility, late counted on time, listener wait 19 s, cue cap 4, delete without the `atr:` filter, delete without verification, prune `<=`, resume keeping in-flight attempts, announcing while capturing, controls during the quiet lead, reveal without the listener, a verdict word leaked into the rating prompt, link loss not cancelling the window, dialog preferring Confirm, unchecked window id, cue accepted during a window, Discard marking complete, resumed marked complete, history without the incomplete flag.

## 5. Commands run (original review at `4d4ef1e`; the current head is in section 8)

Timestamps are UTC, 2026-10-04T22:55Z to 23:15Z (2026-10-05 04:25 to 04:45 IST), commit `4d4ef1e`, macOS, Node v25.2.1.

| # | Command (cwd) | Exit | Result | Class |
|---|---|---|---|---|
| 1 | `npx vitest run` (`packages/session-core`) | 0 | 12 files, 177 tests passed (owner suite) | automated |
| 2 | `npx vitest run --config review/vitest.config.ts` (`tests`) | 0 | 1 file, 87 tests: 79 pass, 8 expected-fail defect repros | automated |
| 3 | `QA_STRICT=1 npx vitest run --config review/vitest.config.ts` (`tests`) | 1 | 79 pass, 8 fail = exactly QA-01, 02, 02b, 03, 04, 05, 06, 07 | automated |
| 4 | `npx jest --silent` (`apps/tv`) | 0 | 18 suites, 374 tests passed | automated |
| 5 | `npx tsc -p review/tsconfig.json`, `npx tsc -p a11y/tsconfig.json` (`tests`) | 0, 0 | no type errors | automated |
| 6 | `npm test` (repo root) | 1 | protocol 761, phone-mic-meter 294, ten-foot-meter 49, session-core 177 passed; relay, phone, tests: "No test files found" at this base | automated |
| 7 | mutation script on a copy of `dist` (outside the repo) | n/a | 27 mutants, 23 killed, 4 equivalent survivors | automated |

The a11y runs are in `docs/evaluation/A11Y_T17_PREP.md`.

## 6. Limitations

- Pure-logic evidence. Microphone validity, AGC, VAD timing, Vega AsyncStorage semantics (`getAllKeys`, `multiRemove`), process-kill behaviour on a real Fire TV and relay behaviour are not covered.
- The fake disk simulates a crash by dropping later writes; real AsyncStorage may reorder or partially apply differently.
- I did not review the phone app or the relay, so the impact of QA-03 and QA-05 on the phone side is unknown.
- ADR-0001 DSP thresholds and the quiet-check/calibration math were not re-derived here (owned by T-dsp reviewers); I used them only as inputs.

## 7. Files

- `tests/review/rig.ts`, `tests/review/session-core.review.test.ts`, `tests/review/vitest.config.ts`, `tests/review/tsconfig.json`
- `tests/package.json`: devDependency `axe-core` 4.13.0 (used by the a11y suite); the coordinator wired the `test`, `test:review`, `test:review:strict` and `test:a11y` scripts.

## 8. Update: protocol revision 4 follow-up (wt/qa merged with `build/across-the-room` at `80253a3`)

Rulings received from the coordinator and what changed in the repros:

- **QA-01**: ADR-0004 will be amended so retries are identified by `attemptNumber > 1`. The repro now compares the ADR text with the implementation: it passes (and `it.fails` flips) as soon as the ADR stops naming `visible_retry` and says `attemptNumber > 1`.
- **QA-05**: ruling: the phone sees `session.state` stage `phrase_active` from capture start until the next `phrase_ready` or summary, and never `response_pending` or `reveal`. The repro now asserts exactly that and still fails (the TV still sends both).
- **QA-02..QA-07**: routed to the session owner; the merge contains no fix for any of them, so all stay expected-fail.

Rig updated for revision 4: `auth.ok.next_credential`, values on the 0.1 dB / 0.001 grid through `quantizeDb` / `quantizeCoverage`, integer milliseconds, `silent_input`, per-measurement `window_id` (DEF-002). `tests/review/rig.ts` now also has `forge()` (hand-built frames for values the `MessageFactory` refuses) and `silentPrecheck()`. The 5.99 dB gate boundary became 5.9 (passes) versus 6.0 (blocks).

New tests (all `automated`), 19 added:

| Group | What it checks |
|---|---|
| (l1) DEF-002 | every precheck and capture has its own `window_id`; a pre-window precheck and its capture share the `attempt_id`; no window id is ever reused in a session; `listener.open` and `attempt.reveal` carry the capture's id; a retry gets a new attempt id and new window ids; stale filtering is per window id (a `precheck.result` naming the capture window, or a `window.result`/`level`/`listener.response` naming the precheck window, is acked `ignored_stale`); `window.cancel` names the open measurement; a gate-blocked attempt keeps the precheck's id and has no capture window; the sustained-sound window is also two measurements. |
| (l2) quantisation | off-grid dB (-44.01, -46.95, -44.05, -24.97), off-grid coverage (0.9504) and fractional milliseconds are dropped by the TV with no ack and no state change; the grid twin is accepted; gate boundary 5.9 / 6.0; calibration edge 13.0 accepted, 12.9 rejected. |
| (l3) silent_input | quiet check: failed screen, Retry preferred, no calibration offered, recovers; pre-window: attempt unscored with reason `silent_input`, never started, blind position stays blind on retry; a reason not allowed for the purpose (`unstable_floor` in a pre-window) is dropped at the wire. |
| (l4) rotation | `auth.ok` without `next_credential` is rejected (the TV never shows `connected`); the first reconnect presents the credential from `room.created`; credentials never reach storage or any view. |

Mutation check of the new tests: removing the fresh capture `window_id` is killed by 6 tests, the listener answer ignoring the window id by 1, the pre-window gate ignoring `silent_input` by 1.

### QA-09 (High, TV session/runtime; found in this follow-up): the TV ignores `auth.ok.next_credential`, so its second reconnect presents a consumed credential

- Repro (`QA-09`, also in the browser suite): pair; link loss; reconnect (`auth.resume` presents the `room.created` credential, correct); the relay answers `auth.ok` with `next_credential: N1`; link loss again; reconnect.
- Expected (PROTOCOL.md rev 4 section 3.1: the presented credential is consumed, `next_credential` replaces it, "presenting an already consumed credential revokes that role"): the second `auth.resume` carries `N1`.
- Observed: it carries the original credential again. `grep next_credential packages/session-core/src` finds nothing; only `apps/phone` stores it. Against a relay that enforces rotation the TV role is revoked on the second reconnect and the speaker is told to pair again mid-session.
- Fix: store `next_credential` in `onAuthOk` (memory only, never persisted or projected) and use it for the next `auth.resume`.

### QA-08 (Low, TV copy): `silent_input` has no TV text

- Repro (`QA-08`): a quiet check or a pre-window precheck answered with `silent_input` shows "The window could not be scored." on both the failed quiet-check screen and the paused screen (also seen in the browser, `report.json` key `silent_input_quiet_check_text`). AMENDMENTS-REV2 A1-05 requires "The phone microphone looks muted or blocked." Fix: add the reason to `REASON_COPY`.

### Suites at this head (UTC 2026-10-04T23:15Z to 23:30Z)

| Command | Exit | Result |
|---|---|---|
| `npm test -w @atr/tests` | 0 | 106 tests: 96 pass + 10 expected-fail repros (QA-01, 02, 02b, 03, 04, 05, 06, 07, 08, 09) |
| `npm run test:review:strict -w @atr/tests` equivalent (`QA_STRICT=1 npx vitest run --config review/vitest.config.ts`) | 1 | the same 10 fail, each for its intended reason, 96 pass |
| `npm run typecheck -w @atr/tests` | 0 | no type errors |
| `npx jest --silent` (`apps/tv`) | 0 | 18 suites, 374 tests |
| `npx vitest run` (`packages/session-core`, the owner's suite) | 1 | 18 failed, 177 passed (6 files). Not triaged by me: the messages (a hand-built `auth.ok`, an 11.01 dB value, a shared precheck/capture window id) look like revision 4 fixture drift in the owner's helpers, to be fixed in the session rework. |
| `npm run build` | 2 | `services/relay` fails to compile: `src/core/memory-store.ts(241,29) TS2554 Expected 3 arguments` (the revision 4 `SequenceTracker.accept` signature). Relay owner. |

## 9. Remaining for real VVD / device observation (checklist for the VVD session)

Use real Vega Virtual Device builds, record the build id, VVD image and date, keep screen recordings, and label results `real_VVD` only if produced on the VVD.

1. **Delete verification on real AsyncStorage** (R-J2, R-ST1): with a foreign key present, run Settings, Delete, confirm; call `getAllKeys` afterwards; expect only the foreign key. Repeat with the app killed mid-delete.
2. **Kill and relaunch mid-capture** on the VVD: expect the Resume/Discard prompt; Resume must require fresh pairing, mic and calibration; the interrupted attempt must be unscored.
3. **Checkpoint/record crash window (QA-02):** kill the app between the final reveal and the summary and between Done and Home; verify no phantom resume.
4. **Session end with the link down (QA-03):** drop the relay during a window, press Finish early, restore the link; confirm on the real phone that the mic stops (browser capture indicator off) and note how long it took.
5. **Blind attempt on a real phone** (R-G1..G3): confirm nothing about level or verdict reaches the TV UI, VoiceView or the phone UI before reveal (needs the phone and VoiceView passes).
6. **Listener phase on a real phone** (R-H1..H4): late tap after reveal shows "late, not counted"; 20 s choice; cue cap on the phone UI and the TV.
7. **Timing:** real wall-clock lead (1.5 s), precheck and capture on the device (the suite uses a fake clock).

## 10. Wave 2: re-review at the integrated commit (`7785c45`: session-core rework `2864603`, contract revision 2, AMENDMENTS-REV2, protocol revision 4)

Evidence class: **automated** (pure state machine through `createSessionStore` with fakes). Same limits as section 6.

### 10.1 Updated verdicts

| Task | Verdict | Open defects (all Low) |
|---|---|---|
| T13 hidden meter, blind positions, retries, A4-01/02/03 | **accept** | none |
| T14 listener phase, reveal lock, late answers, cues, agreement, A4-04/05/06 | **accept-with-defects** | QA-12, QA-12b (cue announcements) |
| T11 storage, resume, deletion, retention, A5-01/03/04/05 | **accept-with-defects** | QA-10, QA-11, QA-13 |

No Blocker, no High, no Medium is open in these three tasks. The earlier High (QA-09) and both Mediums (QA-02, QA-03) are fixed and verified.

### 10.2 Status of every earlier defect

| Id | Was | Now | Evidence |
|---|---|---|---|
| QA-01 | Low, ADR names `meter_visibility: visible_retry` | **resolved by decision** | AMENDMENTS-REV2 row QA-01: no such field; a retry is `attemptNumber > 1` and `hidden === false`. The test now reads the amendments and checks the view, the stored record and the wire. Info: the body of ADR-0004 still contains the stale sentence; its header says the amendments override it. |
| QA-02, QA-02b | Medium, crash between record and checkpoint clear | **fixed** | the checkpoint of a finished session is dropped on launch (also after a crash right after the record write, and for a session the speaker ended early); Discard cannot overwrite a finished record |
| QA-03 | Medium, `session.end` lost with the link down | **fixed** | queued, never attempted into a dead socket, delivered once and in order after `auth.ok`; waits for the phone when only the phone is gone; dropped when the relay ends the pairing. The evidence line was re-derived: `wire.dropped` is empty and `window.cancel` precedes `session.end`, each exactly once, also across a second reconnect |
| QA-04 | Low, bank shrinks under the cursor | **fixed** | a skip freezes the bank (`next_session`); a resume clamps to the saved bank |
| QA-05 | Low, phone can infer blind positions | **fixed (ruling)** | the phone sees only `phrase_active` from capture start to the next `phrase_ready`; `listener.open` is the explicit signal |
| QA-06 | Low, stale checkpoint kept | **fixed (A5-03)** | kept at exactly 12 h, discarded 1 ms later, no prompt |
| QA-07 | Low, record write failure cleared the checkpoint | **fixed** | the checkpoint is kept, an error is shown, the next launch offers Resume |
| QA-08 | Low, no `silent_input` copy | **fixed** | "The phone microphone looks muted or blocked." on the failed quiet check and the paused screen |
| QA-09 | High, `next_credential` ignored | **fixed** | the second reconnect presents the rotated credential; a relay `revoked` drops the room with "Pairing may be compromised. Pair again." |

### 10.3 New defects (all Low), each with an `it.fails` repro in `tests/review/session-core.review.test.ts`

Repro: `cd tests && QA_STRICT=1 npx vitest run --config review/vitest.config.ts -t "QA-12"`.

- **QA-10 (T11): a session record dated far in the future is never pruned.** Repro: a record with `endedAt` 400 days ahead survives launch. Expected: an implausible `endedAt` is invalid, or retention clamps it; "minimize retention". Observed: kept (`endedAt < cutoff` is never true), so a TV clock set wrong and later corrected keeps such records for as long as the clock error. Fix: treat `endedAt` or `startedAt` more than about a day ahead of `now` as invalid (A5-05) or prune it.
- **QA-11 (T11): a calendar-invalid `localDate` is accepted and shown.** Repro: `localDate: "2026-13-45"`. Expected: rejected like any other invalid value ("could not be read", A5-05). Observed: accepted; Home says "Last session, 2026-13-45". The shape check is digits-only. Fix: validate it as a calendar date.
- **QA-12 (T14, announcements): a cue chip replaces the next screen's announcement.** Repro: reveal, a cue arrives, Next phrase within the 3 s chip. Expected: the new screen is announced (the cue may be added). Observed: `announcement` is only "Cue: zebra" (`view.ts`: `base = cue !== null ? COPY.cue(...) : announcement`). It recovers when the chip expires, so a screen-reader user hears the screen late and after the cue. Fix: announce the stage text and append the cue.
- **QA-12b (T14, announcements): a cue held during a blind attempt is announced twice at the reveal** ("Cue: zebra Cue: zebra New phrases saved..."): the chip text plus the queued copy.
- **QA-13 (T11, copy): the resume prompt says "1 phrases were attempted".** Not fixed in the rework (the earlier note in OBS-2). Fix: singular form.

### 10.4 What was re-verified, with independent expectations (all `automated`)

`tests/review/rig.ts` now picks the choice that equals the digits the relay sent (`pickJoin`), sends raw text frames only, builds measurement frames that satisfy the TV's own re-validation (calibration reports 6000 ms, not 8000), and has helpers for the a11y input, `forge`, `relayObject`, `relayBinary`, `seededSettings`. 163 tests after this section (158 pass + 5 expected-fail repros).

| Area | What the new tests check |
|---|---|
| A3-06 number matching | three distinct two-digit choices containing the real digits across 60 random sources, the real one lands in every position, digits 00/07/99/10 work; actions are `pick_choice_1..3` then Reject, Reject preferred, `accept_join` is ignored; no confirm-digit key or marker in any view; the right pick sends `accept`; **a wrong pick (either decoy) sends reject, burns the code (no code or QR until a fresh `pairing.code`) and says "That number did not match. Pair again."**; OK and Back reject; the device name is shown as "Name the phone gave: ..."; a second join request is refused without disturbing the first |
| PK-09 raw wire | a parsed object or a binary frame is refused (unparseable counter), the same frame as text is accepted |
| A8-02 screen reader | `{kind:'a11y'}`: lead 3000 ms (2999 sends nothing), the scripts for quiet check, calibration, sustained sound and phrase, "wait four seconds" follows a configured lead, configured leads honoured and out-of-range ignored, a window already in its lead keeps it |
| A4-01 | for a blind first attempt, windows the phone reports as `no_voice`, `low_coverage`, `clipped`, `continuous_sound`, and a TV-local integrity failure, all wait behind the same prompt: **every view from Begin to the prompt and the TV-to-phone traffic are byte-identical to a valid result**, in speaker-only and family mode; "Not scored" and its reason appear only after the rating; `interrupted`, Back, link loss and a precheck timeout keep the immediate path |
| A4-02, A4-03 | the checkpoint has no verdict, reason, timing, rating or listener answer for an unrevealed attempt; Settings, History, About and Diagnostics are not offered between capture close and reveal and the leave dialog still works |
| A4-04, A4-05 | Keep waiting re-sends `listener.open` for the same attempt; Continue without sends `attempt.reveal` once and at once, also while a blind rating is missing; first on-time answer wins; later answers are `rejected/already_answered`; an answer after reveal or after "continue without" (including before the rating) is stored late (`applied/late`) and a second one is rejected; unsolicited answers get `ignored_stale` with an empty detail |
| A3-07 | a `peer.state` with a new generation mid-capture cancels the window (`interrupted`), mic unknown, "Phone reconnected."; the same generation does not; `revoked` drops the room, closes the transport, the session loses its band and a fresh room is created; other ending errors give the generic text; a non-ending error does not leave the screen |
| A5 | records, index and checkpoint hold no phrase text, cue text or device label; 12 h checkpoint boundary; 13 kinds of invalid stored value are ignored and counted while a valid record still loads, Home offers deletion; write order and crash windows; 8-day retention boundary (8 days kept, 8 days + 1 ms pruned, prunes only on launch); delete sends `unpair` then `room.close`, "in progress", "confirmed" when the relay closes the connection, "not confirmed" at exactly 5000 ms or at once with no live link, and no reconnect creates a room or presents a credential |
| A9-02 | default `not_run` labels end with " (unqualified phone)"; `passed` has no suffix; `failed` or `listener_edition` forces the listener check, shows no band verdict or tick, labels the result with the listener's answer and the summary states it and lists the answers |
| A8-01 | a banner appearing while a window is open is visible but not announced and is announced with the next stage; for a blind attempt cue and banner text is held until the reveal; after a phone reconnect `session.state` re-states the open listener attempt |
| About | the privacy statements required by A2-02, A2-03 and A5-04 are present |

### 10.5 Test sensitivity

Single-line mutants applied to a copy of `dist` (never to source): the earlier set again plus 10 new ones (queue disabled, queue re-sending, a wrong pick accepting, stale checkpoint kept, no 12 h discard, hidden invalid windows taking the immediate path, 30-day retention, announcements while capturing, both meter layers removed, blind cue hold removed). All 10 new mutants are killed. Of the earlier set, 20 are killed; the 4 survivors are the same equivalent mutants as before (single layers of redundant guards: the meter guard and the mic-unknown logic), and the two anchors that no longer exist were replaced by the new announcement and meter mutants. One wave 2 mutant initially survived (late answer after "continue without" while a blind rating is missing); I added the missing test and it is killed.

### 10.6 Commands (UTC 2026-10-04 23:15Z to 23:50Z, commit `7785c45`)

| Command | Exit | Result |
|---|---|---|
| `npm test -w @atr/tests` | 0 | 163 tests: 158 pass + 5 expected-fail repros (QA-10, QA-11, QA-12, QA-12b, QA-13) |
| `QA_STRICT=1 npx vitest run --config review/vitest.config.ts` (`tests`) | 1 | exactly those 5 fail, each for its intended reason |
| `npm run typecheck -w @atr/tests` | 0 | no type errors |
| `npx vitest run` (`packages/session-core`, owner suite) | 0 | 20 files, 305 tests |
| `npx vitest run` (`packages/protocol`) | 0 | 14 files, 921 tests |
| `npx jest --silent` (`apps/tv`) | 0 | 18 suites, 374 tests |
| `npm run test:a11y -w @atr/tests` | 0 | 49 tests: 42 pass (including 2 expected-fail repros) + 7 skipped (store-mode groups, see the a11y document) |

### 10.7 Not covered, still `pending_external`

Everything in section 6 and the VVD checklist in section 9 stays, plus: real AsyncStorage partial-failure behaviour for `multiRemove` during pruning and deletion, VoiceView behaviour for the A8-01 hold and the A8-02 script, and the relay's side of number matching and rotation (not reviewed here).


# Independent QA review: T12 (local journey) and T15 (fault recovery)

Reviewer: Sonnet 5.5 (`claude-sonnet-5-5`), branch `wt/qa`, base `5dc35bd` (integrated head, includes `63af0ae`).
Date: 2026-10-05. Evidence class of everything here: **automated** (synthetic audio in desktop Google Chrome 154, headless TV
session core, real local relay). It is not `real_phone` and not `real_VVD`. Nothing in this document is Vega or VVD evidence.

Files reviewed (read-only): `tests/e2e/local-journey.test.ts` (T12), `tests/e2e/fault-recovery.test.ts` (T15),
`tests/src/{e2e-env,tv-driver,journey,fault-proxy}.ts`. Files added by this review (all under `tests/review-e2e/`):
`e2e-negative.review.test.ts`, `vitest.config.ts`, `tsconfig.json`.

## 1. Verdicts

| Task | Verdict | Why, in one paragraph |
|---|---|---|
| **T12** local journey | **accept** | The journey is a genuine end-to-end run (real relay, real phone page, real TV core), its expected values are hand-derived from the script and the ADRs, and it passed 3 of 3 runs with a spread of under 1 s (two further full runs in the T18 pass also passed: 5 of 5). Four of its claims were weaker than their names (section 3): the privacy test could pass on an empty log and sent no phrase text, the hidden-attempt leak scan only covered the TV view and TV traffic validity, a visible-attempt meter control was missing, and the late-listener path was never exercised. Reviewer checks REV-T12-01 to 04 close those gaps and all pass. No product defect found on the T12 path. |
| **T15** fault recovery | **accept-with-defects** | All eight scenarios are real and recover correctly, but (a) the suite failed in 2 of 9 runs for reasons that are not product verdicts (section 2): a shared relay lets one transient setup failure cascade into three; (b) "reconnect with rotated credential" is not proven by a single link drop (the relay's one-step grace hides it) and the continuous-sound test passes when no result is produced at all (section 4); (c) the blackout capability of the fault proxy was never used and, when used, exposes **QA-E2E-01** (Medium): a stalled link that flushes its backlog trips the relay's per-connection rate limit, the relay drops the phone's `mic.state` frame, and the TV keeps showing "measuring" while the phone says "Mic open, not measuring". (d) the harness can run a stale TV core (QA-E2E-04). Reviewer checks REV-T15-01 to 08 close the proof gaps and all pass; QA-E2E-01 is an expected-fail repro. |

Open defects raised by this review, by severity:

| ID | Severity | Owner | Summary |
|---|---|---|---|
| QA-E2E-01 | Medium | relay (rate limiter) with phone (resync) | After a stall that does not drop the connection, the burst of queued frames exceeds the per-connection budget (phone burst 60/s, sustained 40/s). The relay rejects frames by rate alone, including state-bearing ones (`mic.state`, `window.result`, `ack`). Nothing resends them, so the TV mic state stays stale (`measuring`) for as long as the link is up (observed for over 60 s). From the code (`rateStrikesBeforeClose` = 120) a much larger backlog would make the relay close the connection, after which the phone's resume would re-send its state; that self-healing path is inferred from the source and was not demonstrated, so the exposed range is a backlog between the burst budget and that strike limit. In the repro the relay rejected 84 `level`, 1 `mic.state`, 1 `window.result`, 3 `ack` and 1 `ping` frame. Repro: `[QA-E2E-01]` in `tests/review-e2e` (3 of 3 runs). |
| QA-E2E-02 | Low (test infrastructure) | coordinator / T15 author | T15 flake family (section 2): 2 of 9 runs failed in setup; the shared-relay design cascades one failure into several, and the failure trace filters out the relay events that explain it. |
| QA-T18-01 | Medium (portability) | coordinator | `tests/a11y/helpers.ts` (my earlier file) hard-codes the macOS Chrome path with no `ATR_CHROME` override, unlike `tests/src/e2e-env.ts`. Found in the T18 clean-build pass, see `T18_CLEAN_BUILD.md`. Outside this turn's allowed paths, so not edited here. |
| QA-E2E-04 | Medium (evidence integrity) | coordinator / e2e harness | `buildArtifacts()` rebuilds in `beforeAll`, after the TV core and protocol are already imported, so an e2e run after editing `session-core` or `protocol` exercises a stale TV core against a fresh relay and phone. Demonstrated by mutation (section 7). Fix: move the build to a vitest `globalSetup`, or document and enforce `npm run build` first (it is also needed for the suites to load at all). |

## 2. Flake record (each coordinator suite run 3 times)

All runs from `tests/` with `npx vitest run --config vitest.e2e.config.ts <file>`, Node 25.2.1 (worktree default), Chrome 154.0.8037.97,
macOS 27.0.1 arm64, 14 cores, on a shared developer host (load average 3.8 to 8.2 over the preceding 15 minutes, other agents running).

| Run | Suite | Result | Wall time | Notes |
|---|---|---|---|---|
| 0a to 0f | both (3 each) | **exit 1 in 2 to 4 s, all six** | 2 to 4 s | Not flakes. My worktree's `node_modules` predated the relay rework: `npm run build -w @atr/relay` failed `TS2307 Cannot find module '@aws-sdk/client-sqs'` inside `buildArtifacts()`. `package.json` and the lockfile were correct (commit `9600f7d`); `npm ci` fixed it. Recorded because it is the same class of failure a stale checkout produces and the error surfaces only as a `beforeAll` failure of every test. |
| 1 | T12 | pass 4/4 | 108.0 s (journey test 103.6 s) | |
| 2 | T12 | pass 4/4 | 108.1 s (103.3 s) | |
| 3 | T12 | pass 4/4 | 107.5 s (103.4 s) | spread 0.6 s: the journey is paced by real-time sleeps, not by load |
| 1 | T15 | pass 8/8 | 211.1 s | per test 18.4 to 39.5 s |
| 2 | T15 | **FAIL 3 of 8** | 213.8 s | test 6 (noisier room) failed in setup, tests 7 and 8 then could not even obtain a pairing code (see below) |
| 3 | T15 | pass 8/8 | ~211 s | |

Because 1 failure in 3 is not enough to characterise a flake, I ran a diagnostic copy of T15 (verbatim except that it writes the **whole**
relay log and proxy counters on every failing test) six more times:

| Diagnostic run | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Result | pass | pass | pass | **FAIL 2 of 8** | pass | pass |
| Wall time | 211 s | 214 s | 212 s | 242 s | 213 s | 212 s |

Total for T15: **7 of 9 full runs green in this section (8 of 10 counting the clean-clone run in `T18_CLEAN_BUILD.md`); the two failures had different signatures, and no failure was a wrong verdict**. Every failure
was a `waitFor` timeout in the setup or precheck phase of a test, never a failed verdict assertion.

* **Run 4 of the diagnostic loop** (relay healthy: zero `rate_limited`, zero `auth_failed`, zero disconnects beyond the tests' own, relay
  exit code `null`): two tests failed with the TV showing "The phone did not report enough audio. Check the phone and try again." The phone
  had sent a `precheck.result` with insufficient coverage (ADR-0001: `coverage < 0.90` is `low_coverage`), once in the retry precheck of the
  page-hidden test and once in the quiet check of the next test. This is the synthetic-audio page in headless Chrome missing frames under
  host load. It is consistent with load, but I could not prove the cause. The phone's coverage rule is doing its job; the tests have no
  tolerance (`quietAndCalibrate` throws on the first invalid quiet check).
* **Run 2 of the coordinator loop**: the phone link dropped during a quiet check without any injected fault, the phone's six
  `auth.resume` attempts never completed, and the next two tests' TVs stayed at "Connecting to the relay" for 20 s. The relay's log was not
  persisted, so the cause is **unknown**; the trace excerpt shown by T15's `trace()` cannot explain it because its filter
  (`error|reject|revok|supersed|dup|stale|replay|busy|expired|unauthor`) hides `rate_limited`, `auth_failed`, `connect` and `disconnect`
  events. Relay limits that apply to this suite because every client is `127.0.0.1`: 20 connects per source per minute, 5 concurrent
  unauthenticated connections per source, 30 room creations per source per hour (`services/relay/src/core/relay-core.ts`
  `DEFAULT_LIMITS`). A normal run uses 18 connections in 3.3 minutes, so the limits are not near in a healthy run; an unusual burst of
  reconnects could reach them. Not demonstrated.

Why this matters: all eight T15 tests share one relay and one pair of proxies, so a single transient failure leaves later tests facing the
same dead link and reports them as independent failures. Recommended (not applied, not my files): start a fresh relay per test or at least
assert relay liveness in `freshPair()`; make `quietAndCalibrate` retry a quiet check that fails with `low_coverage`; widen `trace()`'s regex
and dump the full relay log on failure (the diagnostic copy shows how, about six lines).

## 3. T12: assertion-by-assertion judgement

"Proves name" means the assertion would fail if the behaviour in the test's name were broken.

| Test / step | Verdict | Notes |
|---|---|---|
| Journey: onboarding, family mode | proves | Family mode is proven by use: the listener answer is required for hidden phrases and `#heard` would never enable in speaker mode. |
| Pairing code regex, QR contains code | proves | Alphabet `ACDEFHJKMNPRTUVWXY3479` is from ADR-0003 and PROTOCOL.md, not read back from the implementation. |
| Number matching (3 distinct choices, phone digits among them, Reject preferred) | proves | A3-06. The `else` branch for a legacy `confirmDigits` contract is dead code and would silently accept a regression to the old contract; low. |
| Nothing but `join.request`/`ping` sent before "Yes" | proves | Not vacuous: at least `join.request` is present. |
| Calibration `tone !== 'not_scored'`, vowel `tone !== 'not_scored'` | weak | A negation accepts any other tone. Saved by the phrase verdicts (LOUD reached, SOFT below), which fail if calibration is wrong. |
| Per-phrase verdict LOUD reached, SOFT below | proves, independent | LOUD equals the calibration level and SOFT is 30 dB below it, by construction of the script. |
| Hidden attempts: meter and result null at the prompt, rating offered | proves | Positive control was missing (REV-T12-01 adds it). |
| Listener timeout: `keep_waiting` preferred, 20 s, then continue | proves | ADR-0004: "Keep waiting" first. |
| Summary counts (attempted 9, completed 9, skipped 1, scoredVisible 6, reachedVisible 5, scoredHidden 3, reachedHidden 2, ratings 1/1/1, agreement 5/6 and 3/3, late 0) | proves, independent | I re-derived each from the script and ADR-0004 counting rules before reading the test; all match. `late 0` is trivial because the phone never answers late (REV-T12-03 exercises it). |
| `longestActiveMs` in (2500, 3600) | proves, independent | The longest tone in the script is the 3 s vowel. |
| Mic off only after the phone says so | proves | |
| History: 7 days, exactly one with sessions | proves | Assumes the run does not straddle local midnight. |
| Deletion: Cancel preferred, only `atr:` keys removed, foreign key kept | proves | The Cancel-preferred rule is a UI-contract rule (session-core contract), not an ADR sentence. |
| Test 2, hidden-view scan | partial | `hiddenViews.length > 5` guards vacuity (good). Scans the TV view only; the phone screen, listener-control state and TV-to-phone traffic were not examined, and there was no positive control that the meter shows on visible attempts. REV-T12-01/02. |
| Test 3, phone traffic valid, no audio keys, levels only inside windows | proves | `phone.sent.length > 100` guards vacuity. The audio guard matches key names only; the protocol validator is the real guard. |
| Test 4, relay log holds no secrets | **weak** | Names "phrase text" but no `phrases.update` is sent in the journey, and the log's length is never asserted, so an empty log passes. REV-T12-04. |

Timing: all waits are 50 ms polls with 20 to 40 s timeouts; the sleeps (200 ms before the tone, 1.5 s tone, 0.7 s tail) have wide margin.
Three runs gave a 0.6 s spread. Random relay port in 20000 to 39999 can collide with another process (not observed). The default Chrome path is macOS-only
unless `ATR_CHROME` is set (QA-T18-01 class, documented in `T18_CLEAN_BUILD.md`).

## 4. T15: assertion-by-assertion judgement

| # | Scenario | Verdict | Notes |
|---|---|---|---|
| 1 | TV link loss mid-window | proves most, **rotation not proven** | The `micViews` scan proves the TV never showed Mic off while its own link was down (not vacuous: it records every transition). Paused with Retry after reconnect and a correct retry are real. "Reconnect with rotated credential" is not proven: after one rotation the relay's grace (`CREDENTIAL_GRACE_MS = 60 s`) still accepts the original credential, so a client that never stored the rotated one passes. REV-T15-01/02/03. |
| 2 | Phone link loss mid-window | proves | Retry scored with SOFT and expects `below`: a leftover state from the LOUD attempt would give `reached`, so this is a good discriminator. |
| 3 | 300 ms each way on both legs | proves verdicts only | Asserts reached then below under 600 ms RTT per leg; says nothing about latency-specific handling beyond that. Fine. |
| 4 | Every phone frame duplicated | proves | `duplicated > before + 20` guards vacuity; unique `message_id`s at the TV. Does not check that the duplicating side got no error back (PROTOCOL.md step 8: silent drop) and never duplicates TV to relay. REV-T15-07. |
| 5 | Page hidden mid-window | proves, with a limitation | Visibility is emulated by redefining `document.visibilityState` and dispatching the event; headless Chrome does not truly background or throttle the page. Checks unscored, mic off after the phone's acknowledgement, explicit restart, retry reached. |
| 6 | Noisier room | partial | ROOM+8 blocks (ADR-0001: rise at least 6 dB). Only the blocking side is tested; a gate that over-blocks passes. REV-T15-05 (ROOM+4 must not block). |
| 7 | Continuous sound | **weak** | `r.result?.tone ?? 'not_scored'` passes when there is no result at all, and the wait accepts `paused_or_invalid` (the same stage as a link loss), so any interruption passes. REV-T15-06 requires a result and the right reason. |
| 8 | Microphone digitally silent | proves | Regex `muted or blocked` matches the amended copy (AMENDMENTS-REV2 A1-05, MEASUREMENT.md `silent_input`). |
| - | Fault proxy `blackout` and `release` | **never used** | Dead capability in T15. REV-T15-08 and QA-E2E-01 use it. |
| - | `trace()` | weak diagnostics | Filter hides `rate_limited`, `auth_failed`, `connect`, `disconnect`. |

## 5. Independence audit: expected values

| Expected value | Source | Independent of the implementation? |
|---|---|---|
| Pairing alphabet and length | ADR-0003, PROTOCOL.md | yes |
| Three distinct number-matching choices, Reject preferred | AMENDMENTS-REV2 A3-06 | yes |
| Phrase verdicts (LOUD reached, SOFT below, ROOM+8 blocks) | script construction, ADR-0001 gate rule | yes |
| Summary arithmetic and `longestActiveMs` | script and ADR-0004 counting rules | yes (re-derived by me first) |
| `keep_waiting` preferred, 20 s | ADR-0004 | yes |
| `muted or blocked`, `noisier` wording | AMENDMENTS-REV2 A1-05, ADR-0001 | yes (text from documents) |
| VERDICT_WORDS (`reached|below|band|not scored|dB|too quiet|...`) | wording of result copy | partly derived from `copy.ts`; acceptable for a leak scan, and REV-T12-02 uses its own list |
| Cancel preferred on delete | session-core contract | contract rule, not an ADR sentence |

No expected value was found to be read back from the implementation's own output.

## 6. Checks added (`tests/review-e2e/e2e-negative.review.test.ts`, clearly marked as reviewer-authored)

Expected values come from documents or differential comparison; credentials are compared with boolean assertions so a failure never prints one.
Run: `cd tests && npx vitest run --config review-e2e/vitest.config.ts` (builds artifacts itself; 365 s; `QA_STRICT=1` makes QA-E2E-01 fail).
`ATR_QA_LOG=<file>` appends the whole relay log when a check fails.

| ID | What it proves | Derived from | Final run | Mutation: reviewer check fails | Mutation: coordinator check still passes |
|---|---|---|---|---|---|
| REV-T15-01 | TV: after two drops, each `auth.resume` presents the credential the previous `auth.ok` issued; second `auth.ok` rotates again | ADR-0003 A3-07, relay-core grace | pass 19 s | fails (M1) | passes (blind to it) |
| REV-T15-02 | Same for the phone (`join.accepted` then `auth.ok` chain) | same | pass 19 s | fails (M1b) | passes (blind to it) |
| REV-T15-03 | A rotated-out credential is refused, logged `credential_reused`; garbage is logged `bad_credential`; client sees the same generic error (A3-05); log leaks no credential | A3-05, A3-07 | pass 21 s | n/a (relay behaviour, covered by relay tests) | n/a |
| REV-T15-04 | After TV link loss mid-window no `window.start` is sent until Retry (wire level, with a positive control) | contract | pass 27 s | n/a | n/a |
| REV-T15-05 | A room 4 dB louder than the quiet check does not block the gate | ADR-0001 (block at rise at least 6 dB) | pass 21 s | fails (M2) | passes (blind to it) |
| REV-T15-06 | Continuous sound yields a result whose reason is the continuous sound, not low level | MEASUREMENT.md `continuous_sound` | pass 27 s | fails (M3) | passes (blind to it) |
| REV-T15-07 | Duplicates on both legs from the first frame: dropped silently, each peer sees every message once, no error frames, verdict correct | PROTOCOL.md section 4 step 8 | pass 21 s | fails (M8) | passes (blind to it) |
| REV-T15-08 | Late phone frames for a window the TV already closed are answered `ignored_stale` and never scored; Retry still recovers | PROTOCOL.md section 4 step 10 | pass 40 s | n/a | n/a |
| QA-E2E-01 | Expected-fail repro: TV mic state converges to the phone's after a backlog flush. Skips (inconclusive) if the burst did not reject a `mic.state` | spec: observed state only | expected-fail holds 54 s; strict fails for the intended reason | n/a | n/a |
| REV-T12-01 | Positive control: a visible attempt shows the live meter while capturing | ADR-0004 | pass 21 s | n/a | n/a |
| REV-T12-02 | Hidden first attempts, valid versus invalid (no voice): phone screen has no verdict wording, listener-control states are the same, TV-to-phone frame signatures are identical until the rating prompt | A4-01 | pass 28 s | fails (M6) | passes (journey 4/4) |
| REV-T12-03 | A listener answer sent before and delivered after the TV revealed without it is acknowledged `applied`/`late`, does not change the result, and the phone locks `#heard`/`#not-heard` once the reveal arrives | AMENDMENTS-REV2 A4-05, ADR-0004 | pass 42 s | fails (M5) | passes (journey 4/4) |
| REV-T12-04 | Household phrases typed on the phone reach the TV verbatim; relay log is non-empty and contains neither phrase words, the TV credential nor the pairing code | ADR-0002 | pass 15 s | n/a | n/a |

Full-suite results of the reviewer file: run 1 failed 3 of 12 (two were flaws in my own checks, one was QA-E2E-01), run 2 failed 1 of 13
(a flaw in my own slicing), run 3 **13 of 13 pass**, 365 s. The flaws in my checks, recorded because they change how far the results can be trusted:

* REV-T12-02 first compared listener-control states from the moment of Begin, which included the state carried over from the previous
  phrase (cue enabled between windows) and gave a false difference; it now compares from the first measuring state.
* REV-T12-02 first sliced `phone.received` by array index. Playwright delivers WebSocket frame events asynchronously, so the slice mixed in
  a stale `vowel_ready` frame and omitted an `attempt.reveal`; it now slices the TV's own sent frames, which are exactly ordered. The earlier
  "difference" was not a leak.
* REV-T12-03 first read `#heard` as enabled before the reveal had reached the phone and then timed out clicking a control that had become
  disabled (the phone does lock its controls). It was rewritten to hold the phone leg so a genuinely late frame is sent.

## 7. Mutation experiments (scratch clone, never the worktree)

Each row changes one source line in a scratch clone of this branch (`/private/tmp/claude-501/t18/mut`, never the worktree), rebuilds,
runs the reviewer's check and the coordinator's closest check against the same broken behaviour, then restores the file. Exit codes and
logs are kept in the scratch directory; the numbers below are from the second pass (the first pass is explained after the table).

| Mutation | Source change | Reviewer check | Coordinator check |
|---|---|---|---|
| M1 | `packages/session-core/src/machine.ts` `onAuthOk`: the rotated credential is not stored | REV-T15-01 **fails** (second resume presents the old credential), 22.5 s | T15 "TV link loss mid-window" **passes**, 30.5 s |
| M1b | `apps/phone/src/controller.ts` `onAuthOk`: same, phone side | REV-T15-02 **fails**, 22.6 s | T15 "phone link loss mid-window" **passes** |
| M2 | `constants.ts` `GATE_RISE_MAX_DB` 6 to 3 (gate over-blocks) | REV-T15-05 **fails** (ROOM+4 blocked) | T15 "noisier room" **passes** (ROOM+8 still blocks) |
| M3 | `copy.ts` `continuous_sound` shows the `no_voice` sentence | REV-T15-06 **fails** (wrong reason) | T15 "continuous sound" **passes** |
| M5 | `machine.ts`: a listener answer after reveal is acked with an empty detail instead of `late` | REV-T12-03 **fails** | T12 journey **passes 4/4** |
| M6 | `machine.ts`: the neutral prompt for hidden invalid windows is applied only to `interrupted` (an A4-01 regression: a `no_voice` hidden window reveals immediately) | REV-T12-02 **fails** | T12 journey **passes 4/4** (it only has valid hidden attempts) |
| M8 | `services/relay/src/core/relay-core.ts`: a duplicate `message_id` is answered with a `replay` error instead of being dropped silently | REV-T15-07 **fails** | T15 "every phone frame duplicated" **passes** |

All seven coordinator checks pass under the broken behaviour: that is the measure of the gaps the reviewer checks close.

Two harness lessons from the first pass, both recorded because they affect how e2e evidence should be read:

* **First pass, session-core changes not detected (QA-E2E-04).** I patched the source and ran vitest directly. REV-T15-01, 05 and 06 *passed*
  under M1, M2 and M3, while the phone and relay mutations (M1b, M8) were detected. Cause: `buildArtifacts()` runs in `beforeAll`, after
  vitest has already imported `@atr/protocol` and `@atr/session-core` (static imports in the test files, `tests/src/journey.ts` and
  `tests/src/tv-driver.ts`). The relay (a child process) and the phone (static files) are rebuilt and so run the new code; the TV core runs
  whatever `dist` existed when the process started. After a pre-build (`npm run build` before vitest) all three were detected. The same
  ordering makes the suites fail at import on a tree that was never built (T18 probe 52b: exit 1 in 0.8 s, "Failed to resolve entry for
  package @atr/protocol").
* **First M5 variant hit the wrong site.** `machine.ts` has two late-acknowledgement sites: a listener answer arriving after reveal
  (REV-T12-03) and one arriving while a hidden attempt still waits for the rating after "continue without listener". My first M5 patched the
  second; REV-T12-03 correctly did not notice. That second path is not covered by either e2e suite, and I did not check unit coverage in this
  pass.


## 8. Commands run and results

| Command | Exit | Result |
|---|---|---|
| `npm ci` (worktree, after the stale-`node_modules` failure) | 0 | 110 packages; `npm audit`: 3 findings (vitest 3.2.4 critical, only when the Vitest UI server is listening; @vitest/mocker moderate; ws 8.18.x high), both fixable without a major bump (vitest 3.2.7, ws 8.22.0); see `T18_CLEAN_BUILD.md` |
| `npx vitest run --config vitest.e2e.config.ts e2e/local-journey.test.ts` x3 | 0, 0, 0 | 4/4 each, 108.0, 108.1, 107.5 s |
| `npx vitest run --config vitest.e2e.config.ts e2e/fault-recovery.test.ts` x3 | 0, 1, 0 | 8/8, 5/8 plus 3 failed, 8/8; 211, 214, 211 s |
| diagnostic copy of T15 x6 (not committed) | 0,0,0,1,0,0 | 5 of 6 green, 1 run with 2 failures (low_coverage precheck) |
| `npx tsc -p review-e2e/tsconfig.json --noEmit` | 0 | clean |
| `npx vitest run --config review-e2e/vitest.config.ts` | 0 (run 3) | 13/13 in 365 s |
| `QA_STRICT=1 npx vitest run --config review-e2e/vitest.config.ts -t QA-E2E-01` | 1 | fails for the intended reason (TV mic stays `measuring`, phone badge "Mic open, not measuring", relay logged `rate_limited` for `mic.state`) |
| mutation harness, 7 mutations in a scratch clone (section 7) | n/a | every reviewer check fails under its mutation; every coordinator check passes |
| `python3` YAML parse and actionlint wasm on `.github/workflows/ci.yml` | 0 | see the header of that file; 3 expected label findings only |

## 9. Limitations

* Raw logs (flake loops, the diagnostic copy, mutation logs, T18 step logs) are in `/private/tmp/claude-501/` and are not committed; this document records what they showed.
* Everything is `automated` evidence from one macOS host. Linux, a real phone, a real network and the Vega TV were not exercised.
* The page-hidden scenario emulates visibility; the synthetic audio source cannot show how a real phone's audio stack behaves under backgrounding.
* The flake rate (2 of 9 for T15) is a small sample on a shared host. The cause of coordinator-loop run 2 is unknown (relay log not captured).
* `tests/package.json` does not list `review-e2e` in its `typecheck` script or add a `test:review-e2e` script (outside my allowed paths). Suggested lines for the lead:
  `"typecheck": "... && tsc -p review-e2e/tsconfig.json --noEmit"` and `"test:review-e2e": "vitest run --config review-e2e/vitest.config.ts"`.

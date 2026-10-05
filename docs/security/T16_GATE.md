# T16 security and privacy gate

- Task: T16, independent security and privacy gate after the rework wave. Reviewer: security (role security-review), resolved model `claude-sonnet-5-5`. I did not write any code under test.
- Worktree / branch: `/Users/nihalnihalani/Desktop/Github/atr-worktrees/security`, `wt/security`.
- Integration head tested: `da018d730c7b52a23672d3a6a639be70f01be2e9` (`build/across-the-room`, 18 commits after the `63af0ae` that the coordinator's message referred to; the gate was re-run on the new head, see section 2). The gate record is the commit that contains this file.
- Date: 2026-10-05 (Asia/Kolkata). Host: macOS 27.0.1 arm64, Node v25.2.1 (the project targets Node 22 to 24), npm 11.6.2, vitest 3.2.7, Google Chrome 154.0.8037.97 (desktop).
- Evidence classes used: **automated** (local relay as a child process over TLS with a name-constrained dev CA, raw `ws` sockets, the phone page in desktop Chrome, the headless TV session core, in-process protocol and DSP code), **web_preview** (TV UI in react-native-web, a browser stand-in for Vega), **documentation_only** (the T04 protocol review, code and IaC reading). **No `real_phone`, `real_VVD` or AWS evidence exists in this gate.** Nothing here calls AWS (B-003).

## 1. Verdict

**PASS WITH RESIDUALS**, for this scope only: the local relay, the phone page and the TV session core as built, run on a development machine.

Why it is not a plain pass: two findings of major severity are open (N-01, N-03), the T04 qualification analysis has two major integrity holes (N-08, N-09), and every AWS and device check is pending. Why it is not a fail: no blocker is open. The three blockers from T02 (A3-01 confirmation on the phone, A4-01 hidden-meter leak, A9-01 compression passing the criteria) are closed or closed-with-residual with the residual stated; no privacy claim in the shipped copy is contradicted by what the code sends, stores or logs; no credential, code, phrase, cue or label appears in a relay log; no audio-like payload leaves the phone.

*Update, same day: the residual fixes are merged and re-verified (sections 12 and 13; the final gate statement is in section 13.3). Conditions 3 and 4 below are met; condition 1 now reduces to the AWS deployment checks (the repository side of N-03 is closed); condition 2 is superseded by the approval of revision 3 (section 11).*

Conditions attached to the verdict (the gate does **not** cover these until they are met):

1. **AWS is not cleared.** Every AWS-only check is `pending_external` (section 8) and finding N-03 (the phone page and the relay are on different hosts in the template, and the production phone build cannot be told the relay URL) must be resolved before any staging deployment.
2. **The T04 qualification protocol revision 2 is rejected as frozen** (section 7). *Update, same day: revision 3 is approved, see section 11.* No trial may start under revision 2.
3. **Should fix before the demo is recorded:** N-01 (a legitimate reconnect over a half-open socket is refused and the phone reports a lost pairing), N-02 (CSP wildcard), and the wording fixes N-05 and N-14.
4. `tests/security` is not yet wired into `tests/package.json` (not mine to edit): see section 10.

Counts: 66 T02 findings re-reviewed (46 closed, 18 closed-with-residual, 0 open, 2 pending_external); 14 new findings, N-01 to N-14 (4 major: N-01, N-03, N-08, N-09; 8 minor; 1 info; N-04 already closed).

## 2. What was run

All commands from the worktree root unless a directory is given. "Exit" is the process exit code.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git merge --ff-only build/across-the-room` | 0 | `63af0ae` to `da018d7`: privacy line (copy.ts), About screen from core, phone production script, `ws` 8.22.0, vitest 3.2.7, docs and submission files |
| 2 | `npm ci` | 0 | lockfile changed by the merge |
| 3 | `npm run build` | 0 | all workspaces |
| 4 | `npm run typecheck` | 0 | all workspaces |
| 5 | `npx tsc -p security/tsconfig.json --noEmit` (in `tests/`) | 0 | the security tests typecheck |
| 6 | `npm test -w @atr/protocol` | 0 | 14 files, 921 tests passed |
| 7 | `ATR_PROTOCOL_DIST=packages/protocol/dist/index.js node docs/security/probes/protocol_probes.mjs out.json` | 0 | 236 rows: 200 PASS, 36 INFO, 0 FAIL, 0 GAP (the stored result file equals a fresh run) |
| 8 | `npx vitest run --config security/vitest.config.ts --reporter=verbose` (in `tests/`) | 0 | **11 files, 113 tests passed**, 256.98 s (per file: a:15, b:13, c:10, d:9, e:15, f:26, g:9, h:2, i:2, j:8, k:4); 7 of the tests are `it.fails` records of open findings: they pass while the defect exists and fail loudly the day it is fixed |
| 9 | `python3 fixtures/dsp/tools/freeze_hash.py` | 0 | protocol `7059dd75...eadd`, criteria `6b7c339d...5248`, freeze hash `3ba1fdff6444e079e1b2b6c6e57330c3dded1d54e884681cce4087347ef4d820`, equal to EV-0030, at `da018d7` |
| 10 | `npm audit --omit=dev` in root | 0 | 0 vulnerabilities |
| 11 | `npm audit --omit=dev` in `apps/tv/web` | 0 | 0 vulnerabilities |
| 12 | `npm audit --omit=dev` in `apps/tv` | 1 | 70 vulnerabilities (2 low, 19 moderate, 44 high, 5 critical), build and CLI tooling (section 6, R18) |
| 13 | `git grep` secrets scan over tracked files (private-key blocks, AWS key ids, `aws_secret_access_key`, Slack, GitHub and Google key shapes, `sk-` tokens), lockfiles and `research/` excluded; tracked key, certificate and `.env` files | 0 | no match except a documentation line that describes the patterns (`docs/submission/JUDGE_ACCESS.md:47`); no tracked key or certificate file |
| 14 | root `npm test` (all workspaces, no e2e) | 0 | 7 workspaces: protocol 921, phone-mic-meter 450, ten-foot-meter 49, session-core 378, relay 1111 (+2 skipped), phone 459, tests/review 163; 3,531 passed in total, 0 failed |

Other runs, for the record. (a) A first full security run at `63af0ae` was stopped when I noticed that the integration branch had moved; it is not counted. (b) A full run at `da018d7` before the flood, fuzz and chained-window tests were added: 10 files, 108 tests, exit 0, 240 s. (c) One unexplained failure seen once earlier in the work: the 65 s pending-join test, phone socket closed 1006 while the raw TV was idle; it passed after the test was given the heartbeat a real TV sends (DEF-001) and in every later run I made; I treat it as a test-harness issue, not as a relay defect, but I did not prove that.

Per-file map (all under `tests/security/`, run from `tests/` with `--config security/vitest.config.ts`):

| File | Covers |
|---|---|
| `a-preauth-forwarding.test.ts` | SEC-A01, A02, A12, A13, V02, V03, V07 (deflate, size), I09 |
| `b-pairing-credentials.test.ts` | SEC-A05 to A10 |
| `c-origin-abuse.test.ts` | SEC-A02 (65 s), A03, A11, production configuration |
| `d-phone-hostile.test.ts` | SEC-W02, W03, W04, W06, W07, N-01, N-02, N-12 |
| `e-journey-audits.test.ts` | one full journey: SEC-P01, P02, P06, T02 to T05, W01, A5-01, A5-03 to A5-05, N-07 |
| `f-static.test.ts` | SEC-I01, I05, P03 to P05, T01, A04, V01, A6-02, A6-03, A8-02 to A8-03, N-03, N-04, N-06 |
| `g-dsp-recheck.test.ts` | SEC-M03 to M05, A1-01 to A1-09 |
| `h-tv-preview-xss.test.ts` | SEC-W01 on the TV web preview, PK-09 |
| `i-tv-store.test.ts` | A3-06 number matching, PK-09, TM-G3 |
| `j-t04-qualification.test.ts` | the T04 analysis: A9-01, A9-05, N-08 to N-11 |
| `k-limits-flood.test.ts` | SEC-V07 (rates), SEC-T08 (cue cap), SEC-V08 (fuzz) |

Reuse: `tests/src/e2e-env.ts` (build, Chrome, phone page), `tests/src/journey.ts` (quiet check and calibration steps), `tests/src/tv-driver.ts` (headless TV with a memory store) and `tests/a11y/scripted-phone.ts` are used as they are. `tests/src/fault-proxy.ts` was not used: the half-open socket case needed a proxy that leaves the relay side open and silent when the client side dies, so `HalfOpenProxy` lives in `d-phone-hostile.test.ts`. The relay under test is the real `services/relay/dist/local/main.js` started as a child process (black box).

## 3. Re-review of every T02 finding

Verdicts: **closed** (the shipped behaviour matches the decision and I observed it or read the code that does it), **closed-with-residual** (closed, with a stated remaining risk or an unexecuted part), **open**, **pending_external** (needs AWS or a device). Evidence letters refer to the test files above; "code review" means I read the code and did not execute it.

| ID | Sev (T02) | Verdict | Evidence and residual |
|---|---|---|---|
| A1-01 | major | closed | g: bursts of 100 ms or less never accepted at 40 sub-frame phases; 250 ms always at +10 and +20 dB; 200 ms always at +20 dB (phase-dependent at +10 dB, wording corrected in the amendment) |
| A1-02 | minor | closed | g: four isolated 50 ms clicks 100 ms apart are not accepted (no run of 3) |
| A1-03 | major | closed-with-residual | hysteresis shipped (open 10 dB, continue 6 dB). Silent-window false activity is 0.3 / 2.3 / 10.2 % in the three noisiest admissible rooms (g, my model), and a silent window is scored reached in 0.015 / 0.3 / 2.3 %: N-05 |
| A1-04 | major | closed | g: a 350 ms one-syllable phrase is scored; no_voice means no accepted segment |
| A1-05 | major | closed | g: digital silence is silent_input for both prechecks (quiet check and pre-window) |
| A1-06 | minor | closed | g: the pre-window precheck never reports unstable_floor or too_loud; an unchanged room (rise 3 dB or less) is never blocked at any accepted margin; the boundaries are exactly 3, 4, 5 and 6 dB |
| A1-07 | minor | closed | g: reason priority interrupted > nonfinite > low_coverage > silent_input > clipped > unstable_floor > burst_noise > too_loud |
| A1-08 | minor | closed | f: Diagnostics carries the session margin and the tolerated floor rise |
| A1-09 | minor | closed-with-residual | g: the TV recompute turns impossible counts, silent or unstable data into integrity, never a verdict. Residual (R11): it checks internal consistency only; there is no cross-check against the level stream, so a paired phone can report any self-consistent p95 |
| A1-10 | minor | closed | probes P17: vad_floor_dbfs outside -110..-30 is bad_schema |
| A2-01 | minor | closed | f: the phone sentence and the TV PRIVACY_LINE are the exact amended text (N-04 was open at 63af0ae and is closed at 0061d83); every payload field maps to a disclosed category. Info: the ADR-0002 body still quotes revision 1 (its header points to the amendments) |
| A2-02 | major | closed | f: the TV About sentence is in session-core copy and rendered by the TV About screen from the core (single source). Not seen on a Vega device |
| A2-03 | major | closed-with-residual | e: no address in any relay log line. Code: HMAC-SHA-256 source key, IPv4 /32 and IPv6 /64, daily key, counters keyed and TTL at most 1 h (credentials.ts, dynamo-store.ts). IPv6 /64 grouping and the DynamoDB attributes were read, not exercised: pending_external for the AWS store |
| A2-04 | minor | closed-with-residual | e: every relay log line is a closed-vocabulary JSON record, per-minute aggregates, hostile frames not echoed (local adapter). Lambda runtime logs not observed: pending_external |
| A2-05 | minor | closed-with-residual | f: execution data tracing off, logging level OFF, no access log, X-Ray off, retention 14 days, PITR off, no wildcard IAM, no Scan, scoped ManageConnections. Platform behaviour not observed: pending_external |
| A3-01 | blocker | closed | d: a hostile QR with an auto-accepting attacker room: no socket before Join; before Yes the phone sends only join.request and ping, opens no microphone, accepts no command; No sends nothing and removes the phone from the room; the fragment is removed from the address bar |
| A3-02 | major | closed | b, c: reject, wrong pick and expiry burn the code and issue a fresh one; pairing.refresh kills the old code and is limited to 1 per 10 s; 6 ended joins per 10 min per source then rate_limited |
| A3-03 | major | closed-with-residual | c: failure delay 2 s doubling after 3 free failures (delay, not lock-out), 5 concurrent unauthenticated connections, 20 connects per minute (HTTP 429), live-room cap. One source only (loopback): many-source and IPv6 /64 rotation not exercised; shared-NAT effect stays R6 |
| A3-04 | minor | closed | code review: credentials.ts HashKeys uses HMAC-SHA-256 under a secret (random per process locally; an SSM parameter referenced by name in the template, f). Not observable black-box |
| A3-05 | minor | closed | b: every failed resume (unknown room, wrong credential, wrong role, malformed) gets the same answer; 10 failures per minute per room, then a correct credential is refused the same way |
| A3-06 | major | closed | i: three distinct choices include the real number, Reject preferred, no Accept, a wrong pick rejects and burns the code, decoys differ between rounds; label shown as untrusted text |
| A3-07 | major | closed-with-residual | b: a stolen credential cannot displace a live phone and is not consumed; rotation; reuse of a consumed credential revokes the role and tells the TV; a TV credential reuse closes the room; one lost auth.ok is survived (60 s grace). Residual: inside the 60 s grace a thief holding the consumed credential obtains the next one (documented in SECURITY-NOTES.md section 2); N-01 (the guard also refuses the owner's own reconnect over a half-open socket) |
| A3-08 | major | closed-with-residual | c: the Origin matrix on real sockets (exact match, absent, null, case-insensitive header, foreign) and origin_state operations. Local relay only; API Gateway $connect is pending_external; topology N-03 |
| A3-09 | major | pending_external | a, c: the local adapter closes at 5 s, at the 6th message and at 65 s with a pending join, with the documented message-level behaviour. The SQS delay-queue timers and close codes on API Gateway cannot be checked without AWS |
| A3-10 | minor | closed-with-residual | b: two phones, same code, same instant (5 rounds): one pending, one busy; a double accept claims the slot once; a TV of another room cannot confirm. Real DynamoDB conditional writes: pending_external |
| A3-11 | minor | closed | protocol CREDENTIAL_TTL_MS = 2 h, renewed by rotation; b: unpair revokes at once (close 4410) and the credential never works again; credentials are memory-only on the phone |
| A3-12 | minor | closed | c: a production relay refuses client.platform test and accepts vega; local development may allow it |
| A4-01 | blocker | closed | e SEC-T02: while a hidden first attempt is pending no view carries a level, verdict, validity reason or result; a valid and an invalid hidden window follow the same neutral path; no side door |
| A4-02 | major | closed | e SEC-T03: a crash with a hidden result pending leaves no verdict, rating or window figure on disk; relaunch shows none |
| A4-03 | major | closed | e SEC-T02: meter and result null in every view of the pending state (more than 10 views, including Diagnostics and History where the journey opened them); Settings is not offered |
| A4-04 | minor | closed | code review: phone lockListener on attempt.reveal, window.cancel, session.end, a session change and at timeout_ms (controller.ts 1010, 1018, 1047, 1059, 1101); TV keep_waiting and continue_without_listener exist (machine.ts 529-535). Not executed |
| A4-05 | minor | closed | code review: first on-time response wins, later ones get ack rejected already_answered, late ones are applied with detail late (machine.ts 1598-1623). Not executed |
| A4-06 | minor | closed | contract and copy: borderlineCount and the borderline note; arithmetic not re-derived |
| A4-07 | minor | closed | k: three cues per announced session reach the TV, the fourth is cue_limit, a cue under an invented session id is not delivered, a new session has its own budget. TV-side rejection outside between-window states not executed |
| A5-01 | major | closed-with-residual | e: the delete flow sends room.close after the last session message and the phone leaves the paired view. Residual N-07: the phone page keeps the household phrases in memory after the TV deleted and closed |
| A5-02 | major | closed | e SEC-P06: no localStorage, sessionStorage, IndexedDB, Cache API, cookie or service worker entries after a full journey, unpair and delete |
| A5-03 | minor | closed | e: a checkpoint older than 12 h is discarded on launch |
| A5-04 | minor | closed | e: summaries kept 8 days and pruned after; summaries and the checkpoint contain no phrase, cue, label, credential, code or room id |
| A5-05 | minor | closed | e: corrupt and partial atr:v1 values are survived as absent; delete verified and a foreign key left alone |
| A6-01 | minor | closed-with-residual | docs/release/README.proposed.md has no polling or Node 20 text; the root README.md (owner's research file, not editable by teammates) still carries lines 40 and 164-165 until the lead adopts the proposal |
| A6-02 | minor | closed | f: both clients use the 0.5 to 8 s backoff with plus or minus 25 % jitter and a 2 min failure window. Code review: the phone's FATAL_RESUME_CODES and the TV machine stop reconnecting on terminal codes and return to pairing (d shows the phone doing so) |
| A6-03 | minor | closed-with-residual | f: the dev CA is name-constrained (critical); permessage-deflate is off (a). Residual N-06: the dev CA is valid for 3650 days, the amendment says short-lived |
| A7-01 | minor | closed-with-residual | root npm audit --omit=dev: 0 vulnerabilities; apps/tv/web: 0; apps/tv: 70 (2 low, 19 moderate, 44 high, 5 critical), all in React Native and Vega build or CLI tooling, recorded as an exception by the lead. I checked the bundle list: none of the 27 bundled packages carries an advisory of its own; four Amazon packages appear only through their dependency chain. SBOM, licence inventory and support dates exist (docs/release) |
| A8-01 | major | closed-with-residual | code review: view.announcement is null while a precheck or capture is open, the Announcer live region is off while capturing (view.ts 137-141, Announcer.tsx). Not re-run by me (the strict a11y gate is the qa evidence). Residual R5: TV speech during a window can still be counted as voice |
| A8-02 | major | closed | f: the screen-reader lead is 3000 ms and the ready screen carries the fixed script |
| A8-03 | minor | closed | f: the phone code never plays a sound, speaks or vibrates |
| A8-04 | minor | pending_external | T17 VVD observation (lead, speech rate, build); a browser run cannot satisfy it |
| A9-01 | blocker | closed-with-residual | j: a monotonic, tight, unclipped input that compresses 12 dB steps (3:1, 2:1, 1.5:1) fails C2; 1.2:1 passes. Residual N-08: C2 trusts caller-supplied nominal levels, so a 3:1 compressor labelled with levels 2 dB apart passes |
| A9-02 | major | closed | storage.ts: qualification is not_run by default; failed forces Listener Edition (selectors.ts); the unqualified suffix is applied unless the state is passed (view.ts 655, copy.ts). Info: no code sets the state yet (T04A) |
| A9-03 | major | closed-with-residual | negative-case limits are frozen in QUALIFICATION_PARAMS (N1 and N2 at most 0 of 10). Residual N-09: missing, NaN or under-sampled results pass C7 |
| A9-04 | minor | closed-with-residual | EV-0030 recorded; freeze_hash.py at da018d7 reproduces 3ba1fdff6444e079e1b2b6c6e57330c3dded1d54e884681cce4087347ef4d820. Residual N-13: the hash omits percentile.ts. Approval: rejected (section 7) |
| A9-05 | minor | closed | j: 15 repeats, upper bound of the SD at 95 %, chi-square(14) 5th percentile 6.5706 and factor 1.4597 verified; an SD of 1.03 dB passes and 1.04 dB fails |
| A9-06 | minor | closed | mic.state.mode is a label; evidence class real_phone comes from experiment records (T04 protocol section 10, EV log) |
| PK-01 | major | closed | probes: one snapshot, validated and returned (D08 stateful proxy: no unvalidated read); sparse arrays of 10 to 100 million elements are refused as payload_too_large in 0 to 6 ms and 53 to 131 MB RSS (the revision 1 cost of 2.8 GB is gone) |
| PK-02 | major | closed | probes P01-P17 rejected; g: TV recompute |
| PK-03 | minor | closed | probes: bidi, separators, tag characters, blank-to-the-eye text and combining runs rejected; ZWNJ, ZWJ, emoji and Arabic accepted |
| PK-04 | minor | closed | a: duplicate keys, whitespace and escapes are forwarded as the canonical re-serialisation |
| PK-05 | minor | closed | probes: -0 becomes 0 |
| PK-06 | minor | closed | probes K and M rows; e: every dB value the phone sent is on the 0.1 grid, coverage on 0.001, times integers |
| PK-07 | minor | closed | probes K06-K07: SequenceTracker.accept(expectedGeneration, generation, sequence); a generation jump is stale; the old signature throws TypeError |
| PK-08 | minor | closed | a: message ids scoped per role; a rate-limited message does not burn its id |
| PK-09 | minor | closed | h, i: the TV store ignores a decoded object, a sender_role tv frame and a phone-claimed relay-only type |
| PK-10 | minor | closed | a: role and type matrix (37 types, both roles); f: both adapters call processInbound; the local server parses nothing itself |
| PK-11 | minor | closed | docs checked: README and PROTOCOL.md both revision 4; the NFC wording is senders normalise, receivers reject; vad_floor range; invalid_reason per purpose; ack identity required |
| PK-12 | info | closed-with-residual | session-core store runs the NFC self-test and shows it in Diagnostics. Whether Hermes on the VVD normalises correctly is pending_external (R9) |
| PK-13 | info | closed | relay, phone and TV pass their own clock as now and never take maxBytes from a peer |

## 4. New findings

Severity scale: blocker (do not release), major (fix before release or accept in writing), minor, info. "Repro" is a command from `tests/` unless stated.

**N-01 [major] A legitimate reconnect over a half-open socket is refused as an impostor, and the phone reports the pairing lost.** Repro: `npx vitest run --config security/vitest.config.ts security/d-phone-hostile.test.ts -t N-01` (an `it.fails`; it prints the page text). When the phone's network dies without a TCP close (Wi-Fi to cellular, router restart), the relay still holds the old socket for up to 25 s. The owner's `auth.resume` within that time would supersede a connection heard within 25 s, so the guard (A3-07) refuses it with the generic `unauthorized`; the phone treats `unauthorized` on resume as fatal (`FATAL_RESUME_CODES`), wipes its memory-only credential and shows "This phone is no longer paired. The pairing expired." (also the wrong reason). The household must pair again. The guard itself works (b proves a thief cannot displace a live phone). Impact: availability and trust in the product on an ordinary home network, no data exposure. Recommended fix, phone side only: on a failed `auth.resume`, retry for 30 s (guard window plus margin) before concluding that the pairing is lost; a refused resume does not consume the credential and the answer is generic, so a retry leaks nothing; keep `unauthorized` fatal after that. Change the text to "Could not reconnect". Flip the `it.fails` to `it` when fixed.

**N-02 [minor] The CSP allows any `wss:` host and a `blob:` worker.** Repro: `... security/d-phone-hostile.test.ts -t N-02`. The local server header and the page's meta policy say `connect-src 'self' wss:` and `worker-src 'self' blob:`. The CloudFront policy in `infra/template.yaml` correctly names the relay host. If script injection ever happened (none is possible today: no HTML sink, `script-src 'self'`, no inline script, proven in f and e), the wildcard would let it send data to any wss host. Fix: `connect-src 'self' wss://<configured relay host>`; drop `blob:` (the Blob worklet loader is dead code in the production build, f).

**N-03 [major, pending_external] The AWS topology does not work as built.** Repro: `... security/f-static.test.ts -t N-03` (static). The phone page dials `wss://<its own host>/ws` (`apps/phone/src/config.ts`: production always uses the page host; `?relay=` exists only in the test build) and the TV builds the QR and link from the relay host. On AWS the page is served by CloudFront and the socket lives on an `execute-api` host; the template has no relay origin and no `/ws` behaviour on the distribution, and the phone build has no way to learn another URL. Pairing a phone to an AWS-hosted relay is therefore not possible as designed; the local path is unaffected. Decide: add a `/ws` behaviour and API origin to the distribution (then the CSP `connect-src` must name the page host), or give the phone build the relay URL at build time. Resolve before T10 staging.

**N-04 [closed] The TV privacy line was the revision 1 sentence.** Open at `63af0ae`, closed at `0061d83`; the test now asserts that `PRIVACY_LINE` equals the phone sentence and that the revision 1 sentence is gone from phone, TV and session-core source.

**N-05 [minor] "Cannot become a false reached" is too strong.** Repro: `... security/g-dsp-recheck.test.ts -t A1-03` (prints rates). With the shipped hysteresis rule, in my AR(1) model (silent 8 s window, floor equal to the mean, `cal_margin` 13, 20,000 seeded trials per cell): P(an accepted segment) is 0.3 %, 2.3 % and 10.2 % for sigma/rho 2.5/0.9, 3.0/0.8, 3.5/0.9, and P(the silent window is scored `reached`) is 0.015 %, 0.3 % and 2.3 %. My model does not condition on passing the quiet check, so these are upper figures for the room class; the lead's own conditioned numbers (4.4, 3.5, 16.5 % for an accepted segment) differ and I did not reproduce them. `docs/LIMITATIONS.md` says the silent window "cannot become a false reached". Fix: reword to "is very unlikely" with the figures, and add a T04 negative case "silent speaker in the real quiet room, 0 of 10 reached". My own T02 sentence had the same over-claim and now carries an erratum.

**N-06 [minor] The dev CA is valid for 3650 days.** Repro: `... security/f-static.test.ts -t N-06`; `scripts/dev-certs/make-dev-certs.sh` line 97. AMENDMENTS-REV2 A6-03 and the threat model say short-lived. It is name-constrained (critical) and the key stays on the Mac, so the exposure is a phone that keeps trusting it for ten years. Fix: 30 to 90 days, regenerated by the script.

**N-07 [minor] The phone keeps the household phrases after the TV deleted its data.** Repro: `... security/e-journey-audits.test.ts -t N-07`. After the delete flow and `room.close`, the phone page leaves the paired view but its state, editor and saved list still hold the phrases until the tab is closed (`unpair()` does not clear phrase state). Memory only, no persistence (SEC-P06 passes). Fix: clear phrase state in the same path that clears the credential.

**N-08 [major, T04] The slope criterion trusts the nominal levels the caller supplies.** Repro: `... security/j-t04-qualification.test.ts -t N-08`. `analyzeQualification` takes `nominalDb` per trial and judges each adjacent step against the difference of those labels. A 3:1 compressor measured at labels -30, -28, -26 produces measured steps of 0.67 dB against nominal 2 dB and passes C2 (|0.67 - 2| is within 2 dB). The protocol fixes the levels at -30, -18, -6 dBFS but the frozen code does not enforce them, so the A9-01 blocker can be walked around by relabelling after the fact, which is exactly what a freeze is meant to prevent. Fix: C3 must require the three nominal levels to be exactly the frozen set per stimulus.

**N-09 [major, T04] Missing or malformed negative-case results pass C7.** Repro: `... security/j-t04-qualification.test.ts -t N-09`. Protocol section 8 says "Missing results fail C7". The code fails C7 only when the whole list is `undefined`. An empty list, a list without N1 and N2, `scoredReached: NaN`, a negative count, or N2 run on 1 window all pass. Fix: C7 passes only if N1 and N2 are each present exactly once, `windows` is a finite integer of at least 10, and `scoredReached` is a finite integer in 0..`windows`.

**N-10 [minor, T04] Trial validity is a caller-supplied flag.** `valid: false` removes a trial from every statistic with no reason and no count in the output. In the test, dropping the five worst of 20 trials per level lowers the SD upper bound from 1.67 to 1.41 dB (C4 limit 1.5), i.e. flips C4. The protocol relies on process (the live log written before results are read, all 45 planned trials reported). Fix: the analysis input must be the full planned trial list with a reason code per exclusion; the output must report the count and reasons and fail if the planned count is not met.

**N-11 [minor, T04] `params` can be overridden and is not echoed.** `analyzeQualification(trials, { params })` silently relaxes any criterion (test: step tolerance 12 dB lets 3:1 compression pass) and the result does not record which parameters were used. Fix: ignore the option or echo the parameters and fail unless they equal `QUALIFICATION_PARAMS`.

**N-12 [minor] A paired TV can chain measurement windows without a budget (TM-G1 only partly met).** Repro: `... security/d-phone-hostile.test.ts -t N-12` (a recorded behaviour, not a failure of the test): after Yes and Start mic, a raw TV had 15 consecutive windows applied (75 level frames sent). The phone's gate (`runGate`, controller.ts) checks session, one active run, page visible and mic open; durations are bounded by the protocol; there is no per-session measurement budget, cooldown or idle limit, which my threat model proposed (TM-G1). Data exposed is level and voice-activity timing only, with the Measuring badge visible; a stolen TV credential or a hostile relay (R1) could use it to watch ambient sound for as long as the page is open and visible. Fix: a per-session measurement budget (start at 5 minutes), a cooldown between windows and an idle mic timeout; or accept in writing.

**N-13 [minor, T04] The freeze hash does not cover everything the criteria depend on.** `freeze_hash.py` hashes the protocol (without the Approval block) and `qualification.ts`; `qualification.ts` imports `percentile.ts` (the nearest-rank median), which is not hashed. The verdict function that decides what counts as `reached` in N1 and N2 is recorded by commit in the session record but not hashed. Fix: add `percentile.ts` to the hash; keep the verdict-function commit in the record (the protocol already requires it).

**N-14 [info] The ADR-0002 body still quotes the revision 1 privacy sentence.** `docs/adr/0002-privacy-and-transmitted-data.md` line 25. Its header points to the amendments, which win, so nothing ships wrong; a reader of the ADR alone is misled.

## 5. SEC-* checklist: what was executed

Status words: **executed**, **executed in part** (what is missing is stated), **not executed**, **pending_external** (AWS or device), **not implemented** (the check has no subject because the control does not exist).

| ID | Status | Where, and what is missing |
|---|---|---|
| SEC-A01 | executed | a: all 37 types before authentication |
| SEC-A02 | executed (local); AWS pending_external | a: 6th message, 5 s deadline; c: 65 s pending join. API Gateway timers: A3-09 |
| SEC-A03 | executed in part | c: delay, valid-code budget, connection budgets, live-room cap from one source. Not run: many sources, IPv6 /64 rotation, shared-NAT user |
| SEC-A04 | executed | f: chi-square over 200,000 codes and digits, credential length and uniqueness |
| SEC-A05 | executed in part | b: single use, refresh, burn. Not run: logical expiry at 10 min (real process, real clock) |
| SEC-A06 | executed in part | b: 5 two-phone races, double accept. Not run: 1,000 iterations, accept at the expiry boundary, stale join_id |
| SEC-A07 | executed | b, i |
| SEC-A08 | executed | b, e |
| SEC-A09 | executed | b |
| SEC-A10 | executed in part | b: unpair (close 4410), room.close. Not run: message in flight after unpair, credential expiry mid-session |
| SEC-A11 | executed (local); AWS pending_external | c |
| SEC-A12 | executed in part | a: 37 types by 2 roles, cross-room. Not run by me: the 10,000-message, 20-room soak; the relay implementers' `services/relay/test/core.isolation.test.ts` runs it on both stores (read, not reviewed in depth) |
| SEC-A13 | executed | a |
| SEC-A14 | executed in part | f constants; d the phone returns to pairing; TV terminal codes by code review |
| SEC-V01 | executed | f and the probe script (236 rows) |
| SEC-V02 | executed | a (binary 1003, text only), f (adapters call processInbound) |
| SEC-V03 | executed | a |
| SEC-V04 | executed | probes P01 to P17, g |
| SEC-V05 | executed | probes (text policy rows) |
| SEC-V06 | executed | probes, e (quantised values on the wire) |
| SEC-V07 | executed | a: 8,193 bytes (close 1009), no deflate; k: phone 60 per second burst, TV 40, close 4429 after 120 strikes |
| SEC-V08 | executed | k: 1,000,000 mutated frames, 7,215 accepted, 0 exceptions, slowest parse 10.0 ms (limit 25 ms), no echo in `detail`, no prototype pollution |
| SEC-P01 | executed | e: frames audited in one journey (fields, no audio or base64, quantised, levels only inside TV-started windows), no third-party request, no browser API that can carry audio |
| SEC-P02 | executed (local); staging pending_external | e: closed-vocabulary log lines, no secrets, no addresses, no echo |
| SEC-P03 | executed | f |
| SEC-P04 | executed | f |
| SEC-P05 | executed | f: static scan and the production bundle |
| SEC-P06 | executed | e |
| SEC-P07 | not executed | the relay under test keeps its store in process memory and is a black box; the DynamoDB attributes were read, not observed: pending_external |
| SEC-W01 | executed | e (phone page), h (TV web preview); the Vega text component is pending_external |
| SEC-W02 | executed (local, IaC); staging pending_external | d, f |
| SEC-W03 | executed | d |
| SEC-W04 | executed | d |
| SEC-W05 | not executed | needs a physical phone (B-002); the synthetic build is not evidence |
| SEC-W06 | executed in part | d: nothing before `session.begin`; N-12 records the missing budget, cooldown and idle limit |
| SEC-W07 | executed | d |
| SEC-T01 | executed | f |
| SEC-T02 | executed | e |
| SEC-T03 | executed | e |
| SEC-T04 | executed | e |
| SEC-T05 | executed | e |
| SEC-T06 | executed in part | phone console errors none (e), relay logs clean; TV and device logs on the VVD not run |
| SEC-T07 | not executed | no flood against the TV; `frame_index` must increase strictly (machine.ts 1391) and the relay rate limit (k) bounds what reaches the TV |
| SEC-T08 | executed in part | k: relay cue cap; first-response-wins and TV cue state by code review |
| SEC-T09 | not executed | needs the VVD (T17) |
| SEC-I01 | executed | f (template read, no AWS call) |
| SEC-I02 | pending_external | anonymous bucket access |
| SEC-I03 | pending_external | load test, alarms, kill switch |
| SEC-I04 | pending_external | GoneException, 2 h re-dial, missed `$disconnect` |
| SEC-I05 | executed in part | f, section 2 rows 10 to 12; not run: install-script review, build hash |
| SEC-I06 | executed | section 2 row 13 |
| SEC-I07 | executed | c (production refusals), f (CA constraints); N-06 |
| SEC-I08 | pending_external | AWS deadline equivalence |
| SEC-I09 | executed | a |
| SEC-M01 | executed | probes, g |
| SEC-M02 | not implemented | the TV does not compare the level stream with the window summary (A1-09 was decided as an internal-consistency recompute; R11 stands) |
| SEC-M03 | executed | g; N-05 |
| SEC-M04 | executed | g |
| SEC-M05 | executed | g |
| SEC-M06 | executed in part | j: the slope criterion fails 3:1, 2:1 and 1.5:1 series. Not run: the session-core transition to failed and the hidden band verdicts |

Threat-model gaps: TM-G1 partly met (N-12); TM-G2 met (processInbound, f); TM-G3 met (h, i); TM-G4 met locally (d, f; N-02); TM-G5 and TM-G6 pending_external (throttles and secrets by template reading only: f); TM-G7 decided (rotation shipped, protocol revision 4).

## 6. Residual-risk register

Update of the T02 register (R1 to R13) plus the new items. "Owner" is the person who must accept or fix.

| ID | Risk | Status after T16 | Owner |
|---|---|---|---|
| R1 | A compromised relay operator sees all payloads and can forge both roles; no end-to-end authentication | unchanged, accepted and disclosed; canonical forwarding confirmed (a), no E2E key agreement exists | lead |
| R2 | A compromised TV process holds the TV credential | reduced: 2 h lifetime with rotation; reuse closes the room (b) | lead |
| R3 | AsyncStorage is unencrypted | unchanged; no phrase text in summaries (e); the phrase bank persists until deleted (disclosed in About) | lead |
| R4 | Covert channels in permitted fields | reduced by quantisation and the audio guard (e, probes); not eliminated | lead |
| R5 | TV speech or VoiceView during a window counts as voice | unchanged; suppression and the 3000 ms lead shipped; T17 measures | qa |
| R6 | Per-source limits behind shared NAT | delay instead of block shipped (c); tuning at staging | relay |
| R7 | The pairing code is visible on the TV | reduced by number matching and burn on reject (c, i) | lead |
| R8 | Non-browser attackers forge Origin | unchanged; credentials and TV confirmation are the control (c) | lead |
| R9 | Hermes `normalize` unverified | self-test shipped; real behaviour pending_external | tv |
| R10 | API Gateway, WAF and CloudFront limits unverified | unchanged, pending_external | relay |
| R11 | A paired malicious phone fabricates results | unchanged: recompute checks internal consistency only, no stream cross-check | lead |
| R12 | A user CA on the phone widens its trust | name-constrained yes, short-lived no (N-06) | lead |
| R13 | Denial of wallet | throttles and reserved concurrency verified in the template only; load test pending_external | relay |
| R14 | Half-open reconnect refused, pairing reported lost (N-01) | new, major, fix recommended | phone |
| R15 | 60 s grace after a lost `auth.ok`: a thief with the consumed credential gets the next credential, and the owner still resumes (b; SECURITY-NOTES.md section 2) | new, documented by the relay owner, confirmed by test | relay |
| R16 | T04 analysis holes (N-08 to N-11, N-13) | new, major, blocks T04 | dsp |
| R17 | A paired TV can chain windows with no budget (N-12) | new, minor | phone, session |
| R18 | `apps/tv` has 70 advisories (5 critical) in React Native and Vega build and CLI tooling | new, accepted exception recorded by the lead; none of the 27 bundled packages carries an advisory of its own (four Amazon packages appear only through their dependency chain). Re-audit at every SDK bump | lead |
| R19 | CSP `connect-src` allows any `wss:` host (N-02) | new, minor | relay, phone |
| R20 | A silent window can be scored `reached` in the noisiest admissible rooms (N-05) | new, minor, wording fix | dsp |
| R21 | The phone keeps phrases in memory after the TV deletes (N-07) | new, minor | phone |
| R22 | AWS topology cannot pair a phone (N-03) | new, major, pending_external | relay, infra |
| R23 | Two dev-only vitest moderates (GHSA-82fw-gwwq-j7x9) remain after the 3.2.7 bump (release-docs, SUPPLY_CHAIN.md); the root runtime audit is clean | new, accepted for development use | lead |

## 7. T04 qualification protocol (`docs/evaluation/T04-protocol.md`, revision 2): decision

*Superseded for revision 3 by section 11: the changes below were made and revision 3 is approved. This section is kept as the record of the revision 2 rejection.*

**REJECTED as frozen. Required changes are below; a revision 3 with them is expected to be approvable.** No trial has run (B-002), so rejecting costs only a re-freeze. I did not fill the Approval block: `docs/evaluation/` is outside my write paths, and a rejection is not an approval to record there. The lead should paste the values in the next table.

What I checked and found sound: the freeze hash at `da018d7` reproduces EV-0030 exactly (`3ba1fdff...d820`; protocol hashed without its Approval block, plus `qualification.ts`); the statistics are as printed (chi-square(14) 5th percentile 6.5706, factor 1.4597, SD estimate at most 1.03 dB; verified in `j`); C2 fails 3:1, 2:1 and 1.5:1 compression on the frozen levels; C1, C3, C4, C5 and C6 fail on the honest defects I tried (14 repeats, one clipped frame, AGC `true`, `null` or missing, a falling series, scatter above the bound); the protocol keeps the experiment offline, records numeric traces only and no audio, and states its limits. The qualification mode of the phone page that the protocol relies on does not exist yet: it needs its own review (no network, test build only, absent from the production bundle) before the first trial.

Required changes before approval (each has a failing or recorded test in `tests/security/j-t04-qualification.test.ts`; flip the `it.fails` to `it` when fixed):

1. **N-08.** C3 must require, per stimulus, exactly the three frozen nominal levels (-30, -18, -6 dBFS); any other level set fails C3.
2. **N-09.** C7 passes only if N1 and N2 are each present exactly once with `windows` a finite integer of at least 10 and `scoredReached` a finite integer in 0..`windows`; everything else fails, as the protocol's own section 8 already says in words.
3. **N-10.** The analysis takes the full planned trial list (45 per level block) with a reason code per excluded trial, fails if the planned count is not met, and returns the exclusion count and reasons.
4. **N-11.** Remove the `params` override from the verdict path, or echo the parameters and fail unless they equal `QUALIFICATION_PARAMS`.
5. **N-13.** Add `percentile.ts` to the freeze hash (`freeze_hash.py`); keep the verdict-function commit in the session record.
6. Validate every numeric input as finite (`rel95Db`, `clippedFrames`, counts) and make a non-finite value fail its criterion explicitly.
7. Add the N-05 negative case (silent speaker in the real quiet room, 0 of 10 reached) to the protocol's section 5 as a reported value.
8. Re-record the freeze line in `.build/evidence.jsonl` after the changes and keep revision 2 and the rejection in the amendment record, as the freeze rule already requires.

Values for the Approval block, to be pasted by the lead (no approval is given):

| Field | Value |
|---|---|
| Reviewer | security (`claude-sonnet-5-5`), independent of the author (audio-dsp) |
| Date | 2026-10-05 |
| Approving commit | none: rejected at `da018d7` |
| Freeze hash | `3ba1fdff6444e079e1b2b6c6e57330c3dded1d54e884681cce4087347ef4d820` (revision 2, not approved) |
| Changes requested before freeze | items 1 to 8 above; see `docs/security/T16_GATE.md` section 7 |

I will re-review revision 3 against the same test file; the review is quick if the changes are limited to `qualification.ts`, `freeze_hash.py` and the protocol text.

## 8. Pending external checks

`pending_external` means the check needs AWS (owner authorisation and a non-root path, B-003) or a physical device. Nothing in this list was attempted.

**AWS (staging):** A3-09 and SEC-A02 and SEC-I08 (the 5 s and 65 s deadlines through the SQS delay queue, the close behaviour seen by the client); A3-08 and SEC-A11 on API Gateway `$connect`; WAF on a WebSocket API (R10); SEC-I02 (direct bucket URL 403); SEC-I03 and TM-G5 (throttles in a load test, alarms, kill switch once); SEC-I04 (GoneException, 2 h re-dial, missed `$disconnect`); SEC-P02 staging log inspection, SEC-P07 relay storage audit, A2-03 and A2-05 runtime behaviour (counters, TTL, logs, X-Ray, access logs); SEC-W02 on the real CloudFront distribution; A3-10 against real DynamoDB conditional writes; TM-G6 (secret handling and a non-root deployment role); N-03 (topology), which is a design decision first.

**Device (VVD, T17):** A8-04 (VoiceView timing, lead, speech rate, build); SEC-T09 (Unicode and bidi rendering on the TV); SEC-W01 on Vega's text component; PK-12 (`String.prototype.normalize` on Hermes); the TV About text on the device.

**Real phone (B-002):** SEC-W05 (microphone lifecycle: tracks stopped, wake lock released); all of T04; the phone page's CSP and headers on Android Chrome (only desktop Chrome 154 was used); iOS Safari (`connect-src 'self'` handling differs from the explicit `wss:`).

## 9. Limits of this gate

- Single host, desktop Chrome 154, Node v25.2.1 (the project targets Node 22 to 24); one relay process per test, real clocks; no fake-clock tests of expiries.
- Black-box tests cover the local relay only. The AWS adapter was reviewed by reading the template and the adapter header comments; the implementers' fake-DynamoDB tests ran as part of root `npm test` but I did not review them.
- The TV is the headless session core or the react-native-web preview, not Vega.
- Besides my own tests I re-ran the unit suites through root `npm test` (section 2, row 14: relay, DSP, session-core, phone, review, protocol, ten-foot-meter). I did not re-run the strict a11y gate, the e2e scripts or the phone production script; the lead and qa report them green.
- The synthetic models (AR(1) noise, compression series) say nothing about a real room or a real phone.
- Findings I could not test dynamically (A4-04, A4-05, A4-06, A8-01) are marked "code review" in section 3; they rest on reading, not execution.
- The reviewer model identity is as stated in my system context and cannot be verified from inside the session.

## 10. Actions for the lead

1. *(Done by the lead: `npm run test:security -w @atr/tests`; see section 11.4 for the build and typecheck behaviour.)* Wire `tests/security` into `tests/package.json`, for example `"test:security": "vitest run --config security/vitest.config.ts"`. The tests expect to run from `tests/`; `tests/security/tsconfig.json` exists; the suite takes about 4 to 5 minutes (a 65 s pending-join test and a 40 s half-open test are in it).
2. Record this gate in `.build/evidence.jsonl` (I may not edit it). Suggested line: task T16, requirement_ids R-S1 to R-S6, R-X1, R-X2, R-ST1, R-M6, R-Q1, check "security and privacy gate against `build/across-the-room` at `da018d7`", observed "pass with residuals; 113 tests in 11 files, exit 0; probes 236 rows, 0 FAIL; protocol 921 tests; N-01, N-03, N-08, N-09 open; T04 protocol rejected", evidence_class automated, reviewer security, limitations "no AWS, no real phone, no VVD; desktop Chrome 154; section 9".
3. Decide N-01, N-03, N-08, N-09 (fix or accept in writing); send revision 3 of the T04 protocol and `qualification.ts` back for re-review.

## 11. Follow-up, 2026-10-05, after the lead's decisions

Head: `0353f105d767c885fc9bbb24f061f4b7ab2aa5ee` (`build/across-the-room`; `wt/security` fast-forwarded from `ba3ae0b`). Evidence class unchanged: automated and documentation_only; nothing real_phone, real_VVD or AWS.

### 11.1 T04 protocol revision 3: APPROVED

Reviewed: `docs/evaluation/T04-protocol.md`, `packages/phone-mic-meter/src/qualification.ts`, `packages/phone-mic-meter/src/percentile.ts`, `fixtures/dsp/tools/freeze_hash.py`, frozen at `c935e48dc7f7ae6697871171bdbaff6231ad3c86`. The three hashed files are byte-identical at `0353f10` (`git diff c935e48 0353f10` over them is empty).

Verified (not taken from the author's notes):

| Check | Result |
|---|---|
| Freeze hash | `python3 fixtures/dsp/tools/freeze_hash.py` gives protocol `695f1cdd...b715`, qualification `73b5e651...44b0`, percentile `9845289d...78b0`, combined `b9b931007711a5e491c38dd295c2bedaca437887dcab1a5ea320327abdb99c66`, equal to EV-0046; the protocol is hashed up to the Approval block; recomputing from `git show c935e48:...` gives the same file hashes |
| T16 required change 1 (N-08) | C3 requires exactly -30, -18, -6 dBFS per stimulus: closely spaced labels, shifted levels, a fourth level and a missing level all fail C3 while C2 alone would pass (test) |
| 2 (N-09) | C7 needs N1 and N2 exactly once, `windows` a finite integer of at least 10, `scoredReached` a finite integer in 0..windows; more than ten malformed shapes tried (empty list, no N1 or N2, duplicate, unknown id, non-integer, string, negative, more reached than windows, bad `blockedOrContaminated`, 1 or 9 windows, NaN, over the limit): each fails C7 |
| 3 (N-10) | the analysis takes the full planned list; closed reasons `blocked`, `disturbed`, `interrupted`, `capture_fault`; C3 fails on a missing, extra, uncounted, doubly counted or three-attempt slot and on a reason outside the set; the output reports slots, entries, exclusions by reason and the unrecognised count; clipping in an excluded attempt still fails C5 |
| 4 (N-11) | a params object that differs is ignored for the computation, flagged (`paramsAccepted` false, criterion `PARAMS` fails) and the frozen parameters are echoed; passing the frozen object is accepted |
| 5 (N-13) | `percentile.ts` is in the hash; the verdict function stays outside it and its commit goes in the session record (stated in the protocol, the tool and the limitations) |
| 6 (finite inputs) | NaN, Infinity and null in `rel95Db`, a malformed clipped count and a NaN nominal level each fail the criterion they feed; nothing is skipped |
| 7 (N8) | added as a reported case; the 80-trial negative-case order table regenerates exactly from the stated algorithm (`mulberry32`, base seed 20261011, k = 0, 80 distinct codes, longest same-condition run 2); the accepted seeds of the level blocks (k = 2, 0, 2) and the VAD block (k = 0) reproduce |
| 8 (re-freeze) | recorded as EV-0046 |
| Noise figures quoted in the protocol (0.015 % to 4.8 %) | agree with `docs/MEASUREMENT.md`; the dsp owner's model (floor estimated from a 5 s quiet check) gives higher rates than my N-05 model (up to 4.8 % against 2.3 % per silent window at sigma 3.5, rho 0.9); I accept theirs as the better estimate |
| Tests | `j-t04-qualification.test.ts` 18 tests pass; `@atr/phone-mic-meter` 497 tests pass (root `npm test`) |

**The dsp owner's edits to `j-t04-qualification.test.ts`.** N-08 and N-09 were flipped to plain `it` with their bodies unchanged: faithful, but they only asserted `status === 'failed'`, which would also pass if the analysis failed for an unrelated reason. I strengthened them to name the criterion that refuses: C3 for N-08 (with C1 and C2 still passing), C7 for N-09 (with C1 to C6 passing). N-11 is faithful: the override is ignored, flagged and echoed, as I recommended; I added the accepted-when-identical case. N-10 is faithful for the variant I wrote (20 unslotted attempts per level, the 5 worst dropped; C3 now fails and the 30 exclusions are counted with their reason), but its title, "cherry-picking by exclusion fails C3", over-states what is prevented: see R24.

New observations (none blocks approval):

- **R24 [minor residual, the largest remaining integrity gap of T04] The exclusion reason is self-declared.** A slot may carry one excluded first attempt and a counted re-run, and the analysis cannot check a `disturbed` note against the live log. Through the real analysis (`j`, 300 seeded replications): with a per-trial scatter of 1.0 dB, C4 passes honestly in 8 % of runs; re-running the 4 worst attempts per level as `disturbed` (24 of 90 attempts, fresh draws from the same distribution) passes in 75 %. A separate simulation shows a cap would not close this: re-running only 2 attempts per stimulus (greedy, worst cell first) lifts the pass rate from 5 % to about 50 %, 4 to about 85 %. I therefore do not ask for a cap. What reduces it, and what I will require when I review the qualification-mode harness (T04A): derive `blocked`, `capture_fault` and `interrupted` from the unmodified numeric traces by script, not by hand; write the live log with machine timestamps that must precede the result; print every excluded attempt with its value and a first-attempts-only sensitivity run next to the primary result (informational, no re-freeze needed).
- **N-15 [info]** `id in params.negativeCaseLimits` is true for inherited properties, so an extra record with the id `constructor` or `toString` is not refused as unknown (the protocol says no id may be unknown). It cannot change a gated result (`j` pins this). `Object.hasOwn` would close it; changing it changes the hash, so fix it only if a revision 4 happens for another reason.
- **N1 and N2 are vacuous where the gate does its job.** A window the gate blocks is not scored, so all ten windows blocked passes the 0-of-10 limit. That is the A9-03 decision. It means N8 is the only silent-speaker case that exercises the scoring path.
- Entries carry no trace identifier, so duplicated entries pass as arithmetic; the protocol relies on the unmodified numeric traces and their hashes (recorded in `j`).

### 11.2 N8: keep it a reported value

Keep it reported for revision 3; do not gate it. Reasons: (1) its rate is set by the room, not the phone. The dsp owner's table gives P(silent window scored `reached`) of 0.04 %, 0.77 % and 4.8 % at noise spreads 2.5, 3.0 and 3.5 dB, so a 0-of-10 limit would fail about 0.4 %, 7 % and 39 % of such rooms, while qualification is stated per phone description. (2) A limit of 0 is a guess made before any data, and the freeze rule forbids tuning it afterwards. (3) The information is not lost: N8 is recorded for every phone and shown with the result, and `docs/LIMITATIONS.md` no longer claims zero. Consequence to accept explicitly: a phone can be `passed` with N8 reached in some of its 10 windows (`j` pins this; it must change with any revision that gates N8). If you want N8 to matter, the least invasive design is for N8 above 0 to set `limited: noise-sensitive` without failing C7 (a revision 4, not required).

### 11.3 Approval block values for revision 3 (to be pasted by the lead)

| Field | Value |
|---|---|
| Reviewer | security (`claude-sonnet-5-5`), independent of the author (audio-dsp) |
| Date | 2026-10-05 |
| Approving commit | `c935e48dc7f7ae6697871171bdbaff6231ad3c86` (the three frozen files are identical at the integration head `0353f105d767c885fc9bbb24f061f4b7ab2aa5ee`) |
| Freeze hash | `b9b931007711a5e491c38dd295c2bedaca437887dcab1a5ea320327abdb99c66` (equal to EV-0046) |
| Changes requested before freeze | none. Recorded residuals R24 and R25 (section 11.5) and the N-15 note. Before the first trial the qualification-mode harness needs its own review (T04A) |

The approval covers the protocol, the analysis and the freeze procedure only. It does not cover the harness that will produce the trial list, which does not exist yet.

### 11.4 `tests/security` typecheck at the integration head

Cause: not my files. `packages/*/dist` is git-ignored, and a worktree that has not rebuilt after a merge holds an older session-core whose `dist/contract.d.ts` has no `choices` on `joinRequest`. I reproduced the reported errors exactly by deleting that one line from `dist/contract.d.ts`: `e-journey-audits.test.ts(170)`, `i-tv-store.test.ts(75, 84, 85, 103)` and also `tests/src/journey.ts(48)`. The last is a shared file outside my paths, so editing my two files could not have fixed a stale build. With a fresh build (`npm run build`) the suite already typechecked at the head (exit 0).

Fix, inside `tests/security` only:

1. `tests/security/tsconfig.json` maps `@atr/protocol`, `@atr/session-core` and `@atr/phone-mic-meter` to their `src/index.ts`, so `tsc` no longer depends on built output. Verified: exit 0 with a deliberately stale `dist` and with a fresh one.
2. `tests/security/global-setup.ts` (wired in `vitest.config.ts`) builds protocol, phone-mic-meter, session-core and relay once before the suite, so the run-time code is never stale either (set `ATR_SEC_SKIP_BUILD=1` to skip). The other typechecks in `tests/` (`tsconfig.json`, `review`, `a11y`) still read `dist`: build before typechecking, as CI order already implies.

### 11.5 Results at `0353f10`

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git merge --ff-only build/across-the-room`, `npm ci`, `npm run build` | 0 | head `0353f10` |
| 2 | `npx tsc -p security/tsconfig.json --noEmit` (in `tests/`) | 0 | also 0 with a deliberately stale `dist` |
| 3 | `npm run typecheck` (root) | 0 | all workspaces |
| 4 | `npx vitest run --config security/vitest.config.ts --reporter=verbose` (in `tests/`) | 0 | **11 files, 123 tests passed**, 260 s including the global build; 5 are `it.fails` records of open findings (N-01, N-02, N-03, N-06, N-07) |
| 5 | `npm run test:security -w @atr/tests -- security/j-t04-qualification.test.ts security/f-static.test.ts` | 0 | 44 tests; the wired script works with the global setup |
| 6 | `npm test` (root) | 0 | 3,592 passed, 2 skipped: protocol 921, phone-mic-meter 497, ten-foot-meter 49, session-core 392, relay 1,111 (+2 skipped), phone 459, tests/review 163 |
| 7 | `python3 fixtures/dsp/tools/freeze_hash.py` | 0 | `b9b93100...9c66` |
| 8 | orders check (`mulberry32` regeneration of the printed tables, script in my scratch) | 0 | negative-case block equal; accepted seeds equal |

Status of the T16 findings at `0353f10`: closed and verified: N-04, N-05 (wording in `docs/LIMITATIONS.md` and `docs/MEASUREMENT.md`), N-08, N-09, N-10, N-11, N-13, N-14. Routed and not yet in the head (their tests still record the defect and pass as `it.fails` or as a recorded behaviour): N-01, N-02, N-03 (the TV half, `phonePageOrigin`, is merged; the phone build still dials its own host), N-06, N-07, N-12. When each fix lands its `it.fails` will fail loudly: flip it to `it`.

Residual register additions: **R24** self-declared exclusion reasons (section 11.1; owner dsp and the T04A harness); **R25** N8 is a reported value, so a phone can be `passed` with a nonzero N8 (section 11.2; owner lead). R16 is closed: the five T04 analysis holes are fixed; R24 and R25 replace it.

## 12. Residual closure after the phone and relay fixes (2026-10-05)

Head `15f345b` (the phone fixes `3a3110c` and the relay fixes `c2f779e`, merged; `wt/security` fast-forwarded from `bd571f2`). Evidence class automated and documentation_only; nothing real_phone, real_VVD or AWS.

### 12.1 Closure status

| ID | Status at `15f345b` | Evidence and what remains |
|---|---|---|
| N-01 half-open reconnect | closed | `d` (raw TV, half-open proxy, real phone page): the phone's resumes were refused with the generic `unauthorized` while the relay held the old socket (7 resumes, 6 refusals, 1 `auth.ok`), the same credential was presented until one succeeded (a refusal does not consume it), the refusal text says nothing about why, the page never showed "no longer paired" and the link came back (the test takes 38 s). Remains: a credential that really was revoked also gets 30 s of retries (about 7 attempts, under the 10 per minute per-room resume limit) and then "Could not reconnect", which is honest |
| N-02 CSP | closed | `d` and `c`: the server header and the page's meta policy, parsed per directive; the relay's `connect-src` follows `ATR_RELAY_ORIGINS` exactly (this origin, its own wss origin and the configured origins verbatim, no scheme-only source, `worker-src 'self'`); seven unsafe relay-origin configurations are refused at start. See 12.2 (a) for why the earlier check could not have failed |
| N-03 topology | closed in the repository; deployment pending_external | phone: `f` builds the production page for real (relay URL baked into the bundle and the page's CSP; unset gives `'self'` only; six bad values fail the build); TV: `i` real store against a real relay (QR and link are `<phonePageOrigin>/#code=<CODE>`, fragment only, the relay host and port are not in it, an invalid origin falls back to the relay origin and never to the rejected value; 20 invalid shapes refused); template: `f` (outputs `RelayWssUrl` and `PhonePageOrigin`, CSP host equals the output host, both functions allow the CloudFront origin). Not verified: a real CloudFront page opening a real API Gateway socket with its own `Origin`; a phone bundle is stage-specific (infra/README.md) |
| N-06 dev CA | closed | `f`: the CA is valid 90 days, the server certificate never outlives it (89 days) and the name constraints remain |
| N-07 phrases after delete | closed | `e`: after the TV deleted and closed the room, a scan of the whole phone DOM (text, every control value, every attribute) finds none of the six household phrases, and the same phrases were present while paired (positive control); the unpair and discard paths are covered by the phone package's `phrase-clearing` tests (run in root `npm test`) |
| N-12 measurement limits | closed with a residual (R26) | cooldown (`d`), budget (`slow/n12-budget`, real time) and idle limit (`l`, page clock) each verified black box, see 12.2 (c); R26 below |
| N-04, N-05, N-14 | closed earlier | section 11.5 |
| N-15 | open, info | unchanged; changes the T04 hash, so only with a revision 4 |

### 12.2 The three points you asked me to check

**(a) The N-02 meta-policy check was vacuous: confirmed, and fixed.** It cut the policy with `split(/\s+/)` after a regex that ran to the closing quote, so a source followed by a semicolon (`wss:;`) never equalled `wss:`. I replaced it with a parser that splits on `;` first, applies the same rules to the server header and to the page's meta policy, and proves itself against the revision 1 policies it must flag (`wss:;` hiding behind the semicolon, `blob:`, `ws:`, a wildcard host, a bare `*`). The first run of the new check failed on the production page in my worktree: `apps/phone/dist` was stale and still said `connect-src 'self' wss:`. `tests/security/global-setup.ts` now builds the production phone page (without a relay URL from the environment) as well as the packages, so the suite cannot read a stale page again.

**(b) The N-01 rig: the diagnosis was incomplete.** I ran the two variants separately. With the heartbeat but without loopback relay origins the test fails exactly as reported (the raw TV waits for `join.requested` and times out, because the phone page cannot open a socket to the proxy's random port: the relay's CSP no longer allows any `wss:` host). With loopback relay origins (`ATR_RELAY_ORIGINS=wss://localhost:*,wss://127.0.0.1:*`, as `tests/src/e2e-env.ts` now sets) but without the heartbeat, it passes. So the cause was the CSP in my rig, not a missing heartbeat. I fixed both (the heartbeat is kept because a real TV sends one) and added wire assertions that prove the retry path, not just the end state.

**(c) The N-12 rewrite is faithful, and I extended what is verified.** The phone owner's rewrite asserts the cooldown the finding asked for (5 of 15 chained windows applied, 10 refused, every refusal `rejected:cooldown`); that is what my record becomes once the control exists. I added one assertion that a refused window measured nothing: every `level` frame the phone sent belongs to an applied window. The other two limits were only claimed "by unit tests", so I verified them on the real page:

- **Budget, real time (`security/slow`, opt-in, 321 s):** ten vowel windows of 30 s were applied (30,000 ms each), the eleventh command was refused with `budget`, the person was told once ("5 minutes of listening"), a precheck was refused with `budget` too, and a first window in a session id the TV announced afterwards was applied.
- **Idle limit, page clock (`l-idle-limit`, 6 s):** the microphone was still open at 9 minutes without a TV command and off by 10 with the plain message, still paired and connected; a TV command at minute 9 kept it open at minute 18 and it went off by minute 20.

### 12.3 New residual R26 [minor]: the budget and the idle limit bound a runaway session, not a hostile TV

*Closed at `6291c90`: see section 13.*

Both limits are bypassed by the party they were meant to bound. The budget belongs to the session id the TV announces (`onSessionBegin` resets it for any new id, and the phone owner's own unit test pins that), so a TV that announces a new session id every 5 minutes starts a new budget each time; the slow test shows the first window of the new session being applied right after the old budget was used up. The idle clock restarts on any TV command, refused ones included, so a TV that sends one command every 9 minutes keeps the microphone open without end (`l`, third test, 27 minutes). What does hold: windows are at most 30 s with a 1 s pause, the page must be visible, the Measuring badge shows, and the person can stop the microphone. The data at stake is level and voice-activity timing, the same as at N-12, so I rate it minor, but the code comment that the limits mean a paired TV "cannot use the phone as an open-ended ambient-sound monitor" is not true for a TV that wants to.

Recommended fix (phone owner, not required for the gate): reset the budget only on the person's Start-microphone tap, not on a TV-announced session id, and say "Tap Start microphone to continue" in the notice. Then a hostile TV gets at most one budget per tap, and the idle limit is only a convenience. The cost is that someone who keeps the microphone open across several sessions must tap again after 5 minutes of listening in total.

### 12.4 Changes to `tests/security`

- Plain `it` everywhere: no `it.fails` remains (`grep` over `tests/security`). N-01, N-02, N-03, N-06 and N-07 were flipped; N-03 and N-06 were strengthened (see 12.1).
- `d`: the N-02 parser and its self-test; N-01 with the relay origins, the heartbeat and the wire assertions; the N-12 no-measurement-on-refusal assertion.
- `c`: seven refused relay-origin configurations and the header-follows-configuration test. `i`: the TV half of N-03. `e`: the whole-DOM scan for N-07. `f`: N-06 (server certificate) and N-03 (real production builds, template).
- New `l-idle-limit.test.ts` (3 tests, page clock) and `slow/n12-budget.test.ts` with `vitest.slow.config.ts` (opt-in, about 5.5 minutes: `npx vitest run --config security/vitest.slow.config.ts` from `tests/`; not part of `npm run test:security`).
- `global-setup.ts` builds the production phone page; `tsconfig.json` includes the phone's vite typings (the phone config now reads `import.meta.env`).

### 12.5 Results at `15f345b`

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git merge --ff-only build/across-the-room` | 0 | `15f345b` |
| 2 | `npm run build`, `npm run typecheck` (root), `npx tsc -p security/tsconfig.json --noEmit` (in `tests/`) | 0, 0, 0 | |
| 3 | `npx vitest run --config security/vitest.config.ts --reporter=verbose` (in `tests/`) | 0 | **12 files, 129 tests passed**, 278 s including the global build; no skipped test, no `it.fails` (per file: a 15, b 13, c 11, d 9, e 15, f 26, g 9, h 2, i 4, j 18, k 4, l 3) |
| 4 | `npx vitest run --config security/vitest.slow.config.ts` (in `tests/`) | 0 | 1 test, 321 s (budget in real time, R26) |
| 5 | `npm test` (root) | 0 | 3,712 passed, 2 skipped: protocol 921, phone-mic-meter 497, ten-foot-meter 49, session-core 392, relay 1,135 (+2 skipped), phone 555, tests/review 163 |
| 6 | `python3 fixtures/dsp/tools/freeze_hash.py` | 0 | `b9b93100...9c66`, unchanged (EV-0046, EV-0047) |

Residual register: R14 (N-01), R19 (N-02), R21 (N-07) and R12 (N-06) are closed; R17 (N-12) is replaced by R26; R22 (N-03) now means only the AWS deployment checks listed in section 8. Open findings of the gate: N-15 (info). Open residuals: R15, R24, R25, R26 and the pending_external items.

## 13. R26 closure, final residual register and final gate statement (2026-10-05)

Head `6291c90` (the phone's `0aa899f`: R26 hardening and the paced outbox QA-E2E-01; `wt/security` fast-forwarded from `16d3fd9`). I was asked not to rerun the full suite (the lead is running the full matrix at this head), so this section says exactly what I ran and what I read.

### 13.1 R26: closed

The fix: the capture budget (5 minutes, prechecks and windows) resets only in `startMic()`, which the view calls from exactly two click handlers (Start microphone and its relaxed-constraints variant); `session.begin` with a new id and `session.end` no longer reset it. The idle clock (10 minutes) restarts only when a `precheck.start` or `window.start` is accepted; `session.state`, stale and refused commands do not.

| Check | How | Result |
|---|---|---|
| Who can reset the budget | code review of `controller.ts` at `6291c90`: `resetBudget()` has one caller (`startMic`), `startMic` has two callers, both click handlers in `view.ts` | a TV message, a session id or a reconnect cannot start a new budget; the notice now tells the person what does ("Turn the microphone off and start it again") |
| Who can restart the idle clock | same review: `restartIdleClock()` is called only after an accepted precheck or window start | as stated |
| Idle clock on the real page (`l-idle-limit`, page clock, **run at `6291c90`: 4 tests, exit 0, 21 s**) | an accepted `window.start` at minute 9 keeps the microphone open at minute 18 and it is off by 19.5; a `window.start` the phone refuses (`ignored_stale:window_closed`) at minute 9 does not, the microphone is off by 10.5; an accepted `session.state` (`applied`) at minute 9 does not, off by 10.5 with the plain message; with no command it is off by 10 | R26's idle half is closed black box |
| Budget on the real page (`slow/n12-budget`, real time) | the rewrite asserts that after the budget is used up a window in a TV-announced new session id is `rejected:budget`, and that the person's Stop then Start microphone gives a new budget (an applied window). I read it against the page (selectors `#stop-mic` and `#start-mic` exist, the badge texts match the ones other tests use) and found it faithful to the finding | **not re-executed at `6291c90`**: it takes 5.5 minutes of real time and the machine is under the lead's matrix (load average 8). Its last run was at `15f345b` in the pre-fix form (R26 open). Run it once the matrix has finished: `npx vitest run --config security/vitest.slow.config.ts` from `tests/` |
| The phone owner's unit tests | `measurement-budget.test.ts` has R26 cases for new session ids, `session.end`, housekeeping commands, one command every 9 minutes and refused commands | not run by me separately at this head (they are in the lead's matrix) |

**The phone owner's rewrites of my records.** `l-idle-limit.test.ts`: faithful, with two weaknesses that I fixed. The "session.state does not keep it open" test only required that the command was acknowledged in some way, so a refusal would have passed it for the wrong reason; it now requires `applied`. There was no case for a refused measurement command; I added one (`window_closed`). I also made each test start the microphone from a known state (it turns it off first when an earlier test left it open) and the refused-command test self-contained (it runs its own measurement first). `slow/n12-budget.test.ts`: faithful (see the table).

What the fix leaves, by design: a paired TV can still obtain up to 5 minutes of capture per Start-microphone tap (windows of at most 30 s with a 1 s pause), and the microphone stays open for up to 10 minutes after its last accepted measurement start; the page must be visible and the Measuring badge shows. Only the person's tap extends that. This is the intended limit, not a defect, and the level and voice-activity timing data at stake are the same as before.

**The paced outbox (QA-E2E-01) arrived in the same merge.** I did a targeted read only, for what it could retain: the outbox and the resend map `recentCritical` hold acks and numeric results (never phrase text, cue text or labels), both are cleared when the credential is dropped (`resetOutbox(false)` in the unpair and credential paths), and a message is only queued after the join confirmation (`PRE_CONFIRM_TYPES` still applies in `submit`). This is not a review of its pacing or retry logic.

### 13.2 Final residual register (local scope)

Closed since T02 or since the first gate run: R14 (half-open reconnect, N-01), R16 (T04 analysis holes), R17 and R26 (measurement limits), R19 (CSP, N-02), R21 (phrases after delete, N-07). Reduced: R12 (the development CA is name-constrained and now 90 days), R22 (AWS topology: closed in the repository, deployment checks pending_external).

| ID | Risk | Final status | Owner |
|---|---|---|---|
| R1 | A compromised relay operator sees all payloads and can forge both roles; no end-to-end authentication | accepted and disclosed | lead |
| R2 | A compromised TV process holds the TV credential | reduced (2 h lifetime with rotation; reuse closes the room) | lead |
| R3 | The TV's AsyncStorage is unencrypted | accepted and disclosed; no phrase text in summaries | lead |
| R4 | Covert channels in permitted fields | reduced (quantisation, audio guard), not eliminated | lead |
| R5 | TV speech or VoiceView during a window counts as voice | accepted; T17 measures | qa |
| R6 | Per-source limits behind shared NAT | accepted; tuning at staging | relay |
| R7 | The pairing code is visible on the TV | reduced (number matching, burn on reject) | lead |
| R8 | Non-browser clients forge Origin | accepted (credentials and TV confirmation are the control) | lead |
| R9 | Hermes `normalize` unverified | pending_external (VVD) | tv |
| R10 | API Gateway, WAF and CloudFront limits unverified | pending_external | relay |
| R11 | A paired malicious phone fabricates self-consistent results | accepted (no stream cross-check by decision) | lead |
| R12 | A user CA on the phone widens its trust | reduced: name-constrained, 90 days, removal step | lead |
| R13 | Denial of wallet | template read only; load test pending_external | relay |
| R15 | 60 s grace after a lost `auth.ok` lets a thief with the consumed credential obtain the next one | accepted by the relay owner, confirmed by test | relay |
| R18 | `apps/tv` build and CLI tooling advisories (70, 5 critical); none of the 27 bundled packages carries one of its own | accepted exception recorded by the lead; re-audit at every SDK bump | lead |
| R20 | A silent window can be scored `reached` in the noisiest admissible rooms (0.04 % to 4.8 % per window) | documented (LIMITATIONS.md, MEASUREMENT.md); T04 records N8 | dsp |
| R22 | AWS deployment of the N-03 topology unverified | pending_external | relay |
| R23 | Two dev-only vitest moderates | accepted for development use | lead |
| R24 | T04: exclusion reasons are self-declared | open; required of the T04A harness review (mechanical reasons, machine-timestamped live log, excluded attempts printed, first-attempts-only sensitivity run) | dsp |
| R25 | T04: N8 is reported, not gated, so a phone can be `passed` with a nonzero N8 | accepted decision (section 11.2) | lead |
| N-15 | info: an inherited property name is not refused as an unknown negative-case id | open, harmless; changes the T04 hash, so only with a revision 4 | dsp |

### 13.3 Final gate statement (local scope)

**PASS WITH RESIDUALS, final, for the local scope: the local relay, the phone page and the TV session core as built, on a development machine.** At `6291c90`:

- **Findings:** all 66 T02 findings and the 14 findings of the first gate run are closed or closed-with-residual, except the two pending_external T02 items (A3-09, A8-04) and N-15 (info). No finding of blocker, major or minor severity is open. No `it.fails` remains in `tests/security`.
- **Privacy claims** in the shipped copy match what the code sends, stores and logs for the journey tested (network, storage and log audits); no audio-like payload leaves the phone; no credential, code, phrase, cue or label is logged.
- **Evidence:** my full suite last ran at `15f345b`: 12 files, 129 tests, exit 0, plus the slow real-time budget test (321 s, exit 0, in its pre-fix form). At `6291c90` I ran only the file whose behaviour changed (`l-idle-limit`, 4 tests, exit 0) and read the rest of the diff; **I have not seen a full run of the suite at `6291c90`: the lead's matrix is that run, and this statement holds if it is green.** The slow budget test should be run once at `6291c90` when the machine is free.
- **Residuals** are those in 13.2: accepted risks, T04's R24 and R25, and the pending_external items below. T04 protocol revision 3 is approved for the protocol, the analysis and the freeze procedure only (section 11); the harness that will produce its trial list needs its own review.
- **Not covered by this statement, still pending_external (section 8):** every AWS check (staging deadlines, API Gateway origin policy, WAF, throttles and load, logs and storage on the real services, CloudFront headers, real DynamoDB conditional writes, the deployed N-03 topology); every device check (VVD VoiceView timing, Unicode on the TV, Hermes `normalize`, the text component on Vega); every real-phone check (microphone lifecycle, Android Chrome behaviour, all T04 trials).
- **Evidence class:** automated (desktop Chrome 154, Node v25.2.1, local relay, headless TV), web_preview (TV UI in a browser) and documentation_only (code and IaC reading). Nothing here is real_phone, real_VVD or AWS.

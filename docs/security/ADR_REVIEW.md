# ADR review: independent security and measurement review of ADR-0001 to ADR-0009

- Task: T02 independent review (product scope and corrective ADRs); start of T16 (security and privacy gate).
- Reviewer: security (role security-review). Resolved model ID: `claude-sonnet-5-5` (Sonnet 5.5, as stated in the reviewer's system context; not independently verifiable from inside the session).
- Worktree / branch / base: `/Users/nihalnihalani/Desktop/Github/atr-worktrees/security`, `wt/security`, base commit `018bdc0`.
- Date: 2026-10-05 (Asia/Kolkata). Inputs: `docs/adr/0001` to `0009`, `docs/PROTOCOL.md` revision 2, `packages/protocol/src/**`, `packages/session-core/src/contract.ts`, `.build/requirements.json`, master prompt, teammate prompt, product audit, audio research.
- Requirement IDs covered: R-M6, R-S1 to R-S6, R-X1, R-X2, R-L2, R-Q1, R-ST1, R-U4.
- **Status after the rework wave (T16, 2026-10-05):** the findings below were decided in `docs/adr/AMENDMENTS-REV2.md` and implemented at `build/across-the-room`. The verdict on each finding against the shipped implementation (closed, closed-with-residual, open, pending_external) is in `T16_GATE.md` section 3. The text below is the original review and is kept unchanged except for one erratum (A1-03).
- Authorship: the lead wrote the ADRs. Every verdict below is a reasoned decision; where I agree I say what I checked, where I disagree I give the exact replacement text. Nothing in the ADRs was edited.

## 0. Evidence classes and limits of this review

| Class | What it covers here | What it does not prove |
|---|---|---|
| automated (synthetic) | `docs/security/probes/adr0001_sim.mjs` and `adr0001_threshold_sweep.mjs` (ADR-0001 arithmetic, VAD rules, synthetic noise); `protocol_probes.mjs` (see PROTOCOL_PACKAGE_REVIEW.md) | Real microphone behaviour, real room noise, real speech. The noise model is Gaussian per-frame dB with AR(1) correlation, not measured data. Every constant stays a product assumption until T04/T04A. |
| documentation_only | Reading the ADRs, protocol, contract and prompts; reasoning about attackers | Anything about deployed AWS behaviour. No AWS call was made (not authorised). Statements about API Gateway, WAF and CloudFront limits below are from general knowledge and are marked "verify at T10". |
| fetched reference | OWASP WebSocket Security Cheat Sheet, fetched 2026-10-05 (cached copy dated 2026-10-04) with Firecrawl | OWASP guidance is advisory; section 6 maps ADR-0003 to it point by point. |

Severity scale: **blocker** = implementing the ADR literally would make a stated requirement or product claim false or unsafe, and the affected work is already in progress or about to start; **major** = a real gap, contradiction or unsafe default that should be fixed before the owning task is accepted; **minor** = clarification, hardening or documentation. A blocker does not mean the ADR is worthless: every verdict below is accept-with-changes or accept, none is reject.

## 1. Verdict summary

| ADR | Verdict | Blocker | Major | Minor |
|---|---|---|---|---|
| 0001 Measurement contract | accept-with-changes | 0 | 4 | 6 |
| 0002 Privacy and transmitted data | accept-with-changes | 0 | 2 | 3 |
| 0003 Pairing and authentication | accept-with-changes | 1 | 6 | 5 |
| 0004 Hidden meter, listener, reveal, agreement | accept-with-changes | 1 | 2 | 4 |
| 0005 TV storage, retention, deletion | accept-with-changes | 0 | 2 | 3 |
| 0006 Transport, no polling | accept-with-changes | 0 | 0 | 3 |
| 0007 Runtime and toolchain | accept | 0 | 0 | 1 |
| 0008 Spoken output and quiet windows | accept-with-changes | 0 | 2 | 2 |
| 0009 Measurement modes, Listener Edition | accept-with-changes | 1 | 2 | 3 |
| **ADR total** | | **3** | **20** | **30** |

Blockers (3): **A3-01** phone-side pairing confirmation and QR/link entry (reverse confused deputy leaks phrases and mic activity to an attacker-run room); **A4-01** invalid windows on hidden attempts reveal level-derived information before the speaker rating; **A9-01** the proposed qualification criteria pass an AGC-compressed microphone (a failed experiment can become a pass). The package review (PROTOCOL_PACKAGE_REVIEW.md) adds 0 blockers, 2 major and 9 minor.

## 2. Inherited conflicts (master prompt section 6, "Resolve these inherited contradictions")

Numbering note: the assignment text calls these "the seven inherited conflicts from master prompt section 8", `.build/requirements.json` R-M6 says "seven", and ADR-0001's context says "four". The master prompt actually lists **eight** in section 6 (section 8 is the verification matrix). I checked all eight; R-M6's text should say eight, and ADR-0001's context paragraph is incomplete.

| # | Conflict | Resolved in | Coherent? | Remaining problem |
|---|---|---|---|---|
| 1 | Calibration admission versus noise-gate margins | ADR-0001 s4, s5 | Yes. Arithmetic verified (section 3). | A1-06 wording ("never blocks" is true only for the two inequalities), A1-08 (headroom is only 3 dB at margin 13). |
| 2 | Cough-rejection duration versus earlier voiced onset | ADR-0001 s3 | Partly. Backdated onset plus accepted-segment rule is the right structure. | A1-01: the stated property "150 ms transients are rejected" is false at most frame phases; A1-02 isolated clicks accepted. |
| 3 | Quiet observation between windows versus "samples only in windows" | ADR-0001 s2, s5; ADR-0002 table | Yes (commanded prechecks, aggregate only). | A1-07 does not say which `mic.state` value the phone reports during a precheck ("measuring" is implied by the audit, not stated); ADR-0002 does not disclose that the mic is open and analysed locally between windows. |
| 4 | Relay "never inspects payload" versus schema validation | ADR-0002 relay behaviour | Yes. | A2-05: AWS-managed logging (API Gateway execution logs, X-Ray, CloudFront logs) can contradict "no content logging" unless asserted in IaC. |
| 5 | Privacy copy versus categories actually transmitted | ADR-0002 | Mostly. Phone copy is accurate for what the phone sends. | A2-01 (device label, app version, voice-activity timing not listed), A2-02 (TV-to-relay direction undisclosed), A2-03 (address-keyed counters contradict the storage claim). Section 5 has the full inventory. |
| 6 | VAD is not a vowel classifier | ADR-0001 s3 last bullet, s9 | Yes ("voice-activity duration", AGC caveat). | None blocking. A1-07 clarifies `no_voice` for the vowel kind. |
| 7 | Screen-reader audio contaminating the far microphone | ADR-0008 | Partly. | A8-01 (only pre-window contamination is detected), A8-02 (no go-signal for VoiceView users), A8-03 (phone-side vibration and sounds). |
| 8 | One monotonic tone test does not enable cross-day trends | ADR-0001 s10, ADR-0009 | Policy yes. The qualification criteria themselves are weak. | A9-01, A9-02, A9-03. |

The product-audit table (16 rows) is also resolved in substance: AGC "cannot corrupt duration" is corrected (ADR-0001 s3), envelope binding is in PROTOCOL.md, polling storage is removed by ADR-0006, fixture history is separated by ADR-0005.

## 3. ADR-0001 measurement contract

**Verdict: accept-with-changes** (0 blocker, 4 major, 6 minor).

### What I verified independently

All figures below come from `docs/security/probes/adr0001_sim.mjs` (deterministic seeds, output in `adr0001_sim_output.txt`). The simulation implements the ADR text literally and uses no repository code.

1. **Coherence claim.** Blocking predicate `rise >= 6 or cal_margin - rise < 10`. Grid of 15,518,001 points over cal_margin in [13, 60] and rise in [-30, 3] (step 0.01): **0 blocked**. Boundary: (13, 3) not blocked, (13, 3.01) blocked, (12.99, 0) not blocked. Maximum tolerated rise: margin 13 gives 3.000 dB, 14 gives 4.000, 15 gives 5.000, 16 and above give 6.000 (the `rise < 6` term binds). So the claim holds for the two inequalities, with a fragile corner (A1-08).
2. **Nearest-rank percentiles.** `p_k = sorted[ceil(k/100*n) - 1]`: n=40 gives p95 = 38th smallest (third largest); n=100 gives p95 = 95th smallest (sixth largest); n=1 and n=2 behave as stated. The precheck therefore ignores the top two (2 s) or five (5 s) frames when judging bursts.
3. **Hangover.** "Runs of fewer than 6 consecutive non-candidate frames are bridged" means a gap of at most 5 frames (250 ms) is bridged and the 6th (300 ms) ends the segment; the ADR's parenthetical agrees. Segment end = end of its last candidate frame. `active_ms` includes bridged gaps (A1-07).
4. **6 dB versus 10 dB.** After the fix there are four distinct quantities and they no longer contradict each other: VAD candidate (6 dB over the session floor), calibration margin (p95 of active frames >= 13 dB), noise-gate margin (`cal_margin - rise >= 10`), floor drift (`rise < 6`). The inherited conflict (accept at 6, gate at 10) is gone. The residual problem is A1-03: the 6 dB candidate threshold equals the 6 dB stability tolerance of the quiet check.
5. **Calibration 400 ms versus phrase windows.** Calibration requiring `active_ms >= 400` is fine for a calibration phrase. The same rule applied to phrase windows is inconsistent with a phrase bank that accepts 1-character phrases (A1-04).

### Findings

**A1-01 [major] The accepted-segment rule does not reject "150 ms transients" as ADR-0001 s3 states.**
Evidence (sim section B: 2 s of noise floor plus one rectangular noise burst, 40 sub-frame phase offsets, sample-level 50 ms framing at 48 kHz). Fraction of phases accepted as voice:

| burst level over floor | 100 ms | 125 ms | 150 ms | 175 ms | 200 ms |
|---|---|---|---|---|---|
| +10 dB | 0/40 | 0/40 | 19/40 | 35/40 | 40/40 |
| +15 dB | 0/40 | 12/40 | 32/40 | 40/40 | 40/40 |
| +20 dB | 0/40 | 18/40 | 38/40 | 40/40 | 40/40 |
| +30 dB | 0/40 | 19/40 | 39/40 | 40/40 | 40/40 |

Cause: frame quantisation. A burst of d ms touches up to `ceil(d/50)+1` frames and a half-filled frame still exceeds +6 dB when the burst is strong. A test that places a 150 ms burst on the frame grid (phase 0) sees 3 frames and passes, so the tested claim would be false in the field.
Proposed change. Replace ADR-0001 s3 sentence "Shorter segments (for example 100 ms or 150 ms transients) are rejected and contribute nothing." with: "Bursts of 100 ms or less never produce an accepted segment. Bursts of 125 to 175 ms are accepted or rejected depending on their phase against the 50 ms frame grid and on their level (in the review simulation a 150 ms burst at +15 dB was accepted at 32 of 40 phases). Bursts of 200 ms or more are always accepted. The rule does not classify coughs." Fixtures must sweep at least 20 sub-frame offsets and two levels (+10 and +20 dB) for 100, 150 and 200 ms and assert: never accepted at or below 100 ms, always accepted at 200 ms and above, rate recorded in between. (If the team prefers "150 ms never accepted", require 5 candidate frames: the observed maximum for a 150 ms burst is 4 candidate frames; then 175 to 200 ms become phase-dependent.)

**A1-02 [minor] Non-contiguous candidate frames count towards acceptance.**
"at least 4 candidate frames (200 ms of candidate activity)" is satisfied by four isolated 50 ms clicks 100 ms apart: the sim accepts them as one segment of 350 ms. Typing, dishes or a clap train become "voice". Proposed change: "accepted iff the segment has at least 4 candidate frames in total and a run of at least 3 consecutive candidate frames." Add a click-train fixture.

**A1-03 [major] The VAD candidate threshold (6 dB) sits inside the noise a "valid" quiet room may contain, so a silent speaker can be scored instead of rejected as `no_voice`.**
The quiet check accepts `p80 - p20 <= 6` and `p95 - floor <= 10`. A room at the edge of validity has many frames above floor+6 dB. Sim C (valid quiet room, speaker silent, 8 s phrase window, 6000 trials per cell): probability that `active_ms >= 400` (so the window is not `no_voice`):

| per-frame noise sigma, AR(1) rho | 1.5, 0.9 | 2.5, 0.5 | 2.5, 0.9 | 3.0, 0.8 | 3.5, 0.9 |
|---|---|---|---|---|---|
| P(active_ms >= 400 given silence) | 0.0003 | 0.005 | 0.104 | 0.177 | 0.392 |

A silent attempt in such a room is scored `not_reached` ("Below today's relative level band") instead of `unscored: no_voice`. It is very unlikely to become `reached` (that needs p95 of at least `cal_margin - 1 >= 12 dB`), but the scored-failure outcome is still wrong.

*Erratum (T16, 2026-10-05).* "Very unlikely to become `reached`" was an estimate, not a bound. With the shipped hysteresis rule (open at 10 dB, continue at 6 dB) the T16 simulation (`tests/security/g-dsp-recheck.test.ts`, 20,000 seeded trials per cell, `cal_margin` 13) scores a silent 8 s window `reached` in 0.015 % (sigma 2.5, rho 0.9), 0.3 % (3.0, 0.8) and 2.3 % (3.5, 0.9) of trials. `docs/LIMITATIONS.md` says it "cannot become a false `reached`"; that sentence is too strong (finding N-05 in `T16_GATE.md`). Tightening only the stability limit does not help: the sweep (`adr0001_threshold_sweep.mjs`) shows that with the stability limit at 3 dB, noise with sigma 3.5 still gives 46% false activity at T=6 because the rooms that pass are lucky samples of a still-noisy process. Raising the candidate threshold T does:

| sigma, rho (stability 6 dB) | T=6 | T=8 | T=9 | T=10 | T=12 |
|---|---|---|---|---|---|
| 2.5, 0.9 | 0.107 | 0.010 | 0.003 | 0.001 | 0.000 |
| 3.0, 0.8 | 0.173 | 0.018 | 0.005 | 0.000 | 0.000 |
| 3.5, 0.9 | 0.386 | 0.129 | 0.069 | 0.031 | 0.003 |

Proposed change: ADR-0001 s3 "Candidate frame: `rel >= 10 dB`" (equal to the burst limit of the quiet check, so the validity rule itself bounds the density of false candidates), keep the 6 dB value only as a continuation threshold if a hysteresis variant is wanted (start at 10, continue at 6). The 13 dB calibration margin stays coherent (13 > 10). Add the fixture "AR(1) noise at the edge of quiet-check validity, silent 8 s window: P(active_ms >= 400) <= 1% over 10,000 trials". Limit: synthetic model; T04 traces must re-tune T.

**A1-04 [major] Phrase windows require `active_ms >= 400`, but the phrase bank accepts 1-character phrases.**
Sim E: a voiced run of 350 ms gives `active_ms = 350`, invalid. A one-syllable phrase ("Hi", "Yes", "No") is typically at or below that, so such phrases can never be scored, silently. Proposed change: ADR-0001 s6, "no_voice (calibration: `active_ms < 400`; phrase and vowel: `segments = 0`)". Alternatively keep 400 ms and make the phone phrase editor warn "very short phrases may not register". Choose one and test it.

**A1-05 [major] A muted, blocked or hard noise-gated microphone passes the quiet check.**
Digital silence gives floor -140 dBFS, `p80 - p20 = 0` and `floor <= -30`, so the check is valid and the session floor becomes -140. Every later `rel` is about 100 dB larger than intended, calibration margin is meaningless, and any later real noise looks like a huge rise. The product doc itself warns that browser flags do not prove an unprocessed pipeline. Proposed change: ADR-0001 s2 "Invalid when `floor < -110 dBFS` (reason `silent_input`; provisional, tune at T04)", add `silent_input` to PROTOCOL.md `precheck.result.invalid_reason` and to `PRECHECK_INVALID_REASONS` (protocol revision 3, contracts owner), TV copy "The phone microphone looks muted or blocked."

**A1-06 [minor] "an unchanged room never blocks" over-claims, and ADR s5 does not say which precheck validity reasons apply to `pre_window`.**
ADR s5 enumerates coverage, clipping, non-finite and burst, but PROTOCOL.md allows `unstable_floor` and `too_loud` for both purposes. Sim: if the stability rule (`p80 - p20 <= 6`) applied to the 40-frame pre-window precheck, an unchanged marginal room would be falsely blocked in 4% (sigma 2.5, rho 0.8), 12% (sigma 3.0, rho 0) and 43% (sigma 3.5, rho 0) of cases; with the burst rule alone the false-block rate is at most 0.6%. Proposed change: s5 "A pre-window precheck is invalid only for `low_coverage`, `clipped`, `nonfinite`, `burst_noise`, `interrupted`; `unstable_floor` and `too_loud` apply to the quiet check only." Reword the coherence property: "the two margin inequalities never block an unchanged room (rise <= 3 dB); precheck validity is a separate gate." PROTOCOL.md s3.3 should carry the same sentence.

**A1-07 [minor] Definition gaps.** (i) "accepted-active frames" (for p50, p95, clipped percentage) should be defined as candidate frames inside accepted segments, excluding bridged non-candidate frames; `active_ms` includes bridged gaps; say both. (ii) s2 lists no `interrupted` reason although the protocol has it. (iii) The precheck `nonfinite` reason is unreachable (coverage < 0.90 triggers first); define "non-finite frames > 5% of frames, evaluated before coverage". (iv) s6 "no accepted activity or `active_ms < 400` for calibration/phrase" reads ambiguously for the vowel kind. (v) State that the phone reports `mic.state: measuring` during prechecks and `open_idle` between windows with frames discarded locally.

**A1-08 [minor] Headroom is thin at the calibration boundary.** A band set at margin 13 tolerates only 3.000 dB of floor rise (fridge compressor, fan speed). Not a contradiction, but T04 should check whether this is workable; the TV could show "margin NN dB" in diagnostics so a fragile band is visible.

**A1-09 [minor] The TV trusts phone-computed aggregates.** `valid`, `invalid_reason`, `expected_frames`, `duration_ms`, `coverage` are phone-reported. Proposed change to s8: "The TV recomputes validity from the numeric fields and from its own window start and stop times (expected_frames within 1 of floor(TV duration / 50), duration_ms not above `max_duration_ms` plus 500 ms); disagreement yields `unscored` with reason `integrity`." See PROTOCOL_PACKAGE_REVIEW.md PK-02.

**A1-10 [minor] `vad_floor_dbfs` range.** Protocol allows -140 to 0; ADR requires a valid session floor between -110 (A1-05) and -30. Add a refine in the schema.

## 4. ADR-0002 privacy and transmitted data

**Verdict: accept-with-changes** (0 blocker, 2 major, 3 minor).

**What I checked.** I read every message type in PROTOCOL.md section 3 and compared its fields with the ADR table (inventory in section 5). Verified: no wire message carries a verdict, a speaker rating, an agreement result or raw audio (`attempt.reveal` is `{}`; `session.state` has stage, phrase position, cue count, open attempt id). The forbidden-claims list is consistent with the audit and with schema enforcement; "validates without content logging or persistence" is coherent with the relay needing to read shapes.

**A2-01 [minor] Phone-side categories missing from the table.** `join.request.device_label` (free text, 1 to 24 code points, shown on the TV), `room.create.client.app_version` and `platform`, `mic.state.supported` and `mode`, and the timing of voice activity (the `active` flag at 20 Hz reveals when the person is speaking) are not listed. The copy is generic enough to be true ("connection details", "levels") but the table is the source for PRIVACY.md and Settings > About. Proposed change: add rows "Device label (shown on the TV during pairing)", "App version and platform (technical)", "Voice-activity timing (when you are speaking, at 20 Hz during windows)". Recommended copy: "Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV." If the lead keeps the original exact copy, put the full list on Settings > About.

**A2-02 [major] The TV-to-relay and TV-to-phone direction is undisclosed.** The ADR table is "what leaves the phone". The TV sends `session.begin` (family mode on or off, phrase count), `session.state` (practice stage, phrase position, cues used), `window.start` (including `vad_floor_dbfs`, the room noise floor) and commands, all through the relay. There is no TV-side privacy copy in any ADR. Proposed change: add a section "What leaves the TV" and Settings > About text: "This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history."

**A2-03 [major] Per-source-address counters contradict the relay storage and logging claims.** ADR-0003 s7 requires counters per source address; ADR-0002 says relay storage holds "room and connection records only" and logs carry no IP addresses. On AWS a stateless Lambda cannot keep those counters without persisting them. Either the claim or the control must change. Proposed change: add to ADR-0002 relay storage "abuse-prevention counters keyed by a keyed hash of the source address (IPv4 /32, IPv6 /64, HMAC-SHA-256 with a secret rotated daily), time-to-live at most 1 hour, count values only" and to the disclosure "temporary abuse-prevention counters derived from your network address". Also decide and state whether API Gateway access logs and CloudFront logs (both record IP and user agent by default) are disabled or truncated; OWASP recommends logging origin and IP for security events, so log them only on rate-limit and auth-failure events, hashed.

**A2-04 [minor] Per-message operational logging is a behavioural trace.** "event name, message type, byte length, role, room hash, latency" per message at 20 to 40 messages per second records when each window starts and ends. Proposed change: per-message logging only for errors and security events; aggregate counters (messages by type per minute) otherwise; log retention at most 14 days; stated in ADR-0002.

**A2-05 [minor] Platform logging must be asserted, and hosting logs disclosed.** API Gateway WebSocket execution logging with full request data, Lambda `console.log(event)`, X-Ray with payloads, CloudFront standard logs and DynamoDB point-in-time recovery all defeat "no content logging or persistence" if left on by mistake. Proposed change: ADR-0002 consequences gain "IaC assertion (SEC-I01) that execution data tracing is off, access-log format is a whitelist, X-Ray is off, PITR is off or documented, log retention is bounded; and a runtime log-capture test (SEC-P02)". Add to the disclosure: the page host records standard connection logs (address, browser type) for page loads.

## 5. Transmitted-data inventory versus ADR-0002 (item b)

| Message (direction) | Fields that carry user, device or behavioural data | ADR-0002 category | Covered |
|---|---|---|---|
| `room.create` (TV to relay) | app_version (string), platform | none | No (A2-01) |
| `join.request` (phone to relay) | pairing_code, device_label (free text) | connection details | Label not named (A2-01) |
| `join.pending`, `join.requested`, `join.accepted` | join_id, confirm_digits, device_label forwarded to TV, credentials | connection details | Yes |
| `mic.state` (phone to TV) | state, AGC/echo/noise flags, sample_rate, channel_count, supported constraints, wake_lock, visibility (page hidden or visible), mode | "Microphone state, browser-reported track settings, wake-lock and visibility state" | Yes; `supported` and `mode` implied |
| `precheck.result` | floor and percentiles, coverage, clipping counts | precheck aggregate | Yes |
| `level` (20 per second in windows) | dbfs, active flag, clipped flag, t_audio_ms | "one number per 50 ms frame plus active and clipped flags" | Yes; voice-activity timing not called out (A2-01) |
| `window.result` | percentiles, active_ms, longest_active_ms, segments, onset_ms | window summary | Yes |
| `listener.response`, `cue` | heard or not_heard, cue word (1 to 12) | listener response and cue | Yes |
| `phrases.update` | up to 10 typed phrases | typed phrases | Yes |
| `ack` | outcome, detail (free text up to 64) | none | Trivial; detail must stay a constant string |
| `session.begin`, `session.state`, `precheck.start`, `window.start`, `window.stop`, `window.cancel`, `listener.open`, `attempt.reveal`, `session.end` (TV to phone) | family_mode, stage, phrase position, cues used, vad_floor_dbfs, timing commands | not covered | No (A2-02) |
| `ping`, `pong`, `error`, `auth.*`, `peer.state`, `unpair*`, `room.close` | connection state | connection details | Yes |
| (none) | speaker rating, verdict, agreement, history | not transmitted | Verified: no payload carries them |

## 6. ADR-0003 pairing and authentication (items c, review against OWASP and master prompt section 7)

**Verdict: accept-with-changes** (1 blocker, 6 major, 5 minor).

### OWASP WebSocket Security Cheat Sheet, point by point

| OWASP guidance | ADR-0003 | Assessment |
|---|---|---|
| WSS only | WSS everywhere; ADR-0006 forbids plain ws for production | Meets; TV client must refuse `ws://` to non-loopback (SEC-T01) |
| Prefer token in the first message over WSS; keep it out of the URL | First-message `auth.resume`; credentials only in three message types | Meets |
| Until validation succeeds accept only the auth message; send no protected data | Pre-auth allowlist of four types, 5 messages | Meets in spec |
| Close on auth failure or timeout; limit unauthenticated connections | 5 s and 65 s deadlines, close 4401; no per-source concurrent connection cap | Partly; A3-03, A3-09 |
| Explicit Origin allowlist at every handshake; no wildcards or substrings | Exact match when present | Meets, with A3-08 (`Origin: null`, role binding, store at `$connect`) |
| Per-message authorization | s9 lists role, room, expiry, generation, sequence, direction, size, rate | Meets |
| Replay: timestamps or nonces, reject duplicates | message_id, sequence, generation, +-24 h sanity | Meets; see PK-08 |
| Rotate tokens in long-lived connections; re-validate sessions periodically | 12 h bearer, no rotation | Gap; A3-07, A3-11 |
| Disable permessage-deflate (CRIME/BREACH class) | not stated | Add to ADR-0006 (A6-03) |
| Size limit 64 KB or less; rate limit about 100 per minute as a starting point | 8 KB; 40 per second phone | Meets; the higher rate is justified by 20 Hz level frames |
| Idle timeout and heartbeat | ping 10 s, unknown after 25 s | Meets |
| Check that the WAF inspects WebSocket traffic | not addressed | Gap; A3-09 (verify at T10) |
| Log connect, disconnect, auth failures, rate-limit events; never log bodies or tokens | ADR-0002 | Meets in spec; A2-03, A2-05 |

Master prompt section 7 checks: credentials are never self-declared message fields (only in `room.created`, `join.accepted`, `auth.resume`; `sender_role` must equal the connection's role); the first-message option is chosen with an ADR; the Lambda authorizer limitation is acknowledged and every later message is re-authorised; the missing-Origin rule is not blanket (phone operations require an allowlisted Origin) provided A3-08 is adopted.

### Brute-force economics (22^6 codes, 10 failures per source per 10 minutes, 10-minute expiry)

22^6 = 113,379,904 codes (26.76 bits). Probability that at least one guess hits a live code during one 10-minute code lifetime, K distinct sources each making 10 guesses, L live rooms (computed, not measured):

| sources K | L=1 | L=100 | L=1000 |
|---|---|---|---|
| 1 | 8.8e-8 | 8.8e-6 | 8.8e-5 |
| 10 | 8.8e-7 | 8.8e-5 | 8.8e-4 |
| 1,000 | 8.8e-5 | 8.8e-3 | 8.4e-2 |
| 10,000 | 8.8e-4 | 8.4e-2 | 0.59 |
| 100,000 | 8.8e-3 | 0.59 | 1.0 |

About 7.9 million distinct sources are needed for a 50% chance on one specific code. A hit only creates a pending join that the TV user must accept, so the realistic impact is spurious prompts and griefing, not takeover, unless the user rubber-stamps (A3-06). The numbers are adequate for a hackathon-scale deployment; they degrade linearly with live rooms, which is why a live-room cap matters (A3-03).

### Findings

**A3-01 [blocker] Confirmation exists only on the TV, and QR/link entry is unspecified (reverse confused deputy).**
ADR-0003 s3 and s4 give the TV the only approval. A phone that joins a room created by an attacker (any script that calls `room.create`) is never asked anything: `join.accepted` arrives, and the phone UI is then free to send `phrases.update`, `mic.state` and level frames. The master prompt allows "a room code or QR", and `TvView.pairing.qrPayload` exists in `packages/session-core/src/contract.ts`, but nothing defines its content. If the QR or deep link carries the code and the phone page auto-submits it, a malicious QR or link pairs the victim's phone with the attacker's room with no decision by the victim; the attacker's own TV client accepts its own join. Typed household phrases (health-adjacent) and microphone activity then flow to the attacker. This is the one place where no human decision protects the phone side.
Proposed change (new ADR-0003 s3a): (1) QR and deep link carry the code only, in the URL fragment: `https://<phone-origin>/#c=<CODE>` (fragments are not sent to servers, CloudFront logs or Referer); never query string or path. (2) The phone page never auto-joins: it pre-fills the code field and waits for an explicit Join tap. (3) After `join.pending` the phone shows "Your TV should show the number NN. Does it?" with "Yes, same number" and "No, cancel". Until "Yes" the phone sends nothing except the join protocol and `ping`: no `phrases.update`, no `mic.state`, mic start disabled. "No" discards the credential and closes the connection. (4) Test SEC-W03 with a hostile QR.

**A3-02 [major] A rejected or abandoned join does not burn the code, valid-code joins are not rate-limited, and `pairing.refresh` is unbounded.**
ADR-0003 s7 counts only `join.request` failures. An attacker who has seen the code (it is on a TV screen, possibly in a photo or video call) can request, be rejected, and request again immediately for the full 10-minute lifetime, holding the single pending slot (60 s each time a request is left unanswered) so the real phone gets `join_busy` (griefing). `pairing.refresh` has no stated rate limit and the old code's fate is unspecified.
Proposed change: (1) a TV `reject`, or a pending join that expires unanswered, invalidates the code and the relay sends a fresh `pairing.code` to the TV. (2) `pairing.refresh` invalidates the previous code at once, is limited to 1 per 10 s per room, and a room never has more than one live code. (3) Per source address, also count valid-code joins that the TV rejects or lets expire; budget 6 per 10 minutes. (4) The global failed-join counter is an alarm, not a lock (a lock would let an attacker deny pairing to everyone).

**A3-03 [major] Per-source accounting is unsafe behind shared NAT and trivially widened by IPv6; no connection-rate or live-room limits.**
A hard block after 10 failures lets any guest on the household Wi-Fi (or a carrier-grade NAT neighbour, or all judges at one venue) lock the real user out of pairing for 10 minutes. IPv6 lets one host rotate through 2^64 addresses. `$connect` is not rate limited, `room.create` is 10 per hour per source, and the live-room count is unbounded although hit probability scales linearly with it (table above).
Proposed change: source key = IPv4 /32 or IPv6 /64 (hashed, A2-03). Replace the hard 10-minute block by exponential delay: failures 1 to 3 free, then 2 s, 4 s, ... capped at 60 s, reset after 10 minutes without failure (same cap of about 10 guesses per 10 minutes, no lockout). Add a `$connect` budget per source (start 20 per minute), a cap on concurrent unauthenticated connections per source (start 5), a global cap on live rooms (start 200, configurable), and raise `room.create` to 30 per hour per source with the global cap as the real control.

**A3-04 [minor] The pairing code is stored as plain SHA-256.** A 27-bit code hashed with an unkeyed hash is recoverable from a table dump in milliseconds, so "stored as SHA-256 hash" provides no protection against anyone who can read DynamoDB. Proposed change: HMAC-SHA-256 with a secret held in SSM or Secrets Manager (not in the template or plain environment); the HMAC value is the lookup key. Otherwise drop the implication that hashing protects the code.

**A3-05 [minor] `auth.resume` has no failure rate limit and its error codes form an oracle.** Guessing a 256-bit credential is infeasible, but unlimited failed resumes cost reads and distinguish `not_found`, `expired`, `revoked`, `unauthorized`. Proposed change: limit `auth.resume` failures per source (10 per minute) and per room_id (10 per minute), and after the lookup return one generic failure to the caller (log the specific reason server-side).

**A3-06 [major] Two digits shown on both screens do not bind a distracted user, and the label is attacker text.**
Analysis. Because only one join may be pending, a legitimate phone and an attacker cannot both show digits for the same room, so digit length does not decide the outcome. If the attacker's join is pending, the real phone gets `join_busy` and shows no digits; the digits are useful only if the user compares them. A user who presses Accept without comparing is always compromised, whether the check is 2 or 6 digits. `device_label` is chosen by the joining client and displayed on the TV ("Mom's phone"). So the problem is approval fatigue, not entropy.
Proposed change: (1) Default focus on Reject; Accept is enabled only after the user selects "The same number is on my phone: NN" or, stronger, replace display-and-compare with number matching (the TV shows three choices and the user picks the one shown on the phone; 3 digits entered with the remote is the alternative, blind success 1 in 1,000). (2) Render `device_label` as untrusted text in a "Name the phone gave: ..." line, never as identity. (3) After one reject, burn the code (A3-02). (4) `confirm_digits` from a CSPRNG with uniform draw (no modulo bias), never from the protocol package's non-cryptographic fallback.

**A3-07 [major] Supersede-on-resume lets a stolen credential take over a live phone, and there is no reuse detection or rotation.**
`auth.resume` increments the generation and closes the older connection with `superseded`. An attacker who obtained the phone credential (log leak, XSS, memory scrape) resumes first and the legitimate phone is the one disconnected; the TV sees only a generation bump. OWASP recommends rotating tokens on long-lived connections.
Proposed change: (1) A resume that would supersede a connection heard from within the last 25 s is refused (`unauthorized`); after 25 s of silence the relay treats the old connection as dead (consistent with ADR-0006 heartbeat). (2) The TV is told on every phone supersede (`peer.state` with the new generation) and shows "Phone reconnected"; a window that is open at supersede is cancelled. (3) Recommended hardening, needs protocol revision 3: `auth.ok` carries `next_credential`; each successful resume consumes the presented credential and returns a new one; presenting a consumed credential revokes the role and tells the TV "pairing may be compromised, pair again". This turns a silent hijack into a detected one at the cost of one extra field.

**A3-08 [major] The Origin policy cannot be implemented as written on API Gateway, and it has gaps.**
Origin is visible only in the `$connect` event (to my knowledge; verify at T10); `$default` events do not carry it. At `$connect` the relay does not yet know whether the client will be a TV or a phone, so a missing Origin must be admitted there, and the later "phone operations require an allowlisted Origin" rule only works if the connection record stores the origin state. Gaps: the string `Origin: null` (sent by sandboxed iframes and file pages) must be treated as present and rejected, not as absent; header names are case-insensitive; a TV web-preview origin must never be allowed to act as a phone (or vice versa); production configuration must not contain localhost or tunnel origins; `room.create` without Origin is unauthenticated, so it relies entirely on rate limits and the live-room cap.
Proposed change (ADR-0003 s8): at `$connect` reject any present Origin that is not an exact allowlist match; store `origin_state` in the connection record: `phone_origin`, `tv_preview_origin` or `absent`. Phone-role operations require `phone_origin`; `room.create` and TV `auth.resume` require `absent` or `tv_preview_origin`; `tv_preview_origin` is rejected for phone operations and the reverse; the preview origin is not in the production allowlist; header lookup is case-insensitive; `client.platform` is never used as a trust signal.

**A3-09 [major] The pre-auth deadlines and the close codes 4401 and 4429 may not be implementable on API Gateway as written. (Verify at T10; no AWS call was made.)**
To my knowledge, API Gateway WebSocket gives Lambda no per-connection timer between invocations, the management `DeleteConnection` call takes only a connection id (no close code), and AWS WAF does not attach to WebSocket APIs. If so, a 5 s authentication deadline needs an external timer (for example a delayed SQS message of at most 1 s granularity that checks the connection record and calls `DeleteConnection`), the codes cannot be chosen, and per-source concurrent-connection caps need either application counters or CloudFront with WAF in front of the WebSocket. OWASP asks to check WAF coverage of WebSocket traffic.
Proposed change: ADR-0003 gains an "AWS adapter" subsection that states the timer mechanism, that over AWS the client sees an `error` message (`unauthenticated` or `rate_limited`) followed by connection close without a chosen code, and that the local adapter must behave identically at the message level. SEC-I08 tests the 5 s and 65 s deadlines on staging.

**A3-10 [minor] Atomic claim details.** s4 says "atomically claims the single phone slot and marks the code consumed". These must be one conditional write on one item (or a transaction): slot empty, pending join id equals the confirmed id, join not expired, room not expired, code unconsumed. `join.confirm` must check that the join record belongs to the confirming TV's room. The busy case is signalled both as `join.rejected {reason: busy}` and error code `join_busy`; define which one a phone receives.

**A3-11 [minor] Credential lifetime, revocation consistency and phone tab discard.** A 12-hour bearer for a 15-minute practice session is long; recommend 2 hours renewed on resume (or the rotation in A3-07). Revocation: say that the per-message check reads revocation state with a strongly consistent read or compares a room epoch stored in the connection record, and state the accepted bound (at most one in-flight message after `unpair`). Memory-only credentials mean an Android tab discard on the phone forces re-pairing; record that as a deliberate decision (the alternative, `sessionStorage`, widens XSS exposure) so an implementer does not quietly add `localStorage`.

**A3-12 [minor] `client.platform` is self-declared.** Values `test` and `web_preview` must not change relay behaviour; the production relay should reject `test`.

## 7. ADR-0004 hidden meter, listener responses, reveal, agreement (item d)

**Verdict: accept-with-changes** (1 blocker, 2 major, 4 minor).

**What I checked.** No wire message carries a verdict or speaker rating; `attempt.reveal` carries nothing; the phone is never told which positions are hidden (positions 3, 6, 9 are derivable from the public rule, but the retry flag `meter_visibility` and `attempt_number` are TV-local and absent from the wire). The listener phase cannot invent a response: a missing answer is recorded as `missing`, late taps are stored with `late: true` and excluded from the primary denominator. Agreement eligibility matches the master prompt (both independent verdicts, matching window identity, late excluded, hidden and visible split). The session-core contract removes values from the view rather than flagging them, which is the right way to enforce blindness.

**A4-01 [blocker] Invalid windows on hidden attempts reveal level-derived information before the speaker rating.**
ADR-0004 s"Response phase": "Invalid or cancelled windows skip the response phase: they reveal immediately as 'Not scored' with the reason, and listener controls are not opened for them." For a hidden first attempt the reason is level-derived: `no_voice` means too quiet, `clipped` means too loud, `continuous_sound` and `low_coverage` describe the audio. The speaker learns "too quiet" or "too loud" before rating how it felt, which is exactly what the blind check hides. The phone learns validity too: listener controls open only for valid windows, and the TV's `ack` for an unsolicited response differs by state.
Proposed change: for a hidden first attempt, every window that closes by `window.stop`, timeout or completion (valid or invalid) enters `response_pending` with the same neutral prompt ("How did that feel?" Felt loud / Felt normal / Skip) and the same listener-open behaviour in family mode; the "Not scored: reason" appears only at reveal. Windows ended by the speaker's Cancel, `link_lost` or `interrupted` keep today's immediate path because the speaker caused them or already knows. The TV answers any listener response that it did not solicit with the same `ack` (`ignored_stale`, detail empty). Test SEC-T02.

**A4-02 [major] Crash and resume can store or replay an unrevealed hidden verdict.**
ADR-0005 persists "completed attempts" in `atr:v1:active` and says results are persisted after reveal, but a window result exists before reveal and the checkpoint may hold it for crash resume. Proposed change (ADR-0004 and ADR-0005): the checkpoint never contains a verdict, rating or window result for an attempt that has not been revealed; an attempt in `capture_closed` or `response_pending` at crash is recorded as `interrupted` and unscored on resume; the resume screen shows no result for it. Test SEC-T03.

**A4-03 [major] Side doors during `response_pending` and the meter object.**
Settings, History and Diagnostics are reachable screens; Diagnostics is a `Record<string,string>` that may show last-window values. `MeterView` carries `active: boolean`, which is level-derived. Proposed change: between capture close and reveal, `TvView.meter` is `null` (not a zeroed object), Diagnostics and History redact the in-flight attempt, and Settings is unavailable or returns to the response screen. Test: serialise every `TvView` reachable from `response_pending` for a hidden attempt and assert the absence of level, verdict and validity fields.

**A4-04 [minor] `listener.open.timeout_ms` versus the TV's 20 s offer.** The ADR does not say what the phone does at `timeout_ms` or when the speaker chooses "Keep waiting". Proposed change: the phone locks listener controls only on `attempt.reveal`, `window.cancel`, `session.end` or when `timeout_ms` elapses; "Keep waiting" sends a new `listener.open` with a fresh timeout; "Continue without listener response" records `missing` and sends `attempt.reveal`.

**A4-05 [minor] First response wins; late acknowledgement undefined.** Define: the first valid `listener.response` for an open attempt wins, later ones get `ack rejected`. PROTOCOL.md section 4 step 10 says the TV answers events for a non-open attempt with `ack ignored_stale`, while ADR-0004 stores late responses with `late: true`. Proposed change: late response is stored and acknowledged `applied` with detail `late` (no protocol change), or `ignored_stale` and not stored; the ADR must pick one.

**A4-06 [minor] `borderline` and agreement.** State that borderline attempts are eligible for agreement and included in totals, and are also counted separately.

**A4-07 [minor] Cue cap at the relay and cue timing.** A relay-side per-session cue counter needs relay state keyed by session id, and a malicious phone can invent a new session id per cue unless the relay tracks the TV's active session. Either drop the relay counter (TV is authoritative, ADR already says so) or define it as a per-room cap tied to the session id announced in `session.begin`. `cue` carries no window binding, so the TV must reject cues outside between-window states with `ack rejected`.

## 8. ADR-0005 TV storage, retention, deletion (item e)

**Verdict: accept-with-changes** (0 blocker, 2 major, 3 minor).

**What I checked.** Namespacing and prefix-only deletion are right; credentials and codes are memory-only; verify-after-delete by `getAllKeys` is the right check; future-version data is not overwritten; fixture data is separated. Unencrypted AsyncStorage is disclosed.

**A5-01 [major] "Delete local practice data" does not clean the relay or the phone.** The master prompt requires "actual local and relay cleanup". ADR-0005 removes `atr:` keys and resets memory; `unpair` is a separate action. Proposed change: Delete = (1) best-effort `unpair` and `room.close` (show "Relay cleanup confirmed" or "not confirmed"), (2) remove `atr:` keys, (3) verify with `getAllKeys`, (4) reset memory, (5) the phone receives `unpaired` or `session.end {discarded}` and clears its in-memory phrases. If verification finds any `atr:` key, say so and keep the retry button; do not report success.

**A5-02 [major] Phone-side storage is undefined.** Phrases are "saved on the phone" before being sent; ADR-0005 covers only the TV. If the phone persists phrases, a TV-side delete leaves a copy, and there is no phone delete path by design. Proposed change (ADR-0002 or 0005): the phone page persists nothing; phrases live in memory (or `sessionStorage`, cleared on `unpaired`, `session.end` and page hide) and no cookies, `localStorage`, IndexedDB or Cache API entries contain phrases or credentials. Test SEC-P06.

**A5-03 [minor] Checkpoint age and contents.** `atr:v1:active` has no maximum age; a checkpoint from days ago would offer "Resume". Proposed change: discard a checkpoint older than the room lifetime (12 h) automatically; the checkpoint stores stage and counts, no verdicts (A4-02).

**A5-04 [minor] Retention and summary contents.** Summaries are kept 30 days but only 7 are displayed; the other 23 days are retained for no stated purpose. Proposed change: keep 8 days (7 plus today) or state why 30. State that session summaries store phrase positions and counts, never phrase text, cue text or device labels. The phrase bank persists until deleted; say so in About.

**A5-05 [minor] Corruption, validation, logs, backup.** Add: corrupt or partial `atr:v1:*` values are treated as absent and offer delete (no crash loop); values read from storage are validated against the same schema rules as wire data; `multiRemove` partial failure is surfaced; no phrases, credentials or codes in console or device logs or the Diagnostics screen; record whether the platform backs up app storage (T09 evidence).

## 9. ADR-0006 transport (item f)

**Verdict: accept-with-changes** (0 blocker, 0 major, 3 minor).

**Polling consistency check.** I searched `docs/`, `packages/*/src`, `packages/*/README.md`, `.build/` and `README.md`: ADR-0006, `.build/decisions.md` D-007 and R-L2 all say "no production polling fallback without a new ADR"; PROTOCOL.md, ADR-0002 (relay storage holds no payloads, local store is memory) and ADR-0003 define no polling endpoint, queue or payload buffer. The only remaining claim is stale: `README.md:165` (owner-modified, uncommitted) still lists "a 250 ms long-poll fallback" as a day-one check, next to "Node 20" which ADR-0007 replaced with Node 22.

**A6-01 [minor] Stale polling and Node 20 text in `README.md:165`.** Owner file; release-docs should update when the README is next edited. Not edited here.

**A6-02 [minor] Reconnect rules have no terminal conditions and no jitter.** Proposed change: on `revoked`, `expired`, `unauthorized`, `superseded` or `unpaired`, a client stops reconnecting and returns to pairing (otherwise a revoked phone hammers the unauthenticated path every 8 s, and with A3-03 locks its own household out); apply plus or minus 25% jitter to the 0.5 to 8 s backoff; give up to `failed` after a bounded total time.

**A6-03 [minor] Local relay and development routes.** Bind the local relay to a stated interface and serve TLS only; the self-signed CA installed on a phone (route b) lets anyone holding its key intercept that phone's TLS, so document a name-constrained, short-lived CA, key kept on the Mac, removed after the demo; route (c) tunnels expose the dev relay to the internet, so the attacker model for it is the remote attacker; no `ALLOW_ANY_ORIGIN` or `platform: test` bypass may exist in a production build (SEC-I07); disable permessage-deflate on the local `ws` server (OWASP, compression with secrets).

## 10. ADR-0007 runtime and toolchain

**Verdict: accept** (0 blocker, 0 major, 1 minor). Version pins are consistent with COMPATIBILITY.md; the Vega toolchain Node line is isolated from the backend runtime, which limits blast radius.

**A7-01 [minor] No supply-chain gate and unrecorded support dates.** Add to the ADR: root lockfile only, exact versions for security-relevant packages, `npm audit --omit=dev` with no unresolved high or critical findings before release (SEC-I05), no install scripts from unreviewed packages, SBOM and licence inventory, and record the end-of-support dates of Node 22, the Vega SDK line and RN 0.83 (early access per COMPATIBILITY.md) so a security-patch plan exists.

## 11. ADR-0008 spoken output and quiet windows (item g)

**Verdict: accept-with-changes** (0 blocker, 2 major, 2 minor).

**What I checked.** No app audio in core; VoiceView never disabled (R-U4); instructions announced before the window; routine live regions suppressed during capture; arc and timer hidden from accessibility during capture; results only after capture (and after reveal for hidden attempts); the contamination guard is honestly called "a detection guard, not a guarantee".

**A8-01 [major] Contamination is detected only before the window, and the suppression list is incomplete.** The TV speaker sits next to the phone while the speaker is 2.5 to 3 m away, so a VoiceView utterance mid-window reaches the microphone louder than the person and the window can falsely read `reached`. The precheck cannot see speech that starts after it. Suppression must cover every TV-originated visible text change during precheck and capture, not only live regions: banners ("Phone state unknown"), error toasts, cue chips (shown for 3 s), focus moves and `peer.state` effects. Proposed change: during `capturing`, queue all of these and flush after `window.stop` (or at reveal for hidden attempts); keep them visible but silent only if the screen reader does not speak visual-only changes; state in the ADR the residual risk "TV speech during a window can be counted as voice". SEC-T02 and T17 test it.

**A8-02 [major] There is no non-contaminating go-signal for VoiceView users.** A visual "speak now" is inaccessible; an audible one contaminates. A fixed `QUIET_LEAD_MS = 1.5 s` after OK is an assumption: speech rate, language and text length change utterance duration. Proposed change: for VoiceView-on sessions use an announced fixed script ("After this message, wait three seconds, then speak. Measurement lasts eight seconds.") before OK, rely on the 8 s window, and make the lead configurable (`QUIET_LEAD_MS`, recorded in evidence). T17 measures actual VoiceView utterance timing on the VVD and checks for an announcement-finished event; until then the constant is unverified.

**A8-03 [minor] Phone-side contamination.** Vibration (`navigator.vibrate`), UI sounds, haptic feedback and notification sounds are picked up by the phone's own microphone. Proposed change: the phone page makes no sound and no vibration from precheck start to window end; setup copy asks for Do Not Disturb; add a phone test.

**A8-04 [minor] Evidence.** Record `QUIET_LEAD_MS`, VoiceView speech rate and the VVD build with each T17 observation; ADR-0008's "actual VoiceView timing on the VVD is a T17 observation" must not be satisfied by a browser run.

## 12. ADR-0009 measurement modes and Listener Edition (item h)

**Verdict: accept-with-changes** (1 blocker, 2 major, 3 minor).

**What I checked.** "A failed experiment is recorded as failed", Listener Edition only within this product, and passing qualification does not enable cross-day comparison: all three match the master prompt. The weaknesses are in how pass and fail are defined.

**A9-01 [blocker] The proposed criteria pass an AGC-compressed microphone.**
Acceptance is "monotonic medians across levels; per-level repeat SD <= 1 dB and spread within +-2 dB; zero clipping". A compressing input passes all three. Worked example: nominal digital levels -24, -18, -12 dB (6 dB apart) measured as median -40, -38, -36 dBFS (2 dB steps, 3:1 compression), SD 0.5 dB, spread +-1 dB, no clipping: monotonic, tight, unclipped, PASS, yet the device compresses 6 dB steps into 2 dB. The master prompt names "step-slope criteria" among the original criteria; they were dropped. A failed experiment becomes a pass.
Proposed change: add "each adjacent measured median step is within 6 +- 2 dB of the nominal step (4 to 8 dB for a 6 dB nominal step), computed on medians of at least 10 repeats" as an engineering proposal (record that digital steps are not calibrated SPL steps). Add the synthetic 3:1 compression case to the T04A tests; it must fail.

**A9-02 [major] "Default when qualified" contradicts "default until T04A", and there is no "failed" state.** Line 9 says `relative_band (default when qualified)`; line 11 says builds default to `relative_band` until T04A decides, with "Not yet qualified on this phone" only in Settings. A phone that failed qualification, or was never tested, still produces "Reached today's relative level band". Proposed change: three states per phone and browser: `not_run`, `passed`, `failed`. When not `passed`, result labels carry the suffix "(unqualified phone)" on the result screen (not only Settings); when `failed`, `listener_edition` is forced and band verdicts are hidden. Qualification attaches to (device model, browser and version, settings readback), not to a global flag; unknown devices are `not_run`.

**A9-03 [major] Negative cases have no criteria.** The protocol lists fan, TV speech, second speaker, cough, music and moved phone, but only "record". A product cannot fail on a negative case it never scores. Proposed change: record, before trials, an observed false-`reached` count per negative case, with a stated limit for the two the product can control (TV speech: pre-window rise detection must block or the window must be marked contaminated; cough: report the accepted fraction per A1-01). A negative case that exceeds its limit sets status `limited: noise-sensitive` and shows it in Settings.

**A9-04 [minor] Freeze the acceptance criteria, not only the protocol.** Record the commit SHA and a hash of protocol plus criteria in `.build/evidence.jsonl` before the first trial; any later change needs an ADR amendment that keeps the original criteria and the failing result.

**A9-05 [minor] Sample size.** With 10 repeats per level, a measured SD of 0.9 dB cannot demonstrate SD <= 1 dB: the one-sided 95% upper bound is about 1.65 times the estimate (chi-square, 9 degrees of freedom). Either state the criterion on the upper bound or increase the repeats; three monotonic medians is a very low bar by chance.

**A9-06 [minor] `mic.state.mode` is self-reported.** "physical_phone" is a label chosen by the client. Evidence class `real_phone` comes from the experiment records and the evidence log, never from the in-product flag.

## 13. Cross-ADR items for the lead

1. R-M6 text should say eight conflicts; ADR-0001 context says four.
2. Protocol revision 3 candidates (contracts owner): `silent_input` precheck reason (A1-05), `vad_floor_dbfs` range (A1-10), cross-field invariants (PK-02), `next_credential` in `auth.ok` (A3-07), text rules (PK-03). Batch them so the relay and phone teammates rebase once.
3. Items that gate work already in progress: A3-01 (T08 phone pairing UI), A4-01 to A4-03 (session-core reducer and view), A1-01, A1-03 to A1-05 (T06 DSP fixtures), A9-01 (T04 protocol freeze).
4. None of the findings requires deleting a requirement; all can be closed by ADR text and test changes.

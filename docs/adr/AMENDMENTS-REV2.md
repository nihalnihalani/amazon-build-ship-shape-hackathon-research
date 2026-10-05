# ADR revision 2 amendments (2026-10-05)

Decisions by the Opus lead on the independent review in `docs/security/ADR_REVIEW.md` and `docs/security/PROTOCOL_PACKAGE_REVIEW.md`, plus defects found by the T12 end-to-end run. **Where this file conflicts with an ADR's revision 1 text, this file wins.** Each ADR header points here. Constants remain product assumptions pending T04/T04A evidence.

Owners: P = protocol (`contracts`), D = DSP (`dsp`), S = session-core (`session`), T = TV app (`tv`), R = relay (`relay`), H = phone (`phone`), L = lead (docs).

## ADR-0001 measurement contract

| Finding | Decision | Owner |
|---|---|---|
| A1-01 | Accept. Replace the "150 ms transients are rejected" claim: bursts ≤ 100 ms never produce an accepted segment; ≥ 200 ms always do; 125–175 ms are phase- and level-dependent. Fixtures sweep ≥ 20 sub-frame offsets at +10 and +20 dB for 100/150/200 ms and assert the two hard ends; the in-between rate is recorded, not asserted. | D |
| A1-02 | Accept. A segment is accepted iff it has ≥ 4 candidate frames in total **and** a run of ≥ 3 consecutive candidate frames. Click-train fixture. | D |
| A1-03 | Accept with hysteresis. A segment **opens** on a frame with `rel ≥ 10 dB`; once open, frames with `rel ≥ 6 dB` are candidate (continuation). Gap bridging unchanged (fewer than 6 consecutive non-candidate frames). Fixture: AR(1) noise at the edge of quiet-check validity, silent 8 s window, `P(active) ≤ 1 %` over 10 000 seeded trials. Calibration margin 13 dB stays above the 10 dB open threshold. | D |
| A1-04 | Accept. `no_voice` for phrase and vowel windows = no accepted segment. Calibration keeps `active_ms < 400` as `no_voice`. | D, S |
| A1-05 | Accept. Quiet check and pre-window precheck are invalid with reason `silent_input` when `floor < −110 dBFS`. TV copy: "The phone microphone looks muted or blocked." | P, D, S |
| A1-06 | Accept. Pre-window precheck invalid reasons: `interrupted`, `nonfinite`, `low_coverage`, `silent_input`, `clipped`, `burst_noise`. `unstable_floor` and `too_loud` apply to the quiet check only. Coherence wording: "the two margin inequalities never block an unchanged room (rise ≤ 3 dB); precheck validity is a separate gate." | P, D, S |
| A1-07 | Accept. Reason priority: `interrupted` > `nonfinite` (> 5 % of frames, evaluated first) > `low_coverage` > `silent_input` > `clipped` > `unstable_floor` > `burst_noise` > `too_loud`. Accepted-active frames for p50/p95/clipped fraction = **candidate frames inside accepted segments** (bridged non-candidate frames excluded); `active_ms` still spans bridged gaps. Phone reports `measuring` during prechecks and captures, `open_idle` between windows. | D |
| A1-08 | Accept. TV Diagnostics shows the session calibration margin and the maximum tolerated floor rise. | S |
| A1-09 | Accept. TV recomputes validity from numeric fields and its own timing (protocol invariants below plus `duration_ms ≤ max_duration_ms + 500`); disagreement → unscored with TV-local reason `integrity`. | S |
| A1-10 | Accept. `vad_floor_dbfs` range −110 … −30. | P |
| PK-06 | Accept. dB fields are multiples of 0.1 dB; `t_audio_ms`, `duration_ms`, `active_ms`, `longest_active_ms`, `onset_ms` are integers; `coverage` a multiple of 0.001. The phone rounds; validators enforce. | P, D, H |

## ADR-0002 privacy

| Finding | Decision | Owner |
|---|---|---|
| A2-01 | Accept. New phone copy (exact): **"Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV."** Table gains rows for device label, app version/platform and voice-activity timing. | H, L |
| A2-02 | Accept. TV Settings › About adds: "This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history." | S |
| A2-03 | Accept. Relay storage additionally holds abuse-prevention counters keyed by HMAC-SHA-256 of the source address (IPv4 /32, IPv6 /64) with a secret rotated at least daily, TTL ≤ 1 h, counts only. Disclosed in About and README. | R, S, L |
| A2-04 | Accept. Per-message logs only for errors and security events; otherwise per-minute aggregate counters by type. Log retention ≤ 14 days. | R |
| A2-05 | Accept. IaC assertions (execution data tracing off, access-log whitelist, X-Ray off, PITR off or documented, bounded retention) plus a runtime log-capture test. Hosting access logs disclosed. | R |

## ADR-0003 pairing and authentication

| Finding | Decision | Owner |
|---|---|---|
| A3-01 (blocker) | Accept. QR and link carry the code only in the fragment (`https://<phone-origin>/#code=<CODE>`). The phone never auto-joins (explicit Join tap). After `join.pending` the phone shows "On your TV, pick **NN**". After `join.accepted` the phone asks **"Did you just pick NN on your TV?"** with "Yes, that was me" / "No, cancel". Until Yes the phone sends nothing except the join protocol and `ping`; microphone start is disabled. No discards the credential, sends nothing further and closes. | H |
| A3-02 | Accept. A TV reject, a wrong number pick, or a pending join that expires unanswered burns the code; the relay sends a fresh `pairing.code`. `pairing.refresh` invalidates the old code immediately and is limited to 1 per 10 s per room; one live code per room. Valid-code joins that end rejected/expired count per source: 6 per 10 min. Global failed-join counter is an alarm, never a lock. | R, S |
| A3-03 | Accept. Source key = HMAC of IPv4 /32 or IPv6 /64. Exponential delay instead of a hard block (failures 1–3 free, then 2 s doubling to 60 s, reset after 10 min clean). `$connect` budget 20/min per source; ≤ 5 concurrent unauthenticated connections per source; global live-room cap 200 (config); `room.create` 30/h per source. | R |
| A3-04 | Accept. Pairing codes stored as HMAC-SHA-256 with a secret (local: random per process; AWS: SSM SecureString parameter), never plain SHA-256. | R |
| A3-05 | Accept. `auth.resume` failures limited to 10/min per source and per room_id; one generic failure code (`unauthorized`) to the client; specific reason logged server-side only. | R |
| A3-06 | Accept as **number matching**. The TV shows "A phone wants to join. Pick the number shown on the phone." with three two-digit choices (the real `confirm_digits` plus two distinct decoys, shuffled) and Reject. Picking the right number accepts; a wrong pick rejects (code burned). Preferred focus is Reject. `device_label` is shown as "Name the phone gave: …" (untrusted). `confirm_digits` from a CSPRNG with uniform draw. | S, T, R |
| A3-07 | Accept all three. (1) A resume that would supersede a connection heard within the last 25 s is refused (`unauthorized`). (2) Every phone supersede is announced to the TV (`peer.state` with the new generation); an open window is cancelled. (3) **Credential rotation:** `auth.ok` and `join.accepted`/`room.created` carry the current credential; every successful `auth.resume` consumes the presented credential and returns `next_credential` in `auth.ok`; presenting a consumed credential revokes that role and tells the TV ("Pairing may be compromised. Pair again."). | P, R, S, H |
| A3-08 | Accept. `$connect` rejects any present Origin that is not an exact allowlist match; the literal `null` Origin is present-and-rejected; header lookup case-insensitive. Connection record stores `origin_state` ∈ {`phone_origin`, `tv_preview_origin`, `absent`}. Phone-role operations require `phone_origin`; `room.create` and TV resume require `absent` or `tv_preview_origin`; the preview origin is never in a production allowlist. | R |
| A3-09 | Accept. ADR-0003 gains an AWS adapter section: the 5 s / 65 s authentication deadlines use an SQS delay-queue check (DelaySeconds) that deletes unauthenticated connections; over AWS the client sees an `error` message then a close without a chosen code; the local adapter matches at the message level. Verified at T10. | R |
| A3-10 | Accept. Claim is one conditional write/transaction (slot empty, pending join id matches, join and room unexpired, code unconsumed, join belongs to the confirming TV's room). A busy phone receives only `join.rejected {reason: busy}`. | R |
| A3-11 | Accept. Credential lifetime 2 h, renewed by rotation on resume; revocation via a room epoch compared on every message (at most one in-flight message after `unpair`); memory-only credentials on the phone are deliberate (tab discard forces re-pairing). | P, R, H |
| A3-12 | Accept. `client.platform` is never a trust signal; the production configuration rejects `platform: test`; local development may allow it. | R |
| PK-04 | Accept. The relay forwards the canonical re-serialisation of the validated message, never the raw frame. PROTOCOL.md §2 amended. | R, P |
| PK-07/08/10 | Accept. `SequenceTracker.accept(expectedGeneration, generation, sequence)`; dedupe per (room, role), id recorded only after acceptance; one `processInbound` entry point in the relay core that adapters call; the TV rejects `sender_role: tv` and TV-only types arriving inbound. | P, R, S |

## ADR-0004 hidden meter, listener, reveal

| Finding | Decision | Owner |
|---|---|---|
| A4-01 (blocker) | Accept. For a hidden first attempt, every window that closes by stop, timeout or completion — **valid or invalid** — enters `response_pending` with the same neutral prompt ("How did that feel?") and, in family mode, the same listener-open behaviour. "Not scored: reason" appears only at reveal. Speaker Cancel, `link_lost` and `interrupted` keep the immediate path. The TV answers any unsolicited listener response with the same `ack ignored_stale` (empty detail). | S |
| A4-02 | Accept. The checkpoint never contains a verdict, rating or window result for an unrevealed attempt; such an attempt is `interrupted` and unscored on resume. | S |
| A4-03 | Accept. Between capture close and reveal of a hidden attempt, `meter` is null, Diagnostics and History redact the in-flight attempt, and Settings is unavailable. | S |
| A4-04 | Accept. Phone locks listener controls on `attempt.reveal`, `window.cancel`, `session.end` or when `listener.open.timeout_ms` elapses. TV "Keep waiting" sends a fresh `listener.open`. "Continue without listener response" records `missing` and sends `attempt.reveal`. | S, H |
| A4-05 | Accept. First valid on-time response wins; later on-time responses get `ack rejected` (detail `already_answered`). A response after reveal is stored late and acked `applied` with detail `late`. | S |
| A4-06 | Accept. Borderline attempts are eligible for agreement and counted separately as well. | S |
| A4-07 | Accept. Relay cue cap is per room tied to the session id announced in `session.begin`; the TV rejects cues outside between-window states with `ack rejected`. | R, S |

| QA-01 | Accept. There is no `meter_visibility` wire or contract field: a retry is identified by `attemptNumber > 1` in the view and by its own `attempt_id`; summaries label retries from that. | L |
| QA-05 | Accept. The phone receives `session.state` stage `phrase_active` from capture start until the next `phrase_ready` or `summary`; `response_pending` and `reveal` are never sent to the phone, so blind positions cannot be inferred from stage changes. `listener.open` remains the explicit listener signal. | S |

## ADR-0005 storage

| Finding | Decision | Owner |
|---|---|---|
| A5-01 | Accept. Delete local data = best-effort `unpair` + `room.close` (shows "Relay cleanup confirmed" or "not confirmed"), remove `atr:` keys, verify, reset memory; never report success if verification fails. | S |
| A5-02 | Accept. The phone persists nothing (no cookies, localStorage, sessionStorage, IndexedDB or Cache API entries). Test asserts it. | H |
| A5-03 | Accept. A checkpoint older than 12 h is discarded on launch. | S |
| A5-04 | Accept. Retention reduced to **8 days** (7 shown plus today). Session summaries store positions and counts, never phrase text, cue text or device labels. The phrase bank persists until deleted (stated in About). | S |
| QA-02/07 | Accept. Final record is written before the checkpoint is cleared; a resume never overwrites a completed record; a failed final write keeps the checkpoint and shows an error. | S |
| A5-05 | Accept. Corrupt values treated as absent with a delete offer; values read from storage validated; `multiRemove` partial failure surfaced; no phrases, credentials or codes in logs or Diagnostics. | S, T |

## ADR-0006 transport

| Finding | Decision | Owner |
|---|---|---|
| A6-01 | Accept for the build README (release-docs). The owner's research README is not edited by teammates. | L |
| A6-02 | Accept. Clients stop reconnecting on `revoked`, `expired`, `unauthorized`, `superseded` or `unpaired` and return to pairing; backoff has ±25 % jitter; after 2 min of continuous failure report `failed` and stop until the user retries. | T, H |
| A6-03 | Accept. permessage-deflate disabled on the local `ws` server; name-constrained short-lived dev CA (already); no origin or platform bypass in production builds. | R |

## ADR-0007 toolchain

| Finding | Decision | Owner |
|---|---|---|
| A7-01 | Accept. Release gate: root lockfile, exact versions for security-relevant packages, `npm audit --omit=dev` with no unresolved high/critical, licence inventory and SBOM, recorded support dates for Node 22/24, Vega SDK 0.24 and RN 0.83 (early access). | L (release-docs) |

## ADR-0008 spoken output

| Finding | Decision | Owner |
|---|---|---|
| A8-01 | Accept. During `capturing`, no live regions, no focus moves and no announcements; banners and cue chips are visual only and their announcement is deferred until capture closes (until reveal for hidden attempts). Residual risk stated: TV speech during a window can be counted as voice. | S, T |
| A8-02 | Accept. When the TV's screen reader is on, the ready screen carries a fixed script ("After this message, wait three seconds, then speak. Measurement lasts eight seconds.") and the quiet lead is 3000 ms (configurable, recorded in evidence). New TV input `{ kind: 'a11y', screenReader: boolean }` (contract revision 2). | S, T, L |
| A8-03 | Accept. The phone makes no sound or vibration; setup copy suggests Do Not Disturb. | H |
| A8-04 | Accept. T17 records lead, speech rate and VVD build; browser runs never satisfy it. | qa |

## ADR-0009 qualification

| Finding | Decision | Owner |
|---|---|---|
| A9-01 (blocker) | Accept. Add a slope criterion: each adjacent median step within the nominal step ± 2 dB (4–8 dB for a 6 dB nominal step), on medians of the repeats. Synthetic 3:1 compression case must fail. | D |
| A9-02 | Accept. Qualification state per phone description ∈ {`not_run`, `passed`, `failed`} (initially global on the TV until T04A defines the key). When not `passed`, result labels carry "(unqualified phone)" on the result screen; `failed` forces Listener Edition with band verdicts hidden. | S |
| A9-03 | Accept. Negative cases get predeclared false-`reached` limits; TV speech must be blocked by the gate or marked contaminated; exceeding a limit sets `limited: noise-sensitive`. | D |
| A9-04 | Accept. Before the first trial the commit SHA and SHA-256 of the protocol + criteria are recorded in `.build/evidence.jsonl`. | D, L |
| A9-05 | Accept. 15 repeats per level; criterion on the one-sided 95 % upper confidence bound of SD ≤ 1.5 dB. | D |
| A9-06 | Accept. `mic.state.mode` is a label, never evidence class. | L |

## Protocol package findings

PK-01 (snapshot input once, validate and return the snapshot), PK-02 (cross-field invariants exactly as listed in the review), PK-03 (display-safety text rule from `docs/security/probes/text_policy_sketch.mjs`: forbidden characters, invisible-only strings, combining runs > 4; keep NFC, ZWJ, ZWNJ, LRM/RLM/ALM), PK-05 (normalise −0 to 0), PK-09 (receivers parse raw text only; the TV `wire` input must be a string — objects are refused), PK-11 (doc drift fixes), PK-12 (TV startup NFC self-test shown in Diagnostics): all accepted. Owner P (S for PK-09/PK-12).

## QA review defects routed

QA-03 (must-deliver commands queued across link loss) and QA-04 (phrase bank shorter than current position) → S; A11Y-01/02/03 (disabled controls, dialog name, UI-scale overflow) → T. Repros live in `tests/review` and `tests/a11y` as expected-fail until fixed.

## Defects from T12

| ID | Defect | Decision | Owner |
|---|---|---|---|
| DEF-001 | TV sent no heartbeat; relay dropped it after 25 s idle | Fixed in session-core `24a5929` (ping after 10 s idle) | S |
| DEF-002 | TV reused one `window_id` for the pre-window precheck and the capture window; phone treats window ids as single-use | **window_id is unique per measurement** (each precheck and each capture); precheck and capture share `attempt_id`. PROTOCOL.md rev 4. | S, P |

## Measured outcomes of the DSP rework (2026-10-05)

Recorded honestly; constants stay product assumptions pending T04.

| Item | Measured (fixtures, seeded) | Decision |
|---|---|---|
| A1-01 burst acceptance | ≤ 100 ms never accepted; 200 ms always accepted at +20 dB but only 27/40 phases at +10 dB (the frame before the opening frame can never be a candidate); 250 ms always accepted at +10 and +20 dB | Wording corrected: "≤ 100 ms never; ≥ 250 ms always at +10 and +20 dB; 200 ms always at +20 dB and phase-dependent at +10 dB". No extra rule added. |
| A1-03 false activity | P(active ≥ 1 segment \| silent 8 s window) < 1 % for noise spread ≤ 2.5 dB; 4.4 %, 3.5 % and 16.5 % for the three noisiest AR(1) models at the edge of quiet-check validity | Target not met for the noisiest admissible rooms. Kept the 10 dB open threshold (raising it would reject soft speakers before T04 data exists). Consequence is a silent window scored `below` instead of `no_voice`, never a false `reached` (that needs p95 ≥ margin − 1 ≥ 12 dB). Recorded as a limitation in MEASUREMENT.md; T04 re-tunes. |
| PK-06 tie rounding | `quantizeDb` uses `Math.round` (ties toward +∞, e.g. −42.25 → −42.2) | Accepted: the protocol package is the single rounding authority; the DSP matches it. |

## Supply-chain decision (A7-01 exception, 2026-10-05)

- Root workspace: `npm audit --omit=dev` reports 0 vulnerabilities after bumping vitest to 3.2.7 and the tests workspace `ws` to 8.22.0. `npm audit` (including dev) reports 2 moderate findings in vitest/@vitest/mocker whose fix is a breaking major upgrade (vitest 4); accepted for development use only (the test UI server is never run in CI or production).
- `apps/tv`: `npm audit --omit=dev` reports 70 findings (5 critical, 44 high), all inside React Native and Vega build/CLI tooling. None of the affected packages is in the 27-package Metro runtime bundle (`docs/release/tv-bundle-packages.json`). Accepted as a documented exception for build-time tooling pending upstream Vega/RN releases; re-audit at every SDK bump and before any public release. This exception does not cover any package that ships in the bundle.
- The five `@amazon-devices/*` packages are proprietary (Amazon Program Materials License Agreement); they are dependencies, never vendored into this MIT repository (THIRD_PARTY_NOTICES.md).

## Requirement wording

R-M6 says "seven" inherited conflicts; the master prompt lists eight in §8 (the ADR-0001 context said four). Read R-M6 as "all inherited conflicts in master prompt §8". ADR_REVIEW.md §2 maps each to its resolution.

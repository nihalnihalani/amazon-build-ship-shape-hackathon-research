# Threat model v1: Across the Room, the far-side check

- Status: first version, written at the start of T16 (security and privacy gate). Design-time: it models the specification (ADR-0001 to ADR-0009, `docs/PROTOCOL.md` revision 2, `packages/session-core/src/contract.ts`, `packages/protocol` at base `018bdc0`). The relay, phone page and TV app were being built in parallel worktrees and were not available to review, so every "status" below describes what is specified, not what is implemented or tested. Nothing here is test evidence.
- **Status after the rework wave (T16, 2026-10-05):** section 8 was turned into executable tests under `tests/security/` and run against `build/across-the-room`. Per-row results (executed, executed in part, not executed, pending_external), the residual-risk update and the gate verdict are in `T16_GATE.md`. This document is the design-time model and is not rewritten; where the shipped system differs, `T16_GATE.md` wins.
- Author: security (`claude-sonnet-5-5`), branch `wt/security`, 2026-10-05. Finding ids (A1-01, PK-03, ...) refer to `ADR_REVIEW.md` and `PROTOCOL_PACKAGE_REVIEW.md`. Threat-model-only gaps are `TM-Gn` (section 9).
- Method: STRIDE per component (TV app, phone page, local relay, AWS relay, pairing, storage), driven by assets, trust boundaries and four attacker profiles. Mitigations are mapped to ADR sections. The security tests T16 must run are in section 8 and become the gate checklist.
- Requirement IDs: R-S1 to R-S6, R-X1, R-X2, R-L2, R-M6, R-Q1, R-ST1, R-U4 (traceability in section 8).

## 1. System and data flows

```
 Speaker's room                                          Internet / AWS
 +--------------+   remote    +---------------+  WSS (TB2)  +--------------------------------------------+
 | Speaker,     |------------>| TV app        |<----------->| API Gateway WebSocket ($connect, $default)  |
 | listener     |             | (Vega RN,     |             |   -> Lambda relay core -> DynamoDB          |
 +--------------+             | session-core, |             |   -> CloudWatch (content-free)              |
        |  voice              | AsyncStorage) |             +--------------------------------------------+
        v                     +---------------+                           ^   (TB1) WSS
 +--------------+  (TB6) mic permission, browser-mediated                  |
 | Phone page   |------------------------------------------------------- -+
 | (Chrome)     |<-- HTTPS (TB4) -- CloudFront -- private S3 (static page: the trust root for
 +--------------+                                  "audio stays on this phone")
 Local development and judge route: Mac local relay (Node, TLS, memory) serves the page and WSS on the LAN (TB8).
```

Flows: F1 pairing (`room.create`, `join.request`, TV `join.confirm`, `join.accepted`); F2 resume (`auth.resume`, generation bump); F3 TV commands to phone (`session.*`, `precheck.start`, `window.*`, `listener.open`, `attempt.reveal`); F4 phone observations to TV (`mic.state`, `precheck.result`, `level` at 20 per second inside windows, `window.result`, `listener.response`, `cue`); F5 phrases (`phrases.update`, stored on the TV); F6 TV storage (summaries, phrase bank, settings, checkpoint).

## 2. Assets

| ID | Asset | Lives in | Why it matters |
|---|---|---|---|
| A1 | Raw microphone audio | Phone memory only, discarded per frame | Core privacy claim (R-X1): never transmitted, stored or analysed off the phone |
| A2 | Level frames, voice-activity timing, window summaries | In flight; TV memory; summaries on TV | Speech timing is health-adjacent; arcs must not reveal blind results early |
| A3 | Household phrases and cue word | Phone memory; relay in flight; TV AsyncStorage (unencrypted) | May contain names, medication, addresses |
| A4 | Practice history (counts, durations, up to 30 days) | TV AsyncStorage | Health-adjacent behaviour record |
| A5 | Credentials: TV and phone bearer credentials (12 h), pairing code (10 min), confirm digits | Client memory; relay holds hashes | Possession equals the role |
| A6 | Room and connection metadata; abuse counters derived from source address | DynamoDB or relay memory | Correlation, harassment, privacy truthfulness (A2-03) |
| A7 | Measurement integrity: verdicts, hidden-check blinding, qualification status | TV session core | The product's value and honesty |
| A8 | Ability to start microphone analysis on the phone | TV commands over the relay | Mic misuse by a hostile TV or relay |
| A9 | Availability and cost | AWS account, relay | Pairing must work; spend must be bounded |
| A10 | Secrets and build integrity: HMAC pepper (A3-04), deploy credentials, phone bundle hash | AWS, build host | Compromise defeats every other control |
| A11 | Truthfulness of privacy and limits copy | UI strings, PRIVACY.md, README | Claims that exceed behaviour are a defect |

## 3. Trust boundaries

| ID | Boundary | Note |
|---|---|---|
| TB1 | Phone browser to relay (Internet, WSS, first-message auth) | Origin is a browser protection, not identity |
| TB2 | TV app to relay (Internet, WSS) | Native client; Origin may be absent (ADR-0003 s8) |
| TB3 | Relay compute to data store (IAM, conditional writes) | Atomicity and least privilege |
| TB4 | CloudFront and S3 to phone browser (static code) | Integrity of this JavaScript is the trust root for A1 |
| TB5 | TV app to AsyncStorage | Local, unencrypted (R3) |
| TB6 | Phone page to OS microphone permission | Browser-mediated; permission is not proof of privacy |
| TB7 | Physical and human: TV screen visible to anyone present, remote, phone | Pairing code and join prompt cross this boundary |
| TB8 | Developer LAN: Mac local relay, owner-installed CA on the phone, tunnels | Dev and judge route only |
| TB9 | Operator and administrator access to AWS | Compromised-operator model |

## 4. Attacker profiles

| ID | Attacker | Can | Cannot | Main targets |
|---|---|---|---|---|
| AT1 | Same-Wi-Fi neighbour (guest, housemate, neighbour on shared NAT or carrier-grade NAT) | Share the household public address (so per-source limits bite the real user too); sometimes see the TV screen and the pairing code; reach the local dev relay on the LAN; try to pair a phone; flood a shared per-source budget | Read TLS traffic; see TV memory; act as the TV without its credential | Pairing (A5), availability of pairing (A9), shoulder-surfed code, local relay |
| AT2 | Remote internet attacker | Script any client, forge any header including Origin, rotate many source addresses (IPv6, botnet), fuzz frames, flood connections, create rooms, replay captured frames only if TLS is broken (not assumed) | See the TV screen; read TLS traffic; hold credentials without stealing them | Brute-force of codes, cost and availability (A9), cross-room access, parser bugs, supply chain |
| AT3 | Malicious web page in the phone browser | Open WebSockets from its own origin, link or QR to the phone page with a crafted fragment, frame the page, call `window.open`, attempt cross-site WebSocket hijacking | Read the phone page's memory or credentials (same-origin policy); obtain our origin's microphone permission; set our Origin | Reverse confused deputy via link or QR (A3-01), clickjacking, CSWSH, XSS if any string is rendered unsafely |
| AT4 | Compromised relay operator (console, logs, database, deploy rights) | Read every plaintext payload in flight (phrases, levels); forge TV or phone messages (no end-to-end authentication); read stored hashes (the pairing code is recoverable, A3-04); replace the deployed phone JavaScript (TB4); disable controls | Obtain raw audio unless the phone JavaScript is replaced to send it; act without leaving control-plane traces if CloudTrail is on | Everything the relay sees; A1 through a malicious page deploy |

Out of scope, recorded for honesty: OS or browser exploits on the phone, malware on the TV, theft of a paired device, compromise of the Amazon platform, targeted state-level adversaries. Residual risks that follow from AT4 and from design choices are in section 7.

## 5. Mitigation status legend

S = specified in an ADR; S* = specified but with a gap (finding id); G = not specified (finding id or TM-G); T = covered by a test in section 8; "accepted" = residual risk recorded in section 7.

## 6. STRIDE by component

### 6.1 TV app (Vega React Native, session-core, AsyncStorage)

| STRIDE | Threat | Attacker | Mitigation (ADR) | Status | Residual |
|---|---|---|---|---|---|
| S | TV connects to an attacker endpoint (bad relay URL, TLS downgrade) and leaks code, credential and results | AT2 | WSS only (ADR-0006); relay URL fixed per build; refuse `ws://` to non-loopback | S, T (SEC-T01) | No certificate pinning (Vega support unknown) |
| S | Forged phone messages (hijacked phone slot, forged by relay) | AT2, AT4 | Relay stamps role from the connection; TV re-checks sender and type direction | S*, G (PK-10, TM-G3), T | AT4 can forge both roles (R1) |
| T | Impossible or inconsistent phone aggregates change a verdict | Paired attacker, bug | TV recompute of validity and sanity checks (A1-09, PK-02) | G, T (SEC-M01) | Phone remains the trusted measurement source (R11) |
| T | Replayed or duplicated level frames, out-of-window events | AT2 (paired), bug | Ignore events for a non-open window or attempt (PROTOCOL s4.10); unique `frame_index` per window | S*, T (SEC-T07) | None |
| T | Corrupt or tampered local storage | Local fault | Validate on load, treat corrupt as absent (A5-05) | G, T (SEC-T04) | Unencrypted store (R3) |
| R | Disputed actions (who accepted a pairing, who deleted data) | n/a | None by design; local-only state | accepted | none |
| I | Hidden-meter result leaks before reveal (UI, accessibility tree, announcements, Diagnostics, History, resume) | Speaker, bystander | ADR-0004; values absent from the view (contract); fixes A4-01, A4-02, A4-03 | S*, T (SEC-T02, SEC-T03) | VoiceView behaviour is a T17 observation |
| I | Credentials, codes or phrases in logs or the Diagnostics screen | Local | ADR-0002, ADR-0005 | S*, T (SEC-T06) | Device logs may be read by the owner |
| I | Pairing code and join prompt visible to bystanders or screen sharing | AT1 | 10-minute code; TV confirmation; burn code on reject (A3-02) | S* | R7 |
| I | Unencrypted AsyncStorage holds phrases and summaries | Local app or backup access | Minimization, deletion, disclosure (ADR-0005) | S, accepted | R3 |
| D | Flooding from phone or relay; oversized frames; cue or listener spam | AT2 (paired) | Relay rate limits; TV bounds frames per window (700), cues (3); raw-text-only intake (PK-09) | S*, T (SEC-T07, SEC-T08) | None |
| D | VoiceView or TV speech corrupts windows (denies valid results) | Self | ADR-0008 with A8-01, A8-02 | S* | R5 |
| E | Phone-role message invoking TV-only behaviour; `sender_role: tv` or `relay` arriving at the TV | AT2, AT4 | Direction table; inbound check on the TV (TM-G3) | G, T (SEC-A12) | None |
| E | Fixture or demo mode writing real history; destructive action without confirmation | Bug | Separate fixture store and label (ADR-0005); destructive dialogs default to Cancel (contract) | S, T (SEC-T05) | None |

### 6.2 Phone page (static SPA in Chrome)

| STRIDE | Threat | Attacker | Mitigation | Status | Residual |
|---|---|---|---|---|---|
| S | Malicious QR or link pairs the phone to an attacker's room (reverse confused deputy) | AT3, AT2 | Fragment-only deep link, explicit Join tap, phone-side digit confirmation before any data (A3-01) | G (blocker), T (SEC-W03) | None if adopted |
| S | Clone of the page on another origin | AT3 | Users reach the page by QR from the TV; phone page never accepts credentials typed by the user | S* | R8 |
| T | XSS through any rendered string (phrases, relay `error.detail`, labels) leading to mic misuse or credential theft | AT2, AT4 | Literal text only; CSP without inline script or eval; `connect-src` limited to the relay | S* (master prompt s9), T (SEC-W01, SEC-W02) | None |
| T | Page JavaScript altered at rest or in transit | AT4 | Private S3 with OAC, HTTPS, hashed build artifacts | S*, T (SEC-I01, SEC-I05) | R1 |
| R | Disputed phone actions | n/a | None | accepted | none |
| I | Audio exfiltration through a buggy or malicious code path, including numeric side channels | AT4, supply chain | No MediaRecorder; payload audit; quantised numeric fields (PK-06); CSP `connect-src` | S*, T (SEC-P01, SEC-P05) | R4 |
| I | Credentials or phrases leak through storage, URL, Referer, bfcache | AT3 | Memory-only (A5-02); fragment-only deep link; `Referrer-Policy: no-referrer`; wipe on `pagehide` | S*, T (SEC-P06, SEC-W02) | Tab discard forces re-pair (A3-11) |
| D | Microphone or wake lock left on after end, crash, unpair, expiry | Bug | Stop tracks and release lock on every exit (master prompt s6) | S, T (SEC-W05) | Needs real-phone evidence |
| E | Hostile TV or relay activates the microphone beyond user intent | AT4, stolen TV credential | Phone-side state machine, window budget, idle timeout, visible Measuring badge | G (TM-G1), T (SEC-W06) | R1 |
| E | Clickjacking the Start mic tap | AT3 | `frame-ancestors 'none'` | G (TM-G4), T (SEC-W04) | None |

### 6.3 Local relay (Node, in-memory, dev and judge route)

| STRIDE | Threat | Attacker | Mitigation | Status | Residual |
|---|---|---|---|---|---|
| S | LAN host impersonates the relay to a phone that trusts an owner-installed CA | AT1 | Name-constrained, short-lived CA; key stays on the Mac; remove after use (A6-03) | S*, T (SEC-I07) | R12 |
| T | Diverging behaviour from the AWS adapter (different auth or limits) | Bug | One shared core (ADR-0006); every SEC test runs against both adapters | S, T | None |
| R | Dev logging prints bodies or credentials | Local | Same logger redaction as AWS (ADR-0002) | S, T (SEC-P02) | None |
| I | Serves the page and WSS to any LAN host; memory holds codes and credentials | AT1 | Bind to a stated interface, TLS only, memory store | S* (A6-03) | Accepted for dev |
| D | Unbounded rooms and connections; no cloud throttling; NAT sharing | AT1, AT2 | Same limits as ADR-0003 in the core; caps on rooms and connections (A3-03) | S* | None |
| E | Dev flags (any origin, `platform: test`, fixture mode) reach a production build; tunnel exposes the dev relay | AT2 | Separate build targets; no such flag compiled into production (A6-03) | G, T (SEC-I07) | Tunnel route is a remote-attacker case |

### 6.4 AWS relay (API Gateway WebSocket, Lambda, DynamoDB, CloudFront and S3, CloudWatch and IAM)

| STRIDE | Component | Threat | Attacker | Mitigation | Status | Residual |
|---|---|---|---|---|---|---|
| S | API Gateway | Non-browser client forges Origin; stolen credential resumes | AT2 | Origin is defence in depth only; credentials and TV confirmation are the control (ADR-0003 s8); rotation (A3-07) | S*, T (SEC-A11, SEC-A09) | R8 |
| S | Lambda | Forged `sender_role` | AT2 | Role and room derived from the connection record (PROTOCOL s2) | S, T (SEC-A12) | None |
| T | Lambda and DynamoDB | Concurrent invocations race on slot claim, generation and sequence | AT2 | Conditional writes in one item or transaction (A3-10) | S*, T (SEC-A06, SEC-A13) | None |
| T | Relay | Duplicate keys or odd encodings forwarded unchanged | AT2 | Forward canonical re-serialisation (PK-04) | G, T (SEC-V03) | None |
| T | DynamoDB | Item tampering | AT4 | Least-privilege IAM, CloudTrail | S*, T (SEC-I01) | R1 |
| R | CloudWatch, CloudTrail | No trace of abuse, or traces that contain content | AT2 | Security-event logging without bodies; control-plane CloudTrail; bounded retention (A2-04) | S*, T (SEC-P02) | Per-message audit absent by design |
| I | Lambda, API Gateway, X-Ray | Bodies or credentials in execution logs, `console.log(event)`, traces | AT4, mistake | Assert execution data tracing off, X-Ray off, log whitelist (A2-05) | S*, T (SEC-I01, SEC-P02) | None |
| I | DynamoDB | Pairing code recoverable from a plain SHA-256 hash; point-in-time recovery retains deleted rooms | AT4 | HMAC with secret pepper (A3-04); PITR off or documented | G, T (SEC-I01) | R1 |
| I | Relay | Cross-room delivery through a connection-mapping bug; error oracles | AT2 | Isolation tests (SEC-A12); generic auth failure (A3-05) | S*, T | None |
| I | CloudFront and S3 | Standard logs record address and user agent; code in URL | AT4 | Fragment-only deep link; disable or truncate logs; disclose (A2-05) | S*, T (SEC-W02) | None |
| D | API Gateway | Connection flood, unauthenticated holds, no per-source concurrency cap; WAF may not attach to WebSocket APIs (verify at T10) | AT2 | Per-source `$connect` and concurrency budgets, live-room cap, throttling, optional CloudFront and WAF in front (A3-03, A3-09) | S*, T (SEC-A03, SEC-I03, SEC-I08) | Denial of wallet bounded, not eliminated |
| D | Lambda and DynamoDB | Cost amplification: each message costs invocations and reads | AT2 (paired) | Reserved concurrency, stage throttles, budget alarm is an alert not a cap, kill-switch runbook | G (TM-G5), T (SEC-I03) | R13 |
| D | Relay | 2-hour connection lifetime, idle timeout, GoneException | Platform | Re-dial at 110 minutes, heartbeat, tolerate GoneException (ADR-0006) | S, T (SEC-I04) | None |
| E | IAM | Over-broad policy (wildcards, `Scan`, unscoped `ManageConnections`) | AT4, mistake | Least privilege assertions | S* (master prompt s9), T (SEC-I01) | None |
| E | S3 and CloudFront | Public bucket, website endpoint, direct anonymous origin | AT2 | Private bucket, OAC, public-access block, direct-access denial test | S* (master prompt s9), T (SEC-I02) | None |
| E | Build and deploy | Root credentials, secrets in the template, unreviewed deploy | AT4, supply chain | No root use (B-003, D-012); SSM or Secrets Manager; reviewed pipeline | G (TM-G6), T (SEC-I05, SEC-I06) | R1 |

### 6.5 Pairing

| STRIDE | Threat | Attacker | Mitigation (ADR-0003) | Status | Residual |
|---|---|---|---|---|---|
| S | Attacker obtains the code (screen, photo, video call) and joins | AT1, AT2 | 10-minute single-use code; TV confirmation; digit comparison; burn on reject; number matching (A3-02, A3-06) | S* | R7 |
| S | Attacker guesses codes (22^6, 26.8 bits) | AT2 | Per-source budget with delay; live-room cap; `$connect` budget (A3-03). With 10,000 sources and 100 live rooms, about 8% chance of a pending join per 10 minutes (ADR_REVIEW s6) | S* | Spurious prompts, not takeover |
| S | Attacker runs a room and lures a phone into it (link or QR) | AT3, AT2 | Phone-side confirmation, fragment-only link (A3-01) | G (blocker) | None if adopted |
| T | Confirm redirected to another join, double accept, accept racing expiry | AT2 | `join_id` bound to room; one conditional write (A3-10) | S*, T (SEC-A06, SEC-A07) | None |
| R | User denies having accepted a pairing | n/a | None by design | accepted | none |
| I | Code in logs, URL, Referer, QR; code recoverable from storage; existence oracle through distinct errors | AT2, AT4 | Fragment-only; HMAC storage; generic failures (A3-01, A3-04, A3-05) | S*, T (SEC-A08) | R1 |
| D | Busy-slot griefing by re-requesting; household locked out by shared-NAT budget; `room.create` flood increases code density | AT1, AT2 | Burn on reject; delay instead of block; live-room cap (A3-02, A3-03) | S* | R6 |
| E | Supersede on resume takes over a live phone; phone operations from a connection without Origin; non-TV confirms joins | AT2 | Liveness rule and rotation (A3-07); origin state stored at `$connect` (A3-08); `join.confirm` only from the authenticated TV | S*, T (SEC-A09, SEC-A11, SEC-A12) | R2 |

### 6.6 Storage

| STRIDE | Store | Threat | Mitigation | Status | Residual |
|---|---|---|---|---|---|
| S | TV AsyncStorage | Another component writes `atr:` keys | Namespaced keys, validation on read (A5-05) | S* | Platform sandbox (unverified) |
| T | TV AsyncStorage | Corrupt or partial values crash the app or change history | Treat as absent, offer delete, schema validation | G, T (SEC-T04) | None |
| R | All | No audit of deletion | By design | accepted | none |
| I | TV AsyncStorage | Unencrypted phrases and summaries; backups | Minimization, 30-day (propose 8-day) retention, disclosure, delete flow (ADR-0005, A5-04) | S*, accepted | R3 |
| I | TV checkpoint | Unrevealed hidden verdict stored for resume | No verdict in checkpoint (A4-02) | G, T (SEC-T03) | None |
| I | Phone browser storage | Phrases or credentials persisted | Persist nothing (A5-02) | G, T (SEC-P06) | None |
| I | Relay store and logs | Payloads, phrases, addresses stored or logged | Hashes and ids only; hashed counters; content-free logs (ADR-0002, A2-03) | S*, T (SEC-P02, SEC-P07) | R1 |
| D | TV AsyncStorage | Slow or full storage blocks the UI | Bounded keys and retention, idempotent writes (ADR-0005) | S, T | None |
| E | Delete flow | Wrong keys deleted or remnants left; relay and phone untouched | Prefix-only delete, verify with `getAllKeys`, unpair and room close, phone clears (A5-01) | S*, T (SEC-T05) | Backup copies unverified |

## 7. Residual risks

| ID | Risk | Disposition |
|---|---|---|
| R1 | Compromised relay operator sees all plaintext payloads and can forge both roles (no end-to-end authentication). Raw audio is never transmitted, so the exposure is levels, voice-activity timing, phrases and listener answers. | Accepted and disclosed (ADR-0002 forbids "end-to-end encrypted"). A key agreement bound to the pairing step would remove forgery; out of scope for the core release. Owner: lead. |
| R2 | A compromised TV process holds the TV credential for up to 12 h. | Accepted (ADR-0003 consequences); shortened by A3-11. |
| R3 | AsyncStorage is unencrypted. | Disclosed. Production gate stays pending until a supported mechanism is qualified (master prompt s7). |
| R4 | The validator cannot stop a malicious client from encoding data in permitted fields. | R-X1 is enforced by code review, CSP `connect-src` and network inspection (SEC-P01); quantisation reduces capacity (PK-06). |
| R5 | TV speech or VoiceView during a window can be counted as voice and read as `reached`. | Reduced by suppression (A8-01), residual stated in the UI; T17 measures it. |
| R6 | Per-source limits behind shared NAT affect the real household. | Reduced by delay-instead-of-block (A3-03); tuned at staging. |
| R7 | The pairing code is visible to anyone who can see the TV screen. | Reduced by TV confirmation, burn on reject, number matching (A3-02, A3-06); residual accepted. |
| R8 | Non-browser attackers can forge Origin; the phone page can be cloned. | Origin is defence in depth only; credentials and TV confirmation are the controls. |
| R9 | `String.prototype.normalize` on Hermes is unverified. | Startup self-check on the VVD (PK-12). |
| R10 | API Gateway, WAF and CloudFront limits assumed in this review are unverified (no AWS access). | T10 must confirm against current AWS documentation (A3-09). |
| R11 | The phone is the trusted measurement source: a paired but malicious phone can fabricate results. | TV recompute and stream cross-check reduce but cannot remove it (A1-09). |
| R12 | A user CA installed on a phone for the local HTTPS route widens that phone's trust. | Name-constrained, short-lived CA, removal step (A6-03). |
| R13 | Denial of wallet: a paired or unpaired attacker can generate Lambda and DynamoDB cost; a budget alarm is not a cap. | Bounded by throttles, reserved concurrency and the live-room cap, not eliminated (TM-G5, SEC-I03). |

## 8. T16 security tests (the gate checklist)

Evidence classes: automated (A), real device or VVD (D), staging AWS (S, needs owner authorisation, B-003), static or IaC check (C), documentation review (R). "Dep" names a finding whose decision changes the expected result. Run every relay test against both adapters (local and AWS) where the adapter can differ.

### Authentication, pairing, authorisation

| ID | Test | Pass criterion | Class | Req and ADR | Dep |
|---|---|---|---|---|---|
| SEC-A01 | Send every one of the 37 types before authentication | Only `room.create`, `join.request`, `auth.resume`, `ping` are processed; all others `unauthenticated` and never forwarded | A | R-S4; ADR-0003 s1 | |
| SEC-A02 | Pre-auth limits: 6th message, 5 s deadline, 65 s with a pending join | Connection closed with no protected data; AWS timer mechanism proven on staging | A, S | R-S4; s1 | A3-09 |
| SEC-A03 | Brute force: wrong codes from one source, from many sources, IPv6 /64 rotation, shared-source real user | Per-source delay or limit applies at the stated thresholds; a different source still pairs; the real user is delayed, not locked out; counters hashed and expiring | A, S | R-S3; s7 | A3-03 |
| SEC-A04 | Randomness: relay uses a CSPRNG for code, digits, room id, credentials, join id | Chi-square uniformity over 100,000 codes and digits; no modulo bias; `cryptographic: true`; credential length 43; no use of the non-cryptographic id fallback | A, C | R-S3; s2 | A3-06 |
| SEC-A05 | Code lifecycle with a fake clock | Logical expiry at 10 min; single use; refresh invalidates the previous code; reject or expiry burns the code | A | R-S3; s2-s4 | A3-02 |
| SEC-A06 | Race: two phones, same code, 1,000 iterations; double accept; accept at the expiry boundary; confirm with a stale join_id | Exactly one pending, one `busy`; exactly one slot claim; no partial state (slot claimed, code unconsumed) | A, S | R-S3; s4 | A3-10 |
| SEC-A07 | TV confirmation is mandatory | No credential before accept; reject gives no credential; confirm from the phone role fails; confirm for another room's join fails | A | R-S3; s4 | |
| SEC-A08 | Credential handling | No credential, code or digits in logs, errors, URLs or diagnostics; wrong-role, wrong-room, expired and revoked credentials return the generic failure | A | R-S3; s11 | A3-05 |
| SEC-A09 | Resume and supersede | New generation, old connection closed `superseded`, old-generation messages `stale`; resume that would supersede a live connection refused; TV notified; open window cancelled; consumed credential detection | A | R-S3, R-S6; s5 | A3-07 |
| SEC-A10 | Revocation and expiry | `unpair` closes the phone connection and resume returns `revoked`; message in flight after `unpair` rejected; credential expiry mid-session enforced on the next message with a fake clock; no reliance on TTL deletion | A, S | R-S3, R-S6; s6, s9 | A3-11 |
| SEC-A11 | Origin rules | Allowlisted accepted; foreign and `Origin: null` rejected at `$connect`; phone operations without an allowlisted Origin rejected; TV operations allowed without Origin only for `room.create` and TV `auth.resume`; preview origin cannot act as phone; production config has no dev origin; header lookup case-insensitive | A, C | R-S4; s8 | A3-08 |
| SEC-A12 | Role and room isolation | Full type-by-role matrix (37 x 2); cross-room replay of a valid message rejected; 10,000 messages across 20 concurrent rooms never cross-delivered; TV rejects `sender_role` tv or relay and TV-only types arriving from the peer side | A | R-S2, R-S5; s9 | PK-10 |
| SEC-A13 | Replay and duplicates | Duplicate `message_id` dropped silently with metric; old sequence with new id gives `replay`; old generation gives `stale`; dedupe scoped per role; id not burned by a rate-limited message | A | R-S6; s10 | PK-08 |
| SEC-A14 | Reconnect behaviour | No reconnect after `revoked`, `expired`, `unauthorized`, `superseded`, `unpaired`; jittered backoff; `auth.resume` failure limit per source and per room | A | R-S6; ADR-0006 | A6-02, A3-05 |

### Protocol and validation

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-V01 | Convert `docs/security/probes/protocol_probes.mjs` to vitest cases | Every PASS row stays PASS; each GAP row matches the lead's recorded decision; the FAIL row (PK-01) is fixed | A | R-S1, R-S5 | PK-01 to PK-11 |
| SEC-V02 | Raw-frame-only intake | Relay and TV call `parseWireMessage` on text frames only; binary frames close 1003; static check that no `JSON.parse` of network data exists outside the package | A, C | R-S5 | PK-09, PK-10 |
| SEC-V03 | Canonical forwarding | Forwarded bytes equal `JSON.stringify` of the clean copy; duplicate-key, whitespace and escape variants collapse | A | R-S5 | PK-04 |
| SEC-V04 | Cross-field invariants and TV recompute | Probes P01 to P17 rejected or marked `integrity`, never scored | A | R-S5 | PK-02, A1-09 |
| SEC-V05 | Text policy | Bidi controls, separators, tag characters, visually empty and long combining runs rejected; Persian ZWNJ, Devanagari ZWJ, Arabic, Hebrew, emoji ZWJ accepted | A | R-S5 | PK-03 |
| SEC-V06 | Audio guard and quantisation | Keys, strings over 256, arrays over 16, typed arrays rejected; numeric fields quantised as decided | A | R-X1 | PK-06 |
| SEC-V07 | Size, rate, compression | 8,193-byte frame rejected; phone 40 per second (burst 60) and TV 20 per second (burst 40) enforced then close 4429 or its AWS equivalent; `permessage-deflate` not negotiated on the local server | A | R-S5 | A6-03 |
| SEC-V08 | Fuzz | 1,000,000 mutated frames: no exception, no parse slower than 25 ms, no prototype pollution, no echo of input in `detail` | A | R-S5 | |

### Privacy, logging, network

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-P01 | Network payload audit across a full run (pair, quiet check, calibration, vowel, ten phrases, summary, delete) | No binary frames; no string over 256 or array over 16; only catalogue types; numeric precision as decided; the field inventory equals the ADR-0002 table (a new field fails the test) | A, D | R-X1 | A2-01, PK-06 |
| SEC-P02 | Log redaction | Feed every message type and error through the logger of both adapters; no credentials, codes, digits, phrases, cue text, device labels, addresses or bodies; staging log inspection | A, S | R-S3 | A2-04 |
| SEC-P03 | Copy equals categories | Static test: every payload field maps to a disclosed category; every disclosed category maps to a field | A | R-X2 | A2-01, A2-02 |
| SEC-P04 | Forbidden claims | UI strings, README and docs contain none of "end-to-end", "never inspects", "only numbers", "no data leaves" | A | R-X2 | |
| SEC-P05 | No recording path | Static scan: no `MediaRecorder`, no `getUserMedia` outside `phone-mic-meter`, no network call to a non-relay origin, no analytics or beacon; CSP `connect-src` equals the relay origins | A, C | R-X1 | |
| SEC-P06 | Phone storage audit after a full session, unpair and TV delete | localStorage, sessionStorage, IndexedDB, Cache API and cookies contain no phrases or credentials | D | R-ST1 | A5-02 |
| SEC-P07 | Relay storage audit | After a session only allowed attributes exist (hashes, ids, timestamps, hashed counters); no phrases or levels; TTL attribute set; expired items unusable before TTL deletion | A, S | R-ST1, R-S6 | A2-03 |

### Phone page

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-W01 | XSS | Markup in phrases, cue, labels and error strings renders literally on phone and TV; no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`; CSP has no `unsafe-inline` or `unsafe-eval` | A, C | R-S5 | |
| SEC-W02 | Response headers | CSP, HSTS, `Permissions-Policy: microphone=(self)`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, cache policy present on staging CloudFront and the local relay | S, A | R-X1 | TM-G4 |
| SEC-W03 | Deep link and QR | Code only, in the fragment, never query or path; no auto-join; a hostile QR sends no `phrases.update`, no `mic.state` and cannot start the mic before the digit confirmation | A, D | R-S3 | A3-01 |
| SEC-W04 | Framing | The page refuses to render in an iframe | A | R-S4 | TM-G4 |
| SEC-W05 | Microphone lifecycle | Tracks stopped, wake lock released, AudioContext closed on `session.end`, `unpaired`, expiry, `pagehide`, `visibilitychange` and track-ended | D | R-X1 | needs a physical phone (B-002) |
| SEC-W06 | Activation budget | The phone rejects `window.start` outside its state machine (no `session.begin`, wrong order, duplicate, over maximum duration, over the session budget, inside cooldown); mic closes after the idle timeout | A | R-S5 | TM-G1 |
| SEC-W07 | Cross-site WebSocket hijacking | A page on a foreign origin cannot complete the WebSocket handshake; an allowlisted origin can | A, S | R-S4 | A3-08 |

### TV app and storage

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-T01 | Transport policy | The TV refuses `ws://` to a non-loopback host and uses the build-time relay host | A | R-S4 | |
| SEC-T02 | Hidden-meter leak scan | Serialise every `TvView` for a hidden attempt from capture to reveal across all reachable screens (Settings, History, Diagnostics, dialogs, resume): `meter` null, no level, verdict, validity or reason fields; announcements neutral; the flow for valid and invalid windows is identical until reveal; accessibility tree snapshot on the VVD | A, D | R-U4, R-M6 | A4-01, A4-03 |
| SEC-T03 | Crash and resume | Kill at every stage including hidden `response_pending`: no verdict shown after resume, attempt `interrupted`, storage holds no pre-reveal result | A | R-ST1 | A4-02 |
| SEC-T04 | Storage content and retention | Keys only `atr:v1:*`; no credentials, codes, labels or phrase text in summaries; 31-day-old summary pruned (or 9-day-old if the retention is cut to 8 days, A5-04); checkpoint older than 12 h discarded; corrupt value handled | A | R-ST1 | A5-03, A5-04 |
| SEC-T05 | Delete flow | Default focus Cancel; all `atr:` keys removed and verified; partial failure surfaced; `unpair` and room close attempted; phone clears; other keys untouched | A, D | R-ST1 | A5-01 |
| SEC-T06 | Device and console logs | Scan logs from an end-to-end run for credentials, codes and phrases | D | R-X1, R-ST1 | |
| SEC-T07 | Flood | 100,000 level frames per second from a simulated phone: bounded memory and CPU; frames beyond 700 per window and duplicate `frame_index` ignored | A | R-S5 | |
| SEC-T08 | Cue and listener state | Cue cap 3; cues rejected outside between-window states; first listener response wins; late response stored as decided | A | R-S5 | A4-05, A4-07 |
| SEC-T09 | Unicode rendering | Bidi, combining and emoji phrases do not break TV layout | D | R-U4 | PK-03 |

### Infrastructure, operations, supply chain (AWS tests need owner authorisation and a non-root deployment path, B-003)

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-I01 | IaC assertions | S3 public-access block and OAC, no website endpoint; DynamoDB encryption at rest, TTL attribute, PITR off or documented; IAM without wildcards or `Scan`, `ManageConnections` scoped; Lambda reserved concurrency; stage throttles; execution data tracing off, X-Ray off, access-log whitelist, log retention bounded; no secrets in the template | C | R-S6, R-X1 | A2-05 |
| SEC-I02 | Anonymous origin denial | Direct bucket URL returns 403 | S | R-S4 | |
| SEC-I03 | Rate and cost controls | Throttles effective in a staging load test within budget; alarms evaluate; kill-switch runbook executed once | S | R-S6 | TM-G5 |
| SEC-I04 | Connection lifecycle | GoneException handled; 2-hour re-dial; idle timeout; missed `$disconnect` cleaned up | S | R-S6 | |
| SEC-I05 | Supply chain | Lockfile integrity; `npm audit --omit=dev` with no unresolved high or critical; SBOM and licences; no unreviewed install scripts; phone bundle contains no third-party network calls; build hash recorded | C | R-X1 | A7-01 |
| SEC-I06 | Secrets scan | None in the repository, artifacts or evidence logs | C | R-S3 | |
| SEC-I07 | Local relay hardening | Stated bind interface, TLS only; no any-origin or `platform: test` bypass compiled into a production build; CA procedure documented (name-constrained, short-lived) | C, R | R-S4 | A6-03 |
| SEC-I08 | AWS deadline equivalence | The 5 s and 65 s pre-auth deadlines and the documented close behaviour work on staging | S | R-S4 | A3-09 |
| SEC-I09 | No polling surface | The relay exposes only the WebSocket upgrade and the static page; any other HTTP route is 404; no payload buffering endpoint | A, S | R-L2 | |

### Measurement and qualification integrity

| ID | Test | Pass criterion | Class | Req | Dep |
|---|---|---|---|---|---|
| SEC-M01 | Inconsistent results | Messages P01 to P17 never produce a verdict | A | R-S5, R-M6 | PK-02 |
| SEC-M02 | Stream versus summary | `window.result` that disagrees with the received level stream beyond tolerance is flagged `integrity` | A | R-M6 | A1-09 |
| SEC-M03 | Silent-window noise | Edge-of-validity AR(1) noise, silent 8 s window, 10,000 trials: P(`active_ms >= 400`) at most 1% | A | R-M6 | A1-03 |
| SEC-M04 | Transient phase sweep | 100, 150, 200 ms bursts at 20 or more phases and two levels: never accepted at or below 100 ms, always at 200 ms and above | A | R-M6 | A1-01 |
| SEC-M05 | Muted input | All-zero and sub-threshold input make the quiet check invalid | A | R-M6 | A1-05 |
| SEC-M06 | Qualification gate | A recorded failing experiment sets status failed and hides band verdicts; a synthetic 3:1 compression series fails the slope criterion; unknown devices are `not_run` | A | R-Q1 | A9-01, A9-02 |

## 9. Threat-model gaps and decisions needed

| ID | Gap | Owner |
|---|---|---|
| TM-G1 | The phone needs its own state machine for TV commands: accept `window.start` only after `session.begin` and a user-started mic, enforce maximum durations, a per-session measurement budget (start at 5 minutes), cooldown between windows, an idle timeout, and a visible Measuring badge. Without it a hostile TV or relay can request level frames at will during a session. | T08 phone, lead |
| TM-G2 | One shared `processInbound` entry in the relay core (PK-10) so both adapters apply every PROTOCOL s4 step in order. | T07 relay |
| TM-G3 | TV inbound check: reject `sender_role` tv or relay and TV-only types on the receive path. | session, tv |
| TM-G4 | No ADR specifies response headers or CSP for the phone page (master prompt s9 does). Add: CSP (`default-src 'none'`, `script-src 'self'`, `connect-src` relay only, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`), HSTS, `Permissions-Policy: microphone=(self)`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. | T10 infra |
| TM-G5 | Denial-of-wallet controls are not specified: Lambda reserved concurrency, stage and route throttles, budget alert (an alert, not a cap), kill-switch runbook. | T10 infra |
| TM-G6 | Secret handling: HMAC pepper in SSM or Secrets Manager; deployment without root credentials; separate staging and production roles. | T10 infra, owner |
| TM-G7 | Decide whether to adopt rotating credentials (A3-07) and protocol revision 3 now, before the relay and phone freeze their message handling. | lead |

# Relay security notes

Scope: `services/relay` (core, local server, Lambda adapter) and `infra/`. Specs: ADR-0002 (privacy and logging), ADR-0003 (pairing and authentication), ADR-0006 (transport), PROTOCOL.md revision 2. This is the implementer's account for the independent security review; it is not a review.

Evidence class of everything here: **automated** (unit and local integration tests) and **documentation_only**. Nothing was exercised against AWS.

## 1. What the relay validates on every message

Order follows PROTOCOL.md section 4 (the validator is `@atr/protocol`, reached through `src/core/protocol-port.ts`):

1. Frame: text only (binary: `binary_rejected`, close 1003), at most 8192 UTF-8 bytes (`payload_too_large`, close 1009).
2. JSON object with exactly the twelve envelope fields and `protocol_version` 1; unknown type; audio guard (keys `audio`, `pcm`, `samples`, `waveform`, `blob`, `buffer`, `data` at any depth, strings over 256 code points, arrays over 16, binary values: `audio_rejected`); envelope formats, identity binding and room rule; exact payload schema with ranges and enums (`bad_schema`).
3. Authentication phase: before authentication only `room.create`, `join.request`, `auth.resume` and `ping`; at most 5 messages and 5 s (65 s while a join is pending), enforced on every message and by the sweep.
4. Per message once authenticated, on **every** message and from stored state (not from connection memory): room exists and is not closed; room not past its 12 h life; role credential exists (not revoked), not expired; connection generation equals the slot's current generation (else `superseded` and close); `sender_role` equals the authenticated role; the type may be sent by that role; the envelope `room_id` equals the connection's room; rate limits (burst and sustained windows); session binding (`stale` for a session id other than the room's active one); peer presence; duplicate `message_id` (silent drop); `producer_generation` equals current (`stale`); strictly increasing sequence (`replay`); per-session cue counter (`cue_limit`, three per session).
5. Forwarding: the exact text received is forwarded to the peer of the same room; the relay adds nothing to forwarded messages.

Credentials and codes: 32 random bytes (43 base64url characters) from `node:crypto`; stored only as domain-separated SHA-256; compared with `timingSafeEqual` on equal-length digests. Pairing codes: six characters of the 22-character alphabet by rejection sampling (bytes 242 to 255 discarded, so no modulo bias; tested exhaustively and statistically), stored as SHA-256 keyed with a server-side pepper because the code space is only about 26.8 bits. Confirm digits: two digits by rejection sampling.

## 2. What the relay does not validate or protect

- **Meaning and truth of content.** Phrases, cue words, level values, device labels and `mic.state.mode` are checked for shape, range and size only. A client can send false microphone state or invented levels; the TV must treat observations as untrusted application data.
- **Device identity.** There is no device attestation. The TV credential is a bearer secret held in app memory for 12 h (ADR-0003); whoever holds it is the TV. `Origin` is a browser protection against cross-site WebSocket hijacking, not identity: non-browser clients can set any `Origin`.
- **Confidentiality from the relay and the platform.** TLS protects client to relay only. The relay (and AWS API Gateway and Lambda in transit) handle plaintext payloads in memory. The product copy must keep the ADR-0002 wording ("validates without content logging or persistence"); the forbidden claims "end-to-end encrypted" and "relay never inspects payloads" are false for this design.
- **Message authenticity beyond the connection.** Messages are not individually signed. Integrity rests on TLS plus per-connection authentication; a compromised credential holder can send anything its role may send, in order.
- **Application state of the TV and phone.** The relay does not know TV stages, windows or attempts. It binds only room, role, generation, sequence and the active session id. Window and attempt identity are checked by the receivers (PROTOCOL.md section 4 step 10).
- **Delivery.** At-most-once forwarding with no queue. A peer that is offline gets `not_found` (level frames are dropped silently). In the Lambda adapter, concurrent invocations of one connection's messages can run out of order, so an individual `level` frame can be rejected as `replay` or forwarded late; the TV accounts frames by `frame_index` and coverage, and the window validity rules absorb gaps.

## 3. Close codes and error codes used

Close codes: 1003 binary frame; 1009 oversize; 4401 authentication deadline missed, credential expired or revoked, unknown connection; 4403 origin rejected; 4408 idle past the 25 s heartbeat window; 4409 superseded by a newer connection of the same role; 4410 unpaired; 4411 room closed; 4429 too many unauthenticated messages, too many invalid messages, or sustained rate abuse; 4503 kill switch. API Gateway's Management API cannot choose a close code: in the Lambda adapter a `close` action is a `DeleteConnection` (the preceding `error` message carries the reason) and a refused `$connect` is HTTP 403 (origin) or 503 (kill switch). The local server uses the codes above.

The relay never sends credentials, pairing codes or payload content in `error.detail`: details are constant strings.

## 4. Threats and where each is handled

| Threat | Mitigation | Residual risk |
|---|---|---|
| Cross-site WebSocket hijack | No cookies or ambient credentials; first-message authentication; exact `Origin` allowlist (no wildcards, no suffix or case matching); phone-role operations require an allowlisted Origin | Non-browser forgery of `Origin` (not a goal) |
| Guessing a pairing code | 26.8-bit code, 10 minute life, one use, explicit TV confirmation with two-digit match on both screens; 3 failures per connection (then close), 10 failures per source per 10 minutes, `join_failed` metric and alarm (30 per 5 minutes) | A distributed attacker with many sources can still try about 10 codes per source per window; success additionally needs the TV user to press Accept for an unknown device label. There is no global failure circuit breaker on purpose (it would let an attacker lock everyone out). |
| Guessing or stealing a credential | 256-bit random, hash at rest, constant-time compare, 12 h life, revocation on `unpair` and `room.close`, `resume` failures limited like join failures | Bearer secret in TV or phone memory; theft from a compromised device |
| Role takeover and races | Single-slot phone claim by conditional write; one pending join per room by conditional put; single winner per join resolution; generation bump with supersede on resume | None known; covered by concurrent-claim tests on both stores |
| Replay and duplicates | Strict per-generation sequence by conditional write; duplicate ids dropped silently inside the recent window; stale generations rejected | DynamoDB keeps recent ids for 60 s rather than the last 1024 ids (a count window needs a hot item); the sequence check remains the hard guarantee |
| Pre-authentication resource use | 5 s deadline, 5 messages, 8 KB frames, no protected data before authentication, room creation limited to 10 per source per hour, API Gateway throttle | Public WebSocket endpoint: anyone can open connections within the throttle |
| Payload abuse (oversize, nesting, audio) | Size limit by bytes, depth cap, audio guard, exact schemas | None known |
| Log leakage | Redacting logger with closed vocabularies; core emits only allowlisted events; Lambda adapter never logs events or error objects; tests scan all log output for credentials, codes, phrases, cue text, labels, addresses, full ids | Platform logs outside our control (see below) |
| Source address exposure | Addresses are hashed with the pepper before use, never stored or logged raw by the relay | An unset or leaked pepper makes the 32-bit IPv4 space brute-forceable from the stored hash; set `HashPepper`. API Gateway and CloudFront may keep their own records; this template enables **no** API Gateway access or execution logging and no CloudFront logging. **Never enable API Gateway execution logging with data tracing: it logs message bodies.** |
| Denial of service and cost | Stage throttle, reserved concurrency, kill switch, alarms, budget alert (COST.md section 4) | A budget alert is not a cap; sustained abuse inside the throttle still costs money |
| Stale or lost connections | Heartbeat window (local sweep), `$disconnect`, `GoneException` handling deletes the stale connection and notifies the peer | `$disconnect` is best effort and the Lambda deployment runs no scheduled sweep, so a silently vanished peer is noticed only when a send hits `GoneException` or the client's own heartbeat times out |
| Phone page tampering or exfiltration | Private S3 bucket (public access blocked, bucket owner enforced, TLS-only policy), CloudFront OAC with always-sign, bucket policy scoped to the distribution ARN, CSP `default-src 'self'` with `connect-src` limited to self and the relay wss origin, `script-src 'self'`, no framing | CloudFront default certificate allows TLS 1.0 and above (a custom domain with ACM is needed for a 1.2 minimum); no WAF; anyone with deploy rights can change the page |
| Local development relay on a LAN | TLS required (refuses to start without it), certificates from a name-constrained local CA, loopback-only plain mode; HSTS only over TLS (5 minutes by default) | The CA must be trusted on the phone; a leaked `ca.key` could mint certificates for local names only (name constraints), which are still dangerous on that LAN |
| Pepper and configuration secrets | `HashPepper` is `NoEcho` | Stored in the Lambda environment configuration, readable by anyone with `lambda:GetFunctionConfiguration`; defence in depth, not vault-grade |

## 5. Properties for the reviewer to attack

1. A second connection can never use the room's single phone slot or reuse a consumed code, including under concurrency (see `test/core.pairing.test.ts` "claims the single phone slot exactly once", the store conformance suite).
2. No path forwards a message before authentication or after revocation, expiry or supersede: try every state transition mid-stream.
3. Duplicate and replay handling at generation boundaries (resume while frames are in flight).
4. Origin matrix, especially phone-role operations with a missing Origin and TV-role operations with a foreign Origin.
5. Log output for every message type and failure path (run `services/relay/test/redaction.test.ts`, then try new sentinel content).
6. DynamoDB expression correctness against the real service (the fake model is strict about placeholders but is not DynamoDB; `ConditionExpression` and `UpdateExpression` strings in `src/aws/dynamo-store.ts` should be run against DynamoDB Local or a staging table).
7. IAM scope in `infra/template.yaml` (function role) and `infra/iam/*.json` (drafts that have never been used).

## 6. Not yet exercised (pending external checks)

Real API Gateway behaviour (handshake status codes, `DeleteConnection` effect, `GoneException` timing, `$disconnect` delivery), real DynamoDB conditional semantics under load, CloudFront OAC and header behaviour, alarm and budget notification delivery, kill-switch rehearsal, physical-phone TLS trust with the local CA, and the Vega virtual device connecting to a locally generated certificate (not tested: do not promise self-signed WSS works on Vega).

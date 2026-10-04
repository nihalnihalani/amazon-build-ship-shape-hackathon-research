# ADR-0003: Pairing, authentication and per-message authorization

- Status: accepted (revision 1)
- Date: 2026-10-05
- Amended: revision 2 decisions in [AMENDMENTS-REV2.md](AMENDMENTS-REV2.md) override conflicting text below (2026-10-05)

## Context

Browsers cannot attach arbitrary headers to WebSocket handshakes. API Gateway's Lambda authorizer runs only at `$connect`. A short human code is guessable and must not authenticate anything by itself. Native Vega clients may send no `Origin` header.

## Decision: first-message authentication over WSS

1. **Unauthenticated phase.** A new connection may send only `room.create`, `join.request`, `auth.resume` or `ping`. It must authenticate (successful `room.created`, `join.accepted` or `auth.ok`) within **5 s** of opening, or within **65 s** while a join request is pending TV confirmation; otherwise the relay closes it (close code 4401). At most 5 unauthenticated messages per connection.
2. **Room creation (TV).** `room.create` → relay creates `room_id` (`r_` + 128-bit random base64url), a 6-character pairing code from the alphabet `ACDEFHJKMNPRTUVWXY3479` (22 characters, about 113 million codes; stored as SHA-256 hash), and a TV credential (256-bit random, base64url; stored as SHA-256 hash). The connection becomes `tv` for that room. Code expiry 10 min; credential expiry 12 h; room absolute expiry 12 h.
3. **Join (phone).** `join.request {pairing_code, device_label}` → if the code exists, is unexpired and unconsumed, the relay creates a join request (`join_id`, 60 s expiry) with a 2-digit `confirm_digits` value, tells the phone `join.pending {join_id, confirm_digits}` and tells the TV `join.requested {join_id, device_label, confirm_digits}`. Both screens show the digits.
4. **TV confirmation.** The TV user selects Accept or Reject. `join.confirm {join_id, decision}` from the authenticated TV. On accept the relay **atomically** claims the single phone slot (conditional write: slot empty), marks the code consumed, issues a phone credential (256-bit, 12 h, hash stored), and sends `join.accepted`. On reject → `join.rejected`. A second concurrent join for the same room while one is pending is refused (`join_busy`).
5. **Resume.** `auth.resume {room_id, role, credential}` → verify hash (constant-time compare), role slot, expiry and revocation. On success the role's `producer_generation` increments; any older connection for that role receives `error {code: superseded}` and is closed. Messages carrying an old generation are rejected as `stale`.
6. **Revocation.** `unpair` (TV) revokes the phone credential, clears the slot and closes the phone connection (`unpaired`). Room expiry or TV `room.close` revokes everything.
7. **Rate limits.** Pre-auth: `join.request` failures limited to 10 per source address per 10 min and 3 per connection; `room.create` limited to 10 per source address per hour; global failed-join counter metric. Authenticated: phone ≤ 40 messages/s (burst 60), TV ≤ 20 messages/s (burst 40). Exceeding → `error {code: rate_limited}`; sustained abuse → close 4429.
8. **Origin policy.** If an `Origin` header is present it must exactly match the configured allowlist (phone page origin; TV web-preview origin in development). A missing `Origin` is allowed **only** for TV-role operations (`room.create`, `auth.resume` with role `tv`); phone-role operations (`join.request`, phone `auth.resume`) require an allowlisted Origin. This defends browsers against cross-site WebSocket hijacking; it is not authentication (non-browser clients can forge Origin).
9. **Per-message authorization.** Every protected message is checked for: authenticated role equals `sender_role`; `room_id` equals the connection's room; credential not expired or revoked (logical check on every message — TTL cleanup is not revocation); generation equals the current one; `sequence` strictly greater than the last accepted from that producer generation; message type allowed for that direction (see PROTOCOL.md direction table); schema and size limits; rate limits.
10. **Replay and duplicates.** Duplicate `message_id` within the room's recent window (last 1024 ids) → dropped silently (not forwarded, no error; metric `duplicate_dropped`). Non-increasing sequence with a new `message_id` → `error {code: replay}`. Amended 2026-10-05 (PROTOCOL.md revision 2).
11. **Credential handling.** Credentials appear only in `room.created`, `join.accepted` and `auth.resume`. They are held in memory by clients (the TV does not persist them; after a TV app restart the phone pairs again). Logs never contain credentials or pairing codes.

## Consequences

- No ambient credentials exist, so CSWSH cannot ride a cookie; Origin checks are defence in depth.
- The TV credential is a bearer secret held in app memory; a compromised TV process can act as the TV for 12 h. Accepted for this scope.
- API Gateway: `$connect` performs only the Origin allowlist check (no authorizer); `$default` routes everything to the relay handler, which implements this ADR using the shared relay core.

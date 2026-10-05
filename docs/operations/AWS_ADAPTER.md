# AWS adapter: proposed ADR-0003 section

Status: **proposed text for the lead to fold into `docs/adr/ADR-0003-*`** (ADRs are shared files; this implements AMENDMENTS-REV2 row A3-09). Everything below is implemented and tested against fakes and the strict DynamoDB model; **none of it has run on AWS** (blocker B-003), and AMENDMENTS row A3-09 says "verified at T10", which still needs a staging account.

## The problem

The relay core keeps no per-connection state and API Gateway gives a Lambda no per-connection timer. The authentication deadlines of ADR-0003 section 1 (5 seconds to authenticate, 65 seconds while a join request is pending) are therefore not something an adapter can wait for. The local adapter enforces them with a sweep every few seconds. The AWS adapter enforces them with an SQS delay queue.

## The mechanism

1. The core asks for a check by returning a `schedule` action `{connId, delayMs}`; it does so after `$connect` (5 s), after a `join.request` (65 s) and after a pending join was ended by a TV reject, a wrong number pick or an expiry (5 s, so the phone is dropped promptly after the verdict).
2. The relay Lambda turns each `schedule` action into an SQS `SendMessage` with `DelaySeconds` set to that delay (at most 900) and a body of exactly `{"c": connection id, "d": API domain, "s": stage}` (no secret, no content). The queue has a 5 s default delay, one hour retention, SQS-managed encryption, a TLS-only policy and a dead-letter queue after three receives.
3. A second Lambda (`deadline.handler`, same bundle) consumes the queue with partial-batch failure reporting and a concurrency cap, and calls `RelayCore.onDeadlineCheck(connId)`. The check reads the connection record: an authenticated or vanished connection is left alone; a connection whose deadline is still in the future is left alone (an early delivery is harmless); a pending join past its 60 s life is expired first (the phone gets `join.rejected {expired}`, the TV gets `join.expired` and a fresh `pairing.code`, the code is burned, the source is counted) and the 5 s check is queued; an unauthenticated connection past its deadline gets `error {unauthenticated, auth_deadline}` and is deleted with `DeleteConnection`.
4. The consumer validates the body strictly (a connection id of 1 to 128 characters, an API Gateway domain and a stage matching fixed patterns) and builds the Management API endpoint from it. A message that does not match is dropped, not retried, and no AWS call is made: a forged message cannot point the client at another host. A message that fails for any other reason is retried and ends in the dead-letter queue (alarm `deadline-dlq`).

## Client-visible behaviour

- The client receives an `error` message (`unauthenticated`, detail `auth_deadline`), then the socket is closed. API Gateway's Management API cannot choose a close code, so there is no 4401 on AWS; the `error` message carries the reason. The local adapter sends the same `error` and then closes with 4401. **At the message level the two adapters are identical**; `services/relay/test/aws-adapter.test.ts` runs the same scenarios through both and compares the messages each side receives (unauthenticated connection, and a pending join that is never answered).
- Refused handshakes are HTTP 403 (origin), 429 (connect budget or concurrent-unauthenticated cap) and 503 (kill switch); the local server uses the same statuses.
- Timing on AWS is "about" the stated delay: SQS delivers at or after `DelaySeconds`, plus polling and invocation latency (typically within a few seconds, unmeasured). The check also runs logically: every message from an unauthenticated connection first compares the clock with its deadline, so a late queue message delays the close and never lets anything through.

## Failure modes

| Failure | Effect | Why it is acceptable |
|---|---|---|
| The queue send fails (outage, missing permission) | `$connect` still succeeds, an `internal_error` line is logged without detail, no check is queued | The deadline is still enforced logically on the connection's next message; the connection cannot do anything unauthenticated in the meantime (only the four pre-auth types are processed, at most 5 messages) |
| The consumer fails or is behind | Unauthenticated connections stay open longer; alarms `deadline-errors`, `deadline-queue-age`, `deadline-dlq` | Same: nothing is permitted before authentication, and API Gateway's own 10 minute idle timeout and 2 hour limit bound it |
| A check arrives early, twice, or for a connection that is gone | No effect | The check is idempotent |
| The Management API reports the connection gone (`GoneException`) | The connection record and its unauthenticated slot are cleaned up through the normal disconnect path | Same handling as every other send |

## Cost and abuse

Each connection costs one SQS send, receive and delete (three requests), plus one consumer invocation and one connection read; each pairing queues three messages (COST.md). The consumer cannot scale past five concurrent invocations; the per-source `$connect` budget (20 a minute) and concurrent unauthenticated cap (5) bound how many messages one source can queue. The dead-letter alarm and the queue-age alarm are in `infra/template.yaml`; the runbook steps are in RUNBOOK.md section 7.

## Related adapter facts worth recording in the ADR

- The relay function and the consumer share one core and one store; the hashing secret is read from an SSM SecureString by both (never an environment value), and the core is rebuilt when the value changes.
- The AWS adapter does not run the idle sweep (`onTick`): authenticated connections that go silent are noticed on the next failed send (`GoneException`) or by the client's own heartbeat. Neither function role has `dynamodb:Scan`.
- The room cap uses a sparse, keys-only global secondary index (`live-rooms`) and the only `Query` permission is on that index.
- Logs: no line per message; per-minute aggregates (the Lambda container writes the previous minute on its next invocation, so a recycled container can lose its last minute); EMF metrics carry the security counters only.

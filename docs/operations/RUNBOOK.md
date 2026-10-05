# Relay operations runbook

Applies to the AWS staging or production stack defined in `infra/template.yaml` (stack names start with `atr-relay-`). **No stack exists yet** (blocker B-003: the credentials on the build machine are the account root user and there is no spend authorization). Every command below is for the owner, run with the deployer role from `infra/iam/`, not with root keys. Commands are written in AWS CLI form; replace `<stage>` with `staging` or `prod` and `<region>` with the deployed region (ap-south-1 is intended; confirm at deploy time).

What has and has not been proven is stated in each section. Nothing here has been rehearsed against AWS.

## 1. Alarms and what to do

| Alarm (`atr-relay-<stage>-...`) | Means | First checks | Action |
|---|---|---|---|
| `lambda-errors` | 5 or more Lambda errors in 5 minutes | CloudWatch Logs `/aws/lambda/atr-relay-<stage>`: look for `internal_error` lines (the only error line; it deliberately carries no detail). Check DynamoDB throttling and a recent deploy. | If it follows a deploy: roll back (section 3). If DynamoDB is throttling or failing: wait or switch the kill switch on (section 2) to stop client retries. A cold-start configuration error (`TABLE_NAME` or `ALLOWED_ORIGINS` missing) fails every invocation: fix the stack parameters. |
| `lambda-throttles` | Invocations were refused because the concurrency ceiling was reached | Compare `ConcurrentExecutions` with `ReservedConcurrency`; check for abuse (`rate_limited` log lines, `join_failed` metric) | Abuse: kill switch. Legitimate load: raise `ReservedConcurrency` (check account quota) and re-evaluate the stage throttle (COST.md). |
| `lambda-concurrency` | Peak concurrency reached 80 percent of the reservation for 2 of 3 minutes | Same as above | Same as above. This alarm does not exist when `ReservedConcurrency` is `-1`. |
| `apigw-integration-errors` | API Gateway could not get a good answer from Lambda (5 or more in 5 minutes) | Lambda errors and throttles; Lambda timeout (10 s) | As `lambda-errors`. |
| `apigw-execution-errors` | API Gateway itself failed to run the route (5 or more in 5 minutes) | Stage and route configuration, a deployment in progress | Check the stack events; redeploy the previous version (section 3). |
| `join-failures` | 30 or more failed pairing attempts in 5 minutes (custom `join_failed` metric) | Logs Insights query below; the relay's own limits already close offenders | Possible code guessing. If it persists, kill switch on, then investigate before turning it off. Pairing codes live 10 minutes, so the exposure window is small. |
| `auth-failures` | 30 or more failed credential resumes in 5 minutes (custom `auth_failed` metric) | Logs Insights query below (`auth_failed` by `code`: the specific reason is in the log, the client only ever sees `unauthorized`) | Credential guessing, or a client stuck in a resume loop (a build that retries after `unauthorized`). The relay already delays each source exponentially after 3 failures and limits resumes to 10 a minute per source and per room. If it persists, kill switch on and check the client build. |
| `credential-reuse` | 3 or more rotated credentials were presented again in 15 minutes (custom `credential_reuse` metric) | `credential_reuse` and `peer_state` lines; each one already revoked that role and told the TV | Either a stolen credential (an attacker and the owner both used the same one) or a client that lost the stored next credential. One event is a normal re-pair; a burst is not. Look at whether one `room` prefix repeats. Nothing to undo: the affected role is revoked and must pair again. SECURITY-NOTES.md section 2 explains the one-step grace that makes a plain lost reply not count as reuse. |
| `room-cap` | `room.create` was refused because the live-room cap (`LiveRoomCap`, default 200) was reached | `room_cap_reached` and `room_created` by 5 minutes; whether one source (hashed, not visible) dominates is not knowable, look at the `rate_limited` counts | Real growth: raise `LiveRoomCap` by a stack update (COST.md section 4). Abuse: kill switch on. A room counts as live until it closes or has been idle for 30 minutes, so abandoned rooms free the cap by themselves. |
| `deadline-errors` | The authentication-deadline Lambda reported 5 or more errors in 5 minutes | `/aws/lambda/atr-relay-<stage>-deadline` for `internal_error` lines; DynamoDB throttling; the Management API (`DeleteConnection`) | A failing consumer means unauthenticated connections are not closed on time (they are still refused everything and closed on their next message or by API Gateway's own idle timeout). Same causes as `lambda-errors`. Failed messages are retried twice, then sit in the dead-letter queue (section 7). |
| `deadline-queue-age` | The oldest deadline message has waited more than 2 minutes | `ApproximateAgeOfOldestMessage`, the consumer's errors and throttles, the event source mapping state (`aws lambda list-event-source-mappings --function-name atr-relay-<stage>-deadline`: it must be `Enabled`) | The consumer is behind, throttled (account concurrency) or disabled. Re-enable the mapping or fix the consumer. Section 7. |
| `deadline-dlq` | A deadline message failed 3 times and is in the dead-letter queue | Section 7 | Inspect, fix the cause, then drain (section 7). The messages hold a connection id, the API domain and the stage: no secrets. |
| Budget email (50, 80, 100 percent actual; 100 percent forecast) | Spend is approaching the monthly budget | Section 4 "Unexpected cost" | **An alert is not a cap**; act on it. |

Logs Insights queries (fields are the redacted allowlist: `event`, `code`, `type`, `bytes`, `role`, `room`, `latency_ms`):

```
fields @timestamp, event, code, type | filter event = "join_failed" | stats count() by bin(5m), code
fields @timestamp, event, code | filter event in ["rate_limited","origin_rejected","auth_failed"] | stats count() by event, bin(5m)
fields @timestamp, event, code, type | filter event = "message_rejected" | stats count() by code, type
fields @timestamp, event, code | filter event in ["credential_reuse","superseded","code_burned","auth_deadline"] | stats count() by event, code, bin(15m)
fields @timestamp, code, type, count | filter event = "minute_aggregate" | stats sum(count) by code, type, bin(1h)
```

Ordinary traffic is not logged per message (A2-04): forwarded messages, dropped duplicates and "peer offline" drops appear only as `minute_aggregate` lines, one per kind and message type per minute with a `count`. The aggregate for a minute is written by the next invocation after the minute ends, so the last minute before a quiet period shows up late, and a container recycled first loses it. Use the Lambda `Invocations` metric for exact volumes. There is no per-message latency line any more; measure latency from the clients (the T12 journey reports it) or from API Gateway's `IntegrationLatency` metric.

### 1.1 Proving alarms really notify (separate from creating them)

Creating an alarm does not prove delivery. After deployment, in order, recording evidence at each step:

1. **Subscription confirmed.** The stack creates the SNS email subscription; AWS emails the `AlarmEmail` address a confirmation link. Until the owner clicks it the subscription is `PendingConfirmation` and delivers nothing. Check: `aws sns list-subscriptions-by-topic --topic-arn <AlarmTopicArn>` shows a subscription ARN, not `PendingConfirmation`.
2. **Notification path.** `aws cloudwatch set-alarm-state --alarm-name atr-relay-<stage>-lambda-errors --state-value ALARM --state-reason "delivery test"` then confirm the email arrives (check spam). This proves SNS and the email recipient. It does **not** prove that metric data reaches CloudWatch or that the threshold logic triggers; the alarm returns to its real state at the next evaluation.
3. **Metric to alarm.** Prove the real path once in staging: for example set `RelayDisabled=true` (or send a deliberately malformed event to the function) until `lambda-errors` or `apigw-integration-errors` crosses its threshold, and watch the alarm change state on its own and the email arrive. Record the alarm history and timestamps.
4. **Budget.** The budget's email notifications cannot be triggered on demand. Verify the configuration with `aws budgets describe-notifications-for-budget --account-id <id> --budget-name <name>` and `describe-subscribers-for-notification`, and note that delivery is unproven until a threshold is actually crossed.
5. **Missing data.** Alarms use `notBreaching` for missing data, so a silent relay does not alarm by itself. Pair the alarms with the daily check in section 5.

## 2. Kill switch (disable and re-enable)

Purpose: stop all relay processing quickly while keeping the stack, table and phone page intact.

What it does (implemented in `RelayCore`, `createRelayHandler`, `loadAwsConfig`): with `RELAY_DISABLED=true` every new `$connect` answers HTTP 503, and every message on an existing connection gets `error {code: internal, detail: relay_disabled}` and the connection is dropped with `DeleteConnection`. Nothing is forwarded. API Gateway cannot send a custom close code, so clients see the error message and a closed socket (the local server uses close code 4503). Clients treat this as a failed link and must show "Phone state unknown" or a retry state, never silently succeed.

**Tested here:** unit and local-integration tests drive the disabled state through the core, the local server (503 at upgrade, `error` + close 4503) and the Lambda adapter (503 at `$connect`, error and `DeleteConnection` on messages, recovery after switching off, environment parsing: only the string `true`, trimmed and case-insensitive, enables it). **Not tested:** the effect of a real stack update or function configuration change on warm Lambda environments, and real API Gateway handling of the 503 and of `DeleteConnection`. Rehearse once in staging and record the observed time from command to refusal.

Levers, fastest first:

| Lever | Command | Takes effect | Notes |
|---|---|---|---|
| A. Reserved concurrency 0 | `aws lambda put-function-concurrency --function-name atr-relay-<stage> --reserved-concurrent-executions 0` | Within seconds (new invocations are throttled) | Clients get API Gateway errors, not the friendly `relay_disabled` message. The `lambda-throttles` alarm will fire (expected). Existing sockets stay open but unusable until API Gateway's idle timeout. **Causes drift** from the stack. Undo: `aws lambda put-function-concurrency ... --reserved-concurrent-executions <ReservedConcurrency>` (or `delete-function-concurrency` when the stack uses `-1`). |
| B. Environment variable | Fetch the current environment, set `RELAY_DISABLED` to `true`, write it back (below) | New execution environments after the update; allow a minute or more and expect warm containers to be replaced | Replaces the **whole** variable map, so copy every existing variable. The file holds no secret (the hashing secret is in SSM, not in the environment), but delete it afterwards anyway. Apply it to `atr-relay-<stage>` only: the deadline function does not enforce the switch. **Causes drift.** |
| C. Stack parameter | `aws cloudformation update-stack --stack-name atr-relay-<stage> --use-previous-template --capabilities CAPABILITY_IAM --parameters ParameterKey=RelayDisabled,ParameterValue=true ParameterKey=Stage,UsePreviousValue=true ParameterKey=AlarmEmail,UsePreviousValue=true ParameterKey=MonthlyBudgetUsd,UsePreviousValue=true ParameterKey=ReservedConcurrency,UsePreviousValue=true ParameterKey=AllowedOrigins,UsePreviousValue=true ParameterKey=TvPreviewOrigins,UsePreviousValue=true ParameterKey=LiveRoomCap,UsePreviousValue=true` | After the stack update completes (minutes) | The authoritative, drift-free way. Use it for planned disables; use A for emergencies, then C to make the state official and undo A. |

Lever B in full:

```
aws lambda get-function-configuration --function-name atr-relay-<stage> --query Environment --output json \
  | jq '.Variables.RELAY_DISABLED = "true"' > /tmp/relay-env.json
aws lambda update-function-configuration --function-name atr-relay-<stage> --environment file:///tmp/relay-env.json
shred -u /tmp/relay-env.json 2>/dev/null || rm -P /tmp/relay-env.json
```

Verify it is on: `curl -i -H 'Origin: https://<cloudfront-domain>' ...` against the WebSocket URL with a WebSocket client (for example `npx wscat -H "Origin: https://<cloudfront-domain>" -c <RelayWssUrl>`) must fail with HTTP 503. Re-enable by reversing the lever used, then verify a connection succeeds and a pairing completes.

Local server: `RELAY_DISABLED=true` at start, or send `SIGUSR2` to toggle at runtime.

## 3. Rollback

Application rollback (fast, no CloudFormation): the function publishes a version on every deploy and the `live` alias points at the newest. `aws lambda list-versions-by-function --function-name atr-relay-<stage>`, then `aws lambda update-alias --function-name atr-relay-<stage> --name live --function-version <previous>`. This drifts the alias from the stack; the next `sam deploy` of the corrected code reconciles it.

Infrastructure rollback: redeploy the previous commit's template and bundle (`git checkout <previous> -- infra services/relay`, `npm run bundle:lambda -w @atr/relay`, `sam deploy`). A failed stack update rolls back by itself; if it gets stuck, `aws cloudformation continue-update-rollback --stack-name ...`.

Data: the table holds ephemeral routing metadata (rooms live at most 12 hours). Rolling back loses nothing that matters; paired devices may need to pair again. The phone page is versioned in S3: restore a previous object version or re-upload a previous build, then invalidate the CloudFront cache.

**Not rehearsed.** Rehearse application rollback in staging before the judging period and record the time taken.

## 4. Incident steps

General: (1) decide whether to stop the bleeding (kill switch, section 2) before investigating; (2) record start time and alarm names; (3) look at redacted logs only (there is nothing else to look at: bodies and credentials are never logged); (4) fix or roll back; (5) re-enable; (6) write what happened.

- **Unexpected cost** (budget email, or a surprising Cost Explorer day): kill switch lever A immediately; open Cost Explorer grouped by service to see whether API Gateway, Lambda, DynamoDB or CloudFront moved; compare with `COST.md` (the throttle ceiling is about $28 per day at staging and $71 per day at prod at reference prices); check API Gateway `MessageCount` and `ConnectCount`; look for one source dominating `rate_limited` or `room_created` metrics; lower the stage throttle and redeploy; then re-enable. Billing data lags by hours, so act on suspicion.
- **Suspected credential or code leak**: `unpair` and `room.close` revoke credentials per room but there is no operator tool to revoke all rooms. Kill switch on, then delete the DynamoDB items for the affected rooms if needed (owner action; item layout is in `src/aws/dynamo-store.ts`), or wait 12 hours (absolute room life) after switching off, or rotate by replacing the table (stack update with a table replacement). Rotating the hashing secret (section 6) invalidates every live pairing code and resets the abuse counters, but not the credentials of paired devices (those are stored as plain SHA-256 digests of random 256-bit values, independent of the secret). For a credential leak in one room use `unpair` or `room.close` from the TV, which bump the room epoch and drop the connection.
- **Pairing abuse** (`join-failures` alarm): the per-source and per-connection limits are already closing offenders. If it continues, kill switch on and review `join_failed`, `rate_limited` and `origin_rejected` metrics by minute. The 10 minute code lifetime and the TV confirmation prompt limit the damage.
- **DynamoDB throttling or outage**: relay requests fail with `internal_error`; clients retry with back-off. Kill switch on reduces load; wait for recovery; no data repair is needed.
- **Phone page wrong or broken**: restore the previous S3 object versions or upload the previous build, then `aws cloudfront create-invalidation --distribution-id <PhoneDistributionId> --paths "/*"`.
- **Cannot connect from a browser** (`origin_rejected`, handshake 403): the page origin is not in the allowlist; the stack always allows its own CloudFront origin plus `AllowedOrigins`.

## 5. Judge-access maintenance through 21 November 2026 01:30 IST

The judging period ends 20 November 2026 12:00 Pacific standard time, which is **21 November 2026 01:30 IST** (master prompt section 10, official rules). Keep the production stack and the phone page available until then.

- **Freeze**: no deployments from 24 October 2026 (submission) except rollbacks and fixes approved by the owner. Each change is followed by a staging check first.
- **Daily (owner or a delegate), about 10 minutes**: (1) the stack status is `CREATE_COMPLETE` or `UPDATE_COMPLETE`; (2) all alarms are `OK` or `INSUFFICIENT_DATA`, none stuck in `ALARM`; (3) the SNS subscription is still confirmed (a bounced address silently unsubscribes); (4) Cost Explorer or the budget page shows spend consistent with COST.md; (5) one real pairing and a 60 second measurement from a physical phone to the TV or Vega virtual device succeeds (this is also the only check that the whole chain works); (6) the phone page loads over HTTPS from a clean browser profile and asks for microphone permission.
- **Weekly**: look at the redacted logs for new `internal_error` lines; confirm the 14 day log retention is in place; confirm the account's Lambda concurrency quota still allows the reservation.
- **If the owner is unreachable for an extended period**: set `ReservedConcurrency` and the stage throttle conservatively in advance, keep `MonthlyBudgetUsd` low enough to notice problems, and name a delegate who has the deployer role and this runbook.
- **After 21 November 2026 01:30 IST** (and not before, and only with the owner's approval): teardown per `infra/README.md`, and record actual cost versus the model.

## 6. The hashing secret: create, rotate, lose

The relay keys three things with one master secret: the HMAC of pairing codes, the daily-derived keys that hash source addresses for the abuse counters, and the derivation of the next rotating credential when it has to re-issue one inside the 60 second grace. It is an SSM Parameter Store SecureString named `/atr/relay/<stage>/hash-secret` that **the owner creates before the first deploy** (`infra/README.md` prerequisite 6). It is never in the template, a parameter, an environment variable or a log; the functions hold `ssm:GetParameter` on that exact name and cache the value for 10 minutes.

**Rotate** (scheduled, or if the value may have leaked; a leaked secret lets someone who also stole the table check guesses against pairing-code hashes and reverse the stored source hashes of the current day, nothing more):

```
aws ssm put-parameter --name /atr/relay/<stage>/hash-secret --type SecureString --overwrite \
  --value "$(openssl rand -base64 48 | tr -d '\n')"
```

Effect within about 10 minutes, as each container's cache expires (a warm container builds a fresh core when the value it reads changes): every outstanding pairing code stops working (a phone mid-pairing gets the generic failure; the TV's next `pairing.refresh` or burned-code push issues a fresh code), abuse counters restart from zero (they are keyed by the secret), and a credential re-issue inside the grace window that straddles the change fails and revokes that role, which then pairs again. Paired devices stay paired. Do it outside a measurement session. During the 10 minute spread two containers can briefly disagree: a code issued by one is rejected by the other, which the user sees as one failed attempt.

**If the parameter is missing or unreadable** (deleted, wrong region, a customer-managed key without `kms:Decrypt`): every `$connect` answers 500 and the logs show `internal_error`; the `lambda-errors` and `apigw-integration-errors` alarms fire. Nothing falls back to a default secret. Recreate the parameter with the same name; no deploy is needed. The first invocation after creating the stack is the check that the roles can decrypt it (an unproven assumption: the template grants no KMS permission and relies on the AWS managed key `alias/aws/ssm`; if the first call is denied, add `kms:Decrypt` on that key to both function roles).

## 7. The deadline queue and its dead-letter queue

API Gateway gives a Lambda no per-connection timer, so the relay queues a delayed SQS message after `$connect` (5 s), after a join request (65 s) and after a join ended (5 s). The deadline function consumes them and drops a connection that is still unauthenticated: an `error` message (`unauthenticated`, `auth_deadline`) and then `DeleteConnection`. The check is idempotent and the deadline is also enforced on the connection's next message, so a late or lost message delays a close and never lets anything through.

- **Dead-letter queue has messages** (`deadline-dlq`): each failed three times. Look at the consumer's log for `internal_error`, and at DynamoDB and the Management API health. Messages are tiny and hold no secrets: `aws sqs receive-message --queue-url <DeadlineDeadLetterQueueUrl> --max-number-of-messages 10` shows `{"c": connection id, "d": API domain, "s": stage}`. After the cause is fixed, drain them back with `aws sqs start-message-move-task --source-arn <DLQ arn>` (redrive to the source queue), or purge: `aws sqs purge-queue --queue-url <DeadlineDeadLetterQueueUrl>`. A purged check costs nothing beyond a connection staying open until its next message or API Gateway's idle timeout.
- **Stop the consumer** (runaway cost, or while debugging): `aws lambda update-event-source-mapping --uuid <id> --no-enabled`. Deadlines are then enforced only on each connection's next message. Re-enable with `--enabled`. The queue keeps messages for one hour, then drops them.
- **Purge the main queue** (a flood of connects queued millions of checks): `aws sqs purge-queue --queue-url <DeadlineQueueUrl>` (allowed to the deployer role; one purge per 60 seconds).
- **The consumer is capped** at 5 concurrent invocations (`MaximumConcurrency` on the event source) and messages older than an hour are dropped, so a flood of `$connect` calls cannot turn into unbounded consumer spend.
- **Staging proof still owed (SEC-A02):** infra/README.md verify item 9.

## 8. Evidence pending (needs an authorized account)

Staging deployment, kill-switch rehearsal with timings, rollback rehearsal, alarm delivery steps 1 to 3 above, budget notification configuration check, GoneException cleanup against real API Gateway, anonymous-origin denial and CloudFront header checks, physical-phone HTTPS check, logs inspection for content after a real session, the authentication-deadline timings on API Gateway (5 s, 60 s join expiry, 65 s), SSM decrypt permission of the function roles, the secret rotation effect described in section 6, and the DynamoDB expressions of the new transactions (the strict in-memory model enforces placeholders and conditions but is not the service).

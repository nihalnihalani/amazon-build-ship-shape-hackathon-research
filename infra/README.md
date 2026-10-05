# Infrastructure (AWS SAM)

`template.yaml` defines the relay for AWS: API Gateway WebSocket, the relay Lambda and the authentication-deadline Lambda (both nodejs24.x, arm64), DynamoDB (one table plus a sparse `live-rooms` index for the room cap), an SQS delay queue with a dead-letter queue for authentication deadlines, a private S3 bucket behind CloudFront with Origin Access Control for the phone page, CloudWatch alarms to an SNS topic, and a budget alert.

**Status: prepared, validated with cfn-lint, never deployed.** Blocker B-003: the AWS credentials on the build machine are the account root user and no spend authorization exists. No AWS API was called while preparing these files. Deployment is an owner action.

| File | Purpose |
|---|---|
| `template.yaml` | The stack (SAM). Parameters: `Stage` (staging or prod), `AllowedOrigins` (extra phone origins, https only), `TvPreviewOrigins` (refused when `Stage=prod`), `AlarmEmail`, `MonthlyBudgetUsd`, `ReservedConcurrency`, `LiveRoomCap`, `RelayDisabled`. There is no secret parameter: the hashing secret is an SSM SecureString you create first (below) |
| `samconfig.toml.example` | Deploy settings with placeholders (no account ids). Copy to `samconfig.toml` (git-ignored here) |
| `iam/deployer-policy.json` | Draft identity policy for the human or automation that runs `sam deploy`, so root keys are not used |
| `iam/cloudformation-execution-role-policy.json`, `iam/cloudformation-execution-role-trust.json` | Draft permissions and trust for the CloudFormation service role the deployer passes with `--role-arn` |
| `.cfnlintrc` | cfn-lint settings (region ap-south-1) |

The IAM files are drafts that have never been used. Names are scoped to the prefix `atr-relay-`, which is why the stack name must start with it. Some actions cannot be scoped by resource (CloudFront creation, API Gateway API ids): they are listed with the widest resource they need. Create the roles, run the first deployment with CloudTrail or IAM Access Analyzer on, and tighten from evidence.

## Region

`ap-south-1` (Mumbai) is the intended region. Whether every service and runtime used here is available there, and its latency and prices, **must be confirmed at deploy time** (in particular `nodejs24.x` for Lambda, API Gateway WebSocket, CloudFront OAC and Budgets). Pick another region by changing `region` in `samconfig.toml` and say so in the release notes. The WebSocket URL is built from the deployed region; nothing is hard-coded.

## Prerequisites (owner)

1. A non-root deployer: create the CloudFormation execution role (`iam/cloudformation-execution-role-*.json`, name `atr-relay-cfn-execution`) and an IAM role or user with `iam/deployer-policy.json`. Never deploy with root keys.
2. A private S3 bucket for SAM artifacts named `atr-relay-artifacts-<suffix>` in the target region (Block Public Access on).
3. Tools: AWS SAM CLI (not installed on the build machine), AWS CLI, Node 22 or newer (build), `curl`, a WebSocket client such as `npx wscat`.
4. Confirm the account's Lambda concurrency quota: `aws lambda get-account-settings`. A new account can have a limit of 10, which cannot hold a reservation (reserving requires the unreserved pool to stay at 100 or more). Then deploy with `ReservedConcurrency=-1` (no reservation: that control and its alarm are absent) or request a quota increase first.
5. Decide the budget (`MonthlyBudgetUsd`), alert address (`AlarmEmail`) and the live-room cap (`LiveRoomCap`, default 200).
6. **Create the hashing secret before the first deploy** (A3-04). The relay keys its pairing-code hashes and its source-address hashes with one master secret that lives in SSM Parameter Store as a SecureString, never in the template, a parameter, an environment variable or a log. Name: `/atr/relay/<stage>/hash-secret` (the stack output `HashSecretParameterName` repeats it). Create it with the AWS managed key `alias/aws/ssm` (the default); the function roles hold `ssm:GetParameter` on that exact parameter and no KMS statement:

   ```sh
   # 48 random bytes, base64 (64 characters). Generate and store in one step so the value is never printed or saved to a file.
   aws ssm put-parameter --name /atr/relay/staging/hash-secret --type SecureString \
     --value "$(openssl rand -base64 48 | tr -d '\n')" --description "Across the Room relay hashing secret (staging)"
   ```

   Rotating it is safe and takes effect within about 10 minutes (the relay caches the parameter that long): re-run the command with `--overwrite`. Rotation invalidates every outstanding pairing code and resets the abuse counters; paired devices stay paired (a credential re-issue that straddles the change revokes that one role, which pairs again). See RUNBOOK.md section 6 for the procedure and the effects. If you use a customer managed key instead, add `kms:Decrypt` on that key to both function roles; the template does not.

## Build

```sh
npm ci
npm run build -w @atr/protocol
npm run bundle:lambda -w @atr/relay        # services/relay/dist-lambda/relay.mjs and MANIFEST.txt (sha256)
npm run build -w @atr/phone                # apps/phone/dist (phone package's own build)
```

Validate the template (no AWS call):

```sh
python3 -m venv services/relay/.venv && services/relay/.venv/bin/pip install cfn-lint aws-sam-translator
services/relay/.venv/bin/cfn-lint -t infra/template.yaml --regions ap-south-1
sam validate --lint --template-file infra/template.yaml        # when SAM CLI is installed
```

Recorded result in this repository: cfn-lint 1.57.1 with aws-sam-translator 1.113.0 exits 0 with no findings for `--regions ap-south-1` (the SAM function was validated after transformation: a deprecated runtime and an unknown SAM property are both rejected, and `nodejs24.x` is accepted); with `--include-checks I` it prints one informational note (I1022, a `Fn::Join` needed to reference the SAM alias). The rework-batch resources (two functions, the SQS event source with `ScalingConfig`, the queues and their policy, the `live-rooms` index, the `Rules` section) were linted in the same run and the tests show cfn-lint rejecting broken variants of them; cfn-lint does **not** check that an SQS event source `MaximumConcurrency` is at least 2 (AWS requires it), so `infra.test.ts` asserts it. `services/relay/test/infra.test.ts` repeats these checks when the venv exists and adds the privacy, logging, secret and IAM assertions (SEC-I01), each shown to fail on a deliberately broken copy of the template. Linting proves the template is well formed against the published resource schemas; it does not prove a deployment will succeed or behave as designed.

## Deploy

```sh
cp infra/samconfig.toml.example infra/samconfig.toml     # edit: bucket, role ARN, email; no secrets in the file
sam deploy --config-file infra/samconfig.toml --no-execute-changeset     # create the change set only
# review the change set in the console or with `aws cloudformation describe-change-set`, then:
sam deploy --config-file infra/samconfig.toml --parameter-overrides "Stage=staging AlarmEmail=<you> MonthlyBudgetUsd=25 ReservedConcurrency=20 LiveRoomCap=200"
```

`sam deploy` packages `services/relay/dist-lambda/` (no `sam build` is needed; the bundle is already built and the AWS SDK is inside it; both functions use the same directory and differ only in the handler: `relay.handler` and `deadline.handler`). Deploy staging first and run the checks below before touching production. `Stage=prod` sets `ATR_ENV=production` in both functions: the relay then refuses `client.platform: test`, preview origins and localhost origins, and the template refuses a non-empty `TvPreviewOrigins`.

Outputs: `RelayWssUrl`, `PhonePageOrigin`, `PhoneBucketName`, `PhoneDistributionId`, `TableName`, `FunctionName`, `DeadlineFunctionName`, `DeadlineQueueUrl`, `DeadlineDeadLetterQueueUrl`, `HashSecretParameterName`, `AlarmTopicArn`.

## Topology and the build step (T16 N-03)

On AWS the phone page and the relay are on **different hosts**: the page is served by CloudFront (`PhonePageOrigin`, `https://dxxxxxxxx.cloudfront.net`) and the WebSocket lives on API Gateway (`RelayWssUrl`, `wss://<api-id>.execute-api.<region>.amazonaws.com/<stage>`). The local relay is one host for both, so clients that assume "the relay host is the page host" work locally and fail on AWS. Therefore:

- The **phone** is built with the relay URL baked in (`VITE_ATR_RELAY_URL`), because the page cannot guess where the socket is.
- The **TV** is configured with two values: `relayUrl` (the WebSocket URL it dials) and `phonePageOrigin` (the origin put in the QR code and the join link, `<phonePageOrigin>/#code=<CODE>`; session-core contract revision 3). Without `phonePageOrigin` the TV would point the QR at the relay host, which serves no page on AWS.
- The CloudFront response headers policy allows the page to open WebSockets to exactly two sources, the page itself and the API host of this stack (`connect-src 'self' wss://<api-id>.execute-api.<region>.amazonaws.com`), with no scheme wildcard and no `blob:` worker source. The relay allows exactly `PhonePageOrigin` (plus any `AllowedOrigins`) to act as a phone.

Steps after `sam deploy` (staging first):

```sh
# 1. read the two values from the stack outputs
aws cloudformation describe-stacks --stack-name atr-relay-<stage> --region <region> \
  --query "Stacks[0].Outputs[?OutputKey=='RelayWssUrl' || OutputKey=='PhonePageOrigin' || OutputKey=='PhoneBucketName' || OutputKey=='PhoneDistributionId'].[OutputKey,OutputValue]" --output text

# 2. build the phone page for this relay (the URL is baked into the bundle and into the page's own CSP)
VITE_ATR_RELAY_URL=<RelayWssUrl> npm run build -w @atr/phone      # apps/phone/dist

# 3. upload it (the bucket is private; CloudFront reads it with OAC) and refresh the cache
aws s3 sync apps/phone/dist s3://<PhoneBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <PhoneDistributionId> --paths "/*"

# 4. configure the TV app: relayUrl = <RelayWssUrl>, phonePageOrigin = <PhonePageOrigin>
```

A phone bundle built for one stack must not be uploaded to another: it dials the relay it was built for, and its CSP names that host only. Build once per stage. The phone build reading `VITE_ATR_RELAY_URL` is the phone owner's change (T16 N-03); until it lands the production phone page still dials `wss://<page host>/ws`, which does not exist on CloudFront, so the AWS deployment cannot pair end to end. `services/relay/test/infra.test.ts` asserts the CSP and the two outputs.

## Verify (each item is pending and needs the account)

Record command, output and timestamp for each.

1. **Alarm email**: confirm the SNS subscription, then follow RUNBOOK.md section 1.1. Alarms and the budget being created is not proof that notifications arrive.
2. **Private origin**: `curl -i https://<PhoneBucketName>.s3.<region>.amazonaws.com/index.html` must return 403 (anonymous access denied); `curl -i <PhonePageOrigin>/index.html` returns 200 with the headers below; `curl -I <PhonePageOrigin>` over `http://` redirects to HTTPS.
3. **Headers**: the response has `Strict-Transport-Security`, `Content-Security-Policy` containing `connect-src 'self' wss://<api-id>.execute-api.<region>.amazonaws.com` (and no other connect source, no bare `wss:`), `worker-src 'self'` (no `blob:`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `X-Frame-Options: DENY`.
4. **WebSocket origin policy**: `npx wscat -H "Origin: https://evil.example" -c <RelayWssUrl>` is refused (HTTP 403); with `-H "Origin: <PhonePageOrigin>"` it connects; with no Origin it connects but only TV-role operations work.
5. **End to end**: pair a TV or Vega virtual device with a physical phone through the CloudFront page, run a measurement, check delivery latency and the redacted logs (`/aws/lambda/atr-relay-<stage>` must contain only `event`, `code`, `type`, `bytes`, `role`, `room`, `latency_ms`; search for `tv_credential`, `phone_credential`, `pairing_code` and a test phrase: there must be no match).
6. **Callbacks**: a real server-to-client message arrives (the pairing flow shows it); an IAM-denied principal gets 403 calling `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/@connections/<id>`; closing a client abruptly then forwarding to it exercises `GoneException` cleanup (the peer receives `peer.state` with `connected: false` and the connection item disappears from the table).
7. **Kill switch** and **rollback** drills: RUNBOOK.md sections 2 and 3, with timings.
8. **Concurrency and throttle**: confirm `ReservedConcurrency` in the console and that the stage shows the default route throttle from `Mappings: StageSettings`.
9. **Authentication deadlines (SEC-A02, the part only staging can prove)**: open a WebSocket with `npx wscat -H "Origin: <PhonePageOrigin>" -c <RelayWssUrl>` and send nothing. About 5 seconds later the client receives an `error` message (`unauthenticated`, detail `auth_deadline`) and the socket closes (no chosen close code on AWS: the Management API cannot set one). Then send a valid `join.request` for a live code and do not answer on the TV: at about 60 seconds the phone receives `join.rejected` with reason `expired` and the TV receives `join.expired` and a fresh `pairing.code`; at about 65 seconds the phone socket closes. Record timestamps. In CloudWatch Metrics the queue `ApproximateAgeOfOldestMessage` stays near zero, the dead-letter queue is empty, and the consumer's `ConcurrentExecutions` never exceeds 5.
10. **No execution data**: in the API Gateway console the stage shows execution logging OFF and data trace off, and no access log destination; X-Ray shows no traces for either function; the two log groups show a 14 day retention.
11. **Secret handling**: both functions' environment configuration lists `HASH_SECRET_PARAM` (a parameter name) and no secret; a first invocation succeeds (it proves the roles can read and decrypt the parameter; an `AccessDenied` shows up as `internal_error` log lines and 500 responses at `$connect`).

## Rollback

Fast path: `aws lambda update-alias --function-name atr-relay-<stage> --name live --function-version <previous>` (versions are published on every deploy; `list-versions-by-function` shows them). The deadline function has no alias: roll it back with the stack (full path below) or by redeploying the previous bundle. Full path: check out the previous commit's `infra/` and `services/relay/`, run `npm run bundle:lambda -w @atr/relay`, `sam deploy`. A failed update rolls back automatically. See RUNBOOK.md section 3.

## Teardown

1. Do not tear down before 21 November 2026 01:30 IST (end of judging) without the owner's decision.
2. Empty the phone bucket **including all object versions and delete markers** (it is versioned; CloudFormation cannot delete a non-empty bucket): console "Empty", or list versions with `aws s3api list-object-versions` and delete them with `aws s3api delete-objects`.
3. `sam delete --stack-name atr-relay-<stage> --region <region>` (or `aws cloudformation delete-stack`). Delete the hashing secret yourself afterwards (it is not part of the stack): `aws ssm delete-parameter --name /atr/relay/<stage>/hash-secret`. The `prod` table has deletion protection: turn it off first with `aws dynamodb update-table --table-name <TableName> --no-deletion-protection-enabled`, then delete the stack.
4. CloudFront deletion takes several minutes. Log groups, the queues, the alarms, the SNS topic and subscription, and the budget are removed with the stack; confirm in the console.
5. Delete the SAM artifact bucket and the IAM roles you created if they are no longer needed.

## What this template deliberately does not do

- No custom domain, ACM certificate or WAF (CloudFront's default certificate allows TLS 1.0 and above; add a domain and certificate for a TLS 1.2 minimum).
- No API Gateway access or execution logging and no CloudFront or S3 access logging, and X-Ray is off: an access-log format could record client addresses and user agents, and **execution logging with data tracing writes message bodies (credentials, phrases, cue text) to CloudWatch Logs**. The stage sets `DataTraceEnabled: false` and `LoggingLevel: OFF` explicitly. `services/relay/test/infra.test.ts` fails the build if a trace, an access-log field outside the whitelist (request id, route, event type, status, latencies), `Tracing: Active`, an X-Ray statement or a CloudFront or S3 log destination appears.
- No point-in-time recovery: the table holds ephemeral routing metadata and PITR would keep deleted rooms and their hashes for 35 days after the user asked for them to be gone. The rationale is in the template next to the setting and is asserted by a test.
- No secret in the stack, the function configuration or the repository: the hashing secret is a SecureString you create out of band.
- No scheduled idle sweeper: Lambda does not run `RelayCore.onTick`. The authentication deadline is the exception and is handled by the SQS delay queue and the deadline function (the sweeper's other job, dropping silent authenticated connections, is not done on AWS). `$disconnect` is best effort; a silently vanished client is detected on the next failed send (`GoneException`) or by the client's own heartbeat. `DynamoDbRoomStore.listConnections` (a table scan) exists for an optional sweeper; neither function role has `dynamodb:Scan`, so a sweeper would need its own role.
- No budget actions: they cannot stop this workload, and a hard spending cap is not claimed anywhere. Spend is bounded by the stage throttle (COST.md) and the kill switch.

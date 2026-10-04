# Infrastructure (AWS SAM)

`template.yaml` defines the relay for AWS: API Gateway WebSocket, one Lambda (nodejs24.x, arm64), DynamoDB, a private S3 bucket behind CloudFront with Origin Access Control for the phone page, CloudWatch alarms to an SNS topic, and a budget alert.

**Status: prepared, validated with cfn-lint, never deployed.** Blocker B-003: the AWS credentials on the build machine are the account root user and no spend authorization exists. No AWS API was called while preparing these files. Deployment is an owner action.

| File | Purpose |
|---|---|
| `template.yaml` | The stack (SAM). Parameters: `Stage` (staging or prod), `AllowedOrigins`, `AlarmEmail`, `MonthlyBudgetUsd`, `ReservedConcurrency`, `RelayDisabled`, `HashPepper` |
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
5. Decide the budget (`MonthlyBudgetUsd`), alert address (`AlarmEmail`) and a random `HashPepper` (16 to 128 characters of `A-Za-z0-9+/=_-`).

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

Recorded result in this repository: cfn-lint 1.57.1 with aws-sam-translator 1.113.0 exits 0 with no findings for `--regions ap-south-1` (the SAM function was validated after transformation: a deprecated runtime and an unknown SAM property are both rejected, and `nodejs24.x` is accepted); with `--include-checks I` it prints one informational note (I1022, a `Fn::Join` needed to reference the SAM alias). `services/relay/test/infra.test.ts` repeats these checks when the venv exists. Linting proves the template is well formed against the published resource schemas; it does not prove a deployment will succeed or behave as designed.

## Deploy

```sh
cp infra/samconfig.toml.example infra/samconfig.toml     # edit: bucket, role ARN, email; no secrets in the file
sam deploy --config-file infra/samconfig.toml --no-execute-changeset     # create the change set only
# review the change set in the console or with `aws cloudformation describe-change-set`, then:
sam deploy --config-file infra/samconfig.toml --parameter-overrides "Stage=staging AlarmEmail=<you> MonthlyBudgetUsd=25 ReservedConcurrency=20 HashPepper=<random>"
```

`sam deploy` packages `services/relay/dist-lambda/` (no `sam build` is needed; the bundle is already built and the AWS SDK is inside it). Deploy staging first and run the checks below before touching production.

Outputs: `WebSocketUrl`, `PhonePageUrl`, `PhoneBucketName`, `PhoneDistributionId`, `TableName`, `FunctionName`, `AlarmTopicArn`.

Publish the phone page (the bucket is private; CloudFront reads it with OAC):

```sh
aws s3 sync apps/phone/dist s3://<PhoneBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <PhoneDistributionId> --paths "/*"
```

The phone client reads the relay URL from its own configuration: set it to `WebSocketUrl` (the CSP only allows that wss origin and the page's own origin).

## Verify (each item is pending and needs the account)

Record command, output and timestamp for each.

1. **Alarm email**: confirm the SNS subscription, then follow RUNBOOK.md section 1.1. Alarms and the budget being created is not proof that notifications arrive.
2. **Private origin**: `curl -i https://<PhoneBucketName>.s3.<region>.amazonaws.com/index.html` must return 403 (anonymous access denied); `curl -i <PhonePageUrl>/index.html` returns 200 with the headers below; `curl -I <PhonePageUrl>` over `http://` redirects to HTTPS.
3. **Headers**: the response has `Strict-Transport-Security`, `Content-Security-Policy` containing `connect-src 'self' wss://<api-id>.execute-api.<region>.amazonaws.com`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `X-Frame-Options: DENY`.
4. **WebSocket origin policy**: `npx wscat -H "Origin: https://evil.example" -c <WebSocketUrl>` is refused (HTTP 403); with `-H "Origin: <PhonePageUrl>"` it connects; with no Origin it connects but only TV-role operations work.
5. **End to end**: pair a TV or Vega virtual device with a physical phone through the CloudFront page, run a measurement, check delivery latency and the redacted logs (`/aws/lambda/atr-relay-<stage>` must contain only `event`, `code`, `type`, `bytes`, `role`, `room`, `latency_ms`; search for `tv_credential`, `phone_credential`, `pairing_code` and a test phrase: there must be no match).
6. **Callbacks**: a real server-to-client message arrives (the pairing flow shows it); an IAM-denied principal gets 403 calling `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/@connections/<id>`; closing a client abruptly then forwarding to it exercises `GoneException` cleanup (the peer receives `peer.state` with `connected: false` and the connection item disappears from the table).
7. **Kill switch** and **rollback** drills: RUNBOOK.md sections 2 and 3, with timings.
8. **Concurrency and throttle**: confirm `ReservedConcurrency` in the console and that the stage shows the default route throttle from `Mappings: StageSettings`.

## Rollback

Fast path: `aws lambda update-alias --function-name atr-relay-<stage> --name live --function-version <previous>` (versions are published on every deploy; `list-versions-by-function` shows them). Full path: check out the previous commit's `infra/` and `services/relay/`, run `npm run bundle:lambda -w @atr/relay`, `sam deploy`. A failed update rolls back automatically. See RUNBOOK.md section 3.

## Teardown

1. Do not tear down before 21 November 2026 01:30 IST (end of judging) without the owner's decision.
2. Empty the phone bucket **including all object versions and delete markers** (it is versioned; CloudFormation cannot delete a non-empty bucket): console "Empty", or list versions with `aws s3api list-object-versions` and delete them with `aws s3api delete-objects`.
3. `sam delete --stack-name atr-relay-<stage> --region <region>` (or `aws cloudformation delete-stack`). The `prod` table has deletion protection: turn it off first with `aws dynamodb update-table --table-name <TableName> --no-deletion-protection-enabled`, then delete the stack.
4. CloudFront deletion takes several minutes. Log groups, the alarms, the SNS topic and subscription, and the budget are removed with the stack; confirm in the console.
5. Delete the SAM artifact bucket and the IAM roles you created if they are no longer needed.

## What this template deliberately does not do

- No custom domain, ACM certificate or WAF (CloudFront's default certificate allows TLS 1.0 and above; add a domain and certificate for a TLS 1.2 minimum).
- No API Gateway access or execution logging and no CloudFront or S3 access logging: access logging needs an account-level CloudWatch role and would record client addresses; **never enable execution logging with data tracing, which logs message bodies**.
- No scheduled idle sweeper: Lambda does not run `RelayCore.onTick`. `$disconnect` is best effort; a silently vanished client is detected on the next failed send (`GoneException`) or by the client's own heartbeat. `DynamoDbRoomStore.listConnections` (a table scan) exists for an optional sweeper; the function role intentionally has no `dynamodb:Scan`, so a sweeper would need its own role.
- No budget actions: they cannot stop this workload, and a hard spending cap is not claimed anywhere. Spend is bounded by the stage throttle (COST.md) and the kill switch.

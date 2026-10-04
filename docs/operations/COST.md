# Relay cost model

Status: model with stated assumptions. **Nothing was deployed, measured or billed.** Every price below is a *reference* value read from an AWS pricing page on 5 October 2026 and **must be re-verified for the deployment region at deploy time** (ap-south-1 is intended; the fetched pages show most examples for US East (N. Virginia) and do not show the Mumbai table). Do not quote these numbers as the real bill.

Reproduce every figure: `node docs/operations/cost-model.mjs` (pure arithmetic; any price or assumption can be overridden with an environment variable, for example `PRICE_DYNAMO_PER_MILLION_WRU=0.7 node docs/operations/cost-model.mjs`). A test (`services/relay/test/docs.test.ts`) fails if this document and the script disagree.

## 1. Price inputs and where they came from

| Item | Reference value used | Source page (fetched 2026-10-05) | What the page showed | Status |
|---|---|---|---|---|
| API Gateway WebSocket messages | $1.00 per million | https://aws.amazon.com/api-gateway/pricing/ | WebSocket chat example "reflects pricing in US East (N. Virginia)": messages at $1.00 per million. Messages are metered in 32 KB increments; ping/pong **control frames** are not metered. Page `updated_time` 2026-09-25. | To verify at deploy time (Mumbai rate not shown) |
| API Gateway WebSocket connection minutes | $0.25 per million | same | same example: connection minutes at $0.25 per million | To verify at deploy time |
| Lambda requests | $0.20 per million | https://aws.amazon.com/lambda/pricing/ | "$0.20 per million requests"; free tier 1 million requests and 400,000 GB-seconds per month | To verify at deploy time |
| Lambda duration | $0.0000166667 per GB-second | same | x86 example in US East (N. Virginia). The arm64 rate is lower but was not legible in the fetched text, so the x86 value is used as a conservative upper bound. | To verify at deploy time |
| DynamoDB on-demand writes | $0.625 per million WRU | https://aws.amazon.com/dynamodb/pricing/on-demand/ | Pricing example "$0.6250 per million writes"; one WRU per 1 KB written (transactional writes cost 2). Region of that example not stated in the captured excerpt. | To verify at deploy time |
| DynamoDB on-demand reads | $0.125 per million RRU | same | Pricing example "$0.125 per million reads"; a strongly consistent read of up to 4 KB is 1 RRU (eventually consistent is 0.5). | To verify at deploy time |
| CloudWatch Logs ingestion and storage, alarms, custom metrics | **not available** | https://aws.amazon.com/cloudwatch/pricing/ | The per-GB log ingestion rate and per-alarm / per-metric rates were not present in the fetched text (region tables are rendered by script). | **Unknown: look up before deploy** |
| CloudFront, S3, Budgets | **not fetched** | https://aws.amazon.com/cloudfront/pricing/, https://aws.amazon.com/s3/pricing/, https://aws.amazon.com/aws-cost-management/pricing/ | The phone page is a few hundred KB; request and transfer volumes are tiny. | Unknown: look up before deploy |

Free tiers (new accounts only, expiry rules in the pages) are ignored here, which makes the model conservative. API Gateway lists 1 million messages and 750,000 connection minutes per month for 12 months; Lambda 1 million requests and 400,000 GB-seconds per month.

## 2. Workload assumptions

| # | Assumption | Value | Basis |
|---|---|---|---|
| A1 | Level frame rate | 20 per second (one 50 ms frame per message) | PROTOCOL.md `level`, ADR-0002 |
| A2 | Measurement seconds per session | 116 s (full session: 6 s calibration + 30 s vowel + 10 phrases x 8 s) or 60 s (typical) | PROTOCOL.md limits; typical is an assumption |
| A3 | Control messages per session (all types other than `level`, both directions, inbound count) | 150 | Assumption: counted from the message catalogue for a 10-phrase session; range 100 to 300 |
| A4 | Session length with both clients connected | 15 minutes | Assumption |
| A5 | Heartbeat | an application-level JSON `ping` every 10 s from each client, answered by `pong` | ADR-0006. These are ordinary text messages, **metered**, unlike WebSocket control frames |
| A6 | Pairing | 6 inbound messages, 8 relay-originated outbound messages, 2 `$connect` and 2 `$disconnect` invocations | Section 3 flow |
| A7 | Lambda billed duration | 60 ms average at 512 MB (0.03 GB-s per invocation) | **Unmeasured assumption**; about seven DynamoDB round trips per message plus runtime overhead; cold starts ignored |
| A8 | DynamoDB cost per inbound authenticated message | 2 RRU (strongly consistent `getConnection` + `getRoom`) and 4 WRU (two window counters, message-id marker, sequence acceptance), plus 0.05 WRU for the throttled connection touch and 1 WRU per relay-originated reply | `DynamoDbRoomStore`; every item is far below 1 KB, so each call is 1 unit. Failed conditional writes also consume write units. |
| A9 | Metering of forwarded messages | one metered message in (client to relay) and one out (the `@connections` POST to the peer) | API Gateway meters both |
| A10 | Level frames are not logged by the relay; other forwarded messages produce one content-free log line | design | `RelayCore.forward` |

## 3. Arithmetic per session

Definitions: `F = 20 x W` level frames; `pings = (15 x 60 / 10) x 2 = 180`; `inbound = F + 150 + 180 + 6`; `outbound = F + 150 + 180 + 8` (forwards, pongs, relay-originated); `API Gateway messages = inbound + outbound`; `Lambda invocations = inbound + 4`; `GB-s = invocations x 0.06 s x 0.5 GB`; `WRU = inbound x 4.05 + (180 + 8) + 4 x 3`; `RRU = 2 x inbound`.

Output of `node docs/operations/cost-model.mjs` (reference prices):

```
Per-session model (reference prices; nothing measured)
metric | full session (W=116 s) | typical (W=60 s)
level frames | 2,320 | 1,200
inbound messages (Lambda invocations minus 4) | 2,656 | 1,536
outbound @connections posts | 2,658 | 1,538
API Gateway metered messages | 5,314 | 3,074
connection minutes | 30 | 30
Lambda invocations | 2,660 | 1,540
Lambda GB-seconds | 79.8 | 46.2
DynamoDB WRU | 10,957 | 6,421
DynamoDB RRU | 5,312 | 3,072
API Gateway messages cost | $0.00531 | $0.00307
API Gateway connection minutes cost | $0.00001 | $0.00001
Lambda requests cost | $0.00053 | $0.00031
Lambda compute cost | $0.00133 | $0.00077
DynamoDB writes cost | $0.00685 | $0.00401
DynamoDB reads cost | $0.00066 | $0.00038
TOTAL per session (excl. logs, CloudFront, S3, alarms) | $0.01470 | $0.00856

Per forwarded inbound message: 5.48 micro-USD

Sustained-at-the-throttle upper bound (excl. logs)
stage | rate (msg/s) | per hour | per day | per 30 days
staging | 60 | $1.18 | $28.41 | $852.44
prod | 150 | $2.96 | $71.04 | $2131.11

Sessions per month at the full-session cost
100 sessions | $1.47
500 sessions | $7.35
5,000 sessions | $73.48
```

Reading the table: with the reference prices a full session costs about one and a half US cents and a typical one about 0.9 cents. DynamoDB writes (the four conditional or counter writes behind every message) are the largest item, then API Gateway messages. Excluded and unknown: CloudWatch Logs (each Lambda invocation emits START, END and REPORT lines of roughly 0.4 KB, so a full session writes on the order of 1 MB of log data, price per GB unknown), CloudWatch alarms and custom metrics (six alarms and the EMF counters), CloudFront and S3 for the phone page, and the Budgets service itself.

## 4. What bounds spend (and what does not)

1. **Stage throttle** (`Mappings: StageSettings` in `infra/template.yaml`): API Gateway rejects messages above 60 per second (staging) or 150 per second (prod) per route before Lambda runs. This is the real ceiling. Sustained for a whole month with every message accepted it would be about $852 (staging) or $2,131 (prod) at reference prices, roughly $28 or $71 per day. That is an arithmetic bound, not an expectation: it needs an attacker holding valid credentials or opening connections continuously. Lower `ThrottleRate` if that bound is too high for the owner.
2. **Kill switch** and **reserved concurrency**: stop or cap processing; see RUNBOOK.md. Reserved concurrency (default 20) limits parallel executions, about 330 invocations per second at 60 ms, which is above the throttle, so the throttle is the binding cost limit.
3. **Application limits** inside the core (per connection, per source, unauthenticated caps) reduce what an attacker can do per connection but do not stop new connections; the throttle does.
4. **Budget alert** (`MonthlyBudgetUsd`, email at 50, 80 and 100 percent actual and 100 percent forecast) **is not a spending cap**. Billing data lags by hours, nothing is stopped automatically, and Budgets actions for EC2 or RDS cannot stop this Lambda, API Gateway and DynamoDB workload. Anyone reading an alert must follow RUNBOOK.md "Unexpected cost".
5. API Gateway WebSocket limits: 128 KB message, 32 KB frame, 2 hour connection, 10 minute idle timeout (https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html). Clients re-dial at 110 minutes (ADR-0006).

## 5. Levers if the numbers are too high

- **Batch level frames** (several 50 ms frames per message): cuts API Gateway, Lambda and DynamoDB cost of level traffic in proportion (batches of 4 would cut the level share by 75 percent). This changes PROTOCOL.md (`level` carries one frame today), so it needs the contracts owner and a latency check; it is not implemented.
- Drop the 10 second sustained-rate counter or keep rate state in a single item (saves 1 of 4 writes per message, about 25 percent of DynamoDB write cost). Not implemented: it would trade a little rate-limit accuracy for cost.
- A per-container token bucket in front of the counters would absorb floods without table writes but is approximate across containers.
- Lower the stage throttle, `ReservedConcurrency` and `MonthlyBudgetUsd`.

## 6. Fixed and idle cost

With no traffic the stack costs nothing for Lambda, API Gateway and DynamoDB on-demand (pay per use). What remains is the alarms and any custom metric the relay has emitted, log storage (14 day retention, small), S3 storage for the phone page (hundreds of KB, versioned), the CloudFront distribution (pay per request and transfer), and the Budgets entry. Their rates were not fetched (section 1); look them up before deployment and add them here.

## 7. Verification plan (pending, needs the owner's account)

After an authorized staging deployment, run one scripted full session and reconcile the model with CloudWatch: API Gateway `MessageCount` and `ConnectCount`, Lambda `Invocations` and `Duration`, DynamoDB `ConsumedWriteCapacityUnits` and `ConsumedReadCapacityUnits`, log bytes ingested. Replace assumptions A3, A7 and A8 with measured values, update this document and note the deviation. Until then every number here is a model.

# @atr/relay

The relay for "Across the Room": one transport-agnostic core, two adapters.

```
src/core/    RelayCore (ADR-0003), RoomStore port, MemoryRoomStore, credentials, redacting logger, protocol-port.ts
src/local/   Node HTTPS + WSS server (ws), static phone page, security headers, config loader   -> docs/operations/LOCAL_RELAY.md
src/aws/     API Gateway WebSocket Lambda handlers (relay.handler) and the SQS authentication-deadline consumer
             (deadline.handler), DynamoDbRoomStore, config loader, runtime wiring (SSM, SQS, Management API) -> infra/README.md
scripts/     bundle-lambda.mjs (esbuild -> dist-lambda/relay.mjs and deadline.mjs, with MANIFEST.txt)
test/        vitest suites (core security by SEC-* id, store conformance, local server, Lambda adapters, infra, docs, cost)
```

`src/core/protocol-port.ts` is the only file that touches `@atr/protocol` (PROTOCOL.md revision 4). The core keeps no per-connection memory: every connection, room, join, counter and sequence lives behind `RoomStore`, so the same code runs in one Node process and in stateless Lambda invocations. Handlers return `Action[]` (`send`, `close`, `log`, `metric`, `schedule`) that an adapter executes; adapters must process one connection's messages in order. Every inbound frame goes through the single entry `RelayCore.processInbound`; `onConnect`, `onDisconnect`, `onDeadlineCheck` and `onTick` are the other entries.

What the rework batch added (details and rationale in docs/operations/SECURITY-NOTES.md): keyed hashing (HMAC pairing codes, daily-derived source keys, secret from SSM on AWS and random per process locally), the abuse controls (connect budget, concurrent unauthenticated cap, exponential delay, room.create budget, live-room cap), code burning, the atomic phone claim, credential rotation with the one-step grace, reuse revocation and role epochs, the supersede guard, origin states with a separate TV preview list, canonical forwarding, per-(room, role) dedupe, the cue cap per announced session, per-minute log aggregation, and on AWS the SQS deadline queue with its consumer.

## Commands (from the repository root)

```sh
npm run build -w @atr/protocol           # the relay builds against the protocol package output
npm run build -w @atr/relay
npm run typecheck -w @atr/relay
npm test -w @atr/relay                   # tests use the protocol sources directly (see vitest.config.ts)
npm run start:local -w @atr/relay        # HTTPS/WSS on :8443 (needs certs: scripts/dev-certs/make-dev-certs.sh)
npm run bundle:lambda -w @atr/relay      # services/relay/dist-lambda/relay.mjs + MANIFEST.txt
```

The infra tests run cfn-lint when `services/relay/.venv` exists (`python3 -m venv .venv && .venv/bin/pip install cfn-lint aws-sam-translator`).

## Running the core suites against both stores

Every `test/core.*.test.ts` file (`pairing`, `messages`, `abuse`, `codes`, `credentials`, `origin`, `inbound`, `isolation`) runs on `MemoryRoomStore`; its `*.dynamo.test.ts` twin imports the same scenarios with `globalThis.__ATR_STORE = 'dynamo'`, which swaps in `DynamoDbRoomStore` on top of `test/helpers/fake-dynamo.ts`, an in-memory model of the DynamoDB document client (get, put, update, delete, query on the `live-rooms` index, scan and transactional writes). Test names carry the threat-model ids (`SEC-A03`, `SEC-A09`, `SEC-I01`, ...) from `docs/security/THREAT_MODEL.md`. Adapter-level suites: `aws-handlers.test.ts` and `aws-adapter.test.ts` (Lambda adapters through a fake Management API, scheduler and DynamoDB model), `local-server.test.ts` and `local-hardening.test.ts` (real sockets), `infra.test.ts` (IaC assertions that are shown to fail on broken templates, plus cfn-lint), `cost-ops.test.ts` (store operations per step, tied to COST.md), `docs.test.ts`. The model is strict (unused or undefined placeholders and bare attribute names are errors, as in the real service) but it is a model: the expressions in `src/aws/dynamo-store.ts` still need a run against DynamoDB Local or a real table.

Operations, cost and security documents: `docs/operations/` (RUNBOOK.md, COST.md, SECURITY-NOTES.md, LOCAL_RELAY.md).

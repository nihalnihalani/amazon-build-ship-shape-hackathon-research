# @atr/relay

The relay for "Across the Room": one transport-agnostic core, two adapters.

```
src/core/    RelayCore (ADR-0003), RoomStore port, MemoryRoomStore, credentials, redacting logger, protocol-port.ts
src/local/   Node HTTPS + WSS server (ws), static phone page, security headers, config loader   -> docs/operations/LOCAL_RELAY.md
src/aws/     API Gateway WebSocket Lambda handlers, DynamoDbRoomStore, config loader, esbuild entry -> infra/README.md
scripts/     bundle-lambda.mjs (esbuild -> dist-lambda/relay.mjs)
test/        vitest suites (core security, store conformance, local server, Lambda adapter, infra, docs)
```

`src/core/protocol-port.ts` is the only file that touches `@atr/protocol` (PROTOCOL.md revision 2). The core keeps no per-connection memory: every connection, room, join, counter and sequence lives behind `RoomStore`, so the same code runs in one Node process and in stateless Lambda invocations. Handlers return `Action[]` (`send`, `close`, `log`, `metric`) that an adapter executes; adapters must process one connection's messages in order.

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

`test/core.pairing.test.ts` and `test/core.messages.test.ts` run on `MemoryRoomStore`; the `*.dynamo.test.ts` twins import the same scenarios with `globalThis.__ATR_STORE = 'dynamo'`, which swaps in `DynamoDbRoomStore` on top of `test/helpers/fake-dynamo.ts`, an in-memory model of the DynamoDB document client. The model is strict (unused or undefined placeholders and bare attribute names are errors, as in the real service) but it is a model: the expressions in `src/aws/dynamo-store.ts` still need a run against DynamoDB Local or a real table.

Operations, cost and security documents: `docs/operations/` (RUNBOOK.md, COST.md, SECURITY-NOTES.md, LOCAL_RELAY.md).

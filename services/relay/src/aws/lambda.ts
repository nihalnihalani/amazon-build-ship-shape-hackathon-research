/**
 * Lambda entry point of the relay function (bundled by scripts/bundle-lambda.mjs into dist-lambda/relay.mjs;
 * handler `relay.handler`): the API Gateway WebSocket routes $connect, $disconnect and $default.
 * Real AWS clients are created lazily on the first invocation from the function's environment.
 */
import { buildRuntime } from './runtime.js';
import type { RelayRuntime, WsEvent, WsResult } from './handlers.js';

let cached: RelayRuntime | undefined;

export const handler = async (event: WsEvent): Promise<WsResult> => {
  cached ??= buildRuntime();
  return cached.handleApi(event);
};

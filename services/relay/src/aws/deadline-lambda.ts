/**
 * Lambda entry point of the deadline function (dist-lambda/deadline.mjs; handler `deadline.handler`): consumes the
 * SQS delay queue and calls RelayCore.onDeadlineCheck for each message (A3-09).
 */
import { buildRuntime } from './runtime.js';
import type { RelayRuntime, SqsBatchResponse, SqsEvent } from './handlers.js';

let cached: RelayRuntime | undefined;

export const handler = async (event: SqsEvent): Promise<SqsBatchResponse> => {
  cached ??= buildRuntime();
  return cached.handleDeadline(event);
};

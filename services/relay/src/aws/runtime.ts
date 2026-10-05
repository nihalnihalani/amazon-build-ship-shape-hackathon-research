/**
 * Wires the real AWS clients into the relay runtime. Shared by the two Lambda entry points
 * (`lambda.ts`: API Gateway routes, `deadline-lambda.ts`: SQS delay-queue consumer).
 * Nothing here runs at import time: clients are created on first use.
 */
import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadAwsConfig } from './config.js';
import { DynamoDbRoomStore } from './dynamo-store.js';
import { createRelayRuntime, type DeadlineScheduler, type ManagementApi, type RelayRuntime } from './handlers.js';

const CLIENT_LIMITS = { maxAttempts: 3, requestHandler: { requestTimeout: 3000, connectionTimeout: 1000 } } as const;
const SECRET_CACHE_MS = 10 * 60_000;

/** Reads a SecureString parameter and caches it briefly, so rotating the parameter takes effect within minutes. */
export function createSecretReader(
  fetchSecret: () => Promise<string>,
  now: () => number = Date.now,
  ttlMs: number = SECRET_CACHE_MS,
): () => Promise<string> {
  let value: string | null = null;
  let fetchedAt = 0;
  return async () => {
    if (value === null || now() - fetchedAt >= ttlMs) {
      value = await fetchSecret();
      fetchedAt = now();
    }
    return value;
  };
}

export function buildRuntime(): RelayRuntime {
  const config = loadAwsConfig(process.env);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ ...CLIENT_LIMITS }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const ssm = new SSMClient({ ...CLIENT_LIMITS });
  const hashSecret = createSecretReader(async () => {
    const r = await ssm.send(new GetParameterCommand({ Name: config.hashSecretParameter, WithDecryption: true }));
    const v = r.Parameter?.Value;
    if (!v) throw new Error('hash secret parameter is empty');
    return v;
  });

  const apis = new Map<string, ApiGatewayManagementApiClient>();
  const encoder = new TextEncoder();

  let scheduler: DeadlineScheduler | undefined;
  if (config.deadlineQueueUrl) {
    const sqs = new SQSClient({ ...CLIENT_LIMITS });
    const queueUrl = config.deadlineQueueUrl;
    scheduler = {
      schedule: async (message, delaySeconds) => {
        await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message), DelaySeconds: delaySeconds }));
      },
    };
  }

  return createRelayRuntime({
    store: new DynamoDbRoomStore(doc, config.tableName),
    phoneOrigins: config.phoneOrigins,
    tvPreviewOrigins: config.tvPreviewOrigins,
    environment: config.environment,
    liveRoomCap: config.liveRoomCap,
    hashSecret,
    // Re-read on every call so the documented kill switch is a single environment variable.
    isDisabled: () => process.env.RELAY_DISABLED?.trim().toLowerCase() === 'true',
    stage: config.stage,
    ...(scheduler ? { scheduler } : {}),
    apiFactory: (endpoint: string): ManagementApi => {
      let client = apis.get(endpoint);
      if (!client) {
        client = new ApiGatewayManagementApiClient({ endpoint, ...CLIENT_LIMITS });
        apis.set(endpoint, client);
      }
      const c = client;
      return {
        postToConnection: async (connectionId, data) => {
          await c.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: encoder.encode(data) }));
        },
        deleteConnection: async (connectionId) => {
          await c.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
        },
      };
    },
  });
}

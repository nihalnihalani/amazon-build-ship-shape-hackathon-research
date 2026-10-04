/**
 * Lambda entry point (bundled by scripts/bundle-lambda.mjs into dist-lambda/relay.mjs; handler `relay.handler`).
 * Real AWS clients are created lazily on the first invocation from the function's environment.
 */
import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadAwsConfig } from './config.js';
import { DynamoDbRoomStore } from './dynamo-store.js';
import { createRelayHandler, type ManagementApi, type WsEvent, type WsResult } from './handlers.js';

const CLIENT_LIMITS = { maxAttempts: 3, requestHandler: { requestTimeout: 3000, connectionTimeout: 1000 } } as const;

let cached: ((event: WsEvent) => Promise<WsResult>) | undefined;

function build(): (event: WsEvent) => Promise<WsResult> {
  const config = loadAwsConfig(process.env);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ ...CLIENT_LIMITS }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const apis = new Map<string, ApiGatewayManagementApiClient>();
  const encoder = new TextEncoder();
  return createRelayHandler({
    store: new DynamoDbRoomStore(doc, config.tableName),
    allowedOrigins: config.allowedOrigins,
    hashPepper: config.hashPepper,
    // Re-read on every call so the documented kill switch is a single environment variable.
    isDisabled: () => process.env.RELAY_DISABLED?.trim().toLowerCase() === 'true',
    stage: config.stage,
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

export const handler = async (event: WsEvent): Promise<WsResult> => {
  cached ??= build();
  return cached(event);
};

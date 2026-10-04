// Runs the identical origin scenarios against DynamoDbRoomStore on the strict FakeDynamo model.
(globalThis as { __ATR_STORE?: string }).__ATR_STORE = 'dynamo';
await import('./core.origin.test.js');

// Runs the identical abuse scenarios against DynamoDbRoomStore on the strict FakeDynamo model.
(globalThis as { __ATR_STORE?: string }).__ATR_STORE = 'dynamo';
await import('./core.abuse.test.js');

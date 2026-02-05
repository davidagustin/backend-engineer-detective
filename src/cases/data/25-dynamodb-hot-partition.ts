import { DetectiveCase } from '../../types';

export const dynamodbHotPartition: DetectiveCase = {
  id: 'dynamodb-hot-partition',
  title: 'The DynamoDB Hot Partition',
  subtitle: 'Single partition receiving all traffic due to poor key design',
  difficulty: 'mid',
  category: 'database',

  crisis: {
    description: `
      Your real-time analytics dashboard stores event data in DynamoDB. Despite
      provisioning 10,000 WCU (Write Capacity Units), you're getting throttled
      with only 2,000 writes per second. The ProvisionedThroughputExceededException
      errors are causing data loss and dashboard gaps.
    `,
    impact: `
      Analytics data being dropped. Marketing can't see real-time campaign performance.
      A/B testing results unreliable. Executive dashboard showing stale data.
    `,
    timeline: [
      { time: '9:00 AM', event: 'Marketing campaign launched, traffic 5x normal', type: 'normal' },
      { time: '9:05 AM', event: 'First throttling errors appear', type: 'warning' },
      { time: '9:10 AM', event: 'Throttling rate reaches 60%', type: 'critical' },
      { time: '9:15 AM', event: 'Auto-scaling triggers, WCU increased to 10,000', type: 'normal' },
      { time: '9:20 AM', event: 'Throttling continues despite 10,000 WCU', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'DynamoDB table provisioned with 10,000 WCU',
      'Some writes succeed without issues',
      'Read operations working normally',
      'Auto-scaling is functioning'
    ],
    broken: [
      'Only achieving ~2,000 writes/sec despite 10,000 WCU provisioned',
      'ProvisionedThroughputExceededException on writes',
      'CloudWatch shows consumed capacity well below provisioned',
      'All throttling happens on a single partition key'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'DynamoDB Table Schema',
      type: 'code',
      content: `
\`\`\`typescript
// analytics-table.ts
import { DynamoDB } from '@aws-sdk/client-dynamodb';

// Table definition
const tableDefinition = {
  TableName: 'analytics-events',
  KeySchema: [
    { AttributeName: 'eventDate', KeyType: 'HASH' },  // Partition key
    { AttributeName: 'eventId', KeyType: 'RANGE' },   // Sort key
  ],
  AttributeDefinitions: [
    { AttributeName: 'eventDate', AttributeType: 'S' },
    { AttributeName: 'eventId', AttributeType: 'S' },
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5000,
    WriteCapacityUnits: 10000,
  },
};

// Write event function
async function writeEvent(event: AnalyticsEvent) {
  await dynamodb.putItem({
    TableName: 'analytics-events',
    Item: {
      eventDate: { S: formatDate(new Date()) },  // e.g., "2024-01-15"
      eventId: { S: \`\${Date.now()}-\${uuid()}\` },
      eventType: { S: event.type },
      userId: { S: event.userId },
      data: { M: marshall(event.data) },
    },
  });
}
\`\`\`
      `,
      hint: 'The partition key is eventDate - all events today have the same partition key'
    },
    {
      id: 2,
      title: 'CloudWatch Metrics',
      type: 'metrics',
      content: `
## DynamoDB Table Metrics

| Metric | Value |
|--------|-------|
| Provisioned WCU | 10,000 |
| Consumed WCU | 1,847 (avg) |
| Throttled Requests | 4,215/min |
| Partition Count | 5 |

## Per-Partition Metrics (Contributor Insights)
| Partition Key | Consumed WCU | Throttled |
|---------------|--------------|-----------|
| 2024-01-15 | 1,800 | 4,200/min |
| 2024-01-14 | 42 | 0 |
| 2024-01-13 | 5 | 0 |
| 2024-01-12 | 0 | 0 |
| 2024-01-11 | 0 | 0 |

**Note:** All traffic hitting partition "2024-01-15"
      `,
      hint: 'All traffic concentrated on today\'s date partition'
    },
    {
      id: 3,
      title: 'DynamoDB Partition Math',
      type: 'config',
      content: `
\`\`\`markdown
# DynamoDB Partition Limits

## Hard Limits per Partition
- 3,000 RCU (Read Capacity Units)
- 1,000 WCU (Write Capacity Units)
- 10 GB data

## Capacity Distribution
Table capacity is divided EVENLY across partitions.

Example with 10,000 WCU and 5 partitions:
- Each partition gets: 10,000 / 5 = 2,000 WCU
- BUT max per partition is 1,000 WCU
- So each partition capped at 1,000 WCU

If all traffic hits ONE partition:
- Effective WCU = 1,000 (partition limit)
- Other 4 partitions' 4,000 WCU unused!

## Adaptive Capacity (helps but doesn't solve)
- AWS can boost hot partitions up to 3,000 WCU
- But takes time to detect and adapt
- Not a solution for sustained hot partitions
\`\`\`
      `,
      hint: 'Single partition can only use 1,000 WCU regardless of table provisioning'
    },
    {
      id: 4,
      title: 'Traffic Pattern Analysis',
      type: 'logs',
      content: `
\`\`\`
# Event write pattern (last hour)

Partition Key Distribution:
eventDate="2024-01-15" -> 2,847,000 items (100%)
eventDate="2024-01-14" -> 0 items
eventDate="2024-01-13" -> 0 items

Write Request Pattern:
09:00:00 - writeEvent(date=2024-01-15, ...)
09:00:00 - writeEvent(date=2024-01-15, ...)
09:00:00 - writeEvent(date=2024-01-15, ...)
09:00:01 - writeEvent(date=2024-01-15, ...)
... (every single write uses today's date)

# This is a textbook "hot partition" scenario
# All writes go to a single partition key
# Date as partition key = maximum hotness
\`\`\`
      `,
      hint: 'Every write in real-time analytics uses today\'s date - by definition hot'
    },
    {
      id: 5,
      title: 'AWS Best Practices Documentation',
      type: 'testimony',
      content: `
> "Using a partition key with high cardinality is the most important
> factor in ensuring even distribution of data across partitions."
>
> "Anti-pattern: Using date as a partition key for time-series data.
> All recent writes will hit a single partition."
>
> "Good patterns for time-series:
> - Compound key: userID + date
> - Write sharding: date + shard_id (0-9)
> - Device/sensor ID as partition key"
>
> -- AWS DynamoDB Best Practices Guide
      `,
      hint: 'Date as partition key is explicitly called out as an anti-pattern'
    },
    {
      id: 6,
      title: 'Current Query Patterns',
      type: 'code',
      content: `
\`\`\`typescript
// analytics-queries.ts

// Query 1: Get all events for a date (dashboard)
async function getEventsByDate(date: string) {
  return dynamodb.query({
    TableName: 'analytics-events',
    KeyConditionExpression: 'eventDate = :date',
    ExpressionAttributeValues: { ':date': { S: date } },
  });
}

// Query 2: Get events by user (user analytics)
async function getEventsByUser(userId: string, date: string) {
  return dynamodb.query({
    TableName: 'analytics-events',
    KeyConditionExpression: 'eventDate = :date',
    FilterExpression: 'userId = :uid',
    ExpressionAttributeValues: {
      ':date': { S: date },
      ':uid': { S: userId },
    },
  });
}

// The queries REQUIRE date as partition key...
// But that's what's causing the hot partition!
// Need to rethink the access pattern.
\`\`\`
      `,
      hint: 'Query patterns depend on date as partition key, but that causes hotness'
    }
  ],

  solution: {
    diagnosis: 'Using date as partition key concentrates all current writes on a single partition, exceeding the 1,000 WCU per-partition limit',

    keywords: [
      'dynamodb', 'hot partition', 'partition key', 'throttling', 'wcu',
      'write capacity', 'cardinality', 'sharding', 'time-series',
      'provisionedthroughputexceeded'
    ],

    rootCause: `
      DynamoDB distributes data and throughput across partitions based on the
      partition key. Each partition has a hard limit of 1,000 WCU regardless of
      the table's total provisioned capacity.

      The table used 'eventDate' (e.g., "2024-01-15") as the partition key. This
      meant that ALL events for today went to a single partition. With real-time
      analytics, 100% of writes always target "today's" partition.

      Even with 10,000 WCU provisioned, only one partition was receiving traffic,
      and that partition maxed out at ~1,000-3,000 WCU (with adaptive capacity).
      The remaining capacity on other partitions was completely unused.

      This is a classic "hot partition" anti-pattern where low-cardinality keys
      (like dates) cause uneven data distribution.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Solution 1: Write sharding with random suffix',
        code: `// Spread writes across multiple "shards" of the same date

const SHARD_COUNT = 10;

async function writeEvent(event: AnalyticsEvent) {
  const date = formatDate(new Date());
  const shard = Math.floor(Math.random() * SHARD_COUNT);

  await dynamodb.putItem({
    TableName: 'analytics-events',
    Item: {
      // Partition key now includes shard: "2024-01-15#3"
      eventDateShard: { S: \`\${date}#\${shard}\` },
      eventId: { S: \`\${Date.now()}-\${uuid()}\` },
      eventType: { S: event.type },
      userId: { S: event.userId },
      data: { M: marshall(event.data) },
    },
  });
}

// Query across all shards
async function getEventsByDate(date: string) {
  const queries = [];
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    queries.push(
      dynamodb.query({
        TableName: 'analytics-events',
        KeyConditionExpression: 'eventDateShard = :ds',
        ExpressionAttributeValues: {
          ':ds': { S: \`\${date}#\${shard}\` },
        },
      })
    );
  }

  const results = await Promise.all(queries);
  return results.flatMap(r => r.Items || []);
}`
      },
      {
        lang: 'typescript',
        description: 'Solution 2: Use high-cardinality key with GSI for queries',
        code: `// Use eventId (high cardinality) as partition key
// Create GSI for date-based queries

const tableDefinition = {
  TableName: 'analytics-events-v2',
  KeySchema: [
    { AttributeName: 'eventId', KeyType: 'HASH' },  // UUID - high cardinality
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'by-date',
      KeySchema: [
        { AttributeName: 'eventDate', KeyType: 'HASH' },
        { AttributeName: 'eventId', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
      // GSI can handle hot partitions better with on-demand
    },
    {
      IndexName: 'by-user-date',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'eventDate', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
  BillingMode: 'PAY_PER_REQUEST',  // On-demand handles bursts better
};

async function writeEvent(event: AnalyticsEvent) {
  await dynamodb.putItem({
    TableName: 'analytics-events-v2',
    Item: {
      eventId: { S: uuid() },  // High cardinality partition key
      eventDate: { S: formatDate(new Date()) },
      eventType: { S: event.type },
      userId: { S: event.userId },
      data: { M: marshall(event.data) },
    },
  });
}`
      },
      {
        lang: 'typescript',
        description: 'Solution 3: Compound key with userId',
        code: `// If you always query by user anyway, make userId the partition key

const tableDefinition = {
  TableName: 'analytics-events-v3',
  KeySchema: [
    { AttributeName: 'userId', KeyType: 'HASH' },     // User = partition key
    { AttributeName: 'eventTimestamp', KeyType: 'RANGE' },  // Time = sort key
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'by-date-type',
      KeySchema: [
        { AttributeName: 'eventDateType', KeyType: 'HASH' },  // "2024-01-15#click"
        { AttributeName: 'eventTimestamp', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'KEYS_ONLY' },
    },
  ],
};

async function writeEvent(event: AnalyticsEvent) {
  const timestamp = Date.now();
  const date = formatDate(new Date(timestamp));

  await dynamodb.putItem({
    TableName: 'analytics-events-v3',
    Item: {
      userId: { S: event.userId },
      eventTimestamp: { N: timestamp.toString() },
      eventDateType: { S: \`\${date}#\${event.type}\` },
      eventType: { S: event.type },
      data: { M: marshall(event.data) },
    },
  });
}

// Query by user (efficient - single partition)
async function getUserEvents(userId: string, startTime: number, endTime: number) {
  return dynamodb.query({
    TableName: 'analytics-events-v3',
    KeyConditionExpression: 'userId = :uid AND eventTimestamp BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':uid': { S: userId },
      ':start': { N: startTime.toString() },
      ':end': { N: endTime.toString() },
    },
  });
}`
      },
      {
        lang: 'typescript',
        description: 'Solution 4: Kinesis Data Streams for high-volume writes',
        code: `// For extreme write volumes, buffer through Kinesis

import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({});
const eventBuffer: AnalyticsEvent[] = [];
const BATCH_SIZE = 500;
const FLUSH_INTERVAL = 1000;  // 1 second

async function writeEvent(event: AnalyticsEvent) {
  eventBuffer.push(event);

  if (eventBuffer.length >= BATCH_SIZE) {
    await flushToKinesis();
  }
}

async function flushToKinesis() {
  if (eventBuffer.length === 0) return;

  const records = eventBuffer.splice(0, BATCH_SIZE).map(event => ({
    Data: Buffer.from(JSON.stringify(event)),
    // Use random partition key for even distribution across shards
    PartitionKey: uuid(),
  }));

  await kinesis.send(new PutRecordsCommand({
    StreamName: 'analytics-events-stream',
    Records: records,
  }));
}

// Kinesis -> Lambda -> DynamoDB with batching
// Lambda processes in batches with retry logic
// Much more resilient to traffic spikes

setInterval(flushToKinesis, FLUSH_INTERVAL);`
      }
    ],

    prevention: [
      'Never use low-cardinality values (dates, status codes) as partition keys',
      'Use write sharding for time-series data with predictable patterns',
      'Enable DynamoDB Contributor Insights to detect hot partitions',
      'Consider on-demand billing mode for unpredictable workloads',
      'Design partition keys based on query patterns AND write distribution',
      'Use Kinesis or SQS to buffer high-volume writes',
      'Monitor ConsumedWriteCapacity vs ThrottledRequests, not just provisioned'
    ],

    educationalInsights: [
      'DynamoDB throughput is per-partition, not just per-table',
      'Each partition is limited to 1,000 WCU and 3,000 RCU regardless of table capacity',
      'Partition key design is the most critical DynamoDB decision',
      'Write sharding trades query complexity for write scalability',
      'Adaptive capacity helps but cannot fix fundamentally hot partitions',
      'High-cardinality partition keys (userId, deviceId, UUID) distribute load evenly'
    ]
  }
};

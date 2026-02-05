import { DetectiveCase } from '../../types';

export const snsFanoutBottleneck: DetectiveCase = {
  id: 'sns-fanout-bottleneck',
  title: 'The SNS Fan-out Bottleneck',
  subtitle: 'Message distribution delays causing downstream processing lag',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your event-driven architecture uses SNS to fan out events to multiple SQS
      queues. After adding the 10th subscriber, message delivery delays increased
      from milliseconds to minutes. Some events are arriving out of order, and
      duplicate processing is occurring. The system worked perfectly with fewer
      subscribers.
    `,
    impact: `
      Order events delayed by 3-5 minutes. Inventory not updating in real-time.
      Customer notifications arriving late. Analytics dashboard showing stale data.
      Duplicate charges detected in payment reconciliation.
    `,
    timeline: [
      { time: 'Monday', event: '10th SQS subscriber added to order-events topic', type: 'normal' },
      { time: 'Tuesday', event: 'Latency alerts from inventory service', type: 'warning' },
      { time: 'Wednesday', event: 'Customer complaints about late notifications', type: 'warning' },
      { time: 'Thursday', event: 'Duplicate payment processing detected', type: 'critical' },
      { time: 'Friday', event: 'Message delivery delay reaches 5 minutes at peak', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'SNS topic accepts messages immediately',
      'Messages eventually reach all subscribers',
      'No SNS delivery failures reported',
      'Individual SQS consumers processing normally'
    ],
    broken: [
      'End-to-end latency increased from <1s to 3-5 minutes',
      'SQS ApproximateAgeOfOldestMessage spiking',
      'Out-of-order message delivery to some queues',
      'Duplicate messages appearing in some consumers'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'SNS Topic Subscription List',
      type: 'config',
      content: `
\`\`\`json
{
  "TopicArn": "arn:aws:sns:us-east-1:123456789:order-events",
  "Subscriptions": [
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:order-fulfillment" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:inventory-update" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:payment-processing" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:customer-notifications" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:analytics-events" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:fraud-detection" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:shipping-service" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:audit-logging" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:search-indexing" },
    { "Protocol": "sqs", "Endpoint": "arn:aws:sqs:...:ml-training-data" },
    { "Protocol": "lambda", "Endpoint": "arn:aws:lambda:...:order-validator" },
    { "Protocol": "lambda", "Endpoint": "arn:aws:lambda:...:metrics-collector" }
  ]
}

// 10 SQS queues + 2 Lambda functions = 12 subscribers
\`\`\`
      `,
      hint: '12 subscribers means each message triggers 12 parallel deliveries'
    },
    {
      id: 2,
      title: 'Publisher Code',
      type: 'code',
      content: `
\`\`\`typescript
// order-service.ts
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'us-east-1' });

async function publishOrderEvent(order: Order) {
  const event = {
    eventType: 'ORDER_CREATED',
    orderId: order.id,
    timestamp: new Date().toISOString(),
    data: order,  // Full order object
  };

  await sns.send(new PublishCommand({
    TopicArn: ORDER_EVENTS_TOPIC,
    Message: JSON.stringify(event),
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: event.eventType,
      },
    },
  }));
}

// Called for every order
// Average: 500 orders/minute at peak
// Each order publishes 1 SNS message
// Each SNS message fans out to 12 subscribers
// Total: 500 * 12 = 6,000 SQS messages/minute
\`\`\`
      `,
      hint: '500 orders/minute becomes 6,000 SQS messages/minute with 12 subscribers'
    },
    {
      id: 3,
      title: 'SQS Queue Metrics',
      type: 'metrics',
      content: `
## SQS Queue Metrics (Peak Hour)

| Queue | Messages Received | Oldest Message Age | Duplicates |
|-------|-------------------|-------------------|------------|
| order-fulfillment | 30,000/hr | 45 seconds | 0 |
| inventory-update | 30,000/hr | 2 minutes | 12 |
| payment-processing | 30,000/hr | 3 minutes | 45 |
| customer-notifications | 30,000/hr | 5 minutes | 23 |
| analytics-events | 30,000/hr | 4 minutes | 8 |
| fraud-detection | 30,000/hr | 30 seconds | 2 |
| shipping-service | 30,000/hr | 3 minutes | 18 |
| audit-logging | 30,000/hr | 5 minutes | 5 |
| search-indexing | 30,000/hr | 4 minutes | 15 |
| ml-training-data | 30,000/hr | 5 minutes | 3 |

**Pattern:** Queues processed by slower consumers have higher delay and duplicates
      `,
      hint: 'Slower consumers accumulate backlog and experience more duplicates'
    },
    {
      id: 4,
      title: 'Consumer Processing Times',
      type: 'metrics',
      content: `
## Consumer Processing Performance

| Consumer | Avg Processing Time | Concurrency | Throughput |
|----------|---------------------|-------------|------------|
| order-fulfillment | 50ms | 10 | 200/sec |
| fraud-detection | 80ms | 20 | 250/sec |
| inventory-update | 200ms | 5 | 25/sec |
| payment-processing | 500ms | 3 | 6/sec |
| customer-notifications | 300ms | 2 | 6.6/sec |
| analytics-events | 100ms | 5 | 50/sec |
| shipping-service | 400ms | 3 | 7.5/sec |
| audit-logging | 50ms | 2 | 40/sec |
| search-indexing | 150ms | 4 | 26/sec |
| ml-training-data | 1000ms | 1 | 1/sec |

**Incoming rate:** 500 messages/minute = 8.3/sec per queue
**Problem queues:** payment-processing (6/sec), customer-notifications (6.6/sec),
shipping-service (7.5/sec), ml-training-data (1/sec)

These queues can't keep up with incoming rate!
      `,
      hint: 'Several consumers process slower than the incoming message rate'
    },
    {
      id: 5,
      title: 'SNS Delivery Behavior',
      type: 'testimony',
      content: `
> "Amazon SNS delivers messages to Amazon SQS queues approximately in the
> order in which they are published. However, due to the distributed nature
> of SNS, messages may occasionally be delivered out of order."
>
> "If a message cannot be successfully delivered on the first attempt,
> Amazon SNS retries the delivery. Messages are retried based on the
> delivery retry policy."
>
> "By default, if initial delivery to an SQS queue fails, SNS will retry
> with exponential backoff for up to 23 days before giving up."
>
> "SNS does not provide exactly-once delivery. If your application requires
> exactly-once processing, implement idempotency in your consumers."
>
> -- AWS SNS Documentation

**Hidden fact:** When SQS throttles (queue full or permission issue),
SNS retries create DUPLICATE messages.
      `,
      hint: 'SNS retries on delivery failure can cause duplicates'
    },
    {
      id: 6,
      title: 'CloudWatch SNS Metrics',
      type: 'logs',
      content: `
\`\`\`
# SNS NumberOfMessagesPublished vs NumberOfNotificationsDelivered

Time: 10:00 AM
  Published: 500
  Delivered: 5,850 (expected: 6,000)
  Failed: 150

Time: 10:05 AM
  Published: 520
  Delivered: 6,350 (higher than expected!)
  Failed: 180
  # The extra deliveries are retries from 10:00!

Time: 10:10 AM
  Published: 480
  Delivered: 6,900 (way higher!)
  Failed: 200
  # Retries compounding

# SNS retries failed deliveries, which adds to the flood
# But the retries are delayed, causing out-of-order delivery
# And some retries eventually succeed, creating duplicates

# Root issue: Some SQS queues are throttling
# - ml-training-data: 15% delivery failure (queue backlogged)
# - payment-processing: 8% delivery failure
# - customer-notifications: 5% delivery failure
\`\`\`
      `,
      hint: 'Delivery failures cause retries, retries cause duplicates and delays'
    }
  ],

  solution: {
    diagnosis: 'Slow consumers cannot keep up with fan-out volume, causing SQS backlog, which triggers SNS delivery retries creating duplicates and delays',

    keywords: [
      'sns', 'sqs', 'fan-out', 'backpressure', 'throttling', 'consumer lag',
      'duplicate', 'idempotency', 'message ordering', 'at-least-once',
      'event-driven', 'pub-sub'
    ],

    rootCause: `
      The fan-out architecture multiplied every published message by 12 (the number
      of subscribers). At 500 orders/minute, this created 6,000 SQS messages/minute
      spread across 12 queues (500/minute each).

      Several consumers couldn't keep up:
      - ml-training-data: 1/sec capacity vs 8.3/sec incoming = massive backlog
      - payment-processing: 6/sec vs 8.3/sec = slow but growing backlog
      - customer-notifications: 6.6/sec vs 8.3/sec = backlog

      As queues backed up, two problems emerged:

      1. **Delivery Delays**: When SQS queues have deep backlogs, new messages
         wait longer to be processed. The 5-minute delay was the queue depth
         divided by processing rate.

      2. **Duplicate Messages**: When SNS encounters delivery failures (including
         timeouts due to slow SQS responses), it retries. But the original
         delivery often succeeded - it was just slow. Both the original and
         retry end up in the queue = duplicates.

      3. **Out-of-Order Delivery**: Retries happen after a delay, so a message
         from 10:00 AM might arrive after a message from 10:05 AM.

      The system appeared to work until the 10th subscriber was added because
      the total load was below the slowest consumer's capacity. The new
      ml-training-data consumer (1/sec throughput) became the bottleneck.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fix 1: Implement idempotent consumers',
        code: `// payment-consumer.ts - Idempotent processing
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

const sqs = new SQSClient({});
const dynamodb = new DynamoDBClient({});

async function processPayment(message: SQSMessage) {
  const event = JSON.parse(message.Body);
  const { orderId, eventType, timestamp } = event;

  // Idempotency key: orderId + eventType
  const idempotencyKey = \`\${orderId}#\${eventType}\`;

  try {
    // Try to claim this event (atomic operation)
    await dynamodb.send(new PutItemCommand({
      TableName: 'processed-events',
      Item: {
        pk: { S: idempotencyKey },
        processedAt: { S: new Date().toISOString() },
        messageId: { S: message.MessageId },
        ttl: { N: String(Math.floor(Date.now() / 1000) + 86400 * 7) },  // 7 day TTL
      },
      ConditionExpression: 'attribute_not_exists(pk)',  // Only if not already processed
    }));

    // We claimed it - process the payment
    console.log(\`Processing payment for order \${orderId}\`);
    await processPaymentLogic(event);

  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Already processed - this is a duplicate
      console.log(\`Duplicate event for order \${orderId}, skipping\`);
    } else {
      throw error;  // Real error, let SQS retry
    }
  }

  // Delete message from queue (even for duplicates)
  await sqs.send(new DeleteMessageCommand({
    QueueUrl: PAYMENT_QUEUE_URL,
    ReceiptHandle: message.ReceiptHandle,
  }));
}`
      },
      {
        lang: 'typescript',
        description: 'Fix 2: Use filter policies to reduce unnecessary messages',
        code: `// Not all subscribers need all events!
// Use SNS filter policies to route only relevant messages

import { SNSClient, SubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';

// Set filter policy on subscription
await sns.send(new SetSubscriptionAttributesCommand({
  SubscriptionArn: ML_TRAINING_SUBSCRIPTION_ARN,
  AttributeName: 'FilterPolicy',
  AttributeValue: JSON.stringify({
    // Only receive ORDER_COMPLETED events for ML training
    eventType: ['ORDER_COMPLETED'],
    // And only for orders > $100 (worth training on)
    orderAmount: [{ numeric: ['>', 100] }],
  }),
}));

// Filter policies for different subscribers:
const filterPolicies = {
  'fraud-detection': { eventType: ['ORDER_CREATED', 'PAYMENT_INITIATED'] },
  'inventory-update': { eventType: ['ORDER_CREATED', 'ORDER_CANCELLED'] },
  'customer-notifications': { eventType: ['ORDER_SHIPPED', 'ORDER_DELIVERED'] },
  'ml-training-data': { eventType: ['ORDER_COMPLETED'], orderAmount: [{ numeric: ['>', 100] }] },
  'analytics-events': { /* all events */ },  // No filter
};

// Result: ml-training-data now receives 10% of messages (ORDER_COMPLETED only)
// Instead of 500/min, it gets 50/min - within its 1/sec capacity!`
      },
      {
        lang: 'typescript',
        description: 'Fix 3: Scale consumers based on queue depth',
        code: `// consumer-scaler.ts - Auto-scale based on SQS metrics
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';

const sqs = new SQSClient({});
const ecs = new ECSClient({});

interface QueueConfig {
  queueUrl: string;
  serviceName: string;
  minTasks: number;
  maxTasks: number;
  targetMessagesPerTask: number;  // Scale when backlog exceeds this
}

async function scaleConsumers(config: QueueConfig) {
  // Get current queue depth
  const attrs = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: config.queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));

  const visible = parseInt(attrs.Attributes?.ApproximateNumberOfMessages || '0');
  const inFlight = parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
  const totalBacklog = visible + inFlight;

  // Calculate desired task count
  const desiredTasks = Math.min(
    config.maxTasks,
    Math.max(
      config.minTasks,
      Math.ceil(totalBacklog / config.targetMessagesPerTask)
    )
  );

  console.log(\`Queue \${config.queueUrl}: backlog=\${totalBacklog}, scaling to \${desiredTasks} tasks\`);

  await ecs.send(new UpdateServiceCommand({
    cluster: 'production',
    service: config.serviceName,
    desiredCount: desiredTasks,
  }));
}

// Run every minute
const consumerConfigs: QueueConfig[] = [
  {
    queueUrl: PAYMENT_QUEUE_URL,
    serviceName: 'payment-processor',
    minTasks: 3,
    maxTasks: 20,
    targetMessagesPerTask: 100,  // Scale up when > 100 messages per task
  },
  {
    queueUrl: ML_TRAINING_QUEUE_URL,
    serviceName: 'ml-trainer',
    minTasks: 1,
    maxTasks: 10,
    targetMessagesPerTask: 500,  // ML can batch more
  },
];

setInterval(() => {
  consumerConfigs.forEach(config => scaleConsumers(config));
}, 60000);`
      },
      {
        lang: 'yaml',
        description: 'Fix 4: Use EventBridge instead of SNS for complex routing',
        code: `# EventBridge provides more flexible routing and batching
# Replace SNS fan-out with EventBridge rules

# Event pattern for order events
EventBus:
  Type: AWS::Events::EventBus
  Properties:
    Name: order-events

# Rule for each subscriber with specific patterns
PaymentRule:
  Type: AWS::Events::Rule
  Properties:
    EventBusName: !Ref EventBus
    EventPattern:
      source: ["order-service"]
      detail-type: ["ORDER_CREATED", "PAYMENT_INITIATED"]
    Targets:
      - Id: payment-queue
        Arn: !GetAtt PaymentQueue.Arn
        SqsParameters:
          MessageGroupId: $.detail.orderId  # FIFO ordering by order

# Slow consumer with batching
MLTrainingRule:
  Type: AWS::Events::Rule
  Properties:
    EventBusName: !Ref EventBus
    EventPattern:
      source: ["order-service"]
      detail-type: ["ORDER_COMPLETED"]
      detail:
        orderAmount: [{"numeric": [">", 100]}]
    Targets:
      - Id: ml-training
        Arn: !GetAtt MLTrainingQueue.Arn

# Benefits of EventBridge over SNS:
# 1. Content-based filtering (filter on any field in event)
# 2. Archive and replay (reprocess old events)
# 3. Input transformers (reshape events per consumer)
# 4. Better observability (CloudWatch integration)
# 5. Schema registry for event contracts`
      },
      {
        lang: 'typescript',
        description: 'Fix 5: Add backpressure with SQS batching',
        code: `// batch-consumer.ts - Process messages in batches for slow consumers
import { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const BATCH_SIZE = 10;
const WAIT_TIME_SECONDS = 20;

async function processBatch() {
  // Receive up to 10 messages at once
  const response = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: ML_TRAINING_QUEUE_URL,
    MaxNumberOfMessages: BATCH_SIZE,
    WaitTimeSeconds: WAIT_TIME_SECONDS,  // Long polling
    VisibilityTimeout: 300,  // 5 minutes to process batch
  }));

  const messages = response.Messages || [];
  if (messages.length === 0) return;

  console.log(\`Received batch of \${messages.length} messages\`);

  // Process entire batch at once (much more efficient for ML)
  const events = messages.map(m => JSON.parse(m.Body!));
  await processMLBatch(events);  // Batch insert to training data store

  // Delete all processed messages
  await sqs.send(new DeleteMessageBatchCommand({
    QueueUrl: ML_TRAINING_QUEUE_URL,
    Entries: messages.map((m, i) => ({
      Id: String(i),
      ReceiptHandle: m.ReceiptHandle!,
    })),
  }));

  console.log(\`Processed and deleted \${messages.length} messages\`);
}

async function processMLBatch(events: OrderEvent[]) {
  // Batch insert is much faster than individual inserts
  // 10 events at 1 second each = 10 seconds
  // 10 events batched = 1.5 seconds
  await mlDataStore.batchInsert(events);
}

// Run continuously
async function main() {
  while (true) {
    try {
      await processBatch();
    } catch (error) {
      console.error('Batch processing error:', error);
      await sleep(5000);  // Back off on error
    }
  }
}`
      }
    ],

    prevention: [
      'Always implement idempotent consumers for at-least-once delivery systems',
      'Use SNS filter policies to reduce unnecessary message delivery',
      'Monitor consumer lag (ApproximateAgeOfOldestMessage) per queue',
      'Auto-scale consumers based on queue depth, not just CPU',
      'Consider batching for slow consumers to improve throughput',
      'Evaluate EventBridge for complex routing needs',
      'Load test fan-out patterns with realistic subscriber counts',
      'Document throughput requirements for each consumer before adding'
    ],

    educationalInsights: [
      'Fan-out multiplies message volume by subscriber count',
      'SNS provides at-least-once delivery - consumers must handle duplicates',
      'Slow consumers create backpressure that affects the entire system',
      'Filter policies reduce load by preventing unnecessary deliveries',
      'Idempotency is essential for any distributed messaging system',
      'EventBridge offers more flexibility than SNS for complex event routing'
    ]
  }
};

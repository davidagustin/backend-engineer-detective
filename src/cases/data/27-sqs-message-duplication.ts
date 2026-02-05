import { DetectiveCase } from '../../types';

export const sqsMessageDuplication: DetectiveCase = {
  id: 'sqs-message-duplication',
  title: 'The SQS Message Duplication Mystery',
  subtitle: 'At-least-once delivery causing duplicate order processing',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Customers are being charged multiple times for the same order. Your order
      processing system uses SQS to decouple the checkout from payment processing.
      The duplicate charges are intermittent but increasing, causing refund requests
      and angry customer complaints.
    `,
    impact: `
      45 customers double-charged today. Customer support overwhelmed with refund requests.
      Trust eroding, social media complaints growing. Potential payment processor penalties.
    `,
    timeline: [
      { time: 'Week 1', event: 'New SQS-based order processing deployed', type: 'normal' },
      { time: 'Week 2', event: 'First duplicate charge reported', type: 'warning' },
      { time: 'Week 3', event: 'Duplicate charges increasing to 5/day', type: 'warning' },
      { time: 'Week 4', event: '45 duplicates in one day after traffic spike', type: 'critical' },
      { time: 'Week 4', event: 'Payment processor issues warning about refund rate', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Orders are being processed and payments collected',
      'SQS messages are being delivered',
      'Consumer service is processing messages',
      'No errors in application logs'
    ],
    broken: [
      'Same order charged 2-3 times intermittently',
      'Duplicate charges correlate with high traffic periods',
      'Database shows multiple payment records for same order',
      'SQS ApproximateNumberOfMessagesNotVisible spikes'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Order Processing Architecture',
      type: 'code',
      content: `
\`\`\`typescript
// checkout-service.ts
async function checkout(order: Order) {
  // Save order to database
  await db.orders.create(order);

  // Queue for payment processing
  await sqs.sendMessage({
    QueueUrl: PAYMENT_QUEUE_URL,
    MessageBody: JSON.stringify({
      orderId: order.id,
      amount: order.total,
      customerId: order.customerId,
    }),
  });

  return { status: 'pending', orderId: order.id };
}

// payment-processor.ts
async function processPayment(message: SQSMessage) {
  const { orderId, amount, customerId } = JSON.parse(message.Body);

  // Charge the customer
  const charge = await stripe.charges.create({
    amount: amount * 100,  // Stripe uses cents
    currency: 'usd',
    customer: customerId,
    metadata: { orderId },
  });

  // Update order status
  await db.orders.update(orderId, {
    status: 'paid',
    chargeId: charge.id,
  });

  // Delete message from queue
  await sqs.deleteMessage({
    QueueUrl: PAYMENT_QUEUE_URL,
    ReceiptHandle: message.ReceiptHandle,
  });
}
\`\`\`
      `,
      hint: 'What happens if processPayment takes too long or fails after charging?'
    },
    {
      id: 2,
      title: 'SQS Queue Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# CloudFormation - SQS Queue Definition
PaymentQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: payment-processing
    VisibilityTimeout: 30    # Message hidden for 30 seconds
    MessageRetentionPeriod: 1209600  # 14 days
    ReceiveMessageWaitTimeSeconds: 20
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt PaymentDLQ.Arn
      maxReceiveCount: 3     # Move to DLQ after 3 attempts

# Note: Standard Queue (not FIFO)
# Standard queues provide "at-least-once" delivery
\`\`\`
      `,
      hint: 'Standard queue with 30-second visibility timeout'
    },
    {
      id: 3,
      title: 'Payment Processing Metrics',
      type: 'metrics',
      content: `
## Payment Processor Performance

| Metric | p50 | p90 | p99 |
|--------|-----|-----|-----|
| Processing Time | 2s | 15s | 45s |
| Stripe API Latency | 1s | 8s | 30s |
| DB Update Time | 50ms | 200ms | 1s |

## SQS Metrics During Incident
| Metric | Value |
|--------|-------|
| Messages Sent | 2,847 |
| Messages Received | 3,214 |
| Messages Deleted | 2,847 |
| Approx Not Visible | Spikes to 500+ |

**Note:** Messages Received > Messages Sent indicates redelivery!
      `,
      hint: 'p99 processing time (45s) exceeds visibility timeout (30s)'
    },
    {
      id: 4,
      title: 'CloudWatch Logs Analysis',
      type: 'logs',
      content: `
\`\`\`
# Searching for order #12345 (duplicate charge)

[10:15:00.000] Processing message for order 12345
[10:15:01.500] Calling Stripe API for order 12345
[10:15:30.001] VISIBILITY TIMEOUT - message becomes visible again
[10:15:32.000] Processing message for order 12345 (2nd consumer picks it up)
[10:15:33.500] Calling Stripe API for order 12345 (2nd charge!)
[10:15:35.000] Stripe charge succeeded for order 12345 (2nd consumer)
[10:15:37.000] Updated order 12345 status to paid (2nd consumer)
[10:15:38.000] Deleted message for order 12345 (2nd consumer)
[10:15:40.000] Stripe charge succeeded for order 12345 (1st consumer, finally)
[10:15:41.000] Updated order 12345 status to paid (1st consumer, overwrites)
[10:15:42.000] Deleted message for order 12345 (1st consumer, already deleted)

# The first consumer was slow (Stripe took 38 seconds)
# Visibility timeout expired at 30 seconds
# Second consumer processed the same message
# Both consumers charged Stripe successfully
\`\`\`
      `,
      hint: 'First consumer took 38s, timeout is 30s, so second consumer got the message'
    },
    {
      id: 5,
      title: 'AWS SQS Documentation',
      type: 'testimony',
      content: `
> "Amazon SQS standard queues offer maximum throughput, best-effort ordering,
> and at-least-once delivery."
>
> "At-least-once delivery means that a message is delivered at least once,
> but occasionally more than one copy of a message is delivered."
>
> "After a message is received from the queue, it's still in the queue.
> To prevent other consumers from processing the message again, set a
> visibility timeout—a period during which Amazon SQS prevents other
> consumers from receiving and processing the message."
>
> "If processing takes longer than the visibility timeout, the message
> becomes visible again and another consumer can process it."
>
> -- AWS SQS Developer Guide
      `,
      hint: 'SQS intentionally provides at-least-once, not exactly-once delivery'
    },
    {
      id: 6,
      title: 'Database Payment Records',
      type: 'logs',
      content: `
\`\`\`sql
-- Check for duplicate charges on order 12345
SELECT
  order_id,
  charge_id,
  amount,
  created_at
FROM payments
WHERE order_id = '12345'
ORDER BY created_at;

-- Results:
order_id | charge_id        | amount | created_at
---------|------------------|--------|--------------------
12345    | ch_3NqX2Y...abc  | 99.99  | 2024-01-15 10:15:35
12345    | ch_3NqX2Y...def  | 99.99  | 2024-01-15 10:15:40

-- Two different Stripe charges for the same order!
-- The DB update used UPDATE which just overwrites, losing the first charge_id
-- But Stripe processed both charges

-- Check orders table
SELECT * FROM orders WHERE id = '12345';
-- Shows charge_id = ch_3NqX2Y...def (the second one overwrote the first)
\`\`\`
      `,
      hint: 'Two Stripe charges created, but order table only shows the last one'
    }
  ],

  solution: {
    diagnosis: 'Visibility timeout shorter than worst-case processing time combined with non-idempotent payment processing leads to duplicate charges',

    keywords: [
      'sqs', 'at-least-once', 'exactly-once', 'idempotent', 'idempotency',
      'visibility timeout', 'duplicate', 'message deduplication',
      'fifo queue', 'stripe idempotency key'
    ],

    rootCause: `
      The system had two problems:

      1. **Visibility Timeout Too Short**: The SQS visibility timeout was set to 30
         seconds, but payment processing could take up to 45 seconds at p99 (mostly
         due to Stripe API latency). When processing took longer than 30 seconds,
         the message became visible again and another consumer picked it up.

      2. **Non-Idempotent Processing**: The payment processor didn't check if the
         order had already been charged before calling Stripe. SQS guarantees
         "at-least-once" delivery, meaning your consumer MUST handle duplicates.

      The combination meant that slow requests caused:
      - Message redelivery to another consumer
      - Both consumers calling Stripe
      - Both Stripe calls succeeding (Stripe doesn't know they're duplicates)
      - Customer charged twice

      This is a fundamental characteristic of standard SQS queues - they provide
      high throughput and availability by not guaranteeing exactly-once delivery.
      The consumer is responsible for idempotency.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fix 1: Use Stripe idempotency key to prevent duplicate charges',
        code: `// payment-processor.ts - Idempotent with Stripe

async function processPayment(message: SQSMessage) {
  const { orderId, amount, customerId } = JSON.parse(message.Body);

  // Use orderId as idempotency key - Stripe will reject duplicates
  const charge = await stripe.charges.create({
    amount: amount * 100,
    currency: 'usd',
    customer: customerId,
    metadata: { orderId },
  }, {
    idempotencyKey: \`order-\${orderId}\`,  // Stripe tracks this for 24 hours
  });

  // Rest of the processing...
  await db.orders.update(orderId, {
    status: 'paid',
    chargeId: charge.id,
  });

  await sqs.deleteMessage({
    QueueUrl: PAYMENT_QUEUE_URL,
    ReceiptHandle: message.ReceiptHandle,
  });
}

// Now even if two consumers process the same order:
// - First consumer: Stripe creates charge, returns charge object
// - Second consumer: Stripe recognizes idempotency key, returns SAME charge object
// - Both consumers update DB with same chargeId
// - Customer charged only once!`
      },
      {
        lang: 'typescript',
        description: 'Fix 2: Check order status before processing',
        code: `// payment-processor.ts - Check-then-charge pattern

async function processPayment(message: SQSMessage) {
  const { orderId, amount, customerId } = JSON.parse(message.Body);

  // Atomic check-and-update to claim this order
  const result = await db.query(\`
    UPDATE orders
    SET status = 'processing', processing_started_at = NOW()
    WHERE id = $1 AND status = 'pending'
    RETURNING *
  \`, [orderId]);

  if (result.rowCount === 0) {
    // Order already being processed or completed
    console.log(\`Order \${orderId} already processed, skipping\`);
    await sqs.deleteMessage({
      QueueUrl: PAYMENT_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    });
    return;
  }

  try {
    const charge = await stripe.charges.create({
      amount: amount * 100,
      currency: 'usd',
      customer: customerId,
      metadata: { orderId },
    }, {
      idempotencyKey: \`order-\${orderId}\`,  // Still use this as backup!
    });

    await db.orders.update(orderId, {
      status: 'paid',
      chargeId: charge.id,
    });
  } catch (error) {
    // Reset status so message can be retried
    await db.orders.update(orderId, { status: 'pending' });
    throw error;  // Let SQS retry
  }

  await sqs.deleteMessage({
    QueueUrl: PAYMENT_QUEUE_URL,
    ReceiptHandle: message.ReceiptHandle,
  });
}`
      },
      {
        lang: 'typescript',
        description: 'Fix 3: Increase visibility timeout and extend during processing',
        code: `// payment-processor.ts - Dynamic visibility timeout

const INITIAL_VISIBILITY = 60;  // Start with 60 seconds
const EXTENSION_INTERVAL = 30;  // Extend every 30 seconds

async function processPayment(message: SQSMessage) {
  const { orderId, amount, customerId } = JSON.parse(message.Body);

  // Start heartbeat to extend visibility timeout
  const heartbeat = setInterval(async () => {
    try {
      await sqs.changeMessageVisibility({
        QueueUrl: PAYMENT_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: INITIAL_VISIBILITY,  // Extend by another 60s
      });
      console.log(\`Extended visibility for order \${orderId}\`);
    } catch (error) {
      console.error('Failed to extend visibility:', error);
    }
  }, EXTENSION_INTERVAL * 1000);

  try {
    // Use Stripe idempotency key (always!)
    const charge = await stripe.charges.create({
      amount: amount * 100,
      currency: 'usd',
      customer: customerId,
      metadata: { orderId },
    }, {
      idempotencyKey: \`order-\${orderId}\`,
    });

    await db.orders.update(orderId, {
      status: 'paid',
      chargeId: charge.id,
    });

    await sqs.deleteMessage({
      QueueUrl: PAYMENT_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    });
  } finally {
    clearInterval(heartbeat);  // Stop heartbeat
  }
}`
      },
      {
        lang: 'yaml',
        description: 'Use SQS FIFO queue for exactly-once processing',
        code: `# CloudFormation - FIFO Queue with deduplication
PaymentQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: payment-processing.fifo  # Must end in .fifo
    FifoQueue: true
    ContentBasedDeduplication: true  # Auto-dedupe by message body hash
    VisibilityTimeout: 120  # 2 minutes
    DeduplicationScope: messageGroup
    FifoThroughputLimit: perMessageGroupId

# Sending to FIFO queue requires MessageGroupId
# await sqs.sendMessage({
#   QueueUrl: PAYMENT_QUEUE_URL,
#   MessageBody: JSON.stringify({ orderId, amount, customerId }),
#   MessageGroupId: customerId,  # Orders from same customer processed in order
#   MessageDeduplicationId: orderId,  # Explicit deduplication
# });

# Benefits:
# - Exactly-once processing within deduplication window (5 minutes)
# - Ordered processing within message group
# Tradeoffs:
# - Lower throughput (300 TPS per message group, 3000 TPS per queue)
# - More expensive than standard queues`
      }
    ],

    prevention: [
      'Always use idempotency keys when calling payment APIs',
      'Set visibility timeout to 3x your p99 processing time',
      'Use heartbeat pattern to extend visibility for long operations',
      'Implement idempotency at the application level with database checks',
      'Consider FIFO queues for exactly-once requirements (accept throughput tradeoff)',
      'Log idempotency key usage for debugging duplicates',
      'Monitor message receive count vs send count for redelivery detection'
    ],

    educationalInsights: [
      'SQS standard queues are designed for at-least-once delivery, not exactly-once',
      'Exactly-once is extremely hard in distributed systems - prefer idempotent operations',
      'Idempotency key: same input always produces same output (safe to retry)',
      'Visibility timeout is a lease, not a guarantee - extend it for long operations',
      'Payment systems should always use idempotency keys regardless of queue type',
      'FIFO queues trade throughput for ordering and exactly-once delivery'
    ]
  }
};

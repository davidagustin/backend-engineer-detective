import { DetectiveCase } from '../../types';

export const natsJetstreamReplay: DetectiveCase = {
  id: 'nats-jetstream-replay',
  title: 'The NATS JetStream Replay',
  subtitle: 'Messages mysteriously replayed after consumer restart',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your payment notification service uses NATS JetStream to process payment events.
      After a routine deployment that restarted the consumer pods, customers started
      receiving duplicate payment confirmation emails - some received 50+ copies of
      the same email within minutes.
    `,
    impact: `
      15,000 customers received duplicate emails. Support tickets flooding in.
      Brand reputation damaged. Some customers thought they were charged multiple
      times and initiated chargebacks.
    `,
    timeline: [
      { time: '11:00 AM', event: 'Deployment started for notification service', type: 'normal' },
      { time: '11:02 AM', event: 'Consumer pods restarted', type: 'normal' },
      { time: '11:03 AM', event: 'Email sending rate spiked 50x', type: 'warning' },
      { time: '11:05 AM', event: 'Customer complaints start arriving', type: 'warning' },
      { time: '11:10 AM', event: 'Duplicate email reports reach 5,000', type: 'critical' },
      { time: '11:15 AM', event: 'Email service disabled manually', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'NATS JetStream cluster is healthy',
      'Messages are being delivered to consumers',
      'No errors in consumer application logs',
      'Email service is sending successfully',
      'Network connectivity is stable'
    ],
    broken: [
      'Same messages processed multiple times after restart',
      'Email sending rate 50x higher than expected',
      'Consumer position seems to reset on restart',
      'Old messages being reprocessed instead of new ones',
      'Duplicate detection not working'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Consumer Subscription Code',
      type: 'code',
      content: `
\`\`\`javascript
const nats = require('nats');
const { AckPolicy, DeliverPolicy } = require('nats');

async function startConsumer() {
  const nc = await nats.connect({ servers: 'nats://nats:4222' });
  const js = nc.jetstream();

  // Subscribe to payment events
  const sub = await js.subscribe('payments.completed', {
    // Consumer configuration
    config: {
      durable_name: 'payment-notifier',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,  // <-- Hmm...
      max_deliver: 3,
    }
  });

  for await (const msg of sub) {
    await sendPaymentEmail(msg.data);
    msg.ack();
  }
}
\`\`\`
      `,
      hint: 'What does DeliverPolicy.All mean for message delivery?'
    },
    {
      id: 2,
      title: 'JetStream Consumer Info',
      type: 'metrics',
      content: `
## Consumer: payment-notifier

| Property | Value |
|----------|-------|
| Stream | PAYMENTS |
| Durable Name | payment-notifier |
| Ack Policy | Explicit |
| Deliver Policy | **All** |
| Ack Wait | 30s |
| Max Deliver | 3 |

## Consumer State (after restart)

| Metric | Before Restart | After Restart |
|--------|----------------|---------------|
| Delivered | 847,293 | 0 |
| Ack Pending | 0 | 0 |
| Redelivered | 12 | 847,293 |
| Stream Sequence | 847,293 | 847,293 |
| Consumer Sequence | 847,293 | 1 |

**Note:** Consumer sequence reset to 1 after restart
      `,
      hint: 'Why would consumer sequence reset but stream sequence stay the same?'
    },
    {
      id: 3,
      title: 'NATS Server Logs',
      type: 'logs',
      content: `
\`\`\`
[INF] 11:02:15 Consumer "payment-notifier" on stream "PAYMENTS" connected
[INF] 11:02:15 Consumer "payment-notifier" deliver policy: all
[INF] 11:02:15 Consumer "payment-notifier" starting delivery from sequence 1
[INF] 11:02:15 Delivering 847,293 messages to consumer "payment-notifier"
[INF] 11:02:16 Consumer "payment-notifier" delivered 10,000 messages
[INF] 11:02:17 Consumer "payment-notifier" delivered 20,000 messages
...
[WRN] 11:02:45 Consumer "payment-notifier" ack pending reaching limit
\`\`\`
      `,
      hint: 'The consumer starts from sequence 1, not where it left off'
    },
    {
      id: 4,
      title: 'JetStream Delivery Policies Documentation',
      type: 'config',
      content: `
\`\`\`
## NATS JetStream Deliver Policies

DeliverPolicy.All
  - Deliver ALL messages in the stream from the beginning
  - Used when consumer needs complete history
  - WARNING: On reconnect without durable state, replays everything

DeliverPolicy.Last
  - Deliver only the last message in the stream
  - Useful for state/snapshot consumers

DeliverPolicy.New
  - Deliver only NEW messages (after subscription)
  - Misses messages during downtime

DeliverPolicy.ByStartSequence
  - Start from a specific sequence number
  - Requires tracking last processed sequence

DeliverPolicy.ByStartTime
  - Start from a specific timestamp
  - Useful for time-based replay

For exactly-once processing:
- Use durable consumers with proper state persistence
- Or use DeliverPolicy.New with separate backfill logic
\`\`\`
      `,
      hint: 'The deliver policy determines where consumption starts'
    },
    {
      id: 5,
      title: 'Kubernetes Deployment',
      type: 'config',
      content: `
\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-notifier
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: notifier
        image: payment-notifier:v1.2.3
        env:
        - name: NATS_URL
          value: "nats://nats:4222"
        # No persistent volume for consumer state
        # Consumer recreated fresh on each restart
\`\`\`
      `,
      hint: 'What happens to consumer state when the pod restarts?'
    },
    {
      id: 6,
      title: 'DevOps Engineer Testimony',
      type: 'testimony',
      content: `
> "We've restarted this service dozens of times without issues. I don't
> understand why this time was different."
>
> "Actually, wait - we did upgrade the NATS client library last week.
> The old version was 1.x and we moved to 2.x. But it's just a library
> upgrade, shouldn't affect behavior..."
>
> "The durable consumer name is the same, so state should persist on
> the server, right?"
>
> "Looking at our staging environment, we only had 100 messages in the
> stream so we never noticed the replay issue there."
>
> — Alex, DevOps Engineer
      `,
      hint: 'Client library versions can change default subscription behavior'
    }
  ],

  solution: {
    diagnosis: 'Consumer using DeliverPolicy.All replays entire stream on restart when client recreates subscription',

    keywords: [
      'jetstream', 'deliver policy', 'replay', 'duplicate', 'durable consumer',
      'DeliverPolicy.All', 'consumer state', 'sequence', 'exactly-once',
      'idempotent', 'acknowledgment'
    ],

    rootCause: `
      The consumer was configured with DeliverPolicy.All, which means "deliver all messages
      from the beginning of the stream." While the consumer was durable (named), the way
      the subscription was created caused the consumer to be recreated on each restart.

      In NATS JetStream:
      1. A durable consumer persists state on the server (last acked sequence)
      2. But if you call subscribe() with a config that differs from existing consumer,
         or if the client library binds differently, it may recreate the consumer
      3. The library upgrade changed how subscribe() bound to existing durables
      4. On restart, a new consumer was created with DeliverPolicy.All
      5. All 847,293 historical messages were delivered again
      6. The email service sent all of them, causing massive duplicates

      The fix requires either:
      - Using DeliverPolicy.New or DeliverPolicy.LastPerSubject
      - Or binding to existing durable consumer instead of recreating
      - Or implementing idempotency in the email service
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Properly binding to existing durable consumer',
        code: `const nats = require('nats');
const { AckPolicy, DeliverPolicy, consumerOpts } = require('nats');

async function startConsumer() {
  const nc = await nats.connect({ servers: 'nats://nats:4222' });
  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  // First, ensure the durable consumer exists with correct config
  const consumerName = 'payment-notifier';
  const streamName = 'PAYMENTS';

  try {
    // Try to get existing consumer
    await jsm.consumers.info(streamName, consumerName);
    console.log('Binding to existing durable consumer');
  } catch (e) {
    // Create consumer only if it doesn't exist
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,  // Only new messages!
      max_deliver: 3,
      ack_wait: 30 * 1e9, // 30 seconds in nanoseconds
    });
    console.log('Created new durable consumer');
  }

  // Bind to existing consumer (don't recreate)
  const opts = consumerOpts();
  opts.bind(streamName, consumerName);

  const sub = await js.subscribe('payments.completed', opts);

  for await (const msg of sub) {
    await sendPaymentEmail(msg.data);
    msg.ack();
  }
}`
      },
      {
        lang: 'javascript',
        description: 'Idempotent message processing with deduplication',
        code: `const Redis = require('ioredis');
const redis = new Redis();

async function processPaymentNotification(msg) {
  const paymentId = JSON.parse(msg.data).paymentId;
  const messageId = msg.headers?.get('Nats-Msg-Id') || paymentId;

  // Check if already processed (idempotency key)
  const processed = await redis.get(\`notified:\${messageId}\`);

  if (processed) {
    console.log(\`Skipping duplicate: \${messageId}\`);
    msg.ack();
    return;
  }

  // Process the message
  await sendPaymentEmail(msg.data);

  // Mark as processed with TTL (e.g., 7 days)
  await redis.setex(\`notified:\${messageId}\`, 7 * 24 * 60 * 60, '1');

  msg.ack();
}`
      },
      {
        lang: 'javascript',
        description: 'Using pull-based consumer for more control',
        code: `async function startPullConsumer() {
  const nc = await nats.connect({ servers: 'nats://nats:4222' });
  const js = nc.jetstream();

  // Pull consumer gives explicit control over message fetching
  const psub = await js.pullSubscribe('payments.completed', {
    config: {
      durable_name: 'payment-notifier-pull',
      ack_policy: AckPolicy.Explicit,
      // No deliver_policy needed - pull consumers fetch explicitly
    }
  });

  // Fetch messages in controlled batches
  while (true) {
    const messages = await psub.fetch({ max_messages: 100, expires: 5000 });

    for await (const msg of messages) {
      try {
        await processWithIdempotency(msg);
        msg.ack();
      } catch (e) {
        msg.nak(); // Negative ack - will be redelivered
      }
    }
  }
}`
      }
    ],

    prevention: [
      'Always use DeliverPolicy.New or LastPerSubject for notification-style consumers',
      'Implement idempotency in message handlers using unique message IDs',
      'Bind to existing durable consumers instead of recreating on each start',
      'Test consumer restart behavior with production-like message volumes',
      'Store idempotency keys in Redis/database with appropriate TTL',
      'Use pull-based consumers for critical workflows needing explicit control',
      'Monitor "redelivered" metric - sudden spikes indicate replay issues',
      'Add message deduplication headers (Nats-Msg-Id) at publish time'
    ],

    educationalInsights: [
      'JetStream durable consumers persist state on server, but subscription binding matters',
      'DeliverPolicy.All is rarely what you want for event-driven consumers',
      'Exactly-once delivery is impossible - design for at-least-once with idempotency',
      'Client library upgrades can change default subscription behavior silently',
      'Pull consumers provide more control than push consumers for critical workflows',
      'Stream retention and consumer position are independent concepts'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const rabbitmqMemoryAlarm: DetectiveCase = {
  id: 'rabbitmq-memory-alarm',
  title: 'The RabbitMQ Memory Alarm',
  subtitle: 'Producers suddenly blocked without any code changes',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your e-commerce platform uses RabbitMQ for order processing and inventory updates.
      Suddenly, all producer applications are hanging when trying to publish messages.
      No errors are thrown - the publish calls just block indefinitely. Nothing was
      deployed in the last 24 hours.
    `,
    impact: `
      New orders cannot be placed. Inventory updates are stuck. The checkout flow
      is completely blocked. Revenue loss of $50K per hour during peak shopping.
    `,
    timeline: [
      { time: '2:00 PM', event: 'Normal operations, 5K messages/minute throughput', type: 'normal' },
      { time: '2:15 PM', event: 'Large batch import job started (inventory sync)', type: 'normal' },
      { time: '2:30 PM', event: 'Message publishing latency starts increasing', type: 'warning' },
      { time: '2:45 PM', event: 'First producer timeouts reported', type: 'warning' },
      { time: '3:00 PM', event: 'All producers completely blocked', type: 'critical' },
      { time: '3:05 PM', event: 'Customer checkout failures spike to 100%', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'RabbitMQ management UI is accessible',
      'Existing messages in queues can be consumed',
      'Consumer applications are processing normally',
      'Network connectivity to RabbitMQ is fine',
      'No authentication or permission errors'
    ],
    broken: [
      'All publish operations hang indefinitely',
      'New connections can be established but publishing blocks',
      'Producer application threads are stuck',
      'No error messages or exceptions in producer logs',
      'Message rate dropped to zero'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'RabbitMQ Management Overview',
      type: 'metrics',
      content: `
## RabbitMQ Node Status

| Metric | Value | Threshold |
|--------|-------|-----------|
| Memory Used | 3.2 GB | 3.2 GB (limit) |
| Memory Alarm | **TRIGGERED** | - |
| Disk Free | 50 GB | 1 GB (limit) |
| File Descriptors | 1,024 | 65,536 |
| Socket Descriptors | 512 | 30,000 |

**Node Status:** Running (with memory alarm)
**Connections:** 156 (all showing "blocking" state)
      `,
      hint: 'What happens when memory usage hits the limit?'
    },
    {
      id: 2,
      title: 'RabbitMQ Server Logs',
      type: 'logs',
      content: `
\`\`\`
2024-01-15 14:28:42.123 [warning] <0.456.0> Memory high watermark set to 3200 MB
2024-01-15 14:29:15.456 [warning] <0.456.0> vm_memory_high_watermark_paging_ratio set to 0.5
2024-01-15 14:45:02.789 [warning] <0.789.0> memory resource limit alarm set on node rabbit@prod-rmq-01
2024-01-15 14:45:02.791 [info] <0.789.0> Publishers will be blocked until memory alarm clears
2024-01-15 14:45:03.001 [warning] <0.234.0> connection <0.12345.0> from 10.0.1.50 blocked
2024-01-15 14:45:03.002 [warning] <0.234.0> connection <0.12346.0> from 10.0.1.51 blocked
2024-01-15 14:45:03.003 [warning] <0.234.0> connection <0.12347.0> from 10.0.1.52 blocked
... (153 more blocked connections)
\`\`\`
      `,
      hint: 'The logs explicitly mention what happens to publishers'
    },
    {
      id: 3,
      title: 'Queue Statistics',
      type: 'metrics',
      content: `
## Queue Details

| Queue | Messages | Memory | Consumers |
|-------|----------|--------|-----------|
| orders.pending | 2,847,293 | 1.8 GB | 5 |
| inventory.updates | 156,234 | 450 MB | 3 |
| notifications.email | 89,012 | 180 MB | 2 |
| analytics.events | 523,891 | 650 MB | 1 |

**Total Messages:** 3,616,430
**Total Queue Memory:** 3.08 GB

Note: orders.pending queue has been growing for 45 minutes
      `,
      hint: 'Look at the message counts and which queue is hoarding memory'
    },
    {
      id: 4,
      title: 'Consumer Application Logs',
      type: 'logs',
      content: `
\`\`\`
[OrderProcessor] 14:15:32 Processing order #98234 - calling external payment API
[OrderProcessor] 14:15:47 Order #98234 payment completed (15s)
[OrderProcessor] 14:15:47 Processing order #98235 - calling external payment API
[OrderProcessor] 14:16:05 Order #98235 payment completed (18s)
[OrderProcessor] 14:16:05 Processing order #98236 - calling external payment API
[OrderProcessor] 14:16:23 Order #98236 payment timeout, retrying...
[OrderProcessor] 14:16:38 Order #98236 payment completed (33s)
...
[OrderProcessor] Average processing time: 18.5 seconds per order
[OrderProcessor] Consumer prefetch: 250 messages
\`\`\`
      `,
      hint: 'How fast are messages being consumed vs produced?'
    },
    {
      id: 5,
      title: 'RabbitMQ Configuration',
      type: 'config',
      content: `
\`\`\`erlang
%% rabbitmq.conf

## Memory threshold (percentage of RAM)
vm_memory_high_watermark.relative = 0.4

## Paging threshold
vm_memory_high_watermark_paging_ratio = 0.5

## Server RAM: 8 GB
## Calculated memory limit: 8 GB * 0.4 = 3.2 GB

## Flow control behavior
## When memory alarm triggers:
## - All publishers are BLOCKED (cannot send)
## - Consumers continue processing
## - New connections allowed but publishers blocked immediately
\`\`\`
      `,
      hint: 'This is the default RabbitMQ behavior for memory protection'
    },
    {
      id: 6,
      title: 'Operations Team Testimony',
      type: 'testimony',
      content: `
> "We started a large inventory sync job at 2:15 PM that publishes about 500K
> messages. This runs weekly without issues."
>
> "The payment gateway has been slow today - they had an incident earlier.
> Our order processors are taking longer than usual to complete each order."
>
> "We didn't change any RabbitMQ settings. The server has 8 GB RAM and we've
> never hit memory limits before."
>
> "I tried restarting the producer apps but they just block again immediately."
>
> — Marcus, Operations Lead
      `,
      hint: 'What happens when consumption slows down but production stays the same?'
    }
  ],

  solution: {
    diagnosis: 'RabbitMQ memory high watermark triggered, blocking all publishers as a protective mechanism',

    keywords: [
      'memory alarm', 'high watermark', 'blocked', 'publisher', 'flow control',
      'vm_memory_high_watermark', 'backpressure', 'memory limit', 'queue depth',
      'consumer lag', 'prefetch'
    ],

    rootCause: `
      RabbitMQ has built-in memory protection called "memory alarms." When memory usage
      exceeds the configured high watermark (40% of RAM = 3.2 GB in this case), RabbitMQ
      blocks ALL publishers to prevent the broker from running out of memory and crashing.

      The cascade of events:
      1. Payment gateway slowdown caused order processing to take 18+ seconds per order
      2. Consumers couldn't keep up with the incoming message rate
      3. The weekly inventory sync job added 500K more messages to the queue
      4. Messages accumulated in queues, consuming RAM
      5. Memory hit 3.2 GB threshold, triggering the alarm
      6. All publishers blocked - they don't error, they just hang waiting

      This is actually RabbitMQ protecting itself from crashing, but producers aren't
      handling this gracefully - they just block forever instead of timing out.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Publisher with connection blocking detection',
        code: `const amqp = require('amqplib');

async function createResilientPublisher() {
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  // Monitor for connection blocking
  conn.on('blocked', (reason) => {
    console.error('Connection blocked:', reason);
    // Implement backoff or circuit breaker
    isBlocked = true;
  });

  conn.on('unblocked', () => {
    console.log('Connection unblocked');
    isBlocked = false;
  });

  // Publish with timeout
  async function publishWithTimeout(queue, message, timeoutMs = 5000) {
    if (isBlocked) {
      throw new Error('Publisher blocked - RabbitMQ memory alarm');
    }

    return Promise.race([
      channel.sendToQueue(queue, Buffer.from(message)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Publish timeout')), timeoutMs)
      )
    ]);
  }

  return { channel, publishWithTimeout };
}`
      },
      {
        lang: 'bash',
        description: 'Immediate remediation steps',
        code: `# 1. Check memory alarm status
rabbitmqctl status | grep -A5 "memory"

# 2. Identify largest queues
rabbitmqctl list_queues name messages memory --sort memory

# 3. Purge non-critical queues if acceptable
rabbitmqctl purge_queue analytics.events

# 4. Or increase memory limit temporarily
rabbitmqctl set_vm_memory_high_watermark 0.6

# 5. Monitor memory after changes
watch -n1 'rabbitmqctl status | grep memory'`
      },
      {
        lang: 'erlang',
        description: 'Improved RabbitMQ configuration',
        code: `%% rabbitmq.conf

## Increase memory limit if server can handle it
vm_memory_high_watermark.relative = 0.6

## Enable lazy queues by default (store messages on disk)
queue_master_locator = min-masters

## Set default queue type to quorum for durability
## Or use lazy queues to reduce memory pressure

%% Policy for lazy queues (messages stored on disk)
%% rabbitmqctl set_policy lazy-queues "^orders\\." '{"queue-mode":"lazy"}' --apply-to queues`
      },
      {
        lang: 'javascript',
        description: 'Consumer with proper prefetch settings',
        code: `const amqp = require('amqplib');

async function createOptimizedConsumer() {
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  // CRITICAL: Set prefetch to match processing capacity
  // If processing takes 18s and you want 3 concurrent: prefetch = 3
  // NOT 250 which causes messages to pile up in memory
  await channel.prefetch(3);

  channel.consume('orders.pending', async (msg) => {
    try {
      await processOrder(msg.content);
      channel.ack(msg);
    } catch (err) {
      // Requeue with delay to prevent infinite loops
      channel.nack(msg, false, false);
      await publishToDeadLetter(msg);
    }
  });
}`
      }
    ],

    prevention: [
      'Set publisher timeouts - never block indefinitely on publish',
      'Handle "blocked" connection events and implement circuit breakers',
      'Right-size consumer prefetch based on actual processing time',
      'Use lazy queues for high-volume queues to reduce memory pressure',
      'Monitor queue depth and memory usage with alerts before hitting limits',
      'Implement backpressure in your application layer',
      'Consider RabbitMQ clustering for higher memory capacity',
      'Set up alerts at 70% of memory watermark, not just at 100%'
    ],

    educationalInsights: [
      'RabbitMQ memory alarms are a safety feature, not a bug',
      'Blocked publishers dont error - they silently wait, which can cascade',
      'Prefetch count directly impacts memory usage on both broker and consumer',
      'Lazy queues store messages on disk, trading latency for memory efficiency',
      'Flow control in RabbitMQ is all-or-nothing - one slow queue blocks everything',
      'Consumer processing time must be factored into capacity planning'
    ]
  }
};

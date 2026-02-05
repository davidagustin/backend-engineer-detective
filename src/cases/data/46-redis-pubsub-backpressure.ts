import { DetectiveCase } from '../../types';

export const redisPubsubBackpressure: DetectiveCase = {
  id: 'redis-pubsub-backpressure',
  title: 'The Redis Pub/Sub Backpressure',
  subtitle: 'Slow subscriber causing publisher to mysteriously block',
  difficulty: 'junior',
  category: 'caching',

  crisis: {
    description: `
      Your real-time chat application uses Redis Pub/Sub for message delivery.
      Users are reporting that sending messages has become extremely slow - messages
      take 10-30 seconds to appear instead of being instant. The Redis server CPU
      is spiking and the application is becoming unresponsive.
    `,
    impact: `
      Chat messages delayed by 10-30 seconds. User experience degraded severely.
      Users leaving the platform for competitors. 40% drop in user engagement.
    `,
    timeline: [
      { time: '3:00 PM', event: 'Normal chat operations, <100ms latency', type: 'normal' },
      { time: '3:15 PM', event: 'New analytics subscriber deployed', type: 'normal' },
      { time: '3:30 PM', event: 'Message latency starts increasing', type: 'warning' },
      { time: '3:45 PM', event: 'Latency reaches 5 seconds', type: 'warning' },
      { time: '4:00 PM', event: 'Latency reaches 30 seconds, users complaining', type: 'critical' },
      { time: '4:15 PM', event: 'Redis memory usage spiking', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Redis server is reachable',
      'GET/SET operations are fast',
      'Other Redis operations working normally',
      'Publisher code shows no errors',
      'Most chat subscribers receiving messages'
    ],
    broken: [
      'PUBLISH commands taking 10-30 seconds',
      'One subscriber showing massive output buffer',
      'Redis memory usage growing rapidly',
      'New messages queuing up on publisher side',
      'Redis SLOWLOG shows PUBLISH commands'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Redis CLIENT LIST Output',
      type: 'logs',
      content: `
\`\`\`
$ redis-cli CLIENT LIST

id=1234 addr=10.0.1.50:45678 fd=8 name=chat-api age=3600 idle=0
  flags=N db=0 sub=0 psub=0 multi=-1 qbuf=0 obl=0 oll=0 omem=0

id=1235 addr=10.0.1.51:45679 fd=9 name=chat-subscriber-1 age=3500 idle=0
  flags=S db=0 sub=50 psub=0 multi=-1 qbuf=0 obl=0 oll=12 omem=98304

id=1236 addr=10.0.1.52:45680 fd=10 name=chat-subscriber-2 age=3400 idle=0
  flags=S db=0 sub=50 psub=0 multi=-1 qbuf=0 obl=0 oll=8 omem=65536

id=1237 addr=10.0.1.53:45681 fd=11 name=analytics-subscriber age=2700 idle=0
  flags=S db=0 sub=50 psub=0 multi=-1 qbuf=0 obl=16384 oll=847293 omem=524288000

\`\`\`

Key fields:
- oll = output list length (pending messages)
- omem = output buffer memory usage
- flags=S means subscriber
      `,
      hint: 'Look at the output list length and memory for each subscriber'
    },
    {
      id: 2,
      title: 'Redis Configuration',
      type: 'config',
      content: `
\`\`\`
# redis.conf

# Client output buffer limits
# Format: client-output-buffer-limit <class> <hard> <soft> <seconds>

client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# If output buffer exceeds hard limit, client disconnected immediately
# If output buffer exceeds soft limit for <seconds>, client disconnected

# Memory settings
maxmemory 4gb
maxmemory-policy noeviction
\`\`\`
      `,
      hint: 'What happens when a subscriber output buffer grows?'
    },
    {
      id: 3,
      title: 'Analytics Subscriber Code',
      type: 'code',
      content: `
\`\`\`javascript
// analytics-subscriber.js - Deployed at 3:15 PM

const redis = require('redis');
const client = redis.createClient();

// Subscribe to all chat channels for analytics
client.psubscribe('chat:*');

client.on('pmessage', async (pattern, channel, message) => {
  // Store message in analytics database
  await analyticsDB.insert({
    channel,
    message: JSON.parse(message),
    timestamp: new Date()
  });

  // Run real-time metrics calculation
  await calculateMetrics(channel);

  // Update dashboard
  await updateDashboard();
});

// This handler processes messages one at a time
// Each message takes ~500ms to process
// Chat generates ~1000 messages/second during peak
\`\`\`
      `,
      hint: 'Compare processing time per message with incoming message rate'
    },
    {
      id: 4,
      title: 'Redis Memory Stats',
      type: 'metrics',
      content: `
## Redis INFO Memory (during incident)

| Metric | Value |
|--------|-------|
| used_memory | 2.8 GB |
| used_memory_peak | 3.2 GB |
| client_output_buffer_memory | **512 MB** |
| mem_fragmentation_ratio | 1.05 |

## Memory breakdown by client

| Client | Output Buffer |
|--------|--------------|
| chat-subscriber-1 | 96 KB |
| chat-subscriber-2 | 64 KB |
| analytics-subscriber | **500 MB** |
| Other clients | 12 KB |

Note: analytics-subscriber using 500MB of buffer memory
      `,
      hint: 'One subscriber is consuming most of the buffer memory'
    },
    {
      id: 5,
      title: 'PUBLISH Command Behavior',
      type: 'config',
      content: `
\`\`\`
# Redis PUBLISH behavior

When you PUBLISH a message:
1. Redis iterates through ALL subscribers of that channel
2. For each subscriber, Redis adds message to their output buffer
3. If a subscriber's buffer is full, Redis blocks until space available
4. PUBLISH only returns after ALL subscribers have received the message

This means:
- One slow subscriber blocks PUBLISH for all other subscribers
- PUBLISH is synchronous per subscriber
- No built-in backpressure mechanism
- Output buffer can grow unbounded until limit hit

The slowest subscriber determines your PUBLISH performance.
\`\`\`
      `,
      hint: 'PUBLISH waits for ALL subscribers to receive the message'
    },
    {
      id: 6,
      title: 'Backend Developer Testimony',
      type: 'testimony',
      content: `
> "I deployed the analytics subscriber to capture all chat messages for
> our new dashboard. It seemed like a simple addition."
>
> "The subscriber works fine in our test environment, but we only have
> like 10 messages per minute there, not 1000 per second."
>
> "I didn't realize Redis Pub/Sub would block publishers. I thought
> messages were just fire-and-forget."
>
> "Looking at the code now, I see each message takes 500ms to process.
> That's 2 messages/second capacity, but we receive 1000/second..."
>
> — Jamie, Backend Developer
      `,
      hint: 'The subscriber cannot keep up with the message rate'
    }
  ],

  solution: {
    diagnosis: 'Slow analytics subscriber causing output buffer to fill, blocking all PUBLISH commands',

    keywords: [
      'pub/sub', 'backpressure', 'output buffer', 'slow subscriber', 'blocking',
      'client-output-buffer-limit', 'oll', 'omem', 'pubsub', 'redis publish'
    ],

    rootCause: `
      Redis Pub/Sub has a critical design characteristic: PUBLISH is synchronous and
      must deliver to ALL subscribers before returning. When a subscriber cannot keep
      up with the message rate, messages queue in its output buffer.

      The cascade of events:
      1. Analytics subscriber deployed, processing at 2 msg/sec (500ms each)
      2. Chat generates 1000 msg/sec during peak
      3. Messages queue in analytics subscriber's output buffer
      4. Buffer grows: 998 msg/sec accumulation rate
      5. Buffer reaches 500MB+, approaching the 32MB soft limit
      6. Redis starts blocking PUBLISH commands to apply backpressure
      7. All publishers (chat servers) slow down, affecting all users

      Redis Pub/Sub is designed for fast, real-time delivery where all subscribers
      can keep up. It's not suitable for slow consumers that need to batch or
      process asynchronously.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Fixed analytics subscriber using Redis Streams instead',
        code: `const redis = require('redis');

// Use Redis Streams instead of Pub/Sub for analytics
// Streams support consumer groups and don't block publishers

const client = redis.createClient();

async function consumeAnalytics() {
  // Create consumer group if not exists
  try {
    await client.xGroupCreate('chat-stream', 'analytics-group', '0', { MKSTREAM: true });
  } catch (e) {
    // Group already exists
  }

  while (true) {
    // Read messages at our own pace
    const messages = await client.xReadGroup(
      'analytics-group',
      'analytics-consumer-1',
      { key: 'chat-stream', id: '>' },
      { COUNT: 100, BLOCK: 5000 }
    );

    if (messages) {
      for (const [stream, entries] of messages) {
        for (const [id, fields] of entries) {
          await processAnalytics(fields);
          await client.xAck('chat-stream', 'analytics-group', id);
        }
      }
    }
  }
}`
      },
      {
        lang: 'javascript',
        description: 'If Pub/Sub required: async processing with local buffer',
        code: `const redis = require('redis');
const { Queue } = require('bullmq');

const client = redis.createClient();
const analyticsQueue = new Queue('analytics');

// Fast subscriber that just queues messages
client.psubscribe('chat:*');

client.on('pmessage', async (pattern, channel, message) => {
  // Don't process here - just queue for async processing
  // This is fast: ~1ms per message
  await analyticsQueue.add('process', {
    channel,
    message,
    timestamp: Date.now()
  });
});

// Separate worker processes at its own pace
// worker.js
const { Worker } = require('bullmq');

new Worker('analytics', async (job) => {
  await analyticsDB.insert(job.data);
  await calculateMetrics(job.data.channel);
}, {
  concurrency: 10  // Process 10 messages in parallel
});`
      },
      {
        lang: 'bash',
        description: 'Monitoring and emergency remediation',
        code: `# Monitor subscriber output buffers
watch -n1 'redis-cli CLIENT LIST | grep -E "(oll|omem)"'

# Identify slow subscribers
redis-cli CLIENT LIST | awk -F'[ =]' '{for(i=1;i<=NF;i++) if($i=="oll") print $(i+1), $0}' | sort -rn | head

# Emergency: disconnect the slow subscriber
redis-cli CLIENT KILL ADDR 10.0.1.53:45681

# Set stricter output buffer limits to auto-disconnect slow subscribers
redis-cli CONFIG SET client-output-buffer-limit "pubsub 32mb 8mb 10"

# This disconnects pubsub clients if:
# - Buffer exceeds 32mb (hard limit) immediately
# - Buffer exceeds 8mb for more than 10 seconds (soft limit)`
      }
    ],

    prevention: [
      'Never do slow processing in Pub/Sub message handlers',
      'Use Redis Streams for consumers that need async/batch processing',
      'Set appropriate client-output-buffer-limit for pubsub connections',
      'Monitor subscriber output buffer sizes (oll, omem metrics)',
      'Load test subscribers with production message rates before deploying',
      'Use message queues (BullMQ, RabbitMQ) for slow consumers',
      'Add circuit breakers to disconnect slow subscribers automatically',
      'Consider Redis Streams consumer groups for at-least-once delivery'
    ],

    educationalInsights: [
      'Redis Pub/Sub is fire-and-forget by design but still has backpressure',
      'PUBLISH blocks when any subscriber output buffer is full',
      'One slow subscriber can bring down the entire Pub/Sub system',
      'Redis Streams are the modern alternative for persistent, async messaging',
      'Output buffer limits protect Redis but disconnect clients abruptly',
      'Pub/Sub subscribers must process faster than the publish rate'
    ]
  }
};

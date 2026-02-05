import { DetectiveCase } from '../../types';

export const kafkaRebalanceStorm: DetectiveCase = {
  id: 'kafka-rebalance-storm',
  title: 'The Kafka Rebalance Storm',
  subtitle: 'Consumer group constantly rebalancing, throughput near zero',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your real-time analytics pipeline processes clickstream data from Kafka. The consumer
      group has been running fine for months, but after a recent traffic increase, the
      consumers are stuck in an endless rebalancing loop. Every few minutes, all consumers
      stop processing, rebalance, process a few messages, then rebalance again.
    `,
    impact: `
      Analytics dashboards are hours behind. Real-time personalization is broken.
      A/B test results are invalid. Marketing team cannot see campaign performance.
      $200K in wasted ad spend due to inability to optimize campaigns in real-time.
    `,
    timeline: [
      { time: '9:00 AM', event: 'Marketing campaign launched, traffic 3x normal', type: 'normal' },
      { time: '9:15 AM', event: 'Consumer lag starts increasing', type: 'warning' },
      { time: '9:30 AM', event: 'First rebalance observed', type: 'warning' },
      { time: '9:35 AM', event: 'Second rebalance (5 min after first)', type: 'warning' },
      { time: '9:40 AM', event: 'Third rebalance - pattern emerging', type: 'critical' },
      { time: '10:00 AM', event: 'Rebalancing every 3-5 minutes continuously', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Kafka brokers are healthy (CPU, memory, disk OK)',
      'Producers are publishing successfully',
      'Network connectivity is stable',
      'Consumer pods are not crashing or restarting',
      'No errors in consumer application logs'
    ],
    broken: [
      'Consumer group rebalances every 3-5 minutes',
      'Effective throughput near zero despite active consumers',
      'Consumer lag growing continuously',
      'Partition assignments constantly changing',
      'All consumers marked as "rebalancing" in monitoring'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Consumer Group State',
      type: 'metrics',
      content: `
## Consumer Group: clickstream-analytics

| Time | State | Rebalance Reason | Duration |
|------|-------|------------------|----------|
| 9:30:00 | Rebalancing | MemberLeft | 45s |
| 9:35:12 | Rebalancing | MemberLeft | 52s |
| 9:40:45 | Rebalancing | MemberLeft | 48s |
| 9:46:02 | Rebalancing | MemberLeft | 55s |
| 9:51:33 | Rebalancing | MemberLeft | 51s |

**Pattern:** "MemberLeft" triggered rebalances
**Consumers:** 8 pods, all showing healthy
      `,
      hint: 'Why would a member "leave" if the pod is still healthy?'
    },
    {
      id: 2,
      title: 'Kafka Consumer Configuration',
      type: 'config',
      content: `
\`\`\`javascript
const consumer = kafka.consumer({
  groupId: 'clickstream-analytics',
  sessionTimeout: 10000,           // 10 seconds
  heartbeatInterval: 3000,         // 3 seconds
  maxPollInterval: 300000,         // 5 minutes (default)
  rebalanceTimeout: 60000,         // 1 minute
});

await consumer.subscribe({ topic: 'clickstream', fromBeginning: false });

await consumer.run({
  eachMessage: async ({ message }) => {
    // Process each click event
    await enrichClickData(message);
    await writeToAnalyticsDB(message);
    await updateRealTimeCounters(message);
  }
});
\`\`\`
      `,
      hint: 'Compare session timeout with actual processing behavior'
    },
    {
      id: 3,
      title: 'Consumer Processing Metrics',
      type: 'metrics',
      content: `
## Message Processing Stats (per consumer)

| Metric | Before 9AM | After 9AM |
|--------|------------|-----------|
| Messages/batch | 500 | 500 |
| Avg process time/msg | 15ms | 45ms |
| Batch process time | 7.5s | 22.5s |
| Time between polls | 8s | 23s |

**Database Metrics (Analytics DB):**
- Query latency before 9AM: 5ms
- Query latency after 9AM: 35ms (6x slower)
- Connection pool: 80% utilized (was 30%)

**Note:** Traffic tripled but processing time also tripled
      `,
      hint: 'Calculate total time between heartbeats during batch processing'
    },
    {
      id: 4,
      title: 'Kafka Broker Logs',
      type: 'logs',
      content: `
\`\`\`
[2024-01-15 09:35:00] INFO [GroupCoordinator] Member consumer-1-abc
  in group clickstream-analytics has failed to heartbeat within session timeout
[2024-01-15 09:35:00] INFO [GroupCoordinator] Preparing to rebalance group
  clickstream-analytics with reason: MemberLeft
[2024-01-15 09:35:00] INFO [GroupCoordinator] Member consumer-1-abc removed
  from group clickstream-analytics

[2024-01-15 09:35:45] INFO [GroupCoordinator] Member consumer-1-xyz joined
  group clickstream-analytics
[2024-01-15 09:35:47] INFO [GroupCoordinator] Stabilized group
  clickstream-analytics with 8 members

[2024-01-15 09:40:30] INFO [GroupCoordinator] Member consumer-3-def
  in group clickstream-analytics has failed to heartbeat within session timeout
...
\`\`\`
      `,
      hint: 'Members are failing to heartbeat - why?'
    },
    {
      id: 5,
      title: 'Consumer Thread Analysis',
      type: 'code',
      content: `
\`\`\`
Thread dump of consumer-1 during processing:

"kafka-consumer-thread" #15 runnable
  at com.analytics.ClickProcessor.enrichClickData()
  at com.analytics.Consumer.processMessage()
  at org.apache.kafka.clients.consumer.KafkaConsumer.poll()

"kafka-heartbeat-thread" #16 BLOCKED waiting for lock
  at org.apache.kafka.clients.consumer.KafkaConsumer.poll()
  - waiting to lock <0x00000007c0a0b0c0>
  - which is held by "kafka-consumer-thread"

Note: The heartbeat thread is blocked because it shares
the consumer lock with the processing thread. While
processing is happening, heartbeats cannot be sent.
\`\`\`
      `,
      hint: 'Single-threaded consumer model means processing blocks heartbeats'
    },
    {
      id: 6,
      title: 'Engineering Lead Testimony',
      type: 'testimony',
      content: `
> "We've had this consumer running for 6 months without issues. The only
> thing that changed is the traffic volume - it tripled overnight when
> marketing launched their big campaign."
>
> "Our analytics database is shared with other services. When traffic
> spikes, it gets slower. But the consumers should still work, right?"
>
> "I tried increasing session.timeout.ms to 30 seconds but then the
> rebalances just take longer - they still happen."
>
> "The weird thing is, if I manually process one message, it's fast.
> But in batch, everything falls apart."
>
> — David, Engineering Lead
      `,
      hint: 'Individual messages are fast, but what about 500 messages in a batch?'
    }
  ],

  solution: {
    diagnosis: 'Session timeout exceeded due to slow message processing blocking heartbeat thread',

    keywords: [
      'rebalance', 'session timeout', 'heartbeat', 'poll interval', 'max.poll.interval.ms',
      'session.timeout.ms', 'consumer lag', 'blocked', 'MemberLeft', 'coordinator',
      'batch processing', 'consumer group'
    ],

    rootCause: `
      Kafka consumers must send heartbeats to the group coordinator to prove they're alive.
      In the default single-threaded consumer model, heartbeats are sent during the poll() call.

      The death spiral:
      1. Traffic increased 3x, analytics DB slowed down 6x
      2. Processing 500 messages now takes 22.5 seconds (was 7.5s)
      3. Session timeout is 10 seconds
      4. Consumer processes batch, doesn't call poll() for 22+ seconds
      5. Coordinator thinks consumer is dead (no heartbeat for >10s)
      6. Coordinator removes consumer, triggers rebalance
      7. All consumers stop, rejoin group, get new partitions
      8. Start processing again, same problem repeats

      The key insight: max.poll.interval.ms (5 min) controls how long between poll() calls
      is allowed, but session.timeout.ms (10s) controls heartbeat failure detection.
      In older Kafka clients, heartbeats were tied to poll(). In newer clients (0.10.1+),
      a background thread sends heartbeats, but many configurations still cause issues.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Properly configured consumer with safe timeouts',
        code: `const consumer = kafka.consumer({
  groupId: 'clickstream-analytics',

  // Heartbeat settings
  sessionTimeout: 30000,        // 30s - time before considered dead
  heartbeatInterval: 10000,     // 10s - how often to send heartbeat

  // Poll interval - CRITICAL for slow processing
  maxPollInterval: 600000,      // 10 minutes - time allowed between polls

  // Reduce batch size to process faster
  maxPollRecords: 100,          // Was 500 - now 100 messages max per poll

  // Rebalance settings
  rebalanceTimeout: 120000,     // 2 minutes to complete rebalance
});

await consumer.run({
  // Process messages one at a time if needed
  eachMessage: async ({ message }) => {
    await processMessage(message);
  },

  // Or with batch + manual commits for more control
  eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
    for (const message of batch.messages) {
      await processMessage(message);
      resolveOffset(message.offset);

      // CRITICAL: Call heartbeat periodically during long processing
      await heartbeat();
    }
  }
});`
      },
      {
        lang: 'java',
        description: 'Java consumer with pause/resume for slow processing',
        code: `Properties props = new Properties();
props.put("session.timeout.ms", "30000");
props.put("heartbeat.interval.ms", "10000");
props.put("max.poll.interval.ms", "600000");
props.put("max.poll.records", "100");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        // If processing will be slow, pause partitions
        if (isSlowProcessingExpected()) {
            consumer.pause(consumer.assignment());
        }

        try {
            processRecord(record);
        } finally {
            consumer.resume(consumer.assignment());
        }
    }

    consumer.commitSync();
}`
      },
      {
        lang: 'yaml',
        description: 'Kubernetes deployment with proper resource limits',
        code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: clickstream-consumer
spec:
  replicas: 8
  template:
    spec:
      containers:
      - name: consumer
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: KAFKA_SESSION_TIMEOUT_MS
          value: "30000"
        - name: KAFKA_MAX_POLL_INTERVAL_MS
          value: "600000"
        - name: KAFKA_MAX_POLL_RECORDS
          value: "100"
        # Liveness probe should be longer than session timeout
        livenessProbe:
          httpGet:
            path: /health
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 6  # 60 seconds before restart`
      }
    ],

    prevention: [
      'Set max.poll.interval.ms based on worst-case processing time, not average',
      'Reduce max.poll.records if individual message processing is variable',
      'Use separate threads for processing vs polling (but handle carefully)',
      'Call heartbeat() explicitly during long batch processing',
      'Monitor time-between-polls metric and alert before hitting limits',
      'Load test consumers with realistic slow-downstream scenarios',
      'Set session.timeout.ms > heartbeat.interval.ms * 3 minimum',
      'Use cooperative sticky assignor to minimize rebalance impact'
    ],

    educationalInsights: [
      'Kafka rebalances stop ALL consumers in the group, not just the problematic one',
      'max.poll.interval.ms and session.timeout.ms serve different purposes',
      'Heartbeat behavior changed significantly between Kafka client versions',
      'Rebalance storms can cascade - slow consumers cause rebalances that slow processing more',
      'Cooperative rebalancing (KIP-429) reduces stop-the-world rebalance impact',
      'Static group membership can prevent rebalances on restarts but not on timeout'
    ]
  }
};

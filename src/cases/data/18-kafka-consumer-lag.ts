import { DetectiveCase } from '../../types';

export const kafkaConsumerLag: DetectiveCase = {
  id: 'kafka-consumer-lag',
  title: 'The Kafka Consumer Catastrophe',
  subtitle: 'Messages pile up but consumers appear healthy',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your order processing pipeline uses Kafka. Orders are published to a topic
      and consumed by the fulfillment service. Suddenly, consumer lag is growing
      exponentially—millions of messages are backing up. But all consumer instances
      show as healthy with normal CPU and memory usage.
    `,
    impact: `
      Orders are delayed by hours. Customers are receiving "order confirmed" but
      fulfillment is stuck. 50,000+ orders in limbo. Customer support is overwhelmed.
    `,
    timeline: [
      { time: '10:00 AM', event: 'Flash sale begins, order volume 10x normal', type: 'normal' },
      { time: '10:05 AM', event: 'Consumer lag starts increasing', type: 'warning' },
      { time: '10:30 AM', event: 'Lag reaches 100K messages', type: 'warning' },
      { time: '11:00 AM', event: 'Lag reaches 1M messages, alerts firing', type: 'critical' },
      { time: '11:30 AM', event: 'Scaled consumers from 10 to 30 pods', type: 'normal' },
      { time: '11:35 AM', event: 'Lag still increasing despite more consumers', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Producer is publishing successfully (no errors)',
      'Kafka brokers are healthy (CPU, memory, disk OK)',
      'Consumer pods show Running status',
      'Consumer logs show messages being processed',
      'Individual message processing is fast (~50ms)'
    ],
    broken: [
      'Consumer lag growing at ~10K messages/minute',
      'Scaling consumers had no effect',
      'Only 10 consumers are actually processing despite 30 pods',
      'Some consumer pods show 0 messages processed'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Consumer Lag Dashboard',
      type: 'metrics',
      content: `
## Kafka Consumer Lag (orders-fulfillment group)

| Time | Lag | Consumers | Messages/sec |
|------|-----|-----------|--------------|
| 10:00 | 0 | 10 | 500 |
| 10:30 | 100K | 10 | 480 |
| 11:00 | 1M | 10 | 450 |
| 11:30 | 2M | 30 | 450 |
| 12:00 | 3.5M | 30 | 440 |

**Note:** Incoming rate during flash sale: ~800 messages/sec
      `,
      hint: 'Message throughput stayed flat even after scaling...'
    },
    {
      id: 2,
      title: 'Topic Configuration',
      type: 'config',
      content: `
\`\`\`bash
$ kafka-topics.sh --describe --topic orders

Topic: orders
PartitionCount: 10
ReplicationFactor: 3
Configs: retention.ms=604800000

Partition  Leader  Replicas  ISR
0          1       [1,2,3]   [1,2,3]
1          2       [2,3,1]   [2,3,1]
2          3       [3,1,2]   [3,1,2]
3          1       [1,2,3]   [1,2,3]
4          2       [2,3,1]   [2,3,1]
5          3       [3,1,2]   [3,1,2]
6          1       [1,2,3]   [1,2,3]
7          2       [2,3,1]   [2,3,1]
8          3       [3,1,2]   [3,1,2]
9          1       [1,2,3]   [1,2,3]
\`\`\`
      `,
      hint: 'Count the partitions and count the effective consumers...'
    },
    {
      id: 3,
      title: 'Consumer Group Details',
      type: 'logs',
      content: `
\`\`\`bash
$ kafka-consumer-groups.sh --describe --group orders-fulfillment

GROUP              TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER-ID
orders-fulfillment orders  0          1523456         1876543         353087  consumer-1-abc
orders-fulfillment orders  1          1498234         1865432         367198  consumer-2-def
orders-fulfillment orders  2          1534567         1887654         353087  consumer-3-ghi
orders-fulfillment orders  3          1512345         1876543         364198  consumer-4-jkl
orders-fulfillment orders  4          1523456         1865432         341976  consumer-5-mno
orders-fulfillment orders  5          1534567         1887654         353087  consumer-6-pqr
orders-fulfillment orders  6          1498234         1876543         378309  consumer-7-stu
orders-fulfillment orders  7          1512345         1865432         353087  consumer-8-vwx
orders-fulfillment orders  8          1523456         1887654         364198  consumer-9-yza
orders-fulfillment orders  9          1534567         1876543         341976  consumer-10-bcd
\`\`\`
      `,
      hint: 'Only 10 consumer IDs despite 30 pods...'
    },
    {
      id: 4,
      title: 'DevOps Team Testimony',
      type: 'testimony',
      content: `
> "We scaled to 30 pods because each one can handle ~50 messages/sec and we need
> 800/sec throughput. The math checks out: 30 × 50 = 1500 msg/sec capacity."
>
> "I checked the logs on some of the new pods—they're just sitting there idle.
> They joined the consumer group but they're not getting any messages."
>
> — Sarah, DevOps Engineer
      `,
      hint: 'Why would a consumer join the group but receive nothing?'
    },
    {
      id: 5,
      title: 'Kafka Consumer Architecture Doc',
      type: 'config',
      content: `
\`\`\`
# Kafka Consumer Group Fundamentals

A consumer group divides topic partitions among its members:
- Each partition is assigned to exactly ONE consumer in the group
- A consumer can handle multiple partitions
- If consumers > partitions, extra consumers sit idle

Example with 4 partitions and 6 consumers:
- Consumer 1: Partition 0
- Consumer 2: Partition 1
- Consumer 3: Partition 2
- Consumer 4: Partition 3
- Consumer 5: (idle - no partition)
- Consumer 6: (idle - no partition)

To scale consumption, you must increase partitions first.
\`\`\`
      `,
      hint: 'Compare your partition count to your consumer count...'
    },
    {
      id: 6,
      title: 'Order Message Distribution',
      type: 'metrics',
      content: `
## Messages per Partition (last hour)

| Partition | Messages | % of Total |
|-----------|----------|------------|
| 0 | 28,456 | 10.1% |
| 1 | 27,892 | 9.9% |
| 2 | 28,103 | 10.0% |
| 3 | 27,654 | 9.8% |
| 4 | 28,234 | 10.0% |
| 5 | 27,987 | 9.9% |
| 6 | 28,345 | 10.1% |
| 7 | 28,012 | 9.9% |
| 8 | 27,789 | 9.9% |
| 9 | 28,528 | 10.1% |

**Note:** Distribution is even due to round-robin partitioning
      `,
      hint: 'Even distribution means no partition can be processed faster than others'
    }
  ],

  solution: {
    diagnosis: 'Consumer count exceeds partition count; extra consumers are idle',

    keywords: [
      'partition', 'consumer', 'idle', 'kafka', 'consumer group',
      'partition count', 'scaling', 'throughput', 'lag',
      'more consumers than partitions'
    ],

    rootCause: `
      The Kafka topic "orders" has only 10 partitions. In Kafka, each partition can
      only be consumed by ONE consumer within a consumer group at a time.

      When the team scaled from 10 to 30 consumers:
      - 10 consumers got assigned 1 partition each (working)
      - 20 consumers joined the group but got 0 partitions (idle)

      The maximum parallelism is capped at 10 (the partition count), regardless of
      how many consumer pods you run. The extra 20 pods are doing nothing.

      To actually increase throughput, you need to:
      1. Add more partitions to the topic
      2. Then scale consumers to match
    `,

    codeExamples: [
      {
        lang: 'bash',
        description: 'Add partitions to increase parallelism',
        code: `# Increase partitions (cannot decrease later!)
kafka-topics.sh --alter --topic orders --partitions 30

# Verify the change
kafka-topics.sh --describe --topic orders

# Note: New partitions won't receive old data
# Messages are assigned to partitions at produce time`
      },
      {
        lang: 'yaml',
        description: 'Auto-scaling based on partition count',
        code: `# HPA that respects Kafka limits
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: fulfillment-consumer
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: fulfillment-consumer
  minReplicas: 1
  maxReplicas: 30  # Match partition count!
  metrics:
  - type: External
    external:
      metric:
        name: kafka_consumer_lag
        selector:
          matchLabels:
            topic: orders
      target:
        type: AverageValue
        averageValue: 1000`
      },
      {
        lang: 'javascript',
        description: 'Consumer with concurrent partition handling',
        code: `// Using KafkaJS with proper concurrency settings
const { Kafka } = require('kafkajs');

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const consumer = kafka.consumer({
  groupId: 'orders-fulfillment',
  // Process multiple messages concurrently within a partition
  partitionAssigners: [Kafka.PartitionAssigners.roundRobin],
});

await consumer.subscribe({ topic: 'orders', fromBeginning: false });

await consumer.run({
  // Process up to 10 messages concurrently per partition
  partitionsConsumedConcurrently: 10,
  eachMessage: async ({ topic, partition, message }) => {
    await processOrder(message.value);
  },
});`
      }
    ],

    prevention: [
      'Set partition count based on expected maximum throughput needs',
      'Rule of thumb: partitions >= max expected consumers',
      'Monitor "idle consumers" metric (consumers with 0 partitions)',
      'Document partition count in runbooks so operators know scaling limits',
      'Consider partition count during topic creation (hard to change later)',
      'Use consumer lag alerts that account for partition limits'
    ],

    educationalInsights: [
      'Kafka parallelism is fundamentally limited by partition count',
      'Adding consumers beyond partition count provides zero benefit',
      'Partitions can be increased but never decreased (Kafka limitation)',
      'Consumer group rebalancing redistributes partitions when members join/leave',
      'Over-partitioning has costs: more broker memory, longer rebalances, ordering complexity',
      'Message ordering is only guaranteed within a partition, not across partitions'
    ]
  }
};

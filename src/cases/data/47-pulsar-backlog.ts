import { DetectiveCase } from '../../types';

export const pulsarBacklog: DetectiveCase = {
  id: 'pulsar-backlog',
  title: 'The Apache Pulsar Backlog',
  subtitle: 'Topic backlog growing infinitely due to stuck subscription',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your event-driven microservices platform uses Apache Pulsar for messaging.
      The operations team noticed that storage usage on the Pulsar cluster is growing
      at 50GB per day. Investigation reveals one topic's backlog is 2TB and growing,
      even though all active consumers appear to be processing messages normally.
    `,
    impact: `
      Storage costs increasing $500/day. Risk of cluster running out of disk space.
      Broker performance degrading due to large backlog scans. Recovery from
      failure would take hours due to backlog replay.
    `,
    timeline: [
      { time: 'Day 1', event: 'Marketing team creates analytics subscription', type: 'normal' },
      { time: 'Day 3', event: 'Analytics project deprioritized, subscription abandoned', type: 'normal' },
      { time: 'Day 30', event: 'Ops notices storage growing faster than expected', type: 'warning' },
      { time: 'Day 45', event: 'Backlog reaches 500GB', type: 'warning' },
      { time: 'Day 60', event: 'Backlog reaches 2TB, disk alerts firing', type: 'critical' },
      { time: 'Day 61', event: 'Investigation begins', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Active consumers processing messages in real-time',
      'Producer publishing successfully',
      'Message latency for active consumers is low',
      'Pulsar brokers and bookies healthy',
      'No errors in application logs'
    ],
    broken: [
      'Topic storage growing 50GB/day',
      'One subscription showing 2TB backlog',
      'Retention policy not deleting old messages',
      'Broker CPU spikes during backlog queries',
      'pulsar-admin shows one "inactive" subscription'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Topic Subscription Stats',
      type: 'metrics',
      content: `
## Topic: persistent://events/prod/user-actions

### Subscriptions

| Subscription | Type | Backlog | Consumers | Rate In | Rate Out |
|--------------|------|---------|-----------|---------|----------|
| event-processor | Shared | 0 | 10 | 5K/s | 5K/s |
| audit-logger | Failover | 12 | 2 | 5K/s | 5K/s |
| ml-pipeline | Key_Shared | 156 | 8 | 5K/s | 5K/s |
| analytics-export | Exclusive | **847,293,456** | **0** | 5K/s | **0/s** |

### Topic Storage
- Current Size: 2.1 TB
- Messages: 847,293,456
- Retention: 7 days (but messages older than 60 days exist!)
      `,
      hint: 'Why would 60-day-old messages exist with 7-day retention?'
    },
    {
      id: 2,
      title: 'Pulsar Retention Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# broker.conf

# Default retention for topics
defaultRetentionTimeInMinutes=10080  # 7 days
defaultRetentionSizeInMB=-1          # Unlimited by size

# IMPORTANT: Pulsar retention behavior
# Messages are retained if ANY of these conditions are true:
# 1. Message age < retentionTimeInMinutes
# 2. Total size < retentionSizeInMB
# 3. Message has NOT been acknowledged by ALL subscriptions
#
# The third condition means:
# Even if retention is 7 days, messages won't be deleted
# if any subscription hasn't acknowledged them yet.
\`\`\`
      `,
      hint: 'What happens to messages if a subscription never acknowledges them?'
    },
    {
      id: 3,
      title: 'Subscription Creation History',
      type: 'logs',
      content: `
\`\`\`
# pulsar-admin command history from Day 1

$ pulsar-admin topics create-subscription \\
    persistent://events/prod/user-actions \\
    --subscription analytics-export \\
    --subscription-type Exclusive

# Created by: marketing-analytics-service
# Purpose: Export user actions to data warehouse
# Created: 60 days ago

# Git history shows:
# - analytics-export service was deployed Day 1
# - Service was scaled to 0 replicas on Day 3
# - Project marked as "on hold" in Jira
# - No one deleted the subscription
\`\`\`
      `,
      hint: 'The subscription exists but no consumer is connected'
    },
    {
      id: 4,
      title: 'Pulsar Admin Commands',
      type: 'logs',
      content: `
\`\`\`bash
$ pulsar-admin topics stats persistent://events/prod/user-actions

{
  "subscriptions": {
    "analytics-export": {
      "msgBacklog": 847293456,
      "msgBacklogNoDelayed": 847293456,
      "consumers": [],
      "lastAckedTimestamp": 1699900000000,  # 60 days ago!
      "lastConsumedTimestamp": 1699900000000,
      "lastMarkDeleteAdvancedTimestamp": 1699900000000
    }
  },
  "backlogSize": 2251799813685248,
  "storageSize": 2251799813685248
}

$ pulsar-admin topics get-retention persistent://events/prod/user-actions
{
  "retentionTimeInMinutes": 10080,
  "retentionSizeInMB": -1
}
\`\`\`
      `,
      hint: 'lastAckedTimestamp shows when this subscription last acknowledged a message'
    },
    {
      id: 5,
      title: 'Pulsar Backlog Quota Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# namespace policy (current)
backlogQuotaPolicy:
  limitSize: -1           # No limit (dangerous!)
  limitTime: -1           # No limit
  retentionPolicy: none   # Options: producer_request_hold, producer_exception, consumer_backlog_eviction

# Recommended configuration:
backlogQuotaPolicy:
  limitSize: 10737418240  # 10GB
  limitTime: 86400        # 1 day
  retentionPolicy: consumer_backlog_eviction  # Evict oldest unacked messages

# With consumer_backlog_eviction:
# - Old unacked messages are deleted when quota exceeded
# - Subscription cursor jumps forward
# - Data loss for that subscription, but topic doesn't grow unbounded
\`\`\`
      `,
      hint: 'There is no backlog quota to limit the damage from abandoned subscriptions'
    },
    {
      id: 6,
      title: 'Platform Team Testimony',
      type: 'testimony',
      content: `
> "The analytics team created that subscription for a proof-of-concept.
> When the project got deprioritized, they just scaled down the pods.
> I guess they forgot the subscription existed."
>
> "We've had retention set to 7 days forever. I don't understand why
> messages from 60 days ago still exist."
>
> "Our backup scripts just dump all topics. With 2TB of backlog, backups
> are taking 10x longer now."
>
> "I tried to delete the subscription but got an error about 'permission
> denied'. The marketing team doesn't exist anymore..."
>
> — Chen, Platform Engineer
      `,
      hint: 'Abandoned subscription is blocking message deletion'
    }
  ],

  solution: {
    diagnosis: 'Abandoned subscription preventing message deletion due to Pulsar retention semantics',

    keywords: [
      'backlog', 'subscription', 'retention', 'cursor', 'acknowledgment',
      'backlog quota', 'consumer_backlog_eviction', 'abandoned', 'storage',
      'mark delete', 'ledger'
    ],

    rootCause: `
      Apache Pulsar has a fundamental retention rule: messages are retained until ALL
      subscriptions have acknowledged them, regardless of time-based retention settings.

      The sequence of events:
      1. Marketing team created "analytics-export" subscription
      2. Consumer connected, started receiving messages
      3. Project deprioritized, consumer pods scaled to 0
      4. Subscription still exists with cursor at 60-day-old position
      5. Pulsar cannot delete messages older than that cursor
      6. 5K messages/second * 60 days = 847M messages, 2TB storage
      7. Retention policy (7 days) is ignored because subscription hasn't acknowledged

      This is intentional design - Pulsar guarantees at-least-once delivery, which means
      it cannot delete messages that a subscription might still need. But abandoned
      subscriptions become "zombie" subscriptions that block cleanup forever.
    `,

    codeExamples: [
      {
        lang: 'bash',
        description: 'Identify and clean up abandoned subscriptions',
        code: `# List all subscriptions with their backlog and last activity
pulsar-admin topics stats persistent://events/prod/user-actions | \\
  jq '.subscriptions | to_entries[] | {
    name: .key,
    backlog: .value.msgBacklog,
    consumers: (.value.consumers | length),
    lastAcked: .value.lastAckedTimestamp
  }'

# Find subscriptions with no consumers and large backlog
for topic in $(pulsar-admin topics list events/prod); do
  pulsar-admin topics stats $topic | jq -r '
    .subscriptions | to_entries[] |
    select(.value.consumers | length == 0) |
    select(.value.msgBacklog > 1000000) |
    "\(.key): \(.value.msgBacklog) messages"
  '
done

# Delete the abandoned subscription (after confirming it's safe)
pulsar-admin topics unsubscribe \\
  persistent://events/prod/user-actions \\
  --subscription analytics-export

# After deletion, messages can be garbage collected
# based on retention policy`
      },
      {
        lang: 'yaml',
        description: 'Configure backlog quotas to prevent future issues',
        code: `# Set backlog quota at namespace level
# pulsar-admin namespaces set-backlog-quota events/prod \\
#   --limitSize 10737418240 \\
#   --limitTime 86400 \\
#   --policy consumer_backlog_eviction

# Terraform/Pulumi configuration
resource "pulsar_namespace" "events_prod" {
  namespace = "events/prod"

  backlog_quota {
    limit_bytes = 10737418240  # 10GB per topic
    limit_seconds = 86400       # 1 day
    policy = "consumer_backlog_eviction"  # Auto-evict old unacked messages
  }

  retention_policies {
    retention_minutes = 10080   # 7 days
    retention_size_mb = -1      # Unlimited
  }

  # Subscription expiration - auto-delete inactive subscriptions
  subscription_expiration_time_minutes = 10080  # 7 days of inactivity
}`
      },
      {
        lang: 'javascript',
        description: 'Subscription lifecycle management',
        code: `// Service that tracks subscription ownership

class SubscriptionRegistry {
  constructor(pulsarAdmin, database) {
    this.admin = pulsarAdmin;
    this.db = database;
  }

  async createSubscription(topic, subscriptionName, owner, ttlDays) {
    // Register subscription with owner and expiry
    await this.db.subscriptions.insert({
      topic,
      subscriptionName,
      owner,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      status: 'active'
    });

    await this.admin.topics().createSubscription(topic, subscriptionName);
  }

  async cleanupExpiredSubscriptions() {
    const expired = await this.db.subscriptions.find({
      expiresAt: { $lt: new Date() },
      status: 'active'
    });

    for (const sub of expired) {
      // Check if subscription has active consumers
      const stats = await this.admin.topics().getStats(sub.topic);
      const subStats = stats.subscriptions[sub.subscriptionName];

      if (subStats.consumers.length === 0) {
        console.log(\`Deleting expired subscription: \${sub.subscriptionName}\`);
        await this.admin.topics().deleteSubscription(sub.topic, sub.subscriptionName);
        await this.db.subscriptions.update(
          { _id: sub._id },
          { status: 'deleted', deletedAt: new Date() }
        );
      }
    }
  }
}`
      }
    ],

    prevention: [
      'Always set backlog quotas with consumer_backlog_eviction policy',
      'Configure subscription_expiration_time to auto-delete inactive subscriptions',
      'Implement subscription registry that tracks ownership and TTL',
      'Monitor subscriptions with zero consumers and growing backlog',
      'Add alerting for subscriptions inactive for more than 24 hours',
      'Document subscription ownership in a central registry',
      'Use Pulsar Functions or prune job to cleanup orphaned subscriptions',
      'Require approval process for creating durable subscriptions'
    ],

    educationalInsights: [
      'Pulsar retention is the minimum of time-based AND subscription-cursor-based',
      'Subscriptions are cursors - they must advance for messages to be deleted',
      'Backlog quotas are the safety net for abandoned subscriptions',
      'consumer_backlog_eviction causes data loss but prevents storage explosion',
      'Subscription expiration is different from message retention',
      'At-least-once delivery guarantee creates this retention behavior by design'
    ]
  }
};

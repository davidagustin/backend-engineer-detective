import type { DetectiveCase } from "../../types";

export const blackFridayDisaster: DetectiveCase = {
	id: "black-friday-disaster",
	title: "The Black Friday Disaster",
	subtitle: "Flash sale notifications crash the entire platform",
	difficulty: "senior",
	category: "distributed",

	crisis: {
		description:
			"A flash sale announcement was sent to 50 million users. Within seconds, the entire platform became unresponsive. Users can't login, can't browse, can't do anything.",
		impact:
			"Complete platform outage. Estimated revenue loss: $2M per minute. Social media exploding with complaints. CEO is on the phone with engineering.",
		timeline: [
			{ time: "09:00", event: "Flash sale scheduled to start", type: "normal" },
			{ time: "09:00:01", event: "Push notification sent to 50M users", type: "normal" },
			{ time: "09:00:05", event: "API response times spike to 30s", type: "warning" },
			{ time: "09:00:15", event: "First services start failing health checks", type: "critical" },
			{ time: "09:00:30", event: "Complete platform outage", type: "critical" },
			{ time: "09:01:00", event: "All services marked unhealthy, traffic blackholed", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Individual services respond to direct health checks",
			"Database connections are fine",
			"CDN serving static assets normally",
			"Internal admin tools (different network) work",
		],
		broken: [
			"All user-facing APIs timeout",
			"Service-to-service calls failing",
			"Message queue consumers completely frozen",
			"Even simple endpoints like /health timing out through load balancer",
		],
	},

	clues: [
		{
			id: 1,
			title: "Message Queue Metrics",
			type: "metrics",
			content: `\`\`\`
Queue: notification-events
Messages Published: 50,000,000
Messages Consumed: 247,892
Consumer Count: 50
Consumer Rate: 2,340/sec
Messages Pending: 49,752,108

Queue: user-activity
Messages Published: 156,234,892
Messages Consumed: 1,234
Consumer Count: 20
Messages Pending: 156,233,658

Queue: analytics-events
Messages Published: 312,469,784
Messages Consumed: 0
Consumer Count: 10
Messages Pending: 312,469,784
\`\`\``,
			hint: "Look at the relationship between the queues...",
		},
		{
			id: 2,
			title: "Notification Service Code",
			type: "code",
			content: `\`\`\`typescript
class NotificationService {
  async sendFlashSaleNotification(saleId: string): Promise<void> {
    const users = await this.getAllActiveUsers(); // 50M users

    for (const user of users) {
      // Publish notification event
      await this.messageQueue.publish('notification-events', {
        type: 'flash-sale',
        userId: user.id,
        saleId: saleId,
        timestamp: Date.now()
      });
    }
  }
}
\`\`\``,
		},
		{
			id: 3,
			title: "Notification Consumer",
			type: "code",
			content: `\`\`\`typescript
class NotificationConsumer {
  async handleNotificationEvent(event: NotificationEvent): Promise<void> {
    const user = await this.userService.getUser(event.userId);

    // Track that user will receive notification
    await this.messageQueue.publish('user-activity', {
      type: 'notification-sent',
      userId: user.id,
      notificationType: event.type,
      timestamp: Date.now()
    });

    // Send the actual notification
    await this.pushService.send(user.deviceToken, {
      title: 'Flash Sale!',
      body: 'Limited time offer - 50% off!'
    });

    // Track analytics
    await this.messageQueue.publish('analytics-events', {
      type: 'notification-delivered',
      userId: user.id,
      timestamp: Date.now()
    });
  }
}
\`\`\``,
			hint: "What happens when you process one message?",
		},
		{
			id: 4,
			title: "System Architecture",
			type: "config",
			content: `\`\`\`
Architecture Overview:
┌─────────────────┐
│ API Gateway     │ ← All traffic enters here
└────────┬────────┘
         │
    ┌────┴────┐
    │ Shared  │ ← RabbitMQ cluster
    │ Message │   3 nodes, 16GB RAM each
    │ Queue   │   Max connections: 10,000
    └────┬────┘
         │
    ┌────┴────────────┬──────────────────┐
    │                 │                  │
┌───┴───┐      ┌─────┴─────┐     ┌──────┴──────┐
│ API   │      │Notification│    │ Analytics   │
│Service│      │  Service   │    │  Service    │
└───────┘      └───────────┘     └─────────────┘

All services share the same RabbitMQ cluster
API Service also publishes events for every request
\`\`\``,
		},
		{
			id: 5,
			title: "RabbitMQ Cluster Status",
			type: "metrics",
			content: `\`\`\`
Node 1: MEMORY ALARM - 15.8GB/16GB
Node 2: MEMORY ALARM - 15.9GB/16GB
Node 3: MEMORY ALARM - 16GB/16GB

Publisher Status: BLOCKED
  Reason: Memory high watermark exceeded
  Blocked Connections: 8,234

Flow Control: ACTIVE on all nodes
  All publishers paused

Connection Count: 9,876/10,000
  API Service: 3,456 connections
  Notification Service: 2,345 connections
  Analytics Service: 1,234 connections
  Other: 2,841 connections
\`\`\``,
			hint: "What happens to the API service when publishers are blocked?",
		},
		{
			id: 6,
			title: "Senior Engineer Testimony",
			type: "testimony",
			content: `"We've sent big notification batches before, but never to everyone at once. Usually we do cohorts of 1-2 million. I'm looking at the message queue and it's... it's completely overwhelmed. The weird thing is the API servers are technically running, they're just not responding. Their event publishing calls are all hanging."`,
		},
		{
			id: 7,
			title: "API Service Logs",
			type: "logs",
			content: `\`\`\`
[INFO] 09:00:03 Handling GET /api/products/sale
[DEBUG] 09:00:03 Publishing request-received event...
[DEBUG] 09:00:33 Still waiting to publish event...
[DEBUG] 09:01:03 Still waiting to publish event...
[ERROR] 09:01:33 Request timeout - could not publish event
[INFO] 09:01:33 Connection to RabbitMQ blocked (flow control)

[INFO] 09:00:04 Handling GET /api/user/cart
[DEBUG] 09:00:04 Publishing request-received event...
[DEBUG] 09:01:04 Publisher blocked by broker flow control
[ERROR] 09:01:34 Request timeout
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Pub/sub fan-out amplification causing message queue memory exhaustion and flow control blocking all publishers including API services",
		keywords: [
			"fan-out",
			"amplification",
			"message queue",
			"backpressure",
			"flow control",
			"memory exhaustion",
			"pub/sub",
			"cascade",
			"blocking publisher",
			"rabbitmq",
		],
		rootCause: `This is a cascading failure caused by message fan-out amplification:

1. The notification service published 50M messages to 'notification-events'
2. Each notification event, when consumed, published 2 MORE messages (to 'user-activity' and 'analytics-events')
3. 50M events × 3 = 150M+ messages trying to flow through the system
4. RabbitMQ memory filled up, triggering flow control
5. Flow control BLOCKS all publishers, including the API service
6. The API service publishes events for every request (telemetry)
7. API request handlers hung waiting to publish, causing all requests to timeout
8. The entire platform went down because API handlers couldn't publish their routine events

This is the "shared fate" antipattern - critical request paths share infrastructure with non-critical bulk operations.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Separate critical and bulk publishing paths",
				code: `// Use separate message brokers/clusters
class EventPublisher {
  private criticalQueue: MessageQueue;  // Dedicated for API events
  private bulkQueue: MessageQueue;      // For notifications, analytics

  async publishCritical(event: Event): Promise<void> {
    // Timeout quickly, don't block requests
    await this.criticalQueue.publish(event, { timeout: 100 });
  }

  async publishBulk(event: Event): Promise<void> {
    // Can handle backpressure
    await this.bulkQueue.publish(event);
  }
}`,
			},
			{
				lang: "typescript",
				description: "Rate-limited batch notification sending",
				code: `class NotificationService {
  async sendFlashSaleNotification(saleId: string): Promise<void> {
    const BATCH_SIZE = 10000;
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second

    const userStream = this.streamAllActiveUsers();
    let batch: User[] = [];

    for await (const user of userStream) {
      batch.push(user);

      if (batch.length >= BATCH_SIZE) {
        await this.sendBatch(batch, saleId);
        batch = [];
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }

    if (batch.length > 0) {
      await this.sendBatch(batch, saleId);
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Non-blocking event publishing for APIs",
				code: `class APIEventMiddleware {
  async handle(req: Request, next: Handler): Promise<Response> {
    const response = await next(req);

    // Fire and forget - don't await
    this.publishAsync({
      type: 'request-completed',
      path: req.path,
      status: response.status
    }).catch(err => {
      // Log but don't fail the request
      console.warn('Failed to publish event', err);
    });

    return response;
  }

  private async publishAsync(event: Event): Promise<void> {
    // Local buffer with async drain
    this.eventBuffer.push(event);
  }
}`,
			},
		],
		prevention: [
			"Separate infrastructure for critical vs bulk operations",
			"Implement rate limiting for bulk message publishing",
			"Use non-blocking, fire-and-forget for telemetry events in request paths",
			"Set up alerts for queue depth and memory usage",
			"Load test bulk operations in staging before production",
			"Implement circuit breakers on publish operations",
			"Use local buffering with async drain for non-critical events",
		],
		educationalInsights: [
			"Fan-out amplification: 1 event → N events → N*M events can explode exponentially",
			"Shared infrastructure creates 'shared fate' - bulk operations can take down real-time APIs",
			"RabbitMQ flow control is designed to protect the broker, but it blocks ALL publishers",
			"Message queues are not infinite - they have memory, CPU, and connection limits",
			"The request path should never block on non-essential operations",
			"Always separate 'must succeed' from 'nice to have' in your event architecture",
		],
	},
};

import { DetectiveCase } from '../../types';

export const opentelemetryContextLoss: DetectiveCase = {
  id: 'opentelemetry-context-loss',
  title: 'The OpenTelemetry Context Loss',
  subtitle: 'Traces broken across async boundaries',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your distributed traces are fragmented. Parent-child relationships break randomly.
      A single user request shows up as 5-10 disconnected traces instead of one connected
      tree. You can see individual spans but can't follow a request through the system.
      The whole point of distributed tracing - understanding request flow - is broken.
    `,
    impact: `
      Cannot debug distributed issues. Engineers manually correlating spans by timestamp.
      MTTR increased 3x for cross-service issues. Trace-based SLOs unmeasurable.
      Considering abandoning distributed tracing investment.
    `,
    timeline: [
      { time: 'Week 1', event: 'OpenTelemetry deployed to all services', type: 'normal' },
      { time: 'Week 2', event: 'Some traces appear fragmented in Jaeger', type: 'warning' },
      { time: 'Week 4', event: '40% of traces are disconnected orphans', type: 'warning' },
      { time: 'Week 6', event: 'Async job traces completely isolated', type: 'critical' },
      { time: 'Week 8', event: 'Team gives up using traces for debugging', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Spans are created correctly',
      'Data reaches Jaeger/collector',
      'Synchronous calls are traced properly',
      'HTTP context propagation works'
    ],
    broken: [
      'Async operations create orphan spans',
      'Background jobs have no parent context',
      'Message queue consumers start new traces',
      'Scheduled tasks disconnect from triggers'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Trace Visualization',
      type: 'logs',
      content: `
\`\`\`
# What we expect (connected trace):
TraceID: abc123
├── POST /api/orders (200ms)
│   ├── validateOrder (15ms)
│   ├── kafka.send orderCreated (5ms)
│   └── respond (2ms)
│
├── [Kafka Consumer] processOrder (150ms)  <- Should be child of kafka.send
│   ├── checkInventory (50ms)
│   ├── chargePayment (80ms)
│   └── sendConfirmation (20ms)
│
└── [Email Worker] sendEmail (100ms)  <- Should be child of sendConfirmation

# What we actually see (fragmented):
TraceID: abc123
├── POST /api/orders (200ms)
│   ├── validateOrder (15ms)
│   ├── kafka.send orderCreated (5ms)  <- No children!
│   └── respond (2ms)

TraceID: def456  <- NEW TRACE, should be same!
├── [Kafka Consumer] processOrder (150ms)  <- Orphan, no parent
│   ├── checkInventory (50ms)
│   ├── chargePayment (80ms)
│   └── sendConfirmation (20ms)

TraceID: ghi789  <- ANOTHER NEW TRACE
└── [Email Worker] sendEmail (100ms)  <- Orphan, no parent
\`\`\`
      `,
      hint: 'Each async boundary starts a new trace instead of continuing the existing one'
    },
    {
      id: 2,
      title: 'Kafka Producer Code',
      type: 'code',
      content: `
\`\`\`typescript
// order-service/kafka-producer.ts
import { Kafka } from 'kafkajs';
import { trace, context } from '@opentelemetry/api';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const producer = kafka.producer();

export async function publishOrderCreated(order: Order) {
  const tracer = trace.getTracer('order-service');

  // Create span for the publish operation
  const span = tracer.startSpan('kafka.send orderCreated');

  try {
    await producer.send({
      topic: 'order-created',
      messages: [{
        key: order.id,
        value: JSON.stringify(order),
        // Where's the trace context?!
      }]
    });
    span.end();
  } catch (error) {
    span.recordException(error);
    span.end();
    throw error;
  }
}
\`\`\`
      `,
      hint: 'The Kafka message doesn\'t include trace context in headers'
    },
    {
      id: 3,
      title: 'Kafka Consumer Code',
      type: 'code',
      content: `
\`\`\`typescript
// fulfillment-service/kafka-consumer.ts
import { Kafka } from 'kafkajs';
import { trace } from '@opentelemetry/api';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'fulfillment-service' });

await consumer.subscribe({ topic: 'order-created' });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const tracer = trace.getTracer('fulfillment-service');

    // Creates a NEW root span - no parent context!
    const span = tracer.startSpan('processOrder');

    try {
      const order = JSON.parse(message.value.toString());
      await processOrder(order);
      span.end();
    } catch (error) {
      span.recordException(error);
      span.end();
      throw error;
    }
  }
});
\`\`\`
      `,
      hint: 'Consumer creates a new span but never extracts parent context from message'
    },
    {
      id: 4,
      title: 'Background Job Code',
      type: 'code',
      content: `
\`\`\`typescript
// email-service/email-worker.ts
import { Queue, Worker } from 'bullmq';
import { trace } from '@opentelemetry/api';

const emailQueue = new Queue('email');

// Producer side - queuing a job
export async function queueEmail(emailData: EmailData) {
  const span = trace.getTracer('email-service').startSpan('queue.add email');

  await emailQueue.add('sendEmail', emailData);  // No context passed!

  span.end();
}

// Consumer side - processing jobs
const worker = new Worker('email', async (job) => {
  // Creates orphan span - where's the parent?
  const span = trace.getTracer('email-service').startSpan('sendEmail');

  try {
    await sendEmail(job.data);
    span.end();
  } catch (error) {
    span.recordException(error);
    span.end();
    throw error;
  }
});
\`\`\`
      `,
      hint: 'Job data doesn\'t include trace context, so worker can\'t continue the trace'
    },
    {
      id: 5,
      title: 'OpenTelemetry Context Propagation Docs',
      type: 'config',
      content: `
\`\`\`markdown
# OpenTelemetry Context Propagation

## The Problem
Trace context must be explicitly propagated across async boundaries:
- HTTP: Headers (automatic with instrumentation)
- Kafka/MQ: Message headers (MANUAL)
- Job queues: Job metadata (MANUAL)
- setTimeout/setInterval: Context capture (MANUAL)
- Thread pools: Context transfer (MANUAL)

## W3C Trace Context Format
\`\`\`
traceparent: 00-{trace-id}-{span-id}-{flags}
tracestate: vendor1=value1,vendor2=value2
\`\`\`

## Propagation APIs
\`\`\`typescript
// Inject context into carrier (outgoing)
propagation.inject(context.active(), carrier);

// Extract context from carrier (incoming)
const ctx = propagation.extract(context.active(), carrier);

// Run code with extracted context
context.with(ctx, () => {
  // Spans created here will have correct parent
});
\`\`\`

## Common Async Boundaries
1. Message queues (Kafka, RabbitMQ, SQS)
2. Job queues (BullMQ, Sidekiq, Celery)
3. Event emitters
4. setTimeout/setInterval/setImmediate
5. Promise chains (usually automatic in Node.js)
6. Thread pools / worker threads
\`\`\`
      `,
      hint: 'Context must be manually injected and extracted across message/job queues'
    },
    {
      id: 6,
      title: 'Working HTTP Propagation (for comparison)',
      type: 'code',
      content: `
\`\`\`typescript
// This WORKS because @opentelemetry/instrumentation-http handles it automatically

// Service A - outgoing request
const response = await fetch('http://service-b/api/data');
// ^ OTel auto-instrumentation injects traceparent header

// Service B - incoming request
app.get('/api/data', (req, res) => {
  // ^ OTel auto-instrumentation extracts traceparent header
  // Span automatically has correct parent

  const span = tracer.startSpan('process-data');
  // ^ This span correctly links to Service A's span
});

// WHY IT WORKS:
// 1. HTTP instrumentation intercepts outgoing requests
// 2. Injects traceparent/tracestate headers automatically
// 3. HTTP instrumentation intercepts incoming requests
// 4. Extracts context from headers automatically
// 5. Sets active context for request handling

// Kafka/job queues don't have this automatic handling!
// You must do steps 2 and 4 manually.
\`\`\`
      `,
      hint: 'HTTP works automatically, but Kafka and job queues need manual propagation'
    }
  ],

  solution: {
    diagnosis: 'Trace context not propagated across async boundaries (Kafka, job queues) - each boundary starts a new trace',

    keywords: [
      'context propagation', 'trace context', 'opentelemetry', 'async', 'kafka',
      'message queue', 'job queue', 'orphan span', 'traceparent', 'inject', 'extract',
      'distributed tracing', 'W3C trace context'
    ],

    rootCause: `
      OpenTelemetry automatic instrumentation handles HTTP context propagation but NOT
      message queues or job queues. The trace context (trace ID, parent span ID) must
      be manually:

      1. **Injected** into the message/job when producing
      2. **Extracted** from the message/job when consuming
      3. **Activated** before creating child spans

      The code was creating spans at each boundary but never passing the context through
      the message/job data. Each consumer started a new trace because it had no parent
      context to continue from.

      This is a common mistake because:
      - HTTP "just works" due to auto-instrumentation
      - Developers assume all async boundaries are handled
      - The spans still appear in Jaeger, so it seems to work
      - The fragmentation is only obvious when viewing full traces

      The pattern must be: serialize context → transport → deserialize context → activate
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fixed: Kafka producer with context injection',
        code: `// order-service/kafka-producer.ts
import { Kafka } from 'kafkajs';
import { trace, context, propagation, SpanKind } from '@opentelemetry/api';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const producer = kafka.producer();

export async function publishOrderCreated(order: Order) {
  const tracer = trace.getTracer('order-service');

  // Create span with PRODUCER kind
  const span = tracer.startSpan('kafka.send orderCreated', {
    kind: SpanKind.PRODUCER,
    attributes: {
      'messaging.system': 'kafka',
      'messaging.destination': 'order-created',
    }
  });

  try {
    // Create carrier object for context injection
    const carrier: Record<string, string> = {};

    // Inject current trace context into carrier
    propagation.inject(context.active(), carrier);

    await producer.send({
      topic: 'order-created',
      messages: [{
        key: order.id,
        value: JSON.stringify(order),
        // Pass context in Kafka headers!
        headers: carrier  // { traceparent: '00-abc123-def456-01', tracestate: '...' }
      }]
    });

    span.end();
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw error;
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Fixed: Kafka consumer with context extraction',
        code: `// fulfillment-service/kafka-consumer.ts
import { Kafka } from 'kafkajs';
import { trace, context, propagation, SpanKind } from '@opentelemetry/api';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'fulfillment-service' });

await consumer.subscribe({ topic: 'order-created' });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const tracer = trace.getTracer('fulfillment-service');

    // Extract context from Kafka message headers
    const carrier: Record<string, string> = {};
    if (message.headers) {
      for (const [key, value] of Object.entries(message.headers)) {
        if (value) {
          carrier[key] = value.toString();
        }
      }
    }

    // Extract parent context
    const parentContext = propagation.extract(context.active(), carrier);

    // Create span WITH parent context
    const span = tracer.startSpan(
      'processOrder',
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'kafka',
          'messaging.destination': topic,
          'messaging.kafka.partition': partition,
        }
      },
      parentContext  // This links to the producer's span!
    );

    // Run processing within the span's context
    await context.with(trace.setSpan(parentContext, span), async () => {
      try {
        const order = JSON.parse(message.value!.toString());
        await processOrder(order);  // Child spans will link correctly
        span.end();
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw error;
      }
    });
  }
});`
      },
      {
        lang: 'typescript',
        description: 'Fixed: Job queue with context propagation',
        code: `// email-service/email-worker.ts
import { Queue, Worker } from 'bullmq';
import { trace, context, propagation } from '@opentelemetry/api';

const emailQueue = new Queue('email');

// Producer side - queuing a job WITH context
export async function queueEmail(emailData: EmailData) {
  const tracer = trace.getTracer('email-service');
  const span = tracer.startSpan('queue.add email', {
    kind: SpanKind.PRODUCER
  });

  // Inject trace context into job data
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  await emailQueue.add('sendEmail', {
    ...emailData,
    _traceContext: carrier  // Pass context in job data
  });

  span.end();
}

// Consumer side - processing jobs WITH context
const worker = new Worker('email', async (job) => {
  const tracer = trace.getTracer('email-service');

  // Extract trace context from job data
  const carrier = job.data._traceContext || {};
  const parentContext = propagation.extract(context.active(), carrier);

  const span = tracer.startSpan(
    'sendEmail',
    { kind: SpanKind.CONSUMER },
    parentContext
  );

  await context.with(trace.setSpan(parentContext, span), async () => {
    try {
      const { _traceContext, ...emailData } = job.data;
      await sendEmail(emailData);
      span.end();
    } catch (error) {
      span.recordException(error);
      span.end();
      throw error;
    }
  });
});`
      },
      {
        lang: 'typescript',
        description: 'Utility wrapper for async context propagation',
        code: `// tracing-utils.ts
import { context, propagation, trace, SpanKind, Context } from '@opentelemetry/api';

/**
 * Serialize current trace context for async transport
 */
export function serializeContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Deserialize trace context and run callback with it active
 */
export async function withDeserializedContext<T>(
  carrier: Record<string, string>,
  spanName: string,
  callback: () => Promise<T>
): Promise<T> {
  const parentContext = propagation.extract(context.active(), carrier);
  const tracer = trace.getTracer('default');
  const span = tracer.startSpan(spanName, { kind: SpanKind.CONSUMER }, parentContext);

  return context.with(trace.setSpan(parentContext, span), async () => {
    try {
      const result = await callback();
      span.end();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.end();
      throw error;
    }
  });
}

// Usage in producer:
const message = {
  data: orderData,
  _trace: serializeContext()
};

// Usage in consumer:
await withDeserializedContext(message._trace, 'processOrder', async () => {
  await processOrder(message.data);
});`
      }
    ],

    prevention: [
      'Audit all async boundaries in the codebase for context propagation',
      'Create utility wrappers for common patterns (Kafka, job queues)',
      'Add integration tests that verify trace continuity',
      'Use OpenTelemetry instrumentation libraries when available',
      'Document context propagation requirements for new integrations',
      'Monitor orphan span rate as a tracing health metric'
    ],

    educationalInsights: [
      'HTTP context propagation is automatic; everything else is manual',
      'Trace context must be serialized into the transport medium (headers, job data)',
      'The consumer must explicitly extract and activate the parent context',
      'context.with() is required to set active context for child span creation',
      'SpanKind (PRODUCER/CONSUMER) helps visualization tools render queues correctly',
      'Orphan spans waste storage and make traces useless for debugging'
    ]
  }
};

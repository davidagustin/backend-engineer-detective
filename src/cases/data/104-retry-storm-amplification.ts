import { DetectiveCase } from '../../types';

export const retryStormAmplification: DetectiveCase = {
  id: 'retry-storm-amplification',
  title: 'The Retry Storm Amplification',
  subtitle: 'Aggressive retries turning a minor hiccup into a catastrophic cascade',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      A brief 30-second network blip caused a minor increase in failures to your order service.
      Instead of recovering, the system entered a death spiral. Request volume exploded 10x,
      database connections maxed out, and multiple services crashed. The initial issue resolved
      itself, but the system remained down for 2 hours.
    `,
    impact: `
      Complete platform outage for 2 hours. $500K in lost orders. Database required manual
      intervention to recover. Customer trust severely damaged with front-page coverage.
    `,
    timeline: [
      { time: '2:00 PM', event: 'Network blip causes 5% of requests to timeout', type: 'warning' },
      { time: '2:01 PM', event: 'Request volume suddenly increases 3x', type: 'warning' },
      { time: '2:02 PM', event: 'Database connections at 100%', type: 'critical' },
      { time: '2:03 PM', event: 'Request volume at 10x normal, cascading failures', type: 'critical' },
      { time: '2:05 PM', event: 'All services reporting OOM or connection exhaustion', type: 'critical' },
      { time: '4:00 PM', event: 'System finally stabilized after manual intervention', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Individual services work in isolation',
      'Database is healthy when load is normal',
      'Network connectivity is fully restored',
      'No code bugs or memory leaks detected'
    ],
    broken: [
      'Request volume grows exponentially during issues',
      'System cannot recover even after initial issue resolves',
      'Multiple tiers failing simultaneously',
      'Manual intervention required to break the cycle'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Request Volume Metrics',
      type: 'metrics',
      content: `
\`\`\`
## Request Volume During Incident

| Time | Normal Requests | Retry Requests | Total | Unique Users |
|------|----------------|----------------|-------|--------------|
| 1:59 PM | 1,000/s | 50/s | 1,050/s | 800 |
| 2:00 PM | 1,000/s | 500/s | 1,500/s | 800 |
| 2:01 PM | 1,000/s | 2,000/s | 3,000/s | 800 |
| 2:02 PM | 1,000/s | 8,000/s | 9,000/s | 800 |
| 2:03 PM | 500/s | 15,000/s | 15,500/s | 400 |
| 2:04 PM | 100/s | 25,000/s | 25,100/s | 50 |

Note: User count stayed flat but request volume grew 25x
Each original request generated ~30 retry requests
\`\`\`
      `,
      hint: 'Request volume grew 25x while unique users stayed the same'
    },
    {
      id: 2,
      title: 'Service Retry Configuration',
      type: 'code',
      content: `
\`\`\`typescript
// api-gateway/src/config/retry.ts
export const retryConfig = {
  maxRetries: 5,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffMultiplier: 1.5,
  retryOn: [408, 429, 500, 502, 503, 504, 'ETIMEDOUT', 'ECONNRESET']
};

// order-service/src/config/retry.ts
export const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 200,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  retryOn: ['ETIMEDOUT', 'ECONNRESET', 500, 502, 503, 504]
};

// inventory-service/src/config/retry.ts
export const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 500,
  backoffMultiplier: 1.2,
  retryOn: ['ETIMEDOUT', 'ECONNRESET', 500, 502, 503, 504]
};

// payment-service/src/config/retry.ts
export const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryOn: ['ETIMEDOUT', 'ECONNRESET', 500, 502, 503, 504]
};
\`\`\`
      `,
      hint: 'Every service has its own retry configuration - what happens when they chain?'
    },
    {
      id: 3,
      title: 'Request Flow Analysis',
      type: 'testimony',
      content: `
"I traced a single checkout request through the system during the incident:

1. User clicks checkout -> API Gateway
2. API Gateway calls Order Service
3. Order Service calls Inventory Service
4. Order Service calls Payment Service
5. Order Service calls Notification Service

Each hop has retries configured. When the network blipped:
- API Gateway retried 5 times to Order Service
- Each of those 5 calls made Order Service retry 3 times to Inventory
- Each of those calls made Order Service retry 3 times to Payment
- Each of those calls made Payment retry 3 times to the payment processor

One user checkout = 5 * 3 * 3 * 3 = 135 downstream requests!

And that's just ONE user. We had 800 concurrent users. The retries
compounded multiplicatively at each tier."
      `
    },
    {
      id: 4,
      title: 'Distributed Trace During Incident',
      type: 'logs',
      content: `
\`\`\`
TraceID: abc-123-def (single checkout request)
User: user_456
Start: 2:01:00.000

[2:01:00.000] api-gateway: Received POST /checkout
[2:01:00.100] api-gateway: order-service TIMEOUT (attempt 1/5)
[2:01:00.250] api-gateway: order-service TIMEOUT (attempt 2/5)
  [2:01:00.251] order-service: inventory-service TIMEOUT (attempt 1/3)
  [2:01:00.451] order-service: inventory-service TIMEOUT (attempt 2/3)
  [2:01:00.851] order-service: inventory-service TIMEOUT (attempt 3/3)
  [2:01:00.852] order-service: payment-service TIMEOUT (attempt 1/3)
    [2:01:00.853] payment-service: stripe TIMEOUT (attempt 1/3)
    [2:01:01.353] payment-service: stripe TIMEOUT (attempt 2/3)
    ...
[2:01:00.400] api-gateway: order-service TIMEOUT (attempt 3/5)
  ... (more nested retries)
[2:01:00.550] api-gateway: order-service TIMEOUT (attempt 4/5)
  ... (more nested retries)
[2:01:00.700] api-gateway: order-service TIMEOUT (attempt 5/5)
  ... (more nested retries)

Total spans in trace: 847
Total duration: 45 seconds
Result: FAILED (all retries exhausted)
\`\`\`
      `,
      hint: '847 spans from one checkout request - retries multiplied at each tier'
    },
    {
      id: 5,
      title: 'Database Connection Metrics',
      type: 'metrics',
      content: `
\`\`\`
## PostgreSQL Connection Pool

| Time | Active | Waiting | Max Pool | Queries/sec |
|------|--------|---------|----------|-------------|
| 1:59 PM | 45 | 0 | 100 | 2,000 |
| 2:00 PM | 100 | 50 | 100 | 5,000 |
| 2:01 PM | 100 | 500 | 100 | 3,000 |
| 2:02 PM | 100 | 2000 | 100 | 500 |
| 2:03 PM | 100 | 5000 | 100 | 100 |

Connection wait timeout: 30 seconds
Average query time: 50ms (normal) -> 15,000ms (incident)

## Connection Pool Exhaustion Flow:
1. Retries flood in faster than connections free up
2. Queries queue behind exhausted pool
3. Queued queries timeout, triggering MORE retries
4. More retries = more queue = more timeouts = runaway feedback loop
\`\`\`
      `,
      hint: 'Waiting connections grew from 0 to 5000 - a runaway queue'
    },
    {
      id: 6,
      title: 'No Coordinated Backoff',
      type: 'code',
      content: `
\`\`\`typescript
// Each service has its own retry timing - not coordinated

// Problem 1: No jitter
const delay = initialDelay * Math.pow(backoffMultiplier, attempt);
// All retries from same batch hit at exact same time

// Problem 2: No retry budget
// Once retries start, nothing limits total retry volume

// Problem 3: No deadline propagation
async function callDownstream(request) {
  // Each service uses full timeout regardless of upstream deadline
  return await http.post(url, request, { timeout: 5000 });
  // If upstream has 2s left, we still wait 5s then retry
}

// Problem 4: No load shedding
// Services accept ALL requests even when overwhelmed
app.post('/orders', async (req, res) => {
  // No admission control - always try to process
  const result = await processOrder(req.body);
  res.json(result);
});
\`\`\`
      `,
      hint: 'No jitter, no retry budgets, no deadline propagation, no load shedding'
    }
  ],

  solution: {
    diagnosis: 'Multiplicative retry amplification across service tiers with no coordinated backoff or retry budgets',

    keywords: [
      'retry storm', 'retry amplification', 'cascade failure', 'exponential backoff',
      'jitter', 'retry budget', 'deadline propagation', 'load shedding', 'circuit breaker',
      'thundering herd', 'multiplicative retries'
    ],

    rootCause: `
      The system experienced a classic retry storm amplification failure. Each service tier
      had independent retry logic that multiplied at each hop:

      - API Gateway: 5 retries
      - Order Service: 3 retries to each downstream
      - Payment Service: 3 retries to processor

      One request could spawn: 5 * 3 * 3 = 45 downstream requests (minimum)

      With 800 concurrent users, this meant 36,000+ requests from what should be 800.

      Key problems that amplified the storm:

      1. **No Jitter**: Retries hit at deterministic intervals, causing thundering herds

      2. **No Retry Budget**: Nothing limited the total retry volume system-wide

      3. **No Deadline Propagation**: Each service used its full timeout even when the
         upstream had already given up or timed out

      4. **No Load Shedding**: Services accepted all requests even when overwhelmed,
         leading to queue buildup and timeout cascades

      5. **Multiplicative at Each Tier**: 5 * 3 * 3 * 3 = 135 requests per user checkout

      The feedback loop: Retries → Queue buildup → Timeouts → More retries → Crash
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Implement retry budget to limit total retries',
        code: `// Shared retry budget across the request lifecycle
class RetryBudget {
  private tokensPerSecond: number;
  private maxTokens: number;
  private tokens: number;
  private lastRefill: number;

  constructor(tokensPerSecond = 10, maxTokens = 100) {
    this.tokensPerSecond = tokensPerSecond;
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false; // Budget exhausted, don't retry
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.tokensPerSecond
    );
    this.lastRefill = now;
  }
}

// Use budget in retry logic
const retryBudget = new RetryBudget();

async function callWithRetry(fn: () => Promise<T>): Promise<T> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Check budget before retrying
      if (!retryBudget.tryAcquire()) {
        throw new Error('Retry budget exhausted');
      }
      await sleep(calculateBackoff(i));
    }
  }
  throw lastError;
}`
      },
      {
        lang: 'typescript',
        description: 'Add jitter to prevent thundering herd',
        code: `// Exponential backoff with full jitter
function calculateBackoffWithJitter(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  // Exponential component
  const exponentialDelay = Math.min(
    maxDelay,
    baseDelay * Math.pow(2, attempt)
  );

  // Full jitter: random value between 0 and exponential delay
  // This spreads retries evenly across the window
  return Math.random() * exponentialDelay;
}

// Even better: Decorrelated jitter
let previousDelay = baseDelay;
function decorrelatedJitter(baseDelay: number, maxDelay: number): number {
  const delay = Math.min(
    maxDelay,
    randomBetween(baseDelay, previousDelay * 3)
  );
  previousDelay = delay;
  return delay;
}

// Usage
async function retryWithJitter<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = calculateBackoffWithJitter(attempt, 100, 10000);
      await sleep(delay);
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Propagate deadlines to prevent wasted work',
        code: `// Deadline propagation prevents retrying when upstream has given up
interface RequestContext {
  deadline: number; // Unix timestamp when request expires
  retryBudget: number; // Remaining retry attempts allowed
}

async function callWithDeadline<T>(
  ctx: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  const remainingTime = ctx.deadline - Date.now();

  // Don't even start if deadline passed
  if (remainingTime <= 0) {
    throw new DeadlineExceededError();
  }

  // Don't retry if insufficient time remaining
  if (remainingTime < MIN_USEFUL_TIME_MS) {
    return await Promise.race([
      fn(),
      sleep(remainingTime).then(() => {
        throw new DeadlineExceededError();
      })
    ]);
  }

  // Propagate deadline to downstream calls
  const downstreamCtx: RequestContext = {
    deadline: ctx.deadline,
    retryBudget: Math.max(0, ctx.retryBudget - 1)
  };

  return await fn(downstreamCtx);
}

// Middleware to extract/inject deadline headers
function deadlinePropagation(req, res, next) {
  const deadline = req.headers['x-deadline']
    ? parseInt(req.headers['x-deadline'])
    : Date.now() + DEFAULT_TIMEOUT_MS;

  req.context = { deadline, retryBudget: 3 };
  next();
}`
      },
      {
        lang: 'typescript',
        description: 'Load shedding to reject requests when overwhelmed',
        code: `// Adaptive load shedding using Little's Law
class AdaptiveLoadShedder {
  private activeRequests = 0;
  private latencyEMA = 100; // Exponential moving average
  private readonly alpha = 0.1;

  constructor(
    private maxConcurrency: number,
    private targetLatencyMs: number
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Adaptive concurrency: reduce limit when latency is high
    const adaptiveLimit = this.maxConcurrency *
      (this.targetLatencyMs / this.latencyEMA);

    if (this.activeRequests >= adaptiveLimit) {
      throw new LoadSheddingError('Service overloaded');
    }

    this.activeRequests++;
    const start = Date.now();

    try {
      return await fn();
    } finally {
      const latency = Date.now() - start;
      this.latencyEMA = this.alpha * latency +
        (1 - this.alpha) * this.latencyEMA;
      this.activeRequests--;
    }
  }
}

// Usage in Express middleware
const shedder = new AdaptiveLoadShedder(100, 200);

app.use(async (req, res, next) => {
  try {
    await shedder.execute(async () => {
      return new Promise((resolve) => {
        res.on('finish', resolve);
        next();
      });
    });
  } catch (error) {
    if (error instanceof LoadSheddingError) {
      res.status(503).json({
        error: 'Service temporarily overloaded',
        retryAfter: 5
      });
    }
  }
});`
      }
    ],

    prevention: [
      'Implement retry budgets to limit total retry volume across the system',
      'Add jitter to all retry logic to prevent thundering herd',
      'Propagate deadlines so downstream services know when to give up',
      'Use circuit breakers to fail fast when downstream is unhealthy',
      'Implement load shedding to reject requests when overwhelmed',
      'Calculate total retry amplification: product of retries at each tier',
      'Test failure scenarios in staging with realistic traffic',
      'Set up alerts for retry rate exceeding normal thresholds'
    ],

    educationalInsights: [
      'Retries multiply at each tier: 5 * 3 * 3 = 45x amplification',
      'Without jitter, retries create synchronized thundering herds',
      'Retry budgets cap total retries regardless of failure rate',
      'Deadline propagation prevents wasted work on already-failed requests',
      'Load shedding trades some failures for system survival',
      'A 30-second blip can cause a 2-hour outage through retry amplification',
      'The feedback loop: Retries -> Queues -> Timeouts -> More Retries'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const bulkheadIsolationBreach: DetectiveCase = {
  id: 'bulkhead-isolation-breach',
  title: 'The Bulkhead Isolation Breach',
  subtitle: 'Failure spreading between isolated pools despite bulkhead pattern implementation',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your microservices architecture implements the bulkhead pattern to isolate failures.
      Each critical service has its own connection pool and thread pool. Yet when the
      recommendation service started timing out, the entire platform degraded. Products
      couldn't load, checkout failed, and even unrelated features like user profiles broke.
      The bulkheads didn't work.
    `,
    impact: `
      Platform-wide degradation affecting all features. Checkout success rate dropped to 20%.
      $200K/hour in lost revenue. The architectural investment in bulkheads appeared wasted.
    `,
    timeline: [
      { time: '11:00 AM', event: 'Recommendation service ML model update deployed', type: 'normal' },
      { time: '11:15 AM', event: 'Recommendation service latency increases 10x', type: 'warning' },
      { time: '11:20 AM', event: 'Product pages start timing out', type: 'warning' },
      { time: '11:25 AM', event: 'Checkout failures begin', type: 'critical' },
      { time: '11:30 AM', event: 'User profile pages failing', type: 'critical' },
      { time: '11:35 AM', event: 'Entire platform degraded', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Bulkhead pools are correctly configured',
      'Each service has isolated connection pools',
      'Thread pools per service are separate',
      'Health checks show pools are not exhausted'
    ],
    broken: [
      'Slow recommendation service affects unrelated features',
      'Connection pools not exhausted but requests still fail',
      'Thread pools show availability but requests queue',
      'Failures spread across supposedly isolated systems'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Bulkhead Configuration',
      type: 'config',
      content: `
\`\`\`typescript
// service-config.ts - Bulkhead setup looks correct
export const bulkheadConfig = {
  recommendations: {
    maxConcurrent: 20,
    maxQueue: 100,
    timeout: 5000,
    connectionPool: { min: 5, max: 20 }
  },
  inventory: {
    maxConcurrent: 50,
    maxQueue: 200,
    timeout: 2000,
    connectionPool: { min: 10, max: 50 }
  },
  payments: {
    maxConcurrent: 30,
    maxQueue: 50,
    timeout: 10000,
    connectionPool: { min: 10, max: 30 }
  },
  users: {
    maxConcurrent: 40,
    maxQueue: 100,
    timeout: 3000,
    connectionPool: { min: 10, max: 40 }
  }
};

// Each bulkhead is independent - why are they affecting each other?
\`\`\`
      `,
      hint: 'The bulkhead configurations look independent and properly sized'
    },
    {
      id: 2,
      title: 'Product Page Request Flow',
      type: 'code',
      content: `
\`\`\`typescript
// product-page.controller.ts
@Get('/products/:id')
async getProductPage(@Param('id') productId: string) {
  // Fetch product details - uses inventory bulkhead
  const product = await this.inventoryBulkhead.execute(
    () => this.inventoryService.getProduct(productId)
  );

  // Fetch recommendations - uses recommendations bulkhead
  const recommendations = await this.recommendationsBulkhead.execute(
    () => this.recommendationsService.getRecommendations(productId)
  );

  // Fetch user's wishlist - uses users bulkhead
  const wishlist = await this.usersBulkhead.execute(
    () => this.usersService.getWishlist(this.currentUser.id)
  );

  return { product, recommendations, wishlist };
}
\`\`\`
      `,
      hint: 'The calls are sequential - what happens when one is slow?'
    },
    {
      id: 3,
      title: 'Request Thread Pool Metrics',
      type: 'metrics',
      content: `
\`\`\`
## HTTP Server Thread Pool (shared across all endpoints)

| Time | Active | Waiting | Max Threads | Avg Latency |
|------|--------|---------|-------------|-------------|
| 11:00 AM | 50 | 0 | 200 | 150ms |
| 11:15 AM | 150 | 0 | 200 | 800ms |
| 11:20 AM | 200 | 500 | 200 | 3000ms |
| 11:25 AM | 200 | 2000 | 200 | 8000ms |
| 11:30 AM | 200 | 5000 | 200 | 15000ms |

## Individual Bulkhead Metrics (same timeframe)

Recommendations Bulkhead:
  Active: 20/20 (maxed)
  Queue: 100/100 (maxed)
  Rejections: 5000

Inventory Bulkhead:
  Active: 15/50 (30%)
  Queue: 10/200 (5%)
  Rejections: 0

Users Bulkhead:
  Active: 12/40 (30%)
  Queue: 5/100 (5%)
  Rejections: 0
\`\`\`
      `,
      hint: 'Bulkheads are fine but HTTP thread pool is exhausted'
    },
    {
      id: 4,
      title: 'Thread Dump Analysis',
      type: 'logs',
      content: `
\`\`\`
# Thread dump during incident - 200 HTTP threads

Thread: http-nio-8080-exec-1
State: TIMED_WAITING
Stack:
  at sun.misc.Unsafe.park
  at java.util.concurrent.locks.LockSupport.parkNanos
  at com.bulkhead.Bulkhead.execute  // Waiting for recommendation bulkhead
  at com.api.ProductController.getProductPage

Thread: http-nio-8080-exec-2
State: TIMED_WAITING
Stack:
  at sun.misc.Unsafe.park
  at java.util.concurrent.locks.LockSupport.parkNanos
  at com.bulkhead.Bulkhead.execute  // Waiting for recommendation bulkhead
  at com.api.ProductController.getProductPage

... (180 more threads in same state)

Thread: http-nio-8080-exec-183
State: TIMED_WAITING
Stack:
  at com.bulkhead.Bulkhead.execute  // Waiting for recommendation bulkhead
  at com.api.CheckoutController.getCheckoutPage

# Pattern: All 200 HTTP threads waiting on recommendation bulkhead
# Even checkout/profile pages blocked waiting for recommendations
\`\`\`
      `,
      hint: 'All HTTP threads are blocked waiting for the recommendation bulkhead'
    },
    {
      id: 5,
      title: 'The Shared Resource Problem',
      type: 'testimony',
      content: `
"I finally understood what happened. Our bulkheads isolate the DOWNSTREAM calls,
but they don't isolate the UPSTREAM request threads.

When recommendations got slow:
1. Recommendation bulkhead maxed out (20 concurrent + 100 queued = 120 requests)
2. HTTP threads calling recommendations got blocked waiting in the bulkhead queue
3. Each product page needs recommendations, so ALL product page HTTP threads blocked
4. Product pages use the SAME HTTP thread pool as checkout, profiles, everything
5. Soon, 180 of 200 HTTP threads were stuck waiting on recommendations
6. No threads left for checkout, profiles, or any other endpoint

The bulkhead protected the recommendation service from being overwhelmed, but it
did NOT protect the rest of the system from waiting on recommendations.

We had bulkheads for the downstream services but not for the upstream resource:
the HTTP thread pool."
      `
    },
    {
      id: 6,
      title: 'Sequential vs Parallel Calls',
      type: 'code',
      content: `
\`\`\`typescript
// Current implementation - sequential with blocking waits
async getProductPage(productId: string) {
  const product = await this.getProduct(productId);         // 100ms
  const recommendations = await this.getRecommendations(productId);  // 5000ms (slow!)
  const wishlist = await this.getWishlist();                // 50ms
  return { product, recommendations, wishlist };
  // Total: 5150ms, thread blocked entire time
}

// Even with timeout, thread still blocks for 5 seconds
const recommendations = await this.recommendationsBulkhead.execute(
  () => this.recommendationsService.getRecommendations(productId),
  { timeout: 5000 }  // Thread still blocks for 5 seconds before timeout
);

// The thread pool IS the shared resource
// Bulkheads limit downstream calls but threads still wait
\`\`\`
      `,
      hint: 'HTTP threads block waiting for bulkhead, creating thread pool exhaustion'
    }
  ],

  solution: {
    diagnosis: 'HTTP thread pool exhaustion caused by blocking waits on slow bulkhead, bulkheads isolated downstream but not upstream thread pool',

    keywords: [
      'bulkhead', 'thread pool', 'isolation', 'blocking', 'async', 'non-blocking',
      'thread exhaustion', 'resource isolation', 'cascade failure', 'semaphore'
    ],

    rootCause: `
      The bulkhead pattern was correctly implemented for downstream service calls, but
      it failed to provide true isolation because of a shared upstream resource: the
      HTTP server thread pool.

      The problem flow:

      1. Recommendation service became slow (5 second response times)
      2. Recommendation bulkhead correctly limited concurrent calls to 20
      3. But each call blocked an HTTP thread for 5 seconds
      4. Product page handler calls recommendations sequentially, blocking its thread
      5. HTTP thread pool (200 threads) quickly exhausted waiting for recommendations
      6. Other endpoints (checkout, profiles) share the same thread pool
      7. No threads available = all endpoints fail

      The bulkhead protected the recommendation service from overload, but it did NOT
      protect the calling service from thread exhaustion. True isolation requires:

      1. Bulkheads for downstream calls (had this)
      2. Non-blocking/async calls so threads don't wait (missing)
      3. Separate thread pools per feature/endpoint (missing)
      4. Timeouts that release threads quickly (had, but still 5 seconds)
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Use non-blocking async with graceful degradation',
        code: `// product-page.controller.ts - Non-blocking with fallback
@Get('/products/:id')
async getProductPage(@Param('id') productId: string) {
  // Run all calls in parallel - don't block sequentially
  const [product, recommendations, wishlist] = await Promise.allSettled([
    this.inventoryBulkhead.execute(
      () => this.inventoryService.getProduct(productId)
    ),
    this.recommendationsBulkhead.execute(
      () => this.recommendationsService.getRecommendations(productId)
    ).catch(() => []), // Graceful degradation: empty recommendations on failure
    this.usersBulkhead.execute(
      () => this.usersService.getWishlist(this.currentUser.id)
    ).catch(() => [])  // Graceful degradation: empty wishlist on failure
  ]);

  // Only fail if core product data fails
  if (product.status === 'rejected') {
    throw new NotFoundException('Product not found');
  }

  return {
    product: product.value,
    recommendations: recommendations.status === 'fulfilled'
      ? recommendations.value
      : [],
    wishlist: wishlist.status === 'fulfilled'
      ? wishlist.value
      : []
  };
}`
      },
      {
        lang: 'typescript',
        description: 'Implement bulkhead with non-blocking semaphore',
        code: `// Non-blocking bulkhead that doesn't exhaust calling thread pool
class NonBlockingBulkhead {
  private semaphore: Semaphore;
  private queue: AsyncQueue;

  constructor(
    private maxConcurrent: number,
    private maxQueue: number,
    private timeout: number
  ) {
    this.semaphore = new Semaphore(maxConcurrent);
    this.queue = new AsyncQueue(maxQueue);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Try to acquire immediately
    if (this.semaphore.tryAcquire()) {
      return this.runWithRelease(fn);
    }

    // Check queue capacity - FAIL FAST instead of blocking
    if (this.queue.size >= this.maxQueue) {
      throw new BulkheadRejectedException('Bulkhead full');
    }

    // Queue with timeout - don't block indefinitely
    const acquired = await Promise.race([
      this.semaphore.acquire(),
      sleep(this.timeout).then(() => false)
    ]);

    if (!acquired) {
      throw new BulkheadTimeoutException('Timeout waiting for bulkhead');
    }

    return this.runWithRelease(fn);
  }

  private async runWithRelease<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await Promise.race([
        fn(),
        sleep(this.timeout).then(() => {
          throw new BulkheadTimeoutException('Execution timeout');
        })
      ]);
    } finally {
      this.semaphore.release();
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Separate thread pools per feature domain',
        code: `// Express with worker threads for isolation
import { Worker } from 'worker_threads';
import { createPool } from 'generic-pool';

// Create isolated worker pools per domain
const workerPools = {
  products: createPool({
    create: () => new Worker('./handlers/product-worker.js'),
    destroy: (worker) => worker.terminate(),
  }, { max: 50, min: 10 }),

  checkout: createPool({
    create: () => new Worker('./handlers/checkout-worker.js'),
    destroy: (worker) => worker.terminate(),
  }, { max: 30, min: 10 }),

  profiles: createPool({
    create: () => new Worker('./handlers/profile-worker.js'),
    destroy: (worker) => worker.terminate(),
  }, { max: 20, min: 5 }),
};

// Route to appropriate pool
app.get('/products/:id', async (req, res) => {
  const worker = await workerPools.products.acquire();
  try {
    const result = await runInWorker(worker, {
      action: 'getProduct',
      productId: req.params.id
    });
    res.json(result);
  } finally {
    workerPools.products.release(worker);
  }
});

// Products being slow can't exhaust checkout or profile workers`
      },
      {
        lang: 'typescript',
        description: 'Circuit breaker with immediate rejection',
        code: `// Circuit breaker that fails fast instead of queuing
import CircuitBreaker from 'opossum';

const recommendationsBreaker = new CircuitBreaker(
  (productId) => recommendationsService.get(productId),
  {
    timeout: 1000,              // Fail fast - 1 second max
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 10,
  }
);

// Fallback returns immediately - no waiting
recommendationsBreaker.fallback((productId) => {
  // Return cached or default recommendations
  return getCachedRecommendations(productId) || [];
});

// Usage - never blocks for slow recommendations
@Get('/products/:id')
async getProductPage(@Param('id') productId: string) {
  const [product, recommendations] = await Promise.all([
    this.inventoryService.getProduct(productId),
    recommendationsBreaker.fire(productId), // Returns fallback if circuit open
  ]);

  return { product, recommendations };
}`
      }
    ],

    prevention: [
      'Use non-blocking async calls with Promise.allSettled for parallel fetching',
      'Implement graceful degradation for non-critical features',
      'Set aggressive timeouts that release resources quickly',
      'Use circuit breakers with fast fallbacks instead of slow bulkhead queues',
      'Consider separate thread/worker pools per feature domain',
      'Monitor thread pool utilization, not just bulkhead metrics',
      'Test failure scenarios with realistic thread pool exhaustion',
      'Design for partial responses rather than all-or-nothing'
    ],

    educationalInsights: [
      'Bulkheads protect downstream services but not upstream thread pools',
      'Thread pool exhaustion bypasses all downstream isolation patterns',
      'Sequential blocking calls with long timeouts are the enemy of isolation',
      'True isolation requires async, non-blocking, and separate thread pools',
      'Graceful degradation (empty recommendations) beats total failure',
      'Circuit breakers with instant fallbacks are better than bulkhead queues',
      'The shared resource (HTTP threads) was the unprotected bottleneck'
    ]
  }
};

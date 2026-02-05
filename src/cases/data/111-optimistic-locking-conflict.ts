import { DetectiveCase } from '../../types';

export const optimisticLockingConflict: DetectiveCase = {
  id: 'optimistic-locking-conflict',
  title: 'The Optimistic Locking Storm',
  subtitle: 'High contention causing cascading update failures under load',
  difficulty: 'mid',
  category: 'database',

  crisis: {
    description: `
      Your inventory management system uses optimistic locking to prevent lost updates.
      During a flash sale, the conflict rate exploded. Updates that normally succeed are
      failing 80% of the time. Retries are making it worse. The inventory count for popular
      items is bouncing wildly and customers are seeing "temporarily unavailable" for items
      that should be in stock.
    `,
    impact: `
      80% of inventory updates failing during peak. Popular items showing unavailable despite
      stock. $150K in lost sales during 2-hour flash sale. Customer frustration at checkout
      failures. Retry storms overwhelming database.
    `,
    timeline: [
      { time: '6:00 PM', event: 'Flash sale begins, 50x normal traffic', type: 'normal' },
      { time: '6:02 PM', event: 'Optimistic locking conflicts spike to 40%', type: 'warning' },
      { time: '6:10 PM', event: 'Conflict rate reaches 80%', type: 'critical' },
      { time: '6:15 PM', event: 'Database CPU at 100% from retries', type: 'critical' },
      { time: '6:30 PM', event: 'Emergency throttling implemented', type: 'warning' },
      { time: '8:00 PM', event: 'Sale ended, system recovered', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Database is healthy and responsive',
      'Individual queries execute quickly',
      'Low-contention items update correctly',
      'Optimistic locking detection working correctly'
    ],
    broken: [
      'High-demand item updates failing repeatedly',
      'Same items retried hundreds of times per second',
      'Version conflicts cascading into retry storms',
      'Inventory counts inconsistent across requests'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Optimistic Locking Implementation',
      type: 'code',
      content: `
\`\`\`typescript
// inventory-service/src/services/inventory.service.ts

class InventoryService {
  async decrementStock(sku: string, quantity: number): Promise<void> {
    // Read current state
    const item = await this.db.inventory.findOne({ sku });

    if (item.quantity < quantity) {
      throw new InsufficientStockError();
    }

    // Update with version check (optimistic lock)
    const result = await this.db.inventory.updateOne(
      {
        sku,
        version: item.version  // Only update if version hasn't changed
      },
      {
        $inc: { quantity: -quantity },
        $inc: { version: 1 }
      }
    );

    if (result.modifiedCount === 0) {
      // Version changed - someone else updated
      throw new OptimisticLockError('Concurrent modification detected');
    }
  }
}

// Caller retries on OptimisticLockError
async function purchaseWithRetry(sku: string, qty: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await inventoryService.decrementStock(sku, qty);
      return;
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        continue; // Retry immediately
      }
      throw error;
    }
  }
  throw new Error('Failed after 10 retries');
}
\`\`\`
      `,
      hint: 'Retry is immediate with no backoff - all retries hit at once'
    },
    {
      id: 2,
      title: 'Conflict Rate During Flash Sale',
      type: 'metrics',
      content: `
\`\`\`
# Optimistic Lock Conflict Rates by SKU

| SKU | Requests/sec | Conflicts/sec | Conflict Rate |
|-----|--------------|---------------|---------------|
| HOT-ITEM-1 | 500 | 450 | 90% |
| HOT-ITEM-2 | 350 | 300 | 86% |
| HOT-ITEM-3 | 280 | 220 | 79% |
| NORMAL-ITEM-1 | 10 | 0 | 0% |
| NORMAL-ITEM-2 | 8 | 0 | 0% |

# Request Amplification
Original purchase requests/sec: 200
Total inventory update attempts/sec: 2,400
Amplification factor: 12x

# The math on retries:
# 500 req/sec on HOT-ITEM-1
# 90% conflict rate = 450 conflicts
# Each conflict retries up to 10 times
# Worst case: 500 * 10 = 5,000 attempts for 500 purchases
# Actually observed: ~2,400 (some succeed before max retries)
\`\`\`
      `,
      hint: '12x request amplification from retries overwhelming the database'
    },
    {
      id: 3,
      title: 'Why Conflicts Cascade',
      type: 'testimony',
      content: `
"Let me walk through why 500 concurrent requests to the same row causes 90%
conflict rate:

Time T0:
- 500 requests all read version=100, quantity=1000

Time T1:
- Request 1 tries UPDATE WHERE version=100
- Succeeds! Version becomes 101, quantity=999

Time T2:
- Requests 2-500 all try UPDATE WHERE version=100
- ALL FAIL! Version is now 101
- 499 conflicts (99.8% conflict rate)

Time T3:
- 499 requests retry, all read version=101
- Request 2 succeeds, version becomes 102
- 498 conflicts

Time T4:
- 498 requests retry, 497 conflicts
...

This is the 'thundering herd' pattern for optimistic locking. When many
concurrent requests target the same row, only ONE can succeed per version.
Everyone else conflicts and retries, creating the next thundering herd.

Immediate retries make it worse - they all retry at the same instant,
maximizing conflicts."
      `
    },
    {
      id: 4,
      title: 'Database Load During Incident',
      type: 'metrics',
      content: `
\`\`\`
# MongoDB Metrics During Flash Sale

| Time | Queries/sec | CPU | Lock % | Avg Latency |
|------|-------------|-----|--------|-------------|
| 5:55 PM | 1,000 | 30% | 5% | 2ms |
| 6:00 PM | 2,400 | 75% | 25% | 15ms |
| 6:10 PM | 5,500 | 100% | 60% | 150ms |
| 6:20 PM | 8,000 | 100% | 80% | 500ms |

# Document-level locking stats
Hot documents (top 3 SKUs): 99% of write locks
Lock wait time: avg 200ms, p99 2000ms

# The cascade:
# High conflicts -> More retries -> More queries
# More queries -> Higher lock contention -> Longer waits
# Longer waits -> More overlapping requests -> More conflicts
# Feedback loop until system saturates
\`\`\`
      `,
      hint: 'Retry amplification created 8x the normal query load'
    },
    {
      id: 5,
      title: 'Naive Retry Strategy',
      type: 'code',
      content: `
\`\`\`typescript
// CURRENT: Immediate retry with no backoff
async function purchaseWithRetry(sku: string, qty: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await inventoryService.decrementStock(sku, qty);
      return;
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        continue;  // PROBLEM: Retry immediately
      }
      throw error;
    }
  }
  throw new Error('Failed after 10 retries');
}

// What happens with 100 concurrent purchases:
// Attempt 1: 100 try, 1 succeeds, 99 fail
// Attempt 2: 99 retry IMMEDIATELY, 1 succeeds, 98 fail
// Attempt 3: 98 retry IMMEDIATELY, 1 succeeds, 97 fail
// ...
// Total attempts: 100+99+98+...+1 = 5,050

// If we added 50ms random delay between retries:
// Requests would spread out, reducing concurrent conflicts
// But we don't have any delay...
\`\`\`
      `,
      hint: 'Immediate retries keep all requests synchronized in conflict'
    },
    {
      id: 6,
      title: 'Alternative Approaches Considered',
      type: 'testimony',
      content: `
"Our architect suggested several alternatives to pure optimistic locking:

1. ATOMIC INCREMENT: Instead of read-check-write, use atomic decrement:
   db.inventory.updateOne({sku, quantity: {$gte: qty}}, {$inc: {quantity: -qty}})
   No version check needed - operation is atomic.

2. PESSIMISTIC LOCKING: Lock the row before update. Requests queue instead
   of conflict. But blocks readers and doesn't scale.

3. DISTRIBUTED COUNTER: Use Redis DECRBY for hot items. Single-threaded
   Redis handles 100K ops/sec without conflicts.

4. RESERVATION QUEUE: Instead of direct decrement, queue reservation requests.
   Background worker processes sequentially. No conflicts, but adds latency.

5. SHARDED COUNTERS: Split inventory across multiple counters. SKU_A_shard_1,
   SKU_A_shard_2, etc. Reduces contention by 1/N. Complexity in rebalancing.

For our flash sale scenario, atomic increment or Redis would have been
much better than optimistic locking with retries."
      `
    }
  ],

  solution: {
    diagnosis: 'Optimistic locking with immediate retries causing thundering herd conflicts under high contention',

    keywords: [
      'optimistic locking', 'conflict', 'contention', 'version', 'retry storm',
      'thundering herd', 'atomic operation', 'pessimistic locking', 'hot key'
    ],

    rootCause: `
      Optimistic locking is designed for low-contention scenarios where conflicts are rare.
      During the flash sale, extremely high contention on popular items caused the pattern
      to break down:

      1. **High Contention**: 500 concurrent requests targeting the same inventory row
      2. **Version Conflicts**: Only one request per version can succeed
      3. **Immediate Retries**: Failed requests retried instantly, staying synchronized
      4. **Thundering Herd**: All retries hit the database at once, maximizing conflicts
      5. **Amplification**: Original 200 req/sec became 2,400+ attempts/sec from retries

      The conflict rate approaches 100% as concurrency increases because:
      - N concurrent requests, only 1 succeeds per round
      - Conflict rate = (N-1)/N
      - With 500 concurrent, conflict rate = 499/500 = 99.8%

      Immediate retries are the key problem. They keep requests synchronized in "conflict
      waves" instead of spreading them out over time.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Use atomic operations instead of read-check-write',
        code: `// Instead of optimistic locking, use atomic decrement
class InventoryService {
  async decrementStock(sku: string, quantity: number): Promise<boolean> {
    // Atomic conditional decrement - no version needed
    const result = await this.db.inventory.updateOne(
      {
        sku,
        quantity: { $gte: quantity }  // Only if sufficient stock
      },
      {
        $inc: { quantity: -quantity }
      }
    );

    if (result.modifiedCount === 0) {
      // Either SKU doesn't exist or insufficient stock
      const item = await this.db.inventory.findOne({ sku });
      if (!item) throw new ItemNotFoundError();
      if (item.quantity < quantity) throw new InsufficientStockError();
      // If we get here, concurrent update happened - retry
      throw new ConcurrentUpdateError();
    }

    return true;
  }
}

// This is a single atomic operation
// No read-then-write race condition
// Conflicts only happen if stock check fails between attempts`
      },
      {
        lang: 'typescript',
        description: 'Add exponential backoff with jitter to retries',
        code: `// If optimistic locking is required, use proper retry strategy
async function purchaseWithBackoff(sku: string, qty: number): Promise<void> {
  const baseDelay = 50;  // ms
  const maxDelay = 2000; // ms
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await inventoryService.decrementStock(sku, qty);
      return;
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        if (attempt === maxAttempts - 1) {
          throw new Error('Max retries exceeded');
        }

        // Exponential backoff with full jitter
        const exponentialDelay = Math.min(
          maxDelay,
          baseDelay * Math.pow(2, attempt)
        );
        const jitter = Math.random() * exponentialDelay;
        const delay = jitter;

        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

// With jitter, 100 concurrent requests spread across time:
// Instead of 100 hitting at T0, T1, T2...
// They hit at T0+rand(), T1+rand(), T2+rand()...
// Much fewer simultaneous conflicts`
      },
      {
        lang: 'typescript',
        description: 'Use Redis for hot item counters',
        code: `// Offload hot item inventory to Redis
class HybridInventoryService {
  constructor(
    private redis: Redis,
    private db: Database,
    private hotItemThreshold: number = 100  // req/sec
  ) {}

  async decrementStock(sku: string, quantity: number): Promise<void> {
    if (await this.isHotItem(sku)) {
      return this.decrementStockRedis(sku, quantity);
    }
    return this.decrementStockDB(sku, quantity);
  }

  private async decrementStockRedis(sku: string, qty: number): Promise<void> {
    // Redis DECRBY is atomic and single-threaded
    // Handles 100K+ ops/sec without conflicts
    const key = \`inventory:\${sku}\`;

    // Atomic decrement with check
    const script = \`
      local current = redis.call('GET', KEYS[1])
      if current and tonumber(current) >= tonumber(ARGV[1]) then
        return redis.call('DECRBY', KEYS[1], ARGV[1])
      else
        return nil
      end
    \`;

    const result = await this.redis.eval(script, 1, key, qty);

    if (result === null) {
      throw new InsufficientStockError();
    }
  }

  private async isHotItem(sku: string): Promise<boolean> {
    // Track request rates, flag items above threshold
    const rate = await this.requestRateTracker.getRate(sku);
    return rate > this.hotItemThreshold;
  }
}

// Periodically sync Redis back to DB for durability`
      },
      {
        lang: 'typescript',
        description: 'Queue-based reservation for guaranteed ordering',
        code: `// For extreme contention, use a reservation queue
class QueuedInventoryService {
  async reserveStock(sku: string, qty: number): Promise<Reservation> {
    // Create reservation request
    const reservation = await this.db.reservations.create({
      id: generateId(),
      sku,
      quantity: qty,
      status: 'PENDING',
      createdAt: new Date()
    });

    // Add to processing queue
    await this.queue.push({
      type: 'RESERVE',
      reservationId: reservation.id,
      sku,
      quantity: qty
    });

    return reservation;
  }

  // Background worker processes queue
  async processReservation(job: ReservationJob): Promise<void> {
    const { sku, quantity, reservationId } = job;

    // Single worker per SKU = no conflicts
    const item = await this.db.inventory.findOne({ sku });

    if (item.quantity >= quantity) {
      // Fulfill reservation
      await this.db.inventory.updateOne(
        { sku },
        { $inc: { quantity: -quantity } }
      );
      await this.db.reservations.updateOne(
        { id: reservationId },
        { $set: { status: 'CONFIRMED' } }
      );
    } else {
      // Insufficient stock
      await this.db.reservations.updateOne(
        { id: reservationId },
        { $set: { status: 'FAILED', reason: 'OUT_OF_STOCK' } }
      );
    }
  }
}

// Tradeoff: No conflicts, but async confirmation
// Client polls reservation status or gets webhook`
      }
    ],

    prevention: [
      'Use atomic operations (increment/decrement) when possible instead of read-check-write',
      'Add exponential backoff with jitter to retry logic',
      'Offload hot items to Redis or other high-throughput stores',
      'Consider queue-based processing for extremely hot keys',
      'Monitor conflict rates and alert on thresholds',
      'Load test with realistic contention patterns',
      'Identify hot keys before flash sales and pre-provision',
      'Have circuit breakers to prevent retry storms'
    ],

    educationalInsights: [
      'Optimistic locking is for low contention - it degrades badly under high contention',
      'Immediate retries create thundering herd, maximizing conflicts',
      'Conflict rate approaches (N-1)/N as concurrent requests N increases',
      'Atomic operations avoid the read-then-write race condition entirely',
      'Redis single-threaded model turns contention into queuing (predictable)',
      'Jitter spreads retries over time, reducing simultaneous conflicts',
      'The cure (retries) can be worse than the disease (conflicts)',
      'Hot keys need special handling - one size does not fit all'
    ]
  }
};

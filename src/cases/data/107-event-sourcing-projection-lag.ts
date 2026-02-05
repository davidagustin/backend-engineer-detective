import { DetectiveCase } from '../../types';

export const eventSourcingProjectionLag: DetectiveCase = {
  id: 'event-sourcing-projection-lag',
  title: 'The Event Sourcing Projection Lag',
  subtitle: 'Read models falling dangerously behind the write model causing stale data issues',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your event-sourced e-commerce platform shows inventory as available when it's actually
      sold out. Customers place orders for items that don't exist. The order service accepts
      orders based on projections that are minutes behind reality. During a flash sale, the
      problem exploded - you oversold 3,000 items because the inventory projection couldn't
      keep up with the event stream.
    `,
    impact: `
      3,000 orders for items that don't exist. $180K in refunds required. Customer trust
      destroyed. Inventory projection 5 minutes behind during peak load. Legal exposure
      for overselling.
    `,
    timeline: [
      { time: '12:00 PM', event: 'Flash sale begins, 10x normal traffic', type: 'normal' },
      { time: '12:05 PM', event: 'Event processing latency increasing', type: 'warning' },
      { time: '12:15 PM', event: 'Projection lag reaches 2 minutes', type: 'warning' },
      { time: '12:30 PM', event: 'Customers reporting "in stock" items as unavailable', type: 'critical' },
      { time: '12:45 PM', event: 'Projection lag at 5 minutes, massive overselling', type: 'critical' },
      { time: '1:00 PM', event: 'Sale halted, 3,000 orders need cancellation', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Event store recording all events correctly',
      'Write side processing orders successfully',
      'Events are not being lost',
      'Read database is healthy and responsive'
    ],
    broken: [
      'Inventory counts on website lag behind reality',
      'Orders placed for sold-out items',
      'Projection processor falling behind event stream',
      'Dashboard shows data from minutes ago'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Projection Processor Metrics',
      type: 'metrics',
      content: `
\`\`\`
## Event Projection Processing

| Time | Events/sec (In) | Events/sec (Out) | Lag (events) | Lag (time) |
|------|-----------------|------------------|--------------|------------|
| 12:00 PM | 100 | 100 | 0 | 0s |
| 12:15 PM | 500 | 200 | 4,500 | 45s |
| 12:30 PM | 800 | 200 | 18,000 | 120s |
| 12:45 PM | 1000 | 200 | 48,000 | 300s |

Processor bottleneck: Database writes
- Batch size: 1 (processing one event at a time)
- DB write latency: 5ms per event
- Max throughput: 200 events/sec (1000ms / 5ms)
- Incoming rate: 1000 events/sec
- Gap: 800 events/sec accumulating as lag
\`\`\`
      `,
      hint: 'Processor is limited to 200/sec but receiving 1000/sec'
    },
    {
      id: 2,
      title: 'Event Processor Code',
      type: 'code',
      content: `
\`\`\`typescript
// projections/inventory-projection.ts
class InventoryProjection {
  async processEvent(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'ItemAddedToInventory':
        await this.db.inventory.increment(
          event.data.sku,
          event.data.quantity
        );
        break;

      case 'OrderPlaced':
        // Process each line item individually
        for (const item of event.data.items) {
          await this.db.inventory.decrement(item.sku, item.quantity);
        }
        break;

      case 'OrderCancelled':
        for (const item of event.data.items) {
          await this.db.inventory.increment(item.sku, item.quantity);
        }
        break;
    }

    // Update projection position
    await this.db.projectionState.update({
      projectionId: 'inventory',
      lastProcessedPosition: event.position
    });
  }
}

// Consumer loop
while (true) {
  const event = await eventStore.readNext(lastPosition);
  await projection.processEvent(event);  // Process one at a time
  lastPosition = event.position;
}
\`\`\`
      `,
      hint: 'Processing one event at a time with individual DB writes'
    },
    {
      id: 3,
      title: 'Order Service Inventory Check',
      type: 'code',
      content: `
\`\`\`typescript
// order-service/src/services/order.service.ts
class OrderService {
  async placeOrder(cart: Cart): Promise<Order> {
    // Check inventory from READ MODEL (projection)
    for (const item of cart.items) {
      const available = await this.inventoryReadModel.getAvailable(item.sku);

      if (available < item.quantity) {
        throw new InsufficientInventoryError(item.sku);
      }
    }

    // If projection says we have inventory, place order
    const order = await this.orderRepository.create(cart);

    // Emit OrderPlaced event
    await this.eventStore.append('OrderPlaced', {
      orderId: order.id,
      items: cart.items
    });

    return order;
  }
}

// PROBLEM: Read model is 5 minutes behind
// Projection says SKU_A has 100 available
// Reality: SKU_A sold out 3 minutes ago
// Result: Order placed for non-existent inventory
\`\`\`
      `,
      hint: 'Inventory check uses stale projection data'
    },
    {
      id: 4,
      title: 'Event Stream Status',
      type: 'logs',
      content: `
\`\`\`
# Event Store Stream Status

Stream: orders
  Current Position: 1,248,392
  Events Today: 48,000
  Write Latency: 2ms (healthy)

Stream: inventory
  Current Position: 892,103
  Events Today: 12,000
  Write Latency: 2ms (healthy)

# Projection Consumer Status

Projection: inventory-read-model
  Last Processed: 1,200,392
  Current Head: 1,248,392
  Lag: 48,000 events
  Estimated Time Lag: 5 minutes

Projection: order-history-read-model
  Last Processed: 1,245,000
  Current Head: 1,248,392
  Lag: 3,392 events
  Estimated Time Lag: 30 seconds

# inventory projection is critically behind
# order-history projection keeping up (less processing per event)
\`\`\`
      `,
      hint: 'Inventory projection has 48,000 event lag while order-history has only 3,392'
    },
    {
      id: 5,
      title: 'Flash Sale Event Pattern',
      type: 'metrics',
      content: `
\`\`\`
# OrderPlaced events per minute during flash sale

12:00 - 600 events (10 events/sec)
12:05 - 1,200 events (20 events/sec)
12:10 - 3,000 events (50 events/sec)
12:15 - 6,000 events (100 events/sec)
12:20 - 12,000 events (200 events/sec)

# Each OrderPlaced event triggers:
# - 1 order write
# - N inventory decrements (avg 3 items per order)

# Inventory projection work per OrderPlaced:
# - Read event
# - For each item (avg 3):
#   - Read current inventory
#   - Calculate new value
#   - Write updated inventory
# - Update projection position

# Total DB operations per event: ~10
# At 200 events/sec = 2000 DB ops/sec
# Database can handle 1000 ops/sec efficiently
# Result: Backpressure -> lag
\`\`\`
      `,
      hint: 'Each order event triggers multiple DB operations, causing backpressure'
    },
    {
      id: 6,
      title: 'Architect Analysis',
      type: 'testimony',
      content: `
"The event sourcing architecture is sound, but our projection implementation has
serious performance problems:

1. ONE-BY-ONE PROCESSING: We process events individually instead of batching.
   At 5ms per event, we max out at 200 events/sec regardless of incoming rate.

2. NO PARALLELISM: Single-threaded processor. We could partition by SKU and
   process in parallel, but we don't.

3. INDIVIDUAL WRITES: Each line item in an order = separate DB write. A 5-item
   order = 5 writes + position update = 6 DB round-trips.

4. NO STALENESS AWARENESS: Order service trusts the projection blindly. It
   doesn't check projection lag before making inventory decisions.

5. NO RESERVATION SYSTEM: We check-then-act on projected inventory. Between
   check and act, inventory can change. Classic race condition.

The projection lag isn't just a display issue - it's causing material financial
harm through overselling. We need both faster projection AND safeguards for when
lag is unavoidable."
      `
    }
  ],

  solution: {
    diagnosis: 'Single-threaded, one-by-one event processing causing projection lag, combined with blind trust in potentially stale read models',

    keywords: [
      'event sourcing', 'projection', 'read model', 'lag', 'cqrs', 'eventual consistency',
      'batching', 'parallel processing', 'staleness', 'reservation', 'overselling'
    ],

    rootCause: `
      The inventory projection couldn't keep up with the event stream during high traffic
      due to several performance issues:

      1. **Sequential Processing**: Events processed one at a time, limiting throughput
         to database write latency (5ms/event = 200 events/sec max).

      2. **No Batching**: Each event triggered individual DB writes. A batch of 100
         events could be one DB transaction but instead was 100 separate writes.

      3. **No Parallelism**: Single processor thread. Events for different SKUs could
         be processed in parallel but weren't.

      4. **Multiplicative Writes**: Each OrderPlaced event with 3 items = 3 inventory
         decrements + 1 position update = 4 DB operations.

      5. **Blind Trust in Stale Data**: Order service checked inventory against a
         projection that could be arbitrarily behind, with no staleness validation.

      During the flash sale, events came in at 1000/sec but could only be processed
      at 200/sec, creating an ever-growing lag. The order service kept accepting orders
      based on inventory data that was 5 minutes old, leading to massive overselling.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Batch processing for projection throughput',
        code: `// projections/inventory-projection.ts - Batched processing
class InventoryProjection {
  private readonly BATCH_SIZE = 500;
  private readonly BATCH_TIMEOUT_MS = 100;

  async processBatch(events: DomainEvent[]): Promise<void> {
    // Aggregate all inventory changes in memory first
    const inventoryChanges = new Map<string, number>();

    for (const event of events) {
      switch (event.type) {
        case 'ItemAddedToInventory':
          this.addChange(inventoryChanges, event.data.sku, event.data.quantity);
          break;
        case 'OrderPlaced':
          for (const item of event.data.items) {
            this.addChange(inventoryChanges, item.sku, -item.quantity);
          }
          break;
        case 'OrderCancelled':
          for (const item of event.data.items) {
            this.addChange(inventoryChanges, item.sku, item.quantity);
          }
          break;
      }
    }

    // Single transaction for all changes
    await this.db.transaction(async (tx) => {
      // Bulk upsert all inventory changes
      await tx.inventory.bulkAdjust(
        Array.from(inventoryChanges.entries()).map(([sku, delta]) => ({
          sku,
          delta
        }))
      );

      // Update position to last event
      await tx.projectionState.update({
        projectionId: 'inventory',
        lastProcessedPosition: events[events.length - 1].position
      });
    });
  }

  private addChange(changes: Map<string, number>, sku: string, delta: number) {
    changes.set(sku, (changes.get(sku) || 0) + delta);
  }
}

// Batched consumer loop
async function runProjection() {
  const batcher = new EventBatcher(BATCH_SIZE, BATCH_TIMEOUT_MS);

  while (true) {
    const events = await eventStore.readBatch(lastPosition, BATCH_SIZE);
    if (events.length > 0) {
      await projection.processBatch(events);
      lastPosition = events[events.length - 1].position;
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Parallel projection processing by partition',
        code: `// Partition events by SKU for parallel processing
class ParallelInventoryProjection {
  private workers: Map<string, Worker> = new Map();
  private readonly NUM_PARTITIONS = 8;

  async processEvents(events: DomainEvent[]): Promise<void> {
    // Partition events by SKU hash
    const partitions = new Map<number, DomainEvent[]>();

    for (const event of events) {
      const skus = this.extractSkus(event);
      for (const sku of skus) {
        const partition = this.hashToPartition(sku);
        if (!partitions.has(partition)) {
          partitions.set(partition, []);
        }
        partitions.get(partition)!.push(event);
      }
    }

    // Process partitions in parallel
    await Promise.all(
      Array.from(partitions.entries()).map(([partition, partitionEvents]) =>
        this.processPartition(partition, partitionEvents)
      )
    );
  }

  private hashToPartition(sku: string): number {
    let hash = 0;
    for (const char of sku) {
      hash = ((hash << 5) - hash) + char.charCodeAt(0);
    }
    return Math.abs(hash) % this.NUM_PARTITIONS;
  }
}

// Result: 8 parallel processors = 8x throughput
// 200 events/sec * 8 = 1600 events/sec capacity`
      },
      {
        lang: 'typescript',
        description: 'Staleness-aware inventory checking',
        code: `// order-service/src/services/order.service.ts
class OrderService {
  private readonly MAX_ACCEPTABLE_LAG_MS = 30000; // 30 seconds

  async placeOrder(cart: Cart): Promise<Order> {
    // Check projection lag BEFORE using data
    const projectionStatus = await this.projectionStatus.get('inventory');

    if (projectionStatus.lagMs > this.MAX_ACCEPTABLE_LAG_MS) {
      // Projection too stale - don't trust it
      throw new ServiceUnavailableError(
        'Inventory data temporarily unavailable. Please retry.',
        { retryAfterMs: projectionStatus.lagMs }
      );
    }

    // Check inventory with version/timestamp
    for (const item of cart.items) {
      const inventory = await this.inventoryReadModel.getAvailableWithMetadata(item.sku);

      // Double-check staleness at item level
      if (Date.now() - inventory.lastUpdated > this.MAX_ACCEPTABLE_LAG_MS) {
        throw new StaleDataError(\`Inventory for \${item.sku} is stale\`);
      }

      if (inventory.available < item.quantity) {
        throw new InsufficientInventoryError(item.sku);
      }
    }

    // Proceed with order
    return this.createOrder(cart);
  }
}

// Projection status endpoint
app.get('/projection-status/:projectionId', async (req, res) => {
  const status = await projectionStore.getStatus(req.params.projectionId);
  const currentPosition = await eventStore.getCurrentPosition();

  res.json({
    projectionId: status.projectionId,
    lastProcessedPosition: status.lastProcessedPosition,
    currentStreamPosition: currentPosition,
    lagEvents: currentPosition - status.lastProcessedPosition,
    lagMs: estimateLagMs(status.lastProcessedTime),
    healthy: status.lagMs < 30000
  });
});`
      },
      {
        lang: 'typescript',
        description: 'Reservation-based inventory for consistency',
        code: `// Use reservations to prevent overselling during lag
class ReservationBasedOrderService {
  async placeOrder(cart: Cart): Promise<Order> {
    // Instead of check-then-act, use optimistic reservation
    const reservationId = generateId();

    try {
      // Attempt atomic reservation against EVENT STORE (source of truth)
      // This is a command, not a query against stale projection
      const reservation = await this.eventStore.append('InventoryReserved', {
        reservationId,
        items: cart.items,
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minute hold
      });

      // Reservation succeeded = inventory exists in event store
      // Now safe to create order
      const order = await this.createOrder(cart, reservationId);

      // Convert reservation to permanent decrement
      await this.eventStore.append('InventoryCommitted', {
        reservationId,
        orderId: order.id
      });

      return order;

    } catch (error) {
      if (error instanceof InsufficientInventoryError) {
        // Event store rejected - no inventory available
        throw error;
      }
      // Release reservation on other errors
      await this.eventStore.append('InventoryReservationCancelled', {
        reservationId
      });
      throw error;
    }
  }
}

// Event handler validates against event-sourced state
// Not against potentially stale projection`
      }
    ],

    prevention: [
      'Batch event processing to reduce DB round-trips',
      'Partition and parallelize projection processing',
      'Monitor projection lag and alert on thresholds',
      'Implement staleness checks before trusting read models',
      'Use reservations for inventory to prevent check-then-act races',
      'Consider read-your-writes consistency for critical paths',
      'Scale projection processors independently from write side',
      'Have fallback strategies when projections are too stale'
    ],

    educationalInsights: [
      'Event sourcing projections are eventually consistent by design',
      'Projection lag is proportional to processing time * event rate',
      'Batching turns N writes into 1 transaction, massive throughput gain',
      'Partitioned parallel processing multiplies throughput',
      'Blind trust in stale data leads to real-world consequences',
      'Reservations prevent overselling even with projection lag',
      'The projection is for reads - the event store is the source of truth',
      'Lag awareness lets you fail gracefully vs. fail silently'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const cqrsCommandValidation: DetectiveCase = {
  id: 'cqrs-command-validation',
  title: 'The CQRS Command Validation Trap',
  subtitle: 'Commands rejected due to validation against stale read model data',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your CQRS-based inventory management system is rejecting valid commands. Users try to
      transfer inventory between warehouses but get "insufficient inventory" errors even when
      the inventory exists. The read model shows correct quantities, but commands fail validation.
      Warehouse operations are halted as staff can't move products.
    `,
    impact: `
      Warehouse operations paralyzed for 4 hours. 500 shipments delayed. Staff reverting to
      paper-based tracking. Customer orders cannot be fulfilled. $80K/hour in operational losses.
    `,
    timeline: [
      { time: '8:00 AM', event: 'Morning inventory sync batch job completes', type: 'normal' },
      { time: '8:30 AM', event: 'Warehouse staff begin transfers', type: 'normal' },
      { time: '8:35 AM', event: 'First transfer rejections reported', type: 'warning' },
      { time: '9:00 AM', event: '60% of transfer commands failing', type: 'critical' },
      { time: '9:30 AM', event: 'Warehouse operations halted', type: 'critical' },
      { time: '12:00 PM', event: 'Root cause identified, workaround deployed', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Read model shows correct inventory counts',
      'Query API returns expected data',
      'New inventory receipts work correctly',
      'Database is healthy and responsive'
    ],
    broken: [
      'Transfer commands rejected with insufficient inventory',
      'Commands that should succeed are failing validation',
      'Validation passes on query side but fails on command side',
      'Intermittent - some transfers work, most fail'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Transfer Command Handler',
      type: 'code',
      content: `
\`\`\`typescript
// command-handlers/transfer-inventory.handler.ts
class TransferInventoryHandler {
  constructor(
    private inventoryReadModel: InventoryReadModel,
    private eventStore: EventStore
  ) {}

  async handle(command: TransferInventoryCommand): Promise<void> {
    // Validate using read model
    const sourceInventory = await this.inventoryReadModel.getInventory(
      command.sourceWarehouse,
      command.sku
    );

    if (sourceInventory.quantity < command.quantity) {
      throw new InsufficientInventoryError(
        \`Insufficient inventory: have \${sourceInventory.quantity}, need \${command.quantity}\`
      );
    }

    // Validation passed, emit events
    await this.eventStore.append([
      new InventoryTransferredOut(command.sourceWarehouse, command.sku, command.quantity),
      new InventoryTransferredIn(command.targetWarehouse, command.sku, command.quantity)
    ]);
  }
}
\`\`\`
      `,
      hint: 'Command validation uses the read model - what if it is stale?'
    },
    {
      id: 2,
      title: 'Read Model vs Write Model State',
      type: 'logs',
      content: `
\`\`\`
# Query: What does each model think about SKU-12345 in Warehouse-A?

## Read Model (Projection Database):
SELECT quantity FROM inventory_view
WHERE warehouse = 'Warehouse-A' AND sku = 'SKU-12345';
Result: 500 units

## Write Model (Event Store aggregate):
Last event position: 48,293
Events for SKU-12345 in Warehouse-A:
- pos 48,100: InventoryReceived +600
- pos 48,150: InventoryTransferredOut -100
- pos 48,200: InventoryTransferredOut -50
- pos 48,250: InventoryAdjusted -50
Calculated quantity: 400 units

## Read Model Projection Position:
Last processed event: 48,150
Behind by: 143 events

# Read model says 500, write model says 400
# Command validates against read model (500)
# But actual state (400) may not support transfer
\`\`\`
      `,
      hint: 'Read model is 143 events behind - showing 500 when actual is 400'
    },
    {
      id: 3,
      title: 'Rejected Transfer Analysis',
      type: 'logs',
      content: `
\`\`\`
# Transfer command that failed despite appearing valid

Command: Transfer 150 units of SKU-12345 from Warehouse-A to Warehouse-B

User sees (query API): Warehouse-A has 500 units
Command handler sees (same read model): 500 units
Validation: 500 >= 150, PASS

Wait... this should have worked!

# Deeper investigation:
# The transfer DID pass initial validation
# Then failed during event store append

Event Store Error:
"Concurrency violation: aggregate version mismatch.
Expected version: 48,150, Actual version: 48,293"

# The command handler loaded state from read model at position 48,150
# But event store has progressed to 48,293
# 143 events happened between read and write
# Including transfers that depleted inventory

# Retry after reload:
Reloaded from read model: still 500 (projection hasn't caught up)
Same validation passes, same concurrency error
Infinite retry loop until projection catches up
\`\`\`
      `,
      hint: 'Concurrency check catches the staleness, but validation already passed'
    },
    {
      id: 4,
      title: 'CQRS Architecture Diagram',
      type: 'testimony',
      content: `
"Here's our CQRS flow:

COMMAND SIDE:
  User -> Command Handler -> Validates against READ MODEL -> Event Store

QUERY SIDE:
  Event Store -> Projection Processor -> Read Model -> Query API -> User

The problem:
1. User sees inventory via Query API (from Read Model)
2. User submits transfer command
3. Command Handler validates against SAME Read Model
4. But Read Model is behind Event Store
5. Validation passes against stale data
6. Event Store rejects due to version mismatch

We're validating commands against stale read model instead of
current write model state. That's backwards!

The READ model is for QUERIES, not for COMMAND VALIDATION.
Commands should validate against write model / aggregate state."
      `
    },
    {
      id: 5,
      title: 'Projection Processor Lag',
      type: 'metrics',
      content: `
\`\`\`
# Inventory Projection Processor Stats

| Time | Events/sec | Projection Lag | Avg Lag (ms) |
|------|------------|----------------|--------------|
| 8:00 AM | 50 | 0 | 0 |
| 8:15 AM | 200 | 500 | 2,500 |
| 8:30 AM | 500 | 2,000 | 10,000 |
| 9:00 AM | 800 | 8,000 | 40,000 |

Morning rush = high event volume
Projection can process ~200 events/sec
Incoming rate: 500-800 events/sec
Lag grows continuously during peak hours

# Command failure rate correlates with projection lag
| Projection Lag | Command Success Rate |
|----------------|---------------------|
| < 100 events | 99% |
| 100-500 events | 85% |
| 500-2000 events | 60% |
| > 2000 events | 30% |
\`\`\`
      `,
      hint: 'Command success rate drops as projection lag increases'
    },
    {
      id: 6,
      title: 'Correct Aggregate-Based Validation',
      type: 'code',
      content: `
\`\`\`typescript
// How it SHOULD work - validate against aggregate, not read model

class TransferInventoryHandler {
  constructor(
    private aggregateRepository: InventoryAggregateRepository,
    private eventStore: EventStore
  ) {}

  async handle(command: TransferInventoryCommand): Promise<void> {
    // Load aggregate from EVENT STORE (source of truth)
    const aggregate = await this.aggregateRepository.load(
      command.sourceWarehouse,
      command.sku
    );

    // Validate against current aggregate state
    if (aggregate.quantity < command.quantity) {
      throw new InsufficientInventoryError();
    }

    // Apply command and get events
    const events = aggregate.transfer(command.quantity, command.targetWarehouse);

    // Save with optimistic concurrency (version check)
    await this.eventStore.append(events, aggregate.version);
  }
}

// Aggregate repository loads from event store
class InventoryAggregateRepository {
  async load(warehouse: string, sku: string): Promise<InventoryAggregate> {
    const events = await this.eventStore.getEvents(
      \`inventory-\${warehouse}-\${sku}\`
    );
    return InventoryAggregate.rehydrate(events);
  }
}
\`\`\`
      `,
      hint: 'This loads from event store (current truth) not read model (stale)'
    }
  ],

  solution: {
    diagnosis: 'Command validation using stale read model instead of current aggregate state from event store',

    keywords: [
      'cqrs', 'command validation', 'read model', 'aggregate', 'event store',
      'stale data', 'projection lag', 'optimistic concurrency', 'write model'
    ],

    rootCause: `
      The CQRS implementation violated a fundamental principle: commands were validated
      against the read model instead of the write model (aggregate state).

      The flow was:
      1. Command received
      2. Validation loaded inventory from **read model** (projection database)
      3. Read model was N events behind event store
      4. Validation passed because stale data showed sufficient inventory
      5. Event store append failed due to version mismatch (optimistic concurrency)
      6. User saw confusing error despite appearing to have inventory

      The correct flow should be:
      1. Command received
      2. Load aggregate from **event store** (source of truth)
      3. Validate against aggregate's current state
      4. Generate events and append with version check

      The read model exists for **queries only**. It's optimized for reads and may be
      behind. Command validation MUST use the write model / aggregate state which
      represents the current truth.

      The projection lag during morning peak made this much worse - up to 40 seconds
      of stale data causing 70% of commands to fail.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Correct command handler using aggregate',
        code: `// command-handlers/transfer-inventory.handler.ts
class TransferInventoryHandler {
  constructor(
    private aggregateRepository: AggregateRepository,
    private eventStore: EventStore
  ) {}

  async handle(command: TransferInventoryCommand): Promise<void> {
    // Load aggregate from event store - source of truth
    const sourceAggregate = await this.aggregateRepository.load(
      InventoryAggregate,
      \`inventory:\${command.sourceWarehouse}:\${command.sku}\`
    );

    // Validation is INSIDE the aggregate - business logic encapsulated
    // This throws if insufficient inventory
    const events = sourceAggregate.initiateTransfer(
      command.quantity,
      command.targetWarehouse
    );

    // Append with optimistic concurrency
    // If another command modified this aggregate, we get conflict and retry
    await this.eventStore.append(
      sourceAggregate.id,
      events,
      sourceAggregate.version
    );
  }
}

// Aggregate contains validation logic
class InventoryAggregate {
  private quantity: number = 0;
  private reserved: number = 0;

  initiateTransfer(quantity: number, targetWarehouse: string): DomainEvent[] {
    const available = this.quantity - this.reserved;

    if (quantity > available) {
      throw new InsufficientInventoryError(
        \`Cannot transfer \${quantity}, only \${available} available\`
      );
    }

    return [
      new InventoryTransferInitiated({
        quantity,
        targetWarehouse,
        timestamp: new Date()
      })
    ];
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Aggregate repository with caching',
        code: `// repositories/aggregate.repository.ts
class AggregateRepository {
  private cache: LRUCache<string, CachedAggregate>;

  constructor(
    private eventStore: EventStore,
    cacheSize: number = 1000
  ) {
    this.cache = new LRUCache({ max: cacheSize });
  }

  async load<T extends Aggregate>(
    AggregateClass: new () => T,
    aggregateId: string
  ): Promise<T> {
    // Check cache first
    const cached = this.cache.get(aggregateId);

    if (cached) {
      // Load only events after cached version
      const newEvents = await this.eventStore.getEventsSince(
        aggregateId,
        cached.version
      );

      if (newEvents.length === 0) {
        return cached.aggregate as T;
      }

      // Apply new events to cached aggregate
      const aggregate = cached.aggregate.clone();
      for (const event of newEvents) {
        aggregate.apply(event);
      }

      this.cache.set(aggregateId, {
        aggregate,
        version: aggregate.version
      });

      return aggregate as T;
    }

    // Cache miss - load all events
    const events = await this.eventStore.getEvents(aggregateId);
    const aggregate = new AggregateClass();

    for (const event of events) {
      aggregate.apply(event);
    }

    this.cache.set(aggregateId, {
      aggregate,
      version: aggregate.version
    });

    return aggregate;
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Retry handler for concurrency conflicts',
        code: `// command-handlers/retry-handler.ts
class RetryingCommandHandler<T> {
  constructor(
    private handler: CommandHandler<T>,
    private maxRetries: number = 3
  ) {}

  async handle(command: T): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.handler.handle(command);
        return; // Success
      } catch (error) {
        if (error instanceof ConcurrencyConflictError) {
          // Concurrency conflict - retry with fresh aggregate
          lastError = error;

          // Exponential backoff with jitter
          const delay = Math.min(100 * Math.pow(2, attempt), 1000);
          const jitter = Math.random() * delay * 0.1;
          await sleep(delay + jitter);

          continue;
        }

        // Other errors - don't retry
        throw error;
      }
    }

    // All retries exhausted
    throw new RetryExhaustedError(
      \`Command failed after \${this.maxRetries} attempts\`,
      lastError
    );
  }
}

// Usage
const handler = new RetryingCommandHandler(
  new TransferInventoryHandler(repo, store),
  3
);`
      },
      {
        lang: 'typescript',
        description: 'Separate read model for queries only',
        code: `// Clear separation: Read model is ONLY for queries

// Query handler - uses read model (can be stale, that's OK for display)
class GetInventoryHandler {
  constructor(private readModel: InventoryReadModel) {}

  async handle(query: GetInventoryQuery): Promise<InventoryView> {
    // Read model is fine for queries
    // User understands displayed data might be slightly stale
    return this.readModel.getInventory(query.warehouse, query.sku);
  }
}

// Command handler - uses aggregate (must be current)
class TransferInventoryHandler {
  constructor(private aggregateRepo: AggregateRepository) {}

  async handle(command: TransferInventoryCommand): Promise<void> {
    // Aggregate loaded from event store - current truth
    const aggregate = await this.aggregateRepo.load(...);
    // Validation against current state
    // ...
  }
}

// API layer makes the distinction clear
@Controller('/inventory')
class InventoryController {
  @Get('/:warehouse/:sku')  // Query
  async getInventory(...) {
    return this.queryBus.execute(new GetInventoryQuery(...));
  }

  @Post('/transfer')  // Command
  async transfer(...) {
    await this.commandBus.execute(new TransferInventoryCommand(...));
  }
}`
      }
    ],

    prevention: [
      'Never validate commands against read model - use aggregate state',
      'Read models are for queries only, not command validation',
      'Load aggregates from event store for command processing',
      'Implement retry logic for concurrency conflicts',
      'Cache aggregates to reduce event store load',
      'Make the read/write model distinction explicit in code structure',
      'Document that read model may be stale',
      'Monitor projection lag and its impact on user experience'
    ],

    educationalInsights: [
      'CQRS separates read and write models for good reason - don\'t mix them',
      'The event store is the source of truth for commands',
      'Read models are denormalized views optimized for queries',
      'Projection lag means read model shows past state, not current',
      'Aggregates encapsulate business logic and invariants',
      'Optimistic concurrency catches stale writes, but validation should prevent them',
      'The aggregate\'s version ensures commands are applied to current state'
    ]
  }
};

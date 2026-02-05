import type { DetectiveCase } from "../../types";

export const databaseInconsistency: DetectiveCase = {
	id: "database-inconsistency",
	title: "The Database Inconsistency",
	subtitle: "Transaction committed but data shows old values",
	difficulty: "mid",
	category: "database",

	crisis: {
		description:
			"Users complete purchases successfully (confirmation shown), but their inventory doesn't update. Money is deducted, but items don't appear. Data seems to show old values despite successful transactions.",
		impact:
			"Users losing money without receiving items. Chargebacks increasing. Trust in store completely broken. Support team overwhelmed with refund requests.",
		timeline: [
			{ time: "10:00", event: "New store feature deployed with read replicas", type: "normal" },
			{ time: "10:30", event: "First report of purchase not crediting", type: "warning" },
			{ time: "11:00", event: "50+ reports, pattern emerging", type: "warning" },
			{ time: "11:30", event: "Feature rollback attempted but issues persist", type: "critical" },
			{ time: "12:00", event: "Store temporarily disabled", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Purchase transaction completes successfully",
			"Payment is processed correctly",
			"Transaction logs show success",
			"Data is correct when queried directly on primary",
		],
		broken: [
			"Inventory shows pre-purchase state",
			"UI shows old data after purchase",
			"Refreshing doesn't help",
			"Only affected after feature deploy",
		],
	},

	clues: [
		{
			id: 1,
			title: "Database Architecture",
			type: "config",
			content: `\`\`\`
Database Setup:
┌─────────────┐
│   Primary   │ ← Writes go here
│  (us-east)  │
└──────┬──────┘
       │ Async Replication
       ├──────────────────┐
       ▼                  ▼
┌─────────────┐    ┌─────────────┐
│  Replica 1  │    │  Replica 2  │
│  (us-east)  │    │  (us-west)  │
└─────────────┘    └─────────────┘

Replication: Asynchronous
Replica Lag: 50-200ms typical
             Can spike to 1-2s under load
\`\`\``,
		},
		{
			id: 2,
			title: "Store Service Code (After Deploy)",
			type: "code",
			content: `\`\`\`typescript
class StoreService {
  private primaryDb: Database;
  private replicaDb: Database;  // NEW: Added for read scaling

  async purchaseItem(userId: string, itemId: string): Promise<Purchase> {
    // Write to primary
    const purchase = await this.primaryDb.transaction(async (tx) => {
      // Deduct currency
      await tx.query(
        'UPDATE users SET currency = currency - ? WHERE id = ?',
        [item.price, userId]
      );

      // Add item to inventory
      await tx.query(
        'INSERT INTO inventory (user_id, item_id) VALUES (?, ?)',
        [userId, itemId]
      );

      return { success: true, itemId };
    });

    return purchase;
  }

  async getInventory(userId: string): Promise<InventoryItem[]> {
    // Read from replica for better performance (NEW!)
    const items = await this.replicaDb.query(
      'SELECT * FROM inventory WHERE user_id = ?',
      [userId]
    );
    return items;
  }

  async getUserCurrency(userId: string): Promise<number> {
    // Read from replica (NEW!)
    const result = await this.replicaDb.query(
      'SELECT currency FROM users WHERE id = ?',
      [userId]
    );
    return result[0]?.currency || 0;
  }
}
\`\`\``,
			hint: "What happens between the write and the read?",
		},
		{
			id: 3,
			title: "Request Timing Analysis",
			type: "logs",
			content: `\`\`\`
Request timeline for user12345:

10:45:23.100 - POST /store/purchase
10:45:23.250 - Transaction committed on PRIMARY
10:45:23.255 - Purchase response sent: { success: true }

10:45:23.300 - GET /inventory (UI refresh after purchase)
10:45:23.310 - Query executed on REPLICA
10:45:23.315 - Inventory response: [ ] (empty!)

Replica lag at this moment: 180ms
Data committed: 10:45:23.250
Data queried: 10:45:23.310
Replica synced: 10:45:23.430 (lag: 180ms)

The UI queried the replica BEFORE replication completed!
\`\`\``,
		},
		{
			id: 4,
			title: "Replica Lag Metrics",
			type: "metrics",
			content: `\`\`\`
Replica Lag Statistics (last hour):

Replica 1 (same region):
  Average: 45ms
  P95: 180ms
  P99: 450ms
  Max: 1,200ms

Replica 2 (cross-region):
  Average: 120ms
  P95: 350ms
  P99: 800ms
  Max: 2,100ms

UI refresh happens ~50ms after purchase response.
This is LESS than the replica lag.
\`\`\``,
		},
		{
			id: 5,
			title: "Query Distribution",
			type: "metrics",
			content: `\`\`\`
Before deploy:
  Primary: 100% reads, 100% writes

After deploy:
  Primary: 0% reads, 100% writes
  Replica: 100% reads, 0% writes

All reads moved to replica for "scalability"
No consideration for read-your-own-writes
\`\`\``,
		},
		{
			id: 6,
			title: "Developer Notes",
			type: "testimony",
			content: `"We added read replicas to handle the load during the sale event. The primary was getting hammered. It seemed simple - writes go to primary, reads go to replica. We tested it and reads were returning data correctly. We didn't think about the timing issue because in our tests there was no load so replication was instant."`,
		},
	],

	solution: {
		diagnosis: "Read-after-write inconsistency due to async replica lag - reads from replica occur before writes propagate from primary",
		keywords: [
			"replica lag",
			"replication",
			"read-after-write",
			"consistency",
			"async replication",
			"eventual consistency",
			"stale read",
		],
		rootCause: `The feature deploy moved all reads to async replicas, creating a read-after-write consistency problem.

Timeline of the bug:
1. User purchases item (write to primary) at T+0ms
2. Primary commits transaction at T+150ms
3. Server responds "success" at T+155ms
4. Client UI refreshes inventory at T+200ms
5. Inventory query hits replica at T+210ms
6. Replica has NOT received the write yet (lag: ~180ms)
7. Replica returns old data (no new item)
8. Write arrives at replica at T+330ms (180ms lag)
9. User sees empty inventory, thinks purchase failed

The fundamental issue: the application switched from strong consistency (single primary) to eventual consistency (read replicas) without accounting for read-your-own-writes semantics.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Read-your-own-writes: Use primary after recent writes",
				code: `class StoreService {
  private primaryDb: Database;
  private replicaDb: Database;
  private recentWrites: Map<string, number> = new Map();
  private readonly READ_YOUR_WRITES_WINDOW = 2000; // 2 seconds

  async purchaseItem(userId: string, itemId: string): Promise<Purchase> {
    const purchase = await this.primaryDb.transaction(async (tx) => {
      await tx.query(
        'UPDATE users SET currency = currency - ? WHERE id = ?',
        [item.price, userId]
      );
      await tx.query(
        'INSERT INTO inventory (user_id, item_id) VALUES (?, ?)',
        [userId, itemId]
      );
      return { success: true, itemId };
    });

    // Track that this user had a recent write
    this.recentWrites.set(userId, Date.now());

    return purchase;
  }

  private getReadDb(userId: string): Database {
    const lastWrite = this.recentWrites.get(userId) || 0;
    const timeSinceWrite = Date.now() - lastWrite;

    // Use primary if user had a recent write
    if (timeSinceWrite < this.READ_YOUR_WRITES_WINDOW) {
      return this.primaryDb;
    }

    return this.replicaDb;
  }

  async getInventory(userId: string): Promise<InventoryItem[]> {
    const db = this.getReadDb(userId);
    return await db.query(
      'SELECT * FROM inventory WHERE user_id = ?',
      [userId]
    );
  }
}`,
			},
			{
				lang: "typescript",
				description: "Optimistic UI update with server confirmation",
				code: `// Client-side approach
class StoreClient {
  async purchaseItem(itemId: string): Promise<void> {
    // Optimistically add to local inventory
    const item = this.catalog.getItem(itemId);
    this.localInventory.add(item);
    this.renderInventory();

    try {
      const result = await this.api.purchaseItem(itemId);

      if (result.success) {
        // Purchase confirmed - keep optimistic update
        // But also schedule a verification read
        setTimeout(() => this.verifyInventory(), 3000);
      }
    } catch (error) {
      // Purchase failed - rollback optimistic update
      this.localInventory.remove(item);
      this.renderInventory();
      this.showError('Purchase failed');
    }
  }

  private async verifyInventory(): Promise<void> {
    const serverInventory = await this.api.getInventory();
    // Reconcile local with server
    this.localInventory.sync(serverInventory);
    this.renderInventory();
  }
}`,
			},
			{
				lang: "typescript",
				description: "Return updated data in the write response",
				code: `class StoreService {
  async purchaseItem(userId: string, itemId: string): Promise<PurchaseResponse> {
    const purchase = await this.primaryDb.transaction(async (tx) => {
      await tx.query(
        'UPDATE users SET currency = currency - ? WHERE id = ?',
        [item.price, userId]
      );
      await tx.query(
        'INSERT INTO inventory (user_id, item_id) VALUES (?, ?)',
        [userId, itemId]
      );

      // Read updated data IN THE SAME TRANSACTION
      const newCurrency = await tx.query(
        'SELECT currency FROM users WHERE id = ?',
        [userId]
      );
      const newInventory = await tx.query(
        'SELECT * FROM inventory WHERE user_id = ?',
        [userId]
      );

      return {
        success: true,
        itemId,
        // Return the new state so client doesn't need to re-fetch
        newState: {
          currency: newCurrency[0].currency,
          inventory: newInventory
        }
      };
    });

    return purchase;
  }
}`,
			},
		],
		prevention: [
			"Understand read-after-write consistency requirements before using replicas",
			"Track recent writes and route those users to primary",
			"Return updated state in write responses to avoid read-after-write",
			"Use synchronous replication for critical data (with performance trade-off)",
			"Test with artificial replica lag in staging",
			"Monitor replica lag and alert on high values",
		],
		educationalInsights: [
			"Async replication trades consistency for performance/availability",
			"Read-your-own-writes is a critical consistency pattern for user-facing apps",
			"Testing without load often misses timing-dependent bugs",
			"'Eventual' in eventual consistency can be milliseconds or minutes",
			"The CAP theorem has real, practical consequences",
			"Optimistic UI updates can mask backend timing issues",
		],
	},
};

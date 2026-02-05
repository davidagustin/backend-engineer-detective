import type { DetectiveCase } from "../../types";

export const mongodbWriteConcern: DetectiveCase = {
	id: "mongodb-write-concern",
	title: "The MongoDB Write Concern Mystery",
	subtitle: "Data vanishes after successful writes during replica failover",
	difficulty: "mid",
	category: "database",

	crisis: {
		description: `
			Your e-commerce platform experienced a brief database failover during
			routine maintenance. After the 30-second failover, users are reporting
			that orders they placed just before the maintenance are missing. Your
			logs show all those orders returned success (HTTP 201) to the users.
		`,
		impact: `
			~200 orders lost during the 2-minute window around failover. Customers
			charged but no order records exist. Refund processing required.
			Customer trust damaged.
		`,
		timeline: [
			{ time: "2:00 AM", event: "Maintenance window begins", type: "normal" },
			{ time: "2:01 AM", event: "Primary replica stepped down for maintenance", type: "warning" },
			{ time: "2:01:15", event: "Secondary promoted to primary", type: "normal" },
			{ time: "2:01:30", event: "Application reconnected to new primary", type: "normal" },
			{ time: "2:02 AM", event: "Maintenance complete, old primary rejoins as secondary", type: "normal" },
			{ time: "8:00 AM", event: "Customer reports missing order placed at 2:01 AM", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Database is healthy and operational",
			"New orders are being created correctly",
			"All existing historical orders are intact",
			"Application logs show successful order creation",
			"Payment gateway confirms charges processed",
		],
		broken: [
			"~200 orders from 2:00-2:02 AM window are missing",
			"Order IDs exist in application logs but not in database",
			"Customer receipts exist but order records don't",
			"Payment records don't have matching order documents",
		],
	},

	clues: [
		{
			id: 1,
			title: "Application Logs During Failover",
			type: "logs",
			content: `\`\`\`
2:00:45 [INFO] OrderService: Creating order for user_id=12345
2:00:45 [INFO] OrderService: Order created successfully, order_id=ORD-98765
2:00:45 [INFO] PaymentService: Processing payment for order_id=ORD-98765
2:00:46 [INFO] PaymentService: Payment successful, charge_id=ch_xyz123

2:01:05 [INFO] OrderService: Creating order for user_id=23456
2:01:05 [INFO] OrderService: Order created successfully, order_id=ORD-98766
2:01:06 [INFO] PaymentService: Payment successful, charge_id=ch_xyz124

2:01:30 [WARN] MongoDB: Topology changed - primary stepped down
2:01:31 [INFO] MongoDB: New primary elected, reconnecting...
\`\`\``,
			hint: "Orders were 'successful' but created just before failover...",
		},
		{
			id: 2,
			title: "MongoDB Connection Configuration",
			type: "code",
			content: `\`\`\`javascript
// config/database.js
const mongoClient = new MongoClient(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 100,
    serverSelectionTimeoutMS: 5000,
    // Write concern not specified - uses default
});

// Order creation code
async function createOrder(orderData) {
    const result = await db.collection('orders').insertOne(orderData);
    // Returns immediately after primary acknowledges
    return { success: true, orderId: result.insertedId };
}
\`\`\``,
			hint: "What happens if the primary fails before replicating to secondaries?",
		},
		{
			id: 3,
			title: "Replica Set Status During Failover",
			type: "metrics",
			content: `\`\`\`javascript
// rs.status() at 2:01:10 AM (during failover)
{
    "set": "rs0",
    "members": [
        {
            "name": "mongo-1:27017",
            "state": 1,  // PRIMARY (stepping down)
            "optime": { "ts": Timestamp(1699401665, 42) },
            "health": 1
        },
        {
            "name": "mongo-2:27017",
            "state": 2,  // SECONDARY
            "optime": { "ts": Timestamp(1699401663, 38) },  // 2 seconds behind!
            "health": 1
        },
        {
            "name": "mongo-3:27017",
            "state": 2,  // SECONDARY
            "optime": { "ts": Timestamp(1699401663, 35) },  // 2 seconds behind!
            "health": 1
        }
    ]
}
\`\`\``,
			hint: "Secondaries are 2 seconds behind the primary's oplog...",
		},
		{
			id: 4,
			title: "MongoDB Write Concern Documentation",
			type: "config",
			content: `\`\`\`
Write Concern Levels:
---------------------
w: 0     - Fire and forget (no acknowledgment)
w: 1     - Acknowledged by primary only (DEFAULT)
w: 2     - Acknowledged by primary + 1 secondary
w: "majority" - Acknowledged by majority of voting members

With w:1 (default):
- Write succeeds when PRIMARY acknowledges
- Data may not yet be replicated to secondaries
- If primary fails before replication, DATA IS LOST

With w:"majority":
- Write succeeds when MAJORITY acknowledges
- Data is guaranteed to survive failover
- Slightly higher latency (~5-10ms more)
\`\`\``,
			hint: "The default write concern doesn't guarantee durability...",
		},
		{
			id: 5,
			title: "DBA Investigation",
			type: "testimony",
			content: `"I checked the oplog on the old primary (now secondary). The missing
orders ARE in its oplog! They were written to the primary at 2:01:05
but the primary stepped down at 2:01:15 before they could replicate.

When mongo-2 became the new primary, it had an older oplog position.
The old primary had to 'roll back' those operations when it rejoined
as a secondary to match the new primary's timeline.

The rolled-back documents are in a rollback file, but they weren't
supposed to exist according to the new primary's history."`,
		},
		{
			id: 6,
			title: "Replica Lag Monitoring",
			type: "metrics",
			content: `\`\`\`
# Replica lag over 24 hours (before incident)

Time        Primary->Secondary Lag
00:00       0.5s
04:00       0.3s
08:00       1.2s
12:00       0.8s
16:00       1.5s
20:00       0.6s
02:00       2.1s  <- Maintenance window, under load

# Note: With w:1, any write during these lag windows
# would be lost if primary failed immediately after.
\`\`\``,
			hint: "Writes during high-lag periods are most at risk...",
		},
	],

	solution: {
		diagnosis: "Write concern w:1 caused data loss during primary failover",

		keywords: [
			"write concern",
			"w:1",
			"majority",
			"replica set",
			"failover",
			"replication lag",
			"rollback",
			"durability",
			"acknowledged",
		],

		rootCause: `
			The MongoDB connection was using the default write concern of w:1, which only
			requires acknowledgment from the primary before returning success.

			Timeline of data loss:
			1. 2:01:05 - Order written to primary, acknowledged, returned "success"
			2. 2:01:05-2:01:15 - Primary queues write for replication (2 second lag)
			3. 2:01:15 - Primary stepped down BEFORE replicating to secondaries
			4. 2:01:16 - mongo-2 elected as new primary (missing recent writes)
			5. 2:01:30 - Old primary rejoins, ROLLS BACK unreplicated operations

			The application received "success" because the primary acknowledged the write.
			But that acknowledgment didn't guarantee the data was replicated. When the
			primary failed, the unreplicated data was lost.

			With write concern "majority", the write would have waited for replication
			before acknowledging, preventing this scenario.
		`,

		codeExamples: [
			{
				lang: "javascript",
				description: "Fix: Configure write concern at connection level",
				code: `// config/database.js
const mongoClient = new MongoClient(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 100,
    serverSelectionTimeoutMS: 5000,

    // Add write concern for durability
    writeConcern: {
        w: 'majority',      // Wait for majority acknowledgment
        j: true,            // Wait for journal commit
        wtimeout: 5000      // Timeout after 5 seconds
    }
});`,
			},
			{
				lang: "javascript",
				description: "Critical operations with explicit write concern",
				code: `// For critical operations, specify write concern explicitly
async function createOrder(orderData) {
    const result = await db.collection('orders').insertOne(
        orderData,
        {
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 10000
            }
        }
    );

    // Only return success after majority acknowledgment
    return { success: true, orderId: result.insertedId };
}

// For less critical operations, can use w:1 for speed
async function updateUserLastSeen(userId) {
    await db.collection('users').updateOne(
        { _id: userId },
        { $set: { lastSeen: new Date() } },
        { writeConcern: { w: 1 } }  // OK to lose this
    );
}`,
			},
			{
				lang: "javascript",
				description: "Transaction pattern for critical multi-document operations",
				code: `// Use transactions for atomic multi-document operations
async function createOrderWithPayment(orderData, paymentData) {
    const session = mongoClient.startSession();

    try {
        session.startTransaction({
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority', j: true }
        });

        const order = await db.collection('orders')
            .insertOne(orderData, { session });

        const payment = await db.collection('payments')
            .insertOne({ ...paymentData, orderId: order.insertedId }, { session });

        await session.commitTransaction();

        return { success: true, orderId: order.insertedId };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}`,
			},
		],

		prevention: [
			"Use w:'majority' for all critical write operations",
			"Configure default write concern at connection level",
			"Monitor replication lag and alert when exceeding thresholds",
			"Test failover scenarios with realistic write loads",
			"Process payments AFTER confirming order with majority write",
			"Implement idempotency keys to safely retry failed writes",
		],

		educationalInsights: [
			"Default write concern (w:1) prioritizes speed over durability",
			"Write 'success' only means primary received it, not that it's safe",
			"Replication lag determines the 'danger window' for data loss",
			"Rolled-back documents are saved but require manual recovery",
			"Journal (j:true) adds disk durability on top of replication",
			"The CAP theorem tradeoff: w:majority increases latency but ensures consistency",
		],
	},
};

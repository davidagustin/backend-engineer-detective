import type { DetectiveCase } from "../../types";

export const postgresqlLockContention: DetectiveCase = {
	id: "postgresql-lock-contention",
	title: "The PostgreSQL Lock Labyrinth",
	subtitle: "Deadlocks plague concurrent order processing",
	difficulty: "mid",
	category: "database",

	crisis: {
		description: `
			Your order processing system is experiencing frequent deadlocks.
			Transactions are being automatically rolled back by PostgreSQL with
			"deadlock detected" errors. The issue worsens during peak hours when
			multiple orders are processed simultaneously.
		`,
		impact: `
			5% of orders failing with deadlock errors. Retry logic causing
			duplicate charge attempts. Customer complaints about failed orders.
			Processing throughput degraded by 40% during peak hours.
		`,
		timeline: [
			{ time: "9:00 AM", event: "Peak shopping hours begin", type: "normal" },
			{ time: "9:15 AM", event: "First deadlock errors in logs", type: "warning" },
			{ time: "9:30 AM", event: "Deadlock rate: 20/minute", type: "warning" },
			{ time: "10:00 AM", event: "Deadlock rate: 50/minute", type: "critical" },
			{ time: "10:30 AM", event: "Payment provider complaining about retries", type: "critical" },
			{ time: "11:00 AM", event: "Customer support flooded with order failures", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Individual orders process correctly when alone",
			"Database health checks pass",
			"All tables accessible for reads",
			"Background jobs running fine",
			"Off-peak hours have no issues",
		],
		broken: [
			"Concurrent orders deadlock frequently",
			"Same order can fail then succeed on retry",
			"Two users ordering same product often deadlock",
			"Inventory updates causing most deadlocks",
			"Lock wait timeouts increasing",
		],
	},

	clues: [
		{
			id: 1,
			title: "PostgreSQL Deadlock Log",
			type: "logs",
			content: `\`\`\`
ERROR:  deadlock detected
DETAIL:  Process 12345 waits for ShareLock on transaction 9876543;
         blocked by process 12346.
         Process 12346 waits for ShareLock on transaction 9876544;
         blocked by process 12345.
HINT:   See server log for query details.
CONTEXT: while updating tuple (42,15) in relation "inventory"

LOG:  process 12345: UPDATE inventory SET quantity = quantity - 1
      WHERE product_id = 'PROD-001'
LOG:  process 12346: UPDATE inventory SET quantity = quantity - 1
      WHERE product_id = 'PROD-002'
LOG:  process 12345: UPDATE inventory SET quantity = quantity - 1
      WHERE product_id = 'PROD-002' (waiting)
LOG:  process 12346: UPDATE inventory SET quantity = quantity - 1
      WHERE product_id = 'PROD-001' (waiting)
\`\`\``,
			hint: "Process A holds PROD-001, wants PROD-002; Process B holds PROD-002, wants PROD-001...",
		},
		{
			id: 2,
			title: "Order Processing Code",
			type: "code",
			content: `\`\`\`typescript
async function processOrder(order: Order): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Create order record
        await client.query(
            'INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)',
            [order.id, order.userId, order.total]
        );

        // Decrement inventory for each item
        for (const item of order.items) {
            await client.query(
                'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
                [item.quantity, item.productId]
            );
        }

        // Process payment
        await paymentService.charge(order.userId, order.total);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
\`\`\``,
			hint: "What order are inventory rows being updated in?",
		},
		{
			id: 3,
			title: "Example Concurrent Orders",
			type: "logs",
			content: `\`\`\`
Order A (user 1): items = [PROD-001, PROD-002, PROD-003]
Order B (user 2): items = [PROD-003, PROD-002, PROD-001]

Execution Timeline:
------------------
Time  | Order A                    | Order B
------+----------------------------+----------------------------
T1    | BEGIN                      | BEGIN
T2    | INSERT orders              | INSERT orders
T3    | UPDATE inventory PROD-001  | UPDATE inventory PROD-003
      | (acquires lock)            | (acquires lock)
T4    | UPDATE inventory PROD-002  | UPDATE inventory PROD-002
      | (acquires lock)            | (WAITING for A's lock)
T5    | UPDATE inventory PROD-003  | ...
      | (WAITING for B's lock)     | ...
T6    | DEADLOCK DETECTED          |

Both transactions are waiting for each other = DEADLOCK
\`\`\``,
			hint: "The items are processed in different orders...",
		},
		{
			id: 4,
			title: "Lock Monitoring Query",
			type: "metrics",
			content: `\`\`\`sql
-- Current lock waits
SELECT
    blocked.pid AS blocked_pid,
    blocked_activity.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked
JOIN pg_catalog.pg_stat_activity blocked_activity
    ON blocked.pid = blocked_activity.pid
JOIN pg_catalog.pg_locks blocking
    ON blocked.locktype = blocking.locktype
    AND blocked.relation = blocking.relation
    AND blocked.pid != blocking.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
    ON blocking.pid = blocking_activity.pid
WHERE NOT blocked.granted;

 blocked_pid |              blocked_query               | blocking_pid |             blocking_query
-------------+------------------------------------------+--------------+------------------------------------------
       12345 | UPDATE inventory ... WHERE product_id=$1 |        12346 | UPDATE inventory ... WHERE product_id=$1
       12346 | UPDATE inventory ... WHERE product_id=$1 |        12345 | UPDATE inventory ... WHERE product_id=$1

-- Deadlock cycle detected!
\`\`\``,
			hint: "Two processes each blocking the other...",
		},
		{
			id: 5,
			title: "PostgreSQL Lock Mechanics",
			type: "config",
			content: `\`\`\`
PostgreSQL Row-Level Locking:
=============================

UPDATE acquires an exclusive lock on the row:
- Only one transaction can hold exclusive lock
- Other transactions must wait

Deadlock occurs when:
1. Transaction A holds lock on row X, wants lock on row Y
2. Transaction B holds lock on row Y, wants lock on row X
3. Neither can proceed → deadlock

PostgreSQL deadlock detection:
- Checks for cycles every deadlock_timeout (default 1s)
- Aborts one transaction to break the cycle
- Victim transaction receives "deadlock detected" error

Prevention strategy:
- Always acquire locks in the same order
- If all transactions lock rows in order (X, Y, Z)
- No cycles can form
\`\`\``,
			hint: "The key is consistent lock ordering...",
		},
		{
			id: 6,
			title: "DBA Analysis",
			type: "testimony",
			content: `"I analyzed the deadlock patterns. They all follow the same scenario:

Order A has items: [PROD-001, PROD-002]
Order B has items: [PROD-002, PROD-001]

Order A locks PROD-001 first, then tries PROD-002
Order B locks PROD-002 first, then tries PROD-001

The items come from the frontend in whatever order the user added
them to their cart. The code just iterates through the array without
sorting, so different orders acquire locks in different sequences.

Classic deadlock scenario. The fix is simple: sort the items by
product_id before updating inventory. Then every transaction acquires
locks in the same order, making deadlocks impossible."`,
		},
	],

	solution: {
		diagnosis: "Inconsistent lock acquisition order causing deadlock cycles",

		keywords: [
			"deadlock",
			"lock",
			"lock order",
			"row lock",
			"exclusive lock",
			"concurrent",
			"transaction",
			"inventory",
			"contention",
		],

		rootCause: `
			The order processing code updates inventory rows in the order items appear
			in the order (user's cart order). Different orders contain the same products
			in different sequences, causing transactions to acquire row locks in
			inconsistent orders.

			Deadlock formation:
			1. Transaction A: locks PROD-001, then tries to lock PROD-002
			2. Transaction B: locks PROD-002, then tries to lock PROD-001
			3. A holds what B needs; B holds what A needs = deadlock

			PostgreSQL detects the cycle and aborts one transaction after
			deadlock_timeout (default 1 second). The victim transaction fails
			with "deadlock detected" error.

			The solution is to always acquire locks in a consistent, deterministic
			order. By sorting items by product_id before updating inventory, all
			transactions lock rows in the same sequence. This makes cycles impossible:
			- Transaction A: locks PROD-001, then PROD-002
			- Transaction B: locks PROD-001 (waits), then PROD-002
			- B simply waits for A to finish, no deadlock
		`,

		codeExamples: [
			{
				lang: "typescript",
				description: "Fix: Sort items before acquiring locks",
				code: `async function processOrder(order: Order): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Create order record
        await client.query(
            'INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)',
            [order.id, order.userId, order.total]
        );

        // CRITICAL: Sort items by product_id to ensure consistent lock order
        const sortedItems = [...order.items].sort(
            (a, b) => a.productId.localeCompare(b.productId)
        );

        // Now all transactions acquire locks in the same order
        for (const item of sortedItems) {
            await client.query(
                'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
                [item.quantity, item.productId]
            );
        }

        // Process payment
        await paymentService.charge(order.userId, order.total);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}`,
			},
			{
				lang: "sql",
				description: "Alternative: Use SELECT FOR UPDATE with NOWAIT",
				code: `-- Lock all required rows at transaction start
-- Fail fast if any row is locked instead of waiting for deadlock

BEGIN;

-- Attempt to lock all inventory rows upfront
-- NOWAIT throws error immediately if row is locked
SELECT * FROM inventory
WHERE product_id = ANY($1::text[])
ORDER BY product_id  -- Consistent order
FOR UPDATE NOWAIT;

-- If we get here, we have all locks
-- Safe to proceed with updates
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = $2;
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = $3;

COMMIT;

-- Application handles NOWAIT failure with retry after backoff`,
			},
			{
				lang: "typescript",
				description: "Retry with exponential backoff for transient failures",
				code: `async function processOrderWithRetry(
    order: Order,
    maxRetries = 3
): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await processOrder(order);
        } catch (error: any) {
            lastError = error;

            // Check if it's a retryable error
            const isDeadlock = error.code === '40P01';  // deadlock_detected
            const isLockTimeout = error.code === '55P03';  // lock_not_available
            const isSerializationFailure = error.code === '40001';

            if (isDeadlock || isLockTimeout || isSerializationFailure) {
                // Exponential backoff: 100ms, 200ms, 400ms...
                const delay = Math.min(100 * Math.pow(2, attempt), 5000);
                // Add jitter to prevent thundering herd
                const jitter = Math.random() * delay * 0.1;

                console.log(\`Retry \${attempt + 1}/\${maxRetries} after \${delay}ms\`);
                await sleep(delay + jitter);
                continue;
            }

            // Non-retryable error
            throw error;
        }
    }

    throw lastError;
}`,
			},
		],

		prevention: [
			"Always acquire locks in a consistent, deterministic order",
			"Sort entities by primary key before batch operations",
			"Use SELECT FOR UPDATE with ORDER BY for explicit locking",
			"Consider NOWAIT or SKIP LOCKED for lock-free alternatives",
			"Implement retry logic with exponential backoff for deadlocks",
			"Monitor pg_stat_activity for lock contention patterns",
		],

		educationalInsights: [
			"Deadlocks occur when transactions form a circular wait for locks",
			"PostgreSQL detects deadlocks automatically and aborts one victim",
			"Consistent lock ordering prevents deadlock cycles entirely",
			"NOWAIT fails fast instead of waiting indefinitely for locks",
			"SKIP LOCKED enables lock-free queue processing patterns",
			"Row-level locking is generally better than table locks for concurrency",
		],
	},
};

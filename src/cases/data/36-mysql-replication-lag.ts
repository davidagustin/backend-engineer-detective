import type { DetectiveCase } from "../../types";

export const mysqlReplicationLag: DetectiveCase = {
	id: "mysql-replication-lag",
	title: "The Replication Lag Spiral",
	subtitle: "Read replica falls hopelessly behind despite adequate resources",
	difficulty: "mid",
	category: "database",

	crisis: {
		description: `
			Your MySQL read replica is falling further and further behind the primary.
			It started at 30 seconds of lag and is now at 45 minutes and climbing.
			The replica has MORE resources than the primary (bigger machine), yet it
			can't keep up. Reads from the replica are returning stale data.
		`,
		impact: `
			Analytics dashboards showing data from 45 minutes ago. Customer service
			can't see recent orders. Reporting jobs failing due to data inconsistency.
			Read traffic can't be offloaded to replica.
		`,
		timeline: [
			{ time: "9:00 AM", event: "Batch job started: monthly report generation", type: "normal" },
			{ time: "9:05 AM", event: "Replication lag appears: 30 seconds", type: "warning" },
			{ time: "9:30 AM", event: "Lag increased to 5 minutes", type: "warning" },
			{ time: "10:00 AM", event: "Lag at 15 minutes, alerts firing", type: "critical" },
			{ time: "11:00 AM", event: "Lag at 45 minutes and still growing", type: "critical" },
			{ time: "11:30 AM", event: "Primary performance normal, replica struggling", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Primary database performing normally",
			"All writes succeeding on primary",
			"Replica connected and receiving binlog events",
			"Replica CPU and memory look underutilized",
			"Network between primary and replica is fine",
		],
		broken: [
			"Replica lag growing continuously",
			"SHOW SLAVE STATUS shows Seconds_Behind_Master increasing",
			"Replica CPU at 100% on ONE core only",
			"Replica disk I/O is lower than primary",
			"Same queries slower on replica than primary",
		],
	},

	clues: [
		{
			id: 1,
			title: "Replica Status",
			type: "logs",
			content: `\`\`\`sql
SHOW SLAVE STATUS\\G

Slave_IO_State: Waiting for master to send event
Slave_IO_Running: Yes
Slave_SQL_Running: Yes
Seconds_Behind_Master: 2734
Relay_Log_Space: 15234567890

Last_SQL_Error:
Exec_Master_Log_Pos: 1234567890
Read_Master_Log_Pos: 9876543210

-- Note: Read position is 8.6GB ahead of Exec position
-- The replica has RECEIVED the logs but hasn't APPLIED them
\`\`\``,
			hint: "IO thread is caught up, but SQL thread is behind...",
		},
		{
			id: 2,
			title: "Running Queries on Primary",
			type: "logs",
			content: `\`\`\`sql
-- Primary: SHOW PROCESSLIST (during batch job)
+----+------+-----------+--------+---------+------+
| Id | User | db        | Time   | State   | Info |
+----+------+-----------+--------+---------+------+
| 45 | batch| analytics | 1847   | updating| UPDATE orders SET report_flag = 1 WHERE... |
| 46 | app  | production| 0      | Sleep   | NULL |
| 47 | app  | production| 0      | query   | SELECT * FROM users WHERE... |
+----+------+-----------+--------+---------+------+

-- The batch UPDATE has been running for 30+ minutes
-- It's updating 5 million rows in a single transaction
\`\`\``,
			hint: "One query has been running for a very long time...",
		},
		{
			id: 3,
			title: "Batch Job Code",
			type: "code",
			content: `\`\`\`python
# Monthly report generation job
def generate_monthly_report():
    # Flag all orders from last month for reporting
    db.execute("""
        UPDATE orders
        SET report_flag = 1,
            report_generated_at = NOW()
        WHERE order_date >= %s
        AND order_date < %s
        AND report_flag = 0
    """, (month_start, month_end))

    # This UPDATE touches ~5 million rows
    # Takes 30-45 minutes on primary

    # Then read flagged orders for report...
    orders = db.execute("""
        SELECT * FROM orders WHERE report_flag = 1
    """)
\`\`\``,
			hint: "Single transaction updating millions of rows...",
		},
		{
			id: 4,
			title: "MySQL Replication Architecture",
			type: "config",
			content: `\`\`\`
MySQL Replication Flow:
=======================
1. Primary executes transaction (can parallelize across cores)
2. Primary writes to binlog (one transaction = one binlog event)
3. Replica IO thread copies binlog (fast, parallel with SQL thread)
4. Replica SQL thread replays transactions (SINGLE THREADED by default!)

The Problem:
- Primary can run the UPDATE using multiple cores (parallel workers)
- Primary executes in 30 minutes with parallelization
- Replica SQL thread must replay SERIALLY on ONE core
- Replica takes LONGER than primary for the same transaction

Replica Settings:
slave_parallel_workers: 0 (single-threaded replay)
slave_parallel_type: DATABASE (if workers > 0)
\`\`\``,
			hint: "Single-threaded replication is the bottleneck...",
		},
		{
			id: 5,
			title: "System Resource Comparison",
			type: "metrics",
			content: `\`\`\`
PRIMARY (during batch job):
  CPU: 45% (spread across 16 cores)
  Disk I/O: 2,500 IOPS
  Memory: 60% used
  Queries/sec: 1,200

REPLICA (falling behind):
  CPU: 12% overall, but ONE core at 100%
  Disk I/O: 800 IOPS (waiting for SQL thread)
  Memory: 40% used
  Queries/sec: 200 (slow replay)

The replica has 32 cores, but only 1 is being used!
\`\`\``,
			hint: "32 cores but only 1 is maxed out...",
		},
		{
			id: 6,
			title: "DBA Investigation",
			type: "testimony",
			content: `"I've seen this before. The batch job runs a single massive UPDATE
statement that takes 30 minutes. On the primary, MySQL can use InnoDB's
parallel features internally for the row updates.

But replication works differently. The ENTIRE transaction gets written
to the binlog as ONE event. The replica's SQL thread is single-threaded
by default, so it has to replay that entire 30-minute transaction
serially on one CPU core.

During those 30 minutes, ALL other binlog events queue up behind it.
The replica can't apply any new changes until that monster transaction
completes. And since replication is serial, it actually takes LONGER
on the replica than on the primary."`,
		},
	],

	solution: {
		diagnosis: "Single-threaded replication blocked by long-running transaction",

		keywords: [
			"replication lag",
			"slave lag",
			"single threaded",
			"parallel replication",
			"long transaction",
			"batch update",
			"binlog",
			"SQL thread",
		],

		rootCause: `
			The batch job runs a single UPDATE statement that modifies 5 million rows in
			one transaction. While the primary can parallelize row operations internally,
			MySQL replication has a critical limitation:

			1. The entire transaction is written to binlog as ONE event
			2. Replica SQL thread processes events serially (single-threaded)
			3. Large transactions BLOCK all subsequent replication
			4. Replica can't apply ANY changes until the blocking transaction completes

			The time breakdown:
			- Primary: 30 minutes (parallel internal processing)
			- Replica: 45+ minutes (single-threaded, plus accumulated queue)

			While the massive UPDATE replays, 45 minutes of normal traffic accumulates
			in the relay log. The replica falls further behind as it processes this
			backlog, creating a spiral effect.

			This is a fundamental MySQL replication architecture issue that requires
			either enabling parallel replication or restructuring the batch job.
		`,

		codeExamples: [
			{
				lang: "sql",
				description: "Enable parallel replication on replica",
				code: `-- On the replica, enable parallel workers
-- Requires MySQL 5.7+ with LOGICAL_CLOCK

STOP SLAVE;

SET GLOBAL slave_parallel_workers = 8;
SET GLOBAL slave_parallel_type = 'LOGICAL_CLOCK';

-- For MySQL 8.0+
SET GLOBAL replica_parallel_workers = 8;
SET GLOBAL replica_parallel_type = 'LOGICAL_CLOCK';

START SLAVE;

-- Note: This helps with concurrent transactions but
-- a single huge transaction still blocks others`,
			},
			{
				lang: "python",
				description: "Fix batch job: Process in smaller chunks",
				code: `# Break the massive UPDATE into smaller transactions
def generate_monthly_report_chunked():
    batch_size = 10000
    offset = 0

    while True:
        # Get chunk of order IDs to update
        orders = db.execute("""
            SELECT id FROM orders
            WHERE order_date >= %s
            AND order_date < %s
            AND report_flag = 0
            ORDER BY id
            LIMIT %s OFFSET %s
        """, (month_start, month_end, batch_size, offset))

        if not orders:
            break

        ids = [o['id'] for o in orders]

        # Update in small batches - each is a separate transaction
        db.execute("""
            UPDATE orders
            SET report_flag = 1,
                report_generated_at = NOW()
            WHERE id IN %s
        """, (tuple(ids),))

        db.commit()  # Commit each batch separately

        # Small sleep to let replica catch up
        time.sleep(0.1)
        offset += batch_size

        logger.info(f"Processed {offset} orders...")`,
			},
			{
				lang: "sql",
				description: "Monitor replication lag proactively",
				code: `-- Create monitoring query for lag detection
SELECT
    @@hostname as replica,
    Seconds_Behind_Master as lag_seconds,
    CASE
        WHEN Seconds_Behind_Master > 60 THEN 'CRITICAL'
        WHEN Seconds_Behind_Master > 10 THEN 'WARNING'
        ELSE 'OK'
    END as status,
    Read_Master_Log_Pos - Exec_Master_Log_Pos as relay_queue_bytes
FROM performance_schema.replication_connection_status rcs
JOIN performance_schema.replication_applier_status_by_worker rasw
  ON rcs.channel_name = rasw.channel_name;

-- Alert when long-running transactions detected
SELECT
    trx_id,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_sec,
    trx_query
FROM information_schema.innodb_trx
WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 300;`,
			},
		],

		prevention: [
			"Never run single transactions that update millions of rows",
			"Break batch operations into chunks of 10K-50K rows",
			"Enable parallel replication (slave_parallel_workers > 0)",
			"Monitor long-running transactions and alert when > 5 minutes",
			"Schedule batch jobs during low-traffic periods",
			"Consider pt-online-schema-change for massive updates",
		],

		educationalInsights: [
			"MySQL replication SQL thread is single-threaded by default",
			"One long transaction blocks ALL replication behind it",
			"Replica can take LONGER than primary for the same transaction",
			"Parallel replication helps concurrent transactions, not single large ones",
			"Binlog events are transaction-sized - large transaction = large event",
			"Chunked processing trades total time for consistent replication lag",
		],
	},
};

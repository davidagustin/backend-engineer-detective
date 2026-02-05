import type { DetectiveCase } from "../../types";

export const databaseMigrationLock: DetectiveCase = {
	id: "database-migration-lock",
	title: "The Database Migration Lock",
	subtitle: "Deployment blocked by a migration that won't finish",
	difficulty: "mid",
	category: "database",

	crisis: {
		description:
			"A database migration started during deployment and has been running for 45 minutes. The deployment pipeline is stuck waiting for it. Meanwhile, the application is experiencing severe slowdowns and timeouts.",
		impact:
			"Production deployment blocked. Application response times 10x normal. 30% of requests timing out. Every minute of delay costs credibility with waiting customers.",
		timeline: [
			{ time: "2:00 PM", event: "Deployment triggered, migration starts", type: "normal" },
			{ time: "2:05 PM", event: "Migration running, estimated 5 minutes", type: "normal" },
			{ time: "2:15 PM", event: "Migration still running, 10 minutes elapsed", type: "warning" },
			{ time: "2:30 PM", event: "Application slowdown reported", type: "warning" },
			{ time: "2:45 PM", event: "Request timeouts increasing", type: "critical" },
			{ time: "3:00 PM", event: "Migration at 45 minutes, pipeline timeout approaching", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Database is accessible",
			"Read queries work (slowly)",
			"No errors in migration logs",
			"Database CPU is not maxed",
			"Disk I/O within limits",
		],
		broken: [
			"Migration won't complete",
			"Write queries extremely slow",
			"Some queries timing out",
			"Application experiencing cascading delays",
			"Cannot cancel migration safely",
		],
	},

	clues: [
		{
			id: 1,
			title: "Migration SQL",
			type: "code",
			content: `\`\`\`sql
-- Migration: 20240115_add_user_status_index.sql

-- Add index to improve query performance on user status lookups
CREATE INDEX CONCURRENTLY idx_users_status_created
ON users (status, created_at);

-- This was expected to take ~5 minutes based on staging tests
-- Table has 50 million rows in production (5 million in staging)
\`\`\``,
			hint: "CONCURRENTLY is good, but what else might be happening?",
		},
		{
			id: 2,
			title: "PostgreSQL Lock Status",
			type: "logs",
			content: `\`\`\`sql
-- SELECT * FROM pg_locks WHERE NOT granted;

 locktype |  relation  | mode | granted | pid  | wait_start
----------+------------+------+---------+------+---------------------
 relation | users      | ShareLock | false | 8821 | 2024-01-15 14:02:33

-- The CREATE INDEX CONCURRENTLY is waiting for a ShareLock

-- SELECT * FROM pg_stat_activity WHERE state != 'idle';

  pid  |  state  | wait_event | query_start         | query
-------+---------+------------+---------------------+----------------------------------
  8821 | active  | Lock       | 2024-01-15 14:00:05 | CREATE INDEX CONCURRENTLY...
  9102 | active  |            | 2024-01-15 13:45:00 | SELECT * FROM users WHERE...
  9103 | active  | Lock       | 2024-01-15 14:10:22 | UPDATE users SET last_login...
  9104 | active  | Lock       | 2024-01-15 14:12:33 | UPDATE users SET preferences...

-- PID 9102 has been running since BEFORE the migration started!
\`\`\``,
			hint: "Look at when each query started. One started before the migration...",
		},
		{
			id: 3,
			title: "Backend Developer Testimony",
			type: "testimony",
			content: `"We use CREATE INDEX CONCURRENTLY specifically to avoid blocking. It's supposed to allow normal operations while building the index. I tested this in staging and it took 5 minutes. Production has more data but I expected maybe 15-20 minutes max. Something else must be going on."`,
		},
		{
			id: 4,
			title: "Application Query Analysis",
			type: "code",
			content: `\`\`\`typescript
// analytics-service.ts - Runs every 30 minutes
async generateUserReport(): Promise<Report> {
  // This query examines every user to build analytics
  const users = await this.db.query(\`
    SELECT
      u.*,
      COUNT(o.id) as order_count,
      SUM(o.total) as lifetime_value
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.created_at > NOW() - INTERVAL '1 year'
    GROUP BY u.id
  \`);

  // Process takes 10-15 minutes
  return this.processAnalytics(users);
}

// Note: This runs in a long-lived transaction
// Transaction isolation level: READ COMMITTED
\`\`\``,
			hint: "This query runs in a long-lived transaction...",
		},
		{
			id: 5,
			title: "Database Configuration",
			type: "config",
			content: `\`\`\`
# postgresql.conf (relevant settings)

# Lock timeout - queries wait this long for locks
lock_timeout = 0  # No timeout (wait forever)

# Statement timeout
statement_timeout = 0  # No timeout (wait forever)

# Deadlock detection
deadlock_timeout = 1s

# Idle transaction timeout
idle_in_transaction_session_timeout = 0  # No timeout

# Connection settings
max_connections = 200
\`\`\``,
			hint: "The database is configured to wait forever for locks...",
		},
		{
			id: 6,
			title: "CREATE INDEX CONCURRENTLY Documentation",
			type: "logs",
			content: `\`\`\`
PostgreSQL CREATE INDEX CONCURRENTLY:
=====================================

Phase 1: Wait for existing transactions
  - Must wait for ALL transactions that started BEFORE
    the CREATE INDEX to complete
  - Even read-only transactions!

Phase 2: Build index (can proceed with concurrent reads/writes)
  - Scans table and builds index structure

Phase 3: Wait again for transactions
  - Must wait for transactions that started during Phase 2

Key point: If ANY long-running transaction exists from before
the command started, Phase 1 will block indefinitely.

Current blocking transaction:
  PID: 9102
  Started: 2024-01-15 13:45:00 (15 minutes before migration)
  Query: Analytics report generation
  Estimated completion: Unknown (depends on data volume)
\`\`\``,
			hint: "The migration is waiting for a transaction that started before it...",
		},
	],

	solution: {
		diagnosis: "CREATE INDEX CONCURRENTLY blocked by long-running analytics transaction",
		keywords: [
			"CREATE INDEX CONCURRENTLY",
			"lock",
			"blocking",
			"transaction",
			"long-running query",
			"migration lock",
			"pg_locks",
			"ShareLock",
			"index creation",
		],
		rootCause: `CREATE INDEX CONCURRENTLY is designed to build indexes without blocking writes, but it has a critical requirement: it must wait for all transactions that started before the command to complete before it can begin building the index.

The analytics report job started a transaction at 13:45 (15 minutes before deployment). When the migration started at 14:00, the CREATE INDEX CONCURRENTLY entered Phase 1, waiting for that transaction to finish. But the analytics job takes 10-15 minutes and started a new iteration within its long-lived connection.

The cascading effect:
1. Migration waits for analytics transaction (ShareLock on users table)
2. New write queries pile up waiting for the migration's lock intention
3. Application queries timeout, retries add more pressure
4. The analytics job keeps running, unaware it's blocking everything

The irony: CONCURRENTLY is meant to be non-blocking, but it's blocked by the very type of long query it's designed to coexist with.`,
		codeExamples: [
			{
				lang: "sql",
				description: "Immediate fix: Identify and terminate blocking transaction",
				code: `-- Find what's blocking the index creation
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  blocking.pid AS blocking_pid,
  blocking.query AS blocking_query,
  blocking.state,
  now() - blocking.query_start AS blocking_duration
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks ON blocked_locks.relation = blocking_locks.relation
JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
WHERE NOT blocked_locks.granted
  AND blocked.pid != blocking.pid;

-- If safe to cancel the blocking query:
SELECT pg_cancel_backend(9102);  -- Graceful cancel

-- If that doesn't work and you understand the implications:
-- SELECT pg_terminate_backend(9102);  -- Force terminate`,
			},
			{
				lang: "typescript",
				description: "Fix analytics job to use shorter transactions",
				code: `// analytics-service.ts - Fixed version
async generateUserReport(): Promise<Report> {
  // Process in batches with separate transactions
  const batchSize = 10000;
  let offset = 0;
  const results: UserAnalytics[] = [];

  while (true) {
    // Each batch is a separate, short transaction
    const batch = await this.db.query(\`
      SELECT
        u.id, u.created_at, u.status,
        COUNT(o.id) as order_count,
        SUM(o.total) as lifetime_value
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.created_at > NOW() - INTERVAL '1 year'
      GROUP BY u.id
      ORDER BY u.id
      LIMIT $1 OFFSET $2
    \`, [batchSize, offset]);

    if (batch.rows.length === 0) break;

    results.push(...batch.rows);
    offset += batchSize;

    // Small delay to reduce lock contention
    await sleep(100);
  }

  return this.processAnalytics(results);
}`,
			},
			{
				lang: "sql",
				description: "Pre-migration check script",
				code: `-- Run BEFORE starting migrations that create indexes
-- migration-preflight.sql

-- Check for long-running transactions
SELECT
  pid,
  now() - xact_start AS transaction_age,
  now() - query_start AS query_age,
  state,
  left(query, 100) AS query_preview
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND state != 'idle'
  AND now() - xact_start > INTERVAL '1 minute'
ORDER BY xact_start;

-- If any results: STOP! Don't start migration until these complete

-- Check for potential blockers on target table
SELECT
  l.relation::regclass AS table_name,
  l.mode,
  a.pid,
  a.state,
  a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.relation = 'users'::regclass
  AND l.granted;`,
			},
			{
				lang: "yaml",
				description: "Safe migration deployment config",
				code: `# migration-config.yaml

pre_migration_checks:
  # Fail if any transaction is older than 2 minutes
  max_transaction_age: 2m

  # Fail if table has more than 5 active locks
  max_active_locks: 5

  # Check query for any long-running reports
  blocked_patterns:
    - "analytics"
    - "report"
    - "export"

migration_settings:
  # Set lock timeout so we don't wait forever
  lock_timeout: 30s

  # Set statement timeout for the migration
  statement_timeout: 30m

  # For CREATE INDEX CONCURRENTLY specifically
  index_creation:
    retry_on_lock_timeout: true
    max_retries: 3
    retry_delay: 60s

rollback_plan:
  # If migration times out, these are safe to run
  - "DROP INDEX CONCURRENTLY IF EXISTS idx_users_status_created"`,
			},
		],
		prevention: [
			"Run pre-migration checks for long-running transactions",
			"Set lock_timeout and statement_timeout in migration scripts",
			"Schedule heavy analytics jobs outside deployment windows",
			"Use batch processing for long-running jobs instead of single transactions",
			"Add idle_in_transaction_session_timeout to catch stuck transactions",
			"Monitor pg_stat_activity for transaction age as a deployment gate",
			"Document which background jobs may conflict with migrations",
			"Test migrations with production-like data volumes, not just row counts",
		],
		educationalInsights: [
			"CONCURRENTLY doesn't mean 'never blocks' - it means 'minimal blocking'",
			"CREATE INDEX CONCURRENTLY must wait for pre-existing transactions",
			"Long-running transactions are the enemy of schema changes",
			"PostgreSQL's lock system is complex - pg_locks is your friend",
			"statement_timeout and lock_timeout are different and both important",
			"Batch processing prevents transaction bloat",
			"The staging vs production gap often involves transaction patterns, not just data volume",
		],
	},
};

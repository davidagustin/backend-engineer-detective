import type { DetectiveCase } from "../../types";

export const postgresqlVacuumFreeze: DetectiveCase = {
	id: "postgresql-vacuum-freeze",
	title: "The Vacuum Freeze Incident",
	subtitle: "Database grinds to a halt during autovacuum freeze operation",
	difficulty: "senior",
	category: "database",

	crisis: {
		description: `
			Your PostgreSQL production database has suddenly become unresponsive.
			All queries are timing out and the application is returning 504 errors.
			The database has been running fine for 18 months without issues.
			CPU on the database server is pegged at 100% on a single core.
		`,
		impact: `
			Complete application outage. All user requests failing. Revenue loss
			estimated at $50K per hour. Executive escalation in progress.
		`,
		timeline: [
			{ time: "3:00 AM", event: "Autovacuum process begins on users table", type: "normal" },
			{ time: "3:15 AM", event: "Query latency starts increasing", type: "warning" },
			{ time: "3:30 AM", event: "First 504 errors reported by monitoring", type: "warning" },
			{ time: "3:45 AM", event: "All application queries timing out", type: "critical" },
			{ time: "4:00 AM", event: "On-call engineer paged", type: "critical" },
			{ time: "4:15 AM", event: "Attempted restart blocked by autovacuum", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Database process is running",
			"Connections can be established",
			"Small metadata queries complete (very slowly)",
			"Replication to replica is still active",
			"Disk I/O is high but not maxed",
		],
		broken: [
			"All queries to users table timing out",
			"Autovacuum process consuming 100% CPU",
			"Cannot cancel the autovacuum process",
			"Table has grown to 500GB despite only 50M rows",
			"Dead tuple count shows 2 billion tuples",
		],
	},

	clues: [
		{
			id: 1,
			title: "PostgreSQL Activity",
			type: "logs",
			content: `\`\`\`sql
SELECT pid, state, query, age(clock_timestamp(), query_start) as duration
FROM pg_stat_activity
WHERE state != 'idle';

  pid  |        state        |                    query                     |   duration
-------+---------------------+----------------------------------------------+--------------
 12345 | active              | autovacuum: VACUUM users (to prevent wraparound) | 01:15:33
 12346 | active              | SELECT * FROM users WHERE id = $1            | 00:05:23
 12347 | active              | UPDATE users SET last_login = NOW()...       | 00:05:19
 12348 | active              | SELECT * FROM users WHERE email = $1         | 00:05:17
\`\`\``,
			hint: "Notice the special annotation in the autovacuum query...",
		},
		{
			id: 2,
			title: "Table Statistics",
			type: "metrics",
			content: `\`\`\`sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    pg_size_pretty(pg_relation_size(relid)) as table_size,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
WHERE relname = 'users';

 relname | n_live_tup |  n_dead_tup  | table_size | last_vacuum |    last_autovacuum
---------+------------+--------------+------------+-------------+------------------------
 users   | 50000000   | 2147483647   | 487 GB     | NULL        | 2023-01-15 02:30:00
\`\`\``,
			hint: "When was the last vacuum? And look at that dead tuple count...",
		},
		{
			id: 3,
			title: "Transaction ID Status",
			type: "metrics",
			content: `\`\`\`sql
SELECT
    datname,
    age(datfrozenxid) as xid_age,
    current_setting('autovacuum_freeze_max_age') as freeze_max_age
FROM pg_database WHERE datname = 'production';

  datname   |   xid_age   | freeze_max_age
------------+-------------+----------------
 production | 199,500,000 |    200,000,000

-- WARNING: Transaction ID wraparound imminent!
-- Database will shut down in ~500,000 transactions to prevent data corruption
\`\`\``,
			hint: "Transaction IDs are about to wrap around...",
		},
		{
			id: 4,
			title: "Autovacuum Configuration",
			type: "config",
			content: `\`\`\`sql
SHOW autovacuum;                          -- on
SHOW autovacuum_vacuum_cost_limit;        -- 200 (default)
SHOW autovacuum_vacuum_cost_delay;        -- 20ms (default)
SHOW autovacuum_naptime;                  -- 60s (default)
SHOW autovacuum_freeze_max_age;           -- 200000000
SHOW vacuum_freeze_min_age;               -- 50000000

-- Cost limit calculation:
-- At 200 cost limit with 20ms delay, vacuum processes ~10 pages/second
-- With 487GB table = ~64 million pages
-- Estimated time to complete: ~74 days at current settings
\`\`\``,
			hint: "Calculate how long vacuum will take at current settings...",
		},
		{
			id: 5,
			title: "DBA Testimony",
			type: "testimony",
			content: `"We disabled autovacuum on the users table 18 months ago because it was
causing brief latency spikes during peak hours. The plan was to run manual
vacuums during maintenance windows, but... we never got around to it.

Now PostgreSQL is forcing an anti-wraparound vacuum and it can't be cancelled
because the database would corrupt itself if transaction IDs wrapped around.
The only options are to let it complete or accept data loss."`,
		},
		{
			id: 6,
			title: "Table Update Pattern",
			type: "logs",
			content: `\`\`\`sql
-- Query to show update frequency
SELECT
    schemaname,
    relname,
    n_tup_upd,
    n_tup_del,
    n_tup_hot_upd
FROM pg_stat_user_tables WHERE relname = 'users';

 schemaname | relname |   n_tup_upd    | n_tup_del |  n_tup_hot_upd
------------+---------+----------------+-----------+-----------------
 public     | users   | 15,234,567,890 | 12,345    |    234,567,890

-- The users table gets updated on every login (last_login timestamp)
-- With 50M users and ~300 logins/second average
-- That's 25 billion updates per year, each creating dead tuples
\`\`\``,
			hint: "Every update creates a dead tuple that vacuum must clean...",
		},
	],

	solution: {
		diagnosis: "Anti-wraparound vacuum triggered after 18 months of skipped vacuuming",

		keywords: [
			"vacuum",
			"autovacuum",
			"freeze",
			"wraparound",
			"transaction id",
			"xid",
			"dead tuples",
			"bloat",
			"table bloat",
			"anti-wraparound",
		],

		rootCause: `
			PostgreSQL uses 32-bit transaction IDs that wrap around after ~4 billion transactions.
			To prevent data corruption from ID reuse, PostgreSQL must periodically "freeze" old
			transaction IDs through the VACUUM process.

			The team disabled autovacuum on the users table 18 months ago to avoid latency spikes.
			During this time:

			1. Dead tuples accumulated (billions from frequent last_login updates)
			2. Transaction ID age grew toward the 200M freeze threshold
			3. Table bloated from 50GB to 487GB (10x original size)

			When xid_age approached autovacuum_freeze_max_age, PostgreSQL triggered an
			emergency anti-wraparound vacuum that CANNOT be cancelled without risking data
			corruption. This vacuum must scan the entire bloated table, which at default
			cost settings would take ~74 days.

			The vacuum holds locks that block other operations, causing the outage.
		`,

		codeExamples: [
			{
				lang: "sql",
				description: "Immediate mitigation: Increase vacuum speed",
				code: `-- Temporarily remove cost limits to speed up vacuum
-- WARNING: This will impact I/O performance but finish faster

ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 10000;
ALTER SYSTEM SET autovacuum_vacuum_cost_delay = 0;
SELECT pg_reload_conf();

-- Monitor progress
SELECT
    p.pid,
    p.relid::regclass as table,
    p.phase,
    p.heap_blks_total,
    p.heap_blks_scanned,
    round(100.0 * p.heap_blks_scanned / p.heap_blks_total, 2) as pct_complete
FROM pg_stat_progress_vacuum p;`,
			},
			{
				lang: "sql",
				description: "Proper autovacuum settings for high-update tables",
				code: `-- Configure aggressive vacuuming for frequently updated tables
ALTER TABLE users SET (
    autovacuum_vacuum_scale_factor = 0.01,     -- Vacuum at 1% dead tuples
    autovacuum_vacuum_threshold = 10000,        -- Minimum 10K dead tuples
    autovacuum_vacuum_cost_limit = 2000,        -- 10x default speed
    autovacuum_vacuum_cost_delay = 5,           -- Less delay
    autovacuum_freeze_max_age = 100000000       -- Freeze earlier
);

-- Also consider separating last_login to its own table
CREATE TABLE user_activity (
    user_id BIGINT PRIMARY KEY REFERENCES users(id),
    last_login TIMESTAMP WITH TIME ZONE
);
-- This isolates the high-update column from the main table`,
			},
			{
				lang: "sql",
				description: "Monitoring queries to prevent future incidents",
				code: `-- Alert when approaching wraparound
SELECT
    datname,
    age(datfrozenxid) as xid_age,
    round(100.0 * age(datfrozenxid) / 2000000000, 2) as pct_to_wraparound
FROM pg_database
WHERE age(datfrozenxid) > 150000000  -- Alert threshold
ORDER BY xid_age DESC;

-- Alert on table bloat
SELECT
    schemaname,
    relname,
    n_dead_tup,
    n_live_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000000  -- More than 1M dead tuples
ORDER BY n_dead_tup DESC;`,
			},
		],

		prevention: [
			"Never disable autovacuum on tables with frequent updates",
			"Monitor transaction ID age and alert at 50% of freeze_max_age",
			"Set per-table autovacuum settings for high-update tables",
			"Monitor dead tuple counts and table bloat ratio",
			"Separate frequently-updated columns into dedicated tables",
			"Run pg_stat_user_tables monitoring in dashboards",
		],

		educationalInsights: [
			"PostgreSQL's MVCC creates dead tuples on every UPDATE and DELETE",
			"Anti-wraparound vacuum is uncancellable to prevent data corruption",
			"Default autovacuum settings are conservative; tune for your workload",
			"Table bloat increases vacuum time exponentially",
			"Transaction ID wraparound would cause data to 'disappear' from queries",
			"The fix takes longer the more you defer it - vacuum debt accumulates",
		],
	},
};

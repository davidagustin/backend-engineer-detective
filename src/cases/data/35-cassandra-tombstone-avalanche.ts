import type { DetectiveCase } from "../../types";

export const cassandraTombstoneAvalanche: DetectiveCase = {
	id: "cassandra-tombstone-avalanche",
	title: "The Cassandra Tombstone Avalanche",
	subtitle: "Read queries timeout despite healthy cluster metrics",
	difficulty: "principal",
	category: "database",

	crisis: {
		description: `
			Your Cassandra cluster powers a real-time event tracking system. Queries
			for recent user events have started timing out, but only for certain users.
			The cluster appears healthy - CPU, memory, and disk all look normal. Some
			users load instantly, others timeout after 30 seconds.
		`,
		impact: `
			30% of user dashboards failing to load. Analytics pipeline stalled due to
			read timeouts. Customer-facing real-time features degraded. High-value
			enterprise customers affected.
		`,
		timeline: [
			{ time: "Monday", event: "System running normally", type: "normal" },
			{ time: "Tuesday", event: "Data retention job deletes events > 30 days old", type: "normal" },
			{ time: "Wednesday AM", event: "First timeout reports for heavy users", type: "warning" },
			{ time: "Wednesday PM", event: "Timeout rate climbing to 10%", type: "warning" },
			{ time: "Thursday", event: "30% of dashboards failing", type: "critical" },
			{ time: "Friday", event: "Some queries failing with TombstoneOverwhelmingException", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Cluster health checks pass",
			"Write operations succeed quickly",
			"New users load instantly",
			"Users with little history load fine",
			"Aggregated reports work (different table)",
		],
		broken: [
			"Long-time users with lots of events timeout",
			"Queries return TombstoneOverwhelmingException",
			"Read latency p99 spiked from 50ms to 30,000ms",
			"Same query sometimes works, sometimes fails",
			"Reads get slower each day after retention job",
		],
	},

	clues: [
		{
			id: 1,
			title: "Cassandra System Log",
			type: "logs",
			content: `\`\`\`
WARN  [ReadStage-3] ReadCommand.java:508 - Read 104857 live rows and 2847593
tombstone cells for query SELECT * FROM events.user_events WHERE user_id = ?
AND event_time >= ? AND event_time <= ? (see tombstone_warn_threshold)

ERROR [ReadStage-7] ReadCommand.java:512 - Scanned over 100001 tombstones during
query SELECT * FROM events.user_events WHERE user_id = ? AND event_time >= ?
LIMIT 100; query aborted (see tombstone_failure_threshold)

WARN  [ReadStage-12] ReadCommand.java:508 - Read 52341 live rows and 1923847
tombstone cells for query SELECT * FROM events.user_events WHERE user_id = ?
\`\`\``,
			hint: "Notice the ratio of tombstones to live rows...",
		},
		{
			id: 2,
			title: "Table Schema",
			type: "code",
			content: `\`\`\`cql
CREATE TABLE events.user_events (
    user_id uuid,
    event_time timestamp,
    event_type text,
    event_data text,
    PRIMARY KEY (user_id, event_time)
) WITH CLUSTERING ORDER BY (event_time DESC)
  AND gc_grace_seconds = 864000  -- 10 days
  AND default_time_to_live = 0;

-- Query pattern: Get recent events for a user
SELECT * FROM user_events
WHERE user_id = ?
AND event_time >= '2024-01-01'
AND event_time <= '2024-01-31'
LIMIT 100;
\`\`\``,
			hint: "Wide rows with time-series data and range queries...",
		},
		{
			id: 3,
			title: "Data Retention Job",
			type: "code",
			content: `\`\`\`python
# Runs daily at 2 AM - Delete events older than 30 days
def cleanup_old_events():
    cutoff = datetime.now() - timedelta(days=30)

    # Get all users with old events
    users = session.execute(
        "SELECT DISTINCT user_id FROM user_events"
    )

    for user in users:
        # Delete old events for each user
        session.execute(
            """DELETE FROM user_events
               WHERE user_id = %s AND event_time < %s""",
            (user.user_id, cutoff)
        )

    logger.info(f"Cleanup complete: deleted events before {cutoff}")
\`\`\``,
			hint: "What happens in Cassandra when you delete data?",
		},
		{
			id: 4,
			title: "Partition Statistics",
			type: "metrics",
			content: `\`\`\`
$ nodetool cfstats events.user_events

Table: events.user_events
SSTable count: 847
Space used (total): 234.5 GB
Number of partitions (estimate): 1,284,567
Mean partition size: 182,847 bytes
Max partition size: 2.3 GB

Tombstone metrics (per-read):
  Tombstones scanned (avg): 847,293
  Tombstones scanned (max): 4,234,567
  Live cells scanned (avg): 127,456

Compaction pending: 0
\`\`\``,
			hint: "Max partition size is 2.3GB - that's a LOT of tombstones...",
		},
		{
			id: 5,
			title: "Cassandra Tombstone Mechanics",
			type: "config",
			content: `\`\`\`
# How Cassandra handles deletions:

1. DELETE doesn't remove data immediately
2. A "tombstone" marker is written instead
3. Tombstones persist for gc_grace_seconds (10 days default)
4. During reads, Cassandra must scan ALL tombstones in the range
5. Tombstones are only removed during compaction AFTER gc_grace

# Problem scenario (wide partition with deletes):
Partition: user_id=abc123
  - 100 live events from last 30 days
  - 5,000,000 tombstones from deleted events (last 2 years of history)

Query: SELECT * WHERE user_id=abc123 AND event_time > '30 days ago'
  - Must scan through 5M tombstones to find 100 live events
  - Each tombstone = memory allocation + comparison
  - Results in timeout or TombstoneOverwhelmingException
\`\`\``,
			hint: "Tombstones accumulate in wide partitions...",
		},
		{
			id: 6,
			title: "Senior Engineer Analysis",
			type: "testimony",
			content: `"The retention job has been running for 2 years. Each day it deletes
~100M events, but those aren't really deleted - they become tombstones.

For power users who've been with us since launch:
- They have 2 years of deleted events = ~7.3M tombstones per user
- Plus 30 days of live events = ~10K rows per user
- Reading their recent 100 events requires scanning 7.3M tombstones

Compaction won't help because:
1. gc_grace_seconds is 10 days (tombstones younger than that can't be removed)
2. We keep creating new tombstones daily via the retention job
3. The partition just keeps growing with tombstones

We essentially have unbounded tombstone growth in our wide partitions."`,
		},
	],

	solution: {
		diagnosis: "Tombstone accumulation in wide partitions causing read amplification",

		keywords: [
			"tombstone",
			"tombstones",
			"wide partition",
			"gc_grace",
			"compaction",
			"TombstoneOverwhelmingException",
			"delete",
			"TTL",
			"time series",
			"partition",
		],

		rootCause: `
			The data model uses user_id as partition key with event_time as clustering column,
			creating wide partitions for active users. The daily retention job DELETEs old
			events, but in Cassandra, deletes create tombstones rather than removing data.

			The problem compounds over time:
			1. Each delete creates a tombstone that persists for gc_grace_seconds (10 days)
			2. But new tombstones are created daily, faster than compaction removes old ones
			3. For long-time users, tombstones accumulate unboundedly
			4. Range queries must scan ALL tombstones within the partition
			5. A user with 2 years of history has ~7M tombstones but only ~10K live rows

			Read performance degrades because:
			- Cassandra must read tombstones into memory during range scans
			- Each tombstone requires a comparison to determine if it "shadows" live data
			- With millions of tombstones, this overwhelms memory and CPU

			The failure threshold (100K tombstones) triggers TombstoneOverwhelmingException
			to protect cluster stability.
		`,

		codeExamples: [
			{
				lang: "cql",
				description: "Fix: Use TTL instead of DELETE for automatic expiration",
				code: `-- New table with built-in TTL
CREATE TABLE events.user_events_v2 (
    user_id uuid,
    event_bucket date,      -- Add date bucketing
    event_time timestamp,
    event_type text,
    event_data text,
    PRIMARY KEY ((user_id, event_bucket), event_time)
) WITH CLUSTERING ORDER BY (event_time DESC)
  AND default_time_to_live = 2592000  -- 30 days TTL
  AND gc_grace_seconds = 86400;        -- 1 day (shorter for TTL data)

-- Insert with automatic expiration (no delete job needed)
INSERT INTO user_events_v2 (user_id, event_bucket, event_time, event_type, event_data)
VALUES (?, ?, ?, ?, ?);
-- Data automatically expires after 30 days

-- Query with bounded partition scan
SELECT * FROM user_events_v2
WHERE user_id = ?
AND event_bucket = '2024-01-15'  -- Query specific day
AND event_time >= ?
LIMIT 100;`,
			},
			{
				lang: "python",
				description: "Migration strategy: Backfill new table with TTL",
				code: `# Migrate to new schema with bounded partitions
from datetime import datetime, timedelta
from cassandra.query import BatchStatement

def migrate_user_events(user_id, days_to_keep=30):
    """Migrate user events to new bucketed schema with TTL."""

    cutoff = datetime.now() - timedelta(days=days_to_keep)

    # Read only recent events (skip tombstones in old table)
    events = session.execute(
        """SELECT event_time, event_type, event_data
           FROM user_events
           WHERE user_id = %s AND event_time >= %s""",
        (user_id, cutoff)
    )

    batch = BatchStatement()
    for event in events:
        bucket = event.event_time.date()
        batch.add(
            insert_stmt,
            (user_id, bucket, event.event_time,
             event.event_type, event.event_data)
        )

        if len(batch) >= 100:
            session.execute(batch)
            batch = BatchStatement()

    if len(batch) > 0:
        session.execute(batch)`,
			},
			{
				lang: "cql",
				description: "Emergency: Force compaction to remove eligible tombstones",
				code: `-- First, check tombstone-heavy partitions
-- (Run this on one node at a time via nodetool)
nodetool garbagecollect events user_events

-- For immediate relief, you can manually compact
nodetool compact events user_events

-- Monitor tombstone removal
nodetool tablestats events.user_events | grep -i tombstone

-- WARNING: This only removes tombstones older than gc_grace_seconds
-- If retention job keeps creating new ones, problem will return`,
			},
		],

		prevention: [
			"Use TTL for time-series data instead of explicit DELETEs",
			"Add time bucketing to partition keys (date, week, month)",
			"Monitor tombstone counts per partition via cfstats",
			"Set alerts on tombstone_warn_threshold breaches in logs",
			"Keep partitions bounded - aim for <100MB per partition",
			"Reduce gc_grace_seconds for TTL-based tables (data expires uniformly)",
		],

		educationalInsights: [
			"Cassandra deletes are writes - they create tombstones, not remove data",
			"Tombstones are necessary for distributed consistency during repairs",
			"gc_grace_seconds determines minimum tombstone lifetime (default 10 days)",
			"Wide partitions with frequent deletes are a known Cassandra anti-pattern",
			"TTL creates cell-level tombstones that compact more efficiently",
			"Time-bucketed partitions naturally bound tombstone accumulation",
			"TombstoneOverwhelmingException is a safety mechanism, not a bug",
		],
	},
};

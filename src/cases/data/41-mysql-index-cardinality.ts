import type { DetectiveCase } from "../../types";

export const mysqlIndexCardinality: DetectiveCase = {
	id: "mysql-index-cardinality",
	title: "The Index Illusion",
	subtitle: "Queries slow despite index existing on the filtered column",
	difficulty: "junior",
	category: "database",

	crisis: {
		description: `
			Your user listing page is painfully slow. It filters users by status
			and shows 20 results per page. There's an index on the status column,
			but the query takes 3 seconds. The DBA says the index exists, yet
			EXPLAIN shows a full table scan.
		`,
		impact: `
			Admin dashboard takes 3+ seconds to load user list. Support team
			productivity impacted. Similar slow queries appearing across the app
			for status-based filters.
		`,
		timeline: [
			{ time: "Day 1", event: "New 'user status' feature deployed", type: "normal" },
			{ time: "Day 2", event: "Support team reports slow user listing", type: "warning" },
			{ time: "Day 3", event: "DBA confirms index exists on status column", type: "normal" },
			{ time: "Day 3", event: "EXPLAIN shows full table scan despite index", type: "warning" },
			{ time: "Day 4", event: "Same issue found in 5 other queries", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Index exists and shows in SHOW INDEX",
			"Queries with unique filters (like email) are fast",
			"Pagination (LIMIT) correctly returns 20 rows",
			"Other tables with similar structure are fast",
			"Index is not corrupted (CHECK TABLE passes)",
		],
		broken: [
			"Query filtering by status takes 3 seconds",
			"EXPLAIN shows type: ALL (full table scan)",
			"Adding the index didn't improve performance",
			"Query scans millions of rows to return 20",
			"All status-based queries have same problem",
		],
	},

	clues: [
		{
			id: 1,
			title: "The Slow Query",
			type: "code",
			content: `\`\`\`sql
-- The problematic query
SELECT id, name, email, created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20;

-- Execution time: 3.2 seconds
-- Rows examined: 5,000,000
-- Rows returned: 20
\`\`\``,
			hint: "The query scans 5 million rows to return 20...",
		},
		{
			id: 2,
			title: "Index Information",
			type: "logs",
			content: `\`\`\`sql
SHOW INDEX FROM users;

+-------+------------+------------+--------------+-------------+-----------+
| Table | Non_unique | Key_name   | Seq_in_index | Column_name | Cardinality|
+-------+------------+------------+--------------+-------------+-----------+
| users |          0 | PRIMARY    |            1 | id          |   5234567 |
| users |          1 | idx_status |            1 | status      |         4 |
| users |          1 | idx_email  |            1 | email       |   5234567 |
| users |          1 | idx_created|            1 | created_at  |   5234567 |
+-------+------------+------------+--------------+-------------+-----------+

-- Note the Cardinality values:
-- idx_status: 4 (only 4 unique values!)
-- idx_email: 5,234,567 (every row unique)
\`\`\``,
			hint: "Look at the cardinality of idx_status vs idx_email...",
		},
		{
			id: 3,
			title: "EXPLAIN Output",
			type: "logs",
			content: `\`\`\`sql
EXPLAIN SELECT id, name, email, created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20;

+----+-------------+-------+------+---------------+------+---------+------+---------+-----------------------------+
| id | select_type | table | type | possible_keys | key  | key_len | ref  | rows    | Extra                       |
+----+-------------+-------+------+---------------+------+---------+------+---------+-----------------------------+
|  1 | SIMPLE      | users | ALL  | idx_status    | NULL | NULL    | NULL | 5234567 | Using where; Using filesort |
+----+-------------+-------+------+---------------+------+---------+------+---------+-----------------------------+

-- Key observations:
-- type: ALL = full table scan
-- possible_keys: idx_status (MySQL knows the index exists)
-- key: NULL (MySQL chose NOT to use the index)
-- rows: 5234567 (scanning all rows)
\`\`\``,
			hint: "MySQL knows the index exists but chose not to use it...",
		},
		{
			id: 4,
			title: "Status Column Distribution",
			type: "metrics",
			content: `\`\`\`sql
SELECT status, COUNT(*) as count,
       ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM users), 2) as percentage
FROM users
GROUP BY status;

+------------+---------+------------+
| status     | count   | percentage |
+------------+---------+------------+
| active     | 4500000 |      86.00 |
| inactive   |  500000 |       9.56 |
| pending    |  200000 |       3.82 |
| suspended  |   34567 |       0.66 |
+------------+---------+------------+

-- 'active' status matches 86% of all rows!
\`\`\``,
			hint: "'active' matches 86% of the table...",
		},
		{
			id: 5,
			title: "MySQL Query Optimizer Behavior",
			type: "config",
			content: `\`\`\`
Index Cardinality and Query Optimization:
=========================================

Cardinality = number of unique values in a column

High cardinality (good for indexing):
- email: 5,234,567 unique values
- Using index returns ~1 row per lookup
- Index is very selective

Low cardinality (poor for indexing):
- status: 4 unique values
- Using index returns ~1.3M rows for 'active'
- Index is NOT selective

MySQL optimizer decision:
- Estimates cost of using index vs full scan
- If index returns >20-30% of table, full scan is often faster
- Why? Index lookup + random I/O for each row vs sequential scan

For status='active' (86% of rows):
- Index would return 4.5M row pointers
- Then random I/O to fetch each row
- Sequential scan of 5M rows is actually FASTER!
- MySQL correctly chooses full scan
\`\`\``,
			hint: "Index isn't used because it would return too many rows...",
		},
		{
			id: 6,
			title: "Comparison: Suspended Users Query",
			type: "logs",
			content: `\`\`\`sql
-- Query for suspended users (only 0.66% of table)
EXPLAIN SELECT id, name, email, created_at
FROM users
WHERE status = 'suspended'
ORDER BY created_at DESC
LIMIT 20;

+----+-------------+-------+------+---------------+------------+---------+-------+-------+-----------------------------+
| id | select_type | table | type | possible_keys | key        | key_len | ref   | rows  | Extra                       |
+----+-------------+-------+------+---------------+------------+---------+-------+-------+-----------------------------+
|  1 | SIMPLE      | users | ref  | idx_status    | idx_status | 42      | const | 34567 | Using where; Using filesort |
+----+-------------+-------+------+---------------+------------+---------+-------+-------+-----------------------------+

-- key: idx_status (MySQL USES the index!)
-- rows: 34567 (only scanning matching rows)
-- Execution time: 0.05 seconds

-- The same index IS used when it's selective!
\`\`\``,
			hint: "Same index works when filtering for rare values...",
		},
	],

	solution: {
		diagnosis: "Low cardinality index not used by optimizer for common values",

		keywords: [
			"cardinality",
			"selectivity",
			"index",
			"full table scan",
			"optimizer",
			"low cardinality",
			"compound index",
			"covering index",
		],

		rootCause: `
			The index on the \`status\` column exists but has very low cardinality - only
			4 unique values across 5 million rows. When filtering for 'active' status,
			the index would return 4.5 million rows (86% of the table).

			MySQL's query optimizer correctly recognizes that using the index would be
			SLOWER than a full table scan because:

			1. **Index lookup cost**: Finding 4.5M row pointers in the index
			2. **Random I/O cost**: Fetching each row from disk in random order
			3. vs **Sequential scan**: Reading all rows in order (better disk access pattern)

			For highly selective queries (>70-80% of table), sequential full table scans
			are often faster than index-based access due to disk I/O patterns.

			The solution is not to "fix" the index usage - MySQL made the right choice.
			Instead, create a compound index that includes the ORDER BY column, allowing
			MySQL to satisfy both the filter AND the sort without accessing the main table.
		`,

		codeExamples: [
			{
				lang: "sql",
				description: "Fix: Create compound index with ORDER BY column",
				code: `-- Create compound index: status + created_at
-- This allows filtering AND sorting from the index
CREATE INDEX idx_status_created ON users (status, created_at DESC);

-- Now the query can use the index efficiently
EXPLAIN SELECT id, name, email, created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20;

-- Result:
-- type: ref (using index)
-- key: idx_status_created
-- Extra: Using where (no filesort!)

-- Why this works:
-- 1. Index is ordered by (status, created_at DESC)
-- 2. MySQL finds 'active' entries in the index
-- 3. They're already sorted by created_at DESC
-- 4. Just read first 20 index entries!`,
			},
			{
				lang: "sql",
				description: "Even better: Covering index",
				code: `-- Include all selected columns in the index
-- This avoids accessing the main table entirely!
CREATE INDEX idx_status_created_covering
ON users (status, created_at DESC, id, name, email);

-- Or in MySQL 8.0+, use INCLUDE syntax:
CREATE INDEX idx_status_created_covering
ON users (status, created_at DESC)
INCLUDE (id, name, email);

EXPLAIN SELECT id, name, email, created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20;

-- Extra: Using index (covering index!)
-- The entire query is satisfied from the index
-- No table access needed at all`,
			},
			{
				lang: "sql",
				description: "Alternative: Force index usage (not recommended)",
				code: `-- You CAN force MySQL to use an index
-- But this is usually WRONG - optimizer knows better

SELECT id, name, email, created_at
FROM users FORCE INDEX (idx_status)
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20;

-- This will likely be SLOWER than the full scan
-- because you're forcing suboptimal I/O patterns

-- Only force index when:
-- 1. Optimizer statistics are stale (run ANALYZE TABLE)
-- 2. You have domain knowledge optimizer doesn't have
-- 3. Temporary debugging/testing

-- Better: Fix the root cause with proper index design`,
			},
		],

		prevention: [
			"Consider cardinality before creating single-column indexes",
			"Create compound indexes that match both WHERE and ORDER BY",
			"Use EXPLAIN to verify indexes are actually being used",
			"Run ANALYZE TABLE periodically to update index statistics",
			"Consider covering indexes for frequently-run queries",
			"Don't assume 'index exists' means 'index is used'",
		],

		educationalInsights: [
			"Index cardinality = number of unique values in the indexed column",
			"Low cardinality indexes (<1% selectivity) are often ignored by optimizer",
			"Full table scans can be faster than index access for wide filters",
			"Compound indexes can satisfy WHERE + ORDER BY efficiently",
			"Covering indexes avoid table access entirely (fastest option)",
			"The optimizer usually makes the right choice - don't fight it blindly",
		],
	},
};

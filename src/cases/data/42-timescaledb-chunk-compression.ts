import type { DetectiveCase } from "../../types";

export const timescaledbChunkCompression: DetectiveCase = {
	id: "timescaledb-chunk-compression",
	title: "The TimescaleDB Disk Disaster",
	subtitle: "Disk space exhausted despite data retention policy",
	difficulty: "mid",
	category: "database",

	crisis: {
		description: `
			Your TimescaleDB instance storing IoT sensor data is running out of disk.
			You have a 30-day retention policy that drops old data, but disk usage keeps
			growing. The database was supposed to stabilize at ~500GB but it's now at
			1.8TB and climbing. Alerts are firing for 90% disk usage.
		`,
		impact: `
			Database approaching disk full. Writes will fail when disk exhausted.
			2 days until complete storage failure at current growth rate.
			IoT data pipeline will back up and lose data.
		`,
		timeline: [
			{ time: "Month 1", event: "TimescaleDB deployed with 30-day retention", type: "normal" },
			{ time: "Month 2", event: "Expected disk usage of ~500GB reached", type: "normal" },
			{ time: "Month 3", event: "Disk usage continues growing to 800GB", type: "warning" },
			{ time: "Month 4", event: "Disk usage at 1.2TB, retention policy verified", type: "warning" },
			{ time: "Month 5", event: "Disk usage at 1.8TB (90%), alerts critical", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Data retention policy configured correctly",
			"Old chunks being dropped on schedule",
			"New data inserting successfully",
			"Query performance acceptable",
			"Database otherwise healthy",
		],
		broken: [
			"Disk usage growing despite retention",
			"Size of recent chunks much larger than expected",
			"Compression policy exists but chunks aren't shrinking",
			"DROP_CHUNKS job running but disk not freed",
			"1.8TB used vs expected 500GB",
		],
	},

	clues: [
		{
			id: 1,
			title: "Chunk Information",
			type: "logs",
			content: `\`\`\`sql
SELECT
    chunk_name,
    range_start,
    range_end,
    pg_size_pretty(total_bytes) as total_size,
    pg_size_pretty(table_bytes) as table_size,
    is_compressed
FROM chunk_detailed_size('sensor_data')
ORDER BY range_start DESC
LIMIT 10;

         chunk_name          |       range_start       |        range_end        | total_size | table_size | is_compressed
-----------------------------+-------------------------+-------------------------+------------+------------+---------------
 _hyper_1_1456_chunk         | 2024-01-15 00:00:00     | 2024-01-16 00:00:00     | 45 GB      | 44 GB      | false
 _hyper_1_1455_chunk         | 2024-01-14 00:00:00     | 2024-01-15 00:00:00     | 44 GB      | 43 GB      | false
 _hyper_1_1454_chunk         | 2024-01-13 00:00:00     | 2024-01-14 00:00:00     | 46 GB      | 45 GB      | false
 _hyper_1_1453_chunk         | 2024-01-12 00:00:00     | 2024-01-13 00:00:00     | 43 GB      | 42 GB      | false
 _hyper_1_1452_chunk         | 2024-01-11 00:00:00     | 2024-01-12 00:00:00     | 45 GB      | 44 GB      | false
 ...all chunks show is_compressed = false...
\`\`\``,
			hint: "None of the chunks are compressed...",
		},
		{
			id: 2,
			title: "TimescaleDB Policies",
			type: "config",
			content: `\`\`\`sql
-- Check retention policy
SELECT * FROM timescaledb_information.jobs
WHERE proc_name = 'policy_retention';

 job_id | schedule_interval | proc_name        | config
--------+-------------------+------------------+--------------------------------
     1  | 1 day             | policy_retention | {"drop_after": "30 days", ...}

-- Check compression policy
SELECT * FROM timescaledb_information.jobs
WHERE proc_name = 'policy_compression';

 job_id | schedule_interval | proc_name          | config
--------+-------------------+--------------------+-----------------------------------
     2  | 1 day             | policy_compression | {"compress_after": "7 days", ...}

-- Both policies exist! But check job run history...
SELECT job_id, total_runs, total_successes, total_failures, last_run_status
FROM timescaledb_information.job_stats;

 job_id | total_runs | total_successes | total_failures | last_run_status
--------+------------+-----------------+----------------+------------------
      1 |        150 |             150 |              0 | Success
      2 |        150 |               0 |            150 | Failed
\`\`\``,
			hint: "Retention job succeeds, but compression job fails every time...",
		},
		{
			id: 3,
			title: "Compression Job Error",
			type: "logs",
			content: `\`\`\`sql
-- Check job errors
SELECT job_id, finish_time, data
FROM timescaledb_information.job_history
WHERE job_id = 2
ORDER BY finish_time DESC
LIMIT 3;

 job_id |        finish_time        |                        data
--------+---------------------------+----------------------------------------------------
      2 | 2024-01-15 03:00:05       | {"error": "function compress_chunk(regclass) does not exist"}
      2 | 2024-01-14 03:00:04       | {"error": "function compress_chunk(regclass) does not exist"}
      2 | 2024-01-13 03:00:06       | {"error": "function compress_chunk(regclass) does not exist"}

-- The compression function doesn't exist!
\`\`\``,
			hint: "The compress_chunk function is missing...",
		},
		{
			id: 4,
			title: "Extension Status",
			type: "logs",
			content: `\`\`\`sql
-- Check TimescaleDB version
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';

  extname   | extversion
------------+------------
 timescaledb | 2.0.0

-- Check available versions
SELECT version()
  AS "PostgreSQL Version",
  timescaledb_information.current_extension_version() AS "Current Version",
  timescaledb_information.latest_extension_version() AS "Latest Version";

      PostgreSQL Version       | Current Version | Latest Version
------------------------------+-----------------+----------------
 PostgreSQL 14.5              | 2.0.0           | 2.13.0

-- We're running TimescaleDB 2.0.0, but 2.13.0 is available!
-- Let's check if the extension is up to date with its functions

SELECT proname FROM pg_proc WHERE proname LIKE '%compress%';

      proname
------------------
 compress_hypertable
 decompress_chunk   -- no compress_chunk!

-- After the extension was updated, ALTER EXTENSION was never run
\`\`\``,
			hint: "The TimescaleDB extension wasn't properly upgraded...",
		},
		{
			id: 5,
			title: "DBA Investigation",
			type: "testimony",
			content: `"I remember now. Three months ago we upgraded the TimescaleDB package
as part of routine maintenance. The new version was installed, and the
database restarted.

But I forgot to run ALTER EXTENSION timescaledb UPDATE after the
package upgrade. The extension catalog still thinks it's version 2.0.0,
even though the new library is loaded.

This caused a mismatch:
- The compression policy was created with the new version's syntax
- But the extension's SQL functions are still the old version
- The compress_chunk function doesn't exist in the old function set
- Every compression attempt fails silently

Meanwhile, new chunks are created every day (40-45GB each).
Retention drops the oldest chunks, but without compression we're
storing 30 days of UNCOMPRESSED data instead of ~7 days uncompressed
+ 23 days compressed."`,
		},
		{
			id: 6,
			title: "Disk Usage Analysis",
			type: "metrics",
			content: `\`\`\`
Expected vs Actual Disk Usage:
==============================

Daily data volume: ~45 GB uncompressed

WITH COMPRESSION (expected):
- Days 1-7: Uncompressed = 7 × 45 GB = 315 GB
- Days 8-30: Compressed (~90% ratio) = 23 × 4.5 GB = 103.5 GB
- Total: ~420 GB (round to 500 GB with overhead)

WITHOUT COMPRESSION (actual):
- Days 1-30: Uncompressed = 30 × 45 GB = 1,350 GB
- Plus indexes and metadata: ~450 GB
- Total: ~1,800 GB

Compression provides ~70% storage reduction for time-series data.
Without it, we use 3-4x more disk than planned.

At current growth:
- Adding 45 GB/day
- Removing 45 GB/day (retention)
- Should be stable BUT...
- Drop happens after retention period
- Compression should happen after 7 days
- Gap = 23 days of uncompressed data that should be compressed
\`\`\``,
			hint: "23 days of data should be compressed but isn't...",
		},
	],

	solution: {
		diagnosis: "Compression policy failing due to incomplete TimescaleDB extension upgrade",

		keywords: [
			"compression",
			"chunk",
			"TimescaleDB",
			"disk space",
			"extension upgrade",
			"ALTER EXTENSION",
			"compress_chunk",
			"hypertable",
		],

		rootCause: `
			TimescaleDB was upgraded at the package level but the database extension
			was never updated with \`ALTER EXTENSION timescaledb UPDATE\`.

			This created a version mismatch:
			1. New TimescaleDB library (2.13.0) was loaded by PostgreSQL
			2. Extension catalog still registered as version 2.0.0
			3. SQL functions (like compress_chunk) remained at old version
			4. Compression policy created with new syntax called missing function
			5. Every compression job failed with "function does not exist"

			Without compression:
			- Each daily chunk uses ~45GB (uncompressed)
			- 30-day retention means 30 × 45GB = 1,350GB of data
			- With compression, days 8-30 would be ~4.5GB each
			- Missing compression = 23 days × 40GB extra = ~920GB wasted

			The retention policy worked correctly (dropping old chunks), but since
			compression never ran, disk usage was 3-4x higher than expected.
		`,

		codeExamples: [
			{
				lang: "sql",
				description: "Fix: Complete the extension upgrade",
				code: `-- Step 1: Check current version
SELECT default_version, installed_version
FROM pg_available_extensions
WHERE name = 'timescaledb';

-- Step 2: Update the extension
ALTER EXTENSION timescaledb UPDATE;

-- Step 3: Verify the update
SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';

-- Step 4: Check compress_chunk exists now
SELECT proname FROM pg_proc WHERE proname = 'compress_chunk';

-- Step 5: Verify compression policy will work
SELECT * FROM timescaledb_information.jobs
WHERE proc_name = 'policy_compression';`,
			},
			{
				lang: "sql",
				description: "Manually compress existing chunks to free space immediately",
				code: `-- Find all chunks older than 7 days that should be compressed
SELECT show_chunks('sensor_data', older_than => INTERVAL '7 days');

-- Compress chunks one by one (can be slow, do during maintenance)
SELECT compress_chunk('_timescaledb_internal._hyper_1_1426_chunk');
SELECT compress_chunk('_timescaledb_internal._hyper_1_1427_chunk');
-- ... repeat for each chunk

-- Or compress all eligible chunks at once
SELECT compress_chunk(c)
FROM show_chunks('sensor_data', older_than => INTERVAL '7 days') c;

-- Monitor compression progress
SELECT
    chunk_name,
    before_compression_total_bytes,
    after_compression_total_bytes,
    compression_ratio
FROM chunk_compression_stats('sensor_data');`,
			},
			{
				lang: "sql",
				description: "Set up proper monitoring for compression jobs",
				code: `-- Create a monitoring view for job health
CREATE VIEW compression_job_health AS
SELECT
    j.job_id,
    j.proc_name,
    js.total_runs,
    js.total_successes,
    js.total_failures,
    js.last_run_status,
    js.last_successful_finish,
    CASE
        WHEN js.total_failures > 0 THEN 'UNHEALTHY'
        WHEN js.last_run_status = 'Failed' THEN 'FAILING'
        WHEN js.last_successful_finish < NOW() - INTERVAL '2 days' THEN 'STALE'
        ELSE 'HEALTHY'
    END as health_status
FROM timescaledb_information.jobs j
JOIN timescaledb_information.job_stats js ON j.job_id = js.job_id
WHERE j.proc_name LIKE 'policy%';

-- Check it regularly
SELECT * FROM compression_job_health;

-- Set up alert on failures
-- (Use your monitoring system's SQL integration)
SELECT COUNT(*) as failed_jobs
FROM timescaledb_information.job_stats
WHERE total_failures > 0
  AND last_run_status = 'Failed';`,
			},
		],

		prevention: [
			"Always run ALTER EXTENSION UPDATE after package upgrades",
			"Monitor compression job success rate, not just schedule",
			"Alert on unexpected disk growth vs baseline",
			"Include extension version in database runbooks",
			"Test upgrades in staging with compression workloads",
			"Document the full upgrade procedure including SQL steps",
		],

		educationalInsights: [
			"PostgreSQL extensions have two components: library and catalog",
			"Package upgrade only updates the library, not the catalog",
			"ALTER EXTENSION UPDATE synchronizes catalog with library",
			"TimescaleDB compression typically achieves 90%+ reduction for time-series",
			"Chunk compression is essential for TimescaleDB cost efficiency",
			"Silent job failures can accumulate into major incidents",
			"Disk is cheap but time-series data at scale adds up fast",
		],
	},
};

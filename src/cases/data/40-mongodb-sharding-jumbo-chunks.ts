import type { DetectiveCase } from "../../types";

export const mongodbShardingJumboChunks: DetectiveCase = {
	id: "mongodb-sharding-jumbo-chunks",
	title: "The MongoDB Jumbo Chunk Jam",
	subtitle: "Unbalanced cluster due to unsplittable chunks",
	difficulty: "senior",
	category: "database",

	crisis: {
		description: `
			Your sharded MongoDB cluster is severely unbalanced. One shard holds 70%
			of the data while others are nearly empty. The balancer is running but
			nothing is moving. Queries to the overloaded shard are timing out.
		`,
		impact: `
			Shard 1 at 95% disk capacity, approaching failure. Queries routing to
			shard 1 timing out. Other shards sitting idle with 20% utilization.
			Cannot add more data until rebalancing completes.
		`,
		timeline: [
			{ time: "6 months ago", event: "Sharding enabled on events collection", type: "normal" },
			{ time: "3 months ago", event: "Shard 1 noticed to be larger than others", type: "warning" },
			{ time: "1 month ago", event: "Shard imbalance reaching 60/20/20", type: "warning" },
			{ time: "1 week ago", event: "Shard 1 at 80% disk, alerts firing", type: "critical" },
			{ time: "Today", event: "Shard 1 at 95% disk, queries failing", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Balancer shows as running",
			"New inserts succeeding",
			"Queries to other shards fast",
			"Config servers healthy",
			"All shards reachable",
		],
		broken: [
			"Shard 1 has 70% of data, others have 15% each",
			"Chunks not migrating despite balancer running",
			"Many chunks marked as 'jumbo'",
			"Shard 1 queries timing out",
			"Cannot manually split chunks",
		],
	},

	clues: [
		{
			id: 1,
			title: "Chunk Distribution",
			type: "metrics",
			content: `\`\`\`javascript
// sh.status() output
--- Sharding Status ---
  sharding version: { ... }
  shards:
    { "_id": "shard1", "host": "shard1/mongo1:27017", "state": 1 }
    { "_id": "shard2", "host": "shard2/mongo2:27017", "state": 1 }
    { "_id": "shard3", "host": "shard3/mongo3:27017", "state": 1 }

  databases:
    { "_id": "analytics", "primary": "shard1", "partitioned": true }
      analytics.events
        shard key: { "timestamp": 1 }
        chunks:
          shard1: 847 (623 jumbo)
          shard2: 12
          shard3: 8

        too many chunks to print, use verbose if you want to see them
\`\`\``,
			hint: "623 chunks are marked 'jumbo'...",
		},
		{
			id: 2,
			title: "Chunk Details",
			type: "logs",
			content: `\`\`\`javascript
// Query chunks for the events collection
db.getSiblingDB("config").chunks.find({ns: "analytics.events"}).limit(5)

{ "_id": "analytics.events-timestamp_MinKey",
  "ns": "analytics.events",
  "min": { "timestamp": MinKey },
  "max": { "timestamp": ISODate("2023-06-01") },
  "shard": "shard1",
  "jumbo": true },  // JUMBO!

{ "_id": "analytics.events-timestamp_2023-06-01",
  "ns": "analytics.events",
  "min": { "timestamp": ISODate("2023-06-01") },
  "max": { "timestamp": ISODate("2023-06-02") },
  "shard": "shard1",
  "jumbo": true },  // Every day is its own chunk, all jumbo

// Note: Each chunk covers one day but contains millions of docs
// Chunks are 2-5 GB each but cannot be split
\`\`\``,
			hint: "Each day is a chunk, but they're all too big and can't be split...",
		},
		{
			id: 3,
			title: "Shard Key and Schema",
			type: "code",
			content: `\`\`\`javascript
// Collection schema
{
    _id: ObjectId,
    timestamp: ISODate,      // Shard key
    userId: String,
    eventType: String,
    payload: Object
}

// Shard key configuration
sh.shardCollection("analytics.events", { timestamp: 1 })

// Typical data pattern:
// - 10 million events per day
// - All events for a given minute have same timestamp (rounded)
// - Events are inserted with current timestamp

// Sample timestamps (many identical values):
ISODate("2023-10-15T14:30:00.000Z")  // 50,000 docs
ISODate("2023-10-15T14:31:00.000Z")  // 48,000 docs
ISODate("2023-10-15T14:32:00.000Z")  // 51,000 docs
\`\`\``,
			hint: "The shard key has low cardinality and is monotonically increasing...",
		},
		{
			id: 4,
			title: "Jumbo Chunk Mechanics",
			type: "config",
			content: `\`\`\`
MongoDB Chunk Splitting:
========================

- Chunks split when they exceed chunkSize (default 64MB)
- Split point must be a different shard key value
- If all documents in chunk have SAME key value, cannot split

Jumbo Chunks:
- Chunk larger than chunkSize that CANNOT be split
- Occurs when many docs have identical shard key value
- Balancer CANNOT move jumbo chunks (too large for migration)
- Chunk is "stuck" on its current shard

Root causes of jumbo chunks:
1. Low cardinality shard key (few unique values)
2. Monotonically increasing key (all new data goes to one chunk)
3. Hot spots (popular key values)

The events collection problem:
- timestamp rounded to minute = ~1440 unique values per day
- 10M events / 1440 minutes = ~7000 docs per key value
- Chunk for minute X contains 7000 docs with IDENTICAL key
- When chunk exceeds 64MB, it cannot split (no split point)
- Result: jumbo chunk that cannot be migrated
\`\`\``,
			hint: "Cannot split a chunk where all documents have the same shard key value...",
		},
		{
			id: 5,
			title: "Data Architect Analysis",
			type: "testimony",
			content: `"We chose timestamp as the shard key because our queries always
filter by time range. It seemed logical.

But timestamp has two fatal flaws for sharding:

1. MONOTONIC: New data always has 'now' as timestamp, which means
   all inserts go to the chunk containing 'max timestamp'. That
   single shard handles 100% of write load.

2. LOW CARDINALITY: We round timestamps to the minute. With
   ~7000 events per minute and chunk splits requiring different
   key values, we create chunks with 7000 identical keys that
   can never be split.

After 6 months, shard1 has accumulated all the historical data
that can't be migrated because every chunk is jumbo. The other
shards only have the few chunks that happened to be small enough
to migrate."`,
		},
		{
			id: 6,
			title: "Balancer Logs",
			type: "logs",
			content: `\`\`\`
// From mongos logs
2023-10-15T10:23:45.123 I SHARDING [Balancer] Balancer move failed:
  chunk: analytics.events-timestamp_2023-06-15
  from: shard1
  to: shard2
  error: "chunk too big to move"

2023-10-15T10:23:46.234 I SHARDING [Balancer] Cannot split chunk:
  chunk: analytics.events-timestamp_2023-06-15
  reason: "no split points found"

2023-10-15T10:24:00.345 I SHARDING [Balancer] Balancer round statistics:
  candidate chunks to move: 623
  successfully moved: 0
  failed to move (jumbo): 623

// The balancer tries every round but every chunk fails to move
\`\`\``,
			hint: "Balancer is trying but every chunk is too big and can't be split...",
		},
	],

	solution: {
		diagnosis: "Monotonic, low-cardinality shard key causing jumbo chunks",

		keywords: [
			"jumbo chunk",
			"shard key",
			"cardinality",
			"monotonic",
			"hot shard",
			"balancer",
			"chunk split",
			"unbalanced",
			"migration",
		],

		rootCause: `
			The collection uses \`timestamp\` as its shard key, which has two critical problems:

			1. **Monotonically Increasing**: All new inserts have timestamp = "now", so they
			   all route to the chunk containing the maximum timestamp. One shard receives
			   100% of write load while others sit idle.

			2. **Low Cardinality per Chunk**: Timestamps are rounded to the minute, creating
			   ~7000 documents with identical shard key values. MongoDB cannot split a chunk
			   unless there's a different key value to split on. When all documents in a
			   chunk have the same key value, the chunk becomes "jumbo" - oversized but
			   unsplittable.

			The cascade of problems:
			- Chunks grow beyond 64MB but can't split (jumbo)
			- Jumbo chunks can't be migrated by the balancer (too large)
			- All new data piles onto shard1
			- Other shards remain nearly empty
			- Eventually shard1 fills up completely

			The fix requires changing the shard key to something with high cardinality
			and good distribution. This typically means resharding the entire collection.
		`,

		codeExamples: [
			{
				lang: "javascript",
				description: "Create new collection with proper compound shard key",
				code: `// Step 1: Create new collection with compound shard key
// Using timestamp + _id gives both time-based routing AND high cardinality

sh.shardCollection(
    "analytics.events_v2",
    { timestamp: 1, _id: 1 }  // Compound key!
);

// Alternative: Hashed shard key for even distribution
sh.shardCollection(
    "analytics.events_v2",
    { _id: "hashed" }  // Even distribution, but loses time locality
);

// Best of both worlds: Hashed prefix + timestamp
// Requires MongoDB 4.4+
sh.shardCollection(
    "analytics.events_v2",
    { hashedUserId: "hashed", timestamp: 1 }
);`,
			},
			{
				lang: "javascript",
				description: "Migrate data to new collection",
				code: `// Step 2: Migrate data in batches
async function migrateEvents() {
    const batchSize = 10000;
    let lastId = ObjectId("000000000000000000000000");

    while (true) {
        const batch = await db.events.find(
            { _id: { $gt: lastId } }
        )
        .sort({ _id: 1 })
        .limit(batchSize)
        .toArray();

        if (batch.length === 0) break;

        // Insert to new collection
        await db.events_v2.insertMany(batch, { ordered: false });

        lastId = batch[batch.length - 1]._id;

        // Log progress
        print(\`Migrated batch ending at \${lastId}\`);

        // Small delay to reduce load
        sleep(100);
    }

    print("Migration complete!");
}

// Step 3: Rename collections
db.events.renameCollection("events_old");
db.events_v2.renameCollection("events");`,
			},
			{
				lang: "javascript",
				description: "Clear jumbo flag for emergency migration (temporary fix)",
				code: `// WARNING: This is a workaround, not a fix
// Allows migration but chunks may fail to move if truly too large

// Connect to config database
use config

// Find jumbo chunks
db.chunks.find({ ns: "analytics.events", jumbo: true }).count()

// Clear jumbo flag to allow migration attempts
db.chunks.updateMany(
    { ns: "analytics.events", jumbo: true },
    { $unset: { jumbo: "" } }
);

// Trigger balancer
sh.startBalancer();

// Monitor migration
// Note: If chunks are truly too large, they'll be marked jumbo again
db.chunks.find({
    ns: "analytics.events",
    jumbo: true
}).count();

// Alternative: Manually split at specific points
// Only works if there ARE different key values in the chunk
sh.splitAt("analytics.events", { timestamp: ISODate("2023-06-15T12:00:00Z") });`,
			},
		],

		prevention: [
			"Never use monotonically increasing fields as shard key alone",
			"Ensure shard key has high cardinality (many unique values)",
			"Use compound shard keys: { shardKey: 1, _id: 1 }",
			"Consider hashed shard keys for even distribution",
			"Monitor chunk distribution and jumbo chunk count regularly",
			"Test shard key selection with production-like data volumes",
		],

		educationalInsights: [
			"Shard key choice is the most important sharding decision - hard to change later",
			"Monotonic keys (timestamps, auto-increment) create hot spots",
			"Cardinality refers to the number of unique shard key values",
			"Jumbo chunks cannot be split or migrated - they're stuck forever",
			"Compound shard keys combine routing efficiency with distribution",
			"Hashed shard keys trade query routing for perfect distribution",
			"MongoDB 5.0+ allows resharding without downtime (still expensive)",
		],
	},
};

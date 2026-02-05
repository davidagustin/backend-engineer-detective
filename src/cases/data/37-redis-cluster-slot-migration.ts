import type { DetectiveCase } from "../../types";

export const redisClusterSlotMigration: DetectiveCase = {
	id: "redis-cluster-slot-migration",
	title: "The Redis Cluster Chaos",
	subtitle: "Random cache misses and errors during cluster rebalancing",
	difficulty: "senior",
	category: "caching",

	crisis: {
		description: `
			Your Redis cluster is being rebalanced to add a new node. During the
			migration, users are experiencing random cache misses and occasional
			MOVED/ASK errors bubbling up to the application. Some requests fail
			entirely with connection errors.
		`,
		impact: `
			Cache hit rate dropped from 95% to 60%. Database load increased 3x
			due to cache misses. P99 latency spiked from 50ms to 800ms. Some
			API endpoints returning 500 errors intermittently.
		`,
		timeline: [
			{ time: "10:00 AM", event: "Started adding redis-7 node to cluster", type: "normal" },
			{ time: "10:05 AM", event: "Initiated rebalancing to migrate slots", type: "normal" },
			{ time: "10:10 AM", event: "First MOVED errors in application logs", type: "warning" },
			{ time: "10:15 AM", event: "Cache hit rate dropping", type: "warning" },
			{ time: "10:30 AM", event: "Database CPU spiking due to cache misses", type: "critical" },
			{ time: "10:45 AM", event: "Intermittent 500 errors reported", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Redis nodes all report healthy",
			"Cluster INFO shows all nodes in cluster",
			"Some keys accessible without issues",
			"New writes succeeding (eventually)",
			"Admin commands to Redis work fine",
		],
		broken: [
			"Random MOVED errors in application",
			"ASK redirections causing confusion",
			"Keys sometimes not found during migration",
			"Connection pool exhaustion during retries",
			"Cluster topology changes not detected by client",
		],
	},

	clues: [
		{
			id: 1,
			title: "Application Error Logs",
			type: "logs",
			content: `\`\`\`
10:12:34 ERROR RedisClient: MOVED 5798 192.168.1.107:6379
10:12:34 ERROR CacheService: Failed to get key user:12345
10:12:35 ERROR RedisClient: ASK 5798 192.168.1.107:6379
10:12:35 WARN  CacheService: Cache miss for user:12345, falling back to DB
10:12:36 ERROR RedisClient: CLUSTERDOWN The cluster is down
10:12:37 ERROR RedisClient: Connection refused to 192.168.1.107:6379
10:12:38 ERROR CacheService: Redis unavailable, DB query for user:12345
\`\`\``,
			hint: "MOVED and ASK are Redis cluster redirect messages...",
		},
		{
			id: 2,
			title: "Redis Client Configuration",
			type: "code",
			content: `\`\`\`javascript
// cache/redis.js
const Redis = require('ioredis');

const redis = new Redis({
    host: 'redis-1.internal',
    port: 6379,
    // Note: Connecting to single node, not cluster-aware
});

async function getUser(userId) {
    const key = \`user:\${userId}\`;
    const cached = await redis.get(key);

    if (!cached) {
        // Cache miss - fetch from DB
        const user = await db.users.findById(userId);
        await redis.setex(key, 3600, JSON.stringify(user));
        return user;
    }

    return JSON.parse(cached);
}
\`\`\``,
			hint: "Is this client configured for cluster mode?",
		},
		{
			id: 3,
			title: "Cluster Slot Status",
			type: "logs",
			content: `\`\`\`bash
$ redis-cli -c cluster slots

1) 1) (integer) 0
   2) (integer) 5460
   3) 1) "192.168.1.101"
      2) (integer) 6379
2) 1) (integer) 5461
   2) (integer) 10922
   3) 1) "192.168.1.102"
      2) (integer) 6379
3) 1) (integer) 10923
   2) (integer) 16383
   3) 1) "192.168.1.103"
      2) (integer) 6379

# Some slots currently migrating:
$ redis-cli cluster info | grep migrating
cluster_slots_migrating:500

# Slot 5798 status:
$ redis-cli cluster getkeysinslot 5798 10
1) "user:12345"
2) "user:67890"
3) "session:abc123"
\`\`\``,
			hint: "Slot 5798 is in the middle of migration...",
		},
		{
			id: 4,
			title: "Redis Cluster Protocol",
			type: "config",
			content: `\`\`\`
Redis Cluster Redirect Protocol:
================================

MOVED <slot> <ip>:<port>
  - Key has permanently moved to a new node
  - Client should update its slot mapping
  - Client should retry command on new node

ASK <slot> <ip>:<port>
  - Key is being migrated (temporary)
  - Client must send ASKING command first, then retry
  - Client should NOT update slot mapping

During slot migration:
1. Source node marks slot as MIGRATING
2. Target node marks slot as IMPORTING
3. Existing keys still on source until explicitly moved
4. New keys go to target
5. Client may get ASK for keys still on source

Non-cluster-aware clients:
- Don't understand MOVED/ASK
- Don't follow redirects
- See these as errors, not instructions
\`\`\``,
			hint: "The client must understand cluster protocol to handle redirects...",
		},
		{
			id: 5,
			title: "Infrastructure Engineer Testimony",
			type: "testimony",
			content: `"We added redis-7 and ran 'redis-cli --cluster rebalance' to
redistribute slots. The migration moves ~2700 slots to the new node.

The problem is our application uses a basic Redis client connected
to redis-1. When a key's slot moves to redis-7, the client has no
idea. It asks redis-1 for the key, gets MOVED, and treats it as an
error instead of following the redirect.

We should be using a cluster-aware client that:
1. Maintains a map of slots -> nodes
2. Follows MOVED redirects and updates its map
3. Handles ASK redirects during migrations
4. Automatically discovers new nodes"`,
		},
		{
			id: 6,
			title: "Connection Pool Metrics",
			type: "metrics",
			content: `\`\`\`
Redis Connection Pool Stats:
============================
Pool: redis-1 (our only configured node)
  Active connections: 50/50 (MAXED)
  Waiting requests: 234
  Timeouts: 89/min

Key Distribution After Migration Start:
  redis-1: 30% of keys (down from 33%)
  redis-2: 33% of keys
  redis-3: 33% of keys
  redis-7: 4% of keys (migrated so far)

Client Behavior During Redirect:
  1. Request key from redis-1
  2. Receive MOVED error
  3. Treat as failure, retry redis-1
  4. Repeat until timeout
  5. Fall back to database

No connections to redis-7 (client doesn't know it exists)
\`\`\``,
			hint: "Client only knows about redis-1, not the new node...",
		},
	],

	solution: {
		diagnosis: "Non-cluster-aware Redis client unable to follow slot redirects",

		keywords: [
			"cluster",
			"redis cluster",
			"MOVED",
			"ASK",
			"slot",
			"migration",
			"redirect",
			"cluster-aware",
			"rebalance",
		],

		rootCause: `
			The application uses a basic Redis client connected to a single node
			(redis-1), but the infrastructure is actually a Redis Cluster.

			Redis Cluster distributes data across nodes using hash slots (0-16383).
			When slots migrate during rebalancing:

			1. Client asks redis-1 for key "user:12345"
			2. Slot 5798 (hash of key) has moved to redis-7
			3. Redis-1 responds: MOVED 5798 192.168.1.107:6379
			4. Basic client treats MOVED as an error (doesn't understand protocol)
			5. Client retries redis-1 (same result)
			6. Eventually times out and falls back to database

			The MOVED response is not an error - it's an instruction to redirect to
			the correct node. A cluster-aware client would:
			- Parse the MOVED response
			- Update its internal slot->node mapping
			- Retry the command on redis-7
			- Cache the mapping for future requests to slot 5798

			ASK errors during active migration add additional complexity that only
			cluster-aware clients can handle properly.
		`,

		codeExamples: [
			{
				lang: "javascript",
				description: "Fix: Use cluster-aware client configuration",
				code: `// cache/redis.js - Updated for cluster
const Redis = require('ioredis');

// Cluster-aware client with multiple seed nodes
const redis = new Redis.Cluster([
    { host: 'redis-1.internal', port: 6379 },
    { host: 'redis-2.internal', port: 6379 },
    { host: 'redis-3.internal', port: 6379 },
], {
    // Cluster-specific options
    redisOptions: {
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 5000,
    },

    // Automatically follow redirects
    enableReadyCheck: true,
    maxRedirections: 16,

    // Handle topology changes
    clusterRetryStrategy: (times) => {
        return Math.min(times * 100, 3000);
    },

    // Auto-refresh slot mapping
    slotsRefreshTimeout: 2000,
    slotsRefreshInterval: 5000,
});

redis.on('error', (err) => logger.error('Redis cluster error:', err));
redis.on('+node', (node) => logger.info('Node added:', node.options.host));
redis.on('-node', (node) => logger.info('Node removed:', node.options.host));`,
			},
			{
				lang: "javascript",
				description: "Handle MOVED/ASK in custom retry logic",
				code: `// If you must use basic client, implement redirect handling
async function clusterAwareGet(key, maxRetries = 3) {
    let node = determineNode(key);
    let retries = 0;

    while (retries < maxRetries) {
        try {
            return await node.get(key);
        } catch (err) {
            if (err.message.startsWith('MOVED')) {
                // MOVED 5798 192.168.1.107:6379
                const [, slot, target] = err.message.split(' ');
                const [host, port] = target.split(':');

                // Update slot mapping
                slotMap[slot] = { host, port };
                node = getConnection(host, port);

                retries++;
                continue;
            }

            if (err.message.startsWith('ASK')) {
                // ASK requires ASKING command first
                const [, slot, target] = err.message.split(' ');
                const [host, port] = target.split(':');
                const tempNode = getConnection(host, port);

                await tempNode.asking();
                return await tempNode.get(key);
            }

            throw err;
        }
    }

    throw new Error('Max redirections exceeded');
}`,
			},
			{
				lang: "bash",
				description: "Safer cluster rebalancing strategy",
				code: `# Instead of rebalancing all at once, migrate slots gradually

# Check cluster health first
redis-cli --cluster check 192.168.1.101:6379

# Rebalance with pipeline limit to reduce impact
redis-cli --cluster rebalance 192.168.1.101:6379 \\
    --cluster-use-empty-masters \\
    --cluster-pipeline 100 \\
    --cluster-threshold 2

# Or migrate specific slots manually for more control
redis-cli --cluster reshard 192.168.1.101:6379 \\
    --cluster-from <source-node-id> \\
    --cluster-to <target-node-id> \\
    --cluster-slots 500 \\
    --cluster-yes

# Monitor migration progress
watch -n 1 'redis-cli cluster info | grep -E "cluster_slots|cluster_known"'`,
			},
		],

		prevention: [
			"Always use cluster-aware Redis clients (ioredis.Cluster, redis-py-cluster)",
			"Test cluster operations in staging before production",
			"Rebalance during low-traffic periods with limited slot batches",
			"Monitor slot migration progress and application error rates",
			"Configure multiple seed nodes, not just one",
			"Implement proper error handling for MOVED/ASK redirects",
		],

		educationalInsights: [
			"Redis Cluster uses 16384 hash slots distributed across nodes",
			"MOVED is a permanent redirect; ASK is temporary during migration",
			"Basic Redis clients don't understand cluster protocol",
			"Slot migration can take minutes for large datasets",
			"CRC16 hash of key determines which slot (and node) owns it",
			"Cluster-aware clients cache slot mappings and refresh automatically",
		],
	},
};

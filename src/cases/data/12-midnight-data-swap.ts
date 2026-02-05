import type { DetectiveCase } from "../../types";

export const midnightDataSwap: DetectiveCase = {
	id: "midnight-data-swap",
	title: "The Midnight Data Swap",
	subtitle: "Users see each other's data during cluster rebalancing",
	difficulty: "senior",
	category: "distributed",

	crisis: {
		description:
			"During a Redis cluster scaling event, users temporarily saw other users' data. Player A would see Player B's inventory, friends list, and achievements. The event lasted 3 minutes but caused massive trust damage.",
		impact:
			"Privacy incident reported to legal. Users screenshotting other users' data. Social media outrage. Potential regulatory investigation.",
		timeline: [
			{ time: "03:00", event: "Scheduled Redis cluster scale-up begins", type: "normal" },
			{ time: "03:01", event: "First user reports seeing wrong data", type: "critical" },
			{ time: "03:02", event: "Hundreds of reports flooding in", type: "critical" },
			{ time: "03:04", event: "Data serving back to normal", type: "warning" },
			{ time: "03:30", event: "Incident declared, investigation begins", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Data eventually consistent",
			"No data loss occurred",
			"System recovered automatically",
			"Normal operations resume",
		],
		broken: [
			"Users saw other users' data",
			"Data swap was random/unpredictable",
			"Occurred during cluster operation",
			"Lasted about 3 minutes",
		],
	},

	clues: [
		{
			id: 1,
			title: "Redis Cluster Configuration",
			type: "config",
			content: `\`\`\`
Cluster: redis-prod-cluster
Nodes Before: 6 (3 primary + 3 replica)
Nodes After: 9 (6 primary + 3 replica)

Hash Slots: 16384 (Redis standard)
Slot Distribution Before:
  Node 1: 0-5460
  Node 2: 5461-10922
  Node 3: 10923-16383

Rebalancing redistributes slots to new nodes
\`\`\``,
		},
		{
			id: 2,
			title: "Application Cache Code",
			type: "code",
			content: `\`\`\`typescript
class UserDataCache {
  private redis: RedisCluster;
  private localCache: Map<string, { data: any; slot: number }>;

  constructor(redis: RedisCluster) {
    this.redis = redis;
    this.localCache = new Map();
  }

  async getUserData(userId: string): Promise<UserData> {
    const cacheKey = \`user:\${userId}\`;

    // Check local cache first
    const local = this.localCache.get(cacheKey);
    if (local) {
      return local.data;
    }

    // Get from Redis
    const data = await this.redis.hgetall(cacheKey);

    // Cache locally with the slot number for faster routing
    const slot = this.redis.keySlot(cacheKey);
    this.localCache.set(cacheKey, { data, slot });

    return data;
  }

  async setUserData(userId: string, data: UserData): Promise<void> {
    const cacheKey = \`user:\${userId}\`;
    await this.redis.hset(cacheKey, data);

    // Update local cache
    const slot = this.redis.keySlot(cacheKey);
    this.localCache.set(cacheKey, { data, slot });
  }
}
\`\`\``,
			hint: "What happens to the local cache when slots move?",
		},
		{
			id: 3,
			title: "Hash Slot Calculation",
			type: "code",
			content: `\`\`\`typescript
// Redis cluster uses CRC16 hash to assign keys to slots
function keySlot(key: string): number {
  const hash = crc16(key);
  return hash % 16384;
}

// During normal operation:
// "user:12345" → slot 7234 → Node 2
// "user:67890" → slot 3421 → Node 1

// During rebalancing, slots 5000-5460 moved from Node 1 to Node 4
// But the local cache doesn't know about the move!
\`\`\``,
		},
		{
			id: 4,
			title: "Rebalancing Event Log",
			type: "logs",
			content: `\`\`\`
[03:00:00] Cluster rebalancing started
[03:00:05] Moving slot 5000 from Node1 to Node4
[03:00:06] Moving slot 5001 from Node1 to Node4
...
[03:00:30] Moving slot 5460 from Node1 to Node4
[03:00:45] Slot migration complete, updating cluster topology

[03:00:45] WARNING: MOVED responses from cluster
[03:00:45] App: Received MOVED for key user:34521
[03:00:45] App: Received MOVED for key user:98734
[03:00:45] App: Refreshing cluster slots...
[03:00:48] App: Cluster slot cache refreshed

# 3 minute gap where local caches were stale
\`\`\``,
			hint: "What happens between slot migration and topology update?",
		},
		{
			id: 5,
			title: "Data Swap Investigation",
			type: "logs",
			content: `\`\`\`
Investigation findings:

User A (user:12345) reports seeing User B's (user:67890) data

Analysis:
- user:12345 → slot 7234
- user:67890 → slot 7234  ← SAME SLOT!

During rebalancing:
1. Slot 7234 moved from Node2 to Node5
2. Local cache for both users still pointed to Node2
3. Node2's slot 7234 data was in flux/stale
4. Some keys returned wrong data during migration

The local cache + slot number optimization created a race condition
where the cached "slot" was no longer valid but data was still being
served from it.
\`\`\``,
		},
		{
			id: 6,
			title: "Redis Protocol Details",
			type: "code",
			content: `\`\`\`
Redis Cluster Slot Migration Process:

1. SETSLOT slot MIGRATING target-node-id
   - Source node starts rejecting writes for slot
   - Reads still served from source

2. MIGRATE target-host target-port key [keys...] timeout
   - Keys physically moved to target

3. SETSLOT slot NODE target-node-id
   - Cluster topology updated
   - Clients should redirect

Problem: Between steps 1-3, the slot is in a transient state.
If an application has cached the old slot→node mapping AND
doesn't properly handle MOVED/ASK redirections, it may:
- Read stale data from old node
- Read partially migrated data
- Read data from wrong key (hash collision in transient state)
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Local slot caching combined with cluster rebalancing caused stale routing, serving data from wrong keys during slot migration",
		keywords: [
			"slot migration",
			"rebalancing",
			"cluster",
			"stale cache",
			"routing",
			"MOVED",
			"hash slot",
			"local cache",
		],
		rootCause: `The application had a local cache that stored not just the data, but also the Redis cluster slot number for "optimization". During cluster rebalancing:

1. Slots were being migrated between nodes
2. The local cache still contained old slot→node mappings
3. Requests using cached slot info were routed to nodes that no longer owned those slots
4. During migration, the old node might serve stale or partially migrated data
5. In the worst case, different keys that hash to the same slot got confused

The 3-minute window occurred because:
- Slot migration takes time (30-45 seconds)
- Cluster topology refresh has a delay
- Local cache TTL was too long
- Application didn't properly handle MOVED/ASK redirections

The fundamental issue: the local cache optimization broke the consistency guarantees of Redis Cluster during topology changes.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Remove local slot caching, trust the Redis client library",
				code: `class UserDataCache {
  private redis: RedisCluster;

  constructor(redis: RedisCluster) {
    this.redis = redis;
    // Remove local cache - let Redis client handle routing
  }

  async getUserData(userId: string): Promise<UserData> {
    const cacheKey = \`user:\${userId}\`;
    // Redis client library handles MOVED/ASK redirects automatically
    return await this.redis.hgetall(cacheKey);
  }

  async setUserData(userId: string, data: UserData): Promise<void> {
    const cacheKey = \`user:\${userId}\`;
    await this.redis.hset(cacheKey, data);
  }
}`,
			},
			{
				lang: "typescript",
				description: "If local cache is needed, invalidate on topology change",
				code: `class UserDataCache {
  private redis: RedisCluster;
  private localCache: Map<string, UserData>;

  constructor(redis: RedisCluster) {
    this.redis = redis;
    this.localCache = new Map();

    // Listen for cluster topology changes
    this.redis.on('cluster:slots-refresh', () => {
      console.log('Cluster topology changed, clearing local cache');
      this.localCache.clear();
    });

    // Also clear on any redirect
    this.redis.on('cluster:moved', () => {
      this.localCache.clear();
    });
  }

  async getUserData(userId: string): Promise<UserData> {
    const cacheKey = \`user:\${userId}\`;

    // Only cache data, not routing info
    const local = this.localCache.get(cacheKey);
    if (local) {
      return local;
    }

    const data = await this.redis.hgetall(cacheKey);
    this.localCache.set(cacheKey, data);
    return data;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Implement maintenance mode for cluster operations",
				code: `class ClusterMaintenanceMode {
  private isMaintenanceMode = false;
  private maintenanceStartTime: Date | null = null;

  async withMaintenanceMode<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.enterMaintenanceMode();
      return await operation();
    } finally {
      await this.exitMaintenanceMode();
    }
  }

  private async enterMaintenanceMode(): Promise<void> {
    this.isMaintenanceMode = true;
    this.maintenanceStartTime = new Date();

    // Notify all app servers to disable local caching
    await this.pubsub.publish('cluster:maintenance', { action: 'enter' });

    // Wait for acknowledgment from all servers
    await this.waitForAcks();
  }

  private async exitMaintenanceMode(): Promise<void> {
    // Force refresh cluster topology on all servers
    await this.pubsub.publish('cluster:maintenance', {
      action: 'exit',
      refreshSlots: true
    });

    this.isMaintenanceMode = false;
    this.maintenanceStartTime = null;
  }
}`,
			},
		],
		prevention: [
			"Don't cache cluster routing information in application code",
			"Let Redis client libraries handle MOVED/ASK redirections",
			"Listen for topology change events and invalidate caches",
			"Implement maintenance mode for planned cluster operations",
			"Test application behavior during cluster rebalancing",
			"Consider read replicas for read-heavy workloads instead of local caches",
		],
		educationalInsights: [
			"Optimizations can break consistency guarantees during edge cases",
			"Distributed systems have transient states between configurations",
			"Redis Cluster handles routing - applications shouldn't try to be smarter",
			"The MOVED response exists specifically to handle topology changes",
			"Privacy incidents from data swaps are often worse than downtime",
			"Scheduled maintenance operations should be treated as high-risk events",
		],
	},
};

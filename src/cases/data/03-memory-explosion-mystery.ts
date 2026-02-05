import type { DetectiveCase } from "../../types";

export const memoryExplosionMystery: DetectiveCase = {
	id: "memory-explosion-mystery",
	title: "The Memory Explosion Mystery",
	subtitle: "Redis memory grows without bound, then crashes",
	difficulty: "mid",
	category: "caching",

	crisis: {
		description:
			"The Redis cluster that powers real-time game state is running out of memory. Every few days it crashes, taking down all live multiplayer matches. Memory usage climbs steadily even with stable traffic.",
		impact:
			"3-4 cluster crashes per week. Each crash disconnects 100K+ active players. Match data lost on crash. Players losing ranked progress.",
		timeline: [
			{ time: "Monday", event: "Redis restarted, memory at 20%", type: "normal" },
			{ time: "Tuesday", event: "Memory at 45%", type: "normal" },
			{ time: "Wednesday", event: "Memory at 72%", type: "warning" },
			{ time: "Thursday AM", event: "Memory at 89%", type: "warning" },
			{ time: "Thursday PM", event: "Memory at 98%, OOM crash", type: "critical" },
			{ time: "Friday", event: "Restarted, memory at 18%", type: "normal" },
		],
	},

	symptoms: {
		working: [
			"Read operations are fast",
			"New data writes succeed",
			"Redis cluster is responsive",
			"Replication between nodes works",
			"No obvious error patterns",
		],
		broken: [
			"Memory grows ~15-20% per day",
			"Crashes every 3-5 days",
			"Memory doesn't recover after player logout",
			"Same growth pattern regardless of traffic",
		],
	},

	clues: [
		{
			id: 1,
			title: "Redis Memory Analysis",
			type: "metrics",
			content: `\`\`\`
redis-cli INFO memory

used_memory_human: 28.5G
used_memory_peak_human: 31.2G
maxmemory: 32G
maxmemory_policy: noeviction

# Key space analysis
db0:keys=2847293,expires=124892

Total Keys: 2,847,293
Keys with TTL: 124,892 (4.4%)
Keys without TTL: 2,722,401 (95.6%)
\`\`\``,
			hint: "That ratio of keys with TTL seems important...",
		},
		{
			id: 2,
			title: "Key Pattern Analysis",
			type: "logs",
			content: `\`\`\`
redis-cli --bigkeys (sample output)

Biggest stream: match:events:5847293 (1.2M entries)
Biggest stream: match:events:5847102 (987K entries)
Biggest stream: match:events:5846891 (876K entries)
Biggest hash: player:session:u_9284723 (12KB)
Biggest list: matchmaking:queue:ranked (8KB)

Sampled 10000 keys:
- match:events:* - 67% of sampled keys
- player:session:* - 21% of sampled keys
- match:state:* - 8% of sampled keys
- other - 4% of sampled keys
\`\`\``,
		},
		{
			id: 3,
			title: "Match Event Service Code",
			type: "code",
			content: `\`\`\`typescript
class MatchEventService {
  private redis: Redis;

  async recordMatchEvent(matchId: string, event: MatchEvent): Promise<void> {
    const streamKey = \`match:events:\${matchId}\`;

    // Add event to stream
    await this.redis.xadd(
      streamKey,
      '*', // Auto-generate ID
      'type', event.type,
      'data', JSON.stringify(event.data),
      'timestamp', Date.now().toString()
    );
  }

  async getMatchEvents(matchId: string): Promise<MatchEvent[]> {
    const streamKey = \`match:events:\${matchId}\`;
    const events = await this.redis.xrange(streamKey, '-', '+');
    return events.map(this.parseEvent);
  }
}
\`\`\``,
			hint: "What happens to the stream after the match ends?",
		},
		{
			id: 4,
			title: "Match Lifecycle Service",
			type: "code",
			content: `\`\`\`typescript
class MatchLifecycleService {
  async startMatch(matchId: string, players: Player[]): Promise<void> {
    // Initialize match state
    await this.redis.hset(\`match:state:\${matchId}\`, {
      status: 'active',
      players: JSON.stringify(players),
      startedAt: Date.now()
    });
    await this.redis.expire(\`match:state:\${matchId}\`, 7200); // 2 hour TTL
  }

  async endMatch(matchId: string, result: MatchResult): Promise<void> {
    // Update match state
    await this.redis.hset(\`match:state:\${matchId}\`, {
      status: 'completed',
      result: JSON.stringify(result),
      endedAt: Date.now()
    });

    // Archive to database
    await this.archiveService.archiveMatch(matchId);

    // Delete match state
    await this.redis.del(\`match:state:\${matchId}\`);
  }
}
\`\`\``,
		},
		{
			id: 5,
			title: "Daily Match Statistics",
			type: "metrics",
			content: `\`\`\`
Average matches per day: 150,000
Average events per match: 2,400
Average match duration: 18 minutes

Expected data per match:
- match:state - 2KB (with TTL, deleted on end)
- match:events stream - 240KB average

Data written daily: ~35GB
Data deleted daily: ~300MB (just match:state keys)
\`\`\``,
			hint: "Compare data written vs data deleted...",
		},
		{
			id: 6,
			title: "Stream Entry Count Query",
			type: "logs",
			content: `\`\`\`
redis-cli XINFO STREAM match:events:5847293

length: 1247893
first-entry: 1699284723847-0
last-entry: 1699291847293-0
max-deleted-entry-id: 0-0  # Never trimmed

# This stream is from a match that ended 3 days ago
# Match ended at: 1699291850000
# Current time: 1699550400000

Match status in database: completed
Match state in Redis: deleted (correctly)
Match events in Redis: still present (1.2M entries)
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Redis streams (match events) are never cleaned up after matches end",
		keywords: [
			"stream",
			"cleanup",
			"unbounded",
			"no ttl",
			"xadd",
			"xtrim",
			"never deleted",
			"event stream",
			"accumulating",
			"no expiry",
		],
		rootCause: `The MatchEventService uses Redis Streams to record match events, but never cleans them up. While the MatchLifecycleService correctly:
- Sets TTL on match:state keys
- Deletes match:state when the match ends

The match:events streams are:
- Created without any TTL
- Never trimmed or deleted
- Accumulating 150,000 new streams per day
- Each stream contains ~2,400 entries

With 150K matches/day and no cleanup:
- Day 1: 35GB of event streams
- Day 2: 70GB total
- Day 3: 105GB total → exceeds 32GB memory

The streams from completed matches serve no purpose but continue consuming memory until the cluster crashes.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Delete stream when match ends",
				code: `class MatchLifecycleService {
  async endMatch(matchId: string, result: MatchResult): Promise<void> {
    // Update match state
    await this.redis.hset(\`match:state:\${matchId}\`, {
      status: 'completed',
      result: JSON.stringify(result),
      endedAt: Date.now()
    });

    // Archive to database (including events)
    await this.archiveService.archiveMatch(matchId);

    // Delete match state AND events
    await this.redis.del(\`match:state:\${matchId}\`);
    await this.redis.del(\`match:events:\${matchId}\`);  // ADD THIS
  }
}`,
			},
			{
				lang: "typescript",
				description: "Use XTRIM to limit stream size",
				code: `class MatchEventService {
  private readonly MAX_EVENTS_PER_MATCH = 5000;

  async recordMatchEvent(matchId: string, event: MatchEvent): Promise<void> {
    const streamKey = \`match:events:\${matchId}\`;

    // Add event to stream
    await this.redis.xadd(
      streamKey,
      '*',
      'type', event.type,
      'data', JSON.stringify(event.data),
      'timestamp', Date.now().toString()
    );

    // Trim to prevent unbounded growth
    await this.redis.xtrim(
      streamKey,
      'MAXLEN',
      '~', // Approximate (more efficient)
      this.MAX_EVENTS_PER_MATCH
    );
  }
}`,
			},
			{
				lang: "typescript",
				description: "Background cleanup job for orphaned streams",
				code: `class StreamCleanupJob {
  async cleanupOrphanedStreams(): Promise<void> {
    const cursor = '0';
    const pattern = 'match:events:*';

    let cleanedCount = 0;

    for await (const key of this.redis.scanIterator({
      MATCH: pattern,
      COUNT: 100
    })) {
      const matchId = key.split(':')[2];
      const matchState = await this.redis.exists(\`match:state:\${matchId}\`);

      if (!matchState) {
        // Match is completed, stream is orphaned
        const streamInfo = await this.redis.xinfo('STREAM', key);
        const lastEntryTime = this.parseEntryTime(streamInfo.lastEntry);

        // Delete if older than 1 hour
        if (Date.now() - lastEntryTime > 3600000) {
          await this.redis.del(key);
          cleanedCount++;
        }
      }
    }

    console.log(\`Cleaned up \${cleanedCount} orphaned streams\`);
  }
}`,
			},
		],
		prevention: [
			"Every Redis key should have a cleanup strategy - either TTL or explicit deletion",
			"Audit all XADD calls to ensure matching cleanup logic exists",
			"Monitor key count growth rate, not just memory",
			"Implement automated cleanup jobs for event streams",
			"Use XTRIM with MAXLEN to cap stream sizes",
			"Set maxmemory-policy to allkeys-lru as a safety net (with careful consideration)",
		],
		educationalInsights: [
			"Redis Streams don't have built-in TTL - you must manage cleanup explicitly",
			"The 'noeviction' policy means Redis will OOM rather than drop data",
			"XADD is easy to use but creates permanent data unless you XTRIM or DEL",
			"Key count is often a better indicator than memory for leak detection",
			"Streams are great for real-time data, but ephemeral data needs ephemeral storage",
			"Always pair data creation patterns with data deletion patterns",
		],
	},
};

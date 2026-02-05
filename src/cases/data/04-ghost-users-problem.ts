import type { DetectiveCase } from "../../types";

export const ghostUsersProblem: DetectiveCase = {
	id: "ghost-users-problem",
	title: "The Ghost Users Problem",
	subtitle: "Friend lists show offline users as online",
	difficulty: "junior",
	category: "caching",

	crisis: {
		description:
			"Players are complaining that their friends list shows people as 'Online' when they're actually offline. Some 'online' users haven't played in days. The presence system seems broken.",
		impact:
			"Players frustrated trying to invite 'online' friends who don't respond. Party invites going to ghost users. Trust in the friend system eroding.",
		timeline: [
			{ time: "Week 1", event: "First reports of ghost online status", type: "warning" },
			{ time: "Week 2", event: "Reports increasing, 50+ tickets", type: "warning" },
			{ time: "Week 3", event: "200+ tickets, social media complaints", type: "critical" },
			{ time: "Week 4", event: "Friend list feature being called 'broken'", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Logging in correctly sets status to online",
			"Users can manually set their status",
			"Status changes propagate immediately",
			"Database shows correct last_seen timestamps",
		],
		broken: [
			"Users show online after logging out",
			"Some users appear online for days",
			"Restarting presence service temporarily fixes it",
			"Problem grows worse over time",
		],
	},

	clues: [
		{
			id: 1,
			title: "Presence Service Code",
			type: "code",
			content: `\`\`\`typescript
class PresenceService {
  private redis: Redis;

  async setOnline(userId: string): Promise<void> {
    await this.redis.hset('presence:status', userId, 'online');
    await this.redis.hset('presence:lastSeen', userId, Date.now().toString());
  }

  async setOffline(userId: string): Promise<void> {
    await this.redis.hset('presence:status', userId, 'offline');
    await this.redis.hset('presence:lastSeen', userId, Date.now().toString());
  }

  async getStatus(userId: string): Promise<string> {
    const status = await this.redis.hget('presence:status', userId);
    return status || 'offline';
  }

  async getOnlineFriends(userId: string): Promise<string[]> {
    const friendIds = await this.friendService.getFriendIds(userId);
    const pipeline = this.redis.pipeline();

    for (const friendId of friendIds) {
      pipeline.hget('presence:status', friendId);
    }

    const results = await pipeline.exec();
    return friendIds.filter((_, i) => results[i][1] === 'online');
  }
}
\`\`\``,
		},
		{
			id: 2,
			title: "Session Service Integration",
			type: "code",
			content: `\`\`\`typescript
class SessionService {
  async createSession(userId: string): Promise<Session> {
    const session = {
      id: generateId(),
      userId,
      createdAt: Date.now()
    };

    await this.sessionStore.save(session);
    await this.presenceService.setOnline(userId);

    return session;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(sessionId);
    if (session) {
      await this.sessionStore.delete(sessionId);
      await this.presenceService.setOffline(session.userId);
    }
  }
}
\`\`\``,
		},
		{
			id: 3,
			title: "Server Logs",
			type: "logs",
			content: `\`\`\`
# From game server crash on Tuesday
[ERROR] 14:23:17 Connection lost to game server gs-12
[ERROR] 14:23:17 2,847 active sessions on gs-12
[INFO] 14:23:18 Server gs-12 removed from pool
[INFO] 14:23:20 Server gs-13 added to pool
[INFO] 14:23:25 Players reconnecting to gs-13...

# No corresponding session cleanup logs found
# No presence:setOffline calls for affected users
\`\`\``,
			hint: "What happened to those 2,847 sessions?",
		},
		{
			id: 4,
			title: "Redis Presence Data",
			type: "metrics",
			content: `\`\`\`
redis-cli HLEN presence:status
(integer) 3847293

redis-cli HGETALL presence:status | grep online | wc -l
847293

# Cross-reference with active sessions
SELECT COUNT(*) FROM sessions WHERE active = true;
-- 124,892

# 847,293 users marked online in Redis
# 124,892 actually have active sessions
# ~720,000 ghost users
\`\`\``,
		},
		{
			id: 5,
			title: "Client Behavior",
			type: "testimony",
			content: `"I noticed this mostly happens when the game crashes or I lose internet. If I log out normally from the menu, my friends see me go offline right away. But if the game crashes or I just close the app, I stay online forever."`,
		},
		{
			id: 6,
			title: "Monitoring Dashboard",
			type: "metrics",
			content: `\`\`\`
Event: session.created    - 45,000/day
Event: session.ended      - 31,000/day
Event: presence.setOnline - 45,000/day
Event: presence.setOffline - 31,000/day

Gap: ~14,000 sessions/day not properly ended
Cumulative ghost users after 30 days: ~420,000
\`\`\``,
			hint: "Why would session.ended be less than session.created?",
		},
	],

	solution: {
		diagnosis: "Presence status is never cleaned up when sessions end abnormally (crashes, network loss, server failures)",
		keywords: [
			"cleanup",
			"abnormal",
			"crash",
			"disconnect",
			"heartbeat",
			"timeout",
			"expire",
			"ttl",
			"graceful",
			"ungraceful",
		],
		rootCause: `The presence system only marks users offline when endSession() is explicitly called. This happens during normal logout but NOT when:
- The game client crashes
- The user loses internet connection
- The game server crashes
- The user force-quits the app
- The network times out

In these cases, endSession() is never called, so setOffline() is never called, and the user remains marked as 'online' forever in Redis.

Over time, these ghost entries accumulate. The data shows ~14,000 abnormal session terminations per day, leading to 420,000+ ghost users after just 30 days.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Use TTL-based presence with heartbeat refresh",
				code: `class PresenceService {
  private readonly PRESENCE_TTL = 120; // 2 minutes

  async setOnline(userId: string): Promise<void> {
    // Use a key per user with TTL instead of a hash
    await this.redis.set(
      \`presence:\${userId}\`,
      'online',
      'EX',
      this.PRESENCE_TTL
    );
    await this.redis.hset('presence:lastSeen', userId, Date.now().toString());
  }

  async heartbeat(userId: string): Promise<void> {
    // Client calls this every 60 seconds
    await this.redis.expire(\`presence:\${userId}\`, this.PRESENCE_TTL);
  }

  async getStatus(userId: string): Promise<string> {
    const status = await this.redis.get(\`presence:\${userId}\`);
    return status || 'offline';
  }

  // setOffline becomes optional - key auto-expires
  async setOffline(userId: string): Promise<void> {
    await this.redis.del(\`presence:\${userId}\`);
    await this.redis.hset('presence:lastSeen', userId, Date.now().toString());
  }
}`,
			},
			{
				lang: "typescript",
				description: "Client-side heartbeat implementation",
				code: `class GameClient {
  private heartbeatInterval: NodeJS.Timer | null = null;

  async onConnected(): Promise<void> {
    await this.api.setOnline();

    // Send heartbeat every 60 seconds
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.api.heartbeat();
      } catch (error) {
        console.warn('Heartbeat failed', error);
      }
    }, 60000);
  }

  async onDisconnected(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    try {
      await this.api.setOffline();
    } catch {
      // If this fails, TTL will handle cleanup
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Alternative: Session cleanup cron job",
				code: `class SessionCleanupJob {
  async run(): Promise<void> {
    // Find stale sessions (no heartbeat in 5 minutes)
    const staleSessions = await this.db.query(\`
      SELECT user_id FROM sessions
      WHERE active = true
        AND last_heartbeat < NOW() - INTERVAL '5 minutes'
    \`);

    for (const session of staleSessions) {
      await this.sessionService.forceEndSession(session.user_id);
      await this.presenceService.setOffline(session.user_id);
    }

    console.log(\`Cleaned up \${staleSessions.length} stale sessions\`);
  }
}

// Run every minute
cron.schedule('* * * * *', () => cleanupJob.run());`,
			},
		],
		prevention: [
			"Never rely solely on explicit cleanup calls for ephemeral state",
			"Use TTL/expiry for any 'session' or 'presence' type data",
			"Implement heartbeat mechanisms for liveness detection",
			"Monitor the gap between creation and deletion events",
			"Have a background job to clean up stale entries as a safety net",
			"Test abnormal termination scenarios (kill -9, network disconnect)",
		],
		educationalInsights: [
			"Graceful shutdown is the exception, not the rule, in real-world systems",
			"Any state that should 'go away' needs either TTL or active cleanup",
			"Heartbeat + TTL is the standard pattern for presence systems",
			"The 'happy path' (normal logout) often masks bugs in error handling",
			"Monitor the ratio of create/delete events for any paired operations",
			"Distributed systems fail in partial ways - one server dying doesn't notify others",
		],
	},
};

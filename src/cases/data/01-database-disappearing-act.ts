import type { DetectiveCase } from "../../types";

export const databaseDisappearingAct: DetectiveCase = {
	id: "database-disappearing-act",
	title: "The Database Disappearing Act",
	subtitle: "Users vanish mid-session, but the database seems fine",
	difficulty: "mid",
	category: "database",

	crisis: {
		description:
			"Player sessions are randomly disconnecting. Users report being kicked from games without warning. The database health checks all pass, but something is clearly wrong.",
		impact:
			"15% of active users experiencing random disconnects. Customer support tickets up 300%. Competitive gaming matches being invalidated.",
		timeline: [
			{ time: "14:00", event: "Normal traffic patterns", type: "normal" },
			{ time: "14:30", event: "First reports of random disconnects", type: "warning" },
			{ time: "15:00", event: "Disconnect rate climbing to 10%", type: "warning" },
			{ time: "15:30", event: "Competitive matches being cancelled", type: "critical" },
			{ time: "16:00", event: "15% of users affected", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Database health checks pass",
			"Login works fine",
			"New sessions can be created",
			"Static data queries work",
			"Admin dashboard fully functional",
		],
		broken: [
			"Long-running sessions randomly drop",
			"Some API calls timeout after 30 seconds",
			"Session updates sometimes fail silently",
			"Matchmaking occasionally stalls",
		],
	},

	clues: [
		{
			id: 1,
			title: "Error Logs",
			type: "logs",
			content: `\`\`\`
[ERROR] 15:23:44 SessionService: Failed to update session
  Error: Connection timeout after 30000ms
  Query: UPDATE sessions SET last_active = NOW() WHERE id = ?

[ERROR] 15:23:45 MatchService: Unable to fetch match state
  Error: Cannot acquire connection from pool
  Waited: 30000ms

[ERROR] 15:23:47 SessionService: Failed to update session
  Error: Connection timeout after 30000ms
\`\`\``,
			hint: "Notice the pattern in the error messages...",
		},
		{
			id: 2,
			title: "Database Metrics",
			type: "metrics",
			content: `\`\`\`
Active Connections: 100/100 (MAX)
Connection Wait Time: 28,547ms (avg)
Queries per Second: 1,247
Slow Queries (>1s): 3
Connection Pool Size: 100
Connection Timeout: 30,000ms
Max Connection Lifetime: 1800s
\`\`\``,
			hint: "One of these numbers is at its limit...",
		},
		{
			id: 3,
			title: "Application Config",
			type: "config",
			content: `\`\`\`yaml
database:
  host: db-primary.internal
  pool:
    min: 10
    max: 100
    acquireTimeout: 30000
    idleTimeout: 600000  # 10 minutes
    connectionLifetime: 1800000  # 30 minutes

  # Health check runs every 5 seconds
  healthCheck:
    enabled: true
    query: "SELECT 1"
\`\`\``,
		},
		{
			id: 4,
			title: "Session Service Code",
			type: "code",
			content: `\`\`\`typescript
class SessionService {
  private pool: Pool;

  async updateSession(sessionId: string): Promise<void> {
    const connection = await this.pool.getConnection();

    await connection.query(
      'UPDATE sessions SET last_active = NOW() WHERE id = ?',
      [sessionId]
    );

    // Process session data
    const sessionData = await this.processSessionData(sessionId, connection);

    if (sessionData.needsSync) {
      await this.syncToCache(sessionData, connection);
    }

    // Note: connection released when function exits via GC
  }
}
\`\`\``,
			hint: "Compare the connection lifecycle to the pool config...",
		},
		{
			id: 5,
			title: "Ops Engineer Testimony",
			type: "testimony",
			content: `"The weird thing is, the problem gets worse throughout the day. Mornings are fine, but by afternoon it's chaos. We tried restarting the app servers at 16:30 and things got better for about an hour, then degraded again. The database CPU and memory look totally normal."`,
		},
		{
			id: 6,
			title: "Connection Tracking Query",
			type: "logs",
			content: `\`\`\`sql
-- Running: SELECT state, count(*) FROM pg_stat_activity GROUP BY state

 state  | count
--------+-------
 active |    12
 idle   |    88
--------+-------
Total:      100

-- All 100 connections are in use
-- 88 are idle but still held by the application
\`\`\``,
			hint: "If 88 connections are idle, why can't new requests use them?",
		},
	],

	solution: {
		diagnosis: "Connection pool exhaustion due to unreleased connections",
		keywords: [
			"connection pool",
			"pool exhaustion",
			"connection leak",
			"unreleased connection",
			"connection not released",
			"pool full",
			"getConnection",
			"release",
		],
		rootCause: `The SessionService.updateSession() method acquires a database connection but never explicitly releases it. The code comment suggests reliance on garbage collection, but in Node.js/connection pooling, connections are not automatically returned to the pool when a function exits.

Over time, connections are acquired but never returned, causing the pool to fill up. New requests wait for connections (up to 30 seconds) before timing out. The pool appears "healthy" because the connections exist - they're just never available.

The morning-to-afternoon degradation pattern occurs because connections slowly leak throughout the day. Restarting the app servers temporarily fixes it because it forces all connections to close and recreate the pool.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed code with proper connection release",
				code: `class SessionService {
  private pool: Pool;

  async updateSession(sessionId: string): Promise<void> {
    const connection = await this.pool.getConnection();

    try {
      await connection.query(
        'UPDATE sessions SET last_active = NOW() WHERE id = ?',
        [sessionId]
      );

      const sessionData = await this.processSessionData(sessionId, connection);

      if (sessionData.needsSync) {
        await this.syncToCache(sessionData, connection);
      }
    } finally {
      // CRITICAL: Always release the connection back to the pool
      connection.release();
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Even better: Use a wrapper pattern",
				code: `class SessionService {
  private pool: Pool;

  private async withConnection<T>(
    fn: (conn: Connection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      return await fn(connection);
    } finally {
      connection.release();
    }
  }

  async updateSession(sessionId: string): Promise<void> {
    await this.withConnection(async (connection) => {
      await connection.query(
        'UPDATE sessions SET last_active = NOW() WHERE id = ?',
        [sessionId]
      );

      const sessionData = await this.processSessionData(sessionId, connection);

      if (sessionData.needsSync) {
        await this.syncToCache(sessionData, connection);
      }
    });
  }
}`,
			},
		],
		prevention: [
			"Always use try/finally or a wrapper pattern for connection management",
			"Set up monitoring alerts for pool utilization > 80%",
			"Implement connection leak detection in development/staging",
			"Use ESLint rules to detect unreleased resources",
			"Add pool metrics to your dashboard (active, idle, waiting)",
		],
		educationalInsights: [
			"Connection pools are finite resources - treat them like file handles",
			"Health checks pass because they use a single quick query, not the pool",
			"GC-based resource cleanup doesn't work for pooled connections",
			"The 'restart fixes it temporarily' pattern often indicates a resource leak",
			"Idle connections in the database != available connections in your app",
		],
	},
};

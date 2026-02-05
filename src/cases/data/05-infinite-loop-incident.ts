import type { DetectiveCase } from "../../types";

export const infiniteLoopIncident: DetectiveCase = {
	id: "infinite-loop-incident",
	title: "The Infinite Loop Incident",
	subtitle: "Users keep getting logged out and back in endlessly",
	difficulty: "senior",
	category: "auth",

	crisis: {
		description:
			"A subset of users are experiencing rapid logout/login cycles. Their devices seem to be fighting each other, logging each other out repeatedly. Some users are completely locked out as they can't stay logged in for more than seconds.",
		impact:
			"5% of multi-device users affected. Customer support overwhelmed. Users losing progress. Gaming sessions interrupted every few seconds.",
		timeline: [
			{ time: "10:00", event: "First reports of 'app keeps restarting'", type: "warning" },
			{ time: "10:30", event: "Pattern identified: multi-device users only", type: "warning" },
			{ time: "11:00", event: "API servers seeing 10x normal auth traffic", type: "warning" },
			{ time: "11:30", event: "Token service at 95% capacity", type: "critical" },
			{ time: "12:00", event: "Emergency rate limiting applied", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Single-device users unaffected",
			"Login itself works fine",
			"Session creation succeeds",
			"Token generation works",
		],
		broken: [
			"Multi-device users in logout loops",
			"Sessions last only 5-10 seconds",
			"Both devices show 'Session expired'",
			"Auth service under extreme load",
		],
	},

	clues: [
		{
			id: 1,
			title: "Token Service Code",
			type: "code",
			content: `\`\`\`typescript
class TokenService {
  async refreshToken(userId: string, refreshToken: string): Promise<TokenPair> {
    // Validate refresh token
    const stored = await this.redis.get(\`refresh:\${userId}\`);
    if (stored !== refreshToken) {
      throw new InvalidTokenError('Refresh token invalid or expired');
    }

    // Generate new tokens
    const newAccessToken = this.generateAccessToken(userId);
    const newRefreshToken = this.generateRefreshToken();

    // Store new refresh token (replaces old one)
    await this.redis.set(
      \`refresh:\${userId}\`,
      newRefreshToken,
      'EX',
      86400 * 30 // 30 days
    );

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string): Promise<void> {
    await this.redis.del(\`refresh:\${userId}\`);
  }
}
\`\`\``,
			hint: "What happens if two devices try to refresh at the same time?",
		},
		{
			id: 2,
			title: "Client Token Refresh Logic",
			type: "code",
			content: `\`\`\`typescript
class AuthClient {
  async refreshTokenIfNeeded(): Promise<void> {
    if (this.isAccessTokenExpired()) {
      try {
        const { accessToken, refreshToken } = await this.api.refreshToken(
          this.userId,
          this.refreshToken
        );

        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        await this.saveTokens();
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          // Our refresh token was invalidated
          await this.forceLogout();
          this.showLoginScreen();
        }
      }
    }
  }

  // Called every 5 seconds
  startTokenRefreshLoop(): void {
    setInterval(() => this.refreshTokenIfNeeded(), 5000);
  }
}
\`\`\``,
		},
		{
			id: 3,
			title: "Affected User Session Logs",
			type: "logs",
			content: `\`\`\`
User: u_847293 (has 2 devices)

10:23:45.123 [Device A] POST /auth/refresh - OK, new token: rt_abc123
10:23:45.456 [Device B] POST /auth/refresh - OK, new token: rt_xyz789
10:23:50.001 [Device A] POST /auth/refresh - FAIL "Invalid token"
10:23:50.234 [Device A] Logged out, redirecting to login
10:23:52.001 [Device A] POST /auth/login - OK, new token: rt_def456
10:23:52.456 [Device B] POST /auth/refresh - FAIL "Invalid token"
10:23:52.789 [Device B] Logged out, redirecting to login
10:23:55.001 [Device B] POST /auth/login - OK, new token: rt_ghi789
10:23:55.234 [Device A] POST /auth/refresh - FAIL "Invalid token"
... (continues forever)
\`\`\``,
			hint: "Follow the token trail...",
		},
		{
			id: 4,
			title: "Redis Key Pattern",
			type: "config",
			content: `\`\`\`
# Current pattern
refresh:{userId} -> single refresh token

# This means:
- User can only have ONE valid refresh token
- Last device to refresh invalidates all other devices
- Any refresh operation replaces the previous token
\`\`\``,
		},
		{
			id: 5,
			title: "Traffic Analysis",
			type: "metrics",
			content: `\`\`\`
Normal auth traffic: 10,000 requests/min
Current auth traffic: 147,000 requests/min

Top 100 users by auth requests:
- u_847293: 2,847 requests in last hour
- u_928374: 2,634 requests in last hour
- u_102938: 2,456 requests in last hour
...

Pattern: All top users have 2+ registered devices
Pattern: Request pattern shows 5-second intervals
Pattern: Alternating device IDs in each user's requests
\`\`\``,
		},
		{
			id: 6,
			title: "Recent Changes",
			type: "testimony",
			content: `"We pushed a security update last week. The old system allowed unlimited refresh tokens per user, but security audit said that was risky. So we changed it to one token per user to match our 'one active session' policy. The mobile team updated their token refresh to be more aggressive around the same time."`,
		},
	],

	solution: {
		diagnosis: "Single refresh token per user causes device conflict when multiple devices race to refresh tokens",
		keywords: [
			"race condition",
			"token conflict",
			"multi-device",
			"single token",
			"refresh race",
			"device conflict",
			"token invalidation",
			"session conflict",
		],
		rootCause: `The combination of two changes created a perfect storm:

1. **Security update**: Changed from multiple refresh tokens to single token per user
2. **Mobile update**: Token refresh now runs every 5 seconds

When a user has two devices:
1. Device A refreshes → gets new token rt_A, stored in Redis
2. Device B refreshes with old token → gets new token rt_B, replaces rt_A in Redis
3. Device A's token (rt_A) is now invalid
4. Device A tries to refresh → FAIL → forced logout → re-login → new token rt_C
5. Device B's token (rt_B) is now invalid
6. Device B tries to refresh → FAIL → forced logout → re-login...
7. Loop continues forever

Each device's refresh invalidates the other device's token. The 5-second refresh interval ensures this happens constantly.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Use device-specific refresh tokens",
				code: `class TokenService {
  async refreshToken(
    userId: string,
    deviceId: string,
    refreshToken: string
  ): Promise<TokenPair> {
    // Device-specific key
    const key = \`refresh:\${userId}:\${deviceId}\`;
    const stored = await this.redis.get(key);

    if (stored !== refreshToken) {
      throw new InvalidTokenError('Refresh token invalid or expired');
    }

    const newAccessToken = this.generateAccessToken(userId, deviceId);
    const newRefreshToken = this.generateRefreshToken();

    await this.redis.set(key, newRefreshToken, 'EX', 86400 * 30);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string, deviceId: string): Promise<void> {
    await this.redis.del(\`refresh:\${userId}:\${deviceId}\`);
  }

  async logoutAllDevices(userId: string): Promise<void> {
    const keys = await this.redis.keys(\`refresh:\${userId}:*\`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Alternative: Token family with rotation detection",
				code: `class TokenService {
  async refreshToken(userId: string, refreshToken: string): Promise<TokenPair> {
    const tokenData = await this.redis.hgetall(\`refresh:\${userId}\`);
    const currentFamily = tokenData.family;
    const tokenFamily = this.getTokenFamily(refreshToken);

    // If token is from a different family, it might be stolen
    if (tokenFamily !== currentFamily) {
      // Check if it's a reuse of an old token
      const wasRotated = await this.redis.sismember(
        \`rotated:\${userId}\`,
        refreshToken
      );

      if (wasRotated) {
        // Possible theft - invalidate all tokens
        await this.logoutAllDevices(userId);
        throw new SecurityError('Token reuse detected');
      }

      throw new InvalidTokenError('Token expired');
    }

    // Generate new tokens in same family
    const newAccessToken = this.generateAccessToken(userId);
    const newRefreshToken = this.generateRefreshToken(currentFamily);

    // Track rotated token
    await this.redis.sadd(\`rotated:\${userId}\`, refreshToken);
    await this.redis.expire(\`rotated:\${userId}\`, 86400);

    await this.redis.hset(\`refresh:\${userId}\`, {
      token: newRefreshToken,
      family: currentFamily
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }
}`,
			},
			{
				lang: "typescript",
				description: "Add jitter to prevent synchronized refresh",
				code: `class AuthClient {
  startTokenRefreshLoop(): void {
    const baseInterval = 60000; // 1 minute
    const jitter = Math.random() * 30000; // 0-30 second random offset

    const refresh = async () => {
      await this.refreshTokenIfNeeded();

      // Schedule next refresh with jitter
      const nextInterval = baseInterval + (Math.random() * 10000);
      setTimeout(refresh, nextInterval);
    };

    // Initial delay with jitter
    setTimeout(refresh, jitter);
  }
}`,
			},
		],
		prevention: [
			"Always consider multi-device scenarios when designing auth",
			"Use device-specific tokens when supporting multiple sessions",
			"Add jitter to periodic operations to prevent synchronization",
			"Test auth flows with 2+ concurrent devices",
			"Implement token families to detect token theft vs legitimate multi-device",
			"Consider the interaction between security policies and client behavior",
		],
		educationalInsights: [
			"Race conditions can emerge from the interaction of independently-designed systems",
			"'One token per user' and 'aggressive refresh' are both reasonable, but deadly together",
			"Auth systems must be designed for the multi-device reality",
			"Periodic operations should use jitter to avoid thundering herd effects",
			"Security improvements can have unexpected usability consequences",
			"Always test the interaction between server and client changes",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const oauth2RefreshTokenRace: DetectiveCase = {
	id: "oauth2-refresh-token-race",
	title: "The OAuth2 Refresh Token Race",
	subtitle: "Concurrent refresh causing token invalidation",
	difficulty: "senior",
	category: "auth",

	crisis: {
		description:
			"Users are being randomly logged out across all their devices. The pattern is erratic - sometimes they stay logged in for days, other times they get kicked out every few minutes. Users with multiple tabs or devices open are most affected.",
		impact:
			"30% of active users experiencing random logouts. User session duration dropped from 45 minutes average to 8 minutes. NPS score plummeting due to frustration.",
		timeline: [
			{ time: "Week 1", event: "New OAuth2 refresh token rotation deployed for security", type: "normal" },
			{ time: "Week 2", event: "Sporadic logout complaints begin appearing", type: "warning" },
			{ time: "Week 3", event: "Pattern noticed: multi-device users most affected", type: "warning" },
			{ time: "Week 4", event: "30% of users reporting random logouts daily", type: "critical" },
			{ time: "Week 4", event: "Correlation found with browser tab count", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Single-tab users rarely affected",
			"Initial login always succeeds",
			"Token refresh works when tested in isolation",
			"OAuth2 spec compliance verified",
		],
		broken: [
			"Users with multiple tabs get logged out",
			"Users with mobile + web open simultaneously affected",
			"Logout happens right after token refresh",
			"Error: 'invalid_grant - refresh token has been revoked'",
		],
	},

	clues: [
		{
			id: 1,
			title: "Token Refresh Implementation",
			type: "code",
			content: `\`\`\`typescript
// auth-server/src/refresh.ts
async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  // Validate the refresh token
  const storedToken = await db.refreshTokens.findOne({ token: refreshToken });

  if (!storedToken) {
    throw new OAuthError('invalid_grant', 'refresh token not found');
  }

  if (storedToken.revoked) {
    throw new OAuthError('invalid_grant', 'refresh token has been revoked');
  }

  if (storedToken.expiresAt < new Date()) {
    throw new OAuthError('invalid_grant', 'refresh token has expired');
  }

  // SECURITY: Rotate refresh token (one-time use)
  await db.refreshTokens.update(storedToken.id, { revoked: true });

  // Generate new tokens
  const newAccessToken = generateAccessToken(storedToken.userId);
  const newRefreshToken = generateRefreshToken(storedToken.userId);

  await db.refreshTokens.create({
    token: newRefreshToken,
    userId: storedToken.userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revoked: false
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}
\`\`\``,
			hint: "What happens if two requests try to refresh at the same time?",
		},
		{
			id: 2,
			title: "Client-Side Token Management",
			type: "code",
			content: `\`\`\`typescript
// frontend/src/api/client.ts
class ApiClient {
  private accessToken: string;
  private refreshToken: string;

  async request(url: string, options: RequestOptions): Promise<Response> {
    let response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: \`Bearer \${this.accessToken}\` }
    });

    if (response.status === 401) {
      // Access token expired, refresh it
      await this.refreshTokens();

      // Retry the request
      response = await fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: \`Bearer \${this.accessToken}\` }
      });
    }

    return response;
  }

  private async refreshTokens(): Promise<void> {
    const response = await fetch('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      })
    });

    if (!response.ok) {
      // Refresh failed, force re-login
      this.logout();
      window.location.href = '/login';
      return;
    }

    const tokens = await response.json();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    localStorage.setItem('tokens', JSON.stringify(tokens));
  }
}
\`\`\``,
			hint: "Each tab has its own ApiClient instance...",
		},
		{
			id: 3,
			title: "Server Logs During Incident",
			type: "logs",
			content: `\`\`\`
[14:23:45.123] POST /oauth/token user_id=u_1234
  refresh_token=rt_abc123... (last 6: ...xyz789)
  Result: SUCCESS - new tokens issued
  New refresh_token=rt_def456... (last 6: ...uvw321)

[14:23:45.156] POST /oauth/token user_id=u_1234
  refresh_token=rt_abc123... (last 6: ...xyz789)  ← SAME TOKEN!
  Result: ERROR - refresh token has been revoked

[14:23:45.189] POST /oauth/token user_id=u_1234
  refresh_token=rt_abc123... (last 6: ...xyz789)  ← SAME TOKEN AGAIN!
  Result: ERROR - refresh token has been revoked

[14:23:45.201] GET /api/user user_id=u_1234
  Result: 401 Unauthorized (access token from failed refresh)

[14:23:45.234] Client redirected to /login
\`\`\``,
			hint: "Three requests with the same refresh token within 100ms...",
		},
		{
			id: 4,
			title: "Network Request Timeline",
			type: "metrics",
			content: `\`\`\`
User u_1234 with 3 browser tabs open:

Tab 1 (Dashboard):
  14:23:45.100 - GET /api/dashboard returns 401
  14:23:45.120 - POST /oauth/token (refresh)
  14:23:45.220 - Response: new tokens ✓
  14:23:45.250 - Retry /api/dashboard ✓

Tab 2 (Settings):
  14:23:45.110 - GET /api/settings returns 401
  14:23:45.130 - POST /oauth/token (refresh) ← uses OLD token
  14:23:45.230 - Response: invalid_grant ✗
  14:23:45.260 - Redirect to /login

Tab 3 (Projects):
  14:23:45.115 - GET /api/projects returns 401
  14:23:45.135 - POST /oauth/token (refresh) ← uses OLD token
  14:23:45.235 - Response: invalid_grant ✗
  14:23:45.265 - Redirect to /login

All tabs triggered refresh within 35ms of each other!
\`\`\``,
		},
		{
			id: 5,
			title: "OAuth2 Security Best Practices Document",
			type: "config",
			content: `\`\`\`markdown
# OAuth2 Refresh Token Security

## Refresh Token Rotation (RFC 6749 Section 10.4)

Rotating refresh tokens on each use prevents token theft attacks.
When a refresh token is used:
1. Issue new access token
2. Issue NEW refresh token
3. Revoke the OLD refresh token

## The Concurrent Refresh Problem

When clients make concurrent API calls that all trigger token refresh:
- First request succeeds, gets new tokens
- Subsequent requests use OLD (now revoked) token
- They fail with 'invalid_grant'
- User appears to be logged out

## Solutions:

### Server-Side: Grace Period
Allow old refresh token for brief window after rotation.

### Client-Side: Refresh Queue
Serialize refresh requests - only one in-flight at a time.

### Client-Side: BroadcastChannel
Coordinate token refresh across browser tabs.
\`\`\``,
		},
		{
			id: 6,
			title: "Database Token Query",
			type: "logs",
			content: `\`\`\`sql
-- Investigating revoked tokens for user u_1234
SELECT
  id,
  token_suffix,
  created_at,
  revoked_at,
  revoked_at - created_at as lifetime
FROM refresh_tokens
WHERE user_id = 'u_1234'
AND revoked = true
ORDER BY created_at DESC
LIMIT 10;

| id    | token_suffix | created_at          | revoked_at          | lifetime |
|-------|--------------|---------------------|---------------------|----------|
| rt_99 | ...xyz789    | 2024-01-15 14:23:10 | 2024-01-15 14:23:45 | 35 sec   |
| rt_98 | ...abc456    | 2024-01-15 14:22:30 | 2024-01-15 14:23:10 | 40 sec   |
| rt_97 | ...def123    | 2024-01-15 14:21:45 | 2024-01-15 14:22:30 | 45 sec   |
| rt_96 | ...ghi789    | 2024-01-15 14:20:55 | 2024-01-15 14:21:45 | 50 sec   |

-- Tokens are being rotated every 30-50 seconds!
-- Normal would be every 15-60 minutes (access token lifetime)
\`\`\``,
			hint: "Tokens rotating every 30-50 seconds indicates constant refresh attempts",
		},
	],

	solution: {
		diagnosis: "Concurrent refresh token requests from multiple tabs/devices cause race condition where only the first succeeds and subsequent requests fail with revoked token",
		keywords: [
			"oauth2",
			"refresh token",
			"race condition",
			"token rotation",
			"concurrent",
			"invalid_grant",
			"multiple tabs",
			"broadcast channel",
			"refresh queue",
		],
		rootCause: `The root cause is a classic race condition in OAuth2 refresh token rotation.

The security feature (one-time-use refresh tokens) conflicted with real-world usage patterns:

1. User has multiple browser tabs open (common behavior)
2. Access token expires (5-15 minute lifetime)
3. All tabs simultaneously make API requests
4. All requests return 401 (token expired)
5. All tabs independently try to refresh tokens
6. First refresh succeeds, OLD refresh token is REVOKED
7. Other tabs' refresh requests fail (using now-revoked token)
8. Failed tabs redirect to login

The problem is the gap between:
- Server revoking the old token (instant)
- Other tabs learning about the new token (never, until they try to use it)

This is exacerbated by:
- Short access token lifetimes (more frequent refreshes)
- Modern SPAs with many concurrent API calls
- Users with multiple devices using same account
- Poor network causing request bunching`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Server-side fix: Grace period for old refresh tokens",
				code: `// auth-server/src/refresh.ts
const GRACE_PERIOD_MS = 30000; // 30 seconds

async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const storedToken = await db.refreshTokens.findOne({ token: refreshToken });

  if (!storedToken) {
    throw new OAuthError('invalid_grant', 'refresh token not found');
  }

  // Allow recently revoked tokens (grace period)
  if (storedToken.revoked) {
    const timeSinceRevoked = Date.now() - storedToken.revokedAt.getTime();

    if (timeSinceRevoked < GRACE_PERIOD_MS) {
      // Return the tokens that were issued when this token was revoked
      const replacementToken = await db.refreshTokens.findOne({
        userId: storedToken.userId,
        createdAt: storedToken.revokedAt
      });

      if (replacementToken && !replacementToken.revoked) {
        // Return existing new tokens (idempotent)
        return {
          accessToken: generateAccessToken(storedToken.userId),
          refreshToken: replacementToken.token
        };
      }
    }

    throw new OAuthError('invalid_grant', 'refresh token has been revoked');
  }

  // Normal refresh flow...
  await db.refreshTokens.update(storedToken.id, {
    revoked: true,
    revokedAt: new Date()
  });

  const newRefreshToken = generateRefreshToken(storedToken.userId);
  await db.refreshTokens.create({
    token: newRefreshToken,
    userId: storedToken.userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revoked: false
  });

  return {
    accessToken: generateAccessToken(storedToken.userId),
    refreshToken: newRefreshToken
  };
}`,
			},
			{
				lang: "typescript",
				description: "Client-side fix: Refresh token queue",
				code: `// frontend/src/api/tokenManager.ts
class TokenManager {
  private refreshPromise: Promise<TokenPair> | null = null;

  async getValidTokens(): Promise<TokenPair> {
    const tokens = this.getStoredTokens();

    if (this.isAccessTokenValid(tokens.accessToken)) {
      return tokens;
    }

    // Serialize refresh requests - only one in-flight at a time
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh(tokens.refreshToken)
        .finally(() => { this.refreshPromise = null; });
    }

    return this.refreshPromise;
  }

  private async doRefresh(refreshToken: string): Promise<TokenPair> {
    const response = await fetch('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw new AuthError('refresh_failed');
    }

    const tokens = await response.json();
    this.storeTokens(tokens);
    return tokens;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Client-side fix: Cross-tab coordination with BroadcastChannel",
				code: `// frontend/src/api/crossTabTokenManager.ts
class CrossTabTokenManager {
  private channel = new BroadcastChannel('auth-tokens');
  private refreshPromise: Promise<TokenPair> | null = null;

  constructor() {
    this.channel.onmessage = (event) => {
      if (event.data.type === 'TOKENS_UPDATED') {
        // Another tab refreshed tokens, use them
        this.storeTokens(event.data.tokens);
      }
    };
  }

  async refreshTokens(): Promise<TokenPair> {
    // Check if another tab already refreshed
    const storedTokens = this.getStoredTokens();
    if (this.isAccessTokenValid(storedTokens.accessToken)) {
      return storedTokens;
    }

    // Serialize within this tab
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh()
        .then(tokens => {
          // Broadcast to other tabs
          this.channel.postMessage({
            type: 'TOKENS_UPDATED',
            tokens
          });
          return tokens;
        })
        .finally(() => { this.refreshPromise = null; });
    }

    return this.refreshPromise;
  }
}`,
			},
		],
		prevention: [
			"Implement server-side grace period for rotated refresh tokens",
			"Serialize client-side refresh token requests (one in-flight at a time)",
			"Use BroadcastChannel API for cross-tab token coordination",
			"Consider longer access token lifetimes to reduce refresh frequency",
			"Implement token refresh proactively before expiration (not on 401)",
			"Add jitter to token refresh timing to prevent thundering herd",
			"Monitor refresh token failure rates as an early warning indicator",
		],
		educationalInsights: [
			"Security features can conflict with usability - design for both",
			"OAuth2 refresh token rotation is a security best practice but needs careful implementation",
			"Browser tabs share localStorage but not JavaScript memory state",
			"Race conditions are common when multiple actors share mutable state",
			"Idempotency in token refresh helps handle retries gracefully",
			"The BroadcastChannel API enables coordination between browser tabs",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const apiRateLimitLeak: DetectiveCase = {
	id: "api-rate-limit-leak",
	title: "The API Rate Limit Leak",
	subtitle: "Rate limiter not accounting for burst traffic",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Your API rate limiter is supposed to allow 100 requests per minute per user, but some users are making 500+ requests without getting throttled. Meanwhile, legitimate users doing normal browsing are occasionally getting 429 errors.",
		impact:
			"Aggressive API scrapers overwhelming backend services. Legitimate users frustrated by false rate limiting. Backend costs spiking due to uncontrolled traffic.",
		timeline: [
			{ time: "Monday 9:00 AM", event: "Backend team reports unusual load patterns", type: "warning" },
			{ time: "Monday 10:00 AM", event: "Analysis shows some users making 500+ req/min", type: "warning" },
			{ time: "Monday 11:00 AM", event: "Rate limiter logs show 100 req/min limit enforced", type: "normal" },
			{ time: "Monday 2:00 PM", event: "Legitimate users reporting 429 errors", type: "critical" },
			{ time: "Monday 3:00 PM", event: "Discrepancy identified between limiter counts and actual traffic", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Rate limiter code looks correct",
			"Redis counters increment as expected",
			"429 responses are being sent",
			"Rate limit headers present in responses",
		],
		broken: [
			"Some users exceed limit by 5x without throttling",
			"Legitimate users get false 429 errors",
			"Counter values don't match actual request counts",
			"Burst traffic seems to bypass limits",
		],
	},

	clues: [
		{
			id: 1,
			title: "Rate Limiter Implementation",
			type: "code",
			content: `\`\`\`typescript
// middleware/rateLimit.ts
async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id || req.ip;
  const key = \`ratelimit:\${userId}\`;
  const limit = 100;
  const windowSeconds = 60;

  // Get current count
  let count = await redis.get(key);

  if (count === null) {
    // First request in window
    await redis.setex(key, windowSeconds, '1');
    count = '1';
  } else {
    // Increment counter
    await redis.incr(key);
    count = String(parseInt(count) + 1);
  }

  const remaining = Math.max(0, limit - parseInt(count));

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (parseInt(count) > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  next();
}
\`\`\``,
			hint: "There's a race condition between get and incr...",
		},
		{
			id: 2,
			title: "Redis Operations Log",
			type: "logs",
			content: `\`\`\`
Timestamp          | Client | Operation          | Key              | Value
-------------------|--------|--------------------| -----------------|-------
10:00:00.001       | C1     | GET ratelimit:u123 | ratelimit:u123   | null
10:00:00.002       | C2     | GET ratelimit:u123 | ratelimit:u123   | null
10:00:00.003       | C3     | GET ratelimit:u123 | ratelimit:u123   | null
10:00:00.004       | C4     | GET ratelimit:u123 | ratelimit:u123   | null
10:00:00.005       | C5     | GET ratelimit:u123 | ratelimit:u123   | null
10:00:00.010       | C1     | SETEX ratelimit:u123 60 "1" | -      | OK
10:00:00.011       | C2     | SETEX ratelimit:u123 60 "1" | -      | OK
10:00:00.012       | C3     | SETEX ratelimit:u123 60 "1" | -      | OK
10:00:00.013       | C4     | SETEX ratelimit:u123 60 "1" | -      | OK
10:00:00.014       | C5     | SETEX ratelimit:u123 60 "1" | -      | OK

Five concurrent requests, all see null, all set counter to 1!
\`\`\``,
			hint: "5 concurrent requests all saw count=null and all set count=1",
		},
		{
			id: 3,
			title: "Traffic Pattern Analysis",
			type: "metrics",
			content: `\`\`\`
User u_scraper_456 traffic pattern:

Requests per second over 60 seconds:
Second 0:  [burst of 50 requests]  - Counter: 1 (race condition!)
Second 1:  [5 requests]            - Counter: 6
Second 2:  [5 requests]            - Counter: 11
...
Second 10: [5 requests]            - Counter: 56
...
Second 20: [burst of 50 requests]  - Counter: 57-62 (race again!)
...
Second 59: [5 requests]            - Counter: 95

Actual requests: 500+
Rate limiter counter: 95
Requests blocked: 0 (counter never exceeded 100!)
\`\`\``,
		},
		{
			id: 4,
			title: "Comparison: Single vs Multiple App Instances",
			type: "metrics",
			content: `\`\`\`
Test: 200 concurrent requests from same user

Single app instance (local Redis):
  - Counter accurately tracked: 200
  - Requests blocked: 100
  - Rate limit working: YES

10 app instances (shared Redis):
  - Counter tracked: 23 (!!!)
  - Requests blocked: 0
  - Rate limit working: NO

The race condition severity scales with:
  1. Number of app instances
  2. Concurrency of incoming requests
  3. Network latency to Redis
\`\`\``,
		},
		{
			id: 5,
			title: "Redis Documentation",
			type: "config",
			content: `\`\`\`markdown
# Redis Atomic Operations

## Problem: Check-and-Set Race Condition
\`\`\`
GET key → check → SET/INCR key
\`\`\`
Between GET and SET, another client can modify the key.

## Solution 1: INCR with EXPIRE
INCR is atomic. Use INCR always, set EXPIRE on first.

## Solution 2: Lua Script
Execute multiple commands atomically on Redis server.

## Solution 3: Redis MULTI/EXEC
Transaction block (but GET result not available until EXEC).

## Recommended: Atomic Lua Script
\`\`\`lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
\`\`\`
\`\`\``,
		},
		{
			id: 6,
			title: "Why Legitimate Users Get 429",
			type: "logs",
			content: `\`\`\`
Legitimate user u_normal_789 making 10 requests over 60 seconds:

Request 1 (10:00:05): Counter = 45 (inherited from previous user due to bug!)
Request 2 (10:00:10): Counter = 46
...
Request 8 (10:00:45): Counter = 98
Request 9 (10:00:50): Counter = 99
Request 10 (10:00:55): Counter = 101 → 429 RATE LIMITED!

Root cause: IP-based fallback when user not logged in.
Multiple users behind same corporate NAT share IP 203.0.113.50
Counter accumulates across all users behind that IP.

Scrapers often use rotating proxies = unique IP per request = counter resets!
Legitimate users behind corporate NAT = shared IP = counter accumulates!
\`\`\``,
			hint: "Scrapers rotate IPs, legitimate users share IPs",
		},
	],

	solution: {
		diagnosis: "Non-atomic rate limit check allows burst traffic to bypass limits, while IP-based fallback unfairly throttles legitimate users behind shared NAT",
		keywords: [
			"rate limit",
			"race condition",
			"atomic",
			"redis",
			"incr",
			"burst",
			"429",
			"lua script",
			"sliding window",
		],
		rootCause: `Two related problems combined:

**Problem 1: Race Condition in Rate Limiting**
The rate limiter used separate GET and SET/INCR operations:
1. GET returns null for new window
2. Multiple concurrent requests all see null
3. All requests SET counter to 1
4. Only the last SET survives - counter shows 1 instead of N

This is the classic check-then-act race condition. With 10 app instances and burst traffic, the counter drastically undercounts actual requests.

**Problem 2: IP-Based Fallback Unfairly Throttles**
When users aren't logged in, rate limiting falls back to IP address:
- Scrapers use rotating proxies → each request = fresh IP = fresh counter
- Legitimate users behind corporate NAT → shared IP = shared counter
- Result: scrapers bypass limits, legitimate users get throttled

The combination means:
- Bad actors: bypass rate limits
- Good users: unfairly blocked`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed: Atomic rate limiting with Lua script",
				code: `// middleware/rateLimit.ts
const RATE_LIMIT_SCRIPT = \`
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
\`;

async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id || getClientIdentifier(req);
  const key = \`ratelimit:\${userId}\`;
  const limit = 100;
  const windowSeconds = 60;

  // Atomic increment with expiry
  const count = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,           // number of keys
    key,         // KEYS[1]
    windowSeconds // ARGV[1]
  );

  const remaining = Math.max(0, limit - count);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + windowSeconds);

  if (count > limit) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: windowSeconds
    });
  }

  next();
}`,
			},
			{
				lang: "typescript",
				description: "Better client identification for anonymous users",
				code: `// utils/clientIdentifier.ts
function getClientIdentifier(req: Request): string {
  // Prefer authenticated user ID
  if (req.user?.id) {
    return \`user:\${req.user.id}\`;
  }

  // For anonymous users, combine multiple signals
  const ip = req.ip || req.headers['x-forwarded-for'];
  const userAgent = req.headers['user-agent'] || 'unknown';
  const fingerprint = req.headers['x-client-fingerprint']; // From frontend

  if (fingerprint) {
    // Client-provided fingerprint (browser fingerprinting)
    return \`fp:\${fingerprint}\`;
  }

  // Fallback: IP + User-Agent hash (not perfect but better than IP alone)
  const hash = crypto
    .createHash('sha256')
    .update(\`\${ip}:\${userAgent}\`)
    .digest('hex')
    .substring(0, 16);

  return \`anon:\${hash}\`;
}`,
			},
			{
				lang: "typescript",
				description: "Sliding window rate limiter for smoother limiting",
				code: `// middleware/slidingWindowRateLimit.ts
const SLIDING_WINDOW_SCRIPT = \`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove old entries outside the window
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count current entries
local count = redis.call('ZCARD', key)

if count < limit then
  -- Add current request
  redis.call('ZADD', key, now, now .. ':' .. math.random())
  redis.call('EXPIRE', key, window)
  return {count + 1, 0}  -- {current_count, is_limited}
else
  return {count, 1}  -- {current_count, is_limited}
end
\`;

async function slidingWindowRateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id || getClientIdentifier(req);
  const key = \`ratelimit:sw:\${userId}\`;
  const limit = 100;
  const windowMs = 60000;

  const [count, isLimited] = await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    key,
    Date.now(),
    windowMs,
    limit
  );

  if (isLimited) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  next();
}`,
			},
		],
		prevention: [
			"Always use atomic operations for rate limiting (INCR, Lua scripts)",
			"Implement sliding window for smoother rate limiting",
			"Use multiple signals for client identification, not just IP",
			"Monitor rate limiter effectiveness with metrics (blocks vs actual traffic)",
			"Test rate limiting under concurrent load, not just sequential requests",
			"Consider separate limits for authenticated vs anonymous users",
			"Add rate limit headers to help legitimate clients back off",
		],
		educationalInsights: [
			"GET-then-SET is never atomic in distributed systems",
			"Redis Lua scripts execute atomically on the server",
			"Fixed window rate limiting has burst-at-boundary problem",
			"Sliding window provides smoother rate limiting",
			"IP-based rate limiting is easily bypassed and unfair to NAT users",
			"The goal is to stop bad actors while not blocking good users",
		],
	},
};

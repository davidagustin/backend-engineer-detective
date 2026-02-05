import type { DetectiveCase } from "../../types";

export const loadBalancerStickySession: DetectiveCase = {
	id: "load-balancer-sticky-session",
	title: "The Load Balancer Sticky Session",
	subtitle: "Uneven load distribution due to session affinity",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Despite having 5 backend servers behind a load balancer, one server is consistently overwhelmed while others sit nearly idle. Auto-scaling keeps adding servers but they don't receive traffic. The load balancer shows all servers healthy, but the distribution is severely uneven.",
		impact:
			"One server at 95% CPU while 4 others at 10%. Slow response times for affected users. Auto-scaling costs tripled with no improvement. Deployment stuck due to fear of removing the 'hot' server.",
		timeline: [
			{ time: "9:00 AM", event: "Morning traffic ramp begins", type: "normal" },
			{ time: "9:30 AM", event: "Server-2 CPU reaches 60%, others at 15%", type: "warning" },
			{ time: "10:00 AM", event: "Auto-scaling adds 2 new servers", type: "normal" },
			{ time: "10:30 AM", event: "Server-2 CPU at 85%, new servers at 5%", type: "warning" },
			{ time: "11:00 AM", event: "Server-2 CPU at 95%, response times degrade", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"All servers passing health checks",
			"Load balancer reports all backends healthy",
			"New connections are accepted",
			"Users can complete their sessions",
			"Individual servers perform well when tested directly",
		],
		broken: [
			"Severely uneven traffic distribution",
			"One server handling 80% of requests",
			"New servers receive almost no traffic",
			"Response times vary wildly between users",
		],
	},

	clues: [
		{
			id: 1,
			title: "Load Balancer Metrics",
			type: "metrics",
			content: `\`\`\`
Backend Server Traffic Distribution (last hour):

Server-1:  8,234 requests  (12%)   CPU: 15%
Server-2: 54,891 requests  (78%)   CPU: 95%  ← PROBLEM
Server-3:  3,456 requests  ( 5%)   CPU:  8%
Server-4:  2,123 requests  ( 3%)   CPU:  6%
Server-5:  1,567 requests  ( 2%)   CPU:  5%

Total: 70,271 requests

Health Check Status: All servers HEALTHY
Load Balancing Algorithm: Round Robin (configured)
\`\`\``,
			hint: "It's configured for round robin but clearly not distributing evenly...",
		},
		{
			id: 2,
			title: "Load Balancer Configuration",
			type: "config",
			content: `\`\`\`yaml
# AWS ALB Configuration
Type: application
Scheme: internet-facing

TargetGroup:
  Name: api-servers
  Protocol: HTTP
  Port: 8080
  HealthCheckPath: /health
  HealthCheckIntervalSeconds: 30

  # Load balancing settings
  Algorithm: round_robin

  # Session affinity - added 3 months ago for "user experience"
  Stickiness:
    Enabled: true
    Type: lb_cookie
    Duration: 86400  # 24 hours!

Targets:
  - Id: i-server1, Port: 8080
  - Id: i-server2, Port: 8080
  - Id: i-server3, Port: 8080
  - Id: i-server4, Port: 8080
  - Id: i-server5, Port: 8080
\`\`\``,
			hint: "Look at the stickiness duration...",
		},
		{
			id: 3,
			title: "Session Cookie Analysis",
			type: "logs",
			content: `\`\`\`bash
# Checking sticky session cookies on client browsers

User A cookie: AWSALB=abc123...; Expires=Tue, 06 Feb 2024 09:15:00 GMT
  → Sticky to Server-2 for 24 hours

User B cookie: AWSALB=def456...; Expires=Tue, 06 Feb 2024 08:45:00 GMT
  → Sticky to Server-2 for 24 hours

User C cookie: AWSALB=ghi789...; Expires=Tue, 06 Feb 2024 10:30:00 GMT
  → Sticky to Server-2 for 24 hours

# Pattern: 80% of active users have stickiness to Server-2
# Because Server-2 was the "first" server when stickiness was enabled
\`\`\``,
			hint: "Users are stuck to Server-2 for 24 hours each...",
		},
		{
			id: 4,
			title: "Traffic History Analysis",
			type: "metrics",
			content: `\`\`\`
Server-2 Traffic History:

3 months ago: Stickiness enabled, Server-2 was receiving most traffic
  (It was the only server with warm caches at the time)

Users connected during that period:
  → Got cookies sticky to Server-2
  → Cookies last 24 hours
  → Users return daily (habit)
  → Cookie refreshed each visit
  → Users PERMANENTLY stuck to Server-2

New servers added last month:
  → Only receive traffic from NEW users
  → New users are minority (10% of daily traffic)
  → Existing users never redistributed

Result: Server-2 has accumulated years worth of "sticky" users
\`\`\``,
			hint: "Sticky sessions with long duration create permanent affinity...",
		},
		{
			id: 5,
			title: "Application Developer Testimony",
			type: "testimony",
			content: `"We enabled sticky sessions 3 months ago because users were complaining about inconsistent behavior - they'd add items to cart and sometimes the cart would appear empty. We had some in-memory session state that wasn't synced across servers. The 24-hour stickiness 'fixed' the problem. We never thought about the load balancing implications."`,
		},
		{
			id: 6,
			title: "Session State Investigation",
			type: "code",
			content: `\`\`\`typescript
// Shopping cart implementation
class CartService {
  // In-memory cart storage - THE ROOT CAUSE
  private carts: Map<string, CartItem[]> = new Map();

  addToCart(userId: string, item: CartItem): void {
    const cart = this.carts.get(userId) || [];
    cart.push(item);
    this.carts.set(userId, cart);
    // Cart only exists in THIS server's memory!
  }

  getCart(userId: string): CartItem[] {
    return this.carts.get(userId) || [];
    // If user hits different server, cart is empty!
  }
}

// This is why sticky sessions were "needed"
// But the real fix is external session storage
\`\`\``,
			hint: "The application requires sticky sessions due to in-memory state...",
		},
	],

	solution: {
		diagnosis: "24-hour sticky session duration causing permanent user-to-server affinity",
		keywords: [
			"sticky session",
			"session affinity",
			"load balancing",
			"uneven distribution",
			"lb_cookie",
			"session persistence",
			"round robin",
		],
		rootCause: `The load balancer has session stickiness enabled with a 24-hour duration. This was added to work around an application architecture issue (in-memory session state), but created a severe load distribution problem.

The issue compounds over time:
1. When stickiness was enabled, most traffic happened to hit Server-2
2. Users got 24-hour sticky cookies to Server-2
3. Returning users (most of your traffic) get their cookies refreshed
4. Users who visit daily are PERMANENTLY stuck to Server-2
5. New servers only receive traffic from brand new users
6. The distribution gets worse over time, never better

With 24-hour stickiness:
- Active daily users never redistribute
- Server-2 accumulated 80% of the active user base
- New servers are essentially useless
- Auto-scaling adds capacity but doesn't help

The underlying problem is the application's reliance on in-memory session state, which required sticky sessions as a workaround.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Reduce stickiness duration for gradual rebalancing",
				code: `# Step 1: Reduce stickiness duration (immediate relief)
TargetGroup:
  Stickiness:
    Enabled: true
    Type: lb_cookie
    Duration: 300  # 5 minutes instead of 24 hours

# This allows users to redistribute after 5 minutes of inactivity
# Most users will rebalance within a day

# Step 2: Eventually disable stickiness (after fixing app)
TargetGroup:
  Stickiness:
    Enabled: false

# Only do this after implementing external session storage!`,
			},
			{
				lang: "typescript",
				description: "Fix root cause: External session storage",
				code: `import Redis from 'ioredis';

class CartService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: 'redis.internal',
      port: 6379,
      // Use Redis Cluster for high availability
    });
  }

  async addToCart(userId: string, item: CartItem): Promise<void> {
    const key = \`cart:\${userId}\`;
    const cart = await this.getCart(userId);
    cart.push(item);

    // Store in Redis with 24-hour expiry
    await this.redis.setex(key, 86400, JSON.stringify(cart));
  }

  async getCart(userId: string): Promise<CartItem[]> {
    const key = \`cart:\${userId}\`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : [];
  }
}

// Now ANY server can handle ANY user's request
// Sticky sessions no longer needed!`,
			},
			{
				lang: "bash",
				description: "Immediate mitigation: Manual rebalancing",
				code: `# If you need immediate relief without code changes:

# Option 1: Restart/replace the overloaded server
# This breaks sticky sessions to that server
# Users will redistribute on next request
aws ec2 terminate-instances --instance-ids i-server2
# Auto-scaling will replace it, users redistribute

# Option 2: Reduce weight of overloaded server
# (If using weighted distribution)
aws elbv2 modify-target-group-attributes \\
  --target-group-arn arn:aws:elasticloadbalancing:... \\
  --attributes Key=stickiness.enabled,Value=false

# Option 3: Clear sticky cookies (requires client action)
# Set cookie with immediate expiry
Set-Cookie: AWSALB=deleted; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`,
			},
		],
		prevention: [
			"Avoid sticky sessions unless absolutely necessary",
			"Use external session storage (Redis, Memcached, database)",
			"If sticky sessions needed, use short duration (5-15 minutes)",
			"Monitor per-server traffic distribution regularly",
			"Alert on uneven distribution (e.g., >2x difference between servers)",
			"Design applications to be stateless from the start",
		],
		educationalInsights: [
			"Sticky sessions are a band-aid for stateful application design",
			"Long sticky session duration causes permanent affinity accumulation",
			"New servers don't help if existing users never redistribute",
			"Auto-scaling is ineffective when traffic can't reach new instances",
			"The 'fix' for inconsistent behavior created a worse scaling problem",
			"External session storage enables true horizontal scaling",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const weekendWarriorsCrisis: DetectiveCase = {
	id: "weekend-warriors-crisis",
	title: "The Weekend Warriors Crisis",
	subtitle: "Performance tanks every weekend, fine on weekdays",
	difficulty: "mid",
	category: "caching",

	crisis: {
		description:
			"Every weekend, API response times spike from 50ms to 2-3 seconds. The pattern is consistent: Friday evening degradation, Sunday improvement, perfect by Monday. Load is actually lower on weekends.",
		impact:
			"Weekend player experience degraded. Matchmaking slow. Store purchases timing out. Weekend player retention dropping.",
		timeline: [
			{ time: "Friday 6pm", event: "Response times start climbing", type: "warning" },
			{ time: "Saturday 12pm", event: "Peak degradation, 3s average response", type: "critical" },
			{ time: "Sunday 6pm", event: "Gradual improvement begins", type: "warning" },
			{ time: "Monday 9am", event: "Back to normal 50ms responses", type: "normal" },
		],
	},

	symptoms: {
		working: [
			"Weekday performance excellent (50ms)",
			"Database performing well",
			"No error rate increase",
			"Server resources underutilized",
		],
		broken: [
			"Weekend response times 50-100x worse",
			"Lower traffic but slower responses",
			"Pattern repeats every weekend",
			"Cache hit ratio drops on weekends",
		],
	},

	clues: [
		{
			id: 1,
			title: "Cache Metrics by Day",
			type: "metrics",
			content: `\`\`\`
Cache Hit Ratio:
- Monday:    98.2%
- Tuesday:   98.5%
- Wednesday: 98.4%
- Thursday:  98.1%
- Friday:    94.7%
- Saturday:  67.3%  ← Dramatic drop
- Sunday:    71.2%
\`\`\``,
			hint: "What happens to cache hit ratio on weekends?",
		},
		{
			id: 2,
			title: "Traffic Patterns",
			type: "metrics",
			content: `\`\`\`
Requests per minute:
- Weekday avg:  12,500 rpm
- Saturday avg:  8,200 rpm
- Sunday avg:    7,800 rpm

Active users:
- Weekday avg:  45,000
- Weekend avg:  38,000

Weekend traffic is LOWER, but performance is WORSE
\`\`\``,
		},
		{
			id: 3,
			title: "Cache Configuration",
			type: "config",
			content: `\`\`\`yaml
cache:
  provider: redis-cluster
  default_ttl: 86400  # 24 hours

  specific_ttls:
    player_profile: 86400      # 24 hours
    game_catalog: 604800       # 7 days
    matchmaking_pools: 300     # 5 minutes
    leaderboards: 60           # 1 minute

  warming:
    enabled: true
    schedule: "0 6 * * 1-5"    # 6 AM, Monday-Friday
    targets:
      - popular_items
      - featured_games
      - player_profiles_active
\`\`\``,
			hint: "Look at the warming schedule carefully...",
		},
		{
			id: 4,
			title: "Cache Warming Job Logs",
			type: "logs",
			content: `\`\`\`
[2024-01-15 06:00:00] Cache warming started (Monday)
[2024-01-15 06:00:45] Warmed 15,000 popular items
[2024-01-15 06:01:22] Warmed 2,500 featured games
[2024-01-15 06:03:15] Warmed 50,000 active player profiles
[2024-01-15 06:03:15] Cache warming complete

[2024-01-16 06:00:00] Cache warming started (Tuesday)
...

[2024-01-19 06:00:00] Cache warming started (Friday)
[2024-01-19 06:03:18] Cache warming complete

[2024-01-20] No cache warming scheduled (Saturday)
[2024-01-21] No cache warming scheduled (Sunday)
\`\`\``,
		},
		{
			id: 5,
			title: "TTL Expiration Analysis",
			type: "metrics",
			content: `\`\`\`
Cache key expiration distribution:

Keys set Monday 6 AM: expire Tuesday 6 AM
Keys set Tuesday 6 AM: expire Wednesday 6 AM
Keys set Wednesday 6 AM: expire Thursday 6 AM
Keys set Thursday 6 AM: expire Friday 6 AM
Keys set Friday 6 AM: expire Saturday 6 AM ← No warming Saturday

Friday's warmed cache expires Saturday morning.
No warming runs Saturday or Sunday.
Monday's warming restores cache.

Weekend = Cold cache + No warming = Cache misses
\`\`\``,
		},
		{
			id: 6,
			title: "User Pattern Analysis",
			type: "testimony",
			content: `"I noticed that the first request for any player profile on Saturday takes forever, like 2-3 seconds. But if I request the same profile again, it's fast. It's like everything is being loaded from scratch. Our weekday players have their profiles cached, but weekend-only players don't."`,
		},
	],

	solution: {
		diagnosis: "Cache TTL of 24 hours combined with cache warming only running on weekdays causes mass cache expiration on weekends",
		keywords: [
			"cache warming",
			"ttl mismatch",
			"weekend",
			"expiration",
			"cold cache",
			"cache miss",
			"warming schedule",
		],
		rootCause: `The cache warming job runs at 6 AM Monday through Friday, setting 24-hour TTLs on popular data.

The problem:
1. Friday 6 AM: Cache is warmed with 24-hour TTLs
2. Saturday 6 AM: Friday's cached data expires
3. Saturday: No warming runs - cache is cold
4. Sunday: Still no warming - cache stays cold
5. Monday 6 AM: Warming restores cache

On weekends:
- 67,000 player profiles that were cached now need to be fetched from DB
- Every "popular item" needs to be recomputed
- Featured games need to be loaded fresh
- Each cold cache hit causes a 2-3 second database query

Even though weekend traffic is lower, every request is a cache miss, overwhelming the database and causing slow responses.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Run cache warming every day",
				code: `cache:
  warming:
    enabled: true
    schedule: "0 6 * * *"    # 6 AM, every day (was: 1-5)
    targets:
      - popular_items
      - featured_games
      - player_profiles_active`,
			},
			{
				lang: "yaml",
				description: "Extend TTL beyond warming gap",
				code: `cache:
  default_ttl: 259200  # 3 days (was: 24 hours)

  # Or specifically for warmed content:
  warming_ttl: 259200  # 3 days - survives weekend gap`,
			},
			{
				lang: "typescript",
				description: "Implement adaptive TTL based on access patterns",
				code: `class CacheService {
  async getWithAdaptiveTTL<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: { baseTTL: number; maxTTL: number }
  ): Promise<T> {
    const cached = await this.cache.get(key);

    if (cached) {
      // Extend TTL on access (like touch)
      const currentTTL = await this.cache.ttl(key);
      const newTTL = Math.min(currentTTL + options.baseTTL, options.maxTTL);
      await this.cache.expire(key, newTTL);
      return cached;
    }

    const data = await fetchFn();

    // Popular items get longer initial TTL
    const accessCount = await this.getAccessCount(key);
    const ttl = accessCount > 100 ? options.maxTTL : options.baseTTL;

    await this.cache.set(key, data, ttl);
    return data;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Stagger cache expiration to prevent thundering herd",
				code: `class CacheWarmer {
  async warmCache(): Promise<void> {
    const items = await this.getItemsToWarm();

    for (const item of items) {
      // Add random jitter to TTL (22-26 hours instead of exactly 24)
      const baseTTL = 86400;  // 24 hours
      const jitter = Math.floor(Math.random() * 14400) - 7200; // ±2 hours
      const ttl = baseTTL + jitter;

      await this.cache.set(item.key, item.value, ttl);
    }
  }
}`,
			},
		],
		prevention: [
			"Cache warming should run at least once per TTL period",
			"If warming is daily, TTL should be >24 hours (with buffer)",
			"Consider warming more frequently for critical data",
			"Add TTL jitter to prevent synchronized expiration",
			"Monitor cache hit ratio by day of week",
			"Set up alerts for cache hit ratio drops",
		],
		educationalInsights: [
			"TTL and warming schedule must be coordinated",
			"Lower traffic doesn't mean better performance if caches are cold",
			"Day-of-week patterns often indicate scheduled job issues",
			"Cache warming is only effective if it runs before TTL expires",
			"The 'thundering herd' effect: mass expiration = mass cache misses",
			"Weekend bugs are often related to weekday-only automation",
		],
	},
};

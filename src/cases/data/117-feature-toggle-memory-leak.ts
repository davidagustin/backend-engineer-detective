import type { DetectiveCase } from "../../types";

export const featureToggleMemoryLeak: DetectiveCase = {
	id: "feature-toggle-memory-leak",
	title: "The Feature Toggle Memory Leak",
	subtitle: "Memory growing steadily from flag evaluation cache",
	difficulty: "mid",
	category: "memory",

	crisis: {
		description:
			"Application memory usage is growing steadily, requiring restarts every 8-12 hours. The growth started after the team adopted a feature flag system. Each pod grows from 512MB to 4GB before OOMKilled.",
		impact:
			"Unplanned pod restarts 2-3 times daily. User sessions interrupted during restarts. On-call engineers woken up at night. Infrastructure costs up 40% from oversized pods.",
		timeline: [
			{ time: "Day 1", event: "Feature flag SDK integrated", type: "normal" },
			{ time: "Day 3", event: "First OOMKilled pod noticed", type: "warning" },
			{ time: "Day 5", event: "Pattern recognized: 8-12 hour growth cycle", type: "warning" },
			{ time: "Day 7", event: "Pod memory limit increased to 4GB (temporary fix)", type: "warning" },
			{ time: "Day 10", event: "Still hitting 4GB limit, restarts continue", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Application starts with normal memory (~512MB)",
			"Feature flags evaluate correctly",
			"No obvious errors in logs",
			"CPU usage is normal",
			"Database connections stable",
		],
		broken: [
			"Memory grows ~300MB per hour",
			"Growth continues even with constant traffic",
			"Heap dumps show large Map objects",
			"Memory doesn't decrease after traffic drops",
			"GC runs frequently but doesn't reclaim much",
		],
	},

	clues: [
		{
			id: 1,
			title: "Memory Profile Over Time",
			type: "metrics",
			content: `\`\`\`
Memory Usage Timeline (Pod startup at 00:00):
=============================================
00:00  512MB  (startup)
02:00  1.1GB  (+588MB)
04:00  1.7GB  (+600MB)
06:00  2.3GB  (+600MB)
08:00  2.9GB  (+600MB)
10:00  3.5GB  (+600MB)
12:00  4.0GB  (OOMKilled)

Heap Breakdown at 10:00:
- Map objects: 2.8GB (80%)
- String objects: 400MB (11%)
- Other: 300MB (9%)

Top memory holders:
1. FeatureFlagCache._evaluationCache: 2.1GB
2. FeatureFlagCache._userContextCache: 700MB
\`\`\``,
			hint: "The feature flag cache objects are consuming most memory...",
		},
		{
			id: 2,
			title: "Feature Flag SDK Usage",
			type: "code",
			content: `\`\`\`typescript
// feature-flags.ts
import { FeatureFlagClient } from '@flags/sdk';

const client = new FeatureFlagClient({
  apiKey: process.env.FLAGS_API_KEY,
  // Cache evaluations for performance
  cacheEnabled: true,
});

export async function isFeatureEnabled(
  flagKey: string,
  userId: string,
  attributes: UserAttributes
): Promise<boolean> {
  // Build context for this evaluation
  const context = {
    userId,
    ...attributes,
    timestamp: Date.now(),
    requestId: generateRequestId(),
  };

  // Evaluate flag with context
  return client.evaluate(flagKey, context);
}
\`\`\``,
			hint: "Look at what's included in the context object...",
		},
		{
			id: 3,
			title: "SDK Cache Implementation",
			type: "code",
			content: `\`\`\`typescript
// Inside @flags/sdk (simplified)
class FeatureFlagClient {
  private _evaluationCache = new Map<string, boolean>();
  private _userContextCache = new Map<string, object>();

  async evaluate(flagKey: string, context: object): Promise<boolean> {
    // Generate cache key from flag + full context
    const cacheKey = this.generateCacheKey(flagKey, context);

    // Check cache first
    if (this._evaluationCache.has(cacheKey)) {
      return this._evaluationCache.get(cacheKey)!;
    }

    // Store context for debugging/analytics
    this._userContextCache.set(context.userId, context);

    // Evaluate and cache
    const result = await this.doEvaluation(flagKey, context);
    this._evaluationCache.set(cacheKey, result);

    return result;
  }

  private generateCacheKey(flagKey: string, context: object): string {
    // Creates key from flag name + serialized context
    return \`\${flagKey}:\${JSON.stringify(context)}\`;
  }
}
\`\`\``,
			hint: "How does the cache key get generated?",
		},
		{
			id: 4,
			title: "Traffic Analysis",
			type: "metrics",
			content: `\`\`\`
Traffic Patterns:
================
Unique users per hour: ~10,000
Requests per user per hour: ~15
Total requests per hour: ~150,000
Feature flag evaluations per request: 5

Evaluations per hour: 750,000

Cache analysis:
- Expected cache entries (users * flags): 10,000 * 12 = 120,000
- Actual cache entries after 10 hours: 7,500,000
- Cache entry size: ~400 bytes average
- Expected cache size: 48MB
- Actual cache size: 2.8GB

Growth rate matches: 750,000 new entries/hour * 400 bytes = 300MB/hour
\`\`\``,
			hint: "Why are there so many more cache entries than expected?",
		},
		{
			id: 5,
			title: "Sample Cache Keys",
			type: "logs",
			content: `\`\`\`
Sample evaluation cache keys (different entries for SAME user + flag):
=====================================================================

checkout_redesign:{"userId":"user_123","plan":"pro","timestamp":1705320000001,"requestId":"req_a1b2c3"}
checkout_redesign:{"userId":"user_123","plan":"pro","timestamp":1705320000542,"requestId":"req_d4e5f6"}
checkout_redesign:{"userId":"user_123","plan":"pro","timestamp":1705320001203,"requestId":"req_g7h8i9"}
checkout_redesign:{"userId":"user_123","plan":"pro","timestamp":1705320001891,"requestId":"req_j0k1l2"}

// Same user, same flag, but different cache keys due to:
// - timestamp (changes every millisecond)
// - requestId (unique per request)

// This means EVERY request creates a new cache entry!
\`\`\``,
			hint: "The cache key includes values that change every request...",
		},
		{
			id: 6,
			title: "SDK Configuration Options",
			type: "config",
			content: `\`\`\`typescript
// SDK documentation (not currently used)
interface FeatureFlagConfig {
  apiKey: string;

  // Cache settings
  cacheEnabled?: boolean;       // default: true
  cacheTTL?: number;            // default: Infinity (no expiration)
  maxCacheSize?: number;        // default: Infinity (no limit)

  // Context settings
  cacheKeyAttributes?: string[]; // Attributes to include in cache key
                                 // default: all attributes

  // Memory management
  enableLRU?: boolean;          // default: false
  lruMaxEntries?: number;       // default: 10000
}
\`\`\``,
			hint: "There are configuration options for controlling cache behavior...",
		},
	],

	solution: {
		diagnosis: "Feature flag cache growing unbounded due to timestamp/requestId in cache keys",
		keywords: [
			"memory leak",
			"cache",
			"feature flag",
			"cache key",
			"unbounded",
			"Map",
			"timestamp",
			"cache eviction",
			"LRU",
			"TTL",
		],
		rootCause: `The feature flag evaluation cache is keyed on the entire context object, which includes:

1. **timestamp**: Changes every millisecond, making every evaluation unique
2. **requestId**: Unique per request, ensuring no cache hits

This means even for the same user evaluating the same flag, every single request creates a new cache entry. With 750,000 evaluations per hour and no cache eviction, the cache grows by ~300MB per hour.

The cache was designed for the common pattern where context is stable (userId + static attributes). But the application adds request-specific data (timestamp, requestId) to the context for logging/debugging purposes, inadvertently making every cache key unique.

The SDK's default configuration has:
- No TTL (cache entries never expire)
- No max size (cache grows forever)
- All attributes included in cache key

This creates a memory leak that's proportional to request volume.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fix: Configure cache key attributes explicitly",
				code: `// feature-flags.ts - Fixed configuration
import { FeatureFlagClient } from '@flags/sdk';

const client = new FeatureFlagClient({
  apiKey: process.env.FLAGS_API_KEY,
  cacheEnabled: true,

  // Only use stable attributes for cache key
  cacheKeyAttributes: ['userId', 'plan', 'region', 'accountType'],

  // Add memory limits
  enableLRU: true,
  lruMaxEntries: 50000,  // ~20MB max cache size

  // Add TTL for cache freshness
  cacheTTL: 5 * 60 * 1000,  // 5 minutes
});

export async function isFeatureEnabled(
  flagKey: string,
  userId: string,
  attributes: UserAttributes
): Promise<boolean> {
  // Separate stable context from request metadata
  const context = {
    userId,
    plan: attributes.plan,
    region: attributes.region,
    accountType: attributes.accountType,
  };

  // Pass metadata separately (not in cache key)
  const metadata = {
    timestamp: Date.now(),
    requestId: generateRequestId(),
  };

  return client.evaluate(flagKey, context, { metadata });
}`,
			},
			{
				lang: "typescript",
				description: "Alternative: Implement custom LRU cache wrapper",
				code: `// lru-flag-cache.ts
import LRU from 'lru-cache';

class CachedFeatureFlagClient {
  private client: FeatureFlagClient;
  private cache: LRU<string, boolean>;

  constructor(config: FeatureFlagConfig) {
    // Disable SDK's built-in cache
    this.client = new FeatureFlagClient({
      ...config,
      cacheEnabled: false,
    });

    // Use our own LRU cache with proper limits
    this.cache = new LRU({
      max: 50000,           // Max entries
      maxSize: 50_000_000,  // 50MB max
      sizeCalculation: (value, key) => key.length + 1,
      ttl: 5 * 60 * 1000,   // 5 minute TTL
    });
  }

  async evaluate(
    flagKey: string,
    context: EvaluationContext
  ): Promise<boolean> {
    // Build deterministic cache key from stable attributes only
    const cacheKey = this.buildCacheKey(flagKey, context);

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.client.evaluate(flagKey, context);
    this.cache.set(cacheKey, result);

    return result;
  }

  private buildCacheKey(flagKey: string, context: EvaluationContext): string {
    // Only include stable, cache-worthy attributes
    const stableContext = {
      userId: context.userId,
      plan: context.plan,
      region: context.region,
    };
    return \`\${flagKey}:\${JSON.stringify(stableContext)}\`;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Add monitoring for cache size",
				code: `// flag-cache-metrics.ts
import { metrics } from './monitoring';

// Expose cache metrics
setInterval(() => {
  const client = getFeatureFlagClient();

  metrics.gauge('feature_flag.cache.size',
    client.getCacheSize());

  metrics.gauge('feature_flag.cache.entries',
    client.getCacheEntryCount());

  metrics.gauge('feature_flag.cache.hit_rate',
    client.getCacheHitRate());

  // Alert if cache is growing too fast
  const growth = client.getCacheGrowthRate();
  if (growth > 100_000_000) {  // 100MB/hour
    alerting.warn('Feature flag cache growing rapidly', {
      growthRate: growth,
      currentSize: client.getCacheSize(),
    });
  }
}, 60000);`,
			},
		],
		prevention: [
			"Always configure cache TTL and max size limits",
			"Be explicit about which attributes form the cache key",
			"Never include timestamps or request IDs in cache contexts",
			"Monitor cache size as a standard application metric",
			"Use LRU eviction for unbounded-key caches",
			"Review third-party SDK default configurations carefully",
			"Add memory usage alerts that trigger before OOM",
			"Document cache key design in code comments",
		],
		educationalInsights: [
			"Unbounded caches are memory leaks waiting to happen",
			"Cache key design is critical - wrong keys = useless cache or memory leak",
			"Request-specific data (timestamps, IDs) should rarely be in cache keys",
			"Third-party SDK defaults may not match your use case",
			"Memory leaks often appear linear - X MB per hour until crash",
			"The fix for 'cache not working' is rarely 'cache everything forever'",
			"LRU (Least Recently Used) eviction is the standard solution for bounded caches",
		],
	},
};

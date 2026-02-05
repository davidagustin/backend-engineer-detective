import type { DetectiveCase } from "../../types";

export const configHotReloadRace: DetectiveCase = {
	id: "config-hot-reload-race",
	title: "The Config Hot Reload Race",
	subtitle: "Inconsistent configuration during live reload",
	difficulty: "senior",
	category: "distributed",

	crisis: {
		description:
			"After enabling hot config reload, some requests get processed with a mix of old and new configuration values. This causes bizarre behavior: requests priced with old rates but taxed with new rates, or authenticated with new keys but authorized with old permissions.",
		impact:
			"Financial discrepancies in billing. Security audit failures. Customer complaints about inconsistent pricing. Compliance team escalation.",
		timeline: [
			{ time: "10:00 AM", event: "Config hot reload feature deployed", type: "normal" },
			{ time: "10:30 AM", event: "First config change pushed (pricing update)", type: "normal" },
			{ time: "10:31 AM", event: "Customer reports incorrect invoice", type: "warning" },
			{ time: "11:00 AM", event: "Multiple pricing inconsistencies reported", type: "warning" },
			{ time: "11:30 AM", event: "Security config changed, auth errors spike", type: "critical" },
			{ time: "12:00 PM", event: "Pattern identified: issues during config changes", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Config changes eventually apply",
			"System stable when config is static",
			"Individual config values read correctly",
			"Config source (file/service) is correct",
			"Logs show config reload events",
		],
		broken: [
			"Requests processed with mixed config versions",
			"Same request sees different config in different handlers",
			"Race window is ~50-500ms during reload",
			"More handlers = more inconsistency",
			"Cannot reproduce reliably in testing",
		],
	},

	clues: [
		{
			id: 1,
			title: "Config Manager Implementation",
			type: "code",
			content: `\`\`\`typescript
// config-manager.ts
class ConfigManager {
  private config: AppConfig;
  private watcher: ConfigWatcher;

  constructor() {
    this.config = this.loadConfig();
    this.watcher = new ConfigWatcher();

    // Watch for config changes
    this.watcher.on('change', async () => {
      console.log('Config change detected, reloading...');
      await this.reload();
    });
  }

  async reload(): Promise<void> {
    const newConfig = await this.fetchConfig();

    // Update config properties one by one
    this.config.pricing = newConfig.pricing;
    this.config.taxes = newConfig.taxes;
    this.config.auth = newConfig.auth;
    this.config.limits = newConfig.limits;
    this.config.features = newConfig.features;

    console.log('Config reload complete');
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }
}

export const configManager = new ConfigManager();
\`\`\``,
			hint: "Look at how the config object is updated during reload...",
		},
		{
			id: 2,
			title: "Request Processing Flow",
			type: "code",
			content: `\`\`\`typescript
// order-handler.ts
async function processOrder(order: Order): Promise<OrderResult> {
  // Step 1: Calculate price using pricing config
  const pricing = configManager.get('pricing');
  const subtotal = calculateSubtotal(order, pricing);

  // Step 2: Some async work (DB call, ~50ms)
  await validateInventory(order);

  // Step 3: Calculate tax using tax config
  const taxes = configManager.get('taxes');
  const taxAmount = calculateTax(subtotal, taxes, order.region);

  // Step 4: More async work (~100ms)
  await reserveInventory(order);

  // Step 5: Apply limits using limits config
  const limits = configManager.get('limits');
  validateOrderLimits(order, limits);

  return { subtotal, taxAmount, total: subtotal + taxAmount };
}
\`\`\``,
			hint: "Notice the gaps between config reads...",
		},
		{
			id: 3,
			title: "Problematic Request Timeline",
			type: "logs",
			content: `\`\`\`
Request REQ-12345 Timeline (during config reload):
==================================================
10:30:00.000  Config change detected, starting reload
10:30:00.005  config.pricing updated (v2)
10:30:00.010  Request REQ-12345 starts
10:30:00.012  REQ-12345 reads pricing (gets v2 - NEW prices)
10:30:00.015  config.taxes updated (v2)
10:30:00.020  config.auth updated (v2)
10:30:00.060  REQ-12345 reads taxes (gets v2 - NEW taxes)
10:30:00.025  config.limits updated (v2)
10:30:00.160  REQ-12345 reads limits (gets v2 - NEW limits)
10:30:00.030  config.features updated (v2)
10:30:00.035  Config reload complete

Result: This request got all v2 config (consistent - LUCKY)

Request REQ-12346 Timeline (unlucky timing):
============================================
10:30:00.003  Request REQ-12346 starts
10:30:00.004  REQ-12346 reads pricing (gets v1 - OLD prices)
10:30:00.005  config.pricing updated (v2)
10:30:00.015  config.taxes updated (v2)
10:30:00.055  REQ-12346 reads taxes (gets v2 - NEW taxes)
10:30:00.155  REQ-12346 reads limits (gets v2 - NEW limits)

Result: This request got MIXED config (v1 prices + v2 taxes) - BUG!
\`\`\``,
			hint: "The request spans the config update window...",
		},
		{
			id: 4,
			title: "SRE Investigation Notes",
			type: "testimony",
			content: `"We added logging and found that during config reloads, there's about a 30ms window where different parts of the config object have different versions. The problem is our request handlers do multiple config reads with async operations in between. If a request starts reading config, then we reload, then it reads more config - it gets a mix. The probability increases with more concurrent requests and longer request processing times."`,
		},
		{
			id: 5,
			title: "Concurrency Analysis",
			type: "metrics",
			content: `\`\`\`
Config Reload Analysis:
=======================
Average reload time: 35ms
Config properties updated: 5
Time between property updates: ~7ms each

Request Analysis:
=================
Requests per second: 500
Average request duration: 200ms
Config reads per request: 3-5
Average time between reads: 50-100ms

Probability of race condition:
- Requests in flight during 35ms reload: ~17
- Requests that span multiple config reads: ~70%
- P(inconsistent config) per reload: ~12 requests

We do ~50 config reloads per day
Expected inconsistent requests: ~600/day
\`\`\``,
			hint: "The math shows this is statistically inevitable...",
		},
		{
			id: 6,
			title: "Failed Fix Attempt",
			type: "code",
			content: `\`\`\`typescript
// Attempted fix: Add a lock during reload
class ConfigManager {
  private config: AppConfig;
  private isReloading = false;

  async reload(): Promise<void> {
    this.isReloading = true;  // Set flag

    const newConfig = await this.fetchConfig();
    this.config.pricing = newConfig.pricing;
    this.config.taxes = newConfig.taxes;
    // ... other properties

    this.isReloading = false;  // Clear flag
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    // Problem: This doesn't actually help!
    // - Doesn't block in-flight requests
    // - Doesn't make the update atomic
    // - Just adds an extra boolean check
    while (this.isReloading) {
      // Spin wait? Block the event loop? Bad!
    }
    return this.config[key];
  }
}
\`\`\``,
			hint: "This fix doesn't actually solve the problem...",
		},
	],

	solution: {
		diagnosis: "Non-atomic config updates cause requests to see mixed configuration versions",
		keywords: [
			"race condition",
			"hot reload",
			"config",
			"atomic",
			"consistency",
			"immutable",
			"snapshot",
			"version",
			"concurrent",
		],
		rootCause: `The config manager updates properties one at a time during reload. Since JavaScript is single-threaded but async, requests that were in-flight when reload started continue executing between property updates.

The sequence:
1. Request starts, reads \`config.pricing\` (v1)
2. Config reload begins, updates \`pricing\` to v2
3. Request does async work (awaits)
4. Config reload updates \`taxes\` to v2
5. Request resumes, reads \`config.taxes\` (v2)
6. Request now has v1 pricing + v2 taxes = inconsistent

The core problems:
1. **Non-atomic update**: Properties updated sequentially, not atomically
2. **Shared mutable state**: All requests share the same config object
3. **No request isolation**: Requests don't get a consistent snapshot

The failed lock attempt doesn't help because:
- It can't pause in-flight requests (they're already holding old references)
- Blocking the event loop is catastrophic for Node.js
- The fundamental issue is sharing mutable state, not timing`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fix: Atomic config replacement with immutable objects",
				code: `// config-manager.ts - Fixed with atomic replacement
class ConfigManager {
  // Store reference to complete, immutable config object
  private configRef: Readonly<AppConfig>;

  constructor() {
    this.configRef = Object.freeze(this.loadConfig());
    this.watchForChanges();
  }

  async reload(): Promise<void> {
    // Fetch complete new config
    const newConfig = await this.fetchConfig();

    // Atomic replacement: single reference assignment
    // JavaScript guarantees this is atomic
    this.configRef = Object.freeze(newConfig);

    console.log('Config atomically replaced');
  }

  // Return snapshot - caller gets consistent view
  getSnapshot(): Readonly<AppConfig> {
    return this.configRef;
  }

  // Individual property access still works
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.configRef[key];
  }
}`,
			},
			{
				lang: "typescript",
				description: "Request handler using config snapshot",
				code: `// order-handler.ts - Fixed with snapshot pattern
async function processOrder(order: Order): Promise<OrderResult> {
  // Get snapshot at request start - guaranteed consistent
  const config = configManager.getSnapshot();

  // All reads from same snapshot
  const subtotal = calculateSubtotal(order, config.pricing);

  await validateInventory(order);

  // Still using original snapshot
  const taxAmount = calculateTax(subtotal, config.taxes, order.region);

  await reserveInventory(order);

  // Same snapshot throughout request
  validateOrderLimits(order, config.limits);

  return { subtotal, taxAmount, total: subtotal + taxAmount };
}`,
			},
			{
				lang: "typescript",
				description: "Advanced: Versioned config with request context",
				code: `// versioned-config.ts
class VersionedConfigManager {
  private versions: Map<number, Readonly<AppConfig>> = new Map();
  private currentVersion = 0;
  private maxVersionsKept = 3;

  async reload(): Promise<void> {
    const newConfig = await this.fetchConfig();
    const newVersion = ++this.currentVersion;

    // Store new version
    this.versions.set(newVersion, Object.freeze(newConfig));

    // Cleanup old versions (keep last 3 for in-flight requests)
    for (const [version] of this.versions) {
      if (version < newVersion - this.maxVersionsKept) {
        this.versions.delete(version);
      }
    }
  }

  // Get current version number
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  // Get config for specific version
  getConfig(version: number): Readonly<AppConfig> | undefined {
    return this.versions.get(version);
  }

  // Get latest config
  getLatest(): Readonly<AppConfig> {
    return this.versions.get(this.currentVersion)!;
  }
}

// Request middleware
function configMiddleware(req: Request, res: Response, next: Next) {
  // Pin config version at request start
  req.configVersion = configManager.getCurrentVersion();
  req.config = configManager.getConfig(req.configVersion)!;
  next();
}`,
			},
			{
				lang: "typescript",
				description: "Testing for race conditions",
				code: `// config-race-test.ts
describe('Config hot reload consistency', () => {
  it('should provide consistent config during reload', async () => {
    const results: ConfigSnapshot[] = [];

    // Simulate concurrent requests during reload
    const requestPromises = Array(100).fill(null).map(async (_, i) => {
      // Stagger request starts
      await sleep(i * 2);

      const config = configManager.getSnapshot();

      // Simulate request with multiple config reads
      const pricing = config.pricing.version;
      await sleep(50);  // Async work
      const taxes = config.taxes.version;
      await sleep(50);
      const limits = config.limits.version;

      return { pricing, taxes, limits };
    });

    // Trigger reload mid-requests
    setTimeout(() => configManager.reload(), 100);

    const snapshots = await Promise.all(requestPromises);

    // Verify all requests got consistent versions
    for (const snapshot of snapshots) {
      expect(snapshot.pricing).toBe(snapshot.taxes);
      expect(snapshot.taxes).toBe(snapshot.limits);
    }
  });
});`,
			},
		],
		prevention: [
			"Use atomic reference replacement for config objects, not property-by-property updates",
			"Freeze config objects to prevent accidental mutation",
			"Capture config snapshot at request start, use throughout",
			"Test config reload under concurrent load",
			"Log config version with each request for debugging",
			"Consider config versioning for audit trails",
			"Use dependency injection to pass config snapshots",
			"Document that config is immutable and why",
		],
		educationalInsights: [
			"JavaScript single-threadedness doesn't prevent async race conditions",
			"Reference assignment is atomic in JavaScript; property updates are not",
			"Immutability + atomic replacement = safe concurrent access",
			"The 'snapshot at request start' pattern is common in databases too",
			"Race conditions during reload are probabilistic - hard to reproduce, always happen in production",
			"Locks in async code are almost always the wrong solution",
			"Config should be treated like a database transaction - consistent read view",
		],
	},
};

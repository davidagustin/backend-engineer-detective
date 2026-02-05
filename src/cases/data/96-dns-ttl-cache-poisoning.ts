import type { DetectiveCase } from "../../types";

export const dnsTtlCachePoisoning: DetectiveCase = {
	id: "dns-ttl-cache-poisoning",
	title: "The DNS TTL Cache Poisoning",
	subtitle: "Stale DNS records causing traffic to old servers",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"After a routine infrastructure migration, some users are still hitting old servers that were supposed to be decommissioned. The DNS records were updated hours ago, but traffic keeps flowing to the old IP addresses. Worse, some of the old servers have been repurposed, causing data to go to wrong destinations.",
		impact:
			"15% of traffic going to decommissioned servers. Some requests hitting repurposed servers with different applications. Data integrity concerns. Inconsistent user experience across regions.",
		timeline: [
			{ time: "2:00 AM", event: "DNS records updated for migration (api.example.com)", type: "normal" },
			{ time: "2:15 AM", event: "Old servers decommissioned", type: "normal" },
			{ time: "6:00 AM", event: "Reports of 'server not found' errors", type: "warning" },
			{ time: "8:00 AM", event: "Discovery: old IPs reassigned to different service", type: "critical" },
			{ time: "9:00 AM", event: "Customer data sent to wrong application", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"New DNS lookups return correct IP",
			"Direct IP access to new servers works",
			"Most users experiencing normal service",
			"DNS propagation checkers show correct values",
			"Authoritative DNS servers have correct records",
		],
		broken: [
			"Some clients still connecting to old IPs",
			"Intermittent failures for long-running applications",
			"Cached DNS resolvers serving stale records",
			"Some corporate networks stuck on old IP",
		],
	},

	clues: [
		{
			id: 1,
			title: "DNS Record Configuration",
			type: "config",
			content: `\`\`\`
# Route 53 record (current)
api.example.com.  A  10.0.2.100, 10.0.2.101, 10.0.2.102  TTL: 300

# Previous record (before migration)
api.example.com.  A  10.0.1.50, 10.0.1.51, 10.0.1.52   TTL: 86400

# Record was changed at 2:00 AM
# Note: TTL was reduced from 86400 (24 hours) to 300 (5 minutes)
# But this only affects NEW lookups after the change
\`\`\``,
			hint: "What TTL did clients cache BEFORE the change?",
		},
		{
			id: 2,
			title: "Client DNS Cache Investigation",
			type: "logs",
			content: `\`\`\`bash
# On affected corporate client
$ nslookup api.example.com
Server:  corporate-dns.internal
Address: 192.168.1.10

Name:    api.example.com
Address: 10.0.1.50      # OLD IP!
TTL:     72341          # Still has 20+ hours of cache left

# On working home client
$ nslookup api.example.com
Server:  8.8.8.8
Address: 8.8.8.8

Name:    api.example.com
Address: 10.0.2.100     # Correct new IP
TTL:     247
\`\`\``,
			hint: "Look at the TTL remaining on the corporate client...",
		},
		{
			id: 3,
			title: "Application DNS Behavior",
			type: "code",
			content: `\`\`\`java
// Java application HTTP client configuration
public class ApiClient {
    private static final HttpClient client = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_2)
        .connectTimeout(Duration.ofSeconds(10))
        .build();

    // DNS is resolved ONCE when client is created
    // and cached for the lifetime of the JVM

    private static final String API_URL = "https://api.example.com";

    public Response makeRequest(String path) {
        // Uses cached DNS resolution
        return client.send(
            HttpRequest.newBuilder()
                .uri(URI.create(API_URL + path))
                .build(),
            HttpResponse.BodyHandlers.ofString()
        );
    }
}
\`\`\``,
			hint: "When does Java resolve DNS for an HttpClient?",
		},
		{
			id: 4,
			title: "Infrastructure Metrics",
			type: "metrics",
			content: `\`\`\`
Traffic to OLD IPs (10.0.1.50-52):
  2:00 AM: 45,000 req/min (expected - pre-migration)
  3:00 AM: 38,000 req/min (some clients refreshed)
  6:00 AM: 12,000 req/min (still significant!)
  9:00 AM:  8,500 req/min (should be ZERO)
  12:00 PM: 6,200 req/min (persistent!)

Traffic to NEW IPs (10.0.2.100-102):
  2:00 AM:  0 req/min
  3:00 AM:  7,000 req/min
  6:00 AM: 33,000 req/min
  9:00 AM: 36,500 req/min
  12:00 PM: 38,800 req/min

# ~15% of traffic STILL going to old IPs 10 hours later
\`\`\``,
			hint: "Why is traffic to old IPs decreasing so slowly?",
		},
		{
			id: 5,
			title: "DevOps Engineer Testimony",
			type: "testimony",
			content: `"We've done DNS migrations before without issues. This time we reduced the TTL right before the change, like the documentation says. But we didn't realize the old TTL was 24 hours! The change request just said 'reduce TTL to 5 minutes' - nobody checked what it was before. And some of our Java services cache DNS forever unless you restart them."`,
		},
		{
			id: 6,
			title: "Corporate DNS Server Logs",
			type: "logs",
			content: `\`\`\`
# Corporate recursive resolver cache status
$ rndc dumpdb -cache
; Cache dump of view '_default'
api.example.com.  72156  IN  A  10.0.1.50  ; cached until tomorrow
api.example.com.  72156  IN  A  10.0.1.51  ; cached until tomorrow
api.example.com.  72156  IN  A  10.0.1.52  ; cached until tomorrow

# Resolver configuration
options {
    max-cache-ttl 86400;     # Honors TTLs up to 24 hours
    max-ncache-ttl 3600;     # Negative cache for 1 hour
    # No minimum TTL override - uses authoritative TTL
};
\`\`\``,
			hint: "The corporate resolver cached the records with the OLD TTL...",
		},
	],

	solution: {
		diagnosis: "DNS TTL not reduced in advance, causing prolonged stale cache entries",
		keywords: [
			"dns ttl",
			"dns cache",
			"stale dns",
			"dns propagation",
			"ttl reduction",
			"dns migration",
			"cached dns",
			"resolver cache",
		],
		rootCause: `The DNS migration failed to follow the critical two-phase TTL reduction pattern. The original record had a 24-hour TTL (86400 seconds). When the IP address was changed, the new 5-minute TTL only applies to NEW lookups.

Any resolver that cached the record before the change will continue serving the old IP for up to 24 hours. The corporate DNS resolver had cached the record with its original 24-hour TTL, so it will serve the old IP until that cache expires.

Additionally, Java applications using HttpClient cache DNS resolution at the JVM level and don't respect DNS TTL at all - they require application restarts to pick up new IPs.

The proper migration pattern requires:
1. Reduce TTL to target value (e.g., 5 minutes) well in advance
2. Wait for OLD TTL to expire (24 hours in this case)
3. Then make the IP change
4. Keep low TTL until migration is confirmed successful`,
		codeExamples: [
			{
				lang: "bash",
				description: "Proper DNS migration timeline",
				code: `# PHASE 1: Reduce TTL (do this DAYS before migration)
# Current: api.example.com A 10.0.1.50 TTL 86400

aws route53 change-resource-record-sets \\
  --hosted-zone-id Z123456 \\
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.example.com",
        "Type": "A",
        "TTL": 300,  # Reduce to 5 minutes
        "ResourceRecords": [{"Value": "10.0.1.50"}]  # Keep old IP
      }
    }]
  }'

# PHASE 2: Wait for old TTL to expire (24+ hours)
echo "Wait at least 24 hours for all caches to refresh with new TTL"

# PHASE 3: Change IP address (now safe to do)
aws route53 change-resource-record-sets \\
  --hosted-zone-id Z123456 \\
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.example.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "10.0.2.100"}]  # New IP
      }
    }]
  }'`,
			},
			{
				lang: "java",
				description: "Fix Java DNS caching behavior",
				code: `// Option 1: JVM flags to respect DNS TTL
// Add to java command line:
// -Dnetworkaddress.cache.ttl=30
// -Dnetworkaddress.cache.negative.ttl=10

// Option 2: Set programmatically (must be before any DNS resolution)
public class DnsCacheConfig {
    static {
        // Cache successful lookups for 30 seconds
        java.security.Security.setProperty("networkaddress.cache.ttl", "30");
        // Cache failed lookups for 10 seconds
        java.security.Security.setProperty("networkaddress.cache.negative.ttl", "10");
    }
}

// Option 3: Use a DNS-aware HTTP client
public class ResilientApiClient {
    private final OkHttpClient client;

    public ResilientApiClient() {
        this.client = new OkHttpClient.Builder()
            .dns(hostname -> {
                // Force fresh DNS lookup each time
                return Arrays.asList(InetAddress.getAllByName(hostname));
            })
            .connectionPool(new ConnectionPool(5, 30, TimeUnit.SECONDS))
            .build();
    }
}`,
			},
			{
				lang: "bash",
				description: "Emergency fix: Flush DNS caches",
				code: `# Flush corporate DNS resolver cache (BIND)
rndc flush

# Flush specific domain only
rndc flushname api.example.com

# For clients - flush local DNS cache
# Windows
ipconfig /flushdns

# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Linux (systemd-resolved)
sudo systemd-resolve --flush-caches

# For Java applications - restart is required
# Or use JMX to trigger DNS cache clear if implemented`,
			},
		],
		prevention: [
			"Always reduce TTL to migration target BEFORE changing IP addresses",
			"Wait at least OLD_TTL duration before making the actual change",
			"Configure application DNS caching to respect reasonable TTLs",
			"Keep old servers running (even if just returning 301) until TTL expires",
			"Test DNS propagation from multiple vantage points before decommissioning",
			"Document DNS TTL values for all critical services",
		],
		educationalInsights: [
			"DNS TTL is a promise to caches about how long they can keep the record",
			"Reducing TTL only affects lookups AFTER the change",
			"JVM default DNS caching is infinite for successful lookups",
			"Corporate DNS resolvers may have their own maximum cache times",
			"Never decommission old IPs immediately - traffic will continue for TTL duration",
			"DNS propagation is not instantaneous - it's bounded by cached TTLs",
		],
	},
};

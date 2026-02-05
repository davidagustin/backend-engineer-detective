import type { DetectiveCase } from "../../types";

export const invisibleTrafficSpike: DetectiveCase = {
	id: "invisible-traffic-spike",
	title: "The Invisible Traffic Spike",
	subtitle: "Servers overloaded but traffic graphs show normal",
	difficulty: "principal",
	category: "distributed",

	crisis: {
		description:
			"Asian region servers are completely overloaded, returning 503 errors. But traffic monitoring shows normal request rates. Load balancer metrics look fine. Something is generating massive internal load that isn't visible in external metrics.",
		impact:
			"All Asian users experiencing outages. 30% of global user base affected. Services returning 503s. Revenue loss from store unavailability.",
		timeline: [
			{ time: "02:00 UTC", event: "Asian region CPU spikes to 100%", type: "critical" },
			{ time: "02:05 UTC", event: "503 errors from Asian servers", type: "critical" },
			{ time: "02:10 UTC", event: "Traffic metrics checked - looks normal", type: "warning" },
			{ time: "02:15 UTC", event: "Auto-scaling triggered but new instances also overloaded", type: "critical" },
			{ time: "02:30 UTC", event: "US/EU regions unaffected", type: "warning" },
		],
	},

	symptoms: {
		working: [
			"US and EU regions normal",
			"External traffic monitoring shows normal",
			"Load balancer request count normal",
			"Database performing well",
		],
		broken: [
			"Asian servers at 100% CPU",
			"New instances immediately overloaded",
			"Internal network traffic 10x normal",
			"503 errors for all Asian users",
		],
	},

	clues: [
		{
			id: 1,
			title: "Traffic Monitoring Dashboard",
			type: "metrics",
			content: `\`\`\`
External Request Rate (Load Balancer):

US-EAST:  12,450 req/min (normal)
US-WEST:   8,230 req/min (normal)
EU-WEST:  15,670 req/min (normal)
AP-SOUTH: 11,200 req/min (normal) ← Looks fine!

But internally...

Internal Service Calls (Service Mesh):

US-EAST:   45,000 calls/min (3.6x external)
US-WEST:   31,000 calls/min (3.8x external)
EU-WEST:   58,000 calls/min (3.7x external)
AP-SOUTH: 892,000 calls/min (80x external!) ← WHAT?!
\`\`\``,
			hint: "The internal traffic is 80x the external traffic in Asia...",
		},
		{
			id: 2,
			title: "GeoDNS Configuration",
			type: "config",
			content: `\`\`\`
DNS Configuration (api.gaming.com):

Resolver Location → Server Region
─────────────────────────────────
North America    → us-east-1
South America    → us-east-1
Europe           → eu-west-1
Asia             → ap-south-1
Oceania          → ap-south-1

CDN Configuration:
- Static assets: Global CDN
- API: GeoDNS to regional servers
- Failover: US-EAST (global fallback)
\`\`\``,
		},
		{
			id: 3,
			title: "Service Architecture",
			type: "config",
			content: `\`\`\`
Microservices Architecture:

┌──────────┐     ┌──────────┐     ┌──────────┐
│   API    │────▶│   User   │────▶│ Profile  │
│ Gateway  │     │ Service  │     │ Service  │
└──────────┘     └──────────┘     └──────────┘
                       │
                       ▼
                ┌──────────┐     ┌──────────┐
                │ Inventory│────▶│   Item   │
                │ Service  │     │ Service  │
                └──────────┘     └──────────┘

Each service calls others via HTTP
Service discovery: DNS-based (service-name.internal)
Cross-region calls: Routed via GeoDNS
\`\`\``,
		},
		{
			id: 4,
			title: "Service Discovery DNS",
			type: "config",
			content: `\`\`\`
Internal Service DNS Records:

user-service.internal:
  US-EAST resolver  → user-service.us-east.internal
  EU-WEST resolver  → user-service.eu-west.internal
  AP-SOUTH resolver → user-service.ap-south.internal

inventory-service.internal:
  US-EAST resolver  → inventory-service.us-east.internal
  EU-WEST resolver  → inventory-service.eu-west.internal
  AP-SOUTH resolver → ??? (no record configured!)
\`\`\``,
			hint: "What happens when a DNS record is missing?",
		},
		{
			id: 5,
			title: "DNS Query Logs",
			type: "logs",
			content: `\`\`\`
AP-SOUTH region DNS queries:

02:00:01 inventory-service.internal → NXDOMAIN
02:00:01 inventory-service.internal → NXDOMAIN (retry 1)
02:00:01 inventory-service.internal → NXDOMAIN (retry 2)
02:00:01 Falling back to global failover...
02:00:01 inventory-service.internal → inventory-service.us-east.internal

Every AP-SOUTH service call to inventory-service:
1. Tries local DNS → fails (no record)
2. Retries 3 times → fails
3. Falls back to US-EAST

This adds latency AND routes ALL inventory traffic to US-EAST!
\`\`\``,
		},
		{
			id: 6,
			title: "Traffic Flow Analysis",
			type: "logs",
			content: `\`\`\`
Request flow for Asian user:

1. User → (GeoDNS) → AP-SOUTH API Gateway
2. API Gateway → (local) → AP-SOUTH User Service
3. User Service → (DNS fail) → US-EAST Inventory Service
4. Inventory Service → (local) → US-EAST Item Service
5. US-EAST Item Service → needs user's region data → AP-SOUTH Profile Service
6. AP-SOUTH Profile Service → (DNS fail) → US-EAST Inventory Service
7. ... LOOP DETECTED ...

The services are ping-ponging between regions!
\`\`\``,
		},
		{
			id: 7,
			title: "Recent Changes",
			type: "testimony",
			content: `"We launched inventory-service in AP-SOUTH last week as part of our regionalization effort. The deployment succeeded, the service is running... but looking at the DNS config, someone forgot to add the GeoDNS record for inventory-service in the AP-SOUTH region. All our other services have the record. This one just... doesn't."`,
		},
	],

	solution: {
		diagnosis: "Missing GeoDNS record for inventory-service in AP-SOUTH causes cross-region traffic loop and amplification",
		keywords: [
			"geodns",
			"dns misconfiguration",
			"traffic loop",
			"cross-region",
			"amplification",
			"fallback",
			"service discovery",
			"missing record",
		],
		rootCause: `A missing GeoDNS record for inventory-service in the AP-SOUTH region triggered a cascading failure:

1. AP-SOUTH services call inventory-service.internal
2. DNS lookup fails (no AP-SOUTH record configured)
3. After retries, falls back to US-EAST
4. US-EAST inventory-service tries to call back to user data → routes to AP-SOUTH
5. AP-SOUTH tries to call inventory → falls back to US-EAST again
6. This creates a cross-region loop for EVERY request

The amplification factor:
- 1 user request → 3-5 service calls normally
- With the loop: 1 user request → 30-50+ cross-region calls
- AP-SOUTH external: 11,200 req/min
- AP-SOUTH internal: 892,000 calls/min (80x amplification)

Auto-scaling didn't help because:
- New instances also couldn't find the DNS record
- The problem was DNS configuration, not capacity
- More instances = more DNS failures = more fallback traffic`,
		codeExamples: [
			{
				lang: "bash",
				description: "Add the missing DNS record",
				code: `# Add GeoDNS record for AP-SOUTH region
aws route53 change-resource-record-sets \\
  --hosted-zone-id Z1234567890 \\
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "inventory-service.internal",
        "Type": "A",
        "SetIdentifier": "ap-south-1",
        "Region": "ap-south-1",
        "TTL": 60,
        "ResourceRecords": [{"Value": "10.2.0.100"}]
      }
    }]
  }'`,
			},
			{
				lang: "typescript",
				description: "Service discovery with fallback monitoring",
				code: `class ServiceDiscovery {
  private metrics: MetricsClient;

  async resolve(serviceName: string): Promise<string> {
    const startTime = Date.now();
    const localRegion = this.getRegion();

    try {
      const endpoint = await this.dns.resolve(\`\${serviceName}.internal\`);

      // Check if we got a local or remote endpoint
      const resolvedRegion = this.extractRegion(endpoint);

      if (resolvedRegion !== localRegion) {
        // Cross-region resolution - log a warning
        this.metrics.increment('service_discovery.cross_region', {
          service: serviceName,
          localRegion,
          resolvedRegion,
        });

        console.warn(\`Cross-region service discovery: \${serviceName} \\
          local=\${localRegion} resolved=\${resolvedRegion}\`);
      }

      return endpoint;
    } catch (error) {
      this.metrics.increment('service_discovery.failure', {
        service: serviceName,
        region: localRegion,
        error: error.code,
      });
      throw error;
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Deployment checklist automation",
				code: `class RegionalDeploymentValidator {
  async validateDeployment(serviceName: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'];

    for (const region of regions) {
      // Check DNS record exists
      const dnsExists = await this.checkDnsRecord(serviceName, region);
      if (!dnsExists) {
        errors.push(\`Missing DNS record for \${serviceName} in \${region}\`);
      }

      // Check service is healthy in region
      const healthy = await this.checkServiceHealth(serviceName, region);
      if (!healthy) {
        errors.push(\`Service \${serviceName} unhealthy in \${region}\`);
      }
    }

    // Check for cross-region traffic (should be minimal)
    const crossRegionTraffic = await this.measureCrossRegionTraffic(serviceName);
    if (crossRegionTraffic > 0.1) { // More than 10% cross-region
      errors.push(\`High cross-region traffic for \${serviceName}: \${crossRegionTraffic * 100}%\`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}`,
			},
			{
				lang: "yaml",
				description: "Infrastructure as Code with required DNS records",
				code: `# Terraform example - enforce DNS records with service
resource "aws_route53_record" "inventory_service" {
  for_each = toset(var.regions)

  zone_id = aws_route53_zone.internal.zone_id
  name    = "inventory-service.internal"
  type    = "A"
  ttl     = 60

  set_identifier = each.key
  latency_routing_policy {
    region = each.key
  }

  records = [
    module.inventory_service[each.key].private_ip
  ]

  # Deployment fails if this isn't created
  depends_on = [module.inventory_service]
}`,
			},
		],
		prevention: [
			"Automate DNS record creation as part of service deployment",
			"Validate all regional DNS records before marking deployment complete",
			"Monitor cross-region traffic ratios per service",
			"Alert on DNS resolution failures or fallbacks",
			"Use Infrastructure as Code to tie DNS records to service deployments",
			"Implement circuit breakers to prevent cascade failures",
		],
		educationalInsights: [
			"GeoDNS misconfiguration can create invisible traffic amplification",
			"External metrics can look normal while internal systems collapse",
			"Cross-region fallback is helpful until it creates loops",
			"DNS is critical infrastructure - test it like you test code",
			"One missing record can take down a region",
			"Auto-scaling can't fix configuration problems - it can make them worse",
		],
	},
};

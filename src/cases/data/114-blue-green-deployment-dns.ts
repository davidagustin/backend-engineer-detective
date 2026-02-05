import type { DetectiveCase } from "../../types";

export const blueGreenDeploymentDns: DetectiveCase = {
	id: "blue-green-deployment-dns",
	title: "The Blue-Green Deployment DNS Dilemma",
	subtitle: "Users seeing old version despite successful deployment",
	difficulty: "mid",
	category: "distributed",

	crisis: {
		description:
			"After a blue-green deployment, some users continue seeing the old version of the application for hours. The deployment dashboard shows 100% traffic on green, but customer reports indicate otherwise. A critical bug fix isn't reaching all users.",
		impact:
			"30% of users still experiencing the bug that was supposedly fixed. Customer complaints flooding in. Business team frustrated that 'deployed fix' isn't working.",
		timeline: [
			{ time: "2:00 PM", event: "Critical bug fix merged and deployed to green", type: "normal" },
			{ time: "2:05 PM", event: "Green environment health checks pass", type: "normal" },
			{ time: "2:10 PM", event: "DNS updated to point to green", type: "normal" },
			{ time: "2:15 PM", event: "Deployment dashboard shows 100% green", type: "normal" },
			{ time: "2:30 PM", event: "First reports of users still seeing old version", type: "warning" },
			{ time: "4:00 PM", event: "30% of users confirmed on old version", type: "critical" },
			{ time: "6:00 PM", event: "Some users still on old version", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Green environment serving correct version",
			"Direct IP access to green works",
			"New users see correct version",
			"Deployment automation completed successfully",
			"Load balancer health checks pass",
		],
		broken: [
			"Some users see old application version",
			"Same user sees different versions on different devices",
			"Mobile app users affected more than web",
			"Corporate network users affected more",
			"Problem persists hours after deployment",
		],
	},

	clues: [
		{
			id: 1,
			title: "DNS Configuration",
			type: "config",
			content: `\`\`\`
# Current DNS Records for app.example.com
$ dig app.example.com

;; ANSWER SECTION:
app.example.com.    3600    IN    CNAME    green-lb.example.com.
green-lb.example.com.    60    IN    A    10.0.2.50

# Previous DNS (before deployment)
app.example.com.    3600    IN    CNAME    blue-lb.example.com.
blue-lb.example.com.    60    IN    A    10.0.1.50

# Note: TTL on CNAME is 3600 seconds (1 hour)
\`\`\``,
			hint: "Look at the TTL values for each record type...",
		},
		{
			id: 2,
			title: "User Debug Reports",
			type: "logs",
			content: `\`\`\`
User Report Analysis:
---------------------
User A (Web, Home WiFi):
  - Resolved IP: 10.0.2.50 (green) ✓
  - App Version: 2.5.1 (new) ✓

User B (Web, Corporate Network):
  - Resolved IP: 10.0.1.50 (blue) ✗
  - App Version: 2.5.0 (old) ✗
  - Corporate DNS Cache TTL: 4 hours

User C (Mobile App, Cellular):
  - Resolved IP: 10.0.1.50 (blue) ✗
  - App Version: 2.5.0 (old) ✗
  - Note: Mobile carrier DNS

User D (Web, Home WiFi, cleared cache):
  - Resolved IP: 10.0.2.50 (green) ✓
  - App Version: 2.5.1 (new) ✓
\`\`\``,
			hint: "What's different between the users who see new vs old versions?",
		},
		{
			id: 3,
			title: "DevOps Engineer Testimony",
			type: "testimony",
			content: `"Our blue-green deployment script is straightforward. We bring up green, run health checks, then update the DNS CNAME to point to green's load balancer. The DNS provider confirmed the change propagated within 5 minutes. We even checked with multiple DNS resolvers and they all show the new record. I don't understand why some users are still hitting blue."`,
		},
		{
			id: 4,
			title: "DNS Propagation Check",
			type: "metrics",
			content: `\`\`\`
Global DNS Propagation Status (2 hours post-deployment):
---------------------------------------------------------
Authoritative NS:     green-lb.example.com ✓
Google DNS (8.8.8.8): green-lb.example.com ✓
Cloudflare (1.1.1.1): green-lb.example.com ✓
OpenDNS:              green-lb.example.com ✓

But checking downstream resolvers:
----------------------------------
Comcast Residential:  green-lb.example.com ✓
AT&T Cellular:        blue-lb.example.com ✗ (cached)
Verizon Cellular:     blue-lb.example.com ✗ (cached)
Corporate Resolver A: blue-lb.example.com ✗ (cached)
Corporate Resolver B: green-lb.example.com ✓

Cache expiry estimate for stale resolvers: 1-4 hours remaining
\`\`\``,
			hint: "The major DNS servers have the new record, but some ISP/corporate resolvers don't...",
		},
		{
			id: 5,
			title: "Historical DNS TTL Settings",
			type: "config",
			content: `\`\`\`yaml
# dns-config.yaml (Route53)
records:
  - name: app.example.com
    type: CNAME
    ttl: 3600  # 1 hour - set months ago, never reviewed
    value: blue-lb.example.com  # or green-lb.example.com

  - name: blue-lb.example.com
    type: A
    ttl: 60  # 1 minute
    value: 10.0.1.50

  - name: green-lb.example.com
    type: A
    ttl: 60  # 1 minute
    value: 10.0.2.50

# Note: The CNAME has a much longer TTL than the A records
# Resolvers cache the CNAME for up to 1 hour
# Some resolvers cache LONGER than TTL (RFC violation but common)
\`\`\``,
			hint: "The CNAME record that switches between blue and green has a long TTL...",
		},
		{
			id: 6,
			title: "Blue Environment Access Logs",
			type: "logs",
			content: `\`\`\`
# Blue environment (should have no traffic after switch)
# access.log from 4:00 PM (2 hours after deployment)

10.45.23.xx - - [15/Jan/2024:16:00:01] "GET /api/users HTTP/1.1" 200
10.45.23.xx - - [15/Jan/2024:16:00:02] "POST /api/orders HTTP/1.1" 201
10.89.12.xx - - [15/Jan/2024:16:00:03] "GET /api/products HTTP/1.1" 200
10.45.23.xx - - [15/Jan/2024:16:00:05] "GET /api/users HTTP/1.1" 200
...

Request count last hour: 12,847
Unique IPs: 3,421
Top sources: Corporate IP ranges, Mobile carrier NAT pools

# This traffic should be going to Green, not Blue!
\`\`\``,
		},
	],

	solution: {
		diagnosis: "DNS TTL too high causing prolonged cache of old CNAME record",
		keywords: [
			"DNS TTL",
			"DNS propagation",
			"DNS cache",
			"blue-green",
			"CNAME",
			"TTL",
			"resolver cache",
			"DNS caching",
			"propagation delay",
		],
		rootCause: `The blue-green deployment switches traffic by updating a CNAME record from blue-lb to green-lb. However, the CNAME record has a TTL of 3600 seconds (1 hour). This means:

1. **Resolver caching**: DNS resolvers cache the CNAME record for up to 1 hour. Until their cache expires, they serve the old blue-lb address.

2. **Extended caching**: Some ISPs and corporate DNS servers cache records longer than the TTL (technically violating RFC but common practice for performance). Corporate resolvers often have 4+ hour caches.

3. **Mobile carriers**: Cellular carriers use aggressive DNS caching to reduce network traffic, often ignoring TTLs entirely.

4. **Chain effect**: The low TTL on A records (60s) doesn't help because resolvers are caching the CNAME which points to the wrong load balancer.

The deployment appears successful because authoritative nameservers and major public resolvers update quickly, but the long tail of ISP and corporate resolvers continue serving stale data.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Lower TTL before deployment (pre-deployment step)",
				code: `# Step 1: Days before deployment, lower TTL
# This allows existing caches to expire before the switch

records:
  - name: app.example.com
    type: CNAME
    ttl: 60  # Lower to 1 minute BEFORE deployment
    value: blue-lb.example.com

# Wait at least OLD_TTL (1 hour) before proceeding
# Then perform blue-green switch`,
			},
			{
				lang: "yaml",
				description: "Better approach: Use weighted routing instead of CNAME switch",
				code: `# Use Route53 weighted routing for gradual traffic shift
# This works at the DNS level without CNAME caching issues

records:
  - name: app.example.com
    type: A
    ttl: 60
    set_identifier: blue
    weight: 0  # After deployment: 0% to blue
    value: 10.0.1.50  # Blue LB IP
    health_check_id: blue-health-check

  - name: app.example.com
    type: A
    ttl: 60
    set_identifier: green
    weight: 100  # After deployment: 100% to green
    value: 10.0.2.50  # Green LB IP
    health_check_id: green-health-check`,
			},
			{
				lang: "typescript",
				description: "Best approach: Load balancer switching (no DNS changes)",
				code: `// Use a single DNS entry pointing to ALB/NLB
// Switch traffic at load balancer level - instant, no DNS propagation

// Terraform example
resource "aws_lb_listener_rule" "app" {
  listener_arn = aws_lb_listener.front_end.arn
  priority     = 100

  action {
    type = "forward"
    forward {
      target_group {
        // Blue-green switch happens here
        // Change weight, not DNS
        arn    = aws_lb_target_group.green.arn
        weight = 100
      }
      target_group {
        arn    = aws_lb_target_group.blue.arn
        weight = 0
      }
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}`,
			},
			{
				lang: "bash",
				description: "Pre-deployment TTL reduction script",
				code: `#!/bin/bash
# pre-deploy-dns.sh - Run 2+ hours before deployment

HOSTED_ZONE_ID="Z1234567890"
RECORD_NAME="app.example.com"
NEW_TTL=60

echo "Lowering TTL to $NEW_TTL seconds..."

aws route53 change-resource-record-sets \\
  --hosted-zone-id $HOSTED_ZONE_ID \\
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "'$RECORD_NAME'",
        "Type": "CNAME",
        "TTL": '$NEW_TTL',
        "ResourceRecords": [{"Value": "blue-lb.example.com"}]
      }
    }]
  }'

echo "TTL lowered. Wait at least 1 hour (old TTL) before deploying."
echo "This ensures all caches have the new lower TTL."`,
			},
		],
		prevention: [
			"Keep DNS TTLs low (60s) for any records that change during deployments",
			"Lower TTLs days before planned deployments, then restore after",
			"Use load balancer target group switching instead of DNS switching",
			"Implement health checks that can detect version mismatches",
			"Monitor traffic on both blue and green after switch to detect stragglers",
			"Consider keeping blue running (read-only) for cache expiry period",
			"Document that 'deployment complete' != 'all users migrated'",
		],
		educationalInsights: [
			"DNS TTL is a 'suggestion' - resolvers can cache longer",
			"Blue-green DNS switching has inherent propagation delays",
			"Mobile carriers and corporate proxies often ignore TTLs",
			"Load balancer switching is instantaneous; DNS switching is not",
			"The 'long tail' of DNS caching can take hours to fully resolve",
			"Always check both old and new environment traffic after switching",
		],
	},
};

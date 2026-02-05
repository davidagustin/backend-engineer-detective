import type { DetectiveCase } from "../../types";

export const bgpRouteLeak: DetectiveCase = {
	id: "bgp-route-leak",
	title: "The BGP Route Leak",
	subtitle: "Traffic blackholed due to BGP misconfiguration",
	difficulty: "principal",
	category: "networking",

	crisis: {
		description:
			"After a network change at a peering partner, a significant portion of traffic to our services is being blackholed. Users from certain ISPs cannot reach our servers at all. The issue is intermittent and affects different regions at different times. Our own network shows no problems.",
		impact:
			"Complete outage for 30% of users from affected ISPs. Traffic dropping into a black hole - no responses, no errors. Support tickets flooding in from specific geographic regions. Revenue loss estimated at $50K/hour.",
		timeline: [
			{ time: "6:00 AM UTC", event: "Partner ISP applies routine BGP config change", type: "normal" },
			{ time: "6:05 AM UTC", event: "BGP routes begin propagating globally", type: "normal" },
			{ time: "6:15 AM UTC", event: "First reports of connectivity issues from EU users", type: "warning" },
			{ time: "7:00 AM UTC", event: "30% packet loss identified for certain source ASNs", type: "critical" },
			{ time: "8:00 AM UTC", event: "Complete blackhole identified for traffic via AS64500", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Direct connections from our data center work",
			"Users from some ISPs connect fine",
			"Internal monitoring shows servers healthy",
			"BGP sessions with direct peers are established",
			"Traceroutes from our network succeed",
		],
		broken: [
			"Users from specific ISPs cannot connect at all",
			"No response received - connection timeout",
			"Traceroutes from affected ISPs die at certain hop",
			"Problem affects users regardless of their distance",
		],
	},

	clues: [
		{
			id: 1,
			title: "Traceroute from Affected User",
			type: "logs",
			content: `\`\`\`
$ traceroute api.example.com
traceroute to api.example.com (203.0.113.50), 30 hops max
 1  192.168.1.1 (192.168.1.1)  1.234 ms
 2  isp-gw.megaisp.net (198.51.100.1)  15.432 ms
 3  core1.megaisp.net (198.51.100.5)  18.234 ms
 4  peering.transit-as64500.net (192.0.2.1)  22.456 ms
 5  * * *
 6  * * *
 7  * * *
...
30  * * *

# Traceroute dies at hop 4, which is AS64500
# AS64500 is a transit provider, not our network
\`\`\``,
			hint: "Traffic enters AS64500 and never comes out...",
		},
		{
			id: 2,
			title: "BGP Looking Glass Query",
			type: "logs",
			content: `\`\`\`
# Query: What's the route to 203.0.113.0/24 (our IP block)?

From AS64500 (transit provider):
BGP routing table entry for 203.0.113.0/24
Paths: (2 available, best #1)
  Path 1 (BEST): AS65001 (our ASN)
    Next hop: 192.0.2.50
    Origin: IGP
    Local preference: 100

  Path 2: AS65001
    Next hop: 192.0.2.51
    Origin: IGP
    Local preference: 100

From AS64496 (another transit):
BGP routing table entry for 203.0.113.0/24
Paths: (1 available, best #1)
  Path 1 (BEST): AS64500 AS65001  # Via AS64500!
    Next hop: 10.0.0.1
    Origin: IGP
    AS Path: 64500 65001

# Wait - why is AS64500 announcing OUR prefix to other ASNs?
\`\`\``,
			hint: "AS64500 is re-announcing our prefix to other networks...",
		},
		{
			id: 3,
			title: "Our BGP Configuration",
			type: "config",
			content: `\`\`\`
router bgp 65001
  neighbor 192.0.2.1 remote-as 64500
  neighbor 192.0.2.1 description "Transit Provider A"

  # We announce our prefix to transit
  network 203.0.113.0/24

  # Standard prefix-list for announcements
  ip prefix-list OUR-NETS permit 203.0.113.0/24

  route-map TRANSIT-OUT permit 10
    match ip address prefix-list OUR-NETS
    set community 64500:100

  neighbor 192.0.2.1 route-map TRANSIT-OUT out

  # We receive full table from transit
  neighbor 192.0.2.1 route-map TRANSIT-IN in

  # NO OUTBOUND FILTERING for what transit sends us
  # We trust our transit provider completely
\`\`\``,
			hint: "We announce to transit, but do we control what they do with it?",
		},
		{
			id: 4,
			title: "AS64500 BGP Change Log",
			type: "logs",
			content: `\`\`\`
# AS64500 (transit provider) change log - 6:00 AM UTC

Ticket: NET-2024-1234
Description: Update route policy for new customer AS64501
Changes applied:
  - Added peering session with AS64501
  - Modified export policy: "permit any" for quick deployment
  - TODO: Add proper prefix filtering (scheduled for next window)

# Before change:
route-map CUSTOMER-OUT permit 10
  match community CUSTOMER-ROUTES

# After change (PROBLEMATIC):
route-map CUSTOMER-OUT permit 10
  # Temporarily permit all while we set up proper filters
  # match community CUSTOMER-ROUTES  <- COMMENTED OUT
\`\`\``,
			hint: "The transit provider is now exporting ALL routes, not just their own...",
		},
		{
			id: 5,
			title: "Network Engineer Testimony",
			type: "testimony",
			content: `"AS64500 is our transit provider. We pay them to announce our routes to the internet. Normally they only re-announce our routes to their direct customers and peers, with proper AS path. But their change this morning accidentally started announcing our routes to everyone, including paths that don't make sense. Some networks now think the best path to us is through AS64500's new customer, which doesn't actually have a valid path to us."`,
		},
		{
			id: 6,
			title: "Global BGP Route Analysis",
			type: "metrics",
			content: `\`\`\`
RIPE RIS BGP Data for 203.0.113.0/24:

Valid paths (as expected):
  AS65001 (direct)                     - 45% of internet
  AS64500 AS65001 (via transit)        - 30% of internet

Anomalous paths (route leak):
  AS64501 AS64500 AS65001              - 15% of internet
  AS64502 AS64501 AS64500 AS65001      - 8% of internet
  AS64503 AS64502 AS64501 AS64500 AS65001 - 2% of internet

# AS64501 has no valid path to AS65001!
# Traffic following these paths enters AS64501 and is dropped
# (AS64501 sends it to AS64500, which loops back or drops)

Affected visibility:
  - Users via MegaISP: BLACKHOLED
  - Users via RegionalNet: BLACKHOLED
  - Users via BigTelco: OK (uses direct path)
\`\`\``,
			hint: "Traffic following the leaked routes has nowhere to go...",
		},
	],

	solution: {
		diagnosis: "Transit provider accidentally re-announced our routes to networks without valid return path",
		keywords: [
			"bgp",
			"route leak",
			"bgp hijack",
			"as path",
			"blackhole",
			"transit provider",
			"prefix filtering",
			"rpki",
			"route origin",
		],
		rootCause: `AS64500 (our transit provider) made a configuration change that accidentally removed prefix filtering on their export policy. This caused them to re-announce our routes (203.0.113.0/24) to networks that don't have a valid path back to us.

The route leak created the following problem:
1. AS64500 properly receives our routes via direct peering
2. Due to misconfiguration, AS64500 announces our routes to AS64501 (new customer)
3. AS64501 has no actual connectivity to us, but announces the route to their peers
4. Other networks (AS64502, AS64503, etc.) see this path and think it's valid
5. They send traffic for our IPs toward AS64501
6. AS64501 either drops the traffic or sends it back to AS64500, creating a loop/blackhole

This is a classic BGP route leak scenario. The internet's routing security relies heavily on operators properly filtering what they announce. Without RPKI and ROA validation, networks accept any route announcement as potentially valid.`,
		codeExamples: [
			{
				lang: "cisco",
				description: "Transit provider fix: Proper export filtering",
				code: `! AS64500 corrected configuration

! Define what prefixes we're authorized to announce from each customer
ip prefix-list CUST-65001-PREFIXES permit 203.0.113.0/24

! Community to mark customer routes
ip community-list standard CUSTOMER-65001 permit 64500:65001

! Route map for exports - STRICT filtering
route-map CUSTOMER-OUT permit 10
  match ip address prefix-list CUST-65001-PREFIXES
  match community CUSTOMER-65001

route-map CUSTOMER-OUT deny 100
  ! Deny everything else

! Apply to all customer/peer sessions
neighbor 10.0.0.1 route-map CUSTOMER-OUT out`,
			},
			{
				lang: "bash",
				description: "Our network: Implement RPKI and ROA",
				code: `# Create Route Origin Authorization (ROA) in your RIR portal
# This cryptographically signs that AS65001 is authorized to announce 203.0.113.0/24

# ROA Record:
# Prefix: 203.0.113.0/24
# Origin AS: 65001
# Max Length: 24

# On our routers, enable RPKI validation
router bgp 65001
  # Configure RPKI cache server
  rpki cache 192.168.1.100
    transport tcp port 8282
    refresh-time 300

  # Apply RPKI validation to received routes
  route-map TRANSIT-IN permit 10
    match rpki valid
    set local-preference 200

  route-map TRANSIT-IN permit 20
    match rpki not-found
    set local-preference 100

  route-map TRANSIT-IN deny 30
    match rpki invalid
    ! Drop routes with invalid RPKI

# This helps, but doesn't prevent others from accepting leaked routes
# RPKI adoption must be widespread to be fully effective`,
			},
			{
				lang: "python",
				description: "Monitoring: Detect BGP anomalies",
				code: `# Monitor for unexpected AS paths to our prefixes
import requests
from datetime import datetime, timedelta

def check_bgp_paths(prefix: str, expected_origin: int) -> list:
    """Query RIPE RIS for current paths to our prefix."""
    url = f"https://stat.ripe.net/data/looking-glass/data.json?resource={prefix}"
    response = requests.get(url)
    data = response.json()

    anomalies = []
    for peer in data['data']['rrcs']:
        for entry in peer.get('entries', []):
            as_path = entry.get('as_path', '').split()
            origin_as = int(as_path[-1]) if as_path else None

            if origin_as != expected_origin:
                anomalies.append({
                    'peer': peer['rrc'],
                    'as_path': as_path,
                    'origin': origin_as,
                    'expected': expected_origin,
                    'type': 'origin_mismatch'
                })

            # Check for unusually long paths (possible leak)
            if len(as_path) > 6:
                anomalies.append({
                    'peer': peer['rrc'],
                    'as_path': as_path,
                    'type': 'long_path'
                })

    return anomalies

# Run check
anomalies = check_bgp_paths('203.0.113.0/24', expected_origin=65001)
if anomalies:
    send_alert(f"BGP anomalies detected: {anomalies}")`,
			},
		],
		prevention: [
			"Implement RPKI/ROA to cryptographically sign route origins",
			"Require transit providers to maintain strict prefix filtering",
			"Monitor BGP from multiple vantage points (RIPE RIS, RouteViews)",
			"Set up alerts for unexpected AS paths to your prefixes",
			"Maintain accurate IRR records (RADB, etc.) for your prefixes",
			"Include BGP security requirements in transit provider contracts",
		],
		educationalInsights: [
			"BGP operates on trust - any AS can announce any prefix without validation",
			"Route leaks differ from hijacks: leaks propagate valid routes through invalid paths",
			"RPKI adoption is growing but not universal - many networks don't validate",
			"A route leak by one network can affect global traffic patterns",
			"Traffic engineering via BGP communities doesn't prevent third-party leaks",
			"BGP convergence after a leak fix can take minutes to hours globally",
		],
	},
};

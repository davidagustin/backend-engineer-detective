import type { DetectiveCase } from "../../types";

export const cockroachdbClockSkew: DetectiveCase = {
	id: "cockroachdb-clock-skew",
	title: "The CockroachDB Clock Crisis",
	subtitle: "Transactions fail mysteriously across a distributed cluster",
	difficulty: "principal",
	category: "distributed",

	crisis: {
		description: `
			Your CockroachDB cluster spanning three data centers has started rejecting
			transactions with "uncertainty interval" errors. The errors are sporadic
			but increasing. All nodes appear healthy, network latency is normal, but
			transactions that worked yesterday are now failing randomly.
		`,
		impact: `
			Transaction failure rate at 15% and climbing. Critical financial transactions
			failing. Multi-region writes completely broken. Data consistency at risk.
		`,
		timeline: [
			{ time: "Day 1", event: "NTP server maintenance in DC-West", type: "normal" },
			{ time: "Day 2 AM", event: "First uncertainty errors in logs", type: "warning" },
			{ time: "Day 2 PM", event: "Error rate reaches 5%", type: "warning" },
			{ time: "Day 3", event: "DC-West nodes showing clock warnings", type: "critical" },
			{ time: "Day 4", event: "Transaction failures at 15%", type: "critical" },
			{ time: "Day 4", event: "CockroachDB nodes refusing to communicate", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Single-node transactions succeed",
			"Reads from individual nodes work",
			"Admin UI accessible on all nodes",
			"Network connectivity verified between all DCs",
			"CPU, memory, disk all normal",
		],
		broken: [
			"Multi-node transactions failing with uncertainty errors",
			"WriteTooOld errors appearing sporadically",
			"Some nodes being excluded from consensus",
			"Cross-DC writes timing out",
			"Raft leadership changes happening frequently",
		],
	},

	clues: [
		{
			id: 1,
			title: "CockroachDB Error Logs",
			type: "logs",
			content: `\`\`\`
E230415 14:23:45.123456 [n3] kv/kvserver/replica_write.go:345
  txn 7f3d2b1a: restart due to possible uncertainty;
  uncertainty interval [1681567425.123456789,0, 1681567425.623456789,0]
  clock skew detected between nodes

E230415 14:23:46.234567 [n5] kv/kvserver/replica_write.go:401
  WriteTooOldError: write at timestamp 1681567426.100000000,0
  too old; wrote at 1681567426.500000000,1

W230415 14:23:47.345678 [n3] server/status/runtime.go:123
  clock offset from n7: 487ms (max allowed: 500ms)

E230415 14:23:48.456789 [n7] server/status/runtime.go:130
  clock synchronization error: offset 523ms exceeds maximum (500ms)
  this node will be excluded from consensus
\`\`\``,
			hint: "Notice the clock offset values approaching and exceeding limits...",
		},
		{
			id: 2,
			title: "Node Clock Comparison",
			type: "metrics",
			content: `\`\`\`sql
-- Query: SELECT node_id, clock_offset_ns/1e6 as offset_ms FROM crdb_internal.kv_node_status

 node_id | offset_ms | datacenter
---------+-----------+------------
       1 |      12.3 | DC-East
       2 |      15.7 | DC-East
       3 |      18.2 | DC-East
       4 |      23.1 | DC-Central
       5 |      19.8 | DC-Central
       6 |      25.4 | DC-Central
       7 |     487.2 | DC-West      <- Problem!
       8 |     492.1 | DC-West      <- Problem!
       9 |     478.9 | DC-West      <- Problem!

-- Note: Max clock offset configured as 500ms
-- DC-West nodes are dangerously close to the threshold
\`\`\``,
			hint: "DC-West nodes have much higher clock offsets...",
		},
		{
			id: 3,
			title: "Hybrid Logical Clock Architecture",
			type: "config",
			content: `\`\`\`
CockroachDB's Hybrid Logical Clock (HLC):
=========================================

CockroachDB uses HLC for transaction ordering:
- Physical component: wall clock time
- Logical component: counter for same-millisecond ordering

Transaction timestamp assignment:
1. Transaction starts with timestamp T_start
2. Reads must see all writes with T <= T_start
3. Writes must have T > any conflicting read
4. Cross-node operations must account for clock uncertainty

The Uncertainty Window:
- Can't know exact time on remote nodes
- Assume remote clock could be up to 'max_offset' ahead
- Read uncertainty interval: [T_start, T_start + max_offset]
- Must restart transaction if uncertain values detected

If clocks drift beyond max_offset:
- Transactions can't determine causal ordering
- Nodes get excluded from consensus
- Cluster loses consistency guarantees
\`\`\``,
			hint: "Clock uncertainty directly impacts transaction correctness...",
		},
		{
			id: 4,
			title: "NTP Status on Nodes",
			type: "logs",
			content: `\`\`\`bash
# DC-East node (healthy)
$ chronyc tracking
Reference ID    : 169.254.169.123 (AWS NTP)
Stratum         : 3
Ref time (UTC)  : Sat Apr 15 14:23:45 2023
System time     : 0.000012 seconds fast of NTP time
Last offset     : +0.000008 seconds

# DC-West node (problematic)
$ chronyc tracking
Reference ID    : 00000000 ()
Stratum         : 0
Ref time (UTC)  : Thu Jan 01 00:00:00 1970
System time     : 0.487234 seconds fast of NTP time
Last offset     : +0.023145 seconds

$ chronyc sources
210 Number of sources = 0
MS Name/IP address         Stratum Poll Reach LastRx Last sample
==========================================================================
(No sources configured)
\`\`\``,
			hint: "DC-West has no NTP sources configured...",
		},
		{
			id: 5,
			title: "Platform Engineer Testimony",
			type: "testimony",
			content: `"Last week we did maintenance on the NTP infrastructure in DC-West.
We decommissioned the old NTP servers but... I think someone forgot
to update the chrony config on the CockroachDB nodes to point to
the new NTP pool.

The nodes have been running on their hardware clocks for 4 days.
Hardware clocks drift naturally - typically 10-20 seconds per day.
After 4 days, they're almost 500ms off from the other datacenters.

CockroachDB is configured with max_clock_offset=500ms. Once any
node exceeds this, it gets kicked out of consensus because the
cluster can't guarantee transaction ordering anymore."`,
		},
		{
			id: 6,
			title: "Transaction Retry Metrics",
			type: "metrics",
			content: `\`\`\`sql
-- Transaction retry reasons (last hour)
SELECT
    message,
    count(*) as occurrences
FROM system.eventlog
WHERE timestamp > now() - interval '1 hour'
AND event_type = 'txn_restart'
GROUP BY message
ORDER BY count DESC;

              message                   | occurrences
----------------------------------------+-------------
 ReadWithinUncertaintyIntervalError     |       12,847
 WriteTooOldError                       |        8,234
 TransactionRetryError (clock skew)     |        5,123
 TransactionAbortedError (node offline) |        2,456

-- Note: 28K+ transaction retries in 1 hour
-- Normal baseline: ~500/hour
\`\`\``,
			hint: "ReadWithinUncertaintyIntervalError is the smoking gun...",
		},
	],

	solution: {
		diagnosis: "NTP failure caused clock drift exceeding max_clock_offset threshold",

		keywords: [
			"clock skew",
			"NTP",
			"clock drift",
			"uncertainty",
			"HLC",
			"hybrid logical clock",
			"max_clock_offset",
			"clock synchronization",
			"distributed transactions",
		],

		rootCause: `
			CockroachDB relies on synchronized clocks across all nodes to order
			distributed transactions correctly. It uses a Hybrid Logical Clock (HLC)
			that combines wall clock time with a logical counter.

			The failure sequence:
			1. NTP maintenance removed DC-West's time synchronization sources
			2. Nodes began relying on unsynchronized hardware clocks
			3. Hardware clocks drift ~10-20 seconds per day
			4. After 4 days, DC-West clocks were ~480ms ahead of other DCs
			5. This approached the max_clock_offset limit (500ms)

			Impact on transactions:
			- Transactions starting on DC-East/Central see "future" timestamps from DC-West
			- The uncertainty window [T_start, T_start + 500ms] becomes critical
			- Reads can't determine if DC-West values were written "before" or "after"
			- CockroachDB must restart transactions to ensure correctness
			- Once offset exceeds 500ms, nodes are excluded entirely

			This is a fundamental distributed systems problem: you cannot have both
			linearizable transactions AND tolerant of arbitrary clock drift. CockroachDB
			chose linearizability with bounded clock tolerance.
		`,

		codeExamples: [
			{
				lang: "bash",
				description: "Fix: Restore NTP synchronization on affected nodes",
				code: `# On each DC-West CockroachDB node:

# 1. Configure chrony with multiple NTP sources
cat > /etc/chrony/chrony.conf << 'EOF'
# Primary NTP sources (use your actual NTP servers)
server ntp1.dc-west.internal iburst
server ntp2.dc-west.internal iburst
server time.google.com iburst
server time.aws.com iburst

# Allow larger initial correction (one-time)
makestep 1.0 3

# Maximum allowed clock drift rate
maxdrift 100

# Log measurements
log measurements statistics tracking
EOF

# 2. Restart chrony
systemctl restart chronyd

# 3. Force immediate sync (may cause brief disruption)
chronyc makestep

# 4. Verify synchronization
chronyc tracking
chronyc sources -v

# 5. Check offset is within CockroachDB limits
chronyc sourcestats`,
			},
			{
				lang: "bash",
				description: "CockroachDB clock monitoring commands",
				code: `# Check clock offset on all nodes from Admin UI API
cockroach node status --host=localhost:26257 --insecure | \\
    awk 'NR>1 {print $1, $NF}'

# Query internal clock status
cockroach sql --host=localhost:26257 --insecure -e "
    SELECT
        node_id,
        address,
        clock_offset_ns / 1000000 as offset_ms,
        CASE
            WHEN abs(clock_offset_ns) > 400000000 THEN 'CRITICAL'
            WHEN abs(clock_offset_ns) > 250000000 THEN 'WARNING'
            ELSE 'OK'
        END as status
    FROM crdb_internal.kv_node_status
    ORDER BY abs(clock_offset_ns) DESC;
"

# Check for clock-related transaction retries
cockroach sql --host=localhost:26257 --insecure -e "
    SELECT
        txn_restart_count,
        clock_sync_errors
    FROM crdb_internal.node_metrics
    WHERE name LIKE '%clock%' OR name LIKE '%txn_restart%';
"`,
			},
			{
				lang: "yaml",
				description: "Terraform/Ansible NTP configuration for consistency",
				code: `# Ansible task to ensure consistent NTP across CockroachDB nodes
---
- name: Configure NTP for CockroachDB cluster
  hosts: cockroachdb_nodes
  become: yes
  tasks:
    - name: Install chrony
      package:
        name: chrony
        state: present

    - name: Configure chrony
      template:
        src: chrony.conf.j2
        dest: /etc/chrony/chrony.conf
      notify: restart chrony

    - name: Enable and start chrony
      service:
        name: chronyd
        state: started
        enabled: yes

    - name: Wait for clock sync
      command: chronyc waitsync 30 0.1
      register: sync_result
      retries: 3
      delay: 10
      until: sync_result.rc == 0

    - name: Alert on clock drift > 100ms
      assert:
        that:
          - chrony_offset_ms | float < 100
        fail_msg: "Clock offset {{ chrony_offset_ms }}ms exceeds threshold"

  handlers:
    - name: restart chrony
      service:
        name: chronyd
        state: restarted`,
			},
		],

		prevention: [
			"Configure multiple redundant NTP sources on all database nodes",
			"Monitor clock offset metrics and alert at 50% of max_offset",
			"Use managed NTP services (AWS Time Sync, Google Public NTP)",
			"Include NTP health in infrastructure monitoring dashboards",
			"Document NTP dependencies in runbooks and change management",
			"Test clock skew scenarios in chaos engineering exercises",
		],

		educationalInsights: [
			"Distributed databases fundamentally depend on synchronized time",
			"HLC combines wall clocks with logical counters for causality",
			"Uncertainty intervals are the cost of not having perfectly synchronized clocks",
			"Hardware clocks drift 10-100ppm (10-100 microseconds per second)",
			"max_clock_offset is a tradeoff: larger = more tolerance, longer uncertainty windows",
			"Spanner uses atomic clocks and GPS; CockroachDB uses NTP with bounded uncertainty",
			"Clock skew causes linearizability violations if not bounded",
		],
	},
};

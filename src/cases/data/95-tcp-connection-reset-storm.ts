import type { DetectiveCase } from "../../types";

export const tcpConnectionResetStorm: DetectiveCase = {
	id: "tcp-connection-reset-storm",
	title: "The TCP Connection Reset Storm",
	subtitle: "RST packets flooding the network from misconfigured keep-alive",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"Clients are experiencing sudden connection drops with 'Connection reset by peer' errors. The issue appears random but is affecting a significant portion of long-lived connections. Network monitoring shows an abnormal spike in TCP RST packets.",
		impact:
			"30% of WebSocket connections dropping unexpectedly. Long-running API requests failing mid-stream. Real-time data feeds disconnecting users. Customer trust eroding due to unreliable connections.",
		timeline: [
			{ time: "9:00 AM", event: "Cloud provider performs network maintenance", type: "normal" },
			{ time: "9:30 AM", event: "First reports of connection resets", type: "warning" },
			{ time: "10:00 AM", event: "RST packet rate 10x normal baseline", type: "warning" },
			{ time: "10:30 AM", event: "WebSocket disconnection rate reaches 30%", type: "critical" },
			{ time: "11:00 AM", event: "Real-time trading platform users reporting data gaps", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"New connections establish successfully",
			"Short-lived HTTP requests work fine",
			"Health checks passing",
			"No errors in application logs",
			"Server-side connections appear healthy",
		],
		broken: [
			"Long-lived connections reset after ~60 seconds of idle",
			"WebSocket connections drop without warning",
			"Large file downloads fail mid-transfer",
			"Streaming connections randomly disconnect",
		],
	},

	clues: [
		{
			id: 1,
			title: "Client-Side Error Logs",
			type: "logs",
			content: `\`\`\`
[ERROR] WebSocketClient: Connection closed unexpectedly
  Error: read ECONNRESET
  Code: ECONNRESET
  Connection age: 67s
  Last message received: 62s ago

[ERROR] StreamingClient: Stream terminated
  Error: Connection reset by peer
  Bytes received before reset: 1,847,293
  Connection duration: 71s

[ERROR] LongPollClient: Request failed
  Error: socket hang up
  Request duration: 65s
\`\`\``,
			hint: "Notice the connection ages when resets occur...",
		},
		{
			id: 2,
			title: "Network Packet Capture",
			type: "logs",
			content: `\`\`\`
# tcpdump showing RST packets
09:47:23.847293 IP 10.0.1.50.443 > 192.168.1.100.52847: Flags [R], seq 0, ack 0
09:47:23.847301 IP 10.0.1.50.443 > 192.168.1.105.48291: Flags [R], seq 0, ack 0
09:47:24.012847 IP 10.0.1.50.443 > 192.168.1.112.51023: Flags [R], seq 0, ack 0
09:47:24.123456 IP 10.0.1.50.443 > 192.168.1.98.49872: Flags [R], seq 0, ack 0

# RST packets originating from load balancer IP (10.0.1.50)
# Pattern: connections idle for ~60s receive RST

# Connection state before RST:
Client -> Server: [ACK] (keepalive probe) seq=1847293
# No response from server
# 10 seconds later:
Server -> Client: [RST]
\`\`\``,
			hint: "Where are the RST packets originating from?",
		},
		{
			id: 3,
			title: "Load Balancer Configuration",
			type: "config",
			content: `\`\`\`yaml
# AWS Network Load Balancer settings
Type: network
Scheme: internet-facing

TargetGroups:
  - Name: app-servers
    Protocol: TCP
    Port: 443
    HealthCheckProtocol: TCP
    HealthCheckPort: 443
    IdleTimeout: 350  # 350 seconds - default NLB value

# Note: Configuration was unchanged during maintenance window
\`\`\``,
			hint: "The NLB config looks fine, but something changed...",
		},
		{
			id: 4,
			title: "AWS Firewall Rules (Post-Maintenance)",
			type: "config",
			content: `\`\`\`
# Security Group / Network ACL settings
# Updated during 9:00 AM maintenance window

Inbound Rules:
  - Protocol: TCP, Port: 443, Source: 0.0.0.0/0, Action: ALLOW

Connection Tracking:
  Mode: STRICT
  Timeout: 60s  # ← Changed from 350s during "security hardening"

# "Security hardening" applied new connection tracking timeout
# to match PCI-DSS recommendation for "short-lived connections"
\`\`\``,
			hint: "Compare this timeout to when connections are being reset...",
		},
		{
			id: 5,
			title: "Server TCP Keep-Alive Settings",
			type: "config",
			content: `\`\`\`bash
# Server sysctl settings
$ sysctl net.ipv4.tcp_keepalive_time
net.ipv4.tcp_keepalive_time = 7200  # 2 hours before first probe

$ sysctl net.ipv4.tcp_keepalive_intvl
net.ipv4.tcp_keepalive_intvl = 75   # 75 seconds between probes

$ sysctl net.ipv4.tcp_keepalive_probes
net.ipv4.tcp_keepalive_probes = 9   # 9 probes before giving up

# Total time before server detects dead connection:
# 7200 + (75 * 9) = 7875 seconds = ~2.2 hours
\`\`\``,
			hint: "Server waits 2 hours to send keep-alive, but connection tracking times out at 60s...",
		},
		{
			id: 6,
			title: "Infrastructure Team Testimony",
			type: "testimony",
			content: `"We did a security audit last week and the consultant recommended reducing connection tracking timeouts for PCI compliance. We applied the changes during this morning's maintenance window. The change was supposed to be low-risk since it only affects 'idle' connections. We didn't realize it would impact WebSockets since they're always 'active' from the application perspective."`,
		},
	],

	solution: {
		diagnosis: "Firewall connection tracking timeout shorter than application keep-alive interval",
		keywords: [
			"connection reset",
			"RST",
			"ECONNRESET",
			"tcp keepalive",
			"connection tracking",
			"idle timeout",
			"firewall timeout",
			"conntrack",
		],
		rootCause: `The firewall's connection tracking timeout was reduced to 60 seconds during a security hardening exercise. However, the server's TCP keep-alive is configured to send probes only after 2 hours of inactivity.

For connections with no data flowing (but logically "active" from the application's perspective, like idle WebSockets), the following happens:

1. Connection established, data flows
2. Connection becomes idle (no packets for 60+ seconds)
3. Firewall drops connection from tracking table (60s timeout)
4. Client or server sends data/keep-alive
5. Firewall sees packet for unknown connection
6. Firewall sends RST to both endpoints

The mismatch between firewall timeout (60s) and TCP keep-alive (7200s) creates a window where the connection appears valid to both endpoints but is unknown to the firewall. Any packet during this window triggers an RST.`,
		codeExamples: [
			{
				lang: "bash",
				description: "Fix server TCP keep-alive to be shorter than firewall timeout",
				code: `# Set TCP keep-alive to 30 seconds (well under 60s firewall timeout)
sysctl -w net.ipv4.tcp_keepalive_time=30
sysctl -w net.ipv4.tcp_keepalive_intvl=10
sysctl -w net.ipv4.tcp_keepalive_probes=3

# Make persistent in /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_time=30" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_intvl=10" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_probes=3" >> /etc/sysctl.conf`,
			},
			{
				lang: "typescript",
				description: "Application-level keep-alive for WebSockets",
				code: `// Server-side WebSocket with ping/pong keep-alive
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const KEEPALIVE_INTERVAL = 30000; // 30 seconds - under firewall timeout

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Ping all clients every 30 seconds
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(); // Sends ping frame, expects pong response
  });
}, KEEPALIVE_INTERVAL);

wss.on('close', () => {
  clearInterval(interval);
});`,
			},
			{
				lang: "yaml",
				description: "Fix firewall to have appropriate timeout",
				code: `# Increase connection tracking timeout for long-lived connections
# Option 1: Global increase (if appropriate for security posture)
Connection Tracking:
  Mode: STRICT
  Timeout: 350s  # Restored to match NLB timeout

# Option 2: Protocol-specific timeout (better)
Connection Tracking:
  Mode: STRICT
  Timeouts:
    TCP_ESTABLISHED: 350s  # For established connections
    TCP_SYN_SENT: 30s      # For connection setup
    TCP_FIN_WAIT: 30s      # For connection teardown

# Option 3: If using iptables directly
# iptables -t raw -A PREROUTING -p tcp --dport 443 -j CT --timeout 350`,
			},
		],
		prevention: [
			"Document all timeout values across the network path (client, LB, firewall, server)",
			"Ensure TCP keep-alive interval < firewall tracking timeout",
			"Use application-level keep-alive for WebSocket and streaming connections",
			"Test connection stability before and after network changes",
			"Include network team in changes affecting long-lived connections",
		],
		educationalInsights: [
			"Firewalls track connections by 5-tuple; when tracking expires, the connection is 'forgotten'",
			"TCP keep-alive is not the same as application-level ping/pong",
			"A connection can be valid at endpoints but unknown to middleboxes",
			"PCI-DSS timeout recommendations assume short-lived HTTP, not WebSockets",
			"RST packets from middleboxes are a common cause of mysterious connection drops",
			"Always consider the entire network path when debugging connection issues",
		],
	},
};

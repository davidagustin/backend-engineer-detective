import type { DetectiveCase } from "../../types";

export const mtuPathDiscoveryFailure: DetectiveCase = {
	id: "mtu-path-discovery-failure",
	title: "The MTU Path Discovery Failure",
	subtitle: "Large packets dropped due to PMTUD blocked",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"Users are experiencing bizarre issues where small requests work fine but large responses fail. File downloads start but hang at random points. Some API responses work while others timeout. The pattern seems random until you notice it correlates with response size.",
		impact:
			"File uploads over 1KB failing silently. Large API responses timing out. PDF downloads hanging mid-transfer. VPN users completely unable to use the service.",
		timeline: [
			{ time: "Monday", event: "New firewall deployed in production", type: "normal" },
			{ time: "Tuesday", event: "Reports of 'random' download failures", type: "warning" },
			{ time: "Wednesday", event: "Pattern identified: large transfers fail, small succeed", type: "warning" },
			{ time: "Thursday", event: "VPN users reporting complete outage", type: "critical" },
			{ time: "Friday", event: "File upload feature completely broken", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Ping works fine",
			"Small HTTP requests succeed",
			"DNS lookups work",
			"Health checks passing",
			"API calls with small payloads work",
		],
		broken: [
			"Large file downloads hang mid-transfer",
			"File uploads fail after ~1400 bytes",
			"VPN tunnels fail to establish",
			"Large API responses timeout",
			"SSH works but SCP/SFTP fails",
		],
	},

	clues: [
		{
			id: 1,
			title: "Transfer Failure Pattern",
			type: "logs",
			content: `\`\`\`bash
# Test downloads of different sizes
$ curl -o /dev/null https://api.example.com/test/1kb
  % Total    % Received
  100  1024  100  1024    0     0   5120      0 --:--:-- --:--:-- OK

$ curl -o /dev/null https://api.example.com/test/2kb
  % Total    % Received
   50  2048   50  1024    0     0   1024      0 --:--:--  0:00:30 TIMEOUT

$ curl -o /dev/null https://api.example.com/test/10kb
  % Total    % Received
   15 10240   15  1536    0     0    102      0 --:--:--  0:00:30 TIMEOUT

# Downloads work up to ~1400 bytes, then hang
\`\`\``,
			hint: "What happens around 1400 bytes that would cause this?",
		},
		{
			id: 2,
			title: "Packet Capture Analysis",
			type: "logs",
			content: `\`\`\`
# tcpdump during failed transfer

10:23:45.123 IP server.443 > client.52847: Flags [.], seq 1:1449, len 1448
10:23:45.124 IP server.443 > client.52847: Flags [.], seq 1449:2897, len 1448
10:23:45.125 IP server.443 > client.52847: Flags [.], seq 2897:4345, len 1448
# No acknowledgments received for above packets...

10:23:46.125 IP server.443 > client.52847: Flags [.], seq 1:1449, len 1448 [retransmit]
10:23:48.125 IP server.443 > client.52847: Flags [.], seq 1:1449, len 1448 [retransmit]
10:23:52.125 IP server.443 > client.52847: Flags [.], seq 1:1449, len 1448 [retransmit]

# Server keeps retransmitting, never gets ACK
# Packets with len=1448 are never acknowledged

# Meanwhile, small packets work:
10:24:15.789 IP server.443 > client.52847: Flags [.], seq 1:500, len 499
10:24:15.812 IP client.52847 > server.443: Flags [.], ack 500 [acknowledged!]
\`\`\``,
			hint: "Packets with length 1448 are lost, smaller packets work...",
		},
		{
			id: 3,
			title: "Network Path MTU Test",
			type: "logs",
			content: `\`\`\`bash
# Test MTU along the path
$ ping -M do -s 1472 api.example.com  # 1472 + 28 bytes header = 1500
PING api.example.com (203.0.113.50): 1472 data bytes
Request timeout for icmp_seq 0
Request timeout for icmp_seq 1

$ ping -M do -s 1372 api.example.com  # 1372 + 28 = 1400
PING api.example.com (203.0.113.50): 1372 data bytes
64 bytes from 203.0.113.50: icmp_seq=0 ttl=56 time=45.2 ms
64 bytes from 203.0.113.50: icmp_seq=1 ttl=56 time=44.8 ms

# Packets >1400 bytes don't make it through
# But we should be receiving ICMP "fragmentation needed" messages...

$ tcpdump -i eth0 icmp
# No ICMP messages observed!
\`\`\``,
			hint: "Large packets disappear but no ICMP fragmentation needed message arrives...",
		},
		{
			id: 4,
			title: "Firewall Configuration",
			type: "config",
			content: `\`\`\`
# New firewall rules (deployed Monday)

Chain INPUT (policy DROP)
  ACCEPT tcp dport 80
  ACCEPT tcp dport 443
  ACCEPT tcp dport 22
  ACCEPT related,established
  DROP all                    # Drop everything else

Chain OUTPUT (policy ACCEPT)
  ACCEPT all

# Note: ICMP section
Chain INPUT:
  # "Security hardening" - block ICMP to prevent ping floods
  DROP icmp                   # ← ALL ICMP BLOCKED!
\`\`\``,
			hint: "What ICMP messages are being blocked besides ping?",
		},
		{
			id: 5,
			title: "Network Path Analysis",
			type: "metrics",
			content: `\`\`\`
Network path to typical user:

[Client] ─── [ISP] ─── [Transit] ─── [VPN/Tunnel] ─── [Firewall] ─── [Server]
  MTU: 1500   MTU: 1500  MTU: 1500    MTU: 1400*      MTU: 1500     MTU: 1500

* VPN/Tunnel adds 100 bytes overhead, reducing effective MTU to 1400

Path MTU Discovery (PMTUD) process:
1. Server sends 1500-byte packet
2. VPN tunnel can't forward (too big)
3. VPN sends ICMP "Fragmentation Needed, MTU=1400"
4. Firewall DROPS the ICMP message!
5. Server never learns about smaller MTU
6. Server keeps retrying with 1500-byte packets
7. Packets keep getting dropped... forever
\`\`\``,
			hint: "The ICMP message that would tell the server to send smaller packets is blocked...",
		},
		{
			id: 6,
			title: "Security Engineer Testimony",
			type: "testimony",
			content: `"We deployed the new firewall with ICMP completely blocked as a security measure. Our security audit flagged ICMP as a potential attack vector for reconnaissance and ICMP flood attacks. The rule seemed low-risk since ping isn't critical for the application. We didn't realize ICMP was used for anything other than ping and traceroute."`,
		},
	],

	solution: {
		diagnosis: "ICMP blocked by firewall, preventing Path MTU Discovery from working",
		keywords: [
			"mtu",
			"pmtud",
			"path mtu discovery",
			"icmp blocked",
			"fragmentation needed",
			"packet too big",
			"mtu mismatch",
			"black hole",
		],
		rootCause: `The new firewall blocks ALL ICMP traffic, including the critical "ICMP Type 3, Code 4: Fragmentation Needed" messages. This breaks Path MTU Discovery (PMTUD).

When a packet is too large for a network link:
1. The router/device with smaller MTU drops the packet
2. It sends back ICMP "Fragmentation Needed" with the correct MTU
3. The sender reduces packet size and retries
4. This process discovers the minimum MTU along the entire path

When ICMP is blocked:
1. Large packets get dropped at the MTU bottleneck
2. The ICMP response is blocked by the firewall
3. The sender never learns about the smaller MTU
4. The sender keeps retransmitting at the same size
5. Packets are forever dropped - "PMTUD black hole"

This is especially common with VPNs, tunnels (GRE, IPsec), and PPPoE, which add headers and reduce effective MTU. The problem appears as "transfers work up to a point then hang" because small responses fit in a single packet under the MTU, while larger ones require multiple packets that exceed the MTU.`,
		codeExamples: [
			{
				lang: "bash",
				description: "Fix firewall to allow essential ICMP",
				code: `# Allow essential ICMP for network operation
iptables -A INPUT -p icmp --icmp-type destination-unreachable -j ACCEPT
iptables -A INPUT -p icmp --icmp-type time-exceeded -j ACCEPT
iptables -A INPUT -p icmp --icmp-type parameter-problem -j ACCEPT

# Specifically, fragmentation-needed (type 3, code 4) is critical
iptables -A INPUT -p icmp --icmp-type fragmentation-needed -j ACCEPT

# Optionally rate-limit ping if concerned about floods
iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s -j ACCEPT
iptables -A INPUT -p icmp --icmp-type echo-request -j DROP

# IPv6 equivalent (ICMPv6 is even more critical!)
ip6tables -A INPUT -p icmpv6 --icmpv6-type packet-too-big -j ACCEPT
ip6tables -A INPUT -p icmpv6 --icmpv6-type destination-unreachable -j ACCEPT`,
			},
			{
				lang: "bash",
				description: "Workaround: TCP MSS clamping",
				code: `# If you can't fix ICMP, clamp TCP MSS to work around PMTUD issues
# This tells TCP connections to use smaller segments

# On the firewall/router:
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
  -j TCPMSS --clamp-mss-to-pmtu

# Or set a specific MSS value (MTU - 40 for IPv4, MTU - 60 for IPv6)
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
  -j TCPMSS --set-mss 1360

# On Linux server directly:
sysctl -w net.ipv4.tcp_mtu_probing=1  # Enable PLPMTUD
sysctl -w net.ipv4.tcp_base_mss=1024  # Start with smaller MSS

# Make persistent
echo "net.ipv4.tcp_mtu_probing=1" >> /etc/sysctl.conf
echo "net.ipv4.tcp_base_mss=1024" >> /etc/sysctl.conf`,
			},
			{
				lang: "nginx",
				description: "Server-side workaround: Smaller buffers",
				code: `# If PMTUD is broken and you need a quick workaround,
# reduce buffer sizes to avoid large packets

http {
    # Reduce output buffer to avoid large packets
    postpone_output 1360;  # Flush after 1360 bytes

    # Smaller proxy buffers
    proxy_buffer_size 1k;
    proxy_buffers 4 1k;

    # For SSL/TLS, smaller record size
    ssl_buffer_size 4k;  # Default is 16k

    server {
        # Enable TCP_NODELAY to send smaller packets immediately
        tcp_nodelay on;
    }
}`,
			},
		],
		prevention: [
			"Never block all ICMP - allow essential types for network operation",
			"Test large file transfers after any firewall changes",
			"Enable TCP MSS clamping as defense in depth",
			"Document MTU requirements for VPN and tunnel users",
			"Monitor for PMTUD black holes with large packet tests",
			"Include ICMP policy in security review checklists",
		],
		educationalInsights: [
			"ICMP is not just for ping - it's critical for network operation",
			"PMTUD black holes are a common cause of 'random' connection issues",
			"VPNs, tunnels, and PPPoE reduce effective MTU due to encapsulation overhead",
			"IPv6 requires ICMPv6 - blocking it breaks the protocol entirely",
			"TCP MSS clamping is a common workaround but doesn't fix the root cause",
			"The pattern 'small transfers work, large fail' is a classic MTU symptom",
		],
	},
};

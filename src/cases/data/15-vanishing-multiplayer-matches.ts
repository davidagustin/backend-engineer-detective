import type { DetectiveCase } from "../../types";

export const vanishingMultiplayerMatches: DetectiveCase = {
	id: "vanishing-multiplayer-matches",
	title: "The Vanishing Multiplayer Matches",
	subtitle: "Players randomly disconnect from matches after 10-15 minutes",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"Players in long matches (15+ minutes) are getting disconnected. Short matches work fine. The disconnects happen randomly with no apparent trigger. Players see 'Connection Lost' without any preceding lag.",
		impact:
			"All long matches affected. Ranked games being invalidated. Players losing progress. Competitive integrity compromised.",
		timeline: [
			{ time: "Week 1", event: "New multiplayer mode with longer matches launched", type: "normal" },
			{ time: "Week 1 Day 3", event: "Reports of disconnects in long matches", type: "warning" },
			{ time: "Week 2", event: "Pattern confirmed: happens after 10-15 mins", type: "warning" },
			{ time: "Week 3", event: "All matches 15+ mins affected", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Short matches (under 10 min) work perfectly",
			"Initial connection always succeeds",
			"No lag or packet loss before disconnect",
			"Players can immediately reconnect and join new match",
		],
		broken: [
			"Matches break at ~10-15 minute mark",
			"All players in match disconnect simultaneously",
			"Game server remains healthy after disconnect",
			"No errors in game server logs",
		],
	},

	clues: [
		{
			id: 1,
			title: "Network Architecture",
			type: "config",
			content: `\`\`\`
Player Connection Path:

Player Device
    │
    ▼
[Home Router / NAT]
    │
    ▼
[ISP NAT / CGNAT]
    │
    ▼
[Cloud Load Balancer]
    │
    ▼
[Game Server (UDP)]

Connection Type: UDP
Protocol: Custom game protocol
Keepalive: Game packets serve as keepalive
\`\`\``,
		},
		{
			id: 2,
			title: "Load Balancer Configuration",
			type: "config",
			content: `\`\`\`yaml
# AWS Network Load Balancer Configuration
Type: Network (Layer 4)
Protocol: UDP
Target: Game server fleet

Connection Tracking:
  Idle Timeout: 120 seconds  # 2 minutes

Health Check:
  Protocol: TCP
  Port: 8080
  Interval: 30s
\`\`\``,
		},
		{
			id: 3,
			title: "Packet Capture Analysis",
			type: "logs",
			content: `\`\`\`
Connection timeline (Player A):

00:00 - Initial handshake (UDP)
00:01 - Game state sync (UDP, 60 packets/sec)
05:00 - Normal gameplay (UDP, 60 packets/sec)
10:00 - Normal gameplay (UDP, 60 packets/sec)

10:47 - Last packet from Player A
10:47 - Server sends packet to Player A
10:47 - NAT DROPS PACKET (no mapping exists!)

What happened at 10:47?
\`\`\``,
			hint: "Something about the NAT mapping changed...",
		},
		{
			id: 4,
			title: "NAT Behavior Research",
			type: "testimony",
			content: `"I've been researching NAT traversal. Apparently, NAT devices maintain a mapping table: (internal IP:port → external IP:port). For UDP, there's no connection state, so NATs use timeouts to clean up old mappings. The timeout varies by device: home routers are often 30-300 seconds. AWS NLB is 120 seconds by default."`,
		},
		{
			id: 5,
			title: "Game Protocol Analysis",
			type: "code",
			content: `\`\`\`typescript
class GameConnection {
  private readonly GAME_TICK_RATE = 60; // 60 updates per second

  async sendGameState(): Promise<void> {
    // Send game state to all players
    for (const player of this.players) {
      if (player.hasStateToSend()) {
        await this.socket.send(player.address, player.getState());
      }
    }
  }

  // Note: No explicit keepalive mechanism
  // Relies on game state packets to keep connection "alive"
}
\`\`\``,
		},
		{
			id: 6,
			title: "Player Activity Patterns",
			type: "metrics",
			content: `\`\`\`
Match type analysis:

Fast-paced modes (TDM, etc):
- Constant player movement
- Packets sent every frame
- No disconnects

Slow-paced modes (Strategy, Survival):
- Players can be stationary for minutes
- No game state changes = no packets
- Disconnects after 10-15 mins of low activity

AFK detection:
- Some players go AFK but stay connected
- AFK players stop sending input
- Server stops sending them updates
- Connection goes "idle"
\`\`\``,
		},
		{
			id: 7,
			title: "NAT Timeout Testing",
			type: "logs",
			content: `\`\`\`
Test: Send UDP packets with varying intervals

Packet interval: 30 seconds
Result: Connection maintained ✓

Packet interval: 60 seconds
Result: Connection maintained ✓

Packet interval: 90 seconds
Result: Connection maintained ✓

Packet interval: 120 seconds
Result: Connection maintained ✓

Packet interval: 180 seconds
Result: CONNECTION LOST ✗ (at ~150 seconds)

NAT mapping expires somewhere between 120-150 seconds
of inactivity. Without bidirectional traffic, the NAT
"forgets" the mapping.
\`\`\``,
		},
	],

	solution: {
		diagnosis: "UDP NAT mapping timeout - NAT tables expire connections after ~120 seconds of inactivity, dropping the player",
		keywords: [
			"nat timeout",
			"nat mapping",
			"udp keepalive",
			"connection timeout",
			"stateless",
			"nat table",
			"nat traversal",
		],
		rootCause: `UDP is connectionless - there's no "session" at the protocol level. NAT devices track UDP "connections" by maintaining a mapping table: (internal IP:port ↔ external IP:port).

These mappings have a timeout (typically 30-300 seconds). When no packets flow for that duration, the NAT device removes the mapping to save resources.

In the game:
1. Active players generate packets constantly → NAT mapping stays fresh
2. Inactive/AFK players or players in slow-paced modes may not generate packets
3. If no packets for ~120 seconds, NAT mapping expires
4. When game server sends next packet, NAT has no mapping → packet dropped
5. Player sees "Connection Lost"

The AWS NLB also has a 120-second idle timeout for UDP, which compounds the issue.

Short matches work because players are constantly active. Long matches fail because eventually there's a period of inactivity long enough to trigger the timeout.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Add UDP keepalive mechanism",
				code: `class GameConnection {
  private readonly KEEPALIVE_INTERVAL = 30000; // 30 seconds
  private keepaliveTimer: NodeJS.Timer | null = null;

  startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      this.sendKeepalive();
    }, this.KEEPALIVE_INTERVAL);
  }

  private sendKeepalive(): void {
    for (const player of this.players) {
      // Send lightweight keepalive packet
      const keepalive = Buffer.alloc(4);
      keepalive.writeUInt32BE(PacketType.KEEPALIVE, 0);
      this.socket.send(keepalive, player.port, player.address);
    }
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}`,
			},
			{
				lang: "typescript",
				description: "Bidirectional keepalive (client and server)",
				code: `// Server side
class GameServer {
  handlePacket(packet: Buffer, rinfo: RemoteInfo): void {
    if (this.isKeepalive(packet)) {
      // Respond to client keepalive
      this.sendKeepaliveAck(rinfo);
      return;
    }
    // Handle normal game packets
    this.processGamePacket(packet, rinfo);
  }
}

// Client side
class GameClient {
  private lastServerPacket = Date.now();
  private readonly KEEPALIVE_THRESHOLD = 60000; // 60 seconds

  tick(): void {
    const silentTime = Date.now() - this.lastServerPacket;

    if (silentTime > this.KEEPALIVE_THRESHOLD) {
      // No packets from server in 60s, send keepalive
      this.sendKeepalive();
    }
  }

  handlePacket(packet: Buffer): void {
    this.lastServerPacket = Date.now();
    // ... process packet
  }
}`,
			},
			{
				lang: "yaml",
				description: "Increase NLB idle timeout",
				code: `# AWS CDK / CloudFormation
Resources:
  GameLoadBalancer:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Type: network
      # ...

  GameTargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Protocol: UDP
      Port: 7777
      # Increase idle timeout to 5 minutes
      TargetGroupAttributes:
        - Key: deregistration_delay.timeout_seconds
          Value: "300"
        # Note: UDP idle timeout is actually controlled differently
        # May need to use custom keepalive instead`,
			},
			{
				lang: "typescript",
				description: "Connection quality monitoring",
				code: `class ConnectionMonitor {
  private readonly TIMEOUT_WARNING = 90000;  // 90 seconds
  private readonly TIMEOUT_CRITICAL = 110000; // 110 seconds

  checkConnection(player: Player): ConnectionStatus {
    const timeSinceLastPacket = Date.now() - player.lastPacketTime;

    if (timeSinceLastPacket > this.TIMEOUT_CRITICAL) {
      // Force send keepalive immediately
      this.sendUrgentKeepalive(player);
      return 'critical';
    }

    if (timeSinceLastPacket > this.TIMEOUT_WARNING) {
      // Connection at risk, increase packet rate
      this.sendKeepalive(player);
      return 'warning';
    }

    return 'healthy';
  }
}`,
			},
		],
		prevention: [
			"Always implement keepalive for UDP connections",
			"Don't rely on game traffic alone for connection maintenance",
			"Test with idle/AFK scenarios, not just active gameplay",
			"Understand NAT timeout behavior for your target environments",
			"Configure infrastructure timeouts (NLB, firewalls) to match keepalive interval",
			"Monitor time since last packet per player",
		],
		educationalInsights: [
			"UDP is connectionless - 'connections' are maintained by NAT tables",
			"NAT mappings have finite lifetimes, unlike TCP connections",
			"Bidirectional traffic is needed to keep NAT mappings alive",
			"AWS NLB UDP idle timeout is 120 seconds by default",
			"Home routers, carrier NAT, and cloud NAT all have different timeouts",
			"Long-running UDP sessions need explicit keepalive mechanisms",
		],
	},
};

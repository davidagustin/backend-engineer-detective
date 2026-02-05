import type { DetectiveCase } from "../../types";

export const haproxyHealthCheckFlap: DetectiveCase = {
	id: "haproxy-health-check-flap",
	title: "The HAProxy Health Check Flap",
	subtitle: "Backends constantly oscillating between up and down",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"HAProxy is marking backend servers as DOWN and then UP again in rapid succession. This causes traffic to be unevenly distributed and requests to fail during transitions. The backend servers themselves appear healthy when checked directly.",
		impact:
			"Intermittent request failures during backend state transitions. Uneven load distribution causing some servers to be overwhelmed. Alert fatigue from constant UP/DOWN notifications.",
		timeline: [
			{ time: "2:00 PM", event: "Normal traffic distribution", type: "normal" },
			{ time: "2:15 PM", event: "First backend marked DOWN then UP within seconds", type: "warning" },
			{ time: "2:30 PM", event: "Multiple backends flapping every 30-60 seconds", type: "warning" },
			{ time: "3:00 PM", event: "Request failures during transitions spike to 5%", type: "critical" },
			{ time: "3:30 PM", event: "On-call paged due to alert storm", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Direct requests to backends succeed",
			"Application logs show normal processing",
			"Database connections stable",
			"CPU and memory on backends normal",
			"Network connectivity between HAProxy and backends verified",
		],
		broken: [
			"Backends marked DOWN then UP repeatedly",
			"Requests fail during state transitions",
			"Load distribution becomes uneven",
			"Connection errors spike periodically",
		],
	},

	clues: [
		{
			id: 1,
			title: "HAProxy Logs",
			type: "logs",
			content: `\`\`\`
[WARNING] 234/143022 (1847) : Server app_backend/server1 is DOWN, reason: Layer7 timeout,
  check duration: 5001ms. 2 active and 0 backup servers left.

[WARNING] 234/143024 (1847) : Server app_backend/server1 is UP, reason: Layer7 check passed,
  check duration: 45ms. 3 active and 0 backup servers online.

[WARNING] 234/143112 (1847) : Server app_backend/server2 is DOWN, reason: Layer7 timeout,
  check duration: 5002ms. 2 active and 0 backup servers left.

[WARNING] 234/143114 (1847) : Server app_backend/server2 is UP, reason: Layer7 check passed,
  check duration: 52ms. 3 active and 0 backup servers online.

[WARNING] 234/143158 (1847) : Server app_backend/server1 is DOWN, reason: Layer7 timeout,
  check duration: 5001ms. 2 active and 0 backup servers left.
\`\`\``,
			hint: "Notice the check duration when it fails vs when it passes...",
		},
		{
			id: 2,
			title: "HAProxy Configuration",
			type: "config",
			content: `\`\`\`haproxy
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    timeout check 5s

backend app_backend
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200

    server server1 10.0.1.10:8080 check inter 10s fall 2 rise 2
    server server2 10.0.1.11:8080 check inter 10s fall 2 rise 2
    server server3 10.0.1.12:8080 check inter 10s fall 2 rise 2
\`\`\``,
			hint: "Look at the fall/rise values and the timeout settings...",
		},
		{
			id: 3,
			title: "Backend Health Endpoint Code",
			type: "code",
			content: `\`\`\`typescript
app.get('/health', async (req, res) => {
  try {
    // Check database connectivity
    await db.query('SELECT 1');

    // Check Redis connectivity
    await redis.ping();

    // Check external payment service
    await paymentService.healthCheck();

    // Check message queue
    await messageQueue.checkConnection();

    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});
\`\`\``,
			hint: "How many external services does this health check depend on?",
		},
		{
			id: 4,
			title: "Payment Service Latency",
			type: "metrics",
			content: `\`\`\`
Payment Service Health Check Latency:
  P50: 200ms
  P95: 3,500ms
  P99: 8,200ms
  Timeout: None configured (waits indefinitely)

Message Queue Connection Check:
  P50: 50ms
  P95: 2,100ms
  P99: 4,800ms

Database Query Latency:
  P50: 5ms
  P95: 50ms
  P99: 150ms
\`\`\``,
			hint: "What happens when multiple slow checks combine?",
		},
		{
			id: 5,
			title: "Network Engineer Testimony",
			type: "testimony",
			content: `"The weird thing is it's not consistent. Sometimes the same server will be fine for hours, then flap 10 times in 5 minutes. We checked the network - no packet loss, no latency spikes between HAProxy and the backends. The issue seems to correlate with overall system load, but the backends have plenty of capacity."`,
		},
		{
			id: 6,
			title: "Direct Health Check Test",
			type: "logs",
			content: `\`\`\`bash
# Running 100 health checks against server1
$ for i in {1..100}; do
    curl -w "%{time_total}\\n" -s -o /dev/null http://10.0.1.10:8080/health
  done | sort -n | tail -10

2.847
3.124
3.567
4.012
4.234
4.891
5.234
6.127
7.845
9.234

# 5 out of 100 checks took longer than 5 seconds
\`\`\``,
			hint: "Compare these times to HAProxy's timeout check setting...",
		},
	],

	solution: {
		diagnosis: "Health check timeout too aggressive for deep health endpoint",
		keywords: [
			"health check",
			"flapping",
			"timeout check",
			"layer7 timeout",
			"deep health check",
			"health endpoint",
			"fall rise",
			"haproxy",
		],
		rootCause: `The health check endpoint performs deep checks against multiple external dependencies (database, Redis, payment service, message queue). When any of these dependencies experience temporary latency spikes, the health check can take longer than HAProxy's 5-second timeout.

The payment service health check alone has a P99 latency of 8.2 seconds. Combined with other checks, the total health check time occasionally exceeds 5 seconds. With fall=2, just two consecutive slow health checks mark the server as DOWN.

The flapping occurs because:
1. Normal health check passes quickly (~50ms)
2. Occasional slow external dependency causes check to exceed 5s
3. HAProxy marks server DOWN after 2 failed checks
4. Next check passes (dependency recovered), server marked UP
5. Cycle repeats

This creates a vicious cycle where healthy servers are constantly being removed and re-added to the rotation.`,
		codeExamples: [
			{
				lang: "haproxy",
				description: "Fix HAProxy config with relaxed settings",
				code: `defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    timeout check 15s  # Increased to accommodate slow dependencies

backend app_backend
    balance roundrobin
    option httpchk GET /health/shallow  # Use shallow health check
    http-check expect status 200

    # More forgiving fall/rise values
    server server1 10.0.1.10:8080 check inter 10s fall 3 rise 2
    server server2 10.0.1.11:8080 check inter 10s fall 3 rise 2
    server server3 10.0.1.12:8080 check inter 10s fall 3 rise 2`,
			},
			{
				lang: "typescript",
				description: "Implement shallow and deep health endpoints",
				code: `// Shallow health check - for load balancer (fast, local only)
app.get('/health/shallow', (req, res) => {
  // Only check if the process is responsive
  res.status(200).json({ status: 'healthy', type: 'shallow' });
});

// Liveness check - can this process handle requests?
app.get('/health/live', async (req, res) => {
  try {
    // Only check critical local resources
    await db.query('SELECT 1');
    res.status(200).json({ status: 'live' });
  } catch (error) {
    res.status(503).json({ status: 'not live', error: error.message });
  }
});

// Deep health check - for monitoring systems (can be slow)
app.get('/health/deep', async (req, res) => {
  const checks = {
    database: await checkWithTimeout(db.query('SELECT 1'), 2000),
    redis: await checkWithTimeout(redis.ping(), 1000),
    payment: await checkWithTimeout(paymentService.healthCheck(), 5000),
    messageQueue: await checkWithTimeout(messageQueue.checkConnection(), 2000),
  };

  const allHealthy = Object.values(checks).every(c => c.healthy);
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? 'healthy' : 'degraded', checks });
});

async function checkWithTimeout(promise, timeoutMs) {
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}`,
			},
		],
		prevention: [
			"Use shallow health checks for load balancers (process responsiveness only)",
			"Reserve deep health checks for monitoring and alerting systems",
			"Add timeouts to all external dependency checks in health endpoints",
			"Set health check timeout higher than expected P99 latency",
			"Increase fall threshold to prevent flapping from transient issues",
			"Monitor health check latency as a metric",
		],
		educationalInsights: [
			"Load balancer health checks should verify the server can handle traffic, not dependency health",
			"Deep health checks create coupling between your availability and dependency availability",
			"fall=2 is very aggressive - one slow check + one timeout = server removed",
			"Health check flapping can cause more problems than a consistently down server",
			"Separate concerns: LB health vs dependency health vs application health",
		],
	},
};

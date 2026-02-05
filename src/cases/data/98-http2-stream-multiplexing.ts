import type { DetectiveCase } from "../../types";

export const http2StreamMultiplexing: DetectiveCase = {
	id: "http2-stream-multiplexing",
	title: "The HTTP/2 Stream Multiplexing Mystery",
	subtitle: "Head-of-line blocking from single slow response",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"After migrating to HTTP/2 for performance, users are experiencing periodic freezes where all requests seem to stall simultaneously. The dashboard becomes unresponsive, multiple API calls fail together, and then everything resumes. Individual request times look normal in isolation.",
		impact:
			"Dashboard users experiencing 10-15 second freezes. Multiple microservices timing out in sync. User perception of slow, unreliable application. HTTP/2 migration under scrutiny.",
		timeline: [
			{ time: "Week 1", event: "HTTP/2 migration completed, initial performance gains observed", type: "normal" },
			{ time: "Week 2", event: "First reports of 'dashboard freezing' from users", type: "warning" },
			{ time: "Week 3", event: "Pattern identified: freezes correlate with report generation", type: "warning" },
			{ time: "Week 4", event: "All dashboard requests failing simultaneously during peaks", type: "critical" },
			{ time: "Week 5", event: "Engineering escalation, HTTP/2 rollback considered", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Individual API endpoints respond normally when tested alone",
			"Backend services healthy and fast",
			"HTTP/2 connection established successfully",
			"Small requests complete instantly",
			"Performance is great when no slow requests are in flight",
		],
		broken: [
			"Multiple concurrent requests all freeze simultaneously",
			"Fast endpoints blocked by slow endpoint on same connection",
			"Dashboard becomes completely unresponsive",
			"Client-side timeout hits for many requests at once",
		],
	},

	clues: [
		{
			id: 1,
			title: "Browser Network Panel",
			type: "logs",
			content: `\`\`\`
Request Timeline (during freeze):

GET /api/users/profile     [=====|---------------WAITING---------------|]  12.3s
GET /api/notifications     [=====|---------------WAITING---------------|]  12.1s
GET /api/dashboard/stats   [=====|---------------WAITING---------------|]  11.9s
GET /api/reports/generate  [=====|================CONTENT================]  12.5s
GET /api/activity/recent   [=====|---------------WAITING---------------|]  12.0s

All requests started at same time
All "fast" requests (profile, notifications, etc.) are WAITING
Report generation (slow) is actively receiving content
Fast requests complete only AFTER report finishes
\`\`\``,
			hint: "Why are fast requests waiting for the slow request?",
		},
		{
			id: 2,
			title: "HTTP/2 Frame Analysis",
			type: "logs",
			content: `\`\`\`
# HTTP/2 frames captured on connection

Frame 1: HEADERS (stream 1) - GET /api/users/profile
Frame 2: HEADERS (stream 3) - GET /api/notifications
Frame 3: HEADERS (stream 5) - GET /api/dashboard/stats
Frame 4: HEADERS (stream 7) - GET /api/reports/generate
Frame 5: HEADERS (stream 9) - GET /api/activity/recent

Frame 6: HEADERS (stream 7) - 200 OK (reports)
Frame 7: DATA (stream 7) - 16384 bytes [report data chunk 1]
Frame 8: DATA (stream 7) - 16384 bytes [report data chunk 2]
...
Frame 847: DATA (stream 7) - 16384 bytes [report data chunk 841]
Frame 848: DATA (stream 7) - END_STREAM

Frame 849: HEADERS (stream 1) - 200 OK (profile) ← FINALLY!
Frame 850: DATA (stream 1) - 512 bytes, END_STREAM
Frame 851: HEADERS (stream 3) - 200 OK (notifications)
...
\`\`\``,
			hint: "Look at when responses for streams 1, 3, 5, 9 finally arrive...",
		},
		{
			id: 3,
			title: "Server Configuration",
			type: "config",
			content: `\`\`\`nginx
server {
    listen 443 ssl http2;

    # HTTP/2 settings
    http2_max_concurrent_streams 100;
    http2_recv_buffer_size 256k;

    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;  # Backend uses HTTP/1.1
        proxy_set_header Connection "";

        # Response buffering - NGINX buffers entire response
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 64k;
    }
}
\`\`\``,
			hint: "How does proxy_buffering interact with HTTP/2 streaming?",
		},
		{
			id: 4,
			title: "Backend Response Sizes",
			type: "metrics",
			content: `\`\`\`
Endpoint Response Sizes:

/api/users/profile:      512 bytes (instant)
/api/notifications:    1,247 bytes (instant)
/api/dashboard/stats:  2,891 bytes (instant)
/api/activity/recent:  3,456 bytes (instant)

/api/reports/generate: 13.7 MB (takes 12 seconds to generate)

HTTP/2 Flow Control:
  Initial window size: 65,535 bytes
  Connection-level window: 16,777,215 bytes
  Stream-level window: 65,535 bytes
\`\`\``,
			hint: "What happens when one stream consumes the connection window?",
		},
		{
			id: 5,
			title: "Protocol Engineer Analysis",
			type: "testimony",
			content: `"HTTP/2 multiplexing should allow multiple requests over one connection without blocking each other. But when I looked closer, the server is processing requests sequentially through the reverse proxy. NGINX receives the HTTP/2 streams, but proxies them as HTTP/1.1 to the backend. The proxy buffering means NGINX won't send response frames for fast endpoints until it has the complete response, but it's busy writing the large report response..."`,
		},
		{
			id: 6,
			title: "TCP Window Analysis",
			type: "metrics",
			content: `\`\`\`
# TCP connection during freeze

Time 0.0s: Connection window = 16MB, all streams have 64KB window
Time 0.1s: Report stream starts receiving data
Time 0.5s: Report stream window depleted (64KB consumed)
Time 0.5s: WINDOW_UPDATE sent for report stream
Time 1.0s: Server sends more report data...

# Meanwhile, other streams:
# - Backend responses ready (profile: 512 bytes, etc.)
# - NGINX has responses buffered
# - But TCP send buffer congested with report data
# - Small responses queued behind large report

Problem: Single TCP connection, kernel schedules writes
Large response monopolizes send buffer
Small responses starve
\`\`\``,
			hint: "HTTP/2 multiplexing doesn't help if TCP is the bottleneck...",
		},
	],

	solution: {
		diagnosis: "HTTP/2 head-of-line blocking at TCP layer due to large response monopolizing connection",
		keywords: [
			"http2",
			"head of line blocking",
			"multiplexing",
			"stream priority",
			"flow control",
			"tcp blocking",
			"proxy buffering",
			"response size",
		],
		rootCause: `HTTP/2 eliminates HTTP-level head-of-line blocking through stream multiplexing, but TCP-level head-of-line blocking still exists. When a large response (13.7 MB report) is being transmitted, it monopolizes the TCP send buffer.

The issue is compounded by:

1. **Proxy buffering**: NGINX buffers the entire response before sending to client, not streaming
2. **Single TCP connection**: HTTP/2's benefit (one connection) becomes a liability
3. **Flow control windows**: Large response consumes connection-level flow control
4. **TCP send buffer saturation**: Small responses can't be interleaved with large one

The fast endpoints' responses are ready and buffered in NGINX, but the TCP socket is congested sending the large report. HTTP/2's multiplexing frames can't help because they're all going through the same TCP byte stream.

This is a known limitation of HTTP/2 over TCP, which is why HTTP/3 (QUIC) was developed - it provides true per-stream flow control at the transport layer.`,
		codeExamples: [
			{
				lang: "nginx",
				description: "Disable proxy buffering for streaming responses",
				code: `server {
    listen 443 ssl http2;

    http2_max_concurrent_streams 100;

    # Fast endpoints - buffering OK (small responses)
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_buffering on;  # Fine for small responses
    }

    # Large/slow endpoints - disable buffering, stream directly
    location /api/reports/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_buffering off;  # Stream response as it arrives

        # Or use X-Accel-Buffering header from backend
        # to control per-response
    }
}`,
			},
			{
				lang: "typescript",
				description: "Separate connections for large transfers",
				code: `// Frontend: Use separate fetch for large requests
// This creates a new HTTP/2 connection (different origin/subdomain)

class ApiClient {
  private baseUrl = 'https://api.example.com';
  private bulkUrl = 'https://bulk.example.com';  // Different subdomain

  // Fast endpoints use main connection
  async getProfile(): Promise<Profile> {
    return fetch(\`\${this.baseUrl}/api/users/profile\`).then(r => r.json());
  }

  async getNotifications(): Promise<Notification[]> {
    return fetch(\`\${this.baseUrl}/api/notifications\`).then(r => r.json());
  }

  // Large transfers use separate connection
  async generateReport(): Promise<Blob> {
    // Different subdomain = different HTTP/2 connection
    // Won't block other requests
    return fetch(\`\${this.bulkUrl}/api/reports/generate\`).then(r => r.blob());
  }
}

// Backend: Stream large responses
app.get('/api/reports/generate', async (req, res) => {
  res.setHeader('X-Accel-Buffering', 'no');  // Tell NGINX not to buffer
  res.setHeader('Content-Type', 'application/octet-stream');

  const reportStream = await generateReportStream();
  reportStream.pipe(res);  // Stream directly to client
});`,
			},
			{
				lang: "nginx",
				description: "HTTP/2 priority and concurrent stream limits",
				code: `http {
    # Limit concurrent streams to prevent monopolization
    http2_max_concurrent_streams 32;

    # Adjust chunk size for better interleaving
    http2_chunk_size 8k;  # Smaller chunks, more frequent interleaving

    # Per-worker connection limits
    http2_max_concurrent_pushes 10;

    server {
        listen 443 ssl http2;

        # Consider HTTP/3 (QUIC) for true multiplexing
        listen 443 quic reuseport;
        add_header Alt-Svc 'h3=":443"; ma=86400';

        location /api/ {
            proxy_pass http://backend;

            # Priority hints (experimental)
            # Modern browsers send priority; server can use it
        }
    }
}`,
			},
		],
		prevention: [
			"Use separate subdomains/connections for large transfers",
			"Disable proxy buffering for streaming or large responses",
			"Consider HTTP/3 (QUIC) for true per-stream flow control",
			"Monitor response sizes and set up alerts for unexpectedly large responses",
			"Implement response size limits on API endpoints",
			"Use background jobs with polling for very large data transfers",
		],
		educationalInsights: [
			"HTTP/2 eliminates HTTP-level HOL blocking but not TCP-level HOL blocking",
			"A single TCP connection means a single congestion window shared by all streams",
			"HTTP/3 (QUIC) uses UDP with per-stream flow control to solve this",
			"Proxy buffering can negate HTTP/2 streaming benefits",
			"Large responses on shared connections can starve small responses",
			"HTTP/2 stream priorities are hints, not guarantees",
		],
	},
};

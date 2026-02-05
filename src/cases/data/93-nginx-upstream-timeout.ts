import type { DetectiveCase } from "../../types";

export const nginxUpstreamTimeout: DetectiveCase = {
	id: "nginx-upstream-timeout",
	title: "The NGINX Upstream Timeout",
	subtitle: "504 Gateway Timeout errors despite healthy backends",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Users are intermittently receiving 504 Gateway Timeout errors when accessing the API. The backend services appear healthy, response times look normal in application metrics, but NGINX is returning timeouts. The problem only affects certain endpoints.",
		impact:
			"20% of API requests to specific endpoints failing with 504 errors. Mobile app users experiencing broken functionality. Revenue-impacting checkout flow affected.",
		timeline: [
			{ time: "10:00 AM", event: "Normal operations, all metrics green", type: "normal" },
			{ time: "10:15 AM", event: "First 504 errors appear in logs", type: "warning" },
			{ time: "10:30 AM", event: "504 error rate reaches 5%", type: "warning" },
			{ time: "11:00 AM", event: "Customer complaints about checkout failures", type: "critical" },
			{ time: "11:30 AM", event: "504 error rate peaks at 20% on report endpoints", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Backend services respond to direct requests",
			"Health checks passing on all upstreams",
			"Quick API endpoints work fine",
			"Static assets served normally",
			"Database queries executing successfully",
		],
		broken: [
			"Report generation endpoints returning 504",
			"Checkout confirmation occasionally times out",
			"File export endpoints failing",
			"Any request taking longer than 60 seconds fails",
		],
	},

	clues: [
		{
			id: 1,
			title: "NGINX Error Logs",
			type: "logs",
			content: `\`\`\`
[error] 29847#0: *1847593 upstream timed out (110: Connection timed out)
  while reading response header from upstream,
  client: 10.0.1.45,
  server: api.example.com,
  request: "GET /api/v1/reports/annual HTTP/1.1",
  upstream: "http://10.0.2.100:8080/api/v1/reports/annual",
  host: "api.example.com"

[error] 29847#0: *1847621 upstream timed out (110: Connection timed out)
  while reading response header from upstream,
  client: 10.0.1.78,
  server: api.example.com,
  request: "POST /api/v1/checkout/confirm HTTP/1.1",
  upstream: "http://10.0.2.101:8080/api/v1/checkout/confirm",
  host: "api.example.com"
\`\`\``,
			hint: "Notice where the timeout occurs - 'reading response header'...",
		},
		{
			id: 2,
			title: "NGINX Configuration",
			type: "config",
			content: `\`\`\`nginx
upstream backend {
    server 10.0.2.100:8080 weight=5;
    server 10.0.2.101:8080 weight=5;
    server 10.0.2.102:8080 weight=5;
    keepalive 32;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_buffer_size 4k;
        proxy_buffers 8 16k;
    }
}
\`\`\``,
			hint: "What happens when a request takes longer than 60 seconds?",
		},
		{
			id: 3,
			title: "Backend Application Metrics",
			type: "metrics",
			content: `\`\`\`
Endpoint: /api/v1/reports/annual
  P50 Latency: 45s
  P95 Latency: 85s
  P99 Latency: 120s
  Success Rate: 99.8%

Endpoint: /api/v1/checkout/confirm
  P50 Latency: 2s
  P95 Latency: 55s
  P99 Latency: 75s
  Success Rate: 99.5%

Endpoint: /api/v1/users/profile
  P50 Latency: 50ms
  P95 Latency: 200ms
  P99 Latency: 500ms
  Success Rate: 99.99%
\`\`\``,
			hint: "Compare the P95/P99 latencies to the NGINX timeout value...",
		},
		{
			id: 4,
			title: "Backend Developer Testimony",
			type: "testimony",
			content: `"The annual report endpoint has always been slow - it aggregates a full year of data. We warned the team it could take up to 2 minutes for large accounts. The checkout confirmation can be slow too when payment processors have delays. But both endpoints work fine when I test them directly against the backend service."`,
		},
		{
			id: 5,
			title: "Direct Backend Test",
			type: "logs",
			content: `\`\`\`bash
$ curl -w "Time: %{time_total}s\\n" http://10.0.2.100:8080/api/v1/reports/annual
{"status": "success", "data": {...}}
Time: 87.234s

$ curl -w "Time: %{time_total}s\\n" http://10.0.2.101:8080/api/v1/checkout/confirm -X POST -d '{...}'
{"status": "confirmed", "orderId": "12345"}
Time: 68.891s

# Both requests complete successfully when bypassing NGINX
\`\`\``,
			hint: "The backend completes the request, but how long did it take?",
		},
		{
			id: 6,
			title: "NGINX Status Page",
			type: "metrics",
			content: `\`\`\`
Active connections: 847
server accepts handled requests
 1847593 1847593 4829174

Reading: 12 Writing: 156 Waiting: 679

Upstream status:
  backend: 10.0.2.100:8080 - up, responses: 589234, fails: 0
  backend: 10.0.2.101:8080 - up, responses: 591847, fails: 0
  backend: 10.0.2.102:8080 - up, responses: 587421, fails: 0
\`\`\``,
			hint: "Zero upstream fails but we're seeing 504s - where's the disconnect?",
		},
	],

	solution: {
		diagnosis: "proxy_read_timeout set too low for slow backend endpoints",
		keywords: [
			"proxy_read_timeout",
			"upstream timeout",
			"504 gateway timeout",
			"nginx timeout",
			"read timeout",
			"slow endpoint",
			"long-running request",
		],
		rootCause: `The NGINX proxy_read_timeout is set to 60 seconds, but several backend endpoints legitimately take longer than 60 seconds to complete. The annual report endpoint has a P95 latency of 85 seconds and P99 of 120 seconds. The checkout confirmation can take up to 75 seconds at P99.

When NGINX waits for the backend response and doesn't receive the response headers within 60 seconds, it terminates the connection and returns a 504 Gateway Timeout to the client. The backend continues processing and eventually completes successfully, but the client never receives the response.

The health checks pass because they use quick endpoints. The upstream "fails" counter doesn't increment because NGINX doesn't consider a timeout a connection failure - the connection was established, it just didn't receive a response in time.`,
		codeExamples: [
			{
				lang: "nginx",
				description: "Fix with increased global timeout",
				code: `upstream backend {
    server 10.0.2.100:8080 weight=5;
    server 10.0.2.101:8080 weight=5;
    server 10.0.2.102:8080 weight=5;
    keepalive 32;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 180s;  # Increased to 3 minutes
    }
}`,
			},
			{
				lang: "nginx",
				description: "Better: Per-endpoint timeout configuration",
				code: `server {
    listen 80;
    server_name api.example.com;

    # Default timeout for most endpoints
    location / {
        proxy_pass http://backend;
        proxy_read_timeout 60s;
        include /etc/nginx/proxy_common.conf;
    }

    # Extended timeout for slow report endpoints
    location /api/v1/reports {
        proxy_pass http://backend;
        proxy_read_timeout 300s;  # 5 minutes for reports
        include /etc/nginx/proxy_common.conf;
    }

    # Extended timeout for checkout (payment processor delays)
    location /api/v1/checkout {
        proxy_pass http://backend;
        proxy_read_timeout 120s;  # 2 minutes for checkout
        include /etc/nginx/proxy_common.conf;
    }
}`,
			},
		],
		prevention: [
			"Document expected latency SLAs for each endpoint",
			"Configure per-endpoint timeouts based on actual latency profiles",
			"Set up alerts when P99 latency approaches proxy timeout threshold",
			"Consider async processing for very slow operations (return job ID, poll for results)",
			"Add timeout configuration to deployment checklists for new slow endpoints",
		],
		educationalInsights: [
			"proxy_read_timeout only affects how long NGINX waits for the response, not the connection setup",
			"A 504 from NGINX means the proxy timed out, not that the backend is down",
			"Health checks use different code paths and may not reflect actual endpoint performance",
			"Per-location timeout configuration allows fine-grained control without affecting fast endpoints",
			"Consider the full request path when setting timeouts: client -> LB -> NGINX -> backend",
		],
	},
};

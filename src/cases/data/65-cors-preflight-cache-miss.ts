import type { DetectiveCase } from "../../types";

export const corsPreflightCacheMiss: DetectiveCase = {
	id: "cors-preflight-cache-miss",
	title: "The CORS Preflight Cache Miss",
	subtitle: "High latency due to OPTIONS requests not cached",
	difficulty: "junior",
	category: "networking",

	crisis: {
		description:
			"Users are complaining that the dashboard feels sluggish. Every interaction has a noticeable delay. The backend APIs respond quickly in isolated tests, but the browser experience is painfully slow.",
		impact:
			"User satisfaction scores dropping. 200-400ms added to every API interaction. Frontend team blamed initially, but React profiling shows the app is fast.",
		timeline: [
			{ time: "Last month", event: "Migrated API from same-origin to dedicated api.example.com subdomain", type: "normal" },
			{ time: "Last week", event: "Users start complaining about dashboard slowness", type: "warning" },
			{ time: "Tuesday", event: "Frontend team rules out React performance issues", type: "normal" },
			{ time: "Wednesday", event: "Network waterfall shows mysterious delays", type: "warning" },
			{ time: "Thursday", event: "Every API call preceded by OPTIONS request", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Direct API calls via curl are fast (<50ms)",
			"Backend services show healthy response times",
			"React components render quickly",
			"First page load is reasonably fast",
		],
		broken: [
			"200-400ms delay on every user interaction",
			"Network panel shows pairs of requests for each API call",
			"OPTIONS requests before every POST/PUT/DELETE",
			"Delays compound when multiple APIs called",
		],
	},

	clues: [
		{
			id: 1,
			title: "Browser Network Panel",
			type: "metrics",
			content: `\`\`\`
Network Requests for "Save Settings" button click:

Request 1: OPTIONS /api/user/settings
  Status: 204 No Content
  Time: 180ms
  Headers sent: Origin, Access-Control-Request-Method, Access-Control-Request-Headers

Request 2: PUT /api/user/settings
  Status: 200 OK
  Time: 45ms
  Actual settings update

Request 3: OPTIONS /api/user/profile
  Status: 204 No Content
  Time: 195ms

Request 4: GET /api/user/profile
  Status: 200 OK
  Time: 38ms
  Profile refresh

Total time: 458ms (375ms in OPTIONS requests!)
\`\`\``,
			hint: "OPTIONS requests take 4x longer than actual API calls...",
		},
		{
			id: 2,
			title: "CORS Server Configuration",
			type: "code",
			content: `\`\`\`typescript
// api-server/src/middleware/cors.ts
import cors from 'cors';

const corsOptions = {
  origin: ['https://app.example.com', 'https://admin.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true
};

app.use(cors(corsOptions));
\`\`\``,
			hint: "What's missing from this CORS configuration?",
		},
		{
			id: 3,
			title: "OPTIONS Response Headers",
			type: "logs",
			content: `\`\`\`
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID
Access-Control-Allow-Credentials: true
Vary: Origin
Date: Thu, 15 Jan 2024 10:30:45 GMT

Note: No Access-Control-Max-Age header present!
\`\`\``,
		},
		{
			id: 4,
			title: "CORS Preflight Explanation",
			type: "config",
			content: `\`\`\`markdown
# CORS Preflight Requests

## When does the browser send OPTIONS?
- Cross-origin requests (different domain/subdomain)
- Using methods other than GET, HEAD, POST
- POST with Content-Type other than form-data, text/plain, urlencoded
- Custom headers (Authorization, X-Request-ID, etc.)

## What is Access-Control-Max-Age?
- Tells browser how long to cache the preflight response
- Default: 0 (no caching) or 5 seconds (varies by browser)
- Chrome caps at 7200 seconds (2 hours)
- Firefox caps at 86400 seconds (24 hours)

## Without caching:
Every qualifying request triggers a fresh OPTIONS request,
adding network round-trip latency to every API call.
\`\`\``,
		},
		{
			id: 5,
			title: "Same-Origin vs Cross-Origin Comparison",
			type: "metrics",
			content: `\`\`\`
Performance comparison:

Old setup (same origin: app.example.com/api):
  PUT /api/settings: 45ms (no preflight needed)

New setup (cross origin: api.example.com):
  OPTIONS /api/settings: 180ms
  PUT /api/settings: 45ms
  Total: 225ms (+400% overhead!)

The 180ms OPTIONS latency is the network round-trip:
  - DNS lookup: ~20ms
  - TCP handshake: ~30ms
  - TLS handshake: ~60ms
  - Server processing: ~5ms
  - Response transit: ~65ms
\`\`\``,
		},
		{
			id: 6,
			title: "DevOps Engineer Statement",
			type: "testimony",
			content: `"We moved the API to a separate subdomain for a few reasons:
1. Better separation of concerns for scaling
2. Separate SSL certificates
3. CDN configuration

We updated the CORS config to allow the new origin, and everything worked.
We didn't realize we'd lost the same-origin benefit and that preflight
caching was a thing we needed to explicitly enable.

The default CORS middleware just... doesn't set a max-age by default."`,
		},
	],

	solution: {
		diagnosis: "Missing Access-Control-Max-Age header causing browsers to send OPTIONS preflight request before every cross-origin API call",
		keywords: [
			"cors",
			"preflight",
			"options",
			"access-control-max-age",
			"latency",
			"cross-origin",
			"cache",
			"browser",
		],
		rootCause: `The root cause is missing preflight cache configuration after migrating to a cross-origin API setup.

When the API moved from same-origin (app.example.com/api) to cross-origin (api.example.com):

1. Browser CORS preflight became required for all non-simple requests
2. Without Access-Control-Max-Age header, browsers don't cache preflight results
3. Every API call that requires preflight (POST with JSON, custom headers, etc.) triggers a fresh OPTIONS request
4. Each OPTIONS request adds full network round-trip latency (150-400ms)
5. Delays compound when multiple APIs are called in sequence

The CORS middleware defaults to not setting a max-age, meaning the browser defaults to either 0 or 5 seconds depending on the browser - effectively no caching for typical user interactions.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed: Add maxAge to CORS configuration",
				code: `// api-server/src/middleware/cors.ts
import cors from 'cors';

const corsOptions = {
  origin: ['https://app.example.com', 'https://admin.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400  // Cache preflight for 24 hours (86400 seconds)
};

app.use(cors(corsOptions));`,
			},
			{
				lang: "typescript",
				description: "Express manual CORS with cache headers",
				code: `// If not using cors middleware
app.options('*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': req.headers.origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'  // 24 hours
  });
  res.status(204).end();
});`,
			},
			{
				lang: "nginx",
				description: "Nginx CORS configuration with caching",
				code: `# nginx.conf
location /api/ {
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' $http_origin;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Request-ID';
        add_header 'Access-Control-Allow-Credentials' 'true';
        add_header 'Access-Control-Max-Age' 86400;
        add_header 'Content-Type' 'text/plain; charset=utf-8';
        add_header 'Content-Length' 0;
        return 204;
    }

    # Handle actual requests
    proxy_pass http://backend;
}`,
			},
		],
		prevention: [
			"Always set Access-Control-Max-Age when configuring CORS for APIs",
			"Monitor preflight request rates - high rates indicate missing cache headers",
			"Consider same-origin architecture when possible to avoid CORS entirely",
			"Document CORS caching requirements when planning cross-origin migrations",
			"Test API performance from browser, not just curl/Postman",
			"Use browser DevTools Network panel to verify preflight caching",
		],
		educationalInsights: [
			"CORS preflight is a browser security feature, not a server feature - curl bypasses it entirely",
			"Same-origin requests don't trigger preflight, explaining why migration caused issues",
			"Access-Control-Max-Age is browser-capped (2h Chrome, 24h Firefox)",
			"Simple requests (GET, HEAD, POST with basic headers) don't need preflight",
			"Custom headers like Authorization always trigger preflight for cross-origin",
			"Preflight adds full round-trip latency - especially noticeable on high-latency connections",
		],
	},
};

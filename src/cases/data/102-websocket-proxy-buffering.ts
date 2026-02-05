import type { DetectiveCase } from "../../types";

export const websocketProxyBuffering: DetectiveCase = {
	id: "websocket-proxy-buffering",
	title: "The WebSocket Proxy Buffering",
	subtitle: "Real-time messages delayed due to proxy buffering",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Users of the real-time collaboration app are experiencing message delays. Chat messages appear in bursts instead of immediately. Document edits from collaborators show up seconds late. The WebSocket connection is established but messages don't arrive in real-time.",
		impact:
			"Collaboration features unusable - users see each other's changes 5-10 seconds late. Chat feels broken. Live cursor tracking completely out of sync. Users switching to competitors' tools.",
		timeline: [
			{ time: "Monday", event: "Deployed new reverse proxy for SSL termination", type: "normal" },
			{ time: "Tuesday", event: "First complaints about 'laggy' collaboration", type: "warning" },
			{ time: "Wednesday", event: "Users report chat messages arriving in batches", type: "warning" },
			{ time: "Thursday", event: "Live cursors showing position from 5+ seconds ago", type: "critical" },
			{ time: "Friday", event: "Enterprise customer threatening to cancel", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"WebSocket connections establish successfully",
			"Messages eventually arrive",
			"No connection drops or errors",
			"Backend WebSocket server shows messages sent immediately",
			"Direct connections (bypassing proxy) work perfectly",
		],
		broken: [
			"Messages delayed by 5-10 seconds",
			"Multiple messages arrive in bursts",
			"Real-time features feel sluggish",
			"Small messages more delayed than large ones",
		],
	},

	clues: [
		{
			id: 1,
			title: "Message Timing Analysis",
			type: "logs",
			content: `\`\`\`
Server-side (backend) message log:
10:23:45.123 SEND user:123 "Hello"
10:23:45.456 SEND user:123 "How are you?"
10:23:46.234 SEND user:123 "I'm typing..."
10:23:46.567 SEND user:123 cursor_pos: {x: 450, y: 230}
10:23:47.123 SEND user:123 cursor_pos: {x: 455, y: 235}

Client-side receive log:
10:23:52.847 RECV "Hello"
10:23:52.848 RECV "How are you?"
10:23:52.849 RECV "I'm typing..."
10:23:52.850 RECV cursor_pos: {x: 450, y: 230}
10:23:52.851 RECV cursor_pos: {x: 455, y: 235}

# All messages sent over 2 seconds arrive in a burst 7 seconds later
\`\`\``,
			hint: "Messages sent individually arrive together in a batch...",
		},
		{
			id: 2,
			title: "Reverse Proxy Configuration",
			type: "config",
			content: `\`\`\`nginx
# NGINX reverse proxy configuration
upstream websocket_backend {
    server 10.0.1.100:8080;
    server 10.0.1.101:8080;
}

server {
    listen 443 ssl;
    server_name collab.example.com;

    location /ws {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        # Timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # Buffering settings (default values)
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }
}
\`\`\``,
			hint: "Look at the proxy_buffering setting...",
		},
		{
			id: 3,
			title: "Network Packet Capture",
			type: "logs",
			content: `\`\`\`
# Packets between NGINX and backend
10:23:45.123 Backend -> NGINX: WebSocket frame "Hello" (12 bytes)
10:23:45.456 Backend -> NGINX: WebSocket frame "How are you?" (18 bytes)
10:23:46.234 Backend -> NGINX: WebSocket frame "I'm typing..." (19 bytes)
10:23:46.567 Backend -> NGINX: WebSocket frame cursor_pos (45 bytes)
10:23:47.123 Backend -> NGINX: WebSocket frame cursor_pos (45 bytes)
# Total: 139 bytes accumulated in NGINX buffer

# Packets between NGINX and Client
10:23:52.847 NGINX -> Client: WebSocket frames (all 139 bytes at once)

# NGINX waits to fill buffer before sending to client
# Buffer size is 4KB, but flush happens on some other trigger
\`\`\``,
			hint: "NGINX is accumulating frames before forwarding them...",
		},
		{
			id: 4,
			title: "Buffer Behavior Testing",
			type: "logs",
			content: `\`\`\`bash
# Test: Send a large message (5KB)
$ wscat -c wss://collab.example.com/ws
> {"type":"largedata","data":"[5KB of data]"}
< {"ack":"received"}  # Response arrives in 200ms

# Test: Send a small message (50 bytes)
$ wscat -c wss://collab.example.com/ws
> {"type":"ping"}
# ... waiting ...
# ... still waiting ...
< {"type":"pong"}  # Response arrives in 5-8 seconds!

# Large messages arrive quickly (exceed buffer threshold)
# Small messages wait for buffer to fill or timeout
\`\`\``,
			hint: "Small messages are more delayed than large ones...",
		},
		{
			id: 5,
			title: "Ops Engineer Testimony",
			type: "testimony",
			content: `"We added NGINX in front of the WebSocket servers last week for SSL termination and load balancing. We copied the config from our HTTP API proxy and just added the WebSocket upgrade headers. The HTTP API works great with these buffer settings - it makes responses faster by batching. We didn't realize WebSockets need different handling."`,
		},
		{
			id: 6,
			title: "Direct Connection Test",
			type: "logs",
			content: `\`\`\`bash
# Bypass NGINX, connect directly to backend (internal network)
$ wscat -c ws://10.0.1.100:8080/ws

# Test small message latency
> {"type":"ping"}
< {"type":"pong"}  # Response in 5ms!

> {"type":"ping"}
< {"type":"pong"}  # Response in 4ms!

> {"type":"ping"}
< {"type":"pong"}  # Response in 6ms!

# Direct connection has no delay
# Problem is definitely in the proxy layer
\`\`\``,
			hint: "Direct connection works perfectly - the proxy is the culprit...",
		},
	],

	solution: {
		diagnosis: "NGINX proxy buffering delays small WebSocket frames until buffer fills",
		keywords: [
			"websocket",
			"proxy buffering",
			"nginx buffering",
			"real-time delay",
			"proxy_buffering",
			"message delay",
			"websocket proxy",
		],
		rootCause: `NGINX's proxy_buffering is enabled by default, which is great for HTTP responses but terrible for WebSocket real-time messaging. When buffering is on, NGINX accumulates data from the backend before sending to the client.

For HTTP:
- Buffering improves performance by reducing syscalls
- Entire response is buffered and sent efficiently
- Works well because HTTP is request-response

For WebSocket:
- Messages should be delivered immediately
- Small messages (chat, cursor positions) don't fill the buffer
- NGINX waits for more data or a timeout before flushing
- Real-time messages arrive in delayed batches

The buffer size is 4KB per buffer (8 buffers configured). Small WebSocket frames (typically 50-200 bytes) accumulate until:
1. The buffer fills (after many messages)
2. A flush timeout occurs
3. A large message exceeds the buffer

This is why large messages arrive quickly (they trigger a flush) while small messages are delayed (they wait in the buffer).`,
		codeExamples: [
			{
				lang: "nginx",
				description: "Disable buffering for WebSocket connections",
				code: `upstream websocket_backend {
    server 10.0.1.100:8080;
    server 10.0.1.101:8080;
}

server {
    listen 443 ssl;
    server_name collab.example.com;

    location /ws {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        # WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # CRITICAL: Disable buffering for real-time
        proxy_buffering off;

        # Alternative: Use X-Accel-Buffering header from backend
        # proxy_buffering on;  # Let backend control per-response
    }
}`,
			},
			{
				lang: "typescript",
				description: "Backend hint: X-Accel-Buffering header",
				code: `import { WebSocketServer } from 'ws';
import http from 'http';

const server = http.createServer();
const wss = new WebSocketServer({ server });

// Handle upgrade request
server.on('upgrade', (request, socket, head) => {
  // Tell NGINX not to buffer this connection
  socket.write(
    'HTTP/1.1 101 Switching Protocols\\r\\n' +
    'Upgrade: websocket\\r\\n' +
    'Connection: Upgrade\\r\\n' +
    'X-Accel-Buffering: no\\r\\n' +  // Hint to NGINX
    '\\r\\n'
  );

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// For Server-Sent Events (SSE) - same issue
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');  // Disable NGINX buffering

  // Now events stream immediately
  setInterval(() => {
    res.write(\`data: \${JSON.stringify({ time: Date.now() })}\\n\\n\`);
  }, 1000);
});`,
			},
			{
				lang: "nginx",
				description: "Complete WebSocket proxy configuration",
				code: `# Optimal NGINX configuration for WebSocket proxy

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream websocket_backend {
    server 10.0.1.100:8080;
    server 10.0.1.101:8080;
    keepalive 32;  # Keep connections open to backend
}

server {
    listen 443 ssl http2;
    server_name collab.example.com;

    # WebSocket endpoint
    location /ws {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;

        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long timeouts for persistent connections
        proxy_connect_timeout 1h;
        proxy_send_timeout 1h;
        proxy_read_timeout 1h;

        # CRITICAL: No buffering for real-time
        proxy_buffering off;
        proxy_cache off;

        # TCP optimizations
        tcp_nodelay on;
    }

    # Regular HTTP endpoints can keep buffering
    location /api {
        proxy_pass http://api_backend;
        proxy_buffering on;  # Fine for HTTP
    }
}`,
			},
		],
		prevention: [
			"Always disable proxy_buffering for WebSocket and SSE endpoints",
			"Use separate location blocks for real-time vs HTTP endpoints",
			"Test real-time message latency after any proxy changes",
			"Document proxy requirements for different protocol types",
			"Consider using X-Accel-Buffering header for per-response control",
			"Monitor end-to-end message latency as a key metric",
		],
		educationalInsights: [
			"Proxy buffering improves HTTP performance but breaks real-time protocols",
			"WebSocket frames should be forwarded immediately, not batched",
			"Small messages are affected more than large ones due to buffer thresholds",
			"Server-Sent Events (SSE) have the same buffering issue",
			"The X-Accel-Buffering header lets backends control buffering per-response",
			"tcp_nodelay also helps reduce latency for small packets",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const zeroDowntimeDeployFailure: DetectiveCase = {
	id: "zero-downtime-deploy-failure",
	title: "The Zero-Downtime Deploy Failure",
	subtitle: "Connection drops during rolling update despite health checks",
	difficulty: "mid",
	category: "distributed",

	crisis: {
		description:
			"During rolling deployments, users experience brief connection drops and failed requests. Health checks pass, new pods are marked ready, but traffic fails for 10-30 seconds during each pod rotation.",
		impact:
			"5xx error rate spikes to 3% during deployments. WebSocket connections drop. Mobile app shows 'connection lost' errors. Deployment window restricted to off-hours only.",
		timeline: [
			{ time: "2:00 PM", event: "Rolling deployment started", type: "normal" },
			{ time: "2:01 PM", event: "Pod 1 terminating, Pod 4 starting", type: "normal" },
			{ time: "2:02 PM", event: "Error rate spikes to 3%", type: "warning" },
			{ time: "2:03 PM", event: "Pod 4 marked ready", type: "normal" },
			{ time: "2:04 PM", event: "Pod 2 terminating, Pod 5 starting", type: "normal" },
			{ time: "2:05 PM", event: "Error rate spikes again", type: "warning" },
			{ time: "2:10 PM", event: "Deployment complete, errors subside", type: "normal" },
		],
	},

	symptoms: {
		working: [
			"Health checks pass before traffic routed",
			"New pods respond correctly when tested directly",
			"Deployment eventually completes successfully",
			"Errors stop after all pods updated",
			"Application works correctly post-deployment",
		],
		broken: [
			"5xx errors during pod termination phase",
			"Connection reset errors in logs",
			"WebSocket connections drop abruptly",
			"Long-running requests fail mid-execution",
			"Load balancer returns 502/504 briefly",
		],
	},

	clues: [
		{
			id: 1,
			title: "Kubernetes Deployment Config",
			type: "config",
			content: `\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    spec:
      containers:
      - name: api
        image: api-service:v2.5.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 10
\`\`\``,
			hint: "What happens when a pod is being terminated?",
		},
		{
			id: 2,
			title: "Pod Termination Timeline",
			type: "logs",
			content: `\`\`\`
Pod Termination Sequence (observed):
====================================
T+0.000s  SIGTERM sent to pod
T+0.000s  Pod still in Service endpoints (receiving traffic!)
T+0.000s  App begins shutdown, stops accepting NEW connections
T+0.050s  In-flight requests still processing
T+0.100s  kube-proxy updates iptables (async)
T+0.200s  Some nodes have updated iptables, others don't
T+0.500s  Load balancer health check runs, pod still "healthy"
T+1.000s  More traffic routed to terminating pod
T+2.000s  App closes listeners, rejects new connections
T+2.001s  Incoming requests get "connection refused"
T+5.000s  kube-proxy fully propagated across cluster
T+10.00s  Load balancer marks pod unhealthy
T+30.00s  SIGKILL if not exited (terminationGracePeriodSeconds)

Gap: Traffic continues for 2-5 seconds after SIGTERM
     while pod is shutting down but still in endpoints
\`\`\``,
			hint: "There's a gap between SIGTERM and when traffic stops...",
		},
		{
			id: 3,
			title: "Application Shutdown Code",
			type: "code",
			content: `\`\`\`typescript
// server.ts
const server = express();

// Health endpoint
server.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');

  // Stop accepting new connections immediately
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(8080, () => {
  console.log('Server listening on port 8080');
});
\`\`\``,
			hint: "The shutdown happens immediately on SIGTERM...",
		},
		{
			id: 4,
			title: "Service and Ingress Config",
			type: "config",
			content: `\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  selector:
    app: api
  ports:
  - port: 80
    targetPort: 8080

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    # No specific annotations for graceful shutdown
spec:
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80
\`\`\``,
			hint: "What annotations might help with graceful termination?",
		},
		{
			id: 5,
			title: "SRE Investigation Notes",
			type: "testimony",
			content: `"I traced a failed request during deployment. The request arrived at a pod that was already shutting down. Here's what I found: When Kubernetes sends SIGTERM, it does two things in parallel - tells the pod to terminate AND removes it from the Service endpoints. But these aren't atomic. The endpoint removal requires updating iptables on every node, which takes a few seconds. During that window, new requests still arrive at the terminating pod but the pod has already stopped accepting connections."`,
		},
		{
			id: 6,
			title: "Traffic Analysis During Deployment",
			type: "metrics",
			content: `\`\`\`
Error Distribution During Pod Termination:
==========================================
Total requests during 5s window: 500
  - Success (2xx): 465 (93%)
  - Connection refused: 18 (3.6%)
  - Connection reset: 12 (2.4%)
  - Timeout: 5 (1%)

Error timing analysis:
- Errors start: 0-0.5s after SIGTERM
- Error peak: 1-3s after SIGTERM
- Errors end: 5-10s after SIGTERM (iptables propagated)

Affected request types:
- New connections: Most errors (connection refused)
- Existing connections: Connection reset
- Long-running requests: Timeout or reset

Current pod lifecycle:
  preStop hook: (none configured)
  terminationGracePeriodSeconds: 30
\`\`\``,
			hint: "There's no preStop hook and errors happen in the first few seconds...",
		},
	],

	solution: {
		diagnosis: "Traffic routed to terminating pods during endpoint propagation delay",
		keywords: [
			"graceful shutdown",
			"SIGTERM",
			"preStop hook",
			"rolling update",
			"endpoint propagation",
			"connection draining",
			"zero downtime",
			"termination grace period",
		],
		rootCause: `When Kubernetes terminates a pod, two things happen in parallel:

1. **SIGTERM sent to pod** - Application receives signal to shut down
2. **Endpoint removal initiated** - Pod removed from Service endpoints

The problem: Endpoint removal is not instantaneous. It requires:
- kube-proxy to update iptables on every node
- Cloud load balancers to receive and process updates
- DNS caches to expire (for some service discovery methods)

This propagation takes 1-10 seconds. During this window:
- The pod has stopped accepting connections (it got SIGTERM)
- Traffic is still being routed to it (endpoints not yet updated)
- New requests get "connection refused" or "connection reset"

The application's immediate shutdown on SIGTERM makes this worse - it stops accepting connections before the network has stopped sending traffic.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Add preStop hook to delay shutdown until traffic drains",
				code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      containers:
      - name: api
        image: api-service:v2.5.0
        lifecycle:
          preStop:
            exec:
              # Wait for endpoints to propagate before shutdown
              # This gives kube-proxy and load balancers time to update
              command:
              - /bin/sh
              - -c
              - "sleep 15"
        # Ensure enough time for preStop + graceful shutdown
        terminationGracePeriodSeconds: 45
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5`,
			},
			{
				lang: "typescript",
				description: "Improved application shutdown with connection draining",
				code: `// server.ts - Graceful shutdown with draining
const server = express();
let isShuttingDown = false;

// Middleware to reject new requests during shutdown
server.use((req, res, next) => {
  if (isShuttingDown) {
    // Return 503 with Retry-After header
    res.set('Connection', 'close');
    res.set('Retry-After', '5');
    return res.status(503).json({
      error: 'Service shutting down',
      retry: true
    });
  }
  next();
});

// Health endpoint aware of shutdown state
server.get('/health', (req, res) => {
  if (isShuttingDown) {
    // Return unhealthy during shutdown
    return res.status(503).json({ status: 'shutting_down' });
  }
  res.status(200).json({ status: 'ok' });
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, starting graceful shutdown...');

  // Phase 1: Mark as shutting down (health checks fail)
  isShuttingDown = true;

  // Phase 2: Wait for load balancer to remove us
  // This is handled by preStop hook in Kubernetes
  // but we add buffer time here too
  console.log('Waiting for traffic to drain...');
  await sleep(5000);

  // Phase 3: Stop accepting new connections
  console.log('Stopping server...');
  server.close(() => {
    console.log('Server closed, all connections drained');
    process.exit(0);
  });

  // Phase 4: Force exit if connections don't drain
  setTimeout(() => {
    console.error('Forcing exit after timeout');
    process.exit(1);
  }, 25000);
});`,
			},
			{
				lang: "yaml",
				description: "Complete deployment with all graceful shutdown settings",
				code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0  # Never have fewer than desired pods
  template:
    metadata:
      labels:
        app: api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
      - name: api
        image: api-service:v2.5.0
        ports:
        - containerPort: 8080
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"`,
			},
			{
				lang: "yaml",
				description: "Ingress annotations for graceful shutdown (NGINX)",
				code: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    # NGINX-specific annotations for graceful handling
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "10"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
    # Retry on connection errors to next upstream
    nginx.ingress.kubernetes.io/proxy-next-upstream: "error timeout http_502 http_503"
    nginx.ingress.kubernetes.io/proxy-next-upstream-tries: "3"
spec:
  ingressClassName: nginx
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80`,
			},
		],
		prevention: [
			"Always use preStop hooks to delay SIGTERM handling (typically 10-15s)",
			"Set maxUnavailable to 0 for critical services",
			"Ensure terminationGracePeriodSeconds > preStop sleep + app shutdown time",
			"Make health endpoints return unhealthy during shutdown",
			"Return 503 with Retry-After header during shutdown",
			"Configure ingress/load balancer to retry on 502/503",
			"Test deployments with load to catch timing issues",
			"Monitor error rates during deployment windows",
		],
		educationalInsights: [
			"Kubernetes endpoint removal is eventually consistent, not instantaneous",
			"preStop hooks run BEFORE SIGTERM is sent to the container",
			"The 'sleep' in preStop is intentional - it's waiting for network updates",
			"terminationGracePeriodSeconds is the TOTAL time including preStop",
			"Zero downtime requires coordination between app, Kubernetes, and load balancer",
			"Health checks and readiness probes serve different purposes during shutdown",
			"Connection draining is the app's responsibility, not just Kubernetes'",
		],
	},
};

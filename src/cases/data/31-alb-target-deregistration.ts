import { DetectiveCase } from '../../types';

export const albTargetDeregistration: DetectiveCase = {
  id: 'alb-target-deregistration',
  title: 'The ALB Target Deregistration Delay',
  subtitle: '502 errors during deployment due to premature target removal',
  difficulty: 'mid',
  category: 'networking',

  crisis: {
    description: `
      Every deployment causes a spike in 502 Bad Gateway errors. The errors last
      for about 30-60 seconds during the rolling update. Users report failed
      transactions and lost shopping carts. The error rate correlates exactly
      with deployment timing.
    `,
    impact: `
      5-8% error rate during every deployment. User transactions failing.
      Fear of deploying during business hours. CI/CD pipeline flagged as unreliable.
    `,
    timeline: [
      { time: '10:00:00', event: 'Deployment started, rolling update begins', type: 'normal' },
      { time: '10:00:05', event: 'First old pod marked for termination', type: 'normal' },
      { time: '10:00:06', event: 'New pod passes readiness probe', type: 'normal' },
      { time: '10:00:07', event: '502 errors begin appearing', type: 'warning' },
      { time: '10:00:35', event: '502 errors peak at 15% of requests', type: 'critical' },
      { time: '10:01:00', event: '502 errors subside as deployment completes', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'New pods start successfully',
      'Health checks pass on new pods',
      'Application logs show no errors',
      'Deployment eventually completes successfully'
    ],
    broken: [
      '502 errors during rolling updates',
      'Errors occur for 30-60 seconds per pod replacement',
      'ALB access logs show "502" with target IP of terminated pod',
      'No errors outside deployment windows'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'ALB Access Logs During Deployment',
      type: 'logs',
      content: `
\`\`\`
# ALB access logs at 10:00:10 (during deployment)

type=https time=10:00:10.123 elb=app/api-alb/abc123
request="GET /api/products HTTP/1.1" target=10.0.1.45:3000
target_status=502 elb_status=502 response_time=-1
target_processing_time=-1

type=https time=10:00:10.456 elb=app/api-alb/abc123
request="POST /api/cart HTTP/1.1" target=10.0.1.45:3000
target_status=502 elb_status=502 response_time=-1
target_processing_time=-1

type=https time=10:00:10.789 elb=app/api-alb/abc123
request="GET /api/user HTTP/1.1" target=10.0.2.67:3000
target_status=200 elb_status=200 response_time=0.023

# Note: 10.0.1.45 is the OLD pod being terminated
# ALB is still sending traffic to it!
\`\`\`
      `,
      hint: 'ALB continues sending traffic to old pod IPs that are being terminated'
    },
    {
      id: 2,
      title: 'Kubernetes Deployment Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    spec:
      containers:
      - name: api
        image: api-service:latest
        ports:
        - containerPort: 3000
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 15
          periodSeconds: 10
      # Note: No terminationGracePeriodSeconds specified (default 30s)
      # Note: No preStop hook
\`\`\`
      `,
      hint: 'No preStop hook to delay termination while ALB drains connections'
    },
    {
      id: 3,
      title: 'ALB Target Group Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# AWS Target Group Settings (via Terraform)
resource "aws_lb_target_group" "api" {
  name        = "api-targets"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    timeout             = 5
  }

  deregistration_delay = 300  # 5 minutes (AWS default)

  # Annotation on K8s Service to control this
  # service.beta.kubernetes.io/aws-load-balancer-deregistration-delay-seconds
}

# QUESTION: If deregistration_delay is 300 seconds,
# why do we still get 502s?
\`\`\`
      `,
      hint: 'Deregistration delay is set, but something else terminates the pod first'
    },
    {
      id: 4,
      title: 'Pod Termination Timeline',
      type: 'metrics',
      content: `
## What SHOULD Happen (Graceful Shutdown)

1. K8s decides to terminate pod (rolling update)
2. Pod removed from Service endpoints
3. AWS Load Balancer Controller updates target group
4. ALB starts deregistration (stops NEW connections)
5. ALB waits deregistration_delay for existing connections
6. K8s sends SIGTERM to pod
7. Pod gracefully shuts down
8. Pod terminated

## What ACTUALLY Happens

1. K8s decides to terminate pod (rolling update)
2. K8s sends SIGTERM to pod IMMEDIATELY
3. Pod starts shutdown, closes connections
4. AWS Load Balancer Controller updates target group (async)
5. ALB starts deregistration BUT pod already dying
6. ALB tries to send request to dying pod -> 502!
7. Pod terminated

## Timing Issue
- SIGTERM sent at T+0
- Target deregistration starts at T+0.5s (controller latency)
- Pod closes listener at T+1s
- ALB still thinks pod is healthy until T+15s (health check interval)
- Traffic sent to dead pod for 0.5-15 seconds = 502 errors
      `,
      hint: 'SIGTERM is sent before ALB finishes deregistering the target'
    },
    {
      id: 5,
      title: 'Application Shutdown Behavior',
      type: 'code',
      content: `
\`\`\`typescript
// server.ts
import express from 'express';

const app = express();

// ... routes ...

const server = app.listen(3000, () => {
  console.log('Server listening on port 3000');
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Problem: server.close() stops accepting NEW connections immediately
// But ALB might still be sending traffic!
// We need to keep accepting (and draining) for a period
\`\`\`
      `,
      hint: 'Server closes immediately on SIGTERM before ALB stops sending traffic'
    },
    {
      id: 6,
      title: 'AWS ALB Connection Draining Docs',
      type: 'testimony',
      content: `
> "When you deregister a target, the load balancer stops sending new requests
> to the target. By default, the load balancer waits 300 seconds before
> completing the deregistration process, which allows in-flight requests
> to complete."
>
> "However, if the target becomes unhealthy or is terminated before the
> deregistration delay expires, the load balancer immediately returns
> 502 errors for pending requests."
>
> "Best Practice: Use a preStop hook in Kubernetes to delay container
> termination, giving the load balancer time to update its target list
> and drain connections."
>
> -- AWS Documentation on ELB Target Health
      `,
      hint: 'If target is terminated before deregistration completes, ALB returns 502'
    }
  ],

  solution: {
    diagnosis: 'Kubernetes terminates pods before ALB finishes draining connections, causing 502 errors for in-flight requests',

    keywords: [
      'alb', 'elb', '502', 'target deregistration', 'connection draining',
      'prestop hook', 'graceful shutdown', 'rolling update', 'sigterm',
      'deployment', 'kubernetes'
    ],

    rootCause: `
      When Kubernetes performs a rolling update, it sends SIGTERM to the old pod
      immediately. The application receives SIGTERM and stops accepting new
      connections. However, the AWS Load Balancer Controller hasn't yet updated
      the target group to remove the pod.

      The sequence of events:
      1. K8s marks pod for termination
      2. K8s sends SIGTERM to pod (T+0)
      3. Pod closes its listener (T+0.1s)
      4. AWS LB Controller updates target group (T+0.5s) - async operation
      5. ALB receives update and starts deregistration (T+1s)
      6. In the meantime (T+0 to T+1), ALB is still sending traffic
      7. Requests hit a closed port -> 502 Bad Gateway

      The deregistration_delay (300s) only matters AFTER the target is marked
      for deregistration. If the pod dies before that, pending requests get 502s.

      The fix is to delay pod termination using a preStop hook, giving the ALB
      time to stop sending new traffic before the pod actually shuts down.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Fix 1: Add preStop hook to delay termination',
        code: `# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    spec:
      terminationGracePeriodSeconds: 60  # Allow time for graceful shutdown
      containers:
      - name: api
        image: api-service:latest
        ports:
        - containerPort: 3000
        lifecycle:
          preStop:
            exec:
              # Wait for ALB to deregister and drain connections
              # This runs BEFORE SIGTERM is sent
              command: ["/bin/sh", "-c", "sleep 15"]
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

# Timeline with fix:
# T+0: K8s marks pod for termination
# T+0: preStop hook starts (sleep 15)
# T+0.5: AWS LB Controller updates target group
# T+1: ALB starts deregistration, stops sending NEW traffic
# T+1 to T+15: Existing connections drain normally
# T+15: preStop hook completes
# T+15: K8s sends SIGTERM
# T+15: Pod gracefully shuts down (no 502s!)`
      },
      {
        lang: 'typescript',
        description: 'Fix 2: Graceful shutdown with connection draining',
        code: `// server.ts - Graceful shutdown with draining
import express from 'express';
import http from 'http';

const app = express();

// Track active connections
const connections = new Set<any>();

// ... routes ...

const server = http.createServer(app);

server.on('connection', (conn) => {
  connections.add(conn);
  conn.on('close', () => connections.delete(conn));
});

server.listen(3000, () => {
  console.log('Server listening on port 3000');
});

// Graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('SIGTERM received, starting graceful shutdown...');

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });

  // 2. Return 503 for new requests (via middleware)
  // (Already handled by server.close())

  // 3. Wait for existing connections to finish (max 30s)
  const drainTimeout = setTimeout(() => {
    console.log('Drain timeout reached, forcing shutdown');
    connections.forEach(conn => conn.destroy());
    process.exit(0);
  }, 30000);

  // 4. Check periodically if all connections drained
  const checkInterval = setInterval(() => {
    console.log(\`Active connections: \${connections.size}\`);
    if (connections.size === 0) {
      console.log('All connections drained');
      clearInterval(checkInterval);
      clearTimeout(drainTimeout);
      process.exit(0);
    }
  }, 1000);
});

// Health check that returns unhealthy during shutdown
app.get('/health', (req, res) => {
  if (isShuttingDown) {
    res.status(503).json({ status: 'shutting_down' });
  } else {
    res.status(200).json({ status: 'healthy' });
  }
});`
      },
      {
        lang: 'yaml',
        description: 'Fix 3: Configure AWS Load Balancer Controller annotations',
        code: `# kubernetes/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
  annotations:
    # Use AWS Load Balancer Controller for ALB
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"

    # Deregistration delay - time ALB waits before removing target
    service.beta.kubernetes.io/aws-load-balancer-target-group-attributes: |
      deregistration_delay.timeout_seconds=30

    # Connection draining
    service.beta.kubernetes.io/aws-load-balancer-connection-draining-enabled: "true"
    service.beta.kubernetes.io/aws-load-balancer-connection-draining-timeout: "30"

spec:
  type: LoadBalancer
  selector:
    app: api-service
  ports:
  - port: 80
    targetPort: 3000

---
# Also consider using a PodDisruptionBudget
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-service-pdb
spec:
  maxUnavailable: 1  # Only terminate 1 pod at a time
  selector:
    matchLabels:
      app: api-service`
      },
      {
        lang: 'yaml',
        description: 'Fix 4: Use readiness gate for ALB target health',
        code: `# kubernetes/deployment.yaml
# Requires AWS Load Balancer Controller v2.4+
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      readinessGates:
        # Pod not ready until ALB health check passes
        - conditionType: target-health.alb.ingress.k8s.aws/api-ingress_api-tg
      containers:
      - name: api
        # ... container spec ...
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

# How it works:
# 1. New pod starts and passes readiness probe
# 2. Pod NOT considered ready yet (readiness gate)
# 3. AWS LB Controller registers pod with ALB target group
# 4. ALB health check passes
# 5. Controller sets readiness gate condition to true
# 6. Pod now considered ready
# 7. Old pod can be terminated

# This ensures traffic flows to new pod BEFORE old pod terminates
# Combined with preStop hook for belt-and-suspenders`
      }
    ],

    prevention: [
      'Always add preStop hook with sleep to allow ALB deregistration',
      'Set terminationGracePeriodSeconds longer than preStop + shutdown time',
      'Implement graceful shutdown in application with connection draining',
      'Use readiness gates to wait for ALB health check before terminating old pods',
      'Configure appropriate deregistration delay on target group',
      'Monitor 502 error rates during deployments',
      'Test deployments with load to verify zero-downtime',
      'Use PodDisruptionBudget to limit concurrent terminations'
    ],

    educationalInsights: [
      'preStop hook runs BEFORE SIGTERM, giving time for external systems to update',
      'ALB deregistration is async - pod can die before ALB stops sending traffic',
      '502 errors mean ALB tried to connect but target refused/reset connection',
      'Connection draining handles in-flight requests; deregistration stops new ones',
      'Kubernetes and AWS operate independently - explicit coordination needed',
      'Zero-downtime deployments require careful orchestration of lifecycle events'
    ]
  }
};

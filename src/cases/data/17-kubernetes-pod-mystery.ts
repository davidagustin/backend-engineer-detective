import { DetectiveCase } from '../../types';

export const kubernetesPodMystery: DetectiveCase = {
  id: 'kubernetes-pod-mystery',
  title: 'The Kubernetes Pod Mystery',
  subtitle: 'Pods keep restarting with no apparent errors',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your e-commerce platform runs on Kubernetes. After a routine deployment, the checkout service
      pods are entering a restart loop. They start, run for exactly 30 seconds, then terminate.
      Kubernetes restarts them, and the cycle continues. No crash logs, no exceptions—just silent restarts.
    `,
    impact: `
      Checkout is intermittently failing. 30% of orders are lost during pod transitions.
      Revenue impact: $50K/hour during peak traffic.
    `,
    timeline: [
      { time: '2:00 PM', event: 'Deployed checkout-service v3.4.1', type: 'normal' },
      { time: '2:01 PM', event: 'Pods enter Running state', type: 'normal' },
      { time: '2:01:30 PM', event: 'First pod restart observed', type: 'warning' },
      { time: '2:03 PM', event: 'All 5 pods cycling every 30 seconds', type: 'critical' },
      { time: '2:15 PM', event: 'Rolled back to v3.4.0 - problem persists', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Pod starts successfully and enters Running state',
      'Application logs show normal startup sequence',
      'Health check endpoint returns 200 OK',
      'No OOMKilled or Error states in pod status',
      'Other services (cart, inventory) are stable'
    ],
    broken: [
      'Pods restart exactly every 30 seconds',
      'kubectl describe shows "Liveness probe failed"',
      'Rollback to previous version did not fix it',
      'Problem started after deployment but persists after rollback'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Pod Status',
      type: 'logs',
      content: `
\`\`\`
$ kubectl get pods -l app=checkout-service
NAME                              READY   STATUS    RESTARTS   AGE
checkout-service-7d4f8b9c5-abc12  1/1     Running   47         23m
checkout-service-7d4f8b9c5-def34  1/1     Running   46         23m
checkout-service-7d4f8b9c5-ghi56  1/1     Running   47         23m

$ kubectl describe pod checkout-service-7d4f8b9c5-abc12
...
Events:
  Type     Reason     Age   Message
  ----     ------     ----  -------
  Warning  Unhealthy  30s   Liveness probe failed: HTTP probe failed with statuscode: 503
  Normal   Killing    30s   Container checkout failed liveness probe, will be restarted
\`\`\`
      `,
      hint: 'The liveness probe is failing, but the health endpoint works...'
    },
    {
      id: 2,
      title: 'Deployment Manifest Diff',
      type: 'config',
      content: `
\`\`\`diff
# deployment.yaml changes in v3.4.1
  livenessProbe:
    httpGet:
      path: /health
      port: 8080
    initialDelaySeconds: 5
-   periodSeconds: 10
+   periodSeconds: 10
    timeoutSeconds: 1
+   failureThreshold: 1

  readinessProbe:
    httpGet:
      path: /health/ready
      port: 8080
    initialDelaySeconds: 5
\`\`\`
      `,
      hint: 'A small configuration change can have big consequences...'
    },
    {
      id: 3,
      title: 'Health Endpoint Behavior',
      type: 'code',
      content: `
\`\`\`javascript
// health.controller.js
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    // Check Redis connection
    await redis.ping();
    // Check external payment API
    await paymentClient.healthCheck();

    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});
\`\`\`
      `,
      hint: 'What dependencies does the health check verify?'
    },
    {
      id: 4,
      title: 'Network Latency Metrics',
      type: 'metrics',
      content: `
## External API Latency (last hour)

| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| Database | 5ms | 12ms | 45ms |
| Redis | 1ms | 3ms | 8ms |
| Payment API (external) | 150ms | 890ms | 2100ms |

**Note:** Payment API is hosted by a third-party provider
      `,
      hint: 'Compare these latencies to a key configuration value...'
    },
    {
      id: 5,
      title: 'SRE Team Testimony',
      type: 'testimony',
      content: `
> "We added the failureThreshold change because we wanted faster detection of
> unhealthy pods. Before, it took 30 seconds to detect a dead pod. Now it's instant."
>
> "The weird thing is, when I curl the health endpoint manually from inside the pod,
> it always returns 200. But Kubernetes keeps saying it failed."
>
> — Marcus, SRE Lead
      `,
      hint: 'What\'s the difference between manual curl and Kubernetes probes?'
    },
    {
      id: 6,
      title: 'Kubernetes Probe Documentation',
      type: 'config',
      content: `
\`\`\`yaml
# Kubernetes Probe Behavior:
#
# timeoutSeconds: Number of seconds after which the probe times out.
#                 Defaults to 1 second. Minimum value is 1.
#
# failureThreshold: Minimum consecutive failures for the probe to be
#                   considered failed. Defaults to 3.
#
# A probe is considered failed if:
# - The HTTP response code is not 2xx/3xx
# - The request takes longer than timeoutSeconds
# - The connection cannot be established
\`\`\`
      `,
      hint: 'The timeout is only 1 second...'
    }
  ],

  solution: {
    diagnosis: 'Liveness probe timeout too short for external dependency check',

    keywords: [
      'liveness', 'probe', 'timeout', 'health check', 'external dependency',
      'payment api', 'latency', 'failureThreshold', 'timeoutSeconds',
      'kubernetes', 'pod restart', '503'
    ],

    rootCause: `
      The health endpoint includes a check to an external payment API that has
      P95 latency of 890ms and P99 of 2100ms. The Kubernetes liveness probe has
      a timeoutSeconds of 1 second (1000ms).

      When the payment API responds slowly (which happens ~5% of the time), the
      health check exceeds the 1-second timeout. Kubernetes marks this as a probe
      failure.

      The change that caused the issue was setting failureThreshold: 1 (default is 3).
      This means a single slow response kills the pod instantly, instead of requiring
      3 consecutive failures.

      Even though rollback removed the code changes, the deployment manifest change
      persisted because it was a separate commit that wasn't rolled back.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Problematic probe configuration',
        code: `livenessProbe:
  httpGet:
    path: /health
    port: 8080
  timeoutSeconds: 1        # Too short!
  failureThreshold: 1      # Too aggressive!`
      },
      {
        lang: 'yaml',
        description: 'Fixed probe configuration',
        code: `livenessProbe:
  httpGet:
    path: /health/live     # Separate lightweight endpoint
    port: 8080
  timeoutSeconds: 5
  failureThreshold: 3
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready    # Full dependency check
    port: 8080
  timeoutSeconds: 10
  failureThreshold: 3`
      },
      {
        lang: 'javascript',
        description: 'Separate liveness and readiness endpoints',
        code: `// Liveness: "Is the process alive?" (fast, no dependencies)
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Readiness: "Can this pod handle traffic?" (full checks)
app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    await redis.ping();
    await paymentClient.healthCheck();
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});`
      }
    ],

    prevention: [
      'Separate liveness probes (is the process alive?) from readiness probes (can it handle traffic?)',
      'Never include external dependencies in liveness probes',
      'Set timeoutSeconds higher than P99 latency of checked dependencies',
      'Use failureThreshold >= 3 to handle transient failures',
      'Include deployment manifests in rollback procedures',
      'Monitor probe failure rates as a key metric'
    ],

    educationalInsights: [
      'Liveness probes answer "should Kubernetes restart this pod?" - they should be fast and dependency-free',
      'Readiness probes answer "should Kubernetes send traffic here?" - they can check dependencies',
      'A failed liveness probe kills the pod; a failed readiness probe just removes it from the Service',
      'Configuration changes in Kubernetes manifests often survive application rollbacks',
      'P99 latency matters more than P50 for timeout configuration'
    ]
  }
};

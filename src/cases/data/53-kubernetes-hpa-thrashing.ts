import type { DetectiveCase } from '../../types';

export const kubernetesHpaThrashing: DetectiveCase = {
  id: 'kubernetes-hpa-thrashing',
  title: 'The HPA Thrashing Terror',
  subtitle: 'Pods scale up and down every 30 seconds in an endless dance',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `Your microservices platform uses Kubernetes Horizontal Pod Autoscaler (HPA) to handle variable load. After a recent metrics server upgrade, the payment service is experiencing constant scaling events - scaling from 3 to 10 pods, then back to 3, then up again, in a never-ending cycle. Each scaling event causes brief service disruptions.`,
    impact: `Payment processing latency spikes during scale events. 5% of transactions timing out. Customer complaints about checkout failures increasing. DevOps team getting paged every 2 minutes.`,
    timeline: [
      { time: '10:00 AM', event: 'Metrics server upgrade completed', type: 'normal' },
      { time: '10:05 AM', event: 'HPA scales payment-service to 8 pods', type: 'warning' },
      { time: '10:06 AM', event: 'HPA scales payment-service down to 3 pods', type: 'warning' },
      { time: '10:07 AM', event: 'HPA scales payment-service to 10 pods', type: 'critical' },
      { time: '10:08 AM', event: 'Continuous scale up/down cycle begins', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Individual pod health checks pass',
      'Application code functions correctly',
      'Database connections stable',
      'Manual kubectl scale works fine',
      'Metrics server returns values'
    ],
    broken: [
      'HPA scales up aggressively then immediately down',
      'Scale events happening every 30-60 seconds',
      'Reported CPU utilization swings wildly (20% to 90%)',
      'New pods terminated before fully warm',
      'Service latency spikes during transitions'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'HPA Status',
      type: 'logs',
      content: `\`\`\`
$ kubectl get hpa payment-service -w
NAME              REFERENCE                    TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
payment-service   Deployment/payment-service   92%/50%   3         10        3          5m
payment-service   Deployment/payment-service   92%/50%   3         10        8          5m30s
payment-service   Deployment/payment-service   23%/50%   3         10        8          6m
payment-service   Deployment/payment-service   23%/50%   3         10        3          6m30s
payment-service   Deployment/payment-service   87%/50%   3         10        3          7m
payment-service   Deployment/payment-service   87%/50%   3         10        9          7m30s

$ kubectl describe hpa payment-service
Events:
  Type    Reason             Age   Message
  ----    ------             ----  -------
  Normal  SuccessfulRescale  30s   New size: 9; reason: cpu utilization above target
  Normal  SuccessfulRescale  60s   New size: 3; reason: cpu utilization below target
  Normal  SuccessfulRescale  90s   New size: 8; reason: cpu utilization above target
\`\`\``,
      hint: 'The CPU readings are swinging between extremes very quickly...'
    },
    {
      id: 2,
      title: 'HPA Configuration',
      type: 'config',
      content: `\`\`\`yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  # Note: Using defaults for scaling behavior
\`\`\``,
      hint: 'What happens when you rely on default scaling behavior?'
    },
    {
      id: 3,
      title: 'Metrics Server Query',
      type: 'metrics',
      content: `\`\`\`
$ kubectl top pods -l app=payment-service
NAME                              CPU(cores)   MEMORY(bytes)
payment-service-7d4f8-abc12       450m         256Mi
payment-service-7d4f8-def34       480m         248Mi
payment-service-7d4f8-ghi56       420m         251Mi

# 30 seconds later:
$ kubectl top pods -l app=payment-service
NAME                              CPU(cores)   MEMORY(bytes)
payment-service-7d4f8-abc12       125m         256Mi
payment-service-7d4f8-def34       130m         248Mi
payment-service-7d4f8-ghi56       118m         251Mi

# Pod resource requests:
resources:
  requests:
    cpu: 500m
    memory: 256Mi
\`\`\``,
      hint: 'The CPU values change dramatically in just 30 seconds...'
    },
    {
      id: 4,
      title: 'Application Metrics',
      type: 'code',
      content: `\`\`\`typescript
// payment-service/src/health.ts
import { Registry, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

// Batch payment processing runs every 30 seconds
setInterval(async () => {
  const pendingPayments = await getPendingPayments();

  // CPU-intensive validation and processing
  for (const payment of pendingPayments) {
    await validatePayment(payment);  // Heavy crypto operations
    await processPayment(payment);
    await updateLedger(payment);
  }
}, 30000);

// Real-time payment endpoint (handles ~100 req/s)
app.post('/api/payment', async (req, res) => {
  // Lightweight operation - just queues the payment
  await queuePayment(req.body);
  res.json({ status: 'queued' });
});
\`\`\``,
      hint: 'Notice the batch processing pattern and its interval...'
    },
    {
      id: 5,
      title: 'SRE Investigation',
      type: 'testimony',
      content: `"I graphed the CPU over time and it looks like a sawtooth wave - spikes every 30 seconds then drops. The HPA is reacting to these spikes instantly. Before the metrics server upgrade, it seemed more... stable? The old version had some config we didn't migrate."

"Also weird - when we had 8 pods, the per-pod CPU dropped immediately because the batch job on each pod had less work. Then HPA saw low CPU and scaled down. Then each remaining pod had more batch work, CPU spiked, and we scaled up again."`,
      hint: 'The batch processing distributes work across pods...'
    },
    {
      id: 6,
      title: 'Metrics Server Changelog',
      type: 'config',
      content: `\`\`\`markdown
# Metrics Server v0.6.0 -> v0.7.0 Changelog

## Breaking Changes
- Default metric resolution changed from 60s to 15s
- Removed deprecated --metric-resolution flag
- HPA now receives more frequent metric updates

## Migration Notes
- HPA behavior policies should be explicitly configured
- Consider adding stabilization windows to prevent thrashing
- scaleDown.stabilizationWindowSeconds default changed from 300s to 0s
\`\`\``,
      hint: 'The defaults changed significantly between versions...'
    }
  ],

  solution: {
    diagnosis: 'HPA thrashing due to bursty workload combined with aggressive scaling defaults',
    keywords: [
      'hpa', 'thrashing', 'horizontal pod autoscaler', 'scaling', 'stabilization window',
      'scale down', 'scale up', 'metrics', 'cpu spike', 'batch processing',
      'autoscaling behavior', 'cooldown'
    ],
    rootCause: `The payment service has a bursty CPU pattern due to batch processing every 30 seconds. When the batch runs, CPU spikes; when it completes, CPU drops.

After the metrics server upgrade, two critical changes occurred:
1. Metric resolution decreased from 60s to 15s, so HPA sees the spikes more clearly
2. The scaleDown stabilizationWindowSeconds default changed from 300s to 0s

Without a stabilization window, HPA reacts to every CPU fluctuation immediately. It scales up when it sees the batch spike, but by the time new pods are ready, the batch has completed and CPU is low. HPA then scales down. The remaining pods get more batch work, spike again, and the cycle repeats.

Additionally, the batch workload is distributed across pods, so adding pods reduces per-pod work (and CPU) while removing pods increases it - creating a feedback loop.`,
    codeExamples: [
      {
        lang: 'yaml',
        description: 'Fixed HPA with stabilization windows and scaling policies',
        code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60  # Scale down max 10% per minute
    scaleUp:
      stabilizationWindowSeconds: 60   # Wait 1 min before scaling up
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60  # Scale up max 50% per minute
      - type: Pods
        value: 2
        periodSeconds: 60  # Or max 2 pods per minute`
      },
      {
        lang: 'typescript',
        description: 'Smoothed batch processing to reduce CPU spikes',
        code: `// Instead of processing all at once, spread the work
class BatchProcessor {
  private processingInterval = 30000; // 30 seconds total
  private batchSize = 10;

  async start() {
    setInterval(async () => {
      const pendingPayments = await getPendingPayments();

      // Process in small chunks spread over time
      const chunks = this.chunkArray(pendingPayments, this.batchSize);
      const delayBetweenChunks = this.processingInterval / (chunks.length + 1);

      for (const chunk of chunks) {
        await Promise.all(chunk.map(p => this.processPayment(p)));
        await this.sleep(delayBetweenChunks);
      }
    }, this.processingInterval);
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) },
      (_, i) => arr.slice(i * size, i * size + size));
  }
}`
      }
    ],
    prevention: [
      'Always explicitly configure HPA behavior policies - never rely on defaults',
      'Use stabilization windows appropriate for your workload patterns',
      'Test autoscaling behavior in staging with production-like traffic patterns',
      'Consider using custom metrics instead of CPU for bursty workloads',
      'Smooth out batch processing to avoid CPU spikes',
      'Monitor HPA events and set alerts for rapid scaling cycles'
    ],
    educationalInsights: [
      'HPA stabilization windows prevent thrashing by requiring sustained metric values before scaling',
      'Batch processing creates bursty CPU patterns that confuse simple CPU-based autoscaling',
      'When workload distributes across pods, scaling changes the per-pod load - creating feedback loops',
      'Metrics server configuration changes can dramatically affect HPA behavior',
      'Scale-up and scale-down should have different policies - scaling up is usually more urgent'
    ]
  }
};

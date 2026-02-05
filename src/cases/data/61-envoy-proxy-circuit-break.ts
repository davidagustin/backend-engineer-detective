import type { DetectiveCase } from '../../types';

export const envoyProxyCircuitBreak: DetectiveCase = {
  id: 'envoy-proxy-circuit-break',
  title: 'The Circuit Breaker Conundrum',
  subtitle: 'Requests failing with 503s despite healthy backends',
  difficulty: 'senior',
  category: 'networking',

  crisis: {
    description: `Your API gateway using Envoy proxy is returning 503 errors for about 30% of requests. All backend services show healthy, CPU and memory are fine, and the backends can handle the load. But Envoy keeps returning "no healthy upstream" or "upstream overflow" errors.`,
    impact: `30% of API requests failing with 503 errors. Customer-facing degradation during peak traffic. Backend services are healthy but not receiving traffic.`,
    timeline: [
      { time: '2:00 PM', event: 'Traffic ramp-up for daily peak begins', type: 'normal' },
      { time: '2:15 PM', event: '503 errors start appearing in logs', type: 'warning' },
      { time: '2:20 PM', event: '30% of requests returning 503', type: 'critical' },
      { time: '2:30 PM', event: 'Backend services verified healthy, low CPU', type: 'warning' },
      { time: '2:45 PM', event: 'Error rate persists despite healthy backends', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Backend services responding to direct requests',
      'Backend health checks passing',
      'CPU and memory on backends well below limits',
      'Database connections healthy',
      'Some requests through Envoy succeed'
    ],
    broken: [
      '30% of requests getting 503 Service Unavailable',
      'Envoy logs show "upstream overflow" and "no healthy upstream"',
      'Response flags show "UO" (upstream overflow)',
      'Pending request queue filling up',
      'Pattern correlates with traffic spikes'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Envoy Access Logs',
      type: 'logs',
      content: `\`\`\`
# Envoy access logs during incident
[2024-03-15T14:20:15.123Z] "POST /api/orders HTTP/1.1" 503 UO 0 91 0 -
  "upstream_reset_before_response_started{overflow}"
[2024-03-15T14:20:15.124Z] "GET /api/products HTTP/1.1" 200 - 0 1523 45 43
  "upstream_rq_200"
[2024-03-15T14:20:15.125Z] "POST /api/orders HTTP/1.1" 503 UO 0 91 0 -
  "upstream_reset_before_response_started{overflow}"
[2024-03-15T14:20:15.126Z] "POST /api/orders HTTP/1.1" 503 UO 0 91 0 -
  "upstream_reset_before_response_started{overflow}"

# Response flags reference:
# UO = upstream overflow (circuit breaker triggered)
# NR = no healthy upstream
\`\`\``,
      hint: 'UO means upstream overflow - circuit breaker related...'
    },
    {
      id: 2,
      title: 'Envoy Cluster Configuration',
      type: 'config',
      content: `\`\`\`yaml
# Envoy cluster config for orders-service
clusters:
- name: orders-service
  type: STRICT_DNS
  lb_policy: ROUND_ROBIN
  connect_timeout: 5s

  # Circuit breaker settings
  circuit_breakers:
    thresholds:
    - priority: DEFAULT
      max_connections: 100
      max_pending_requests: 100
      max_requests: 1000
      max_retries: 3

  health_checks:
  - timeout: 5s
    interval: 10s
    healthy_threshold: 2
    unhealthy_threshold: 3
    http_health_check:
      path: /health

  load_assignment:
    cluster_name: orders-service
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: orders-service.default.svc.cluster.local
              port_value: 8080
\`\`\``,
      hint: 'Check the circuit breaker threshold values...'
    },
    {
      id: 3,
      title: 'Envoy Stats',
      type: 'metrics',
      content: `\`\`\`
$ curl localhost:15000/stats | grep orders-service | grep -E "(pending|overflow|cx_)"

cluster.orders-service.upstream_cx_active: 100
cluster.orders-service.upstream_cx_total: 45678
cluster.orders-service.upstream_rq_pending_active: 100
cluster.orders-service.upstream_rq_pending_total: 12456
cluster.orders-service.upstream_rq_pending_overflow: 8934
cluster.orders-service.circuit_breakers.default.cx_open: 1
cluster.orders-service.circuit_breakers.default.rq_pending_open: 1

# Breaking down the stats:
# upstream_cx_active: 100       <- AT MAX_CONNECTIONS LIMIT!
# upstream_rq_pending_active: 100  <- AT MAX_PENDING_REQUESTS LIMIT!
# upstream_rq_pending_overflow: 8934  <- Requests rejected due to overflow
\`\`\``,
      hint: 'The active connections and pending requests are at their limits...'
    },
    {
      id: 4,
      title: 'Backend Service Performance',
      type: 'metrics',
      content: `\`\`\`
# Orders service metrics
Endpoint: POST /api/orders
Request rate: 500 req/s
P50 latency: 150ms
P95 latency: 450ms
P99 latency: 2500ms  # <-- Note the long tail

# Connection handling
Active connections to orders-service: 100 (from Envoy)
Connection pool on orders-service: max 200
Current requests in flight: 85

# Pod resources (5 pods)
CPU: 45% average (limit: 2 cores)
Memory: 60% average (limit: 2GB)
\`\`\``,
      hint: 'The P99 latency is very high compared to P50...'
    },
    {
      id: 5,
      title: 'SRE Analysis',
      type: 'testimony',
      content: `"The circuit breaker is doing its job - it's preventing cascading failures. But I think our limits are too low for the current traffic pattern."

"Here's the math: We have 500 req/s coming in. With P99 latency of 2.5s, during a traffic spike we can have up to 500 * 2.5 = 1,250 concurrent requests in flight. But our max_requests is only 1,000, and max_connections is 100."

"The real problem might be those P99 requests taking 2.5 seconds. A few slow requests are consuming connections for a long time, starving other requests."`,
      hint: 'Calculate the required connections based on request rate and latency...'
    },
    {
      id: 6,
      title: 'Slow Request Analysis',
      type: 'logs',
      content: `\`\`\`
# Slow request trace
[orders-service] Processing order for user_id=12345
[orders-service] Fetching user profile... 45ms
[orders-service] Validating inventory... 60ms
[orders-service] Processing payment...
[payment-service] Connecting to payment gateway...
[payment-service] Gateway response time: 2100ms  # <-- SLOW!
[orders-service] Payment processed: 2150ms
[orders-service] Total request time: 2312ms

# This happens for ~1% of requests when the external payment
# gateway is slow. These requests hold connections open.
\`\`\``,
      hint: 'External dependency latency is causing connection starvation...'
    }
  ],

  solution: {
    diagnosis: 'Circuit breaker tripping due to undersized connection limits combined with long-tail latency',
    keywords: [
      'envoy', 'circuit breaker', 'upstream overflow', '503', 'max connections',
      'max pending requests', 'connection pool', 'latency', 'p99', 'tail latency'
    ],
    rootCause: `The Envoy circuit breaker is configured with limits (max_connections: 100, max_pending_requests: 100, max_requests: 1000) that are too low for the traffic pattern.

With 500 requests/second and P99 latency of 2.5 seconds, during peak traffic periods the system can have approximately 1,250 requests in flight (Little's Law: L = lambda * W). The max_requests limit of 1,000 is exceeded, causing overflow.

Additionally, the max_connections limit of 100 is reached because long-tail requests (P99 at 2.5s caused by slow payment gateway responses) hold connections open for extended periods. With 100 connections and slow requests occupying them, new requests queue up in pending_requests. When that queue (limit: 100) is also full, Envoy returns 503 with the UO (upstream overflow) flag.

The circuit breaker is working as designed - protecting the system from overload. But the limits don't match the actual traffic pattern and latency characteristics.`,
    codeExamples: [
      {
        lang: 'yaml',
        description: 'Adjusted circuit breaker limits',
        code: `clusters:
- name: orders-service
  type: STRICT_DNS
  lb_policy: ROUND_ROBIN
  connect_timeout: 5s

  circuit_breakers:
    thresholds:
    - priority: DEFAULT
      # Increase based on: requests/s * P99_latency * safety_margin
      # 500 req/s * 2.5s * 1.5 = 1875, round up to 2000
      max_connections: 500        # was 100
      max_pending_requests: 500   # was 100
      max_requests: 2000          # was 1000
      max_retries: 10             # was 3

    - priority: HIGH
      # More generous limits for high-priority traffic
      max_connections: 200
      max_pending_requests: 200
      max_requests: 1000
      max_retries: 5`
      },
      {
        lang: 'yaml',
        description: 'Add request timeout and retry policy',
        code: `# Envoy route config with timeouts
routes:
- match:
    prefix: "/api/orders"
  route:
    cluster: orders-service
    timeout: 10s  # Overall request timeout
    retry_policy:
      retry_on: "5xx,reset,connect-failure,retriable-4xx"
      num_retries: 2
      per_try_timeout: 3s  # Fail fast on slow requests
      retry_back_off:
        base_interval: 100ms
        max_interval: 1s

# Outlier detection to eject slow endpoints
clusters:
- name: orders-service
  outlier_detection:
    consecutive_5xx: 5
    interval: 10s
    base_ejection_time: 30s
    max_ejection_percent: 50
    consecutive_gateway_failure: 5
    enforcing_consecutive_5xx: 100`
      },
      {
        lang: 'typescript',
        description: 'Backend: Add timeout to external payment calls',
        code: `// orders-service: Add timeout to payment gateway calls
async function processPayment(order: Order): Promise<PaymentResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout

  try {
    const response = await fetch(paymentGatewayUrl, {
      method: 'POST',
      body: JSON.stringify(order.payment),
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });

    clearTimeout(timeoutId);
    return response.json();

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      // Timeout - return pending status, process async
      await queuePaymentForRetry(order);
      return { status: 'pending', message: 'Payment processing async' };
    }
    throw error;
  }
}`
      }
    ],
    prevention: [
      'Size circuit breaker limits based on Little\'s Law: L = lambda * W (requests = rate * latency)',
      'Monitor P99 latency and adjust limits when latency patterns change',
      'Set aggressive timeouts for external dependencies to bound tail latency',
      'Use outlier detection to eject slow endpoints automatically',
      'Monitor circuit breaker stats (cx_open, rq_pending_overflow) and alert',
      'Consider request hedging for latency-sensitive paths'
    ],
    educationalInsights: [
      'Circuit breakers protect against cascading failures but need proper tuning',
      'Long-tail latency (P99) is often more important than average latency for capacity planning',
      'Little\'s Law relates concurrency, throughput, and latency - essential for sizing',
      'External dependencies are often the source of tail latency - add timeouts!',
      'UO (upstream overflow) in Envoy logs indicates circuit breaker activation'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const prometheusCardinalityExplosion: DetectiveCase = {
  id: 'prometheus-cardinality-explosion',
  title: 'The Prometheus Cardinality Explosion',
  subtitle: 'Prometheus OOM crashes every few hours with no apparent cause',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your monitoring stack keeps dying. Prometheus restarts every 2-4 hours due to OOM kills.
      When it's down, you have zero visibility into your production systems. The alerts stop firing,
      dashboards show gaps, and the on-call team is flying blind. Memory usage grows steadily
      until the kernel kills the process.
    `,
    impact: `
      Complete monitoring blindness during outages. Two production incidents went undetected
      for 45 minutes. SRE team spending 50% of time babysitting Prometheus instead of actual work.
      Compliance audit flagged monitoring gaps.
    `,
    timeline: [
      { time: '6:00 AM', event: 'Prometheus restart after OOM kill', type: 'critical' },
      { time: '6:05 AM', event: 'Memory at 4GB, growing steadily', type: 'normal' },
      { time: '8:00 AM', event: 'Memory at 12GB', type: 'warning' },
      { time: '9:30 AM', event: 'Memory at 24GB, swap thrashing', type: 'warning' },
      { time: '10:15 AM', event: 'OOM killed again, 4 hours uptime', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Basic metrics collection functions',
      'PromQL queries return results',
      'Scrape targets are reachable',
      'Alert rules syntax is valid'
    ],
    broken: [
      'Memory grows unbounded over time',
      'Prometheus crashes every 2-4 hours',
      'Query performance degrades before crash',
      'Compaction jobs never complete'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Prometheus TSDB Stats',
      type: 'metrics',
      content: `
\`\`\`
# Prometheus TSDB Statistics
prometheus_tsdb_head_series: 8,247,531
prometheus_tsdb_head_chunks: 24,742,593
prometheus_tsdb_head_samples_appended_total: 892,451,223

# Memory breakdown
prometheus_tsdb_head_chunks_storage_size_bytes: 18,432,000,000  # 18GB
process_resident_memory_bytes: 26,843,545,600  # 25GB

# Historical comparison (from backup)
# Last week: prometheus_tsdb_head_series: 847,231
# Today: prometheus_tsdb_head_series: 8,247,531
# 10x increase in active series!
\`\`\`
      `,
      hint: 'The number of time series exploded 10x in one week'
    },
    {
      id: 2,
      title: 'Top Metrics by Cardinality',
      type: 'logs',
      content: `
\`\`\`
# Query: topk(10, count by (__name__)({__name__=~".+"}))

http_request_duration_seconds_bucket: 4,231,847  # <-- RED FLAG
http_requests_total: 2,847,293
api_response_time_histogram_bucket: 892,451
user_session_active: 127,893
database_query_duration_bucket: 89,234
...

# Investigating http_request_duration_seconds_bucket labels:
# Labels: {method, path, status, user_id, request_id, trace_id}

# Sample label values for 'path':
# /api/users/u_8f3a2b1c
# /api/users/u_9d4e5f6g
# /api/orders/ord_abc123
# ... (millions of unique values)
\`\`\`
      `,
      hint: 'Look at the labels on the highest cardinality metric'
    },
    {
      id: 3,
      title: 'Application Metrics Code',
      type: 'code',
      content: `
\`\`\`go
// metrics.go - Instrumentation middleware
var httpDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name: "http_request_duration_seconds",
        Help: "HTTP request duration in seconds",
        Buckets: prometheus.DefBuckets,
    },
    []string{"method", "path", "status", "user_id", "request_id", "trace_id"},
)

func MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()

        // Wrap response writer to capture status
        wrapped := wrapResponseWriter(w)
        next.ServeHTTP(wrapped, r)

        duration := time.Since(start).Seconds()

        // Record metric with all context for debugging
        httpDuration.WithLabelValues(
            r.Method,
            r.URL.Path,           // Full path including IDs
            strconv.Itoa(wrapped.Status()),
            r.Header.Get("X-User-ID"),
            r.Header.Get("X-Request-ID"),
            r.Header.Get("X-Trace-ID"),
        ).Observe(duration)
    })
}
\`\`\`
      `,
      hint: 'Each unique combination of labels creates a new time series'
    },
    {
      id: 4,
      title: 'Traffic Analysis',
      type: 'metrics',
      content: `
\`\`\`
# Request patterns (from access logs)
Unique users per day: 127,000
Unique request IDs per day: 45,000,000
Unique trace IDs per day: 45,000,000
Unique API paths (with IDs): 892,000

# Cardinality calculation:
# methods (5) × paths (892,000) × statuses (10) × users (127,000)
#   × request_ids (45M) × trace_ids (45M)
# = Effectively unbounded cardinality

# Each histogram has 11 buckets + sum + count = 13 series per combination
# Real cardinality grows every minute as new IDs are generated
\`\`\`
      `,
      hint: 'Request ID and trace ID are unique per request - infinite cardinality'
    },
    {
      id: 5,
      title: 'Developer Testimony',
      type: 'testimony',
      content: `
> "We added user_id, request_id, and trace_id to our metrics last week to help with
> debugging. When there's an alert, we wanted to be able to correlate directly to
> specific requests and traces. It seemed like the observability best practice."
>
> "Memory has been growing since then, but we assumed it was just more traffic.
> We have 10x more users than last month, so 10x more memory seemed reasonable."
>
> — Backend Team Lead
      `,
      hint: 'The labels were added last week - when memory problems started'
    },
    {
      id: 6,
      title: 'Prometheus Cardinality Documentation',
      type: 'config',
      content: `
\`\`\`markdown
# Prometheus Cardinality Best Practices

## The Cardinality Problem

Every unique combination of label values creates a new time series.
Prometheus keeps all active series in memory.

HIGH CARDINALITY LABELS (AVOID):
- User IDs, session IDs, request IDs
- Trace IDs, span IDs
- Timestamps, random values
- Full URLs with path parameters
- IP addresses, email addresses

SAFE LABELS:
- HTTP methods (GET, POST, PUT, DELETE)
- Status code classes (2xx, 4xx, 5xx)
- Service names, endpoint names
- Boolean flags
- Small enums

## Memory Formula
memory ≈ num_series × bytes_per_series × retention_multiplier
memory ≈ 8M series × 3KB × 1.5 ≈ 36GB

## Solutions
1. Remove high-cardinality labels from metrics
2. Use exemplars for trace correlation (not labels)
3. Aggregate paths: /api/users/{id} not /api/users/u_123
4. Set metric_relabel_configs to drop problematic labels
\`\`\`
      `,
      hint: 'Request ID and trace ID are explicitly listed as labels to avoid'
    }
  ],

  solution: {
    diagnosis: 'High-cardinality labels (user_id, request_id, trace_id) on metrics causing unbounded time series growth',

    keywords: [
      'cardinality', 'high cardinality', 'labels', 'time series', 'explosion',
      'user_id', 'request_id', 'trace_id', 'OOM', 'memory', 'prometheus',
      'unbounded', 'metrics', 'histogram'
    ],

    rootCause: `
      The development team added high-cardinality labels (user_id, request_id, trace_id)
      to HTTP request duration metrics for debugging purposes. This seemed helpful for
      correlating alerts to specific requests.

      The problem: Prometheus creates a unique time series for every unique combination
      of label values. With histograms, each combination creates 13 series (11 buckets
      + sum + count).

      The math is devastating:
      - 45 million unique request_ids per day
      - Each creates at least 13 time series
      - All kept in memory for the retention period
      - Memory grows unboundedly until OOM

      The 10x increase in head_series (847K to 8.2M) directly correlates with when
      these labels were added. The memory isn't growing because of more traffic -
      it's growing because every single request creates new time series that never
      get cleaned up during the retention window.
    `,

    codeExamples: [
      {
        lang: 'go',
        description: 'Problematic: High-cardinality labels',
        code: `var httpDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name: "http_request_duration_seconds",
    },
    // BAD: These labels have millions of unique values
    []string{"method", "path", "status", "user_id", "request_id", "trace_id"},
)`
      },
      {
        lang: 'go',
        description: 'Fixed: Low-cardinality labels only',
        code: `var httpDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name:    "http_request_duration_seconds",
        Help:    "HTTP request duration in seconds",
        Buckets: prometheus.DefBuckets,
    },
    // GOOD: Only labels with bounded, small cardinality
    []string{"method", "endpoint", "status_class"},
)

func MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        wrapped := wrapResponseWriter(w)
        next.ServeHTTP(wrapped, r)

        duration := time.Since(start).Seconds()

        httpDuration.WithLabelValues(
            r.Method,
            normalizeEndpoint(r.URL.Path),  // /api/users/{id} not /api/users/u_123
            statusClass(wrapped.Status()),   // "2xx" not "200"
        ).Observe(duration)
    })
}

func normalizeEndpoint(path string) string {
    // Replace dynamic segments with placeholders
    // /api/users/u_abc123 -> /api/users/{id}
    // /api/orders/ord_xyz789/items/123 -> /api/orders/{id}/items/{id}
    patterns := []struct{ regex, replacement string }{
        {"/users/[^/]+", "/users/{id}"},
        {"/orders/[^/]+", "/orders/{id}"},
        {"/items/[^/]+", "/items/{id}"},
    }
    result := path
    for _, p := range patterns {
        result = regexp.MustCompile(p.regex).ReplaceAllString(result, p.replacement)
    }
    return result
}

func statusClass(status int) string {
    return fmt.Sprintf("%dxx", status/100)
}`
      },
      {
        lang: 'go',
        description: 'Better: Use exemplars for trace correlation',
        code: `import "github.com/prometheus/client_golang/prometheus/promhttp"

// Exemplars let you attach trace IDs to individual samples
// without creating new time series
func MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        wrapped := wrapResponseWriter(w)
        next.ServeHTTP(wrapped, r)

        duration := time.Since(start).Seconds()

        // Use exemplars for high-cardinality correlation data
        httpDuration.WithLabelValues(
            r.Method,
            normalizeEndpoint(r.URL.Path),
            statusClass(wrapped.Status()),
        ).(prometheus.ExemplarObserver).ObserveWithExemplar(
            duration,
            prometheus.Labels{
                "trace_id": r.Header.Get("X-Trace-ID"),
                // Exemplars are stored separately, don't affect cardinality
            },
        )
    })
}`
      },
      {
        lang: 'yaml',
        description: 'Emergency fix: Drop high-cardinality labels via relabeling',
        code: `# prometheus.yml - metric_relabel_configs
scrape_configs:
  - job_name: 'api-servers'
    static_configs:
      - targets: ['api-1:9090', 'api-2:9090']
    metric_relabel_configs:
      # Drop high-cardinality labels at scrape time
      - source_labels: [__name__]
        regex: 'http_request_duration_seconds.*'
        action: labeldrop
        regex: 'user_id|request_id|trace_id'`
      }
    ],

    prevention: [
      'Establish cardinality budgets per metric (e.g., max 10,000 series)',
      'Code review all metric label additions for cardinality impact',
      'Use static analysis tools to detect high-cardinality patterns',
      'Set up alerts on prometheus_tsdb_head_series growth rate',
      'Use exemplars for trace/request correlation, not labels',
      'Normalize URL paths to remove dynamic segments',
      'Implement metric_relabel_configs as a safety net'
    ],

    educationalInsights: [
      'Cardinality is the product of all unique label value combinations',
      'Histograms multiply cardinality by bucket count (typically 11-15x)',
      'High-cardinality labels turn metrics into expensive logs',
      'Exemplars provide trace correlation without cardinality cost',
      'The "more context is better" instinct is wrong for metrics',
      'Memory grows with cardinality, not with request volume'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const grafanaDashboardTimeout: DetectiveCase = {
  id: 'grafana-dashboard-timeout',
  title: 'The Grafana Dashboard Timeout',
  subtitle: 'Dashboards not loading due to expensive queries',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your Grafana dashboards are timing out. The main operations dashboard that everyone
      relies on takes 2 minutes to load - when it loads at all. During incidents, the team
      stares at spinning wheels instead of metrics. Some panels never load. The irony:
      you can't monitor the outage because your monitoring dashboard is down.
    `,
    impact: `
      Operations team blind during incidents. MTTR increased 40% due to slow observability.
      Leadership losing confidence in monitoring investment. Engineers creating ad-hoc queries
      instead of using dashboards, duplicating effort.
    `,
    timeline: [
      { time: 'Week 1', event: 'Dashboard loads in 5 seconds (normal)', type: 'normal' },
      { time: 'Week 8', event: 'Dashboard taking 30 seconds', type: 'warning' },
      { time: 'Week 16', event: 'Dashboard taking 90 seconds, some panels timeout', type: 'warning' },
      { time: 'Week 20', event: 'Dashboard unusable - 2+ minute load time', type: 'critical' },
      { time: 'Incident day', event: 'Cannot view metrics during production outage', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Grafana UI loads',
      'Simple queries work quickly',
      'Data exists in Prometheus',
      'Individual metric queries return data'
    ],
    broken: [
      'Main dashboard takes 2+ minutes to load',
      'Some panels permanently show "loading"',
      'Dashboard causes Prometheus CPU spike',
      'Queries timeout before returning'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Prometheus Query Performance',
      type: 'metrics',
      content: `
\`\`\`
# Prometheus query stats when dashboard loads

Query 1: sum(rate(http_requests_total[5m])) by (service)
         Duration: 0.8s, Samples: 45,000

Query 2: histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le, service, endpoint))
         Duration: 12.3s, Samples: 2,340,000

Query 3: topk(10, sum by (endpoint) (rate(http_requests_total[24h])))
         Duration: 45.2s, Samples: 89,000,000

Query 4: avg_over_time(container_memory_usage_bytes[7d])
         Duration: 67.8s, Samples: 156,000,000

# Total dashboard load queries: 24
# Queries > 10s: 8
# Queries > 30s: 4
# Prometheus CPU during load: 98%
\`\`\`
      `,
      hint: 'Look at the sample counts and time ranges - some queries scan millions of samples'
    },
    {
      id: 2,
      title: 'Dashboard Panel Configurations',
      type: 'config',
      content: `
\`\`\`json
// Panel 1: "Top Endpoints" - runs topk over 24 hours
{
  "title": "Top 10 Endpoints by Traffic",
  "type": "table",
  "targets": [{
    "expr": "topk(10, sum by (endpoint) (rate(http_requests_total[24h])))",
    "interval": ""  // Uses dashboard interval, but ignores it for topk
  }]
}

// Panel 2: "Weekly Memory Trend" - averages over 7 days
{
  "title": "Memory Usage Trend",
  "type": "graph",
  "targets": [{
    "expr": "avg_over_time(container_memory_usage_bytes[7d])",
    "interval": "1m"
  }]
}

// Panel 3: "P99 Latency by Endpoint" - histogram with high cardinality
{
  "title": "P99 Latency by Service/Endpoint",
  "type": "graph",
  "targets": [{
    "expr": "histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le, service, endpoint))",
    "interval": ""
  }],
  "legendFormat": "{{service}}/{{endpoint}}"  // Creates 500+ legend entries
}
\`\`\`
      `,
      hint: 'Long time ranges (24h, 7d) and high-cardinality groupings are expensive'
    },
    {
      id: 3,
      title: 'Prometheus TSDB Stats',
      type: 'logs',
      content: `
\`\`\`bash
$ curl localhost:9090/api/v1/status/tsdb

{
  "headStats": {
    "numSeries": 2847234,
    "numLabelPairs": 5234567,
    "chunkCount": 8541702,
    "minTime": 1705276800000,
    "maxTime": 1705881600000
  },
  "seriesCountByMetricName": [
    {"name": "http_duration_bucket", "value": 892345},
    {"name": "http_requests_total", "value": 234567},
    {"name": "container_memory_usage_bytes", "value": 156789}
  ]
}

# http_duration_bucket has 892K time series
# This is a histogram with many label combinations
# (service × endpoint × method × status × le_bucket)

# When you query it:
# - 5m range at 15s scrape interval = 20 samples per series
# - 892K series × 20 samples = 17.8M samples for 5 minute range
# - 24h range = ~570M samples!
\`\`\`
      `,
      hint: 'Histograms create many series - each adds to query cost'
    },
    {
      id: 4,
      title: 'Dashboard Evolution History',
      type: 'testimony',
      content: `
> "The dashboard started with 6 panels showing key metrics. Over time, people kept
> adding 'just one more panel' for their use case. Now we have 24 panels."
>
> "Someone added a 7-day trend graph because leadership wanted to see weekly patterns
> during a meeting. It was meant to be temporary but never got removed."
>
> "The 'top endpoints' table was useful once, so someone changed it from 1 hour to
> 24 hours 'to get a better picture.' Nobody realized how expensive that made it."
>
> "We don't have a review process for dashboard changes. Anyone can edit."
>
> — DevOps Engineer
      `,
      hint: 'Dashboard complexity grew gradually - no single change caused this'
    },
    {
      id: 5,
      title: 'Grafana Query Inspector',
      type: 'logs',
      content: `
\`\`\`
# Grafana Query Inspector output for dashboard load

Panel: "P99 Latency by Endpoint"
Query: histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le, service, endpoint))
Time: 12,847 ms
Rows: 487  (one per service/endpoint combination)

Panel: "Top 10 Endpoints"
Query: topk(10, sum by (endpoint) (rate(http_requests_total[24h])))
Time: 45,234 ms
Rows: 10

Panel: "Weekly Memory Trend"
Query: avg_over_time(container_memory_usage_bytes[7d])
Time: TIMEOUT (60s limit)
Rows: 0

# Summary:
# Total panels: 24
# Panels loading: 16
# Panels timed out: 4
# Panels showing errors: 4
# Total query time (parallel): 67 seconds
# Dashboard render time: 98 seconds
\`\`\`
      `,
      hint: 'Each slow query adds to total load time'
    },
    {
      id: 6,
      title: 'PromQL Query Optimization Guide',
      type: 'config',
      content: `
\`\`\`markdown
# PromQL Query Optimization

## Expensive Query Patterns

1. **Long time ranges**: [24h], [7d], [30d]
   - Each increases samples scanned linearly
   - Fix: Use recording rules to pre-aggregate

2. **High cardinality labels**: by (endpoint, user_id, request_id)
   - Multiplies series count
   - Fix: Aggregate to fewer labels

3. **histogram_quantile with many labels**
   - Scans all bucket series
   - Fix: Pre-aggregate with recording rules

4. **topk/bottomk over long ranges**
   - Must scan entire range to find top
   - Fix: Use shorter ranges or recording rules

5. **absent() and scalar()** in complex queries
   - Can cause full TSDB scans

## Recording Rules for Expensive Queries

\`\`\`yaml
groups:
  - name: dashboard-optimization
    interval: 1m
    rules:
      # Pre-aggregate expensive histogram quantiles
      - record: http_latency:p99_1m
        expr: histogram_quantile(0.99, sum(rate(http_duration_bucket[1m])) by (le, service))

      # Pre-aggregate traffic by service (not endpoint)
      - record: http_requests:rate5m_by_service
        expr: sum(rate(http_requests_total[5m])) by (service)
\`\`\`

Dashboards query recording rules = instant, cheap queries
\`\`\`
      `,
      hint: 'Recording rules pre-compute expensive aggregations'
    }
  ],

  solution: {
    diagnosis: 'Dashboard queries evolved to scan millions of samples over long time ranges with high-cardinality labels',

    keywords: [
      'grafana', 'prometheus', 'query', 'timeout', 'slow', 'performance',
      'recording rules', 'cardinality', 'histogram', 'time range', 'samples',
      'dashboard', 'PromQL'
    ],

    rootCause: `
      The Grafana dashboard evolved organically over time. Each addition seemed reasonable
      in isolation, but the cumulative effect created a query load that Prometheus couldn't
      handle efficiently:

      1. **Long time ranges**: Panels querying 24h and 7d of data scan hundreds of millions
         of samples. A 7-day query at 15s scrape interval = 40,320 samples per series.

      2. **High cardinality labels**: The "by (service, endpoint)" grouping creates series
         for every unique combination. With 50 services × 100 endpoints = 5,000 result series.

      3. **Histogram explosion**: histogram_quantile must process all bucket series. With
         11 buckets × 5,000 service/endpoint combinations = 55,000 series per histogram.

      4. **No query governance**: Anyone could add panels without performance review.
         Each "small" change added up.

      The math: 24 panels × average 10 seconds each × parallel execution limited by
      Prometheus capacity = 90+ second load times. During incidents when you need
      dashboards most, Prometheus is already under load, making queries even slower.
    `,

    codeExamples: [
      {
        lang: 'promql',
        description: 'Problematic: Long range + high cardinality',
        code: `# BAD: Scans 24 hours of data for every endpoint
topk(10, sum by (endpoint) (rate(http_requests_total[24h])))

# BAD: 7 days of memory samples, every container
avg_over_time(container_memory_usage_bytes[7d])

# BAD: High-cardinality histogram quantile
histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le, service, endpoint))`
      },
      {
        lang: 'yaml',
        description: 'Solution: Recording rules pre-aggregate expensive queries',
        code: `# prometheus-rules.yaml
groups:
  - name: dashboard-optimization
    interval: 1m
    rules:
      # Pre-aggregate request rates by service (low cardinality)
      - record: http_requests:rate5m_by_service
        expr: sum(rate(http_requests_total[5m])) by (service)

      # Pre-compute p99 latency at service level (not endpoint)
      - record: http_latency:p99_by_service
        expr: histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le, service))

      # Pre-aggregate memory by service (not container)
      - record: memory:avg_by_service
        expr: sum(avg_over_time(container_memory_usage_bytes[5m])) by (service)

  - name: hourly-rollups
    interval: 1h
    rules:
      # Hourly rollup for "top endpoints" query
      - record: http_requests:rate1h_by_endpoint
        expr: sum(rate(http_requests_total[1h])) by (endpoint)

      # Daily patterns pre-computed hourly
      - record: http_requests:rate1h_total
        expr: sum(rate(http_requests_total[1h]))`
      },
      {
        lang: 'promql',
        description: 'Dashboard queries using recording rules',
        code: `# GOOD: Query pre-aggregated recording rules (instant)
http_requests:rate5m_by_service

# GOOD: P99 from recording rule (instant)
http_latency:p99_by_service

# GOOD: Top endpoints from hourly rollup (faster)
topk(10, http_requests:rate1h_by_endpoint)

# GOOD: Memory trend from recording rule (no 7d scan)
memory:avg_by_service`
      },
      {
        lang: 'json',
        description: 'Dashboard panel with query limits',
        code: `{
  "title": "P99 Latency by Service",
  "type": "graph",
  "targets": [{
    "expr": "http_latency:p99_by_service",  // Recording rule
    "interval": "1m",  // Explicit interval
    "legendFormat": "{{service}}"  // Low cardinality legend
  }],
  "maxDataPoints": 1000,  // Limit data points
  "timeFrom": "1h",  // Override dashboard range to 1h for this panel
  "datasource": {
    "type": "prometheus",
    "uid": "prometheus"
  },
  "fieldConfig": {
    "defaults": {
      "unit": "s"  // Seconds for latency
    }
  }
}`
      },
      {
        lang: 'yaml',
        description: 'Grafana dashboard governance policy',
        code: `# dashboard-governance.md

## Dashboard Performance Standards

### Query Requirements
- Max time range in expr: 1h (use recording rules for longer)
- Max cardinality in 'by' clause: 50 unique values
- All histograms must use pre-aggregated recording rules
- No dashboard may have > 12 panels

### Review Process
1. All dashboard changes require PR to grafana-dashboards repo
2. CI checks query performance against staging Prometheus
3. Queries > 5s must be justified or use recording rules
4. Quarterly dashboard audit to remove unused panels

### Recording Rule Requirements
- Any query taking > 2s should have a recording rule
- Recording rules must have meaningful names
- Document which dashboards use each recording rule`
      }
    ],

    prevention: [
      'Create recording rules for any query taking > 2 seconds',
      'Limit dashboard panel counts (suggest max 12)',
      'Use explicit time ranges per panel, not just dashboard default',
      'Review dashboard query performance quarterly',
      'Implement dashboard change review process',
      'Pre-aggregate histograms at lower cardinality',
      'Monitor Prometheus query latency as a KPI'
    ],

    educationalInsights: [
      'Dashboard complexity grows gradually - boiling frog problem',
      'Each label in "by" clause multiplies result cardinality',
      'Recording rules shift query cost from query time to scrape time',
      'Long time ranges + high cardinality = combinatorial explosion',
      'Dashboards needed during incidents are exactly when Prometheus is stressed',
      'Query governance prevents accidental performance degradation'
    ]
  }
};

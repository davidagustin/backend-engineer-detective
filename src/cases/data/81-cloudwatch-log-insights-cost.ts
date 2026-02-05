import { DetectiveCase } from '../../types';

export const cloudwatchLogInsightsCost: DetectiveCase = {
  id: 'cloudwatch-log-insights-cost',
  title: 'The CloudWatch Log Insights Cost',
  subtitle: '$50K/month bill from log queries nobody expected',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `
      The AWS bill arrived and CloudWatch costs exploded from $5K to $50K in one month.
      Finance is furious. Engineering leadership wants answers. The cost explorer shows
      "CloudWatch Logs" but nobody knows why. You have 48 hours to explain the 10x cost
      increase before the CFO escalates.
    `,
    impact: `
      $50K unexpected monthly cost ($540K annually). Budget overrun affecting other projects.
      Finance demanding engineering accountability. Threat of forced observability stack
      changes.
    `,
    timeline: [
      { time: 'Month 1', event: 'CloudWatch costs: $5K (normal)', type: 'normal' },
      { time: 'Month 2', event: 'CloudWatch costs: $12K (+140%)', type: 'warning' },
      { time: 'Month 3', event: 'CloudWatch costs: $50K (+317%)', type: 'critical' },
      { time: 'Day 1', event: 'Finance escalates to VP Engineering', type: 'critical' },
      { time: 'Day 2', event: '48 hours to explain or face consequences', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Applications running normally',
      'Log ingestion working',
      'CloudWatch dashboards functional',
      'No alerts about CloudWatch issues'
    ],
    broken: [
      '10x cost increase in CloudWatch',
      'Cost Explorer shows "CloudWatch Logs"',
      'Cannot identify specific cost driver',
      'No obvious change in log volume'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'AWS Cost Explorer Breakdown',
      type: 'metrics',
      content: `
\`\`\`
CloudWatch Costs - Month 3 Breakdown:

Service: CloudWatch Logs
  Total: $50,234.67

  Usage Type Breakdown:
  ├── DataProcessing-Bytes (Log Insights queries): $41,234.00 (82%)
  ├── DataProcessing-Bytes (Ingestion): $6,000.00 (12%)
  ├── TimedStorage-ByteHrs: $2,500.00 (5%)
  └── Other: $500.67 (1%)

Previous Month (Month 2):
  ├── DataProcessing-Bytes (Log Insights queries): $8,234.00
  ├── DataProcessing-Bytes (Ingestion): $2,800.00
  └── Other: $966.00

# Log Insights query costs went from $8K to $41K!
# That's 5x increase in query volume

Pricing: $0.005 per GB scanned by Log Insights
$41,234 / $0.005 = 8.2 PB of logs scanned!
\`\`\`
      `,
      hint: 'Log Insights queries are scanning 8.2 petabytes of data per month'
    },
    {
      id: 2,
      title: 'Log Insights Query History',
      type: 'logs',
      content: `
\`\`\`
# Top Log Insights queries by data scanned (last 30 days)

Query ID    | Scanned   | Runs  | Avg Scan | Source
------------|-----------|-------|----------|------------------
q-abc123    | 3.2 PB    | 8,640 | 370 GB   | dashboard-main
q-def456    | 2.1 PB    | 4,320 | 486 GB   | dashboard-errors
q-ghi789    | 1.8 PB    | 8,640 | 208 GB   | dashboard-latency
q-jkl012    | 892 TB    | 2,880 | 309 GB   | alert-rule-1
q-mno345    | 156 TB    | 720   | 217 GB   | ad-hoc queries

# Query q-abc123 runs 8,640 times/month = 288 times/day = 12 times/hour
# Each run scans 370 GB of logs!
# 8,640 × 370 GB = 3.2 PB
# 3.2 PB × $0.005/GB = $16,000 for ONE dashboard widget!
\`\`\`
      `,
      hint: 'A single dashboard is querying logs 12 times per hour, each time scanning 370 GB'
    },
    {
      id: 3,
      title: 'CloudWatch Dashboard Configuration',
      type: 'config',
      content: `
\`\`\`json
// main-dashboard.json
{
  "widgets": [
    {
      "type": "log",
      "properties": {
        "title": "Error Count (All Services)",
        "query": "fields @timestamp, @message | filter @message like /ERROR/ | stats count() by bin(5m)",
        "logGroupNames": [
          "/aws/lambda/*",
          "/aws/ecs/*",
          "/aws/ec2/*",
          "/application/*"
        ],
        "view": "timeSeries",
        "region": "us-east-1",
        "period": 2592000  // 30 days!
      }
    },
    {
      "type": "log",
      "properties": {
        "title": "Latency P99",
        "query": "fields @timestamp, latency | stats percentile(latency, 99) by bin(1h)",
        "logGroupNames": ["/aws/lambda/*", "/aws/ecs/*"],
        "view": "timeSeries",
        "period": 2592000  // 30 days!
      }
    }
  ],
  "periodOverride": "auto",
  "refresh": "5m"  // Refresh every 5 minutes!
}
\`\`\`
      `,
      hint: 'Dashboard refreshes every 5 minutes but queries scan 30 days of logs each time'
    },
    {
      id: 4,
      title: 'Dashboard History',
      type: 'testimony',
      content: `
> "I created the dashboard a few months ago. Leadership wanted to see 30-day trends
> at a glance. I set the period to 30 days so they could see the full picture."
>
> "I set it to refresh every 5 minutes so the data stays current. The executives
> check it during meetings and want real-time data."
>
> "I had no idea Log Insights charged per GB scanned. I thought it was just part
> of CloudWatch. The queries return in like 10 seconds so I assumed they were
> efficient."
>
> — Junior DevOps Engineer
      `,
      hint: 'The developer didn\'t know about Log Insights pricing model'
    },
    {
      id: 5,
      title: 'Log Volume Calculation',
      type: 'metrics',
      content: `
\`\`\`
Log Group Sizes (compressed storage):
  /aws/lambda/*     - 45 TB
  /aws/ecs/*        - 28 TB
  /aws/ec2/*        - 12 TB
  /application/*    - 15 TB
  Total: 100 TB (compressed)

Uncompressed scan size: ~300-400 TB
30 days of logs across all groups = ~370 GB average

Dashboard calculations:
  - 4 Log Insights widgets
  - Each queries 30 days = 370 GB scanned
  - Refresh every 5 minutes = 288 refreshes/day
  - 30 days = 8,640 refreshes/month

Cost per widget per month:
  8,640 refreshes × 370 GB × $0.005/GB = $15,984

Total for 4 widgets: ~$64,000/month (some overlap in log groups)

Actual cost: $41,234 (partial month + some caching)
\`\`\`
      `,
      hint: 'Each widget costs ~$16K/month due to frequent full-range queries'
    },
    {
      id: 6,
      title: 'CloudWatch Log Insights Pricing',
      type: 'config',
      content: `
\`\`\`markdown
# CloudWatch Log Insights Pricing

## Cost Model
- $0.005 per GB of data scanned
- You pay for EVERY query execution
- Scans ALL data in the time range you specify
- No caching between queries (each refresh re-scans)

## Cost Optimization Strategies

### 1. Limit Time Range
- Use 1 hour instead of 30 days for dashboards
- Create separate "historical" dashboards with manual refresh

### 2. Reduce Refresh Rate
- 5-minute refresh rarely needed for 30-day data
- Use 1-hour refresh for trend dashboards

### 3. Use Specific Log Groups
- Don't use wildcards: /aws/lambda/*
- Query only the log groups you need

### 4. Use CloudWatch Metrics Instead
- Pre-aggregate log data into metrics
- Metric queries are much cheaper than log scans

### 5. Use Metric Filters
- Create CloudWatch Metrics from log patterns
- Query metrics instead of re-scanning logs

## Example Cost Comparison
30-day scan, 5-min refresh: $16,000/month
1-hour scan, 5-min refresh: $22/month
Using metric filter instead: $0.30/month
\`\`\`
      `,
      hint: 'Pre-aggregating into metrics is 50,000x cheaper than repeated log queries'
    }
  ],

  solution: {
    diagnosis: 'Dashboard refreshing every 5 minutes while querying 30 days of logs - each refresh scans 370 GB at $0.005/GB',

    keywords: [
      'cloudwatch', 'log insights', 'cost', 'pricing', 'scan', 'query',
      'dashboard', 'refresh', 'time range', 'metrics', 'metric filter',
      'AWS bill', 'data processing'
    ],

    rootCause: `
      A CloudWatch dashboard was configured to:
      1. Query 30 days of log data (370 GB across all log groups)
      2. Refresh every 5 minutes (288 times per day)
      3. Use wildcards to include ALL log groups

      Log Insights charges $0.005 per GB scanned, and it scans the ENTIRE time range
      on every query - there's no caching between dashboard refreshes.

      The math is devastating:
      - 4 widgets × 370 GB × 288 refreshes/day × 30 days = 12.8 PB scanned
      - 12.8 PB × $0.005/GB = ~$64,000

      The actual bill was $41K because:
      - Some widgets share log groups (partial overlap)
      - Dashboard wasn't running for full month
      - Some queries had shorter time ranges

      The developer assumed Log Insights was "free" like CloudWatch dashboards for
      metrics. They optimized for user experience (fast refresh, long history) without
      understanding the cost model.

      This is a common trap: Log Insights is powerful but has a fundamentally different
      cost model than CloudWatch Metrics dashboards.
    `,

    codeExamples: [
      {
        lang: 'json',
        description: 'Problematic: Expensive dashboard configuration',
        code: `{
  "widgets": [{
    "type": "log",
    "properties": {
      "query": "filter @message like /ERROR/ | stats count()",
      "logGroupNames": ["/aws/lambda/*", "/aws/ecs/*"],  // Wildcards = all logs
      "period": 2592000  // 30 days of data scanned EVERY TIME
    }
  }],
  "refresh": "5m"  // Refresh 288 times per day
}
// Cost: 370 GB × 288 × 30 × $0.005 = ~$16,000/month PER WIDGET`
      },
      {
        lang: 'json',
        description: 'Fixed: Cost-optimized dashboard',
        code: `{
  "widgets": [{
    "type": "log",
    "properties": {
      "query": "filter @message like /ERROR/ | stats count()",
      "logGroupNames": [
        "/aws/lambda/critical-function",  // Specific, not wildcard
        "/aws/ecs/api-service"
      ],
      "period": 3600  // 1 hour, not 30 days
    }
  }],
  "refresh": "1h"  // Refresh 24 times per day, not 288
}
// Cost: 12 GB × 24 × 30 × $0.005 = ~$43/month (99.7% reduction!)`
      },
      {
        lang: 'yaml',
        description: 'Better: Use CloudWatch Metric Filters',
        code: `# cloudformation-metric-filter.yaml
# Pre-aggregate log patterns into metrics - query metrics instead of logs

Resources:
  ErrorCountMetricFilter:
    Type: AWS::Logs::MetricFilter
    Properties:
      LogGroupName: /aws/lambda/api-handler
      FilterPattern: "ERROR"  # Match ERROR in logs
      MetricTransformations:
        - MetricName: ErrorCount
          MetricNamespace: Application/Errors
          MetricValue: "1"
          DefaultValue: 0

  LatencyMetricFilter:
    Type: AWS::Logs::MetricFilter
    Properties:
      LogGroupName: /aws/lambda/api-handler
      FilterPattern: "[timestamp, requestId, level, latency]"
      MetricTransformations:
        - MetricName: RequestLatency
          MetricNamespace: Application/Latency
          MetricValue: "$latency"

# Now dashboard queries metrics (nearly free) instead of scanning logs
# Metric query: ~$0.01/month vs Log Insights: ~$16,000/month`
      },
      {
        lang: 'json',
        description: 'Dashboard using metrics instead of logs',
        code: `{
  "widgets": [
    {
      "type": "metric",  // Metric widget, not log widget!
      "properties": {
        "title": "Error Count",
        "metrics": [
          ["Application/Errors", "ErrorCount", {"stat": "Sum", "period": 300}]
        ],
        "view": "timeSeries",
        "period": 2592000  // 30 days is fine for metrics - nearly free!
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Latency P99",
        "metrics": [
          ["Application/Latency", "RequestLatency", {"stat": "p99", "period": 300}]
        ],
        "view": "timeSeries",
        "period": 2592000
      }
    }
  ],
  "refresh": "5m"  // Frequent refresh is fine for metrics
}
// Metrics dashboard: $0.30/month for 30-day view with 5-min refresh
// Log Insights dashboard: $32,000/month for same view`
      },
      {
        lang: 'bash',
        description: 'Script to identify expensive Log Insights queries',
        code: `#!/bin/bash
# Find expensive Log Insights queries in your AWS account

# Get query statistics for the last 7 days
aws logs describe-query-definitions --query-definition-name-prefix "" |
  jq -r '.queryDefinitions[] | [.name, .logGroupNames[]] | @tsv'

# Check CloudWatch usage metrics
aws cloudwatch get-metric-statistics \\
  --namespace AWS/Logs \\
  --metric-name IncomingBytes \\
  --dimensions Name=LogGroupName,Value=/aws/lambda/my-function \\
  --start-time $(date -d '7 days ago' --iso-8601) \\
  --end-time $(date --iso-8601) \\
  --period 86400 \\
  --statistics Sum

# Cost allocation tags help identify which team/project caused costs
# Enable cost allocation tags in AWS Billing console
aws ce get-cost-and-usage \\
  --time-period Start=2024-01-01,End=2024-01-31 \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --group-by Type=DIMENSION,Key=USAGE_TYPE \\
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon CloudWatch"]}}'`
      }
    ],

    prevention: [
      'Use CloudWatch Metric Filters for frequently-queried patterns',
      'Set dashboard refresh rates appropriate to data freshness needs',
      'Use short time ranges for frequently-refreshed dashboards',
      'Avoid wildcard log group patterns in production dashboards',
      'Set up AWS Budget alerts for CloudWatch costs',
      'Document Log Insights pricing in team wiki',
      'Review CloudWatch costs monthly in architecture reviews'
    ],

    educationalInsights: [
      'Log Insights charges per GB scanned - not per query or per result',
      'Each dashboard refresh re-scans the entire time range',
      'Metric Filters convert log patterns to metrics at ingestion time (cheap to query)',
      'CloudWatch Metrics dashboards are nearly free; Log Insights dashboards are expensive',
      'Cost visibility is often lagging - check Cost Explorer regularly',
      'AWS pricing models vary widely even within the same service'
    ]
  }
};

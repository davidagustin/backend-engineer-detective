import { DetectiveCase } from '../../types';

export const pagerdutyAlertFatigue: DetectiveCase = {
  id: 'pagerduty-alert-fatigue',
  title: 'The PagerDuty Alert Fatigue',
  subtitle: 'Critical alerts missed because on-call ignores constant noise',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `
      A critical database outage went undetected for 47 minutes. The PagerDuty alert fired
      but was acknowledged and ignored. The on-call engineer says "I get 200 alerts per shift,
      most are false positives. I acknowledged it and went back to sleep." Customers were
      affected, the incident made the news, and leadership wants to know why their expensive
      monitoring didn't work.
    `,
    impact: `
      47-minute outage affecting 100% of users. $2.3M revenue impact. PR crisis and
      customer trust damaged. On-call engineer burned out and considering quitting.
      Entire SRE team demoralized.
    `,
    timeline: [
      { time: '2:14 AM', event: 'Database primary node fails', type: 'critical' },
      { time: '2:15 AM', event: 'PagerDuty alert fires (correctly)', type: 'warning' },
      { time: '2:16 AM', event: 'On-call acknowledges alert (doesn\'t investigate)', type: 'critical' },
      { time: '2:30 AM', event: 'First customer complaints on Twitter', type: 'warning' },
      { time: '3:01 AM', event: 'Customer Success escalates to Engineering Manager', type: 'critical' },
      { time: '3:02 AM', event: 'Actual incident response begins', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'PagerDuty correctly sent the alert',
      'Alert contained accurate information',
      'Escalation policies were configured',
      'On-call rotation was staffed'
    ],
    broken: [
      'Real critical alert dismissed as noise',
      '200+ alerts per on-call shift',
      '95% of alerts are false positives',
      'On-call engineers ignoring pages'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'PagerDuty Alert Statistics',
      type: 'metrics',
      content: `
\`\`\`
# Last 30 days PagerDuty analytics
Total alerts: 6,247
Acknowledged within 5min: 5,891 (94%)
Resolved automatically: 4,123 (66%)
Resolved by human action: 1,892 (30%)
Actual incidents requiring action: 312 (5%)

# Alert noise ratio
False positives: 5,935 (95%)
True positives: 312 (5%)

# Mean time to acknowledge: 3.2 minutes
# Mean time to resolve: 4.7 minutes (most auto-resolve)
# Mean time to INVESTIGATE: No data (no one tracks this)
\`\`\`
      `,
      hint: '95% of alerts are false positives - on-call has learned to ignore them'
    },
    {
      id: 2,
      title: 'Top Alert Sources',
      type: 'logs',
      content: `
\`\`\`
# PagerDuty alerts by source (last 7 days)

AlertSource                           Count  Severity  AutoResolve%
---------------------------------------------------------------
CPU > 80%                              423    HIGH      89%
Memory > 85%                           312    HIGH      92%
Disk > 90%                             156    HIGH      78%
API latency > 500ms                    287    HIGH      95%
Pod restart detected                   892    HIGH      99%
5xx errors detected (any)              534    HIGH      88%
Connection pool warning                234    MEDIUM    94%
SSL cert expiring (30 days)            42     LOW       0%
Database replication lag               23     HIGH      45%
Database connection failed             3      CRITICAL  0%  <- THE REAL ISSUE

# The actual critical alert (DB connection failed) was 3 out of 2,906
# It was buried in noise and looked like "just another alert"
\`\`\`
      `,
      hint: 'The critical alert was 0.1% of total alerts - needle in haystack'
    },
    {
      id: 3,
      title: 'Alert Configuration Samples',
      type: 'config',
      content: `
\`\`\`yaml
# prometheus-alerts.yaml
groups:
  - name: infrastructure
    rules:
      # Alert on ANY CPU spike (fires constantly)
      - alert: HighCPU
        expr: node_cpu_usage_percent > 80
        for: 1m
        labels:
          severity: high

      # Alert on ANY 5xx error (fires on every transient error)
      - alert: HTTPErrors
        expr: rate(http_requests_total{status=~"5.."}[1m]) > 0
        for: 0s  # Immediate, no waiting
        labels:
          severity: high

      # Alert on ANY pod restart (normal k8s behavior)
      - alert: PodRestart
        expr: kube_pod_container_status_restarts_total > 0
        labels:
          severity: high

      # Legitimate alert buried among the noise
      - alert: DatabaseConnectionFailed
        expr: mysql_up == 0
        for: 30s
        labels:
          severity: critical
\`\`\`
      `,
      hint: 'Everything is HIGH severity - there is no way to distinguish real problems'
    },
    {
      id: 4,
      title: 'On-Call Engineer Interview',
      type: 'testimony',
      content: `
> "I get paged 20-30 times per shift. Most alerts auto-resolve in 2-3 minutes.
> I've learned to wait 5 minutes before doing anything. If it resolves, I go
> back to sleep. If it doesn't, then maybe I'll look."
>
> "The database alert came in at 2:15 AM. I acknowledged it and waited for it
> to auto-resolve like the others. By 2:20 AM I was back asleep. I didn't know
> it was different from the 500 other alerts I'd seen that week."
>
> "Every single alert says 'HIGH severity' or 'CRITICAL'. If everything is
> critical, nothing is critical. I can't tell what actually needs attention."
>
> — On-Call Engineer (now on medical leave for burnout)
      `,
      hint: 'Alert fatigue has trained the on-call to ignore pages'
    },
    {
      id: 5,
      title: 'PagerDuty Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# pagerduty-service.yaml
service:
  name: "Production Alerts"
  escalation_policy:
    - level: 1
      targets:
        - type: user
          id: on-call-primary
      escalation_timeout: 30  # 30 min to respond
    - level: 2
      targets:
        - type: schedule
          id: engineering-managers
      escalation_timeout: 60

# All 50 alert types go to the same service
# No differentiation between:
# - "CPU spiked briefly" (noise)
# - "Database is dead" (critical)
# - "SSL cert expires in 30 days" (informational)
\`\`\`
      `,
      hint: 'All alerts route to the same service with the same escalation'
    },
    {
      id: 6,
      title: 'Alert Fatigue Research',
      type: 'config',
      content: `
\`\`\`markdown
# Alert Fatigue in On-Call Engineering

## The Problem
Studies show:
- On-call responders ignore 75%+ of alerts in high-noise environments
- Response time increases 3x after the 10th alert in a shift
- False positive rates > 50% lead to "cry wolf" syndrome

## Symptoms of Alert Fatigue
- Alerts acknowledged but not investigated
- Auto-resolve dependency (waiting to see if it goes away)
- All alerts treated as low priority
- On-call burnout and turnover

## Best Practices
1. **Alert on symptoms, not causes**: "Users can't checkout" vs "CPU high"
2. **Require action**: If no action needed, it's not an alert
3. **Severity must be meaningful**: Reserve CRITICAL for customer impact
4. **Target < 5 alerts per on-call shift** (Google SRE book)
5. **Auto-resolving alerts are usually not worth paging**

## The 5-Alert Rule
If an alert fires > 5 times without requiring action, either:
- Fix the underlying issue
- Tune the threshold
- Delete the alert
\`\`\`
      `,
      hint: 'Good alerting targets < 5 pages per shift, not 200'
    }
  ],

  solution: {
    diagnosis: 'Alert fatigue from 95% false positive rate caused on-call to ignore critical database alert',

    keywords: [
      'alert fatigue', 'false positive', 'pagerduty', 'on-call', 'noise',
      'severity', 'critical', 'burnout', 'cry wolf', 'alerting', 'monitoring'
    ],

    rootCause: `
      The alerting system was configured to page on any deviation from normal, resulting
      in 200+ alerts per on-call shift. 95% of these alerts auto-resolved without any
      human action needed.

      This trained the on-call engineer to:
      1. Acknowledge alerts immediately (to stop the noise)
      2. Wait 5 minutes to see if they auto-resolve
      3. Only investigate if the problem persists

      When the real database outage occurred:
      - The alert looked identical to hundreds of others
      - It was labeled "CRITICAL" like many non-critical alerts
      - The engineer applied the learned behavior: ack and wait
      - By the time it became obvious this was different, 47 minutes had passed

      The root cause is not the engineer's behavior - that's a rational adaptation to
      a broken system. The root cause is an alerting philosophy that prioritizes
      "catching everything" over "actionable signal."

      Alert fatigue is a systems problem, not a people problem.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Problematic: Everything is an alert',
        code: `# DON'T: Alert on every metric deviation
- alert: HighCPU
  expr: node_cpu_usage_percent > 80  # Fires constantly
  labels:
    severity: high  # "high" for CPU that auto-resolves?

- alert: HTTPErrors
  expr: rate(http_requests_total{status=~"5.."}[1m]) > 0  # ANY error
  for: 0s  # Immediate - no debounce
  labels:
    severity: high  # Every 5xx is "high severity"?`
      },
      {
        lang: 'yaml',
        description: 'Fixed: Alert on customer impact, not metrics',
        code: `# DO: Alert on symptoms that require human action

# Tier 1: Page immediately - customers are impacted NOW
- alert: CheckoutCompletelyDown
  expr: sum(rate(checkout_success_total[5m])) == 0
        AND sum(rate(checkout_attempts_total[5m])) > 10
  for: 2m  # Sustained failure, not transient
  labels:
    severity: critical
    team: payments
  annotations:
    summary: "Zero successful checkouts in 5 minutes"
    runbook: "https://wiki/runbooks/checkout-down"

# Tier 2: Page during business hours - degraded experience
- alert: CheckoutErrorRateHigh
  expr: |
    sum(rate(checkout_errors_total[5m])) /
    sum(rate(checkout_attempts_total[5m])) > 0.05
  for: 5m
  labels:
    severity: high

# Tier 3: Ticket, don't page - needs attention but not urgent
- alert: DatabaseReplicationLagHigh
  expr: mysql_slave_lag_seconds > 30
  for: 10m
  labels:
    severity: warning  # Creates ticket, doesn't page`
      },
      {
        lang: 'yaml',
        description: 'PagerDuty service tiers',
        code: `# Separate PagerDuty services by actual urgency

# Critical service - pages immediately, always
critical_service:
  name: "Critical - Customer Impacting"
  urgency: high
  alerts:
    - CheckoutCompletelyDown
    - DatabaseConnectionFailed
    - PaymentProcessorDown
  expected_volume: "<3 per week"

# High service - pages during business hours
high_service:
  name: "High - Degraded Experience"
  urgency: high
  support_hours: "9am-9pm"
  alerts:
    - CheckoutErrorRateHigh
    - APILatencyP99High
  expected_volume: "<10 per week"

# Warning service - creates tickets only
warning_service:
  name: "Warning - Engineering Attention"
  urgency: low
  create_incident: false
  create_ticket: true  # Goes to Jira, not pager
  alerts:
    - HighCPU
    - PodRestarts
    - DiskUsageHigh`
      },
      {
        lang: 'markdown',
        description: 'Alert review checklist',
        code: `# Weekly Alert Review Process

## For each alert that fired this week, ask:

1. **Did it require human action?**
   - No → Delete or convert to metric/log

2. **Did it indicate actual customer impact?**
   - No → Reduce severity or convert to ticket

3. **Was the threshold appropriate?**
   - Too sensitive → Raise threshold
   - Too noisy → Add 'for' duration

4. **Did the runbook help resolve it?**
   - No runbook → Add one or delete alert
   - Runbook wrong → Update it

5. **Could this have been prevented?**
   - Yes → Create ticket for underlying fix

## Target Metrics
- Pages per on-call shift: < 5
- False positive rate: < 10%
- Alerts with runbooks: 100%
- Alerts requiring action: > 90%`
      }
    ],

    prevention: [
      'Target < 5 pages per on-call shift',
      'Only page when human action is required',
      'Differentiate severity levels meaningfully',
      'Review and prune alerts weekly',
      'Every alert must have a runbook',
      'Auto-resolving alerts probably should not page',
      'Track and reduce false positive rate as a KPI'
    ],

    educationalInsights: [
      'Alert fatigue is a systems problem, not a people problem',
      'If everything is critical, nothing is critical',
      'On-call engineers rationally adapt to noise by ignoring alerts',
      'Google SRE targets < 2 pages per 12-hour shift',
      'The cost of a false positive is training humans to ignore real alerts',
      'Alerting on causes (CPU high) instead of symptoms (users affected) creates noise'
    ]
  }
};

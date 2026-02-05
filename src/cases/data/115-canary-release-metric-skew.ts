import type { DetectiveCase } from "../../types";

export const canaryReleaseMetricSkew: DetectiveCase = {
	id: "canary-release-metric-skew",
	title: "The Canary Release Metric Skew",
	subtitle: "Canary appears healthy despite shipping a critical bug",
	difficulty: "senior",
	category: "distributed",

	crisis: {
		description:
			"A canary deployment was promoted to 100% after all metrics showed green. Within an hour, checkout failures spiked to 15%. The bug was in the canary the whole time, but metrics never caught it.",
		impact:
			"$2.3M in lost sales over 4 hours. 12,000 failed checkout attempts. Brand reputation damage from social media complaints.",
		timeline: [
			{ time: "10:00 AM", event: "Canary deployed to 5% of traffic", type: "normal" },
			{ time: "10:30 AM", event: "Canary metrics reviewed - all green", type: "normal" },
			{ time: "11:00 AM", event: "Canary promoted to 25%", type: "normal" },
			{ time: "11:30 AM", event: "Metrics still green, promoted to 100%", type: "warning" },
			{ time: "12:00 PM", event: "First checkout failure reports", type: "warning" },
			{ time: "12:30 PM", event: "Checkout failure rate hits 15%", type: "critical" },
			{ time: "1:00 PM", event: "Rollback initiated", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Canary error rate was 0.1% (same as baseline)",
			"Canary latency was within 5% of baseline",
			"Health checks passed throughout",
			"CPU and memory metrics normal",
			"Most API endpoints working correctly",
		],
		broken: [
			"Checkout completing but orders not created",
			"Payment charged but order status shows failed",
			"Bug only affects specific payment method + region combo",
			"Issue invisible in aggregate metrics",
			"No errors logged for the silent failure",
		],
	},

	clues: [
		{
			id: 1,
			title: "Canary Metrics Dashboard",
			type: "metrics",
			content: `\`\`\`
Canary Analysis Report (10:00 AM - 11:30 AM)
============================================

Error Rate:
  Baseline: 0.12%
  Canary:   0.11%
  Diff:     -0.01% (PASS)

P50 Latency:
  Baseline: 145ms
  Canary:   148ms
  Diff:     +2.1% (PASS, threshold 10%)

P99 Latency:
  Baseline: 890ms
  Canary:   920ms
  Diff:     +3.4% (PASS, threshold 20%)

Success Rate (HTTP 2xx):
  Baseline: 99.88%
  Canary:   99.89%
  Diff:     +0.01% (PASS)

Canary Score: 98/100 - HEALTHY
Recommendation: PROMOTE
\`\`\``,
			hint: "These metrics look at HTTP status codes and latency, but what about business outcomes?",
		},
		{
			id: 2,
			title: "Checkout Service Code Change",
			type: "code",
			content: `\`\`\`typescript
// The change in the canary release
// payment-processor.ts

async processPayment(order: Order): Promise<PaymentResult> {
  const paymentMethod = order.paymentMethod;
  const region = order.shippingAddress.region;

  // New code: Route to regional payment processor
  const processor = this.getRegionalProcessor(paymentMethod, region);

  try {
    const result = await processor.charge(order);
    return result;
  } catch (error) {
    // Log and return failure
    logger.error('Payment failed', { orderId: order.id, error });
    return { success: false, error: error.message };
  }
}

getRegionalProcessor(method: string, region: string): PaymentProcessor {
  // Bug: Typo in region code for EU + PayPal combo
  if (method === 'paypal' && region === 'EU') {
    // Should be 'eu-west' but returns undefined processor
    return this.processors.get('ue-west'); // Returns undefined!
  }
  return this.processors.get(\`\${region.toLowerCase()}-default\`);
}
\`\`\``,
			hint: "What happens when the processor is undefined?",
		},
		{
			id: 3,
			title: "Payment Processor Wrapper",
			type: "code",
			content: `\`\`\`typescript
// processor.charge() implementation
class PaymentProcessorWrapper {
  async charge(order: Order): Promise<PaymentResult> {
    if (!this.processor) {
      // Silent failure - returns success with no actual charge
      // This was added as a "graceful degradation" for testing
      return {
        success: true,  // BUG: Returns success even though nothing happened!
        transactionId: 'SKIP-' + Date.now(),
        amount: order.total
      };
    }

    return this.processor.processCharge(order);
  }
}
\`\`\``,
			hint: "The code returns success even when the processor is missing...",
		},
		{
			id: 4,
			title: "Traffic Distribution Analysis",
			type: "metrics",
			content: `\`\`\`
Traffic Analysis During Canary (5% traffic):
============================================
Total Canary Requests: 50,000
  - US region:     35,000 (70%)
  - EU region:      8,000 (16%)
  - APAC region:    7,000 (14%)

Payment Methods in Canary:
  - Credit Card:   40,000 (80%)
  - PayPal:         8,000 (16%)
  - Apple Pay:      2,000 (4%)

EU + PayPal combinations in Canary: 1,280 requests (2.56%)
  - Actually affected by bug: ~1,280 requests
  - Expected checkout rate: ~10%
  - Affected checkouts: ~128 orders

Baseline daily checkouts: 100,000
Canary affected checkouts: 128
Bug visibility in overall metrics: 0.128%

At 100% traffic:
EU + PayPal checkouts per hour: ~2,500
Lost orders per hour: ~2,500
\`\`\``,
			hint: "The bug affects a small segment that was statistically invisible at 5%...",
		},
		{
			id: 5,
			title: "SRE Team Testimony",
			type: "testimony",
			content: `"Our canary analysis is state-of-the-art. We compare error rates, latency percentiles, and success rates. Everything was green. The problem is the bug doesn't cause errors - it returns HTTP 200 with a success response. And the affected segment (EU PayPal users) is only about 2.5% of traffic. At 5% canary, that's 0.125% of total traffic. Way below our statistical significance threshold."`,
		},
		{
			id: 6,
			title: "Business Metrics (Not Monitored)",
			type: "metrics",
			content: `\`\`\`
Metrics NOT included in canary analysis:
========================================

Orders Created (per hour):
  Before canary:  10,000
  During canary:   9,985 (at 5%)
  After promote:   8,500 (at 100%)  <- Should have caught this!

Payment Success vs Order Creation:
  Payments "succeeded":  10,200
  Orders created:         8,500
  Gap:                    1,700 (16.7%)  <- Ghost payments!

Revenue:
  Expected: $850,000/hour
  Actual:   $722,500/hour
  Loss:     $127,500/hour

These metrics exist but weren't part of canary analysis!
\`\`\``,
			hint: "Technical metrics passed but business metrics would have caught the issue...",
		},
	],

	solution: {
		diagnosis: "Canary metrics missed silent business logic failure affecting low-traffic segment",
		keywords: [
			"canary",
			"metrics",
			"silent failure",
			"business metrics",
			"segment",
			"statistical significance",
			"metric skew",
			"false negative",
			"observability",
		],
		rootCause: `Multiple factors combined to make this bug invisible to canary analysis:

1. **Silent failure**: The bug returns HTTP 200 with success:true, so error rate metrics don't catch it. The payment appears successful but no order is created.

2. **Segment-specific bug**: Only affects EU region + PayPal payment method, which is ~2.5% of traffic. At 5% canary, this is 0.125% of total traffic.

3. **Statistical invisibility**: The canary analysis requires statistically significant differences. ~128 affected orders out of 50,000 requests is noise, not signal.

4. **Wrong metrics**: The canary analyzed technical metrics (HTTP codes, latency) but not business metrics (order creation rate, payment-to-order ratio, revenue).

5. **Graceful degradation backfire**: The code was designed to "gracefully handle" missing processors by returning success. This hid the configuration error.

The metrics were accurate - they just weren't measuring the right things.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Add business metrics to canary analysis",
				code: `// canary-analyzer.ts
interface CanaryMetrics {
  // Technical metrics (existing)
  errorRate: number;
  p50Latency: number;
  p99Latency: number;

  // Business metrics (add these!)
  orderCreationRate: number;
  paymentToOrderRatio: number;
  revenuePerRequest: number;
  cartAbandonmentRate: number;
}

async analyzeCanary(
  baseline: MetricsSample,
  canary: MetricsSample
): Promise<CanaryResult> {
  const checks: CanaryCheck[] = [
    // Technical checks
    this.checkErrorRate(baseline, canary),
    this.checkLatency(baseline, canary),

    // Business checks - CRITICAL
    this.checkOrderCreationRate(baseline, canary),
    this.checkPaymentOrderRatio(baseline, canary),
    this.checkRevenuePerRequest(baseline, canary),
  ];

  // Segment-specific checks
  const segments = ['US', 'EU', 'APAC'];
  const paymentMethods = ['credit', 'paypal', 'applepay'];

  for (const segment of segments) {
    for (const method of paymentMethods) {
      checks.push(
        this.checkSegmentMetrics(baseline, canary, segment, method)
      );
    }
  }

  return this.evaluateChecks(checks);
}`,
			},
			{
				lang: "typescript",
				description: "Fix silent failure - fail explicitly",
				code: `// processor.charge() - fixed
class PaymentProcessorWrapper {
  async charge(order: Order): Promise<PaymentResult> {
    if (!this.processor) {
      // FIXED: Fail explicitly instead of silently succeeding
      logger.error('Missing payment processor', {
        orderId: order.id,
        method: order.paymentMethod,
        region: order.region
      });

      // Alert on missing processor - this is a config error
      metrics.increment('payment.processor.missing', {
        method: order.paymentMethod,
        region: order.region
      });

      return {
        success: false,
        error: 'Payment processor unavailable',
        code: 'PROCESSOR_NOT_CONFIGURED'
      };
    }

    return this.processor.processCharge(order);
  }
}`,
			},
			{
				lang: "yaml",
				description: "Segment-aware canary configuration",
				code: `# canary-config.yaml
analysis:
  # Require minimum sample size per segment
  minimumSampleSize: 100

  # Analyze each segment independently
  segments:
    - dimension: region
      values: [US, EU, APAC]
    - dimension: paymentMethod
      values: [credit, paypal, applepay]
    - dimension: userType
      values: [new, returning]

  # Business metrics with segment breakdown
  metrics:
    - name: order_creation_rate
      type: business
      threshold: 2%  # Alert if >2% degradation
      segmented: true

    - name: payment_order_ratio
      type: business
      expected: 1.0  # Payments should equal orders
      threshold: 5%
      segmented: true

    - name: revenue_per_session
      type: business
      threshold: 5%
      segmented: true

  # Hold canary longer for low-traffic segments
  minimumDuration:
    default: 30m
    lowTrafficSegment: 2h  # More time for statistical significance`,
			},
			{
				lang: "typescript",
				description: "Payment-Order reconciliation check",
				code: `// Add synthetic monitoring for payment flow
async function verifyPaymentOrderConsistency(): Promise<void> {
  const recentPayments = await getRecentPayments({
    minutes: 5,
    status: 'success'
  });

  const orderIds = await getOrdersForPayments(
    recentPayments.map(p => p.transactionId)
  );

  const orphanedPayments = recentPayments.filter(
    p => !orderIds.has(p.transactionId)
  );

  if (orphanedPayments.length > 0) {
    // Payments without orders = CRITICAL
    alert.critical('Orphaned payments detected', {
      count: orphanedPayments.length,
      sampleIds: orphanedPayments.slice(0, 5).map(p => p.transactionId),
      segments: groupBySegment(orphanedPayments)
    });
  }

  metrics.gauge('payment.order.ratio',
    orderIds.size / recentPayments.length
  );
}

// Run every minute
setInterval(verifyPaymentOrderConsistency, 60000);`,
			},
		],
		prevention: [
			"Include business metrics in canary analysis, not just technical metrics",
			"Analyze metrics per segment, not just aggregate",
			"Require minimum sample sizes for statistical significance",
			"Never return success for operations that didn't actually succeed",
			"Add synthetic monitoring that verifies end-to-end business flows",
			"Implement payment-to-order reconciliation as a continuous check",
			"Extend canary duration for features affecting low-traffic segments",
			"Add explicit tests for all region + payment method combinations",
		],
		educationalInsights: [
			"HTTP 200 doesn't mean the business operation succeeded",
			"Aggregate metrics can hide segment-specific failures",
			"Canary analysis needs business metrics, not just SLIs",
			"Statistical significance requires sufficient sample size per segment",
			"'Graceful degradation' can hide configuration errors",
			"Silent failures are worse than loud failures - they're invisible",
			"The rarer the segment, the longer canary needs to run",
		],
	},
};

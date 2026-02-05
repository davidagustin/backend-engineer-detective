import { DetectiveCase } from '../../types';

export const jaegerTraceSamplingBias: DetectiveCase = {
  id: 'jaeger-trace-sampling-bias',
  title: 'The Jaeger Trace Sampling Bias',
  subtitle: 'Error traces missing from Jaeger despite errors in logs',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      You're investigating a production incident. Users report intermittent 500 errors
      on the checkout flow. You go to Jaeger to find the error traces - but they don't
      exist. The logs show errors happened, but Jaeger has no trace data for them.
      Your distributed tracing is supposed to help debug exactly these issues, but
      it's failing you when you need it most.
    `,
    impact: `
      Cannot debug production errors using tracing. Mean Time To Resolution (MTTR)
      increased 3x because engineers must correlate logs manually. Lost confidence
      in observability stack. Product manager asking "why did we invest in tracing
      if it doesn't show errors?"
    `,
    timeline: [
      { time: '10:00 AM', event: 'User reports checkout failure', type: 'normal' },
      { time: '10:05 AM', event: 'On-call searches Jaeger for error traces', type: 'normal' },
      { time: '10:10 AM', event: 'No error traces found in Jaeger', type: 'warning' },
      { time: '10:15 AM', event: 'Error confirmed in application logs', type: 'warning' },
      { time: '10:30 AM', event: 'Manual log correlation begins - MTTR clock ticking', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Jaeger UI is accessible',
      'Successful request traces appear',
      'Trace IDs are generated for all requests',
      'Spans are created correctly in code'
    ],
    broken: [
      'Error traces rarely appear in Jaeger',
      'Cannot find traces for failed requests',
      'Trace search returns mostly successful requests',
      'Error rate in Jaeger << error rate in logs'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Error Rate Comparison',
      type: 'metrics',
      content: `
\`\`\`
# From application logs (Splunk):
Total requests (10:00-11:00): 1,000,000
Requests with status 5xx: 3,247 (0.32% error rate)

# From Jaeger trace search:
Total traces (10:00-11:00): 10,043
Traces with error tag: 12 (0.12% error rate)

# Discrepancy:
# Expected error traces: ~32 (1% sampling of 3,247)
# Actual error traces: 12
# Missing: ~63% of expected error traces!

# But wait - let's check the math again:
# 10,043 traces from 1,000,000 requests = 1.0% sampling
# If sampling were random, we'd expect ~32 error traces
# We only have 12... errors are 2.7x LESS likely to be sampled
\`\`\`
      `,
      hint: 'Errors are being sampled at a lower rate than successes'
    },
    {
      id: 2,
      title: 'Jaeger Agent Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# jaeger-agent config
apiVersion: v1
kind: ConfigMap
metadata:
  name: jaeger-agent-config
data:
  sampling-strategies.json: |
    {
      "service_strategies": [
        {
          "service": "checkout-service",
          "type": "probabilistic",
          "param": 0.01
        }
      ],
      "default_strategy": {
        "type": "probabilistic",
        "param": 0.01
      }
    }

# 1% probabilistic sampling - decision made at trace start
\`\`\`
      `,
      hint: 'Sampling decision is made at trace start - before we know if it will error'
    },
    {
      id: 3,
      title: 'Trace Instrumentation Code',
      type: 'code',
      content: `
\`\`\`python
# checkout_service.py
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

@app.route('/checkout', methods=['POST'])
def checkout():
    # Span created here - sampling decision already made by this point
    with tracer.start_as_current_span("checkout") as span:
        try:
            cart = get_cart(request.user_id)
            span.set_attribute("cart.item_count", len(cart.items))

            payment = process_payment(cart)
            span.set_attribute("payment.status", "success")

            order = create_order(cart, payment)
            span.set_attribute("order.id", order.id)

            return jsonify({"order_id": order.id})

        except PaymentError as e:
            # Error happens AFTER sampling decision was made
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            logger.error(f"Payment failed: {e}", extra={"trace_id": span.context.trace_id})
            return jsonify({"error": "Payment failed"}), 500

        except InventoryError as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            logger.error(f"Inventory error: {e}", extra={"trace_id": span.context.trace_id})
            return jsonify({"error": "Out of stock"}), 500
\`\`\`
      `,
      hint: 'The span is created (and sampling decided) before we know if an error will occur'
    },
    {
      id: 4,
      title: 'Sampling Decision Flow',
      type: 'config',
      content: `
\`\`\`
HEAD-BASED SAMPLING (Current):
================================
Request arrives
    │
    ▼
Start trace, make sampling decision (1% = sampled)
    │
    ▼ (if sampled)
Execute request ──────────────────┐
    │                             │
    ▼                             ▼
Success (99.7%)              Error (0.3%)
    │                             │
    ▼                             ▼
Trace sent to Jaeger        Trace sent to Jaeger

Problem: Only 1% of ALL requests sampled
Error traces = 1% × 0.3% = 0.003% of requests
Very rare events (errors) even more rarely captured!

TAIL-BASED SAMPLING (What we need):
===================================
Request arrives
    │
    ▼
Start trace (100% initially buffered)
    │
    ▼
Execute request ──────────────────┐
    │                             │
    ▼                             ▼
Success                      Error
    │                             │
    ▼                             ▼
Sample at 1%              Sample at 100% ← ALWAYS capture errors!
\`\`\`
      `,
      hint: 'Head-based sampling decides before knowing outcome; tail-based decides after'
    },
    {
      id: 5,
      title: 'Production Logs',
      type: 'logs',
      content: `
\`\`\`
# Application log entries for errors:
[10:23:45] ERROR checkout PaymentError: Card declined
           trace_id=abc123def456 span_id=789xyz

[10:24:12] ERROR checkout InventoryError: SKU-9876 out of stock
           trace_id=def789ghi012 span_id=345abc

[10:25:33] ERROR checkout PaymentError: Insufficient funds
           trace_id=jkl456mno789 span_id=012def

# Searching these trace_ids in Jaeger:
$ curl "http://jaeger:16686/api/traces/abc123def456"
{"data":[],"total":0,"limit":0}  # NOT FOUND

$ curl "http://jaeger:16686/api/traces/def789ghi012"
{"data":[],"total":0,"limit":0}  # NOT FOUND

$ curl "http://jaeger:16686/api/traces/jkl456mno789"
{"data":[],"total":0,"limit":0}  # NOT FOUND

# The trace_ids exist (we log them) but weren't sampled
\`\`\`
      `,
      hint: 'Traces were created and IDs logged, but the traces were not sampled for storage'
    },
    {
      id: 6,
      title: 'OpenTelemetry Sampling Documentation',
      type: 'config',
      content: `
\`\`\`markdown
# Sampling Strategies in Distributed Tracing

## Head-Based Sampling
- Decision made at span/trace creation
- Simple, low overhead
- Problem: Cannot consider span outcome (success/error)
- Result: Rare events (errors) rarely sampled

## Tail-Based Sampling
- Decision made after span completes
- Can sample based on outcome (always sample errors)
- Requires buffering spans until decision
- More complex, requires collector infrastructure

## Hybrid Approaches
1. **Always sample errors**: Check status at span end
2. **Span links**: Link error spans to sampled parent traces
3. **Priority sampling**: Different rates for different conditions
4. **Adaptive sampling**: Increase rate when errors detected

## Recommendations
- Use tail-based sampling in production for debugging capability
- At minimum, use "always sample errors" policy
- Consider Jaeger's remote sampling with adaptive rate
\`\`\`
      `,
      hint: 'Tail-based sampling can make decisions based on span outcome'
    }
  ],

  solution: {
    diagnosis: 'Head-based probabilistic sampling makes decision before error occurs - errors not preferentially sampled',

    keywords: [
      'sampling', 'head-based', 'tail-based', 'jaeger', 'traces', 'distributed tracing',
      'probabilistic', 'errors', 'sampling bias', 'observability', 'spans',
      'opentelemetry', 'tracing'
    ],

    rootCause: `
      The Jaeger agent uses head-based probabilistic sampling at 1%. This means the
      sampling decision is made when a trace starts - before any spans complete and
      before we know if the request will succeed or fail.

      With 1% sampling and 0.3% error rate:
      - 1% of 1,000,000 requests = 10,000 traces
      - 1% of 3,000 errors = 30 error traces (expected)

      But errors are rare events (0.3%), so probabilistic sampling captures very few.
      The sampling is "fair" (1% of everything) but not "useful" (we care more about
      errors than successes).

      Head-based sampling is designed for throughput optimization, not debuggability.
      When you need to debug rare errors, you need tail-based sampling that can
      decide AFTER knowing the outcome - always keeping error traces regardless of
      the base sampling rate.

      The observability investment fails at its primary use case: debugging production
      errors. The traces exist (trace IDs are logged) but were discarded before storage.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Problematic: Head-based probabilistic sampling',
        code: `# This samples 1% of ALL requests uniformly
# Errors (0.3% of traffic) get the same 1% sample rate
{
  "default_strategy": {
    "type": "probabilistic",
    "param": 0.01
  }
}`
      },
      {
        lang: 'python',
        description: 'Solution 1: Custom sampler - always sample errors',
        code: `from opentelemetry.sdk.trace.sampling import Sampler, Decision, SamplingResult
from opentelemetry.trace import SpanKind
import random

class ErrorAwareSampler(Sampler):
    """Sample all errors, probabilistic for successes."""

    def __init__(self, success_rate: float = 0.01):
        self.success_rate = success_rate

    def should_sample(self, parent_context, trace_id, name, kind, attributes, links):
        # For root spans, use probabilistic sampling initially
        # The actual error-aware decision happens at span end
        if random.random() < self.success_rate:
            return SamplingResult(Decision.RECORD_AND_SAMPLE)
        else:
            # RECORD_ONLY means we keep the span but can upgrade to SAMPLE later
            return SamplingResult(Decision.RECORD_ONLY)

    def get_description(self):
        return f"ErrorAwareSampler({self.success_rate})"

# Configure the tracer provider
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider(sampler=ErrorAwareSampler(0.01))
provider.add_span_processor(BatchSpanProcessor(
    JaegerExporter(),
    # Custom processor can upgrade RECORD_ONLY to SAMPLE on error
))`
      },
      {
        lang: 'python',
        description: 'Solution 2: Tail-based sampling with OTel Collector',
        code: `# The proper solution is tail-based sampling at the collector level
# This requires OpenTelemetry Collector with tail sampling processor

# Application sends ALL spans to collector (or high sample rate)
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON

# Sample everything at the application level
# Collector will make the final decision
provider = TracerProvider(sampler=ALWAYS_ON)

# Alternatively, use a high rate locally
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
provider = TracerProvider(sampler=TraceIdRatioBased(0.10))  # 10% to collector`
      },
      {
        lang: 'yaml',
        description: 'OTel Collector config with tail sampling',
        code: `# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  # Tail-based sampling - decides AFTER seeing complete traces
  tail_sampling:
    decision_wait: 10s  # Wait for spans to complete
    num_traces: 100000  # Buffer size
    policies:
      # Always sample errors
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      # Always sample slow requests
      - name: slow-requests
        type: latency
        latency:
          threshold_ms: 1000
      # Sample 1% of everything else
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 1

exporters:
  jaeger:
    endpoint: jaeger-collector:14250
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [jaeger]`
      },
      {
        lang: 'yaml',
        description: 'Kubernetes deployment for OTel Collector',
        code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
spec:
  replicas: 3  # Scale for trace volume
  template:
    spec:
      containers:
        - name: otel-collector
          image: otel/opentelemetry-collector-contrib:latest
          args:
            - "--config=/etc/otel/config.yaml"
          resources:
            requests:
              memory: "2Gi"  # Tail sampling needs memory for buffering
              cpu: "1"
            limits:
              memory: "4Gi"
              cpu: "2"
          volumeMounts:
            - name: config
              mountPath: /etc/otel
      volumes:
        - name: config
          configMap:
            name: otel-collector-config`
      }
    ],

    prevention: [
      'Use tail-based sampling in production for error debuggability',
      'Configure "always sample errors" as minimum baseline',
      'Monitor sampled error rate vs actual error rate',
      'Document sampling strategy and its implications for debugging',
      'Consider adaptive sampling that increases rate during incidents',
      'Test observability during chaos engineering exercises'
    ],

    educationalInsights: [
      'Head-based sampling optimizes cost, not debuggability',
      'Rare events (errors) need preferential sampling to be observable',
      'The sampling decision timing determines what information is available',
      'Tail-based sampling requires infrastructure investment (collector, memory)',
      'Observability tools must be tested with failure scenarios, not just happy paths',
      'A trace ID in logs without a stored trace is a debugging dead end'
    ]
  }
};

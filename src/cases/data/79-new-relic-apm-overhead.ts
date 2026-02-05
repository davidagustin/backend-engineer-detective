import { DetectiveCase } from '../../types';

export const newRelicApmOverhead: DetectiveCase = {
  id: 'new-relic-apm-overhead',
  title: 'The New Relic APM Overhead',
  subtitle: 'Application 30% slower with APM enabled',
  difficulty: 'senior',
  category: 'memory',

  crisis: {
    description: `
      Your application is 30% slower than benchmarks suggest. P99 latency is 450ms when it
      should be 300ms. You've optimized the code, tuned the database, upgraded hardware -
      nothing helps. A junior engineer noticed that disabling New Relic APM in staging
      dropped latency to expected levels. Now you're questioning whether observability
      is worth the performance cost.
    `,
    impact: `
      30% latency regression affecting user experience. Infrastructure costs 25% higher
      than necessary (over-provisioned to compensate). Engineering time wasted optimizing
      code that wasn't the problem. Leadership questioning APM investment.
    `,
    timeline: [
      { time: 'Month 1', event: 'New Relic APM deployed with default config', type: 'normal' },
      { time: 'Month 3', event: 'Performance optimization sprint yields minimal improvement', type: 'warning' },
      { time: 'Month 6', event: 'Team adds more servers to handle load', type: 'warning' },
      { time: 'Month 8', event: 'Junior engineer tests without APM - finds 30% speedup', type: 'critical' },
      { time: 'Month 8', event: 'Debate: disable APM or accept the overhead?', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'New Relic dashboards show great data',
      'Traces capture every transaction',
      'Error tracking is comprehensive',
      'Application functions correctly'
    ],
    broken: [
      'P99 latency 30% higher than expected',
      'Throughput 25% below benchmarks',
      'High GC pressure observed',
      'Memory usage higher than similar services'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Performance Comparison',
      type: 'metrics',
      content: `
\`\`\`
# Load test results: 1000 concurrent users, 10 minute test

With New Relic APM:
  P50 latency: 180ms
  P99 latency: 450ms
  Throughput: 2,400 req/s
  CPU usage: 78%
  Memory: 4.2 GB
  GC pauses: 45ms avg, 180ms max

Without New Relic APM:
  P50 latency: 120ms
  P99 latency: 295ms
  Throughput: 3,200 req/s
  CPU usage: 52%
  Memory: 2.8 GB
  GC pauses: 15ms avg, 45ms max

Difference:
  Latency: +50% P50, +53% P99
  Throughput: -25%
  Memory: +50%
  GC pauses: 3x longer
\`\`\`
      `,
      hint: 'Memory and GC differences suggest object allocation issues'
    },
    {
      id: 2,
      title: 'New Relic Agent Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# newrelic.yml
common: &default_settings
  license_key: 'xxx'
  app_name: 'Production API'

  # Transaction tracing (all defaults)
  transaction_tracer:
    enabled: true
    transaction_threshold: 0  # Trace ALL transactions
    record_sql: raw
    explain_enabled: true
    explain_threshold: 0  # Explain ALL queries

  # Distributed tracing
  distributed_tracing:
    enabled: true

  # Error collector
  error_collector:
    enabled: true
    capture_attributes: true

  # Custom instrumentation (added by team)
  class_transformer:
    instrumentation:
      - trace_annotation:
          enabled: true
      - methods:
          - class_matcher: "com.myapp.*"  # ALL classes!
            method_matcher: "*"           # ALL methods!

  # Browser monitoring
  browser_monitoring:
    auto_instrument: true

  # Attributes (capture everything)
  attributes:
    enabled: true
    include: "*"  # Capture ALL attributes
\`\`\`
      `,
      hint: 'Notice transaction_threshold: 0 and the class_transformer matching ALL methods'
    },
    {
      id: 3,
      title: 'Memory Profiler Output',
      type: 'logs',
      content: `
\`\`\`
# Heap dump analysis - top object allocators

With APM enabled:
1. com.newrelic.agent.TracedMethod      - 234 MB (28%)
2. com.newrelic.agent.trace.Segment     - 156 MB (19%)
3. com.newrelic.agent.attributes.Map    - 89 MB (11%)
4. java.lang.String                     - 78 MB (9%)
5. com.myapp.model.User                 - 45 MB (5%)

# Object allocation rate
With APM: 1.2 GB/second allocated (triggers GC every 3.5s)
Without APM: 400 MB/second allocated (triggers GC every 10s)

# New Relic internal thread count: 47
# New Relic background CPU: 12%

# Span analysis
Spans created per request (average): 847
Spans with custom attributes: 847
Attributes per span (average): 23
\`\`\`
      `,
      hint: '847 spans per request with 23 attributes each is excessive'
    },
    {
      id: 4,
      title: 'Application Code Sample',
      type: 'code',
      content: `
\`\`\`java
// UserService.java
@Service
public class UserService {

    @Trace  // <-- Every method has this annotation
    public User getUser(Long id) {
        User user = userRepository.findById(id);
        enrichUser(user);
        return user;
    }

    @Trace
    private void enrichUser(User user) {
        user.setFullName(formatName(user));
        user.setAge(calculateAge(user));
        user.setPreferences(loadPreferences(user));
    }

    @Trace
    private String formatName(User user) {
        return user.getFirstName() + " " + user.getLastName();
    }

    @Trace
    private int calculateAge(User user) {
        return Period.between(user.getBirthDate(), LocalDate.now()).getYears();
    }

    @Trace
    private Preferences loadPreferences(User user) {
        return preferencesRepository.findByUserId(user.getId());
    }
}

// The team added @Trace to every method "for visibility"
// A single getUser() call creates 5 spans just in this class
// Multiply by all service classes = 847 spans per request
\`\`\`
      `,
      hint: 'Every method is traced, including trivial ones like formatName()'
    },
    {
      id: 5,
      title: 'New Relic Transaction Analysis',
      type: 'logs',
      content: `
\`\`\`
# Single request transaction breakdown

Transaction: GET /api/users/123
Total duration: 185ms (reported by New Relic)
Actual work: 82ms (measured with stopwatch)
APM overhead: 103ms (56% overhead!)

Segment breakdown:
  - UserController.getUser: 5ms
  - UserService.getUser: 3ms
  - UserService.enrichUser: 2ms
  - UserService.formatName: 0.1ms  <-- WHY trace this?
  - UserService.calculateAge: 0.1ms <-- WHY trace this?
  - UserService.loadPreferences: 1ms
  - PreferencesRepository.findByUserId: 15ms
  - ... (840 more segments)

Total segments: 847
Total segment metadata: 19,234 attributes
Segment creation overhead: ~0.12ms per segment
847 segments × 0.12ms = 101.6ms overhead per request
\`\`\`
      `,
      hint: 'Creating and managing 847 spans per request has measurable overhead'
    },
    {
      id: 6,
      title: 'APM Instrumentation Best Practices',
      type: 'config',
      content: `
\`\`\`markdown
# APM Instrumentation Guidelines

## What to Trace
- External HTTP calls (APIs, services)
- Database queries
- Cache operations
- Message queue publish/consume
- Significant business operations
- Custom entry points

## What NOT to Trace
- Simple getters/setters
- String manipulation
- Math calculations
- In-memory transformations
- Anything < 1ms
- Utility methods

## Configuration Principles
1. Start with auto-instrumentation defaults
2. Add custom traces ONLY for specific debugging
3. Use sampling for high-throughput paths
4. Set transaction_threshold > 0 (e.g., apdex_t × 4)
5. Be selective with attribute capture

## Overhead Budget
- Target: < 3% latency impact
- Max spans per transaction: 50-100
- Max attributes per span: 10
- Capture rate: Sample, don't capture 100%
\`\`\`
      `,
      hint: 'The guidance says max 50-100 spans, we have 847'
    }
  ],

  solution: {
    diagnosis: 'Over-instrumentation creating 847 spans per request with 23 attributes each, causing 30% overhead',

    keywords: [
      'APM', 'overhead', 'instrumentation', 'spans', 'traces', 'new relic',
      'performance', '@Trace', 'transaction_threshold', 'sampling', 'segments',
      'attributes', 'observability tax'
    ],

    rootCause: `
      The New Relic APM agent was configured for maximum visibility without considering
      the performance cost:

      1. **Transaction threshold set to 0**: Every single transaction is traced, not just
         slow ones. This means 100% capture rate instead of sampling.

      2. **Wildcard class instrumentation**: The class_transformer was configured to trace
         ALL methods in ALL application classes (com.myapp.*:*).

      3. **@Trace on every method**: Developers added @Trace annotations throughout the
         codebase "for visibility", including trivial methods like formatName().

      4. **Attribute capture on everything**: attributes.include: "*" captures all possible
         attributes on every span.

      The result: 847 spans created per request, each with 23 attributes. Creating and
      managing these spans has measurable overhead:
      - Memory: Each span object + attributes = ~1.5KB
      - CPU: Span lifecycle management, attribute capture
      - GC: 1.2GB/sec allocation rate vs 400MB/sec without APM

      The 30% latency overhead comes from:
      - Span creation: ~0.1ms × 847 = 85ms
      - Attribute capture: ~0.02ms × 847 = 17ms
      - GC pressure: Additional 3x GC pause time
      - Background processing: 12% CPU for APM threads

      This is not a New Relic bug - it's over-configuration. APM is powerful but has
      a cost proportional to how much you trace.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Problematic: Trace everything configuration',
        code: `# DON'T: Maximum tracing, minimum performance
transaction_tracer:
  transaction_threshold: 0  # Trace ALL transactions
  explain_threshold: 0      # Explain ALL queries

class_transformer:
  instrumentation:
    - methods:
        - class_matcher: "com.myapp.*"  # ALL classes
          method_matcher: "*"           # ALL methods

attributes:
  include: "*"  # Capture EVERYTHING`
      },
      {
        lang: 'yaml',
        description: 'Fixed: Selective tracing configuration',
        code: `# DO: Selective tracing for performance and value
common: &default_settings
  app_name: 'Production API'

  transaction_tracer:
    enabled: true
    # Only trace transactions slower than 4x apdex threshold
    transaction_threshold: apdex_f  # or explicit: 2.0 (2 seconds)
    record_sql: obfuscated  # Not raw - less memory
    explain_enabled: true
    explain_threshold: 0.5  # Only explain queries > 500ms

  distributed_tracing:
    enabled: true

  # Selective instrumentation
  class_transformer:
    instrumentation:
      # Only trace specific integration points
      - trace_annotation:
          enabled: true  # Only @Trace where explicitly added
      # Don't add wildcard class matching!

  # Selective attributes
  attributes:
    enabled: true
    include:
      - request.uri
      - request.method
      - response.status
      - user.id
    exclude:
      - request.headers.*
      - response.headers.*`
      },
      {
        lang: 'java',
        description: 'Selective tracing in code',
        code: `// DO: Trace only significant operations
@Service
public class UserService {

    // Trace the public entry point
    @Trace
    public User getUser(Long id) {
        User user = userRepository.findById(id);  // DB call auto-traced
        enrichUser(user);  // Internal, don't trace
        return user;
    }

    // NO @Trace - trivial internal method
    private void enrichUser(User user) {
        user.setFullName(formatName(user));
        user.setAge(calculateAge(user));
        user.setPreferences(loadPreferences(user));
    }

    // NO @Trace - simple string operation
    private String formatName(User user) {
        return user.getFirstName() + " " + user.getLastName();
    }

    // NO @Trace - simple calculation
    private int calculateAge(User user) {
        return Period.between(user.getBirthDate(), LocalDate.now()).getYears();
    }

    // Trace this - it's a separate DB call
    @Trace
    private Preferences loadPreferences(User user) {
        return preferencesRepository.findByUserId(user.getId());
    }
}

// Result: 2 traced segments in this class, not 5
// Total per request: ~50 segments, not 847`
      },
      {
        lang: 'java',
        description: 'Custom instrumentation for specific needs',
        code: `// When you DO need detailed tracing, do it selectively
@Service
public class PaymentService {

    @Trace(metricName = "Custom/Payment/ProcessPayment")
    public PaymentResult processPayment(PaymentRequest request) {
        // Add only relevant attributes
        NewRelic.addCustomParameter("payment.amount", request.getAmount());
        NewRelic.addCustomParameter("payment.currency", request.getCurrency());
        // Don't add: request.cardNumber, request.cvv, etc.

        try {
            PaymentResult result = paymentGateway.charge(request);
            NewRelic.addCustomParameter("payment.success", true);
            return result;
        } catch (PaymentException e) {
            NewRelic.noticeError(e);  // Errors always captured
            throw e;
        }
    }
}

// This single span with 3 attributes provides more value
// than 50 spans with 500 attributes`
      },
      {
        lang: 'bash',
        description: 'Measure APM overhead',
        code: `#!/bin/bash
# Script to measure APM overhead in staging

# Test 1: With APM enabled
echo "Testing WITH APM..."
export NEW_RELIC_ENABLED=true
wrk -t12 -c400 -d60s http://localhost:8080/api/users/1 > with_apm.txt

# Test 2: Without APM
echo "Testing WITHOUT APM..."
export NEW_RELIC_ENABLED=false
./restart_app.sh
sleep 30  # Wait for warmup
wrk -t12 -c400 -d60s http://localhost:8080/api/users/1 > without_apm.txt

# Compare results
echo "=== WITH APM ==="
grep "Latency" with_apm.txt
grep "Requests/sec" with_apm.txt

echo "=== WITHOUT APM ==="
grep "Latency" without_apm.txt
grep "Requests/sec" without_apm.txt

# Target: < 3% latency difference`
      }
    ],

    prevention: [
      'Set transaction_threshold to trace only slow transactions',
      'Remove wildcard class/method instrumentation',
      'Audit @Trace annotations - remove from trivial methods',
      'Limit attributes captured per span',
      'Measure APM overhead quarterly as part of performance testing',
      'Establish overhead budget (< 3% latency impact)',
      'Use sampling for high-throughput endpoints'
    ],

    educationalInsights: [
      'Observability has a cost - more tracing = more overhead',
      'Value comes from tracing the right things, not everything',
      'Wildcard instrumentation is almost never appropriate in production',
      'Each span has fixed overhead: creation, attributes, GC, export',
      'The Pareto principle applies: 10% of spans provide 90% of debugging value',
      'APM overhead should be measured, not assumed to be "negligible"'
    ]
  }
};

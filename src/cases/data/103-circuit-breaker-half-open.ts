import { DetectiveCase } from '../../types';

export const circuitBreakerHalfOpen: DetectiveCase = {
  id: 'circuit-breaker-half-open',
  title: 'The Circuit Breaker Half-Open Trap',
  subtitle: 'Requests failing during circuit recovery phase causing prolonged outages',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your payment service uses circuit breakers to protect against downstream failures.
      After a brief outage in the payment gateway, the circuit breaker opened as expected.
      However, the service is now stuck in a loop where it briefly allows traffic, fails,
      and opens again. The payment gateway has been healthy for 20 minutes but transactions
      keep failing intermittently.
    `,
    impact: `
      45% of payment attempts failing. Revenue loss of $12,000/hour during checkout failures.
      Customer complaints flooding support. Marketing campaign ROI tanking due to lost conversions.
    `,
    timeline: [
      { time: '10:00 AM', event: 'Payment gateway experiences 2-minute outage', type: 'warning' },
      { time: '10:02 AM', event: 'Circuit breaker opens, all payments rejected', type: 'critical' },
      { time: '10:05 AM', event: 'Payment gateway fully recovered', type: 'normal' },
      { time: '10:07 AM', event: 'Circuit enters half-open state', type: 'warning' },
      { time: '10:08 AM', event: 'Test request fails, circuit reopens', type: 'critical' },
      { time: '10:30 AM', event: 'Still cycling between half-open and open', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Payment gateway is healthy and responding in 50ms',
      'Direct API calls to payment gateway succeed',
      'Other services without circuit breakers work fine',
      'Circuit breaker library functioning correctly'
    ],
    broken: [
      'Payments randomly fail with "circuit open" errors',
      'Service cycles between open and half-open states',
      'Successful payments only occur in brief windows',
      'Recovery takes hours instead of minutes'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Circuit Breaker Configuration',
      type: 'config',
      content: `
\`\`\`typescript
// payment-service/src/config/circuit-breaker.ts
export const circuitBreakerConfig = {
  failureThreshold: 5,        // Open after 5 failures
  successThreshold: 1,        // Close after 1 success (half-open)
  timeout: 30000,             // Stay open for 30 seconds
  halfOpenRequestLimit: 1,    // Allow 1 request in half-open
  volumeThreshold: 10,        // Min requests before calculating failure %
};

// Current state
CircuitBreaker State: HALF_OPEN
Failures in window: 5
Successes in half-open: 0
Time in current state: 45s
\`\`\`
      `,
      hint: 'Only 1 request is allowed in half-open state to test recovery'
    },
    {
      id: 2,
      title: 'Request Logs During Half-Open',
      type: 'logs',
      content: `
\`\`\`
[10:07:00.000] CircuitBreaker: Transitioning to HALF_OPEN state
[10:07:00.001] CircuitBreaker: Allowing probe request through
[10:07:00.002] PaymentService: Processing payment $149.99 (req-001)
[10:07:00.050] PaymentGateway: Response 200 OK in 48ms
[10:07:00.051] PaymentService: Validating payment response...
[10:07:00.052] PaymentService: ERROR - Response validation failed: missing 'processor_id'
[10:07:00.053] CircuitBreaker: Probe request FAILED, reopening circuit
[10:07:00.054] CircuitBreaker: Transitioning to OPEN state

[10:07:30.000] CircuitBreaker: Transitioning to HALF_OPEN state
[10:07:30.001] CircuitBreaker: Allowing probe request through
[10:07:30.002] PaymentService: Processing payment $89.99 (req-002)
[10:07:30.055] PaymentGateway: Response 200 OK in 52ms
[10:07:30.056] PaymentService: ERROR - Response validation failed: missing 'processor_id'
[10:07:30.057] CircuitBreaker: Probe request FAILED, reopening circuit
\`\`\`
      `,
      hint: 'The gateway returns 200 OK but something fails in validation'
    },
    {
      id: 3,
      title: 'Payment Response Validation Code',
      type: 'code',
      content: `
\`\`\`typescript
// payment-service/src/services/payment.service.ts
class PaymentService {
  async processPayment(amount: number): Promise<PaymentResult> {
    const response = await this.circuitBreaker.fire(async () => {
      return await this.paymentGateway.charge(amount);
    });

    // Validate response before returning
    this.validateResponse(response);
    return response;
  }

  private validateResponse(response: PaymentResponse): void {
    const requiredFields = [
      'transaction_id',
      'status',
      'processor_id',  // Required for reconciliation
      'timestamp'
    ];

    for (const field of requiredFields) {
      if (!response[field]) {
        throw new ValidationError(\`missing '\${field}'\`);
      }
    }
  }
}
\`\`\`
      `,
      hint: 'The validation runs AFTER the circuit breaker has completed'
    },
    {
      id: 4,
      title: 'Payment Gateway Response Sample',
      type: 'logs',
      content: `
\`\`\`json
// Response from payment gateway (post-recovery)
{
  "transaction_id": "txn_abc123",
  "status": "approved",
  "amount": 14999,
  "currency": "USD",
  "timestamp": "2024-01-15T10:07:00.050Z"
  // Note: processor_id is only included when using V2 API
  // V1 API (legacy) doesn't return processor_id
}

// Gateway status page shows:
// - V2 API: OPERATIONAL
// - V1 API: OPERATIONAL (degraded mode)
// - During outage, system fell back to V1 API
// - V1 API does NOT return processor_id field
\`\`\`
      `,
      hint: 'The gateway fell back to V1 API during the outage and stayed there'
    },
    {
      id: 5,
      title: 'Gateway Integration Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# payment-service/config/gateway.yaml
payment_gateway:
  base_url: https://api.paymentgateway.com
  api_version: v2
  fallback_version: v1
  auto_fallback: true
  fallback_duration: 3600  # Stay on fallback for 1 hour after incident

# Note: V1 API response schema differs from V2
# V1 does not include: processor_id, risk_score, metadata
# Team chose 1-hour fallback to ensure stability after incidents
\`\`\`
      `,
      hint: 'Gateway stays on V1 fallback for 1 hour after any incident'
    },
    {
      id: 6,
      title: 'Ops Engineer Analysis',
      type: 'testimony',
      content: `
"I traced through the flow. The circuit breaker is working perfectly - it opens when
calls fail and enters half-open to test recovery. The problem is WHAT it's testing.

The payment gateway call succeeds (200 OK, 50ms), but then our validation code throws
an error because the V1 API doesn't return processor_id. That validation error is
being treated as a circuit breaker failure.

So the circuit breaker thinks the gateway is still broken, but actually OUR validation
is failing because we're stuck on V1 API. The gateway won't switch back to V2 for
another 40 minutes. Every half-open probe fails validation and reopens the circuit.

It's not a circuit breaker problem - it's a response schema mismatch being misclassified
as a circuit-worthy failure."
      `
    }
  ],

  solution: {
    diagnosis: 'Circuit breaker probe failures caused by response validation errors after successful gateway calls, not actual gateway failures',

    keywords: [
      'circuit breaker', 'half-open', 'probe', 'validation', 'failure classification',
      'api version', 'fallback', 'response schema', 'false positive', 'recovery'
    ],

    rootCause: `
      The circuit breaker was correctly protecting against the payment gateway outage.
      However, during the outage, the gateway fell back to its V1 API which has a
      different response schema (missing 'processor_id' field).

      The gateway's fallback configuration keeps it on V1 for 1 hour after any incident
      to ensure stability. Meanwhile, the payment service's response validation requires
      the 'processor_id' field that only exists in V2 API responses.

      When the circuit enters half-open state and allows a probe request:
      1. The gateway call succeeds (200 OK in 50ms)
      2. The response validation fails (missing processor_id)
      3. The validation error is thrown and caught by the circuit breaker
      4. The circuit breaker treats this as a failed probe and reopens

      The root issue is improper failure classification - validation errors from
      schema mismatches should NOT trigger circuit breaker failures. Only actual
      gateway errors (timeouts, 5xx responses) should affect the circuit state.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Separate circuit-breaker-worthy errors from validation errors',
        code: `// payment-service/src/services/payment.service.ts
class PaymentService {
  async processPayment(amount: number): Promise<PaymentResult> {
    // Circuit breaker only wraps the actual gateway call
    const response = await this.circuitBreaker.fire(async () => {
      const result = await this.paymentGateway.charge(amount);

      // Only network/gateway errors should trip the circuit
      // Throw CircuitBreakerError for these cases
      if (!result || result.status >= 500) {
        throw new CircuitBreakerError('Gateway error');
      }

      return result;
    });

    // Validation happens OUTSIDE the circuit breaker
    // These errors are logged but don't affect circuit state
    try {
      this.validateResponse(response);
    } catch (validationError) {
      // Log validation failure for investigation
      this.logger.warn('Response validation failed', {
        error: validationError,
        response: response,
        api_version: response.api_version
      });

      // Handle gracefully - maybe processor_id is optional
      // Or queue for manual reconciliation
      await this.queueForManualReconciliation(response);
    }

    return response;
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Use circuit breaker with proper error filtering',
        code: `// Circuit breaker configuration with error filtering
import CircuitBreaker from 'opossum';

const circuitBreaker = new CircuitBreaker(paymentCall, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,

  // Only count specific errors as failures
  errorFilter: (error) => {
    // Don't trip circuit for validation errors
    if (error instanceof ValidationError) {
      return true; // true = don't count as failure
    }

    // Don't trip for 4xx client errors
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return true;
    }

    // Count 5xx, timeouts, network errors as failures
    return false;
  }
});

// Configure half-open more robustly
const robustCircuitBreaker = new CircuitBreaker(paymentCall, {
  // ... base config ...

  // Allow more probes in half-open for better signal
  halfOpenRequestLimit: 5,

  // Require multiple successes before closing
  successThreshold: 3,
});`
      },
      {
        lang: 'typescript',
        description: 'Handle API version mismatches gracefully',
        code: `// Flexible response validation that handles API version differences
private validateResponse(response: PaymentResponse): void {
  // Required in all versions
  const coreFields = ['transaction_id', 'status', 'timestamp'];

  // Only required in V2
  const v2Fields = ['processor_id', 'risk_score'];

  // Validate core fields strictly
  for (const field of coreFields) {
    if (!response[field]) {
      throw new ValidationError(\`missing required field '\${field}'\`);
    }
  }

  // Check API version and validate accordingly
  const apiVersion = response.api_version || this.detectApiVersion(response);

  if (apiVersion === 'v2') {
    for (const field of v2Fields) {
      if (!response[field]) {
        throw new ValidationError(\`missing V2 field '\${field}'\`);
      }
    }
  } else {
    // V1 API - log warning but don't fail
    this.logger.warn('Payment processed via V1 API fallback', {
      transaction_id: response.transaction_id,
      missing_fields: v2Fields.filter(f => !response[f])
    });

    // Emit metric for monitoring
    this.metrics.increment('payment.v1_fallback');
  }
}`
      }
    ],

    prevention: [
      'Classify errors appropriately - not all errors should trip circuit breakers',
      'Use error filtering to distinguish infrastructure failures from business logic errors',
      'Test circuit breaker behavior with different failure modes, not just timeouts',
      'Allow multiple probes in half-open state for better recovery signal',
      'Monitor API version fallbacks and their downstream effects',
      'Make response validation flexible to handle schema differences',
      'Set up alerts for prolonged half-open cycling'
    ],

    educationalInsights: [
      'Circuit breakers should only trip for infrastructure-level failures',
      'Validation errors after successful responses are logic errors, not circuit failures',
      'Half-open state is critical for recovery - one failed probe reopens the circuit',
      'API version fallbacks can cause unexpected schema mismatches downstream',
      'Multiple success thresholds in half-open provide better recovery confidence',
      'The errorFilter option in most circuit breaker libraries prevents false trips'
    ]
  }
};

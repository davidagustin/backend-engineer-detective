import { DetectiveCase } from '../../types';

export const idempotencyKeyCollision: DetectiveCase = {
  id: 'idempotency-key-collision',
  title: 'The Idempotency Key Collision',
  subtitle: 'Different requests treated as duplicates due to flawed key generation',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your payment processing system uses idempotency keys to prevent duplicate charges.
      Customers are reporting that their payments are being "skipped" - they submit payment
      for Order A but receive confirmation for a completely different Order B they placed
      yesterday. The idempotency system thinks these are retry requests when they're actually
      new, distinct payments.
    `,
    impact: `
      156 customers charged for wrong orders. $45K in incorrect charges. Order fulfillment
      completely wrong - customers receiving items they didn't order. Support overwhelmed
      with confused customers. Potential fraud investigation triggered.
    `,
    timeline: [
      { time: '9:00 AM', event: 'New idempotency key format deployed', type: 'normal' },
      { time: '9:30 AM', event: 'First customer reports wrong order charged', type: 'warning' },
      { time: '10:00 AM', event: 'Pattern emerges - repeat customers affected', type: 'warning' },
      { time: '10:30 AM', event: '50+ incidents, pattern unclear', type: 'critical' },
      { time: '11:00 AM', event: 'Idempotency collision identified', type: 'critical' },
      { time: '11:30 AM', event: 'Emergency rollback deployed', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Payment processing itself works correctly',
      'First-time customers not affected',
      'Single-order customers not affected',
      'Idempotency system responding correctly'
    ],
    broken: [
      'Repeat customers getting wrong order confirmations',
      'New payment requests returning old payment results',
      'Different orders being treated as duplicates',
      'Order-payment mismatches in database'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Idempotency Key Generation Code',
      type: 'code',
      content: `
\`\`\`typescript
// payment-service/src/utils/idempotency.ts

// OLD implementation (worked)
function generateIdempotencyKeyOld(request: PaymentRequest): string {
  return \`pay_\${request.orderId}_\${request.customerId}_\${request.amount}_\${Date.now()}\`;
}

// NEW implementation (deployed today)
function generateIdempotencyKey(request: PaymentRequest): string {
  // "Simplified" key generation - removed timestamp for "cleaner" keys
  // Added hash for "security"
  const data = \`\${request.customerId}_\${request.amount}\`;
  return \`pay_\${hash(data).substring(0, 8)}\`;
}

// Example keys generated:
// Customer 123, $99.99 -> pay_a1b2c3d4
// Customer 123, $99.99 -> pay_a1b2c3d4  (SAME KEY for different order!)
\`\`\`
      `,
      hint: 'The new key generation removed orderId and timestamp'
    },
    {
      id: 2,
      title: 'Collision Example',
      type: 'logs',
      content: `
\`\`\`
# Customer 456 payment flow

# Yesterday - Order A
[2024-01-14 14:30:00] PaymentRequest orderId=ORD-111 customerId=456 amount=$49.99
[2024-01-14 14:30:00] Generated idempotency key: pay_f8e9d0c1
[2024-01-14 14:30:01] Payment processed, stored with key pay_f8e9d0c1
[2024-01-14 14:30:01] Response: {paymentId: PAY-AAA, orderId: ORD-111, status: success}

# Today - Order B (different order, same amount)
[2024-01-15 10:15:00] PaymentRequest orderId=ORD-222 customerId=456 amount=$49.99
[2024-01-15 10:15:00] Generated idempotency key: pay_f8e9d0c1  (SAME KEY!)
[2024-01-15 10:15:00] Idempotency hit! Returning cached response
[2024-01-15 10:15:00] Response: {paymentId: PAY-AAA, orderId: ORD-111, status: success}

# Customer paid for ORD-222 but got confirmation for ORD-111
# System thinks this is a retry of yesterday's payment
\`\`\`
      `,
      hint: 'Same customer, same amount, different order = same idempotency key'
    },
    {
      id: 3,
      title: 'Idempotency Store Implementation',
      type: 'code',
      content: `
\`\`\`typescript
// payment-service/src/services/idempotency.service.ts

class IdempotencyService {
  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const key = generateIdempotencyKey(request);

    // Check for existing response
    const cached = await this.idempotencyStore.get(key);

    if (cached) {
      // Return cached response - assumes this is a retry
      console.log(\`Idempotency hit for key \${key}\`);
      return cached.response;
    }

    // Process new payment
    const response = await this.paymentProcessor.charge(request);

    // Store for future idempotency checks
    await this.idempotencyStore.set(key, {
      response,
      request,  // Original request stored but not compared!
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    return response;
  }
}

// The store has the original request but we never compare it
// If keys collide, we just return the cached response blindly
\`\`\`
      `,
      hint: 'Original request is stored but never compared on cache hit'
    },
    {
      id: 4,
      title: 'Key Collision Analysis',
      type: 'metrics',
      content: `
\`\`\`
# Idempotency Key Collision Analysis

New key format: pay_{hash(customerId_amount).substring(0,8)}
Hash output: 8 hex characters = 16^8 = 4.3 billion possibilities

Sounds like a lot, but...

Active customers: 50,000
Average orders per customer per week: 2.3
Orders with same amount (common prices like $9.99, $19.99, $49.99): ~40%

Collision probability for same customer, same amount:
- Customer 456, $49.99 yesterday -> pay_f8e9d0c1
- Customer 456, $49.99 today -> pay_f8e9d0c1
- 100% collision rate for repeat purchases at same price point!

Affected patterns:
- Subscription renewals (same amount monthly): 100% collision
- Repeat purchases of same item: 100% collision
- Cart totals that happen to match: High collision

Collision incidents by price point:
| Amount | Incidents |
|--------|-----------|
| $9.99 | 45 |
| $19.99 | 38 |
| $49.99 | 29 |
| $29.99 | 24 |
| Other | 20 |
\`\`\`
      `,
      hint: 'Common prices cause 100% collision for repeat customers'
    },
    {
      id: 5,
      title: 'Developer Commit Message',
      type: 'testimony',
      content: `
"commit 8f3a2b1: Simplify idempotency keys

The old idempotency keys were too long and hard to debug.
Example: pay_ORD-12345_CUST-456_9999_1705312200000

New format is cleaner and more secure (hashed):
Example: pay_a1b2c3d4

Removed orderId because we already have it in the request.
Removed timestamp because idempotency should be time-independent.
Added hash for security so keys aren't guessable.

This makes logs easier to read and keys shorter for storage."

---

"The developer meant well but fundamentally misunderstood idempotency.

The orderId was CRITICAL - it's what makes each payment request unique.
The timestamp was a safety net for truly duplicate keys.

'Time-independent' sounds right but is wrong - a retry of Order A is
NOT the same as a new payment for Order B, even if they look similar.

The hash 'for security' added nothing - idempotency keys don't need
to be secret, they need to be UNIQUE per distinct operation."
      `
    },
    {
      id: 6,
      title: 'Correct vs Incorrect Key Design',
      type: 'code',
      content: `
\`\`\`typescript
// WRONG: Key based on customer + amount
// Same customer buying same-priced item = collision
function badKey(req: PaymentRequest): string {
  return hash(\`\${req.customerId}_\${req.amount}\`);
}

// WRONG: Key based on just order ID
// Retry with different amount (price change) = different key = duplicate charge
function alsoBadKey(req: PaymentRequest): string {
  return hash(\`\${req.orderId}\`);
}

// BETTER: Key includes all semantically significant fields
function betterKey(req: PaymentRequest): string {
  return \`pay_\${req.orderId}_\${req.customerId}_\${req.amount}\`;
}

// BEST: Key provided by client (they know what operation this is)
function bestKey(req: PaymentRequest): string {
  // Client generates: pay_checkout_session_abc123
  // Client knows this is a unique checkout attempt
  return req.idempotencyKey; // Provided in request header
}

// SAFEST: Verify request matches on cache hit
async function safeIdempotency(key: string, req: PaymentRequest): Promise<Response> {
  const cached = await store.get(key);
  if (cached) {
    // CRITICAL: Verify the cached request matches current request
    if (!requestsMatch(cached.request, req)) {
      throw new IdempotencyKeyCollisionError(
        'Idempotency key reused for different request'
      );
    }
    return cached.response;
  }
  // ... process new request
}
\`\`\`
      `,
      hint: 'Best practice: client provides key, server verifies request matches on hit'
    }
  ],

  solution: {
    diagnosis: 'Idempotency key generation removed order-specific identifiers, causing different payments to generate identical keys',

    keywords: [
      'idempotency', 'idempotency key', 'collision', 'duplicate', 'hash collision',
      'payment', 'key generation', 'unique identifier', 'request fingerprint'
    ],

    rootCause: `
      A well-intentioned code change "simplified" idempotency key generation by removing
      critical identifiers:

      **Old key**: \`pay_{orderId}_{customerId}_{amount}_{timestamp}\`
      **New key**: \`pay_{hash(customerId_amount).substring(0,8)}\`

      The new key had two fatal flaws:

      1. **Removed orderId**: The most important differentiator between payments was
         removed. Same customer buying same-priced items generated identical keys.

      2. **No request verification**: When a cache hit occurred, the stored response
         was returned without verifying the new request matched the original.

      This meant:
      - Customer buys $49.99 item yesterday (Order A) -> key: pay_f8e9d0c1
      - Customer buys $49.99 item today (Order B) -> key: pay_f8e9d0c1
      - System returns yesterday's payment confirmation for Order A
      - Customer is confused, order fulfillment is wrong

      The 7-day cache expiration made this worse - collisions could span nearly a week.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Client-provided idempotency keys (industry best practice)',
        code: `// Client generates idempotency key for each unique operation
// This is how Stripe, AWS, and other APIs work

// Frontend checkout flow
async function processCheckout(cart: Cart): Promise<PaymentResult> {
  // Generate unique key for this checkout attempt
  // Use UUID or combine session + action
  const idempotencyKey = \`checkout_\${sessionId}_\${Date.now()}_\${randomBytes(8)}\`;

  // Send key in header
  const response = await fetch('/api/payments', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      orderId: cart.orderId,
      amount: cart.total,
      customerId: currentUser.id
    })
  });

  // On network error, retry with SAME key
  // Server will return cached response if first request succeeded
  if (!response.ok && isRetryable(response)) {
    return processCheckout(cart); // Same idempotencyKey in closure
  }

  return response.json();
}`
      },
      {
        lang: 'typescript',
        description: 'Server-side idempotency with request verification',
        code: `// payment-service/src/services/idempotency.service.ts
class IdempotencyService {
  async processPayment(
    idempotencyKey: string,
    request: PaymentRequest
  ): Promise<PaymentResponse> {
    // Validate key format
    if (!this.isValidKeyFormat(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError();
    }

    const cached = await this.idempotencyStore.get(idempotencyKey);

    if (cached) {
      // CRITICAL: Verify request matches
      if (!this.requestsMatch(cached.request, request)) {
        // Same key, different request = client error
        throw new IdempotencyKeyCollisionError(
          'Idempotency key was already used for a different request. ' +
          'Generate a new key for new operations.',
          {
            key: idempotencyKey,
            originalOrderId: cached.request.orderId,
            newOrderId: request.orderId
          }
        );
      }

      // Genuine retry - return cached response
      this.metrics.increment('idempotency.cache_hit');
      return cached.response;
    }

    // New request - process and store
    const response = await this.paymentProcessor.charge(request);

    await this.idempotencyStore.set(idempotencyKey, {
      request: this.normalizeRequest(request),
      response,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    this.metrics.increment('idempotency.new_request');
    return response;
  }

  private requestsMatch(a: PaymentRequest, b: PaymentRequest): boolean {
    // Compare all semantically significant fields
    return (
      a.orderId === b.orderId &&
      a.customerId === b.customerId &&
      a.amount === b.amount &&
      a.currency === b.currency
    );
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Server-generated key with proper uniqueness',
        code: `// If server must generate key, include ALL unique identifiers

function generateIdempotencyKey(request: PaymentRequest): string {
  // Include everything that makes this operation unique
  const components = [
    request.orderId,        // Which order
    request.customerId,     // Which customer
    request.amount,         // How much (catches price changes)
    request.currency,       // Which currency
    request.paymentMethod,  // Which payment method
  ];

  // Create deterministic key from all components
  const key = \`pay_\${components.join('_')}\`;

  // Optional: hash for shorter storage (but keep full uniqueness)
  // return \`pay_\${sha256(key)}\`;

  return key;
}

// Example outputs (all different, as they should be):
// Order 111, Customer 456, $49.99 -> pay_ORD-111_456_4999_USD_card
// Order 222, Customer 456, $49.99 -> pay_ORD-222_456_4999_USD_card
// Order 111, Customer 456, $59.99 -> pay_ORD-111_456_5999_USD_card`
      },
      {
        lang: 'typescript',
        description: 'Monitoring for idempotency anomalies',
        code: `// Alert on suspicious idempotency patterns
class IdempotencyMonitor {
  private recentKeys = new Map<string, KeyUsage[]>();

  async trackKeyUsage(key: string, request: PaymentRequest): Promise<void> {
    const usage: KeyUsage = {
      key,
      orderId: request.orderId,
      customerId: request.customerId,
      timestamp: Date.now()
    };

    const history = this.recentKeys.get(key) || [];
    history.push(usage);
    this.recentKeys.set(key, history);

    // Alert if same key used for different orders
    const uniqueOrders = new Set(history.map(u => u.orderId));
    if (uniqueOrders.size > 1) {
      await this.alerting.warn('IdempotencyKeyReuse', {
        key,
        orderIds: Array.from(uniqueOrders),
        message: 'Same idempotency key used for multiple orders'
      });
    }

    // Alert if collision rate too high
    const collisionRate = this.calculateCollisionRate();
    if (collisionRate > 0.001) { // More than 0.1%
      await this.alerting.critical('HighIdempotencyCollisionRate', {
        rate: collisionRate,
        message: 'Idempotency key collision rate exceeds threshold'
      });
    }
  }
}`
      }
    ],

    prevention: [
      'Let clients generate idempotency keys - they know what operation is unique',
      'Always include operation-specific identifier (orderId) in server-generated keys',
      'Verify cached request matches new request on idempotency cache hit',
      'Return 409 Conflict if key is reused for different operation',
      'Use short expiration times (24h) to limit collision window',
      'Monitor for unexpected cache hits (potential collisions)',
      'Document idempotency key requirements in API documentation',
      'Never remove identifiers from keys without understanding impact'
    ],

    educationalInsights: [
      'Idempotency keys must uniquely identify the OPERATION, not just the request shape',
      'Same customer, same amount is NOT the same operation if orders differ',
      'Client-generated keys are safer - client knows when operations are distinct',
      'Always verify request content on cache hit, not just key match',
      'Hash length doesn\'t matter if input lacks uniqueness',
      'Idempotency key collision is worse than no idempotency at all',
      'The "retry" case and "new operation with same data" case must be distinguishable'
    ]
  }
};

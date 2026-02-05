import type { DetectiveCase } from "../../types";

export const grpcDeadlinePropagation: DetectiveCase = {
	id: "grpc-deadline-propagation",
	title: "The gRPC Deadline Propagation",
	subtitle: "Cascading timeouts due to deadline not propagated",
	difficulty: "senior",
	category: "networking",

	crisis: {
		description:
			"Your microservices architecture is experiencing cascading timeouts. When one downstream service is slow, the entire request chain fails, but the errors happen in the wrong services. Upstream services timeout while downstream services are still working.",
		impact:
			"Request success rate dropped to 60%. Users see timeout errors even when backend services eventually succeed. Retry storms making the situation worse. On-call engineers getting paged for healthy services.",
		timeline: [
			{ time: "2:00 PM", event: "Database maintenance causes 500ms latency spike", type: "warning" },
			{ time: "2:01 PM", event: "Order service starts timing out", type: "warning" },
			{ time: "2:02 PM", event: "API Gateway timing out despite order service recovering", type: "critical" },
			{ time: "2:05 PM", event: "Cascading failures across all services", type: "critical" },
			{ time: "2:10 PM", event: "Database latency returns to normal, failures continue", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Individual services respond when tested directly",
			"Database queries complete successfully",
			"Service-to-service calls work with manual testing",
			"Health checks all pass",
		],
		broken: [
			"Request chain fails with DEADLINE_EXCEEDED",
			"Upstream services timeout before downstream completes",
			"Retries cause duplicate processing",
			"Error attribution is wrong (wrong service blamed)",
		],
	},

	clues: [
		{
			id: 1,
			title: "Service Call Chain",
			type: "config",
			content: `\`\`\`
Request Flow:

Client → API Gateway → Order Service → Inventory Service → Database
           (5s)          (3s)            (2s)              (500ms)

Configured Timeouts (per service):
- API Gateway: 5 seconds
- Order Service: 3 seconds
- Inventory Service: 2 seconds
- Database query: 500ms

Problem: These timeouts are INDEPENDENT, not cumulative!
\`\`\``,
			hint: "Each service sets its own timeout, ignoring upstream's remaining time",
		},
		{
			id: 2,
			title: "Timeline of a Failed Request",
			type: "logs",
			content: `\`\`\`
Request trace-id: abc123

T+0ms:    [Gateway] Received request, deadline=T+5000ms
T+10ms:   [Gateway] Calling Order Service with 3s timeout
T+20ms:   [Order] Received request, sets NEW deadline=T+3020ms
T+30ms:   [Order] Calling Inventory Service with 2s timeout
T+40ms:   [Inventory] Received request, sets NEW deadline=T+2040ms
T+50ms:   [Inventory] Calling Database with 500ms timeout
T+550ms:  [Inventory] Database returns (slow due to maintenance)
T+560ms:  [Inventory] Returns to Order Service
T+570ms:  [Order] Processing response...

T+3020ms: [Order] DEADLINE_EXCEEDED (Order's 3s deadline hit!)
          Order service was still processing at T+570ms...
          But Gateway's original deadline was T+5000ms!

T+3030ms: [Gateway] Received DEADLINE_EXCEEDED from Order
T+3040ms: [Gateway] Returns 504 to client

The Gateway had 2 more seconds to spare, but Order's
independent deadline killed the request early!
\`\`\``,
		},
		{
			id: 3,
			title: "gRPC Client Code",
			type: "code",
			content: `\`\`\`go
// order-service/client.go
func (c *OrderClient) CreateOrder(ctx context.Context, req *OrderRequest) (*Order, error) {
    // PROBLEM: Creating new context with fresh deadline
    // instead of propagating the incoming deadline
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    // Call inventory service
    inventory, err := c.inventoryClient.CheckInventory(ctx, req.Items)
    if err != nil {
        return nil, err
    }

    // Process order...
    return c.processOrder(ctx, req, inventory)
}

// inventory-service/client.go
func (c *InventoryClient) CheckInventory(ctx context.Context, items []*Item) (*InventoryStatus, error) {
    // PROBLEM: Another fresh deadline, ignoring the incoming one
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    return c.dbClient.Query(ctx, items)
}
\`\`\``,
			hint: "context.Background() creates a new context, discarding incoming deadline",
		},
		{
			id: 4,
			title: "Retry Storm Analysis",
			type: "metrics",
			content: `\`\`\`
Traffic Analysis During Incident:

Time     | Unique Requests | Total Calls to Inventory | Retry Ratio
---------|-----------------|--------------------------|------------
2:00 PM  | 1,000          | 1,050                    | 1.05x
2:02 PM  | 1,000          | 3,200                    | 3.2x
2:05 PM  | 1,000          | 8,500                    | 8.5x
2:10 PM  | 1,000          | 12,000                   | 12x

When upstream times out but downstream is still processing:
1. Upstream retries the request
2. Downstream now has 2 in-flight requests for same operation
3. Both eventually complete, but client only sees one response
4. Retries compound at each layer: 2^N amplification

The "healthy" services were drowning in retry traffic!
\`\`\``,
		},
		{
			id: 5,
			title: "gRPC Deadline Documentation",
			type: "config",
			content: `\`\`\`markdown
# gRPC Deadlines Best Practices

## What is a Deadline?
A deadline is an absolute point in time by which a request
should complete. Unlike timeouts (relative), deadlines propagate
through the call chain.

## Deadline Propagation
When Service A calls Service B:
- A's remaining deadline should be passed to B
- B should respect the MINIMUM of:
  - Incoming deadline from A
  - B's own configured timeout

## Common Mistakes:
1. Using context.Background() instead of incoming context
2. Setting fresh timeouts without checking remaining deadline
3. Not propagating metadata containing deadline info

## Correct Pattern:
\`\`\`go
func Handler(ctx context.Context, req *Request) (*Response, error) {
    // ctx already has deadline from caller
    // Just use it, or take minimum with your timeout

    deadline, ok := ctx.Deadline()
    if ok {
        remaining := time.Until(deadline)
        // Use remaining time for downstream calls
    }
}
\`\`\`
\`\`\``,
		},
		{
			id: 6,
			title: "Distributed Tracing View",
			type: "metrics",
			content: `\`\`\`
Trace: abc123 (Failed Request)

├─ [Gateway] 0ms-3040ms (DEADLINE_EXCEEDED)
│  Deadline set: 5000ms
│
├── [Order Service] 10ms-3020ms (DEADLINE_EXCEEDED)
│   Deadline set: 3000ms (IGNORED gateway's deadline)
│
├─── [Inventory Service] 30ms-560ms (SUCCESS)
│    Deadline set: 2000ms (IGNORED order's deadline)
│
└──── [Database] 50ms-550ms (SUCCESS)
      Actual query time: 500ms

The request SUCCEEDED at the database level!
But cascading independent deadlines killed it.

If deadlines were propagated:
- Gateway deadline: T+5000ms
- Order should use: min(T+5000ms, T+3000ms) = T+3000ms
- Inventory should use: min(remaining, 2000ms)
- All services would use consistent deadline
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Services creating fresh deadlines instead of propagating incoming deadline from upstream, causing premature timeouts when downstream is still within original deadline",
		keywords: [
			"grpc",
			"deadline",
			"timeout",
			"propagation",
			"context",
			"cascading",
			"deadline_exceeded",
			"distributed tracing",
			"retry storm",
		],
		rootCause: `The root cause is improper deadline propagation in gRPC service calls.

Each service was creating a fresh context with context.Background() and setting its own timeout, completely ignoring the incoming deadline from upstream callers.

This creates several problems:

1. **Premature Timeouts**: A downstream service might complete within the original deadline, but an intermediate service times out first because it set a shorter independent deadline.

2. **Wasted Work**: When an upstream service times out, downstream services continue processing (they don't know about the timeout). The work is wasted because the client already received an error.

3. **Retry Storms**: Upstream services retry when they timeout, but downstream services are still processing the original request. This creates duplicate work and amplifies load.

4. **Wrong Attribution**: Errors are attributed to the service that timed out first, not the actual slow service.

gRPC is designed for deadline propagation - the deadline travels with the context through the entire call chain. By using context.Background(), this crucial feature was being bypassed.`,
		codeExamples: [
			{
				lang: "go",
				description: "Fixed: Propagate incoming deadline",
				code: `// order-service/client.go
func (c *OrderClient) CreateOrder(ctx context.Context, req *OrderRequest) (*Order, error) {
    // Use incoming context - it already has the caller's deadline!
    // Optionally, take minimum of incoming deadline and our timeout

    ctx, cancel := contextWithMinDeadline(ctx, 3*time.Second)
    defer cancel()

    inventory, err := c.inventoryClient.CheckInventory(ctx, req.Items)
    if err != nil {
        return nil, err
    }

    return c.processOrder(ctx, req, inventory)
}

// Helper: Use minimum of incoming deadline and timeout
func contextWithMinDeadline(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
    deadline, ok := parent.Deadline()

    if !ok {
        // No incoming deadline, use our timeout
        return context.WithTimeout(parent, timeout)
    }

    remaining := time.Until(deadline)
    if remaining < timeout {
        // Incoming deadline is sooner, just use parent context
        return context.WithCancel(parent)
    }

    // Our timeout is shorter, apply it
    return context.WithTimeout(parent, timeout)
}`,
			},
			{
				lang: "go",
				description: "Add deadline budget logging for debugging",
				code: `// middleware/deadline.go
func DeadlineLoggingInterceptor(
    ctx context.Context,
    req interface{},
    info *grpc.UnaryServerInfo,
    handler grpc.UnaryHandler,
) (interface{}, error) {
    deadline, hasDeadline := ctx.Deadline()

    if hasDeadline {
        remaining := time.Until(deadline)
        log.Printf("[%s] Incoming deadline budget: %v", info.FullMethod, remaining)

        if remaining < 100*time.Millisecond {
            log.Printf("[%s] WARNING: Very low deadline budget!", info.FullMethod)
            // Could return error early instead of starting work
            // that will likely timeout anyway
        }
    } else {
        log.Printf("[%s] WARNING: No deadline set!", info.FullMethod)
    }

    start := time.Now()
    resp, err := handler(ctx, req)
    elapsed := time.Since(start)

    if hasDeadline {
        budgetUsed := float64(elapsed) / float64(time.Until(deadline)+elapsed) * 100
        log.Printf("[%s] Used %.1f%% of deadline budget", info.FullMethod, budgetUsed)
    }

    return resp, err
}`,
			},
			{
				lang: "go",
				description: "Graceful degradation when deadline is nearly exhausted",
				code: `// service/handler.go
func (s *OrderService) CreateOrder(ctx context.Context, req *OrderRequest) (*Order, error) {
    deadline, ok := ctx.Deadline()

    if ok {
        remaining := time.Until(deadline)

        // If we have less than 500ms, skip non-essential operations
        if remaining < 500*time.Millisecond {
            log.Printf("Low budget (%v), using fast path", remaining)
            return s.createOrderFastPath(ctx, req)
        }

        // If we have less than 100ms, fail fast
        if remaining < 100*time.Millisecond {
            return nil, status.Errorf(codes.DeadlineExceeded,
                "insufficient deadline budget: %v", remaining)
        }
    }

    // Normal path with full processing
    return s.createOrderFullPath(ctx, req)
}`,
			},
		],
		prevention: [
			"Always propagate context with deadline through service calls",
			"Never use context.Background() for downstream calls in request handlers",
			"Set deadlines at the edge (API gateway) and propagate inward",
			"Use contextWithMinDeadline to apply local timeouts without ignoring incoming deadlines",
			"Add deadline budget logging to identify where time is spent",
			"Implement graceful degradation when deadline budget is low",
			"Use distributed tracing to visualize deadline propagation",
			"Test with artificially slow services to verify deadline behavior",
		],
		educationalInsights: [
			"Deadlines are absolute times, timeouts are relative durations - deadlines propagate better",
			"context.Background() is for top-level operations only, not mid-chain calls",
			"gRPC deadline propagation is automatic when you pass the context correctly",
			"Retry storms are often caused by upstream timeouts while downstream is still working",
			"Fail fast when deadline budget is exhausted - don't waste resources",
			"The slowest service should be blamed, not the first to timeout",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const goGoroutineLeak: DetectiveCase = {
	id: "go-goroutine-leak",
	title: "The Goroutine Graveyard",
	subtitle: "Memory grows endlessly as goroutines pile up waiting forever",
	difficulty: "mid",
	category: "memory",

	crisis: {
		description:
			"Your Go microservice memory usage grows continuously until OOM killer terminates it. The service handles message processing from a queue, and after the recent refactoring to improve throughput, memory growth became linear and unstoppable.",
		impact:
			"Service crashes every 4-6 hours from OOM. Messages pile up in queue during restarts. Processing latency increases before each crash. On-call team exhausted from constant restarts.",
		timeline: [
			{ time: "06:00 AM", event: "Service deployed after refactoring", type: "normal" },
			{ time: "08:00 AM", event: "Memory at 512MB (normal baseline)", type: "normal" },
			{ time: "10:00 AM", event: "Memory at 1.2GB, growing steadily", type: "warning" },
			{ time: "12:00 PM", event: "Memory at 2.1GB, alerts firing", type: "warning" },
			{ time: "02:15 PM", event: "OOM killed at 3.8GB, service restart", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Messages are being processed successfully",
			"No errors in application logs",
			"CPU usage is normal",
			"Response times are acceptable",
			"Database connections healthy",
		],
		broken: [
			"Memory grows linearly over time",
			"Goroutine count increases without bound",
			"Memory not released even during low traffic",
			"Service eventually OOM killed",
			"pprof shows thousands of blocked goroutines",
		],
	},

	clues: [
		{
			id: 1,
			title: "Runtime Metrics Over Time",
			type: "metrics",
			content: `\`\`\`
Time        | Memory   | Goroutines | Msgs/sec | Errors
------------|----------|------------|----------|--------
06:00 AM    | 245 MB   | 127        | 0        | 0
08:00 AM    | 512 MB   | 4,231      | 1,247    | 0
10:00 AM    | 1.2 GB   | 18,456     | 1,198    | 0
12:00 PM    | 2.1 GB   | 41,234     | 1,302    | 0
02:00 PM    | 3.6 GB   | 72,891     | 1,156    | 0
02:15 PM    | OOM      | -          | -        | -

# Goroutines growing at ~8,000/hour
# Each goroutine ~2KB stack minimum
# 72,891 goroutines = ~146MB just in stacks
# But they're holding references to much more data
\`\`\``,
			hint: "Goroutine count is growing proportionally to messages processed...",
		},
		{
			id: 2,
			title: "pprof Goroutine Dump",
			type: "logs",
			content: `\`\`\`
$ go tool pprof http://localhost:6060/debug/pprof/goroutine

(pprof) top 20
Showing nodes accounting for 71847 goroutines, 98.57% of 72891 total
      flat  flat%   sum%        cum   cum%
     71823 98.54% 98.54%      71823 98.54%  runtime.gopark
        24  0.03% 98.57%         24  0.03%  runtime.goroutineReady

(pprof) traces runtime.gopark
Type: goroutine
71823 goroutines blocked at:
#	0x103a2b4	runtime.gopark+0x94
#	0x103c8f0	runtime.chanrecv+0x2b0
#	0x103c5e3	runtime.chanrecv1+0x23
#	0x1234567	main.(*Worker).processMessage+0x187
#	0x1234890	main.(*Worker).Start.func1+0x50

# 71,823 goroutines blocked on channel receive!
\`\`\``,
			hint: "All these goroutines are blocked waiting to receive from a channel...",
		},
		{
			id: 3,
			title: "Worker Implementation (After Refactoring)",
			type: "code",
			content: `\`\`\`go
type Worker struct {
    id       int
    jobs     chan Message
    results  chan Result
    quit     chan struct{}
}

func NewWorker(id int, results chan Result) *Worker {
    return &Worker{
        id:      id,
        jobs:    make(chan Message),  // Unbuffered channel
        results: results,
        quit:    make(chan struct{}),
    }
}

func (w *Worker) Start() {
    go func() {
        for {
            select {
            case msg := <-w.jobs:
                result := w.processMessage(msg)
                w.results <- result
            case <-w.quit:
                return
            }
        }
    }()
}

func (w *Worker) processMessage(msg Message) Result {
    // Processing logic
    processed := transform(msg)

    // Notify completion through a response channel
    if msg.ResponseChan != nil {
        msg.ResponseChan <- processed  // <-- BLOCKS HERE
    }

    return Result{ID: msg.ID, Status: "completed"}
}
\`\`\``,
			hint: "What happens to ResponseChan after the caller is done waiting?",
		},
		{
			id: 4,
			title: "Message Dispatcher Code",
			type: "code",
			content: `\`\`\`go
type Dispatcher struct {
    workers []*Worker
    queue   MessageQueue
    results chan Result
}

func (d *Dispatcher) ProcessWithTimeout(msg Message, timeout time.Duration) (*Result, error) {
    // Create response channel for this request
    responseChan := make(chan interface{})
    msg.ResponseChan = responseChan

    // Find available worker and dispatch
    worker := d.getAvailableWorker()
    worker.jobs <- msg

    // Wait for response with timeout
    select {
    case response := <-responseChan:
        return response.(*Result), nil
    case <-time.After(timeout):
        // Timeout! Return error to caller
        return nil, ErrTimeout
    }

    // Note: responseChan is never closed
    // Worker is still trying to send to it
}

func (d *Dispatcher) Run() {
    for {
        msg := d.queue.Dequeue()
        result, err := d.ProcessWithTimeout(msg, 5*time.Second)
        if err != nil {
            log.Printf("Message %s timed out", msg.ID)
            // Message marked as failed, move on
            continue
        }
        d.handleResult(result)
    }
}
\`\`\``,
			hint: "What happens to the worker goroutine when the dispatcher times out?",
		},
		{
			id: 5,
			title: "Senior Developer Testimony",
			type: "testimony",
			content: `"We refactored to add per-message timeouts because some messages were taking too long and blocking others. Before the refactoring, we had a simple worker pool that processed messages sequentially. The timeout feature works great - slow messages no longer block the queue. But I noticed the goroutine count in our metrics dashboard keeps climbing. I assumed Go's garbage collector would clean up the old channels and goroutines, but apparently that's not happening."`,
		},
		{
			id: 6,
			title: "Goroutine Stack Trace",
			type: "logs",
			content: `\`\`\`
goroutine 847231 [chan send, 47 minutes]:
main.(*Worker).processMessage(0xc0004b2000, {0xc000512340, 0x24, ...})
        /app/worker.go:42 +0x187
main.(*Worker).Start.func1()
        /app/worker.go:28 +0x50
created by main.(*Worker).Start
        /app/worker.go:23 +0x85

goroutine 847232 [chan send, 46 minutes]:
main.(*Worker).processMessage(...)
...

goroutine 847233 [chan send, 45 minutes]:
main.(*Worker).processMessage(...)
...

# Pattern: "chan send, XX minutes" - blocked trying to send
# These goroutines will NEVER complete
# The receiver (dispatcher) already moved on due to timeout
\`\`\``,
			hint: "These goroutines are blocked on 'chan send' - the receiver gave up waiting",
		},
	],

	solution: {
		diagnosis: "Goroutine leak from workers blocked sending to abandoned response channels after timeout",
		keywords: [
			"goroutine leak",
			"channel",
			"blocked goroutine",
			"chan send",
			"timeout",
			"unbuffered channel",
			"goroutine blocked",
			"memory leak",
			"context cancellation",
		],
		rootCause: `When ProcessWithTimeout times out, it returns to the caller without reading from responseChan. The worker goroutine is still processing the message and will eventually try to send to responseChan.

Since responseChan is unbuffered (make(chan interface{})), the send operation blocks until someone receives. But the receiver (dispatcher) has already moved on. The worker goroutine is now blocked forever on line 42: "msg.ResponseChan <- processed"

This goroutine will never exit because:
1. The channel is unbuffered - send blocks until receive
2. No one will ever receive - dispatcher timed out
3. The channel is never closed
4. The quit channel is never signaled for this specific work item

Each timed-out message leaves behind a zombie goroutine holding:
- The goroutine stack (~2KB minimum, can grow)
- The Message struct with all its data
- The processed Result waiting to be sent
- References to the Worker and its channels

With 1,200 messages/second and even 1% timeout rate, that's 12 leaked goroutines/second = 43,200/hour.`,
		codeExamples: [
			{
				lang: "go",
				description: "Fix 1: Use buffered channel with size 1",
				code: `func (d *Dispatcher) ProcessWithTimeout(msg Message, timeout time.Duration) (*Result, error) {
    // Buffered channel allows send without receiver
    responseChan := make(chan interface{}, 1)  // <-- SIZE 1
    msg.ResponseChan = responseChan

    worker := d.getAvailableWorker()
    worker.jobs <- msg

    select {
    case response := <-responseChan:
        return response.(*Result), nil
    case <-time.After(timeout):
        // Worker can still send (buffer absorbs it)
        // Goroutine completes normally, channel gets GC'd
        return nil, ErrTimeout
    }
}`,
			},
			{
				lang: "go",
				description: "Fix 2: Use context for cancellation (preferred)",
				code: `func (d *Dispatcher) ProcessWithTimeout(ctx context.Context, msg Message, timeout time.Duration) (*Result, error) {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    responseChan := make(chan interface{}, 1)
    msg.ResponseChan = responseChan
    msg.Ctx = ctx  // Pass context to worker

    worker := d.getAvailableWorker()

    select {
    case worker.jobs <- msg:
        // Message dispatched
    case <-ctx.Done():
        return nil, ctx.Err()
    }

    select {
    case response := <-responseChan:
        return response.(*Result), nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (w *Worker) processMessage(msg Message) Result {
    // Check context before expensive operations
    if msg.Ctx.Err() != nil {
        return Result{ID: msg.ID, Status: "cancelled"}
    }

    processed := transform(msg)

    // Non-blocking send with context check
    if msg.ResponseChan != nil {
        select {
        case msg.ResponseChan <- processed:
            // Sent successfully
        case <-msg.Ctx.Done():
            // Caller cancelled/timed out, don't block
        default:
            // Channel full or closed, move on
        }
    }

    return Result{ID: msg.ID, Status: "completed"}
}`,
			},
			{
				lang: "go",
				description: "Fix 3: Use select with default for non-blocking send",
				code: `func (w *Worker) processMessage(msg Message) Result {
    processed := transform(msg)

    if msg.ResponseChan != nil {
        // Non-blocking send - if no receiver, skip
        select {
        case msg.ResponseChan <- processed:
            // Successfully sent
        default:
            // No receiver waiting, log and move on
            log.Printf("Response channel not ready for msg %s", msg.ID)
        }
    }

    return Result{ID: msg.ID, Status: "completed"}
}`,
			},
		],
		prevention: [
			"Always use buffered channels when send/receive timing is uncertain",
			"Use context.Context for cancellation propagation",
			"Monitor runtime.NumGoroutine() and alert on unexpected growth",
			"Use goleak in tests to detect goroutine leaks",
			"Never send to an unbuffered channel without guaranteed receiver",
			"Consider errgroup for managing goroutine lifecycles",
		],
		educationalInsights: [
			"Goroutines are cheap but not free - each has minimum 2KB stack",
			"Blocked goroutines prevent garbage collection of their references",
			"Unbuffered channels require sender and receiver to rendezvous",
			"Context cancellation should propagate through entire call chain",
			"select with default provides non-blocking channel operations",
			"The Go runtime cannot detect deadlocked goroutines at runtime",
		],
	},
};

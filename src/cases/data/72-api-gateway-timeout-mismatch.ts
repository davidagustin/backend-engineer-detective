import type { DetectiveCase } from "../../types";

export const apiGatewayTimeoutMismatch: DetectiveCase = {
	id: "api-gateway-timeout-mismatch",
	title: "The API Gateway Timeout Mismatch",
	subtitle: "504 errors despite backend responding in time",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Users are seeing 504 Gateway Timeout errors for long-running operations like report generation. The backend logs show the operation completed successfully, but users never see the result. Retry attempts cause duplicate report generation.",
		impact:
			"Report generation feature unusable. Users generating duplicate reports (extra compute cost). Critical month-end reports failing. Finance team blocked on closing books.",
		timeline: [
			{ time: "Monday 9:00 AM", event: "Finance team starts generating month-end reports", type: "normal" },
			{ time: "Monday 9:02 AM", event: "First 504 errors reported for report generation", type: "warning" },
			{ time: "Monday 9:05 AM", event: "Users retry, causing duplicate report jobs", type: "warning" },
			{ time: "Monday 9:30 AM", event: "Pattern identified: only reports taking >30s fail", type: "critical" },
			{ time: "Monday 10:00 AM", event: "Backend logs show reports completing in 45-90 seconds successfully", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Quick API calls work fine",
			"Backend logs show successful report completion",
			"Reports are actually generated (visible in storage)",
			"Direct backend calls (bypassing gateway) work",
		],
		broken: [
			"504 Gateway Timeout for operations over 30 seconds",
			"Users never see successful response for long operations",
			"Retries cause duplicate work",
			"Different timeout errors from different layers",
		],
	},

	clues: [
		{
			id: 1,
			title: "Request Flow and Timeout Configuration",
			type: "config",
			content: `\`\`\`
Request Path:
  Client → CloudFront → API Gateway → ALB → Backend Service

Timeout Configuration:
  CloudFront:      30 seconds (origin timeout)
  API Gateway:     29 seconds (integration timeout)
  ALB:             60 seconds (idle timeout)
  Backend:         120 seconds (request timeout)

A request taking 45 seconds:
  T+0s:   Client sends request
  T+29s:  API Gateway times out, returns 504
  T+30s:  CloudFront sees 504, returns to client
  T+45s:  Backend completes successfully (but nobody is listening!)
\`\`\``,
			hint: "The timeouts don't align - earlier layers give up before later layers finish",
		},
		{
			id: 2,
			title: "Backend Application Logs",
			type: "logs",
			content: `\`\`\`
[09:02:15.000] Received report request: report_id=R123, user=finance_user
[09:02:15.100] Starting data aggregation...
[09:02:25.000] Data aggregation complete, starting PDF generation...
[09:02:45.000] PDF generation in progress (75%)...
[09:03:00.000] Report R123 completed successfully!
[09:03:00.100] Sending response: 200 OK, body size: 2.4MB

[09:03:00.200] WARN: Write failed - broken pipe
[09:03:00.201] Connection closed by client before response sent

# The backend did its job, but the connection was already closed
# by the upstream timeout!
\`\`\``,
			hint: "Backend completed in 45 seconds, but connection was closed at 29 seconds",
		},
		{
			id: 3,
			title: "API Gateway Configuration",
			type: "code",
			content: `\`\`\`yaml
# AWS API Gateway - OpenAPI extension
x-amazon-apigateway-integration:
  uri: http://backend.internal/api/reports
  httpMethod: POST
  type: http_proxy
  timeoutInMillis: 29000  # Maximum allowed by API Gateway!

# AWS API Gateway has a HARD LIMIT of 29 seconds
# This cannot be increased, it's a platform constraint
# https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html
\`\`\``,
		},
		{
			id: 4,
			title: "Error Response Analysis",
			type: "logs",
			content: `\`\`\`
Different 504 errors from different layers:

From API Gateway (at 29s):
{
  "message": "Endpoint request timed out"
}

From CloudFront (if it times out first):
{
  "message": "504 ERROR",
  "details": "CloudFront wasn't able to connect to the origin"
}

From ALB (rarely seen, since Gateway times out first):
{
  "message": "504 Gateway Timeout",
  "details": "The server didn't respond in time"
}

Users see different error formats depending on which layer timed out!
\`\`\``,
		},
		{
			id: 5,
			title: "Infrastructure Diagram",
			type: "config",
			content: `\`\`\`
                    TIMEOUT CHAIN

Client ─────30s──────> CloudFront
                           │
                       ────29s────> API Gateway
                                        │
                                    ────60s────> ALB
                                                   │
                                               ────120s────> Backend

Problem: Each layer should have LONGER timeout than the next!
Current: 30s > 29s > 60s > 120s (inverted!)

Correct ordering should be:
CloudFront: 120s > API Gateway: 90s > ALB: 60s > Backend: 45s

Or: Remove layers with short timeouts for long-running operations
\`\`\``,
		},
		{
			id: 6,
			title: "Proposed Solution from Architect",
			type: "testimony",
			content: `"We have a few options here:

1. **Accept the limit**: Break long operations into chunks under 29 seconds each.

2. **Async pattern**: Return 202 Accepted immediately with a job ID, poll for results.

3. **WebSocket/SSE**: Use persistent connection that doesn't have the timeout.

4. **Bypass API Gateway**: For long operations, route directly to ALB (but lose API Gateway features).

5. **Different service**: Long-running operations go through a different endpoint that doesn't use API Gateway.

Option 2 is the most architecturally sound. Synchronous HTTP isn't meant for multi-minute operations anyway."

— Solutions Architect`,
		},
	],

	solution: {
		diagnosis: "API Gateway's 29-second hard limit times out before backend completes, causing 504 errors for operations legitimately taking longer",
		keywords: [
			"504",
			"gateway timeout",
			"api gateway",
			"timeout mismatch",
			"cloudfront",
			"alb",
			"async",
			"long running",
			"polling",
		],
		rootCause: `The root cause is a timeout chain misconfiguration where upstream components timeout before downstream components complete.

AWS API Gateway has a hard limit of 29 seconds for integration timeout. This cannot be changed - it's a platform constraint designed for API-style synchronous operations.

The timeout chain was inverted:
- CloudFront: 30 seconds
- API Gateway: 29 seconds (hard limit)
- ALB: 60 seconds
- Backend: 120 seconds

When a report takes 45 seconds:
1. Backend starts processing (has 120s budget)
2. At T+29s, API Gateway gives up and returns 504
3. CloudFront forwards the 504 to the client
4. At T+45s, backend completes successfully
5. Backend tries to send response, but connection is closed
6. Response is lost, user sees 504

The fundamental issue is using synchronous HTTP for long-running operations. HTTP/REST is designed for quick request-response patterns. Operations taking minutes should use asynchronous patterns.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Async job pattern with polling",
				code: `// POST /api/reports - Returns immediately with job ID
app.post('/api/reports', async (req, res) => {
  const jobId = generateJobId();

  // Queue the job for background processing
  await jobQueue.enqueue({
    id: jobId,
    type: 'generate_report',
    params: req.body,
    userId: req.user.id,
  });

  // Return immediately (within 29 second limit)
  res.status(202).json({
    jobId,
    status: 'pending',
    statusUrl: \`/api/reports/\${jobId}/status\`,
    estimatedDuration: '60 seconds',
  });
});

// GET /api/reports/:jobId/status - Poll for status
app.get('/api/reports/:jobId/status', async (req, res) => {
  const job = await jobStore.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'completed') {
    return res.json({
      status: 'completed',
      downloadUrl: job.resultUrl,
      completedAt: job.completedAt,
    });
  }

  if (job.status === 'failed') {
    return res.json({
      status: 'failed',
      error: job.error,
    });
  }

  // Still processing
  res.json({
    status: 'processing',
    progress: job.progress,
    startedAt: job.startedAt,
  });
});`,
			},
			{
				lang: "typescript",
				description: "Frontend polling with exponential backoff",
				code: `// frontend/src/api/reports.ts
async function generateReport(params: ReportParams): Promise<Report> {
  // Start the job
  const { jobId, statusUrl } = await api.post('/reports', params);

  // Poll for completion with exponential backoff
  let delay = 1000; // Start at 1 second
  const maxDelay = 10000; // Cap at 10 seconds
  const timeout = 300000; // Give up after 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    await sleep(delay);

    const status = await api.get(statusUrl);

    if (status.status === 'completed') {
      return await api.get(status.downloadUrl);
    }

    if (status.status === 'failed') {
      throw new Error(status.error);
    }

    // Update progress UI
    updateProgress(status.progress);

    // Exponential backoff
    delay = Math.min(delay * 1.5, maxDelay);
  }

  throw new Error('Report generation timed out');
}`,
			},
			{
				lang: "typescript",
				description: "Server-Sent Events for real-time progress",
				code: `// SSE endpoint for real-time job status (bypasses API Gateway)
// Route through ALB directly: reports-stream.example.com

app.get('/api/reports/:jobId/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const jobId = req.params.jobId;

  // Subscribe to job updates
  const unsubscribe = jobEvents.subscribe(jobId, (event) => {
    res.write(\`event: \${event.type}\\n\`);
    res.write(\`data: \${JSON.stringify(event.data)}\\n\\n\`);

    if (event.type === 'completed' || event.type === 'failed') {
      res.end();
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe();
  });

  // Send initial status
  const job = await jobStore.get(jobId);
  res.write(\`event: status\\n\`);
  res.write(\`data: \${JSON.stringify(job)}\\n\\n\`);
});

// Worker sends progress updates
async function processReport(job: Job) {
  for (let i = 0; i <= 100; i += 10) {
    await doWork();
    jobEvents.emit(job.id, {
      type: 'progress',
      data: { progress: i },
    });
  }

  jobEvents.emit(job.id, {
    type: 'completed',
    data: { downloadUrl: resultUrl },
  });
}`,
			},
			{
				lang: "yaml",
				description: "Route long operations around API Gateway",
				code: `# For long-running operations, use a separate subdomain
# that bypasses API Gateway entirely

# CloudFront distribution config
Origins:
  - Id: api-gateway
    DomainName: abc123.execute-api.us-east-1.amazonaws.com
    CustomOriginConfig:
      OriginReadTimeout: 30  # API Gateway limit

  - Id: alb-direct
    DomainName: internal-alb.us-east-1.elb.amazonaws.com
    CustomOriginConfig:
      OriginReadTimeout: 300  # 5 minutes for long operations

CacheBehaviors:
  # Normal API through API Gateway
  - PathPattern: /api/*
    TargetOriginId: api-gateway

  # Long operations direct to ALB (bypass Gateway)
  - PathPattern: /api/reports/stream/*
    TargetOriginId: alb-direct

  - PathPattern: /api/exports/*
    TargetOriginId: alb-direct`,
			},
		],
		prevention: [
			"Design async patterns for any operation that might exceed 30 seconds",
			"Document timeout limits of all infrastructure components",
			"Ensure timeout chain is properly ordered (outer > inner)",
			"Use 202 Accepted + polling for long-running operations",
			"Consider WebSocket/SSE for real-time progress updates",
			"Monitor for 504 errors correlated with operation duration",
			"Load test with realistic operation durations",
			"Provide progress feedback to users for long operations",
		],
		educationalInsights: [
			"AWS API Gateway has a hard 29-second integration timeout limit",
			"Timeout chains should decrease from outer to inner layers",
			"Synchronous HTTP is not designed for multi-minute operations",
			"Async patterns (202 + polling) are more resilient and scalable",
			"Backend completing successfully doesn't mean the user sees the result",
			"Different error messages from different layers can confuse debugging",
		],
	},
};

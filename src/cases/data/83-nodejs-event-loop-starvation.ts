import type { DetectiveCase } from "../../types";

export const nodejsEventLoopStarvation: DetectiveCase = {
	id: "nodejs-event-loop-starvation",
	title: "The Frozen Event Loop",
	subtitle: "API becomes completely unresponsive during image processing",
	difficulty: "senior",
	category: "memory",

	crisis: {
		description:
			"Your Node.js API server becomes completely unresponsive for 10-15 seconds at random intervals. Health checks fail, requests timeout, and the load balancer starts removing instances from rotation. The CPU is pegged at 100% during these freezes.",
		impact:
			"Service experiencing 30-second outages every few minutes. 40% of requests timing out. Load balancer cycling instances in and out. Customer complaints about 'frozen' application.",
		timeline: [
			{ time: "10:00 AM", event: "New image processing feature deployed", type: "normal" },
			{ time: "10:30 AM", event: "First health check failures observed", type: "warning" },
			{ time: "10:45 AM", event: "Load balancer removing instances", type: "warning" },
			{ time: "11:00 AM", event: "API response times spike to 30+ seconds", type: "critical" },
			{ time: "11:15 AM", event: "Multiple instances cycling, service degraded", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Service responds normally most of the time",
			"Memory usage appears stable",
			"No errors in application logs during freezes",
			"Database connections healthy",
			"External API calls succeed when service responds",
		],
		broken: [
			"Complete API freeze for 10-15 seconds randomly",
			"Health check endpoints timeout during freeze",
			"All concurrent requests blocked simultaneously",
			"CPU spikes to 100% during freeze periods",
			"WebSocket connections drop during freezes",
		],
	},

	clues: [
		{
			id: 1,
			title: "CPU and Event Loop Metrics",
			type: "metrics",
			content: `\`\`\`
Event Loop Lag: 12,847ms (should be <100ms)
CPU Usage: 100% (single core)
Active Handles: 847
Active Requests: 234
Heap Used: 412MB / 1024MB
Event Loop Utilization: 0.99 (saturated)

Timeline of Event Loop Lag:
10:32:15 - 15ms (normal)
10:32:18 - 12,453ms (SPIKE)
10:32:31 - 22ms (normal)
10:35:44 - 14,221ms (SPIKE)
\`\`\``,
			hint: "The event loop lag spikes correlate perfectly with the freezes...",
		},
		{
			id: 2,
			title: "Recent Code Change - Image Processor",
			type: "code",
			content: `\`\`\`typescript
import sharp from 'sharp';
import { createHash } from 'crypto';

class ImageProcessor {
  async processUploadedImage(buffer: Buffer): Promise<ProcessedImage> {
    // Generate hash for deduplication
    const hash = this.generateHash(buffer);

    // Resize image synchronously for "consistency"
    const resized = await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Generate thumbnail
    const thumbnail = await this.generateThumbnail(buffer);

    // Calculate perceptual hash for similarity matching
    const pHash = this.calculatePerceptualHash(resized);

    return { hash, resized, thumbnail, pHash };
  }

  private generateHash(buffer: Buffer): string {
    // Synchronous hash calculation
    return createHash('sha256').update(buffer).digest('hex');
  }

  private calculatePerceptualHash(buffer: Buffer): string {
    // Custom perceptual hash implementation
    const pixels = this.extractPixelData(buffer);
    let hash = '';

    // Heavy CPU computation - 64x64 DCT calculation
    for (let i = 0; i < 4096; i++) {
      let sum = 0;
      for (let j = 0; j < 4096; j++) {
        sum += pixels[j] * Math.cos((Math.PI * i * (2 * j + 1)) / 8192);
      }
      hash += sum > 0 ? '1' : '0';
    }

    return hash;
  }

  private extractPixelData(buffer: Buffer): number[] {
    // Synchronous pixel extraction - simplified
    const pixels: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      pixels.push((buffer[i] + buffer[i+1] + buffer[i+2]) / 3);
    }
    return pixels;
  }
}
\`\`\``,
			hint: "Look at the computational complexity of calculatePerceptualHash...",
		},
		{
			id: 3,
			title: "Request Timing Logs",
			type: "logs",
			content: `\`\`\`
[10:32:15.001] POST /api/images/upload - Started
[10:32:15.005] Image received: 4.2MB, processing started
[10:32:15.006] Hash generation complete: 2ms
[10:32:15.892] Sharp resize complete: 886ms
[10:32:16.034] Thumbnail generation complete: 142ms
[10:32:28.156] Perceptual hash complete: 12,122ms  <-- BLOCKING
[10:32:28.158] POST /api/images/upload - Complete: 13,157ms

[10:32:15.234] GET /api/health - Started
[10:32:28.158] GET /api/health - Complete: 12,924ms  <-- BLOCKED

[10:32:17.445] GET /api/users/me - Started
[10:32:28.159] GET /api/users/me - Complete: 10,714ms  <-- BLOCKED

# All requests queued behind the CPU-bound operation
\`\`\``,
			hint: "Notice how ALL requests complete at exactly the same moment...",
		},
		{
			id: 4,
			title: "Node.js Process Analysis",
			type: "metrics",
			content: `\`\`\`bash
$ node --prof-process isolate-*.log

Statistical profiling result:

 [JavaScript]:
   ticks  total  nonlib   name
  45231   89.2%   92.1%  calculatePerceptualHash
   2341    4.6%    4.8%  extractPixelData
    892    1.8%    1.8%  LazyCompile: *cos

 [C++]:
   ticks  total  nonlib   name
    234    0.5%    0.5%  v8::internal::Runtime_MathCos

 [Summary]:
   JavaScript: 89.2%
   C++:         8.1%
   GC:          2.7%

# 89% of CPU time in a single synchronous function
\`\`\``,
		},
		{
			id: 5,
			title: "Backend Developer Testimony",
			type: "testimony",
			content: `"I added the perceptual hash feature last week for image deduplication. It worked great in testing with small images. I didn't think it would be a problem because Node.js is supposed to be async and non-blocking, right? The sharp library is async, so I figured everything was fine. The DCT calculation is just math - I didn't think it would affect other requests."`,
		},
		{
			id: 6,
			title: "Event Loop Visualization",
			type: "logs",
			content: `\`\`\`
Normal Event Loop Cycle (~10ms):
┌───────────────────────────────┐
│           timers              │ (setTimeout, setInterval)
├───────────────────────────────┤
│     pending callbacks         │ (I/O callbacks)
├───────────────────────────────┤
│       idle, prepare           │
├───────────────────────────────┤
│           poll                │ (retrieve new I/O events)
├───────────────────────────────┤
│           check               │ (setImmediate)
├───────────────────────────────┤
│      close callbacks          │
└───────────────────────────────┘
           ↓ next iteration

BLOCKED Event Loop (during perceptual hash):
┌───────────────────────────────┐
│                               │
│   calculatePerceptualHash()   │  <-- STUCK HERE FOR 12 SECONDS
│   (synchronous CPU work)      │
│                               │
│   No other code can execute   │
│   All I/O callbacks queued    │
│   All timers delayed          │
│                               │
└───────────────────────────────┘
\`\`\``,
			hint: "The event loop cannot process ANY callbacks while synchronous code runs",
		},
	],

	solution: {
		diagnosis: "Event loop starvation from CPU-bound synchronous computation blocking all async operations",
		keywords: [
			"event loop",
			"blocking",
			"synchronous",
			"CPU-bound",
			"event loop starvation",
			"event loop lag",
			"blocking operation",
			"worker thread",
			"worker_threads",
			"main thread",
		],
		rootCause: `The calculatePerceptualHash() function performs a computationally expensive O(n^2) DCT calculation synchronously on the main thread. In Node.js, JavaScript runs on a single thread that also handles the event loop.

When CPU-intensive synchronous code runs, it completely blocks the event loop:
- No I/O callbacks can be processed
- No timers can fire
- No new connections can be accepted
- Health checks cannot respond

The developer assumed that because sharp (image resizing) is async, their code was non-blocking. However, any synchronous JavaScript computation, no matter how small it seems, blocks the entire event loop. A 12-second synchronous calculation means 12 seconds where Node.js cannot do ANYTHING else.

This is the fundamental difference between I/O-bound (which Node.js handles well) and CPU-bound (which blocks the event loop) operations.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed: Offload CPU work to Worker Threads",
				code: `import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import path from 'path';

class ImageProcessor {
  private workerPool: Worker[] = [];
  private taskQueue: Array<{ buffer: Buffer; resolve: Function; reject: Function }> = [];
  private availableWorkers: Worker[] = [];

  constructor(poolSize = 4) {
    // Create a pool of worker threads
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(path.join(__dirname, 'perceptual-hash-worker.js'));
      worker.on('message', (result) => this.handleWorkerResult(worker, result));
      worker.on('error', (err) => this.handleWorkerError(worker, err));
      this.workerPool.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  async processUploadedImage(buffer: Buffer): Promise<ProcessedImage> {
    // These are I/O bound - fine on main thread
    const [hash, resized, thumbnail] = await Promise.all([
      this.generateHashAsync(buffer),
      sharp(buffer).resize(1200, 1200, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
      this.generateThumbnail(buffer)
    ]);

    // CPU-bound work -> offload to worker thread
    const pHash = await this.calculatePerceptualHashInWorker(resized);

    return { hash, resized, thumbnail, pHash };
  }

  private calculatePerceptualHashInWorker(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = this.availableWorkers.pop();
      if (worker) {
        worker.postMessage(buffer);
        // Store callbacks for when worker responds
        (worker as any).currentTask = { resolve, reject };
      } else {
        // Queue the task if no workers available
        this.taskQueue.push({ buffer, resolve, reject });
      }
    });
  }
}

// perceptual-hash-worker.js
const { parentPort } = require('worker_threads');

parentPort.on('message', (buffer) => {
  // Heavy CPU work happens here - doesn't block main thread!
  const pixels = extractPixelData(buffer);
  let hash = '';

  for (let i = 0; i < 4096; i++) {
    let sum = 0;
    for (let j = 0; j < 4096; j++) {
      sum += pixels[j] * Math.cos((Math.PI * i * (2 * j + 1)) / 8192);
    }
    hash += sum > 0 ? '1' : '0';
  }

  parentPort.postMessage(hash);
});`,
			},
			{
				lang: "typescript",
				description: "Alternative: Break up computation with setImmediate",
				code: `// For lighter CPU work, yield to event loop periodically
async function calculatePerceptualHashYielding(buffer: Buffer): Promise<string> {
  const pixels = extractPixelData(buffer);
  let hash = '';

  for (let i = 0; i < 4096; i++) {
    let sum = 0;
    for (let j = 0; j < 4096; j++) {
      sum += pixels[j] * Math.cos((Math.PI * i * (2 * j + 1)) / 8192);
    }
    hash += sum > 0 ? '1' : '0';

    // Yield to event loop every 100 iterations
    if (i % 100 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return hash;
}

// This allows other callbacks to process between chunks
// Better than nothing, but worker threads are preferred for heavy CPU work`,
			},
		],
		prevention: [
			"Use worker_threads for any CPU-intensive computation (>50ms)",
			"Monitor event loop lag - alert if consistently >100ms",
			"Profile code to identify synchronous bottlenecks before production",
			"Consider using a separate microservice for CPU-heavy tasks",
			"Use piscina or workerpool libraries for easy worker thread pooling",
			"Add event loop lag to health check responses",
		],
		educationalInsights: [
			"Node.js async/await doesn't make CPU-bound code non-blocking - only I/O",
			"The event loop processes callbacks between synchronous code chunks",
			"A single synchronous operation blocks ALL concurrent requests",
			"Worker threads run JavaScript on separate threads with separate event loops",
			"libuv thread pool (UV_THREADPOOL_SIZE) is for C++ async operations, not JS",
			"'async' keyword doesn't parallelize code - it just handles promises",
		],
	},
};

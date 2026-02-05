import type { DetectiveCase } from "../../types";

export const mysteriousMemoryLeak: DetectiveCase = {
	id: "mysterious-memory-leak",
	title: "The Mysterious Memory Leak",
	subtitle: "Memory usage climbs steadily but no leak in application code",
	difficulty: "principal",
	category: "memory",

	crisis: {
		description:
			"Production servers are running out of memory every 3-4 days, requiring restarts. Memory profiling shows no leaks in application code. The memory just... disappears into something.",
		impact:
			"Unplanned restarts every 3-4 days. 2-3 minute downtime per restart. Memory costs doubled due to oversized instances. Engineers spending days on wild goose chases.",
		timeline: [
			{ time: "Day 0", event: "Server restart, memory at 2GB", type: "normal" },
			{ time: "Day 1", event: "Memory at 6GB", type: "normal" },
			{ time: "Day 2", event: "Memory at 11GB", type: "warning" },
			{ time: "Day 3", event: "Memory at 14GB", type: "warning" },
			{ time: "Day 4", event: "OOM at 16GB, auto-restart", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Heap profiling shows stable memory",
			"No growing object counts",
			"GC running normally",
			"Application response times normal",
			"All tests pass with no memory issues",
		],
		broken: [
			"Process RSS (resident memory) grows steadily",
			"Growth continues even during low traffic",
			"Pattern repeats exactly after restart",
			"Memory never returns to baseline",
		],
	},

	clues: [
		{
			id: 1,
			title: "Memory Metrics Comparison",
			type: "metrics",
			content: `\`\`\`
Node.js Process Metrics (after 3 days):

Heap Used:      847 MB (stable)
Heap Total:     1,024 MB (stable)
External:       128 MB (stable)
Array Buffers:  64 MB (stable)

Process RSS:    14,234 MB (growing!)

The gap: 14,234 - 1,024 - 128 - 64 = 13,018 MB unaccounted for
\`\`\``,
			hint: "Where is the memory that's not in the heap?",
		},
		{
			id: 2,
			title: "Memory Map Analysis",
			type: "logs",
			content: `\`\`\`bash
$ pmap -x <pid> | head -50

Address           Kbytes     RSS   Dirty Mode
0000000000400000   47284   12420       0 r-x-- node
00007f1234560000  262144  262144  262144 rw---   [ anon ]
00007f1234970000  262144  262144  262144 rw---   [ anon ]
00007f1234d80000  262144  262144  262144 rw---   [ anon ]
00007f1235190000  262144  262144  262144 rw---   [ anon ]
... (hundreds more 256MB anonymous blocks)

Total:          14.2 GB

Note: Most memory is in anonymous 256MB blocks, not the node heap
\`\`\``,
		},
		{
			id: 3,
			title: "Application Dependencies",
			type: "config",
			content: `\`\`\`json
{
  "dependencies": {
    "express": "4.18.2",
    "sharp": "0.32.1",
    "node-canvas": "2.11.0",
    "pdfkit": "0.13.0",
    "puppeteer-core": "21.0.0",
    "better-sqlite3": "9.0.0"
  }
}
\`\`\``,
		},
		{
			id: 4,
			title: "Image Processing Service",
			type: "code",
			content: `\`\`\`typescript
class AvatarService {
  async processAvatar(imageBuffer: Buffer): Promise<Buffer> {
    // Resize and convert to webp
    const processed = await sharp(imageBuffer)
      .resize(256, 256)
      .webp({ quality: 80 })
      .toBuffer();

    return processed;
  }

  async generateThumbnails(imageBuffer: Buffer): Promise<Buffer[]> {
    const sizes = [32, 64, 128, 256];

    const thumbnails = await Promise.all(
      sizes.map(size =>
        sharp(imageBuffer)
          .resize(size, size)
          .webp({ quality: 80 })
          .toBuffer()
      )
    );

    return thumbnails;
  }
}

// Called ~10,000 times per day
\`\`\``,
		},
		{
			id: 5,
			title: "Sharp Library Research",
			type: "testimony",
			content: `"I found something interesting. Sharp uses libvips under the hood, which is a C library. According to the docs, libvips uses a per-thread cache for computed tiles. The default cache size is pretty large. And Node.js uses a thread pool for sharp operations..."`,
		},
		{
			id: 6,
			title: "Thread Pool Investigation",
			type: "metrics",
			content: `\`\`\`
UV_THREADPOOL_SIZE: 4 (default)

libvips thread cache (per thread):
- Default: 100 cached operations
- Each operation: ~50-100 MB for 4K images
- Per thread: up to 5-10 GB

But wait... we also use better-sqlite3 and puppeteer,
which also use the libuv thread pool.

Thread pool under load:
- Thread 1: sharp (avatar processing)
- Thread 2: sharp (thumbnail generation)
- Thread 3: better-sqlite3 (queries)
- Thread 4: puppeteer (PDF generation)

Threads don't share libvips cache. Each thread
accumulates its own cache independently.
\`\`\``,
			hint: "How many threads are accumulating this cache?",
		},
		{
			id: 7,
			title: "Production Configuration",
			type: "config",
			content: `\`\`\`bash
# Production env vars
NODE_ENV=production
UV_THREADPOOL_SIZE=64  # Increased for "performance"

# This means 64 threads, each with its own libvips cache
# 64 * 100-200 MB per thread = 6-13 GB of native cache
\`\`\``,
			hint: "64 threads × cache per thread = ?",
		},
	],

	solution: {
		diagnosis: "Memory fragmentation and native library cache accumulation in the libuv thread pool (libvips cache in sharp)",
		keywords: [
			"native",
			"fragmentation",
			"libvips",
			"sharp",
			"thread pool",
			"cache",
			"C library",
			"external memory",
			"RSS",
			"UV_THREADPOOL_SIZE",
		],
		rootCause: `This is a memory fragmentation issue caused by native library behavior, not a JavaScript memory leak.

The Sharp image processing library uses libvips, a C library. Libvips maintains an operation cache per thread to speed up repeated operations. The default cache is quite large (100 operations).

The production environment has UV_THREADPOOL_SIZE=64, meaning:
- 64 threads in the libuv thread pool
- Each thread running sharp operations builds its own libvips cache
- Each cache can grow to 100-200MB
- 64 × 200MB = 12.8GB of native memory

Additionally:
- Native memory isn't tracked by V8's heap metrics
- The glibc allocator doesn't return memory to the OS aggressively
- Memory becomes fragmented, making reclamation even harder

This explains why:
- Heap profiling shows stable memory (it's not on the heap)
- RSS grows even during low traffic (caches don't auto-shrink)
- Memory never returns to baseline (fragmentation + native caches)`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Configure sharp's cache limits",
				code: `import sharp from 'sharp';

// At application startup
sharp.cache({ memory: 50 });  // Limit to 50 MB
sharp.cache({ files: 0 });     // Disable file caching
sharp.concurrency(2);          // Limit concurrent operations

// Or disable cache entirely
sharp.cache(false);`,
			},
			{
				lang: "bash",
				description: "Tune thread pool and allocator",
				code: `# Reduce thread pool size
UV_THREADPOOL_SIZE=8

# Use jemalloc for better memory management
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2

# Or use mimalloc
LD_PRELOAD=/usr/lib/libmimalloc.so`,
			},
			{
				lang: "typescript",
				description: "Process images in a worker pool with limits",
				code: `import { Worker } from 'worker_threads';
import genericPool from 'generic-pool';

const workerPool = genericPool.createPool({
  create: () => new Worker('./image-worker.js'),
  destroy: (worker) => worker.terminate(),
}, {
  max: 4,               // Max 4 workers
  min: 1,               // Min 1 worker
  maxWaitingClients: 50,
  evictionRunIntervalMillis: 60000,
  idleTimeoutMillis: 300000,  // Kill idle workers after 5 min
});

async function processImage(buffer: Buffer): Promise<Buffer> {
  const worker = await workerPool.acquire();
  try {
    return await worker.process(buffer);
  } finally {
    workerPool.release(worker);
  }
}`,
			},
			{
				lang: "typescript",
				description: "Periodic worker recycling",
				code: `class ImageProcessor {
  private worker: Worker | null = null;
  private processCount = 0;
  private readonly MAX_PROCESSES_PER_WORKER = 1000;

  private async getWorker(): Promise<Worker> {
    if (!this.worker || this.processCount >= this.MAX_PROCESSES_PER_WORKER) {
      // Kill old worker
      if (this.worker) {
        await this.worker.terminate();
      }
      // Create fresh worker with clean memory
      this.worker = new Worker('./image-worker.js');
      this.processCount = 0;
    }
    return this.worker;
  }

  async process(buffer: Buffer): Promise<Buffer> {
    const worker = await this.getWorker();
    this.processCount++;
    return worker.process(buffer);
  }
}`,
			},
		],
		prevention: [
			"Understand native dependencies and their memory behavior",
			"Monitor RSS (resident memory), not just heap usage",
			"Configure native library caches explicitly",
			"Don't blindly increase UV_THREADPOOL_SIZE",
			"Use jemalloc/mimalloc for better native memory management",
			"Consider worker processes for heavy native operations",
			"Periodically recycle workers/processes for memory cleanup",
		],
		educationalInsights: [
			"Node.js memory ≠ V8 heap - native addons use separate memory",
			"RSS (Resident Set Size) includes all memory, heap is just part of it",
			"Thread pools multiply per-thread caches",
			"glibc's default allocator is bad at returning memory to the OS",
			"Memory fragmentation can make memory 'unreturnable' even when freed",
			"Native library defaults are often tuned for different use cases than yours",
			"Worker processes provide clean memory isolation",
		],
	},
};

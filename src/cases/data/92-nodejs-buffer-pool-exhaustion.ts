import type { DetectiveCase } from "../../types";

export const nodejsBufferPoolExhaustion: DetectiveCase = {
	id: "nodejs-buffer-pool-exhaustion",
	title: "The Buffer Overflow",
	subtitle: "Node.js crashes from allocating too many Buffers",
	difficulty: "mid",
	category: "memory",

	crisis: {
		description:
			"Your Node.js file processing service crashes with 'FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory' when handling concurrent file uploads. The crash happens even when processing files well within expected size limits.",
		impact:
			"Service crashes during peak upload times. File uploads lost mid-processing. Users frustrated with failed uploads. Business losing revenue from incomplete transactions.",
		timeline: [
			{ time: "09:00 AM", event: "Service restarted, normal operation", type: "normal" },
			{ time: "10:30 AM", event: "Upload traffic increasing", type: "normal" },
			{ time: "11:00 AM", event: "Memory usage climbing rapidly", type: "warning" },
			{ time: "11:15 AM", event: "Heap at 1.2GB, GC running constantly", type: "warning" },
			{ time: "11:23 AM", event: "OOM crash during bulk upload", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Small files upload successfully",
			"Single file uploads work fine",
			"Service works normally at low traffic",
			"No errors for small concurrent uploads",
			"Memory stable with light load",
		],
		broken: [
			"Crashes with OOM during concurrent uploads",
			"Memory spikes don't release",
			"Heap size grows unbounded",
			"GC cannot reclaim memory",
			"Large files or many files trigger crash",
		],
	},

	clues: [
		{
			id: 1,
			title: "Memory Profile During Crash",
			type: "metrics",
			content: `\`\`\`
$ node --inspect app.js
# Memory snapshot taken via Chrome DevTools

Memory Profile (before crash):
==============================
Heap Used: 1,423 MB / 1,536 MB (max)
External: 847 MB                    <-- HUGE external memory!

Top Retainers:
  (array) - 234,567,890 bytes
  Buffer - 178,234,567 bytes
  ArrayBuffer - 156,789,012 bytes
  Uint8Array - 134,567,890 bytes

# External memory is for Buffers - they're off-heap but counted against limit

Allocation Timeline:
  09:00 - Heap: 120MB, External: 45MB
  10:00 - Heap: 234MB, External: 123MB
  10:30 - Heap: 456MB, External: 345MB
  11:00 - Heap: 789MB, External: 567MB
  11:15 - Heap: 1.1GB, External: 789MB
  11:23 - CRASH

# Buffers created but never released
\`\`\``,
			hint: "External memory (Buffers) is growing without bound...",
		},
		{
			id: 2,
			title: "File Upload Handler Code",
			type: "code",
			content: `\`\`\`typescript
import express from 'express';
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),  // Store files in memory as Buffer
  limits: { fileSize: 50 * 1024 * 1024 }  // 50MB limit
});

const app = express();

app.post('/upload', upload.array('files', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  const results = await Promise.all(
    files.map(async (file) => {
      // File buffer kept in memory
      const buffer = file.buffer;

      // Process the file
      const processed = await processFile(buffer);

      // Upload to cloud storage
      await uploadToS3(processed);

      // Generate thumbnail
      const thumbnail = await generateThumbnail(buffer);
      await uploadToS3(thumbnail);

      return { filename: file.originalname, status: 'success' };
    })
  );

  res.json({ results });
});

async function processFile(buffer: Buffer): Promise<Buffer> {
  // Various transformations create new Buffers
  const compressed = await compress(buffer);      // New Buffer
  const encrypted = await encrypt(compressed);    // New Buffer
  const encoded = Buffer.from(encrypted);         // New Buffer
  return encoded;
}
\`\`\``,
			hint: "Multiple Buffers created for each file, all held in memory simultaneously...",
		},
		{
			id: 3,
			title: "Concurrent Upload Simulation",
			type: "logs",
			content: `\`\`\`
# Simulating 10 concurrent uploads of 20MB files each

Request 1: Receives 20MB file -> buffer created
Request 2: Receives 20MB file -> buffer created
Request 3: Receives 20MB file -> buffer created
...
Request 10: Receives 20MB file -> buffer created

# At this point: 200MB in upload buffers

Processing begins:
Request 1: processFile() creates 3 more buffers (~60MB)
Request 2: processFile() creates 3 more buffers (~60MB)
...
Request 10: processFile() creates 3 more buffers (~60MB)

# Memory state:
# - Original buffers: 200MB (still held by req.files)
# - Processed buffers: 600MB
# - Compressed buffers: ~150MB (still in scope)
# - Encrypted buffers: ~150MB (still in scope)
# - Total: ~1.1GB for just 200MB of uploads!

# And nothing can be GC'd until ALL requests complete
# Because Promise.all waits for everything
\`\`\``,
		},
		{
			id: 4,
			title: "Buffer Allocation Pattern",
			type: "logs",
			content: `\`\`\`
Buffer Memory Allocation in Node.js:

Small Buffers (<8KB):
├── Allocated from pre-allocated pool
├── Pool size: 8KB per slab
├── Efficient, reused automatically
└── GC'd when Buffer object is collected

Large Buffers (>=8KB):
├── Allocated directly via malloc()
├── NOT pooled
├── Counted as "external" memory
├── ONLY freed when Buffer is GC'd
└── V8 may not know about memory pressure

The Problem:
┌────────────────────────────────────────────────────────────┐
│  V8 Heap (managed)              │  External Memory (Buffers) │
│  Max: 1.5GB                     │  No hard limit!            │
│                                 │                            │
│  GC runs when heap is full      │  Not tracked by V8 GC      │
│                                 │  System can OOM before     │
│                                 │  V8 knows to collect       │
└────────────────────────────────────────────────────────────┘

# V8 sees heap at 500MB, thinks "plenty of room"
# But 1GB+ of Buffers are choking the system
\`\`\``,
			hint: "External memory (Buffers) isn't tracked the same way as heap objects",
		},
		{
			id: 5,
			title: "Process Memory vs Heap Memory",
			type: "metrics",
			content: `\`\`\`javascript
// Diagnostic code added to server
setInterval(() => {
  const used = process.memoryUsage();
  console.log({
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(used.external / 1024 / 1024) + 'MB',
    arrayBuffers: Math.round(used.arrayBuffers / 1024 / 1024) + 'MB',
    rss: Math.round(used.rss / 1024 / 1024) + 'MB'
  });
}, 5000);

// Output during incident:
{
  heapUsed: '456MB',      // V8 managed heap - looks fine
  heapTotal: '512MB',
  external: '1847MB',     // Buffers - THIS IS THE PROBLEM
  arrayBuffers: '1823MB', // Breakdown of external
  rss: '2456MB'           // Total process memory
}

// V8 heap is fine (456MB < limit)
// But total process memory (2.4GB) exceeds system limits
// OS kills the process, not V8 GC
\`\`\``,
		},
		{
			id: 6,
			title: "Junior Developer Testimony",
			type: "testimony",
			content: `"I used multer with memoryStorage because disk I/O seemed slow. The docs said it stores files as Buffers, which I thought was fine since Node.js handles memory automatically. I added Promise.all to process files in parallel for better performance. Each processing step creates a new Buffer because I didn't want to modify the original. I expected garbage collection to clean up the intermediate Buffers, but they seem to stick around. We increased --max-old-space-size to 4GB but it still crashes."`,
		},
	],

	solution: {
		diagnosis: "Buffer memory exhaustion from concurrent file processing holding too many large Buffers simultaneously",
		keywords: [
			"Buffer",
			"memory",
			"heap",
			"external memory",
			"multer",
			"memoryStorage",
			"OOM",
			"out of memory",
			"stream",
			"backpressure",
		],
		rootCause: `Multiple factors combine to cause the OOM:

1. **memoryStorage**: Every uploaded file is fully buffered in memory before processing starts. With 10 concurrent 20MB uploads, that's 200MB immediately.

2. **Processing creates copies**: Each transformation (compress, encrypt, encode) creates a NEW Buffer instead of transforming in place. One file spawns 4+ Buffers.

3. **Promise.all parallelism**: All files processed simultaneously. Nothing can be garbage collected until ALL promises resolve because references are held in the map() closures.

4. **External memory blindspot**: V8's garbage collector triggers based on heap pressure, but Buffers are "external" memory. V8 may not run GC aggressively enough because it doesn't "see" the Buffer memory.

5. **No backpressure**: The server accepts uploads as fast as clients can send. No mechanism limits concurrent processing.

Memory math:
- 10 files * 20MB = 200MB (uploads)
- Each file creates 4 Buffers during processing = 800MB
- S3 upload holds buffer until complete = still held
- Thumbnail generation creates more buffers = +200MB
- Total: 1.2GB+ for 200MB of actual data`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fix 1: Use streaming with disk storage",
				code: `import express from 'express';
import multer from 'multer';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

// Store files on disk, not memory
const upload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/uploads',
    filename: (req, file, cb) => cb(null, \`\${Date.now()}-\${file.originalname}\`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/upload', upload.array('files', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  // Process one at a time to limit memory
  const results = [];
  for (const file of files) {
    const result = await processFileStream(file.path);
    results.push({ filename: file.originalname, status: 'success' });

    // Clean up temp file immediately
    await fs.unlink(file.path);
  }

  res.json({ results });
});

async function processFileStream(filePath: string): Promise<void> {
  // Stream processing - never load entire file into memory
  const readStream = createReadStream(filePath);
  const compressStream = createGzip();
  const encryptStream = createCipher('aes-256-cbc', key);
  const uploadStream = createS3UploadStream(bucket, key);

  // Pipeline handles backpressure automatically
  await pipeline(readStream, compressStream, encryptStream, uploadStream);
}`,
			},
			{
				lang: "typescript",
				description: "Fix 2: Limit concurrency with p-limit",
				code: `import pLimit from 'p-limit';

// Process max 3 files concurrently
const limit = pLimit(3);

app.post('/upload', upload.array('files', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  // Limit concurrent processing
  const results = await Promise.all(
    files.map(file => limit(async () => {
      try {
        const result = await processFile(file.buffer);
        await uploadToS3(result);

        // Explicitly help GC by nulling references
        file.buffer = null as any;

        return { filename: file.originalname, status: 'success' };
      } catch (error) {
        return { filename: file.originalname, status: 'error' };
      }
    }))
  );

  // Force GC if available (run with --expose-gc)
  if (global.gc) {
    global.gc();
  }

  res.json({ results });
});`,
			},
			{
				lang: "typescript",
				description: "Fix 3: Process Buffers in-place when possible",
				code: `async function processFile(buffer: Buffer): Promise<Buffer> {
  // Reuse the same buffer when possible
  // Many crypto operations can work in-place

  // Instead of: const compressed = await compress(buffer);
  // Use a library that supports output buffer reuse
  const outputBuffer = Buffer.allocUnsafe(buffer.length);
  const compressedLength = await compressInto(buffer, outputBuffer);
  const compressed = outputBuffer.slice(0, compressedLength);

  // For operations that must create new buffers, size appropriately
  // Don't allocate more than needed
  const encrypted = Buffer.allocUnsafe(compressed.length + 16); // +16 for cipher overhead
  const encryptedLength = await encryptInto(compressed, encrypted);

  return encrypted.slice(0, encryptedLength);
}

// Use Buffer.allocUnsafe for performance when you'll overwrite all bytes
// Use Buffer.alloc only when you need zero-filled buffer`,
			},
			{
				lang: "typescript",
				description: "Fix 4: Memory-aware request handling",
				code: `import express from 'express';

const app = express();

// Track current memory pressure
let activeProcessing = 0;
const MAX_CONCURRENT = 5;
const MAX_MEMORY_MB = 1000;

function getMemoryMB(): number {
  const usage = process.memoryUsage();
  return Math.round((usage.heapUsed + usage.external) / 1024 / 1024);
}

// Middleware to reject requests under memory pressure
app.use('/upload', (req, res, next) => {
  const currentMemory = getMemoryMB();

  if (currentMemory > MAX_MEMORY_MB) {
    return res.status(503).json({
      error: 'Server under memory pressure, try again later',
      retryAfter: 30
    });
  }

  if (activeProcessing >= MAX_CONCURRENT) {
    return res.status(503).json({
      error: 'Too many concurrent uploads, try again later',
      retryAfter: 10
    });
  }

  activeProcessing++;
  res.on('finish', () => activeProcessing--);
  next();
});

// Monitor and log memory
setInterval(() => {
  const usage = process.memoryUsage();
  console.log(\`Memory: heap=\${Math.round(usage.heapUsed/1024/1024)}MB external=\${Math.round(usage.external/1024/1024)}MB\`);

  // Request GC if external memory is high
  if (usage.external > 500 * 1024 * 1024 && global.gc) {
    global.gc();
  }
}, 10000);`,
			},
		],
		prevention: [
			"Use disk or stream storage instead of memoryStorage for large files",
			"Limit concurrent file processing with semaphores (p-limit)",
			"Stream data through transformations instead of buffering",
			"Monitor process.memoryUsage().external for Buffer memory",
			"Implement backpressure to reject requests under memory pressure",
			"Set realistic --max-old-space-size based on actual workload",
		],
		educationalInsights: [
			"Buffer memory is 'external' to V8 heap - tracked differently",
			"V8 GC may not trigger from Buffer pressure alone",
			"memoryStorage is convenient but dangerous for large files",
			"Promise.all holds all references until everything completes",
			"Node.js streams handle backpressure automatically",
			"process.memoryUsage() shows heap vs external breakdown",
		],
	},
};

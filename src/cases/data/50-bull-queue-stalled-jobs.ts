import { DetectiveCase } from '../../types';

export const bullQueueStalledJobs: DetectiveCase = {
  id: 'bull-queue-stalled-jobs',
  title: 'The Bull Queue Stalled Jobs',
  subtitle: 'Jobs marked stalled due to process crash mid-execution',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `
      Your Node.js application uses Bull queue for processing image uploads.
      Users are complaining that their images are being processed twice, and
      some images appear corrupted. The monitoring shows jobs being marked
      as "stalled" and then retried, even though workers appear to be running.
    `,
    impact: `
      20% of images processed twice, causing duplicate entries. Some users
      charged twice for processing credits. 5% of images corrupted due to
      concurrent writes. User trust declining.
    `,
    timeline: [
      { time: '10:00 AM', event: 'Traffic spike from viral social media post', type: 'normal' },
      { time: '10:15 AM', event: 'Memory usage on workers climbing', type: 'warning' },
      { time: '10:30 AM', event: 'First OOM kill on worker pod', type: 'warning' },
      { time: '10:35 AM', event: 'Stalled jobs appearing in dashboard', type: 'critical' },
      { time: '10:45 AM', event: 'Duplicate image reports from users', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Redis is healthy and responsive',
      'Bull dashboard accessible',
      'New jobs being added to queue',
      'Workers appear to be running (pods show Running)',
      'Some jobs completing successfully'
    ],
    broken: [
      'Jobs being marked as "stalled"',
      'Same job_id appearing multiple times in completed list',
      'Worker pods restarting due to OOM',
      'Lock expire warnings in logs',
      'Image files being written twice concurrently'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Bull Queue Dashboard Stats',
      type: 'metrics',
      content: `
## Queue: image-processing

| Status | Count |
|--------|-------|
| Waiting | 2,456 |
| Active | 12 |
| Completed | 45,678 |
| Failed | 234 |
| Delayed | 0 |
| **Stalled** | **847** |

## Stalled Job Details
- Average time before stalled: 45 seconds
- Most stalled jobs were processing large images (>10MB)
- Stalled jobs automatically retried (default behavior)
      `,
      hint: 'Stalled jobs are those that disappeared without completing or failing'
    },
    {
      id: 2,
      title: 'Worker Process Code',
      type: 'code',
      content: `
\`\`\`javascript
// worker.js
const Queue = require('bull');
const sharp = require('sharp');

const imageQueue = new Queue('image-processing', {
  redis: { host: 'redis', port: 6379 },
  settings: {
    lockDuration: 30000,       // 30 seconds
    stalledInterval: 30000,    // Check for stalled every 30s
    maxStalledCount: 1,        // Retry stalled job once
  }
});

imageQueue.process(4, async (job) => {
  const { imageId, imageBuffer } = job.data;

  // Load image into memory (can be 50MB+ for large images)
  const image = sharp(Buffer.from(imageBuffer, 'base64'));

  // Process (resize, compress, watermark)
  const processed = await image
    .resize(1920, 1080, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Upload to S3
  await uploadToS3(imageId, processed);

  return { imageId, size: processed.length };
});
\`\`\`
      `,
      hint: 'lockDuration is 30 seconds, but processing large images takes longer'
    },
    {
      id: 3,
      title: 'Worker Pod Logs',
      type: 'logs',
      content: `
\`\`\`
10:30:15 [worker-1] Processing job 12345 (image: 15MB)
10:30:45 [worker-1] WARN: Lock for job 12345 is about to expire
10:31:00 [worker-1] Job 12345 lock expired, job may be picked up by another worker
10:31:15 [worker-1] Still processing job 12345...
10:31:30 [worker-2] Picked up stalled job 12345
10:31:45 [worker-1] Completed job 12345, uploading to S3
10:31:46 [worker-2] Processing job 12345 (image: 15MB)
10:31:47 [worker-1] Job 12345 completed successfully
10:32:00 [worker-2] Completed job 12345, uploading to S3
10:32:01 [worker-2] Job 12345 completed successfully

# Two workers processed the same job!
\`\`\`
      `,
      hint: 'The lock expired while the first worker was still processing'
    },
    {
      id: 4,
      title: 'Bull Lock Mechanism Documentation',
      type: 'config',
      content: `
\`\`\`
## Bull Queue Lock Mechanism

When a worker picks up a job:
1. Bull sets a lock in Redis with TTL = lockDuration
2. Worker must renew the lock periodically
3. If lock expires (worker crashed or too slow), job is "stalled"
4. Stalled jobs are automatically retried by other workers

Key settings:
- lockDuration: How long the lock is valid (default: 30s)
- stalledInterval: How often to check for stalled jobs (default: 30s)
- maxStalledCount: How many times to retry a stalled job (default: 1)

The lock is automatically renewed while job.progress() or
job.log() is called. But if your job just runs CPU-bound
code without calling these, the lock may expire!
\`\`\`
      `,
      hint: 'CPU-bound jobs dont automatically renew their locks'
    },
    {
      id: 5,
      title: 'Memory and Processing Stats',
      type: 'metrics',
      content: `
## Worker Performance

| Image Size | Processing Time | Memory Used |
|------------|-----------------|-------------|
| 1MB | 5s | 150MB |
| 5MB | 25s | 350MB |
| 10MB | 55s | 600MB |
| 15MB | 85s | 850MB |

## Pod Resources
- Memory limit: 1GB
- CPU limit: 1 core
- Workers per pod: 4 (concurrency: 4)
- Peak memory with 4 jobs: 4 * 850MB = 3.4GB (exceeds limit!)

## OOM Events (last hour)
- worker-pod-1: 3 OOM kills
- worker-pod-2: 2 OOM kills
- worker-pod-3: 4 OOM kills
      `,
      hint: 'Processing takes longer than lock duration, and memory causes crashes'
    },
    {
      id: 6,
      title: 'Junior Developer Testimony',
      type: 'testimony',
      content: `
> "I set lockDuration to 30 seconds because that's what the tutorial used.
> I didn't realize image processing could take over a minute for large files."
>
> "The sharp library is doing all the work. I didn't know I needed to call
> job.progress() or anything - the examples I saw just processed and returned."
>
> "We're processing 4 images at once per pod to maximize throughput. The
> memory limits seemed fine based on single-image testing."
>
> "I thought Bull would automatically handle crashes, but I didn't expect
> it would retry jobs that were still running on another worker."
>
> — Alex, Junior Developer
      `,
      hint: 'Lock duration and concurrency settings werent tuned for actual workload'
    }
  ],

  solution: {
    diagnosis: 'Lock duration shorter than processing time, causing jobs to be marked stalled and retried while original worker still processing',

    keywords: [
      'stalled', 'lock', 'lockDuration', 'bull', 'redis', 'duplicate',
      'concurrency', 'OOM', 'progress', 'retry', 'stalledInterval'
    ],

    rootCause: `
      Bull queue uses Redis locks to track job ownership. When a worker picks up a job,
      it acquires a lock with a TTL (lockDuration). If the lock expires before the job
      completes, Bull assumes the worker crashed and marks the job as "stalled."

      Two problems combined to cause duplicates:

      1. **Lock expiration during processing**: lockDuration was 30 seconds, but large
         images took 55-85 seconds to process. The lock expired mid-processing, allowing
         another worker to pick up the "stalled" job while the original was still working.

      2. **OOM crashes**: With concurrency=4 and up to 850MB per job, total memory
         could reach 3.4GB, exceeding the 1GB pod limit. OOM kills caused abrupt
         termination without job failure, leading to legitimate stalls that were
         then retried.

      The combination meant jobs were processed twice - once by the timed-out original
      worker and once by the worker that picked up the "stalled" job.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Fixed worker with proper lock duration and progress updates',
        code: `const Queue = require('bull');
const sharp = require('sharp');

const imageQueue = new Queue('image-processing', {
  redis: { host: 'redis', port: 6379 },
  settings: {
    // Increase lock duration to cover worst-case processing time + buffer
    lockDuration: 300000,      // 5 minutes
    stalledInterval: 60000,    // Check every 60s (less aggressive)
    maxStalledCount: 2,        // Allow 2 retries for legitimate crashes

    // Reduce lock renewal interval
    lockRenewTime: 30000,      // Renew lock every 30s (default: lockDuration/2)
  }
});

imageQueue.process(1, async (job) => {  // Reduced concurrency!
  const { imageId, imageBuffer } = job.data;

  job.progress(0);  // Signal we're starting

  const image = sharp(Buffer.from(imageBuffer, 'base64'));

  job.progress(25);  // Progress updates renew the lock!

  const processed = await image
    .resize(1920, 1080, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();

  job.progress(75);

  await uploadToS3(imageId, processed);

  job.progress(100);

  return { imageId, size: processed.length };
});`
      },
      {
        lang: 'javascript',
        description: 'Idempotent job processing to handle duplicates safely',
        code: `const Queue = require('bull');
const Redis = require('ioredis');

const redis = new Redis();
const imageQueue = new Queue('image-processing');

imageQueue.process(1, async (job) => {
  const { imageId, imageBuffer } = job.data;

  // Idempotency check using Redis
  const processingKey = \`processing:\${imageId}\`;
  const completedKey = \`completed:\${imageId}\`;

  // Check if already completed
  if (await redis.get(completedKey)) {
    console.log(\`Job \${job.id} for image \${imageId} already completed, skipping\`);
    return { imageId, status: 'duplicate', skipped: true };
  }

  // Try to acquire processing lock (atomic)
  const acquired = await redis.set(processingKey, job.id, 'NX', 'EX', 600);

  if (!acquired) {
    // Another worker is processing this image
    const currentProcessor = await redis.get(processingKey);
    console.log(\`Image \${imageId} being processed by job \${currentProcessor}\`);
    return { imageId, status: 'in_progress', skipped: true };
  }

  try {
    // Actual processing
    const processed = await processImage(imageBuffer);
    await uploadToS3(imageId, processed);

    // Mark as completed
    await redis.set(completedKey, '1', 'EX', 86400);  // 24h TTL

    return { imageId, size: processed.length };
  } finally {
    // Release processing lock
    await redis.del(processingKey);
  }
});`
      },
      {
        lang: 'yaml',
        description: 'Kubernetes deployment with appropriate resources',
        code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: image-worker
spec:
  replicas: 4  # More pods with lower concurrency each
  template:
    spec:
      containers:
      - name: worker
        image: image-worker:v2
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"   # 2x headroom for large images
            cpu: "1000m"
        env:
        - name: BULL_CONCURRENCY
          value: "1"        # Only 1 job at a time per pod
        - name: BULL_LOCK_DURATION
          value: "300000"   # 5 minutes
        # Graceful shutdown for in-progress jobs
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 30"]
      terminationGracePeriodSeconds: 300`
      }
    ],

    prevention: [
      'Set lockDuration to worst-case processing time + 50% buffer',
      'Call job.progress() periodically to renew locks during long processing',
      'Reduce concurrency if jobs are memory-intensive',
      'Size pod memory limits based on concurrent job memory requirements',
      'Implement idempotency in job handlers to handle duplicate execution safely',
      'Monitor stalled job metrics and alert on increases',
      'Use separate queues for different job sizes (small/medium/large)',
      'Test with production-like job sizes and concurrency before deployment'
    ],

    educationalInsights: [
      'Bull locks prevent duplicate processing, but only if configured correctly',
      'CPU-bound jobs dont automatically renew locks - must call progress()',
      'Stalled != failed - stalled means "we lost track of this job"',
      'Concurrency * memory-per-job must fit within pod memory limits',
      'Idempotency is the safety net when locks fail',
      'OOM kills are silent job failures that trigger stall detection'
    ]
  }
};

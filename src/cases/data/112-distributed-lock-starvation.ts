import { DetectiveCase } from '../../types';

export const distributedLockStarvation: DetectiveCase = {
  id: 'distributed-lock-starvation',
  title: 'The Distributed Lock Starvation',
  subtitle: 'Some processes never acquiring locks while others monopolize',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your distributed job processing system uses Redis for lock coordination. Workers should
      take turns processing jobs, but some workers are processing thousands of jobs while
      others have processed zero in hours. Jobs are timing out because they're waiting for
      workers that never get scheduled. The "fair" lock distribution is anything but fair.
    `,
    impact: `
      30% of job processors starved - processing zero jobs. Job completion SLAs violated.
      Processing capacity effectively reduced by 30%. Customer data exports delayed 4+ hours.
      Uneven load causing some workers to OOM while others idle.
    `,
    timeline: [
      { time: '9:00 AM', event: 'Daily batch processing begins', type: 'normal' },
      { time: '9:30 AM', event: 'Workers report uneven job distribution', type: 'warning' },
      { time: '10:00 AM', event: 'Some workers have 0 jobs processed', type: 'warning' },
      { time: '11:00 AM', event: 'Job queue backing up despite available workers', type: 'critical' },
      { time: '12:00 PM', event: 'SLA violations for data exports', type: 'critical' },
      { time: '1:00 PM', event: 'Root cause identified, fix deployed', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Redis lock server healthy and responsive',
      'Lock acquire/release operations succeed',
      'Some workers processing at full capacity',
      'Job queue has work available'
    ],
    broken: [
      'Certain workers never acquire locks',
      'Lock distribution heavily skewed to subset of workers',
      'Starved workers continuously retry without success',
      'Job processing throughput below expected capacity'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Worker Job Distribution',
      type: 'metrics',
      content: `
\`\`\`
# Jobs processed per worker (last 4 hours)

| Worker ID | Jobs Processed | Lock Acquires | Lock Failures |
|-----------|----------------|---------------|---------------|
| worker-01 | 4,521 | 4,521 | 12 |
| worker-02 | 4,387 | 4,387 | 8 |
| worker-03 | 4,412 | 4,412 | 15 |
| worker-04 | 0 | 0 | 23,847 |
| worker-05 | 0 | 0 | 24,102 |
| worker-06 | 0 | 0 | 23,956 |
| worker-07 | 4,298 | 4,298 | 11 |
| worker-08 | 4,445 | 4,445 | 9 |
| worker-09 | 0 | 0 | 24,421 |
| worker-10 | 4,502 | 4,502 | 14 |

# 3 of 10 workers have processed ZERO jobs
# But they've tried 24,000+ times each (100% failure rate)
# Meanwhile, successful workers have <1% failure rate
\`\`\`
      `,
      hint: 'Three workers have 100% failure rate on lock acquisition'
    },
    {
      id: 2,
      title: 'Lock Acquisition Code',
      type: 'code',
      content: `
\`\`\`typescript
// job-processor/src/lock/redis-lock.ts

class RedisDistributedLock {
  async acquire(lockKey: string, ttl: number): Promise<boolean> {
    // Try to set lock with NX (only if not exists)
    const result = await this.redis.set(
      lockKey,
      this.workerId,
      'PX', ttl,
      'NX'
    );

    return result === 'OK';
  }

  async release(lockKey: string): Promise<void> {
    // Only release if we own the lock
    const script = \`
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    \`;
    await this.redis.eval(script, 1, lockKey, this.workerId);
  }
}

// Worker loop
async function processJobs() {
  while (true) {
    const job = await getNextJob();
    const lockKey = \`job:\${job.id}:lock\`;

    // Try to acquire lock
    const acquired = await lock.acquire(lockKey, 30000);

    if (acquired) {
      await processJob(job);
      await lock.release(lockKey);
    } else {
      // Lock taken, try next job immediately
      continue;
    }
  }
}
\`\`\`
      `,
      hint: 'Lock acquisition has no fairness mechanism - first to execute wins'
    },
    {
      id: 3,
      title: 'Network Timing Analysis',
      type: 'metrics',
      content: `
\`\`\`
# Redis latency from each worker

| Worker | Redis Latency (p50) | Redis Latency (p99) |
|--------|---------------------|---------------------|
| worker-01 | 0.3ms | 1.2ms |
| worker-02 | 0.3ms | 1.1ms |
| worker-03 | 0.4ms | 1.3ms |
| worker-04 | 2.1ms | 8.5ms |
| worker-05 | 2.3ms | 9.2ms |
| worker-06 | 2.0ms | 8.1ms |
| worker-07 | 0.4ms | 1.4ms |
| worker-08 | 0.3ms | 1.2ms |
| worker-09 | 2.2ms | 8.8ms |
| worker-10 | 0.3ms | 1.3ms |

# Workers 4, 5, 6, 9 have 6-7x higher latency to Redis
# Same workers that are starving!

# Infrastructure check:
# Workers 1-3, 7-8, 10: us-east-1a (same AZ as Redis)
# Workers 4-6, 9: us-east-1b (different AZ)
\`\`\`
      `,
      hint: 'Cross-AZ workers have 7x latency and are the ones starving'
    },
    {
      id: 4,
      title: 'Race Condition Visualization',
      type: 'testimony',
      content: `
"Here's what's happening in slow motion:

Job J1 becomes available at T=0

T=0.0ms: Worker-01 (fast) sees J1, sends SETNX
T=0.0ms: Worker-04 (slow) sees J1, sends SETNX

T=0.3ms: Worker-01's SETNX arrives at Redis
T=0.3ms: Redis executes SETNX for Worker-01 -> SUCCESS
T=0.6ms: Worker-01 receives success, starts processing

T=2.1ms: Worker-04's SETNX finally arrives at Redis
T=2.1ms: Redis executes SETNX for Worker-04 -> FAIL (lock exists)
T=4.2ms: Worker-04 receives failure

The race is decided by network latency. The 2ms head start for Worker-01
means it ALWAYS wins against Worker-04.

Since job assignment and lock acquisition happen in a tight loop:
- Fast workers grab jobs, process, release, grab next
- Slow workers are always ~2ms behind, always lose the race
- Every single time.

It's not random - it's deterministically unfair based on network topology."
      `
    },
    {
      id: 5,
      title: 'Lock Contention Pattern',
      type: 'logs',
      content: `
\`\`\`
# Trace of lock attempts for job-12345

[09:15:00.000] job-12345 added to queue
[09:15:00.001] worker-01: Attempting lock for job-12345
[09:15:00.001] worker-04: Attempting lock for job-12345
[09:15:00.001] worker-07: Attempting lock for job-12345

[09:15:00.301] worker-01: Lock acquired (latency: 0.3ms)
[09:15:00.401] worker-07: Lock failed (latency: 0.4ms)
[09:15:02.101] worker-04: Lock failed (latency: 2.1ms)

# worker-01 won because it reached Redis first
# By the time worker-04's request arrived, lock was already held

# This pattern repeats for EVERY job
# Cross-AZ workers lose 100% of races
\`\`\`
      `,
      hint: 'Network latency determines winner, cross-AZ always loses'
    },
    {
      id: 6,
      title: 'Unfair Lock vs Fair Lock',
      type: 'code',
      content: `
\`\`\`typescript
// CURRENT: Unfair lock (first request wins)
async acquire(lockKey: string): Promise<boolean> {
  return await this.redis.set(lockKey, this.workerId, 'NX') === 'OK';
}
// Problem: Fastest network always wins

// FAIR: Queue-based lock (FIFO ordering)
async acquireFair(lockKey: string): Promise<boolean> {
  const queueKey = \`\${lockKey}:queue\`;
  const myTicket = Date.now() + '-' + this.workerId;

  // Add self to queue
  await this.redis.zadd(queueKey, Date.now(), myTicket);

  // Wait for turn
  while (true) {
    const queue = await this.redis.zrange(queueKey, 0, 0);
    if (queue[0] === myTicket) {
      // Our turn! Acquire lock
      await this.redis.set(lockKey, this.workerId, 'PX', 30000);
      return true;
    }
    await sleep(50); // Wait and check again
  }
}

// Problem: Fair but slow, still has thundering herd on queue check

// BETTER: Job assignment without lock contention
// Partition jobs by worker, eliminate races entirely
\`\`\`
      `,
      hint: 'Solutions include fair queuing or eliminating contention via partitioning'
    }
  ],

  solution: {
    diagnosis: 'Distributed lock acquisition favoring workers with lower network latency, causing cross-AZ workers to starve',

    keywords: [
      'distributed lock', 'starvation', 'fairness', 'latency', 'race condition',
      'redis', 'setnx', 'network topology', 'availability zone', 'contention'
    ],

    rootCause: `
      The distributed lock implementation had no fairness mechanism. Lock acquisition
      was purely "first request to reach Redis wins." This created systematic starvation
      based on network topology:

      1. **Network Latency Disparity**: Workers in us-east-1a had 0.3ms latency to Redis.
         Workers in us-east-1b had 2.1ms latency (different availability zone).

      2. **Deterministic Races**: When multiple workers contended for the same job,
         the fastest network connection always won. 0.3ms beats 2.1ms every time.

      3. **Tight Loop Amplification**: Workers immediately tried the next job after
         a failed lock attempt. But the "fast" workers were already done processing
         and grabbing the next job, so slow workers were perpetually behind.

      4. **Zero Fairness**: Redis SETNX has no queuing - simultaneous requests are
         resolved by arrival order, which is determined by network latency.

      This resulted in 30% of workers (those in the different AZ) processing zero
      jobs while workers with faster connections processed thousands.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Partition jobs to workers to eliminate contention',
        code: `// Best solution: Remove contention entirely via partitioning
class PartitionedJobProcessor {
  constructor(
    private workerId: string,
    private totalWorkers: number
  ) {}

  async getNextJob(): Promise<Job | null> {
    // Each worker owns a partition of jobs
    // No lock needed - jobs are pre-assigned

    // Option 1: Partition by job ID hash
    const myPartition = this.getPartition(this.workerId);

    // Only fetch jobs in my partition
    const job = await this.jobQueue.fetchOne({
      partition: myPartition
    });

    return job;
  }

  private getPartition(workerId: string): number {
    // Consistent hashing or simple modulo
    return hashCode(workerId) % this.totalWorkers;
  }
}

// When adding jobs to queue, assign partition:
async function enqueueJob(job: Job) {
  // Distribute evenly across partitions
  job.partition = hashCode(job.id) % TOTAL_PARTITIONS;
  await jobQueue.push(job);
}

// Result:
// - Worker-01 only processes partition 0
// - Worker-02 only processes partition 1
// - No contention, no locks needed
// - Fair by construction`
      },
      {
        lang: 'typescript',
        description: 'Use Redlock with randomized retry',
        code: `// If locks are required, use randomized backoff
import Redlock from 'redlock';

const redlock = new Redlock([redis], {
  retryCount: 10,
  retryDelay: 200,       // Base delay
  retryJitter: 200,      // Random jitter up to this value
  automaticExtension: true
});

class FairerLock {
  async acquire(lockKey: string, ttl: number): Promise<Lock | null> {
    try {
      // Redlock adds jitter automatically
      // Spreads retries over time, reduces deterministic losing
      return await redlock.acquire([lockKey], ttl);
    } catch (error) {
      if (error.name === 'LockError') {
        return null;
      }
      throw error;
    }
  }
}

// Additionally, add pre-acquire delay based on worker position
async function processJobsWithFairness() {
  while (true) {
    const job = await getNextJob();

    // Add random delay before attempting lock
    // Spreads workers over time, gives slow workers a chance
    await sleep(Math.random() * 50);

    const lock = await fairerLock.acquire(\`job:\${job.id}\`, 30000);
    if (lock) {
      await processJob(job);
      await lock.release();
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Fair queue-based lock with ticket system',
        code: `// Implement fair FIFO lock using Redis sorted set
class FairDistributedLock {
  async acquire(lockKey: string, timeout: number): Promise<boolean> {
    const queueKey = \`\${lockKey}:queue\`;
    const ticket = \`\${Date.now()}-\${this.workerId}-\${Math.random()}\`;
    const deadline = Date.now() + timeout;

    // Get in line with timestamp as score
    await this.redis.zadd(queueKey, Date.now(), ticket);

    try {
      while (Date.now() < deadline) {
        // Am I first in line?
        const first = await this.redis.zrange(queueKey, 0, 0);

        if (first[0] === ticket) {
          // My turn! Set the actual lock
          const acquired = await this.redis.set(
            lockKey,
            this.workerId,
            'PX', 30000,
            'NX'
          );

          if (acquired === 'OK') {
            return true;
          }
        }

        // Wait with jitter
        await sleep(50 + Math.random() * 50);
      }

      return false; // Timeout

    } finally {
      // Clean up queue entry if we didn't get lock
      await this.redis.zrem(queueKey, ticket);
    }
  }
}

// FIFO ordering ensures fairness regardless of latency
// First to join queue wins, not first to reach Redis`
      },
      {
        lang: 'typescript',
        description: 'Work stealing with locality preference',
        code: `// Workers prefer local jobs but can steal from others
class WorkStealingProcessor {
  constructor(
    private workerId: string,
    private localPartition: number,
    private totalPartitions: number
  ) {}

  async getNextJob(): Promise<Job | null> {
    // First, try local partition (no contention)
    let job = await this.jobQueue.fetchOne({
      partition: this.localPartition
    });

    if (job) return job;

    // Local queue empty - steal from others
    // Try random partitions to avoid thundering herd
    const partitionsToTry = this.getRandomPartitions(3);

    for (const partition of partitionsToTry) {
      // Need lock to steal from other partition
      const lockKey = \`partition:\${partition}:steal\`;

      const acquired = await this.lock.acquire(lockKey, 5000);
      if (acquired) {
        try {
          job = await this.jobQueue.fetchOne({ partition });
          if (job) return job;
        } finally {
          await this.lock.release(lockKey);
        }
      }
    }

    return null;
  }

  private getRandomPartitions(count: number): number[] {
    const partitions = [];
    for (let i = 0; i < this.totalPartitions; i++) {
      if (i !== this.localPartition) {
        partitions.push(i);
      }
    }
    // Shuffle and take first 'count'
    return shuffle(partitions).slice(0, count);
  }
}

// Benefits:
// - Primary work is contention-free (local partition)
// - Stealing provides elasticity for imbalanced load
// - Random selection avoids deterministic stealing patterns`
      }
    ],

    prevention: [
      'Avoid lock contention by partitioning work to workers',
      'Deploy workers in same AZ as lock server to minimize latency variance',
      'Use fair queuing mechanisms if locks are required',
      'Add randomized delays before lock acquisition attempts',
      'Monitor lock acquisition success rate per worker',
      'Alert on starvation patterns (workers with 0% success)',
      'Use work-stealing patterns for load balancing without central contention',
      'Consider dedicated lock servers per AZ for large deployments'
    ],

    educationalInsights: [
      'Distributed locks favor low-latency connections - starvation is deterministic',
      'SETNX-based locks have no fairness - first arrival wins every time',
      'Network topology creates systematic bias in lock acquisition',
      'Partitioning eliminates contention and is fairer than locks',
      'Work stealing combines efficiency of partitioning with elasticity',
      'Random jitter helps but doesn\'t fully fix latency-based unfairness',
      'Fair locks require explicit queuing at the cost of complexity',
      'Starvation wastes resources - starved workers burn CPU retrying'
    ]
  }
};

import { DetectiveCase } from '../../types';

export const celeryVisibilityTimeout: DetectiveCase = {
  id: 'celery-visibility-timeout',
  title: 'The Celery Task Visibility',
  subtitle: 'Tasks getting executed twice due to visibility timeout',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your Django application uses Celery with Redis for background task processing.
      Users are complaining about receiving duplicate emails - welcome emails, password
      resets, and order confirmations are all being sent twice. The duplicates arrive
      exactly 1 hour apart.
    `,
    impact: `
      8,000 duplicate emails sent daily. Users flagging emails as spam. Email
      deliverability score dropping. Some users received duplicate charges for
      orders processed twice.
    `,
    timeline: [
      { time: 'Week 1', event: 'New video processing task deployed (runs 2+ hours)', type: 'normal' },
      { time: 'Week 2', event: 'First duplicate email complaints', type: 'warning' },
      { time: 'Week 3', event: 'Duplicate complaints increasing daily', type: 'warning' },
      { time: 'Week 4', event: 'Discovered pattern: duplicates exactly 1 hour apart', type: 'critical' },
      { time: 'Week 4', event: 'Two duplicate order charges discovered', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Tasks are being executed successfully',
      'Redis is healthy and responsive',
      'Celery workers show no errors',
      'Task results are correct',
      'No crashes or restarts observed'
    ],
    broken: [
      'Some tasks executed exactly twice',
      'Duplicate executions 1 hour apart',
      'Long-running tasks affected more than short ones',
      'Task acknowledgment seems to fail silently',
      'Celery flower shows same task_id executed twice'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Celery Configuration',
      type: 'config',
      content: `
\`\`\`python
# celery.py

from celery import Celery

app = Celery('myapp')

app.conf.update(
    broker_url='redis://localhost:6379/0',
    result_backend='redis://localhost:6379/0',
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='UTC',
    enable_utc=True,

    # Default visibility timeout (how long until task is re-queued if not acked)
    # broker_transport_options not set, using Redis default
)

# Note: broker_transport_options.visibility_timeout not explicitly configured
\`\`\`
      `,
      hint: 'What is the default visibility timeout for Redis broker?'
    },
    {
      id: 2,
      title: 'Task Execution Logs',
      type: 'logs',
      content: `
\`\`\`
[2024-01-15 10:00:00] Task send_welcome_email[abc123] received
[2024-01-15 10:00:01] Task send_welcome_email[abc123] succeeded in 0.5s

[2024-01-15 10:00:00] Task process_video[def456] received
[2024-01-15 12:15:00] Task process_video[def456] succeeded in 2h15m

[2024-01-15 11:00:00] Task send_welcome_email[abc123] received  <-- DUPLICATE!
[2024-01-15 11:00:01] Task send_welcome_email[abc123] succeeded in 0.5s

[2024-01-15 11:00:00] Task process_video[def456] received  <-- DUPLICATE!
[2024-01-15 13:10:00] Task process_video[def456] succeeded in 2h10m
\`\`\`

Pattern: Tasks re-received exactly 1 hour after first receipt
      `,
      hint: 'The 1-hour gap is significant - its the default visibility timeout'
    },
    {
      id: 3,
      title: 'Redis Visibility Timeout Documentation',
      type: 'config',
      content: `
\`\`\`
# Celery Redis Broker - Visibility Timeout

When using Redis as a broker, Celery uses a "visibility timeout"
mechanism to handle task acknowledgment:

1. Worker fetches task from Redis queue
2. Task becomes "invisible" to other workers for visibility_timeout seconds
3. If worker ACKs before timeout: task is removed from queue
4. If worker doesn't ACK before timeout: task becomes visible again

DEFAULT visibility_timeout: 3600 seconds (1 hour)

This is a safety mechanism to handle worker crashes, but it causes
problems if tasks run longer than the timeout:

- Task starts, runs for 2 hours
- After 1 hour, task reappears in queue (visibility timeout)
- Another worker picks up the same task
- Now TWO workers are running the same task
- Both complete successfully = DUPLICATE EXECUTION
\`\`\`
      `,
      hint: 'Tasks running longer than visibility_timeout will be executed twice'
    },
    {
      id: 4,
      title: 'Video Processing Task',
      type: 'code',
      content: `
\`\`\`python
# tasks.py

@app.task(bind=True)
def process_video(self, video_id):
    """Process uploaded video - can take 1-4 hours."""
    video = Video.objects.get(id=video_id)

    # Download from S3
    download_video(video.s3_key)           # 5-10 minutes

    # Transcode to multiple formats
    transcode_video(video.local_path)      # 30-120 minutes

    # Generate thumbnails
    generate_thumbnails(video.local_path)  # 10-30 minutes

    # Upload results
    upload_results(video.id)               # 5-15 minutes

    return {'status': 'complete', 'video_id': video_id}


@app.task
def send_welcome_email(user_id):
    """Send welcome email - takes <1 second."""
    user = User.objects.get(id=user_id)
    send_email(user.email, 'Welcome!', 'welcome_template.html')
    return {'status': 'sent', 'user_id': user_id}
\`\`\`
      `,
      hint: 'Video processing takes 1-4 hours, but visibility timeout is 1 hour'
    },
    {
      id: 5,
      title: 'Celery Worker Configuration',
      type: 'config',
      content: `
\`\`\`bash
# Worker startup command
celery -A myapp worker -l info --concurrency=4

# Worker prefetch settings (current)
worker_prefetch_multiplier = 4  # default

# What this means:
# - Each worker prefetches 4 * concurrency = 16 tasks
# - Prefetched tasks are "invisible" in Redis
# - If worker is busy, prefetched tasks wait in local queue
# - Visibility timeout still applies to prefetched tasks!
\`\`\`
      `,
      hint: 'Prefetching can make visibility timeout issues worse'
    },
    {
      id: 6,
      title: 'DevOps Engineer Testimony',
      type: 'testimony',
      content: `
> "The video processing feature was added last month. Before that, all our
> tasks completed in under a minute, so we never noticed this issue."
>
> "I read that Redis broker uses visibility timeout, but I thought Celery
> would automatically extend it or something. I didn't realize we needed
> to configure it explicitly."
>
> "The weird thing is, the email tasks are fast (under 1 second), but they
> still get duplicated. Maybe because they get prefetched while a long
> video task is running?"
>
> "We're using acks_late=False (the default), so tasks are acknowledged
> when received, not when completed. But somehow they still duplicate..."
>
> — Tom, DevOps Engineer
      `,
      hint: 'The default acks_late=False should ack immediately, but visibility timeout can still cause issues'
    }
  ],

  solution: {
    diagnosis: 'Redis visibility timeout (1 hour) shorter than task execution time, causing task re-delivery',

    keywords: [
      'visibility timeout', 'duplicate', 'redis', 'celery', 'acknowledgment',
      'acks_late', 'broker_transport_options', 'redelivery', 'prefetch',
      'idempotent', 'task_acks_late'
    ],

    rootCause: `
      Celery with Redis broker uses a "visibility timeout" to handle worker failures.
      When a task is fetched, it becomes invisible for 1 hour (default). If not
      acknowledged within that window, Redis makes it visible again for other workers.

      The chain of events:
      1. Worker fetches video processing task
      2. Task starts running (will take 2+ hours)
      3. After 1 hour, visibility timeout expires
      4. Redis makes task visible again
      5. Another worker (or same worker) fetches "new" task
      6. Both workers complete the task = duplicate execution

      Even fast tasks like send_welcome_email can be duplicated because:
      - Worker prefetches multiple tasks
      - Long-running task blocks prefetched tasks
      - Prefetched tasks hit visibility timeout while waiting
      - They get re-queued and executed again

      The fix requires either:
      - Increasing visibility_timeout for long tasks
      - Making tasks idempotent
      - Using a different acknowledgment strategy
    `,

    codeExamples: [
      {
        lang: 'python',
        description: 'Configure appropriate visibility timeout',
        code: `# celery.py

app.conf.update(
    broker_url='redis://localhost:6379/0',

    # Increase visibility timeout for long-running tasks
    broker_transport_options={
        'visibility_timeout': 43200,  # 12 hours
    },

    # Reduce prefetch to minimize blocked tasks
    worker_prefetch_multiplier=1,

    # Acknowledge tasks only after completion (safer but slower)
    task_acks_late=True,

    # Don't requeue tasks that fail
    task_reject_on_worker_lost=True,
)

# For mixed workloads, use separate queues with different timeouts:
app.conf.task_routes = {
    'tasks.process_video': {'queue': 'long_running'},
    'tasks.send_*': {'queue': 'quick'},
}`
      },
      {
        lang: 'python',
        description: 'Make tasks idempotent with deduplication',
        code: `from celery import Task
from django.core.cache import cache
import hashlib

class IdempotentTask(Task):
    """Base class for idempotent tasks using Redis for deduplication."""

    def __call__(self, *args, **kwargs):
        # Generate unique key for this task invocation
        task_key = f"task_executed:{self.name}:{self._get_args_hash(args, kwargs)}"

        # Check if already executed (with 24-hour window)
        if cache.get(task_key):
            self.log.info(f"Skipping duplicate execution: {task_key}")
            return {'status': 'duplicate', 'skipped': True}

        # Mark as executing (with TTL slightly longer than max execution time)
        cache.set(task_key, 'executing', timeout=86400)  # 24 hours

        try:
            result = super().__call__(*args, **kwargs)
            cache.set(task_key, 'completed', timeout=86400)
            return result
        except Exception as e:
            cache.delete(task_key)  # Allow retry on failure
            raise

    def _get_args_hash(self, args, kwargs):
        content = f"{args}:{sorted(kwargs.items())}"
        return hashlib.md5(content.encode()).hexdigest()


@app.task(base=IdempotentTask, bind=True)
def send_welcome_email(self, user_id):
    user = User.objects.get(id=user_id)
    send_email(user.email, 'Welcome!', 'welcome_template.html')
    return {'status': 'sent', 'user_id': user_id}`
      },
      {
        lang: 'python',
        description: 'Use database locking for critical operations',
        code: `from django.db import transaction
from django.db.models import F

@app.task(bind=True, acks_late=True)
def process_order(self, order_id):
    """Process order with database-level deduplication."""

    with transaction.atomic():
        # Lock the order row and check status
        order = Order.objects.select_for_update().get(id=order_id)

        if order.status != 'pending':
            # Already processed by another worker
            return {'status': 'skipped', 'reason': f'order status is {order.status}'}

        # Mark as processing atomically
        updated = Order.objects.filter(
            id=order_id,
            status='pending'
        ).update(
            status='processing',
            processed_at=timezone.now()
        )

        if updated == 0:
            # Another worker got it first
            return {'status': 'skipped', 'reason': 'concurrent update'}

    # Now safe to process (we own this order)
    try:
        charge_payment(order)
        fulfill_order(order)
        Order.objects.filter(id=order_id).update(status='completed')
        return {'status': 'completed', 'order_id': order_id}
    except Exception as e:
        Order.objects.filter(id=order_id).update(status='failed', error=str(e))
        raise`
      }
    ],

    prevention: [
      'Set visibility_timeout based on your longest task + buffer',
      'Make all tasks idempotent - assume they can run multiple times',
      'Use separate queues for long-running vs quick tasks',
      'Reduce worker_prefetch_multiplier for mixed workloads',
      'Implement deduplication using Redis or database locks',
      'Monitor for tasks that run longer than visibility_timeout',
      'Consider using task_acks_late=True for at-least-once semantics',
      'Use unique constraints in database for side-effect operations'
    ],

    educationalInsights: [
      'Redis broker visibility timeout is fundamentally different from RabbitMQ ack',
      'Celery cant distinguish between "worker crashed" and "task still running"',
      'Idempotency is the only reliable solution for distributed task execution',
      'Prefetching interacts badly with visibility timeout for mixed workloads',
      'acks_late=True means tasks are acknowledged after completion, but also redelivered on failure',
      'Database locks and unique constraints are the last line of defense against duplicates'
    ]
  }
};

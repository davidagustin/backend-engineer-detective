import { DetectiveCase } from '../../types';

export const kinesisShardIteratorExpiry: DetectiveCase = {
  id: 'kinesis-shard-iterator-expiry',
  title: 'The AWS Kinesis Shard Iterator Expiry',
  subtitle: 'Data loss from expired shard iterators during maintenance',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your IoT data pipeline ingests sensor data through AWS Kinesis. After a scheduled
      maintenance window where the consumer application was down for 6 hours, you
      discover that data from the maintenance period is missing. The consumer should
      have resumed from where it left off, but it didn't.
    `,
    impact: `
      6 hours of sensor data (approximately 50 million records) permanently lost.
      Regulatory compliance violated - data retention requirements not met.
      Machine learning models degraded due to missing training data.
    `,
    timeline: [
      { time: '12:00 AM', event: 'Maintenance window begins, consumer stopped', type: 'normal' },
      { time: '12:01 AM', event: 'Last checkpoint saved: sequence number X', type: 'normal' },
      { time: '6:00 AM', event: 'Maintenance ends, consumer restarted', type: 'normal' },
      { time: '6:01 AM', event: 'Consumer attempts to resume from checkpoint', type: 'warning' },
      { time: '6:01 AM', event: 'ExpiredIteratorException thrown', type: 'critical' },
      { time: '6:02 AM', event: 'Consumer falls back to LATEST, skipping gap', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Kinesis stream is healthy',
      'Producers are writing data successfully',
      'Consumer application starts without crashing',
      'Current data is being processed',
      'Checkpoints are being saved to DynamoDB'
    ],
    broken: [
      'ExpiredIteratorException in consumer logs',
      '6-hour data gap in downstream systems',
      'Consumer position jumped forward unexpectedly',
      'Sequence numbers in checkpoint no longer valid',
      'GetRecords returns empty despite data in stream'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Consumer Error Logs',
      type: 'logs',
      content: `
\`\`\`
2024-01-15 06:01:15.123 ERROR [KinesisConsumer] Failed to get records from shard shardId-000000000001
com.amazonaws.services.kinesis.model.ExpiredIteratorException:
  Iterator expired. The requested iterator has expired.
  Iterators are valid for 300 seconds (5 minutes).

2024-01-15 06:01:15.456 WARN [KinesisConsumer] Shard iterator expired for checkpoint:
  Shard: shardId-000000000001
  Sequence: 49645678901234567890123456789012345678901234567890
  Checkpoint time: 2024-01-15 00:00:45.789

2024-01-15 06:01:15.789 INFO [KinesisConsumer] Falling back to LATEST iterator type
2024-01-15 06:01:16.012 INFO [KinesisConsumer] Resumed processing from current position
\`\`\`
      `,
      hint: 'Shard iterators expire after 5 minutes, but the consumer was down for 6 hours'
    },
    {
      id: 2,
      title: 'Kinesis Stream Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# Stream configuration
StreamName: sensor-data-stream
ShardCount: 4
RetentionPeriodHours: 24  # Data retained for 24 hours

# Important Kinesis behaviors:
# 1. Shard iterators expire after 5 minutes of inactivity
# 2. Data is retained for RetentionPeriodHours (24h in this case)
# 3. Sequence numbers are valid for the retention period
# 4. But iterators must be refreshed every 5 minutes

# To resume from a checkpoint:
# 1. Get new iterator using AT_SEQUENCE_NUMBER or AFTER_SEQUENCE_NUMBER
# 2. The sequence number must still exist in the stream
# 3. The 6-hour gap is within 24h retention, so data exists!
\`\`\`
      `,
      hint: 'Data is retained for 24 hours, but the iterator expired'
    },
    {
      id: 3,
      title: 'Consumer Checkpoint Code',
      type: 'code',
      content: `
\`\`\`python
# consumer.py

class KinesisConsumer:
    def __init__(self, stream_name):
        self.kinesis = boto3.client('kinesis')
        self.stream_name = stream_name
        self.checkpoints = {}  # shard_id -> sequence_number

    def get_shard_iterator(self, shard_id):
        checkpoint = self.load_checkpoint(shard_id)

        if checkpoint:
            # Resume from checkpoint
            try:
                response = self.kinesis.get_shard_iterator(
                    StreamName=self.stream_name,
                    ShardId=shard_id,
                    ShardIteratorType='AT_SEQUENCE_NUMBER',
                    StartingSequenceNumber=checkpoint['sequence_number']
                )
                return response['ShardIterator']
            except self.kinesis.exceptions.ExpiredIteratorException:
                # Checkpoint exists but can't resume... fall back to LATEST
                # THIS IS THE BUG - should use AT_SEQUENCE_NUMBER, not LATEST
                return self.get_latest_iterator(shard_id)
        else:
            return self.get_latest_iterator(shard_id)

    def get_latest_iterator(self, shard_id):
        response = self.kinesis.get_shard_iterator(
            StreamName=self.stream_name,
            ShardId=shard_id,
            ShardIteratorType='LATEST'  # Skips all existing data!
        )
        return response['ShardIterator']
\`\`\`
      `,
      hint: 'The fallback uses LATEST instead of AT_SEQUENCE_NUMBER'
    },
    {
      id: 4,
      title: 'AWS Kinesis Iterator Types',
      type: 'config',
      content: `
\`\`\`
## Kinesis GetShardIterator Types

AT_SEQUENCE_NUMBER
  - Start reading from the exact sequence number
  - The sequence number must exist in the stream
  - Works as long as data is within retention period

AFTER_SEQUENCE_NUMBER
  - Start reading from the record AFTER the sequence number
  - Use this to avoid reprocessing the checkpointed record

TRIM_HORIZON
  - Start from the oldest available record in the shard
  - Useful for complete reprocessing
  - Subject to retention period (oldest = retention ago)

LATEST
  - Start from new records only (after GetShardIterator call)
  - SKIPS all existing data in the stream!
  - Use only for real-time processing where history doesn't matter

AT_TIMESTAMP
  - Start from a specific timestamp
  - Alternative to sequence-based checkpointing
\`\`\`
      `,
      hint: 'AT_SEQUENCE_NUMBER works if data is still in retention, LATEST skips everything'
    },
    {
      id: 5,
      title: 'DynamoDB Checkpoint Table',
      type: 'metrics',
      content: `
## Checkpoints Table (sensor-data-checkpoints)

| shard_id | sequence_number | last_updated |
|----------|-----------------|--------------|
| shard-000 | 496456789012345... | 2024-01-15 00:00:45 |
| shard-001 | 496456789012346... | 2024-01-15 00:00:46 |
| shard-002 | 496456789012347... | 2024-01-15 00:00:44 |
| shard-003 | 496456789012348... | 2024-01-15 00:00:47 |

All checkpoints are from 00:00 AM (before maintenance).
Sequence numbers are still valid (within 24h retention).
But the consumer code fell back to LATEST instead of using them.
      `,
      hint: 'Valid checkpoints exist - the error handling is wrong'
    },
    {
      id: 6,
      title: 'Data Engineer Testimony',
      type: 'testimony',
      content: `
> "I tested the checkpoint recovery locally. It worked fine because I only
> paused for a few minutes. I never tested a 6-hour gap."
>
> "The ExpiredIteratorException confused me. I thought it meant the sequence
> number was expired, not just the iterator object."
>
> "Looking at AWS docs now, I see that shard iterators expire after 5 minutes,
> but sequence numbers are valid for the retention period. I should have
> just gotten a new iterator with AT_SEQUENCE_NUMBER."
>
> "The data is actually still in the stream - it's within the 24-hour
> retention. But our fallback to LATEST meant we skipped over it."
>
> — Priya, Data Engineer
      `,
      hint: 'Iterator expiry != sequence number expiry - a new iterator can be obtained'
    }
  ],

  solution: {
    diagnosis: 'ExpiredIteratorException incorrectly handled by falling back to LATEST instead of getting new iterator with AT_SEQUENCE_NUMBER',

    keywords: [
      'shard iterator', 'expired', 'sequence number', 'checkpoint', 'kinesis',
      'AT_SEQUENCE_NUMBER', 'LATEST', 'retention', 'data loss', 'recovery'
    ],

    rootCause: `
      AWS Kinesis has two different concepts that were confused:

      1. **Shard Iterator**: A pointer used to read records. Expires after 5 minutes of
         inactivity. Must be refreshed by calling GetShardIterator again.

      2. **Sequence Number**: A unique identifier for a record. Valid for the entire
         retention period (24 hours in this case).

      The consumer code caught ExpiredIteratorException and assumed the checkpoint was
      invalid. Instead of getting a new iterator using the valid sequence number
      (AT_SEQUENCE_NUMBER), it fell back to LATEST which skips all existing data.

      The correct handling:
      1. Catch ExpiredIteratorException
      2. Call GetShardIterator with AT_SEQUENCE_NUMBER using the checkpointed sequence
      3. This returns a fresh iterator starting from the checkpointed position
      4. Continue processing - no data loss

      The 6-hour data gap was completely recoverable because it was within the 24-hour
      retention period. The error handling bug caused permanent data loss.
    `,

    codeExamples: [
      {
        lang: 'python',
        description: 'Correct iterator recovery handling',
        code: `class KinesisConsumer:
    def __init__(self, stream_name):
        self.kinesis = boto3.client('kinesis')
        self.stream_name = stream_name

    def get_shard_iterator_with_recovery(self, shard_id):
        """Get shard iterator with proper checkpoint recovery."""
        checkpoint = self.load_checkpoint(shard_id)

        if checkpoint:
            sequence_number = checkpoint['sequence_number']

            # Always use AFTER_SEQUENCE_NUMBER to avoid reprocessing
            # The sequence number is valid as long as data is in retention
            try:
                response = self.kinesis.get_shard_iterator(
                    StreamName=self.stream_name,
                    ShardId=shard_id,
                    ShardIteratorType='AFTER_SEQUENCE_NUMBER',
                    StartingSequenceNumber=sequence_number
                )
                return response['ShardIterator']
            except self.kinesis.exceptions.InvalidArgumentException as e:
                # Sequence number is BEFORE trim horizon (too old)
                # This means data is lost due to retention, not iterator expiry
                if 'StartingSequenceNumber' in str(e):
                    logging.warning(f"Checkpoint {sequence_number} is beyond retention")
                    # Fall back to TRIM_HORIZON to get oldest available
                    return self.get_trim_horizon_iterator(shard_id)
                raise

        # No checkpoint - start from beginning
        return self.get_trim_horizon_iterator(shard_id)

    def get_trim_horizon_iterator(self, shard_id):
        response = self.kinesis.get_shard_iterator(
            StreamName=self.stream_name,
            ShardId=shard_id,
            ShardIteratorType='TRIM_HORIZON'  # Oldest available, not LATEST!
        )
        return response['ShardIterator']`
      },
      {
        lang: 'python',
        description: 'Robust record fetching with iterator refresh',
        code: `def process_shard(self, shard_id):
    """Process records from a shard with automatic iterator refresh."""
    iterator = self.get_shard_iterator_with_recovery(shard_id)
    consecutive_empty = 0

    while True:
        try:
            response = self.kinesis.get_records(
                ShardIterator=iterator,
                Limit=1000
            )

            records = response['Records']
            iterator = response['NextShardIterator']

            if records:
                consecutive_empty = 0
                for record in records:
                    self.process_record(record)
                    # Checkpoint after each record or batch
                    self.save_checkpoint(shard_id, record['SequenceNumber'])
            else:
                consecutive_empty += 1
                if consecutive_empty > 10:
                    time.sleep(1)  # Back off when no data

        except self.kinesis.exceptions.ExpiredIteratorException:
            # Iterator expired - get a fresh one from checkpoint
            # This is NORMAL after idle periods, not an error
            logging.info(f"Refreshing expired iterator for {shard_id}")
            iterator = self.get_shard_iterator_with_recovery(shard_id)

        except self.kinesis.exceptions.ProvisionedThroughputExceededException:
            # Rate limited - back off and retry
            time.sleep(1)
            iterator = self.get_shard_iterator_with_recovery(shard_id)`
      },
      {
        lang: 'python',
        description: 'Using AWS KCL for automatic checkpoint management',
        code: `# Recommended: Use Kinesis Client Library (KCL) instead of raw API
# KCL handles iterator refresh, checkpointing, and shard management automatically

from amazon_kclpy import kcl

class RecordProcessor(kcl.RecordProcessorBase):
    def initialize(self, shard_id):
        self.shard_id = shard_id
        self.checkpoint_freq = 60  # seconds
        self.last_checkpoint = time.time()

    def process_records(self, records, checkpointer):
        for record in records:
            self.process_record(record)

        # KCL manages checkpointing - just tell it when to checkpoint
        if time.time() - self.last_checkpoint > self.checkpoint_freq:
            try:
                checkpointer.checkpoint()
                self.last_checkpoint = time.time()
            except kcl.CheckpointError as e:
                logging.error(f"Checkpoint failed: {e}")

    def shutdown(self, checkpointer, reason):
        if reason == 'TERMINATE':
            # Shard ended (split/merge) - checkpoint final position
            checkpointer.checkpoint()

# KCL handles:
# - Iterator refresh automatically
# - Checkpoint storage in DynamoDB
# - Shard discovery and load balancing
# - Graceful recovery from failures`
      }
    ],

    prevention: [
      'Use AWS Kinesis Client Library (KCL) for automatic iterator and checkpoint management',
      'Distinguish between ExpiredIteratorException (refresh needed) and data beyond retention',
      'Never fall back to LATEST when checkpoint exists - use AT_SEQUENCE_NUMBER or TRIM_HORIZON',
      'Test recovery scenarios with gaps longer than 5 minutes',
      'Set retention period to cover your maximum expected downtime + buffer',
      'Monitor for ExpiredIteratorException as a health metric',
      'Implement alerting when checkpoint age exceeds retention period',
      'Consider enhanced fan-out for dedicated throughput during catch-up'
    ],

    educationalInsights: [
      'Shard iterators are temporary pointers (5 min), sequence numbers are persistent (retention period)',
      'ExpiredIteratorException is normal and expected after idle periods',
      'LATEST iterator type is dangerous for data pipelines - only use for real-time subscriptions',
      'TRIM_HORIZON gives oldest available data, respecting retention',
      'KCL abstracts away iterator management complexity',
      'Kinesis retention can be extended to 7 days (extended retention) or 365 days (long-term retention)'
    ]
  }
};

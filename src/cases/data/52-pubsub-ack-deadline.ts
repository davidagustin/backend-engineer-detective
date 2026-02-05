import { DetectiveCase } from '../../types';

export const pubsubAckDeadline: DetectiveCase = {
  id: 'pubsub-ack-deadline',
  title: 'The Google Pub/Sub Acknowledgment Deadline',
  subtitle: 'Messages redelivered due to slow processing exceeding ack deadline',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your data enrichment pipeline uses Google Cloud Pub/Sub. Messages are pulled,
      enriched with data from multiple APIs, and written to BigQuery. Users report
      seeing duplicate records in BigQuery - some records appear 3-4 times with
      identical content but different ingestion timestamps.
    `,
    impact: `
      40% of records duplicated in BigQuery. Analytics queries returning inflated
      numbers. Data quality reports failing. Billing costs increased due to
      duplicate processing and storage.
    `,
    timeline: [
      { time: '9:00 AM', event: 'New external API integration deployed', type: 'normal' },
      { time: '9:30 AM', event: 'Processing latency increases 3x', type: 'warning' },
      { time: '10:00 AM', event: 'First duplicate records noticed', type: 'warning' },
      { time: '11:00 AM', event: 'Duplicate rate reaches 20%', type: 'critical' },
      { time: '2:00 PM', event: 'Duplicate rate reaches 40%', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Pub/Sub subscription is active and healthy',
      'Messages are being pulled successfully',
      'Enrichment APIs returning data',
      'BigQuery writes succeeding',
      'No errors in application logs'
    ],
    broken: [
      'Same message_id appearing multiple times in processing logs',
      'BigQuery showing duplicate records',
      'Pub/Sub metrics show high "expired" acknowledgment count',
      'Processing time exceeds ack deadline',
      '"ModifyAckDeadline" requests increasing'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Pub/Sub Subscription Metrics',
      type: 'metrics',
      content: `
## Subscription: enrichment-pipeline-sub

| Metric | Before 9AM | After 9AM |
|--------|------------|-----------|
| Messages Pulled | 1,000/min | 1,000/min |
| Acks Sent | 1,000/min | 600/min |
| Ack Deadline Exceeded | 0/min | **400/min** |
| Redelivery Rate | 0% | **40%** |

## Subscription Configuration
- Ack Deadline: 60 seconds (default)
- Message Retention: 7 days
- Retry Policy: Immediate

## Processing Latency Distribution
| Percentile | Before | After |
|------------|--------|-------|
| p50 | 15s | 45s |
| p90 | 30s | 75s |
| p99 | 45s | **120s** |
      `,
      hint: 'Processing time p99 exceeds the ack deadline'
    },
    {
      id: 2,
      title: 'Message Processing Code',
      type: 'code',
      content: `
\`\`\`python
from google.cloud import pubsub_v1
from google.cloud import bigquery

subscriber = pubsub_v1.SubscriberClient()
subscription_path = subscriber.subscription_path(PROJECT, SUBSCRIPTION)

def callback(message):
    try:
        data = json.loads(message.data)

        # Step 1: Enrich with user data (5-10s)
        user_data = fetch_user_profile(data['user_id'])

        # Step 2: Enrich with geo data (10-20s)
        geo_data = fetch_geo_enrichment(data['location'])

        # Step 3: NEW - Enrich with third-party API (30-60s!)
        third_party = fetch_third_party_data(data['external_id'])

        # Step 4: Write to BigQuery (5-10s)
        enriched = {**data, **user_data, **geo_data, **third_party}
        write_to_bigquery(enriched)

        # Acknowledge AFTER all processing complete
        message.ack()

    except Exception as e:
        logger.error(f"Processing failed: {e}")
        message.nack()

# Start pulling messages
streaming_pull = subscriber.subscribe(subscription_path, callback=callback)
\`\`\`
      `,
      hint: 'Ack is only called after all processing - what if it takes too long?'
    },
    {
      id: 3,
      title: 'Pub/Sub Acknowledgment Documentation',
      type: 'config',
      content: `
\`\`\`
## Google Pub/Sub Acknowledgment Behavior

When you PULL a message:
1. Message becomes "outstanding" (invisible to other subscribers)
2. Ack deadline timer starts (default: 10s, max: 600s)
3. You must ACK before deadline expires

If ack deadline expires:
1. Message becomes visible again
2. Another pull (or same subscriber) receives it
3. This is REDELIVERY - message.delivery_attempt increases

Ack deadline extension:
- Client libraries automatically extend deadline (modifyAckDeadline)
- But there's a maximum (usually 600 seconds total)
- If processing exceeds maximum, message WILL be redelivered

Key insight:
- Ack deadline is a LEASE, not a timeout
- Must be renewed periodically during long processing
- Python client auto-extends but has limits
\`\`\`
      `,
      hint: 'The ack deadline can be extended, but not indefinitely'
    },
    {
      id: 4,
      title: 'Client Library Logs',
      type: 'logs',
      content: `
\`\`\`
2024-01-15 10:15:30 DEBUG Received message abc123, ack_id: xyz789
2024-01-15 10:15:30 DEBUG Starting processing for message abc123
2024-01-15 10:15:45 DEBUG ModifyAckDeadline for abc123: extending by 60s
2024-01-15 10:16:00 DEBUG ModifyAckDeadline for abc123: extending by 60s
2024-01-15 10:16:15 DEBUG ModifyAckDeadline for abc123: extending by 60s
2024-01-15 10:16:30 DEBUG ModifyAckDeadline for abc123: extending by 60s
...
2024-01-15 10:25:30 WARN Max ack deadline reached for abc123 (600s)
2024-01-15 10:25:30 DEBUG ModifyAckDeadline FAILED: deadline cannot be extended

2024-01-15 10:26:00 DEBUG Received message abc123, ack_id: def456  <-- REDELIVERY!
2024-01-15 10:26:00 DEBUG Starting processing for message abc123 (attempt 2)

# Meanwhile, original processing is still running...
2024-01-15 10:27:30 INFO Processing complete for abc123 (original)
2024-01-15 10:27:30 DEBUG Ack for abc123 with ack_id xyz789
2024-01-15 10:27:30 WARN Ack failed: ack_id expired or invalid
\`\`\`
      `,
      hint: 'After max deadline, message redelivers while original still processing'
    },
    {
      id: 5,
      title: 'Third-Party API Performance',
      type: 'metrics',
      content: `
## Third-Party Enrichment API (new integration)

| Metric | SLA | Actual |
|--------|-----|--------|
| p50 latency | 5s | 30s |
| p90 latency | 10s | 60s |
| p99 latency | 30s | **120s** |
| Timeout rate | 0% | 5% |

## API Rate Limits
- 100 requests/second (we're at 80/s)
- No issues with rate limiting

## Retry Configuration
- Max retries: 3
- Backoff: exponential (1s, 2s, 4s)
- Total max time per call: up to 45s with retries

Note: API performance degraded after their v2 release last week
      `,
      hint: 'The new API is much slower than expected'
    },
    {
      id: 6,
      title: 'Data Engineer Testimony',
      type: 'testimony',
      content: `
> "The third-party integration was tested in isolation. Their API returned
> in under 10 seconds during our tests. We didn't know it would be 30-60
> seconds under production load."
>
> "I didn't realize there was a maximum ack deadline. I thought the client
> library would keep extending it forever as long as we're processing."
>
> "The duplicates all have different ingestion timestamps but identical
> source data. The message_id is the same too, which confirms redelivery."
>
> "Our BigQuery table doesn't have a unique constraint - we just append
> records. I assumed Pub/Sub would handle exactly-once delivery."
>
> — Ryan, Data Engineer
      `,
      hint: 'Pub/Sub provides at-least-once delivery, not exactly-once'
    }
  ],

  solution: {
    diagnosis: 'Message processing time exceeding Pub/Sub ack deadline maximum (600s), causing automatic redelivery and duplicate processing',

    keywords: [
      'ack deadline', 'redelivery', 'pubsub', 'acknowledgment', 'duplicate',
      'at-least-once', 'modifyAckDeadline', 'exactly-once', 'idempotent'
    ],

    rootCause: `
      Google Cloud Pub/Sub provides at-least-once delivery, which means messages may be
      delivered more than once. The ack deadline mechanism ensures messages aren't lost
      if a subscriber crashes, but it also causes redelivery if processing takes too long.

      The chain of events:
      1. Message pulled, ack deadline timer starts (60s default)
      2. Client library automatically extends deadline every ~30s
      3. Processing takes 75-120s at p90-p99 due to slow third-party API
      4. Deadline extensions work until 600s maximum is reached
      5. After 600s, message becomes visible again
      6. Another subscriber (or same one) pulls the "new" message
      7. Now TWO processes are working on the same message
      8. Both complete and write to BigQuery = duplicate records
      9. Original process's ack fails (ack_id expired)

      The 600-second maximum is a hard limit in Pub/Sub. If you can't process within
      that window, you need a different architecture.
    `,

    codeExamples: [
      {
        lang: 'python',
        description: 'Implement idempotent processing with deduplication',
        code: `from google.cloud import pubsub_v1, bigquery
from google.cloud import firestore
import hashlib

db = firestore.Client()

def callback(message):
    message_id = message.message_id

    # Check if already processed (idempotency)
    processed_ref = db.collection('processed_messages').document(message_id)

    @firestore.transactional
    def check_and_mark(transaction):
        doc = processed_ref.get(transaction=transaction)
        if doc.exists:
            return False  # Already processed
        transaction.set(processed_ref, {
            'processed_at': firestore.SERVER_TIMESTAMP,
            'status': 'processing'
        })
        return True

    transaction = db.transaction()
    should_process = check_and_mark(transaction)

    if not should_process:
        logger.info(f"Skipping duplicate message: {message_id}")
        message.ack()  # Ack to prevent further redelivery
        return

    try:
        # Process the message
        result = process_message(message.data)

        # Write to BigQuery with deduplication
        write_to_bigquery_dedupe(result, message_id)

        # Mark as completed
        processed_ref.update({'status': 'completed'})

        message.ack()

    except Exception as e:
        processed_ref.update({'status': 'failed', 'error': str(e)})
        message.nack()  # Will be retried`
      },
      {
        lang: 'python',
        description: 'Break processing into smaller steps with intermediate acks',
        code: `from google.cloud import pubsub_v1
import json

# Use multiple topics for pipeline stages
# Each stage is fast enough to complete within ack deadline

def stage1_callback(message):
    """Stage 1: Basic parsing and user enrichment (10-20s)"""
    data = json.loads(message.data)
    user_data = fetch_user_profile(data['user_id'])

    enriched = {**data, **user_data}

    # Publish to next stage topic
    publisher.publish(STAGE2_TOPIC, json.dumps(enriched).encode())
    message.ack()  # Ack quickly!


def stage2_callback(message):
    """Stage 2: Geo enrichment (10-20s)"""
    data = json.loads(message.data)
    geo_data = fetch_geo_enrichment(data['location'])

    enriched = {**data, **geo_data}

    publisher.publish(STAGE3_TOPIC, json.dumps(enriched).encode())
    message.ack()


def stage3_callback(message):
    """Stage 3: Third-party enrichment (30-60s)"""
    data = json.loads(message.data)
    third_party = fetch_third_party_data(data['external_id'])

    enriched = {**data, **third_party}

    publisher.publish(FINAL_TOPIC, json.dumps(enriched).encode())
    message.ack()


def final_callback(message):
    """Final stage: Write to BigQuery (5-10s)"""
    data = json.loads(message.data)
    write_to_bigquery(data)
    message.ack()`
      },
      {
        lang: 'python',
        description: 'Use Dataflow for exactly-once semantics',
        code: `# For true exactly-once, use Dataflow with Pub/Sub
# Dataflow handles checkpointing and deduplication

import apache_beam as beam
from apache_beam.options.pipeline_options import PipelineOptions
from apache_beam.io.gcp.pubsub import ReadFromPubSub
from apache_beam.io.gcp.bigquery import WriteToBigQuery

options = PipelineOptions([
    '--runner=DataflowRunner',
    '--project=my-project',
    '--streaming',
    '--enable_streaming_engine',
])

with beam.Pipeline(options=options) as p:
    (p
     | 'Read from Pub/Sub' >> ReadFromPubSub(
         subscription='projects/my-project/subscriptions/enrichment-sub',
         with_attributes=True,
         id_label='message_id'  # Enables exactly-once
     )
     | 'Parse JSON' >> beam.Map(lambda x: json.loads(x.data))
     | 'Enrich User' >> beam.ParDo(EnrichUserDoFn())
     | 'Enrich Geo' >> beam.ParDo(EnrichGeoDoFn())
     | 'Enrich ThirdParty' >> beam.ParDo(EnrichThirdPartyDoFn())
     | 'Write to BigQuery' >> WriteToBigQuery(
         'my-project:dataset.table',
         write_disposition=beam.io.BigQueryDisposition.WRITE_APPEND,
         insert_retry_strategy='RETRY_ON_TRANSIENT_ERROR'
     )
    )`
      },
      {
        lang: 'sql',
        description: 'BigQuery deduplication query for cleanup',
        code: `-- Deduplicate existing records based on message_id
-- Run this to clean up the duplicate records

CREATE OR REPLACE TABLE \`project.dataset.enriched_data_deduped\` AS
SELECT * EXCEPT(row_num)
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY message_id
      ORDER BY ingestion_timestamp ASC  -- Keep first occurrence
    ) as row_num
  FROM \`project.dataset.enriched_data\`
)
WHERE row_num = 1;

-- Or use MERGE for ongoing deduplication
MERGE \`project.dataset.enriched_data\` T
USING (
  SELECT * FROM \`project.dataset.enriched_data_staging\`
) S
ON T.message_id = S.message_id
WHEN NOT MATCHED THEN
  INSERT ROW;`
      }
    ],

    prevention: [
      'Design message processing to complete well within ack deadline (target: 50% of limit)',
      'Implement idempotent processing - assume every message may be delivered multiple times',
      'Use message_id for deduplication in downstream systems',
      'Break long processing into multiple pipeline stages with intermediate topics',
      'Configure appropriate ack deadline based on realistic processing time',
      'Monitor ack deadline exceeded metrics and alert on increases',
      'Consider Dataflow for streaming pipelines requiring exactly-once semantics',
      'Add unique constraints or deduplication logic to BigQuery writes'
    ],

    educationalInsights: [
      'Pub/Sub provides at-least-once delivery - exactly-once requires additional work',
      'Ack deadline maximum is 600 seconds - cannot be extended beyond that',
      'Client libraries auto-extend deadlines but cannot exceed the maximum',
      'Redelivery is not a bug - its a feature for reliability',
      'Idempotency is the standard pattern for handling at-least-once delivery',
      'Dataflow provides exactly-once semantics for Pub/Sub through checkpointing'
    ]
  }
};

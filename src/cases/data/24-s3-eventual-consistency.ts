import { DetectiveCase } from '../../types';

export const s3EventualConsistency: DetectiveCase = {
  id: 's3-eventual-consistency',
  title: 'The S3 Eventual Consistency Trap',
  subtitle: 'Multi-region data synchronization causing silent data loss',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your document management system stores files in S3 with cross-region replication.
      Users report that recently uploaded files sometimes "disappear" or show old versions.
      The problem is intermittent and seems to affect only users in certain regions.
      Data integrity is paramount - losing customer documents is unacceptable.
    `,
    impact: `
      Legal documents and contracts going missing. Customer trust eroding.
      Compliance audit at risk. Potential liability for lost documents worth millions.
    `,
    timeline: [
      { time: 'Day 1', event: 'Cross-region replication enabled for disaster recovery', type: 'normal' },
      { time: 'Week 2', event: 'First customer reports missing document', type: 'warning' },
      { time: 'Week 3', event: 'Pattern emerges: EU users seeing stale data', type: 'warning' },
      { time: 'Week 4', event: 'Legal team escalates - contract version mismatch in court', type: 'critical' },
      { time: 'Week 5', event: 'Full audit reveals 2% of documents have version conflicts', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'File uploads succeed and return 200 OK',
      'Files appear in S3 bucket immediately after upload',
      'Cross-region replication shows objects syncing',
      'Users in US region see files correctly'
    ],
    broken: [
      'EU users sometimes get 404 for recently uploaded files',
      'Old file versions served instead of latest upload',
      'Rapid update then read returns stale data',
      'Cross-region reads inconsistent for ~15 minutes after write'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Application Architecture',
      type: 'code',
      content: `
\`\`\`typescript
// document-service.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3US = new S3Client({ region: 'us-east-1' });
const s3EU = new S3Client({ region: 'eu-west-1' });

// CloudFront routes users to nearest region
function getS3Client(userRegion: string): S3Client {
  return userRegion.startsWith('eu') ? s3EU : s3US;
}

async function uploadDocument(userId: string, docId: string, content: Buffer) {
  // Always write to US (primary)
  await s3US.send(new PutObjectCommand({
    Bucket: 'docs-primary-us',
    Key: \`\${userId}/\${docId}\`,
    Body: content,
  }));

  // Update metadata in database
  await db.documents.update(docId, { uploadedAt: new Date() });

  return { success: true };
}

async function getDocument(userId: string, docId: string, userRegion: string) {
  // Read from nearest region for low latency
  const s3 = getS3Client(userRegion);
  const bucket = userRegion.startsWith('eu') ? 'docs-replica-eu' : 'docs-primary-us';

  return s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: \`\${userId}/\${docId}\`,
  }));
}
\`\`\`
      `,
      hint: 'Writes go to US, reads can come from EU replica - timing issue?'
    },
    {
      id: 2,
      title: 'S3 Replication Metrics',
      type: 'metrics',
      content: `
## Cross-Region Replication Stats (us-east-1 -> eu-west-1)

| Metric | Value |
|--------|-------|
| Replication Time (p50) | 45 seconds |
| Replication Time (p90) | 3 minutes |
| Replication Time (p99) | 15 minutes |
| Failed Replications | 0.01% |

## Replication Lag Distribution
- 0-30s: 40% of objects
- 30s-2min: 35% of objects
- 2min-5min: 15% of objects
- 5min-15min: 9% of objects
- >15min: 1% of objects

**Note:** S3 CRR (Cross-Region Replication) is asynchronous.
No SLA on replication time.
      `,
      hint: 'Replication can take up to 15 minutes at p99'
    },
    {
      id: 3,
      title: 'Customer Support Tickets',
      type: 'testimony',
      content: `
> Ticket #4521: "I uploaded a contract at 10:00 AM, sent the link to my
> colleague in London at 10:02 AM. He says the file doesn't exist. I can
> see it fine from New York."
>
> Ticket #4523: "I updated a document, but my team in Germany keeps
> downloading the old version. It's been like this for 10 minutes."
>
> Ticket #4530: "URGENT: We submitted the wrong version of a legal brief
> because the system showed an old file. This is a disaster."
>
> Ticket #4535: "Why does the preview show a different file than what I
> just uploaded? I refreshed multiple times."
>
> -- Support Queue (Week 4)
      `,
      hint: 'Users uploading in US, colleagues reading from EU see stale/missing data'
    },
    {
      id: 4,
      title: 'S3 Read-After-Write Consistency Model',
      type: 'config',
      content: `
\`\`\`markdown
# AWS S3 Consistency Model (as of December 2020)

## Single-Region Consistency
S3 now provides **strong read-after-write consistency** for:
- PUT of new objects
- PUT overwriting existing objects
- DELETE operations

You can read an object immediately after writing, and get the latest version.

## Cross-Region Replication (CRR)
CRR is **eventually consistent** with NO timing guarantees:
- Objects replicate asynchronously
- Replication time varies (seconds to minutes)
- No read-after-write consistency across regions
- Delete markers replicate with same eventual model

## Common Pitfalls
1. Assuming CRR is synchronous
2. Reading from replica immediately after writing to primary
3. Not accounting for replication lag in application logic
4. Using CRR for active-active without conflict resolution
\`\`\`
      `,
      hint: 'S3 is strongly consistent single-region but eventually consistent cross-region'
    },
    {
      id: 5,
      title: 'Race Condition Analysis',
      type: 'code',
      content: `
\`\`\`typescript
// Timeline of a typical failure:

// T+0ms: User in US uploads document v2
await uploadDocument(userId, docId, contentV2);
// Writes to us-east-1, returns success

// T+10ms: User shares link with colleague in EU
// Link sent via email/chat

// T+500ms: EU user clicks link
const doc = await getDocument(userId, docId, 'eu-west-1');
// Reads from eu-west-1 replica
// Replication hasn't completed yet!
// Returns: 404 Not Found (if new file)
// Returns: v1 content (if overwrite)

// T+45000ms (45 seconds later): Replication completes
// EU replica now has v2
// But EU user already saw stale data and gave up

// WORSE CASE: Active-Active Conflict
// T+0ms: US user uploads v2 to us-east-1
// T+100ms: EU user uploads v3 to eu-west-1 (different version!)
// T+45s: CRR replicates v2 to eu-west-1, OVERWRITES v3!
// v3 is LOST - silent data loss
\`\`\`
      `,
      hint: 'Reading from replica before replication completes returns stale data'
    },
    {
      id: 6,
      title: 'S3 Object Versioning Status',
      type: 'logs',
      content: `
\`\`\`
# S3 bucket versioning check
$ aws s3api get-bucket-versioning --bucket docs-primary-us
{
    "Status": "Enabled"
}

$ aws s3api get-bucket-versioning --bucket docs-replica-eu
{
    "Status": "Enabled"
}

# Object version history for a conflicted document
$ aws s3api list-object-versions --bucket docs-replica-eu --prefix user123/contract.pdf

{
  "Versions": [
    {
      "VersionId": "v3-eu-local",
      "LastModified": "2024-01-15T10:00:30Z",
      "IsLatest": false  # NOT latest anymore!
    },
    {
      "VersionId": "v2-replicated-from-us",
      "LastModified": "2024-01-15T10:00:45Z",
      "IsLatest": true   # Replicated version is now latest
    }
  ]
}

# The EU-uploaded version was silently replaced by the US replication!
\`\`\`
      `,
      hint: 'Versioning shows replication overwrote the EU-local upload'
    }
  ],

  solution: {
    diagnosis: 'Cross-region reads occur before asynchronous replication completes, plus active-active writes cause silent conflicts',

    keywords: [
      's3', 'eventual consistency', 'cross-region replication', 'crr',
      'read-after-write', 'replication lag', 'data loss', 'conflict',
      'stale read', 'multi-region', 'active-active'
    ],

    rootCause: `
      The system had two critical flaws:

      1. **Read Before Replication**: The application routed reads to the nearest
         region for low latency, but writes always went to US. When an EU user
         tried to read a file immediately after a US user uploaded it, the read
         hit the EU replica before S3 Cross-Region Replication completed. This
         caused either 404 errors (new files) or stale versions (updates).

      2. **Active-Active Conflict**: When EU users uploaded directly to the EU
         bucket (which was also happening due to a misconfiguration), their
         uploads could be silently overwritten when replication from US arrived.
         S3 CRR uses "last writer wins" based on modification time, so the
         US-originated version (with slightly later timestamp due to async
         replication) would replace the EU-local version.

      The root problem is treating S3 CRR as a synchronous, strongly consistent
      system when it's fundamentally eventually consistent with no ordering
      guarantees across regions.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Solution 1: Read from primary region for recent writes',
        code: `// document-service-fixed.ts

async function uploadDocument(userId: string, docId: string, content: Buffer) {
  await s3US.send(new PutObjectCommand({
    Bucket: 'docs-primary-us',
    Key: \`\${userId}/\${docId}\`,
    Body: content,
  }));

  // Store write timestamp for consistency routing
  await redis.set(
    \`recent-write:\${userId}/\${docId}\`,
    Date.now().toString(),
    'EX', 300  // 5 minute TTL (longer than max replication lag)
  );

  return { success: true };
}

async function getDocument(userId: string, docId: string, userRegion: string) {
  const key = \`\${userId}/\${docId}\`;

  // Check if this object was recently written
  const recentWrite = await redis.get(\`recent-write:\${key}\`);

  if (recentWrite) {
    // Recent write - ALWAYS read from primary for consistency
    console.log('Recent write detected, reading from primary');
    return s3US.send(new GetObjectCommand({
      Bucket: 'docs-primary-us',
      Key: key,
    }));
  }

  // No recent write - safe to read from replica
  const s3 = getS3Client(userRegion);
  const bucket = userRegion.startsWith('eu') ? 'docs-replica-eu' : 'docs-primary-us';

  return s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
}`
      },
      {
        lang: 'typescript',
        description: 'Solution 2: Version-aware reads with conflict detection',
        code: `// Use S3 object metadata to track version lineage

async function uploadDocument(userId: string, docId: string, content: Buffer) {
  const versionUUID = crypto.randomUUID();

  await s3US.send(new PutObjectCommand({
    Bucket: 'docs-primary-us',
    Key: \`\${userId}/\${docId}\`,
    Body: content,
    Metadata: {
      'x-app-version': versionUUID,
      'x-app-uploaded-at': new Date().toISOString(),
      'x-app-source-region': 'us-east-1',
    },
  }));

  // Store expected version in database
  await db.documents.update(docId, {
    expectedVersion: versionUUID,
    uploadedAt: new Date(),
  });

  return { success: true, versionId: versionUUID };
}

async function getDocument(userId: string, docId: string, userRegion: string) {
  const key = \`\${userId}/\${docId}\`;
  const s3 = getS3Client(userRegion);
  const bucket = userRegion.startsWith('eu') ? 'docs-replica-eu' : 'docs-primary-us';

  const response = await s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  // Verify we got expected version
  const dbDoc = await db.documents.get(docId);
  const returnedVersion = response.Metadata?.['x-app-version'];

  if (returnedVersion !== dbDoc.expectedVersion) {
    console.warn(\`Version mismatch! Expected \${dbDoc.expectedVersion}, got \${returnedVersion}\`);
    // Fall back to primary region
    return s3US.send(new GetObjectCommand({
      Bucket: 'docs-primary-us',
      Key: key,
    }));
  }

  return response;
}`
      },
      {
        lang: 'typescript',
        description: 'Solution 3: Single-region with CloudFront for global latency',
        code: `// Instead of multi-region S3, use single S3 + CloudFront

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const s3 = new S3Client({ region: 'us-east-1' });  // Single region
const cloudfront = new CloudFrontClient({ region: 'us-east-1' });

const DISTRIBUTION_ID = 'E1ABCDEFGH';
const BUCKET = 'docs-primary-us';

async function uploadDocument(userId: string, docId: string, content: Buffer) {
  const key = \`\${userId}/\${docId}\`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    CacheControl: 'private, max-age=0, must-revalidate',  // Don't cache uploads
  }));

  // Invalidate CloudFront cache to ensure fresh reads
  await cloudfront.send(new CreateInvalidationCommand({
    DistributionId: DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: \`\${key}-\${Date.now()}\`,
      Paths: {
        Quantity: 1,
        Items: [\`/\${key}\`],
      },
    },
  }));

  return { success: true };
}

// Reads go through CloudFront - low latency globally
// Strong consistency because there's only one S3 region
// CloudFront caches GET requests at edge for performance`
      },
      {
        lang: 'typescript',
        description: 'Solution 4: S3 Object Lock for critical documents',
        code: `// For documents that absolutely cannot have conflicts

async function uploadCriticalDocument(
  userId: string,
  docId: string,
  content: Buffer
) {
  const key = \`\${userId}/\${docId}\`;

  // Use S3 Object Lock to prevent overwrites
  await s3US.send(new PutObjectCommand({
    Bucket: 'docs-primary-us-locked',  // Bucket with Object Lock enabled
    Key: key,
    Body: content,
    ObjectLockMode: 'GOVERNANCE',
    ObjectLockRetainUntilDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  }));

  // Now even replication can't overwrite this version
  // Must explicitly unlock to modify

  return { success: true };
}

// For updating, create new version rather than overwrite
async function updateDocument(userId: string, docId: string, content: Buffer) {
  const version = Date.now();
  const key = \`\${userId}/\${docId}/v\${version}\`;

  await s3US.send(new PutObjectCommand({
    Bucket: 'docs-primary-us',
    Key: key,
    Body: content,
  }));

  // Update pointer to latest version in database
  await db.documents.update(docId, { latestVersion: version });

  return { success: true, version };
}`
      }
    ],

    prevention: [
      'Never assume cross-region replication is synchronous',
      'Route reads to the write region for recently written data',
      'Use database to track expected versions and detect staleness',
      'Consider single-region S3 + CloudFront for simpler consistency',
      'Implement conflict detection and resolution for multi-region writes',
      'Use S3 Object Lock for compliance-critical documents',
      'Monitor replication lag metrics and alert on anomalies',
      'Document and communicate consistency guarantees to users'
    ],

    educationalInsights: [
      'S3 has strong consistency within a region but eventual consistency across regions',
      'Eventual consistency means "will be consistent eventually" - could be seconds or minutes',
      '"Last writer wins" in S3 CRR can cause silent data loss with concurrent writes',
      'Low latency and strong consistency are often at odds - choose your tradeoff',
      'CloudFront + single region can provide both low latency and strong consistency',
      'Always design for the consistency model you actually have, not the one you want'
    ]
  }
};

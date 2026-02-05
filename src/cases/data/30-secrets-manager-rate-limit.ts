import { DetectiveCase } from '../../types';

export const secretsManagerRateLimit: DetectiveCase = {
  id: 'secrets-manager-rate-limit',
  title: 'The Secrets Manager Rate Limit',
  subtitle: 'Applications crashing at startup due to API throttling',
  difficulty: 'junior',
  category: 'auth',

  crisis: {
    description: `
      After a routine Kubernetes cluster upgrade, pods are failing to start. They
      crash in a loop with mysterious errors. The application code hasn't changed.
      The crash happens during initialization, before any requests are served.
      Rolling back the cluster upgrade doesn't fix it.
    `,
    impact: `
      50% of pods stuck in CrashLoopBackOff. Service degraded during peak hours.
      Each restart attempt makes things worse. Manual intervention required to start pods.
    `,
    timeline: [
      { time: '6:00 AM', event: 'Kubernetes cluster upgrade completed', type: 'normal' },
      { time: '6:05 AM', event: 'All pods restarting as expected', type: 'normal' },
      { time: '6:06 AM', event: 'First pods fail with credential errors', type: 'warning' },
      { time: '6:10 AM', event: '50% of pods in CrashLoopBackOff', type: 'critical' },
      { time: '6:15 AM', event: 'Remaining pods experiencing same issue', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Pods that are already running continue to work',
      'AWS credentials are configured correctly',
      'Secrets exist in Secrets Manager',
      'Manual secret retrieval via CLI works'
    ],
    broken: [
      'New pods crash during startup initialization',
      'Error: "ThrottlingException: Rate exceeded"',
      'Pods restart repeatedly making issue worse',
      'More pods starting = more failures'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Pod Startup Logs',
      type: 'logs',
      content: `
\`\`\`
# kubectl logs api-service-abc123 --previous
[2024-01-15T06:06:12Z] Starting application...
[2024-01-15T06:06:12Z] Loading configuration from AWS Secrets Manager...
[2024-01-15T06:06:12Z] Fetching secret: prod/database/credentials
[2024-01-15T06:06:12Z] Fetching secret: prod/api/keys
[2024-01-15T06:06:12Z] Fetching secret: prod/redis/password
[2024-01-15T06:06:12Z] Fetching secret: prod/jwt/signing-key
[2024-01-15T06:06:12Z] Fetching secret: prod/stripe/api-key
[2024-01-15T06:06:13Z] ERROR: Failed to fetch secret prod/stripe/api-key
[2024-01-15T06:06:13Z] ThrottlingException: Rate exceeded
[2024-01-15T06:06:13Z] Application startup failed, exiting with code 1

# This happens for multiple pods simultaneously
\`\`\`
      `,
      hint: 'Every pod fetches 5 secrets on startup, and many pods start at once'
    },
    {
      id: 2,
      title: 'Application Configuration Code',
      type: 'code',
      content: `
\`\`\`typescript
// config/secrets.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });

// Fetch all secrets at startup
export async function loadSecrets(): Promise<AppConfig> {
  const dbCreds = await getSecret('prod/database/credentials');
  const apiKeys = await getSecret('prod/api/keys');
  const redisPass = await getSecret('prod/redis/password');
  const jwtKey = await getSecret('prod/jwt/signing-key');
  const stripeKey = await getSecret('prod/stripe/api-key');

  return {
    database: JSON.parse(dbCreds),
    apiKeys: JSON.parse(apiKeys),
    redis: { password: redisPass },
    jwt: { signingKey: jwtKey },
    stripe: { apiKey: stripeKey },
  };
}

async function getSecret(secretId: string): Promise<string> {
  const response = await secretsManager.getSecretValue({ SecretId: secretId });
  return response.SecretString!;
}

// main.ts
async function main() {
  // Load all secrets before starting - no retries, no caching
  const config = await loadSecrets();
  // If ANY secret fails, app crashes
  startServer(config);
}
\`\`\`
      `,
      hint: 'No retry logic, no caching, crashes on any failure'
    },
    {
      id: 3,
      title: 'Kubernetes Deployment Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 50  # 50 pods!
  template:
    spec:
      containers:
      - name: api
        image: api-service:latest
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-service
  minReplicas: 50
  maxReplicas: 200
\`\`\`
      `,
      hint: '50 pods, each fetching 5 secrets on startup = 250 API calls'
    },
    {
      id: 4,
      title: 'AWS Secrets Manager Quotas',
      type: 'config',
      content: `
\`\`\`markdown
# AWS Secrets Manager Service Quotas

## API Rate Limits (per region, per account)
| API | Requests per second |
|-----|---------------------|
| GetSecretValue | 10,000 RPS (high, but shared) |
| Other APIs | 50 RPS |

## BUT: Burst Limits
"Secrets Manager throttles requests when they exceed the
allowed rate. During throttling, the service returns
ThrottlingException errors."

## Real-World Observations
- New accounts start with lower limits
- Burst capacity is limited
- Rapid successive calls trigger throttling faster
- Multiple services sharing the same account compound the issue

## Your Scenario
50 pods × 5 secrets × startup burst = 250 calls in ~1 second
Plus any other services also fetching secrets...
\`\`\`
      `,
      hint: '250 API calls in 1 second during cluster restart exceeds burst capacity'
    },
    {
      id: 5,
      title: 'AWS CloudTrail - Secrets Manager Events',
      type: 'logs',
      content: `
\`\`\`
# CloudTrail events for Secrets Manager (6:06 AM)

06:06:12.001 GetSecretValue prod/database/credentials SUCCESS
06:06:12.002 GetSecretValue prod/database/credentials SUCCESS
06:06:12.003 GetSecretValue prod/database/credentials SUCCESS
06:06:12.004 GetSecretValue prod/api/keys SUCCESS
06:06:12.005 GetSecretValue prod/database/credentials SUCCESS
... (47 more SUCCESS in 100ms)
06:06:12.102 GetSecretValue prod/redis/password SUCCESS
06:06:12.103 GetSecretValue prod/jwt/signing-key THROTTLED
06:06:12.104 GetSecretValue prod/stripe/api-key THROTTLED
06:06:12.105 GetSecretValue prod/database/credentials THROTTLED
... (150 THROTTLED events)

# Pattern: First ~50 calls succeed, then throttling kicks in
# Every throttled call = one pod crash
# Crashed pods restart = more API calls = more throttling
# CrashLoopBackOff makes it WORSE!
\`\`\`
      `,
      hint: 'Throttling starts after initial burst, crashing pods make it worse'
    },
    {
      id: 6,
      title: 'CrashLoopBackOff Pattern',
      type: 'metrics',
      content: `
## Pod Restart Timeline

| Time | Pods Attempting | API Calls | Throttled | Started |
|------|-----------------|-----------|-----------|---------|
| 6:06 | 50 | 250 | 200 | 10 |
| 6:07 | 40 | 200 | 180 | 4 |
| 6:08 | 36 | 180 | 170 | 2 |
| 6:09 | 34 | 170 | 165 | 1 |
| 6:10 | 33 | 165 | 160 | 1 |

**Backoff Pattern:**
- Pods crash, wait, retry (Kubernetes exponential backoff)
- Each retry generates more API calls
- Throttling persists because requests keep coming
- Cascade effect: more crashes = more retries = sustained throttling

**Additional Factor:**
- Other services (worker-service, cron-jobs) also restart after upgrade
- They also fetch secrets, adding to the API call volume
- Total account-wide: 500+ calls/second during restart window
      `,
      hint: 'CrashLoopBackOff creates sustained load, not a quick burst'
    }
  ],

  solution: {
    diagnosis: 'Mass pod restart after cluster upgrade overwhelmed Secrets Manager API rate limits, and lack of retry logic caused cascading crashes',

    keywords: [
      'secrets manager', 'rate limit', 'throttling', 'api quota',
      'crashloopbackoff', 'exponential backoff', 'caching', 'retry',
      'startup', 'initialization'
    ],

    rootCause: `
      The cluster upgrade caused all 50 pods to restart simultaneously. Each pod
      fetched 5 secrets from AWS Secrets Manager during initialization, generating
      250 API calls in about 1 second.

      This burst exceeded the Secrets Manager throttling threshold. Once throttling
      started, pods that couldn't fetch secrets crashed. Kubernetes restarted them,
      causing more API calls, sustaining the throttling condition.

      The application had no retry logic or caching, so a single ThrottlingException
      was fatal. The CrashLoopBackOff pattern made things worse:
      1. Pods crash due to throttling
      2. Kubernetes restarts them after backoff
      3. Restarted pods make more API calls
      4. Throttling continues
      5. Repeat forever

      The issue was compounded by:
      - Multiple microservices all restarting (50+ pods total per service)
      - No caching of secrets
      - No retry with exponential backoff
      - Secrets fetched sequentially (no parallelization with rate limiting)
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fix 1: Add retry with exponential backoff',
        code: `// config/secrets.ts
import { SecretsManager, ThrottlingException } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });

async function getSecretWithRetry(
  secretId: string,
  maxRetries = 5
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await secretsManager.getSecretValue({ SecretId: secretId });
      return response.SecretString!;
    } catch (error) {
      lastError = error as Error;

      if (error instanceof ThrottlingException) {
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 5000);
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * backoffMs * 0.1;
        const waitMs = backoffMs + jitter;

        console.log(\`Throttled fetching \${secretId}, retrying in \${waitMs}ms (attempt \${attempt + 1})\`);
        await sleep(waitMs);
      } else {
        // Non-throttling error, fail immediately
        throw error;
      }
    }
  }

  throw new Error(\`Failed to fetch secret \${secretId} after \${maxRetries} attempts: \${lastError?.message}\`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}`
      },
      {
        lang: 'typescript',
        description: 'Fix 2: Cache secrets with refresh',
        code: `// config/secrets-cache.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

interface CachedSecret {
  value: string;
  fetchedAt: number;
}

const secretsManager = new SecretsManager({ region: 'us-east-1' });
const cache = new Map<string, CachedSecret>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCachedSecret(secretId: string): Promise<string> {
  const cached = cache.get(secretId);

  // Return cached value if fresh
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  // Fetch fresh value with retry
  const value = await getSecretWithRetry(secretId);
  cache.set(secretId, { value, fetchedAt: Date.now() });

  return value;
}

// Background refresh to avoid startup thundering herd
export async function warmSecretCache(secretIds: string[]): Promise<void> {
  // Stagger requests to avoid burst
  for (const secretId of secretIds) {
    try {
      await getCachedSecret(secretId);
      await sleep(100); // 100ms between each secret
    } catch (error) {
      console.error(\`Failed to warm cache for \${secretId}:\`, error);
      // Continue warming other secrets
    }
  }
}

// Periodic refresh in background
setInterval(async () => {
  for (const [secretId] of cache) {
    try {
      await getCachedSecret(secretId);
      await sleep(100);
    } catch (error) {
      console.warn(\`Failed to refresh \${secretId}:\`, error);
    }
  }
}, CACHE_TTL_MS / 2);`
      },
      {
        lang: 'yaml',
        description: 'Fix 3: Use Kubernetes External Secrets Operator',
        code: `# Secrets are fetched by operator, not by pods
# Install: helm install external-secrets external-secrets/external-secrets

# SecretStore - configure AWS access
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa

---
# ExternalSecret - sync to Kubernetes Secret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: api-secrets
spec:
  refreshInterval: 1h  # Refresh hourly, not on every pod start
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: api-secrets  # Creates K8s Secret with this name
    creationPolicy: Owner
  data:
    - secretKey: database-url
      remoteRef:
        key: prod/database/credentials
        property: url
    - secretKey: stripe-key
      remoteRef:
        key: prod/stripe/api-key

---
# Pod uses regular K8s Secret (already fetched)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      containers:
      - name: api
        envFrom:
        - secretRef:
            name: api-secrets  # Mounted from K8s, no AWS API call!`
      },
      {
        lang: 'typescript',
        description: 'Fix 4: Use AWS SDK built-in retry configuration',
        code: `// config/aws-client.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { StandardRetryStrategy } from '@aws-sdk/middleware-retry';

// Configure SDK with aggressive retry for throttling
const secretsManager = new SecretsManager({
  region: 'us-east-1',
  maxAttempts: 10,  // Up to 10 retries
  retryStrategy: new StandardRetryStrategy(async () => 10, {
    retryDecider: (error: any) => {
      // Retry on throttling
      if (error.name === 'ThrottlingException') return true;
      if (error.$metadata?.httpStatusCode === 429) return true;
      // Default retry behavior for other errors
      return error.$retryable?.throttling === true;
    },
    delayDecider: (delayBase: number, attempts: number) => {
      // Exponential backoff with jitter
      const delay = Math.min(delayBase * Math.pow(2, attempts), 20000);
      const jitter = Math.random() * delay * 0.2;
      return delay + jitter;
    },
  }),
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 10000,
  }),
});

export { secretsManager };`
      }
    ],

    prevention: [
      'Always implement retry with exponential backoff for AWS API calls',
      'Cache secrets locally with TTL-based refresh',
      'Use Kubernetes External Secrets Operator to decouple secret fetching from pod startup',
      'Stagger pod restarts during cluster upgrades (PodDisruptionBudget)',
      'Monitor AWS API throttling metrics in CloudWatch',
      'Request service quota increases for high-traffic accounts',
      'Add startup delays with jitter to spread API calls',
      'Consider storing secrets in AWS Parameter Store (higher rate limits)'
    ],

    educationalInsights: [
      'AWS APIs have rate limits that can be exceeded during mass restarts',
      'CrashLoopBackOff creates sustained load, not a one-time burst',
      'Exponential backoff with jitter prevents thundering herd',
      'Kubernetes External Secrets Operator decouples secret fetching from pod lifecycle',
      'Caching is essential for any external API call, especially during startup',
      'Never let a single transient error crash your entire application'
    ]
  }
};

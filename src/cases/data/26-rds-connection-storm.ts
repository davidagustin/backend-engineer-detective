import { DetectiveCase } from '../../types';

export const rdsConnectionStorm: DetectiveCase = {
  id: 'rds-connection-storm',
  title: 'The RDS Connection Storm',
  subtitle: 'Database connections exhausted after deploying new microservice',
  difficulty: 'junior',
  category: 'database',

  crisis: {
    description: `
      You deployed a new microservice for inventory management. Within minutes,
      your main application starts throwing "too many connections" errors. The
      database CPU is normal, queries are fast, but nothing can connect anymore.
      Rolling back the deployment doesn't immediately fix the problem.
    `,
    impact: `
      Complete application outage. No new requests can be served. Checkout flow
      broken, orders failing. Customer-facing error pages. Revenue loss of $10K/minute.
    `,
    timeline: [
      { time: '10:00 AM', event: 'New inventory-service deployed (5 replicas)', type: 'normal' },
      { time: '10:02 AM', event: 'Connection pool warnings in logs', type: 'warning' },
      { time: '10:05 AM', event: 'First "too many connections" errors', type: 'warning' },
      { time: '10:08 AM', event: 'Application completely unable to connect to database', type: 'critical' },
      { time: '10:10 AM', event: 'Rolled back inventory-service, errors persist', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Database server CPU and memory normal',
      'Existing queries complete successfully',
      'Database is responsive via direct connection',
      'RDS instance shows healthy status'
    ],
    broken: [
      'New connections fail with "too many connections"',
      'max_connections limit hit at 200',
      'Connection count not dropping after rollback',
      'All services affected, not just the new one'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Database Connection Count',
      type: 'metrics',
      content: `
## RDS Connection Metrics

| Time | Active Connections | Max Connections |
|------|-------------------|-----------------|
| 9:55 AM | 45 | 200 |
| 10:00 AM | 145 | 200 |
| 10:02 AM | 198 | 200 |
| 10:05 AM | 200 | 200 |
| 10:08 AM | 200 | 200 |
| 10:15 AM | 200 | 200 |

**Note:** After rollback at 10:10 AM, connections stayed at 200
      `,
      hint: 'Connections jumped from 45 to 200 in 5 minutes, and stayed there'
    },
    {
      id: 2,
      title: 'New Service Database Configuration',
      type: 'code',
      content: `
\`\`\`typescript
// inventory-service/src/database.ts
import { Pool } from 'pg';

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,  // Max connections per instance
  min: 10,  // Min connections kept open
  idleTimeoutMillis: 0,  // Never close idle connections
  connectionTimeoutMillis: 30000,
});

// Used for every request
export async function query(sql: string, params: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}
\`\`\`
      `,
      hint: 'min: 10 connections per instance, and they never close (idleTimeoutMillis: 0)'
    },
    {
      id: 3,
      title: 'Service Deployment Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# inventory-service/kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inventory-service
spec:
  replicas: 5  # 5 instances of the service
  template:
    spec:
      containers:
      - name: inventory-service
        image: inventory-service:latest
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: DB_HOST
          value: "main-db.xxx.rds.amazonaws.com"
        - name: DB_NAME
          value: "production"
\`\`\`
      `,
      hint: '5 replicas, each with min 10 connections = 50 new connections minimum'
    },
    {
      id: 4,
      title: 'Existing Services Connection Usage',
      type: 'metrics',
      content: `
## Connection Usage by Service (before incident)

| Service | Replicas | Pool Size | Total Connections |
|---------|----------|-----------|-------------------|
| api-gateway | 3 | 10 | 30 |
| order-service | 2 | 5 | 10 |
| user-service | 2 | 3 | 6 |
| **Total Before** | | | **46** |

## After inventory-service deployment

| Service | Replicas | Pool Size | Total Connections |
|---------|----------|-----------|-------------------|
| api-gateway | 3 | 10 | 30 |
| order-service | 2 | 5 | 10 |
| user-service | 2 | 3 | 6 |
| inventory-service | 5 | 20 | 100 |
| **Total After** | | | **146** |

**But we're seeing 200 connections, not 146. Where are the extra 54?**
      `,
      hint: 'Sum doesn\'t add up - there are leaked connections somewhere'
    },
    {
      id: 5,
      title: 'Database Connection Query',
      type: 'logs',
      content: `
\`\`\`sql
-- Check active connections
SELECT
  application_name,
  state,
  count(*)
FROM pg_stat_activity
GROUP BY application_name, state;

-- Results:
application_name     | state  | count
---------------------|--------|------
api-gateway          | idle   | 30
order-service        | idle   | 10
user-service         | idle   | 6
inventory-service    | idle   | 100
                     | idle   | 54     -- No application name!
---------------------|--------|------

-- Who are these 54 unnamed connections?
SELECT
  pid,
  usename,
  client_addr,
  backend_start,
  state_change
FROM pg_stat_activity
WHERE application_name = '';

-- These are OLD connections from previous deployments
-- They never closed because idleTimeoutMillis: 0
-- Old pods are gone but connections persist!
\`\`\`
      `,
      hint: '54 orphaned connections from pods that no longer exist'
    },
    {
      id: 6,
      title: 'RDS Connection Limits',
      type: 'config',
      content: `
\`\`\`markdown
# RDS Connection Limits

## Default max_connections by Instance Class
| Instance Class | Memory | Default max_connections |
|----------------|--------|------------------------|
| db.t3.micro | 1 GB | 66 |
| db.t3.small | 2 GB | 150 |
| db.t3.medium | 4 GB | 200 |  <-- Your instance
| db.r5.large | 16 GB | 1,000 |

## Formula
max_connections = LEAST({DBInstanceClassMemory/9531392}, 5000)

## Best Practices
1. Use connection pooling (PgBouncer, RDS Proxy)
2. Set idle connection timeouts
3. Size connection pools based on actual need
4. Monitor connections as a percentage of max
5. Set application_name for debugging
\`\`\`
      `,
      hint: 'A db.t3.medium only supports 200 connections total'
    }
  ],

  solution: {
    diagnosis: 'New service with aggressive connection pool settings combined with orphaned connections from rolling deployments exhausted the 200-connection database limit',

    keywords: [
      'rds', 'connection pool', 'max_connections', 'too many connections',
      'connection exhaustion', 'idle timeout', 'pgbouncer', 'rds proxy',
      'connection leak', 'database connections'
    ],

    rootCause: `
      The new inventory-service was configured with an aggressive connection pool:
      - min: 10 (always keep 10 connections open per instance)
      - max: 20 (can grow to 20 connections per instance)
      - idleTimeoutMillis: 0 (never close idle connections)

      With 5 replicas, this immediately grabbed 50 connections (5 x 10 min).

      The existing services were already using 46 connections, bringing the total
      to 96. However, there were also 54 "orphaned" connections from previous
      deployments - connections that were never closed because of the zero idle
      timeout setting. These orphaned connections existed because:

      1. When Kubernetes replaces pods during deployments, old pods are terminated
      2. If the pod doesn't gracefully close database connections, they persist
      3. PostgreSQL waits for the TCP timeout (often 2+ hours) to clean them up
      4. With idleTimeoutMillis: 0, the client never initiates a close

      Total: 46 (existing) + 100 (new service) + 54 (orphaned) = 200 = max_connections

      Rolling back the new service didn't help immediately because the orphaned
      connections weren't from the new service - they were from previous deployments
      of all services.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fix: Set reasonable pool and idle timeout settings',
        code: `// inventory-service/src/database.ts
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Reasonable pool size
  max: 5,              // Max connections per instance (not 20!)
  min: 1,              // Don't hoard connections when idle

  // Critical: Close idle connections
  idleTimeoutMillis: 30000,       // Close after 30 seconds idle
  connectionTimeoutMillis: 5000,  // Fail fast if can't connect

  // Help debugging
  application_name: 'inventory-service',
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool');
  await pool.end();  // Properly close all connections
  process.exit(0);
});`
      },
      {
        lang: 'yaml',
        description: 'Kubernetes: Add preStop hook for graceful shutdown',
        code: `# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inventory-service
spec:
  replicas: 3  # Reduced from 5
  template:
    spec:
      terminationGracePeriodSeconds: 30
      containers:
      - name: inventory-service
        image: inventory-service:latest
        lifecycle:
          preStop:
            exec:
              # Give the app time to close connections gracefully
              command: ["/bin/sh", "-c", "sleep 5"]
        env:
        - name: DB_POOL_MAX
          value: "5"  # Configure via env var
        - name: DB_IDLE_TIMEOUT
          value: "30000"`
      },
      {
        lang: 'sql',
        description: 'Emergency: Kill orphaned connections',
        code: `-- Find and kill orphaned connections (connections from IPs that don't exist)

-- First, identify orphaned connections
SELECT pid, usename, client_addr, backend_start, state
FROM pg_stat_activity
WHERE state = 'idle'
  AND backend_start < NOW() - INTERVAL '1 hour'
  AND application_name = '';

-- Kill specific connections (be careful in production!)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND backend_start < NOW() - INTERVAL '1 hour'
  AND application_name = '';

-- Or kill ALL idle connections older than 2 hours
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND backend_start < NOW() - INTERVAL '2 hours';

-- Monitor connection count
SELECT count(*) FROM pg_stat_activity;`
      },
      {
        lang: 'bash',
        description: 'Use RDS Proxy for connection pooling',
        code: `# RDS Proxy handles connection pooling at the infrastructure level

# Create RDS Proxy via AWS CLI
aws rds create-db-proxy \\
  --db-proxy-name main-db-proxy \\
  --engine-family POSTGRESQL \\
  --auth Description="Proxy auth",AuthScheme=SECRETS,SecretArn=arn:aws:secretsmanager:... \\
  --role-arn arn:aws:iam::123456789:role/rds-proxy-role \\
  --vpc-subnet-ids subnet-xxx subnet-yyy

# Create target group
aws rds register-db-proxy-targets \\
  --db-proxy-name main-db-proxy \\
  --db-instance-identifiers main-db

# Update app to connect to proxy endpoint instead of direct RDS
# DB_HOST=main-db-proxy.proxy-xxx.us-east-1.rds.amazonaws.com

# Benefits:
# - Proxy handles connection pooling (max 200 DB connections)
# - Apps can open thousands of connections to proxy
# - Handles connection multiplexing and queueing
# - Faster failover during RDS maintenance`
      },
      {
        lang: 'typescript',
        description: 'Connection pool calculation helper',
        code: `// Calculate appropriate pool size across services

interface ServiceConfig {
  name: string;
  replicas: number;
  maxPoolSize: number;
}

function calculateTotalConnections(services: ServiceConfig[]): number {
  return services.reduce((sum, svc) => sum + (svc.replicas * svc.maxPoolSize), 0);
}

function validatePoolConfiguration(
  services: ServiceConfig[],
  maxConnections: number
): { valid: boolean; message: string } {
  const total = calculateTotalConnections(services);

  // Leave 10% headroom for admin connections
  const safeMax = Math.floor(maxConnections * 0.9);

  if (total > safeMax) {
    return {
      valid: false,
      message: \`Total connections (\${total}) exceeds safe limit (\${safeMax}). \\n\` +
               \`Reduce pool sizes or add RDS Proxy.\`
    };
  }

  return {
    valid: true,
    message: \`Total connections (\${total}) within limit (\${safeMax})\`
  };
}

// Usage:
const services: ServiceConfig[] = [
  { name: 'api-gateway', replicas: 3, maxPoolSize: 5 },
  { name: 'order-service', replicas: 2, maxPoolSize: 3 },
  { name: 'user-service', replicas: 2, maxPoolSize: 2 },
  { name: 'inventory-service', replicas: 3, maxPoolSize: 3 },
];

console.log(validatePoolConfiguration(services, 200));
// { valid: true, message: "Total connections (36) within limit (180)" }`
      }
    ],

    prevention: [
      'Always set idleTimeoutMillis to close unused connections (30-60 seconds)',
      'Size connection pools based on total database capacity, not just per-service need',
      'Use connection pooling middleware (PgBouncer, RDS Proxy) for many services',
      'Set application_name in pool config for debugging',
      'Implement graceful shutdown to close connections before pod termination',
      'Monitor connection count as percentage of max_connections',
      'Document total connection budget across all services',
      'Alert at 70% connection utilization'
    ],

    educationalInsights: [
      'Database connections are finite resources that must be budgeted across services',
      'Aggressive min pool settings can cause connection exhaustion during deployments',
      'Kubernetes pod termination does not automatically close database connections',
      'Orphaned connections persist until TCP timeout or manual termination',
      'RDS Proxy provides connection multiplexing, allowing more apps than DB connections',
      'Connection pools should fail fast to prevent request queueing cascades'
    ]
  }
};

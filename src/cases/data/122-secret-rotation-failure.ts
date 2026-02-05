import type { DetectiveCase } from "../../types";

export const secretRotationFailure: DetectiveCase = {
	id: "secret-rotation-failure",
	title: "The Secret Rotation Failure",
	subtitle: "Service outage during credential rotation",
	difficulty: "senior",
	category: "auth",

	crisis: {
		description:
			"During scheduled database credential rotation, the application lost the ability to connect to the database. The old credentials were revoked before all application instances picked up the new ones, causing a 45-minute outage.",
		impact:
			"Complete service outage for 45 minutes. All database operations failed. 50,000 users affected. Incident declared P1.",
		timeline: [
			{ time: "2:00 AM", event: "Scheduled credential rotation begins", type: "normal" },
			{ time: "2:01 AM", event: "New credentials generated in Secrets Manager", type: "normal" },
			{ time: "2:02 AM", event: "Old credentials revoked in database", type: "normal" },
			{ time: "2:02 AM", event: "Application starts throwing auth errors", type: "critical" },
			{ time: "2:05 AM", event: "All pods showing database connection failures", type: "critical" },
			{ time: "2:10 AM", event: "On-call paged, begins investigation", type: "warning" },
			{ time: "2:45 AM", event: "Manual credential update, service restored", type: "normal" },
		],
	},

	symptoms: {
		working: [
			"New credentials work when tested manually",
			"Secrets Manager has correct new credentials",
			"Database is healthy and accepting connections",
			"Application pods are running (not crashing)",
			"Other services (cache, queues) working fine",
		],
		broken: [
			"All database connections failing with auth errors",
			"Connection pool cannot establish new connections",
			"Retry logic keeps using old credentials",
			"Pods don't automatically pick up new secret",
			"Rolling restart didn't help immediately",
		],
	},

	clues: [
		{
			id: 1,
			title: "Secret Rotation Lambda",
			type: "code",
			content: `\`\`\`python
# rotation_lambda.py
def lambda_handler(event, context):
    step = event['Step']
    secret_arn = event['SecretId']

    if step == 'createSecret':
        # Generate new password
        new_password = generate_secure_password()
        secrets_client.put_secret_value(
            SecretId=secret_arn,
            SecretString=json.dumps({'password': new_password}),
            VersionStage='AWSPENDING'
        )

    elif step == 'setSecret':
        # Update password in database
        pending_secret = get_secret_value(secret_arn, 'AWSPENDING')
        db_admin_conn.execute(
            f"ALTER USER app_user PASSWORD '{pending_secret['password']}'"
        )

    elif step == 'testSecret':
        # Test the new credentials
        pending_secret = get_secret_value(secret_arn, 'AWSPENDING')
        test_connection(pending_secret)  # Verify new creds work

    elif step == 'finishSecret':
        # Swap the version labels
        secrets_client.update_secret_version_stage(
            SecretId=secret_arn,
            VersionStage='AWSCURRENT',
            MoveToVersionId=pending_version_id,
            RemoveFromVersionId=current_version_id
        )
        # OLD CREDENTIALS ARE NOW INVALID
        # But application might still be using cached version!
\`\`\``,
			hint: "Look at what happens in finishSecret - when are old creds invalidated?",
		},
		{
			id: 2,
			title: "Application Database Configuration",
			type: "code",
			content: `\`\`\`typescript
// database.ts
import { SecretsManager } from 'aws-sdk';

class DatabaseConnection {
  private credentials: DbCredentials;
  private pool: ConnectionPool;

  constructor() {
    // Fetch credentials once at startup
    this.credentials = await this.fetchCredentials();
    this.pool = this.createPool(this.credentials);
  }

  private async fetchCredentials(): Promise<DbCredentials> {
    const secretsManager = new SecretsManager();
    const secret = await secretsManager.getSecretValue({
      SecretId: 'prod/database/credentials'
    }).promise();

    return JSON.parse(secret.SecretString!);
  }

  private createPool(creds: DbCredentials): ConnectionPool {
    return new Pool({
      host: creds.host,
      user: creds.username,
      password: creds.password,  // Cached at startup!
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  // No mechanism to refresh credentials!
}

// Singleton - created once, used forever
export const db = new DatabaseConnection();
\`\`\``,
			hint: "The credentials are fetched once at startup and never refreshed...",
		},
		{
			id: 3,
			title: "Pod Lifecycle",
			type: "logs",
			content: `\`\`\`
Pod Timeline During Rotation:
=============================
Pod api-abc123 (started 6 hours ago):
  - Fetched credentials at startup (6 hours ago)
  - Using credentials from 6 hours ago
  - Has 15 active connections in pool

Pod api-def456 (started 2 hours ago):
  - Fetched credentials at startup (2 hours ago)
  - Using credentials from 2 hours ago
  - Has 18 active connections in pool

Pod api-ghi789 (started 30 minutes ago):
  - Fetched credentials at startup (30 minutes ago)
  - Using same credentials (rotation hadn't happened yet)
  - Has 12 active connections in pool

At 2:02 AM:
  - All pods still using OLD credentials (cached)
  - OLD credentials revoked in database
  - All connection pools fail on next connection attempt
  - Existing connections work until they return to pool
  - New connections fail immediately
\`\`\``,
			hint: "All pods cached credentials at startup, none refresh them...",
		},
		{
			id: 4,
			title: "Secrets Manager Configuration",
			type: "config",
			content: `\`\`\`json
{
  "Name": "prod/database/credentials",
  "RotationEnabled": true,
  "RotationLambdaARN": "arn:aws:lambda:...:rotation-lambda",
  "RotationRules": {
    "AutomaticallyAfterDays": 30
  },
  "VersionIdsToStages": {
    "abc-123-old": ["AWSPREVIOUS"],
    "def-456-new": ["AWSCURRENT"]
  }
}

// Note: Secrets Manager can keep both versions
// But application only knows about one (cached at startup)
// And database only accepts AWSCURRENT password
\`\`\``,
		},
		{
			id: 5,
			title: "SRE Postmortem Notes",
			type: "testimony",
			content: `"The rotation worked exactly as designed. New credentials were created, tested, and promoted to AWSCURRENT. The problem is our application never checks for new credentials. It caches them at startup and uses them forever. We assumed restarting pods would fix it, but even new pods took 5-10 minutes to start, and during that time we had zero capacity. We should have had the application refresh credentials periodically, or used a dual-credential approach during rotation."`,
		},
		{
			id: 6,
			title: "AWS Best Practices (Not Followed)",
			type: "config",
			content: `\`\`\`
AWS Secrets Manager Rotation Best Practices:
============================================

1. Use dual-user rotation strategy
   - Alternate between two database users
   - Old user stays valid until next rotation
   NOT IMPLEMENTED: We use single user

2. Application should retry with refreshed credentials
   - On auth failure, fetch latest secret and retry
   NOT IMPLEMENTED: We just fail

3. Application should periodically refresh credentials
   - Every 5-10 minutes, check for new secret version
   NOT IMPLEMENTED: We cache forever

4. Use AWSPREVIOUS for graceful transition
   - Database should accept both AWSCURRENT and AWSPREVIOUS
   NOT IMPLEMENTED: We revoke immediately

5. Test rotation in non-production first
   IMPLEMENTED: But non-prod has 1 pod, didn't catch timing issue
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Application cached credentials at startup and never refreshed during rotation",
		keywords: [
			"secret rotation",
			"credential caching",
			"Secrets Manager",
			"auth failure",
			"connection pool",
			"dual-user",
			"graceful rotation",
			"credential refresh",
		],
		rootCause: `The secret rotation failed due to a mismatch between the rotation mechanism and application behavior:

1. **Application caches credentials forever**: Credentials are fetched once at startup and stored in memory. The connection pool uses these cached credentials for all new connections.

2. **Immediate credential revocation**: The rotation lambda changes the database password and immediately updates which version is "AWSCURRENT." The old password stops working instantly.

3. **No refresh mechanism**: The application has no way to detect that credentials have changed, no periodic refresh, and no retry-with-new-credentials logic.

4. **Single-user rotation**: Using the same database user means when the password changes, all existing sessions using the old password become invalid.

The sequence:
1. Rotation lambda creates new password
2. Database password changed to new password
3. Secrets Manager marks new version as AWSCURRENT
4. Old password no longer works
5. Application still has old password cached
6. All new database connections fail
7. No automatic recovery path exists`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fix: Implement credential refresh with retry logic",
				code: `// database.ts - Fixed with credential refresh
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

class DatabaseConnection {
  private credentials: DbCredentials | null = null;
  private credentialsExpiry: Date = new Date(0);
  private pool: ConnectionPool | null = null;
  private refreshInterval: NodeJS.Timeout;

  constructor() {
    // Refresh credentials every 5 minutes
    this.refreshInterval = setInterval(
      () => this.refreshCredentials(),
      5 * 60 * 1000
    );
  }

  async getConnection(): Promise<PoolClient> {
    // Ensure credentials are fresh
    if (this.shouldRefreshCredentials()) {
      await this.refreshCredentials();
    }

    try {
      return await this.pool!.connect();
    } catch (error) {
      if (this.isAuthError(error)) {
        // Auth failed - force credential refresh and retry
        console.log('Auth error, refreshing credentials...');
        await this.refreshCredentials(true);  // Force refresh
        return await this.pool!.connect();  // Retry
      }
      throw error;
    }
  }

  private shouldRefreshCredentials(): boolean {
    return !this.credentials ||
           new Date() > this.credentialsExpiry;
  }

  private async refreshCredentials(force = false): Promise<void> {
    if (!force && !this.shouldRefreshCredentials()) return;

    const newCreds = await this.fetchCredentials();

    // Check if credentials actually changed
    if (this.credentialsChanged(newCreds)) {
      console.log('Credentials changed, recreating pool...');
      await this.recreatePool(newCreds);
    }

    this.credentials = newCreds;
    this.credentialsExpiry = new Date(Date.now() + 5 * 60 * 1000);
  }

  private async recreatePool(creds: DbCredentials): Promise<void> {
    const oldPool = this.pool;

    // Create new pool with new credentials
    this.pool = new Pool({
      host: creds.host,
      user: creds.username,
      password: creds.password,
      max: 20,
    });

    // Gracefully drain old pool
    if (oldPool) {
      await oldPool.end();
    }
  }

  private isAuthError(error: any): boolean {
    return error.code === '28P01' ||  // PostgreSQL auth failure
           error.message?.includes('authentication failed');
  }
}`,
			},
			{
				lang: "python",
				description: "Improved rotation lambda with dual-user strategy",
				code: `# rotation_lambda.py - Dual user rotation
def lambda_handler(event, context):
    """
    Dual-user rotation: Alternate between user_a and user_b.
    This ensures the previous credentials remain valid until
    the next rotation cycle.
    """
    step = event['Step']
    secret_arn = event['SecretId']

    if step == 'createSecret':
        current_secret = get_current_secret(secret_arn)

        # Determine which user to rotate TO
        current_user = current_secret.get('username', 'app_user_a')
        new_user = 'app_user_b' if current_user == 'app_user_a' else 'app_user_a'

        # Generate new password for the alternate user
        new_password = generate_secure_password()

        secrets_client.put_secret_value(
            SecretId=secret_arn,
            SecretString=json.dumps({
                'username': new_user,
                'password': new_password,
                'host': current_secret['host'],
                'port': current_secret['port'],
            }),
            VersionStage='AWSPENDING'
        )

    elif step == 'setSecret':
        pending_secret = get_secret_value(secret_arn, 'AWSPENDING')

        # Update the alternate user's password
        db_admin_conn.execute(f"""
            ALTER USER {pending_secret['username']}
            PASSWORD '{pending_secret['password']}'
        """)

        # Grant necessary permissions
        db_admin_conn.execute(f"""
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
            IN SCHEMA public TO {pending_secret['username']}
        """)

    elif step == 'testSecret':
        pending_secret = get_secret_value(secret_arn, 'AWSPENDING')
        test_database_connection(pending_secret)

    elif step == 'finishSecret':
        # Swap version labels
        # NOTE: Previous user credentials remain valid!
        # They'll be rotated on the NEXT rotation cycle
        secrets_client.update_secret_version_stage(
            SecretId=secret_arn,
            VersionStage='AWSCURRENT',
            MoveToVersionId=pending_version_id,
            RemoveFromVersionId=current_version_id
        )

        # Don't revoke old user - let it stay valid
        # It will get a new password on next rotation`,
			},
			{
				lang: "yaml",
				description: "Kubernetes deployment with secret refresh sidecar",
				code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      containers:
      - name: api
        image: api-service:latest
        env:
        - name: DB_CREDENTIALS_FILE
          value: /secrets/db-credentials.json
        volumeMounts:
        - name: db-secrets
          mountPath: /secrets
          readOnly: true

      # Sidecar that refreshes secrets periodically
      - name: secret-refresher
        image: amazon/aws-secrets-manager-agent:latest
        args:
        - --secret-id=prod/database/credentials
        - --output=/secrets/db-credentials.json
        - --refresh-interval=300  # 5 minutes
        volumeMounts:
        - name: db-secrets
          mountPath: /secrets

      volumes:
      - name: db-secrets
        emptyDir:
          medium: Memory  # tmpfs for security

---
# Alternative: Use External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
spec:
  refreshInterval: 5m  # Check for new credentials every 5 minutes
  secretStoreRef:
    kind: SecretStore
    name: aws-secrets-manager
  target:
    name: db-credentials
  data:
  - secretKey: password
    remoteRef:
      key: prod/database/credentials
      property: password`,
			},
			{
				lang: "typescript",
				description: "Connection wrapper with automatic credential refresh",
				code: `// resilient-db-connection.ts
class ResilientDatabaseConnection {
  private secretsManager: SecretsManagerClient;
  private secretId: string;
  private pool: Pool | null = null;
  private lastSecretVersionId: string = '';

  async query<T>(sql: string, params?: any[]): Promise<T> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.getPool().connect();
        try {
          return await client.query(sql, params);
        } finally {
          client.release();
        }
      } catch (error) {
        if (this.isAuthError(error) && attempt < maxRetries) {
          console.log(\`Auth error on attempt \${attempt}, refreshing credentials...\`);
          await this.forceRefreshCredentials();
          continue;  // Retry with new credentials
        }
        throw error;
      }
    }
    throw new Error('All retry attempts failed');
  }

  private async forceRefreshCredentials(): Promise<void> {
    // Fetch latest secret
    const response = await this.secretsManager.send(
      new GetSecretValueCommand({ SecretId: this.secretId })
    );

    // Check if version changed
    if (response.VersionId !== this.lastSecretVersionId) {
      console.log('Secret version changed, recreating connection pool');
      this.lastSecretVersionId = response.VersionId!;

      const creds = JSON.parse(response.SecretString!);

      // Gracefully replace pool
      const oldPool = this.pool;
      this.pool = new Pool({
        host: creds.host,
        user: creds.username,
        password: creds.password,
        max: 20,
      });

      // End old pool after new one is ready
      if (oldPool) {
        oldPool.end().catch(err =>
          console.error('Error closing old pool:', err)
        );
      }
    }
  }
}`,
			},
		],
		prevention: [
			"Implement periodic credential refresh (every 5-10 minutes)",
			"Use dual-user rotation strategy so old credentials remain valid",
			"Add retry logic that refreshes credentials on auth failures",
			"Test rotation in an environment that mimics production pod lifecycle",
			"Use tools like External Secrets Operator for automatic refresh",
			"Monitor for auth failures and alert before rotation events",
			"Document rotation schedule and ensure teams are aware",
			"Implement gradual rollout of credential changes",
		],
		educationalInsights: [
			"Credentials cached at startup become stale after rotation",
			"Single-user rotation creates a window where no credentials work",
			"Dual-user rotation keeps previous credentials valid until next cycle",
			"Auth failures should trigger credential refresh, not just error logging",
			"Connection pools hold credentials - replacing the pool is required",
			"Secrets Manager keeps AWSPREVIOUS for exactly this use case",
			"Testing rotation requires simulating the full pod lifecycle, not just the rotation",
		],
	},
};

import type { DetectiveCase } from '../../types';

export const kubernetesCrashLoopBackOff: DetectiveCase = {
  id: 'kubernetes-crashloopbackoff',
  title: 'The CrashLoopBackOff Conundrum',
  subtitle: 'Container crashing on startup with cryptic exit code',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `After a routine deployment, the user-service pods are in CrashLoopBackOff. The containers start, run for about 2 seconds, then exit. Kubernetes keeps restarting them with increasing backoff delays. The previous version worked fine, and the code change was minimal.`,
    impact: `User authentication and profile features completely down. All API calls requiring user context failing. Critical P1 incident affecting 100% of users.`,
    timeline: [
      { time: '11:00 AM', event: 'Deployed user-service v2.5.1', type: 'normal' },
      { time: '11:01 AM', event: 'Pods enter Running state briefly', type: 'normal' },
      { time: '11:01 AM', event: 'Pods crash with exit code 1', type: 'warning' },
      { time: '11:02 AM', event: 'CrashLoopBackOff state begins', type: 'critical' },
      { time: '11:15 AM', event: 'Rollback initiated but same issue', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Docker image builds successfully',
      'Container runs fine in local Docker',
      'Previous pods (now terminated) were healthy',
      'Other services in the cluster running normally',
      'Node resources (CPU/memory) are fine'
    ],
    broken: [
      'Pods crash within 2 seconds of starting',
      'Exit code 1 (application error)',
      'CrashLoopBackOff with increasing delays',
      'Rollback to previous version also crashes',
      'Same behavior on all replicas and nodes'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Pod Status and Events',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pods -l app=user-service
NAME                           READY   STATUS             RESTARTS   AGE
user-service-6b7c8d9e0-abc12   0/1     CrashLoopBackOff   5          8m
user-service-6b7c8d9e0-def34   0/1     CrashLoopBackOff   5          8m

$ kubectl describe pod user-service-6b7c8d9e0-abc12
State:          Waiting
  Reason:       CrashLoopBackOff
Last State:     Terminated
  Reason:       Error
  Exit Code:    1
  Started:      Wed, 15 Mar 2024 11:14:00 +0000
  Finished:     Wed, 15 Mar 2024 11:14:02 +0000

Events:
  Type     Reason     Age   Message
  ----     ------     ----  -------
  Normal   Pulled     2m    Container image pulled successfully
  Normal   Created    2m    Created container user-service
  Normal   Started    2m    Started container user-service
  Warning  BackOff    1m    Back-off restarting failed container
\`\`\``,
      hint: 'The container runs for only 2 seconds before crashing...'
    },
    {
      id: 2,
      title: 'Container Logs',
      type: 'logs',
      content: `\`\`\`
$ kubectl logs user-service-6b7c8d9e0-abc12
Starting user-service v2.5.1...
Loading configuration...
Error: Required configuration 'JWT_SIGNING_KEY' not found
  at loadConfig (/app/dist/config.js:45:11)
  at Object.<anonymous> (/app/dist/index.js:12:1)

Process exited with code 1

$ kubectl logs user-service-6b7c8d9e0-abc12 --previous
Starting user-service v2.5.1...
Loading configuration...
Error: Required configuration 'JWT_SIGNING_KEY' not found
  at loadConfig (/app/dist/config.js:45:11)
  at Object.<anonymous> (/app/dist/index.js:12:1)
\`\`\``,
      hint: 'The error message tells you exactly what is missing...'
    },
    {
      id: 3,
      title: 'Deployment Configuration',
      type: 'config',
      content: `\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: user-service
        image: myregistry/user-service:v2.5.1
        envFrom:
        - configMapRef:
            name: user-service-config
        - secretRef:
            name: user-service-secrets
        ports:
        - containerPort: 3000
\`\`\``,
      hint: 'The deployment references a ConfigMap and Secret...'
    },
    {
      id: 4,
      title: 'ConfigMap and Secret Status',
      type: 'logs',
      content: `\`\`\`
$ kubectl get configmap user-service-config -o yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: user-service-config
data:
  DATABASE_URL: "postgres://db:5432/users"
  REDIS_URL: "redis://cache:6379"
  LOG_LEVEL: "info"

$ kubectl get secret user-service-secrets
Error from server (NotFound): secrets "user-service-secrets" not found

$ kubectl get secrets
NAME                  TYPE                                  DATA   AGE
default-token-xyz     kubernetes.io/service-account-token   3      30d
db-credentials        Opaque                                2      30d
\`\`\``,
      hint: 'One of the referenced resources does not exist...'
    },
    {
      id: 5,
      title: 'Recent Changes',
      type: 'testimony',
      content: `"We renamed some secrets last week for consistency. The old secret was called 'user-svc-secrets' and we renamed it to 'user-service-secrets' to match our naming convention. I updated the deployment YAML in Git."

"Wait, I just checked - the secret rename PR was merged, but the actual secret in the cluster was never recreated with the new name. The old secret got deleted during cleanup..."

"The rollback didn't help because the deployment YAML in all versions now references the new secret name, but the secret itself doesn't exist."`,
      hint: 'The secret was renamed in config but not recreated in the cluster...'
    },
    {
      id: 6,
      title: 'Application Code',
      type: 'code',
      content: `\`\`\`typescript
// config.ts
interface Config {
  databaseUrl: string;
  redisUrl: string;
  jwtSigningKey: string;  // Required for auth
  logLevel: string;
}

export function loadConfig(): Config {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SIGNING_KEY'];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(\`Required configuration '\${key}' not found\`);
    }
  }

  return {
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    jwtSigningKey: process.env.JWT_SIGNING_KEY!,
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
\`\`\``,
      hint: 'The app requires JWT_SIGNING_KEY which should come from the secret...'
    }
  ],

  solution: {
    diagnosis: 'Pod crashing due to missing Kubernetes Secret containing required environment variable',
    keywords: [
      'crashloopbackoff', 'secret', 'configmap', 'missing', 'environment variable',
      'exit code 1', 'configuration', 'kubernetes', 'not found', 'envFrom'
    ],
    rootCause: `The deployment references a Secret named "user-service-secrets" via envFrom, but this Secret does not exist in the cluster. The Secret was renamed from "user-svc-secrets" to "user-service-secrets" in the deployment configuration, but the actual Secret resource was never recreated with the new name.

When Kubernetes creates the pod, it attempts to inject environment variables from the Secret. Since the Secret doesn't exist, the environment variables (including JWT_SIGNING_KEY) are never set. The application starts, attempts to load configuration, finds JWT_SIGNING_KEY missing, and exits with code 1.

Rollback didn't help because all deployment versions in Git now reference the new Secret name, but the Secret itself never existed. The old Secret with the previous name was deleted during a cleanup.`,
    codeExamples: [
      {
        lang: 'bash',
        description: 'Recreate the missing secret',
        code: `# Option 1: Recreate from literal values
kubectl create secret generic user-service-secrets \\
  --from-literal=JWT_SIGNING_KEY='your-secret-key-here' \\
  --dry-run=client -o yaml | kubectl apply -f -

# Option 2: Recreate from file
kubectl create secret generic user-service-secrets \\
  --from-env-file=./secrets.env \\
  --dry-run=client -o yaml | kubectl apply -f -

# Option 3: Apply from sealed-secrets or external-secrets
kubectl apply -f user-service-secrets.sealed.yaml

# Verify the secret exists
kubectl get secret user-service-secrets -o yaml

# Restart the deployment to pick up the secret
kubectl rollout restart deployment/user-service`
      },
      {
        lang: 'yaml',
        description: 'Deployment with optional secret reference (prevents crash if missing)',
        code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  template:
    spec:
      containers:
      - name: user-service
        image: myregistry/user-service:v2.5.1
        envFrom:
        - configMapRef:
            name: user-service-config
        - secretRef:
            name: user-service-secrets
            optional: true  # Pod will start even if secret missing
        env:
        # Explicit required check - pod won't start if secret missing
        - name: JWT_SIGNING_KEY
          valueFrom:
            secretKeyRef:
              name: user-service-secrets
              key: JWT_SIGNING_KEY
              optional: false  # Explicit: fail if missing`
      },
      {
        lang: 'yaml',
        description: 'GitOps approach: Secret definition in repo (using sealed-secrets)',
        code: `# sealed-secret.yaml - Safe to commit to Git
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: user-service-secrets
  namespace: default
spec:
  encryptedData:
    JWT_SIGNING_KEY: AgBy8hCi...encrypted...data==
  template:
    metadata:
      name: user-service-secrets
    type: Opaque

# The SealedSecret controller decrypts this and creates
# the actual Secret in the cluster`
      }
    ],
    prevention: [
      'Use GitOps to manage Secrets (via Sealed Secrets, External Secrets, or SOPS)',
      'Add pre-deployment checks in CI/CD to verify required resources exist',
      'Use admission controllers to prevent deployments referencing missing resources',
      'Implement proper secret rotation procedures that update references atomically',
      'Add explicit optional: false for critical secretKeyRef to fail fast with clear errors'
    ],
    educationalInsights: [
      'CrashLoopBackOff means the container keeps crashing - check logs with kubectl logs',
      'Exit code 1 indicates an application-level error (not OOM or signal)',
      'envFrom with missing resources silently skips them unless optional: false is set',
      'Kubernetes Secrets are cluster resources - they must exist before pods reference them',
      'Rollback only rolls back the Deployment spec, not external resources like Secrets'
    ]
  }
};

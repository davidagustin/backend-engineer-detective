import type { DetectiveCase } from '../../types';

export const argocdSyncLoop: DetectiveCase = {
  id: 'argocd-sync-loop',
  title: 'The ArgoCD Sync Loop Saga',
  subtitle: 'Application constantly out of sync despite no changes',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `Your ArgoCD application shows "OutOfSync" status and continuously attempts to sync. The sync succeeds, the app briefly shows "Synced", then immediately goes back to "OutOfSync" and syncs again. This happens every 30 seconds in an endless loop, overwhelming your cluster with constant redeployments.`,
    impact: `Continuous pod restarts disrupting service. ArgoCD flooding cluster with apply operations. Team cannot determine actual sync state. Other ArgoCD operations delayed due to constant syncing.`,
    timeline: [
      { time: '9:00 AM', event: 'Enabled auto-sync on payment-service application', type: 'normal' },
      { time: '9:01 AM', event: 'First sync completed successfully', type: 'normal' },
      { time: '9:02 AM', event: 'Application shows OutOfSync again', type: 'warning' },
      { time: '9:02 AM', event: 'Auto-sync triggers another sync', type: 'warning' },
      { time: '9:15 AM', event: 'Noticed 30+ syncs in 15 minutes', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Git repository unchanged',
      'Manual kubectl apply works correctly',
      'Application pods are running',
      'ArgoCD can connect to cluster',
      'Sync operation itself completes without errors'
    ],
    broken: [
      'Application perpetually shows OutOfSync',
      'Sync loop every 30 seconds',
      'ArgoCD diff shows differences even after sync',
      'Pods restarting due to constant redeployments',
      'Application events show continuous sync operations'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'ArgoCD Application Status',
      type: 'logs',
      content: `\`\`\`
$ argocd app get payment-service
Name:               payment-service
Project:            default
Server:             https://kubernetes.default.svc
Namespace:          production
URL:                https://argocd.company.com/applications/payment-service
Repo:               https://github.com/company/manifests.git
Path:               apps/payment-service
Target:             main
SyncWindow:         Sync Allowed
Sync Policy:        Automated
Sync Status:        OutOfSync
Health Status:      Healthy

SYNC STATUS:
  Last Sync:        2024-03-15 09:15:00 (30 seconds ago)
  Sync Result:      Succeeded
  Diff:             Yes (see app diff)

$ argocd app history payment-service | tail -10
ID  DATE                     REVISION
45  2024-03-15 09:14:30      abc1234
44  2024-03-15 09:14:00      abc1234
43  2024-03-15 09:13:30      abc1234
42  2024-03-15 09:13:00      abc1234
41  2024-03-15 09:12:30      abc1234
...
\`\`\``,
      hint: 'Same revision syncing over and over...'
    },
    {
      id: 2,
      title: 'ArgoCD Diff Output',
      type: 'logs',
      content: `\`\`\`yaml
$ argocd app diff payment-service

===== apps/Deployment payment-service/payment-service ======
  spec:
    template:
      metadata:
        annotations:
-         kubectl.kubernetes.io/restartedAt: "2024-03-15T09:14:30Z"
+         kubectl.kubernetes.io/restartedAt: "2024-03-15T09:15:00Z"

===== apps/Deployment payment-service/payment-service ======
  spec:
    template:
      spec:
        containers:
        - name: payment-service
          resources:
            limits:
-             cpu: 1001m
+             cpu: "1"
            memory: 1Gi
\`\`\``,
      hint: 'The diff shows changes that keep reappearing...'
    },
    {
      id: 3,
      title: 'Deployment Manifest in Git',
      type: 'config',
      content: `\`\`\`yaml
# apps/payment-service/deployment.yaml in Git
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  annotations:
    config.kubernetes.io/origin: "argo"
spec:
  replicas: 3
  template:
    metadata:
      annotations: {}  # No restartedAt annotation here
    spec:
      containers:
      - name: payment-service
        image: payment-service:v1.2.3
        resources:
          limits:
            cpu: "1"    # String format
            memory: 1Gi
          requests:
            cpu: 500m
            memory: 512Mi
\`\`\``,
      hint: 'Compare the Git manifest to what ArgoCD sees...'
    },
    {
      id: 4,
      title: 'Cluster Resource State',
      type: 'logs',
      content: `\`\`\`yaml
$ kubectl get deployment payment-service -o yaml | grep -A20 "spec:"
spec:
  replicas: 3
  template:
    metadata:
      annotations:
        kubectl.kubernetes.io/restartedAt: "2024-03-15T09:15:00Z"
    spec:
      containers:
      - name: payment-service
        image: payment-service:v1.2.3
        resources:
          limits:
            cpu: 1001m    # <-- Normalized by Kubernetes to millicores!
            memory: 1Gi
          requests:
            cpu: 500m
            memory: 512Mi
\`\`\``,
      hint: 'Kubernetes normalizes the cpu value differently than Git...'
    },
    {
      id: 5,
      title: 'DevOps Engineer Testimony',
      type: 'testimony',
      content: `"We have a mutation webhook that adds a small amount of CPU to all containers for overhead. It adds 1 millicore to whatever is specified."

"Also, there's a CronJob that runs kubectl rollout restart on all deployments at 9 AM for some legacy reason. It adds that restartedAt annotation."

"The weird thing is, ArgoCD should handle this - we've seen annotations change before without causing sync loops."`,
      hint: 'External modifications are being made to the resources...'
    },
    {
      id: 6,
      title: 'ArgoCD Application Config',
      type: 'config',
      content: `\`\`\`yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payment-service
spec:
  source:
    repoURL: https://github.com/company/manifests.git
    path: apps/payment-service
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true  # <-- This keeps reverting changes!
    syncOptions: []   # <-- No ignoreDifferences configured

# ArgoCD sync behavior:
# 1. Compares Git state to cluster state
# 2. If different, marks as OutOfSync
# 3. With selfHeal: true, automatically syncs
# 4. Sync applies Git state, but webhook mutates it again
# 5. Back to step 1 - infinite loop!
\`\`\``,
      hint: 'selfHeal is enabled but certain differences are not being ignored...'
    }
  ],

  solution: {
    diagnosis: 'ArgoCD sync loop caused by external mutations not configured in ignoreDifferences',
    keywords: [
      'argocd', 'sync loop', 'out of sync', 'ignoredifferences', 'mutation webhook',
      'selfheal', 'normalization', 'annotations', 'gitops', 'drift'
    ],
    rootCause: `The sync loop is caused by two external modifications to resources after ArgoCD syncs:

1. **CPU resource normalization**: The Git manifest specifies cpu: "1" (string format). Kubernetes normalizes this to 1000m (millicores). Additionally, a mutation webhook adds 1 millicore for overhead, resulting in 1001m. ArgoCD compares the Git value ("1") to the cluster value (1001m), sees a difference, and marks it as OutOfSync.

2. **restartedAt annotation**: A CronJob runs kubectl rollout restart which adds the kubectl.kubernetes.io/restartedAt annotation. This annotation doesn't exist in Git, so ArgoCD sees it as a difference.

With selfHeal: true enabled, ArgoCD automatically attempts to sync whenever it detects drift. It applies the Git state (removing the annotation and setting cpu to "1"), but immediately:
- Kubernetes normalizes cpu back to 1000m
- The webhook adds 1m, making it 1001m
- The CronJob re-adds the restartedAt annotation

ArgoCD sees the difference again and syncs again, creating an infinite loop.`,
    codeExamples: [
      {
        lang: 'yaml',
        description: 'Configure ignoreDifferences to break the sync loop',
        code: `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payment-service
spec:
  source:
    repoURL: https://github.com/company/manifests.git
    path: apps/payment-service
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - RespectIgnoreDifferences=true  # Required for ignoreDifferences to work with selfHeal

  # Ignore differences that are expected to drift
  ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
    - /spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt
  - group: apps
    kind: Deployment
    jqPathExpressions:
    - .spec.template.spec.containers[].resources.limits.cpu`
      },
      {
        lang: 'yaml',
        description: 'Alternative: Use resource annotations in Git to normalize values',
        code: `# In Git manifest, use the already-normalized value
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  annotations:
    # Tell ArgoCD to compare normalized values
    argocd.argoproj.io/compare-options: IgnoreExtraneous
spec:
  template:
    spec:
      containers:
      - name: payment-service
        resources:
          limits:
            # Use millicores format to match Kubernetes normalization
            # Account for webhook adding 1m
            cpu: 1001m
            memory: 1Gi`
      },
      {
        lang: 'yaml',
        description: 'Global ignoreDifferences for common patterns',
        code: `# argocd-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  # Global ignore patterns applied to all applications
  resource.customizations.ignoreDifferences.all: |
    jsonPointers:
    - /metadata/annotations/kubectl.kubernetes.io~1restartedAt
    - /metadata/annotations/deployment.kubernetes.io~1revision
    jqPathExpressions:
    - .spec.template.spec.containers[]?.resources

  # Or be more specific per resource type
  resource.customizations.ignoreDifferences.apps_Deployment: |
    jsonPointers:
    - /spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt
    jqPathExpressions:
    - .spec.template.spec.containers[]?.resources.limits.cpu`
      },
      {
        lang: 'bash',
        description: 'Fix the root cause: Update mutation webhook',
        code: `# Option 1: Remove or fix the mutation webhook that modifies CPU
kubectl get mutatingwebhookconfigurations
kubectl delete mutatingwebhookconfigurations resource-overhead-webhook

# Option 2: Modify webhook to skip ArgoCD-managed resources
# Add a namespaceSelector or objectSelector to the webhook config
kubectl patch mutatingwebhookconfiguration resource-overhead-webhook --type='json' -p='[
  {
    "op": "add",
    "path": "/webhooks/0/namespaceSelector",
    "value": {
      "matchExpressions": [
        {
          "key": "argocd.argoproj.io/managed",
          "operator": "NotIn",
          "values": ["true"]
        }
      ]
    }
  }
]'

# Option 3: Remove the CronJob doing rollout restart
kubectl delete cronjob legacy-restart-cron -n production`
      }
    ],
    prevention: [
      'Configure ignoreDifferences for known mutation patterns before enabling auto-sync',
      'Audit mutation webhooks and understand what modifications they make',
      'Use normalized values in Git manifests (millicores instead of cores)',
      'Test auto-sync in staging before enabling in production',
      'Monitor ArgoCD sync frequency and alert on sync loops',
      'Document all external systems that modify Kubernetes resources'
    ],
    educationalInsights: [
      'ArgoCD compares Git state to cluster state - external modifications cause drift',
      'Kubernetes normalizes resource values (e.g., "1" cpu becomes "1000m")',
      'Mutation webhooks can modify resources after apply, before ArgoCD sees the result',
      'selfHeal: true combined with external mutations can create infinite sync loops',
      'ignoreDifferences is essential when external systems modify managed resources'
    ]
  }
};

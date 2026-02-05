import type { DetectiveCase } from '../../types';

export const kubernetesPvcStuckTerminating: DetectiveCase = {
  id: 'kubernetes-pvc-stuck-terminating',
  title: 'The Stuck PVC Predicament',
  subtitle: 'Persistent Volume Claims refusing to delete for hours',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `After removing a StatefulSet, the associated PersistentVolumeClaims are stuck in "Terminating" state. You need to recreate the StatefulSet with a different storage class, but the old PVCs won't delete. The storage provisioner shows the underlying volumes are still bound.`,
    impact: `Cannot redeploy the database StatefulSet. Storage quota being consumed by orphaned volumes. New deployment blocked for 4 hours. Database migration timeline at risk.`,
    timeline: [
      { time: '10:00 AM', event: 'Deleted postgres StatefulSet for storage migration', type: 'normal' },
      { time: '10:01 AM', event: 'Attempted to delete PVCs', type: 'normal' },
      { time: '10:05 AM', event: 'PVCs stuck in Terminating state', type: 'warning' },
      { time: '11:00 AM', event: 'Tried force delete - still stuck', type: 'warning' },
      { time: '2:00 PM', event: '4 hours later, PVCs still terminating', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'StatefulSet deleted successfully',
      'Pods terminated and removed',
      'New PVCs can be created (with different names)',
      'Storage provisioner responding to API calls',
      'Other PVCs in cluster delete normally'
    ],
    broken: [
      'PVCs stuck in Terminating state indefinitely',
      'kubectl delete --force --grace-period=0 has no effect',
      'PV status shows "Bound" to the terminating PVC',
      'Finalizers present on PVC resources',
      'Storage class reclaim policy is "Delete"'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'PVC Status',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pvc -n database
NAME                     STATUS        VOLUME                                     CAPACITY   ACCESS MODES
data-postgres-0          Terminating   pvc-abc12345-6789-0def-ghij-klmnopqrstuv   100Gi      RWO
data-postgres-1          Terminating   pvc-def67890-1234-5abc-defg-hijklmnopqrs   100Gi      RWO
data-postgres-2          Terminating   pvc-ghi11111-2222-3333-4444-555566667777   100Gi      RWO

$ kubectl get pv
NAME                                       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS
pvc-abc12345-6789-0def-ghij-klmnopqrstuv   100Gi      RWO            Delete           Bound
pvc-def67890-1234-5abc-defg-hijklmnopqrs   100Gi      RWO            Delete           Bound
pvc-ghi11111-2222-3333-4444-555566667777   100Gi      RWO            Delete           Bound
\`\`\``,
      hint: 'The PVs are still Bound even though PVCs are Terminating...'
    },
    {
      id: 2,
      title: 'PVC Details',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pvc data-postgres-0 -n database -o yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-postgres-0
  namespace: database
  deletionTimestamp: "2024-03-15T10:01:00Z"
  finalizers:
  - kubernetes.io/pvc-protection
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd
status:
  phase: Bound
\`\`\``,
      hint: 'Notice the finalizers field...'
    },
    {
      id: 3,
      title: 'Pod Check',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pods -n database
No resources found in database namespace.

$ kubectl get pods --all-namespaces | grep postgres
NAMESPACE     NAME                                    READY   STATUS    RESTARTS   AGE
monitoring    postgres-exporter-5d7f8b9c5-abc12       1/1     Running   0          5d

$ kubectl describe pod postgres-exporter-5d7f8b9c5-abc12 -n monitoring | grep -A10 "Volumes:"
Volumes:
  postgres-data:
    Type:       PersistentVolumeClaim (a reference to a PVC in the same namespace)
    ClaimName:  data-postgres-0
    ReadOnly:   false
\`\`\``,
      hint: 'Something is still using the PVC...'
    },
    {
      id: 4,
      title: 'Cross-Namespace Investigation',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pvc -A | grep data-postgres
database      data-postgres-0   Terminating   pvc-abc12345...   100Gi   RWO   fast-ssd
database      data-postgres-1   Terminating   pvc-def67890...   100Gi   RWO   fast-ssd
database      data-postgres-2   Terminating   pvc-ghi11111...   100Gi   RWO   fast-ssd
monitoring    data-postgres-0   Bound         pvc-xyz99999...   10Gi    RWO   standard

# Interesting - there's a PVC with same name in monitoring namespace
# But that's a different PVC (different volume ID, different size)

$ kubectl get pods -A -o json | jq -r '.items[] | select(.spec.volumes[]?.persistentVolumeClaim.claimName == "data-postgres-0") | .metadata.namespace + "/" + .metadata.name'
monitoring/postgres-exporter-5d7f8b9c5-abc12
\`\`\``,
      hint: 'A pod in a different namespace references a PVC with the same name...'
    },
    {
      id: 5,
      title: 'Exporter Deployment Configuration',
      type: 'config',
      content: `\`\`\`yaml
# postgres-exporter deployment in monitoring namespace
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres-exporter
  namespace: monitoring
spec:
  template:
    spec:
      containers:
      - name: exporter
        image: postgres-exporter:latest
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
          readOnly: true
      volumes:
      - name: postgres-data
        persistentVolumeClaim:
          # BUG: Should reference monitoring/data-postgres-0
          # But accidentally references database/data-postgres-0
          claimName: data-postgres-0
          # This works because of a cross-namespace volume mount hack
\`\`\``,
      hint: 'The exporter was misconfigured to use a different namespace PVC...'
    },
    {
      id: 6,
      title: 'Finalizer Documentation',
      type: 'config',
      content: `\`\`\`markdown
# Kubernetes PVC Protection

The kubernetes.io/pvc-protection finalizer prevents PVCs from being
deleted while they are in active use by a Pod.

## How it works:
1. When you delete a PVC, Kubernetes adds a deletionTimestamp
2. The finalizer blocks actual deletion
3. Kubernetes checks if any Pod references this PVC
4. Only when no Pods reference the PVC does the finalizer get removed
5. Then the PVC is actually deleted

## Common causes of stuck PVCs:
- Pod still running that mounts the PVC
- Pod in Terminating state with stuck finalizer
- Cross-namespace PVC reference (edge case)
- Orphaned volume attachments

## To check what's using a PVC:
kubectl get pods --all-namespaces -o json | \\
  jq -r '.items[] | select(.spec.volumes[]?.persistentVolumeClaim.claimName == "PVC_NAME")'
\`\`\``,
      hint: 'The PVC protection finalizer is working as intended...'
    }
  ],

  solution: {
    diagnosis: 'PVC stuck terminating because a pod in another namespace is still mounting it',
    keywords: [
      'pvc', 'terminating', 'stuck', 'finalizer', 'pvc-protection', 'persistent volume claim',
      'volume mount', 'cross-namespace', 'bound', 'delete'
    ],
    rootCause: `The PVCs have the kubernetes.io/pvc-protection finalizer, which prevents deletion while a Pod is actively using the PVC. This is a safety feature to prevent data loss.

In this case, the postgres-exporter pod in the monitoring namespace was accidentally configured to mount the PVC from the database namespace (data-postgres-0). While Kubernetes PVCs are namespace-scoped, certain configurations and volume plugins can create cross-namespace references.

The Kubernetes controller sees that a Pod (postgres-exporter) is still referencing the PVC, so it refuses to remove the finalizer. The StatefulSet and its pods were deleted from the database namespace, but the exporter pod in monitoring namespace still holds a reference.

Force delete (--force --grace-period=0) doesn't work because it only affects the API object's termination, not the finalizers. The finalizer must be cleared by the controller, which won't happen until the Pod reference is removed.`,
    codeExamples: [
      {
        lang: 'bash',
        description: 'Find and fix the pod holding the PVC reference',
        code: `# Step 1: Find all pods referencing the PVC
kubectl get pods --all-namespaces -o json | jq -r '
  .items[] |
  select(.spec.volumes[]?.persistentVolumeClaim.claimName == "data-postgres-0") |
  "\\(.metadata.namespace)/\\(.metadata.name)"'

# Step 2: Fix the exporter deployment to use correct PVC
kubectl patch deployment postgres-exporter -n monitoring --type=json -p='[
  {"op": "replace", "path": "/spec/template/spec/volumes/0/persistentVolumeClaim/claimName",
   "value": "exporter-data"}
]'

# Or delete the problematic pod/deployment
kubectl delete deployment postgres-exporter -n monitoring

# Step 3: Wait for PVCs to finish terminating (usually immediate)
kubectl get pvc -n database -w

# Step 4: Verify PVs are also released
kubectl get pv | grep -E "(data-postgres|Released|Available)"`
      },
      {
        lang: 'bash',
        description: 'Emergency: Manually remove finalizer (use with caution!)',
        code: `# WARNING: Only use if you're certain no pod is actually using the PVC
# and the protection is stuck due to a bug

# Check once more that nothing is using it
kubectl get pods --all-namespaces -o json | jq -r '
  .items[] |
  select(.spec.volumes[]?.persistentVolumeClaim.claimName == "data-postgres-0") |
  "WARNING: Still in use by \\(.metadata.namespace)/\\(.metadata.name)"'

# If truly nothing is using it, remove the finalizer
kubectl patch pvc data-postgres-0 -n database -p '{"metadata":{"finalizers":null}}' --type=merge

# The PVC should now delete
# Then manually delete the PV if needed
kubectl delete pv pvc-abc12345-6789-0def-ghij-klmnopqrstuv`
      },
      {
        lang: 'yaml',
        description: 'Proper cross-namespace data sharing (if actually needed)',
        code: `# If you need to share data across namespaces, use proper patterns:

# Option 1: Export data via a service (recommended)
apiVersion: v1
kind: Service
metadata:
  name: postgres-readonly
  namespace: database
spec:
  selector:
    app: postgres
  ports:
  - port: 5432

---
# Option 2: Use a shared storage class with ReadOnlyMany
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-data
  namespace: monitoring
spec:
  accessModes:
    - ReadOnlyMany
  storageClassName: shared-nfs
  resources:
    requests:
      storage: 100Gi`
      }
    ],
    prevention: [
      'Never reference PVCs across namespaces - it creates hidden dependencies',
      'Use proper data sharing patterns (services, APIs) instead of volume sharing',
      'Implement pre-delete checks in CI/CD to identify PVC dependencies',
      'Set up monitoring for PVCs stuck in Terminating state for more than N minutes',
      'Document all volume dependencies when creating cross-cutting monitoring'
    ],
    educationalInsights: [
      'The pvc-protection finalizer is a safety feature, not a bug',
      'Force delete only affects API object termination, not finalizers',
      'Cross-namespace PVC references can create non-obvious dependencies',
      'Always use kubectl get pods -A when debugging stuck PVCs',
      'Finalizers ensure data safety - think carefully before removing them manually'
    ]
  }
};

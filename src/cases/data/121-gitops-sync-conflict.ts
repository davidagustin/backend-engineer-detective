import type { DetectiveCase } from "../../types";

export const gitopsSyncConflict: DetectiveCase = {
	id: "gitops-sync-conflict",
	title: "The GitOps Sync Conflict",
	subtitle: "Manual kubectl changes reverted by ArgoCD",
	difficulty: "mid",
	category: "distributed",

	crisis: {
		description:
			"Production hotfixes applied via kubectl keep getting reverted within minutes. The team scaled up pods to handle traffic, but ArgoCD keeps scaling them back down. A critical memory limit increase was reverted mid-incident, causing OOM crashes.",
		impact:
			"Hotfixes ineffective during incidents. Mean time to recovery extended. On-call engineers frustrated by 'fighting' with automation. Three incidents extended by 30+ minutes due to reverts.",
		timeline: [
			{ time: "3:00 AM", event: "Alert: High memory usage on API pods", type: "warning" },
			{ time: "3:05 AM", event: "On-call runs: kubectl set resources --limits memory=2Gi", type: "normal" },
			{ time: "3:08 AM", event: "ArgoCD sync: Memory limit reverted to 1Gi", type: "critical" },
			{ time: "3:10 AM", event: "Pods OOMKilled due to 1Gi limit", type: "critical" },
			{ time: "3:15 AM", event: "On-call increases limit again", type: "normal" },
			{ time: "3:18 AM", event: "ArgoCD reverts again", type: "critical" },
			{ time: "3:30 AM", event: "On-call disables ArgoCD sync (risky)", type: "warning" },
		],
	},

	symptoms: {
		working: [
			"kubectl apply commands succeed",
			"Changes appear in cluster momentarily",
			"ArgoCD dashboard shows synced state",
			"Git repository is correct",
			"ArgoCD health checks pass",
		],
		broken: [
			"Manual changes reverted within 3-5 minutes",
			"kubectl scale commands don't persist",
			"Resource limit changes reverted",
			"ConfigMap hotfixes reverted",
			"On-call cannot apply emergency fixes",
		],
	},

	clues: [
		{
			id: 1,
			title: "ArgoCD Application Configuration",
			type: "config",
			content: `\`\`\`yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: api-service
  namespace: argocd
spec:
  project: production
  source:
    repoURL: https://github.com/company/k8s-manifests
    targetRevision: main
    path: apps/api-service
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true  # <-- This reverts manual changes!
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
\`\`\``,
			hint: "Look at the syncPolicy settings...",
		},
		{
			id: 2,
			title: "ArgoCD Sync History",
			type: "logs",
			content: `\`\`\`
ArgoCD Sync Events (3:00 AM - 3:30 AM):
======================================

3:00:00  Status: Synced, Health: Healthy
3:05:12  Status: OutOfSync
         Reason: Live manifest differs from Git
         Resource: Deployment/api-service
         Diff: spec.template.spec.containers[0].resources.limits.memory
               Git: 1Gi, Live: 2Gi
3:08:45  Status: Syncing
         Action: Self-heal triggered
         Message: "Reverting drift on Deployment/api-service"
3:08:52  Status: Synced
         Result: Memory limit restored to 1Gi

3:15:23  Status: OutOfSync
         Reason: Live manifest differs from Git
         Resource: Deployment/api-service
3:18:01  Status: Syncing (self-heal)
3:18:08  Status: Synced

3:30:45  Status: Synced
         Note: Auto-sync disabled by admin
\`\`\``,
			hint: "Self-heal is automatically reverting any changes that don't match Git...",
		},
		{
			id: 3,
			title: "Team Discussion (Slack)",
			type: "testimony",
			content: `"@on-call: I keep trying to scale up the pods but something keeps scaling them back down!\n\n@platform-lead: That's ArgoCD self-heal. It ensures the cluster matches Git.\n\n@on-call: But I need to fix this NOW. We're in an incident!\n\n@platform-lead: You need to commit the change to Git and let ArgoCD deploy it.\n\n@on-call: That takes 15 minutes with PR review! Pods are crashing NOW!\n\n@platform-lead: You could disable auto-sync temporarily...\n\n@on-call: How do I do that at 3 AM without breaking everything?\n\n@platform-lead: Let me check the docs..."`,
		},
		{
			id: 4,
			title: "ArgoCD Default Sync Interval",
			type: "config",
			content: `\`\`\`yaml
# argocd-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  # How often ArgoCD checks for drift
  timeout.reconciliation: 180s  # 3 minutes

  # Self-heal settings (cannot be disabled per-app easily)
  # When selfHeal: true, any drift is auto-corrected

# The 3-minute window explains why changes last ~3 minutes
# before being reverted
\`\`\``,
			hint: "ArgoCD checks every 3 minutes and reverts any drift...",
		},
		{
			id: 5,
			title: "Git Repository State",
			type: "code",
			content: `\`\`\`yaml
# apps/api-service/deployment.yaml (in Git)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: api-service:v2.5.0
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"    # This is what ArgoCD enforces
            cpu: "500m"

# The production values are in Git
# Any change in the cluster that differs = drift = reverted
\`\`\``,
		},
		{
			id: 6,
			title: "Attempted Solutions",
			type: "logs",
			content: `\`\`\`
Previous attempts to handle this:

1. "Just commit to Git faster"
   Problem: PRs require review, CI takes 10 min
   Result: Not fast enough for incidents

2. "Disable ArgoCD during incidents"
   Problem: Risk of forgetting to re-enable
   Result: Once left disabled for 2 days

3. "Give on-call ArgoCD admin access"
   Problem: UI is confusing at 3 AM
   Result: Accidentally synced wrong app

4. "Add exception annotations"
   Problem: Didn't know the right annotations
   Result: Still got reverted

Current state: No good emergency procedure exists
\`\`\``,
		},
	],

	solution: {
		diagnosis: "ArgoCD selfHeal policy automatically reverts any manual kubectl changes",
		keywords: [
			"ArgoCD",
			"GitOps",
			"selfHeal",
			"sync",
			"drift",
			"kubectl",
			"automated sync",
			"reconciliation",
			"emergency change",
		],
		rootCause: `ArgoCD's selfHeal feature is designed to ensure the cluster always matches Git - this is core to GitOps philosophy. When enabled, any change detected in the cluster that doesn't match Git is automatically reverted.

The problem: This conflicts with emergency incident response where you need to:
1. Apply a hotfix immediately (via kubectl)
2. Validate it works
3. Then codify it in Git

The 3-minute reconciliation loop means:
1. On-call applies kubectl change at 3:05
2. ArgoCD detects drift at 3:08 (next reconciliation)
3. selfHeal reverts the change
4. On-call re-applies at 3:15
5. Cycle repeats

The team lacks:
- A documented emergency override procedure
- ArgoCD annotations to exclude resources from sync
- A fast-path for emergency Git changes
- Proper incident response integration with GitOps`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Add annotation to exclude specific fields from sync",
				code: `# In your deployment, mark fields ArgoCD should ignore during sync
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
  annotations:
    # Tell ArgoCD to ignore these paths during diff/sync
    argocd.argoproj.io/sync-options: |
      IgnoreDifferences=true
spec:
  replicas: 3  # This will be ignored in diff
  template:
    spec:
      containers:
      - name: api
        resources:  # These could drift without triggering sync

---
# Or configure in Application spec
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: api-service
spec:
  ignoreDifferences:
  - group: apps
    kind: Deployment
    name: api-service
    jsonPointers:
    - /spec/replicas
    - /spec/template/spec/containers/0/resources/limits`,
			},
			{
				lang: "bash",
				description: "Emergency procedure: Pause ArgoCD sync temporarily",
				code: `#!/bin/bash
# emergency-pause-sync.sh
# Run this during incidents to pause ArgoCD auto-sync

APP_NAME="api-service"

echo "Pausing ArgoCD auto-sync for $APP_NAME..."

# Method 1: Patch the Application to disable auto-sync
kubectl patch application $APP_NAME -n argocd --type merge -p '{
  "spec": {
    "syncPolicy": {
      "automated": null
    }
  }
}'

echo "Auto-sync disabled. Manual changes will now persist."
echo ""
echo "IMPORTANT: After incident, re-enable with:"
echo "  ./emergency-resume-sync.sh $APP_NAME"
echo ""
echo "Or commit your changes to Git and sync:"
echo "  argocd app sync $APP_NAME"`,
			},
			{
				lang: "yaml",
				description: "Create emergency override ConfigMap pattern",
				code: `# emergency-overrides.yaml
# This file is in Git but designed for emergency values
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-service-emergency-overrides
  namespace: production
data:
  # Normal values
  memory_limit: "1Gi"
  replica_count: "3"

  # During incidents, update this via PR (fast-track review)
  # Or use Kustomize overlays

---
# deployment.yaml references the ConfigMap
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  # Use HPA instead of fixed replicas for automatic scaling
  # replicas: 3  # Removed - managed by HPA
  template:
    spec:
      containers:
      - name: api
        resources:
          limits:
            # Reference ConfigMap for easy emergency changes
            memory: "$(MEMORY_LIMIT)"
        env:
        - name: MEMORY_LIMIT
          valueFrom:
            configMapKeyRef:
              name: api-service-emergency-overrides
              key: memory_limit`,
			},
			{
				lang: "yaml",
				description: "Better pattern: Use HPA and VPA for automatic resource management",
				code: `# hpa.yaml - Let Kubernetes manage scaling, not manual kubectl
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-service-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80

---
# vpa.yaml - Automatic resource recommendations
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-service-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-service
  updatePolicy:
    updateMode: "Off"  # Start with recommendations only
  resourcePolicy:
    containerPolicies:
    - containerName: api
      minAllowed:
        cpu: "100m"
        memory: "256Mi"
      maxAllowed:
        cpu: "2"
        memory: "4Gi"`,
			},
			{
				lang: "yaml",
				description: "ArgoCD Application with proper emergency settings",
				code: `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: api-service
  namespace: argocd
  annotations:
    # Document the emergency procedure
    emergency.company.io/pause-command: |
      kubectl patch application api-service -n argocd --type merge -p '{"spec":{"syncPolicy":{"automated":null}}}'
spec:
  project: production
  source:
    repoURL: https://github.com/company/k8s-manifests
    targetRevision: main
    path: apps/api-service
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - RespectIgnoreDifferences=true  # Honor ignoreDifferences
  # Ignore these paths - they can be changed manually
  ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
    - /spec/replicas  # Let HPA manage this
  - group: ""
    kind: ConfigMap
    name: "*-emergency-overrides"
    jsonPointers:
    - /data  # Emergency overrides can be changed`,
			},
		],
		prevention: [
			"Document emergency override procedures in runbooks",
			"Use ignoreDifferences for fields that need manual override capability",
			"Implement HPA/VPA for automatic scaling instead of manual kubectl scale",
			"Create fast-track PR process for emergency changes (auto-approve for on-call)",
			"Add ArgoCD pause/resume commands to incident response scripts",
			"Train on-call engineers on GitOps emergency procedures",
			"Set up Slack bot commands for common ArgoCD operations",
			"Use separate overlays for emergency values that can be quickly PRed",
		],
		educationalInsights: [
			"GitOps 'selfHeal' is a feature, not a bug - it ensures consistency",
			"Emergency procedures must be designed around GitOps, not against it",
			"ignoreDifferences lets you opt specific fields out of sync",
			"HPA and VPA reduce need for manual scaling interventions",
			"The goal is making Git changes fast, not bypassing Git",
			"ArgoCD sync can be paused for applications without disabling ArgoCD",
			"Incident response and GitOps can coexist with proper planning",
		],
	},
};

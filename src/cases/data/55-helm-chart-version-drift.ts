import type { DetectiveCase } from '../../types';

export const helmChartVersionDrift: DetectiveCase = {
  id: 'helm-chart-version-drift',
  title: 'The Helm Chart Drift Disaster',
  subtitle: 'Production and staging configs mysteriously diverged',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `A feature tested thoroughly in staging is broken in production. The application code is identical, but the behavior is different. The production deployment uses different resource limits, environment variables, and even has a missing sidecar container. Nobody remembers making these changes.`,
    impact: `Production feature is broken despite passing all staging tests. Customer-facing bug affecting 20% of users. Team confused about why staging and production differ.`,
    timeline: [
      { time: 'Monday 9:00 AM', event: 'Feature deployed to staging, tested successfully', type: 'normal' },
      { time: 'Monday 2:00 PM', event: 'Feature deployed to production via Helm', type: 'normal' },
      { time: 'Monday 2:30 PM', event: 'Users report feature not working', type: 'warning' },
      { time: 'Monday 3:00 PM', event: 'Verified code is identical in both environments', type: 'warning' },
      { time: 'Monday 4:00 PM', event: 'Discovered configuration differences', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Application code is identical (same Git SHA)',
      'Docker image is the same in both environments',
      'Database schemas match',
      'Network connectivity working',
      'Helm install/upgrade commands succeed'
    ],
    broken: [
      'Feature works in staging but fails in production',
      'Production pods have different resource limits',
      'Production missing FEATURE_FLAG_SERVICE_URL env var',
      'Production missing feature-flag-sidecar container',
      'kubectl diff shows many configuration differences'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Deployment Comparison',
      type: 'logs',
      content: `\`\`\`
$ kubectl get deployment api-gateway -n staging -o yaml | grep -A5 resources:
        resources:
          limits:
            cpu: "2"
            memory: 2Gi
          requests:
            cpu: 500m

$ kubectl get deployment api-gateway -n production -o yaml | grep -A5 resources:
        resources:
          limits:
            cpu: 500m
            memory: 512Mi
          requests:
            cpu: 100m

$ kubectl get deployment api-gateway -n staging -o yaml | grep FEATURE_FLAG
        - name: FEATURE_FLAG_SERVICE_URL
          value: "http://feature-flags:8080"

$ kubectl get deployment api-gateway -n production -o yaml | grep FEATURE_FLAG
# (no output)
\`\`\``,
      hint: 'The configurations are completely different...'
    },
    {
      id: 2,
      title: 'Helm Release History',
      type: 'logs',
      content: `\`\`\`
$ helm history api-gateway -n staging
REVISION    UPDATED                     STATUS      CHART               DESCRIPTION
1           Mon Mar 10 09:00:00 2024    superseded  api-gateway-2.3.0   Install
2           Mon Mar 10 14:00:00 2024    deployed    api-gateway-2.4.0   Upgrade

$ helm history api-gateway -n production
REVISION    UPDATED                     STATUS      CHART               DESCRIPTION
1           Fri Jan 15 10:00:00 2024    superseded  api-gateway-1.8.0   Install
2           Wed Feb 20 15:00:00 2024    superseded  api-gateway-2.0.0   Upgrade
3           Mon Mar 10 14:30:00 2024    deployed    api-gateway-2.4.0   Upgrade
\`\`\``,
      hint: 'Look at the chart versions across environments...'
    },
    {
      id: 3,
      title: 'Values Files',
      type: 'config',
      content: `\`\`\`yaml
# values-staging.yaml (last updated: 2 weeks ago)
replicaCount: 2
resources:
  limits:
    cpu: "2"
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 512Mi

featureFlags:
  enabled: true
  serviceUrl: "http://feature-flags:8080"

# values-production.yaml (last updated: 3 months ago)
replicaCount: 5
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi

# Note: featureFlags section missing entirely
\`\`\``,
      hint: 'The values files have diverged significantly...'
    },
    {
      id: 4,
      title: 'Chart Changelog',
      type: 'config',
      content: `\`\`\`markdown
# api-gateway Chart CHANGELOG

## 2.4.0
- Updated app version to v5.2.0

## 2.3.0
- Added feature flag sidecar support
- New values: featureFlags.enabled, featureFlags.serviceUrl
- Increased default resource limits

## 2.2.0
- Added prometheus metrics endpoint

## 2.1.0
- Added horizontal pod autoscaler support

## 2.0.0 (BREAKING)
- Changed resource structure from flat to nested
- Old: cpuLimit, memoryLimit
- New: resources.limits.cpu, resources.limits.memory

## 1.8.0
- Initial public release
\`\`\``,
      hint: 'Major changes happened between versions...'
    },
    {
      id: 5,
      title: 'DevOps Engineer Testimony',
      type: 'testimony',
      content: `"We update staging frequently to test new features, but production values file only gets updated when we specifically need to change something. The chart templates themselves have changed a lot - new features, new defaults, even some breaking changes in 2.0."

"I think what happened is: staging got all the template updates naturally as we upgraded. Production kept using the old values file structure, and some new template features just... silently got default values or were skipped."`,
      hint: 'Values files need to evolve with chart versions...'
    },
    {
      id: 6,
      title: 'Helm Template Diff',
      type: 'code',
      content: `\`\`\`bash
$ helm template api-gateway ./chart -f values-staging.yaml > staging.yaml
$ helm template api-gateway ./chart -f values-production.yaml > production.yaml
$ diff staging.yaml production.yaml | head -50

< cpu: "2"
---
> cpu: 500m

<       - name: feature-flag-sidecar
<         image: feature-flags/sidecar:latest
<         env:
<         - name: SERVICE_URL
<           value: "http://feature-flags:8080"
---
> # (sidecar container missing)

# 47 more differences...
\`\`\``,
      hint: 'helm template shows what would be deployed...'
    }
  ],

  solution: {
    diagnosis: 'Helm values files drifted between environments as chart evolved',
    keywords: [
      'helm', 'values', 'drift', 'chart version', 'configuration', 'staging', 'production',
      'values file', 'gitops', 'infrastructure as code', 'environment parity'
    ],
    rootCause: `The Helm chart evolved significantly over time (from 1.8.0 to 2.4.0), adding new features like feature flag sidecars, changing resource configuration structure, and updating defaults.

Staging was upgraded frequently, and its values file was kept up to date with new configuration options. Production's values file was rarely updated and was missing:
1. The featureFlags configuration block (added in 2.3.0)
2. The new resource structure (changed in 2.0.0)
3. Updated default values

When the chart templates render, they use default values for missing configuration. Production was missing the featureFlags section entirely, so the sidecar wasn't deployed and the feature was broken.

This is a classic "works in staging" problem caused by configuration drift, not code differences.`,
    codeExamples: [
      {
        lang: 'yaml',
        description: 'Proper values file management with environment inheritance',
        code: `# values-base.yaml (shared configuration)
replicaCount: 2
image:
  repository: myapp/api-gateway
  pullPolicy: IfNotPresent

featureFlags:
  enabled: true
  serviceUrl: "http://feature-flags:8080"

resources:
  limits:
    cpu: "1"
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 256Mi

---
# values-production.yaml (production overrides only)
replicaCount: 5
resources:
  limits:
    cpu: "2"
    memory: 2Gi

# Install with: helm upgrade --install api-gateway ./chart \\
#   -f values-base.yaml -f values-production.yaml`
      },
      {
        lang: 'bash',
        description: 'CI/CD pipeline with drift detection',
        code: `#!/bin/bash
# detect-drift.sh - Run in CI before deployments

CHART_VERSION=$(helm show chart ./chart | grep version | awk '{print $2}')
echo "Chart version: $CHART_VERSION"

# Generate manifests for both environments
helm template api-gateway ./chart -f values-staging.yaml > /tmp/staging.yaml
helm template api-gateway ./chart -f values-production.yaml > /tmp/production.yaml

# Check for unexpected differences
DIFF_COUNT=$(diff /tmp/staging.yaml /tmp/production.yaml | grep -c "^[<>]")

# Allow expected differences (replicas, resource limits)
EXPECTED_DIFFS=10
if [ "$DIFF_COUNT" -gt "$EXPECTED_DIFFS" ]; then
  echo "WARNING: $DIFF_COUNT differences found (expected max $EXPECTED_DIFFS)"
  echo "Review with: diff /tmp/staging.yaml /tmp/production.yaml"
  exit 1
fi

echo "Drift check passed: $DIFF_COUNT differences (within tolerance)"`
      },
      {
        lang: 'yaml',
        description: 'ArgoCD ApplicationSet for environment parity',
        code: `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: api-gateway
spec:
  generators:
  - list:
      elements:
      - env: staging
        namespace: staging
        values: values-staging.yaml
      - env: production
        namespace: production
        values: values-production.yaml
  template:
    metadata:
      name: 'api-gateway-{{env}}'
    spec:
      source:
        repoURL: https://github.com/org/helm-charts
        targetRevision: main
        path: charts/api-gateway
        helm:
          valueFiles:
          - values-base.yaml  # Always include base
          - '{{values}}'       # Environment-specific overrides
      syncPolicy:
        automated:
          prune: true
          selfHeal: true`
      }
    ],
    prevention: [
      'Use a base values file with environment-specific overrides',
      'Store all values files in version control alongside application code',
      'Implement drift detection in CI/CD pipelines',
      'Use GitOps tools (ArgoCD, Flux) to ensure declared state matches cluster state',
      'Review chart changelogs when upgrading and update values files accordingly',
      'Run helm diff before deployments to preview changes'
    ],
    educationalInsights: [
      'Helm values files need maintenance as charts evolve - they are not "set and forget"',
      'Missing values use chart defaults, which change between versions',
      'Environment parity problems are often configuration issues, not code issues',
      'GitOps practices help prevent drift by making configuration changes explicit',
      'The helm diff plugin is invaluable for catching configuration drift before deployment'
    ]
  }
};

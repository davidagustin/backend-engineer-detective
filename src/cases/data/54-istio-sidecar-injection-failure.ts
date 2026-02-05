import type { DetectiveCase } from '../../types';

export const istioSidecarInjectionFailure: DetectiveCase = {
  id: 'istio-sidecar-injection-failure',
  title: 'The Sidecar Injection Sabotage',
  subtitle: 'Pods stuck in Init:0/1 after enabling Istio on a namespace',
  difficulty: 'mid',
  category: 'networking',

  crisis: {
    description: `Your team is rolling out Istio service mesh to improve observability and security. After enabling automatic sidecar injection on the "orders" namespace, all new pods are stuck in Init:0/1 state. Existing pods work fine, but any deployment update or new pod creation fails to start.`,
    impact: `Cannot deploy updates to the orders service. Rollback attempted but new pods still fail. Orders service running on stale code with a known bug. Revenue impact: unable to deploy critical hotfix.`,
    timeline: [
      { time: '2:00 PM', event: 'Labeled namespace with istio-injection=enabled', type: 'normal' },
      { time: '2:05 PM', event: 'Triggered rolling deployment of orders-service', type: 'normal' },
      { time: '2:06 PM', event: 'New pods stuck in Init:0/1', type: 'warning' },
      { time: '2:15 PM', event: 'Attempted rollback - new pods still stuck', type: 'critical' },
      { time: '2:30 PM', event: 'All deployment attempts failing', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Existing pods (created before Istio label) running fine',
      'Istio control plane healthy',
      'Other namespaces with Istio working correctly',
      'Pods in namespaces without Istio label start normally',
      'kubectl exec into init container works'
    ],
    broken: [
      'New pods stuck in Init:0/1 state indefinitely',
      'Init container istio-init never completes',
      'Pod events show no errors, just waiting',
      'Deployment rollout stuck at 0 available',
      'Same issue on any pod in the namespace'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Pod Status',
      type: 'logs',
      content: `\`\`\`
$ kubectl get pods -n orders
NAME                             READY   STATUS     RESTARTS   AGE
orders-service-5d7f8b9c5-old1    2/2     Running    0          2d
orders-service-5d7f8b9c5-old2    2/2     Running    0          2d
orders-service-7c8d9e0f1-new1    0/2     Init:0/1   0          25m
orders-service-7c8d9e0f1-new2    0/2     Init:0/1   0          25m

$ kubectl describe pod orders-service-7c8d9e0f1-new1 -n orders
Init Containers:
  istio-init:
    State:          Running
      Started:      Wed, 15 Mar 2024 14:06:00 +0000
    Ready:          False

Events:
  Type    Reason     Age   Message
  ----    ------     ----  -------
  Normal  Scheduled  25m   Successfully assigned orders/orders-service-7c8d9e0f1-new1
  Normal  Pulled     25m   Container image "istio/proxyv2:1.19.0" already present
  Normal  Created    25m   Created container istio-init
  Normal  Started    25m   Started container istio-init
\`\`\``,
      hint: 'The init container started but never completed...'
    },
    {
      id: 2,
      title: 'Init Container Logs',
      type: 'logs',
      content: `\`\`\`
$ kubectl logs orders-service-7c8d9e0f1-new1 -n orders -c istio-init
iptables-restore v1.8.7 (nf_tables): Could not fetch rule set generation id: Permission denied

$ kubectl exec -it orders-service-7c8d9e0f1-new1 -n orders -c istio-init -- cat /proc/1/status | grep Cap
CapInh: 0000000000000000
CapPrm: 00000000a80425fb
CapEff: 00000000a80425fb
CapBnd: 00000000a80425fb
CapAmb: 0000000000000000
\`\`\``,
      hint: 'The init container needs specific capabilities to configure iptables...'
    },
    {
      id: 3,
      title: 'Namespace Security Policy',
      type: 'config',
      content: `\`\`\`yaml
# The orders namespace has a PodSecurityPolicy (PSP) / Pod Security Admission
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: orders-restricted
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
    - ALL
  volumes:
    - 'configMap'
    - 'emptyDir'
    - 'secret'
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: MustRunAsNonRoot
  seLinux:
    rule: RunAsAny
  fsGroup:
    rule: RunAsAny
  supplementalGroups:
    rule: RunAsAny
\`\`\``,
      hint: 'Look at the requiredDropCapabilities setting...'
    },
    {
      id: 4,
      title: 'Istio Installation Config',
      type: 'config',
      content: `\`\`\`yaml
# istio-operator.yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: default
  values:
    global:
      proxy:
        privileged: false
    sidecarInjectorWebhook:
      injectedAnnotations: {}
  components:
    pilot:
      enabled: true
    ingressGateways:
    - name: istio-ingressgateway
      enabled: true

# Note: CNI plugin not configured
\`\`\``,
      hint: 'There is an alternative way Istio can set up traffic interception...'
    },
    {
      id: 5,
      title: 'Platform Engineer Testimony',
      type: 'testimony',
      content: `"We have strict security policies on the orders namespace because it handles payment data. All our pods run as non-root with dropped capabilities. Other namespaces are more permissive - that's why Istio works there but not here."

"The istio-init container needs NET_ADMIN and NET_RAW capabilities to set up iptables rules that intercept traffic. Our PSP drops ALL capabilities, so the init container can't do its job."`,
      hint: 'Security policy conflicts with Istio requirements...'
    },
    {
      id: 6,
      title: 'Istio CNI Documentation',
      type: 'config',
      content: `\`\`\`markdown
# Istio CNI Plugin

The Istio CNI plugin performs the same function as istio-init but without
requiring elevated privileges in the application pod.

## How it works:
- Runs as a DaemonSet on each node with required privileges
- Sets up iptables rules BEFORE the pod starts
- Application pods don't need NET_ADMIN/NET_RAW capabilities
- Compatible with restrictive PodSecurityPolicies

## Installation:
\`\`\`
istioctl install --set components.cni.enabled=true
\`\`\`

## Required changes:
- Enable CNI in Istio configuration
- Ensure CNI plugin has appropriate node-level permissions
- No changes needed to application pods
\`\`\``,
      hint: 'There is a way to avoid the privilege requirements...'
    }
  ],

  solution: {
    diagnosis: 'Istio sidecar init container blocked by restrictive PodSecurityPolicy',
    keywords: [
      'istio', 'sidecar', 'init container', 'istio-init', 'podsecuritypolicy', 'psp',
      'net_admin', 'net_raw', 'capabilities', 'iptables', 'cni', 'injection',
      'privilege', 'init:0/1'
    ],
    rootCause: `The orders namespace has a restrictive PodSecurityPolicy that drops ALL Linux capabilities. The istio-init container requires NET_ADMIN and NET_RAW capabilities to set up iptables rules that intercept traffic to/from the application container.

When the istio-init container runs, it attempts to execute iptables-restore to configure traffic interception, but without the required capabilities, the operation fails with "Permission denied". The init container keeps running (waiting) but never completes, causing the pod to remain in Init:0/1 state indefinitely.

Other namespaces work because they have more permissive security policies that allow the required capabilities. The existing pods in the orders namespace work because they were created before the istio-injection label was added.`,
    codeExamples: [
      {
        lang: 'yaml',
        description: 'Option 1: Enable Istio CNI plugin (recommended for secure environments)',
        code: `# Update Istio installation to use CNI
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: default
  components:
    cni:
      enabled: true
  values:
    cni:
      excludeNamespaces:
        - kube-system
        - istio-system
    global:
      proxy:
        privileged: false

# Apply with:
# istioctl install -f istio-operator.yaml`
      },
      {
        lang: 'yaml',
        description: 'Option 2: Create a less restrictive PSP for Istio init (if CNI not available)',
        code: `apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: orders-istio-enabled
spec:
  privileged: false
  allowPrivilegeEscalation: false
  allowedCapabilities:
    - NET_ADMIN
    - NET_RAW
  requiredDropCapabilities:
    - AUDIT_WRITE
    - MKNOD
    - SETFCAP
  volumes:
    - 'configMap'
    - 'emptyDir'
    - 'secret'
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: RunAsAny  # istio-init needs to run as root
  seLinux:
    rule: RunAsAny
  fsGroup:
    rule: RunAsAny`
      },
      {
        lang: 'yaml',
        description: 'Option 3: Use Pod Security Admission (Kubernetes 1.25+)',
        code: `# Label namespace with appropriate pod security level
apiVersion: v1
kind: Namespace
metadata:
  name: orders
  labels:
    istio-injection: enabled
    # Allow privileged init containers while restricting main containers
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest`
      }
    ],
    prevention: [
      'Use Istio CNI plugin in environments with strict security policies',
      'Test Istio injection in staging with production-equivalent security settings',
      'Document security policy requirements for service mesh adoption',
      'Consider namespace-specific security policies that accommodate Istio',
      'Use Pod Security Admission (newer) instead of PSP (deprecated) where possible'
    ],
    educationalInsights: [
      'Istio init containers modify network namespace iptables, requiring elevated privileges',
      'The CNI plugin approach moves privileged operations to node-level, keeping pods unprivileged',
      'Init container failures cause pods to hang in Init:X/Y state without obvious errors',
      'Security policies are enforced at pod creation time - existing pods are unaffected by changes',
      'Service mesh adoption requires coordination between security and platform teams'
    ]
  }
};

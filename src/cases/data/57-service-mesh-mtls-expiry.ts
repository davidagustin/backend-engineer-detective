import type { DetectiveCase } from '../../types';

export const serviceMeshMtlsExpiry: DetectiveCase = {
  id: 'service-mesh-mtls-expiry',
  title: 'The mTLS Midnight Meltdown',
  subtitle: 'Inter-service communication fails with certificate errors',
  difficulty: 'senior',
  category: 'auth',

  crisis: {
    description: `At exactly midnight, all inter-service communication in your Kubernetes cluster started failing. Services can no longer talk to each other, with TLS handshake failures everywhere. External traffic through the ingress still works, but service-to-service calls within the mesh are completely broken.`,
    impact: `Complete service mesh failure. All microservices unable to communicate. API gateway can receive requests but cannot forward to backends. 100% of internal requests failing. Full production outage.`,
    timeline: [
      { time: '11:59 PM', event: 'All services operating normally', type: 'normal' },
      { time: '12:00 AM', event: 'Sudden spike in 503 errors across all services', type: 'critical' },
      { time: '12:01 AM', event: 'Service mesh dashboards show 0% success rate', type: 'critical' },
      { time: '12:05 AM', event: 'Engineers identify TLS handshake failures', type: 'warning' },
      { time: '12:30 AM', event: 'Issue isolated to service mesh mTLS', type: 'warning' },
    ]
  },

  symptoms: {
    working: [
      'External HTTPS traffic through ingress works',
      'Services respond to direct pod IP calls (bypassing mesh)',
      'Kubernetes control plane healthy',
      'DNS resolution working correctly',
      'Pods running and passing health checks'
    ],
    broken: [
      'All service-to-service calls failing',
      'TLS handshake errors in sidecar proxy logs',
      'Certificate validation failures',
      'Service mesh control plane shows unhealthy data plane',
      'Mutual TLS authentication failing'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Sidecar Proxy Logs',
      type: 'logs',
      content: `\`\`\`
$ kubectl logs order-service-7d4f8b9c5-abc12 -c istio-proxy
[2024-03-15T00:00:01.234Z] "POST /api/inventory HTTP/1.1" 503 UF "-"
  "TLS error: 268435581:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED"

[2024-03-15T00:00:01.456Z] "GET /api/users/123 HTTP/1.1" 503 UF "-"
  "upstream connect error or disconnect/reset before headers. reset reason: connection failure,
   transport failure reason: TLS error: 268435581:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED"

$ kubectl logs istio-proxy -n istio-system
warning  envoy config   StreamSecrets gRPC config stream closed: 14, upstream connect error
error    ca             failed to renew workload certificate: rpc error: code = Unavailable
\`\`\``,
      hint: 'The certificates are failing validation...'
    },
    {
      id: 2,
      title: 'Certificate Inspection',
      type: 'logs',
      content: `\`\`\`
$ kubectl exec order-service-7d4f8b9c5-abc12 -c istio-proxy -- \\
    openssl x509 -in /etc/certs/cert-chain.pem -text -noout | grep -A2 "Validity"
        Validity
            Not Before: Mar 15 00:00:00 2023 GMT
            Not After : Mar 15 00:00:00 2024 GMT

$ date -u
Fri Mar 15 00:45:00 UTC 2024

$ kubectl exec order-service-7d4f8b9c5-abc12 -c istio-proxy -- \\
    openssl verify -CAfile /etc/certs/root-cert.pem /etc/certs/cert-chain.pem
/etc/certs/cert-chain.pem: C = US, O = Istio, CN = istiod.istio-system.svc
error 10 at 1 depth lookup: certificate has expired
\`\`\``,
      hint: 'Check the certificate expiration date carefully...'
    },
    {
      id: 3,
      title: 'Istio Root CA Status',
      type: 'config',
      content: `\`\`\`
$ kubectl get secret istio-ca-secret -n istio-system -o yaml
apiVersion: v1
kind: Secret
metadata:
  name: istio-ca-secret
  namespace: istio-system
  creationTimestamp: "2023-03-15T00:00:00Z"
data:
  ca-cert.pem: LS0tLS1CRU...  # Base64 encoded certificate
  ca-key.pem: LS0tLS1CRU...   # Base64 encoded private key

$ kubectl get secret istio-ca-secret -n istio-system -o jsonpath='{.data.ca-cert\\.pem}' | \\
    base64 -d | openssl x509 -text -noout | grep -A2 "Validity"
        Validity
            Not Before: Mar 15 00:00:00 2023 GMT
            Not After : Mar 15 00:00:00 2024 GMT
\`\`\``,
      hint: 'The root CA certificate itself has expired...'
    },
    {
      id: 4,
      title: 'Istio Installation History',
      type: 'testimony',
      content: `"We installed Istio exactly one year ago on March 15, 2023. We used the default self-signed CA configuration because we were just getting started and planned to switch to a proper CA 'later'. The default self-signed CA has a 1-year validity."

"We completely forgot about certificate rotation. There's no monitoring on certificate expiration dates. Istiod is supposed to auto-rotate workload certificates, but it can't do that if the root CA itself has expired."`,
      hint: 'The default certificate has a known expiration period...'
    },
    {
      id: 5,
      title: 'Istio Configuration',
      type: 'config',
      content: `\`\`\`yaml
# Original installation (1 year ago)
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: default
  # No CA configuration specified - uses self-signed CA
  # Self-signed CA default validity: 1 year

  meshConfig:
    enableAutoMtls: true

  values:
    pilot:
      env:
        # Workload cert TTL - but root CA must be valid!
        PILOT_CERT_DURATION: 24h
        PILOT_ROOT_CERT_EXPIRATION_THRESHOLD: 168h  # 7 days warning
\`\`\``,
      hint: 'Self-signed CA has a default 1-year validity...'
    },
    {
      id: 6,
      title: 'Istiod Logs',
      type: 'logs',
      content: `\`\`\`
$ kubectl logs -n istio-system deploy/istiod | grep -i cert
2024-03-08T00:00:00.000Z  warn  CA root certificate will expire in 7 days
2024-03-09T00:00:00.000Z  warn  CA root certificate will expire in 6 days
...
2024-03-14T00:00:00.000Z  warn  CA root certificate will expire in 1 day
2024-03-15T00:00:01.000Z  error CA root certificate has expired
2024-03-15T00:00:01.000Z  error cannot sign workload certificates: root CA expired
2024-03-15T00:00:02.000Z  error failed to rotate certificate for order-service: CA expired
\`\`\``,
      hint: 'Warnings were logged for 7 days before expiration...'
    }
  ],

  solution: {
    diagnosis: 'Service mesh root CA certificate expired after default 1-year validity period',
    keywords: [
      'mtls', 'certificate', 'expired', 'root ca', 'istio', 'service mesh', 'tls',
      'certificate rotation', 'self-signed', 'pki', 'x509', 'handshake failure'
    ],
    rootCause: `Istio was installed one year ago with the default self-signed CA configuration. The default self-signed root CA has a 1-year validity period. When the clock struck midnight on the anniversary of installation, the root CA certificate expired.

With an expired root CA, Istiod cannot sign new workload certificates. Existing workload certificates (which have a 24-hour TTL) cannot be renewed. The sidecar proxies cannot complete mTLS handshakes because certificate validation fails - both sides reject each other's certificates as they chain to an expired root.

The warnings were logged for 7 days (PILOT_ROOT_CERT_EXPIRATION_THRESHOLD: 168h), but without monitoring on these logs, the warnings went unnoticed until complete failure occurred.`,
    codeExamples: [
      {
        lang: 'bash',
        description: 'Emergency fix: Rotate the root CA certificate',
        code: `# Step 1: Generate a new root CA (or use your org's CA)
# Using istioctl to create a new self-signed CA with longer validity
istioctl experimental ca-rotation --help

# Step 2: Create new CA certificates
mkdir new-certs && cd new-certs
openssl req -x509 -sha256 -nodes -days 3650 -newkey rsa:4096 \\
  -subj "/O=Istio/CN=Root CA" \\
  -keyout root-key.pem -out root-cert.pem

# Step 3: Update the istio-ca-secret (carefully!)
kubectl create secret generic istio-ca-secret -n istio-system \\
  --from-file=ca-cert.pem=root-cert.pem \\
  --from-file=ca-key.pem=root-key.pem \\
  --dry-run=client -o yaml | kubectl apply -f -

# Step 4: Restart istiod to pick up new CA
kubectl rollout restart deployment/istiod -n istio-system

# Step 5: Restart all workloads to get new certificates
kubectl rollout restart deployment --all -n default
# Repeat for all namespaces with Istio sidecars`
      },
      {
        lang: 'yaml',
        description: 'Proper CA configuration with external certificates',
        code: `# Use certificates from your organization's PKI
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: default
  values:
    global:
      pilotCertProvider: istiod
    pilot:
      env:
        PILOT_CERT_DURATION: 24h
        PILOT_ROOT_CERT_EXPIRATION_THRESHOLD: 720h  # 30 days warning

---
# Create secret from your PKI certificates
apiVersion: v1
kind: Secret
metadata:
  name: cacerts
  namespace: istio-system
type: Opaque
data:
  ca-cert.pem: <base64-encoded-intermediate-cert>
  ca-key.pem: <base64-encoded-intermediate-key>
  root-cert.pem: <base64-encoded-root-cert>
  cert-chain.pem: <base64-encoded-cert-chain>`
      },
      {
        lang: 'yaml',
        description: 'Certificate expiration monitoring with Prometheus',
        code: `# PrometheusRule for certificate expiration alerts
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: istio-certificate-alerts
spec:
  groups:
  - name: istio-certificates
    rules:
    - alert: IstioCACertExpiringSoon
      expr: |
        (istio_ca_root_cert_expiry_timestamp - time()) / 86400 < 30
      for: 1h
      labels:
        severity: warning
      annotations:
        summary: "Istio root CA certificate expiring in {{ $value | humanizeDuration }}"

    - alert: IstioCACertExpiryCritical
      expr: |
        (istio_ca_root_cert_expiry_timestamp - time()) / 86400 < 7
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "CRITICAL: Istio root CA expires in {{ $value | humanizeDuration }}"`
      }
    ],
    prevention: [
      'Never use self-signed CA in production - use your organization PKI',
      'Set up monitoring and alerting on certificate expiration dates',
      'Configure PILOT_ROOT_CERT_EXPIRATION_THRESHOLD for early warnings (default 168h)',
      'Implement automated certificate rotation procedures',
      'Document certificate lifecycle and schedule rotation before expiry',
      'Use cert-manager or similar tools for automated PKI management'
    ],
    educationalInsights: [
      'mTLS requires valid certificates on both client and server sides',
      'Root CA expiration is catastrophic - it invalidates the entire certificate chain',
      'Self-signed CAs are fine for development but need careful lifecycle management in production',
      'Service mesh failure modes are often all-or-nothing due to shared trust anchors',
      'Certificate warnings in logs are critical alerts that need monitoring'
    ]
  }
};

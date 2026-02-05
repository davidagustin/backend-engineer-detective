import type { DetectiveCase } from "../../types";

export const mtlsClientCertificateRotation: DetectiveCase = {
	id: "mtls-client-certificate-rotation",
	title: "The mTLS Client Certificate Rotation",
	subtitle: "Services failing during certificate rollover",
	difficulty: "senior",
	category: "auth",

	crisis: {
		description:
			"Your microservices use mutual TLS (mTLS) for service-to-service authentication. During a planned certificate rotation, services start randomly failing to communicate. Some connections work, others get SSL handshake errors. Rolling back the certificates doesn't immediately fix it.",
		impact:
			"50% of internal service calls failing. Order processing halted. Customer-facing services returning errors. Emergency rollback only partially successful.",
		timeline: [
			{ time: "2:00 AM", event: "Certificate rotation begins (planned maintenance)", type: "normal" },
			{ time: "2:15 AM", event: "New certificates deployed to service mesh", type: "normal" },
			{ time: "2:20 AM", event: "First SSL handshake failures detected", type: "warning" },
			{ time: "2:25 AM", event: "50% of internal calls failing", type: "critical" },
			{ time: "2:30 AM", event: "Rollback initiated, some services still failing", type: "critical" },
			{ time: "2:45 AM", event: "Pattern identified: depends on which pod handles request", type: "warning" },
		],
	},

	symptoms: {
		working: [
			"Some pods connect successfully",
			"New certificates are valid and properly signed",
			"Services that recently restarted work fine",
			"Certificate chain validates correctly when tested manually",
		],
		broken: [
			"SSL: certificate verify failed - unable to get issuer certificate",
			"Handshake failures between services",
			"Random success/failure pattern",
			"Rollback doesn't immediately fix all connections",
		],
	},

	clues: [
		{
			id: 1,
			title: "Certificate Chain Structure",
			type: "config",
			content: `\`\`\`
OLD Certificate Chain:
└── Root CA: InternalCA-2023
    └── Intermediate: InternalCA-Intermediate-2023
        └── Service Cert: service-a.internal.company.com

NEW Certificate Chain:
└── Root CA: InternalCA-2024  ← NEW ROOT!
    └── Intermediate: InternalCA-Intermediate-2024
        └── Service Cert: service-a.internal.company.com

The rollover introduced a new Root CA.
Old certificates signed by old CA.
New certificates signed by new CA.
\`\`\``,
			hint: "New certificates use a completely different CA chain...",
		},
		{
			id: 2,
			title: "Service A Trust Store Configuration",
			type: "code",
			content: `\`\`\`yaml
# service-a/config/mtls.yaml

tls:
  # Server certificate (what service-a presents)
  cert_file: /certs/server.crt      # Updated to new cert at 2:15 AM
  key_file: /certs/server.key       # Updated to new key at 2:15 AM

  # Trust store (what service-a accepts from clients)
  ca_file: /certs/ca-bundle.pem     # Contains Root CAs to trust

# Problem: ca-bundle.pem was updated to ONLY contain new CA
# Clients still presenting old certificates get rejected
\`\`\``,
		},
		{
			id: 3,
			title: "Connection Attempt Logs",
			type: "logs",
			content: `\`\`\`
[2:22:15] service-b (pod-b-abc) -> service-a (pod-a-123)
  Client cert: signed by InternalCA-Intermediate-2024 (NEW)
  Server trust store: InternalCA-2024 (NEW)
  Result: SUCCESS ✓

[2:22:16] service-b (pod-b-def) -> service-a (pod-a-456)
  Client cert: signed by InternalCA-Intermediate-2023 (OLD)
  Server trust store: InternalCA-2024 (NEW)
  Result: FAILURE - unable to verify certificate
  Error: issuer certificate not found in trust store

[2:22:17] service-b (pod-b-abc) -> service-a (pod-a-789)
  Client cert: signed by InternalCA-Intermediate-2024 (NEW)
  Server trust store: InternalCA-2023 (OLD, not updated yet)
  Result: FAILURE - unable to verify certificate

pod-b-abc has new certs, pod-b-def has old certs
pod-a-123 and pod-a-456 have new trust store
pod-a-789 still has old trust store
\`\`\``,
			hint: "Different pods have different certificates AND trust stores",
		},
		{
			id: 4,
			title: "Deployment Strategy",
			type: "code",
			content: `\`\`\`yaml
# kubernetes/cert-rotation-job.yaml

apiVersion: batch/v1
kind: Job
metadata:
  name: cert-rotation
spec:
  template:
    spec:
      containers:
      - name: cert-updater
        image: cert-manager:v1.0
        command:
        - /bin/sh
        - -c
        - |
          # Update certificates in all ConfigMaps
          kubectl create configmap service-certs \\
            --from-file=server.crt=new-server.crt \\
            --from-file=server.key=new-server.key \\
            --from-file=ca-bundle.pem=new-ca-bundle.pem \\
            --dry-run=client -o yaml | kubectl apply -f -

          # Force pods to pick up new certs
          kubectl rollout restart deployment/service-a
          kubectl rollout restart deployment/service-b
          # ... more services

# Problem: Rolling restart means old and new pods coexist!
# During rollout, some pods have old certs, some have new
# They can't talk to each other if trust stores don't overlap
\`\`\``,
		},
		{
			id: 5,
			title: "Certificate Bundle Contents",
			type: "logs",
			content: `\`\`\`
# OLD ca-bundle.pem (before rotation)
-----BEGIN CERTIFICATE-----
InternalCA-2023 Root Certificate
-----END CERTIFICATE-----

# NEW ca-bundle.pem (after rotation) - PROBLEM!
-----BEGIN CERTIFICATE-----
InternalCA-2024 Root Certificate
-----END CERTIFICATE-----

# CORRECT ca-bundle.pem (should contain BOTH)
-----BEGIN CERTIFICATE-----
InternalCA-2023 Root Certificate
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
InternalCA-2024 Root Certificate
-----END CERTIFICATE-----

During transition, trust stores must trust BOTH old and new CAs!
\`\`\``,
			hint: "Trust store only has new CA, but some services still present old certs",
		},
		{
			id: 6,
			title: "Why Rollback Didn't Work Immediately",
			type: "testimony",
			content: `"When we rolled back the certificates, we updated the ConfigMap back to the old certs. But pods don't automatically reload certs from ConfigMaps - they read them at startup.

So after rollback:
- ConfigMap: old certs
- Pod-a-123: still running with new certs in memory
- Pod-a-456: still running with new certs in memory
- Only pods that restarted got the rolled-back certs

We had a mix of pods with different cert generations even after 'rollback'.

Eventually we did a full restart of all services at 3:30 AM and things stabilized. But that caused a 15-minute complete outage."

— SRE On-Call`,
		},
	],

	solution: {
		diagnosis: "Certificate rotation replaced trust stores with only the new CA, breaking communication with pods still presenting old certificates during rolling update",
		keywords: [
			"mtls",
			"certificate rotation",
			"trust store",
			"ca bundle",
			"rolling update",
			"ssl handshake",
			"certificate chain",
			"service mesh",
		],
		rootCause: `The root cause is replacing the CA trust store contents instead of adding to them during certificate rotation.

mTLS certificate rotation is a multi-phase process:
1. Services present client certificates signed by a CA
2. Servers verify client certificates against their trust store
3. During rotation, both old and new certificates coexist

The mistake was treating certificate rotation as an atomic swap:
- New trust stores contained ONLY the new CA
- But rolling updates mean old and new pods coexist
- Old pods present certificates signed by old CA
- New pods reject them (old CA not in new trust store)

This created a "split brain" during the rolling update:
- New pods could talk to new pods (both have new certs/trust)
- Old pods could talk to old pods (both have old certs/trust)
- Old pods couldn't talk to new pods (new trust store rejects old certs)
- New pods couldn't talk to old pods (old trust store rejects new certs)

Rollback failed because pods cache certificates in memory. The ConfigMap update only affects pods that restart.`,
		codeExamples: [
			{
				lang: "bash",
				description: "Correct rotation: Add new CA to trust stores FIRST",
				code: `#!/bin/bash
# cert-rotation-correct.sh

# PHASE 1: Add new CA to trust stores (keep old CA)
# This allows verification of BOTH old and new certificates
echo "Phase 1: Updating trust stores to accept both CAs..."

cat old-ca.pem new-ca.pem > combined-ca-bundle.pem

kubectl create configmap service-trust-store \\
  --from-file=ca-bundle.pem=combined-ca-bundle.pem \\
  --dry-run=client -o yaml | kubectl apply -f -

# Rolling restart to pick up new trust stores
kubectl rollout restart deployment/service-a
kubectl rollout restart deployment/service-b
kubectl rollout status deployment/service-a
kubectl rollout status deployment/service-b

echo "Waiting 10 minutes for all pods to update trust stores..."
sleep 600

# PHASE 2: Now rotate the certificates
echo "Phase 2: Rotating service certificates..."

kubectl create configmap service-certs \\
  --from-file=server.crt=new-server.crt \\
  --from-file=server.key=new-server.key \\
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/service-a
kubectl rollout restart deployment/service-b
kubectl rollout status deployment/service-a
kubectl rollout status deployment/service-b

echo "Waiting 10 minutes for all pods to use new certs..."
sleep 600

# PHASE 3: Remove old CA from trust stores (cleanup)
echo "Phase 3: Removing old CA from trust stores..."

kubectl create configmap service-trust-store \\
  --from-file=ca-bundle.pem=new-ca.pem \\
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/service-a
kubectl rollout restart deployment/service-b

echo "Certificate rotation complete!"`,
			},
			{
				lang: "yaml",
				description: "Certificate hot-reloading with sidecar",
				code: `# kubernetes/deployment-with-cert-reloader.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: service-a
spec:
  template:
    metadata:
      annotations:
        # Trigger pod restart when configmap changes
        checksum/certs: "{{ sha256sum .Values.certs }}"
    spec:
      containers:
      - name: app
        volumeMounts:
        - name: certs
          mountPath: /certs
          readOnly: true

      # Sidecar that watches for cert changes and signals app
      - name: cert-reloader
        image: cert-reloader:v1
        env:
        - name: WATCH_DIR
          value: /certs
        - name: SIGNAL_PROCESS
          value: app
        - name: SIGNAL_TYPE
          value: SIGHUP  # App reloads certs on SIGHUP
        volumeMounts:
        - name: certs
          mountPath: /certs
          readOnly: true

      volumes:
      - name: certs
        configMap:
          name: service-certs`,
			},
			{
				lang: "go",
				description: "Dynamic certificate reloading in application",
				code: `// pkg/tls/reloader.go
package tls

import (
	"crypto/tls"
	"crypto/x509"
	"sync"
)

type CertReloader struct {
	certFile string
	keyFile  string
	caFile   string
	mu       sync.RWMutex
	cert     *tls.Certificate
	caPool   *x509.CertPool
}

func (r *CertReloader) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cert, nil
}

func (r *CertReloader) GetClientCertificate(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cert, nil
}

func (r *CertReloader) GetCAPool() *x509.CertPool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.caPool
}

func (r *CertReloader) Reload() error {
	cert, err := tls.LoadX509KeyPair(r.certFile, r.keyFile)
	if err != nil {
		return err
	}

	caCert, err := os.ReadFile(r.caFile)
	if err != nil {
		return err
	}

	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caCert)

	r.mu.Lock()
	r.cert = &cert
	r.caPool = caPool
	r.mu.Unlock()

	log.Println("Certificates reloaded successfully")
	return nil
}

// Usage
func NewTLSConfig(reloader *CertReloader) *tls.Config {
	return &tls.Config{
		GetCertificate:       reloader.GetCertificate,
		GetClientCertificate: reloader.GetClientCertificate,
		RootCAs:              reloader.GetCAPool(),
		ClientCAs:            reloader.GetCAPool(),
		ClientAuth:           tls.RequireAndVerifyClientCert,
	}
}`,
			},
		],
		prevention: [
			"Always use a multi-phase rotation: update trust stores first, then certificates",
			"Trust stores should contain both old and new CAs during transition",
			"Implement certificate hot-reloading to avoid restart requirements",
			"Test rotation in staging with simulated rolling updates",
			"Monitor mTLS handshake success rates during rotation",
			"Allow sufficient time between phases for all pods to update",
			"Use service mesh features (Istio, Linkerd) that handle rotation automatically",
			"Document the rotation procedure with explicit phase timing",
		],
		educationalInsights: [
			"mTLS rotation is asymmetric: trust stores and certificates update independently",
			"Rolling updates create heterogeneous certificate states in the cluster",
			"Trust stores must trust ALL valid certificates during transition",
			"In-memory certificates persist even after ConfigMap changes",
			"Certificate rotation should be planned as a multi-day process, not minutes",
			"Service meshes like Istio/Linkerd automate mTLS rotation correctly",
		],
	},
};

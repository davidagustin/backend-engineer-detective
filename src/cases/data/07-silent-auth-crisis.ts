import type { DetectiveCase } from "../../types";

export const silentAuthCrisis: DetectiveCase = {
	id: "silent-auth-crisis",
	title: "The Silent Authentication Crisis",
	subtitle: "Random users can't login, but only from certain locations",
	difficulty: "mid",
	category: "auth",

	crisis: {
		description:
			"Users are reporting login failures, but only some users, and only sometimes. The pattern seems random. Retrying often works. Error messages are vague SSL errors.",
		impact:
			"10% of login attempts failing. Users frustrated by unreliable access. Support tickets up 5x. No clear pattern to the failures.",
		timeline: [
			{ time: "Monday 2:00 AM", event: "Certificate rotation deployed", type: "normal" },
			{ time: "Monday 6:00 AM", event: "First login failure reports", type: "warning" },
			{ time: "Monday 9:00 AM", event: "Support tickets spiking", type: "warning" },
			{ time: "Monday 12:00 PM", event: "Pattern noticed: geographically distributed", type: "warning" },
			{ time: "Monday 3:00 PM", event: "10% of logins failing", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Some datacenters report 100% login success",
			"Retrying login often succeeds",
			"Internal testing works perfectly",
			"No certificate errors in browser dev tools",
		],
		broken: [
			"SSL handshake failures from some clients",
			"Mobile apps particularly affected",
			"Pattern seems related to geography",
			"Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE",
		],
	},

	clues: [
		{
			id: 1,
			title: "Load Balancer Configuration",
			type: "config",
			content: `\`\`\`
Production Load Balancers:
- lb-us-east-1    (Virginia)     - 10 instances
- lb-us-west-2    (Oregon)       - 8 instances
- lb-eu-west-1    (Ireland)      - 6 instances
- lb-ap-south-1   (Mumbai)       - 4 instances

Certificate deployment strategy: Rolling update
Deployment time per LB: ~2 minutes
Total deployment time: ~56 minutes
\`\`\``,
		},
		{
			id: 2,
			title: "Error Logs from Mobile Clients",
			type: "logs",
			content: `\`\`\`
[ERROR] SSLHandshake failed
  Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE
  Host: api.gaming.com
  Time: 2024-01-15T09:23:45Z
  Device: iPhone 14
  Region: EU

[ERROR] SSLHandshake failed
  Error: certificate has expired
  Host: api.gaming.com
  Time: 2024-01-15T09:24:12Z
  Device: Samsung S23
  Region: AP

[ERROR] Connection failed
  Error: SSL_ERROR_BAD_CERT_DOMAIN
  Host: api.gaming.com
  Time: 2024-01-15T09:25:33Z
  Device: iPhone 13
  Region: US
\`\`\``,
			hint: "Three different SSL errors from different regions...",
		},
		{
			id: 3,
			title: "Certificate Deployment Script",
			type: "code",
			content: `\`\`\`bash
#!/bin/bash
# cert-deploy.sh - Rotate SSL certificates

NEW_CERT=$1
NEW_KEY=$2

for region in us-east-1 us-west-2 eu-west-1 ap-south-1; do
  for lb in $(get_load_balancers $region); do
    echo "Deploying to $lb..."

    # Upload new certificate
    upload_cert $lb $NEW_CERT $NEW_KEY

    # Wait for cert to propagate
    sleep 30

    # Update listener
    update_listener $lb $NEW_CERT

    echo "$lb updated"
  done
done

echo "Deployment complete"
\`\`\``,
		},
		{
			id: 4,
			title: "Certificate Chain Analysis",
			type: "logs",
			content: `\`\`\`
Old Certificate (expired Jan 14):
└── Root CA: DigiCert Global Root
    └── Intermediate: DigiCert SHA2 Secure Server CA
        └── Leaf: *.gaming.com (expired)

New Certificate (valid Jan 15 - Jan 14 next year):
└── Root CA: DigiCert Global Root G2  ← Different root!
    └── Intermediate: DigiCert Global G2 TLS RSA SHA256 2020 CA1
        └── Leaf: *.gaming.com (valid)

Note: Old certificate's intermediate is different from new
\`\`\``,
			hint: "The certificate chain structure changed...",
		},
		{
			id: 5,
			title: "CDN Cache Investigation",
			type: "metrics",
			content: `\`\`\`
CDN Cache Status:

Edge Location    | Cert Version | Cache Age
-----------------|--------------|------------
NYC              | NEW          | 5 min
Los Angeles      | OLD          | 47 hours
London           | NEW          | 3 min
Frankfurt        | OLD          | 23 hours
Tokyo            | NEW          | 1 min
Mumbai           | OLD          | 35 hours
Sydney           | OLD          | 41 hours

Cache TTL setting: 48 hours
SSL termination: At edge (CDN level)
\`\`\``,
		},
		{
			id: 6,
			title: "Infrastructure Team Chat",
			type: "testimony",
			content: `"We rotated the certs at 2 AM as scheduled. The script completed successfully by 3 AM. All load balancers got the new cert. But wait... we also have the CDN in front. The CDN does SSL termination at the edge. I wonder if the CDN is still using cached connections with the old cert?"`,
		},
		{
			id: 7,
			title: "OCSP/CRL Check",
			type: "logs",
			content: `\`\`\`
$ openssl s_client -connect api.gaming.com:443 -servername api.gaming.com

# From Frankfurt edge (OLD cert):
Certificate chain
 0 s:CN = *.gaming.com
   i:CN = DigiCert SHA2 Secure Server CA
 1 s:CN = DigiCert SHA2 Secure Server CA
   i:CN = DigiCert Global Root CA

Verify return code: 10 (certificate has expired)

# From NYC edge (NEW cert):
Certificate chain
 0 s:CN = *.gaming.com
   i:CN = DigiCert Global G2 TLS RSA SHA256 2020 CA1
 1 s:CN = DigiCert Global G2 TLS RSA SHA256 2020 CA1
   i:CN = DigiCert Global Root G2

Verify return code: 0 (ok)
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Certificate deployment race condition between CDN edge caches and origin servers, with mixed certificate chains",
		keywords: [
			"cdn cache",
			"certificate",
			"edge cache",
			"ssl",
			"tls",
			"deployment race",
			"cache invalidation",
			"certificate chain",
			"propagation",
		],
		rootCause: `Multiple issues combined:

1. **CDN Edge Caching**: The CDN terminates SSL at edge locations. Edge nodes cache SSL sessions and certificates with a 48-hour TTL. The deployment script only updated origin load balancers, not CDN edges.

2. **Stale Edge Certificates**: Some edge nodes (Los Angeles, Frankfurt, Mumbai, Sydney) still had the old expired certificate cached, while others (NYC, London, Tokyo) had already fetched the new one.

3. **Certificate Chain Mismatch**: The new certificate uses a different intermediate CA (DigiCert Global G2 TLS RSA SHA256 2020 CA1) than the old one (DigiCert SHA2 Secure Server CA). Some clients have the old intermediate cached but not the new one.

4. **Client Trust Store Variations**:
   - Some mobile clients don't have the new root CA (DigiCert Global Root G2)
   - Some clients are validating against cached intermediates

The result is a geographic lottery where:
- Users hitting updated edges: Success
- Users hitting stale edges: Various SSL failures
- Retrying might route to a different edge: Intermittent success/failure`,
		codeExamples: [
			{
				lang: "bash",
				description: "Proper certificate deployment with CDN cache purge",
				code: `#!/bin/bash
# cert-deploy.sh - Rotate SSL certificates with CDN awareness

NEW_CERT=$1
NEW_KEY=$2
NEW_CHAIN=$3  # Include full chain!

# 1. Deploy to all origins first (without activating)
for region in us-east-1 us-west-2 eu-west-1 ap-south-1; do
  for lb in $(get_load_balancers $region); do
    upload_cert $lb $NEW_CERT $NEW_KEY $NEW_CHAIN --stage
  done
done

# 2. Purge CDN SSL cache
echo "Purging CDN SSL sessions..."
cdn_purge --type ssl --all-edges
sleep 60  # Wait for purge to propagate

# 3. Activate new certs on all origins simultaneously
echo "Activating new certificates..."
for region in us-east-1 us-west-2 eu-west-1 ap-south-1; do
  for lb in $(get_load_balancers $region); do
    activate_cert $lb $NEW_CERT &
  done
done
wait

# 4. Verify all edges
echo "Verifying deployment..."
for edge in $(get_cdn_edges); do
  verify_cert $edge || echo "WARNING: $edge verification failed"
done`,
			},
			{
				lang: "typescript",
				description: "Certificate validation in deployment pipeline",
				code: `class CertificateDeployer {
  async deploy(cert: Certificate): Promise<void> {
    // Validate certificate chain before deployment
    await this.validateChain(cert);

    // Check client compatibility
    const compatibility = await this.checkClientCompatibility(cert);
    if (compatibility.issues.length > 0) {
      throw new Error(\`Cert has compatibility issues: \${compatibility.issues}\`);
    }

    // Deploy with coordinated rollout
    await this.coordinatedRollout(cert);
  }

  private async validateChain(cert: Certificate): Promise<void> {
    // Ensure full chain is present
    if (!cert.intermediates || cert.intermediates.length === 0) {
      throw new Error('Certificate must include intermediate chain');
    }

    // Verify chain builds to trusted root
    const chain = [cert.leaf, ...cert.intermediates];
    for (let i = 0; i < chain.length - 1; i++) {
      if (!chain[i].issuer.equals(chain[i + 1].subject)) {
        throw new Error('Certificate chain is broken');
      }
    }
  }

  private async checkClientCompatibility(cert: Certificate): Promise<Report> {
    // Check against known client trust stores
    const issues: string[] = [];

    for (const store of [IOS_TRUST_STORE, ANDROID_TRUST_STORE, CHROME_TRUST_STORE]) {
      if (!store.hasRoot(cert.rootCA)) {
        issues.push(\`\${store.name} may not trust root CA\`);
      }
    }

    return { issues };
  }
}`,
			},
		],
		prevention: [
			"Always include CDN cache purge in certificate rotation procedures",
			"Deploy certificates with full chain (leaf + intermediates)",
			"Test certificate deployment in staging with CDN simulation",
			"Use a staged rollout: deploy everywhere first, then activate simultaneously",
			"Verify certificate from multiple geographic locations post-deployment",
			"Monitor SSL handshake error rates during and after rotation",
			"Document the complete certificate deployment path including all caches",
		],
		educationalInsights: [
			"CDN edges cache more than just content - SSL sessions and certs too",
			"Certificate chain changes can break clients with incomplete trust stores",
			"'It works from here' is meaningless for geographically distributed systems",
			"Retrying and succeeding often indicates load balancing/caching issues",
			"SSL errors are symptoms - the cause is usually configuration/deployment",
			"Different SSL errors (expired, bad domain, verify failed) can all come from the same root cause",
		],
	},
};

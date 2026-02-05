import type { DetectiveCase } from "../../types";

export const invisibleApi: DetectiveCase = {
	id: "invisible-api",
	title: "The Invisible API",
	subtitle: "API works everywhere except iOS apps",
	difficulty: "junior",
	category: "networking",

	crisis: {
		description:
			"The new API endpoint works perfectly in browser, Android, Postman, and curl. But iOS apps get connection failures. No errors in API logs because requests never arrive.",
		impact:
			"100% of iOS users affected (40% of user base). iOS app unusable for new feature. App Store reviews tanking. Android users unaffected.",
		timeline: [
			{ time: "Day 1", event: "New feature deployed", type: "normal" },
			{ time: "Day 1", event: "iOS reports of feature not working", type: "warning" },
			{ time: "Day 2", event: "Confirmed iOS-only issue", type: "warning" },
			{ time: "Day 3", event: "API team says 'no requests received'", type: "critical" },
			{ time: "Day 4", event: "All iOS users affected, investigation urgent", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"API works in web browsers",
			"API works on Android",
			"API works with curl/Postman",
			"API health checks pass",
			"No errors in server logs",
		],
		broken: [
			"iOS native app can't connect",
			"Error: NSURLErrorDomain -1200",
			"No requests reach the server",
			"Only affects new endpoint URL",
		],
	},

	clues: [
		{
			id: 1,
			title: "iOS Error Details",
			type: "logs",
			content: `\`\`\`
Error Domain=NSURLErrorDomain Code=-1200
"An SSL error has occurred and a secure connection
 to the server cannot be made."

UserInfo={
  NSLocalizedDescription=An SSL error has occurred,
  NSErrorFailingURLStringKey=https://api-v2.gaming.com/user/profile,
  _NSURLErrorFailingURLSessionTaskErrorKey=LocalDataTask,
  _NSURLErrorRelatedURLSessionTaskErrorKey=["LocalDataTask"],
  NSUnderlyingError=Error Domain=kCFErrorDomainCFNetwork Code=-1200
}
\`\`\``,
			hint: "The error mentions SSL and a specific URL...",
		},
		{
			id: 2,
			title: "Infrastructure Configuration",
			type: "config",
			content: `\`\`\`
Production Infrastructure:

Old API (works on iOS):
- URL: https://api.gaming.com
- SSL: TLS 1.2+ with ATS-compatible config
- Certificate: DigiCert, full chain, ECDSA

New API (fails on iOS):
- URL: https://api-v2.gaming.com
- SSL: TLS 1.2+ (we think)
- Certificate: Let's Encrypt, auto-renewed
- Server: Nginx on new Kubernetes cluster
\`\`\``,
		},
		{
			id: 3,
			title: "curl Test Results",
			type: "logs",
			content: `\`\`\`bash
# Test from MacBook
$ curl -v https://api-v2.gaming.com/health
* Connected to api-v2.gaming.com (52.1.2.3) port 443
* SSL connection using TLSv1.2 / ECDHE-RSA-AES128-GCM-SHA256
* Server certificate:
*   subject: CN=api-v2.gaming.com
*   issuer: C=US, O=Let's Encrypt, CN=R3
*   validity: Jan 10 - Apr 10
< HTTP/1.1 200 OK
{"status": "healthy"}

# Looks fine! Why doesn't iOS work?
\`\`\``,
		},
		{
			id: 4,
			title: "iOS App Transport Security",
			type: "config",
			content: `\`\`\`
Apple's App Transport Security (ATS) Requirements:

Required for iOS apps by default:
✓ HTTPS required
✓ TLS 1.2 or later
✓ Forward secrecy (specific ciphers)
? Certificate must use SHA-256 or better
? Certificate key must be RSA 2048+ or ECC 256+

Info.plist can disable ATS, but App Store review may reject
\`\`\``,
		},
		{
			id: 5,
			title: "Nginx SSL Configuration",
			type: "config",
			content: `\`\`\`nginx
# /etc/nginx/conf.d/ssl.conf

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;

ssl_certificate /etc/ssl/certs/api-v2.crt;
ssl_certificate_key /etc/ssl/private/api-v2.key;

# Note: ssl_certificate contains only the leaf certificate
# The intermediate chain is... wait, where is it?
\`\`\``,
			hint: "What's in that certificate file?",
		},
		{
			id: 6,
			title: "Certificate File Contents",
			type: "logs",
			content: `\`\`\`bash
$ cat /etc/ssl/certs/api-v2.crt
-----BEGIN CERTIFICATE-----
MIIFLzCCBBegAwIBAgISA... (leaf certificate)
-----END CERTIFICATE-----

# Only 1 certificate block!
# Missing: intermediate certificate chain

# Full chain should look like:
# - Leaf certificate (our domain)
# - R3 intermediate (Let's Encrypt)
# - ISRG Root X1 (Let's Encrypt root)
\`\`\``,
		},
		{
			id: 7,
			title: "SSL Labs Test",
			type: "metrics",
			content: `\`\`\`
SSL Labs Test Results for api-v2.gaming.com:

Overall Rating: B (was expecting A)

Chain Issues:
⚠️ Chain Incomplete
  Server sent: 1 certificate
  Expected: 2-3 certificates (leaf + intermediates)

Trust Verification:
✓ Desktop browsers: Trusted (have cached intermediates)
✓ Android: Trusted (have cached intermediates)
✓ curl: Trusted (have cached intermediates)
✗ iOS: NOT TRUSTED (strict chain validation)

iOS does NOT cache intermediate certificates!
\`\`\``,
		},
	],

	solution: {
		diagnosis: "SSL certificate chain is incomplete - missing intermediate certificate required by iOS's strict ATS validation",
		keywords: [
			"ssl chain",
			"intermediate certificate",
			"ats",
			"app transport security",
			"certificate chain",
			"incomplete chain",
			"ios ssl",
		],
		rootCause: `The new API server's SSL configuration only includes the leaf certificate, not the full certificate chain.

Certificate chains work like this:
1. Root CA (trusted by devices) → signs Intermediate CA → signs Your Certificate
2. Server must send: Your Certificate + Intermediate CA
3. Client has: Root CA (pre-installed in trust store)
4. Client builds: Root CA → Intermediate → Your Cert = TRUSTED

The problem:
- Most browsers/curl cache intermediate certificates from other sites
- If you've visited ANY Let's Encrypt site, you have the R3 intermediate cached
- So desktop/Android work because they have the intermediate cached
- iOS does NOT cache intermediates - it requires a complete chain
- iOS follows ATS (App Transport Security) strictly

The DevOps team's Let's Encrypt auto-renewal script only downloaded the leaf certificate, not fullchain.pem which includes the intermediate.`,
		codeExamples: [
			{
				lang: "bash",
				description: "Fix Nginx to use full certificate chain",
				code: `# Download the full chain from Let's Encrypt
# certbot already creates this - use fullchain.pem, not cert.pem

# In nginx.conf:
ssl_certificate /etc/letsencrypt/live/api-v2.gaming.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/api-v2.gaming.com/privkey.pem;

# Verify the chain:
openssl s_client -connect api-v2.gaming.com:443 -showcerts

# Should show multiple certificates in the output`,
			},
			{
				lang: "bash",
				description: "Manually build the certificate chain",
				code: `# If you need to manually build the chain:

# Download Let's Encrypt intermediate
curl -O https://letsencrypt.org/certs/lets-encrypt-r3.pem

# Concatenate: your cert + intermediate
cat api-v2.crt lets-encrypt-r3.pem > api-v2-fullchain.crt

# Update nginx to use the full chain
ssl_certificate /etc/ssl/certs/api-v2-fullchain.crt;`,
			},
			{
				lang: "bash",
				description: "Verify certificate chain completeness",
				code: `# Test certificate chain
openssl s_client -connect api-v2.gaming.com:443 -servername api-v2.gaming.com 2>/dev/null | openssl x509 -noout -text | grep -A1 "Issuer:"

# Verify chain depth
openssl s_client -connect api-v2.gaming.com:443 2>&1 | grep "depth="

# Expected output:
# depth=2 O = Digital Signature Trust Co., CN = DST Root CA X3
# depth=1 C = US, O = Let's Encrypt, CN = R3
# depth=0 CN = api-v2.gaming.com

# If you only see depth=0, chain is incomplete`,
			},
			{
				lang: "yaml",
				description: "Kubernetes secret with full chain",
				code: `# When creating TLS secrets for Kubernetes:
apiVersion: v1
kind: Secret
metadata:
  name: api-v2-tls
type: kubernetes.io/tls
data:
  # tls.crt must be the FULL CHAIN (base64 encoded)
  # cat cert.pem chain.pem | base64
  tls.crt: LS0tLS1CRUdJTi... (includes leaf + intermediates)
  tls.key: LS0tLS1CRUdJTi...`,
			},
		],
		prevention: [
			"Always use fullchain.pem, not just cert.pem",
			"Test SSL with 'SSL Labs' or 'testssl.sh' before deployment",
			"Include iOS device in SSL testing checklist",
			"Monitor SSL certificate deployments for chain completeness",
			"Set up alerts for SSL Labs grade drops",
			"Document certificate renewal procedures including chain requirements",
		],
		educationalInsights: [
			"Browsers cache intermediates - this masks incomplete chain issues",
			"iOS ATS is stricter than most platforms about SSL",
			"'Works in curl' doesn't mean 'works on all clients'",
			"Let's Encrypt provides both cert.pem AND fullchain.pem for a reason",
			"Certificate chains are a common source of mobile-only SSL failures",
			"SSL Labs is your friend - test certificates before and after deployment",
		],
	},
};

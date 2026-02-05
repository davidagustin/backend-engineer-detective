import type { DetectiveCase } from "../../types";

export const tlsHandshakeTimeout: DetectiveCase = {
	id: "tls-handshake-timeout",
	title: "The TLS Handshake Timeout",
	subtitle: "Slow connections due to certificate chain too long",
	difficulty: "mid",
	category: "networking",

	crisis: {
		description:
			"Users on slower network connections (mobile, high-latency regions) are experiencing connection timeouts before the page even loads. The TLS handshake is taking abnormally long, and many connections fail before completing. Users on fast connections work fine.",
		impact:
			"40% connection failure rate on mobile networks. International users especially affected. Bounce rate doubled. App store reviews mentioning 'can't connect' issues.",
		timeline: [
			{ time: "Monday", event: "SSL certificate renewed with new provider", type: "normal" },
			{ time: "Tuesday", event: "Mobile app users report connection issues", type: "warning" },
			{ time: "Wednesday", event: "Connection timeout rate spikes to 40% on 3G", type: "critical" },
			{ time: "Thursday", event: "International users completely unable to connect", type: "critical" },
			{ time: "Friday", event: "App store rating drops from 4.5 to 3.2 stars", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Connections from office network (low latency)",
			"Desktop users on fiber/cable",
			"Connections from same data center region",
			"curl from server works fine",
			"SSL Labs test shows A+ rating",
		],
		broken: [
			"Mobile users on 3G/4G experiencing timeouts",
			"Users in Asia/Australia failing to connect",
			"High-latency connections timing out during handshake",
			"First byte time extremely high",
		],
	},

	clues: [
		{
			id: 1,
			title: "TLS Handshake Timing",
			type: "metrics",
			content: `\`\`\`
Connection timing breakdown (mobile 3G user):

DNS Lookup:      150ms
TCP Connect:     380ms
TLS Handshake:   4,247ms  ← PROBLEM
Time to First Byte: TIMEOUT (exceeded 5s limit)

Connection timing breakdown (office user):

DNS Lookup:       20ms
TCP Connect:      15ms
TLS Handshake:   180ms
Time to First Byte: 210ms
\`\`\``,
			hint: "Why is TLS handshake so much slower on mobile?",
		},
		{
			id: 2,
			title: "Certificate Chain Analysis",
			type: "logs",
			content: `\`\`\`bash
$ openssl s_client -connect api.example.com:443 -showcerts 2>/dev/null | grep -E "^(Certificate chain| [0-9]+ s:)"

Certificate chain
 0 s:CN = api.example.com
   i:CN = RapidSSL TLS RSA CA G1
 1 s:CN = RapidSSL TLS RSA CA G1
   i:CN = DigiCert Global Root G2
 2 s:CN = DigiCert Global Root G2
   i:CN = DigiCert Global Root G1
 3 s:CN = DigiCert Global Root G1
   i:CN = DigiCert Assured ID Root CA
 4 s:CN = DigiCert Assured ID Root CA
   i:CN = DigiCert Assured ID Root CA

# 5 certificates in chain (including unnecessary root certs)
# Total certificate chain size: 12,847 bytes
\`\`\``,
			hint: "How many certificates are in this chain? How many are needed?",
		},
		{
			id: 3,
			title: "Server Configuration",
			type: "config",
			content: `\`\`\`nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.example.com.fullchain.pem;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;

    # OCSP stapling enabled
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # Note: fullchain.pem was provided by cert vendor
    # We trusted the "complete bundle" they gave us
}
\`\`\``,
			hint: "The fullchain.pem was provided as-is by the vendor...",
		},
		{
			id: 4,
			title: "Network Packet Analysis",
			type: "logs",
			content: `\`\`\`
# TLS handshake packet sizes

Client -> Server: ClientHello (512 bytes)
Server -> Client: ServerHello + Certificate + ServerHelloDone

Certificate message breakdown:
  - Server cert (api.example.com): 2,341 bytes
  - Intermediate 1 (RapidSSL):     1,847 bytes
  - Intermediate 2 (DigiCert G2):  1,523 bytes
  - Root 1 (DigiCert G1):          1,647 bytes  ← UNNECESSARY
  - Root 2 (DigiCert Assured):     1,489 bytes  ← UNNECESSARY

Total Certificate message: 12,847 bytes (spans 9 TCP segments)

On 3G network (500ms RTT):
  - Segments take 500ms each to acknowledge
  - 9 segments = 4.5 seconds just for certificate delivery
  - Plus ClientHello/ServerHello overhead
\`\`\``,
			hint: "How does packet fragmentation affect high-latency connections?",
		},
		{
			id: 5,
			title: "SSL Labs Report",
			type: "metrics",
			content: `\`\`\`
SSL Labs Test Results:

Overall Rating: A+
Certificate: 100
Protocol Support: 100
Key Exchange: 90
Cipher Strength: 90

Chain Issues:
  ⚠️ Contains anchor (root certificate included)
  ⚠️ Extra chain certificates provided

Handshake Simulation:
  Android 4.4.2: Connection failed (timeout)
  iOS 12.4: 4,100ms handshake
  Chrome (3G): Connection failed (timeout)
  Firefox (Fiber): 180ms handshake
\`\`\``,
			hint: "The chain issues mention 'anchor' and 'extra chain certificates'...",
		},
		{
			id: 6,
			title: "DevOps Engineer Testimony",
			type: "testimony",
			content: `"When we renewed the certificate, the new provider gave us a 'complete bundle' for maximum compatibility. They said including all the intermediate and root certificates would ensure compatibility with older clients. We just concatenated everything they gave us into the fullchain.pem file. SSL Labs gave us an A+ so we thought everything was fine."`,
		},
	],

	solution: {
		diagnosis: "Certificate chain contains unnecessary root certificates causing excessive handshake size",
		keywords: [
			"tls handshake",
			"certificate chain",
			"handshake timeout",
			"ssl certificate",
			"chain length",
			"root certificate",
			"intermediate certificate",
			"handshake size",
		],
		rootCause: `The TLS certificate chain includes unnecessary root certificates (which clients already have in their trust store) and possibly extra cross-signed intermediates. This bloats the certificate message from ~4KB (typical) to nearly 13KB.

On high-latency connections (3G mobile, international), the TLS handshake requires multiple round trips. The server must send the full certificate chain before the handshake can complete. With 12KB+ of certificates:

1. Certificate message spans 9 TCP segments
2. Each segment requires acknowledgment
3. On 500ms RTT: 9 segments * 500ms = 4.5 seconds minimum
4. Add ClientHello, ServerHello, key exchange = easily exceeds 5s timeout

Root certificates should NEVER be included in the chain because:
- Clients already have them in their trust store
- If client doesn't have the root, sending it doesn't help (it's not trusted anyway)
- They add ~1.5KB+ each for no benefit

The proper chain should only include: server certificate + necessary intermediate(s).`,
		codeExamples: [
			{
				lang: "bash",
				description: "Build proper certificate chain",
				code: `# Check what certificates you have
openssl crl2pkcs7 -nocrl -certfile fullchain.pem | \\
  openssl pkcs7 -print_certs -noout | \\
  grep "subject="

# Identify which certs are roots (self-signed)
# Roots have subject == issuer
openssl x509 -in cert.pem -noout -subject -issuer

# Build minimal chain: server cert + intermediates only (NO roots)
cat server.crt intermediate1.crt > proper-chain.pem

# Verify the chain is valid
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt proper-chain.pem

# Check chain size
wc -c proper-chain.pem  # Should be under 5KB typically`,
			},
			{
				lang: "nginx",
				description: "Optimized NGINX SSL configuration",
				code: `server {
    listen 443 ssl http2;
    server_name api.example.com;

    # Use minimal chain (server cert + intermediates only, NO roots)
    ssl_certificate /etc/ssl/certs/api.example.com.chain.pem;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # Enable session resumption to skip full handshake on reconnect
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;  # Or on with proper key rotation

    # OCSP stapling reduces client-side lookups
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # Early data (TLS 1.3 0-RTT) for repeat visitors
    ssl_early_data on;
}`,
			},
			{
				lang: "bash",
				description: "Test and verify certificate chain",
				code: `# Test chain from multiple locations
echo | openssl s_client -connect api.example.com:443 2>/dev/null | \\
  openssl x509 -noout -text | grep -A1 "Certificate chain"

# Check handshake timing
curl -w "DNS: %{time_namelookup}s\\nConnect: %{time_connect}s\\nTLS: %{time_appconnect}s\\nTotal: %{time_total}s\\n" \\
  -o /dev/null -s https://api.example.com

# Simulate high-latency connection
tc qdisc add dev eth0 root netem delay 250ms
curl -w "TLS Handshake: %{time_appconnect}s\\n" -o /dev/null -s https://api.example.com
tc qdisc del dev eth0 root

# SSL Labs API check
curl "https://api.ssllabs.com/api/v3/analyze?host=api.example.com&publish=off"`,
			},
		],
		prevention: [
			"Never include root certificates in server certificate chain",
			"Verify certificate chain size after any certificate change",
			"Test TLS handshake from high-latency locations before deploying",
			"Use SSL Labs to check for chain issues ('Contains anchor' warning)",
			"Enable TLS session resumption to avoid full handshakes",
			"Consider ECDSA certificates (smaller than RSA)",
		],
		educationalInsights: [
			"TLS handshake requires multiple round trips; size matters on slow networks",
			"Root certificates are already trusted by clients - sending them is wasteful",
			"SSL Labs A+ rating doesn't mean optimal performance",
			"Mobile 3G connections can have 500ms+ round trip times",
			"Every KB in the certificate chain adds ~1 RTT on congested networks",
			"TLS 1.3 reduces handshake round trips but certificate size still matters",
		],
	},
};

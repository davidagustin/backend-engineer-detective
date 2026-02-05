import type { DetectiveCase } from "../../types";

export const jwtTokenSizeExplosion: DetectiveCase = {
	id: "jwt-token-size-explosion",
	title: "The JWT Token Size Explosion",
	subtitle: "Requests failing due to JWT exceeding header size limit",
	difficulty: "mid",
	category: "auth",

	crisis: {
		description:
			"Users are getting 431 'Request Header Fields Too Large' errors after a recent permissions update. The error happens randomly across the platform, but seems to affect power users more than new accounts.",
		impact:
			"15% of users completely locked out. Enterprise customers with complex roles cannot access the platform. Support queue overflowing with 'can't login' tickets.",
		timeline: [
			{ time: "Monday 10:00 AM", event: "Permissions system update deployed with new granular roles", type: "normal" },
			{ time: "Monday 11:00 AM", event: "First reports of 431 errors from enterprise users", type: "warning" },
			{ time: "Monday 2:00 PM", event: "Pattern identified: users with many permissions affected", type: "warning" },
			{ time: "Monday 4:00 PM", event: "15% of users reporting login failures", type: "critical" },
			{ time: "Monday 5:00 PM", event: "Enterprise customer threatens contract cancellation", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"New users with basic permissions login fine",
			"Same users can login on mobile app (different auth flow)",
			"Backend services work correctly when bypassing the gateway",
			"Token generation succeeds without errors",
		],
		broken: [
			"HTTP 431 Request Header Fields Too Large",
			"Enterprise users with admin roles cannot login",
			"Users with multiple team memberships affected",
			"Error happens after successful authentication, during API calls",
		],
	},

	clues: [
		{
			id: 1,
			title: "Nginx Error Logs",
			type: "logs",
			content: `\`\`\`
[error] 2024-01-15 11:23:45 client sent too large header
  Request: POST /api/v1/dashboard
  Header size: 12847 bytes
  Limit: 8192 bytes
  Client: 10.0.1.52 (user_id: u_admin_8234)

[error] 2024-01-15 11:24:12 client sent too large header
  Request: GET /api/v1/projects
  Header size: 15234 bytes
  Limit: 8192 bytes
  Client: 10.0.1.89 (user_id: u_enterprise_4521)

[error] 2024-01-15 11:25:33 client sent too large header
  Request: PUT /api/v1/settings
  Header size: 18923 bytes
  Limit: 8192 bytes
  Client: 10.0.1.103 (user_id: u_superadmin_1234)
\`\`\``,
			hint: "Header sizes are 1.5x to 2x over the limit...",
		},
		{
			id: 2,
			title: "JWT Token Structure",
			type: "code",
			content: `\`\`\`typescript
// auth-service/src/token.ts
interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];  // NEW: Added in Monday's release
  teams: TeamMembership[];
  features: string[];  // Feature flags
  iat: number;
  exp: number;
}

function generateToken(user: User): string {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    permissions: user.getAllPermissions(),  // Can return 200+ items!
    teams: user.teamMemberships,
    features: getEnabledFeatures(user),
    iat: Date.now(),
    exp: Date.now() + 86400000
  };

  return jwt.sign(payload, SECRET_KEY);
}
\`\`\``,
			hint: "getAllPermissions() returns a LOT of data...",
		},
		{
			id: 3,
			title: "Sample Token Analysis",
			type: "logs",
			content: `\`\`\`
Token Analysis for user: u_superadmin_1234

Decoded JWT payload size breakdown:
- Header (base64): 36 bytes
- Payload breakdown:
  - sub, email, name, iat, exp: ~150 bytes
  - roles (5 items): ~120 bytes
  - teams (12 memberships): ~840 bytes
  - features (8 flags): ~180 bytes
  - permissions (287 items): ~11,200 bytes  ← PROBLEM!

Total payload: ~12,490 bytes
Encoded JWT: ~16,650 bytes (base64 overhead)

Authorization header: "Bearer " + token = 16,657 bytes
Nginx header limit: 8,192 bytes
\`\`\``,
		},
		{
			id: 4,
			title: "Permissions Migration Code",
			type: "code",
			content: `\`\`\`typescript
// migrations/add-granular-permissions.ts
async function migratePermissions() {
  const roles = await db.roles.findAll();

  for (const role of roles) {
    // Old: role had 5-10 coarse permissions like "admin", "editor", "viewer"
    // New: Each coarse permission maps to 20-50 granular permissions
    const granularPerms = expandToGranularPermissions(role.permissions);

    // Example: "admin" expands to:
    // ["users:read", "users:write", "users:delete", "users:invite",
    //  "projects:read", "projects:write", "projects:delete", "projects:archive",
    //  "billing:read", "billing:write", "billing:refund", ...]

    await db.roles.update(role.id, { permissions: granularPerms });
  }
}

// User with 5 roles now has 5 * 50 = 250 permissions
\`\`\``,
			hint: "Permission explosion: 5 roles * 50 permissions each = 250 permissions",
		},
		{
			id: 5,
			title: "Mobile App Investigation",
			type: "testimony",
			content: `"The mobile app uses a different auth flow. Instead of putting the full JWT in every request header, we use session tokens. The JWT is exchanged once for a short opaque session ID, and the backend looks up permissions from Redis.

The web app was built first and just passes the JWT on every request because it was 'simpler.' We never hit size limits before because the old permission system only had 10-20 permissions per user max."

— Mobile Team Lead`,
		},
		{
			id: 6,
			title: "HTTP Header Limits Documentation",
			type: "config",
			content: `\`\`\`
HTTP Header Size Limits by Component:

| Component        | Default Limit | Our Config |
|------------------|---------------|------------|
| Nginx            | 8 KB          | 8 KB       |
| AWS ALB          | 16 KB         | 16 KB      |
| Cloudflare       | 16 KB         | 16 KB      |
| Chrome           | ~256 KB       | N/A        |
| Node.js (http)   | 8 KB          | 16 KB      |

RFC 7230 recommends servers accept at least 8 KB headers.
Most proxies/load balancers default to 8-16 KB.

Note: Cookies + Authorization + other headers must ALL fit!
\`\`\``,
		},
	],

	solution: {
		diagnosis: "JWT tokens storing all granular permissions exceeded HTTP header size limits after permission system expansion",
		keywords: [
			"jwt",
			"token size",
			"header too large",
			"431",
			"permissions",
			"header limit",
			"authorization",
			"granular permissions",
			"token bloat",
		],
		rootCause: `The root cause was storing all user permissions directly in the JWT payload.

The sequence of events:
1. Permission system was updated from coarse (10-20 per user) to granular (200+ per user)
2. JWT token generation included ALL permissions in the payload
3. Enterprise users with multiple roles accumulated 250+ permissions
4. Base64-encoded JWT exceeded 16KB for some users
5. Nginx's 8KB header limit rejected requests before they reached the backend

The mobile app worked because it used session tokens (opaque IDs) instead of self-contained JWTs. This demonstrates the trade-off between stateless (JWT) and stateful (session) authentication.

JWTs are meant to be compact. Including large permission arrays violates this principle and creates:
- Network overhead on every request
- Header size limit issues
- Token refresh problems (can't update permissions without new token)
- Security concerns (permissions visible in token)`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Problematic: Storing all permissions in JWT",
				code: `// DON'T DO THIS
function generateToken(user: User): string {
  return jwt.sign({
    sub: user.id,
    permissions: user.getAllPermissions(), // Can be 200+ items!
    roles: user.roles,
    teams: user.teams,
  }, SECRET_KEY);
}`,
			},
			{
				lang: "typescript",
				description: "Fixed: Store minimal claims, look up permissions server-side",
				code: `// auth-service/src/token.ts
function generateToken(user: User): string {
  // JWT contains only identity + role references
  return jwt.sign({
    sub: user.id,
    email: user.email,
    roles: user.roles.map(r => r.id), // Just role IDs, not permissions
    iat: Date.now(),
    exp: Date.now() + 86400000
  }, SECRET_KEY);
}

// middleware/auth.ts
async function authorize(req: Request, permission: string): Promise<boolean> {
  const token = extractToken(req);
  const payload = jwt.verify(token, SECRET_KEY);

  // Look up permissions from cache/database
  const permissions = await getPermissionsForRoles(payload.roles);
  return permissions.includes(permission);
}

// Cache permissions by role (not by user)
async function getPermissionsForRoles(roleIds: string[]): Promise<string[]> {
  const cached = await redis.get(\`roles:\${roleIds.sort().join(',')}\`);
  if (cached) return JSON.parse(cached);

  const permissions = await db.getPermissionsForRoles(roleIds);
  await redis.setex(\`roles:\${roleIds.sort().join(',')}\`, 300, JSON.stringify(permissions));
  return permissions;
}`,
			},
			{
				lang: "typescript",
				description: "Alternative: Use permission hashes for quick client checks",
				code: `// For client-side permission checks without exposing full list
function generateToken(user: User): string {
  const permissions = user.getAllPermissions();

  return jwt.sign({
    sub: user.id,
    email: user.email,
    roles: user.roles.map(r => r.id),
    // Bloom filter or hash for client-side hints only
    permissionHash: hashPermissions(permissions),
    // Permission count for debugging
    permissionCount: permissions.length,
    iat: Date.now(),
    exp: Date.now() + 86400000
  }, SECRET_KEY);
}

// Client uses hash for UI hints, server does real authorization
function clientCanShow(action: string, token: JWTPayload): boolean {
  // Quick hint for UI - not authoritative!
  return checkBloomFilter(token.permissionHash, action);
}`,
			},
		],
		prevention: [
			"Keep JWT payloads minimal - identity only, not authorization data",
			"Store permissions server-side with caching (Redis/memcached)",
			"Set alerts on JWT token size - warn if exceeding 2KB",
			"Test auth flows with power users (many roles/permissions) before release",
			"Consider session tokens for high-permission scenarios",
			"Document and enforce header size limits across all infrastructure components",
			"Use role IDs in tokens, not expanded permissions",
		],
		educationalInsights: [
			"JWTs are for identity, not for carrying application state",
			"Stateless auth (JWT) trades server storage for network overhead",
			"HTTP header limits exist at every hop: proxy, LB, CDN, server",
			"Base64 encoding adds ~33% overhead to JWT payload size",
			"Permission systems grow over time - design for scale from the start",
			"Different platforms may need different auth strategies (web vs mobile)",
		],
	},
};

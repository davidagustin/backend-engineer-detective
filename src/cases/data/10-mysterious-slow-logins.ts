import type { DetectiveCase } from "../../types";

export const mysteriousSlowLogins: DetectiveCase = {
	id: "mysterious-slow-logins",
	title: "The Mysterious Slow Logins",
	subtitle: "Login takes 30 seconds but only for some users",
	difficulty: "mid",
	category: "database",

	crisis: {
		description:
			"Some users are experiencing 30+ second login times. Most users login in under 1 second. There's no obvious pattern - affected users have various account types, devices, and locations.",
		impact:
			"5-10% of login attempts taking 30+ seconds. User complaints increasing. Some users giving up and not logging in.",
		timeline: [
			{ time: "Week 1", event: "Feature launched: username search", type: "normal" },
			{ time: "Week 2", event: "First slow login reports", type: "warning" },
			{ time: "Week 3", event: "Reports increasing with user growth", type: "warning" },
			{ time: "Week 4", event: "Database CPU spikes during logins", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Most logins complete in <1 second",
			"Password verification is fast",
			"Session creation is fast",
			"Users with standard usernames login quickly",
		],
		broken: [
			"Some users take 30+ seconds to login",
			"Database CPU spikes during slow logins",
			"Slow logins block other operations",
			"Pattern unclear - not tied to device or location",
		],
	},

	clues: [
		{
			id: 1,
			title: "Login Service Code",
			type: "code",
			content: `\`\`\`typescript
class LoginService {
  async login(identifier: string, password: string): Promise<Session> {
    // Support login by email OR username
    const user = await this.findUser(identifier);

    if (!user) {
      throw new AuthError('Invalid credentials');
    }

    const valid = await this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid credentials');
    }

    return this.createSession(user);
  }

  private async findUser(identifier: string): Promise<User | null> {
    // Check if identifier is an email
    if (identifier.includes('@')) {
      return this.userRepository.findByEmail(identifier);
    }

    // Otherwise, search by username
    return this.userRepository.findByUsername(identifier);
  }
}
\`\`\``,
		},
		{
			id: 2,
			title: "User Repository Code",
			type: "code",
			content: `\`\`\`typescript
class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.query(
      'SELECT * FROM users WHERE email = ?',
      [email.toLowerCase()]
    );
    return result[0] || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    // Support partial matching for convenience
    const result = await this.db.query(
      'SELECT * FROM users WHERE username LIKE ?',
      [username]
    );
    return result[0] || null;
  }
}
\`\`\``,
			hint: "Compare the two query methods carefully...",
		},
		{
			id: 3,
			title: "Database Indexes",
			type: "config",
			content: `\`\`\`sql
-- Indexes on users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_created ON users(created_at);

-- Query explain for email lookup
EXPLAIN SELECT * FROM users WHERE email = 'john@example.com';
-- Uses idx_users_email, scans 1 row

-- Query explain for username lookup
EXPLAIN SELECT * FROM users WHERE username LIKE 'johndoe';
-- Uses idx_users_username, scans 1 row  (exact match)

EXPLAIN SELECT * FROM users WHERE username LIKE '%john%';
-- FULL TABLE SCAN, scans 2,847,293 rows
\`\`\``,
		},
		{
			id: 4,
			title: "Slow Query Logs",
			type: "logs",
			content: `\`\`\`
[SLOW QUERY] 34.2s
  SELECT * FROM users WHERE username LIKE '%gaming_pro%'
  Rows examined: 2,847,293

[SLOW QUERY] 28.7s
  SELECT * FROM users WHERE username LIKE '%x_warrior%'
  Rows examined: 2,847,293

[SLOW QUERY] 31.5s
  SELECT * FROM users WHERE username LIKE '%dark_knight%'
  Rows examined: 2,847,293
\`\`\``,
			hint: "Notice anything about these usernames?",
		},
		{
			id: 5,
			title: "Affected Username Patterns",
			type: "metrics",
			content: `\`\`\`
Users with fast logins (samples):
- john123
- player_one
- gamer2024

Users with slow logins (samples):
- _shadow_
- x_warrior_x
- __test__
- _pro_gamer_

Pattern: Usernames starting with underscore or special characters
\`\`\``,
		},
		{
			id: 6,
			title: "Password Input Investigation",
			type: "logs",
			content: `\`\`\`
Debug: Login attempt
  identifier: "_shadow_warrior_"
  identifier.includes('@'): false
  Query: SELECT * FROM users WHERE username LIKE '_shadow_warrior_'

SQL LIKE pattern interpretation:
  _ = matches any single character
  % = matches any sequence of characters

'_shadow_warrior_' as a LIKE pattern means:
  (any char)shadow(any char)warrior(any char)

This matches usernames like:
  1shadow2warrior3
  ashadowbwarriorc
  xshadowywarriorm
  ... and potentially millions more
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Usernames with underscores are interpreted as SQL LIKE wildcards, causing full table scans",
		keywords: [
			"sql like",
			"wildcard",
			"underscore",
			"full table scan",
			"like pattern",
			"escape",
			"sql injection",
			"special characters",
		],
		rootCause: `The findByUsername method uses SQL LIKE without escaping special characters.

In SQL LIKE patterns:
- \`_\` matches any single character
- \`%\` matches any sequence of characters

When a user with username "_shadow_warrior_" logs in:
1. The query becomes: \`WHERE username LIKE '_shadow_warrior_'\`
2. SQL interprets the underscores as wildcards
3. The pattern matches any 16-character username with 'shadow' and 'warrior' in the right positions
4. The index can't be used because the pattern starts with a wildcard
5. Full table scan of 2.8 million users

Even if the pattern doesn't match any other users, the database still has to scan every row to check.

Users with "normal" usernames like "john123" don't trigger this because there are no special characters to misinterpret.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Escape LIKE special characters",
				code: `class UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    // Escape LIKE wildcards
    const escapedUsername = username
      .replace(/\\\\/g, '\\\\\\\\')  // Escape backslashes first
      .replace(/%/g, '\\\\%')
      .replace(/_/g, '\\\\_');

    const result = await this.db.query(
      "SELECT * FROM users WHERE username LIKE ? ESCAPE '\\\\'",
      [escapedUsername]
    );
    return result[0] || null;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Better: Use exact match instead of LIKE",
				code: `class UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    // Don't use LIKE for exact lookups!
    const result = await this.db.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return result[0] || null;
  }

  // If you need partial matching, use a separate method
  async searchUsernames(pattern: string): Promise<User[]> {
    const escapedPattern = this.escapeLikePattern(pattern);
    const result = await this.db.query(
      "SELECT * FROM users WHERE username LIKE ? ESCAPE '\\\\'",
      [\`%\${escapedPattern}%\`]
    );
    return result;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Use parameterized queries with proper types",
				code: `class UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    // Most ORMs handle this correctly
    const user = await this.prisma.user.findUnique({
      where: { username: username }
    });
    return user;
  }

  // Or with TypeORM
  async findByUsernameTypeORM(username: string): Promise<User | null> {
    return this.userRepo.findOneBy({ username });
  }
}`,
			},
		],
		prevention: [
			"Never use LIKE for exact matches - use = instead",
			"Always escape LIKE special characters when LIKE is needed",
			"Use an ORM that handles escaping automatically",
			"Add query execution time alerts to catch full table scans",
			"Review database queries in code review for LIKE misuse",
			"Test login with usernames containing special characters",
		],
		educationalInsights: [
			"LIKE wildcards are a form of SQL injection if not escaped",
			"Underscore in LIKE is often forgotten - everyone knows about %",
			"Full table scans can lock the database for other operations",
			"Index usage depends on the query pattern, not just index existence",
			"'It works for most users' often hides input-dependent bugs",
			"Performance issues that affect only some users often indicate input handling bugs",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const phantomFriendRequests: DetectiveCase = {
	id: "phantom-friend-requests",
	title: "The Phantom Friend Requests",
	subtitle: "Users see their own profile in friend suggestions",
	difficulty: "junior",
	category: "database",

	crisis: {
		description:
			"Users are seeing themselves in the 'People You May Know' suggestions. They can even send friend requests to themselves, which creates weird database states.",
		impact:
			"Users confused and amused. Some users have 'friended themselves'. Social features looking unprofessional. Memes being made about the bug.",
		timeline: [
			{ time: "Day 1", event: "New friend suggestion algorithm launched", type: "normal" },
			{ time: "Day 2", event: "First screenshot of self-suggestion shared", type: "warning" },
			{ time: "Day 3", event: "Bug going viral on social media", type: "critical" },
			{ time: "Day 4", event: "PR team asking for ETA on fix", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Friend suggestions show other users",
			"Most suggestions are relevant",
			"Friend request flow works",
			"Existing friends don't appear",
		],
		broken: [
			"Users see themselves in suggestions",
			"Can send self friend requests",
			"Self-friend creates orphan records",
			"Suggestions sometimes mostly self-entries",
		],
	},

	clues: [
		{
			id: 1,
			title: "Friend Suggestion Query",
			type: "code",
			content: `\`\`\`typescript
class FriendSuggestionService {
  async getSuggestions(userId: string): Promise<User[]> {
    const result = await this.db.query(\`
      SELECT u.*
      FROM users u
      WHERE u.id NOT IN (
        -- Exclude existing friends
        SELECT friend_id FROM friendships
        WHERE user_id = ?
      )
      AND u.id NOT IN (
        -- Exclude pending requests
        SELECT to_user_id FROM friend_requests
        WHERE from_user_id = ?
      )
      ORDER BY (
        -- Score by mutual friends count
        SELECT COUNT(*) FROM friendships f1
        JOIN friendships f2 ON f1.friend_id = f2.user_id
        WHERE f1.user_id = ? AND f2.friend_id = u.id
      ) DESC
      LIMIT 10
    \`, [userId, userId, userId]);

    return result;
  }
}
\`\`\``,
			hint: "What users are being excluded from the results?",
		},
		{
			id: 2,
			title: "Database Query Analysis",
			type: "logs",
			content: `\`\`\`sql
-- For user_id = 'user123'
-- Checking the NOT IN subqueries:

SELECT friend_id FROM friendships WHERE user_id = 'user123';
-- Returns: ['user456', 'user789']

SELECT to_user_id FROM friend_requests WHERE from_user_id = 'user123';
-- Returns: ['user234']

-- So we exclude: user456, user789, user234
-- But user123 (self) is NOT excluded!
\`\`\``,
		},
		{
			id: 3,
			title: "Sample Query Results",
			type: "logs",
			content: `\`\`\`
Query: getSuggestions('user123')
Results:
  1. user123 (mutual friends: 5) -- THIS IS SELF!
  2. user555 (mutual friends: 3)
  3. user666 (mutual friends: 2)
  4. user777 (mutual friends: 2)
  5. user888 (mutual friends: 1)
  ...

User123 has 5 mutual friends with themselves
(because all their friends are mutual with themselves)
\`\`\``,
			hint: "Why does the user have high mutual friend count with themselves?",
		},
		{
			id: 4,
			title: "Mutual Friends Calculation",
			type: "code",
			content: `\`\`\`sql
-- How mutual friends are calculated for user123 suggesting user123:
SELECT COUNT(*) FROM friendships f1
JOIN friendships f2 ON f1.friend_id = f2.user_id
WHERE f1.user_id = 'user123'   -- user123's friends
  AND f2.friend_id = 'user123' -- who are friends with user123

-- This counts: "friends of user123 who are also friends with user123"
-- Which is: ALL of user123's friends (they're all friends with user123)
-- Result: 5 (all 5 friends)

-- So user123 always has the MOST "mutual friends" with themselves!
\`\`\``,
		},
		{
			id: 5,
			title: "Self-Friendship Records",
			type: "logs",
			content: `\`\`\`sql
-- Some users managed to friend themselves before we noticed
SELECT * FROM friendships WHERE user_id = friend_id;

user_id   | friend_id | created_at
----------|-----------|----------------------
user847   | user847   | 2024-01-16 14:23:45
user923   | user923   | 2024-01-16 15:02:11
user156   | user156   | 2024-01-16 15:45:33
... (47 more rows)
\`\`\``,
		},
		{
			id: 6,
			title: "Product Manager Statement",
			type: "testimony",
			content: `"The old suggestion algorithm had a simple filter for this. When we rewrote it for performance, we removed the old code and wrote fresh SQL. I guess we forgot to add the self-exclusion check. It's embarrassing but at least it's not a security issue."`,
		},
	],

	solution: {
		diagnosis: "Friend suggestion query doesn't exclude the requesting user's own ID from results",
		keywords: [
			"self exclusion",
			"self reference",
			"own id",
			"where clause",
			"filter",
			"exclude self",
			"same user",
		],
		rootCause: `The friend suggestion query excludes:
1. Existing friends (via NOT IN subquery)
2. Pending friend requests (via NOT IN subquery)

But it does NOT exclude the user themselves!

Since the mutual friend calculation counts "friends of X who are friends with candidate", and all of user123's friends are friends with user123, user123 always has the maximum possible "mutual friends" score with themselves.

This means the user often appears at the TOP of their own suggestions, making the bug highly visible.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Add self-exclusion to the query",
				code: `class FriendSuggestionService {
  async getSuggestions(userId: string): Promise<User[]> {
    const result = await this.db.query(\`
      SELECT u.*
      FROM users u
      WHERE u.id != ?   -- ADD THIS LINE: Exclude self!
      AND u.id NOT IN (
        SELECT friend_id FROM friendships
        WHERE user_id = ?
      )
      AND u.id NOT IN (
        SELECT to_user_id FROM friend_requests
        WHERE from_user_id = ?
      )
      ORDER BY (
        SELECT COUNT(*) FROM friendships f1
        JOIN friendships f2 ON f1.friend_id = f2.user_id
        WHERE f1.user_id = ? AND f2.friend_id = u.id
      ) DESC
      LIMIT 10
    \`, [userId, userId, userId, userId]);  // Note: added one more userId param

    return result;
  }
}`,
			},
			{
				lang: "sql",
				description: "Add database constraint to prevent self-friendships",
				code: `-- Prevent self-friendships at the database level
ALTER TABLE friendships
ADD CONSTRAINT no_self_friendship
CHECK (user_id != friend_id);

-- Also prevent self-friend-requests
ALTER TABLE friend_requests
ADD CONSTRAINT no_self_request
CHECK (from_user_id != to_user_id);`,
			},
			{
				lang: "typescript",
				description: "Clean up existing self-friendship records",
				code: `async function cleanupSelfFriendships(): Promise<void> {
  // Find and delete self-friendships
  const deleted = await db.query(\`
    DELETE FROM friendships
    WHERE user_id = friend_id
    RETURNING *
  \`);

  console.log(\`Deleted \${deleted.length} self-friendship records\`);

  // Also clean up any self friend requests
  await db.query(\`
    DELETE FROM friend_requests
    WHERE from_user_id = to_user_id
  \`);
}`,
			},
		],
		prevention: [
			"Always consider self-reference cases when writing queries involving user IDs",
			"Add database CHECK constraints to prevent impossible states",
			"Include edge case tests: self-reference, empty results, boundary conditions",
			"Code review checklist: 'Are we excluding the current user where appropriate?'",
			"When rewriting features, review the old code for implicit assumptions",
		],
		educationalInsights: [
			"Self-reference bugs are common when rewriting features",
			"The most visible bugs (appearing at top of list) are often simple oversights",
			"Database constraints are your safety net for impossible states",
			"The 'mutual friends' calculation made this bug worse by scoring self highest",
			"Even 'obvious' exclusions need explicit code",
		],
	},
};

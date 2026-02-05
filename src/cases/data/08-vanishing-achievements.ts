import type { DetectiveCase } from "../../types";

export const vanishingAchievements: DetectiveCase = {
	id: "vanishing-achievements",
	title: "The Vanishing Achievements",
	subtitle: "Players earn achievements but they disappear after restart",
	difficulty: "junior",
	category: "caching",

	crisis: {
		description:
			"Players are unlocking achievements, seeing the celebration UI, but when they restart the game, the achievements are gone. The database shows the achievements were never saved.",
		impact:
			"Players losing hard-earned progress. Trust in the achievement system destroyed. Completionists rage-quitting. Negative reviews mentioning 'broken achievements'.",
		timeline: [
			{ time: "Week 1", event: "New achievement system launched", type: "normal" },
			{ time: "Week 1 Day 3", event: "First reports of missing achievements", type: "warning" },
			{ time: "Week 2", event: "100+ reports, pattern unclear", type: "warning" },
			{ time: "Week 3", event: "Community outrage, feature being called broken", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Achievement unlock animation plays",
			"Achievement appears in UI immediately",
			"Some achievements persist correctly",
			"Database write operations succeed (no errors)",
		],
		broken: [
			"Achievements gone after game restart",
			"Database shows achievement not saved",
			"Same achievement unlockable repeatedly",
			"Only certain achievements affected",
		],
	},

	clues: [
		{
			id: 1,
			title: "Achievement Service Code",
			type: "code",
			content: `\`\`\`typescript
class AchievementService {
  private cache: Cache;
  private db: Database;

  async unlockAchievement(userId: string, achievementId: string): Promise<void> {
    // Check if already unlocked (cache first)
    const cacheKey = \`achievements:\${oduserId}\`;
    const cached = await this.cache.get(cacheKey);

    if (cached && cached.includes(achievementId)) {
      return; // Already unlocked
    }

    // Unlock in database
    await this.db.query(
      'INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, NOW())',
      [userId, achievementId]
    );

    // Update cache
    const updatedList = cached ? [...cached, achievementId] : [achievementId];
    await this.cache.set(cacheKey, updatedList, 3600); // 1 hour TTL
  }

  async getAchievements(userId: string): Promise<string[]> {
    const cacheKey = \`achievements:\${oduserId}\`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.db.query(
      'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
      [userId]
    );

    const achievements = result.map(r => r.achievement_id);
    await this.cache.set(cacheKey, achievements, 3600);

    return achievements;
  }
}
\`\`\``,
			hint: "Look very carefully at the cache keys...",
		},
		{
			id: 2,
			title: "Sample User Reports",
			type: "testimony",
			content: `User A: "I unlocked 'First Blood' and saw the popup. Next day it was gone."
User B: "My 'Speed Demon' achievement keeps resetting. I've unlocked it 3 times now."
User C: "Weird, my 'Welcome' achievement from the tutorial stayed, but everything else disappears."
User D: "All my story achievements work fine, but multiplayer achievements vanish."`,
		},
		{
			id: 3,
			title: "Database Query",
			type: "logs",
			content: `\`\`\`sql
-- Checking User A's achievements
SELECT * FROM user_achievements WHERE user_id = 'user_A_123';

-- Results:
-- (empty - no achievements in database)

-- But the achievement unlock log shows:
SELECT * FROM achievement_unlock_log WHERE user_id = 'user_A_123';

-- Results:
-- user_id      | achievement_id | timestamp
-- user_A_123   | first_blood    | 2024-01-10 14:23:45
-- user_A_123   | first_blood    | 2024-01-11 09:15:22
-- user_A_123   | first_blood    | 2024-01-12 18:45:33
\`\`\``,
			hint: "The unlock log shows it was attempted multiple times, but it's not in the achievements table...",
		},
		{
			id: 4,
			title: "Cache Key Debug Output",
			type: "logs",
			content: `\`\`\`
Debug: AchievementService.unlockAchievement called
  userId: "user_A_123"
  achievementId: "first_blood"
  cacheKey: "achievements:undefined"  ← WAIT WHAT?
  cached: null

Debug: Inserting into database...
  SQL: INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ('user_A_123', 'first_blood')

Debug: Updating cache...
  key: "achievements:undefined"
  value: ["first_blood"]
\`\`\``,
		},
		{
			id: 5,
			title: "Variable Name Analysis",
			type: "code",
			content: `\`\`\`typescript
// In unlockAchievement and getAchievements:
const cacheKey = \`achievements:\${oduserId}\`;  // ← Typo!

// Should be:
const cacheKey = \`achievements:\${userId}\`;  // ← Correct

// "oduserId" is undefined, so all cache keys become:
// "achievements:undefined"
\`\`\``,
		},
		{
			id: 6,
			title: "Why Some Achievements Work",
			type: "testimony",
			content: `"The 'Welcome' achievement from the tutorial is unlocked through a different code path. It uses an older version of the achievement service that doesn't have this bug. Story achievements also use that older path. Only the new multiplayer achievements and challenge achievements go through the new AchievementService."`,
		},
	],

	solution: {
		diagnosis: "Typo in cache key variable name (oduserId instead of userId) causes all users to share the same cache key",
		keywords: [
			"typo",
			"cache key",
			"variable name",
			"undefined",
			"wrong key",
			"spelling",
			"oduserId",
			"userId",
		],
		rootCause: `A simple typo in the cache key template: \`oduserId\` instead of \`userId\`.

This causes the cache key to be \`achievements:undefined\` for ALL users, since \`oduserId\` is not defined.

The flow:
1. User A unlocks "first_blood"
2. Cache key is "achievements:undefined"
3. Insert to DB succeeds with correct user_id
4. Cache set for "achievements:undefined" = ["first_blood"]
5. User B tries to unlock "first_blood"
6. Cache check for "achievements:undefined" returns ["first_blood"]
7. Function returns early - "already unlocked"
8. User B never gets the achievement in the database
9. User A's cache expires after 1 hour
10. User A restarts game, getAchievements called
11. Cache miss on "achievements:undefined"
12. Database query for User A's achievements returns their DB records
13. But wait - the cache in step 4 was never for the right user, so DB inserts were inconsistent

Even worse: sometimes the insert succeeds, sometimes the "already unlocked" check prevents it, depending on cache state for the global "undefined" key.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed code with correct variable name",
				code: `class AchievementService {
  private cache: Cache;
  private db: Database;

  async unlockAchievement(userId: string, achievementId: string): Promise<void> {
    const cacheKey = \`achievements:\${userId}\`;  // Fixed typo!
    const cached = await this.cache.get(cacheKey);

    if (cached && cached.includes(achievementId)) {
      return;
    }

    await this.db.query(
      'INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, NOW())',
      [userId, achievementId]
    );

    const updatedList = cached ? [...cached, achievementId] : [achievementId];
    await this.cache.set(cacheKey, updatedList, 3600);
  }

  async getAchievements(userId: string): Promise<string[]> {
    const cacheKey = \`achievements:\${userId}\`;  // Fixed typo!
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.db.query(
      'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
      [userId]
    );

    const achievements = result.map(r => r.achievement_id);
    await this.cache.set(cacheKey, achievements, 3600);

    return achievements;
  }
}`,
			},
			{
				lang: "typescript",
				description: "Better: Use a helper function for cache keys",
				code: `class AchievementService {
  private getCacheKey(userId: string): string {
    if (!userId) {
      throw new Error('userId is required for cache key');
    }
    return \`achievements:\${userId}\`;
  }

  async unlockAchievement(userId: string, achievementId: string): Promise<void> {
    const cacheKey = this.getCacheKey(userId);
    // ... rest of the logic
  }

  async getAchievements(userId: string): Promise<string[]> {
    const cacheKey = this.getCacheKey(userId);
    // ... rest of the logic
  }
}`,
			},
			{
				lang: "typescript",
				description: "Add ESLint rule to catch unused variables",
				code: `// .eslintrc.js
module.exports = {
  rules: {
    // This would catch the bug: userId is defined but never used
    '@typescript-eslint/no-unused-vars': 'error',

    // Stricter: treat undefined template literals as errors
    '@typescript-eslint/no-base-to-string': 'error',
  }
};

// With proper TypeScript strict mode, template literals with
// undefined would also generate warnings/errors`,
			},
		],
		prevention: [
			"Use TypeScript strict mode to catch undefined access",
			"Enable ESLint rules for unused variables",
			"Write unit tests that verify cache keys are unique per user",
			"Add validation that cache keys don't contain 'undefined' or 'null'",
			"Use helper functions for cache key generation with validation",
			"Code review focus on string interpolation in cache/database keys",
		],
		educationalInsights: [
			"Typos in variable names can cause extremely subtle bugs",
			"When multiple users share a cache key, you get data corruption",
			"JavaScript's undefined in template strings becomes the string 'undefined'",
			"Tests that only check 'it works for one user' miss multi-user bugs",
			"The symptoms (inconsistent behavior) point to shared state problems",
			"When some features work and others don't, check what's different in the code paths",
		],
	},
};

import { DetectiveCase } from '../../types';

export const featureFlagFiasco: DetectiveCase = {
  id: 'feature-flag-fiasco',
  title: 'The Feature Flag Fiasco',
  subtitle: '10% rollout affects 80% of revenue',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your team is rolling out a new checkout flow using feature flags. It's set to
      10% of users for a cautious rollout. After 2 hours, revenue has dropped 40%.
      The new checkout has a bug, but it should only affect 10% of users. Why is
      the revenue impact so severe?
    `,
    impact: `
      Revenue down 40% ($200K/hour loss) despite only 10% flag rollout.
      Engineering on-call scrambling to understand the math.
    `,
    timeline: [
      { time: '9:00 AM', event: 'Enabled new checkout for 10% of users', type: 'normal' },
      { time: '9:30 AM', event: 'Support tickets about checkout errors', type: 'warning' },
      { time: '10:00 AM', event: 'Revenue metrics show 15% drop', type: 'warning' },
      { time: '11:00 AM', event: 'Revenue down 40%, flag still at 10%', type: 'critical' },
      { time: '11:15 AM', event: 'Disabled flag, revenue recovering', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Feature flag SDK reports 10% rollout correctly',
      'Error rate is ~10% of checkout attempts (matching flag %)',
      'Users outside the flag experience no issues',
      'Flag targeting is working as configured'
    ],
    broken: [
      'Revenue impact far exceeds 10%',
      'High-value customers disproportionately affected',
      'Same users consistently get the broken experience',
      'Business impact doesn\'t match technical metrics'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Feature Flag Configuration',
      type: 'config',
      content: `
\`\`\`json
{
  "flag": "new_checkout_flow",
  "enabled": true,
  "rolloutPercentage": 10,
  "strategy": "user_id_hash",
  "hashAttribute": "user_id",
  "description": "Consistent experience: same user always gets same variant"
}
\`\`\`

**How it works:**
\`hash(user_id) % 100 < 10\` → new checkout
\`hash(user_id) % 100 >= 10\` → old checkout
      `,
      hint: 'The hash is deterministic based on user_id...'
    },
    {
      id: 2,
      title: 'Revenue Distribution Analysis',
      type: 'metrics',
      content: `
## User Segments by Revenue Contribution

| User ID Range | % of Users | % of Revenue | Avg Order Value |
|---------------|------------|--------------|-----------------|
| 1 - 99,999 | 8% | 45% | $350 |
| 100,000 - 499,999 | 22% | 35% | $100 |
| 500,000 - 2,000,000 | 70% | 20% | $18 |

**Note:** User IDs are assigned sequentially at signup.
Early users (low IDs) are power users with high lifetime value.
      `,
      hint: 'Low user IDs = early adopters = highest value customers'
    },
    {
      id: 3,
      title: 'Hash Function Analysis',
      type: 'code',
      content: `
\`\`\`javascript
// Flag evaluation in SDK
function isEnabled(userId, rolloutPercentage) {
  const hash = simpleHash(userId.toString());
  const bucket = hash % 100;
  return bucket < rolloutPercentage;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Test runs:
// simpleHash("1") % 100 = 4     ✓ in 10%
// simpleHash("2") % 100 = 7     ✓ in 10%
// simpleHash("42") % 100 = 3    ✓ in 10%
// simpleHash("100") % 100 = 12  ✗ not in 10%
// simpleHash("1000") % 100 = 15 ✗ not in 10%
// simpleHash("50000") % 100 = 67 ✗ not in 10%
\`\`\`
      `,
      hint: 'Short strings (low user IDs) hash to low values...'
    },
    {
      id: 4,
      title: 'Flag Exposure by User Segment',
      type: 'metrics',
      content: `
## Actual Flag Exposure by User Segment

| User ID Range | Expected Exposure | Actual Exposure |
|---------------|-------------------|-----------------|
| 1 - 99,999 | 10% | 78% |
| 100,000 - 499,999 | 10% | 23% |
| 500,000 - 2,000,000 | 10% | 4% |

**Overall weighted by user count:** 10.2% (looks correct!)
**Weighted by revenue:** 48% (!!)
      `,
      hint: 'The hash isn\'t uniformly distributed across user ID ranges'
    },
    {
      id: 5,
      title: 'Data Scientist Testimony',
      type: 'testimony',
      content: `
> "The hash function is biased! Short strings tend to produce small hash values.
> User IDs like '1', '42', '999' all hash to values under 20. User IDs like
> '1500000' hash to larger values."
>
> "We're not getting 10% of random users—we're getting almost all users with
> short IDs, which happen to be our oldest, most valuable customers."
>
> — Dr. Kim, Data Science
      `,
      hint: 'The hash function has poor distribution for sequential numeric strings'
    },
    {
      id: 6,
      title: 'Industry Best Practices Doc',
      type: 'config',
      content: `
\`\`\`markdown
# Feature Flag Hashing Best Practices

## Problem: Non-uniform Hash Distribution
Simple hash functions can have biases, especially with:
- Sequential numeric IDs
- Short strings
- Predictable patterns

## Solutions:

1. **Use a cryptographic hash** (SHA-256, MD5):
   - Uniformly distributed output
   - No correlation with input patterns

2. **Add salt to prevent patterns**:
   - hash(userId + flagName + salt)

3. **Use established libraries**:
   - LaunchDarkly, Split, Unleash handle this correctly

4. **Test distribution before rollout**:
   - Simulate hash distribution across real user ID sample
   - Verify each segment gets expected percentage
\`\`\`
      `,
      hint: 'Cryptographic hashes solve the distribution problem'
    }
  ],

  solution: {
    diagnosis: 'Hash function bias causes low user IDs (highest value customers) to be over-represented in rollout',

    keywords: [
      'hash', 'bias', 'distribution', 'feature flag', 'rollout',
      'user id', 'sequential', 'percentage', 'uniform',
      'cryptographic', 'sha256'
    ],

    rootCause: `
      The feature flag SDK uses a simple hash function to determine which users
      see the new feature. This hash has a bias: short strings (like "1", "42",
      "999") tend to produce small hash values, while long strings produce
      larger values.

      User IDs are assigned sequentially, so:
      - Low user IDs (early adopters, power users) = short strings = small hashes
      - High user IDs (new users, casual users) = long strings = large hashes

      A "10% rollout" (hash % 100 < 10) captures 78% of your most valuable users
      but only 4% of casual users. The bug in the new checkout disproportionately
      affects your highest-revenue customers, causing 40% revenue impact from a
      "10%" rollout.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Problematic simple hash',
        code: `// DON'T DO THIS
function isEnabled(userId, rolloutPercentage) {
  // Simple string hash - biased distribution!
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
  }
  return Math.abs(hash) % 100 < rolloutPercentage;
}`
      },
      {
        lang: 'javascript',
        description: 'Fixed with cryptographic hash',
        code: `const crypto = require('crypto');

function isEnabled(userId, flagName, rolloutPercentage) {
  // SHA-256 provides uniform distribution
  const input = \`\${flagName}:\${userId}\`;
  const hash = crypto.createHash('sha256').update(input).digest();

  // Use first 4 bytes as unsigned integer
  const value = hash.readUInt32BE(0);

  // Normalize to 0-99 range
  const bucket = value % 100;

  return bucket < rolloutPercentage;
}

// Now distribution is uniform regardless of user ID length`
      },
      {
        lang: 'javascript',
        description: 'Test distribution before rollout',
        code: `// Always verify distribution before enabling a flag!
function testFlagDistribution(userIds, flagName, targetPercent) {
  let enabled = 0;
  const bySegment = {};

  for (const userId of userIds) {
    const segment = getSegment(userId); // e.g., "high_value", "medium", "low"
    bySegment[segment] = bySegment[segment] || { total: 0, enabled: 0 };
    bySegment[segment].total++;

    if (isEnabled(userId, flagName, targetPercent)) {
      enabled++;
      bySegment[segment].enabled++;
    }
  }

  console.log(\`Overall: \${(enabled / userIds.length * 100).toFixed(1)}%\`);
  for (const [segment, data] of Object.entries(bySegment)) {
    const pct = (data.enabled / data.total * 100).toFixed(1);
    console.log(\`\${segment}: \${pct}% (expected: \${targetPercent}%)\`);
  }
}`
      }
    ],

    prevention: [
      'Always use cryptographic hashes (SHA-256) for feature flag bucketing',
      'Include flag name in hash input to prevent cross-flag correlation',
      'Test distribution across user segments before rollout',
      'Monitor business metrics (revenue, not just error rate) during rollouts',
      'Use established feature flag services that handle hashing correctly',
      'Consider stratified rollouts that explicitly sample from each segment'
    ],

    educationalInsights: [
      'Technical metrics (10% error rate) can hide business impact (40% revenue loss)',
      'Simple hash functions can have severe biases with predictable inputs',
      'Sequential numeric IDs create patterns that naive hashing preserves',
      'Early adopters are often your most valuable users—be extra careful with them',
      'Feature flag "percentage" only means uniform if the hash is uniform',
      'Always measure business outcomes, not just technical metrics'
    ]
  }
};

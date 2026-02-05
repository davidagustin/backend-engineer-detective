import type { DetectiveCase } from "../../types";

export const graphqlQueryComplexityAttack: DetectiveCase = {
	id: "graphql-query-complexity-attack",
	title: "The GraphQL Query Complexity Attack",
	subtitle: "DoS from deeply nested queries",
	difficulty: "senior",
	category: "auth",

	crisis: {
		description:
			"Your GraphQL API is being brought to its knees by a handful of requests. CPU usage spikes to 100%, response times go from milliseconds to minutes, and legitimate users can't access the service. The attack requests look like normal GraphQL queries.",
		impact:
			"Complete service outage for 2 hours. 100% of users affected. Revenue loss estimated at $50,000/hour. Attack bypassed rate limiting because it was only a few requests per minute.",
		timeline: [
			{ time: "3:00 PM", event: "CPU spikes to 100% across all API servers", type: "critical" },
			{ time: "3:01 PM", event: "Response times exceed 60 seconds", type: "critical" },
			{ time: "3:05 PM", event: "Health checks start failing, pods restarting", type: "critical" },
			{ time: "3:10 PM", event: "Source identified: 3 requests per minute from single IP", type: "warning" },
			{ time: "3:15 PM", event: "Queries blocked, service recovering", type: "normal" },
		],
	},

	symptoms: {
		working: [
			"Rate limiting shows requests within limits",
			"Authentication/authorization working",
			"Database not overloaded",
			"Network bandwidth normal",
		],
		broken: [
			"CPU at 100% from GraphQL resolution",
			"Memory usage spiking",
			"Only 3 requests per minute but server overwhelmed",
			"Query execution takes minutes instead of milliseconds",
		],
	},

	clues: [
		{
			id: 1,
			title: "The Malicious Query",
			type: "logs",
			content: `\`\`\`graphql
# Query received at 3:00:15 PM
query EvilQuery {
  users(first: 100) {
    friends(first: 100) {
      friends(first: 100) {
        friends(first: 100) {
          friends(first: 100) {
            id
            name
            email
            posts(first: 100) {
              comments(first: 100) {
                author {
                  friends(first: 100) {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
\`\`\``,
			hint: "Deeply nested query with large result sets at each level...",
		},
		{
			id: 2,
			title: "Complexity Calculation",
			type: "metrics",
			content: `\`\`\`
Query Complexity Analysis:

Level 1: users(100)                    = 100 nodes
Level 2: friends(100) x 100            = 10,000 nodes
Level 3: friends(100) x 10,000         = 1,000,000 nodes
Level 4: friends(100) x 1,000,000      = 100,000,000 nodes
Level 5: friends(100) x 100,000,000    = 10,000,000,000 nodes

Plus posts and comments at level 5...
Total potential nodes: ~10 BILLION

Even with DataLoader batching:
- Memory for result: ~100GB
- Database queries: millions
- CPU for resolution: hours

This is exponential explosion from multiplicative nesting.
\`\`\``,
		},
		{
			id: 3,
			title: "GraphQL Schema",
			type: "code",
			content: `\`\`\`graphql
# schema.graphql
type User {
  id: ID!
  name: String!
  email: String!
  friends(first: Int, after: String): UserConnection!
  posts(first: Int, after: String): PostConnection!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  comments(first: Int, after: String): CommentConnection!
}

type Comment {
  id: ID!
  text: String!
  author: User!  # Circular reference back to User
}

type Query {
  users(first: Int, after: String): UserConnection!
  user(id: ID!): User
}

# No depth limits, no complexity limits
# Circular references allow infinite nesting
\`\`\``,
			hint: "User -> friends -> User creates circular reference allowing infinite depth",
		},
		{
			id: 4,
			title: "Server Resource Logs",
			type: "logs",
			content: `\`\`\`
[3:00:15] Request started: query EvilQuery
[3:00:16] Resolving users (100 items)
[3:00:17] Resolving friends level 1 (10,000 items)
[3:00:25] Resolving friends level 2 (1,000,000 items)
[3:00:45] Memory usage: 8GB -> 12GB -> 16GB (limit: 16GB)
[3:01:00] OOMKilled: Container exceeded memory limit
[3:01:05] Pod restarting...

[3:01:10] New pod started
[3:01:15] Request from queue: query EvilQuery (same request, retried)
[3:01:20] Memory climbing again...
[3:01:45] OOMKilled: Container exceeded memory limit
[3:01:50] Pod restarting...

The single query keeps getting retried and killing pods!
\`\`\``,
		},
		{
			id: 5,
			title: "Rate Limiter Analysis",
			type: "metrics",
			content: `\`\`\`
Rate Limiting Status:

IP: 45.33.22.11
Requests in last minute: 3
Rate limit: 100 requests/minute
Status: ALLOWED ✓

Traditional rate limiting PASSED because:
- Only 3 HTTP requests
- But each request has 10 BILLION potential operations!

This is like checking how many letters someone mailed,
not how many pages were in each letter.
\`\`\``,
		},
		{
			id: 6,
			title: "Industry Best Practices Document",
			type: "config",
			content: `\`\`\`markdown
# GraphQL Security Best Practices

## Query Complexity Analysis
Assign complexity scores to fields:
- Scalar fields: 1
- Object fields: 1 + child complexity
- List fields: multiplier * child complexity

Set maximum allowed complexity per query.

## Depth Limiting
Set maximum query depth (e.g., 10 levels).
Reject queries exceeding depth before execution.

## Amount Limiting
Cap \`first\`/\`last\` arguments (e.g., max 100).
Reject queries requesting too many items.

## Query Cost Analysis
Estimate cost BEFORE execution based on:
- Field complexity
- Requested amounts
- Nesting depth

## Timeout Protection
Set per-query execution timeout.
Kill long-running queries.

## Persisted Queries
Only allow pre-approved queries in production.
Reject arbitrary queries from untrusted clients.
\`\`\``,
		},
	],

	solution: {
		diagnosis: "GraphQL API vulnerable to complexity attacks due to missing query depth limits, complexity analysis, and amount restrictions on nested fields",
		keywords: [
			"graphql",
			"complexity",
			"depth limit",
			"dos",
			"nested queries",
			"rate limiting",
			"persisted queries",
			"query cost",
			"exponential",
		],
		rootCause: `The root cause is missing query complexity protection in the GraphQL API.

GraphQL's flexibility is also its vulnerability:
1. **Circular References**: User -> friends -> User allows infinite nesting
2. **Multiplicative Nesting**: 100 x 100 x 100 x 100 = 100 million potential items
3. **No Depth Limits**: Queries can nest arbitrarily deep
4. **No Complexity Limits**: No pre-execution cost estimation
5. **Large Page Sizes**: \`first: 100\` at each level compounds exponentially

Traditional rate limiting failed because it counts HTTP requests, not query complexity. An attacker can:
- Send 1 request with complexity score of 10 billion
- Stay under request-per-minute limits
- Completely exhaust server resources

This is a Denial of Service (DoS) attack using legitimate API features. The query is syntactically valid - it's the resource consumption that's the problem.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Query depth limiting middleware",
				code: `// middleware/depthLimit.ts
import depthLimit from 'graphql-depth-limit';

const MAX_DEPTH = 7;

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

app.use('/graphql', graphqlHTTP({
  schema,
  validationRules: [
    depthLimit(MAX_DEPTH, { ignore: ['__schema', '__type'] }),
  ],
}));

// Rejects query if depth > 7:
// query { users { friends { friends { friends { friends { ... } } } } } }
//                ^1       ^2        ^3        ^4        ^5 = REJECTED at 7`,
			},
			{
				lang: "typescript",
				description: "Query complexity analysis",
				code: `// middleware/complexity.ts
import { getComplexity, simpleEstimator, fieldExtensionsEstimator } from 'graphql-query-complexity';

const MAX_COMPLEXITY = 10000;

app.use('/graphql', async (req, res, next) => {
  const query = req.body.query;

  const complexity = getComplexity({
    schema,
    query: parse(query),
    variables: req.body.variables,
    estimators: [
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 }),
    ],
  });

  if (complexity > MAX_COMPLEXITY) {
    return res.status(400).json({
      error: \`Query complexity \${complexity} exceeds maximum \${MAX_COMPLEXITY}\`,
    });
  }

  next();
});

// In schema, add complexity hints:
// type User {
//   friends(first: Int): [User!]! @complexity(multipliers: ["first"])
// }`,
			},
			{
				lang: "graphql",
				description: "Schema with built-in limits",
				code: `# schema.graphql with protection
type User {
  id: ID!
  name: String!
  email: String!

  # Limit page size and add complexity multiplier
  friends(
    first: Int = 10 @constraint(max: 50)
    after: String
  ): UserConnection! @complexity(multipliers: ["first"], value: 5)

  posts(
    first: Int = 10 @constraint(max: 25)
    after: String
  ): PostConnection! @complexity(multipliers: ["first"], value: 3)
}

# Directive definitions
directive @constraint(max: Int!) on ARGUMENT_DEFINITION
directive @complexity(
  value: Int = 1
  multipliers: [String!]
) on FIELD_DEFINITION`,
			},
			{
				lang: "typescript",
				description: "Complete protection middleware",
				code: `// middleware/graphqlProtection.ts
import {
  createComplexityLimitRule
} from 'graphql-validation-complexity';

const protectionRules = [
  // Depth limit
  depthLimit(7),

  // Complexity limit with field costs
  createComplexityLimitRule(10000, {
    scalarCost: 1,
    objectCost: 2,
    listFactor: 10,  // Lists multiply child cost
    introspectionListFactor: 2,
  }),
];

// Query timeout
const QUERY_TIMEOUT_MS = 30000;

app.use('/graphql', graphqlHTTP({
  schema,
  validationRules: protectionRules,
  extensions: ({ document, variables, operationName, result }) => {
    // Log query complexity for monitoring
    const complexity = calculateComplexity(document, variables);
    logger.info({ operationName, complexity });
    return { complexity };
  },
  customExecuteFn: async (args) => {
    // Timeout protection
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Query timeout')), QUERY_TIMEOUT_MS);
    });

    return Promise.race([
      execute(args),
      timeout,
    ]);
  },
}));`,
			},
		],
		prevention: [
			"Implement query depth limiting (recommended: 7-10 levels)",
			"Add query complexity analysis with field costs",
			"Cap pagination arguments (first/last max 50-100)",
			"Set query execution timeouts (30 seconds)",
			"Use persisted queries in production (whitelist approach)",
			"Monitor and alert on high-complexity queries",
			"Add complexity to rate limiting (cost-based, not just count-based)",
			"Consider disabling introspection in production",
		],
		educationalInsights: [
			"GraphQL flexibility enables complexity attacks - protection is not optional",
			"Request count rate limiting is insufficient - need cost-based limiting",
			"Circular type references enable exponential query complexity",
			"Pre-execution complexity analysis prevents resource exhaustion",
			"Persisted queries provide strongest protection for known clients",
			"Introspection queries can also be used for reconnaissance attacks",
		],
	},
};

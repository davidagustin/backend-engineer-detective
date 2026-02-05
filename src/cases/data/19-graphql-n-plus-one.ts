import { DetectiveCase } from '../../types';

export const graphqlNPlusOne: DetectiveCase = {
  id: 'graphql-n-plus-one',
  title: 'The GraphQL Performance Nightmare',
  subtitle: 'Simple queries take 30 seconds on a fast database',
  difficulty: 'mid',
  category: 'database',

  crisis: {
    description: `
      Your social media app uses GraphQL. Users are complaining that the feed page
      takes forever to load. The GraphQL query is simple—just fetching 50 posts with
      their authors. But it's taking 30+ seconds. The database is fast, the network
      is fine, yet the API crawls.
    `,
    impact: `
      Feed page load time increased from 200ms to 30 seconds. User engagement
      dropped 60%. App store rating falling due to "slow app" reviews.
    `,
    timeline: [
      { time: 'Week 1', event: 'Launched new feed with nested author data', type: 'normal' },
      { time: 'Week 2', event: 'Users report slowness with large follower counts', type: 'warning' },
      { time: 'Week 3', event: 'P95 latency hits 15 seconds', type: 'warning' },
      { time: 'Week 4', event: 'Prominent user with 1M followers breaks the feed', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Database queries individually execute in <5ms',
      'Small accounts load feed quickly',
      'GraphQL schema is valid',
      'API response eventually returns correct data'
    ],
    broken: [
      'Feed takes 30+ seconds for users following many accounts',
      'CPU spikes during feed requests',
      'Database shows thousands of queries per feed request',
      'Problem gets worse with more posts/followers'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'The GraphQL Query',
      type: 'code',
      content: `
\`\`\`graphql
# Feed query used by the mobile app
query GetFeed($userId: ID!, $limit: Int!) {
  feed(userId: $userId, limit: $limit) {
    posts {
      id
      content
      createdAt
      author {
        id
        name
        avatarUrl
        followerCount
      }
      likes {
        user {
          id
          name
        }
      }
      comments(limit: 3) {
        id
        text
        author {
          id
          name
        }
      }
    }
  }
}
\`\`\`
      `,
      hint: 'Count the nested entities being requested...'
    },
    {
      id: 2,
      title: 'Database Query Log',
      type: 'logs',
      content: `
\`\`\`sql
-- Query log excerpt (1 of 2,847 queries for single feed request)

SELECT * FROM posts WHERE author_id IN (...) LIMIT 50;              -- 1 query
SELECT * FROM users WHERE id = 'u_123';                              -- 1 query
SELECT * FROM users WHERE id = 'u_456';                              -- 1 query
SELECT * FROM users WHERE id = 'u_789';                              -- 1 query
... (47 more individual user queries)
SELECT * FROM likes WHERE post_id = 'p_001';                         -- 1 query
SELECT * FROM users WHERE id = 'u_111';                              -- like author
SELECT * FROM users WHERE id = 'u_222';                              -- like author
... (hundreds more)
SELECT * FROM comments WHERE post_id = 'p_001' LIMIT 3;              -- 1 query
SELECT * FROM users WHERE id = 'u_333';                              -- comment author
...

Total queries: 2,847
Total time: 31,456ms
\`\`\`
      `,
      hint: 'Notice the pattern: 1 query per entity instead of batching'
    },
    {
      id: 3,
      title: 'GraphQL Resolver Code',
      type: 'code',
      content: `
\`\`\`javascript
// resolvers.js
const resolvers = {
  Query: {
    feed: async (_, { userId, limit }) => {
      const posts = await db.posts.findMany({
        where: { authorId: { in: followedIds } },
        take: limit
      });
      return { posts };
    }
  },

  Post: {
    author: async (post) => {
      return await db.users.findUnique({ where: { id: post.authorId } });
    },
    likes: async (post) => {
      return await db.likes.findMany({ where: { postId: post.id } });
    },
    comments: async (post, { limit }) => {
      return await db.comments.findMany({
        where: { postId: post.id },
        take: limit
      });
    }
  },

  Like: {
    user: async (like) => {
      return await db.users.findUnique({ where: { id: like.userId } });
    }
  },

  Comment: {
    author: async (comment) => {
      return await db.users.findUnique({ where: { id: comment.authorId } });
    }
  }
};
\`\`\`
      `,
      hint: 'Each resolver fetches data individually, even for the same user...'
    },
    {
      id: 4,
      title: 'Query Execution Analysis',
      type: 'metrics',
      content: `
## Query Breakdown (50 posts, avg 20 likes, 3 comments each)

| Entity Type | Count | Queries | Why |
|-------------|-------|---------|-----|
| Posts | 50 | 1 | Single batch fetch |
| Post Authors | 50 | 50 | 1 per post |
| Likes | ~1000 | 50 | 1 per post |
| Like Users | ~1000 | 1000 | 1 per like |
| Comments | 150 | 50 | 1 per post |
| Comment Authors | 150 | 150 | 1 per comment |
| **Total** | | **~1,301** | |

**Note:** Many users appear multiple times (same person likes multiple posts)
but we query them each time.
      `,
      hint: 'The same user might be fetched hundreds of times'
    },
    {
      id: 5,
      title: 'Backend Lead Testimony',
      type: 'testimony',
      content: `
> "We followed the GraphQL tutorial exactly. Each resolver fetches its own data,
> which is supposed to be the 'right way' to do it. The resolvers are clean and
> simple—each one does just one thing."
>
> "I heard about something called DataLoader but we didn't implement it because
> the resolvers were already working."
>
> — Alex, Backend Lead
      `,
      hint: 'DataLoader was mentioned...'
    },
    {
      id: 6,
      title: 'DataLoader Documentation',
      type: 'config',
      content: `
\`\`\`
# DataLoader - Batching and Caching for GraphQL

DataLoader provides:
1. BATCHING: Collects individual loads into a single batch request
2. CACHING: Deduplicates loads for the same key within a request

Without DataLoader:
  user(1), user(2), user(1), user(3), user(1)
  = 5 database queries

With DataLoader:
  user(1), user(2), user(1), user(3), user(1)
  = 1 database query: SELECT * FROM users WHERE id IN (1, 2, 3)
  + request-scoped cache returns user(1) from memory on repeats
\`\`\`
      `,
      hint: 'This is the solution to the N+1 problem'
    }
  ],

  solution: {
    diagnosis: 'N+1 query problem due to missing DataLoader batching',

    keywords: [
      'n+1', 'n plus one', 'dataloader', 'batching', 'graphql',
      'resolver', 'query', 'performance', 'nested',
      'database queries', 'caching'
    ],

    rootCause: `
      GraphQL's resolver architecture naturally leads to the N+1 problem.
      When you request 50 posts with authors, GraphQL executes:
      - 1 query to fetch 50 posts
      - 50 queries to fetch each post's author (even if the same author wrote multiple posts)

      This multiplies across nested fields. With likes and comments, a single feed
      request generates thousands of database queries.

      The solution is DataLoader, which:
      1. Batches: Collects all user IDs requested in a tick, then fetches them in one query
      2. Caches: Remembers fetched users so the same user isn't fetched twice per request
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Create DataLoader instances per request',
        code: `// loaders.js
const DataLoader = require('dataloader');

function createLoaders(db) {
  return {
    userLoader: new DataLoader(async (userIds) => {
      // Single query for all requested users
      const users = await db.users.findMany({
        where: { id: { in: userIds } }
      });
      // Return in same order as input IDs
      const userMap = new Map(users.map(u => [u.id, u]));
      return userIds.map(id => userMap.get(id));
    }),

    likesLoader: new DataLoader(async (postIds) => {
      const likes = await db.likes.findMany({
        where: { postId: { in: postIds } }
      });
      // Group by postId
      const likesByPost = groupBy(likes, 'postId');
      return postIds.map(id => likesByPost[id] || []);
    }),
  };
}`
      },
      {
        lang: 'javascript',
        description: 'Updated resolvers using DataLoader',
        code: `// resolvers.js
const resolvers = {
  Post: {
    // Before: direct DB call (N+1)
    // author: async (post) => db.users.findUnique({ where: { id: post.authorId } })

    // After: batched via DataLoader
    author: async (post, _, { loaders }) => {
      return loaders.userLoader.load(post.authorId);
    },
    likes: async (post, _, { loaders }) => {
      return loaders.likesLoader.load(post.id);
    }
  },

  Like: {
    user: async (like, _, { loaders }) => {
      // Same user appearing in 100 likes = 1 DB query total
      return loaders.userLoader.load(like.userId);
    }
  }
};`
      },
      {
        lang: 'javascript',
        description: 'Create fresh loaders per request (important!)',
        code: `// server.js
const { ApolloServer } = require('apollo-server');

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req }) => ({
    // IMPORTANT: Create new loaders for each request
    // This ensures caching is request-scoped, not global
    loaders: createLoaders(db),
    user: authenticateUser(req),
  }),
});`
      }
    ],

    prevention: [
      'Always use DataLoader in GraphQL APIs',
      'Create DataLoader instances per-request (not global) to avoid cache leaks',
      'Monitor database query count per GraphQL operation',
      'Use query complexity analysis to limit deeply nested queries',
      'Consider persisted queries for known query patterns',
      'Load test with realistic nested data before launch'
    ],

    educationalInsights: [
      'The N+1 problem: 1 query for parents + N queries for each child = N+1 total',
      'GraphQL\'s resolver-per-field model makes N+1 easy to create accidentally',
      'DataLoader batches loads that occur in the same tick of the event loop',
      'Request-scoped caching prevents one user from seeing another\'s cached data',
      'Query complexity scoring can reject expensive queries before execution',
      'This pattern applies to any nested data fetching, not just GraphQL'
    ]
  }
};

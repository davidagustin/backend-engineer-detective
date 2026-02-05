import type { DetectiveCase } from '../../types';

export const dockerLayerCacheInvalidation: DetectiveCase = {
  id: 'docker-layer-cache-invalidation',
  title: 'The Docker Cache Catastrophe',
  subtitle: 'Build times increased from 2 minutes to 20 minutes overnight',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `Your CI/CD pipeline Docker builds suddenly went from 2 minutes to 20 minutes. Nothing in the application code changed. The builds complete successfully but are now 10x slower, causing deployment delays and developer frustration.`,
    impact: `CI/CD pipeline throughput reduced by 80%. Deployments delayed by 18+ minutes. Developer feedback loop severely impacted. Queue of pending builds growing.`,
    timeline: [
      { time: 'Yesterday 5:00 PM', event: 'Normal build times (~2 minutes)', type: 'normal' },
      { time: 'Today 9:00 AM', event: 'First build takes 20 minutes', type: 'warning' },
      { time: 'Today 9:30 AM', event: 'All subsequent builds also ~20 minutes', type: 'warning' },
      { time: 'Today 10:00 AM', event: 'Build queue backing up', type: 'critical' },
      { time: 'Today 11:00 AM', event: 'Developers complaining about slow deployments', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Builds complete successfully',
      'Docker daemon responding normally',
      'CI runners have sufficient resources',
      'Network connectivity to registries fine',
      'Application code unchanged'
    ],
    broken: [
      'Build time increased 10x (2 min to 20 min)',
      'Every layer being rebuilt from scratch',
      'npm install running on every build',
      'Docker build output shows "Step X: RUN npm install" with no cache',
      'Same slow build on all CI runners'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Docker Build Output',
      type: 'logs',
      content: `\`\`\`
# Today's build
$ docker build -t myapp:latest .
Step 1/10 : FROM node:18-alpine
 ---> Using cache
Step 2/10 : WORKDIR /app
 ---> Using cache
Step 3/10 : COPY . .
 ---> 3a4b5c6d7e8f
Step 4/10 : RUN npm install
 ---> Running in 1a2b3c4d5e6f
# ... installing 1,847 packages (takes 15+ minutes)

# Yesterday's build (from logs)
Step 3/10 : COPY package*.json ./
 ---> Using cache
Step 4/10 : RUN npm install
 ---> Using cache
Step 5/10 : COPY . .
 ---> 9f8e7d6c5b4a
\`\`\``,
      hint: 'Compare the order of COPY commands between builds...'
    },
    {
      id: 2,
      title: 'Dockerfile (Current)',
      type: 'code',
      content: `\`\`\`dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy everything at once (simpler, right?)
COPY . .

# Install dependencies
RUN npm install

# Build the application
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
\`\`\``,
      hint: 'Think about what gets copied and when cache invalidates...'
    },
    {
      id: 3,
      title: 'Git History',
      type: 'logs',
      content: `\`\`\`
$ git log --oneline -5
a1b2c3d Today 8:45 AM - "Simplify Dockerfile for readability"
f4e5d6c Yesterday 4:30 PM - "Fix typo in README"
9g8h7i6 Yesterday 2:00 PM - "Add error handling to API"
j1k2l3m Yesterday 11:00 AM - "Update user validation"
n4o5p6q 2 days ago - "Release v2.3.0"

$ git show a1b2c3d --stat
 Dockerfile | 8 ++------
 1 file changed, 2 insertions(+), 6 deletions(-)

$ git diff f4e5d6c a1b2c3d -- Dockerfile
-COPY package*.json ./
-RUN npm install
-COPY . .
+COPY . .
+RUN npm install
\`\`\``,
      hint: 'The Dockerfile was "simplified" yesterday...'
    },
    {
      id: 4,
      title: 'Previous Dockerfile',
      type: 'code',
      content: `\`\`\`dockerfile
# Dockerfile before "simplification"
FROM node:18-alpine

WORKDIR /app

# Copy package files first (changes infrequently)
COPY package*.json ./

# Install dependencies (cached if package.json unchanged)
RUN npm install

# Copy source code (changes frequently)
COPY . .

# Build the application
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
\`\`\``,
      hint: 'The original had a specific order of COPY commands...'
    },
    {
      id: 5,
      title: 'Developer Testimony',
      type: 'testimony',
      content: `"I cleaned up the Dockerfile yesterday - it had these two separate COPY commands that seemed redundant. Why copy package.json separately when you can just copy everything at once? It's simpler and easier to read."

"I tested it locally and it built fine, so I pushed it. I didn't notice the build time because I had the node_modules cached locally already."`,
      hint: 'Local builds had existing cache, CI builds did not...'
    },
    {
      id: 6,
      title: 'Docker Layer Cache Documentation',
      type: 'config',
      content: `\`\`\`markdown
# Docker Build Cache

Docker caches each layer (instruction) in the Dockerfile.
When rebuilding, Docker checks if the layer can be reused:

1. If the instruction is the same AND
2. All previous layers are cached AND
3. For COPY/ADD: the file checksums match

If ANY of these conditions fail, that layer and ALL SUBSEQUENT
layers are rebuilt from scratch.

## Cache Invalidation Chain:
- COPY . .  <-- If ANY file changes, this layer is invalidated
- RUN npm install  <-- Must rebuild because previous layer changed
- RUN npm run build  <-- Must rebuild because previous layer changed

## Optimal Pattern:
- COPY package*.json ./  <-- Only invalidated if package.json changes
- RUN npm install  <-- Cached if package.json unchanged
- COPY . .  <-- Invalidated on any source change
- RUN npm run build  <-- Rebuilt, but npm install was cached
\`\`\``,
      hint: 'Layer cache is invalidated in a chain...'
    }
  ],

  solution: {
    diagnosis: 'Docker layer cache invalidated by copying all files before npm install',
    keywords: [
      'docker', 'cache', 'layer', 'invalidation', 'npm install', 'copy', 'build time',
      'dockerfile', 'optimization', 'multi-stage', 'cache busting'
    ],
    rootCause: `The Dockerfile was "simplified" by combining the COPY commands. Previously, the Dockerfile:
1. Copied only package.json and package-lock.json
2. Ran npm install (cached when package files unchanged)
3. Copied the rest of the source code
4. Built the application

After the change:
1. Copied ALL files including source code
2. Ran npm install
3. Built the application

Docker's layer cache is invalidated when ANY file in a COPY command changes. With "COPY . .", every source code change invalidates the cache for that layer. Since npm install comes AFTER this COPY, it must also rebuild every time.

The developer tested locally where Docker had cached the npm install layer from a previous build. In CI, builds start fresh or the cache was also invalidated, so the full npm install runs every time.`,
    codeExamples: [
      {
        lang: 'dockerfile',
        description: 'Optimized Dockerfile with proper layer ordering',
        code: `FROM node:18-alpine

WORKDIR /app

# Copy package files first - changes infrequently
COPY package.json package-lock.json ./

# Install dependencies - cached if package files unchanged
RUN npm ci --only=production

# Copy source code - changes frequently, but after npm install
COPY . .

# Build the application
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]`
      },
      {
        lang: 'dockerfile',
        description: 'Multi-stage build for even better caching',
        code: `# Stage 1: Dependencies (cached aggressively)
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build (uses cached deps)
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production image (minimal size)
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["npm", "start"]`
      },
      {
        lang: 'dockerfile',
        description: 'Using .dockerignore to reduce cache invalidation',
        code: `# .dockerignore
# Prevent these from invalidating cache or bloating image

node_modules
npm-debug.log
.git
.gitignore
*.md
.env*
.DS_Store
coverage
.nyc_output
tests
__tests__
*.test.js
*.spec.js`
      }
    ],
    prevention: [
      'Always copy dependency files (package.json) before running install commands',
      'Order Dockerfile instructions from least to most frequently changing',
      'Use .dockerignore to exclude files that should not affect builds',
      'Use npm ci instead of npm install for deterministic builds',
      'Monitor CI build times and alert on significant increases',
      'Review Dockerfile changes in code review with caching in mind'
    ],
    educationalInsights: [
      'Docker caches each layer independently - order matters',
      'A changed layer invalidates ALL subsequent layers in the build',
      'COPY . . is a cache-busting operation - any file change triggers rebuild',
      'Local builds often have warm caches that mask CI/CD issues',
      'Multi-stage builds can isolate dependency installation for better caching'
    ]
  }
};

import type { DetectiveCase } from "../../types";

export const ciPipelineCacheCorruption: DetectiveCase = {
	id: "ci-pipeline-cache-corruption",
	title: "The CI Pipeline Cache Corruption",
	subtitle: "Builds failing randomly with cryptic npm errors",
	difficulty: "junior",
	category: "distributed",

	crisis: {
		description:
			"CI/CD pipeline builds are failing intermittently with strange npm install errors. Some builds pass, others fail with the same code. The team is unable to ship critical bug fixes because builds are unreliable.",
		impact:
			"Development velocity reduced by 60%. Critical security patch blocked for 2 days. Team morale declining as developers retry builds hoping for luck.",
		timeline: [
			{ time: "Monday 9:00 AM", event: "First intermittent build failure noticed", type: "warning" },
			{ time: "Monday 2:00 PM", event: "Failure rate reaches 30%", type: "warning" },
			{ time: "Tuesday 10:00 AM", event: "Failure rate at 50%, team escalates", type: "critical" },
			{ time: "Tuesday 3:00 PM", event: "Security patch deployment blocked", type: "critical" },
			{ time: "Wednesday 9:00 AM", event: "All CI runners affected", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Local builds work fine on developer machines",
			"Some CI builds pass randomly",
			"npm install works in fresh Docker containers",
			"Package.json and lock file are valid",
			"npm registry is accessible",
		],
		broken: [
			"CI builds fail with EINTEGRITY errors",
			"npm install reports corrupted packages",
			"Same commit fails then passes on retry",
			"Error messages mention checksum mismatches",
			"Builds that use cache fail more often",
		],
	},

	clues: [
		{
			id: 1,
			title: "CI Build Logs",
			type: "logs",
			content: `\`\`\`
[npm install] Installing dependencies...
[npm install] Using cache from /ci-cache/npm
[npm install]
[npm install] npm ERR! code EINTEGRITY
[npm install] npm ERR! sha512-abc123... integrity checksum failed
[npm install] npm ERR! Expected: sha512-abc123def456...
[npm install] npm ERR! Actual:   sha512-xyz789aaa111...
[npm install] npm ERR! While resolving: lodash@4.17.21
[npm install]
[npm install] npm ERR! A complete log of this run can be found in:
[npm install] npm ERR!     /root/.npm/_logs/2024-01-15T10_23_45Z-debug-0.log
\`\`\``,
			hint: "The error is about integrity checksums not matching...",
		},
		{
			id: 2,
			title: "CI Pipeline Configuration",
			type: "config",
			content: `\`\`\`yaml
# .gitlab-ci.yml
stages:
  - install
  - build
  - test

variables:
  npm_config_cache: /ci-cache/npm

install:
  stage: install
  cache:
    key: npm-cache
    paths:
      - /ci-cache/npm
      - node_modules/
  script:
    - npm ci
  artifacts:
    paths:
      - node_modules/

build:
  stage: build
  dependencies:
    - install
  script:
    - npm run build
\`\`\``,
			hint: "Look at what's being cached and how the cache key is defined...",
		},
		{
			id: 3,
			title: "DevOps Engineer Testimony",
			type: "testimony",
			content: `"We enabled the npm cache about a week ago to speed up builds. It worked great at first - builds went from 8 minutes to 3 minutes. But then things got weird. We noticed that builds started failing more on Mondays than other days. Also, when we added a new package last Thursday, the failures got way worse. Sometimes clearing the cache fixes it, but then it breaks again."`,
		},
		{
			id: 4,
			title: "Cache Storage Metrics",
			type: "metrics",
			content: `\`\`\`
Cache Storage Analysis:
-----------------------
Cache Key: npm-cache
Cache Size: 2.3 GB
Cache Age: 9 days
Last Modified: Multiple timestamps

File Integrity Check:
- node_modules/.package-lock.json: Modified 47 times
- /ci-cache/npm/_cacache/: 12,847 entries
- Duplicate package versions detected: 34
- Partial downloads found: 8

CI Runner Analysis:
- Runner 1: Cache mounted read-write
- Runner 2: Cache mounted read-write
- Runner 3: Cache mounted read-write
- Concurrent jobs sharing cache: Yes
\`\`\``,
			hint: "Multiple runners are accessing the same cache simultaneously...",
		},
		{
			id: 5,
			title: "Package Lock Diff",
			type: "code",
			content: `\`\`\`diff
# git diff HEAD~5 package-lock.json

  "lodash": {
-   "version": "4.17.20",
-   "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz",
-   "integrity": "sha512-OLD_HASH..."
+   "version": "4.17.21",
+   "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
+   "integrity": "sha512-NEW_HASH..."
  },

# But cache still contains:
$ ls /ci-cache/npm/_cacache/content-v2/sha512/
abc123...  # OLD lodash 4.17.20 content
xyz789...  # NEW lodash 4.17.21 content
def456...  # Partial/corrupted download
\`\`\``,
			hint: "The cache has old versions mixed with new ones...",
		},
		{
			id: 6,
			title: "CI Runner Timing Log",
			type: "logs",
			content: `\`\`\`
Concurrent Build Analysis (Wednesday 10:00-10:05 AM):
----------------------------------------------------
10:00:01 - Runner 1: Job #1234 started, reading npm cache
10:00:02 - Runner 2: Job #1235 started, reading npm cache
10:00:15 - Runner 1: npm ci downloading lodash@4.17.21
10:00:16 - Runner 2: npm ci downloading lodash@4.17.21
10:00:45 - Runner 1: Writing to cache /ci-cache/npm/_cacache/...
10:00:46 - Runner 2: Writing to cache /ci-cache/npm/_cacache/...
10:00:47 - Runner 1: npm ERR! EINTEGRITY (checksum mismatch)
10:00:48 - Runner 2: Job completed successfully

# Same file written by two processes = corruption
\`\`\``,
			hint: "Two runners wrote to the same cache file at nearly the same time...",
		},
	],

	solution: {
		diagnosis: "Shared npm cache corrupted by concurrent CI runner writes",
		keywords: [
			"cache corruption",
			"npm cache",
			"EINTEGRITY",
			"concurrent",
			"race condition",
			"cache key",
			"shared cache",
			"integrity checksum",
			"ci cache",
		],
		rootCause: `The CI pipeline uses a shared npm cache directory mounted across all runners with read-write access. When multiple builds run concurrently, they all read from and write to the same cache location. This creates several problems:

1. **Race conditions**: Two runners downloading the same package simultaneously can corrupt cache entries when they write at the same time.

2. **Stale cache entries**: The cache key "npm-cache" is static and doesn't change when package-lock.json changes. Old package versions remain in cache alongside new ones.

3. **Partial downloads**: If a build is cancelled or fails mid-download, partial files remain in cache and get used by subsequent builds.

4. **No cache invalidation**: Package version updates don't invalidate the cache, so npm finds the old cached content but the lockfile expects new checksums.

The intermittent nature occurs because failures depend on timing - when concurrent builds don't overlap on the same packages, builds succeed.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "Fixed CI config with proper cache key based on lockfile",
				code: `# .gitlab-ci.yml
stages:
  - install
  - build
  - test

variables:
  npm_config_cache: $CI_PROJECT_DIR/.npm-cache

install:
  stage: install
  cache:
    # Cache key changes when package-lock.json changes
    key:
      files:
        - package-lock.json
    paths:
      - .npm-cache/
    policy: pull-push
  script:
    # Use npm ci which respects lockfile exactly
    - npm ci --cache .npm-cache
  artifacts:
    paths:
      - node_modules/`,
			},
			{
				lang: "yaml",
				description: "Alternative: Per-branch cache with fallback",
				code: `install:
  stage: install
  cache:
    # Primary cache key includes branch and lockfile hash
    key: npm-$CI_COMMIT_REF_SLUG-$CI_COMMIT_SHA
    paths:
      - .npm-cache/
      - node_modules/
    policy: pull-push
    # Fallback to branch cache, then default
    fallback_keys:
      - npm-$CI_COMMIT_REF_SLUG-
      - npm-main-
      - npm-
  script:
    - npm ci --cache .npm-cache`,
			},
			{
				lang: "bash",
				description: "Cache verification script",
				code: `#!/bin/bash
# verify-cache.sh - Run before npm install

CACHE_DIR=".npm-cache"
LOCKFILE_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
CACHE_MARKER="$CACHE_DIR/.lockfile-hash"

# Check if cache matches current lockfile
if [ -f "$CACHE_MARKER" ]; then
  CACHED_HASH=$(cat "$CACHE_MARKER")
  if [ "$CACHED_HASH" != "$LOCKFILE_HASH" ]; then
    echo "Lockfile changed, clearing npm cache..."
    rm -rf "$CACHE_DIR"
    mkdir -p "$CACHE_DIR"
  fi
fi

# Store current hash for next run
echo "$LOCKFILE_HASH" > "$CACHE_MARKER"

# Now safe to run npm ci
npm ci --cache "$CACHE_DIR"`,
			},
		],
		prevention: [
			"Always include lockfile hash in cache key so cache invalidates on dependency changes",
			"Use project-local cache directory instead of shared global cache",
			"Run npm ci instead of npm install in CI to ensure lockfile is respected",
			"Implement cache verification before using cached content",
			"Set up cache policies (pull-push vs pull-only) based on job type",
			"Add periodic cache purge jobs to prevent unbounded growth",
		],
		educationalInsights: [
			"CI caches are not databases - they need explicit invalidation strategies",
			"npm ci is designed for CI environments and is stricter than npm install",
			"EINTEGRITY errors mean the downloaded content doesn't match expected checksum",
			"Shared mutable state (like caches) across concurrent processes always risks corruption",
			"Cache keys should be deterministic and change when cached content should change",
			"The 'works locally' vs 'fails in CI' pattern often points to cache or environment differences",
		],
	},
};

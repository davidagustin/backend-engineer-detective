import { DetectiveCase } from '../../types';

export const sentryEventFlood: DetectiveCase = {
  id: 'sentry-event-flood',
  title: 'The Sentry Event Flood',
  subtitle: 'Error tracking quota exhausted in 1 hour',
  difficulty: 'junior',
  category: 'distributed',

  crisis: {
    description: `
      Your Sentry monthly quota of 500K events was exhausted in the first hour of the month.
      Error tracking is now disabled until the quota resets. A new bug was deployed that
      morning, and you can't see any errors from it. Users are complaining, but you're flying
      blind. You can either pay $5K for emergency quota or wait 30 days.
    `,
    impact: `
      No error visibility for 30 days (or $5K to restore). Active production bug undetectable.
      Customer complaints piling up. Engineering team debugging blind. Management questioning
      why error tracking "just stopped working."
    `,
    timeline: [
      { time: 'Month start 00:00', event: 'Quota resets to 500K events', type: 'normal' },
      { time: '00:15', event: 'Deploy goes out to production', type: 'normal' },
      { time: '00:20', event: 'Event rate spikes to 50K/minute', type: 'warning' },
      { time: '00:30', event: 'Quota at 50% (250K events)', type: 'warning' },
      { time: '01:00', event: 'Quota exhausted - Sentry stops accepting events', type: 'critical' },
      { time: '09:00', event: 'Team discovers Sentry is offline', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Sentry SDK is installed',
      'Events were being captured',
      'Sentry dashboard accessible',
      'Application running (with errors)'
    ],
    broken: [
      'No new errors appearing in Sentry',
      'Quota shows 100% consumed',
      'SDK silently dropping events',
      'Rate limit headers in responses'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Sentry Usage Statistics',
      type: 'metrics',
      content: `
\`\`\`
# Sentry Organization Usage - This Month

Quota: 500,000 events
Used: 500,000 events (100%)
Time to exhaust: 58 minutes

Event Breakdown by Issue:
1. "TypeError: Cannot read property 'id' of undefined"
   Events: 342,891 (68.6%)
   First seen: 00:17 AM
   Affected users: 12,847

2. "NetworkError: Failed to fetch"
   Events: 89,234 (17.8%)
   First seen: 3 months ago
   Affected users: 4,231

3. "ChunkLoadError: Loading chunk 5 failed"
   Events: 45,123 (9.0%)
   First seen: 2 months ago
   Affected users: 2,891

4. All other errors: 22,752 (4.6%)

# Single new issue consumed 68% of monthly quota in 1 hour!
\`\`\`
      `,
      hint: 'One new error consumed 343K events - more than half the monthly quota'
    },
    {
      id: 2,
      title: 'The Offending Code',
      type: 'code',
      content: `
\`\`\`javascript
// user-profile.js - deployed at 00:15 AM
async function loadUserProfile() {
  const response = await fetch('/api/user/profile');
  const data = await response.json();

  // Bug: data.user can be null for logged-out users
  // This throws on EVERY page load for logged-out visitors
  document.getElementById('username').textContent = data.user.id;

  // The site gets 50,000 visitors per minute
  // 60% are not logged in
  // = 30,000 errors per minute
}

// Called on every page load
document.addEventListener('DOMContentLoaded', loadUserProfile);
\`\`\`
      `,
      hint: 'The bug throws an error for every logged-out visitor on every page'
    },
    {
      id: 3,
      title: 'Sentry SDK Configuration',
      type: 'config',
      content: `
\`\`\`javascript
// sentry-config.js
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: 'https://xxx@sentry.io/123',
  environment: 'production',

  // No sample rate - capture 100% of errors
  // sampleRate: 1.0 is the default

  // No rate limiting configured
  // maxBreadcrumbs: 100 is the default (lots of context per event)

  // No beforeSend filter
  // Every error goes to Sentry
});
\`\`\`
      `,
      hint: 'No sampling, no rate limiting, no filtering - every error is sent'
    },
    {
      id: 4,
      title: 'Traffic Patterns',
      type: 'metrics',
      content: `
\`\`\`
# Site Traffic Statistics

Page views per minute: 50,000
Logged-in users: 40%
Logged-out visitors: 60%

Error calculation:
  50,000 page views/min × 60% logged out = 30,000 errors/min
  30,000 errors/min × 60 min = 1,800,000 errors in first hour

But quota is only 500,000!
Quota exhausted in: 500,000 / 30,000 = 16.7 minutes

Actually took 58 minutes because:
  - Sentry SDK has internal rate limiting (batching)
  - Some events dropped during spike
  - Not every page load triggered the code path immediately
\`\`\`
      `,
      hint: 'With no sampling, a common error on a high-traffic site exhausts quota instantly'
    },
    {
      id: 5,
      title: 'Historical Error Patterns',
      type: 'logs',
      content: `
\`\`\`
# Previous months - Error event distribution

Month -1:
  Total events: 127,000 (25% of quota)
  Top error: "NetworkError" - 45,000 events
  Unique issues: 234

Month -2:
  Total events: 89,000 (18% of quota)
  Top error: "ChunkLoadError" - 28,000 events
  Unique issues: 198

Month -3:
  Total events: 156,000 (31% of quota)
  Top error: "NetworkError" - 67,000 events
  Unique issues: 287

# Pattern: NetworkError and ChunkLoadError are known noisy issues
# Nobody ever configured fingerprinting or sampling for them
# They've been consuming 30-50% of quota for months
\`\`\`
      `,
      hint: 'Known noisy errors have been consuming quota for months without action'
    },
    {
      id: 6,
      title: 'Sentry Best Practices Documentation',
      type: 'config',
      content: `
\`\`\`markdown
# Sentry Quota Management Best Practices

## Rate Limiting
\`\`\`javascript
Sentry.init({
  sampleRate: 0.1,  // Only send 10% of errors
  tracesSampleRate: 0.01,  // 1% of transactions

  beforeSend(event) {
    // Filter out known noisy errors
    if (event.exception?.values?.[0]?.type === 'ChunkLoadError') {
      return null;  // Don't send
    }
    return event;
  }
});
\`\`\`

## Fingerprinting
Group similar errors to avoid duplicates counting against quota.

## Inbound Filters
Configure in Sentry UI:
- Filter browser extensions
- Filter old browsers
- Filter localhost
- Filter known crawlers

## Rate Limits
Set organization-level rate limits:
- Per-project limits
- Per-key limits
- Spike protection

## Alerting
Set up alerts for:
- Quota > 50% before mid-month
- New high-volume issues
- Unusual error spikes
\`\`\`
      `,
      hint: 'Multiple mechanisms exist to prevent quota exhaustion'
    }
  ],

  solution: {
    diagnosis: 'No client-side sampling or rate limiting - a common bug on high-traffic pages exhausted the monthly quota in 1 hour',

    keywords: [
      'sentry', 'quota', 'rate limit', 'sampling', 'beforeSend', 'error tracking',
      'events', 'flood', 'spike protection', 'fingerprinting', 'inbound filters'
    ],

    rootCause: `
      A combination of factors led to the quota exhaustion:

      1. **No sampling configured**: Sentry SDK was set to capture 100% of errors.
         On a site with 50K page views/minute, any common error becomes a flood.

      2. **Bug on hot path**: The TypeError was triggered on every page load for
         logged-out users (60% of traffic). That's 30K errors per minute.

      3. **No beforeSend filter**: Known noisy errors (NetworkError, ChunkLoadError)
         were already consuming 30-50% of quota monthly. No filtering was in place.

      4. **No rate limiting**: Sentry's built-in rate limiting wasn't configured.
         There was no spike protection or per-project limits.

      5. **No quota monitoring**: No alerts were set up for quota consumption.
         The team didn't know there was a problem until Sentry stopped working.

      The math: 30,000 errors/minute with no sampling = quota exhausted in 17 minutes.
      The actual 58 minutes included some buffering and batching by the SDK.

      This is a common pattern: error tracking works fine with normal error rates,
      then a single bug on a high-traffic page instantly exhausts the quota.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Problematic: No rate limiting or sampling',
        code: `// DON'T: Default configuration on high-traffic site
Sentry.init({
  dsn: 'https://xxx@sentry.io/123',
  // Defaults to 100% capture rate
  // No filtering
  // No rate limiting
});
// One common bug = quota gone in minutes`
      },
      {
        lang: 'javascript',
        description: 'Fixed: Comprehensive error management',
        code: `import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: 'https://xxx@sentry.io/123',
  environment: 'production',

  // Sample rate - don't send every error
  sampleRate: 0.1,  // 10% of errors (still statistically significant)

  // Filter and enrich errors
  beforeSend(event, hint) {
    const error = hint.originalException;

    // Don't send known noisy errors
    const noisyErrors = ['ChunkLoadError', 'NetworkError', 'ResizeObserver'];
    if (noisyErrors.some(e => error?.name?.includes(e))) {
      return null;
    }

    // Don't send errors from browser extensions
    if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
      frame => frame.filename?.includes('extension')
    )) {
      return null;
    }

    // Rate limit per error type (in-memory)
    const errorKey = error?.message?.slice(0, 50);
    if (shouldRateLimit(errorKey)) {
      return null;
    }

    return event;
  },

  // Limit breadcrumbs to reduce payload size
  maxBreadcrumbs: 20,

  // Ignore errors from old browsers
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
    /^Script error\\.?$/,
  ],
});

// Client-side rate limiting
const errorCounts = new Map();
function shouldRateLimit(errorKey) {
  const count = errorCounts.get(errorKey) || 0;
  errorCounts.set(errorKey, count + 1);

  // Allow first 10, then sample 1%
  if (count < 10) return false;
  return Math.random() > 0.01;
}`
      },
      {
        lang: 'javascript',
        description: 'Adaptive sampling based on error volume',
        code: `// Dynamic sampling - reduce rate during spikes
let errorCount = 0;
let sampleRate = 0.1;

setInterval(() => {
  // Adjust sample rate based on error volume
  if (errorCount > 1000) {
    sampleRate = 0.001;  // 0.1% during spike
  } else if (errorCount > 100) {
    sampleRate = 0.01;   // 1% during elevated
  } else {
    sampleRate = 0.1;    // 10% normal
  }
  errorCount = 0;
}, 60000);  // Reset every minute

Sentry.init({
  dsn: 'https://xxx@sentry.io/123',
  beforeSend(event) {
    errorCount++;
    if (Math.random() > sampleRate) {
      return null;  // Drop based on current sample rate
    }
    event.tags = { ...event.tags, sampleRate };
    return event;
  }
});`
      },
      {
        lang: 'yaml',
        description: 'Sentry project settings (configure in UI or API)',
        code: `# Sentry Project Configuration

# Inbound Filters (Sentry UI: Settings > Inbound Filters)
filters:
  - browser_extensions: true  # Filter errors from extensions
  - legacy_browsers: true     # Filter IE, old Safari, etc.
  - localhost: true          # Filter development errors
  - web_crawlers: true       # Filter bot traffic

# Rate Limits (Sentry UI: Settings > Rate Limits)
rate_limits:
  - project_rate_limit: 10000  # Max 10K events per minute
  - key_rate_limit: 1000       # Max 1K per DSN key

# Spike Protection (Sentry UI: Settings > Spike Protection)
spike_protection:
  enabled: true
  threshold: 10x  # Trigger if 10x normal volume

# Quota Alerts (Sentry UI: Settings > Subscription)
alerts:
  - quota_approaching: 50%
  - quota_approaching: 80%
  - quota_exhausted: true`
      },
      {
        lang: 'javascript',
        description: 'Alert on Sentry quota consumption',
        code: `// Monitor Sentry quota programmatically
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const ORG_SLUG = 'my-org';

async function checkQuota() {
  const response = await fetch(
    \`https://sentry.io/api/0/organizations/\${ORG_SLUG}/stats_v2/?field=sum(quantity)&interval=1d&statsPeriod=30d\`,
    {
      headers: { 'Authorization': \`Bearer \${SENTRY_AUTH_TOKEN}\` }
    }
  );
  const data = await response.json();

  const totalEvents = data.groups[0].totals['sum(quantity)'];
  const quota = 500000;
  const percentUsed = (totalEvents / quota) * 100;

  if (percentUsed > 50) {
    await sendSlackAlert(\`Sentry quota at \${percentUsed.toFixed(1)}%!\`);
  }

  if (percentUsed > 80) {
    await sendPagerDutyAlert('Sentry quota critical');
  }
}

// Run daily
setInterval(checkQuota, 24 * 60 * 60 * 1000);`
      }
    ],

    prevention: [
      'Always configure sampleRate for production (0.01-0.1)',
      'Implement beforeSend filtering for known noisy errors',
      'Enable Sentry inbound filters for browsers and extensions',
      'Set up project-level rate limits and spike protection',
      'Create alerts for quota consumption milestones',
      'Review top error sources monthly and add fingerprinting',
      'Test error handling in staging with production-like traffic'
    ],

    educationalInsights: [
      'Error tracking is designed for debugging, not logging every error',
      'A 0.1% sample of 1M errors (1000 events) is statistically sufficient',
      'High-traffic sites need aggressive sampling to stay within budget',
      'Known noisy errors should be filtered or heavily sampled',
      'Quota exhaustion during an incident is the worst time to lose visibility',
      'Error monitoring costs scale with traffic × error rate × sample rate'
    ]
  }
};

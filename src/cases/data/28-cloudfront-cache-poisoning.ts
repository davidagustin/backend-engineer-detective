import { DetectiveCase } from '../../types';

export const cloudfrontCachePoisoning: DetectiveCase = {
  id: 'cloudfront-cache-poisoning',
  title: 'The CloudFront Cache Poisoning',
  subtitle: 'Incorrect Vary headers causing wrong content served to users',
  difficulty: 'senior',
  category: 'caching',

  crisis: {
    description: `
      Users are reporting seeing other users' personalized content. A French user
      sees the site in German. A logged-in user sees another user's shopping cart.
      The problem is intermittent and seems region-specific. This is a potential
      data privacy violation and security incident.
    `,
    impact: `
      GDPR violation risk. Users seeing other users' personal data. Trust destroyed.
      Legal team involved. Potential regulatory fines up to 4% of global revenue.
    `,
    timeline: [
      { time: 'Monday', event: 'CDN caching enabled for faster page loads', type: 'normal' },
      { time: 'Tuesday', event: 'First reports of "wrong language" pages', type: 'warning' },
      { time: 'Wednesday', event: 'User reports seeing another user\'s cart', type: 'critical' },
      { time: 'Wednesday', event: 'Security team escalates as data breach', type: 'critical' },
      { time: 'Thursday', event: 'Emergency: User personal info visible to wrong user', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Application works correctly when bypassing CDN',
      'Cache hit rate is excellent (95%)',
      'Page load times significantly improved',
      'Origin server returns correct personalized content'
    ],
    broken: [
      'Wrong language content served to users',
      'User A sees User B\'s personalized content',
      'Shopping cart shows wrong items',
      'Issue correlates with cache hits, not misses'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'CloudFront Distribution Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# CloudFormation - CloudFront Distribution
CloudFrontDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      DefaultCacheBehavior:
        ViewerProtocolPolicy: redirect-to-https
        CachePolicyId: !Ref CustomCachePolicy
        OriginRequestPolicyId: !Ref CustomOriginRequestPolicy

CustomCachePolicy:
  Type: AWS::CloudFront::CachePolicy
  Properties:
    CachePolicyConfig:
      Name: CustomCachePolicy
      DefaultTTL: 3600  # 1 hour
      MaxTTL: 86400     # 24 hours
      MinTTL: 60        # 1 minute
      ParametersInCacheKeyAndForwardedToOrigin:
        CookiesConfig:
          CookieBehavior: none  # DON'T include cookies in cache key
        HeadersConfig:
          HeaderBehavior: whitelist
          Headers:
            - Host  # Include Host header in cache key
        QueryStringsConfig:
          QueryStringBehavior: all  # Include all query strings
\`\`\`
      `,
      hint: 'Cookies are not included in the cache key, but authentication uses cookies'
    },
    {
      id: 2,
      title: 'Origin Server Response Headers',
      type: 'logs',
      content: `
\`\`\`http
# Response from origin for logged-in user (User A)
HTTP/2 200
Content-Type: text/html; charset=utf-8
Cache-Control: max-age=3600
Vary: Accept-Encoding

<!DOCTYPE html>
<html>
<head><title>Welcome, Alice!</title></head>
<body>
  <div class="cart">
    <h2>Your Cart (3 items)</h2>
    <ul>
      <li>Widget Pro - $99.99</li>
      <li>Gadget Plus - $149.99</li>
      <li>Gizmo Ultra - $79.99</li>
    </ul>
  </div>
  <div class="locale">Language: English (US)</div>
</body>
</html>

# Vary: Accept-Encoding tells CDN to cache by compression
# But where's Vary: Cookie? Where's Vary: Accept-Language?
\`\`\`
      `,
      hint: 'Response is personalized but Vary header only mentions Accept-Encoding'
    },
    {
      id: 3,
      title: 'CloudFront Access Logs',
      type: 'logs',
      content: `
\`\`\`
# CloudFront access logs

# 10:00:00 - User A (Alice) requests homepage
# x-edge-result-type: Miss (fetched from origin)
timestamp=10:00:00 uri=/ client_ip=203.0.113.10 result=Miss
x-cache-key=/index.html?host=shop.example.com

# 10:00:05 - User B (Bob) requests same page
# x-edge-result-type: Hit (served from cache)
timestamp=10:00:05 uri=/ client_ip=198.51.100.20 result=Hit
x-cache-key=/index.html?host=shop.example.com

# Same cache key for different users!
# Bob received Alice's personalized page from cache

# 10:05:00 - User C (French) requests homepage
# x-edge-result-type: Miss (different edge location)
timestamp=10:05:00 uri=/ client_ip=192.0.2.30 result=Miss accept-language=fr-FR
x-cache-key=/index.html?host=shop.example.com

# 10:05:10 - User D (German) requests homepage
# x-edge-result-type: Hit
timestamp=10:05:10 uri=/ client_ip=192.0.2.40 result=Hit accept-language=de-DE
x-cache-key=/index.html?host=shop.example.com

# User D (German) received User C's French page!
\`\`\`
      `,
      hint: 'Same cache key used regardless of user identity or language preference'
    },
    {
      id: 4,
      title: 'Application Personalization Logic',
      type: 'code',
      content: `
\`\`\`typescript
// app.ts - Express middleware
import express from 'express';

const app = express();

// Set language based on Accept-Language header
app.use((req, res, next) => {
  const acceptLanguage = req.headers['accept-language'];
  req.locale = acceptLanguage?.startsWith('fr') ? 'fr' :
               acceptLanguage?.startsWith('de') ? 'de' : 'en';
  next();
});

// Render personalized homepage
app.get('/', async (req, res) => {
  const user = await getUserFromSession(req.cookies.session);
  const cart = user ? await getCart(user.id) : null;

  // Response is personalized by:
  // 1. User session (via cookie)
  // 2. Language (via Accept-Language header)

  res.set('Cache-Control', 'max-age=3600');
  // Missing: res.set('Vary', 'Cookie, Accept-Language');

  res.render('homepage', {
    user,
    cart,
    locale: req.locale,
  });
});
\`\`\`
      `,
      hint: 'Personalization based on cookies and Accept-Language, but no Vary header set'
    },
    {
      id: 5,
      title: 'HTTP Vary Header Documentation',
      type: 'testimony',
      content: `
> "The Vary HTTP response header determines how to match future request
> headers to decide whether a cached response can be used, or if a fresh
> one must be requested from the origin server."
>
> "For example, if you serve different content based on the Accept-Language
> header, you should include: Vary: Accept-Language"
>
> "If your content varies by user authentication (cookies), you should either:
> 1. Add Vary: Cookie (creates separate cache entry per unique cookie value)
> 2. Mark the response as private/no-store (don't cache at all)
> 3. Use cache key policies to include cookies in the key"
>
> -- MDN Web Docs, HTTP Caching
      `,
      hint: 'Vary header tells caches what makes responses different for the same URL'
    },
    {
      id: 6,
      title: 'Cache Poisoning Attack Vector',
      type: 'config',
      content: `
\`\`\`markdown
# How Cache Poisoning Occurred

## Normal Flow (Expected)
1. User A requests /
2. CloudFront checks cache for key: "/index.html?host=shop.example.com"
3. Cache MISS - forwards to origin with User A's cookies
4. Origin returns User A's personalized page
5. CloudFront caches the response
6. User B requests /
7. CloudFront checks cache - cache HIT
8. CloudFront returns User A's personalized page to User B!

## Why This Is Dangerous
- Shopping cart contents leaked between users
- Authentication state leaked (one user appears logged in as another)
- Language preferences broken
- Personal information exposed

## The Fix
Cache key must include ALL factors that vary the response:
- If response varies by cookie -> Include cookie in cache key OR don't cache
- If response varies by Accept-Language -> Include Accept-Language in cache key
- If response varies by user -> Mark as Cache-Control: private
\`\`\`
      `,
      hint: 'Cache key must include everything that makes the response different'
    }
  ],

  solution: {
    diagnosis: 'Personalized content cached without including personalization factors (cookies, Accept-Language) in cache key or Vary header',

    keywords: [
      'cloudfront', 'cdn', 'cache poisoning', 'vary header', 'cache key',
      'personalization', 'cookies', 'accept-language', 'cache-control',
      'private', 'data leak', 'gdpr'
    ],

    rootCause: `
      The application personalized responses based on:
      1. User session (from cookies) - determines cart, user name, etc.
      2. Accept-Language header - determines locale/language

      However, the CloudFront cache policy excluded cookies from the cache key,
      and the application didn't set proper Vary headers. This meant:

      - CloudFront used the same cache key for all users: "/index.html?host=shop.example.com"
      - When User A (logged in) requested the page, their personalized response was cached
      - When User B (different user) requested the same URL, they got User A's cached page
      - Same for language: French user's page cached, German user received French version

      This is a classic cache poisoning vulnerability. The CDN didn't know the response
      varied by user/language because neither the cache policy nor the Vary header
      indicated it.

      The quick "fix" of enabling CDN caching without understanding personalization
      created a serious privacy and security incident.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Fix 1: Add proper Vary headers at the application level',
        code: `// app.ts - Set Vary headers correctly

app.get('/', async (req, res) => {
  const user = await getUserFromSession(req.cookies.session);
  const cart = user ? await getCart(user.id) : null;

  // CRITICAL: Tell caches what varies this response
  // Option A: If content is personalized by user, don't cache publicly
  if (user) {
    res.set('Cache-Control', 'private, max-age=300');  // Cache only in browser
  } else {
    // Anonymous users can share cached content per language
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Vary', 'Accept-Language, Accept-Encoding');
  }

  res.render('homepage', {
    user,
    cart,
    locale: req.locale,
  });
});

// For API endpoints with personalized data:
app.get('/api/cart', authenticateUser, async (req, res) => {
  // NEVER cache personalized API responses publicly
  res.set('Cache-Control', 'private, no-store');
  res.json(await getCart(req.user.id));
});`
      },
      {
        lang: 'yaml',
        description: 'Fix 2: Configure CloudFront to cache by cookies',
        code: `# CloudFormation - Proper cache policy for personalized content

# Policy for personalized pages (includes session cookie)
PersonalizedCachePolicy:
  Type: AWS::CloudFront::CachePolicy
  Properties:
    CachePolicyConfig:
      Name: PersonalizedContentPolicy
      DefaultTTL: 300
      MaxTTL: 3600
      MinTTL: 0
      ParametersInCacheKeyAndForwardedToOrigin:
        CookiesConfig:
          CookieBehavior: whitelist
          Cookies:
            - session  # Include session cookie in cache key
        HeadersConfig:
          HeaderBehavior: whitelist
          Headers:
            - Host
            - Accept-Language  # Include language in cache key
        QueryStringsConfig:
          QueryStringBehavior: all

# Policy for static assets (no personalization)
StaticAssetCachePolicy:
  Type: AWS::CloudFront::CachePolicy
  Properties:
    CachePolicyConfig:
      Name: StaticAssetPolicy
      DefaultTTL: 86400
      MaxTTL: 31536000
      MinTTL: 86400
      ParametersInCacheKeyAndForwardedToOrigin:
        CookiesConfig:
          CookieBehavior: none  # Static assets don't vary by cookie
        HeadersConfig:
          HeaderBehavior: none
        QueryStringsConfig:
          QueryStringBehavior: none`
      },
      {
        lang: 'yaml',
        description: 'Fix 3: Use cache behaviors to separate personal vs public content',
        code: `# CloudFront Distribution with separate behaviors

CloudFrontDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      # Static assets - aggressive caching, no personalization
      CacheBehaviors:
        - PathPattern: "/static/*"
          CachePolicyId: !Ref StaticAssetCachePolicy
          Compress: true

        - PathPattern: "/images/*"
          CachePolicyId: !Ref StaticAssetCachePolicy
          Compress: true

        # API endpoints - no caching (always personal)
        - PathPattern: "/api/*"
          CachePolicyId: !Ref NoCachePolicy  # TTL=0

        # User-specific pages - no public caching
        - PathPattern: "/account/*"
          CachePolicyId: !Ref NoCachePolicy

        - PathPattern: "/cart/*"
          CachePolicyId: !Ref NoCachePolicy

      # Default - cache with language variation
      DefaultCacheBehavior:
        CachePolicyId: !Ref LanguageAwareCachePolicy
        # Only cache anonymous content!

NoCachePolicy:
  Type: AWS::CloudFront::CachePolicy
  Properties:
    CachePolicyConfig:
      Name: NoCachePolicy
      DefaultTTL: 0
      MaxTTL: 0
      MinTTL: 0`
      },
      {
        lang: 'typescript',
        description: 'Fix 4: Edge-aware response with cache keys',
        code: `// Middleware to ensure correct caching headers

function cacheHeaders(options: {
  isPersonalized: boolean;
  varyBy?: string[];
  maxAge?: number;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (options.isPersonalized) {
      // Personalized content should NEVER be cached publicly
      res.set('Cache-Control', 'private, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else {
      // Public content can be cached
      const maxAge = options.maxAge ?? 3600;
      res.set('Cache-Control', \`public, max-age=\${maxAge}\`);

      // Set Vary header for any factors that vary the response
      const varyHeaders = ['Accept-Encoding', ...(options.varyBy ?? [])];
      res.set('Vary', varyHeaders.join(', '));
    }
    next();
  };
}

// Usage:
app.get('/',
  cacheHeaders({ isPersonalized: false, varyBy: ['Accept-Language'] }),
  renderHomepage
);

app.get('/account',
  authenticateUser,
  cacheHeaders({ isPersonalized: true }),
  renderAccount
);

app.get('/static/:file',
  cacheHeaders({ isPersonalized: false, maxAge: 86400 }),
  serveStatic
);`
      }
    ],

    prevention: [
      'Never cache personalized content without explicit cache key configuration',
      'Always set Cache-Control: private for user-specific responses',
      'Use Vary header to indicate all factors that affect the response',
      'Audit cache policies before enabling CDN caching',
      'Separate cache behaviors for static, public, and personalized content',
      'Test caching with multiple users before production rollout',
      'Monitor for cache hit rate anomalies (too high might indicate poisoning)',
      'Implement response header validation in CI/CD'
    ],

    educationalInsights: [
      'CDN cache keys determine what is "the same request" - all variation factors must be included',
      'Vary header tells caches which request headers affect the response',
      'Cache-Control: private means "only browser can cache", public CDNs must not',
      'Cache poisoning can turn a performance optimization into a security incident',
      'GDPR requires protecting personal data - leaked data is a reportable breach',
      'Defense in depth: both origin headers AND CDN config should be correct'
    ]
  }
};

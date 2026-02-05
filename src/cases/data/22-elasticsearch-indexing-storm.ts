import { DetectiveCase } from '../../types';

export const elasticsearchIndexingStorm: DetectiveCase = {
  id: 'elasticsearch-indexing-storm',
  title: 'The Elasticsearch Indexing Storm',
  subtitle: 'Search cluster overwhelmed by mysterious write traffic',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your product search runs on Elasticsearch. The cluster is suddenly overwhelmed
      with indexing requests—10x normal volume. Search latency has spiked from 50ms
      to 5 seconds. The product catalog hasn't changed, so where are all these
      writes coming from?
    `,
    impact: `
      Search is unusable. Users can't find products. Conversion rate dropped 70%.
      E-commerce revenue at risk of $500K/hour loss.
    `,
    timeline: [
      { time: '3:00 PM', event: 'Marketing sent promotional email to 2M users', type: 'normal' },
      { time: '3:05 PM', event: 'Traffic spike begins (expected)', type: 'normal' },
      { time: '3:10 PM', event: 'Elasticsearch indexing rate explodes', type: 'warning' },
      { time: '3:15 PM', event: 'Search latency exceeds 5 seconds', type: 'critical' },
      { time: '3:20 PM', event: 'Search queries timing out', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Product data in Elasticsearch is correct',
      'No product catalog updates happening',
      'Database is healthy',
      'Indexing eventually succeeds'
    ],
    broken: [
      'Indexing volume 10x normal with no catalog changes',
      'All indexing requests are for the same products',
      'Search queries extremely slow',
      'Cluster CPU at 100% on indexing threads'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Elasticsearch Indexing Stats',
      type: 'metrics',
      content: `
## Indexing Operations (products index)

| Time | Docs Indexed/min | Unique Products | Index Size |
|------|------------------|-----------------|------------|
| 2:00 PM | 50 | 50 | 2.1 GB |
| 2:30 PM | 45 | 45 | 2.1 GB |
| 3:00 PM | 60 | 55 | 2.1 GB |
| 3:15 PM | 48,000 | 200 | 2.1 GB |
| 3:30 PM | 52,000 | 180 | 2.1 GB |

**Note:** Unique products is much lower than docs indexed.
Same products being re-indexed repeatedly.
      `,
      hint: 'The same 200 products are being indexed 48,000 times per minute'
    },
    {
      id: 2,
      title: 'Application Search Code',
      type: 'code',
      content: `
\`\`\`python
# search_service.py
def search_products(query, user_id):
    # First, check if this product needs re-indexing
    popular_products = get_popular_products(query)
    for product in popular_products:
        ensure_indexed(product)

    # Then perform the search
    return elasticsearch.search(index='products', body={
        'query': {'match': {'name': query}}
    })

def ensure_indexed(product):
    """Make sure product is in the index with latest data"""
    db_product = database.get_product(product.id)
    es_product = elasticsearch.get(index='products', id=product.id, ignore=404)

    if not es_product or es_product['_source'] != db_product:
        # Re-index to ensure freshness
        elasticsearch.index(index='products', id=product.id, body=db_product)
\`\`\`
      `,
      hint: 'Every search request might trigger indexing...'
    },
    {
      id: 3,
      title: 'Email Campaign Details',
      type: 'testimony',
      content: `
> "We sent an email promoting our top 200 products on sale. The subject line was
> 'Search for these deals!' with links directly to search results pages."
>
> "We got 150K clicks in the first 15 minutes, mostly searching for the same
> promoted products."
>
> — Marketing Team
      `,
      hint: '150K searches for 200 products in 15 minutes...'
    },
    {
      id: 4,
      title: 'Search Request Logs',
      type: 'logs',
      content: `
\`\`\`
# Search requests 3:15 PM - 3:16 PM (1 minute sample)
[3:15:01] search_products("wireless headphones", user=u_8234) -> ensure_indexed(p_123, p_456, p_789)
[3:15:01] search_products("wireless headphones", user=u_9432) -> ensure_indexed(p_123, p_456, p_789)
[3:15:01] search_products("wireless headphones", user=u_1123) -> ensure_indexed(p_123, p_456, p_789)
[3:15:02] search_products("bluetooth speaker", user=u_4521) -> ensure_indexed(p_234, p_567, p_890)
[3:15:02] search_products("wireless headphones", user=u_7823) -> ensure_indexed(p_123, p_456, p_789)
... (800+ requests/second)

Same ensure_indexed calls happening thousands of times for same products.
Each ensure_indexed does: 1 DB read + 1 ES get + 1 ES index
\`\`\`
      `,
      hint: 'ensure_indexed is called on every search, even when unnecessary'
    },
    {
      id: 5,
      title: 'Elasticsearch Comparison Logic',
      type: 'code',
      content: `
\`\`\`python
def ensure_indexed(product):
    db_product = database.get_product(product.id)
    es_product = elasticsearch.get(index='products', id=product.id, ignore=404)

    if not es_product or es_product['_source'] != db_product:
        elasticsearch.index(index='products', id=product.id, body=db_product)

# Problem: es_product['_source'] includes ES metadata:
# {
#   "name": "Wireless Headphones",
#   "price": 99.99,
#   "_indexed_at": "2024-01-15T10:30:00Z"  # Added by ES
# }
#
# db_product doesn't have _indexed_at, so they NEVER match!
# Every comparison fails -> every search triggers a re-index
\`\`\`
      `,
      hint: 'The objects never match because ES adds fields the DB doesn\'t have'
    },
    {
      id: 6,
      title: 'Version Comparison Solution',
      type: 'config',
      content: `
\`\`\`markdown
# Efficient Cache Invalidation Patterns

## Problem: Object Comparison is Fragile
Comparing full objects fails when:
- Different systems add different metadata
- Floating point precision differs
- Timestamps have different formats
- Field ordering varies (JSON)

## Solutions:

1. **Version Numbers**: Increment on change, compare versions only
2. **Content Hashes**: Hash relevant fields only, compare hashes
3. **Updated Timestamps**: Compare last_modified timestamps
4. **Explicit Invalidation**: Don't check—invalidate when data changes

## Anti-Patterns:
- Checking freshness on read path (adds latency, doesn't scale)
- Object equality across systems (too fragile)
- Synchronous re-indexing (blocks read operations)
\`\`\`
      `,
      hint: 'Checking on read path doesn\'t scale; use versions or async invalidation'
    }
  ],

  solution: {
    diagnosis: 'Read-path freshness check always fails due to metadata mismatch, triggering re-index on every search',

    keywords: [
      'elasticsearch', 'indexing', 'ensure_indexed', 'comparison', 'metadata',
      'read path', 'write amplification', 'cache invalidation', 'version',
      'equality', 'mismatch'
    ],

    rootCause: `
      The search service has an "ensure_indexed" function that runs on every search
      request. It compares the database product to the Elasticsearch document to
      check if re-indexing is needed.

      The problem: Elasticsearch adds metadata fields (_indexed_at) that the
      database doesn't have. The objects NEVER match, so every search triggers
      a re-index.

      During the promotional email blast:
      - 150K users searched for ~200 products in 15 minutes
      - Each search called ensure_indexed for ~10 popular products
      - Each ensure_indexed found a "mismatch" and triggered re-indexing
      - Result: 150K × 10 = 1.5M unnecessary index operations

      This write amplification overwhelmed the cluster, making searches slow.
    `,

    codeExamples: [
      {
        lang: 'python',
        description: 'Problematic pattern: freshness check on read path',
        code: `# DON'T DO THIS
def search_products(query, user_id):
    popular_products = get_popular_products(query)
    for product in popular_products:
        ensure_indexed(product)  # Runs on EVERY search!
    return elasticsearch.search(...)`
      },
      {
        lang: 'python',
        description: 'Fixed: Version-based comparison',
        code: `def ensure_indexed(product):
    db_product = database.get_product(product.id)
    es_doc = elasticsearch.get(index='products', id=product.id, ignore=404)

    # Compare versions, not full objects
    db_version = db_product.get('version', 0)
    es_version = es_doc['_source'].get('version', -1) if es_doc else -1

    if db_version > es_version:
        elasticsearch.index(index='products', id=product.id, body=db_product)
        return True
    return False`
      },
      {
        lang: 'python',
        description: 'Better: Async invalidation on write path',
        code: `# Index updates happen when products change, not when searched

def update_product(product_id, data):
    # Update database
    database.update_product(product_id, data)

    # Queue async re-index (don't block the write)
    index_queue.enqueue('reindex_product', product_id)

def search_products(query, user_id):
    # Search only - no indexing!
    return elasticsearch.search(index='products', body={
        'query': {'match': {'name': query}}
    })

# Background worker handles indexing
@worker.task
def reindex_product(product_id):
    product = database.get_product(product_id)
    elasticsearch.index(index='products', id=product_id, body=product)`
      },
      {
        lang: 'python',
        description: 'Best: Debounced batch indexing',
        code: `from collections import defaultdict
import threading

# Collect product IDs to re-index
pending_reindex = set()
reindex_lock = threading.Lock()

def queue_reindex(product_id):
    with reindex_lock:
        pending_reindex.add(product_id)

# Batch re-index every 5 seconds
@scheduler.every(5).seconds
def batch_reindex():
    with reindex_lock:
        if not pending_reindex:
            return
        product_ids = list(pending_reindex)
        pending_reindex.clear()

    products = database.get_products(product_ids)
    bulk_body = []
    for product in products:
        bulk_body.append({'index': {'_index': 'products', '_id': product['id']}})
        bulk_body.append(product)

    elasticsearch.bulk(body=bulk_body)`
      }
    ],

    prevention: [
      'Never do write operations on the read path',
      'Use version numbers or timestamps for comparison, not full object equality',
      'Index updates should be async and triggered by data changes',
      'Debounce and batch index operations to reduce load',
      'Monitor indexing rate alongside search latency',
      'Load test with realistic traffic patterns (burst traffic from emails, etc.)'
    ],

    educationalInsights: [
      'Read paths should be read-only; writes belong on write paths',
      'Object equality across systems is fragile due to metadata, field ordering, types',
      'Write amplification: one logical write triggering many physical writes',
      'Marketing emails create traffic patterns that steady-state monitoring misses',
      'Async processing decouples user-facing latency from background work',
      'Batch operations are far more efficient than individual operations'
    ]
  }
};

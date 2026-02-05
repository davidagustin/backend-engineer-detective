import type { DetectiveCase } from "../../types";

export const restApiPaginationDrift: DetectiveCase = {
	id: "rest-api-pagination-drift",
	title: "The REST API Pagination Drift",
	subtitle: "Users seeing duplicate items due to concurrent inserts",
	difficulty: "mid",
	category: "database",

	crisis: {
		description:
			"Users browsing product listings are reporting seeing duplicate products when scrolling through pages. The same product appears on page 2 and page 3. Customer support is getting complaints about 'ghost products' and 'broken search'.",
		impact:
			"User trust eroding due to inconsistent results. E-commerce conversion down 15% as users distrust search results. Bug reports flooding in during peak shopping hours.",
		timeline: [
			{ time: "10:00 AM", event: "Marketing launches flash sale with new products", type: "normal" },
			{ time: "10:30 AM", event: "First reports of duplicate products in listings", type: "warning" },
			{ time: "11:00 AM", event: "Pattern identified: duplicates appear during heavy browsing", type: "warning" },
			{ time: "12:00 PM", event: "15% drop in add-to-cart rate observed", type: "critical" },
			{ time: "1:00 PM", event: "Correlation found with new product additions", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Product data is correct in database",
			"Single page loads show correct products",
			"API returns valid JSON responses",
			"Product counts are accurate",
		],
		broken: [
			"Same product appears on multiple pages",
			"Some products never appear while scrolling",
			"Issue worse during high-traffic periods",
			"Problem correlates with new product additions",
		],
	},

	clues: [
		{
			id: 1,
			title: "API Endpoint Implementation",
			type: "code",
			content: `\`\`\`typescript
// api/products.ts
app.get('/api/products', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const products = await db.query(\`
    SELECT * FROM products
    WHERE active = true
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  \`, [limit, offset]);

  const total = await db.query(\`
    SELECT COUNT(*) FROM products WHERE active = true
  \`);

  res.json({
    products,
    pagination: {
      page,
      limit,
      total: total.rows[0].count,
      pages: Math.ceil(total.rows[0].count / limit)
    }
  });
});
\`\`\``,
			hint: "OFFSET pagination with ORDER BY created_at DESC...",
		},
		{
			id: 2,
			title: "User Browsing Session",
			type: "logs",
			content: `\`\`\`
User session: user_12345 browsing products

10:31:00 - GET /api/products?page=1&limit=20
  Returned: products 1-20 (sorted by created_at DESC)
  Newest product: P_500 (created 10:30:55)

10:31:15 - GET /api/products?page=2&limit=20
  Returned: products 21-40
  Includes: P_481 (created 10:25:00)

[Meanwhile at 10:31:10, 3 new products added: P_501, P_502, P_503]

10:31:30 - GET /api/products?page=3&limit=20
  Returned: products 41-60
  Includes: P_481 AGAIN! (shifted from position 21 to position 41)

User sees P_481 on both page 2 and page 3!
\`\`\``,
		},
		{
			id: 3,
			title: "Offset Pagination Visualization",
			type: "config",
			content: `\`\`\`
Initial state (10:31:00):
Position: [1  2  3  ... 20] [21 22 23 ... 40] [41 42 43 ... 60]
Page:     [    Page 1     ] [    Page 2     ] [    Page 3     ]
Products: [P500...P481    ] [P480...P461    ] [P460...P441    ]

After 3 new products added (10:31:10):
Position: [1  2  3  4 ... 21] [22 23 24 ... 41] [42 43 44 ... 61]
Page:     [     Page 1      ] [     Page 2    ] [     Page 3    ]
Products: [P503,502,501,500..] [P481...P462   ] [P461...P442   ]

User already fetched page 2 with P481 at position 21.
When they fetch page 3, P481 has shifted to position 42!
P481 appears on BOTH pages.

Meanwhile, P461 shifted from position 40 to 43.
If user fetched page 2 before the insert, they MISSED P461!
\`\`\``,
			hint: "OFFSET pagination breaks when data changes between page fetches",
		},
		{
			id: 4,
			title: "Database Activity Log",
			type: "logs",
			content: `\`\`\`
Products table activity during 10:30-10:35 AM:

10:30:55 - INSERT P_500 (flash sale product)
10:31:02 - INSERT P_501 (flash sale product)
10:31:08 - INSERT P_502 (flash sale product)
10:31:15 - INSERT P_503 (flash sale product)
10:31:22 - INSERT P_504 (flash sale product)
10:31:30 - INSERT P_505 (flash sale product)

During flash sale: ~10 new products per minute
Normal rate: ~2 new products per hour

Every new product shifts ALL other products down by 1 position.
Users browsing during inserts experience constant "drift".
\`\`\``,
		},
		{
			id: 5,
			title: "Pagination Strategies Comparison",
			type: "config",
			content: `\`\`\`markdown
# Pagination Strategies

## Offset Pagination (Current - Problematic)
\`SELECT * FROM products ORDER BY created_at LIMIT 20 OFFSET 40\`

Pros:
- Simple to implement
- Can jump to any page

Cons:
- Unstable with concurrent inserts/deletes
- Performance degrades with large offsets (scans skipped rows)

## Cursor/Keyset Pagination (Recommended)
\`SELECT * FROM products WHERE created_at < $cursor ORDER BY created_at LIMIT 20\`

Pros:
- Stable results regardless of concurrent changes
- Consistent performance (uses index)

Cons:
- Cannot jump to arbitrary page
- Need indexed column for cursor

## Snapshot/Temporal Pagination
\`SELECT * FROM products WHERE created_at < $snapshot_time ORDER BY created_at\`

Pros:
- Completely stable view
- Simple mental model

Cons:
- May miss very new items
- Need to decide snapshot refresh strategy
\`\`\``,
		},
		{
			id: 6,
			title: "Frontend Pagination Code",
			type: "code",
			content: `\`\`\`typescript
// frontend/ProductList.tsx
function ProductList() {
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    fetchProducts(page);
  }, [page]);

  const fetchProducts = async (pageNum: number) => {
    const response = await fetch(\`/api/products?page=\${pageNum}&limit=20\`);
    const data = await response.json();

    if (pageNum === 1) {
      setProducts(data.products);
    } else {
      // Append to existing products (infinite scroll)
      setProducts(prev => [...prev, ...data.products]);
    }
  };

  // Problem: With offset pagination, new products push everything down
  // The next page fetch returns items that shifted into the new offset range
  // Result: duplicates in the accumulated products array
}
\`\`\``,
			hint: "Infinite scroll accumulates pages, making duplicates visible to users",
		},
	],

	solution: {
		diagnosis: "OFFSET-based pagination causes items to shift positions when new items are inserted, leading to duplicates and missed items across page boundaries",
		keywords: [
			"pagination",
			"offset",
			"cursor",
			"keyset",
			"drift",
			"duplicates",
			"concurrent inserts",
			"infinite scroll",
			"rest api",
		],
		rootCause: `The root cause is using OFFSET-based pagination in a dataset with frequent insertions.

OFFSET pagination works by skipping N rows. When the query is:
\`SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 40\`

It means "skip the first 40 rows, return the next 20."

The problem: if new products are inserted between page fetches, all existing products shift position:
- Product at position 21 becomes position 24 (after 3 inserts)
- User who fetched page 2 (positions 21-40) now fetches page 3 (positions 41-60)
- Position 42 is now what was position 39 - a duplicate!

This is especially problematic with:
1. **Infinite scroll**: All pages accumulate, making duplicates visible
2. **High insert rate**: Flash sales, peak hours increase drift
3. **DESC ordering**: New items appear at the top, shifting everything down

The same issue causes missed items - products that were at position 40 shift to 43 and are never seen because the user already "passed" page 2.`,
		codeExamples: [
			{
				lang: "typescript",
				description: "Fixed: Cursor-based pagination API",
				code: `// api/products.ts
app.get('/api/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor; // created_at timestamp of last item

  let query: string;
  let params: any[];

  if (cursor) {
    // Fetch items older than the cursor
    query = \`
      SELECT * FROM products
      WHERE active = true AND created_at < $1
      ORDER BY created_at DESC
      LIMIT $2
    \`;
    params = [cursor, limit + 1]; // +1 to check if there's more
  } else {
    // First page - no cursor
    query = \`
      SELECT * FROM products
      WHERE active = true
      ORDER BY created_at DESC
      LIMIT $1
    \`;
    params = [limit + 1];
  }

  const result = await db.query(query, params);
  const products = result.rows;

  const hasMore = products.length > limit;
  if (hasMore) products.pop(); // Remove the extra item

  const nextCursor = hasMore
    ? products[products.length - 1].created_at.toISOString()
    : null;

  res.json({
    products,
    pagination: {
      nextCursor,
      hasMore
    }
  });
});`,
			},
			{
				lang: "typescript",
				description: "Frontend: Cursor-based infinite scroll",
				code: `// frontend/ProductList.tsx
function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [seen, setSeen] = useState(new Set<string>());

  const fetchProducts = async () => {
    const url = cursor
      ? \`/api/products?limit=20&cursor=\${cursor}\`
      : '/api/products?limit=20';

    const response = await fetch(url);
    const data = await response.json();

    // Deduplicate just in case (belt and suspenders)
    const newProducts = data.products.filter(
      (p: Product) => !seen.has(p.id)
    );

    setProducts(prev => [...prev, ...newProducts]);
    setSeen(prev => {
      const next = new Set(prev);
      newProducts.forEach((p: Product) => next.add(p.id));
      return next;
    });
    setCursor(data.pagination.nextCursor);
    setHasMore(data.pagination.hasMore);
  };

  return (
    <InfiniteScroll
      loadMore={fetchProducts}
      hasMore={hasMore}
    >
      {products.map(p => <ProductCard key={p.id} product={p} />)}
    </InfiniteScroll>
  );
}`,
			},
			{
				lang: "typescript",
				description: "Compound cursor for non-unique columns",
				code: `// When created_at might have duplicates, use compound cursor
app.get('/api/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor
    ? JSON.parse(Buffer.from(req.query.cursor, 'base64').toString())
    : null;

  let query: string;
  let params: any[];

  if (cursor) {
    // Compound cursor: (created_at, id) for deterministic ordering
    query = \`
      SELECT * FROM products
      WHERE active = true
        AND (created_at, id) < ($1, $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    \`;
    params = [cursor.created_at, cursor.id, limit + 1];
  } else {
    query = \`
      SELECT * FROM products
      WHERE active = true
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    \`;
    params = [limit + 1];
  }

  const result = await db.query(query, params);
  const products = result.rows;

  const hasMore = products.length > limit;
  if (hasMore) products.pop();

  const lastProduct = products[products.length - 1];
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({
        created_at: lastProduct.created_at,
        id: lastProduct.id
      })).toString('base64')
    : null;

  res.json({ products, pagination: { nextCursor, hasMore } });
});`,
			},
		],
		prevention: [
			"Use cursor/keyset pagination for datasets with frequent insertions",
			"Add compound cursors (timestamp + ID) for deterministic ordering",
			"Keep offset pagination only for truly static datasets or admin tools",
			"Implement client-side deduplication as a safety net",
			"Monitor for duplicate items in paginated responses",
			"Document pagination behavior in API documentation",
			"Test pagination with concurrent writes in load tests",
		],
		educationalInsights: [
			"OFFSET pagination assumes stable data - insertions break this assumption",
			"Cursor pagination is stable because it uses values, not positions",
			"Infinite scroll amplifies pagination bugs since all pages accumulate",
			"Compound cursors (timestamp + ID) ensure deterministic ordering",
			"Database OFFSET has O(n) performance - must scan skipped rows",
			"Cursor pagination with indexed columns has O(1) seek performance",
		],
	},
};

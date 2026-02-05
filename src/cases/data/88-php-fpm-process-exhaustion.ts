import type { DetectiveCase } from "../../types";

export const phpFpmProcessExhaustion: DetectiveCase = {
	id: "php-fpm-process-exhaustion",
	title: "The 502 Bad Gateway Epidemic",
	subtitle: "All PHP-FPM workers busy handling slow requests",
	difficulty: "mid",
	category: "memory",

	crisis: {
		description:
			"Your PHP application behind Nginx suddenly starts returning 502 Bad Gateway errors to a percentage of users. The errors come in waves and correlate with traffic spikes. The application itself shows no errors in its logs.",
		impact:
			"20-30% of requests failing with 502 during peak hours. Customer checkout failures causing revenue loss. Support flooded with complaints. SEO ranking impacted by error rates.",
		timeline: [
			{ time: "09:00 AM", event: "Morning traffic starts ramping up", type: "normal" },
			{ time: "10:15 AM", event: "First 502 errors appear in Nginx logs", type: "warning" },
			{ time: "10:30 AM", event: "502 rate reaches 15%", type: "warning" },
			{ time: "11:00 AM", event: "Marketing email blast sent, traffic spikes", type: "normal" },
			{ time: "11:05 AM", event: "502 rate spikes to 35%, customers complaining", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Some requests complete successfully",
			"PHP application logs show no errors",
			"Database is responsive",
			"Server has available CPU and memory",
			"Static files served normally by Nginx",
		],
		broken: [
			"502 Bad Gateway errors from Nginx",
			"Errors correlate with traffic volume",
			"Slow requests before 502 occurs",
			"php-fpm slow log full of entries",
			"Nginx upstream timeout errors",
		],
	},

	clues: [
		{
			id: 1,
			title: "Nginx Error Logs",
			type: "logs",
			content: `\`\`\`
[error] 12345#0: *847234 connect() to unix:/var/run/php-fpm.sock
  failed (11: Resource temporarily unavailable) while connecting to upstream

[error] 12346#0: *847235 upstream timed out (110: Connection timed out)
  while reading response header from upstream

[error] 12347#0: *847236 recv() failed (104: Connection reset by peer)
  while reading response header from upstream

# Error frequency by minute:
10:15 - 23 errors
10:30 - 156 errors
10:45 - 312 errors
11:00 - 89 errors
11:05 - 1,247 errors  <-- Traffic spike from email
11:10 - 2,891 errors
\`\`\``,
			hint: "Resource temporarily unavailable means php-fpm socket can't accept more connections",
		},
		{
			id: 2,
			title: "PHP-FPM Status Output",
			type: "metrics",
			content: `\`\`\`
$ curl localhost/fpm-status?full

pool:                 www
process manager:      dynamic
start time:           15/Jan/2024 06:00:00
accepted conn:        2847234
listen queue:         127        <-- QUEUED REQUESTS WAITING
max listen queue:     128
listen queue len:     128
idle processes:       0          <-- NO IDLE WORKERS!
active processes:     50         <-- ALL WORKERS BUSY
total processes:      50
max active processes: 50
max children reached: 47         <-- HIT LIMIT 47 TIMES TODAY

# Per-process details showing slow requests:
pid: 12345 | state: Running | duration: 12847ms | request: GET /api/products/search
pid: 12346 | state: Running | duration: 8234ms | request: GET /api/products/search
pid: 12347 | state: Running | duration: 15123ms | request: POST /api/checkout
pid: 12348 | state: Running | duration: 6789ms | request: GET /api/products/search
...
\`\`\``,
			hint: "All 50 workers are busy, queue is full, no idle processes",
		},
		{
			id: 3,
			title: "PHP-FPM Configuration",
			type: "config",
			content: `\`\`\`ini
; /etc/php-fpm.d/www.conf

[www]
user = nginx
group = nginx

listen = /var/run/php-fpm.sock
listen.backlog = 128

; Process manager settings
pm = dynamic
pm.max_children = 50
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 20
pm.max_requests = 500

; Timeouts
request_terminate_timeout = 60s
request_slowlog_timeout = 5s
slowlog = /var/log/php-fpm/slow.log

; Memory limit per process
php_admin_value[memory_limit] = 256M
\`\`\``,
			hint: "max_children = 50 means only 50 requests can be processed simultaneously",
		},
		{
			id: 4,
			title: "PHP-FPM Slow Log",
			type: "logs",
			content: `\`\`\`
[11-Jan-2024 11:05:23] [pool www] pid 12345
script_filename = /var/www/app/public/index.php
[0x00007f8b2c012340] mysqli_query() /var/www/app/src/Repository/ProductRepository.php:89
[0x00007f8b2c012450] findBySearch() /var/www/app/src/Service/ProductService.php:45
[0x00007f8b2c012560] search() /var/www/app/src/Controller/ProductController.php:67
[0x00007f8b2c012670] searchAction() /var/www/app/public/index.php:23

[11-Jan-2024 11:05:24] [pool www] pid 12346
script_filename = /var/www/app/public/index.php
[0x00007f8b2c012340] mysqli_query() /var/www/app/src/Repository/ProductRepository.php:89
...

# Pattern: All slow requests stuck on the same database query
# ProductRepository::findBySearch taking 5-15 seconds
\`\`\``,
			hint: "The slow log shows where workers are spending their time...",
		},
		{
			id: 5,
			title: "Product Search Query Analysis",
			type: "code",
			content: `\`\`\`php
// ProductRepository.php
class ProductRepository {
    public function findBySearch(string $query, array $filters): array {
        $sql = "SELECT p.*, c.name as category_name,
                       GROUP_CONCAT(t.name) as tags
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN product_tags pt ON p.id = pt.product_id
                LEFT JOIN tags t ON pt.tag_id = t.id
                WHERE p.name LIKE :query
                   OR p.description LIKE :query";

        // Dynamic filter addition
        if (!empty($filters['category'])) {
            $sql .= " AND c.id = :category";
        }
        if (!empty($filters['min_price'])) {
            $sql .= " AND p.price >= :min_price";
        }
        // ... more filters

        $sql .= " GROUP BY p.id ORDER BY p.popularity DESC";

        // No LIMIT clause!
        return $this->db->query($sql, $params);
    }
}

// Database metrics for this query:
// - Products table: 2.4 million rows
// - Query time: 5-15 seconds (no index on LIKE search)
// - Results returned: 50,000+ rows per search
\`\`\``,
			hint: "A slow query with no LIMIT on a large table is blocking workers...",
		},
		{
			id: 6,
			title: "Ops Team Testimony",
			type: "testimony",
			content: `"We've been running with 50 PHP-FPM workers for two years without issues. The search feature has been around forever too. The only thing that changed recently is the product catalog grew from 500K to 2.4 million items after we onboarded three new vendors. We thought about increasing max_children but each PHP process uses 200-256MB of memory, and we only have 16GB RAM. With 50 processes we're already using 12GB for PHP alone."`,
		},
	],

	solution: {
		diagnosis: "PHP-FPM process pool exhaustion due to slow database queries consuming all worker capacity",
		keywords: [
			"php-fpm",
			"502",
			"Bad Gateway",
			"process exhaustion",
			"worker pool",
			"max_children",
			"slow query",
			"connection pool",
			"upstream timeout",
		],
		rootCause: `PHP-FPM uses a process-based model where each request is handled by a dedicated worker process. With max_children=50, only 50 requests can be processed simultaneously.

The product search query is extremely slow (5-15 seconds) because:
1. LIKE '%query%' cannot use indexes - full table scan
2. No LIMIT clause - returns 50,000+ rows
3. Table grew from 500K to 2.4M rows

When many users hit the search endpoint:
1. Each search consumes a worker for 5-15 seconds
2. Workers don't become available for new requests
3. New requests queue up (listen queue)
4. Queue fills up (max 128)
5. Nginx gets "Resource temporarily unavailable"
6. Nginx returns 502 Bad Gateway

The math:
- 50 workers available
- Search takes ~10 seconds average
- Throughput: 50 workers / 10 seconds = 5 searches/second max
- If more than 5 search requests/second arrive, queue fills

Memory limits prevent simply adding more workers (50 * 256MB = 12.8GB already).`,
		codeExamples: [
			{
				lang: "php",
				description: "Fix 1: Optimize the slow query",
				code: `class ProductRepository {
    public function findBySearch(string $query, array $filters): array {
        // Use FULLTEXT index instead of LIKE
        $sql = "SELECT p.id, p.name, p.price, p.image_url,
                       c.name as category_name
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE MATCH(p.name, p.description) AGAINST(:query IN BOOLEAN MODE)";

        if (!empty($filters['category'])) {
            $sql .= " AND c.id = :category";
        }
        if (!empty($filters['min_price'])) {
            $sql .= " AND p.price >= :min_price";
        }

        // CRITICAL: Add LIMIT and use pagination
        $sql .= " ORDER BY p.popularity DESC LIMIT :limit OFFSET :offset";

        $params['limit'] = 50;
        $params['offset'] = ($filters['page'] ?? 0) * 50;

        return $this->db->query($sql, $params);
    }
}

// Also add FULLTEXT index:
// ALTER TABLE products ADD FULLTEXT INDEX idx_search (name, description);`,
			},
			{
				lang: "ini",
				description: "Fix 2: Tune PHP-FPM for your workload",
				code: `; /etc/php-fpm.d/www.conf

[www]
; Use ondemand for variable traffic
pm = ondemand
pm.max_children = 100        ; Increase but monitor memory
pm.process_idle_timeout = 10s

; Shorter request timeout - fail fast
request_terminate_timeout = 30s

; Lower memory per process where possible
php_admin_value[memory_limit] = 128M

; Alternative: Use static for predictable load
; pm = static
; pm.max_children = 75  ; Based on available memory`,
			},
			{
				lang: "php",
				description: "Fix 3: Implement search with Elasticsearch",
				code: `class ProductSearchService {
    private ElasticsearchClient $client;

    public function search(string $query, array $filters): SearchResult {
        $params = [
            'index' => 'products',
            'body' => [
                'query' => [
                    'bool' => [
                        'must' => [
                            'multi_match' => [
                                'query' => $query,
                                'fields' => ['name^3', 'description'],
                                'type' => 'best_fields',
                                'fuzziness' => 'AUTO'
                            ]
                        ],
                        'filter' => $this->buildFilters($filters)
                    ]
                ],
                'size' => 50,
                'from' => ($filters['page'] ?? 0) * 50,
                'sort' => [
                    ['popularity' => 'desc']
                ]
            ]
        ];

        // Elasticsearch query: ~10-50ms vs 5-15 seconds
        $response = $this->client->search($params);

        return new SearchResult($response);
    }
}`,
			},
		],
		prevention: [
			"Monitor PHP-FPM pool status (active/idle/queue) continuously",
			"Set alerts on max_children_reached and listen queue depth",
			"Always LIMIT queries that could return many rows",
			"Use database query timeouts shorter than PHP request timeout",
			"Consider dedicated search infrastructure (Elasticsearch, Algolia)",
			"Implement request timeouts at Nginx level as backstop",
		],
		educationalInsights: [
			"PHP-FPM processes are not like threads - each is a full PHP interpreter",
			"502 Bad Gateway often means 'upstream service unavailable' not 'server error'",
			"listen.backlog limits queued connections before Nginx gets errors",
			"One slow endpoint can consume entire worker pool during traffic spikes",
			"Memory limits often constrain how many workers you can run",
			"Process-per-request model trades memory for isolation",
		],
	},
};

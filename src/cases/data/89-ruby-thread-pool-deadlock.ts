import type { DetectiveCase } from "../../types";

export const rubyThreadPoolDeadlock: DetectiveCase = {
	id: "ruby-thread-pool-deadlock",
	title: "The Circular Wait",
	subtitle: "All Puma workers frozen waiting for database connections",
	difficulty: "senior",
	category: "memory",

	crisis: {
		description:
			"Your Ruby on Rails application suddenly stops responding to all requests. Puma shows all workers as busy, but CPU usage is near zero. The application appears completely frozen, requiring a restart to recover.",
		impact:
			"Complete service outage lasting until manual restart. All API endpoints unresponsive. Background job processing halted. Multiple incidents per day requiring on-call intervention.",
		timeline: [
			{ time: "14:00", event: "Application running normally", type: "normal" },
			{ time: "14:23", event: "Response times start increasing", type: "warning" },
			{ time: "14:25", event: "All workers show 'busy' status", type: "warning" },
			{ time: "14:26", event: "CPU drops to 0%, no requests completing", type: "critical" },
			{ time: "14:35", event: "Manual restart required to recover", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Application starts normally after restart",
			"Works fine for hours before freezing",
			"Database is responsive to direct queries",
			"Memory usage is normal",
			"No exceptions in logs during freeze",
		],
		broken: [
			"All Puma workers show busy but 0% CPU",
			"No requests complete during freeze",
			"Health checks timeout",
			"No new log entries during freeze",
			"kill -3 shows threads waiting on monitors",
		],
	},

	clues: [
		{
			id: 1,
			title: "Puma Stats During Freeze",
			type: "metrics",
			content: `\`\`\`
$ curl localhost:9293/stats

{
  "workers": 4,
  "phase": 0,
  "booted_workers": 4,
  "old_workers": 0,
  "worker_status": [
    {
      "pid": 12345,
      "index": 0,
      "phase": 0,
      "booted": true,
      "last_checkin": "2024-01-15T14:25:42Z",  <-- 10 mins ago!
      "last_status": {
        "backlog": 127,
        "running": 16,      <-- All 16 threads busy
        "pool_capacity": 0  <-- No capacity left!
      }
    },
    // ... same for all 4 workers
  ]
}

# Configuration:
# - 4 Puma workers (processes)
# - 16 threads per worker
# - Database connection pool: 5 per worker
\`\`\``,
			hint: "16 threads but only 5 database connections per worker...",
		},
		{
			id: 2,
			title: "Thread Dump (kill -TTIN)",
			type: "logs",
			content: `\`\`\`
Thread: TID-12345 (waiting)
  /gems/activerecord-7.0.4/lib/active_record/connection_adapters/abstract/connection_pool.rb:291:in 'wait'
  /gems/activerecord-7.0.4/lib/active_record/connection_adapters/abstract/connection_pool.rb:291:in 'checkout'

Thread: TID-12346 (waiting)
  /gems/activerecord-7.0.4/lib/active_record/connection_adapters/abstract/connection_pool.rb:291:in 'wait'
  ...

Thread: TID-12347 (holding connection, waiting)
  /app/services/order_service.rb:45:in 'block in process_order'
  /gems/activerecord-7.0.4/lib/active_record/connection_adapters/abstract/connection_pool.rb:291:in 'wait'

# Pattern:
# - 11 threads waiting for database connection
# - 5 threads holding connections, ALSO waiting for more connections
# - Classic deadlock: everyone waiting, no one can proceed
\`\`\``,
			hint: "Threads holding connections are also waiting for connections...",
		},
		{
			id: 3,
			title: "OrderService Code",
			type: "code",
			content: `\`\`\`ruby
class OrderService
  def process_order(order_id)
    order = Order.find(order_id)  # Acquires connection 1

    # Process items in parallel for "performance"
    threads = order.items.map do |item|
      Thread.new do
        # Each thread tries to get its own connection!
        InventoryService.new.reserve_inventory(item)  # Needs connection 2
        PaymentService.new.process_item_payment(item) # Needs connection 3
      end
    end

    threads.each(&:join)  # Wait for all threads

    order.update!(status: 'processed')
  end
end

class InventoryService
  def reserve_inventory(item)
    # Implicit database connection from pool
    Inventory.transaction do
      inv = Inventory.lock.find_by(product_id: item.product_id)
      inv.update!(reserved: inv.reserved + item.quantity)
      InventoryLog.create!(item: item, action: 'reserve')
    end
  end
end
\`\`\``,
			hint: "The main thread holds a connection while spawning threads that need more connections...",
		},
		{
			id: 4,
			title: "Database Configuration",
			type: "config",
			content: `\`\`\`yaml
# config/database.yml
production:
  adapter: postgresql
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  timeout: 5000
  host: db.example.com

# config/puma.rb
workers ENV.fetch("WEB_CONCURRENCY") { 4 }
threads_count = ENV.fetch("RAILS_MAX_THREADS") { 16 }
threads threads_count, threads_count

# The math doesn't work:
# - 16 threads per worker
# - 5 database connections per worker
# - If >5 threads need connections simultaneously = trouble
\`\`\``,
			hint: "16 threads competing for 5 connections...",
		},
		{
			id: 5,
			title: "Connection Pool Timeout Logs",
			type: "logs",
			content: `\`\`\`
# Just before complete freeze, these appear:

ActiveRecord::ConnectionTimeoutError: could not obtain a connection from the pool within 5.000 seconds (waited 5.001 seconds); all pooled connections were in use
  /gems/activerecord-7.0.4/lib/active_record/connection_adapters/abstract/connection_pool.rb:293:in 'checkout'

# Then silence... no more logs
# The timeout errors stop because no threads can make progress
# Even timeout handling requires a connection!

# Connection pool state at freeze:
# - 5 connections checked out
# - 11 threads waiting (blocking indefinitely after timeout change)
# - The 5 holding threads are also waiting for more connections
\`\`\``,
		},
		{
			id: 6,
			title: "Senior Developer Testimony",
			type: "testimony",
			content: `"I added the parallel processing to speed up large orders. It worked great in development where I test with small orders and SQLite. In production, orders can have 20+ items, and we use Postgres with a connection pool. I didn't realize each Thread.new would need its own database connection. I thought Rails handled that automatically. The weird thing is it works fine for small orders - the deadlock only happens with larger ones that spawn more threads than we have connections."`,
		},
	],

	solution: {
		diagnosis: "Database connection pool deadlock from nested parallelism consuming all available connections",
		keywords: [
			"deadlock",
			"connection pool",
			"thread pool",
			"ActiveRecord",
			"ConnectionTimeoutError",
			"nested threading",
			"pool exhaustion",
			"circular wait",
		],
		rootCause: `Classic deadlock caused by nested parallelism with limited database connections:

1. Request thread A calls process_order(), acquires DB connection
2. Thread A spawns N child threads for parallel item processing
3. Each child thread tries to acquire its own DB connection
4. With pool size 5 and N > 4, children must wait for connections
5. Thread A is waiting for children (join), holding its connection
6. Children waiting for connections that Thread A won't release
7. DEADLOCK: A waits for children, children wait for A's connection

Configuration mismatch:
- Puma: 16 threads per worker
- Pool: 5 connections per worker
- Any code path spawning >4 nested threads = potential deadlock

The freeze happens when multiple requests hit this code path simultaneously:
- Request 1: holds 1 conn, 4 children each get 1 conn (5 total)
- Request 2: holds 1 conn... now waiting
- Request 1's children finish but can't return - Request 1 is blocked
- Everyone waiting, no progress possible`,
		codeExamples: [
			{
				lang: "ruby",
				description: "Fix 1: Process sequentially (safest)",
				code: `class OrderService
  def process_order(order_id)
    order = Order.find(order_id)

    # Process items sequentially - one connection is enough
    order.items.each do |item|
      InventoryService.new.reserve_inventory(item)
      PaymentService.new.process_item_payment(item)
    end

    order.update!(status: 'processed')
  end
end`,
			},
			{
				lang: "ruby",
				description: "Fix 2: Use connection pool properly with concurrent-ruby",
				code: `require 'concurrent'

class OrderService
  # Thread pool sized to match available connections
  POOL = Concurrent::FixedThreadPool.new(
    ENV.fetch('RAILS_MAX_THREADS', 5).to_i - 1  # Leave 1 for main thread
  )

  def process_order(order_id)
    order = Order.find(order_id)

    # Limit concurrency to available connections
    futures = order.items.map do |item|
      Concurrent::Future.execute(executor: POOL) do
        # Each future runs in pool with limited parallelism
        ActiveRecord::Base.connection_pool.with_connection do
          InventoryService.new.reserve_inventory(item)
          PaymentService.new.process_item_payment(item)
        end
      end
    end

    # Wait for all with timeout
    futures.each { |f| f.value!(30) }

    order.update!(status: 'processed')
  end
end`,
			},
			{
				lang: "yaml",
				description: "Fix 3: Match pool size to threads",
				code: `# config/database.yml
production:
  adapter: postgresql
  # Pool size should equal max threads
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 16 } %>
  timeout: 5000
  checkout_timeout: 5

# config/puma.rb
# Reduce threads to match reasonable connection pool
workers ENV.fetch("WEB_CONCURRENCY") { 4 }
max_threads = ENV.fetch("RAILS_MAX_THREADS") { 5 }
threads max_threads, max_threads

# Alternative: More workers, fewer threads
# workers 8
# threads 5, 5
# Each worker: 5 threads, 5 connections = safe`,
			},
			{
				lang: "ruby",
				description: "Fix 4: Use database-level parallelism instead",
				code: `class OrderService
  def process_order(order_id)
    order = Order.find(order_id)

    # Let the database handle parallelism via bulk operations
    Order.transaction do
      item_ids = order.items.pluck(:id)
      product_ids = order.items.pluck(:product_id)

      # Bulk lock and update inventory
      Inventory.where(product_id: product_ids).lock.each do |inv|
        item = order.items.find { |i| i.product_id == inv.product_id }
        inv.update!(reserved: inv.reserved + item.quantity)
      end

      # Bulk insert logs
      logs = order.items.map { |i| { item_id: i.id, action: 'reserve' } }
      InventoryLog.insert_all(logs)

      order.update!(status: 'processed')
    end
  end
end`,
			},
		],
		prevention: [
			"Never spawn more threads than available database connections",
			"Match RAILS_MAX_THREADS with database pool size",
			"Avoid nested parallelism that multiplies connection needs",
			"Use connection_pool.with_connection for explicit connection management",
			"Set checkout_timeout and handle timeouts gracefully",
			"Consider async job processing instead of inline parallelism",
		],
		educationalInsights: [
			"Deadlock requires: mutual exclusion, hold and wait, no preemption, circular wait",
			"Ruby threads need explicit connection checkout from ActiveRecord pool",
			"Thread.new doesn't inherit parent's database connection",
			"SQLite uses different connection model - works differently in dev vs prod",
			"Connection pool timeout hides the real problem until complete deadlock",
			"More threads != more performance when database is the bottleneck",
		],
	},
};

import type { DetectiveCase } from "../../types";

export const pythonGilContention: DetectiveCase = {
	id: "python-gil-contention",
	title: "The Paradox of Parallelism",
	subtitle: "Adding more threads makes the application slower",
	difficulty: "senior",
	category: "memory",

	crisis: {
		description:
			"Your Python data processing service was refactored to use multi-threading for better performance on your 16-core server. Instead of the expected 10-16x speedup, performance dropped by 40%. Adding more threads makes it even slower.",
		impact:
			"Batch jobs taking 3x longer than before. Processing backlog growing. Resource costs doubled (more servers needed). Team confused - threading should help, not hurt.",
		timeline: [
			{ time: "Monday 9 AM", event: "Threading refactor deployed", type: "normal" },
			{ time: "Monday 11 AM", event: "Batch jobs running slower than expected", type: "warning" },
			{ time: "Monday 2 PM", event: "Increased thread pool to 16 threads", type: "normal" },
			{ time: "Monday 4 PM", event: "Performance degraded further, 40% slower", type: "critical" },
			{ time: "Tuesday 10 AM", event: "Reverted to single-threaded, performance restored", type: "warning" },
		],
	},

	symptoms: {
		working: [
			"Code produces correct results",
			"No errors or exceptions",
			"Single-threaded version runs normally",
			"Memory usage is acceptable",
			"Individual operations complete correctly",
		],
		broken: [
			"Multi-threaded version slower than single-threaded",
			"Adding threads decreases performance",
			"CPU usage at 100% but only one core really working",
			"Threads spend most time waiting",
			"No speedup on CPU-bound tasks",
		],
	},

	clues: [
		{
			id: 1,
			title: "Performance Benchmarks",
			type: "metrics",
			content: `\`\`\`
Task: Process 10,000 data records with CPU-intensive transformation

Configuration          | Time      | Records/sec | CPU Usage
-----------------------|-----------|-------------|------------
Single-threaded        | 45.2s     | 221         | 100% (1 core)
2 threads              | 47.8s     | 209         | 105% average
4 threads              | 52.3s     | 191         | 120% average
8 threads              | 61.7s     | 162         | 150% average
16 threads             | 78.4s     | 128         | 180% average

# Expected with 16 threads: ~3s (16x faster)
# Actual with 16 threads: 78s (1.7x SLOWER)

# CPU "usage" is high but work throughput is LOW
# More threads = worse performance
\`\`\``,
			hint: "Notice how adding threads increases total CPU time but decreases throughput...",
		},
		{
			id: 2,
			title: "Thread Profiling Output",
			type: "logs",
			content: `\`\`\`
$ py-spy record -o profile.svg --threads python processor.py

Thread State Analysis (16 threads, 60 second sample):

Thread-1:  Running: 12.3% | Waiting: 87.7%
Thread-2:  Running: 11.8% | Waiting: 88.2%
Thread-3:  Running: 12.1% | Waiting: 87.9%
Thread-4:  Running: 11.5% | Waiting: 88.5%
Thread-5:  Running: 12.0% | Waiting: 88.0%
...
Thread-16: Running: 11.9% | Waiting: 88.1%

Wait Reason Breakdown:
├── GIL acquisition: 84.2%
├── I/O wait: 2.1%
├── Lock wait: 1.4%
└── Other: 0.3%

# 84% of time spent waiting to acquire the GIL!
\`\`\``,
			hint: "GIL acquisition is consuming most of the thread wait time...",
		},
		{
			id: 3,
			title: "Data Processor Code",
			type: "code",
			content: `\`\`\`python
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np

class DataProcessor:
    def __init__(self, num_workers=16):
        self.executor = ThreadPoolExecutor(max_workers=num_workers)

    def process_batch(self, records):
        """Process records in parallel using thread pool."""
        futures = []
        for record in records:
            future = self.executor.submit(self.process_record, record)
            futures.append(future)

        results = [f.result() for f in futures]
        return results

    def process_record(self, record):
        """CPU-intensive data transformation."""
        # Parse and transform data
        data = self.parse_data(record)

        # Heavy computation in pure Python
        result = self.compute_statistics(data)
        result = self.apply_transformations(result)
        result = self.normalize_values(result)

        return result

    def compute_statistics(self, data):
        """Pure Python statistical calculations."""
        n = len(data)
        mean = sum(data) / n
        variance = sum((x - mean) ** 2 for x in data) / n
        std_dev = variance ** 0.5

        # More pure Python loops
        normalized = [(x - mean) / std_dev for x in data]
        return normalized

    def apply_transformations(self, data):
        """More CPU-bound Python operations."""
        result = []
        for value in data:
            # Complex transformation
            transformed = self.sigmoid(value) * self.custom_function(value)
            result.append(transformed)
        return result
\`\`\``,
			hint: "Notice these are pure Python loops and calculations, not I/O operations...",
		},
		{
			id: 4,
			title: "GIL Explanation Diagram",
			type: "logs",
			content: `\`\`\`
The Global Interpreter Lock (GIL) in CPython:

Single Thread (works fine):
┌─────────────────────────────────────────────────────┐
│ Thread-1: [GIL] ████████████████████████████████   │
│           Work: ████████████████████████████████   │
└─────────────────────────────────────────────────────┘
Total time: 45 seconds, 100% efficient

Multi-threaded (GIL contention):
┌─────────────────────────────────────────────────────────────────────────────┐
│ Thread-1: [GIL] ██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██          │
│ Thread-2: [GIL] ░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██        │
│ Thread-3: [GIL] ░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██      │
│ Thread-4: [GIL] ░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░██░░░░░░      │
└─────────────────────────────────────────────────────────────────────────────┘
██ = Running (has GIL)    ░░ = Waiting for GIL

Only ONE thread can execute Python bytecode at a time!
Other threads just add context-switching overhead.
\`\`\``,
		},
		{
			id: 5,
			title: "sys._current_frames Analysis",
			type: "logs",
			content: `\`\`\`python
# Runtime inspection shows all threads at similar points
>>> import sys, threading
>>> for tid, frame in sys._current_frames().items():
...     print(f"Thread {tid}: {frame.f_code.co_filename}:{frame.f_lineno}")

Thread 140234567891712: processor.py:45  # compute_statistics
Thread 140234567891456: processor.py:47  # compute_statistics (waiting)
Thread 140234567891200: processor.py:46  # compute_statistics (waiting)
Thread 140234567890944: processor.py:45  # compute_statistics (waiting)
Thread 140234567890688: processor.py:48  # compute_statistics (waiting)
...

# All threads trying to run the same CPU-bound code
# Only one can make progress at a time
# The GIL switches between them every 5ms (sys.getswitchinterval())
# Each switch has overhead: save state, wake other thread, restore state
\`\`\``,
		},
		{
			id: 6,
			title: "Tech Lead Testimony",
			type: "testimony",
			content: `"I've used threading in Java and it works great for CPU-bound work. I assumed Python would be the same. The documentation mentions the GIL but says it's released during I/O operations, so I thought our compute-heavy code would benefit from multiple threads since we're not doing I/O. I tried numpy arrays thinking that would help, but the loops around the numpy calls are still pure Python. Someone mentioned 'multiprocessing' but I thought that was just a more complicated way to do the same thing as threading."`,
		},
	],

	solution: {
		diagnosis: "GIL (Global Interpreter Lock) contention causing multi-threaded CPU-bound code to run slower than single-threaded",
		keywords: [
			"GIL",
			"Global Interpreter Lock",
			"threading",
			"multiprocessing",
			"CPU-bound",
			"thread contention",
			"Python threading",
			"concurrent.futures",
			"ProcessPoolExecutor",
		],
		rootCause: `CPython (the standard Python implementation) has a Global Interpreter Lock (GIL) that allows only ONE thread to execute Python bytecode at a time. This exists to protect Python's memory management, which is not thread-safe.

For CPU-bound tasks (pure Python computation):
- Multiple threads don't provide parallelism
- Threads constantly fight for the GIL
- Context switching between threads adds overhead
- More threads = more contention = worse performance

The GIL is released during:
- I/O operations (file, network, database)
- Some C extensions (numpy operations on arrays)
- Explicit release (time.sleep, some libraries)

But your code has Python loops around the operations:
\`\`\`python
for value in data:  # <-- This loop holds the GIL
    transformed = self.sigmoid(value)  # Each iteration needs GIL
\`\`\`

Even if sigmoid used numpy internally, the Python for-loop iteration holds the GIL.

Threading in Python is useful for:
- I/O-bound tasks (network calls, file operations)
- Waiting on external resources
- GUI responsiveness

For CPU-bound Python code, you need multiple PROCESSES (not threads), each with its own Python interpreter and GIL.`,
		codeExamples: [
			{
				lang: "python",
				description: "Fix 1: Use ProcessPoolExecutor for CPU-bound work",
				code: `from concurrent.futures import ProcessPoolExecutor
import multiprocessing

class DataProcessor:
    def __init__(self, num_workers=None):
        # Default to number of CPU cores
        self.num_workers = num_workers or multiprocessing.cpu_count()

    def process_batch(self, records):
        """Process records in parallel using PROCESSES."""
        # ProcessPoolExecutor uses separate processes, each with own GIL
        with ProcessPoolExecutor(max_workers=self.num_workers) as executor:
            results = list(executor.map(self.process_record, records))
        return results

    def process_record(self, record):
        """This runs in a separate process - no GIL contention."""
        data = self.parse_data(record)
        result = self.compute_statistics(data)
        result = self.apply_transformations(result)
        result = self.normalize_values(result)
        return result

# Performance with ProcessPoolExecutor (16 cores):
# Single process: 45.2s
# 16 processes: 3.8s (11.9x speedup!)`,
			},
			{
				lang: "python",
				description: "Fix 2: Use numpy vectorized operations (releases GIL)",
				code: `import numpy as np

class DataProcessor:
    def compute_statistics_vectorized(self, data):
        """Vectorized numpy - GIL released during numpy operations."""
        # Convert to numpy array once
        arr = np.array(data)

        # These operations release the GIL and run in parallel
        mean = np.mean(arr)
        std_dev = np.std(arr)
        normalized = (arr - mean) / std_dev

        return normalized

    def apply_transformations_vectorized(self, data):
        """Vectorized transformations."""
        arr = np.array(data)

        # Sigmoid on entire array at once (GIL released)
        sigmoid_result = 1 / (1 + np.exp(-arr))

        # Custom function vectorized
        transformed = sigmoid_result * np.sin(arr) * np.exp(-arr**2)

        return transformed

# Now threading CAN help because numpy releases GIL during computation
# But ProcessPoolExecutor is still often simpler and more reliable`,
			},
			{
				lang: "python",
				description: "Fix 3: Use joblib for easy parallelization",
				code: `from joblib import Parallel, delayed

class DataProcessor:
    def __init__(self, num_workers=-1):  # -1 = use all cores
        self.num_workers = num_workers

    def process_batch(self, records):
        """joblib automatically uses processes for CPU-bound work."""
        results = Parallel(n_jobs=self.num_workers)(
            delayed(self.process_record)(record)
            for record in records
        )
        return results

# joblib benefits:
# - Automatically serializes/deserializes data
# - Memory-maps large arrays to avoid copying
# - Has 'loky' backend optimized for CPU-bound work
# - Simple API that looks like a list comprehension`,
			},
		],
		prevention: [
			"Use multiprocessing or ProcessPoolExecutor for CPU-bound Python code",
			"Use threading only for I/O-bound tasks (network, disk, database)",
			"Consider numpy vectorization to release GIL during computation",
			"Profile with py-spy to identify GIL contention",
			"Consider Cython or numba for CPU-intensive inner loops",
			"For new projects, consider languages without GIL (Go, Rust, Java)",
		],
		educationalInsights: [
			"The GIL is a CPython implementation detail, not a Python language feature",
			"Other Python implementations (Jython, IronPython) don't have a GIL",
			"Python 3.12 has experimental free-threading mode (no GIL)",
			"Process-based parallelism has higher overhead but true parallelism",
			"Some C extensions (numpy, scipy) release the GIL during computation",
			"asyncio is for concurrent I/O, not parallel CPU computation",
		],
	},
};

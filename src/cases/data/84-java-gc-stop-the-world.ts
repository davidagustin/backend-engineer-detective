import type { DetectiveCase } from "../../types";

export const javaGcStopTheWorld: DetectiveCase = {
	id: "java-gc-stop-the-world",
	title: "The 30-Second Freeze",
	subtitle: "Java application pauses completely during garbage collection",
	difficulty: "principal",
	category: "memory",

	crisis: {
		description:
			"Your high-throughput Java trading platform experiences complete freezes lasting 20-30 seconds. During these pauses, no requests are processed, WebSocket connections drop, and downstream services timeout. The freezes occur roughly every 30-45 minutes.",
		impact:
			"Trading halted during GC pauses causing $50K+ per incident in missed opportunities. SLA violations mounting. Regulatory concerns about system reliability. Customer trust eroding.",
		timeline: [
			{ time: "09:00 AM", event: "Market opens, system operating normally", type: "normal" },
			{ time: "09:47 AM", event: "First 28-second freeze detected", type: "critical" },
			{ time: "10:33 AM", event: "Second freeze, 31 seconds, trades missed", type: "critical" },
			{ time: "11:15 AM", event: "Third freeze during high-volume period", type: "critical" },
			{ time: "11:45 AM", event: "Emergency escalation, manual intervention required", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Application functions normally between freezes",
			"Memory is not exhausted (heap has available space)",
			"No OutOfMemoryErrors thrown",
			"CPU usage normal except during pauses",
			"All external dependencies healthy",
		],
		broken: [
			"Complete application freeze for 20-30 seconds",
			"ALL threads stop simultaneously",
			"No logs written during freeze",
			"WebSocket heartbeats missed, connections drop",
			"Downstream timeout errors during freezes",
		],
	},

	clues: [
		{
			id: 1,
			title: "GC Logs Analysis",
			type: "logs",
			content: `\`\`\`
# GC Log showing the problem
[2024-01-15T09:47:23.445+0000][gc] GC(1247) Pause Young (Allocation Failure) 4521M->4498M(6144M) 234.567ms
[2024-01-15T09:47:31.892+0000][gc] GC(1248) Pause Young (Allocation Failure) 4612M->4589M(6144M) 198.234ms
[2024-01-15T09:47:44.123+0000][gc] GC(1249) Pause Full (Allocation Failure) 5834M->4123M(6144M) 28456.789ms
                                                                                              ^^^^^^^^^^^^
                                                                                              28 SECONDS!

# Full GC triggered when Old Gen fills up
[2024-01-15T09:47:44.123+0000][gc,phases] GC(1249) Phase 1: Mark live objects 12456.234ms
[2024-01-15T09:47:44.123+0000][gc,phases] GC(1249) Phase 2: Compute new addresses 3421.123ms
[2024-01-15T09:47:44.123+0000][gc,phases] GC(1249) Phase 3: Adjust pointers 8234.567ms
[2024-01-15T09:47:44.123+0000][gc,phases] GC(1249) Phase 4: Move objects 4344.865ms

# Memory before/after
Old Gen: 5834M -> 4123M (freed 1711M)
\`\`\``,
			hint: "28 seconds is the Full GC pause time - this is a stop-the-world event",
		},
		{
			id: 2,
			title: "JVM Configuration",
			type: "config",
			content: `\`\`\`bash
# Current JVM flags
java -Xms6g -Xmx6g \\
     -XX:+UseConcMarkSweepGC \\
     -XX:+CMSParallelRemarkEnabled \\
     -XX:CMSInitiatingOccupancyFraction=70 \\
     -XX:+UseCMSInitiatingOccupancyOnly \\
     -XX:+PrintGCDetails \\
     -XX:+PrintGCDateStamps \\
     -Xloggc:/var/log/gc.log \\
     -jar trading-platform.jar

# System info
Java Version: 11.0.2
OS: Linux 5.4.0
Cores: 16
RAM: 32GB
\`\`\``,
			hint: "CMS collector was deprecated in Java 9 and has known issues with large heaps...",
		},
		{
			id: 3,
			title: "Heap Dump Analysis",
			type: "metrics",
			content: `\`\`\`
Heap Composition Before Full GC:

Old Generation (5834M total):
├── TradeHistory objects: 2.1GB (36%)
│   └── 14.2 million TradeHistory instances
│   └── Average age: 8 GC cycles
├── OrderBook snapshots: 1.8GB (31%)
│   └── 2.3 million OrderBookSnapshot instances
│   └── Referenced by: HistoricalDataService.snapshots (LinkedList)
├── byte[] arrays: 0.9GB (15%)
│   └── Serialized market data
├── String objects: 0.6GB (10%)
│   └── 8.7 million interned strings
└── Other: 0.4GB (8%)

Object Retention:
- 89% of Old Gen objects survive each Full GC
- Average object lifespan: 47 minutes
- Large objects (>1MB): 1,247 instances

Fragmentation:
- Free space: 310M in 47,823 fragments
- Largest contiguous free: 2.1M
- Fragmentation ratio: 0.87 (highly fragmented)
\`\`\``,
			hint: "High object survival + fragmentation = CMS worst case scenario",
		},
		{
			id: 4,
			title: "CMS Concurrent Mode Failure",
			type: "logs",
			content: `\`\`\`
# Warning signs before the Full GC
[gc,promotion] GC(1247) Promotion failed
[gc           ] GC(1248) concurrent mark aborted
[gc           ] GC(1249) Pause Full (Allocation Failure)

# What happened:
1. CMS was running concurrent mark phase
2. Young GC tried to promote objects to Old Gen
3. Old Gen too fragmented - no contiguous space for large object
4. CMS aborted, fell back to Serial Full GC (stop-the-world)
5. Serial collector compacts entire heap - 28 seconds

# CMS concurrent phases (normally non-blocking):
- Initial Mark: 45ms (STW)
- Concurrent Mark: 2.3s (concurrent)
- Remark: 234ms (STW)
- Concurrent Sweep: 1.8s (concurrent)

# But when promotion fails:
- Falls back to SERIAL FULL GC
- Must stop ALL threads
- Compacts entire 6GB heap
\`\`\``,
			hint: "Concurrent Mode Failure triggers a serial full GC - the worst case for CMS",
		},
		{
			id: 5,
			title: "Application Memory Pattern",
			type: "code",
			content: `\`\`\`java
@Service
public class HistoricalDataService {
    // Unbounded cache of historical snapshots
    private final LinkedList<OrderBookSnapshot> snapshots = new LinkedList<>();

    @Scheduled(fixedRate = 100) // Every 100ms
    public void captureSnapshot() {
        OrderBookSnapshot snapshot = orderBook.createSnapshot();
        snapshots.addLast(snapshot);

        // "Cleanup" - only keep last hour
        long oneHourAgo = System.currentTimeMillis() - 3600000;
        while (!snapshots.isEmpty() &&
               snapshots.getFirst().getTimestamp() < oneHourAgo) {
            snapshots.removeFirst();
        }
    }
}

// Each snapshot is ~800KB
// 36,000 snapshots/hour = 28.8GB of allocations/hour
// Objects live for exactly 1 hour before becoming garbage
\`\`\``,
			hint: "Objects that live for exactly 1 hour create the worst GC pattern...",
		},
		{
			id: 6,
			title: "SRE Team Testimony",
			type: "testimony",
			content: `"We've been running CMS for years without issues, but traffic has grown 5x in the last 18 months. We increased heap from 2GB to 6GB thinking it would help. The pauses actually got WORSE after the heap increase. We tried tuning CMSInitiatingOccupancyFraction down to 60%, but then GC ran constantly and throughput dropped 40%. It feels like we're stuck between constant minor GC overhead and occasional catastrophic pauses."`,
		},
	],

	solution: {
		diagnosis: "CMS collector concurrent mode failures causing serial Full GC stop-the-world pauses on fragmented large heap",
		keywords: [
			"garbage collection",
			"GC pause",
			"stop-the-world",
			"STW",
			"Full GC",
			"CMS",
			"concurrent mode failure",
			"heap fragmentation",
			"G1GC",
			"ZGC",
			"promotion failure",
		],
		rootCause: `The CMS (Concurrent Mark Sweep) collector has a fundamental flaw: it doesn't compact memory. Over time, the Old Generation becomes fragmented. When a Young GC tries to promote a large object to Old Gen, but no contiguous space exists, CMS experiences a "Concurrent Mode Failure" and falls back to a Serial Full GC.

The Serial Full GC must:
1. Stop ALL application threads (stop-the-world)
2. Mark ALL live objects in the entire heap
3. Compact the ENTIRE heap to defragment
4. Resume application threads

With a 6GB heap and 89% object survival rate, this takes 28+ seconds.

The application pattern makes it worse:
- Objects live for exactly 1 hour (OrderBook snapshots)
- High allocation rate (28.8GB/hour)
- Objects are "medium-lived" - too long for Young Gen, fill up Old Gen
- Large object sizes (800KB) require contiguous space

Increasing heap size made it worse because:
- More memory to scan during Full GC
- More fragmentation over time
- Longer pauses when failure occurs`,
		codeExamples: [
			{
				lang: "bash",
				description: "Solution: Switch to G1GC with proper tuning",
				code: `# G1GC (Garbage First) - designed for large heaps with predictable pauses
java -Xms6g -Xmx6g \\
     -XX:+UseG1GC \\
     -XX:MaxGCPauseMillis=200 \\
     -XX:G1HeapRegionSize=16m \\
     -XX:InitiatingHeapOccupancyPercent=45 \\
     -XX:G1ReservePercent=15 \\
     -XX:+ParallelRefProcEnabled \\
     -XX:+G1UseAdaptiveIHOP \\
     -Xlog:gc*:file=/var/log/gc.log:time,uptime:filecount=5,filesize=10m \\
     -jar trading-platform.jar

# Key differences from CMS:
# - G1 compacts incrementally (no catastrophic full GC)
# - Region-based (16MB regions) - can compact subset
# - MaxGCPauseMillis=200 targets 200ms max pause
# - Mixed GCs collect Old Gen incrementally`,
			},
			{
				lang: "bash",
				description: "For ultra-low latency: ZGC (Java 15+)",
				code: `# ZGC - sub-millisecond pauses regardless of heap size
java -Xms6g -Xmx6g \\
     -XX:+UseZGC \\
     -XX:+ZGenerational \\
     -XX:SoftMaxHeapSize=5g \\
     -XX:ZCollectionInterval=5 \\
     -XX:ZAllocationSpikeTolerance=3 \\
     -Xlog:gc*:file=/var/log/gc.log:time,uptime:filecount=5,filesize=10m \\
     -jar trading-platform.jar

# ZGC benefits:
# - Pause times <1ms even with TB heaps
# - Concurrent compaction
# - No stop-the-world full GC
# - Colored pointers for concurrent relocation`,
			},
			{
				lang: "java",
				description: "Application fix: Use bounded, off-heap storage",
				code: `@Service
public class HistoricalDataService {
    // Use Chronicle Queue for off-heap, memory-mapped storage
    private final ChronicleQueue queue;
    private final ExcerptAppender appender;
    private final ExcerptTailer tailer;

    public HistoricalDataService() {
        this.queue = ChronicleQueue.singleBuilder("snapshots")
            .rollCycle(RollCycles.HOURLY)
            .build();
        this.appender = queue.acquireAppender();
        this.tailer = queue.createTailer();
    }

    @Scheduled(fixedRate = 100)
    public void captureSnapshot() {
        OrderBookSnapshot snapshot = orderBook.createSnapshot();

        // Write to off-heap storage - not managed by GC
        try (DocumentContext dc = appender.writingDocument()) {
            snapshot.writeTo(dc.wire());
        }

        // Old files automatically deleted by roll cycle
    }

    public Stream<OrderBookSnapshot> getRecentSnapshots(Duration window) {
        // Read from memory-mapped file - minimal GC impact
        return StreamSupport.stream(
            new SnapshotSpliterator(tailer, window), false);
    }
}`,
			},
		],
		prevention: [
			"Use G1GC or ZGC for heaps >4GB in latency-sensitive applications",
			"Monitor GC pause times and alert on p99 >500ms",
			"Avoid unbounded in-memory caches - use off-heap or external storage",
			"Profile object lifetimes - \"medium-lived\" objects are GC killers",
			"Set explicit GC pause time goals with -XX:MaxGCPauseMillis",
			"Consider Shenandoah GC for OpenJDK with <10ms pause requirements",
		],
		educationalInsights: [
			"CMS was deprecated in Java 9 and removed in Java 14 - don't use it",
			"Larger heaps don't always mean better performance - they can increase GC pause times",
			"G1GC divides heap into regions and collects garbage-first (highest garbage regions)",
			"ZGC uses colored pointers and load barriers for concurrent compaction",
			"Object promotion from Young to Old Gen requires contiguous space",
			"Memory fragmentation is invisible until allocation fails catastrophically",
		],
	},
};

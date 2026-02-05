import type { DetectiveCase } from "../../types";

export const dotnetLohFragmentation: DetectiveCase = {
	id: "dotnet-loh-fragmentation",
	title: "The Phantom Memory Crisis",
	subtitle: "OutOfMemoryException despite plenty of available RAM",
	difficulty: "principal",
	category: "memory",

	crisis: {
		description:
			"Your .NET document processing service crashes with OutOfMemoryException even though Task Manager shows 4GB of free RAM. The crashes happen randomly, sometimes after processing just a few documents, sometimes after hours of operation.",
		impact:
			"Service crashes multiple times daily. Document processing backlog growing. Customers missing SLA deadlines. Team confused - monitoring shows memory available but app still crashes.",
		timeline: [
			{ time: "08:00 AM", event: "Service started, baseline memory 800MB", type: "normal" },
			{ time: "10:30 AM", event: "Memory at 2.1GB after document processing", type: "normal" },
			{ time: "11:45 AM", event: "OutOfMemoryException during PDF generation", type: "critical" },
			{ time: "11:46 AM", event: "Service restarted automatically", type: "normal" },
			{ time: "02:15 PM", event: "OutOfMemoryException again at 1.8GB", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Small documents process successfully",
			"Service runs fine initially after restart",
			"System has plenty of physical RAM",
			"GC runs frequently (Gen0, Gen1)",
			"No memory pressure from other processes",
		],
		broken: [
			"OutOfMemoryException on large allocations",
			"Crashes at varying memory levels (1.5-3GB)",
			"Specifically fails on byte[] or string allocations",
			"Performance degrades before crash",
			"LOH size grows but never shrinks significantly",
		],
	},

	clues: [
		{
			id: 1,
			title: "Memory Dump Analysis",
			type: "metrics",
			content: `\`\`\`
!dumpheap -stat (from WinDbg with SOS)

              MT    Count    TotalSize Class Name
00007ffb8c123456   12,847   892,847,232 System.Byte[]
00007ffb8c234567    8,234   234,567,890 System.String
00007ffb8c345678   45,678   123,456,789 Document
00007ffb8c456789  234,567    89,123,456 System.Byte[]  (small arrays)

Large Object Heap Statistics:
  Total LOH Size: 2,847,234,567 bytes (2.65GB)
  LOH Objects: 21,456
  Free Space: 1,234,567,890 bytes (1.15GB)   <-- FREE but FRAGMENTED!
  Largest Free Block: 67,234,567 bytes (64MB)

# We have 1.15GB free on LOH but largest block is only 64MB!
# Any allocation >64MB will fail even with "available" memory
\`\`\``,
			hint: "1.15GB free but largest contiguous block is only 64MB...",
		},
		{
			id: 2,
			title: "LOH Fragmentation Visualization",
			type: "logs",
			content: `\`\`\`
Large Object Heap Memory Layout (conceptual):

Address  |  Size    |  Status
---------|----------|----------
0x1000   |  100MB   |  [USED - Doc1.pdf buffer]
0x7400   |  12MB    |  [FREE]          <-- Fragment
0x8000   |  200MB   |  [USED - Doc2.pdf buffer]
0x1A800  |  8MB     |  [FREE]          <-- Fragment
0x1B000  |  150MB   |  [USED - Doc3.pdf buffer]
0x2A000  |  45MB    |  [FREE]          <-- Fragment
0x2D800  |  180MB   |  [USED - Doc4.pdf buffer]
0x3E000  |  64MB    |  [FREE]          <-- Largest fragment!

Requested: 150MB allocation
Result: OutOfMemoryException!

Why? The 150MB request needs CONTIGUOUS memory.
We have 129MB total free (12+8+45+64) but no single block >= 150MB.
LOH is NOT compacted by default (unlike Gen0/1/2).
\`\`\``,
		},
		{
			id: 3,
			title: "Document Processing Code",
			type: "code",
			content: `\`\`\`csharp
public class DocumentProcessor
{
    public async Task<ProcessedDocument> ProcessAsync(Stream input)
    {
        // Read entire document into memory (can be 50-500MB)
        using var memoryStream = new MemoryStream();
        await input.CopyToAsync(memoryStream);
        byte[] documentBytes = memoryStream.ToArray();  // Allocates on LOH if >85KB

        // Parse document
        var document = ParseDocument(documentBytes);

        // Generate thumbnail (another large allocation)
        byte[] thumbnail = GenerateThumbnail(document);  // ~10-50MB

        // Convert to PDF (yet another large allocation)
        byte[] pdfBytes = ConvertToPdf(document);  // ~100-300MB

        // Create response with Base64 (doubles the size!)
        string base64Pdf = Convert.ToBase64String(pdfBytes);  // LOH again

        return new ProcessedDocument
        {
            Original = documentBytes,
            Thumbnail = thumbnail,
            Pdf = pdfBytes,
            Base64Pdf = base64Pdf
        };
    }
}

// Each document creates 4-6 large allocations on LOH
// Objects >85,000 bytes go directly to Large Object Heap
// LOH is NOT compacted by default
\`\`\``,
			hint: "Every document creates multiple large allocations that go to LOH...",
		},
		{
			id: 4,
			title: "GC Configuration",
			type: "config",
			content: `\`\`\`xml
<!-- App.config / web.config -->
<configuration>
  <runtime>
    <!-- Using Server GC for throughput -->
    <gcServer enabled="true"/>

    <!-- No LOH compaction configured -->
    <!-- <GCLOHCompact>false</GCLOHCompact> (default) -->
  </runtime>
</configuration>

<!-- Current behavior:
- Gen0/1/2 collections compact memory (move objects, remove gaps)
- LOH collections do NOT compact by default (just free blocks)
- Fragmentation accumulates over time
- Eventually cannot satisfy large allocation requests
-->
\`\`\``,
			hint: "LOH compaction is disabled by default...",
		},
		{
			id: 5,
			title: "PerfView GC Analysis",
			type: "metrics",
			content: `\`\`\`
GC Event Analysis (PerfView):

GC# |  Gen  |  Pause(ms) |  Before(MB) |  After(MB) |  LOH(MB)
----|-------|------------|-------------|------------|----------
147 |  0    |  12        |  1,234      |  456       |  2,345
148 |  0    |  8         |  567        |  123       |  2,345
149 |  1    |  45        |  1,456      |  234       |  2,345  <- LOH unchanged
150 |  2    |  234       |  2,345      |  456       |  2,234  <- LOH: some free
151 |  0    |  15        |  678        |  234       |  2,234
152 |  2    |  456       |  2,567      |  567       |  2,456  <- LOH grew!

# Note: LOH memory freed in GC#150 but immediately reused
# Fragmentation pattern remains - free blocks don't combine
# Full GC (Gen2) doesn't compact LOH by default

LOH Allocations per document:
- Original bytes: 1 allocation, ~50-500MB
- Thumbnail: 1 allocation, ~10-50MB
- PDF bytes: 1 allocation, ~100-300MB
- Base64 string: 1 allocation, ~150-400MB
= 4+ LOH allocations of varying sizes per document
\`\`\``,
		},
		{
			id: 6,
			title: "Platform Architect Testimony",
			type: "testimony",
			content: `"We sized the server with 16GB RAM specifically to handle large documents. I don't understand why we're getting OutOfMemory at 3GB usage. I've watched the metrics - GC runs, memory gets freed, but then it still crashes. Someone mentioned 'LOH fragmentation' but I thought that was only a problem in .NET Framework, not .NET Core. We're running .NET 6 - shouldn't the GC be smarter about this?"`,
		},
	],

	solution: {
		diagnosis: "Large Object Heap fragmentation causing allocation failures despite available memory",
		keywords: [
			"LOH",
			"Large Object Heap",
			"fragmentation",
			"OutOfMemoryException",
			"GC compaction",
			"memory fragmentation",
			"ArrayPool",
			"contiguous memory",
			"85000 bytes",
		],
		rootCause: `The Large Object Heap (LOH) in .NET handles objects >= 85,000 bytes. Unlike the generational heaps (Gen0/1/2), the LOH is NOT compacted by default during garbage collection.

The document processing workflow creates multiple large allocations:
1. Original document: 50-500MB byte[]
2. Thumbnail: 10-50MB byte[]
3. PDF output: 100-300MB byte[]
4. Base64 string: 150-400MB (strings are on LOH if large enough)

After processing many documents:
1. Large objects allocated at various addresses
2. Some objects freed (GC), leaving "holes"
3. New allocations try to fit in holes
4. Eventually holes are too small for new requests
5. Total free space exists but not CONTIGUOUS
6. Large allocation fails -> OutOfMemoryException

The crash happens at varying memory levels because it depends on the sequence and sizes of allocations/frees, not total memory used.

.NET 6/7/8 still have this behavior - the GC is smarter but LOH compaction is still expensive and not default.`,
		codeExamples: [
			{
				lang: "csharp",
				description: "Fix 1: Use ArrayPool to reuse buffers",
				code: `using System.Buffers;

public class DocumentProcessor
{
    private static readonly ArrayPool<byte> Pool = ArrayPool<byte>.Shared;

    public async Task<ProcessedDocument> ProcessAsync(Stream input)
    {
        // Rent buffer from pool instead of allocating
        int size = (int)input.Length;
        byte[] documentBytes = Pool.Rent(size);

        try
        {
            await input.ReadAsync(documentBytes, 0, size);

            var document = ParseDocument(documentBytes.AsSpan(0, size));

            // Use pooled arrays for all large allocations
            byte[] thumbnail = Pool.Rent(ThumbnailMaxSize);
            int thumbSize = GenerateThumbnail(document, thumbnail);

            byte[] pdfBytes = Pool.Rent(PdfMaxSize);
            int pdfSize = ConvertToPdf(document, pdfBytes);

            // Return result without keeping references to pooled arrays
            return new ProcessedDocument
            {
                ThumbnailData = thumbnail.AsSpan(0, thumbSize).ToArray(),
                PdfData = pdfBytes.AsSpan(0, pdfSize).ToArray()
            };
        }
        finally
        {
            // CRITICAL: Always return to pool
            Pool.Return(documentBytes);
            // Return other pooled arrays too
        }
    }
}`,
			},
			{
				lang: "csharp",
				description: "Fix 2: Enable LOH compaction on demand",
				code: `using System.Runtime;

public class MemoryManager
{
    public static void CompactLOH()
    {
        // Request LOH compaction on next full GC
        GCSettings.LargeObjectHeapCompactionMode =
            GCLargeObjectHeapCompactionMode.CompactOnce;

        // Trigger full GC with compaction
        GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, true, true);
    }
}

// Call periodically or when fragmentation detected:
// - After processing batch of large documents
// - When memory allocation fails (with retry)
// - On a schedule during low-traffic periods

// WARNING: LOH compaction is EXPENSIVE (can pause for seconds)
// Only use as maintenance, not on every GC`,
			},
			{
				lang: "csharp",
				description: "Fix 3: Stream processing to avoid large allocations",
				code: `public class StreamingDocumentProcessor
{
    public async Task ProcessToStorageAsync(Stream input, IStorage storage)
    {
        // Never load entire document into memory
        // Process in chunks

        const int ChunkSize = 81920; // Below LOH threshold (85KB)
        byte[] buffer = new byte[ChunkSize];

        // Stream directly to storage
        await using var outputStream = await storage.CreateWriteStreamAsync();

        int bytesRead;
        while ((bytesRead = await input.ReadAsync(buffer, 0, buffer.Length)) > 0)
        {
            // Process chunk (e.g., hash, transform)
            ProcessChunk(buffer.AsSpan(0, bytesRead));

            // Write chunk to destination
            await outputStream.WriteAsync(buffer, 0, bytesRead);
        }

        // Generate thumbnail with bounded memory
        await GenerateThumbnailStreamingAsync(input, storage);

        // PDF conversion with streaming library
        await ConvertToPdfStreamingAsync(input, storage);
    }

    // Never returns large byte[] - uses streams end-to-end
}`,
			},
			{
				lang: "xml",
				description: "Fix 4: Configure GC for LOH-heavy workloads",
				code: `<!-- .csproj or runtimeconfig.json -->
<PropertyGroup>
  <!-- Use Server GC with better LOH handling -->
  <ServerGarbageCollection>true</ServerGarbageCollection>

  <!-- Enable DATAS (Dynamic Adaptation to Application Size) -->
  <GarbageCollectionAdaptationMode>1</GarbageCollectionAdaptationMode>
</PropertyGroup>

<!-- runtimeconfig.json for .NET 6+ -->
{
  "runtimeOptions": {
    "configProperties": {
      "System.GC.Server": true,
      "System.GC.LOHThreshold": 100000,  // Increase LOH threshold
      "System.GC.HeapCount": 4           // Match CPU cores
    }
  }
}`,
			},
		],
		prevention: [
			"Use ArrayPool<T> for large temporary buffers",
			"Process large data as streams, not arrays",
			"Keep allocations under 85KB when possible",
			"Monitor LOH size and fragmentation ratio",
			"Schedule LOH compaction during maintenance windows",
			"Consider RecyclableMemoryStream from Microsoft.IO",
		],
		educationalInsights: [
			"Objects >= 85,000 bytes allocated on LOH directly (no Gen0)",
			"LOH compaction requires explicit opt-in and is expensive",
			"OutOfMemoryException from fragmentation occurs with available memory",
			"ArrayPool returns same arrays, reducing allocation pressure",
			"Strings on LOH: ~42,500 characters (2 bytes each) triggers LOH",
			".NET 5+ has better LOH handling but compaction still not default",
		],
	},
};

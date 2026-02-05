import type { DetectiveCase } from "../../types";

export const rustAsyncRuntimeStarvation: DetectiveCase = {
	id: "rust-async-runtime-starvation",
	title: "The Starving Tasks",
	subtitle: "Tokio tasks stop making progress while CPU sits idle",
	difficulty: "senior",
	category: "memory",

	crisis: {
		description:
			"Your Rust web service using Tokio suddenly becomes unresponsive. Health checks timeout, requests hang indefinitely, but CPU usage is low. The service was working fine until a new image processing endpoint was added.",
		impact:
			"Service completely unresponsive for 30+ seconds randomly. Health checks failing, instances being cycled. Customer-facing API unavailable. P99 latency spiked from 50ms to 45 seconds.",
		timeline: [
			{ time: "14:00", event: "New image thumbnail endpoint deployed", type: "normal" },
			{ time: "14:15", event: "First thumbnail requests processed successfully", type: "normal" },
			{ time: "14:30", event: "Health checks start timing out intermittently", type: "warning" },
			{ time: "14:45", event: "Multiple requests hanging, service degraded", type: "critical" },
			{ time: "15:00", event: "Service completely unresponsive", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Service responds when no thumbnail requests active",
			"CPU usage is surprisingly low (10-15%)",
			"Memory usage normal",
			"Database connections healthy",
			"No panic or error logs",
		],
		broken: [
			"All requests hang during thumbnail processing",
			"Health check endpoint times out",
			"WebSocket connections stop receiving data",
			"Background tasks stop running",
			"Service appears frozen but process is alive",
		],
	},

	clues: [
		{
			id: 1,
			title: "Tokio Runtime Metrics",
			type: "metrics",
			content: `\`\`\`
# tokio-console output during incident

Runtime: current_thread (1 worker)
Tasks:
  Total: 847
  Active: 846
  Idle: 1

Workers:
  Worker 0: BLOCKED
    Current task: image_thumbnail_handler (running for 12.4s)
    Pending tasks: 845

Task States:
  Running: 1 (image processing)
  Blocked on I/O: 234 (waiting)
  Blocked on channel: 389 (waiting)
  Blocked on timer: 222 (waiting)

Poll Times (last 60s):
  image_thumbnail_handler: 12,456ms (single poll!)
  health_check: 0ms (never polled)
  websocket_handler: 0ms (never polled)

# One task has been "polling" for 12 seconds straight
# No other tasks getting any CPU time
\`\`\``,
			hint: "One task is running for 12 seconds without yielding...",
		},
		{
			id: 2,
			title: "Image Thumbnail Handler Code",
			type: "code",
			content: `\`\`\`rust
use axum::{extract::Multipart, response::Json};
use image::{GenericImageView, ImageFormat};

pub async fn create_thumbnail(mut multipart: Multipart) -> Result<Json<Response>, Error> {
    while let Some(field) = multipart.next_field().await? {
        if field.name() == Some("image") {
            let data = field.bytes().await?;

            // Decode and resize image
            let img = image::load_from_memory(&data)?;

            // CPU-intensive resize operation
            let thumbnail = img.resize(200, 200, image::imageops::FilterType::Lanczos3);

            // Encode to JPEG
            let mut buffer = Vec::new();
            thumbnail.write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Jpeg)?;

            // Save to storage
            save_to_storage(&buffer).await?;

            return Ok(Json(Response { success: true }));
        }
    }

    Err(Error::NoImageProvided)
}

// Called from main.rs
#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/thumbnail", post(create_thumbnail))
        .route("/health", get(health_check));

    axum::serve(listener, app).await.unwrap();
}
\`\`\``,
			hint: "Look at the resize operation - is it async?",
		},
		{
			id: 3,
			title: "Rust Async Model Diagram",
			type: "logs",
			content: `\`\`\`
Tokio async execution model:

┌─────────────────────────────────────────────────────────────────┐
│                     Tokio Runtime                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Worker Thread                           │  │
│  │                                                           │  │
│  │   Task 1: health_check ──► .await ──► yield to runtime   │  │
│  │   Task 2: websocket ────► .await ──► yield to runtime    │  │
│  │   Task 3: api_handler ──► .await ──► yield to runtime    │  │
│  │                                                           │  │
│  │   Normal: Tasks yield at .await points, runtime switches  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

What happens with blocking code:

┌─────────────────────────────────────────────────────────────────┐
│                     Tokio Runtime                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Worker Thread (STUCK)                   │  │
│  │                                                           │  │
│  │   Task: image_resize ──► BLOCKING CALL (no .await)       │  │
│  │         │                                                 │  │
│  │         └──► img.resize(...) ◄── CPU work, no yield!     │  │
│  │                                                           │  │
│  │   Other tasks: STARVED (can't run, thread is busy)       │  │
│  │   - health_check: waiting...                              │  │
│  │   - websocket: waiting...                                 │  │
│  │   - 843 other tasks: waiting...                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
\`\`\``,
		},
		{
			id: 4,
			title: "Blocking Detection Warning",
			type: "logs",
			content: `\`\`\`
# With tokio-console and RUSTFLAGS="--cfg tokio_unstable"

WARN tokio_runtime: A]spawned task took too long to complete
     task.id=847
     task.name=image_thumbnail_handler
     duration=12456ms
     backtrace:
       0: image::imageops::resize
       1: image::DynamicImage::resize
       2: api::create_thumbnail::{{closure}}
       3: <core::future::from_generator::GenFuture<T> as core::future::future::Future>::poll

WARN tokio_runtime: Runtime worker blocked for 12456ms
     worker.id=0
     blocked_task=image_thumbnail_handler
     starved_tasks=845

# The resize() function is synchronous - it blocks the entire worker thread
\`\`\``,
		},
		{
			id: 5,
			title: "Documentation Discovery",
			type: "code",
			content: `\`\`\`rust
// From the 'image' crate documentation:

/// Resize this image using the specified filter algorithm.
///
/// NOTE: This is a BLOCKING operation that may take significant
/// CPU time for large images. For async contexts, consider using
/// spawn_blocking or running on a dedicated thread pool.
pub fn resize(&self, nwidth: u32, nheight: u32, filter: FilterType) -> DynamicImage {
    // ... CPU-intensive resize algorithm
    // No .await points - runs synchronously to completion
}

// Key insight:
// - "async fn" doesn't make all code inside async
// - Only code after .await yields to the runtime
// - Synchronous CPU work blocks the entire worker thread
\`\`\``,
		},
		{
			id: 6,
			title: "Backend Developer Testimony",
			type: "testimony",
			content: `"I thought putting code in an async function made it automatically non-blocking. The function signature says 'async fn', so I assumed all the code inside would be async. It works fine in development because I test with small images and single requests. I didn't realize that 'async' in Rust is about yielding at .await points, not automatic parallelism. The image resize is just a regular function call with no .await, so I guess it never yields back to the runtime."`,
		},
	],

	solution: {
		diagnosis: "Tokio runtime starvation from synchronous blocking operation in async context",
		keywords: [
			"tokio",
			"async",
			"blocking",
			"spawn_blocking",
			"runtime starvation",
			"task starvation",
			"blocking in async",
			"worker thread",
			"rayon",
			"CPU-bound",
		],
		rootCause: `In Tokio (and Rust async in general), tasks only yield control back to the runtime at \`.await\` points. The \`async\` keyword doesn't make synchronous code magically non-blocking.

The image resize operation \`img.resize(...)\` is a synchronous, CPU-intensive function. When called from an async context:
1. It takes over the worker thread completely
2. No \`.await\` points mean no yielding
3. All other tasks on that worker starve
4. With single-threaded runtime, the ENTIRE runtime stops

This is different from I/O blocking (which is handled by the OS and Tokio's I/O driver) - CPU-bound work just runs and runs until complete.

The problem is magnified by:
- Using \`#[tokio::main]\` which defaults to multi-threaded runtime
- But even multi-threaded runtime has limited workers
- One blocked worker = fewer workers for other tasks
- Large image + complex filter = long blocking time`,
		codeExamples: [
			{
				lang: "rust",
				description: "Fix 1: Use spawn_blocking for CPU-intensive work",
				code: `use tokio::task;

pub async fn create_thumbnail(mut multipart: Multipart) -> Result<Json<Response>, Error> {
    while let Some(field) = multipart.next_field().await? {
        if field.name() == Some("image") {
            let data = field.bytes().await?;

            // Move CPU-intensive work to blocking thread pool
            let buffer = task::spawn_blocking(move || {
                // This runs on a dedicated blocking thread pool
                // Tokio's async workers remain free for other tasks
                let img = image::load_from_memory(&data)?;
                let thumbnail = img.resize(200, 200, image::imageops::FilterType::Lanczos3);

                let mut buffer = Vec::new();
                thumbnail.write_to(
                    &mut std::io::Cursor::new(&mut buffer),
                    ImageFormat::Jpeg
                )?;
                Ok::<_, Error>(buffer)
            })
            .await??;  // .await the JoinHandle

            // Back in async context for I/O
            save_to_storage(&buffer).await?;

            return Ok(Json(Response { success: true }));
        }
    }

    Err(Error::NoImageProvided)
}`,
			},
			{
				lang: "rust",
				description: "Fix 2: Use rayon for parallel CPU work with spawn_blocking",
				code: `use rayon::prelude::*;
use tokio::task;

pub async fn create_thumbnails_batch(
    images: Vec<ImageData>
) -> Result<Vec<ThumbnailResult>, Error> {
    // Move entire batch to blocking pool, use rayon for parallelism
    let results = task::spawn_blocking(move || {
        images
            .par_iter()  // Parallel iterator from rayon
            .map(|image_data| {
                let img = image::load_from_memory(&image_data.bytes)?;
                let thumbnail = img.resize(200, 200, FilterType::Lanczos3);

                let mut buffer = Vec::new();
                thumbnail.write_to(
                    &mut std::io::Cursor::new(&mut buffer),
                    ImageFormat::Jpeg
                )?;

                Ok(ThumbnailResult { id: image_data.id, data: buffer })
            })
            .collect::<Result<Vec<_>, Error>>()
    })
    .await??;

    Ok(results)
}`,
			},
			{
				lang: "rust",
				description: "Fix 3: Configure runtime with more workers",
				code: `use tokio::runtime::Builder;

fn main() {
    // Custom runtime with more blocking threads
    let runtime = Builder::new_multi_thread()
        .worker_threads(4)           // Async workers
        .max_blocking_threads(16)    // Blocking thread pool
        .enable_all()
        .build()
        .unwrap();

    runtime.block_on(async {
        let app = Router::new()
            .route("/thumbnail", post(create_thumbnail))
            .route("/health", get(health_check));

        axum::serve(listener, app).await.unwrap();
    });
}

// Even better: Use separate service for CPU-intensive work
// - Keep web service purely async
// - Send CPU work to dedicated processing service
// - Use message queue for communication`,
			},
		],
		prevention: [
			"Use spawn_blocking for any CPU-intensive operation (>1ms)",
			"Enable tokio-console in development to detect blocking tasks",
			"Use #[tokio::main(flavor = \"multi_thread\")] for production",
			"Consider rayon for CPU-bound parallel work within spawn_blocking",
			"Set max_blocking_threads appropriately for your workload",
			"Profile with tokio-metrics to identify slow tasks",
		],
		educationalInsights: [
			"async/await is about cooperative scheduling, not automatic parallelism",
			"Tasks only yield at .await points - sync code runs to completion",
			"Tokio has separate thread pools: async workers and blocking threads",
			"spawn_blocking moves work off async workers to blocking pool",
			"Even 10ms of blocking can cause noticeable latency spikes",
			"I/O blocking is different - handled by OS and Tokio's I/O driver",
		],
	},
};

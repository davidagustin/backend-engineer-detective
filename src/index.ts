/**
 * Backend Engineer Detective - An AI-powered investigation game
 *
 * Players investigate production incidents from PlayStation-scale scenarios,
 * using clues and an AI mentor to diagnose root causes.
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequest, DiagnosisResult } from "./types";
import { getAllCaseSummaries, getCaseView, getCase, getCaseSolution } from "./cases";
import { matchDiagnosis, generateHint } from "./utils/diagnosis-matcher";
import { buildCaseContextPrompt, buildGeneralPrompt, buildVictoryPrompt } from "./utils/prompt-builder";

// Model ID for Workers AI
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return handleCors();
		}

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		try {
			// List all cases
			if (url.pathname === "/api/cases" && request.method === "GET") {
				return handleListCases();
			}

			// Get specific case
			const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
			if (caseMatch && request.method === "GET") {
				const caseId = caseMatch[1];
				const cluesParam = url.searchParams.get("clues");
				const cluesRevealed = cluesParam ? parseInt(cluesParam, 10) : 2;
				return handleGetCase(caseId, cluesRevealed);
			}

			// Check diagnosis
			const checkMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/check$/);
			if (checkMatch && request.method === "POST") {
				const caseId = checkMatch[1];
				return handleCheckDiagnosis(caseId, request);
			}

			// Get solution (for give up)
			const solutionMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/solution$/);
			if (solutionMatch && request.method === "GET") {
				const caseId = solutionMatch[1];
				return handleGetSolution(caseId);
			}

			// Chat endpoint
			if (url.pathname === "/api/chat" && request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed
			if (url.pathname.startsWith("/api/")) {
				return jsonResponse({ error: "Method not allowed" }, 405);
			}
		} catch (error) {
			console.error("API Error:", error);
			return jsonResponse({ error: "Internal server error" }, 500);
		}

		return jsonResponse({ error: "Not found" }, 404);
	},
} satisfies ExportedHandler<Env>;

/**
 * Handle CORS preflight requests
 */
function handleCors(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "86400",
		},
	});
}

/**
 * Create a JSON response with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}

/**
 * GET /api/cases - List all cases
 */
function handleListCases(): Response {
	const cases = getAllCaseSummaries();
	return jsonResponse({ cases });
}

/**
 * GET /api/cases/:id - Get a specific case with clues
 */
function handleGetCase(caseId: string, cluesRevealed: number): Response {
	const caseView = getCaseView(caseId, cluesRevealed);
	if (!caseView) {
		return jsonResponse({ error: "Case not found" }, 404);
	}
	return jsonResponse({ case: caseView });
}

/**
 * POST /api/cases/:id/check - Check a diagnosis attempt
 */
async function handleCheckDiagnosis(caseId: string, request: Request): Promise<Response> {
	const caseData = getCase(caseId);
	if (!caseData) {
		return jsonResponse({ error: "Case not found" }, 404);
	}

	const body = await request.json() as { diagnosis: string; attemptCount?: number; cluesRevealed?: number };
	const { diagnosis, attemptCount = 1, cluesRevealed = 2 } = body;

	if (!diagnosis || typeof diagnosis !== "string") {
		return jsonResponse({ error: "Diagnosis is required" }, 400);
	}

	const result = matchDiagnosis(diagnosis, caseData.solution);

	// Add hint if not correct
	if (!result.correct) {
		const hint = generateHint(attemptCount, cluesRevealed, caseData.clues.length);
		return jsonResponse({
			...result,
			hint,
		});
	}

	return jsonResponse(result);
}

/**
 * GET /api/cases/:id/solution - Get the full solution
 */
function handleGetSolution(caseId: string): Response {
	const solution = getCaseSolution(caseId);
	if (!solution) {
		return jsonResponse({ error: "Case not found" }, 404);
	}
	return jsonResponse({ solution });
}

/**
 * POST /api/chat - Chat with the AI detective mentor
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const body = await request.json() as ChatRequest;
		const { messages = [], caseContext } = body;

		// Build the appropriate system prompt
		let systemPrompt: string;

		if (caseContext?.caseId) {
			const caseData = getCase(caseContext.caseId);
			if (caseData) {
				// Check if this is a victory context (user solved it)
				const lastMessage = messages[messages.length - 1];
				const isVictory = lastMessage?.content?.toLowerCase().includes("solved") ||
					lastMessage?.content?.toLowerCase().includes("got it") ||
					lastMessage?.content?.toLowerCase().includes("figured it out");

				if (isVictory) {
					systemPrompt = buildVictoryPrompt(caseData);
				} else {
					systemPrompt = buildCaseContextPrompt(
						caseContext.caseId,
						caseContext.cluesRevealed || 2
					);
				}
			} else {
				systemPrompt = buildGeneralPrompt();
			}
		} else {
			systemPrompt = buildGeneralPrompt();
		}

		// Prepare messages with system prompt
		const messagesWithSystem: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...messages.filter(m => m.role !== "system"),
		];

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages: messagesWithSystem,
				max_tokens: 1024,
				stream: true,
			},
			{}
		);

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return jsonResponse({ error: "Failed to process chat request" }, 500);
	}
}

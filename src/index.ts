/**
 * Backend Engineer Detective - An AI-powered investigation game
 *
 * Players investigate production incidents from PlayStation-scale scenarios,
 * using clues and an AI mentor to diagnose root causes.
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequest, DiagnosisResult, Solution } from "./types";
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
				return handleCheckDiagnosis(caseId, request, env);
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
 * POST /api/cases/:id/check - Check a diagnosis attempt using LLM evaluation
 */
async function handleCheckDiagnosis(caseId: string, request: Request, env: Env): Promise<Response> {
	const caseData = getCase(caseId);
	if (!caseData) {
		return jsonResponse({ error: "Case not found" }, 404);
	}

	const body = await request.json() as { diagnosis: string; attemptCount?: number; cluesRevealed?: number };
	const { diagnosis, attemptCount = 1, cluesRevealed = 2 } = body;

	if (!diagnosis || typeof diagnosis !== "string") {
		return jsonResponse({ error: "Diagnosis is required" }, 400);
	}

	// Use LLM to evaluate the diagnosis
	const result = await evaluateDiagnosisWithLLM(env, diagnosis, caseData.solution);

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
 * Use LLM to evaluate if the user's diagnosis is correct
 */
async function evaluateDiagnosisWithLLM(
	env: Env,
	userDiagnosis: string,
	solution: Solution
): Promise<DiagnosisResult> {
	const systemPrompt = `You are an expert evaluator for a backend engineering debugging game. Your job is to determine if the user's diagnosis matches the actual root cause of an incident.

You must respond with ONLY a valid JSON object in this exact format, no other text:
{"verdict": "correct" | "partial" | "incorrect", "explanation": "brief explanation", "matchedConcepts": ["concept1", "concept2"]}

CORRECT: The user has identified the core root cause, even if they use different terminology or phrasing. They understand WHY the problem occurred.

PARTIAL: The user is on the right track - they've identified related symptoms or contributing factors, but haven't pinpointed the exact root cause.

INCORRECT: The user's diagnosis is unrelated or fundamentally misunderstands the problem.

Be generous - if the user demonstrates understanding of the core issue, mark it as correct even if the wording differs from the official answer.`;

	const userPrompt = `## Actual Root Cause
${solution.diagnosis}

## Full Explanation
${solution.rootCause}

## Key Concepts
${solution.keywords.join(", ")}

---

## User's Diagnosis
"${userDiagnosis}"

---

Evaluate if the user's diagnosis demonstrates understanding of the root cause. Respond with ONLY the JSON object.`;

	try {
		const response = await env.AI.run(MODEL_ID, {
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			max_tokens: 256,
			temperature: 0.1, // Low temperature for consistent evaluation
		}) as { response?: string };

		// Parse the LLM response
		const responseText = response.response || "";

		// Extract JSON from response (handle potential markdown code blocks)
		let jsonStr = responseText.trim();
		if (jsonStr.startsWith("```")) {
			jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
		}

		const evaluation = JSON.parse(jsonStr) as {
			verdict: "correct" | "partial" | "incorrect";
			explanation: string;
			matchedConcepts: string[];
		};

		if (evaluation.verdict === "correct") {
			return {
				correct: true,
				partial: false,
				feedback: `🎉 Case Closed! ${evaluation.explanation}`,
				matchedKeywords: evaluation.matchedConcepts || [],
				solution,
			};
		} else if (evaluation.verdict === "partial") {
			return {
				correct: false,
				partial: true,
				feedback: `🔍 You're on the right track! ${evaluation.explanation}`,
				matchedKeywords: evaluation.matchedConcepts || [],
			};
		} else {
			return {
				correct: false,
				partial: false,
				feedback: `❌ ${evaluation.explanation || "That doesn't match the evidence. Review the clues and try again."}`,
				matchedKeywords: evaluation.matchedConcepts || [],
			};
		}
	} catch (error) {
		console.error("LLM evaluation error:", error);
		// Fallback to keyword matching if LLM fails
		return matchDiagnosis(userDiagnosis, solution);
	}
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

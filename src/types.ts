/**
 * Type definitions for the Backend Engineer Detective application.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/**
 * Difficulty levels for detective cases.
 */
export type CaseDifficulty = "junior" | "mid" | "senior" | "principal";

/**
 * Categories of backend engineering incidents.
 */
export type CaseCategory = "database" | "caching" | "networking" | "auth" | "memory" | "distributed";

/**
 * Types of evidence/clues that can be presented.
 */
export type ClueType = "metrics" | "logs" | "code" | "config" | "testimony";

/**
 * Timeline event severity levels.
 */
export type TimelineEventType = "normal" | "warning" | "critical";

/**
 * A timeline event in the crisis.
 */
export interface TimelineEvent {
	time: string;
	event: string;
	type?: TimelineEventType;
}

/**
 * Crisis description with timeline.
 */
export interface Crisis {
	description: string;
	impact: string;
	timeline: TimelineEvent[];
}

/**
 * Symptoms categorized by what works vs what's broken.
 */
export interface Symptoms {
	working: string[];
	broken: string[];
}

/**
 * A clue/evidence piece in the investigation.
 */
export interface Clue {
	id: number;
	title: string;
	type: ClueType;
	content: string;
	hint?: string;
}

/**
 * Code example for the solution.
 */
export interface CodeExample {
	lang: string;
	code: string;
	description: string;
}

/**
 * Complete solution for a case.
 */
export interface Solution {
	diagnosis: string;
	keywords: string[];
	rootCause: string;
	codeExamples: CodeExample[];
	prevention: string[];
	educationalInsights: string[];
}

/**
 * Complete detective case definition.
 */
export interface DetectiveCase {
	id: string;
	title: string;
	subtitle: string;
	difficulty: CaseDifficulty;
	category: CaseCategory;
	crisis: Crisis;
	symptoms: Symptoms;
	clues: Clue[];
	solution: Solution;
}

/**
 * Case summary for listing (without full clues/solution).
 */
export interface CaseSummary {
	id: string;
	title: string;
	subtitle: string;
	difficulty: CaseDifficulty;
	category: CaseCategory;
	totalClues: number;
}

/**
 * Case view with progressive clue reveal.
 */
export interface CaseView {
	id: string;
	title: string;
	subtitle: string;
	difficulty: CaseDifficulty;
	category: CaseCategory;
	crisis: Crisis;
	symptoms: Symptoms;
	clues: Clue[];
	totalClues: number;
	cluesRevealed: number;
}

/**
 * Result of checking a diagnosis.
 */
export interface DiagnosisResult {
	correct: boolean;
	partial: boolean;
	feedback: string;
	matchedKeywords: string[];
	solution?: Solution;
}

/**
 * Chat request with optional case context.
 */
export interface ChatRequest {
	messages: ChatMessage[];
	caseContext?: {
		caseId: string;
		cluesRevealed: number;
	};
}

/**
 * Diagnosis Matcher - fuzzy matching for user diagnosis attempts.
 */

import type { DiagnosisResult, Solution } from "../types";

/**
 * Normalize text for comparison.
 */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ") // Replace special chars with space
		.replace(/\s+/g, " ") // Collapse multiple spaces
		.trim();
}

/**
 * Check if diagnosis contains a keyword (with fuzzy matching).
 */
function containsKeyword(diagnosis: string, keyword: string): boolean {
	const normalizedDiagnosis = normalize(diagnosis);
	const normalizedKeyword = normalize(keyword);

	// Direct substring match
	if (normalizedDiagnosis.includes(normalizedKeyword)) {
		return true;
	}

	// Check each word in the keyword
	const keywordWords = normalizedKeyword.split(" ");
	const diagnosisWords = normalizedDiagnosis.split(" ");

	// All keyword words must appear in the diagnosis
	return keywordWords.every((kw) =>
		diagnosisWords.some((dw) => dw.includes(kw) || kw.includes(dw))
	);
}

/**
 * Match a user's diagnosis attempt against the solution keywords.
 */
export function matchDiagnosis(diagnosis: string, solution: Solution): DiagnosisResult {
	const matchedKeywords: string[] = [];

	// Check each solution keyword
	for (const keyword of solution.keywords) {
		if (containsKeyword(diagnosis, keyword)) {
			matchedKeywords.push(keyword);
		}
	}

	// Determine result based on matches
	const matchRatio = matchedKeywords.length / solution.keywords.length;

	// Check for the exact diagnosis phrase (partial match allowed)
	const diagnosisMatch = containsKeyword(diagnosis, solution.diagnosis);

	if (diagnosisMatch || matchRatio >= 0.5) {
		// Correct! User identified the root cause
		return {
			correct: true,
			partial: false,
			feedback: "🎉 Case Closed! You've correctly identified the root cause.",
			matchedKeywords,
			solution,
		};
	} else if (matchedKeywords.length >= 2 || matchRatio >= 0.25) {
		// Partial match - on the right track
		return {
			correct: false,
			partial: true,
			feedback:
				"🔍 You're on the right track! Your diagnosis mentions relevant concepts but hasn't pinpointed the exact root cause. Keep investigating...",
			matchedKeywords,
		};
	} else if (matchedKeywords.length === 1) {
		// Single keyword match
		return {
			correct: false,
			partial: true,
			feedback:
				"🤔 You've touched on something relevant, but the diagnosis needs more detail. What specifically is causing the problem?",
			matchedKeywords,
		};
	} else {
		// No match
		return {
			correct: false,
			partial: false,
			feedback:
				"❌ That doesn't seem to match the evidence. Review the clues again and consider: what do the symptoms have in common?",
			matchedKeywords,
		};
	}
}

/**
 * Generate hints based on revealed clues and failed attempts.
 */
export function generateHint(
	attemptCount: number,
	cluesRevealed: number,
	totalClues: number
): string {
	if (cluesRevealed < totalClues) {
		return `💡 Hint: There are ${totalClues - cluesRevealed} more clues to discover. Try investigating more evidence.`;
	}

	if (attemptCount === 1) {
		return "💡 Hint: Focus on what the symptoms have in common. What pattern connects them?";
	}

	if (attemptCount === 2) {
		return "💡 Hint: Look at the code and configuration clues closely. Is there something that should be there but isn't?";
	}

	if (attemptCount >= 3) {
		return "💡 Hint: Consider the timeline and the testimony. When did things start going wrong, and what changed?";
	}

	return "";
}

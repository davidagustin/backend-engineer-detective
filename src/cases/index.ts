/**
 * Case Registry - exports all detective cases and provides lookup utilities.
 */

import type { DetectiveCase, CaseSummary, CaseView } from "../types";

// Import all cases
import { databaseDisappearingAct } from "./data/01-database-disappearing-act";
import { blackFridayDisaster } from "./data/02-black-friday-disaster";
import { memoryExplosionMystery } from "./data/03-memory-explosion-mystery";
import { ghostUsersProblem } from "./data/04-ghost-users-problem";
import { infiniteLoopIncident } from "./data/05-infinite-loop-incident";
import { mysteriousMemoryLeak } from "./data/06-mysterious-memory-leak";
import { silentAuthCrisis } from "./data/07-silent-auth-crisis";
import { vanishingAchievements } from "./data/08-vanishing-achievements";
import { weekendWarriorsCrisis } from "./data/09-weekend-warriors-crisis";
import { mysteriousSlowLogins } from "./data/10-mysterious-slow-logins";
import { phantomFriendRequests } from "./data/11-phantom-friend-requests";
import { midnightDataSwap } from "./data/12-midnight-data-swap";
import { databaseInconsistency } from "./data/13-database-inconsistency";
import { invisibleApi } from "./data/14-invisible-api";
import { vanishingMultiplayerMatches } from "./data/15-vanishing-multiplayer-matches";
import { invisibleTrafficSpike } from "./data/16-invisible-traffic-spike";
import { kubernetesPodMystery } from "./data/17-kubernetes-pod-mystery";
import { kafkaConsumerLag } from "./data/18-kafka-consumer-lag";
import { graphqlNPlusOne } from "./data/19-graphql-n-plus-one";
import { websocketMemoryLeak } from "./data/20-websocket-memory-leak";
import { featureFlagFiasco } from "./data/21-feature-flag-fiasco";
import { elasticsearchIndexingStorm } from "./data/22-elasticsearch-indexing-storm";

/**
 * All detective cases indexed by ID.
 */
export const cases: Record<string, DetectiveCase> = {
	"database-disappearing-act": databaseDisappearingAct,
	"black-friday-disaster": blackFridayDisaster,
	"memory-explosion-mystery": memoryExplosionMystery,
	"ghost-users-problem": ghostUsersProblem,
	"infinite-loop-incident": infiniteLoopIncident,
	"mysterious-memory-leak": mysteriousMemoryLeak,
	"silent-auth-crisis": silentAuthCrisis,
	"vanishing-achievements": vanishingAchievements,
	"weekend-warriors-crisis": weekendWarriorsCrisis,
	"mysterious-slow-logins": mysteriousSlowLogins,
	"phantom-friend-requests": phantomFriendRequests,
	"midnight-data-swap": midnightDataSwap,
	"database-inconsistency": databaseInconsistency,
	"invisible-api": invisibleApi,
	"vanishing-multiplayer-matches": vanishingMultiplayerMatches,
	"invisible-traffic-spike": invisibleTrafficSpike,
	"kubernetes-pod-mystery": kubernetesPodMystery,
	"kafka-consumer-lag": kafkaConsumerLag,
	"graphql-n-plus-one": graphqlNPlusOne,
	"websocket-memory-leak": websocketMemoryLeak,
	"feature-flag-fiasco": featureFlagFiasco,
	"elasticsearch-indexing-storm": elasticsearchIndexingStorm,
};

/**
 * Ordered list of case IDs for consistent display.
 */
export const caseOrder: string[] = [
	"database-disappearing-act",
	"black-friday-disaster",
	"memory-explosion-mystery",
	"ghost-users-problem",
	"infinite-loop-incident",
	"mysterious-memory-leak",
	"silent-auth-crisis",
	"vanishing-achievements",
	"weekend-warriors-crisis",
	"mysterious-slow-logins",
	"phantom-friend-requests",
	"midnight-data-swap",
	"database-inconsistency",
	"invisible-api",
	"vanishing-multiplayer-matches",
	"invisible-traffic-spike",
	"kubernetes-pod-mystery",
	"kafka-consumer-lag",
	"graphql-n-plus-one",
	"websocket-memory-leak",
	"feature-flag-fiasco",
	"elasticsearch-indexing-storm",
];

/**
 * Get a case by ID.
 */
export function getCase(id: string): DetectiveCase | undefined {
	return cases[id];
}

/**
 * Get all cases as summaries (for listing).
 */
export function getAllCaseSummaries(): CaseSummary[] {
	return caseOrder.map((id) => {
		const c = cases[id];
		return {
			id: c.id,
			title: c.title,
			subtitle: c.subtitle,
			difficulty: c.difficulty,
			category: c.category,
			totalClues: c.clues.length,
		};
	});
}

/**
 * Get a case view with progressive clue reveal.
 * @param id Case ID
 * @param cluesRevealed Number of clues to reveal (1 to totalClues)
 */
export function getCaseView(id: string, cluesRevealed: number): CaseView | undefined {
	const c = cases[id];
	if (!c) return undefined;

	// Ensure cluesRevealed is within bounds
	const totalClues = c.clues.length;
	const revealed = Math.max(1, Math.min(cluesRevealed, totalClues));

	return {
		id: c.id,
		title: c.title,
		subtitle: c.subtitle,
		difficulty: c.difficulty,
		category: c.category,
		crisis: c.crisis,
		symptoms: c.symptoms,
		clues: c.clues.slice(0, revealed),
		totalClues,
		cluesRevealed: revealed,
	};
}

/**
 * Get the full solution for a case.
 */
export function getCaseSolution(id: string) {
	const c = cases[id];
	return c?.solution;
}

/**
 * State Management - localStorage-based progress tracking
 */

const STORAGE_KEY = 'detective-progress';

/**
 * Default state structure
 */
const defaultState = {
  currentCase: null,
  caseProgress: {}, // { caseId: { cluesRevealed, attempts, solved, gaveUp } }
  solvedCases: [],
  chatHistory: {}, // { caseId: messages[] }
};

/**
 * Load state from localStorage
 */
export function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultState, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
  return { ...defaultState };
}

/**
 * Save state to localStorage
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

/**
 * Get or initialize progress for a specific case
 */
export function getCaseProgress(state, caseId) {
  if (!state.caseProgress[caseId]) {
    state.caseProgress[caseId] = {
      cluesRevealed: 2, // Start with 2 clues
      attempts: 0,
      solved: false,
      gaveUp: false,
      // New fields for two-phase diagnosis and scoring
      startTime: null, // When investigation started (timestamp)
      hintsViewed: [], // Array of hint IDs viewed
      rootCauseCorrect: false, // Phase 1 completion
      rootCauseAttempts: 0, // Attempts at phase 1
      submittedRootCause: '', // The correct root cause answer
      score: null, // Final score (calculated when solved)
    };
    saveState(state);
  }
  // Migration: ensure new fields exist for existing progress
  const progress = state.caseProgress[caseId];
  if (progress.startTime === undefined) progress.startTime = null;
  if (progress.hintsViewed === undefined) progress.hintsViewed = [];
  if (progress.rootCauseCorrect === undefined) progress.rootCauseCorrect = false;
  if (progress.rootCauseAttempts === undefined) progress.rootCauseAttempts = 0;
  if (progress.submittedRootCause === undefined) progress.submittedRootCause = '';
  if (progress.score === undefined) progress.score = null;
  return progress;
}

/**
 * Reveal another clue for a case
 */
export function revealClue(state, caseId, totalClues) {
  const progress = getCaseProgress(state, caseId);
  if (progress.cluesRevealed < totalClues) {
    progress.cluesRevealed++;
    saveState(state);
  }
  return progress.cluesRevealed;
}

/**
 * Record a diagnosis attempt
 */
export function recordAttempt(state, caseId) {
  const progress = getCaseProgress(state, caseId);
  progress.attempts++;
  saveState(state);
  return progress.attempts;
}

/**
 * Mark a case as solved and save the score
 */
export function markSolved(state, caseId, score = null) {
  const progress = getCaseProgress(state, caseId);
  progress.solved = true;
  if (score !== null) {
    progress.score = score;
  }
  if (!state.solvedCases.includes(caseId)) {
    state.solvedCases.push(caseId);
  }
  saveState(state);
}

/**
 * Start the investigation timer for a case
 */
export function startInvestigation(state, caseId) {
  const progress = getCaseProgress(state, caseId);
  if (!progress.startTime) {
    progress.startTime = Date.now();
    saveState(state);
  }
  return progress.startTime;
}

/**
 * Record a hint view for scoring
 */
export function recordHintView(state, caseId, hintId) {
  const progress = getCaseProgress(state, caseId);
  if (!progress.hintsViewed.includes(hintId)) {
    progress.hintsViewed.push(hintId);
    saveState(state);
  }
  return progress.hintsViewed.length;
}

/**
 * Record a root cause attempt (Phase 1)
 */
export function recordRootCauseAttempt(state, caseId) {
  const progress = getCaseProgress(state, caseId);
  progress.rootCauseAttempts++;
  saveState(state);
  return progress.rootCauseAttempts;
}

/**
 * Mark Phase 1 (root cause) as complete
 */
export function markRootCauseCorrect(state, caseId, submittedRootCause) {
  const progress = getCaseProgress(state, caseId);
  progress.rootCauseCorrect = true;
  progress.submittedRootCause = submittedRootCause;
  saveState(state);
}

/**
 * Calculate the score for a case
 * @param {Object} progress - Case progress object
 * @param {string} difficulty - Case difficulty (junior, mid, senior, principal)
 * @returns {number} - Calculated score
 */
export function calculateScore(progress, difficulty) {
  const BASE_SCORE = 1000;
  const TIME_PENALTY_PER_5_SEC = 1;
  const TIME_PENALTY_CAP = 300;
  const CLUE_PENALTY = 50; // Per clue beyond initial 2
  const HINT_PENALTY = 25; // Per hint viewed
  const ROOT_CAUSE_ATTEMPT_PENALTY = 100; // Per failed root cause attempt
  const MIN_SCORE = 100;

  const DIFFICULTY_MULTIPLIERS = {
    junior: 1,
    mid: 1.5,
    senior: 2,
    principal: 3,
  };

  let score = BASE_SCORE;

  // Time penalty: -1 per 5 seconds, capped at -300
  if (progress.startTime) {
    const elapsedSeconds = Math.floor((Date.now() - progress.startTime) / 1000);
    const timePenalty = Math.min(Math.floor(elapsedSeconds / 5) * TIME_PENALTY_PER_5_SEC, TIME_PENALTY_CAP);
    score -= timePenalty;
  }

  // Clue penalty: -50 per clue beyond initial 2
  const extraClues = Math.max(0, progress.cluesRevealed - 2);
  score -= extraClues * CLUE_PENALTY;

  // Hint penalty: -25 per hint viewed
  score -= progress.hintsViewed.length * HINT_PENALTY;

  // Root cause attempt penalty: -100 per failed attempt
  // (successful attempt doesn't count, so it's attempts - 1 if solved)
  const failedAttempts = Math.max(0, progress.rootCauseAttempts - 1);
  score -= failedAttempts * ROOT_CAUSE_ATTEMPT_PENALTY;

  // Apply minimum score
  score = Math.max(score, MIN_SCORE);

  // Apply difficulty multiplier
  const multiplier = DIFFICULTY_MULTIPLIERS[difficulty] || 1;
  score = Math.round(score * multiplier);

  return score;
}

/**
 * Estimate current score (live updating)
 */
export function estimateCurrentScore(progress, difficulty) {
  // Same as calculateScore but assumes no more failed attempts
  const BASE_SCORE = 1000;
  const TIME_PENALTY_PER_5_SEC = 1;
  const TIME_PENALTY_CAP = 300;
  const CLUE_PENALTY = 50;
  const HINT_PENALTY = 25;
  const ROOT_CAUSE_ATTEMPT_PENALTY = 100;
  const MIN_SCORE = 100;

  const DIFFICULTY_MULTIPLIERS = {
    junior: 1,
    mid: 1.5,
    senior: 2,
    principal: 3,
  };

  let score = BASE_SCORE;

  // Time penalty
  if (progress.startTime) {
    const elapsedSeconds = Math.floor((Date.now() - progress.startTime) / 1000);
    const timePenalty = Math.min(Math.floor(elapsedSeconds / 5) * TIME_PENALTY_PER_5_SEC, TIME_PENALTY_CAP);
    score -= timePenalty;
  }

  // Clue penalty
  const extraClues = Math.max(0, progress.cluesRevealed - 2);
  score -= extraClues * CLUE_PENALTY;

  // Hint penalty
  score -= progress.hintsViewed.length * HINT_PENALTY;

  // Root cause attempt penalty (count all failed attempts so far)
  const failedAttempts = progress.rootCauseCorrect
    ? Math.max(0, progress.rootCauseAttempts - 1)
    : progress.rootCauseAttempts;
  score -= failedAttempts * ROOT_CAUSE_ATTEMPT_PENALTY;

  // Apply minimum
  score = Math.max(score, MIN_SCORE);

  // Apply multiplier
  const multiplier = DIFFICULTY_MULTIPLIERS[difficulty] || 1;
  score = Math.round(score * multiplier);

  return score;
}

/**
 * Mark a case as gave up
 */
export function markGaveUp(state, caseId) {
  const progress = getCaseProgress(state, caseId);
  progress.gaveUp = true;
  saveState(state);
}

/**
 * Set current case
 */
export function setCurrentCase(state, caseId) {
  state.currentCase = caseId;
  saveState(state);
}

/**
 * Get chat history for a case
 */
export function getChatHistory(state, caseId) {
  return state.chatHistory[caseId] || [];
}

/**
 * Add message to chat history
 */
export function addChatMessage(state, caseId, message) {
  if (!state.chatHistory[caseId]) {
    state.chatHistory[caseId] = [];
  }
  state.chatHistory[caseId].push(message);

  // Keep only last 50 messages per case
  if (state.chatHistory[caseId].length > 50) {
    state.chatHistory[caseId] = state.chatHistory[caseId].slice(-50);
  }

  saveState(state);
}

/**
 * Clear chat history for a case
 */
export function clearChatHistory(state, caseId) {
  state.chatHistory[caseId] = [];
  saveState(state);
}

/**
 * Reset all progress
 */
export function resetAllProgress() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...defaultState };
}

/**
 * Get statistics
 */
export function getStats(state) {
  const totalCases = 16; // We have 16 cases
  const solved = state.solvedCases.length;
  const inProgress = Object.keys(state.caseProgress).filter(id => {
    const p = state.caseProgress[id];
    return !p.solved && !p.gaveUp && p.attempts > 0;
  }).length;

  return {
    solved,
    inProgress,
    totalCases,
    percentComplete: Math.round((solved / totalCases) * 100),
  };
}

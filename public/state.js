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
    };
    saveState(state);
  }
  return state.caseProgress[caseId];
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
 * Mark a case as solved
 */
export function markSolved(state, caseId) {
  const progress = getCaseProgress(state, caseId);
  progress.solved = true;
  if (!state.solvedCases.includes(caseId)) {
    state.solvedCases.push(caseId);
  }
  saveState(state);
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

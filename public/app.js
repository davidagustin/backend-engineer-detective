/**
 * Main Application Controller
 * Handles routing, state management, and view coordination
 */

import * as state from './state.js';
import * as api from './api.js';
import { renderCaseList, showLoading, showError } from './components/case-list.js';
import {
  renderCaseView,
  showDiagnosisFeedback,
  addChatMessage,
  addStreamingMessage,
  finalizeStreamingMessage,
  updateScoreDisplay,
  setSubmitLoading,
  injectNewClue
} from './components/case-view.js';
import { renderSolution } from './components/solution.js';

// Application state
let appState = state.loadState();
let currentCaseData = null;
let casesCache = null;
let chatMessages = [];

// DOM elements
const mainContainer = document.getElementById('app');

/**
 * Initialize the application
 */
async function init() {
  // Set up hash-based routing
  window.addEventListener('hashchange', handleRoute);

  // Initial route
  await handleRoute();
}

/**
 * Handle URL hash routing
 */
async function handleRoute() {
  const hash = window.location.hash.slice(1); // Remove #

  if (!hash) {
    // Show case list
    await showCaseList();
  } else if (hash.startsWith('case/')) {
    const parts = hash.split('/');
    const caseId = parts[1];

    if (parts[2] === 'solution') {
      // Show solution
      await showSolutionView(caseId);
    } else {
      // Show case investigation
      await showCaseView(caseId);
    }
  } else {
    // Unknown route, show case list
    window.location.hash = '';
  }
}

/**
 * Show the case list view
 */
async function showCaseList() {
  showLoading(mainContainer);

  try {
    // Fetch cases if not cached
    if (!casesCache) {
      casesCache = await api.fetchCases();
    }

    renderCaseList(
      mainContainer,
      casesCache,
      appState.solvedCases,
      (caseId) => {
        state.setCurrentCase(appState, caseId);
        window.location.hash = `case/${caseId}`;
      }
    );
  } catch (error) {
    console.error('Failed to load cases:', error);
    showError(mainContainer, 'Failed to load case files. Please try again.');
  }
}

/**
 * Show the case investigation view
 * @param {string} caseId - The case ID
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipLoading - Skip the loading state (for smooth transitions)
 */
async function showCaseView(caseId, options = {}) {
  const { skipLoading = false } = options;

  if (!skipLoading) {
    showLoading(mainContainer);
  }

  try {
    // Get progress for this case
    const progress = state.getCaseProgress(appState, caseId);

    // Start investigation timer if not already started
    state.startInvestigation(appState, caseId);

    // Fetch case data with current clue level
    currentCaseData = await api.fetchCase(caseId, progress.cluesRevealed);

    // Load chat history
    chatMessages = state.getChatHistory(appState, caseId);

    // Render the view
    renderCaseView(mainContainer, currentCaseData, progress, {
      onBack: () => {
        window.location.hash = '';
      },
      onRevealClue: () => handleRevealClue(caseId),
      onSubmitDiagnosis: (submission) => handleSubmitDiagnosis(caseId, submission),
      onGiveUp: () => handleGiveUp(caseId),
      onSendMessage: (message) => handleSendMessage(caseId, message),
      onHintViewed: (hintId) => handleHintViewed(caseId, hintId),
      onUpdateScore: () => handleUpdateScore(caseId),
    });

    // Restore chat history in UI
    restoreChatHistory();

  } catch (error) {
    console.error('Failed to load case:', error);
    showError(mainContainer, 'Failed to load case. Please try again.');
  }
}

/**
 * Show the solution view
 */
async function showSolutionView(caseId) {
  showLoading(mainContainer);

  try {
    // Fetch case and solution data
    const progress = state.getCaseProgress(appState, caseId);
    const caseData = await api.fetchCase(caseId, progress.cluesRevealed);
    const solution = await api.fetchSolution(caseId);

    renderSolution(
      mainContainer,
      caseData,
      solution,
      progress.solved,
      () => {
        window.location.hash = `case/${caseId}`;
      }
    );
  } catch (error) {
    console.error('Failed to load solution:', error);
    showError(mainContainer, 'Failed to load solution. Please try again.');
  }
}

/**
 * Handle revealing a new clue
 */
async function handleRevealClue(caseId) {
  state.revealClue(appState, caseId, currentCaseData.totalClues);

  const progress = state.getCaseProgress(appState, caseId);

  // Fetch updated case data with the new clue
  currentCaseData = await api.fetchCase(caseId, progress.cluesRevealed);

  // Get the newly revealed clue (last in the array)
  const newClue = currentCaseData.clues[currentCaseData.clues.length - 1];

  // Inject just the new clue into the DOM — no full re-render, no scroll reset
  injectNewClue(
    mainContainer,
    newClue,
    progress.cluesRevealed,
    currentCaseData.totalClues,
    (hintId) => handleHintViewed(caseId, hintId),
    () => handleRevealClue(caseId)
  );
}

/**
 * Handle submitting a diagnosis (two-phase system)
 * @param {string} caseId - The case ID
 * @param {Object} submission - Object with phase, diagnosis, and proposedSolution
 */
async function handleSubmitDiagnosis(caseId, { phase, diagnosis, proposedSolution }) {
  const progress = state.getCaseProgress(appState, caseId);

  // Track attempts based on phase
  let attemptCount;
  if (phase === 1) {
    attemptCount = state.recordRootCauseAttempt(appState, caseId);
  } else {
    attemptCount = state.recordAttempt(appState, caseId);
  }

  // Show loading state on submit button
  setSubmitLoading(mainContainer, phase, true);

  try {
    const result = await api.checkDiagnosis(
      caseId,
      phase,
      diagnosis,
      proposedSolution,
      attemptCount,
      progress.cluesRevealed
    );

    // Clear loading state
    setSubmitLoading(mainContainer, phase, false);

    // Show feedback
    showDiagnosisFeedback(mainContainer, result);

    if (phase === 1) {
      // Phase 1: Root cause evaluation
      if (result.correct) {
        // Mark phase 1 complete and re-render to show phase 2
        state.markRootCauseCorrect(appState, caseId, diagnosis);

        // Brief delay then re-render to unlock phase 2
        setTimeout(() => {
          showCaseView(caseId);
        }, 1500);
      }
    } else {
      // Phase 2: Solution evaluation
      if (result.correct) {
        // Calculate and save final score
        const updatedProgress = state.getCaseProgress(appState, caseId);
        const finalScore = state.calculateScore(updatedProgress, currentCaseData.difficulty);
        state.markSolved(appState, caseId, finalScore);

        // Brief delay before showing solution
        setTimeout(() => {
          window.location.hash = `case/${caseId}/solution`;
        }, 2000);
      }
    }
  } catch (error) {
    console.error('Failed to check diagnosis:', error);
    // Clear loading state on error
    setSubmitLoading(mainContainer, phase, false);
    showDiagnosisFeedback(mainContainer, {
      correct: false,
      partial: false,
      feedback: 'Failed to check diagnosis. Please try again.',
    });
  }
}

/**
 * Handle hint view for scoring
 */
function handleHintViewed(caseId, hintId) {
  return state.recordHintView(appState, caseId, hintId);
}

/**
 * Handle score update (called every second)
 */
function handleUpdateScore(caseId) {
  if (!currentCaseData) return;

  const progress = state.getCaseProgress(appState, caseId);
  const estimatedScore = state.estimateCurrentScore(progress, currentCaseData.difficulty);

  // Calculate elapsed time
  let elapsedSeconds = 0;
  if (progress.startTime) {
    elapsedSeconds = Math.floor((Date.now() - progress.startTime) / 1000);
  }

  updateScoreDisplay(mainContainer, estimatedScore, elapsedSeconds);
}

/**
 * Handle giving up and viewing solution
 */
async function handleGiveUp(caseId) {
  state.markGaveUp(appState, caseId);
  window.location.hash = `case/${caseId}/solution`;
}

/**
 * Handle sending a chat message
 */
async function handleSendMessage(caseId, message) {
  const progress = state.getCaseProgress(appState, caseId);

  // Add user message to UI and state
  addChatMessage(mainContainer, 'user', message);
  chatMessages.push({ role: 'user', content: message });
  state.addChatMessage(appState, caseId, { role: 'user', content: message });

  // Create streaming message container
  const streamingContent = addStreamingMessage(mainContainer);
  if (!streamingContent) return;

  let fullResponse = '';

  // Send message to API
  await api.sendChatMessage(
    chatMessages,
    {
      caseId,
      cluesRevealed: progress.cluesRevealed,
    },
    // On each chunk
    (chunk) => {
      fullResponse += chunk;
      streamingContent.textContent = fullResponse;

      // Scroll to bottom
      const messagesContainer = mainContainer.querySelector('#chat-messages');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    },
    // On complete
    (response) => {
      finalizeStreamingMessage(mainContainer);
      chatMessages.push({ role: 'assistant', content: response });
      state.addChatMessage(appState, caseId, { role: 'assistant', content: response });
    },
    // On error
    (error) => {
      console.error('Chat error:', error);
      streamingContent.textContent = 'Sorry, I encountered an error. Please try again.';
      finalizeStreamingMessage(mainContainer);
    }
  );
}

/**
 * Restore chat history in the UI
 */
function restoreChatHistory() {
  const messagesContainer = mainContainer.querySelector('#chat-messages');
  if (!messagesContainer || chatMessages.length === 0) return;

  // Keep the initial greeting, add history after it
  for (const msg of chatMessages) {
    addChatMessage(mainContainer, msg.role, msg.content);
  }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

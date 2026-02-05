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
  finalizeStreamingMessage
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
 */
async function showCaseView(caseId) {
  showLoading(mainContainer);

  try {
    // Get progress for this case
    const progress = state.getCaseProgress(appState, caseId);

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
      onSubmitDiagnosis: (diagnosis) => handleSubmitDiagnosis(caseId, diagnosis),
      onGiveUp: () => handleGiveUp(caseId),
      onSendMessage: (message) => handleSendMessage(caseId, message),
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
  const progress = state.getCaseProgress(appState, caseId);
  const newClueCount = state.revealClue(appState, caseId, currentCaseData.totalClues);

  // Reload the case view with the new clue
  await showCaseView(caseId);
}

/**
 * Handle submitting a diagnosis
 */
async function handleSubmitDiagnosis(caseId, diagnosis) {
  const progress = state.getCaseProgress(appState, caseId);
  const attempts = state.recordAttempt(appState, caseId);

  try {
    const result = await api.checkDiagnosis(
      caseId,
      diagnosis,
      attempts,
      progress.cluesRevealed
    );

    // Show feedback
    showDiagnosisFeedback(mainContainer, result);

    // If correct, mark as solved and show solution
    if (result.correct) {
      state.markSolved(appState, caseId);

      // Brief delay before showing solution
      setTimeout(() => {
        window.location.hash = `case/${caseId}/solution`;
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to check diagnosis:', error);
    showDiagnosisFeedback(mainContainer, {
      correct: false,
      partial: false,
      feedback: '❌ Failed to check diagnosis. Please try again.',
    });
  }
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

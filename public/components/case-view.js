/**
 * Case View Component - investigation interface
 */

/**
 * Timeline event type styles
 */
const eventTypeStyles = {
  normal: 'timeline-normal',
  warning: 'timeline-warning',
  critical: 'timeline-critical',
};

/**
 * Clue type icons using Lucide icon names
 */
const clueTypeIcons = {
  metrics: 'bar-chart-3',
  logs: 'scroll-text',
  code: 'code-2',
  config: 'settings',
  testimony: 'message-circle',
};

/**
 * Render the case investigation view
 */
export function renderCaseView(container, caseData, progress, handlers) {
  const { onBack, onRevealClue, onSubmitDiagnosis, onGiveUp, onSendMessage } = handlers;

  container.innerHTML = `
    <div class="case-view">
      <div class="case-main">
        ${renderCaseHeader(caseData, onBack)}
        ${renderCrisisSection(caseData.crisis)}
        ${renderSymptomsSection(caseData.symptoms)}
        ${renderCluesSection(caseData, progress)}
        ${renderDiagnosisSection(caseData, progress)}
      </div>
      <div class="case-sidebar">
        ${renderChatPanel(caseData)}
      </div>
    </div>
  `;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Attach event handlers
  attachEventHandlers(container, caseData, progress, handlers);
}

/**
 * Render case header
 */
function renderCaseHeader(caseData, onBack) {
  const difficultyLabels = {
    junior: 'Junior',
    mid: 'Mid-Level',
    senior: 'Senior',
    principal: 'Principal',
  };

  return `
    <header class="case-header">
      <button class="btn-back" id="btn-back" aria-label="Back to case list"><i data-lucide="arrow-left"></i> Back to Cases</button>
      <div class="case-title-section">
        <h1>${caseData.title}</h1>
        <p class="case-subtitle">${caseData.subtitle}</p>
      </div>
      <div class="case-badges">
        <span class="badge badge-${caseData.difficulty}">${difficultyLabels[caseData.difficulty]}</span>
        <span class="badge badge-category">${caseData.category.charAt(0).toUpperCase() + caseData.category.slice(1)}</span>
      </div>
    </header>
  `;
}

/**
 * Render crisis section
 */
function renderCrisisSection(crisis) {
  return `
    <section class="crisis-section">
      <h2><i data-lucide="alert-circle" class="section-icon"></i> The Crisis</h2>
      <p class="crisis-description">${crisis.description}</p>
      <div class="impact-box">
        <strong><i data-lucide="trending-down" class="inline-icon"></i> Impact:</strong> ${crisis.impact}
      </div>
      <div class="timeline">
        <h3><i data-lucide="clock" class="inline-icon"></i> Timeline</h3>
        <ul class="timeline-list">
          ${crisis.timeline.map(event => `
            <li class="timeline-item ${eventTypeStyles[event.type || 'normal']}">
              <span class="timeline-time">${event.time}</span>
              <span class="timeline-event">${event.event}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    </section>
  `;
}

/**
 * Render symptoms section
 */
function renderSymptomsSection(symptoms) {
  return `
    <section class="symptoms-section">
      <h2><i data-lucide="scan-search" class="section-icon"></i> Symptoms</h2>
      <div class="symptoms-grid">
        <div class="symptoms-column working">
          <h3><i data-lucide="check-circle" class="inline-icon text-success"></i> What's Working</h3>
          <ul>
            ${symptoms.working.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
        <div class="symptoms-column broken">
          <h3><i data-lucide="x-circle" class="inline-icon text-danger"></i> What's Broken</h3>
          <ul>
            ${symptoms.broken.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>
    </section>
  `;
}

/**
 * Render clues section
 */
function renderCluesSection(caseData, progress) {
  const { clues, totalClues, cluesRevealed } = caseData;
  const hasMoreClues = cluesRevealed < totalClues;

  return `
    <section class="clues-section">
      <div class="clues-header">
        <h2><i data-lucide="folder-open" class="section-icon"></i> Evidence Board</h2>
        <span class="clue-counter">${cluesRevealed} of ${totalClues} clues examined</span>
      </div>

      <div class="clues-board">
        ${clues.map((clue, index) => renderClue(clue, index)).join('')}

        ${hasMoreClues ? `
          <div class="clue-placeholder">
            <button class="btn btn-secondary" id="btn-reveal-clue">
              <i data-lucide="search"></i> Investigate More (+1 clue)
            </button>
            <p class="placeholder-text">${totalClues - cluesRevealed} more clue${totalClues - cluesRevealed > 1 ? 's' : ''} available</p>
          </div>
        ` : `
          <div class="all-clues-revealed">
            <p><i data-lucide="check-circle-2" class="inline-icon"></i> All evidence examined</p>
          </div>
        `}
      </div>
    </section>
  `;
}

/**
 * Render a single clue
 */
function renderClue(clue, index) {
  const iconName = clueTypeIcons[clue.type] || 'file-text';

  // Process content to highlight code blocks
  let content = clue.content;

  // Convert markdown code blocks to HTML
  content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="code-block" data-lang="${lang}"><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Convert inline code
  content = content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  return `
    <div class="clue-card" data-clue-id="${clue.id}">
      <div class="clue-header">
        <i data-lucide="${iconName}" class="clue-icon"></i>
        <span class="clue-title">${clue.title}</span>
        <span class="clue-type badge">${clue.type}</span>
      </div>
      <div class="clue-content">${content}</div>
      ${clue.hint ? `
        <div class="clue-hint-container" data-hint-id="${clue.id}">
          <button type="button" class="btn-show-hint" data-hint-id="${clue.id}"><i data-lucide="lightbulb"></i> Show Hint</button>
          <div class="clue-hint hidden" data-hint-id="${clue.id}">${clue.hint}</div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render diagnosis section with two-phase system
 */
function renderDiagnosisSection(caseData, progress) {
  if (progress.solved) {
    const scoreDisplay = progress.score !== null ? `Score: ${progress.score} pts` : '';
    return `
      <section class="diagnosis-section solved">
        <h2><i data-lucide="badge-check" class="section-icon text-success"></i> Case Closed!</h2>
        <p class="solved-message">You correctly identified the root cause and proposed a valid solution.</p>
        ${scoreDisplay ? `<p class="final-score"><i data-lucide="trophy" class="inline-icon"></i> ${scoreDisplay}</p>` : ''}
        <button class="btn btn-primary" id="btn-view-solution"><i data-lucide="eye"></i> View Full Solution</button>
      </section>
    `;
  }

  if (progress.gaveUp) {
    return `
      <section class="diagnosis-section gave-up">
        <h2><i data-lucide="book-open" class="section-icon"></i> Solution Revealed</h2>
        <p class="gave-up-message">You requested to see the solution.</p>
        <button class="btn btn-primary" id="btn-view-solution"><i data-lucide="eye"></i> View Full Solution</button>
      </section>
    `;
  }

  // Two-phase diagnosis UI
  const phase1Complete = progress.rootCauseCorrect;

  return `
    <section class="diagnosis-section">
      <h2><i data-lucide="target" class="section-icon"></i> Your Analysis</h2>

      <div class="diagnosis-form">
        <!-- Phase 1: Root Cause -->
        <div class="diagnosis-phase ${phase1Complete ? 'phase-complete' : 'phase-active'}">
          <div class="phase-header">
            <span class="phase-label">Phase 1: Root Cause</span>
            ${phase1Complete ? '<i data-lucide="check-circle" class="phase-status text-success"></i>' : ''}
          </div>
          ${phase1Complete ? `
            <div class="phase-answer">
              <p class="submitted-answer">"${escapeHtml(progress.submittedRootCause)}"</p>
            </div>
          ` : `
            <div class="form-group">
              <label for="diagnosis-input">
                <span class="label-hint">What is causing this incident?</span>
              </label>
              <textarea
                id="diagnosis-input"
                placeholder="Describe what you think is causing this incident..."
                rows="3"
              ></textarea>
            </div>
            <button class="btn btn-primary" id="btn-submit-phase1">
              <span class="btn-text"><i data-lucide="send"></i> Submit Root Cause</span>
            </button>
          `}
        </div>

        <!-- Phase 2: Proposed Solution -->
        <div class="diagnosis-phase ${phase1Complete ? 'phase-active' : 'phase-locked'}">
          <div class="phase-header">
            <span class="phase-label">Phase 2: Proposed Solution</span>
            ${!phase1Complete ? '<i data-lucide="lock" class="phase-status text-muted"></i>' : ''}
          </div>
          ${phase1Complete ? `
            <div class="form-group">
              <label for="solution-input">
                <span class="label-hint">How would you fix this?</span>
              </label>
              <textarea
                id="solution-input"
                placeholder="Explain how you would fix this issue..."
                rows="3"
              ></textarea>
            </div>
            <button class="btn btn-primary" id="btn-submit-phase2">
              <span class="btn-text"><i data-lucide="send"></i> Submit Solution</span>
            </button>
          ` : `
            <p class="phase-locked-message">
              <i data-lucide="info" class="inline-icon"></i>
              Complete Phase 1 to unlock
            </p>
          `}
        </div>

        <div class="diagnosis-actions-secondary">
          <button class="btn btn-ghost" id="btn-give-up">
            <i data-lucide="flag"></i> Give Up & View Solution
          </button>
        </div>
      </div>

      <div id="diagnosis-feedback" class="diagnosis-feedback hidden"></div>

      <!-- Score Estimation Panel -->
      <div class="score-panel">
        <div class="score-estimate">
          <i data-lucide="zap" class="inline-icon"></i>
          <span>Score Estimate: </span>
          <span id="score-value" class="score-value">---</span>
          <span> pts</span>
        </div>
        <div class="score-stats">
          <span class="stat" id="stat-time">
            <i data-lucide="clock" class="inline-icon"></i>
            <span id="time-display">0:00</span>
          </span>
          <span class="stat">
            <i data-lucide="folder-open" class="inline-icon"></i>
            Clues: ${progress.cluesRevealed}/${caseData.totalClues}
          </span>
          <span class="stat">
            <i data-lucide="lightbulb" class="inline-icon"></i>
            Hints: <span id="hints-count">${progress.hintsViewed?.length || 0}</span>
          </span>
          <span class="stat">
            <i data-lucide="rotate-ccw" class="inline-icon"></i>
            Attempts: ${progress.rootCauseAttempts || 0}
          </span>
        </div>
      </div>
    </section>
  `;
}

/**
 * Render chat panel
 */
function renderChatPanel(caseData) {
  return `
    <div class="chat-panel">
      <div class="chat-header">
        <h3><i data-lucide="user-search" class="section-icon"></i> Detective Claude</h3>
        <p class="chat-subtitle">Your AI investigation partner</p>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="chat-message assistant">
          <div class="message-content">
            <p>*adjusts fedora* Another incident to investigate, I see. "${caseData.title}" - interesting case.</p>
            <p>I've seen patterns like this before. Take a look at the evidence and tell me what catches your eye. I'll help guide your investigation, but the breakthrough has to come from you.</p>
            <p>What do you notice first?</p>
          </div>
        </div>
      </div>

      <div class="chat-input-area">
        <textarea
          id="chat-input"
          placeholder="Share your thoughts with Detective Claude..."
          rows="2"
        ></textarea>
        <button class="btn btn-chat" id="btn-send-message" aria-label="Send message"><i data-lucide="send"></i></button>
      </div>
    </div>
  `;
}

/**
 * Attach event handlers
 */
function attachEventHandlers(container, caseData, progress, handlers) {
  const { onBack, onRevealClue, onSubmitDiagnosis, onGiveUp, onSendMessage, onHintViewed, onUpdateScore } = handlers;

  // Back button
  container.querySelector('#btn-back')?.addEventListener('click', onBack);

  // Show hint buttons - now with tracking
  container.querySelectorAll('.btn-show-hint').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hintId = btn.dataset.hintId;
      const hintEl = container.querySelector(`.clue-hint[data-hint-id="${hintId}"]`);
      if (hintEl) {
        hintEl.classList.remove('hidden');
        btn.style.display = 'none';
        // Track hint view for scoring
        if (onHintViewed) {
          const newCount = onHintViewed(hintId);
          // Update hints count in UI
          const hintsCountEl = container.querySelector('#hints-count');
          if (hintsCountEl) {
            hintsCountEl.textContent = newCount;
          }
        }
      }
    });
  });

  // Reveal clue button
  container.querySelector('#btn-reveal-clue')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRevealClue();
  });

  // Phase 1: Submit Root Cause
  const phase1Btn = container.querySelector('#btn-submit-phase1');
  const diagnosisInput = container.querySelector('#diagnosis-input');

  phase1Btn?.addEventListener('click', () => {
    const diagnosis = diagnosisInput?.value?.trim();

    if (!diagnosis) {
      alert('Please describe the root cause of the incident.');
      diagnosisInput?.focus();
      return;
    }

    onSubmitDiagnosis({ phase: 1, diagnosis, proposedSolution: '' });
  });

  // Phase 2: Submit Solution
  const phase2Btn = container.querySelector('#btn-submit-phase2');
  const solutionInput = container.querySelector('#solution-input');

  phase2Btn?.addEventListener('click', () => {
    const proposedSolution = solutionInput?.value?.trim();

    if (!proposedSolution) {
      alert('Please describe how you would fix this issue.');
      solutionInput?.focus();
      return;
    }

    onSubmitDiagnosis({ phase: 2, diagnosis: '', proposedSolution });
  });

  // Give up button
  container.querySelector('#btn-give-up')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to see the solution? You can keep investigating if you prefer.')) {
      onGiveUp();
    }
  });

  // View solution button (for solved/gave-up cases)
  container.querySelector('#btn-view-solution')?.addEventListener('click', onGiveUp);

  // Chat functionality
  const chatInput = container.querySelector('#chat-input');
  const sendBtn = container.querySelector('#btn-send-message');

  const sendMessage = () => {
    const message = chatInput?.value?.trim();
    if (message) {
      onSendMessage(message);
      chatInput.value = '';
    }
  };

  sendBtn?.addEventListener('click', sendMessage);

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Start score update interval
  if (onUpdateScore && !progress.solved && !progress.gaveUp) {
    // Initial update
    onUpdateScore();
    // Update every second
    const scoreInterval = setInterval(() => {
      const scoreEl = container.querySelector('#score-value');
      if (!scoreEl || !document.body.contains(scoreEl)) {
        clearInterval(scoreInterval);
        return;
      }
      onUpdateScore();
    }, 1000);
  }
}

/**
 * Update diagnosis feedback
 */
export function showDiagnosisFeedback(container, result) {
  const feedback = container.querySelector('#diagnosis-feedback');
  if (!feedback) return;

  feedback.classList.remove('hidden');
  feedback.className = `diagnosis-feedback ${result.correct ? 'success' : result.partial ? 'partial' : 'error'}`;

  let html = `<p class="feedback-message">${result.feedback}</p>`;

  if (result.hint) {
    html += `<p class="feedback-hint">${result.hint}</p>`;
  }

  if (result.matchedKeywords && result.matchedKeywords.length > 0) {
    html += `<p class="matched-keywords">Keywords matched: ${result.matchedKeywords.join(', ')}</p>`;
  }

  feedback.innerHTML = html;
}

/**
 * Add a message to the chat
 */
export function addChatMessage(container, role, content) {
  const messagesContainer = container.querySelector('#chat-messages');
  if (!messagesContainer) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;
  messageDiv.innerHTML = `<div class="message-content"><p>${escapeHtml(content)}</p></div>`;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Add a streaming message to the chat
 */
export function addStreamingMessage(container) {
  const messagesContainer = container.querySelector('#chat-messages');
  if (!messagesContainer) return null;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message assistant streaming';
  messageDiv.innerHTML = '<div class="message-content"><p class="streaming-content"></p></div>';

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageDiv.querySelector('.streaming-content');
}

/**
 * Finalize a streaming message
 */
export function finalizeStreamingMessage(container) {
  const streaming = container.querySelector('.chat-message.streaming');
  if (streaming) {
    streaming.classList.remove('streaming');
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Update the score display in real-time
 */
export function updateScoreDisplay(container, score, elapsedSeconds) {
  const scoreEl = container.querySelector('#score-value');
  const timeEl = container.querySelector('#time-display');

  if (scoreEl) {
    scoreEl.textContent = score;
  }

  if (timeEl && elapsedSeconds !== undefined) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    timeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Inject a new clue into the DOM without re-rendering the page.
 * Updates the clue counter, placeholder text, and adds hint handler.
 */
export function injectNewClue(container, newClue, cluesRevealed, totalClues, onHintViewed, onRevealClue) {
  const cluesBoard = container.querySelector('.clues-board');
  const placeholder = container.querySelector('.clue-placeholder');
  if (!cluesBoard || !placeholder) return;

  // Create the new clue card element
  const temp = document.createElement('div');
  temp.innerHTML = renderClue(newClue, cluesRevealed - 1);
  const clueCard = temp.firstElementChild;

  // Insert before the placeholder
  cluesBoard.insertBefore(clueCard, placeholder);

  // Update clue counter
  const counter = container.querySelector('.clue-counter');
  if (counter) {
    counter.textContent = `${cluesRevealed} of ${totalClues} clues examined`;
  }

  // Update the clues stat in score panel
  const cluesStat = container.querySelector('.score-stats');
  if (cluesStat) {
    const statSpans = cluesStat.querySelectorAll('.stat');
    statSpans.forEach(span => {
      if (span.textContent.includes('Clues:')) {
        span.innerHTML = `<i data-lucide="folder-open" class="inline-icon"></i> Clues: ${cluesRevealed}/${totalClues}`;
      }
    });
  }

  const remaining = totalClues - cluesRevealed;
  if (remaining > 0) {
    // Update placeholder text and re-bind click handler
    const placeholderText = placeholder.querySelector('.placeholder-text');
    if (placeholderText) {
      placeholderText.textContent = `${remaining} more clue${remaining > 1 ? 's' : ''} available`;
    }
    // Replace button to clear old listener, bind new one
    const oldBtn = placeholder.querySelector('#btn-reveal-clue');
    if (oldBtn) {
      const newBtn = oldBtn.cloneNode(true);
      oldBtn.replaceWith(newBtn);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onRevealClue();
      });
    }
  } else {
    // All clues revealed — replace placeholder
    placeholder.innerHTML = `
      <div class="all-clues-revealed">
        <p><i data-lucide="check-circle-2" class="inline-icon"></i> All evidence examined</p>
      </div>
    `;
  }

  // Attach hint handler for the new clue
  const hintBtn = clueCard.querySelector('.btn-show-hint');
  if (hintBtn) {
    hintBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hintId = hintBtn.dataset.hintId;
      const hintEl = clueCard.querySelector(`.clue-hint[data-hint-id="${hintId}"]`);
      if (hintEl) {
        hintEl.classList.remove('hidden');
        hintBtn.style.display = 'none';
        if (onHintViewed) {
          const newCount = onHintViewed(hintId);
          const hintsCountEl = container.querySelector('#hints-count');
          if (hintsCountEl) {
            hintsCountEl.textContent = newCount;
          }
        }
      }
    });
  }

  // Re-initialize Lucide icons for the new elements
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * Update the hints count display
 */
export function updateHintsCount(container, count) {
  const hintsEl = container.querySelector('#hints-count');
  if (hintsEl) {
    hintsEl.textContent = count;
  }
}

/**
 * Set loading state on submit button
 * @param {HTMLElement} container - The main container
 * @param {number} phase - The phase (1 or 2)
 * @param {boolean} isLoading - Whether to show loading state
 */
export function setSubmitLoading(container, phase, isLoading) {
  const btnId = phase === 1 ? '#btn-submit-phase1' : '#btn-submit-phase2';
  const btn = container.querySelector(btnId);

  if (!btn) return;

  if (isLoading) {
    btn.classList.add('btn-loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

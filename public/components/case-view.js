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
 * Clue type icons
 */
const clueTypeIcons = {
  metrics: '📊',
  logs: '📜',
  code: '💻',
  config: '⚙️',
  testimony: '💬',
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
      <button class="btn-back" id="btn-back">← Back to Cases</button>
      <div class="case-title-section">
        <h1>${caseData.title}</h1>
        <p class="case-subtitle">${caseData.subtitle}</p>
      </div>
      <div class="case-badges">
        <span class="badge badge-${caseData.difficulty}">${difficultyLabels[caseData.difficulty]}</span>
        <span class="badge badge-category">${caseData.category}</span>
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
      <h2>🚨 The Crisis</h2>
      <p class="crisis-description">${crisis.description}</p>
      <div class="impact-box">
        <strong>Impact:</strong> ${crisis.impact}
      </div>
      <div class="timeline">
        <h3>Timeline</h3>
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
      <h2>🔎 Symptoms</h2>
      <div class="symptoms-grid">
        <div class="symptoms-column working">
          <h3>✅ What's Working</h3>
          <ul>
            ${symptoms.working.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
        <div class="symptoms-column broken">
          <h3>❌ What's Broken</h3>
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
        <h2>🗂️ Evidence Board</h2>
        <span class="clue-counter">${cluesRevealed}/${totalClues} clues revealed</span>
      </div>

      <div class="clues-board">
        ${clues.map((clue, index) => renderClue(clue, index)).join('')}

        ${hasMoreClues ? `
          <div class="clue-placeholder">
            <button class="btn btn-secondary" id="btn-reveal-clue">
              🔍 Investigate More (+1 clue)
            </button>
            <p class="placeholder-text">${totalClues - cluesRevealed} more clue${totalClues - cluesRevealed > 1 ? 's' : ''} available</p>
          </div>
        ` : `
          <div class="all-clues-revealed">
            <p>📋 All evidence has been examined</p>
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
  const icon = clueTypeIcons[clue.type] || '📋';

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
        <span class="clue-icon">${icon}</span>
        <span class="clue-title">${clue.title}</span>
        <span class="clue-type badge">${clue.type}</span>
      </div>
      <div class="clue-content">${content}</div>
      ${clue.hint ? `<div class="clue-hint">💡 ${clue.hint}</div>` : ''}
    </div>
  `;
}

/**
 * Render diagnosis section
 */
function renderDiagnosisSection(caseData, progress) {
  if (progress.solved) {
    return `
      <section class="diagnosis-section solved">
        <h2>🎉 Case Closed!</h2>
        <p class="solved-message">You correctly identified the root cause.</p>
        <button class="btn btn-primary" id="btn-view-solution">View Full Solution</button>
      </section>
    `;
  }

  if (progress.gaveUp) {
    return `
      <section class="diagnosis-section gave-up">
        <h2>📖 Solution Revealed</h2>
        <p class="gave-up-message">You requested to see the solution.</p>
        <button class="btn btn-primary" id="btn-view-solution">View Full Solution</button>
      </section>
    `;
  }

  return `
    <section class="diagnosis-section">
      <h2>🎯 Your Diagnosis</h2>
      <p class="diagnosis-instructions">Based on the evidence, what's causing this incident?</p>

      <div class="diagnosis-form">
        <textarea
          id="diagnosis-input"
          placeholder="Describe the root cause of the incident..."
          rows="4"
        ></textarea>
        <div class="diagnosis-actions">
          <button class="btn btn-primary" id="btn-submit-diagnosis">
            Submit Diagnosis
          </button>
          <button class="btn btn-ghost" id="btn-give-up">
            Give Up & See Solution
          </button>
        </div>
      </div>

      <div id="diagnosis-feedback" class="diagnosis-feedback hidden"></div>

      <p class="attempt-counter">Attempts: ${progress.attempts}</p>
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
        <h3>🕵️ Detective Claude</h3>
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
          placeholder="Ask Detective Claude for guidance..."
          rows="2"
        ></textarea>
        <button class="btn btn-chat" id="btn-send-message">Send</button>
      </div>
    </div>
  `;
}

/**
 * Attach event handlers
 */
function attachEventHandlers(container, caseData, progress, handlers) {
  const { onBack, onRevealClue, onSubmitDiagnosis, onGiveUp, onSendMessage } = handlers;

  // Back button
  container.querySelector('#btn-back')?.addEventListener('click', onBack);

  // Reveal clue button
  container.querySelector('#btn-reveal-clue')?.addEventListener('click', onRevealClue);

  // Submit diagnosis
  const submitBtn = container.querySelector('#btn-submit-diagnosis');
  const diagnosisInput = container.querySelector('#diagnosis-input');

  submitBtn?.addEventListener('click', () => {
    const diagnosis = diagnosisInput?.value?.trim();
    if (diagnosis) {
      onSubmitDiagnosis(diagnosis);
    }
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

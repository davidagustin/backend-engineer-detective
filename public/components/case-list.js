/**
 * Case List Component - displays the grid of detective cases
 */

/**
 * Difficulty badge colors and labels
 */
const difficultyConfig = {
  junior: { label: 'Junior', class: 'badge-junior' },
  mid: { label: 'Mid-Level', class: 'badge-mid' },
  senior: { label: 'Senior', class: 'badge-senior' },
  principal: { label: 'Principal', class: 'badge-principal' },
};

/**
 * Category icons (emoji-based for simplicity)
 */
const categoryIcons = {
  database: '🗄️',
  caching: '📦',
  networking: '🌐',
  auth: '🔐',
  memory: '🧠',
  distributed: '🔗',
};

/**
 * Render the case list view
 */
export function renderCaseList(container, cases, solvedCases, onSelectCase) {
  const solvedSet = new Set(solvedCases);

  container.innerHTML = `
    <div class="case-list-header">
      <h1>🔍 Backend Engineer Detective</h1>
      <p class="subtitle">16 production incidents. 16 mysteries to solve. Can you find the root cause?</p>
      <div class="stats-bar">
        <span class="stat">
          <span class="stat-value">${solvedCases.length}</span>
          <span class="stat-label">Solved</span>
        </span>
        <span class="stat">
          <span class="stat-value">${cases.length - solvedCases.length}</span>
          <span class="stat-label">Remaining</span>
        </span>
        <span class="stat">
          <span class="stat-value">${Math.round((solvedCases.length / cases.length) * 100)}%</span>
          <span class="stat-label">Complete</span>
        </span>
      </div>
    </div>

    <div class="case-grid">
      ${cases.map((c, index) => renderCaseCard(c, index + 1, solvedSet.has(c.id))).join('')}
    </div>
  `;

  // Add click handlers
  container.querySelectorAll('.case-card').forEach(card => {
    card.addEventListener('click', () => {
      const caseId = card.dataset.caseId;
      onSelectCase(caseId);
    });
  });
}

/**
 * Render a single case card
 */
function renderCaseCard(caseData, caseNumber, isSolved) {
  const difficulty = difficultyConfig[caseData.difficulty];
  const icon = categoryIcons[caseData.category] || '📋';

  return `
    <div class="case-card ${isSolved ? 'solved' : ''}" data-case-id="${caseData.id}">
      <div class="case-card-header">
        <span class="case-number">#${String(caseNumber).padStart(2, '0')}</span>
        <span class="case-icon">${icon}</span>
        ${isSolved ? '<span class="solved-stamp">SOLVED</span>' : ''}
      </div>
      <h3 class="case-title">${caseData.title}</h3>
      <p class="case-subtitle">${caseData.subtitle}</p>
      <div class="case-meta">
        <span class="badge ${difficulty.class}">${difficulty.label}</span>
        <span class="clue-count">${caseData.totalClues} clues</span>
      </div>
    </div>
  `;
}

/**
 * Show loading state
 */
export function showLoading(container) {
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading case files...</p>
    </div>
  `;
}

/**
 * Show error state
 */
export function showError(container, message) {
  container.innerHTML = `
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <h2>Something went wrong</h2>
      <p>${message}</p>
      <button class="btn btn-primary" onclick="location.reload()">Try Again</button>
    </div>
  `;
}

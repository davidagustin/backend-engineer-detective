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
 * Category icons using Lucide icon names
 */
const categoryIcons = {
  database: 'database',
  caching: 'archive',
  networking: 'globe',
  auth: 'shield',
  memory: 'cpu',
  distributed: 'network',
};

/**
 * Render the case list view
 */
export function renderCaseList(container, cases, solvedCases, onSelectCase) {
  const solvedSet = new Set(solvedCases);

  container.innerHTML = `
    <div class="case-list-header">
      <h1><i data-lucide="search" class="header-icon"></i> Backend Engineer Detective</h1>
      <p class="subtitle">${cases.length} production incidents. ${cases.length} mysteries to solve. Can you find the root cause?</p>
      <div class="stats-bar">
        <span class="stat">
          <i data-lucide="check-circle" class="stat-icon"></i>
          <span class="stat-value">${solvedCases.length}</span>
          <span class="stat-label">Solved</span>
        </span>
        <span class="stat">
          <i data-lucide="folder-open" class="stat-icon"></i>
          <span class="stat-value">${cases.length - solvedCases.length}</span>
          <span class="stat-label">Remaining</span>
        </span>
        <span class="stat">
          <i data-lucide="percent" class="stat-icon"></i>
          <span class="stat-value">${Math.round((solvedCases.length / cases.length) * 100)}%</span>
          <span class="stat-label">Complete</span>
        </span>
      </div>
    </div>

    <div class="case-grid">
      ${cases.map((c, index) => renderCaseCard(c, index + 1, solvedSet.has(c.id))).join('')}
    </div>
  `;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

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
  const iconName = categoryIcons[caseData.category] || 'file-text';

  return `
    <div class="case-card ${isSolved ? 'solved' : ''}" data-case-id="${caseData.id}">
      <div class="case-card-header">
        <span class="case-number">#${String(caseNumber).padStart(2, '0')}</span>
        <i data-lucide="${iconName}" class="case-icon"></i>
        ${isSolved ? '<span class="solved-stamp">SOLVED</span>' : ''}
      </div>
      <h3 class="case-title">${caseData.title}</h3>
      <p class="case-subtitle">${caseData.subtitle}</p>
      <div class="case-meta">
        <span class="badge ${difficulty.class}">${difficulty.label}</span>
        <span class="clue-count"><i data-lucide="file-search" class="clue-icon"></i> ${caseData.totalClues} clues</span>
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
      <i data-lucide="alert-triangle" class="error-icon"></i>
      <h2>Something went wrong</h2>
      <p>${message}</p>
      <button class="btn btn-primary" onclick="location.reload()">Try Again</button>
    </div>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

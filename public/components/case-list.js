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
 * Category display labels
 */
const categoryLabels = {
  database: 'Database',
  caching: 'Caching',
  networking: 'Networking',
  auth: 'Auth',
  memory: 'Memory',
  distributed: 'Distributed',
};

/**
 * Filter state (in-memory)
 */
let filterState = {
  difficulty: 'all',
  category: 'all',
  status: 'all',
  search: '',
};

/**
 * Debounce helper for search input
 */
let searchDebounceTimer = null;
function debounce(fn, delay) {
  return (...args) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Apply filters to cases
 */
function filterCases(cases, solvedSet) {
  return cases.filter(c => {
    // Difficulty filter
    if (filterState.difficulty !== 'all' && c.difficulty !== filterState.difficulty) {
      return false;
    }

    // Category filter
    if (filterState.category !== 'all' && c.category !== filterState.category) {
      return false;
    }

    // Status filter
    if (filterState.status !== 'all') {
      const isSolved = solvedSet.has(c.id);
      if (filterState.status === 'solved' && !isSolved) return false;
      if (filterState.status === 'unsolved' && isSolved) return false;
    }

    // Search filter
    if (filterState.search) {
      const searchLower = filterState.search.toLowerCase();
      const titleMatch = c.title.toLowerCase().includes(searchLower);
      const subtitleMatch = c.subtitle.toLowerCase().includes(searchLower);
      const categoryMatch = categoryLabels[c.category]?.toLowerCase().includes(searchLower);
      if (!titleMatch && !subtitleMatch && !categoryMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Render filter bar
 */
function renderFilterBar(totalCases, filteredCount) {
  return `
    <div class="filter-bar">
      <div class="filter-controls">
        <div class="filter-group">
          <label for="filter-difficulty">Difficulty</label>
          <select id="filter-difficulty" class="filter-select">
            <option value="all" ${filterState.difficulty === 'all' ? 'selected' : ''}>All</option>
            <option value="junior" ${filterState.difficulty === 'junior' ? 'selected' : ''}>Junior</option>
            <option value="mid" ${filterState.difficulty === 'mid' ? 'selected' : ''}>Mid-Level</option>
            <option value="senior" ${filterState.difficulty === 'senior' ? 'selected' : ''}>Senior</option>
            <option value="principal" ${filterState.difficulty === 'principal' ? 'selected' : ''}>Principal</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-category">Category</label>
          <select id="filter-category" class="filter-select">
            <option value="all" ${filterState.category === 'all' ? 'selected' : ''}>All</option>
            <option value="database" ${filterState.category === 'database' ? 'selected' : ''}>Database</option>
            <option value="caching" ${filterState.category === 'caching' ? 'selected' : ''}>Caching</option>
            <option value="networking" ${filterState.category === 'networking' ? 'selected' : ''}>Networking</option>
            <option value="auth" ${filterState.category === 'auth' ? 'selected' : ''}>Auth</option>
            <option value="memory" ${filterState.category === 'memory' ? 'selected' : ''}>Memory</option>
            <option value="distributed" ${filterState.category === 'distributed' ? 'selected' : ''}>Distributed</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-status">Status</label>
          <select id="filter-status" class="filter-select">
            <option value="all" ${filterState.status === 'all' ? 'selected' : ''}>All</option>
            <option value="solved" ${filterState.status === 'solved' ? 'selected' : ''}>Solved</option>
            <option value="unsolved" ${filterState.status === 'unsolved' ? 'selected' : ''}>Unsolved</option>
          </select>
        </div>

        <div class="filter-group filter-search">
          <label for="filter-search">Search</label>
          <div class="search-input-wrapper">
            <i data-lucide="search" class="search-icon"></i>
            <input
              type="text"
              id="filter-search"
              class="filter-input"
              placeholder="Search cases..."
              value="${filterState.search}"
            />
          </div>
        </div>
      </div>

      <div class="filter-results">
        Showing <strong>${filteredCount}</strong> of <strong>${totalCases}</strong> cases
      </div>
    </div>
  `;
}

/**
 * Render no results message
 */
function renderNoResults() {
  return `
    <div class="no-results">
      <i data-lucide="search-x" class="no-results-icon"></i>
      <h3>No cases found</h3>
      <p>Try adjusting your filters or search term</p>
    </div>
  `;
}

/**
 * Render the case list view
 */
export function renderCaseList(container, cases, solvedCases, onSelectCase, onResetProgress) {
  const solvedSet = new Set(solvedCases);
  const filteredCases = filterCases(cases, solvedSet);

  container.innerHTML = `
    <div class="case-list-header">
      <div class="settings-container">
        <button class="btn-settings" id="settings-btn" aria-label="Settings">
          <i data-lucide="settings"></i>
        </button>
        <div class="settings-dropdown" id="settings-dropdown" style="display: none;">
          <button class="settings-dropdown-item" id="reset-progress-btn">
            <i data-lucide="trash-2" class="text-danger"></i>
            <span class="text-danger">Reset All Progress</span>
          </button>
        </div>
      </div>
      <h1><i data-lucide="search" class="header-icon"></i> Backend Engineer Detective</h1>
      <p class="subtitle">${cases.length} production incidents. Can you find the root cause?</p>
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

    ${renderFilterBar(cases.length, filteredCases.length)}

    ${filteredCases.length > 0 ? `
      <div class="case-grid">
        ${filteredCases.map((c) => {
          const originalIndex = cases.findIndex(original => original.id === c.id);
          return renderCaseCard(c, originalIndex + 1, solvedSet.has(c.id));
        }).join('')}
      </div>
    ` : renderNoResults()}
  `;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Add click handlers for case cards
  container.querySelectorAll('.case-card').forEach(card => {
    card.addEventListener('click', () => {
      const caseId = card.dataset.caseId;
      onSelectCase(caseId);
    });
  });

  // Add filter event listeners
  const rerender = () => renderCaseList(container, cases, solvedCases, onSelectCase, onResetProgress);

  container.querySelector('#filter-difficulty')?.addEventListener('change', (e) => {
    filterState.difficulty = e.target.value;
    rerender();
  });

  container.querySelector('#filter-category')?.addEventListener('change', (e) => {
    filterState.category = e.target.value;
    rerender();
  });

  container.querySelector('#filter-status')?.addEventListener('change', (e) => {
    filterState.status = e.target.value;
    rerender();
  });

  const debouncedSearch = debounce((value) => {
    filterState.search = value;
    rerender();
  }, 200);

  container.querySelector('#filter-search')?.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Settings dropdown handlers
  const settingsBtn = container.querySelector('#settings-btn');
  const settingsDropdown = container.querySelector('#settings-dropdown');
  const resetProgressBtn = container.querySelector('#reset-progress-btn');

  if (settingsBtn && settingsDropdown) {
    // Toggle dropdown
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = settingsDropdown.style.display === 'block';
      settingsDropdown.style.display = isVisible ? 'none' : 'block';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
        settingsDropdown.style.display = 'none';
      }
    });
  }

  // Reset progress button
  if (resetProgressBtn) {
    resetProgressBtn.addEventListener('click', () => {
      settingsDropdown.style.display = 'none';
      showResetConfirmationModal(onResetProgress);
    });
  }
}

/**
 * Show reset confirmation modal
 */
function showResetConfirmationModal(onConfirm) {
  // Create modal overlay
  const modalHtml = `
    <div class="modal-overlay" id="reset-modal">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Reset All Progress</h3>
          <button class="btn-modal-close" id="modal-close-btn" aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="modal-body">
          <p>This will clear all your solved cases, scores, chat history, and investigation progress. This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" id="modal-cancel-btn">Cancel</button>
          <button class="btn-danger" id="modal-confirm-btn">Reset Everything</button>
        </div>
      </div>
    </div>
  `;

  // Add modal to body
  const modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer.firstElementChild);

  // Initialize Lucide icons for the modal
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const modal = document.getElementById('reset-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  // Close modal function
  const closeModal = () => {
    modal.remove();
  };

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close on X button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // Close on Cancel button
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }

  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);

  // Confirm reset
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      closeModal();
      onConfirm();
    });
  }
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
      <p>Loading cases...</p>
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
      <button class="btn btn-primary" onclick="location.reload()">Reload Cases</button>
    </div>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

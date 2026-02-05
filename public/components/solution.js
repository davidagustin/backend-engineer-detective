/**
 * Solution Component - displays the full solution after solving or giving up
 */

/**
 * Render the solution view
 */
export function renderSolution(container, caseData, solution, wasSolved, onBack) {
  container.innerHTML = `
    <div class="solution-view">
      <header class="solution-header">
        <button class="btn-back" id="btn-back">← Back to Case</button>
        <div class="solution-title-section">
          <h1>${wasSolved ? '🎉 Case Closed!' : '📖 Solution Revealed'}</h1>
          <h2>${caseData.title}</h2>
        </div>
        ${wasSolved ? '<div class="solved-badge">SOLVED</div>' : ''}
      </header>

      <section class="solution-section diagnosis">
        <h2>🎯 Root Cause</h2>
        <div class="diagnosis-box">
          <p class="diagnosis-text">${solution.diagnosis}</p>
        </div>
      </section>

      <section class="solution-section root-cause">
        <h2>🔍 Full Explanation</h2>
        <div class="explanation-content">
          ${formatExplanation(solution.rootCause)}
        </div>
      </section>

      <section class="solution-section code-examples">
        <h2>💻 Code Solutions</h2>
        ${solution.codeExamples.map(example => renderCodeExample(example)).join('')}
      </section>

      <section class="solution-section prevention">
        <h2>🛡️ Prevention Strategies</h2>
        <ul class="prevention-list">
          ${solution.prevention.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </section>

      <section class="solution-section insights">
        <h2>📚 Educational Insights</h2>
        <div class="insights-grid">
          ${solution.educationalInsights.map(insight => `
            <div class="insight-card">
              <span class="insight-icon">💡</span>
              <p>${insight}</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="solution-section next-steps">
        <h2>🚀 What's Next?</h2>
        <div class="next-steps-content">
          <p>You've ${wasSolved ? 'solved' : 'learned about'} this case! Here's what you can do next:</p>
          <ul>
            <li>Try another case to expand your debugging skills</li>
            <li>Research the related technologies mentioned in this case</li>
            <li>Discuss with the AI Detective about similar patterns</li>
          </ul>
          <button class="btn btn-primary" id="btn-back-to-cases">Browse More Cases</button>
        </div>
      </section>
    </div>
  `;

  // Attach event handlers
  container.querySelector('#btn-back')?.addEventListener('click', onBack);
  container.querySelector('#btn-back-to-cases')?.addEventListener('click', () => {
    window.location.hash = '';
  });

  // Syntax highlighting if Prism is available
  if (typeof Prism !== 'undefined') {
    Prism.highlightAllUnder(container);
  }
}

/**
 * Render a code example
 */
function renderCodeExample(example) {
  const lang = example.lang || 'typescript';
  const langDisplay = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    bash: 'Bash',
    sql: 'SQL',
    yaml: 'YAML',
    json: 'JSON',
  }[lang] || lang;

  return `
    <div class="code-example">
      <div class="code-example-header">
        <span class="code-lang">${langDisplay}</span>
        <span class="code-description">${example.description}</span>
      </div>
      <pre class="code-block" data-lang="${lang}"><code class="language-${lang}">${escapeHtml(example.code)}</code></pre>
    </div>
  `;
}

/**
 * Format the root cause explanation
 */
function formatExplanation(text) {
  // Split into paragraphs
  const paragraphs = text.split('\n\n');

  return paragraphs.map(p => {
    // Check if it's a numbered list
    if (/^\d+\./.test(p)) {
      const items = p.split(/\n(?=\d+\.)/);
      return `<ol class="explanation-list">${items.map(item => `<li>${item.replace(/^\d+\.\s*/, '')}</li>`).join('')}</ol>`;
    }

    // Check if it's a bullet list
    if (/^[-*]/.test(p)) {
      const items = p.split(/\n(?=[-*])/);
      return `<ul class="explanation-list">${items.map(item => `<li>${item.replace(/^[-*]\s*/, '')}</li>`).join('')}</ul>`;
    }

    // Regular paragraph
    return `<p>${p}</p>`;
  }).join('');
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

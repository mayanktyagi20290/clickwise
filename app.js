import { RegexEngine } from './engine.js';

// Application State Store
const state = {
  activeView: 'regex',
  currentPattern: '^(who|what|where|when|why|how|can)\\b',
  testDataset: [
    'how to run an seo audit',
    'buy cheap keywords tool',
    'clickwise pricing plans',
    'what is technical seo',
    'best keyword tracking application',
    'where to find free backlinks'
  ],
  lastResult: null
};

// DOM Elements
const DOM = {
  navLinks: document.querySelectorAll('.nav-item'),
  patternInput: document.getElementById('pattern-input'),
  templateSelect: document.getElementById('template-select'),
  testInput: document.getElementById('test-input'),
  explanationBox: document.getElementById('explanation-box'),
  statusBadge: document.getElementById('status-badge'),
  resultsBody: document.getElementById('results-body'),
  btnCopy: document.getElementById('btn-copy'),
  btnTest: document.getElementById('btn-test')
};

// Initialize Application
function init() {
  bindEvents();
  loadTemplates();
  runPatternEvaluation();
}

function bindEvents() {
  // Real-time Pattern Input Validation
  if (DOM.patternInput) {
    DOM.patternInput.addEventListener('input', (e) => {
      state.currentPattern = e.target.value;
      runPatternEvaluation();
    });
  }

  // Template Selection Update
  if (DOM.templateSelect) {
    DOM.templateSelect.addEventListener('change', (e) => {
      const templates = RegexEngine.getTemplates();
      const selected = templates.find(t => t.id === e.target.value);
      if (selected) {
        DOM.patternInput.value = selected.pattern;
        state.currentPattern = selected.pattern;
        runPatternEvaluation();
      }
    });
  }

  // Test Dataset Editor
  if (DOM.testInput) {
    DOM.testInput.addEventListener('input', (e) => {
      state.testDataset = e.target.value.split('\n').filter(s => s.trim().length > 0);
      runPatternEvaluation();
    });
  }

  // Copy Clipboard Helper
  if (DOM.btnCopy) {
    DOM.btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(state.currentPattern).then(() => {
        const origText = DOM.btnCopy.innerText;
        DOM.btnCopy.innerText = 'Copied!';
        setTimeout(() => DOM.btnCopy.innerText = origText, 2000);
      });
    });
  }
}

function loadTemplates() {
  if (!DOM.templateSelect) return;
  const templates = RegexEngine.getTemplates();
  DOM.templateSelect.innerHTML = templates.map(t => 
    `<option value="${t.id}">${t.name}</option>`
  ).join('');
}

function runPatternEvaluation() {
  const result = RegexEngine.evaluatePattern(state.currentPattern, state.testDataset);
  state.lastResult = result;
  renderResults(result);
}

function renderResults(result) {
  if (!DOM.explanationBox || !DOM.resultsBody) return;

  if (!result.isValid) {
    DOM.statusBadge.innerText = 'Invalid Syntax';
    DOM.statusBadge.className = 'status-tag status-nomatch';
    DOM.explanationBox.innerText = `Error: ${result.error}`;
    DOM.resultsBody.innerHTML = `<tr><td colspan="2" style="color:var(--accent-red)">Invalid expression syntax</td></tr>`;
    return;
  }

  DOM.statusBadge.innerText = `${result.matchCount} / ${result.totalCount} Matches`;
  DOM.statusBadge.className = 'status-tag status-match';
  DOM.explanationBox.innerText = result.explanation;

  // Escape HTML to prevent XSS
  DOM.resultsBody.innerHTML = result.matches.map(item => `
    <tr>
      <td><code>${escapeHTML(item.string)}</code></td>
      <td>
        <span class="status-tag ${item.match ? 'status-match' : 'status-nomatch'}">
          ${item.match ? 'MATCH' : 'NO MATCH'}
        </span>
      </td>
    </tr>
  `).join('');
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

document.addEventListener('DOMContentLoaded', init);

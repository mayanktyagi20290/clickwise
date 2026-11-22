// Light / dark toggle. The choice is saved in this browser; with no choice the app follows the system setting.
(function () {
  'use strict';
  const root = document.documentElement, btn = document.getElementById('btn-theme');
  const sysDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const cur = () => root.dataset.theme || (sysDark() ? 'dark' : 'light');
  const paint = () => { if (!btn) return; const d = cur() === 'dark'; btn.setAttribute('aria-pressed', d ? 'true' : 'false'); btn.title = d ? 'Switch to light mode' : 'Switch to dark mode'; btn.setAttribute('aria-label', btn.title); btn.classList.toggle('is-dark', d); };
  if (btn) btn.addEventListener('click', () => {
    const next = cur() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next; try { localStorage.setItem('cw:theme', next); } catch (e) { }
    paint();
    // charts read the theme colours when they are drawn, so draw the current screen again
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  paint();
})();

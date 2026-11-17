// Clickwise application shell: the SEO Opportunities workspace (filter, sort, search, detail drawer) and the
// persistent Ask Clickwise dock. Both read data the analysis already produced (priority groups, tasks, the
// copilot answer engine); nothing here fetches data, stores search data or changes authentication.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const { range, pctf, urlCell, serp } = ui;
  const CW = window.CW, fmtN = CW.fmtN;
  const G = () => window.CW_GROWTH, TK = () => window.CW_TASKS;
  const p1 = v => v == null || isNaN(v) ? '—' : (+v).toFixed(1);
  const IC = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    spark: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  const ico = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

  // ───────────── SEO Opportunities workspace ─────────────
  const classic = V.opps;
  V['opps-all'] = (A, D) => classic(A, D);
  const F = { q: '', type: '', pri: '', eff: '', st: '', sort: 'score', dir: -1, page: 0 };
  const PAGE = 25;
  const statusLabel = g => g.status && g.status !== 'open' ? (TK().STATUS[g.status] || g.status) : 'Open';
  const mid = g => g.impact.kind === 'none' ? 0 : ((g.impact.lo || 0) + (g.impact.hi || 0)) / 2;
  const SORTS = {
    score: g => g.score || 0, pos: g => g.measured.pos == null ? 999 : g.measured.pos, impr: g => g.measured.impr || 0,
    clicks: g => g.measured.clicks == null ? -1 : g.measured.clicks, ctr: g => g.measured.ctr == null ? -1 : g.measured.ctr,
    impact: mid, eff: g => ({ Low: 1, Medium: 2, High: 3 })[g.effort.level] || 0, type: g => g.typeLabel, st: g => statusLabel(g), q: g => g.subject.label
  };
  const queryOf = g => g.subject.kind === 'query' ? g.subject.label : '';
  const urlOf = g => g.page ? g.page.path : g.subject.kind === 'page' ? g.subject.label : '';
  function filtered(items) {
    const q = F.q.trim().toLowerCase();
    let a = items.filter(g => (!F.type || g.type === F.type) && (!F.pri || g.priority === F.pri) && (!F.eff || g.effort.level === F.eff) && (!F.st || statusLabel(g) === F.st) &&
      (!q || (queryOf(g) + ' ' + urlOf(g) + ' ' + g.typeLabel).toLowerCase().includes(q)));
    const f = SORTS[F.sort] || SORTS.score;
    return a.sort((x, y) => { const u = f(x), v = f(y); return (u < v ? -1 : u > v ? 1 : 0) * F.dir; });
  }
  const impactCell = g => g.impact.kind === 'none' ? '<span class="flat">Watch</span>' :
    `<span class="${g.impact.kind === 'growth' ? 'gainv' : 'lossv'}">${range(g.impact.lo, g.impact.hi)}</span><small class="flat"> /mo</small>`;
  const sel = (id, label, opts, val) => `<label class="ow-f"><span>${label}</span><select id="${id}"><option value="">All</option>${opts.map(o => `<option value="${esc(o[0])}"${o[0] === val ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;

  V.opps = (A, D) => {
    let P = null; try { P = G() ? G().prio(A, D) : null; } catch (e) { }
    if (!P || !P.items) return classic(A, D);
    const items = P.items, tot = P.totals.growth;
    const types = [...new Map(items.map(g => [g.type, g.typeLabel]))];
    const stats = [...new Set(items.map(statusLabel))];
    const strip = `<div class="ow-strip">
      <div><b class="num">${items.length.toLocaleString()}</b><span>opportunities</span></div>
      <div><b class="num pri p1">${P.counts.P1}</b><span>P1 · do first</span></div>
      <div><b class="num pri p2">${P.counts.P2}</b><span>P2 · next</span></div>
      <div><b class="num pri p3">${P.counts.P3}</b><span>P3 · later</span></div>
      <div><b class="num gainv">${tot && tot.hi >= 1 ? range(tot.lo, tot.hi) : '—'}</b><span>clicks / month, each search counted once</span></div></div>`;
    const html = `${ui.head('SEO Opportunities', 'Every opportunity found in your Search Console data, ranked by priority. Select a row for the evidence, the reasoning and the next step.')}
      ${strip}
      <details class="panel cc-how"><summary>How the priority score works</summary><div class="panel-b">
        <p>Each opportunity gets a 0–100 score from five weighted components. P1 is 60 or more, P2 is 42–59, P3 is below 42. Nothing is hidden: open any row to see its own points.</p>
        <table class="how-t"><thead><tr><th>Component</th><th class="r">Weight</th><th>What feeds it</th></tr></thead><tbody>
        ${[['impact', 'Traffic potential', 'Search demand (impressions), current position, CTR gap against what this site earns at the target position, and the resulting estimated extra clicks a month'],
          ['confidence', 'Evidence confidence', 'Data volume, length of period, how the expected CTR was measured, known results-page effects'],
          ['relevance', 'Business relevance', 'Whether the page or search is in a priority section or term you set (Priorities screen)'],
          ['speed', 'Time to impact', 'How soon Search usually reflects this kind of change'],
          ['effort', 'Implementation difficulty', 'Low, medium or high effort, inverted so easier work scores higher']].map(r => `<tr><td><b>${r[1]}</b></td><td class="r num">${P.wSum ? Math.round((P.weights[r[0]] || 0) / P.wSum * 100) : 0}%</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
        <p class="flat">Estimated clicks are a range based on your own data, not a forecast or a guarantee. Google updates, seasonality and competitors can change the outcome.</p></div></details>
      <section class="panel ow" id="ow">
        <div class="ow-bar">
          <label class="ow-search">${ico('search')}<input id="ow-q" type="search" placeholder="Search queries, URLs or types" value="${esc(F.q)}" aria-label="Search opportunities" autocomplete="off"></label>
          ${sel('ow-type', 'Type', types, F.type)}${sel('ow-pri', 'Priority', [['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']], F.pri)}${sel('ow-eff', 'Difficulty', [['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']], F.eff)}${sel('ow-st', 'Status', stats.map(s => [s, s]), F.st)}
          <button type="button" class="btn-quiet" id="ow-reset">Reset</button>
          <a class="ow-alt" href="#opps-all">Evidence list ${ico('ext')}</a>
        </div>
        <div class="ow-count" id="ow-count" role="status"></div>
        <div class="ow-scroll"><table class="ow-t"><thead id="ow-h"></thead><tbody id="ow-b"></tbody></table></div>
        <div class="ow-pager" id="ow-pg"></div>
      </section>`;
    const COLS = [['score', 'Priority'], ['type', 'Type'], ['url', 'URL', 0], ['q', 'Target query'], ['pos', 'Position', 1], ['impr', 'Impressions', 1], ['clicks', 'Clicks', 1], ['ctr', 'CTR', 1], ['impact', 'Est. impact', 1], ['eff', 'Difficulty'], ['act', 'Recommended action', 0], ['st', 'Status']];
    const mount = () => {
      const $ = id => document.getElementById(id);
      function draw() {
        const rows = filtered(items), pages = Math.max(1, Math.ceil(rows.length / PAGE));
        F.page = Math.min(F.page, pages - 1);
        $('ow-h').innerHTML = '<tr>' + COLS.map(c => {
          const k = c[0], can = SORTS[k] !== undefined, on = F.sort === k;
          return `<th scope="col"${c[2] ? ' class="r"' : ''}${on ? ` aria-sort="${F.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${can ? `<button type="button" data-sort="${k}">${c[1]}${on ? (F.dir > 0 ? ' ↑' : ' ↓') : ''}</button>` : c[1]}</th>`;
        }).join('') + '</tr>';
        const view = rows.slice(F.page * PAGE, F.page * PAGE + PAGE);
        $('ow-b').innerHTML = view.length ? view.map(g => {
          const m = g.measured, q = queryOf(g), u = urlOf(g);
          return `<tr tabindex="0" data-id="${esc(g.id)}" aria-label="Open details for ${esc(g.subject.label)}">
            <td><span class="pri ${g.priority.toLowerCase()}">${esc(g.priority)}</span> <small class="flat num">${g.score}</small></td>
            <td><span class="tag">${esc(g.typeLabel)}</span></td>
            <td class="ow-u" title="${esc(u)}">${u ? esc(u) : '<span class="flat">—</span>'}</td>
            <td class="ow-q">${q ? esc(q) : '<span class="flat">—</span>'}</td>
            <td class="r num">${m.pos != null ? p1(m.pos) : '—'}</td><td class="r num">${m.impr != null ? fmtN(m.impr) : '—'}</td>
            <td class="r num">${m.clicks != null ? fmtN(m.clicks) : '—'}</td><td class="r num">${m.ctr != null ? pctf(m.ctr) : '—'}</td>
            <td class="r num">${impactCell(g)}</td><td><span class="tag">${esc(g.effort.level)}</span></td>
            <td class="ow-a" title="${esc(g.action)}">${esc(g.action)}</td>
            <td><span class="st st-${esc(statusLabel(g).toLowerCase().replace(/\s+/g, '-'))}">${esc(statusLabel(g))}</span></td></tr>`;
        }).join('') : `<tr><td colspan="${COLS.length}" class="empty">No opportunities match these filters.</td></tr>`;
        $('ow-count').textContent = `${rows.length.toLocaleString()} of ${items.length.toLocaleString()} opportunities`;
        $('ow-pg').innerHTML = pages > 1 ? `<button type="button" class="btn-quiet" data-pg="-1"${F.page === 0 ? ' disabled' : ''}>Previous</button><span>Page ${F.page + 1} of ${pages}</span><button type="button" class="btn-quiet" data-pg="1"${F.page >= pages - 1 ? ' disabled' : ''}>Next</button>` : '';
      }
      draw();
      const bind = (id, key, ev) => $(id).addEventListener(ev || 'change', e => { F[key] = e.target.value; F.page = 0; draw(); });
      bind('ow-q', 'q', 'input'); bind('ow-type', 'type'); bind('ow-pri', 'pri'); bind('ow-eff', 'eff'); bind('ow-st', 'st');
      $('ow-reset').addEventListener('click', () => { Object.assign(F, { q: '', type: '', pri: '', eff: '', st: '', page: 0 }); ['ow-q', 'ow-type', 'ow-pri', 'ow-eff', 'ow-st'].forEach(i => $(i).value = ''); draw(); });
      $('ow').addEventListener('click', e => {
        const s = e.target.closest('[data-sort]'), pg = e.target.closest('[data-pg]'), tr = e.target.closest('tbody tr[data-id]');
        if (s) { const k = s.dataset.sort; if (F.sort === k) F.dir = -F.dir; else { F.sort = k; F.dir = ['pos', 'eff', 'type', 'q', 'st'].includes(k) ? 1 : -1; } draw(); }
        else if (pg) { F.page += +pg.dataset.pg; draw(); }
        else if (tr && !e.target.closest('a')) openDrawer(items.find(g => g.id === tr.dataset.id), A, D, draw);
      });
      $('ow').addEventListener('keydown', e => { const tr = e.target.closest && e.target.closest('tbody tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); openDrawer(items.find(g => g.id === tr.dataset.id), A, D, draw); } });
    };
    return { html, mount };
  };

  // ───────────── detail drawer ─────────────
  const PARTL = { impact: 'Traffic potential', confidence: 'Evidence confidence', relevance: 'Business relevance', speed: 'Time to impact', effort: 'Implementation difficulty' };
  let drawer, lastFocus;
  function closeDrawer() { if (!drawer) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.getElementById('dr-scrim').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function ensureDrawer() {
    if (drawer) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="dr-scrim" id="dr-scrim" hidden></div><aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Opportunity details" aria-hidden="true"></aside>`);
    drawer = document.getElementById('drawer');
    document.getElementById('dr-scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(); });
    window.addEventListener('hashchange', () => { if (drawer.classList.contains('open')) closeDrawer(); });
  }
  function openDrawer(g, A, D, redraw) {
    if (!g) return;
    ensureDrawer(); lastFocus = document.activeElement;
    const m = g.measured, im = g.impact, list = a => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const metric = (l, v) => `<div><span>${l}</span><b class="num">${v}</b></div>`;
    const prev = g.previous ? `<p class="flat">Previous period: ${g.previous.clicks != null ? fmtN(g.previous.clicks) + ' clicks' : ''}${g.previous.pos != null ? ' · position ' + p1(g.previous.pos) : ''}</p>` : '';
    drawer.innerHTML = `<header><div><span class="tag">${esc(g.typeLabel)}</span> <span class="pri ${g.priority.toLowerCase()}">${esc(g.priority)}</span> <span class="st st-${esc(statusLabel(g).toLowerCase().replace(/\s+/g, '-'))}">${esc(statusLabel(g))}</span>
        <h2>${esc(g.subject.label)}</h2>${g.page && g.subject.kind === 'query' ? `<p class="flat">Landing page: ${esc(g.page.path)}</p>` : ''}</div>
        <button type="button" class="icon-btn" id="dr-x" aria-label="Close details">${ico('x')}</button></header>
      <div class="dr-b">
        <div class="dr-m">${metric('Position', m.pos != null ? p1(m.pos) : '—')}${metric('Impressions', m.impr != null ? fmtN(m.impr) : '—')}${metric('Clicks', m.clicks != null ? fmtN(m.clicks) : '—')}${metric('CTR', m.ctr != null ? pctf(m.ctr) : '—')}</div>
        ${prev}
        <h3>Recommended action</h3><p>${esc(g.action)}</p><p><span class="tag">${esc(g.effort.level)} effort</span> <small class="flat">${esc(g.effort.why || '')}</small></p>
        <h3>Estimated impact</h3>
        <p>${im.kind === 'none' ? 'No click estimate for this item. It is a signal to watch.' : `<b class="${im.kind === 'growth' ? 'gainv' : 'lossv'}">${range(im.lo, im.hi)} clicks a month</b> (${esc(im.kind)}). ${esc(im.note || '')}${im.basis ? ' ' + esc(im.basis) + '.' : ''}`}</p>
        ${im.overlap ? `<p class="flat">${esc(im.overlap)}.</p>` : ''}
        <h3>Why it was picked</h3><p>${esc(g.reason || g.why || '')}</p>${list(g.evidence)}
        <h3>Priority score: ${g.score}/100 (${esc(g.priority)})</h3>
        <table class="how-t"><tbody>${(g.parts || []).map(x => `<tr><td>${esc(PARTL[x.key] || x.key)}</td><td class="r num">${x.points.toFixed(1)} pts</td><td class="flat">${esc(x.why)}</td></tr>`).join('')}</tbody></table>
        <h3>Tracking history</h3>
        ${g.task && g.task.history && g.task.history.length ? `<ol class="hist">${g.task.history.slice().reverse().map(h => `<li><b>${esc(TK().STATUS[h.status] || h.status)}</b> <span class="flat">${esc(String(h.at).slice(0, 10))}</span></li>`).join('')}</ol>` : '<p class="flat">Not tracked yet. Add it to the Action Center to start a history of status changes and measure the result.</p>'}
        <h3>Confidence: ${esc(g.confidence.level)} (${g.confidence.score}/100)</h3>
        <ul class="why">${g.confidence.why.map(w => `<li><b class="${w.points >= 0 ? 'up' : 'down'}">${w.points > 0 ? '+' : ''}${w.points}</b> ${esc(w.text)}</li>`).join('')}</ul>
        ${g.warnings && g.warnings.length ? `<h3>Warnings</h3>${list(g.warnings)}` : ''}
      </div>
      <footer>${g.task ? `<a class="btn-primary sm" href="#tasks?id=${encodeURIComponent(g.task.id)}">Open task</a>` : '<button type="button" class="btn-primary sm" id="dr-add">Add to Action Center</button>'}
        <a class="btn-quiet" href="#opp?id=${encodeURIComponent(g.id)}">Full detail</a><a class="btn-quiet" href="#${esc(g.view)}">Open ${esc(g.typeLabel)} list</a></footer>`;
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.getElementById('dr-scrim').hidden = false;
    document.getElementById('dr-x').addEventListener('click', closeDrawer);
    const add = document.getElementById('dr-add');
    if (add) add.addEventListener('click', () => {
      const t = TK().fromOpportunity(g, D);
      if (G().upsert(D.site, t)) { g.task = t; g.status = t.status; if (redraw) redraw(); openDrawer(g, A, D, redraw); }
      else add.textContent = 'Could not save (browser storage is full or blocked)';
    });
    document.getElementById('dr-x').focus();
  }

  // ───────────── persistent Ask Clickwise dock ─────────────
  const STARTERS = ['Which pages should I optimise today?', 'Which keywords can enter Top 10?', 'Which pages are losing traffic?', 'Which pages have CTR problems?', 'What content should I create?', 'Where am I losing against competitors?'];
  let dock, thread;
  function renderAnswer(a) {
    const rows = (a.rows || []).slice(0, 6);
    return `<div class="dk-a"><h4>${esc(a.title)}</h4><p class="dk-s">${esc(a.summary)}</p>
      ${(a.evidence || []).length ? `<h5>Reasoning</h5><ul>${a.evidence.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${rows.length ? `<h5>Supporting data</h5><ol>${rows.map(r => `<li>${r.href ? `<a href="${esc(r.href)}"><b>${esc(r.label)}</b></a>` : `<b>${esc(r.label)}</b>`}${r.metric ? `<small>${esc(r.metric)}</small>` : ''}${r.action ? `<em>Next step: ${esc(r.action)}</em>` : ''}</li>`).join('')}</ol>` : ''}
      ${(a.limits || []).length ? `<p class="dk-l">${a.limits.map(esc).join(' ')}</p>` : ''}
      <p class="dk-k">${(a.links || []).map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</p>
      <small class="flat">${esc(a.source)} · ${esc(a.period)}</small></div>`;
  }
  function ask(q) {
    const S = window.CW_STATE; if (!S || !window.CW_COPILOT) return;
    q = String(q || '').trim().slice(0, 300); if (!q) return;
    const g = G(), runs = window.CW_SURFVIEW && window.CW_SURFVIEW.RUNS.get(S.D.site);
    let a = null;
    try { a = window.CW_COPILOT.answer(q, { A: S.A, D: S.D, P: g ? g.prio(S.A, S.D) : null, tasks: g ? g.tasks(S.D.site).list : [], inspections: runs ? runs.results : null }); } catch (e) { a = null; }
    thread.insertAdjacentHTML('beforeend', `<div class="dk-q">${esc(q)}</div>` + (a ? renderAnswer(a) : `<div class="dk-a"><p>That is not one of the questions Clickwise answers directly yet. The <a href="#filters?q=${encodeURIComponent(q)}">Goals builder</a> can turn it into a filter over your searches and pages.</p></div>`));
    thread.scrollTop = thread.scrollHeight;
  }
  function openDock(open) {
    dock.classList.toggle('open', open); document.getElementById('dk-fab').setAttribute('aria-expanded', String(open));
    if (open) document.getElementById('dk-in').focus();
  }
  function ensureDock() {
    if (dock) return;
    document.body.insertAdjacentHTML('beforeend', `<button type="button" class="dk-fab" id="dk-fab" aria-expanded="false" aria-controls="dock" title="Ask Clickwise (Ctrl/Cmd+K)">${ico('spark')}<span>Ask Clickwise</span></button>
      <section class="dock" id="dock" aria-label="Ask Clickwise"><header><b>${ico('spark')}Ask Clickwise</b><button type="button" class="icon-btn" id="dk-x" aria-label="Close">${ico('x')}</button></header>
        <div class="dk-thread" id="dk-thread" aria-live="polite"><p class="dk-hi">Ask about your Search Console data. Answers show the data, the reasoning, an impact estimate and the next step.</p>
          <div class="dk-chips">${STARTERS.map(s => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
        <form class="dk-form" id="dk-form" autocomplete="off"><input id="dk-in" type="text" maxlength="300" placeholder="Ask about pages, keywords, CTR, content…" aria-label="Ask Clickwise"><button class="btn-primary sm" type="submit" aria-label="Send">${ico('send')}</button></form></section>`);
    dock = document.getElementById('dock'); thread = document.getElementById('dk-thread');
    document.getElementById('dk-fab').addEventListener('click', () => openDock(!dock.classList.contains('open')));
    document.getElementById('dk-x').addEventListener('click', () => openDock(false));
    dock.addEventListener('click', e => { const c = e.target.closest('[data-q]'); if (c) ask(c.dataset.q); if (e.target.closest('.dk-a a')) { if (window.matchMedia('(max-width:860px)').matches) openDock(false); } });
    document.getElementById('dk-form').addEventListener('submit', e => { e.preventDefault(); const i = document.getElementById('dk-in'); ask(i.value); i.value = ''; });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('app').hidden) { e.preventDefault(); openDock(!dock.classList.contains('open')); }
      else if (e.key === 'Escape' && dock.classList.contains('open') && !(drawer && drawer.classList.contains('open'))) openDock(false);
    });
  }
  // ───────────── in-page tab bars: one sidebar item per area, its screens as tabs ─────────────
  const TABS = {
    opps: [['opps', 'All opportunities'], ['priorities', 'Priorities'], ['plan', 'Action plan'], ['quickwins', 'Almost page one'], ['ctr', 'Titles to rewrite'], ['cannibal', 'Competing pages'], ['decay', 'Losing ground'], ['opps-all', 'Evidence list']],
    tasks: [['tasks', 'Action board'], ['fixes', 'Fix tracker']],
    perf: [['stats', 'Trends'], ['queries', 'Queries'], ['pages', 'Pages'], ['sections', 'Site clusters']],
    analyst: [['ask', 'Ask'], ['ai', 'AI search visibility'], ['genai', 'Generative AI report'], ['intent', 'Search intent'], ['blog', 'Content intelligence']],
    auto: [['workflows', 'Workflows'], ['filters', 'Goals &amp; experiments']]
  };
  const bar = (key, here) => `<nav class="tabs" aria-label="Views in this area">${TABS[key].map(t => `<a href="#${t[0]}"${t[0] === here ? ' class="on" aria-current="page"' : ''}>${t[1]}</a>`).join('')}</nav>`;
  const wrap = (name, key, here) => { const f = V[name]; if (!f) return; V[name] = (...a) => { const o = f(...a); o.html = bar(key, here || name) + o.html; return o; }; };
  [['opps', 'opps'], ['priorities', 'opps'], ['plan', 'opps'], ['quickwins', 'opps'], ['ctr', 'opps'], ['cannibal', 'opps'], ['decay', 'opps'], ['opps-all', 'opps'], ['opp', 'opps', 'opps'],
    ['tasks', 'tasks'], ['fixes', 'tasks'], ['stats', 'perf'], ['queries', 'perf'], ['pages', 'perf'], ['sections', 'perf'], ['section', 'perf', 'sections'],
    ['ask', 'analyst'], ['ai', 'analyst'], ['genai', 'analyst'], ['intent', 'analyst'], ['blog', 'analyst'], ['workflows', 'auto'], ['wf', 'auto', 'workflows'], ['filters', 'auto']].forEach(x => wrap(x[0], x[1], x[2]));

  // called by the router after every screen renders
  window.CW_SHELL = {
    sync(name) {
      ensureDock();
      const full = name === 'ask';              // the full Ask page already is the interface
      document.getElementById('dk-fab').hidden = full;
      if (full) openDock(false);
    }
  };
})();

// Clickwise views — each returns HTML and an optional mount() for charts/tables.
(function () {
  'use strict';
  const { fmtN, expCtr } = window.CW;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pctf = (v, d = 1) => (v == null || isNaN(v)) ? '—' : v.toFixed(d) + '%';
  const posCls = p => p <= 3 ? 'p1' : p <= 10 ? 'p2' : p <= 20 ? 'p3' : 'p4';
  const posTag = p => `<span class="pos ${posCls(p)}">${p ? p.toFixed(1) : '—'}</span>`;
  const delta = (cur, prev, invert, unit) => {
    if (prev == null || !isFinite(prev) || prev === 0) return '<span class="flat">No previous period</span>';
    const d = unit === 'pt' ? cur - prev : (cur - prev) / prev * 100;
    const good = invert ? d < 0 : d > 0;
    const cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down';
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
    return `<span class="${cls}">${arrow} ${Math.abs(d).toFixed(1)}${unit === 'pt' ? ' pts' : '%'} vs previous</span>`;
  };
  const gainCell = v => v >= 1 ? `<span class="gainv">+${fmtN(v)}</span>` : '<span class="flat">—</span>';
  const urlCell = (url, path) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(path || url)}</a>`;
  const serp = q => `<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener" title="Open this search on Google" style="color:inherit;text-decoration:none">${esc(q)}</a>`;

  // ── reusable table: sort, search, paginate, export ──
  const TABLES = {};
  function table(id, cols, rows, opt = {}) {
    TABLES[id] = { cols, rows, opt, sort: opt.sort || null, dir: -1, page: 0, q: '', filter: opt.filters ? {} : null };
    const filters = (opt.filters || []).map(f => `<select data-tf="${id}" data-key="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>${f.options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>`).join('');
    return `<div class="tools">
        ${opt.search !== false ? `<input type="search" data-ts="${id}" placeholder="${esc(opt.placeholder || 'Filter rows')}" aria-label="Filter rows">` : ''}
        ${filters}
        <button class="btn-quiet" type="button" data-tx="${id}">Export CSV</button>
        <span class="meta" id="${id}-meta"></span>
      </div>
      <div class="tw"><table id="${id}"><thead><tr>${cols.map(c => `<th${c.r ? ' class="r"' : ''}${c.sort !== false ? ` data-sort="${c.k}"` : ''} scope="col">${esc(c.l)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="pager" id="${id}-pager"></div>`;
  }
  function tableRows(id) {
    const t = TABLES[id];
    let rows = t.rows;
    if (t.q) { const q = t.q.toLowerCase(); const keys = t.opt.searchKeys || [t.cols[0].k]; rows = rows.filter(r => keys.some(k => String(r[k] || '').toLowerCase().includes(q))); }
    if (t.filter) Object.entries(t.filter).forEach(([k, v]) => { if (v) { const f = t.opt.filters.find(x => x.key === k); rows = rows.filter(r => f.test(r, v)); } });
    if (t.sort) { const k = t.sort, d = t.dir; rows = rows.slice().sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0)) * d; }); }
    return rows;
  }
  function drawTable(id) {
    const t = TABLES[id]; if (!t) return;
    const el = document.getElementById(id); if (!el) return;
    const rows = tableRows(id);
    const size = t.opt.pageSize || 50;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    t.page = Math.min(t.page, pages - 1);
    const slice = rows.slice(t.page * size, t.page * size + size);
    el.querySelector('tbody').innerHTML = slice.length
      ? slice.map(r => `<tr>${t.cols.map(c => `<td class="${c.cls || ''}${c.r ? ' r' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>${t.opt.sub ? t.opt.sub(r) : ''}`).join('')
      : `<tr><td colspan="${t.cols.length}" class="empty">${esc(t.opt.empty || 'Nothing matches these filters.')}</td></tr>`;
    el.querySelectorAll('th[data-sort]').forEach(th => th.setAttribute('aria-sort', th.dataset.sort === t.sort ? (t.dir < 0 ? 'descending' : 'ascending') : 'none'));
    const meta = document.getElementById(id + '-meta'); if (meta) meta.textContent = `${rows.length.toLocaleString('en-US')} row${rows.length === 1 ? '' : 's'}`;
    const pager = document.getElementById(id + '-pager');
    if (pager) pager.innerHTML = pages > 1 ? `<button type="button" data-tp="${id}" data-d="-1" ${t.page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${t.page + 1} of ${pages}</span><button type="button" data-tp="${id}" data-d="1" ${t.page >= pages - 1 ? 'disabled' : ''}>Next</button>` : '';
  }
  function exportTable(id) {
    const t = TABLES[id]; const rows = tableRows(id);
    const cols = t.cols.filter(c => c.csv !== false);
    const val = (c, r) => c.csv ? c.csv(r) : r[c.k];
    const csv = [cols.map(c => c.l)].concat(rows.map(r => cols.map(c => val(c, r)))).map(a => a.map(v => '"' + String(v == null ? '' : (typeof v === 'number' ? +v.toFixed(2) : v)).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = (t.opt.file || id) + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  document.addEventListener('input', e => { const id = e.target.dataset.ts; if (id && TABLES[id]) { TABLES[id].q = e.target.value; TABLES[id].page = 0; drawTable(id); } });
  document.addEventListener('change', e => { const id = e.target.dataset.tf; if (id && TABLES[id]) { TABLES[id].filter[e.target.dataset.key] = e.target.value; TABLES[id].page = 0; drawTable(id); } });
  document.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const id = th.closest('table').id, t = TABLES[id]; if (t) { if (t.sort === th.dataset.sort) t.dir *= -1; else { t.sort = th.dataset.sort; t.dir = -1; } drawTable(id); } return; }
    const tp = e.target.closest('[data-tp]'); if (tp) { const t = TABLES[tp.dataset.tp]; t.page += +tp.dataset.d; drawTable(tp.dataset.tp); return; }
    const tx = e.target.closest('[data-tx]'); if (tx) exportTable(tx.dataset.tx);
  });

  // common column sets
  const C = {
    q: { k: 'q', l: 'Query', cls: 'q', f: r => serp(r.q) },
    page: { k: 'path', l: 'Page', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p },
    clicks: { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) },
    impr: { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) },
    ctr: { k: 'ctr', l: 'CTR', r: 1, f: r => pctf(r.ctr) },
    pos: { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) },
    gain: { k: 'gain', l: 'Clicks to gain', r: 1, f: r => gainCell(r.gain) },
    bench: { k: 'bench', l: 'Expected CTR', r: 1, f: r => pctf(r.bench) }
  };

  // ── chart helpers ──
  const CHARTS = [];
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function destroyCharts() { while (CHARTS.length) { try { CHARTS.pop().destroy(); } catch (e) { } } }
  function chart(id, cfg) {
    const el = document.getElementById(id); if (!el || !window.Chart) return;
    Chart.defaults.font.family = cssVar('--body') || 'system-ui';
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--line-soft');
    CHARTS.push(new Chart(el, cfg));
  }

  // ── section header ──
  const head = (title, sub) => `<header class="v-head"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
  const stat = (v, l, cls) => `<div class="stat ${cls || ''}"><b>${v}</b><span>${esc(l)}</span></div>`;
  const ledger = (items, limit) => items.length ? `<ol class="ledger">${items.slice(0, limit || items.length).map(a => `
      <li><span class="rank" aria-hidden="true"></span>
        <div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><a class="go" href="#${a.view}">Open the list</a></div>
        <div class="gain">${a.gain ? `<b>+${fmtN(a.gain)}</b><small>clicks / month</small>` : '<b style="color:var(--muted)">Growth</b><small>longer term</small>'}<br><span class="tag">${esc(a.effort)} effort</span></div>
      </li>`).join('')}</ol>` : '<p class="empty">No clear actions found. That usually means the date range is short or traffic is very low. Try a longer range.</p>';

  // ════════════════ VIEWS ════════════════
  const V = {};

  V.overview = (A, D) => {
    const nb = A.totNB, p = A.prev;
    const brandShare = A.totAll.clicks ? A.totB.clicks / A.totAll.clicks * 100 : 0;
    const html = `
      <h1 class="hero-statement">${esc(D.site)} could gain about <span class="big num">${fmtN(A.potentialMonthly)}</span> more clicks a month from searches it already ranks for.</h1>
      <p class="hero-sub">That estimate comes from ${A.quickWins.length.toLocaleString()} queries sitting on positions 4–20 and ${A.ctrQueries.length.toLocaleString()} page-one queries with below-benchmark CTR. It excludes branded searches, which made up ${brandShare.toFixed(0)}% of query clicks.</p>

      <section class="kpis" aria-label="Non-branded performance">
        <div class="kpi"><div class="kpi-l">Non-branded clicks</div><div class="kpi-v">${fmtN(nb.clicks)}</div><div class="kpi-d">${delta(nb.clicks, p && p.nb.clicks)}</div></div>
        <div class="kpi"><div class="kpi-l">Impressions</div><div class="kpi-v">${fmtN(nb.impr)}</div><div class="kpi-d">${delta(nb.impr, p && p.nb.impr)}</div></div>
        <div class="kpi"><div class="kpi-l">CTR</div><div class="kpi-v">${pctf(nb.ctr, 2)}</div><div class="kpi-d">${delta(nb.ctr, p && p.nb.ctr, false, 'pt')}</div></div>
        <div class="kpi"><div class="kpi-l">Average position</div><div class="kpi-v">${nb.pos.toFixed(1)}</div><div class="kpi-d">${delta(nb.pos, p && p.nb.pos, true)}</div></div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Do these first</h2><a href="#plan">Full action plan</a><p>Ranked by estimated clicks per month. Each links to the exact queries or pages.</p></div>
        ${ledger(A.plan, 3)}
      </section>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-h"><h2>Daily clicks and impressions</h2><p>All searches, including branded.</p></div>
          <div class="panel-b">${D.C && D.C.length ? '<div class="chart-box"><canvas id="ch-trend" aria-label="Daily clicks and impressions"></canvas></div>' : '<p class="empty">This export has no date data. Connect Search Console or include the Dates sheet.</p>'}</div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>Where clicks come from</h2></div>
          <div class="panel-b">
            <div class="chart-box sm"><canvas id="ch-split" aria-label="Branded versus non-branded clicks"></canvas></div>
            ${D.Dev && D.Dev.length ? `<table style="margin-top:12px"><tbody>${D.Dev.map(d => `<tr><td>${esc(d.d.charAt(0) + d.d.slice(1).toLowerCase())}</td><td class="r">${fmtN(d.clicks)} clicks</td><td class="r">${pctf(d.ctr)} CTR</td></tr>`).join('')}</tbody></table>` : ''}
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-h"><h2>Site sections by clicks</h2><a href="#sections">All sections</a></div>
        <div class="panel-b flush">${sectionBars(A.sections1.slice(0, 8))}</div>
      </section>`;
    const mount = () => {
      if (D.C && D.C.length) {
        const c = D.C.slice().sort((a, b) => a.d.localeCompare(b.d));
        chart('ch-trend', { type: 'line', data: { labels: c.map(r => r.d.slice(5)), datasets: [
          { label: 'Clicks', data: c.map(r => r.clicks), borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal'), tension: .3, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
          { label: 'Impressions', data: c.map(r => r.impr), borderColor: cssVar('--sky'), backgroundColor: cssVar('--sky'), tension: .3, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3], yAxisID: 'y1' }
        ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { position: 'left', ticks: { callback: v => fmtN(v) } }, y1: { position: 'right', grid: { display: false }, ticks: { callback: v => fmtN(v) } } } } });
      }
      chart('ch-split', { type: 'doughnut', data: { labels: ['Non-branded', 'Branded'], datasets: [{ data: [A.totNB.clicks, A.totB.clicks], backgroundColor: [cssVar('--signal'), cssVar('--watch')], borderColor: cssVar('--surface'), borderWidth: 2 }] }, options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: x => ` ${x.label}: ${fmtN(x.raw)} clicks` } } } } });
    };
    return { html, mount };
  };

  function sectionBars(list) {
    if (!list.length) return '<p class="empty">No pages found.</p>';
    const max = Math.max(...list.map(s => s.clicks), 1);
    return `<div class="bars" role="table" aria-label="Site sections">
      <div class="bar-row bar-head" role="row"><span role="columnheader">Section</span><span class="hide-sm"></span><span class="r" role="columnheader">Clicks</span><span class="r hide-sm" role="columnheader">CTR</span><span class="r" role="columnheader">Pages</span></div>
      ${list.map(s => `<div class="bar-row" role="row"><span class="lbl" role="cell" title="${esc(s.key)}">${esc(s.key)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="display:block;width:${(s.clicks / max * 100).toFixed(1)}%"></span></span><span class="r" role="cell">${fmtN(s.clicks)}</span><span class="r hide-sm" role="cell">${pctf(s.ctr)}</span><span class="r" role="cell">${s.n}</span></div>`).join('')}
    </div>`;
  }

  V.plan = (A) => ({ html: head('Action plan', 'Every recommendation, ranked by the clicks it could add each month. Gains assume you reach the typical CTR for the target position; treat them as a guide to priority, not a forecast.') +
    `<section class="panel">${ledger(A.plan)}</section>
     <div class="note"><b>How estimates work.</b> Clickwise compares each query's CTR with a benchmark curve for its position (about 28% at #1, 11% at #3, 2.4% at #10). The gap, times impressions, is the opportunity. Branded searches are left out.</div>` });

  V.quickwins = (A) => {
    const rows = A.quickWins;
    const html = head('Almost page one', 'Non-branded queries ranking 4–20 with real demand. Moving them into the top 3 (or top 7 from page two) is usually the fastest SEO gain.') +
      `<div class="strip">${stat(rows.length.toLocaleString(), 'queries in striking distance', 'gain')}${stat('+' + fmtN(A.perMonth(rows.reduce((s, r) => s + r.gain, 0))), 'clicks a month if they reach target', 'gain')}${stat(rows.filter(r => r.pos > 10).length.toLocaleString(), 'stuck on page two', 'watch')}</div>
      <section class="panel">${table('t-qw', [C.q, C.impr, C.clicks, C.ctr, C.pos, { k: 'target', l: 'Target', r: 1, f: r => '#' + r.target }, C.gain], rows, { sort: 'gain', file: 'almost-page-one', placeholder: 'Filter queries',
        filters: [{ key: 'band', label: 'Position', options: [['a', '4–10'], ['b', '11–20']], test: (r, v) => v === 'a' ? r.pos <= 10 : r.pos > 10 }],
        empty: 'No queries between positions 4 and 20 with enough impressions.' })}</section>
      <div class="note"><b>How to move them.</b> Link to the ranking page from your strongest pages using the query as anchor text, answer the query in a heading near the top, and make sure the title contains the exact phrase.</div>`;
    return { html, mount: () => drawTable('t-qw') };
  };

  V.ctr = (A) => {
    const hasTop = A.ctrPages.some(r => r.top && r.top.length);
    const pcols = [C.page, C.impr, C.clicks, C.ctr, C.bench, C.pos, C.gain];
    const html = head('Titles to rewrite', 'Pages and queries on page one that get far fewer clicks than their position should earn. Better titles and descriptions fix most of these without any ranking change.') +
      `<div class="strip">${stat(A.ctrPages.length.toLocaleString(), 'pages under 60% of benchmark CTR', 'risk')}${stat('+' + fmtN(A.perMonth(A.ctrPages.reduce((s, r) => s + r.gain, 0))), 'clicks a month at 85% of benchmark', 'gain')}${stat(A.ctrQueries.length.toLocaleString(), 'queries under half of benchmark', 'watch')}</div>
      <section class="panel"><div class="panel-h"><h2>Pages</h2><p>${hasTop ? 'Under each page: the searches it gets most impressions for. Write the title for those.' : 'Connect Search Console to see which searches each page is shown for.'}</p></div>
      ${table('t-ctrp', pcols, A.ctrPages, { sort: 'gain', file: 'titles-to-rewrite-pages', searchKeys: ['path'], placeholder: 'Filter pages',
        sub: r => r.top && r.top.length ? `<tr class="sub"><td colspan="7">Top searches: ${r.top.map(q => `<span class="tag">${esc(q)}</span>`).join(' ')}</td></tr>` : '',
        empty: 'Every page-one page is close to benchmark CTR.' })}</section>
      <section class="panel"><div class="panel-h"><h2>Queries</h2><p>If CTR is low at position 1–3, check the results page: an AI Overview, map pack or ads may be taking the clicks, not your title.</p></div>
      ${table('t-ctrq', [C.q, C.impr, C.clicks, C.ctr, C.bench, C.pos, C.gain], A.ctrQueries, { sort: 'gain', file: 'titles-to-rewrite-queries', placeholder: 'Filter queries' })}</section>`;
    return { html, mount: () => { drawTable('t-ctrp'); drawTable('t-ctrq'); } };
  };

  V.cannibal = (A) => {
    const exact = A.cannibalMode === 'exact';
    const rows = A.cannibal;
    const sevTag = s => `<span class="tag ${s === 'high' ? 'risk' : s === 'medium' ? 'watch' : ''}">${s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'}</span>`;
    const cols = exact
      ? [C.q, { k: 'pagesN', l: 'Pages', r: 1, f: r => r.pages.length, csv: r => r.pages.map(p => p.p).join(' | ') }, C.impr, C.clicks, C.ctr, C.pos, { k: 'loss', l: 'Clicks lost', r: 1, f: r => r.loss >= 1 ? `<span class="lossv">−${fmtN(r.loss)}</span>` : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }]
      : [{ k: 'q', l: 'Keyword group', cls: 'q' }, { k: 'n', l: 'Variants', r: 1 }, C.impr, C.clicks, C.ctr, { k: 'spread', l: 'Position spread', r: 1, f: r => r.spread.toFixed(1) }, { k: 'loss', l: 'Clicks lost', r: 1, f: r => r.loss >= 1 ? `<span class="lossv">−${fmtN(r.loss)}</span>` : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }];
    rows.forEach(r => { r.pagesN = r.pages ? r.pages.length : 0; r.sevN = { high: 3, medium: 2, low: 1 }[r.sev]; });
    const sub = exact
      ? r => `<tr class="sub"><td colspan="8">${r.pages.map(p => `<div>${urlCell(p.p, window.CW.pathOf(p.p))} — ${p.share.toFixed(0)}% of impressions, position ${p.pos.toFixed(1)}, ${fmtN(p.clicks)} clicks</div>`).join('')}</td></tr>`
      : r => `<tr class="sub"><td colspan="8">${r.variants.slice(0, 6).map(v => `<span class="tag">${esc(v.q)} · #${v.pos.toFixed(1)}</span>`).join(' ')}</td></tr>`;
    const html = head('Competing pages', exact
      ? 'Searches where two or more of your own URLs each take at least 10% of impressions. Google can only rank one well, so the others dilute it.'
      : 'Groups of similar searches with very different positions. This is a likely sign of competing pages; connect Search Console for exact page-level matches.') +
      (exact ? '' : '<div class="note"><b>Estimated mode.</b> File exports do not include which page ranks for which query. Connecting Search Console unlocks exact competing-page detection.</div>') +
      `<div class="strip">${stat(rows.filter(r => r.sev === 'high').length, 'high severity', 'risk')}${stat(rows.filter(r => r.sev === 'medium').length, 'medium severity', 'watch')}${stat('−' + fmtN(A.perMonth(rows.reduce((s, r) => s + r.loss, 0))), 'clicks a month lost to the split', 'risk')}</div>
      <section class="panel">${table('t-can', cols, rows, { sort: 'sevN', file: 'competing-pages', pageSize: 25, sub, empty: 'No competing pages found.' })}</section>
      <div class="note"><b>Fixing it.</b> Choose the page that best matches the intent. Then merge the weaker page into it with a 301, or rewrite the weaker page to target a different angle, and update internal links to point to the winner.</div>`;
    return { html, mount: () => drawTable('t-can') };
  };

  V.decay = (A, D) => {
    const dc = A.decay;
    if (!dc) {
      const t = A.trend;
      return { html: head('Losing ground', 'Pages and queries that lost clicks compared with the previous period.') +
        `<div class="note"><b>Needs a comparison period.</b> Connect Search Console and keep “Compare with the previous period” ticked to see which pages are decaying.</div>` +
        (t ? `<section class="panel"><div class="panel-h"><h2>First half vs second half of this range</h2></div><div class="panel-b"><div class="strip">${stat((t.clicks >= 0 ? '▲ ' : '▼ ') + Math.abs(t.clicks).toFixed(1) + '%', 'clicks', t.clicks >= 0 ? 'gain' : 'risk')}${stat((t.impr >= 0 ? '▲ ' : '▼ ') + Math.abs(t.impr).toFixed(1) + '%', 'impressions', t.impr >= 0 ? 'gain' : 'risk')}${stat((t.ctr >= 0 ? '▲ ' : '▼ ') + Math.abs(t.ctr).toFixed(2) + ' pts', 'CTR', t.ctr >= 0 ? 'gain' : 'risk')}</div></div></section>` : '') };
    }
    const pcols = [C.page, { k: 'prevC', l: 'Clicks before', r: 1, f: r => fmtN(r.prev.clicks), csv: r => r.prev.clicks }, { k: 'curC', l: 'Clicks now', r: 1, f: r => fmtN(r.cur.clicks), csv: r => r.cur.clicks }, { k: 'ch', l: 'Change', r: 1, f: r => `<span class="lossv">${r.ch.toFixed(0)}%</span>` }, { k: 'reason', l: 'Likely cause', sort: false }];
    dc.pages.forEach(r => { r.prevC = r.prev.clicks; r.curC = r.cur.clicks; });
    dc.queries.forEach(r => { r.prevC = r.prev.clicks; r.curC = r.cur.clicks; });
    dc.rising.forEach(r => { r.curC = r.cur.clicks; r.prevC = r.prev ? r.prev.clicks : 0; });
    const html = head('Losing ground', `Compared with ${esc(D.prevStart || 'the previous period')}${D.prevEnd ? ' – ' + esc(D.prevEnd) : ''}. Pages that lost at least a quarter of their clicks, with the most likely cause.`) +
      `<div class="strip">${stat(dc.pages.length, 'pages losing clicks', 'risk')}${stat('−' + fmtN(dc.lost), 'clicks lost across those pages', 'risk')}${stat(dc.rising.length, 'pages gaining', 'gain')}</div>
      <section class="panel"><div class="panel-h"><h2>Pages losing clicks</h2></div>${table('t-dp', pcols, dc.pages, { sort: 'lost', file: 'losing-ground-pages', searchKeys: ['path'], empty: 'No page lost more than 25% of its clicks.' })}</section>
      <section class="panel"><div class="panel-h"><h2>Queries losing clicks</h2></div>${table('t-dq', [C.q, pcols[1], pcols[2], pcols[3], pcols[4]], dc.queries, { sort: 'lost', file: 'losing-ground-queries' })}</section>
      <section class="panel"><div class="panel-h"><h2>Pages gaining</h2><p>Worth studying: what changed here can often be copied to the decaying pages.</p></div>${table('t-dr', [C.page, pcols[1], pcols[2], { k: 'won', l: 'Clicks won', r: 1, f: r => gainCell(r.won) }], dc.rising, { sort: 'won', file: 'gaining-pages', searchKeys: ['path'] })}</section>`;
    return { html, mount: () => { drawTable('t-dp'); drawTable('t-dq'); drawTable('t-dr'); } };
  };

  V.ai = (A) => {
    const ai = A.ai;
    const groups = [
      { id: 'ov', title: 'Likely answered by AI Overviews', desc: 'Top-5 rankings with CTR under a third of benchmark. Something on the results page is answering the query before the click.', rows: ai.overview, tip: 'Open a few in Google. If an AI Overview appears, make sure your page is cited: lead with a short direct answer, use clear headings that mirror the question, and add original data the overview cannot summarise.', gain: true },
      { id: 'qs', title: 'Question searches', desc: 'The format AI answers and People Also Ask boxes draw from.', rows: ai.questions, tip: 'Answer each question in 40–60 words directly under a heading phrased as the question. Group related questions into an FAQ section with FAQPage markup.' },
      { id: 'cv', title: 'Conversational searches (7+ words)', desc: 'Long, natural-language searches — the way people prompt ChatGPT, Perplexity and Gemini.', rows: ai.conversational, tip: 'These show the follow-up questions your audience has. Cover them as sections of a pillar page rather than separate thin pages.' },
      { id: 'cp', title: 'Comparisons and alternatives', desc: 'Searches weighing two options. AI engines love citing structured comparison tables.', rows: ai.compare, tip: 'Give each comparison a table with clear criteria, a verdict, and who each option suits.' },
      { id: 'fr', title: 'Freshness-sensitive searches', desc: 'Queries with a year or words like “latest”. AI engines prefer recently updated sources.', rows: ai.fresh, tip: 'Show a visible “Updated on” date, refresh numbers each year, and include the year in the title where it fits.' },
      { id: 'sn', title: 'Holding position one', desc: 'Queries where you already rank first. These are your most likely AI citations — protect them.', rows: ai.snippets, tip: 'Keep these pages updated and fast. Add Organization and author markup so engines can attribute the answer to you.' }
    ];
    const cols = g => g.gain ? [C.q, C.impr, C.clicks, C.ctr, C.pos, C.gain] : [C.q, C.impr, C.clicks, C.ctr, C.pos];
    const html = head('AEO & GEO signals', 'How your Search Console data reflects AI search: where answers are being taken from you, and which queries are shaped like prompts.') +
      `<div class="strip">${stat(A.readiness + '/100', 'AI search readiness', A.readiness >= 60 ? 'gain' : A.readiness >= 35 ? 'watch' : 'risk')}${stat(ai.overview.length, 'top-5 queries losing clicks to answers', 'risk')}${stat(ai.questions.length.toLocaleString(), 'question searches')}${stat(ai.conversational.length.toLocaleString(), 'conversational searches')}</div>
      <section class="panel">${groups.map(g => `
        <details class="acc" ${g.id === 'ov' ? 'open' : ''}>
          <summary><div><h3>${esc(g.title)}</h3><p>${esc(g.desc)}</p></div><div class="n">${g.rows.length.toLocaleString()}<small>${fmtN(g.rows.reduce((s, r) => s + r.impr, 0))} impr.</small></div></summary>
          <div class="acc-tip">${esc(g.tip)}</div>
          ${table('t-ai-' + g.id, cols(g), g.rows, { sort: g.gain ? 'gain' : 'impr', file: 'ai-' + g.id, pageSize: 25 })}
        </details>`).join('')}</section>
      <div class="note"><b>About the readiness score.</b> It blends how many of your question searches rank top 5, how much of your demand is question- or prompt-shaped, whether you hold position one anywhere, and how many top rankings are losing clicks to on-page answers. It's a directional measure from Search Console data only.</div>`;
    return { html, mount: () => groups.forEach(g => drawTable('t-ai-' + g.id)) };
  };

  V.queries = (A) => {
    const html = head('Queries', `${A.Q.length.toLocaleString()} searches that showed your site. Sort any column, filter, and export.`) +
      `<section class="panel">${table('t-q', [C.q, C.clicks, C.impr, C.ctr, C.pos, { k: 'intent', l: 'Intent', f: r => `<span class="tag">${esc(window.CW.INTENT_LABEL[r.intent])}</span>`, csv: r => window.CW.INTENT_LABEL[r.intent] }], A.Q, { sort: 'clicks', file: 'queries', placeholder: 'Filter queries',
        filters: [
          { key: 'brand', label: 'Brand', options: [['nb', 'Non-branded'], ['b', 'Branded']], test: (r, v) => v === 'b' ? r.brand : !r.brand },
          { key: 'intent', label: 'Intent', options: Object.entries(window.CW.INTENT_LABEL), test: (r, v) => r.intent === v },
          { key: 'pos', label: 'Position', options: [['1', '1–3'], ['2', '4–10'], ['3', '11–20'], ['4', '21+']], test: (r, v) => v === '1' ? r.pos <= 3 : v === '2' ? r.pos > 3 && r.pos <= 10 : v === '3' ? r.pos > 10 && r.pos <= 20 : r.pos > 20 },
          { key: 'len', label: 'Length', options: [['s', '1–2 words'], ['m', '3–6 words'], ['l', '7+ words']], test: (r, v) => v === 's' ? r.words <= 2 : v === 'm' ? r.words > 2 && r.words < 7 : r.words >= 7 }
        ] })}</section>`;
    return { html, mount: () => drawTable('t-q') };
  };

  V.pages = (A) => {
    const html = head('Pages', 'Pages grouped by how much they carry, relative to the rest of your site.') +
      `<div class="strip">${A.tiers.map(t => stat(t.n.toLocaleString(), t.label, t.key === 'carry' ? 'gain' : t.key === 'ghost' ? 'risk' : '')).join('')}</div>
      <section class="panel">${A.tiers.map((t, i) => `
        <details class="acc" ${i === 0 ? 'open' : ''}>
          <summary><div><h3>${esc(t.label)}</h3><p>${esc(t.desc)}</p></div><div class="n">${fmtN(t.clicks)}<small>clicks · ${t.n} pages</small></div></summary>
          ${table('t-pg-' + t.key, [C.page, C.clicks, C.impr, C.ctr, C.pos], t.rows, { sort: t.key === 'ghost' ? 'impr' : 'clicks', file: 'pages-' + t.key, searchKeys: ['path'], pageSize: 25, placeholder: 'Filter pages' })}
        </details>`).join('')}</section>`;
    return { html, mount: () => A.tiers.forEach(t => drawTable('t-pg-' + t.key)) };
  };

  V.sections = (A) => {
    const list2 = A.sections2;
    const html = head('Site sections', 'Your URLs grouped by folder, built automatically from your site structure. Position is weighted by impressions.') +
      `<section class="panel"><div class="panel-h"><h2>Top-level folders</h2></div><div class="panel-b flush">${sectionBars(A.sections1)}</div></section>
       <section class="panel"><div class="panel-h"><h2>Second-level folders</h2><p>Finer breakdown, useful for large sections like /blog/ or /products/.</p></div>
       ${table('t-sec', [{ k: 'key', l: 'Section', cls: 'u' }, { k: 'n', l: 'Pages', r: 1 }, C.clicks, C.impr, C.ctr, C.pos], list2, { sort: 'clicks', file: 'sections', placeholder: 'Filter sections' })}</section>`;
    return { html, mount: () => drawTable('t-sec') };
  };

  V.intent = (A) => {
    const list = A.intents.filter(i => i.n);
    const html = head('Search intent', 'Every query sorted by what the searcher wants: to learn, to compare, to act, or to find you.') +
      `<div class="grid-2"><section class="panel"><div class="panel-h"><h2>Clicks by intent</h2></div><div class="panel-b"><div class="chart-box"><canvas id="ch-intent" aria-label="Clicks and impressions by intent"></canvas></div></div></section>
       <section class="panel"><div class="panel-h"><h2>Summary</h2></div><div class="panel-b flush"><table><thead><tr><th>Intent</th><th class="r">Queries</th><th class="r">CTR</th><th class="r">Position</th></tr></thead><tbody>${list.map(i => `<tr><td>${esc(i.label)}</td><td class="r">${i.n.toLocaleString()}</td><td class="r">${pctf(i.ctr)}</td><td class="r">${posTag(i.pos)}</td></tr>`).join('')}</tbody></table></div></section></div>
       <section class="panel">${list.map((i, k) => `
        <details class="acc" ${k === 0 ? 'open' : ''}><summary><div><h3>${esc(i.label)}</h3><p>${esc(INTENT_HELP[i.key])}</p></div><div class="n">${fmtN(i.clicks)}<small>clicks · ${i.n} queries</small></div></summary>
        ${table('t-in-' + i.key, [C.q, C.clicks, C.impr, C.ctr, C.pos], i.rows, { sort: 'impr', file: 'intent-' + i.key, pageSize: 25 })}</details>`).join('')}</section>`;
    const mount = () => {
      list.forEach(i => drawTable('t-in-' + i.key));
      chart('ch-intent', { type: 'bar', data: { labels: list.map(i => i.label), datasets: [{ label: 'Clicks', data: list.map(i => i.clicks), backgroundColor: cssVar('--signal'), borderRadius: 4 }, { label: 'Impressions ÷ 10', data: list.map(i => i.impr / 10), backgroundColor: cssVar('--sky-soft'), borderColor: cssVar('--sky'), borderWidth: 1, borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmtN(v) } } } } });
    };
    return { html, mount };
  };
  const INTENT_HELP = { info: 'Learning: questions, guides, how-tos. Build depth and answer directly.', comm: 'Comparing options: best, top, reviews, vs. Lists and comparison pages win here.', trans: 'Ready to act: price, buy, book, download. Send these to pages with a clear next step.', nav: 'Looking for you by name. Track as brand demand, not SEO performance.', other: 'No clear signal. Often short head terms; check what the ranking page offers.' };

  V.regex = (A) => {
    const lib = window.CW.regexLibrary(A.brandRx);
    const html = head('Regex library', 'Ready-made filters for Search Console. In Performance, add a Query or Page filter, choose “Custom (regex)”, and paste. Counts show how many rows match in this analysis.') +
      `<div class="rx-list">${lib.map((x, i) => {
        const n = x.rxNote ? null : window.CW.countRegex(x.rx, x.use === 'Page' ? A.P : A.Q, x.use === 'Page' ? 'p' : 'q');
        return `<article class="rx"><h3>${esc(x.title)}</h3><div class="rx-n">${n == null ? '' : `<b>${n.toLocaleString()}</b>matching ${x.use === 'Page' ? 'pages' : 'queries'}`}</div><p>${esc(x.why)}</p><code id="rx-${i}">${esc(x.rx)}</code><div class="rx-actions"><span class="tag">${x.use} filter</span><button class="btn-quiet" type="button" data-copy="rx-${i}">Copy regex</button></div></article>`;
      }).join('')}</div>`;
    return { html };
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const t = document.getElementById(b.dataset.copy).textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy regex', 1500); }).catch(() => { b.textContent = 'Select and copy manually'; });
  });

  window.CW_VIEWS = { V, destroyCharts, esc };
})();

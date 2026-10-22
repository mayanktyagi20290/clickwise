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
  // Estimates are clicks per month as a low–high range; flags explain when a number deserves less trust.
  const range = (lo, hi) => !(hi >= 1) ? '—' : lo >= 1 && fmtN(lo) !== fmtN(hi) ? `+${fmtN(lo)}–${fmtN(hi)}` : lo >= 1 ? `+${fmtN(hi)}` : `up to +${fmtN(hi)}`;
  const gainCell = r => {
    if (typeof r === 'number') return r >= 1 ? `<span class="gainv">+${fmtN(r)}</span>` : '<span class="flat">—</span>';
    const lo = r.gainLo != null ? r.gainLo : r.gain, hi = r.gainHi != null ? r.gainHi : r.gain;
    const flags = (r.serp ? '<span class="tag watch" title="CTR far below this site\'s usual CTR at this position: an answer box, AI Overview or intent mismatch may be taking the click, so a title rewrite may not help">results-page feature?</span>' : '') +
      (r.capped ? '<span class="tag" title="This row was unusually large, so it was capped at 10% of the list total">capped</span>' : '');
    return hi >= 1 ? `<span class="gainv">${range(lo, hi)}</span>${flags ? '<br>' + flags : ''}` : '<span class="flat">—</span>';
  };
  // only http(s) URLs become links; anything else (e.g. javascript: from a crafted file) is shown as text
  const safeHref = u => /^https?:\/\//i.test(String(u || '')) ? esc(u) : null;
  const urlCell = (url, path) => safeHref(url) ? `<a href="${safeHref(url)}" target="_blank" rel="noopener">${esc(path || url)}</a>` : esc(path || url);
  const serp = q => `<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener" title="Open this search on Google" style="color:inherit;text-decoration:none">${esc(q)}</a>`;

  // ── reusable table: sort, search, paginate, export ──
  const TABLES = {};
  function table(id, cols, rows, opt = {}) {
    TABLES[id] = { cols, rows, opt, sort: opt.sort || null, dir: opt.dir === 1 ? 1 : -1, page: 0, q: '', filter: opt.filters ? {} : null };
    const filters = (opt.filters || []).map(f => `<select data-tf="${id}" data-key="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>${f.options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>`).join('');
    return `<div class="tools">
        ${opt.search !== false ? `<input type="search" data-ts="${id}" placeholder="${esc(opt.placeholder || 'Filter rows')}" aria-label="Filter rows">` : ''}
        ${filters}
        ${opt.exportable !== false ? `<button class="btn-quiet" type="button" data-tx="${id}">Export CSV</button>` : ''}
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
    // search queries are written by strangers: neutralise cells that spreadsheets would run as formulas
    const cell = v => { let s2 = String(v == null ? '' : (typeof v === 'number' ? +v.toFixed(2) : v)); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s2)) s2 = "'" + s2; return '"' + s2.replace(/"/g, '""') + '"'; };
    const csv = '\ufeff' + [cols.map(c => c.l)].concat(rows.map(r => cols.map(c => val(c, r)))).map(a => a.map(cell).join(',')).join('\n');
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
    gain: { k: 'gain', l: 'Clicks / month (est.)', r: 1, f: r => gainCell(r), csv: r => `${Math.round(r.gainLo || 0)}–${Math.round(r.gainHi || r.gain || 0)}` },
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
    const c = new Chart(el, cfg); CHARTS.push(c); return c;
  }

  // ── section header ──
  const head = (title, sub) => `<header class="v-head"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
  const stat = (v, l, cls) => `<div class="stat ${cls || ''}"><b>${v}</b><span>${esc(l)}</span></div>`;
  const ledger = (items, limit) => items.length ? `<ol class="ledger">${items.slice(0, limit || items.length).map(a => `
      <li><span class="rank" aria-hidden="true"></span>
        <div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><a class="go" href="#${a.view}">Open the list</a></div>
        <div class="gain">${a.gainHi >= 1 ? `<b>${range(a.gain, a.gainHi)}</b><small>clicks / month (est.)</small>` : '<b style="color:var(--muted)">Growth</b><small>longer term</small>'}<br><span class="tag">${esc(a.effort)} effort</span></div>
      </li>`).join('')}</ol>` : '<p class="empty">No clear actions found. That usually means the date range is short or traffic is very low. Try a longer range.</p>';

  // How every estimate was made, in plain words.
  function methodNote(A) {
    const m = A.method, own = A.curve.points.filter(p => p.source.startsWith('site')).map(p => p.pos);
    const period = m.start && m.end ? `${m.days} days (${m.start} to ${m.end})` : `an assumed ${m.days} days (the export has no dates)`;
    return `<div class="note method"><b>How these estimates work.</b> Observed over ${esc(period)}, converted to clicks per month. Expected CTR at each position is this site's own CTR (weighted by impressions) where it has at least ${m.minObs} non-branded queries and 10 clicks${own.length ? ` (positions ${own.join(', ')})` : ' (none here)'}, and an industry benchmark elsewhere. Each search keeps its own click rate relative to its position, so searches that lose clicks to answer boxes are not projected to a full top-3 CTR. The low figure assumes a smaller move (${m.lowTargetStep} positions up, or 60% of expected CTR); the high figure assumes reaching the target. No single search may contribute more than ${Math.round(m.capShare * 100)}% of a list. These are estimates for prioritising, not forecasts.</div>`;
  }

  // ════════════════ VIEWS ════════════════
  const V = {};

  const ICON = {
    clicks: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/>',
    spark: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    scale: '<path d="M16 16l3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1zM2 16l3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    ghost: '<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  // Collapsible card header: coloured icon, title, description, count pill, chevron
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const accHead = (icon, tone, title, desc, pill, pillTone) => `<summary><span class="ico ${tone}">${svg(icon)}</span><div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div><span class="pill ${pillTone || tone}">${esc(pill)}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true">${ICON.chev}</svg></summary>`;
  function tileDelta(cur, prev, invert, unit) {
    if (prev == null || !isFinite(prev) || prev === 0) return '';
    const d = unit === 'pt' ? cur - prev : (cur - prev) / prev * 100;
    const good = invert ? d < 0 : d > 0;
    return `<span class="tile-d ${d === 0 ? '' : good ? 'up' : 'down'}" title="${good ? 'Improved' : 'Worse'} vs previous period">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1)}${unit === 'pt' ? ' pts' : '%'} vs previous</span>`;
  }
  const KPI_ICON = {
    clicks: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    impr: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ctr: '<path d="M9 9l11 4-5 2-2 5z"/><path d="M5 3v3M3 5h3M4.5 9.5l-1.4 1.4M10 4.5l1.4-1.4"/>',
    pos: '<path d="M4 20V14M10 20V9M16 20V4M22 20H2"/>'
  };
  const tile = (cls, ico, label, value, sub, delta, sp) => `<div class="tile ${cls}"><div class="tile-top"><span class="tile-i" aria-hidden="true"><svg viewBox="0 0 24 24">${KPI_ICON[ico]}</svg></span><div class="tile-l">${label}</div></div>
      <div class="tile-row"><div><div class="tile-v">${value}</div>${delta || `<span class="tile-s">${sub}</span>`}</div>${sp || ''}</div>${delta ? `<div class="tile-s">${sub}</div>` : ''}</div>`;
  function tiles(A, D) {
    const nb = A.totNB, p = A.prev, cov = A.coverage, C = D && D.C;
    if (cov) {
      const st = A.site, ps = A.prevSite;
      return `<section class="tiles" aria-label="Whole-site performance">
        ${tile('t-blue', 'clicks', 'Organic clicks', fmtN(st.clicks), 'All searches, from daily totals', tileDelta(st.clicks, ps && ps.clicks), spark(C, 'clicks'))}
        ${tile('t-green', 'impr', 'Impressions', fmtN(st.impr), 'All searches, from daily totals', tileDelta(st.impr, ps && ps.impr), spark(C, 'impr'))}
        ${tile('t-amber', 'ctr', 'CTR', pctf(st.ctr, 2), 'Whole site, branded included', tileDelta(st.ctr, ps && ps.ctr, false, 'pt'), spark(C, 'ctr'))}
        ${tile('t-red', 'pos', 'Average position', st.pos.toFixed(1), 'Weighted by impressions', tileDelta(st.pos, ps && ps.pos, true), spark(C, 'pos', true))}
      </section>`;
    }
    const bench = expCtr(nb.pos);
    return `<section class="tiles" aria-label="Non-branded performance">
      ${tile('t-blue', 'clicks', 'Non-brand clicks', fmtN(nb.clicks), `${A.NBQ.length.toLocaleString()} queries in this data`, tileDelta(nb.clicks, p && p.nb.clicks), spark(C, 'clicks'))}
      ${tile('t-green', 'impr', 'Non-brand impressions', fmtN(nb.impr), 'Queries in this data only', tileDelta(nb.impr, p && p.nb.impr), spark(C, 'impr'))}
      ${tile('t-amber', 'ctr', 'Non-brand CTR', pctf(nb.ctr, 2), `Benchmark at this position ~${bench.toFixed(1)}%`, tileDelta(nb.ctr, p && p.nb.ctr, false, 'pt'), spark(C, 'ctr'))}
      ${tile('t-red', 'pos', 'Non-brand position', nb.pos.toFixed(1), 'Weighted by impressions', tileDelta(nb.pos, p && p.nb.pos, true), spark(C, 'pos', true))}
    </section>`;
  }
  // Non-brand subset and how much of the site the query and page rows cover.
  function subsetStrip(A, D) {
    const nb = A.totNB, p = A.prev, cov = A.coverage;
    const rows = cov && cov.rowLimit ? `top ${cov.rowsQ.toLocaleString()} queries` : `${(cov ? cov.rowsQ : A.Q.length).toLocaleString()} queries`;
    // change vs previous period as a coloured pill; for position, lower is better
    const chg = (c, pr, inv, unit) => {
      if (pr == null || !isFinite(pr) || pr === 0) return '';
      const d = unit === 'pt' ? c - pr : (c - pr) / pr * 100;
      if (Math.abs(d) < 0.05) return '<span class="chg flat">no change</span>';
      const good = inv ? d < 0 : d > 0;
      return `<span class="chg ${good ? 'good' : 'bad'}" title="${good ? 'Better' : 'Worse'} than the previous period">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${unit === 'pt' ? ' pts' : '%'}</span>`;
    };
    const kpi = (icon, tone, label, value, change, hint) => `<div class="kpi2 k-${tone}"><div class="kpi2-top"><span class="kpi2-ico">${svg(icon)}</span><span>${label}</span></div><b>${value}</b>${change}${hint ? `<small>${hint}</small>` : ''}</div>`;
    const brandPct = A.totAll.clicks ? A.totB.clicks / A.totAll.clicks * 100 : 0;
    const bar = (label, v, tone) => v == null ? '' : `<div class="cbar"><span class="cbar-l">${label}</span><span class="cbar-t"><span class="cbar-f ${tone}" style="width:${Math.min(100, v).toFixed(1)}%"></span></span><b>${v.toFixed(1)}%</b></div>`;
    return `<section class="panel subset">
      <div class="subset-h">
        <div><h2>Non-branded searches</h2><p>What SEO earns on its own. From the ${esc(rows)}, branded searches removed; every estimate uses this subset.</p></div>
        <span class="pill indigo">${A.NBQ.length.toLocaleString()} searches</span>
      </div>
      <div class="kpi2s">
        ${kpi('clicks', 'blue', 'Clicks', fmtN(nb.clicks), chg(nb.clicks, p && p.nb.clicks))}
        ${kpi('eye', 'green', 'Impressions', fmtN(nb.impr), chg(nb.impr, p && p.nb.impr))}
        ${kpi('pulse', 'amber', 'CTR', pctf(nb.ctr, 2), chg(nb.ctr, p && p.nb.ctr, false, 'pt'))}
        ${kpi('target', 'red', 'Avg. position', nb.pos.toFixed(1), chg(nb.pos, p && p.nb.pos, true), nb.pos <= 10 ? 'page one' : nb.pos <= 20 ? 'page two' : 'beyond page two')}
        <div class="kpi2 k-violet brandmix"><div class="kpi2-top"><span class="kpi2-ico">${svg('star')}</span><span>Query clicks by type</span></div>
          <div class="mix" role="img" aria-label="${brandPct.toFixed(0)}% branded, ${(100 - brandPct).toFixed(0)}% non-branded"><span class="mix-b" style="width:${brandPct.toFixed(1)}%"></span><span class="mix-n" style="width:${(100 - brandPct).toFixed(1)}%"></span></div>
          <div class="mix-l"><span><i class="mix-b"></i>Branded <b>${brandPct.toFixed(0)}%</b></span><span><i class="mix-n"></i>Non-branded <b>${(100 - brandPct).toFixed(0)}%</b></span></div>
        </div>
      </div>
      ${cov ? `<div class="coverage">
        <div class="cov-h"><h3>How much of the site this data covers</h3>${cov.rowLimit ? `<span class="pill amber">Export lists top ${cov.rowsQ.toLocaleString()} only</span>` : ''}</div>
        <div class="cov-grid">
          <div><p class="cov-k">Query rows</p>${bar('Clicks', cov.q.clicks, 'blue')}${bar('Impressions', cov.q.impr, 'green')}</div>
          <div><p class="cov-k">Page rows</p>${bar('Clicks', cov.p.clicks, 'blue')}${bar('Impressions', cov.p.impr, 'green')}</div>
        </div>
        ${cov.notShown.clicks > 0 ? `<p class="cov-note">${svg('alert')}<span><b>${fmtN(cov.notShown.clicks)} clicks (${cov.notShown.share.toFixed(1)}%)</b> ${cov.source === 'file' ? 'are not represented in this export: searches beyond its row limit plus queries Google keeps private.' : 'have no reported query: Google withholds rare queries for privacy, and row limits may apply.'}</span></p>` : ''}
      </div>` : ''}
    </section>`;
  }
  function signalBox(cls, icon, title, items, empty) {
    return `<section class="sig ${cls}"><h2>${svg(icon)}${esc(title)}</h2>${items.length ? items.map(i => `<a href="#${i.view}"><span class="sl" title="${esc(i.l)}">${esc(i.l)}</span><span class="sv">${esc(i.v)}</span></a>`).join('') : `<p class="none">${esc(empty)}</p>`}</section>`;
  }
  const STATUS = { strong: 'Strong', ctr: 'Fix CTR', work: 'Needs work', steady: 'Steady' };
  function sectionCards(list, cls) {
    if (!list.length) return '<p class="empty">No pages found.</p>';
    const max = Math.max(...list.map(s => s.clicks), 1);
    return `<div class="cards ${cls || ''}">${list.map(s => `
      <a class="card s-${s.status}" href="#section=${encodeURIComponent(s.key)}" title="Open ${esc(s.key)}">
        <div class="card-top"><span class="card-n" title="${esc(s.key)}">${esc(s.key)}</span><span class="badge b-${s.status}">${STATUS[s.status]}</span></div>
        <div class="card-v">${fmtN(s.clicks)}</div>
        <div class="card-m">CTR ${pctf(s.ctr)} · pos ${s.pos.toFixed(1)} · ${s.n} page${s.n === 1 ? '' : 's'}</div>
        <div class="card-bar"><span style="width:${(s.clicks / max * 100).toFixed(1)}%"></span></div>
      </a>`).join('')}</div>`;
  }

  // Countries and search appearance, when the export includes them.
  function countryTable(D) {
    const top = (list, n) => (list || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, n);
    const c = top(D.Countries, 5), a = top(D.Appearance, 4);
    const t = (rows, label) => rows.length ? `<table style="margin-top:10px"><thead><tr><th>${label}</th><th class="r">Clicks</th><th class="r">CTR</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.d)}</td><td class="r">${fmtN(r.clicks)}</td><td class="r">${pctf(r.ctr)}</td></tr>`).join('')}</tbody></table>` : '';
    return t(c, 'Top countries') + t(a, 'Search appearance');
  }

  // Aggregate the daily series by day / week / month
  function rollup(C, unit) {
    const c = (C || []).slice().sort((a, b) => a.d.localeCompare(b.d));
    if (unit === 'day') return c.map(r => ({ l: r.d.slice(5), d: r.d, clicks: r.clicks, impr: r.impr, ctr: r.impr ? r.clicks / r.impr * 100 : 0, pos: r.pos || null }));
    const m = new Map();
    c.forEach(r => {
      const d = new Date(r.d + 'T00:00:00');
      let k;
      if (unit === 'week') { const w = new Date(d); w.setDate(d.getDate() - ((d.getDay() + 6) % 7)); k = w.toISOString().slice(5, 10); }
      else k = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      const o = m.get(k) || { l: k, d: r.d, clicks: 0, impr: 0, pw: 0 }; o.clicks += r.clicks; o.impr += r.impr; o.pw += (r.pos || 0) * r.impr; m.set(k, o);
    });
    return [...m.values()].map(o => ({ l: o.l, d: o.d, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.pw / o.impr : null }));
  }
  // A small trend line for a KPI card: daily values, thinned to about 48 points. Inline SVG, no chart library.
  function spark(C, key, invert) {
    const r = rollup(C, 'day').map(x => x[key]).filter(v => v != null && isFinite(v));
    if (r.length < 4) return '';
    const step = Math.max(1, Math.ceil(r.length / 48)), v = [];
    for (let i = 0; i < r.length; i += step) { const seg = r.slice(i, i + step); v.push(seg.reduce((a, b) => a + b, 0) / seg.length); }
    const lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 34, sp = hi - lo || 1;
    const pts = v.map((x, i) => [i / (v.length - 1) * W, invert ? 2 + (x - lo) / sp * (H - 4) : H - 2 - (x - lo) / sp * (H - 4)]);
    const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${H} ${line} ${W},${H}"/><polyline points="${line}"/></svg>`;
  }
  function gscIndexUrl(D) {
    const res = D.siteUrl || ('sc-domain:' + D.site);
    return 'https://search.google.com/search-console/index?resource_id=' + encodeURIComponent(res);
  }
  const INDEX_CHECKS = [
    ['Not found (404)', 'Broken URLs Google still tries to crawl'],
    ['Page with redirect', 'Internal links pointing at redirects'],
    ['Alternate page with proper canonical', 'Duplicates correctly pointing elsewhere'],
    ['Blocked by robots.txt', 'Pages you may have blocked by mistake'],
    ["Excluded by 'noindex' tag", 'Check none of these should rank'],
    ['Discovered – currently not indexed', 'Google knows the URL but has not crawled it'],
    ['Crawled – currently not indexed', 'Often thin or duplicate content'],
    ['Server error (5xx)', 'Pages failing when Googlebot visits']
  ];
  const miniTable = (rows, key, label) => rows.length ? `<table><thead><tr><th>${label}</th><th class="r">Clicks</th><th class="r">Impr.</th><th class="r">Pos.</th></tr></thead><tbody>${rows.map(r => `<tr><td class="${key === 'q' ? 'q' : 'u'}">${key === 'q' ? serp(r.q) : urlCell(r.p, r.path)}</td><td class="r">${fmtN(r.clicks)}</td><td class="r">${fmtN(r.impr)}</td><td class="r">${posTag(r.pos)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No data.</p>';

  V.overview = (A, D) => {
    const brandShare = A.totAll.clicks ? A.totB.clicks / A.totAll.clicks * 100 : 0;
    const topQ = A.NBQ.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 10);
    const topP = A.P.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 10);
    const CC = window.CW_COMMAND;
    const hasPrevC = !!(D.prevC && D.prevC.length);
    const trend = D.C && D.C.length ? `<section class="panel cc-trend">
        <div class="panel-h"><h2>Organic traffic trend</h2>
          <div class="cc-trend-ctl">
            <div class="seg seg-m" role="group" aria-label="Metric"><button type="button" data-metric="clicks" class="on">Clicks</button><button type="button" data-metric="impr">Impressions</button><button type="button" data-metric="ctr">CTR</button><button type="button" data-metric="pos">Position</button></div>
            <div class="seg" role="group" aria-label="Group by"><button type="button" data-unit="day" class="on">Daily</button><button type="button" data-unit="week">Weekly</button><button type="button" data-unit="month">Monthly</button></div>
          </div></div>
        <div class="panel-b">
          <div class="legend"><span><i style="background:var(--signal)"></i>This period</span>${hasPrevC ? '<span><i class="dash"></i>Previous period</span>' : '<span class="flat">No previous period loaded</span>'}${CC && CC.hasMarkers(D) ? '<span><i style="background:var(--orange)"></i>Changes you implemented</span>' : ''}</div>
          <div class="chart-box"><canvas id="ch-trend" aria-label="Organic traffic over time, this period${hasPrevC ? ' and the previous period' : ''}"></canvas></div>
        </div></section>` : '<section class="panel cc-trend"><div class="panel-h"><h2>Organic traffic trend</h2></div><p class="empty" style="padding:16px 20px">This export has no date data. Connect Search Console or include the Dates sheet to see the trend.</p></section>';
    const banner = `<section class="banner">
        <div><h1>${A.potential.hi >= 1 ? `${esc(D.site)} could gain roughly <b class="num">${fmtN(A.potential.lo)}–${fmtN(A.potential.hi)}</b> more clicks a month from searches it already ranks for.` : `No clear click opportunities in searches ${esc(D.site)} already ranks for.`}</h1>
        <p>${A.potential.hi >= 1 ? `An estimate from ${A.potential.n.toLocaleString()} non-branded searches${A.coverage ? ` (${(A.potential.hi / Math.max(1, A.potential.monthlySiteClicks) * 100).toFixed(1)}% of monthly clicks at the high end)` : ''}, counted once each.` : `Checked ${A.NBQ.length.toLocaleString()} non-branded searches: none rank where a better title or a few positions would add clicks.`} Branded searches (${brandShare.toFixed(0)}% of query clicks) are excluded. <a href="#plan">How it's estimated</a></p></div>
        <a class="btn-primary" href="#plan">See the action plan</a>
      </section>`;
    const html = `${CC ? CC.html(A, D) : ''}
      ${tiles(A, D)}
      ${CC && CC.target ? `<div class="cc-grid wide stretch">${trend}${CC.target(A, D)}</div>` : trend}
      ${banner}
      ${CC && CC.opps ? `<div class="cc-grid wide">${CC.opps(A, D)}<div class="cc-col">${CC.tasksPanel(A, D)}${CC.insights(A, D)}</div></div>
      <div class="cc-grid wide">${CC.changes(A, D)}${CC.winners(A, D)}</div>
      ${CC.body(A, D)}` : `<section class="panel"><div class="panel-h"><h2>Do these first</h2><a href="#plan">Full action plan</a></div>${ledger(A.plan, 3)}</section>`}

      <form class="sf-box ov-ask" id="ov-ask" autocomplete="off" role="search" aria-label="Describe an SEO goal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>
        <input id="ov-ask-in" type="text" maxlength="300" placeholder="Ask in plain English, e.g. which pages should I fix first?" aria-label="Describe an SEO goal">
        <button class="btn-primary" type="submit">Ask</button>
      </form>

      ${subsetStrip(A, D)}

      <div class="grid-2 even">
        <section class="panel">
          <div class="panel-h"><h2>Position distribution</h2><p>Non-branded queries by ranking band. The 4–10 and 11–20 bars are your quickest gains.</p></div>
          <div class="panel-b"><div class="chart-box sm"><canvas id="ch-dist" aria-label="Queries by position band"></canvas></div></div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>CTR by position</h2><p>Your non-branded CTR, the expected CTR used for estimates (your own where there is enough data), and the industry benchmark.</p></div>
          <div class="panel-b"><div class="chart-box sm"><canvas id="ch-ctrpos" aria-label="CTR by position versus benchmark"></canvas></div></div>
        </section>
      </div>

      <div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>Top non-branded queries</h2><a href="#queries">All queries</a></div><div class="panel-b flush">${miniTable(topQ, 'q', 'Query')}</div></section>
        <section class="panel"><div class="panel-h"><h2>Top pages</h2><a href="#pages">All pages</a></div><div class="panel-b flush">${miniTable(topP, 'p', 'Page')}</div></section>
      </div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-h"><h2>Site clusters</h2><a href="#sections">All clusters</a><p>Click a folder to dive into its URLs. Badges: Strong, Steady, Fix CTR (ranks but under-clicked), Needs work (mostly page two).</p></div>
          <div class="panel-b cards-wrap">${sectionCards(A.sections1.filter(x => x.key !== '/').slice(0, 6), 'two')}</div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>Where clicks come from</h2></div>
          <div class="panel-b">
            <div class="chart-box sm"><canvas id="ch-split" aria-label="Branded versus non-branded clicks"></canvas></div>
            ${D.Dev && D.Dev.length ? `<table style="margin-top:10px"><tbody>${D.Dev.map(d => `<tr><td>${esc(d.d.charAt(0) + d.d.slice(1).toLowerCase())}</td><td class="r">${fmtN(d.clicks)} clicks</td><td class="r">${pctf(d.ctr)} CTR</td></tr>`).join('')}</tbody></table>` : ''}
            ${countryTable(D)}
          </div>
        </section>
      </div>

      <div class="stack">
        <details class="acc">
          ${accHead('alert', 'orange', 'Indexing issues to check', 'Pages Google is not indexing. Review each reason in Search Console › Indexing › Pages.', 'Open checklist', 'orange')}
          <div class="acc-tip"><b>Tip:</b> open <a href="#indexing">Indexing</a> to inspect your top pages live and add the Pages report export, or open the report in Search Console and click a reason to see the affected URLs.</div>
          <div class="idx">${INDEX_CHECKS.map(([t, d]) => `<a href="${esc(gscIndexUrl(D))}" target="_blank" rel="noopener"><span>${esc(t)}<br><small>${esc(d)}</small></span>${svg('chev').replace('viewBox', 'style="transform:rotate(-90deg);width:16px;height:16px;flex:none" viewBox')}</a>`).join('')}</div>
        </details>
      </div>`;
    const mount = () => {
      if (CC) CC.mount(A, D);
      if (D.C && D.C.length) {
        const LBL = { clicks: 'Clicks', impr: 'Impressions', ctr: 'CTR (%)', pos: 'Average position' };
        const st = { unit: 'day', metric: 'clicks' }, unitRef = { unit: 'day' };
        const series = () => {
          const cur = rollup(D.C, st.unit), prev = hasPrevC ? rollup(D.prevC, st.unit) : [];
          const v = r => r == null ? null : st.metric === 'ctr' || st.metric === 'pos' ? (r[st.metric] == null ? null : +r[st.metric].toFixed(2)) : r[st.metric];
          return { labels: cur.map(x => x.l), cur: cur.map(v), prev: cur.map((x, i) => v(prev[i])), prevLabels: cur.map((x, i) => prev[i] ? prev[i].l : '') };
        };
        let d0 = series();
        const ch = chart('ch-trend', { type: 'line', plugins: CC ? [CC.markerPlugin(D, unitRef)] : [], data: { labels: d0.labels, datasets: [
          { label: 'This period', data: d0.cur, borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal-soft'), fill: true, tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5 },
          { label: 'Previous period', data: d0.prev, hidden: !hasPrevC, borderColor: cssVar('--muted'), borderDash: [5, 4], backgroundColor: 'transparent', tension: .35, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.5 }
        ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false },
          tooltip: { callbacks: { title: x => x[0] ? x[0].label : '', label: x => ` ${x.dataset.label}${x.datasetIndex === 1 && d0.prevLabels[x.dataIndex] ? ' (' + d0.prevLabels[x.dataIndex] + ')' : ''}: ${x.raw == null ? '—' : st.metric === 'ctr' ? x.raw.toFixed(2) + '%' : st.metric === 'pos' ? x.raw.toFixed(1) : fmtN(x.raw)}` } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { reverse: false, grid: { color: cssVar('--line-soft') }, title: { display: true, text: LBL.clicks }, ticks: { callback: v => st.metric === 'ctr' ? v + '%' : st.metric === 'pos' ? v : fmtN(v) } } } } });
        const redraw = () => {
          if (!ch) return;
          d0 = series(); unitRef.unit = st.unit;
          ch.data.labels = d0.labels; ch.data.datasets[0].data = d0.cur; ch.data.datasets[1].data = d0.prev;
          ch.options.scales.y.reverse = st.metric === 'pos'; ch.options.scales.y.title.text = LBL[st.metric];
          ch.data.datasets.forEach(ds => ds.pointRadius = st.unit === 'day' ? 0 : 3);
          ch.update();
        };
        document.querySelectorAll('.cc-trend .seg [data-unit]').forEach(b => b.addEventListener('click', () => {
          document.querySelectorAll('.cc-trend .seg [data-unit]').forEach(x => x.classList.toggle('on', x === b)); st.unit = b.dataset.unit; redraw();
        }));
        document.querySelectorAll('.cc-trend [data-metric]').forEach(b => b.addEventListener('click', () => {
          document.querySelectorAll('.cc-trend [data-metric]').forEach(x => x.classList.toggle('on', x === b)); st.metric = b.dataset.metric; redraw();
        }));
      }
      chart('ch-dist', { type: 'bar', data: { labels: A.posDist.map(b => b.label), datasets: [
        { label: 'Queries', data: A.posDist.map(b => b.n), backgroundColor: [cssVar('--good'), cssVar('--signal'), cssVar('--watch'), cssVar('--orange'), cssVar('--risk')], borderRadius: 6, yAxisID: 'y' }
      ] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => { const b = A.posDist[x.dataIndex]; return [` ${b.n} queries`, ` ${fmtN(b.clicks)} clicks · ${fmtN(b.impr)} impr.`]; } } } }, scales: { x: { grid: { display: false }, title: { display: true, text: 'Position' } }, y: { ticks: { precision: 0 } } } } });
      chart('ch-ctrpos', { type: 'line', data: { labels: A.ctrByPos.map(p => p.pos), datasets: [
        { label: 'Your CTR', data: A.ctrByPos.map(p => p.actual), borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal'), spanGaps: true, tension: .3, pointRadius: 3, borderWidth: 2 },
        { label: 'Expected (used for estimates)', data: A.ctrByPos.map(p => p.expected), borderColor: cssVar('--good'), pointRadius: 0, borderWidth: 1.5, tension: .3 },
        { label: 'Industry benchmark', data: A.ctrByPos.map(p => p.bench), borderColor: cssVar('--muted'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, tension: .3 }
      ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: x => ` ${x.dataset.label}: ${x.raw == null ? '—' : x.raw.toFixed(1) + '%'}` } } }, scales: { x: { grid: { display: false }, title: { display: true, text: 'Position' } }, y: { ticks: { callback: v => v + '%' } } } } });
      chart('ch-split', { type: 'doughnut', data: { labels: ['Non-branded', 'Branded'], datasets: [{ data: [A.totNB.clicks, A.totB.clicks], backgroundColor: [cssVar('--signal'), cssVar('--watch')], borderColor: cssVar('--surface'), borderWidth: 2 }] }, options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: x => ` ${x.label}: ${fmtN(x.raw)} clicks` } } } } });
    };
    return { html, mount };
  };

  function sectionBars(list) {
    if (!list.length) return '<p class="empty">No pages found.</p>';
    const max = Math.max(...list.map(s => s.clicks), 1);
    return `<div class="bars" role="table" aria-label="Site clusters">
      <div class="bar-row bar-head" role="row"><span role="columnheader">Section</span><span class="hide-sm"></span><span class="r" role="columnheader">Clicks</span><span class="r hide-sm" role="columnheader">CTR</span><span class="r" role="columnheader">Pages</span></div>
      ${list.map(s => `<div class="bar-row" role="row"><span class="lbl" role="cell" title="${esc(s.key)}">${esc(s.key)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="display:block;width:${(s.clicks / max * 100).toFixed(1)}%"></span></span><span class="r" role="cell">${fmtN(s.clicks)}</span><span class="r hide-sm" role="cell">${pctf(s.ctr)}</span><span class="r" role="cell">${s.n}</span></div>`).join('')}
    </div>`;
  }

  // ── All opportunities: one ranked list with evidence, impact, confidence and effort ──
  V.opps = (A, D) => {
    const O = A.opps;
    if (!O) return { html: head('All opportunities', '') + '<p class="empty">Not available for this data.</p>' };
    const lvlTag = l => `<span class="tag ${l === 'High' ? 'gain' : l === 'Medium' ? 'watch' : ''}">${esc(l)}</span>`;
    const KIND = { growth: 'growth', recovery: 'recovery', stake: 'at stake', none: '' };
    const rows = O.items.map(it => ({ ...it, label: it.subject.label, lo: it.impact.lo, hi: it.impact.hi, score: it.confidence.score, lvl: it.confidence.level, effortN: { Low: 1, Medium: 2, High: 3 }[it.effort.level], kind: it.impact.kind }));
    const m = it => it.measured.clicks == null ? `not in the export (≤ ${fmtN(it.measured.upTo)} clicks)` : `#${it.measured.pos ? it.measured.pos.toFixed(1) : '—'} · ${fmtN(it.measured.impr)} impr. · ${pctf(it.measured.ctr)} CTR`;
    const impactCell = it => it.impact.kind === 'none' ? '<span class="flat">Watch</span>'
      : `<span class="${it.impact.kind === 'growth' ? 'gainv' : 'lossv'}">${range(it.impact.lo, it.impact.hi)}</span><br><small class="flat">${esc(KIND[it.impact.kind])}${it.impact.counted ? '' : ' · not in total'}</small>`;
    const subj = it => it.subject.kind === 'page' ? urlCell(it.subject.url, it.subject.label) : serp(it.subject.label);
    const list = a => a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const sub = it => `<tr class="sub"><td colspan="6"><details class="opp-d"><summary>Evidence, confidence and warnings</summary>
        <div class="opp-g">
          <div><h4>Why it was picked</h4><p>${esc(it.reason)}</p>${list(it.evidence)}${it.previous ? `<p class="flat">Measured ${esc(O.period.start || '')} – ${esc(O.period.end || '')} against ${esc(O.period.prevStart || 'the previous period')}${O.period.prevEnd ? ' – ' + esc(O.period.prevEnd) : ''}.</p>` : ''}</div>
          <div><h4>Impact (estimate)</h4><p>${esc(it.impact.note)}.${it.impact.basis ? ' ' + esc(it.impact.basis) + '.' : ''}</p>${it.impact.overlap ? `<p class="flat">${esc(it.impact.overlap)}.</p>` : ''}
            <h4>Confidence: ${esc(it.confidence.level)} (${it.confidence.score}/100)</h4><ul class="why">${it.confidence.why.map(w => `<li><b class="${w.points >= 0 ? 'up' : 'down'}">${w.points > 0 ? '+' : ''}${w.points}</b> ${esc(w.text)}</li>`).join('')}</ul></div>
          <div><h4>What to do</h4><p>${esc(it.action)}</p><p><span class="tag">${esc(it.effort.level)} effort</span> ${esc(it.effort.why)}</p>
            ${it.warnings.length ? `<h4>Warnings</h4>${list(it.warnings)}` : ''}<p><a href="#${esc(it.view)}">Open ${esc(TYPE_VIEW[it.view] || 'the list')}</a>${(() => { const u = it.subject.kind === 'page' ? it.subject.url : it.landing ? it.landing.url : null; return u ? ` · <a href="#fixes?add=${encodeURIComponent(u)}&amp;note=${encodeURIComponent(it.action.slice(0, 300))}">Track this fix</a>` : ''; })()}</p></div>
        </div></details></td></tr>`;
    const cols = [
      { k: 'label', l: 'Opportunity', cls: 'q', f: it => `<span class="tag">${esc(it.typeLabel)}</span><br>${subj(it)}`, csv: it => it.subject.url || it.subject.label },
      { k: 'typeLabel', l: 'Type', sort: false, csv: it => it.typeLabel, f: () => '', hide: true },
      { k: 'measuredS', l: 'Measured', sort: false, f: it => `<small>${m(it)}</small>`, csv: it => m(it) },
      { k: 'lo', l: 'Clicks / month (est.)', r: 1, f: impactCell, csv: it => it.impact.kind === 'none' ? '' : `${Math.round(it.impact.lo)}–${Math.round(it.impact.hi)} ${KIND[it.impact.kind]}${it.impact.counted ? '' : ' (not in total)'}` },
      { k: 'score', l: 'Confidence', f: it => lvlTag(it.confidence.level) + `<br><small class="flat">${it.confidence.score}/100</small>`, csv: it => `${it.confidence.level} (${it.confidence.score}): ${it.confidence.why.map(w => (w.points > 0 ? '+' : '') + w.points + ' ' + w.text).join('; ')}` },
      { k: 'effortN', l: 'Effort', f: it => `<span class="tag">${esc(it.effort.level)}</span>`, csv: it => it.effort.level },
      { k: 'action', l: 'Suggested action', sort: false, f: it => `<small>${esc(it.action)}</small>`, csv: it => it.action + (it.warnings.length ? ' | Warnings: ' + it.warnings.join(' ') : '') }
    ].filter(c => !c.hide);
    const types = [...new Set(O.items.map(it => it.type))];
    const g = O.totals.growth, r = O.totals.recovery;
    const per = O.period;
    const html = head('All opportunities', `Every recommendation in one list, ranked by its conservative estimate. Measured over ${per.assumed ? 'an assumed ' + per.days + ' days' : `${per.days} days (${esc(per.start)} to ${esc(per.end)})`}${per.prevStart ? `, compared with ${esc(per.prevStart)} to ${esc(per.prevEnd)}` : ''}. Metrics are measured; clicks a month are estimates.`) +
      `<div class="strip">${stat(O.items.length.toLocaleString(), 'opportunities', '')}${stat(range(g.lo, g.hi), `clicks a month of growth (${g.n} searches, each counted once)`, 'gain')}${r.n ? stat(range(r.lo, r.hi), `clicks a month that could come back (${r.n} pages)`, 'risk') : ''}${stat(O.byLevel.High.toLocaleString(), 'high confidence', 'gain')}</div>` +
      (A.contentPending ? '<div class="note" role="status">Content gaps and internal links are still being worked out in the background; they appear in this list by themselves.</div>' : '') +
      (O.warnings.length ? `<div class="note"><b>About this data.</b><ul>${O.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '') +
      `<section class="panel">${table('t-opp', cols, rows, { sort: 'lo', file: 'opportunities', searchKeys: ['label'], placeholder: 'Filter by search or page', pageSize: 25, sub,
        filters: [
          { key: 'type', label: 'Type', options: types.map(t => [t, O.TYPES[t].label]), test: (it, v) => it.type === v },
          { key: 'lvl', label: 'Confidence', options: [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], test: (it, v) => it.lvl === v },
          { key: 'eff', label: 'Effort', options: [['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']], test: (it, v) => it.effort.level === v },
          { key: 'kind', label: 'Impact', options: [['growth', 'Growth'], ['recovery', 'Recovery'], ['stake', 'At stake'], ['none', 'Warnings only']], test: (it, v) => it.kind === v }
        ],
        empty: 'No opportunities match these filters.' })}</section>
      <div class="note"><b>Reading the numbers.</b> Growth is counted once per search: when the same search appears under several types, the largest estimate is the one added up, and page-title estimates are never added because they overlap the searches on that page. Recovery assumes 30–80% of lost clicks return. Competing pages and early warnings carry no total. Confidence is a score from fixed rules (data volume, period, where expected CTR comes from, and known results-page effects); open a row to see every reason.</div>${methodNote(A)}`;
    return { html, mount: () => drawTable('t-opp') };
  };
  const TYPE_VIEW = { quickwins: 'Almost page one', ctr: 'Titles to rewrite', ai: 'AI search visibility', decay: 'Losing ground', cannibal: 'Competing pages', 'content?tab=gaps': 'Content gaps', 'content?tab=links': 'Internal links' };

  V.plan = (A) => ({ html: head('Action plan', 'Every recommendation, ranked by its conservative (low) estimate of clicks per month. Ranges overlap between actions, so do not add them up.') +
    `<section class="panel">${ledger(A.plan)}</section>${methodNote(A)}` });

  V.quickwins = (A) => {
    const rows = A.quickWins;
    const html = head('Almost page one', 'Non-branded queries ranking 4–20 with real demand. Moving them into the top 3 (or top 7 from page two) is usually the fastest SEO gain.') +
      `<div class="strip">${stat(rows.length.toLocaleString(), 'queries in striking distance', 'gain')}${stat(range(rows.reduce((s, r) => s + r.gainLo, 0), rows.reduce((s, r) => s + r.gainHi, 0)), 'clicks a month (estimate)', 'gain')}${stat(rows.filter(r => r.serp).length.toLocaleString(), 'held back by a results-page feature?', 'watch')}${stat(rows.filter(r => r.pos > 10).length.toLocaleString(), 'on page two', '')}</div>
      <section class="panel">${table('t-qw', [C.q, C.impr, C.clicks, C.ctr, C.pos, { k: 'target', l: 'Target', r: 1, f: r => r.lowTarget > r.target + 0.5 ? `#${r.lowTarget.toFixed(0)}–${r.target}` : '#' + r.target, csv: r => r.target }, C.gain], rows, { sort: 'gain', file: 'almost-page-one', placeholder: 'Filter queries',
        filters: [{ key: 'band', label: 'Position', options: [['a', '4–10'], ['b', '11–20']], test: (r, v) => v === 'a' ? r.pos <= 10 : r.pos > 10 }],
        empty: 'No queries between positions 4 and 20 with enough impressions.' })}</section>
      <div class="note"><b>How to move them.</b> Link to the ranking page from your strongest pages using the query as anchor text, answer the query in a heading near the top, and make sure the title contains the exact phrase. Searches marked “results-page feature?” get far fewer clicks than this site usually earns at that position; check the results page before investing.</div>${methodNote(A)}`;
    return { html, mount: () => drawTable('t-qw') };
  };

  V.ctr = (A) => {
    const hasTop = A.ctrPages.some(r => r.top && r.top.length);
    // with a crawler page export loaded, each page shows its current title next to its numbers
    const titleOf = new Map(A.titles ? A.titles.all.map(t => [t.key, t.title]) : []);
    const tcol = A.titles ? [{ k: 'titleNow', l: 'Title now', sort: false, cls: 'act', f: r => { const t = titleOf.get(window.CW_CONTENT.normUrl(r.p)); return t ? `<small>${esc(t)}</small>` : '<small class="flat">Not in the crawl</small>'; }, csv: r => titleOf.get(window.CW_CONTENT.normUrl(r.p)) || '' }] : [];
    const pcols = [C.page].concat(tcol, [C.impr, C.clicks, C.ctr, C.bench, C.pos, C.gain]);
    const html = head('Titles to rewrite', 'Pages and queries on page one that get far fewer clicks than this site normally earns at that position. Better titles and descriptions fix many of these without any ranking change.') +
      `<div class="strip">${stat(A.ctrPages.length.toLocaleString(), 'pages under 60% of expected CTR', 'risk')}${stat(range(A.ctrPages.reduce((s, r) => s + r.gainLo, 0), A.ctrPages.reduce((s, r) => s + r.gainHi, 0)), 'clicks a month (pages, estimate)', 'gain')}${stat(A.ctrQueries.length.toLocaleString(), 'queries under half of expected', 'watch')}${A.setAside.length ? stat(A.setAside.length.toLocaleString(), 'set aside: likely sitelinks or utility pages', '') : ''}</div>
      <section class="panel"><div class="panel-h"><h2>Pages</h2><p>${hasTop ? 'Under each page: the searches it gets most impressions for. Write the title for those.' : 'Connect Search Console to see which searches each page is shown for.'}${A.titles ? '' : ' To see each page\'s current title here, upload your crawler\'s page export in <a href="#content?tab=titles">Content &amp; links › Titles &amp; metas</a>.'}</p></div>
      ${table('t-ctrp', pcols, A.ctrPages, { sort: 'gain', file: 'titles-to-rewrite-pages', searchKeys: ['path'], placeholder: 'Filter pages',
        sub: r => r.top && r.top.length ? `<tr class="sub"><td colspan="7">Top searches: ${r.top.map(q => `<span class="tag">${esc(q)}</span>`).join(' ')}</td></tr>` : '',
        empty: 'Every page-one page is close to benchmark CTR.' })}</section>
      <section class="panel"><div class="panel-h"><h2>Queries</h2><p>If CTR is low at position 1–3, check the results page: an AI Overview, map pack or ads may be taking the clicks, not your title.</p></div>
      ${table('t-ctrq', [C.q, C.impr, C.clicks, C.ctr, C.bench, C.pos, C.gain], A.ctrQueries, { sort: 'gain', file: 'titles-to-rewrite-queries', placeholder: 'Filter queries' })}</section>
      ${A.setAside.length ? `<section class="panel"><div class="panel-h"><h2>Set aside (${A.setAside.length})</h2><p>These pages match the low-CTR rule but are probably branded sitelinks or utility pages, where a title rewrite rarely helps. They are not counted in the estimates. If one is a real landing page, include it.</p></div>
        ${table('t-ctrx', [C.page, C.impr, C.ctr, C.pos, { k: 'why', l: 'Why it was set aside', sort: false, f: r => `${esc(r.flag.reason)}${r.flag.certain ? '' : ' <span class="tag">unconfirmed</span>'}`, csv: r => r.flag.reason }, { k: 'inc', l: '', sort: false, csv: false, f: r => `<button type="button" class="btn-quiet" data-keep="${esc(r.p)}">Include</button>` }], A.setAside, { sort: 'impr', file: 'titles-set-aside', search: false, pageSize: 10 })}</section>` : ''}
      ${methodNote(A)}`;
    return { html, mount: () => { drawTable('t-ctrp'); drawTable('t-ctrq'); if (A.setAside.length) drawTable('t-ctrx'); } };
  };

  V.cannibal = (A, D) => {
    const exact = A.cannibalMode === 'exact';
    const rows = A.cannibal;
    const sevTag = s => `<span class="tag ${s === 'high' ? 'risk' : s === 'medium' ? 'watch' : ''}">${s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'}</span>`;
    const cols = exact
      ? [C.q, { k: 'pagesN', l: 'Pages', r: 1, f: r => r.pages.length, csv: r => r.pages.map(p => p.p).join(' | ') }, C.impr, C.clicks, C.ctr, C.pos, { k: 'loss', l: 'At stake / month (up to)', r: 1, f: r => r.loss >= 1 ? `<span class="lossv">${fmtN(r.loss)}</span>` : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }]
      : [{ k: 'q', l: 'Keyword group', cls: 'q' }, { k: 'n', l: 'Variants', r: 1 }, C.impr, C.clicks, C.ctr, { k: 'spread', l: 'Position spread', r: 1, f: r => r.spread.toFixed(1) }, { k: 'loss', l: 'At stake / month (up to)', r: 1, f: r => r.loss >= 1 ? `<span class="lossv">${fmtN(r.loss)}</span>` : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }];
    rows.forEach(r => { r.pagesN = r.pages ? r.pages.length : 0; r.sevN = { high: 3, medium: 2, low: 1 }[r.sev]; });
    const sub = exact
      ? r => `<tr class="sub"><td colspan="8">${r.pages.map(p => `<div>${urlCell(p.p, window.CW.pathOf(p.p))} — ${p.share.toFixed(0)}% of impressions, position ${p.pos.toFixed(1)}, ${fmtN(p.clicks)} clicks</div>`).join('')}</td></tr>`
      : r => `<tr class="sub"><td colspan="8">${r.variants.slice(0, 6).map(v => `<span class="tag">${esc(v.q)} · #${v.pos.toFixed(1)}</span>`).join(' ')}</td></tr>`;
    const html = head('Competing pages', exact
      ? 'Searches where two or more of your own URLs each take at least 10% of impressions. These are candidates to investigate, not confirmed problems.'
      : 'Groups of similar searches with very different positions. This is a likely sign of competing pages; connect Search Console for exact page-level matches.') +
      (!exact && D.pending && D.pending.qp ? '<div class="note">Loading which query lands on which page from Search Console. Exact results replace this estimate by themselves in a moment.</div>' : '') +
      (exact || (D.pending && D.pending.qp) ? '' : '<div class="note"><b>Estimated mode.</b> File exports do not include which page ranks for which query. Connecting Search Console unlocks exact competing-page detection.</div>') +
      `<div class="strip">${stat(rows.filter(r => r.sev === 'high').length, 'high severity', 'risk')}${stat(rows.filter(r => r.sev === 'medium').length, 'medium severity', 'watch')}${stat('up to ' + fmtN(rows.reduce((s, r) => s + r.loss, 0)), 'clicks a month at stake (if one page ranked as well as the best)', 'risk')}</div>
      <section class="panel">${table('t-can', cols, rows, { sort: 'sevN', file: 'competing-pages', pageSize: 25, sub, empty: 'No competing pages found.' })}</section>
      <div class="note"><b>Fixing it.</b> Choose the page that best matches the intent. Then merge the weaker page into it with a 301, or rewrite the weaker page to target a different angle, and update internal links to point to the winner.</div>`;
    return { html, mount: () => drawTable('t-can') };
  };

  V.decay = (A, D) => {
    const dc = A.decay;
    if (!dc && D.pending && D.pending.prev) return { html: head('Losing ground', 'Pages and queries that lost clicks compared with the previous period.') + '<div class="note">Loading the previous period from Search Console. This screen fills in by itself in a moment.</div>' };
    if (!dc) {
      const t = A.trend;
      return { html: head('Losing ground', 'Pages and queries that lost clicks compared with the previous period.') +
        `<div class="note"><b>Needs a comparison period.</b> This export covers one period only. To see which pages and searches are losing clicks, use one of these:<ul>
          <li>In Search Console › Performance, open <b>Date › Compare</b>, pick “Compare last 3 months to previous period”, then <b>Export › Download Excel</b> and upload that file.</li>
          <li>Or export this period and the period before it separately, and select <b>both files together</b> when uploading.</li>
          <li>Or connect Search Console with “Compare with the previous period” ticked.</li></ul></div>` +
        (t ? `<section class="panel"><div class="panel-h"><h2>First half vs second half of this range</h2></div><div class="panel-b"><div class="strip">${stat((t.clicks >= 0 ? '▲ ' : '▼ ') + Math.abs(t.clicks).toFixed(1) + '%', 'clicks', t.clicks >= 0 ? 'gain' : 'risk')}${stat((t.impr >= 0 ? '▲ ' : '▼ ') + Math.abs(t.impr).toFixed(1) + '%', 'impressions', t.impr >= 0 ? 'gain' : 'risk')}${stat((t.ctr >= 0 ? '▲ ' : '▼ ') + Math.abs(t.ctr).toFixed(2) + ' pts', 'CTR', t.ctr >= 0 ? 'gain' : 'risk')}</div></div></section>` : '') };
    }
    const pcols = [C.page, { k: 'prevC', l: 'Clicks before', r: 1, f: r => fmtN(r.prev.clicks), csv: r => r.prev.clicks }, { k: 'curC', l: 'Clicks now', r: 1, f: r => fmtN(r.cur.clicks), csv: r => r.cur.clicks }, { k: 'ch', l: 'Change', r: 1, f: r => `<span class="lossv">${r.ch.toFixed(0)}%</span>` }, { k: 'reason', l: 'Likely cause', sort: false, f: r => esc(r.reason) + (r.uncertain ? ' <span class="tag watch" title="The current export stops at its row limit, so this row\'s current clicks are only known to be below the smallest row listed">upper bound</span>' : ''), csv: r => r.reason }];
    const slip = dc.slipping || { pages: [], queries: [] };
    const scol = { k: 'whyS', l: 'What is slipping', sort: false, f: r => r.why.map(w => `<span class="tag watch">${esc(w)}</span>`).join(' '), csv: r => r.why.join('; ') };
    dc.pages.forEach(r => { r.prevC = r.prev.clicks; r.curC = r.cur.clicks; });
    dc.queries.forEach(r => { r.prevC = r.prev.clicks; r.curC = r.cur.clicks; });
    dc.rising.forEach(r => { r.curC = r.cur.clicks; r.prevC = r.prev ? r.prev.clicks : 0; });
    const html = head('Losing ground', `Compared with ${D.prevStart ? esc(D.prevStart) + (D.prevEnd ? ' – ' + esc(D.prevEnd) : '') : 'the previous period in your export'}. Pages that lost at least a quarter of their clicks, with the most likely cause.`) +
      (D.compareNote ? `<div class="note warn">${esc(D.compareNote)}</div>` : dc.scale !== 1 ? `<div class="note">The previous period has ${dc.prevDays} days and this one ${A.days}, so its clicks and impressions were scaled to ${A.days} days before comparing.</div>` : '') +
      `<div class="strip">${stat(dc.pages.length, 'pages losing clicks', 'risk')}${stat('−' + fmtN(dc.lost), 'clicks lost across those pages', 'risk')}${stat(dc.rising.length, 'pages gaining', 'gain')}${stat(slip.pages.length + slip.queries.length, 'early warnings (rank, impressions or CTR)', 'watch')}</div>
      <section class="panel"><div class="panel-h"><h2>Pages losing clicks</h2></div>${table('t-dp', pcols, dc.pages, { sort: 'lost', file: 'losing-ground-pages', searchKeys: ['path'], empty: 'No page lost more than 25% of its clicks.' })}</section>
      <section class="panel"><div class="panel-h"><h2>Queries losing clicks</h2></div>${table('t-dq', [C.q, pcols[1], pcols[2], pcols[3], pcols[4]], dc.queries, { sort: 'lost', file: 'losing-ground-queries' })}</section>
      <section class="panel"><div class="panel-h"><h2>Early warnings</h2><p>Clicks have not fallen a quarter yet, but position, impressions or CTR moved the wrong way. Check these before they show up above.</p></div>${table('t-ds', [C.page, { k: 'prevI', l: 'Impressions before', r: 1, f: r => fmtN(r.prev.impr), csv: r => Math.round(r.prev.impr) }, { k: 'curI', l: 'Impressions now', r: 1, f: r => fmtN(r.cur.impr), csv: r => r.cur.impr }, scol], slip.pages.map(r => ({ ...r, prevI: r.prev.impr, curI: r.cur.impr })), { sort: 'prevI', file: 'early-warnings-pages', searchKeys: ['path'], pageSize: 20, empty: 'No pages slipping.' })}
        ${slip.queries.length ? `<h3 class="sub-h">Searches</h3>${table('t-dsq', [C.q, { k: 'prevI', l: 'Impressions before', r: 1, f: r => fmtN(r.prev.impr), csv: r => Math.round(r.prev.impr) }, { k: 'curI', l: 'Impressions now', r: 1, f: r => fmtN(r.cur.impr), csv: r => r.cur.impr }, scol], slip.queries.map(r => ({ ...r, prevI: r.prev.impr, curI: r.cur.impr })), { sort: 'prevI', file: 'early-warnings-searches', pageSize: 20 })}` : ''}</section>
      <section class="panel"><div class="panel-h"><h2>Pages gaining</h2><p>Worth studying: what changed here can often be copied to the decaying pages.</p></div>${table('t-dr', [C.page, { k: 'prevC', l: 'Clicks before', r: 1, f: r => !r.prev ? '<span class="flat">new</span>' : r.uncertain ? `≤ ${fmtN(r.prev.clicks)} <span class="tag watch" title="The earlier export stops at its row limit, so this page\'s earlier clicks are only known to be below the smallest row listed">upper bound</span>` : fmtN(r.prev.clicks), csv: r => r.prev ? (r.uncertain ? '<=' : '') + Math.round(r.prev.clicks) : 0 }, pcols[2], { k: 'won', l: 'Clicks won', r: 1, f: r => gainCell(r.won) + (r.uncertain ? '<br><small class="flat">at least</small>' : ''), csv: r => Math.round(r.won) }], dc.rising, { sort: 'won', file: 'gaining-pages', searchKeys: ['path'] })}</section>`;
    return { html, mount: () => { ['t-dp', 't-dq', 't-ds', 't-dsq', 't-dr'].forEach(id => drawTable(id)); } };
  };

  V.ai = (A) => {
    const ai = A.ai;
    const groups = [
      { id: 'ov', icon: 'spark', tone: 'amber', title: 'Possibly answered on the results page', desc: 'Top-5 rankings with CTR under a third of what this site usually earns at that position. An AI Overview, answer box or intent mismatch may be taking the click; check the results page to confirm.', rows: ai.overview, tip: 'Open a few in Google. If an AI Overview appears, make sure your page is cited: lead with a short direct answer, use clear headings that mirror the question, and add original data the overview cannot summarise.', gain: true },
      { id: 'am', icon: 'alert', tone: 'red', title: 'AI Mode candidates', desc: 'Positions 1–3 with almost no clicks (under 0.5% CTR). Typical when a full AI answer replaces the results page.', rows: ai.aiMode, tip: 'These are the hardest to win back with titles alone. Aim to be a cited source: original data, clear definitions, and a named author with credentials.' },
      { id: 'zp', icon: 'ghost', tone: 'violet', title: 'Zero-click pages', desc: 'Page-one URLs with impressions but under 0.5% CTR.', rows: ai.zeroPages, tip: 'Check whether the page answers the query fully in the snippet. If so, add a reason to click: a tool, a download, a comparison table, or deeper detail.', page: true },
      { id: 'qs', icon: 'help', tone: 'indigo', title: 'Question searches', desc: 'The format AI answers and People Also Ask boxes draw from.', rows: ai.questions, tip: 'Answer each question in 40–60 words directly under a heading phrased as the question. Group related questions into an FAQ section with FAQPage markup.' },
      { id: 'cv', icon: 'chat', tone: 'teal', title: 'Conversational searches (7+ words)', desc: 'Long, natural-language searches — the way people prompt ChatGPT, Perplexity and Gemini.', rows: ai.conversational, tip: 'These show the follow-up questions your audience has. Cover them as sections of a pillar page rather than separate thin pages.' },
      { id: 'cp', icon: 'scale', tone: 'orange', title: 'Comparisons and alternatives', desc: 'Searches weighing two options. AI engines love citing structured comparison tables.', rows: ai.compare, tip: 'Give each comparison a table with clear criteria, a verdict, and who each option suits.' },
      { id: 'fr', icon: 'clock', tone: 'amber', title: 'Freshness-sensitive searches', desc: 'Queries with a year or words like “latest”. AI engines prefer recently updated sources.', rows: ai.fresh, tip: 'Show a visible “Updated on” date, refresh numbers each year, and include the year in the title where it fits.' },
      { id: 'sn', icon: 'trophy', tone: 'green', title: 'Holding position one', desc: 'Queries where you already rank first. These are your most likely AI citations — protect them.', rows: ai.snippets, tip: 'Keep these pages updated and fast. Add Organization and author markup so engines can attribute the answer to you.' }
    ];
    const cols = g => g.page ? [C.page, C.impr, C.clicks, C.ctr, C.pos] : g.gain ? [C.q, C.impr, C.clicks, C.ctr, C.pos, C.gain] : [C.q, C.impr, C.clicks, C.ctr, C.pos];
    const html = head('AEO & GEO signals', 'How your Search Console data reflects AI search: where answers are being taken from you, and which queries are shaped like prompts.') +
      `<div class="aitiles">
        <div class="aitile a-amber"><span>Answer box?</span><b>${ai.overview.length}</b><small>top-5 queries far below usual CTR</small></div>
        <div class="aitile a-red"><span>AI Mode</span><b>${ai.aiMode.length}</b><small>top-3 queries near zero clicks</small></div>
        <div class="aitile a-violet"><span>Zero-click</span><b>${ai.zeroPages.length}</b><small>page-one pages under 0.5% CTR</small></div>
        <div class="aitile a-blue"><span>vs benchmark</span><b>−${fmtN(ai.expectedGap)}</b><small>clicks / month below the industry CTR curve</small></div>
        <div class="aitile ${A.readiness >= 60 ? 'a-green' : A.readiness >= 35 ? 'a-amber' : 'a-red'}"><span>GEO ready</span><b>${A.readiness}%</b><small>AI search readiness</small></div>
      </div>
      <div class="stack">${groups.map(g => `
        <details class="acc" ${g.id === 'ov' ? 'open' : ''}>
          ${accHead(g.icon, g.tone, g.title, g.desc, g.page ? plural(g.rows.length, 'page', 'pages') : plural(g.rows.length, 'query', 'queries'))}
          <div class="acc-tip"><b>What to do:</b> ${esc(g.tip)}</div>
          ${table('t-ai-' + g.id, cols(g), g.rows, { sort: g.gain ? 'gain' : 'impr', file: 'ai-' + g.id, pageSize: 25, searchKeys: g.page ? ['path'] : ['q'] })}
        </details>`).join('')}</div>
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

  const TIER_ICON = { carry: ['rocket', 'green'], strong: ['star', 'indigo'], steady: ['file', 'teal'], tail: ['down', 'amber'], ghost: ['ghost', 'red'] };
  V.pages = (A) => {
    const html = head('Pages', 'Pages grouped by how much they carry, relative to the rest of your site.') +
      `<div class="strip">${A.tiers.map(t => stat(t.n.toLocaleString(), t.label, t.key === 'carry' ? 'gain' : t.key === 'ghost' ? 'risk' : '')).join('')}</div>
      <div class="stack">${A.tiers.map((t, i) => `
        <details class="acc" ${i === 0 ? 'open' : ''}>
          ${accHead(TIER_ICON[t.key][0], TIER_ICON[t.key][1], t.label, t.desc, t.n.toLocaleString() + ' pages · ' + fmtN(t.clicks) + ' clicks')}
          ${table('t-pg-' + t.key, [C.page, C.clicks, C.impr, C.ctr, C.pos], t.rows, { sort: t.key === 'ghost' ? 'impr' : 'clicks', file: 'pages-' + t.key, searchKeys: ['path'], pageSize: 25, placeholder: 'Filter pages' })}
        </details>`).join('')}</div>`;
    return { html, mount: () => A.tiers.forEach(t => drawTable('t-pg-' + t.key)) };
  };

  V.sections = (A) => {
    const list2 = A.sections2;
    const html = head('Site clusters', 'Your URLs grouped into clusters by folder, built automatically from your site structure. Position is weighted by impressions.') +
      `<section class="panel"><div class="panel-h"><h2>Top-level folders</h2><p>Click any folder to open its pages, sub-folders and queries. Strong: top-5 and clicked well. Steady: page one, normal CTR. Fix CTR: ranks but under-clicked. Needs work: mostly page two.</p></div><div class="panel-b cards-wrap">${sectionCards(A.sections1)}</div></section>
       <section class="panel"><div class="panel-h"><h2>Second-level folders</h2><p>Finer breakdown, useful for large sections like /blog/ or /products/.</p></div>
       ${table('t-sec', [{ k: 'key', l: 'Section', cls: 'u', f: r => `<a href="#section=${encodeURIComponent(r.key)}">${esc(r.key)}</a>` }, { k: 'n', l: 'Pages', r: 1 }, C.clicks, C.impr, C.ctr, C.pos], list2, { sort: 'clicks', file: 'sections', placeholder: 'Filter sections' })}</section>`;
    return { html, mount: () => drawTable('t-sec') };
  };


  // ── Folder deep dive ──
  // Same rule and same expected CTR (the site's own curve) as the Site clusters list in engine.js.
  function statusOf(a, A) { const b = A.curve.at(a.pos); return a.pos > 10 ? 'work' : a.ctr < b * 0.6 ? 'ctr' : a.pos <= 5 && a.ctr >= b * 0.8 ? 'strong' : 'steady'; }
  const segsOf = path => path.split('/').filter(Boolean);
  V.section = (A, D, key) => {
    const agg = window.CW.agg;
    const depth = segsOf(key).length;
    const inSec = r => key === '/' ? r.path === '/' : (r.path === key.replace(/\/$/, '') || r.path.startsWith(key));
    const pages = A.P.filter(inSec).sort((a, b) => b.clicks - a.clicks);
    if (!pages.length) return { html: head('Folder not found', `No pages under ${esc(key)} in this data.`) + '<p><a href="#sections">Back to all clusters</a></p>' };
    const tot = agg(pages); const status = statusOf(tot, A);
    const urlSet = new Set(pages.map(r => r.p));

    // sub-folders one level down; pages sitting directly in this folder stay in the page list
    const kids = new Map();
    pages.forEach(r => {
      const sg = segsOf(r.path);
      if (sg.length > depth + 1) { const k = '/' + sg.slice(0, depth + 1).join('/') + '/'; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(r); }
    });
    const sub = [...kids.entries()].map(([k, rows]) => { const a = agg(rows); return { key: k, rows, ...a, status: statusOf(a, A) }; }).sort((a, b) => b.clicks - a.clicks);

    // previous period for this folder
    let prevTot = null;
    if (D.prevP && D.prevP.length) {
      const pp = D.prevP.filter(r => inSec({ path: window.CW.pathOf(r.p) }));
      if (pp.length) prevTot = agg(pp);
    }

    // queries that land on this folder (needs query × page data)
    let topQ = [];
    if (D.QP && D.QP.length) {
      const m = new Map();
      const isB = q => A.BQ.some(b => b.q === q);
      D.QP.forEach(r => { if (!urlSet.has(r.p)) return; const o = m.get(r.q) || { q: r.q, clicks: 0, impr: 0, posW: 0 }; o.clicks += r.clicks; o.impr += r.impr; o.posW += r.pos * r.impr; m.set(r.q, o); });
      topQ = [...m.values()].map(o => ({ q: o.q, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.posW / Math.max(1, o.impr), brand: isB(o.q) })).sort((a, b) => b.clicks - a.clicks);
    }
    const ctrHere = A.ctrPages.filter(r => urlSet.has(r.p));
    const decayHere = A.decay ? A.decay.pages.filter(r => urlSet.has(r.p)) : [];
    const qwHere = topQ.length ? A.quickWins.filter(q => topQ.some(t => t.q === q.q)) : [];

    // breadcrumb
    const sg = segsOf(key);
    const crumbs = [`<a href="#sections">All clusters</a>`].concat(sg.map((s2, i) => {
      const k = '/' + sg.slice(0, i + 1).join('/') + '/';
      return i === sg.length - 1 ? `<span>${esc(s2)}</span>` : `<a href="#section=${encodeURIComponent(k)}">${esc(s2)}</a>`;
    })).join('<span class="sep">/</span>');

    const d = (cur, prev, inv, unit) => prev ? tileDelta(cur, prev, inv, unit) : '';
    const html = `
      <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
      <header class="v-head sec-head"><h1>${esc(key)}</h1><span class="badge b-${status}">${STATUS[status]}</span>
        <p>${pages.length.toLocaleString()} page${pages.length === 1 ? '' : 's'}${sub.length ? ` in ${sub.length} sub-folder${sub.length === 1 ? '' : 's'}` : ''}. ${prevTot ? 'Changes compare with the previous period.' : ''}</p></header>

      <section class="tiles" aria-label="Folder performance">
        <div class="tile t-blue"><div class="tile-v">${fmtN(tot.clicks)}</div><div class="tile-l">Clicks</div><div class="tile-s">${(tot.clicks / Math.max(1, A.P.reduce((s3, r) => s3 + r.clicks, 0)) * 100).toFixed(1)}% of all page clicks</div>${d(tot.clicks, prevTot && prevTot.clicks)}</div>
        <div class="tile t-green"><div class="tile-v">${fmtN(tot.impr)}</div><div class="tile-l">Impressions</div><div class="tile-s">${pages.length} pages</div>${d(tot.impr, prevTot && prevTot.impr)}</div>
        <div class="tile t-amber"><div class="tile-v">${pctf(tot.ctr, 2)}</div><div class="tile-l">CTR</div><div class="tile-s">Expected ~${A.curve.at(tot.pos).toFixed(1)}% at this position</div>${d(tot.ctr, prevTot && prevTot.ctr, false, 'pt')}</div>
        <div class="tile t-red"><div class="tile-v">${tot.pos.toFixed(1)}</div><div class="tile-l">Avg. position</div><div class="tile-s">Weighted by impressions</div>${d(tot.pos, prevTot && prevTot.pos, true)}</div>
      </section>

      ${sub.length ? `<section class="panel"><div class="panel-h"><h2>Sub-folders</h2><p>Click to go one level deeper.</p></div><div class="panel-b cards-wrap">${sectionCards(sub)}</div></section>` : ''}

      ${(ctrHere.length || decayHere.length || qwHere.length) ? `<div class="stack">
        ${ctrHere.length ? `<details class="acc" open>${accHead('pulse', 'amber', 'Titles to rewrite in this folder', 'Page-one pages earning well below benchmark CTR.', plural(ctrHere.length, 'page', 'pages'))}${table('t-sx-ctr', [C.page, C.impr, C.clicks, C.ctr, C.bench, C.pos, C.gain], ctrHere, { sort: 'gain', file: 'folder-titles', searchKeys: ['path'], pageSize: 10 })}</details>` : ''}
        ${qwHere.length ? `<details class="acc">${accHead('bolt', 'orange', 'Almost page one', 'Queries landing here that rank 4–20.', plural(qwHere.length, 'query', 'queries'))}${table('t-sx-qw', [C.q, C.impr, C.clicks, C.ctr, C.pos, C.gain], qwHere, { sort: 'gain', file: 'folder-quick-wins', pageSize: 10 })}</details>` : ''}
        ${decayHere.length ? `<details class="acc">${accHead('down', 'red', 'Losing ground', 'Pages here that lost at least 25% of clicks.', plural(decayHere.length, 'page', 'pages'))}${table('t-sx-dec', [C.page, { k: 'prevC', l: 'Clicks before', r: 1, f: r => fmtN(r.prev.clicks), csv: r => r.prev.clicks }, { k: 'curC', l: 'Clicks now', r: 1, f: r => fmtN(r.cur.clicks), csv: r => r.cur.clicks }, { k: 'ch', l: 'Change', r: 1, f: r => `<span class="lossv">${r.ch.toFixed(0)}%</span>` }, { k: 'reason', l: 'Likely cause', sort: false }], decayHere.map(r => ({ ...r, prevC: r.prev.clicks, curC: r.cur.clicks })), { sort: 'lost', file: 'folder-decay', searchKeys: ['path'], pageSize: 10 })}</details>` : ''}
      </div>` : ''}

      <section class="panel"><div class="panel-h"><h2>All URLs in ${esc(key)}</h2><p>Every page under this folder, including sub-folders.</p></div>
        ${table('t-sx-pages', [C.page, C.clicks, C.impr, C.ctr, C.pos], pages, { sort: 'clicks', file: 'folder-pages', searchKeys: ['path'], placeholder: 'Filter URLs' })}</section>

      <section class="panel"><div class="panel-h"><h2>Queries landing here</h2><p>${topQ.length ? 'Searches that sent impressions to pages in this folder.' : 'Connect Search Console to see which searches land on this folder (file exports don\'t include query-to-page data).'}</p></div>
        ${topQ.length ? table('t-sx-q', [C.q, C.clicks, C.impr, C.ctr, C.pos, { k: 'brand', l: 'Type', f: r => r.brand ? '<span class="tag watch">Branded</span>' : '<span class="tag">Non-branded</span>', csv: r => r.brand ? 'Branded' : 'Non-branded' }], topQ, { sort: 'clicks', file: 'folder-queries', placeholder: 'Filter queries' }) : ''}</section>`;
    const mount = () => ['t-sx-ctr', 't-sx-qw', 't-sx-dec', 't-sx-pages', 't-sx-q'].forEach(drawTable);
    return { html, mount };
  };

  V.intent = (A) => {
    const list = A.intents.filter(i => i.n);
    const html = head('Search intent', 'Every query sorted by what the searcher wants: to learn, to compare, to act, or to find you.') +
      `<div class="grid-2"><section class="panel"><div class="panel-h"><h2>Clicks by intent</h2></div><div class="panel-b"><div class="chart-box"><canvas id="ch-intent" aria-label="Clicks and impressions by intent"></canvas></div></div></section>
       <section class="panel"><div class="panel-h"><h2>Summary</h2></div><div class="panel-b flush"><table><thead><tr><th>Intent</th><th class="r">Queries</th><th class="r">CTR</th><th class="r">Position</th></tr></thead><tbody>${list.map(i => `<tr><td>${esc(i.label)}</td><td class="r">${i.n.toLocaleString()}</td><td class="r">${pctf(i.ctr)}</td><td class="r">${posTag(i.pos)}</td></tr>`).join('')}</tbody></table></div></section></div>
       <div class="stack">${list.map((i, k) => `
        <details class="acc" ${k === 0 ? 'open' : ''}>${accHead(INTENT_ICON[i.key][0], INTENT_ICON[i.key][1], i.label, INTENT_HELP[i.key], i.n.toLocaleString() + ' queries · ' + fmtN(i.clicks) + ' clicks')}
        ${table('t-in-' + i.key, [C.q, C.clicks, C.impr, C.ctr, C.pos], i.rows, { sort: 'impr', file: 'intent-' + i.key, pageSize: 25 })}</details>`).join('')}</div>`;
    const mount = () => {
      list.forEach(i => drawTable('t-in-' + i.key));
      chart('ch-intent', { type: 'bar', data: { labels: list.map(i => i.label), datasets: [{ label: 'Clicks', data: list.map(i => i.clicks), backgroundColor: cssVar('--signal'), borderRadius: 4 }, { label: 'Impressions ÷ 10', data: list.map(i => i.impr / 10), backgroundColor: cssVar('--sky-soft'), borderColor: cssVar('--sky'), borderWidth: 1, borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmtN(v) } } } } });
    };
    return { html, mount };
  };
  const INTENT_ICON = { info: ['book', 'indigo'], comm: ['scale', 'orange'], trans: ['cart', 'green'], nav: ['star', 'violet'], other: ['compass', 'teal'] };
  const INTENT_HELP = { info: 'Learning: questions, guides, how-tos. Build depth and answer directly.', comm: 'Comparing options: best, top, reviews, vs. Lists and comparison pages win here.', trans: 'Ready to act: price, buy, book, download. Send these to pages with a clear next step.', nav: 'Looking for you by name. Track as brand demand, not SEO performance.', other: 'No clear signal. Often short head terms; check what the ranking page offers.' };

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const t = document.getElementById(b.dataset.copy).textContent;
    const label = b.dataset.label || (b.dataset.label = b.textContent);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = label, 1500); }).catch(() => { b.textContent = 'Select and copy manually'; });
  });

  window.CW_VIEWS = { V, destroyCharts, esc, ui: { table, drawTable, TABLES, C, head, stat, ledger, accHead, svg, ICON, pctf, posTag, urlCell, serp, gainCell, range, methodNote, tileDelta, chart, cssVar } };
})();

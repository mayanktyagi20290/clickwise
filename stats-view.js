// Clickwise "Statistics & Trends" screen (#stats): its own page, separate from the Command Center.
// Data: Search Console when signed in (up to 16 months of daily totals, plus searches and pages for the chosen
// period and its comparison), the uploaded export (only the dates it contains), or the fictional sample site
// (labelled as sample everywhere). Calculations live in stats.js. Nothing fetched here is stored.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, chart, cssVar, pctf, urlCell, serp } = ui;
  const ST = window.CW_STATS, CW = window.CW, fmtN = CW.fmtN;

  const CACHE = new Map();
  const src = () => window.CW_SOURCE || { kind: 'file' };
  const isOn = () => (location.hash.slice(1) || '').split('?')[0] === 'stats';
  const rerender = () => { if (isOn()) window.dispatchEvent(new HashChangeEvent('hashchange')); };
  function load(key, fn) {
    if (!CACHE.has(key)) {
      CACHE.set(key, { status: 'loading' });
      fn().then(data => { CACHE.set(key, { status: 'done', data }); rerender(); }, err => { CACHE.set(key, { status: 'error', err: err.message || String(err) }); rerender(); });
    }
    return CACHE.get(key);
  }
  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const go = changes => { const p = params(); Object.entries(changes).forEach(([k, v]) => v == null ? p.delete(k) : p.set(k, v)); location.hash = '#stats?' + p.toString(); };
  const baseKey = D => [src().kind, D.siteUrl || D.site, D.scope || '', (D.filters || {}).device || '', (D.filters || {}).type || 'web'].join('|');
  const rowsOf = (res, key) => (res && res.rows || []).map(r => ({ [key]: r.keys[0], clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position }));

  // ── data access, one shape for every source ──
  function history(D) {
    const S = src();
    if (S.kind === 'api') {
      const end = S.latest, start = ST.add(end, -485);
      return load(baseKey(D) + '|hist|' + end, () => S.gsc.query({ startDate: start, endDate: end, dimensions: ['date'], type: S.gsc.type, rowLimit: 1000 })
        .then(d => ({ rows: rowsOf(d, 'd'), requested: { start, end } })));
    }
    if (S.kind === 'demo') return { status: 'done', data: { rows: ST.demoHistory(D.C || []), sample: true } };
    return { status: 'done', data: { rows: (D.prevC || []).concat(D.C || []), file: true } };
  }
  // searches or pages for one period: { rows, capped } or null when this source does not have them
  const LIMIT = 50000;
  function periodRows(D, dim, s, e) {
    const S = src(), key = dim === 'query' ? 'q' : 'p';
    if (S.kind === 'api') {
      return load(`${baseKey(D)}|${dim}|${s}|${e}`, async () => {
        const out = [];
        for (let startRow = 0; startRow < LIMIT; startRow += 25000) {
          const d = await S.gsc.query({ startDate: s, endDate: e, dimensions: [dim], type: S.gsc.type, rowLimit: 25000, startRow });
          const r = rowsOf(d, key); out.push(...r);
          if (r.length < 25000) return { rows: out, capped: false };
        }
        return { rows: out, capped: true };
      });
    }
    if (s === D.start && e === D.end) return { status: 'done', data: { rows: dim === 'query' ? D.Q : D.P, capped: D.source === 'file' && (dim === 'query' ? D.Q : D.P).length >= 999 } };
    if (D.prevStart && s === D.prevStart && e === D.prevEnd && (dim === 'query' ? D.prevQ : D.prevP)) return { status: 'done', data: { rows: dim === 'query' ? D.prevQ : D.prevP, capped: (D.source === 'file' && (dim === 'query' ? D.prevQ : D.prevP).length >= 999) } };
    return { status: 'none' };
  }

  // ── small render helpers ──
  const sgn = (v, dp) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(dp == null ? (Math.abs(v) < 10 ? 1 : 0) : dp);
  // a change badge; for position a fall is good
  function chg(v, unit, invert, title) {
    if (v == null || !isFinite(v)) return `<span class="st-chg na" title="${esc(title || 'No comparison data')}">n/a</span>`;
    const good = invert ? v < 0 : v > 0, flat = Math.abs(v) < (unit === 'pos' ? 0.05 : 0.05);
    const txt = unit === 'pt' ? sgn(v, 2) + ' pts' : unit === 'pos' ? sgn(v, 1) : sgn(v) + '%';
    return `<span class="st-chg ${flat ? 'flat' : good ? 'good' : 'bad'}"${title ? ` title="${esc(title)}"` : ''}>${flat ? '±0' : (v > 0 ? '▲ ' : '▼ ') + txt.replace(/^[+-]/, '')}</span>`;
  }
  const fmtD = s => { const [y, m, d] = s.split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };
  const rng = (a, b) => `${fmtD(a)} – ${fmtD(b)}`;
  const pathOf = u => CW.pathOf(u);
  const brandTest = D => { try { const s = JSON.parse(localStorage.getItem('cw:site:' + D.site)); return s && s.brand && s.brand.length ? CW.makeBrandTest(s.brand) : null; } catch (e) { return null; } };

  // the page has two tabs: Trends (this file) and Best day & time (timing-view.js)
  const tabs = on => `<div class="st-pagetabs" role="tablist" aria-label="Statistics views"><a role="tab" href="#stats" class="${on === 'trends' ? 'on' : ''}" aria-selected="${on === 'trends'}">Trends</a><a role="tab" href="#stats?tab=timing" class="${on === 'timing' ? 'on' : ''}" aria-selected="${on === 'timing'}">Best day &amp; time</a></div>`;
  V.stats = (A, D) => {
    if (params().get('tab') === 'timing' && window.CW_TIMINGVIEW) return window.CW_TIMINGVIEW.render(A, D);
    const S = src();
    const title = 'Statistics & Trends';
    const sub = 'Your search performance over time: totals for any period, week-on-week, month-on-month and year-on-year changes, trends, and what moved.';
    const H0 = history(D);
    if (H0.status === 'loading') return { html: head(title, sub) + '<section class="panel"><p class="empty sv-loading">Fetching up to 16 months of daily totals from Search Console…</p></section>' };
    if (H0.status === 'error') return { html: head(title, sub) + `<div class="note warn">Search Console did not return the daily history: ${esc(H0.err)}</div><button type="button" class="btn-quiet" id="st-retry">Try again</button>`, mount: () => document.getElementById('st-retry').addEventListener('click', () => { [...CACHE.keys()].forEach(k => CACHE.get(k).status === 'error' && CACHE.delete(k)); rerender(); }) };
    const H = ST.index(H0.data.rows);
    if (!H.first) return { html: head(title, sub) + `<section class="panel"><p class="empty">${S.kind === 'file' ? 'This export has no Dates sheet, so there are no daily totals to chart. Export again from Search Console with the Dates tab, or connect Search Console.' : 'No daily data for this property and filter.'}</p></section>` };

    // ── selection from the address (so refresh and shared links keep it) ──
    const p = params();
    const cmpMode = p.get('cmp') === 'yoy' ? 'yoy' : 'prev';
    let rangeKey = p.get('range') || '90', sel;
    if (rangeKey === 'custom') sel = ST.clampRange(H, p.get('from'), p.get('to'));
    else { const n = +rangeKey; sel = ST.PRESETS.some(([d]) => d === n) ? ST.presetRange(H, n) : ST.presetRange(H, 90); if (!sel.available) sel = { ...ST.clampRange(H, sel.start, sel.end), shortened: true, want: n }; }
    // weekly by default for short ranges (months would mostly be partial), monthly for longer ones
    const g = ['week', 'month', 'quarter'].includes(p.get('g')) ? p.get('g') : sel.days <= 120 ? 'week' : 'month';
    const C = ST.comparisons(H, sel);
    const cur = ST.period(H, sel.start, sel.end);
    const prev = C.prev.available ? ST.period(H, C.prev.start, C.prev.end) : null;
    const yoy = C.yoy.available ? ST.period(H, C.yoy.start, C.yoy.end) : null;
    const base = cmpMode === 'yoy' ? yoy : prev, baseR = cmpMode === 'yoy' ? C.yoy : C.prev;
    const baseLabel = cmpMode === 'yoy' ? 'the same dates last year' : 'the previous period';
    // last year's previous period, to tell seasonal movement from new movement
    const lyPrev = yoy && ST.covered(H, ST.yearAgo(C.prev.start), ST.yearAgo(C.prev.end)) ? ST.period(H, ST.yearAgo(C.prev.start), ST.yearAgo(C.prev.end)) : null;
    const bks = ST.buckets(H, sel, g);
    const months = ST.buckets(H, sel, 'month'), weeks = ST.buckets(H, sel, 'week');
    const std = ST.standard(H);

    // searches and pages for the selection and its comparison
    const qCur = periodRows(D, 'query', sel.start, sel.end), pCur = periodRows(D, 'page', sel.start, sel.end);
    const qBase = baseR.available ? periodRows(D, 'query', baseR.start, baseR.end) : { status: 'none', reason: 'nobase' };
    const pBase = baseR.available ? periodRows(D, 'page', baseR.start, baseR.end) : { status: 'none', reason: 'nobase' };
    const ready = x => x.status === 'done';
    const bCur = ready(qCur) ? ST.breadth(qCur.data.rows, qCur.data.capped) : null;
    const bBase = ready(qBase) ? ST.breadth(qBase.data.rows, qBase.data.capped) : null;
    const bPrev = cmpMode === 'prev' ? bBase : (C.prev.available ? (r => ready(r) ? ST.breadth(r.data.rows, r.data.capped) : null)(periodRows(D, 'query', C.prev.start, C.prev.end)) : null);
    const bYoy = cmpMode === 'yoy' ? bBase : null;
    const movP = ready(pCur) && ready(pBase) ? ST.movers(pCur.data.rows.map(r => ({ ...r, path: pathOf(r.p) })), pBase.data.rows, 'p', { curCapped: pCur.data.capped, baseCapped: pBase.data.capped, n: 15, min: 3 }) : null;
    const movQ = ready(qCur) && ready(qBase) ? ST.movers(qCur.data.rows, qBase.data.rows, 'q', { curCapped: qCur.data.capped, baseCapped: qBase.data.capped, n: 15, min: 3 }) : null;
    if (movP) [movP.winners, movP.losers].forEach(l => l.forEach(r => { r.path = pathOf(r.p); }));

    const sample = S.kind === 'demo';
    const srcLabel = S.kind === 'api' ? 'Live · Search Console (read-only)' : sample ? 'Sample data · fictional site' : 'Uploaded export';
    const loadingRows = [qCur, pCur, qBase, pBase].some(x => x.status === 'loading');
    const rowsNote = qCur.status === 'none' ? (S.kind === 'file' ? `This export holds searches and pages for ${rng(D.start, D.end)} only${D.prevStart ? ` and ${rng(D.prevStart, D.prevEnd)}` : ''}. Choose those dates to compare searches and pages, or connect Search Console for any range.` : `The sample site has searches and pages for its loaded 3 months and the 3 months before. Choose “3 months” and “previous period” to see them.`) : '';

    // ── controls ──
    const presetBtns = ST.PRESETS.map(([d, l]) => { const r = ST.presetRange(H, d); const on = rangeKey === String(d); return `<button type="button" data-st-range="${d}" class="${on ? 'on' : ''}"${r && !r.available ? ` title="Only ${ST.diff(H.first, H.last) + 1} days of history: ${l} is shortened to what exists"` : ''}>${esc(l)}${r && !r.available ? '*' : ''}</button>`; }).join('');
    const controls = `<div class="st-bar">
      <div class="seg st-range" role="group" aria-label="Date range">${presetBtns}<button type="button" data-st-custom class="${rangeKey === 'custom' ? 'on' : ''}">Custom</button></div>
      <div class="seg" role="group" aria-label="Report by">${[['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly']].map(([k, l]) => `<button type="button" data-st-g="${k}" class="${g === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Compare with">${[['prev', 'vs previous period'], ['yoy', 'vs last year']].map(([k, l]) => `<button type="button" data-st-cmp="${k}" class="${cmpMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button type="button" class="btn-quiet st-export" id="st-export">Export report (CSV)</button>
    </div>
    <form class="st-custom" id="st-custom" ${rangeKey === 'custom' ? '' : 'hidden'}>
      <label class="field"><span>From</span><input type="date" name="from" value="${sel.start}" min="${H.first}" max="${H.last}" required></label>
      <label class="field"><span>To</span><input type="date" name="to" value="${sel.end}" min="${H.first}" max="${H.last}" required></label>
      <button class="btn-primary sm" type="submit">Apply</button>
    </form>`;
    const notes = [];
    notes.push(`<b>${esc(srcLabel)}</b>${D.scope ? ` · ${esc(D.scope)}` : ''}${(D.filters || {}).device ? ` · ${esc(D.filters.device.toLowerCase())} only` : ''}${(D.filters || {}).type && D.filters.type !== 'web' ? ` · ${esc(D.filters.type)} search` : ''}`);
    notes.push(`Selected: <b>${rng(sel.start, sel.end)}</b> (${sel.days} days)`);
    notes.push(`History available: ${rng(H.first, H.last)}${S.kind === 'api' ? ' · final data only; Search Console keeps about 16 months' : ''}`);
    const warn = [];
    if (sel.shortened) warn.push(`Only ${ST.diff(H.first, H.last) + 1} days of history exist, so the ${sel.want}-day range was shortened to start on ${fmtD(H.first)}.`);
    if (!C.prev.available) warn.push('No previous-period comparison: the period before this selection is outside the available history.');
    if (!C.yoy.available) warn.push(`No year-on-year comparison: ${rng(C.yoy.start, C.yoy.end)} is ${C.yoy.end < H.first ? 'before' : 'only partly inside'} the available history${S.kind === 'api' ? ' (Search Console keeps about 16 months)' : ''}.`);
    if (cmpMode === 'yoy' && !C.yoy.available) warn.push('Showing the selection without a comparison.');
    if (bks.some(b => b.partial)) warn.push(`Partial periods are marked: ${bks.filter(b => b.partial).map(b => `${b.label} (${b.why})`).slice(0, 3).join('; ')}.`);
    if (sample) warn.push('Sample data: the 3 most recent months are the sample site’s loaded data; earlier months are generated from a fixed pattern so the trend tools can be tried. None of it is real.');

    // ── KPI cards ──
    const kpi = (cls, label, value, vPrev, vYoy, unit, invert, hint) => `<div class="st-kpi ${cls}"><span class="st-kl">${label}</span><b>${value}</b>
      <div class="st-kc"><span>vs previous ${chg(vPrev, unit, invert, prev ? rng(C.prev.start, C.prev.end) : 'Previous period outside the history')}</span><span>YoY ${chg(vYoy, unit, invert, yoy ? rng(C.yoy.start, C.yoy.end) : 'Same dates last year outside the history')}</span></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
    const dp = ST.delta(cur, prev), dy = ST.delta(cur, yoy);
    const bc = (b, k) => b ? b[k] : null;
    const bd = (a, b2, k) => a && b2 && b2[k] ? (a[k] - b2[k]) / b2[k] * 100 : null;
    const loadingTxt = '<span class="flat">loading…</span>';
    const breadthVal = (k) => bCur ? fmtN(bCur[k]) + (bCur.capped ? '+' : '') : qCur.status === 'loading' ? loadingTxt : qCur.status === 'error' ? '<span class="flat">error</span>' : '<span class="flat">n/a</span>';
    const kpis = `<section class="st-kpis" aria-label="Totals for the selected period">
      ${kpi('k-blue', 'Organic clicks', fmtN(cur.clicks), dp && dp.clicks, dy && dy.clicks, '%', false)}
      ${kpi('k-green', 'Impressions', fmtN(cur.impr), dp && dp.impr, dy && dy.impr, '%', false)}
      ${kpi('k-amber', 'CTR', pctf(cur.ctr, 2), dp && dp.ctr, dy && dy.ctr, 'pt', false, 'total clicks ÷ total impressions')}
      ${kpi('k-red', 'Average position', cur.pos != null ? cur.pos.toFixed(1) : '—', dp && dp.pos, dy && dy.pos, 'pos', true, 'weighted by impressions')}
      ${kpi('k-violet', 'Ranking queries', breadthVal('ranking'), bd(bCur, bPrev, 'ranking'), bd(bCur, bYoy, 'ranking'), '%', false, bCur ? 'searches with impressions; private queries excluded' : qCur.status === 'none' ? 'not in this data for these dates' : '')}
      ${kpi('k-teal', 'Top 10 rankings', breadthVal('top10'), bd(bCur, bPrev, 'top10'), bd(bCur, bYoy, 'top10'), '%', false, bCur ? `searches at average position ≤ 10${bCur.capped ? '; list capped, so a lower bound' : ''}` : '')}
    </section>`;

    // ── WoW / MoM / YoY ──
    const stdCard = s => {
      if (!s) return '';
      const d = s.available ? ST.delta(s.cur, s.base) : null;
      const m = (l, v, c) => `<div class="st-sm"><span>${l}</span><b>${v}</b>${c}</div>`;
      return `<div class="st-std-c"><h3>${esc(s.label)}</h3><p class="flat">${rng(s.cur.start, s.cur.end)}<br>vs ${s.available ? rng(s.baseRange.start, s.baseRange.end) : esc(s.baseLabel)}</p>
        ${s.available ? `<div class="st-sms">${m('Clicks', fmtN(s.cur.clicks), chg(d.clicks, '%'))}${m('Impressions', fmtN(s.cur.impr), chg(d.impr, '%'))}${m('CTR', pctf(s.cur.ctr, 2), chg(d.ctr, 'pt'))}${m('Avg. position', s.cur.pos != null ? s.cur.pos.toFixed(1) : '—', chg(d.pos, 'pos', true))}</div>`
          : `<p class="empty st-na">Not available: ${esc(s.baseLabel)} is outside the available history.</p>`}</div>`;
    };
    const stdHtml = std ? `<section class="panel"><div class="panel-h"><h2>Week on week, month on month, year on year</h2><p>Always the last complete week (Monday–Sunday) and the last complete calendar month with final data, whatever range is selected above.</p></div>
      <div class="panel-b st-std">${stdCard(std.wow)}${stdCard(std.mom)}${stdCard(std.yoy)}</div></section>` : '';

    // ── charts ──
    const gName = { week: 'week', month: 'month', quarter: 'quarter' }[g];
    const charts = `<div class="grid-2 even st-charts">
      <section class="panel"><div class="panel-h"><h2>Traffic trend</h2><p>Clicks and impressions by ${gName}${bks.some(b => b.yoy) ? '; the dashed line is clicks for the same ' + gName + ' a year earlier' : ''}. Lighter bars are partial ${gName}s. Click a legend item to hide it.</p></div>
        <div class="panel-b"><div class="chart-box st-cb"><canvas id="st-ch-traffic" aria-label="Clicks and impressions by ${gName}"></canvas></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Ranking trend</h2><p>Average position (left axis, lower is better) and CTR by ${gName}.</p></div>
        <div class="panel-b"><div class="chart-box st-cb"><canvas id="st-ch-rank" aria-label="Average position and CTR by ${gName}"></canvas></div>
        ${breadthTrend(D, H, sel, g)}</div></section>
    </div>`;

    // ── monthly summary and weekly breakdown ──
    const perCols = (label, unitWord) => [
      { k: 'start', l: label, f: r => `${esc(r.label)}${r.partial ? ` <span class="tag watch" title="${esc(r.why)}">partial</span>` : ''}`, csv: r => r.label + (r.partial ? ' (partial: ' + r.why + ')' : '') },
      { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) },
      { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) },
      { k: 'ctr', l: 'CTR', r: 1, f: r => pctf(r.ctr, 2) },
      { k: 'pos', l: 'Avg. position', r: 1, f: r => r.pos != null ? r.pos.toFixed(1) : '—', csv: r => r.pos != null ? r.pos.toFixed(2) : '' },
      { k: 'chg', l: unitWord + ' change (clicks)', r: 1, f: r => chg(r.before ? ST.pct(r.clicks, r.before.clicks) : null, '%', false, r.partial ? 'Partial period: not compared' : r.before ? '' : 'Previous period outside history'), csv: r => r.before ? (ST.pct(r.clicks, r.before.clicks) || 0).toFixed(1) + '%' : '' },
      { k: 'yoyc', l: 'YoY (clicks)', r: 1, f: r => chg(r.yoy ? ST.pct(r.clicks, r.yoy.clicks) : null, '%', false, r.partial ? 'Partial period: not compared' : r.yoy ? '' : 'Same period last year outside history'), csv: r => r.yoy ? (ST.pct(r.clicks, r.yoy.clicks) || 0).toFixed(1) + '%' : '' },
      { k: 'haveDays', l: 'Days', r: 1, f: r => `${r.haveDays}${r.partial ? '/' + r.fullDays : ''}`, csv: r => r.haveDays }
    ];
    const months2 = months.map(r => ({ ...r, chg: r.before ? ST.pct(r.clicks, r.before.clicks) : null, yoyc: r.yoy ? ST.pct(r.clicks, r.yoy.clicks) : null }));
    const weeks2 = weeks.map(r => ({ ...r, chg: r.before ? ST.pct(r.clicks, r.before.clicks) : null, yoyc: r.yoy ? ST.pct(r.clicks, r.yoy.clicks) : null }));
    const tablesHtml = `<section class="panel"><div class="panel-h"><h2>Monthly performance summary</h2><p>Every calendar month in the selection. Month-on-month and year-on-year changes are shown only for complete months whose comparison month is inside the history.</p></div>
        ${table('t-st-month', perCols('Month', 'MoM'), months2, { sort: 'start', file: 'monthly-summary', search: false, pageSize: 20 })}</section>
      <section class="panel"><div class="panel-h"><h2>Weekly breakdown</h2><p>Monday-to-Sunday weeks in the selection (${weeks.length}). Week-on-week change compares each complete week with the one before.</p></div>
        ${table('t-st-week', perCols('Week', 'WoW'), weeks2, { sort: 'start', file: 'weekly-breakdown', search: false, pageSize: 26 })}</section>`;

    // ── winners and losers ──
    const wl = (mov, key, kind) => {
      if (!mov) return '';
      const cols = [key === 'p' ? { k: 'path', l: 'Page', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p } : { k: 'q', l: 'Search', cls: 'q', f: r => serp(r.q) },
        { k: 'prev', l: 'Before', r: 1, f: r => fmtN(r.prev) }, { k: 'clicks', l: 'Now', r: 1, f: r => fmtN(r.clicks) },
        { k: 'd', l: 'Change', r: 1, f: r => `<b class="${r.d >= 0 ? 'gainv' : 'lossv'}">${r.d > 0 ? '+' : ''}${fmtN(r.d)}</b>${r.ch != null ? ` <small class="flat">${sgn(r.ch)}%</small>` : ''}`, csv: r => r.d },
        { k: 'why', l: 'What changed', sort: false, f: r => `<small>${esc(ST.moverWhy(r))}${r.uncertain ? ' <span class="tag watch" title="One list reached its row limit, so this row may only have dropped below it">uncertain</span>' : ''}</small>`, csv: r => ST.moverWhy(r) + (r.uncertain ? ' (uncertain: row limit)' : '') }];
      return `<div class="st-wl"><div><h3 class="st-h3 gainv">Winners</h3>${table(`t-st-w${key}`, cols, mov.winners, { sort: 'd', file: `${kind}-winners`, search: false, pageSize: 15, empty: 'No gains.' })}</div>
        <div><h3 class="st-h3 lossv">Losers</h3>${table(`t-st-l${key}`, cols, mov.losers, { sort: 'd', dir: 1, file: `${kind}-losers`, search: false, pageSize: 15, empty: 'No losses.' })}</div></div>`;
    };
    const tab = p.get('wl') === 'q' ? 'q' : 'p';
    let wlBody;
    if (!baseR.available) wlBody = `<p class="empty">No ${cmpMode === 'yoy' ? 'year-on-year' : 'previous-period'} data to compare with for this selection.</p>`;
    else if (qCur.status === 'none' || pCur.status === 'none' || qBase.status === 'none') wlBody = `<p class="empty">${esc(rowsNote || 'Searches and pages are not available for these dates.')}</p>`;
    else if (loadingRows) wlBody = '<p class="empty sv-loading">Fetching searches and pages for both periods…</p>';
    else if ([qCur, pCur, qBase, pBase].some(x => x.status === 'error')) wlBody = `<p class="empty">Search Console did not return searches or pages: ${esc(([qCur, pCur, qBase, pBase].find(x => x.status === 'error') || {}).err || '')}</p>`;
    else wlBody = `<div class="seg st-tabs" role="tablist"><button type="button" role="tab" data-st-wl="p" class="${tab === 'p' ? 'on' : ''}" aria-selected="${tab === 'p'}">Pages</button><button type="button" role="tab" data-st-wl="q" class="${tab === 'q' ? 'on' : ''}" aria-selected="${tab === 'q'}">Searches</button></div>
      <p class="flat st-wlsum">${tab === 'p' ? `Pages: +${fmtN(movP.gain)} gained, ${fmtN(movP.loss)} lost across ${fmtN(movP.n)} pages.` : `Searches: +${fmtN(movQ.gain)} gained, ${fmtN(movQ.loss)} lost across ${fmtN(movQ.n)} searches. Searches Google keeps private are not listed, so these do not add up to the site total.`}</p>
      ${tab === 'p' ? wl(movP, 'p', 'pages') : wl(movQ, 'q', 'searches')}`;
    const wlHtml = `<section class="panel"><div class="panel-h"><h2>Winners &amp; losers</h2><p>Biggest changes in clicks beyond normal variation (about √n clicks), ${rng(sel.start, sel.end)} vs ${baseR.available ? rng(baseR.start, baseR.end) : esc(baseLabel)}. Switch “vs previous period / vs last year” above to change the comparison.</p></div><div class="panel-b">${wlBody}</div></section>`;

    // ── insights and recommendations ──
    const daily = ST.span(H, sel.start, sel.end);
    const lyCur = cmpMode === 'prev' ? yoy : null, lyB = cmpMode === 'prev' ? lyPrev : null;
    const ins = ST.insights({ cur, base, baseLabel, lastYear: lyCur, lyBase: lyB, daily, movP, movQ, brandTest: brandTest(D), breadthCur: bCur, breadthBase: bBase });
    const seasonal = ins.some(i => i.id === 'season' && i.tone === 'info');
    const recs = ST.recommendations({ movP, movQ, cur, base, seasonal, pathOf });
    const insHtml = `<section class="panel"><div class="panel-h"><h2>Insights</h2><p>Generated automatically from the numbers on this page by fixed rules (no AI model, nothing invented). <b>Observed</b> lines are measured; <b>Possible explanations</b> are hypotheses to check, not conclusions.</p></div>
      ${ins.length ? `<ul class="st-ins">${ins.map(i => `<li class="${i.tone}"><h3>${esc(i.title)}</h3><div class="st-ins-g"><div><span class="st-lbl">Observed</span><ul>${i.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div><div><span class="st-lbl maybe">Possible explanations</span><ul>${i.maybe.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div></div></li>`).join('')}</ul>` : `<p class="empty">${base ? 'Nothing notable changed in this period.' : 'Insights need a comparison period inside the history.'}</p>`}
      ${loadingRows ? '<p class="flat st-pad">More insights appear when searches and pages finish loading.</p>' : ''}</section>`;
    const recHtml = `<section class="panel"><div class="panel-h"><h2>Recommended next steps</h2><p>From the page and search changes above, largest click impact first. Each links to the Clickwise report with the full detail.</p></div>
      ${recs.length ? `<ol class="st-recs">${recs.map(r => `<li><div class="st-r1"><span class="tag ${r.priority === 'High' ? 'risk' : r.priority === 'Medium' ? 'watch' : ''}">${r.priority}</span>${r.url ? urlCell(r.url, r.title) : `<b>${esc(r.title)}</b>`}<span class="flat">${r.kind === 'recover' ? 'recover' : r.kind === 'grow' ? 'grow' : 'site-wide'} · about ${fmtN(r.impact)} clicks in the period</span></div><p class="flat">${esc(r.evidence)}</p><p>${esc(r.action)} <a href="${esc(r.view)}">${esc(r.label)}</a></p></li>`).join('')}</ol>`
        : `<p class="empty">${movP ? 'No page or search changes large enough to act on.' : 'Recommendations need page and search data for both periods.'}</p>`}</section>`;

    const html = head(title, sub) + tabs('trends') + controls +
      `<div class="st-notes">${notes.map(n => `<span>${n}</span>`).join('')}</div>` +
      (warn.length ? `<div class="note warn st-warn"><ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '') +
      kpis + stdHtml + charts + insHtml + recHtml + wlHtml + tablesHtml;

    const mount = () => {
      ['t-st-month', 't-st-week', 't-st-wp', 't-st-lp', 't-st-wq', 't-st-lq'].forEach(id => drawTable(id));
      document.querySelectorAll('[data-st-range]').forEach(b => b.addEventListener('click', () => go({ range: b.dataset.stRange, from: null, to: null })));
      document.querySelector('[data-st-custom]').addEventListener('click', () => { const f = document.getElementById('st-custom'); f.hidden = false; f.querySelector('input').focus(); });
      document.getElementById('st-custom').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.target); go({ range: 'custom', from: fd.get('from'), to: fd.get('to') }); });
      document.querySelectorAll('[data-st-g]').forEach(b => b.addEventListener('click', () => go({ g: b.dataset.stG })));
      document.querySelectorAll('[data-st-cmp]').forEach(b => b.addEventListener('click', () => go({ cmp: b.dataset.stCmp })));
      document.querySelectorAll('[data-st-wl]').forEach(b => b.addEventListener('click', () => go({ wl: b.dataset.stWl })));
      const bt = document.getElementById('st-breadth'); if (bt) bt.addEventListener('click', () => { BREADTH_ON.add(baseKey(D)); rerender(); });
      document.getElementById('st-export').addEventListener('click', () => exportCsv(D, { sel, cur, prev, yoy, C, std, months: months2, weeks: weeks2, movP, movQ, ins, recs, srcLabel, H }));
      // charts
      const labels = bks.map(b => b.label);
      // keep small movements in proportion: the axis spans at least `span` units around the data
      const pad = (vals, span, floor) => { const v = vals.filter(x => x != null && isFinite(x)); if (!v.length) return {}; const lo = Math.min(...v), hi = Math.max(...v), mid = (lo + hi) / 2, half = Math.max(span, (hi - lo) * 0.6); return { min: Math.max(floor, Math.floor((mid - half) * 10) / 10), max: Math.ceil((mid + half) * 10) / 10 }; };
      const sig = cssVar('--signal'), sky = cssVar('--sky');
      const soft = c => c + '66';
      chart('st-ch-traffic', { data: { labels, datasets: [
        { type: 'bar', label: 'Clicks', data: bks.map(b => b.clicks), backgroundColor: bks.map(b => b.partial ? soft(sig) : sig), borderRadius: 4, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Impressions', data: bks.map(b => b.impr), borderColor: sky, backgroundColor: sky, pointRadius: 2, borderWidth: 2, tension: .3, yAxisID: 'y1', order: 1 }
      ].concat(bks.some(b => b.yoy) ? [{ type: 'line', label: 'Clicks a year earlier', data: bks.map(b => b.yoy ? b.yoy.clicks : null), borderColor: cssVar('--muted'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, spanGaps: false, yAxisID: 'y', order: 0 }] : []) },
        options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { footer: items => { const b = bks[items[0].dataIndex]; return b.partial ? 'Partial: ' + b.why : `${b.haveDays} days · CTR ${b.ctr.toFixed(2)}%`; } } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: g === 'week' ? 13 : 16, autoSkip: true } }, y: { position: 'left', title: { display: true, text: 'Clicks' }, ticks: { callback: v => fmtN(v) } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'Impressions' }, ticks: { callback: v => fmtN(v) } } } } });
      chart('st-ch-rank', { type: 'line', data: { labels, datasets: [
        { label: 'Average position', data: bks.map(b => b.pos != null && b.impr ? +b.pos.toFixed(2) : null), borderColor: cssVar('--orange') || '#F97316', backgroundColor: cssVar('--orange') || '#F97316', pointRadius: bks.map(b => b.partial ? 2 : 3), pointStyle: bks.map(b => b.partial ? 'rectRot' : 'circle'), borderWidth: 2, tension: .3, yAxisID: 'y' },
        { label: 'CTR (%)', data: bks.map(b => b.impr ? +b.ctr.toFixed(2) : null), borderColor: cssVar('--good'), backgroundColor: cssVar('--good'), pointRadius: 2, borderWidth: 2, tension: .3, yAxisID: 'y1' }
      ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { footer: items => { const b = bks[items[0].dataIndex]; return b.partial ? 'Partial: ' + b.why : ''; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: g === 'week' ? 13 : 16 } }, y: { reverse: true, position: 'left', title: { display: true, text: 'Position' }, ...pad(bks.filter(b => b.impr).map(b => b.pos), 1, 1) }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'CTR %' }, ticks: { callback: v => (+v).toFixed(1) + '%' }, ...pad(bks.filter(b => b.impr).map(b => b.ctr), 0.5, 0) } } } });
      const bc = document.getElementById('st-ch-breadth');
      if (bc && bc.dataset.rows) {
        const rows = JSON.parse(bc.dataset.rows);
        chart('st-ch-breadth', { type: 'bar', data: { labels: rows.map(r => r.label), datasets: [{ label: 'Ranking queries', data: rows.map(r => r.ranking), backgroundColor: cssVar('--sky') }, { label: 'Top 10', data: rows.map(r => r.top10), backgroundColor: cssVar('--good') }] },
          options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmtN(v) } } } } });
      }
    };
    return { html, mount };
  };

  // Ranking-query counts per month or quarter need one Search Console request each, so they load on request.
  const BREADTH_ON = new Set();
  function breadthTrend(D, H, sel, g) {
    const S = src();
    if (S.kind !== 'api') return `<p class="flat st-pad">Ranking-query counts by month need a Search Console connection${S.kind === 'demo' ? ' (the sample site has searches for its loaded 3 months only)' : ''}.</p>`;
    if (g === 'week') return '<p class="flat st-pad">Switch to Monthly or Quarterly to load ranking-query counts per period.</p>';
    const bks = ST.buckets(H, sel, g).slice(-16);
    if (!BREADTH_ON.has(baseKey(D))) return `<p class="st-pad"><button type="button" class="btn-quiet" id="st-breadth">Load ranking queries and top-10 counts by ${g} (${bks.length} requests)</button></p>`;
    const sts = bks.map(b => periodRows(D, 'query', b.from, b.to));
    if (sts.some(s => s.status === 'loading')) return `<p class="flat st-pad sv-loading">Counting ranking queries: ${sts.filter(s => s.status === 'done').length} of ${bks.length}…</p>`;
    const rows = bks.map((b, i) => sts[i].status === 'done' ? { label: b.label + (b.partial ? '*' : ''), ...ST.breadth(sts[i].data.rows, sts[i].data.capped) } : { label: b.label, ranking: null, top10: null });
    const capped = rows.some(r => r.capped);
    return `<div class="chart-box sm st-pad"><canvas id="st-ch-breadth" data-rows="${esc(JSON.stringify(rows))}" aria-label="Ranking queries and top-10 rankings by ${g}"></canvas></div><p class="flat st-pad">Searches with at least one impression in each ${g}; private searches are excluded.${capped ? ' Some periods reached the 50,000-row limit, so their counts are lower bounds.' : ''} * partial ${g}.</p>`;
  }

  function exportCsv(D, x) {
    const cell = v => { let s = String(v == null ? '' : (typeof v === 'number' ? +v.toFixed(2) : v)); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const L = [];
    const row = a => L.push(a.map(cell).join(','));
    const tot = (name, t) => row([name, t ? `${t.start} to ${t.end}` : 'not available', t ? t.clicks : '', t ? t.impr : '', t ? +t.ctr.toFixed(3) : '', t && t.pos != null ? +t.pos.toFixed(2) : '']);
    row(['Clickwise Statistics & Trends', D.site, x.srcLabel]); row(['Selected', x.sel.start, x.sel.end, `${x.sel.days} days`]); row(['History available', x.H.first, x.H.last]); L.push('');
    row(['Period', 'Dates', 'Clicks', 'Impressions', 'CTR %', 'Avg position']); tot('Selected', x.cur); tot('Previous period', x.prev); tot('Same dates last year', x.yoy); L.push('');
    if (x.std) { row(['Standard comparisons', 'Current dates', 'Clicks', 'Impressions', 'CTR %', 'Avg position', 'Comparison dates', 'Clicks', 'Impressions', 'CTR %', 'Avg position']);
      [x.std.wow, x.std.mom, x.std.yoy].forEach(s => row([s.label, `${s.cur.start} to ${s.cur.end}`, s.cur.clicks, s.cur.impr, +s.cur.ctr.toFixed(3), s.cur.pos != null ? +s.cur.pos.toFixed(2) : '', s.base ? `${s.base.start} to ${s.base.end}` : 'not available', s.base ? s.base.clicks : '', s.base ? s.base.impr : '', s.base ? +s.base.ctr.toFixed(3) : '', s.base && s.base.pos != null ? +s.base.pos.toFixed(2) : ''])); L.push(''); }
    const per = (name, list) => { row([name, 'Start', 'End', 'Clicks', 'Impressions', 'CTR %', 'Avg position', 'Change vs previous (clicks %)', 'YoY (clicks %)', 'Days', 'Partial']); list.forEach(r => row([r.label, r.from, r.to, r.clicks, r.impr, +r.ctr.toFixed(3), r.pos != null ? +r.pos.toFixed(2) : '', r.chg != null ? +r.chg.toFixed(1) : '', r.yoyc != null ? +r.yoyc.toFixed(1) : '', r.haveDays, r.partial ? r.why : ''])); L.push(''); };
    per('Month', x.months); per('Week', x.weeks);
    const mv = (name, m, key) => { if (!m) return; row([name, 'Before', 'Now', 'Change', 'What changed']); m.winners.concat(m.losers).forEach(r => row([r[key], r.prev, r.clicks, r.d, ST.moverWhy(r)])); L.push(''); };
    mv('Page (winners and losers)', x.movP, 'p'); mv('Search (winners and losers)', x.movQ, 'q');
    if (x.ins.length) { row(['Insight', 'Observed', 'Possible explanations']); x.ins.forEach(i => row([i.title, i.facts.join(' '), i.maybe.join(' ')])); L.push(''); }
    if (x.recs.length) { row(['Priority', 'Recommendation', 'Evidence', 'Action']); x.recs.forEach(r => row([r.priority, r.url || r.title, r.evidence, r.action])); }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\n')], { type: 'text/csv' }));
    a.download = `clickwise-statistics-${String(D.site).replace(/[^a-z0-9.-]+/gi, '-')}-${x.sel.start}-to-${x.sel.end}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  window.CW_STATSVIEW = { CACHE, load, history, periodRows, rowsOf, baseKey, chg, fmtD, rng, tabs, params, rerender };
})();

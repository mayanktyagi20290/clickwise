// Clickwise Statistics & Trends › "Day-wise" tab (#stats?tab=daywise). One row per day from the daily totals
// already loaded for the chosen dates (D.C): clicks, impressions, CTR, position, and the change against the
// previous day and against the same weekday a week earlier. Nothing is fetched or stored here.
(function () {
  'use strict';
  const { esc, ui } = window.CW_VIEWS;
  const { head, pctf } = ui;
  const CW = window.CW, fmtN = CW.fmtN;
  const SV = () => window.CW_STATSVIEW;
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const OPTS = [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['28', 'Last 28 days'], ['all', 'All loaded days']];
  const go = n => { const p = SV().params(); p.set('tab', 'daywise'); p.set('dw', n); location.hash = '#stats?' + p.toString(); };
  const dayOf = d => new Date(d + 'T00:00:00').getDay();
  const pct = (a, b) => b ? (a - b) / b * 100 : null;
  const dlt = (a, b, invert) => {
    const c = pct(a, b);
    if (c == null || !isFinite(c)) return '<span class="flat">—</span>';
    if (Math.abs(c) < 0.5) return '<span class="flat">0%</span>';
    const good = invert ? c < 0 : c > 0;
    return `<span class="dw-pill ${good ? 'up' : 'dn'}">${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%</span>`;
  };

  // Heatmap fill: red (low) to green (high) within a column, like a breadth table. inv: lower is better.
  const heat = (t, inv) => { if (t == null || !isFinite(t)) return ''; const g = inv ? 1 - t : t, a = (.12 + Math.abs(g - .5) * 1.1).toFixed(2); return ` data-h="${g >= .5 ? 'g' : 'r'}" style="--a:${a}"`; };
  const scale = (vals) => { const v = vals.filter(x => x != null && isFinite(x)), lo = Math.min(...v), hi = Math.max(...v); return x => x == null || !isFinite(x) || hi === lo ? null : (x - lo) / (hi - lo); };
  const dscale = (vals) => { const m = Math.max(1, ...vals.filter(x => x != null && isFinite(x)).map(Math.abs)); return x => x == null || !isFinite(x) ? null : .5 + Math.max(-1, Math.min(1, x / m)) / 2; };
  const dcell = (c, f, inv) => c == null || !isFinite(c) ? '<td class="r flat">—</td>' : `<td class="r num"${heat(f(c), inv)}>${c > 0 ? '+' : ''}${c.toFixed(1)}%</td>`;

  // the signal for one day against the day before: spike or drop in clicks, else an impression, CTR or position move
  function sigOf(r) {
    if (!r.prev) return null;
    const c = pct(r.clicks, r.prev.clicks), ip = pct(r.impr, r.prev.impr), k0 = r.prev.impr ? r.prev.clicks / r.prev.impr : 0, k1 = r.impr ? r.clicks / r.impr : 0, kp = k0 ? (k1 - k0) / k0 * 100 : null;
    const dpos = r.pos != null && r.prev.pos ? r.pos - r.prev.pos : null;
    if (c != null && c >= 20) return { label: 'Spike', up: true };
    if (c != null && c <= -20) return { label: 'Drop', up: false };
    if (ip != null && ip >= 25) return { label: 'Impression jump', up: true };
    if (ip != null && ip <= -25) return { label: 'Impression fall', up: false };
    if (kp != null && kp <= -20) return { label: 'CTR fall', up: false };
    if (dpos != null && dpos >= 2) return { label: 'Position drop', up: false };
    return null;
  }

  function rows(C) {
    const m = new Map(); (C || []).forEach(r => m.set(r.d, r));
    const all = [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
    return all.map((r, i) => {
      const prev = all[i - 1], wk = m.get(shift(r.d, -7));
      const ctr = r.impr ? r.clicks / r.impr * 100 : 0;
      return { d: r.d, wd: WD[dayOf(r.d)], clicks: r.clicks || 0, impr: r.impr || 0, ctr, pos: r.pos || null, prev: prev && daysBetween(prev.d, r.d) === 1 ? prev : null, wk };
    });
  }
  function shift(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }

  // D / W / M / Y: roll the daily rows into weeks (Monday start), months or years
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function rollup(C, g) {
    const days = rows(C); if (g === 'd' || g === 'c') return days;
    const keyOf = r => { if (g === 'm') return r.d.slice(0, 7); if (g === 'y') return r.d.slice(0, 4); const x = new Date(r.d + 'T00:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const m = new Map();
    days.forEach(r => { const k = keyOf(r), a = m.get(k) || { d: k, clicks: 0, impr: 0, pw: 0, n: 0 }; a.clicks += r.clicks; a.impr += r.impr; if (r.pos != null) { a.pw += r.pos * (r.impr || 1); a.n += r.impr || 1; } a.days = (a.days || 0) + 1; m.set(k, a); });
    const out = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)), full = g === 'w' ? 7 : 0;
    return out.map((a, i) => ({ d: a.d, wd: g === 'w' ? 'Week' : g === 'm' ? MON[+a.d.slice(5) - 1] : 'Year', clicks: a.clicks, impr: a.impr, ctr: a.impr ? a.clicks / a.impr * 100 : 0, pos: a.n ? a.pw / a.n : null, prev: out[i - 1] ? { clicks: out[i - 1].clicks, impr: out[i - 1].impr, pos: out[i - 1].n ? out[i - 1].pw / out[i - 1].n : null } : null, wk: null, partial: !!(full && a.days < full) || (g !== 'w' && (i === 0 || i === out.length - 1) && a.days < (g === 'm' ? 28 : 360)), days: a.days }));
  }
  // a stock-style rating from the move in clicks against the period before
  const RATES = ['Strong', 'Good', 'Mixed', 'Weak', 'Poor'];
  function rate(r) { if (!r.prev || !r.prev.clicks) return null; const c = pct(r.clicks, r.prev.clicks); return c >= 20 ? 'Strong' : c >= 5 ? 'Good' : c > -5 ? 'Mixed' : c > -20 ? 'Weak' : 'Poor'; }
  const RCLS = { Strong: 'up', Good: 'up', Mixed: 'flat', Weak: 'dn', Poor: 'dn' };

  function csv(list) {
    const h = ['Date', 'Day', 'Clicks', 'Impressions', 'CTR %', 'Avg position', 'Clicks vs previous day %', 'Clicks vs same day last week %'];
    const f = v => v == null || !isFinite(v) ? '' : (+v).toFixed(2);
    return [h].concat(list.map(r => [r.d, r.wd, r.clicks, r.impr, f(r.ctr), f(r.pos), f(r.prev ? pct(r.clicks, r.prev.clicks) : null), f(r.wk ? pct(r.clicks, r.wk.clicks) : null)])).map(a => a.join(',')).join('\n');
  }

  function tableHtml(list, mode, order) {
    mode = mode || 'd'; const isD = mode === 'd' || mode === 'c', lab = { d: 'prev day', c: 'prev day', w: 'prev week', m: 'prev month', y: 'prev year' }[mode];
    const chg = r => pct(r.clicks, r.prev.clicks);
    const fC = scale(list.map(r => r.clicks)), fI = scale(list.map(r => r.impr)), fR = scale(list.map(r => r.ctr)), fP = scale(list.map(r => r.pos));
    const dp = list.map(r => r.prev ? chg(r) : null), dw = list.map(r => r.wk ? pct(r.clicks, r.wk.clicks) : null), fD = dscale(dp.concat(dw));
    return `<div class="tw"><table class="dw-t"><thead><tr class="dw-g"><th colspan="2"></th><th colspan="3">Traffic</th><th colspan="2">Change in clicks</th><th colspan="3">Rank &amp; signal</th></tr><tr><th scope="col">${mode === 'w' ? 'Week from' : mode === 'm' ? 'Month' : mode === 'y' ? 'Year' : 'Date'}</th><th scope="col">${isD ? 'Day' : ''}</th><th class="r" scope="col">Clicks</th><th class="r" scope="col">Impressions</th><th class="r" scope="col">CTR</th><th class="r" scope="col">vs ${lab}</th>${isD ? '<th class="r" scope="col">vs same day last wk</th>' : '<th></th>'}<th class="r" scope="col">Avg pos</th><th scope="col">Rating</th><th scope="col">Signal</th></tr></thead><tbody>
        ${(order || list.map((r, i) => i).reverse()).map(i => ({ r: list[i], i })).map(({ r, i }) => `<tr${isD ? ` class="dw-r" data-d="${esc(r.d)}" tabindex="0" title="Click to see what happened on this day"` : ''}><td>${esc(r.d)}${r.partial ? ' <small class="flat" title="Part of this period is outside your data">partial</small>' : ''}</td><td>${isD ? esc(r.wd) : ''}</td><td class="r num"${heat(fC(r.clicks))}>${fmtN(r.clicks)}</td><td class="r num"${heat(fI(r.impr))}>${fmtN(r.impr)}</td><td class="r num"${heat(fR(r.ctr))}>${pctf(r.ctr, 2)}</td>${dcell(dp[i], fD)}${isD ? dcell(dw[i], fD) : '<td></td>'}<td class="r num"${heat(fP(r.pos), true)}>${r.pos != null ? r.pos.toFixed(1) : '—'}</td><td>${(k => k ? `<span class="dw-pill ${RCLS[k]}">${k}</span>` : '')(rate(r))}</td><td>${(g => g ? `<span class="dw-pill ${g.up ? 'up' : 'dn'}">${g.label}</span>` : '')(sigOf(r))}</td></tr>`).join('')}</tbody></table></div>`;
  }


  // ── one day in detail: what moved, why, and what to do ──
  const SRC = () => window.CW_SOURCE || { kind: 'file' };
  const addD = (d, n) => shift(d, n);
  const nm = r => r.q != null ? r.q : (CW.pathOf ? CW.pathOf(r.p) : r.p);
  function moversOf(cur, prev, key) {
    const pm = new Map((prev || []).map(r => [r[key], r])), cm = new Map((cur || []).map(r => [r[key], r]));
    const keys = new Set([...pm.keys(), ...cm.keys()]);
    return [...keys].map(k => { const c = cm.get(k), p = pm.get(k); return { r: c || p, k, now: c ? c.clicks : 0, was: p ? p.clicks : 0, d: (c ? c.clicks : 0) - (p ? p.clicks : 0) }; });
  }
  // rows for one day: { status, up:{queries,pages}, dn } — API gives searches and pages; the sample gives pages; an export gives neither
  function dayRows(D, day) {
    const S = SRC(), SVw = SV(), prevDay = addD(day, -1);
    if (S.kind === 'api') {
      const g = (dim, d) => SVw.periodRows(D, dim, d, d);
      const st = [g('query', day), g('query', prevDay), g('page', day), g('page', prevDay)];
      if (st.some(x => x.status === 'loading')) return { status: 'loading' };
      const bad = st.find(x => x.status === 'error'); if (bad) return { status: 'error', err: bad.err };
      return { status: 'done', queries: moversOf(st[0].data.rows, st[1].data.rows, 'q'), pages: moversOf(st[2].data.rows, st[3].data.rows, 'p') };
    }
    if (S.kind === 'demo') {
      const st = SVw.load(`dwdemo|${D.site}|${day}`, () => Promise.all((S.pages || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 40).map(pg =>
        S.pageDaily(pg.p, prevDay, day).then(rs => ({ p: pg.p, cur: (rs.find(x => x.d === day) || {}).clicks || 0, prev: (rs.find(x => x.d === prevDay) || {}).clicks || 0 })))));
      if (st.status !== 'done') return { status: st.status, err: st.err };
      return { status: 'done', queries: null, pages: st.data.map(x => ({ r: { p: x.p }, k: x.p, now: x.cur, was: x.prev, d: x.cur - x.prev })) };
    }
    return { status: 'none' };
  }
  const list = (title, arr, up) => {
    const a = arr.filter(x => up ? x.d > 0 : x.d < 0).sort((x, y) => up ? y.d - x.d : x.d - y.d).slice(0, 8);
    return `<div class="dw-l"><h3 class="${up ? 'gainv' : 'lossv'}">${up ? '▲ Improved' : '▼ Dropped'} · ${title}</h3>${a.length ? a.map(x => `<div class="dw-lr"><span title="${esc(nm(x.r))}">${esc(nm(x.r))}</span><em class="num">${fmtN(x.was)} → ${fmtN(x.now)}</em><b class="${up ? 'gainv' : 'lossv'} num">${x.d > 0 ? '+' : ''}${fmtN(x.d)}</b></div>`).join('') : '<p class="flat">Nothing notable.</p>'}</div>`;
  };

  function actions(r, rows, wkSame) {
    const out = [], p = r.prev, c = pct(r.clicks, p.clicks);
    const i0 = p.impr, i1 = r.impr, c0 = p.clicks, c1 = r.clicks, k0 = i0 ? c0 / i0 : 0, k1 = i1 ? c1 / i1 : 0;
    const imprEff = (i1 - i0) * k0, ctrEff = (k1 - k0) * i1, byImpr = Math.abs(imprEff) >= Math.abs(ctrEff);
    const dpos = r.pos != null && p.pos != null ? r.pos - p.pos : null;
    const pg = rows && rows.pages, qs = rows && rows.queries;
    const top = (a, up) => a ? a.filter(x => up ? x.d > 0 : x.d < 0).sort((x, y) => up ? y.d - x.d : x.d - y.d) : [];
    const dropP = top(pg, false), upP = top(pg, true), dropQ = top(qs, false), upQ = top(qs, true);
    const lost = a => a.reduce((s, x) => s + Math.abs(x.d), 0);
    const named = a => a.slice(0, 2).map(x => esc(nm(x.r))).join(' and ');
    if (wkSame != null && Math.abs(wkSame) < 8 && Math.abs(c) >= 8) out.push(['Likely a normal weekly swing', `Clicks are within ${Math.abs(wkSame).toFixed(0)}% of the same weekday last week, so the change from yesterday is mostly the weekday pattern. Check the 7-day trend before acting.`]);
    if (c <= -8) {
      if (byImpr && dpos != null && dpos > 0.5) out.push(['Rankings slipped', `Impressions fell and average position moved ${dpos.toFixed(1)} places down. ${dropQ.length ? `Biggest losers: ${named(dropQ)}.` : ''} Check the pages that lost rankings for recent edits, lost links or indexing problems, and compare with what now ranks above you.`]);
      else if (byImpr) out.push(['Demand or visibility fell', 'Impressions dropped while position held. It is often seasonality, a holiday or fewer searches. Compare with the same weekday last week and last year before changing anything.']);
      else out.push(['Fewer people clicked, same visibility', `CTR fell while impressions held${dpos != null && Math.abs(dpos) < 0.5 ? ' and position was steady' : ''}. Look at ${dropP.length ? named(dropP) : 'the pages that lost clicks'}: rewrite the title and meta, and check whether an AI Overview, ad or rich result now sits above you.`]);
      if (dropP.length && lost(dropP) && Math.abs(dropP[0].d) >= 0.5 * lost(dropP)) out.push(['One page caused most of the loss', `${esc(nm(dropP[0].r))} lost ${fmtN(Math.abs(dropP[0].d))} clicks, over half of all page losses that day. Inspect it first: status, recent changes, canonical, and its top queries.`]);
    } else if (c >= 8) {
      out.push([byImpr ? 'More visibility: build on it' : 'Better click-through: copy what worked', `${byImpr ? 'Impressions rose' : 'CTR rose'}${upQ.length ? `, led by ${named(upQ)}` : upP.length ? `, led by ${named(upP)}` : ''}. Refresh and internally link to the winning pages, and write follow-up content around those searches while the demand is there.`]);
      if (upP.length) out.push(['Protect the winners', `Add fresh facts, FAQs and internal links to ${named(upP)} so the gain holds past this day.`]);
    } else out.push(['No action needed', 'Clicks were within 8% of the day before. Keep working through the Opportunities list.']);
    if (dpos != null && Math.abs(dpos) >= 1) out.push([dpos < 0 ? 'Position improved' : 'Position worsened', `Average position moved ${Math.abs(dpos).toFixed(1)} places ${dpos < 0 ? 'up' : 'down'}. ${rows ? 'Check the pages whose ranking changed in the lists above.' : 'Connect Search Console to see which pages changed.'}`]);
    return { items: out, byImpr, imprEff, ctrEff, dpos, c };
  }

  function detailHtml(D, day) {
    const all = rows(D.C), r = all.find(x => x.d === day);
    if (!r) return '';
    if (!r.prev) return `<section class="panel dw-day"><div class="panel-b"><p class="empty">No data for the day before ${esc(day)}, so there is nothing to compare.</p></div></section>`;
    const rr = dayRows(D, day), wkSame = r.wk ? pct(r.clicks, r.wk.clicks) : null;
    const rowsOk = rr.status === 'done' ? rr : null, A2 = actions(r, rowsOk, wkSame);
    const cc = pct(r.clicks, r.prev.clicks);
    const verdict = Math.abs(cc) < 8 ? `A steady day: clicks ${cc >= 0 ? 'rose' : 'fell'} ${Math.abs(cc).toFixed(1)}%.`
      : `Clicks ${cc > 0 ? 'rose' : 'fell'} <b class="${cc > 0 ? 'gainv' : 'lossv'}">${Math.abs(cc).toFixed(1)}%</b>, mostly because of <b>${A2.byImpr ? 'impressions' : 'click-through rate'}</b> (${A2.byImpr ? 'visibility' : 'titles, snippets and what is above you in results'}).`;
    const chip = (v, inv) => v == null || !isFinite(v) ? '' : `<span class="dw-pill ${(inv ? v < 0 : v > 0) ? 'up' : 'dn'}">${v > 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
    const stat = (l, v, ch) => `<div class="st-sm"><span>${l}</span><b>${v}</b>${ch || ''}</div>`;
    const kind = SRC().kind;
    const body = rr.status === 'loading' ? '<p class="flat">Loading what moved on this day from Search Console…</p>'
      : rr.status === 'error' ? `<p class="lossv">Could not load the day's searches and pages: ${esc(rr.err || '')}</p>`
      : rr.status === 'none' ? '<p class="flat">An uploaded export only has whole-site daily totals. Connect Search Console to see which searches and pages moved on a day. The advice below uses totals only.</p>'
      : `<div class="dw-ls">${rr.queries ? list('searches', rr.queries, true) + list('searches', rr.queries, false) : ''}${list('pages', rr.pages, true)}${list('pages', rr.pages, false)}</div>${kind === 'demo' ? '<p class="flat">Sample data: pages only (top 40 by clicks). Live Search Console shows searches too.</p>' : ''}`;
    return `<section class="panel dw-day"><div class="panel-h"><h2>${esc(r.wd)}, ${esc(day)}: what happened</h2><a href="#stats?tab=daywise" class="btn-quiet">Close</a></div><div class="panel-b">
      <p class="dw-verdict">${verdict}</p>
      <div class="st-sms">${stat('Clicks', fmtN(r.clicks), chip(cc))}${stat('Impressions', fmtN(r.impr), chip(pct(r.impr, r.prev.impr)))}${stat('CTR', pctf(r.ctr, 2), chip(pct(r.ctr, r.prev.ctr || 0)))}${stat('Avg position', r.pos != null ? r.pos.toFixed(1) : '—', r.pos != null && r.prev.pos ? chip(pct(r.pos, r.prev.pos), true) : '')}${stat('vs same day last week', wkSame == null ? '—' : (wkSame > 0 ? '+' : '') + wkSame.toFixed(1) + '%')}</div>
      <h3 class="dw-h3">What moved</h3>${body}
      <h3 class="dw-h3">What to do</h3><div class="dw-acts">${A2.items.map(a => `<div class="dw-a"><b>${a[0]}</b><p>${a[1]}</p></div>`).join('')}</div></div></section>`;
  }

  // daily clicks as bars: click a bar (or use the date box) to open that day
  function chartHtml(D, sel) {
    const all = rows(D.C); if (!all.length) return '';
    const mn = all[0].d, mx = all[all.length - 1].d;
    return `<section class="panel"><div class="panel-h"><h2>Daily clicks</h2><div class="dw-pick"><span class="flat">Click a bar, or pick a date</span><input type="date" id="dw-date" min="${mn}" max="${mx}" value="${sel && sel >= mn && sel <= mx ? sel : ''}" aria-label="Pick a date"></div></div><div class="panel-b"><div class="dw-chart"><canvas id="dw-chart" aria-label="Daily clicks"></canvas></div></div></section>`;
  }
  function chartMount(D, sel, go) {
    const all = rows(D.C), el = document.getElementById('dw-chart'), ui2 = window.CW_VIEWS.ui;
    const dt = document.getElementById('dw-date');
    if (dt) dt.addEventListener('change', () => { if (dt.value && all.some(r => r.d === dt.value)) go(dt.value); else if (dt.value) dt.setCustomValidity('No data for that date'), dt.reportValidity(); });
    if (!el || !all.length || !ui2.chart) return;
    const col = r => r.d === sel ? '#f59e0b' : r.prev && r.clicks < r.prev.clicks ? 'rgba(239,68,68,.65)' : 'rgba(34,197,94,.65)';
    ui2.chart('dw-chart', { type: 'bar', data: { labels: all.map(r => r.d), datasets: [{ label: 'Clicks', data: all.map(r => r.clicks), backgroundColor: all.map(col), borderRadius: 2 }] },
      options: { maintainAspectRatio: false, onClick: (e, els) => { if (els && els.length) go(all[els[0].index].d); }, onHover: (e, els) => { if (e.native && e.native.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: c => { const r = all[c.dataIndex]; return r.prev ? `${r.wd}, ${pct(r.clicks, r.prev.clicks) >= 0 ? '+' : ''}${pct(r.clicks, r.prev.clicks).toFixed(1)}% vs previous day` : r.wd; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true } } } });
  }

  function bindRows(root, go) {
    if (!root) return;
    root.querySelectorAll('tr.dw-r').forEach(tr => { const f = () => go(tr.dataset.d); tr.addEventListener('click', f); tr.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
  }

  function render(A, D) {
    const title = 'Day-wise performance';
    const sub = 'Every day in your data, with the change against the day before and against the same weekday last week.';
    const tabs = SV().tabs('daywise');
    if (!D.C || !D.C.length) return { html: head(title, sub) + tabs + '<section class="panel"><p class="empty">No daily data here. Export from Search Console with the Dates tab, or connect Search Console.</p></section>' };
    const P = SV().params(), sel = P.get('dw'), n = OPTS.some(o => o[0] === sel) ? sel : '28';
    const g = ['d', 'w', 'm', 'y', 'c'].includes(P.get('g')) ? P.get('g') : 'd', sigOn = P.get('sig') === '1', rf = RATES.includes(P.get('r')) ? P.get('r') : '', ord = ['new', 'old', 'up', 'down'].includes(P.get('o')) ? P.get('o') : 'new';
    const mn = D.C.reduce((a, r) => r.d < a ? r.d : a, D.C[0].d), mx = D.C.reduce((a, r) => r.d > a ? r.d : a, D.C[0].d);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(P.get('from') || '') ? P.get('from') : mn, to = /^\d{4}-\d{2}-\d{2}$/.test(P.get('to') || '') ? P.get('to') : mx;
    let list = rollup(D.C, g);
    if (g === 'd' && n !== 'all') list = list.slice(-(+n));
    if (g === 'c') list = list.filter(r => r.d >= from && r.d <= to);
    if (g === 'w') list = list.slice(-26); else if (g === 'm') list = list.slice(-24);
    const counts = Object.fromEntries(RATES.map(k => [k, list.filter(r => rate(r) === k).length]));
    if (rf) list = list.filter(r => rate(r) === rf);
    if (sigOn) list = list.filter(r => sigOf(r));
    const isDay = g === 'd' || g === 'c', unit = { d: 'Days', c: 'Days', w: 'Weeks', m: 'Months', y: 'Years' }[g], u1 = unit.slice(0, -1).toLowerCase();
    const idxs = list.map((r, i) => i), cl = r => r.prev && r.prev.clicks ? pct(r.clicks, r.prev.clicks) : -1e9;
    const order = ord === 'old' ? idxs : ord === 'up' ? idxs.slice().sort((a, b) => cl(list[b]) - cl(list[a])) : ord === 'down' ? idxs.slice().sort((a, b) => cl(list[a]) - cl(list[b])) : idxs.slice().reverse();
    const newest = list.slice().reverse();
    const withP = list.filter(r => r.prev);
    const chg = r => pct(r.clicks, r.prev.clicks);
    const best = withP.slice().sort((a, b) => chg(b) - chg(a))[0], worst = withP.slice().sort((a, b) => chg(a) - chg(b))[0];
    const down = withP.filter(r => r.clicks < r.prev.clicks).length;
    const tot = list.reduce((s, r) => ({ c: s.c + r.clicks, i: s.i + r.impr }), { c: 0, i: 0 });
    const tile = (l, v, s) => `<div class="st-sm"><span>${l}</span><b>${v}</b>${s || ''}</div>`;
    const dayTag = r => r ? `${esc(r.wd)} ${esc(r.d.slice(5))}` : '—';
    const day = SV().params().get('day');
    const html = head(title, sub) + tabs + (day ? detailHtml(D, day) : '') + chartHtml(D, day) + `
      <div class="dw-ctl"><div class="db-tabs" role="tablist" aria-label="Group by">${[['d', 'D'], ['w', 'W'], ['m', 'M'], ['y', 'Y'], ['c', 'Custom']].map(x => `<button type="button" data-g="${x[0]}" class="${x[0] === g ? 'on' : ''}" title="${{ d: 'Daily', w: 'Weekly', m: 'Monthly', y: 'Yearly', c: 'Custom dates' }[x[0]]}">${x[1]}</button>`).join('')}</div>
        ${g === 'd' ? `<label class="ow-f"><span>Show</span><select id="dw-n">${OPTS.map(o => `<option value="${o[0]}"${o[0] === n ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>` : ''}
        ${g === 'c' ? `<label class="ow-f"><span>From</span><input type="date" id="dw-from" min="${mn}" max="${mx}" value="${from}"></label><label class="ow-f"><span>To</span><input type="date" id="dw-to" min="${mn}" max="${mx}" value="${to}"></label>` : ''}
        <label class="ow-f"><span>Sort</span><select id="dw-o">${[['new', 'Latest first'], ['old', 'Oldest first'], ['up', 'Biggest gain'], ['down', 'Biggest drop']].map(o => `<option value="${o[0]}"${o[0] === ord ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <label class="dw-sigt"><input type="checkbox" id="dw-sig"${sigOn ? ' checked' : ''}> Signal days only</label><button type="button" class="btn-quiet" id="dw-csv">Download CSV</button></div>
      <div class="dw-rates" role="group" aria-label="Filter by rating"><button type="button" data-r="" class="${rf ? '' : 'on'}">All <em>${Object.values(counts).reduce((a, b) => a + b, 0)}</em></button>${RATES.map(k => `<button type="button" data-r="${k}" class="${rf === k ? 'on' : ''}">${k} <em>${counts[k]}</em></button>`).join('')}<span class="flat">Rating = move in clicks vs the ${isDay ? 'day' : u1} before: Strong +20% or more · Good +5% · Mixed ±5% · Weak −5% · Poor −20% or worse</span></div>
      <section class="panel"><div class="panel-b st-sms">
        ${tile(unit + ' shown', list.length)}${tile('Clicks', fmtN(tot.c))}${tile('Overall CTR', tot.i ? pctf(tot.c / tot.i * 100, 2) : '—')}
        ${tile(unit + ' down vs ' + (isDay ? 'day' : u1) + ' before', `${down} of ${withP.length}`)}
        ${tile('Best ' + (isDay ? 'day' : u1), dayTag(best), best ? `<small class="dw-pill up">▲ ${chg(best).toFixed(1)}% clicks</small>` : '')}
        ${tile('Worst ' + (isDay ? 'day' : u1), dayTag(worst), worst ? `<small class="dw-pill dn">▼ ${Math.abs(chg(worst)).toFixed(1)}% clicks</small>` : '')}</div></section>
      <section class="panel">${tableHtml(list, g, order)}
        <p class="flat dw-n">Cells are coloured within each column: green is better, red is worse (for position, lower is better). Search Console's most recent days can still be revised.</p></section>`;
    const goDay = d => { const p = SV().params(); p.set('tab', 'daywise'); p.set('day', d); location.hash = '#stats?' + p.toString(); window.scrollTo(0, 0); };
    return { html, mount: () => {
      bindRows(document.getElementById('view'), goDay); chartMount(D, day, goDay);
      const setP = ch => { const p = SV().params(); p.set('tab', 'daywise'); Object.entries(ch).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k)); location.hash = '#stats?' + p.toString(); };
      document.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => setP({ g: b.dataset.g === 'd' ? '' : b.dataset.g, r: '' })));
      document.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => setP({ r: b.dataset.r })));
      document.getElementById('dw-o').addEventListener('change', e => setP({ o: e.target.value === 'new' ? '' : e.target.value }));
      ['dw-from', 'dw-to'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => setP({ from: (document.getElementById('dw-from') || {}).value, to: (document.getElementById('dw-to') || {}).value })); });
      const dn = document.getElementById('dw-n'); if (dn) dn.addEventListener('change', e => go(e.target.value));
      document.getElementById('dw-sig').addEventListener('change', e => { const p = SV().params(); p.set('tab', 'daywise'); if (e.target.checked) p.set('sig', '1'); else p.delete('sig'); location.hash = '#stats?' + p.toString(); });
      document.getElementById('dw-csv').addEventListener('click', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(list)], { type: 'text/csv' }));
        a.download = 'clickwise-day-wise.csv'; document.body.appendChild(a); a.click(); a.remove();
      });
    } };
  }
  window.CW_DAYWISEVIEW = { render, rows, tableHtml, bindRows, chartHtml, chartMount };
})();

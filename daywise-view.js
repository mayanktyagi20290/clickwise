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
  const heat = (t, inv) => { if (t == null || !isFinite(t)) return ''; const g = inv ? 1 - t : t, a = (.1 + Math.abs(g - .5) * 1.1).toFixed(2); return ` style="background:rgba(${g >= .5 ? '34,197,94' : '239,68,68'},${a})"`; };
  const scale = (vals) => { const v = vals.filter(x => x != null && isFinite(x)), lo = Math.min(...v), hi = Math.max(...v); return x => x == null || !isFinite(x) || hi === lo ? null : (x - lo) / (hi - lo); };
  const dscale = (vals) => { const m = Math.max(1, ...vals.filter(x => x != null && isFinite(x)).map(Math.abs)); return x => x == null || !isFinite(x) ? null : .5 + Math.max(-1, Math.min(1, x / m)) / 2; };
  const dcell = (c, f, inv) => c == null || !isFinite(c) ? '<td class="r flat">—</td>' : `<td class="r num"${heat(f(c), inv)}>${c > 0 ? '+' : ''}${c.toFixed(1)}%</td>`;

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

  function csv(list) {
    const h = ['Date', 'Day', 'Clicks', 'Impressions', 'CTR %', 'Avg position', 'Clicks vs previous day %', 'Clicks vs same day last week %'];
    const f = v => v == null || !isFinite(v) ? '' : (+v).toFixed(2);
    return [h].concat(list.map(r => [r.d, r.wd, r.clicks, r.impr, f(r.ctr), f(r.pos), f(r.prev ? pct(r.clicks, r.prev.clicks) : null), f(r.wk ? pct(r.clicks, r.wk.clicks) : null)])).map(a => a.join(',')).join('\n');
  }

  function tableHtml(list) {
    const chg = r => pct(r.clicks, r.prev.clicks);
    const fC = scale(list.map(r => r.clicks)), fI = scale(list.map(r => r.impr)), fR = scale(list.map(r => r.ctr)), fP = scale(list.map(r => r.pos));
    const dp = list.map(r => r.prev ? chg(r) : null), dw = list.map(r => r.wk ? pct(r.clicks, r.wk.clicks) : null), fD = dscale(dp.concat(dw));
    return `<div class="tw"><table class="dw-t"><thead><tr class="dw-g"><th colspan="2"></th><th colspan="3">Traffic</th><th colspan="2">Change in clicks</th><th colspan="1">Rank</th></tr><tr><th scope="col">Date</th><th scope="col">Day</th><th class="r" scope="col">Clicks</th><th class="r" scope="col">Impressions</th><th class="r" scope="col">CTR</th><th class="r" scope="col">vs prev day</th><th class="r" scope="col">vs same day last wk</th><th class="r" scope="col">Avg pos</th></tr></thead><tbody>
        ${list.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<tr class="dw-r" data-d="${esc(r.d)}" tabindex="0" title="Click to see what happened on this day"><td>${esc(r.d)}</td><td>${esc(r.wd)}</td><td class="r num"${heat(fC(r.clicks))}>${fmtN(r.clicks)}</td><td class="r num"${heat(fI(r.impr))}>${fmtN(r.impr)}</td><td class="r num"${heat(fR(r.ctr))}>${pctf(r.ctr, 2)}</td>${dcell(dp[i], fD)}${dcell(dw[i], fD)}<td class="r num"${heat(fP(r.pos), true)}>${r.pos != null ? r.pos.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
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

  function bindRows(root, go) {
    if (!root) return;
    root.querySelectorAll('tr.dw-r').forEach(tr => { const f = () => go(tr.dataset.d); tr.addEventListener('click', f); tr.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
  }

  function render(A, D) {
    const title = 'Day-wise performance';
    const sub = 'Every day in your data, with the change against the day before and against the same weekday last week.';
    const tabs = SV().tabs('daywise');
    if (!D.C || !D.C.length) return { html: head(title, sub) + tabs + '<section class="panel"><p class="empty">No daily data here. Export from Search Console with the Dates tab, or connect Search Console.</p></section>' };
    const sel = SV().params().get('dw'); const n = OPTS.some(o => o[0] === sel) ? sel : '28';
    let list = rows(D.C); if (n !== 'all') list = list.slice(-(+n));
    const newest = list.slice().reverse();
    const withP = list.filter(r => r.prev);
    const chg = r => pct(r.clicks, r.prev.clicks);
    const best = withP.slice().sort((a, b) => chg(b) - chg(a))[0], worst = withP.slice().sort((a, b) => chg(a) - chg(b))[0];
    const down = withP.filter(r => r.clicks < r.prev.clicks).length;
    const tot = list.reduce((s, r) => ({ c: s.c + r.clicks, i: s.i + r.impr }), { c: 0, i: 0 });
    const tile = (l, v, s) => `<div class="st-sm"><span>${l}</span><b>${v}</b>${s || ''}</div>`;
    const dayTag = r => r ? `${esc(r.wd)} ${esc(r.d.slice(5))}` : '—';
    const day = SV().params().get('day');
    const html = head(title, sub) + tabs + (day ? detailHtml(D, day) : '') + `
      <div class="dw-ctl"><label class="ow-f"><span>Period</span><select id="dw-n">${OPTS.map(o => `<option value="${o[0]}"${o[0] === n ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <button type="button" class="btn-quiet" id="dw-csv">Download CSV</button></div>
      <section class="panel"><div class="panel-b st-sms">
        ${tile('Days shown', list.length)}${tile('Clicks', fmtN(tot.c))}${tile('Overall CTR', tot.i ? pctf(tot.c / tot.i * 100, 2) : '—')}
        ${tile('Days down vs day before', `${down} of ${withP.length}`)}
        ${tile('Best day', dayTag(best), best ? `<small class="dw-pill up">▲ ${chg(best).toFixed(1)}% clicks</small>` : '')}
        ${tile('Worst day', dayTag(worst), worst ? `<small class="dw-pill dn">▼ ${Math.abs(chg(worst)).toFixed(1)}% clicks</small>` : '')}</div></section>
      <section class="panel">${tableHtml(list)}
        <p class="flat dw-n">Cells are coloured within each column: green is better, red is worse (for position, lower is better). Search Console's most recent days can still be revised.</p></section>`;
    return { html, mount: () => {
      bindRows(document.getElementById('view'), d => { const p = SV().params(); p.set('tab', 'daywise'); p.set('day', d); location.hash = '#stats?' + p.toString(); window.scrollTo(0, 0); });
      document.getElementById('dw-n').addEventListener('change', e => go(e.target.value));
      document.getElementById('dw-csv').addEventListener('click', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(list)], { type: 'text/csv' }));
        a.download = 'clickwise-day-wise.csv'; document.body.appendChild(a); a.click(); a.remove();
      });
    } };
  }
  window.CW_DAYWISEVIEW = { render, rows, tableHtml, bindRows };
})();

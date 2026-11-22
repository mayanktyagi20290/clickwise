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
    const fC = scale(list.map(r => r.clicks)), fI = scale(list.map(r => r.impr)), fR = scale(list.map(r => r.ctr)), fP = scale(list.map(r => r.pos));
    const dp = list.map(r => r.prev ? chg(r) : null), dw = list.map(r => r.wk ? pct(r.clicks, r.wk.clicks) : null), fD = dscale(dp.concat(dw));
    const tile = (l, v, s) => `<div class="st-sm"><span>${l}</span><b>${v}</b>${s || ''}</div>`;
    const dayTag = r => r ? `${esc(r.wd)} ${esc(r.d.slice(5))}` : '—';
    const html = head(title, sub) + tabs + `
      <div class="dw-ctl"><label class="ow-f"><span>Period</span><select id="dw-n">${OPTS.map(o => `<option value="${o[0]}"${o[0] === n ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <button type="button" class="btn-quiet" id="dw-csv">Download CSV</button></div>
      <section class="panel"><div class="panel-b st-sms">
        ${tile('Days shown', list.length)}${tile('Clicks', fmtN(tot.c))}${tile('Overall CTR', tot.i ? pctf(tot.c / tot.i * 100, 2) : '—')}
        ${tile('Days down vs day before', `${down} of ${withP.length}`)}
        ${tile('Best day', dayTag(best), best ? `<small class="dw-pill up">▲ ${chg(best).toFixed(1)}% clicks</small>` : '')}
        ${tile('Worst day', dayTag(worst), worst ? `<small class="dw-pill dn">▼ ${Math.abs(chg(worst)).toFixed(1)}% clicks</small>` : '')}</div></section>
      <section class="panel"><div class="tw"><table class="dw-t"><thead><tr class="dw-g"><th colspan="2"></th><th colspan="3">Traffic</th><th colspan="2">Change in clicks</th><th colspan="1">Rank</th></tr><tr><th scope="col">Date</th><th scope="col">Day</th><th class="r" scope="col">Clicks</th><th class="r" scope="col">Impressions</th><th class="r" scope="col">CTR</th><th class="r" scope="col">vs prev day</th><th class="r" scope="col">vs same day last wk</th><th class="r" scope="col">Avg pos</th></tr></thead><tbody>
        ${list.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<tr><td>${esc(r.d)}</td><td>${esc(r.wd)}</td><td class="r num"${heat(fC(r.clicks))}>${fmtN(r.clicks)}</td><td class="r num"${heat(fI(r.impr))}>${fmtN(r.impr)}</td><td class="r num"${heat(fR(r.ctr))}>${pctf(r.ctr, 2)}</td>${dcell(dp[i], fD)}${dcell(dw[i], fD)}<td class="r num"${heat(fP(r.pos), true)}>${r.pos != null ? r.pos.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <p class="flat dw-n">Cells are coloured within each column: green is better, red is worse (for position, lower is better). Search Console's most recent days can still be revised.</p></section>`;
    return { html, mount: () => {
      document.getElementById('dw-n').addEventListener('change', e => go(e.target.value));
      document.getElementById('dw-csv').addEventListener('click', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(list)], { type: 'text/csv' }));
        a.download = 'clickwise-day-wise.csv'; document.body.appendChild(a); a.click(); a.remove();
      });
    } };
  }
  window.CW_DAYWISEVIEW = { render, rows };
})();

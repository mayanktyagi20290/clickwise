// Command Center (#overview): the short version. Header, four KPIs, the biggest opportunity, one trend chart,
// five priorities and a compact workflow bar. It reads numbers the analysis already computed (A, D, priority
// groups, tasks) and invents nothing. The long page it replaces is still available as Performance & Trends ›
// Full analysis (#analysis), so no report or chart was removed from the application.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const { range, pctf, spark, tileDelta, chart, cssVar, rollup } = ui;
  const CW = window.CW, fmtN = CW.fmtN;
  const G = () => window.CW_GROWTH, TK = () => window.CW_TASKS, CC = () => window.CW_COMMAND;
  const full = V.overview;
  V.analysis = full;
  const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const p1 = v => v == null || isNaN(v) ? '—' : (+v).toFixed(1);
  const I = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  const ico = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;

  function kpis(A, D) {
    const cov = A.coverage && A.site, C = D.C;
    const m = cov ? A.site : A.totNB, pv = cov ? A.prevSite : (A.prev && A.prev.nb);
    const scope = cov ? 'All searches' : 'Non-branded searches';
    const card = (label, val, delta, sp) => `<div class="ov-k"><div class="ov-kl">${label}</div><div class="ov-kv num">${val}</div><div class="ov-kd">${delta || '<span></span>'}${sp || ''}</div></div>`;
    return `<section class="ov-kpis" aria-label="Performance overview">
      ${card('Organic clicks', fmtN(m.clicks), tileDelta(m.clicks, pv && pv.clicks), spark(C, 'clicks'))}
      ${card('Impressions', fmtN(m.impr), tileDelta(m.impr, pv && pv.impr), spark(C, 'impr'))}
      ${card('CTR', pctf(m.ctr, 2), tileDelta(m.ctr, pv && pv.ctr, false, 'pt'), spark(C, 'ctr'))}
      ${card('Average position', m.pos != null ? m.pos.toFixed(1) : '—', tileDelta(m.pos, pv && pv.pos, true), spark(C, 'pos', true))}
    </section><p class="ov-scope">${scope}${cov ? ', from daily totals' : ' in this data'}. ${pv ? 'Changes compare with the previous period of equal length.' : 'No previous period loaded, so changes are not shown.'}</p>`;
  }

  function biggest(P) {
    const mid = g => g.impact.kind === 'none' || g.impact.recoverable === false ? 0 : ((g.impact.lo || 0) + (g.impact.hi || 0)) / 2;
    const g = P.items.filter(x => mid(x) > 0).sort((a, b) => mid(b) - mid(a))[0];
    if (!g) return `<section class="ov-card ov-big"><div class="ov-ch"><h2>Biggest SEO opportunity</h2></div><p class="empty">No opportunity with a click estimate in this data yet.</p></section>`;
    const m = g.measured, im = g.impact, rel = (g.related || []).length;
    const ev = [g.reason || g.why || ''].concat((g.evidence || []).slice(0, 2)).filter(Boolean);
    return `<section class="ov-card ov-big"><div class="ov-ch"><h2>Biggest SEO opportunity</h2><span class="tag">${esc(g.typeLabel)}</span></div>
      <div class="ov-bg">
        <div class="ov-bt"><h3>${esc(g.subject.label)}</h3>
          <p class="ov-pg">${g.page ? `Affected page: <b>${esc(g.page.path)}</b>${rel ? ` · ${rel} related item${rel === 1 ? '' : 's'}` : ''}` : 'Affects the whole site'}</p>
          <dl><dt>GSC evidence</dt><dd><ul>${ev.map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd>
            <dt>Why it matters</dt><dd>About <b class="gainv num">${range(im.lo, im.hi)}</b> more clicks a month (an estimate, not a promise), ${esc(g.confidence.level.toLowerCase())} confidence. ${esc(im.note || '')}</dd>
            <dt>Recommended action</dt><dd>${esc(g.action)}</dd></dl></div>
        <div class="ov-bm"><div><span>Position</span><b class="num">${m.pos != null ? p1(m.pos) : '—'}</b></div><div><span>Impressions</span><b class="num">${m.impr != null ? fmtN(m.impr) : '—'}</b></div>
          <div><span>Clicks</span><b class="num">${m.clicks != null ? fmtN(m.clicks) : '—'}</b></div><div><span>CTR</span><b class="num">${m.ctr != null ? pctf(m.ctr) : '—'}</b></div>
          <a class="btn-primary" href="#opp?id=${encodeURIComponent(g.id)}">View opportunity ${ico('arrow')}</a></div></div></section>`;
  }

  function priorities(P) {
    const st = g => g.status && g.status !== 'open' ? (TK().STATUS[g.status] || g.status) : 'Open';
    const list = P.items.filter(g => !g.task || ['planned', 'progress'].includes(g.task.status)).slice(0, 5);
    return `<section class="ov-card"><div class="ov-ch"><h2>Top SEO priorities</h2><a href="#opps">All ${P.items.length.toLocaleString()} opportunities →</a></div>
      ${list.length ? `<div class="tw"><table class="ov-t"><thead><tr><th scope="col">Priority</th><th scope="col">Opportunity</th><th scope="col">Page / query</th><th scope="col">Recommended action</th><th scope="col">Status</th><th scope="col"><span class="sr">Details</span></th></tr></thead><tbody>
        ${list.map(g => `<tr><td><span class="pri ${g.priority.toLowerCase()}">${esc(g.priority)}</span></td><td><b>${esc(g.typeLabel)}</b></td>
          <td class="ov-pq" title="${esc(g.subject.label)}">${esc(g.subject.kind === 'query' ? g.subject.label : g.subject.label)}${g.subject.kind === 'query' && g.page ? `<small>${esc(g.page.path)}</small>` : ''}</td>
          <td class="ov-act">${esc(g.action)}</td><td><span class="st st-${esc(st(g).toLowerCase().replace(/\s+/g, '-'))}">${esc(st(g))}</span></td>
          <td class="r"><a href="#opp?id=${encodeURIComponent(g.id)}">View details</a></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${P.items.length ? 'Everything prioritised already has work in progress or done. <a href="#tasks">Open the Action Board</a>.' : 'No opportunities in this data yet. A longer date range or more rows gives more to work with.'}</p>`}</section>`;
  }

  V.overview = (A, D) => {
    const G_ = G();
    let P = null;
    if (G_) { try { P = G_.prio(A, D); if (P) { G_.seedDemo(D, P); P = G_.prio(A, D); } } catch (e) { P = null; } }
    const m = A.coverage && A.site ? A.site : A.totNB;
    const hasCmp = !!(D.prevStart && (A.coverage && A.prevSite ? A.prevSite : A.prev && A.prev.nb));
    const src = D.source === 'api' ? ['live', 'Live · Search Console'] : D.source === 'demo' ? ['sample', 'Sample data · fictional site'] : ['file', 'Uploaded export'];
    const head = `<header class="ov-h"><div><h1>Command Center</h1><p>Your organic growth at a glance</p></div>
      <div class="ov-ctl"><button type="button" class="ov-b" data-ov="site" title="Change property">${ico('globe')}<span>${esc(D.site)}${D.source === 'demo' ? ' (sample)' : ''}</span></button>
        <button type="button" class="ov-b" data-ov="range" title="Change dates">${ico('cal')}<span>${D.start && D.end ? `${esc(fmtDate(D.start))} – ${esc(fmtDate(D.end))}` : 'Dates not in export'}</span></button>
        <button type="button" class="ov-b ov-ref" data-ov="refresh" title="Pull the latest data">${ico('refresh')}<span>Refresh</span></button></div></header>
      <p class="ov-meta"><span class="cc-src ${src[0]}">${esc(src[1])}</span>${hasCmp ? `<span>vs ${esc(fmtDate(D.prevStart))} – ${esc(fmtDate(D.prevEnd))}</span>` : '<span>No comparison period loaded</span>'}${D.pending && (D.pending.qp || D.pending.prev || D.pending.more) ? '<span class="ov-load">Loading more data…</span>' : ''}${D.failed ? '<span class="lossv">Some data failed to load</span>' : ''}</p>`;
    if (!m || !(m.impr > 0)) {
      return { html: head + `<section class="ov-card ov-empty"><h2>No search data for this period</h2><p>${D.source === 'api' ? 'Search Console returned no impressions for this property, filter and date range. Try a longer range or a different property.' : 'This file has no search rows to show. Upload a Search Console Performance export, or connect Search Console.'}</p>
        <p><button type="button" class="btn-primary sm" data-ov="range">Change dates</button> <button type="button" class="btn-quiet" id="btn-new-ov">${D.source === 'api' ? 'Choose another property' : 'Start a new analysis'}</button></p></section>`,
        mount: () => bind(A, D) };
    }
    const trend = D.C && D.C.length ? `<section class="ov-card"><div class="ov-ch"><h2>Organic performance</h2>
        <div class="seg seg-m" role="group" aria-label="Metric"><button type="button" data-metric="clicks" class="on">Clicks</button><button type="button" data-metric="impr">Impressions</button><button type="button" data-metric="ctr">CTR</button><button type="button" data-metric="pos">Avg. position</button></div></div>
        <div class="ov-chart"><canvas id="ov-trend" aria-label="Organic performance over time"></canvas></div></section>`
      : `<section class="ov-card"><div class="ov-ch"><h2>Organic performance</h2></div><p class="empty">This export has no date data, so there is no trend. Connect Search Console or include the Dates sheet.</p></section>`;
    const html = head + kpis(A, D)
      + (P ? biggest(P) : `<section class="ov-card"><div class="ov-ch"><h2>Biggest SEO opportunity</h2></div><p class="empty">Opportunities are not available for this data.</p></section>`)
      + trend + (P ? priorities(P) : '') + (CC() && CC().workflow && P ? CC().workflow(A, D, true) : '');
    return { html, mount: () => { bind(A, D); drawTrend(D); } };
  };

  function bind(A, D) {
    const v = document.getElementById('view');
    v.querySelectorAll('[data-ov]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.ov;
      if (k === 'site') document.getElementById('top-site-btn').click();
      else if (k === 'range') document.getElementById('top-range-btn').click();
      else document.dispatchEvent(new CustomEvent('cw:refresh'));
    }));
    const n = document.getElementById('btn-new-ov'); if (n) n.addEventListener('click', () => document.getElementById(D.source === 'api' ? 'top-site-btn' : 'btn-new').click());
  }

  function drawTrend(D) {
    if (!D.C || !D.C.length || !document.getElementById('ov-trend')) return;
    const hasPrev = !!(D.prevC && D.prevC.length), LBL = { clicks: 'Clicks', impr: 'Impressions', ctr: 'CTR (%)', pos: 'Average position' };
    let metric = 'clicks';
    const cur = rollup(D.C, 'day'), prev = hasPrev ? rollup(D.prevC, 'day') : [];
    const val = r => r == null ? null : metric === 'ctr' || metric === 'pos' ? (r[metric] == null ? null : +r[metric].toFixed(2)) : r[metric];
    const ch = chart('ov-trend', { type: 'line', data: { labels: cur.map(x => x.l), datasets: [
      { label: 'This period', data: cur.map(val), borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal-soft'), fill: true, tension: .3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      { label: 'Previous period', data: cur.map((x, i) => val(prev[i])), hidden: !hasPrev, borderColor: cssVar('--muted'), borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.25 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: hasPrev, position: 'bottom', labels: { boxWidth: 12, boxHeight: 2, usePointStyle: false } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { reverse: false, grid: { color: cssVar('--line-soft') }, ticks: { callback: v => metric === 'ctr' ? v + '%' : fmtN(v) } } } } });
    if (!ch) return;
    document.querySelectorAll('.ov-card [data-metric]').forEach(b => b.addEventListener('click', () => {
      metric = b.dataset.metric;
      document.querySelectorAll('.ov-card [data-metric]').forEach(x => x.classList.toggle('on', x === b));
      ch.data.datasets[0].data = cur.map(val); ch.data.datasets[1].data = cur.map((x, i) => val(prev[i]));
      ch.options.scales.y.reverse = metric === 'pos'; ch.update();
    }));
  }
})();

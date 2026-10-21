// Clickwise SEO Growth Command Center: the top of the Dashboard. Answers, in order: is the data fresh and
// complete, what to do today, what is at risk, how much growth is realistic against the target, what is
// working, and whether past changes worked. Uses priority.js, tasks.js and the analysis; adds no new metrics.
(function () {
  'use strict';
  const { esc, ui } = window.CW_VIEWS;
  const { range, urlCell, serp, svg, pctf } = ui;
  const CW = window.CW, TK = window.CW_TASKS, fmtN = CW.fmtN;
  const G = () => window.CW_GROWTH;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const fmtDate = s => { if (!s) return '?'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const daysAgo = s => s ? Math.round((Date.now() - Date.parse(s + 'T00:00:00')) / 864e5) : null;

  function statusBar(A, D) {
    const src = D.source === 'api' ? ['live', 'Live · Search Console (read-only)'] : D.source === 'demo' ? ['sample', 'Sample data · fictional site'] : ['file', 'Uploaded export'];
    const lag = daysAgo(D.end);
    const fresh = D.source === 'demo' ? 'Generated data' : D.end ? `Data to ${fmtDate(D.end)}${lag != null ? ` (${lag <= 3 ? 'as fresh as Search Console gets, it runs 2–3 days behind' : lag + ' days ago'})` : ''}` : 'Dates not in export';
    const cov = A.coverage ? `${(100 - A.coverage.notShown.share).toFixed(0)}% of clicks attributed to listed searches` : `${A.Q.length.toLocaleString()} searches, ${A.P.length.toLocaleString()} pages`;
    const cmp = D.prevStart ? `compared with ${fmtDate(D.prevStart)} – ${fmtDate(D.prevEnd)}` : 'no comparison period (declines can’t be detected)';
    const pend = D.pending && (D.pending.qp || D.pending.prev || D.pending.more);
    return `<div class="cc-status" role="status">
      <span class="cc-src ${src[0]}">${esc(src[1])}</span>
      <span>${svg('clock')}${esc(fmtDate(D.start))} – ${esc(fmtDate(D.end))}${D.days ? ` (${D.days} days)` : ''}, ${esc(cmp)}</span>
      <span>${svg('pulse')}${esc(fresh)}${D.source !== 'demo' ? ' · <a href="#live">last 24 hours</a>' : ''}</span>
      <span>${svg('eye')}${esc(cov)}</span>
      ${pend ? '<span class="cc-pend">Still loading extra data; this page updates by itself</span>' : ''}
      ${D.failed ? `<span class="lossv">Some data failed to load</span>` : ''}
    </div>`;
  }

  function target(A, D, P) {
    const s = G().settings(D.site);
    const siteClicks = (A.site || A.totAll).clicks;
    const cur = A.perMonth(siteClicks);
    const pDays = (A.decay && A.decay.prevDays) || (D.prevC && D.prevC.length) || A.days;
    const prev = A.prevSite && A.prevSite.clicks != null ? A.prevSite.clicks * 30 / pDays : null;
    const g = P.totals.growth, r = P.totals.recovery;
    const lo = cur + g.lo + r.lo, hi = cur + g.hi + r.hi;
    const t = s.target;
    let body;
    if (t) {
      const base = t.baseline || cur;
      const prog = t.monthly > base ? Math.max(0, Math.min(1, (cur - base) / (t.monthly - base))) : cur >= t.monthly ? 1 : 0;
      const gap = t.monthly - cur;
      const reach = gap <= 0 ? 'Target reached at the current rate.' : t.monthly <= lo ? 'The opportunities found cover the gap even at their low end.' : t.monthly <= hi ? 'Reachable if the opportunities found deliver toward their high end.' : 'Above what the opportunities found can deliver: it needs new demand (new content, new pages) as well.';
      body = `<div class="cc-tgt-n"><b>${fmtN(cur)}</b><span>of ${fmtN(t.monthly)} clicks a month${t.by ? ` by ${esc(fmtDate(t.by))}` : ''}</span></div>
        <div class="cc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}"><span style="width:${(prog * 100).toFixed(1)}%"></span></div>
        <p class="flat">${Math.round(prog * 100)}% of the way from the ${fmtN(base)} a month baseline set on ${esc(fmtDate(t.set))}. ${esc(reach)}</p>`;
    } else body = `<div class="cc-tgt-n"><b>${fmtN(cur)}</b><span>clicks a month now</span></div><p class="flat">No target set yet.</p>`;
    return `<section class="panel cc-target"><div class="panel-h"><h2>Growth target</h2><button type="button" class="btn-link" id="cc-tgt-edit">${t ? 'Change' : 'Set a target'}</button></div>
      <div class="panel-b">${body}
        <div class="cc-real"><span>Realistic with what was found</span><b>${fmtN(lo)}–${fmtN(hi)}</b><small>${cur ? `+${((lo - cur) / cur * 100).toFixed(0)}% to +${((hi - cur) / cur * 100).toFixed(0)}%` : ''} a month: current clicks plus the growth (${range(g.lo, g.hi)}) and recovery (${r.n ? range(r.lo, r.hi) : 'none'}) estimates, each search counted once.${prev != null ? ` Previous period: ${fmtN(prev)} a month.` : ''}</small></div>
        <form class="cc-tgt-form" id="cc-tgt-form" hidden>
          <label class="field"><span>Monthly clicks target</span><input type="number" name="monthly" min="1" step="1" value="${t ? t.monthly : Math.round(lo)}" required></label>
          <label class="field"><span>By (optional)</span><input type="date" name="by" value="${t ? esc(t.by) : ''}"></label>
          <div class="prio-actions"><button class="btn-primary sm" type="submit">Save target</button>${t ? '<button class="btn-quiet" type="button" id="cc-tgt-clear">Remove target</button>' : ''}</div>
          <p class="flat">The baseline is today’s ${fmtN(cur)} a month. Estimates are not forecasts.</p>
        </form></div></section>`;
  }

  function doToday(A, D, P) {
    const open = P.items.filter(g => !g.task || ['planned', 'progress'].includes(g.task.status)).slice(0, 5);
    const conf = l => `<span class="tag ${l === 'High' ? 'gain' : l === 'Medium' ? 'watch' : ''}">${esc(l)} confidence</span>`;
    return `<section class="panel cc-today"><div class="panel-h"><h2>Do today</h2><a href="#priorities">All ${P.items.length} priorities</a><p>The highest Growth Priority Scores not yet done. Each is one issue, counted once; open it for the evidence.</p></div>
      ${open.length ? `<ol class="cc-list">${open.map(g => `<li>
        <div class="cc-l1">${G().priTag(g)}<span class="tag">${esc(g.category)}</span><a href="#opp?id=${encodeURIComponent(g.id)}"><b>${esc(g.subject.label)}</b></a></div>
        <p>${esc(g.action)}</p>
        <div class="cc-l2"><span class="${g.impact.kind === 'growth' ? 'gainv' : g.impact.kind === 'none' ? 'flat' : 'lossv'}">${g.impact.kind === 'none' ? 'No click estimate' : esc(range(g.impact.lo, g.impact.hi)) + ' clicks / month'}</span>${conf(g.confidence.level)}<span class="tag">${esc(g.effort.level)} effort</span>
          ${g.task ? `<a class="btn-quiet" href="#tasks?id=${encodeURIComponent(g.task.id)}">${esc(TK.STATUS[g.task.status])}</a>` : `<button type="button" class="btn-quiet" data-cc-task="${esc(g.id)}">Create task</button>`}</div></li>`).join('')}</ol>`
      : '<p class="empty">Everything prioritised already has a task in progress or done. <a href="#tasks">Open the board</a></p>'}</section>`;
  }

  function risks(A, D, P) {
    const extra = (A.signals.bad || []).filter(s => !P.risks.some(r => s.l.includes(r.subject.label)));
    return `<section class="panel cc-risk"><div class="panel-h"><h2>Risks</h2><a href="#decay">Losing ground</a><p>Data-backed declines and indexing problems, kept apart from growth ranking so they are never buried.</p></div>
      ${P.risks.length ? G().riskList(P.risks, 5) : `<p class="empty">${D.prevStart || (D.prevQ && D.prevQ.length) ? 'No meaningful declines against the previous period.' : 'No comparison period, so declines can’t be detected. Connect with “Compare with the previous period”, or upload two exports.'}${D.source !== 'file' ? ' <a href="#indexing">Inspect indexing</a> to add technical risks.' : ''}</p>`}
      ${extra.length ? `<div class="cc-also"><h3>Also worth a look</h3>${extra.slice(0, 3).map(i => `<a href="#${i.view}"><span>${esc(i.l)}</span><b>${esc(i.v)}</b></a>`).join('')}</div>` : ''}</section>`;
  }

  function working(A, D) {
    const good = A.signals.good || [];
    const rising = A.decay && A.decay.rising ? A.decay.rising.slice(0, 3) : [];
    return `<section class="panel cc-good"><div class="panel-h"><h2>What’s working</h2></div><div class="panel-b">
      ${good.length ? `<ul class="cc-ok">${good.map(i => `<li>${svg('check')}<a href="#${i.view}">${esc(i.l)}</a><b>${esc(i.v)}</b></li>`).join('')}</ul>` : '<p class="flat">Not enough data to call out strengths yet.</p>'}
      ${rising.length ? `<h3>Growing fastest</h3><ul class="cc-ok">${rising.map(r => `<li>${svg('rocket')}${urlCell(r.p, r.path)}<b class="gainv">+${fmtN(r.won)} clicks</b></li>`).join('')}</ul>` : ''}</div></section>`;
  }

  function changes(A, D) {
    const { list } = G().tasks(D.site);
    const done = list.filter(TK.measurable).sort((a, b) => b.implDate.localeCompare(a.implDate)).slice(0, 5);
    const fixes = G().fixesOf(D.site);
    return `<section class="panel cc-changes"><div class="panel-h"><h2>Did our changes work?</h2><a href="#tasks">Action board</a><p>Equal windows before and after each change, compared with the whole site. Evidence, not proof.</p></div>
      ${done.length ? `<ul class="cc-ch">${done.map(t => `<li><a href="#tasks?id=${encodeURIComponent(t.id)}"><b>${esc(t.title)}</b></a><span class="flat">live ${esc(t.implDate)}${t.owner ? ' · ' + esc(t.owner) : ''}</span><span class="cc-res" data-ccres="${esc(t.id)}"><span class="flat">Measuring…</span></span></li>`).join('')}</ul>`
        : `<p class="empty">No implemented changes recorded yet. Create a task from <b>Do today</b>, then mark it implemented with the date it went live.${fixes.length ? ` You also have ${fixes.length} change${fixes.length === 1 ? '' : 's'} in the <a href="#fixes">fix tracker</a>.` : ''}</p>`}
      ${done.length && fixes.length ? `<p class="flat cc-more">${fixes.length} more in the <a href="#fixes">fix tracker</a>.</p>` : ''}</section>`;
  }

  function html(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return statusBar(A, D);
    G().seedDemo(D, P);
    return `<div class="cc-head"><p class="cc-title">SEO Growth Command Center</p></div>${statusBar(A, D)}`;
  }
  function body(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return '';
    return `<div class="cc-grid">${doToday(A, D, P)}${target(A, D, P)}</div>
      <div class="cc-grid even">${risks(A, D, P)}${working(A, D)}</div>
      ${changes(A, D)}`;
  }
  function mount(A, D) {
    if (!G()) return;
    const P = G().prio(A, D);
    document.querySelectorAll('[data-cc-task]').forEach(b => b.addEventListener('click', () => {
      const g = P.items.find(x => x.id === b.dataset.ccTask); if (!g) return;
      const t = TK.fromOpportunity(g, D);
      if (G().upsert(D.site, t)) location.hash = '#tasks?id=' + encodeURIComponent(t.id); else b.textContent = 'Could not save';
    }));
    document.querySelectorAll('[data-ccres]').forEach(el => {
      const t = G().tasks(D.site).list.find(x => x.id === el.dataset.ccres); if (!t) return;
      G().measureTask(t).then(r => { el.innerHTML = G().resultTag(r) + (r && r.relative != null ? ` <small class="flat">${r.relative > 0 ? '+' : ''}${r.relative.toFixed(0)}% vs site</small>` : ''); });
    });
    const ed = document.getElementById('cc-tgt-edit'), f = document.getElementById('cc-tgt-form');
    if (ed && f) {
      ed.addEventListener('click', () => { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); });
      f.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(f), monthly = Math.round(+fd.get('monthly'));
        if (!(monthly > 0)) return;
        const cur = store.get('growth:' + D.site) || {};
        const by = String(fd.get('by') || '');
        G().saveSettings(D.site, { ...cur, target: { monthly, baseline: Math.round(A.perMonth((A.site || A.totAll).clicks)), set: new Date().toISOString().slice(0, 10), by: window.CW_FIXES.isDate(by) ? by : '' } });
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      const c = document.getElementById('cc-tgt-clear');
      if (c) c.addEventListener('click', () => { const cur = store.get('growth:' + D.site) || {}; delete cur.target; G().saveSettings(D.site, cur); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    }
  }
  // Implemented changes drawn on the trend chart: one dashed line per change, at its bucket.
  function markerPlugin(D, unitRef) {
    const list = G() ? TK.markers(G().tasks(D.site).list, G().fixesOf(D.site)) : [];
    const keyOf = (d, unit) => {
      if (unit === 'day') return d.slice(5);
      const x = new Date(d + 'T00:00:00');
      if (unit === 'week') { const w = new Date(x); w.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return w.toISOString().slice(5, 10); }
      return x.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    };
    return {
      id: 'cwMarkers',
      afterDatasetsDraw(chart) {
        if (!list.length) return;
        const { ctx, chartArea: a, scales: { x } } = chart, labels = chart.data.labels;
        const seen = new Set();
        list.forEach(m => {
          if (m.d < D.start || m.d > D.end) return;
          const i = labels.indexOf(keyOf(m.d, unitRef.unit)); if (i < 0 || seen.has(i)) return; seen.add(i);
          const px = x.getPixelForValue(i);
          ctx.save(); ctx.strokeStyle = ui.cssVar('--orange') || '#F97316'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
          ctx.fillStyle = ctx.strokeStyle; ctx.font = '10px ' + (ui.cssVar('--body') || 'sans-serif'); ctx.fillText('▲ change', Math.min(px + 3, a.right - 46), a.top + 10); ctx.restore();
        });
      }
    };
  }
  const hasMarkers = D => !!(G() && TK.markers(G().tasks(D.site).list, G().fixesOf(D.site)).some(m => m.d >= D.start && m.d <= D.end));

  window.CW_COMMAND = { html, body, mount, markerPlugin, hasMarkers };
})();

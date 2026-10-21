// Clickwise screens: Priorities (deduplicated, scored opportunities), opportunity detail, and the task board.
// Tasks and priority settings are kept in this browser per site; search data never is.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, pctf, posTag, urlCell, serp, range, stat } = ui;
  const CW = window.CW, PR = window.CW_PRIORITY, TK = window.CW_TASKS, FX = window.CW_FIXES, fmtN = CW.fmtN;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const hostOf = site => String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const terms = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30).map(s => s.slice(0, 80));

  // ── per-site settings: weights, priority sections and terms, growth target ──
  function settings(site) {
    const s = store.get('growth:' + site) || {};
    const w = {}; Object.keys(PR.DEFAULT_WEIGHTS).forEach(k => { const v = s.weights && +s.weights[k]; w[k] = isFinite(v) && v >= 0 && v <= 100 ? v : PR.DEFAULT_WEIGHTS[k]; });
    const t = s.target && typeof s.target === 'object' && +s.target.monthly > 0 ? { monthly: +s.target.monthly, baseline: +s.target.baseline || 0, set: String(s.target.set || '').slice(0, 10), by: FX.isDate(s.target.by) ? s.target.by : '' } : null;
    return { weights: w, focus: { sections: Array.isArray(s.focus && s.focus.sections) ? s.focus.sections.slice(0, 30).map(String) : [], terms: Array.isArray(s.focus && s.focus.terms) ? s.focus.terms.slice(0, 30).map(String) : [] }, target: t };
  }
  const saveSettings = (site, s) => { store.set('growth:' + site, s); CACHE = new WeakMap(); };

  // ── tasks ──
  function tasks(site) { return TK.load(store.get('tasks:' + site)); }
  const saveTasks = (site, list) => { const ok = store.set('tasks:' + site, list.slice(0, 300)); CACHE = new WeakMap(); return ok; };
  function upsert(site, t) { const { list } = tasks(site); const i = list.findIndex(x => x.id === t.id); if (i >= 0) list[i] = t; else list.unshift(t); return saveTasks(site, list); }
  const fixesOf = site => { const l = store.get('fixes:' + site); return Array.isArray(l) ? l.filter(f => f && FX.isDate(f.date)) : []; };
  // The sample site gets three example tasks once, so the loop can be tried without real data.
  function seedDemo(D, P) {
    if (D.source !== 'demo' || store.get('tasks-seeded:' + D.site)) return;
    store.set('tasks-seeded:' + D.site, true);
    if (tasks(D.site).list.length || !P) return;
    const pick = P.items.filter(g => g.page).slice(0, 3);
    const d = n => { const x = new Date(D.end + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    const list = pick.map((g, i) => {
      let t = TK.fromOpportunity(g, D, { owner: ['Asha', 'Rohan', ''][i] });
      if (i === 0) t = { ...TK.setStatus(TK.setStatus(t, 'progress'), 'implemented'), implDate: d(35), change: 'Rewrote the title and intro (sample task)' };
      if (i === 1) t = { ...TK.setStatus(t, 'progress'), due: d(-7) };
      if (i === 2) t = { ...t, due: d(3) };
      return t;
    });
    saveTasks(D.site, list);
  }

  // ── priorities, cached per analysis ──
  let CACHE = new WeakMap();
  function prio(A, D) {
    if (!A || !A.opps) return null;
    if (CACHE.has(A)) return CACHE.get(A);
    const s = settings(D.site);
    const runs = window.CW_SURFVIEW && window.CW_SURFVIEW.RUNS.get(D.site);
    const extraRisks = runs && runs.results.length ? PR.indexRisks(runs.results, A.P) : [];
    const P = PR.build(A, D, { weights: s.weights, focus: s.focus, outcomes: TK.outcomes(tasks(D.site).list), extraRisks });
    if (P) {
      const byOpp = new Map(tasks(D.site).list.filter(t => t.oppId).map(t => [t.oppId, t]));
      P.items.forEach(g => { const t = byOpp.get(g.id); g.task = t || null; g.status = t ? t.status : 'open'; });
      P.risks.forEach(r => { const t = byOpp.get(r.id); r.task = t || null; });
    }
    CACHE.set(A, P);
    return P;
  }
  document.addEventListener('cw:content-ready', () => { CACHE = new WeakMap(); });

  // ── measuring a task (live, never stored except the final verdict) ──
  const MEAS = new Map();
  function measureTask(t) {
    const S = window.CW_SOURCE;
    if (!S || !TK.measurable(t)) return Promise.resolve(null);
    const key = [S.kind, S.site, t.id, t.url, t.implDate, t.window].join('|');
    if (MEAS.has(key)) return MEAS.get(key);
    const w = FX.windows(t.implDate, S.latest, S.earliest, t.window);
    const s = w.before ? w.before.start : t.implDate, e = w.after ? w.after.end : t.implDate;
    const scope = t.url ? 'page' : 'site';
    if (scope === 'page' && !S.canPage) return Promise.resolve({ status: 'no-page', notes: ['This export has only whole-site daily totals, so one page cannot be measured. Connect Search Console.'] });
    const pageP = scope === 'site' ? S.siteDaily(s, e) : S.pageDaily(t.url, s, e);
    const siteP = scope === 'site' ? Promise.resolve(null) : S.siteDaily(s, e).catch(() => null);
    const p = Promise.all([pageP, siteP]).then(([pr, sr]) => {
      const r = FX.measure({ scope, url: t.url, date: t.implDate }, pr, sr, S.latest, S.earliest, { window: t.window, siteLabel: S.scope ? 'section you analysed' : 'site' });
      r.confounders = TK.confounders(t, tasks(S.site).list, fixesOf(S.site), r.window);
      // keep the verdict once the full window is in: it calibrates the priority score
      if (r.status === 'measured' && r.window.L >= t.window) {
        const cur = tasks(S.site).list.find(x => x.id === t.id);
        if (cur && (!cur.outcome || cur.outcome.verdict !== r.verdict || cur.outcome.window !== t.window)) upsert(S.site, { ...cur, outcome: { verdict: r.verdict, relative: r.relative == null ? null : +r.relative.toFixed(1), change: r.change.clicks == null ? null : +r.change.clicks.toFixed(1), at: new Date().toISOString(), window: t.window } });
      }
      return r;
    }, err => ({ status: 'error', notes: [err.message || String(err)] }));
    MEAS.set(key, p);
    return p;
  }
  const VERDICT_TONE = { improved: 'gain', 'maybe-improved': 'gain', declined: 'risk', 'maybe-declined': 'watch', 'no-change': '' };
  const resultTag = r => !r ? '' : r.status === 'measured' ? `<span class="tag ${VERDICT_TONE[r.verdict]}">${esc(FX.label(r))}</span>` : `<span class="tag">${esc(FX.STATUS[r.status] || (r.status === 'error' ? 'Could not measure' : r.status === 'no-page' ? 'Needs Search Console' : '—'))}</span>`;

  // ── shared bits ──
  const PRI_TONE = { P1: 'gain', P2: 'watch', P3: '' };
  const priTag = g => `<span class="tag ${PRI_TONE[g.priority]}" title="Growth Priority Score ${g.score}/100">${g.priority} · ${g.score}</span>`;
  const subjCell = g => g.subject.kind === 'page' ? urlCell(g.subject.url, g.subject.label) : serp(g.subject.label);
  const impactTxt = g => g.impact.kind === 'none' ? 'Check' : `${range(g.impact.lo, g.impact.hi)} ${g.impact.kind === 'recovery' ? 'recovery' : g.impact.kind === 'stake' ? 'at stake' : ''}`.trim();
  const statusTag = s => s === 'open' ? '<span class="flat">Open</span>' : `<span class="tag st-${s}">${esc(TK.STATUS[s])}</span>`;
  const INTENT = { info: 'Learning', comm: 'Comparing', trans: 'Ready to act', nav: 'Brand / navigational', other: 'Unclear' };
  const SEV = { critical: ['risk', 'Critical'], high: ['risk', 'High'], medium: ['watch', 'Medium'], watch: ['', 'Watch'] };
  window.CW_GROWTH = { prio, tasks, saveTasks, upsert, settings, saveSettings, measureTask, resultTag, priTag, impactTxt, fixesOf, SEV, seedDemo };

  // ════════ Priorities ════════
  V.priorities = (A, D) => {
    const P = prio(A, D);
    if (!P) return { html: head('Priorities', '') + '<p class="empty">Not available for this data.</p>' };
    seedDemo(D, P);
    const s = settings(D.site);
    const sections = [...new Set(P.items.map(g => g.section).filter(Boolean))].sort();
    const rows = P.items.map(g => ({ ...g, label: g.subject.label, pathS: g.page ? g.page.path : '', lo: g.impact.lo || 0, effortN: { Low: 1, Medium: 2, High: 3 }[g.effort.level], conf: g.confidence.score }));
    const cols = [
      { k: 'rank', l: '#', r: 1, f: g => g.rank },
      { k: 'score', l: 'Priority', f: g => priTag(g), csv: g => `${g.priority} (${g.score})` },
      { k: 'label', l: 'Opportunity', cls: 'q', f: g => `<span class="tag">${esc(g.category)}</span> <a class="opp-link" href="#opp?id=${encodeURIComponent(g.id)}">${esc(g.subject.label)}</a>${g.related.length ? ` <small class="flat">+${g.related.length} related signal${g.related.length === 1 ? '' : 's'}</small>` : ''}<br><small class="flat">${esc(g.why)}</small>`, csv: g => g.subject.url || g.subject.label },
      { k: 'lo', l: 'Clicks / month (est.)', r: 1, f: g => g.impact.kind === 'none' ? '<span class="flat">Check</span>' : `<span class="${g.impact.kind === 'growth' ? 'gainv' : 'lossv'}">${range(g.impact.lo, g.impact.hi)}</span>`, csv: g => impactTxt(g) },
      { k: 'conf', l: 'Confidence', f: g => `<span class="tag ${g.confidence.level === 'High' ? 'gain' : g.confidence.level === 'Medium' ? 'watch' : ''}">${esc(g.confidence.level)}</span>`, csv: g => g.confidence.level },
      { k: 'effortN', l: 'Effort', f: g => `<span class="tag">${esc(g.effort.level)}</span>`, csv: g => g.effort.level },
      { k: 'status', l: 'Status', f: g => g.task ? `<a href="#tasks?id=${encodeURIComponent(g.task.id)}">${statusTag(g.status)}</a>` : statusTag('open'), csv: g => g.status },
      { k: 'go', l: '', sort: false, csv: false, f: g => `<a class="btn-quiet" href="#opp?id=${encodeURIComponent(g.id)}">Details</a>` }
    ];
    const f = (key, label, options, test) => ({ key, label, options, test });
    const pct = n => P.items.length ? Math.round(n / P.items.length * 100) : 0;
    const wTxt = Object.entries(P.weights).map(([k, v]) => `${k} ${Math.round(v / P.wSum * 100)}%`).join(', ');
    const html = head('Priorities', `Every opportunity once, ranked by a Growth Priority Score (0–100) that weighs click potential, evidence, business relevance, time to impact and effort. Open any row for its evidence and score breakdown. ${P.merged ? `${P.merged} overlapping signal${P.merged === 1 ? ' was' : 's were'} merged into the opportunity they describe.` : ''}`) +
      `<div class="strip">${stat(P.counts.P1, 'P1: do first', 'gain')}${stat(P.counts.P2, 'P2: plan next', 'watch')}${stat(P.counts.P3, 'P3: later', '')}${stat(P.risks.length, 'risks on the separate risk path', P.risks.some(r => r.sev === 'critical') ? 'risk' : '')}</div>
      ${P.risks.length ? `<section class="panel"><div class="panel-h"><h2>Risks (${P.risks.length})</h2><a href="#overview">Dashboard</a><p>Declines and indexing problems backed by data. They are listed here whatever their growth score, so a fix-first problem is never buried.</p></div>${riskList(P.risks, 8)}</section>` : ''}
      <section class="panel">${table('t-prio', cols, rows, { sort: 'score', file: 'priorities', searchKeys: ['label', 'pathS'], placeholder: 'Filter by search or page', pageSize: 25,
        filters: [
          f('pri', 'Priority', [['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']], (g, v) => g.priority === v),
          f('cat', 'Category', [...new Set(P.items.map(g => g.category))].map(c => [c, c]), (g, v) => g.category === v),
          f('eff', 'Effort', [['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']], (g, v) => g.effort.level === v),
          f('int', 'Intent', Object.entries(INTENT), (g, v) => g.intent === v),
          f('sec', 'Section', sections.map(x => [x, x]), (g, v) => g.section === v),
          f('st', 'Status', [['open', 'Open']].concat(TK.ORDER.map(k => [k, TK.STATUS[k]])), (g, v) => g.status === v)
        ], empty: 'No opportunities match these filters.' })}</section>
      <details class="acc sv-check" id="prio-settings"><summary><span class="ico indigo">${ui.svg('target')}</span><div><h3>Scoring and business priorities</h3><p>Weights now: ${esc(wTxt)}. ${P.focusSet ? 'Priority sections or terms are set.' : 'No priority sections set: relevance is neutral.'}</p></div><span class="pill indigo">Configure</span></summary>
        <form class="panel-b prio-form" id="prio-form" autocomplete="off">
          <fieldset><legend>Weights (relative)</legend>${Object.keys(PR.DEFAULT_WEIGHTS).map(k => `<label class="field"><span>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</span><input type="number" min="0" max="100" step="5" name="w-${k}" value="${s.weights[k]}" title="${esc(PR.COMPONENTS[k])}"></label>`).join('')}</fieldset>
          <label class="field"><span>Priority sections (folders that matter most to the business, comma separated)</span><input name="sections" value="${esc(s.focus.sections.join(', '))}" placeholder="e.g. /pricing/, /products/"></label>
          <label class="field"><span>Priority terms (words in searches or URLs that signal revenue)</span><input name="terms" value="${esc(s.focus.terms.join(', '))}" placeholder="e.g. buy, price, demo"></label>
          <div class="prio-actions"><button class="btn-primary sm" type="submit">Save and re-rank</button><button class="btn-quiet" type="button" id="prio-reset">Reset to defaults</button></div>
          <ul class="prio-doc">${Object.entries(PR.COMPONENTS).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}
            <li><b>Score</b> = Σ (weight ÷ total weight × component) × 100, then × the calibration factor for the category when there are 3+ measured results. P1 ≥ 60, P2 ≥ 42, P3 below.</li>
            <li><b>Calibration</b>: ${Object.keys(P.calibration).length ? Object.entries(P.calibration).map(([k, c]) => `${esc(k)}: ${esc(c.note)}`).join('; ') : 'none yet. As tasks finish their observation window, categories whose changes keep working move up and those that do not move down (×0.7 to ×1.3).'}</li>
            <li>Business relevance uses only what you set here; Clickwise has no conversion data unless one is connected, and never assumes it.</li></ul>
        </form></details>`;
    const mount = () => {
      drawTable('t-prio');
      const form = document.getElementById('prio-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(form), w = {};
        Object.keys(PR.DEFAULT_WEIGHTS).forEach(k => { const v = Math.max(0, Math.min(100, +fd.get('w-' + k) || 0)); w[k] = v; });
        const cur = store.get('growth:' + D.site) || {};
        saveSettings(D.site, { ...cur, weights: w, focus: { sections: terms(fd.get('sections')).map(x => (x.startsWith('/') ? x : '/' + x).replace(/\/?$/, '/')), terms: terms(fd.get('terms')).map(x => x.toLowerCase()) } });
        rerender();
      });
      document.getElementById('prio-reset').addEventListener('click', () => { const cur = store.get('growth:' + D.site) || {}; saveSettings(D.site, { ...cur, weights: { ...PR.DEFAULT_WEIGHTS } }); rerender(); });
    };
    return { html, mount };
  };
  function riskList(risks, n) {
    return `<ul class="risk-l">${risks.slice(0, n).map(r => `<li><span class="tag ${SEV[r.sev][0]}">${SEV[r.sev][1]}</span><div><b>${r.id.startsWith('o:') ? `<a href="#opp?id=${encodeURIComponent(r.id)}">${esc(r.title)}</a>` : esc(r.title)}</b><p>${esc(r.detail)}</p><p class="flat">${esc(r.action)} <small>· ${esc(r.source)}</small></p></div></li>`).join('')}</ul>${risks.length > n ? `<p class="flat risk-more"><a href="#priorities">All ${risks.length} risks</a></p>` : ''}`;
  }
  window.CW_GROWTH.riskList = riskList;

  // ════════ Opportunity detail ════════
  V.opp = (A, D) => {
    const P = prio(A, D), id = params().get('id');
    const g = P && P.items.find(x => x.id === id);
    if (!g) return { html: head('Opportunity', '') + `<p class="empty">This opportunity is not in the current analysis (the data or settings may have changed). <a href="#priorities">Back to priorities</a></p>` };
    const m = g.measured || {}, pv = g.previous;
    const metric = (l, a, b, f) => `<tr><td>${l}</td><td class="r">${a == null ? '—' : f(a)}</td>${pv ? `<td class="r">${b == null ? '—' : f(b)}</td>` : ''}</tr>`;
    const per = P.period;
    const list = a => a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="flat">None.</p>';
    const target = g.page ? g.page.url : null;
    const html = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#priorities">Priorities</a><span class="sep">/</span><span>${esc(g.category)}</span></nav>
      <header class="v-head"><h1>${esc(g.subject.label)}</h1><p>${priTag(g)} <span class="tag">${esc(g.typeLabel)}</span> ${g.intent ? `<span class="tag">${esc(INTENT[g.intent])}</span>` : ''} Rank #${g.rank} of ${P.items.length}. ${esc(g.why)}</p></header>
      <div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>The issue</h2></div><div class="panel-b"><p>${esc(g.reason)}</p>
          <table class="mini"><thead><tr><th></th><th class="r">${esc(per.start || 'This period')}${per.end ? ' – ' + esc(per.end) : ''}</th>${pv ? `<th class="r">${esc(per.prevStart || 'Previous')}${per.prevEnd ? ' – ' + esc(per.prevEnd) : ''}</th>` : ''}</tr></thead><tbody>
            ${metric('Clicks', m.clicks != null ? m.clicks : m.upTo != null ? m.upTo : null, pv && pv.clicks, v => (m.clicks == null ? '≤ ' : '') + fmtN(v))}${metric('Impressions', m.impr, pv && pv.impr, fmtN)}${metric('CTR', m.ctr, pv && pv.ctr, v => pctf(v))}${metric('Position', m.pos, pv && pv.pos, v => v ? v.toFixed(1) : '—')}
          </tbody></table>
          ${g.page && g.subject.kind === 'query' ? `<p class="flat">Ranking page: ${urlCell(g.page.url, g.page.path)}</p>` : ''}
          <p class="flat">Source: ${esc(D.source === 'api' ? 'Search Console (live)' : D.source === 'demo' ? 'sample data' : 'uploaded export')}. Measured values are from Search Console; click figures per month are estimates.</p></div></section>
        <section class="panel"><div class="panel-h"><h2>What to do</h2></div><div class="panel-b"><p>${esc(g.action)}</p><p><span class="tag">${esc(g.effort.level)} effort</span> ${esc(g.effort.why)}</p>
          <div class="opp-cta">${g.task ? `<a class="btn-primary sm" href="#tasks?id=${encodeURIComponent(g.task.id)}">Open task (${esc(TK.STATUS[g.task.status])})</a>` : `<button class="btn-primary sm" type="button" id="opp-task">Create task</button>`}
          <a class="btn-quiet" href="#${esc(g.view)}">Open the full list</a>${g.subject.kind === 'query' ? `<a class="btn-quiet" href="https://www.google.com/search?q=${encodeURIComponent(g.subject.label)}" target="_blank" rel="noopener">See the results page</a>` : ''}${target ? `<a class="btn-quiet" href="${esc(target)}" target="_blank" rel="noopener">Open the page</a>` : ''}</div>
          ${g.warnings.length ? `<h4>Warnings</h4>${list(g.warnings)}` : ''}</div></section>
      </div>
      <div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>Evidence</h2></div><div class="panel-b">${list(g.evidence)}${g.related.length ? `<p class="flat">${g.related.length} other signal${g.related.length === 1 ? '' : 's'} about the same issue ${g.related.length === 1 ? 'was' : 'were'} merged here (${g.related.map(r => esc(r.typeLabel)).join(', ')}), so it is counted once.</p>` : ''}</div></section>
        <section class="panel"><div class="panel-h"><h2>Estimated impact</h2></div><div class="panel-b">
          <p class="big-n ${g.impact.kind === 'growth' ? 'gainv' : g.impact.kind === 'none' ? 'flat' : 'lossv'}">${g.impact.kind === 'none' ? 'No click estimate' : esc(range(g.impact.lo, g.impact.hi)) + ' clicks / month'}</p>
          <p>${esc(g.impact.note)}.${g.impact.basis ? ' ' + esc(g.impact.basis) + '.' : ''}</p>${g.impact.overlap ? `<p class="flat">${esc(g.impact.overlap)}.</p>` : ''}
          <p class="flat">Method: impressions × the CTR this site earns at the target position (its own curve where it has enough data, otherwise an industry benchmark), minus current clicks, as a monthly figure. Low and high ends use cautious and optimistic targets; large outliers are capped. It is an estimate, not a forecast.</p></div></section>
      </div>
      <div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>Priority score: ${g.score}/100</h2><a href="#priorities">Change weights</a></div><div class="panel-b flush">
          <table class="mini"><thead><tr><th>Component</th><th class="r">Value</th><th class="r">Weight</th><th class="r">Points</th></tr></thead><tbody>
          ${g.parts.map(p => `<tr><td><b>${esc(p.key)}</b><br><small class="flat">${esc(p.why)}</small></td><td class="r">${p.value.toFixed(2)}</td><td class="r">${Math.round(p.weight / P.wSum * 100)}%</td><td class="r">${p.points.toFixed(1)}</td></tr>`).join('')}
          ${g.calibration && g.calibration.factor !== 1 ? `<tr><td colspan="3">Calibration from measured results (${esc(g.calibration.note)})</td><td class="r">×${g.calibration.factor}</td></tr>` : ''}</tbody></table></div></section>
        <section class="panel"><div class="panel-h"><h2>Confidence: ${esc(g.confidence.level)} (${g.confidence.score}/100)</h2></div><div class="panel-b"><ul class="why">${g.confidence.why.map(w => `<li><b class="${w.points >= 0 ? 'up' : 'down'}">${w.points > 0 ? '+' : ''}${w.points}</b> ${esc(w.text)}</li>`).join('')}</ul></div></section>
      </div>`;
    const mount = () => {
      const b = document.getElementById('opp-task');
      if (b) b.addEventListener('click', () => { const t = TK.fromOpportunity(g, D); if (upsert(D.site, t)) location.hash = '#tasks?id=' + encodeURIComponent(t.id); else b.textContent = 'Could not save (browser storage is full or blocked)'; });
    };
    return { html, mount };
  };

  // ════════ Task board ════════
  V.tasks = (A, D) => {
    const S = window.CW_SOURCE || {};
    const { list, damaged } = tasks(D.site);
    const id = params().get('id');
    if (id) return taskDetail(A, D, list.find(t => t.id === id));
    const sum = TK.summary(list);
    const lanes = ['planned', 'progress', 'implemented', 'validated'];
    const card = t => `<li class="tk-card${TK.overdue(t) ? ' late' : ''}" data-tk="${esc(t.id)}"><a href="#tasks?id=${encodeURIComponent(t.id)}"><b>${esc(t.title)}</b></a>
        <div class="tk-meta">${t.priority ? `<span class="tag ${PRI_TONE[t.priority]}">${t.priority}</span>` : ''}${t.owner ? `<span>${esc(t.owner)}</span>` : '<span class="flat">No owner</span>'}${t.due ? `<span class="${TK.overdue(t) ? 'lossv' : ''}">due ${esc(t.due)}</span>` : ''}${t.implDate ? `<span>live ${esc(t.implDate)}</span>` : ''}</div>
        ${t.estimate && t.estimate.hi ? `<small class="flat">Estimate ${esc(range(t.estimate.lo, t.estimate.hi))} clicks / month</small>` : ''}
        ${TK.measurable(t) ? `<div class="tk-res" data-tkres="${esc(t.id)}"><span class="flat">Measuring…</span></div>` : ''}
        <label class="tk-move"><span class="sr">Status</span><select data-tkst="${esc(t.id)}">${TK.ORDER.map(k => `<option value="${k}"${k === t.status ? ' selected' : ''}>${esc(TK.STATUS[k])}</option>`).join('')}</select></label></li>`;
    const html = head('Action board', 'Turn opportunities into tasks, record what changed and when, and see whether it worked. Results compare equal windows before and after the change, against the rest of the site.') +
      `<div class="strip">${stat(sum.open, 'open tasks', '')}${stat(sum.overdue, 'overdue', sum.overdue ? 'risk' : '')}${stat(sum.implemented, 'implemented, being measured', 'watch')}${stat(sum.validated, 'validated', 'gain')}</div>
      ${damaged ? `<div class="note warn">${damaged} saved task${damaged === 1 ? ' was' : 's were'} damaged and left out.</div>` : ''}
      ${S.kind === 'demo' ? '<p class="flat">Sample site: the first three tasks are examples you can edit or delete.</p>' : S.kind === 'file' ? '<p class="flat">Uploaded export: results can be measured for whole-site changes only. Connect Search Console to measure single pages.</p>' : ''}
      <div class="tk-board">${lanes.map(l => { const ts = list.filter(t => t.status === l); return `<section class="tk-lane"><h2>${esc(TK.STATUS[l])} <span class="pill indigo">${ts.length}</span></h2><ul>${ts.map(card).join('') || '<li class="flat tk-empty">None</li>'}</ul></section>`; }).join('')}</div>
      ${sum.byStatus.dropped ? `<p class="flat">${sum.byStatus.dropped} dropped task${sum.byStatus.dropped === 1 ? '' : 's'}: <a href="#tasks?status=dropped">show</a></p>` : ''}
      ${params().get('status') === 'dropped' ? `<section class="panel"><div class="panel-h"><h2>Dropped</h2></div><ul class="tk-drop">${list.filter(t => t.status === 'dropped').map(card).join('')}</ul></section>` : ''}
      <section class="panel"><div class="panel-h"><h2>Add a task by hand</h2><p>For work that did not come from an opportunity. To start from one, open <a href="#priorities">Priorities</a> and choose “Create task”.</p></div>
        <form class="panel-b tk-form" id="tk-add" autocomplete="off">
          <label class="field"><span>Task</span><input name="title" maxlength="300" required placeholder="e.g. Add FAQ schema to guides"></label>
          <label class="field"><span>Page (optional, full address)</span><input name="url" type="url" placeholder="https://${esc(hostOf(D.site))}/…"></label>
          <label class="field"><span>Owner</span><input name="owner" maxlength="80"></label>
          <label class="field"><span>Due</span><input name="due" type="date"></label>
          <button class="btn-primary sm" type="submit">Add task</button><p class="sf-err" id="tk-add-err" role="alert"></p>
        </form></section>
      <p class="flat tk-io">Tasks are kept in this browser only. <button type="button" class="btn-link" id="tk-export">Download a backup</button> · <label class="btn-link" for="tk-import">restore from a backup</label><input type="file" id="tk-import" accept=".json" hidden></p>`;
    const mount = () => {
      list.filter(TK.measurable).forEach(t => measureTask(t).then(r => { const el = document.querySelector(`[data-tkres="${CSS.escape(t.id)}"]`); if (el) el.innerHTML = resultTag(r) + (r && r.relative != null ? ` <small class="flat">${r.relative > 0 ? '+' : ''}${r.relative.toFixed(0)}% vs site</small>` : r && r.change && r.change.clicks != null ? ` <small class="flat">${r.change.clicks > 0 ? '+' : ''}${r.change.clicks.toFixed(0)}% clicks</small>` : ''); }));
      document.querySelectorAll('[data-tkst]').forEach(sel => sel.addEventListener('change', () => {
        const t = list.find(x => x.id === sel.dataset.tkst); if (!t) return;
        const next = TK.setStatus(t, sel.value);
        const errs = TK.validate(next, { host: hostOf(D.site) });
        if (errs.length && sel.value === 'validated') { location.hash = '#tasks?id=' + encodeURIComponent(t.id) + '&msg=' + encodeURIComponent(errs[0]); return; }
        upsert(D.site, next); rerender();
      }));
      const form = document.getElementById('tk-add');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(form), t = TK.manual({ title: String(fd.get('title') || ''), url: String(fd.get('url') || '').trim() || null, owner: String(fd.get('owner') || ''), due: String(fd.get('due') || '') }, D);
        const errs = TK.validate(t, { host: hostOf(D.site) });
        if (errs.length) { document.getElementById('tk-add-err').textContent = errs.join(' '); return; }
        upsert(D.site, t); rerender();
      });
      document.getElementById('tk-export').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'clickwise', site: D.site, exported: new Date().toISOString(), tasks: tasks(D.site).list }, null, 2)], { type: 'application/json' }));
        a.download = `clickwise-tasks-${hostOf(D.site)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      document.getElementById('tk-import').addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          if (f.size > 2e6) throw new Error('too large');
          const j = JSON.parse(await f.text()), got = TK.load(j && j.tasks);
          const cur = tasks(D.site).list, ids = new Set(cur.map(t => t.id));
          saveTasks(D.site, cur.concat(got.list.filter(t => !ids.has(t.id)))); rerender();
        } catch (x) { alert('That file is not a Clickwise task backup.'); }
      });
    };
    return { html, mount };
  };

  function taskDetail(A, D, t) {
    if (!t) return { html: head('Task', '') + '<p class="empty">This task no longer exists. <a href="#tasks">Back to the board</a></p>' };
    const S = window.CW_SOURCE || {}, msg = params().get('msg');
    const b = t.baseline;
    const html = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#tasks">Action board</a><span class="sep">/</span><span>${esc(t.title)}</span></nav>
      <header class="v-head"><h1>${esc(t.title)}</h1><p>${t.priority ? `<span class="tag ${PRI_TONE[t.priority]}">${t.priority}${t.score != null ? ' · ' + t.score : ''}</span> ` : ''}<span class="tag st-${t.status}">${esc(TK.STATUS[t.status])}</span> ${t.subject.url ? urlCell(t.subject.url, t.subject.label) : esc(t.subject.label)}${t.oppId ? ` · <a href="#opp?id=${encodeURIComponent(t.oppId)}">Opportunity</a>` : ''}</p></header>
      ${msg ? `<div class="note warn">${esc(msg)}</div>` : ''}
      <div class="grid-2">
        <section class="panel"><div class="panel-h"><h2>Task</h2></div>
          <form class="panel-b tk-edit" id="tk-edit" autocomplete="off">
            <label class="field tk-wide"><span>Title</span><input name="title" maxlength="300" value="${esc(t.title)}" required></label>
            <label class="field"><span>Status</span><select name="status">${TK.ORDER.map(k => `<option value="${k}"${k === t.status ? ' selected' : ''}>${esc(TK.STATUS[k])}</option>`).join('')}</select></label>
            <label class="field"><span>Owner</span><input name="owner" maxlength="80" value="${esc(t.owner)}"></label>
            <label class="field"><span>Due</span><input name="due" type="date" value="${esc(t.due)}"></label>
            <label class="field"><span>Date the change went live</span><input name="implDate" type="date" value="${esc(t.implDate)}" max="${new Date().toISOString().slice(0, 10)}"></label>
            <label class="field"><span>Observation window</span><select name="window">${TK.WINDOWS.map(w => `<option value="${w}"${w === t.window ? ' selected' : ''}>${w} days before and after</option>`).join('')}</select></label>
            <label class="field tk-wide"><span>Recommended action</span><textarea name="action" rows="2" maxlength="1000">${esc(t.action)}</textarea></label>
            <label class="field tk-wide"><span>What was actually changed</span><textarea name="change" rows="3" maxlength="1000" placeholder="e.g. New title “…”, added FAQ section, 4 internal links from …">${esc(t.change)}</textarea></label>
            <div class="tk-wide prio-actions"><button class="btn-primary sm" type="submit">Save</button><button class="btn-quiet danger" type="button" id="tk-del">Delete task</button></div>
            <p class="sf-err tk-wide" id="tk-err" role="alert"></p>
          </form></section>
        <section class="panel"><div class="panel-h"><h2>Baseline</h2><p>Captured when the task was created.</p></div><div class="panel-b">
          ${b && b.clicks != null ? `<table class="mini"><tbody><tr><td>Period</td><td class="r">${esc(b.start || '?')} – ${esc(b.end || '?')}</td></tr><tr><td>Clicks</td><td class="r">${fmtN(b.clicks)}${b.perDay != null ? ` (${b.perDay.toFixed(1)} a day)` : ''}</td></tr><tr><td>Impressions</td><td class="r">${fmtN(b.impr)}</td></tr><tr><td>CTR</td><td class="r">${pctf(b.ctr)}</td></tr><tr><td>Position</td><td class="r">${b.pos ? b.pos.toFixed(1) : '—'}</td></tr></tbody></table>` : '<p class="flat">No baseline: this task was added by hand. The measurement below uses the days before the change instead.</p>'}
          ${t.estimate && t.estimate.hi ? `<p class="flat">Estimated when created: ${esc(range(t.estimate.lo, t.estimate.hi))} clicks / month.</p>` : ''}
          <h4>History</h4><ul class="tk-hist">${t.history.map(h => `<li>${esc(TK.STATUS[h.status])} <small class="flat">${esc(new Date(h.at).toLocaleString())}</small></li>`).join('')}</ul></div></section>
      </div>
      <section class="panel"><div class="panel-h"><h2>Result</h2><p>${TK.measurable(t) ? `Daily clicks on ${t.url ? 'this page' : `the whole ${S.scope ? 'section' : 'site'}`}, ${t.window} days before vs after ${esc(t.implDate)} (the change day is left out).` : 'Set the status to Implemented and add the date it went live to start measuring.'}</p></div>
        <div class="panel-b" id="tk-result" aria-live="polite">${TK.measurable(t) ? '<p class="flat">Measuring…</p>' : ''}</div></section>`;
    const mount = () => {
      const form = document.getElementById('tk-edit'), err = document.getElementById('tk-err');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(form);
        let next = { ...t, title: String(fd.get('title') || '').trim(), owner: String(fd.get('owner') || ''), due: String(fd.get('due') || ''), implDate: String(fd.get('implDate') || ''), window: +fd.get('window'), action: String(fd.get('action') || ''), change: String(fd.get('change') || ''), updated: new Date().toISOString() };
        next = TK.setStatus(next, String(fd.get('status')));
        next = TK.normalise(next);
        const errs = TK.validate(next, { host: hostOf(D.site) });
        if (errs.length) { err.textContent = errs.join(' '); return; }
        if (!upsert(D.site, next)) { err.textContent = 'Could not save: browser storage is full or blocked.'; return; }
        location.hash = '#tasks?id=' + encodeURIComponent(t.id); rerender();
      });
      document.getElementById('tk-del').addEventListener('click', () => { if (!confirm('Delete this task?')) return; saveTasks(D.site, tasks(D.site).list.filter(x => x.id !== t.id)); location.hash = '#tasks'; });
      if (!TK.measurable(t)) return;
      measureTask(t).then(r => {
        const el = document.getElementById('tk-result'); if (!el || !r) return;
        const pd = v => v == null ? '—' : v.toFixed(1);
        const sg = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%';
        el.innerHTML = `<p class="tk-verdict">${resultTag(r)}</p>
          ${r.before ? `<table class="mini"><thead><tr><th></th><th class="r">Before (${esc(r.window.before.start)} – ${esc(r.window.before.end)})</th><th class="r">After (${esc(r.window.after.start)} – ${esc(r.window.after.end)})</th><th class="r">Change</th></tr></thead><tbody>
            <tr><td>Clicks a day</td><td class="r">${pd(r.before.perDay)}</td><td class="r">${pd(r.after.perDay)}</td><td class="r">${sg(r.change.clicks)}</td></tr>
            <tr><td>Impressions</td><td class="r">${fmtN(r.before.impr)}</td><td class="r">${fmtN(r.after.impr)}</td><td class="r">${sg(r.change.impr)}</td></tr>
            <tr><td>CTR</td><td class="r">${pctf(r.before.ctr)}</td><td class="r">${pctf(r.after.ctr)}</td><td class="r">${r.change.ctr == null ? '—' : (r.change.ctr > 0 ? '+' : '') + r.change.ctr.toFixed(2) + ' pts'}</td></tr>
            ${r.site ? `<tr><td>Whole ${esc(r.site.label)}, clicks a day</td><td class="r">${pd(r.site.before.perDay)}</td><td class="r">${pd(r.site.after.perDay)}</td><td class="r">${sg(r.site.change)}</td></tr><tr><td><b>Change relative to the ${esc(r.site.label)}</b></td><td></td><td></td><td class="r"><b>${sg(r.relative)}</b></td></tr>` : ''}
          </tbody></table>` : ''}
          ${r.z != null ? `<p class="flat">Difference of ${Math.abs(r.z).toFixed(1)} standard errors in daily clicks. A clear result needs 2 or more and a move bigger than the site's own.</p>` : ''}
          ${(r.notes || []).length ? `<ul class="flat">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${r.confounders && r.confounders.length ? `<h4>Other possible causes in these windows</h4><ul>${r.confounders.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
          <p class="note"><b>Correlation, not proof.</b> This compares periods; it cannot rule out Google updates, seasonality, competitors or other edits. Validate the task when the result holds over the full window.</p>
          ${t.status === 'implemented' && r.status === 'measured' ? `<button class="btn-primary sm" type="button" id="tk-validate">Mark as validated</button>` : ''}`;
        const v = document.getElementById('tk-validate');
        if (v) v.addEventListener('click', () => {
          const cur = tasks(D.site).list.find(x => x.id === t.id) || t;
          const next = TK.setStatus({ ...cur, outcome: { verdict: r.verdict, relative: r.relative == null ? null : +r.relative.toFixed(1), change: r.change.clicks == null ? null : +r.change.clicks.toFixed(1), at: new Date().toISOString(), window: r.window.L } }, 'validated');
          upsert(D.site, next); location.hash = '#tasks?id=' + encodeURIComponent(t.id); rerender();
        });
      });
    };
    return { html, mount };
  }
})();

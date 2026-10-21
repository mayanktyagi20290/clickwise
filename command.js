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

  // ── shared bits: tooltips, the definitions they show, and the priority level as bars ──
  const DEF = {
    observed: 'Clicks a month measured in the loaded period: all searches, branded included, from Search Console’s daily totals, scaled to 30 days. A fact, not an estimate.',
    target: 'The monthly clicks you want to reach, by a date you choose. Progress is measured only from data that ends after the target was set.',
    opportunity: 'Extra clicks a month the opportunities found could add if implemented. Each search is counted once; page estimates that overlap their searches, and declines that are probably not recoverable, are left out.',
    forecast: 'Observed clicks plus the opportunity, as conservative, expected and optimistic scenarios. An estimate of what is possible if the work is done, not a prediction of what will happen.',
    confidence: 'How much evidence is behind the number: data volume, how long the period is, where expected CTR comes from, and known results-page effects. High 70+, Medium 45–69, Low below.',
    score: 'Growth Priority Score, 0–100: click potential, evidence, business relevance, time to impact and effort, weighted. P1 is 60+, P2 42+, P3 below.',
    adds: 'What this action adds to the forecast after removing overlaps with other actions. Zero when another action already counts the same clicks.'
  };
  const tip = (k, label) => `<span class="tip" tabindex="0" role="img" aria-label="${esc((label ? label + ': ' : '') + DEF[k])}" data-tip="${esc(DEF[k])}">?</span>`;
  const LEVEL = { P1: ['high', 'High'], P2: ['med', 'Medium'], P3: ['low', 'Low'] };
  const bars = g => `<span class="pbar ${LEVEL[g.priority][0]}" title="${esc(g.priority + ' · Growth Priority Score ' + g.score + '/100')}"><i></i><i></i><i></i><b>${LEVEL[g.priority][1]}</b><small>${g.priority} · ${g.score}</small></span>`;
  const confTag = l => `<span class="tag ${l === 'High' ? 'gain' : l === 'Medium' ? 'watch' : ''}">${esc(l)} confidence</span>`;
  const forecastOf = (A, D) => { const F = window.CW_FORECAST; if (!F || !A.opps) return null; if (!FC.has(A)) FC.set(A, F.build(A, D)); return FC.get(A); };
  const FC = new WeakMap();

  // ── first session: what to do first, and what kind of data this is ──
  function guide(A, D, P) {
    if (store.get('cc-guide-off:' + D.site)) return '';
    const s = G().settings(D.site), top = P.items.find(g => !g.task || ['planned', 'progress'].includes(g.task.status)); // the same item Do today features
    const src = D.source === 'demo' ? `<b>This is a fictional sample site.</b> Look around, then <button type="button" class="btn-link" data-cc-connect>connect Search Console or upload an export</button> to see your own numbers.`
      : D.source === 'api' ? '<b>Live from Search Console</b>, read-only. Figures are as fresh as Search Console (2–3 days behind).'
      : '<b>From an uploaded export.</b> Single pages can’t be measured after a change; connect Search Console for that.';
    const done = [true, !top || !!top.task, !!s.target];
    return `<section class="cc-guide" aria-labelledby="cc-guide-h"><div class="cc-guide-h"><p id="cc-guide-h"><b>Start here</b> · three steps, about five minutes</p><button type="button" class="btn-link" id="cc-guide-x">Hide</button></div>
      <ol>
        <li class="${done[0] ? 'ok' : ''}"><span>1</span><div><b>Check the data</b><p>${src}</p></div></li>
        <li class="${done[1] ? 'ok' : ''}"><span>2</span><div><b>Start the top action</b><p>${top ? (top.task ? `“${esc(top.subject.label)}” is ranked first and already has a task (${esc(TK.STATUS[top.task.status])}). Open <i>Why and how</i> below for the evidence and steps.` : `“${esc(top.subject.label)}” is ranked first. Open <i>Why and how</i> below for the evidence and steps, then press <b>Create task</b>.`) : 'Every priority already has a task. Open the <a href="#tasks">Action board</a>.'}</p></div></li>
        <li class="${done[2] ? 'ok' : ''}"><span>3</span><div><b>Set a growth target</b><p>Pick a monthly click number and a date. Clickwise shows whether the opportunities found can reach it.</p></div></li>
      </ol></section>`;
  }

  // ── why and how: the explanation under each action ──
  function explainBlock(g, A, D, F) {
    const X = window.CW_EXPLAIN; if (!X) return '';
    const e = X.build(g, A, D, F);
    const li = a => a.map(x => `<li>${x}</li>`).join('');
    return `<details class="cc-why"><summary>Why and how</summary><div class="cc-why-b">
      <p class="cc-why-l">${esc(e.why)}</p>
      <div class="cc-why-g">
        <div><h4>Evidence</h4><ul class="ev">${li(e.evidence.slice(0, 6).map(v => `<span class="src ${v.source === 'Crawler' ? 'crawl' : 'gsc'}">${esc(v.source === 'Crawler' ? 'Crawl' : 'GSC')}</span>${esc(v.text)}`))}</ul>
          ${!e.crawlLoaded ? '<p class="flat">No crawl data loaded. <a href="#content?tab=titles">Upload a crawler export</a> to add title, meta and status checks.</p>' : !e.crawl && e.urls.length ? '<p class="flat">This page is not in the crawl you uploaded.</p>' : ''}</div>
        <div><h4>Affected searches and pages</h4>
          ${e.queries.length ? `<ul class="aff">${li(e.queries.slice(0, 5).map(q => `${serp(q.q)}${q.impr != null ? ` <small class="flat">${fmtN(q.impr)} impr.${q.pos ? ` · pos ${(+q.pos).toFixed(1)}` : ''}</small>` : ''}`))}</ul>` : ''}
          ${e.urls.length ? `<ul class="aff">${li(e.urls.slice(0, 4).map(u => `${urlCell(u.url, u.path)} <small class="flat">${esc(u.why)}</small>`))}</ul>` : '<p class="flat">No page linked to this search in the loaded data.</p>'}
          ${e.needsQP && g.subject.kind === 'query' ? '<p class="flat">Which page ranks for each search needs a Search Console connection.</p>' : ''}</div>
      </div>
      <h4>How to implement</h4><ol class="steps">${li(e.steps.map(esc))}</ol>
      <p class="cc-why-f">${e.impact.kind === 'none' ? 'No click estimate' : `Estimate ${esc(range(e.impact.lo, e.impact.hi))} clicks / month`}${e.impact.contribution ? ` · adds ${e.impact.contribution.hi > 0 ? esc(range(e.impact.contribution.lo, e.impact.contribution.hi)) : 'nothing'} to the forecast${e.impact.contribution.hi > 0 ? '' : ` (${esc(e.impact.contribution.note)})`}` : ''} · ${esc(e.confidence.level)} confidence (${e.confidence.score}/100) · ${esc(e.effort.level)} effort: ${esc(e.effort.why)} · <a href="${e.link}">Full detail and score</a></p>
    </div></details>`;
  }

  // ── Do today: the five highest-scoring open opportunities, the first one featured ──
  function doToday(A, D, P) {
    const F = forecastOf(A, D);
    const open = P.items.filter(g => !g.task || ['planned', 'progress'].includes(g.task.status)).slice(0, 5);
    const taskBtn = g => g.task ? `<a class="btn-quiet" href="#tasks?id=${encodeURIComponent(g.task.id)}">${esc(TK.STATUS[g.task.status])} · open task</a>` : `<button type="button" class="${g === open[0] ? 'btn-primary sm' : 'btn-quiet'}" data-cc-task="${esc(g.id)}">Create task</button>`;
    const adds = g => { if (!F) return ''; const c = window.CW_FORECAST.groupContribution(g, F); return c.hi > 0 ? `<span class="gainv cc-adds">${esc(range(c.lo, c.hi))}<small> clicks / mo</small></span>` : `<span class="flat cc-adds" title="${esc(c.note)}">${g.impact.kind === 'none' ? 'No click estimate' : 'Overlaps another action'}</span>`; };
    const item = (g, i) => `<li class="${i === 0 ? 'cc-top' : ''}">
        ${i === 0 ? '<p class="cc-top-k">Top priority action</p>' : ''}
        <div class="cc-row">${bars(g)}
          <div class="cc-main"><div class="cc-l1"><a href="#opp?id=${encodeURIComponent(g.id)}"><b>${esc(g.subject.label)}</b></a><span class="tag cat">${esc(g.category)}</span></div>
            <p>${esc(g.action)}</p>
            <div class="cc-l2">${confTag(g.confidence.level)}<span class="tag">${esc(g.effort.level)} effort</span>${g.page && g.subject.kind === 'query' ? `<span class="flat">${esc(g.page.path)}</span>` : ''}</div></div>
          <div class="cc-side">${adds(g)}${taskBtn(g)}</div></div>
        ${explainBlock(g, A, D, F)}</li>`;
    return `<section class="panel cc-today"><div class="panel-h"><h2>Do today</h2><a href="#priorities">All ${P.items.length} priorities</a><p>Open priorities ranked by Growth Priority Score ${tip('score', 'Score')}. Each issue appears once; “clicks / mo” is what it adds to the forecast ${tip('adds', 'Adds')}.</p></div>
      ${open.length ? `<ol class="cc-list">${open.map(item).join('')}</ol><p class="sr" role="status" aria-live="polite" id="cc-live"></p>`
      : P.items.length ? '<p class="empty">Everything prioritised already has a task in progress or done. <a href="#tasks">Open the Action board</a></p>'
      : `<p class="empty">No opportunities in this data yet. ${D.source === 'file' ? 'Exports with more searches, or a Search Console connection, give more to work with.' : 'Try a longer date range.'}</p>`}</section>`;
  }

  // ── Growth target: observed, target, opportunity and forecast kept apart ──
  function target(A, D, P) {
    const FC_ = window.CW_FORECAST, F = forecastOf(A, D);
    if (!FC_ || !F || !F.scenarios) return `<section class="panel cc-target"><div class="panel-h"><h2>Growth target</h2></div><p class="empty">A forecast needs the opportunity analysis, which this data could not produce.</p></section>`;
    const s = G().settings(D.site), t = FC_.normaliseTarget(s.target), valid = FC_.isValidTarget(t);
    const b = F.base, sc = F.scenarios, o = F.opp;
    const cur = b.recent && D.end && t && D.end > (t.dataEnd || t.set) ? b.recent.last : b.monthly;
    const pr = FC_.progress(t, cur, D.end), fz = valid ? FC_.feasibility(t, F) : null;
    const sug = FC_.suggest(F);
    const pct = v => v == null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
    const tile = (k, label, val, sub, cls) => `<div class="cc-kpi ${cls || ''}"><span>${label} ${tip(k, label)}</span><b>${val}</b><small>${sub}</small></div>`;
    const tgtTile = t ? tile('target', 'Target', fmtN(t.monthly), valid ? `by ${esc(fmtDate(t.by))}` : '<span class="lossv">needs a date</span>', 'tgt') : `<div class="cc-kpi tgt empty"><span>Target ${tip('target', 'Target')}</span><b>—</b><small><button type="button" class="btn-link" data-cc-tgt-open>Set a target</button></small></div>`;
    const progressHtml = !t ? '' : pr.status === 'invalid' || pr.status === 'waiting' ? `<p class="cc-prog-note">${esc(pr.note)}</p>`
      : `<div class="cc-bar ${pr.status}" role="progressbar" aria-label="Progress to target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pr.frac * 100)}"><span style="width:${(pr.frac * 100).toFixed(1)}%"></span><i style="left:${(pr.timeFrac * 100).toFixed(1)}%" title="Time used"></i></div>
        <p class="cc-prog-note"><b class="${pr.status === 'behind' ? 'lossv' : 'gainv'}">${pr.status === 'reached' ? 'Target reached' : pr.status === 'on-track' ? 'On track' : 'Behind'}</b> · ${esc(pr.note)} Current = last 28 days, as a monthly rate.</p>`;
    const bv = new Date(); bv.setDate(bv.getDate() + 90);
    const defBy = t && t.by ? t.by : sug.by || bv.toISOString().slice(0, 10);
    return `<section class="panel cc-target"><div class="panel-h"><h2>Growth target</h2>${t ? '<button type="button" class="btn-link" id="cc-tgt-edit">Change</button>' : ''}</div>
      <div class="panel-b">
        <div class="cc-kpis">
          ${tile('observed', 'Now', fmtN(b.monthly), `clicks / mo · observed${b.assumed ? ' (dates assumed)' : ''}`, 'now')}
          ${tgtTile}
          ${tile('opportunity', 'Opportunity', o.growth.hi + o.recovery.hi > 0 ? range(o.growth.lo + o.recovery.lo, o.growth.hi + o.recovery.hi) : '0', `${o.growth.n} searches${A.decay ? (o.recovery.n ? ` · ${o.recovery.n} recoveries` : o.deduped.hi > 0 ? ' · recovery already in growth' : ' · no recoverable declines') : ''} · estimate`, 'opp')}
          ${tile('forecast', 'Forecast', fmtN(sc.expected.monthly), `${fmtN(sc.conservative.monthly)}–${fmtN(sc.optimistic.monthly)} · ${esc(F.confidence.level)} confidence`, 'fc')}
        </div>
        ${progressHtml}
        ${fz ? `<p class="cc-feas ${fz.level}">${esc(fz.text)}</p>` : ''}
        ${!t ? (sug.value ? `<div class="cc-sug"><p><b>Suggested: ${fmtN(sug.value)} clicks a month by ${esc(fmtDate(sug.by))}</b><br><small>${esc(sug.why)}</small></p><button type="button" class="btn-primary sm" data-cc-tgt-open data-v="${sug.value}" data-by="${sug.by}">Use or adjust</button></div>`
          : `<div class="cc-sug none"><p><b>No target suggested.</b> <small>${esc(sug.why)}</small></p><button type="button" class="btn-quiet" data-cc-tgt-open>Set my own</button></div>`) : ''}
        <form class="cc-tgt-form" id="cc-tgt-form" hidden novalidate>
          <label class="field"><span>Monthly clicks to reach</span><input type="number" name="monthly" min="1" step="1" inputmode="numeric" value="${t ? t.monthly : sug.value || ''}" required></label>
          <label class="field"><span>Reach it by</span><select name="period"><option value="90">3 months</option><option value="180">6 months</option><option value="365">12 months</option><option value="custom">Pick a date</option></select></label>
          <label class="field" data-cc-custom hidden><span>Date</span><input type="date" name="by" value="${esc(defBy)}"></label>
          <div class="prio-actions"><button class="btn-primary sm" type="submit">Save target</button><button class="btn-quiet" type="button" id="cc-tgt-cancel">Cancel</button>${t ? '<button class="btn-quiet danger" type="button" id="cc-tgt-clear">Remove target</button>' : ''}</div>
          <p class="sf-err" id="cc-tgt-err" role="alert"></p>
          <p class="flat">Baseline: today’s ${fmtN(b.monthly)} clicks a month. Expected forecast ${fmtN(sc.expected.monthly)} (${pct(sc.expected.pct)}).</p>
        </form>
        <details class="cc-method"><summary>How this forecast is calculated</summary><div>
          <table class="mini"><thead><tr><th>Scenario</th><th class="r">Clicks / mo</th><th class="r">vs now</th></tr></thead><tbody>
            ${[['conservative', 'Conservative'], ['expected', 'Expected'], ['optimistic', 'Optimistic']].map(([k, l]) => `<tr><td>${l}</td><td class="r">${fmtN(sc[k].monthly)}</td><td class="r">${pct(sc[k].pct)}</td></tr>`).join('')}</tbody></table>
          <h4>Method</h4><ul>${F.method.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
          <h4>Assumptions</h4><ul>${F.assumptions.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
          ${F.excluded.length ? `<h4>Left out to avoid double counting or over-promising</h4><ul>${F.excluded.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          <h4>Confidence: ${esc(F.confidence.level)} (${F.confidence.score}/100)</h4><ul class="why">${F.confidence.why.map(w => `<li><b class="${w.points >= 0 ? 'up' : 'down'}">${w.points > 0 ? '+' : ''}${w.points}</b> ${esc(w.text)}</li>`).join('')}</ul>
          ${b.recent ? `<p class="flat">Observed direction: the last 28 days ran at ${fmtN(b.recent.last)} a month against ${fmtN(b.recent.before)} the 28 days before (${pct(b.recent.change)}). This is measured, not projected forward.</p>` : ''}
          ${b.prev != null ? `<p class="flat">Previous period: ${fmtN(b.prev)} clicks a month.</p>` : ''}
        </div></details>
      </div></section>`;
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
    let P = G().prio(A, D); if (!P) return statusBar(A, D);
    G().seedDemo(D, P); P = G().prio(A, D); // seeding the sample tasks changes which items have tasks
    return `<div class="cc-head"><p class="cc-title">SEO Growth Command Center</p></div>${statusBar(A, D)}${guide(A, D, P)}`;
  }
  // above the fold: what to do now and where it leads
  function top(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return '';
    return `<div class="cc-grid">${doToday(A, D, P)}${target(A, D, P)}</div>`;
  }
  function body(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return '';
    return `<div class="cc-grid even">${risks(A, D, P)}${working(A, D)}</div>
      ${changes(A, D)}`;
  }
  function mount(A, D) {
    if (!G()) return;
    const P = G().prio(A, D);
    const live = document.getElementById('cc-live');
    // Create task: saved at once, and the dashboard stays put so the next action can be picked up
    document.querySelectorAll('[data-cc-task]').forEach(b => b.addEventListener('click', () => {
      const g = P && P.items.find(x => x.id === b.dataset.ccTask); if (!g) return;
      const t = TK.fromOpportunity(g, D);
      if (!G().upsert(D.site, t)) { b.textContent = 'Could not save (browser storage is full or blocked)'; return; }
      g.task = t; g.status = t.status;
      const a = document.createElement('a');
      a.className = 'btn-quiet done'; a.href = '#tasks?id=' + encodeURIComponent(t.id); a.textContent = 'Task created · open';
      b.replaceWith(a); a.focus();
      if (live) live.textContent = `Task created for ${g.subject.label}. It is on the Action board as Planned.`;
      const nav = document.querySelector('.nav a[data-view="tasks"] .count');
      if (nav) nav.textContent = String((+nav.textContent || 0) + 1);
    }));
    document.querySelectorAll('[data-cc-connect]').forEach(b => b.addEventListener('click', () => { const s = document.getElementById('top-site-btn'); if (s) s.click(); }));
    const gx = document.getElementById('cc-guide-x');
    if (gx) gx.addEventListener('click', () => { store.set('cc-guide-off:' + D.site, true); const g = gx.closest('.cc-guide'); if (g) g.remove(); });
    document.querySelectorAll('[data-ccres]').forEach(el => {
      const t = G().tasks(D.site).list.find(x => x.id === el.dataset.ccres); if (!t) return;
      G().measureTask(t).then(r => { el.innerHTML = G().resultTag(r) + vsEstimate(t, r); });
    });
    const f = document.getElementById('cc-tgt-form'); if (!f) return;
    const FCm = window.CW_FORECAST, F = forecastOf(A, D);
    const err = document.getElementById('cc-tgt-err'), per = f.querySelector('select[name=period]'), cust = f.querySelector('[data-cc-custom]'), byIn = f.querySelector('input[name=by]');
    const syncPer = () => { cust.hidden = per.value !== 'custom'; };
    per.addEventListener('change', syncPer);
    const open = (v, by) => {
      f.hidden = false;
      if (v) f.querySelector('input[name=monthly]').value = v;
      if (by) { per.value = 'custom'; byIn.value = by; }
      syncPer(); f.querySelector('input[name=monthly]').focus();
    };
    const t0 = FCm.normaliseTarget(G().settings(D.site).target);
    if (t0 && t0.by) { per.value = 'custom'; syncPer(); }
    document.querySelectorAll('[data-cc-tgt-open]').forEach(b => b.addEventListener('click', () => open(b.dataset.v, b.dataset.by)));
    const ed = document.getElementById('cc-tgt-edit'); if (ed) ed.addEventListener('click', () => { if (f.hidden) open(); else f.hidden = true; });
    document.getElementById('cc-tgt-cancel').addEventListener('click', () => { f.hidden = true; err.textContent = ''; });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(f), now = new Date().toISOString().slice(0, 10);
      const by = per.value === 'custom' ? String(fd.get('by') || '') : FCm.addDays(now, +per.value);
      const input = { monthly: fd.get('monthly'), by };
      const errs = FCm.validateTarget(input, { baseline: F.base.monthly, today: now });
      if (errs.length) { err.textContent = errs.join(' '); return; }
      const cur = store.get('growth:' + D.site) || {};
      G().saveSettings(D.site, { ...cur, target: { monthly: Math.round(+input.monthly), baseline: Math.round(F.base.monthly), set: now, by, dataEnd: FCm.isDate(F.base.end) ? F.base.end : FCm.isDate(D.end) ? D.end : now } });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const c = document.getElementById('cc-tgt-clear');
    if (c) c.addEventListener('click', () => { const cur = store.get('growth:' + D.site) || {}; delete cur.target; G().saveSettings(D.site, cur); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  }
  // estimate made when the task was created, next to the measured change as clicks a month
  function vsEstimate(t, r) {
    if (!r || r.status !== 'measured' || !r.before) return '';
    const d = (r.after.perDay - r.before.perDay) * 30;
    const est = t.estimate && t.estimate.hi ? ` · estimated ${range(t.estimate.lo, t.estimate.hi)}` : '';
    return ` <small class="flat">${d >= 0 ? '+' : '−'}${fmtN(Math.abs(d))} clicks / mo measured${esc(est)}${r.relative != null ? ` · ${r.relative > 0 ? '+' : ''}${r.relative.toFixed(0)}% vs site` : ''}</small>`;
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

  window.CW_COMMAND = { html, top, body, mount, markerPlugin, hasMarkers, vsEstimate, DEF };
})();

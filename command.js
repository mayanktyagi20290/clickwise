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

  // ── Top SEO opportunities: the ranked list as a table, with filter chips. "Do today" is the default view:
  // the five highest-scoring open priorities, the first one featured. ──
  const HEADLINE = {
    striking: g => `Move “${g.subject.label}” into the top 3`,
    'ctr-query': g => `Rewrite title & meta for “${g.subject.label}”`,
    'ctr-page': g => `Rewrite title & meta for ${g.subject.label}`,
    'answer-box': g => `Win back clicks from the answer box for “${g.subject.label}”`,
    'decline-page': g => `Recover lost visibility for ${g.subject.label}`,
    'decline-query': g => `Recover clicks for “${g.subject.label}”`,
    'slipping-page': g => `Stop ${g.subject.label} slipping`,
    cannibal: g => `Consolidate pages competing for “${g.subject.label}”`,
    'content-gap': g => `Create content for “${g.subject.label}”`,
    'internal-link': g => `Add internal links to ${g.subject.label}`
  };
  const headline = g => (HEADLINE[g.type] || (x => x.subject.label))(g);
  const CHIPS = [
    ['today', 'Do today', (g, open) => open.includes(g)],
    ['all', 'All', () => true],
    ['rank', 'Near page one', g => g.category === 'Rankings'],
    ['ctr', 'CTR', g => g.category === 'CTR' || g.category === 'AI & SERP features'],
    ['recover', 'Recovering', g => g.category === 'Declines'],
    ['content', 'Content & links', g => ['Content', 'Internal links', 'Competing pages'].includes(g.category)]
  ];
  let OPP = null; // the analysis the table was drawn from, so chips can redraw it in place
  const openOf = P => P.items.filter(g => !g.task || ['planned', 'progress'].includes(g.task.status));
  function chipList(key, P) { const open = openOf(P), c = CHIPS.find(x => x[0] === key) || CHIPS[0]; return P.items.filter(g => c[2](g, open)); }
  function oppRows(list, A, D, F, featured) {
    const fc = window.CW_FORECAST;
    const taskBtn = (g, i) => g.task ? `<a class="btn-quiet st-${g.task.status}" href="#tasks?id=${encodeURIComponent(g.task.id)}" title="Open the task">${esc(TK.STATUS[g.task.status])}</a>` : `<button type="button" class="${i === 0 && featured ? 'btn-primary sm' : 'btn-outline'}" data-cc-task="${esc(g.id)}">Create task</button>`;
    const adds = g => { if (!F) return ''; const c = fc.groupContribution(g, F); return c.hi > 0 ? `<span class="gainv cc-adds">${esc(range(c.lo, c.hi))}</span>` : `<span class="flat cc-adds" title="${esc(c.note)}">${g.impact.kind === 'none' ? 'No estimate' : 'Counted elsewhere'}</span>`; };
    const m = g => g.measured || {};
    const ev = g => { const x = m(g); return x.impr != null ? `${fmtN(x.impr)} impr.<small>Pos ${x.pos ? x.pos.toFixed(1) : '—'} · CTR ${pctf(x.ctr)}</small>` : x.upTo != null ? `≤ ${fmtN(x.upTo)} clicks<small>not in the export</small>` : '<small>—</small>'; };
    const eff = l => `<span class="tag eff-${l.toLowerCase()}">${esc(l)}</span>`;
    const sub = g => g.subject.kind === 'query' ? (g.page ? g.page.path : 'Search') : g.subject.label;
    return list.map((g, i) => `<li class="${i === 0 && featured ? 'cc-top' : ''}" data-oid="${esc(g.id)}">
        <div class="cc-row">
          <span class="cc-rank ${g.priority.toLowerCase()}" title="${esc(g.priority)}">${i + 1}</span>
          <div class="cc-main"><a class="cc-ttl" href="#opp?id=${encodeURIComponent(g.id)}">${esc(headline(g))}</a>
            <div class="cc-path">${esc(sub(g))}</div><div class="cc-ev-in">${ev(g).replace('<small>', ' · ').replace('</small>', '')}</div>
            <div class="cc-tags">${i === 0 && featured ? '<span class="tag top-t">Top priority action</span>' : ''}<span class="tag cat">${esc(g.category)}</span>${confTag(g.confidence.level)}</div></div>
          <div class="cc-score" title="Growth Priority Score ${g.score}/100 (${esc(g.priority)})"><b>${g.score}</b><i><span style="width:${g.score}%"></span></i></div>
          <div class="cc-est">${adds(g)}</div>
          <div class="cc-ev">${ev(g)}</div>
          <div class="cc-eff">${eff(g.effort.level)}</div>
          <div class="cc-act">${taskBtn(g, i)}<a class="cc-dots" href="#opp?id=${encodeURIComponent(g.id)}" aria-label="Details for ${esc(g.subject.label)}" title="Details">${svg('chev').replace('<svg', '<svg style="transform:rotate(-90deg)"')}</a></div>
        </div>
        ${explainBlock(g, A, D, F)}</li>`).join('');
  }
  function opps(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return '';
    const F = forecastOf(A, D);
    OPP = { A, D, P, F };
    const list = chipList('today', P).slice(0, 5);
    const n = Object.fromEntries(CHIPS.map(([k]) => [k, k === 'today' ? Math.min(5, chipList(k, P).length) : chipList(k, P).length]));
    return `<section class="panel cc-today"><div class="panel-h"><h2>Top SEO opportunities for you</h2><a href="#priorities">View all ${P.items.length} opportunities →</a><p>Based on your Search Console data, ranked by Growth Priority Score ${tip('score', 'Score')}. Each issue appears once; estimated clicks are what it adds to the forecast ${tip('adds', 'Adds')}.</p></div>
      <div class="cc-chips" role="tablist" aria-label="Filter opportunities">${CHIPS.map(([k, l]) => `<button type="button" role="tab" data-cc-chip="${k}" aria-selected="${k === 'today'}" class="${k === 'today' ? 'on' : ''}">${esc(l)} <span>${n[k]}</span></button>`).join('')}</div>
      <div class="cc-thead" aria-hidden="true"><span>#</span><span>Opportunity</span><span>Growth score</span><span>Est. clicks / month</span><span>Evidence</span><span>Effort</span><span>Actions</span></div>
      ${list.length ? `<ol class="cc-list">${oppRows(list, A, D, F, true)}</ol>`
      : P.items.length ? '<ol class="cc-list"></ol><p class="empty" data-cc-empty>Everything prioritised already has a task in progress or done. <a href="#tasks">Open the Action board</a></p>'
      : `<ol class="cc-list"></ol><p class="empty" data-cc-empty>No opportunities in this data yet. ${D.source === 'file' ? 'Exports with more searches, or a Search Console connection, give more to work with.' : 'Try a longer date range.'}</p>`}
      <p class="sr" role="status" aria-live="polite" id="cc-live"></p></section>`;
  }

  // ── Active tasks: the Action board in brief ──
  const ST_ICON = { planned: 'todo', progress: 'doing', implemented: 'done', validated: 'done' };
  function tasksPanel(A, D) {
    if (!G()) return '';
    const list = G().tasks(D.site).list.filter(t => t.status !== 'dropped');
    const groups = [['all', 'All', () => true], ['todo', 'To do', t => t.status === 'planned'], ['doing', 'In progress', t => t.status === 'progress'], ['done', 'Done', t => ['implemented', 'validated'].includes(t.status)]];
    const initials = s => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const row = t => `<li data-tkst="${ST_ICON[t.status]}"><span class="tk-dot ${ST_ICON[t.status]}" role="img" aria-label="${esc(TK.STATUS[t.status])}"></span>
        <div class="tk-b"><a href="#tasks?id=${encodeURIComponent(t.id)}">${esc(t.title)}</a><small class="${TK.overdue(t) ? 'lossv' : ''}">${svg('clock')}${t.due ? `Due ${esc(fmtDate(t.due))}` : t.implDate ? `Live ${esc(fmtDate(t.implDate))}` : 'No due date'} · ${esc(TK.STATUS[t.status])}</small></div>
        ${t.priority ? `<span class="tag pri-${t.priority.toLowerCase()}">${t.priority}</span>` : '<span></span>'}
        <span class="tk-av${t.owner ? '' : ' none'}" title="${esc(t.owner || 'No owner')}">${t.owner ? esc(initials(t.owner)) : '—'}</span></li>`;
    return `<section class="panel cc-tasks"><div class="panel-h"><h2>Active tasks</h2><a href="#tasks">View all →</a></div>
      <div class="cc-chips sm" role="tablist" aria-label="Filter tasks">${groups.map(([k, l, f], i) => `<button type="button" role="tab" data-tk-chip="${k}" aria-selected="${i === 0}" class="${i === 0 ? 'on' : ''}">${l} <span>${list.filter(f).length}</span></button>`).join('')}</div>
      ${list.length ? `<ul class="cc-tk">${list.map(row).join('')}</ul><p class="empty sm" data-tk-none hidden>No tasks with this status.</p>` : '<p class="empty">No tasks yet. Choose <b>Create task</b> on an opportunity to start one.</p>'}</section>`;
  }

  // ── Quick insights: counts from the analysis, each linking to its report ──
  function insights(A, D) {
    const out = [];
    const add = (n, ico, tone, text, href) => { if (n) out.push(`<li><a href="${href}"><span class="qi-i ${tone}">${svg(ico)}</span><span>${text}</span>${svg('chev').replace('<svg', '<svg class="qi-c"')}</a></li>`); };
    add(A.quickWins.length, 'bolt', 'amber', `${fmtN(A.quickWins.length)} searches are close to page one (positions 4–20).`, '#quickwins');
    add(A.ctrPages.length, 'eye', 'indigo', `${fmtN(A.ctrPages.length)} page${A.ctrPages.length === 1 ? ' gets' : 's get'} high impressions but a low CTR.`, '#ctr');
    const dp = A.decay && A.decay.pages[0];
    add(dp ? 1 : 0, 'down', 'red', dp ? `Clicks to ${esc(dp.path)} fell ${Math.abs(dp.ch).toFixed(0)}% against the previous period.` : '', '#decay');
    add(A.content ? A.content.gaps.length : 0, 'file', 'green', `${A.content ? fmtN(A.content.gaps.length) : 0} content gaps where demand exists but nothing ranks well.`, '#content?tab=gaps');
    add(A.ai.overview.length, 'spark', 'violet', `${fmtN(A.ai.overview.length)} top-5 searches may be losing clicks to AI Overviews or answer boxes (inferred from CTR).`, '#ai');
    const cn = A.cannibal.filter(c => c.sev !== 'low').length;
    add(cn, 'alert', 'amber', `${fmtN(cn)} searches have pages competing with each other.`, '#cannibal');
    return `<section class="panel cc-ins"><div class="panel-h"><h2>Quick insights from Clickwise</h2></div>
      ${out.length ? `<ul class="qi">${out.slice(0, 5).join('')}</ul>` : '<p class="empty">Nothing stands out in this data yet.</p>'}</section>`;
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
    const tgtTile = t ? tile('target', 'Target', fmtN(t.monthly), valid ? `clicks / mo by ${esc(fmtDate(t.by))}` : '<span class="lossv">needs a date</span>', 'tgt') : `<div class="cc-kpi tgt empty"><span>Target ${tip('target', 'Target')}</span><b>—</b><small><button type="button" class="btn-link" data-cc-tgt-open>Set a target</button></small></div>`;
    const progressHtml = !t ? '' : pr.status === 'invalid' || pr.status === 'waiting' ? `<p class="cc-prog-note">${esc(pr.note)}</p>`
      : `<div class="cc-bar ${pr.status}" role="progressbar" aria-label="Progress to target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pr.frac * 100)}"><span style="width:${(pr.frac * 100).toFixed(1)}%"></span><i style="left:${(pr.timeFrac * 100).toFixed(1)}%" title="Time used"></i></div>
        <p class="cc-prog-note"><b class="${pr.status === 'behind' ? 'lossv' : 'gainv'}">${pr.status === 'reached' ? 'Target reached' : pr.status === 'on-track' ? 'On track' : 'Behind'}</b> · ${esc(pr.note)} Current = last 28 days, as a monthly rate.</p>`;
    const measured = t && ['on-track', 'behind', 'reached'].includes(pr.status);
    const R = 40, Cc = 2 * Math.PI * R, frac = measured ? pr.frac : 0;
    const ring = `<div class="cc-ring ${measured ? pr.status : 'idle'}" role="img" aria-label="${esc(measured ? `${Math.round(frac * 100)}% of the way to the target` : !t ? 'No target set' : pr.note)}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${R}" class="trk"/><circle cx="50" cy="50" r="${R}" class="val" stroke-dasharray="${(frac * Cc).toFixed(1)} ${Cc.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
      <div><b>${measured ? Math.round(frac * 100) + '%' : '—'}</b><small>${measured ? 'to target' : !t ? 'no target' : valid ? 'starts soon' : 'needs a date'}</small></div></div>`;
    const bv = new Date(); bv.setDate(bv.getDate() + 90);
    const defBy = t && t.by ? t.by : sug.by || bv.toISOString().slice(0, 10);
    return `<section class="panel cc-target"><div class="panel-h"><h2>Growth target</h2>${t ? '<button type="button" class="btn-soft" id="cc-tgt-edit">Edit target</button>' : '<button type="button" class="btn-soft" data-cc-tgt-open>Set target</button>'}</div>
      <div class="panel-b">
        <div class="cc-tg-top">
          ${ring}
          <div class="cc-kpis">
            ${tgtTile}
            ${tile('observed', 'Current', fmtN(b.monthly), `clicks / mo · observed${b.assumed ? ' (dates assumed)' : ''}`, 'now')}
            ${tile('forecast', 'Forecast', fmtN(sc.expected.monthly), `${fmtN(sc.conservative.monthly)}–${fmtN(sc.optimistic.monthly)} · ${esc(F.confidence.level)} confidence`, 'fc')}
          </div>
        </div>
        ${tile('opportunity', 'Estimated opportunity', o.growth.hi + o.recovery.hi > 0 ? range(o.growth.lo + o.recovery.lo, o.growth.hi + o.recovery.hi) : '0', `additional clicks / month · ${o.growth.n} searches${A.decay ? (o.recovery.n ? ` · ${o.recovery.n} recoveries` : o.deduped.hi > 0 ? ' · recovery already in growth' : ' · no recoverable declines') : ''} · estimate`, 'opp')}
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

  // ── Recent SEO changes and impact: Action board tasks and Fix tracker entries, one list, measured live ──
  function changes(A, D) {
    const { list } = G().tasks(D.site);
    const log = TK.changeLog(list, G().fixesOf(D.site)).slice(0, 5);
    return `<section class="panel cc-changes"><div class="panel-h"><h2>Recent SEO changes &amp; impact</h2><a href="#fixes">View all changes →</a><p>Did our changes work? Equal windows before and after each change, compared with the whole site. Evidence, not proof.</p></div>
      ${log.length ? `<div class="tw"><table class="cc-cht"><thead><tr><th scope="col">Date</th><th scope="col">Change</th><th scope="col">Affected page</th><th scope="col" class="r">Clicks / day (before → after)</th><th scope="col" class="r">% change</th></tr></thead><tbody>
        ${log.map(c => `<tr data-ccrow="${esc(c.key)}"><td class="nw">${esc(fmtDate(c.date).replace(/ \d{4}$/, ''))}</td>
          <td><a href="${c.from === 'task' ? `#tasks?id=${encodeURIComponent(c.taskId)}` : `#fixes?fix=${encodeURIComponent(c.fixId)}`}">${esc(c.from === 'task' ? c.title : c.note || 'Tracked fix')}</a>${c.owner ? `<small class="flat"> · ${esc(c.owner)}</small>` : ''}</td>
          <td class="u">${c.scope === 'site' ? '<span class="flat">Whole site</span>' : urlCell(c.url, c.path)}</td>
          <td class="r cc-ba"><span class="flat">Measuring…</span></td><td class="r cc-pc"></td></tr>`).join('')}</tbody></table></div>`
        : `<p class="empty">No implemented changes recorded yet. Create a task from an opportunity, then mark it implemented with the date it went live, or log one in the <a href="#fixes">Fix tracker</a>.</p>`}</section>`;
  }
  // ── Top winning pages: biggest gains against the previous period ──
  function winners(A, D) {
    const rising = A.decay && A.decay.rising ? A.decay.rising.slice(0, 5) : null;
    const rows = rising && rising.length ? rising.map(r => ({ p: r.p, path: r.path, clicks: r.cur.clicks, ch: r.prev && r.prev.clicks ? (r.cur.clicks - r.prev.clicks) / r.prev.clicks * 100 : null }))
      : (A.P || []).filter(r => !A.isExcluded || !A.isExcluded(r.p)).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 5).map(r => ({ p: r.p, path: r.path || CW.pathOf(r.p), clicks: r.clicks, ch: null }));
    const note = rising ? (rising.length ? '' : 'No page grew by 40% or more against the previous period, so these are the pages with most clicks.') : 'No comparison period loaded, so these are the pages with most clicks.';
    return `<section class="panel cc-win"><div class="panel-h"><h2>Top winning pages</h2><a href="${rising && rising.length ? '#decay' : '#pages'}">View all →</a>${note ? `<p>${esc(note)}</p>` : ''}</div>
      ${rows.length ? `<div class="tw"><table class="cc-wt"><thead><tr><th scope="col">Page</th><th scope="col" class="r">Clicks</th><th scope="col" class="r">% change</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="u">${urlCell(r.p, r.path)}</td><td class="r">${fmtN(r.clicks)}</td><td class="r">${r.ch == null ? (r.clicks && rising && rising.length ? '<span class="gainv">new</span>' : '<span class="flat">—</span>') : `<span class="${r.ch >= 0 ? 'gainv' : 'lossv'}">${r.ch >= 0 ? '↑' : '↓'} ${Math.abs(r.ch).toFixed(0)}%</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No pages in this data.</p>'}</section>`;
  }

  function html(A, D) {
    if (!G()) return '';
    let P = G().prio(A, D); if (!P) return statusBar(A, D);
    G().seedDemo(D, P); P = G().prio(A, D); // seeding the sample tasks changes which items have tasks
    const g = openOf(P)[0];
    const kicker = D.source === 'api' ? 'Live from Search Console' : D.source === 'demo' ? 'Sample data · fictional site' : 'From an uploaded export';
    return `<div class="cc-hero"><div class="cc-hero-t"><p class="cc-kicker">${esc(kicker)}</p><p class="cc-title" role="heading" aria-level="1">Your SEO Growth Command Center</p><p class="cc-sub">Turn your search data into clear actions, higher rankings and more traffic.</p></div>
      ${g ? `<a class="cc-hero-top" href="#opp?id=${encodeURIComponent(g.id)}"><span class="cc-hero-i" aria-hidden="true">${svg('target')}</span><span class="cc-hero-x"><b>Top priority for today</b><span>${esc(headline(g))}</span></span><span class="btn-primary sm">View details →</span></a>` : ''}</div>
      ${statusBar(A, D)}${guide(A, D, P)}`;
  }
  function body(A, D) {
    if (!G()) return '';
    const P = G().prio(A, D); if (!P) return '';
    return `<div class="cc-grid even">${risks(A, D, P)}${working(A, D)}</div>`;
  }
  function mount(A, D) {
    if (!G()) return;
    const P = G().prio(A, D);
    const live = document.getElementById('cc-live');
    // Create task: saved at once, and the dashboard stays put so the next action can be picked up.
    // Delegated, so rows redrawn by the filter chips keep working.
    const box = document.querySelector('.cc-today');
    if (box) box.addEventListener('click', e => {
      const b = e.target.closest('[data-cc-task]');
      if (b) {
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
        return;
      }
      const c = e.target.closest('[data-cc-chip]');
      if (c && OPP) {
        box.querySelectorAll('[data-cc-chip]').forEach(x => { const on = x === c; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        const key = c.dataset.ccChip, list = chipList(key, OPP.P).slice(0, 5);
        const ol = box.querySelector('.cc-list'), empty = box.querySelector('[data-cc-empty]');
        ol.innerHTML = oppRows(list, OPP.A, OPP.D, OPP.F, key === 'today');
        if (empty) empty.hidden = !!list.length;
        if (live) live.textContent = `${list.length} opportunit${list.length === 1 ? 'y' : 'ies'} shown: ${c.textContent.replace(/\s+\d+$/, '')}.`;
      }
    });
    // Active tasks: status filter, five rows at a time
    const tk = document.querySelector('.cc-tasks');
    if (tk) {
      const show = key => {
        let n = 0;
        tk.querySelectorAll('.cc-tk > li').forEach(li => { const ok = key === 'all' || li.dataset.tkst === key; li.hidden = !ok || n >= 5; if (ok) n++; });
        const none = tk.querySelector('[data-tk-none]'); if (none) none.hidden = n > 0;
      };
      show('all');
      tk.querySelectorAll('[data-tk-chip]').forEach(b => b.addEventListener('click', () => {
        tk.querySelectorAll('[data-tk-chip]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        show(b.dataset.tkChip);
      }));
    }
    document.querySelectorAll('[data-cc-connect]').forEach(b => b.addEventListener('click', () => { const s = document.getElementById('top-site-btn'); if (s) s.click(); }));
    const gx = document.getElementById('cc-guide-x');
    if (gx) gx.addEventListener('click', () => { store.set('cc-guide-off:' + D.site, true); const g = gx.closest('.cc-guide'); if (g) g.remove(); });
    // Changes and impact: each change measured with the fix tracker method, one at a time
    const rows = [...document.querySelectorAll('[data-ccrow]')];
    if (rows.length) {
      const log = TK.changeLog(G().tasks(D.site).list, G().fixesOf(D.site));
      const S = window.CW_SOURCE, FV = window.CW_FIXVIEW;
      (async () => {
        for (const tr of rows) {
          const c = log.find(x => x.key === tr.dataset.ccrow); if (!c || !tr.isConnected) continue;
          let r = null;
          try {
            if (c.from === 'task') { const t = G().tasks(D.site).list.find(x => x.id === c.taskId); r = t ? await G().measureTask(t) : null; }
            else if (S && FV) r = c.scope === 'page' && !S.canPage ? { status: 'no-page' } : await FV.measureFix({ id: c.key, scope: c.scope, url: c.url, date: c.date }, S);
          } catch (e) { r = { status: 'error' }; }
          if (!tr.isConnected) return;
          const ba = tr.querySelector('.cc-ba'), pc = tr.querySelector('.cc-pc');
          if (r && r.status === 'measured' && r.before) {
            ba.innerHTML = `${r.before.perDay.toFixed(1)} → ${r.after.perDay.toFixed(1)}`;
            const ch = r.change.clicks;
            pc.innerHTML = `${ch == null ? '—' : `<span class="${ch >= 0 ? 'gainv' : 'lossv'}">${ch >= 0 ? '↑' : '↓'} ${Math.abs(ch).toFixed(1)}%</span>`}<br>${G().resultTag(r)}`;
          } else { ba.innerHTML = G().resultTag(r) || '<span class="flat">—</span>'; pc.textContent = ''; }
        }
      })();
    }
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

  window.CW_COMMAND = { html, target, opps, tasksPanel, insights, changes, winners, body, mount, markerPlugin, hasMarkers, vsEstimate, DEF, headline };
})();

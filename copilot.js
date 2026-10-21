// Clickwise SEO copilot. Maps a plain-language question onto analyses Clickwise already runs (priorities,
// declines, almost-page-one, CTR, tasks, indexing…) and answers with evidence, affected URLs, actions and
// links to the full report. Deterministic: no AI model, nothing typed is run as code or a pattern.
// When the data cannot answer, it says why. Anything it doesn't recognise goes to the Goal builder.
(function () {
  'use strict';
  const CW = window.CW, fmtN = CW.fmtN;
  const p1 = v => v == null || isNaN(v) ? '—' : (+v).toFixed(1);
  const sg = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v) + '%';
  const range = (lo, hi) => hi >= 1 ? (fmtN(lo) !== fmtN(hi) ? `+${fmtN(lo)}–${fmtN(hi)}` : `+${fmtN(hi)}`) : '—';
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
  function countIn(t, def) {
    t = t.replace(/\b(?:page|position|rank|top|step)\s+(?:one|1|two|2|ten|10)\b/g, ' ').replace(/\bposition\s+\d+/g, ' ');
    const m = t.match(/\b(?:top|first|best|show|list|give)?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b(?!\s*(?:%|days?|months?|weeks?|clicks?|impressions?))/);
    const n = m ? (WORDS[m[1]] || parseInt(m[1], 10)) : def;
    return Math.max(1, Math.min(25, n || def));
  }

  // Each intent: a test on the normalised question, and a function that builds the answer.
  const INTENTS = [
    { id: 'incomplete', test: t => /\b(incomplete|unfinished|pending|open|remain\w*|not (?:yet )?done|overdue|outstanding|baaki|backlog)\b/.test(t) && /\b(task|action|work|fix|change|to.?do|item)s?\b/.test(t) },
    { id: 'changed', test: t => /\b(what changed|did (?:it|that|they|our|my|the).*(work|help)|result|impact|effect|after (?:our|my|the) (?:last )?(?:content )?(?:update|change|edit|fix)|last (?:content )?update|worked)\b/.test(t) },
    { id: 'losing', test: t => /\b(los(?:e|ing|t)|drop\w*|declin\w*|fall\w*|fell|decreas\w*|down|gir\w*|kam ho\w*|decay\w*)\b/.test(t) },
    { id: 'near', test: t => /\b(close to|near|almost|just (?:outside|below|off|missing)|striking|page two|2nd page|second page|position 1[1-9]|11.?20|reach page one)\b/.test(t) || /\bpage (?:one|1)\b/.test(t) && /\b(close|near|almost|get|reach|push)\b/.test(t) },
    { id: 'ctr', test: t => /\b(ctr|click.?through|titles?|meta|snippets?|under.?clicked|low clicks)\b/.test(t) },
    { id: 'cannibal', test: t => /\b(cannibal\w*|competing|compete|duplicate|same keyword|overlap\w*)\b/.test(t) },
    { id: 'index', test: t => /\b(index\w*|crawl\w*|not showing in google|sitemap|deindex\w*|noindex)\b/.test(t) },
    { id: 'ai', test: t => /\b(ai overview|ai mode|answer box|featured snippet|aeo|geo|chatgpt|perplexity|zero.?click|llm)\b/.test(t) },
    { id: 'risk', test: t => /\b(risk|problem|issue|wrong|broken|urgent|critical|worry)\w*\b/.test(t) },
    { id: 'pages', test: t => /\b(pages?|urls?|articles?|posts?)\b/.test(t) && /\b(improve|fix|first|priorit\w*|work on|focus|update|optimi[sz]e|start|should)\b/.test(t) },
    { id: 'today', test: t => /\b(what should (?:i|we) do|where (?:do|should) (?:i|we) start|today|next step|quick wins?|priorit\w*|biggest (?:growth )?opportunit\w*|grow\w*)\b/.test(t) },
    { id: 'working', test: t => /\b(what(?:'s| is) working|going well|grow\w* fastest|winners?|best performing|top performing)\b/.test(t) }
  ];
  const ORDER_FIRST = ['incomplete', 'changed', 'working'];

  // ctx: { A, D, P (priority.js result), tasks (list), inspections (list or null) }
  function answer(q, ctx) {
    const t = String(q || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const hit = INTENTS.filter(i => i.test(t)).sort((a, b) => (ORDER_FIRST.includes(b.id) - ORDER_FIRST.includes(a.id)))[0];
    if (!hit) return null;
    const out = BUILD[hit.id](t, ctx);
    out.intent = hit.id; out.q = String(q).slice(0, 300);
    out.source = ctx.D.source === 'api' ? 'Search Console (live)' : ctx.D.source === 'demo' ? 'Sample data' : 'Uploaded export';
    out.period = ctx.D.start && ctx.D.end ? `${ctx.D.start} to ${ctx.D.end}` : 'dates not in the data';
    return out;
  }
  const hasPrev = D => !!((D.prevQ && D.prevQ.length) || (D.prevP && D.prevP.length));
  const row = (label, url, metric, action, href) => ({ label, url: url || null, metric, action: action || '', href: href || null });
  const page = (url, path) => ({ url, path });

  const BUILD = {
    losing(t, { A, D, P }) {
      const n = countIn(t, 10);
      if (!hasPrev(D) || !A.decay) return { title: 'Where you are losing clicks', summary: 'This analysis has no comparison period, so declines cannot be measured.', rows: [], limits: ['Connect Search Console with “Compare with the previous period” ticked, or upload two exports (this period and the one before), or an export made with Date › Compare.'], links: [{ href: '#overview', label: 'Command Center' }] };
      const pages = A.decay.pages.slice(0, n), qs = A.decay.queries.slice(0, 5);
      const lost = A.decay.lost;
      return {
        title: 'Where you are losing clicks',
        summary: pages.length ? `${A.decay.pages.length} page${A.decay.pages.length === 1 ? '' : 's'} lost a meaningful share of clicks against ${D.prevStart || 'the previous period'}${D.prevEnd ? ' – ' + D.prevEnd : ''}: about ${fmtN(lost)} clicks in the period. The biggest losses first.` : 'No page lost a meaningful share of clicks against the previous period.',
        evidence: [`Compared ${D.start} – ${D.end} with ${D.prevStart || 'the previous period'}${D.prevEnd ? ' – ' + D.prevEnd : ''}${A.decay.scale !== 1 ? ' (periods of different length, scaled per day)' : ''}.`, 'A page counts when it lost at least 25% of its clicks from a meaningful base.'],
        rows: pages.map(r => row(r.path, r.p, `${fmtN(r.prev.clicks)} → ${r.cur.bound ? '≤ ' : ''}${fmtN(r.cur.clicks)} clicks (${sg(r.ch)}): ${r.reason}`, /no longer shows/.test(r.reason) ? 'Check it still returns 200, is indexable and not redirected.' : /position fell/.test(r.reason) ? 'See what outranks it now; refresh content and restore internal links.' : /impressions down/.test(r.reason) ? 'Check whether demand fell (season, trend) before changing anything.' : 'Search its main queries: a new results-page feature or stale title may be taking the click.')),
        extra: qs.length ? { title: 'Searches losing the most', rows: qs.map(r => row(r.q, null, `${fmtN(r.prev.clicks)} → ${fmtN(r.cur.clicks)} clicks (${sg(r.ch)})`)) } : null,
        limits: A.decay.truncated && (A.decay.truncated.pages || A.decay.truncated.queries) ? ['The export is cut at its row limit, so some “losses” may only be rows that fell below the cut-off.'] : [],
        links: [{ href: '#decay', label: 'Losing ground' }, { href: '#priorities', label: 'Risks in Priorities' }]
      };
    },
    pages(t, { A, D, P }) {
      const n = countIn(t, 5);
      if (!P) return none('Priorities are not available for this data.');
      const seen = new Set(), list = [];
      P.items.forEach(g => { if (list.length < n && g.page && !seen.has(g.page.url)) { seen.add(g.page.url); list.push(g); } });
      return {
        title: `The ${list.length} page${list.length === 1 ? '' : 's'} to improve first`,
        summary: `Ranked by Growth Priority Score (click potential, evidence, relevance, time to impact, effort). Each page appears once, with its top opportunity.`,
        evidence: [`${P.items.length} opportunities scored; ${P.merged} overlapping signals merged.`, P.focusSet ? 'Your priority sections and terms are applied.' : 'No priority sections set, so business relevance is neutral.'],
        rows: list.map(g => row(g.page.path, g.page.url, `${g.priority} · score ${g.score} · ${g.impact.kind === 'none' ? 'no click estimate' : range(g.impact.lo, g.impact.hi) + ' clicks / month'} · ${g.confidence.level} confidence · ${g.effort.level} effort`, g.action, '#opp?id=' + encodeURIComponent(g.id))),
        limits: D.QP && D.QP.length ? [] : ['Without Search Console’s query-to-page data, searches cannot be tied to their ranking page, so some opportunities have no page. Connect Search Console for the full picture.'],
        links: [{ href: '#priorities', label: 'All priorities' }, { href: '#pages', label: 'Pages' }]
      };
    },
    near(t, { A }) {
      const n = countIn(t, 10), rows = A.quickWins.slice(0, n);
      return {
        title: 'Searches close to page one',
        summary: rows.length ? `${A.quickWins.length} non-branded searches rank between positions 4 and 20 with enough impressions to matter. The largest estimated gains first.` : 'No non-branded search ranks between positions 4 and 20 with enough impressions.',
        evidence: ['Gain = impressions × the CTR this site earns at the target position, minus current clicks, per month.'],
        rows: rows.map(r => row(r.q, null, `position ${p1(r.pos)} · ${fmtN(r.impr)} impressions · ${range(r.gainLo, r.gainHi)} clicks / month`, r.pos <= 10.5 ? 'Put the search in the title and an early heading, answer it early, and add internal links from strong related pages.' : 'Expand the content to cover it fully and link to the page using the search as anchor text.')),
        limits: [], links: [{ href: '#quickwins', label: 'Almost page one' }]
      };
    },
    ctr(t, { A }) {
      const n = countIn(t, 10), rows = A.ctrPages.slice(0, n);
      return {
        title: 'Pages with CTR improvement potential',
        summary: rows.length ? `${A.ctrPages.length} pages earn well under the CTR this site usually gets at their position. Better titles and descriptions are the usual fix.` : 'No page is far below the CTR expected at its position.',
        evidence: ['Expected CTR comes from this site’s own clicks by position where there is enough data, otherwise an industry benchmark.'],
        rows: rows.map(r => row(r.path, r.p, `${p1(r.ctr)}% CTR at position ${p1(r.pos)} (expected ${p1(r.bench)}%) · ${fmtN(r.impr)} impressions · ${range(r.gainLo, r.gainHi)} clicks / month`, 'Rewrite the title and meta description' + (r.top && r.top.length ? ` around “${r.top[0]}”` : '') + '.')),
        limits: rows.some(r => r.serp) ? ['Some of these may lose clicks to an AI Overview or answer box rather than a weak title; check the live results page.'] : [],
        links: [{ href: '#ctr', label: 'Titles to rewrite' }, { href: '#content?tab=titles', label: 'Title drafts' }]
      };
    },
    cannibal(t, { A }) {
      const rows = A.cannibal.filter(c => c.sev !== 'low').slice(0, 10);
      return {
        title: 'Searches where your pages compete',
        summary: rows.length ? `${rows.length} search${rows.length === 1 ? '' : 'es'} split impressions between several of your pages.` : 'No search clearly splits between several of your pages.',
        evidence: [A.cannibalMode === 'exact' ? 'Measured from Search Console’s query-to-page data.' : 'Estimated from similar wording ranking at different positions (the export has no query-to-page data).'],
        rows: rows.map(c => row(c.q, null, A.cannibalMode === 'exact' ? c.pages.map(p => `${CW.pathOf(p.p)} ${p.share.toFixed(0)}%`).join(' · ') : `${c.variants.length} variants, position spread ${p1(c.spread)}`, 'Pick the best page, merge or re-angle the other, and point internal links at the winner.')),
        limits: A.cannibalMode === 'exact' ? [] : ['Connect Search Console to confirm which pages compete.'], links: [{ href: '#cannibal', label: 'Competing pages' }]
      };
    },
    incomplete(t, { tasks }) {
      const open = tasks.filter(x => ['planned', 'progress'].includes(x.status)).sort((a, b) => (a.due || '9') .localeCompare(b.due || '9'));
      const today = new Date().toISOString().slice(0, 10);
      return {
        title: 'SEO actions still open',
        summary: tasks.length ? `${open.length} task${open.length === 1 ? ' is' : 's are'} planned or in progress${open.filter(x => x.due && x.due < today).length ? `, ${open.filter(x => x.due && x.due < today).length} overdue` : ''}. Implemented tasks waiting for results: ${tasks.filter(x => x.status === 'implemented').length}.` : 'No tasks yet. Create them from Priorities or the Command Center.',
        rows: open.map(x => row(x.title, x.url, `${x.status === 'progress' ? 'In progress' : 'Planned'}${x.owner ? ' · ' + x.owner : ' · no owner'}${x.due ? ' · due ' + x.due + (x.due < today ? ' (overdue)' : '') : ''}`, x.action, '#tasks?id=' + encodeURIComponent(x.id))),
        limits: ['Tasks are stored in this browser only; other people or devices will not see them.'], links: [{ href: '#tasks', label: 'Action board' }]
      };
    },
    changed(t, { tasks }) {
      const done = tasks.filter(x => x.implDate && ['implemented', 'validated'].includes(x.status)).sort((a, b) => b.implDate.localeCompare(a.implDate));
      return {
        title: 'What changed after your recent updates',
        summary: done.length ? `${done.length} implemented change${done.length === 1 ? '' : 's'}, newest first. Each is measured on equal windows before and after its date, against the whole site.` : 'No implemented changes recorded. Mark a task as implemented with the date it went live to measure it.',
        rows: done.slice(0, 10).map(x => row(x.title, x.url, `live ${x.implDate}${x.change ? ' · ' + x.change.slice(0, 120) : ''}`, '', '#tasks?id=' + encodeURIComponent(x.id))),
        measure: done.slice(0, 10).map(x => x.id),
        limits: ['Before/after comparisons show correlation, not proof: Google updates, seasonality and other edits can move clicks too.'], links: [{ href: '#tasks', label: 'Action board' }, { href: '#fixes', label: 'Fix tracker' }]
      };
    },
    index(t, { D, inspections }) {
      const bad = (inspections || []).filter(r => r && r.tone !== 'good');
      return {
        title: 'Indexing',
        summary: inspections && inspections.length ? `${inspections.length} pages inspected live: ${inspections.filter(r => r.indexed).length} indexed, ${bad.length} need a look.` : 'Search performance data does not say which pages are indexed. Run URL inspection or add the Page indexing export.',
        rows: bad.slice(0, 10).map(r => row(r.path, r.url, r.label + (r.coverage && r.coverage !== r.label ? ` (${r.coverage})` : ''), r.fix)),
        limits: D.source === 'file' ? ['URL inspection needs a Search Console connection; uploads can add the Page indexing export instead.'] : [], links: [{ href: '#indexing', label: 'Indexing' }]
      };
    },
    ai(t, { A }) {
      const rows = A.ai.overview.slice(0, 10);
      return {
        title: 'Possible AI Overview and answer-box losses',
        summary: `${A.ai.overview.length} top-5 searches earn far less than this site’s usual CTR there; ${A.ai.aiMode.length} top-3 searches get almost no clicks.`,
        rows: rows.map(r => row(r.q, null, `position ${p1(r.pos)} · ${p1(r.ctr)}% CTR vs ${p1(r.bench)}% usual · ${fmtN(r.impr)} impressions`, 'Check the results page; if an AI Overview shows, lead the page with a 40–60 word answer and give a reason to click.')),
        limits: ['Inferred from CTR only: Search Console does not report AI Overviews separately, and Clickwise does not monitor AI answers. Confirm on the live results page.'],
        links: [{ href: '#ai', label: 'AI search visibility' }]
      };
    },
    risk(t, ctx) { const P = ctx.P; return { title: 'Risks', summary: P && P.risks.length ? `${P.risks.length} data-backed risk${P.risks.length === 1 ? '' : 's'}, most severe first.` : 'No data-backed declines or indexing problems found.', rows: P ? P.risks.slice(0, 10).map(r => row(r.title, r.subject && r.subject.url, `${r.sev} · ${r.detail}`, r.action, r.id.startsWith('o:') ? '#opp?id=' + encodeURIComponent(r.id) : null)) : [], limits: hasPrev(ctx.D) ? [] : ['No comparison period: declines cannot be detected.'], links: [{ href: '#priorities', label: 'Priorities' }, { href: '#indexing', label: 'Indexing' }] }; },
    today(t, ctx) {
      const P = ctx.P; if (!P) return none('Priorities are not available for this data.');
      const n = countIn(t, 5), open = P.items.filter(g => !g.task || ['planned', 'progress'].includes(g.task.status)).slice(0, n);
      return {
        title: 'What to do today', summary: `The ${open.length} highest-priority open opportunities. Growth found in total: ${range(P.totals.growth.lo, P.totals.growth.hi)} clicks a month (each search counted once).`,
        rows: open.map(g => row(g.subject.label, g.page && g.page.url, `${g.priority} · ${g.category} · ${g.impact.kind === 'none' ? 'no click estimate' : range(g.impact.lo, g.impact.hi) + ' clicks / month'} · ${g.confidence.level} confidence · ${g.effort.level} effort`, g.action, '#opp?id=' + encodeURIComponent(g.id))),
        limits: P.risks.some(r => r.sev === 'critical') ? ['There are critical risks too: check them before growth work.'] : [], links: [{ href: '#priorities', label: 'Priorities' }, { href: '#overview', label: 'Command Center' }]
      };
    },
    working(t, { A }) {
      const g = A.signals.good || [], rising = A.decay ? A.decay.rising.slice(0, 8) : [];
      return { title: 'What is working', summary: g.map(x => `${x.l}: ${x.v}`).join(' · ') || 'Not enough data to call out strengths.', rows: rising.map(r => row(r.path, r.p, `+${fmtN(r.won)} clicks vs previous`)), limits: A.decay ? [] : ['No comparison period: growth over time cannot be measured.'], links: [{ href: '#decay', label: 'Losing ground (rising pages are there too)' }] };
    }
  };
  const none = msg => ({ title: 'Not available', summary: msg, rows: [], limits: [], links: [] });
  const EXAMPLES = ['Where am I losing organic clicks?', 'Which five pages should I improve first?', 'Find keywords close to page one', 'Which pages have CTR improvement potential?', 'Which SEO actions remain incomplete?', 'What changed after our last content update?'];

  window.CW_COPILOT = { answer, INTENTS, EXAMPLES, countIn };

  // ── screen ──
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, urlCell } = ui;
  V.ask = (A, D) => {
    const h = location.hash, i = h.indexOf('?'), q = new URLSearchParams(i >= 0 ? h.slice(i + 1) : '').get('q') || '';
    const G = window.CW_GROWTH;
    const runs = window.CW_SURFVIEW && window.CW_SURFVIEW.RUNS.get(D.site);
    const ans = q ? answer(q, { A, D, P: G ? G.prio(A, D) : null, tasks: G ? G.tasks(D.site).list : [], inspections: runs ? runs.results : null }) : null;
    const form = `<form class="sf-box ov-ask" id="cp-form" autocomplete="off" role="search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg><input id="cp-in" type="text" maxlength="300" value="${esc(q)}" placeholder="Ask about your search performance" aria-label="Question"><button class="btn-primary" type="submit">Ask</button></form>
      <div class="cp-ex">${EXAMPLES.map(e => `<a href="#ask?q=${encodeURIComponent(e)}">${esc(e)}</a>`).join('')}</div>`;
    let body = '';
    if (q && !ans) body = `<section class="panel"><div class="panel-b"><p>That isn’t one of the questions Clickwise answers directly yet. The Goal builder can turn it into a filter over your searches and pages.</p><a class="btn-primary sm" href="#filters?q=${encodeURIComponent(q)}">Open in Goal builder</a></div></section>`;
    else if (ans) {
      body = `<section class="panel cp-ans"><div class="panel-h"><h2>${esc(ans.title)}</h2><p>${esc(ans.source)} · ${esc(ans.period)}</p></div><div class="panel-b">
        <p class="cp-sum">${esc(ans.summary)}</p>
        ${(ans.evidence || []).length ? `<h4>How this was worked out</h4><ul>${ans.evidence.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${ans.rows.length ? `<h4>${ans.rows.length} result${ans.rows.length === 1 ? '' : 's'}</h4><ol class="cp-rows">${ans.rows.map((r, k) => `<li><div class="cp-r1">${r.href ? `<a href="${esc(r.href)}"><b>${esc(r.label)}</b></a>` : r.url ? urlCell(r.url, r.label) : `<b>${esc(r.label)}</b>`}${r.url && r.href ? ` ${urlCell(r.url, '↗')}` : ''}${ans.measure ? `<span class="cp-m" data-cpm="${esc(ans.measure[k] || '')}"><span class="flat">Measuring…</span></span>` : ''}</div><small class="flat">${esc(r.metric)}</small>${r.action ? `<p>${esc(r.action)}</p>` : ''}</li>`).join('')}</ol>` : ''}
        ${ans.extra ? `<h4>${esc(ans.extra.title)}</h4><ul>${ans.extra.rows.map(r => `<li><b>${esc(r.label)}</b> <small class="flat">${esc(r.metric)}</small></li>`).join('')}</ul>` : ''}
        ${(ans.limits || []).length ? `<div class="note warn"><b>Limits of this answer.</b> ${ans.limits.map(esc).join(' ')}</div>` : ''}
        <p class="cp-links">${ans.links.map(l => `<a class="btn-quiet" href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}<a class="btn-quiet" href="#filters?q=${encodeURIComponent(q)}">Refine in Goal builder</a></p></div></section>`;
    }
    const html = head('Ask Clickwise', 'Plain-language questions answered from your loaded data, with the evidence, the affected URLs and what to do. Nothing is made up: if the data cannot answer, it says so.') + form + body;
    const mount = () => {
      document.getElementById('cp-form').addEventListener('submit', e => { e.preventDefault(); const v = document.getElementById('cp-in').value.trim().slice(0, 300); location.hash = v ? '#ask?q=' + encodeURIComponent(v) : '#ask'; });
      if (ans && ans.measure && G) document.querySelectorAll('[data-cpm]').forEach(el => {
        const t = G.tasks(D.site).list.find(x => x.id === el.dataset.cpm); if (!t) { el.innerHTML = ''; return; }
        G.measureTask(t).then(r => { el.innerHTML = G.resultTag(r) + (r && r.relative != null ? ` <small class="flat">${r.relative > 0 ? '+' : ''}${r.relative.toFixed(0)}% vs site</small>` : r && r.change && r.change.clicks != null ? ` <small class="flat">${r.change.clicks > 0 ? '+' : ''}${r.change.clicks.toFixed(0)}% clicks</small>` : ''); });
      });
    };
    return { html, mount };
  };
})();

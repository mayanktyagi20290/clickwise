// Clickwise opportunity engine — one ranked list of recommendations built from the analysis.
// Each item carries what was measured, why it was picked, an estimated impact range, a confidence
// level with its reasons, a suggested action with its effort, and any data warnings.
// Pure functions: no DOM, no network. Same input, same output.
(function () {
  'use strict';
  const { fmtN } = window.CW;

  const TYPES = {
    striking: { label: 'Almost page one', view: 'quickwins' },
    'ctr-query': { label: 'Low CTR search', view: 'ctr' },
    'ctr-page': { label: 'Title to rewrite', view: 'ctr' },
    'answer-box': { label: 'Answer box or AI Overview?', view: 'ai' },
    'decline-page': { label: 'Page losing clicks', view: 'decay' },
    'decline-query': { label: 'Search losing clicks', view: 'decay' },
    'slipping-page': { label: 'Early warning', view: 'decay' },
    cannibal: { label: 'Competing pages', view: 'cannibal' },
    'content-gap': { label: 'Content gap', view: 'content?tab=gaps' },
    'internal-link': { label: 'Internal link', view: 'content?tab=links' }
  };
  // What an impact number means. Only "growth" and "recovery" have totals, and each counts an item once.
  const IMPACT = {
    growth: 'More clicks a month from searches the site already ranks for',
    recovery: 'Clicks a month that could come back if the decline is reversed',
    stake: 'Clicks a month at stake; overlaps the search\'s own estimate',
    none: 'No click estimate: a warning to check'
  };
  const LEVELS = [[70, 'High'], [45, 'Medium'], [0, 'Low']];
  const level = score => LEVELS.find(([min]) => score >= min)[1];
  const p1 = v => (v == null || isNaN(v)) ? '—' : v.toFixed(1);

  function build(A, D) {
    D = D || A.data || {};
    const items = [];
    const perMonth = A.perMonth;
    const curvePt = pos => A.curve.points[Math.min(19, Math.max(0, Math.round(pos) - 1))];

    // ── reasons that apply to every item from the same data ──
    const base = [];
    if (A.method.assumedDays) base.push([-10, 'The export has no dates, so a 90-day period was assumed']);
    else if (A.days < 28) base.push([-10, `Only ${A.days} days of data`]);
    else base.push([5, `${A.days} days of data`]);
    const warnings = [];
    if (A.method.assumedDays) warnings.push('The export has no Dates sheet, so monthly figures assume 90 days.');
    if (A.coverage && A.coverage.rowLimit) warnings.push('This export lists only its top 1,000 searches and pages. Smaller searches are missing, so totals are lower than the full picture.');
    if (A.coverage && A.coverage.notShown.share >= 30) warnings.push(`${A.coverage.notShown.share.toFixed(0)}% of clicks are not attributed to any listed search (row limits and searches Google keeps private). Estimates cover only the searches listed.`);
    if (D.pending && (D.pending.qp || D.pending.prev || D.pending.more)) warnings.push('Some data is still loading from Search Console. This list updates by itself when it finishes.');
    if (D.compareNote) warnings.push(D.compareNote);
    warnings.push('Branded searches are left out of every estimate: they reflect demand for the brand, not SEO work.');

    // Volume is judged by the clicks expected at the row's position (impressions × expected CTR), not by
    // impressions alone: a CTR gap measured on 300 expected clicks is solid, one on 8 is mostly noise.
    // Thresholds follow counting noise: with n expected clicks, random variation is about ±1/√n.
    const vol = (impr, pos, what) => {
      const n = impr * A.curve.at(Math.max(1, pos || 1)) / 100;
      return n >= 100 ? [20, `About ${fmtN(n)} clicks expected at this position: plenty of data for this ${what}`]
        : n >= 30 ? [10, `About ${fmtN(n)} clicks expected at this position: enough data for this ${what}`]
        : n >= 10 ? [0, `About ${fmtN(n)} clicks expected at this position: a modest sample`]
        : [-15, `Only about ${fmtN(n)} clicks expected at this position, so a few clicks either way change the picture`];
    };
    const curveWhy = pos => {
      if (pos > 20.5) return [-5, 'Expected CTR beyond position 20 comes from an industry benchmark'];
      const pt = curvePt(pos);
      return pt.source.startsWith('site') ? [10, `Expected CTR at position ${Math.round(pos)} comes from this site's own clicks (${pt.n} searches)`]
        : [-5, `Expected CTR at position ${Math.round(pos)} comes from an industry benchmark: this site has too few searches there`];
    };
    const serpWhy = [-25, 'CTR is far below what this site usually earns at this position, so something on the results page may be taking the click'];
    const cappedWhy = [-15, 'Unusually large next to the rest of the list, so the estimate was capped'];
    // Score = 50 + the points of every reason, kept within 0–100. `ceiling` caps findings whose cause is
    // inferred rather than measured, so they can never read as High however much data they have.
    const conf = (parts, ceiling) => {
      const all = base.concat(parts.filter(Boolean));
      let score = Math.max(0, Math.min(100, 50 + all.reduce((s, x) => s + x[0], 0)));
      const why = all.map(x => ({ points: x[0], text: x[1] }));
      if (ceiling && score > ceiling[0]) { score = ceiling[0]; why.push({ points: 0, text: ceiling[1] }); }
      return { score, level: level(score), why };
    };
    const metrics = r => ({ clicks: r.clicks, impr: r.impr, ctr: r.ctr, pos: r.pos });
    // Which page ranks for each search: only known from query-page rows (Search Console connection).
    // The page with most of the search's impressions is named, with its share, so actions can point at it.
    const landing = new Map();
    if (D.QP && D.QP.length) {
      const by = new Map();
      D.QP.forEach(r => { if (A.isExcluded(r.p)) return; const o = by.get(r.q) || { tot: 0, best: null }; o.tot += r.impr; if (!o.best || r.impr > o.best.impr) o.best = r; by.set(r.q, o); });
      by.forEach((o, q) => { if (o.best && o.tot > 0) landing.set(q, { url: o.best.p, path: window.CW.pathOf(o.best.p), share: o.best.impr / o.tot * 100 }); });
    }
    const on = q => { const l = landing.get(q); return l ? `On ${l.path}, ` : ''; };
    const cap1 = t => t.charAt(0).toUpperCase() + t.slice(1);
    const landEv = q => { const l = landing.get(q); return l ? [`Ranking page: ${l.path} (${l.share.toFixed(0)}% of this search's impressions)`] : []; };
    const landWarn = q => !D.QP ? [] : landing.has(q) ? [] : ['Which page ranks for this search is not in the query-page data (it may be below the rows Search Console returns).'];
    const flagWarn = r => [r.serp ? 'An answer box, AI Overview or other results-page feature may be taking clicks here. Look at the live results before investing.' : '', r.capped ? 'This estimate was unusually large and was capped at 10% of its list total.' : ''].filter(Boolean);
    const add = o => items.push({ ...o, landing: o.subject.kind === 'query' ? landing.get(o.subject.label) || null : null, id: o.type + ':' + (o.subject.url || o.subject.label), typeLabel: TYPES[o.type].label, view: TYPES[o.type].view, impact: { estimated: o.impact.kind !== 'none', unit: 'clicks / month', counted: false, note: IMPACT[o.impact.kind], ...o.impact } });

    // ── searches that could climb ──
    A.quickWins.forEach(r => add({
      type: 'striking', subject: { kind: 'query', label: r.q },
      measured: metrics(r), flags: { serp: !!r.serp, capped: !!r.capped },
      reason: `Ranks at position ${p1(r.pos)} (page ${r.pos <= 10.5 ? 'one' : 'two'}) with ${fmtN(r.impr)} impressions. Most clicks go to the top ${r.target === 3 ? '3' : '7'}.`,
      evidence: [`CTR ${p1(r.ctr)}% at position ${p1(r.pos)}`, `This site usually gets ${p1(r.exp)}% at that position`, `Target: position ${r.lowTarget > r.target + 0.5 ? Math.round(r.lowTarget) + ' (low) to ' + r.target + ' (high)' : r.target}`].concat(landEv(r.q)),
      impact: { kind: 'growth', lo: r.gainLo, hi: r.gainHi },
      confidence: conf([vol(r.impr, r.pos, 'search'), curveWhy(r.target), r.pos > 10.5 ? [-10, 'Needs a bigger jump from page two'] : [5, 'Already on page one'], r.serp && serpWhy, r.capped && cappedWhy]),
      action: r.pos <= 10.5 ? cap1(`${on(r.q)}put “${r.q}” in the title and a heading near the top, answer it early on the page, and add internal links to the page from your strongest related pages.`)
        : cap1(`${on(r.q)}expand the content so it fully covers “${r.q}”, link to the page from related pages using the search as anchor text, then refresh the title.`),
      effort: r.pos <= 10.5 ? { level: 'Medium', why: 'On-page edits and a few internal links' } : { level: 'High', why: 'More content and links to reach page one' },
      warnings: flagWarn(r).concat(landWarn(r.q))
    }));

    // ── searches and pages with low CTR for their position ──
    A.ctrQueries.forEach(r => add({
      type: 'ctr-query', subject: { kind: 'query', label: r.q },
      measured: metrics(r), flags: { serp: !!r.serp, capped: !!r.capped },
      reason: `${p1(r.ctr)}% CTR at position ${p1(r.pos)}, where this site normally earns about ${p1(r.bench)}%.`,
      evidence: [`${fmtN(r.impr)} impressions, ${fmtN(r.clicks)} clicks`, `Expected CTR at this position: ${p1(r.bench)}%`, `${Math.round(r.ratio * 100)}% of expected`].concat(landEv(r.q)),
      impact: { kind: 'growth', lo: r.gainLo, hi: r.gainHi },
      confidence: conf([vol(r.impr, r.pos, 'search'), curveWhy(r.pos), r.serp && serpWhy, r.capped && cappedWhy]),
      action: r.serp ? 'Search it on Google first. If an AI Overview or answer box shows, lead the page with a short direct answer and give a reason to click; a new title alone may not help.'
        : cap1(`${on(r.q)}rewrite the title and meta description around “${r.q}”: say exactly what the page offers, and add a concrete benefit or number.`),
      effort: { level: 'Low', why: 'Title and description edit; no new content' },
      warnings: flagWarn(r)
    }));
    A.ctrPages.forEach(r => add({
      type: 'ctr-page', subject: { kind: 'page', label: r.path, url: r.p },
      measured: metrics(r), flags: { serp: !!r.serp, capped: !!r.capped },
      reason: `${p1(r.ctr)}% CTR at average position ${p1(r.pos)}, where pages on this site normally earn about ${p1(r.bench)}%.`,
      evidence: [`${fmtN(r.impr)} impressions, ${fmtN(r.clicks)} clicks`, `${Math.round(r.ratio * 100)}% of expected CTR`].concat(r.top && r.top.length ? ['Top searches: ' + r.top.map(x => '“' + x + '”').join(', ')] : []),
      impact: { kind: 'growth', lo: r.gainLo, hi: r.gainHi, overlap: 'Overlaps the searches this page is shown for, so it is not added to the total' },
      confidence: conf([vol(r.impr, r.pos, 'page'), curveWhy(r.pos), r.top && r.top.length ? [5, 'The searches it is shown for are known'] : [-5, 'Which searches it is shown for is unknown (needs a Search Console connection)'], r.serp && serpWhy, r.capped && cappedWhy]),
      action: 'Rewrite the title and meta description' + (r.top && r.top.length ? ` around “${r.top[0]}”` : '') + '. Keep the title under about 60 characters and lead with what the searcher wants.',
      effort: { level: 'Low', why: 'Title and description edit; no new content' },
      warnings: flagWarn(r)
    }));
    A.ai.overview.forEach(r => add({
      type: 'answer-box', subject: { kind: 'query', label: r.q },
      measured: metrics(r), flags: { serp: !!r.serp, capped: !!r.capped },
      reason: `Top-5 ranking (position ${p1(r.pos)}) but only ${p1(r.ctr)}% CTR, far below the ${p1(r.bench)}% this site usually earns there.`,
      evidence: [`${fmtN(r.impr)} impressions, ${fmtN(r.clicks)} clicks`, 'The cause is inferred from CTR alone: Search Console does not report AI Overviews separately'].concat(landEv(r.q)),
      impact: { kind: 'growth', lo: 0, hi: r.gainHi },
      confidence: conf([vol(r.impr, r.pos, 'search'), curveWhy(r.pos), [-15, 'Cause not observed: check the live results page'], r.capped && cappedWhy], [69, 'Capped at Medium: the cause is inferred from CTR, not observed']),
      action: `Search “${r.q}” on Google. If an AI Overview or answer box shows, open ${landing.has(r.q) ? landing.get(r.q).path : 'the ranking page'} with a 40–60 word direct answer, add FAQ structure, and give a reason to click for depth.`,
      effort: { level: 'Medium', why: 'Rewrite the opening of the page' },
      warnings: ['Low end is zero: an answer shown on the results page may keep taking the click whatever you change.'].concat(r.capped ? ['This estimate was unusually large and was capped at 10% of its list total.'] : [])
    }));

    // Count each search once in the growth total: its largest estimate wins (the same rule as the
    // dashboard headline). Page estimates overlap the searches they rank for and are never added.
    const best = new Map();
    items.filter(it => it.impact.kind === 'growth' && it.subject.kind === 'query').forEach(it => {
      const o = best.get(it.subject.label);
      if (!o || it.impact.hi > o.impact.hi || (it.impact.hi === o.impact.hi && it.impact.lo > o.impact.lo)) best.set(it.subject.label, it);
    });
    best.forEach(it => { it.impact.counted = true; });
    items.filter(it => it.impact.kind === 'growth' && it.subject.kind === 'query' && !it.impact.counted).forEach(it => {
      const w = best.get(it.subject.label);
      it.impact.overlap = `Same search as “${w.typeLabel}”, which has the larger estimate and is the one counted`;
    });

    // ── declines against the previous period ──
    const dc = A.decay;
    if (dc) {
      const scaled = dc.scale !== 1;
      const periodWhy = scaled ? [-10, `The periods differ in length (${dc.prevDays} and ${A.days} days); the earlier one was scaled`] : [10, 'Both periods have the same length'];
      // How far the drop is beyond ordinary variation: click counts vary by about √n between periods.
      const noiseWhy = r => {
        if (r.cur.bound) return null;
        const z = r.lost / Math.sqrt(Math.max(1, r.prev.clicks));
        return z >= 4 ? [15, `The drop (${fmtN(r.lost)} clicks) is far larger than normal variation between periods`]
          : z >= 2 ? [5, `The drop (${fmtN(r.lost)} clicks) is larger than normal variation between periods`]
          : [-15, `A drop of ${fmtN(r.lost)} clicks is within normal variation for a page this size`];
      };
      const declineAction = r => r.cur.bound ? 'Confirm with a full Search Console connection: the current export stops at its row limit, so the page may only have dropped below the cut-off.'
        : r.cur.gone || /no longer shows/.test(r.reason) ? 'Check that the page still exists, returns 200, is indexable and is not redirected or set to noindex.'
        : /position fell/.test(r.reason) ? 'Look at what outranks it now. Refresh facts, dates and depth, and restore internal links to it.'
        : /impressions down/.test(r.reason) ? 'Check whether demand fell (season or trend) or the page lost visibility for its main searches. If demand fell, there may be nothing to fix.'
        : /CTR fell/.test(r.reason) ? 'Search its main queries: a new results-page feature or a stale title may be taking the click. Rewrite the title.'
        : 'Refresh the content and check what now ranks above it.';
      const declineEffort = r => r.cur.gone ? { level: 'Low', why: 'Technical check' } : r.cur.bound ? { level: 'Low', why: 'Check with fuller data first' } : { level: 'Medium', why: 'Content refresh' };
      dc.pages.forEach(r => add({
        type: 'decline-page', subject: { kind: 'page', label: r.path, url: r.p },
        measured: r.cur.bound ? { clicks: null, impr: null, ctr: null, pos: null, upTo: r.cur.clicks } : metrics(r.cur), previous: metrics(r.prev),
        change: r.deltas,
        reason: `Clicks ${fmtN(r.prev.clicks)} → ${r.cur.bound ? 'at most ' : ''}${fmtN(r.cur.clicks)} (${r.ch.toFixed(0)}%) against the previous period: ${r.reason}.`,
        evidence: changeEvidence(r),
        impact: { kind: 'recovery', lo: perMonth(r.lost) * 0.3, hi: perMonth(r.lost) * 0.8, counted: true, basis: 'Assumes 30–80% of the lost clicks come back after a fix' },
        confidence: conf([periodWhy, noiseWhy(r), r.uncertain ? [-30, 'Current clicks are only an upper bound (export row limit)'] : null]),
        action: declineAction(r), effort: declineEffort(r),
        warnings: (r.uncertain ? ['The current export does not list this page: it may have dropped below the export\'s top rows rather than lost all clicks.'] : []).concat(scaled ? ['Compared per day because the two periods have different lengths.'] : [])
      }));
      dc.queries.forEach(r => add({
        type: 'decline-query', subject: { kind: 'query', label: r.q },
        measured: r.cur.bound ? { clicks: null, impr: null, ctr: null, pos: null, upTo: r.cur.clicks } : metrics(r.cur), previous: metrics(r.prev),
        change: r.deltas,
        reason: `Clicks ${fmtN(r.prev.clicks)} → ${r.cur.bound ? 'at most ' : ''}${fmtN(r.cur.clicks)} (${r.ch.toFixed(0)}%): ${r.reason}.`,
        evidence: changeEvidence(r).concat(landEv(r.q)),
        impact: { kind: 'recovery', lo: perMonth(r.lost) * 0.3, hi: perMonth(r.lost) * 0.8, basis: 'Assumes 30–80% of the lost clicks come back after a fix', overlap: 'Overlaps the pages that lost clicks, so it is not added to the recovery total' },
        confidence: conf([periodWhy, noiseWhy(r), r.uncertain ? [-30, 'Current clicks are only an upper bound (export row limit)'] : null]),
        action: landing.has(r.q) ? `Check ${landing.get(r.q).path}, the page that ranks for it now, and what changed above it on the results page.` : 'Find the page that ranked for this search (Queries › open the search) and check what changed on it or above it on the results page.',
        effort: { level: 'Medium', why: 'Investigate, then refresh' },
        warnings: r.uncertain ? ['The current export does not list this search: it may only have dropped below the export\'s top rows.'] : []
      }));
      (dc.slipping ? dc.slipping.pages : []).forEach(r => add({
        type: 'slipping-page', subject: { kind: 'page', label: r.path, url: r.p },
        measured: metrics(r.cur), previous: metrics(r.prev), change: r.deltas,
        reason: `Clicks are holding (${r.ch == null ? '—' : r.ch.toFixed(0) + '%'}), but ${r.why.join(', ')}.`,
        evidence: changeEvidence(r),
        impact: { kind: 'none', lo: 0, hi: 0 },
        confidence: conf([periodWhy, vol(r.prev.impr, r.prev.pos, 'page')]),
        action: 'Check which searches it slipped on and what now ranks above it. A small refresh now is cheaper than recovering lost clicks later.',
        effort: { level: 'Low', why: 'Check and monitor' },
        warnings: []
      }));
    }

    // ── pages competing for the same search ──
    const exact = A.cannibalMode === 'exact';
    A.cannibal.filter(c => c.sev !== 'low').forEach(c => add({
      type: 'cannibal', subject: { kind: 'query', label: c.q },
      measured: { clicks: c.clicks, impr: c.impr, ctr: c.ctr, pos: c.pos },
      reason: exact ? `${c.pages.length} of your pages each take at least 10% of this search's impressions, so they compete with each other.`
        : `${c.variants.length} similar searches rank at very different positions (spread ${p1(c.spread)}), a likely sign that different pages compete.`,
      evidence: exact ? c.pages.map(p => `${window.CW.pathOf(p.p)}: ${p.share.toFixed(0)}% of impressions at position ${p1(p.pos)}`) : c.variants.slice(0, 4).map(v => `“${v.q}” at position ${p1(v.pos)}`),
      impact: { kind: 'stake', lo: 0, hi: c.loss * 0.5, overlap: 'Overlaps the search\'s own estimate, so it is not added to any total' },
      confidence: conf([exact ? [10, 'Measured: Search Console reports which page ranks for this search'] : [-25, 'Estimated from similar wording: the export has no query-to-page data'], c.sev === 'high' ? [10, 'The second page takes a large share of impressions'] : null], exact ? null : [44, 'Capped at Low: which pages compete is guessed from wording']),
      action: 'Choose the page that best matches the search. Merge the weaker page into it with a 301 redirect, or rewrite it for a different angle, and point internal links at the winner.',
      effort: { level: 'Medium', why: 'Merge or rewrite, plus redirects' },
      warnings: exact ? [] : ['Estimated: connect Search Console to confirm which pages compete.']
    }));

    // ── content gaps and internal links (content.js): advice with evidence, never a click estimate ──
    const C = A.content;
    if (C) {
      const GAP = { unranked: 'Nothing in this topic reaches page one', homepage: 'Only the homepage ranks', scattered: 'Split across several pages about it', diluted: 'Split between the matching page and unrelated ones', nomatch: 'No page is about this topic', questions: 'Question searches without a good answer' };
      C.gaps.forEach(g => add({
        type: 'content-gap', subject: { kind: 'query', label: g.label },
        measured: { clicks: g.clicks, impr: g.impr, ctr: g.impr ? g.clicks / g.impr * 100 : 0, pos: g.pos },
        reason: `${g.kinds.map(k => GAP[k]).join('; ')}. Topic of ${g.topic.n} search${g.topic.n === 1 ? '' : 'es'} led by “${g.label}”.`,
        evidence: g.evidence.concat(g.topic.rows.slice(0, 5).map(r => `“${r.q}”: ${fmtN(r.impr)} impressions at ${p1(r.pos)}`)),
        impact: { kind: 'none', lo: 0, hi: 0 },
        confidence: conf([g.impr >= C.gapFloor * 5 ? [15, `${fmtN(g.impr)} impressions: clear demand on this site`] : g.impr >= C.gapFloor * 2 ? [5, `${fmtN(g.impr)} impressions`] : [-5, `${fmtN(g.impr)} impressions: modest demand`],
          g.kinds.some(k => ['scattered', 'diluted', 'nomatch', 'homepage'].includes(k)) ? [10, 'Measured: Search Console reports which pages rank for these searches'] : [0, 'From positions only']], [69, 'Capped at Medium: whether a new or expanded page will rank is not known in advance']),
        action: g.action,
        effort: g.kinds.some(k => ['unranked', 'nomatch', 'homepage'].includes(k)) && !g.target ? { level: 'High', why: 'A new page' } : { level: 'Medium', why: g.kinds.includes('scattered') ? 'Merge pages and redirect' : 'Expand an existing page' },
        warnings: ['Demand here is impressions this site already gets, not the total searches for the topic.'].concat(g.needsQP ? ['Connect Search Console to see which of your pages rank for this topic.'] : [])
      }));
      C.links.forEach(l => add({
        type: 'internal-link', subject: { kind: 'page', label: l.path, url: l.p },
        measured: l.target ? { clicks: l.target.clicks, impr: l.target.impr, ctr: l.target.ctr, pos: l.target.pos } : metrics(A.P.find(r => r.p === l.p) || { clicks: 0, impr: l.impr, ctr: 0, pos: l.pos }),
        reason: l.target ? `Ranks at ${p1(l.target.pos)} for “${l.anchor}” (${fmtN(l.target.impr)} impressions); ${l.sources.length} page${l.sources.length === 1 ? '' : 's'} on the same topic already rank on page one.` : `Ranks at ${p1(l.pos)} with ${fmtN(l.impr)} impressions; stronger pages in the same folder could link to it.`,
        evidence: l.sources.map(s => `${s.path} ${s.why}`),
        impact: { kind: 'none', lo: 0, hi: 0 },
        confidence: conf([l.evidence === 'search' ? [10, 'Sources rank for searches in the same topic'] : [-20, 'Sources chosen by folder only: the export has no search-to-page data'], l.verified ? [10, 'Checked against your crawler export: these links do not exist yet'] : [-5, 'Not checked against existing links (upload a crawler export to check)']], l.evidence === 'search' ? null : [44, 'Capped at Low: relevance is guessed from the folder']),
        action: `Add a link to ${l.path} from ${l.sources.map(s => s.path).join(', ')}${l.anchor ? ` with anchor text like “${l.anchor}”` : ', using the page\'s main topic as anchor text'}, in the body text where it fits.`,
        effort: { level: 'Low', why: 'Edit a few existing pages' },
        warnings: l.verified ? [] : ['Search Console has no link data: some of these links may already exist.']
      }));
    }

    items.forEach(it => { it.rank = (it.impact.lo || 0); });
    items.sort((a, b) => b.impact.lo - a.impact.lo || b.confidence.score - a.confidence.score || b.impact.hi - a.impact.hi);
    const tot = list => ({ lo: list.reduce((s, it) => s + it.impact.lo, 0), hi: list.reduce((s, it) => s + it.impact.hi, 0), n: list.length });
    const counted = items.filter(it => it.impact.counted);
    return {
      items,
      totals: { growth: tot(counted.filter(it => it.impact.kind === 'growth')), recovery: tot(counted.filter(it => it.impact.kind === 'recovery')) },
      byLevel: { High: items.filter(it => it.confidence.level === 'High').length, Medium: items.filter(it => it.confidence.level === 'Medium').length, Low: items.filter(it => it.confidence.level === 'Low').length },
      period: { start: A.method.start, end: A.method.end, days: A.days, assumed: A.method.assumedDays, prevStart: D.prevStart || null, prevEnd: D.prevEnd || null, prevDays: dc ? dc.prevDays : null, scaled: dc ? dc.scale !== 1 : false },
      warnings, TYPES, IMPACT
    };
  }

  function changeEvidence(r) {
    const d = r.deltas || {}, out = [];
    if (r.cur.bound) return [`Before: ${fmtN(r.prev.clicks)} clicks, ${fmtN(r.prev.impr)} impressions, position ${p1(r.prev.pos)}`, `Now: not in the export (at most ${fmtN(r.cur.clicks)} clicks)`];
    out.push(`Clicks ${fmtN(r.prev.clicks)} → ${fmtN(r.cur.clicks)}${d.clicks == null ? '' : ` (${d.clicks > 0 ? '+' : ''}${d.clicks.toFixed(0)}%)`}`);
    if (d.impr != null) out.push(`Impressions ${fmtN(r.prev.impr)} → ${fmtN(r.cur.impr)} (${d.impr > 0 ? '+' : ''}${d.impr.toFixed(0)}%)`);
    if (d.ctr != null) out.push(`CTR ${p1(r.prev.ctr)}% → ${p1(r.cur.ctr)}%`);
    if (d.pos != null) out.push(`Position ${p1(r.prev.pos)} → ${p1(r.cur.pos)}`);
    return out;
  }

  window.CW_OPPS = { build, TYPES, IMPACT, level };
})();

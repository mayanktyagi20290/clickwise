// Clickwise one-click workflows — each template says what it finds, what data it needs,
// which thresholds it uses, and what it produces. Pure functions, no DOM.
(function () {
  'use strict';
  const CW = window.CW, F = window.CW_FILTERS;
  const fmtN = CW.fmtN;

  // Data a workflow can need. `required` blocks the run; `better` only lowers confidence.
  const DATA = {
    queries: { label: 'Search queries', how: 'Upload a Search Console export or connect Search Console.' },
    pages: { label: 'Page performance', how: 'Upload a Search Console export or connect Search Console.' },
    prev: { label: 'A comparison period', how: 'Upload an export made with Search Console’s Date › Compare option, or two exports together (this period and the one before), or connect Search Console with “Compare with the previous period” ticked.' },
    qp: { label: 'Which query lands on which page', how: 'Connect Search Console. File exports do not include it.' },
    dates: { label: 'Daily totals', how: 'Include the Dates sheet in your export, or connect Search Console.' }
  };
  function hasData(k, A) {
    const D = A.data || {};
    return k === 'queries' ? A.Q.length > 0 : k === 'pages' ? A.P.length > 0 : k === 'prev' ? !!(D.prevQ && D.prevQ.length || D.prevP && D.prevP.length)
      : k === 'qp' ? !!(D.QP && D.QP.length) : k === 'dates' ? !!(D.C && D.C.length) : false;
  }
  const LOADING = { prev: 'prev', qp: 'qp' };
  const isLoading = (k, A) => !!(A.data && A.data.pending && LOADING[k] && A.data.pending[LOADING[k]]);
  function missing(w, A) { return (w.needs || []).filter(k => !hasData(k, A)).map(k => isLoading(k, A) ? { key: k, ...DATA[k], how: 'Still loading from Search Console — this fills in by itself in a moment.' } : { key: k, ...DATA[k] }); }
  function weaker(w, A) { return (w.better || []).filter(k => !hasData(k, A)).map(k => ({ key: k, ...DATA[k] })); }

  const TEMPLATES = [
    { id: 'quickwins', name: 'Find SEO quick wins', icon: 'bolt', tone: 'orange', featured: true,
      finds: 'Searches close to the top 3 and page-one results that earn fewer clicks than they should, merged into one prioritised to-do list.',
      needs: ['queries', 'pages'], better: ['qp'],
      conditions: ['Non-branded searches ranking 4–20 with above-median impressions', 'Page-one pages and searches under 60% of the clicks this site normally earns at their position', 'Top-5 searches that may be answered on the results page', 'One estimate per search; page estimates shown but not added to the total', 'Low-confidence findings left out (see All opportunities for them)'],
      output: 'A ranked action list with a low–high clicks-per-month estimate, confidence and effort.',
      steps: ['Analyse query and page performance', 'Find ranking and CTR opportunities', 'Remove duplicates and low-confidence findings', 'Prioritise by estimated clicks', 'Build the action plan'] },
    { id: 'brand', name: 'Split branded and non-branded searches', icon: 'star', tone: 'violet',
      finds: 'How much of your search traffic comes from people already looking for you, and how much SEO is really earning.',
      needs: ['queries'], conditions: ['Brand terms from Settings (edit any time)', 'Misspellings you added count as branded'],
      output: 'Two groups with clicks, impressions, CTR and position.', spec: () => ({ target: 'query', conds: [], group: 'brand' }) },
    { id: 'striking', name: 'Keywords ranking 4–20', icon: 'rocket', tone: 'green',
      finds: 'Non-branded searches already close to the top 3 — usually the fastest ranking gains.',
      needs: ['queries'], conditions: ['Position 4 to 20', 'Non-branded', 'Impressions above this site’s median'],
      output: 'Searches sorted by impressions, with the page to improve when available.',
      spec: A => ({ target: 'query', conds: [{ f: 'pos', op: 'between', v: 4, v2: 20 }, { f: 'brand', op: 'is', v: false }, { f: 'impr', op: 'gte', v: A.imprFloor, note: 'site median' }] }) },
    { id: 'lowctr', name: 'High-impression, low-CTR pages', icon: 'eye', tone: 'amber',
      finds: 'Pages Google shows often on page one that people rarely click. Titles and descriptions fix most of these.',
      needs: ['pages'], conditions: ['Impressions in the top 25% of your pages', 'Position 10 or better', 'Under 60% of the clicks this site normally earns at that position', 'Likely sitelinks and utility pages set aside, with the reason'],
      output: 'Pages sorted by impressions, with expected CTR alongside actual CTR. Likely branded sitelinks and utility pages are listed separately.', setAside: true,
      spec: A => ({ target: 'page', conds: [{ f: 'impr', op: 'gte', v: F.rows(A).high.page, note: 'top 25% on this site' }, { f: 'pos', op: 'lte', v: 10 }, { f: 'ctrGap', op: 'lt', v: 60 }] }) },
    { id: 'declines', name: 'Discover traffic declines', icon: 'down', tone: 'red',
      finds: 'Pages and searches that lost a meaningful share of clicks since the previous period, with the most likely cause.',
      needs: ['pages', 'prev'], conditions: ['Pages that lost at least 25% of clicks', 'Searches that lost at least 30%', 'Small pages ignored (below this site’s typical click volume)'],
      output: 'Declining pages with clicks before and after and a likely cause; gaining pages for comparison.' },
    { id: 'questions', name: 'Question-based searches', icon: 'help', tone: 'indigo',
      finds: 'Searches phrased as questions — what AI Overviews and People Also Ask answer first.',
      needs: ['queries'], conditions: ['Starts with who, what, when, where, why, how, which, can, does, is, should…', 'Non-branded'],
      output: 'Questions sorted by impressions, ready to answer in 40–60 words on the page.',
      spec: () => ({ target: 'query', conds: [{ f: 'question', op: 'is', v: true }, { f: 'brand', op: 'is', v: false }] }) },
    { id: 'pagetypes', name: 'Group URLs by page type', icon: 'file', tone: 'teal',
      finds: 'How each kind of page performs — blog, products, categories, guides, listings and so on — detected from your URL structure.',
      needs: ['pages'], conditions: ['Type read from the first folder of each URL', 'Common folder names mapped to friendly types; other folders keep their own name'],
      output: 'One group per page type with clicks, impressions, CTR and position.', spec: () => ({ target: 'page', conds: [], group: 'pageType' }) },
    { id: 'location', name: 'Find location-based keywords', icon: 'compass', tone: 'teal',
      finds: 'Searches that mention a city, state, country or “near me”, grouped by place.',
      needs: ['queries'], conditions: ['Matches a built-in list of major cities, Indian states and countries', '“near me” and “nearby” count as local'],
      output: 'One group per place, sorted by clicks.', spec: () => ({ target: 'query', conds: [{ f: 'location', op: 'is', v: true }], group: 'location' }) },
    { id: 'cannibal', name: 'Detect possible keyword cannibalisation', icon: 'warn', tone: 'red',
      finds: 'Searches where two or more of your own pages split the impressions. These are candidates to investigate, not confirmed problems.',
      needs: ['queries'], better: ['qp'], conditions: ['With Search Console connected: each competing page has at least 10% of the impressions', 'With a file upload: similar searches with very different positions (estimate)'],
      output: 'Searches with the competing URLs, their share and severity.' },
    { id: 'links', name: 'Pages that need internal links', icon: 'link', tone: 'indigo',
      finds: 'Pages ranking on the edge of page one that would benefit most from links, each with stronger pages in the same section that could link to them.',
      needs: ['pages'], better: ['qp'], conditions: ['Average position 5–20', 'Impressions above this site’s median', 'Suggested sources: your best-ranking pages in the same folder'],
      output: 'Target pages, suggested source pages and anchor text from real searches when available.' },
    { id: 'ignore', name: 'Exclude irrelevant searches', icon: 'filter', tone: 'amber', interactive: true,
      finds: 'Remove searches you never want counted — job seekers, competitor names, spam — from every report.',
      needs: ['queries'], conditions: ['Any search containing one of your words is left out', 'Applies to every report for this site, in this browser'],
      output: 'A preview of what will be removed before you save.' },
    { id: 'report', name: 'SEO opportunity report', icon: 'book', tone: 'green',
      finds: 'One page with headline numbers, what changed, the top actions and the biggest risks — ready to print or send.',
      needs: ['queries', 'pages'], better: ['prev', 'dates'], conditions: ['Uses the loaded date range', 'Top 5 actions by estimated clicks', 'Largest declines and AI-search risks'],
      output: 'A printable report.', schedule: 'Runs on demand. Automatic weekly delivery needs the Clickwise server, which is not live yet; print or save as PDF any time.' }
  ];

  const byId = id => TEMPLATES.find(w => w.id === id);

  // ── runners ──
  // Quick wins come straight from the opportunity engine, so a search has the same estimate,
  // confidence and effort here as in All opportunities. One entry per search (its largest estimate)
  // plus page titles; page estimates overlap the searches that land on them and are not totalled.
  // Low-confidence findings are left out of this workflow (they stay in All opportunities).
  const KIND = { striking: 'Ranking', 'ctr-query': 'CTR', 'answer-box': 'Answer box?', 'ctr-page': 'Page title' };
  function quickWins(A) {
    const O = A.opps || window.CW_OPPS.build(A, A.data);
    const all = O.items.filter(it => (it.impact.kind === 'growth' && it.subject.kind === 'query' && it.impact.counted) || it.type === 'ctr-page')
      .map(it => {
        const page = it.subject.kind === 'page', f = it.flags || {};
        return { kind: KIND[it.type], item: it.subject.label, url: it.subject.url, isQuery: !page, why: it.reason, action: it.action,
          gainLo: it.impact.lo, gainHi: it.impact.hi, gain: it.impact.lo, impr: it.measured.impr, effort: it.effort.level, overlap: page,
          serp: f.serp, capped: f.capped, confidence: it.confidence.level, conf: { High: 3, Medium: 2, Low: 1 }[it.confidence.level], score: it.confidence.score,
          note: [f.serp ? 'results-page feature likely' : '', f.capped ? 'capped: unusually large' : '', page ? 'overlaps search estimates; not in total' : ''].filter(Boolean).join('; ') };
      }).filter(r => r.gainHi >= 1);
    const kept = all.filter(r => r.confidence !== 'Low');
    kept.sort((a, b) => b.gainLo - a.gainLo || b.conf - a.conf || b.gainHi - a.gainHi);
    const counted = kept.filter(r => !r.overlap);
    const lo = counted.reduce((s, r) => s + r.gainLo, 0), hi = counted.reduce((s, r) => s + r.gainHi, 0);
    const dropped = all.length - kept.length;
    return {
      summary: kept.length ? `Found ${kept.length} quick wins with medium or high confidence (${counted.length} searches, ${kept.length - counted.length} page titles). The searches could add about ${fmtN(lo)}–${fmtN(hi)} clicks a month; page-title estimates overlap those searches and are not added.${dropped ? ` ${dropped} low-confidence finding${dropped === 1 ? ' is' : 's are'} left out here and listed in All opportunities.` : ''}` : 'No quick wins with enough data in this range. Try a longer date range.',
      stats: [{ v: kept.length, l: 'quick wins', tone: 'gain' }, { v: '+' + fmtN(lo) + '–' + fmtN(hi), l: 'clicks a month (estimate, searches only)', tone: 'gain' }, { v: dropped, l: 'low-confidence findings left out', tone: '' }],
      total: { lo, hi },
      table: { cols: 'quickwins', rows: kept, sort: 'gain' },
      plan: A.plan.slice(0, 5)
    };
  }

  function declines(A) {
    const dc = A.decay;
    if (!dc) return { summary: 'Needs a comparison period.', stats: [], table: null };
    return {
      summary: dc.pages.length ? `${dc.pages.length} page${dc.pages.length === 1 ? '' : 's'} lost ${fmtN(dc.lost)} clicks compared with the previous period. ${dc.rising.length} page${dc.rising.length === 1 ? ' is' : 's are'} growing.` : 'No page lost more than a quarter of its clicks. Nice.',
      stats: [{ v: dc.pages.length, l: 'pages declining', tone: 'risk' }, { v: '−' + fmtN(dc.lost), l: 'clicks lost', tone: 'risk' }, { v: dc.queries.length, l: 'searches declining', tone: 'watch' }, { v: dc.rising.length, l: 'pages growing', tone: 'gain' }],
      table: { cols: 'decline', rows: dc.pages.map(r => ({ ...r, prevC: r.prev.clicks, curC: r.cur.clicks })), sort: 'lost' },
      extra: { cols: 'declineQ', title: 'Searches losing clicks', rows: dc.queries.map(r => ({ ...r, prevC: r.prev.clicks, curC: r.cur.clicks })), sort: 'lost' }
    };
  }

  function cannibal(A) {
    const exact = A.cannibalMode === 'exact';
    const rows = A.cannibal.filter(c => c.sev !== 'low');
    return {
      summary: rows.length ? `${rows.length} search${rows.length === 1 ? '' : 'es'} may be split between your own pages${exact ? '' : ' (estimated from similar searches; connect Search Console for exact pages)'}. Review each before merging anything.` : 'No meaningful competition between your own pages found.',
      stats: [{ v: rows.filter(r => r.sev === 'high').length, l: 'high severity', tone: 'risk' }, { v: rows.filter(r => r.sev === 'medium').length, l: 'medium severity', tone: 'watch' }, { v: exact ? 'Exact' : 'Estimate', l: 'detection mode', tone: exact ? 'gain' : 'watch' }],
      table: { cols: exact ? 'cannibal' : 'cannibalEst', rows, sort: 'loss' }
    };
  }

  function links(A) {
    const R = F.rows(A);
    const D = A.data || {};
    const median = Math.max(20, Math.round(CW.pct(A.P.map(r => r.impr).filter(v => v > 0), 0.5)));
    const topQ = new Map();
    (D.QP || []).forEach(r => { if (A.isBrand(r.q)) return; const cur = topQ.get(r.p); if (!cur || r.impr > cur.impr) topQ.set(r.p, r); });
    const pages = R.page.filter(r => !r.gone);
    const strongBy = new Map();
    pages.filter(r => r.pos > 0 && r.pos <= 6 && r.clicks > 0).forEach(r => { if (!strongBy.has(r.folder)) strongBy.set(r.folder, []); strongBy.get(r.folder).push(r); });
    strongBy.forEach(a => a.sort((x, y) => y.clicks - x.clicks));
    const siteStrong = pages.filter(r => r.pos > 0 && r.pos <= 6 && r.clicks > 0).sort((a, b) => b.clicks - a.clicks);
    const targets = pages.filter(r => r.pos >= 5 && r.pos <= 20 && r.impr >= median && r.path !== '/').sort((a, b) => b.impr - a.impr).slice(0, 200).map(r => {
      const same = (strongBy.get(r.folder) || []).filter(s => s.p !== r.p);
      const src = (same.length ? same : siteStrong.filter(s => s.p !== r.p)).slice(0, 3);
      const q = topQ.get(r.p);
      return { ...r, sources: src, sameFolder: same.length > 0, anchor: q ? q.q : null };
    }).filter(r => r.sources.length);
    return {
      summary: targets.length ? `${targets.length} page${targets.length === 1 ? '' : 's'} rank on the edge of page one and could use links from your stronger pages. Search Console has no link data, so check what already links to each page first.` : 'No pages on positions 5–20 with enough impressions.',
      stats: [{ v: targets.length, l: 'pages to link to', tone: 'gain' }, { v: targets.filter(t => t.sameFolder).length, l: 'with sources in the same section', tone: '' }, { v: targets.filter(t => t.anchor).length, l: 'with anchor text from real searches', tone: '' }],
      table: { cols: 'links', rows: targets, sort: 'impr' }
    };
  }

  function ignorePreview(A, terms) {
    const t = (terms || []).map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 50);
    const rows = t.length ? A.Q.filter(r => { const l = r.q.toLowerCase(); return t.some(x => l.includes(x)); }) : [];
    const a = CW.agg(rows);
    return {
      summary: !t.length ? (A.ignored && A.ignored.length ? `Currently ignoring searches that contain: ${A.ignored.join(', ')}.` : 'Type words to leave out, separated by commas. Nothing is removed until you save.')
        : `${rows.length} search${rows.length === 1 ? '' : 'es'} (${fmtN(a.clicks)} clicks, ${fmtN(a.impr)} impressions) would be left out of every report.`,
      stats: t.length ? [{ v: rows.length, l: 'searches removed', tone: 'watch' }, { v: fmtN(a.clicks), l: 'clicks removed', tone: '' }] : [],
      table: t.length ? { cols: 'queries', rows, sort: 'impr' } : null, terms: t
    };
  }

  function report(A, ctx) {
    const D = A.data || {};
    const nb = A.totNB, p = A.prev;
    const ch = (c, pr) => pr ? (c - pr) / pr * 100 : null;
    return {
      summary: `Search performance for ${ctx && ctx.site || D.site}${D.start && D.end ? `, ${D.start} to ${D.end}` : ''}.`,
      report: {
        clicks: nb.clicks, impr: nb.impr, ctr: nb.ctr, pos: nb.pos,
        dClicks: p ? ch(nb.clicks, p.nb.clicks) : null, dImpr: p ? ch(nb.impr, p.nb.impr) : null,
        potential: A.potential, method: A.method, coverage: A.coverage, site: A.site, plan: A.plan.slice(0, 5),
        declines: A.decay ? A.decay.pages.slice(0, 5) : null, rising: A.decay ? A.decay.rising.slice(0, 3) : null,
        // the ten highest-value opportunities with medium or high confidence, from the opportunity engine
        top: (A.opps || window.CW_OPPS.build(A, D)).items.filter(it => it.confidence.level !== 'Low' && it.impact.kind !== 'none').slice(0, 10),
        recovery: (A.opps || window.CW_OPPS.build(A, D)).totals.recovery,
        quick: A.quickWins.slice(0, 5), ai: { overview: A.ai.overview.length, aiMode: A.ai.aiMode.length, readiness: A.readiness },
        brandShare: A.totAll.clicks ? A.totB.clicks / A.totAll.clicks * 100 : 0, start: D.start, end: D.end, sample: D.source === 'demo'
      },
      stats: []
    };
  }

  function run(id, A, ctx) {
    const w = byId(id);
    if (!w) return { error: 'Unknown workflow.' };
    const miss = missing(w, A);
    if (miss.length) return { missing: miss, summary: 'This workflow needs: ' + miss.map(m => m.label.toLowerCase()).join(', ') + '.' };
    if (w.spec) {
      const spec = w.spec(A);
      const res = F.run(spec, A);
      if (!res.ok) return { error: res.errors.join(' ') };
      // pages that are probably sitelinks or utility pages are listed separately, not silently dropped
      let setAside = null;
      if (w.setAside && spec.target === 'page') {
        setAside = res.rows.filter(r => r.flag);
        res.rows = res.rows.filter(r => !r.flag);
        res.total = CW.agg(res.rows.filter(r => !r.gone));
      }
      const n = res.rows.length;
      return {
        spec, result: res,
        summary: res.groups ? `${n.toLocaleString()} ${spec.target === 'page' ? 'page' : 'search'}${n === 1 ? '' : 'es'.slice(spec.target === 'page' ? 1 : 0)} in ${res.groups.length} group${res.groups.length === 1 ? '' : 's'}. ${F.describe(spec)}`
          : `${n.toLocaleString()} ${spec.target === 'page' ? 'page' : 'search'}${n === 1 ? '' : 'es'.slice(spec.target === 'page' ? 1 : 0)} found. ${F.describe(spec)}`,
        stats: [{ v: n.toLocaleString(), l: spec.target === 'page' ? 'pages' : 'searches', tone: 'gain' }, { v: fmtN(res.total.clicks), l: 'clicks', tone: '' }, { v: fmtN(res.total.impr), l: 'impressions', tone: '' }].concat(setAside && setAside.length ? [{ v: setAside.length, l: 'set aside (likely sitelinks or utility pages)', tone: 'watch' }] : []),
        setAside
      };
    }
    switch (id) {
      case 'quickwins': return quickWins(A);
      case 'declines': return declines(A);
      case 'cannibal': return cannibal(A);
      case 'links': return links(A);
      case 'ignore': return ignorePreview(A, ctx && ctx.terms);
      case 'report': return report(A, ctx);
    }
    return { error: 'This workflow has no runner.' };
  }

  // ── goals: workflows people describe in their own words ──
  // A goal is plain data: { v: 1, name, text, spec }. It is checked before every run, because saved goals come
  // back from browser storage and may be stale (data changed) or edited by hand.
  const GOAL_VERSION = 1;
  const COND_KEYS = new Set(['f', 'op', 'v', 'v2', 'note']);
  function validateGoal(g) {
    const e = [];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return ['This saved workflow is damaged and cannot be read.'];
    if (g.v !== GOAL_VERSION) e.push('This saved workflow was made by a different version of Clickwise. Describe it again and save it.');
    if (typeof g.name !== 'string' || !g.name.trim() || g.name.length > 80) e.push('Give the workflow a name of up to 80 characters.');
    if (g.text != null && (typeof g.text !== 'string' || g.text.length > 300)) e.push('The description is too long.');
    const sp = g.spec;
    if (!sp || typeof sp !== 'object' || !Array.isArray(sp.conds)) e.push('The workflow has no conditions to run.');
    else {
      if (sp.conds.some(c => !c || typeof c !== 'object' || Object.keys(c).some(k => !COND_KEYS.has(k)))) e.push('One of the conditions is damaged.');
      const extra = Object.keys(sp).filter(k => !['target', 'conds', 'group', 'caseSensitive', 'limit', 'sort'].includes(k));
      if (extra.length) e.push('The workflow contains settings Clickwise does not recognise.');
    }
    return e;
  }
  const makeGoal = (name, text, spec) => ({ v: GOAL_VERSION, name: String(name || '').trim().slice(0, 80), text: String(text || '').slice(0, 300), spec: JSON.parse(JSON.stringify(spec)) });
  // Runs a goal on the loaded data. Same input, same output; returns a record for the run history.
  // status: done | needs-data (the data cannot answer it; nothing is wrong with the goal) | failed
  function runGoal(g, A, now) {
    const t0 = Date.now(), D = A.data || {};
    const rec = { at: (now || new Date()).toISOString(), name: g && g.name, status: 'failed', count: 0, matched: 0, errors: [], data: { source: D.source || null, site: D.site || null, start: D.start || null, end: D.end || null, days: A.days } };
    const ge = validateGoal(g);
    if (ge.length) { rec.errors = ge; rec.ms = Date.now() - t0; return { record: rec }; }
    const R = F.rows(A);
    const errs = F.validate(g.spec, R);
    if (errs.length) {
      rec.errors = errs;
      // needs-data: the request is fine but this data lacks a comparison period or query-page rows
      rec.status = errs.every(x => /needs a comparison period|needs to know which page ranks/.test(x)) ? 'needs-data' : 'failed';
      rec.ms = Date.now() - t0; return { record: rec };
    }
    const res = F.run(g.spec, A);
    rec.status = 'done'; rec.count = res.rows.length; rec.matched = res.matched; rec.ms = Date.now() - t0;
    rec.totals = { clicks: res.total.clicks, impr: res.total.impr };
    return { record: rec, result: res };
  }

  window.CW_WORKFLOWS = { TEMPLATES, DATA, run, missing, weaker, byId, hasData, validateGoal, makeGoal, runGoal, GOAL_VERSION };
})();

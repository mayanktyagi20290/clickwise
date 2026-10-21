// Clickwise action explanations. For one prioritised opportunity (priority.js), says why it matters, which
// Search Console and crawler evidence supports it, which searches and URLs it touches, how to implement it,
// and its estimated impact, confidence and effort. Pure functions: everything comes from the loaded data.
(function () {
  'use strict';
  const CW = window.CW;
  const p1 = v => v == null || isNaN(v) ? '—' : (+v).toFixed(1);

  const WHY = {
    striking: g => `“${g.subject.label}” already ranks at position ${p1(g.measured.pos)}. Most clicks go to the top three results, so a small climb moves clicks more than anything else on this list for the same effort.`,
    'ctr-query': g => `The site ranks well for “${g.subject.label}” but searchers rarely choose it: ${p1(g.measured.ctr)}% CTR where this site normally earns more. The ranking is already won; the listing is losing the click.`,
    'ctr-page': g => `${g.subject.label} is seen often but clicked less than pages at the same position usually are. Its title and description are the first thing to fix.`,
    'answer-box': g => `A top-5 ranking for “${g.subject.label}” earns very few clicks. Something on the results page, possibly an AI Overview or answer box, may be answering the question before anyone clicks.`,
    'decline-page': g => g.impact.recoverable === false ? `${g.subject.label} is getting fewer clicks than before, but ${lower(g.impact.recoverWhy)}. Check it, but do not expect SEO work to bring the clicks back.` : `${g.subject.label} lost clicks against the previous period, and the cause is one a page change can address. Clicks lost to a fixable problem are usually the fastest to win back.`,
    'decline-query': g => `“${g.subject.label}” brings fewer clicks than in the previous period. Finding out what changed protects the page that ranks for it.`,
    'slipping-page': g => `${g.subject.label} is slipping in rank or impressions before its clicks fall far. A small fix now costs less than recovering lost clicks later.`,
    cannibal: g => `Several of your pages compete for “${g.subject.label}”, so Google splits rank and clicks between them instead of putting one strong page forward.`,
    'content-gap': g => `Searches about “${g.subject.label}” already show this site, yet no page ranks well for them. A page that answers the topic fully can turn those impressions into clicks.`,
    'internal-link': g => `${g.subject.label} ranks just short of where it could, and pages on the same topic that already rank well do not link to it. Links from them pass relevance and get it crawled sooner.`
  };
  const lower = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';

  // implementation steps by type, filled with the item's own search, page and numbers
  function steps(g, ctx) {
    const q = g.subject.kind === 'query' ? `“${g.subject.label}”` : null;
    const page = g.page ? g.page.path : g.subject.kind === 'page' ? g.subject.label : 'the page that ranks for it';
    const topQ = ctx.queries[0] ? `“${ctx.queries[0].q}”` : 'its main search';
    const track = 'When it is live, mark the task Implemented with the date, so Clickwise compares equal periods before and after.';
    switch (g.type) {
      case 'striking': return [
        `Open ${page} and confirm it is the page you want ranking for ${q}.`,
        `Put ${q} in the title and in a heading near the top, and answer it in the first paragraph.`,
        g.measured.pos > 10.5 ? 'Expand the content so it covers the topic as fully as the pages now on page one.' : 'Tighten the section that answers the search: facts, numbers, a clear summary.',
        `Add 2–3 internal links to ${page} from related pages that already rank, using ${q} as the anchor text.`, track];
      case 'ctr-query': case 'ctr-page': return [
        g.flags && g.flags.serp || g.warnings.some(w => /answer box|AI Overview/.test(w)) ? `Search ${q || topQ} on Google first. If an AI Overview or answer box shows, a new title alone may not help.` : `Search ${q || topQ} on Google and look at the titles you compete with.`,
        `Rewrite the title of ${page} around ${q || topQ}: what the page offers, plus a concrete benefit or number, under about 60 characters.`,
        'Rewrite the meta description to match the search and give a reason to click.',
        'Leave the content and URL as they are, so the result shows the effect of the title alone.', track];
      case 'answer-box': return [
        `Search ${q} on Google and note whether an AI Overview, featured snippet or other answer shows.`,
        `Open ${page} with a 40–60 word direct answer to ${q}.`,
        'Add the follow-up questions as headings with short answers (FAQ structure), and a reason to click for the full detail.',
        'Low end of the estimate is zero: an answer on the results page may keep taking the click.', track];
      case 'decline-page': return g.impact.recoverable === false ? [
        `Compare impressions for ${page} with last year in Search Console, to see whether demand simply fell.`,
        'Check the page loads, returns 200 and is indexable.',
        'If both are fine, monitor it rather than rewriting it.'] : [
        `Check ${page} returns 200, is indexable, is not redirected or set to noindex, and is in the sitemap.`,
        `Search ${topQ} and see what now ranks above it.`,
        'Refresh facts, dates and depth against those pages, and restore internal links that pointed at it.', track];
      case 'decline-query': return [
        `Find the page ranking for ${q} (${page}) and check what changed on it.`,
        `Search ${q} and see what now ranks above it or what new results-page feature appeared.`,
        'Refresh the page where it is behind, then track the change.'];
      case 'slipping-page': return [
        `Open ${page} in Search Console › Performance and compare the searches it slipped on.`,
        'Check what now ranks above it for those searches.',
        'Make a small refresh (facts, dates, a missing subtopic) before clicks fall further.'];
      case 'cannibal': return [
        `List the pages competing for ${q}: ${ctx.urls.slice(0, 3).map(u => u.path).join(', ') || 'see the evidence'}.`,
        'Choose the one that best matches the search.',
        'Merge the weaker page into it with a 301 redirect, or rewrite it for a different angle.',
        'Point internal links for this topic at the chosen page.', track];
      case 'content-gap': return [
        `Review the searches in this topic: ${ctx.queries.slice(0, 3).map(r => `“${r.q}”`).join(', ') || q}.`,
        g.action,
        'Link to the page from related pages that already rank.',
        'Expect results in months rather than weeks: new content takes time to rank.'];
      case 'internal-link': return [
        g.action,
        'Place the link in body text where it helps the reader, not in a footer or sidebar.',
        'Check the linking pages are indexable and the target returns 200.', track];
      default: return [g.action, track];
    }
  }

  function build(g, A, D, F) {
    D = D || {};
    const qp = D.QP || [];
    const url = g.page ? g.page.url : g.subject.kind === 'page' ? g.subject.url : null;
    // affected searches: for a page, the searches it ranks for (query-page data); for a search, itself and merged searches
    let queries = [];
    if (g.subject.kind === 'query') {
      const own = (A.Q || []).find(r => r.q === g.subject.label);
      queries.push(own ? { q: own.q, clicks: own.clicks, impr: own.impr, pos: own.pos } : { q: g.subject.label, clicks: g.measured.clicks, impr: g.measured.impr, pos: g.measured.pos });
      g.related.filter(r => r.subject.kind === 'query' && r.subject.label !== g.subject.label).forEach(r => queries.push({ q: r.subject.label, clicks: r.measured.clicks, impr: r.measured.impr, pos: r.measured.pos }));
    }
    if (url && qp.length) {
      qp.filter(r => r.p === url).sort((a, b) => b.impr - a.impr).slice(0, 8).forEach(r => { if (!queries.some(x => x.q === r.q)) queries.push({ q: r.q, clicks: r.clicks, impr: r.impr, pos: r.pos }); });
    } else if (url && g.primary.type === 'ctr-page') {
      (A.ctrPages.find(r => r.p === url) || {}).top && A.ctrPages.find(r => r.p === url).top.forEach(q => { if (!queries.some(x => x.q === q)) queries.push({ q }); });
    }
    if (g.type === 'content-gap' && A.content) {
      const gap = A.content.gaps.find(x => x.label === g.subject.label);
      if (gap) gap.topic.rows.slice(0, 8).forEach(r => { if (!queries.some(x => x.q === r.q)) queries.push({ q: r.q, clicks: r.clicks, impr: r.impr, pos: r.pos }); });
    }
    queries = queries.slice(0, 8);
    // affected URLs
    const urls = [];
    const addUrl = (u, why) => { if (u && !urls.some(x => x.url === u)) urls.push({ url: u, path: CW.pathOf(u), why }); };
    if (url) addUrl(url, g.subject.kind === 'page' ? 'The page this is about' : 'Ranks for this search');
    if (g.type === 'cannibal') { const c = (A.cannibal || []).find(x => x.q === g.subject.label); if (c && c.pages) c.pages.forEach(p => addUrl(p.p, `${p.share.toFixed(0)}% of impressions at position ${p1(p.pos)}`)); }
    if (g.subject.kind === 'query' && qp.length) qp.filter(r => r.q === g.subject.label && r.impr > 0).sort((a, b) => b.impr - a.impr).slice(0, 4).forEach(r => addUrl(r.p, `${CW.fmtN(r.impr)} impressions at position ${p1(r.pos)}`));
    if (g.type === 'internal-link' && A.content) { const l = A.content.links.find(x => x.p === g.subject.url); if (l) l.sources.forEach(s => addUrl(s.p || s.url, 'Link from here')); }

    // evidence, each line with its source
    const evidence = g.evidence.map(t => ({ text: t, source: 'Search Console' }));
    let crawl = null;
    if (A.titles && url) {
      const key = CW.pathOf(url);
      const row = A.titles.rows.find(r => r.url === url || r.path === key);
      if (row) { crawl = row; row.issues.filter(i => i.kind !== 'ctr').forEach(i => evidence.push({ text: i.text, source: 'Crawler' })); if (row.title) evidence.push({ text: `Current title: “${row.title}”`, source: 'Crawler' }); }
    }
    const contrib = F && F.opp ? window.CW_FORECAST.groupContribution(g, F) : null;
    return {
      why: (WHY[g.type] || (() => g.reason))(g),
      evidence, crawl: !!crawl, crawlLoaded: !!A.titles, needsQP: !qp.length,
      queries, urls,
      steps: steps(g, { queries, urls }).filter(Boolean),
      impact: { lo: g.impact.lo || 0, hi: g.impact.hi || 0, kind: g.impact.kind, note: g.impact.note, contribution: contrib },
      confidence: g.confidence, effort: g.effort,
      link: '#opp?id=' + encodeURIComponent(g.id), list: '#' + g.view
    };
  }

  window.CW_EXPLAIN = { build, steps, WHY };
})();

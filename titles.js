// Clickwise title & meta audit — a crawler's page export (titles, meta descriptions, H1s) checked against
// the searches each page actually gets in Search Console. Pure functions: no DOM, no network.
// Every suggestion is built from a real search; nothing about the page's content is assumed.
(function () {
  'use strict';
  const CW = window.CW, K = window.CW_CONTENT;

  // Length limits are where Google commonly cuts text off on desktop; they are guides, not rules.
  const LIMITS = { titleMax: 60, titleMin: 30, titlePx: 580, metaMax: 160, metaMin: 70, metaPx: 920 };

  // ── crawler page export (Screaming Frog "Internal › HTML", Sitebulb, or any CSV with URL and title) ──
  function parsePages(text, siteHost) {
    const rows = K.parseCSV(text);
    if (rows.length < 2) return { ok: false, error: 'This file has no rows. Export Internal › HTML (or a similar pages report) from your crawler as CSV.' };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = res => head.findIndex(h => res.some(r => r.test(h)));
    const ui = col([/^address$/, /^url$/, /^page$/, /^page url$/, /^canonical url$/]);
    const ti = col([/^title 1$/, /^title$/, /^page title$/, /^title tag$/]);
    if (ui < 0 || ti < 0) return { ok: false, error: 'Could not find URL and title columns. The file needs columns named like “Address” and “Title 1” (Screaming Frog › Internal › HTML › Export).' };
    const tl = col([/^title 1 pixel width$/, /^title pixel width$/]);
    const mi = col([/^meta description 1$/, /^meta description$/, /^description$/]);
    const ml = col([/^meta description 1 pixel width$/, /^meta description pixel width$/]);
    const hi = col([/^h1-1$/, /^h1$/, /^h1 1$/]);
    const ii = col([/^indexability$/]), si = col([/^status code$/, /^status$/]), ci = col([/^content type$/, /^content$/]);
    const pages = new Map(); let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], url = String(r[ui] || '').trim();
      if (!/^https?:\/\//i.test(url) || (ci >= 0 && r[ci] && !/html/i.test(r[ci]))) { skipped++; continue; }
      const key = K.normUrl(url);
      if (siteHost && key.split('/')[0] !== siteHost) { skipped++; continue; }
      if (pages.has(key)) continue;
      const num = j => j >= 0 && r[j] !== '' && isFinite(+r[j]) ? +r[j] : null;
      pages.set(key, {
        url, title: String(r[ti] || '').trim(), titlePx: num(tl), meta: mi >= 0 ? String(r[mi] || '').trim() : null, metaPx: num(ml),
        h1: hi >= 0 ? String(r[hi] || '').trim() : null, indexable: ii >= 0 ? !/non/i.test(r[ii] || '') : null, status: si >= 0 ? (parseInt(r[si], 10) || null) : null
      });
    }
    if (!pages.size) return { ok: false, error: siteHost ? `No HTML pages on ${siteHost} were found in this file.` : 'No HTML pages were found in this file.' };
    return { ok: true, pages, count: pages.size, rows: rows.length - 1, skipped, hasMeta: mi >= 0, hasH1: hi >= 0 };
  }

  // Title case for suggestions; short joining words stay lowercase except at the start ("Valley of Flowers")
  const SMALL = new Set('a an the and or but of for to in on at by with from vs via per near'.split(' '));
  const titleCase = s => String(s).split(/(\s+)/).map((w, i) => /^\s+$/.test(w) || (i > 0 && SMALL.has(w.toLowerCase())) ? w : w.replace(/^\p{L}/u, c => c.toUpperCase())).join('');
  const normText = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // ── the audit ──
  function audit(A, D, crawl, opts) {
    D = D || A.data || {}; opts = opts || {};
    const brandWords = new Set([].concat(...(opts.brand || []).map(b => String(b).toLowerCase().split(/[^\p{L}\p{N}]+/u))).filter(Boolean));
    const hasQP = !!(D.QP && D.QP.length);
    const gsc = new Map(A.P.map(r => [K.normUrl(r.p), r]));
    // searches per page (non-branded), largest first
    const qByPage = new Map();
    if (hasQP) D.QP.forEach(r => { if (A.isBrand(r.q)) return; const k = K.normUrl(r.p); if (!qByPage.has(k)) qByPage.set(k, []); qByPage.get(k).push(r); });
    qByPage.forEach(a => a.sort((x, y) => y.impr - x.impr || (x.q < y.q ? -1 : 1)));
    const ctrIssue = new Map((A.ctrPages || []).map(r => [K.normUrl(r.p), r]));

    // duplicates across the crawl (indexable pages only, when the crawler says)
    const groupBy = field => { const m = new Map(); crawl.pages.forEach((p, k) => { const v = normText(p[field]); if (!v || p.indexable === false) return; if (!m.has(v)) m.set(v, []); m.get(v).push(k); }); return [...m.entries()].filter(e => e[1].length > 1).map(([v, keys]) => ({ text: crawl.pages.get(keys[0])[field], keys })).sort((a, b) => b.keys.length - a.keys.length); };
    const dupTitles = groupBy('title'), dupMetas = crawl.hasMeta ? groupBy('meta') : [];
    const dupT = new Map(), dupM = new Map();
    dupTitles.forEach(g => g.keys.forEach(k => dupT.set(k, g.keys.length)));
    dupMetas.forEach(g => g.keys.forEach(k => dupM.set(k, g.keys.length)));

    const rows = [];
    crawl.pages.forEach((p, key) => {
      const g = gsc.get(key) || null;
      if (p.indexable === false && !(g && g.impr > 0)) return;           // noindexed and not shown: nothing to fix here
      const issues = [];
      const push = (kind, sev, text) => issues.push({ kind, sev, text });
      if (p.status && p.status >= 300) push('status', 3, `Returns ${p.status}: Search Console shows it, but it is not a normal page`);
      if (p.indexable === false && g && g.impr > 0) push('noindex', 3, `Marked non-indexable by the crawler, yet it had ${CW.fmtN(g.impr)} impressions in Search Console`);
      if (!p.title) push('title-missing', 3, 'No title');
      else {
        const long = p.titlePx != null ? p.titlePx > LIMITS.titlePx : p.title.length > LIMITS.titleMax;
        if (long) push('title-long', 1, p.titlePx != null ? `Title is ${p.titlePx} px wide; Google usually cuts it off past about ${LIMITS.titlePx} px` : `Title is ${p.title.length} characters; Google usually cuts it off past about ${LIMITS.titleMax}`);
        else if (p.title.length < LIMITS.titleMin) push('title-short', 1, `Title is only ${p.title.length} characters: room to add what the searcher wants`);
        if (dupT.has(key)) push('title-dup', 2, `Same title as ${dupT.get(key) - 1} other page${dupT.get(key) > 2 ? 's' : ''}`);
      }
      if (crawl.hasMeta) {
        if (!p.meta) push('meta-missing', 1, 'No meta description: Google writes its own snippet');
        else {
          const long = p.metaPx != null ? p.metaPx > LIMITS.metaPx : p.meta.length > LIMITS.metaMax;
          if (long) push('meta-long', 0, `Meta description is ${p.metaPx != null ? p.metaPx + ' px' : p.meta.length + ' characters'}; it will be cut off`);
          else if (p.meta.length < LIMITS.metaMin) push('meta-short', 0, `Meta description is only ${p.meta.length} characters`);
          if (dupM.has(key)) push('meta-dup', 1, `Same meta description as ${dupM.get(key) - 1} other page${dupM.get(key) > 2 ? 's' : ''}`);
        }
      }
      if (crawl.hasH1 && !p.h1) push('h1-missing', 1, 'No H1 heading');
      // the searches this page actually gets, against its title
      const qs = (qByPage.get(key) || []).slice(0, 5);
      const tot = (qByPage.get(key) || []).reduce((s, r) => s + r.impr, 0);
      let top = null, missing = [];
      if (qs.length && p.title) {
        const tt = new Set(K.tokens(p.title, new Set()));
        top = qs[0];
        const want = K.tokens(top.q, brandWords);
        missing = want.filter(w => !tt.has(w));
        const share = tot ? top.impr / tot * 100 : 0;
        if (missing.length && want.length && missing.length / want.length >= 0.5 && share >= 20)
          push('title-query', 2, `Its main search “${top.q}” (${share.toFixed(0)}% of its impressions) is not in the title: missing ${missing.map(w => `“${w}”`).join(', ')}`);
      }
      if (!issues.length) return;
      const lowCtr = ctrIssue.get(key);
      if (lowCtr) push('ctr', 2, `CTR ${lowCtr.ctr.toFixed(1)}% at position ${lowCtr.pos.toFixed(1)}, about ${Math.round(lowCtr.ratio * 100)}% of what this site usually gets there`);
      // a starting point only: the main search in title case, keeping the page's existing brand suffix
      let suggestion = null;
      if (top && issues.some(i => ['title-query', 'title-missing', 'title-long', 'title-short', 'title-dup', 'ctr'].includes(i.kind))) {
        const m = p.title && p.title.match(/\s[|\-–—:·]\s*([^|\-–—:·]{2,30})$/);
        const base = titleCase(top.q), suffix = m ? m[1].trim() : '';
        // only the main search: tacking on other searches' words picked up places and competitor names,
        // so those stay in the "main searches" list for a person to judge
        let s = base;
        if (suffix && (s + ' | ' + suffix).length <= LIMITS.titleMax) s += ' | ' + suffix;
        suggestion = s.length <= LIMITS.titleMax ? s : base.slice(0, LIMITS.titleMax);
      }
      const sev = Math.max(...issues.map(i => i.sev));
      rows.push({ key, url: g ? g.p : p.url, path: CW.pathOf(p.url), title: p.title, meta: p.meta, h1: p.h1, titleLen: p.title.length, metaLen: p.meta ? p.meta.length : null,
        impr: g ? g.impr : 0, clicks: g ? g.clicks : 0, ctr: g ? g.ctr : null, pos: g ? g.pos : null, inGsc: !!g, queries: qs, issues, suggestion,
        // priority: how much the page is seen, scaled by how serious its worst issue is
        priority: (g ? g.impr : 0) * (1 + sev) });
    });
    rows.sort((a, b) => b.priority - a.priority || (a.path < b.path ? -1 : 1));
    const crawlKeys = new Set(crawl.pages.keys());
    const gscOnly = A.P.filter(r => !crawlKeys.has(K.normUrl(r.p)) && !A.isExcluded(r.p));
    const crawlNoImpr = [...crawl.pages.entries()].filter(([k, p]) => !gsc.has(k) && p.indexable !== false).map(([k, p]) => p.url);
    const kinds = {}; rows.forEach(r => r.issues.forEach(i => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; }));
    const all = [...crawl.pages.entries()].map(([key, p]) => ({ key, title: p.title }));
    return { rows, all, dupTitles, dupMetas, kinds, mode: hasQP ? 'search' : 'export', pages: crawl.count, name: crawl.name || null, gscOnly: gscOnly.length, crawlNoImpr: crawlNoImpr.length, crawlNoImprSample: crawlNoImpr.slice(0, 20), LIMITS };
  }

  window.CW_TITLES = { parsePages, audit, LIMITS };
})();

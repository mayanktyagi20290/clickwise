// Clickwise Generative AI report: reads the export of Search Console's Generative AI performance report
// (Performance › Generative AI) and joins it with the loaded Performance data. Pure functions: no DOM,
// no network, no storage.
//
// What the report is (Oct 2026): impressions of a site's URLs inside AI Overviews and AI Mode in Search and
// generative features in Discover, by page, country, device and date. No clicks, no queries, and no API
// (searchanalytics.query has no type for it), so it comes in as an export. These impressions are already
// counted in the Web performance totals, so for the same period and scope AI impressions ≤ web impressions.
(function () {
  'use strict';
  const CW = window.CW;
  const ROW_CAP = 1000; // Search Console exports list at most 1,000 rows per table

  const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/[,\s%]/g, '')); return isFinite(n) ? n : 0; };
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const excelDate = n => new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  const toDate = v => typeof v === 'number' && v > 20000 && v < 80000 ? excelDate(v) : (() => { const s = String(v || '').trim().slice(0, 10); return isDate(s) ? s : null; })();
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
  // same page whatever the protocol, www, case of the host or trailing slash
  function normUrl(u) {
    const s = String(u || '').trim();
    try { const x = new URL(s); return (x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); }
    catch (e) { return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase(); }
  }

  // which table a sheet holds, from its sheet (or file) name and first header cell
  function kindOf(name, header) {
    const n = String(name || '').toLowerCase(), h = String(header || '').toLowerCase();
    const has = w => n.includes(w) || h.includes(w);
    if (n.includes('filter') || h === 'filter') return 'Filters';
    if (has('quer')) return 'Q';
    return has('page') || has('url') ? 'P' : has('countr') ? 'Countries' : has('device') ? 'Dev' : has('date') || n.includes('chart') ? 'C' : null;
  }

  // sheets: [{ name, rows }] where rows are arrays of cells, header first (SheetJS header:1 output)
  function parse(sheets) {
    const out = { C: [], P: [], Countries: [], Dev: [], filters: [], hasClicks: false, sheets: [], truncated: {} };
    let performanceLike = false, unknown = 0;
    (sheets || []).forEach(({ name, rows }) => {
      rows = (rows || []).filter(r => Array.isArray(r) && r.some(c => c !== '' && c != null));
      if (rows.length < 2) return;
      const kind = kindOf(name, rows[0][0]);
      if (!kind) { unknown++; return; }
      if (kind === 'Filters') { out.filters = rows.slice(1).map(r => [String(r[0] || '').trim(), String(r[1] || '').trim()]).filter(r => r[0]); return; }
      if (kind === 'Q') { performanceLike = true; return; }
      const h = rows[0].map(x => String(x == null ? '' : x));
      const col = re => h.findIndex((x, i) => i > 0 && re.test(x));
      let ci = col(/impression/i);
      const cc = col(/click(?!.?through)/i), cp = col(/position/i);
      if (cc > 0 && cp > 0) performanceLike = true;   // the Performance report export has clicks and position
      if (ci < 0 && h.length === 2) ci = 1;           // an unnamed second column is the impressions
      if (ci < 0) { unknown++; return; }
      if (cc > 0) out.hasClicks = true;
      out.sheets.push(kind);
      const list = out[kind];
      rows.slice(1).forEach(r => {
        const impr = num(r[ci]), clicks = cc > 0 ? num(r[cc]) : null;
        if (kind === 'C') { const d = toDate(r[0]); if (d) list.push({ d, impr, clicks }); return; }
        const key = String(r[0] == null ? '' : r[0]).trim(); if (!key) return;
        list.push(kind === 'P' ? { p: key, impr, clicks } : { d: key, impr, clicks });
      });
      if (rows.length - 1 >= ROW_CAP) out.truncated[kind] = true;
    });
    if (performanceLike) return { ok: false, error: 'This looks like the Performance report export (it has clicks and positions). Export the Generative AI report instead: Search Console › Performance › Generative AI › Export.' };
    if (!out.C.length && !out.P.length) return { ok: false, error: unknown ? 'No Dates or Pages table with impressions was found in this file. Export the Generative AI report from Search Console (Performance › Generative AI › Export) as Excel or CSV.' : 'This file has no rows.' };
    out.C.sort((a, b) => a.d.localeCompare(b.d));
    // a day listed twice (two files selected together) is counted once
    const seen = new Map(); out.C.forEach(r => seen.set(r.d, r)); out.C = [...seen.values()];
    out.P.sort((a, b) => b.impr - a.impr);
    out.start = out.C.length ? out.C[0].d : null; out.end = out.C.length ? out.C[out.C.length - 1].d : null;
    out.days = out.start ? days(out.start, out.end) : null;
    out.scope = scopeOf(out.filters);
    out.ok = true;
    return out;
  }
  // a page filter in the export's Filters sheet, e.g. ["Page", "*/employers/"] or ["Page", "+/blog/"]
  function scopeOf(filters) {
    const f = (filters || []).find(([k, v]) => /page|url/i.test(k) && v && !/^-/.test(v.trim()));
    if (!f) return null;
    const v = f[1].trim().replace(/^[+*]+/, '').replace(/\*+$/, '').replace(/^(contains|url contains)\s*:?\s*/i, '').replace(/^["“]|["”]$/g, '');
    return v || null;
  }

  // ── joined with the loaded Performance analysis ──
  // The AI share of a page's impressions is shown only when both cover the same dates: otherwise the
  // ratio compares different periods and means nothing.
  function analyse(G, A, D) {
    D = D || {};
    const tot = G.C.length ? G.C.reduce((s, r) => s + r.impr, 0) : G.P.reduce((s, r) => s + r.impr, 0);
    const perDay = G.days ? tot / G.days : null;
    // period match with the loaded data
    let period = 'unknown';
    if (G.start && D.start && D.end) {
      const ds = Math.abs(days(G.start, D.start) - 1), de = Math.abs(days(G.end, D.end) - 1);
      period = ds <= 2 && de <= 2 ? 'match' : G.end < D.start || G.start > D.end ? 'none' : 'partial';
    }
    const comparable = period === 'match';
    const web = new Map((A.P || []).map(r => [normUrl(r.p), r]));
    const pages = G.P.map(r => {
      const w = web.get(normUrl(r.p)) || null;
      const share = comparable && w && w.impr > 0 ? r.impr / w.impr * 100 : null;
      return { p: r.p, path: CW.pathOf(r.p), ai: r.impr, web: w ? w.impr : null, clicks: w ? w.clicks : null, ctr: w ? w.ctr : null, pos: w ? w.pos : null, share, over: share != null && share > 105 };
    });
    // daily AI share of all web impressions, where both have the day
    const webDay = new Map((D.C || []).map(r => [r.d, r.impr]));
    const daily = G.C.map(r => ({ d: r.d, ai: r.impr, web: webDay.has(r.d) ? webDay.get(r.d) : null }));
    const webTot = comparable && D.C && D.C.length ? D.C.reduce((s, r) => s + r.impr, 0) : null;
    // page-one pages with real demand that never appear in AI features: only claimed when the export is
    // complete (not cut at its row limit) and covers the same period; scoped to the export's page filter
    const scope = G.scope ? G.scope.toLowerCase() : null;
    const inScope = r => !scope || String(r.p).toLowerCase().includes(scope);
    const inAi = new Set(G.P.map(r => normUrl(r.p)));
    let notCited = null, notCitedWhy = null;
    if (!comparable) notCitedWhy = 'Needs the Generative AI export and the Performance data for the same dates.';
    else if (G.truncated.P) notCitedWhy = 'The export lists only its top 1,000 pages, so a page missing from it may still appear in AI features.';
    else if (!G.P.length) notCitedWhy = 'The export has no Pages table.';
    else {
      const cand = (A.P || []).filter(r => inScope(r) && r.pos > 0 && r.pos <= 10 && !(A.isExcluded && A.isExcluded(r.p)));
      const floor = Math.max(100, pctl(cand.map(r => r.impr), 0.5));
      notCited = cand.filter(r => r.impr >= floor && !inAi.has(normUrl(r.p))).sort((a, b) => b.impr - a.impr).slice(0, 50)
        .map(r => ({ p: r.p, path: CW.pathOf(r.p), web: r.impr, clicks: r.clicks, pos: r.pos }));
    }
    const notes = [];
    notes.push('Impressions only: the Generative AI report has no clicks or searches yet.');
    notes.push('These impressions are already part of the Web performance totals, not extra visibility.');
    if (period === 'partial') notes.push(`The export covers ${G.start} – ${G.end}, the Performance data ${D.start} – ${D.end}: shares are hidden until the dates match.`);
    if (period === 'none') notes.push(`The export covers ${G.start} – ${G.end}, which does not overlap the loaded Performance data (${D.start} – ${D.end}).`);
    if (G.scope && D.scope && !String(D.scope).toLowerCase().includes(G.scope.toLowerCase()) && !G.scope.toLowerCase().includes(String(D.scope).toLowerCase())) notes.push(`The export is filtered to “${G.scope}” and the Performance data to “${D.scope}”.`);
    if (G.truncated.P) notes.push('The Pages table stops at 1,000 rows.');
    if (pages.some(r => r.over)) notes.push('Some pages show more AI impressions than web impressions: the scopes or URL forms of the two files differ for those pages.');
    return {
      total: tot, perDay, days: G.days, start: G.start, end: G.end, period, comparable,
      shareAll: webTot ? tot / webTot * 100 : null,
      pages, daily, countries: G.Countries.slice().sort((a, b) => b.impr - a.impr), devices: G.Dev.slice().sort((a, b) => b.impr - a.impr),
      matched: pages.filter(r => r.web != null).length, notCited, notCitedWhy, scope: G.scope, notes, truncated: G.truncated
    };
  }
  function pctl(a, q) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

  // Deep link to the report for this property and folder, in Search Console's own URL format.
  function reportUrl(D) {
    const res = D.siteUrl || ('sc-domain:' + String(D.site || '').replace(/^sc-domain:/, ''));
    const u = new URL('https://search.google.com/search-console/performance/search-analytics/ai');
    u.searchParams.set('resource_id', res);
    u.searchParams.set('num_of_months', '3');
    if (D.scope) u.searchParams.set('page', '*' + D.scope);
    return u.toString();
  }

  // Sample export for the fictional demo site, made deterministically from its pages. Labelled as sample.
  function sample(D) {
    const h = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; };
    const P = (D.P || []).slice().sort((a, b) => b.impr - a.impr);
    const pages = P.filter((r, i) => i < 4 || h(r.p) > 0.35).map(r => [r.p, Math.round(r.impr * (0.08 + 0.3 * h(r.p + 'x')))]).filter(r => r[1] > 0);
    const share = pages.reduce((s, r) => s + r[1], 0) / Math.max(1, P.reduce((s, r) => s + r.impr, 0));
    const C = (D.C || []).map((r, i) => [r.d, Math.round(r.impr * share * (0.75 + 0.5 * i / Math.max(1, D.C.length - 1)))]);
    const totC = C.reduce((s, r) => s + r[1], 0) || 1, totP = pages.reduce((s, r) => s + r[1], 0) || 1;
    const fit = totC / totP; pages.forEach(r => { r[1] = Math.max(1, Math.round(r[1] * fit)); }); // pages add up to the daily total
    const dev = [['Mobile', 0.71], ['Desktop', 0.27], ['Tablet', 0.02]].map(([d, s]) => [d, Math.round(totC * s)]);
    const ctry = [['India', 0.86], ['United States', 0.05], ['United Kingdom', 0.03], ['Nepal', 0.02], ['United Arab Emirates', 0.02]].map(([d, s]) => [d, Math.round(totC * s)]);
    return [
      { name: 'Dates', rows: [['Date', 'Impressions']].concat(C) },
      { name: 'Pages', rows: [['Top pages', 'Impressions']].concat(pages) },
      { name: 'Countries', rows: [['Country', 'Impressions']].concat(ctry) },
      { name: 'Devices', rows: [['Device', 'Impressions']].concat(dev) }
    ];
  }

  window.CW_GENAI = { parse, analyse, reportUrl, sample, normUrl, scopeOf, kindOf, ROW_CAP };
})();

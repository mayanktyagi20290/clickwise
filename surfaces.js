// Clickwise: Discover, Google News, last 24 hours and indexing. Pure functions only (no DOM, no network),
// so they run in the browser and in the tests alike. Screens live in surfaces-view.js; app.js fetches.
(function () {
  'use strict';
  const sum = (rows, k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  const pathOf = u => { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return String(u || ''); } };
  const tot = rows => { const clicks = sum(rows, 'clicks'), impr = sum(rows, 'impr'); return { clicks, impr, ctr: impr ? clicks / impr * 100 : 0 }; };
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const DAY = 864e5, HOUR = 36e5;

  // Search Console's dates and hours are Pacific time; "today" there is what the API calls today.
  function ptDate(offsetDays = 0, now = new Date()) {
    const d = new Date(now.getTime() + offsetDays * DAY);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }

  // ── Discover and Google News ──
  // in: daily, pages, countries, appearance (+ prev daily/pages) as {d|p, clicks, impr, ctr}; search: the
  // Search performance pages already loaded (to show which pages live on Discover rather than Search).
  function surface(src, search, kind) {
    const daily = (src.daily || []).slice().sort((a, b) => a.d.localeCompare(b.d));
    const t = tot(daily.length ? daily : src.pages || []);
    const prevT = src.prevDaily && src.prevDaily.length ? tot(src.prevDaily) : null;
    const prevMap = new Map((src.prevPages || []).map(r => [r.p, r]));
    const searchMap = new Map((search || []).map(r => [r.p, r]));
    const pages = (src.pages || []).map(r => {
      const pr = prevMap.get(r.p), s = searchMap.get(r.p);
      return { p: r.p, path: pathOf(r.p), clicks: r.clicks, impr: r.impr, ctr: r.impr ? r.clicks / r.impr * 100 : 0,
        prevClicks: pr ? pr.clicks : (src.prevPages ? 0 : null), searchClicks: s ? s.clicks : 0,
        change: pr && pr.clicks ? (r.clicks - pr.clicks) / pr.clicks * 100 : null };
    }).sort((a, b) => b.clicks - a.clicks || b.impr - a.impr);
    // weak cards: enough impressions to judge, CTR under half the site's typical card CTR on this surface
    const floor = Math.max(100, median(pages.map(p => p.impr)));
    const typical = median(pages.filter(p => p.impr >= floor).map(p => p.ctr));
    const weak = typical ? pages.filter(p => p.impr >= floor && p.ctr < typical * 0.5).sort((a, b) => b.impr - a.impr) : [];
    const fresh = src.prevPages ? pages.filter(p => p.prevClicks === 0 && p.clicks >= 5) : [];
    const dropped = src.prevPages ? (src.prevPages || []).filter(r => r.clicks >= 10 && !pages.some(p => p.p === r.p && p.clicks > 0)).map(r => ({ p: r.p, path: pathOf(r.p), prevClicks: r.clicks, clicks: 0, impr: 0, ctr: 0 })).sort((a, b) => b.prevClicks - a.prevClicks) : [];
    const onlyHere = pages.filter(p => p.clicks >= 10 && p.clicks > p.searchClicks * 2);
    const topShare = t.clicks && pages.length ? pages[0].clicks / t.clicks * 100 : 0;
    const top5Share = t.clicks ? sum(pages.slice(0, 5), 'clicks') / t.clicks * 100 : 0;
    const zeroDays = daily.filter(r => !r.clicks).length;
    const peak = daily.reduce((m, r) => !m || r.clicks > m.clicks ? r : m, null);
    const avg = daily.length ? t.clicks / daily.length : 0;
    const spikes = daily.filter(r => avg && r.clicks >= avg * 3).length;
    const name = kind === 'news' ? 'Google News' : 'Discover';

    const insights = [];
    if (!t.impr) return { kind, empty: true, tot: t, prevTot: prevT, daily, pages, weak, fresh, dropped, onlyHere, countries: [], appearance: [], insights };
    if (prevT && prevT.clicks) {
      const ch = (t.clicks - prevT.clicks) / prevT.clicks * 100;
      if (Math.abs(ch) >= 15) insights.push({ tone: ch > 0 ? 'good' : 'bad', text: `${name} clicks ${ch > 0 ? 'rose' : 'fell'} ${Math.abs(ch).toFixed(0)}% vs the previous period (${fmt(prevT.clicks)} → ${fmt(t.clicks)}).` });
    }
    if (top5Share >= 60 && pages.length > 5) insights.push({ tone: 'warn', text: `Five pages earned ${top5Share.toFixed(0)}% of ${name} clicks. Traffic here is concentrated and can vanish when those cards stop showing; keep publishing.` });
    else if (topShare >= 40) insights.push({ tone: 'warn', text: `One page earned ${topShare.toFixed(0)}% of ${name} clicks: ${pathOf(pages[0].p)}.` });
    if (spikes) insights.push({ tone: 'info', text: `${spikes} day${spikes === 1 ? ' was' : 's were'} 3× the daily average or more${peak ? ` (peak ${peak.d}: ${fmt(peak.clicks)} clicks)` : ''}. ${name} traffic comes in bursts; look at what those days published.` });
    if (zeroDays && daily.length && zeroDays / daily.length >= 0.25) insights.push({ tone: 'warn', text: `${zeroDays} of ${daily.length} days had no ${name} clicks at all.` });
    if (weak.length) insights.push({ tone: 'bad', text: `${weak.length} page${weak.length === 1 ? '' : 's'} got ${name} impressions but under half the usual card CTR (${typical.toFixed(1)}%). Improve the image and the headline.` });
    if (dropped.length) insights.push({ tone: 'bad', text: `${dropped.length} page${dropped.length === 1 ? '' : 's'} with ${name} clicks last period got none this period.` });
    if (fresh.length) insights.push({ tone: 'good', text: `${fresh.length} page${fresh.length === 1 ? '' : 's'} reached ${name} this period that had no clicks there before.` });
    if (onlyHere.length) insights.push({ tone: 'info', text: `${onlyHere.length} page${onlyHere.length === 1 ? ' gets' : 's get'} more than twice as many clicks from ${name} as from Search. Strong stories; check they also target a search query.` });
    return { kind, empty: false, tot: t, prevTot: prevT, daily, pages, weak, fresh, dropped, onlyHere, typical, countries: src.countries || [], appearance: src.appearance || [], insights };
  }
  function fmt(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString('en-US'); }

  // What Google documents for Discover and News eligibility, as a short checklist.
  const CHECKS = {
    discover: [
      ['Large images', 'Use images at least 1200 px wide and allow them with max-image-preview:large (or AMP). Small thumbnails get far fewer clicks.'],
      ['Honest, specific headlines', 'Capture the story without clickbait or withholding the key detail; Discover demotes misleading titles.'],
      ['Timely or evergreen-with-a-twist', 'Discover favours fresh stories and content tied to current interests. Refresh evergreen pieces with a new angle.'],
      ['Clear authorship and dates', 'Bylines, author pages and a visible published/updated date support trust signals.'],
      ['Follow feed', 'Keep an RSS/Atom feed linked in the page head so readers can follow the site in Chrome and Discover.'],
      ['Stay within content policies', 'Discover applies Google News content policies; sensational or dangerous content is not shown.']
    ],
    news: [
      ['Publication in Publisher Center', 'Not required, but it controls your name, logo and sections in Google News.'],
      ['Dated, bylined articles', 'Show a clear publish and update date and the author on every story; use Article/NewsArticle markup with datePublished.'],
      ['Distinct article URLs', 'Each story needs its own permanent URL; avoid reusing URLs for new stories.'],
      ['News sitemap', 'List articles from the last two days in a news sitemap so Google finds them fast.'],
      ['Transparency', 'Publish about, contact and editorial-policy pages, and staff information.'],
      ['Original reporting', 'Google News highlights original reporting; add value over rewrites of wire copy.']
    ]
  };

  // ── last 24 hours ──
  // rows: { h: 'YYYY-MM-DDThh:mm:ss-07:00', clicks, impr, ctr (%), pos }. The window ends at the latest hour
  // with data (hourly numbers arrive a few hours late), and is compared with the 24 hours before it and the
  // same 24 hours a week earlier.
  function hourly(rows, firstIncomplete) {
    const byTs = new Map();
    rows.forEach(r => { const ts = Date.parse(r.h); if (isFinite(ts)) byTs.set(ts, r); });
    const withData = [...byTs.keys()].filter(ts => byTs.get(ts).impr > 0);
    if (!withData.length) return { empty: true };
    const end = Math.max(...withData);
    const span = (from) => { const out = []; for (let i = 0; i < 24; i++) { const ts = from + i * HOUR, r = byTs.get(ts); out.push({ ts, clicks: r ? r.clicks : 0, impr: r ? r.impr : 0, pos: r ? r.pos : 0, have: !!r }); } return out; };
    const last = span(end - 23 * HOUR), prev = span(end - 47 * HOUR), week = span(end - (23 + 168) * HOUR);
    const stats = s => { const t = tot(s); const w = s.reduce((a, r) => a + r.pos * r.impr, 0); return { ...t, pos: t.impr ? w / t.impr : 0, hours: s.filter(r => r.have).length }; };
    const L = stats(last), P = stats(prev), W = stats(week);
    const incomplete = firstIncomplete ? Date.parse(firstIncomplete) : null;
    const best = last.reduce((m, r) => !m || r.clicks > m.clicks ? r : m, null);
    return { empty: false, start: end - 23 * HOUR, end, last, prev, week, tot: L, prevTot: P.hours >= 20 ? P : null, weekTot: W.hours >= 20 ? W : null, incomplete: isFinite(incomplete) ? incomplete : null, best };
  }
  // hour × query (or page) rows → totals for hours inside the window
  function hourTop(rows, key, from, to) {
    const m = new Map();
    rows.forEach(r => { const ts = Date.parse(r.h); if (!(ts >= from && ts <= to)) return; const o = m.get(r[key]) || { [key]: r[key], clicks: 0, impr: 0, w: 0 }; o.clicks += r.clicks; o.impr += r.impr; o.w += r.pos * r.impr; m.set(r[key], o); });
    return [...m.values()].map(o => ({ [key]: o[key], path: key === 'p' ? pathOf(o.p) : undefined, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.w / o.impr : 0 })).sort((a, b) => b.clicks - a.clicks || b.impr - a.impr);
  }
  // Searches new in the last day: in the window but absent from the comparison rows.
  function newIn(cur, before, key) { const seen = new Set(before.map(r => r[key])); return cur.filter(r => !seen.has(r[key]) && r.impr >= 3); }

  // ── URL inspection ──
  const ISSUE = {
    ok: { label: 'Indexed', tone: 'good', fix: 'Nothing to do.' },
    stale: { label: 'Indexed, not crawled recently', tone: 'watch', fix: 'Google has not refetched this page in a long time. Link to it from fresh pages, keep it in the sitemap with an accurate lastmod, and update it if the content is old.' },
    canonical: { label: 'Google chose another canonical', tone: 'watch', fix: 'Google treats this as a duplicate of the URL it picked. If this page should rank, make it distinct, point internal links and the sitemap at it, and make its canonical self-referencing.' },
    crawled: { label: 'Crawled – currently not indexed', tone: 'risk', fix: 'Google fetched it and chose not to index it, usually thin, duplicate or low-value content. Improve or merge the page, then request indexing.' },
    discovered: { label: 'Discovered – currently not indexed', tone: 'watch', fix: 'Google knows the URL but has not crawled it yet. Add internal links from strong pages and check server speed; on big sites trim low-value URLs so crawl budget goes to the ones that matter.' },
    unknown: { label: 'Unknown to Google', tone: 'risk', fix: 'Google has never seen this URL. Link to it internally and list it in the sitemap.' },
    noindex: { label: 'Blocked by noindex', tone: 'risk', fix: 'A noindex robots meta tag or X-Robots-Tag header keeps it out. Remove it if the page should rank.' },
    robots: { label: 'Blocked by robots.txt', tone: 'risk', fix: 'robots.txt stops Googlebot fetching it. Remove the Disallow rule if the page should rank (and do not use robots.txt to deindex pages).' },
    notfound: { label: 'Not found (404)', tone: 'risk', fix: 'The URL returns 404 to Googlebot. Restore it or 301-redirect it to the closest live page, and update internal links.' },
    soft404: { label: 'Soft 404', tone: 'risk', fix: 'The page loads but looks empty or like an error page. Add real content, or return a proper 404/410.' },
    server: { label: 'Server error (5xx)', tone: 'risk', fix: 'Googlebot got a server error. Check server logs, timeouts and firewall/bot rules for Googlebot.' },
    access: { label: 'Access blocked (401/403/4xx)', tone: 'risk', fix: 'Googlebot was refused. Remove login or IP/bot blocking for public pages.' },
    redirect: { label: 'Redirect', tone: 'info', fix: 'The URL redirects. Point internal links and the sitemap straight at the final URL.' },
    redirectError: { label: 'Redirect error', tone: 'risk', fix: 'The redirect chain loops, is too long or ends in an error. Make it one hop to a 200 page.' },
    alternate: { label: 'Alternate with proper canonical', tone: 'info', fix: 'A duplicate correctly pointing to its canonical. Fine, as long as that was intended.' },
    other: { label: 'Not indexed', tone: 'watch', fix: 'Open the inspection in Search Console for the full reason.' }
  };
  const norm = s => String(s || '').toLowerCase().replace(/[‘’'`]/g, '').replace(/[–—]/g, '-');
  function issueOfCoverage(cov) {
    const c = norm(cov);
    if (!c) return null;
    if (/crawled - currently not indexed/.test(c)) return 'crawled';
    if (/discovered - currently not indexed/.test(c)) return 'discovered';
    if (/unknown to google/.test(c)) return 'unknown';
    if (/noindex/.test(c)) return 'noindex';
    if (/indexed, though blocked/.test(c)) return 'robots';
    if (/blocked by robots/.test(c)) return 'robots';
    if (/soft 404/.test(c)) return 'soft404';
    if (/not found|404/.test(c)) return 'notfound';
    if (/server error|5xx/.test(c)) return 'server';
    if (/redirect error/.test(c)) return 'redirectError';
    if (/page with redirect/.test(c)) return 'redirect';
    if (/401|403|4xx|unauthori[sz]ed|forbidden/.test(c)) return 'access';
    if (/alternate page with proper canonical/.test(c)) return 'alternate';
    if (/duplicate/.test(c)) return 'canonical';
    if (/indexed without content/.test(c)) return 'soft404';
    if (/indexed/.test(c) && !/not indexed/.test(c)) return 'ok';
    return null;
  }
  const FETCH = { NOT_FOUND: 'notfound', SOFT_404: 'soft404', SERVER_ERROR: 'server', ACCESS_DENIED: 'access', ACCESS_FORBIDDEN: 'access', BLOCKED_4XX: 'access', REDIRECT_ERROR: 'redirectError', BLOCKED_ROBOTS_TXT: 'robots' };
  // r: the API's inspectionResult (or null on failure); now: Date
  function inspection(url, r, now = new Date(), staleDays = 90) {
    if (!r) return null;
    const s = r.indexStatusResult || {};
    const crawl = s.lastCrawlTime ? Date.parse(s.lastCrawlTime) : null;
    const age = crawl && isFinite(crawl) ? Math.floor((now - crawl) / DAY) : null;
    const gc = s.googleCanonical || '', uc = s.userCanonical || '';
    const canonDiff = !!(gc && uc && gc.replace(/\/$/, '') !== uc.replace(/\/$/, ''));
    let key;
    if (s.indexingState === 'BLOCKED_BY_META_TAG' || s.indexingState === 'BLOCKED_BY_HTTP_HEADER') key = 'noindex';
    else if (s.robotsTxtState === 'DISALLOWED' && s.verdict !== 'PASS') key = 'robots';
    else if (FETCH[s.pageFetchState] && s.verdict !== 'PASS') key = FETCH[s.pageFetchState];
    else key = issueOfCoverage(s.coverageState) || (s.verdict === 'PASS' ? 'ok' : 'other');
    if (key === 'ok' && canonDiff) key = 'canonical';
    if (key === 'ok' && age != null && age > staleDays) key = 'stale';
    const items = ((r.richResultsResult || {}).detectedItems || []);
    const richIssues = items.flatMap(d => (d.items || []).flatMap(it => (it.issues || []).map(i => ({ type: d.richResultType, msg: i.issueMessage, sev: i.severity }))));
    const rich = items.map(d => d.richResultType).filter(Boolean);
    return {
      url, path: pathOf(url), key, ...ISSUE[key], verdict: s.verdict || 'VERDICT_UNSPECIFIED', coverage: s.coverageState || '', indexed: s.verdict === 'PASS',
      lastCrawl: s.lastCrawlTime || null, age, crawledAs: s.crawledAs || '', robots: s.robotsTxtState || '', fetch: s.pageFetchState || '', indexing: s.indexingState || '',
      googleCanonical: gc, userCanonical: uc, canonDiff, sitemaps: s.sitemap || [], referrers: s.referringUrls || [],
      rich, richErrors: richIssues.filter(i => i.sev === 'ERROR'), richWarnings: richIssues.filter(i => i.sev !== 'ERROR'), link: r.inspectionResultLink || null
    };
  }
  function inspectionSummary(list) {
    const ok = list.filter(Boolean);
    const groups = new Map();
    ok.forEach(r => { const g = groups.get(r.key) || { key: r.key, label: r.label, tone: r.tone, fix: r.fix, rows: [] }; g.rows.push(r); groups.set(r.key, g); });
    const order = { risk: 0, watch: 1, info: 2, good: 3 };
    return {
      n: ok.length, indexed: ok.filter(r => r.indexed).length,
      groups: [...groups.values()].sort((a, b) => order[a.tone] - order[b.tone] || b.rows.length - a.rows.length),
      richErrors: ok.filter(r => r.richErrors.length), notInSitemap: ok.filter(r => r.indexed === false && !r.sitemaps.length && r.key !== 'redirect' && r.key !== 'alternate'),
      mobileFirst: ok.filter(r => r.crawledAs).length ? ok.filter(r => r.crawledAs === 'DESKTOP').length : null
    };
  }

  // ── sitemaps ──
  // list: the API's sitemap entries
  function sitemaps(list, now = new Date()) {
    return (list || []).map(s => {
      const read = s.lastDownloaded ? Date.parse(s.lastDownloaded) : null;
      const age = read && isFinite(read) ? Math.floor((now - read) / DAY) : null;
      const submitted = (s.contents || []).reduce((a, c) => a + (+c.submitted || 0), 0);
      const types = (s.contents || []).map(c => c.type).filter(Boolean);
      const errors = +s.errors || 0, warnings = +s.warnings || 0;
      const flags = [];
      if (errors) flags.push({ tone: 'risk', text: `${errors} error${errors === 1 ? '' : 's'}` });
      if (s.isPending) flags.push({ tone: 'watch', text: 'Not processed yet' });
      if (age != null && age > 14) flags.push({ tone: 'watch', text: `Last read ${age} days ago` });
      if (!s.isSitemapsIndex && !submitted && !s.isPending) flags.push({ tone: 'watch', text: 'No URLs found' });
      if (warnings) flags.push({ tone: 'watch', text: `${warnings} warning${warnings === 1 ? '' : 's'}` });
      return { path: s.path, index: !!s.isSitemapsIndex, submitted, types, errors, warnings, lastRead: s.lastDownloaded || null, lastSubmitted: s.lastSubmitted || null, age, pending: !!s.isPending, flags, ok: !flags.some(f => f.tone === 'risk') };
    }).sort((a, b) => b.errors - a.errors || (b.flags.length - a.flags.length) || a.path.localeCompare(b.path));
  }

  // ── Page indexing export (Search Console › Indexing › Pages › Export) ──
  // sheets: [{ name, rows: [[...]] }] from the Excel file or the unzipped CSVs.
  const REASON_FIX = [
    [/server error|5xx/, 'risk', 'Fix server errors and timeouts for Googlebot; check logs and bot protection.'],
    [/redirect error/, 'risk', 'Fix loops and long chains so each redirect is one hop to a live page.'],
    [/soft 404/, 'risk', 'Add real content or return a true 404/410.'],
    [/not found|404/, 'watch', 'Fine for deleted pages. Redirect any that still have links or traffic, and remove them from sitemaps.'],
    [/unauthori[sz]ed|401|forbidden|403|other 4xx/, 'risk', 'Public pages should not need a login or block Googlebot.'],
    [/indexed, though blocked/, 'watch', 'Indexed without being crawled. Use noindex (and allow crawling) if it should not be in Google.'],
    [/blocked by robots/, 'watch', 'Check none of these should rank; robots.txt blocks crawling, not indexing.'],
    [/noindex/, 'watch', 'Check none of these should rank, especially pages in your sitemap.'],
    [/crawled - currently not indexed/, 'risk', 'Usually thin or duplicate pages. Improve, merge or remove them.'],
    [/discovered - currently not indexed/, 'watch', 'Google has not crawled these yet. Strengthen internal links and server speed; trim low-value URLs.'],
    [/alternate page with proper canonical/, 'info', 'Expected for duplicates pointing at their canonical.'],
    [/duplicate without user-selected canonical/, 'watch', 'Add a canonical tag so you choose the version that ranks.'],
    [/duplicate, google chose different canonical/, 'watch', 'Google disagrees with your canonical. Make pages distinct or point signals at one URL.'],
    [/page with redirect/, 'info', 'Normal for redirected URLs; update internal links and sitemaps to the final URL.'],
    [/indexed without content/, 'risk', 'Google saw an empty page; check rendering and cloaking.']
  ];
  const reasonFix = r => { const n = norm(r); const m = REASON_FIX.find(([re]) => re.test(n)); return m ? { tone: m[1], fix: m[2] } : { tone: 'watch', fix: 'Open the reason in Search Console to see examples.' }; };
  const num = v => typeof v === 'number' ? v : parseFloat(String(v || '').replace(/,/g, '')) || 0;
  function excelDate(v) { if (typeof v === 'number') return new Date(Math.round((v - 25569) * DAY)).toISOString().slice(0, 10); const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : (isFinite(Date.parse(s)) ? new Date(Date.parse(s) + 12 * HOUR).toISOString().slice(0, 10) : null); }
  function indexExport(sheets) {
    const out = { issues: [], chart: [], urls: [], issue: null, property: null };
    sheets.forEach(({ name, rows }) => {
      if (!rows || rows.length < 1) return;
      const h = rows[0].map(x => norm(x).trim());
      const col = re => h.findIndex(x => re.test(x));
      const n = norm(name);
      if (col(/^reason$/) >= 0 && col(/^pages$/) >= 0) {
        const R = col(/^reason$/), Pg = col(/^pages$/), S = col(/^source$/), Va = col(/^validation$/);
        const critical = !/non.?critical/.test(n);
        rows.slice(1).forEach(r => { if (!r[R]) return; out.issues.push({ reason: String(r[R]), source: S >= 0 ? String(r[S] || '') : '', validation: Va >= 0 ? String(r[Va] || '') : '', pages: num(r[Pg]), critical, ...reasonFix(r[R]) }); });
      } else if (col(/^date$/) >= 0 && (col(/^indexed$/) >= 0 || col(/not indexed/) >= 0 || col(/affected/) >= 0)) {
        const Dt = col(/^date$/), I = col(/^indexed$/), N = col(/not indexed/), Af = col(/affected/), Im = col(/impressions/);
        rows.slice(1).forEach(r => { const d = excelDate(r[Dt]); if (d) out.chart.push({ d, indexed: I >= 0 ? num(r[I]) : null, notIndexed: N >= 0 ? num(r[N]) : null, affected: Af >= 0 ? num(r[Af]) : null, impr: Im >= 0 ? num(r[Im]) : null }); });
      } else if (col(/^url$/) >= 0) {
        const U = col(/^url$/), Lc = col(/last crawl/);
        rows.slice(1).forEach(r => { if (r[U]) out.urls.push({ url: String(r[U]).trim(), path: pathOf(String(r[U]).trim()), lastCrawled: Lc >= 0 ? excelDate(r[Lc]) : null }); });
      } else if (/metadata/.test(n) || (h[0] === 'property' && rows.length)) {
        rows.forEach(r => { const k = norm(r[0]); if (k === 'issue' || k === 'reason') out.issue = String(r[1] || ''); if (k === 'property') out.property = String(r[1] || ''); });
      }
    });
    out.chart.sort((a, b) => a.d.localeCompare(b.d));
    out.issues.sort((a, b) => ({ risk: 0, watch: 1, info: 2 }[a.tone] - { risk: 0, watch: 1, info: 2 }[b.tone]) || b.pages - a.pages);
    if (out.issue) { const f = reasonFix(out.issue); out.issueTone = f.tone; out.issueFix = f.fix; }
    const last = out.chart[out.chart.length - 1], first = out.chart[0];
    out.latest = last || null; out.earliest = first || null;
    out.ok = !!(out.issues.length || out.chart.length || out.urls.length);
    return out;
  }
  // Discover / Google News performance export: Chart (Date), Pages, Countries, Search appearance sheets.
  function surfaceExport(sheets) {
    const out = { daily: [], pages: [], countries: [], appearance: [] };
    const pct = v => typeof v === 'number' ? (v <= 1 ? v * 100 : v) : parseFloat(String(v || '')) || 0;
    sheets.forEach(({ name, rows }) => {
      if (!rows || rows.length < 2) return;
      const h = rows[0].map(x => norm(x));
      const n = norm(name) + ' ' + h[0];
      const ci = h.findIndex((x, i) => i > 0 && /click/.test(x) && !/previous/.test(x)), ii = h.findIndex((x, i) => i > 0 && /impression/.test(x) && !/previous/.test(x));
      if (ci < 0 || ii < 0) return;
      const kind = /date|chart/.test(n) ? 'daily' : /page/.test(n) ? 'pages' : /countr/.test(n) ? 'countries' : /appearance/.test(n) ? 'appearance' : null;
      if (!kind || out[kind].length) return;
      rows.slice(1).forEach(r => {
        if (r[0] === '' || r[0] == null) return;
        const clicks = num(r[ci]), impr = num(r[ii]);
        const key = kind === 'daily' ? excelDate(r[0]) : String(r[0]);
        if (!key) return;
        out[kind].push({ [kind === 'pages' ? 'p' : 'd']: key, clicks, impr, ctr: impr ? clicks / impr * 100 : pct(0) });
      });
    });
    out.daily.sort((a, b) => a.d.localeCompare(b.d));
    out.ok = !!(out.daily.length || out.pages.length);
    return out;
  }
  // Affected URLs joined with Search performance: pages still earning impressions while excluded.
  function joinPerf(urls, pages) {
    const m = new Map((pages || []).map(r => [String(r.p).replace(/\/$/, ''), r]));
    return urls.map(u => { const r = m.get(u.url.replace(/\/$/, '')); return { ...u, p: u.url, clicks: r ? r.clicks : 0, impr: r ? r.impr : 0, pos: r ? r.pos : 0 }; });
  }

  // Pages worth inspecting first, from the analysis already loaded.
  function inspectList(A, how, limit) {
    const P = (A && A.P) || [];
    let rows;
    if (how === 'decay') rows = ((A.decay && A.decay.pages) || []).map(r => r.p);
    else if (how === 'zero') rows = ((A.ai && A.ai.zeroPages) || []).map(r => r.p);
    else if (how === 'tail') rows = P.filter(r => r.impr > 0).sort((a, b) => a.impr - b.impr).map(r => r.p);
    else rows = P.slice().sort((a, b) => b.clicks - a.clicks || b.impr - a.impr).map(r => r.p);
    return [...new Set(rows.filter(u => /^https?:\/\//i.test(u)))].slice(0, limit);
  }
  function parseUrls(text, host) {
    const h = String(host || '').replace(/^www\./, '').toLowerCase();
    const ok = [], bad = [];
    String(text || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean).forEach(u => {
      let x; try { x = new URL(u); } catch (e) { bad.push(u); return; }
      const hh = x.hostname.replace(/^www\./, '').toLowerCase();
      if (!/^https?:$/.test(x.protocol) || (h && hh !== h && !hh.endsWith('.' + h))) bad.push(u); else ok.push(x.href);
    });
    return { ok: [...new Set(ok)], bad };
  }

  // ── sample data for the fictional site (deterministic) ──
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function demoSurface(D, kind) {
    const R = rng(kind === 'news' ? 11 : 7), C = D.C || [];
    const pool = (D.P || []).filter(r => /\/(blog|guides|trails|reviews)\//.test(r.p));
    const scale = kind === 'news' ? 0.08 : 1;
    const pick = pool.filter((_, i) => kind === 'news' ? i % 3 === 0 : i % 2 === 0);
    const per = pick.map((p, i) => ({ p: p.p, w: (kind === 'news' ? 0.6 : 1) / (1 + i * 0.35), burst: Math.floor(R() * C.length), ctr: i === 3 || i === 6 ? 1.6 : 5 + R() * 5 }));
    const daily = C.map((c, di) => ({ d: c.d, clicks: 0, impr: 0 }));
    const pageTot = per.map(x => ({ p: x.p, clicks: 0, impr: 0 }));
    per.forEach((x, i) => C.forEach((c, di) => {
      const dist = Math.abs(di - x.burst);
      const impr = Math.round(scale * 900 * x.w * (dist < 4 ? Math.exp(-dist) * 6 : R() < 0.2 ? R() : 0));
      const clicks = Math.round(impr * x.ctr / 100);
      daily[di].clicks += clicks; daily[di].impr += impr; pageTot[i].clicks += clicks; pageTot[i].impr += impr;
    }));
    daily.forEach(r => r.ctr = r.impr ? r.clicks / r.impr * 100 : 0);
    const pages = pageTot.filter(r => r.impr).map(r => ({ ...r, ctr: r.clicks / r.impr * 100 }));
    const prevPages = pages.map((r, i) => ({ p: r.p, clicks: i % 4 === 1 ? 0 : Math.round(r.clicks * (0.6 + R())), impr: Math.round(r.impr * (0.7 + R())) })).concat(pool.length > 2 ? [{ p: pool[pool.length - 1].p, clicks: Math.round(120 * scale + 15), impr: Math.round(2400 * scale + 300) }] : []);
    const prevDaily = daily.map(r => ({ d: r.d, clicks: Math.round(r.clicks * (0.8 + R() * 0.3)), impr: Math.round(r.impr * (0.85 + R() * 0.3)) }));
    const T = tot(daily);
    const countries = [['ind', 0.82], ['usa', 0.06], ['are', 0.04], ['gbr', 0.03], ['npl', 0.02]].map(([d, s]) => ({ d, clicks: Math.round(T.clicks * s), impr: Math.round(T.impr * s), ctr: T.ctr }));
    const appearance = kind === 'news' ? [] : [{ d: 'Discover articles', clicks: Math.round(T.clicks * 0.93), impr: Math.round(T.impr * 0.9), ctr: T.ctr }, { d: 'Web stories', clicks: Math.round(T.clicks * 0.07), impr: Math.round(T.impr * 0.1), ctr: T.ctr }];
    return { daily, pages, prevDaily, prevPages, countries, appearance };
  }
  function demoHourly(D, now = new Date()) {
    const R = rng(5), C = D.C || [];
    const perDay = C.length ? sum(C, 'clicks') / C.length : 200, imprDay = C.length ? sum(C, 'impr') / C.length : 8000;
    const end = Math.floor((now.getTime() - 3 * HOUR) / HOUR) * HOUR;
    const shape = h => 0.35 + Math.max(0, Math.sin((h - 5) / 24 * 2 * Math.PI)) * 1.3 + (h >= 19 && h <= 22 ? 0.4 : 0); // IST-ish evening peak
    const rows = [];
    for (let ts = end - 8 * 24 * HOUR; ts <= end; ts += HOUR) {
      const istHour = new Date(ts + 5.5 * HOUR).getUTCHours();
      const recent = ts > end - 24 * HOUR ? 1.12 : 1;
      const impr = Math.round(imprDay / 24 * shape(istHour) * (0.85 + R() * 0.3) * recent);
      const clicks = Math.round(perDay / 24 * shape(istHour) * (0.8 + R() * 0.4) * recent);
      rows.push({ h: new Date(ts).toISOString().replace('.000Z', '+00:00'), clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: 8 + R() * 3 });
    }
    const from = end - 23 * HOUR, prevFrom = from - 24 * HOUR;
    const qs = (D.Q || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 60);
    const ps = (D.P || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 40);
    const spread = (list, key, start, bonus) => list.flatMap((r, i) => { const out = []; for (let k = 0; k < 4; k++) { const ts = start + Math.floor(R() * 24) * HOUR; const impr = Math.max(1, Math.round(r.impr / C.length / 4 * (0.6 + R() * 0.8) * (bonus && i % 7 === 0 ? 2.5 : 1))); const clicks = Math.round(impr * r.ctr / 100); out.push({ h: new Date(ts).toISOString().replace('.000Z', '+00:00'), [key]: r[key], clicks, impr, pos: r.pos }); } return out; });
    const newQ = ['kedarkantha trek snow update', 'best trekking shoes under 5000', 'hampta pass trek october'].map((q, i) => ({ h: new Date(from + (6 + i * 5) * HOUR).toISOString().replace('.000Z', '+00:00'), q, clicks: 4 - i, impr: 40 - i * 9, pos: 7 + i }));
    return {
      rows, firstIncomplete: new Date(end - 2 * HOUR).toISOString().replace('.000Z', '+00:00'),
      queries: spread(qs, 'q', from, true).concat(newQ), prevQueries: spread(qs, 'q', prevFrom),
      pages: spread(ps, 'p', from, true), prevPages: spread(ps, 'p', prevFrom), exact: true
    };
  }
  function demoInspections(D, urls, now = new Date()) {
    return urls.map((u, i) => {
      const R = rng(i + 3), crawl = new Date(now.getTime() - (i % 9 === 4 ? 140 : 2 + R() * 30) * DAY).toISOString();
      const base = { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL', lastCrawlTime: crawl, googleCanonical: u, userCanonical: u, crawledAs: 'MOBILE', sitemap: ['https://www.trailcraft.co/sitemap.xml'] };
      if (/\/login/.test(u)) Object.assign(base, { verdict: 'NEUTRAL', coverageState: "Excluded by 'noindex' tag", indexingState: 'BLOCKED_BY_META_TAG', sitemap: [] });
      else if (i % 11 === 5) Object.assign(base, { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' });
      else if (i % 13 === 7) Object.assign(base, { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed', lastCrawlTime: null, pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED', googleCanonical: '', sitemap: [] });
      else if (i % 17 === 8) Object.assign(base, { verdict: 'NEUTRAL', coverageState: 'Duplicate, Google chose different canonical than user', googleCanonical: u.replace(/\/[^/]+$/, '') + '/' });
      const rich = /\/reviews\//.test(u) ? { verdict: i % 2 ? 'PASS' : 'FAIL', detectedItems: [{ richResultType: 'Review snippets', items: [{ name: 'Product', issues: i % 2 ? [] : [{ issueMessage: 'Missing field "itemReviewed"', severity: 'ERROR' }] }] }] } : /\/guides\//.test(u) ? { verdict: 'PASS', detectedItems: [{ richResultType: 'FAQ', items: [{ name: 'FAQ', issues: [] }] }, { richResultType: 'Breadcrumbs', items: [{ name: 'Breadcrumb', issues: [] }] }] } : null;
      return { url: u, result: { inspectionResultLink: null, indexStatusResult: base, richResultsResult: rich } };
    });
  }
  function demoSitemaps(now = new Date()) {
    const ago = d => new Date(now.getTime() - d * DAY).toISOString();
    return [
      { path: 'https://www.trailcraft.co/sitemap.xml', isSitemapsIndex: true, lastSubmitted: ago(60), lastDownloaded: ago(1), isPending: false, errors: 0, warnings: 0, contents: [{ type: 'web', submitted: '412' }] },
      { path: 'https://www.trailcraft.co/sitemap-guides.xml', isSitemapsIndex: false, lastSubmitted: ago(60), lastDownloaded: ago(2), isPending: false, errors: 0, warnings: 1, contents: [{ type: 'web', submitted: '64' }, { type: 'image', submitted: '210' }] },
      { path: 'https://www.trailcraft.co/sitemap-old-blog.xml', isSitemapsIndex: false, lastSubmitted: ago(400), lastDownloaded: ago(38), isPending: false, errors: 3, warnings: 0, contents: [{ type: 'web', submitted: '0' }] }
    ];
  }
  function demoIndexExport(D) {
    const C = D.C || [];
    const chart = C.map((c, i) => ({ d: c.d, indexed: 398 + Math.round(i / 6), notIndexed: 140 + Math.round(i / 3) + (i > C.length - 20 ? 25 : 0), impr: c.impr }));
    const P = (D.P || []).filter(r => /\/(blog|reviews|compare)\//.test(r.p)).slice(0, 6);
    return indexExport([
      { name: 'Critical issues', rows: [['Reason', 'Source', 'Validation', 'Pages'], ['Crawled - currently not indexed', 'Google systems', 'Not Started', 48], ['Not found (404)', 'Website', 'Not Started', 37], ["Excluded by 'noindex' tag", 'Website', 'N/A', 22], ['Discovered - currently not indexed', 'Google systems', 'Not Started', 19], ['Page with redirect', 'Website', 'N/A', 31], ['Alternate page with proper canonical tag', 'Website', 'N/A', 12], ['Duplicate, Google chose different canonical than user', 'Google systems', 'Not Started', 6], ['Server error (5xx)', 'Website', 'Failed', 3]] },
      { name: 'Chart', rows: [['Date', 'Not indexed', 'Indexed', 'Impressions']].concat(chart.map(r => [r.d, r.notIndexed, r.indexed, r.impr])) },
      { name: 'Table', rows: [['URL', 'Last crawled']].concat(P.map((r, i) => [r.p, C.length ? C[Math.max(0, C.length - 5 - i * 9)].d : ''])) },
      { name: 'Metadata', rows: [['Property', 'Value'], ['Issue', 'Crawled - currently not indexed']] }
    ]);
  }

  window.CW_SURF = { ptDate, surface, CHECKS, hourly, hourTop, newIn, ISSUE, inspection, inspectionSummary, sitemaps, indexExport, surfaceExport, joinPerf, reasonFix, inspectList, parseUrls, pathOf, tot, demoSurface, demoHourly, demoInspections, demoSitemaps, demoIndexExport };
})();

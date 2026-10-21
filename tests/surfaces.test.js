// Tests for surfaces.js: Discover/News summary, the last-24-hours window, URL inspection, sitemaps and the Page indexing export.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'demo.js', 'surfaces.js']);
const S = W.CW_SURF;
const NOW = new Date('2026-10-21T06:00:00Z');

test('ptDate is Pacific time', () => {
  assert.equal(S.ptDate(0, new Date('2026-10-21T05:00:00Z')), '2026-10-20');
  assert.equal(S.ptDate(-1, new Date('2026-10-21T12:00:00Z')), '2026-10-20');
});
test('surface: totals, weak cards, dropped and new pages, insights', () => {
  const pages = [{ p: 'https://s.test/a', clicks: 100, impr: 1000 }, { p: 'https://s.test/b', clicks: 5, impr: 2000 }, { p: 'https://s.test/c', clicks: 60, impr: 900 }, { p: 'https://s.test/d', clicks: 40, impr: 500 }];
  const prevPages = [{ p: 'https://s.test/a', clicks: 50, impr: 600 }, { p: 'https://s.test/old', clicks: 30, impr: 400 }];
  const daily = [{ d: '2026-10-02', clicks: 150, impr: 3000 }, { d: '2026-10-01', clicks: 55, impr: 1400 }];
  const R = S.surface({ daily, pages, prevDaily: [{ d: '2026-09-30', clicks: 100, impr: 2000 }], prevPages }, [{ p: 'https://s.test/a', clicks: 10 }], 'discover');
  assert.equal(R.tot.clicks, 205); assert.equal(R.daily[0].d, '2026-10-01', 'sorted');
  assert.ok(R.weak.some(p => p.p.endsWith('/b')), 'low-CTR card found');
  assert.ok(R.dropped.some(p => p.p.endsWith('/old')), 'dropped page found');
  assert.ok(R.fresh.some(p => p.p.endsWith('/c')), 'new page found');
  assert.ok(R.onlyHere.some(p => p.p.endsWith('/a')), 'more Discover than Search');
  assert.ok(R.insights.some(i => /rose 105%/.test(i.text)), 'period change');
  assert.ok(S.surface({ daily: [], pages: [] }, [], 'news').empty);
});
test('hourly: window ends at latest hour with data, compares day and week before', () => {
  const rows = [], end = Date.parse('2026-10-21T03:00:00Z');
  for (let i = 0; i < 24 * 8; i++) { const ts = end - i * 36e5; rows.push({ h: new Date(ts).toISOString(), clicks: i < 24 ? 2 : 1, impr: 10, pos: 5 }); }
  rows.push({ h: new Date(end + 36e5).toISOString(), clicks: 0, impr: 0, pos: 0 });
  const H = S.hourly(rows, null);
  assert.equal(H.end, end); assert.equal(H.last.length, 24);
  assert.equal(H.tot.clicks, 48); assert.equal(H.prevTot.clicks, 24); assert.equal(H.weekTot.clicks, 24);
  const top = S.hourTop([{ h: new Date(end).toISOString(), q: 'x', clicks: 3, impr: 10, pos: 4 }, { h: new Date(end - 30 * 36e5).toISOString(), q: 'x', clicks: 9, impr: 10, pos: 4 }], 'q', H.start, H.end);
  assert.equal(top[0].clicks, 3, 'outside window ignored');
  assert.ok(S.hourly([], null).empty);
});
test('inspection: statuses and canonical/stale/rich checks', () => {
  const base = { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL', lastCrawlTime: '2026-10-19T00:00:00Z', googleCanonical: 'https://s.test/a', userCanonical: 'https://s.test/a' };
  const k = (o, r) => S.inspection('https://s.test/a', { indexStatusResult: { ...base, ...o }, richResultsResult: r }, NOW);
  assert.equal(k({}).key, 'ok');
  assert.equal(k({ lastCrawlTime: '2026-05-01T00:00:00Z' }).key, 'stale');
  assert.equal(k({ googleCanonical: 'https://s.test/b' }).key, 'canonical');
  assert.equal(k({ verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' }).key, 'crawled');
  assert.equal(k({ verdict: 'NEUTRAL', coverageState: 'Discovered – currently not indexed' }).key, 'discovered');
  assert.equal(k({ verdict: 'NEUTRAL', indexingState: 'BLOCKED_BY_META_TAG' }).key, 'noindex');
  assert.equal(k({ verdict: 'FAIL', pageFetchState: 'NOT_FOUND', coverageState: 'Not found (404)' }).key, 'notfound');
  assert.equal(k({ verdict: 'FAIL', robotsTxtState: 'DISALLOWED' }).key, 'robots');
  const r = k({}, { detectedItems: [{ richResultType: 'FAQ', items: [{ issues: [{ issueMessage: 'Missing x', severity: 'ERROR' }] }] }] });
  assert.equal(r.richErrors.length, 1);
  const sum = S.inspectionSummary([k({}), k({ verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed', sitemap: [] }), null]);
  assert.equal(sum.n, 2); assert.equal(sum.indexed, 1); assert.equal(sum.groups[0].key, 'crawled', 'problems first');
});
test('sitemaps: errors, stale reads, pending', () => {
  const L = S.sitemaps(S.demoSitemaps(NOW), NOW);
  assert.equal(L[0].errors, 3); assert.ok(L[0].flags.some(f => /38 days/.test(f.text)));
  assert.equal(L.find(s => /guides/.test(s.path)).submitted, 274);
});
test('Page indexing export: reasons, chart, URL list', () => {
  const R = S.indexExport([
    { name: 'Critical issues', rows: [['Reason', 'Source', 'Validation', 'Pages'], ['Page with redirect', 'Website', 'N/A', 30], ['Crawled - currently not indexed', 'Google systems', 'Not Started', '1,204']] },
    { name: 'Chart', rows: [['Date', 'Not indexed', 'Indexed', 'Impressions'], ['2026-10-02', 10, 90, 5], ['2026-10-01', 12, 88, 4]] },
    { name: 'Table', rows: [['URL', 'Last crawled'], ['https://s.test/a', '2026-09-01']] },
    { name: 'Metadata', rows: [['Property', 'Value'], ['Issue', 'Crawled - currently not indexed']] }
  ]);
  assert.equal(R.issues[0].reason, 'Crawled - currently not indexed', 'fix-first sorted on top'); assert.equal(R.issues[0].pages, 1204);
  assert.equal(R.latest.indexed, 90); assert.equal(R.urls.length, 1); assert.equal(R.issueTone, 'risk');
  const j = S.joinPerf(R.urls, [{ p: 'https://s.test/a/', clicks: 3, impr: 40 }]);
  assert.equal(j[0].impr, 40, 'trailing slash matched');
  assert.ok(!S.indexExport([{ name: 'x', rows: [['a']] }]).ok);
});
test('Discover export and URL lists', () => {
  const R = S.surfaceExport([{ name: 'Chart', rows: [['Date', 'Clicks', 'Impressions', 'CTR'], ['2026-10-01', 5, 100, '5%']] }, { name: 'Pages', rows: [['Top pages', 'Clicks', 'Impressions', 'CTR'], ['https://s.test/a', 5, 100, 0.05]] }]);
  assert.ok(R.ok); assert.equal(R.pages[0].ctr, 5);
  const u = S.parseUrls('https://www.s.test/a\nhttps://other.test/b junk https://s.test/a', 's.test');
  assert.equal(u.ok.length, 2); assert.equal(u.bad.length, 2);
  const D = W.CW_DEMO.build(), A = W.CW.analyse(D, { brand: ['trailcraft'], exclude: [] });
  assert.equal(S.inspectList(A, 'top', 10).length, 10);
});
test('sample data builds for every screen', () => {
  const D = W.CW_DEMO.build();
  ['discover', 'news'].forEach(k => assert.ok(!S.surface(S.demoSurface(D, k), D.P, k).empty, k));
  const h = S.demoHourly(D, NOW); assert.ok(!S.hourly(h.rows, h.firstIncomplete).empty);
  assert.ok(S.demoIndexExport(D).ok);
});
process.exit(report('surfaces') ? 1 : 0);

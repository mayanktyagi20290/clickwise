// Tests for the Generative AI report (genai.js): reading the export, refusing the wrong file, the join with
// Performance data (shares only for matching dates), pages never shown in AI features, the deep link and sample.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'demo.js', 'genai.js']);
const { CW, CW_GENAI: GA } = W;

const days = (n, start, f) => { const out = [], d0 = new Date(start + 'T00:00:00Z'); for (let i = 0; i < n; i++) { const d = new Date(d0); d.setUTCDate(d0.getUTCDate() + i); out.push(f(d.toISOString().slice(0, 10), i)); } return out; };
const exportOf = (opts = {}) => [
  { name: 'Chart', rows: [['Date', 'Impressions']].concat(days(opts.days || 28, opts.start || '2026-06-01', (d) => [d, 100])) },
  { name: 'Pages', rows: [['Top pages', 'Impressions']].concat(opts.pages || [['https://www.site.test/a/', 1500], ['https://site.test/b', 900], ['https://site.test/c', 400]]) },
  { name: 'Countries', rows: [['Country', 'Impressions'], ['India', 2400], ['Nepal', 400]] },
  { name: 'Devices', rows: [['Device', 'Impressions'], ['MOBILE', 2000], ['DESKTOP', 800]] },
  { name: 'Filters', rows: [['Filter', 'Value'], ['Search type', 'Web']].concat(opts.filters || []) }
];
const perf = (start = '2026-06-01', n = 28) => {
  const P = [['/a', 50, 3000, 2], ['/b', 30, 9000, 4], ['/c', 20, 4000, 6], ['/d', 40, 5000, 3], ['/e', 10, 2000, 8], ['/f', 5, 300, 15]].map(([u, c, i, p]) => ({ p: 'https://site.test' + u, path: u, clicks: c, impr: i, ctr: c / i * 100, pos: p }));
  return { A: { P, isExcluded: () => false }, D: { site: 'site.test', start, end: days(n, start, d => d).pop(), C: days(n, start, d => ({ d, clicks: 10, impr: 1000, ctr: 1, pos: 5 })) } };
};

test('reads the export: dates, pages, countries, devices, filters; impressions only', () => {
  const G = GA.parse(exportOf());
  assert.ok(G.ok, G.error);
  assert.equal(G.C.length, 28); assert.equal(G.start, '2026-06-01'); assert.equal(G.end, '2026-06-28'); assert.equal(G.days, 28);
  assert.equal(G.P.length, 3); assert.equal(G.P[0].impr, 1500, 'sorted by impressions');
  assert.equal(G.Countries.length, 2); assert.equal(G.Dev.length, 2); assert.equal(G.hasClicks, false);
  // Excel serial dates, thousands separators, CSV file names, unnamed columns
  const csv = GA.parse([{ name: 'Dates.csv Sheet1', rows: [['Date', 'Impressions'], [46174, '1,234'], ['2026-06-02', '99']] }, { name: 'Pages.csv Sheet1', rows: [['Top pages', ''], ['https://site.test/x', '12']] }]);
  assert.ok(csv.ok); assert.equal(csv.C[0].d, '2026-06-01'); assert.equal(csv.C[0].impr, 1234); assert.equal(csv.P[0].impr, 12);
  // the same day in two files counts once
  assert.equal(GA.parse(exportOf().concat([{ name: 'Chart 2', rows: [['Date', 'Impressions'], ['2026-06-01', 100]] }])).C.length, 28);
});

test('refuses the Performance export and unrelated files with a clear message', () => {
  const perfX = GA.parse([{ name: 'Queries', rows: [['Top queries', 'Clicks', 'Impressions', 'CTR', 'Position'], ['x', 1, 10, '10%', 3]] }, { name: 'Pages', rows: [['Top pages', 'Clicks', 'Impressions', 'CTR', 'Position'], ['https://s.test/', 1, 10, '10%', 3]] }]);
  assert.equal(perfX.ok, false); assert.ok(/Performance report export/.test(perfX.error));
  const other = GA.parse([{ name: 'Sheet1', rows: [['Name', 'Age'], ['a', 1]] }]);
  assert.equal(other.ok, false); assert.ok(/Generative AI report/.test(other.error));
  assert.equal(GA.parse([]).ok, false);
});

test('page filter in the export is read as its scope', () => {
  assert.equal(GA.scopeOf([['Page', '*/employers/']]), '/employers/');
  assert.equal(GA.scopeOf([['Page', '+/blog/']]), '/blog/');
  assert.equal(GA.scopeOf([['Page', '-/jobs/']]), null, 'an exclusion is not a scope');
  assert.equal(GA.scopeOf([['Search type', 'Web']]), null);
  assert.equal(GA.parse(exportOf({ filters: [['Page', '*/employers/']] })).scope, '/employers/');
});

test('join: shares only when dates match, URL forms matched, totals and notes', () => {
  const { A, D } = perf();
  const R = GA.analyse(GA.parse(exportOf()), A, D);
  assert.equal(R.period, 'match'); assert.equal(R.total, 2800);
  assert.near(R.shareAll, 2800 / 28000 * 100, 1e-9, 'share of all web impressions');
  const a = R.pages.find(r => r.path === '/a/');
  assert.equal(a.web, 3000, 'www and trailing slash matched'); assert.near(a.share, 50, 1e-9);
  assert.equal(R.matched, 3);
  assert.ok(R.notes.some(n => /Impressions only/.test(n)) && R.notes.some(n => /already part of the Web/.test(n)));
  // different dates: no shares, no not-shown list, and the reason
  const later = GA.analyse(GA.parse(exportOf({ start: '2026-06-15' })), A, D);
  assert.equal(later.period, 'partial'); assert.equal(later.shareAll, null); assert.ok(later.pages.every(r => r.share == null));
  assert.equal(later.notCited, null); assert.ok(/same dates/.test(later.notCitedWhy));
  assert.equal(GA.analyse(GA.parse(exportOf({ start: '2025-01-01' })), A, D).period, 'none');
  // more AI than web impressions means the files differ in scope: flagged
  const over = GA.analyse(GA.parse(exportOf({ pages: [['https://site.test/f', 900]] })), A, D);
  assert.ok(over.pages[0].over && over.notes.some(n => /more AI impressions/.test(n)));
});

test('page-one pages never shown in AI features: complete export, same dates, within the filter', () => {
  const { A, D } = perf();
  const R = GA.analyse(GA.parse(exportOf()), A, D);
  assert.deep(R.notCited.map(r => r.path), ['/d'], 'top-10 pages with median+ impressions missing from the export (not /e: low demand, not /f: page two)');
  const scoped = GA.analyse(GA.parse(exportOf({ filters: [['Page', '*/a']] })), A, D);
  assert.equal(scoped.notCited.length, 0, 'outside the export filter is never claimed');
  const cut = GA.parse(exportOf({ pages: Array.from({ length: 1000 }, (_, i) => ['https://site.test/p' + i, 1]) }));
  assert.ok(cut.truncated.P); assert.equal(GA.analyse(cut, A, D).notCited, null, 'row limit: absence not claimed');
});

test('deep link uses Search Console’s own URL format, with the folder filter', () => {
  assert.equal(GA.reportUrl({ site: 'unstop.com', scope: '/employers/' }), 'https://search.google.com/search-console/performance/search-analytics/ai?resource_id=sc-domain%3Aunstop.com&num_of_months=3&page=*%2Femployers%2F');
  assert.equal(GA.reportUrl({ site: 'x', siteUrl: 'https://www.x.test/' }), 'https://search.google.com/search-console/performance/search-analytics/ai?resource_id=https%3A%2F%2Fwww.x.test%2F&num_of_months=3');
});

test('sample for the demo site is deterministic and consistent with its own data', () => {
  const D = W.CW_DEMO.build();
  const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] });
  const s1 = JSON.stringify(GA.sample(D)), s2 = JSON.stringify(GA.sample(D));
  assert.equal(s1, s2, 'same output every time');
  const G = GA.parse(GA.sample(D)); assert.ok(G.ok);
  const R = GA.analyse(G, A, D);
  assert.equal(R.period, 'match'); assert.ok(R.shareAll > 0 && R.shareAll < 100);
  assert.ok(R.pages.every(r => r.web != null && !r.over), 'every sample page is a real demo page with fewer AI than web impressions');
  assert.near(G.P.reduce((s, r) => s + r.impr, 0), R.total, R.total * 0.02, 'pages add up to the daily total');
});

process.exit(report('genai') ? 1 : 0);

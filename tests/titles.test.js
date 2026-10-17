// Tests for the title & meta audit (titles.js): reading crawler page exports and every check, against the
// fictional sample site. The crawl file below is written by hand so each expected issue is known.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_TITLES: T } = W;

const D = W.CW_DEMO.build();
const S = { brand: ['trailcraft'], exclude: ['/login'] };
const A = CW.analyse(D, S);
const host = 'https://www.trailcraft.co';
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
// Screaming Frog Internal › HTML columns (a subset, in its order)
const HEAD = ['Address', 'Content Type', 'Status Code', 'Indexability', 'Title 1', 'Title 1 Length', 'Title 1 Pixel Width', 'Meta Description 1', 'Meta Description 1 Length', 'H1-1'];
const row = (path, title, meta, h1, extra = {}) => [host + path, extra.type || 'text/html; charset=UTF-8', extra.status || 200, extra.index || 'Indexable', title, title.length, extra.px == null ? '' : extra.px, meta, meta.length, h1];
const META = 'A practical guide with routes, costs, best season and what to pack, written by people who have done it.';
const rows = [
  row('/trails/himalaya/kedarkantha-trek', 'Himalayan Winter Adventure | Trailcraft', META, 'Kedarkantha'),                 // main search missing
  row('/trails/himalaya/valley-of-flowers', 'Valley of Flowers Trek: Route and Best Time | Trailcraft', 'Everything about the Valley of Flowers trek: the route, the best months to go, permits and costs.', 'Valley of Flowers'), // fine
  row('/gear/hiking-boots', 'Boots', '', ''),                                                                            // short title, no meta, no H1
  row('/gear/trail-running-shoes', 'Trail Running Shoes for Every Terrain, Budget and Season in India 2026 | Trailcraft', META, 'Trail running shoes'), // too long
  row('/guides/how-to-pack-a-backpack', 'Trekking guides | Trailcraft', META, 'Pack'),                                  // duplicate 1
  row('/guides/how-to-set-up-a-tent', 'Trekking guides | Trailcraft', META, 'Tent'),                                     // duplicate 2
  row('/reviews/best-hiking-boots', '', META, 'Best boots'),                                                             // no title
  row('/about', 'About Trailcraft', META, 'About', { index: 'Non-Indexable' }),                                          // noindex, has impressions?
  row('/blog/not-in-gsc', 'A Post Nobody Sees In Search', META, 'Post'),                                                 // crawled, no impressions
  row('/img/logo.png', 'x', '', '', { type: 'image/png' })                                                               // not HTML: skipped
];
const CSV = '﻿' + [HEAD].concat(rows).map(r => r.map(q).join(',')).join('\n');
const crawl = T.parsePages(CSV, 'trailcraft.co');
const R = T.audit(A, D, crawl, { brand: S.brand });
const byPath = p => R.rows.find(r => r.path === p);
const kinds = p => (byPath(p) || { issues: [] }).issues.map(i => i.kind);

test('reads a Screaming Frog Internal › HTML export; skips non-HTML rows', () => {
  assert.ok(crawl.ok && crawl.count === 9 && crawl.hasMeta && crawl.hasH1, JSON.stringify({ ok: crawl.ok, n: crawl.count }));
  assert.ok(!crawl.pages.has('trailcraft.co/img/logo.png'));
  const minimal = T.parsePages('URL,Title\nhttps://www.trailcraft.co/a,Hello\n', 'trailcraft.co');
  assert.ok(minimal.ok && !minimal.hasMeta && !minimal.hasH1, 'just URL and title works');
});
test('wrong files are refused with a plain message', () => {
  assert.ok(/no rows/.test(T.parsePages('', 'x.test').error));
  assert.ok(/URL and title columns/.test(T.parsePages('Source,Destination\nhttps://a/,https://b/\n', 'x.test').error));
  assert.ok(/No HTML pages on trailcraft.co/.test(T.parsePages('Address,Title 1\nhttps://other.test/a,Hi\n', 'trailcraft.co').error));
});
test('main search missing from the title (Search Console data)', () => {
  const r = byPath('/trails/himalaya/kedarkantha-trek');
  assert.ok(r && kinds(r.path).includes('title-query'), JSON.stringify(r && r.issues));
  assert.ok(/“kedarkantha trek”/.test(r.issues.find(i => i.kind === 'title-query').text));
  assert.ok(!kinds('/trails/himalaya/valley-of-flowers').includes('title-query'), 'a title with the search is fine');
  assert.equal(byPath('/trails/himalaya/valley-of-flowers'), undefined, 'a page with nothing to fix is not listed');
});
test('length, missing pieces and duplicates', () => {
  assert.ok(kinds('/gear/hiking-boots').includes('title-short') && kinds('/gear/hiking-boots').includes('meta-missing') && kinds('/gear/hiking-boots').includes('h1-missing'));
  assert.ok(kinds('/gear/trail-running-shoes').includes('title-long'));
  assert.ok(kinds('/reviews/best-hiking-boots').includes('title-missing'));
  assert.ok(kinds('/guides/how-to-pack-a-backpack').includes('title-dup') && kinds('/guides/how-to-set-up-a-tent').includes('title-dup'));
  assert.ok(R.dupTitles.some(g => g.text === 'Trekking guides | Trailcraft' && g.keys.length === 2));
  assert.ok(R.dupMetas.length >= 1, 'the shared meta description is found');
});
test('pixel width wins over characters when the crawler gives it', () => {
  const c = T.parsePages(['Address,Title 1,Title 1 Pixel Width', `${host}/gear/hiking-boots,Short but very wide title text,640`, `${host}/gear/headlamp,A really quite long title that is nonetheless narrow enough,500`].join('\n'), 'trailcraft.co');
  const r = T.audit(A, D, c, { brand: S.brand });
  assert.ok(r.rows.find(x => x.path === '/gear/hiking-boots').issues.some(i => i.kind === 'title-long' && /640 px/.test(i.text)), 'wide by pixels');
  const narrow = r.rows.find(x => x.path === '/gear/headlamp');
  assert.ok(!narrow || !narrow.issues.some(i => i.kind === 'title-long'), 'narrow enough by pixels');
});
test('non-indexable pages: listed only when Search Console still shows them', () => {
  const about = A.P.find(p => p.path === '/about');
  if (about && about.impr > 0) assert.ok(kinds('/about').includes('noindex'));
  else assert.equal(byPath('/about'), undefined);
  assert.ok(!R.dupTitles.some(g => g.keys.includes('trailcraft.co/about')), 'non-indexable pages are not duplicates');
});
test('suggestions come from the page\'s own main search and fit the limit', () => {
  R.rows.filter(r => r.suggestion).forEach(r => {
    assert.ok(r.suggestion.length <= T.LIMITS.titleMax, r.suggestion);
    assert.ok(r.suggestion.toLowerCase().startsWith(r.queries[0].q.toLowerCase()), 'starts with the real search: ' + r.suggestion);
  });
  const k = byPath('/trails/himalaya/kedarkantha-trek');
  assert.ok(k.suggestion && /\| Trailcraft$/.test(k.suggestion), 'keeps the existing brand suffix: ' + k.suggestion);
  const v = T.audit(A, D, T.parsePages('Address,Title 1\n' + host + '/trails/himalaya/valley-of-flowers,Flowers\n', 'trailcraft.co'), { brand: S.brand }).rows[0];
  assert.ok(v.suggestion.startsWith('Valley of Flowers'), 'small words stay lowercase: ' + v.suggestion);
});
test('ordering, counts and nothing invented', () => {
  for (let i = 1; i < R.rows.length; i++) assert.ok(R.rows[i - 1].priority >= R.rows[i].priority, 'ordered by priority');
  const known = new Set(D.P.map(r => r.p).concat(rows.map(r => r[0])));
  assert.ok(R.rows.every(r => known.has(r.url)), 'every URL is from Search Console or the crawl');
  assert.ok(R.crawlNoImpr >= 1, 'crawled pages with no impressions counted');
  assert.ok(R.gscOnly > 0, 'pages in Search Console but not in this small crawl counted');
});
test('without query-page data: no search checks, the rest still works', () => {
  const D2 = { ...D, QP: null }, A2 = CW.analyse(D2, S);
  const R2 = T.audit(A2, D2, crawl, { brand: S.brand });
  assert.equal(R2.mode, 'export');
  assert.ok(R2.rows.every(r => !r.issues.some(i => i.kind === 'title-query') && !r.suggestion), 'no search-based checks or suggestions');
  assert.ok(R2.rows.some(r => r.issues.some(i => i.kind === 'title-dup')));
});

process.exitCode = report('titles') ? 1 : 0;

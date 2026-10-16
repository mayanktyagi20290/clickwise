// Regression on an anonymised real Search Console export (3 months, 1,000 queries and pages).
// Expected figures were checked by hand against the original file during the October 2026 audit.
'use strict';
const { load, fixtureData, hasFixture, test, assert, report } = require('./lib/harness');
if (!hasFixture()) {
  console.log('regression: skipped (private fixture tests/fixtures/real-export-anon.json not present — create it with tools/anonymize-export.js)');
  process.exit(0);
}
const W = load();
const { CW, CW_WORKFLOWS: WF, CW_FILTERS: F } = W;
const { D } = fixtureData();
const S = { brand: ['example', 'example.com'], exclude: ['/login', '/signin', '/sign-in', '/signup', '/register', '/account', '/cart', '/checkout', '/auth/'], utilityHints: CW.DEFAULT_UTILITY };
const A = CW.analyse(D, S);
const monthlySite = A.site.clicks * 30 / A.days;

test('site totals come from daily data', () => {
  assert.equal(A.days, 92);
  assert.equal(A.site.clicks, 3732168);
  assert.equal(A.site.impr, 102368959);
});
test('non-brand totals and averages are unchanged', () => {
  assert.equal(A.totNB.clicks, 636286);
  assert.near(A.totNB.ctr, 7.175, 0.001, 'non-brand CTR');
  assert.near(A.totNB.pos, 5.944, 0.001, 'non-brand position');
});
test('export coverage', () => {
  assert.near(A.coverage.q.clicks, 62.5, 0.05, 'query click coverage');
  assert.near(A.coverage.q.impr, 10.7, 0.05, 'query impression coverage');
  assert.near(A.coverage.p.clicks, 89.2, 0.05, 'page click coverage');
  assert.ok(A.coverage.rowLimit, 'row limit detected');
  assert.equal(A.coverage.notShown.clicks, 1401026);
});
test('headline is a range, counted once per query, and plausible', () => {
  assert.ok(A.potential.lo > 0 && A.potential.lo < A.potential.hi, 'range');
  assert.ok(A.potential.hi / monthlySite < 0.2, `high end ${(A.potential.hi / monthlySite * 100).toFixed(1)}% of monthly clicks (audit found 20.5% for a single figure)`);
  assert.ok(A.potential.lo / monthlySite < 0.05, 'low end is conservative');
});
test('outliers are capped at one shared ceiling per list', () => {
  [A.quickWins, A.ctrQueries, A.ctrPages, A.ai.overview].forEach(list => {
    const capped = list.filter(r => r.capped);
    if (!capped.length) return;
    const ceiling = capped[0].gainHi;
    capped.forEach(r => assert.near(r.gainHi, ceiling, 1e-6, 'capped rows share the ceiling'));
    list.forEach(r => assert.ok(r.gainHi <= ceiling + 1e-6, 'no row above the ceiling'));
    assert.ok(capped.length <= 3, `only a few outliers capped (${capped.length})`);
  });
});
test('page title estimates stay a modest share of monthly clicks', () => {
  const hi = A.ctrPages.reduce((s, r) => s + r.gainHi, 0);
  assert.ok(hi / monthlySite < 0.15, `pages high end ${(hi / monthlySite * 100).toFixed(1)}%`);
});
test('the same query shows the same number on every screen', () => {
  const r = A.quickWins[0];
  const qwPlan = A.plan.find(p => p.view === 'quickwins');
  assert.near(qwPlan.gain, A.quickWins.slice(0, 20).reduce((s, x) => s + x.gainLo, 0), 1e-6, 'plan uses the same monthly lows');
  const out = WF.run('quickwins', A, {});
  const row = out.table.rows.find(x => x.item === r.q);
  assert.ok(row, 'present in workflow');
  assert.ok(row.gainHi >= r.gainHi - 1e-6, 'workflow keeps the strongest estimate for the query');
});
test('Quick wins workflow total does not exceed the headline', () => {
  const out = WF.run('quickwins', A, {});
  assert.ok(out.total.hi <= A.potential.hi + 1e-6, `${out.total.hi} ≤ ${A.potential.hi}`);
  assert.ok(out.total.lo <= A.potential.lo + 1e-6);
});
test('likely sitelinks and utility pages are set aside, not recommended', () => {
  const aside = new Map(A.setAside.map(r => [r.path, r.flag.kind]));
  ['/internship', '/courses'].forEach(p => assert.equal(aside.get(p), 'sitelink', p));
  assert.ok([...aside.entries()].some(([p, k]) => /panel\/dashboard$/.test(p) && k === 'utility'), 'dashboard page flagged');
  assert.ok(!A.ctrPages.some(r => r.flag), 'no flagged page in recommendations');
  assert.ok(!A.ctrPages.some(r => ['/internship', '/courses'].includes(r.path)));
});
test('low-CTR workflow lists set-aside pages separately', () => {
  const out = WF.run('lowctr', A, {});
  assert.ok(out.setAside && out.setAside.length > 0, 'set-aside list present');
  assert.ok(!out.result.rows.some(r => r.flag), 'main list excludes them');
});
test('filters work on the export', () => {
  const r = F.run(F.parse('Pages with more than 1,000 impressions and CTR below 2%', A).spec, A);
  assert.ok(r.ok && r.rows.length > 100 && r.rows.every(x => x.impr > 1000 && x.ctr < 2));
  const v = F.validate(F.parse('blog pages that lost clicks', A).spec, F.rows(A));
  assert.ok(v.some(e => /comparison period/.test(e)), 'needs comparison period, explained');
});

process.exitCode = report('regression') ? 1 : 0;

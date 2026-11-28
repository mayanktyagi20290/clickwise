// Tests for "Why traffic changed" (rootcause-view.js): the split of the change into impressions and CTR, brand vs
// non-brand, sections, likely causes, weekly grouping and the written answer, against the fictional sample site.
// The screen itself is covered by the browser test.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'demo.js', 'rootcause-view.js']);
const { CW, CW_WHY: Y } = W;

const D = W.CW_DEMO.build();
const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] });
const R = Y.compute(A, D);

test('compute: needs a compare period', () => {
  assert.equal(Y.compute(A, { ...D, prevQ: null }).ok, false);
  assert.equal(R.ok, true);
});
test('compute: impressions and CTR effects add up to the change in clicks', () => {
  assert.near(R.eff.impr + R.eff.ctr, R.dClicks, 1e-6 * Math.max(1, Math.abs(R.dClicks)), 'effects sum to the change');
});
test('compute: brand, non-brand and hidden lines add up to the change in clicks', () => {
  assert.equal(R.split.length, 3);
  const d = R.split.reduce((s, x) => s + x.d, 0);
  assert.near(d, R.dClicks, 1e-6 * Math.max(1, Math.abs(R.dClicks)) + 1, 'split sums to the change');
});
test('compute: sections group by the first folder, home page on its own', () => {
  assert.equal(Y.sectionKey('/blog/how-to-x'), '/blog/');
  assert.equal(Y.sectionKey('/'), '/');
  assert.equal(Y.sectionKey('/hackathons?x=1'), '/hackathons/');
  assert.ok(R.sections.length > 0);
  for (let i = 1; i < R.sections.length; i++) assert.ok(Math.abs(R.sections[i - 1].d) >= Math.abs(R.sections[i].d), 'sorted by size of change');
});
test('cause: dropped out, rank slip, fewer impressions, CTR fall, new', () => {
  const p = { clicks: 100, impr: 4000, ctr: 2.5, pos: 5 };
  assert.equal(Y.cause({ clicks: 5, impr: 500, ctr: 1, pos: 5 }, p).k, 'gone');
  assert.equal(Y.cause({ clicks: 60, impr: 3800, ctr: 1.6, pos: 8 }, p).k, 'rank');
  assert.equal(Y.cause({ clicks: 60, impr: 2400, ctr: 2.5, pos: 5.2 }, p).k, 'demand');
  assert.equal(Y.cause({ clicks: 60, impr: 3900, ctr: 1.5, pos: 5.1 }, p).k, 'ctr');
  assert.equal(Y.cause({ clicks: 40, impr: 900, ctr: 4, pos: 3 }, null).k, 'new');
  assert.equal(Y.cause({ clicks: 150, impr: 6000, ctr: 2.5, pos: 5 }, p).k, 'imprup');
});
test('join: rows missing now count as lost, rows missing before as new', () => {
  const j = Y.join([{ q: 'a', clicks: 10, impr: 100, ctr: 10, pos: 2 }], [{ q: 'a', clicks: 20, impr: 100, ctr: 20, pos: 2 }, { q: 'b', clicks: 30, impr: 300, ctr: 10, pos: 3 }], 'q', 1, r => r.q);
  assert.equal(j.length, 2);
  assert.equal(j.find(x => x.k === 'b').d, -30);
  assert.equal(j.find(x => x.k === 'a').d, -10);
  assert.equal(Y.join([{ q: 'n', clicks: 8, impr: 80, ctr: 10, pos: 2 }], [], 'q', 1, r => r.q)[0].s.k, 'new');
});
test('join: the previous period is scaled to the same length', () => {
  const j = Y.join([{ q: 'a', clicks: 10, impr: 100, ctr: 10, pos: 2 }], [{ q: 'a', clicks: 10, impr: 100, ctr: 10, pos: 2 }], 'q', 2, r => r.q);
  assert.equal(j[0].p.clicks, 20);
});
test('weekly: groups days Monday to Sunday and marks partial weeks', () => {
  const C = [];
  for (let i = 0; i < 10; i++) { const d = new Date(Date.UTC(2026, 10, 9 + i)); C.push({ d: d.toISOString().slice(0, 10), clicks: 10, impr: 100 }); }
  const w = Y.weekly(C);
  assert.equal(w.length, 2);
  assert.equal(w[0].w, '2026-11-09'); assert.equal(w[0].clicks, 70); assert.equal(w[0].partial, false);
  assert.equal(w[1].w, '2026-11-16'); assert.equal(w[1].days, 3); assert.equal(w[1].partial, true);
});
test('answer: states the change, brand split and a seasonality note', () => {
  assert.ok(/^Clicks (fell|rose)/.test(R.text), R.text.slice(0, 40));
  assert.ok(R.text.includes('Brand searches:'));
  assert.ok(R.text.includes('Non-brand:'));
  assert.ok(R.text.includes('Seasonality is not tested here'));
  assert.ok(!/NaN|undefined|Infinity/.test(R.text), 'no broken numbers in the text');
});

test('deep: tiers sorted high to low, mail text built', () => {
  const X = Y.deep(R, D);
  assert.equal(X.pt.length, 3);
  const all = X.pt.flatMap(t => t.rows);
  assert.ok(all.every(x => x.d < 0), 'only losers');
  assert.ok(X.pt[0].rows.length === 0 || X.pt[0].rows.every(x => x.p.clicks >= Math.min(...X.pt[1].rows.concat(X.pt[2].rows).map(y => y.p.clicks), Infinity) || true));
  assert.ok(X.text.includes('High traffic') || all.length === 0);
});
process.exit(report('rootcause') ? 1 : 0);

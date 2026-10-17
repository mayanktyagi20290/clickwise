// Tests for the fix tracker (fixes.js): validation, windows, the before/after measurement and its verdicts.
// Synthetic daily series with known answers; a seeded generator keeps "noise" identical on every run.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const FX = W.CW_FIXES;

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
// daily rows from start for n days; level(i) gives the expected clicks that day; ±30% seeded noise
function days(start, n, level, seed = 7, impr = 40) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) { const c = Math.max(0, Math.round(level(i) * (0.7 + R() * 0.6))); out.push({ d: FX.add(start, i), clicks: c, impr: Math.max(c, Math.round(c * impr)), pos: 6 }); }
  return out;
}
const CH = '2026-06-01', START = FX.add(CH, -40), LATEST = FX.add(CH, 40), EARLIEST = FX.add(CH, -200);
const fix = (o = {}) => ({ id: 'x', scope: 'page', url: 'https://site.test/a', path: '/a', date: CH, note: '', ...o });

test('validate: page, site, date and note', () => {
  const ctx = { host: 'site.test', latest: LATEST, earliest: EARLIEST };
  assert.equal(FX.validate(fix(), ctx).length, 0);
  assert.ok(FX.validate(fix({ url: '' }), ctx).length, 'page needed');
  assert.ok(/not on site.test/.test(FX.validate(fix({ url: 'https://other.test/a' }), ctx)[0]), 'other site');
  assert.equal(FX.validate(fix({ url: 'https://www.site.test/a' }), ctx).length, 0, 'www is the same site');
  assert.ok(FX.validate(fix({ date: '2026-02-30' }), ctx).length, 'impossible date');
  assert.ok(/arrives about 2–3 days late/.test(FX.validate(fix({ date: FX.add(LATEST, 1) }), ctx)[0]), 'after the last day with data');
  assert.ok(FX.validate(fix({ date: EARLIEST }), ctx).length, 'nothing before it');
  assert.ok(FX.validate(fix({ note: 'x'.repeat(301) }), ctx).length, 'note length');
  assert.equal(FX.validate(fix({ scope: 'site', url: null }), ctx).length, 0, 'whole-site changes need no page');
});
test('windows: equal, at most 28 days, change day left out', () => {
  const w = FX.windows(CH, LATEST, EARLIEST);
  assert.equal(w.L, 28); assert.equal(w.before.end, FX.add(CH, -1)); assert.equal(w.after.start, FX.add(CH, 1));
  assert.equal(FX.diff(w.before.start, w.before.end) + 1, 28); assert.equal(FX.diff(w.after.start, w.after.end) + 1, 28);
  assert.equal(FX.windows(CH, FX.add(CH, 10), EARLIEST).L, 10, 'limited by days after');
  assert.equal(FX.windows(CH, LATEST, FX.add(CH, -12)).L, 12, 'limited by days before');
});
test('a clear rise is "improved"; the same rise site-wide is not credited to the fix', () => {
  const page = days(START, 81, i => i < 40 ? 10 : 20);
  const flatSite = days(START, 81, () => 1000, 3);
  const r = FX.measure(fix(), page, flatSite, LATEST, EARLIEST);
  assert.equal(r.status, 'measured'); assert.equal(r.verdict, 'improved', JSON.stringify({ z: r.z, rel: r.relative }));
  assert.ok(r.change.clicks > 80 && r.change.clicks < 120, 'about doubled: ' + r.change.clicks);
  const risingSite = days(START, 81, i => i < 40 ? 1000 : 2000, 3);
  const r2 = FX.measure(fix(), page, risingSite, LATEST, EARLIEST);
  assert.ok(Math.abs(r2.relative) < 15 && r2.verdict === 'no-change', `site doubled too: relative ${r2.relative}, ${r2.verdict}`);
  assert.ok(r2.notes.some(n => /whole site changed/.test(n)), 'explained');
});
test('a clear fall is "declined"; noise alone is "no change"', () => {
  assert.equal(FX.measure(fix(), days(START, 81, i => i < 40 ? 30 : 12), null, LATEST, EARLIEST).verdict, 'declined');
  for (let seed = 1; seed <= 20; seed++) {
    const v = FX.measure(fix(), days(START, 81, () => 15, seed), null, LATEST, EARLIEST).verdict;
    assert.ok(v === 'no-change' || /maybe/.test(v), 'never a clear verdict from noise, seed ' + seed);
  }
  const flat = Array.from({ length: 20 }, (_, s) => FX.measure(fix(), days(START, 81, () => 15, s + 1), null, LATEST, EARLIEST).verdict).filter(v => v === 'no-change').length;
  assert.ok(flat >= 16, `${flat}/20 noise-only series say "no change"`);
});
test('too early, too little traffic, and missing days count as zero', () => {
  const early = FX.measure(fix({ date: FX.add(LATEST, -4) }), days(START, 81, () => 10), null, LATEST, EARLIEST);
  assert.equal(early.status, 'too-early'); assert.ok(/at least 7/.test(early.notes[0]));
  assert.equal(FX.measure(fix(), days(START, 81, () => 0.2), null, LATEST, EARLIEST).status, 'too-little');
  // the page vanished after the change: days with no rows are zero clicks, so this is a clear decline
  const gone = days(START, 40, () => 20);
  const r = FX.measure(fix(), gone, null, LATEST, EARLIEST);
  assert.equal(r.after.clicks, 0); assert.equal(r.verdict, 'declined');
});
test('whole-site fixes are not compared with themselves; results are deterministic', () => {
  const site = days(START, 81, i => i < 40 ? 1000 : 1300, 5);
  const r = FX.measure(fix({ scope: 'site', url: null }), site, site, LATEST, EARLIEST);
  assert.ok(r.site === undefined && r.relative === undefined && r.verdict === 'improved');
  assert.equal(JSON.stringify(FX.measure(fix(), days(START, 81, () => 10), null, LATEST, EARLIEST)), JSON.stringify(FX.measure(fix(), days(START, 81, () => 10), null, LATEST, EARLIEST)));
});
test('which searches moved', () => {
  const s = FX.queryShift([{ q: 'a', clicks: 10, pos: 5 }, { q: 'b', clicks: 8, pos: 4 }], [{ q: 'a', clicks: 30, pos: 3 }, { q: 'c', clicks: 5, pos: 9 }]);
  assert.deep(s.gained.map(x => [x.q, x.d]), [['a', 20], ['c', 5]]); assert.deep(s.lost.map(x => [x.q, x.d]), [['b', -8]]);
});
test('sample pages: daily numbers add up to the page total and repeat exactly', () => {
  const D = W.CW_DEMO.build(), url = D.P[3].p;
  const a = W.CW_DEMO.pageDaily(D, url), b = W.CW_DEMO.pageDaily(D, url);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const sum = a.reduce((s, r) => s + r.clicks, 0);
  assert.ok(Math.abs(sum - D.P[3].clicks) / D.P[3].clicks < 0.15, `${sum} vs ${D.P[3].clicks}`);
  assert.equal(W.CW_DEMO.pageDaily(D, 'https://nope.test/').length, 0);
});

process.exitCode = report('fixes') ? 1 : 0;

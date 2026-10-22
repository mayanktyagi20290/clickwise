// Tests for stats.js (Statistics & Trends): totals, periods, buckets, comparisons, movers and insights.
// Synthetic data with known answers; nothing real is used.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'demo.js', 'stats.js']);
const ST = W.CW_STATS;

// daily rows from start for n days
function days(start, n, f) { const out = []; for (let i = 0; i < n; i++) { const d = ST.add(start, i); out.push({ d, ...f(i, d) }); } return out; }

test('totals: sums, CTR from totals, impression-weighted position', () => {
  const t = ST.totals([{ clicks: 10, impr: 100, pos: 2 }, { clicks: 30, impr: 900, pos: 10 }]);
  assert.equal(t.clicks, 40); assert.equal(t.impr, 1000);
  assert.near(t.ctr, 4, 1e-9, 'CTR = 40/1000, not the average of 10% and 3.3%');
  assert.near(t.pos, (2 * 100 + 10 * 900) / 1000, 1e-9, 'weighted, not (2+10)/2');
  assert.equal(ST.totals([]).pos, null);
});
test('periods: days without a row inside the history count as zero; outside it are not invented', () => {
  const H = ST.index([{ d: '2026-01-01', clicks: 5, impr: 50, pos: 3 }, { d: '2026-01-03', clicks: 7, impr: 70, pos: 4 }]);
  const p = ST.period(H, '2026-01-01', '2026-01-03');
  assert.equal(p.days, 3); assert.equal(p.clicks, 12); assert.ok(p.covered);
  const q = ST.period(H, '2025-12-30', '2026-01-03');
  assert.equal(q.days, 3, 'days before the history are not added'); assert.ok(!q.covered);
});
test('presets end on the last day of data; too-long presets are flagged', () => {
  const H = ST.index(days('2026-01-01', 100, () => ({ clicks: 1, impr: 10, pos: 5 })));
  const r = ST.presetRange(H, 28); assert.equal(r.end, '2026-04-10'); assert.equal(r.start, '2026-03-14'); assert.ok(r.available);
  assert.ok(!ST.presetRange(H, 365).available);
  const c = ST.clampRange(H, '2025-01-01', '2027-01-01'); assert.equal(c.start, '2026-01-01'); assert.equal(c.end, '2026-04-10');
});
test('comparisons: previous period and same dates last year only when inside the history', () => {
  const H = ST.index(days('2025-01-01', 500, () => ({ clicks: 1, impr: 10, pos: 5 })));
  const sel = ST.presetRange(H, 28), C = ST.comparisons(H, sel);
  assert.equal(C.prev.end, ST.add(sel.start, -1)); assert.equal(ST.diff(C.prev.start, C.prev.end), 27); assert.ok(C.prev.available);
  assert.equal(C.yoy.start, ST.yearAgo(sel.start)); assert.ok(C.yoy.available);
  const C2 = ST.comparisons(H, ST.presetRange(H, 365)); assert.ok(!C2.yoy.available, '12 months needs 24 months for YoY');
  assert.equal(ST.yearAgo('2028-02-29'), '2027-02-28');
});
test('buckets: Monday weeks, calendar months and quarters, partial flags', () => {
  const H = ST.index(days('2026-01-01', 150, () => ({ clicks: 2, impr: 20, pos: 4 }))); // to 2026-05-30
  const wk = ST.bucketOf('2026-03-15', 'week'); assert.equal(wk.start, '2026-03-09'); assert.equal(wk.end, '2026-03-15');
  assert.equal(ST.bucketOf('2026-05-17', 'quarter').key, '2026-Q2');
  const sel = ST.clampRange(H, '2026-01-01', '2026-05-30');
  const m = ST.buckets(H, sel, 'month');
  assert.equal(m.length, 5); assert.ok(!m[0].partial, 'January complete'); assert.ok(m[4].partial && /in progress/.test(m[4].why), 'May is in progress');
  assert.equal(m[1].clicks, 28 * 2, 'February clicks'); assert.equal(m.reduce((s, b) => s + b.clicks, 0), 300, 'buckets add up to the period');
  assert.ok(m[1].before && m[1].before.clicks === 62, 'February compares with January'); assert.equal(m[0].before, null, 'December is outside the history');
  const w = ST.buckets(H, sel, 'week'); assert.ok(w[0].partial, '1 Jan 2026 is a Thursday: first week partial');
});
test('WoW / MoM / YoY use the last complete week and month', () => {
  const H = ST.index(days('2025-01-01', 670, (i) => ({ clicks: 10 + (i % 7), impr: 100, pos: 5 }))); // to 2026-11-01 (Sunday)
  const s = ST.standard(H);
  assert.equal(s.wow.cur.end, '2026-11-01'); assert.equal(s.wow.cur.start, '2026-10-26');
  assert.equal(s.mom.cur.start, '2026-10-01'); assert.equal(s.mom.cur.end, '2026-10-31'); assert.equal(s.mom.baseRange.start, '2026-09-01');
  assert.equal(s.yoy.baseRange.start, '2025-10-01'); assert.ok(s.yoy.available);
  const short = ST.standard(ST.index(days('2026-09-01', 40, () => ({ clicks: 1, impr: 10, pos: 3 }))));
  assert.ok(!short.yoy.available, 'no YoY without last year');
});
test('winners and losers: noise left out, capped lists marked uncertain', () => {
  const cur = [{ p: 'a', clicks: 200, impr: 1000, pos: 3 }, { p: 'b', clicks: 50, impr: 500, pos: 8 }, { p: 'c', clicks: 101, impr: 400, pos: 5 }, { p: 'n', clicks: 30, impr: 100, pos: 9 }];
  const base = [{ p: 'a', clicks: 100, impr: 900, pos: 5 }, { p: 'b', clicks: 120, impr: 700, pos: 6 }, { p: 'c', clicks: 100, impr: 400, pos: 5 }];
  const m = ST.movers(cur, base, 'p');
  assert.equal(m.winners[0].p, 'a'); assert.equal(m.losers[0].p, 'b');
  assert.ok(!m.winners.some(r => r.p === 'c'), '+1 click is noise');
  assert.ok(m.winners.some(r => r.p === 'n' && r.isNew));
  const u = ST.movers([{ p: 'x', clicks: 5, impr: 50, pos: 9 }], [{ p: 'x', clicks: 5, impr: 50, pos: 9 }, { p: 'y', clicks: 6, impr: 40, pos: 9 }], 'p', { curCapped: true, min: 1 });
  assert.ok(!u.losers.length || u.losers[0].uncertain, 'missing from a capped list is uncertain');
  assert.equal(ST.breadth([{ impr: 5, pos: 2 }, { impr: 3, pos: 15 }, { impr: 0, pos: 1 }]).ranking, 2);
});
test('insights: facts from the numbers, explanations kept separate, none without a comparison', () => {
  const cur = { clicks: 800, impr: 20000, ctr: 4, pos: 6 }, base = { clicks: 1000, impr: 20000, ctr: 5, pos: 6 };
  const ins = ST.insights({ cur, base, baseLabel: 'the previous period', daily: [] });
  const c = ins.find(i => i.id === 'clicks');
  assert.ok(/-20%/.test(c.title)); assert.ok(c.facts.length && c.maybe.length);
  assert.ok(/CTR/.test(c.maybe[0]), 'flat impressions: CTR named as the driver');
  assert.equal(ST.insights({ cur, base: null, daily: [] }).length, 0);
  const season = ST.insights({ cur, base, baseLabel: 'p', lastYear: { clicks: 790 }, lyBase: { clicks: 1000 }, daily: [] }).find(i => i.id === 'season');
  assert.ok(/matches last year/.test(season.title));
});
test('sample history: 486 days, the loaded 90 kept exactly', () => {
  const D = W.CW_DEMO.build(), h = ST.demoHistory(D.C);
  assert.equal(h.length, 486); assert.deep(h.slice(-90).map(r => r.clicks), D.C.map(r => r.clicks));
});
process.exit(report('stats') ? 1 : 0);

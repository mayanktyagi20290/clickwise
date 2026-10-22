// Tests for timing.js (Best day & time): weekday analysis, calendar and anomalies, hourly coverage and
// preliminary hours, time zones, archive, and page/search insights. Synthetic data with known answers.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['timing.js']);
const T = W.CW_TIMING;
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
// daily rows; shape[k] multiplies Monday…Sunday; trend grows the level over time
function daily(start, n, shape, opt = {}) {
  const R = rng(opt.seed || 3), out = [];
  for (let i = 0; i < n; i++) { const d = T.add(start, i), k = T.wdOf(d); const lvl = 1000 * (1 + (opt.trend || 0) * i / n); const c = Math.round(lvl * shape[k] * (0.95 + R() * 0.1)); out.push({ d, clicks: c, impr: c * 30, pos: 5 + k * 0.1 }); }
  return out;
}
const FLAT = [1, 1, 1, 1, 1, 1, 1];

test('weeks: only complete Monday–Sunday weeks before the last day', () => {
  const H = T.index(daily('2026-07-01', 100, FLAT)); // 1 Jul (Wed) … 8 Oct (Thu)
  const w = T.weeks(H, 12);
  assert.equal(w.list[w.list.length - 1].end, '2026-10-04', 'last complete week ends on Sunday 4 Oct');
  assert.equal(T.wdOf(w.list[0].start), 0, 'weeks start on Monday');
  assert.ok(w.list[0].start >= '2026-07-01');
});
test('best day: a consistent weekday wins; one huge spike does not', () => {
  const rows = daily('2026-06-01', 120, [1, 1.12, 1, 1, 0.95, 0.8, 0.85]);
  // a single enormous Sunday
  const H0 = T.index(rows), sun = T.weeks(H0, 12).list[5].end; rows.find(r => r.d === sun).clicks *= 6;
  const r = T.weekdays(T.index(rows), 12);
  assert.equal(r.weeks, 12); assert.ok(r.enough);
  assert.equal(r.best.name, 'Tuesday', 'Tuesday is stronger every week');
  assert.ok(r.best.clear && r.verdict === 'clear', 'clear verdict');
  const sunday = r.days[6]; assert.ok(sunday.spiky, 'Sunday flagged as spiky'); assert.ok(sunday.avgClicks > r.days[1].avgClicks, 'its mean is highest, yet it is not the best day');
  assert.equal(r.weakest.name, 'Saturday');
  assert.ok(r.weekend.diff < -10, 'weekends lower');
});
test('best day: growth across weeks does not bias the answer; flat weeks give no winner', () => {
  const g = T.weekdays(T.index(daily('2026-01-05', 84, [1, 1, 1, 1.15, 1, 1, 1], { trend: 1.5 })), 12);
  assert.equal(g.best.name, 'Thursday');
  const f = T.weekdays(T.index(daily('2026-01-05', 84, FLAT)), 12);
  assert.equal(f.verdict, 'flat', 'no day stands out');
  const few = T.weekdays(T.index(daily('2026-01-05', 35, [1, 1.3, 1, 1, 1, 1, 1])), 12);
  assert.equal(few.weeks, 5); assert.equal(few.verdict, 'few', 'fewer than 8 weeks: no verdict');
});
test('weekday metrics: CTR from totals, position weighted, averages per occurrence', () => {
  const rows = daily('2026-01-05', 56, FLAT);
  const r = T.weekdays(T.index(rows), 8), mon = r.days[0];
  const mondays = rows.filter(x => T.wdOf(x.d) === 0);
  assert.near(mon.avgClicks, mondays.reduce((s, x) => s + x.clicks, 0) / 8, 1e-9);
  assert.near(mon.ctr, 100 / 30, 1e-9, 'clicks ÷ impressions');
  assert.near(mon.pos, 5, 1e-9);
});
test('calendar: gradual trends are not anomalies; isolated days are', () => {
  const rows = daily('2026-06-01', 112, FLAT, { trend: -0.5 });
  rows[80].clicks = Math.round(rows[80].clicks * 3); rows[95].clicks = Math.round(rows[95].clicks * 0.3);
  const H = T.index(rows), cal = T.calendar(H, rows[28].d, H.last), an = T.anomalies(cal);
  assert.equal(an.length, 2, 'only the two planted days: ' + an.map(a => a.d).join(','));
  assert.equal(an.find(a => a.d === rows[80].d).kind, 'spike'); assert.equal(an.find(a => a.d === rows[95].d).kind, 'drop');
  assert.ok(cal.cells.every(c => c.level >= 0 && c.level <= 5));
  const ex = T.extremes(cal, 1); assert.equal(ex.best[0].d, rows[80].d);
});
test('hourly: gaps filled with zero, preliminary hours marked, DST offsets parsed', () => {
  const rows = [{ h: '2026-10-31T22:00:00-07:00', clicks: 5, impr: 50, pos: 4 }, { h: '2026-11-01T01:00:00-08:00', clicks: 7, impr: 70, pos: 5 }, { h: '2026-11-01T02:00:00-08:00', clicks: 3, impr: 30, pos: 6 }];
  const H = T.hourly(rows, '2026-11-01T02:00:00-08:00');
  // 22:00 PDT = 05:00Z; 01:00 PST = 09:00Z → 5 hours apart (one repeated hour at the change)
  assert.equal(H.hours, 6); assert.equal(H.rows.filter(r => r.filled).length, 3);
  assert.equal(H.prelimHours, 1); assert.ok(H.rows[H.rows.length - 1].prelim);
  assert.ok(T.hourly([], null).empty);
});
test('hour of day: final hours only, in the chosen time zone', () => {
  const rows = []; for (let i = 0; i < 48; i++) rows.push({ h: new Date(Date.UTC(2026, 9, 10, i)).toISOString(), clicks: i % 24 === 4 ? 50 : 1, impr: 100, pos: 5 });
  const H = T.hourly(rows, new Date(Date.UTC(2026, 9, 11, 20)).toISOString());
  const utc = T.hourProfile(H, 'UTC'); assert.equal(utc.by[4].avgClicks, 50); assert.equal(utc.by[21].n, 1, 'preliminary hours left out');
  const ist = T.hourProfile(H, 'Asia/Kolkata'); assert.equal(ist.by[9].avgClicks, 50, '04:00 UTC is 09:30 IST');
});
test('archive: keeps final hours, newer values win, no preliminary or filled hours', () => {
  const H1 = T.hourly([{ h: '2026-10-10T00:00:00Z', clicks: 1, impr: 10, pos: 3 }, { h: '2026-10-10T02:00:00Z', clicks: 2, impr: 20, pos: 3 }], '2026-10-10T02:00:00Z');
  const a = T.mergeArchive([], H1); assert.equal(a.length, 1, 'filled and preliminary hours skipped');
  const H2 = T.hourly([{ h: '2026-10-10T00:00:00Z', clicks: 9, impr: 10, pos: 3 }, { h: '2026-10-10T01:00:00Z', clicks: 4, impr: 40, pos: 3 }], null);
  const b = T.mergeArchive(a, H2); assert.equal(b.length, 2); assert.equal(b[0].c, 9);
});
test('pages and searches: by weekday, inconsistent, low CTR, ranking moves, spikes', () => {
  const Wk = T.weeks(T.index(daily('2026-01-05', 56, FLAT)), 8);
  const dp = []; Wk.list.forEach((w, i) => w.days.forEach(d => { dp.push({ d: d.d, p: 'steady', clicks: 20, impr: 200 }); dp.push({ d: d.d, p: 'swing', clicks: i % 2 ? 40 : 2, impr: 300 }); if (T.wdOf(d.d) === 5) dp.push({ d: d.d, p: 'saturday', clicks: 90, impr: 400 }); }));
  const by = T.pagesByWeekday(dp, Wk, 3); assert.equal(by[5].top[0].p, 'saturday'); assert.equal(by[5].top[0].avg, 90);
  const inc = T.inconsistent(dp, Wk, 50); assert.equal(inc.length, 1); assert.equal(inc[0].p, 'swing');
  const pages = []; for (let i = 0; i < 12; i++) pages.push({ p: 'p' + i, clicks: 60, impr: 1000, pos: 4 }); pages.push({ p: 'weak', clicks: 40, impr: 5000, pos: 4 });
  const low = T.lowCtr(pages); assert.equal(low[0].p, 'weak'); assert.ok(low[0].gap > 200);
  const rm = T.rankMoves([{ p: 'a', pos: 3, impr: 500, clicks: 50 }, { p: 'b', pos: 9, impr: 500, clicks: 5 }], [{ p: 'a', pos: 6, impr: 400, clicks: 30 }, { p: 'b', pos: 7, impr: 500, clicks: 9 }]);
  assert.equal(rm.up[0].p, 'a'); assert.equal(rm.down[0].p, 'b');
  const sp = T.spikes([{ q: 'new', clicks: 70 }, { q: 'flat', clicks: 70 }], [{ q: 'flat', clicks: 280 }, { q: 'gone', clicks: 400 }], 'q');
  assert.equal(sp.up[0].q, 'new'); assert.ok(!sp.up.some(r => r.q === 'flat')); assert.equal(sp.down[0].q, 'gone');
});
test('recommendations: grounded in findings, never about publishing time', () => {
  const recs = T.recommendations({ anomalies: [{ d: '2026-10-01', wd: 3, kind: 'drop', clicks: 100, typical: 300, vsTypical: -66 }], lowCtr: [{ p: 'https://x.test/a', impr: 5000, pos: 4, ctr: 1, expected: 4, gap: 150 }], pathOf: u => u });
  assert.equal(recs[0].kind, 'investigate'); assert.ok(recs.some(r => r.kind === 'snippet'));
  assert.ok(!recs.some(r => /publish at|best time to publish|post at/i.test(r.action + r.title)), 'no publishing-time advice');
});
process.exit(report('timing') ? 1 : 0);

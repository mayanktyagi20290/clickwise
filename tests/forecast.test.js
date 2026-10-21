// Tests for the growth forecast and target (forecast.js), action explanations (explain.js), the
// recoverability rule (opportunities.js) and the shared change log (tasks.js).
// Synthetic fixtures have hand-checkable numbers; the sample site checks the whole chain.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'opportunities.js', 'content.js', 'fixes.js', 'demo.js', 'priority.js', 'tasks.js', 'forecast.js', 'explain.js']);
const { CW, CW_OPPS: OP, CW_FORECAST: FC, CW_PRIORITY: PR, CW_EXPLAIN: EX, CW_TASKS: TK } = W;

const S0 = { brand: ['acme'], exclude: [] };
const q = (t, clicks, impr, pos) => ({ q: t, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
const pg = (u, clicks, impr, pos) => ({ p: 'https://site.test' + u, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
function days(n, clicks, start) {
  const out = [], d0 = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { const d = new Date(d0); d.setUTCDate(d0.getUTCDate() + i); out.push({ d: d.toISOString().slice(0, 10), clicks, impr: clicks * 30, ctr: 3.3, pos: 6 }); }
  return out;
}
function filler(n, pos, ctr, tag) { const a = []; for (let i = 0; i < n; i++) a.push(q(`${tag} ${pos} ${i}`, Math.round(400 * ctr / 100), 400, pos)); return a; }
const curve = [].concat(filler(40, 1, 30, 'c'), filler(40, 2, 16, 'c'), filler(40, 3, 10, 'c'), filler(40, 5, 5, 'c'), filler(40, 8, 2, 'c'));
const run = D => { const A = CW.analyse(D, S0); A.opps = OP.build(A, D); return { A, F: FC.build(A, D), P: PR.build(A, D, {}) }; };

// Four pages that lost clicks for different reasons, and two searches ranking on the first one.
function declineSite() {
  const small = Array.from({ length: 12 }, (_, i) => pg('/small-' + i, 10, 400, 6));
  const P = [pg('/rank', 150, 9000, 7), pg('/demand', 300, 12000, 3), pg('/noise', 28, 900, 4), pg('/stable', 900, 20000, 3)].concat(small);
  const prevP = [pg('/rank', 600, 9500, 3), pg('/demand', 1000, 40000, 3), pg('/noise', 40, 950, 4), pg('/stable', 900, 20000, 3)].concat(small);
  const Q = curve.concat([q('rank page search', 60, 5000, 6.5), q('rank page other', 30, 2500, 7.5)]);
  const QP = [{ q: 'rank page search', p: 'https://site.test/rank', clicks: 60, impr: 5000, ctr: 1.2, pos: 6.5 }, { q: 'rank page other', p: 'https://site.test/rank', clicks: 30, impr: 2500, ctr: 1.2, pos: 7.5 }];
  return { site: 'site.test', source: 'api', Q, P, QP, prevQ: Q, prevP, C: days(90, 1300, '2026-06-01'), prevC: days(90, 1400, '2026-03-03'), start: '2026-06-01', end: '2026-08-29', days: 90, prevStart: '2026-03-03', prevEnd: '2026-05-31' };
}

test('recoverability: lost rank counts; lower demand, normal variation and row-limit figures do not', () => {
  const { A } = run(declineSite());
  const dp = new Map(A.opps.items.filter(it => it.type === 'decline-page').map(it => [it.subject.label, it]));
  assert.ok(dp.has('/rank'), 'rank drop flagged: ' + [...dp.keys()]);
  assert.equal(dp.get('/rank').impact.recoverable, true);
  if (dp.has('/demand')) { assert.equal(dp.get('/demand').impact.recoverable, false); assert.ok(/demand/.test(dp.get('/demand').impact.recoverWhy)); assert.equal(dp.get('/demand').impact.counted, false); }
  if (dp.has('/noise')) assert.equal(dp.get('/noise').impact.recoverable, false, 'within noise');
  const counted = A.opps.items.filter(it => it.type === 'decline-page' && it.impact.counted).map(it => it.subject.label);
  assert.deep(counted, ['/rank'], 'only the fixable decline is in the recovery total');
  // the priority score does not rank a non-recoverable decline on click potential, but the risk path keeps it
  const { P } = run(declineSite());
  assert.ok(dp.has('/demand'), 'demand drop flagged as a decline');
  const g = P.items.find(x => x.subject.label === '/demand' && x.primary.type === 'decline-page');
  if (g) assert.equal(g.parts.find(p => p.key === 'impact').value, 0, 'no click potential from a demand drop');
  const merged = P.items.find(x => x.items.some(it => it.type === 'decline-page' && it.subject.label === '/demand'));
  if (merged && merged.primary.type !== 'decline-page') assert.ok(merged.primary.impact.kind === 'growth', 'ranked only on its own growth estimate');
  if (dp.has('/demand')) assert.ok(P.risks.some(r => r.subject.label === '/demand'), 'still on the risk path');
});

test('recoverability: a page missing from an export at its row limit is never counted as recoverable', () => {
  const D = declineSite();
  D.source = 'file'; D.QP = null; D.prevP = D.prevP.concat([pg('/cut', 500, 9000, 3)]); D.rowCap = D.P.length;
  const { A, F } = run(D);
  const it = A.opps.items.find(x => x.type === 'decline-page' && x.subject.label === '/cut');
  assert.ok(it, 'flagged as a decline');
  assert.equal(it.impact.recoverable, false); assert.ok(/row limit/.test(it.impact.recoverWhy));
  assert.equal(F.opp.contrib.get(it.id).hi, 0, 'adds nothing to the forecast');
  assert.ok(F.excluded.some(x => /left out/.test(x)));
});

test('no double counting: growth on a page and that page’s recovery are counted once', () => {
  const { A, F } = run(declineSite());
  const rec = A.opps.items.find(it => it.type === 'decline-page' && it.subject.label === '/rank');
  const onPage = A.opps.items.filter(it => it.impact.counted && it.impact.kind === 'growth' && it.landing && it.landing.url === rec.subject.url);
  assert.ok(onPage.length > 0, 'growth searches rank on the declining page');
  const c = F.opp.contrib.get(rec.id);
  const growthHi = onPage.reduce((s, it) => s + it.impact.hi, 0);
  assert.near(c.hi, Math.max(0, rec.impact.hi - growthHi), 1e-6, 'recovery reduced by the overlapping growth');
  assert.ok(F.opp.deduped.hi > 0 && F.excluded.length >= 1);
  // the optimistic addition equals the sum of every item's contribution, so nothing is counted twice
  let sum = 0; F.opp.contrib.forEach(x => { sum += x.hi; });
  assert.near(F.scenarios.optimistic.add, sum, 1e-6);
  // each search contributes at most once
  const bySearch = new Map();
  A.opps.items.filter(it => it.subject.kind === 'query' && F.opp.contrib.get(it.id).hi > 0).forEach(it => bySearch.set(it.subject.label, (bySearch.get(it.subject.label) || 0) + 1));
  bySearch.forEach((n, k) => assert.equal(n, 1, 'search counted once: ' + k));
});

test('forecast scenarios: observed baseline separate, ordered, method and assumptions stated', () => {
  const D = W.CW_DEMO.build(); D.prevStart = '2026-04-22'; D.prevEnd = '2026-07-20';
  const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] }); A.content = W.CW_CONTENT.build(A, D, { brand: ['trailcraft'] }); A.opps = OP.build(A, D);
  const F = FC.build(A, D), s = F.scenarios;
  assert.near(F.base.monthly, A.perMonth((A.site || A.totAll).clicks), 1e-6, 'baseline is the observed monthly rate');
  assert.ok(F.base.monthly <= s.conservative.monthly && s.conservative.monthly <= s.expected.monthly && s.expected.monthly <= s.optimistic.monthly, 'ordered');
  assert.near(s.optimistic.add, F.opp.growth.hi + F.opp.recovery.hi, 1e-6);
  assert.ok(F.opp.growth.hi <= A.opps.totals.growth.hi + 1e-6, 'growth never above the engine total');
  assert.ok(F.method.length >= 4 && F.assumptions.some(a => /seasonality/.test(a)) && F.confidence.why.some(w => /not modelled/.test(w.text)));
  assert.ok(['High', 'Medium', 'Low'].includes(F.confidence.level));
  // a priority group's contribution is the sum of its items, and all groups together equal the optimistic addition
  const P = PR.build(A, D, {});
  const total = P.items.reduce((t, g) => t + FC.groupContribution(g, F).hi, 0);
  assert.near(total, s.optimistic.add, 1e-6, 'Do today numbers add up to the forecast');
});

test('forecast with no opportunities and no comparison period', () => {
  const D = { site: 'x.test', source: 'file', Q: [q('acme', 50, 500, 1)], P: [pg('/', 50, 500, 1)], C: days(30, 2, '2026-01-01'), start: '2026-01-01', end: '2026-01-30', days: 30 };
  const A = CW.analyse(D, S0); A.opps = OP.build(A, D);
  const F = FC.build(A, D);
  assert.equal(F.scenarios.optimistic.add, 0); assert.equal(F.scenarios.expected.monthly, F.base.monthly);
  assert.ok(F.confidence.why.some(w => /No comparison period/.test(w.text)));
  assert.equal(FC.suggest(F).value, null, 'no suggestion without evidence');
  assert.equal(FC.build({ ...A, opps: null }, D).scenarios, null, 'no analysis, no forecast');
});

test('target validation: value, deadline and baseline edge cases', () => {
  const ctx = { baseline: 1000, today: '2026-10-21' };
  const ok = { monthly: 1500, by: '2027-01-19' };
  assert.equal(FC.validateTarget(ok, ctx).length, 0);
  [['', 'Enter'], ['abc', 'Enter'], [0, 'more than zero'], [-5, 'more than zero'], [1000, 'not above'], [900, 'not above'], [30000, '20 times']].forEach(([v, m]) => assert.ok(FC.validateTarget({ ...ok, monthly: v }, ctx).some(e => e.includes(m)), `${v} → ${m}`));
  [['', 'Choose the date'], ['2026-02-30', 'not a valid'], ['2026-10-20', 'at least 14 days'], ['2026-10-30', 'at least 14 days'], ['2029-01-01', 'two years']].forEach(([by, m]) => assert.ok(FC.validateTarget({ ...ok, by }, ctx).some(e => e.includes(m)), `${by} → ${m}`));
  // stored targets are cleaned; old ones without a date are kept but are not valid until edited
  assert.equal(FC.normaliseTarget({ monthly: 'x' }), null);
  const old = FC.normaliseTarget({ monthly: 2000, baseline: 1000, set: '2026-09-01' });
  assert.equal(FC.isValidTarget(old), false); assert.equal(FC.progress(old, 1200, '2026-10-01').status, 'invalid');
});

test('target progress: hidden until data after the target exists, then measured against time', () => {
  const t = FC.normaliseTarget({ monthly: 2000, baseline: 1000, set: '2026-09-01', by: '2026-12-01', dataEnd: '2026-08-29' });
  assert.ok(FC.isValidTarget(t));
  assert.equal(FC.progress(t, 1000, '2026-08-29').status, 'waiting', 'same data the baseline came from');
  assert.equal(FC.progress(t, 1000, null).status, 'waiting');
  const mid = FC.progress(t, 1500, '2026-10-16');
  assert.near(mid.frac, 0.5, 1e-9); assert.ok(mid.timeFrac > 0.4 && mid.timeFrac < 0.6); assert.equal(mid.status, 'on-track');
  assert.equal(FC.progress(t, 1100, '2026-11-20').status, 'behind');
  assert.equal(FC.progress(t, 2100, '2026-11-20').status, 'reached');
  assert.equal(FC.progress(t, 500, '2026-11-20').frac, 0, 'never negative');
  assert.equal(FC.progress(null, 1, '2026-01-01').status, 'invalid');
});

test('target feasibility and suggestion follow the evidence', () => {
  const D = W.CW_DEMO.build(); D.prevStart = '2026-04-22'; D.prevEnd = '2026-07-20';
  const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] }); A.opps = OP.build(A, D);
  const F = FC.build(A, D), s = F.scenarios;
  const at = v => FC.feasibility({ monthly: Math.round(v) }, F).level;
  assert.equal(at(s.conservative.monthly - 1), 'covered'); assert.equal(at(s.expected.monthly - 1), 'likely');
  assert.equal(at(s.optimistic.monthly - 1), 'stretch'); assert.equal(at(s.optimistic.monthly * 2), 'beyond');
  const sg = FC.suggest(F, '2026-10-21');
  assert.ok(sg.value > F.base.monthly && sg.value <= s.conservative.monthly * 1.05, 'suggests the conservative case');
  assert.equal(sg.by, '2027-01-19');
  assert.equal(FC.validateTarget({ monthly: sg.value, by: sg.by }, { baseline: F.base.monthly, today: '2026-10-21' }).length, 0, 'the suggestion is a valid target');
  // short or undated data: no suggestion, with the reason
  assert.ok(/28/.test(FC.suggest({ ...F, base: { ...F.base, days: 10 } }).why));
  assert.ok(/no dates/.test(FC.suggest({ ...F, base: { ...F.base, assumed: true } }).why));
  assert.ok(/three/.test(FC.suggest({ ...F, opp: { ...F.opp, growthGood: { n: 1 }, recoveryGood: { n: 0 } } }).why));
});

test('explanations: every recommendation has why, sourced evidence, affected items, steps, impact and a link', () => {
  const D = W.CW_DEMO.build(); D.prevStart = '2026-04-22'; D.prevEnd = '2026-07-20';
  const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] }); A.content = W.CW_CONTENT.build(A, D, { brand: ['trailcraft'] }); A.opps = OP.build(A, D);
  const F = FC.build(A, D), P = PR.build(A, D, {});
  const types = new Set();
  P.items.forEach(g => {
    const e = EX.build(g, A, D, F); types.add(g.type);
    assert.ok(e.why.length > 30, 'why: ' + g.id);
    assert.ok(e.evidence.length && e.evidence.every(v => v.source === 'Search Console' || v.source === 'Crawler'), 'evidence with a source');
    assert.ok(e.steps.length >= 2 && e.steps.every(s => typeof s === 'string' && s.length > 10), 'steps: ' + g.type);
    assert.ok(e.queries.length + e.urls.length > 0, 'affected items: ' + g.id);
    assert.equal(e.link, '#opp?id=' + encodeURIComponent(g.id));
    assert.ok(e.impact.contribution && e.confidence.level && e.effort.level);
    // nothing invented: every affected URL is in the data
    const known = new Set(A.P.map(r => r.p).concat((D.QP || []).map(r => r.p)));
    e.urls.forEach(u => assert.ok(known.has(u.url), 'known URL ' + u.url));
  });
  assert.ok(types.size >= 5, 'several types covered: ' + [...types]);
  assert.equal(EX.build(P.items[0], A, D, F).crawlLoaded, false, 'says when no crawl is loaded');
});

test('explanations: crawler evidence is added when a page export is loaded', () => {
  const { A, P } = run(declineSite());
  const g = P.items.find(x => x.page && x.page.url === 'https://site.test/rank');
  assert.ok(g, 'an item on /rank');
  A.titles = { rows: [{ url: 'https://site.test/rank', path: '/rank', title: 'Old title', issues: [{ kind: 'title-query', text: 'Its main search is not in the title' }, { kind: 'ctr', text: 'x' }] }] };
  const e = EX.build(g, A, declineSite(), null);
  assert.ok(e.crawl && e.evidence.some(v => v.source === 'Crawler' && /main search/.test(v.text)) && e.evidence.some(v => /Old title/.test(v.text)));
  assert.ok(!e.evidence.some(v => v.source === 'Crawler' && v.text === 'x'), 'CTR line not repeated as crawl evidence');
});

test('change log: tasks and fixes in one list, a change logged in both measured once', () => {
  const D = { start: '2026-06-01', end: '2026-08-29', days: 90, source: 'api' };
  const mk = (id, status, implDate, url) => TK.normalise({ id, title: 'T ' + id, status, implDate, url, category: 'CTR', history: [] });
  const tasks = [mk('a', 'implemented', '2026-07-01', 'https://site.test/a'), mk('b', 'planned', '', 'https://site.test/b'), mk('c', 'validated', '2026-06-20', null)];
  const fixes = [{ id: 'f1', scope: 'page', url: 'https://site.test/a', date: '2026-07-01' }, { id: 'f2', scope: 'page', url: 'https://site.test/z', date: '2026-07-05', note: 'x' }, { id: 'f3', scope: 'site', date: '2026-06-20' }, { id: 'bad', date: 'nope' }];
  const log = TK.changeLog(tasks, fixes);
  assert.deep(log.map(c => c.key), ['fix:f2', 'task:a', 'task:c'], 'newest first, planned task and bad fix left out, duplicates merged');
  assert.deep(log.find(c => c.key === 'task:a').fixIds, ['f1']); assert.deep(log.find(c => c.key === 'task:c').fixIds, ['f3'], 'whole-site fix matched to whole-site task');
  assert.equal(TK.measuredMonthly({ status: 'measured', before: { perDay: 10 }, after: { perDay: 12 } }), 60);
  assert.equal(TK.measuredMonthly({ status: 'too-early' }), null);
  void D;
});

test('task persistence: created tasks survive a storage round trip with their measured result', () => {
  const D = W.CW_DEMO.build();
  const A = CW.analyse(D, { brand: ['trailcraft'], exclude: [] }); A.opps = OP.build(A, D);
  const P = PR.build(A, D, {});
  let t = TK.fromOpportunity(P.items[0], D, { owner: 'Asha', due: '2026-11-01' });
  t = { ...TK.setStatus(t, 'implemented'), implDate: '2026-09-01', change: 'New title', outcome: { verdict: 'improved', relative: 12.5, change: 20, monthly: 140, at: '2026-10-20T00:00:00Z', window: 28 } };
  const store = new Map();
  store.set('cw:tasks:x', JSON.stringify([t]));   // what the app writes to localStorage
  const back = TK.load(JSON.parse(store.get('cw:tasks:x'))).list[0];
  ['id', 'oppId', 'owner', 'due', 'status', 'implDate', 'change', 'window', 'priority', 'score'].forEach(k => assert.deep(back[k], t[k], k));
  assert.deep(back.estimate, t.estimate); assert.equal(back.outcome.monthly, 140); assert.equal(back.baseline.clicks, t.baseline.clicks);
  assert.equal(TK.load(JSON.parse(JSON.stringify([{ ...t, outcome: { ...t.outcome, monthly: 'x' } }]))).list[0].outcome.monthly, null, 'bad number dropped');
});

process.exit(report('forecast') ? 1 : 0);

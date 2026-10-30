// Tests for the growth layer: priority.js (merge, score, risk path, calibration), tasks.js (model, validation,
// confounders) and copilot.js (question routing and grounded answers). Uses the fictional sample site.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'opportunities.js', 'content.js', 'fixes.js', 'demo.js', 'priority.js', 'tasks.js', 'copilot.js']);
const PR = W.CW_PRIORITY, TK = W.CW_TASKS, CP = W.CW_COPILOT;
const D = W.CW_DEMO.build();
D.prevStart = '2026-04-22'; D.prevEnd = '2026-07-20';
const A = W.CW.analyse(D, { brand: ['trailcraft'], exclude: [] });
A.content = W.CW_CONTENT.build(A, D, { brand: ['trailcraft'] });
A.opps = W.CW_OPPS.build(A, D);
const P = PR.build(A, D, {});

test('merging: every opportunity once, fewer groups than raw items', () => {
  assert.ok(P.items.length < A.opps.items.length, 'some signals merged');
  assert.equal(P.merged, A.opps.items.length - P.items.length);
  assert.equal(new Set(P.items.map(g => g.id)).size, P.items.length, 'unique ids');
  const qs = P.items.filter(g => g.subject.kind === 'query' && !g.id.startsWith('o:gap:')).map(g => g.subject.label);
  assert.equal(new Set(qs).size, qs.length, 'a search is never two growth opportunities');
  assert.equal(P.items.reduce((s, g) => s + g.items.length, 0), A.opps.items.length, 'no raw item lost');
});
test('score: 0–100, documented parts add up, sorted, P-levels', () => {
  P.items.forEach(g => { assert.ok(g.score >= 0 && g.score <= 100); assert.near(g.parts.reduce((s, p) => s + p.points, 0), g.score, 0.6, 'parts sum to score'); assert.ok(g.why.length > 10); });
  for (let i = 1; i < P.items.length; i++) assert.ok(P.items[i - 1].score >= P.items[i].score, 'sorted');
  assert.equal(P.counts.P1 + P.counts.P2 + P.counts.P3, P.items.length);
});
test('weights change ranking; relevance follows priority sections', () => {
  const effortOnly = PR.build(A, D, { weights: { impact: 0, confidence: 0, relevance: 0, speed: 0, effort: 100 } });
  assert.equal(effortOnly.items[0].effort.level, 'Low', 'effort-only puts low effort first');
  const focused = PR.build(A, D, { focus: { sections: ['/guides/'], terms: [] } });
  const g = focused.items.find(x => x.section === '/guides/'), o = focused.items.find(x => x.section && x.section !== '/guides/');
  assert.equal(g.parts.find(p => p.key === 'relevance').value, 1); assert.equal(o.parts.find(p => p.key === 'relevance').value, 0.3);
  assert.equal(P.items[0].parts.find(p => p.key === 'relevance').value, 0.5, 'neutral without a goal');
});
test('risk path: declines listed whatever their score, critical first', () => {
  assert.ok(P.risks.length > 0, 'sample has declines');
  const low = P.items.filter(g => g.priority === 'P3' && g.items.some(x => /decline/.test(x.type)));
  const listed = id => P.risks.some(r => r.id === id || (r.searches || []).some(q => q.id === id));
  low.forEach(g => assert.ok(listed(g.id), 'low-score decline still a risk (on its own or under its page)'));
  const folded = P.risks.filter(r => r.searches && r.searches.length);
  folded.forEach(r => assert.equal(r.subject.kind, 'page'));
  assert.ok(!P.risks.some(r => r.subject.kind === 'query' && r.landing && r.landing.share >= 50 && P.risks.some(x => x.subject.url === r.landing.url)), 'no search risk duplicates its page risk');
  const ext = PR.build(A, D, { extraRisks: [{ id: 'i:x', sev: 'critical', kind: 'indexing', title: 'x', detail: '', action: '', subject: { kind: 'page' }, lost: 1, source: 't' }] });
  assert.equal(ext.risks[0].sev, 'critical');
});
test('calibration: needs 3 results, bounded ×0.7–×1.3', () => {
  assert.equal(PR.calibration([{ category: 'CTR', verdict: 'improved' }]).CTR.factor, 1);
  const up = PR.calibration(Array(6).fill({ category: 'CTR', verdict: 'improved' })).CTR.factor;
  const dn = PR.calibration(Array(6).fill({ category: 'CTR', verdict: 'declined' })).CTR.factor;
  assert.ok(up > 1 && up <= 1.3 && dn < 1 && dn >= 0.7, `${up} ${dn}`);
  const cal = PR.build(A, D, { outcomes: Array(5).fill({ category: P.items[0].category, verdict: 'declined' }) });
  assert.ok(cal.items.find(g => g.id === P.items[0].id).score < P.items[0].score, 'poor track record lowers the score');
});
test('tasks: from opportunity, statuses, validation, storage round-trip', () => {
  const g = P.items.find(x => x.page);
  let t = TK.fromOpportunity(g, D);
  assert.equal(t.status, 'planned'); assert.equal(t.oppId, g.id); assert.ok(t.baseline.clicks != null && t.url);
  t = TK.setStatus(t, 'implemented'); assert.ok(TK.isDate ? true : /^\d{4}-/.test(t.implDate), 'impl date set'); assert.equal(t.history.length, 2);
  assert.ok(TK.validate({ ...t, implDate: '' }, {}).length, 'implemented needs a date');
  assert.ok(TK.validate(TK.setStatus(t, 'validated'), {}).some(e => /measured/.test(e)), 'validated needs a result');
  assert.ok(TK.validate({ ...t, url: 'https://evil.test/x' }, { host: 'trailcraft.co' }).length, 'other site refused');
  const back = TK.load(JSON.parse(JSON.stringify([t, { junk: 1 }, { ...t, id: 'b', status: 'hacked', title: '<b>x</b>'.repeat(100) }])));
  assert.equal(back.list.length, 2); assert.equal(back.damaged, 1); assert.equal(back.list[1].status, 'planned'); assert.ok(back.list[1].title.length <= 300);
  assert.ok(TK.overdue({ ...TK.manual({ title: 'x' }), due: '2020-01-01' }));
});
test('tasks: confounders and measurement window', () => {
  const t = { id: 'a', url: 'https://x.test/a', implDate: '2026-06-15', title: 'a' };
  const w = W.CW_FIXES.windows('2026-06-15', '2026-09-30', '2026-01-01', 56);
  assert.equal(w.L, 56);
  const c = TK.confounders(t, [t, { id: 'b', url: 'https://x.test/a', implDate: '2026-06-20', title: 'b' }, { id: 'c', url: 'https://x.test/z', implDate: '2026-06-20', title: 'c' }], [{ scope: 'site', date: '2026-06-01' }], w);
  assert.ok(c.some(x => /: b$/.test(x)) && !c.some(x => /: c$/.test(x)) && c.some(x => /tracked fix/.test(x)) && c.some(x => /months/.test(x)));
});
test('copilot: the six spec questions route to grounded answers', () => {
  const ctx = { A, D, P, tasks: [TK.setStatus(TK.fromOpportunity(P.items[0], D), 'progress')], inspections: null };
  const ask = q => CP.answer(q, ctx);
  assert.equal(ask('Where am I losing organic clicks?').intent, 'losing');
  const five = ask('Which five pages should I improve first?'); assert.equal(five.intent, 'pages'); assert.equal(five.rows.length, 5); assert.equal(new Set(five.rows.map(r => r.url)).size, 5, 'distinct pages');
  const near = ask('Find keywords close to page one'); assert.equal(near.intent, 'near'); assert.equal(near.rows.length, Math.min(10, A.quickWins.length), '"page one" is not a count');
  assert.equal(ask('Which pages have CTR improvement potential?').intent, 'ctr');
  assert.equal(ask('Which SEO actions remain incomplete?').rows.length, 1);
  assert.equal(ask('What changed after our last content update?').intent, 'changed');
  assert.equal(ask('what is the weather in delhi'), null, 'unknown questions are not guessed');
  const noPrev = CP.answer('where am I losing clicks', { ...ctx, D: { ...D, prevQ: null, prevP: null }, A: { ...A, decay: null } });
  assert.ok(noPrev.limits.length && !noPrev.rows.length, 'missing data explained, nothing made up');
  assert.ok(ask('AI overview losses').limits.some(l => /Inferred/.test(l)), 'AI visibility marked as inferred');
});
test('results ledger: only settled, clear gains count; site movement removed; nothing double-counted', () => {
  const FX = W.CW_FIXES;
  const m = (perB, perA, site, L, verdict) => ({ status: 'measured', verdict, before: { perDay: perB }, after: { perDay: perA }, site: site == null ? null : { change: site }, window: { L } });
  // page 2 → 3 clicks a day while the site rose 10%: the page's own part is 3 − 2×1.1 = 0.8 a day
  assert.near(TK.attributable(m(2, 3, 10, 28, 'improved')), 24, 0.01);
  assert.near(TK.attributable(m(2, 3, null, 28, 'improved')), 30, 0.01, 'no site data: the raw change');
  assert.equal(TK.attributable({ status: 'too-early' }), null);
  const c = (o) => ({ window: 28, estimate: { lo: 10, hi: 30, kind: 'growth' }, ...o });
  const L = TK.ledger([
    { c: c(), r: m(2, 3, 10, 28, 'improved') },
    { c: c(), r: m(2, 2.6, 0, 28, 'maybe-improved') },
    { c: c(), r: m(4, 3, 0, 28, 'declined') },
    { c: c(), r: m(2, 2.2, 10, 28, 'no-change') },
    { c: c(), r: m(2, 4, 0, 14, 'improved') },        // early read: half the window
    { c: c(), r: { status: 'too-early' } },
    { c: c(), r: null }
  ]);
  assert.equal(L.shipped, 7); assert.equal(L.settled, 4); assert.equal(L.early, 1); assert.equal(L.waiting, 2);
  assert.equal(L.nGained, 1); assert.equal(L.gained, 24, 'only the clear, settled gain');
  assert.equal(L.nMaybe, 1); assert.equal(L.maybe, 18); assert.equal(L.nLost, 1); assert.equal(L.lost, -30); assert.equal(L.flat, 1);
  assert.equal(L.est.n, 4, 'estimate vs result only for settled changes'); assert.equal(L.est.hi, 120);
  assert.equal(L.rows.length, 7);
  assert.equal(TK.ledger([]).shipped, 0);
  // the sample site: one clear win, one smaller win, one change that only rode the site's own rise
  const S = W.CW_DEMO.sampleChanges(D);
  const res = S.map(x => ({ c: { window: 28, estimate: { lo: x.est[0], hi: x.est[1], kind: 'growth' } }, r: FX.measure({ scope: 'page', url: x.url, date: x.date }, W.CW_DEMO.pageDaily(D, x.url), D.C, D.end, D.start, { window: 28 }) }));
  assert.equal(res.map(x => x.r.verdict).join(','), 'improved,improved,no-change');
  S.forEach(x => { const pg = D.P.find(p => p.p === x.url); const sum = W.CW_DEMO.pageDaily(D, x.url).reduce((s, r) => s + r.clicks, 0); assert.ok(Math.abs(sum - pg.clicks) / pg.clicks < 0.05, 'a sample change keeps the page total'); });
  const LS = TK.ledger(res);
  assert.ok(LS.gained > 0 && LS.nGained === 2 && LS.flat === 1);
});
process.exit(report('growth') ? 1 : 0);

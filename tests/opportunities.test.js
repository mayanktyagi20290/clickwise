// Unit tests for the opportunity engine (opportunities.js) and the comparison logic it relies on.
// Every fixture below is synthetic with hand-checkable numbers; nothing here stands in for live data.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_OPPS: OP, CW_WORKFLOWS: WF } = W;

const q = (text, clicks, impr, pos) => ({ q: text, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
const pg = (url, clicks, impr, pos) => ({ p: 'https://site.test' + url, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
const S0 = { brand: ['acme'], exclude: [] };
function days(n, clicks = 1000, impr = 50000, start = '2026-03-01') {
  const out = [], d0 = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { const d = new Date(d0); d.setUTCDate(d0.getUTCDate() + i); out.push({ d: d.toISOString().slice(0, 10), clicks, impr, ctr: clicks / impr * 100, pos: 6 }); }
  return out;
}
function filler(n, pos, ctr, impr = 400, tag = 'f') { const a = []; for (let i = 0; i < n; i++) a.push(q(`${tag} ${pos} ${i}`, Math.round(impr * ctr / 100), impr, pos)); return a; }
const build = (D, S = S0) => { const A = CW.analyse(D, S); return { A, O: OP.build(A, D) }; };

// The sample site exercises every opportunity type at once.
const DEMO = W.CW_DEMO.build();
const demo = build(DEMO, { brand: ['trailcraft'], exclude: [] });

// ── totals and double counting ──
test('growth total equals the dashboard headline exactly (same searches, same rule)', () => {
  const { A, O } = demo;
  assert.near(O.totals.growth.lo, A.potential.lo, 1e-6, 'low');
  assert.near(O.totals.growth.hi, A.potential.hi, 1e-6, 'high');
  assert.equal(O.totals.growth.n, A.potential.n, 'searches counted');
});
test('each search is counted once; page and stake estimates are never counted', () => {
  const { O } = demo;
  const counted = O.items.filter(it => it.impact.counted && it.impact.kind === 'growth');
  assert.equal(new Set(counted.map(it => it.subject.label)).size, counted.length, 'unique searches');
  assert.ok(counted.every(it => it.subject.kind === 'query'), 'only searches add to growth');
  assert.ok(O.items.filter(it => it.type === 'ctr-page').every(it => !it.impact.counted && it.impact.overlap), 'page titles shown, not totalled');
  assert.ok(O.items.filter(it => it.impact.kind === 'stake' || it.impact.kind === 'none').every(it => !it.impact.counted), 'no totals for competing pages or warnings');
  // a search that appears under two types keeps its larger estimate, and the other says why it is not counted
  const dup = O.items.filter(it => it.subject.kind === 'query' && it.impact.kind === 'growth' && !it.impact.counted);
  assert.ok(dup.every(it => /which has the larger estimate/.test(it.impact.overlap)), 'duplicates explained');
  dup.forEach(it => { const w = counted.find(c => c.subject.label === it.subject.label); assert.ok(w && w.impact.hi >= it.impact.hi, 'winner is the larger estimate'); });
});
test('recovery total is 30–80% of the clicks lost by declining pages, per month', () => {
  const { A, O } = demo;
  const lost = A.decay.pages.reduce((s, r) => s + r.lost, 0);
  assert.ok(A.decay.pages.length > 0, 'sample has declines');
  assert.near(O.totals.recovery.lo, A.perMonth(lost) * 0.3, 1e-6, 'low');
  assert.near(O.totals.recovery.hi, A.perMonth(lost) * 0.8, 1e-6, 'high');
  assert.equal(O.totals.recovery.n, A.decay.pages.length);
  assert.ok(O.items.filter(it => it.type === 'decline-query').every(it => !it.impact.counted), 'search declines overlap page declines');
});
test('every item carries the required fields', () => {
  demo.O.items.forEach(it => {
    ['type', 'typeLabel', 'subject', 'measured', 'reason', 'evidence', 'impact', 'confidence', 'action', 'effort', 'warnings'].forEach(k => assert.ok(it[k] != null, `${it.id} has ${k}`));
    assert.ok(['High', 'Medium', 'Low'].includes(it.effort.level) && it.effort.why, 'effort with reason');
    assert.ok(it.confidence.why.length > 0, 'confidence has reasons');
    assert.ok(it.impact.kind === 'none' || it.impact.hi >= it.impact.lo, 'range is ordered');
  });
});
test('confidence is deterministic, bounded and matches its level', () => {
  const again = OP.build(demo.A, DEMO);
  assert.deep(again.items.map(it => [it.id, it.confidence.score, it.impact.lo, it.impact.hi]), demo.O.items.map(it => [it.id, it.confidence.score, it.impact.lo, it.impact.hi]), 'same input, same output');
  demo.O.items.forEach(it => {
    const c = it.confidence;
    assert.ok(c.score >= 0 && c.score <= 100, 'bounded');
    assert.equal(c.level, c.score >= 70 ? 'High' : c.score >= 45 ? 'Medium' : 'Low', 'level from score');
  });
});
test('inferred causes are never High; wording-based competition is never above Low', () => {
  assert.ok(demo.O.items.filter(it => it.type === 'answer-box').every(it => it.confidence.level !== 'High'), 'answer boxes are inferred');
  const D = { site: 's', source: 'file', Q: filler(40, 5, 5).concat([q('blue widget price', 5, 900, 3), q('price blue widget', 1, 900, 14), q('widget blue price list', 1, 800, 18)]), P: [pg('/a', 50, 1000, 5)], C: days(30), days: 30 };
  const { A, O } = build(D);
  assert.equal(A.cannibalMode, 'stem');
  const c = O.items.filter(it => it.type === 'cannibal');
  assert.ok(c.length > 0, 'stem competition found');
  assert.ok(c.every(it => it.confidence.level === 'Low'), 'guessed from wording');
});
test('volume confidence follows expected clicks, not the site median', () => {
  // one search with lots of evidence, one with very little, at the same position
  const D = { site: 's', source: 'file', Q: filler(40, 3, 12).concat(filler(40, 6, 5), [q('big search', 60, 20000, 6), q('tiny search', 0, 60, 6)]), P: [pg('/a', 50, 1000, 5)], C: days(30), days: 30 };
  const { O } = build(D);
  const big = O.items.find(it => it.subject.label === 'big search'), tiny = O.items.find(it => it.subject.label === 'tiny search');
  assert.ok(big && big.confidence.why.some(w => w.points === 20), 'large sample earns the most points');
  if (tiny) assert.ok(tiny.confidence.score < big.confidence.score, 'tiny sample scores lower');
});

// ── comparisons between periods ──
function decayData({ prevDays, curDays, prevClicks, curClicks, rowCap, prevRowCap, extraPrev = [], extraCur = [] }) {
  // ten ordinary pages, unchanged per day, so thresholds (60th percentile of clicks, median impressions) behave
  const small = k => Array.from({ length: 10 }, (_, i) => pg('/small' + i, 10 * k, 1000 * k, 7));
  const P = [pg('/steady', 300, 6000, 4), pg('/watched', curClicks, 4000, 5)].concat(small(1), extraCur);
  const prevP = [pg('/steady', 300 * prevDays / curDays, 6000 * prevDays / curDays, 4), pg('/watched', prevClicks, 4000 * prevDays / curDays, 5)].concat(small(prevDays / curDays), extraPrev);
  return { site: 's', source: 'api', Q: filler(40, 5, 5), P, prevP, prevQ: filler(40, 5, 5), C: days(curDays), prevC: days(prevDays, 1000, 50000, '2026-01-01'), days: curDays, start: '2026-03-01', prevStart: '2026-01-01', rowCap, prevRowCap };
}
test('periods of different length are compared per day', () => {
  // 60-day previous period with 200 clicks is 100 per 30 days: 100 now is no decline
  const flat = build(decayData({ prevDays: 60, curDays: 30, prevClicks: 200, curClicks: 100 })).A;
  assert.near(flat.decay.scale, 0.5, 1e-9, 'scaled to 30 days');
  assert.ok(!flat.decay.pages.some(r => r.path === '/watched'), 'no false decline');
  // 200 → 40 clicks over the same scaling is a real 60% drop
  const fell = build(decayData({ prevDays: 60, curDays: 30, prevClicks: 200, curClicks: 40 }));
  const row = fell.A.decay.pages.find(r => r.path === '/watched');
  assert.ok(row, 'decline found');
  assert.near(row.ch, -60, 1e-9, 'change measured on scaled clicks');
  assert.near(row.lost, 60, 1e-9, 'clicks lost in this period');
  const it = fell.O.items.find(x => x.type === 'decline-page' && x.subject.label === '/watched');
  assert.ok(it.confidence.why.some(w => /differ in length/.test(w.text)) && it.warnings.some(w => /per day/.test(w)), 'scaling is disclosed');
});
test('a page missing from a list that hit its row limit is an upper bound, not zero', () => {
  const extraCur = []; for (let i = 0; i < 8; i++) extraCur.push(pg('/c' + i, 20 + i, 900, 6));
  const D = decayData({ prevDays: 30, curDays: 30, prevClicks: 500, curClicks: 0, rowCap: 10, extraCur });
  D.P = D.P.filter(r => !r.p.endsWith('/watched'));            // dropped out of the current list
  D.P.push(pg('/c8', 20, 800, 7));                             // the list is exactly at its 10-row limit
  const { A, O } = build(D);
  assert.ok(A.decay.truncated.pages, 'current list truncated');
  const row = A.decay.pages.find(r => r.path === '/watched');
  assert.ok(row && row.uncertain, 'flagged as uncertain');
  assert.equal(row.cur.clicks, 10, 'counted at the smallest listed row (the 10-click filler pages)');
  assert.ok(/at most 10 clicks/.test(row.reason), row.reason);
  const it = O.items.find(x => x.type === 'decline-page' && x.subject.label === '/watched');
  assert.equal(it.measured.clicks, null, 'current clicks not reported as measured');
  assert.ok(it.confidence.why.some(w => w.points === -30), 'confidence reduced');
});
test('without a row limit, a missing page really has no clicks', () => {
  const D = decayData({ prevDays: 30, curDays: 30, prevClicks: 500, curClicks: 0 });
  D.P = D.P.filter(r => !r.p.endsWith('/watched'));
  const row = build(D).A.decay.pages.find(r => r.path === '/watched');
  assert.ok(row && !row.uncertain && row.cur.gone, 'gone');
  assert.ok(/no longer shows/.test(row.reason), row.reason);
});
test('gaining pages: new pages have no previous row; a truncated previous list gives a lower bound', () => {
  const D = decayData({ prevDays: 30, curDays: 30, prevClicks: 100, curClicks: 100, extraCur: [pg('/brand-new', 400, 5000, 3)] });
  const plain = build(D).A.decay.rising.find(r => r.path === '/brand-new');
  assert.ok(plain && plain.prev === null && !plain.uncertain, 'new page');
  assert.equal(plain.won, 400);
  const extraPrev = []; for (let i = 0; i < 3; i++) extraPrev.push(pg('/p' + i, 30 + i, 900, 6));
  const D2 = decayData({ prevDays: 30, curDays: 30, prevClicks: 100, curClicks: 100, prevRowCap: 5, extraPrev, extraCur: [pg('/brand-new', 400, 5000, 3)] });
  const bounded = build(D2).A.decay.rising.find(r => r.path === '/brand-new');
  assert.ok(bounded && bounded.uncertain, 'could have been below the previous cut-off');
  assert.equal(bounded.prev.clicks, 10, 'previous clicks at most the smallest listed row');
  assert.equal(bounded.won, 390, 'gain counted from that bound');
});
test('early warnings: rank slipping while clicks hold', () => {
  const D = decayData({ prevDays: 30, curDays: 30, prevClicks: 100, curClicks: 95 });
  D.P = D.P.map(r => r.p.endsWith('/watched') ? { ...r, pos: 8.5 } : r);
  const { A, O } = build(D);
  const s = A.decay.slipping.pages.find(r => r.path === '/watched');
  assert.ok(s && s.why.some(w => /position 5\.0 → 8\.5/.test(w)), 'position slip found');
  const it = O.items.find(x => x.type === 'slipping-page');
  assert.ok(it && it.impact.kind === 'none' && !it.impact.counted, 'a warning, not an estimate');
});
test('declines within normal variation get lower confidence', () => {
  // 40 → 28 clicks is −30% but only about 2 √n: noise-level for a small page
  const D = decayData({ prevDays: 30, curDays: 30, prevClicks: 40, curClicks: 28 });
  const { O } = build(D);
  const it = O.items.find(x => x.type === 'decline-page' && x.subject.label === '/watched');
  assert.ok(it, 'listed');
  assert.ok(it.confidence.why.some(w => w.points === -15 && /within normal variation/.test(w.text)), JSON.stringify(it.confidence.why));
});

// ── evidence ──
test('actions name the ranking page when query-page data exists', () => {
  const it = demo.O.items.find(x => x.type === 'striking' && x.landing);
  assert.ok(it, 'sample has query-page data');
  assert.ok(it.action.startsWith('On ' + it.landing.path), it.action);
  assert.ok(it.evidence.some(e => e.startsWith('Ranking page: ' + it.landing.path)), 'page named in evidence');
  // without query-page rows, no page is guessed
  const D = { ...DEMO, QP: null };
  const O2 = OP.build(CW.analyse(D, { brand: ['trailcraft'], exclude: [] }), D);
  assert.ok(O2.items.every(x => !x.landing && !/^On \//.test(x.action)), 'no invented pages');
});
test('data warnings: row limits, unattributed clicks, assumed period', () => {
  const Q = filler(1000, 6, 3, 200);
  const D = { site: 's', source: 'file', Q, P: [pg('/a', 50, 1000, 5)], C: [], days: null };
  const { O } = build(D);
  assert.ok(O.warnings.some(w => /no Dates sheet/.test(w)), 'assumed period');
  assert.ok(O.items.every(it => it.confidence.why.some(w => /90-day period was assumed/.test(w.text))), 'reflected in confidence');
  const D2 = { ...D, C: days(30, 5000, 500000), days: 30 };
  const O2 = build(D2).O;
  assert.ok(O2.warnings.some(w => /top 1,000/.test(w)), 'row limit');
  assert.ok(O2.warnings.some(w => /not attributed/.test(w)), 'unattributed clicks');
});
test('empty or tiny data gives an empty list, not an error', () => {
  const { O } = build({ site: 's', source: 'file', Q: [q('a', 1, 10, 3)], P: [pg('/a', 1, 10, 3)], C: [], days: 30 });
  assert.equal(O.items.length, 0);
  assert.equal(O.totals.growth.lo, 0);
});

// ── the Quick wins workflow uses the same numbers ──
test('Quick wins workflow: same confidence, actions and estimates as All opportunities', () => {
  const out = WF.run('quickwins', demo.A, {});
  const byLabel = new Map(demo.O.items.filter(it => it.impact.counted || it.type === 'ctr-page').map(it => [it.subject.label, it]));
  out.table.rows.forEach(r => {
    const it = byLabel.get(r.item);
    assert.ok(it, 'row comes from the engine: ' + r.item);
    assert.equal(r.confidence, it.confidence.level, 'confidence');
    assert.equal(r.gainLo, it.impact.lo, 'estimate');
    assert.ok(r.confidence !== 'Low', 'low confidence left out');
  });
  assert.ok(out.total.hi <= demo.O.totals.growth.hi + 1e-6, 'subset of the headline');
});

process.exit(report('opportunities') ? 1 : 0);

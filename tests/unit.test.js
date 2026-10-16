// Unit tests for the analysis engine, smart filters and workflows (no browser needed).
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_FILTERS: F, CW_WORKFLOWS: WF } = W;

// ── synthetic data helpers ──
const q = (text, clicks, impr, pos) => ({ q: text, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
const pg = (url, clicks, impr, pos) => ({ p: 'https://site.test' + url, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
function days(n, clicks, impr) { const out = []; for (let i = 0; i < n; i++) out.push({ d: '2026-01-' + String(i + 1).padStart(2, '0'), clicks, impr, ctr: clicks / impr * 100, pos: 5 }); return out; }
const S0 = { brand: ['acme'], exclude: [] };
// filler non-brand queries so medians and floors behave like a real site
function filler(n, pos, ctr, impr = 400) { const a = []; for (let i = 0; i < n; i++) a.push(q(`filler ${pos} ${i}`, Math.round(impr * ctr / 100), impr, pos)); return a; }

// ── metrics ──
test('CTR is clicks ÷ impressions and position is impression-weighted', () => {
  const a = CW.agg([{ clicks: 10, impr: 100, pos: 2 }, { clicks: 0, impr: 300, pos: 10 }]);
  assert.near(a.ctr, 2.5, 1e-9, 'ctr'); assert.near(a.pos, 8, 1e-9, 'position');
});
test('site totals come from the daily series when present', () => {
  const A = CW.analyse({ site: 's', source: 'file', Q: [q('a', 5, 50, 3)], P: [pg('/a', 5, 50, 3)], C: days(10, 100, 1000), days: 10 }, S0);
  assert.equal(A.site.clicks, 1000); assert.equal(A.site.impr, 10000);
  assert.near(A.coverage.q.clicks, 0.5, 1e-9, 'query click coverage');
  assert.equal(A.coverage.notShown.clicks, 995);
});
test('no coverage percentages without daily totals', () => {
  const A = CW.analyse({ site: 's', source: 'file', Q: [q('a', 5, 50, 3)], P: [pg('/a', 5, 50, 3)], C: [], days: null }, S0);
  assert.equal(A.coverage, null); assert.ok(A.method.assumedDays, 'flags assumed period');
});
test('export row limit is detected at exactly 1,000 rows', () => {
  const Q = []; for (let i = 0; i < 1000; i++) Q.push(q('w' + i, 1, 10, 5));
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(5, 100, 1000), days: 5 }, S0);
  assert.ok(A.coverage.rowLimit);
});

// ── monthly scaling ──
test('every estimate is per month regardless of period length', () => {
  const base = filler(40, 3, 10).concat(filler(40, 6, 3), [q('big topic', 30, 3000, 6)]);
  const mk = n => CW.analyse({ site: 's', source: 'file', Q: base, P: [pg('/a', 5, 50, 3)], C: days(n, 100, 1000), days: n }, S0);
  const r30 = mk(30).quickWins.find(r => r.q === 'big topic'), r15 = mk(15).quickWins.find(r => r.q === 'big topic');
  assert.ok(r30 && r15, 'found in both');
  assert.near(r15.gainHi, r30.gainHi * 2, 1e-6, 'same clicks over half the days = double per month');
  assert.ok(r30.gainLo <= r30.gainHi, 'low ≤ high');
});

// ── brand matching ──
test('brand terms match as words: exact for short names', () => {
  const t = CW.makeBrandTest(['ola', 'trail craft', 'acme.com']);
  assert.ok(t('ola cabs')); assert.ok(t('book OLA')); assert.ok(t('ola-app login'));
  assert.ok(!t('coca cola')); assert.ok(!t('olafur')); assert.ok(!t('olaa'));
  assert.ok(t('trail craft boots')); assert.ok(!t('trailcraft boots'));
  assert.ok(t('acme.com login')); assert.ok(!t('acmexcom'));
});
test('longer brand names also catch glued typos, not longer words', () => {
  const t = CW.makeBrandTest(['brando']);
  ['brando', 'brando login', 'brandoo', 'brandos', 'ibrando', 'iibrando', 'brando4', 'brandoned'].forEach(x => assert.ok(t(x), x));
  ['brandonian', 'rando', 'bra ndo'].forEach(x => assert.ok(!t(x), x));
});

// ── CTR calibration ──
test('site curve replaces the benchmark only where there is enough evidence', () => {
  const c = CW.buildCurve(filler(30, 3, 4).concat(filler(29, 5, 1)), 30);
  assert.near(c.at(3), 4, 1e-9, 'position 3 uses the site CTR');
  assert.ok(c.points[2].source.startsWith('site'));
  assert.ok(c.points[4].source.startsWith('benchmark'), 'position 5 has 29 queries → benchmark');
});
test('expected CTR never rises at a lower position', () => {
  const c = CW.buildCurve(filler(40, 2, 3), 30);
  for (let p = 3; p <= 20; p++) assert.ok(c.at(p) <= c.at(p - 1) + 1e-9, 'monotonic at ' + p);
});
test('low-CTR queries at positions 1–8 are flagged as possible results-page features', () => {
  const Q = filler(40, 4, 8).concat([q('answer box topic', 2, 5000, 4)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  const r = A.ctrQueries.find(x => x.q === 'answer box topic');
  assert.ok(r && r.serp, 'flagged'); assert.equal(r.gainLo, 0, 'title rewrite low estimate is zero');
  assert.ok(A.ai.overview.some(x => x.q === 'answer box topic'));
});
test('a query is not assumed to reach position 3', () => {
  const Q = filler(40, 3, 12).concat(filler(40, 9, 2), [q('mid topic', 20, 1000, 9)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  const r = A.quickWins.find(x => x.q === 'mid topic');
  assert.ok(r, 'present'); assert.ok(r.gainLo < r.gainHi, 'low case is a smaller move'); assert.equal(r.lowTarget, 7);
});
test('one extreme query cannot dominate a list', () => {
  const Q = filler(40, 6, 3, 2000).concat([q('monster', 60000, 2000000, 6)]); // normal CTR, enormous volume
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  const m = A.quickWins.find(r => r.q === 'monster');
  assert.ok(m.capped, 'flagged as capped');
  assert.ok(m.gainHi <= A.quickWins.reduce((s, r) => s + r.gainHi, 0), 'bounded');
  assert.ok(A.quickWins.filter(r => r.capped).length <= 2, 'only outliers are capped');
});

test('a huge query that rarely gets clicked is not projected to a full top-3 CTR', () => {
  // like an exam-date search answered on the results page: 1.5M impressions, 0.4% CTR at position 6.6
  const Q = filler(40, 3, 12).concat(filler(40, 7, 3), [q('exam date', 6000, 1500000, 6.6)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(92, 40000, 1100000), days: 92 }, S0);
  const r = A.quickWins.find(x => x.q === 'exam date');
  const naive = 1500000 * (CW.expCtr(3) - 0.4) / 100 * 30 / 92; // the old benchmark method
  assert.ok(r && r.serp, 'flagged as a results-page feature');
  assert.ok(r.gainHi < naive * 0.2, `estimate ${Math.round(r.gainHi)} is far below the old ${Math.round(naive)}`);
});

test('zero-click queries with few impressions are still opportunities (B2B pages)', () => {
  // page two, 0 clicks: normal for low volume, not a results-page feature
  const Q = filler(40, 3, 12).concat(filler(40, 9, 2), [q('ats software india', 0, 900, 12), q('campus hiring platform', 0, 700, 9)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  ['ats software india', 'campus hiring platform'].forEach(t => {
    const r = A.quickWins.find(x => x.q === t);
    assert.ok(r && r.gainHi > 0 && !r.serp, t + ' is a quick win: ' + JSON.stringify(r && { hi: r.gainHi, serp: r.serp }));
  });
});
test('a results-page feature needs evidence: enough expected clicks', () => {
  const Q = filler(40, 4, 8).concat([q('tiny', 0, 40, 4), q('big answered', 10, 20000, 4)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  const all = A.quickWins.concat(A.ctrQueries);
  assert.ok(!all.some(r => r.q === 'tiny' && r.serp), 'few impressions: no flag');
  assert.ok(all.some(r => r.q === 'big answered' && r.serp), 'lots of impressions, few clicks: flagged');
});

test('a section where most searches get 0 clicks still has a usable curve and opportunities', () => {
  // like a B2B folder: 40+ queries at each position 4–15, 70% with no clicks at all
  const Q = [];
  for (let p = 4; p <= 15; p++) for (let i = 0; i < 40; i++) { const impr = 100 + (i * 37) % 600, clicks = i % 10 < 7 ? 0 : 1 + (i % 3); Q.push(q(`term ${p} ${i}`, clicks, impr, p)); }
  const A = CW.analyse({ site: 's', source: 'api', Q, P: [pg('/a', 5, 50, 3)], C: days(90, 300, 30000), days: 90 }, S0);
  for (let p = 1; p <= 20; p++) assert.ok(A.curve.at(p) >= CW.expCtr(p) * 0.2 - 1e-9, 'expected CTR never collapses to zero at ' + p);
  assert.ok(A.quickWins.length > 50, 'almost page one finds opportunities: ' + A.quickWins.length);
  assert.ok(A.potential.hi > 0, 'headline is not zero');
});

// ── de-duplication ──
test('headline counts each query once across lists', () => {
  const Q = filler(40, 3, 12).concat(filler(40, 5, 6), [q('both lists', 20, 5000, 5)]);
  const A = CW.analyse({ site: 's', source: 'file', Q, P: [pg('/a', 5, 50, 3)], C: days(30, 1000, 100000), days: 30 }, S0);
  const inQW = A.quickWins.some(r => r.q === 'both lists'), inCTR = A.ctrQueries.some(r => r.q === 'both lists');
  assert.ok(inQW && inCTR, 'query appears in both lists');
  const lists = A.quickWins.concat(A.ctrQueries, A.ai.overview);
  const naive = lists.reduce((s, r) => s + r.gainHi, 0);
  assert.ok(A.potential.hi < naive, 'headline is below the naive sum');
  const uniq = new Map(); lists.forEach(r => { const o = uniq.get(r.q); if (!o || r.gainHi > o.gainHi) uniq.set(r.q, r); });
  assert.near(A.potential.hi, [...uniq.values()].reduce((s, r) => s + r.gainHi, 0), 1e-6, 'headline = unique sum');
});
test('Quick wins workflow never adds page estimates to the total', () => {
  const Q = filler(40, 3, 12).concat(filler(40, 5, 6), [q('both lists', 20, 5000, 5)]);
  // pages at position 4: most earn a normal CTR, a few earn much less (title-rewrite candidates)
  const P = [pg('/a', 5, 50, 3)]; for (let i = 0; i < 40; i++) P.push(pg('/page-' + i, i < 32 ? 400 : 120, 4000, 4));
  const A = CW.analyse({ site: 's', source: 'file', Q, P, C: days(30, 1000, 100000), days: 30 }, S0);
  const out = WF.run('quickwins', A, {});
  assert.ok(out.total.hi <= A.potential.hi + 1e-6, `workflow ${out.total.hi} ≤ headline ${A.potential.hi}`);
  const rows = out.table.rows;
  assert.equal(new Set(rows.filter(r => r.isQuery).map(r => r.item)).size, rows.filter(r => r.isQuery).length, 'no duplicate queries');
  assert.ok(rows.some(r => r.overlap), 'page items shown but marked as overlapping');
});

// ── sitelinks and utility pages ──
function brandHeavy(extraP, QP, S = S0) {
  const Q = filler(40, 2, 15).concat(filler(40, 5, 4), [q('acme', 50000, 60000, 1), q('acme login', 9000, 10000, 1)]);
  const P = [pg('/', 50000, 100000, 1), ...extraP];
  for (let i = 0; i < 20; i++) P.push(pg('/blog/post-' + i, 50, 2000, 6));
  return CW.analyse({ site: 's', source: QP ? 'api' : 'file', Q, P, QP, C: days(30, 3000, 300000), days: 30 }, S);
}
test('top-level page with tiny CTR on a branded site is set aside as a likely sitelink', () => {
  const A = brandHeavy([pg('/jobs', 300, 200000, 1.6)]);
  assert.ok(!A.ctrPages.some(r => r.path === '/jobs'), 'not a title-rewrite recommendation');
  const s = A.setAside.find(r => r.path === '/jobs');
  assert.ok(s && s.flag.kind === 'sitelink' && !s.flag.certain, 'set aside, unconfirmed');
});
test('query-page data showing non-branded traffic keeps the page', () => {
  const QP = [{ q: 'jobs in town', p: 'https://site.test/jobs', clicks: 300, impr: 200000, ctr: 0.15, pos: 1.6 }];
  const A = brandHeavy([pg('/jobs', 300, 200000, 1.6)], QP);
  assert.ok(!A.setAside.some(r => r.path === '/jobs'), 'not set aside');
});
test('query-page data showing branded traffic confirms the sitelink', () => {
  const QP = [{ q: 'acme jobs', p: 'https://site.test/jobs', clicks: 300, impr: 200000, ctr: 0.15, pos: 1.6 }];
  const A = brandHeavy([pg('/jobs', 300, 200000, 1.6)], QP);
  const s = A.setAside.find(r => r.path === '/jobs'); assert.ok(s && s.flag.certain, 'confirmed');
});
test('utility URLs are flagged, not silently removed, and can be included again', () => {
  const A = brandHeavy([pg('/org/dashboard', 300, 90000, 1.4)]);
  const s = A.setAside.find(r => r.path === '/org/dashboard'); assert.ok(s && s.flag.kind === 'utility' && !s.flag.certain);
  const B = brandHeavy([pg('/org/dashboard', 300, 90000, 1.4)], null, { ...S0, keep: ['/org/dashboard'] });
  assert.ok(!B.setAside.length || !B.setAside.some(r => r.path === '/org/dashboard'), 'override respected');
});
test('deep content pages are never guessed to be sitelinks', () => {
  const A = brandHeavy([pg('/blog/big-guide', 300, 200000, 1.6)]);
  assert.ok(!A.setAside.some(r => r.path === '/blog/big-guide'));
});

// ── smart filter parser ──
const D = W.CW_DEMO.build();
const AD = CW.analyse(D, { brand: ['trailcraft', 'trail craft', 'trialcraft'], exclude: ['/login'] });
const P = s => F.parse(s, AD);
const has = (spec, f, op, v) => spec.conds.some(c => c.f === f && (!op || c.op === op) && (v === undefined || JSON.stringify(c.v) === JSON.stringify(v)));
test('parser: the six audit examples', () => {
  let r = P('Find pages with more than 1,000 impressions and CTR below 2%.');
  assert.ok(r.spec.target === 'page' && has(r.spec, 'impr', 'gt', 1000) && has(r.spec, 'ctr', 'lt', 2) && !r.unknown.length, JSON.stringify(r));
  r = P('Show non-branded keywords ranking between positions 5 and 15.');
  assert.ok(has(r.spec, 'brand', 'is', false) && r.spec.conds.some(c => c.f === 'pos' && c.v === 5 && c.v2 === 15), JSON.stringify(r));
  r = P('Find blog pages that lost clicks in the last 28 days.');
  assert.ok(has(r.spec, 'section', 'is', '/blog/') && has(r.spec, 'clickChange', 'lt', 0) && r.notes.includes('date'), JSON.stringify(r));
  r = P('Group internship URLs by city.');
  assert.ok(r.spec.target === 'page' && r.spec.group === 'location' && has(r.spec, 'text', 'contains', 'internship'), JSON.stringify(r));
  r = P('Show queries containing questions.');
  assert.ok(has(r.spec, 'question', 'is', true) && !has(r.spec, 'text'), JSON.stringify(r));
  r = P('Find pages that have high impressions but are not generating enough clicks.');
  assert.ok(has(r.spec, 'impr', 'gte') && has(r.spec, 'ctrGap', 'lt', 60), JSON.stringify(r));
});
test('parser: topic word before queries/keywords becomes a contains filter', () => {
  const r = P('hackathon queries with more than 5000 impressions');
  assert.ok(has(r.spec, 'text', 'contains', 'hackathon') && has(r.spec, 'impr', 'gt', 5000) && !r.unknown.length, JSON.stringify(r));
  const r2 = P('Show non-branded keywords'); assert.ok(!has(r2.spec, 'text'), 'modifier words are not topics');
});
test('parser: place names become a place filter', () => {
  const r = P('internship keywords in delhi');
  assert.ok(has(r.spec, 'text', 'contains', 'internship') && has(r.spec, 'place', 'is', 'Delhi') && !r.unknown.length, JSON.stringify(r));
  const r2 = P('pages mentioning new delhi');
  assert.ok(r2.spec.conds.some(c => c.v === 'New Delhi' || c.v === 'new delhi'), JSON.stringify(r2));
  const res = F.run(P('keywords in delhi').spec, AD);
  assert.ok(res.ok && res.rows.length > 0 && res.rows.every(x => x.place === 'Delhi'), 'rows all mention Delhi');
});
test('parser: nonsense is reported, not guessed', () => {
  const r = P('make me a sandwich'); assert.ok(!r.understood && r.unknown.includes('sandwich'));
  assert.ok(!P('').understood);
});

// ── validation and special characters ──
test('validation rejects bad specs with plain messages', () => {
  const R = F.rows(AD), V = s => F.validate(s, R);
  assert.ok(V({ target: 'query', conds: [{ f: 'ctr', op: 'lt', v: 150 }] }).length, 'ctr > 100');
  assert.ok(V({ target: 'query', conds: [{ f: 'pos', op: 'between', v: 15, v2: 5 }] }).length, 'reversed range');
  assert.ok(V({ target: 'query', conds: [{ f: 'impr', op: 'gt', v: NaN }] }).length, 'NaN');
  assert.ok(V({ target: 'query', conds: [{ f: 'text', op: 'contains', v: '  ' }] }).length, 'blank');
  assert.ok(V({ target: 'query', conds: [{ f: 'text', op: 'contains', v: 'x'.repeat(201) }] }).length, 'too long');
  assert.ok(V({ target: 'page', conds: [{ f: 'brand', op: 'is', v: true }] }).length, 'brand on pages');
  assert.ok(V({ target: 'query', conds: [{ f: 'evil', op: 'is', v: 1 }] }).length, 'unknown field');
  assert.ok(V({ target: 'query', conds: [{ f: 'clicks', op: 'regex', v: 1 }] }).length, 'unknown op');
  assert.ok(!V({ target: 'query', conds: [] }).length, 'empty is fine');
});
test('special characters are matched literally and never as patterns', () => {
  ['c++ tutorial', '(a+)+$', '[unclosed', 'price $50?', 'a.*b', '\\d+', 'naïve café', 'हिंदी', '日本語', '😀', "o'reilly"].forEach(w => {
    ['contains', 'word', 'startsWith', 'equals'].forEach(op => { const r = F.run({ target: 'query', conds: [{ f: 'text', op, v: w }] }, AD); assert.ok(r.ok, op + ' ' + w); });
    F.parse('queries containing "' + w + '"', AD);
  });
  const lit = F.run({ target: 'query', conds: [{ f: 'text', op: 'contains', v: 'g.*r' }] }, AD);
  assert.equal(lit.rows.length, 0, 'dot-star is literal');
  const t0 = Date.now(); F.parse('a'.repeat(5000) + ' pages with ' + '1'.repeat(300) + ' impressions', AD);
  assert.ok(Date.now() - t0 < 1500, 'long input stays fast');
});
test('ignored searches are removed from every list', () => {
  const A2 = CW.analyse(D, { brand: ['trailcraft'], exclude: ['/login'], ignore: ['reddit'] });
  assert.ok(AD.Q.some(r => r.q.includes('reddit')) && !A2.Q.some(r => r.q.includes('reddit')));
});
test('every workflow runs on sample data and reports missing data plainly', () => {
  WF.TEMPLATES.forEach(w => { const o = WF.run(w.id, AD, { site: D.site, terms: ['reddit'] }); assert.ok(o && !o.error && typeof o.summary === 'string', w.id); });
  const noPrev = CW.analyse({ ...D, prevQ: null, prevP: null }, { brand: ['trailcraft'], exclude: [] });
  assert.ok(WF.missing(WF.byId('declines'), noPrev).length > 0);
});

process.exitCode = report('unit') ? 1 : 0;

// Tests for the Goal builder: interpreting plain-English requests, clarifying questions, data the loaded
// analysis cannot answer, invalid goals, and running saved goals. Fixtures are the fictional sample site
// plus small synthetic sets with hand-checkable numbers; nothing stands in for live data.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_FILTERS: F, CW_WORKFLOWS: WF, CW_OPPS: OP } = W;

const D = W.CW_DEMO.build();
const S = { brand: ['trailcraft'], exclude: ['/login'] };
const A = CW.analyse(D, S); A.opps = OP.build(A, D);
const P = s => F.parse(s, A);
const has = (spec, f, op, v, v2) => spec.conds.some(c => c.f === f && (!op || c.op === op) && (v === undefined || JSON.stringify(c.v) === JSON.stringify(v)) && (v2 === undefined || c.v2 === v2));
const R = F.rows(A);
const ok = spec => F.validate(spec, R).length === 0;

// ── supported requests ──
test('the brief\'s example: topic, place, impressions and a position range', () => {
  const r = P('Find internship keywords in Delhi with more than 1,000 impressions and average position between 5 and 15.');
  assert.equal(r.spec.target, 'query');
  assert.ok(has(r.spec, 'text', 'contains', 'internship') && has(r.spec, 'place', 'is', 'Delhi') && has(r.spec, 'impr', 'gt', 1000) && has(r.spec, 'pos', 'between', 5, 15), JSON.stringify(r.spec));
  assert.equal(r.unknown.length, 0, 'every word used: ' + r.unknown);
  assert.ok(r.notes.includes('place-mention'), 'says the place is matched in the search words');
  assert.ok(ok(r.spec));
});
test('opportunity goals use the opportunity engine', () => {
  const cases = [
    ['Which pages should I fix first?', 'page', 'any'],
    ['titles to rewrite', 'page', 'ctr'],
    ['competing pages', 'query', 'cannibal'],
    ['answer box searches', 'query', 'answer'],
    ['quick wins', null, 'growth'],
    ['early warnings', 'page', 'slipping']
  ];
  cases.forEach(([text, target, kind]) => {
    const r = P(text);
    assert.ok(has(r.spec, 'opp', 'is', kind), `${text} → ${JSON.stringify(r.spec)}`);
    if (target) assert.equal(r.spec.target, target, text);
    assert.equal(r.unknown.length, 0, `${text}: ${r.unknown}`);
  });
});
test('opportunity rows carry the engine\'s numbers exactly', () => {
  const res = F.run(P('opportunities').spec, A);
  assert.ok(res.ok && res.rows.length > 0);
  res.rows.forEach(r => {
    const items = A.opps.items.filter(it => it.subject.kind === 'query' && it.subject.label === r.q && (it.impact.kind === 'growth' || it.impact.kind === 'recovery'));
    if (!items.length) return;
    const best = Math.max(...items.map(it => it.impact.lo));
    assert.near(r.gain, best, 1e-9, 'gain is the best estimate for ' + r.q);
  });
  // "quick wins" on searches = every search the engine lists as almost page one, low CTR or answer box
  const qw = F.run(P('quick wins').spec, A).rows.map(r => r.q).sort();
  const want = [...new Set(A.opps.items.filter(it => ['striking', 'ctr-query', 'answer-box'].includes(it.type)).map(it => it.subject.label))].sort();
  assert.deep(qw, want, 'same searches as the engine');
});
test('top N, confidence and estimated gain', () => {
  const r = P('Top 10 opportunities with high confidence');
  assert.ok(r.spec.limit === 10 && r.spec.sort.f === 'gain' && has(r.spec, 'confidence', 'is', 'High'), JSON.stringify(r.spec));
  const res = F.run(r.spec, A);
  assert.equal(res.rows.length, 10); assert.ok(res.matched >= 10, 'matched before the limit');
  assert.ok(res.rows.every(x => x.confidence === 'High'));
  for (let i = 1; i < res.rows.length; i++) assert.ok(res.rows[i - 1].gain >= res.rows[i].gain, 'sorted by estimate');
  const g = P('opportunities worth at least 50 clicks a month');
  assert.ok(has(g.spec, 'gain', 'gte', 50), JSON.stringify(g.spec));
  assert.ok(F.run(g.spec, A).rows.every(x => x.gain >= 50));
  // "in the top 10" stays a position
  assert.ok(has(P('pages in the top 10').spec, 'pos', 'lte', 10));
  assert.ok(P('top 20 pages').spec.limit === 20 && P('top 20 pages').spec.sort.f === 'clicks');
});
test('folders: for pages their own URL, for searches the page that ranks', () => {
  const p1 = P('/guides/ pages with low ctr');
  assert.ok(has(p1.spec, 'section', 'is', '/guides/') && p1.spec.target === 'page');
  const q1 = P('quick wins in the blog folder');
  assert.ok(q1.spec.target === 'query' && has(q1.spec, 'section', 'is', '/blog/'));
  const rows = F.run(q1.spec, A).rows;
  assert.ok(rows.length > 0 && rows.every(r => r.landingPath.startsWith('/blog/')), 'every search ranks with a /blog/ page');
  const missing = P('pages in the recipes folder');
  assert.ok(missing.issues.some(i => i.kind === 'folder' && /No pages under \/recipes\//.test(i.text)), 'unknown folder explained');
});

// ── ambiguous requests get a short question, never a guess ──
test('a number without a metric asks which metric', () => {
  const r = P('more than 1000');
  assert.equal(r.spec.conds.length, 0, 'nothing guessed');
  const q = r.questions.find(x => x.kind === 'number');
  assert.ok(q && /more than 1,000/.test(q.text), JSON.stringify(r.questions));
  assert.deep(q.options.map(o => o.label).slice(0, 2), ['More than 1,000 impressions', 'More than 1,000 clicks']);
  const ans = F.applyPatch(r.spec, q.options[0].patch).spec;
  assert.ok(has(ans, 'impr', 'gt', 1000), 'answer applies the condition');
  const pc = P('pages with more than 5%').questions.find(x => x.kind === 'number');
  assert.ok(pc && pc.options[0].label === 'CTR more than 5%', 'a percentage offers CTR');
});
test('unused words are asked about, with the folder when one matches', () => {
  const r = P('show me blog');
  const q = r.questions.find(x => x.kind === 'word' && x.word === 'blog');
  assert.ok(q, JSON.stringify(r.questions));
  assert.equal(q.options[0].label, 'Pages in /blog/');
  const a = F.applyPatch(r.spec, q.options[0].patch);
  assert.ok(a.spec.target === 'page' && has(a.spec, 'section', 'is', '/blog/'));
  assert.ok(!P('make me a sandwich').understood, 'nonsense is not "understood"');
});
test('searches or pages: asked when nothing in the request says which', () => {
  assert.ok(P('more than 500 impressions').questions.some(q => q.kind === 'target'));
  assert.ok(!P('pages with more than 500 impressions').questions.some(q => q.kind === 'target'));
  assert.ok(!P('keywords with more than 500 impressions').questions.some(q => q.kind === 'target'));
});

// ── what the loaded data cannot answer ──
test('devices: explained, not silently dropped; offered as a word instead', () => {
  const r = P('pages losing clicks on mobile');
  const i = r.issues.find(x => x.kind === 'device');
  assert.ok(i && /all devices together/.test(i.text) && !i.action, 'sample data: no re-run button');
  assert.ok(r.questions.some(q => q.kind === 'device'), 'offers “contains mobile”');
  const apiA = CW.analyse({ ...D, source: 'api', filters: { type: 'web', device: '' } }, S);
  const ri = F.parse('pages losing clicks on mobile', apiA).issues.find(x => x.kind === 'device');
  assert.equal(JSON.stringify(ri.action), JSON.stringify({ type: 'device', value: 'MOBILE' }), 'Search Console: offers a re-run');
  const mob = CW.analyse({ ...D, source: 'api', filters: { type: 'web', device: 'MOBILE' } }, S);
  const rm = F.parse('pages on mobile', mob);
  assert.ok(rm.notes.includes('device-ok') && !rm.issues.some(x => x.kind === 'device'), 'already mobile only');
});
test('searcher location is not confused with places in the search', () => {
  const r = P('keywords from users in India');
  assert.ok(!r.spec.conds.some(c => c.f === 'place'), 'no place condition added on its own');
  assert.ok(r.issues.some(i => i.kind === 'searcher-location' && /country, never their city/.test(i.text)));
  const q = r.questions.find(x => x.kind === 'place');
  assert.ok(q && /mention India/.test(q.text));
  assert.ok(has(F.applyPatch(r.spec, q.options[0].patch).spec, 'place', 'is', 'India'));
  assert.ok(P('keywords by country').issues.some(i => i.kind === 'country'));
});
test('requested dates are compared with the loaded range', () => {
  const r = P('searches in the last 28 days with ctr below 2%');
  const i = r.issues.find(x => x.kind === 'dates');
  assert.ok(i && /last 28 days/.test(i.text) && new RegExp(`covers ${A.days} days`).test(i.text), i && i.text);
  assert.equal(i.action, null, 'an upload cannot switch dates');
  assert.ok(P('searches in the last 3 months').notes.includes('date-ok'), '90 days matches 3 months');
  const apiA = CW.analyse({ ...D, source: 'api' }, S);
  assert.equal(JSON.stringify(F.parse('pages in the last 28 days', apiA).issues.find(x => x.kind === 'dates').action), JSON.stringify({ type: 'dates', days: 28 }));
  assert.ok(P('pages in the last 2 years').issues.some(x => /16 months/.test(x.text)));
});
test('declines without a comparison period: explained and blocked', () => {
  const noPrev = CW.analyse({ ...D, prevQ: null, prevP: null, prevC: null }, S);
  const r = F.parse('pages losing clicks', noPrev);
  const errs = F.validate(r.spec, F.rows(noPrev));
  assert.ok(errs.some(e => /needs a comparison period/.test(e)), errs.join(' '));
  const r2 = F.parse('early warnings', noPrev);
  assert.ok(r2.issues.some(i => i.kind === 'compare'));
});
test('a folder for searches without query-page data: question and plain error', () => {
  const noQP = CW.analyse({ ...D, QP: null }, S);
  const r = F.parse('quick wins in the blog folder', noQP);
  const q = r.questions.find(x => x.kind === 'folder');
  assert.ok(q && q.options[0].label === 'Pages in /blog/', JSON.stringify(r.questions));
  assert.ok(F.validate(r.spec, F.rows(noQP)).some(e => /which page ranks for each search/.test(e)));
  assert.equal(F.applyPatch(r.spec, q.options[0].patch).spec.target, 'page');
});

// ── invalid goals ──
test('contradictory conditions are refused with a plain message', () => {
  const r = P('top 3 positions and between positions 5 and 15');
  const e = F.validate(r.spec, R);
  assert.ok(e.some(x => /can't all be true at once/.test(x)), e.join(' '));
  assert.ok(F.validate({ target: 'query', conds: [{ f: 'brand', op: 'is', v: true }, { f: 'brand', op: 'is', v: false }] }, R).some(x => /both yes and no/.test(x)));
  assert.ok(F.validate({ target: 'query', conds: [{ f: 'intent', op: 'is', v: 'info' }, { f: 'intent', op: 'is', v: 'comm' }] }, R).some(x => /at the same time/.test(x)));
  assert.ok(!F.validate({ target: 'query', conds: [{ f: 'pos', op: 'gte', v: 5 }, { f: 'pos', op: 'lte', v: 5 }] }, R).length, 'touching ranges are fine');
  assert.ok(F.validate({ target: 'query', conds: [{ f: 'pos', op: 'gt', v: 5 }, { f: 'pos', op: 'lt', v: 5 }] }, R).length, 'open ranges that do not meet');
});
test('bad values, kinds, limits and sorting are refused', () => {
  const V = s => F.validate(s, R);
  assert.ok(V({ target: 'query', conds: [{ f: 'opp', op: 'is', v: 'everything' }] }).length, 'unknown opportunity kind');
  assert.ok(V({ target: 'query', conds: [{ f: 'confidence', op: 'is', v: 'Very high' }] }).length, 'unknown confidence');
  assert.ok(V({ target: 'query', conds: [], limit: 0 }).length && V({ target: 'query', conds: [], limit: 2.5 }).length && V({ target: 'query', conds: [], limit: 1e6 }).length, 'limit');
  assert.ok(V({ target: 'query', conds: [], sort: { f: 'text', dir: 'desc' } }).length && V({ target: 'query', conds: [], sort: { f: 'gain', dir: 'sideways' } }).length, 'sort');
  assert.ok(!V({ target: 'query', conds: [], limit: 20, sort: { f: 'gain', dir: 'desc' } }).length, 'valid limit and sort');
});
test('saved goals are checked before they run', () => {
  const good = WF.makeGoal('Fix first', 'which pages should I fix first', P('which pages should I fix first').spec);
  assert.equal(WF.validateGoal(good).length, 0);
  assert.ok(WF.validateGoal(null).length && WF.validateGoal('x').length && WF.validateGoal([]).length, 'not an object');
  assert.ok(WF.validateGoal({ ...good, v: 2 }).length, 'other version');
  assert.ok(WF.validateGoal({ ...good, name: '' }).length && WF.validateGoal({ ...good, name: 'x'.repeat(81) }).length, 'name');
  assert.ok(WF.validateGoal({ ...good, spec: { ...good.spec, conds: [{ f: 'clicks', op: 'gt', v: 1, run: 'alert(1)' }] } }).length, 'unexpected keys in a condition');
  assert.ok(WF.validateGoal({ ...good, spec: { ...good.spec, script: 'x' } }).length, 'unexpected settings');
  const bad = WF.runGoal({ ...good, v: 9 }, A);
  assert.equal(bad.record.status, 'failed'); assert.ok(!bad.result, 'nothing ran');
});
test('text values stay literal: patterns and markup are just text', () => {
  ['(a+)+$', '.*', '<img src=x onerror=alert(1)>', "'; DROP TABLE", '${process.exit()}'].forEach(v => {
    const r = F.parse(`searches containing "${v}"`, A);
    assert.ok(has(r.spec, 'text', 'contains', v.toLowerCase()), v + ' (text matching ignores case, so values are lowercased)');
    const res = F.run(r.spec, A); assert.ok(res.ok && res.rows.length === 0, 'matched literally: ' + v);
  });
});

// ── execution ──
test('preview and run agree; the funnel ends at the match count', () => {
  ['Which pages should I fix first?', 'Non-branded keywords ranking between positions 5 and 15', 'Pages with high impressions but not generating enough clicks', 'Top 10 opportunities with high confidence'].forEach(text => {
    const spec = P(text).spec;
    const preview = F.run(spec, A);
    const out = WF.runGoal(WF.makeGoal(text, text, spec), A, new Date('2026-10-16T10:00:00Z'));
    assert.equal(out.record.status, 'done', text);
    assert.equal(out.record.count, preview.rows.length, 'same count: ' + text);
    assert.deep(out.result.rows.slice(0, 10).map(r => r.q || r.p), preview.rows.slice(0, 10).map(r => r.q || r.p), 'same first rows: ' + text);
    const fun = F.funnel(spec, A);
    assert.equal(fun[fun.length - 1].n, preview.matched, 'funnel ends at the match count: ' + text);
    for (let i = 1; i < fun.length; i++) assert.ok(fun[i].n <= fun[i - 1].n, 'each condition only narrows');
  });
});
test('run records: status, counts, data, timing; needs-data vs failed', () => {
  const spec = P('pages losing clicks').spec;
  const g = WF.makeGoal('Losing', 'pages losing clicks', spec);
  const out = WF.runGoal(g, A, new Date('2026-10-16T10:00:00Z'));
  const r = out.record;
  assert.equal(r.at, '2026-10-16T10:00:00.000Z');
  assert.ok(r.status === 'done' && r.count > 0 && r.errors.length === 0 && typeof r.ms === 'number');
  assert.equal(r.data.site, D.site); assert.equal(r.data.days, A.days);
  const noPrev = CW.analyse({ ...D, prevQ: null, prevP: null, prevC: null }, S);
  const nd = WF.runGoal(g, noPrev).record;
  assert.equal(nd.status, 'needs-data', 'same goal, data without a comparison');
  assert.ok(/comparison period/.test(nd.errors[0]));
  const contra = WF.runGoal(WF.makeGoal('x', '', P('top 3 positions and between positions 5 and 15').spec), A).record;
  assert.equal(contra.status, 'failed');
});
test('a saved goal survives storage and re-runs identically', () => {
  const g = WF.makeGoal('Quick wins in blog', 'quick wins in the blog folder', P('quick wins in the blog folder').spec);
  const back = JSON.parse(JSON.stringify(g));
  assert.equal(WF.validateGoal(back).length, 0);
  const a = WF.runGoal(g, A).result.rows.map(r => r.q), b = WF.runGoal(back, A).result.rows.map(r => r.q);
  assert.deep(a, b);
  // the saved copy is independent of later edits to the spec it was made from
  const spec = P('titles to rewrite').spec, saved = WF.makeGoal('t', '', spec);
  spec.conds.push({ f: 'clicks', op: 'gt', v: 1e9 });
  assert.ok(WF.runGoal(saved, A).record.count > 0, 'deep copy');
});
test('answering questions: switching to pages drops search-only conditions and says so', () => {
  const r = P('non-branded keywords with more than 500 impressions');
  const a = F.applyPatch(r.spec, { target: 'page' });
  assert.ok(!has(a.spec, 'brand') && has(a.spec, 'impr', 'gt', 500));
  assert.ok(a.dropped.some(d => /Non-branded/.test(d)), 'reported: ' + a.dropped);
  assert.ok(!has(F.applyPatch(P('blog pages with zero clicks').spec, { removeField: 'section' }).spec, 'section'), 'removeField');
});

// ── consistency with Losing ground ──
test('change in clicks uses the same period scaling as Losing ground', () => {
  const q = (t, c, i, p) => ({ q: t, clicks: c, impr: i, ctr: c / i * 100, pos: p });
  const pg = (u, c, i, p) => ({ p: 'https://s.test' + u, clicks: c, impr: i, ctr: c / i * 100, pos: p });
  const small = k => Array.from({ length: 10 }, (_, i) => pg('/s' + i, 10 * k, 1000 * k, 7));
  const days = (n, start) => Array.from({ length: n }, (_, i) => { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return { d: d.toISOString().slice(0, 10), clicks: 100, impr: 5000, ctr: 2, pos: 6 }; });
  const Dx = { site: 's.test', source: 'api', Q: [q('a b', 5, 100, 5)], prevQ: [q('a b', 10, 200, 5)], P: [pg('/w', 40, 4000, 5)].concat(small(1)), prevP: [pg('/w', 200, 8000, 5)].concat(small(2)), C: days(30, '2026-03-01'), prevC: days(60, '2026-01-01'), days: 30 };
  const Ax = CW.analyse(Dx, { brand: [], exclude: [] });
  const eng = Ax.decay.pages.find(r => r.path === '/w');
  const row = F.rows(Ax).page.find(r => r.path === '/w');
  assert.near(row.prevClicks, 100, 1e-9, 'previous 200 clicks over 60 days → 100 per 30');
  assert.near(row.clickChange, eng.ch, 1e-9, 'same change as Losing ground');
});

test('numbers beyond the questions asked are reported as not used', () => {
  const r = P('more than 1000 and more than 2000 and over 3000');
  assert.equal(r.questions.filter(q => q.kind === 'number').length, 2);
  assert.ok(r.unknown.some(w => /3000/.test(w)), 'third number listed: ' + r.unknown);
});

// ── the five requests from the Milestone B brief ──
test('brief: internship keywords in Delhi, impressions and positions', () => {
  const r = P('Find internship keywords in Delhi with more than 1,000 impressions and positions between 5 and 15.');
  assert.ok(r.spec.target === 'query' && has(r.spec, 'text', 'contains', 'internship') && has(r.spec, 'place', 'is', 'Delhi') && has(r.spec, 'impr', 'gt', 1000) && has(r.spec, 'pos', 'between', 5, 15) && !r.unknown.length && !r.questions.length, JSON.stringify(r));
});
test('brief: pages with high impressions but low CTR', () => {
  const r = P('Find pages with high impressions but low CTR.');
  assert.ok(r.spec.target === 'page' && has(r.spec, 'impr', 'gte', R.high.page) && has(r.spec, 'ctrGap', 'lt', 60) && !r.unknown.length, JSON.stringify(r));
  const rows = F.run(r.spec, A).rows;
  assert.ok(rows.every(x => x.impr >= R.high.page && x.ctr < x.bench * 0.6), 'rows meet both conditions');
});
test('brief: queries losing clicks compared with the previous period', () => {
  const r = P('Identify queries losing clicks compared with the previous period.');
  assert.ok(r.spec.target === 'query' && has(r.spec, 'clickChange', 'lt', 0) && r.spec.conds.length === 1 && !r.unknown.length && !r.questions.length, JSON.stringify(r));
  assert.ok(F.run(r.spec, A).rows.every(x => x.clickChange < 0));
  const noPrev = CW.analyse({ ...D, prevQ: null, prevP: null, prevC: null }, S);
  assert.ok(F.validate(F.parse('Identify queries losing clicks compared with the previous period.', noPrev).spec, F.rows(noPrev)).some(e => /comparison period/.test(e)), 'unavailable comparison explained');
  const q = P('queries compared to last month');
  assert.ok(q.questions.some(x => x.kind === 'compare'), 'a comparison with no direction asks which change');
  assert.ok(F.parse('queries compared to last month', noPrev).issues.some(i => i.kind === 'compare'), 'and says when there is nothing to compare with');
});
test('brief: keywords close to page one', () => {
  const r = P('Find keywords close to page one.');
  assert.ok(r.spec.target === 'query' && has(r.spec, 'pos', 'between', 4, 20) && !r.unknown.length, JSON.stringify(r));
});
test('brief: content opportunities from existing search data', () => {
  const r = P('Find content opportunities from existing search data.');
  assert.ok(has(r.spec, 'opp', 'is', 'growth') && r.notes.includes('content') && !r.unknown.length && !r.questions.length, JSON.stringify(r));
  assert.ok(F.run(r.spec, A).rows.length > 0);
});

process.exitCode = report('goals') ? 1 : 0;

// Tests for the content assistant (content.js): topic clusters, content gaps, page improvements, internal
// links, crawler link exports and briefs. Synthetic fixtures have hand-checkable answers; the sample site
// checks that nothing is invented.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_CONTENT: K, CW_OPPS: OP, CW_FILTERS: F, CW_WORKFLOWS: WF } = W;

const q = (t, c, i, p) => ({ q: t, clicks: c, impr: i, ctr: i ? c / i * 100 : 0, pos: p });
const pg = (u, c, i, p) => ({ p: 'https://site.test' + u, clicks: c, impr: i, ctr: i ? c / i * 100 : 0, pos: p });
const qp = (t, u, c, i, p) => ({ q: t, p: 'https://site.test' + u, clicks: c, impr: i, ctr: i ? c / i * 100 : 0, pos: p });
const filler = n => Array.from({ length: n }, (_, i) => q(`unrelated topic${i}`, 2, 60, 6));
const S0 = { brand: ['acme'], exclude: [] };
function run(D, S = S0, opts = {}) { const A = CW.analyse(D, S); A.content = K.build(A, D, { brand: S.brand, ...opts }); A.opps = OP.build(A, D); return A; }

// The sample site, with every source of URLs the engine may name
const DEMO = W.CW_DEMO.build();
const SD = { brand: ['trailcraft'], exclude: ['/login'] };
const AD = run(DEMO, SD);
const known = new Set(DEMO.P.map(r => r.p).concat(DEMO.QP.map(r => r.p)));
const queries = new Set(DEMO.Q.map(r => r.q));

// ── C1: topic clusters ──
test('clusters: shared words group searches; plurals match; one generic word does not', () => {
  const Q = [q('blue widget', 50, 2000, 5), q('best blue widgets', 20, 900, 7), q('blue widget price', 10, 500, 6), q('red gadget', 30, 1500, 4), q('red gadget review', 5, 300, 9), q('widget repair kit', 3, 200, 12)].concat(filler(20));
  const A = run({ site: 's', source: 'file', Q, P: [pg('/a', 10, 100, 5)], C: [], days: 30 });
  const T = A.content.topics;
  const of = s => T.find(t => t.rows.some(r => r.q === s)).id;
  assert.equal(of('best blue widgets'), of('blue widget'), 'plural and modifier join');
  assert.equal(of('blue widget price'), of('blue widget'));
  assert.equal(of('red gadget review'), of('red gadget'));
  assert.ok(of('red gadget') !== of('blue widget'), 'different topics stay apart');
  assert.ok(of('widget repair kit') !== of('blue widget'), 'one shared word out of four is not a topic');
  const all = T.flatMap(t => t.rows.map(r => r.q));
  assert.equal(all.length, new Set(all).size, 'every search in exactly one topic');
  assert.equal(T.find(t => t.id === of('blue widget')).label, 'blue widget', 'labelled by the strongest search');
});
test('clusters: brand words are ignored; branded searches are left out', () => {
  const Q = [q('acme blue widget', 50, 900, 2), q('blue widget', 40, 2000, 5), q('acme login', 10, 400, 1)].concat(filler(20));
  const A = run({ site: 's', source: 'file', Q, P: [pg('/a', 10, 100, 5)], C: [], days: 30 });
  const all = A.content.topics.flatMap(t => t.rows.map(r => r.q));
  assert.ok(!all.includes('acme login') && !all.includes('acme blue widget'), 'branded searches excluded');
});
test('clusters: the same ranking page lets looser wording join (Search Console data only)', () => {
  const Q = [q('trek shoes guide', 30, 1500, 6), q('shoes guide for hiking women', 10, 800, 8)].concat(filler(20));
  const P = [pg('/shoes', 40, 2300, 7)];
  const QP = [qp('trek shoes guide', '/shoes', 30, 1500, 6), qp('shoes guide for hiking women', '/shoes', 10, 800, 8)];  // 2 of 5 words shared (0.4)
  const withQP = run({ site: 's', source: 'api', Q, P, QP, C: [], days: 30 }).content.topics;
  const noQP = run({ site: 's', source: 'file', Q, P, C: [], days: 30 }).content.topics;
  const same = T => T.find(t => t.rows.some(r => r.q === 'trek shoes guide')).rows.some(r => r.q === 'shoes guide for hiking women');
  assert.ok(same(withQP), 'joined: same page and a shared word');
  assert.ok(!same(noQP), 'without page data, one shared word is not enough');
});
test('clusters: deterministic, and fast on 100,000 searches', () => {
  const again = K.build(AD, DEMO, { brand: SD.brand });
  assert.deep(again.topics.map(t => [t.id, t.label, t.n]), AD.content.topics.map(t => [t.id, t.label, t.n]));
  const mods = ['best', 'price', 'review', 'online', 'india', 'for women', 'for men', 'near me', 'cheap', 'how to clean', 'size guide', 'sale', 'discount', '2026', 'waterproof', 'lightweight', 'for kids', 'under 5000', 'buy', 'store', 'rental', 'used', 'repair', 'warranty', 'colors', 'weight', 'material', 'compare', 'top', 'new', 'set', 'pair', 'kit', 'pro', 'max', 'mini', 'plus', 'xl', 'small', 'large', 'black', 'white', 'red', 'blue', 'green', 'grey', 'pink', 'gold', 'silver', 'brown'];
  const Q = []; for (let i = 0; i < 2000; i++) mods.forEach((m, j) => Q.push(q(`product${i} ${['shoes', 'boots', 'tent', 'jacket', 'bag'][i % 5]} ${m}`, j % 5, 100 + (i * 7 + j) % 400, 3 + (i + j) % 25)));
  const A = CW.analyse({ site: 's', source: 'api', Q, P: [pg('/a', 1, 10, 3)], C: [], days: 90 }, { brand: [], exclude: [] });
  const t0 = Date.now(); const C = K.build(A, A.data, { brand: [] }); const ms = Date.now() - t0;
  assert.ok(ms < 4000, `${ms} ms for ${Q.length} searches`);
  assert.ok(C.topics.length >= 2000 && C.topics.length <= 2100, `${C.topics.length} topics from 2,000 products`);
});

// ── C2: gaps ──
function gapData() {
  const Q = [
    q('blue widget', 5, 3000, 14), q('blue widget price', 2, 1200, 16), q('blue widget review', 1, 900, 18),           // nothing on page one
    q('green gizmo', 30, 2500, 5), q('green gizmo size', 10, 1200, 6),                                               // split across pages about it
    q('silver gear', 30, 2600, 4),                                               // matching page + unrelated pages
    q('yellow thing', 20, 2500, 3),                                                                                 // only the homepage
    q('how to fix a widget', 2, 900, 13), q('how to fix a widget fast', 1, 700, 15), q('fix a widget', 40, 1000, 3)  // questions unanswered
  ].concat(filler(30));
  const P = [pg('/', 100, 5000, 2), pg('/blue', 8, 5100, 15), pg('/green-gizmo', 20, 1800, 5), pg('/gizmos/green-gizmo-guide', 20, 1900, 6), pg('/green-gizmo-sizes', 10, 900, 7), pg('/about', 5, 400, 8), pg('/silver-gear', 20, 1500, 4), pg('/contact', 3, 600, 9), pg('/fix-widget', 40, 2600, 8)];
  const QP = [qp('blue widget', '/blue', 5, 3000, 14), qp('blue widget price', '/blue', 2, 1200, 16), qp('blue widget review', '/blue', 1, 900, 18),
    qp('green gizmo', '/green-gizmo', 12, 900, 5), qp('green gizmo', '/gizmos/green-gizmo-guide', 10, 800, 5), qp('green gizmo', '/green-gizmo-sizes', 8, 800, 6), qp('green gizmo size', '/green-gizmo', 4, 400, 6), qp('green gizmo size', '/gizmos/green-gizmo-guide', 3, 400, 6), qp('green gizmo size', '/green-gizmo-sizes', 3, 400, 7),
    qp('silver gear', '/silver-gear', 12, 950, 4), qp('silver gear', '/about', 10, 850, 4), qp('silver gear', '/contact', 8, 800, 5),
    qp('yellow thing', '/', 20, 2500, 3),
    qp('how to fix a widget', '/fix-widget', 2, 900, 13), qp('how to fix a widget fast', '/fix-widget', 1, 700, 15), qp('fix a widget', '/fix-widget', 40, 1000, 3)];
  return { site: 'site.test', source: 'api', Q, P, QP, C: [], days: 30 };
}
const GA = run(gapData());
const gapOf = label => GA.content.gaps.find(g => g.label === label);
test('gaps: nothing on page one', () => {
  const g = gapOf('blue widget');
  assert.ok(g && g.kinds.includes('unranked') && /best position is 14/.test(g.evidence[0]), JSON.stringify(g && g.evidence));
  assert.ok(g.target && g.target.path === '/blue' && /Expand \/blue/.test(g.action));
});
test('gaps: split across pages about the topic → merge; matching page plus unrelated → strengthen it', () => {
  const s = gapOf('green gizmo');
  assert.ok(s && s.kinds.includes('scattered') && /Pick one page/.test(s.action), JSON.stringify(s));
  const d = gapOf('silver gear');
  assert.ok(d && d.kinds.includes('diluted') && d.target.path === '/silver-gear' && /Make \/silver-gear the clear answer/.test(d.action), JSON.stringify(d));
  assert.ok(!d.kinds.includes('scattered'), 'unrelated pages are not called duplicates');
});
test('gaps: only the homepage ranks; questions without a good answer', () => {
  const h = gapOf('yellow thing');
  assert.ok(h && h.kinds.includes('homepage') && !h.target && /dedicated/.test(h.action), JSON.stringify(h));
  const qn = GA.content.gaps.find(g => g.kinds.includes('questions'));
  assert.ok(qn && /how to fix a widget/.test(qn.evidence.join(' ')), JSON.stringify(GA.content.gaps.map(g => [g.label, g.kinds])));
});
test('gaps: small topics are not gaps; impressions are labelled as this site\'s own', () => {
  assert.ok(!GA.content.gaps.some(g => g.impr < GA.content.gapFloor));
  const it = GA.opps.items.find(x => x.type === 'content-gap');
  assert.ok(it && it.warnings.some(w => /not the total searches/.test(w)));
});

// ── C2: page improvements ──
test('page improvements: searches close to page one, per ranking page', () => {
  const x = GA.content.improvements.find(i => i.path === '/blue');
  assert.ok(x && x.near.map(r => r.q).join() === 'blue widget,blue widget price,blue widget review', JSON.stringify(x && x.near.map(r => r.q)));
  assert.ok(/Add or expand a section/.test(x.actions[0]));
  const exp = run({ ...gapData(), QP: null, source: 'file' }).content;
  assert.equal(exp.mode, 'export');
  assert.ok(exp.improvements.every(i => i.pageOnly && !i.near.length && /connect Search Console/.test(i.actions[0])), 'an export only knows page positions');
});

// ── C3: internal links ──
test('links: sources rank on page one for the same topic; anchor is the target\'s own search', () => {
  const Q = [q('alpha tool', 5, 3000, 9), q('alpha tool guide', 60, 1500, 2), q('beta thing', 40, 900, 3)].concat(filler(20));
  const P = [pg('/alpha-tool', 5, 3000, 9), pg('/guides/alpha-tool', 60, 1500, 2), pg('/beta', 40, 900, 3)];
  const QP = [qp('alpha tool', '/alpha-tool', 5, 3000, 9), qp('alpha tool guide', '/guides/alpha-tool', 60, 1500, 2), qp('beta thing', '/beta', 40, 900, 3)];
  const A = run({ site: 'site.test', source: 'api', Q, P, QP, C: [], days: 30 });
  const l = A.content.links.find(x => x.path === '/alpha-tool');
  assert.ok(l, JSON.stringify(A.content.links));
  assert.equal(l.anchor, 'alpha tool');
  assert.deep(l.sources.map(s => s.path), ['/guides/alpha-tool'], 'the unrelated /beta page is not a source');
  assert.ok(/ranks at 2\.0 for “alpha tool guide”/.test(l.sources[0].why));
  // with a crawler export that already has this link, it is dropped and counted
  const csv = 'Type,Source,Destination,Anchor\nHyperlink,https://www.site.test/guides/alpha-tool/,https://site.test/alpha-tool,alpha\n';
  const inl = K.parseLinks(csv, 'site.test');
  const B = run({ site: 'site.test', source: 'api', Q, P, QP, C: [], days: 30 }, S0, { inlinks: inl });
  assert.ok(!B.content.links.some(x => x.path === '/alpha-tool') && B.content.alreadyLinked === 1, 'existing link removed');
});
test('links and briefs never name a page or anchor that is not in the data', () => {
  const C = AD.content;
  const urls = [].concat(C.gaps.filter(g => g.target).map(g => g.target.p), C.improvements.map(i => i.p), C.links.flatMap(l => [l.p].concat(l.sources.map(s => s.p))), C.briefs.flatMap(b => (b.target ? [b.target.p] : []).concat(b.linkFrom.map(s => s.p))));
  assert.ok(urls.length > 20, `${urls.length} URLs checked`);
  urls.forEach(u => assert.ok(known.has(u), 'invented URL: ' + u));
  C.links.forEach(l => { assert.ok(!l.anchor || queries.has(l.anchor), 'anchor is a real search: ' + l.anchor); assert.ok(!l.sources.some(s => s.p === l.p), 'no self-links'); });
  assert.ok(!urls.some(u => /\/login/.test(u)), 'excluded pages never suggested');
});
test('links without search-to-page data: same folder only, Low confidence', () => {
  const D = { ...DEMO, QP: null, source: 'file' };
  const A = run(D, SD);
  assert.equal(A.content.mode, 'export');
  assert.ok(A.content.links.length > 0 && A.content.links.every(l => l.evidence === 'folder' && l.anchor === null));
  A.content.links.forEach(l => { const f = '/' + l.path.split('/')[1] + '/'; assert.ok(l.sources.every(s => s.path.startsWith(f)), 'same folder'); });
  assert.ok(A.opps.items.filter(i => i.type === 'internal-link').every(i => i.confidence.level === 'Low'));
});

// ── crawler link exports ──
test('link exports: Screaming Frog, tab and semicolon files, quotes and a BOM', () => {
  const sf = '﻿"Type","Source","Destination","Size (Bytes)","Alt Text","Anchor"\n"Hyperlink","https://site.test/a","https://site.test/b","","","Read, more"\n"Image","https://site.test/a","https://site.test/img.png","","x",""\n"Hyperlink","https://other.test/x","https://site.test/b","","",""\n';
  const r = K.parseLinks(sf, 'site.test');
  assert.ok(r.ok && r.count === 1 && r.links.has('site.test/a → site.test/b') && r.links.get('site.test/a → site.test/b') === 'Read, more', JSON.stringify(r));
  const tsv = K.parseLinks('Source URL\tTarget URL\nhttps://site.test/a/\thttps://site.test/c#top\n', 'site.test');
  assert.ok(tsv.ok && tsv.links.has('site.test/a → site.test/c'), 'tab-separated, trailing slash and #fragment normalised');
  const semi = K.parseLinks('From;To\nhttps://site.test/a;https://site.test/d\n', 'site.test');
  assert.ok(semi.ok && semi.links.has('site.test/a → site.test/d'));
});
test('link exports: wrong or empty files are refused with a plain message', () => {
  assert.ok(/no rows/.test(K.parseLinks('', 'site.test').error));
  assert.ok(/source and destination columns/.test(K.parseLinks('Query,Clicks\nfoo,3\n', 'site.test').error));
  assert.ok(/No links between pages on site.test/.test(K.parseLinks('Source,Destination\nhttps://x.test/a,https://x.test/b\n', 'site.test').error));
  assert.equal(K.normUrl('HTTPS://WWW.Site.test/Path/?a=1#x'), 'site.test/Path/?a=1');
});

// ── C4: briefs ──
test('briefs: title, headings and searches all come from the topic\'s real searches', () => {
  assert.ok(AD.content.briefs.length > 0);
  AD.content.briefs.forEach(b => {
    const t = AD.content.topics.find(x => x.id === b.id), qs = new Set(t.rows.map(r => r.q.toLowerCase()));
    assert.ok(qs.has(b.title.toLowerCase()), 'title is a real search: ' + b.title);
    b.headings.forEach(h => assert.ok(qs.has(h.toLowerCase().replace(/\?$/, '')), 'heading is a real search: ' + h));
    b.queries.forEach(x => assert.ok(qs.has(x.q.toLowerCase())));
    const text = K.briefText(b);
    assert.ok(text.includes(b.title) && /fixed rules/.test(text), 'copyable text says how it was made');
  });
});

// ── integration ──
test('All opportunities lists gaps and links without changing any total', () => {
  const base = CW.analyse(DEMO, SD); const O0 = OP.build(base, DEMO);
  assert.near(AD.opps.totals.growth.hi, O0.totals.growth.hi, 1e-6, 'growth unchanged');
  assert.near(AD.opps.totals.recovery.hi, O0.totals.recovery.hi, 1e-6, 'recovery unchanged');
  const added = AD.opps.items.filter(i => i.type === 'content-gap' || i.type === 'internal-link');
  assert.equal(added.length, AD.content.gaps.length + AD.content.links.length);
  assert.ok(added.every(i => i.impact.kind === 'none' && !i.impact.counted && i.confidence.level !== 'High'), 'no estimates, never High');
});
test('Goal builder: content gaps and internal links', () => {
  const g = F.parse('content gaps', AD);
  assert.ok(g.spec.conds.some(c => c.f === 'opp' && c.v === 'gap') && !g.unknown.length);
  assert.equal(F.run(g.spec, AD).rows.length, AD.content.gaps.length, 'one row per gap');
  const l = F.parse('internal links for pages close to page one', AD);
  assert.ok(l.spec.target === 'page' && l.spec.conds.some(c => c.f === 'opp' && c.v === 'link'), JSON.stringify(l.spec));
  const wf = WF.run('links', AD, {});
  assert.equal(wf.table.rows.length, AD.content.links.length, 'the links workflow uses the same suggestions');
});

process.exitCode = report('content') ? 1 : 0;

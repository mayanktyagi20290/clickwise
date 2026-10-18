// Tests for the white-label report (report.js): checking saved branding, readable text on the brand colour,
// and what goes on the page, against the fictional sample site. Saving and logos are covered by the browser test.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load();
const { CW, CW_REPORT: R } = W;

const D = W.CW_DEMO.build();
const S = { brand: ['trailcraft'], exclude: ['/login'] };
const A = CW.analyse(D, S);
A.opps = W.CW_OPPS.build(A, D);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('clean: good values are kept', () => {
  const c = R.clean({ agency: '  Northstar SEO ', contact: 'hello@northstar.example', color: '#0F766E', logo: PNG, client: 'Trailcraft', clientLogo: PNG, notes: 'Line one\nLine two', showClickwise: false, details: false });
  assert.equal(c.agency, 'Northstar SEO');
  assert.equal(c.color, '#0F766E');
  assert.equal(c.logo, PNG); assert.equal(c.clientLogo, PNG);
  assert.equal(c.notes, 'Line one\nLine two', 'line breaks in notes survive');
  assert.equal(c.showClickwise, false); assert.equal(c.details, false);
});
test('clean: anything odd falls back to the default', () => {
  const c = R.clean({ color: 'red; background:url(x)', logo: 'data:image/svg+xml;base64,PHN2Zz4=', clientLogo: 'javascript:alert(1)', agency: 42, notes: null });
  assert.equal(c.color, R.DEFAULT.color, 'only #rrggbb colours');
  assert.equal(c.logo, null, 'SVG (which can carry script) is refused');
  assert.equal(c.clientLogo, null, 'non-image URLs are refused');
  assert.equal(c.agency, ''); assert.equal(c.notes, '');
  assert.equal(R.clean({ logo: PNG.replace('base64,', 'base64,"><script>') }).logo, null, 'markup inside a data URL is refused');
  assert.equal(R.clean({ logo: 'data:image/png;base64,' + 'A'.repeat(300000) }).logo, null, 'oversized logos are refused');
  const d = R.clean(null);
  assert.equal(d.showClickwise, true); assert.equal(d.details, true);
});
test('clean: lengths are capped and control characters removed', () => {
  const c = R.clean({ agency: 'x'.repeat(500), client: 'a\u0000b\u0007c', notes: 'n'.repeat(5000) + '\u0001' });
  assert.equal(c.agency.length, R.LIMIT.agency);
  assert.equal(c.client, 'a b c');
  assert.equal(c.notes.length, R.LIMIT.notes);
});
test('onColor: text stays readable on the brand colour', () => {
  assert.equal(R.onColor('#000000'), '#FFFFFF');
  assert.equal(R.onColor('#FFFFFF'), '#111827');
  assert.equal(R.onColor('#4F46E5'), '#FFFFFF', 'indigo');
  assert.equal(R.onColor('#0F766E'), '#FFFFFF', 'teal');
  assert.equal(R.onColor('#FACC15'), '#111827', 'yellow');
  assert.equal(R.onColor('#A3E635'), '#111827', 'lime');
});
test('what changed: without a comparison period it uses the trend or says so', () => {
  const lines = R.changed(A);
  assert.ok(lines.length >= 1);
  assert.ok(lines.every(l => typeof l === 'string' && l.length > 10));
  assert.ok(/no comparison period/i.test(R.changed({ site: A.site })[0]), 'nothing to compare: says so');
});
test('what changed: with a previous period it gives the change and real pages', () => {
  const ps = { clicks: A.site.clicks / 1.2, impr: A.site.impr * 1.1 };
  const lines = R.changed({ ...A, prevSite: ps, decay: { pages: [{ path: '/a', prev: { clicks: 300 }, cur: { clicks: 120 }, reason: 'position fell 3.0 → 7.5' }], rising: [{ path: '/b', won: 80 }] } });
  assert.ok(/Clicks rose 20(\.0)?%/.test(lines[0]), lines[0]);
  assert.ok(/impressions fell 9\.1%/.test(lines[0]), lines[0]);
  assert.ok(/Biggest drop: \/a, 300 → 120 clicks \(position fell/.test(lines[1]), lines[1]);
  assert.ok(/Biggest gain: \/b, \+80 clicks/.test(lines[2]), lines[2]);
});
test('top actions: the same items as All opportunities, no low confidence, no unmeasured impact', () => {
  const acts = R.topActions(A);
  assert.ok(acts.length > 0 && acts.length <= 5);
  acts.forEach(it => { assert.ok(it.confidence.level !== 'Low' && it.impact.kind !== 'none'); assert.ok(A.opps.items.includes(it)); });
  const order = A.opps.items.filter(it => it.confidence.level !== 'Low' && it.impact.kind !== 'none').slice(0, 5);
  assert.equal(acts.map(i => i.id).join('|'), order.map(i => i.id).join('|'), 'same order as the ranked list');
  assert.equal(R.topActions({}).length, 0, 'no opportunities: empty list');
});

process.exitCode = report('report') ? 1 : 0;

// Minimal test harness: loads the app's pure scripts into a sandbox and runs named tests.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');

// engine, opportunities, demo, filters and workflows have no DOM dependencies.
function load(files = ['engine.js', 'opportunities.js', 'demo.js', 'filters.js', 'workflows.js']) {
  const window = {};
  const ctx = vm.createContext({ window, console, URL, URLSearchParams, Intl, Date, Math, JSON, Set, Map, WeakMap, Array, String, Number, Object, RegExp, Error, isFinite, isNaN, parseFloat, encodeURIComponent, decodeURIComponent });
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return window;
}

// Fixture rows are [label, clicks, impressions, ctr (0–1), position] like the export.
// The real-data fixture is private (gitignored): tests that need it skip when it is missing.
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'real-export-anon.json');
const hasFixture = () => fs.existsSync(FIXTURE);
function fixtureData(file = 'real-export-anon.json') {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', file), 'utf8'));
  const m = (rows, key) => rows.map(r => ({ [key]: r[0], clicks: r[1], impr: r[2], ctr: r[3] * 100, pos: r[4] }));
  const C = m(fx.sheets.Chart, 'd');
  return { fx, D: { site: fx.site, source: 'file', Q: m(fx.sheets.Queries, 'q'), P: m(fx.sheets.Pages, 'p'), C, Dev: m(fx.sheets.Devices, 'd'), Countries: m(fx.sheets.Countries, 'd'), Appearance: m(fx.sheets['Search appearance'], 'd'), start: C[0].d, end: C[C.length - 1].d, days: C.length } };
}

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
async function testAsync(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); },
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); },
  near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || 'not near'}: got ${a}, expected ${b} ± ${tol}`); },
  deep(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || 'not equal'}: got ${x}, expected ${y}`); }
};
function report(label) {
  const bad = results.filter(r => !r.ok);
  // VERBOSE=1 lists every test, not just failures
  results.forEach(r => { if (!r.ok) console.log(`  ✗ ${r.name}\n      ${r.err}`); else if (process.env.VERBOSE) console.log(`  ✓ ${r.name}`); });
  console.log(`${label}: ${results.length - bad.length} passed, ${bad.length} failed`);
  return bad.length;
}

module.exports = { ROOT, load, fixtureData, hasFixture, FIXTURE, test, testAsync, assert, report, results };

// Browser smoke test (Playwright + Chromium). Serves the repo locally and drives the real UI.
// Needs: npm install && npx playwright install chromium
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { ROOT, fixtureData, hasFixture, testAsync, assert, report } = require('./lib/harness');

let chromium, XLSX;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('browser: skipped (Playwright not installed — run npm install)'); process.exit(0); }
try { XLSX = require('xlsx'); } catch (e) { console.log('browser: skipped (xlsx not installed — run npm install)'); process.exit(0); }

// Serve CDN libraries from node_modules when available so the test also runs offline.
const LOCAL = {};
const nm = f => module.paths.concat(path.join(ROOT, 'node_modules')).map(d => path.join(d, f)).find(p => fs.existsSync(p));
[['chart.umd.js', 'chart.js/dist/chart.umd.js'], ['xlsx.full.min.js', 'xlsx/dist/xlsx.full.min.js']].forEach(([k, f]) => { const p = nm(f); if (p) LOCAL[k] = p; });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      fs.readFile(p, (e, b) => { if (e) { rsp.writeHead(404); rsp.end(); return; } rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); rsp.end(b); });
    }).listen(0, () => res(srv));
  });
}

// Build files exactly like Search Console's exports from the anonymised fixture.
function writeExports(dir) {
  const zip = path.join(dir, 'export.zip'); fs.writeFileSync(zip, 'PK');
  const evil = path.join(dir, 'evil.csv');
  fs.writeFileSync(evil, 'Top queries,Clicks,Impressions,CTR,Position\n"=HYPERLINK(""http://x"")",5,50,10%,3\nnormal query,5,50,10%,3\n');
  if (!hasFixture()) return { evil, zip };
  const { fx } = fixtureData();
  const head = { Chart: 'Date', Queries: 'Top queries', Pages: 'Top pages', Countries: 'Country', Devices: 'Device', 'Search appearance': 'Search Appearance' };
  const wb = XLSX.utils.book_new();
  Object.entries(fx.sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[head[name], 'Clicks', 'Impressions', 'CTR', 'Position'], ...rows]), name));
  const xlsx = path.join(dir, 'example.com-Performance-on-Search.xlsx'); XLSX.writeFile(wb, xlsx);
  // CSV download: one file per tab, CTR written as "3.47%"
  const csv = name => { const f = path.join(dir, name + '.csv'); fs.writeFileSync(f, [[head[name], 'Clicks', 'Impressions', 'CTR', 'Position'], ...fx.sheets[name].map(r => [r[0], r[1], r[2], (r[3] * 100).toFixed(2) + '%', r[4]])].map(r => r.map(v => /[",]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n')); return f; };
  const csvs = ['Queries', 'Pages', 'Chart'].map(csv);
  return { xlsx, csvs, evil, zip };
}

// Comparison exports built from the fictional sample site, so these tests never need private data.
function writeComparisonExports(dir) {
  const { load } = require('./lib/harness');
  const W = load(['engine.js', 'demo.js']);
  const D = W.CW_DEMO.build();
  const shift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const prevC = D.C.map(r => ({ ...r, d: shift(r.d, -D.C.length), clicks: Math.round(r.clicks * 1.1), impr: Math.round(r.impr * 1.05) }));
  const row = (label, r) => [label, r.clicks, r.impr, r.ctr / 100, r.pos];
  const sheet = (head, rows) => XLSX.utils.aoa_to_sheet([[head, 'Clicks', 'Impressions', 'CTR', 'Position'], ...rows]);
  const book = (Q, P, C) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet('Date', C.map(r => row(r.d, r))), 'Chart'); XLSX.utils.book_append_sheet(wb, sheet('Top queries', Q.map(r => row(r.q, r))), 'Queries'); XLSX.utils.book_append_sheet(wb, sheet('Top pages', P.map(r => row(r.p, r))), 'Pages'); return wb; };
  const cur = path.join(dir, 'trailcraft-current.xlsx'), old = path.join(dir, 'trailcraft-previous.xlsx'), overlap = path.join(dir, 'trailcraft-overlap.xlsx');
  XLSX.writeFile(book(D.Q, D.P, D.C), cur);
  XLSX.writeFile(book(D.prevQ, D.prevP, prevC), old);
  XLSX.writeFile(book(D.prevQ, D.prevP, D.C.slice(10)), overlap);
  // one export made with Date › Compare: "Last 3 months …" and "Previous 3 months …" columns side by side
  const L = 'Last 3 months', Pv = 'Previous 3 months';
  const cmpHead = first => [first, `${L} Clicks`, `${Pv} Clicks`, `${L} Impressions`, `${Pv} Impressions`, `${L} CTR`, `${Pv} CTR`, `${L} Position`, `${Pv} Position`];
  const zero = { clicks: 0, impr: 0, ctr: 0, pos: 0 };
  const cmpRows = (curRows, prevRows, key) => {
    const pm = new Map(prevRows.map(r => [r[key], r])), keys = [...new Set(curRows.map(r => r[key]).concat(prevRows.map(r => r[key])))];
    const cm = new Map(curRows.map(r => [r[key], r]));
    return keys.map(k => { const a = cm.get(k) || zero, b = pm.get(k) || zero; return [k, a.clicks, b.clicks, a.impr, b.impr, a.ctr / 100, b.ctr / 100, a.pos, b.pos]; });
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cmpHead('Date'), ...D.C.map((r, i) => [r.d, r.clicks, prevC[i].clicks, r.impr, prevC[i].impr, r.ctr / 100, prevC[i].ctr / 100, r.pos, prevC[i].pos])]), 'Chart');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cmpHead('Top queries'), ...cmpRows(D.Q, D.prevQ, 'q')]), 'Queries');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cmpHead('Top pages'), ...cmpRows(D.P, D.prevP, 'p')]), 'Pages');
  const compare = path.join(dir, 'trailcraft-compare.xlsx'); XLSX.writeFile(wb, compare);
  // what the app should find: the engine run on the same data
  const A = W.CW.analyse({ ...D, source: 'file', QP: null }, { brand: ['trailcraft'], exclude: [] });
  return { cur, old, overlap, compare, expected: { declining: A.decay.pages.length } };
}

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
  const files = writeExports(dir);
  const cmp = writeComparisonExports(dir);
  if (!files.xlsx) console.log('browser: real-data upload tests skipped (private fixture not present)');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    const lib = Object.keys(LOCAL).find(k => u.includes('cdnjs') && u.endsWith(k));
    if (lib) return r.fulfill({ path: LOCAL[lib], contentType: 'text/javascript' });
    if (u.startsWith(base)) return r.continue();
    if (u.includes('cdnjs')) return r.continue(); // no local copy: use the CDN
    return r.fulfill({ status: 204, body: '' });   // fonts and Google sign-in are not needed here
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => { if (!/fonts\.g|accounts\.google/.test(r.url())) errors.push('request failed: ' + r.url()); });
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(250); };
  const text = sel => page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const toApp = async () => { await page.waitForSelector('#setup:not([hidden]), #app:not([hidden])', { timeout: 15000 }); if (await page.isVisible('#setup')) await page.click('#setup-form button[type=submit]'); await page.waitForSelector('#app:not([hidden])'); };

  await testAsync('sample data: every screen and workflow renders without errors', async () => {
    await page.goto(base + 'app.html?demo'); await toApp();
    const views = await page.$$eval('.nav a[data-view]', a => a.map(x => x.dataset.view));
    for (const v of views) { await go('#' + v); assert.ok(await text('#view h1'), 'heading on ' + v); }
    const wfs = await page.evaluate(() => window.CW_WORKFLOWS.TEMPLATES.map(t => t.id));
    for (const w of wfs) { await go('#wf=' + w); assert.ok(await text('#view h1'), 'workflow ' + w); }
    await go('#regex'); assert.equal(await page.evaluate(() => location.hash), '#filters', 'old regex link redirects');
    assert.equal(await page.isVisible('#top-sample'), true, 'sample badge');
    const real = errors.filter(e => !/ERR_TUNNEL|ERR_INTERNET|ERR_NAME|ERR_PROXY/.test(e) || /localhost/.test(e));
    assert.equal(real.length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('All opportunities: totals match the dashboard, filters, evidence and CSV export work', async () => {
    await page.goto(base + 'app.html?demo'); await toApp();
    const headline = (await text('.hero h1, .v-hero h1, #view h1')).match(/\d[\d.,]*K?–[\d.,]+K?/);
    await go('#opps');
    assert.equal(await text('#view h1'), 'All opportunities');
    const growth = await text('.strip .stat.gain b');
    assert.ok(headline && growth.includes(headline[0]), `growth ${growth} matches headline ${headline && headline[0]}`);
    const navCount = await text('.nav a[data-view="opps"] .count');
    const rows0 = parseInt((await text('#t-opp-meta')).replace(/,/g, ''), 10);
    assert.equal(String(rows0), navCount.replace(/,/g, ''), 'nav count = rows');
    await page.selectOption('select[data-tf="t-opp"][data-key="lvl"]', 'High');
    const levels = await page.$$eval('#t-opp tbody tr:not(.sub) td:nth-child(4) .tag', t => t.map(x => x.textContent));
    assert.ok(levels.length && levels.every(l => l === 'High'), 'confidence filter');
    await page.selectOption('select[data-tf="t-opp"][data-key="lvl"]', '');
    await page.click('#t-opp .opp-d summary');
    assert.ok(/Confidence: (High|Medium|Low) \(\d+\/100\)/.test(await text('#t-opp .opp-d[open]')), 'evidence opens with a scored confidence');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-tx="t-opp"]')]);
    const csvText = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(/Opportunity.*Measured.*Clicks \/ month \(est\.\).*Confidence.*Effort.*Suggested action/.test(csvText.split('\n')[0]), 'CSV header');
    assert.equal(csvText.trim().split('\n').length - 1, rows0, 'every row exported');
  });

  await testAsync('Losing ground: a brand-new page in the current export renders as new', async () => {
    const mk = (pages, start) => { const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Clicks', 'Impressions', 'CTR', 'Position']].concat(Array.from({ length: 30 }, (_, i) => { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return [d.toISOString().slice(0, 10), 100, 4000, 0.025, 6]; }))), 'Chart');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Top queries', 'Clicks', 'Impressions', 'CTR', 'Position'], ['blue widgets', 40, 1000, 0.04, 5], ['red widgets', 30, 900, 0.033, 6]]), 'Queries');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Top pages', 'Clicks', 'Impressions', 'CTR', 'Position']].concat(pages)), 'Pages'); return wb; };
    const base10 = Array.from({ length: 10 }, (_, i) => ['https://example.com/p' + i, 20, 800, 0.025, 6]);
    const a = path.join(dir, 'example.com-old.xlsx'), b = path.join(dir, 'example.com-new.xlsx');
    XLSX.writeFile(mk(base10, '2026-01-01'), a);
    XLSX.writeFile(mk(base10.concat([['https://example.com/launch', 300, 5000, 0.06, 3]]), '2026-02-01'), b);
    errors.length = 0;
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', [a, b]); await toApp(); await go('#decay');
    const row = await page.$$eval('#t-dr tbody tr', t => t.map(x => x.textContent.replace(/\s+/g, ' ')).find(x => x.includes('/launch')) || '');
    assert.ok(/new/.test(row) && /300/.test(row), 'new page listed: ' + row);
    assert.equal(errors.length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('every screen fits a 390 px phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const v of ['overview', 'opps', 'plan', 'quickwins', 'ctr', 'workflows', 'filters', 'queries', 'ai']) {
      await go('#' + v);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${v} overflows by ${over}px`);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  if (files.xlsx) await testAsync('Excel upload: site totals, coverage and ranges on the dashboard', async () => {
    await page.click('#btn-new'); await page.setInputFiles('#file-input', files.xlsx); await toApp();
    await go('#overview');
    const tiles = await page.$$eval('.tiles .tile', t => t.map(x => x.textContent.replace(/\s+/g, ' ')));
    assert.ok(/102\.4M\s*Impressions/.test(tiles[1]), 'site impressions tile: ' + tiles[1]);
    const cov = await text('.coverage');
    assert.ok(/62\.5%/.test(cov) && /10\.7%/.test(cov), 'coverage line: ' + cov);
    assert.ok(/not represented in this export/.test(cov), 'export wording');
    assert.ok(!/anonymous/i.test(await text('#view')), 'no "anonymous" claim for uploads');
    assert.ok(/\d[\d.]*K?–\d/.test(await text('.banner h1')), 'banner shows a range');
  });

  if (files.xlsx) await testAsync('Titles to rewrite sets aside likely sitelinks, and Include brings one back', async () => {
    await go('#ctr');
    const aside = await page.$$eval('#t-ctrx tbody tr', r => r.map(x => x.textContent));
    assert.ok(aside.some(t => t.includes('/internship')), 'internship set aside');
    const main = await page.$$eval('#t-ctrp tbody td.u', r => r.map(x => x.textContent));
    assert.ok(!main.includes('/internship'), 'not recommended');
    await page.click('#t-ctrx [data-keep*="/internship"]'); await page.waitForTimeout(300);
    const aside2 = await page.$$eval('#t-ctrx tbody tr', r => r.map(x => x.textContent)).catch(() => []);
    assert.ok(!aside2.some(t => t.includes('/internship')), 'included again');
  });

  if (files.xlsx) await testAsync('one unit everywhere: monthly ranges in tables, and workflow total ≤ headline', async () => {
    await go('#quickwins');
    assert.ok((await text('#t-qw thead')).includes('Clicks / month'), 'column label');
    await go('#wf=quickwins');
    const sum = await text('.wf-sum');
    assert.ok(/not added/.test(sum), 'explains overlap: ' + sum);
  });

  if (files.xlsx) await testAsync('Print report opens the report and prints', async () => {
    await page.click('#btn-print'); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => location.hash), '#wf=report');
    assert.ok(await page.evaluate(() => window.__printed >= 1), 'print called');
  });

  if (files.xlsx) await testAsync('CSV files selected together load like the Excel download', async () => {
    await page.click('#btn-new'); await page.setInputFiles('#file-input', files.csvs); await toApp();
    await go('#overview');
    assert.ok(/62\.5%/.test(await text('.coverage')), 'coverage from CSVs');
  });

  await testAsync('upload validation messages', async () => {
    await page.click('#btn-new');
    await page.setInputFiles('#file-input', files.zip); await page.waitForTimeout(300);
    assert.ok(/\.zip/.test(await text('#start-error')), 'zip explained');
    const junk = path.join(dir, 'notes.txt'); fs.writeFileSync(junk, 'hello');
    await page.setInputFiles('#file-input', junk); await page.waitForTimeout(400);
    assert.ok(/no Queries or Pages|Couldn't read/.test(await text('#start-error')), 'junk explained: ' + await text('#start-error'));
  });

  await testAsync('CSV export neutralises spreadsheet formulas', async () => {
    await page.setInputFiles('#file-input', files.evil); await toApp(); await go('#queries');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-tx="t-q"]')]);
    const out = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(out.includes(`"'=HYPERLINK`), 'formula prefixed');
  });

  await testAsync('Forget this site clears stored settings; reload explains the reset', async () => {
    const site = (await text('#top-site')).replace(/ \(sample\)$/, '');
    assert.ok(await page.evaluate(s => !!localStorage.getItem('cw:site:' + s), site), 'settings stored before');
    await page.click('#btn-settings'); page.once('dialog', d => d.accept());
    await page.click('#set-forget'); await page.waitForTimeout(300);
    const left = await page.evaluate(s => ['cw:site:', 'cw:saved:'].filter(k => localStorage.getItem(k + s) != null), site);
    assert.equal(left.length, 0, 'keys left: ' + left.join(','));
    assert.ok(await page.isVisible('#start'), 'back to start');
    await page.goto('about:blank'); await page.goto(base + 'app.html#overview');
    assert.ok(await page.isVisible('#start-info'), 'reload explanation shown');
  });

  // Every screen that depends on a comparison period, checked for both ways of uploading one.
  const checkComparison = async (label) => {
    await go('#overview');
    assert.ok(await page.$('.tiles .tile .tile-d'), label + ': site tiles show change vs previous');
    assert.ok(await page.$('.subset .chg.good, .subset .chg.bad'), label + ': non-brand panel shows change');
    await go('#decay');
    assert.ok(!/Needs a comparison period/.test(await text('#view')), label + ': Losing ground has data');
    const stat = await text('#view .strip .stat');
    assert.ok(/pages losing clicks/.test(stat), label + ': ' + stat);
    assert.ok((await page.$$('#t-dp tbody tr')).length > 0, label + ': declining pages listed');
    assert.ok((await page.$$('#t-dq tbody tr')).length > 0, label + ': declining searches listed');
    await go('#wf=declines');
    assert.ok(!/needs more data/.test(await text('#view')) && (await page.$$('#view tbody tr')).length > 0, label + ': Discover traffic declines runs');
    await go('#filters?q=' + encodeURIComponent('pages that lost clicks'));
    assert.ok(/\d+ pages/.test(await text('.sf-say')), label + ': smart filter on lost clicks: ' + await text('#sf-out'));
    await go('#wf=report');
    assert.ok(!/Needs a comparison period/.test(await text('#report')), label + ': report lists declines');
    const href = await page.$eval('.cards a.card', a => a.getAttribute('href')).catch(() => null);
    if (href) { await go(href); assert.ok(await page.$('.tile .tile-d'), label + ': folder deep dive shows change'); }
    return stat;
  };

  await testAsync('comparison: one export made with Date › Compare fills Losing ground', async () => {
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', cmp.compare); await toApp();
    const stat = await checkComparison('compare export');
    assert.equal(parseInt(stat, 10), cmp.expected.declining, 'same declining pages as the engine on the same data');
  });

  await testAsync('comparison: two exports uploaded together (in any order)', async () => {
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', [cmp.old, cmp.cur]); await toApp();
    const stat = await checkComparison('two exports');
    assert.equal(parseInt(stat, 10), cmp.expected.declining, 'same declining pages as the engine');
    assert.ok(/Compared with \d{4}-\d{2}-\d{2}/.test(await (async () => { await go('#decay'); return text('#view .v-head p'); })()), 'shows the previous dates');
  });

  await testAsync('comparison: overlapping exports and a single export are explained', async () => {
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', [cmp.cur, cmp.overlap]); await page.waitForTimeout(500);
    assert.ok(/overlap/.test(await text('#start-error')), 'overlap explained');
    await page.setInputFiles('#file-input', cmp.cur); await toApp(); await go('#decay');
    assert.ok(/Date › Compare/.test(await text('#view')) && /both files together/.test(await text('#view')), 'how to get a comparison from Excel');
  });

  await testAsync('Search Console: dashboard opens fast; slow data fills in by itself; busy errors are retried', async () => {
    // A fake Search Console API built from the sample site: query-page pairs are slow (4 s) and the
    // first devices request answers 429 (busy), as large properties and quotas do.
    const { load } = require('./lib/harness');
    const S = load(['engine.js', 'demo.js']).CW_DEMO.build();
    const cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    let busy = 1;
    const rowsFor = (dims, prev) => {
      const k = dims.join(',');
      const m = (list, keys) => (list || []).map(r => ({ keys: keys(r), clicks: r.clicks, impressions: r.impr, ctr: r.ctr / 100, position: r.pos }));
      if (k === 'query') return m(prev ? S.prevQ : S.Q, r => [r.q]);
      if (k === 'page') return m(prev ? S.prevP : S.P, r => [r.p]);
      if (k === 'date') return m(S.C, r => [r.d]);
      if (k === 'device') return m(S.Dev, r => [r.d]);
      if (k === 'query,page') return m(S.QP, r => [r.q, r.p]);
      return [];
    };
    const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx2.route('**/*', async r => {
      const u = r.request().url();
      const lib = Object.keys(LOCAL).find(k => u.includes('cdnjs') && u.endsWith(k));
      if (lib) return r.fulfill({ path: LOCAL[lib], contentType: 'text/javascript' });
      if (u.startsWith(base)) return r.continue();
      if (u.includes('searchconsole.googleapis.com')) {
        if (u.endsWith('/sites')) return r.fulfill({ json: { siteEntry: [{ siteUrl: 'sc-domain:trailcraft.co', permissionLevel: 'siteOwner' }] } });
        const body = JSON.parse(r.request().postData() || '{}');
        if (body.dimensions.join(',') === 'device' && busy-- > 0) return r.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { error: { message: 'busy' } } });
        if (body.dimensions.join(',') === 'query,page') await new Promise(res => setTimeout(res, 4000));
        const all = rowsFor(body.dimensions, body.startDate < cutoff);
        return r.fulfill({ json: { rows: all.slice(body.startRow || 0, (body.startRow || 0) + body.rowLimit) } });
      }
      return r.fulfill({ status: 204, body: '' });
    });
    const p2 = await ctx2.newPage();
    const errs = []; p2.on('pageerror', e => errs.push(e.message));
    // stand-in for Google's sign-in library: hands back a token straight away
    await p2.addInitScript(() => { window.google = { accounts: { oauth2: { initTokenClient: c => ({ requestAccessToken: () => setTimeout(() => c.callback({ access_token: 'test', expires_in: 3600 }), 10) }), revoke: () => { } } } }; });
    const t2 = s => p2.$eval(s, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    const go2 = async h => { await p2.evaluate(h => { location.hash = h; }, h); await p2.waitForTimeout(250); };
    await p2.goto(base + 'app.html');
    await p2.click('#btn-connect');
    await p2.waitForSelector('#picker:not([hidden])');
    await p2.waitForFunction(() => document.querySelector('#pick-site').value.includes('trailcraft'));
    const t0 = Date.now();
    await p2.click('#pick-go');
    await p2.waitForSelector('#setup:not([hidden]), #app:not([hidden])', { timeout: 15000 });
    const firstPaint = Date.now() - t0;
    if (await p2.isVisible('#setup')) await p2.click('#setup-form button[type=submit]');
    await p2.waitForSelector('#app:not([hidden])');
    assert.ok(firstPaint < 3500, `dashboard waited ${firstPaint} ms (query-page pairs take 4 s)`);
    assert.ok(/Loading/.test(await t2('#top-loading')), 'background status shown: ' + await t2('#top-loading'));
    await go2('#cannibal');
    assert.ok(/Loading which query lands on which page/.test(await t2('#view')), 'Competing pages says it is loading');
    await p2.waitForFunction(() => /All data loaded|^$/.test(document.getElementById('top-loading').textContent), null, { timeout: 20000 });
    await go2('#cannibal');
    assert.ok(/at least 10% of impressions/.test(await t2('#view .v-head p')), 'exact competing pages after loading');
    assert.ok((await p2.$$('#t-can tbody tr')).length > 0, 'competing pages listed');
    await go2('#decay');
    assert.ok((await p2.$$('#t-dp tbody tr')).length > 0, 'Losing ground filled from the previous period');
    await go2('#overview');
    assert.ok(await p2.$('.tiles .tile .tile-d'), 'site tiles compare with the previous period');
    assert.equal(errs.length, 0, 'JS errors: ' + errs.join(' | '));
    await ctx2.close();
  });

  await testAsync('Search Console: analyse only one folder (page filter sent to Google)', async () => {
    const { load } = require('./lib/harness');
    const S = load(['engine.js', 'demo.js']).CW_DEMO.build();
    const bodies = [];
    const ctx3 = await browser.newContext();
    await ctx3.route('**/*', async r => {
      const u = r.request().url();
      const lib = Object.keys(LOCAL).find(k => u.includes('cdnjs') && u.endsWith(k));
      if (lib) return r.fulfill({ path: LOCAL[lib], contentType: 'text/javascript' });
      if (u.startsWith(base)) return r.continue();
      if (u.includes('searchconsole.googleapis.com')) {
        if (u.endsWith('/sites')) return r.fulfill({ json: { siteEntry: [{ siteUrl: 'sc-domain:trailcraft.co', permissionLevel: 'siteOwner' }, { siteUrl: 'https://shop.example/', permissionLevel: 'siteOwner' }] } });
        const body = JSON.parse(r.request().postData() || '{}'); bodies.push(body);
        const f = ((body.dimensionFilterGroups || [])[0] || { filters: [] }).filters.find(x => x.dimension === 'page');
        const rx = f ? new RegExp(f.expression) : null;
        const k = body.dimensions.join(','), m = (list, keys, page) => list.filter(r => !rx || !page || rx.test(page(r))).map(r => ({ keys: keys(r), clicks: r.clicks, impressions: r.impr, ctr: r.ctr / 100, position: r.pos }));
        const rows = k === 'page' ? m(S.P, r => [r.p], r => r.p) : k === 'query,page' ? m(S.QP, r => [r.q, r.p], r => r.p) : k === 'query' ? m(S.QP.filter(r => !rx || rx.test(r.p)), r => [r.q]) : k === 'date' ? m(S.C, r => [r.d]) : m(S.Dev, r => [r.d]);
        return r.fulfill({ json: { rows: rows.slice(body.startRow || 0, (body.startRow || 0) + body.rowLimit) } });
      }
      return r.fulfill({ status: 204, body: '' });
    });
    const p3 = await ctx3.newPage();
    await p3.addInitScript(() => { window.google = { accounts: { oauth2: { initTokenClient: c => ({ requestAccessToken: () => setTimeout(() => c.callback({ access_token: 'test', expires_in: 3600 }), 10) }), revoke: () => { } } } }; });
    await p3.goto(base + 'app.html'); await p3.click('#btn-connect');
    await p3.waitForFunction(() => document.querySelectorAll('#pick-site option').length === 2);
    await p3.selectOption('#pick-site', 'sc-domain:trailcraft.co');
    await p3.fill('#pick-scope', 'https://elsewhere.com/gear'); await p3.click('#pick-go'); await p3.waitForTimeout(200);
    assert.ok(/not on trailcraft\.co/.test(await p3.$eval('#pick-error', e => e.textContent)), 'other domain rejected');
    await p3.fill('#pick-scope', '/gear'); await p3.click('#pick-go');
    await p3.waitForSelector('#setup:not([hidden]), #app:not([hidden])', { timeout: 15000 });
    if (await p3.isVisible('#setup')) await p3.click('#setup-form button[type=submit]');
    await p3.waitForSelector('#app:not([hidden])');
    assert.ok(bodies.length && bodies.every(b => (b.dimensionFilterGroups || [])[0] && b.dimensionFilterGroups[0].filters.some(f => f.dimension === 'page' && f.operator === 'includingRegex')), 'every request carries the page filter');
    assert.ok((await p3.$eval('#top-scope', e => e.textContent)).startsWith('Folder: /gear/'), 'scope shown');
    await p3.evaluate(() => { location.hash = '#pages'; }); await p3.waitForTimeout(250);
    const urls = await p3.$$eval('#view td.u', t => t.map(x => x.textContent));
    assert.ok(urls.length && urls.every(u => u.startsWith('/gear/')), 'only pages in the folder: ' + urls.slice(0, 3).join(', '));
    // switch folder from the top bar without going back to the property screen
    const before = bodies.length;
    await p3.click('#top-scope'); await p3.waitForSelector('#scope-dialog[open]');
    await p3.fill('#scope-in', '/trails'); await p3.click('#scope-go');
    await p3.waitForFunction(() => document.getElementById('top-scope').textContent.includes('/trails/'), null, { timeout: 15000 });
    assert.ok(!(await p3.$('#scope-dialog[open]')), 'dialog closes after the switch');
    assert.ok(bodies.slice(before).some(b => b.dimensionFilterGroups[0].filters.some(f => f.expression.includes('/trails'))), 'new filter sent');
    await p3.evaluate(() => { location.hash = '#overview'; location.hash = '#pages'; }); await p3.waitForTimeout(300);
    const urls2 = await p3.$$eval('#view td.u', t => t.map(x => x.textContent));
    assert.ok(urls2.length && urls2.every(u => u.startsWith('/trails/')), 'pages now from /trails/: ' + urls2.slice(0, 3).join(', '));
    // and back to the whole site
    await p3.click('#top-scope'); await p3.click('#scope-whole'); await p3.click('#scope-go');
    await p3.waitForFunction(() => /All pages/.test(document.getElementById('top-scope').textContent), null, { timeout: 15000 });
    // change the dates from the date pill
    const b2 = bodies.length, range0 = await p3.$eval('#top-range', e => e.textContent);
    await p3.click('#top-range-btn'); await p3.waitForSelector('#scope-dialog[open]');
    assert.ok(await p3.isVisible('#scope-start'), 'date fields shown');
    await p3.click('#scope-presets [data-days="28"]'); await p3.click('#scope-go');
    await p3.waitForFunction(r => document.getElementById('top-range').textContent !== r, range0, { timeout: 15000 });
    const end = new Date(); end.setDate(end.getDate() - 2); const st = new Date(end); st.setDate(end.getDate() - 27);
    assert.ok(bodies.slice(b2).some(b => b.startDate === st.toISOString().slice(0, 10) && b.endDate === end.toISOString().slice(0, 10)), 'new dates sent');
    // switch property from the site pill
    await p3.click('#top-site-btn'); await p3.waitForSelector('#scope-dialog[open]');
    assert.equal(await p3.$$eval('#scope-site option', o => o.length), 2, 'all properties offered');
    await p3.selectOption('#scope-site', 'https://shop.example/'); await p3.click('#scope-go');
    await p3.waitForSelector('#setup:not([hidden])', { timeout: 15000 });
    await p3.click('#setup-form button[type=submit]'); await p3.waitForSelector('#app:not([hidden])');
    assert.equal(await p3.$eval('#top-site', e => e.textContent), 'shop.example', 'new property shown');
    assert.ok(!(await p3.$('#scope-dialog[open]')), 'dialog closed');
    await ctx3.close();
  });

  await testAsync('sample data: date and site pills explain the range is fixed', async () => {
    await page.goto(base + 'app.html?demo'); await toApp();
    await page.click('#top-range-btn'); await page.waitForSelector('#scope-dialog[open]');
    assert.ok(/sample data/.test(await text('#scope-fixed-msg')), 'explains sample data');
    assert.ok(await page.isVisible('#scope-new') && !(await page.isVisible('#scope-go')), 'offers a new analysis');
    await page.click('#scope-cancel');
  });

  await testAsync('Excel export with a Page filter shows which folder it covers', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Top queries', 'Clicks', 'Impressions', 'CTR', 'Position'], ['ats software', 40, 900, 0.044, 5.1], ['campus hiring', 25, 700, 0.036, 6.3]]), 'Queries');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Top pages', 'Clicks', 'Impressions', 'CTR', 'Position'], ['https://example.com/employers/ats', 40, 900, 0.044, 5.1], ['https://example.com/employers/campus', 25, 700, 0.036, 6.3]]), 'Pages');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Filter', 'Value'], ['Search type', 'Web'], ['Date', 'Last 3 months'], ['Page', '+https://example.com/employers']]), 'Filters');
    const f = path.join(dir, 'example.com-employers.xlsx'); XLSX.writeFile(wb, f);
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', f); await toApp();
    assert.equal(await text('#top-scope'), 'Page filter: +https://example.com/employers');
  });

  await testAsync('landing and legal pages: no broken local links', async () => {
    for (const f of ['index.html', 'privacy.html', 'terms.html']) {
      await page.goto(base + f);
      const hrefs = await page.$$eval('a[href]', a => a.map(x => x.getAttribute('href')));
      for (const h of hrefs) {
        if (/^(mailto:|https?:|#)/.test(h)) continue;
        const r = await page.request.get(base + h.replace(/^\.\//, '').split(/[?#]/)[0]);
        assert.equal(r.status(), 200, `${f} → ${h}`);
      }
    }
  });

  await browser.close(); srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = report('browser') ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });

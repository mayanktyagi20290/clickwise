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

  await testAsync('Goal builder: answer a question, edit a condition, run, save, re-run with history', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await page.evaluate(() => localStorage.clear());
    // the Dashboard box hands the request to the Goal builder
    await go('#overview'); await page.fill('#ov-ask-in', 'titles to rewrite'); await page.click('#ov-ask button'); await page.waitForTimeout(300);
    assert.ok(/^#filters\?q=/.test(await page.evaluate(() => location.hash)) && /Low CTR/.test(await text('.chips')), 'dashboard question opens the Goal builder');
    await go('#filters');
    assert.equal(await text('#view h1'), 'Goal builder');
    const ask = async t => { await page.fill('#sf-in', t); await page.click('#sf-form button[type=submit]'); await page.waitForTimeout(250); };
    // a bare number is asked about, not guessed
    await ask('more than 1000');
    assert.ok(/apply to/.test(await text('.sf-q')), 'question shown');
    assert.equal((await page.$$('.chip')).length, 0, 'nothing guessed');
    await page.click('.sf-q button:has-text("More than 1,000 impressions")');
    assert.equal(await text('.chip .chip-t'), 'Impressions more than 1,000');
    const n1 = parseInt((await text('.sf-say b')).replace(/,/g, ''), 10);
    // edit the condition with normal controls
    await page.click('.chip .chip-t');
    assert.equal(await page.$eval('#sf-v1', e => e.value), '1000', 'value loaded for editing');
    await page.fill('#sf-v1', '5000'); await page.click('#sf-addbtn'); await page.waitForTimeout(200);
    assert.equal(await text('.chip .chip-t'), 'Impressions more than 5,000');
    const n2 = parseInt((await text('.sf-say b')).replace(/,/g, ''), 10);
    assert.ok(n2 <= n1, `narrower after edit: ${n1} → ${n2}`);
    // every word that was not used is shown, either as a question or in the "not used" line
    await ask('show me the best blog stuff please');
    assert.ok(/blog/.test(await text('.sf-qs')) && /best/.test(await text('.sf-warn')), 'unused words visible');
    // contradictions cannot run
    await ask('top 3 positions and between positions 5 and 15');
    assert.ok(/can't all be true/.test(await text('#sf-errs')) && !(await page.$('#sf-runbtn')), 'blocked with a reason');
    // data the sample cannot answer is explained
    await ask('pages losing clicks on mobile');
    assert.ok(/all devices together/.test(await text('.sf-issue[data-kind="device"]')), 'device explained');
    // run and save
    await ask('which pages should I fix first');
    const previewN = parseInt((await text('.sf-say b')).replace(/,/g, ''), 10);
    await page.click('#sf-runbtn'); await page.waitForSelector('#sf-result');
    const status = await text('#sf-result .sf-status');
    assert.ok(new RegExp('^Finished at .* · ' + previewN + ' pages').test(status), status);
    assert.equal(await page.$$eval('#t-sf tbody tr', t => t.length), previewN, 'run shows every match');
    await page.fill('#sf-name', 'Fix first'); await page.click('#sf-savebtn'); await page.waitForTimeout(200);
    await go('#workflows');
    const row = await page.$$eval('.saved-t tbody tr', t => t.map(x => x.textContent.replace(/\s+/g, ' ')).find(x => x.includes('Fix first')) || '');
    assert.ok(/Your goal/.test(row) && /Not run yet/.test(row), 'saved, not yet run: ' + row);
    await page.click('.saved-t tbody tr:has-text("Fix first") a:has-text("Run")'); await page.waitForSelector('#sf-result');
    assert.ok(/added to this workflow's history/.test(await text('#sf-result .sf-status')));
    await go('#workflows');
    const row2 = await page.$$eval('.saved-t tbody tr', t => t.map(x => x.textContent.replace(/\s+/g, ' ')).find(x => x.includes('Fix first')) || '');
    assert.ok(new RegExp('Finished .* ' + previewN + ' results').test(row2), 'history: ' + row2);
    // run history keeps only when, status and counts: no searches, URLs or click numbers
    const hist = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('cw:runs:')); return k ? localStorage.getItem(k) : null; });
    const H = JSON.parse(hist);
    assert.ok(H.length === 1, 'one run recorded');
    assert.deep(Object.keys(H[0]).sort(), ['at', 'count', 'data', 'errors', 'goalId', 'matched', 'ms', 'status'], 'only these fields');
    assert.deep(Object.keys(H[0].data).sort(), ['end', 'source', 'start'], 'data: source and dates only');
    const firstPath = await page.$eval('#t-sf tbody tr td', td => td.textContent.trim()).catch(() => '/trails/');
    assert.ok(!hist.includes(firstPath) && !/clicks|impr|\/trails\/|\/gear\//.test(hist), 'no URLs or metrics stored: ' + hist);
    // rename in place
    await page.click('.saved-t tbody tr:has-text("Fix first") [data-rename]');
    await page.fill('.saved-t td.nm input', 'Pages to fix first'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    assert.ok((await page.$$eval('.saved-t td.nm span', t => t.map(x => x.textContent))).includes('Pages to fix first'), 'renamed');
    await page.click('.saved-t tbody tr:has-text("Pages to fix first") a:has-text("Edit")'); await page.waitForTimeout(250);
    assert.equal(await page.$eval('#sf-name', e => e.value), 'Pages to fix first', 'the new name is used when reopened');
    await go('#workflows');
    // a damaged saved goal is refused, not run
    await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('cw:saved:')); const l = JSON.parse(localStorage.getItem(k)); l[0].goal.spec.conds.push({ f: 'clicks', op: 'gt', v: 1, run: 'x' }); localStorage.setItem(k, JSON.stringify(l)); });
    await page.click('.saved-t tbody tr:has-text("Pages to fix first") a:has-text("Edit")'); await page.waitForTimeout(250);
    assert.ok(/can't be opened/.test(await text('#sf-out')) && /damaged/.test(await text('#sf-out')), 'refused: ' + await text('#sf-out'));
    assert.equal(errors.length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Content & links: tabs, a brief, and a crawler export that removes a link that exists', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await go('#content');
    assert.equal(await text('#view h1'), 'Content & links');
    for (const tab of ['topics', 'gaps', 'improve', 'links', 'briefs']) {
      await go('#content?tab=' + tab);
      const n = parseInt(await text(`.ct-tabs a[href$="tab=${tab}"] .count`), 10);
      if (tab !== 'briefs') { const meta = parseInt((await text('#view [id$="-meta"]')).replace(/,/g, ''), 10); assert.equal(meta, n, tab + ': tab count = rows'); }
    }
    assert.ok(/Suggested title/.test(await text('.ct-brief')) && /fixed rules/.test(await text('.ct-brief')), 'brief explains how it was made');
    await go('#content?tab=links');
    const before = parseInt((await text('#t-ct-l-meta')).replace(/,/g, ''), 10);
    const [target, source] = await page.$eval('#t-ct-l tbody tr', tr => [tr.querySelector('td a').href, tr.querySelectorAll('td')[2].querySelector('a').href]);
    const csv = path.join(dir, 'inlinks.csv');
    fs.writeFileSync(csv, `"Type","Source","Destination","Anchor"\n"Hyperlink","${source}","${target}","existing"\n`);
    await page.setInputFiles('#ct-file', csv); await page.waitForTimeout(400);
    assert.ok(/1 link between your pages/.test(await text('.ct-crawl')) && /already exist|already exists/.test(await text('.ct-crawl')), await text('.ct-crawl'));
    const after = parseInt((await text('#t-ct-l-meta')).replace(/,/g, ''), 10);
    assert.ok(after <= before, `rows ${before} → ${after}`);
    assert.ok(/Not linked yet/.test(await text('#t-ct-l')), 'suggestions now marked as checked');
    // a file without the right columns is refused with a reason
    const bad = path.join(dir, 'bad.csv'); fs.writeFileSync(bad, 'Query,Clicks\nfoo,1\n');
    await page.click('#ct-clear'); await page.waitForTimeout(300);
    await page.setInputFiles('#ct-file', bad); await page.waitForTimeout(400);
    assert.ok(/source and destination columns/.test(await text('.ct-crawl')), await text('.ct-crawl'));
    assert.equal(errors.length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Fix tracker: add, measure, details, remove; Track this fix; exports measure the whole site only', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await page.evaluate(() => localStorage.clear());
    await go('#fixes');
    assert.equal(await text('#view h1'), 'Fix tracker');
    const max = await page.$eval('#fx-date', e => e.max);
    const shift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const url = 'https://www.trailcraft.co/trails/himalaya/kedarkantha-trek';
    await page.fill('#fx-url', url);
    await page.$eval('#fx-date', (e, v) => { e.removeAttribute('max'); e.value = v; }, shift(max, 5));
    await page.click('#fx-form button[type=submit]'); await page.waitForTimeout(200);
    assert.ok(/after the last day with data/.test(await text('#fx-err')), 'future date refused: ' + await text('#fx-err'));
    await page.fill('#fx-date', shift(max, -30)); await page.fill('#fx-note', 'Rewrote the title');
    await page.click('#fx-form button[type=submit]'); await page.waitForTimeout(600);
    assert.equal((await page.$$('tr[data-fx]')).length, 1, 'tracked');
    assert.ok(/No clear change yet|Leaning|Worked|fell/.test(await text('tr[data-fx] .fx-res')), 'result: ' + await text('tr[data-fx] .fx-res'));
    await page.fill('#fx-url', url); await page.fill('#fx-date', shift(max, -30)); await page.click('#fx-form button[type=submit]'); await page.waitForTimeout(200);
    assert.ok(/already being tracked/.test(await text('#fx-err')), 'no duplicates');
    await page.click('tr[data-fx] a.btn-quiet'); await page.waitForTimeout(700);
    assert.ok(await page.$('#fx-chart') && /Clicks a day/i.test(await text('#fx-detail')), 'details with chart and table');
    assert.ok(/28 days before vs 28 days after/.test(await text('#fx-detail')));
    await go('#fixes'); await page.click('[data-fxrm]'); await page.waitForTimeout(300);
    assert.equal((await page.$$('tr[data-fx]')).length, 0, 'removed');
    // from All opportunities
    await go('#opps');
    const link = await page.$eval('#t-opp a[href^="#fixes?add="]', a => a.getAttribute('href'));
    await page.evaluate(h => { location.hash = h; }, link); await page.waitForTimeout(300);
    assert.ok((await page.$eval('#fx-url', e => e.value)).startsWith('https://www.trailcraft.co/'), 'page filled in');
    assert.ok((await page.$eval('#fx-note', e => e.value)).length > 10, 'what to do filled in');
    // an export: one page cannot be measured, the whole site can
    await page.goto(base + 'app.html'); await page.setInputFiles('#file-input', cmp.cur); await toApp();
    await go('#fixes');
    assert.ok(await page.$eval('#fx-scope option[value="page"]', o => o.disabled) && await page.$eval('#fx-scope', s => s.value) === 'site', 'only whole site');
    const fmax = await page.$eval('#fx-date', e => e.max);
    await page.fill('#fx-date', shift(fmax, -20)); await page.click('#fx-form button[type=submit]'); await page.waitForTimeout(500);
    assert.ok(/Whole site/.test(await text('tr[data-fx]')) && !/Measuring/.test(await text('tr[data-fx] .fx-res')), 'whole-site fix measured: ' + await text('tr[data-fx]'));
    assert.equal(errors.length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Titles & metas: a page export is recognised, audited and shown on Titles to rewrite', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await go('#content?tab=titles');
    assert.ok(/Upload your crawler's page export/.test(await text('.ct-crawl')), 'asks for the file');
    const h = 'https://www.trailcraft.co';
    const csv = path.join(dir, 'internal_html.csv');
    fs.writeFileSync(csv, ['"Address","Content Type","Status Code","Indexability","Title 1","Meta Description 1","H1-1"',
      `"${h}/trails/himalaya/kedarkantha-trek","text/html","200","Indexable","Himalayan Winter Adventure | Trailcraft","Routes, costs and the best season.","Kedarkantha"`,
      `"${h}/gear/hiking-boots","text/html","200","Indexable","Boots","",""`,
      `"${h}/guides/how-to-pack-a-backpack","text/html","200","Indexable","Trekking guides | Trailcraft","A guide.","Pack"`,
      `"${h}/guides/how-to-set-up-a-tent","text/html","200","Indexable","Trekking guides | Trailcraft","A guide.","Tent"`].join('\n'));
    await page.setInputFiles('#ct-file', csv); await page.waitForTimeout(500);
    assert.ok(/Page export loaded/.test(await text('.ct-crawl')), await text('.ct-crawl'));
    const n = parseInt((await text('#t-ct-ti-meta')).replace(/,/g, ''), 10);
    assert.ok(n >= 4, n + ' pages with issues');
    assert.ok(/Main search not in title/.test(await text('#t-ct-ti')) && /Duplicate title/.test(await text('#t-ct-ti')), 'issues shown');
    await page.selectOption('select[data-tf="t-ct-ti"][data-key="kind"]', 'title-dup');
    assert.equal(parseInt((await text('#t-ct-ti-meta')), 10), 2, 'filter by issue');
    assert.ok(/Pages sharing a title/.test(await text('#view')));
    // the same upload box takes a link export, and keeps the page export
    await go('#content?tab=links');
    const lcsv = path.join(dir, 'all_inlinks.csv'); fs.writeFileSync(lcsv, `Type,Source,Destination\nHyperlink,${h}/gear/hiking-boots,${h}/trails/himalaya/kedarkantha-trek\n`);
    await page.setInputFiles('#ct-file', lcsv); await page.waitForTimeout(400);
    assert.ok(/Existing links loaded/.test(await text('.ct-crawl')), 'links recognised');
    await go('#content?tab=titles'); assert.ok(/Page export loaded/.test(await text('.ct-crawl')), 'page export kept');
    // Titles to rewrite shows the current title
    await go('#ctr');
    assert.ok(/Title now/.test(await text('#t-ctrp')), 'title column');
    // remove, then a wrong file
    await go('#content?tab=titles'); await page.click('#ct-clear-pages'); await page.waitForTimeout(300);
    const bad = path.join(dir, 'bad-pages.csv'); fs.writeFileSync(bad, 'Keyword,Volume\nfoo,10\n');
    await page.setInputFiles('#ct-file', bad); await page.waitForTimeout(400);
    assert.ok(/source and destination columns|URL and title columns/.test(await text('.ct-crawl')), 'refused: ' + await text('.ct-crawl'));
    assert.equal(errors.length, 0, 'JS errors: ' + errors.join(' | '));
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

  await testAsync('growth loop: priorities → detail → task → implemented → measured → copilot', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + 'app.html?demo'); await toApp();
    await go('#overview');
    assert.ok(/SEO Growth Command Center/.test(await text('.cc-title')), 'command center title');
    assert.ok(/Sample data/.test(await text('.cc-status')), 'data source shown');
    assert.equal(await page.$$eval('.cc-today .cc-list > li', l => l.length), 5, 'five actions today');
    assert.ok(await page.$('.cc-risk .risk-l li'), 'risks listed');
    await go('#priorities');
    const n0 = parseInt((await text('#t-prio-meta')).replace(/,/g, ''), 10);
    await page.selectOption('select[data-tf="t-prio"][data-key="pri"]', 'P1');
    const n1 = parseInt((await text('#t-prio-meta')).replace(/,/g, ''), 10);
    assert.ok(n1 > 0 && n1 < n0, `P1 filter ${n1} of ${n0}`);
    // a P1 without a task: open it, create the task
    const href = await page.$$eval('#t-prio tbody tr', rows => { const r = rows.find(x => /Open/.test(x.textContent)); return r && r.querySelector('a.opp-link').getAttribute('href'); });
    await go(href);
    assert.ok(/Priority score: \d+\/100/.test(await text('#view')), 'score breakdown');
    assert.ok(/Evidence/.test(await text('#view')), 'evidence');
    await page.click('#opp-task'); await page.waitForTimeout(300);
    assert.ok(/^#tasks\?id=/.test(await page.evaluate(() => location.hash)), 'task opened');
    // implement it 40 days before the end of the sample data and measure
    const end = await page.evaluate(() => window.CW_SOURCE.latest);
    const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 40); const impl = d.toISOString().slice(0, 10);
    await page.selectOption('#tk-edit select[name=status]', 'implemented');
    await page.fill('#tk-edit input[name=implDate]', impl);
    await page.fill('#tk-edit input[name=owner]', 'Asha');
    await page.fill('#tk-edit textarea[name=change]', 'New title');
    await page.click('#tk-edit button[type=submit]'); await page.waitForTimeout(600);
    assert.ok(/Implemented/.test(await text('.v-head')), 'status saved');
    await page.waitForFunction(() => !/Measuring/.test(document.getElementById('tk-result').textContent), null, { timeout: 5000 });
    assert.ok(/Before \(/.test(await text('#tk-result')) && /Correlation, not proof/.test(await text('#tk-result')), 'measured with caveat');
    // validating needs a result: the button marks it validated
    const v = await page.$('#tk-validate'); if (v) { await v.click(); await page.waitForTimeout(400); assert.ok(/Validated/.test(await text('.v-head')), 'validated'); }
    await go('#ask?q=' + encodeURIComponent('What changed after our last content update?'));
    assert.ok(/New title/.test(await text('.cp-rows')), 'copilot lists the change');
    await go('#ask?q=' + encodeURIComponent('how is the weather'));
    assert.ok(await page.$('a[href^="#filters?q="]'), 'unknown question offers the Goal builder');
    await go('#overview'); await page.fill('#ov-ask-in', 'Where am I losing organic clicks?'); await page.click('#ov-ask button'); await page.waitForTimeout(300);
    assert.ok(/^#ask\?q=/.test(await page.evaluate(() => location.hash)), 'dashboard question opens the copilot');
    assert.equal(errors.filter(e => !/ERR_/.test(e)).length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Command Center: top action above the fold, explanations, inline tasks, target workflow, sync, persistence', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + 'app.html?demo'); await toApp();
    // the main priority action is visible without scrolling at 1360 × 900
    const box = await page.$eval('.cc-hero-top', e => { const r = e.getBoundingClientRect(); return { top: r.top, h: r.height }; });
    assert.ok(box.top > 0 && box.top + box.h < 900, 'top priority banner above the fold at y=' + Math.round(box.top));
    assert.ok(/Top priority for today/.test(await text('.cc-hero-top')), 'banner labelled');
    const bannerId = await page.$eval('.cc-hero-top', a => a.getAttribute('href'));
    assert.equal(bannerId, '#opp?id=' + encodeURIComponent(await page.$eval('.cc-today .cc-list > li.cc-top', li => li.dataset.oid)), 'banner and first row are the same action');
    assert.ok(/Top priority action/.test(await text('.cc-top')), 'first row labelled');
    // filter chips redraw the table in place; Create task still works after a redraw
    await page.click('[data-cc-chip="ctr"]'); await page.waitForTimeout(150);
    const ctrRows = await page.$$eval('.cc-today .cc-list > li .cc-tags .tag.cat', t => t.map(x => x.textContent));
    assert.ok(ctrRows.length > 0 && ctrRows.every(c => /CTR|AI/.test(c)), 'CTR chip filters: ' + ctrRows.join(','));
    await page.click('[data-cc-chip="today"]'); await page.waitForTimeout(150);
    assert.equal(await page.$$eval('.cc-today .cc-list > li', l => l.length), 5, 'back to the five for today');
    // shell: connection status, comparison and Ask Clickwise in the top bar; KPI cards with sparklines
    assert.ok(/Sample data/.test(await text('#top-conn')), 'connection status');
    assert.ok(await page.$('.top-ask[href="#ask"]'), 'Ask Clickwise button');
    assert.equal(await page.$$eval('.tiles .tile .spark', s => s.length), 4, 'sparklines on the KPI cards');
    // trend chart: metric tabs switch the series
    await page.click('.cc-trend [data-metric="pos"]'); await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => { const c = window.Chart && window.Chart.getChart('ch-trend'); return c && c.options.scales.y.reverse === true && /position/i.test(c.options.scales.y.title.text); }), 'position tab: inverted axis');
    await page.click('.cc-trend [data-metric="clicks"]');
    // first-session guide and source labelling
    assert.ok(/Start here/.test(await text('.cc-guide')) && /fictional sample site/.test(await text('.cc-guide')), 'guide explains the data');
    assert.ok(await page.$$eval('.cc-target .tip[aria-label]', t => t.length) >= 4, 'metric definitions as accessible tooltips');
    // four separate numbers: now, target, opportunity, forecast
    assert.ok(/Current/.test(await text('.cc-kpi.now')) && /observed/.test(await text('.cc-kpi.now')), 'observed');
    assert.ok(/Target/.test(await text('.cc-kpi.tgt')) && /Set a target/.test(await text('.cc-kpi.tgt')), 'no target yet');
    assert.ok(!(await page.$('.cc-target [role=progressbar]')), 'no progress before a target');
    assert.ok(/Forecast/.test(await text('.cc-kpi.fc')) && /confidence/.test(await text('.cc-kpi.fc')), 'forecast with confidence');
    await page.click('.cc-method summary');
    const method = await text('.cc-method');
    assert.ok(/Baseline/.test(method) && /Assumptions/.test(method) && /Conservative/.test(method) && /Confidence:/.test(method), 'methodology shown');
    // why and how
    await page.click('.cc-today .cc-list > li.cc-top > .cc-why > summary');
    const why = await text('.cc-today .cc-list > li.cc-top > .cc-why');
    assert.ok(/Evidence/.test(why) && /GSC/.test(why) && /How to implement/.test(why) && /Affected searches and pages/.test(why) && /Full detail and score/.test(why), 'explanation complete');
    assert.ok(/Upload a crawler export/.test(why), 'says crawl data is missing');
    // Create task: stays on the dashboard, announces, persists, shows on the board
    const hash0 = await page.evaluate(() => location.hash);
    const first = await page.$eval('[data-cc-task]', b => b.dataset.ccTask);
    await page.click('[data-cc-task]'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => location.hash), hash0, 'no navigation away');
    assert.ok(/Task created/.test(await text('#cc-live')), 'announced');
    await page.reload(); await toApp();
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('cw:tasks:' + window.CW_SOURCE.site)).some(t => t.oppId === id), first);
    assert.ok(saved, 'task persisted after reload');
    assert.ok(!(await page.$(`[data-cc-task="${first.replace(/"/g, '\\"')}"]`)), 'Do today shows the task, not a create button');
    // target: refused below the baseline, saved with a period, kept after reload, progress waits for new data
    await page.click('.cc-kpi.tgt [data-cc-tgt-open], .cc-sug [data-cc-tgt-open]');
    await page.fill('#cc-tgt-form input[name=monthly]', '10'); await page.click('#cc-tgt-form button[type=submit]');
    assert.ok(/not above/.test(await text('#cc-tgt-err')), 'below baseline refused');
    await page.fill('#cc-tgt-form input[name=monthly]', '6000'); await page.selectOption('#cc-tgt-form select[name=period]', '180');
    await page.click('#cc-tgt-form button[type=submit]'); await page.waitForTimeout(500);
    await page.reload(); await toApp();
    assert.ok(/6K/.test(await text('.cc-kpi.tgt')) && /by /.test(await text('.cc-kpi.tgt')), 'target and deadline shown after reload');
    assert.ok(/Progress appears once data after/.test(await text('.cc-target')), 'no fake progress on the baseline data');
    assert.ok(await page.$('.cc-feas'), 'feasibility against the forecast');
    // guide can be hidden for good
    await page.click('#cc-guide-x'); await page.reload(); await toApp();
    assert.ok(!(await page.$('.cc-guide')), 'guide stays hidden');
    // sync: an implemented task appears in the Fix tracker once
    const end = await page.evaluate(() => window.CW_SOURCE.latest);
    const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 35); const impl = d.toISOString().slice(0, 10);
    await go('#tasks');
    const tid = await page.evaluate(id => JSON.parse(localStorage.getItem('cw:tasks:' + window.CW_SOURCE.site)).find(t => t.oppId === id).id, first);
    await go('#tasks?id=' + encodeURIComponent(tid));
    await page.selectOption('#tk-edit select[name=status]', 'implemented'); await page.fill('#tk-edit input[name=implDate]', impl);
    await page.click('#tk-edit button[type=submit]'); await page.waitForTimeout(500);
    await go('#fixes'); await page.waitForTimeout(800);
    const rows = await page.$$eval('tr[data-fx]', r => r.map(x => x.dataset.fx));
    assert.ok(rows.includes('task:' + tid), 'task listed in the Fix tracker');
    assert.equal(rows.filter(k => k === 'task:' + tid).length, 1, 'once');
    assert.ok(/Action board task/.test(await text(`tr[data-fx="task:${tid}"]`)), 'labelled with its source');
    // priorities: impact × effort matrix from the real items
    await go('#priorities');
    const quads = await page.$$eval('.imx-q h3 .pill', p => p.map(x => +x.textContent));
    const n = parseInt((await text('#t-prio-meta')).replace(/,/g, ''), 10);
    assert.equal(quads.length, 4); assert.equal(quads.reduce((a, b) => a + b, 0), n, 'every priority in exactly one box');
    // detail page explanation
    const href = await page.$eval('#t-prio a.opp-link', a => a.getAttribute('href')); await go(href);
    assert.ok(/Why this matters/.test(await text('#view')) && /How to implement/.test(await text('#view')) && /Affected searches/.test(await text('#view')), 'detail explains');
    assert.equal(errors.filter(e => !/ERR_/.test(e)).length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Generative AI report: link, sample, export upload, wrong file, start-screen guard', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo'); await toApp();
    await go('#genai');
    assert.equal(await text('#view h1'), 'Generative AI report');
    const href = await page.$eval('.ga-up a[target=_blank]', a => a.href);
    assert.ok(href.startsWith('https://search.google.com/search-console/performance/search-analytics/ai?resource_id='), 'deep link: ' + href);
    await page.click('#ga-sample'); await page.waitForTimeout(500);
    assert.ok(/Sample data/.test(await text('.ga-src')) && /Same dates/.test(await text('.ga-src')), 'sample labelled, dates match');
    assert.ok(parseInt((await text('#t-ga-pages-meta')).replace(/,/g, ''), 10) > 0, 'pages table');
    assert.ok(await page.$('#ga-chart'), 'trend chart');
    assert.ok(/%/.test(await text('.strip')), 'share of web impressions shown');
    // a real-format export (impressions only) built for the demo site
    const rows = await page.evaluate(() => window.CW_GENAI.sample({ site: 'x', P: [{ p: 'https://www.trailcraft.co/trails/himalaya/kedarkantha-trek', impr: 1000 }], C: [{ d: '2026-07-21', impr: 500 }, { d: '2026-07-22', impr: 500 }] }));
    const wb = XLSX.utils.book_new(); rows.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name));
    const gx = path.join(dir, 'genai-export.xlsx'); XLSX.writeFile(wb, gx);
    await page.setInputFiles('#ga-file', gx); await page.waitForTimeout(600);
    assert.ok(/genai-export\.xlsx/.test(await text('.ga-src')) && /Dates differ/.test(await text('.ga-src')), 'own export loaded, period mismatch stated');
    assert.ok(/same dates/.test(await text('#view')), 'not-shown list explains why it is hidden');
    // the Performance export is refused here
    await page.setInputFiles('#ga-file', cmp.cur); await page.waitForTimeout(500);
    assert.ok(/Performance report export/.test(await text('#ga-err')), 'wrong file refused: ' + await text('#ga-err'));
    // remember in this browser: the report opens again after a reload, inside Clickwise
    await page.check('#ga-keep'); await page.setInputFiles('#ga-file', gx); await page.waitForTimeout(600);
    await page.reload(); await toApp(); await go('#genai');
    assert.ok(/genai-export\.xlsx/.test(await text('.ga-src')), 'remembered report reopens after reload');
    await page.click('#ga-clear'); await page.waitForTimeout(300);
    assert.ok(await page.$('#ga-drop') && !(await page.$('.ga-src')), 'removed');
    await page.reload(); await toApp(); await go('#genai');
    assert.ok(!(await page.$('.ga-src')), 'removed from storage too');
    // and the Generative AI export on the start screen points to this tab
    await page.goto(base + 'app.html'); await page.waitForSelector('#file-input', { state: 'attached' });
    await page.setInputFiles('#file-input', gx); await page.waitForTimeout(800);
    assert.ok(/Generative AI report export/.test(await page.evaluate(() => document.body.textContent)), 'start screen explains where it goes');
    await page.goto(base + 'app.html?demo'); await toApp(); // leave the app open for the tests that follow
    assert.equal(errors.filter(e => !/ERR_/.test(e)).length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('sidebar groups start closed, open only on click, and highlight the current screen’s group', async () => {
    await page.goto(base + 'app.html?demo'); await toApp();
    const open = g => page.$eval(`.nav-grp[data-grp="${g}"] .nav-group`, b => b.getAttribute('aria-expanded'));
    for (const g of ['seo-opportunities', 'automation', 'ai-search', 'search-console', 'explore']) assert.equal(await open(g), 'false', g + ' closed on load');
    assert.ok(await page.isVisible('#btn-settings'), 'whole sidebar reachable without scrolling past open groups');
    await go('#news');
    assert.equal(await open('search-console'), 'false', 'does not open by itself');
    assert.ok(await page.$('.nav-grp[data-grp="search-console"].has-on'), 'current screen’s group highlighted');
    await page.click('.nav-grp[data-grp="explore"] .nav-group');
    assert.ok(await page.isVisible('.nav a[data-view="queries"]'), 'opens on click');
    await page.click('.nav-grp[data-grp="explore"] .nav-group');
    assert.ok(!(await page.isVisible('.nav a[data-view="queries"]')), 'closes on click');
    await page.click('.nav-grp[data-grp="explore"] .nav-group'); await page.reload(); await toApp();
    assert.equal(await open('explore'), 'false', 'closed again after reload');
    assert.ok(/\d/.test(await text('.nav-grp[data-grp="automation"] .nav-badge')), 'closed group shows how many screens it holds');
  });

  await testAsync('Statistics & Trends: own tab and route, direct URL, filters, charts, export, other screens intact', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo#stats'); await toApp(); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => location.hash), '#stats', 'direct URL keeps the route');
    assert.equal(await text('#view h1'), 'Statistics & Trends');
    assert.equal(await text('.nav a.on span'), 'Statistics & Trends', 'its own nav item is active');
    assert.equal(await page.$$eval('.nav a[data-view="stats"]', a => a.length), 1, 'one nav item');
    assert.ok(!(await page.$('#view .cc-title')), 'not inside the Command Center');
    // 3 months, weekly by default; totals equal the sum of the daily rows
    const kpi = async () => (await text('.st-kpi.k-blue b'));
    const sel = await page.evaluate(() => { const D = window.CW_SOURCE; return D && D.latest; });
    const clicks90 = await kpi();
    const bars = async () => page.evaluate(() => Chart.getChart('st-ch-traffic').data.labels.length);
    const weekBars = await bars();
    await page.click('[data-st-g="month"]'); await page.waitForTimeout(300);
    assert.ok(/g=month/.test(await page.evaluate(() => location.hash)), 'granularity in the URL');
    const monthBars = await bars();
    assert.ok(monthBars < weekBars && monthBars >= 3, `chart regrouped: ${weekBars} weeks → ${monthBars} months`);
    await page.click('[data-st-range="28"]'); await page.waitForTimeout(300);
    assert.ok(await kpi() !== clicks90, 'KPIs follow the range');
    await page.click('[data-st-range="365"]'); await page.waitForTimeout(400);
    assert.ok(/No year-on-year comparison/.test(await text('.st-warn')), '12 months has no YoY in 16 months of history');
    assert.ok((await page.$$eval('#t-st-week tbody tr', r => r.length)) > 20, 'weekly breakdown for 12 months');
    // custom range, then reload: the selection survives
    await page.click('[data-st-custom]'); await page.fill('#st-custom input[name=from]', '2026-08-01'); await page.fill('#st-custom input[name=to]', '2026-08-31'); await page.click('#st-custom button'); await page.waitForTimeout(300);
    assert.ok(/1 Aug 2026 – 31 Aug 2026/.test(await text('.st-notes')), 'custom range applied');
    await page.reload(); await toApp(); await page.waitForTimeout(400);
    assert.ok(/1 Aug 2026 – 31 Aug 2026/.test(await text('.st-notes')), 'custom range survives a reload');
    // 3 months vs previous period: winners and losers from the loaded sample periods
    await go('#stats?range=90'); await page.waitForTimeout(300);
    assert.ok(await page.$('#t-st-wp tbody tr td.u'), 'page winners listed');
    await page.click('[data-st-wl="q"]'); await page.waitForTimeout(300);
    assert.ok(await page.$('#t-st-wq'), 'search winners listed');
    assert.ok(/Observed/.test(await text('.st-ins')) && /Possible explanations/.test(await text('.st-ins')), 'insights separate facts from explanations');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#st-export')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(/Clickwise Statistics & Trends/.test(csv) && /"Month"/.test(csv) && /"Week"/.test(csv), 'report CSV');
    // the rest of the app still works
    for (const v of ['priorities', 'tasks', 'ask', 'opps']) { await go('#' + v); assert.ok(await text('#view h1'), v); }
    await go('#overview'); assert.ok(await page.$('#view .cc-title'), 'Command Center unchanged');
    assert.equal(errors.filter(e => !/ERR_/.test(e)).length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('Statistics & Trends › Best day & time: tab, weekday analysis, hourly, calendar, insights', async () => {
    errors.length = 0;
    await page.goto(base + 'app.html?demo#stats?tab=timing'); await toApp(); await page.waitForTimeout(500);
    assert.equal(await text('.st-pagetabs a.on'), 'Best day & time', 'direct URL opens the tab');
    assert.equal(await text('.nav a.on span'), 'Statistics & Trends', 'same nav item');
    assert.ok(/Strongest/.test(await text('.tm-best')) && /Weakest/.test(await text('.tm-best')), 'best day card');
    assert.ok(/not show that publishing/.test(await text('.tm-best')), 'no publishing-time claim');
    assert.equal(await page.$$eval('#t-tm-wd tbody tr', r => r.length), 7, 'seven weekdays');
    assert.equal(await page.$eval('#t-tm-wd tbody tr td', td => td.textContent.trim()), 'Monday', 'Monday first');
    assert.ok(await page.evaluate(() => !!Chart.getChart('tm-ch-hours')), 'hourly chart');
    assert.ok(/not<\/b> a reliable long-term best hour|not a reliable long-term best hour/.test(await page.$eval('#view', v => v.innerHTML)), 'hour-of-day caveat');
    assert.ok(/preliminary/.test(await text('#view')), 'preliminary hours labelled');
    assert.ok(!(await page.$('#tm-arc')), 'no archive option on sample data');
    const cells12 = await page.$$eval('.tm-cal-g .tm-c:not(.empty)', c => c.length);
    await page.click('[data-tm-w="26"]'); await page.waitForTimeout(400);
    assert.ok(/weeks=26/.test(await page.evaluate(() => location.hash)) && /tab=timing/.test(await page.evaluate(() => location.hash)), 'window in the URL, tab kept');
    const cells26 = await page.$$eval('.tm-cal-g .tm-c:not(.empty)', c => c.length);
    assert.ok(cells26 > cells12, `calendar grows: ${cells12} → ${cells26} days`);
    assert.ok(await page.evaluate(() => Chart.getChart('tm-ch-week').data.labels.length) >= 26, 'weekly trend follows the window');
    assert.ok(await page.$('.st-recs li'), 'recommendations');
    assert.ok(await page.$('#t-tm-qw tbody tr'), 'searches gaining');
    // switching tabs keeps both views working
    await page.click('.st-pagetabs a[href="#stats"]'); await page.waitForTimeout(400);
    assert.ok(await page.$('.st-kpis'), 'Trends tab back');
    assert.equal(errors.filter(e => !/ERR_/.test(e)).length, 0, 'JS errors: ' + errors.join(' | '));
  });

  await testAsync('every screen fits a 390 px phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const v of ['overview', 'opps', 'plan', 'quickwins', 'ctr', 'workflows', 'filters', 'filters?q=' + encodeURIComponent('which pages should I fix first'), 'content?tab=topics', 'content?tab=titles', 'content?tab=links', 'content?tab=briefs', 'fixes', 'queries', 'ai', 'priorities', 'tasks', 'ask?q=' + encodeURIComponent('Which five pages should I improve first?'), 'live', 'discover', 'news', 'indexing', 'stats', 'stats?range=365&g=week', 'stats?tab=timing', 'stats?tab=timing&weeks=52']) {
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
    await page.evaluate(s => { localStorage.setItem('cw:saved:' + s, '[{"id":"x","type":"goal","name":"n"}]'); localStorage.setItem('cw:runs:' + s, '[{"goalId":"x","status":"done","count":1}]'); localStorage.setItem('cw:fixes:' + s, '[{"id":"f","scope":"site","date":"2026-01-01"}]'); }, site);
    await page.click('#btn-settings'); page.once('dialog', d => d.accept());
    await page.click('#set-forget'); await page.waitForTimeout(300);
    const left = await page.evaluate(s => ['cw:site:', 'cw:saved:', 'cw:runs:', 'cw:fixes:'].filter(k => localStorage.getItem(k + s) != null), site);
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
        const rows = k === 'page' ? m(S.P, r => [r.p], r => r.p) : k === 'query,page' ? m(S.QP, r => [r.q, r.p], r => r.p) : k === 'query' ? m(S.QP.filter(r => !rx || rx.test(r.p)), r => [r.q]) : k === 'date' ? m(S.C.filter(r => r.d >= body.startDate && r.d <= body.endDate), r => [r.d]) : m(S.Dev, r => [r.d]);
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
    // the probe for the last day of final data is property-wide on purpose (dimensions: date, rowLimit 20)
    assert.ok(bodies.length && bodies.filter(b => !(b.rowLimit === 20 && (b.dimensions || [])[0] === 'date')).every(b => (b.dimensionFilterGroups || [])[0] && b.dimensionFilterGroups[0].filters.some(f => f.dimension === 'page' && f.operator === 'includingRegex')), 'every request carries the page filter');
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
    // the fix tracker asks Search Console for exactly one page
    const b0 = bodies.length;
    await p3.evaluate(() => { location.hash = '#fixes'; }); await p3.waitForTimeout(300);
    const one = await p3.$eval('#fx-pages option', o => o.value);
    const mx = await p3.$eval('#fx-date', e => e.max); const dd = new Date(mx + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() - 20);
    await p3.fill('#fx-url', one); await p3.fill('#fx-date', dd.toISOString().slice(0, 10)); await p3.click('#fx-form button[type=submit]');
    await p3.waitForFunction(() => { const c = document.querySelector('tr[data-fx] .fx-res'); return c && !/Measuring/.test(c.textContent); }, null, { timeout: 15000 });
    assert.ok(bodies.slice(b0).some(b => b.dimensions.join() === 'date' && b.dimensionFilterGroups && b.dimensionFilterGroups[0].filters.some(f => f.dimension === 'page' && f.operator === 'equals' && f.expression === one)), 'page-level daily request sent');
    // and back to the whole site
    await p3.click('#top-scope'); await p3.click('#scope-whole'); await p3.click('#scope-go');
    await p3.waitForFunction(() => /All pages/.test(document.getElementById('top-scope').textContent), null, { timeout: 15000 });
    // change the dates from the date pill
    const b2 = bodies.length, range0 = await p3.$eval('#top-range', e => e.textContent);
    await p3.click('#top-range-btn'); await p3.waitForSelector('#scope-dialog[open]');
    assert.ok(await p3.isVisible('#scope-start'), 'date fields shown');
    await p3.click('#scope-presets [data-days="28"]'); await p3.click('#scope-go');
    await p3.waitForFunction(r => document.getElementById('top-range').textContent !== r, range0, { timeout: 15000 });
    // presets end on the last day Search Console has final data for (read from the property), not on a guess
    const last = S.C[S.C.length - 1].d, first = new Date(Date.parse(last + 'T00:00:00Z') - 27 * 864e5).toISOString().slice(0, 10);
    assert.ok(bodies.slice(b2).some(b => b.startDate === first && b.endDate === last), 'new dates sent: ' + JSON.stringify(bodies.slice(b2).map(b => [b.startDate, b.endDate])));
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

  await testAsync('large site: topics are grouped in the background without freezing the page', async () => {
    // a fake Search Console with 30,000 searches over 2,000 pages
    const mods = ['best', 'price', 'review', 'online', 'india', 'for women', 'for men', 'near me', 'cheap', 'how to clean', 'size guide', 'sale', 'discount', '2026', 'waterproof'];
    const Q = [], QP = [];
    for (let i = 0; Q.length < 30000; i++) mods.forEach((m, j) => { if (Q.length >= 30000) return; const q = `product${i} ${['shoes', 'boots', 'tent'][i % 3]} ${m}`; const impr = 100 + (i * 7 + j) % 400, pos = 3 + (i + j) % 25, clicks = Math.round(impr * Math.max(0.2, 12 - pos) / 200); Q.push({ keys: [q], clicks, impressions: impr, ctr: clicks / impr, position: pos }); if (QP.length < 25000) QP.push({ keys: [q, 'https://big.test/p' + (i % 2000)], clicks, impressions: impr, ctr: clicks / impr, position: pos }); });
    const P = Array.from({ length: 2000 }, (_, i) => ({ keys: ['https://big.test/p' + i], clicks: 40, impressions: 3000, ctr: 0.013, position: 8 }));
    const C = Array.from({ length: 90 }, (_, i) => { const d = new Date(Date.UTC(2026, 6, 1 + i)); return { keys: [d.toISOString().slice(0, 10)], clicks: 3000, impressions: 400000, ctr: 0.0075, position: 9 }; });
    const ctx4 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx4.route('**/*', async r => {
      const u = r.request().url();
      const lib = Object.keys(LOCAL).find(k => u.includes('cdnjs') && u.endsWith(k));
      if (lib) return r.fulfill({ path: LOCAL[lib], contentType: 'text/javascript' });
      if (u.startsWith(base)) return r.continue();
      if (u.includes('searchconsole.googleapis.com')) {
        if (u.endsWith('/sites')) return r.fulfill({ json: { siteEntry: [{ siteUrl: 'sc-domain:big.test', permissionLevel: 'siteOwner' }] } });
        const b = JSON.parse(r.request().postData() || '{}'), k = b.dimensions.join(',');
        const all = k === 'query' ? Q : k === 'page' ? P : k === 'date' ? C : k === 'query,page' ? QP : k === 'device' ? [] : [];
        return r.fulfill({ json: { rows: all.slice(b.startRow || 0, (b.startRow || 0) + b.rowLimit) } });
      }
      return r.fulfill({ status: 204, body: '' });
    });
    const p4 = await ctx4.newPage();
    const errs = []; p4.on('pageerror', e => errs.push(e.message));
    await p4.addInitScript(() => { window.google = { accounts: { oauth2: { initTokenClient: c => ({ requestAccessToken: () => setTimeout(() => c.callback({ access_token: 'test', expires_in: 3600 }), 10) }), revoke: () => { } } } }; });
    await p4.goto(base + 'app.html'); await p4.click('#btn-connect');
    await p4.waitForFunction(() => document.querySelector('#pick-site').value.includes('big.test'));
    await p4.uncheck('#pick-compare'); await p4.click('#pick-go');
    await p4.waitForSelector('#setup:not([hidden]), #app:not([hidden])', { timeout: 30000 });
    if (await p4.isVisible('#setup')) await p4.click('#setup-form button[type=submit]');
    await p4.waitForSelector('#app:not([hidden])');
    const pendingAtStart = await p4.evaluate(() => !document.getElementById('top-content').hidden && /Grouping/.test(document.getElementById('top-content').textContent));
    // how long the main thread is blocked while topics are grouped (timers every 50 ms)
    const lag = await p4.evaluate(async () => { let max = 0, last = performance.now(); for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 50)); const now = performance.now(); max = Math.max(max, now - last - 50); last = now; if (document.getElementById('top-content').hidden && i > 5) break; } return Math.round(max); });
    await p4.waitForFunction(() => document.getElementById('top-content').hidden, null, { timeout: 60000 });
    await p4.evaluate(() => { location.hash = '#content?tab=topics'; }); await p4.waitForTimeout(400);
    const topics = parseInt((await p4.$eval('.ct-tabs a[href$="tab=topics"] .count', e => e.textContent)).replace(/,/g, ''), 10);
    assert.ok(pendingAtStart, 'dashboard shown while topics were still being grouped');
    assert.ok(lag < 1000, `main thread blocked at most ${lag} ms while grouping`);
    assert.ok(topics >= 1500, `${topics} topics`);
    assert.equal(errs.length, 0, 'JS errors: ' + errs.join(' | '));
    console.log(`    (large site: longest main-thread block while grouping ${lag} ms, ${topics} topics)`);
    await ctx4.close();
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

  await testAsync('branded report: branding, logos, print, two A4 pages, forget', async () => {
    const ctx5 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx5.route('**/*', async r => {
      const u = r.request().url();
      const lib = Object.keys(LOCAL).find(k => u.includes('cdnjs') && u.endsWith(k));
      if (lib) return r.fulfill({ path: LOCAL[lib], contentType: 'text/javascript' });
      if (u.startsWith(base)) return r.continue();
      return r.fulfill({ status: 204, body: '' });
    });
    const p5 = await ctx5.newPage();
    const errs = []; p5.on('pageerror', e => errs.push(e.message));
    p5.on('dialog', d => d.accept());
    const t5 = sel => p5.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    await p5.goto(base + 'app.html?demo');
    await p5.waitForSelector('#setup:not([hidden]), #app:not([hidden])', { timeout: 15000 });
    if (await p5.isVisible('#setup')) await p5.click('#setup-form button[type=submit]');
    await p5.waitForSelector('#app:not([hidden])');
    // one tracked fix, so the report shows a measured result
    await p5.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 33); localStorage.setItem('cw:fixes:trailcraft.co', JSON.stringify([{ id: 'r1', scope: 'page', url: 'https://www.trailcraft.co/trails/himalaya/kedarkantha-trek', path: '/trails/himalaya/kedarkantha-trek', date: d.toISOString().slice(0, 10), note: 'Rewrote the title' }])); location.hash = '#wf=report'; });
    await p5.waitForSelector('#rp-form');
    assert.ok(await p5.isVisible('#rp-agency'), 'branding panel open when nothing is saved');
    await p5.fill('#rp-agency', 'Northstar <img src=x onerror="window.__x=1">');
    await p5.fill('#rp-contact', 'hello@northstar.example');
    await p5.fill('#rp-color', '#0f766e');
    await p5.fill('#rp-client', 'Trailcraft');
    await p5.fill('#rp-notes', 'Rewrote 12 titles.\nLaunched the gear hub.');
    await p5.uncheck('#rp-cw');
    await p5.click('#rp-form button[type=submit]');
    await p5.waitForFunction(() => /SEO report: Trailcraft/.test((document.querySelector('.rp-title h2') || {}).textContent || ''));
    assert.ok(/Northstar <img/.test(await t5('.rp-aname')), 'agency name shown as text, not markup');
    assert.equal(await p5.evaluate(() => window.__x), undefined, 'no injected script ran');
    assert.ok(!/Made with Clickwise/.test(await t5('#report')), 'Clickwise credit can be turned off');
    assert.ok(/Launched the gear hub/.test(await t5('.rp-notes')), 'notes shown');
    assert.equal(await p5.$eval('.rp-page', e => getComputedStyle(e).getPropertyValue('--rp').trim().toLowerCase()), '#0f766e', 'brand colour applied');
    const st = await p5.evaluate(() => [JSON.parse(localStorage.getItem('cw:agency')), JSON.parse(localStorage.getItem('cw:client:trailcraft.co'))]);
    assert.ok(st[0].contact === 'hello@northstar.example' && st[0].showClickwise === false && st[1].client === 'Trailcraft', 'agency saved once, client per site');
    // logos: a PNG is redrawn and shown; a non-image is refused with a message
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await p5.setInputFiles('#rp-logo', { name: 'logo.png', mimeType: 'image/png', buffer: png });
    await p5.waitForSelector('img.rp-alogo');
    assert.ok(/^data:image\/png;base64,/.test(await p5.$eval('img.rp-alogo', e => e.getAttribute('src'))), 'logo kept as a PNG data URL');
    await p5.setInputFiles('#rp-clogo', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__y=1</script></svg>') });
    await p5.waitForFunction(() => /PNG, JPG, WebP or GIF/.test(document.getElementById('rp-err').textContent));
    assert.ok(!(await p5.$('img.rp-clogo')), 'SVG logo refused');
    // tracked fix result and the print button
    await p5.waitForSelector('#rp-fixes .rp-fx', { timeout: 15000 });
    assert.ok(/kedarkantha-trek/.test(await t5('#rp-fixes')) && /clicks a day|Too little|Waiting/.test(await t5('#rp-fixes')), 'fix result shown: ' + await t5('#rp-fixes'));
    await p5.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await p5.click('#rep-print');
    assert.equal(await p5.evaluate(() => window.__printed), 1, 'print button opens the print dialog');
    // A4: summary on one page, details on a second; one page with details off
    const pages = async () => { await p5.emulateMedia({ media: 'print' }); const buf = await p5.pdf({ format: 'A4', printBackground: true }); await p5.emulateMedia({ media: 'screen' }); return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; };
    assert.equal(await pages(), 2, 'two A4 pages with details');
    if (!(await p5.isVisible('#rp-details'))) await p5.click('.rp-brand > summary');
    await p5.uncheck('#rp-details'); await p5.click('#rp-form button[type=submit]');
    await p5.waitForFunction(() => !document.querySelector('.rp-p2'));
    assert.equal(await pages(), 1, 'one A4 page without details');
    // phone width: nothing spills sideways
    await p5.setViewportSize({ width: 390, height: 900 }); await p5.waitForTimeout(200);
    assert.ok(await p5.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no horizontal scroll on a phone');
    await p5.setViewportSize({ width: 1360, height: 900 });
    // Forget this site removes the client branding but keeps the agency for other clients
    await p5.click('#btn-settings'); await p5.click('#set-forget');
    await p5.waitForFunction(() => !localStorage.getItem('cw:client:trailcraft.co'));
    assert.ok(await p5.evaluate(() => !!localStorage.getItem('cw:agency')), 'agency branding kept');
    assert.equal(errs.length, 0, 'JS errors: ' + errs.join(' | '));
    await ctx5.close();
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

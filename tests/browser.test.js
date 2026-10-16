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

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
  const files = writeExports(dir);
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

  await testAsync('every screen fits a 390 px phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const v of ['overview', 'plan', 'quickwins', 'ctr', 'workflows', 'filters', 'queries', 'ai']) {
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
    const cov = await text('.cov');
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
    assert.ok(/62\.5%/.test(await text('.cov')), 'coverage from CSVs');
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

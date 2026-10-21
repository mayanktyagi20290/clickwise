// Clickwise "Generative AI report" screen: the Search Console Generative AI report (AI Overviews, AI Mode,
// Discover) from its export, joined with the loaded Performance data. The export stays in this tab's memory;
// nothing is stored.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, stat, table, drawTable, TABLES, chart, cssVar, urlCell, posTag, pctf, svg } = ui;
  const CW = window.CW, GA = window.CW_GENAI, fmtN = CW.fmtN;
  const DATA = new Map(); // site → { G, name, sample }
  let MSG = null;
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const fmtD = s => { if (!s) return '?'; return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  async function readExport(files) {
    if (!window.XLSX) throw new Error('The spreadsheet reader is still loading. Try again in a moment.');
    if (files.some(f => /\.zip$/i.test(f.name))) throw new Error('Search Console’s CSV download comes as a .zip. Unzip it and select the CSV files together, or use Export › Download Excel.');
    const sheets = [];
    for (const f of files) {
      if (f.size > 20e6) throw new Error(`“${f.name}” is larger than 20 MB, which is far bigger than this report’s export.`);
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', raw: true });
      const csv = /\.csv$/i.test(f.name) || wb.SheetNames.length === 1;
      wb.SheetNames.forEach(n => sheets.push({ name: csv ? f.name + ' ' + n : n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }) }));
    }
    return sheets;
  }
  window.CW_GENAIVIEW = { DATA, readExport };

  V.genai = (A, D) => {
    Object.keys(TABLES).filter(k => k.startsWith('t-ga')).forEach(k => delete TABLES[k]);
    const cur = DATA.get(D.site);
    const link = GA.reportUrl(D);
    const intro = head('Generative AI report', 'How often your pages appear in AI Overviews and AI Mode in Search, and in generative AI features in Discover, from Search Console’s Generative AI report, joined with your Performance data.');
    const upload = `<section class="panel ga-up"><div class="panel-b ga-up-b">
        <div><h2>${cur ? 'Load another export' : 'Load the Generative AI report'}</h2>
          <ol class="ga-steps"><li><a href="${esc(link)}" target="_blank" rel="noopener">Open the report in Search Console</a>${D.scope ? ` (filtered to ${esc(D.scope)})` : ''}.</li><li>Set the same dates as this analysis${D.start ? ` (${esc(fmtD(D.start))} – ${esc(fmtD(D.end))})` : ''}, then Export › Download Excel.</li><li>Choose the file here. It is read in this browser and not stored.</li></ol>
          <p class="flat">Search Console does not offer this report through its API yet, so it can’t be pulled automatically.</p></div>
        <div class="ga-up-a"><label class="btn-primary" for="ga-file">Choose export file</label><input id="ga-file" type="file" accept=".xlsx,.xls,.csv" multiple hidden>
          ${D.source === 'demo' ? '<button type="button" class="btn-quiet" id="ga-sample">Use sample data</button>' : ''}
          <a class="btn-quiet" href="${esc(link)}" target="_blank" rel="noopener">Open in Search Console ↗</a>
          ${cur ? '<button type="button" class="btn-link" id="ga-clear">Remove the file</button>' : ''}</div>
      </div><p class="sf-err ga-err" id="ga-err" role="alert">${MSG ? esc(MSG) : ''}</p></section>`;
    MSG = null;
    if (!cur) {
      const html = intro + upload + `<div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>What the report shows</h2></div><div class="panel-b"><ul class="ga-list">
          <li>Impressions of your pages inside AI Overviews and AI Mode, and generative features in Discover.</li>
          <li>Broken down by page, country, device and date.</li>
          <li>No clicks and no searches yet. These impressions are already included in the Web totals of the Performance report.</li></ul></div></section>
        <section class="panel"><div class="panel-h"><h2>What Clickwise adds</h2></div><div class="panel-b"><ul class="ga-list">
          <li>The share of each page’s Google impressions that come from AI features, using the Performance data for the same dates.</li>
          <li>Page-one pages with real demand that never appear in AI features.</li>
          <li>The AI share of all impressions, day by day.</li></ul></div></section></div>`;
      return { html, mount: () => mountUpload(A, D) };
    }
    const R = GA.analyse(cur.G, A, D);
    const top = R.pages[0];
    const strip = `<div class="strip">${stat(fmtN(R.total), 'AI feature impressions', 'indigo')}${R.perDay != null ? stat(fmtN(R.perDay), 'a day on average', '') : ''}${stat(fmtN(R.pages.length), 'pages shown in AI features', '')}${R.shareAll != null ? stat(R.shareAll.toFixed(1) + '%', 'of all web impressions', 'gain') : stat('—', 'share of web impressions (needs matching dates)', '')}</div>`;
    const source = `<div class="ga-src"><span class="tag ${cur.sample ? 'watch' : 'indigo-t'}">${cur.sample ? 'Sample data · generated for the fictional site' : 'From your export: ' + esc(cur.name)}</span>
      ${R.start ? `<span>${svg('clock')}${esc(fmtD(R.start))} – ${esc(fmtD(R.end))}${R.days ? ` (${R.days} days)` : ''}</span>` : ''}
      <span class="tag ${R.comparable ? 'gain' : 'watch'}">${R.period === 'match' ? 'Same dates as the Performance data' : R.period === 'partial' ? 'Dates differ from the Performance data' : R.period === 'none' ? 'No overlap with the Performance data' : 'No dates in the export'}</span>
      ${R.scope ? `<span>Filtered to ${esc(R.scope)}</span>` : ''}</div>`;
    const notes = `<div class="note ga-notes">${R.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>`;
    const pageCols = [
      { k: 'path', l: 'Page', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p },
      { k: 'ai', l: 'AI impressions', r: 1, f: r => fmtN(r.ai) },
      { k: 'web', l: 'Web impressions', r: 1, f: r => r.web == null ? '<span class="flat">not in Performance data</span>' : fmtN(r.web) },
      { k: 'share', l: 'AI share', r: 1, f: r => r.share == null ? '<span class="flat">—</span>' : `<span class="ga-bar"><i style="width:${Math.min(100, r.share).toFixed(1)}%"></i></span>${r.over ? '<span class="lossv">over 100%</span>' : r.share.toFixed(1) + '%'}`, csv: r => r.share == null ? '' : r.share.toFixed(1) },
      { k: 'clicks', l: 'Clicks (all search)', r: 1, f: r => r.clicks == null ? '—' : fmtN(r.clicks) },
      { k: 'pos', l: 'Position', r: 1, f: r => r.pos ? posTag(r.pos) : '—', csv: r => r.pos ? r.pos.toFixed(1) : '' }
    ];
    const small = (title, rows, label) => `<section class="panel"><div class="panel-h"><h2>${title}</h2></div>${rows.length ? `<div class="tw"><table class="cc-wt"><thead><tr><th scope="col">${label}</th><th scope="col" class="r">AI impressions</th><th scope="col" class="r">Share</th></tr></thead><tbody>${rows.slice(0, 8).map(r => `<tr><td>${esc(r.d === r.d.toUpperCase() ? r.d.charAt(0) + r.d.slice(1).toLowerCase() : r.d)}</td><td class="r">${fmtN(r.impr)}</td><td class="r">${R.total ? (r.impr / R.total * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Not in this export.</p>'}</section>`;
    const html = intro + source + strip +
      (R.daily.length ? `<section class="panel"><div class="panel-h"><h2>AI feature impressions over time</h2>${R.daily.some(x => x.web != null) ? '<p>Bars: AI feature impressions. Line: their share of all web impressions that day.</p>' : '<p>Load Performance data for the same dates to see the daily AI share.</p>'}</div><div class="panel-b"><div class="chart-box"><canvas id="ga-chart" aria-label="AI feature impressions by day"></canvas></div></div></section>` : '') +
      `<section class="panel"><div class="panel-h"><h2>Pages shown in AI features (${fmtN(R.pages.length)})</h2>${top ? `<p>Most shown: ${esc(top.path)} with ${fmtN(top.ai)} impressions. ${R.matched} of ${R.pages.length} pages are also in the loaded Performance data.</p>` : ''}</div>
        ${table('t-ga-pages', pageCols, R.pages, { sort: 'ai', file: 'generative-ai-pages', searchKeys: ['path'], placeholder: 'Filter pages', pageSize: 25, empty: 'No pages in this export.' })}</section>
      <section class="panel"><div class="panel-h"><h2>Page-one pages not shown in AI features</h2><p>Pages ranking in the top 10 with at least median impressions that never appear in the export. A starting list for AI search work: check how each answers its main searches.</p></div>
        ${R.notCited ? (R.notCited.length ? `<div class="tw"><table class="cc-wt"><thead><tr><th scope="col">Page</th><th scope="col" class="r">Web impressions</th><th scope="col" class="r">Clicks</th><th scope="col" class="r">Position</th></tr></thead><tbody>${R.notCited.slice(0, 15).map(r => `<tr><td class="u">${urlCell(r.p, r.path)}</td><td class="r">${fmtN(r.web)}</td><td class="r">${fmtN(r.clicks)}</td><td class="r">${posTag(r.pos)}</td></tr>`).join('')}</tbody></table></div>${R.notCited.length > 15 ? `<p class="flat ga-more">${R.notCited.length - 15} more.</p>` : ''}` : '<p class="empty">Every page-one page with real demand appears in AI features.</p>') : `<p class="empty">${esc(R.notCitedWhy)}</p>`}</section>
      <div class="grid-2 even">${small('Countries', R.countries, 'Country')}${small('Devices', R.devices, 'Device')}</div>
      ${notes}${upload}`;
    const mount = () => {
      mountUpload(A, D);
      drawTable('t-ga-pages');
      if (R.daily.length && document.getElementById('ga-chart')) {
        const share = R.daily.map(x => x.web ? +(x.ai / x.web * 100).toFixed(2) : null);
        chart('ga-chart', { type: 'bar', data: { labels: R.daily.map(x => x.d.slice(5)), datasets: [
          { type: 'bar', label: 'AI feature impressions', data: R.daily.map(x => x.ai), backgroundColor: cssVar('--sky') || '#7C3AED', borderRadius: 3, yAxisID: 'y' },
          ...(share.some(v => v != null) ? [{ type: 'line', label: 'Share of web impressions (%)', data: share, borderColor: cssVar('--good') || '#059669', pointRadius: 0, tension: .3, borderWidth: 2, yAxisID: 'y1' }] : [])
        ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, title: { display: true, text: 'Impressions' } }, ...(share.some(v => v != null) ? { y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'Share %' } } } : {}) } } });
      }
    };
    return { html, mount };
  };

  function mountUpload(A, D) {
    const err = document.getElementById('ga-err'), inp = document.getElementById('ga-file');
    if (inp) inp.addEventListener('change', async () => {
      const files = [...inp.files]; if (!files.length) return;
      try {
        const G = GA.parse(await readExport(files));
        if (!G.ok) { err.textContent = G.error; return; }
        DATA.set(D.site, { G, name: files.map(f => f.name).join(', '), sample: false }); rerender();
      } catch (e) { err.textContent = e.message || 'That file could not be read.'; }
    });
    const s = document.getElementById('ga-sample');
    if (s) s.addEventListener('click', () => { const G = GA.parse(GA.sample(D)); if (G.ok) { DATA.set(D.site, { G, name: 'sample', sample: true }); rerender(); } });
    const c = document.getElementById('ga-clear');
    if (c) c.addEventListener('click', () => { DATA.delete(D.site); rerender(); });
  }
})();

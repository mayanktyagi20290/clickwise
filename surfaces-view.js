// Clickwise screens: Discover, Google News, Last 24 hours and Indexing.
// Data comes from window.CW_SOURCE (set by app.js): Search Console when signed in, generated sample data for the
// sample site, or an export the user drops on the screen. Nothing fetched here is stored.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, C, chart, cssVar, pctf, posTag, urlCell, serp, accHead, svg, tileDelta } = ui;
  const SURF = window.CW_SURF, fmtN = window.CW.fmtN;

  const CACHE = new Map();      // key → { status, data, err }
  const UPLOADS = new Map();    // site|kind → parsed export
  const RUNS = new Map();       // site → URL inspection run
  const baseOf = () => (location.hash.slice(1) || 'overview').split('?')[0];
  // re-render a screen when its data arrives, if the user is still on it
  const rerender = view => { if (baseOf() === view) window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const src = () => window.CW_SOURCE || { kind: 'file' };
  const keyOf = (D, k) => [src().kind, D.site, D.scope || '', D.start, D.end, (D.filters || {}).device || '', k].join('|');
  function load(key, view, fn) {
    if (!CACHE.has(key)) {
      CACHE.set(key, { status: 'loading' });
      fn().then(data => { CACHE.set(key, { status: 'done', data }); rerender(view); }, err => { CACHE.set(key, { status: 'error', err: err.message || String(err) }); rerender(view); });
    }
    return CACHE.get(key);
  }
  const shift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const rowsOf = (res, keys) => (res && res.rows || []).map(r => { const o = { clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position || 0 }; keys.forEach((k, i) => o[k] = r.keys[i]); return o; });
  const loading = (title, sub, what) => ({ html: head(title, sub) + `<section class="panel"><p class="empty sv-loading">${esc(what)}</p></section>` });
  const failed = (title, sub, msg, view) => ({ html: head(title, sub) + `<div class="note warn">${esc(msg)}</div><button type="button" class="btn-quiet" data-sv-retry="${view}">Try again</button>` });
  const tone2tag = t => t === 'good' ? 'gain' : t === 'risk' || t === 'bad' ? 'risk' : t === 'watch' || t === 'warn' ? 'watch' : '';
  const ago = n => n == null ? '—' : n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
  const sheetsOf = async files => {
    if (!window.XLSX) throw new Error('The spreadsheet reader is still loading. Try again in a moment.');
    const out = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) throw new Error('That is the CSV download, which comes as a .zip. Unzip it and select the CSV files together, or use Export › Download Excel.');
      if (f.size > 50 * 1024 * 1024) throw new Error(`“${f.name}” is larger than 50 MB.`);
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'array', raw: true });
      wb.SheetNames.forEach(n => out.push({ name: wb.SheetNames.length === 1 ? f.name.replace(/\.[^.]+$/, '') : n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).filter(r => r.some(c => c !== '')) }));
    }
    return out;
  };
  const dropZone = (id, label, hint) => `<label class="sv-drop" for="${id}"><input type="file" id="${id}" accept=".xlsx,.xls,.csv" multiple hidden><b>${esc(label)}</b><span>${hint}</span></label>`;
  const insightList = list => list.length ? `<ul class="sv-ins">${list.map(i => `<li class="${tone2tag(i.tone)}">${svg(i.tone === 'good' ? 'check' : i.tone === 'info' ? 'spark' : 'alert')}<span>${esc(i.text)}</span></li>`).join('')}</ul>` : '<p class="empty">Nothing unusual in this period.</p>';

  // ── Discover and Google News ──
  const SURFACE = {
    discover: { title: 'Discover', type: 'discover', sub: 'Traffic from Google Discover, the feed in the Google app and on Chrome’s new tab page. There are no search queries here: Discover shows cards based on interests.', gsc: 'discover' },
    news: { title: 'Google News', type: 'googleNews', sub: 'Traffic from news.google.com and the Google News app. (The “News” tab inside Google Search is a search type: pick it when you connect.)', gsc: 'googlenews' }
  };
  function fetchSurface(D, kind) {
    const S = src(), cfg = SURFACE[kind];
    const days = D.days || Math.round((new Date(D.end) - new Date(D.start)) / 864e5) + 1;
    const pe = shift(D.start, -1), ps = shift(pe, -days + 1);
    const q = (dims, s, e, n) => S.gsc.query({ startDate: s, endDate: e, dimensions: dims, type: cfg.type, rowLimit: n });
    return Promise.allSettled([q(['date'], D.start, D.end, 1000), q(['page'], D.start, D.end, 5000), q(['country'], D.start, D.end, 50), q(['searchAppearance'], D.start, D.end, 50), q(['date'], ps, pe, 1000), q(['page'], ps, pe, 5000)])
      .then(r => {
        if (r[0].status === 'rejected' && r[1].status === 'rejected') throw r[0].reason;
        const v = (i, keys) => r[i].status === 'fulfilled' ? rowsOf(r[i].value, keys) : [];
        return { daily: v(0, ['d']), pages: v(1, ['p']), countries: v(2, ['d']), appearance: v(3, ['d']), prevDaily: r[4].status === 'fulfilled' ? v(4, ['d']) : null, prevPages: r[5].status === 'fulfilled' ? v(5, ['p']) : null, prevRange: [ps, pe] };
      });
  }
  function surfaceView(A, D, kind) {
    const S = src(), cfg = SURFACE[kind];
    let data = null, note = '';
    if (S.kind === 'api') {
      const st = load(keyOf(D, kind), kind, () => fetchSurface(D, kind));
      if (st.status === 'loading') return loading(cfg.title, cfg.sub, `Fetching ${cfg.title} data from Search Console…`);
      if (st.status === 'error') return failed(cfg.title, cfg.sub, `Search Console did not return ${cfg.title} data: ${st.err}`, kind);
      data = st.data;
      if (data.prevRange) note = `Compared with ${data.prevRange[0]} – ${data.prevRange[1]}.`;
    } else if (S.kind === 'demo') { data = SURF.demoSurface(D, kind); note = '<b>Sample data:</b> generated for the fictional site.'; }
    else data = UPLOADS.get(D.site + '|' + kind) || null;

    const upload = dropZone('sv-file-' + kind, `Drop your ${cfg.title} export here`, `In Search Console open <b>Performance › ${cfg.title}</b>, pick the same dates, then <b>Export › Download Excel</b>.`);
    if (!data) {
      return { html: head(cfg.title, cfg.sub) + `<section class="panel"><div class="panel-b">${S.kind === 'file' ? `<p class="flat">Your Performance export covers Search only. Add the ${esc(cfg.title)} export to see it here, or connect Search Console to load it automatically.</p>` : ''}${upload}<p class="sf-err" id="sv-err-${kind}" role="alert"></p></div></section>`, mount: () => mountUpload(D, kind) };
    }
    const R = SURF.surface(data, A.P, kind);
    if (R.empty) return { html: head(cfg.title, cfg.sub) + `<section class="panel"><p class="empty">No ${esc(cfg.title)} impressions for ${esc(D.site)} between ${esc(D.start)} and ${esc(D.end)}${D.scope ? ` in ${esc(D.scope)}` : ''}. Search Console only shows this report once a site reaches a minimum level of ${esc(cfg.title)} traffic.</p></section>` + checklist(kind) };
    const p = R.prevTot;
    const T = (tone, v, l, s, d) => `<div class="tile ${tone}"><div class="tile-v">${v}</div><div class="tile-l">${l}</div><div class="tile-s">${s}</div>${d || ''}</div>`;
    const pageCols = [C.page, C.clicks, C.impr, C.ctr,
      { k: 'prevClicks', l: 'Previous clicks', r: 1, f: r => r.prevClicks == null ? '—' : fmtN(r.prevClicks) },
      { k: 'change', l: 'Change', r: 1, f: r => r.change == null ? (r.prevClicks === 0 && r.clicks ? '<span class="tag gain">new</span>' : '—') : `<span class="${r.change >= 0 ? 'gainv' : 'lossv'}">${r.change > 0 ? '+' : ''}${r.change.toFixed(0)}%</span>` },
      { k: 'searchClicks', l: 'Search clicks', r: 1, f: r => fmtN(r.searchClicks) }];
    const small = (rows, label) => rows.length ? `<table><thead><tr><th>${label}</th><th class="r">Clicks</th><th class="r">Impr.</th><th class="r">CTR</th></tr></thead><tbody>${rows.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 8).map(r => `<tr><td>${esc(String(r.d).toUpperCase().length <= 3 ? String(r.d).toUpperCase() : r.d)}</td><td class="r">${fmtN(r.clicks)}</td><td class="r">${fmtN(r.impr)}</td><td class="r">${pctf(r.impr ? r.clicks / r.impr * 100 : 0)}</td></tr>`).join('')}</tbody></table>` : '';
    const html = head(cfg.title, cfg.sub + (note ? ` ${note}` : '')) +
      `<section class="tiles" aria-label="${esc(cfg.title)} totals">
        ${T('t-blue', fmtN(R.tot.clicks), 'Clicks', `${esc(D.start)} – ${esc(D.end)}`, tileDelta(R.tot.clicks, p && p.clicks))}
        ${T('t-green', fmtN(R.tot.impr), 'Impressions', 'Times a card was shown', tileDelta(R.tot.impr, p && p.impr))}
        ${T('t-amber', pctf(R.tot.ctr, 2), 'CTR', 'Cards tapped ÷ shown', tileDelta(R.tot.ctr, p && p.ctr, false, 'pt'))}
        ${T('t-red', R.pages.filter(x => x.clicks > 0).length.toLocaleString(), 'Pages with clicks', `${R.pages.length.toLocaleString()} pages shown`)}
      </section>
      <div class="grid-2">
        <section class="panel"><div class="panel-h"><h2>Daily ${esc(cfg.title)} traffic</h2></div>
          <div class="panel-b">${R.daily.length ? `<div class="chart-box"><canvas id="sv-ch-${kind}" aria-label="${esc(cfg.title)} clicks and impressions by day"></canvas></div>` : '<p class="empty">No daily data in this export.</p>'}</div></section>
        <section class="panel"><div class="panel-h"><h2>What stands out</h2></div><div class="panel-b">${insightList(R.insights)}</div></section>
      </div>
      <section class="panel"><div class="panel-h"><h2>Pages</h2><p>“Search clicks” is the same page in Search over the analysed dates, so you can see which stories live on ${esc(cfg.title)} rather than search.</p></div>
        ${table('t-sv-' + kind, pageCols, R.pages, { sort: 'clicks', file: kind + '-pages', searchKeys: ['path'] })}</section>
      <div class="stack">
        ${R.weak.length ? `<details class="acc" open>${accHead('eye', 'amber', 'Shown but rarely tapped', `Under half the usual ${cfg.title} CTR (${pctf(R.typical)}). Usually the image or headline.`, R.weak.length + ' pages', 'amber')}
          <div class="acc-tip"><b>What to do:</b> use a large, relevant image (1200 px+ with max-image-preview:large), and a headline that names the specific news or benefit without clickbait.</div>
          ${table('t-sv-weak-' + kind, [C.page, C.impr, C.clicks, C.ctr], R.weak, { sort: 'impr', file: kind + '-weak', pageSize: 25 })}</details>` : ''}
        ${R.dropped.length ? `<details class="acc">${accHead('down', 'red', 'Dropped out', `Had ${cfg.title} clicks in the previous period, none now.`, R.dropped.length + ' pages', 'red')}
          <div class="acc-tip"><b>What to do:</b> ${kind === 'news' ? 'news visibility fades as stories age; publish follow-ups and keep the topic covered.' : 'Discover traffic decays naturally. For evergreen pieces, refresh with a new angle and a new image, then share it again.'}</div>
          ${table('t-sv-drop-' + kind, [C.page, { k: 'prevClicks', l: 'Previous clicks', r: 1, f: r => fmtN(r.prevClicks) }], R.dropped, { sort: 'prevClicks', file: kind + '-dropped', pageSize: 25 })}</details>` : ''}
        ${R.onlyHere.length ? `<details class="acc">${accHead('spark', 'violet', `Win on ${cfg.title}, not on Search`, 'More than twice the clicks from here than from Search.', R.onlyHere.length + ' pages', 'violet')}
          <div class="acc-tip"><b>What to do:</b> these topics resonate. Give each one a search target too: a query-led title variant, an FAQ, or an evergreen explainer that links to it.</div>
          ${table('t-sv-only-' + kind, [C.page, C.clicks, { k: 'searchClicks', l: 'Search clicks', r: 1, f: r => fmtN(r.searchClicks) }], R.onlyHere, { sort: 'clicks', file: kind + '-vs-search', pageSize: 25 })}</details>` : ''}
      </div>
      ${R.countries.length || R.appearance.length ? `<div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Countries</h2></div><div class="panel-b flush">${small(R.countries, 'Country') || '<p class="empty">No country data.</p>'}</div></section>
        <section class="panel"><div class="panel-h"><h2>Appearance</h2></div><div class="panel-b flush">${small(R.appearance, 'Type') || '<p class="empty">No appearance data.</p>'}</div></section></div>` : ''}
      ${checklist(kind)}
      ${S.kind === 'file' ? `<p class="flat sv-replace">Showing the export you added. <button type="button" class="btn-link" data-sv-clear="${kind}">Use a different file</button></p>` : ''}`;
    const mount = () => {
      [['t-sv-', ''], ['t-sv-weak-'], ['t-sv-drop-'], ['t-sv-only-']].forEach(([p]) => drawTable(p + kind));
      if (R.daily.length) chart('sv-ch-' + kind, { type: 'line', data: { labels: R.daily.map(r => r.d.slice(5)), datasets: [
        { label: 'Clicks', data: R.daily.map(r => r.clicks), borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal-soft'), fill: true, tension: .3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y' },
        { label: 'Impressions', data: R.daily.map(r => r.impr), borderColor: cssVar('--sky'), tension: .3, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' }
      ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: v => fmtN(v) } }, y1: { position: 'right', grid: { display: false }, ticks: { callback: v => fmtN(v) } } } } });
    };
    return { html, mount };
  }
  const checklist = kind => `<details class="acc sv-check">${accHead('check', 'green', kind === 'news' ? 'Google News checklist' : 'Discover checklist', 'What Google’s documentation asks for. Check these when traffic is low or falling.', SURF.CHECKS[kind].length + ' checks', 'green')}
    <ul class="sv-ck">${SURF.CHECKS[kind].map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul></details>`;
  function mountUpload(D, kind) {
    const inp = document.getElementById('sv-file-' + kind); if (!inp) return;
    const err = document.getElementById('sv-err-' + kind);
    inp.addEventListener('change', async () => {
      try {
        const sheets = await sheetsOf([...inp.files]);
        const r = kind === 'index' ? SURF.indexExport(sheets) : SURF.surfaceExport(sheets);
        if (!r.ok) throw new Error(kind === 'index' ? 'No reasons, chart or URL list found. Export it from Indexing › Pages (or a reason’s detail page) › Export › Download Excel.' : 'No Date or Pages sheet with clicks and impressions found. Export it from Performance › ' + SURFACE[kind].title + ' › Export.');
        UPLOADS.set(D.site + '|' + kind, r); rerender(kind === 'index' ? 'indexing' : kind);
      } catch (e) { if (err) err.textContent = e.message; }
    });
  }

  // ── Last 24 hours ──
  // Branded / non-branded: the brand names from Settings, as one case-insensitive pattern Search Console applies
  // on its side (its regex syntax is RE2). Filtering by search leaves out searches Google keeps private, so
  // branded + non-branded is a little less than all searches.
  function brandTerms(D) { try { const s = JSON.parse(localStorage.getItem('cw:site:' + D.site)); return s && Array.isArray(s.brand) ? s.brand.map(String).map(t => t.trim()).filter(Boolean).slice(0, 30) : []; } catch (e) { return []; } }
  const brandPattern = terms => terms.length ? '(?i)(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')' : null;
  const brandTestOf = terms => { const p = brandPattern(terms); if (!p) return () => false; const re = new RegExp(p.slice(4), 'i'); return q => re.test(String(q || '')); };
  // Non-branded is worked out as all searches minus branded ones, the way Search Console's own Branded /
  // Non-branded filter splits them: every search lands in one of the two, and searches Google keeps private count
  // as non-branded. Excluding the brand pattern directly would drop those private searches altogether.
  // Position is re-weighted: (pos × impressions of all − pos × impressions of branded) ÷ remaining impressions.
  function minus(all, brand, keyOf) {
    const b = new Map((brand || []).map(r => [keyOf(r), r]));
    return (all || []).map(r => {
      const x = b.get(keyOf(r)); if (!x) return r;
      const clicks = Math.max(0, r.clicks - x.clicks), impr = Math.max(0, r.impr - x.impr);
      const pos = impr ? Math.max(1, (r.pos * r.impr - x.pos * x.impr) / impr) : 0;
      return { ...r, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos };
    }).filter(r => r.impr > 0 || r.clicks > 0);
  }
  async function fetchSet(D, filters) {
    const S = src(), type = S.gsc.type;
    const q = body => S.gsc.query({ type, ...body, ...(filters.length ? { dimensionFilterGroups: [{ groupType: 'and', filters }] } : {}) });
    const H = await q({ startDate: SURF.ptDate(-8), endDate: SURF.ptDate(0), dimensions: ['hour'], dataState: 'hourly_all', rowLimit: 500 });
    const rows = (H.rows || []).map(r => ({ h: r.keys[0], clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position }));
    const meta = H.metadata || {};
    const out = { rows, firstIncomplete: meta.first_incomplete_hour || meta.firstIncompleteHour || null, exact: true };
    // top queries and pages by hour; if Search Console refuses the hour pairing, fall back to fresh daily data
    const hx = dim => q({ startDate: SURF.ptDate(-3), endDate: SURF.ptDate(0), dimensions: ['hour', dim], dataState: 'hourly_all', rowLimit: 25000 }).then(d => (d.rows || []).map(r => ({ h: r.keys[0], [dim === 'query' ? 'q' : 'p']: r.keys[1], clicks: r.clicks, impr: r.impressions, pos: r.position })));
    const [hq, hp] = await Promise.allSettled([hx('query'), hx('page')]);
    if (hq.status === 'fulfilled' && hp.status === 'fulfilled') { out.queries = hq.value; out.pages = hp.value; return out; }
    out.exact = false;
    const dx = (dim, s, e) => q({ startDate: s, endDate: e, dimensions: [dim], dataState: 'all', rowLimit: 5000 }).then(d => rowsOf(d, [dim === 'query' ? 'q' : 'p']));
    const [fq, fp, pq] = await Promise.allSettled([dx('query', SURF.ptDate(-1), SURF.ptDate(0)), dx('page', SURF.ptDate(-1), SURF.ptDate(0)), dx('query', SURF.ptDate(-3), SURF.ptDate(-2))]);
    out.dayQueries = fq.status === 'fulfilled' ? fq.value : []; out.dayPages = fp.status === 'fulfilled' ? fp.value : []; out.dayPrevQueries = pq.status === 'fulfilled' ? pq.value : [];
    return out;
  }
  // "/employers/" means that page and everything under it: /employers, /employers/ and /employers/anything,
  // with or without a trailing slash, but not /employers-old or /blog/employers/. A full URL also limits the host.
  function folderRegex(input) {
    let v = String(input || '').trim(); if (!v) return null;
    let host = null;
    if (/^https?:\/\//i.test(v)) { try { const u = new URL(v); host = u.hostname; v = u.pathname; } catch (e) { return null; } }
    const path = ('/' + v.replace(/^\/+/, '')).replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!path) return null;
    const esc2 = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return '^https?://' + (host ? esc2(host) : '[^/]+') + esc2(path) + '(?:[/?#].*)?$';
  }
  async function fetchLive(D, mode, pattern, pageContains, isBrand) {
    const rx = folderRegex(pageContains);
    const base = rx ? [{ dimension: 'page', operator: 'includingRegex', expression: rx }] : [];
    const brandF = pattern ? [{ dimension: 'query', operator: 'includingRegex', expression: pattern }] : [];
    let out;
    if (mode === 'brand' && pattern) out = await fetchSet(D, base.concat(brandF));
    else if (mode === 'non' && pattern) {
      const [all, br] = await Promise.all([fetchSet(D, base), fetchSet(D, base.concat(brandF))]);
      out = { ...all, rows: minus(all.rows, br.rows, r => r.h), split: { all: all.rows, brand: br.rows } };
      if (all.exact && br.exact) {
        out.queries = (all.queries || []).filter(r => !isBrand(r.q));
        out.pages = minus(all.pages, br.pages || [], r => r.h + '|' + r.p);
      } else {
        out.exact = false;
        out.dayQueries = (all.dayQueries || []).filter(r => !isBrand(r.q)); out.dayPrevQueries = (all.dayPrevQueries || []).filter(r => !isBrand(r.q));
        out.dayPages = minus(all.dayPages, br.dayPages || [], r => r.p);
      }
    } else out = await fetchSet(D, base);
    out.prevQueries = out.queries; out.prevPages = out.pages;
    if (out.dayPages) out.dayPages = out.dayPages.map(r => ({ ...r, path: SURF.pathOf(r.p) }));
    return out;
  }
  V.live = (A, D) => {
    const S = src(), title = 'Last 24 hours', sub = 'Hour-by-hour Search performance, as fresh as Search Console has it (usually a few hours behind). Times are shown in your time zone.';
    // branded searches are left out by default; the choice is kept in the address so a reload keeps it
    const terms = brandTerms(D), pattern = brandPattern(terms), isBrand = brandTestOf(terms);
    const hp = new URLSearchParams((location.hash.split('?')[1]) || '');
    const saved = (() => { try { return localStorage.getItem('cw:live-brand'); } catch (e) { return null; } })();
    const pick = ['all', 'brand', 'non'].includes(hp.get('brand')) ? hp.get('brand') : ['all', 'brand', 'non'].includes(saved) ? saved : 'non';
    const mode = !pattern ? 'all' : pick;
    // optional folder filter: the page and every page under it
    const pageContains = (hp.get('page') || '').trim().slice(0, 200);
    const modeLabel = { non: 'Non-branded', all: 'All searches', brand: 'Branded' }[mode];
    const seg = `<div class="sv-brand"><div class="seg" role="group" aria-label="Searches to include">${[['non', 'Non-branded'], ['all', 'All searches'], ['brand', 'Branded']].map(([k, l]) => `<button type="button" data-live-brand="${k}" class="${mode === k ? 'on' : ''}"${!pattern ? ' disabled' : ''} aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
      <span class="flat">${pattern ? `Brand names: ${esc(terms.join(', '))} · <button type="button" class="btn-link" id="sv-brand-edit">Edit</button>${mode !== 'all' ? ' · Non-branded = all searches minus branded ones, so searches Google keeps private count as non-branded, as in Search Console. Search Console decides “branded” with its own AI classifier (misspellings, product names); Clickwise uses the brand names you list, so the split can differ slightly.' : ''}` : 'No brand names set, so all searches are shown. <button type="button" class="btn-link" id="sv-brand-edit">Add brand names</button> to split branded and non-branded.'}</span></div>`;
    const pageForm = S.kind === 'api' ? `<form class="sv-pagef" id="sv-pagef" autocomplete="off"><label class="field"><span>Folder or page</span><input name="page" value="${esc(pageContains)}" placeholder="e.g. /employers/" maxlength="200"></label><button class="btn-quiet" type="submit">Apply</button>${pageContains ? '<button class="btn-link" type="button" id="sv-pagef-x">Clear</button>' : ''}<span class="flat">${pageContains ? `${esc(pageContains.replace(/\/+$/, ''))} and every page under it` : 'All pages'}${D.scope ? ` · within the analysed ${esc(D.scope)}` : ''}</span></form>` : '';
    const segAll = seg + pageForm;
    let data, demoNote = '';
    if (S.kind === 'api') {
      const k = keyOf(D, 'live:' + mode + ':' + (pattern || '') + ':' + pageContains + ':' + (LIVE_TICK.get(D.site) || 0));
      const st = load(k, 'live', () => fetchLive(D, mode, pattern, pageContains, isBrand));
      if (st.status === 'loading') { const l = loading(title, sub, `Fetching hourly data (${modeLabel.toLowerCase()}) from Search Console…`); l.html = l.html.replace('</header>', '</header>' + segAll); return { html: l.html, mount: () => liveSeg(D) }; }
      if (st.status === 'error') return failed(title, sub, `Search Console did not return hourly data: ${st.err}`, 'live');
      data = st.data;
    } else if (S.kind === 'demo') {
      data = SURF.demoHourly(D);
      if (mode !== 'all') {
        // sample only: the generated hourly totals carry no search text, so they are split by the sample site's branded share of clicks
        const tot = (D.Q || []).reduce((a, r) => (a.c += r.clicks, a.b += isBrand(r.q) ? r.clicks : 0, a.i += r.impr, a.bi += isBrand(r.q) ? r.impr : 0, a), { c: 0, b: 0, i: 0, bi: 0 });
        const sc = mode === 'brand' ? tot.b / (tot.c || 1) : 1 - tot.b / (tot.c || 1), si = mode === 'brand' ? tot.bi / (tot.i || 1) : 1 - tot.bi / (tot.i || 1);
        data = { ...data, rows: data.rows.map(r => ({ ...r, clicks: Math.round(r.clicks * sc), impr: Math.round(r.impr * si) })) };
        demoNote = ` The sample's hourly ${mode === 'brand' ? 'branded' : 'non-branded'} totals are its generated totals scaled by its branded share of clicks.`;
      }
      const keep = r => mode === 'all' || (mode === 'brand') === isBrand(r.q);
      data = { ...data, queries: (data.queries || []).filter(keep), prevQueries: (data.prevQueries || []).filter(keep) };
    }
    else return { html: head(title, sub) + `<section class="panel"><p class="empty">Hourly data comes straight from the Search Console API, so it needs a connected property. Click <b>New analysis</b> and sign in with Google, or open <a href="https://search.google.com/search-console/performance/search-analytics" target="_blank" rel="noopener">Performance › 24 hours</a> in Search Console.</p></section>` };
    const H = SURF.hourly(data.rows, data.firstIncomplete);
    if (H.empty) return { html: head(title, sub) + '<section class="panel"><p class="empty">No hourly impressions in the last 8 days for this property and filter.</p></section>' };
    const from = H.start, to = H.end + 36e5 - 1, pFrom = from - 24 * 36e5, pTo = from - 1;
    let topQ, topP, newQ, approx = '';
    if (data.exact) {
      topQ = SURF.hourTop(data.queries || [], 'q', from, to);
      topP = SURF.hourTop(data.pages || [], 'p', from, to);
      const prevQ = SURF.hourTop(data.prevQueries || [], 'q', pFrom, pTo), pm = new Map(prevQ.map(r => [r.q, r]));
      const prevP = SURF.hourTop(data.prevPages || [], 'p', pFrom, pTo), ppm = new Map(prevP.map(r => [r.p, r]));
      topQ.forEach(r => { const o = pm.get(r.q); r.prev = o ? o.clicks : 0; });
      topP.forEach(r => { const o = ppm.get(r.p); r.prev = o ? o.clicks : 0; });
      newQ = SURF.newIn(topQ, prevQ, 'q');
    } else {
      topQ = data.dayQueries.sort((a, b) => b.clicks - a.clicks); topP = data.dayPages.sort((a, b) => b.clicks - a.clicks);
      newQ = SURF.newIn(topQ, data.dayPrevQueries || [], 'q');
      approx = '<div class="note">Search Console did not return queries by hour for this property, so these lists use the freshest daily data (today and yesterday, Pacific time) instead of exactly the last 24 hours.</div>';
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hm = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dm = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
    const L = H.tot, P = H.prevTot, W = H.weekTot;
    // tileDelta says "vs previous" (in its tooltip too), so every occurrence is renamed
    const cmp = (cur, a, b, inv, unit) => (tileDelta(cur, a, inv, unit) || '').split('vs previous').join('vs day before') + (b ? (tileDelta(cur, b, inv, unit) || '').split('vs previous').join('vs last week') : '');
    const T = (tone, v, l, d) => `<div class="tile ${tone}"><div class="tile-v">${v}</div><div class="tile-l">${l}</div><div class="tile-s">${esc(dm(H.start))} ${esc(hm(H.start))} – ${esc(dm(H.end))} ${esc(hm(H.end + 36e5))}</div>${d}</div>`;
    const prevCol = { k: 'prev', l: 'Previous 24 h', r: 1, f: r => r.prev == null ? '—' : fmtN(r.prev) };
    const qCols = [C.q, C.clicks, C.impr, C.ctr, C.pos].concat(data.exact ? [prevCol] : []);
    const pCols = [C.page, C.clicks, C.impr, C.ctr, C.pos].concat(data.exact ? [prevCol] : []);
    const html = head(title, sub + ` (${esc(tz)}).` + (S.kind === 'demo' ? ' <b>Sample data:</b> generated for the fictional site.' + demoNote : '')) + segAll +
      `<div class="sv-bar"><span class="flat">Latest hour with data: <b>${esc(dm(H.end))}, ${esc(hm(H.end))}</b>${H.incomplete ? ` · hours from ${esc(hm(H.incomplete))} are still filling in` : ''}</span>${S.kind === 'api' ? '<button type="button" class="btn-quiet" id="sv-live-refresh">Refresh</button>' : ''}</div>
      <section class="tiles" aria-label="Last 24 hours totals, ${esc(modeLabel.toLowerCase())}">
        ${T('t-blue', fmtN(L.clicks), mode === 'all' ? 'Clicks' : modeLabel + ' clicks', cmp(L.clicks, P && P.clicks, W && W.clicks))}
        ${T('t-green', fmtN(L.impr), 'Impressions', cmp(L.impr, P && P.impr, W && W.impr))}
        ${T('t-amber', pctf(L.ctr, 2), 'CTR', cmp(L.ctr, P && P.ctr, W && W.ctr, false, 'pt'))}
        ${T('t-red', L.pos ? L.pos.toFixed(1) : '—', 'Avg. position', cmp(L.pos, P && P.pos, W && W.pos, true))}
      </section>
      <section class="panel"><div class="panel-h"><h2>${mode === 'all' ? 'Clicks' : modeLabel + ' clicks'} by hour</h2><p>Bars: the last 24 hours. Lines: the same hours the day before and a week before. ${H.best && H.best.clicks ? `Busiest hour: ${esc(hm(H.best.ts))} (${fmtN(H.best.clicks)} clicks).` : ''}</p></div>
        <div class="panel-b"><div class="chart-box"><canvas id="sv-ch-live" aria-label="Clicks by hour, last 24 hours"></canvas></div></div></section>
      ${approx}
      ${newQ.length ? `<section class="panel"><div class="panel-h"><h2>New searches today (${newQ.length})</h2><p>${data.exact ? 'Showed your site in the last 24 hours but not in the 24 hours before.' : 'In today’s data but not in the two days before.'} Early signs of trends, news or a page Google just started ranking.</p></div>
        ${table('t-sv-newq', [C.q, C.impr, C.clicks, C.pos], newQ, { sort: 'impr', file: 'new-searches-24h', pageSize: 15 })}</section>` : ''}
      <section class="panel"><div class="panel-h"><h2>Top queries</h2></div>${table('t-sv-liveq', qCols, topQ, { sort: 'clicks', file: 'queries-24h', pageSize: 15 })}</section>
      <section class="panel"><div class="panel-h"><h2>Top pages</h2></div>${table('t-sv-livep', pCols, topP, { sort: 'clicks', file: 'pages-24h', pageSize: 15, searchKeys: ['path'] })}</section>
      <p class="flat">Hourly numbers are provisional and can still change; Search Console keeps hourly data for about 10 days.${S.gsc && S.gsc.type !== 'web' ? ` Search type: ${esc(S.gsc.type)}.` : ''}</p>`;
    const mount = () => {
      ['t-sv-newq', 't-sv-liveq', 't-sv-livep'].forEach(drawTable);
      liveSeg(D);
      chart('sv-ch-live', { data: { labels: H.last.map(r => hm(r.ts)), datasets: [
        { type: 'bar', label: 'Last 24 hours', data: H.last.map(r => r.clicks), backgroundColor: H.last.map(r => H.incomplete && r.ts >= H.incomplete ? cssVar('--signal-soft') : cssVar('--signal')), borderRadius: 4, order: 2 },
        { type: 'line', label: 'Day before', data: H.prev.map(r => r.clicks), borderColor: cssVar('--watch'), pointRadius: 0, borderWidth: 2, tension: .3, order: 1 },
        { type: 'line', label: 'Week before', data: H.week.map(r => r.clicks), borderColor: cssVar('--muted'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, tension: .3, order: 1 }
      ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { ticks: { precision: 0, callback: v => fmtN(v) } } } } });
      const b = document.getElementById('sv-live-refresh');
      if (b) b.addEventListener('click', () => { LIVE_TICK.set(D.site, (LIVE_TICK.get(D.site) || 0) + 1); rerender('live'); });
    };
    return { html, mount };
  };
  const LIVE_TICK = new Map();
  function liveSeg(D) {
    const go = ch => { const p = new URLSearchParams((location.hash.split('?')[1]) || ''); Object.entries(ch).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k)); location.hash = '#live' + (p.toString() ? '?' + p.toString() : ''); };
    const f = document.getElementById('sv-pagef');
    if (f) f.addEventListener('submit', e => { e.preventDefault(); go({ page: String(new FormData(f).get('page') || '').trim().slice(0, 200) }); });
    const x = document.getElementById('sv-pagef-x'); if (x) x.addEventListener('click', () => go({ page: '' }));
    document.querySelectorAll('[data-live-brand]').forEach(b => b.addEventListener('click', () => {
      try { localStorage.setItem('cw:live-brand', b.dataset.liveBrand); } catch (e) { }
      go({ brand: b.dataset.liveBrand });
    }));
    const e = document.getElementById('sv-brand-edit'); if (e) e.addEventListener('click', () => document.getElementById('btn-settings').click());
  }

  // ── Indexing ──
  function sitemapState(D) {
    const S = src();
    if (S.kind === 'demo') return { status: 'done', data: SURF.sitemaps(SURF.demoSitemaps()) };
    if (S.kind !== 'api') return null;
    return load(['api', D.siteUrl || D.site, 'sitemaps'].join('|'), 'indexing', () => S.gsc.sitemaps().then(d => SURF.sitemaps(d.sitemap || [])));
  }
  async function runInspect(D, urls) {
    const S = src(), site = D.site;
    const run = { running: true, stop: false, done: 0, total: urls.length, results: [], errors: [], at: new Date() };
    RUNS.set(site, run); rerender('indexing');
    const tick = () => { const el = document.getElementById('sv-insp-prog'); if (el) el.textContent = `Inspected ${run.done} of ${run.total}…${run.errors.length ? ` ${run.errors.length} failed.` : ''}`; const bar = document.getElementById('sv-insp-bar'); if (bar) bar.style.width = (run.done / Math.max(1, run.total) * 100).toFixed(1) + '%'; };
    if (S.kind === 'demo') {
      for (const x of SURF.demoInspections(D, urls)) { if (run.stop) break; await new Promise(r => setTimeout(r, 15)); run.results.push(SURF.inspection(x.url, x.result)); run.done++; tick(); }
    } else {
      // three at a time keeps well inside the 600-per-minute limit; a quota error stops the run
      let i = 0;
      const worker = async () => {
        while (i < urls.length && !run.stop) {
          const u = urls[i++];
          try { const d = await S.gsc.inspect(u); run.results.push(SURF.inspection(u, d.inspectionResult)); }
          catch (e) { run.errors.push({ url: u, err: e.message }); if (/usage limit|quota|session/i.test(e.message)) run.stop = true; }
          run.done++; tick();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
    run.running = false; rerender('indexing');
  }
  V.indexing = (A, D) => {
    const S = src(), title = 'Indexing', sub = 'Which pages Google has indexed, which it left out and why, and whether your sitemaps are being read.';
    const perf = new Map((A.P || []).map(r => [String(r.p).replace(/\/$/, ''), r]));
    const ex = S.kind === 'demo' ? (UPLOADS.get(D.site + '|index') || SURF.demoIndexExport(D)) : UPLOADS.get(D.site + '|index');
    const sm = sitemapState(D);
    const run = RUNS.get(D.site);
    const sum = run && run.results.length ? SURF.inspectionSummary(run.results) : null;
    const exNot = ex && ex.issues.length ? ex.issues.reduce((s, r) => s + r.pages, 0) : null;
    const smErr = sm && sm.status === 'done' ? sm.data.filter(s => s.errors).length : null;

    const strip = `<div class="aitiles sv-idx-tiles">
      <div class="aitile ${ex && ex.latest && ex.latest.indexed != null ? 'a-green' : ''}"><span>Indexed pages</span><b>${ex && ex.latest && ex.latest.indexed != null ? fmtN(ex.latest.indexed) : '—'}</b><small>${ex && ex.latest ? 'from the Page indexing export, ' + esc(ex.latest.d) : 'add the Page indexing export'}</small></div>
      <div class="aitile ${exNot ? 'a-amber' : ''}"><span>Not indexed</span><b>${ex && ex.latest && ex.latest.notIndexed != null ? fmtN(ex.latest.notIndexed) : exNot != null ? fmtN(exNot) : '—'}</b><small>${ex && ex.issues.length ? ex.issues.length + ' reasons' : 'by reason, from the export'}</small></div>
      <div class="aitile ${sum ? (sum.indexed / sum.n >= 0.9 ? 'a-green' : 'a-red') : ''}"><span>Inspected, indexed</span><b>${sum ? `${sum.indexed}/${sum.n}` : '—'}</b><small>${sum ? 'pages from URL inspection' : 'run URL inspection below'}</small></div>
      <div class="aitile ${smErr ? 'a-red' : smErr === 0 ? 'a-green' : ''}"><span>Sitemaps</span><b>${sm && sm.status === 'done' ? sm.data.length : '—'}</b><small>${smErr ? smErr + ' with errors' : smErr === 0 ? 'no errors' : S.kind === 'file' ? 'needs Search Console sign-in' : 'loading…'}</small></div>
      <div class="aitile ${sum && sum.richErrors.length ? 'a-red' : ''}"><span>Rich result errors</span><b>${sum ? sum.richErrors.length : '—'}</b><small>${sum ? 'inspected pages with structured-data errors' : 'from URL inspection'}</small></div>
    </div>`;

    // 1. Page indexing export
    let exHtml;
    if (ex) {
      const urls = ex.urls.length ? SURF.joinPerf(ex.urls, A.P) : [];
      const seen = urls.filter(u => u.impr > 0);
      exHtml = `<section class="panel"><div class="panel-h"><h2>Why pages are not indexed</h2>${S.kind !== 'demo' ? `<button type="button" class="btn-link" data-sv-clear="index">Use a different file</button>` : ''}<p>${S.kind === 'demo' ? '<b>Sample data:</b> a generated Page indexing export. ' : ''}From Search Console’s Page indexing report. Red reasons usually need a fix; grey ones are often expected.</p></div>
        ${ex.issues.length ? table('t-sv-reasons', [
          { k: 'reason', l: 'Reason', f: r => `<b>${esc(r.reason)}</b><br><small class="flat">${esc(r.fix)}</small>` },
          { k: 'pages', l: 'Pages', r: 1, f: r => fmtN(r.pages) },
          { k: 'source', l: 'Source', f: r => esc(r.source || '—') },
          { k: 'validation', l: 'Validation', f: r => esc(r.validation || '—') },
          { k: 'tone', l: 'Priority', f: r => `<span class="tag ${tone2tag(r.tone)}">${r.tone === 'risk' ? 'Fix' : r.tone === 'watch' ? 'Review' : 'Usually fine'}</span>`, csv: r => r.tone }
        ], ex.issues, { sort: 'pages', file: 'page-indexing-reasons', search: false }) : ''}
        ${ex.chart.length && ex.chart.some(r => r.indexed != null || r.notIndexed != null) ? `<div class="panel-b"><div class="chart-box sm"><canvas id="sv-ch-idx" aria-label="Indexed and not indexed pages over time"></canvas></div></div>` : ''}
        ${urls.length ? `<div class="panel-b"><h3 class="sv-h3">${esc(ex.issue || 'Affected URLs')} · ${urls.length.toLocaleString()} examples${ex.issueFix ? `</h3><p class="flat">${esc(ex.issueFix)}</p>` : '</h3>'}
          ${seen.length ? `<p class="note warn"><b>${seen.length} of these still had Search impressions</b> in the analysed period. Check those first: Google may be dropping pages that used to rank.</p>` : ''}</div>
          ${table('t-sv-exurls', [C.page, { k: 'lastCrawled', l: 'Last crawled', f: r => esc(r.lastCrawled || '—') }, C.impr, C.clicks], urls, { sort: 'impr', file: 'affected-urls', searchKeys: ['path'], pageSize: 25 })}` : ''}
        <div class="panel-b"><label class="btn-quiet sv-add" for="sv-file-index">Add another export (for example a reason’s URL list)<input type="file" id="sv-file-index" accept=".xlsx,.xls,.csv" multiple hidden></label><p class="sf-err" id="sv-err-index" role="alert"></p></div>
      </section>`;
    } else {
      exHtml = `<section class="panel"><div class="panel-h"><h2>Why pages are not indexed</h2><p>The full Page indexing report is not available through Google’s API, so add its export. Every reason gets a priority and a fix; a reason’s URL list is matched against your Search traffic.</p></div>
        <div class="panel-b">${dropZone('sv-file-index', 'Drop the Page indexing export here', 'In Search Console open <b>Indexing › Pages › Export › Download Excel</b>. For URLs, click a reason and export that page too.')}<p class="sf-err" id="sv-err-index" role="alert"></p></div></section>`;
    }

    // 2. URL inspection
    let inHtml;
    if (S.kind === 'file') inHtml = `<section class="panel"><div class="panel-h"><h2>Inspect URLs</h2></div><p class="empty">URL inspection asks Google about each page live, so it needs Search Console sign-in. Click <b>New analysis</b> and connect with Google.</p></section>`;
    else {
      const opts = [['top', 'Top pages by clicks'], ['decay', `Pages losing clicks${A.decay ? ` (${A.decay.pages.length})` : ''}`], ['zero', `Page-one pages with almost no clicks (${(A.ai && A.ai.zeroPages || []).length})`], ['tail', 'Pages with the fewest impressions'], ['paste', 'URLs I paste']];
      const busy = run && run.running;
      const groups = sum ? sum.groups : [];
      const all = run ? run.results.map(r => { const p = perf.get(r.url.replace(/\/$/, '')); return { ...r, p: r.url, clicks: p ? p.clicks : 0, impr: p ? p.impr : 0 }; }) : [];
      const cols = [C.page,
        { k: 'label', l: 'Status', f: r => `<span class="tag ${tone2tag(r.tone)}">${esc(r.label)}</span>${r.coverage && r.coverage !== r.label ? `<br><small class="flat">${esc(r.coverage)}</small>` : ''}` },
        { k: 'age', l: 'Last crawl', r: 1, f: r => esc(ago(r.age)), csv: r => r.lastCrawl || '' },
        { k: 'crawledAs', l: 'Crawled as', f: r => esc(r.crawledAs ? r.crawledAs.charAt(0) + r.crawledAs.slice(1).toLowerCase() : '—') },
        { k: 'canonDiff', l: 'Google’s canonical', cls: 'u', f: r => r.canonDiff ? `<span class="lossv">${urlCell(r.googleCanonical, SURF.pathOf(r.googleCanonical))}</span>` : r.googleCanonical ? 'Same' : '—', csv: r => r.googleCanonical },
        { k: 'rich', l: 'Rich results', f: r => r.rich.length ? `${esc(r.rich.join(', '))}${r.richErrors.length ? `<br><span class="lossv">${r.richErrors.length} error${r.richErrors.length === 1 ? '' : 's'}: ${esc(r.richErrors[0].msg)}</span>` : ''}` : '—', csv: r => r.rich.join('; ') + (r.richErrors.length ? ' | errors: ' + r.richErrors.map(e => e.msg).join('; ') : '') },
        C.impr,
        { k: 'link', l: '', sort: false, csv: false, f: r => r.link ? `<a class="btn-quiet" href="${esc(r.link)}" target="_blank" rel="noopener">Open in Search Console</a>` : '' }];
      inHtml = `<section class="panel"><div class="panel-h"><h2>Inspect URLs</h2><p>Asks Google about each page through the URL Inspection API: index status, last crawl, the canonical Google chose and rich-result errors. Google allows 2,000 inspections a day per property.</p></div>
        <form class="panel-b sv-insp" id="sv-insp" autocomplete="off">
          <label class="field"><span>Which pages</span><select id="sv-insp-src">${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>How many</span><select id="sv-insp-n"><option>25</option><option selected>100</option><option>250</option><option>500</option></select></label>
          <label class="field sv-paste" hidden><span>URLs (one per line)</span><textarea id="sv-insp-urls" rows="4" placeholder="https://${esc(D.site)}/page"></textarea></label>
          <div class="sv-insp-go">${busy ? '<button type="button" class="btn-quiet" id="sv-insp-stop">Stop</button>' : `<button class="btn-primary" type="submit">${run ? 'Inspect again' : 'Inspect pages'}</button>`}</div>
          <p class="sf-err" id="sv-insp-err" role="alert"></p>
        </form>
        ${run ? `<div class="panel-b"><div class="sv-prog"><span id="sv-insp-bar" style="width:${(run.done / Math.max(1, run.total) * 100).toFixed(1)}%"></span></div><p class="flat" id="sv-insp-prog">${busy ? `Inspected ${run.done} of ${run.total}…` : `Inspected ${run.results.length} page${run.results.length === 1 ? '' : 's'} at ${esc(run.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${run.errors.length ? `. ${run.errors.length} could not be inspected: ${esc(run.errors[0].err)}` : '.'}${S.kind === 'demo' ? ' <b>Sample data:</b> generated results.' : ''}`}</p></div>` : ''}
        ${!busy && groups.length ? `<div class="stack">${groups.map((g, i) => `<details class="acc" ${i === 0 && g.tone !== 'good' ? 'open' : ''}>
            ${accHead(g.tone === 'good' ? 'check' : g.tone === 'info' ? 'file' : 'alert', g.tone === 'good' ? 'green' : g.tone === 'risk' ? 'red' : g.tone === 'watch' ? 'amber' : 'indigo', g.label, g.fix, g.rows.length + (g.rows.length === 1 ? ' page' : ' pages'), g.tone === 'good' ? 'green' : g.tone === 'risk' ? 'red' : g.tone === 'watch' ? 'amber' : 'indigo')}
            <div class="sv-urls">${g.rows.slice(0, 50).map(r => `<div>${urlCell(r.url, r.path)}<span class="flat">${esc(r.key === 'stale' || r.key === 'ok' ? 'crawled ' + ago(r.age) : r.coverage || r.label)}</span></div>`).join('')}${g.rows.length > 50 ? `<p class="flat">and ${g.rows.length - 50} more in the table below.</p>` : ''}</div>
          </details>`).join('')}</div>
          ${sum.notInSitemap.length ? `<div class="note warn"><b>${sum.notInSitemap.length} not-indexed page${sum.notInSitemap.length === 1 ? ' is' : 's are'} in no sitemap Google knows about.</b> Add the ones that should rank.</div>` : ''}
          <div class="panel-b flush">${table('t-sv-insp', cols, all, { sort: 'impr', file: 'url-inspection', searchKeys: ['path', 'label'], filters: [{ key: 'tone', label: 'Status', options: [['risk', 'Needs a fix'], ['watch', 'Review'], ['good', 'Indexed'], ['info', 'Usually fine']], test: (r, v) => r.tone === v }] })}</div>` : ''}
      </section>`;
    }

    // 3. Sitemaps
    let smHtml;
    if (!sm) smHtml = `<section class="panel"><div class="panel-h"><h2>Sitemaps</h2></div><p class="empty">Connect Search Console to check your sitemaps: when Google last read them, how many URLs they list and any errors.</p></section>`;
    else if (sm.status === 'loading') smHtml = `<section class="panel"><div class="panel-h"><h2>Sitemaps</h2></div><p class="empty">Loading sitemaps…</p></section>`;
    else if (sm.status === 'error') smHtml = `<section class="panel"><div class="panel-h"><h2>Sitemaps</h2></div><p class="empty">Could not load sitemaps: ${esc(sm.err)}</p></section>`;
    else smHtml = `<section class="panel"><div class="panel-h"><h2>Sitemaps (${sm.data.length})</h2><p>As submitted in Search Console. Google no longer reports how many sitemap URLs are indexed, so pair this with the Page indexing export above (filter it by sitemap).</p></div>
      ${sm.data.length ? table('t-sv-sm', [
        { k: 'path', l: 'Sitemap', cls: 'u', f: r => `${urlCell(r.path, SURF.pathOf(r.path))}${r.index ? ' <span class="tag">index</span>' : ''}` },
        { k: 'submitted', l: 'URLs listed', r: 1, f: r => fmtN(r.submitted) },
        { k: 'types', l: 'Contains', f: r => esc(r.types.join(', ') || '—'), csv: r => r.types.join('; ') },
        { k: 'age', l: 'Last read by Google', r: 1, f: r => esc(r.pending ? 'pending' : ago(r.age)), csv: r => r.lastRead || '' },
        { k: 'errors', l: 'Status', f: r => r.flags.length ? r.flags.map(f => `<span class="tag ${tone2tag(f.tone)}">${esc(f.text)}</span>`).join(' ') : '<span class="tag gain">OK</span>', csv: r => r.flags.map(f => f.text).join('; ') || 'OK' }
      ], sm.data, { sort: 'errors', file: 'sitemaps', search: false }) : '<p class="empty">No sitemaps submitted for this property. Submit one in Search Console › Sitemaps.</p>'}</section>`;

    const html = head(title, sub) + strip + inHtml + exHtml + smHtml;
    const mount = () => {
      ['t-sv-reasons', 't-sv-exurls', 't-sv-insp', 't-sv-sm'].forEach(drawTable);
      if (ex && document.getElementById('sv-ch-idx')) {
        const r = ex.chart;
        chart('sv-ch-idx', { type: 'line', data: { labels: r.map(x => x.d.slice(5)), datasets: [
          { label: 'Indexed', data: r.map(x => x.indexed), borderColor: cssVar('--good'), pointRadius: 0, borderWidth: 2, tension: .2 },
          { label: 'Not indexed', data: r.map(x => x.notIndexed), borderColor: cssVar('--risk'), pointRadius: 0, borderWidth: 2, tension: .2 }
        ].filter(ds => ds.data.some(v => v != null)) }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: v => fmtN(v) } } } } });
      }
      // a second export (e.g. one reason's URLs) is merged into the first
      const inp = document.getElementById('sv-file-index'), err = document.getElementById('sv-err-index');
      if (inp) inp.addEventListener('change', async () => {
        try {
          const r = SURF.indexExport(await sheetsOf([...inp.files]));
          if (!r.ok) throw new Error('No reasons, chart or URL list found. Export it from Indexing › Pages (or a reason’s detail page) › Export › Download Excel.');
          const prev = UPLOADS.get(D.site + '|index') || null;
          UPLOADS.set(D.site + '|index', prev ? { ...prev, issues: r.issues.length ? r.issues : prev.issues, chart: r.issues.length || !prev.chart.length ? r.chart : prev.chart, urls: r.urls.length ? r.urls : prev.urls, issue: r.urls.length ? r.issue : prev.issue, issueFix: r.urls.length ? r.issueFix : prev.issueFix, latest: r.issues.length ? r.latest : prev.latest } : r);
          rerender('indexing');
        } catch (e) { if (err) err.textContent = e.message; }
      });
      const form = document.getElementById('sv-insp');
      if (form) {
        const srcSel = document.getElementById('sv-insp-src'), paste = form.querySelector('.sv-paste');
        srcSel.addEventListener('change', () => { paste.hidden = srcSel.value !== 'paste'; });
        form.addEventListener('submit', e => {
          e.preventDefault();
          const n = +document.getElementById('sv-insp-n').value, e2 = document.getElementById('sv-insp-err');
          let urls;
          if (srcSel.value === 'paste') {
            const p = SURF.parseUrls(document.getElementById('sv-insp-urls').value, D.site);
            if (p.bad.length) { e2.textContent = `Skipped ${p.bad.length} line${p.bad.length === 1 ? '' : 's'} that are not full addresses on ${D.site}: ${p.bad.slice(0, 3).join(', ')}`; }
            urls = p.ok.slice(0, n);
          } else urls = SURF.inspectList(A, srcSel.value, n);
          if (!urls.length) { e2.textContent = e2.textContent || 'No pages to inspect in that list.'; return; }
          runInspect(D, urls);
        });
        const stop = document.getElementById('sv-insp-stop'); if (stop) stop.addEventListener('click', () => { const r = RUNS.get(D.site); if (r) r.stop = true; stop.disabled = true; });
      }
    };
    return { html, mount };
  };

  V.discover = (A, D) => surfaceView(A, D, 'discover');
  V.news = (A, D) => surfaceView(A, D, 'news');

  document.addEventListener('click', e => {
    const r = e.target.closest('[data-sv-retry]');
    if (r) { [...CACHE.keys()].forEach(k => { if (CACHE.get(k).status === 'error') CACHE.delete(k); }); rerender(r.dataset.svRetry); return; }
    const c = e.target.closest('[data-sv-clear]');
    if (c && window.CW_SOURCE) { UPLOADS.delete(window.CW_SOURCE.site + '|' + c.dataset.svClear); rerender(c.dataset.svClear === 'index' ? 'indexing' : c.dataset.svClear); }
  });
  window.CW_SURFVIEW = { CACHE, UPLOADS, RUNS, folderRegex };
})();

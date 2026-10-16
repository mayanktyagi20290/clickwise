// Clickwise app — data loading, onboarding, routing.
(function () {
  'use strict';
  const CFG = window.CW_CONFIG;
  const { V, destroyCharts, esc } = window.CW_VIEWS;
  const $ = id => document.getElementById(id);
  const screens = ['start', 'picker', 'setup', 'app'];
  function show(id) { screens.forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); }

  let D = null, S = null, A = null;

  // ── settings (per site, in this browser) ──
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); } catch (e) { } }
  };

  // ── start screen ──
  function startError(msg) { const e = $('start-error'); e.textContent = msg; e.hidden = !msg; }
  $('btn-demo').addEventListener('click', () => { loaded(window.CW_DEMO.build()); });

  const dz = $('dropzone'), fi = $('file-input');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]); });
  fi.addEventListener('change', e => { if (e.target.files.length) readFiles([...e.target.files]); });

  // ── file import (Search Console Performance export) ──
  function num(v) {
    if (typeof v === 'number') return v;
    const s = String(v || '').replace(/,/g, '').trim();
    return parseFloat(s) || 0;
  }
  function ctrVal(v) {
    if (typeof v === 'number') return v <= 1 ? v * 100 : v;
    const s = String(v || '').trim();
    return s.endsWith('%') ? parseFloat(s) || 0 : (parseFloat(s) || 0) <= 1 ? (parseFloat(s) || 0) * 100 : parseFloat(s) || 0;
  }
  // Accepts the Excel download, or the CSV files from Search Console's CSV download (unzipped,
  // selected together). Sheets are recognised by sheet or file name and their header row.
  const MAX_BYTES = 50 * 1024 * 1024;
  const KIND_LABEL = { Q: 'Queries', P: 'Pages', C: 'Dates', Dev: 'Devices', Countries: 'Countries', Appearance: 'Search appearance' };
  function kindOf(name, header) {
    const n = name.toLowerCase(), h = String(header || '').toLowerCase();
    const has = w => n.includes(w) || h.includes(w);
    return has('quer') ? 'Q' : has('appearance') ? 'Appearance' : has('page') ? 'P' : has('countr') ? 'Countries' : has('date') || n.includes('chart') ? 'C' : has('device') ? 'Dev' : null;
  }
  const readBuffer = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(new Uint8Array(e.target.result)); r.onerror = () => rej(new Error('read failed')); r.readAsArrayBuffer(file); });
  async function readFiles(files) {
    startError('');
    if (!window.XLSX) { startError('The spreadsheet reader is still loading. Try again in a moment.'); return; }
    const zip = files.find(f => /\.zip$/i.test(f.name));
    if (zip) { startError('That is Search Console\'s CSV download, which comes as a .zip. Unzip it and select the CSV files together, or use Export › Download Excel instead.'); return; }
    const big = files.find(f => f.size > MAX_BYTES);
    if (big) { startError(`“${big.name}” is larger than 50 MB. Search Console exports are much smaller; check that this is the Performance export.`); return; }
    const out = { Q: [], P: [], C: [], Dev: [], Countries: [], Appearance: [] };
    const found = new Set(), unread = [];
    for (const file of files) {
      let wb;
      // raw: CSV cells stay text, so a query such as "=total" is not turned into a formula and lost
      try { wb = XLSX.read(await readBuffer(file), { type: 'array', raw: true }); } catch (e) { unread.push(file.name); continue; }
      if (!wb || !wb.SheetNames || !wb.SheetNames.length) { unread.push(file.name); continue; }
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }).filter(r => r.some(c => c !== ''));
        if (rows.length < 2) return;
        // a CSV has one sheet named "Sheet1": use the file name instead
        const kind = kindOf(wb.SheetNames.length === 1 ? file.name + ' ' + name : name, rows[0][0]);
        if (!kind || found.has(kind)) return;
        found.add(kind);
        rows.slice(1).forEach(r => {
          if (r[0] === '' || r[0] == null) return;
          const row = { clicks: num(r[1]), impr: num(r[2]), ctr: ctrVal(r[3]), pos: num(r[4]) };
          if (kind === 'Q') out.Q.push({ q: String(r[0]), ...row });
          else if (kind === 'P') out.P.push({ p: String(r[0]), ...row });
          else if (kind === 'C') out.C.push({ d: typeof r[0] === 'number' ? excelDate(r[0]) : String(r[0]).slice(0, 10), ...row });
          else if (kind === 'Dev') out.Dev.push({ d: String(r[0]).toUpperCase(), ...row });
          else out[kind].push({ d: String(r[0]), ...row });
        });
      });
    }
    if (!out.Q.length && !out.P.length) {
      startError(unread.length && !found.size ? `Couldn't read ${unread.map(n => '“' + n + '”').join(', ')} as a spreadsheet. Upload the file from Search Console › Performance › Export › Download Excel.`
        : found.size ? `Found ${[...found].map(k => KIND_LABEL[k]).join(', ')}, but no Queries or Pages. Export from Search Console › Performance with the Queries and Pages tabs included.`
        : 'That file has no Queries or Pages sheet. Export it from Search Console › Performance › Export › Download Excel.');
      return;
    }
    out.C = out.C.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d)).sort((a, b) => a.d.localeCompare(b.d));
    const first = files[0];
    const host = (out.P[0] && hostOf(out.P[0].p)) || (first.name.match(/([a-z0-9-]+\.[a-z.]{2,})/i) || [])[1] || 'Your site';
    loaded({ ...out, site: host, source: 'file', start: out.C[0] && out.C[0].d, end: out.C.length ? out.C[out.C.length - 1].d : null, days: out.C.length || null });
  }
  function excelDate(n) { const d = new Date(Math.round((n - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; } }

  // ── Google sign-in (Google Identity Services token flow) ──
  let token = null, tokenClient = null, tokenExpires = 0;
  $('btn-connect').addEventListener('click', () => {
    startError('');
    if (!CFG.googleClientId || CFG.googleClientId.startsWith('YOUR_')) { startError('Google sign-in is not configured yet. Add your OAuth client ID in config.js. Meanwhile, upload an export or try the sample data.'); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) { startError('Google sign-in did not load. Check your connection or ad blocker, then try again.'); return; }
    tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
      client_id: CFG.googleClientId,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      callback: r => { if (r.error) { startError('Sign-in was not completed: ' + r.error); return; } token = r.access_token; tokenExpires = Date.now() + (+r.expires_in || 3600) * 1000; openPicker(); },
      error_callback: e => startError(e && e.type === 'popup_closed' ? 'The sign-in window was closed before finishing.' : 'Sign-in failed. Allow pop-ups for this site and try again.')
    });
    tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
  });

  // Search Console reads are safe to repeat, so busy (429) and server (5xx) errors and dropped
  // connections are retried up to 3 times with growing waits, honouring Retry-After.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function api(path, body, attempt = 0) {
    if (tokenExpires && Date.now() > tokenExpires - 30000) throw new Error('Your Google session has expired (sessions last about an hour). Go back and connect again.');
    let res;
    try {
      res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/' + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (attempt < 3) { await sleep(1000 * 2 ** attempt); return api(path, body, attempt + 1); }
      throw new Error('Could not reach Search Console. Check your connection and try again.');
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = (+res.headers.get('Retry-After') || 2 ** attempt) * 1000 + Math.round(Math.random() * 400);
      progress(`Search Console is busy, retrying in ${Math.round(wait / 1000)} s…`);
      await sleep(wait); return api(path, body, attempt + 1);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Your Google session expired. Go back and connect again.');
    if (res.status === 403) throw new Error('This Google account cannot read that property. Ask an owner to add you in Search Console › Settings › Users.');
    if (res.status === 429) throw new Error('Search Console\'s usage limit was reached. Wait a few minutes and try again.');
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Search Console returned an error (' + res.status + ').');
    return data;
  }
  let FILTER = { type: 'web', device: '' };
  async function pull(site, start, end, dims, max, label) {
    const out = [];
    for (let startRow = 0; startRow < max; startRow += 25000) {
      progress(`Fetching ${label}… ${out.length.toLocaleString()} rows`);
      const body = { startDate: start, endDate: end, dimensions: dims, type: FILTER.type, rowLimit: Math.min(25000, max - startRow), startRow };
      if (FILTER.device && !dims.includes('device')) body.dimensionFilterGroups = [{ filters: [{ dimension: 'device', operator: 'equals', expression: FILTER.device }] }];
      const d = await api(`sites/${encodeURIComponent(site)}/searchAnalytics/query`, body);
      const rows = d.rows || [];
      out.push(...rows);
      if (rows.length < 25000) break;
    }
    return out;
  }
  const mapRow = (r, keys) => { const o = { clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position }; keys.forEach((k, i) => o[k] = r.keys[i]); return o; };
  function progress(t) { $('pick-progress').textContent = t; }

  const iso = d => d.toISOString().slice(0, 10);
  function setRange(days) {
    const end = new Date(); end.setDate(end.getDate() - 2);
    const start = new Date(end); start.setDate(end.getDate() - days + 1);
    $('pick-start').value = iso(start); $('pick-end').value = iso(end);
    document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', +b.dataset.days === days));
  }
  $('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRange(+b.dataset.days); });
  $('pick-back').addEventListener('click', () => show('start'));

  async function openPicker() {
    show('picker'); setRange(90); $('pick-error').hidden = true; progress('');
    const sel = $('pick-site');
    sel.innerHTML = '<option>Loading your properties…</option>';
    try {
      const d = await api('sites');
      const sites = (d.siteEntry || []).filter(s => s.permissionLevel !== 'siteUnverifiedUser').sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
      if (!sites.length) throw new Error('This Google account has no verified Search Console properties. Sign in with the account that owns the property.');
      sel.innerHTML = sites.map(s => `<option value="${esc(s.siteUrl)}">${esc(s.siteUrl.replace(/^sc-domain:/, '') + (s.siteUrl.startsWith('sc-domain:') ? ' (domain)' : ''))}</option>`).join('');
    } catch (err) { $('pick-error').textContent = err.message; $('pick-error').hidden = false; }
  }

  $('picker-form').addEventListener('submit', async e => {
    e.preventDefault();
    const site = $('pick-site').value, start = $('pick-start').value, end = $('pick-end').value, compare = $('pick-compare').checked;
    FILTER = { type: $('pick-type').value, device: $('pick-device').value };
    if (!site || !start || !end || start > end) { $('pick-error').textContent = 'Choose a property and a valid date range.'; $('pick-error').hidden = false; return; }
    $('pick-error').hidden = true; $('pick-go').disabled = true;
    try {
      const days = Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
      const pe = new Date(start); pe.setDate(pe.getDate() - 1);
      const ps = new Date(pe); ps.setDate(pe.getDate() - days + 1);
      const [q, p, c, dev, qp] = [
        await pull(site, start, end, ['query'], CFG.maxRows, 'queries'),
        await pull(site, start, end, ['page'], CFG.maxRows, 'pages'),
        await pull(site, start, end, ['date'], 1000, 'daily totals'),
        await pull(site, start, end, ['device'], 10, 'devices'),
        await pull(site, start, end, ['query', 'page'], CFG.maxQueryPageRows, 'query and page pairs')
      ];
      let prevQ = null, prevP = null;
      if (compare) {
        prevQ = (await pull(site, iso(ps), iso(pe), ['query'], CFG.maxRows, 'previous-period queries')).map(r => mapRow(r, ['q']));
        prevP = (await pull(site, iso(ps), iso(pe), ['page'], CFG.maxRows, 'previous-period pages')).map(r => mapRow(r, ['p']));
      }
      if (!q.length && !p.length) throw new Error('Search Console has no data for this property in that range.');
      progress('Analysing…');
      loaded({
        site: site.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, ''), siteUrl: site, source: 'api', start, end, days, filters: { ...FILTER },
        prevStart: compare ? iso(ps) : null, prevEnd: compare ? iso(pe) : null,
        Q: q.map(r => mapRow(r, ['q'])), P: p.map(r => mapRow(r, ['p'])), C: c.map(r => mapRow(r, ['d'])).sort((a, b) => a.d.localeCompare(b.d)),
        Dev: dev.map(r => mapRow(r, ['d'])), QP: qp.map(r => mapRow(r, ['q', 'p'])), prevQ, prevP
      });
    } catch (err) { $('pick-error').textContent = err.message; $('pick-error').hidden = false; progress(''); }
    finally { $('pick-go').disabled = false; }
  });

  // ── after data is loaded ──
  function loaded(data) {
    D = data;
    if (D.source === 'demo') { D.prevStart = shift(D.start, -90); D.prevEnd = shift(D.start, -1); }
    const saved = store.get('site:' + D.site);
    if (saved && saved.brand) { S = saved; launch(); return; }
    const g = window.CW.brandGuess(D.siteUrl || D.site, D.Q);
    $('brand-terms').value = g.terms.join(', ');
    $('brand-suggest').innerHTML = g.suggestions.length ? '<span class="progress" style="align-self:center">Add:</span>' + g.suggestions.map(s => `<button type="button" data-add="${esc(s)}">${esc(s)}</button>`).join('') : '';
    show('setup');
    $('brand-terms').focus();
  }
  function shift(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return iso(x); }
  $('brand-suggest').addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const t = $('brand-terms'); t.value = (t.value.trim() ? t.value.trim().replace(/,\s*$/, '') + ', ' : '') + b.dataset.add; b.remove();
  });
  $('setup-form').addEventListener('submit', e => {
    e.preventDefault();
    S = { brand: splitTerms($('brand-terms').value), exclude: CFG.defaultExcludes.slice() };
    store.set('site:' + D.site, S);
    launch();
  });
  const splitTerms = v => v.split(',').map(s => s.trim()).filter(Boolean);

  const analyse = () => window.CW.analyse(D, { ...S, utilityHints: CFG.utilityHints });
  function launch() {
    A = analyse();
    $('top-site').textContent = D.site + (D.source === 'demo' ? ' (sample)' : '');
    $('top-range').textContent = D.start && D.end ? `${fmtDate(D.start)} – ${fmtDate(D.end)}` : 'Date range not in export';
    const f = D.filters || {}; const ft = [f.type && f.type !== 'web' ? f.type.charAt(0).toUpperCase() + f.type.slice(1) + ' search' : '', f.device ? f.device.charAt(0) + f.device.slice(1).toLowerCase() + ' only' : ''].filter(Boolean).join(' · ');
    $('top-filters').textContent = ft; $('top-filters').hidden = !ft;
    $('top-sample').hidden = D.source !== 'demo';
    counts();
    show('app');
    if (!knownRoute(location.hash.slice(1))) history.replaceState(null, '', '#overview');
    route();
  }
  function fmtDate(s) { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function counts() {
    const n = { quickwins: A.quickWins.length, ctr: A.ctrPages.length, cannibal: A.cannibal.filter(c => c.sev !== 'low').length, decay: A.decay ? A.decay.pages.length : null, ai: A.ai.overview.length };
    document.querySelectorAll('.nav a').forEach(a => {
      const v = a.dataset.view; let c = a.querySelector('.count');
      if (n[v] == null) { if (c) c.remove(); return; }
      if (!c) { c = document.createElement('span'); c.className = 'count'; a.appendChild(c); }
      c.textContent = n[v].toLocaleString();
    });
  }

  // ── routing ──
  // routes: #view, #view?params, #section=/folder/, #wf=<workflow id>
  function knownRoute(raw) {
    const base = (raw || '').split('?')[0];
    return !!base && (!!V[base] || base.startsWith('section=') || base.startsWith('wf=') || base === 'regex');
  }
  function route() {
    if (!A) return;
    let raw = location.hash.slice(1) || 'overview';
    // the old regex tool was replaced by Smart filters; keep old links working
    if (raw.split('?')[0] === 'regex') { history.replaceState(null, '', '#filters'); raw = 'filters'; }
    const base = raw.split('?')[0];
    const sec = base.startsWith('section=') ? decodeURIComponent(base.slice(8)) : null;
    const wf = base.startsWith('wf=') ? decodeURIComponent(base.slice(3)) : null;
    const name = sec ? 'sections' : wf ? 'workflows' : base;
    const fn = sec ? (a, d) => V.section(a, d, sec) : wf ? (a, d) => V.wf(a, d, wf) : (V[name] || V.overview);
    destroyCharts();
    const out = fn(A, A.data || D);
    const view = $('view');
    view.innerHTML = out.html;
    if (out.mount) out.mount();
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === name));
    const onLink = document.querySelector('.nav a.on span');
    const h1 = view.querySelector('h1');
    document.title = (sec ? sec + ' — ' : wf && h1 ? h1.textContent + ' — ' : onLink ? onLink.textContent + ' — ' : '') + CFG.appName;
    $('nav').classList.remove('open'); $('menu-btn').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0); view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);

  // ── chrome ──
  $('menu-btn').addEventListener('click', () => { const o = $('nav').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', String(o)); });
  // Print the one-page opportunity report (the browser can save it as PDF).
  $('btn-print').addEventListener('click', () => { if (location.hash !== '#wf=report') { location.hash = '#wf=report'; setTimeout(() => window.print(), 400); } else window.print(); });
  function revoke() { try { if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token, () => { }); } catch (e) { } token = null; tokenExpires = 0; }
  function reset() { A = null; D = null; revoke(); history.replaceState(null, '', location.pathname); fi.value = ''; $('start-info').hidden = true; show('start'); }
  $('btn-new').addEventListener('click', reset);
  // Forget everything stored in this browser for the current site.
  $('set-forget').addEventListener('click', () => {
    if (!D || !confirm(`Forget ${D.site}? This deletes its brand names, ignored searches, page settings and saved workflows from this browser.`)) return;
    try { localStorage.removeItem('cw:site:' + D.site); localStorage.removeItem('cw:saved:' + D.site); } catch (e) { }
    $('settings').close('forget'); reset();
  });
  $('btn-settings').addEventListener('click', () => {
    $('set-brand').value = S.brand.join(', ');
    $('set-ignore').value = (S.ignore || []).join(', ');
    $('set-keep').value = (S.keep || []).join(', ');
    $('set-exclude').value = (S.exclude || []).join(', ');
    $('settings').showModal();
  });
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'save') return;
    S = { ...S, brand: splitTerms($('set-brand').value), exclude: splitTerms($('set-exclude').value), ignore: splitTerms($('set-ignore').value), keep: splitTerms($('set-keep').value) };
    store.set('site:' + D.site, S);
    A = analyse(); counts(); route();
  });

  // events from the automation screens
  document.addEventListener('cw:demo', () => { history.replaceState(null, '', location.pathname + location.hash); loaded(window.CW_DEMO.build()); });
  document.addEventListener('cw:ignore', e => {
    if (!S || !D) return;
    S = { ...S, ignore: (e.detail || []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 50) };
    store.set('site:' + D.site, S);
    A = analyse(); counts();
    history.replaceState(null, '', '#wf=ignore'); route();
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-demo]')) document.dispatchEvent(new CustomEvent('cw:demo'));
    // "Include" on a page set aside as a likely sitelink or utility page
    const k = e.target.closest('[data-keep]');
    if (k && S && D) {
      S = { ...S, keep: [...new Set((S.keep || []).concat(k.dataset.keep))] };
      store.set('site:' + D.site, S); A = analyse(); counts(); route();
    }
  });

  // Data is never stored, so a reload starts over; say so instead of silently resetting.
  if (location.hash.length > 1 && !/[?&]demo\b/.test(location.search)) {
    $('start-info').textContent = 'Clickwise doesn\'t keep your search data, so reloading starts a new analysis. Upload the file again or reconnect — settings for each site are remembered.';
    $('start-info').hidden = false;
  }

  // Deep link straight into the sample: app.html?demo
  // (deferred libraries such as Chart.js are ready by DOMContentLoaded)
  if (/[?&]demo\b/.test(location.search)) document.addEventListener('DOMContentLoaded', () => loaded(window.CW_DEMO.build()));
})();

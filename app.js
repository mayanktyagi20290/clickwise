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
  dz.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });

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
  function readFile(file) {
    startError('');
    if (!window.XLSX) { startError('The spreadsheet reader is still loading. Try again in a moment.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const out = { Q: [], P: [], C: [], Dev: [] };
        wb.SheetNames.forEach(name => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }).filter(r => r.some(c => c !== ''));
          if (rows.length < 2) return;
          const n = name.toLowerCase(), h = String(rows[0][0] || '').toLowerCase();
          const kind = n.includes('quer') || h.includes('quer') ? 'Q' : n.includes('page') || h.includes('page') ? 'P' : n.includes('date') || h.includes('date') ? 'C' : n.includes('device') || h.includes('device') ? 'Dev' : null;
          if (!kind) return;
          rows.slice(1).forEach(r => {
            if (r[0] === '' || r[0] == null) return;
            const row = { clicks: num(r[1]), impr: num(r[2]), ctr: ctrVal(r[3]), pos: num(r[4]) };
            if (kind === 'Q') out.Q.push({ q: String(r[0]), ...row });
            else if (kind === 'P') out.P.push({ p: String(r[0]), ...row });
            else if (kind === 'C') out.C.push({ d: typeof r[0] === 'number' ? excelDate(r[0]) : String(r[0]).slice(0, 10), ...row });
            else out.Dev.push({ d: String(r[0]).toUpperCase(), ...row });
          });
        });
        if (!out.Q.length && !out.P.length) { startError('That file has no Queries or Pages sheet. Export it from Search Console › Performance › Export › Download Excel.'); return; }
        out.C.sort((a, b) => a.d.localeCompare(b.d));
        const host = (out.P[0] && hostOf(out.P[0].p)) || (file.name.match(/([a-z0-9-]+\.[a-z.]{2,})/i) || [])[1] || 'Your site';
        loaded({ ...out, site: host, source: 'file', start: out.C[0] && out.C[0].d, end: out.C.length ? out.C[out.C.length - 1].d : null, days: out.C.length || 90 });
      } catch (err) { startError('Could not read that file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }
  function excelDate(n) { const d = new Date(Math.round((n - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; } }

  // ── Google sign-in (Google Identity Services token flow) ──
  let token = null, tokenClient = null;
  $('btn-connect').addEventListener('click', () => {
    startError('');
    if (!CFG.googleClientId || CFG.googleClientId.startsWith('YOUR_')) { startError('Google sign-in is not configured yet. Add your OAuth client ID in config.js. Meanwhile, upload an export or try the sample data.'); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) { startError('Google sign-in did not load. Check your connection or ad blocker, then try again.'); return; }
    tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
      client_id: CFG.googleClientId,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      callback: r => { if (r.error) { startError('Sign-in was not completed: ' + r.error); return; } token = r.access_token; openPicker(); },
      error_callback: e => startError(e && e.type === 'popup_closed' ? 'The sign-in window was closed before finishing.' : 'Sign-in failed. Allow pop-ups for this site and try again.')
    });
    tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
  });

  async function api(path, body) {
    const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Your Google session expired. Go back and connect again.');
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

  function launch() {
    A = window.CW.analyse(D, S);
    $('top-site').textContent = D.site + (D.source === 'demo' ? ' (sample)' : '');
    $('top-range').textContent = D.start && D.end ? `${fmtDate(D.start)} – ${fmtDate(D.end)}` : 'Date range not in export';
    const f = D.filters || {}; const ft = [f.type && f.type !== 'web' ? f.type.charAt(0).toUpperCase() + f.type.slice(1) + ' search' : '', f.device ? f.device.charAt(0) + f.device.slice(1).toLowerCase() + ' only' : ''].filter(Boolean).join(' · ');
    $('top-filters').textContent = ft; $('top-filters').hidden = !ft;
    counts();
    show('app');
    const h = location.hash.slice(1);
    if (!h || (!V[h] && !h.startsWith('section='))) history.replaceState(null, '', '#overview');
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
  function route() {
    if (!A) return;
    const raw = location.hash.slice(1) || 'overview';
    // folder deep dive: #section=/blog/guides/
    const sec = raw.startsWith('section=') ? decodeURIComponent(raw.slice(8)) : null;
    const name = sec ? 'sections' : raw;
    const fn = sec ? (a, d) => V.section(a, d, sec) : (V[name] || V.overview);
    destroyCharts();
    const out = fn(A, D);
    const view = $('view');
    view.innerHTML = out.html;
    if (out.mount) out.mount();
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === name));
    const onLink = document.querySelector('.nav a.on span');
    document.title = (sec ? sec + ' — ' : onLink ? onLink.textContent + ' — ' : '') + CFG.appName;
    $('nav').classList.remove('open'); $('menu-btn').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0); view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);

  // ── chrome ──
  $('menu-btn').addEventListener('click', () => { const o = $('nav').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', String(o)); });
  $('btn-print').addEventListener('click', () => { if (location.hash !== '#plan') { location.hash = '#plan'; setTimeout(() => window.print(), 300); } else window.print(); });
  $('btn-new').addEventListener('click', () => { A = null; D = null; history.replaceState(null, '', location.pathname); fi.value = ''; show('start'); });
  $('btn-settings').addEventListener('click', () => {
    $('set-brand').value = S.brand.join(', ');
    $('set-exclude').value = (S.exclude || []).join(', ');
    $('settings').showModal();
  });
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'save') return;
    S = { brand: splitTerms($('set-brand').value), exclude: splitTerms($('set-exclude').value) };
    store.set('site:' + D.site, S);
    A = window.CW.analyse(D, S); counts(); route();
  });

  // Deep link straight into the sample: app.html?demo
  // (deferred libraries such as Chart.js are ready by DOMContentLoaded)
  if (/[?&]demo\b/.test(location.search)) document.addEventListener('DOMContentLoaded', () => loaded(window.CW_DEMO.build()));
})();

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

  // ── this tab's session: lets a reload continue where you were ──
  // Kept in sessionStorage, which belongs to this browser tab only and is cleared when the tab closes or a new
  // analysis starts: which source was open, the Search Console token (it expires within an hour) and the
  // property, dates and folder chosen, or an uploaded export's parsed rows. Search data from Google is not kept;
  // a reload fetches it again.
  const sess = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { try { sessionStorage.removeItem('cw:' + k); } catch (x) { } return false; } },
    clear() { try { ['src', 'tok', 'last', 'file'].forEach(k => sessionStorage.removeItem('cw:' + k)); } catch (e) { } }
  };

  // pages visited in this tab, newest last, for the Back button (survives a reload)
  const NAV = (sess.get('nav') || []).filter(h => typeof h === 'string' && h.length < 600).slice(-50);

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
  // Comparison data can come two ways:
  //  1. an export made with Date › Compare: each sheet has "Previous …" columns next to the current ones;
  //  2. two exports uploaded together (this period and the one before): the older one becomes the comparison.
  const MAX_BYTES = 50 * 1024 * 1024;
  const KIND_LABEL = { Q: 'Queries', P: 'Pages', C: 'Dates', Dev: 'Devices', Countries: 'Countries', Appearance: 'Search appearance' };
  function kindOf(name, header) {
    const n = name.toLowerCase(), h = String(header || '').toLowerCase();
    const has = w => n.includes(w) || h.includes(w);
    if (n.includes('filter') || h === 'filter') return 'Filters';
    return has('quer') ? 'Q' : has('appearance') ? 'Appearance' : has('page') ? 'P' : has('countr') ? 'Countries' : has('date') || n.includes('chart') ? 'C' : has('device') ? 'Dev' : null;
  }
  // Find metric columns by header; "Previous …" columns hold the comparison period.
  const PREV_RX = /\b(previous|prev|compared|comparison|before|earlier)\b/i;
  const METRIC_RX = { clicks: /click(?!.?through)/i, impr: /impression/i, ctr: /\bctr\b|click.?through/i, pos: /position/i };
  function columnsOf(header) {
    const h = header.map(x => String(x == null ? '' : x));
    const find = (re, prev) => h.findIndex((x, i) => i > 0 && re.test(x) && PREV_RX.test(x) === prev);
    const cur = {}, prev = {};
    Object.entries(METRIC_RX).forEach(([k, re]) => { cur[k] = find(re, false); prev[k] = find(re, true); });
    if (Object.values(cur).some(i => i < 0)) Object.assign(cur, { clicks: 1, impr: 2, ctr: 3, pos: 4 }); // unnamed columns: Search Console's order
    return { cur, prev: Object.values(prev).every(i => i > 0) ? prev : null };
  }
  const metricsOf = (r, c) => ({ clicks: num(r[c.clicks]), impr: num(r[c.impr]), ctr: ctrVal(r[c.ctr]), pos: num(r[c.pos]) });
  async function isGenAi(files) {
    const G = window.CW_GENAI; if (!G) return false;
    const sheets = [];
    for (const f of files) { try { const wb = XLSX.read(await readBuffer(f), { type: 'array', raw: true }); wb.SheetNames.forEach(n => sheets.push({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }) })); } catch (e) { } }
    return G.parse(sheets).ok;
  }
  const readBuffer = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(new Uint8Array(e.target.result)); r.onerror = () => rej(new Error('read failed')); r.readAsArrayBuffer(file); });
  const emptySet = name => ({ name, Q: [], P: [], C: [], Dev: [], Countries: [], Appearance: [], prevQ: [], prevP: [], prevC: [], found: new Set() });

  function addSheet(set, kind, rows) {
    if (set.found.has(kind)) return;
    if (kind === 'Filters') { set.filters = rows.slice(1).map(r => [String(r[0] || ''), String(r[1] || '')]).filter(r => r[0]); return; }
    set.found.add(kind);
    const cols = columnsOf(rows[0]);
    rows.slice(1).forEach(r => {
      if (r[0] === '' || r[0] == null) return;
      const key = String(r[0]);
      const row = metricsOf(r, cols.cur), prev = cols.prev ? metricsOf(r, cols.prev) : null;
      if (kind === 'Q') { set.Q.push({ q: key, ...row }); if (prev) set.prevQ.push({ q: key, ...prev }); }
      else if (kind === 'P') { set.P.push({ p: key, ...row }); if (prev) set.prevP.push({ p: key, ...prev }); }
      else if (kind === 'C') { const d = typeof r[0] === 'number' ? excelDate(r[0]) : key.slice(0, 10); set.C.push({ d, ...row }); if (prev) set.prevC.push({ d, ...prev }); }
      else if (kind === 'Dev') set.Dev.push({ d: key.toUpperCase(), ...row });
      else set[kind].push({ d: key, ...row });
    });
  }
  const finish = set => {
    set.C = set.C.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d)).sort((a, b) => a.d.localeCompare(b.d));
    set.start = set.C.length ? set.C[0].d : null; set.end = set.C.length ? set.C[set.C.length - 1].d : null;
    // rows that existed only in the previous period still matter for declines
    set.prevQ = set.prevQ.filter(r => r.clicks > 0 || r.impr > 0); set.prevP = set.prevP.filter(r => r.clicks > 0 || r.impr > 0);
    set.Q = set.Q.filter(r => r.clicks > 0 || r.impr > 0); set.P = set.P.filter(r => r.clicks > 0 || r.impr > 0);
    return set;
  };

  async function readFiles(files) {
    startError('');
    if (!window.XLSX) { startError('The spreadsheet reader is still loading. Try again in a moment.'); return; }
    const zip = files.find(f => /\.zip$/i.test(f.name));
    if (zip) { startError('That is Search Console\'s CSV download, which comes as a .zip. Unzip it and select the CSV files together, or use Export › Download Excel instead.'); return; }
    const big = files.find(f => f.size > MAX_BYTES);
    if (big) { startError(`“${big.name}” is larger than 50 MB. Search Console exports are much smaller; check that this is the Performance export.`); return; }
    // each Excel file is its own export; all CSV files together form one export
    const sets = [], csv = emptySet('CSV files'), unread = [];
    for (const file of files) {
      let wb;
      // raw: CSV cells stay text, so a query such as "=total" is not turned into a formula and lost
      try { wb = XLSX.read(await readBuffer(file), { type: 'array', raw: true }); } catch (e) { unread.push(file.name); continue; }
      if (!wb || !wb.SheetNames || !wb.SheetNames.length) { unread.push(file.name); continue; }
      const isCsv = /\.csv$/i.test(file.name) || wb.SheetNames.length === 1;
      const set = isCsv ? csv : emptySet(file.name);
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }).filter(r => r.some(c => c !== ''));
        if (rows.length < 2) return;
        // a CSV has one sheet named "Sheet1": use the file name instead
        const kind = kindOf(isCsv ? file.name + ' ' + name : name, rows[0][0]);
        if (kind) addSheet(set, kind, rows);
      });
      if (!isCsv && set.found.size) sets.push(set);
    }
    if (csv.found.size) sets.push(csv);
    const usable = sets.map(finish).filter(x => x.Q.length || x.P.length);
    // the Generative AI report export has impressions only: it belongs on its own screen, not here
    if (!usable.length || usable.every(x => !x.Q.length)) {
      if (await isGenAi(files)) { startError('This is the Generative AI report export. Load your Performance export (or connect Search Console) here first, then add this file under AI search › Generative AI report.'); return; }
    }
    if (!usable.length) {
      const found = new Set(sets.flatMap(x => [...x.found]));
      startError(unread.length && !found.size ? `Couldn't read ${unread.map(n => '“' + n + '”').join(', ')} as a spreadsheet. Upload the file from Search Console › Performance › Export › Download Excel.`
        : found.size ? `Found ${[...found].map(k => KIND_LABEL[k]).join(', ')}, but no Queries or Pages. Export from Search Console › Performance with the Queries and Pages tabs included.`
        : 'That file has no Queries or Pages sheet. Export it from Search Console › Performance › Export › Download Excel.');
      return;
    }
    if (usable.length > 2) { startError('Upload one export, or two exports together: this period and the one before it.'); return; }
    let cur = usable[0], note = '';
    if (usable.length === 2) {
      if (!usable[0].end || !usable[1].end) { startError('To compare two exports, both need their Dates sheet so Clickwise can tell which period is newer.'); return; }
      const [older, newer] = usable.slice().sort((a, b) => a.end.localeCompare(b.end));
      if (older.end >= newer.start) { startError(`The two exports overlap (${older.start} to ${older.end} and ${newer.start} to ${newer.end}). Export two separate periods, for example the last 3 months and the 3 months before.`); return; }
      cur = newer;
      cur.prevQ = older.Q; cur.prevP = older.P; cur.prevC = older.C; cur.prevStart = older.start; cur.prevEnd = older.end;
      if (Math.abs(older.C.length - newer.C.length) > 3) note = `The two periods have different lengths (${newer.C.length} and ${older.C.length} days). The earlier period's clicks and impressions were scaled to ${newer.C.length} days so the changes compare like for like.`;
    }
    const first = files[0];
    const host = (cur.P[0] && hostOf(cur.P[0].p)) || (first.name.match(/([a-z0-9-]+\.[a-z.]{2,})/i) || [])[1] || 'Your site';
    const hasPrev = cur.prevQ.length || cur.prevP.length;
    loaded({
      Q: cur.Q, P: cur.P, C: cur.C, Dev: cur.Dev, Countries: cur.Countries, Appearance: cur.Appearance,
      prevQ: hasPrev ? cur.prevQ : null, prevP: hasPrev ? cur.prevP : null, prevC: cur.prevC.length ? cur.prevC : null,
      prevStart: cur.prevStart || null, prevEnd: cur.prevEnd || null, compareNote: note,
      // a Page filter set in Search Console before exporting tells us which folder or page this covers
      scope: (() => { const f = (cur.filters || []).find(r => /^page$/i.test(r[0].trim())); return f ? 'Page filter: ' + f[1].trim() : null; })(),
      site: host, source: 'file', start: cur.start, end: cur.end, days: cur.C.length || null
    });
  }
  function excelDate(n) { const d = new Date(Math.round((n - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; } }

  // ── Google sign-in (Google Identity Services token flow) ──
  let token = null, tokenClient = null, tokenExpires = 0, RESUME = null;
  $('btn-connect').addEventListener('click', () => {
    startError('');
    if (!CFG.googleClientId || CFG.googleClientId.startsWith('YOUR_')) { startError('Google sign-in is not configured yet. Add your OAuth client ID in config.js. Meanwhile, upload an export or try the sample data.'); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) { startError('Google sign-in did not load. Check your connection or ad blocker, then try again.'); return; }
    tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
      client_id: CFG.googleClientId,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      callback: r => {
        if (r.error) { startError('Sign-in was not completed: ' + r.error); return; }
        token = r.access_token; tokenExpires = Date.now() + (+r.expires_in || 3600) * 1000; sess.set('tok', { t: token, exp: tokenExpires });
        if (RESUME) { const o = RESUME; RESUME = null; resumeApi(o); } else openPicker();
      },
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
      // URL Inspection lives on the v1 API; everything else on webmasters/v3
      res = await fetch('https://searchconsole.googleapis.com/' + (path.startsWith('v1/') ? path : 'webmasters/v3/' + path), {
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
  // Turn what the user typed ("/employers", "employers/", or a full URL) into a page filter.
  // The pattern is built here and fully escaped; users never write one.
  function scopeOf(input, site, exact) {
    let v = String(input || '').trim();
    if (!v) return { regex: null, label: null };
    const propHost = site.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').toLowerCase();
    let host = null, path = v;
    if (/^https?:\/\//i.test(v)) {
      let u; try { u = new URL(v); } catch (e) { return { error: 'That doesn\'t look like a valid address. Use a path such as /blog/ or a full URL.' }; }
      host = u.hostname.toLowerCase(); path = u.pathname;
      const h = host.replace(/^www\./, '');
      if (h !== propHost && !h.endsWith('.' + propHost)) return { error: `That address is on ${host}, not on ${propHost}.` };
    } else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(v)) { host = v.split('/')[0].toLowerCase(); path = v.slice(host.length); }
    path = '/' + path.replace(/^\/+/, '').replace(/[?#].*$/, '');
    const trimmed = path.replace(/\/+$/, '');
    if (!trimmed) return exact ? { regex: '^https?://' + (host ? esc2(host) : '(www\\.)?[^/]+') + '/?$', label: 'Home page only' } : { regex: null, label: null };
    const re2 = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostRx = host ? re2(host) : '[^/]+';
    return {
      regex: '^https?://' + hostRx + re2(trimmed) + (exact ? '/?(?:[?#].*)?$' : '(?:[/?#].*)?$'),
      label: (exact ? 'Page: ' : 'Folder: ') + trimmed + (exact ? '' : '/')
    };
    function esc2(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  }
  // Pages through the API 25,000 rows at a time. `from` skips rows already fetched; quiet pulls
  // run in the background and do not write to the picker's progress line.
  async function pull(site, start, end, dims, max, label, from = 0, quiet = false) {
    const out = [];
    for (let startRow = from; startRow < max; startRow += 25000) {
      if (!quiet) progress(`Fetching ${label}… ${out.length.toLocaleString()} rows`);
      const body = { startDate: start, endDate: end, dimensions: dims, type: FILTER.type, rowLimit: Math.min(25000, max - startRow), startRow };
      const filters = [];
      if (FILTER.device && !dims.includes('device')) filters.push({ dimension: 'device', operator: 'equals', expression: FILTER.device });
      if (FILTER.page) filters.push({ dimension: 'page', operator: 'includingRegex', expression: FILTER.page });
      if (filters.length) body.dimensionFilterGroups = [{ groupType: 'and', filters }];
      const d = await api(`sites/${encodeURIComponent(site)}/searchAnalytics/query`, body);
      const rows = d.rows || [];
      out.push(...rows);
      if (rows.length < 25000) break;
    }
    return out;
  }
  const mapRow = (r, keys) => { const o = { clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position }; keys.forEach((k, i) => o[k] = r.keys[i]); return o; };
  function progress(t) { $('pick-progress').textContent = t; $('scope-progress').textContent = t; }

  const iso = d => d.toISOString().slice(0, 10);
  // Dates are plain YYYY-MM-DD strings moved in whole days, so the user's time zone never shifts them.
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // Last day with final Search Console data. Search Console's days are Pacific time and final data usually
  // ends 2–3 days back; the real date is read from the property once signed in (latestFinal below).
  const ptToday = () => (window.CW_SURF ? window.CW_SURF.ptDate(0) : new Date().toISOString().slice(0, 10));
  let LATEST = addDays(ptToday(), -3), LATEST_KNOWN = false;
  async function latestFinal(site) {
    try {
      const d = await api(`sites/${encodeURIComponent(site)}/searchAnalytics/query`, { startDate: addDays(ptToday(), -10), endDate: ptToday(), dimensions: ['date'], rowLimit: 20 });
      const last = (d.rows || []).map(r => r.keys[0]).sort().pop();
      if (last) { LATEST = last; LATEST_KNOWN = true; }
    } catch (e) { /* keep the estimate */ }
    return LATEST;
  }
  let PRESET = 90;
  function setRange(days) {
    PRESET = days;
    const end = LATEST, start = addDays(end, -days + 1);
    $('pick-start').value = start; $('pick-end').value = end;
    document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', +b.dataset.days === days));
  }
  $('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRange(+b.dataset.days); });
  $('pick-back').addEventListener('click', () => show('start'));

  let SITES = [];
  const siteLabel = u => u.replace(/^sc-domain:/, '') + (u.startsWith('sc-domain:') ? ' (domain)' : '');
  async function openPicker() {
    show('picker'); setRange(90); $('pick-error').hidden = true; progress('');
    const sel = $('pick-site');
    sel.innerHTML = '<option>Loading your properties…</option>';
    try {
      const d = await api('sites');
      const sites = (d.siteEntry || []).filter(s => s.permissionLevel !== 'siteUnverifiedUser').sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
      if (!sites.length) throw new Error('This Google account has no verified Search Console properties. Sign in with the account that owns the property.');
      SITES = sites.map(s => s.siteUrl);
      sel.innerHTML = SITES.map(u => `<option value="${esc(u)}">${esc(siteLabel(u))}</option>`).join('');
      // end the preset ranges on the last day Search Console has final data for
      await latestFinal(SITES[0]); setRange(PRESET);
    } catch (err) { $('pick-error').textContent = err.message; $('pick-error').hidden = false; }
  }

  // Runs an analysis from Search Console. Used by the property screen and by the scope switcher
  // in the top bar, which re-runs the same property and dates for another folder or page.
  let LAST = null;
  async function analyseProperty(o, ui) {
    if (o.end && o.end > LATEST && LATEST_KNOWN) o = { ...o, end: LATEST };
    const { site, start, end, compare } = o;
    FILTER = { type: o.type, device: o.device };
    // Optional scope: a folder ("/blog/") or one page, sent to Google as a page filter.
    const sc = scopeOf(o.scopeInput, site, o.exact);
    if (sc.error) { ui.error.textContent = sc.error; ui.error.hidden = false; return; }
    FILTER.page = sc.regex; FILTER.scope = sc.label;
    if (!site || !start || !end || start > end) { ui.error.textContent = 'Choose a property and a valid date range.'; ui.error.hidden = false; return; }
    ui.error.hidden = true; ui.go.disabled = true;
    LAST = { ...o }; sess.set('src', 'api'); sess.set('last', LAST); sess.set('file', null);
    const id = ++LOAD, t0 = Date.now();
    const tick = setInterval(() => progress(`Fetching queries, pages and daily totals… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
    try {
      const days = Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
      const pe = { v: addDays(start, -1) }, ps = { v: addDays(start, -days) };
      // Step 1, in parallel: enough to show the dashboard (first 25,000 queries and pages, dates, devices).
      const FIRST = 25000;
      const [q, p, c, dev] = await Promise.all([
        pull(site, start, end, ['query'], Math.min(FIRST, CFG.maxRows), 'queries', 0, true),
        pull(site, start, end, ['page'], Math.min(FIRST, CFG.maxRows), 'pages', 0, true),
        pull(site, start, end, ['date'], 1000, 'daily totals', 0, true),
        pull(site, start, end, ['device'], 10, 'devices', 0, true)
      ]);
      if (!q.length && !p.length) throw new Error('Search Console has no data for this property in that range.');
      clearInterval(tick); progress('Analysing…');
      const more = { q: q.length === FIRST && CFG.maxRows > FIRST, p: p.length === FIRST && CFG.maxRows > FIRST };
      const data = {
        site: site.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, ''), siteUrl: site, source: 'api', start, end, days, filters: { ...FILTER }, scope: FILTER.scope || null,
        prevStart: compare ? ps.v : null, prevEnd: compare ? pe.v : null, finalThrough: LATEST_KNOWN ? LATEST : null,
        Q: q.map(r => mapRow(r, ['q'])), P: p.map(r => mapRow(r, ['p'])), C: c.map(r => mapRow(r, ['d'])).sort((a, b) => a.d.localeCompare(b.d)),
        Dev: dev.map(r => mapRow(r, ['d'])), QP: null, prevQ: null, prevP: null, prevC: null,
        pending: { qp: true, prev: compare, more: more.q || more.p },
        // a list that reached this many rows may be missing smaller rows (used when comparing periods)
        rowCap: more.q || more.p ? FIRST : CFG.maxRows
      };
      loaded(data);
      // Step 2, in the background: query-page pairs, the comparison period and any rows beyond 25,000.
      background(id, data, { site, start, end, ps: ps.v, pe: pe.v, compare, more, FIRST });
    } catch (err) { ui.error.textContent = err.message; ui.error.hidden = false; progress(''); }
    finally { clearInterval(tick); ui.go.disabled = false; }
  }
  $('picker-form').addEventListener('submit', e => {
    e.preventDefault();
    analyseProperty({ site: $('pick-site').value, start: $('pick-start').value, end: $('pick-end').value, compare: $('pick-compare').checked,
      type: $('pick-type').value, device: $('pick-device').value, scopeInput: $('pick-scope').value, exact: $('pick-exact').checked }, { error: $('pick-error'), go: $('pick-go') });
  });

  // ── change property, dates or folder from the top bar ──
  // Search Console analyses re-run with the new choice; uploads and sample data are fixed, so the
  // dialog explains that and offers a new analysis instead.
  function openChange(focus, preset) {
    if (!D) return;
    const live = D.source === 'api' && LAST;
    $('scope-fields').hidden = !live; $('scope-fixed').hidden = !!live;
    $('scope-go').hidden = !live; $('scope-whole').hidden = !live; $('scope-new').hidden = !!live;
    $('scope-error').hidden = true; $('scope-progress').textContent = '';
    if (live) {
      const list = SITES.length ? SITES : [LAST.site];
      $('scope-site').innerHTML = list.map(u => `<option value="${esc(u)}"${u === LAST.site ? ' selected' : ''}>${esc(siteLabel(u))}</option>`).join('');
      $('scope-start').value = LAST.start; $('scope-end').value = LAST.end;
      $('scope-in').value = LAST.scopeInput || ''; $('scope-exact').checked = !!LAST.exact; $('scope-compare').checked = !!LAST.compare;
      $('scope-device').value = LAST.device || '';
      if (preset && preset.days) { $('scope-start').value = addDays(LATEST, -preset.days + 1); $('scope-end').value = LATEST; }
      if (preset && preset.device) $('scope-device').value = preset.device;
      markPreset();
    } else {
      $('scope-fixed-msg').textContent = D.source === 'demo'
        ? 'This is sample data for a fictional site, so its property and dates are fixed. Connect Search Console to analyse your own site and pick any dates.'
        : 'This analysis comes from an uploaded export, which already holds one property and one date range. To change them, export again from Search Console with the dates you want, or connect Search Console to switch freely.';
    }
    $('scope-dialog').showModal();
    const f = live && { site: 'scope-site', dates: 'scope-start', scope: 'scope-in' }[focus];
    (f ? $(f) : $('scope-cancel')).focus();
  }
  function markPreset() {
    const days = Math.round((new Date($('scope-end').value) - new Date($('scope-start').value)) / 864e5) + 1;
    document.querySelectorAll('#scope-presets button[data-days]').forEach(b => b.classList.toggle('on', $('scope-end').value === LATEST && +b.dataset.days === days));
  }
  $('scope-presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    // 24 hours is a separate hourly view, not an analysis range: open it and keep the current dates
    if (b.dataset.live) { $('scope-dialog').close(); location.hash = '#live'; return; }
    $('scope-start').value = addDays(LATEST, -+b.dataset.days + 1); $('scope-end').value = LATEST; markPreset();
  });
  ['scope-start', 'scope-end'].forEach(id => $(id).addEventListener('change', markPreset));
  $('top-site-btn').addEventListener('click', () => openChange('site'));
  $('top-range-btn').addEventListener('click', () => openChange('dates'));
  $('top-scope').addEventListener('click', () => openChange('scope'));
  // the Goal builder asks for other dates or one device: open the same dialog with those values filled in
  document.addEventListener('cw:change', e => openChange(e.detail && e.detail.days ? 'dates' : 'site', e.detail || {}));
  $('scope-whole').addEventListener('click', () => { $('scope-in').value = ''; $('scope-exact').checked = false; });
  $('scope-cancel').addEventListener('click', () => $('scope-dialog').close());
  $('scope-24').addEventListener('click', () => $('scope-dialog').close());
  $('scope-new').addEventListener('click', () => { $('scope-dialog').close(); $('btn-new').click(); });
  $('scope-form').addEventListener('submit', async e => {
    e.preventDefault();
    const site = $('scope-site').value || LAST.site;
    // The folder belongs to the old property; drop it when switching to a different site.
    const keepScope = site === LAST.site;
    const before = LOAD;
    await analyseProperty({ ...LAST, site, start: $('scope-start').value, end: $('scope-end').value, compare: $('scope-compare').checked,
      scopeInput: keepScope ? $('scope-in').value : '', exact: keepScope && $('scope-exact').checked, device: $('scope-device').value }, { error: $('scope-error'), go: $('scope-go') });
    if (LOAD !== before && $('scope-error').hidden && $('scope-dialog').open) $('scope-dialog').close();
  });
  // A new site may need brand terms first; loaded() shows that screen, so close the dialog then too.
  $('scope-site').addEventListener('change', () => { if ($('scope-site').value !== LAST.site) { $('scope-in').value = ''; $('scope-exact').checked = false; } });

  let LOAD = 0;
  function status(t) { const el = $('top-loading'); el.textContent = t; el.hidden = !t; }
  async function background(id, data, o) {
    const left = new Set();
    const job = (name, p, apply) => { left.add(name); return p.then(rows => { if (id !== LOAD) return; apply(rows); left.delete(name); refresh(); }, err => { if (id !== LOAD) return; left.delete(name); data.failed = (data.failed || []).concat(name + ': ' + err.message); refresh(); }); };
    const label = () => left.size ? `Loading ${[...left].join(', ')}…` : '';
    const refresh = () => {
      data.pending = { qp: left.has('query-page pairs'), prev: left.has('previous period'), more: left.has('more rows') };
      status(label() || (data.failed ? 'Some extra data could not load' : ''));
      if (A && D === data) { const y = window.scrollY; A = analyse(); counts(); route(); window.scrollTo(0, y); }
    };
    const jobs = [job('query-page pairs', pull(o.site, o.start, o.end, ['query', 'page'], CFG.maxQueryPageRows, '', 0, true), rows => { data.QP = rows.map(r => mapRow(r, ['q', 'p'])); })];
    if (o.compare) jobs.push(job('previous period', Promise.all([
      pull(o.site, o.ps, o.pe, ['date'], 1000, '', 0, true), pull(o.site, o.ps, o.pe, ['query'], CFG.maxRows, '', 0, true), pull(o.site, o.ps, o.pe, ['page'], CFG.maxRows, '', 0, true)
    ]), ([c, q, p]) => { data.prevC = c.map(r => mapRow(r, ['d'])); data.prevQ = q.map(r => mapRow(r, ['q'])); data.prevP = p.map(r => mapRow(r, ['p'])); data.prevRowCap = CFG.maxRows; }));
    if (o.more.q || o.more.p) jobs.push(job('more rows', Promise.all([
      o.more.q ? pull(o.site, o.start, o.end, ['query'], CFG.maxRows, '', o.FIRST, true) : [], o.more.p ? pull(o.site, o.start, o.end, ['page'], CFG.maxRows, '', o.FIRST, true) : []
    ]), ([q, p]) => { data.Q = data.Q.concat(q.map(r => mapRow(r, ['q']))); data.P = data.P.concat(p.map(r => mapRow(r, ['p']))); data.rowCap = CFG.maxRows; }));
    status(label());
    await Promise.all(jobs);
    if (id === LOAD && !data.failed) { status('All data loaded'); setTimeout(() => { if (id === LOAD && $('top-loading').textContent === 'All data loaded') status(''); }, 4000); }
    else if (id === LOAD) status('Some extra data could not load: ' + data.failed.join('; '));
  }

  // ── after data is loaded ──
  let RESTORING = false;
  function loaded(data) {
    D = data;
    // a fresh analysis starts a fresh Back history; a reload that restores the last one keeps it
    if (!RESTORING) { NAV.length = 0; sess.set('nav', []); }
    RESTORING = false;
    if (data.source === 'demo') { sess.set('src', 'demo'); sess.set('file', null); }
    else if (data.source === 'file') { sess.set('src', 'file'); if (!sess.set('file', data)) sess.set('src', null); }
    if (D.source === 'demo') { D.prevStart = shift(D.start, -90); D.prevEnd = shift(D.start, -1); }
    const saved = store.get('site:' + D.site);
    if (saved && saved.brand) { S = saved; launch(); return; }
    const g = window.CW.brandGuess(D.siteUrl || D.site, D.Q);
    $('brand-terms').value = g.terms.join(', ');
    $('brand-suggest').innerHTML = g.suggestions.length ? '<span class="progress" style="align-self:center">Add:</span>' + g.suggestions.map(s => `<button type="button" data-add="${esc(s)}">${esc(s)}</button>`).join('') : '';
    show('setup');
    $('brand-terms').focus();
  }
  function shift(d, n) { return addDays(d, n); }
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

  // The opportunity engine builds one ranked list (evidence, impact, confidence, effort) on top of the analysis.
  // Content assistant first (topics, gaps, links), then the opportunity engine, which lists both.
  // A crawler's link export is kept in memory for this site only: never stored, gone on reload.
  const INLINKS = {};
  // On large sites topic grouping takes seconds, so it runs in a Web Worker: the dashboard shows at once and
  // Content & links (and the gaps and links in All opportunities) fill in when it finishes. A newer analysis
  // cancels the older job. Without Worker support it runs here, after the page has painted.
  const BIG = 10000;
  let CJOB = 0, worker = null;
  const contentStatus = t => { const el = $('top-content'); el.textContent = t; el.hidden = !t; };
  function contentDone(id, content) {
    if (id !== CJOB || !A) return;
    // a new object, so per-analysis caches (e.g. filter rows) are rebuilt with the new opportunities
    const next = Object.assign({}, A, { content, contentPending: false });
    next.opps = window.CW_OPPS.build(next, D);
    A = next; contentStatus('');
    const y = window.scrollY; counts();
    const base = (location.hash.slice(1) || 'overview').split('?')[0];
    if (['content', 'opps', 'filters', 'workflows', 'overview'].includes(base) || base.startsWith('wf=')) { route(); window.scrollTo(0, y); }
    document.dispatchEvent(new CustomEvent('cw:content-ready'));
  }
  function contentJob(a) {
    const id = ++CJOB, inlinks = INLINKS[D.site] || null;
    contentStatus(`Grouping ${a.NBQ.length.toLocaleString()} searches into topics…`);
    const fallback = () => setTimeout(() => { if (id === CJOB) contentDone(id, window.CW_CONTENT.build(A, D, { brand: S.brand, inlinks })); }, 50);
    if (worker) { worker.terminate(); worker = null; }
    if (!window.Worker) { fallback(); return; }
    try {
      const v = (document.querySelector('script[src^="content.js"]').getAttribute('src').match(/v=(\d+)/) || [])[1] || '0';
      worker = new Worker('content-worker.js?v=' + v);
      worker.onmessage = e => { if (e.data.error) { fallback(); return; } contentDone(e.data.id, e.data.content); };
      worker.onerror = ev => { ev.preventDefault(); fallback(); };
      worker.postMessage({ id, D, S: { ...S, utilityHints: CFG.utilityHints }, inlinks });
    } catch (e) { fallback(); }
  }
  const analyse = () => {
    const a = window.CW.analyse(D, { ...S, utilityHints: CFG.utilityHints });
    if (a.NBQ.length > BIG) { a.content = null; a.contentPending = true; contentJob(a); }
    else { CJOB++; contentStatus(''); a.content = window.CW_CONTENT.build(a, D, { brand: S.brand, inlinks: INLINKS[D.site] || null }); }
    a.titles = INPAGES[D.site] ? window.CW_TITLES.audit(a, D, INPAGES[D.site], { brand: S.brand }) : null;
    a.opps = window.CW_OPPS.build(a, D);
    return a;
  };
  const recalc = () => { if (!D || !A) return; const y = window.scrollY; A = analyse(); counts(); route(); window.scrollTo(0, y); };
  // A crawler export can be a link report (source → destination) or a page report (URL, title, meta).
  // The file says which by its columns; both are kept in memory for this site only, never stored.
  const INPAGES = {};
  document.addEventListener('cw:inlinks', e => {
    const d = e.detail || {};
    if (d.clear) { if (d.clear === 'pages') delete INPAGES[D.site]; else delete INLINKS[D.site]; recalc(); return; }
    const host = window.CW_CONTENT.normUrl((D.P[0] && D.P[0].p) || '').split('/')[0];
    const name = String(d.name || 'crawl.csv').slice(0, 120);
    const head = (String(d.text || '').replace(/^\ufeff/, '').split(/\r?\n/)[0] || '').toLowerCase();
    const looksPages = /title/.test(head) && !/destination|target|\bto\b/.test(head);
    const r = looksPages ? window.CW_TITLES.parsePages(d.text, host) : window.CW_CONTENT.parseLinks(d.text, host);
    if (!r.ok) {
      // a page report without a title column, or a link report without destinations: say what each needs
      const other = looksPages ? window.CW_CONTENT.parseLinks(d.text, host) : window.CW_TITLES.parsePages(d.text, host);
      if (other.ok) { if (looksPages) INLINKS[D.site] = { links: other.links, name, rows: other.rows, skipped: other.skipped }; else INPAGES[D.site] = { ...other, name }; recalc(); return; }
      document.dispatchEvent(new CustomEvent('cw:inlinks-error', { detail: looksPages ? r.error : r.error + ' For titles and meta descriptions, export Internal › HTML instead.' }));
      return;
    }
    if (looksPages) INPAGES[D.site] = { ...r, name }; else INLINKS[D.site] = { links: r.links, name, rows: r.rows, skipped: r.skipped };
    recalc();
  });
  // ── daily data for the fix tracker ──
  // Search Console: fetched for exactly one page (or the analysed scope) and date range. Sample data: built
  // from the sample pages. Uploads: only the site's daily totals exist, so pages cannot be measured.
  const SRC_CACHE = new Map();
  async function apiDaily(dims, start, end, pageUrl) {
    const filters = [];
    if (FILTER.device) filters.push({ dimension: 'device', operator: 'equals', expression: FILTER.device });
    if (pageUrl) filters.push({ dimension: 'page', operator: 'equals', expression: pageUrl });
    else if (FILTER.page) filters.push({ dimension: 'page', operator: 'includingRegex', expression: FILTER.page });
    const body = { startDate: start, endDate: end, dimensions: dims, type: FILTER.type || 'web', rowLimit: dims[0] === 'query' ? 500 : 1000 };
    if (filters.length) body.dimensionFilterGroups = [{ groupType: 'and', filters }];
    const d = await api(`sites/${encodeURIComponent(D.siteUrl)}/searchAnalytics/query`, body);
    return (d.rows || []).map(r => mapRow(r, dims[0] === 'query' ? ['q'] : ['d']));
  }
  function setSource() {
    const kind = D.source === 'api' ? 'api' : D.source === 'demo' ? 'demo' : 'file';
    const cached = (key, fn) => { if (!SRC_CACHE.has(key)) SRC_CACHE.set(key, fn().catch(e => { SRC_CACHE.delete(key); throw e; })); return SRC_CACHE.get(key); };
    const today = { toISOString: () => LATEST }, old = { toISOString: () => addDays(LATEST, -480) };
    const inRange = (rows, s, e) => rows.filter(r => r.d >= s && r.d <= e);
    window.CW_SOURCE = {
      kind, site: D.site, scope: D.scope || null,
      latest: kind === 'api' ? today.toISOString().slice(0, 10) : D.end || null, latestKnown: kind === 'api' && LATEST_KNOWN,
      earliest: kind === 'api' ? old.toISOString().slice(0, 10) : D.start || null,
      pages: A.P.map(r => ({ p: r.p, path: r.path, clicks: r.clicks })),
      canPage: kind !== 'file',
      siteDaily: (s, e) => kind === 'api' ? cached(`${D.siteUrl}|${D.scope}|site|${s}|${e}`, () => apiDaily(['date'], s, e)) : Promise.resolve(inRange(D.C || [], s, e)),
      pageDaily: (url, s, e) => kind === 'api' ? cached(`${D.siteUrl}|page|${url}|${s}|${e}`, () => apiDaily(['date'], s, e, url)) : kind === 'demo' ? Promise.resolve(inRange(window.CW_DEMO.pageDaily(D, url), s, e)) : Promise.reject(new Error('An export has only whole-site daily totals. Connect Search Console to measure one page.')),
      pageQueries: kind === 'api' ? (url, s, e) => cached(`${D.siteUrl}|q|${url}|${s}|${e}`, () => apiDaily(['query'], s, e, url)) : null,
      // Discover, Google News, last 24 hours and indexing (surfaces-view.js). Queries keep the analysed
      // folder or page; the device filter applies only where Search Console supports it.
      start: D.start || null, end: D.end || null,
      gsc: kind === 'api' ? {
        siteUrl: D.siteUrl, type: FILTER.type || 'web',
        query(body) {
          const b = { ...body }, filters = [];
          if (FILTER.page) filters.push({ dimension: 'page', operator: 'includingRegex', expression: FILTER.page });
          if (FILTER.device && !['discover', 'googleNews'].includes(b.type) && !(b.dimensions || []).includes('device')) filters.push({ dimension: 'device', operator: 'equals', expression: FILTER.device });
          if (filters.length) b.dimensionFilterGroups = [{ groupType: 'and', filters }];
          return api(`sites/${encodeURIComponent(D.siteUrl)}/searchAnalytics/query`, b);
        },
        sitemaps: () => api(`sites/${encodeURIComponent(D.siteUrl)}/sitemaps`),
        inspect: url => api('v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: D.siteUrl, languageCode: 'en-US' })
      } : null
    };
  }
  function launch() {
    A = analyse();
    SRC_CACHE.clear(); setSource();
    $('top-site').textContent = D.site + (D.source === 'demo' ? ' (sample)' : '');
    $('top-range').textContent = D.start && D.end ? `${fmtDate(D.start)} – ${fmtDate(D.end)}` : 'Date range not in export';
    const f = D.filters || {}; const ft = [f.type && f.type !== 'web' ? f.type.charAt(0).toUpperCase() + f.type.slice(1) + ' search' : '', f.device ? f.device.charAt(0) + f.device.slice(1).toLowerCase() + ' only' : ''].filter(Boolean).join(' · ');
    $('top-filters').textContent = ft; $('top-filters').hidden = !ft;
    $('top-sample').hidden = D.source !== 'demo';
    // comparison period and data connection, shown in the top bar (presentation only)
    $('top-cmp').textContent = D.prevStart && D.prevEnd ? `vs previous period (${fmtDate(D.prevStart)} – ${fmtDate(D.prevEnd)})` : '';
    $('top-cmp').hidden = !(D.prevStart && D.prevEnd);
    const conn = D.source === 'api' ? ['live', 'GSC connected', `Loaded ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · read-only`] : D.source === 'demo' ? ['sample', 'Sample data', 'Fictional site'] : ['file', 'Uploaded export', 'Not live: connect Search Console for fresh data'];
    $('top-conn').className = 'top-conn ' + conn[0]; $('top-conn-t').textContent = conn[1]; $('top-conn-s').textContent = conn[2]; $('top-conn').hidden = false;
    // API analyses can switch folder from the top bar; uploads only show the scope they came with
    const canSwitch = D.source === 'api';
    $('top-scope').innerHTML = esc(D.scope || (canSwitch ? 'All pages' : '')) + (canSwitch ? ' <span class="scope-edit">Change</span>' : '');
    $('top-scope').hidden = !D.scope && !canSwitch; $('top-scope').disabled = !canSwitch;
    $('top-scope').title = canSwitch ? 'Analyse another folder or page' : 'Set by the Page filter in the export';
    counts();
    show('app');
    if (!knownRoute(location.hash.slice(1))) history.replaceState(null, '', '#overview');
    route();
  }
  function fmtDate(s) { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function counts() {
    const n = { content: A.content ? A.content.gaps.length + A.content.links.length : null, opps: A.opps ? A.opps.items.length : null, quickwins: A.quickWins.length, ctr: A.ctrPages.length, cannibal: A.cannibal.filter(c => c.sev !== 'low').length, decay: A.decay ? A.decay.pages.length : null, ai: A.ai.overview.length };
    // growth layer: P1 priorities and open tasks
    const G = window.CW_GROWTH;
    if (G && D) { try { const P = G.prio(A, D); n.priorities = P ? P.counts.P1 : null; n.tasks = G.tasks(D.site).list.filter(t => ['planned', 'progress'].includes(t.status)).length || null; } catch (e) { } }
    document.querySelectorAll('.nav a').forEach(a => {
      const v = a.dataset.view; let c = a.querySelector('.count');
      if (n[v] == null) { if (c) c.remove(); return; }
      if (!c) { c = document.createElement('span'); c.className = 'count'; a.appendChild(c); }
      c.textContent = n[v].toLocaleString();
    });
  }

  // ── collapsible sidebar groups: every group starts closed and opens only when clicked; a closed group
  // holding the current screen is highlighted instead of opening by itself ──
  function setNavGroup(g, open) {
    g.classList.toggle('closed', !open);
    const b = g.querySelector('.nav-group'); if (b) b.setAttribute('aria-expanded', String(open));
    const sec = g.querySelector('.nav-sec'); if (sec) sec.hidden = !open;
  }
  function openNavGroupOf(link) { document.querySelectorAll('.nav-grp').forEach(g => g.classList.toggle('has-on', !!link && g.contains(link))); }
  (function initNavGroups() {
    try { localStorage.removeItem('cw:nav-open'); } catch (e) { } // state is no longer remembered
    document.querySelectorAll('.nav-grp').forEach(g => {
      const badge = g.querySelector('.nav-badge'); if (badge) badge.textContent = g.querySelectorAll('.nav-sec a').length;
      setNavGroup(g, false);
      g.querySelector('.nav-group').addEventListener('click', () => setNavGroup(g, g.classList.contains('closed')));
    });
  })();

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
    // Back: remember this page unless it is the one already on top (a refresh or a data update re-renders it)
    const here = '#' + raw;
    if (NAV[NAV.length - 1] !== here) { NAV.push(here); if (NAV.length > 50) NAV.splice(0, NAV.length - 50); sess.set('nav', NAV); }
    const prevH = NAV.length > 1 ? NAV[NAV.length - 2] : null;
    $('btn-back').hidden = !prevH;
    if (prevH) { const v = prevH.slice(1).split('?')[0], l = document.querySelector(`.nav a[data-view="${v.startsWith('section=') ? 'sections' : v.startsWith('wf=') ? 'workflows' : v}"] span`); $('btn-back').title = 'Back to ' + (l ? l.textContent : 'the previous page'); }
    $('top-24').classList.toggle('on', name === 'live');
    openNavGroupOf(document.querySelector('.nav a.on'));
    const onLink = document.querySelector('.nav a.on span');
    const h1 = view.querySelector('h1');
    document.title = (sec ? sec + ' — ' : wf && h1 ? h1.textContent + ' — ' : onLink ? onLink.textContent + ' — ' : '') + CFG.appName;
    $('nav').classList.remove('open'); $('menu-btn').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0); view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);
  $('btn-back').addEventListener('click', () => {
    if (NAV.length < 2) return;
    NAV.pop(); const prev = NAV.pop(); sess.set('nav', NAV);
    if (location.hash === prev) route(); else location.hash = prev;
  });

  // ── chrome ──
  $('menu-btn').addEventListener('click', () => { const o = $('nav').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', String(o)); });
  // Print the one-page opportunity report (the browser can save it as PDF).
  $('btn-print').addEventListener('click', () => { if (location.hash !== '#wf=report') { location.hash = '#wf=report'; setTimeout(() => window.print(), 400); } else window.print(); });
  function revoke() { try { if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token, () => { }); } catch (e) { } token = null; tokenExpires = 0; }
  function reset() { LOAD++; status(''); A = null; D = null; revoke(); sess.clear(); NAV.length = 0; sess.set('nav', []); history.replaceState(null, '', location.pathname); fi.value = ''; $('start-info').hidden = true; show('start'); }
  $('btn-new').addEventListener('click', reset);
  // Forget everything stored in this browser for the current site.
  $('set-forget').addEventListener('click', () => {
    if (!D || !confirm(`Forget ${D.site}? This deletes its brand names, ignored searches, page settings, saved workflows, tracked fixes, tasks, priority settings, growth target and client report branding from this browser. Your agency branding is kept for other clients.`)) return;
    try { localStorage.removeItem('cw:site:' + D.site); localStorage.removeItem('cw:saved:' + D.site); localStorage.removeItem('cw:runs:' + D.site); localStorage.removeItem('cw:fixes:' + D.site); localStorage.removeItem('cw:client:' + D.site); ['tasks', 'growth', 'tasks-seeded', 'genai', 'cc-guide-off', 'hourly', 'hourly-on'].forEach(k => localStorage.removeItem('cw:' + k + ':' + D.site)); } catch (e) { }
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

  // A reload continues where you were: the sample loads again, a Search Console analysis is fetched again with
  // the same property, dates and folder (one click to sign in again if the token has expired), and an upload
  // comes back from this tab's session. Otherwise, say why the start screen is showing.
  async function resumeApi(o) {
    show('start'); startError('');
    $('start-info').textContent = 'Restoring your analysis of ' + siteLabel(o.site) + '…'; $('start-info').hidden = false;
    await latestFinal(o.site);
    RESTORING = true;
    await analyseProperty(o, { error: $('start-error'), go: {} });
    RESTORING = false;
    if (!D) { $('start-info').hidden = true; }
  }
  function restore() {
    if (location.hash.length <= 1 || /[?&]demo\b/.test(location.search)) return false;
    const src = sess.get('src');
    if (src === 'demo') { document.addEventListener('DOMContentLoaded', () => { RESTORING = true; loaded(window.CW_DEMO.build()); }); return true; }
    if (src === 'file') { const f = sess.get('file'); if (f && f.Q) { document.addEventListener('DOMContentLoaded', () => { RESTORING = true; loaded(f); }); return true; } }
    if (src === 'api') {
      const o = sess.get('last'), tk = sess.get('tok');
      if (o && o.site) {
        if (tk && tk.t && tk.exp - Date.now() > 120000) { token = tk.t; tokenExpires = tk.exp; document.addEventListener('DOMContentLoaded', () => resumeApi(o)); return true; }
        // the token has expired: one click signs in again (Google needs a click for its window) and continues
        RESUME = o;
        $('start-info').innerHTML = `Your Google session ended. <button type="button" class="btn-primary sm" id="btn-resume">Continue with ${esc(siteLabel(o.site))}</button>`;
        $('start-info').hidden = false;
        $('btn-resume').addEventListener('click', () => $('btn-connect').click());
        return true;
      }
    }
    return false;
  }
  if (!restore() && location.hash.length > 1 && !/[?&]demo\b/.test(location.search)) {
    $('start-info').textContent = 'Clickwise doesn\'t keep your search data, so reloading starts a new analysis. Upload the file again or reconnect — settings for each site are remembered.';
    $('start-info').hidden = false;
  }

  // Deep link straight into the sample: app.html?demo
  // (deferred libraries such as Chart.js are ready by DOMContentLoaded)
  if (/[?&]demo\b/.test(location.search)) document.addEventListener('DOMContentLoaded', () => loaded(window.CW_DEMO.build()));
})();

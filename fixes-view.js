// Clickwise "Fix tracker" screen. The list of fixes is kept in this browser per site; results are measured
// live from the loaded data source (window.CW_SOURCE, set by app.js) and never stored.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, stat, urlCell, chart, cssVar, pctf } = ui;
  const CW = window.CW, FX = window.CW_FIXES, fmtN = CW.fmtN;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const hostOf = site => String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  const TONE = { improved: 'gain', 'maybe-improved': 'gain', declined: 'risk', 'maybe-declined': 'watch', 'no-change': '' };
  const sgn = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%';
  let MSG = null;

  // saved fixes come back from browser storage, so each is checked again; damaged ones are skipped and counted
  function load(site) {
    const raw = store.get('fixes:' + site);
    const list = Array.isArray(raw) ? raw : [];
    const ok = list.filter(f => f && typeof f.id === 'string' && FX.isDate(f.date) && (f.scope === 'site' || (typeof f.url === 'string' && /^https?:\/\//i.test(f.url))));
    return { list: ok, damaged: list.length - ok.length };
  }
  const save = (site, list) => store.set('fixes:' + site, list.slice(0, 100));

  function measureFix(f, S) {
    const w = FX.windows(f.date, S.latest, S.earliest);
    const s = w.before ? w.before.start : f.date, e = w.after ? w.after.end : f.date;
    const pageP = f.scope === 'site' ? S.siteDaily(s, e) : S.pageDaily(f.url, s, e);
    const siteP = f.scope === 'site' ? Promise.resolve(null) : S.siteDaily(s, e).catch(() => null);
    return Promise.all([pageP, siteP]).then(([pr, sr]) => FX.measure(f, pr, sr, S.latest, S.earliest, { siteLabel: S.scope ? 'section you analysed' : 'site' }));
  }

  // the report reads tracked fixes and their results too
  window.CW_FIXVIEW = { load, measureFix };

  V.fixes = (A, D) => {
    const S = window.CW_SOURCE;
    if (!S) return { html: head('Fix tracker', '') + '<p class="empty">Load data first.</p>' };
    const { list, damaged } = load(D.site);
    const G = window.CW_GROWTH, TK = window.CW_TASKS;
    const log = TK && G ? TK.changeLog(G.tasks(D.site).list, list) : list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).map(f => ({ key: 'fix:' + f.id, from: 'fix', fixId: f.id, date: f.date, scope: f.scope === 'site' ? 'site' : 'page', url: f.url, path: f.path, note: f.note, fixIds: [f.id] }));
    const prm = params(), detailId = prm.get('fix');
    const detail = detailId ? list.find(f => f.id === detailId) : null;
    const pageOpts = S.pages.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 2000);
    const minDate = S.earliest ? FX.add(S.earliest, 7) : '', maxDate = S.latest || '';
    const srcNote = S.kind === 'api' ? `Measured live from Search Console for exactly the page you choose${S.scope ? ` (within ${esc(S.scope)})` : ''}. Search Console keeps about 16 months and its data arrives 2–3 days late.`
      : S.kind === 'demo' ? '<b>Sample data:</b> daily page numbers here are generated for the fictional site. Connect Search Console to measure your own pages.'
      : 'This export has only whole-site daily totals, so it can measure a whole-site change (a migration, a template change) but not one page. Connect Search Console to measure pages.';
    const addForm = `<section class="panel"><div class="panel-h"><h2>Track a change</h2><p>Log the day a change went live. Clickwise compares up to ${FX.MAX_WINDOW} days before with the same number of days after.</p></div>
      <form class="panel-b fx-form" id="fx-form" autocomplete="off">
        <label class="field"><span>What changed</span><select id="fx-scope"><option value="page"${S.canPage ? '' : ' disabled'}>One page</option><option value="site"${S.canPage ? '' : ' selected'}>The whole ${S.scope ? 'section' : 'site'}</option></select></label>
        <label class="field fx-url"><span>Page</span><input id="fx-url" type="text" list="fx-pages" placeholder="Start typing a page, or paste its full address" value="${esc(prm.get('add') || '')}" ${S.canPage ? '' : 'disabled'}><datalist id="fx-pages">${pageOpts.map(p => `<option value="${esc(p.p)}">${esc(p.path)}</option>`).join('')}</datalist></label>
        <label class="field"><span>Date it went live</span><input id="fx-date" type="date" ${minDate ? `min="${minDate}"` : ''} ${maxDate ? `max="${maxDate}"` : ''} required></label>
        <label class="field fx-note"><span>What you did (optional)</span><input id="fx-note" type="text" maxlength="300" value="${esc((prm.get('note') || '').slice(0, 300))}" placeholder="e.g. Rewrote the title and added an FAQ"></label>
        <button class="btn-primary" type="submit">Track this fix</button>
        <p class="sf-err" id="fx-err" role="alert">${MSG ? esc(MSG) : ''}</p>
      </form></section>`;
    MSG = null;

    let body;
    if (detail) {
      body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#fixes">Fix tracker</a><span class="sep">/</span><span>${esc(detail.scope === 'site' ? 'Whole ' + (S.scope ? 'section' : 'site') : detail.path)}</span></nav>
        <header class="v-head"><h1>${esc(detail.scope === 'site' ? 'Whole ' + (S.scope ? 'section' : 'site') : detail.path)}</h1><p>Changed on ${esc(detail.date)}${detail.note ? ` · ${esc(detail.note)}` : ''}</p></header>
        <div id="fx-detail" aria-live="polite"><p class="flat">Measuring…</p></div>`;
    } else {
      body = head('Fix tracker', 'Did the change work? Log when you edited a page and Clickwise compares equal periods before and after, against the rest of the site, so a site-wide rise or fall is not credited to your fix.') +
        `<p class="flat ct-mode">${srcNote}</p>` + addForm +
        (damaged ? `<div class="note warn">${damaged} saved fix${damaged === 1 ? ' was' : 'es were'} damaged and left out.</div>` : '') +
        `<section class="panel"><div class="panel-h"><h2>Tracked changes (${log.length})</h2><p>Changes logged here and tasks marked Implemented on the Action board, in one list; a change logged in both places is measured once. Kept in this browser for ${esc(D.site)}. Results are worked out each time from the data you load.</p></div>
          ${log.length ? `<div class="tw"><table class="fx-t"><thead><tr><th scope="col">Page</th><th scope="col">Changed</th><th scope="col">Clicks a day, before → after</th><th scope="col">Result</th><th scope="col"></th></tr></thead><tbody>
            ${log.map(c => `<tr data-fx="${esc(c.key)}"><td class="u">${c.scope === 'site' ? `<b>Whole ${S.scope ? 'section' : 'site'}</b>` : urlCell(c.url, c.path)}${c.note ? `<br><small class="flat">${esc(c.note)}</small>` : ''}<br><span class="tag ${c.from === 'task' ? 'indigo-t' : ''}">${c.from === 'task' ? 'Action board task' + (c.fixIds.length ? ' · also logged here' : '') : 'Logged here'}</span></td><td>${esc(c.date)}</td><td class="fx-num">…</td><td class="fx-res"><span class="flat">Measuring…</span></td>
              <td class="r">${c.from === 'task' ? `<a class="btn-quiet" href="#tasks?id=${encodeURIComponent(c.taskId)}">Open task</a>` : `<a class="btn-quiet" href="#fixes?fix=${encodeURIComponent(c.fixId)}">Details</a> <button type="button" class="btn-link" data-fxrm="${esc(c.fixId)}">Remove</button>`}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty">No changes tracked yet. Add one above, mark a task Implemented on the <a href="#tasks">Action board</a>, or use “Track this fix” on any item in <a href="#opps">All opportunities</a>.</p>'}</section>`;
    }

    const mount = () => {
      const form = document.getElementById('fx-form');
      if (form) {
        const sc = document.getElementById('fx-scope'), url = document.getElementById('fx-url');
        const sync = () => { url.disabled = sc.value === 'site' || !S.canPage; url.closest('.field').hidden = sc.value === 'site'; };
        sc.addEventListener('change', sync); sync();
        form.addEventListener('submit', e => {
          e.preventDefault();
          const scope = sc.value, u = url.value.trim(), page = S.pages.find(p => p.p === u || p.path === u);
          const f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), scope, url: scope === 'site' ? null : (page ? page.p : u), path: scope === 'site' ? null : (page ? page.path : CW.pathOf(u)), date: document.getElementById('fx-date').value, note: document.getElementById('fx-note').value.trim(), at: new Date().toISOString() };
          const errs = FX.validate(f, { host: hostOf(D.siteUrl || D.site), latest: S.latest, earliest: S.earliest });
          if (scope === 'page' && !S.canPage) errs.unshift('This data cannot measure one page. Track the whole site, or connect Search Console.');
          if (errs.length) { document.getElementById('fx-err').textContent = errs[0]; return; }
          const cur = load(D.site).list;
          if (cur.some(x => x.scope === f.scope && x.url === f.url && x.date === f.date)) { document.getElementById('fx-err').textContent = 'That change is already being tracked.'; return; }
          if (!save(D.site, [f].concat(cur))) { document.getElementById('fx-err').textContent = 'Could not save (browser storage is off).'; return; }
          history.replaceState(null, '', '#fixes'); window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      }
      document.querySelectorAll('[data-fxrm]').forEach(b => b.addEventListener('click', () => { save(D.site, load(D.site).list.filter(f => f.id !== b.dataset.fxrm)); window.dispatchEvent(new HashChangeEvent('hashchange')); }));
      // results, one fix at a time so Search Console is not flooded
      if (!detail) {
        const rows = [...document.querySelectorAll('tr[data-fx]')];
        (async () => {
          for (const tr of rows) {
            const c = log.find(x => x.key === tr.dataset.fx); if (!c || !tr.isConnected) continue;
            const f = { id: c.key, scope: c.scope, url: c.url, date: c.date };
            if (f.scope === 'page' && !S.canPage) { tr.querySelector('.fx-num').textContent = '—'; tr.querySelector('.fx-res').innerHTML = '<span class="tag">Needs Search Console</span>'; continue; }
            try {
              const r = await measureFix(f, S);
              if (!tr.isConnected) return;
              tr.querySelector('.fx-num').innerHTML = r.before ? `${r.before.perDay.toFixed(1)} → ${r.after.perDay.toFixed(1)} <small class="flat">(${sgn(r.change.clicks)}${r.relative != null ? `; vs site ${sgn(r.relative)}` : ''})</small>` : '—';
              tr.querySelector('.fx-res').innerHTML = `<span class="tag ${r.status === 'measured' ? TONE[r.verdict] : ''}">${esc(FX.label(r))}</span>`;
            } catch (err) { if (tr.isConnected) tr.querySelector('.fx-res').innerHTML = `<span class="sf-err">${esc(err.message)}</span>`; }
          }
        })();
      } else {
        const box = document.getElementById('fx-detail');
        measureFix(detail, S).then(async r => {
          if (!box.isConnected) return;
          const qs = detail.scope !== 'site' && S.pageQueries && r.window.before ? await Promise.all([S.pageQueries(detail.url, r.window.before.start, r.window.before.end), S.pageQueries(detail.url, r.window.after.start, r.window.after.end)]).then(([b, a]) => FX.queryShift(b, a)).catch(() => null) : null;
          if (!box.isConnected) return;
          const row = (l, b, a, ch) => `<tr><th scope="row">${l}</th><td class="r">${b}</td><td class="r">${a}</td><td class="r">${ch}</td></tr>`;
          box.innerHTML = `<div class="strip">${stat(esc(FX.label(r)), r.status === 'measured' ? `${r.window.L} days before vs ${r.window.L} days after` : 'status', r.status === 'measured' ? (TONE[r.verdict] || '') : 'watch')}${r.before ? stat(sgn(r.change.clicks), 'clicks a day') : ''}${r.relative != null ? stat(sgn(r.relative), `compared with the ${r.site.label}`) : ''}</div>
            ${r.notes.length ? `<div class="note">${r.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
            ${r.before ? `<section class="panel"><div class="panel-h"><h2>Daily clicks</h2><p>${esc(r.window.before.start)} – ${esc(r.window.before.end)} before, ${esc(r.window.after.start)} – ${esc(r.window.after.end)} after. The change day is left out.</p></div><div class="panel-b"><div class="chart-box"><canvas id="fx-chart" aria-label="Daily clicks before and after the change" role="img"></canvas></div></div></section>
            <section class="panel"><div class="tw"><table class="rep-t"><thead><tr><th scope="col"></th><th scope="col" class="r">Before</th><th scope="col" class="r">After</th><th scope="col" class="r">Change</th></tr></thead><tbody>
              ${row('Clicks a day', r.before.perDay.toFixed(1), r.after.perDay.toFixed(1), sgn(r.change.clicks))}
              ${row('Impressions', fmtN(r.before.impr), fmtN(r.after.impr), sgn(r.change.impr))}
              ${row('CTR', pctf(r.before.ctr, 2), pctf(r.after.ctr, 2), r.change.ctr == null ? '—' : (r.change.ctr > 0 ? '+' : '') + r.change.ctr.toFixed(2) + ' pts')}
              ${row('Average position', r.before.pos == null ? '—' : r.before.pos.toFixed(1), r.after.pos == null ? '—' : r.after.pos.toFixed(1), r.change.pos == null ? '—' : (r.change.pos > 0 ? '+' : '') + r.change.pos.toFixed(1) + (r.change.pos <= -0.05 ? ' (better)' : r.change.pos >= 0.05 ? ' (worse)' : ''))}
              ${r.site ? row(`Whole ${esc(r.site.label)}: clicks a day`, r.site.before.perDay.toFixed(0), r.site.after.perDay.toFixed(0), sgn(r.site.change)) : ''}
            </tbody></table></div></section>` : ''}
            ${qs ? `<div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Searches that gained clicks</h2></div><div class="panel-b">${qs.gained.length ? `<ul class="fx-q">${qs.gained.map(x => `<li>${esc(x.q)} <span class="gainv">+${fmtN(x.d)}</span> <small class="flat">${x.bPos ? '#' + x.bPos.toFixed(1) : 'new'} → ${x.aPos ? '#' + x.aPos.toFixed(1) : '—'}</small></li>`).join('')}</ul>` : '<p class="flat">None.</p>'}</div></section>
              <section class="panel"><div class="panel-h"><h2>Searches that lost clicks</h2></div><div class="panel-b">${qs.lost.length ? `<ul class="fx-q">${qs.lost.map(x => `<li>${esc(x.q)} <span class="lossv">${fmtN(x.d)}</span> <small class="flat">${x.bPos ? '#' + x.bPos.toFixed(1) : '—'} → ${x.aPos ? '#' + x.aPos.toFixed(1) : 'gone'}</small></li>`).join('')}</ul>` : '<p class="flat">None.</p>'}</div></section></div>` : ''}`;
          if (r.before && document.getElementById('fx-chart')) {
            const labels = r.series.before.map(x => x.d).concat(r.series.after.map(x => x.d));
            const nb = r.series.before.length;
            chart('fx-chart', { type: 'bar', data: { labels, datasets: [
              { label: 'Before', data: labels.map((d, i) => i < nb ? r.series.before[i].clicks : null), backgroundColor: cssVar('--line') || '#CBD5E1' },
              { label: 'After', data: labels.map((d, i) => i >= nb ? r.series.after[i - nb].clicks : null), backgroundColor: cssVar('--signal') || '#4F46E5' }] },
              options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Clicks' } } } } });
          }
        }).catch(err => { if (box.isConnected) box.innerHTML = `<div class="note warn" role="alert">${esc(err.message)}</div>`; });
      }
    };
    return { html: body, mount };
  };
})();

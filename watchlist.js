// Watchlist: starred searches and pages, kept in this browser per site (localStorage). The Watchlist page and the
// Dashboard card read the rows the analysis already holds and compare with the previous period when one is loaded.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const CW = window.CW, fmtN = CW.fmtN;
  const key = () => 'cw:watch:' + ((window.CW_STATE && window.CW_STATE.D && window.CW_STATE.D.site) || 'site');
  const read = () => { try { const v = JSON.parse(localStorage.getItem(key())); return Array.isArray(v) ? v.filter(x => x && (x.t === 'q' || x.t === 'p') && typeof x.k === 'string').slice(0, 200) : []; } catch (e) { return []; } };
  const write = l => { try { localStorage.setItem(key(), JSON.stringify(l)); } catch (e) { } };
  const has = (t, k) => read().some(x => x.t === t && x.k === k);
  function toggle(t, k) { const l = read(), i = l.findIndex(x => x.t === t && x.k === k); if (i >= 0) l.splice(i, 1); else l.push({ t, k }); write(l); return i < 0; }
  const star = (t, k) => `<button type="button" class="wl-star${has(t, k) ? ' on' : ''}" data-wl-t="${t}" data-wl-k="${esc(k)}" aria-label="Watch" title="Add to watchlist">${has(t, k) ? '★' : '☆'}</button>`;
  // one click handler for every star on a page
  function bindStars(root, after) {
    if (!root) return;
    root.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.wl-star'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const on = toggle(b.dataset.wlT, b.dataset.wlK); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆';
      if (after) after();
    });
  }
  const pct = (a, b) => b ? (a - b) / b * 100 : null;
  function items(A, D) {
    const f = D.C && D.prevC && D.prevC.length ? D.C.length / D.prevC.length : 1;
    const idx = { q: new Map(A.Q.map(r => [r.q, r])), p: new Map(A.P.map(r => [r.p, r])) };
    const pidx = { q: new Map((D.prevQ || []).map(r => [r.q, r])), p: new Map((D.prevP || []).map(r => [r.p, r])) };
    const S = window.CW_SPIKES;
    return read().map(w => {
      const c = idx[w.t].get(w.k), p0 = pidx[w.t].get(w.k), p = p0 ? { clicks: p0.clicks * f, impr: p0.impr * f, ctr: p0.ctr, pos: p0.pos } : null;
      return { ...w, label: w.t === 'p' ? (c && c.path) || CW.pathOf(w.k) : w.k, c, p, s: c && S ? S.signal(c, p) : null };
    });
  }
  const chip = (v, inv) => v == null || !isFinite(v) ? '<span class="flat">—</span>' : `<span class="dw-pill ${(inv ? v < 0 : v > 0) ? 'up' : 'dn'}">${v > 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
  const rowsHtml = (list, remove) => list.map(x => { const c = x.c;
    return `<tr><td class="sp-q" title="${esc(x.label)}">${esc(x.label)}<small class="flat"> ${x.t === 'q' ? 'search' : 'page'}</small></td>${c ? `<td class="r num">${fmtN(c.clicks)}</td><td class="r">${x.p ? chip(pct(c.clicks, x.p.clicks)) : '<span class="flat">—</span>'}</td><td class="r num">${fmtN(c.impr)}</td><td class="r num">${c.pos != null ? c.pos.toFixed(1) : '—'}</td><td class="r">${x.p && x.p.pos ? chip(pct(c.pos, x.p.pos), true) : '<span class="flat">—</span>'}</td><td>${x.s ? `<span class="dw-pill ${x.s.up ? 'up' : 'dn'}">${esc(x.s.label)}</span>` : ''}</td>` : '<td colspan="6" class="flat">Not in this data (no impressions in the period)</td>'}${remove ? `<td class="r">${star(x.t, x.k)}</td>` : ''}</tr>`; }).join('');

  V.watchlist = (A, D) => {
    const list = items(A, D);
    const head = ui.head('Watchlist', 'Searches and pages you star in the Spike Scanner or the Pages map, tracked in one place. Saved in this browser, for this site only.');
    const opts = A.Q.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 500).map(r => `<option value="${esc(r.q)}">`).join('') + A.P.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 300).map(r => `<option value="${esc(r.path || CW.pathOf(r.p))}">`).join('');
    const html = head + `<section class="panel"><div class="panel-b"><div class="sp-ctl"><input id="wl-in" list="wl-opts" type="search" placeholder="Add a search or a page path…" aria-label="Add to watchlist"><button type="button" class="btn-primary sm" id="wl-add">Add</button><span class="flat" id="wl-msg"></span></div><datalist id="wl-opts">${opts}</datalist></div></section>
      <section class="panel"><div class="tw"><table class="sp-t"><thead><tr><th scope="col">Item</th><th class="r" scope="col">Clicks</th><th class="r" scope="col">vs before</th><th class="r" scope="col">Impressions</th><th class="r" scope="col">Avg pos</th><th class="r" scope="col">Pos change</th><th scope="col">Signal</th><th class="r" scope="col"><span class="sr">Remove</span></th></tr></thead><tbody id="wl-body">${list.length ? rowsHtml(list, true) : '<tr><td colspan="8" class="empty">Nothing watched yet. Star items with ☆ in the Spike Scanner or the Pages map, or add one above.</td></tr>'}</tbody></table></div></section>`;
    return { html, mount: () => {
      const re = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      bindStars(document.getElementById('view'), re);
      const add = () => {
        const v = document.getElementById('wl-in').value.trim(), m = document.getElementById('wl-msg'); if (!v) return;
        const q = A.Q.find(r => r.q === v), p = A.P.find(r => r.p === v || r.path === v || CW.pathOf(r.p) === v);
        if (q) toggleIfNew('q', q.q); else if (p) toggleIfNew('p', p.p); else { m.textContent = 'Not found in this data. Pick one from the list.'; return; }
        re();
      };
      const toggleIfNew = (t, k) => { if (!has(t, k)) toggle(t, k); };
      document.getElementById('wl-add').addEventListener('click', add);
      document.getElementById('wl-in').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    } };
  };
  window.CW_WATCH = { read, has, toggle, star, bindStars, items, rowsHtml,
    card(A, D) { const list = items(A, D).slice(0, 8); return `<section class="db-card"><div class="db-h"><h2>Watchlist</h2><a href="#watchlist">Manage</a></div>${list.length ? `<div class="tw"><table class="sp-t"><tbody>${list.map(x => `<tr><td class="sp-q" title="${esc(x.label)}">${esc(x.label)}</td>${x.c ? `<td class="r num">${fmtN(x.c.clicks)}</td><td class="r">${x.p ? chip(pct(x.c.clicks, x.p.clicks)) : ''}</td><td>${x.s ? `<span class="dw-pill ${x.s.up ? 'up' : 'dn'}">${esc(x.s.label)}</span>` : ''}</td>` : '<td colspan="3" class="flat">no data</td>'}</tr>`).join('')}</tbody></table></div>` : '<p class="empty">Star searches and pages to track them here.</p>'}</section>`; } };
})();

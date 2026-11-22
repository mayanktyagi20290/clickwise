// Pages map (#treemap): every page as a tile. Size is clicks, colour is the change against the previous period
// (or position band when there is no comparison). Tabs: All, Gainers, Losers, New pages. Pure HTML, no library.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const CW = window.CW, fmtN = CW.fmtN;

  // squarified layout of items [{v}] into a w×h box; returns rects in the same order as sorted input
  function squarify(items, w, h) {
    const tot = items.reduce((s, x) => s + x.v, 0), out = []; if (!tot) return out;
    const sc = w * h / tot, q = items.map(x => ({ x, a: x.v * sc }));
    let x0 = 0, y0 = 0, W = w, H = h, i = 0;
    const worst = (row, side) => { const s = row.reduce((t, r) => t + r.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
    while (i < q.length) {
      const side = Math.min(W, H); let row = [q[i]]; i++;
      while (i < q.length && worst(row.concat(q[i]), side) <= worst(row, side)) { row.push(q[i]); i++; }
      const s = row.reduce((t, r) => t + r.a, 0), th = s / side;
      let p = 0;
      row.forEach(r => { const len = r.a / th; if (W >= H) out.push({ it: r.x, x: x0, y: y0 + p, w: th, h: len }); else out.push({ it: r.x, x: x0 + p, y: y0, w: len, h: th }); p += len; });
      if (W >= H) { x0 += th; W -= th; } else { y0 += th; H -= th; }
    }
    return out;
  }

  function data(A, D) {
    const f = D.C && D.prevC && D.prevC.length ? D.C.length / D.prevC.length : 1, hasPrev = !!(D.prevP && D.prevP.length);
    const pm = new Map((D.prevP || []).map(r => [r.p, r]));
    return { hasPrev, rows: A.P.filter(r => r.clicks > 0).map(r => { const p = pm.get(r.p), was = p ? p.clicks * f : null; return { p: r.p, label: r.path || CW.pathOf(r.p), clicks: r.clicks, pos: r.pos, was, d: was == null ? null : r.clicks - was, pc: was ? (r.clicks - was) / was * 100 : null, isNew: hasPrev && !p }; }) };
  }
  const colour = (x, hasPrev) => {
    if (!hasPrev) return x.pos <= 5 ? 'rgba(34,197,94,.5)' : x.pos <= 10 ? 'rgba(132,204,22,.45)' : x.pos <= 20 ? 'rgba(234,179,8,.45)' : 'rgba(239,68,68,.45)';
    if (x.isNew) return 'rgba(56,189,248,.5)';
    if (x.pc == null || Math.abs(x.pc) < .5) return 'rgba(148,163,184,.28)';
    const a = (.25 + Math.min(1, Math.abs(x.pc) / 80) * .55).toFixed(2); return `rgba(${x.pc > 0 ? '34,197,94' : '239,68,68'},${a})`;
  };

  function mapHtml(A, D, o) {
    o = o || {}; const { hasPrev, rows } = data(A, D), tab = hasPrev ? o.tab || 'all' : 'all', W = 1000, H = o.h || 460;
    let list = rows;
    if (tab === 'gain') list = rows.filter(x => x.d > 0).map(x => ({ ...x, v: x.d }));
    else if (tab === 'lose') list = rows.filter(x => x.d < 0).map(x => ({ ...x, v: -x.d }));
    else if (tab === 'new') list = rows.filter(x => x.isNew).map(x => ({ ...x, v: x.clicks }));
    else list = rows.map(x => ({ ...x, v: x.clicks }));
    list = list.sort((a, b) => b.v - a.v).slice(0, o.max || 60);
    if (!list.length) return '<p class="empty">Nothing to show for this tab.</p>';
    const all = squarify(list, W, H), R = all.filter(r => r.w > 70 && r.h > 34), WL = window.CW_WATCH, hid = all.length - R.length;
    return `<div class="tm-map" style="height:${H}px">${R.map(r => { const x = r.it, big = r.w > 110 && r.h > 54, mid = r.w > 70 && r.h > 34;
      const chg = x.isNew ? 'New' : x.pc != null ? (x.pc > 0 ? '+' : '') + x.pc.toFixed(0) + '%' : '';
      return `<a class="tm-t" href="${esc(x.p)}" target="_blank" rel="noopener" title="${esc(x.label)}: ${fmtN(x.clicks)} clicks${x.was != null ? `, before ${fmtN(Math.round(x.was))}` : ''}, position ${x.pos.toFixed(1)}" style="left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%;background:${colour(x, hasPrev)}">${mid ? `<b style="padding-right:16px">${esc(x.label.length > 26 ? (x.label.split('/').filter(Boolean).pop() || x.label).slice(0, 26) : x.label)}</b><span class="num">${fmtN(x.clicks)}${chg ? ' · ' + chg : ''}</span>` : ''}${big && WL ? WL.star('p', x.p) : ''}</a>`; }).join('')}</div>${hid > 0 ? `<p class="flat" style="margin:8px 2px 0">${hid} smaller page${hid > 1 ? 's' : ''} not drawn. Switch to Table to see every page.</p>` : ''}`;
  }

  function tableHtml(A, D, o) {
    const { hasPrev, rows } = data(A, D); let l = rows.slice();
    if (o.tab === 'gain') l = l.filter(x => x.d > 0); else if (o.tab === 'lose') l = l.filter(x => x.d < 0); else if (o.tab === 'new') l = l.filter(x => x.isNew);
    const q = (o.q || '').toLowerCase(); if (q) l = l.filter(x => x.label.toLowerCase().includes(q));
    const key = o.sort || 'clicks', dir = o.dir === 'asc' ? 1 : -1, val = x => key === 'label' ? x.label : key === 'd' ? (x.d == null ? -1e9 : x.d) : key === 'pc' ? (x.pc == null ? -1e9 : x.pc) : key === 'pos' ? x.pos : x.clicks;
    l.sort((a, b) => { const A1 = val(a), B1 = val(b); return (A1 < B1 ? -1 : A1 > B1 ? 1 : 0) * dir * (key === 'label' ? -1 : 1); });
    const mx = Math.max(1, ...l.map(x => Math.abs(x.d || 0))), WL = window.CW_WATCH;
    const th = (k, t, r) => `<th class="${r ? 'r ' : ''}" scope="col"><button type="button" class="tm-sort" data-sort="${k}">${t}${key === k ? (dir === -1 ? ' ▼' : ' ▲') : ''}</button></th>`;
    return `<div class="tw"><table class="sp-t"><thead><tr>${th('label', 'Page')}${th('clicks', 'Clicks', 1)}${hasPrev ? '<th class="r" scope="col">Before</th>' + th('d', 'Change', 1) + th('pc', 'Change %', 1) : ''}${th('pos', 'Avg pos', 1)}</tr></thead><tbody>${l.slice(0, 200).map(x => `<tr><td class="sp-q" title="${esc(x.label)}">${WL ? WL.star('p', x.p) + ' ' : ''}<a href="${esc(x.p)}" target="_blank" rel="noopener">${esc(x.label)}</a></td><td class="r num">${fmtN(x.clicks)}</td>${hasPrev ? `<td class="r num flat">${x.was != null ? fmtN(Math.round(x.was)) : '—'}</td><td class="r num"${x.d ? ` data-h="${x.d > 0 ? 'g' : 'r'}" style="--a:${(.12 + Math.min(1, Math.abs(x.d) / mx) * .5).toFixed(2)}"` : ''}>${x.isNew ? 'New' : x.d == null ? '—' : (x.d > 0 ? '+' : '') + fmtN(Math.round(x.d))}</td><td class="r num">${x.pc != null ? (x.pc > 0 ? '+' : '') + x.pc.toFixed(0) + '%' : '—'}</td>` : ''}<td class="r num">${x.pos != null ? x.pos.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>${l.length ? '' : '<p class="empty">Nothing matches.</p>'}`;
  }

  V.treemap = (A, D) => {
    const { hasPrev } = data(A, D); let tab = 'all', view = 'map', q = '', sort = 'clicks', dir = 'desc';
    const tabs = [['all', 'All pages'], ['gain', 'Gainers'], ['lose', 'Losers'], ['new', 'New pages']];
    const html = ui.head('Pages map', 'Every page as a tile: size is clicks, colour is the change against the previous period. Tile text shows clicks and change. Click a tile to open the page, ☆ to watch it.')
      + `<section class="panel"><div class="panel-h"><div class="db-tabs" role="tablist" aria-label="View"><button type="button" class="on" data-vw="map">Map</button><button type="button" data-vw="tbl">Table</button></div><div class="db-tabs" role="tablist">${tabs.map(t => `<button type="button" data-tm="${t[0]}" class="${t[0] === 'all' ? 'on' : ''}"${!hasPrev && t[0] !== 'all' ? ' disabled title="Needs a comparison period"' : ''}>${t[1]}</button>`).join('')}</div>
      <input type="search" id="tm-q" placeholder="Filter pages" hidden style="background:var(--sunk);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit"><span class="flat" id="tm-note">${hasPrev ? 'Green up, red down, blue new · Gainers and Losers are sized by clicks gained or lost' : 'No comparison period loaded: colour shows position (green top 5, red below 20)'}</span></div><div class="panel-b" id="tm-host">${mapHtml(A, D, { tab: 'all' })}</div></section>`;
    return { html, mount: () => {
      const v = document.getElementById('view'), host = document.getElementById('tm-host');
      const draw = () => { host.innerHTML = view === 'map' ? mapHtml(A, D, { tab }) : tableHtml(A, D, { tab, q, sort, dir }); if (window.CW_WATCH) window.CW_WATCH.bindStars(host); host.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.sort; dir = sort === k && dir === 'desc' ? 'asc' : 'desc'; sort = k; draw(); })); };
      v.querySelectorAll('[data-tm]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tm; v.querySelectorAll('[data-tm]').forEach(x => x.classList.toggle('on', x === b)); draw(); }));
      v.querySelectorAll('[data-vw]').forEach(b => b.addEventListener('click', () => { view = b.dataset.vw; v.querySelectorAll('[data-vw]').forEach(x => x.classList.toggle('on', x === b)); document.getElementById('tm-q').hidden = view !== 'tbl'; document.getElementById('tm-note').hidden = view !== 'map'; draw(); }));
      document.getElementById('tm-q').addEventListener('input', e => { q = e.target.value; draw(); });
      if (window.CW_WATCH) window.CW_WATCH.bindStars(host);
    } };
  };
  window.CW_TREEMAP = { html: mapHtml, squarify };
})();

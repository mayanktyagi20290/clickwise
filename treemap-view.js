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
    const R = squarify(list, W, H), WL = window.CW_WATCH;
    return `<div class="tm-map" style="height:${H}px">${R.map(r => { const x = r.it, big = r.w > 110 && r.h > 54, mid = r.w > 70 && r.h > 34;
      const chg = x.isNew ? 'New' : x.pc != null ? (x.pc > 0 ? '+' : '') + x.pc.toFixed(0) + '%' : '';
      return `<a class="tm-t" href="${esc(x.p)}" target="_blank" rel="noopener" title="${esc(x.label)}: ${fmtN(x.clicks)} clicks${x.was != null ? `, before ${fmtN(Math.round(x.was))}` : ''}, position ${x.pos.toFixed(1)}" style="left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%;background:${colour(x, hasPrev)}">${mid ? `<b>${esc(x.label.length > 26 ? (x.label.split('/').filter(Boolean).pop() || x.label).slice(0, 26) : x.label)}</b><span class="num">${fmtN(x.clicks)}${chg ? ' · ' + chg : ''}</span>` : ''}${big && WL ? WL.star('p', x.p) : ''}</a>`; }).join('')}</div>`;
  }

  V.treemap = (A, D) => {
    const { hasPrev } = data(A, D); let tab = 'all';
    const tabs = [['all', 'All pages'], ['gain', 'Gainers'], ['lose', 'Losers'], ['new', 'New pages']];
    const html = ui.head('Pages map', 'Every page as a tile: size is clicks, colour is the change against the previous period. Tile text shows clicks and change. Click a tile to open the page, ☆ to watch it.')
      + `<section class="panel"><div class="panel-h"><div class="db-tabs" role="tablist">${tabs.map(t => `<button type="button" data-tm="${t[0]}" class="${t[0] === 'all' ? 'on' : ''}"${!hasPrev && t[0] !== 'all' ? ' disabled title="Needs a comparison period"' : ''}>${t[1]}</button>`).join('')}</div>
      <span class="flat">${hasPrev ? 'Green up, red down, blue new · Gainers and Losers are sized by clicks gained or lost' : 'No comparison period loaded: colour shows position (green top 5, red below 20)'}</span></div><div class="panel-b" id="tm-host">${mapHtml(A, D, { tab: 'all' })}</div></section>`;
    return { html, mount: () => {
      const v = document.getElementById('view'), host = document.getElementById('tm-host');
      v.querySelectorAll('[data-tm]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tm; v.querySelectorAll('[data-tm]').forEach(x => x.classList.toggle('on', x === b)); host.innerHTML = mapHtml(A, D, { tab }); }));
      if (window.CW_WATCH) window.CW_WATCH.bindStars(host);
    } };
  };
  window.CW_TREEMAP = { html: mapHtml, squarify };
})();

// Calendar (#calendar): one month at a time, each day tinted by clicks against the day before, with your own notes
// (a title rewrite, a new page, a release) saved in this browser per site. Click a day for its detail.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const CW = window.CW, fmtN = CW.fmtN;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const nkey = () => 'cw:notes:' + ((window.CW_STATE && window.CW_STATE.D && window.CW_STATE.D.site) || 'site');
  const readN = () => { try { const v = JSON.parse(localStorage.getItem(nkey())); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
  const writeN = n => { try { localStorage.setItem(nkey(), JSON.stringify(n)); } catch (e) { } };
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };
  const go = (m, d) => { const p = new URLSearchParams(); if (m) p.set('m', m); if (d) p.set('d', d); location.hash = '#calendar' + (p.toString() ? '?' + p.toString() : ''); };

  V.calendar = (A, D) => {
    const C = (D.C || []).slice().sort((a, b) => a.d.localeCompare(b.d)), by = new Map(C.map((r, i) => [r.d, { ...r, prev: C[i - 1] && Math.round((new Date(r.d) - new Date(C[i - 1].d)) / 864e5) === 1 ? C[i - 1] : null }]));
    const last = C.length ? C[C.length - 1].d : today(), p = params();
    let ym = /^\d{4}-\d{2}$/.test(p.get('m') || '') ? p.get('m') : last.slice(0, 7);
    const [Y, M] = ym.split('-').map(Number), m0 = M - 1, first = new Date(Y, m0, 1), dim = new Date(Y, m0 + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
    const sel = /^\d{4}-\d{2}-\d{2}$/.test(p.get('d') || '') ? p.get('d') : null, notes = readN(), t = today();
    const nav = n => { const d = new Date(Y, m0 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-c off"></div>');
    for (let d = 1; d <= dim; d++) {
      const k = iso(Y, m0, d), r = by.get(k), n = notes[k] || [];
      let tint = '';
      if (r && r.prev && r.prev.clicks) { const c = (r.clicks - r.prev.clicks) / r.prev.clicks * 100, a = (.1 + Math.min(1, Math.abs(c) / 40) * .45).toFixed(2); tint = ` style="background:rgba(${c >= 0 ? '34,197,94' : '239,68,68'},${a})"`; }
      cells.push(`<button type="button" class="cal-c${r ? ' has' : ' fut'}${k === t ? ' today' : ''}${k === sel ? ' sel' : ''}" data-d="${k}"${tint}><span class="cal-n">${d}</span>${r ? `<b class="num">${fmtN(r.clicks)}</b>` : ''}${n.length ? `<i class="cal-dot" title="${n.length} note${n.length > 1 ? 's' : ''}"></i>` : ''}</button>`);
    }
    const selR = sel && by.get(sel), selN = sel ? notes[sel] || [] : [];
    const monthNotes = Object.keys(notes).filter(k => k.startsWith(ym)).sort().flatMap(k => notes[k].map(x => [k, x]));
    const html = ui.head('Calendar', 'Each day is tinted by clicks against the day before (green up, red down). Click a day to see what happened, and add notes about what you changed.') + `
      <div class="cal-wrap"><section class="panel cal-main"><div class="panel-h"><div class="cal-nav"><button type="button" class="btn-quiet" id="cal-prev" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2><button type="button" class="btn-quiet" id="cal-next" aria-label="Next month">›</button></div><button type="button" class="btn-primary sm" id="cal-today">Today</button></div>
      <div class="panel-b"><div class="cal-g">${WD.map(w => `<div class="cal-h">${w}</div>`).join('')}${cells.join('')}</div>
      <p class="db-note"><i class="t-a"></i>up on day before <i class="t-d"></i>down <i class="cal-dot"></i>has a note · numbers are clicks</p></div></section>
      <aside class="panel cal-side"><div class="panel-h"><h2>${sel ? esc(sel) : 'Notes this month'}</h2></div><div class="panel-b">
        ${sel ? `${selR ? `<p class="cal-sum"><b class="num">${fmtN(selR.clicks)}</b> clicks · <span class="num">${fmtN(selR.impr)}</span> impressions${selR.prev ? ` · <a href="#stats?tab=daywise&day=${esc(sel)}">What happened →</a>` : ''}</p>` : '<p class="flat">No data for this day.</p>'}
        ${selN.map((x, i) => `<div class="cal-note"><span>${esc(x)}</span><button type="button" class="wl-star" data-del="${i}" aria-label="Delete note" title="Delete">✕</button></div>`).join('') || '<p class="flat">No notes yet.</p>'}
        <div class="cal-add"><input id="cal-in" type="text" maxlength="160" placeholder="Add a note, e.g. rewrote titles on /blog" aria-label="Note"><button type="button" class="btn-primary sm" id="cal-save">Add</button></div>`
        : (monthNotes.map(([k, x]) => `<div class="cal-note"><span><b>${esc(k.slice(8))}</b> ${esc(x)}</span></div>`).join('') || '<p class="flat">No notes this month. Click a day to add one.</p>')}
      </div></aside></div>`;
    return { html, mount: () => {
      const v = document.getElementById('view');
      document.getElementById('cal-prev').addEventListener('click', () => go(nav(-1), null));
      document.getElementById('cal-next').addEventListener('click', () => go(nav(1), null));
      document.getElementById('cal-today').addEventListener('click', () => go(t.slice(0, 7), t));
      v.querySelectorAll('.cal-c[data-d]').forEach(b => b.addEventListener('click', () => go(ym, b.dataset.d)));
      if (!sel) return;
      const add = () => { const el = document.getElementById('cal-in'), x = el.value.trim(); if (!x) return; const n = readN(); (n[sel] = n[sel] || []).push(x.slice(0, 160)); writeN(n); go(ym, sel); };
      document.getElementById('cal-save').addEventListener('click', add);
      document.getElementById('cal-in').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
      v.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const n = readN(); (n[sel] || []).splice(+b.dataset.del, 1); if (!(n[sel] || []).length) delete n[sel]; writeN(n); go(ym, sel); }));
    } };
  };
  window.CW_NOTES = { read: readN };
})();

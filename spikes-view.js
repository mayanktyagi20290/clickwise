// Spike Scanner (#spikes): searches and pages compared with the previous period (scaled to the same length),
// each row tagged with a signal: click surge or drop, impression jump or fall, CTR fall or jump, position drop
// or gain, new or lost. Uses the rows and comparison period already loaded; nothing is fetched or stored here.
(function () {
  'use strict';
  if (!window.CW_VIEWS) return;
  const { V, esc, ui } = window.CW_VIEWS;
  const { head } = ui;
  const CW = window.CW, fmtN = CW.fmtN;
  const pct = (a, b) => b ? (a - b) / b * 100 : null;
  const MIN = { clicks: 5, impr: 100 };

  // the signal for one row; null when nothing stands out
  function signal(c, p) {
    if (!p) return c.clicks >= MIN.clicks ? { k: 'new', label: 'New in results', up: true } : null;
    const dc = c.clicks - p.clicks, cp = pct(c.clicks, p.clicks), ip = pct(c.impr, p.impr), ctrd = c.ctr - p.ctr, dpos = c.pos - p.pos;
    if (Math.max(c.clicks, p.clicks) >= MIN.clicks && cp != null) {
      if (cp >= 50 && dc >= 3) return { k: 'surge', label: 'Click surge', up: true };
      if (cp <= -40 && dc <= -3) {
        if (ip != null && ip > -15 && p.ctr && ctrd / p.ctr <= -.25) return { k: 'ctrfall', label: 'CTR fall', up: false };
        if (dpos >= 2) return { k: 'posdrop', label: 'Position drop', up: false };
        return { k: 'drop', label: 'Click drop', up: false };
      }
    }
    if (Math.max(c.impr, p.impr) >= MIN.impr && ip != null) {
      if (ip >= 60) return { k: 'imprup', label: 'Impression jump', up: true };
      if (ip <= -50) return { k: 'imprdn', label: 'Impression fall', up: false };
    }
    if (c.impr >= MIN.impr && p.ctr && ctrd / p.ctr <= -.3 && c.clicks < p.clicks) return { k: 'ctrfall', label: 'CTR fall', up: false };
    if (c.impr >= MIN.impr && dpos <= -3) return { k: 'posup', label: 'Position gain', up: true };
    if (c.impr >= MIN.impr && dpos >= 3) return { k: 'posdrop', label: 'Position drop', up: false };
    return null;
  }

  function build(rows, prevRows, key, f) {
    const pm = new Map((prevRows || []).map(r => [r[key], r])), seen = new Set(), out = [];
    rows.forEach(r => {
      const p0 = pm.get(r[key]); seen.add(r[key]);
      const p = p0 ? { clicks: p0.clicks * f, impr: p0.impr * f, ctr: p0.ctr, pos: p0.pos } : null;
      const s = signal(r, p);
      out.push({ k: r[key], label: key === 'p' ? (r.path || CW.pathOf(r.p)) : r.q, c: r, p, s, d: r.clicks - (p ? p.clicks : 0) });
    });
    (prevRows || []).forEach(p0 => {
      if (seen.has(p0[key]) || p0.clicks * f < 8) return;
      const p = { clicks: p0.clicks * f, impr: p0.impr * f, ctr: p0.ctr, pos: p0.pos }, c = { clicks: 0, impr: 0, ctr: 0, pos: null };
      out.push({ k: p0[key], label: key === 'p' ? CW.pathOf(p0.p) : p0.q, c, p, s: { k: 'lost', label: 'Lost from results', up: false }, d: -p.clicks });
    });
    return out;
  }

  const heat = (v, max) => { if (v == null || !isFinite(v) || !v) return ''; const a = (.1 + Math.min(1, Math.abs(v) / max) * .5).toFixed(2); return ` style="background:rgba(${v > 0 ? '34,197,94' : '239,68,68'},${a})"`; };
  const sgn = (v, dp) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(dp);
  const KINDS = [['', 'All signals'], ['surge', 'Click surge'], ['drop', 'Click drop'], ['imprup', 'Impression jump'], ['imprdn', 'Impression fall'], ['ctrfall', 'CTR fall'], ['posdrop', 'Position drop'], ['posup', 'Position gain'], ['new', 'New in results'], ['lost', 'Lost from results']];

  V.spikes = (A, D) => {
    const title = 'Spike Scanner', sub = 'Searches and pages that moved the most against the previous period, with the signal behind each move. The previous period is scaled to the same length.';
    if (!(D.prevQ && D.prevQ.length)) return { html: head(title, sub) + '<section class="panel"><p class="empty">No comparison period is loaded, so there is nothing to compare. Choose dates with a compare period (Google sign-in), or upload an export that includes one.</p></section>' };
    const f = D.C && D.prevC && D.prevC.length ? D.C.length / D.prevC.length : 1;
    const sets = { q: build(A.Q, D.prevQ, 'q', f), p: D.prevP && D.prevP.length ? build(A.P, D.prevP, 'p', f) : [] };
    const st = { tab: 'q', kind: '', text: '', limit: 100 };
    const cards = list => list.filter(x => x.s).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5).map(x => `<div class="sp-card ${x.s.up ? 'up' : 'dn'}"><span class="sp-n" title="${esc(x.label)}">${esc(x.label)}</span><b class="num">${x.d > 0 ? '+' : ''}${fmtN(Math.round(x.d))} clicks</b><em>${esc(x.s.label)}</em></div>`).join('');
    const html = head(title, sub) + `<div class="sp-ctl"><div class="seg" role="tablist"><button type="button" class="on" data-tab="q">Searches</button><button type="button" data-tab="p">Pages</button></div>
      <label class="ow-f"><span>Signal</span><select id="sp-kind">${KINDS.map(k => `<option value="${k[0]}">${k[1]}</option>`).join('')}</select></label>
      <input id="sp-text" type="search" placeholder="Filter searches or pages…" aria-label="Filter"><span class="flat" id="sp-count"></span></div>
      <div class="sp-cards" id="sp-cards"></div>
      <section class="panel"><div class="tw"><table class="sp-t"><thead><tr><th scope="col">Search / page</th><th class="r" scope="col">Clicks</th><th class="r" scope="col">Before</th><th class="r" scope="col">Change</th><th class="r" scope="col">Impr %</th><th class="r" scope="col">CTR</th><th class="r" scope="col">Avg pos</th><th scope="col">Signal</th></tr></thead><tbody id="sp-body"></tbody></table></div>
      <p class="sp-more"><button type="button" class="btn-quiet" id="sp-more">Show more</button></p>
      <p class="flat dw-n">Signals need at least ${MIN.clicks} clicks or ${MIN.impr} impressions in one of the periods. Rows without a signal are still listed, by size of change.</p></section>`;
    return { html, mount: () => {
      const body = document.getElementById('sp-body'), v = document.getElementById('view');
      const draw = () => {
        const all = sets[st.tab], t = st.text.trim().toLowerCase();
        const list = all.filter(x => (!st.kind || (x.s && x.s.k === st.kind)) && (!t || x.label.toLowerCase().includes(t))).sort((a, b) => (!!b.s - !!a.s) || Math.abs(b.d) - Math.abs(a.d));
        const mx = Math.max(1, ...list.slice(0, 100).map(x => Math.abs(x.d)));
        document.getElementById('sp-cards').innerHTML = cards(all);
        document.getElementById('sp-count').textContent = `${fmtN(list.length)} rows${st.tab === 'p' && !all.length ? ' (no previous page data)' : ''}`;
        body.innerHTML = list.slice(0, st.limit).map(x => { const ip = x.p ? pct(x.c.impr, x.p.impr) : null, ctrd = x.p ? x.c.ctr - x.p.ctr : null, dp = x.p && x.c.pos != null && x.p.pos != null ? x.c.pos - x.p.pos : null;
          return `<tr><td class="sp-q" title="${esc(x.label)}">${esc(x.label)}</td><td class="r num">${fmtN(x.c.clicks)}</td><td class="r num flat">${x.p ? fmtN(Math.round(x.p.clicks)) : '—'}</td><td class="r num"${heat(x.d, mx)}>${sgn(x.d, 0)}</td><td class="r num"${heat(ip, 100)}>${ip == null ? '—' : sgn(ip, 0) + '%'}</td><td class="r num"${heat(ctrd, 2)}>${x.c.impr ? x.c.ctr.toFixed(2) + '%' : '—'}</td><td class="r num"${heat(dp == null ? null : -dp, 5)}>${x.c.pos != null ? x.c.pos.toFixed(1) : '—'}</td><td>${x.s ? `<span class="dw-pill ${x.s.up ? 'up' : 'dn'}">${esc(x.s.label)}</span>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nothing matches.</td></tr>';
        document.getElementById('sp-more').hidden = list.length <= st.limit;
      };
      v.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { st.tab = b.dataset.tab; st.limit = 100; v.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); draw(); }));
      document.getElementById('sp-kind').addEventListener('change', e => { st.kind = e.target.value; st.limit = 100; draw(); });
      document.getElementById('sp-text').addEventListener('input', e => { st.text = e.target.value; st.limit = 100; draw(); });
      document.getElementById('sp-more').addEventListener('click', () => { st.limit += 200; draw(); });
      draw();
    } };
  };
  window.CW_SPIKES = { signal, build };
})();

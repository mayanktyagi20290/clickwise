// Why did traffic change? (#why): one screen that answers "what happened and why" for the chosen dates against the
// compare period. It splits the change into impressions and CTR, brand and non-brand, brand names, site sections,
// landing pages and searches, tags each loser with a likely cause, and writes a plain-text answer to paste into a
// report or an email. Uses the rows and comparison period already loaded; nothing is fetched or stored here.
(function () {
  'use strict';
  const CW = window.CW, fmtN = CW.fmtN;
  const pct = (a, b) => b ? (a - b) / b * 100 : null;
  const sgn = (v, dp) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp == null ? (Math.abs(v) < 10 ? 1 : 0) : dp) + '%';
  const sn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v));
  const ZERO = { clicks: 0, impr: 0, ctr: 0, pos: null };

  // ── likely cause for one row (a search or a page): c = now, p = before scaled to the same length ──
  function cause(c, p) {
    c = c || ZERO;
    if (!p) return c.clicks > 0 ? { k: 'new', label: 'New: not in the previous period', up: true } : null;
    const d = c.clicks - p.clicks, ip = pct(c.impr, p.impr), dpos = c.pos != null && p.pos != null ? c.pos - p.pos : null;
    if (d < 0) {
      if (c.impr <= p.impr * .25) return { k: 'gone', label: 'Dropped out or demand ended', up: false };
      if (dpos != null && dpos >= 2) return { k: 'rank', label: `Rank slipped (${p.pos.toFixed(1)} → ${c.pos.toFixed(1)})`, up: false };
      if (ip != null && ip <= -30) return { k: 'demand', label: 'Fewer impressions (demand or visibility)', up: false };
      if (p.ctr && (c.ctr - p.ctr) / p.ctr <= -.25) return { k: 'ctr', label: 'CTR fell at similar rank', up: false };
      return { k: 'mixed', label: 'Smaller drops in rank and CTR', up: false };
    }
    if (d > 0) {
      if (ip != null && ip >= 30) return { k: 'imprup', label: 'More impressions', up: true };
      if (dpos != null && dpos <= -2) return { k: 'rankup', label: `Rank improved (${p.pos.toFixed(1)} → ${c.pos.toFixed(1)})`, up: true };
      return { k: 'grow', label: 'Higher CTR or steady growth', up: true };
    }
    return null;
  }

  const terms = A => {
    const m = /^\\b\((.*)\)\\b$/.exec(A.brandRx || '');
    return m ? m[1].split('|').map(s => s.replace(/\\(.)/g, '$1')).filter(t => t && t !== 'yourbrand') : [];
  };
  const sumRows = rows => {
    let clicks = 0, impr = 0, pw = 0;
    rows.forEach(r => { clicks += r.clicks; impr += r.impr; pw += (r.pos || 0) * r.impr; });
    return { clicks, impr, pos: impr ? pw / impr : null };
  };
  const scaled = (r, f) => ({ clicks: r.clicks * f, impr: r.impr * f, ctr: r.ctr, pos: r.pos });
  const mondayOf = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

  // join current and previous rows by key; each result: { k, label, c, p, d, s }
  function join(cur, prev, key, f, label) {
    const pm = new Map((prev || []).map(r => [r[key], r])), seen = new Set(), out = [];
    cur.forEach(r => {
      const p0 = pm.get(r[key]); seen.add(r[key]);
      const p = p0 ? scaled(p0, f) : null;
      out.push({ k: r[key], label: label(r), c: r, p, d: r.clicks - (p ? p.clicks : 0), s: cause(r, p), brand: r.brand });
    });
    (prev || []).forEach(p0 => {
      if (seen.has(p0[key])) return;
      const p = scaled(p0, f);
      out.push({ k: p0[key], label: label(p0), c: ZERO, p, d: -p.clicks, s: cause(ZERO, p), brand: p0.brand });
    });
    return out;
  }

  function sectionKey(path) { const seg = String(path).split('?')[0].split('/').filter(Boolean)[0]; return seg ? '/' + seg + '/' : '/'; }

  function weekly(C) {
    const m = new Map();
    (C || []).forEach(r => {
      const w = mondayOf(r.d), x = m.get(w) || { w, clicks: 0, impr: 0, days: 0 };
      x.clicks += r.clicks; x.impr += r.impr; x.days++; m.set(w, x);
    });
    const out = [...m.values()].sort((a, b) => a.w < b.w ? -1 : 1);
    out.forEach(x => { x.partial = x.days < 7; });
    return out;
  }

  // ── the analysis ──
  function compute(A, D) {
    if (!(D && D.prevQ && D.prevQ.length)) return { ok: false };
    const curDays = (D.C && D.C.length) || D.days || 0, prevDays = (D.prevC && D.prevC.length) || 0;
    const f = curDays && prevDays ? curDays / prevDays : 1;
    const cur = A.site, pr0 = A.prevSite || CW.agg(D.prevQ);
    const prev = { clicks: pr0.clicks * f, impr: pr0.impr * f, pos: pr0.pos };
    prev.ctr = prev.impr ? prev.clicks / prev.impr * 100 : 0;
    const dClicks = cur.clicks - prev.clicks;
    const c0 = prev.impr ? prev.clicks / prev.impr : 0, c1 = cur.impr ? cur.clicks / cur.impr : 0;
    const eff = { impr: (cur.impr - prev.impr) * c0, ctr: cur.impr * (c1 - c0) };

    // brand split from the search rows; clicks the rows do not account for are shown as their own line
    const isB = A.isBrand, pQ = D.prevQ.map(r => ({ ...r, brand: isB(r.q) }));
    const cb = sumRows(A.Q.filter(r => r.brand)), cn = sumRows(A.Q.filter(r => !r.brand));
    const pb0 = sumRows(pQ.filter(r => r.brand)), pn0 = sumRows(pQ.filter(r => !r.brand));
    const pb = { clicks: pb0.clicks * f, impr: pb0.impr * f, pos: pb0.pos }, pn = { clicks: pn0.clicks * f, impr: pn0.impr * f, pos: pn0.pos };
    const hid = { cur: { clicks: Math.max(0, cur.clicks - cb.clicks - cn.clicks), impr: Math.max(0, cur.impr - cb.impr - cn.impr) },
      prev: { clicks: Math.max(0, prev.clicks - pb.clicks - pn.clicks), impr: Math.max(0, prev.impr - pb.impr - pn.impr) } };
    const split = [
      { k: 'brand', label: 'Brand searches', c: cb, p: pb },
      { k: 'nonbrand', label: 'Non-brand searches', c: cn, p: pn },
      { k: 'hidden', label: 'Not shown by Search Console (rare or private searches)', c: { ...hid.cur, pos: null }, p: { ...hid.prev, pos: null } }
    ].map(x => ({ ...x, d: x.c.clicks - x.p.clicks, share: dClicks ? (x.c.clicks - x.p.clicks) / dClicks * 100 : null }));

    // searches, brand names
    const queries = join(A.Q, pQ, 'q', f, r => r.q);
    const tl = terms(A), nameOf = q => { const l = String(q).toLowerCase(); return tl.find(t => l.includes(t.toLowerCase())) || 'Other brand spellings'; };
    const names = new Map();
    queries.filter(x => x.brand).forEach(x => {
      const n = nameOf(x.k), o = names.get(n) || { k: n, label: n, c: 0, p: 0, ci: 0, pi: 0, n: 0 };
      o.c += x.c.clicks; o.p += x.p ? x.p.clicks : 0; o.ci += x.c.impr; o.pi += x.p ? x.p.impr : 0; o.n++; names.set(n, o);
    });
    const brandNames = [...names.values()].map(o => ({ ...o, d: o.c - o.p })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const brandQueries = queries.filter(x => x.brand).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

    // pages and site sections
    const pP = (D.prevP || []).filter(r => !A.isExcluded(r.p)).map(r => ({ ...r, path: CW.pathOf(r.p) }));
    const pages = pP.length ? join(A.P, pP, 'p', f, r => r.path || CW.pathOf(r.p)) : [];
    const secMap = new Map();
    const addSec = (rows, side) => rows.forEach(r => {
      const k = sectionKey(r.path || CW.pathOf(r.p)), o = secMap.get(k) || { k, label: k, c: { clicks: 0, impr: 0, pw: 0 }, p: { clicks: 0, impr: 0, pw: 0 }, n: 0 };
      const t = o[side], m = side === 'p' ? f : 1;
      t.clicks += r.clicks * m; t.impr += r.impr * m; t.pw += (r.pos || 0) * r.impr * m; if (side === 'c') o.n++;
      secMap.set(k, o);
    });
    addSec(A.P, 'c'); addSec(pP, 'p');
    const sections = [...secMap.values()].map(o => ({
      k: o.k, label: o.label, n: o.n,
      c: { clicks: o.c.clicks, impr: o.c.impr, ctr: o.c.impr ? o.c.clicks / o.c.impr * 100 : 0, pos: o.c.impr ? o.c.pw / o.c.impr : null },
      p: { clicks: o.p.clicks, impr: o.p.impr, ctr: o.p.impr ? o.p.clicks / o.p.impr * 100 : 0, pos: o.p.impr ? o.p.pw / o.p.impr : null },
      d: o.c.clicks - o.p.clicks
    })).map(x => ({ ...x, s: cause(x.c, x.p), share: dClicks ? x.d / dClicks * 100 : null })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

    // how concentrated the loss is, and how much of it is pages or searches that dropped out
    const lossOf = list => { const l = list.filter(x => x.d < 0); const t = l.reduce((s, x) => s + x.d, 0); return { total: t, list: l.sort((a, b) => a.d - b.d) }; };
    const pl = lossOf(pages), ql = lossOf(queries);
    const top10 = pl.list.slice(0, 10).reduce((s, x) => s + x.d, 0);
    const gone = pl.list.filter(x => x.s && x.s.k === 'gone');
    const goneSum = gone.reduce((s, x) => s + x.d, 0);
    const concentration = { pageLoss: pl.total, top10Share: pl.total ? top10 / pl.total * 100 : null, goneN: gone.length, goneClicks: goneSum, goneShare: pl.total ? goneSum / pl.total * 100 : null };

    const wk = weekly(D.C), full = wk.filter(w => !w.partial);
    const peak = full.reduce((m, w) => !m || w.clicks > m.clicks ? w : m, null), last = full[full.length - 1] || null;
    const cov = A.coverage ? { q: A.coverage.q && A.coverage.q.clicks, p: A.coverage.p && A.coverage.p.clicks } : null;

    const res = { ok: true, f, cur, prev, dClicks, eff, split, brandNames, brandQueries, queries, pages, sections, concentration,
      weeks: wk, peak, last, cov, hasPages: pages.length > 0, hasSite: !!(D.C && D.C.length), hasPrevSite: !!A.prevSite, hasWeeks: wk.length > 1 };
    res.text = narrative(res);
    return res;
  }

  const nm = (x, n) => (x || []).slice(0, n);
  function narrative(R) {
    const L = [], { cur, prev, dClicks, eff, split } = R, dir = dClicks < 0 ? 'fell' : 'rose';
    const cc = pct(cur.clicks, prev.clicks);
    L.push(`Clicks ${dir} ${cc == null ? '' : Math.abs(cc).toFixed(0) + '% '}(${fmtN(prev.clicks)} → ${fmtN(cur.clicks)}) against the previous period${R.f !== 1 ? ', scaled to the same length' : ''}.`);
    L.push(`Impressions ${sgn(pct(cur.impr, prev.impr), 0)} (${fmtN(prev.impr)} → ${fmtN(cur.impr)}), CTR ${prev.ctr.toFixed(1)}% → ${cur.ctr.toFixed(1)}%, average position ${prev.pos != null ? prev.pos.toFixed(1) : '—'} → ${cur.pos != null ? cur.pos.toFixed(1) : '—'}. Impressions account for ${sn(eff.impr)} clicks and CTR for ${sn(eff.ctr)}.`);
    const b = split[0], n = split[1];
    L.push(`Brand searches: ${fmtN(b.p.clicks)} → ${fmtN(b.c.clicks)} clicks (${sgn(pct(b.c.clicks, b.p.clicks), 0)}${b.share != null ? `, ${Math.round(b.share)}% of the change` : ''}). Non-brand: ${fmtN(n.p.clicks)} → ${fmtN(n.c.clicks)} (${sgn(pct(n.c.clicks, n.p.clicks), 0)}${n.share != null ? `, ${Math.round(n.share)}% of the change` : ''}).`);
    const bn = nm(R.brandNames.filter(x => x.d), 2);
    if (bn.length) L.push(`Biggest brand-name moves: ${bn.map(x => `"${x.label}" ${sn(x.d)} clicks`).join('; ')}.`);
    const bq = nm(R.brandQueries.filter(x => x.d), 3);
    if (bq.length) L.push(`Biggest brand searches: ${bq.map(x => `"${x.label}" ${sn(x.d)}`).join('; ')}.`);
    const sec = nm(R.sections.filter(x => x.d && Math.sign(x.d) === Math.sign(dClicks)), 3);
    if (sec.length) L.push(`Sections driving the change: ${sec.map(x => `${x.label} ${sn(x.d)} clicks${x.share != null ? ` (${Math.round(x.share)}%)` : ''}`).join('; ')}.`);
    if (R.hasPages) {
      const lo = nm(R.pages.filter(x => x.d < 0).sort((a, b) => a.d - b.d), 3);
      if (lo.length) L.push(`Biggest losing pages: ${lo.map(x => `${x.label} ${sn(x.d)}${x.s ? ', ' + x.s.label.toLowerCase() : ''}`).join('; ')}.`);
      const k = R.concentration;
      if (k.pageLoss) L.push(`The ten biggest losing pages hold ${Math.round(k.top10Share)}% of the page-level loss.${k.goneN ? ` ${k.goneN} pages that dropped out or lost their demand account for ${fmtN(Math.abs(k.goneClicks))} clicks (${Math.round(k.goneShare)}%), which is typical when event or campaign pages end.` : ''}`);
      const wi = nm(R.pages.filter(x => x.d > 0).sort((a, b) => b.d - a.d), 3);
      if (wi.length) L.push(`Biggest gaining pages: ${wi.map(x => `${x.label} ${sn(x.d)}`).join('; ')}.`);
    }
    const ql = nm(R.queries.filter(x => !x.brand && x.d < 0).sort((a, b) => a.d - b.d), 3);
    if (ql.length) L.push(`Biggest losing non-brand searches: ${ql.map(x => `"${x.label}" ${sn(x.d)}`).join('; ')}.`);
    if (R.peak && R.last && R.peak !== R.last) L.push(`Weekly clicks: peak ${fmtN(R.peak.clicks)} (week of ${R.peak.w}); latest full week ${fmtN(R.last.clicks)} (week of ${R.last.w}), ${sgn(pct(R.last.clicks, R.peak.clicks), 0)} from the peak.`);
    if (dClicks < 0) {
      const A2 = [];
      if (b.share != null && b.share >= 40) A2.push('check brand demand with marketing (campaigns, app and login behaviour) since brand searches carry most of the drop');
      if (R.hasPages && R.concentration.goneShare != null && R.concentration.goneShare >= 25) A2.push('map the dropped pages to the campaign or event calendar and build evergreen pages for recurring events');
      if (n.share != null && n.share >= 30) A2.push('refresh the top losing non-brand pages, starting with those whose rank slipped');
      if (Math.abs(eff.impr) > Math.abs(eff.ctr)) A2.push('treat this mainly as a visibility and demand problem, not a snippet problem');
      else A2.push('review titles and snippets on the top losing pages, since CTR moved more than impressions');
      if (A2.length) L.push(`Suggested next steps: ${A2.join('; ')}.`);
    }
    L.push('Seasonality is not tested here: set the compare period to the same dates last year to check it.');
    return L.join('\n\n');
  }

  window.CW_WHY = { deep, tier, compute, narrative, cause, join, weekly, sectionKey };
  if (!window.CW_VIEWS) return;

  // ── screen ──
  const { V, esc, ui } = window.CW_VIEWS;
  const { head } = ui;

  // ── deep dive: losing pages and searches in traffic tiers (high → low, by clicks before), each page with its searches, plus a mail ──
  function tier(list, key) {
    const l = list.filter(x => x.d < 0 && x.p && x.p.clicks > 0).sort((a, b) => b.p.clicks - a.p.clicks);
    const n = l.length, a = Math.ceil(n * .1), b = Math.ceil(n * .4);
    return [['High traffic', l.slice(0, a)], ['Mid traffic', l.slice(a, b)], ['Low traffic', l.slice(b)]]
      .map(([name, rows]) => ({ name, rows: rows.sort((x, y) => x.d - y.d), loss: rows.reduce((s, x) => s + x.d, 0) }));
  }
  function deep(R, D) {
    const qMap = new Map(R.queries.map(x => [x.k, x])), by = new Map();
    (D.QP || []).forEach(r => { const k = r.p; (by.get(k) || by.set(k, []).get(k)).push(r); });
    const pt = tier(R.pages), qt = tier(R.queries);
    const qOf = pg => (by.get(pg.k) || by.get(pg.c && pg.c.p) || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 5)
      .map(r => { const q = qMap.get(r.q); return { q: r.q, clicks: r.clicks, pos: r.pos, d: q ? q.d : null, s: q ? q.s : null }; });
    pt.forEach(t => t.rows.slice(0, 15).forEach(x => { x.qs = qOf(x); }));
    const L = [`Subject: Why organic traffic is down (${R.cur.clicks != null ? 'deep dive' : ''})`, '',
      `Clicks ${fmtN(R.prev.clicks)} → ${fmtN(R.cur.clicks)} (${sn(R.dClicks)}, ${sgn(pct(R.cur.clicks, R.prev.clicks), 0)}).`,
      `Of that, ${sn(R.eff.impr)} is impressions and ${sn(R.eff.ctr)} is CTR.`, ''];
    pt.forEach(t => {
      if (!t.rows.length) return;
      L.push(`${t.name} pages (${t.rows.length} losing, ${sn(t.loss)} clicks):`);
      t.rows.slice(0, 5).forEach(x => L.push(`- ${x.label}: ${fmtN(x.p.clicks)} → ${fmtN(x.c.clicks)} (${sn(x.d)})${x.s ? ', ' + x.s.label.toLowerCase() : ''}`));
    });
    const q = qt[0].rows.slice(0, 5);
    if (q.length) { L.push('', 'Biggest searches lost:'); q.forEach(x => L.push(`- ${x.label}: ${fmtN(x.p.clicks)} → ${fmtN(x.c.clicks)} (${sn(x.d)})${x.s ? ', ' + x.s.label.toLowerCase() : ''}`)); }
    return { pt, qt, text: L.join('\n'), hasQP: !!(D.QP && D.QP.length) };
  }

  const TABS = [['answer', 'Answer'], ['brand', 'Brand vs non-brand'], ['names', 'Brand names'], ['sections', 'Sections'], ['pages', 'Landing pages'], ['queries', 'Searches'], ['trend', 'Weekly trend'], ['deep', 'Deep dive · 28 Nov']];
  const pill = v => v == null || !isFinite(v) ? '<span class="flat">—</span>' : Math.abs(v) < .5 ? '<span class="flat">0%</span>' : `<span class="dw-pill ${v > 0 ? 'up' : 'dn'}">${v > 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%</span>`;
  const dcell = d => `<td class="r num ${d > 0 ? 'up' : d < 0 ? 'dn' : 'flat'}">${sn(d)}</td>`;
  const shr = v => v == null || !isFinite(v) ? '<td class="r flat">—</td>' : `<td class="r num">${Math.round(v)}%</td>`;
  const tbl = (cols, rows, empty) => rows.length
    ? `<div class="tw"><table class="sp-t"><thead><tr>${cols.map((c, i) => `<th scope="col"${i ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="empty">${empty || 'Nothing to show.'}</p>`;
  const lab = (s, t) => `<td class="sp-q" title="${esc(s)}">${esc(t == null ? s : t)}</td>`;
  const why = s => `<td>${s ? `<span class="dw-pill ${s.up ? 'up' : 'dn'}">${esc(s.label)}</span>` : '<span class="flat">—</span>'}</td>`;
  const pos = r => r && r.pos != null ? r.pos.toFixed(1) : '—';

  function bars(weeks) {
    if (weeks.length < 2) return '<p class="empty">Needs daily totals for at least two weeks.</p>';
    const W = 720, H = 150, pad = 8, max = Math.max(...weeks.map(w => w.clicks)) || 1, bw = (W - pad * 2) / weeks.length;
    const pk = weeks.filter(w => !w.partial).reduce((m, w) => !m || w.clicks > m.clicks ? w : m, null);
    const rects = weeks.map((w, i) => {
      const h = Math.max(1, w.clicks / max * H);
      return `<rect x="${(pad + i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${w.partial ? '#c7d2fe' : w === pk ? '#4f46e5' : '#818cf8'}"><title>${esc(w.w)}: ${fmtN(w.clicks)} clicks${w.partial ? ' (partial week)' : ''}</title></rect>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H + 20}" class="why-bars" role="img" aria-label="Weekly clicks, ${weeks.length} weeks"><g>${rects}</g><text x="${pad}" y="${H + 15}" font-size="11" fill="#64748b">${esc(weeks[0].w)}</text><text x="${W - pad}" y="${H + 15}" font-size="11" fill="#64748b" text-anchor="end">${esc(weeks[weeks.length - 1].w)}</text></svg>`;
  }

  const rowsFor = {
    brand: R => R.split.map(x => `<tr>${lab(x.label)}<td class="r num">${fmtN(x.p.clicks)}</td><td class="r num">${fmtN(x.c.clicks)}</td>${dcell(x.d)}<td class="r">${pill(pct(x.c.clicks, x.p.clicks))}</td>${shr(x.share)}<td class="r num flat">${fmtN(x.p.impr)} → ${fmtN(x.c.impr)}</td><td class="r num flat">${pos(x.p)} → ${pos(x.c)}</td></tr>`),
    names: R => R.brandNames.map(x => `<tr>${lab(x.label)}<td class="r num">${fmtN(x.p)}</td><td class="r num">${fmtN(x.c)}</td>${dcell(x.d)}<td class="r">${pill(pct(x.c, x.p))}</td><td class="r num flat">${fmtN(x.pi)} → ${fmtN(x.ci)}</td><td class="r num flat">${fmtN(x.n)}</td></tr>`),
    brandq: R => R.brandQueries.slice(0, 25).map(x => `<tr>${lab(x.label)}<td class="r num">${x.p ? fmtN(x.p.clicks) : '—'}</td><td class="r num">${fmtN(x.c.clicks)}</td>${dcell(x.d)}<td class="r">${pill(x.p ? pct(x.c.clicks, x.p.clicks) : null)}</td>${why(x.s)}</tr>`),
    sections: R => R.sections.slice(0, 40).map(x => `<tr>${lab(x.label)}<td class="r num">${fmtN(x.p.clicks)}</td><td class="r num">${fmtN(x.c.clicks)}</td>${dcell(x.d)}<td class="r">${pill(pct(x.c.clicks, x.p.clicks))}</td>${shr(x.share)}<td class="r num flat">${fmtN(x.p.impr)} → ${fmtN(x.c.impr)}</td><td class="r num flat">${pos(x.p)} → ${pos(x.c)}</td></tr>`),
    pages: list => list.map(x => `<tr>${lab(x.k, x.label)}<td class="r num">${x.p ? fmtN(x.p.clicks) : '—'}</td><td class="r num">${fmtN(x.c.clicks)}</td>${dcell(x.d)}<td class="r">${pill(x.p ? pct(x.c.clicks, x.p.clicks) : null)}</td><td class="r num flat">${x.p ? fmtN(x.p.impr) : '—'} → ${fmtN(x.c.impr)}</td><td class="r num flat">${pos(x.p)} → ${pos(x.c)}</td>${why(x.s)}</tr>`),
    queries: list => list.map(x => `<tr>${lab(x.label)}<td class="r">${x.brand ? 'Brand' : 'Non-brand'}</td><td class="r num">${x.p ? fmtN(x.p.clicks) : '—'}</td><td class="r num">${fmtN(x.c.clicks)}</td>${dcell(x.d)}<td class="r num flat">${pos(x.p)} → ${pos(x.c)}</td>${why(x.s)}</tr>`)
  };

  const PCOLS = ['Landing page', 'Before', 'Now', 'Change', '%', 'Impressions', 'Position', 'Likely cause'];

  function body(R, st) {
    if (st.tab === 'answer') {
      const m = (l, v, s) => `<div class="stat"><span class="flat">${l}</span><b>${v}</b><span class="flat">${s}</span></div>`;
      return `<section class="panel"><div class="sp-ctl"><h2 style="margin:0">Answer to paste</h2><button type="button" class="btn" id="why-copy">Copy answer</button><span class="flat" id="why-copied" aria-live="polite"></span></div>
        <div class="why-ans" id="why-ans">${esc(R.text)}</div>
        <p class="flat dw-n">Written from the numbers on the other tabs, nothing else. Edit it before sending if you know a reason the data cannot show (a campaign, a site change, a Google update).</p></section>
        <section class="panel"><div class="why-kpis">${m('Clicks', fmtN(R.cur.clicks), `${sn(R.dClicks)} (${sgn(pct(R.cur.clicks, R.prev.clicks), 0)})`)}${m('Impressions', fmtN(R.cur.impr), `${sn(R.cur.impr - R.prev.impr)} (${sgn(pct(R.cur.impr, R.prev.impr), 0)})`)}${m('CTR', R.cur.ctr.toFixed(1) + '%', `was ${R.prev.ctr.toFixed(1)}%`)}${m('Avg position', R.cur.pos != null ? R.cur.pos.toFixed(1) : '—', `was ${R.prev.pos != null ? R.prev.pos.toFixed(1) : '—'}`)}</div>
        <p class="flat dw-n">Of the change in clicks, ${sn(R.eff.impr)} comes from impressions and ${sn(R.eff.ctr)} from CTR.</p></section>`;
    }
    if (st.tab === 'brand') return `<section class="panel"><h2>Brand vs non-brand</h2>${tbl(['Group', 'Before', 'Now', 'Change', '%', 'Share of change', 'Impressions', 'Position'], rowsFor.brand(R))}
      <p class="flat dw-n">Brand is decided by the brand names in Settings. The last line is whatever Search Console does not list by search${R.cov && R.cov.q != null ? `; the rows here cover ${Math.round(R.cov.q)}% of clicks` : ''}.</p></section>`;
    if (st.tab === 'names') return `<section class="panel"><h2>Brand names</h2>${tbl(['Brand name', 'Before', 'Now', 'Change', '%', 'Impressions', 'Searches'], rowsFor.names(R), 'No brand names set. Add them in Settings.')}</section>
      <section class="panel"><h2>Biggest brand searches</h2>${tbl(['Search', 'Before', 'Now', 'Change', '%', 'Likely cause'], rowsFor.brandq(R), 'No brand searches in the loaded rows.')}</section>`;
    if (st.tab === 'sections') return `<section class="panel"><h2>Site sections</h2>${tbl(['Section', 'Before', 'Now', 'Change', '%', 'Share of change', 'Impressions', 'Position'], rowsFor.sections(R), 'No page data for both periods.')}
      <p class="flat dw-n">A section is the first folder of the page address. Page rows may not cover every click on the site.</p></section>`;
    if (st.tab === 'pages') {
      if (!R.hasPages) return '<section class="panel"><p class="empty">No page rows for the compare period, so landing pages cannot be compared.</p></section>';
      const k = R.concentration, t = st.text.trim().toLowerCase(), f = x => !t || x.label.toLowerCase().includes(t);
      const lo = R.pages.filter(x => x.d < 0 && f(x)).sort((a, b) => a.d - b.d).slice(0, st.limit), wi = R.pages.filter(x => x.d > 0 && f(x)).sort((a, b) => b.d - a.d).slice(0, 25);
      return `<div class="sp-ctl"><input id="why-text" type="search" value="${esc(st.text)}" placeholder="Filter pages…" aria-label="Filter pages"><span class="flat">${k.pageLoss ? `Top 10 losers hold ${Math.round(k.top10Share)}% of the page-level loss; ${fmtN(k.goneN)} pages dropped out or lost demand (${fmtN(Math.abs(k.goneClicks))} clicks).` : ''}</span></div>
        <section class="panel"><h2>Pages that lost clicks</h2>${tbl(PCOLS, rowsFor.pages(lo), 'No losing pages match.')}${R.pages.filter(x => x.d < 0 && f(x)).length > st.limit ? '<p class="sp-more"><button type="button" class="btn-quiet" id="why-more">Show more</button></p>' : ''}</section>
        <section class="panel"><h2>Pages that gained clicks</h2>${tbl(PCOLS, rowsFor.pages(wi), 'No gaining pages match.')}</section>`;
    }
    if (st.tab === 'queries') {
      const t = st.text.trim().toLowerCase(), f = x => (!st.grp || (st.grp === 'brand') === !!x.brand) && (!t || x.label.toLowerCase().includes(t));
      const lo = R.queries.filter(x => x.d < 0 && f(x)).sort((a, b) => a.d - b.d).slice(0, st.limit), wi = R.queries.filter(x => x.d > 0 && f(x)).sort((a, b) => b.d - a.d).slice(0, 25);
      const QC = ['Search', 'Type', 'Before', 'Now', 'Change', 'Position', 'Likely cause'];
      return `<div class="sp-ctl"><label class="ow-f"><span>Type</span><select id="why-grp"><option value=""${st.grp ? '' : ' selected'}>All</option><option value="brand"${st.grp === 'brand' ? ' selected' : ''}>Brand</option><option value="nb"${st.grp === 'nb' ? ' selected' : ''}>Non-brand</option></select></label>
        <input id="why-text" type="search" value="${esc(st.text)}" placeholder="Filter searches…" aria-label="Filter searches"></div>
        <section class="panel"><h2>Searches that lost clicks</h2>${tbl(QC, rowsFor.queries(lo), 'No losing searches match.')}${R.queries.filter(x => x.d < 0 && f(x)).length > st.limit ? '<p class="sp-more"><button type="button" class="btn-quiet" id="why-more">Show more</button></p>' : ''}</section>
        <section class="panel"><h2>Searches that gained clicks</h2>${tbl(QC, rowsFor.queries(wi), 'No gaining searches match.')}</section>`;
    }
    if (st.tab === 'deep') {
      const X = R.deepX, C = ['Landing page', 'Before', 'Now', 'Change', '%', 'Impressions', 'Position', 'Likely cause'];
      const sec = (t, kind) => `<section class="panel"><h2>${t.name} · ${t.rows.length} losing · ${sn(t.loss)} clicks</h2>${kind === 'p' ? tbl(C, rowsFor.pages(t.rows.slice(0, 15)).map((r, i) => { const x = t.rows[i]; return r + (x.qs && x.qs.length ? `<tr><td colspan="8" class="flat">Top searches: ${x.qs.map(q => `${esc(q.q)} (${fmtN(q.clicks)}${q.d != null ? ', ' + sn(q.d) + ' site-wide' : ''})`).join(' · ')}</td></tr>` : ''); }), 'None.') : tbl(['Search', 'Type', 'Before', 'Now', 'Change', 'Position', 'Likely cause'], rowsFor.queries(t.rows.slice(0, 15)), 'None.')}</section>`;
      if (!R.hasPages) return '<section class="panel"><p class="empty">No page rows for the compare period.</p></section>';
      return `<section class="panel"><div class="sp-ctl"><h2 style="margin:0">Mail to paste</h2><button type="button" class="btn" id="why-copy">Copy mail</button><span class="flat" id="why-copied" aria-live="polite"></span></div><div class="why-ans" id="why-ans">${esc(X.text)}</div>${X.hasQP ? '' : '<p class="flat dw-n">Per-page searches need query×page data (API mode). Not loaded here.</p>'}</section>
        <h2>Landing pages, high to low traffic</h2>${X.pt.map(t => sec(t, 'p')).join('')}
        <h2>Searches, high to low traffic</h2>${X.qt.map(t => sec(t, 'q')).join('')}`;
    }
    const wk = R.weeks;
    return `<section class="panel"><h2>Weekly clicks</h2>${R.hasWeeks ? bars(wk) : '<p class="empty">Needs daily totals for the chosen dates.</p>'}
      ${R.hasWeeks ? tbl(['Week of', 'Clicks', 'Impressions', 'vs previous week'], wk.map((w, i) => `<tr><td>${esc(w.w)}${w.partial ? ' <span class="flat">(partial)</span>' : ''}</td><td class="r num">${fmtN(w.clicks)}</td><td class="r num">${fmtN(w.impr)}</td><td class="r">${i ? pill(pct(w.clicks, wk[i - 1].clicks)) : '<span class="flat">—</span>'}</td></tr>`).reverse()) : ''}
      <p class="flat dw-n">Weeks run Monday to Sunday. Partial weeks (fewer than 7 days of data) are shown lighter and left out of the peak.</p></section>`;
  }

  V.why = (A, D) => {
    const title = 'Why traffic changed', sub = 'What moved against the compare period, and why: impressions vs CTR, brand vs non-brand, sections, landing pages and searches, with a written answer you can paste.';
    const R = compute(A, D);
    if (!R.ok) return { html: head(title, sub) + '<section class="panel"><p class="empty">No comparison period is loaded, so there is nothing to compare. Choose dates with a compare period (the previous period, or the same dates last year).</p></section>' };
    R.deepX = deep(R, D);
    const st = { tab: 'answer', text: '', limit: 25, grp: '' };
    const html = head(title, sub) + `<div class="sp-ctl"><div class="seg" role="tablist">${TABS.map((t, i) => `<button type="button"${i ? '' : ' class="on"'} data-wt="${t[0]}">${t[1]}</button>`).join('')}</div></div><div id="why-body"></div>`;
    return { html, mount: () => {
      const host = document.getElementById('why-body'), v = document.getElementById('view');
      const draw = () => {
        host.innerHTML = body(R, st);
        const cp = document.getElementById('why-copy');
        if (cp) cp.addEventListener('click', () => {
          const done = ok => { const el = document.getElementById('why-copied'); if (el) el.textContent = ok ? 'Copied' : 'Select the text and copy it'; };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(st.tab === 'deep' ? R.deepX.text : R.text).then(() => done(true), () => done(false));
          else { const r = document.createRange(); r.selectNodeContents(document.getElementById('why-ans')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done(false); }
        });
        const tx = document.getElementById('why-text');
        if (tx) tx.addEventListener('input', e => { st.text = e.target.value; st.limit = 25; const p = e.target.selectionStart; draw(); const n = document.getElementById('why-text'); n.focus(); n.setSelectionRange(p, p); });
        const g = document.getElementById('why-grp'); if (g) g.addEventListener('change', e => { st.grp = e.target.value; st.limit = 25; draw(); });
        const mo = document.getElementById('why-more'); if (mo) mo.addEventListener('click', () => { st.limit += 50; draw(); });
      };
      v.querySelectorAll('[data-wt]').forEach(b => b.addEventListener('click', () => { st.tab = b.dataset.wt; st.limit = 25; v.querySelectorAll('[data-wt]').forEach(x => x.classList.toggle('on', x === b)); draw(); }));
      draw();
    } };
  };
})();

// Clickwise Statistics & Trends: pure calculations, no DOM, no network.
// Every total is built from daily rows: clicks and impressions are summed, CTR is total clicks ÷ total
// impressions, and average position is weighted by impressions (Σ position × impressions ÷ Σ impressions).
// That reproduces Search Console's own period totals exactly for the same dates, search type and filters.
// Periods that run past the last day of final data, or start before the first day of history, are marked
// partial, and comparisons are only offered when the comparison period is fully inside the history.
(function () {
  'use strict';
  const DAY = 864e5;
  const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const ds = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => ds(toUTC(s) + n * DAY);
  const diff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ds(toUTC(s)) === s;
  // the same calendar day one year earlier (29 Feb → 28 Feb)
  function yearAgo(s) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y - 1, m - 1, d)); return t.getUTCMonth() === m - 1 ? ds(t) : ds(Date.UTC(y - 1, m, 0)); }
  const pct = (a, b) => b ? (a - b) / b * 100 : null;

  // ── totals ──
  function totals(rows) {
    let clicks = 0, impr = 0, pw = 0;
    rows.forEach(r => { clicks += +r.clicks || 0; impr += +r.impr || 0; pw += (+r.pos || 0) * (+r.impr || 0); });
    return { clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: impr ? pw / impr : null, days: rows.length };
  }
  // history: daily rows → an index with the first and last day of data
  function index(daily) {
    const rows = (daily || []).filter(r => r && isDate(r.d)).map(r => ({ d: r.d, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })).sort((a, b) => a.d.localeCompare(b.d));
    const map = new Map(rows.map(r => [r.d, r]));
    return { rows, map, first: rows.length ? rows[0].d : null, last: rows.length ? rows[rows.length - 1].d : null };
  }
  // A day inside the history with no row had no impressions (Search Console omits such days): it counts as zero.
  function span(H, s, e) {
    const out = [];
    if (!H.first || e < s) return out;
    for (let d = s < H.first ? H.first : s; d <= e && d <= H.last; d = add(d, 1)) out.push(H.map.get(d) || { d, clicks: 0, impr: 0, pos: 0 });
    return out;
  }
  // covered: is the whole period inside the history?
  const covered = (H, s, e) => !!H.first && s >= H.first && e <= H.last;
  function period(H, s, e) { const rows = span(H, s, e); const t = totals(rows); return { start: s, end: e, length: diff(s, e) + 1, covered: covered(H, s, e), ...t }; }

  // ── selection ──
  // the same lengths as the rest of Clickwise (3 months = 90 days, as on the property screen)
  const PRESETS = [[7, '7 days'], [28, '28 days'], [90, '3 months'], [180, '6 months'], [365, '12 months'], [486, '16 months']];
  // A preset ends on the last day of data; it is offered only when the history reaches back far enough.
  function presetRange(H, days) { if (!H.last) return null; const s = add(H.last, -days + 1); return { start: s, end: H.last, days, available: s >= H.first }; }
  function clampRange(H, s, e) {
    if (!H.last) return null;
    let a = isDate(s) ? s : add(H.last, -90), b = isDate(e) ? e : H.last;
    if (b > H.last) b = H.last; if (a < H.first) a = H.first; if (a > b) a = b;
    return { start: a, end: b, days: diff(a, b) + 1, available: true };
  }
  // comparison periods for a selection
  function comparisons(H, sel) {
    const n = diff(sel.start, sel.end) + 1;
    const prev = { start: add(sel.start, -n), end: add(sel.start, -1) };
    const yoy = { start: yearAgo(sel.start), end: yearAgo(sel.end) };
    return { prev: { ...prev, available: covered(H, prev.start, prev.end) }, yoy: { ...yoy, available: covered(H, yoy.start, yoy.end) } };
  }

  // ── buckets: ISO weeks (Monday–Sunday), calendar months, calendar quarters ──
  function bucketOf(d, g) {
    const t = new Date(toUTC(d));
    if (g === 'week') { const wd = (t.getUTCDay() + 6) % 7; const s = add(d, -wd); return { key: s, start: s, end: add(s, 6) }; }
    const y = t.getUTCFullYear(), m = t.getUTCMonth();
    if (g === 'quarter') { const q = Math.floor(m / 3); return { key: `${y}-Q${q + 1}`, start: ds(Date.UTC(y, q * 3, 1)), end: ds(Date.UTC(y, q * 3 + 3, 0)) }; }
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: ds(Date.UTC(y, m, 1)), end: ds(Date.UTC(y, m + 1, 0)) };
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function labelOf(b, g) {
    if (g === 'week') { const e = b.end; return `${+b.start.slice(8)} ${MON[+b.start.slice(5, 7) - 1]} – ${+e.slice(8)} ${MON[+e.slice(5, 7) - 1]}${e.slice(0, 4) !== b.start.slice(0, 4) ? ' ' + e.slice(0, 4) : ''}`; }
    if (g === 'quarter') return b.key.replace('-', ' ');
    return `${MON[+b.key.slice(5) - 1]} ${b.key.slice(0, 4)}`;
  }
  // Buckets overlapping the selection. A bucket is partial when part of it lies outside the selection or
  // outside the history (the current week or month, or a period before the first day of data).
  function buckets(H, sel, g) {
    const out = []; if (!H.last) return out;
    let b = bucketOf(sel.start, g);
    while (b.start <= sel.end) {
      const s = b.start < sel.start ? sel.start : b.start, e = b.end > sel.end ? sel.end : b.end;
      const t = period(H, s, e);
      const full = diff(b.start, b.end) + 1, have = span(H, s, e).length;
      const partial = have < full;
      const why = partial ? (b.end > H.last ? `in progress: ${have} of ${full} days have final data` : b.start < H.first ? `history starts ${H.first}: ${have} of ${full} days` : `the selection covers ${have} of ${full} days`) : '';
      // the same bucket a year earlier and the bucket before, for YoY and period-on-period changes
      const ly = { start: yearAgo(b.start), end: yearAgo(b.end) };
      const pb = bucketOf(add(b.start, -1), g);
      out.push({ ...b, label: labelOf(b, g), from: s, to: e, ...t, fullDays: full, haveDays: have, partial, why,
        yoy: !partial && covered(H, ly.start, ly.end) ? period(H, ly.start, ly.end) : null,
        before: !partial && covered(H, pb.start, pb.end) ? period(H, pb.start, pb.end) : null });
      b = bucketOf(add(b.end, 1), g);
    }
    return out;
  }
  // Last complete week / month and the one before, and the same month a year earlier.
  function standard(H) {
    if (!H.last) return null;
    const wk = bucketOf(H.last, 'week'), lastWeekEnd = wk.end === H.last ? wk.end : add(wk.start, -1);
    const w = { start: add(lastWeekEnd, -6), end: lastWeekEnd }, w0 = { start: add(w.start, -7), end: add(w.start, -1) };
    const mo = bucketOf(H.last, 'month'), lastMonthEnd = mo.end === H.last ? mo.end : add(mo.start, -1);
    const m = bucketOf(lastMonthEnd, 'month'), m0 = bucketOf(add(m.start, -1), 'month');
    const my = { start: yearAgo(m.start), end: yearAgo(m.end) };
    const mk = (cur, base, label, baseLabel) => ({ label, baseLabel, cur: period(H, cur.start, cur.end), base: covered(H, base.start, base.end) ? period(H, base.start, base.end) : null, baseRange: base, available: covered(H, cur.start, cur.end) && covered(H, base.start, base.end) });
    return {
      wow: mk(w, w0, 'Week on week', 'previous week'),
      mom: mk(m, m0, 'Month on month', labelOf(m0, 'month')),
      yoy: mk(m, my, 'Year on year', labelOf(bucketOf(my.start, 'month'), 'month')),
      lastWeek: w, lastMonth: { ...m, label: labelOf(m, 'month') }
    };
  }
  // change between two totals
  function delta(cur, base) {
    if (!base) return null;
    return { clicks: pct(cur.clicks, base.clicks), impr: pct(cur.impr, base.impr), ctr: cur.ctr - base.ctr, pos: cur.pos != null && base.pos != null ? cur.pos - base.pos : null,
      dClicks: cur.clicks - base.clicks, dImpr: cur.impr - base.impr };
  }

  // ── searches and pages ──
  // rows: { q | p, clicks, impr, ctr, pos }. capped: the list may be cut at a row limit.
  function breadth(rows, capped) {
    const r = (rows || []).filter(x => x.impr > 0);
    return { ranking: r.length, top10: r.filter(x => x.pos > 0 && x.pos <= 10.5).length, top3: r.filter(x => x.pos > 0 && x.pos <= 3.5).length, capped: !!capped };
  }
  // Winners and losers by change in clicks. A row missing from a capped list is not assumed to be zero:
  // it is marked uncertain, because it may only have fallen below the list's last row.
  function movers(cur, base, key, opt) {
    opt = opt || {};
    const cm = new Map((cur || []).map(r => [r[key], r])), bm = new Map((base || []).map(r => [r[key], r]));
    const floorC = opt.curCapped && cur.length ? Math.min(...cur.map(r => r.clicks)) : 0;
    const floorB = opt.baseCapped && base.length ? Math.min(...base.map(r => r.clicks)) : 0;
    const keys = new Set([...cm.keys(), ...bm.keys()]);
    const rows = [];
    keys.forEach(k => {
      const a = cm.get(k), b = bm.get(k);
      const ca = a ? a.clicks : 0, cb = b ? b.clicks : 0;
      if (ca + cb < (opt.min || 1)) return;
      // a change within ordinary variation (about √n clicks between periods) is not a winner or loser
      const noise = Math.max(3, Math.sqrt(ca + cb));
      rows.push({ [key]: k, clicks: ca, prev: cb, d: ca - cb, ch: pct(ca, cb), impr: a ? a.impr : 0, prevImpr: b ? b.impr : 0, pos: a ? a.pos : null, prevPos: b ? b.pos : null,
        ctr: a && a.impr ? a.clicks / a.impr * 100 : 0, prevCtr: b && b.impr ? b.clicks / b.impr * 100 : 0,
        isNew: !b, gone: !a, noise: Math.abs(ca - cb) < noise, uncertain: (!a && opt.curCapped && cb <= floorC * 1.5) || (!b && opt.baseCapped && ca <= floorB * 1.5) });
    });
    const n = opt.n || 10;
    return {
      winners: rows.filter(r => r.d > 0 && !r.noise).sort((x, y) => y.d - x.d || String(x[key]).localeCompare(String(y[key]))).slice(0, n),
      losers: rows.filter(r => r.d < 0 && !r.noise).sort((x, y) => x.d - y.d || String(x[key]).localeCompare(String(y[key]))).slice(0, n),
      gain: rows.filter(r => r.d > 0).reduce((s, r) => s + r.d, 0), loss: rows.filter(r => r.d < 0).reduce((s, r) => s + r.d, 0), n: rows.length
    };
  }
  // why position or CTR moved for one row, in plain words (facts only)
  function moverWhy(r) {
    const out = [];
    if (r.isNew) return 'new: no clicks in the comparison period';
    if (r.gone) return 'no clicks in the current period';
    if (r.pos != null && r.prevPos != null && Math.abs(r.pos - r.prevPos) >= 1) out.push(`position ${r.prevPos.toFixed(1)} → ${r.pos.toFixed(1)}`);
    const ic = pct(r.impr, r.prevImpr); if (ic != null && Math.abs(ic) >= 20) out.push(`impressions ${ic > 0 ? '+' : ''}${ic.toFixed(0)}%`);
    if (r.prevCtr && Math.abs(r.ctr - r.prevCtr) >= 0.5) out.push(`CTR ${r.prevCtr.toFixed(1)}% → ${r.ctr.toFixed(1)}%`);
    return out.join(', ') || 'small changes across position, impressions and CTR';
  }

  // ── insights: each has observed facts and, kept apart, possible explanations ──
  function fmt(n) { n = +n || 0; const a = Math.abs(n); return (a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString('en-US')); }
  const sg = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 1 : 0) + '%';
  function insights(ctx) {
    const { cur, base, baseLabel, lastYear, lyBase, daily, movQ, movP, brandTest, breadthCur, breadthBase } = ctx;
    const out = [];
    if (!cur || !cur.impr) return out;
    if (base && base.impr) {
      const d = delta(cur, base);
      // clicks = impressions × CTR, so the change splits exactly (in log terms) into a demand part and a CTR part
      const lc = Math.log((cur.clicks || 1) / (base.clicks || 1)), li = Math.log(cur.impr / base.impr), lr = lc - li;
      const share = lc ? Math.round(li / lc * 100) : 0;
      const driver = Math.abs(li) >= Math.abs(lr) ? 'impressions' : 'CTR';
      out.push({ id: 'clicks', tone: d.clicks >= 0 ? 'good' : 'bad', title: `Clicks ${d.clicks >= 0 ? 'rose' : 'fell'} ${sg(d.clicks)} vs ${baseLabel}`,
        facts: [`${fmt(base.clicks)} → ${fmt(cur.clicks)} clicks (${d.dClicks >= 0 ? '+' : ''}${fmt(d.dClicks)}).`, `Impressions ${sg(d.impr)}, CTR ${base.ctr.toFixed(2)}% → ${cur.ctr.toFixed(2)}%, average position ${base.pos != null ? base.pos.toFixed(1) : '—'} → ${cur.pos != null ? cur.pos.toFixed(1) : '—'}.`,
          lc && Math.sign(li) === Math.sign(lc) && Math.sign(lr) === Math.sign(lc) ? `About ${share}% of the change comes from impressions and ${100 - share}% from CTR.` : `Impressions and CTR moved in opposite directions; ${driver} had the larger effect.`],
        maybe: driver === 'impressions'
          ? [d.impr < 0 ? 'Lower demand (seasonality, fewer searches for your topics) or lost rankings for high-volume searches.' : 'More demand, new rankings, or pages Google started showing for more searches.']
          : [d.ctr < 0 ? 'Results-page changes (AI Overviews, ads, other features) taking clicks, weaker titles, or a shift toward searches with lower CTR.' : 'Better titles and snippets, higher positions on the same searches, or rich results.'] });
      if (d.pos != null && Math.abs(d.pos) >= 0.5) out.push({ id: 'pos', tone: d.pos < 0 ? 'good' : 'bad', title: `Average position ${d.pos < 0 ? 'improved' : 'worsened'} by ${Math.abs(d.pos).toFixed(1)}`,
        facts: [`${base.pos.toFixed(1)} → ${cur.pos.toFixed(1)} (impression-weighted; lower is better).`],
        maybe: ['Average position also moves when the mix of searches changes: new rankings deep in the results push it down even when nothing lost ground. Check the page and search losers below.'] });
      if (breadthCur && breadthBase && breadthBase.ranking) {
        const r = pct(breadthCur.ranking, breadthBase.ranking), t = pct(breadthCur.top10, breadthBase.top10);
        if (r != null && Math.abs(r) >= 10) out.push({ id: 'breadth', tone: r > 0 ? 'good' : 'bad', title: `${r > 0 ? 'More' : 'Fewer'} searches show the site (${sg(r)})`,
          facts: [`${fmt(breadthBase.ranking)} → ${fmt(breadthCur.ranking)} searches with impressions; ${fmt(breadthBase.top10)} → ${fmt(breadthCur.top10)} in the top 10 (${sg(t)}).`].concat(breadthCur.capped || breadthBase.capped ? ['At least one list reached its row limit, so counts are lower bounds.'] : []),
          maybe: [r > 0 ? 'New or expanded content is reaching more searches.' : 'Pages removed, deindexed or consolidated, or lost rankings for long-tail searches.'] });
      }
    }
    if (lastYear && lyBase && lyBase.clicks && base && base.clicks) {
      const now = pct(cur.clicks, base.clicks), then = pct(lastYear.clicks, lyBase.clicks);
      if (now != null && then != null) {
        const same = Math.sign(now) === Math.sign(then) && Math.abs(now - then) < Math.max(10, Math.abs(then) * 0.5);
        out.push({ id: 'season', tone: same ? 'info' : now < then ? 'bad' : 'good', title: same ? 'The change matches last year’s pattern' : 'The change differs from last year’s pattern',
          facts: [`This period vs ${baseLabel}: ${sg(now)} clicks. The same dates a year earlier: ${sg(then)}.`],
          maybe: [same ? 'Much of the movement is likely seasonal rather than caused by recent changes.' : now < then ? 'Seasonality does not explain the drop; look at the losers below.' : 'Growth beyond the seasonal pattern; the winners below show where it came from.'] });
      }
    }
    if (movP && (movP.gain || movP.loss)) {
      const L = movP.losers.slice(0, 3), net = movP.gain + movP.loss;
      const topLoss = L.reduce((s, r) => s + r.d, 0);
      if (movP.loss && Math.abs(topLoss) >= Math.abs(movP.loss) * 0.4 && L.length) out.push({ id: 'conc', tone: 'bad', title: `${L.length} page${L.length === 1 ? '' : 's'} account for ${Math.round(topLoss / movP.loss * 100)}% of lost clicks`,
        facts: L.map(r => `${r.path || r.p}: ${fmt(r.prev)} → ${fmt(r.clicks)} (${moverWhy(r)})`),
        maybe: ['A concentrated loss usually has a page-level cause (content, indexing, a competitor or a results-page change) rather than a site-wide one.'] });
      else if (movP.loss) out.push({ id: 'spread', tone: 'info', title: 'Losses are spread across many pages', facts: [`Pages that lost clicks: ${fmt(-movP.loss)} in total; gains elsewhere: +${fmt(movP.gain)} (net ${net >= 0 ? '+' : ''}${fmt(net)}).`], maybe: ['A broad, even decline points to site-wide causes: demand, a Google update, or technical issues.'] });
    }
    if (movQ && brandTest) {
      const all = movQ.winners.concat(movQ.losers);
      const absB = all.filter(r => brandTest(r.q)).reduce((s, r) => s + Math.abs(r.d), 0), absT = all.reduce((s, r) => s + Math.abs(r.d), 0);
      const br = all.filter(r => brandTest(r.q)).reduce((s, r) => s + r.d, 0);
      if (absT && absB >= absT * 0.3) out.push({ id: 'brand', tone: 'info', title: 'Branded searches drive much of the movement', facts: [`Branded searches make up ${Math.round(absB / absT * 100)}% of the click movement among the biggest search winners and losers (net ${br >= 0 ? '+' : ''}${fmt(br)} clicks).`], maybe: ['Brand demand follows marketing, news and seasonality; it is not usually the result of SEO work.'] });
    }
    // unusual days: more than 3 robust deviations from the median of the period
    if (daily && daily.length >= 21) {
      const v = daily.map(r => r.clicks).slice().sort((a, b) => a - b), med = v[v.length >> 1];
      const mad = daily.map(r => Math.abs(r.clicks - med)).sort((a, b) => a - b)[daily.length >> 1] || 1;
      const odd = daily.filter(r => Math.abs(r.clicks - med) / (1.4826 * mad) > 3.5).sort((a, b) => Math.abs(b.clicks - med) - Math.abs(a.clicks - med)).slice(0, 4);
      if (odd.length) out.push({ id: 'odd', tone: 'info', title: `${odd.length} unusual day${odd.length === 1 ? '' : 's'} in this period`, facts: odd.map(r => `${r.d}: ${fmt(r.clicks)} clicks (typical day about ${fmt(med)}).`), maybe: ['Spikes often come from news, a viral page or a seasonal event; drops from outages, indexing problems or a Google update around that date.'] });
    }
    // weekday pattern
    if (daily && daily.length >= 28) {
      const by = [0, 0, 0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0, 0, 0];
      daily.forEach(r => { const w = (new Date(toUTC(r.d)).getUTCDay() + 6) % 7; by[w] += r.clicks; n[w]++; });
      const avg = by.map((c, i) => n[i] ? c / n[i] : 0), mean = avg.reduce((s, x) => s + x, 0) / 7;
      const lo = avg.indexOf(Math.min(...avg)), hi = avg.indexOf(Math.max(...avg));
      const W = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
      if (mean && (avg[hi] - avg[lo]) / mean >= 0.2) out.push({ id: 'week', tone: 'info', title: `Clicks peak on ${W[hi]} and dip on ${W[lo]}`, facts: [`${W[hi]} average ${fmt(avg[hi])} clicks, ${W[lo]} ${fmt(avg[lo])} (${Math.round((avg[hi] - avg[lo]) / mean * 100)}% of the daily average apart).`], maybe: ['Compare weeks with weeks rather than single days, and publish ahead of the peak days.'] });
    }
    return out;
  }

  // ── recommendations from the movers: each names its evidence and links to an existing report ──
  function recommendations(ctx) {
    const { movP, movQ, cur, base, seasonal, pathOf } = ctx;
    const out = [];
    const P = pathOf || (u => u);
    if (movP) {
      movP.losers.filter(r => !r.uncertain).forEach(r => {
        const posDrop = r.pos != null && r.prevPos != null && r.pos - r.prevPos >= 1;
        const imprDrop = pct(r.impr, r.prevImpr);
        const ctrDrop = r.prevCtr && r.ctr < r.prevCtr * 0.75 && !(imprDrop != null && imprDrop <= -20);
        let action, view, label;
        if (r.gone) { action = 'Check it still returns 200, is indexable and is not redirected or blocked; then inspect it in Search Console.'; view = '#indexing'; label = 'Indexing'; }
        else if (posDrop) { action = `It slipped from position ${r.prevPos.toFixed(1)} to ${r.pos.toFixed(1)}. See what outranks it now, refresh facts and depth, and restore internal links.`; view = '#decay'; label = 'Losing ground'; }
        else if (ctrDrop) { action = `CTR fell from ${r.prevCtr.toFixed(1)}% to ${r.ctr.toFixed(1)}% at a similar position. Check the results page for new features and rewrite the title and description.`; view = '#ctr'; label = 'Titles to rewrite'; }
        else if (imprDrop != null && imprDrop <= -20) { action = `Impressions fell ${Math.abs(imprDrop).toFixed(0)}%. ${seasonal ? 'Last year shows a similar seasonal dip, so check demand before changing the page.' : 'Check whether demand for its searches fell or it lost visibility for its main searches.'}`; view = '#decay'; label = 'Losing ground'; }
        else return;
        out.push({ kind: 'recover', title: P(r.p), url: r.p, impact: -r.d, evidence: `${fmt(r.prev)} → ${fmt(r.clicks)} clicks (${moverWhy(r)})`, action, view, label });
      });
      movP.winners.filter(r => !r.isNew && r.pos != null && r.pos > 3.5 && r.pos <= 15 && pct(r.impr, r.prevImpr) > 10).slice(0, 3).forEach(r => out.push({ kind: 'grow', title: P(r.p), url: r.p, impact: r.d,
        evidence: `Gaining: ${fmt(r.prev)} → ${fmt(r.clicks)} clicks, impressions ${sg(pct(r.impr, r.prevImpr))}, position ${r.pos.toFixed(1)}`, action: 'Momentum on a page not yet in the top 3: strengthen it now with internal links from your strongest pages and a content refresh.', view: '#quickwins', label: 'Almost page one' }));
    }
    if (movQ) movQ.winners.filter(r => r.isNew && r.impr >= 50).slice(0, 2).forEach(r => out.push({ kind: 'grow', title: `“${r.q}”`, url: null, impact: r.d, evidence: `New search: ${fmt(r.impr)} impressions, ${fmt(r.clicks)} clicks at position ${r.pos ? r.pos.toFixed(1) : '—'}`, action: 'A new search is showing your site. Make sure the ranking page answers it directly and targets it in its title or a heading.', view: '#queries', label: 'Queries' }));
    if (cur && base && cur.impr && base.impr && cur.ctr < base.ctr * 0.85 && pct(cur.impr, base.impr) > -10) out.push({ kind: 'site', title: 'Site-wide CTR drop', url: null, impact: Math.max(0, (base.ctr - cur.ctr) / 100 * cur.impr), evidence: `CTR ${base.ctr.toFixed(2)}% → ${cur.ctr.toFixed(2)}% with steady impressions`, action: 'Review titles on the highest-impression pages and check for new results-page features on your main searches.', view: '#ctr', label: 'Titles to rewrite' });
    out.sort((a, b) => b.impact - a.impact);
    const max = out.length ? out[0].impact : 0;
    out.forEach(r => { r.priority = r.impact >= max * 0.5 ? 'High' : r.impact >= max * 0.15 ? 'Medium' : 'Low'; });
    return out.slice(0, 10);
  }

  // ── sample history for the fictional site: its 90 loaded days, extended back with a fixed pattern ──
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  function demoHistory(C) {
    const H = index(C); if (!H.first) return [];
    const R = rng(97), tail = H.rows.slice(0, 28), base = totals(tail), perDay = base.clicks / tail.length, imprDay = base.impr / tail.length;
    const season = [0.78, 0.82, 0.95, 1.08, 1.12, 0.92, 0.88, 0.97, 1.05, 1.15, 1.2, 0.9]; // treks: spring and autumn peaks
    const out = [];
    for (let i = 486 - H.rows.length; i >= 1; i--) {
      const d = add(H.first, -i), t = new Date(toUTC(d)), m = t.getUTCMonth(), wd = t.getUTCDay();
      const growth = 0.62 + 0.38 * (1 - i / 486), s = season[m] / season[new Date(toUTC(H.first)).getUTCMonth()];
      const w = (wd === 0 || wd === 6 ? 1.15 : 1) * (0.9 + R() * 0.2);
      const clicks = Math.round(perDay * growth * s * w), impr = Math.round(imprDay * growth * s * (0.93 + R() * 0.14));
      out.push({ d, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: 12.4 + (1 - growth) * 4 + (R() - 0.5) });
    }
    return out.concat(H.rows);
  }

  window.CW_STATS = { DAY, add, diff, isDate, yearAgo, pct, totals, index, span, covered, period, PRESETS, presetRange, clampRange, comparisons, bucketOf, buckets, labelOf, standard, delta, breadth, movers, moverWhy, insights, recommendations, demoHistory, fmt };
})();

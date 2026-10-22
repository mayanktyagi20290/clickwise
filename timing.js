// Clickwise Best Day & Time analysis (Statistics & Trends › Best day & time). Pure functions: no DOM, no
// network. Google Search Console only: it measures when people searched Google and clicked, not website
// visitors or social audiences, and nothing here suggests that publishing at a given day or hour changes rankings.
// Daily rows: { d, clicks, impr, pos }. Hourly rows: { h: ISO timestamp with offset, clicks, impr, pos }.
(function () {
  'use strict';
  const DAY = 864e5, HOUR = 36e5;
  const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const ds = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => ds(toUTC(s) + n * DAY);
  const wdOf = s => (new Date(toUTC(s)).getUTCDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const WDS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const sum = (a, k) => a.reduce((s, r) => s + (+r[k] || 0), 0);
  const tot = rows => { const clicks = sum(rows, 'clicks'), impr = sum(rows, 'impr'), pw = rows.reduce((s, r) => s + (+r.pos || 0) * (+r.impr || 0), 0); return { clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: impr ? pw / impr : null }; };
  function index(daily) {
    const rows = (daily || []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d)).map(r => ({ d: r.d, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })).sort((a, b) => a.d.localeCompare(b.d));
    return { rows, map: new Map(rows.map(r => [r.d, r])), first: rows.length ? rows[0].d : null, last: rows.length ? rows[rows.length - 1].d : null };
  }
  // a day inside the history without a row had no impressions
  const dayOf = (H, d) => H.map.get(d) || { d, clicks: 0, impr: 0, pos: 0 };

  // ── complete Monday–Sunday weeks ending on or before the last day of data ──
  function weeks(H, want) {
    if (!H.last) return { list: [], want };
    let end = wdOf(H.last) === 6 ? H.last : add(H.last, -wdOf(H.last) - 1);
    const list = [];
    while (list.length < want) { const start = add(end, -6); if (start < H.first) break; list.unshift({ start, end, days: Array.from({ length: 7 }, (_, i) => dayOf(H, add(start, i))) }); end = add(start, -1); }
    return { list, want, start: list.length ? list[0].start : null, end: list.length ? list[list.length - 1].end : null };
  }

  // ── Best Day Analyzer ──
  // Each week is normalised (a day's share of that week × 7, so 1.0 = an average day that week). That removes
  // growth or decline between weeks, and medians and per-week ranks keep one spike from deciding the answer.
  function weekdays(H, want) {
    const W = weeks(H, Math.max(1, want || 12));
    const n = W.list.length;
    const res = { weeks: n, want: W.want, start: W.start, end: W.end, enough: n >= 8, days: [], best: null, weakest: null, verdict: null };
    if (!n) return res;
    const idx = W.list.map(w => { const t = sum(w.days, 'clicks'); return w.days.map(d => t ? d.clicks / t * 7 : null); });
    const iIdx = W.list.map(w => { const t = sum(w.days, 'impr'); return w.days.map(d => t ? d.impr / t * 7 : null); });
    for (let k = 0; k < 7; k++) {
      const vals = W.list.map(w => w.days[k]), ix = idx.map(r => r[k]).filter(v => v != null);
      const t = tot(vals);
      const above = ix.filter(v => v > 1).length, below = ix.filter(v => v < 1).length;
      const ranks = idx.map(r => { if (r[k] == null) return null; return 1 + r.filter(v => v != null && v > r[k]).length; }).filter(v => v != null);
      const meanC = t.clicks / n, medC = median(vals.map(v => v.clicks));
      res.days.push({ k, name: WD[k], short: WDS[k], weekend: k >= 5, n,
        avgClicks: meanC, medianClicks: medC, avgImpr: t.impr / n, ctr: t.ctr, pos: t.pos,
        index: median(ix), imprIndex: median(iIdx.map(r => r[k]).filter(v => v != null)),
        above, below, top: ranks.filter(r => r === 1).length, bottom: ranks.filter(r => r === 7).length,
        // mean far above median: a few unusual days lift the average
        spiky: medC != null && medC > 0 && meanC > medC * 1.25, values: vals.map(v => ({ d: v.d, clicks: v.clicks })) });
    }
    const order = res.days.slice().sort((a, b) => (b.index || 0) - (a.index || 0));
    const b = order[0], s2 = order[1], w = order[6], w2 = order[5];
    // paired comparison across weeks: in how many weeks did the leader beat the runner-up?
    const beats = (x, y) => idx.filter(r => r[x.k] != null && r[y.k] != null && r[x.k] > r[y.k]).length;
    const bw = beats(b, s2), ww = beats(w2, w);
    const clear = (wins, of) => of >= 6 && wins / of >= 0.75;
    res.best = { ...b, beatsRunnerUp: bw, runnerUp: s2.name, clear: clear(bw, n), consistent: b.above / n >= 0.7 };
    res.weakest = { ...w, beatenBy: ww, runnerUp: w2.name, clear: clear(ww, n), consistent: w.below / n >= 0.7 };
    res.strong = res.days.filter(d => d.above / n >= 0.75).map(d => d.name);
    res.weak = res.days.filter(d => d.below / n >= 0.75).map(d => d.name);
    const wk = res.days.filter(d => !d.weekend), we = res.days.filter(d => d.weekend);
    const avg = (l, f) => l.reduce((s, d) => s + f(d), 0) / l.length;
    const wkT = tot(W.list.flatMap(x => x.days.slice(0, 5))), weT = tot(W.list.flatMap(x => x.days.slice(5)));
    // typical (median) days, so one spike on a Saturday or Sunday cannot swing the comparison
    res.weekend = { weekdayAvg: avg(wk, d => d.medianClicks), weekendAvg: avg(we, d => d.medianClicks), weekdayMean: avg(wk, d => d.avgClicks), weekendMean: avg(we, d => d.avgClicks), weekdayCtr: wkT.ctr, weekendCtr: weT.ctr, weekdayPos: wkT.pos, weekendPos: weT.pos, weekdayImpr: avg(wk, d => d.avgImpr), weekendImpr: avg(we, d => d.avgImpr) };
    res.weekend.diff = res.weekend.weekdayAvg ? (res.weekend.weekendAvg - res.weekend.weekdayAvg) / res.weekend.weekdayAvg * 100 : null;
    const spread = (b.index || 0) - (w.index || 0);
    res.verdict = !res.enough ? 'few' : spread < 0.08 ? 'flat' : res.best.clear ? 'clear' : 'close';
    return res;
  }

  // ── daily calendar, best and weakest dates, spikes and drops ──
  // A day's expected clicks = its weekday's usual share (idx, from the weekday analysis) × the level of the 3 days
  // either side of it (each divided by its own weekday share). Comparing with neighbours, not with weeks ago,
  // means a gradual rise or fall is not reported as a string of spikes or drops.
  function calendar(H, start, end, idx) {
    const cells = [];
    if (!H.last) return { cells, max: 0 };
    const ix = k => (idx && idx[k] > 0 ? idx[k] : 1);
    const s = start < H.first ? H.first : start, e = end > H.last ? H.last : end;
    for (let d = s; d <= e; d = add(d, 1)) {
      const r = dayOf(H, d), nb = [];
      for (let o = -3; o <= 3; o++) { if (!o) continue; const x = add(d, o); if (x < H.first || x > H.last) continue; nb.push(dayOf(H, x).clicks / ix(wdOf(x))); }
      const expected = nb.length >= 3 ? median(nb) * ix(wdOf(d)) : null;
      cells.push({ d, wd: wdOf(d), clicks: r.clicks, impr: r.impr, ctr: r.impr ? r.clicks / r.impr * 100 : 0, pos: r.impr ? r.pos : null, typical: expected, vsTypical: expected ? (r.clicks - expected) / expected * 100 : null });
    }
    // robust spread of the day-to-expected ratios in this calendar
    const res = cells.filter(c => c.vsTypical != null).map(c => c.vsTypical);
    const m = median(res) || 0, mad = median(res.map(v => Math.abs(v - m))) || 0;
    cells.forEach(c => { c.z = c.vsTypical == null ? null : (c.vsTypical - m) / Math.max(1.4826 * mad, c.typical ? 100 / Math.sqrt(Math.max(1, c.typical)) : 1, 2); });
    const max = Math.max(1, ...cells.map(c => c.clicks));
    // colour levels by rank within the window (quintiles), so day-to-day differences show even when no day is near zero
    const sorted = cells.map(c => c.clicks).sort((x, y) => x - y);
    const q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
    cells.forEach(c => { c.level = c.clicks <= 0 ? 0 : 1 + cuts.filter(x => c.clicks > x).length; });
    return { cells, max, start: s, end: e, cuts };
  }
  function extremes(cal, n) {
    const c = cal.cells.slice();
    return { best: c.slice().sort((a, b) => b.clicks - a.clicks).slice(0, n || 5), weakest: c.slice().sort((a, b) => a.clicks - b.clicks).slice(0, n || 5) };
  }
  // unusual days: at least 3.5 robust deviations from the calendar's typical day-to-expected ratio, and 20% away
  function anomalies(cal) {
    return cal.cells.filter(c => c.z != null && Math.abs(c.z) >= 3.5 && Math.abs(c.vsTypical) >= 20).map(c => ({ ...c, kind: c.z > 0 ? 'spike' : 'drop' })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }

  // ── hourly (Search Console keeps about 10 days; the latest hours are preliminary) ──
  function hourly(rows, firstIncomplete) {
    const list = (rows || []).map(r => ({ ts: Date.parse(r.h), h: r.h, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })).filter(r => isFinite(r.ts)).sort((a, b) => a.ts - b.ts);
    if (!list.length) return { empty: true, rows: [] };
    const inc = firstIncomplete ? Date.parse(firstIncomplete) : null;
    const withData = list.filter(r => r.impr > 0);
    const first = list[0].ts, last = (withData.length ? withData[withData.length - 1] : list[list.length - 1]).ts;
    // fill the gaps: an hour inside the window without a row had no impressions
    const map = new Map(list.map(r => [r.ts, r])), all = [];
    for (let t = first; t <= last; t += HOUR) { const r = map.get(t); all.push(r ? { ...r, prelim: inc != null && t >= inc } : { ts: t, clicks: 0, impr: 0, pos: 0, prelim: inc != null && t >= inc, filled: true }); }
    const final = all.filter(r => !r.prelim);
    return { empty: false, rows: all, first, last, hours: all.length, days: all.length / 24, incomplete: isFinite(inc) ? inc : null, finalHours: final.length, prelimHours: all.length - final.length };
  }
  // Hour of day in a given IANA time zone, from final hours only. Descriptive for the days observed.
  function hourProfile(H, tz) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', hourCycle: 'h23' });
    const by = Array.from({ length: 24 }, (_, h) => ({ h, clicks: 0, impr: 0, n: 0 }));
    (H.rows || []).filter(r => !r.prelim).forEach(r => { const h = +fmt.format(new Date(r.ts)) % 24; by[h].clicks += r.clicks; by[h].impr += r.impr; by[h].n++; });
    by.forEach(b => { b.avgClicks = b.n ? b.clicks / b.n : null; b.ctr = b.impr ? b.clicks / b.impr * 100 : null; });
    const days = Math.min(...by.map(b => b.n));
    return { by, days, tz: tz || 'UTC' };
  }
  // keep only complete (final) hours when archiving; merge newer values over older ones
  function mergeArchive(prev, H) {
    const m = new Map((Array.isArray(prev) ? prev : []).filter(r => r && isFinite(r.t)).map(r => [r.t, r]));
    (H.rows || []).filter(r => !r.prelim && !r.filled).forEach(r => m.set(r.ts, { t: r.ts, c: r.clicks, i: r.impr, p: +r.pos.toFixed(2) }));
    const out = [...m.values()].sort((a, b) => a.t - b.t);
    return out.slice(-24 * 400);
  }
  const archiveRows = arc => (arc || []).map(r => ({ ts: r.t, clicks: r.c, impr: r.i, pos: r.p, prelim: false }));

  // ── pages and queries ──
  // pages with the most clicks on each weekday, from date × page rows (average per occurrence of that weekday)
  function pagesByWeekday(rows, W, n) {
    const days = new Map(); if (W && W.start) for (let d = W.start; d <= W.end; d = add(d, 1)) days.set(d, wdOf(d));
    const count = [0, 0, 0, 0, 0, 0, 0]; days.forEach(k => count[k]++);
    const by = Array.from({ length: 7 }, () => new Map());
    (rows || []).forEach(r => { const k = days.get(r.d); if (k == null) return; const m = by[k]; const o = m.get(r.p) || { p: r.p, clicks: 0, impr: 0 }; o.clicks += r.clicks; o.impr += r.impr; m.set(r.p, o); });
    return by.map((m, k) => ({ k, name: WD[k], short: WDS[k], top: [...m.values()].map(o => ({ ...o, avg: count[k] ? o.clicks / count[k] : 0 })).sort((a, b) => b.clicks - a.clicks).slice(0, n || 5) }));
  }
  // One row per page (the top pages by clicks, plus every weekday's leader): average clicks on each weekday and
  // the page's own peak, so it is clear which pages lean to which day. A peak counts only if that weekday is
  // at least 10% above the page's average day and was its best day in at least half of the weeks.
  function pageWeekMatrix(rows, W, n) {
    const days = new Map(); if (W && W.start) for (let d = W.start; d <= W.end; d = add(d, 1)) days.set(d, wdOf(d));
    const count = [0, 0, 0, 0, 0, 0, 0]; days.forEach(k => count[k]++);
    const weekOf = d => Math.floor((toUTC(d) - toUTC(W.start)) / (7 * DAY));
    const m = new Map();
    (rows || []).forEach(r => { const k = days.get(r.d); if (k == null) return; const o = m.get(r.p) || { p: r.p, c: [0, 0, 0, 0, 0, 0, 0], total: 0, wk: new Map() }; o.c[k] += r.clicks; o.total += r.clicks; const w = weekOf(r.d); const a = o.wk.get(w) || [0, 0, 0, 0, 0, 0, 0]; a[k] += r.clicks; o.wk.set(w, a); m.set(r.p, o); });
    const all = [...m.values()].map(o => {
      const avg = o.c.map((v, k) => count[k] ? v / count[k] : 0), mean = avg.reduce((s, v) => s + v, 0) / 7;
      const best = avg.indexOf(Math.max(...avg)), lift = mean ? (avg[best] - mean) / mean * 100 : 0;
      const weeks = [...o.wk.values()], wins = weeks.filter(a => a.indexOf(Math.max(...a)) === best).length;
      // a near-tie with the runner-up (within 5%) is not one peak day; it may be a shared one below
      const second = Math.max(...avg.filter((_, k) => k !== best));
      const peak = lift >= 10 && weeks.length >= 4 && wins / weeks.length >= 0.5 && second < avg[best] * 0.95;
      // two days sharing the lead (often Saturday and Sunday): their average is 15%+ above the page's average day
      // and one of them was the page's best day in at least 75% of the weeks
      let pair = null;
      if (!peak && weeks.length >= 4) {
        const ord = avg.map((v, k) => [v, k]).sort((x, y) => y[0] - x[0]), k1 = ord[0][1], k2 = ord[1][1];
        const pl = mean ? ((avg[k1] + avg[k2]) / 2 - mean) / mean * 100 : 0;
        const pw = weeks.filter(a => { const b = a.indexOf(Math.max(...a)); return b === k1 || b === k2; }).length;
        if (pl >= 15 && pw / weeks.length >= 0.75) pair = { days: [k1, k2].sort((x, y) => x - y), lift: pl, wins: pw };
      }
      return { p: o.p, avg, mean, total: o.total, perDay: o.total / Math.max(1, days.size), best, lift, wins, weeks: weeks.length, peak, pair };
    }).sort((a, b) => b.total - a.total);
    const pick = new Set(all.slice(0, n || 15).map(r => r.p));
    for (let k = 0; k < 7; k++) { const lead = all.slice().sort((a, b) => b.avg[k] - a.avg[k])[0]; if (lead) pick.add(lead.p); }
    const leaders = Array.from({ length: 7 }, (_, k) => { const l = all.slice().sort((a, b) => b.avg[k] - a.avg[k])[0]; return l ? l.p : null; });
    return { rows: all.filter(r => pick.has(r.p)), leaders, pages: all.length };
  }
  // pages whose weekly clicks swing a lot (coefficient of variation), with enough clicks to matter
  function inconsistent(rows, W, minClicks) {
    if (!W || !W.list || !W.list.length) return [];
    const wk = d => { for (let i = 0; i < W.list.length; i++) if (d >= W.list[i].start && d <= W.list[i].end) return i; return -1; };
    const m = new Map();
    (rows || []).forEach(r => { const i = wk(r.d); if (i < 0) return; const o = m.get(r.p) || { p: r.p, w: new Array(W.list.length).fill(0) }; o.w[i] += r.clicks; m.set(r.p, o); });
    const out = [];
    m.forEach(o => { const t = o.w.reduce((s, v) => s + v, 0); if (t < (minClicks || 50)) return; const mean = t / o.w.length; const sd = Math.sqrt(o.w.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, o.w.length - 1)); const cv = mean ? sd / mean : 0;
      // above counting noise: Poisson spread alone would give about 1/√mean
      if (cv >= 0.5 && cv > 2 / Math.sqrt(Math.max(1, mean))) out.push({ p: o.p, weekly: o.w, total: t, mean, cv, maxW: Math.max(...o.w), minW: Math.min(...o.w) }); });
    return out.sort((a, b) => b.total * b.cv - a.total * a.cv).slice(0, 15);
  }
  // high impressions, CTR well below what this site's pages get at a similar position
  function lowCtr(pages, n) {
    const P = (pages || []).filter(r => r.impr > 0 && r.pos > 0);
    if (P.length < 10) return [];
    const band = pos => pos <= 1.5 ? 1 : pos <= 2.5 ? 2 : pos <= 3.5 ? 3 : pos <= 5.5 ? 5 : pos <= 10.5 ? 10 : pos <= 20.5 ? 20 : 99;
    const groups = new Map(); P.forEach(r => { const b = band(r.pos); (groups.get(b) || groups.set(b, []).get(b)).push(r); });
    const exp = new Map(); groups.forEach((l, b) => { if (l.length >= 5) exp.set(b, median(l.map(r => r.clicks / r.impr * 100))); });
    const floor = median(P.map(r => r.impr)) * 2;
    return P.filter(r => r.impr >= Math.max(100, floor) && exp.has(band(r.pos))).map(r => { const e = exp.get(band(r.pos)), ctr = r.clicks / r.impr * 100; return { ...r, ctr, expected: e, gap: e ? (e - ctr) / 100 * r.impr : 0 }; })
      .filter(r => r.expected && r.ctr < r.expected * 0.6 && r.pos <= 20.5).sort((a, b) => b.gap - a.gap).slice(0, n || 15);
  }
  // pages moving up or down in position with enough impressions in both periods
  function rankMoves(cur, base, n) {
    const bm = new Map((base || []).map(r => [r.p, r]));
    const rows = (cur || []).map(r => { const b = bm.get(r.p); return b && r.impr >= 50 && b.impr >= 50 && r.pos && b.pos ? { p: r.p, pos: r.pos, prevPos: b.pos, d: r.pos - b.pos, clicks: r.clicks, prevClicks: b.clicks, impr: r.impr, prevImpr: b.impr } : null; }).filter(Boolean).filter(r => Math.abs(r.d) >= 1);
    return { up: rows.filter(r => r.d < 0).sort((a, b) => a.d * Math.sqrt(a.impr) - b.d * Math.sqrt(b.impr)).slice(0, n || 10), down: rows.filter(r => r.d > 0).sort((a, b) => b.d * Math.sqrt(b.impr) - a.d * Math.sqrt(a.impr)).slice(0, n || 10) };
  }
  // recent spikes: last 7 days' daily average against the 28 days before
  function spikes(recent, before, key, n) {
    const bm = new Map((before || []).map(r => [r[key], r]));
    const out = [];
    (recent || []).forEach(r => { const b = bm.get(r[key]); const now = r.clicks / 7, was = b ? b.clicks / 28 : 0; if (r.clicks < 20) return; const ratio = was ? now / was : Infinity; if (ratio >= 2 && (now - was) * 7 >= Math.max(10, 3 * Math.sqrt(r.clicks))) out.push({ [key]: r[key], clicks7: r.clicks, perDay: now, before: was, ratio, isNew: !b }); });
    const drops = [];
    (before || []).forEach(b => { const r = (recent || []).find(x => x[key] === b[key]); const was = b.clicks / 28, now = r ? r.clicks / 7 : 0; if (b.clicks < 56) return; if (now <= was * 0.4 && (was - now) * 7 >= Math.max(10, 3 * Math.sqrt(b.clicks / 4))) drops.push({ [key]: b[key], clicks7: r ? r.clicks : 0, perDay: now, before: was, ratio: was ? now / was : 0 }); });
    return { up: out.sort((a, b) => (b.perDay - b.before) - (a.perDay - a.before)).slice(0, n || 10), down: drops.sort((a, b) => (b.before - b.perDay) - (a.before - a.perDay)).slice(0, n || 10) };
  }

  // ── recommendations (fixed rules over the findings; each says what it is based on) ──
  function recommendations(x) {
    const out = [], P = x.pathOf || (u => u);
    (x.anomalies || []).filter(a => a.kind === 'drop').slice(0, 2).forEach(a => out.push({ kind: 'investigate', priority: 'High', title: `Investigate the drop on ${a.d}`, evidence: `${Math.round(a.clicks).toLocaleString('en-US')} clicks vs about ${Math.round(a.typical).toLocaleString('en-US')} expected for a ${WD[a.wd]} at that week's level (${Math.round(a.vsTypical)}%).`, action: 'Check for outages, deploys, robots or indexing changes and Google updates around that date; compare pages and searches for that day with the same weekday a week earlier.' }));
    (x.spikesP && x.spikesP.down || []).slice(0, 3).forEach(r => out.push({ kind: 'investigate', priority: 'High', title: `${P(r.p)} lost most of its recent clicks`, url: r.p, evidence: `${r.perDay.toFixed(1)} clicks a day in the last 7 days vs ${r.before.toFixed(1)} in the 28 days before.`, action: 'Inspect the URL (status, indexing, canonical) and check what now ranks for its main searches.' }));
    (x.lowCtr || []).slice(0, 4).forEach(r => out.push({ kind: 'snippet', priority: r.gap >= 100 ? 'High' : 'Medium', title: `Improve the snippet for ${P(r.p)}`, url: r.p, evidence: `${Math.round(r.impr).toLocaleString('en-US')} impressions at position ${r.pos.toFixed(1)}, CTR ${r.ctr.toFixed(1)}% vs ${r.expected.toFixed(1)}% for this site's pages at that position.`, action: 'Rewrite the title and meta description around the main search; check whether a results-page feature is taking the click.' }));
    (x.inconsistent || []).slice(0, 3).forEach(r => out.push({ kind: 'inconsistent', priority: 'Medium', title: `Review ${P(r.p)}: clicks swing week to week`, url: r.p, evidence: `Weekly clicks ranged ${r.minW}–${r.maxW} over ${r.weekly.length} weeks (variation ${Math.round(r.cv * 100)}%).`, action: 'Check whether it depends on news or seasonal demand, loses rankings intermittently, or competes with another page for the same searches.' }));
    (x.rankUp || []).filter(r => r.pos > 3).slice(0, 3).forEach(r => out.push({ kind: 'gaining', priority: 'Medium', title: `${P(r.p)} is gaining visibility`, url: r.p, evidence: `Position ${r.prevPos.toFixed(1)} → ${r.pos.toFixed(1)}, impressions ${Math.round(r.prevImpr)} → ${Math.round(r.impr)}.`, action: 'Not in the top 3 yet: strengthen it with internal links from strong pages, expand the sections searchers need, and refresh the title.' }));
    (x.spikesP && x.spikesP.up || []).slice(0, 2).forEach(r => out.push({ kind: 'gaining', priority: 'Low', title: `Recent spike on ${P(r.p)}`, url: r.p, evidence: `${r.perDay.toFixed(1)} clicks a day in the last 7 days vs ${r.before.toFixed(1)} before${r.isNew ? ' (new)' : ''}.`, action: 'Find which searches drive it (Queries) and whether it is news-driven or lasting; link to it from related pages while demand is high.' }));
    const rank = { High: 0, Medium: 1, Low: 2 };
    return out.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 12);
  }

  window.CW_TIMING = { WD, WDS, add, wdOf, median, tot, index, weeks, weekdays, calendar, extremes, anomalies, hourly, hourProfile, mergeArchive, archiveRows, pagesByWeekday, pageWeekMatrix, inconsistent, lowCtr, rankMoves, spikes, recommendations };
})();

// Clickwise fix tracker — did a change to a page work? Pure functions: no DOM, no network.
// A fix is { id, url, path, date (YYYY-MM-DD), note }. Its effect is measured on equal windows before and
// after the change date (the change day itself is left out), in daily clicks, and compared with the site's
// own change over the same windows so a site-wide rise or fall is not credited to the fix.
(function () {
  'use strict';
  const CW = window.CW;
  const DAY = 864e5;
  const iso = d => new Date(d).toISOString().slice(0, 10);
  const add = (s, n) => iso(Date.parse(s + 'T00:00:00Z') + n * DAY);
  const diff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && iso(Date.parse(s + 'T00:00:00Z')) === s;
  const MAX_WINDOW = 28, MIN_AFTER = 7;

  // ── checking a fix before it is saved ──
  // ctx: { host, latest (last day with data), earliest (first day data can exist for) }
  function validate(f, ctx) {
    const e = [];
    if (!f || typeof f !== 'object') return ['Nothing to save.'];
    if (f.scope !== 'site') {
      if (typeof f.url !== 'string' || !/^https?:\/\//i.test(f.url)) e.push('Choose a page from the list, or paste its full address (starting with https://).');
      else if (ctx && ctx.host) {
        let h = ''; try { h = new URL(f.url).hostname.replace(/^www\./, '').toLowerCase(); } catch (x) { e.push('That page address is not valid.'); }
        if (h && h !== ctx.host && !h.endsWith('.' + ctx.host)) e.push(`That page is on ${h}, not on ${ctx.host}.`);
      }
    }
    if (!isDate(f.date)) e.push('Choose the date the change went live.');
    else if (ctx) {
      if (ctx.latest && f.date > ctx.latest) e.push(`The date is after the last day with data (${ctx.latest}). Search Console data arrives about 2–3 days late.`);
      if (ctx.earliest && f.date <= ctx.earliest) e.push(`The date must be after ${ctx.earliest}, so there is data from before the change to compare with.`);
    }
    if (f.note != null && (typeof f.note !== 'string' || f.note.length > 300)) e.push('Keep the note under 300 characters.');
    return e;
  }

  // ── windows: equal length before and after, up to 28 days, never including the change day ──
  function windows(date, latest, earliest) {
    const daysAfter = Math.max(0, diff(date, latest));            // complete days after the change
    const daysBefore = earliest ? Math.max(0, diff(earliest, date)) : MAX_WINDOW;
    const L = Math.min(MAX_WINDOW, daysAfter, daysBefore);
    return { L, daysAfter, before: L ? { start: add(date, -L), end: add(date, -1) } : null, after: L ? { start: add(date, 1), end: add(date, L) } : null };
  }

  // Daily rows → one value per day in the window. Search Console leaves out days with no impressions, so a
  // missing day is zero clicks and zero impressions, not unknown.
  function series(rows, w) {
    const m = new Map((rows || []).map(r => [r.d, r]));
    const out = [];
    for (let d = w.start; d <= w.end; d = add(d, 1)) { const r = m.get(d); out.push(r ? { d, clicks: r.clicks || 0, impr: r.impr || 0, pos: r.pos || 0 } : { d, clicks: 0, impr: 0, pos: 0 }); }
    return out;
  }
  function stats(s) {
    const n = s.length, clicks = s.reduce((a, r) => a + r.clicks, 0), impr = s.reduce((a, r) => a + r.impr, 0);
    const mean = n ? clicks / n : 0, v = n > 1 ? s.reduce((a, r) => a + (r.clicks - mean) ** 2, 0) / (n - 1) : 0;
    const posW = s.reduce((a, r) => a + r.pos * r.impr, 0);
    return { days: n, clicks, impr, perDay: mean, variance: v, ctr: impr ? clicks / impr * 100 : 0, pos: impr ? posW / impr : null };
  }
  const pctChange = (a, b) => a ? (b - a) / a * 100 : null;

  // ── the measurement ──
  // pageRows / siteRows: daily rows { d, clicks, impr, pos } covering both windows (site rows may be null)
  function measure(f, pageRows, siteRows, latest, earliest, opts) {
    opts = opts || {};
    const w = windows(f.date, latest, earliest);
    const res = { fix: f, window: w, status: null, verdict: null, notes: [] };
    if (w.daysAfter < MIN_AFTER) { res.status = 'too-early'; res.notes.push(`Only ${w.daysAfter} full day${w.daysAfter === 1 ? '' : 's'} of data after the change so far; a result needs at least ${MIN_AFTER}. Search Console data arrives about 2–3 days late.`); return res; }
    if (w.L < MIN_AFTER) { res.status = 'no-before'; res.notes.push(`Only ${w.L} days of data before the change are available, so there is too little to compare with.`); return res; }
    const B = stats(series(pageRows, w.before)), A = stats(series(pageRows, w.after));
    res.before = B; res.after = A;
    res.change = { clicks: pctChange(B.perDay, A.perDay), impr: pctChange(B.impr, A.impr), ctr: B.impr && A.impr ? A.ctr - B.ctr : null, pos: B.pos != null && A.pos != null ? A.pos - B.pos : null };
    res.series = { before: series(pageRows, w.before), after: series(pageRows, w.after) };
    if (B.clicks + A.clicks < 20) { res.status = 'too-little'; res.notes.push(`${B.clicks + A.clicks} clicks across both windows: too few to tell a real change from chance.`); return res; }
    // difference in mean daily clicks, in units of its standard error (Welch)
    const se = Math.sqrt(B.variance / B.days + A.variance / A.days);
    const z = se > 0 ? (A.perDay - B.perDay) / se : (A.perDay === B.perDay ? 0 : Math.sign(A.perDay - B.perDay) * 10);
    res.z = z;
    // the site's own change over the same windows
    if (f.scope !== 'site' && siteRows && siteRows.length) {
      const SB = stats(series(siteRows, w.before)), SA = stats(series(siteRows, w.after));
      res.site = { before: SB, after: SA, change: pctChange(SB.perDay, SA.perDay), label: opts.siteLabel || 'site' };
      if (res.change.clicks != null && res.site.change != null) res.relative = ((1 + res.change.clicks / 100) / (1 + res.site.change / 100) - 1) * 100;
    }
    const rel = res.relative != null ? res.relative : res.change.clicks;
    const dir = rel > 0 ? 'up' : 'down';
    res.status = 'measured';
    // A change counts when it is clear of daily noise (|z| ≥ 2) AND larger than the site's own movement.
    const beyondSite = res.relative == null || Math.abs(res.relative) >= 10;
    if (Math.abs(z) >= 2 && beyondSite && Math.sign(z) === Math.sign(rel)) res.verdict = dir === 'up' ? 'improved' : 'declined';
    // "probably" needs 1.5 standard errors and a 10% move: smaller shifts happen by chance too often to report
    else if (Math.abs(z) >= 1.5 && Math.abs(rel) >= 10 && Math.sign(z) === Math.sign(rel)) res.verdict = dir === 'up' ? 'maybe-improved' : 'maybe-declined';
    else res.verdict = 'no-change';
    if (res.site && res.site.change != null && Math.abs(res.site.change) >= 10) res.notes.push(`The whole ${res.site.label || 'site'} changed ${res.site.change > 0 ? '+' : ''}${res.site.change.toFixed(0)}% over the same days, so the page's own effect is about ${res.relative > 0 ? '+' : ''}${res.relative.toFixed(0)}%.`);
    if (w.L < MAX_WINDOW) res.notes.push(`Measured on ${w.L} days each side; the result firms up as more days arrive (up to ${MAX_WINDOW}).`);
    res.notes.push('Before and after cannot rule out other causes (seasons, a Google update, other edits). Treat this as evidence, not proof.');
    return res;
  }

  const VERDICT = {
    improved: 'Worked: clicks rose clearly', declined: 'Clicks fell clearly', 'maybe-improved': 'Leaning up, not yet clear', 'maybe-declined': 'Leaning down, not yet clear',
    'no-change': 'No clear change yet'
  };
  const STATUS = { 'too-early': 'Waiting for data', 'no-before': 'Not enough data before', 'too-little': 'Too little traffic to tell' };
  const label = r => r.status === 'measured' ? VERDICT[r.verdict] : STATUS[r.status] || '—';

  // which searches gained or lost the most clicks between the windows (rows: { q, clicks, impr, pos })
  function queryShift(beforeRows, afterRows) {
    const m = new Map();
    (beforeRows || []).forEach(r => m.set(r.q, { q: r.q, before: r, after: null }));
    (afterRows || []).forEach(r => { const o = m.get(r.q) || { q: r.q, before: null, after: null }; o.after = r; m.set(r.q, o); });
    const rows = [...m.values()].map(o => ({ q: o.q, b: o.before ? o.before.clicks : 0, a: o.after ? o.after.clicks : 0, bPos: o.before ? o.before.pos : null, aPos: o.after ? o.after.pos : null, d: (o.after ? o.after.clicks : 0) - (o.before ? o.before.clicks : 0) }));
    return { gained: rows.filter(r => r.d > 0).sort((x, y) => y.d - x.d || (x.q < y.q ? -1 : 1)).slice(0, 10), lost: rows.filter(r => r.d < 0).sort((x, y) => x.d - y.d || (x.q < y.q ? -1 : 1)).slice(0, 10) };
  }

  window.CW_FIXES = { validate, windows, series, stats, measure, label, queryShift, VERDICT, STATUS, add, diff, isDate, MAX_WINDOW, MIN_AFTER };
})();

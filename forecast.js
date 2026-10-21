// Clickwise growth forecast and target. Pure functions: no DOM, no network, no storage.
// Keeps four numbers apart that the dashboard used to blend together:
//   observed  — monthly clicks measured in the loaded period (fact)
//   target    — what the user wants, with a deadline (their choice)
//   opportunity — extra clicks the opportunities found could add, each click counted once (estimate)
//   forecast  — observed + opportunity, in three scenarios, with method, assumptions and confidence
(function () {
  'use strict';
  const CW = window.CW;
  const DAY = 864e5;
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(Date.parse(s + 'T00:00:00Z')).toISOString().slice(0, 10) === s;
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const GOOD = { High: true, Medium: true };
  // A target should be at least two weeks away (Search needs time to react) and at most two years.
  const MIN_PERIOD = 14, MAX_PERIOD = 730;

  // ── observed: what the loaded data measured ──
  function baseline(A, D) {
    D = D || {};
    const site = A.site || A.totAll || { clicks: 0 };
    const monthly = A.perMonth(site.clicks || 0);
    const pDays = (A.decay && A.decay.prevDays) || (D.prevC && D.prevC.length) || A.days;
    const prev = A.prevSite && A.prevSite.clicks != null && pDays ? A.prevSite.clicks * 30 / pDays : null;
    // the last 28 days against the 28 before, from daily totals: an observed direction, not a forecast
    let recent = null;
    const C = (D.C || []).filter(r => r && isDate(r.d)).slice().sort((a, b) => a.d.localeCompare(b.d));
    if (C.length >= 56) {
      const sum = l => l.reduce((s, r) => s + (+r.clicks || 0), 0);
      const last = sum(C.slice(-28)), before = sum(C.slice(-56, -28));
      recent = { last: last * 30 / 28, before: before * 30 / 28, change: before ? (last - before) / before * 100 : null };
    }
    return { monthly, clicks: site.clicks || 0, days: A.days, start: A.method && A.method.start || D.start || null, end: A.method && A.method.end || D.end || null,
      assumed: !!(A.method && A.method.assumedDays), prev, recent, source: D.source || null };
  }

  // ── opportunity: every estimated click counted once ──
  // Growth: one estimate per search (opportunities.js marks the largest one "counted"). Page estimates are
  // never added: they overlap their searches. Recovery: only declines judged recoverable. When a search with
  // a growth estimate mostly ranks on a page whose decline is being recovered, the two describe the same
  // clicks, so the overlap is taken off the recovery figure.
  function opportunity(O) {
    const items = O && O.items || [];
    const growth = items.filter(it => it.impact.counted && it.impact.kind === 'growth');
    const recovery = items.filter(it => it.impact.counted && it.impact.kind === 'recovery');
    const recPages = new Map(recovery.filter(it => it.subject.kind === 'page').map(it => [it.subject.url, it]));
    const overlap = new Map();
    growth.forEach(it => {
      const l = it.landing; if (!l || !(l.share >= 50) || !recPages.has(l.url)) return;
      const o = overlap.get(l.url) || { lo: 0, hi: 0, n: 0 }; o.lo += it.impact.lo || 0; o.hi += it.impact.hi || 0; o.n++; overlap.set(l.url, o);
    });
    const contrib = new Map(); // opportunity item id → what it adds to the forecast
    const add = (it, lo, hi, note) => contrib.set(it.id, { lo, hi, counted: hi > 0, note });
    growth.forEach(it => add(it, it.impact.lo || 0, it.impact.hi || 0, 'Counted once for this search'));
    let deduped = { lo: 0, hi: 0, n: 0 };
    recovery.forEach(it => {
      const o = overlap.get(it.subject.url);
      const lo = Math.max(0, (it.impact.lo || 0) - (o ? o.lo : 0)), hi = Math.max(0, (it.impact.hi || 0) - (o ? o.hi : 0));
      if (o) { deduped.lo += (it.impact.lo || 0) - lo; deduped.hi += (it.impact.hi || 0) - hi; deduped.n += o.n; }
      add(it, lo, hi, o ? `Recovery reduced by ${CW.fmtN(o.hi)} clicks a month already counted as growth on ${o.n} search${o.n === 1 ? '' : 'es'} ranking on this page` : 'Recoverable decline, counted once');
    });
    items.forEach(it => {
      if (contrib.has(it.id)) return;
      const note = it.impact.kind === 'recovery' && it.impact.recoverable === false ? 'Not counted: ' + it.impact.recoverWhy
        : it.impact.kind === 'none' ? 'No click estimate' : it.impact.overlap || 'Overlaps an estimate counted elsewhere';
      contrib.set(it.id, { lo: 0, hi: 0, counted: false, note });
    });
    const part = (list, pick) => list.reduce((s, it) => { const c = contrib.get(it.id); return { lo: s.lo + c.lo, hi: s.hi + c.hi, mid: s.mid + (c.lo + c.hi) / 2, n: s.n + (c.hi > 0 ? 1 : 0) }; }, { lo: 0, hi: 0, mid: 0, n: 0 });
    const good = it => GOOD[it.confidence.level];
    return {
      growth: part(growth), recovery: part(recovery),
      growthGood: part(growth.filter(good)), growthLow: part(growth.filter(it => !good(it))),
      recoveryGood: part(recovery.filter(good)), recoveryLow: part(recovery.filter(it => !good(it))),
      notRecoverable: { n: items.filter(it => it.type === 'decline-page' && it.impact.recoverable === false).length, hi: items.filter(it => it.type === 'decline-page' && it.impact.recoverable === false).reduce((s, it) => s + (it.impact.hi || 0), 0) },
      deduped, contrib
    };
  }
  // what a merged priority group (priority.js) adds to the forecast: the sum of its items' contributions
  function groupContribution(g, F) {
    const c = (g.items || [g.primary]).reduce((s, it) => { const x = F.opp.contrib.get(it.id); return x ? { lo: s.lo + x.lo, hi: s.hi + x.hi } : s; }, { lo: 0, hi: 0 });
    const p = F.opp.contrib.get(g.primary.id);
    return { lo: c.lo, hi: c.hi, counted: c.hi > 0, note: c.hi > 0 ? (p && p.counted ? p.note : 'Counted through a related signal merged here') : (p ? p.note : 'No click estimate') };
  }

  // ── forecast: observed + opportunity, three scenarios ──
  //   conservative: low ends of High and Medium confidence items only
  //   expected:     mid-points of High and Medium items + low ends of Low items
  //   optimistic:   high ends of everything counted
  function build(A, D, O) {
    O = O || A.opps;
    const b = baseline(A, D);
    if (!O) return { base: b, opp: null, scenarios: null, confidence: { level: 'Low', score: 0, why: [{ points: 0, text: 'No opportunity analysis for this data' }] }, assumptions: [], method: [], excluded: [] };
    const o = opportunity(O);
    const add = { conservative: o.growthGood.lo + o.recoveryGood.lo, expected: o.growthGood.mid + o.recoveryGood.mid + o.growthLow.lo + o.recoveryLow.lo, optimistic: o.growth.hi + o.recovery.hi };
    const scenarios = {};
    Object.entries(add).forEach(([k, v]) => { scenarios[k] = { add: v, monthly: b.monthly + v, pct: b.monthly ? v / b.monthly * 100 : null }; });

    // confidence in the forecast as a whole, with every reason
    const why = [];
    if (b.assumed) why.push([-25, 'The export has no dates, so a 90-day period was assumed for every monthly figure']);
    else if (b.days < 28) why.push([-15, `Only ${b.days} days of data`]);
    else why.push([10, `${b.days} days of data`]);
    const goodShare = o.growth.hi + o.recovery.hi ? (o.growthGood.hi + o.recoveryGood.hi) / (o.growth.hi + o.recovery.hi) * 100 : 0;
    if (goodShare >= 60) why.push([10, `${goodShare.toFixed(0)}% of the opportunity comes from High or Medium confidence items`]);
    else if (o.growth.hi + o.recovery.hi > 0) why.push([-15, `Only ${goodShare.toFixed(0)}% of the opportunity comes from High or Medium confidence items`]);
    if (A.coverage && A.coverage.notShown && A.coverage.notShown.share >= 30) why.push([-10, `${A.coverage.notShown.share.toFixed(0)}% of clicks are not attributed to listed searches, so some opportunity is not visible`]);
    if (A.coverage && A.coverage.rowLimit) why.push([-5, 'The export stops at its row limit: smaller searches are missing']);
    if (!A.decay) why.push([-5, 'No comparison period: declines and recovery were not assessed']);
    if (b.recent && b.recent.change != null && Math.abs(b.recent.change) >= 25) why.push([-10, `Clicks moved ${b.recent.change > 0 ? '+' : ''}${b.recent.change.toFixed(0)}% in the last 28 days against the 28 before: the baseline is not stable`]);
    why.push([-10, 'Search demand, seasonality, competitors and Google updates are not modelled']);
    const score = Math.max(0, Math.min(100, 50 + why.reduce((s, x) => s + x[0], 0)));
    const confidence = { score, level: score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low', why: why.map(x => ({ points: x[0], text: x[1] })) };

    const per = b.assumed ? 'an assumed 90-day period' : `${b.start || '?'} – ${b.end || '?'} (${b.days} days)`;
    const method = [
      `Baseline: ${CW.fmtN(b.monthly)} clicks a month, all searches including branded, from daily totals over ${per}, scaled to 30 days.`,
      `Growth: ${o.growth.n} non-branded search${o.growth.n === 1 ? '' : 'es'} the site already ranks for, each counted once (the largest of its estimates). Page-level estimates overlap their searches and are never added.`,
      A.decay ? `Recovery: ${o.recovery.n} declining page${o.recovery.n === 1 ? '' : 's'} judged recoverable, assuming 30–80% of the lost clicks return.${o.deduped.hi > 0 ? ` ${CW.fmtN(o.deduped.hi)} clicks a month were taken off because searches on those pages are already counted as growth.` : ''}` : 'Recovery: not assessed (no comparison period).',
      'Conservative uses the low end of High and Medium confidence items only. Expected uses their mid-points plus the low end of Low confidence items. Optimistic uses the high end of everything counted.'
    ];
    const assumptions = [
      'Every counted opportunity is implemented. Each one is an estimate for one change, not a commitment.',
      'Demand stays at the level of the baseline period: no seasonality, trend or algorithm update is modelled.',
      'Changes take effect gradually: title edits in days to weeks, rankings in weeks to months, new content in months.',
      'Branded searches, which reflect demand for the brand rather than SEO work, add nothing to the opportunity.'
    ];
    const excluded = [];
    if (o.notRecoverable.n) excluded.push(`${o.notRecoverable.n} declining page${o.notRecoverable.n === 1 ? '' : 's'} (up to ${CW.fmtN(o.notRecoverable.hi)} clicks a month) left out: likely lower demand, normal variation, or a size the export cannot measure. Not every decline can be won back with SEO.`);
    const overlapN = O.items.filter(it => (it.impact.kind === 'growth' || it.impact.kind === 'stake') && !it.impact.counted).length;
    if (overlapN) excluded.push(`${overlapN} estimate${overlapN === 1 ? '' : 's'} left out because ${overlapN === 1 ? 'it overlaps' : 'they overlap'} one already counted (the same search, or a page and its searches).`);
    const checks = O.items.filter(it => it.impact.kind === 'none').length;
    if (checks) excluded.push(`${checks} content gap${checks === 1 ? '' : 's'}, internal link${checks === 1 ? '' : 's'} and early warning${checks === 1 ? '' : 's'} have no click estimate and add nothing.`);
    return { base: b, opp: o, scenarios, confidence, method, assumptions, excluded };
  }

  // ── target ──
  // A target is { monthly, by, set, baseline }: clicks a month to reach by a date, set against the observed
  // baseline on the day it was saved. Anything read back from storage goes through normalise.
  function normaliseTarget(t) {
    if (!t || typeof t !== 'object') return null;
    const monthly = Math.round(+t.monthly);
    if (!(monthly > 0) || !isFinite(monthly)) return null;
    return { monthly, baseline: +t.baseline > 0 ? Math.round(+t.baseline) : 0, set: isDate(t.set) ? t.set : '', by: isDate(t.by) ? t.by : '', dataEnd: isDate(t.dataEnd) ? t.dataEnd : '' };
  }
  function validateTarget(input, ctx) {
    ctx = ctx || {};
    const e = [], now = ctx.today || today();
    const raw = input && input.monthly, monthly = Math.round(+raw);
    if (raw === '' || raw == null || !isFinite(+raw)) e.push('Enter the monthly clicks you want to reach.');
    else if (!(monthly > 0)) e.push('The target must be more than zero clicks a month.');
    else if (ctx.baseline != null && monthly <= Math.round(ctx.baseline)) e.push(`That is not above today’s ${CW.fmtN(ctx.baseline)} clicks a month. Set a higher target.`);
    else if (ctx.baseline > 0 && monthly > ctx.baseline * 20) e.push('That is more than 20 times today’s clicks. Check the number.');
    const by = input && input.by;
    if (!by) e.push('Choose the date to reach the target by.');
    else if (!isDate(by)) e.push('The target date is not a valid date.');
    else if (days(now, by) < MIN_PERIOD) e.push(`Choose a date at least ${MIN_PERIOD} days away: Search needs time to reflect changes.`);
    else if (days(now, by) > MAX_PERIOD) e.push('Choose a date within two years.');
    return e;
  }
  const isValidTarget = t => !!(t && t.monthly > 0 && t.baseline > 0 && t.monthly > t.baseline && isDate(t.set) && isDate(t.by) && t.by > t.set);

  // Progress is only measured from data that ends after the target was set: the period the baseline came
  // from cannot show progress against itself.
  function progress(t, current, dataEnd) {
    if (!isValidTarget(t)) return { status: 'invalid', note: t ? 'This target has no deadline or no baseline. Edit it to set the period.' : 'No target set.' };
    const after = t.dataEnd || t.set;
    if (!isDate(dataEnd) || dataEnd <= after) return { status: 'waiting', note: `Progress appears once data after ${after} is loaded. The baseline is ${CW.fmtN(t.baseline)} clicks a month.` };
    const frac = Math.max(0, Math.min(1, (current - t.baseline) / (t.monthly - t.baseline)));
    const total = days(t.set, t.by), gone = Math.max(0, Math.min(total, days(t.set, dataEnd)));
    const timeFrac = total > 0 ? gone / total : 1;
    return { status: current >= t.monthly ? 'reached' : frac + 0.1 >= timeFrac ? 'on-track' : 'behind', frac, timeFrac, current, note: `${Math.round(frac * 100)}% of the way from ${CW.fmtN(t.baseline)} to ${CW.fmtN(t.monthly)} clicks a month, with ${Math.round(timeFrac * 100)}% of the time used.` };
  }
  // How the target compares with what the opportunities found could deliver.
  function feasibility(t, F) {
    if (!t || !F || !F.scenarios) return null;
    const s = F.scenarios;
    const need = t.monthly - F.base.monthly;
    if (need <= 0) return { level: 'reached', text: 'Already at or above the target on the loaded data.' };
    if (t.monthly <= s.conservative.monthly) return { level: 'covered', text: 'Covered by the conservative forecast: High and Medium confidence opportunities reach it at their low end.' };
    if (t.monthly <= s.expected.monthly) return { level: 'likely', text: 'Within the expected forecast, if the opportunities found are implemented.' };
    if (t.monthly <= s.optimistic.monthly) return { level: 'stretch', text: 'Only reachable in the optimistic case: every counted opportunity at its high end.' };
    return { level: 'beyond', text: `About ${CW.fmtN(t.monthly - s.optimistic.monthly)} clicks a month beyond everything found. It needs new demand as well: new pages, topics or channels.` };
  }

  // A target is suggested only when the data supports one: real dates, a month of data, and at least three
  // High or Medium confidence growth items adding a meaningful amount. Otherwise the reason is given instead.
  function suggest(F, now) {
    const no = why => ({ value: null, by: null, why });
    if (!F || !F.scenarios) return no('No opportunity analysis for this data.');
    const b = F.base, o = F.opp;
    if (b.assumed) return no('The export has no dates, so monthly figures are assumed. Load data with dates to get a suggestion.');
    if (b.days < 28) return no(`Only ${b.days} days of data. A suggestion needs at least 28.`);
    if (!(b.monthly > 0)) return no('No clicks in the loaded period.');
    if (o.growthGood.n + o.recoveryGood.n < 3) return no('Fewer than three High or Medium confidence opportunities with a click estimate, so any suggested number would be a guess.');
    const lift = F.scenarios.conservative.add;
    if (lift < 20 || lift < b.monthly * 0.03) return no('The well-evidenced opportunities add less than 3% to current clicks, too little to set a target on.');
    const nice = v => { const m = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1)); return Math.round(v / m) * m; };
    const value = Math.max(Math.round(b.monthly) + 1, nice(F.scenarios.conservative.monthly));
    return { value, by: addDays(now || today(), 90), why: `The conservative forecast: today’s ${CW.fmtN(b.monthly)} a month plus the low end of ${o.growthGood.n + o.recoveryGood.n} High and Medium confidence opportunities, over about three months.` };
  }

  window.CW_FORECAST = { baseline, opportunity, groupContribution, build, normaliseTarget, validateTarget, isValidTarget, progress, feasibility, suggest, isDate, addDays, MIN_PERIOD, MAX_PERIOD };
})();

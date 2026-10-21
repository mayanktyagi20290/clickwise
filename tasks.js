// Clickwise SEO tasks — the action and measurement loop. Pure functions: no DOM, no network, no storage.
// A task comes from an opportunity (or is added by hand), moves through planned → in progress → implemented
// → validated, records what was actually changed and when, keeps a baseline captured when it was created,
// and is measured with the fix tracker's before/after method (fixes.js) over a chosen observation window.
(function () {
  'use strict';
  const FX = window.CW_FIXES;
  const STATUS = { planned: 'Planned', progress: 'In progress', implemented: 'Implemented', validated: 'Validated', dropped: 'Dropped' };
  const ORDER = ['planned', 'progress', 'implemented', 'validated', 'dropped'];
  const WINDOWS = [14, 28, 56, 90];
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

  // Baseline: the subject's numbers in the analysis loaded when the task was created.
  function baselineOf(g, D) {
    const m = g.measured || {};
    const days = D && D.days ? D.days : null;
    return { start: D && D.start || null, end: D && D.end || null, days, clicks: m.clicks, impr: m.impr, ctr: m.ctr, pos: m.pos, perDay: days && m.clicks != null ? m.clicks / days : null, source: D && D.source || null };
  }
  // from a priority group (priority.js)
  function fromOpportunity(g, D, extra) {
    const now = new Date().toISOString();
    const url = g.page ? g.page.url : g.subject.kind === 'page' ? g.subject.url : null;
    return normalise({
      id: uid(), oppId: g.id, title: (g.subject.kind === 'query' ? `“${g.subject.label}”: ` : `${g.subject.label}: `) + g.typeLabel,
      category: g.category, type: g.type, subject: { kind: g.subject.kind, label: g.subject.label, url: g.subject.url || null }, url,
      action: g.action, owner: '', due: '', status: 'planned', change: '', implDate: '', window: 28,
      estimate: { lo: g.impact.lo || 0, hi: g.impact.hi || 0, kind: g.impact.kind }, score: g.score, priority: g.priority,
      baseline: baselineOf(g, D), created: now, updated: now, history: [{ at: now, status: 'planned' }], outcome: null, ...(extra || {})
    });
  }
  function manual(o, D) {
    const now = new Date().toISOString();
    return normalise({ id: uid(), oppId: null, title: o.title, category: 'Other', type: 'manual', subject: o.url ? { kind: 'page', label: pathOf(o.url), url: o.url } : { kind: 'site', label: 'Whole site', url: null },
      url: o.url || null, action: o.action || '', owner: o.owner || '', due: o.due || '', status: 'planned', change: '', implDate: '', window: 28, estimate: null, score: null, priority: null,
      baseline: null, created: now, updated: now, history: [{ at: now, status: 'planned' }], outcome: null });
  }
  function pathOf(u) { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return String(u || ''); } }

  // Anything read back from browser storage is checked and trimmed; damaged tasks are dropped.
  function normalise(t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return null;
    const url = typeof t.url === 'string' && /^https?:\/\//i.test(t.url) ? t.url.slice(0, 2000) : null;
    const date = s => FX.isDate(s) ? s : '';
    return {
      id: t.id.slice(0, 40), oppId: typeof t.oppId === 'string' ? t.oppId.slice(0, 2100) : null, title: clean(t.title, 300) || 'Untitled task',
      category: clean(t.category, 40) || 'Other', type: clean(t.type, 30) || 'manual',
      subject: t.subject && typeof t.subject === 'object' ? { kind: ['query', 'page', 'site'].includes(t.subject.kind) ? t.subject.kind : 'site', label: clean(t.subject.label, 2000), url: typeof t.subject.url === 'string' && /^https?:\/\//i.test(t.subject.url) ? t.subject.url : null } : { kind: 'site', label: 'Whole site', url: null },
      url, action: clean(t.action, 1000), owner: clean(t.owner, 80), due: date(t.due), status: STATUS[t.status] ? t.status : 'planned',
      change: clean(t.change, 1000), implDate: date(t.implDate), window: WINDOWS.includes(+t.window) ? +t.window : 28,
      estimate: t.estimate && typeof t.estimate === 'object' ? { lo: +t.estimate.lo || 0, hi: +t.estimate.hi || 0, kind: clean(t.estimate.kind, 20) } : null,
      score: t.score == null ? null : +t.score || 0, priority: ['P1', 'P2', 'P3'].includes(t.priority) ? t.priority : null,
      baseline: t.baseline && typeof t.baseline === 'object' ? t.baseline : null,
      created: clean(t.created, 40), updated: clean(t.updated, 40),
      history: Array.isArray(t.history) ? t.history.filter(h => h && STATUS[h.status]).slice(-30).map(h => ({ at: clean(h.at, 40), status: h.status })) : [],
      outcome: t.outcome && typeof t.outcome === 'object' && t.outcome.verdict ? { verdict: clean(t.outcome.verdict, 30), relative: t.outcome.relative == null ? null : +t.outcome.relative, change: t.outcome.change == null ? null : +t.outcome.change, monthly: t.outcome.monthly == null || !isFinite(+t.outcome.monthly) ? null : +t.outcome.monthly, at: clean(t.outcome.at, 40), window: +t.outcome.window || null } : null
    };
  }
  function load(raw) { const list = Array.isArray(raw) ? raw : []; const ok = list.map(normalise).filter(Boolean); return { list: ok, damaged: list.length - ok.length }; }

  // Checks before a change is saved. ctx: { host, latest, earliest }
  function validate(t, ctx) {
    const e = [];
    if (!t.title) e.push('Give the task a title.');
    if (t.due && !FX.isDate(t.due)) e.push('The due date is not a valid date.');
    if (['implemented', 'validated'].includes(t.status) && !t.implDate) e.push('Add the date the change went live, so its effect can be measured.');
    if (t.implDate) {
      if (!FX.isDate(t.implDate)) e.push('The implementation date is not a valid date.');
      else if (t.implDate > today()) e.push('The implementation date is in the future.');
    }
    if (t.status === 'validated' && !t.outcome) e.push('A task is validated once its result has been measured. Wait until the result is in, then validate it.');
    if (t.url && ctx && ctx.host) { let h = ''; try { h = new URL(t.url).hostname.replace(/^www\./, '').toLowerCase(); } catch (x) { } if (h && h !== ctx.host && !h.endsWith('.' + ctx.host)) e.push(`That page is on ${h}, not on ${ctx.host}.`); }
    return e;
  }
  function setStatus(t, status) {
    if (!STATUS[status] || t.status === status) return t;
    const now = new Date().toISOString();
    return { ...t, status, updated: now, implDate: status === 'implemented' && !t.implDate ? today() : t.implDate, history: t.history.concat({ at: now, status }) };
  }
  const overdue = (t, now = today()) => !!t.due && t.due < now && !['implemented', 'validated', 'dropped'].includes(t.status);
  const measurable = t => !!t.implDate && ['implemented', 'validated'].includes(t.status);

  // Things that could explain a measured change other than this task: other changes on the same page or the
  // whole site inside the before/after windows. Seasonality and Google updates are always listed as caveats.
  function confounders(t, all, fixes, w) {
    if (!w || !w.before) return [];
    const lo = w.before.start, hi = w.after.end, out = [];
    (all || []).forEach(o => { if (o.id !== t.id && o.implDate && o.implDate >= lo && o.implDate <= hi && (!o.url || !t.url || o.url === t.url)) out.push(`Another change went live on ${o.implDate}${o.url ? '' : ' (whole site)'}: ${o.title}`); });
    (fixes || []).forEach(f => { if (f.date >= lo && f.date <= hi && (f.scope === 'site' || f.url === t.url)) out.push(`A tracked fix went live on ${f.date}${f.note ? ': ' + f.note : ''}`); });
    const mb = w.before.start.slice(5, 7), ma = w.after.end.slice(5, 7);
    if (mb !== ma) out.push(`The windows span different months (${w.before.start} to ${w.after.end}); seasonal demand can move clicks on its own.`);
    return out;
  }
  // Calibration input for priority.js: one outcome per measured task.
  const outcomes = list => list.filter(t => t.outcome && t.category).map(t => ({ category: t.category, verdict: t.outcome.verdict }));
  function summary(list, now = today()) {
    const open = list.filter(t => ['planned', 'progress'].includes(t.status));
    return { total: list.length, open: open.length, overdue: list.filter(t => overdue(t, now)).length, implemented: list.filter(t => t.status === 'implemented').length, validated: list.filter(t => t.status === 'validated').length,
      byStatus: ORDER.reduce((o, s) => (o[s] = list.filter(t => t.status === s).length, o), {}) };
  }
  // One list of every change that went live, from the Action board and the Fix tracker, so both screens show
  // the same record and nothing is measured twice. A fix logged for the same page (or the whole site) on the
  // same day as a task is the same change: the task wins and the fix is noted as linked.
  // Each entry keeps what is needed to compare later: date, scope, what changed, baseline and estimate.
  function changeLog(list, fixes) {
    const out = [];
    (list || []).filter(t => t.implDate && ['implemented', 'validated'].includes(t.status)).forEach(t => out.push({
      key: 'task:' + t.id, from: 'task', taskId: t.id, date: t.implDate, scope: t.url ? 'page' : 'site', url: t.url, path: t.url ? pathOf(t.url) : null,
      note: t.change || t.title, title: t.title, owner: t.owner, window: t.window, baseline: t.baseline, estimate: t.estimate, outcome: t.outcome, status: t.status, fixIds: [] }));
    (fixes || []).filter(f => f && FX.isDate(f.date)).forEach(f => {
      const same = out.find(c => c.from === 'task' && c.date === f.date && (c.scope === 'site' ? f.scope === 'site' : f.url === c.url));
      if (same) { same.fixIds.push(f.id); return; }
      out.push({ key: 'fix:' + f.id, from: 'fix', fixId: f.id, date: f.date, scope: f.scope === 'site' ? 'site' : 'page', url: f.scope === 'site' ? null : f.url, path: f.scope === 'site' ? null : (f.path || pathOf(f.url)), note: f.note || '', title: f.note || 'Tracked fix', window: 28, baseline: null, estimate: null, outcome: null, fixIds: [f.id] });
    });
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  }
  // The measured change as clicks a month, for comparing with the estimate made when the task was created.
  const measuredMonthly = r => r && r.status === 'measured' && r.before && r.after ? (r.after.perDay - r.before.perDay) * 30 : null;
  // Chart markers for the trend: implemented changes by date.
  const markers = (list, fixes) => list.filter(t => t.implDate).map(t => ({ d: t.implDate, label: t.title })).concat((fixes || []).map(f => ({ d: f.date, label: f.note || 'Tracked fix' })));

  window.CW_TASKS = { STATUS, ORDER, WINDOWS, fromOpportunity, manual, normalise, load, validate, setStatus, overdue, measurable, confounders, outcomes, summary, markers, baselineOf, pathOf, changeLog, measuredMonthly };
})();

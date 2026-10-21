// Clickwise Growth Priority Score. Builds on the opportunity engine (opportunities.js): merges items that
// describe the same underlying issue, scores each merged opportunity on five documented components with
// configurable weights, and keeps data-backed risks on a separate path so a low growth score never hides them.
// Pure functions: no DOM, no network.
(function () {
  'use strict';
  const CW = window.CW;

  // Weights are relative: they are divided by their sum. Users can change them; these are the defaults.
  const DEFAULT_WEIGHTS = { impact: 40, confidence: 25, relevance: 15, speed: 10, effort: 10 };
  const COMPONENTS = {
    impact: 'Incremental click potential: mid-point of the estimate, on a log scale against the largest in this list',
    confidence: 'Evidence confidence: the opportunity engine\'s 0–100 score (data volume, period, CTR source, known results-page effects)',
    relevance: 'Business relevance: 1 when the page or search is in a priority section or term you set, 0.3 when not; 0.5 for everything when none are set',
    speed: 'Time to impact: how soon Search usually reflects this kind of change (title edits in days to weeks, new content in months)',
    effort: 'Implementation effort, inverted: Low 1, Medium 0.6, High 0.25'
  };
  const CATEGORY = {
    striking: 'Rankings', 'ctr-query': 'CTR', 'ctr-page': 'CTR', 'answer-box': 'AI & SERP features',
    'decline-page': 'Declines', 'decline-query': 'Declines', 'slipping-page': 'Declines', cannibal: 'Competing pages',
    'content-gap': 'Content', 'internal-link': 'Internal links'
  };
  // time to impact, 0–1, with the reason shown to users
  function speedOf(it) {
    switch (it.type) {
      case 'ctr-query': case 'ctr-page': return [0.9, 'Title and snippet changes show up once the page is recrawled, usually days to a few weeks'];
      case 'answer-box': return [0.6, 'Rewriting the page opening takes a recrawl and may not win the click back'];
      case 'striking': return it.measured.pos <= 10.5 ? [0.6, 'Moving up within page one usually takes a few weeks'] : [0.35, 'Climbing from page two usually takes one to three months'];
      case 'decline-page': case 'decline-query': return it.measured.clicks === 0 || /gone|no longer/.test(it.reason) ? [0.9, 'A technical fix restores visibility as soon as the page is recrawled'] : [0.5, 'A refresh usually takes a few weeks to be reflected'];
      case 'slipping-page': return [0.5, 'Early refreshes take a few weeks to be reflected'];
      case 'cannibal': return [0.45, 'Merges and redirects take weeks for signals to consolidate'];
      case 'internal-link': return [0.7, 'New links are picked up on the next crawl of the linking pages'];
      case 'content-gap': return [0.2, 'New or expanded content usually takes months to rank'];
      default: return [0.5, 'Typical timing unknown'];
    }
  }
  const EFFORT = { Low: 1, Medium: 0.6, High: 0.25 };
  // A decline that is probably not recoverable (lower demand, normal variation, unknown size) has no click
  // potential to rank on; it stays on the risk path instead.
  const mid = it => it.impact.kind === 'growth' || (it.impact.kind === 'recovery' && it.impact.recoverable !== false) ? ((it.impact.lo || 0) + (it.impact.hi || 0)) / 2 : 0;
  const PRIMARY_ORDER = { 'decline-page': 0, striking: 1, 'ctr-query': 2, 'answer-box': 3, 'ctr-page': 4, cannibal: 5, 'decline-query': 6, 'slipping-page': 7, 'content-gap': 8, 'internal-link': 9 };

  // focus: { sections: ['/blog/'], terms: ['price'] } — the user's priority areas
  function relevanceOf(g, focus) {
    const secs = (focus && focus.sections || []).map(s => s.toLowerCase()).filter(Boolean);
    const terms = (focus && focus.terms || []).map(s => s.toLowerCase()).filter(Boolean);
    if (!secs.length && !terms.length) return [0.5, 'No priority sections or terms set, so every opportunity counts the same here'];
    const paths = [g.page && g.page.path, g.subject.kind === 'page' ? g.subject.label : null].filter(Boolean).map(p => p.toLowerCase());
    const text = (g.subject.kind === 'query' ? g.subject.label : (g.subject.label || '')).toLowerCase();
    const sec = secs.find(s => paths.some(p => p.startsWith(s.startsWith('/') ? s : '/' + s)));
    if (sec) return [1, `In your priority section ${sec}`];
    const term = terms.find(t => text.includes(t) || paths.some(p => p.includes(t)));
    if (term) return [1, `Matches your priority term “${term}”`];
    return [0.3, 'Outside the priority sections and terms you set'];
  }

  // Calibration from measured results: per category, how often tracked changes improved clicks.
  // outcomes: [{ category, verdict }] where verdict is a fixes.js verdict. Needs 3+ results per category.
  function calibration(outcomes) {
    const by = {};
    (outcomes || []).forEach(o => { if (!o || !o.category || !o.verdict) return; const b = by[o.category] || (by[o.category] = { n: 0, up: 0, down: 0 }); b.n++; if (/improved/.test(o.verdict)) b.up++; else if (/declined/.test(o.verdict)) b.down++; });
    const out = {};
    Object.entries(by).forEach(([k, b]) => {
      if (b.n < 3) { out[k] = { factor: 1, n: b.n, note: `${b.n} measured result${b.n === 1 ? '' : 's'}: too few to adjust (needs 3)` }; return; }
      const rate = (b.up + 1) / (b.n + 2); // smoothed success rate; 0.5 means no evidence either way
      const factor = 0.7 + rate * 0.6; // rate 0 → ×0.7, 0.5 → ×1, 1 → ×1.3
      out[k] = { factor: +factor.toFixed(2), n: b.n, rate, note: `${b.up} of ${b.n} measured changes improved clicks: score ×${factor.toFixed(2)}` };
    });
    return out;
  }

  function build(A, D, opts) {
    opts = opts || {};
    const O = A.opps; if (!O) return null;
    const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
    const wSum = Object.values(weights).reduce((s, v) => s + Math.max(0, +v || 0), 0) || 1;
    const calib = calibration(opts.outcomes);
    const qIntent = new Map((A.Q || []).map(r => [r.q, r.intent]));
    const sectionOf = path => { const s = String(path || '').split('/').filter(Boolean)[0]; return s ? '/' + s + '/' : '/'; };

    // ── merge items describing the same issue ──
    const groups = new Map();
    const keyOf = it => it.subject.kind === 'query' ? 'q:' + it.subject.label : 'p:' + it.subject.url;
    const sep = { 'content-gap': 'gap', 'internal-link': 'link' }; // different fixes: never merged with others
    O.items.forEach(it => {
      const k = (sep[it.type] ? sep[it.type] + ':' : '') + keyOf(it);
      const g = groups.get(k) || { key: k, items: [] };
      g.items.push(it); groups.set(k, g);
    });
    // a page's title estimate belongs with the search it mostly ranks for when that search already has a CTR item;
    // a search's decline belongs with its ranking page's decline
    const byLanding = (type, url) => [...groups.values()].find(g => g.items.some(x => x.type === type && x.landing && x.landing.url === url && x.landing.share >= 50));
    [...groups.values()].forEach(g => {
      const only = g.items.length === 1 ? g.items[0] : null;
      if (!only) return;
      let host = null;
      if (only.type === 'ctr-page') host = byLanding('ctr-query', only.subject.url);
      if (host && host !== g) { host.items.push(only); groups.delete(g.key); }
    });
    [...groups.values()].forEach(g => {
      const dq = g.items.find(x => x.type === 'decline-query');
      if (!dq || g.items.length > 1 || !dq.landing) return;
      const host = groups.get('p:' + dq.landing.url);
      if (host && host.items.some(x => x.type === 'decline-page')) { host.items.push(dq); groups.delete(g.key); }
    });

    const list = [...groups.values()].map(g => {
      const items = g.items.slice().sort((a, b) => mid(b) - mid(a) || PRIMARY_ORDER[a.type] - PRIMARY_ORDER[b.type]);
      const p = items[0];
      const page = p.subject.kind === 'page' ? { url: p.subject.url, path: p.subject.label } : p.landing ? { url: p.landing.url, path: p.landing.path } : null;
      return {
        id: 'o:' + (sep[p.type] ? sep[p.type] + ':' : '') + (p.subject.url || p.subject.label),
        primary: p, related: items.slice(1), items, type: p.type, typeLabel: p.typeLabel, category: CATEGORY[p.type] || 'Other', view: p.view,
        subject: p.subject, page, section: page ? sectionOf(page.path) : null,
        intent: p.subject.kind === 'query' ? qIntent.get(p.subject.label) || null : null,
        measured: p.measured, previous: p.previous || (items.find(x => x.previous && x.subject.label === p.subject.label) || {}).previous || null, reason: p.reason,
        evidence: items.flatMap((x, i) => (i ? [`Also flagged as “${x.typeLabel}”: ${x.reason}`] : []).concat(x.evidence)).filter((v, i, a) => a.indexOf(v) === i),
        impact: p.impact, confidence: p.confidence, action: p.action, effort: p.effort,
        warnings: [...new Set(items.flatMap(x => x.warnings))]
      };
    });

    // ── score ──
    const maxMid = Math.max(1, ...list.map(g => mid(g.primary)));
    list.forEach(g => {
      const imp = mid(g.primary);
      const c = {
        impact: [imp > 0 ? Math.log1p(imp) / Math.log1p(maxMid) : 0, imp > 0 ? `About ${CW.fmtN(imp)} clicks a month (mid-point of ${CW.fmtN(g.impact.lo)}–${CW.fmtN(g.impact.hi)}, ${g.impact.kind})` : g.impact.recoverable === false ? `No recoverable clicks counted: ${g.impact.recoverWhy}` : 'No click estimate: a check or long-term improvement'],
        confidence: [g.confidence.score / 100, `${g.confidence.level} confidence (${g.confidence.score}/100)`],
        relevance: relevanceOf(g, opts.focus),
        speed: speedOf(g.primary),
        effort: [EFFORT[g.effort.level] != null ? EFFORT[g.effort.level] : 0.5, `${g.effort.level} effort: ${g.effort.why}`]
      };
      const parts = Object.keys(DEFAULT_WEIGHTS).map(k => { const w = Math.max(0, +weights[k] || 0); return { key: k, value: c[k][0], weight: w, points: w / wSum * c[k][0] * 100, why: c[k][1] }; });
      let score = parts.reduce((s, x) => s + x.points, 0);
      const cal = calib[g.category];
      if (cal && cal.factor !== 1) score *= cal.factor;
      score = Math.round(Math.max(0, Math.min(100, score)));
      const top = parts.slice().sort((a, b) => b.points - a.points);
      const weak = parts.filter(x => x.weight > 0).sort((a, b) => a.value - b.value)[0];
      g.score = score; g.parts = parts; g.calibration = cal || null;
      g.priority = score >= 60 ? 'P1' : score >= 42 ? 'P2' : 'P3';
      g.why = `Ranked by ${top[0].key === 'impact' ? 'its click potential' : top[0].key === 'confidence' ? 'strong evidence' : top[0].key === 'relevance' ? 'business relevance' : top[0].key === 'speed' ? 'how fast it pays off' : 'low effort'}${top[1].points > 10 ? ' and ' + ({ impact: 'click potential', confidence: 'evidence', relevance: 'relevance', speed: 'speed', effort: 'low effort' })[top[1].key] : ''}${weak && weak.value < 0.4 ? `; held back by ${({ impact: 'a small estimate', confidence: 'weak evidence', relevance: 'low relevance', speed: 'slow payoff', effort: 'high effort' })[weak.key]}` : ''}.`;
    });
    list.sort((a, b) => b.score - a.score || mid(b.primary) - mid(a.primary));
    list.forEach((g, i) => { g.rank = i + 1; });

    // ── risk path: shown whatever the growth score ──
    const risks = [];
    list.forEach(g => {
      const d = g.items.find(x => x.type === 'decline-page' || x.type === 'decline-query');
      if (d) {
        const gone = d.measured.clicks === 0 || /no longer shows|gone/.test(d.reason);
        const sev = gone && (d.previous && d.previous.clicks >= 20) ? 'critical' : d.confidence.level === 'High' ? 'high' : d.confidence.level === 'Medium' ? 'medium' : 'watch';
        risks.push({ id: g.id, sev, kind: 'decline', landing: d.landing || null, prev: d.previous ? d.previous.clicks : null, cur: d.measured ? d.measured.clicks : null, title: d.subject.kind === 'page' ? `${d.subject.label} is losing clicks` : `“${d.subject.label}” is losing clicks`, detail: d.reason, action: d.action, subject: d.subject, lost: d.impact.hi, source: 'Search Console, current vs previous period' });
      }
      const s = g.items.find(x => x.type === 'slipping-page');
      if (s && !d) risks.push({ id: g.id, sev: 'watch', kind: 'slipping', title: `${s.subject.label} is slipping`, detail: s.reason, action: s.action, subject: s.subject, lost: 0, source: 'Search Console, current vs previous period' });
    });
    // a search's decline is shown under its ranking page's decline, not as a second risk
    const pageRisk = new Map(risks.filter(r => r.subject.kind === 'page').map(r => [r.subject.url, r]));
    for (let i = risks.length - 1; i >= 0; i--) {
      const r = risks[i], host = r.subject.kind === 'query' && r.landing && r.landing.share >= 50 && pageRisk.get(r.landing.url);
      if (host) { (host.searches = host.searches || []).unshift({ q: r.subject.label, prev: r.prev, cur: r.cur, id: r.id }); risks.splice(i, 1); }
    }
    (opts.extraRisks || []).forEach(r => risks.push(r));
    const SEV = { critical: 0, high: 1, medium: 2, watch: 3 };
    risks.sort((a, b) => SEV[a.sev] - SEV[b.sev] || (b.lost || 0) - (a.lost || 0));

    const merged = O.items.length - list.length;
    return {
      items: list, risks, weights, wSum, calibration: calib, merged,
      counts: { P1: list.filter(g => g.priority === 'P1').length, P2: list.filter(g => g.priority === 'P2').length, P3: list.filter(g => g.priority === 'P3').length },
      focusSet: !!(opts.focus && ((opts.focus.sections || []).length || (opts.focus.terms || []).length)),
      totals: O.totals, period: O.period, warnings: O.warnings
    };
  }

  // Risks from indexing data (surfaces.js inspection results), only for pages that earn clicks.
  function indexRisks(inspections, P) {
    const perf = new Map((P || []).map(r => [String(r.p).replace(/\/$/, ''), r]));
    return (inspections || []).filter(r => r && r.tone === 'risk').map(r => {
      const p = perf.get(r.url.replace(/\/$/, ''));
      return { id: 'i:' + r.url, sev: p && p.clicks >= 20 ? 'critical' : 'high', kind: 'indexing', title: `${r.path}: ${r.label}`, detail: `URL inspection: ${r.coverage || r.label}${p ? `. The page had ${CW.fmtN(p.clicks)} clicks in the analysed period.` : ''}`, action: r.fix, subject: { kind: 'page', label: r.path, url: r.url }, lost: p ? p.clicks : 0, source: 'Google URL Inspection (live)' };
    });
  }

  window.CW_PRIORITY = { build, calibration, indexRisks, DEFAULT_WEIGHTS, COMPONENTS, CATEGORY, speedOf, relevanceOf };
})();

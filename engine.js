// Clickwise analysis engine — pure functions, no DOM.
(function () {
  'use strict';

  // ── CTR benchmark by position (organic, blended desktop/mobile) ──
  const CURVE = [[1, 28], [2, 15.5], [3, 11], [4, 8], [5, 6.3], [6, 5], [7, 4], [8, 3.3], [9, 2.8], [10, 2.4], [15, 1.2], [20, 0.8], [30, 0.4], [50, 0.2], [100, 0.05]];
  function expCtr(pos) {
    if (!pos || pos <= 1) return CURVE[0][1];
    for (let i = 1; i < CURVE.length; i++) {
      const [p1, c1] = CURVE[i - 1], [p2, c2] = CURVE[i];
      if (pos <= p2) return c1 + (c2 - c1) * (pos - p1) / (p2 - p1);
    }
    return 0.05;
  }

  // ── helpers ──
  const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
  function agg(rows) {
    const clicks = sum(rows, 'clicks'), impr = sum(rows, 'impr');
    const posW = rows.reduce((s, r) => s + r.pos * r.impr, 0);
    return { clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: impr ? posW / impr : 0, n: rows.length };
  }
  function pct(arr, p) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }
  function change(cur, prev) { return prev ? (cur - prev) / prev * 100 : null; }
  function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function pathOf(url) {
    try { const u = new URL(url); return u.pathname || '/'; } catch (e) { return String(url).replace(/^https?:\/\/[^/]+/i, '') || '/'; }
  }
  function words(q) { return q.trim().split(/\s+/).filter(Boolean).length; }

  // ── brand detection ──
  function brandGuess(site, Q) {
    const host = String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const base = host.split('.')[0].toLowerCase();
    const out = new Set();
    if (base && base.length > 2) {
      out.add(base);
      out.add(host.toLowerCase());
      // split camel-ish compound names on common joins: "trailcraft" → "trail craft"
      const parts = base.split(/[-_]/);
      if (parts.length > 1) { out.add(parts.join(' ')); out.add(parts.join('')); }
    }
    // suggestions: only brand-shaped variants found in real queries —
    // misspellings of the base name, or the name split into two words.
    const sugg = new Map();
    if (base && base.length > 3) {
      (Q || []).slice(0, 5000).forEach(q => {
        const toks = q.q.toLowerCase().split(/\s+/).filter(Boolean);
        toks.forEach((t, i) => {
          const clean = t.replace(/[^a-z0-9.]/g, '');
          if (clean.length < 4 || out.has(clean)) return;
          if (clean !== base && Math.abs(clean.length - base.length) <= 2 && lev(clean, base) <= (base.length > 7 ? 2 : 1)) sugg.set(clean, (sugg.get(clean) || 0) + q.impr);
          const pair = toks[i + 1] ? t + ' ' + toks[i + 1] : null;
          if (pair && pair.replace(' ', '') === base && !out.has(pair)) sugg.set(pair, (sugg.get(pair) || 0) + q.impr);
        });
      });
    }
    const suggestions = [...sugg.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 6);
    return { terms: [...out], suggestions };
  }
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  const STOP = new Set('the and for with from that this your what how why when where which best near free online login www com app official site review reviews price prices'.split(' '));

  // Brand terms match as words. Short names (4 characters or fewer) must match exactly, so "ola"
  // never matches "cola". Longer names also catch typos glued to them — up to 3 extra letters
  // or digits ("brandoo", "ibrando", "brandoned") — but not longer words ("brandonian").
  const WB = '(?:^|[^\\p{L}\\p{N}])', WE = '(?=$|[^\\p{L}\\p{N}])', GLUE = '[\\p{L}\\p{N}]{0,3}';
  function brandPattern(terms) {
    const t = (terms || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
    if (!t.length) return null;
    const short = t.filter(x => x.length <= 4).map(escRx), long = t.filter(x => x.length > 4).map(escRx);
    const parts = [];
    if (short.length) parts.push(WB + '(?:' + short.join('|') + ')' + WE);
    if (long.length) parts.push(WB + GLUE + '(?:' + long.join('|') + ')' + GLUE + WE);
    return new RegExp(parts.join('|'), 'iu');
  }
  function makeBrandTest(terms) {
    const rx = brandPattern(terms);
    return rx ? q => rx.test(String(q)) : () => false;
  }
  function brandRegex(terms) {
    const t = (terms || []).map(s => s.trim().toLowerCase()).filter(Boolean).map(escRx);
    return t.length ? '\\b(' + t.join('|') + ')\\b' : '\\b(yourbrand)\\b';
  }

  // ── intent ──
  const RX = {
    question: /^(who|what|when|where|why|how|which|can|could|does|do|did|is|are|was|were|should|will|would)\b/i,
    trans: /\b(buy|order|price|prices|pricing|cost|coupon|discount|deal|deals|shop|store|near me|hire|book|booking|download|sign ?up|subscribe|free trial|demo|apply|quote|for sale|cheap)\b/i,
    comm: /\b(best|top|vs\.?|versus|review|reviews|compare|comparison|alternative|alternatives|rated|recommended|worth it|pros and cons)\b/i,
    info: /\b(guide|tutorial|tips|ideas|examples?|meaning|definition|explained|checklist|template|steps|list of|history|types of|benefits)\b/i,
    year: /\b(20[2-3]\d)\b/,
    fresh: /\b(latest|new|today|this year|updated|current)\b/i,
    compare: /\b(vs\.?|versus|compare|comparison|alternative|alternatives|instead of|similar to|difference between)\b/i,
    howto: /^how (to|do|does|can|much|many|long)\b/i,
    numbers: /\d/
  };
  function intentOf(q, isBrand) {
    if (isBrand(q)) return 'nav';
    if (RX.trans.test(q)) return 'trans';
    if (RX.comm.test(q)) return 'comm';
    if (RX.question.test(q) || RX.info.test(q)) return 'info';
    return 'other';
  }
  const INTENT_LABEL = { info: 'Informational', comm: 'Commercial', trans: 'Transactional', nav: 'Branded', other: 'Unclassified' };

  // ── estimation settings ──
  const EST = {
    minObs: 30,        // queries needed at a position before the site's own CTR replaces the benchmark
    capShare: 0.10,    // no single query may contribute more than this share of a list's upper estimate
    serpRatio: 0.35,   // CTR under this share of expected at positions 1–8 → likely a results-page feature
    minEvidence: 20,   // …but only when at least this many clicks were expected over the period (otherwise it is just low volume)
    lowTargetStep: 2   // conservative case: the query climbs this many positions
  };
  const DEFAULT_UTILITY = ['dashboard', 'admin', 'panel', 'account', 'accounts', 'my-account', 'profile', 'settings', 'login', 'logout', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'auth', 'cart', 'checkout', 'billing', 'inbox', 'notifications', 'wp-admin', 'preview'];

  function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  // Expected CTR by position. Where the site has enough evidence at a position (≥ minObs queries and
  // ≥ 10 clicks) it is the site's own impression-weighted CTR, with each query's impressions capped at
  // 10% of the bucket so one big query cannot set the curve; elsewhere the benchmark. A median is not
  // used: on low-volume sections most queries have 0 clicks, which would make the expected CTR zero.
  // The curve never rises at a lower position and never drops below 20% of the benchmark.
  function buildCurve(rows, minObs) {
    const by = Array.from({ length: 21 }, () => []);
    rows.forEach(r => { if (!(r.pos >= 0.5) || !(r.impr > 0)) return; const p = Math.round(r.pos); if (p >= 1 && p <= 20) by[p].push(r); });
    const own = p => {
      const b = by[p];
      if (b.length < minObs || b.reduce((s, r) => s + r.clicks, 0) < 10) return null;
      const cap = b.reduce((s, r) => s + r.impr, 0) * 0.1;
      let c = 0, i = 0;
      b.forEach(r => { const w = Math.min(r.impr, cap); c += w * (r.ctr / 100); i += w; });
      return i ? c / i * 100 : null;
    };
    const pts = [null], src = [null];
    let above = Infinity;
    for (let p = 1; p <= 20; p++) {
      const o = own(p);
      let v = o != null ? o : expCtr(p), from = o != null ? 'site' : 'benchmark';
      if (v > above) { v = above; from = from + ' (capped)'; }
      if (v < expCtr(p) * 0.2) { v = expCtr(p) * 0.2; from = from + ' (floor)'; }
      pts.push(v); src.push(from); above = v;
    }
    const at = pos => {
      if (!(pos > 1)) return pts[1];
      if (pos >= 20) return Math.min(pts[20], expCtr(pos));
      const a = Math.floor(pos);
      return pts[a] + (pts[a + 1] - pts[a]) * (pos - a);
    };
    return { at, minObs, points: pts.slice(1).map((v, i) => ({ pos: i + 1, ctr: v, source: src[i + 1], n: by[i + 1].length })), sitePositions: src.filter(x => x && x.startsWith('site')).length };
  }
  // Keep any single row from dominating a list; flag the ones that were cut.
  function capList(list, share) {
    if (list.length < 10) return list;
    const cap = list.reduce((s, r) => s + r.gainHi, 0) * share;
    list.forEach(r => { if (r.gainHi > cap) { r.gainHi = cap; r.gainLo = Math.min(r.gainLo, cap); r.gain = r.gainLo; r.capped = true; } });
    return list;
  }
  const byEstimate = (a, b) => b.gainLo - a.gainLo || b.gainHi - a.gainHi;

  // ── main analysis ──
  function analyse(D0, S) {
    // Queries the user chose to ignore (plain words, matched as "contains") are dropped everywhere.
    const ign = (S.ignore || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
    const keep = r => { const l = String(r.q).toLowerCase(); return !ign.some(x => l.includes(x)); };
    const D = ign.length ? { ...D0, Q: D0.Q.filter(keep), QP: D0.QP && D0.QP.filter(keep), prevQ: D0.prevQ && D0.prevQ.filter(keep) } : D0;
    const isBrand = makeBrandTest(S.brand);
    const excl = (S.exclude || []).map(s => s.toLowerCase()).filter(Boolean);
    const isExcluded = p => { const l = p.toLowerCase(); return excl.some(x => l.includes(x)); };
    const days = Math.max(1, D.days || 90);
    const perMonth = v => v * 30 / days;

    const Q = D.Q.map(r => ({ ...r, brand: isBrand(r.q) }));
    Q.forEach(r => { r.intent = intentOf(r.q, isBrand); r.words = words(r.q); });
    const NBQ = Q.filter(r => !r.brand), BQ = Q.filter(r => r.brand);
    const P = D.P.filter(r => !isExcluded(r.p)).map(r => ({ ...r, path: pathOf(r.p) }));

    const totNB = agg(NBQ), totB = agg(BQ), totAll = agg(Q);
    // Query rows don't add up to site totals (GSC anonymises), so use the date series when present.
    const site = D.C && D.C.length ? agg(D.C.map(r => ({ ...r, pos: r.pos || 0 }))) : totAll;
    if (D.C && D.C.length && D.C[0].pos != null) {
      site.pos = D.C.reduce((s, r) => s + r.pos * r.impr, 0) / Math.max(1, site.impr);
    }

    // whole-site totals for the comparison period, when the export or API provides them
    const prevSite = D.prevC && D.prevC.length ? agg(D.prevC.map(r => ({ ...r, pos: r.pos || 0 }))) : null;
    let prev = null;
    if (D.prevQ && D.prevQ.length) {
      const pQ = D.prevQ.filter(r => !isBrand(r.q));
      prev = { nb: agg(pQ), all: agg(D.prevQ) };
    }

    const imprFloor = Math.max(10, Math.round(pct(NBQ.map(r => r.impr), 0.5)));
    const pageFloor = Math.max(20, Math.round(pct(P.map(r => r.impr), 0.5)));

    // ── expected CTR (site's own curve, benchmark fallback) ──
    // All estimates below are clicks per month, as a low–high range.
    const curve = buildCurve(NBQ, S.minObs || EST.minObs);
    const expAt = curve.at;
    // Pages blend many queries at different positions, so they get their own curve built from page rows.
    const pageCurve = buildCurve(P, S.minObs || EST.minObs);
    const rel = r => { const e = expAt(r.pos); return e > 0 ? r.ctr / e : 1; };
    // A results-page feature (answer box, AI Overview) is only assumed with evidence: enough impressions
    // that clearly more clicks were expected. Zero clicks on a few impressions is normal, not a feature.
    const expected = (r, e) => r.impr * e / 100;
    const isSerp = r => r.pos <= 8 && rel(r) < EST.serpRatio && expected(r, expAt(r.pos)) >= EST.minEvidence;
    const pos0 = v => Math.max(0, v);

    // ── page flags: likely branded sitelinks and utility pages ──
    const util = new Set((S.utilityHints || DEFAULT_UTILITY).map(x => String(x).toLowerCase()));
    const keepPages = (S.keep || []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
    const brandShare = totAll.clicks ? totB.clicks / totAll.clicks : 0;
    const qpBrand = new Map();
    (D.QP || []).forEach(r => { const o = qpBrand.get(r.p) || { b: 0, all: 0 }; o.all += r.impr; if (isBrand(r.q)) o.b += r.impr; qpBrand.set(r.p, o); });
    function pageFlag(r) {
      if (keepPages.some(k => r.p.toLowerCase().includes(k))) return null;
      const segs = r.path.split('/').filter(Boolean).map(x => x.toLowerCase());
      if (segs.some(x => util.has(x) || x.split(/[-_.]/).some(t => util.has(t))))
        return { kind: 'utility', certain: false, reason: 'URL looks like a dashboard, account or other utility page' };
      const q = qpBrand.get(r.p);
      if (q && q.all >= 20) {
        const sh = q.b / q.all;
        return sh >= 0.5 ? { kind: 'sitelink', certain: true, reason: `${Math.round(sh * 100)}% of its impressions come from branded searches` } : null;
      }
      // compared with what queries at that position earn: a sitelink is shown under brand results, not ranked on its own
      if (segs.length === 1 && r.pos <= 3 && rel(r) < EST.serpRatio && expected(r, expAt(r.pos)) >= EST.minEvidence && brandShare >= 0.2)
        return { kind: 'sitelink', certain: false, reason: `Top-level page at position ${r.pos.toFixed(1)} with ${r.ctr.toFixed(1)}% CTR on a site where ${Math.round(brandShare * 100)}% of query clicks are branded — probably shown as a sitelink under brand results` };
      return null;
    }
    const pageFlags = new Map();
    P.forEach(r => { const f = pageFlag(r); if (f) { pageFlags.set(r.p, f); r.flag = f; } });

    // ── Almost page one (striking distance) ──
    // A query keeps its own click behaviour relative to its position, so pages that lose
    // clicks to answer boxes are not projected to a full top-3 CTR.
    const quickWins = capList(NBQ.filter(r => r.pos > 3.5 && r.pos <= 20 && r.impr >= imprFloor).map(r => {
      // keep the query's own click rate only where there is evidence it is held back (see isSerp)
      const ratio = rel(r), serp = isSerp(r), k = serp ? Math.min(1, ratio) : 1;
      const target = r.pos <= 10 ? 3 : 7;
      const lowTarget = Math.max(target, r.pos - EST.lowTargetStep);
      const gainHi = perMonth(pos0(r.impr * (expAt(target) * k - r.ctr) / 100));
      const gainLo = perMonth(pos0(r.impr * (expAt(lowTarget) * k - r.ctr) / 100));
      return { ...r, target, lowTarget, exp: expAt(r.pos), ratio, gainLo, gainHi, gain: gainLo, serp };
    }).filter(r => r.gainHi >= 1), EST.capShare).sort(byEstimate);

    // ── Titles to rewrite (CTR below expected at current position) ──
    const qpByPage = new Map();
    (D.QP || []).forEach(r => {
      if (isBrand(r.q)) return;
      if (!qpByPage.has(r.p)) qpByPage.set(r.p, []);
      qpByPage.get(r.p).push(r);
    });
    qpByPage.forEach(a => a.sort((x, y) => y.impr - x.impr));
    // Title-rewrite estimate: low = reach 60% of expected CTR, high = reach 85%. Pages use the lower of
    // the page and query curves. Where a results-page feature is likely, a rewrite rarely closes the gap:
    // low is 0 and high is at most double the current CTR (never above 35% of expected).
    const ctrEst = (r, page) => {
      const bench = page ? Math.min(pageCurve.at(r.pos), expAt(r.pos)) : expAt(r.pos), ratio = bench > 0 ? r.ctr / bench : 1;
      const serp = r.pos <= 8 && ratio < EST.serpRatio && expected(r, bench) >= EST.minEvidence;
      const hiTarget = serp ? Math.min(bench * EST.serpRatio, r.ctr * 2) : bench * 0.85;
      const gainHi = perMonth(pos0(r.impr * (hiTarget - r.ctr) / 100));
      const gainLo = serp ? 0 : perMonth(pos0(r.impr * (bench * 0.6 - r.ctr) / 100));
      return { bench, ratio, gainLo, gainHi, gain: gainLo, serp };
    };
    const ctrCandidates = P.filter(r => r.pos <= 10 && r.impr >= pageFloor).map(r => ({ ...r, ...ctrEst(r, true), top: (qpByPage.get(r.p) || []).slice(0, 3).map(x => x.q) }))
      .filter(r => r.ratio < 0.6 && r.gainHi >= 1);
    const ctrPages = capList(ctrCandidates.filter(r => !r.flag), EST.capShare).sort(byEstimate);
    const setAside = ctrCandidates.filter(r => r.flag).sort((a, b) => b.impr - a.impr);
    const ctrQueries = capList(NBQ.filter(r => r.pos <= 10 && r.impr >= imprFloor).map(r => ({ ...r, ...ctrEst(r, false) }))
      .filter(r => r.ratio < 0.5 && r.gainHi >= 1), EST.capShare).sort(byEstimate);

    // ── Competing pages (cannibalisation) ──
    let cannibal = [], cannibalMode = 'none';
    if (D.QP && D.QP.length) {
      cannibalMode = 'exact';
      const byQ = new Map();
      D.QP.forEach(r => {
        if (isBrand(r.q) || isExcluded(r.p)) return;
        if (!byQ.has(r.q)) byQ.set(r.q, []);
        byQ.get(r.q).push(r);
      });
      byQ.forEach((rows, q) => {
        const tot = sum(rows, 'impr');
        if (tot < imprFloor) return;
        const comp = rows.filter(r => r.impr / tot >= 0.1 && r.impr >= 5).sort((a, b) => b.impr - a.impr);
        if (comp.length < 2) return;
        const a = agg(rows);
        const best = Math.min(...comp.map(r => r.pos));
        const loss = perMonth(Math.max(0, tot * (expAt(best) - a.ctr) / 100));
        const split = comp[1].impr / tot;
        const sev = split >= 0.3 && a.pos > 3 ? 'high' : split >= 0.2 ? 'medium' : 'low';
        cannibal.push({ q, pages: comp.map(r => ({ ...r, share: r.impr / tot * 100 })), ...a, impr: tot, loss, sev });
      });
    } else {
      cannibalMode = 'stem';
      const roots = new Map();
      NBQ.forEach(r => {
        const k = r.q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(w => w && !STEMSTOP.has(w)).sort().slice(0, 3).join(' ');
        if (k.length < 5) return;
        if (!roots.has(k)) roots.set(k, []);
        roots.get(k).push(r);
      });
      roots.forEach((rows, k) => {
        if (rows.length < 2) return;
        const a = agg(rows);
        if (a.impr < imprFloor * 2) return;
        const spread = Math.max(...rows.map(r => r.pos)) - Math.min(...rows.map(r => r.pos));
        if (spread < 4) return;
        const best = Math.min(...rows.map(r => r.pos));
        const loss = perMonth(Math.max(0, a.impr * (expAt(best) - a.ctr) / 100));
        const sev = spread > 10 && rows.length >= 3 ? 'high' : spread > 6 ? 'medium' : 'low';
        cannibal.push({ q: k, variants: rows.sort((x, y) => y.impr - x.impr), ...a, loss, sev, spread });
      });
    }
    const sevRank = { high: 3, medium: 2, low: 1 };
    cannibal.sort((a, b) => sevRank[b.sev] - sevRank[a.sev] || b.loss - a.loss);

    // ── Losing ground (content decay) ──
    let decay = null;
    if (D.prevP && D.prevP.length) {
      const prevMap = new Map(D.prevP.map(r => [r.p, r]));
      const curMap = new Map(P.map(r => [r.p, r]));
      const minPrev = Math.max(5, pct(D.prevP.map(r => r.clicks), 0.6));
      const pages = [];
      prevMap.forEach((pr, url) => {
        if (isExcluded(url) || pr.clicks < minPrev) return;
        const cu = curMap.get(url) || { clicks: 0, impr: 0, ctr: 0, pos: 0 };
        const ch = change(cu.clicks, pr.clicks);
        if (ch !== null && ch <= -25) pages.push({ p: url, path: pathOf(url), prev: pr, cur: cu, lost: pr.clicks - cu.clicks, ch, posDelta: cu.pos && pr.pos ? cu.pos - pr.pos : null, reason: decayReason(pr, cu) });
      });
      pages.sort((a, b) => b.lost - a.lost);
      const qMinPrev = Math.max(5, pct((D.prevQ || []).map(r => r.clicks), 0.7));
      const queries = (D.prevQ || []).filter(pr => !isBrand(pr.q) && pr.clicks >= qMinPrev);
      const curQMap = new Map(Q.map(r => [r.q, r]));
      const qDecay = queries.map(pr => {
        const cu = curQMap.get(pr.q) || { clicks: 0, impr: 0, ctr: 0, pos: 0 };
        return { q: pr.q, prev: pr, cur: cu, lost: pr.clicks - cu.clicks, ch: change(cu.clicks, pr.clicks), reason: decayReason(pr, cu) };
      }).filter(r => r.ch !== null && r.ch <= -30).sort((a, b) => b.lost - a.lost);
      const rising = [];
      curMap.forEach((cu, url) => {
        const pr = prevMap.get(url);
        if (cu.clicks >= minPrev && (!pr || change(cu.clicks, pr.clicks) >= 40)) rising.push({ p: url, path: pathOf(url), cur: cu, prev: pr || null, won: cu.clicks - (pr ? pr.clicks : 0) });
      });
      rising.sort((a, b) => b.won - a.won);
      decay = { pages, queries: qDecay, rising, lost: sum(pages, 'lost') };
    }
    let trend = null;
    if (D.C && D.C.length >= 14) {
      const c = D.C.slice().sort((a, b) => a.d.localeCompare(b.d));
      const h = Math.floor(c.length / 2);
      const a1 = agg(c.slice(0, h).map(r => ({ ...r, pos: r.pos || 0 }))), a2 = agg(c.slice(c.length - h).map(r => ({ ...r, pos: r.pos || 0 })));
      trend = { clicks: change(a2.clicks, a1.clicks), impr: change(a2.impr, a1.impr), ctr: a2.ctr - a1.ctr };
    }

    // ── AI search (AEO / GEO) signals ──
    const ai = {
      // possible answer boxes or AI Overviews: top-5 rankings far below the site's own CTR at that position
      overview: capList(NBQ.filter(r => r.pos <= 5 && r.impr >= imprFloor && isSerp(r))
        .map(r => { const gainHi = perMonth(pos0(r.impr * (Math.min(expAt(r.pos) * EST.serpRatio, r.ctr * 2) - r.ctr) / 100)); return { ...r, bench: expAt(r.pos), gainLo: 0, gainHi, gain: 0, serp: true }; })
        .filter(r => r.gainHi >= 1), EST.capShare).sort((a, b) => b.impr - a.impr),
      questions: NBQ.filter(r => RX.question.test(r.q)).sort((a, b) => b.impr - a.impr),
      conversational: NBQ.filter(r => r.words >= 7).sort((a, b) => b.impr - a.impr),
      compare: NBQ.filter(r => RX.compare.test(r.q)).sort((a, b) => b.impr - a.impr),
      fresh: NBQ.filter(r => (RX.year.test(r.q) || RX.fresh.test(r.q))).sort((a, b) => b.impr - a.impr),
      snippets: NBQ.filter(r => r.pos <= 1.5 && r.impr >= imprFloor).sort((a, b) => b.impr - a.impr),
      // near-total zero-click at the very top: typical of AI Mode / full AI answers
      aiMode: NBQ.filter(r => r.pos <= 3 && r.impr >= imprFloor && r.ctr < 0.5).sort((a, b) => b.impr - a.impr),
      zeroPages: P.filter(r => r.pos <= 10 && r.impr >= pageFloor && r.ctr < 0.5).sort((a, b) => b.impr - a.impr)
    };
    // clicks per month below the industry benchmark curve, across page-one non-brand queries
    ai.expectedGap = perMonth(NBQ.filter(r => r.pos <= 10).reduce((s, r) => s + Math.max(0, r.impr * (expCtr(r.pos) - r.ctr) / 100), 0));
    const aiImpr = agg(ai.questions.concat(ai.conversational.filter(r => !RX.question.test(r.q))));
    const readiness = Math.round(Math.min(100,
      (ai.snippets.length ? 25 : 0) +
      Math.min(25, ai.questions.filter(r => r.pos <= 5).length / Math.max(1, ai.questions.length) * 50) +
      Math.min(25, (aiImpr.impr / Math.max(1, totNB.impr)) * 200) +
      Math.max(0, 25 - ai.overview.length / Math.max(1, NBQ.length) * 2500)));

    // ── Intent ──
    const intents = ['info', 'comm', 'trans', 'nav', 'other'].map(k => {
      const rows = Q.filter(r => r.intent === k).sort((a, b) => b.impr - a.impr);
      return { key: k, label: INTENT_LABEL[k], rows, ...agg(rows) };
    });

    // ── Site sections ──
    function sectionsAt(depth) {
      const m = new Map();
      P.forEach(r => {
        const segs = r.path.split('/').filter(Boolean);
        // a leaf page belongs to its parent folder; single-segment pages form their own section
        const key = segs.length ? '/' + segs.slice(0, Math.max(1, Math.min(depth, segs.length - 1))).join('/') + '/' : '/';
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(r);
      });
      return [...m.entries()].map(([k, rows]) => {
        const a = agg(rows);
        const bench = expCtr(a.pos);
        // status: what this section needs next
        const status = a.pos > 10 ? 'work' : a.ctr < bench * 0.6 ? 'ctr' : a.pos <= 5 && a.ctr >= bench * 0.8 ? 'strong' : 'steady';
        return { key: k, rows: rows.sort((x, y) => y.clicks - x.clicks), ...a, bench, status };
      }).sort((a, b) => b.clicks - a.clicks);
    }
    const sections1 = sectionsAt(1), sections2 = sectionsAt(2);

    // ── Page tiers (relative to this site) ──
    const clickVals = P.map(r => r.clicks).filter(v => v > 0);
    const t95 = pct(clickVals, 0.95), t80 = pct(clickVals, 0.8), t50 = pct(clickVals, 0.5);
    const tiers = [
      { key: 'carry', label: 'Carrying the site', desc: 'Top 5% of pages by clicks. Protect these: refresh before they slip.', rows: P.filter(r => r.clicks > 0 && r.clicks >= t95) },
      { key: 'strong', label: 'Strong', desc: 'Next 15%. Solid demand; small CTR or position gains compound here.', rows: P.filter(r => r.clicks >= t80 && r.clicks < t95) },
      { key: 'steady', label: 'Steady', desc: 'Middle of the pack. Internal links and depth move these up.', rows: P.filter(r => r.clicks >= t50 && r.clicks < t80) },
      { key: 'tail', label: 'Long tail', desc: 'Some clicks, little weight. Consider merging thin pages into stronger ones.', rows: P.filter(r => r.clicks > 0 && r.clicks < t50) },
      { key: 'ghost', label: 'Seen but not clicked', desc: 'Impressions with zero clicks. Usually ranking too low, or the wrong page for the query.', rows: P.filter(r => r.clicks === 0 && r.impr > 0) }
    ].map(t => ({ ...t, rows: t.rows.sort((a, b) => b.clicks - a.clicks || b.impr - a.impr), ...agg(t.rows) }));

    // ── Headline potential: one estimate per query, never summed across lists ──
    const bestByQuery = new Map();
    quickWins.concat(ctrQueries, ai.overview).forEach(r => { const o = bestByQuery.get(r.q); if (!o || r.gainHi > o.gainHi || (r.gainHi === o.gainHi && r.gainLo > o.gainLo)) bestByQuery.set(r.q, r); });
    const uniq = [...bestByQuery.values()];
    const potential = { lo: sum(uniq, 'gainLo'), hi: sum(uniq, 'gainHi'), n: uniq.length, monthlySiteClicks: perMonth(site.clicks) };
    const potentialMonthly = potential.lo;

    // ── Action plan ──
    const plan = [];
    if (ctrPages.length) {
      const top = ctrPages.slice(0, 10);
      plan.push({ view: 'ctr', gain: sum(top, 'gainLo'), gainHi: sum(top, 'gainHi'), effort: 'Low',
        title: `Rewrite titles and meta descriptions on ${top.length} page${top.length > 1 ? 's' : ''} that already rank on page one`,
        body: `Start with ${top[0].path}: ${fmtN(top[0].impr)} impressions at position ${top[0].pos.toFixed(1)}, but ${top[0].ctr.toFixed(1)}% CTR where ${top[0].bench.toFixed(1)}% is expected at that position. No ranking change is needed for these gains.` });
    }
    if (quickWins.length) {
      const top = quickWins.slice(0, 20);
      plan.push({ view: 'quickwins', gain: sum(top, 'gainLo'), gainHi: sum(top, 'gainHi'), effort: 'Medium',
        title: `Move ${top.length} queries from positions 4–20 up the page`,
        body: `Biggest prize: “${top[0].q}” at position ${top[0].pos.toFixed(1)} with ${fmtN(top[0].impr)} impressions. Add internal links from strong pages, expand the section that answers it, and match the title to the query.` });
    }
    if (decay && decay.pages.length) {
      const top = decay.pages.slice(0, 10);
      plan.push({ view: 'decay', gain: perMonth(sum(top, 'lost')) * 0.3, gainHi: perMonth(sum(top, 'lost')) * 0.8, effort: 'Medium',
        title: `Refresh ${top.length} page${top.length > 1 ? 's' : ''} that lost clicks since the previous period`,
        body: `${top[0].path} dropped from ${fmtN(top[0].prev.clicks)} to ${fmtN(top[0].cur.clicks)} clicks (${top[0].reason}). Update facts, dates and examples, and check what now outranks it.` });
    }
    if (cannibal.length && cannibalMode === 'exact') {
      const top = cannibal.filter(c => c.sev !== 'low').slice(0, 10);
      if (top.length) plan.push({ view: 'cannibal', gain: 0, gainHi: sum(top, 'loss') * 0.5, effort: 'Medium',
        title: `Pick one page for ${top.length} quer${top.length > 1 ? 'ies' : 'y'} where your own pages compete`,
        body: `“${top[0].q}” splits impressions across ${top[0].pages.length} URLs. Merge or differentiate them, and point internal links at the one you want to rank.` });
    }
    if (ai.overview.length) {
      const top = ai.overview.slice(0, 15);
      plan.push({ view: 'ai', gain: 0, gainHi: sum(top, 'gainHi'), effort: 'Medium',
        title: `Check ${top.length} top-5 queries that may be answered on the results page`,
        body: `These rank well but get a fraction of the clicks this site normally earns at that position — often an AI Overview or answer box. Lead the page with a 40–60 word direct answer, add FAQ or HowTo structure, and give the reader a reason to click for depth.` });
    }
    const strong = sections1.filter(s => s.n >= 1 && s.n <= 8 && s.pos <= 8 && s.impr >= pageFloor * 3 && s.key !== '/').sort((a, b) => b.ctr - a.ctr)[0];
    if (strong) plan.push({ view: 'sections', gain: null, effort: 'High',
      title: `Expand ${strong.key} — strong rankings, only ${strong.n} page${strong.n > 1 ? 's' : ''}`,
      body: `Average position ${strong.pos.toFixed(1)} and ${strong.ctr.toFixed(1)}% CTR show Google already trusts this topic. More pages here should rank quickly.` });
    plan.sort((a, b) => (b.gain || 0) - (a.gain || 0) || (b.gainHi || 0) - (a.gainHi || 0));

    // ── Signals: going well / needs attention / opportunities ──
    const good = [], bad = [], opp = [];
    const topSec = sections1.filter(s => s.key !== '/')[0];
    if (topSec) good.push({ l: `${topSec.key} section`, v: `${fmtN(topSec.clicks)} clicks · ${topSec.ctr.toFixed(1)}% CTR`, view: 'sections' });
    const topQ = NBQ.slice().sort((a, b) => b.clicks - a.clicks)[0];
    if (topQ) good.push({ l: `“${topQ.q}”`, v: `${fmtN(topQ.clicks)} clicks at #${topQ.pos.toFixed(1)}`, view: 'queries' });
    if (ai.snippets.length) good.push({ l: 'Holding position one', v: `${ai.snippets.length} non-brand ${ai.snippets.length === 1 ? 'query' : 'queries'}`, view: 'ai' });
    if (decay && decay.rising.length) good.push({ l: decay.rising[0].path, v: `+${fmtN(decay.rising[0].won)} clicks vs previous`, view: 'decay' });
    if (ctrPages[0]) bad.push({ l: ctrPages[0].path, v: `${ctrPages[0].ctr.toFixed(1)}% CTR at #${ctrPages[0].pos.toFixed(1)}`, view: 'ctr' });
    if (decay && decay.pages[0]) bad.push({ l: decay.pages[0].path, v: `${decay.pages[0].ch.toFixed(0)}% clicks`, view: 'decay' });
    const hi = cannibal.filter(c => c.sev === 'high').length;
    if (hi) bad.push({ l: 'Pages competing with each other', v: `${hi} high-severity ${hi === 1 ? 'query' : 'queries'}`, view: 'cannibal' });
    if (ai.overview.length) bad.push({ l: 'Possible answer boxes or AI Overviews', v: `${ai.overview.length} top-5 ${ai.overview.length === 1 ? 'query' : 'queries'}`, view: 'ai' });
    if (quickWins[0]) opp.push({ l: `“${quickWins[0].q}”`, v: `#${quickWins[0].pos.toFixed(1)} · +${fmtN(quickWins[0].gainLo) === fmtN(quickWins[0].gainHi) ? fmtN(quickWins[0].gainHi) : fmtN(quickWins[0].gainLo) + '–' + fmtN(quickWins[0].gainHi)}/mo`, view: 'quickwins' });
    if (quickWins.length) opp.push({ l: `${quickWins.length} queries on positions 4–20`, v: 'Push to top 3', view: 'quickwins' });
    if (ctrPages.length) opp.push({ l: `${ctrPages.length} page-one titles`, v: 'Rewrite for CTR', view: 'ctr' });
    if (ai.questions.length) opp.push({ l: `${ai.questions.length} question searches`, v: 'Answer directly for AI', view: 'ai' });
    const signals = { good: good.slice(0, 4), bad: bad.slice(0, 4), opp: opp.slice(0, 4) };

    // ── Position distribution (non-brand queries) ──
    const BUCKETS = [['1–3', 0, 3.5], ['4–10', 3.5, 10.5], ['11–20', 10.5, 20.5], ['21–50', 20.5, 50.5], ['51+', 50.5, 1e9]];
    const posDist = BUCKETS.map(([label, lo, hi]) => { const rows = NBQ.filter(r => r.pos >= lo && r.pos < hi); return { label, ...agg(rows) }; });

    // ── CTR by position: actual (impression-weighted) vs benchmark ──
    const ctrByPos = [];
    for (let p = 1; p <= 20; p++) {
      const rows = NBQ.filter(r => Math.round(r.pos) === p);
      const a = agg(rows);
      ctrByPos.push({ pos: p, actual: rows.length ? a.ctr : null, bench: expCtr(p), expected: expAt(p), n: rows.length, impr: a.impr });
    }

    // ── Anonymous queries: clicks Google doesn't attribute to any query ──
    // ── Coverage: how much of the site's search traffic the query and page rows contain ──
    // Only when daily totals exist; without a denominator no percentage is shown.
    const hasSite = !!(D0.C && D0.C.length);
    const q0 = agg(D0.Q), p0 = agg(D0.P);
    const rowLimit = D0.source === 'file' && (D0.Q.length === 1000 || D0.P.length === 1000);
    const coverage = hasSite ? {
      source: D0.source, rowsQ: D0.Q.length, rowsP: D0.P.length, rowLimit,
      q: { clicks: site.clicks ? q0.clicks / site.clicks * 100 : null, impr: site.impr ? q0.impr / site.impr * 100 : null },
      p: { clicks: site.clicks ? p0.clicks / site.clicks * 100 : null, impr: site.impr ? p0.impr / site.impr * 100 : null },
      // clicks the query rows do not account for: export row limits and queries Google withholds
      notShown: { clicks: Math.max(0, site.clicks - q0.clicks), share: site.clicks ? Math.max(0, site.clicks - q0.clicks) / site.clicks * 100 : 0 }
    } : null;
    const method = { days, start: D0.start || null, end: D0.end || null, assumedDays: !D0.days, curve: curve.points, sitePositions: curve.sitePositions, ...EST };

    return {
      Q, NBQ, BQ, P, totNB, totB, totAll, site, prev, days, perMonth, imprFloor,
      quickWins, ctrPages, ctrQueries, cannibal, cannibalMode, decay, trend, ai, readiness,
      prevSite, intents, sections1, sections2, tiers, potential, potentialMonthly, plan, signals, posDist, ctrByPos, coverage, method, curve, pageCurve, setAside, pageFlags,
      brandRx: brandRegex(S.brand), isBrand, isExcluded, data: D, ignored: ign
    };
  }
  const STEMSTOP = new Set('a an the for and or to in of on at by with from is are how what best top near me my your vs'.split(' '));

  function decayReason(pr, cu) {
    if (!cu.impr) return 'no longer shows in search';
    const imprCh = change(cu.impr, pr.impr);
    if (cu.pos && pr.pos && cu.pos - pr.pos > 2) return `position fell ${pr.pos.toFixed(1)} → ${cu.pos.toFixed(1)}`;
    if (imprCh !== null && imprCh < -30) return `impressions down ${Math.abs(imprCh).toFixed(0)}%, demand or visibility dropped`;
    if (cu.ctr < pr.ctr * 0.7) return `CTR fell ${pr.ctr.toFixed(1)}% → ${cu.ctr.toFixed(1)}% at similar rank`;
    return 'mixed: smaller drops in rank and CTR';
  }

  function fmtN(n) {
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return Math.round(n / 1e3) + 'K';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.round(n).toLocaleString('en-US');
  }

  window.CW = { analyse, expCtr, agg, pct, fmtN, brandGuess, pathOf, INTENT_LABEL, change, RX, makeBrandTest, buildCurve, EST, DEFAULT_UTILITY };
})();

// Clickwise content assistant — topic clusters, content gaps, page improvements, internal links and briefs.
// Pure functions: no DOM, no network. Everything is built from the loaded Search Console data (and, when the
// user uploads one, a crawler's link export). No URL, search or demand figure is invented: every page named
// comes from the data, every anchor text is a real search, and impressions are this site's own, not market volume.
(function () {
  'use strict';
  const CW = window.CW;

  // ── words ──
  // Filler words never define a topic. Modifiers such as "best", "vs" or a year are kept: they change intent.
  const STOP = new Set('a an the and or of for to in on at by with from into is are was be been do does did can could should would will i me my we our you your it its this that these those there here what which who whom whose when where why how near me'.split(' '));
  const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w;
  function tokens(q, brandWords) {
    const out = [];
    String(q).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).forEach(w => {
      if (!w || STOP.has(w) || brandWords.has(w)) return;
      const s = stem(w);
      if (!out.includes(s)) out.push(s);
    });
    return out;
  }
  // A page is "about" a topic when its URL shares at least two of the topic's words (or its only word).
  // One shared generic word such as "trek" is not enough.
  function isAbout(path, topicWords) {
    const tw = topicWords.filter(w => !/^\d+$/.test(w)), pw = new Set(tokens(String(path).replace(/[/_.-]+/g, ' '), new Set()));
    const hits = tw.filter(w => pw.has(w)).length;
    return tw.length > 0 && hits >= Math.min(2, tw.length);
  }
  const jacc = (a, b) => { let i = 0; a.forEach(x => { if (b.has(x)) i++; }); return i / (a.size + b.size - i || 1); };
  const titleCase = s => s.replace(/(^|\s)(\p{L})/gu, (m, sp, c) => sp + c.toUpperCase());
  const MAX_CAND = 60, PER_WORD = 30;
  const QUESTION = /^(who|what|when|where|why|how|which|can|could|does|do|did|is|are|was|were|should|will|would)\b/i;

  // ── URLs: the same page written two ways (http/https, www, trailing slash, #fragment) compares equal ──
  function normUrl(u) {
    let s = String(u || '').trim();
    if (!s) return '';
    s = s.replace(/#.*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    const i = s.indexOf('/');
    const host = (i < 0 ? s : s.slice(0, i)).toLowerCase(), path = i < 0 ? '/' : s.slice(i);
    return host + (path.length > 1 ? path.replace(/\/+$/, '') : '');
  }

  // ── crawler link export (Screaming Frog "All Inlinks", Sitebulb, or any CSV with source and destination columns) ──
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    // delimiter from the header line: comma, tab or semicolon, whichever appears most outside quotes
    const head0 = (String(text || '').split(/\r?\n/)[0] || '').replace(/"[^"]*"/g, '');
    const dl = [',', '\t', ';'].map(d => [d, head0.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const t = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === dl) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  function parseLinks(text, siteHost) {
    const rows = parseCSV(text);
    if (rows.length < 2) return { ok: false, error: 'This file has no rows. Export “All Inlinks” (or a similar links report) from your crawler as CSV.' };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const find = res => head.findIndex(h => res.some(r => r.test(h)));
    const si = find([/^source$/, /^source (url|page|address)$/, /^from$/, /^from (url|page)$/, /^referring (url|page)$/, /^linking page$/]);
    const di = find([/^destination$/, /^destination (url|page|address)$/, /^target$/, /^target (url|page)$/, /^to$/, /^to (url|page)$/, /^linked page$/]);
    if (si < 0 || di < 0) return { ok: false, error: 'Could not find source and destination columns. The file needs columns named like “Source” and “Destination” (Screaming Frog › Bulk Export › Links › All Inlinks).' };
    const ti = head.findIndex(h => h === 'type' || h === 'link type');
    const ai = head.findIndex(h => h === 'anchor' || h === 'anchor text');
    const links = new Map(); let kept = 0, skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (ti >= 0 && r[ti] && !/hyperlink|^a$|link/i.test(r[ti])) { skipped++; continue; }
      const s = normUrl(r[si]), d = normUrl(r[di]);
      if (!s || !d || s === d) { skipped++; continue; }
      if (siteHost && (s.split('/')[0] !== siteHost || d.split('/')[0] !== siteHost)) { skipped++; continue; }
      const k = s + ' → ' + d;
      if (!links.has(k)) links.set(k, ai >= 0 ? String(r[ai] || '').trim() : '');
      kept++;
    }
    if (!links.size) return { ok: false, error: siteHost ? `No links between pages on ${siteHost} were found in this file.` : 'No links were found in this file.' };
    return { ok: true, links, count: links.size, rows: rows.length - 1, skipped };
  }

  // ── main ──
  function build(A, D, opts) {
    D = D || A.data || {};
    opts = opts || {};
    const brandWords = new Set([].concat(...(opts.brand || []).map(b => String(b).toLowerCase().split(/[^\p{L}\p{N}]+/u))).filter(Boolean));
    const hasQP = !!(D.QP && D.QP.length);
    const pathOf = CW.pathOf;
    const flagged = url => !!(A.pageFlags && A.pageFlags.get(url));
    const usable = url => !A.isExcluded(url) && !flagged(url);
    const pageBy = new Map(A.P.map(r => [r.p, r]));

    // which page ranks for each search: the page with the largest share of its impressions
    const landing = new Map(), qpByQ = new Map();
    if (hasQP) {
      D.QP.forEach(r => { if (A.isBrand(r.q) || A.isExcluded(r.p)) return; if (!qpByQ.has(r.q)) qpByQ.set(r.q, []); qpByQ.get(r.q).push(r); });
      qpByQ.forEach((rows, q) => { const best = rows.reduce((b, r) => !b || r.impr > b.impr ? r : b, null); landing.set(q, best); });
    }

    // ── C1: topic clusters ──
    // Leader clustering, strongest search first: a search joins the cluster whose leading search shares at least
    // half its words (Jaccard ≥ 0.5), or a quarter when both rank with the same page. Deterministic and linear
    // enough for 100,000 searches: candidates come from the search's rarest words only.
    const items = A.NBQ.filter(r => r.impr > 0).map(r => ({ r, t: tokens(r.q, brandWords) })).filter(x => x.t.length)
      .sort((a, b) => b.r.impr - a.r.impr || (a.r.q < b.r.q ? -1 : a.r.q > b.r.q ? 1 : 0));
    const df = new Map(); items.forEach(x => x.t.forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const clusters = [], index = new Map();
    items.forEach(x => {
      const set = new Set(x.t), land = landing.get(x.r.q), lp = land ? land.p : null;
      // A shared leading word is required, so candidates come from the search's rarest words; at most
      // MAX_CAND clusters are checked, in creation order, so very common words cannot make this quadratic.
      const rare = x.t.slice().sort((a, b) => df.get(a) - df.get(b) || (a < b ? -1 : 1)).slice(0, 3);
      const cand = new Set();
      for (const w of rare) { const l = index.get(w) || []; for (let k = 0; k < l.length && k < PER_WORD && cand.size < MAX_CAND; k++) cand.add(l[k]); if (cand.size >= MAX_CAND) break; }
      let best = -1, bestScore = 0;
      [...cand].sort((a, b) => a - b).forEach(i => {
        const c = clusters[i], j = jacc(set, c.lead), same = lp && c.landingP === lp;
        if (j >= 0.5 || (same && j >= 0.25)) { const sc = j + (same ? 0.25 : 0); if (sc > bestScore) { bestScore = sc; best = i; } }
      });
      if (best >= 0) clusters[best].rows.push(x.r);
      else { const c = { id: 'c' + clusters.length, lead: set, leadTokens: x.t, leader: x.r, landingP: lp, rows: [x.r] }; clusters.push(c); x.t.forEach(w => { if (!index.has(w)) index.set(w, []); index.get(w).push(clusters.length - 1); }); }
    });
    const clusterOf = new Map();
    const topics = clusters.map(c => {
      const a = CW.agg(c.rows);
      c.rows.forEach(r => clusterOf.set(r.q, c.id));
      // pages this topic ranks with (query-page data only), by share of the topic's impressions
      let pages = [];
      if (hasQP) {
        const m = new Map();
        c.rows.forEach(r => (qpByQ.get(r.q) || []).forEach(x => { const o = m.get(x.p) || { p: x.p, impr: 0, clicks: 0, posW: 0 }; o.impr += x.impr; o.clicks += x.clicks; o.posW += x.pos * x.impr; m.set(x.p, o); }));
        const tot = [...m.values()].reduce((s, o) => s + o.impr, 0) || 1;
        pages = [...m.values()].map(o => ({ p: o.p, path: pathOf(o.p), impr: o.impr, clicks: o.clicks, pos: o.impr ? o.posW / o.impr : 0, share: o.impr / tot * 100 }))
          .sort((x, y) => y.impr - x.impr || (x.p < y.p ? -1 : 1));
      }
      const questions = c.rows.filter(r => QUESTION.test(r.q));
      const best = c.rows.reduce((m, r) => Math.min(m, r.pos), Infinity);
      const intents = {}; c.rows.forEach(r => { intents[r.intent] = (intents[r.intent] || 0) + r.impr; });
      const intent = Object.entries(intents).sort((x, y) => y[1] - x[1])[0][0];
      return { id: c.id, label: c.leader.q, leader: c.leader, rows: c.rows.slice().sort((x, y) => y.impr - x.impr), n: c.rows.length, ...a, best, pages, top: pages[0] || null, questions, intent, words: c.leadTokens };
    }).sort((x, y) => y.impr - x.impr || (x.label < y.label ? -1 : 1));
    const topicById = new Map(topics.map(t => [t.id, t]));

    // ── C2: content gaps ──
    // Demand here means impressions this site already receives; topics with no impressions at all are invisible
    // to Search Console and need a keyword research tool.
    // a topic needs at least three times the impressions of a typical search to count as demand
    const gapFloor = Math.max(50, A.imprFloor * 3);
    const gaps = [];
    topics.forEach(t => {
      if (t.impr < gapFloor) return;
      const kinds = [], evidence = [];
      if (t.best > 10) { kinds.push('unranked'); evidence.push(`${CW.fmtN(t.impr)} impressions across ${t.n} search${t.n === 1 ? '' : 'es'}, but the best position is ${t.best.toFixed(1)}: nothing in this topic reaches page one`); }
      if (t.top && t.top.path === '/' && t.top.share >= 50) { kinds.push('homepage'); evidence.push(`Only the homepage ranks for this topic (${t.top.share.toFixed(0)}% of its impressions)`); }
      const strong = t.pages.filter(p => p.share >= 10);
      if (strong.length >= 2 && t.top.share < 40) {
        // pages whose URL shares a word with the topic are about it and can be merged; otherwise Google is
        // trying unrelated pages because none matches the search
        const list = strong.slice(0, 3).map(p => `${p.path} (${p.share.toFixed(0)}%)`).join(', ');
        const about = strong.filter(p => isAbout(p.path, t.words));
        if (about.length >= 2) { kinds.push('scattered'); evidence.push(`Impressions are split across ${about.length} pages about this topic; the largest has ${t.top.share.toFixed(0)}%: ${about.slice(0, 3).map(p => `${p.path} (${p.share.toFixed(0)}%)`).join(', ')}`); }
        else if (about.length === 1) { kinds.push('diluted'); evidence.push(`Google splits this topic between ${about[0].path} (${about[0].share.toFixed(0)}% of impressions) and ${strong.length - 1} unrelated page${strong.length > 2 ? 's' : ''}: ${strong.filter(p => p !== about[0]).slice(0, 3).map(p => `${p.path} (${p.share.toFixed(0)}%)`).join(', ')}`); t.match = about[0]; }
        else { kinds.push('nomatch'); evidence.push(`Google shows ${strong.length} different pages and none is about this topic by its URL: ${list}`); }
      }
      const qa = CW.agg(t.questions);
      if (t.questions.length >= 2 && qa.impr >= gapFloor / 3 && qa.pos > 10) { kinds.push('questions'); evidence.push(`${t.questions.length} question searches (${CW.fmtN(qa.impr)} impressions) rank at ${qa.pos.toFixed(1)} on average: ${t.questions.slice(0, 3).map(r => `“${r.q}”`).join(', ')}`); }
      if (!kinds.length) return;
      const target = kinds.includes('diluted') ? t.match : t.top && t.top.path !== '/' && usable(t.top.p) && !kinds.includes('nomatch') ? t.top : null;
      const action = kinds.includes('diluted') ? `Make ${t.match.path} the clear answer for “${t.label}”: cover it fully on that page and link to it from related pages, so Google stops trying other pages.`
        : kinds.includes('nomatch') ? `Create a page dedicated to “${t.label}”: none of the pages Google shows for it is about this topic.`
        : kinds.includes('scattered') ? `Pick one page for “${t.label}”${target ? ` (${target.path} has the most impressions)` : ''}, merge or redirect the others into it, and point internal links at it.`
        : kinds.includes('homepage') ? `Create a page dedicated to “${t.label}” so the homepage is not carrying it.`
        : kinds.includes('questions') && !kinds.includes('unranked') ? `Answer these questions directly${target ? ` on ${target.path}` : ' on a page about this topic'}, with each question as a heading.`
        : target ? `Expand ${target.path} so it fully covers “${t.label}”, or create a dedicated page if it is about something else.` : `Create a page dedicated to “${t.label}”${hasQP ? '' : ' (connect Search Console to see which of your pages, if any, ranks for it now)'}.`;
      gaps.push({ id: t.id, topic: t, label: t.label, kinds, evidence, action, target, impr: t.impr, clicks: t.clicks, pos: t.pos, best: t.best, needsQP: !hasQP && !kinds.includes('unranked') && !kinds.includes('questions') });
    });

    // ── C2: page improvements ──
    const improvements = [];
    if (hasQP) {
      const byPage = new Map();
      landing.forEach((r, q) => { if (!usable(r.p)) return; if (!byPage.has(r.p)) byPage.set(r.p, []); byPage.get(r.p).push({ q, ...r }); });
      byPage.forEach((rows, p) => {
        const near = rows.filter(r => r.pos > 3.5 && r.pos <= 20 && r.impr >= A.imprFloor).sort((a, b) => b.impr - a.impr || (a.q < b.q ? -1 : 1));
        const tset = new Map(); rows.forEach(r => { const id = clusterOf.get(r.q); if (id) tset.set(id, (tset.get(id) || 0) + r.impr); });
        const tot = [...tset.values()].reduce((s, v) => s + v, 0) || 1, topicCount = [...tset.values()].filter(v => v / tot >= 0.05).length, topShare = Math.max(0, ...tset.values()) / tot * 100;
        const spread = topicCount >= 5 && topShare < 40;
        if (!near.length && !spread) return;
        const pg = pageBy.get(p);
        improvements.push({ p, path: pathOf(p), page: pg || null, near: near.slice(0, 8), nearImpr: near.reduce((s, r) => s + r.impr, 0), spread, topicCount, topShare,
          actions: [near.length ? `Add or expand a section for ${near.slice(0, 3).map(r => `“${r.q}”`).join(', ')}${near.length > 3 ? ` and ${near.length - 3} more` : ''}: each ranks ${near.length === 1 ? 'at' : 'between'} ${near.length === 1 ? near[0].pos.toFixed(1) : Math.min(...near.map(r => r.pos)).toFixed(1) + ' and ' + Math.max(...near.map(r => r.pos)).toFixed(1)} with this page.` : '',
            spread ? `This page ranks for ${topicCount} different topics and none has more than ${topShare.toFixed(0)}% of its impressions; consider splitting it into focused pages.` : ''].filter(Boolean) });
      });
      improvements.sort((a, b) => b.nearImpr - a.nearImpr || (a.p < b.p ? -1 : 1));
    } else {
      // without query-page rows only the page's own position is known
      A.P.filter(r => usable(r.p) && r.pos > 3.5 && r.pos <= 20 && r.impr >= A.pageFloor && r.path !== '/').sort((a, b) => b.impr - a.impr).forEach(r => {
        improvements.push({ p: r.p, path: r.path, page: r, near: [], nearImpr: r.impr, spread: false, pageOnly: true,
          actions: [`Ranks at ${r.pos.toFixed(1)} on average with ${CW.fmtN(r.impr)} impressions. Which searches it ranks for is not in an export; connect Search Console to see the exact searches to add sections for.`] });
      });
    }

    // ── C3: internal links ──
    // Target: a page with searches close to page one. Source: a page that already ranks on page one for a search
    // in the same topic. The anchor is the target's own search. With a crawler export, links that exist are dropped.
    const inl = opts.inlinks && opts.inlinks.links instanceof Map ? opts.inlinks.links : null;
    const exists = (s, d) => inl ? inl.has(normUrl(s) + ' → ' + normUrl(d)) : false;
    const links = []; let alreadyLinked = 0;
    if (hasQP) {
      // pages that rank on page one, per topic
      const rankers = new Map();
      landing.forEach((r, q) => { if (!usable(r.p) || r.pos > 10 || r.clicks <= 0) return; const id = clusterOf.get(q); if (!id) return; if (!rankers.has(id)) rankers.set(id, []); rankers.get(id).push({ q, ...r }); });
      improvements.filter(x => x.near.length).forEach(x => {
        const tq = x.near[0], id = clusterOf.get(tq.q), t = id && topicById.get(id);
        if (!t) return;
        const cand = new Map();
        (rankers.get(id) || []).forEach(r => {
          if (r.p === x.p) return;
          const o = cand.get(r.p); if (!o || r.clicks > o.clicks) cand.set(r.p, r);
        });
        let dropped = 0;
        const sources = [...cand.values()].filter(r => { if (exists(r.p, x.p)) { dropped++; return false; } return true; })
          .sort((a, b) => b.clicks - a.clicks || (a.p < b.p ? -1 : 1)).slice(0, 3)
          .map(r => ({ p: r.p, path: pathOf(r.p), q: r.q, pos: r.pos, clicks: r.clicks, why: `ranks at ${r.pos.toFixed(1)} for “${r.q}” (same topic as “${t.label}”)` }));
        alreadyLinked += dropped;
        if (!sources.length) return;
        links.push({ p: x.p, path: x.path, target: tq, anchor: tq.q, topic: t.label, sources, impr: tq.impr, pos: tq.pos, verified: !!inl, evidence: 'search' });
      });
    } else {
      // export only: no search-to-page data, so sources are the strongest pages in the same folder
      const folder = path => { const s = path.split('/').filter(Boolean); return s.length > 1 ? '/' + s[0] + '/' : null; };
      const strong = A.P.filter(r => usable(r.p) && r.pos > 0 && r.pos <= 6 && r.clicks > 0);
      improvements.forEach(x => {
        const f = folder(x.path); if (!f) return;
        let dropped = 0;
        const sources = strong.filter(s => s.p !== x.p && s.path.startsWith(f)).filter(s => { if (exists(s.p, x.p)) { dropped++; return false; } return true; })
          .sort((a, b) => b.clicks - a.clicks || (a.p < b.p ? -1 : 1)).slice(0, 3)
          .map(s => ({ p: s.p, path: s.path, q: null, pos: s.pos, clicks: s.clicks, why: `in the same folder (${f}) and ranks at ${s.pos.toFixed(1)}` }));
        alreadyLinked += dropped;
        if (sources.length) links.push({ p: x.p, path: x.path, target: null, anchor: null, topic: null, sources, impr: x.page.impr, pos: x.page.pos, verified: !!inl, evidence: 'folder' });
      });
    }
    links.sort((a, b) => b.impr - a.impr || (a.p < b.p ? -1 : 1));

    // ── C4: briefs, one per gap or improvement topic, drafted by fixed rules from the topic's real searches ──
    function brief(t) {
      const lead = new Set(t.words);
      const extra = new Map();
      t.rows.forEach(r => tokens(r.q, brandWords).forEach(w => { if (!lead.has(w) && !/^\d+$/.test(w)) extra.set(w, (extra.get(w) || 0) + r.impr); }));
      const more = [...extra.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(e => e[0]);
      // title: the strongest real search that adds a word to the topic, else the topic itself; nothing is made up
      const combo = t.rows.find(r => r.q !== t.label && t.words.every(w => tokens(r.q, brandWords).includes(w)));
      const title = titleCase(combo ? combo.q : t.label);
      const headings = [];
      t.questions.slice(0, 6).forEach(r => headings.push(r.q.charAt(0).toUpperCase() + r.q.slice(1) + (r.q.endsWith('?') ? '' : '?')));
      t.rows.filter(r => !QUESTION.test(r.q) && r.q !== t.label).forEach(r => { if (headings.length < 8) headings.push(titleCase(r.q)); });
      const target = t.top && t.top.path !== '/' && usable(t.top.p) && t.top.pos <= 30 ? t.top : null;
      const fromLinks = target ? (links.find(l => l.p === target.p) || { sources: [] }).sources : [];
      const fromTopic = t.pages.filter(p => p.pos <= 10 && (!target || p.p !== target.p) && usable(p.p)).slice(0, 3).map(p => ({ p: p.p, path: p.path, why: `ranks at ${p.pos.toFixed(1)} for this topic` }));
      return { id: t.id, label: t.label, target, title, alsoCover: more, headings, intent: CW.INTENT_LABEL[t.intent] || 'Unclassified',
        queries: t.rows.slice(0, 25).map(r => ({ q: r.q, impr: r.impr, clicks: r.clicks, pos: r.pos })), more: t.rows.length > 25 ? t.rows.length - 25 : 0,
        linkFrom: fromLinks.length ? fromLinks : fromTopic, impr: t.impr, pos: t.pos };
    }
    const briefIds = [...new Set(gaps.map(g => g.id).concat(links.filter(l => l.target).map(l => clusterOf.get(l.target.q))))].filter(Boolean);
    const briefs = briefIds.map(id => brief(topicById.get(id))).sort((a, b) => b.impr - a.impr || (a.id < b.id ? -1 : 1));

    return { mode: hasQP ? 'search' : 'export', topics, gaps, improvements, links, briefs, alreadyLinked, inlinks: inl ? { count: inl.size, name: opts.inlinks.name || null } : null, gapFloor, clusterOf };
  }

  // A brief as plain text, for copying into a document.
  function briefText(b) {
    return [`Topic: ${b.label}`, `Page: ${b.target ? b.target.path : 'New page'}`, `Suggested title: ${b.title}`, ...(b.alsoCover.length ? [`Words searchers add: ${b.alsoCover.join(', ')}`] : []), `Search intent: ${b.intent}`, '',
      'Headings to cover:', ...b.headings.map(h => '- ' + h), '', 'Searches this page should answer (impressions, position):', ...b.queries.map(q => `- ${q.q} (${Math.round(q.impr)}, ${q.pos.toFixed(1)})`),
      ...(b.more ? [`- and ${b.more} more`] : []), '', 'Link to it from:', ...(b.linkFrom.length ? b.linkFrom.map(s => `- ${s.path}: ${s.why}`) : ['- No page ranks on page one for this topic yet']), '',
      'Drafted by Clickwise from your Search Console data with fixed rules. Check facts, tone and the title before publishing.'].join('\n');
  }

  window.CW_CONTENT = { build, tokens, normUrl, parseCSV, parseLinks, briefText };
})();

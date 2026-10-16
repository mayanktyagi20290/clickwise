// Clickwise smart filters — structured, validated filters and a plain-English parser.
// Pure functions, no DOM. Users never type patterns: every text value is matched with
// plain string comparison, or escaped before it is used inside an internal matcher.
(function () {
  'use strict';
  const CW = window.CW;

  // ── what a filter can look at ──
  // kind: num | text | bool | enum. `on` lists the row types the field applies to.
  const FIELDS = {
    clicks: { kind: 'num', label: 'Clicks', on: ['query', 'page'] },
    impr: { kind: 'num', label: 'Impressions', on: ['query', 'page'] },
    ctr: { kind: 'num', label: 'CTR', unit: '%', on: ['query', 'page'], min: 0, max: 100 },
    pos: { kind: 'num', label: 'Position', on: ['query', 'page'], min: 1, max: 1000 },
    ctrGap: { kind: 'num', label: 'Share of expected clicks', unit: '%', on: ['query', 'page'], min: 0, max: 10000 },
    clickChange: { kind: 'num', label: 'Change in clicks', unit: '%', on: ['query', 'page'], needs: 'prev', min: -100, max: 100000 },
    words: { kind: 'num', label: 'Words in the search', on: ['query'], min: 1, max: 50 },
    text: { kind: 'text', label: { query: 'Search', page: 'URL' }, on: ['query', 'page'] },
    section: { kind: 'enum', label: 'Folder', on: ['page'] },
    pageType: { kind: 'enum', label: 'Page type', on: ['page'] },
    brand: { kind: 'bool', label: 'Branded', on: ['query'] },
    question: { kind: 'bool', label: 'Question', on: ['query'] },
    location: { kind: 'bool', label: 'Mentions a place', on: ['query', 'page'] },
    intent: { kind: 'enum', label: 'Intent', on: ['query'] }
  };
  const OPS = {
    num: ['gt', 'gte', 'lt', 'lte', 'between'],
    text: ['contains', 'notContains', 'startsWith', 'endsWith', 'equals', 'word', 'in'],
    bool: ['is'],
    enum: ['is', 'not']
  };
  const GROUPS = { pageType: 'page type', folder: 'folder', location: 'place', brand: 'branded vs non-branded', intent: 'intent' };
  const MAX_TEXT = 200;

  // ── places: a compact list of cities, states and countries ──
  // Whole-word match only, so "nice" or "reading" are left out on purpose.
  const PLACES = ('delhi|new delhi|mumbai|bombay|bangalore|bengaluru|hyderabad|chennai|kolkata|calcutta|pune|ahmedabad|jaipur|surat|lucknow|kanpur|nagpur|indore|bhopal|patna|chandigarh|noida|greater noida|gurgaon|gurugram|ghaziabad|faridabad|kochi|cochin|coimbatore|vadodara|baroda|visakhapatnam|vizag|thane|navi mumbai|nashik|ludhiana|agra|varanasi|dehradun|goa|mysore|mysuru|bhubaneswar|guwahati|ranchi|raipur|amritsar|jodhpur|udaipur|srinagar|jammu|shimla|manali|rishikesh|haridwar|trivandrum|thiruvananthapuram|madurai|mangalore|mangaluru|vijayawada|rajkot|meerut|allahabad|prayagraj|gwalior|jabalpur|aurangabad|siliguri|pondicherry|puducherry|' +
    'maharashtra|karnataka|tamil nadu|kerala|gujarat|rajasthan|punjab|haryana|uttar pradesh|madhya pradesh|bihar|west bengal|telangana|andhra pradesh|odisha|assam|uttarakhand|himachal|himachal pradesh|jharkhand|chhattisgarh|ncr|delhi ncr|' +
    'new york|nyc|london|paris|dubai|abu dhabi|singapore|sydney|melbourne|brisbane|perth|toronto|vancouver|montreal|los angeles|chicago|san francisco|boston|seattle|austin|houston|dallas|miami|atlanta|denver|phoenix|philadelphia|san diego|washington|berlin|munich|hamburg|amsterdam|madrid|barcelona|rome|milan|vienna|zurich|geneva|stockholm|copenhagen|oslo|helsinki|lisbon|brussels|prague|warsaw|dublin|edinburgh|manchester|birmingham|glasgow|tokyo|osaka|seoul|beijing|shanghai|hong kong|taipei|bangkok|kuala lumpur|jakarta|manila|ho chi minh|hanoi|dhaka|karachi|lahore|islamabad|kathmandu|colombo|cairo|lagos|nairobi|johannesburg|cape town|sao paulo|rio de janeiro|buenos aires|mexico city|bogota|lima|santiago|riyadh|jeddah|doha|muscat|kuwait|istanbul|moscow|auckland|wellington|' +
    'india|usa|united states|uk|united kingdom|england|canada|australia|germany|france|spain|italy|japan|china|uae|saudi arabia|singapore|malaysia|indonesia|philippines|nepal|sri lanka|bangladesh|pakistan|nigeria|kenya|south africa|brazil|mexico|ireland|netherlands|new zealand').split('|');
  const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const B = '(?:^|[^\\p{L}\\p{N}])', E = '(?=$|[^\\p{L}\\p{N}])';
  // longest names first so "new delhi" wins over "delhi"
  const PLACE_RX = new RegExp(B + '(' + PLACES.slice().sort((a, b) => b.length - a.length).map(escRx).join('|') + '|near me|nearby)' + E, 'u');
  const norm = s => String(s == null ? '' : s).normalize('NFC').toLowerCase();
  const loose = s => norm(s).replace(/[-_/+.%]+/g, ' ');
  const title = s => s.replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
  function placeOf(text) {
    const m = loose(text).match(PLACE_RX);
    if (!m) return null;
    return m[1] === 'near me' || m[1] === 'nearby' ? 'Near me' : m[1] === 'nyc' ? 'New York' : m[1] === 'bengaluru' ? 'Bangalore' : m[1] === 'gurugram' ? 'Gurgaon' : title(m[1]);
  }

  // ── page types, from the first folder of the URL ──
  const TYPE_WORDS = [
    ['Blog & articles', 'blog blogs news article articles post posts stories story magazine insights journal'],
    ['Guides & help', 'guide guides learn how-to howto tutorial tutorials resources resource academy docs documentation help support kb faq faqs wiki'],
    ['Reviews & comparisons', 'review reviews compare comparison comparisons vs versus alternatives alternative best top'],
    ['Products', 'product products p item items shop store dp buy'],
    ['Categories', 'category categories collection collections c catalog catalogue department departments'],
    ['Jobs & listings', 'jobs job careers career internships internship vacancies vacancy listings listing'],
    ['Courses', 'course courses classes class lessons programs program certification'],
    ['Events', 'events event webinars webinar conferences'],
    ['Locations', 'locations location cities city stores-near near branches branch'],
    ['Tags & authors', 'tag tags topic topics author authors profile profiles user users'],
    ['Product & pricing', 'pricing plans plan features feature solutions solution demo integrations integration'],
    ['Company & legal', 'about about-us contact contact-us team company privacy privacy-policy terms legal press careers-page']
  ];
  const TYPE_OF = new Map();
  TYPE_WORDS.forEach(([t, w]) => w.split(' ').forEach(x => TYPE_OF.set(x, t)));
  function segsOf(path) { return String(path || '/').split('/').filter(Boolean); }
  function pageTypeOf(path) {
    const s = segsOf(path);
    if (!s.length) return 'Homepage';
    const first = norm(s[0]);
    if (TYPE_OF.has(first)) return TYPE_OF.get(first);
    if (s.length === 1) return TYPE_OF.get(norm(s[0]).replace(/\.\w+$/, '')) || 'Top-level pages';
    return title(first.replace(/[-_]+/g, ' '));
  }
  function folderOf(path) { const s = segsOf(path); return s.length > 1 ? '/' + s[0] + '/' : '/'; }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // ── rows the filters run over (built once per analysis) ──
  const CACHE = new WeakMap();
  function rows(A) {
    if (CACHE.has(A)) return CACHE.get(A);
    const D = A.data || {};
    const prevQ = D.prevQ ? new Map(D.prevQ.map(r => [r.q, r])) : null;
    const prevP = D.prevP ? new Map(D.prevP.map(r => [r.p, r])) : null;
    const withPrev = (r, prev) => {
      const pc = prev ? prev.clicks : (prevQ || prevP ? 0 : null);
      r.prevClicks = pc;
      r.clickChange = pc == null ? null : pc === 0 ? (r.clicks > 0 ? 100 : 0) : (r.clicks - pc) / pc * 100;
      r.clicksLost = pc == null ? null : pc - r.clicks;
    };
    const base = r => { const bench = CW.expCtr(r.pos); return { bench, ctrGap: bench ? r.ctr / bench * 100 : 0 }; };
    const query = A.Q.map(r => {
      const o = { ...r, ...base(r), text: norm(r.q), question: CW.RX.question.test(r.q), place: placeOf(r.q) };
      o.location = !!o.place;
      withPrev(o, prevQ && prevQ.get(r.q));
      return o;
    });
    const curQ = new Set(A.Q.map(r => r.q));
    if (prevQ) prevQ.forEach((pr, q) => { // queries that vanished this period still count as declines
      if (curQ.has(q)) return;
      if (!(A.isBrand && A.isBrand(q)) && pr.clicks > 0) {
        const o = { q, clicks: 0, impr: 0, ctr: 0, pos: 0, bench: 0, ctrGap: 0, text: norm(q), brand: false, intent: 'other', words: q.trim().split(/\s+/).length, question: CW.RX.question.test(q), place: placeOf(q), gone: true };
        o.location = !!o.place; withPrev(o, pr); query.push(o);
      }
    });
    const pFloor = new Set(A.P.map(r => r.p));
    const page = A.P.map(r => {
      const dec = safeDecode(r.path);
      const o = { ...r, ...base(r), text: norm(dec), pageType: pageTypeOf(r.path), folder: folderOf(r.path), place: placeOf(dec) };
      o.location = !!o.place;
      withPrev(o, prevP && prevP.get(r.p));
      return o;
    });
    if (prevP) prevP.forEach((pr, url) => {
      if (pFloor.has(url) || pr.clicks <= 0 || (A.isExcluded && A.isExcluded(url))) return;
      const path = CW.pathOf(url); const dec = safeDecode(path);
      const o = { p: url, path, clicks: 0, impr: 0, ctr: 0, pos: 0, bench: 0, ctrGap: 0, text: norm(dec), pageType: pageTypeOf(path), folder: folderOf(path), place: placeOf(dec), gone: true };
      o.location = !!o.place; withPrev(o, pr); page.push(o);
    });
    const pctl = (list, p) => Math.round(CW.pct(list.map(r => r.impr).filter(v => v > 0), p));
    const out = {
      query, page,
      hasPrev: !!(prevQ || prevP),
      hasQP: !!(D.QP && D.QP.length),
      folders: [...new Set(page.map(r => r.folder).filter(f => f !== '/'))],
      types: [...new Set(page.map(r => r.pageType))].sort(),
      high: { query: Math.max(10, pctl(query, 0.75)), page: Math.max(20, pctl(page, 0.75)) },
      low: { query: pctl(query, 0.25), page: pctl(page, 0.25) }
    };
    CACHE.set(A, out);
    return out;
  }

  // ── validation ──
  function validate(spec, ctx) {
    const errs = [];
    if (!spec || typeof spec !== 'object') return ['Nothing to run yet.'];
    if (spec.target !== 'query' && spec.target !== 'page') errs.push('Choose whether to look at searches or pages.');
    const conds = Array.isArray(spec.conds) ? spec.conds : [];
    if (conds.length > 12) errs.push('Use 12 conditions or fewer.');
    conds.forEach(c => {
      const f = FIELDS[c && c.f];
      if (!f) { errs.push('Unknown condition.'); return; }
      const name = labelOf(c.f, spec.target);
      if (!f.on.includes(spec.target)) { errs.push(`${name} only applies to ${f.on[0] === 'page' ? 'pages' : 'searches'}.`); return; }
      if (!OPS[f.kind].includes(c.op)) { errs.push(`${name}: that comparison isn't supported.`); return; }
      if (f.needs === 'prev' && ctx && !ctx.hasPrev) errs.push(`${name} needs a comparison period. Connect Search Console with “Compare with the previous period” ticked, or use the sample data.`);
      if (f.kind === 'num') {
        const vals = c.op === 'between' ? [c.v, c.v2] : [c.v];
        if (vals.some(v => typeof v !== 'number' || !isFinite(v))) errs.push(`${name}: enter a number.`);
        else if (vals.some(v => (f.min != null && v < f.min) || (f.max != null && v > f.max))) errs.push(`${name}: use a value between ${f.min} and ${f.max}.`);
        else if (c.op === 'between' && c.v > c.v2) errs.push(`${name}: the first number should be the smaller one.`);
      }
      if (f.kind === 'text') {
        const vals = c.op === 'in' ? (Array.isArray(c.v) ? c.v : []) : [c.v];
        if (!vals.length || vals.some(v => typeof v !== 'string' || !v.trim())) errs.push(`${name}: enter some text.`);
        else if (vals.some(v => v.length > MAX_TEXT)) errs.push(`${name}: keep it under ${MAX_TEXT} characters.`);
      }
      if (f.kind === 'bool' && typeof c.v !== 'boolean') errs.push(`${name}: choose yes or no.`);
      if (f.kind === 'enum' && (typeof c.v !== 'string' || !c.v)) errs.push(`${name}: choose a value.`);
    });
    if (spec.group && !GROUPS[spec.group]) errs.push('Unknown grouping.');
    if (spec.group === 'brand' || spec.group === 'intent') { if (spec.target !== 'query') errs.push(`Grouping by ${GROUPS[spec.group]} works on searches, not pages.`); }
    if ((spec.group === 'pageType' || spec.group === 'folder') && spec.target !== 'page') errs.push(`Grouping by ${GROUPS[spec.group]} works on pages, not searches.`);
    return [...new Set(errs)];
  }

  // ── matching ──
  function textTest(c, cs) {
    const raw = c.op === 'in' ? c.v : [c.v];
    const vals = raw.map(v => cs ? String(v).normalize('NFC').trim() : norm(v).trim());
    const sub = (row) => cs ? (row.textCS) : row.text;
    switch (c.op) {
      case 'contains': return r => sub(r).includes(vals[0]);
      case 'notContains': return r => !sub(r).includes(vals[0]);
      case 'in': return r => vals.some(v => sub(r).includes(v));
      case 'startsWith': return r => sub(r).replace(/^\//, '').startsWith(vals[0].replace(/^\//, ''));
      case 'endsWith': return r => sub(r).replace(/\/$/, '').endsWith(vals[0].replace(/\/$/, ''));
      case 'equals': return r => sub(r) === vals[0] || sub(r).replace(/\/$/, '') === vals[0].replace(/\/$/, '');
      case 'word': { const rx = new RegExp(B + escRx(vals[0]) + E, cs ? 'u' : 'iu'); return r => rx.test(sub(r)); }
    }
    return () => true;
  }
  function numTest(c, key) {
    const get = r => r[key];
    switch (c.op) {
      case 'gt': return r => get(r) != null && get(r) > c.v;
      case 'gte': return r => get(r) != null && get(r) >= c.v;
      case 'lt': return r => get(r) != null && get(r) < c.v;
      case 'lte': return r => get(r) != null && get(r) <= c.v;
      case 'between': return r => get(r) != null && get(r) >= c.v && get(r) <= c.v2;
    }
    return () => true;
  }
  function test(c, target, cs) {
    const f = FIELDS[c.f];
    if (c.f === 'section') { const v = '/' + norm(c.v).replace(/^\/+|\/+$/g, '') + '/'; const inF = r => (r.text + '/').startsWith(v); return c.op === 'not' ? r => !inF(r) : inF; }
    if (f.kind === 'text') return textTest(c, cs);
    if (f.kind === 'num') {
      const t = numTest(c, c.f);
      // vanished rows have no position or CTR; only change-based conditions should see them
      return c.f === 'clickChange' ? t : r => !r.gone && t(r);
    }
    if (f.kind === 'bool') return r => !!r[c.f] === c.v;
    if (f.kind === 'enum') return c.op === 'not' ? r => r[c.f] !== c.v : r => r[c.f] === c.v;
    return () => true;
  }

  function run(spec, A) {
    const R = rows(A);
    const errs = validate(spec, R);
    if (errs.length) return { ok: false, errors: errs };
    const cs = !!spec.caseSensitive;
    let list = R[spec.target];
    if (cs) list.forEach(r => { if (r.textCS == null) r.textCS = spec.target === 'query' ? String(r.q).normalize('NFC') : safeDecode(r.path).normalize('NFC'); });
    const tests = (spec.conds || []).map(c => test(c, spec.target, cs));
    const hasChange = (spec.conds || []).some(c => c.f === 'clickChange');
    list = list.filter(r => (hasChange || !r.gone) && tests.every(t => t(r)));
    const sortKey = spec.sort && spec.sort.f || (hasChange && (spec.conds || []).some(c => c.f === 'clickChange' && (c.op === 'lt' || c.op === 'lte')) ? 'clicksLost' : 'impr');
    const dir = spec.sort && spec.sort.dir === 'asc' ? 1 : -1;
    list = list.slice().sort((a, b) => ((a[sortKey] || 0) - (b[sortKey] || 0)) * dir);
    let groups = null;
    if (spec.group) {
      const keyOf = {
        pageType: r => r.pageType, folder: r => r.folder, location: r => r.place || 'No place mentioned',
        brand: r => r.brand ? 'Branded' : 'Non-branded', intent: r => CW.INTENT_LABEL[r.intent] || 'Unclassified'
      }[spec.group];
      const m = new Map();
      list.forEach(r => { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
      groups = [...m.entries()].map(([key, rs]) => ({ key, rows: rs, ...CW.agg(rs.filter(r => !r.gone)), n: rs.length, lost: rs.reduce((s, r) => s + Math.max(0, r.clicksLost || 0), 0) }))
        .sort((a, b) => (a.key === 'No place mentioned') - (b.key === 'No place mentioned') || b.clicks - a.clicks || b.impr - a.impr);
    }
    return { ok: true, rows: list, groups, total: CW.agg(list.filter(r => !r.gone)), lost: list.reduce((s, r) => s + Math.max(0, r.clicksLost || 0), 0), sortKey };
  }

  // ── plain-English description ──
  const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(2))) : v;
  function labelOf(f, target) { const l = FIELDS[f] && FIELDS[f].label; return typeof l === 'object' ? l[target] : l || f; }
  function chip(c, target) {
    const f = FIELDS[c.f]; if (!f) return '';
    const u = f.unit || '';
    const what = target === 'page' ? 'URL' : 'Search';
    switch (c.f) {
      case 'brand': return c.v ? 'Branded searches' : 'Non-branded searches';
      case 'question': return c.v ? 'Phrased as a question' : 'Not a question';
      case 'location': return c.v ? 'Mentions a place' : 'No place mentioned';
      case 'intent': return (c.op === 'not' ? 'Intent is not ' : 'Intent: ') + (CW.INTENT_LABEL[c.v] || c.v);
      case 'pageType': return (c.op === 'not' ? 'Not ' : 'Page type: ') + c.v;
      case 'section': return (c.op === 'not' ? 'Outside the ' : 'In the ') + c.v + ' folder';
      case 'ctrGap':
        if (c.op === 'lt' || c.op === 'lte') return `Getting under ${fmt(c.v)}% of the clicks expected at its position`;
        if (c.op === 'gt' || c.op === 'gte') return `Getting over ${fmt(c.v)}% of the clicks expected at its position`;
        break;
      case 'clickChange':
        if ((c.op === 'lt' || c.op === 'lte') && c.v === 0) return 'Lost clicks vs the previous period';
        if (c.op === 'lt' || c.op === 'lte') return `Lost at least ${fmt(-c.v)}% of clicks vs the previous period`;
        if ((c.op === 'gt' || c.op === 'gte') && c.v === 0) return 'Gained clicks vs the previous period';
        if (c.op === 'gt' || c.op === 'gte') return `Gained at least ${fmt(c.v)}% more clicks vs the previous period`;
        break;
      case 'words':
        if (c.op === 'gte') return `${fmt(c.v)}+ words`;
        if (c.op === 'lte') return `${fmt(c.v)} word${c.v === 1 ? '' : 's'} or fewer`;
        break;
    }
    if (f.kind === 'text') {
      const q = v => '“' + v + '”';
      if (c.op === 'in') return `${what} contains any of ${(Array.isArray(c.v) ? c.v : [c.v]).map(q).join(', ')}`;
      return {
        contains: `${what} contains ${q(c.v)}`, notContains: `${what} doesn't contain ${q(c.v)}`, startsWith: `${what} starts with ${q(c.v)}`,
        endsWith: `${what} ends with ${q(c.v)}`, equals: `${what} is exactly ${q(c.v)}`, word: `${what} has the word ${q(c.v)}`
      }[c.op];
    }
    const L = labelOf(c.f, target);
    const words = { gt: 'more than', gte: 'at least', lt: 'below', lte: 'at most' };
    if (c.op === 'between') return `${L} ${fmt(c.v)}${u}–${fmt(c.v2)}${u}`;
    return `${L} ${words[c.op]} ${fmt(c.v)}${u}` + (c.note ? ` (${c.note})` : '');
  }
  function describe(spec) {
    const noun = spec.target === 'page' ? 'pages' : 'searches';
    const parts = (spec.conds || []).map(c => chip(c, spec.target));
    const lc = p => /^[A-Z][a-z]/.test(p) ? p[0].toLowerCase() + p.slice(1) : p;
    let s = parts.length ? `Showing ${noun} where: ${parts.map(lc).join('; ')}` : `Showing all ${noun}`;
    if (spec.group) s += `, grouped by ${GROUPS[spec.group]}`;
    return s + '.';
  }

  // ── Search Console recipe (advanced, optional) ──
  // Search Console supports plain "contains" filters and RE2 regex. We build any
  // pattern ourselves, fully escaped; users only see it if they open Advanced.
  const re2 = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function gscRecipe(spec, A) {
    const dim = spec.target === 'page' ? 'Page' : 'Query';
    const steps = [], skipped = [];
    (spec.conds || []).forEach(c => {
      const f = FIELDS[c.f];
      if (c.f === 'section') {
        steps.push(['Page', c.op === 'not' ? "Doesn't contain" : 'Contains', '/' + c.v.replace(/^\/+|\/+$/g, '') + '/']);
      } else if (f.kind === 'text') {
        const v = c.v;
        if (c.op === 'contains') steps.push([dim, 'Contains', v]);
        else if (c.op === 'notContains') steps.push([dim, "Doesn't contain", v]);
        else if (c.op === 'equals') steps.push([dim, 'Exact', v]);
        else if (c.op === 'startsWith') steps.push([dim, 'Custom (regex)', (spec.target === 'page' ? '^https?://[^/]+/' + re2(v.replace(/^\//, '')) : '^' + re2(v))]);
        else if (c.op === 'endsWith') steps.push([dim, 'Custom (regex)', re2(v) + '$']);
        else if (c.op === 'word') steps.push([dim, 'Custom (regex)', '\\b' + re2(v) + '\\b']);
        else if (c.op === 'in') steps.push([dim, 'Custom (regex)', '(' + c.v.map(re2).join('|') + ')']);
      } else if (c.f === 'brand') {
        steps.push(['Query', c.v ? 'Custom (regex)' : "Custom (regex) › Doesn't match regex", A.brandRx]);
      } else if (c.f === 'question') {
        steps.push(['Query', c.v ? 'Custom (regex)' : "Custom (regex) › Doesn't match regex", '^(who|what|when|where|why|how|which|can|could|does|do|did|is|are|was|were|should|will|would)\\s']);
      } else if (['clicks', 'impr', 'ctr', 'pos'].includes(c.f)) {
        const col = { clicks: 'Clicks', impr: 'Impressions', ctr: 'CTR', pos: 'Position' }[c.f];
        const cmp = { gt: 'Greater than', gte: 'Greater than', lt: 'Smaller than', lte: 'Smaller than' }[c.op];
        if (c.op === 'between') { steps.push(['Table filter', col + ' Greater than', fmt(c.v)]); steps.push(['Table filter', col + ' Smaller than', fmt(c.v2)]); }
        else steps.push(['Table filter', col + ' ' + cmp, fmt(c.v)]);
      } else skipped.push(chip(c, spec.target));
    });
    return { steps, skipped };
  }

  // ── plain-English parser (deterministic) ──
  const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:(k|m|thousand|million|lakh)\\b)?';
  const toNum = (n, s) => { let v = parseFloat(String(n).replace(/,/g, '')); s = (s || '').toLowerCase(); if (s === 'k' || s === 'thousand') v *= 1e3; else if (s === 'm' || s === 'million') v *= 1e6; else if (s === 'lakh') v *= 1e5; return v; };
  const METRIC = '(impressions?|impr|views|clicks?|traffic|ctr|click[- ]?through(?: rate)?|positions?|rank(?:ing|s)?|avg\\.? position|average position)';
  const GT = '(more than|over|above|greater than|at least|minimum(?: of)?|min\\.?|>=|>|exceeding|upwards of)';
  const LT = '(less than|fewer than|below|under|at most|maximum(?: of)?|max\\.?|<=|<|lower than|lower then|less then)';
  const metricKey = m => /impr|views/.test(m) ? 'impr' : /ctr|through/.test(m) ? 'ctr' : /click|traffic/.test(m) ? 'clicks' : 'pos';
  const STOP = new Set(('a an the and or but with without that which who whose where what show me find list give get display see want need please all any my our your their this these those of in on at to for from by is are was were be been being have has had do does did it its i we you there here only just also some more most very really can could should would will ' +
    'between keywords keyword queries query searches search terms term pages page urls url results result data site website websites my ranking rank ranked ranks rows items lot lots enough generating generate getting not no them they then than as such like ones one').split(/\s+/));

  function parse(input, A) {
    const R = rows(A);
    const notes = [];
    let t = ' ' + norm(input).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ') + ' ';
    const conds = [];
    let group = null, target = null;
    // run a rule; the matched words are removed so leftovers can be reported.
    // A rule may return false (no match) or a string to put back (words it did not use).
    const take = (rx, fn) => { t = t.replace(rx, (...m) => { const r = fn(...m); return r === false ? m[0] : typeof r === 'string' ? ' ' + r + ' ' : ' '; }); };

    // quoted text first, so words inside quotes are not read as instructions
    const quoted = [];
    take(/(not containing|that don't contain|that do not contain|doesn't contain|does not contain|without|excluding|exclude|except|not)?\s*"([^"]{1,200})"/g, (m, neg, v) => { quoted.push([!!neg, v.trim()]); });
    take(/(not containing|without|excluding|exclude|except)?\s*'([^']{2,200})'/g, (m, neg, v) => { quoted.push([!!neg, v.trim()]); });

    // target
    const pageHit = t.search(/\b(pages?|urls?|landing pages?|articles?|posts?|links?)\b/);
    const queryHit = t.search(/\b(keywords?|quer(?:y|ies)|searches|search terms?|terms?|questions?)\b/);
    target = pageHit >= 0 && (queryHit < 0 || pageHit < queryHit) ? 'page' : 'query';

    // grouping
    take(/\b(?:group(?:ed)?|split|break(?: ?down)?|organi[sz]e|cluster)\b([^.]*?)\bby\s+(cit(?:y|ies)|locations?|places?|page ?types?|types?|templates?|folders?|sections?|directories|intent|brand(?:ed)?)\b/g, (m, mid, by) => { group = groupKey(by); return mid; });
    take(/\bby\s+(cit(?:y|ies)|locations?|page ?types?|folders?|sections?|intent)\b/g, (m, by) => { group = group || groupKey(by); });
    take(/\bbranded (?:and|vs\.?|versus) non[- ]?branded\b|\bnon[- ]?branded (?:and|vs\.?|versus) branded\b|\bbrand split\b/g, () => { group = 'brand'; target = 'query'; });
    if (group === 'brand' || group === 'intent') target = 'query';
    if (group === 'pageType' || group === 'folder') target = 'page';

    // date ranges: the loaded range is used
    take(/\b(?:in|over|during|for|within)?\s*(?:the\s+)?(?:last|past|previous|recent)\s+(\d+|a|one|two|three|six|twelve)?\s*(days?|weeks?|months?|years?|quarter)\b/g, () => { notes.push('date'); });
    take(/\b(this|last) (week|month|quarter|year)\b|\byesterday\b|\btoday\b|\brecently\b/g, () => { notes.push('date'); });

    // positions
    take(new RegExp('\\b(?:between\\s+)?(?:positions?|ranks?|ranking|ranked|pos\\.?)\\s*(?:between|from|of)?\\s*#?' + '(\\d+(?:\\.\\d+)?)\\s*(?:and|to|-|–|—)\\s*#?(\\d+(?:\\.\\d+)?)\\b', 'g'), (m, a, b) => { pushNum('pos', 'between', Math.min(+a, +b), Math.max(+a, +b)); });
    take(/\bbetween\s+#?(\d+(?:\.\d+)?)\s*(?:and|to|-|–)\s*#?(\d+(?:\.\d+)?)\s+(?:positions?|ranks?)\b/g, (m, a, b) => { pushNum('pos', 'between', Math.min(+a, +b), Math.max(+a, +b)); });
    take(/\b(?:almost|nearly|close to) (?:page one|page 1|the first page|top 10)\b|\bstriking distance\b|\bquick wins?\b/g, () => { pushNum('pos', 'between', 4, 20); });
    take(/\b(?:in |on )?(?:the )?top (\d{1,3})\b/g, (m, n) => { pushNum('pos', 'lte', +n); });
    take(/\b(?:on )?(?:page one|page 1|first page)\b/g, () => { pushNum('pos', 'lte', 10); });
    take(/\b(?:on )?(?:page two|page 2|second page)\b/g, () => { pushNum('pos', 'between', 11, 20); });
    take(/\b(?:position|rank(?:ing)?|ranked) (?:#|number |no\.? )?(\d+(?:\.\d+)?)\b(?! ?(?:and|to|-))/g, (m, n) => { pushNum('pos', 'between', Math.max(1, +n - 0.5), +n + 0.49); });

    // metric comparisons: "CTR below 2%", "more than 1,000 impressions"
    take(new RegExp('\\b' + METRIC + '\\s*(?:is|are|of|=)?\\s*' + GT + '\\s*' + NUM + '\\s*(%|percent)?', 'g'), (m, met, op, n, s) => { pushCmp(met, 'gt', toNum(n, s), op); });
    take(new RegExp('\\b' + METRIC + '\\s*(?:is|are|of|=)?\\s*' + LT + '\\s*' + NUM + '\\s*(%|percent)?', 'g'), (m, met, op, n, s) => { pushCmp(met, 'lt', toNum(n, s), op); });
    take(new RegExp(GT + '\\s*' + NUM + '\\s*(%|percent)?\\s*' + METRIC, 'g'), (m, op, n, s, pc, met) => { pushCmp(met, 'gt', toNum(n, s), op); });
    take(new RegExp(LT + '\\s*' + NUM + '\\s*(%|percent)?\\s*' + METRIC, 'g'), (m, op, n, s, pc, met) => { pushCmp(met, 'lt', toNum(n, s), op); });
    take(new RegExp('\\b' + NUM + '\\s*\\+\\s*' + METRIC, 'g'), (m, n, s, met) => { pushCmp(met, 'gt', toNum(n, s), 'at least'); });

    // decline / growth
    take(/\b(?:lost|losing|lose|loses|declin\w*|dropp?(?:ed|ing|s)?|fell|falling|fall|decreas\w*|decay\w*)\b\s*(?:in\s+)?(?:clicks?|traffic|visits)?\s*(?:by\s+)?(?:more than|over|at least|by)?\s*(\d+(?:\.\d+)?)?\s*(%|percent)?\s*(?:(?:of\s+)?(?:their|its|the)?\s*(?:clicks?|traffic))?/g, (m, n, pc) => {
      if (n && !pc && +n > 100) { pushCmp('clicks', 'lt', +n); return; }
      pushNum('clickChange', n ? 'lte' : 'lt', n ? -Math.min(100, +n) : 0);
    });
    take(/\b(?:gain(?:ed|ing|s)?|grow(?:ing|n|s)?|grew|rising|rose|increas\w*|improv\w*|trending up)\b\s*(?:in\s+)?(?:clicks?|traffic)?\s*(?:by\s+)?(?:more than|over|at least)?\s*(\d+(?:\.\d+)?)?\s*(%|percent)?/g, (m, n) => {
      pushNum('clickChange', n ? 'gte' : 'gt', n ? +n : 0);
    });

    // CTR quality
    take(/\b(?:low|poor|weak|bad|below[- ]average|underperforming) (?:ctr|click[- ]?through(?: rate)?)\b|\bnot (?:generating|getting|earning|driving|receiving) (?:enough|many|much) (?:clicks?|traffic)\b|\bunder[- ]?clicked\b|\bfew clicks\b|\blow clicks\b|\bnot clicked\b|\bnot enough clicks\b/g, () => { pushNum('ctrGap', 'lt', 60); });
    take(/\b(?:high|great|strong|good|above[- ]average) (?:ctr|click[- ]?through(?: rate)?)\b/g, () => { pushNum('ctrGap', 'gt', 120); });
    take(/\bzero clicks?\b|\bno clicks?\b|\bnever clicked\b/g, () => { pushNum('clicks', 'lt', 1); });

    // impressions level
    take(/\b(?:high|lots of|many|a lot of|plenty of|big|large|strong) (?:impressions?|visibility|demand|views)\b|\bhigh[- ]impression\b/g, () => { conds.push({ f: 'impr', op: 'gte', v: R.high[target], note: 'top 25% on this site' }); });
    take(/\b(?:low|few|little) (?:impressions?|visibility|demand)\b/g, () => { conds.push({ f: 'impr', op: 'lte', v: Math.max(1, R.low[target]), note: 'bottom 25% on this site' }); });

    // query traits
    take(/\bnon[- ]?brand(?:ed)?\b|\bunbranded\b|\bgeneric\b|\bwithout (?:the |my |our )?brand\b/g, () => { target = 'query'; conds.push({ f: 'brand', op: 'is', v: false }); });
    take(/\bbrand(?:ed)?\b/g, () => { target = 'query'; conds.push({ f: 'brand', op: 'is', v: true }); });
    take(/\b(?:question[- ]based|questions?|people also ask|paa)\b/g, () => { if (target === 'page' && pageHit >= 0 && queryHit < 0) target = 'query'; conds.push({ f: 'question', op: 'is', v: true }); });
    take(/\b(informational|commercial|transactional|navigational)\b(?: intent)?/g, (m, k) => { target = 'query'; conds.push({ f: 'intent', op: 'is', v: { informational: 'info', commercial: 'comm', transactional: 'trans', navigational: 'nav' }[k] }); });
    take(/\b(?:long[- ]tail|conversational|long (?:searches|queries|keywords)|prompt[- ]like)\b/g, () => { conds.push({ f: 'words', op: 'gte', v: 7 }); });
    take(/\b(\d+)\s*\+?\s*(?:or more )?words?\b/g, (m, n) => { conds.push({ f: 'words', op: 'gte', v: Math.max(1, +n) }); });
    take(/\b(?:one|single|1)[- ]word\b/g, () => { conds.push({ f: 'words', op: 'lte', v: 1 }); });
    take(/\bhead terms?\b|\bshort (?:searches|queries|keywords)\b/g, () => { conds.push({ f: 'words', op: 'lte', v: 2 }); });
    take(/\b(?:location[- ]based|local|geo(?:[- ]?targeted)?|city[- ]based|near me|locations?|cities|places?|city)\b/g, () => { if (!conds.some(c => c.f === 'location')) conds.push({ f: 'location', op: 'is', v: true }); });

    // text: starts / ends / exact / contains / excludes (unquoted)
    const PHRASE = "([\\p{L}\\p{N}][\\p{L}\\p{N}\\s&'/.-]{0,60}?)";
    const STOPAT = "(?=\\s+(?:and|with|ranking|ranked|that|which|where|having|but|or|sorted|grouped|group|in the last|over the|by)\\b|\\s*[,.;]|\\s*$)";
    take(new RegExp('\\b(?:starting|starts|that start|beginning|begins) with\\s+' + PHRASE + STOPAT, 'gu'), (m, v) => { textCond('startsWith', v); });
    take(new RegExp('\\b(?:ending|ends|that end) with\\s+' + PHRASE + STOPAT, 'gu'), (m, v) => { textCond('endsWith', v); });
    take(new RegExp('\\b(?:exactly|exact match(?: for)?|equal to|equals)\\s+' + PHRASE + STOPAT, 'gu'), (m, v) => { textCond('equals', v); });
    take(new RegExp("\\b(?:not containing|that don't contain|that do not contain|doesn't contain|does not contain|without the word|without|excluding|exclude|except(?: for)?|minus|ignoring|ignore)\\s+" + PHRASE + STOPAT, 'gu'), (m, v) => { textCond('notContains', v); });
    take(new RegExp('\\b(?:containing|contain|contains|that mention|mentioning|mention|with the word|with the phrase|including|include|includes|about|related to|for the (?:keyword|term))\\s+' + PHRASE + STOPAT, 'gu'), (m, v) => { textCond('contains', v); });
    quoted.forEach(([neg, v]) => textCond(neg ? 'notContains' : 'contains', v));
    take(/\bhow[- ]to\b/g, () => { conds.push({ f: 'text', op: 'startsWith', v: 'how to' }); });

    // "<word> pages" → a folder, a page type, or a URL word
    take(/\b([\p{L}\p{N}][\p{L}\p{N}-]{1,40}) (?:pages?|urls?|articles?|posts?|listings?)\b/gu, (m, w) => {
      if (STOP.has(w) || ['landing', 'top', 'high', 'low', 'new', 'old', 'best', 'worst', 'these', 'those', 'all', 'zero', 'declining', 'losing', 'growing', 'my'].includes(w)) return false;
      target = 'page';
      const folder = R.folders.find(f => { const s = f.replace(/\//g, ''); return s === w || s === w + 's' || s + 's' === w || s === w.replace(/s$/, ''); });
      if (folder) conds.push({ f: 'section', op: 'is', v: folder });
      else if (TYPE_OF.has(w) && R.types.includes(TYPE_OF.get(w))) conds.push({ f: 'pageType', op: 'is', v: TYPE_OF.get(w) });
      else conds.push({ f: 'text', op: 'contains', v: w });
    });
    if (/\b(pages?|urls?)\b/.test(t) && pageHit >= 0 && !conds.some(c => ['brand', 'question', 'intent', 'words'].includes(c.f))) target = 'page';

    // leftovers we could not read
    const unknown = t.replace(/[^\p{L}\p{N}\s%-]/gu, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1);

    // query-only conditions force searches; page-only force pages
    if (conds.some(c => FIELDS[c.f].on.length === 1 && FIELDS[c.f].on[0] === 'query')) target = 'query';
    if (conds.some(c => FIELDS[c.f].on.length === 1 && FIELDS[c.f].on[0] === 'page')) target = 'page';
    if (group === 'pageType' || group === 'folder') target = 'page';
    // dedupe identical conditions
    const seen = new Set();
    const uniq = conds.filter(c => { const k = JSON.stringify([c.f, c.op, c.v, c.v2]); if (seen.has(k)) return false; seen.add(k); return true; });
    // high-impression thresholds are resolved for the final target
    uniq.forEach(c => { if (c.note === 'top 25% on this site') c.v = R.high[target]; if (c.note === 'bottom 25% on this site') c.v = Math.max(1, R.low[target]); });
    const spec = { target, conds: uniq, group };
    return { spec, unknown: [...new Set(unknown)], notes: [...new Set(notes)], understood: uniq.length > 0 || !!group };

    function groupKey(by) {
      return /cit|loc|place/.test(by) ? 'location' : /type|template/.test(by) ? 'pageType' : /folder|section|director/.test(by) ? 'folder' : /intent/.test(by) ? 'intent' : 'brand';
    }
    function pushNum(f, op, v, v2) { conds.push(v2 == null ? { f, op, v } : { f, op, v, v2 }); }
    function pushCmp(met, dir, v, word) {
      const k = metricKey(met);
      const inclusive = /least|minimum|min|>=|<=|most|maximum|max/.test(word || '');
      if (k === 'pos') {
        // "position below 10" means a better rank, i.e. a smaller number
        pushNum('pos', dir === 'gt' ? (inclusive ? 'gte' : 'gt') : (inclusive ? 'lte' : 'lt'), v);
        return;
      }
      pushNum(k, dir === 'gt' ? (inclusive ? 'gte' : 'gt') : (inclusive ? 'lte' : 'lt'), v);
    }
    function textCond(op, v) {
      v = String(v).trim().replace(/\s+(?:in|on|at|of|for|the)$/, '').trim();
      if (!v || STOP.has(v)) return;
      if (/^questions?$/.test(v)) { conds.push({ f: 'question', op: 'is', v: op !== 'notContains' }); return; }
      if (/^(?:brand(?:ed)?|my brand|our brand)$/.test(v)) { conds.push({ f: 'brand', op: 'is', v: op === 'notContains' ? false : true }); return; }
      conds.push({ f: 'text', op, v: v.slice(0, MAX_TEXT) });
    }
  }

  // Examples shown under the box, all handled by the parser above.
  const EXAMPLES = [
    'Pages with more than 1,000 impressions and CTR below 2%',
    'Non-branded keywords ranking between positions 5 and 15',
    'Blog pages that lost clicks in the last 28 days',
    'Show queries that are questions',
    'Pages with high impressions but not generating enough clicks',
    'Location-based keywords grouped by city',
    'Group pages by page type',
    'Long-tail searches on page two'
  ];

  window.CW_FILTERS = { FIELDS, OPS, GROUPS, parse, validate, run, describe, chip, gscRecipe, rows, placeOf, pageTypeOf, EXAMPLES, labelOf };
})();

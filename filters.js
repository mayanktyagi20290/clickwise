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
    // for searches, the folder of the page that ranks for them (needs query-page data)
    section: { kind: 'enum', label: 'Folder', on: ['page', 'query'] },
    pageType: { kind: 'enum', label: 'Page type', on: ['page'] },
    brand: { kind: 'bool', label: 'Branded', on: ['query'] },
    question: { kind: 'bool', label: 'Question', on: ['query'] },
    location: { kind: 'bool', label: 'Mentions a place', on: ['query', 'page'] },
    place: { kind: 'enum', label: 'Place', on: ['query', 'page'] },
    intent: { kind: 'enum', label: 'Intent', on: ['query'] },
    // from the opportunity engine (opportunities.js): what kind of opportunity a row is, its estimate and confidence
    opp: { kind: 'enum', label: 'Opportunity', on: ['query', 'page'] },
    gain: { kind: 'num', label: 'Estimated clicks a month', on: ['query', 'page'], min: 0, max: 1e9 },
    confidence: { kind: 'enum', label: 'Confidence', on: ['query', 'page'] }
  };
  // Opportunity kinds a filter can ask for, mapped from the engine's item types.
  const OPP = {
    any: { label: 'Any opportunity' },
    growth: { label: 'Quick win (ranking or CTR)' },
    striking: { label: 'Almost page one', types: ['striking'] },
    ctr: { label: 'Low CTR (title to rewrite)', types: ['ctr-query', 'ctr-page'] },
    answer: { label: 'Answer box or AI Overview?', types: ['answer-box'] },
    decline: { label: 'Losing clicks', types: ['decline-page', 'decline-query'] },
    cannibal: { label: 'Competing pages', types: ['cannibal'] },
    slipping: { label: 'Early warning', types: ['slipping-page'] }
  };
  const OPP_OF = {}; Object.entries(OPP).forEach(([k, o]) => (o.types || []).forEach(t => { OPP_OF[t] = k; }));
  const GROWTH = new Set(['striking', 'ctr', 'answer']);
  const LEVELS = ['High', 'Medium', 'Low'];
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
    // same comparison rules as Losing ground: the previous period is scaled to this period's length, and a
    // row missing from a list that hit its row limit is counted at that list's smallest row (an upper bound)
    const dc = A.decay || {}, scale = dc.scale || 1, trunc = dc.truncated || {};
    const minOf = list => list.reduce((m, r) => Math.min(m, r.clicks), Infinity);
    const boundQ = trunc.queries ? minOf(A.data.Q || []) : 0, boundP = trunc.pages ? minOf(A.data.P || []) : 0;
    const withPrev = (r, prev) => {
      const pc = prev ? prev.clicks * scale : (prevQ || prevP ? 0 : null);
      r.prevClicks = pc;
      r.clickChange = pc == null ? null : pc === 0 ? (r.clicks > 0 ? 100 : 0) : (r.clicks - pc) / pc * 100;
      r.clicksLost = pc == null ? null : pc - r.clicks;
    };
    // Expected CTR comes from the same curve as every estimate (the site's own CTR where it has enough data).
    const expAt = A.curve && A.curve.at ? A.curve.at : CW.expCtr;
    const base = r => { const bench = expAt(r.pos); return { bench, ctrGap: bench ? r.ctr / bench * 100 : 0 }; };
    // which page ranks for each search (largest share of its impressions), when query-page rows exist
    const landing = new Map();
    if (D.QP && D.QP.length) {
      const best = new Map();
      D.QP.forEach(r => { if (A.isExcluded && A.isExcluded(r.p)) return; const o = best.get(r.q); if (!o || r.impr > o.impr) best.set(r.q, r); });
      best.forEach((r, q) => landing.set(q, CW.pathOf(r.p)));
    }
    // opportunity kinds, best estimate and best confidence for each search and page
    const O = A.opps || (window.CW_OPPS ? window.CW_OPPS.build(A, D) : null);
    const oppQ = new Map(), oppP = new Map();
    if (O) O.items.forEach(it => {
      const m = it.subject.kind === 'page' ? oppP : oppQ, key = it.subject.kind === 'page' ? it.subject.url : it.subject.label;
      const o = m.get(key) || { kinds: new Set(), gain: null, gainHi: null, item: null, conf: null, score: -1 };
      o.kinds.add(OPP_OF[it.type]);
      if ((it.impact.kind === 'growth' || it.impact.kind === 'recovery') && (o.gain == null || it.impact.lo > o.gain)) { o.gain = it.impact.lo; o.gainHi = it.impact.hi; }
      if (!o.item || it.impact.lo > o.item.impact.lo) o.item = it;
      if (it.confidence.score > o.score) { o.score = it.confidence.score; o.conf = it.confidence.level; }
      m.set(key, o);
    });
    const withOpp = (o, x) => { o.opp = x ? x.kinds : new Set(); o.gain = x ? x.gain : null; o.gainHi = x ? x.gainHi : null; o.confidence = x ? x.conf : null; o.oppItem = x ? x.item : null; };
    const query = A.Q.map(r => {
      const o = { ...r, ...base(r), text: norm(r.q), question: CW.RX.question.test(r.q), place: placeOf(r.q), landingPath: landing.get(r.q) || null };
      o.location = !!o.place;
      withPrev(o, prevQ && prevQ.get(r.q)); withOpp(o, oppQ.get(r.q));
      return o;
    });
    const curQ = new Set(A.Q.map(r => r.q));
    if (prevQ) prevQ.forEach((pr, q) => { // queries that vanished this period still count as declines
      if (curQ.has(q)) return;
      if (!(A.isBrand && A.isBrand(q)) && pr.clicks > 0) {
        const o = { q, clicks: boundQ, impr: 0, ctr: 0, pos: 0, bench: 0, ctrGap: 0, text: norm(q), brand: false, intent: 'other', words: q.trim().split(/\s+/).length, question: CW.RX.question.test(q), place: placeOf(q), gone: true, uncertain: !!trunc.queries };
        o.location = !!o.place; withPrev(o, pr); withOpp(o, oppQ.get(q)); o.landingPath = landing.get(q) || null; query.push(o);
      }
    });
    const pFloor = new Set(A.P.map(r => r.p));
    const page = A.P.map(r => {
      const dec = safeDecode(r.path);
      const o = { ...r, ...base(r), text: norm(dec), pageType: pageTypeOf(r.path), folder: folderOf(r.path), place: placeOf(dec) };
      o.location = !!o.place;
      withPrev(o, prevP && prevP.get(r.p)); withOpp(o, oppP.get(r.p));
      return o;
    });
    if (prevP) prevP.forEach((pr, url) => {
      if (pFloor.has(url) || pr.clicks <= 0 || (A.isExcluded && A.isExcluded(url))) return;
      const path = CW.pathOf(url); const dec = safeDecode(path);
      const o = { p: url, path, clicks: boundP, impr: 0, ctr: 0, pos: 0, bench: 0, ctrGap: 0, text: norm(dec), pageType: pageTypeOf(path), folder: folderOf(path), place: placeOf(dec), gone: true, uncertain: !!trunc.pages };
      o.location = !!o.place; withPrev(o, pr); withOpp(o, oppP.get(url)); page.push(o);
    });
    const pctl = (list, p) => Math.round(CW.pct(list.map(r => r.impr).filter(v => v > 0), p));
    const out = {
      query, page,
      hasPrev: !!(prevQ || prevP),
      hasQP: !!(D.QP && D.QP.length),
      hasOpps: !!O,
      oppKinds: { query: [...new Set(query.flatMap(r => [...r.opp]))], page: [...new Set(page.flatMap(r => [...r.opp]))] },
      folders: [...new Set(page.map(r => r.folder).filter(f => f !== '/'))],
      places: { query: [...new Set(query.map(r => r.place).filter(Boolean))].sort(), page: [...new Set(page.map(r => r.place).filter(Boolean))].sort() },
      types: [...new Set(page.map(r => r.pageType))].sort(),
      high: { query: Math.max(10, pctl(query, 0.75)), page: Math.max(20, pctl(page, 0.75)) },
      low: { query: pctl(query, 0.25), page: pctl(page, 0.25) }
    };
    CACHE.set(A, out);
    return out;
  }

  // ── validation ──
  // Conditions that can never all be true at once, e.g. "position at most 3" with "position 5–15".
  function conflicts(conds, target) {
    const out = [], ranges = {}, enums = {}, bools = {};
    conds.forEach(c => {
      const f = FIELDS[c && c.f]; if (!f) return;
      if (f.kind === 'num' && typeof c.v === 'number' && isFinite(c.v)) {
        const r = ranges[c.f] || (ranges[c.f] = { lo: -Infinity, hi: Infinity, loX: false, hiX: false, parts: [] });
        const lo = c.op === 'between' ? c.v : c.op === 'gt' || c.op === 'gte' ? c.v : null;
        const hi = c.op === 'between' ? c.v2 : c.op === 'lt' || c.op === 'lte' ? c.v : null;
        if (lo != null && (lo > r.lo || (lo === r.lo && c.op === 'gt'))) { r.lo = lo; r.loX = c.op === 'gt'; }
        if (hi != null && (hi < r.hi || (hi === r.hi && c.op === 'lt'))) { r.hi = hi; r.hiX = c.op === 'lt'; }
        r.parts.push(chip(c, target));
      }
      if (f.kind === 'enum' && c.op === 'is' && c.f !== 'opp') (enums[c.f] = enums[c.f] || new Set()).add(c.v);
      if (f.kind === 'bool') (bools[c.f] = bools[c.f] || new Set()).add(c.v);
    });
    Object.entries(ranges).forEach(([k, r]) => { if (r.lo > r.hi || (r.lo === r.hi && (r.loX || r.hiX))) out.push(`These can't all be true at once: ${r.parts.join(' and ')}. Remove one of them.`); });
    Object.entries(enums).forEach(([k, v]) => { if (v.size > 1) out.push(`${labelOf(k, target)} can't be ${[...v].join(' and ')} at the same time. Keep one.`); });
    Object.entries(bools).forEach(([k, v]) => { if (v.size > 1) out.push(`${labelOf(k, target)}: both yes and no were asked for. Keep one.`); });
    return out;
  }
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
      if (f.needs === 'prev' && ctx && !ctx.hasPrev) errs.push(`${name} needs a comparison period. Upload an export made with Date › Compare, or two exports together (this period and the one before), or connect Search Console with the comparison ticked.`);
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
      if (c.f === 'opp' && typeof c.v === 'string' && !OPP[c.v]) errs.push('Opportunity: choose one of the listed kinds.');
      if (c.f === 'confidence' && typeof c.v === 'string' && !LEVELS.includes(c.v)) errs.push('Confidence: choose High, Medium or Low.');
      if (c.f === 'section' && spec.target === 'query' && ctx && !ctx.hasQP) errs.push('Folder for searches needs to know which page ranks for each search. Connect Search Console to get that; an export does not include it. Or look at pages in that folder instead.');
    });
    errs.push(...conflicts(conds, spec.target));
    if (spec.limit != null && !(Number.isInteger(spec.limit) && spec.limit >= 1 && spec.limit <= 10000)) errs.push('Number of results: use a whole number from 1 to 10,000.');
    if (spec.sort != null && !(spec.sort && FIELDS[spec.sort.f] && FIELDS[spec.sort.f].kind === 'num' && (spec.sort.dir === 'asc' || spec.sort.dir === 'desc'))) errs.push('Sorting: choose a number to sort by.');
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
    if (c.f === 'section') {
      const v = '/' + norm(c.v).replace(/^\/+|\/+$/g, '') + '/';
      // pages: their own URL; searches: the page that ranks for them
      const inF = target === 'query' ? r => !!r.landingPath && (norm(safeDecode(r.landingPath)) + '/').startsWith(v) : r => (r.text + '/').startsWith(v);
      return c.op === 'not' ? r => !inF(r) : inF;
    }
    if (c.f === 'opp') {
      const has = c.v === 'any' ? r => r.opp.size > 0 : c.v === 'growth' ? r => [...r.opp].some(k => GROWTH.has(k)) : r => r.opp.has(c.v);
      return c.op === 'not' ? r => !has(r) : has;
    }
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

  function prepCS(list, target) { list.forEach(r => { if (r.textCS == null) r.textCS = target === 'query' ? String(r.q).normalize('NFC') : safeDecode(r.path).normalize('NFC'); }); }
  function run(spec, A) {
    const R = rows(A);
    const errs = validate(spec, R);
    if (errs.length) return { ok: false, errors: errs };
    const cs = !!spec.caseSensitive;
    let list = R[spec.target];
    if (cs) prepCS(list, spec.target);
    const tests = (spec.conds || []).map(c => test(c, spec.target, cs));
    const hasChange = (spec.conds || []).some(c => c.f === 'clickChange');
    list = list.filter(r => (hasChange || !r.gone) && tests.every(t => t(r)));
    const usesOpp = (spec.conds || []).some(c => ['opp', 'gain', 'confidence'].includes(c.f) && !(c.f === 'opp' && c.op === 'not'));
    const sortKey = spec.sort && spec.sort.f || (usesOpp ? 'gain' : hasChange && (spec.conds || []).some(c => c.f === 'clickChange' && (c.op === 'lt' || c.op === 'lte')) ? 'clicksLost' : 'impr');
    const dir = spec.sort && spec.sort.dir === 'asc' ? 1 : -1;
    list = list.slice().sort((a, b) => ((a[sortKey] || 0) - (b[sortKey] || 0)) * dir || (b.impr || 0) - (a.impr || 0));
    const matched = list.length;
    if (spec.limit) list = list.slice(0, spec.limit);
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
    return { ok: true, rows: list, matched, groups, total: CW.agg(list.filter(r => !r.gone)), lost: list.reduce((s, r) => s + Math.max(0, r.clicksLost || 0), 0), sortKey, usesOpp };
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
      case 'place': return (c.op === 'not' ? "Doesn't mention " : 'Mentions ') + c.v;
      case 'intent': return (c.op === 'not' ? 'Intent is not ' : 'Intent: ') + (CW.INTENT_LABEL[c.v] || c.v);
      case 'pageType': return (c.op === 'not' ? 'Not ' : 'Page type: ') + c.v;
      case 'section': return target === 'query' ? (c.op === 'not' ? 'Ranking page outside ' : 'Ranking page in ') + c.v : (c.op === 'not' ? 'Outside the ' : 'In the ') + c.v + ' folder';
      case 'opp': return (c.op === 'not' ? 'Not: ' : c.v === 'any' ? '' : 'Opportunity: ') + (OPP[c.v] ? OPP[c.v].label : c.v);
      case 'confidence': return (c.op === 'not' ? 'Confidence is not ' : 'Confidence: ') + c.v;
      case 'gain':
        if (c.op === 'gt' || c.op === 'gte') return `Estimated ${c.op === 'gt' ? 'more than' : 'at least'} ${fmt(c.v)} more clicks a month`;
        if (c.op === 'lt' || c.op === 'lte') return `Estimated ${c.op === 'lt' ? 'under' : 'at most'} ${fmt(c.v)} more clicks a month`;
        if (c.op === 'between') return `Estimated ${fmt(c.v)}–${fmt(c.v2)} more clicks a month`;
        break;
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
    if (spec.limit) s += `, the top ${spec.limit.toLocaleString('en-US')}`;
    if (spec.sort) s += `, sorted by ${labelOf(spec.sort.f, spec.target).toLowerCase()} (${spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first)`;
    return s + '.';
  }

  // How each condition narrows the list, in order: shows which condition removed the results.
  function funnel(spec, A) {
    const R = rows(A);
    if (validate(spec, R).length) return null;
    const hasChange = (spec.conds || []).some(c => c.f === 'clickChange');
    let list = R[spec.target].filter(r => hasChange || !r.gone);
    if (spec.caseSensitive) prepCS(list, spec.target);
    const out = [{ label: spec.target === 'page' ? 'All pages in this data' : 'All searches in this data', n: list.length }];
    (spec.conds || []).forEach(c => { const t = test(c, spec.target, !!spec.caseSensitive); list = list.filter(t); out.push({ label: chip(c, spec.target), n: list.length }); });
    return out;
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
      } else if (c.f === 'place') {
        steps.push([dim, c.op === 'not' ? "Doesn't contain" : 'Contains', String(c.v).toLowerCase()]);
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
    'between keywords keyword queries query searches search terms term pages page urls url results result data site website websites my ranking rank ranked ranks rows items lot lots enough generating generate getting not no them they then than as such like ones one average avg mean overall currently current position positions identify locate spot discover surface detect pull fetch existing available').split(/\s+/));

  // filler words that are not worth a question when left over
  const SOFT = new Set('show shows tell display look looking let know help report analysis analyse analyze seo google console please thanks want wanted need needs would like using use ones one stuff things thing list lists give top best'.split(' '));
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
    const D = A.data || {};
    let limit = null, sort = null, reqDays = null, device = null, searcherPlace = null, byCountry = false;
    const questions = [], issues = [], unusedNums = [];
    const hasOpp = () => conds.some(c => c.f === 'opp');
    const opp = k => { if (!conds.some(c => c.f === 'opp' && c.v === k)) conds.push({ f: 'opp', op: 'is', v: k }); };

    // "top 20 pages" is a number of results; "in the top 10" (below) is a position
    take(/\b(?:the )?(?:top|first|biggest|largest) (\d{1,5})\b(?=\s+(?:[\p{L}-]+\s+){0,2}(?:opportunit\w*|pages?|urls?|quer(?:y|ies)|keywords?|searches|results|wins?|titles?|terms?|articles?|posts?)\b)/gu, (m, n) => { limit = Math.min(10000, Math.max(1, +n)); });

    // goals answered by the opportunity engine
    // "content opportunities": improvements to pages that already rank. New-topic gaps need the Content assistant.
    take(/\b(?:content|seo|search) (?:opportunit\w+|ideas?|gaps?|wins?)\b|\bcontent to (?:improve|update|refresh)\b/g, () => { opp('growth'); notes.push('content'); });
    // "compared with the previous period" is what a decline means; keep it, and check the data has one
    take(/\b(?:compared (?:with|to)|versus|vs\.?|against|relative to)\s+(?:the\s+)?(?:previous|prior|last|preceding|earlier)\s+(?:period|month|quarter|year|weeks?|days?|\d+ days)\b|\b(?:period over period|month over month|year over year|mom|yoy)\b/g, () => { notes.push('compare'); });
    take(/\b(?:meta )?titles? (?:to |that need (?:a )?|i should |we should )?(?:rewrite|rewriting|fix|fixing|update|improve)\b|\brewrite (?:the |my |our )?titles?\b|\btitle rewrites?\b/g, () => { opp('ctr'); target = 'page'; });
    take(/\b(?:competing|cannibali[sz]\w*)(?: pages?| urls?| keywords?| queries| searches)?\b|\bpages? (?:that )?compet\w*(?: with each other)?\b/g, () => { opp('cannibal'); target = 'query'; notes.push('cannibal'); });
    take(/\b(?:answer box(?:es)?|featured snippets?|ai overviews?|ai mode|zero[- ]click(?: searches)?)\b/g, () => { opp('answer'); target = 'query'; });
    take(/\b(?:early warnings?|slipping)\b/g, () => { opp('slipping'); target = 'page'; });
    take(/\b(?:quick|easy) wins?\b|\blow[- ]hanging fruit\b/g, () => { opp('growth'); });
    take(/\b(?:what|which)\b(?:[^.]{0,40}?)\b(?:should|to|do|can|must)\s+(?:i |we )?(?:fix|improve|work on|optimi[sz]e|update|tackle)\b(?:\s+first)?|\bfix(?:es)?\s+first\b|\bpriorit\w*\b|\bbiggest (?:wins?|opportunit\w+)\b|\bopportunit(?:y|ies)\b|\bto[- ]?do(?: list)?\b|\brecommendations?\b/g, () => { if (!hasOpp()) opp('any'); });
    take(/\b(high|strong|medium|moderate|low)[- ]confidence\b/g, (m, l) => { conds.push({ f: 'confidence', op: 'is', v: /high|strong/.test(l) ? 'High' : /low/.test(l) ? 'Low' : 'Medium' }); if (!hasOpp()) opp('any'); });
    take(/\b(?:reliable|trustworthy|confident|solid)\b/g, () => { conds.push({ f: 'confidence', op: 'not', v: 'Low' }); if (!hasOpp()) opp('any'); });
    // estimated gain: "worth at least 100 clicks a month"
    const MONTH = '(?:more |extra |additional )?clicks? (?:a|per|each|every|\\/) ?month\\b';
    take(new RegExp('\\b(?:worth|gaining|adding|that could add|could add)?\\s*' + GT + '\\s*' + NUM + '\\s*' + MONTH, 'g'), (m, op, n, sx) => { conds.push({ f: 'gain', op: /least|minimum|min/.test(op) ? 'gte' : 'gt', v: toNum(n, sx) }); if (!hasOpp()) opp('any'); });
    take(new RegExp('\\b(?:worth|gaining|adding)?\\s*' + LT + '\\s*' + NUM + '\\s*' + MONTH, 'g'), (m, op, n, sx) => { conds.push({ f: 'gain', op: /most|maximum|max/.test(op) ? 'lte' : 'lt', v: toNum(n, sx) }); if (!hasOpp()) opp('any'); });
    take(new RegExp('\\b' + NUM + '\\s*\\+\\s*' + MONTH, 'g'), (m, n, sx) => { conds.push({ f: 'gain', op: 'gte', v: toNum(n, sx) }); if (!hasOpp()) opp('any'); });


    // folders: "in the blog folder", "/blog/"
    const folderCond = w => {
      const clean = String(w).toLowerCase().replace(/^\/+|\/+$/g, '');
      if (!clean) return;
      const want = s => { const x = s.replace(/^\/+|\/+$/g, ''); return x === clean || x === clean + 's' || x + 's' === clean; };
      const hit = R.folders.find(want);
      const v = hit || '/' + clean + '/';
      conds.push({ f: 'section', op: 'is', v });
      if (!hit && !R.page.some(r => (norm(safeDecode(r.path)) + '/').startsWith(v))) issues.push({ kind: 'folder', text: `No pages under ${v} in this data.`, alternative: R.folders.length ? `Folders with pages here: ${R.folders.slice(0, 8).join(', ')}.` : 'This data has no folders.' });
    };
    take(/\b(?:in|under|inside|within|from)\s+(?:the\s+|my\s+|our\s+)?\/?([\p{L}\p{N}][\p{L}\p{N}_-]{0,40})\/?\s+(?:folder|section|directory|sub-?folder)\b/gu, (m, w) => { folderCond(w); });
    take(/(^|\s)(\/[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*\/?)(?=\s|$)/gu, (m, sp, path) => { folderCond(path); return ''; });

    // devices: Search Console splits devices only when the analysis is run for one device
    take(/\b(?:on |from |via |for )?(mobile|desktop|tablets?|phones?|smartphones?|ipads?)(?: devices?| users?| traffic| visitors| searches| only)?\b/g, (m, d) => { device = /desk/.test(d) ? 'DESKTOP' : /tab|ipad/.test(d) ? 'TABLET' : 'MOBILE'; });

    // where searchers are: Search Console has country (not city), and Clickwise does not load it per search
    take(/\b(?:users?|visitors?|people|searchers?|audiences?|customers?|traffic|visits)\s+(?:from|in|located in|based in|living in)\s+([\p{L}][\p{L} ]{1,40}?)(?=\s+(?:with|and|that|who|ranking|for|on|in)\b|\s*[,.;]|\s*$)/gu, (m, place) => { searcherPlace = placeOf(place) || title(place.trim()); });
    take(/\b(?:by|per|which|each|top) countr(?:y|ies)\b|\bcountr(?:y|ies) (?:breakdown|split)\b/g, () => { byCountry = true; });

    // grouping
    take(/\b(?:group(?:ed)?|split|break(?: ?down)?|organi[sz]e|cluster)\b([^.]*?)\bby\s+(cit(?:y|ies)|locations?|places?|page ?types?|types?|templates?|folders?|sections?|directories|intent|brand(?:ed)?)\b/g, (m, mid, by) => { group = groupKey(by); return mid; });
    take(/\bby\s+(cit(?:y|ies)|locations?|page ?types?|folders?|sections?|intent)\b/g, (m, by) => { group = group || groupKey(by); });
    take(/\bbranded (?:and|vs\.?|versus) non[- ]?branded\b|\bnon[- ]?branded (?:and|vs\.?|versus) branded\b|\bbrand split\b/g, () => { group = 'brand'; target = 'query'; });
    if (group === 'brand' || group === 'intent') target = 'query';
    if (group === 'pageType' || group === 'folder') target = 'page';

    // date ranges: the loaded range is used
    const WN = { a: 1, one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12, sixteen: 16 };
    const UNIT = u => /day/.test(u) ? 1 : /week/.test(u) ? 7 : /month/.test(u) ? 30 : /quarter/.test(u) ? 90 : 365;
    take(/\b(?:in|over|during|for|within)?\s*(?:the\s+)?(?:last|past|previous|recent)\s+(\d+|a|one|two|three|four|six|twelve|sixteen)?\s*(days?|weeks?|months?|years?|quarters?)\b/g, (m, n, u) => { notes.push('date'); const k = n == null ? 1 : /^\d+$/.test(n) ? +n : WN[n] || 1; reqDays = k * UNIT(u); });
    take(/\b(this|last) (week|month|quarter|year)\b/g, (m, w, u) => { notes.push('date'); reqDays = UNIT(u); });
    take(/\byesterday\b|\btoday\b/g, () => { notes.push('date'); reqDays = 1; });
    take(/\brecently\b/g, () => { notes.push('date'); });

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

    // "<topic> queries/keywords/searches" → the search contains that word
    const NOT_TOPIC = new Set(['top', 'all', 'my', 'our', 'these', 'those', 'high', 'low', 'new', 'old', 'zero', 'based', 'tail', 'long', 'short', 'one', 'two', 'declining', 'losing', 'growing', 'rising', 'branded', 'brand', 'unbranded', 'generic', 'local', 'question', 'questions', 'commercial', 'informational', 'transactional', 'navigational', 'best', 'worst', 'more', 'less', 'other', 'any', 'such']);
    take(/\b([\p{L}\p{N}][\p{L}\p{N}-]{1,40}) (?:queries|query|keywords?|searches|search terms?)\b/gu, (m, w) => {
      if (STOP.has(w) || NOT_TOPIC.has(w) || /^\d+$/.test(w)) return false;
      target = 'query'; textCond('contains', w); return 'keywords';
    });

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

    // a place named anywhere ("in delhi", "mumbai") → that place
    {
      const m = loose(t).match(PLACE_RX);
      if (m && m[1] !== 'near me' && m[1] !== 'nearby') {
        const name = placeOf(m[1]);
        conds.push({ f: 'place', op: 'is', v: name });
        t = t.replace(new RegExp(B + escRx(m[1]).replace(/ /g, '[\\s-]+') + E, 'u'), ' ');
      }
    }

    // numbers nobody claimed: "more than 1000" with no metric → ask which metric, never guess
    take(new RegExp('(?:' + GT + '|' + LT + ')?\\s*' + NUM + '\\s*(%|percent)?', 'g'), (m, gt, lt, n, sx, pc) => {
      const v = toNum(n, sx);
      // beyond two questions (or a zero), the number is listed as not used rather than dropped
      if (!(v > 0) || questions.filter(q => q.kind === 'number').length >= 2) { unusedNums.push(m.trim()); return; }
      // a bare year ("treks 2026") is a word to look for, not a threshold
      if (!gt && !lt && !pc && /^(19|20)\d\d$/.test(n)) { questions.push({ kind: 'word', word: n, text: `“${n}” wasn't used. What did you mean by it?`, options: [{ label: `Contains “${n}”`, patch: { add: [{ f: 'text', op: 'contains', v: n }] } }, { label: 'Leave it out', patch: {} }] }); return; }
      const op = lt ? (/most|maximum|max|<=/.test(lt) ? 'lte' : 'lt') : (/least|minimum|min|>=/.test(gt || '') ? 'gte' : 'gt');
      const say = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most' }[op];
      const opts = pc ? [{ label: `CTR ${say} ${fmt(v)}%`, patch: { add: [{ f: 'ctr', op, v }] } }, { label: `Share of expected clicks ${say} ${fmt(v)}%`, patch: { add: [{ f: 'ctrGap', op, v }] } }]
        : [{ label: `${say.charAt(0).toUpperCase() + say.slice(1)} ${fmt(v)} impressions`, patch: { add: [{ f: 'impr', op, v }] } }, { label: `${say.charAt(0).toUpperCase() + say.slice(1)} ${fmt(v)} clicks`, patch: { add: [{ f: 'clicks', op, v }] } }];
      if (!pc && v <= 100) opts.push({ label: `Position ${say} ${fmt(v)}`, patch: { add: [{ f: 'pos', op, v }] } });
      opts.push({ label: 'Leave it out', patch: {} });
      questions.push({ kind: 'number', text: `What should “${say} ${fmt(v)}${pc ? '%' : ''}” apply to?`, options: opts });
    });

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
    if (limit && !sort) sort = { f: uniq.some(c => ['opp', 'gain', 'confidence'].includes(c.f)) ? 'gain' : 'clicks', dir: 'desc' };
    const spec = { target, conds: uniq, group };
    if (limit) spec.limit = limit;
    if (sort) spec.sort = sort;
    const unk = [...new Set(unknown)];
    const where = target === 'page' ? 'URL' : 'search text';

    // ── what the loaded data cannot answer, with the alternative ──
    const api = D.source === 'api';
    if (reqDays) {
      if (A.method && A.method.assumedDays) issues.push({ kind: 'dates', text: `You asked about the last ${reqDays} days, but this export has no dates, so its period is unknown.`, alternative: 'Include the Dates sheet when you export, or connect Search Console.' });
      else if (reqDays > 486) issues.push({ kind: 'dates', text: 'Search Console keeps about 16 months of data, so periods longer than that are not available.', alternative: `This data covers ${A.days} days.` });
      else if (Math.abs(reqDays - A.days) > Math.max(2, reqDays * 0.1)) issues.push({ kind: 'dates', text: `You asked about the last ${reqDays} days, but this data covers ${A.days} days${D.start ? ` (${D.start} to ${D.end})` : ''}. The results below use the ${A.days} days that are loaded.`, alternative: api ? `Load the last ${reqDays} days instead.` : 'Export again from Search Console with that date range, or connect Search Console to switch dates.', action: api ? { type: 'dates', days: reqDays } : null });
      else notes.push('date-ok');
    }
    if (device) {
      const name = { MOBILE: 'mobile', DESKTOP: 'desktop', TABLET: 'tablet' }[device];
      const cur = D.filters && D.filters.device;
      if (cur === device) notes.push('device-ok');
      else issues.push({ kind: 'device', text: cur ? `This analysis covers ${cur.toLowerCase()} only, not ${name}.` : `This data covers all devices together. Search Console can't split each search by device here, so “${name}” was not applied.`, alternative: api ? `Re-run the analysis for ${name} only.` : `Export again from Search Console with the Device filter set to ${name}, or connect Search Console.`, action: api ? { type: 'device', value: device } : null });
      questions.push({ kind: 'device', text: `Or did you mean searches or pages that mention “${name}”?`, options: [{ label: `${target === 'page' ? 'URL' : 'Search'} contains “${name}”`, patch: { add: [{ f: 'text', op: 'contains', v: name }] } }, { label: 'No, leave it out', patch: {} }] });
    }
    if (searcherPlace) {
      issues.push({ kind: 'searcher-location', text: `Search Console records only searchers' country, never their city, and Clickwise doesn't load searches by country yet, so “people in ${searcherPlace}” can't be answered from this data.`, alternative: 'Country totals for the whole site are on the Dashboard when your export includes them.' });
      const known = placeOf(searcherPlace);
      questions.push({ kind: 'place', text: `Find searches that mention ${searcherPlace} instead?`, options: [{ label: `Searches that mention ${searcherPlace}`, patch: { target: 'query', add: [known ? { f: 'place', op: 'is', v: known } : { f: 'text', op: 'word', v: searcherPlace.toLowerCase() }] } }, { label: 'No, leave it out', patch: {} }] });
    }
    if (byCountry) issues.push({ kind: 'country', text: 'Searches by country are not loaded in Clickwise yet.', alternative: 'Country totals for the whole site are on the Dashboard when your export includes them. To group searches that mention places, ask for “keywords grouped by city”.' });
    if (uniq.some(c => c.f === 'place') && !searcherPlace) notes.push('place-mention');
    if (notes.includes('compare') && !R.hasPrev && !uniq.some(c => c.f === 'clickChange')) issues.push({ kind: 'compare', text: 'A comparison with the previous period was asked for, but this data has no previous period.', alternative: 'Upload an export made with Date › Compare, or two exports together, or connect Search Console with “Compare with the previous period” ticked.' });
    if (uniq.some(c => c.f === 'opp' && (c.v === 'decline' || c.v === 'slipping')) && !R.hasPrev) issues.push({ kind: 'compare', text: 'Losing clicks and early warnings need a comparison period.', alternative: 'Upload an export made with Date › Compare, or two exports together, or connect Search Console with “Compare with the previous period” ticked.' });
    if (uniq.some(c => c.f === 'section') && target === 'query' && !R.hasQP) {
      const sec = uniq.find(c => c.f === 'section').v;
      questions.push({ kind: 'folder', text: `Searches can only be tied to a folder when Clickwise knows which page ranks for each one, and this data doesn't include that. Look at pages in ${sec} instead?`, options: [{ label: `Pages in ${sec}`, patch: { target: 'page' } }, { label: 'Remove the folder', patch: { removeField: 'section' } }] });
    }
    // which of searches or pages, when nothing in the request says so
    if (pageHit < 0 && queryHit < 0 && uniq.length && !group && uniq.every(c => FIELDS[c.f].on.length === 2) && !uniq.some(c => c.f === 'opp' || c.f === 'section'))
      questions.push({ kind: 'target', text: 'Look at searches or pages? Showing searches for now.', options: [{ label: 'Searches', patch: { target: 'query' } }, { label: 'Pages', patch: { target: 'page' } }] });
    // words that were not used: offer them as text to look for, never use them silently
    unk.filter(w => w.length > 2 && !SOFT.has(w)).slice(0, 3).forEach(w => {
      const folder = R.folders.find(f => { const x = f.replace(/\//g, ''); return x === w || x === w + 's' || x + 's' === w; });
      const opts = folder ? [{ label: `Pages in ${folder}`, patch: { target: 'page', add: [{ f: 'section', op: 'is', v: folder }] } }] : [];
      opts.push({ label: `${where.charAt(0).toUpperCase() + where.slice(1)} contains “${w}”`, patch: { add: [{ f: 'text', op: 'contains', v: w }] } }, { label: 'Leave it out', patch: {} });
      questions.push({ kind: 'word', word: w, text: `“${w}” wasn't used. What did you mean by it?`, options: opts });
    });

    if (notes.includes('compare') && !uniq.some(c => c.f === 'clickChange' || (c.f === 'opp' && (c.v === 'decline' || c.v === 'slipping'))))
      questions.push({ kind: 'compare', text: 'Compared with the previous period: what change are you looking for?', options: [{ label: 'Lost clicks', patch: { add: [{ f: 'clickChange', op: 'lt', v: 0 }] } }, { label: 'Gained clicks', patch: { add: [{ f: 'clickChange', op: 'gt', v: 0 }] } }, { label: 'Leave it out', patch: {} }] });
    const understood = uniq.length > 0 || !!group || !!limit || issues.length > 0 || questions.some(q => q.kind === 'number' || q.kind === 'place');
    return { spec, unknown: unk.concat(unusedNums), notes: [...new Set(notes)], understood, questions, issues, requested: { days: reqDays, device, searcherPlace } };

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

  // Apply the answer to a clarifying question. Pure: returns a new spec and what had to be dropped.
  // patch: { target?: 'query'|'page', add?: [cond], removeField?: field }
  function applyPatch(spec, patch) {
    patch = patch || {};
    let conds = (spec.conds || []).slice(), target = spec.target, dropped = [];
    if (patch.removeField) conds = conds.filter(c => c.f !== patch.removeField);
    if (patch.target && patch.target !== target) {
      target = patch.target;
      dropped = conds.filter(c => !FIELDS[c.f].on.includes(target)).map(c => chip(c, spec.target));
      conds = conds.filter(c => FIELDS[c.f].on.includes(target));
    }
    (patch.add || []).forEach(c => { if (FIELDS[c.f] && FIELDS[c.f].on.includes(target) && !conds.some(x => JSON.stringify([x.f, x.op, x.v, x.v2]) === JSON.stringify([c.f, c.op, c.v, c.v2]))) conds.push(c); });
    const group = spec.group && ((['brand', 'intent'].includes(spec.group) && target === 'query') || (['pageType', 'folder'].includes(spec.group) && target === 'page') || spec.group === 'location') ? spec.group : null;
    const out = { ...spec, target, conds, group };
    if (!out.group) delete out.group;
    return { spec: out, dropped };
  }

  // Examples shown under the box, all handled by the parser above.
  const EXAMPLES = [
    'Which pages should I fix first?',
    'Top 10 opportunities with high confidence',
    'Titles to rewrite',
    'Quick wins in the blog folder',
    'Pages with more than 1,000 impressions and CTR below 2%',
    'Non-branded keywords ranking between positions 5 and 15',
    'Blog pages that lost clicks in the last 28 days',
    'Location-based keywords grouped by city'
  ];

  window.CW_FILTERS = { FIELDS, OPS, GROUPS, OPP, LEVELS, parse, validate, run, describe, chip, gscRecipe, rows, placeOf, pageTypeOf, EXAMPLES, labelOf, funnel, applyPatch, conflicts };
})();
